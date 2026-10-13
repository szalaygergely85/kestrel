// game/js/quest/sim/goblinSpear.test.js (GOB-03, docs/architecture.md 38.57). Headless Node ESM.
// Run: node --expose-gc game/js/quest/sim/goblinSpear.test.js
// Enemy spear = the arrow sim with opts.owner 'enemy' + lobVelocity + createPlayerTarget, through the real vitals + shield.
import { World } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS as VCFG } from './vitalsConfig.js';
import { createShieldSim } from './shield.js';
import { createArrowSim, createPlayerTarget, lobVelocity } from './arrows.js';
import { createTargetables } from './targetables.js';
import { GOBLIN_SPEAR_CFG, BOW_CFG } from '../bowConfig.js';

if (typeof global.gc !== 'function') { // the 0-alloc check needs gc: re-run self with --expose-gc
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeEvents() {
  const ls = new Map(); const log = [];
  return {
    log,
    on(n, fn) { let s = ls.get(n); if (!s) { s = new Set(); ls.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) { log.push(n); const s = ls.get(n); if (s) for (const fn of Array.from(s)) fn(p); },
  };
}
const lob = { vx: 0, vy: 0, vz: 0 };
/** Player at (px,0), thrower 'g1' at the origin. */
function rig(px) {
  const real = World.load({ name: 'gs', terrain: null, structures: [], entities: [
    { id: 'player', type: 'player', x: px, y: 0, z: 0, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'g1', type: 'beast', x: 0, y: 0, z: 0, components: {} },
  ], state: {} }, assets, {});
  const world = { get: (id) => real.get(id), raySegment: () => false, flowAt() {}, forEachEntity: (f) => real.forEachEntity(f) };
  const events = makeEvents();
  const shield = createShieldSim();
  const vitals = createVitals(real, events, VCFG, { block: shield });
  const player = real.get('player').data;
  vitals.step(player, false);
  const sim = createArrowSim(world, events, GOBLIN_SPEAR_CFG, createPlayerTarget(world), null, { owner: 'enemy' });
  return { real, world, events, shield, vitals, player, sim };
}
function throwAt(r, tx, ty = 0) {
  lobVelocity(0, 0, 1.4, tx, ty, 0.9, GOBLIN_SPEAR_CFG.speedH, GOBLIN_SPEAR_CFG.g, lob);
  return r.sim.fireVel(0, 0, 1.4, lob.vx, lob.vy, lob.vz, 1, 'g1');
}
function run(r, n) { for (let i = 0; i < n; i++) { r.sim.step(); r.vitals.step(r.player, false); } }

// ---- standing player at 12 m is hit: combat:hit ranged 1, hp -1 heart x tier ----
{
  const r = rig(12); let got = null;
  r.events.on('combat:hit', (p) => { if (!got) got = { ranged: p.ranged, target: p.target, source: p.source }; });
  throwAt(r, 12);
  run(r, 80);
  ok('lobbed spear hits a standing player at 12 m', got && got.ranged === 1 && got.target === 'player' && got.source === 'g1', JSON.stringify(got));
  ok('player loses 1 x beastDamageScale hp', r.vitals.hp === VCFG.maxHp - VCFG.beastDamageScale, `hp=${r.vitals.hp}`);
  ok('spear is gone after hitting', r.sim.flyingCount === 0 && r.sim.stuckCount === 0);
}
// ---- a sidestepping player (4 m/s from release) is missed at 8, 10, 12 m (no aim lead) ----
for (const d of [8, 10, 12]) {
  const r = rig(d);
  throwAt(r, d);
  let hit = false; r.events.on('combat:hit', () => { hit = true; });
  for (let i = 0; i < 100; i++) { r.player.transform.y += 4 / 60; run(r, 1); }
  ok(`strafing player is missed at ${d} m`, !hit && r.vitals.hp === VCFG.maxHp, `hit=${hit} hp=${r.vitals.hp}`);
}
// ---- shield: from the front blocked (no damage, spear drops, clank event); from behind damages ----
{
  const r = rig(12);
  for (let i = 0; i < 12; i++) r.shield.step(true, true, -1, 0); // facing the thrower (-x), fully raised
  ok('shield is blocking', r.shield.blocking);
  let blockedFlag = -1; r.events.on('combat:hit', (p) => { blockedFlag = p.blocked; });
  throwAt(r, 12);
  for (let i = 0; i < 80; i++) { r.shield.step(true, true, -1, 0); run(r, 1); }
  ok('spear inside the arc is blocked: no damage', blockedFlag === 1 && r.vitals.hp === VCFG.maxHp, `blocked=${blockedFlag} hp=${r.vitals.hp}`);
  ok('blocked spear drops (stuck, not flying), beast:spearBlocked emitted', r.sim.flyingCount === 0 && r.sim.stuckCount === 1 && r.events.log.includes('beast:spearBlocked'));
  ok('blocked spear is not pickable', r.sim.nearestPickable(12, 0, 0.9, 5) === -1);
}
{
  const r = rig(12);
  for (let i = 0; i < 12; i++) r.shield.step(true, true, 1, 0); // back to the thrower
  throwAt(r, 12);
  for (let i = 0; i < 80; i++) { r.shield.step(true, true, 1, 0); run(r, 1); }
  ok('spear from behind (outside the arc) damages', r.vitals.hp === VCFG.maxHp - VCFG.beastDamageScale, `hp=${r.vitals.hp}`);
}
// ---- never hits goblins, never pickable ----
{
  const real = World.load({ name: 'gs2', terrain: null, structures: [], entities: [
    { id: 'player', type: 'player', x: 40, y: 20, z: 0, components: {} },
    { id: 'gob2', type: 'beast', x: 6, y: 0, z: 0, components: { targetable: { radius: 0.5, height: 1.7 }, health: { hp: 4, max: 4 } } },
  ], state: {} }, assets, {});
  const world = { get: (id) => real.get(id), raySegment: () => false, flowAt() {}, forEachEntity: (f) => real.forEachEntity(f) };
  const events = makeEvents(); let hits = 0; events.on('combat:hit', () => hits++);
  const sim = createArrowSim(world, events, GOBLIN_SPEAR_CFG, createPlayerTarget(world), null, { owner: 'enemy' });
  lobVelocity(0, 0, 1.4, 12, 0, 0.9, 13, GOBLIN_SPEAR_CFG.g, lob);
  sim.fireVel(0, 0, 1.4, lob.vx, lob.vy, lob.vz, 1, 'g1');
  for (let i = 0; i < 100; i++) sim.step();
  ok('spear flying through a goblin never hits it', hits === 0);
  // a spear in the ground sticks but is never pickable
  const w2 = { get: world.get, flowAt() {}, raySegment: (ax, ay, az, bx, by, bz, out) => {
    if (bz > 0.2) return false;
    out.t = (az - 0.2) / (az - bz); out.x = ax + (bx - ax) * out.t; out.y = ay + (by - ay) * out.t; out.z = 0.2; return true;
  } };
  const s2 = createArrowSim(w2, events, GOBLIN_SPEAR_CFG, createPlayerTarget(w2), null, { owner: 'enemy' });
  s2.fireVel(0, 0, 1.4, 5, 0, 0, 1, 'g1');
  for (let i = 0; i < 60; i++) s2.step();
  ok('a spear in the ground sticks but is never pickable (survivePct 0)', s2.stuckCount === 1 && s2.nearestPickable(5, 0, 0.2, 50) === -1 && s2.pickup(5, 0, 0.2, 50, null) === 0, `stuck=${s2.stuckCount}`);
}
// ---- lobVelocity is pure and its arc passes the target (closed form) ----
{
  lobVelocity(0, 0, 1.4, 12, 0, 0.9, 13, 9.8, lob);
  const t = 12 / 13;
  ok('lobVelocity: vx = speedH, arc passes the target height', Math.abs(lob.vx - 13) < 1e-9 && Math.abs(1.4 + lob.vz * t - 0.5 * 9.8 * t * t - 0.9) < 1e-9);
}
// ---- player mode untouched by default ----
{
  const real = World.load({ name: 'gs3', terrain: null, structures: [], entities: [], state: {} }, assets, {});
  const events = makeEvents();
  const sim = createArrowSim({ raySegment: () => false, get: () => null, flowAt() {} }, events, BOW_CFG, createTargetables(real, events));
  ok('default owner keeps the BOW_CFG pools', sim.flying.n === BOW_CFG.maxFlying && sim.stuck.n === BOW_CFG.maxStuck);
}
// ---- 0 allocation per step with 8 spears in flight ----
{
  const r = rig(12);
  const cycle = () => {
    for (let i = 0; i < 5000; i++) {
      if (i % 20 === 0) r.sim.fireVel(0, 0, 50 + (i % 7), 5, 0, 0, 1, 'g1'); // some leave the pool full, some time out
      r.sim.step();
    }
  };
  cycle(); global.gc(); global.gc();
  const h0 = process.memoryUsage().heapUsed;
  cycle(); global.gc(); global.gc();
  const grown = process.memoryUsage().heapUsed - h0;
  ok('0 alloc over 5000 enemy steps', grown < 64000, `grown=${grown}`);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
