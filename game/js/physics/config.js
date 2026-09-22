// game/js/physics/config.js
//
// Single tuning object for player physics (US-008 acceptance criterion:
// "All values in one tuning config object"). Values are the GDD section 5
// M1 baseline (docs/game-design.md) and the matching US-008/US-009 backlog
// acceptance criteria. Nothing in physics/ or entities/Player.js hard-codes
// a tuning number outside this file.

export const PHYSICS = {
  // Fixed simulation step (GDD section 5).
  fixedDt: 1 / 60,

  // Capsule (US-008 AC1).
  radius: 0.30,     // m
  height: 1.70,     // m (feet to head)
  eyeHeight: 1.60,  // m, default/standing eye height above the feet

  // Ground movement (US-008 AC2, GDD section 5).
  walkSpeed: 3.5,     // m/s
  runSpeed: 6.0,      // m/s
  accelTime: 0.10,    // s to reach full (walk or run) speed from 0
  decelTime: 0.08,    // s to stop from full speed
  airControl: 0.35,   // fraction of ground accel/decel while airborne (US-009 AC3)

  // Vertical (US-008 AC4, US-009 AC2/AC5).
  gravity: 20,          // m/s^2
  jumpSpeed: 6.5,       // m/s initial jump velocity (apex about 1.05 m)
  coyoteTime: 0.10,     // s after leaving the ground jump still works
  jumpBufferTime: 0.10, // s a jump press is remembered before landing

  // Step-up / terrain following (US-008 AC3, US-009 AC1/AC7).
  // A grounded cell-to-cell floor DIFFERENCE (up OR down) of up to this
  // many meters is walked smoothly (stairs); more than this blocks
  // horizontal movement into a higher floor, or drops the player into a
  // fall off a ledge. See capsule.js `isSectorPassable` / Player.js.
  stepUpMax: 0.45,          // m
  stepSmoothTime: 0.10,     // s - visual-only smoothing of the eye height across a step (US-009)

  // Landing feel (US-009 AC5).
  landDipSmallFall: 0.5,  // m - falls beyond this trigger the small dip
  landDipSmallAmount: 0.08, // m
  landDipBigFall: 2.0,    // m - falls beyond this trigger the big dip
  landDipBigAmount: 0.15, // m
  landDipRecoverTime: 0.2, // s

  // Head bob while walking (US-009 AC5).
  headBobAmplitude: 0.03, // m
  headBobCyclesPerMeter: 2, // "2 cycles per meter-ish" per the GDD
};
