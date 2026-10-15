// game/js/quest/sim/beastGolden.test.js (BEAST-03a). Golden: a seeded mixed scene (boar, wolf, bear, goblins) stepped N times
// must hash to the value recorded BEFORE the kind/archetype tables were added (no behaviour change).
// Run: node game/js/quest/sim/beastGolden.test.js
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
import { kindIndex, KINDS } from './beastKinds.js';
import { archIndex } from './archetypes.js';
import { buildBeastNav } from './beastNav.js';
import { canSee } from './sight.js';
import { SWORD_CFG } from '../swordConfig.js';
import { createSwordSim, ST_HARD } from './sword.js';
import { createTargeting } from '../targeting.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { presentBeasts, frameTFromElapsed, DIE_DURATIONS } from '../beastView.js';
import { ensureGoblins, GOBLIN_TUNING, goblinOverrides } from './goblinBrain.js';
import {
  createBeastSim, MAX_BEASTS, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN,
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



function gobEntity(id, x, y, role = 'melee') {
  const e = beastEntity(id, x, y);
  e.components.brain.species = 'goblin'; e.components.brain.role = role;
  return e;
}
const PX = 1461, PY = 1031;
const ring4 = [[PX - 9, PY - 2], [PX + 8, PY + 3], [PX + 1, PY - 10], [PX - 4, PY + 9]];
const isTok = (s) => s === STATE_WINDUP || s === STATE_CHARGE;
const gz = (sim) => groundZ(sim.world, PX, PY);


const GOLDEN_HASH = 2305245254; // re-recorded OB-150 (boar/wolf charge now outruns a walking-away player); was 1491148451 on the pre-BEAST-03a beastSim
function ent(id, x, y, species, role) {
  const e = beastEntity(id, x, y);
  if (species) e.components.brain.species = species;
  if (role) e.components.brain.role = role;
  return e;
}
const list = [
  ent('b1', PX - 9, PY), ent('w1', PX + 8, PY + 3, 'wolf'), ent('w2', PX + 9, PY + 5, 'wolf'),
  ent('r1', PX + 1, PY - 10, 'bear'), ent('g1', PX - 4, PY + 9, 'goblin'), ent('g2', PX - 6, PY + 8, 'goblin', 'thrower'),
];
const { sim } = freshSim(list, 7);
let h = 2166136261 >>> 0;
const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
const STEPS = 3000;
for (let t = 0; t < STEPS; t++) {
  const px = PX + ((t >> 6) % 5) - 2, py = PY + ((t >> 7) % 3) - 1;
  sim.step(px, py, gz(sim));
  for (let i = 0; i < list.length; i++) {
    const tr = sim.entities[i].transform;
    mix(sim.state[i]); mix(Math.round(tr.x * 1000)); mix(Math.round(tr.y * 1000)); mix(Math.round(tr.z * 1000)); mix(sim.entities[i].components.health.hp);
  }
}
const GOLDEN = process.env.GOLDEN_RECORD ? null : GOLDEN_HASH;
console.log('hash', h);
const KN = ['boar', 'grey_wolf', 'grey_wolf', 'black_bear', 'goblin_warrior', 'goblin_spear_thrower'];
ok('kindIdx/archIdx per slot from species/role', KN.every((k, i) => sim.kindIdx[i] === kindIndex(k) && sim.archIdx[i] === archIndex(KINDS[k].arch)));
if (GOLDEN !== null) ok('seeded mixed scene identical to pre-BEAST-03a recording (' + STEPS + ' steps)', h === GOLDEN, String(h));
console.log(`beastGolden: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('FAIL', f); process.exit(1); }
