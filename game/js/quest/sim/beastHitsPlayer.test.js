// game/js/quest/sim/beastHitsPlayer.test.js (OB-150 step 2: melee beasts must hit the player). Scaffold from goblinBrain.test.js. Reuses the beastSim.test.js scaffold. Headless Node ESM, no framework.
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


const PXX = 1461, PYY = 1031;
const WALK = 3.5; // PHYSICS.walkSpeed m/s
function kindEntity(kind, id, x, y) {
  const e = beastEntity(id, x, y);
  const b = e.components.brain;
  if (kind === 'wolf') b.species = 'wolf';
  else if (kind === 'bear') b.species = 'bear';
  else if (kind === 'goblin') { b.species = 'goblin'; b.role = 'melee'; }
  return e;
}
/** One beast vs one player. mode 'stand' | 'walk' (player walks straight away from the beast at WALK once it has noticed). */
function duel(kind, mode, dist = 9, maxSec = 14, speed = WALK, ang = 0) {
  const { sim, hits } = freshSim([kindEntity(kind, 'b1', PXX + dist * Math.cos(ang), PYY + dist * Math.sin(ang))]);
  sim.fx[0] = -Math.cos(ang); sim.fy[0] = -Math.sin(ang); // beast starts facing the player (default facing is north; a beast looking away legitimately doesn't notice)
  let px = PXX, py = PYY, wind = 0, windFirst = -1, minD = 99;
  const n = Math.round(maxSec * 60);
  for (let t = 0; t < n; t++) {
    if ((mode === 'walk') && sim.state[0] !== STATE_WANDER) {
      const dx = px - sim.steer.x[0], dy = py - sim.steer.y[0], d = Math.hypot(dx, dy) || 1;
      // the player is blocked by walls/water (nav cost 0): try straight away, else slide +-45/90 deg
      const g = sim.grid, ux = dx / d, uy = dy / d, stp = speed / 60;
      for (const a of [0, 0.785, -0.785, 1.571, -1.571]) {
        const c = Math.cos(a), sn = Math.sin(a), nx = px + (ux * c - uy * sn) * stp, ny = py + (ux * sn + uy * c) * stp;
        const cx = g.cellX(nx), cy = g.cellY(ny);
        if (g.inBounds(cx, cy) && g.cost[cy * g.w + cx] !== 0) { px = nx; py = ny; break; }
      }
    }
    sim.step(px, py, groundZ(sim.world, px, py));
    const d = Math.hypot(px - sim.steer.x[0], py - sim.steer.y[0]); if (d < minD) minD = d;
    if (sim.state[0] === STATE_WINDUP) { if (windFirst < 0) windFirst = t; wind = t - windFirst + 1; }
    const h = hits.find((q) => q.target === 'player');
    if (globalThis.TRACE && (+process.env.TANG === ang * 180 / Math.PI) && t % 30 === 0) console.log(kind, (t/60).toFixed(1), "st", sim.state[0], "d", d.toFixed(1), "mv", sim.mv[0].toFixed(1), "pos", sim.steer.x[0].toFixed(1), sim.steer.y[0].toFixed(1), "pl", px.toFixed(1), py.toFixed(1), "pathLen", sim.pathLen[0], "tact", sim.tactOn[0], sim.tactRole[0], "wait", sim.waiting[0], "bank", sim.bankHold[0], "leash", sim._lagents[0].leashMode, "seen", sim.seen[0], "unseen", sim.unseen[0]);
    if (h) return { tHit: (t + 1) / 60, dmg: h.damage, wind: wind / 60, minD, d, hit: true };
  }
  return { hit: false, minD, wind: wind / 60 };
}
globalThis.TRACE = process.env.TRACE;
for (const kind of ['boar', 'wolf', 'bear', 'goblin']) {
  const s = duel(kind, 'stand'), w = duel(kind, 'walk');
  const f = (r) => r.hit ? `HIT t=${r.tHit.toFixed(2)}s dmg=${r.dmg} dist=${r.d.toFixed(2)}` : `MISS minDist=${r.minD.toFixed(2)}`;
  console.log(kind.padEnd(7), 'wind', s.wind.toFixed(2), '| stand:', f(s), '| walk-away:', f(w));
  ok(`${kind}: standing player gets hit within 12 s`, s.hit && s.tHit <= 12, f(s));
  ok(`${kind}: walking-away player gets hit`, w.hit, f(w));
  if (kind === 'bear' || kind === 'goblin') ok(`${kind}: walking-away player gets hit within 12 s`, w.hit && w.tHit <= 12, f(w)); // OB-150
  const r = duel(kind, 'walk', 9, 10, PHYSICS.runSpeed); // OB-150 fairness: a RUNNING player (6 m/s) escapes every type
  ok(`${kind}: running player (${PHYSICS.runSpeed} m/s) escapes for 10 s`, !r.hit, f(r));
  ok(`${kind}: readable wind-up >= 0.3 s`, s.wind >= 0.3 - 1e-9, String(s.wind));
}
// OB-150: start-angle sweep (8 angles): a walking-away player is hit for boar/wolf at all 8, bear/goblin >= 6 of 8.
for (const kind of ['boar', 'wolf', 'bear', 'goblin']) {
  let n = 0; const miss = [];
  for (let k = 0; k < 8; k++) { const r = duel(kind, 'walk', 9, 14, WALK, k * Math.PI / 4); if (r.hit) n++; else miss.push(k * 45); }
  const need = (kind === 'boar' || kind === 'wolf') ? 8 : 6;
  ok(`${kind}: walk-away hit at >= ${need}/8 start angles`, n >= need, `${n}/8 misses at ${miss.join(',')} deg`);
}
// OB-150 group pressure: 3 beasts of one pack vs a STANDING player.
function pack(kind, maxSec = 10) {
  const spots = [[10, 0], [11, 2], [12, -2]];
  const { sim, hits } = freshSim(spots.map((o, k) => kindEntity(kind, 'p' + k, PXX + o[0], PYY + o[1])));
  for (let k = 0; k < 3; k++) { sim.fx[k] = -1; sim.fy[k] = 0; }
  let maxWind = 0, firstHit = -1; const dirs = new Set();
  for (let t = 0; t < maxSec * 60; t++) {
    sim.step(PXX, PYY, groundZ(sim.world, PXX, PYY));
    let w = 0; for (let k = 0; k < 3; k++) if (sim.state[k] === STATE_WINDUP || sim.state[k] === STATE_CHARGE) w++;
    if (w > maxWind) maxWind = w;
    for (const h of hits) if (h.target === 'player' && !h._seen) { h._seen = 1; { const k = sim.slotOf(h.source); if (k >= 0) dirs.add(Math.round(Math.atan2(sim.steer.y[k] - PYY, sim.steer.x[k] - PXX) / (Math.PI / 2)) & 3); } /* attacker bearing at the hit, 90-degree sectors */ if (firstHit < 0) firstHit = t / 60; }
  }
  return { maxWind, dirs: [...dirs], n: hits.filter((h) => h.target === 'player').length };
}
for (const kind of ['wolf', 'goblin']) {
  const r = pack(kind);
  console.log(kind, 'pack', JSON.stringify(r));
  ok(`${kind} pack: hits from >= 2 different directions within 10 s`, r.dirs.length >= 2, JSON.stringify(r));
  ok(`${kind} pack: never 3 simultaneous wind-ups`, r.maxWind <= 2, JSON.stringify(r));
}
console.log(`beastHitsPlayer: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.log('FAIL ' + m); process.exit(1); }
