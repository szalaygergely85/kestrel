// game/js/quest/sim/shield.js (EQ-06, architecture 38.41). Shield raise/lower state + the block predicate.
// Rule 15: no Math.random, no trig, no wall clock; integer state, zero alloc in step().
// Raise = 7 steps (0.12 s), lower = 9 steps (0.15 s). One integer `r` in 0..63 (63 = 7*9): raise adds 9, lower subtracts 7.
export const SHIELD_DEFAULTS = Object.freeze({
  raiseSteps: 7,
  lowerSteps: 9,
  speedScale: 0.6,        // walk multiplier while raised or raising
  blockCos: 0.5,          // cos 60 deg: source within +-60 deg of the look direction
  blockKnockSpeed: 5.5,   // m/s along the hit direction (ground decel makes this ~0.3 m of slide)
});

export function createShieldSim(cfg = SHIELD_DEFAULTS) {
  const FULL = cfg.raiseSteps * cfg.lowerSteps;
  const UP = cfg.lowerSteps, DOWN = cfg.raiseSteps;
  let r = 0;
  let wantUp = false;
  const sim = {
    raised: false,     // raising, fully up, or lowering-but-not-down: the caller passes down=false to the sword
    raiseFrac: 0,      // 0..1 for the view
    blocking: false,   // fully raised and still held
    speedScale: 1,
    blockTick: -1,     // set by vitals on a blocked hit
    fx: 1, fy: 0,      // look direction (unit), updated each step
    /** @param {boolean} down RMB held @param {boolean} has off slot holds a shield */
    step(down, has, fx, fy) {
      wantUp = !!(down && has);
      if (wantUp) { r += UP; if (r > FULL) r = FULL; } else { r -= DOWN; if (r < 0) r = 0; }
      sim.fx = fx; sim.fy = fy;
      sim.raised = r > 0;
      sim.raiseFrac = r / FULL;
      sim.blocking = r === FULL && wantUp;
      sim.speedScale = r > 0 ? cfg.speedScale : 1;
    },
    /** True when a source direction (dirX,dirY = player minus source) is inside the frontal arc. */
    covers(dirX, dirY) { return -(dirX * sim.fx + dirY * sim.fy) >= cfg.blockCos; },
    reset() { r = 0; wantUp = false; sim.raised = false; sim.raiseFrac = 0; sim.blocking = false; sim.speedScale = 1; },
    hashInto(h) { h.i32(r); },
  };
  return sim;
}
