// engine/render/horizonAo.js (S8-B2-20, docs/architecture.md 38.17).
// Horizon AO light-pass term: a screen-space ambient-occlusion factor from 4 depth taps, multiplying ONLY the
// ambient share of L. Pure module (no imports) so both HORIZON_AO_WGSL (gpu/wgsl/common.wgsl.js) and the JS twin
// (lighting.js lightSurfaces) interpolate/call these exact expressions - strength 0 stays bit-identical and the
// term never brightens (amb >= 0, (1 - aoF) in [0, 0.6]).

export const AO_TAP_CELLS = 2; // integer cell offset - no f32/f64 rounding coin flip (38.17)
export const AO_RADIUS_M = 1.5;
export const AO_BIAS = 0.1;
export const AO_MAX = 0.6;

/**
 * Per-tap occlusion contribution. `n*` = receiver's unit surface normal, `v*` = Pt - P (tap point minus receiver
 * point, world metres). Literal twin of HORIZON_AO_WGSL's `aoTapOcc(N: vec3f, v: vec3f) -> f32`.
 * - d2 < 1e-8 (coincident) or d2 >= AO_RADIUS_M^2 (silhouette) -> 0.
 * - otherwise c = dot(N,v)/d - AO_BIAS; in-plane/behind-surface taps give c <= 0 -> 0.
 */
export function aoTapOcc(nx, ny, nz, vx, vy, vz) {
  const d2 = vx * vx + vy * vy + vz * vz;
  if (d2 < 1e-8 || d2 >= AO_RADIUS_M * AO_RADIUS_M) return 0;
  const d = Math.sqrt(d2);
  const c = (nx * vx + ny * vy + nz * vz) / d - AO_BIAS;
  return c > 0 ? c * (1 - d / AO_RADIUS_M) : 0;
}

/**
 * `occSum` = (t0 + t1 + t2 + t3) * 0.25 (fixed divisor - open taps dilute, not renormalise). Returns the ambient
 * multiplier `aoF` in [1 - strength * AO_MAX, 1] (so [0.4, 1] at strength 1): never brightens, since
 * `strength * AO_MAX * occSum` is always subtracted from 1, never added.
 */
export function aoFactor(occSum, strength) {
  return 1 - strength * AO_MAX * occSum;
}
