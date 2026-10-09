// engine/render/cloudShadow.js (S8-B2-12c, docs/architecture.md 38.13): cloud shadows on the sun term, sourced from the
// look's cloud deck (sky.js `cloudValueNoise` + `cloudDriftOffset`), so ground shadows move with the visible clouds.
// Pure and allocation-free. `cloudShadeQ` is the JS twin of common.wgsl.js's CLOUD_SHADOW_WGSL (same op order).
import { cloudValueNoise } from './sky.js';
import { hashFast01 } from './terrainShade.js';

// cloudMul = 1 - q/255 with q = floor(strength * CLOUD_DARK * d * 255 + 0.5): strength 1 -> mul in [0.4, 1].
export const CLOUD_DARK = 0.6;

function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/**
 * Cloud darkening byte (0..153) at world point (x, y, z) for sun direction (sdx, sdy, sdz) (unit, toward the sun).
 * The point is projected along the sun ray to the cloud deck height `C.deckH`; `off` = drift (Float32Array(2)).
 * @param {{deckH:number, scale:number, cover:number, soft:number, strength:number, seed:number}} C
 * @param {ArrayLike<number>} off
 * @returns {number}
 */
export function cloudShadeQ(C, off, x, y, z, sdx, sdy, sdz) {
  cqP[0] = x; cqP[1] = y; cqP[2] = z; cqS[0] = sdx; cqS[1] = sdy; cqS[2] = sdz;
  return cloudShadeQP(C, off, cqP, cqS);
}
const cqP = new Float64Array(3), cqS = new Float64Array(3);

/**
 * LIGHT-ALLOC-01: allocation-free per-cell entry - P = world point (Float64Array(3)), sd = unit sun dir (any ArrayLike).
 * Same op order as `cloudShadeQ` (which wraps it); 6+ double args would be boxed per call by V8.
 */
export function cloudShadeQP(C, off, P, sd) {
  const x = P[0], y = P[1], z = P[2], sdx = sd[0], sdy = sd[1], sdz = sd[2];
  const t = (C.deckH - z) / Math.max(sdz, 0.2);
  const qx = (x + sdx * t) * C.scale + off[0];
  const qy = (y + sdy * t) * C.scale + off[1];
  const seed = C.seed;
  cnQ[0] = qx; cnQ[1] = qy; cnQ[2] = qx * 2.0 + 17.0; cnQ[3] = qy * 2.0 + 17.0;
  noiseS(seed, 0); noiseS(seed, 2);
  const n = cnQ[4] * 0.65 + cnQ[5] * 0.35;
  const a = C.cover, b = C.cover + C.soft;
  let tt = (n - a) / (b - a); // smoothstep, inlined (same op order)
  if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
  const d = tt * tt * (3 - 2 * tt);
  return Math.floor(C.strength * CLOUD_DARK * d * 255 + 0.5) | 0; // int (byte 0..153): no boxed double return
}
// Scratch-in/scratch-out twin of sky.js `cloudValueNoise` (same op order, bit-identical; asserted in cloudShadow.parity.test.js):
// reads (x,y) = cnQ[k], cnQ[k+1], writes cnQ[4 + k/2]. No double args/returns, so V8 never boxes per call.
const cnQ = new Float64Array(6);
function noiseS(seed, k) {
  const x = cnQ[k], y = cnQ[k + 1];
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v00 = hashFast01(ix & 255, iy & 255, seed);
  const v10 = hashFast01((ix + 1) & 255, iy & 255, seed);
  const v01 = hashFast01(ix & 255, (iy + 1) & 255, seed);
  const v11 = hashFast01((ix + 1) & 255, (iy + 1) & 255, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  cnQ[4 + (k >> 1)] = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v11 - v10 - v01 + v00) * sx * sy;
}

/** Test hook: the scratch noise path as a plain function (see cloudShadow.parity.test.js). */
export function cloudNoiseScratch(x, y, seed) { cnQ[0] = x; cnQ[1] = y; noiseS(seed, 0); return cnQ[4]; }

/** Sun multiplier for a cloud byte; q = 0 -> exactly 1. */
export function cloudMul(q) {
  return 1 - q * (1 / 255);
}

/**
 * Packs the two light-pass uniform vec4s: [offX, offY, scale, strength | cover, soft, deckH, seed]. C null -> all 0
 * (strength 0 = cloud shadows off). `timeSec` drives the drift via sky.js `cloudDriftOffset`'s formula (period 256).
 * @param {object|null} C @param {number} timeSec @param {Float32Array} out Float32Array(8)
 */
export function packCloudUniforms(C, timeSec, out) {
  if (!C) { out.fill(0); return out; }
  out[0] = (C.wind[0] * timeSec) % 256;
  out[1] = (C.wind[1] * timeSec) % 256;
  out[2] = C.scale; out[3] = C.strength;
  out[4] = C.cover; out[5] = C.soft; out[6] = C.deckH; out[7] = C.seed;
  return out;
}
