// game/js/quest/swordConfig.js (US-078d, docs/architecture.md 30.1 + "30.1 amendment (D-034)" - the amendment's
// "Numbers live in data" paragraph is normative for the frozen object below). Pure data: every step count here
// IS a 60 Hz step count already (not seconds - unlike beastConfig.js's toSteps convention, the amendment's table
// gives step counts directly), plus the 7-slice melee arc geometry (reach, z band, 100 deg horizontal cone).
//
// Outside `sim/**`, so trig is allowed (module-load time only, to precompute the arc's unit boundary vectors);
// nothing in this file runs per sim step, and `sim/sword.js` itself never calls sin/cos (rule 15).
import { DEG2RAD } from '../../../engine/index.js';

/** @type {Readonly<Record<string, any>>} */
export const SWORD_CFG = Object.freeze({
  holdSteps: 24,      // 0.4 s: hold -> charge once `holdSteps` reaches this
  chainStart: 16,      // steps into light #1's recover before a queued press may start light #2 / hold
  rest: 15,            // steps of rest after light #2 ends
  hitStop: 3,          // steps frozen on a world (wall/terrain) hit - jumps the swing to recover
  hitStopHard: 4,       // steps frozen on a hard entity hit (freeze only - the swing continues)
  flash: 6,            // practiceTarget's flash clip length (steps) - also the model's own onHit.steps

  // Shared melee arc geometry (original 30.1 bullet list; not superseded by the amendment).
  reach: 1.6,          // m, apex (eye) to the cylinder's near surface
  zBandLow: -1.0,       // m below eye: arc z band low (zMin = eye.z + zBandLow)
  zBandHigh: 0.3,       // m above eye: arc z band high (zMax = eye.z + zBandHigh)
  arcDeg: 100,          // total horizontal cone (wedge), split into `slices` equal slices
  slices: 7,

  light: Object.freeze({ windup: 5, active: 7, recover: 9, damage: 1, reach: 1.6, speed: 0.6 }),
  hard: Object.freeze({ windup: 4, active: 7, recover: 27, damageMul: 3, reach: 1.6, speed: 0.3, mana: 4, knock: 3 }),
});

/**
 * 8 unit boundary vectors (left -> right), 2 doubles each (lx, ly), for the `slices`-slice `arcDeg` horizontal
 * cone, in a LOCAL frame where ly = the forward component and lx = the right component: world = lx*right +
 * ly*forward, with right = (-fy, fx) for a unit forward (fx, fy) (same convention as `engine/core/transform.js`'s
 * `forwardOf`: forward = (sin yaw, -cos yaw), right = (cos yaw, sin yaw) = (-fy, fx) when fx=sinYaw, fy=-cosYaw).
 * `sword.js` rotates only the TWO edges of the active slice per step (`sliceIdx*2` .. `sliceIdx*2+3`), not all 8.
 * Precomputed once at module load (trig here is fine - this file is outside sim/**).
 */
export const ARC_BOUNDS = (() => {
  const n = SWORD_CFG.slices;
  const half = SWORD_CFG.arcDeg / 2;
  const out = new Float64Array((n + 1) * 2);
  for (let k = 0; k <= n; k++) {
    const deg = -half + k * (SWORD_CFG.arcDeg / n);
    const rad = deg * DEG2RAD;
    out[k * 2] = Math.sin(rad);
    out[k * 2 + 1] = Math.cos(rad);
  }
  return out;
})();
