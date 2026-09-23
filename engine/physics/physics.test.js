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
import testRoomDef from '../../design/levels/test_room.js';

let pass = 0;
let fail = 0;
const failures = [];

// Shared scratch for direct moveCapsule() calls in this file (US-008 ARCH
// CHANGES rework #3: moveCapsule takes a caller-owned `out` parameter
// instead of returning a fresh object). Tests read it immediately after
// each call, before the next one overwrites it.
const moveOut = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };

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
  // y=1.3 (not 1.5): starting exactly on the (1.5,1.5)-to-(2,2) diagonal
  // aims dead-on at the 'h' cell's corner POINT with zero tangential
  // velocity relative to it - a genuine head-on hit (see the PO reject #2
  // corner-push-out fix in capsule.js), which correctly just stops, same
  // as test (d)'s "a real overlap moving with zero lateral velocity has
  // nothing to deflect it". Offsetting y off that exact diagonal restores
  // this smoke test's intent: a real face/near-corner graze with a
  // tangential component to slide along.
  player.x = 1.5; player.y = 1.3;
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
  const res = moveCapsule(level, 2.0, 2.0, 0.05, 0.05, PHYSICS.radius, 0, true, opts, moveOut);
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

// =======================================================================
// PO REJECT #1 (US-008) bugfix regression tests, REWRITTEN for PO REJECT #2
// (2026-09-22): the reject #1 tests below did not actually reproduce the
// float-rounding stick (pure along-wall movement, near-misses far from the
// real rounding boundary, loose tolerances, no real pillar contact, and a
// random walk that re-rolled every step and only checked `solid`). These
// versions exercise the exact conditions from the review. See
// docs/backlog.md US-008 "PO REJECT #2" for the itemised requirements this
// section implements, and capsule.js for the corner-push-out fix these
// also cover (test group 4b below).
// =======================================================================

// A 12x12 room, single ring of border walls, fully open 10x10 interior -
// enough to test near-wall clearance without touching, but too small for a
// full 2 s run-speed slide (see longRoom() for that).
function bigRoom() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = [];
  for (let y = 0; y < 12; y++) {
    rows.push(y === 0 || y === 11 ? '#'.repeat(12) : '#' + '.'.repeat(10) + '#');
  }
  return loadLevel({ name: 'bigroom', legend, rows, start: { x: 6, y: 6, facingDeg: 90 } });
}

// A 24x24 room (22 m open interior per side) - long enough for 2 s of run
// (about 8.5 m of tangential travel) along any wall without also hitting a
// perpendicular wall (PO reject #2, item 1).
function longRoom() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = [];
  for (let y = 0; y < 24; y++) {
    rows.push(y === 0 || y === 23 ? '#'.repeat(24) : '#' + '.'.repeat(22) + '#');
  }
  return loadLevel({ name: 'longroom', legend, rows, start: { x: 12, y: 12, facingDeg: 90 } });
}

// A single 1-cell pillar (solid) at grid cell (5,5) in an otherwise open
// 10x10 room, used for the outer-corner slide test and the corner
// push-out invariant tests.
function pillarLevel() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
    'O': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  };
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let row = '.'.repeat(10);
    if (y === 5) row = row.slice(0, 5) + 'O' + row.slice(6); // single pillar at (5,5)
    rows.push(row);
  }
  return loadLevel({ name: 'pillar', legend, rows, start: { x: 1, y: 5, facingDeg: 90 } });
}

// Does a capsule (radius r) at (x,y) overlap any solid cell? Independent of
// resolveAxis's own math - used as the ground-truth safety invariant below.
function circleOverlapsSolid(level, x, y, r) {
  const colMin = Math.floor(x - r), colMax = Math.floor(x + r);
  const rowMin = Math.floor(y - r), rowMax = Math.floor(y + r);
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const sector = sectorOrOutside(level, col + 0.5, row + 0.5);
      if (!sector || !sector.solid) continue;
      const cx = Math.min(Math.max(x, col), col + 1);
      const cy = Math.min(Math.max(y, row), row + 1);
      const d = Math.hypot(x - cx, y - cy);
      if (d < r - 1e-9) return true; // allow exactly touching (d===r), that's not a penetration
    }
  }
  return false;
}

// Same, but against whatever `isSectorPassable` (footZ/grounded aware)
// considers impassable, not just `solid` - a too-high floor or too-low
// ceiling counts too (PO reject #2, item 5).
function circleOverlapsImpassable(level, x, y, r, footZ, grounded, opts) {
  const colMin = Math.floor(x - r), colMax = Math.floor(x + r);
  const rowMin = Math.floor(y - r), rowMax = Math.floor(y + r);
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const sector = sectorOrOutside(level, col + 0.5, row + 0.5);
      if (isSectorPassable(sector, footZ, grounded, opts)) continue;
      const cx = Math.min(Math.max(x, col), col + 1);
      const cy = Math.min(Math.max(y, row), row + 1);
      const d = Math.hypot(x - cx, y - cy);
      if (d < r - 1e-6) return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------
// (a) Slide along all 4 wall sides, at walk and run, with 45-degree
//     DIAGONAL input pressed INTO the wall for 2 s (120 steps) - the bug's
//     actual trigger condition, not pure forward travel. Checked both from
//     a hand-set exact-radius start and after a real run-in push-out
//     contact. On every one of the 120 steps: distance from the capsule
//     centre to the wall face stays within [radius - 1e-6, radius + 0.01],
//     and tangential travel over the 2 s is >= 95% of speed*cos(45)*2s.
// -----------------------------------------------------------------------
{
  const level = longRoom();
  const diagSteps = Math.round(2 / PHYSICS.fixedDt); // 2 s
  // face: distance from centre to the wall face; tangential: the along-wall
  // coordinate; approachYaw: straight into the wall (for the "pushed" start
  // mode); diagonalYaw: 45 degrees between "into the wall" and "tangential".
  const walls = [
    { name: 'west',  face: (x) => x - 1,  tangential: (x, y) => y, approachYaw: 270, diagonalYaw: 225, fixedCoord: (x, y) => y },
    { name: 'east',  face: (x) => 23 - x, tangential: (x, y) => y, approachYaw: 90,  diagonalYaw: 135, fixedCoord: (x, y) => y },
    { name: 'north', face: (x, y) => y - 1,  tangential: (x, y) => x, approachYaw: 0,   diagonalYaw: 45,  fixedCoord: (x, y) => x },
    { name: 'south', face: (x, y) => 23 - y, tangential: (x, y) => x, approachYaw: 180, diagonalYaw: 135, fixedCoord: (x, y) => x },
  ];

  for (const wall of walls) {
    for (const run of [false, true]) {
      const speed = run ? PHYSICS.runSpeed : PHYSICS.walkSpeed;
      for (const startMode of ['exact radius', 'real push-out']) {
        const player = new Player(level);
        player.z = 0; player.grounded = true; player.vx = 0; player.vy = 0;

        // Tangential start near the low end of the 22 m interior, so 2 s of
        // run (up to ~12 m) never reaches the far perpendicular wall.
        const tangentialLow = 2;
        if (wall.name === 'west')  { player.x = 1 + PHYSICS.radius;  player.y = tangentialLow; }
        if (wall.name === 'east')  { player.x = 23 - PHYSICS.radius; player.y = tangentialLow; }
        if (wall.name === 'north') { player.y = 1 + PHYSICS.radius;  player.x = tangentialLow; }
        if (wall.name === 'south') { player.y = 23 - PHYSICS.radius; player.x = tangentialLow; }

        if (startMode === 'real push-out') {
          // Start 2 m clear of the wall face (same tangential coordinate)
          // and run straight in to get a REAL push-out contact, not a
          // hand-set one.
          if (wall.name === 'west')  player.x += 2;
          if (wall.name === 'east')  player.x -= 2;
          if (wall.name === 'north') player.y += 2;
          if (wall.name === 'south') player.y -= 2;
          const approachControls = { forward: 1, strafe: 0, run: true, yawDeg: wall.approachYaw };
          stepN(player, level, approachControls, 60); // 1 s at run - plenty to reach and settle
        }

        let minFace = Infinity, maxFace = -Infinity;
        const tangentialStart = wall.tangential(player.x, player.y);
        const diagControls = { forward: 1, strafe: 0, run, yawDeg: wall.diagonalYaw };
        for (let i = 0; i < diagSteps; i++) {
          player.update(PHYSICS.fixedDt, diagControls, level);
          const d = wall.face(player.x, player.y);
          if (d < minFace) minFace = d;
          if (d > maxFace) maxFace = d;
        }
        const tangentialTravel = wall.tangential(player.x, player.y) - tangentialStart;
        const targetTravel = speed * Math.cos(Math.PI / 4) * 2;

        ok(
          `(a) ${wall.name} wall, ${run ? 'run' : 'walk'}, start=${startMode}: distance to wall face stays in [r-1e-6, r+0.01] every step`,
          minFace >= PHYSICS.radius - 1e-6 && maxFace <= PHYSICS.radius + 0.01,
          `min=${minFace} max=${maxFace} radius=${PHYSICS.radius}`
        );
        ok(
          `(a) ${wall.name} wall, ${run ? 'run' : 'walk'}, start=${startMode}: tangential travel over 2 s >= 95% of target`,
          tangentialTravel >= targetTravel * 0.95,
          `travel=${tangentialTravel} target=${targetTravel}`
        );
      }
    }
  }
}

// -----------------------------------------------------------------------
// (b) Near-miss walk: capsule CENTRE 0.300001 m from the wall face (edge
//     clearance exactly 1e-6, at the real float-rounding boundary this bug
//     lived at), walking 5 m parallel on each of the 4 sides. `blockedX`/
//     `blockedY` (checked directly via moveCapsule) must never be true, and
//     the travel must equal a free walk (no wall) within 1e-6.
// -----------------------------------------------------------------------
{
  const level = bigRoom();
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const dist = 0.300001; // capsule centre to wall face
  const dt = PHYSICS.fixedDt;
  const speed = PHYSICS.walkSpeed;
  const steps = Math.ceil(5 / speed / dt);
  const step = speed * dt;

  const sides = [
    { name: 'west',  x0: 1 + dist,  y0: 2,       dx: 0,    dy: step },
    { name: 'east',  x0: 11 - dist, y0: 2,       dx: 0,    dy: step },
    { name: 'north', x0: 2,         y0: 1 + dist,  dx: step, dy: 0 },
    { name: 'south', x0: 2,         y0: 11 - dist, dx: step, dy: 0 },
  ];

  for (const side of sides) {
    let x = side.x0, y = side.y0;
    let everBlocked = false;
    for (let i = 0; i < steps; i++) {
      const res = moveCapsule(level, x, y, side.dx, side.dy, PHYSICS.radius, 0, true, opts, moveOut);
      if (res.blockedX || res.blockedY) everBlocked = true;
      x = res.x; y = res.y;
    }
    ok(`(b) near-miss (0.300001 m centre-to-face clearance) along ${side.name} wall never sets blockedX/blockedY`, !everBlocked);
    const freeTravel = step * steps;
    const actualTravel = side.dx !== 0 ? Math.abs(x - side.x0) : Math.abs(y - side.y0);
    ok(
      `(b) travel along ${side.name} wall at the near-miss distance equals a free walk within 1e-6`,
      approxEqual(actualTravel, freeTravel, 1e-6),
      `actual=${actualTravel} free=${freeTravel}`
    );
  }
}

// -----------------------------------------------------------------------
// (c) Inner corner: after settling, position change is < 1e-6 PER STEP over
//     60 steps (no jitter at all, not just a loose bound on the total), and
//     backing out moves the capsule > 1e-4 on the FIRST step of reversed
//     input.
// -----------------------------------------------------------------------
{
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  // An L-shaped inner corner opening to the south-east: a wall along row 3
  // (cols 3-7) and a wall along col 3 (rows 3-7), meeting at (3,3). Open
  // floor fills the rest of a 10x10 room.
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let row = '.'.repeat(10);
    if (y >= 3 && y <= 7) row = row.slice(0, 3) + '#' + row.slice(4);
    rows.push(row);
  }
  rows[3] = '.'.repeat(3) + '#'.repeat(5) + '.'.repeat(2);
  const level = loadLevel({ name: 'corner', legend, rows, start: { x: 8, y: 8, facingDeg: 90 } });

  const player = new Player(level);
  player.x = 8; player.y = 8; player.z = 0; player.grounded = true;
  // Drive straight into the notch (NW: yaw 315, pure forward).
  const intoCorner = { forward: 1, strafe: 0, run: true, yawDeg: 315 };
  stepN(player, level, intoCorner, 90); // let it settle first

  let maxStepDelta = 0;
  for (let i = 0; i < 60; i++) {
    const before = { x: player.x, y: player.y };
    player.update(PHYSICS.fixedDt, intoCorner, level);
    const delta = Math.hypot(player.x - before.x, player.y - before.y);
    if (delta > maxStepDelta) maxStepDelta = delta;
  }
  ok('(c) inner corner: settled position change < 1e-6 PER STEP over 60 steps', maxStepDelta < 1e-6, `maxStepDelta=${maxStepDelta}`);
  ok('(c) resting position is outside the wall corner (no penetration)', !circleOverlapsSolid(level, player.x, player.y, PHYSICS.radius));

  const settledX = player.x, settledY = player.y;
  const outOfCorner = { forward: 1, strafe: 0, run: true, yawDeg: 135 }; // reverse (SE)
  player.update(PHYSICS.fixedDt, outOfCorner, level); // first step only
  const firstStepMoved = Math.hypot(player.x - settledX, player.y - settledY);
  ok('(c) backs out of the corner: FIRST step of reversed input moves > 1e-4', firstStepMoved > 1e-4, `moved=${firstStepMoved}`);
}

// -----------------------------------------------------------------------
// (d) Outer corner: the capsule slides along the pillar face IN CONTACT
//     (diagonal input pressed into the face, not a near-miss), and
//     continues past the pillar's end without catching. Tangential speed
//     never drops more than 5% while passing the corner.
// -----------------------------------------------------------------------
{
  const level = pillarLevel();
  const accelSteps = Math.round(PHYSICS.accelTime / PHYSICS.fixedDt);
  for (const run of [false, true]) {
    const speed = run ? PHYSICS.runSpeed : PHYSICS.walkSpeed;
    const player = new Player(level);
    player.z = 0; player.grounded = true; player.vx = 0; player.vy = 0;
    // Start touching the pillar's south face (row 5 spans y in [5,6), so
    // the face is at y=6, the side facing away from the pillar), already
    // within the pillar's column (x in [5,6)) so contact is established
    // immediately, pressing NE (north = into the face from below, east =
    // tangential) so contact is real, not a near-miss. (South, not north,
    // would move AWAY from this face - it only blocks entry from below.)
    player.x = 5.2; player.y = 6 + PHYSICS.radius;
    const controls = { forward: 1, strafe: 0, run, yawDeg: 45 }; // NE
    stepN(player, level, controls, accelSteps + 5); // reach steady sliding speed first

    let minSpeed = Infinity;
    const steps = Math.round(6 / speed / PHYSICS.fixedDt); // cross the pillar and well beyond
    for (let i = 0; i < steps; i++) {
      player.update(PHYSICS.fixedDt, controls, level);
      const v = Math.hypot(player.vx, player.vy);
      if (v < minSpeed) minSpeed = v;
    }
    const tangentialTarget = speed * Math.cos(Math.PI / 4);
    ok(
      `(d) outer corner, ${run ? 'run' : 'walk'}: tangential speed never drops more than 5% while passing`,
      minSpeed >= tangentialTarget * 0.95,
      `minSpeed=${minSpeed} target=${tangentialTarget}`
    );
    ok(`(d) outer corner, ${run ? 'run' : 'walk'}: reaches the far side without catching`, player.x >= 8, `x=${player.x}`);
    ok(`(d) outer corner, ${run ? 'run' : 'walk'}: never penetrated the pillar while passing`, !circleOverlapsSolid(level, player.x, player.y, PHYSICS.radius));
  }
}

// -----------------------------------------------------------------------
// (d, blocking defect) Corner push-out invariant, REPLACED for US-008 ARCH
// CHANGES rework #3. The old per-axis invariant ("resolved coordinate never
// behind the pre-step coordinate, checked per axis") is geometrically
// incompatible with a genuine corner SLIDE: a slide moves the other axis
// too (the architect's own re-check of the PO's worked example: pillar
// (5,5), x=4.834, y=4.75, dx=+0.05 now correctly resolves to about
// (4.874, 4.728) - y moves even though dy=0 was the input). Replaced with
// the two projection invariants from the ARCH CHANGES block, checked
// whenever the pre-step position did NOT already overlap an impassable
// cell, against the full (dx,dy) step vector `d` (not per axis, since the
// new algorithm resolves both axes together):
//   (i)  (res - pre) . d >= -1e-9      (never backwards along the step)
//   (ii) |res - target| <= |d| + 1e-9  (the push-out never exceeds the
//        step length - the old bug pushed 0.184 m on a 0.05 m step)
// Approached from the pillar corner from 16 directions (every 22.5
// degrees) at walk and run for 1 s each, asserted on EVERY step - plus the
// exact worked example from the backlog review.
// -----------------------------------------------------------------------
{
  // The exact worked example from the PO review: pillar at (5,5), capsule
  // at x=4.834, y=4.75 (clear of the corner), moving +0.05 in x. Rework #2
  // resolved x to 4.70 - 0.134 m behind the pre-step 4.834. Rework #3's
  // circle-vs-point + tangential slide resolves to about (4.874, 4.728).
  const level = pillarLevel();
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const example = moveCapsule(level, 4.834, 4.75, 0.05, 0, PHYSICS.radius, 0, true, opts, moveOut);
  const exResVecX = example.x - 4.834, exResVecY = example.y - 4.75;
  const exDot = exResVecX * 0.05 + exResVecY * 0;
  ok(
    'corner push-out worked example (pillar 5,5; x=4.834,y=4.75; dx=+0.05): (res-pre).d >= 0 (never backwards along the step)',
    exDot >= -1e-9,
    `x=${example.x} y=${example.y} dot=${exDot}`
  );
  ok(
    'corner push-out worked example: resolves close to the architect-verified slide (4.874, 4.728)',
    approxEqual(example.x, 4.874, 0.01) && approxEqual(example.y, 4.728, 0.01),
    `x=${example.x} y=${example.y}`
  );

  const pillarCenterX = 5.5, pillarCenterY = 5.5;
  const dt = PHYSICS.fixedDt;
  for (const run of [false, true]) {
    const speed = run ? PHYSICS.runSpeed : PHYSICS.walkSpeed;
    for (let dir = 0; dir < 16; dir++) {
      const angle = (dir * 22.5) * Math.PI / 180;
      // Start 1.5 m out from the pillar centre along this direction,
      // moving straight at the centre - a mix of face-on and corner-on
      // approaches across the 16 directions.
      let x = pillarCenterX + Math.cos(angle) * 1.5;
      let y = pillarCenterY + Math.sin(angle) * 1.5;
      const dxStep = -Math.cos(angle) * speed * dt;
      const dyStep = -Math.sin(angle) * speed * dt;
      const dLen = Math.hypot(dxStep, dyStep);

      let violation = null;
      const steps = Math.round(1 / dt); // 1 s
      for (let i = 0; i < steps; i++) {
        const preOverlapped = circleOverlapsSolid(level, x, y, PHYSICS.radius);
        const targetX = x + dxStep, targetY = y + dyStep;
        const res = moveCapsule(level, x, y, dxStep, dyStep, PHYSICS.radius, 0, true, opts, moveOut);
        if (!preOverlapped) {
          const resVecX = res.x - x, resVecY = res.y - y;
          const dot = resVecX * dxStep + resVecY * dyStep;
          if (dot < -1e-9) violation = `(res-pre).d=${dot} < 0 (moved backwards along the step)`;
          if (!violation) {
            const resTargetDist = Math.hypot(res.x - targetX, res.y - targetY);
            if (resTargetDist > dLen + 1e-9) violation = `|res-target|=${resTargetDist} > |d|=${dLen}`;
          }
        }
        x = res.x; y = res.y;
        if (violation) break;
      }
      ok(
        `(d) corner push-out projection invariants hold (dir=${(dir * 22.5).toFixed(1)} deg, ${run ? 'run' : 'walk'})`,
        !violation,
        violation || ''
      );
    }
  }
}

// -----------------------------------------------------------------------
// (e) Seeded random-walk fuzz in test_room: overlap is checked against
//     whatever `isSectorPassable` considers IMPASSABLE (not only `solid`),
//     each random input is held for 15-60 steps (not re-rolled every
//     step), and the stuck check is exactly as specified: after 30
//     consecutive steps of non-zero input producing < 1e-4 displacement,
//     reversing the input must move the capsule > 1e-4 within 1 step. Run
//     at 5 seeds, 1000 steps each.
// -----------------------------------------------------------------------
{
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const seeds = [20260922, 1, 2, 3, 4];

  for (const seed of seeds) {
    const rand = mulberry32(seed);
    const level = loadLevel(testRoomDef);
    const player = new Player(level);
    let everOverlapped = false;
    let stuckSteps = 0;
    let currentControls = null;
    let stepsRemaining = 0;

    for (let i = 0; i < 1000; i++) {
      if (stepsRemaining <= 0) {
        currentControls = {
          forward: rand() * 2 - 1,
          strafe: rand() * 2 - 1,
          run: rand() > 0.5,
          yawDeg: rand() * 360,
          jumpPressed: false,
        };
        stepsRemaining = 15 + Math.floor(rand() * 46); // hold for 15-60 steps
      }
      stepsRemaining--;

      const before = { x: player.x, y: player.y };
      player.update(PHYSICS.fixedDt, currentControls, level);
      const disp = Math.hypot(player.x - before.x, player.y - before.y);

      if (circleOverlapsImpassable(level, player.x, player.y, PHYSICS.radius, player.z, player.grounded, opts)) {
        everOverlapped = true;
        break;
      }

      const hasInput = Math.abs(currentControls.forward) > 1e-6 || Math.abs(currentControls.strafe) > 1e-6;
      if (hasInput && disp < 1e-4) {
        stuckSteps++;
        if (stuckSteps >= 30) {
          const reversed = { ...currentControls, forward: -currentControls.forward, strafe: -currentControls.strafe };
          const beforeReverse = { x: player.x, y: player.y };
          player.update(PHYSICS.fixedDt, reversed, level);
          const reverseMoved = Math.hypot(player.x - beforeReverse.x, player.y - beforeReverse.y);
          ok(`(e) seed ${seed}: reversed input moves the capsule > 1e-4 after 30 stuck steps`, reverseMoved > 1e-4, `moved=${reverseMoved}`);
          stuckSteps = 0;
          stepsRemaining = 0; // pick a fresh random input next iteration
        }
      } else {
        stuckSteps = 0;
      }
    }
    ok(`(e) seed ${seed}: 1000-step random walk never overlaps an impassable cell`, !everOverlapped);
  }
}

// =======================================================================
// US-008 ARCH CHANGES (rework #3) progress tests: the convex-corner freeze
// the architect found (AC3 "never stuck on corners" - a per-axis push
// cannot express a tangential slide) now resolves via the iterative
// minimum-translation push-out + contact-normal velocity clip. These tests
// exercise the two probes the architect specified: a pillar corner
// approached at small diagonal offsets, and a 1-cell doorway approached
// off-centre.
// =======================================================================

// -----------------------------------------------------------------------
// Pillar corner: approach the pillar's NW corner (grid cell (5,5) in
// pillarLevel(), corner point (5,5)) running/walking SE (yaw 135) from
// 1.5 m out, aimed 0.02 / 0.05 / 0.10 / 0.20 m off the exact diagonal - the
// architect's own probe (verified against a scratch implementation of this
// exact algorithm): cleared in 63-70 steps walking, 36-43 running (free
// path ~51 / ~30). Budgets below are a generous superset of those numbers
// (about 1.5x the free path, per the architect's test spec) so the check
// is meaningful (an old, frozen capsule never clears at all - see (e)'s
// "never more than a few consecutive near-zero-speed steps" companion
// check) without being brittle to small tuning changes.
// -----------------------------------------------------------------------
{
  const level = pillarLevel();
  const corner = { x: 5, y: 5 };
  const yaw = 135; // SE - straight at the pillar's NW corner
  const yawRad = yaw * Math.PI / 180;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad); // travel direction
  const perpX = -dirY, perpY = dirX; // perpendicular, for the off-diagonal offset

  for (const run of [false, true]) {
    const maxSteps = run ? 55 : 90; // budget: architect's 36-43 / 63-70 plus margin
    for (const offset of [0.02, 0.05, 0.10, 0.20]) {
      const player = new Player(level);
      player.x = corner.x - dirX * 1.5 + perpX * offset;
      player.y = corner.y - dirY * 1.5 + perpY * offset;
      player.z = 0; player.grounded = true; player.vx = 0; player.vy = 0;
      const controls = { forward: 1, strafe: 0, run, yawDeg: yaw };

      let clearedAt = -1;
      let maxConsecSlow = 0, consecSlow = 0;
      for (let i = 0; i < maxSteps; i++) {
        player.update(PHYSICS.fixedDt, controls, level);
        const speed = Math.hypot(player.vx, player.vy);
        if (speed < 0.1) { consecSlow++; if (consecSlow > maxConsecSlow) maxConsecSlow = consecSlow; }
        else consecSlow = 0;
        if (player.x >= 6.5 || player.y >= 6.5) { clearedAt = i + 1; break; }
      }
      ok(
        `pillar corner, ${run ? 'run' : 'walk'}, offset ${offset} m off diagonal: clears (x>=6.5 or y>=6.5) within ${maxSteps} steps`,
        clearedAt !== -1,
        `clearedAt=${clearedAt}`
      );
      ok(
        `pillar corner, ${run ? 'run' : 'walk'}, offset ${offset} m off diagonal: never more than 5 consecutive near-stopped steps (|v|<0.1)`,
        maxConsecSlow <= 5,
        `maxConsecSlow=${maxConsecSlow}`
      );
      ok(
        `pillar corner, ${run ? 'run' : 'walk'}, offset ${offset} m off diagonal: never penetrates the pillar`,
        !circleOverlapsSolid(level, player.x, player.y, PHYSICS.radius)
      );
    }
  }
}

// -----------------------------------------------------------------------
// Doorway funnel: a 1-cell-wide gap (x in [5,6)) in an otherwise solid wall
// row (y in [5,6)). The capsule (radius 0.30) only clears the 1 m gap
// without touching a jamb if its centre stays within [5.3, 5.7] - so an
// approach offset by 0.25 / 0.35 / 0.45 m from the centre (5.5) genuinely
// grazes a jamb corner and can only get through if the corner contact's
// normal deflects (funnels) it back toward the centre, not by the straight
// south input alone (forward=1, strafe=0 - there is no sideways input at
// all). Checked both sides of centre, at walk and run.
// -----------------------------------------------------------------------
function doorwayLevel() {
  const legend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
  };
  const rows = [];
  for (let y = 0; y < 12; y++) rows.push(y === 5 ? '#####.#####' : '.'.repeat(11));
  return loadLevel({ name: 'doorway', legend, rows, start: { x: 5.5, y: 2, facingDeg: 180 } });
}

{
  const level = doorwayLevel();
  for (const run of [false, true]) {
    const maxSteps = run ? 120 : 200; // budget: about 2x the ~50/~86-step free time, per the architect's spec
    for (const offset of [0.25, 0.35, 0.45]) {
      for (const sign of [1, -1]) {
        const player = new Player(level);
        player.x = 5.5 + sign * offset; player.y = 2;
        player.z = 0; player.grounded = true; player.vx = 0; player.vy = 0;
        const controls = { forward: 1, strafe: 0, run, yawDeg: 180 }; // straight south, no sideways input

        let clearedAt = -1;
        for (let i = 0; i < maxSteps; i++) {
          player.update(PHYSICS.fixedDt, controls, level);
          if (circleOverlapsSolid(level, player.x, player.y, PHYSICS.radius)) break; // fail loudly below
          if (player.y >= 7) { clearedAt = i + 1; break; }
        }
        ok(
          `doorway funnel, ${run ? 'run' : 'walk'}, offset ${sign * offset} m off centre: passes through within ${maxSteps} steps`,
          clearedAt !== -1,
          `clearedAt=${clearedAt}`
        );
        ok(
          `doorway funnel, ${run ? 'run' : 'walk'}, offset ${sign * offset} m off centre: never penetrates a jamb`,
          !circleOverlapsSolid(level, player.x, player.y, PHYSICS.radius)
        );
      }
    }
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
