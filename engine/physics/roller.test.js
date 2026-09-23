// engine/physics/roller.test.js (US-013). Headless Node ESM, no framework -
// matches physics.test.js's pattern. Run with:
//
//   node engine/physics/roller.test.js
//
// Covers docs/backlog.md US-013 tech notes item 6: restitution on a face
// and on a corner, cannot climb a 0.01 m rise, drops are allowed, friction
// settles without reversing, sleep/wake, the push threshold at 0.49 vs
// 0.51 m/s, the actor's speedScale, the no-overlap invariant under 600
// steps of squeezing, determinism, and a serialize/deserialize round trip
// mid-roll. Exits 0 and prints "ALL PASS" if every check passes, exits 1
// and lists failures otherwise.
import { loadLevel } from '../world/Level.js';
import { World } from '../world/World.js';
import { moveCapsule } from './capsule.js';
import { stepRollers, resolveBodyContacts, rollFrame } from './roller.js';
import { PHYSICS } from './config.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
function approxEqual(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

// ---- a small synthetic level (14x10), open floor/sky ceiling everywhere
// except the border and one obstacle 'o', a tiny 0.01 m rise 'r' and a pit
// 'v' - so face/corner/step/drop cases are exact and independent of the
// real tower data. `game/js/quest/boulder.test.js` covers the real data.
//
//   0123456789012 3
// 0 ##############
// 1 #............#
// 2 #............#
// 3 #......o.....#   o = solid obstacle, corner at (6,3)
// 4 #............#
// 5 #........r..v#   r = +0.01 m rise (col 9), v = pit, floorH -2 (col 12)
// 6 #............#
// 7 #............#
// 8 #............#
// 9 ##############
const legend = {
  '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
  'o': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
  'r': { floorH: 0.01, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false },
  'v': { floorH: -2, ceilH: 'sky', wallMat: 'rubble', floorMat: 'rubble', ceilMat: 'sky', solid: false },
};
const rows = [
  '##############',
  '#............#',
  '#............#',
  '#......o.....#',
  '#............#',
  '#........r..v#',
  '#............#',
  '#............#',
  '#............#',
  '##############',
];
// Tilt layer: '.' everywhere except an E ('6') patch at (3,5) and a sink
// ('5') at (10,7), toward hollowCenter (10.5, 7.5) - away from every other
// scenario below so they see tilt (0, 0).
const tiltRows = [
  '..............',
  '..............',
  '..............',
  '..............',
  '..............',
  '...6..........',
  '..............',
  '..........5...',
  '..............',
  '..............',
];
const ROLLER_LEVEL = {
  name: 'roller_test',
  legend,
  rows,
  layers: { tilt: tiltRows },
  tilt: { grade: 0.05, hollowCenter: { x: 10.5, y: 7.5 } },
  start: { x: 1.5, y: 1.5, facingDeg: 0 },
};

const level = loadLevel(ROLLER_LEVEL);
ok('level loads', !!level);

const ORIGIN = { x: 0, y: 0, z: 0 };
class FakeWorld {
  constructor(lvl) { this.level = lvl; this._entities = []; }
  sectorAt(x, y) { return this.level.sectorAt(x, y); }
  outsideSector(x, y) { return this.level.outsideSector(x, y); }
  structureAt(x, y) {
    return this.level.inBounds(Math.floor(x), Math.floor(y)) ? { level: this.level, origin: ORIGIN } : null;
  }
  forEachEntity(fn) { for (const e of this._entities) fn(e); }
}

function makeEntity(id, x, y, z, radius, vx, vy, rollerOverrides = {}) {
  return {
    id,
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: {
      body: { radius, vx, vy, vz: 0, grounded: true },
      roller: { restitution: 0.3, rollFriction: 0.8, sleepSpeed: 0.05, ...rollerOverrides },
    },
  };
}

function makeActor(x, y, z, vx, vy) {
  return {
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: PHYSICS.radius, vx, vy, vz: 0, grounded: true } },
  };
}

const dt = PHYSICS.fixedDt;

// ---- rollFrame ---------------------------------------------------------
{
  ok('rollFrame(0, 0.6, 8) === 0', rollFrame(0, 0.6, 8) === 0);
  const circumference = 2 * Math.PI * 0.6;
  ok('rollFrame(one full turn, ...) === 0 (mod nFrames)', rollFrame(circumference, 0.6, 8) === 0);
  ok('rollFrame(half turn, ...) === 4', rollFrame(circumference / 2, 0.6, 8) === 4);
  ok('rollFrame is monotonic within one turn', rollFrame(circumference * 0.1, 0.6, 8) <= rollFrame(circumference * 0.4, 0.6, 8));
}

// ---- A. restitution on a flat FACE --------------------------------------
{
  const w = new FakeWorld(level);
  // obstacle 'o' spans x in [7,8); contact (radius 0.6) at x = 7 - 0.6 = 6.4.
  const e = makeEntity('face', 6.4, 3.5, 0, 0.6, 5, 0, { rollFriction: 0 });
  w._entities.push(e);
  stepRollers(w, dt, PHYSICS);
  ok('face hit: vx bounces to -restitution*vx', approxEqual(e.components.body.vx, -0.3 * 5, 0.15), `vx=${e.components.body.vx}`);
  ok('face hit: vy stays 0 (pure face, not a corner)', approxEqual(e.components.body.vy, 0, 1e-6));
  ok('face hit: pushed back out, not through the wall', e.transform.x <= 6.4 + 1e-3);
}

// ---- B. restitution on a CORNER ------------------------------------------
{
  const w = new FakeWorld(level);
  const cornerX = 7, cornerY = 3; // obstacle's NW corner
  const d = 0.6; // exactly at contact distance, heading straight at the corner
  const ux = Math.SQRT1_2, uy = Math.SQRT1_2;
  const x0 = cornerX - d * ux, y0 = cornerY - d * uy;
  const speed = 5;
  const e = makeEntity('corner', x0, y0, 0, 0.6, speed * ux, speed * uy, { rollFriction: 0 });
  const w2 = new FakeWorld(level);
  w2._entities.push(e);
  stepRollers(w2, dt, PHYSICS);
  const outSpeed = Math.hypot(e.components.body.vx, e.components.body.vy);
  ok('corner hit: bounced back (both components reversed)', e.components.body.vx < 0 && e.components.body.vy < 0,
    `vx=${e.components.body.vx} vy=${e.components.body.vy}`);
  ok('corner hit: outgoing speed ~= restitution * incoming speed', approxEqual(outSpeed, 0.3 * speed, 0.3),
    `outSpeed=${outSpeed}`);
}

// ---- C. cannot climb a 0.01 m rise ---------------------------------------
{
  const w = new FakeWorld(level);
  // 'r' at col 9 (floorH 0.01) is east of '.' at col 8 (floorH 0); contact at x = 9 - radius = 8.4.
  const e = makeEntity('rise', 8.0, 5.5, 0, 0.6, 2, 0, { rollFriction: 0 });
  w._entities.push(e);
  for (let i = 0; i < 90; i++) stepRollers(w, dt, PHYSICS);
  ok('0.01 m rise blocks the roller (step threshold 0)', e.transform.x <= 8.4 + 1e-2, `x=${e.transform.x}`);
}

// ---- D. drops are allowed -------------------------------------------------
{
  const w = new FakeWorld(level);
  // 'v' at col 12 (floorH -2) is east of '.' at col 11 (floorH 0); the boundary is x = 12.
  const e = makeEntity('drop', 11.0, 5.5, 0, 0.6, 2, 0, { rollFriction: 0 });
  w._entities.push(e);
  for (let i = 0; i < 90; i++) stepRollers(w, dt, PHYSICS);
  ok('drop crossed the boundary (not blocked horizontally)', e.transform.x > 12, `x=${e.transform.x}`);
  ok('drop: fell to the pit floor', approxEqual(e.transform.z, -2, 1e-2), `z=${e.transform.z}`);
  ok('drop: grounded again after landing', e.components.body.grounded === true);
}

// ---- E/F. friction settles without reversing, then sleeps ----------------
{
  const w = new FakeWorld(level);
  const e = makeEntity('friction', 2.0, 1.5, 0, 0.6, 2, 0, { rollFriction: 0.8, sleepSpeed: 0.05 });
  w._entities.push(e);
  let prevVx = e.components.body.vx;
  let neverReversed = true;
  let sleptAt = -1;
  for (let i = 0; i < 300 && sleptAt < 0; i++) {
    stepRollers(w, dt, PHYSICS);
    const vx = e.components.body.vx;
    if (vx < -1e-9) neverReversed = false; // friction must clamp at 0, never push past it
    if (vx > prevVx + 1e-9) neverReversed = false; // must be non-increasing while positive
    prevVx = vx;
    if (e.components.roller.sleeping) sleptAt = i;
  }
  ok('friction never reverses the velocity it decelerates', neverReversed);
  ok('roller eventually sleeps (slow + untilted for sleepTime)', sleptAt >= 0, `sleptAt=${sleptAt}`);
  ok('sleeping roller has v = 0', e.components.body.vx === 0 && e.components.body.vy === 0);
}

// ---- G/H. push threshold 0.49 vs 0.51 m/s; actor speedScale --------------
{
  const w = new FakeWorld(level);
  const roller = makeEntity('pushed', 5.0, 5.0, 0, 0.6, 0, 0);
  roller.components.roller.sleeping = true;
  roller.components.roller.sleepT = 0;
  w._entities.push(roller);

  // 0.49 m/s: below threshold, no push, no wake.
  let actor = makeActor(5.85, 5.0, 0, -0.49, 0);
  resolveBodyContacts(w, actor, PHYSICS);
  ok('0.49 m/s does not push', roller.components.body.vx === 0 && roller.components.body.vy === 0);
  ok('0.49 m/s does not wake a sleeping roller', roller.components.roller.sleeping === true);
  ok('0.49 m/s: actor speedScale stays 1', actor.components.body.speedScale === 1);

  // 0.51 m/s: above threshold, pushes and wakes. Reset the roller's
  // position first - the 0.49 call above still ran separation (which is
  // unconditional whenever overlapping), moving it slightly.
  roller.transform.x = 5.0;
  roller.transform.y = 5.0;
  actor = makeActor(5.85, 5.0, 0, -0.51, 0);
  resolveBodyContacts(w, actor, PHYSICS);
  ok('0.51 m/s pushes the roller (nonzero velocity along -n)', roller.components.body.vx < 0, `vx=${roller.components.body.vx}`);
  ok('0.51 m/s wakes a sleeping roller', roller.components.roller.sleeping === false);
  ok('0.51 m/s: actor speedScale becomes pushSpeedScale', actor.components.body.speedScale === PHYSICS.pushSpeedScale);

  // Not touching: speedScale resets to 1 even though the roller was just pushed.
  const farActor = makeActor(50, 50, 0, -5, 0);
  resolveBodyContacts(w, farActor, PHYSICS);
  ok('no contact: actor speedScale resets to 1', farActor.components.body.speedScale === 1);
}

// ---- I. no-overlap invariant over 600 steps of squeezing ------------------
{
  const w = new FakeWorld(level);
  // West border wall at x = 1; a roller resting against it (contact at x = 1 + 0.6).
  const roller = makeEntity('squeeze', 1.6, 5.0, 0, 0.6, 0, 0);
  w._entities.push(roller);
  const minSep = PHYSICS.radius + 0.6;
  const actor = makeActor(1.6 + minSep - 0.05, 5.0, 0, -3, 0); // already slightly overlapping, pushing hard west
  const actorMoveOpts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax };
  const actorMoveOut = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0 };

  let worstOverlap = -Infinity;
  for (let i = 0; i < 600; i++) {
    actor.components.body.vx = -3; // keep driving the actor into the roller every step
    const moved = moveCapsule(w, actor.transform.x, actor.transform.y, actor.components.body.vx * dt, actor.components.body.vy * dt,
      actor.components.body.radius, actor.transform.z, actor.components.body.grounded, actorMoveOpts, actorMoveOut);
    actor.transform.x = moved.x;
    actor.transform.y = moved.y;

    stepRollers(w, dt, PHYSICS);
    resolveBodyContacts(w, actor, PHYSICS);

    const dist = Math.hypot(actor.transform.x - roller.transform.x, actor.transform.y - roller.transform.y);
    const overlap = minSep - dist;
    if (overlap > worstOverlap) worstOverlap = overlap;
  }
  ok('600-step squeeze: never overlaps beyond the 1e-3 m tolerance', worstOverlap <= 1e-3 + 1e-6, `worstOverlap=${worstOverlap}`);
  ok('600-step squeeze: roller stays on its side of the wall', roller.transform.x >= 1.0 - 1e-3, `rollerX=${roller.transform.x}`);
}

// ---- I2. forced fallback: both restore branches (US-013 ARCH CHANGES #1) -
// A hand-rolled WorldQuery (not a grid `Level` - D-008 allows any object
// with the `sectorAt`/`outsideSector` shape) with a dead-end alcove: solid
// for x < 1 (west wall, wedges the roller - its own separation move is a
// no-op) and solid for x > 2.75 (east wall, close enough that the actor's
// own separation move also cannot reach the full `minSep` distance - both
// `moveSphere` and `moveCapsule` fail to fully resolve the overlap, forcing
// the final restore-to-`prevX/prevY` branch). `prevX/prevY` stands in for
// the position `integrate` recorded at the START of this step (legal,
// non-overlapping, per the ARCH CHANGES fix) - deliberately far from the
// alcove, isolating exactly the restore path from the (already-covered)
// wall/separation geometry.
{
  const OPEN = { floorH: 0, ceilH: 'sky', solid: false };
  const WALL = { floorH: 3, ceilH: 'sky', solid: true };
  // Cell centres are what `isSectorPassable` actually samples (capsule.js:
  // `col + 0.5`), so the walls are placed at whole-metre column faces: col 0
  // (x < 1) and col 2 (x in [2, 3)) both solid, col 1 (x in [1, 2)) the only
  // open column - too narrow for the roller (diameter 1.2 m) to fit without
  // touching both faces at once, wedging it in place; the same col-2 face
  // also stops the actor's own escape a few cm later.
  const alcoveWorld = {
    sectorAt(x, y) { return (x < 1 || (x >= 2 && x < 3)) ? WALL : OPEN; },
    outsideSector() { return WALL; },
    structureAt() { return null; },
    _entities: [],
    forEachEntity(fn) { for (const e of this._entities) fn(e); },
  };
  const roller = makeEntity('wedged', 1.5, 5, 0, 0.6, 0, 0);
  roller.components.roller.sleeping = true;
  alcoveWorld._entities.push(roller);

  const actor = makeActor(1.7, 5, 0, 0, 0);
  actor.components.body.prevX = 10; // far away: legal, non-overlapping "step-start"
  actor.components.body.prevY = 10;

  resolveBodyContacts(alcoveWorld, actor, PHYSICS);

  ok('forced fallback: roller stayed wedged in the 1-wide column (never reached open col 3+)', roller.transform.x < 2, `rollerX=${roller.transform.x}`);
  ok('forced fallback: actor restored to prevX/prevY, not the still-overlapping position',
    actor.transform.x === 10 && actor.transform.y === 10, `x=${actor.transform.x} y=${actor.transform.y}`);
  const finalDist = Math.hypot(actor.transform.x - roller.transform.x, actor.transform.y - roller.transform.y);
  const finalOverlap = Math.max(0, (actor.components.body.radius + roller.components.body.radius) - finalDist);
  ok('forced fallback: final overlap <= 1e-3 after restore', finalOverlap <= 1e-3, `finalOverlap=${finalOverlap}`);
}

// ---- J. determinism -------------------------------------------------------
{
  function runScenario(steps) {
    const w = new FakeWorld(level);
    // Starts on the tilt patch (3, 5) heading E, so both tilt accel and friction/bounces are exercised.
    const e = makeEntity('det', 3.5, 5.5, 0, 0.6, 0.2, 0.1);
    w._entities.push(e);
    for (let i = 0; i < steps; i++) stepRollers(w, dt, PHYSICS);
    const b = e.components.body, r = e.components.roller;
    return { x: e.transform.x, y: e.transform.y, z: e.transform.z, vx: b.vx, vy: b.vy, rollDist: r.rollDist, sleeping: r.sleeping };
  }
  const r1 = runScenario(200);
  const r2 = runScenario(200);
  ok('determinism: two runs are bit-identical', JSON.stringify(r1) === JSON.stringify(r2), `${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
}

// ---- K. serialize mid-roll -> deserialize continues identically ----------
{
  const world = new World();
  world.placeStructure(ROLLER_LEVEL, { x: 0, y: 0, z: 0 }, 'lvl');
  world.spawn('prop', { x: 3.5, y: 5.5, z: 0, yawDeg: 0, pitchDeg: 0 },
    { body: { radius: 0.6, vx: 1.5, vy: 0.3, vz: 0, grounded: true }, roller: { restitution: 0.3, rollFriction: 0.8, sleepSpeed: 0.05 } },
    'roller1');

  for (let i = 0; i < 40; i++) stepRollers(world, dt, PHYSICS); // mid-roll

  const { serialize, deserialize } = await import('../world/serialize.js');
  const stateJson = JSON.parse(JSON.stringify(serialize(world)));
  const fakeAssets = { level: (k) => (k === 'roller_test' ? ROLLER_LEVEL : undefined) };
  const world2 = deserialize(stateJson, fakeAssets);

  for (let i = 0; i < 60; i++) { stepRollers(world, dt, PHYSICS); stepRollers(world2, dt, PHYSICS); }

  const e1 = world.entity('roller1'), e2 = world2.entity('roller1');
  const snap = (e) => ({
    x: e.transform.x, y: e.transform.y, z: e.transform.z,
    vx: e.components.body.vx, vy: e.components.body.vy,
    rollDist: e.components.roller.rollDist, sleeping: e.components.roller.sleeping,
  });
  ok('serialize/deserialize mid-roll continues identically', JSON.stringify(snap(e1)) === JSON.stringify(snap(e2)),
    `${JSON.stringify(snap(e1))} vs ${JSON.stringify(snap(e2))}`);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
