// SWIM-04b (docs/architecture.md 38.54 "Underwater look"): the diving look, JS twin. One per-cell function `underShade`
// (end of the shade pass, every kind) + `underFogK` for sprites/particles + the per-frame state. Presentation only.
// WGSL twin = UNDER_WGSL (same maths, no exp/Math.random: 32.6 parity rule); SWIM-04c wires it into passShade.
// Every number in `U` maps 1:1 onto the appended ShadeU fields: under = (on, waterZ, fogM, causticK), underTint = (rgb, swapAt).
import { hashFastU } from './terrainShade.js';
import { fogCellDirJS } from './fogShape.js';

const GLYPH0 = 32;
const code = (ch) => ch.charCodeAt(0) - GLYPH0;

/** Content default (the water look table's `under` entry overrides any key). Colours 0..255. */
export const UNDER_DEFAULT = Object.freeze({
  tint: [20, 90, 120], fogM: 12, swapAt: 0.5, ceil: [90, 170, 200], caustic: 0.35, causticCol: [60, 70, 40],
  bubbleRamp: ' .:o', ceilRamp: '~-~=', lightK: 0.8, // lightK = ambient + sunI * 0.5, set by the caller each frame
});

/** Per-frame under state (plain numbers + small arrays, built once). `on` flips with the 0.05 hysteresis. */
export function makeUnderState(look = UNDER_DEFAULT) {
  const L = Object.assign({}, UNDER_DEFAULT, look);
  return {
    on: 0, waterZ: 0, fogM: L.fogM, causticK: L.caustic, swapAt: L.swapAt, lightK: L.lightK,
    tint: L.tint.slice(), ceil: L.ceil.slice(), causticCol: L.causticCol.slice(),
    bubble: Array.from(L.bubbleRamp, code), ceilRamp: Array.from(L.ceilRamp, code), // glyph indices (ascii - 32)
    _w: { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: null },
  };
}

/** Fog ramp 0..1 over path length L: s = min(1, L/fogM), f = s*(2-s). 0 when off. */
export function underFogK(L, U) {
  if (!U.on) return 0;
  const s = L >= U.fogM ? 1 : L / U.fogM;
  return s * (2 - s);
}

/** Eye state: on when eyeZ < surfaceZ - 0.05 and depth >= 0.3; off when eyeZ > surfaceZ + 0.05 (else unchanged). */
export function updateUnderState(world, ex, ey, ez, U) {
  const w = U._w;
  if (!world.water || !world.waterAt(ex, ey, w)) { U.on = 0; return U; }
  if (U.on) { if (ez > w.surfaceZ + 0.05) U.on = 0; }
  else if (ez < w.surfaceZ - 0.05 && w.depth >= 0.3) U.on = 1;
  U.waterZ = w.surfaceZ;
  const lk = w.look && w.look.under;
  if (lk) { // region look overrides (only the keys it has)
    if (lk.fogM !== undefined) U.fogM = lk.fogM;
    if (lk.swapAt !== undefined) U.swapAt = lk.swapAt;
    if (lk.caustic !== undefined) U.causticK = lk.caustic;
    if (lk.tint) { U.tint[0] = lk.tint[0]; U.tint[1] = lk.tint[1]; U.tint[2] = lk.tint[2]; }
    if (lk.ceil) { U.ceil[0] = lk.ceil[0]; U.ceil[1] = lk.ceil[1]; U.ceil[2] = lk.ceil[2]; }
  }
  return U;
}

/**
 * Shade one cell. fg/bg = [r,g,b] 0..255 (already lit + fogged), glyph = ascii-32 index, L = path length, (Px,Py,Pz) = world hit
 * (sky: Pz = Infinity), nz = surface normal z, timeSec. Writes out = {fg:[3], bg:[3], glyph}; reads only. Caller checks U.on first
 * (re-checked here so it is a pure no-op copy when off).
 */
export function underShade(fg, bg, glyph, L, Pz, Px, Py, nz, timeSec, U, out) {
  const ofg = out.fg, obg = out.bg;
  if (!U.on) { ofg[0] = fg[0]; ofg[1] = fg[1]; ofg[2] = fg[2]; obg[0] = bg[0]; obg[1] = bg[1]; obg[2] = bg[2]; out.glyph = glyph; return out; }
  const s = L >= U.fogM ? 1 : L / U.fogM, f = s * (2 - s), T = U.tint, k = U.lightK;
  const ceiling = Pz >= U.waterZ - 0.02; // sky cells (Pz = Infinity) land here too
  let r = fg[0], g = fg[1], b = fg[2], gl = glyph;
  if (ceiling) {
    r = U.ceil[0]; g = U.ceil[1]; b = U.ceil[2];
    gl = U.ceilRamp[hashFastU(Math.floor(Px * 2), Math.floor(Py * 2), Math.floor(timeSec * 2)) & 3];
  }
  ofg[0] = r + (T[0] * k - r) * f; ofg[1] = g + (T[1] * k - g) * f; ofg[2] = b + (T[2] * k - b) * f;
  obg[0] = bg[0] + (T[0] * 0.35 - bg[0]) * f; obg[1] = bg[1] + (T[1] * 0.35 - bg[1]) * f; obg[2] = bg[2] + (T[2] * 0.35 - bg[2]) * f;
  if (!ceiling) {
    if (f >= U.swapAt) { // far water swallows the detail: bubble ramp by luminance
      let q = Math.floor(((0.299 * ofg[0] + 0.587 * ofg[1] + 0.114 * ofg[2]) / 255) * 4);
      gl = U.bubble[q > 3 ? 3 : q < 0 ? 0 : q];
    }
    if (Pz < U.waterZ && nz > 0.6 && L < 10) { // caustics on lit floors
      const h = hashFastU(Math.floor(Px / 0.7), Math.floor(Py / 0.7), Math.floor(timeSec * 3));
      if ((h >>> 8) * (1 / 16777216) > 1 - U.causticK) {
        gl = (h & 1) ? code('*') : code('~');
        const w = 1 - f, C = U.causticCol;
        ofg[0] += C[0] * w; ofg[1] += C[1] * w; ofg[2] += C[2] * w;
      }
    }
  }
  out.glyph = gl;
  return out;
}

const _in = { fg: [0, 0, 0], bg: [0, 0, 0] }, _out = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: 0 };
const clampB = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * CPU end-of-frame pass over the cell buffer (call after the sky fill). Needs fogShapeCtx terms set for this frame (fogCellDirJS
 * gives each cell's ray). `depth` = raw view depth per cell (sky: Infinity or kind 0). nz is taken as 1 (no G-buffer normal on the
 * CPU path; the GPU twin may use the real one). No-op unless U.on.
 */
export function underwaterPass(rt, gbuf, depth, camX, camY, camZ, timeSec, U) {
  if (!U.on) return;
  const cols = gbuf.cols, rows = gbuf.rows, kind = gbuf.kind;
  const cb = rt.cells || rt; // real RenderTargets wrap a shared CellBuffer (rt.cells); a bare CellBuffer has the arrays itself
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, fi = i * 4, sky = kind[i] === 0 || !(depth[i] < 1e8);
      const L = sky ? 1e9 : depth[i];
      let Px = camX, Py = camY, Pz = Infinity;
      const d = fogCellDirJS(x, y);
      if (!sky) { Px = camX + d[0] * L; Py = camY + d[1] * L; Pz = camZ + d[2] * L; }
      else { Px = d[0] * 64; Py = d[1] * 64; } // sky ceiling hash: direction-keyed
      _in.fg[0] = cb.fg[fi]; _in.fg[1] = cb.fg[fi + 1]; _in.fg[2] = cb.fg[fi + 2];
      _in.bg[0] = cb.bg[fi]; _in.bg[1] = cb.bg[fi + 1]; _in.bg[2] = cb.bg[fi + 2];
      underShade(_in.fg, _in.bg, cb.glyphIdx[i], L, Pz, Px, Py, 1, timeSec, U, _out);
      rt.setCellRGB(x, y, _out.glyph, clampB(_out.fg[0]), clampB(_out.fg[1]), clampB(_out.fg[2]), clampB(_out.bg[0]), clampB(_out.bg[1]), clampB(_out.bg[2]));
    }
  }
}

/**
 * WGSL twin of underShade (SWIM-04c; included by shade.wgsl.js after `su` / hashFastU / fogCellDir). Same order: fog, ceiling / bubble
 * swap, caustics. Differences by design (JS twin = oracle): nz = 1, caller supplies Px/Py/Pz exactly as underwaterPass does.
 * ShadeU words: under = (on, waterZ, fogM, causticK), underTint = (rgb, swapAt), underCam = (cam xyz, lightK), underCeil = ceil rgb,
 * underCaus = causticCol rgb, underRampB = bubble glyph indices, underRampC = ceil glyph indices (ascii - 32, exact in f32).
 */
export const UNDER_WGSL = `
struct UnderOut { fg: vec3f, bg: vec3f, glyph: i32 };
fn underFog(L: f32, fogM: f32) -> f32 { let s = min(1.0, L / fogM); return s * (2.0 - s); }
fn underShadeW(fg: vec3f, bg: vec3f, glyph: i32, L: f32, Pz: f32, Px: f32, Py: f32, t: f32) -> UnderOut {
  let f = underFog(L, su.under.z);
  let T = su.underTint.xyz; let k = su.underCam.w;
  let ceiling = Pz >= su.under.y - 0.02;
  var c = fg; var gl = glyph;
  if (ceiling) {
    c = su.underCeil.xyz;
    let hc = hashFastU(i32(floor(Px * 2.0)), i32(floor(Py * 2.0)), i32(floor(t * 2.0)));
    gl = i32(su.underRampC[hc & 3u]);
  }
  var o: UnderOut;
  o.fg = c + (T * k - c) * f;
  o.bg = bg + (T * 0.35 - bg) * f;
  if (!ceiling) {
    if (f >= su.underTint.w) {
      let lum = (0.299 * o.fg.x + 0.587 * o.fg.y + 0.114 * o.fg.z) / 255.0;
      let q = clamp(i32(floor(lum * 4.0)), 0, 3);
      gl = i32(su.underRampB[u32(q)]);
    }
    if (Pz < su.under.y && L < 10.0) { // nz > 0.6 always true (the JS twin passes nz = 1)
      let h = hashFastU(i32(floor(Px / 0.7)), i32(floor(Py / 0.7)), i32(floor(t * 3.0)));
      if (f32(h >> 8u) * (1.0 / 16777216.0) > 1.0 - su.under.w) {
        gl = select(94, 10, (h & 1u) != 0u); // '*' = 42 - 32, '~' = 126 - 32
        o.fg += su.underCaus.xyz * (1.0 - f);
      }
    }
  }
  o.glyph = gl;
  return o;
}
`;
