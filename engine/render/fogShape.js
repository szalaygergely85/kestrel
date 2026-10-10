// AUD-45: height fog (valley mist) + sun-coloured in-scatter on top of the linear distance fog factor `f`.
// ONE params object; the WGSL snippet (shade.wgsl.js) is generated from it and the JS functions below are its literal twins
// (D-039). Both only act where f > 0 (short range is untouched) and leave f == 1 at 1. Sun colour/strength come from skyGlow.js.
import { SKY_GLOW, skyGlowStrength } from './skyGlow.js';
import { screenRay } from './projection.js';

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
export const fogShapeCtx = { on: false, mode: 0, camZ: 0, terms: null, sunX: 0, sunY: 0, sunZ: 0, sunI: 0 };
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
