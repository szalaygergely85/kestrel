// game/js/quest/sim/beastSim.test.js (US-079a, architecture.md 29.1). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/beastSim.test.js
//
// Loads the real tower level (same engine data game/js/quest/tower.test.js drives) and the real overworld_far
// terrain, then builds custom small Worlds around it (same pattern tower.test.js itself uses for its lantern/lever/
// beacon sub-tests) so every scripted scenario below drives the REAL NavGrid/A*/steer/supportAt/hasLineOfSight, not
// a stub.
//
import {
  World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS,
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
import m3PropsMod from '../../../../design/models/m3_props.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { canSee } from './sight.js';
import { SWORD_CFG } from '../swordConfig.js';
import { createSwordSim, ST_HARD } from './sword.js';
import { createTargeting } from '../targeting.js';
import { presentBeasts } from '../beastView.js';
import {
  createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN,
  STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE,
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

function buildWorld(entities, physics = 'grid') {
  const errs = [];
  const orig = console.warn; console.warn = () => {};
  const w = World.load({
    name: 'beastSimTest', terrain: 'overworld_far',
    structures: [{ id: 'tower', level: 'tower', origin: TOWER_ORIGIN, yawSteps: 0 }],
    entities, state: {},
  }, assets, { physics });
  console.warn = orig;
  void errs;
  return w;
}

function makeEvents() {
  const hits = [];
  const died = [];
  const sinks = [];
  const listeners = new Map();
  const events = {
    on(name, fn) {
      let s = listeners.get(name);
      if (!s) { s = new Set(); listeners.set(name, s); }
      s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, p) {
      if (name === 'combat:hit') hits.push({ source: p.source, target: p.target, damage: p.damage, heavy: p.heavy, dirX: p.dirX, dirY: p.dirY });
      if (name === 'beast:died') died.push({ id: p.id, x: p.x, y: p.y, z: p.z, cause: p.cause });
      if (name === 'beast:sink') sinks.push({ id: p.id, x: p.x, y: p.y, z: p.z });
      const s = listeners.get(name);
      if (!s) return;
      for (const fn of Array.from(s)) fn(p);
    },
  };
  return { hits, died, sinks, events };
}

/** Builds a fresh world + nav + sim over `entities`, seeded rng. */
function freshSim(entities, seed = 1, physics = 'grid') {
  const world = buildWorld(entities, physics);
  const nav = buildBeastNav(world, NAV_CFG);
  const { events, hits, died, sinks } = makeEvents();
  const rng = createRng(seed);
  const sim = createBeastSim(world, { nav, rng, events });
  return { world, nav, sim, hits, died, sinks, rng, events };
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

// ---------------------------------------------------------------------------------------------------------------
// 9. US-078d amendment (D-034) "Stagger (beastSim, heavy only)": a heavy sword `combat:hit` on the beast's own id
//    enters STATE_STAGGER from ANY state, for 36 steps (0.6 s), with no contact hit possible during it (contact
//    only fires from STATE_CHARGE, which the stagger left), a knockback displacement of ~0.6-0.7 m, then chase
//    (if still seen) or return. A light hit has no beast-side effect in this story.
// ---------------------------------------------------------------------------------------------------------------
function emitHeavyHit(events, targetId, dirX, dirY) {
  events.emit('combat:hit', { source: 'player', target: targetId, damage: 3, heavy: 1, dirX, dirY, px: 0, py: 0, pz: 0 });
}

{
  // Heavy hit while the beast is in WINDUP -> stagger immediately (interrupts windup).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  emitHeavyHit(events, 'b1', 1, 0); // knock east
  ok('heavy hit in windup -> STATE_STAGGER', sim.state[0] === STATE_STAGGER, `state=${sim.state[0]}`);
  ok('stagger timer = cfgSteps.stagger (36 steps / 0.6 s)', sim.timer[0] === sim.cfgSteps.stagger, `timer=${sim.timer[0]}`);
}

{
  // Heavy hit while CHARGING -> stagger interrupts the charge; no contact hit lands during the stagger, and the
  // beast displaces ~0.6-0.7 m (per the amendment's own worked number: staggerKnock 4 m/s decaying by accel 12).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5; // would otherwise be a contact hit next step (1f precedent)
  const { sim, hits, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight toward the (otherwise contact-range) player
  emitHeavyHit(events, 'b1', 0, 1); // knock south (away from the player) - this is the test's own input, not a beast contact
  ok('heavy hit in charge -> STATE_STAGGER (interrupts the charge)', sim.state[0] === STATE_STAGGER, `state=${sim.state[0]}`);
  const startX = sim.steer.x[0], startY = sim.steer.y[0];
  for (let i = 0; i < sim.cfgSteps.stagger; i++) sim.step(px, py, 0);
  const beastContacts = hits.filter((h) => h.source === 'b1');
  ok('no contact hit (beast-initiated) during the stagger (charge contact is impossible while staggered)',
    beastContacts.length === 0, `hits=${JSON.stringify(hits)}`);
  const dx = sim.steer.x[0] - startX, dy = sim.steer.y[0] - startY;
  const disp = Math.sqrt(dx * dx + dy * dy);
  ok('stagger displaces roughly 0.6-0.7 m before decaying to a stop', disp > 0.4 && disp < 1.0, `disp=${disp.toFixed(3)}`);
  ok('stagger ends -> chase or return (not idle/wander)', sim.state[0] === STATE_CHASE || sim.state[0] === STATE_RETURN, `state=${sim.state[0]}`);
}

{
  // The charge wall-slow streak counter (the reused `unseen` field) is cleared on entering stagger.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.unseen[0] = 1; // one slow-charge step already counted toward the wall-recover streak
  emitHeavyHit(events, 'b1', 1, 0);
  ok('entering stagger clears the reused wall-streak counter (unseen)', sim.unseen[0] === 0, `unseen=${sim.unseen[0]}`);
}

{
  // Facing frozen while staggered: a notice-style facing update (toward the player) must NOT happen.
  const bx = 1461, by = 1031, px = bx + 5, py = by; // player to the east
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.fx[0] = 0; sim.fy[0] = -1; // facing north
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  emitHeavyHit(events, 'b1', 0, 1); // knock south
  sim.step(px, py, 0);
  ok('facing stays frozen while staggered', sim.fx[0] === 0 && sim.fy[0] === -1, `fx=${sim.fx[0]} fy=${sim.fy[0]}`);
}

{
  // US-079b: a damaging light hit flinches the beast (stagger is heavy-only), deals 1 HP, and aggroes.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WANDER;
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 1, heavy: 0, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('a light hit flinches the beast (not a stagger)', sim.state[0] === STATE_FLINCH && sim.timer[0] === sim.cfgSteps.flinch, `state=${sim.state[0]}`);
  ok('a light hit deals 1 HP and aggroes', sim.entities[0].components.health.hp === 3
    && sim.seen[0] === 1 && sim.unseen[0] === 0 && sim.dmgCd[0] === sim.cfgSteps.dmgCooldown && sim.hurtT[0] === 0);
}

{
  // resetAll clears stagger back to wander/home.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WANDER;
  emitHeavyHit(events, 'b1', 1, 0);
  ok('staggered before resetAll', sim.state[0] === STATE_STAGGER);
  sim.resetAll();
  ok('resetAll clears stagger -> wander at home', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}

{
  // dispose() drops the combat:hit listener (no leak across a world reload - the same precedent as
  // targeting.dispose()/vitals.dispose(); main.js must call this before the next createBeastSim, see the report).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.dispose();
  sim.state[0] = STATE_WANDER;
  emitHeavyHit(events, 'b1', 1, 0);
  ok('dispose() drops the combat:hit listener', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}

// Q16 US-078d: drive real sword hits through mesh World queries and the beast's listener/steering.
function swordPlayer(world, x, y) {
  return { id: 'player', transform: { x, y, z: groundZ(world, x, y), yawDeg: 0 },
    components: { body: { grounded: true, speedScale: 1, eyeH: PHYSICS.eyeHeight } } };
}

for (const hand of ['left', 'right']) for (const initialState of [STATE_WINDUP, STATE_CHARGE]) {
  const { world, sim, hits, events } = freshSim([beastEntity('b1', 1461, 1031)], 71, 'mesh');
  const fx = 0.6, fy = 0.8;
  const p = swordPlayer(world, 1461 - fx * 0.9, 1031 - fy * 0.9);
  world.state['tower.sword.taken'] = true;
  let manaCalls = 0;
  const sword = createSwordSim(world, events, { ...SWORD_CFG, hand }, {
    spendMana(n) { manaCalls++; return n === 4; },
  });
  sword.step(p, fx, fy, true);
  for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, fx, fy, true);
  sword.step(p, fx, fy, false);
  const label = `${hand} hard from state ${initialState}`;
  ok(`${label}: release enters hard and spends mana once`, sword.state === ST_HARD && manaCalls === 1);
  sim.state[0] = initialState;
  sim.timer[0] = initialState === STATE_CHARGE ? sim.cfgSteps.chargeMax : sim.cfgSteps.windup;
  sim.cdx[0] = fx; sim.cdy[0] = fy; // charge away from the player until the sword interrupts it
  let facingX = 0, facingY = 0, hitX = 0, hitY = 0;
  for (let i = 0; i < 16 && sim.state[0] !== STATE_STAGGER; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z); // actual main.js order
    facingX = sim.fx[0]; facingY = sim.fy[0];
    hitX = sim.steer.x[0]; hitY = sim.steer.y[0];
    sword.step(p, fx, fy, false);
  }
  const hit = hits.find(h => h.source === 'player');
  ok(`${label}: real arc/LOS hit enters stagger synchronously`, !!hit && sim.state[0] === STATE_STAGGER);
  ok(`${label}: payload is heavy damage 3 with a unit direction away from the player`, !!hit
    && hit.target === 'b1' && hit.damage === 3 && hit.heavy === 1
    && Math.abs(hit.dirX * hit.dirX + hit.dirY * hit.dirY - 1) < 1e-12
    && hit.dirX > 0 && hit.dirY > 0);
  ok(`${label}: timer 36, accel 12, no same-step displacement`, sim.timer[0] === 36
    && sim.steer.accel[0] === 12 && sim.steer.x[0] === hitX && sim.steer.y[0] === hitY);
  ok(`${label}: assigns 4 m/s rather than adding prior charge velocity`, !!hit
    && Math.abs(sim.steer.vx[0] - hit.dirX * 4) < 1e-12
    && Math.abs(sim.steer.vy[0] - hit.dirY * 4) < 1e-12);
  let frozenFacing = true;
  for (let i = 1; i <= 35; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z);
    sword.step(p, fx, fy, false);
    if (sim.fx[0] !== facingX || sim.fy[0] !== facingY) frozenFacing = false;
  }
  const distance = Math.hypot(sim.steer.x[0] - hitX, sim.steer.y[0] - hitY);
  // Euler deceleration: speeds 3.8, 3.6, ... 0.2 m/s over 19 moving steps; sum / 60 = 19/30 m.
  ok(`${label}: open-ground shove is 19/30 m and stops`, Math.abs(distance - 19 / 30) < 1e-9
    && Math.hypot(sim.steer.vx[0], sim.steer.vy[0]) < 1e-12, `distance=${distance}`);
  ok(`${label}: frozen facing and exactly 35 stagger steps so far`, frozenFacing
    && sim.state[0] === STATE_STAGGER && sim.timer[0] === 1);
  ok(`${label}: own-position waypoint, arrive 0, maxSpeed 4`, sim.steer.tx[0] === sim.steer.x[0]
    && sim.steer.ty[0] === sim.steer.y[0] && sim.steer.arriveR[0] === 0 && sim.steer.maxSpeed[0] === 4);
  ok(`${label}: one player hit, no charge contact, no repeat impulse during hit-stop`, hits.length === 1 && manaCalls === 1);
  sim.step(p.transform.x, p.transform.y, p.transform.z);
  ok(`${label}: seen target resumes chase on step 36`, sim.state[0] === STATE_CHASE);
  sword.dispose(); sim.dispose();
}

for (const manaShort of [false, true]) {
  const { world, sim, hits, events } = freshSim([beastEntity('b1', 1461, 1031)], 74, 'mesh');
  const p = swordPlayer(world, 1460.1, 1031);
  world.state['tower.sword.taken'] = true;
  let manaCalls = 0;
  const sword = createSwordSim(world, events, SWORD_CFG, { spendMana() { manaCalls++; return false; } });
  sword.step(p, 1, 0, true);
  if (manaShort) for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, 1, 0, true);
  sword.step(p, 1, 0, false);
  sim.state[0] = STATE_WINDUP; sim.timer[0] = sim.cfgSteps.windup;
  for (let i = 0; i < 16 && hits.length === 0; i++) {
    sim.step(p.transform.x, p.transform.y, p.transform.z);
    sword.step(p, 1, 0, false);
  }
  const label = manaShort ? 'mana-short charged release' : 'tap';
  // US-079b: a light hit during WINDUP cancels the charge (enterRecover) rather than leaving the brain untouched.
  ok(`${label}: real sword hit is light damage 1 and cancels the windup (-> recover)`, hits.length === 1
    && hits[0].heavy === 0 && hits[0].damage === 1 && sim.state[0] === STATE_RECOVER);
  ok(`${label}: mana hook called only for charged release, no hard hit-stop`, manaCalls === (manaShort ? 1 : 0)
    && sword.frozen === 0);
  sword.dispose(); sim.dispose();
}

// Every prior alive state, including an already-staggered beast: heavy replaces velocity and resets the full timer.
// (The light-hit behaviour per state is US-079b now and covered by its own tests below; heavy knocks back from any
// state regardless.)
{
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)], 81, 'mesh');
  for (let state = STATE_WANDER; state <= STATE_STAGGER; state++) {
    sim.state[0] = state; sim.timer[0] = 7; sim.unseen[0] = 1;
    sim.steer.vx[0] = -7; sim.steer.vy[0] = 5; sim.steer.accel[0] = 70;
    emitHeavyHit(events, 'b1', 0.6, 0.8);
    ok(`state ${state}: heavy restarts stagger and clears charge wall counter`, sim.state[0] === STATE_STAGGER
      && sim.timer[0] === 36 && sim.unseen[0] === 0 && sim.steer.vx[0] === 2.4
      && sim.steer.vy[0] === 3.2 && sim.steer.accel[0] === 12);
  }
  for (let i = 0; i < 35; i++) sim.step(1e6, 1e6, 0);
  ok('unseen stagger remains active through step 35', sim.state[0] === STATE_STAGGER && sim.timer[0] === 1);
  sim.step(1e6, 1e6, 0);
  ok('unseen stagger resumes return on step 36', sim.state[0] === STATE_RETURN);
  sim.dispose();
}

{
  const a = freshSim([beastEntity('b1', 1461, 1031)], 82, 'mesh');
  emitHeavyHit(a.events, 'b1', 0.6, 0.8);
  for (let i = 0; i < 7; i++) a.sim.step(1460, 1030, groundZ(a.world, 1460, 1030));
  const b = freshSim([beastEntity('b1', 1461, 1031)], 82, 'mesh');
  b.rng.load(a.rng.save());
  b.sim.load(a.sim.save());
  ok('save/load mid-slide preserves stagger timer and current shove velocity', b.sim.state[0] === STATE_STAGGER
    && b.sim.timer[0] === 29 && b.sim.steer.vx[0] === a.sim.steer.vx[0] && b.sim.steer.vy[0] === a.sim.steer.vy[0]);
  let replayEqual = true;
  for (let i = 0; i < 29; i++) {
    a.sim.step(1460, 1030, groundZ(a.world, 1460, 1030));
    b.sim.step(1460, 1030, groundZ(b.world, 1460, 1030));
    if (hashAt(a.sim, a.sim.steer, a.sim.tick, a.rng) !== hashAt(b.sim, b.sim.steer, b.sim.tick, b.rng)) replayEqual = false;
  }
  ok('save/load mid-slide remains hash-identical through stagger end', replayEqual && b.sim.state[0] === STATE_CHASE);
  a.sim.dispose(); b.sim.dispose();
}

// Body targets use the generic 3 m/s impulse, then collide through the actual mesh capsule integrator.
{
  const def = { id: 'bodyTarget', type: 'npc', x: 1479.62, y: 1025, z: 'ground',
    components: { targetable: { radius: 0.3, height: 1.7 },
      body: { radius: PHYSICS.radius, height: PHYSICS.height, eyeH: PHYSICS.eyeHeight } } };
  const world = buildWorld([def], 'mesh');
  const target = world.get('bodyTarget').data;
  integrate(target, SIM_STEP, null, world, PHYSICS);
  const p = swordPlayer(world, target.transform.x - 0.9, target.transform.y);
  p.transform.z = target.transform.z;
  const { events, hits } = makeEvents();
  world.state['tower.sword.taken'] = true;
  const sword = createSwordSim(world, events, SWORD_CFG);
  sword.step(p, 1, 0, true);
  for (let i = 0; i < SWORD_CFG.holdSteps; i++) sword.step(p, 1, 0, true);
  sword.step(p, 1, 0, false);
  for (let i = 0; i < 16 && hits.length === 0; i++) sword.step(p, 1, 0, false);
  ok('generic mesh body receives exact 3 m/s horizontal impulse without lift', hits.length === 1
    && target.components.body.vx === 3 && target.components.body.vy === 0
    && target.components.body.vz === 0 && target.components.body.grounded);
  const startX = target.transform.x;
  let maxX = startX;
  for (let i = 0; i < 60; i++) {
    integrate(target, SIM_STEP, null, world, PHYSICS);
    maxX = Math.max(maxX, target.transform.x);
  }
  ok('generic heavy shove moves the body but cannot cross the tower mesh wall', maxX > startX
    && maxX < 1480 - PHYSICS.radius + 1e-4, `startX=${startX}, maxX=${maxX}`);
  sword.dispose();
}

// ===============================================================================================================
// US-079b (37.16.2): HP, hurt, death, corpse.
// ===============================================================================================================
const LIGHT_HIT = (target, opts = {}) => ({ source: 'player', target, damage: 1, heavy: 0, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', ...opts });
const HEAVY_HIT = (target, opts = {}) => ({ source: 'player', target, damage: 3, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', ...opts });
const hpOf = (sim, slot) => sim.entities[slot].components.health.hp;

{
  // Fresh health component on create (overwrites any serialized one).
  const { sim } = freshSim([beastEntity('b1', 1461, 1031)]);
  const health = sim.entities[0].components.health;
  ok('fresh components.health = {hp:4, max:4, invuln:0}', health.hp === 4 && health.max === 4 && health.invuln === 0, JSON.stringify(health));
}

{
  // 4 light hits >= 12 steps apart -> hp 0 and DYING on the 4th (cooldown cleared each time).
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('1st light hit: hp 3, alive', hpOf(sim, 0) === 3 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('2nd light hit (12 steps later): hp 2, alive', hpOf(sim, 0) === 2 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('3rd light hit: hp 1, alive', hpOf(sim, 0) === 1 && sim.state[0] !== STATE_DYING);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('4th light hit: hp 0 and DYING', hpOf(sim, 0) === 0 && sim.state[0] === STATE_DYING, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
}

{
  // Two hits 5 steps apart -> only the first damages (the second is inside the 12-step cooldown).
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  for (let k = 0; k < 5; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('two hits 5 steps apart -> 1 damage (hp 3, not 2)', hpOf(sim, 0) === 3, `hp=${hpOf(sim, 0)}`);
}

{
  // hard 3 + light 1 (after the cooldown) kills.
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', HEAVY_HIT('b1'));
  ok('hard 3: hp 1, staggered (alive)', hpOf(sim, 0) === 1 && sim.state[0] === STATE_STAGGER, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
  for (let k = 0; k < 12; k++) sim.step(1e6, 1e6, 0);
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('then light 1 kills (hp 0, DYING)', hpOf(sim, 0) === 0 && sim.state[0] === STATE_DYING, `hp=${hpOf(sim, 0)} state=${sim.state[0]}`);
}

{
  // flinch 15 then chase (aggro on the hit makes it chase, not return).
  const bx = 1461, by = 1031, px = bx + 2, py = by;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('light hit -> FLINCH 15', sim.state[0] === STATE_FLINCH && sim.timer[0] === sim.cfgSteps.flinch, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  for (let k = 0; k < sim.cfgSteps.flinch; k++) sim.step(px, py, groundZ(world, px, py));
  ok('flinch 15 -> chase', sim.state[0] === STATE_CHASE, `state=${sim.state[0]}`);
}

{
  // A light hit during CHARGE only flashes (still charging, still took the damage).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax; sim.cdx[0] = 1; sim.cdy[0] = 0;
  events.emit('combat:hit', LIGHT_HIT('b1'));
  ok('a light hit during charge: still charging (flash only)', sim.state[0] === STATE_CHARGE, `state=${sim.state[0]}`);
  ok('...but it still took 1 damage and flashed', hpOf(sim, 0) === 3 && sim.hurtT[0] === 0);
}

{
  // Heavy knock 6 slides ~1.5 m (knockV 6 decaying by accel 12; ~29 moving steps).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 1, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', knock: 6 });
  ok('heavy knock 6 -> stagger with knockV 6', sim.state[0] === STATE_STAGGER && sim.knockV[0] === 6, `knockV=${sim.knockV[0]}`);
  const startX = sim.steer.x[0];
  for (let k = 0; k < sim.cfgSteps.stagger; k++) sim.step(1e6, 1e6, 0);
  const dx = sim.steer.x[0] - startX;
  ok('stagger knock 6 slides ~1.5 m', dx > 1.3 && dx < 1.6, `dx=${dx.toFixed(3)}`);
}

{
  // beast:died exactly once, one step after the kill, with the right cause.
  const { sim, events, died } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('no beast:died inside the listener (pendingDied set)', died.length === 0 && sim.state[0] === STATE_DYING && sim.pendingDied[0] === 1);
  sim.step(1e6, 1e6, 0);
  ok('beast:died exactly once, one step after the kill, cause sword', died.length === 1 && died[0].id === 'b1' && died[0].cause === 'sword', JSON.stringify(died));
  sim.step(1e6, 1e6, 0);
  ok('beast:died not emitted again', died.length === 1);
}

{
  // A fire kill reports cause 'fire'.
  const { sim, events, died } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'fire', knock: 0.5 });
  sim.step(1e6, 1e6, 0);
  ok('a fire kill reports cause "fire"', died.length === 1 && died[0].cause === 'fire', JSON.stringify(died));
}

{
  // API: slotOf / isDead / despawnCorpse edge cases.
  const { sim, events } = freshSim([beastEntity('b1', 1461, 1031)]);
  ok('slotOf resolves the slot and -1 for an unknown id', sim.slotOf('b1') === 0 && sim.slotOf('nope') === -1);
  ok('isDead false while alive', sim.isDead(0) === false);
  ok('despawnCorpse false while alive', sim.despawnCorpse('b1') === false);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('isDead true while DYING; despawnCorpse true during DYING (sets despawnReq)', sim.isDead(0) === true
    && sim.despawnCorpse('b1') === true && sim.despawnReq[0] === 1);
}

{
  // Dead boar: steer agent inactive, and targeting breaks its lock (isAlive reads health.hp <= 0).
  const bx = 1461, by = 1031;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)], 90, 'mesh');
  const player = swordPlayer(world, bx, by + 2); // 2 m south of the beast, facing north
  const look = { yawDeg: 0, pitchDeg: 0, setLockPoint() {}, clearLock() {} };
  const targeting = createTargeting(world, events, { range: 15, losEvery: 1 });
  targeting.step(0, true, 0, player, look); // Q -> lock
  ok('targeting locks the alive beast', targeting.locked && targeting.targetId === 'b1', `targetId=${targeting.targetId}`);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(player.transform.x, player.transform.y, player.transform.z);
  ok('the steer agent is inactive once dead', sim.steer.active[0] === 0);
  targeting.step(0, false, 0, player, look);
  ok('the lock breaks on the kill step (isAlive reads health.hp <= 0)', !targeting.locked, `locked=${targeting.locked}`);
  targeting.dispose(); sim.dispose();
}

{
  // DYING 24 -> CORPSE -> despawnCorpse -> SINK 30 -> GONE.
  const { sim, events, sinks } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('kill -> DYING 24', sim.state[0] === STATE_DYING && sim.timer[0] === sim.cfgSteps.die, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  for (let k = 0; k < sim.cfgSteps.die; k++) sim.step(1e6, 1e6, 0);
  ok('DYING 24 -> CORPSE', sim.state[0] === STATE_CORPSE && sim.timer[0] === sim.cfgSteps.corpse, `state=${sim.state[0]} timer=${sim.timer[0]}`);
  ok('despawnCorpse returns true for a corpse', sim.despawnCorpse('b1') === true);
  sim.step(1e6, 1e6, 0);
  ok('despawn -> SINK 30 and one beast:sink', sim.state[0] === STATE_SINK && sim.timer[0] === sim.cfgSteps.sink && sinks.length === 1, `state=${sim.state[0]} timer=${sim.timer[0]} sinks=${sinks.length}`);
  for (let k = 0; k < sim.cfgSteps.sink; k++) sim.step(1e6, 1e6, 0);
  ok('SINK 30 -> GONE', sim.state[0] === STATE_GONE, `state=${sim.state[0]}`);
}

{
  // timeout 3600 -> SINK (unlooted corpse sinks on its own).
  const { sim, events, sinks } = freshSim([beastEntity('b1', 1461, 1031)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  for (let k = 0; k < sim.cfgSteps.die; k++) sim.step(1e6, 1e6, 0);
  ok('corpse reached', sim.state[0] === STATE_CORPSE);
  for (let k = 0; k < sim.cfgSteps.corpse; k++) sim.step(1e6, 1e6, 0);
  ok('3600-step timeout -> SINK', sim.state[0] === STATE_SINK && sinks.length === 1, `state=${sim.state[0]} sinks=${sinks.length}`);
}

{
  // resetAll restores slot id, hp, position and steer active.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(1e6, 1e6, 0);
  ok('dead: steer inactive and hp 0', sim.steer.active[0] === 0 && hpOf(sim, 0) === 0);
  sim.resetAll();
  ok('resetAll restores hp, active, position and state', sim.slotOf('b1') === 0 && hpOf(sim, 0) === 4
    && sim.steer.active[0] === 1 && sim.steer.x[0] === bx && sim.steer.y[0] === by && sim.state[0] === STATE_WANDER);
}

{
  // 600-step replay with a kill + save@300 / load: hash equal (the new SoA + steer.active + health.hp round-trip).
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA, events: evA } = freshSim(entities(), 7);
  for (let i = 1; i <= 300; i++) {
    const p = scriptedPlayer(i);
    if (i === 200) evA.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: p.x, py: p.y, pz: 0, cause: 'sword' });
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
  ok('kill + save@300 / load: same hash at 600', hashA600 === hashB600, `A=${hashA600} B=${hashB600}`);
}

// ---- US-079b view (beastView.js) ------------------------------------------------------------------------------
{
  const overlay = { bar() {} };
  const styleIds = { beastNotice: 0 };

  // a fresh (never-hit) beast shows its state clip, not the hurt flash.
  const z = freshSim([beastEntity('b1', 1461, 1031)]);
  presentBeasts(z.sim, null, overlay, styleIds);
  ok('view: a fresh beast shows idle (not hurt)', z.sim.entities[0].components.voxel.anim === 'idle', `anim=${z.sim.entities[0].components.voxel.anim}`);

  // hurt clip for 10 steps after a hit.
  const a = freshSim([beastEntity('b1', 1461, 1031)]);
  a.events.emit('combat:hit', LIGHT_HIT('b1'));
  const vA = a.sim.entities[0].components.voxel;
  let hurtSteps = 0;
  for (let k = 0; k < 10; k++) {
    presentBeasts(a.sim, null, overlay, styleIds);
    if (vA.anim === 'hurt') hurtSteps++;
    a.sim.step(1e6, 1e6, 0);
  }
  ok('view: hurt clip for 10 steps after a hit', hurtSteps === 10, `hurtSteps=${hurtSteps}`);
  presentBeasts(a.sim, null, overlay, styleIds);
  ok('view: flinch clip after the 10-step hurt window', vA.anim === 'flinch', `anim=${vA.anim}`);

  // die t = (24 - timer) * 16.7 across DYING.
  const b = freshSim([beastEntity('b1', 1461, 1031)]);
  b.events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  const vB = b.sim.entities[0].components.voxel;
  presentBeasts(b.sim, null, overlay, styleIds);
  ok('view: die clip at DYING entry (t = 0)', vB.anim === 'die' && vB.t === 0, `anim=${vB.anim} t=${vB.t}`);
  let dieTracks = true;
  for (let k = 0; k < b.sim.cfgSteps.die; k++) {
    b.sim.step(1e6, 1e6, 0);
    if (b.sim.state[0] === STATE_DYING) {
      presentBeasts(b.sim, null, overlay, styleIds);
      const expectT = (b.sim.cfgSteps.die - b.sim.timer[0]) * (1000 / 60);
      if (vB.anim !== 'die' || Math.abs(vB.t - expectT) > 1e-9) dieTracks = false;
    }
  }
  ok('view: die t = (24 - timer) * 16.7 across DYING', dieTracks);

  // hidden at GONE (and not hidden during SINK).
  const c = freshSim([beastEntity('b1', 1461, 1031)]);
  c.events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  const vC = c.sim.entities[0].components.voxel;
  for (let k = 0; k < c.sim.cfgSteps.die; k++) c.sim.step(1e6, 1e6, 0);
  c.sim.despawnCorpse('b1');
  c.sim.step(1e6, 1e6, 0);
  presentBeasts(c.sim, null, overlay, styleIds);
  ok('view: not hidden during SINK', vC.hidden !== true);
  for (let k = 0; k < c.sim.cfgSteps.sink; k++) c.sim.step(1e6, 1e6, 0);
  presentBeasts(c.sim, null, overlay, styleIds);
  ok('view: hidden at GONE', vC.hidden === true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
