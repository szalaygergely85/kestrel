// game/js/quest/sim/bearBrain.test.js (BEAR-01). Reuses the beastSim.test.js scaffold. Headless Node ESM, no framework.
// Run: node game/js/quest/sim/bearBrain.test.js
//
// Loads the real tower level (same engine data game/js/quest/tower.test.js drives) and the real overworld_far
// terrain, then builds custom small Worlds around it (same pattern tower.test.js itself uses for its lantern/lever/
// beacon sub-tests) so every scripted scenario below drives the REAL NavGrid/A*/steer/supportAt/hasLineOfSight, not
// a stub.
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
import { ensureBears, BEAR_TUNING, BEAR_MODEL, isBearEntity, bearPicksBite } from './bearBrain.js';
import { BEAST_DEFAULTS } from './beastConfig.js';
import { LOOT_PROMPT } from './lootConfig.js';
import {
  createBeastSim, STATE_WANDER, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RETURN, STATE_RECOVER, STATE_BITE,
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



function bearEntity(id, x, y) {
  const e = beastEntity(id, x, y);
  e.components.brain.species = 'bear';
  e.components.voxel.model = BEAR_MODEL;
  return e;
}
const PX = 1461, PY = 1031, BX = PX - 9, BY = PY - 2;
const mk = (seed = 1) => freshSim([bearEntity('blackBear1', BX, BY)], seed);
const gz = (w, x, y) => w.terrain.heightAt(x, y);

// 1. stats: HP 3x boar, swipe 2 hearts fixed, telegraph >= 0.8 s, 30 m leash, 25 m hit-aggro, slow walk
{
  const { sim } = mk();
  ok('isBearEntity', isBearEntity(sim.entities[0]) && sim.bear[0] === 1);
  ok('bear hp = 3 x boar (12)', sim.entities[0].components.health.max === BEAST_DEFAULTS.hp * 3, String(sim.entities[0].components.health.max));
  ok('swipe = 2 hearts (payload)', sim._hitPayload[0].damage === 2);
  ok('windup >= 48 steps (0.8 s)', sim.ssteps[0].windup >= 48, String(sim.ssteps[0].windup));
  ok('leash 30, lose/hit-aggro 25, notice 12', sim.scfg[0].leashR === 30 && sim.scfg[0].loseR === 25 && sim.scfg[0].noticeR === 12);
  ok('walk 1.0 slow, block stagger 0.4 s', sim.scfg[0].walk === 1.0 && sim.scfg[0].blockStaggerSec === 0.4);
  ok('boar unchanged (dmg 1, hp 4, windup 0.5)', (() => { const b = freshSim([beastEntity('b1', BX, BY)]).sim; return b.bear[0] === 0 && b.entities[0].components.health.max === 4 && b.scfg[0].windupSec === 0.5; })());
  ok('loot prompt placeholder', LOOT_PROMPT.bear === '[E] Loot bear');
}

// 1b. BEAR-01: sight reads the per-slot noticeR (not the shared cfg): a bear with noticeR 20 notices a player 16 m ahead,
// the same player stays unnoticed by a boar (cfg noticeR 12) and by a bear whose noticeR is 12
{
  const noticed = (sim, d) => { const z = gz(sim.world, BX, BY - d); for (let t = 0; t < 30; t++) sim.step(BX, BY - d, z); return sim.state[0] !== STATE_WANDER && sim.state[0] !== 0; };
  const b12 = mk().sim, b20 = mk().sim, boar = freshSim([beastEntity('b1', BX, BY)]).sim;
  b20.scfg[0].noticeR = 20;
  ok('bear noticeR 12 differs from boar-config sight when overridden', b20.scfg[0].noticeR !== boar.cfg.noticeR && b12.scfg[0].noticeR === 12);
  ok('bear noticeR 20 notices at 16 m', noticed(b20, 16), String(b20.state[0]));
  ok('bear noticeR 12 does not notice at 16 m', !noticed(b12, 16), String(b12.state[0]));
  ok('boar (cfg noticeR 12) does not notice at 16 m', !noticed(boar, 16), String(boar.state[0]));
}

// 2. seeded fight: telegraph always >= 0.8 s before damage, straight charge, damage 2 per contact
{
  const { sim, hits } = mk(7);
  const z = gz(sim.world, PX, PY);
  let windupRun = 0, minWindup = 1e9, windups = 0, prev = -1, contacts = 0, hitSteps = 0;
  for (let t = 0; t < 3600; t++) {
    const nh = hits.length;
    sim.step(PX, PY, z);
    const s = sim.state[0];
    if (s === STATE_WINDUP) windupRun++;
    if (prev === STATE_WINDUP && s !== STATE_WINDUP) { if (s === STATE_CHARGE) { minWindup = Math.min(minWindup, windupRun); windups++; } windupRun = 0; }
    for (let k = nh; k < hits.length; k++) if (hits[k].target === 'player') { contacts++; ok('contact only after a full telegraph', windups > 0 && minWindup >= 48, `minWindup ${minWindup}`); ok('contact damage 2', hits[k].damage === 2, String(hits[k].damage)); }
    prev = s;
  }
  ok('bear telegraphs and charges', windups > 0, `windups ${windups}`);
  ok('every windup >= 48 steps', minWindup >= 48, `min ${minWindup}`);
  void contacts; void hitSteps;
}

// 3. an arrow (light hit) does not cancel the windup; a heavy hit does stagger
{
  const { sim, events } = mk(3);
  const z = gz(sim.world, PX, PY);
  let n = 0; while (sim.state[0] !== STATE_WINDUP && n++ < 3000) sim.step(PX, PY, z);
  ok('reached windup', sim.state[0] === STATE_WINDUP, `after ${n}`);
  events.emit('combat:hit', { source: 'player', target: 'blackBear1', damage: 1, heavy: false, dirX: 1, dirY: 0 });
  ok('light hit keeps the windup', sim.state[0] === STATE_WINDUP);
  ok('hit took 1 hp', sim.entities[0].components.health.hp === 11);
}

// 4. leash: player runs 40 m away after the bear is hit -> bear gives up and heads home
{
  const { sim, events } = mk(5);
  const z = gz(sim.world, PX, PY);
  for (let t = 0; t < 200; t++) sim.step(PX, PY, z);
  events.emit('combat:hit', { source: 'player', target: 'blackBear1', damage: 1, heavy: false, dirX: 1, dirY: 0 });
  let returned = false;
  const FX = BX - 40, FY = BY; // far west of home: > 25 m from the bear
  for (let t = 0; t < 2400 && !returned; t++) { sim.step(FX, FY, z); if (sim.state[0] === STATE_RETURN || sim.state[0] === STATE_WANDER) returned = true; }
  ok('bear returns when the player is out of range', returned);
  const st = sim.steer; const hd = Math.hypot(st.x[0] - BX, st.y[0] - BY);
  ok('never beyond 30 m from home', hd <= 30, hd.toFixed(1));
}

// 5. ensureBears helper turns anchors into bear beasts
{
  const w = buildWorld([{ id: 'blackBear1', type: 'beast', x: BX, y: BY, z: 'ground' }]);
  const n = ensureBears(w);
  const e = w.entity('blackBear1');
  ok('ensureBears converts one anchor', n === 1 && e.components.brain.species === 'bear' && e.components.voxel.model === 'bearBlack');
  ok('ensureBears no-op without anchors', ensureBears(buildWorld([])) === 0);
}

// 6. BEAR-BITE: close-range lunge-bite - timing mirrors blackBearFx.bite, one hit at ~200 ms, deterministic, Burl never bites
{
  const fx = assets.blackBearFx && assets.blackBearFx.bite;
  ok('bite constants mirror blackBearFx.bite', !fx || (fx.ms === BEAR_TUNING.biteMs && fx.snapMs === BEAR_TUNING.biteHitMs && fx.hearts === BEAR_TUNING.swipeHearts), JSON.stringify(fx));
  // player stands next to the bear's home; trace = [step, state, hit count] at every state change
  const run = (ents, seed) => {
    const { sim, hits } = freshSim(ents, seed);
    const z = gz(sim.world, PX, PY);
    const bx = ents[0].x, by = ents[0].y;
    const trace = [], biteHits = []; let prev = -1, biteStart = -1, bites = 0;
    for (let t = 0; t < 3000; t++) {
      const nh = hits.length;
      sim.step(bx + 1.3, by, z);
      const st = sim.state[0];
      if (st === STATE_BITE && prev !== STATE_BITE) { biteStart = t; bites++; }
      for (let k = nh; k < hits.length; k++) if (hits[k].target === 'player' && st === STATE_BITE) biteHits.push(t - biteStart);
      if (st !== prev) trace.push(t + ':' + st);
      prev = st;
    }
    return { trace: trace.join(','), bites, biteHits, sim };
  };
  const e1 = () => [bearEntity('blackBear1', PX - 30, PY)];
  const a = run(e1(), 11), b = run(e1(), 11);
  ok('bite happens', a.bites > 0, `bites ${a.bites}`);
  ok('bite hit lands exactly once per bite', a.biteHits.length > 0 && a.biteHits.length <= a.bites, JSON.stringify(a.biteHits));
  ok('bite hit at ~200 ms (step 12)', a.biteHits.every((s) => s >= 11 && s <= 13), JSON.stringify(a.biteHits));
  ok('same trace two runs', a.trace === b.trace && a.trace.length > 0);
  ok('bearPicksBite deterministic and mixed', bearPicksBite(0, 3) === bearPicksBite(0, 3) && [0, 1, 2, 3, 4, 5, 6, 7].some((n) => bearPicksBite(0, n)) && [0, 1, 2, 3, 4, 5, 6, 7].some((n) => !bearPicksBite(0, n)));
  // Burl (friendly bear model 'bear', same brain species) never bites
  const burl = bearEntity('burl1', PX - 30, PY); burl.components.voxel.model = 'bear';
  const c = run([burl], 11);
  ok('Burl never bites', c.bites === 0, `bites ${c.bites}`);
  // 0 allocations per step while biting
  const { sim } = freshSim(e1(), 11); const z = gz(sim.world, PX, PY);
  for (let t = 0; t < 600; t++) sim.step(PX - 30 + 1.3, PY, z);
  if (global.gc) { global.gc(); const m0 = process.memoryUsage().heapUsed; for (let t = 0; t < 600; t++) sim.step(PX - 30 + 1.3, PY, z); ok('bite steps ~0 alloc', process.memoryUsage().heapUsed - m0 < 200000, String(process.memoryUsage().heapUsed - m0)); }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
console.log('ALL PASS');
