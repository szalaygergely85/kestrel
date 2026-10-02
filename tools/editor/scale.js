// tools/editor/scale.js - ED-SCALE-1c (docs/architecture.md 34.3). A small
// pure module (no DOM, no World, no doc) for the scale-step maths the
// Minus/Equal keys, the Scale drag tool and the panel's Scale row all share
// - Node-tested (scale.test.mjs). Same "small pure module" split as
// ray.js/commands.js.
//
// Imports only engine/index.js (the editor boundary rule). MIN/MAX are the
// SAME constants World.load/the validator enforce at runtime (34.1) -
// defined once in engine/world/World.js, never redefined here.
import { PROP_SCALE_MIN, PROP_SCALE_MAX } from '../../engine/index.js';

/** The Minus/Equal ladder (34.3): includes 1 (unscaled) and both MIN/MAX ends. */
export const SCALE_STEPS = [0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];

/** Clamp to [PROP_SCALE_MIN, PROP_SCALE_MAX], rounded to 0.01 (34.1: "stored rounded to 0.01"). */
export function clampScale(v) {
  const c = Math.max(PROP_SCALE_MIN, Math.min(PROP_SCALE_MAX, v));
  return Math.round(c * 100) / 100;
}

/**
 * Next ladder value strictly above (`dir > 0`) or below (`dir < 0`) `cur` -
 * works for an off-ladder `cur` (e.g. after a fine step or a drag), by
 * returning the first/last ladder entry past it. Saturates at the ladder's
 * own ends (never throws, never returns `undefined`).
 */
export function nextScale(cur, dir) {
  if (dir > 0) {
    for (const s of SCALE_STEPS) if (s > cur) return s;
    return SCALE_STEPS[SCALE_STEPS.length - 1];
  }
  for (let i = SCALE_STEPS.length - 1; i >= 0; i--) if (SCALE_STEPS[i] < cur) return SCALE_STEPS[i];
  return SCALE_STEPS[0];
}

/** Fine +-0.05 step (Shift+Minus/Equal). Not itself clamped/rounded - the caller runs the result through `clampScale`. */
export function fineScale(cur, dir) {
  return cur + dir * 0.05;
}
