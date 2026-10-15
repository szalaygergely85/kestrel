// engine/render/lightShaft.js - CANOPY-SHAFT-01a (docs/architecture.md 38.76, D-107.5).
// Sun shafts through the canopy: a shadow-map march per cell (light pass, result in LIGHT.w bits 20..23) and a colour
// lift (shade). Pure module: `shaftLitQ` / `shaftLift` are the ORACLE (D-107: the Canvas2D path never marches);
// LIGHT_SHAFT_WGSL / SHADE_SHAFT_WGSL are the text 01b pastes into light/shade and probes with compileFn. High/ultra only.
// Imports only skyGlow.js (SKY_GLOW.tint = the AUD-45 in-scatter colour, 0..255). 0 allocation per call.
import { SKY_GLOW } from './skyGlow.js';

export const SHAFT_SHIFT = 20;
export const SHAFT_Q = 15;
export const SHAFT_MASK = SHAFT_Q << SHAFT_SHIFT; // 0x00F00000
/** Steps per preset (38.76 item 2); low/medium 0 = skipped, bits stay 0 -> byte-identical to today. */
export const SHAFT_STEPS = Object.freeze({ low: 0, medium: 0, high: 6, ultra: 10 });
/** 38.76 item 4 defaults; `k` (strength) comes from the biome atmos state, 0 = off. */
export const SHAFT_DEFAULTS = Object.freeze({ k: 0, iso: 0.25, pw: 4, maxM: 28 });

/** @param {string} preset @returns {number} steps (0 for unknown presets) */
export function shaftStepsFor(preset) { return SHAFT_STEPS[preset] | 0; }

/** Writes q (0..15) into LIGHT.w bits 20..23 without touching any other bit. */
export function shaftPack(w, q) { return ((w & ~SHAFT_MASK) | ((q & SHAFT_Q) << SHAFT_SHIFT)) >>> 0; }
export function shaftUnpack(w) { return (w >>> SHAFT_SHIFT) & SHAFT_Q; }

/** Interleaved gradient noise from the cell (no time term: stable, deterministic). */
export function shaftIgn(col, row) {
  const a = 0.06711056 * col + 0.00583715 * row;
  const b = 52.9829189 * (a - Math.floor(a));
  return b - Math.floor(b);
}

/**
 * March the sun shadow map along a view ray. `map` = {W, zbuf} (NDC z, as sunShadowTaps), `M` = shadowSunMatrix().M,
 * `opts` = {res, biasM}. `eye`/`dir` world (dir unit), `len` = min(dist, maxM). Samples t_k = (k + ign) / steps * len,
 * one NEAREST texel compare each; receivers outside the box/map count as lit. Returns 0..15 (round(lit / steps * 15)).
 * steps <= 0, or a sun at/below the horizon, returns 0 (no shaft).
 */
export function shaftLitQ(map, M, opts, eye, dir, len, steps, col, row) {
  if (steps <= 0) return 0;
  const fl = Math.hypot(M[2], M[6], M[10]) || 1;
  const sx = -M[2] / fl, sy = -M[6] / fl, sz = -M[10] / fl; // toward the sun
  if (sz <= 0) return 0;
  const j = shaftIgn(col, row), res = opts.res, W = map.W, zb = map.zbuf;
  let lit = 0;
  for (let k = 0; k < steps; k++) {
    const t = (k + j) / steps * len;
    const px = eye[0] + dir[0] * t + sx * opts.biasM, py = eye[1] + dir[1] * t + sy * opts.biasM, pz = eye[2] + dir[2] * t + sz * opts.biasM;
    const cx = M[0] * px + M[4] * py + M[8] * pz + M[12];
    const cy = M[1] * px + M[5] * py + M[9] * pz + M[13];
    const cz = M[2] * px + M[6] * py + M[10] * pz + M[14];
    const su = (cx + 1) * 0.5, sv = (cy + 1) * 0.5;
    if (su < 0 || su >= 1 || sv < 0 || sv >= 1 || cz < -1 || cz > 1) { lit++; continue; }
    const tx = Math.floor(su * res), ty = Math.floor(sv * res);
    if (tx >= W || ty >= W || cz <= zb[ty * W + tx]) lit++;
  }
  return Math.floor(lit * SHAFT_Q / steps + 0.5);
}

/** Lift weight 0..1 (38.76 item 3). `f` = fog amount at the cell. Returns 0 when off (k, q or sunI 0). */
export function shaftW(q, len, cosSun, sunI, A, f) {
  if (q <= 0 || A.k <= 0 || sunI <= 0) return 0;
  const lenF = Math.min(len, A.maxM) / A.maxM;
  const c = cosSun > 0 ? cosSun : 0;
  const phase = A.iso + (1 - A.iso) * Math.pow(c, A.pw);
  return A.k * phase * (q / SHAFT_Q) * lenF * (1 - f);
}

/**
 * Colour lift toward the sun tint (fg/bg 0..255 triples): bg += (T*sunI - bg) * w, fg += (T*sunI - fg) * w * 0.5.
 * Writes `out` = {fg:[3], bg:[3]}; q = 0 / k = 0 / sunI = 0 copies the input bit-for-bit.
 */
export function shaftLift(fg, bg, q, len, cosSun, sunI, A, out, f = 0) {
  const w = shaftW(q, len, cosSun, sunI, A, f), T = SKY_GLOW.tint;
  for (let i = 0; i < 3; i++) {
    if (w === 0) { out.fg[i] = fg[i]; out.bg[i] = bg[i]; continue; }
    const t = T[i] * sunI;
    out.bg[i] = bg[i] + (t - bg[i]) * w;
    out.fg[i] = fg[i] + (t - fg[i]) * w * 0.5;
  }
  return out;
}

const n = (x) => { const s = String(x); return /[.e]/.test(s) ? s : s + '.0'; };

/**
 * Light-pass march (scalar form so compileFn can evaluate it). Uniforms used: `u.sunShadowM` (mat4), `u.sunShadowRes`,
 * `u.sunShadowBiasM`, `u.sunDir`, `uSunShadow` (depth stored 0.75 + 0.25 * ndcZ, 38.5 item 6). 01b calls it before the kind-0 early return.
 */
export const LIGHT_SHAFT_WGSL = `
fn shaftIgn(col: i32, row: i32) -> f32 {
  let a = 0.06711056 * f32(col) + 0.00583715 * f32(row);
  let b = 52.9829189 * (a - floor(a));
  return b - floor(b);
}
fn shaftLitQ(ex: f32, ey: f32, ez: f32, dx: f32, dy: f32, dz: f32, len: f32, steps: i32, col: i32, row: i32) -> i32 {
  if (steps <= 0) { return 0; }
  if (u.sunDir.z <= 0.0) { return 0; }
  let j = shaftIgn(col, row);
  let res = i32(u.sunShadowRes);
  var lit = 0;
  for (var k = 0; k < steps; k++) {
    let t = (f32(k) + j) / f32(steps) * len;
    let px = ex + dx * t + u.sunDir.x * u.sunShadowBiasM;
    let py = ey + dy * t + u.sunDir.y * u.sunShadowBiasM;
    let pz = ez + dz * t + u.sunDir.z * u.sunShadowBiasM;
    let cx = u.sunShadowM[0].x * px + u.sunShadowM[1].x * py + u.sunShadowM[2].x * pz + u.sunShadowM[3].x;
    let cy = u.sunShadowM[0].y * px + u.sunShadowM[1].y * py + u.sunShadowM[2].y * pz + u.sunShadowM[3].y;
    let cz = u.sunShadowM[0].z * px + u.sunShadowM[1].z * py + u.sunShadowM[2].z * pz + u.sunShadowM[3].z;
    let su = (cx + 1.0) * 0.5; let sv = (cy + 1.0) * 0.5;
    if (su < 0.0 || su >= 1.0 || sv < 0.0 || sv >= 1.0 || cz < -1.0 || cz > 1.0) { lit++; continue; }
    let tx = i32(floor(su * u.sunShadowRes)); let ty = i32(floor(sv * u.sunShadowRes));
    if (tx >= res || ty >= res) { lit++; continue; }
    if (0.75 + 0.25 * cz <= textureLoad(uSunShadow, vec2i(tx, ty), 0)) { lit++; }
  }
  return i32(floor(f32(lit) * ${n(SHAFT_Q)} / f32(steps) + 0.5));
}
`;

/** Shade-side weight; 01b adds the two colour lines (bg/fg lerp toward FOG_SUN_TINT * sunI). */
export const SHADE_SHAFT_WGSL = `
fn shaftW(q: i32, len: f32, cosSun: f32, sunI: f32, k: f32, iso: f32, pw: f32, maxM: f32, f: f32) -> f32 {
  if (q <= 0 || k <= 0.0 || sunI <= 0.0) { return 0.0; }
  let lenF = min(len, maxM) / maxM;
  let phase = iso + (1.0 - iso) * pow(max(cosSun, 0.0), pw);
  return k * phase * (f32(q) / ${n(SHAFT_Q)}) * lenF * (1.0 - f);
}
`;
