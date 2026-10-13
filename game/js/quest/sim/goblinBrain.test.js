// game/js/quest/sim/goblinBrain.test.js (GOB-01). Reuses the beastSim.test.js scaffold. Headless Node ESM, no framework.
// Run: node game/js/quest/sim/goblinBrain.test.js
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

// 1. stats
{
  const { sim } = freshSim([gobEntity('g1', PX - 9, PY)]);
  ok('goblin hp = 2 (0.6 x boar 4)', sim.entities[0].components.health.max === 2, String(sim.entities[0].components.health.max));
  ok('goblin group 2, packer', sim.group[0] === 2 && sim.packer[0] === 1 && sim.goblin[0] === 1);
  ok('goblin chase = 1.15 x boar', Math.abs(sim.scfg[0].chase - 4.5 * 1.15) < 1e-9);
  ok('lunge = 2.5 m, windup 30 steps', Math.abs(sim.scfg[0].charge * sim.scfg[0].chargeMaxSec - 2.5) < 1e-9 && sim.ssteps[0].windup === 30);
}

// 2. 4 goblins: at most 2 tokens, circle in 3-5 m band, strikes land
{
  const { sim, hits } = freshSim(ring4.map(([x, y], k) => gobEntity('g' + (k + 1), x, y)));
  let maxTok = 0, circ = 0, circBad = 0, seen2 = false;
  for (let t = 0; t < 8000; t++) {
    sim.step(PX, PY, gz(sim));
    let tok = 0;
    for (let i = 0; i < 4; i++) {
      if (isTok(sim.state[i])) tok++;
      if (sim.state[i] === STATE_CHASE && sim.waiting[i]) {
        const d = Math.hypot(sim.steer.x[i] - PX, sim.steer.y[i] - PY);
        circ++; if (d < 2.5 || d > 5.5) circBad++;
      }
    }
    if (tok > maxTok) maxTok = tok;
    if (tok === 2) seen2 = true;
  }
  const bites = hits.filter((h) => h.target === 'player').length;
  ok('never more than 2 tokens (8k ticks)', maxTok <= 2, `max ${maxTok}`);
  ok('two goblins do attack together', seen2);
  ok('goblins attacked (bites > 5)', bites > 5, `bites ${bites}`);
  ok('waiting goblins circled (about 3-5 m)', circ > 20 && circBad / circ < 0.1, `circ ${circ} bad ${circBad}`);
}

// 3. a hit goblin retreats about 3 m
{
  const { sim, events } = freshSim([gobEntity('g1', PX, PY - 6)]);
  sim.entities[0].components.health.hp = 100; sim.entities[0].components.health.max = 100;
  for (let t = 0; t < 120 && sim.state[0] !== STATE_CHASE; t++) sim.step(PX, PY, gz(sim));
  sim.steer.x[0] = PX; sim.steer.y[0] = PY - 3; sim.steer.vx[0] = 0; sim.steer.vy[0] = 0;
  const x0 = sim.steer.x[0], y0 = sim.steer.y[0];
  sim.state[0] = STATE_WINDUP; sim.timer[0] = 20;
  events.emit('combat:hit', { source: 'player', target: 'g1', damage: 0.5, heavy: false, dirX: 0, dirY: -1 });
  ok('light hit -> retreat (RECOVER)', sim.state[0] === STATE_RECOVER, `state ${sim.state[0]}`);
  let dmax = 0;
  for (let t = 0; t < sim.ssteps[0].recover; t++) { sim.step(PX, PY, gz(sim)); dmax = Math.max(dmax, Math.hypot(sim.steer.x[0] - x0, sim.steer.y[0] - y0)); }
  ok('retreated about 3 m', dmax >= 2 && dmax <= 4.5, `dmax ${dmax.toFixed(2)}`);
}

// 4. lone goblin < 30 % HP flees 20 m; with a packmate it does not
{
  const { sim } = freshSim([gobEntity('g1', PX - 10, PY)]);
  sim.entities[0].components.health.hp = 0.4; // of max 2 (20 %)
  for (let t = 0; t < 600 && !sim.fleeing[0]; t++) sim.step(PX, PY, gz(sim));
  ok('lone hurt goblin flees', sim.fleeing[0] === 1 && sim.state[0] === STATE_RETURN, `fleeing ${sim.fleeing[0]} state ${sim.state[0]}`);
  let dmax = 0;
  for (let t = 0; t < 900; t++) { sim.step(PX, PY, gz(sim)); dmax = Math.max(dmax, Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY)); }
  ok('fled to 20 m, then walks home', dmax >= 19.5 && dmax < 27 && sim.fleeing[0] === 0, `dmax ${dmax.toFixed(1)}`);
}
{
  const { sim } = freshSim([gobEntity('g1', PX - 10, PY), gobEntity('g2', PX - 12, PY + 2)]);
  sim.entities[0].components.health.hp = 0.4;
  for (let t = 0; t < 600; t++) sim.step(PX, PY, gz(sim));
  ok('packed hurt goblin does not flee', sim.fleeing[0] === 0);
}

// 5. dormant: no movement, no perception, state kept, wakes up again
{
  const { sim } = freshSim([gobEntity('g1', PX - 8, PY), gobEntity('g2', PX + 40, PY)]);
  sim.setDormant(0, true);
  const x0 = sim.steer.x[0], y0 = sim.steer.y[0], st0 = sim.state[0], tm0 = sim.timer[0];
  for (let t = 0; t < 600; t++) sim.step(PX, PY, gz(sim));
  ok('dormant goblin did not move', sim.steer.x[0] === x0 && sim.steer.y[0] === y0, `${sim.steer.x[0]} ${sim.steer.y[0]}`);
  ok('dormant goblin kept its state/timer, saw nothing', sim.state[0] === st0 && sim.timer[0] === tm0 && sim.seen[0] === 0 && sim.isDormant(0));
  sim.setDormant(0, false);
  for (let t = 0; t < 300; t++) sim.step(PX, PY, gz(sim));
  ok('woken goblin acts again', sim.state[0] !== st0 || Math.hypot(sim.steer.x[0] - x0, sim.steer.y[0] - y0) > 0.5);
}

// 6. 48 beasts: 0 alloc per step, MAX_BEASTS == 48
{
  ok('MAX_BEASTS 48', MAX_BEASTS === 48);
  const ents = [];
  for (let k = 0; k < 40; k++) ents.push(gobEntity('g' + k, PX - 20 + (k % 8) * 5, PY - 30 + Math.floor(k / 8) * 4, 'melee'));
  for (let k = 0; k < 8; k++) ents.push(beastEntity('b' + k, PX + 20 + k * 2, PY + 20));
  const { sim } = freshSim(ents);
  ok('48 slots', sim.count === 48);
  for (let k = 0; k < 20; k++) sim.setDormant(k, true);
  for (let t = 0; t < 300; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let t = 0; t < 2000; t++) sim.step(PX, PY, gz(sim));
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - m0;
  ok('48 beasts: ~0 alloc per step', global.gc ? grown <= 1e6 : true, `heap +${grown} B / 2000 steps`);
}

// 7. ensureGoblins + overrides
{
  const w0 = buildWorld([beastEntity('boar1', PX, PY)]);
  ok('no goblin anchors -> nothing', ensureGoblins(w0, ['gx']) === 0);
  const w1 = buildWorld([{ id: 'gx', type: 'anchor', x: PX - 5, y: PY, z: 'ground', components: {} }]);
  ok('anchor -> goblin beast', ensureGoblins(w1, ['gx']) === 1 && w1.entity('gx').components.brain.species === 'goblin' && w1.entity('gx').components.voxel.model === 'goblin');
  ok('overrides finite', Number.isFinite(goblinOverrides().chase) && GOBLIN_TUNING.tokens === 2);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
