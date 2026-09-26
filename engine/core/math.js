// engine/core/math.js (US-050, docs/backlog.md "PC-B QUEUE 3" item 9).
//
// Internal helper module - NOT re-exported from engine/index.js or
// engine/dev.js. Several engine files hand-rolled the exact same tiny
// numeric helpers (`clamp`, `clamp01`, `clampByte`, `approach`); this module
// is their single canonical home so the logic lives in one place. Import it
// directly, e.g. `import { clamp01 } from '../core/math.js';` - it is a
// plain internal module like any other under engine/, just not part of the
// public API surface.
//
// Pure dedup: every implementation here is byte-for-byte the same as the
// local copies it replaces (same clamping edge cases, same rounding) - see
// the US-050 backlog note for which files had which copy.

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Clamp `t` into `[0, 1]`. */
export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Round to the nearest integer and clamp into `[0, 255]` (an RGB byte). */
export function clampByte(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Move `value` toward `target` by at most `maxDelta` (sign-aware) - a
 * constant-rate ramp, so a constant `rate` produces an exact "time to reach
 * target" of target/rate seconds when starting from (or going to) 0. */
export function approach(value, target, maxDelta) {
  const diff = target - value;
  if (Math.abs(diff) <= maxDelta || maxDelta <= 0) return target;
  return value + Math.sign(diff) * maxDelta;
}
