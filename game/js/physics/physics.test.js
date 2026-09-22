// game/js/physics/physics.test.js
//
// Headless test suite for US-008 (player capsule, gravity, walk/run,
// collision). Plain Node ESM, no test framework, no build step - matches
// the project's "no build step" rule. Run with:
//
//   node game/js/physics/physics.test.js
//
// Exits 0 and prints "ALL PASS" if every check passes, exits 1 and lists
// failures otherwise. Also exercised indirectly by game/physics-test.html
// (browser, visual/interactive) for the same collision code.

import { loadLevel } from '../world/Level.js';
import { Player } from '../entities/Player.js';
import { PHYSICS } from './config.js';
import { isSectorPassable, moveCapsule, sectorOrOutside } from './capsule.js';
import testRoomDef from '../world/levels/test_room.js';

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

// A tiny synthetic level, built with loadLevel like any other, so tests are
// exact and don't depend on test_room's exact layout for the basics.
//
//   0123456
// 0 #######
// 1 #.....#
// 2 #.h...#     h = solid wall, floor top 3.0 (a plain obstacle at (2,2))
// 3 #.....#
// 4 #.L.S.#     L = a raised floor, +0.6 m (too high to step up in one go)
// 5 #.....#     S = a raised floor, +0.3 m (steppable) - separate column from L
// 6 #.....#
// 7 #######
function miniLevel(overrides) {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'h': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    'L': { floorH: 0.6, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'S': { floorH: 0.3, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'p': { floorH: 0, ceilH: 1.5, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false }, // low ceiling, < 1.70 headroom
    'v': { floorH: -2, ceilH: 3, wallMat: 'rubble', floorMat: 'rubble', ceilMat: 'stone', solid: false }, // pit
  };
  const rows = [
    '#######',
    '#.....#',
    '#.h...#',
    '#.....#',
    '#.L.S.#',
    '#.....#',
    '#.....#',
    '#######',
  ];
  return loadLevel({ name: 'mini', legend, rows, start: { x: 1.5, y: 1.5, facingDeg: 90 }, ...overrides });
}

function stepN(player, level, controls, n) {
  for (let i = 0; i < n; i++) player.update(PHYSICS.fixedDt, controls, level);
}

// ---------------------------------------------------------------------
// 1. Capsule shape / config (AC1)
// ---------------------------------------------------------------------
{
  ok('config: radius 0.30', PHYSICS.radius === 0.30);
  ok('config: height 1.70', PHYSICS.height === 1.70);
  ok('config: eyeHeight 1.60', PHYSICS.eyeHeight === 1.60);
  ok('config: walkSpeed 3.5', PHYSICS.walkSpeed === 3.5);
  ok('config: runSpeed 6.0', PHYSICS.runSpeed === 6.0);
  ok('config: gravity 20', PHYSICS.gravity === 20);
  ok('config: stepUpMax 0.45', PHYSICS.stepUpMax === 0.45);
}

// ---------------------------------------------------------------------
// 2. Level loads, player spawns grounded on the start sector's floor.
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  ok('mini level loads', !!level);
  const player = new Player(level);
  ok('spawn x/y matches start', player.x === 1.5 && player.y === 1.5);
  ok('spawn z matches floor', player.z === 0);
  ok('spawn grounded', player.grounded === true);
  ok('spawn yaw from start', player.yawDeg === 90);
}

// ---------------------------------------------------------------------
// 3. Walk speed: reaches ~walkSpeed within accelTime, holds it, and the
//    fixed-step accumulation is exact (v(t) = min(rate*t, target)).
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  const controls = { forward: 1, strafe: 0, run: false, yawDeg: 90 }; // face east, open corridor row 1
  const stepsToFullAccel = Math.round(PHYSICS.accelTime / PHYSICS.fixedDt);
  stepN(player, level, controls, stepsToFullAccel);
  const speed = Math.hypot(player.vx, player.vy);
  ok('walk reaches walkSpeed after accelTime', approxEqual(speed, PHYSICS.walkSpeed, 0.05), `speed=${speed}`);

  // Stop: release input, should reach 0 within decelTime.
  const stepsToStop = Math.round(PHYSICS.decelTime / PHYSICS.fixedDt);
  stepN(player, level, { forward: 0, strafe: 0, run: false, yawDeg: 90 }, stepsToStop);
  const speedAfterStop = Math.hypot(player.vx, player.vy);
  ok('walk stops within decelTime', approxEqual(speedAfterStop, 0, 0.05), `speed=${speedAfterStop}`);
}

// ---------------------------------------------------------------------
// 4. Run speed: reaches ~runSpeed within accelTime.
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  const controls = { forward: 1, strafe: 0, run: true, yawDeg: 90 };
  const steps = Math.round(PHYSICS.accelTime / PHYSICS.fixedDt);
  stepN(player, level, controls, steps);
  const speed = Math.hypot(player.vx, player.vy);
  ok('run reaches runSpeed after accelTime', approxEqual(speed, PHYSICS.runSpeed, 0.08), `speed=${speed}`);
}

// ---------------------------------------------------------------------
// 5. Diagonal movement is not faster than axis movement (US-005 AC also
//    applies to physics' own wish-direction normalization).
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  // yaw 90 (east): forward=+1 is east, strafe=+1 is south (right of east).
  const controls = { forward: 1, strafe: 1, run: true, yawDeg: 90 };
  stepN(player, level, controls, Math.round(PHYSICS.accelTime / PHYSICS.fixedDt) + 5);
  const speed = Math.hypot(player.vx, player.vy);
  ok('diagonal run speed capped at runSpeed', speed <= PHYSICS.runSpeed + 0.05, `speed=${speed}`);
}

// ---------------------------------------------------------------------
// 6. Collision: solid cell blocks; never tunnels through a 1-cell wall at
//    run speed; player ends up resting just outside it (within radius).
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  player.x = 1.5; player.y = 2.5; // just west of the 'h' wall at (2,2)
  player.z = 0; player.grounded = true;
  const controls = { forward: 1, strafe: 0, run: true, yawDeg: 90 }; // run east, straight into the wall
  stepN(player, level, controls, 120); // 2 seconds - plenty to have tunnelled if buggy
  ok(
    'never tunnels through a 1-cell wall at run speed',
    player.x <= 2 - PHYSICS.radius + 1e-6,
    `x=${player.x} (wall face at x=2, expected <= ${2 - PHYSICS.radius})`
  );
  ok('rests close against the wall (no dead gap)', player.x >= 2 - PHYSICS.radius - 0.02, `x=${player.x}`);
}

// ---------------------------------------------------------------------
// 7. Sliding: moving diagonally into a wall keeps the tangential component
//    (never fully "stuck" - the along-wall axis keeps making progress).
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  player.x = 1.5; player.y = 1.5;
  player.z = 0; player.grounded = true;
  // Aim at the wall (2,2) diagonally (SE): forward=east(yaw90)+strafe=south.
  const controls = { forward: 1, strafe: 1, run: true, yawDeg: 90 };
  stepN(player, level, controls, 90);
  // Should have slid along the wall and kept moving in Y (south) even
  // though X got blocked - i.e. not stuck at the spawn corner.
  ok('slides along a wall instead of sticking', player.y > 2.0, `y=${player.y}`);
  ok('finite position after sliding', Number.isFinite(player.x) && Number.isFinite(player.y));
}

// ---------------------------------------------------------------------
// 8. Head collision: cannot enter a sector whose ceilH - floorH < 1.70.
// ---------------------------------------------------------------------
{
  ok(
    'low-ceiling sector (0.0/1.5) is impassable',
    !isSectorPassable({ floorH: 0, ceilH: 1.5, solid: false }, 0, true, { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax })
  );
  ok(
    'normal sector (0.0/3.0) is passable',
    isSectorPassable({ floorH: 0, ceilH: 3, solid: false }, 0, true, { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax })
  );
}

// ---------------------------------------------------------------------
// 9. Gravity: walking off a ledge falls and lands on the lower floor,
//    instead of teleporting straight down.
// ---------------------------------------------------------------------
{
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 2, ceilH: 5, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'v': { floorH: 0, ceilH: 5, wallMat: 'rubble', floorMat: 'rubble', ceilMat: 'stone', solid: false }, // 2 m drop
  };
  const rows = ['#####', '#.v.#', '#.v.#', '#####'];
  const level = loadLevel({ name: 'ledge', legend, rows, start: { x: 1.5, y: 1.5, facingDeg: 90 } });
  const player = new Player(level);
  ok('ledge level: spawn grounded at floor 2', player.z === 2 && player.grounded);

  // Walk forward (east) off the ledge; step through and watch z.
  const controls = { forward: 1, strafe: 0, run: false, yawDeg: 90 };
  let sawAirborne = false;
  let minZDuringFall = Infinity;
  for (let i = 0; i < 90; i++) {
    player.update(PHYSICS.fixedDt, controls, level);
    if (!player.grounded) { sawAirborne = true; minZDuringFall = Math.min(minZDuringFall, player.z); }
  }
  ok('becomes airborne after walking off the ledge', sawAirborne);
  ok('falls gradually (was above the lower floor mid-fall)', minZDuringFall > 0 && minZDuringFall < 2, `minZ=${minZDuringFall}`);
  ok('lands exactly on the lower floor (z=0)', approxEqual(player.z, 0, 1e-6), `z=${player.z}`);
  ok('grounded again after landing', player.grounded === true);
  ok('vertical velocity reset on landing', player.vz === 0);
}

// ---------------------------------------------------------------------
// 10. Step-up (grounded): a 0.3 m rise is walked smoothly; a 0.6 m rise is
//     blocked like a wall (only while grounded - see US-009's rule that
//     this is deliberately grounded-only).
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const player = new Player(level);
  player.x = 4.5; player.y = 3.5; // just north of 'S' (0.3m) at (4,4)
  player.z = 0; player.grounded = true;
  // yaw 180 = south (compass 0=N,90=E,180=S,270=W). Enough steps to cross
  // into the S cell (y in [4,5)) but not so many it walks straight through
  // and back down to the open floor beyond (row 5+, also 0.0 m).
  stepN(player, level, { forward: 1, strafe: 0, run: false, yawDeg: 180 }, 20);
  ok('crossed into the S cell (4 < y < 5)', player.y > 4 && player.y < 5, `y=${player.y}`);
  ok('steps up a 0.3 m rise while grounded (z follows floor)', approxEqual(player.z, 0.3, 1e-6), `z=${player.z}`);
  ok('still grounded after the step', player.grounded === true);
}
{
  const level = miniLevel();
  const player = new Player(level);
  player.x = 2.5; player.y = 3.5; // just north of 'L' (0.6m) at (2,4)
  player.z = 0; player.grounded = true;
  stepN(player, level, { forward: 1, strafe: 0, run: false, yawDeg: 180 }, 90);
  ok(
    'a 0.6 m rise (> stepUpMax) blocks horizontal entry while grounded',
    player.y <= 4 - PHYSICS.radius + 1e-6,
    `y=${player.y} (expected <= ${4 - PHYSICS.radius})`
  );
  ok('z unchanged (never "climbed" the too-high step)', player.z === 0, `z=${player.z}`);
}

// ---------------------------------------------------------------------
// 11. Step-up never applies while airborne (US-009 rule, built now so the
//     collision core doesn't need reshaping later): a player who is
//     falling and drifts sideways into a higher floor is blocked by it,
//     even though the SAME floor would be step-up-able while grounded.
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const stepSector = { floorH: 0.3, ceilH: 3, solid: false }; // steppable while grounded
  ok('0.3 m rise passable while grounded', isSectorPassable(stepSector, 0, true, opts));
  ok('SAME 0.3 m rise NOT passable while airborne', !isSectorPassable(stepSector, 0, false, opts));
  void level;
}

// ---------------------------------------------------------------------
// 12. A running player crossing a 1-cell gap without jumping always falls
//     (US-009's explicit "no bridging the gap mid-air" case), exercised
//     here at the collision-predicate level since US-008 has no jump yet:
//     a void cell (very low floor) is always passable (you're meant to
//     fall into it), and it never gets treated as a steppable rise.
// ---------------------------------------------------------------------
{
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const voidSector = { floorH: -1, ceilH: 3, solid: false };
  ok('a void/gap cell is always passable (grounded)', isSectorPassable(voidSector, 0, true, opts));
  ok('a void/gap cell is always passable (airborne)', isSectorPassable(voidSector, 0, false, opts));
}

// ---------------------------------------------------------------------
// 13. moveCapsule never returns a non-finite / NaN position (corner
//     robustness) even when starting exactly on a cell boundary.
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const res = moveCapsule(level, 2.0, 2.0, 0.05, 0.05, PHYSICS.radius, 0, true, opts);
  ok('moveCapsule stays finite from a boundary start', Number.isFinite(res.x) && Number.isFinite(res.y), JSON.stringify(res));
}

// ---------------------------------------------------------------------
// 14. (D-008) "Outside the grid" is a query on the world, not a hard-coded
//     wall. sectorOrOutside must call world.outsideSector(), and a level
//     that overrides it (e.g. an open terrain stand-in) must be honored by
//     both collision and floor-tracking, not silently ignored.
// ---------------------------------------------------------------------
{
  const level = miniLevel();
  ok('Level provides a default outsideSector()', typeof level.outsideSector === 'function');
  const outside = level.outsideSector(-5, -5);
  ok('default outsideSector() is solid (walled world edge)', !!outside && outside.solid === true);
  ok('sectorOrOutside falls back to it beyond the grid', sectorOrOutside(level, -5, -5) === outside);
  ok('sectorOrOutside returns the real sector when in bounds', sectorOrOutside(level, 1.5, 1.5) === level.sectorAt(1.5, 1.5));

  // Override outsideSector with an open (non-solid, flat) stand-in and
  // confirm physics actually queries it live rather than assuming a wall.
  // Use a BORDERLESS level (test_room/the tower are walled on purpose, so
  // sectorAt() never actually returns null for them - not a useful probe
  // for this): walking off its edge only becomes possible if outsideSector
  // is genuinely consulted each step, not a hard-coded fallback.
  const openLevel = loadLevel({
    name: 'borderless',
    legend: { '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false } },
    rows: ['...', '...', '...'],
    start: { x: 1.5, y: 1.5, facingDeg: 270 },
  });
  ok('borderless test level loads', !!openLevel);

  const wallWorld = openLevel; // default outsideSector(): solid wall
  const wallPlayer = new Player(openLevel);
  const westControls = { forward: 1, strafe: 0, run: false, yawDeg: 270 }; // face west, walk forward = west
  for (let i = 0; i < 90; i++) wallPlayer.update(PHYSICS.fixedDt, westControls, wallWorld);
  ok(
    'default outsideSector() (solid) blocks leaving the grid at x=0',
    wallPlayer.x >= 0 + PHYSICS.radius - 1e-6,
    `x=${wallPlayer.x} (expected >= ${PHYSICS.radius})`
  );

  const openWorld = Object.create(openLevel);
  openWorld.outsideSector = () => ({ floorH: -1, ceilH: 'sky', wallMat: 'rock', floorMat: 'rock', ceilMat: 'sky', solid: false });
  const openPlayer = new Player(openLevel);
  for (let i = 0; i < 90; i++) openPlayer.update(PHYSICS.fixedDt, westControls, openWorld);
  ok(
    'a world whose outsideSector() is open lets the capsule leave the authored grid',
    openPlayer.x < 0,
    `x=${openPlayer.x} (expected to have crossed the west edge at x=0)`
  );
}

// ---------------------------------------------------------------------
// 14b. Real content: test_room and the tower both load and produce a
//     grounded spawn (smoke test against the actual game data, not just
//     synthetic minis).
// ---------------------------------------------------------------------
{
  const level = loadLevel(testRoomDef);
  ok('test_room loads for physics smoke test', !!level);
  if (level) {
    const player = new Player(level);
    ok('test_room player spawns grounded', player.grounded === true);
    ok('test_room player spawn z matches floorAt(start)', player.z === level.floorAt(level.start.x, level.start.y));
  }
}

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
