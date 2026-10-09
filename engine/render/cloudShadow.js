// engine/render/cloudShadow.js (S8-B2-12c, docs/architecture.md 38.13): cloud shadows on the sun term, sourced from the
// look's cloud deck (sky.js `cloudValueNoise` + `cloudDriftOffset`), so ground shadows move with the visible clouds.
// Pure and allocation-free. `cloudShadeQ` is the JS twin of common.wgsl.js's CLOUD_SHADOW_WGSL (same op order).
import { cloudValueNoise } from './sky.js';

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
  const t = (C.deckH - z) / Math.max(sdz, 0.2);
  const qx = (x + sdx * t) * C.scale + off[0];
  const qy = (y + sdy * t) * C.scale + off[1];
  const seed = C.seed;
  const n = cloudValueNoise(qx, qy, seed) * 0.65 + cloudValueNoise(qx * 2.0 + 17.0, qy * 2.0 + 17.0, seed) * 0.35;
  const d = smoothstep(C.cover, C.cover + C.soft, n);
  return Math.floor(C.strength * CLOUD_DARK * d * 255 + 0.5);
}

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
