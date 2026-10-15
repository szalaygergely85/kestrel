// beastSim.hunt.test.js: second half of the former beastSim.test.js (REV-BEASTALLOC-2 split, header duplicated on purpose). Run: node game/js/quest/sim/beastSim.hunt.test.js
// Run: node game/js/quest/sim/beastSim.test.js
//
// Loads the real tower level (same engine data game/js/quest/tower.test.js drives) and the real overworld_far
// terrain, then builds custom small Worlds around it (same pattern tower.test.js itself uses for its lantern/lever/
// beacon sub-tests) so every scripted scenario below drives the REAL NavGrid/A*/steer/supportAt/hasLineOfSight, not
// a stub.
//
import {
  World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING,
} from '../../../../engine/index.js';
import { allocProbe } from '../../../../tools/allocProbe.mjs';
// BEAST-ALLOC-01 (arch 38.61): per-step garbage via allocProbe (min of 5 windows). The sim's OWN garbage is measured with a stub
// floor (world.supportAt boxes its double args at a non-inlined boundary: engine/world, open ASK ARCHITECT in docs/lanes/pc-b2.md)
// stays within ownPerBeast (the 48 B/beast left is the 3 boxed doubles of the supportAt CALL itself); the real-floor figure is asserted against an explicit per-beast cap (ALLOC_EXEMPT, ref arch 38.61).
// BEAST-ALLOC-02: ALLOC_EXEMPT removed - postOne uses world.supportAtOut (caller-owned Float64Array), so the REAL floor must also stay < ALLOC_CAP B/step (whole sim step, not per beast).
const ALLOC_CAP = 8;
function stepAlloc(f, world, tag) {
  const run = (n) => { for (let i = 0; i < n; i++) f(); };
  const real = world.supportAtOut;
  world.supportAtOut = (g, o, io) => { io[3] = 0; };
  const own = allocProbe(run, { n: 1500, warm: 4, chunk: 100, settle: 20, limit: ALLOC_CAP }).perCall;
  world.supportAtOut = real;
  const full = allocProbe(run, { n: 1500, warm: 4, chunk: 100, settle: 20, limit: ALLOC_CAP }).perCall;
  console.log(`  [alloc] ${tag}: own ${own.toFixed(1)} B/step, with real floor ${full.toFixed(1)} B/step`);
  return { own, full };
}
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
import { createAStar } from '../../../../engine/index.js';
import { canSee } from './sight.js';
import { SWORD_CFG } from '../swordConfig.js';
import { createSwordSim, ST_HARD } from './sword.js';
import { createTargeting } from '../targeting.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { presentBeasts, frameTFromElapsed, DIE_DURATIONS } from '../beastView.js';
import {
  createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN,
  STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT,
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

// Test-speed cache (REV-BEASTALLOC-2): the nav only depends on terrain + tower (not on the beast entities), so build it once per
// physics mode and hand each test a private copy of the NavGrid state (typed arrays / Maps copied) plus a fresh A*.
const navCache = new Map();
function cloneVal(v) {
  if (ArrayBuffer.isView(v)) return v.slice();
  if (v instanceof Map) return new Map(Array.from(v, ([k, x]) => [k, cloneVal(x)]));
  if (Array.isArray(v)) return v.map(cloneVal);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) { const o = {}; for (const k of Object.keys(v)) o[k] = cloneVal(v[k]); return o; }
  return v;
}
function navFor(world, physics = 'grid') {
  let base = navCache.get(physics);
  if (!base) { base = buildBeastNav(world, NAV_CFG); navCache.set(physics, base); }
  const g = Object.create(Object.getPrototypeOf(base.grid));
  for (const k of Object.keys(base.grid)) g[k] = cloneVal(base.grid[k]);
  return { grid: g, astar: createAStar(g) };
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
  const nav = navFor(world, physics);
  const { events, hits, died, sinks } = makeEvents();
  const rng = createRng(seed);
  const sim = createBeastSim(world, { nav, rng, events });
  return { world, nav, sim, hits, died, sinks, rng, events };
}

const groundZ = (world, x, y) => world.terrain.heightAt(x, y);
const hpOf = (sim, slot) => sim.entities[slot].components.health.hp;
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
function swordPlayer(world, x, y) {
  return { id: 'player', transform: { x, y, z: groundZ(world, x, y), yawDeg: 0 },
    components: { body: { grounded: true, speedScale: 1, eyeH: PHYSICS.eyeHeight } } };
}
const LIGHT_HIT = (target, opts = {}) => ({ source: 'player', target, damage: 1, heavy: 0, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', ...opts });
const HEAVY_HIT = (target, opts = {}) => ({ source: 'player', target, damage: 3, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword', ...opts });

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

  // die (frame, t within frame) across DYING, converted through the clip durations (US-079b ARCH).
  const b = freshSim([beastEntity('b1', 1461, 1031)]);
  b.events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  const vB = b.sim.entities[0].components.voxel;
  presentBeasts(b.sim, null, overlay, styleIds);
  ok('view: die clip at DYING entry (frame 0, t 0)', vB.anim === 'die' && vB.frame === 0 && vB.t === 0, `anim=${vB.anim} frame=${vB.frame} t=${vB.t}`);
  let dieTracks = true;
  const expect = { frame: -1, t: -1 };
  for (let k = 0; k < b.sim.cfgSteps.die; k++) {
    b.sim.step(1e6, 1e6, 0);
    if (b.sim.state[0] === STATE_DYING) {
      presentBeasts(b.sim, null, overlay, styleIds);
      const elapsed = (b.sim.cfgSteps.die - b.sim.timer[0]) * (1000 / 60);
      frameTFromElapsed(elapsed, DIE_DURATIONS, expect);
      if (vB.anim !== 'die' || vB.frame !== expect.frame || Math.abs(vB.t - expect.t) > 1e-9) dieTracks = false;
    }
  }
  ok('view: die (frame, t) matches frameTFromElapsed across DYING', dieTracks);

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

// ===============================================================================================================
// US-079c (backlog row US-079c + BUG-BOAR-OVERLAP): hard pairwise de-overlap, one charger at a time, 5 HP charge
// contact, windup scrape emit.
// ===============================================================================================================
const BOAR_R = 0.45;

{
  // BUG-BOAR-OVERLAP: two boars charging the same point never get closer than rA+rB-1e-3.
  const bx = 1461, by = 1031;
  const px = bx - 30, py = by; // open field west of the tower: neither reaches the player in one charge
  const { sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 0.2)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.steer.x[1] = bx; sim.steer.y[1] = by + 0.2;
  sim.state[0] = STATE_CHARGE; sim.state[1] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax; sim.timer[1] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = -1; sim.cdy[0] = 0;
  sim.cdx[1] = -1; sim.cdy[1] = 0;
  let minD = Infinity;
  for (let k = 0; k < 240; k++) {
    sim.step(px, py, 0);
    const d = Math.hypot(sim.steer.x[1] - sim.steer.x[0], sim.steer.y[1] - sim.steer.y[0]);
    if (d < minD) minD = d;
  }
  ok('two charging boars never closer than rA+rB-1e-3', minD >= 2 * BOAR_R - 1e-3, `minD=${minD.toFixed(6)}`);
}

{
  // BUG-BOAR-OVERLAP: two idle boars spawned overlapping separate within 30 ticks.
  const bx = 1461, by = 1031;
  const { sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)]);
  sim.timer[0] = 1000; sim.timer[1] = 1000; // keep them in the wander pause (no wander movement)
  let separatedAt = -1;
  for (let k = 1; k <= 30; k++) {
    sim.step(1e6, 1e6, 0);
    const d = Math.hypot(sim.steer.x[1] - sim.steer.x[0], sim.steer.y[1] - sim.steer.y[0]);
    if (d >= 2 * BOAR_R - 1e-3) { separatedAt = k; break; }
  }
  ok('two idle overlapping boars separate within 30 ticks', separatedAt > 0, `separatedAt=${separatedAt}`);
}

{
  // BUG-BOAR-OVERLAP: the de-overlap is deterministic (two fresh overlapping runs reach the same hash).
  const bx = 1461, by = 1031;
  const setup = (s) => {
    s.steer.x[0] = bx; s.steer.y[0] = by;
    s.steer.x[1] = bx; s.steer.y[1] = by + 0.2;
    s.state[0] = STATE_CHARGE; s.state[1] = STATE_CHARGE;
    s.timer[0] = s.cfgSteps.chargeMax; s.timer[1] = s.cfgSteps.chargeMax;
    s.cdx[0] = -1; s.cdy[0] = 0;
    s.cdx[1] = -1; s.cdy[1] = 0;
  };
  const a = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)], 77);
  const b = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by)], 77);
  setup(a.sim); setup(b.sim);
  for (let k = 0; k < 120; k++) {
    a.sim.step(bx - 30, by, 0);
    b.sim.step(bx - 30, by, 0);
  }
  ok('de-overlap replay hash stable (two fresh overlapping runs identical)',
    hashAt(a.sim, a.sim.steer, a.sim.tick, a.rng) === hashAt(b.sim, b.sim.steer, b.sim.tick, b.rng));
}

{
  // BUG-BOAR-OVERLAP / 37.16.2: the de-overlap skips inactive (dead) steer slots.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 0.1)]);
  events.emit('combat:hit', { source: 'player', target: 'b2', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  sim.step(1e6, 1e6, 0); // emit beast:died + stepDead; b2's steer agent is removed (active 0, x/y zeroed)
  ok('the killed slot is an inactive steer agent', sim.steer.active[1] === 0);
  const deadX = sim.entities[1].transform.x, deadY = sim.entities[1].transform.y;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = -1; sim.cdy[0] = 0; // charge west (open field)
  for (let k = 0; k < 60; k++) sim.step(1431, 1031, 0);
  ok('the dead slot is skipped by de-overlap (its transform stays at the death spot)',
    sim.entities[1].transform.x === deadX && sim.entities[1].transform.y === deadY,
    `moved to ${sim.entities[1].transform.x},${sim.entities[1].transform.y} from ${deadX},${deadY}`);
}

{
  // Only one boar is in windup/charge at a time; the other waits (stays CHASE, holds position).
  const bx = 1461, by = 1031;
  const px = bx + 3, py = by; // 3 m east, within windupR (5 m), open field
  const { world, sim } = freshSim([beastEntity('b1', bx, by), beastEntity('b2', bx, by + 1)]);
  sim.state[0] = STATE_CHASE; sim.state[1] = STATE_CHASE;
  sim.seen[0] = 1; sim.seen[1] = 1;
  let everTwo = false, sawOne = false;
  for (let k = 0; k < 300; k++) {
    sim.step(px, py, groundZ(world, px, py));
    let n = 0;
    for (let i = 0; i < 2; i++) if (sim.state[i] === STATE_WINDUP || sim.state[i] === STATE_CHARGE) n++;
    if (n > 1) everTwo = true;
    if (n === 1) sawOne = true;
  }
  ok('never two boars in windup/charge at once (300 steps)', !everTwo);
  ok('at least one boar winds up/charges (the fight actually runs)', sawOne);
}

{
  // A charge contact costs the player 5 HP (damage 1 * vitals beastDamageScale 5).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5;
  const { world, sim, events } = freshSim([beastEntity('b1', bx, by)]);
  const player = { id: 'player', transform: { x: px, y: py, z: groundZ(world, px, py) },
    components: { body: { grounded: true, speedScale: 1 } } };
  const vitals = createVitals(world, events, VITALS_DEFAULTS);
  vitals.step(player, false); // establish the player ref + health before the hit
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight north at the player
  for (let k = 0; k < 10; k++) {
    sim.step(px, py, groundZ(world, px, py));
    vitals.step(player, false);
  }
  ok('a charge contact costs 5 HP (30 -> 25)', vitals.hp === 25, `hp=${vitals.hp}`);
}

{
  // Windup emits beast:scrape at steps 9/18/27 (150/300/450 ms), thrown backward from the forefeet.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  const scrapes = [];
  events.on('beast:scrape', (p) => scrapes.push({ x: p.x, y: p.y, z: p.z, dirX: p.dirX, dirY: p.dirY, dirZ: p.dirZ, fx: sim.fx[0], fy: sim.fy[0] }));
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  for (let k = 0; k < sim.cfgSteps.windup; k++) sim.step(bx, by - 10, 0);
  ok('windup emits exactly 3 beast:scrape events (150/300/450 ms)', scrapes.length === 3, `n=${scrapes.length}`);
  const okScrape = scrapes.length === 3 && scrapes.every((s) =>
    Math.abs(s.x - (bx + s.fx * 0.45)) < 1e-9
    && Math.abs(s.y - (by + s.fy * 0.45)) < 1e-9
    && Math.abs(s.dirX - (-s.fx * 0.8)) < 1e-9
    && Math.abs(s.dirY - (-s.fy * 0.8)) < 1e-9
    && Math.abs(s.dirZ - 0.6) < 1e-9);
  ok('scrape is at the forefeet (0.45 m forward) thrown backward (-facing*0.8, z 0.6)', okScrape, JSON.stringify(scrapes));
}

// ---------------------------------------------------------------------------------------------------------------
// BEAST-PERCEIVE-01w (taken from lane C, offline): engine/nav perceive + leash through the beastSim adapter.
// ---------------------------------------------------------------------------------------------------------------
{
  const mk = (ents, cfg) => {
    const world = buildWorld(ents);
    const nav = navFor(world);
    const { events } = makeEvents();
    const sim = createBeastSim(world, { nav, rng: createRng(5), events, cfg });
    return { world, sim };
  };
  const SIGHT_ID = (sim) => { sim.fx[0] = 0; sim.fy[0] = 1; }; // face +y (toward the tower-side player below)

  // P1. Perception gating: the wall blocks sight, the same distance in the open field is noticed.
  {
    const bx = 1481, by = 1017, px = 1489, py = 1024; // 10.6 m, inside the 12 m notice range, tower in between
    const { world, sim } = mk([beastEntity('b1', bx, by)]);
    ok('P1 sanity: LOS tower-blocked, d in (nearR, noticeR)',
      !hasLineOfSight(world, bx, by, 2.5, px, py, 2.5) && Math.hypot(px - bx, py - by) > 3 && Math.hypot(px - bx, py - by) < 12);
    SIGHT_ID(sim);
    let noticed = false;
    for (let i = 0; i < 90; i++) { sim.step(px, py, groundZ(world, px, py)); if (sim.state[0] === STATE_NOTICE || sim.state[0] === STATE_CHASE) noticed = true; }
    ok('P1 behind a wall (in range + in cone) = no aggro', !noticed, `state=${sim.state[0]}`);
    const f = mk([beastEntity('b1', 1461, 1031)]);
    f.sim.fx[0] = 0; f.sim.fy[0] = -1;
    let seen = false;
    for (let i = 0; i < 90; i++) { f.sim.step(1461, 1021, groundZ(f.world, 1461, 1021)); if (f.sim.state[0] === STATE_NOTICE || f.sim.state[0] === STATE_CHASE) seen = true; }
    ok('P1 control: same range in the open field = aggro', seen);
  }

  // P2. Hearing: noise scales the any-direction bubble (nearR 3 m): sprint x2 -> 6 m, swing x1.5 -> 4.5 m; no LOS or cone needed.
  {
    const bx = 1461, by = 1031;
    const run = (dist, noise) => {
      const { world, sim } = mk([beastEntity('b1', bx, by)]);
      sim.fx[0] = 0; sim.fy[0] = -1; sim.noise = noise;
      const py = by + dist; // behind the beast (facing north)
      for (let i = 0; i < 3; i++) sim.step(bx, py, groundZ(world, bx, py));
      return sim.state[0] === STATE_NOTICE;
    };
    ok('P2 walking 5 m behind: not heard', !run(5, 1));
    ok('P2 sprinting (x2) 5 m behind: heard', run(5, NOISE_SPRINT));
    ok('P2 swinging (x1.5) 4 m behind: heard, walking 4 m: not', run(4, NOISE_SWING) && !run(4, 1));
    ok('P2 sprint is heard from 2x the walking distance', run(5.9, NOISE_SPRINT) && !run(6.1, NOISE_SPRINT));
  }

  // P3. Leash return: a boar chasing past leashR (8 m) from home turns back and walks home.
  {
    const hx = 1461, hy = 1031;
    const { world, sim } = mk([beastEntity('b1', hx, hy)], { leashR: 8 });
    sim.state[0] = STATE_CHASE;
    let retAt = -1, d = 0;
    for (let i = 1; i <= 600 && retAt < 0; i++) {
      sim.step(hx, hy - 15, groundZ(world, hx, hy - 15)); // player 15 m north of home (inside loseR 20)
      if (sim.state[0] === STATE_RETURN) { retAt = i; d = Math.hypot(sim.steer.x[0] - hx, sim.steer.y[0] - hy); }
    }
    ok('P3 leash: returned once past leashR', retAt > 0 && d > 8 && d < 10, `retAt=${retAt} d=${d}`);
    let home = false;
    for (let i = 0; i < 2000 && !home; i++) { sim.step(hx, hy + 40, groundZ(world, hx, hy)); home = sim.state[0] === STATE_WANDER; }
    ok('P3 leash: back home in wander', home, `state=${sim.state[0]}`);
  }

  // P4. Give-up: engaged longer than giveUpSec -> walks home and ignores a player standing right there until home.
  {
    const hx = 1461, hy = 1031;
    const { world, sim } = mk([beastEntity('b1', hx, hy)], { giveUpSec: 1 });
    sim.state[0] = STATE_CHASE;
    const px = hx, py = hy - 8, pz = groundZ(world, px, py);
    let retAt = -1;
    for (let i = 1; i <= 900 && retAt < 0; i++) { sim.step(px, py, pz); if (sim.state[0] === STATE_RETURN) retAt = i; }
    ok('P4 give-up: boar quits the fight after ~1 s engaged (+ finishing its charge)', retAt > 55 && retAt < 400, `retAt=${retAt}`);
    let reaggro = false, home = false;
    for (let i = 0; i < 2000 && !home; i++) {
      sim.step(sim.steer.x[0], sim.steer.y[0] - 2, pz); // player glued 2 m in front of the boar the whole way home
      if (sim.state[0] === STATE_NOTICE || sim.state[0] === STATE_CHASE) reaggro = true;
      home = sim.state[0] === STATE_WANDER;
    }
    ok('P4 give-up: ignores the player on the way home, ends in wander', !reaggro && home, `reaggro=${reaggro} home=${home}`);
  }

  // P6. DRESS-01b: a `temperament:'wary'` (ambient) boar ignores a player 8 m away (a normal boar notices), and
  // a hit turns it into a normal fighter.
  {
    const wary = beastEntity('amb', 1455, 1028); wary.components.brain.temperament = 'wary';
    const { world, sim } = mk([wary, beastEntity('q', 1455, 1028)]);
    const pz = groundZ(world, 1455, 1038);
    sim.fx[0] = 0; sim.fy[0] = 1; sim.fx[1] = 0; sim.fy[1] = 1;
    let engW = false, engQ = false;
    for (let i = 0; i < 300; i++) {
      sim.step(1455, 1036, pz); // 8 m away: inside noticeR 12, outside calmNoticeR 5
      if (sim.state[0] === STATE_CHASE || sim.state[0] === STATE_NOTICE) engW = true;
      if (sim.state[1] === STATE_CHASE || sim.state[1] === STATE_NOTICE) engQ = true;
      sim.fx[0] = 0; sim.fy[0] = 1; sim.fx[1] = 0; sim.fy[1] = 1;
    }
    ok('P6 wary boar ignores a player at 8 m, plain boar notices', !engW && engQ, `wary=${engW} plain=${engQ}`);
  }

  // P5. Zero allocation with the adapter, noise and leash active.
  {
    const { world, sim } = mk([beastEntity('a', 1455, 1028), beastEntity('b', 1460, 1030)], { leashR: 12, giveUpSec: 4 });
    const pz = groundZ(world, 1465, 1025);
    for (let i = 0; i < 600; i++) sim.step(1465, 1025, pz);
    if (global.gc) {
      const r = allocProbe((n) => { for (let i = 0; i < n; i++) { sim.noise = (i & 1) ? NOISE_SPRINT : 1; sim.step(1465 + (i % 7), 1025, pz); } }, { n: 10000, chunk: 1000 });
      ok('P5 zero allocation over 10k steps (perceive + leash adapter)', r.perCall < 100, `perCall=${r.perCall}`);
    } else console.log('(skip) P5 alloc check needs --expose-gc');
  }
}

// EQ-06: a charge whose combat:hit comes back `blocked` -> 0.4 s stagger (not recover), shoved away from the player.
{
  const bx = 1461, by = 1031, px = bx, py = by - 0.5;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  events.on('combat:hit', (p) => { if (p.target === 'player') p.blocked = 1; });
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE; sim.timer[0] = sim.cfgSteps.chargeMax; sim.cdx[0] = 0; sim.cdy[0] = -1;
  let n = 0;
  while (sim.state[0] === STATE_CHARGE && n++ < 20) sim.step(px, py, 0);
  ok('EQ-06 blocked charge -> STAGGER (not recover)', sim.state[0] === 7, `state=${sim.state[0]}`);
  ok('EQ-06 blocked stagger lasts blockStagger = 24 steps', sim.cfgSteps.blockStagger === 24 && sim.timer[0] === 24, `timer=${sim.timer[0]}`);
  ok('EQ-06 beast shoved away from the player (+y)', sim.steer.vy[0] > 0, `vy=${sim.steer.vy[0]}`);
  for (let i = 0; i < 30; i++) sim.step(px, py, 0);
  ok('EQ-06 stagger ends after ~24 steps', sim.state[0] !== 7, `state=${sim.state[0]}`);
}


// LIFE-07: a wolf hunts and eats a deer (stub fauna: same surface as engine/fauna: def.species, slots, nearestPrey, kill, setThreats).
function stubFauna(preys) {
  const f = { def: { species: [{ name: 'rabbit' }, { name: 'deer' }] }, slots: preys, thr: 0, killed: [], thrX: [] };
  f.setThreats = (n, xs) => { f.thr = n; for (let i = 0; i < n; i++) f.thrX[i] = xs[i]; f.thrX.length = n; }; // no per-step push/length churn (boxed doubles)
  f.nearestPrey = (x, y, r, out, mask) => {
    for (let i = 0; i < preys.length; i++) {
      const q = preys[i]; if (!q.alive || !((mask >> q.species) & 1)) continue;
      if ((q.x - x) ** 2 + (q.y - y) ** 2 <= r * r) { out.x = q.x; out.y = q.y; return i; }
    }
    return -1;
  };
  f.kill = (i) => { preys[i].alive = false; f.killed.push(i); };
  return f;
}
function wolfEnt(id, x, y) { const e = beastEntity(id, x, y); e.components.brain.species = 'wolf'; return e; }
function huntSim(fauna) {
  const world = buildWorld([wolfEnt('w1', 1461, 1031)]);
  const nav = navFor(world);
  const { events } = makeEvents();
  return createBeastSim(world, { nav, rng: createRng(3), events, fauna });
}
{
  const deer = { x: 1466, y: 1031, species: 1, alive: true };
  const fa = stubFauna([deer]);
  const sim = huntSim(fa);
  const far = [1461, 1090]; // player far away: no notice
  let eat = -1, hunted = false;
  for (let n = 0; n < 900 && eat < 0; n++) { sim.step(far[0], far[1], 0); if (sim.hunt[0]) hunted = true; if (sim.state[0] === STATE_EAT) eat = n; }
  ok('LIFE-07 wolf hunts the deer, kills it and enters STATE_EAT', hunted && eat >= 0 && fa.killed.length === 1 && !deer.alive, `hunted=${hunted} eat=${eat} killed=${fa.killed}`);
  ok('LIFE-07 beast positions fed as threats', fa.thr === 1 && Math.abs(fa.thrX[0] - sim.steer.x[0]) < 1e-9, `thr=${fa.thr}`);
  for (let n = 0; n < 8 * 60 + 5; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-07 meal ends back in wander', sim.state[0] === STATE_WANDER && !sim.hunt[0], `state=${sim.state[0]}`);
  // wolf does not hunt a rabbit-less/other-species world: bear-only prey filter (wolf eats rabbit too)
  const rab = { x: 1466, y: 1031, species: 0, alive: true };
  const sim2 = huntSim(stubFauna([rab]));
  let h2 = false; for (let n = 0; n < 200; n++) { sim2.step(far[0], far[1], 0); if (sim2.hunt[0]) h2 = true; }
  ok('LIFE-07 wolf also hunts a rabbit', h2);
}
{ // the player notice pre-empts the hunt
  const deer = { x: 1470, y: 1031, species: 1, alive: true };
  const fa = stubFauna([deer]);
  const sim = huntSim(fa);
  for (let n = 0; n < 120; n++) sim.step(1461, 1033, 0); // player 2 m away
  ok('LIFE-07 player notice pre-empts the hunt (no kill, in a combat state)', fa.killed.length === 0 && sim.state[0] !== STATE_EAT && sim.state[0] !== STATE_WANDER, `state=${sim.state[0]} killed=${fa.killed.length}`);
}
{ // null fauna: no hunt, hash unchanged by the feature; 0 alloc with fauna
  const sim = huntSim(null);
  for (let n = 0; n < 200; n++) sim.step(1461, 1090, 0);
  ok('LIFE-07 null fauna: never hunts/eats', !sim.hunt[0] && sim.state[0] !== STATE_EAT);
  if (global.gc) {
    const fa = stubFauna([{ x: 1700, y: 1700, species: 1, alive: true }]);
    const s2 = huntSim(fa);
    for (let n = 0; n < 600; n++) s2.step(1461, 1090, 0);
    const r = stepAlloc(() => s2.step(1461, 1090, 0), s2.world, 'life07');
    ok('LIFE-07 zero allocation per step with fauna (own and real floor < 8 B/step)', r.own < ALLOC_CAP && r.full < ALLOC_CAP, `own=${r.own} full=${r.full}`);
  }
}

{ // LIFE-DET-01: replay hash, same seed + inputs -> equal state hash every step (fauna null, and a hunt that ends in EAT)
  const run = (mkFauna, steps) => {
    const world = buildWorld([wolfEnt("w1", 1461, 1031)]);
    const nav = navFor(world);
    const { events } = makeEvents();
    const rng = createRng(3);
    const fauna = mkFauna();
    const sim = createBeastSim(world, { nav, rng, events, fauna });
    const hs = []; let eat = -1;
    for (let n = 0; n < steps; n++) {
      sim.step(1461, 1090, 0);
      if (sim.state[0] === STATE_EAT && eat < 0) eat = n;
      const h = createHasher(); h.u32(n); rng.hashInto(h); sim.hashInto(h); hs.push(h.value());
    }
    return { hs, eat, fauna };
  };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const n1 = run(() => null, 600), n2 = run(() => null, 600);
  ok("LIFE-DET-01 fauna null: per-step hashes equal across two runs", same(n1.hs, n2.hs) && n1.eat < 0);
  const mk = () => stubFauna([{ x: 1466, y: 1031, species: 1, alive: true }]);
  const h1 = run(mk, 900), h2 = run(mk, 900);
  ok("LIFE-DET-01 hunt -> EAT: per-step hashes equal across two runs", same(h1.hs, h2.hs) && h1.eat >= 0 && h1.eat === h2.eat, "eat=" + h1.eat);
}

// ---- LIFE-08 (38.56 d): setGoal / clearGoal / setAltTargets ----------------------------------------------------
function goalSim() {
  const world = buildWorld([wolfEnt('w1', 1461, 1031)]);
  const nav = navFor(world);
  const ev = makeEvents();
  const sim = createBeastSim(world, { nav, rng: createRng(3), events: ev.events });
  return { sim, ev };
}
{
  const far = [1461, 1100];
  const { sim } = goalSim();
  sim.setGoal(0, 1473, 1033);
  let arrived = -1;
  for (let n = 0; n < 1200 && arrived < 0; n++) { sim.step(far[0], far[1], 0); if (sim.atGoal(0)) arrived = n; }
  ok('LIFE-08 setGoal: wolf travels to the goal and holds', arrived >= 0 && sim.hasGoal(0), 'arrived=' + arrived);
  for (let n = 0; n < 300; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 setGoal: still at the goal after 5 s (no wander)', sim.atGoal(0) && sim.state[0] === STATE_WANDER);
  // alt target: nearer than the player -> chase, altHit event, then cooldown
  const hits = [];
  sim.events.on('beast:altHit', (p) => hits.push(p.alt + ':' + p.id));
  const ax = [1476], ay = [1033];
  sim.setAltTargets(1, ax, ay);
  for (let n = 0; n < 300; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 alt target hit emits beast:altHit once per cooldown', hits.length === 1 && hits[0] === '0:w1', JSON.stringify(hits));
  for (let n = 0; n < 6 * 60; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 alt target hit again after the 6 s cooldown', hits.length >= 2, 'hits=' + hits.length);
  sim.setAltTargets(0, ax, ay);
  const nh = hits.length;
  for (let n = 0; n < 900; n++) sim.step(far[0], far[1], 0);
  ok('LIFE-08 setAltTargets(0) stops the hits', hits.length === nh);
  sim.clearGoal(0);
  ok('LIFE-08 clearGoal: flag off, wolf returns home', !sim.hasGoal(0) && sim.state[0] === STATE_RETURN, 'st=' + sim.state[0]);
  // player nearer than the alt: no altHit, normal notice
  const g2 = goalSim();
  g2.sim.setGoal(0, 1473, 1033);
  const hits2 = [];
  g2.sim.events.on('beast:altHit', (p) => hits2.push(p.alt));
  g2.sim.setAltTargets(1, [1465], [1031]);
  for (let n = 0; n < 240; n++) g2.sim.step(1462, 1031, 0); // player 1 m away, alt 4 m
  ok('LIFE-08 player nearer than the alt: no altHit', hits2.length === 0 && g2.sim.state[0] !== STATE_WANDER, 'st=' + g2.sim.state[0]);
  if (global.gc) {
    const g3 = goalSim(); g3.sim.setGoal(0, 1473, 1033); g3.sim.setAltTargets(1, ax, ay);
    for (let n = 0; n < 600; n++) g3.sim.step(far[0], far[1], 0);
    const r = stepAlloc(() => g3.sim.step(far[0], far[1], 0), g3.sim.world, 'life08');
    ok('LIFE-08 zero allocation per step with goal + alt (own and real floor < 8 B/step)', r.own < ALLOC_CAP && r.full < ALLOC_CAP, `own=${r.own} full=${r.full}`);
  }
}

// ---- BEAST-ALLOC-02: supportAtOut == supportAt bit for bit (terrain, tower tops/inside, water, band edges), grid + mesh physics.
for (const physics of ['grid', 'mesh']) {
  const w = buildWorld([], physics);
  const opts = { height: 0, stepUpMax: 1.0, walkCos: -1 }, out = new Float64Array(10);
  const xs = [], ys = [];
  for (let x = 1400; x <= 1592; x += 7.3) xs.push(x);
  for (let y = 928; y <= 1120; y += 7.1) ys.push(y);
  // structure footprint + tower top probes, plus points outside the near band and the map edge
  const extra = [[1480, 1018], [1484.5, 1020.5], [1478, 1015], [10, 10], [2040, 2040], [1000, 1000], [1303.2, 1307.9], [1596.5, 1124.5]];
  let n = 0, bad = 0, water = 0, bandEdge = 0;
  const probe = (x, y, fz) => {
    const r = w.supportAt(x, y, fz, true, opts);
    const e = { floorH: r.floorH, nx: r.nx, ny: r.ny, nz: r.nz, t: r.terrain, s: r.slope, c: r.ceilH };
    out[0] = x; out[1] = y; out[2] = fz; w.supportAtOut(true, opts, out);
    n++;
    const same = Object.is(out[3], e.floorH) && Object.is(out[4], e.nx) && Object.is(out[5], e.ny) && Object.is(out[6], e.nz)
      && out[7] === (e.t ? 1 : 0) && out[8] === (e.s ? 1 : 0) && (e.c === 'sky' ? Number.isNaN(out[9]) : Object.is(out[9], e.c));
    if (!same) bad++;
    if (w.terrain && w.terrain.groundTypeAt(x, y) === 2) water++;
    if (w.terrain && w.terrain.near && (Math.abs(x - w.terrain.near.x0) < 4 || Math.abs(y - w.terrain.near.y0) < 4)) bandEdge++;
  };
  for (const x of xs) for (const y of ys) { probe(x, y, 0.6); probe(x, y, 12); }
  for (const [x, y] of extra) for (const fz of [0.6, 4, 12, 30]) probe(x, y, fz);
  const b = w.terrain.near;
  for (const x of [b.x0 - 1, b.x0, b.x0 + 0.5, b.x0 + 1, b.x0 + b.w * b.cell - 1.5, b.x0 + b.w * b.cell - 0.5]) for (const y of [b.y0 + 40.3, b.y0 + 100.1]) probe(x, y, 0.6);
  ok(`supportAtOut == supportAt bit for bit (${physics} physics, ${n} points, ${water} water, ${bandEdge} band-edge)`, bad === 0 && n > 1000, `mismatches ${bad}`);
}

// BH-A2 / BH-A3 / BH-A4 (bug hunt 2026-10-15)
{ // A2: setGoal ends a hunt in progress; the wolf then travels to the goal
  const rab = { x: 1469, y: 1031, species: 0, alive: true };
  const fa = stubFauna([rab]);
  const sim = huntSim(fa);
  const far = [1461, 1100];
  let n = 0; for (; n < 300 && !sim.hunt[0]; n++) sim.step(far[0], far[1], 0);
  ok('BH-A2 setup: wolf is hunting', sim.hunt[0] === 1, 'n=' + n);
  sim.setGoal(0, 1473, 1033);
  ok('BH-A2 setGoal clears hunt at once', sim.hunt[0] === 0);
  let arrived = -1;
  for (let k = 0; k < 1200 && arrived < 0; k++) { sim.step(far[0], far[1], 0); if (sim.atGoal(0)) arrived = k; }
  ok('BH-A2 hunting wolf reaches the raid goal', arrived >= 0 && sim.hunt[0] === 0, `arrived=${arrived} hunt=${sim.hunt[0]}`);
}
{ // A3: perceive's LOS write must not feed the charge wall-slow streak
  const { sim } = goalSim();
  const far = [1461, 1100];
  sim.step(far[0], far[1], 0);
  sim.state[0] = STATE_CHARGE; sim.cdx[0] = 0; sim.cdy[0] = 0; // waypoint = own position -> every step is a slow step
  sim.timer[0] = sim.ssteps[0].chargeMax - 5; sim.unseen[0] = 7; if (sim.stk.wall) sim.stk.wall[0] = 0;
  sim.step(far[0], far[1], 0);
  ok('BH-A3 one slow charge step with unseen=7 is not a wall hit', sim.state[0] === STATE_CHARGE && (sim.stk.wall ? sim.stk.wall[0] === 1 : false), `state=${sim.state[0]} wall=${sim.stk.wall[0]}`);
  sim.step(far[0], far[1], 0);
  ok('BH-A3 two slow steps in a row end the charge (wall recover)', sim.state[0] === STATE_RECOVER, `state=${sim.state[0]}`);
}
{ // A4: two overlapping beasts on a sheet (ground cells cost 0 under it) are pushed apart
  const world = buildWorld([wolfEnt('a', 1461, 1031), wolfEnt('b', 1461.2, 1031)]);
  const nav = navFor(world);
  const g = nav.grid;
  for (let y = 1027; y < 1036; y++) for (let x = 1457; x < 1466; x++) g.cost[g.index(g.cellX(x), g.cellY(y))] = 0;
  const cw = 18 * 4, base = 0;
  g.layers = { count: 1, nLinks: 0, cell: new Float64Array([0.5]), x0: new Float64Array([1457]), y0: new Float64Array([1027]), w: new Int32Array([18]), h: new Int32Array([18]), base: new Int32Array([base]), cost: new Uint8Array(18 * 18).fill(1), height: new Float32Array(18 * 18).fill(0), finest: 0.5 };
  void cw;
  const sim = createBeastSim(world, { nav: { grid: g, astar: nav.astar }, rng: createRng(3), events: makeEvents().events });
  for (const i of [0, 1]) sim.steer.z[i] = 0;
  sim.step(1461, 1100, 0);
  const d = Math.hypot(sim.steer.x[1] - sim.steer.x[0], sim.steer.y[1] - sim.steer.y[0]);
  ok('BH-A4 overlapping beasts on a nav sheet are pushed apart', d >= sim.steer.radius[0] + sim.steer.radius[1] - 0.02, `d=${d.toFixed(3)}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
