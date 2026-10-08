// @ts-check
// engine/core/wind.js - S8-B2-05: shared, fully deterministic wind field `windAt(x, z, t, opts)`.
// JS oracle of the WGSL twin `WIND_AT_WGSL` (engine/render/gpu/wgsl/common.wgsl.js): the two use the same expression order, so
// the shader (foliage sway, cloud shadows, later particles) and gameplay (arrows, smoke) read the same field.
//
// Field: a unit direction (dirDeg, degrees, 0 = +x, 90 = +z), a base speed and two travelling sine "gust" octaves (phase kept
// in turns and wrapped with fract so f32 stays accurate far from the origin). No RNG, no state.
//   mag  = speed * max(0, 1 + gust * (0.65 g1 + 0.35 g2)),  gust in 0..1  ->  mag in [0, 2 speed]
//   side = speed * gust * 0.25 * g2                         (small crosswind swirl)
//   out  = dir * mag + perp(dir) * side      (m/s, world x/z)
// Default options are all zero = no wind (out = 0).

/** @typedef {{dirDeg?: number, speed?: number, gust?: number}} WindOptions */
export const WIND_DEFAULT = Object.freeze({ dirDeg: 0, speed: 0, gust: 0 });

const TAU = 6.28318530718;
const fract = (/** @type {number} */ v) => v - Math.floor(v);

/**
 * Uniform values for the shader: [dirX, dirZ, speed, gust] (gust clamped to 0..1, speed to >= 0).
 * @param {WindOptions} [o] @param {number[]|Float32Array|Float64Array} [out] @returns {number[]|Float32Array|Float64Array}
 */
export function windParams(o, out = [0, 0, 0, 0]) {
  const a = ((o && o.dirDeg) || 0) * (Math.PI / 180);
  out[0] = Math.cos(a); out[1] = Math.sin(a);
  out[2] = Math.max(0, (o && o.speed) || 0);
  out[3] = Math.min(1, Math.max(0, (o && o.gust) || 0));
  return out;
}

const _p = [0, 0, 0, 0];
/**
 * Wind vector at world (x, z) and time t (seconds).
 * @param {number} x @param {number} z @param {number} t
 * @param {WindOptions} [o] @param {{x: number, z: number}} [out] @returns {{x: number, z: number}}
 */
export function windAt(x, z, t, o, out = { x: 0, z: 0 }) {
  return windAtParams(x, z, t, windParams(o, _p), out);
}

/** Same as `windAt` with pre-computed `windParams` (the per-sample path: no trig for the direction). */
export function windAtParams(x, z, t, p, out = { x: 0, z: 0 }) {
  const dirX = p[0], dirZ = p[1], speed = p[2], gust = p[3];
  const along = x * dirX + z * dirZ;
  const across = z * dirX - x * dirZ;
  const g1 = Math.sin(TAU * fract(along * 0.013 - t * 0.11));
  const g2 = Math.sin(TAU * fract(along * 0.041 + across * 0.023 - t * 0.27 + 0.37));
  const mag = speed * Math.max(0, 1 + gust * (0.65 * g1 + 0.35 * g2));
  const side = speed * gust * 0.25 * g2;
  out.x = dirX * mag - dirZ * side;
  out.z = dirZ * mag + dirX * side;
  return out;
}
