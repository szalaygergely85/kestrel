// engine/entities/EyeFeel.js (moved from game/js/entities/EyeFeel.js, US-024 Phase C).
//
// US-009 first-person "eye feel": step smoothing, landing dip, head bob.
// Pure functions over a plain state object - VISUAL ONLY, never touches
// collision or the entity's actual (x, y, z). Moves to
// engine/entities/EyeFeel.js unchanged in US-024 (architecture.md section 5,
// `EyeFeelState`/`createEyeFeel`/`updateEyeFeel`).
//
// `updateEyeFeel` reads exactly 5 fields off whatever "body" object is
// passed (Player today; any entity with the same shape later):
//   grounded, vx, vy, stepDelta, landed, fallDistance
// It does not import Level, Player, or anything from world/ - safe to unit
// test with a bare object literal (see game/js/entities/eyeFeel.test.js).
//
// Why no clamp against the sector is needed (architecture.md 7.1 / backlog
// US-009 tech notes): a step-down keeps the eye at its OLD absolute height
// (already proven clear by the entry rule) and decays from there; bob is
// <= headBobAmplitude (0.03) which is well under height - eyeHeight (0.10);
// the landing dip only ever lowers the eye. So `offset` can never push the
// eye through a ceiling, and `getEyeTransform()` stays world-free.

/** @returns {{stepOffset:number, dipT:number, dipAmount:number, bobPhase:number, offset:number}} */
export function createEyeFeel() {
  return { stepOffset: 0, dipT: 0, dipAmount: 0, bobPhase: 0, offset: 0 };
}

const TWO_PI = Math.PI * 2;

/**
 * Advance the eye-feel state by one fixed step. Writes `s.offset` (meters,
 * added to `z + eyeH` by the caller) and every other field in place - no
 * allocations, no return value.
 *
 * @param {{stepOffset:number, dipT:number, dipAmount:number, bobPhase:number, offset:number}} s
 * @param {number} dt seconds
 * @param {{grounded:boolean, vx:number, vy:number, stepDelta:number, landed:boolean, fallDistance:number}} body
 * @param {import('../physics/config.js').PHYSICS} cfg
 */
export function updateEyeFeel(s, dt, body, cfg) {
  // --- Step smoothing (AC1) ---------------------------------------------
  // Decay whatever residual offset carried in from an EARLIER step first,
  // then (if the floor jumped under us this step) fully cancel that jump:
  // z already moved by +stepDelta this step, and stepOffset becomes exactly
  // -stepDelta, so the eye's absolute height (z + offset) is unchanged on
  // THIS step ("no snapping") - the decay above only ever eats into a
  // residual left over from a previous step, never into the event that just
  // happened, which is what keeps a stair run's overlapping steps from
  // ever producing a visible same-step jump. Recovery back toward 0 (95%
  // in stepSmoothTime) then plays out over the following steps.
  s.stepOffset *= Math.exp(-3 * dt / cfg.stepSmoothTime);
  if (body.stepDelta !== 0) {
    s.stepOffset -= body.stepDelta; // subtract from the already-decayed residual, so back-to-back steps (fast stairs) stack instead of resetting
    const max = cfg.stepUpMax;
    if (s.stepOffset > max) s.stepOffset = max;
    else if (s.stepOffset < -max) s.stepOffset = -max;
  }

  // --- Landing dip (AC8) --------------------------------------------------
  if (body.landed) {
    const fall = body.fallDistance;
    s.dipAmount = fall > cfg.landDipBigFall ? cfg.landDipBigAmount
      : fall > cfg.landDipSmallFall ? cfg.landDipSmallAmount
      : 0;
    s.dipT = 0;
  }
  let dip = 0;
  if (s.dipAmount > 0) {
    s.dipT += dt;
    const down = cfg.landDipDownTime;
    const recover = cfg.landDipRecoverTime;
    let k;
    if (s.dipT < down) {
      k = s.dipT / down;
    } else {
      k = Math.max(0, 1 - (s.dipT - down) / recover);
    }
    dip = -s.dipAmount * k;
    if (k <= 0) { s.dipAmount = 0; s.dipT = 0; dip = 0; } // finished - clear so we stop paying for it
  }

  // --- Head bob (AC8) ------------------------------------------------------
  const speed = Math.hypot(body.vx, body.vy);
  const env = body.grounded ? Math.min(1, speed / cfg.walkSpeed) : 0;
  if (body.grounded) {
    s.bobPhase += speed * cfg.headBobCyclesPerMeter * TWO_PI * dt;
    if (s.bobPhase >= TWO_PI || s.bobPhase < 0) s.bobPhase -= Math.floor(s.bobPhase / TWO_PI) * TWO_PI; // wrap, never unbounded
  }
  const bob = cfg.headBobAmplitude * env * Math.sin(s.bobPhase);

  s.offset = s.stepOffset + dip + bob;
}
