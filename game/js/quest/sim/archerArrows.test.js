// game/js/quest/sim/archerArrows.test.js: skeleton / bandit archer `beast:shoot` -> enemy arrow (cause 'arrow') via goblinWire.fireVolley.
// Run: node game/js/quest/sim/archerArrows.test.js
import { World } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as VCFG } from './vitalsConfig.js';
import { createShieldSim } from './shield.js';
import { createArrowSim, createPlayerTarget } from './arrows.js';
import { GOBLIN_SPEAR_CFG } from '../bowConfig.js';
import { fireVolley } from '../../life/goblinWire.js';
import { KINDS } from './beastKinds.js';

const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
function makeEvents() {
  const ls = new Map();
  return { on(n, fn) { let s = ls.get(n); if (!s) { s = new Set(); ls.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) { const s = ls.get(n); if (s) for (const fn of Array.from(s)) fn(p); } };
}
function rig(px, wallX = null) {
  const real = World.load({ name: 'aa', terrain: null, structures: [], entities: [
    { id: 'player', type: 'player', x: px, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'sk1', type: 'beast', x: 0, y: 0, z: 0, components: {} },
  ], state: {} }, assets, {});
  const world = { get: (id) => real.get(id), flowAt() {}, forEachEntity: (f) => real.forEachEntity(f),
    raySegmentRay: (seg, out) => { if (wallX === null) return false; const ax = seg[0], bx = seg[3]; if (ax >= wallX || bx < wallX) return false;
      out.t = (wallX - ax) / (bx - ax); out.x = wallX; out.y = seg[1] + (seg[4] - seg[1]) * out.t; out.z = seg[2] + (seg[5] - seg[2]) * out.t; return true; } };
  const events = makeEvents(); const shield = createShieldSim();
  const vitals = createVitals(real, events, VCFG, { block: shield });
  const player = real.get('player').data; vitals.step(player, false);
  const sim = createArrowSim(world, events, GOBLIN_SPEAR_CFG, createPlayerTarget(world), null, { owner: 'enemy' });
  return { events, shield, vitals, player, sim };
}
const shot = (tx) => ({ id: 'sk1', slot: 0, dmgF: KINDS.skeleton_archer ? KINDS.skeleton_archer.attacks[0].dmgF : 1, x: 0, y: 0, z: 1.4, tx, ty: 0, tz: 0.9 });
function run(r, n) { for (let i = 0; i < n; i++) { r.sim.step(); r.vitals.step(r.player, false); } }

{ const r = rig(10); let cause = null; r.events.on('combat:hit', (p) => { cause = p.cause; });
  ok('fireVolley launches', fireVolley(r.sim, shot(10)) === true);
  run(r, 80);
  ok('skeleton archer at 10 m hits a standing player (cause arrow)', cause === 'arrow' && r.vitals.hp < VCFG.maxHp, `cause=${cause} hp=${r.vitals.hp}`); }
{ const r = rig(10); for (let i = 0; i < 12; i++) r.shield.step(true, true, -1, 0);
  let blocked = -1; r.events.on('combat:hit', (p) => { blocked = p.blocked; });
  fireVolley(r.sim, shot(10)); for (let i = 0; i < 80; i++) { r.shield.step(true, true, -1, 0); run(r, 1); }
  ok('raised frontal shield blocks the arrow', blocked === 1 && r.vitals.hp === VCFG.maxHp, `blocked=${blocked} hp=${r.vitals.hp}`); }
{ const r = rig(10, 5); let hit = false; r.events.on('combat:hit', () => { hit = true; });
  fireVolley(r.sim, shot(10)); run(r, 80);
  ok('a wall between blocks the arrow', !hit && r.vitals.hp === VCFG.maxHp && r.sim.flyingCount === 0, `hit=${hit}`); }
{ const r = rig(10); let hit = false; r.events.on('combat:hit', () => { hit = true; });
  fireVolley(r.sim, shot(10)); for (let i = 0; i < 100; i++) { r.player.transform.y += 4 / 60; run(r, 1); }
  ok('a strafing player dodges it', !hit); }
console.log(`archerArrows: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
