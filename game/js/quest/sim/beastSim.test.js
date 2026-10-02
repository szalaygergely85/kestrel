// game/js/quest/sim/beastSim.test.js (US-079a, architecture.md 29.1). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/beastSim.test.js
//
// Loads the real tower level (same engine data game/js/quest/tower.test.js drives) and the real overworld_far
// terrain, then builds custom small Worlds around it (same pattern tower.test.js itself uses for its lantern/lever/
// beacon sub-tests) so every scripted scenario below drives the REAL NavGrid/A*/steer/supportAt/hasLineOfSight, not
// a stub.
//
import {
  World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight,
} from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { canSee } from './sight.js';
import {
  createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN,
} from './beastSim.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; boarMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const TOWER_ORIGIN = { x: 1480, y: 1018, z: 0 };
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };

function beastEntity(id, x, y, home) {
  return {
    id, type: 'beast', x, y, z: 'ground',
    components: {
      voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' },
      brain: { kind: 'beast', home: home || [x, y] },
      targetable: { radius: 0.45, height: 0.7 },
    },
  };
}

function buildWorld(entities) {
  const errs = [];
  const orig = console.warn; console.warn = () => {};
  const w = World.load({
    name: 'beastSimTest', terrain: 'overworld_far',
    structures: [{ id: 'tower', level: 'tower', origin: TOWER_ORIGIN, yawSteps: 0 }],
    entities, state: {},
  }, assets, {});
  console.warn = orig;
  void errs;
  return w;
}

function makeEvents() {
  const hits = [];
  return { hits, events: { emit(name, p) { if (name === 'combat:hit') hits.push({ source: p.source, target: p.target, damage: p.damage }); } } };
}

/** Builds a fresh world + nav + sim over `entities`, seeded rng. */
function freshSim(entities, seed = 1) {
  const world = buildWorld(entities);
  const nav = buildBeastNav(world, NAV_CFG);
  const { events, hits } = makeEvents();
  const rng = createRng(seed);
  const sim = createBeastSim(world, { nav, rng, events });
  return { world, nav, sim, hits, rng };
}

const groundZ = (world, x, y) => world.terrain.heightAt(x, y);

// ---------------------------------------------------------------------------------------------------------------
// 0. createBeastSim returns null with no beast entities.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([]);
  const nav = buildBeastNav(world, NAV_CFG);
  const sim = createBeastSim(world, { nav, rng: createRng(1), events: { emit() {} } });
  ok('createBeastSim returns null with no components.brain entities', sim === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 0b. Q9 item 4: beast entities present but no `nav` block (main.js only builds one from `worldDef.nav`) -> warns
//     and returns null instead of throwing on `nav.grid`.
// ---------------------------------------------------------------------------------------------------------------
{
  const world = buildWorld([beastEntity('boar1', 1500, 1050)]);
  const origWarn = console.warn; let warned = false;
  console.warn = () => { warned = true; };
  let threw = false;
  let sim;
  try { sim = createBeastSim(world, { nav: undefined, rng: createRng(1), events: { emit() {} } }); } catch { threw = true; }
  console.warn = origWarn;
  ok('no nav block: does not throw', !threw);
  ok('no nav block: returns null', sim === null);
  ok('no nav block: warns once', warned);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Scripted transitions.
// ---------------------------------------------------------------------------------------------------------------
{
  // 1a. In cone: beast facing north (default), player 10 m north, inside the 120 deg cone and noticeR -> notice.
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const px = 1461, py = 1021, pz = groundZ(world, px, py);
  sim.step(px, py, pz);
  ok('in cone + in range + LOS -> notice on the first sampled step', sim.state[0] === STATE_NOTICE, `state=${sim.state[0]}`);
}
{
  // 1b. Out of cone: player 10 m SOUTH of a north-facing beast (outside the 120 deg cone, outside nearR) -> no notice.
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const px = 1461, py = 1041, pz = groundZ(world, px, py);
  for (let i = 0; i < 30; i++) sim.step(px, py, pz);
  ok('out of cone, beyond nearR -> stays wander', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}
{
  // 1c. Behind the tower: the player's goal point is INSIDE the tower footprint (a cost-0 cell - genuinely
  // unreachable, not just far) so the chase's A* path gets the beast only as close as the wall allows and it
  // stalls there, within loseR (12 m) but never with line of sight (solid structure in the way): the only way out
  // is the loseSightSec timer (toSteps(5) = 300 steps) -> return. This also covers "hidden 5 s" (29.1's two
  // bullets collapse into one scenario here: the tower footprint is wider (24 m) and deeper (14 m) than noticeR
  // (12 m), so no pair of points on opposite sides of it can ever be within NOTICE range in the first place -
  // only a stuck chase, gated by the larger loseR=20 m, can ever exercise this occlusion end to end).
  const bx = 1481, by = 1017, px = 1490, py = 1025; // px,py inside the tower bbox (1480..1504, 1018..1032)
  ok('sanity: the chosen player point is LOS-blocked by the tower, within loseR, and NOT inside windupR',
    !hasLineOfSight(buildWorld([]), bx, by, 2.5, px, py, 2.5)
    && Math.hypot(px - bx, py - by) <= 20 && Math.hypot(px - bx, py - by) > 5);

  const { world, sim } = freshSim([beastEntity('b1', bx, by)]);
  sim.state[0] = STATE_CHASE;
  sim.goalX[0] = px; sim.goalY[0] = py;
  const pz = groundZ(world, bx, by); // the player's z is irrelevant here (inside the tower, off the hillside terrain)
  let returnedAtStep = -1;
  for (let i = 1; i <= 310; i++) {
    sim.step(px, py, pz);
    if (sim.state[0] === STATE_RETURN) { returnedAtStep = i; break; }
    if (i === 290) ok('still chasing well before 5 s unseen', sim.state[0] === STATE_CHASE, `state=${sim.state[0]} at step ${i}`);
  }
  ok('LOS blocked by the tower, stuck at the wall, for 5 s (300 steps) -> return', returnedAtStep > 0 && returnedAtStep <= 301, `returnedAtStep=${returnedAtStep}`);
}
{
  // 1d. > 20 m: chasing beast, player suddenly > loseR away -> return immediately (next step).
  const { world, sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  sim.state[0] = STATE_CHASE;
  const px = 1461, py = 1031 - 25, pz = groundZ(world, px, py); // 25 m away, open field (well beyond loseR)
  sim.step(px, py, pz);
  ok('> 20 m away -> return', sim.state[0] === STATE_RETURN, `state=${sim.state[0]}`);
}
{
  // 1e. Wall hit: forced charge straight into the tower's west wall from just outside it - steering cannot enter
  // the structure's cost-0 cells, so the beast stalls and, from charge step 4 on, two slow steps in a row -> recover
  // (2.0 s, longer than a normal charge-end recover).
  const bx = 1476, by = 1025;
  const { sim } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 1; sim.cdy[0] = 0; // straight east, into the tower (west wall at x=1480)
  let recoveredAt = -1, recoverTimerAtEntry = 0;
  for (let i = 1; i <= 60; i++) {
    sim.step(1e6, 1e6, 0); // player far away and irrelevant to this scenario
    if (sim.state[0] === STATE_RECOVER) { recoveredAt = i; recoverTimerAtEntry = sim.timer[0]; break; }
  }
  ok('charging into the tower wall -> recover', recoveredAt > 0, `recoveredAt=${recoveredAt}`);
  ok('a wall-hit recover uses recoverWallSec (2.0 s), not the shorter normal recoverSec',
    recoverTimerAtEntry === sim.cfgSteps.recoverWall, `timer=${recoverTimerAtEntry} wall=${sim.cfgSteps.recoverWall} normal=${sim.cfgSteps.recover}`);
}
{
  // 1f. Contact: forced charge straight at a player standing within contact range -> exactly one combat:hit, then
  // recover (the shorter, non-wall recoverSec).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5; // 0.5 m north, inside radius(0.45)+PHYSICS.radius(0.3)+0.1
  const { sim, hits } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight toward the player
  for (let i = 0; i < 10; i++) sim.step(px, py, 0);
  ok('contact sends exactly one combat:hit', hits.length === 1, `hits=${JSON.stringify(hits)}`);
  ok('the hit payload shape matches {source, target:"player", damage:1}',
    hits[0] && hits[0].source === 'b1' && hits[0].target === 'player' && hits[0].damage === 1);
  ok('contact -> recover (normal recoverSec, not the wall one)', sim.state[0] === STATE_RECOVER && sim.timer[0] <= sim.cfgSteps.recover);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. 5 scripted chases from the far side of the tower reach contact within 30 s; the beast is never in a cost-0
//    cell, and z stays within 0.1 m of supportAt.
// ---------------------------------------------------------------------------------------------------------------
{
  // Each pair is verified LOS-blocked by the tower (a corner or the full depth between them) and within loseR (20
  // m, so a forced CHASE start does not immediately exit via the "d > loseR" rule) - the beast must route around
  // the tower's footprint (never through it) to close the distance.
  const farSideRuns = [
    [1476, 1016, 1484, 1034],
    [1477, 1015, 1485, 1033],
    [1508, 1016, 1500, 1034],
    [1507, 1015, 1499, 1033],
    [1481, 1017, 1481, 1033],
  ];
  let allReached = true;
  for (let t = 0; t < farSideRuns.length; t++) {
    const [beastX, beastY, px, py] = farSideRuns[t];
    const { world, sim, nav } = freshSim([beastEntity('b1', beastX, beastY)], 10 + t);
    sim.state[0] = STATE_CHASE;
    const pz = groundZ(world, px, py);
    let hit = false, badCell = false, badZ = false;
    for (let i = 0; i < 1800 && !hit; i++) { // 30 s @ 60 Hz
      sim.step(px, py, pz);
      const cx = nav.grid.cellX(sim.steer.x[0]), cy = nav.grid.cellY(sim.steer.y[0]);
      if (nav.grid.inBounds(cx, cy) && nav.grid.cost[nav.grid.index(cx, cy)] === 0) badCell = true;
      const support = world.supportAt(sim.steer.x[0], sim.steer.y[0], sim.entities[0].transform.z + 0.6, true, { height: 0, stepUpMax: 1.0, walkCos: -1 });
      if (Math.abs(sim.entities[0].transform.z - support.floorH) > 0.1) badZ = true;
      hit = sim.state[0] === STATE_RECOVER; // contact (not timeout/wall - checked via distance below)
    }
    const d = Math.hypot(px - sim.steer.x[0], py - sim.steer.y[0]);
    const contactR = 0.45 + 0.3 + 0.1;
    const reachedByContact = hit && d <= contactR + 0.5; // small slop for the step the contact landed on
    if (!reachedByContact || badCell || badZ) {
      allReached = false;
      failures.push(`chase ${t} to (${px},${py}): reached=${reachedByContact} badCell=${badCell} badZ=${badZ} finalD=${d.toFixed(2)}`);
    }
  }
  ok('5 scripted chases from the far side of the tower reach contact within 30 s, never in a cost-0 cell, z within 0.1 m of supportAt', allReached);
}

// ---------------------------------------------------------------------------------------------------------------
// 3 + 4. Determinism replay (600 steps, two fresh runs) and save/load round trip (save @ 300, fresh sim, same
//    hash @ 600).
// ---------------------------------------------------------------------------------------------------------------
function scriptedPlayer(step) {
  // A simple back-and-forth linear path near boar1's home (1461, 1031) - no trig, just a triangle wave.
  const period = 240, amp = 14;
  const t = step % period;
  const frac = t < period / 2 ? t / (period / 2) : 2 - t / (period / 2);
  return { x: 1461 + (frac - 0.5) * amp, y: 1031 + (frac - 0.5) * amp * 0.6, z: 0 };
}

function hashAt(sim, steer, tick, rng) {
  const h = createHasher();
  h.u32(tick);
  rng.hashInto(h);
  h.u32(steer.hash());
  sim.hashInto(h);
  return h.value();
}

{
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA } = freshSim(entities(), 42);
  const { world: wB, sim: simB, rng: rngB } = freshSim(entities(), 42);
  void wA; void wB;

  const checkpoints = [];
  let agree = true;
  for (let i = 1; i <= 600; i++) {
    const p = scriptedPlayer(i);
    const pzA = groundZ(wA, p.x, p.y), pzB = groundZ(wB, p.x, p.y);
    simA.step(p.x, p.y, pzA);
    simB.step(p.x, p.y, pzB);
    if (i % 60 === 0) {
      const ha = hashAt(simA, simA.steer, i, rngA);
      const hb = hashAt(simB, simB.steer, i, rngB);
      checkpoints.push([i, ha, hb]);
      if (ha !== hb) agree = false;
    }
  }
  ok('600-step determinism replay: hash equal at every 60-step checkpoint and at the end',
    agree, JSON.stringify(checkpoints));
}

{
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA } = freshSim(entities(), 7);

  for (let i = 1; i <= 300; i++) {
    const p = scriptedPlayer(i);
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const savedSim = simA.save();
  const savedRng = rngA.save();
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const hashA600 = hashAt(simA, simA.steer, 600, rngA);

  const { world: wB, sim: simB, rng: rngB } = freshSim(entities(), 7);
  rngB.load(savedRng);
  simB.load(savedSim);
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simB.step(p.x, p.y, groundZ(wB, p.x, p.y));
  }
  const hashB600 = hashAt(simB, simB.steer, 600, rngB);
  ok('save() at step 300, load() into a fresh sim: same hash at step 600',
    hashA600 === hashB600, `A=${hashA600} B=${hashB600}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. RE-05c drop-rule fixture through buildFromArrays (same shape as engine/nav/NavGrid.test.js's own RE-05c
//    fixture - this just confirms world_m1's chosen maxStepM: 1 content value actually blocks the drop it should).
// ---------------------------------------------------------------------------------------------------------------
{
  const w = 3, h = 1, n = w * h;
  const slopeOk = new Uint8Array(n).fill(1);
  const type = new Uint8Array(n).fill(0);
  const bigStep = Float32Array.from([0, 0, 1.5]);
  const gridBlocked = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  gridBlocked.buildFromArrays(bigStep, slopeOk, type, { typeNames: ['grass'], maxStepM: NAV_CFG.maxStepM });
  ok('RE-05c through buildFromArrays: a 1.5 m step with the content maxStepM (1) drops both edge cells',
    gridBlocked.cost[1] === 0 && gridBlocked.cost[2] === 0, gridBlocked.cost.join(','));

  const smallStep = Float32Array.from([0, 0, 0.9]);
  const gridOk = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  gridOk.buildFromArrays(smallStep, slopeOk, type, { typeNames: ['grass'], maxStepM: NAV_CFG.maxStepM });
  ok('RE-05c through buildFromArrays: a 0.9 m step under the content maxStepM stays walkable',
    gridOk.cost[1] === 1 && gridOk.cost[2] === 1, gridOk.cost.join(','));
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Perf budget (warn-only unless PERF_STRICT=1): 8 beasts, step mean <= 0.1 ms, p95 (ticks that run an A*)
//    <= 0.3 ms, zero allocation over 10k steps.
// ---------------------------------------------------------------------------------------------------------------
{
  const ents = [];
  for (let k = 0; k < 8; k++) ents.push(beastEntity(`perf${k}`, 1455 + k, 1028 + (k % 3)));
  const { world, sim } = freshSim(ents, 99);
  for (let i = 0; i < 8; i++) sim.state[i] = STATE_CHASE; // worst case: every beast pathing/chasing
  const px = 1500, py = 1025, pz = groundZ(world, px, py);

  const N = 2000;
  const times = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    sim.step(px, py, pz);
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1e6;
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / N;
  const p95 = sorted[Math.floor(N * 0.95)];
  const strict = process.env.PERF_STRICT === '1';
  const okMean = mean <= 0.1, okP95 = p95 <= 0.3;
  if (!okMean || !okP95) console.warn(`[perf] 8-beast step mean=${mean.toFixed(4)}ms p95=${p95.toFixed(4)}ms (budget 0.1/0.3ms)`);
  ok('perf: 8-beast step mean/p95 within budget (or PERF_STRICT unset)', strict ? (okMean && okP95) : true, `mean=${mean} p95=${p95}`);

  if (global.gc) {
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) sim.step(px, py, pz);
    global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    ok('zero allocation over 10k steps (--expose-gc heap check)', heapAfter <= heapBefore + 1e6, `before=${heapBefore} after=${heapAfter}`);
  } else {
    console.log('(skip) zero-allocation heap check needs --expose-gc');
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
