// game/js/physics/jump.test.js
//
// Headless test suite for US-009 (jump, coyote/buffer, step-up smoothing
// gating, head clearance, landing dip, no-bridge). Plain Node ESM, no test
// framework - matches physics.test.js's pattern. Run with:
//
//   node game/js/physics/jump.test.js
//
// Head bob and step/dip eye-offset numbers are covered by
// game/js/entities/eyeFeel.test.js; this file covers the body sim (Player,
// capsule.js) only. Exits 0 and prints "ALL PASS" if every check passes,
// exits 1 and lists failures otherwise. `physics.test.js` (US-008, 187
// checks) is unmodified and still passes - see the programmer notes in
// docs/backlog.md US-009 for the combined run.
//
// A note on "vz === jumpSpeed" style wording in the backlog's test plan:
// per architecture.md 7.1 step 5, the SAME step that sets vz = jumpSpeed
// also integrates gravity for that step (the airborne branch runs
// immediately, since `grounded` already reads false post-decision) - this
// is what fixes the US-008-era bug where a step-start-grounded snapshot let
// the floor-follow branch stomp the fresh vz back to 0 ("eats the jump").
// So the exact value one full update() after the press is
// `jumpSpeed - gravity*dt`, not `jumpSpeed` - checked exactly below.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLevel } from '../world/Level.js';
import { Player } from '../entities/Player.js';
import { PHYSICS } from './config.js';
import { isSectorPassable } from './capsule.js';
import testRoomDef from '../../design/levels/test_room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Synthetic level for the unit-style cases (kinematics, buffer/coyote, air
// control, flat head-clearance) - independent of test_room's exact layout.
//
//   0123456
// 0 #######
// 1 #.....#
// 2 #.....#
// 3 #..q..#     q = low ceiling (2.0 m), for the head-clearance unit case
// 4 #.....#
// 5 #.....#
// 6 #######
function flatLevel() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'q': { floorH: 0, ceilH: 2.0, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = ['#######', '#.....#', '#.....#', '#..q..#', '#.....#', '#.....#', '#######'];
  return loadLevel({ name: 'flat', legend, rows, start: { x: 1.5, y: 1.5, facingDeg: 90 } });
}

// A drop level: flat floor 'P' (1.0 m) leading to a plain floor '.' (0 m),
// for coyote/buffer scripting ("walk off P").
//
//   0123
// 0 ####
// 1 #PP#
// 2 #..#
// 3 ####
function dropLevel() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'P': { floorH: 1.0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = ['####', '#PP#', '#..#', '####'];
  return loadLevel({ name: 'drop', legend, rows, start: { x: 1.5, y: 1.5, facingDeg: 180 } });
}

const testRoom = loadLevel(testRoomDef);

const noInput = { forward: 0, strafe: 0, run: false, jump: false };

function stepN(player, level, controls, n) {
  for (let i = 0; i < n; i++) player.update(PHYSICS.fixedDt, controls, level);
}

// =====================================================================
// 1. Jump kinematics on a flat floor.
// =====================================================================
(function test1_kinematics() {
  const level = flatLevel();
  const p = new Player(level);
  p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level);

  const expectedVzAfterPress = PHYSICS.jumpSpeed - PHYSICS.gravity * PHYSICS.fixedDt;
  ok('1. press step: jumped flag set', p.jumped === true);
  ok('1. press step: not grounded', p.grounded === false);
  ok('1. press step: vz === jumpSpeed - g*dt (same-step gravity, architecture.md 7.1 step 5)',
    approxEqual(p.vz, expectedVzAfterPress, 1e-9), `vz=${p.vz}`);

  let maxZ = p.z;
  let airborneSteps = 0;
  let landedCount = 0;
  let landedFallDistance = 0;
  for (let i = 0; i < 200 && !(p.grounded && i > 0); i++) {
    p.update(PHYSICS.fixedDt, noInput, level);
    if (!p.grounded || i === 0) airborneSteps++;
    if (p.z > maxZ) maxZ = p.z;
    if (p.landed) { landedCount++; landedFallDistance = p.fallDistance; }
    if (p.grounded && p.landed) break;
  }

  ok('1. max z in [1.00, 1.06]', maxZ >= 1.00 && maxZ <= 1.06, `maxZ=${maxZ}`);
  ok('1. airborne ~39 steps (+-2)', Math.abs(airborneSteps - 39) <= 2, `airborneSteps=${airborneSteps}`);
  ok('1. landed exactly once', landedCount === 1, `landedCount=${landedCount}`);
  ok('1. fallDistance within 0.02 of max z', approxEqual(landedFallDistance, maxZ, 0.02), `fallDistance=${landedFallDistance} maxZ=${maxZ}`);
  ok('1. lands at z === 0', approxEqual(p.z, 0, 1e-9), `z=${p.z}`);
  ok('1. grounded after landing', p.grounded === true);
})();

// =====================================================================
// 2. Only grounded (+ no double jump / re-press works).
// =====================================================================
(function test2_groundedOnlyAndNoDoubleJump() {
  const level = flatLevel();

  // A press mid-air (no coyote) changes nothing that step: high enough
  // above the floor that this step's fall doesn't land it, so the only
  // thing that could change vz to +jumpSpeed is the (absent) jump decision.
  const p = new Player(level);
  p.grounded = false;
  p.coyote = 0;
  p.z = 2.5;
  p.vz = -1;
  p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level);
  ok('2. mid-air press without coyote: no jump', p.jumped === false);
  ok('2. mid-air press without coyote: vz not set to jumpSpeed (still falling)', p.vz < 0);

  // Hold Space from the floor for 3s -> exactly one jumped.
  const p2 = new Player(level);
  let jumpedCount = 0;
  const heldControls = { forward: 0, strafe: 0, run: false, jump: true };
  for (let i = 0; i < 180; i++) { // 3 s @ 60 Hz
    p2.update(PHYSICS.fixedDt, heldControls, level);
    if (p2.jumped) jumpedCount++;
  }
  ok('2. holding Space 3s: exactly one jumped (AC9 no auto-repeat)', jumpedCount === 1, `jumpedCount=${jumpedCount}`);

  // Release and re-press -> jumps again.
  p2.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false }, level); // release
  let jumpedAfterRepress = false;
  for (let i = 0; i < 5; i++) {
    p2.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level); // re-press (edge)
    if (p2.jumped) jumpedAfterRepress = true;
  }
  ok('2. release + re-press jumps again', jumpedAfterRepress === true);
})();

// =====================================================================
// 3. Coyote time.
// =====================================================================
(function test3_coyote() {
  // Walk off P (1.0 -> 0): find the drop step.
  function walkToDropStep(level) {
    const p = new Player(level);
    const controls = { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 };
    let dropStep = -1;
    for (let i = 0; i < 60; i++) {
      p.update(PHYSICS.fixedDt, controls, level);
      if (!p.grounded) { dropStep = i; break; }
    }
    return { p, dropStep };
  }

  for (let n = 1; n <= 5; n++) {
    const level = dropLevel();
    const { p, dropStep } = walkToDropStep(level);
    ok(`3. coyote: found the drop step for n=${n} probe`, dropStep >= 0, `dropStep=${dropStep}`);
    // Walk N more steps with no input (preserve coyote countdown), then press.
    for (let i = 0; i < n - 1; i++) p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false }, level);
    const vzBefore = p.vz;
    p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level);
    const expected = PHYSICS.jumpSpeed - PHYSICS.gravity * PHYSICS.fixedDt;
    ok(`3. coyote jump at +${n} steps after drop: vz set (jumped)`, p.jumped === true, `vzBefore=${vzBefore} vzAfter=${p.vz}`);
    ok(`3. coyote jump at +${n} steps after drop: vz === jumpSpeed - g*dt`, approxEqual(p.vz, expected, 1e-9));
  }

  // At 7 steps after the drop (past the 6-step / 100ms window): no jump, lands at 0.
  {
    const level = dropLevel();
    const { p, dropStep } = walkToDropStep(level);
    ok('3. coyote: found the drop step for the 7-step probe', dropStep >= 0);
    for (let i = 0; i < 6; i++) p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false }, level);
    p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level);
    ok('3. coyote expired at +7 steps: no jump', p.jumped === false);
    // Let it finish landing.
    for (let i = 0; i < 60 && !p.grounded; i++) p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false }, level);
    ok('3. coyote expired: lands at z === 0', approxEqual(p.z, 0, 1e-9), `z=${p.z}`);
  }

  // During coyote, a +0.3 cell adjacent to the fall is NOT entered (no step-up while airborne).
  {
    const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
    const higherFloor = { solid: false, ceilH: 3, floorH: 0.3 };
    ok('3. no step-up while airborne (AC7 unit form): a +0.3 floor is impassable when not grounded',
      isSectorPassable(higherFloor, 0, false, opts) === false);
    ok('3. the same +0.3 floor IS passable while grounded (sanity, unchanged from US-008)',
      isSectorPassable(higherFloor, 0, true, opts) === true);
  }
})();

// =====================================================================
// 4. Jump buffer.
// =====================================================================
(function test4_buffer() {
  function fallFromP(level, pressAtStepsBeforeLanding) {
    const p = new Player(level);
    const controls = { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 };
    // Walk to the drop, then let it fall freely, counting down to find the
    // landing step by simulation (fixed level -> deterministic landing step).
    const trace = [];
    for (let i = 0; i < 300; i++) {
      p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 180 }, level);
      trace.push(p.grounded);
      if (p.grounded && i > 5) break; // past the initial "still on P" grounded steps
    }
    return trace.length; // step count of the landing (approx, deterministic given fixed input)
  }

  // Press 3 steps before landing -> jumped on the step after landing.
  {
    const level = dropLevel();
    const p = new Player(level);
    // Walk forward until the drop begins.
    let steps = 0;
    while (p.grounded && steps < 60) { p.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 }, level); steps++; }
    // Continue falling until 3 steps before landing (probe by running ahead on a clone-free approach:
    // step until grounded again, recording the step index, then replay with the press).
    let stepsToLand = 0;
    const probe = new Player(level);
    probe.x = p.x; probe.y = p.y; probe.z = p.z; probe.vz = p.vz; probe.vx = p.vx; probe.vy = p.vy; probe.grounded = p.grounded; probe.coyote = p.coyote;
    while (!probe.grounded && stepsToLand < 200) { probe.update(PHYSICS.fixedDt, noInput, level); stepsToLand++; }

    ok('4. buffer: found a finite fall length to probe', stepsToLand > 3 && stepsToLand < 200, `stepsToLand=${stepsToLand}`);

    for (let i = 0; i < stepsToLand - 3; i++) p.update(PHYSICS.fixedDt, noInput, level);
    p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level); // press, 3 steps before landing
    ok('4. buffer press 3 steps before landing: not consumed yet (still airborne)', p.jumped === false && p.grounded === false);
    let jumpedAfterLanding = false;
    for (let i = 0; i < 5; i++) {
      p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level); // still held
      if (p.grounded && p.jumped) { jumpedAfterLanding = true; break; }
      if (p.jumped) jumpedAfterLanding = true;
    }
    ok('4. buffer press 3 steps before landing: jumps on/after the landing step', jumpedAfterLanding === true);
  }

  // Press 8 steps before landing (past the 6-step window) -> no jump.
  {
    const level = dropLevel();
    const p = new Player(level);
    let steps = 0;
    while (p.grounded && steps < 60) { p.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 }, level); steps++; }
    const probe = new Player(level);
    probe.x = p.x; probe.y = p.y; probe.z = p.z; probe.vz = p.vz; probe.vx = p.vx; probe.vy = p.vy; probe.grounded = p.grounded; probe.coyote = p.coyote;
    let stepsToLand = 0;
    while (!probe.grounded && stepsToLand < 200) { probe.update(PHYSICS.fixedDt, noInput, level); stepsToLand++; }

    if (stepsToLand > 8) {
      for (let i = 0; i < stepsToLand - 8; i++) p.update(PHYSICS.fixedDt, noInput, level);
      p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level); // press, 8 steps before landing
      p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: false }, level); // release immediately (edge only)
      let jumpedAtAll = false;
      for (let i = 0; i < stepsToLand + 5; i++) {
        p.update(PHYSICS.fixedDt, noInput, level);
        if (p.jumped) jumpedAtAll = true;
      }
      ok('4. buffer press 8 steps before landing: expired, no jump', jumpedAtAll === false);
    } else {
      ok('4. buffer press 8 steps before landing: fall too short to probe (skipped, documented)', true);
    }
  }

  // A buffered press consumed at landing with Space still held does not jump again.
  {
    const level = dropLevel();
    const p = new Player(level);
    let steps = 0;
    while (p.grounded && steps < 60) { p.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 }, level); steps++; }
    let jumpedCount = 0;
    for (let i = 0; i < 100; i++) {
      p.update(PHYSICS.fixedDt, { forward: 0, strafe: 0, run: false, jump: true }, level); // held throughout
      if (p.jumped) jumpedCount++;
    }
    ok('4. buffered press consumed at landing while Space still held: exactly one jump total', jumpedCount === 1, `jumpedCount=${jumpedCount}`);
  }
})();

// =====================================================================
// 5. Air control.
// =====================================================================
(function test5_airControl() {
  const level = flatLevel();

  const grounded = new Player(level);
  grounded.grounded = true;
  grounded.vx = 0; grounded.vy = 0;
  grounded.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: false }, level);
  const groundedDv = Math.hypot(grounded.vx, grounded.vy);
  const expectedGrounded = (PHYSICS.walkSpeed / PHYSICS.accelTime) * PHYSICS.fixedDt;
  ok('5. grounded: one step of full input changes |v| by walkSpeed/accelTime*dt',
    approxEqual(groundedDv, expectedGrounded, 1e-9), `dv=${groundedDv} expected=${expectedGrounded}`);

  const airborne = new Player(level);
  airborne.grounded = false;
  airborne.coyote = 0;
  airborne.vx = 0; airborne.vy = 0; airborne.vz = 0;
  airborne.z = 0.5; // clear of the floor so it stays airborne this step, but within the room's headroom (0.5+height=2.2 < ceilH 3)
  airborne.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: false }, level);
  const airborneDv = Math.hypot(airborne.vx, airborne.vy);
  const expectedAir = (PHYSICS.walkSpeed / PHYSICS.accelTime) * PHYSICS.airControl * PHYSICS.fixedDt;
  ok('5. airborne: one step of full input changes |v| by walkSpeed/accelTime*airControl*dt',
    approxEqual(airborneDv, expectedAir, 1e-9), `dv=${airborneDv} expected=${expectedAir}`);
})();

// =====================================================================
// 6. Head clearance.
// =====================================================================
(function test6_headClearance() {
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const sector = { solid: false, floorH: 0, ceilH: 2.0 };
  // Edge at ceilH - height = 2.0 - 1.7 = 0.3, with a load-bearing SKIN
  // (1e-6) tolerance right at the edge (capsule.js: the mover's own cell,
  // right after a ceiling clamp, must stay passable within an ulp - see
  // architecture.md 7.1 item 3). So the offsets bracket the edge from
  // clearly outside the SKIN zone, not from 1e-7 (inside it).
  ok('6. head clearance: passable at footZ 0', isSectorPassable(sector, 0, true, opts) === true);
  ok('6. head clearance: passable at footZ 0.3 - 1e-3', isSectorPassable(sector, 0.3 - 1e-3, true, opts) === true);
  ok('6. head clearance: impassable at footZ 0.3 + 1e-3', isSectorPassable(sector, 0.3 + 1e-3, true, opts) === false);
  // Right at the edge and just inside the SKIN tolerance: still passable
  // (this is the "frozen step" guard the tech notes call out).
  ok('6. head clearance: passable exactly at footZ 0.3 (the edge)', isSectorPassable(sector, 0.3, true, opts) === true);
  ok('6. head clearance: passable at footZ 0.3 + 1e-7 (inside SKIN)', isSectorPassable(sector, 0.3 + 1e-7, true, opts) === true);
  ok('6. head clearance: impassable at footZ 0.3 + 1e-5 (outside SKIN)', isSectorPassable(sector, 0.3 + 1e-5, true, opts) === false);

  // Grounded step-down from a 0.4 cell into a 2.0 ceiling: blocked (0.4+1.7=2.1 > 2.0);
  // from 0 (0+1.7=1.7 <= 2.0): allowed.
  ok('6. grounded step into a low ceiling from footZ 0.4: blocked', isSectorPassable(sector, 0.4, true, opts) === false);
  ok('6. grounded step into a low ceiling from footZ 0: allowed', isSectorPassable(sector, 0, true, opts) === true);

  // Integration on test_room: jump from row 7 col 5 south into D.
  {
    const p = new Player(testRoom);
    p.x = 5.5; p.y = 7.5; p.z = testRoom.floorAt(5.5, 7.5) ?? 0; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    const controls = { forward: 1, strafe: 0, run: false, jump: true, yawDeg: 180 };
    let neverClipped = true;
    for (let i = 0; i < 90; i++) {
      p.update(PHYSICS.fixedDt, i === 0 ? controls : { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 180 }, p.__level || testRoom);
      const sec = testRoom.sectorAt(p.x, p.y);
      if (sec && sec.ceilH !== 'sky' && Math.floor(p.y) === 8 && Math.floor(p.x) === 5) {
        if (p.z + PHYSICS.height > sec.ceilH + 1e-6) neverClipped = false;
      }
    }
    ok('6. lintel D: never z+height > ceilH+SKIN while centre is in D', neverClipped === true);
  }

  // Ceiling bonk: jump from P (floorH 1.0, ceilH 3.0): z <= 1.3+1e-9 on every step, vz===0 on clamp, lands back on P.
  {
    const p = new Player(testRoom);
    p.x = 14.5; p.y = 13.5; p.z = testRoom.floorAt(14.5, 13.5) ?? 1.0; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    let neverAboveBonk = true;
    let clampedVzToZero = false;
    for (let i = 0; i < 90; i++) {
      p.update(PHYSICS.fixedDt, i === 0 ? { forward: 0, strafe: 0, run: false, jump: true } : noInput, testRoom);
      if (p.z > 1.3 + 1e-9) neverAboveBonk = false;
      if (approxEqual(p.z, 1.3, 1e-9) && p.vz === 0) clampedVzToZero = true;
    }
    ok('6. ceiling bonk on P: z <= 1.3+1e-9 on every step', neverAboveBonk === true);
    ok('6. ceiling bonk on P: vz === 0 on the clamp step', clampedVzToZero === true);
    ok('6. ceiling bonk on P: lands back on P (z===1.0, grounded)', approxEqual(p.z, 1.0, 1e-9) && p.grounded === true, `z=${p.z}`);
  }
})();

// =====================================================================
// 7. Gap AC4 (test_room).
// =====================================================================
(function test7_gap() {
  function tryGap(y, run, x0) {
    const p = new Player(testRoom);
    // z=0: the take-off positions (8.70..9.00) straddle the pit boundary at
    // x=9, so testRoom.floorAt(x0, y) can snap into the pit cell right at
    // x0=9.00 - the physically correct height to start from is the solid
    // 0.0 m floor being taken off from, not whatever cell x0 floors into.
    p.x = x0; p.y = y; p.z = 0; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    // Walk/run east to the take-off point, then jump once there and keep holding forward.
    const controls = { forward: 1, strafe: 0, run, jump: false, yawDeg: 90 };
    let neverDippedIntoPit = true;
    let jumped = false;
    for (let i = 0; i < 90; i++) { // 1.5 s
      const c = { ...controls, jump: !jumped };
      p.update(PHYSICS.fixedDt, c, testRoom);
      if (!jumped && p.jumped) jumped = true;
      if (p.z < -0.05) neverDippedIntoPit = false;
    }
    return { p, neverDippedIntoPit };
  }

  const takeoffs = [];
  for (let x = 8.70; x <= 9.001; x += 0.03) takeoffs.push(Math.round(x * 100) / 100);

  for (const x0 of takeoffs) {
    const { p, neverDippedIntoPit } = tryGap(15.5, false, x0);
    ok(`7. row15 gap (walk), takeoff x=${x0}: grounded && x>=10 && z>=0`,
      p.grounded === true && p.x >= 10 && p.z >= 0, `x=${p.x} z=${p.z} grounded=${p.grounded}`);
    ok(`7. row15 gap (walk), takeoff x=${x0}: never dipped into the pit (z>=-0.05)`, neverDippedIntoPit === true);
  }

  for (const x0 of takeoffs) {
    const { p, neverDippedIntoPit } = tryGap(16.5, true, x0);
    ok(`7. row16 gap (run), takeoff x=${x0}: grounded && x>=11 && z>=0`,
      p.grounded === true && p.x >= 11 && p.z >= 0, `x=${p.x} z=${p.z} grounded=${p.grounded}`);
    ok(`7. row16 gap (run), takeoff x=${x0}: never dipped into the pit (z>=-0.05)`, neverDippedIntoPit === true);
  }

  // Negative control: walking the 2 m gap from 8.70 fails (documents the margin).
  {
    const { p } = tryGap(16.5, false, 8.70);
    ok('7. negative control: walking the row16 (2 m) gap from x=8.70 fails to clear',
      !(p.grounded === true && p.x >= 11), `x=${p.x} z=${p.z} grounded=${p.grounded}`);
  }
})();

// =====================================================================
// 8. No-bridge AC7 + pit AC6.
// =====================================================================
(function test8_noBridgeAndPit() {
  let allFellIntoPit = true;
  let sawBlockedX = false;
  for (let i = 0; i < 10; i++) {
    const x0 = 6.5 + i * 0.01;
    const p = new Player(testRoom);
    p.x = x0; p.y = 15.5; p.z = testRoom.floorAt(x0, 15.5) ?? 0; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 90 };
    let blockedThisRun = false;
    for (let s = 0; s < 200; s++) {
      p.update(PHYSICS.fixedDt, controls, testRoom);
      if (p._move.blockedX && p.x > 9 && p.x < 10) blockedThisRun = true;
      if (p.grounded && p.x > 9) break;
    }
    if (blockedThisRun) sawBlockedX = true;
    const ok10 = p.grounded === true && approxEqual(p.z, -0.6, 1e-6) && p.x > 9 && p.x < 10;
    if (!ok10) allFellIntoPit = false;
  }
  ok('8. no-bridge: all 10 no-Space runs across the row15 gap end grounded at z===-0.6, 9<x<10', allFellIntoPit === true);
  ok('8. no-bridge: blockedX was observed on the approach (no step-up while airborne)', sawBlockedX === true);

  // Pit AC6: from the pit holding west 2s -> still z===-0.6.
  {
    const p = new Player(testRoom);
    p.x = 9.5; p.y = 15.5; p.z = -0.6; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    const controls = { forward: 1, strafe: 0, run: false, jump: false, yawDeg: 270 }; // west
    for (let i = 0; i < 120; i++) p.update(PHYSICS.fixedDt, controls, testRoom);
    ok('8. pit AC6: holding west in the pit for 2s stays at z===-0.6 (cannot walk out)', approxEqual(p.z, -0.6, 1e-6), `z=${p.z}`);
  }

  // Jump + hold west -> grounded && z===0 within 1.5s.
  {
    const p = new Player(testRoom);
    p.x = 9.5; p.y = 15.5; p.z = -0.6; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    let escaped = false;
    for (let i = 0; i < 90; i++) {
      p.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: i === 0, yawDeg: 270 }, testRoom);
      if (p.grounded && approxEqual(p.z, 0, 1e-6)) { escaped = true; break; }
    }
    ok('8. pit AC6: jump + hold west escapes onto z===0 within 1.5s', escaped === true);
  }

  // Same for east onto the +0.3 cell (z=0.3).
  {
    const p = new Player(testRoom);
    p.x = 9.5; p.y = 15.5; p.z = -0.6; p.grounded = true; p.vx = 0; p.vy = 0; p.vz = 0;
    let escaped = false;
    for (let i = 0; i < 90; i++) {
      p.update(PHYSICS.fixedDt, { forward: 1, strafe: 0, run: false, jump: i === 0, yawDeg: 90 }, testRoom);
      if (p.grounded && approxEqual(p.z, 0.3, 1e-6)) { escaped = true; break; }
    }
    ok('8. pit AC6: jump + hold east escapes onto the +0.3 cell within 1.5s', escaped === true);
  }
})();

// =====================================================================
// 12. Determinism.
// =====================================================================
(function test12_determinism() {
  // A scripted 600-step input covering a jump, a run across stairs and a
  // gap - built once, deterministic (no Math.random/Date anywhere in the
  // sim), and replayed against two fresh Players.
  function scriptedControls(i) {
    const t = i / 60;
    return {
      forward: t < 4 ? 1 : (t < 6 ? 0 : 1),
      strafe: 0,
      run: t >= 6,
      jump: (t > 0.2 && t < 0.25) || (t > 3.0 && t < 3.05) || (t > 6.5 && t < 6.55),
      yawDeg: 90,
    };
  }

  function run() {
    const level = loadLevel(testRoomDef);
    const p = new Player(level);
    p.x = 2.5; p.y = 13.5; p.z = level.floorAt(2.5, 13.5) ?? 0;
    for (let i = 0; i < 600; i++) p.update(PHYSICS.fixedDt, scriptedControls(i), level);
    return p;
  }

  const a = run();
  const b = run();
  ok('12. determinism: x bit-identical', a.x === b.x);
  ok('12. determinism: y bit-identical', a.y === b.y);
  ok('12. determinism: z bit-identical', a.z === b.z);
  ok('12. determinism: vx bit-identical', a.vx === b.vx);
  ok('12. determinism: vy bit-identical', a.vy === b.vy);
  ok('12. determinism: vz bit-identical', a.vz === b.vz);
  ok('12. determinism: feel.offset bit-identical', a.feel.offset === b.feel.offset);
})();

// =====================================================================
// 13. Allocation review (static source scan).
// =====================================================================
(function test13_allocationReview() {
  const playerSrc = fs.readFileSync(path.join(__dirname, '..', 'entities', 'Player.js'), 'utf8');
  const eyeFeelSrc = fs.readFileSync(path.join(__dirname, '..', 'entities', 'EyeFeel.js'), 'utf8');

  // Extract just the update()/updateEyeFeel() bodies is overkill for a
  // smoke check - a whole-file scan for banned non-deterministic/allocating
  // APIs is enough to catch a regression (rule 9.3 / architecture.md
  // "determinism / allocation" note): no Math.random, no Date, no
  // performance.now, and update() never builds a fresh controls-shaped
  // object literal (that's main.js's job to hoist, checked separately).
  const banned = [/Math\.random/, /new Date/, /performance\.now/];
  let clean = true;
  for (const re of banned) {
    if (re.test(playerSrc) || re.test(eyeFeelSrc)) clean = false;
  }
  ok('13. allocation/determinism review: no Math.random/Date/performance.now in Player.js or EyeFeel.js', clean === true);

  // updateEyeFeel must take the state object and write in place, not return
  // a fresh one (a `return` in that function would be a smell here).
  const updateEyeFeelBody = eyeFeelSrc.slice(eyeFeelSrc.indexOf('export function updateEyeFeel'));
  ok('13. EyeFeel.updateEyeFeel has no return statement (writes in place)', !/\breturn\b/.test(updateEyeFeelBody));
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
