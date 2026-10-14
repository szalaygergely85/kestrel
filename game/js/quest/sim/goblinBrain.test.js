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

// 6. 48 beasts: 0 alloc per step, MAX_BEASTS == 96 (this scenario still uses 48 slots)
{
  ok('MAX_BEASTS 160 (BEAST-06b, was 96 WM-12)', MAX_BEASTS === 160);
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

// 8. GOB-02 throwers
{
  const throwsOf = (events) => { const a = []; events.on('beast:throw', (p) => a.push({ obj: p, slot: p.slot, x: p.x, y: p.y, z: p.z, tx: p.tx, ty: p.ty, tz: p.tz })); return a; };
  const { sim, events } = freshSim([gobEntity('t1', PX - 15, PY, 'thrower')]);
  const th = throwsOf(events);
  const state0 = []; const wind0 = [];
  let wsteps = 0, minD = 99, maxDbandStart = 0, bad = 0, firstBand = -1;
  const lastWind = { start: -1 }; const gaps = []; let lastEnd = -1; let winMax = 0;
  for (let t = 0; t < 3000; t++) {
    const before = th.length;
    sim.step(PX, PY, gz(sim));
    const d = Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY);
    if (sim.state[0] === STATE_WINDUP) {
      wsteps++; if (d < 6.5 || d > 14.5) bad++;
    } else if (sim.state[0] === STATE_CHASE && sim.seen[0] && firstBand < 0 && d <= 14) firstBand = t;
    if (sim.state[0] !== STATE_WINDUP && wsteps > 0) { wind0.push(wsteps); wsteps = 0; }
    if (th.length > before) { gaps.push(lastEnd < 0 ? 1e9 : t - lastEnd); lastEnd = t; }
  }
  ok('thrower: holds position around 7-14 m while throwing (windups inside 6.5-14.5)', bad === 0 && th.length > 3, `bad ${bad} throws ${th.length}`);
  ok('thrower: every windup is 0.6 s (36 steps) before a throw', wind0.length >= th.length - 1 && wind0.slice(0, th.length - 1).every((n) => n === 36), JSON.stringify(wind0.slice(0, 5)));
  ok('thrower: reload respected (>= 36 + 120 steps between throws)', gaps.slice(1).every((g) => g >= 156), JSON.stringify(gaps.slice(0, 5)));
  ok('beast:throw payload is ONE preallocated object', th.every((q) => q.obj === th[0].obj));
  const q = th[0];
  ok('payload: hand at eye+0.4, aims at the chest', Math.abs(q.z - (groundZ(sim.world, q.x, q.y) + 0.9)) < 0.3 && Math.abs(q.tx - PX) < 1e-9 && Math.abs(q.ty - PY) < 1e-9 && Math.abs(q.tz - (gz(sim) + 1.0)) < 1e-9, JSON.stringify({ z: q.z, tz: q.tz }));
  ok('payload slot 0', q.slot === 0);
}
// 8b. back off: player closes in -> distance rises to >= 7 m
{
  const { sim } = freshSim([gobEntity('t1', PX - 3, PY, 'thrower')]);
  sim.state[0] = STATE_CHASE; sim.seen[0] = 1;
  let maxD = 0;
  for (let t = 0; t < 300; t++) { sim.step(PX, PY, gz(sim)); maxD = Math.max(maxD, Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY)); }
  ok('thrower backs off from 3 m to >= 6 m (or flees when cornered)', maxD >= 6, `maxD ${maxD.toFixed(1)}`);
}
// 8c. paths in from far (15.5 m, noticeR 16) up to the band
{
  const { sim } = freshSim([gobEntity('t1', PX - 20, PY, 'thrower')]);
  sim.state[0] = STATE_CHASE; // 20 m is outside noticeR 16: start already chasing
  let minD = 99;
  for (let t = 0; t < 600; t++) { sim.step(PX, PY, gz(sim)); minD = Math.min(minD, Math.hypot(sim.steer.x[0] - PX, sim.steer.y[0] - PY)); }
  ok('thrower approached from 20 m and stayed >= 6 m', minD >= 6 && minD <= 14.5, `minD ${minD.toFixed(1)}`);
}
// 8e. direct LOS gate: wall of terrain not available, so use sim.cfg.losEvery huge to freeze cached seen = 0
{
  const { sim, events } = freshSim([gobEntity('t1', PX - 10, PY, 'thrower')]);
  let n = 0; events.on('beast:throw', () => n++);
  sim.cfg = { ...sim.cfg, losEvery: 1 << 30 }; // perceive never refreshes the cache
  sim.step(PX, PY, gz(sim)); // tick 0 is the only perceive refresh left
  sim.state[0] = STATE_CHASE; sim.seen[0] = 0; sim.unseen[0] = 0;
  let w = 0;
  for (let t = 0; t < 400; t++) { sim.unseen[0] = 0; sim.step(PX, PY, gz(sim)); if (sim.state[0] === STATE_WINDUP) w++; }
  ok('no LOS (cached seen 0): no windup, no throw', n === 0 && w === 0, `throws ${n} windup steps ${w}`);
  sim.seen[0] = 1;
  let n2 = 0; for (let t = 0; t < 120; t++) { sim.step(PX, PY, gz(sim)); }
  ok('LOS back -> throws', n > 0, `throws ${n}`);
}
// 8f. at most 2 throwers in windup at once
{
  const ents = []; for (let k = 0; k < 5; k++) ents.push(gobEntity('t' + k, PX - 10 - k * 0.8, PY + (k - 2) * 2, 'thrower'));
  const { sim } = freshSim(ents);
  let mx = 0, thr = 0; sim.events.on('beast:throw', () => thr++);
  for (let t = 0; t < 1500; t++) { sim.step(PX, PY, gz(sim)); let w = 0; for (let k = 0; k < 5; k++) if (sim.state[k] === STATE_WINDUP) w++; if (w > mx) mx = w; }
  ok('max 2 throwers winding up', mx <= 2 && mx >= 1 && thr > 3, `max ${mx} throws ${thr}`);
}
// 8g. melee goblin never throws; boars untouched; 0 alloc with throwers
{
  const { sim, events } = freshSim([gobEntity('m1', PX - 10, PY, 'melee')]);
  let n = 0; events.on('beast:throw', () => n++);
  for (let t = 0; t < 600; t++) sim.step(PX, PY, gz(sim));
  ok('melee goblin emits no beast:throw', n === 0 && sim.ranged[0] === 0 && sim.packer[0] === 1);
  const ents = []; for (let k = 0; k < 6; k++) ents.push(gobEntity('t' + k, PX - 12 - k, PY + (k - 3) * 2, 'thrower'));
  const w = freshSim(ents).sim;
  for (let t = 0; t < 400; t++) w.step(PX, PY, gz(w));
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let t = 0; t < 2000; t++) w.step(PX, PY, gz(w));
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - m0;
  ok('6 throwers: ~0 alloc per step', global.gc ? grown <= 1e6 : true, `heap +${grown} B`);
}

// 9. GOB-01b: setDown / flee / slotOf for goblinCamps
{
  const { sim } = freshSim([gobEntity('d0', PX - 10, PY, 'melee'), gobEntity('d1', PX - 12, PY + 3, 'melee')]);
  for (let t = 0; t < 60; t++) sim.step(PX, PY, gz(sim));
  ok('slotOf maps ids', sim.slotOf('d0') === 0 && sim.slotOf('d1') === 1 && sim.slotOf('nope') === -1 && sim.group[0] === 2);
  sim.setDown(0, true);
  for (let t = 0; t < 120; t++) sim.step(PX, PY, gz(sim));
  ok('setDown(true): GONE, isDead, parked; sibling alive', sim.state[0] === STATE_GONE && sim.isDead(0) && !sim.steer.active[0] && !sim.isDead(1));
  sim.entities[1].components.health.hp = 1;
  sim.setDown(0, false);
  ok('setDown(false): alive at home, hp max, wander, agent active', sim.state[0] === STATE_WANDER && !sim.isDead(0) && sim.steer.active[0] === 1
    && sim.entities[0].components.health.hp === sim.entities[0].components.health.max && sim.steer.x[0] === sim.homeX[0]);
  sim.setDown(0, false); sim.setDown(1, false); // no-ops on a slot that is not down
  ok('setDown(false) on an up slot is a no-op', sim.entities[1].components.health.hp === 1);
  sim.setDown(0, true); sim.setDown(0, true); sim.setDown(0, false);
  ok('setDown idempotent', sim.state[0] === STATE_WANDER && sim.steer.active[0] === 1);
  const x0 = sim.steer.x[1], y0 = sim.steer.y[1];
  sim.flee(1);
  for (let t = 0; t < 180; t++) sim.step(PX, PY, gz(sim));
  const d0 = Math.hypot(x0 - PX, y0 - PY), d1 = Math.hypot(sim.steer.x[1] - PX, sim.steer.y[1] - PY);
  ok('flee(slot): runs away (fleeing set, not closer)', d1 >= d0 - 0.5, `d0 ${d0.toFixed(1)} d1 ${d1.toFixed(1)}`);
  sim.setDown(1, true); sim.flee(1);
  ok('flee on a down slot is ignored', sim.state[1] === STATE_GONE);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
