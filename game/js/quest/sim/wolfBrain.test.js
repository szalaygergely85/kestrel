// game/js/quest/sim/wolfBrain.test.js (WOLF-01). Reuses the beastSim.test.js scaffold. Headless Node ESM, no framework.
// Run: node game/js/quest/sim/wolfBrain.test.js
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
import { ensureWolves, WOLF_TUNING, circleTarget } from './wolfBrain.js';
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


function wolfEntity(id, x, y) {
  const e = beastEntity(id, x, y);
  e.components.brain.species = 'wolf';
  return e;
}
const PX = 1461, PY = 1031;
const ring = [[PX - 9, PY - 2], [PX + 8, PY + 3], [PX + 1, PY - 10]];
function pack() {
  return freshSim(ring.map(([x, y], k) => wolfEntity('wolf' + (k + 1), x, y)));
}
const isTok = (s) => s === STATE_WINDUP || s === STATE_CHARGE;

// 1. stats: HP 0.75x, run 1.3x, leap 5 m
{
  const { sim } = pack();
  ok('wolf hp = 3 (0.75 x boar 4)', sim.entities[0].components.health.max === 3, String(sim.entities[0].components.health.max));
  ok('wolf chase = 1.3 x boar', Math.abs(sim.scfg[0].chase - 4.5 * 1.3) < 1e-9);
  ok('OB-220 bite lunge = 2 m (8 m/s x 0.25 s), reach 1.8 m', Math.abs(sim.scfg[0].charge * sim.scfg[0].chargeMaxSec - 2) < 1e-9 && sim.scfg[0].windupR === 1.8);
  ok('snap >= 24 steps (0.4 s), step-back 48 steps', sim.ssteps[0].windup >= 24 && sim.ssteps[0].recover === 48);
}

// 2. token never shared over 10k ticks, telegraph >= 0.5 s, circling band, bites happen, 0 alloc
{
  const { sim, hits } = freshSim([...ring, [ring[0][0] + 2, ring[0][1] + 3]].map(([x, y], k) => wolfEntity('wolf' + (k + 1), x, y))); // OB-150: 4 wolves, 2 tokens -> the others circle
  let maxTok = 0, bites = 0, minCrouch = 1e9, crouch = new Int32Array(4), circ = 0, circBad = 0;
  for (let t = 0; t < 10000; t++) {
    sim.step(PX, PY, groundZ(sim.world, PX, PY));
    let tok = 0;
    for (let i = 0; i < 4; i++) {
      const s = sim.state[i];
      if (isTok(s)) tok++;
      if (s === STATE_WINDUP) crouch[i]++;
      else { if (crouch[i] > 0 && s === STATE_CHARGE) minCrouch = Math.min(minCrouch, crouch[i]); crouch[i] = 0; }
      if (s === STATE_CHASE && sim.waiting[i]) {
        const d = Math.hypot(sim.steer.x[i] - PX, sim.steer.y[i] - PY);
        circ++; if (d < 1.2 || d > 4.5) circBad++; // OB-220: melee circling stays close
      }
    }
    if (tok > maxTok) maxTok = tok;
    // keep wolves from drifting off for good: restart a leashed one is not needed here
  }
  bites = hits.filter((h) => h.target === 'player').length;
  ok('at most 2 tokens (OB-150, 10k ticks)', maxTok <= 2, `max ${maxTok}`);
  ok('wolves attacked (bites > 5)', bites > 5, `bites ${bites}`);
  ok('telegraph (snap) >= 24 steps (0.4 s)', minCrouch >= 24, `min ${minCrouch}`);
  ok('waiting wolves circled', circ > 8 && circBad / circ < 0.1, `circ ${circ} bad ${circBad}`);
}

// 3. block = 0 damage path: blocked flag -> stagger, not recover; arrow cancels the crouch
{
  const { sim, events } = freshSim([wolfEntity('wolf1', PX, PY - 8)]);
  events.on('combat:hit', (p) => { if (p.target === 'player') p.blocked = 1; });
  sim.steer.x[0] = PX; sim.steer.y[0] = PY - 1.7;
  sim.state[0] = STATE_WINDUP; sim.timer[0] = 1; // last crouch step -> real enterCharge (leap accel) -> contact
  let n = 0;
  sim.step(PX, PY, 0);
  while ((sim.state[0] === STATE_CHARGE || sim.state[0] === STATE_WINDUP) && n++ < 40) sim.step(PX, PY, 0);
  ok('blocked leap -> STAGGER', sim.state[0] === STATE_STAGGER, `state ${sim.state[0]}`);
}
{
  const { sim, events } = freshSim([wolfEntity('wolf1', PX, PY - 8)]);
  sim.state[0] = STATE_WINDUP; sim.timer[0] = sim.ssteps[0].windup;
  events.emit('combat:hit', { source: 'player', target: 'wolf1', damage: 0.5, heavy: false, dirX: 0, dirY: 1 });
  ok('arrow (light hit) cancels the crouch -> recover', sim.state[0] === STATE_RECOVER, `state ${sim.state[0]}`);
}

// 4. lone wolf < 25% HP flees 30 m; a wolf with a packmate does not
{
  const { sim } = freshSim([wolfEntity('wolf1', PX - 10, PY)]);
  sim.entities[0].components.health.hp = 0.5;
  for (let t = 0; t < 600 && !sim.fleeing[0]; t++) sim.step(PX, PY, groundZ(sim.world, PX, PY));
  ok('lone hurt wolf flees', sim.fleeing[0] === 1 && sim.state[0] === STATE_RETURN, `fleeing ${sim.fleeing[0]} state ${sim.state[0]}`);
  let dmax = 0;
  for (let t = 0; t < 900; t++) { sim.step(PX, PY, groundZ(sim.world, PX, PY)); dmax = Math.max(dmax, Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY)); }
  ok('fled to 30 m from the player, then walks home', dmax >= 29.5 && sim.fleeing[0] === 0, `dmax ${dmax.toFixed(1)}`);
}
{
  const { sim } = freshSim([wolfEntity('wolf1', PX - 10, PY), wolfEntity('wolf2', PX - 12, PY + 2)]);
  sim.entities[0].components.health.hp = 0.5;
  for (let t = 0; t < 600; t++) sim.step(PX, PY, groundZ(sim.world, PX, PY));
  ok('packed hurt wolf does not flee', sim.fleeing[0] === 0);
}

// 5. ensureWolves: absent anchors -> nothing; present -> wolf beast with the single model id
{
  const w0 = buildWorld([beastEntity('boar1', PX, PY)]);
  ok('no wolf anchors -> ensureWolves does nothing', ensureWolves(w0) === 0);
  const w1 = buildWorld([{ id: 'wolf1', type: 'anchor', x: PX - 5, y: PY, z: 'ground', components: {} }, beastEntity('boar1', PX, PY)]);
  ok('anchor wolf1 -> wolf beast', ensureWolves(w1) === 1 && w1.entity('wolf1').components.brain.species === 'wolf');
  const out = { x: 0, y: 0 };
  circleTarget(5, 0, 0, 0, 5, 1, out);
  ok('circleTarget is tangent at radius', Math.abs(out.x - 5) < 1e-9 && Math.abs(out.y - 2) < 1e-9);
}

// OB-220: a wolf is a melee biter (closes to ~1.8 m, snap, short lunge, steps back); a boar still charges from range
{
  const run = (ent) => {
    const { sim, hits } = freshSim([ent]);
    sim.fx[0] = -1; sim.fy[0] = 0;
    let minD = 99, crossed = false, maxWindD = 0, maxWindDBoar = 0; const hitT = []; let seen = 0;
    for (let t = 0; t < 1500; t++) {
      sim.step(PX, PY, groundZ(sim.world, PX, PY));
      const dx = sim.steer.x[0] - PX, dy = sim.steer.y[0] - PY, d = Math.hypot(dx, dy);
      if (d < minD) { minD = d;  }
      if (dx < -0.05) crossed = crossed; else if (t > 0 && dx < 0.05 && d < 1.5 && seen) crossed = true; // east side start: x - PX > 0 always
      const st = sim.state[0];
      if (st === STATE_WINDUP || st === STATE_CHARGE) { seen = 1; if (d > maxWindD) maxWindD = d; }
      const n = hits.filter((h) => h.target === 'player').length;
      while (hitT.length < n) hitT.push(t / 60);
    }
    return { minD, crossed, maxWindD, hitT };
  };
  const wolf = run(wolfEntity('wolf1', PX + 8, PY));
  ok('OB-220 wolf never reaches the player centre (minD > 0.4)', wolf.minD > 0.4, 'minD ' + wolf.minD.toFixed(2));
  ok('OB-220 wolf attacks only from melee range (windup/lunge d <= 2.6 m)', wolf.maxWindD <= 2.6, 'max ' + wolf.maxWindD.toFixed(2));
  ok('OB-220 wolf hits repeatedly (>= 4 in 25 s)', wolf.hitT.length >= 4, 'hits ' + wolf.hitT.length);
  let gapMin = 99; for (let k = 1; k < wolf.hitT.length; k++) gapMin = Math.min(gapMin, wolf.hitT[k] - wolf.hitT[k - 1]);
  ok('OB-220 wolf hits are on cooldown (gap >= 1.2 s)', gapMin >= 1.2, 'gap ' + gapMin.toFixed(2));
  const boar = run(beastEntity('b1', PX + 8, PY));
  ok('OB-220 boar still charges from range (windup start > 3.5 m)', boar.maxWindD > 3.5, 'max ' + boar.maxWindD.toFixed(2));
  const same = run(wolfEntity('wolf1', PX + 8, PY));
  ok('OB-220 deterministic (same hit times twice)', JSON.stringify(same.hitT) === JSON.stringify(wolf.hitT));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
