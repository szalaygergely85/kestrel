// AUD-45: height fog (valley mist) + sun-coloured in-scatter on top of the linear distance fog factor `f`.
// ONE params object; the WGSL snippet (shade.wgsl.js) is generated from it and the JS functions below are its literal twins
// (D-039). Both only act where f > 0 (short range is untouched) and leave f == 1 at 1. Sun colour/strength come from skyGlow.js.
import { SKY_GLOW, skyGlowStrength } from './skyGlow.js';
import { screenRay } from './projection.js';
import { skyLutFromPalette } from './waterReflect.js';
import { SKY_LUT_N } from './gpu/wgsl/skyLut.js';

export const FOG_SHAPE = Object.freeze({
  base: 6,            // metres: fog height reference (valley floor); denser below, thinning above
  k: 0.10,            // exponential falloff per metre of altitude
  heightGain: 0.35,   // extra fog at/below `base`: f *= 1 + heightGain * valley (valley 0..maxValley)
  maxValley: 2,       // clamp of exp(-(zMid - base) * k)
  scatterK: 8,        // pow(max(dot(viewDir, sunDir), 0), scatterK)
  scatterGain: 0.30,  // max lerp of the fog colour toward the sun tint
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Height-fog boost of the linear factor. slope = dir.z / length(dir.xy) of the cell ray, dist = the shade-pass distance
 * (horizontal-forward in pitched mode), camZ = eye height. Altitude is taken at the ray midpoint.
 */
export function fogShapeF(f, dist, camZ, slope) {
  if (f <= 0) return 0;
  const P = FOG_SHAPE;
  let v = Math.exp(-(camZ + slope * dist * 0.5 - P.base) * P.k);
  if (v > P.maxValley) v = P.maxValley;
  const g = f * (1 + P.heightGain * v);
  return g > 1 ? 1 : g;
}

/** Weight 0..scatterGain of the lerp from the fog colour toward SKY_GLOW.tint. cosSun = dot(unit view dir, sunDir). */
export function fogScatterW(cosSun, sunZ, sunI) {
  const c = cosSun > 0 ? cosSun : 0;
  return Math.pow(c, FOG_SHAPE.scatterK) * FOG_SHAPE.scatterGain * skyGlowStrength(sunZ, sunI);
}

/** out[i] = fogRGB[i] + (tint[i] - fogRGB[i]) * w (0..255). No allocation. */
export function fogScatterColor(out, fogRGB, w) {
  const T = SKY_GLOW.tint;
  out[0] = fogRGB[0] + (T[0] - fogRGB[0]) * w; out[1] = fogRGB[1] + (T[1] - fogRGB[1]) * w; out[2] = fogRGB[2] + (T[2] - fogRGB[2]) * w;
  return out;
}

/**
 * Unit view direction of a shear-mode cell (mirrors the WGSL sky ray): hx,hy = horizontal ray (dirX + planeX*cx, ...),
 * tanE = (horizonRow - row) / planeDistY. out = [x,y,z].
 */
export function fogDirShear(hx, hy, tanE, out) {
  const invH = 1 / Math.sqrt(Math.max(hx * hx + hy * hy, 1e-12)), ce = 1 / Math.sqrt(1 + tanE * tanE);
  out[0] = hx * invH * ce; out[1] = hy * invH * ce; out[2] = tanE * ce;
  return out;
}

/**
 * CPU frame context, filled by the compositor before shadeSurfaces (module state, no allocation). mode: 0 shear, 1 pitched,
 * 2 ortho. terms = shear ProjTerms (mode 0) or PitchedTerms (modes 1/2). sun = {dirX,dirY,dirZ,sunI}.
 */
export const fogShapeCtx = { on: false, mode: 0, camZ: 0, terms: null, sunX: 0, sunY: 0, sunZ: 0, sunI: 0,
  camX: 0, camY: 0, aaFol: true, // AA-15 (OB-208): camera x/y + the foliage world-dice switch (`?aafol=0` -> setFoliageDice(false))
  // OB-089: outdoor MESH fog (terrain's far fog: palette.fog.far near->far colours over start..full, curve) instead of the interior fogV2.
  outdoor: false, tStart: 0, tFull: 1, tCurve: 1, tNear: /** @type {ArrayLike<number>|null} */ (null), tFar: /** @type {ArrayLike<number>|null} */ (null) };

/**
 * OB-089: true when placed meshes should fog like the terrain: a terrain world with a time-of-day palette that defines `fog.far`, and the camera
 * outside every sector (not in the tower / a building interior; those keep the interior fogV2). Shared by the CPU compositor and passShade.js (`fogView.z`).
 * @param {any} world @param {{x:number,y:number}} cam @param {any} palette
 */
export function meshOutdoorFog(world, cam, palette) {
  if (!world || !world.terrain || !palette || !palette.timeOfDay || !palette.rgb) return false;
  const fr = palette.fog && palette.fog.far;
  if (!fr || !palette.rgb[fr.color] || !palette.rgb[fr.colorFar]) return false;
  if (typeof world.isOutdoorAt === 'function') return world.isOutdoorAt(cam.x, cam.y, cam.z); // OB-205: z-aware (above a buried cellar = outside)
  return !(typeof world.sectorAt === 'function' && world.sectorAt(cam.x, cam.y));
}
/** AA-15 (OB-208): switch the foliage world-space glyph dice (default on). Read by the CPU twin (detailShade.js) and passShade.js (fogView.w). */
export function setFoliageDice(on) { fogShapeCtx.aaFol = !!on; }

/**
 * AA-15 (OB-208): glyph dice for soft-edge leaf cards (kind 9), keyed to a WORLD-space block instead of the per-card u/v (leaf cards
 * have unrelated u/v, so a card change under the cell centre re-rolled the alternate glyph every step). Block edge q (m) doubles with
 * distance (0.25 / 0.5 / 1 / 2 at < 16 / 32 / 64 m), ~3-8 cells everywhere. Point = cam + unit cell dir * shade dist (both f32-rounded
 * like the WGSL `folDice`); not for ortho (mode 2). Needs fogShapeCtx terms/cam for this frame (on === true).
 */
export function folDiceJS(col, row, dist, seed) { // seed = material seed + salt (977)
  const c = fogShapeCtx, d = fogCellDirJS(col, row), fr = Math.fround;
  const q = dist >= 64 ? 4 : dist >= 32 ? 2 : dist >= 16 ? 1 : 0.5, iq = 1 / q;
  const px = fr(fr(c.camX) + fr(fr(d[0]) * fr(dist))), py = fr(fr(c.camY) + fr(fr(d[1]) * fr(dist))), pz = fr(fr(c.camZ) + fr(fr(d[2]) * fr(dist)));
  const ix = Math.floor(px * iq), iy = Math.floor(py * iq), iz = Math.floor(pz * iq);
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul((iy + Math.imul(iz, 8191)) | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/**
 * VISQA-02 (OB-209 follow-up): far fog follows the sky gradient at the cell's own elevation. Per frame: skyW = P.atmos.farSkyW
 * (biome share of the sky-horizon far fog, 0 = off -> byte-identical) and the CPU copy of the GPU sky LUT (same bake as passShade
 * _bakeSky: look stops + atmos haze, f32). Per cell: out = skyW * (lut[idx(elev)] - lut[0]) for elev > 0, else 0 (twin of WGSL
 * farSkyShift: elev from fogCellDir, idx = round(clamp(elev / elevTop) * (N - 1))). Needs fogShapeCtx.terms for this frame.
 */
const farSky = { w: 0, top: 0, ver: -1, live: -1, P: /** @type {any} */ (null), lut: new Float32Array(SKY_LUT_N * 4) };
export function farSkyPrep(P) {
  const st = P && P.atmos, w = st && st.farSkyW > 0 ? st.farSkyW : 0;
  farSky.w = 0;
  if (!w) return 0;
  const fv = P.liveFogVersion | 0, lv = P.liveLookVersion | 0;
  if (farSky.P !== P || farSky.ver !== fv || farSky.live !== lv) { farSky.top = skyLutFromPalette(P, farSky.lut) || 0; farSky.P = P; farSky.ver = fv; farSky.live = lv; }
  if (farSky.top > 0) farSky.w = w;
  return farSky.w;
}
/** Disable the per-cell shift (non-terrain frames). */
export function farSkyOff() { farSky.w = 0; }
/** True when farSkyShiftJS can return non-zero this frame. */
export function farSkyActive() { return farSky.w > 0; }
export function farSkyShiftJS(col, row, out) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  if (!(farSky.w > 0) || !fogShapeCtx.terms) return out;
  const d = fogCellDirJS(col, row), fr = Math.fround;
  const e = fr(Math.atan2(fr(d[2]), fr(Math.hypot(fr(d[0]), fr(d[1])))) * (180 / Math.PI));
  if (!(e > 0)) return out;
  const t = Math.min(1, e / farSky.top), L = farSky.lut, o = Math.floor(t * (SKY_LUT_N - 1) + 0.5) * 4, w = farSky.w;
  out[0] = w * (L[o] - L[0]); out[1] = w * (L[o + 1] - L[1]); out[2] = w * (L[o + 2] - L[2]);
  return out;
}
const _dir = [0, 0, 0], _ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };

/** Unit view direction of cell (col,row) for the active ctx (JS twin of WGSL fogCellDir). Returns the shared scratch. */
export function fogCellDirJS(col, row) {
  const c = fogShapeCtx, t = c.terms;
  if (c.mode === 0) {
    const cx = (2 * (col + 0.5)) / t.cols - 1;
    return fogDirShear(t.dirX + t.planeX * cx, t.dirY + t.planeY * cx, (t.horizonRow - row) / t.planeDistY, _dir);
  }
  const r = screenRay(t, col, row, _ray);
  const dx = c.mode === 2 ? t.fX : r.dx, dy = c.mode === 2 ? t.fY : r.dy, dz = c.mode === 2 ? t.fZ : r.dz;
  const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
  _dir[0] = dx * inv; _dir[1] = dy * inv; _dir[2] = dz * inv;
  return _dir;
}

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const P = FOG_SHAPE;

/** WGSL twin source (needs skyGlowSm from SKY_GLOW_WGSL above it). */
export const FOG_SHAPE_WGSL = `
fn fogShapeF(f: f32, dist: f32, camZ: f32, slope: f32) -> f32 {
  if (f <= 0.0) { return 0.0; }
  let v = min(exp(-(camZ + slope * dist * 0.5 - ${f(P.base)}) * ${f(P.k)}), ${f(P.maxValley)});
  return min(f * (1.0 + ${f(P.heightGain)} * v), 1.0);
}
fn fogScatterW(cosSun: f32, sunZ: f32, sunI: f32) -> f32 {
  let s = clamp(sunI, 0.0, 1.0) * skyGlowSm(${f(SKY_GLOW.sunFadeLo)}, ${f(SKY_GLOW.sunFadeHi)}, sunZ);
  return pow(max(cosSun, 0.0), ${f(P.scatterK)}) * ${f(P.scatterGain)} * s;
}
const FOG_SUN_TINT = vec3f(${SKY_GLOW.tint.map(f).join(', ')});
`;
