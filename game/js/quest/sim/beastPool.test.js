// game/js/quest/sim/beastPool.test.js (BEAST-POOL-a, 37.16.5). Record table + pool loop with every record bound: 900 beasts create without the cap warning, pool is identity, 0 alloc over 600 steps.
// Run: node --expose-gc game/js/quest/sim/beastPool.test.js
//
import {
  World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING,
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
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { presentBeasts, frameTFromElapsed, DIE_DURATIONS } from '../beastView.js';
import {
  createBeastSim, MAX_BEASTS, MAX_RECORDS, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN,
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



const PX = 1461, PY = 1031;
const gz = (sim) => world0Z(sim);
function world0Z(sim) { return sim.world.terrain.heightAt(PX, PY); }

{
  const ents = [];
  for (let k = 0; k < 900; k++) ents.push(beastEntity('b' + k, 1410 + (k % 30) * 6, 940 + Math.floor(k / 30) * 6));
  const warns = []; const ow = console.warn; console.warn = (m) => warns.push(String(m));
  const world = buildWorld(ents);
  const nav = buildBeastNav(world, NAV_CFG);
  const { events } = makeEvents();
  const sim = createBeastSim(world, { nav, rng: createRng(1), events });
  console.warn = ow;
  ok('MAX_RECORDS 1024', MAX_RECORDS === 1024 && MAX_BEASTS === MAX_RECORDS);
  ok('900 beasts: no "only the first" warning', sim.count === 900 && !warns.some((m) => m.includes('only the first')), `count ${sim.count}`);
  const p = sim.pool;
  let ident = p.n === 128;
  for (let i = 0; i < 128; i++) if (p.rec[i] !== i || p.lv[i] !== i) ident = false;
  ok('900 records start with the first POOL = 128 bound (identity), the rest unbound + tile-dormant', ident && p.lv[128] === -1 && p.lv[899] === -1 && sim.isDormant(500) && !sim.isDormant(5));
  ok('lastX/lastY live in sim.pool, MAX_RECORDS wide', p.lastX.length === MAX_RECORDS && p.lastY.length === MAX_RECORDS && sim.lastX === undefined);
  ok('rec/free sized POOL, path sized POOL*PATH_SLOTS*2', p.rec.length === 128 && p.free.length === 128 && sim.path.length === 128 * 64 * 2, `path ${sim.path.length}`);
  for (let t = 0; t < 300; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let t = 0; t < 600; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - m0;
  ok('900 records: ~0 alloc over 600 steps', global.gc ? grown <= 1e6 : true, `heap +${grown} B`);
}

// ---- BEAST-POOL-b: binder ------------------------------------------------------------------------------------------
function lineWorld(n, dx, y = 1000) {
  const ents = []; for (let k = 0; k < n; k++) ents.push(beastEntity('l' + k, 1400 + k * dx, y));
  const world = buildWorld(ents), nav = buildBeastNav(world, NAV_CFG), { events } = makeEvents();
  return createBeastSim(world, { nav, rng: createRng(3), events });
}
const bound = (sim, i) => sim.pool.lv[i] >= 0;
const drive = (sim, px, py, times = 30) => { for (let m = 0; m < times; m++) sim.updateTileDormancy(px, py); };
{ // hysteresis: bind < 150, unbind > 180, nothing in between; nearest first, max 8 per update
  const sim = lineWorld(400, 0.45);
  const n0 = sim.pool.n; // first 128 start bound (identity); unbind the far ones first
  drive(sim, 1300, 1000, 40);
  ok('everything < 150 m bound (k=0..110), nothing >= 150', bound(sim, 0) && bound(sim, 100) && !bound(sim, 130) && sim.pool.n <= 128 && n0 === 128, `n ${sim.pool.n}`);
  drive(sim, 1225, 1000, 1);
  ok('d = 175 m (150..180): stays bound (hysteresis)', bound(sim, 0));
  drive(sim, 1215, 1000, 1);
  ok('d = 185 m: unbound', !bound(sim, 0) && sim.isDormant(0));
  drive(sim, 1225, 1000, 3);
  ok('d = 175 m again: NOT rebound (rIn 150)', !bound(sim, 0));
  drive(sim, 1200, 1000, 40);
  ok('pool.n <= 128 and free list consistent', sim.pool.n <= 128 && sim.pool.n + sim.pool.freeN <= 128);
  const s2 = lineWorld(400, 0.45); // max 8 binds per update, nearest first
  drive(s2, 1000, 1000, 20); // everything far: all unbound
  ok('far player: pool empty', s2.pool.n === 0);
  s2.updateTileDormancy(1300, 1000);
  ok('one update binds at most 8, nearest first', s2.pool.n === 8 && bound(s2, 0) && bound(s2, 7) && !bound(s2, 8), `n ${s2.pool.n}`);
}
{ // protection
  const sim = lineWorld(5, 1);
  drive(sim, 1300, 1000, 2);
  const S = [(i) => { sim.state[i] = STATE_CHASE; }, (i) => { sim.hunt[i] = 1; }, (i) => { sim.fleeing[i] = 1; }, (i) => { sim.goal.on[i] = 1; }, (i) => { sim.tactics.held[i] = 1; }];
  S.forEach((f, idx) => f(idx));
  drive(sim, 1000, 1000, 3);
  ok('protected (chase, hunt, fleeing, goal, token) stay bound far away', [0, 1, 2, 3, 4].every((i) => bound(sim, i)));
  sim.state[0] = STATE_WANDER; sim.hunt[1] = 0; sim.fleeing[2] = 0; sim.goal.on[3] = 0; sim.tactics.held[4] = 0;
  drive(sim, 1000, 1000, 2);
  ok('released protection -> unbound', [0, 1, 2, 3, 4].every((i) => !bound(sim, i)));
  const s2 = lineWorld(3, 1); drive(s2, 1300, 1000, 2); s2.state[1] = STATE_RECOVER; s2.state[2] = STATE_FLINCH; s2.state[0] = STATE_NOTICE;
  drive(s2, 1000, 1000, 2);
  ok('NOTICE / RECOVER / FLINCH protected', bound(s2, 0) && bound(s2, 1) && bound(s2, 2));
}
{ // state carry: hp kept, dead stays dead, snap home > 30 m, 20 m stays
  const sim = lineWorld(6, 1);
  drive(sim, 1300, 1000, 2);
  sim.entities[0].components.health.hp = 3;
  const t1 = sim.entities[1].transform; t1.x += 40; sim.steer.x[1] = t1.x;
  const t2 = sim.entities[2].transform; t2.x += 20; sim.steer.x[2] = t2.x;
  sim.state[3] = STATE_CORPSE;
  sim.setDown(4, true);
  drive(sim, 1000, 1000, 2);
  ok('unbound: state WANDER, hp kept', !bound(sim, 0) && sim.state[0] === STATE_WANDER && sim.entities[0].components.health.hp === 3);
  ok('> 30 m from home: snapped home', sim.entities[1].transform.x === sim.homeX[1] && sim.pool.lastX[1] === sim.homeX[1]);
  ok('20 m from home: stays where it was', sim.entities[2].transform.x === sim.homeX[2] + 20 && sim.pool.lastX[2] === sim.homeX[2] + 20);
  ok('dead record keeps its slot and state', bound(sim, 3) && sim.state[3] === STATE_CORPSE);
  ok('GONE/down record gives its slot back at once', !bound(sim, 4) && sim.state[4] === STATE_GONE && sim.down[4] !== 0);
  drive(sim, 1400, 1000, 3);
  ok('down record stays unbound when the player is close; alive ones rebind', !bound(sim, 4) && bound(sim, 0) && bound(sim, 1));
}
{ // eviction: full pool, farthest unprotected goes only if >= 20 m farther than the candidate
  const sim = lineWorld(200, 0.25);
  drive(sim, 1300, 1000, 40);
  ok('full pool of 128 (nearest of the 200 within 150 m)', sim.pool.n === 128 && bound(sim, 0) && !bound(sim, 199), `n ${sim.pool.n}`);
  drive(sim, 1470, 1000, 60);
  ok('player moves: far bound records evicted for near ones (199 bound, 0 unbound)', sim.pool.n === 128 && bound(sim, 199) && !bound(sim, 0), `n ${sim.pool.n}`);
  const s2 = lineWorld(200, 0.25); drive(s2, 1300, 1000, 40);
  for (let i = 0; i < 128; i++) s2.state[i] = STATE_CHASE; // all protected: never evicted
  const f0 = s2.pool.full; drive(s2, 1470, 1000, 10);
  ok('all protected: nothing evicted, pool.full counts', s2.pool.n === 128 && bound(s2, 0) && !bound(s2, 199) && s2.pool.full > f0);
}
{ // 0 alloc across bind/unbind cycles
  const sim = lineWorld(300, 0.5);
  drive(sim, 1300, 1000, 20);
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let c = 0; c < 50; c++) { drive(sim, 1100, 1000, 3); drive(sim, 1350, 1000, 6); }
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - m0;
  ok('50 bind/unbind cycles: ~0 alloc', global.gc ? grown <= 1e6 : true, `heap +${grown} B`);
}
{ // determinism: same walk twice = same hash (lv + positions)
  const run = () => {
    const sim = lineWorld(300, 0.5);
    for (let t = 0; t < 1500; t++) sim.step(1300 + t * 0.1, 1000, 5);
    let h = 2166136261 >>> 0; const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    for (let i = 0; i < 300; i++) { mix(sim.pool.lv[i]); mix(sim.state[i]); mix(Math.round(sim.entities[i].transform.x * 1000)); }
    return { h, n: sim.pool.n };
  };
  const a = run(), b = run();
  ok('walk along a line: pool.n <= 128, same final hash on two runs', a.h === b.h && a.n <= 128 && a.n > 0, `${a.h} ${b.h} n ${a.n}`);
}
{ // cost: 900 records with a 128 pool stays near the 128-beast cost
  const mk = (n) => { const ents = []; for (let k = 0; k < n; k++) ents.push(beastEntity('c' + k, 1410 + (k % 30) * 6, 940 + Math.floor(k / 30) * 6)); const world = buildWorld(ents), nav = buildBeastNav(world, NAV_CFG), { events } = makeEvents(); return createBeastSim(world, { nav, rng: createRng(5), events }); };
  const time = (sim) => { for (let t = 0; t < 120; t++) sim.step(PX, PY, 5); const t0 = performance.now(); for (let t = 0; t < 300; t++) sim.step(PX, PY, 5); return (performance.now() - t0) / 300; };
  const c128 = time(mk(128)), c900 = time(mk(900));
  console.log(`  step cost: 128 records ${c128.toFixed(3)} ms, 900 records (pool 128) ${c900.toFixed(3)} ms`);
  ok('900 records / pool 128: step cost <= 2.5x the 128-beast cost and < 0.6 ms', c900 <= c128 * 2.5 + 0.05 && c900 < 0.6, `${c128.toFixed(3)} vs ${c900.toFixed(3)}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
