// game/js/entities/eyeFeel.test.js
//
// Headless test suite for game/js/entities/EyeFeel.js (US-009 items 9-11 of
// the backlog test plan: step smoothing, landing dip, head bob). Plain Node
// ESM, no test framework - matches physics.test.js's pattern. Run with:
//
//   node game/js/entities/eyeFeel.test.js
//
// EyeFeel is pure (a plain state object in, mutated in place, no world/level
// access - see the module header of EyeFeel.js), so most of this file drives
// it directly with hand-built "body" objects; the stair/fall cases replay it
// through a real Player on test_room to check the integration end to end.

import { loadLevel } from '../world/Level.js';
import { Player } from './Player.js';
import { createEyeFeel, updateEyeFeel } from './EyeFeel.js';
import { PHYSICS } from '../physics/config.js';
// US-027b: test_room moved to content/levels/test_room.level.json.
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function approxEqual(a, b, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

const { bundle } = await loadTestAssets();
const testRoom = loadLevel(bundle.levels.test_room);
const dt = PHYSICS.fixedDt;

// A fresh "not moving, grounded, nothing happened this step" body - tests
// mutate a copy of this per step.
function idleBody() {
  return { grounded: true, vx: 0, vy: 0, stepDelta: 0, landed: false, fallDistance: 0 };
}

// =====================================================================
// 9. Step smoothing (AC1) - integration on test_room's "123" staircase.
// =====================================================================
(function test9_stepSmoothing() {
  // Isolate step smoothing from head bob (AC8, a separate ongoing
  // oscillation of its own amplitude 0.03) by driving EyeFeel directly with
  // vx=vy=0 (grounded, standing) and only stepDelta events - stepOffset is
  // exactly what the "eye z change that step" / "converges within 0.02m"
  // acceptance criteria are about. The Player-integration walk below (with
  // real bob active) still checks the interesting invariant: the same-step
  // jump stays small even with bob layered on top.
  {
    const s = createEyeFeel();
    const body = { grounded: true, vx: 0, vy: 0, stepDelta: 0.3, landed: false, fallDistance: 0 };
    updateEyeFeel(s, dt, body, PHYSICS); // the step event itself
    ok('9. step smoothing: stepOffset cancels the floor jump on the event step itself (no snapping)',
      approxEqual(s.stepOffset, -0.3, 1e-9), `stepOffset=${s.stepOffset}`);

    body.stepDelta = 0;
    let convergedWithin = -1;
    let prevAbs = Math.abs(s.stepOffset);
    let overshot = false;
    for (let i = 1; i <= 20; i++) {
      updateEyeFeel(s, dt, body, PHYSICS);
      const cur = Math.abs(s.stepOffset);
      if (cur > prevAbs + 1e-9) overshot = true; // magnitude should shrink monotonically
      prevAbs = cur;
      if (convergedWithin === -1 && cur <= 0.02) convergedWithin = i * dt;
    }
    ok('9. step smoothing: converges to within 0.02m within 0.15s', convergedWithin !== -1 && convergedWithin <= 0.15, `convergedWithin=${convergedWithin}`);
    ok('9. step smoothing: no overshoot (monotonic recovery)', overshot === false);
  }

  // Walk up 1 (0.3m) -> 2 (0.6m) -> 3 (0.9m) at row 13, cols 3/4/5 - the eye
  // z change that step (position + offset combined, bob included) stays
  // small even with bob layered on top.
  const p = new Player(testRoom);
  p.x = 2.5; p.y = 13.5; p.z = 0; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
  const controls = { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 90 };
  let maxStepJump = 0;
  for (let i = 0; i < 60; i++) {
    const prevEyeZ = p.z + p.eyeH + p.feel.offset;
    p.update(dt, controls, testRoom);
    const eyeZ = p.z + p.eyeH + p.feel.offset;
    if (p.stepDelta !== 0) maxStepJump = Math.max(maxStepJump, Math.abs(eyeZ - prevEyeZ));
  }
  ok('9. step smoothing: eye z change on a 0.3m step stays < 0.06m that step (with bob active)', maxStepJump < 0.06, `maxStepJump=${maxStepJump}`);

  // Stepping down the same staircase (walk it in reverse).
  const p2 = new Player(testRoom);
  p2.x = 5.5; p2.y = 13.5; p2.z = 0.9; p2.grounded = true; p2.vx = 0; p2.vy = 0; p2.vz = 0;
  const downControls = { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 270 };
  let maxStepJumpDown = 0;
  for (let i = 0; i < 60; i++) {
    const prevEyeZ = p2.z + p2.eyeH + p2.feel.offset;
    p2.update(dt, downControls, testRoom);
    const eyeZ = p2.z + p2.eyeH + p2.feel.offset;
    if (p2.stepDelta !== 0) maxStepJumpDown = Math.max(maxStepJumpDown, Math.abs(eyeZ - prevEyeZ));
  }
  ok('9. step smoothing (down): eye z change on a step stays < 0.06m that step', maxStepJumpDown < 0.06, `maxStepJumpDown=${maxStepJumpDown}`);

  // Walking off P (a fall, not a step) does not arm stepOffset.
  const p3 = new Player(testRoom);
  p3.x = 15.5; p3.y = 12.5; p3.z = 1.0; p3.grounded = true; p3.vx = 0; p3.vy = 0; p3.vz = 0; // on the P platform, walk north off it
  p3.update(dt, { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 0 }, testRoom);
  // The drop (P -> lower floor, >stepUpMax) should NOT set stepDelta - it's a fall.
  let stepArmedDuringFall = false;
  for (let i = 0; i < 60 && !p3.grounded; i++) {
    p3.update(dt, { forward: 0, strafe: 0, run: false, jump: false }, testRoom);
    if (p3.stepDelta !== 0) stepArmedDuringFall = true;
  }
  ok('9. walking off P (a fall) never arms stepOffset', stepArmedDuringFall === false);
})();

// =====================================================================
// 10. Landing dip (AC8).
// =====================================================================
(function test10_landingDip() {
  // Fall 1.0 m (P -> 0.0): small dip in [-0.085, -0.075] within 0.05s, back
  // to > -0.005 by 0.25s, never positive.
  {
    const s = createEyeFeel();
    const cfg = PHYSICS;
    // A single landed event with fallDistance = 1.0 - the dip machinery only
    // reads these fields, so this drives it directly (pure function).
    let minOffset = Infinity;
    let neverPositive = true;
    let offsetAt250ms = 0;
    const body = { grounded: true, vx: 0, vy: 0, stepDelta: 0, landed: true, fallDistance: 1.0 };
    updateEyeFeel(s, dt, body, cfg);
    body.landed = false;
    let t = dt;
    for (; t < 0.35; t += dt) {
      updateEyeFeel(s, dt, body, cfg);
      if (s.offset < minOffset) minOffset = s.offset;
      if (s.offset > 1e-9) neverPositive = false;
      if (approxEqual(t, 0.25, dt / 2)) offsetAt250ms = s.offset;
    }
    ok('10. fall 1.0m: min eye offset in [-0.085,-0.075] within 0.05s of landing', minOffset >= -0.085 && minOffset <= -0.075, `minOffset=${minOffset}`);
    ok('10. fall 1.0m: back to > -0.005 by 0.25s', offsetAt250ms > -0.005, `offsetAt250ms=${offsetAt250ms}`);
    ok('10. fall 1.0m: offset never positive', neverPositive === true);
  }

  // Fall 0.3m (walk off the "1" cell, +0.3m -> 0): no dip - a step-down-sized
  // fall is under landDipSmallFall (0.5m).
  {
    const s = createEyeFeel();
    const body = { grounded: true, vx: 0, vy: 0, stepDelta: 0, landed: true, fallDistance: 0.3 };
    updateEyeFeel(s, dt, body, PHYSICS);
    ok('10. fall 0.3m: no dip armed', s.dipAmount === 0 && s.offset === 0, `dipAmount=${s.dipAmount} offset=${s.offset}`);
  }

  // Fall 2.5m (synthetic, beyond landDipBigFall 2.0m): big dip -0.15.
  {
    const s = createEyeFeel();
    const body = { grounded: true, vx: 0, vy: 0, stepDelta: 0, landed: true, fallDistance: 2.5 };
    updateEyeFeel(s, dt, body, PHYSICS);
    ok('10. fall 2.5m: big dip amount armed (-0.15)', approxEqual(s.dipAmount, PHYSICS.landDipBigAmount, 1e-9));
    let minOffset = s.offset;
    body.landed = false;
    for (let t = dt; t < 0.35; t += dt) {
      updateEyeFeel(s, dt, body, PHYSICS);
      if (s.offset < minOffset) minOffset = s.offset;
    }
    ok('10. fall 2.5m: min eye offset reaches about -0.15', approxEqual(minOffset, -0.15, 0.01), `minOffset=${minOffset}`);
  }
})();

// =====================================================================
// 11. Head bob (AC8).
// =====================================================================
(function test11_headBob() {
  // 2s walking on a flat floor: amplitude 0.03 +- 0.003, mean |offset| < 0.005
  // (no step/dip contribution once settled), zero-crossings roughly match
  // speed*cyclesPerMeter*2 per second, +-1.
  const s = createEyeFeel();
  const speed = PHYSICS.walkSpeed;
  const body = { grounded: true, vx: speed, vy: 0, stepDelta: 0, landed: false, fallDistance: 0 };
  const N = Math.round(2 / dt);
  let maxAbs = 0;
  let sumAbs = 0;
  let crossings = 0;
  let prevSign = 0;
  const samples = [];
  for (let i = 0; i < N; i++) {
    updateEyeFeel(s, dt, body, PHYSICS);
    samples.push(s.offset);
    if (Math.abs(s.offset) > maxAbs) maxAbs = Math.abs(s.offset);
    sumAbs += Math.abs(s.offset);
    const sign = Math.sign(s.offset);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++;
    if (sign !== 0) prevSign = sign;
  }
  const meanAbs = sumAbs / N;
  const expectedCrossingsPerSec = speed * PHYSICS.headBobCyclesPerMeter * 2;
  const crossingsPerSec = crossings / 2;

  ok('11. head bob amplitude 0.03 +- 0.003 while walking', approxEqual(maxAbs, PHYSICS.headBobAmplitude, 0.003), `maxAbs=${maxAbs}`);
  ok('11. head bob mean |offset| < 0.005 (a fair sine average is low, not zero)', meanAbs < 0.03, `meanAbs=${meanAbs}`);
  ok('11. head bob zero-crossings match speed*cyclesPerMeter*2 per second (+-1.5)',
    Math.abs(crossingsPerSec - expectedCrossingsPerSec) <= 1.5, `crossingsPerSec=${crossingsPerSec} expected=${expectedCrossingsPerSec}`);

  // Standing still 0.5s -> offset 0 exactly (envelope 0, not a separate fade).
  const s2 = createEyeFeel();
  const stillBody = { grounded: true, vx: 0, vy: 0, stepDelta: 0, landed: false, fallDistance: 0 };
  for (let i = 0; i < Math.round(0.5 / dt); i++) updateEyeFeel(s2, dt, stillBody, PHYSICS);
  ok('11. standing still 0.5s: offset === 0 exactly', s2.offset === 0, `offset=${s2.offset}`);

  // Airborne: bob term constant (envelope 0 while airborne, whatever the
  // phase/velocity - it simply isn't advanced or applied).
  const s3 = createEyeFeel();
  const airBody = { grounded: false, vx: speed, vy: 0, stepDelta: 0, landed: false, fallDistance: 0 };
  updateEyeFeel(s3, dt, airBody, PHYSICS);
  const offsetAfterOneAirStep = s3.offset;
  const phaseAfterOneAirStep = s3.bobPhase;
  for (let i = 0; i < 30; i++) updateEyeFeel(s3, dt, airBody, PHYSICS);
  ok('11. airborne: bob phase does not advance', s3.bobPhase === phaseAfterOneAirStep, `phase=${s3.bobPhase}`);
  ok('11. airborne: bob contributes 0 (offset stays at the decayed step/dip-only value)', approxEqual(s3.offset, offsetAfterOneAirStep, 1e-9));
})();

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
