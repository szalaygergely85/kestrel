// Stub surface only (US-024, owner request 2026-09-23 - see
// docs/architecture.md section 10.1). Real implementation: US-011 (clip
// compilation, `components.sprite` stepping, the event ring) and US-025 (the
// World it steps against).
//
// @typedef {Object} AnimClip
// @property {Float32Array} durMs
// @property {boolean} loop
// @property {Int16Array} tagCodes  -1 = no tag on that frame

/**
 * Advances every entity's `components.sprite` by `dtMs` (fixed 60 Hz step,
 * after movement - architecture.md section 10.1). Allocation-free once real.
 * @param {import('../world/World.js').World} world
 * @param {number} dtMs
 */
export function stepAnimations(world, dtMs) {
  throw new Error('stepAnimations: not implemented (US-011)');
}
