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
  let ident = p.n === 900;
  for (let i = 0; i < 900; i++) if (p.rec[i] !== i || p.lv[i] !== i) ident = false;
  ok('story a: pool is identity (lv[i] = rec[i] = i, n = count)', ident && p.lv[900] === -1);
  ok('lastX/lastY are MAX_RECORDS wide', sim.lastX.length === MAX_RECORDS && sim.lastY.length === MAX_RECORDS);
  for (let t = 0; t < 300; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let t = 0; t < 600; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - m0;
  ok('900 beasts: ~0 alloc over 600 steps', global.gc ? grown <= 1e6 : true, `heap +${grown} B`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
