import assert from 'node:assert/strict';
import '../../../design/levels/world_geo.js';
import '../../../design/models/voxel_seamonster.js';
import { createShore, SEA_EDGE_CONFIG } from './seaEdge.js';
import { createSeaMonster, HIDDEN, CIRCLE, RISE, STRIKE, SEA_MONSTER_CONFIG as C } from './seaMonster.js';

const shore = createShore(globalThis.ASSETS.levels.world_geo.coast);
const vitals = { dead: false, cause: null, kill(c) { this.dead = true; this.cause = c; return true; } };
const ent = { transform: { x: 0, y: 0, z: -500 }, clip: null };
const rip = []; const ripples = { add(x, y) { rip.push([x, y]); return true; } };
const sm = createSeaMonster(vitals, shore, { ent, ripples });
const P = { x: 1525, y: 1770, swimming: true, inSea: true, surfaceZ: 0 };
const run = (steps) => { for (let i = 0; i < steps; i++) sm.step(P, i / 60); };
const swimTo = (dy) => { P.y = 1770 + dy; };

assert.equal(sm.state, HIDDEN); assert.equal(ent.transform.z, C.hideZ);
swimTo(20); run(60); assert.equal(sm.state, HIDDEN, 'safe band');
swimTo(SEA_EDGE_CONFIG.warnM + 4); run(15); assert.equal(sm.state, CIRCLE, 'warn band -> circle (first 4 Hz check)');
run(60);
assert.ok(rip.length >= 2, 'ripples');
const d = Math.hypot(ent.transform.x - P.x, ent.transform.y - P.y);
assert.ok(d >= 10 && d <= 14, 'orbit 10-14 m: ' + d); assert.ok(ent.transform.z === P.surfaceZ && ent.clip === 'circle', 'anchor = waterline, no offsets');
// back inside -> hidden
swimTo(20); run(15); assert.equal(sm.state, HIDDEN); assert.equal(ent.transform.z, C.hideZ);
// out again, then kill band -> rise -> strike -> eaten
swimTo(SEA_EDGE_CONFIG.warnM + 4); run(15); assert.equal(sm.state, CIRCLE);
swimTo(SEA_EDGE_CONFIG.killM + 6); run(15); assert.equal(sm.state, RISE);
run(C.riseSteps - 2); assert.equal(sm.state, RISE); run(1); assert.equal(sm.state, STRIKE);
assert.equal(ent.transform.z, P.surfaceZ, 'waterline in strike too');
const FRONT = globalThis.ASSETS.seaMonsterFx.place.anchorFromPlayerM;
assert.ok(Math.abs(Math.hypot(ent.transform.x - P.x, ent.transform.y - P.y) - FRONT) < 1e-9, 'anchorFromPlayerM in front');
assert.equal(vitals.dead, false); run(C.strikeSteps); assert.equal(vitals.dead, true); assert.equal(vitals.cause, 'eaten');
run(1); assert.equal(sm.state, HIDDEN, 'parked after death');
// respawn -> hidden even mid-circle
vitals.dead = false; sm.reset(); swimTo(SEA_EDGE_CONFIG.warnM + 4); run(15); assert.equal(sm.state, CIRCLE);
sm.reset(); assert.equal(sm.state, HIDDEN); assert.equal(ent.transform.z, C.hideZ);
// 4 Hz: the state only changes on every 15th step
sm.reset(); swimTo(SEA_EDGE_CONFIG.warnM + 4); run(14); assert.equal(sm.state, HIDDEN); run(1); assert.equal(sm.state, CIRCLE);
// not swimming: never triggers
sm.reset(); P.swimming = false; run(60); assert.equal(sm.state, HIDDEN); P.swimming = true;
// works without an entity / ripples
const bare = createSeaMonster(vitals, shore); for (let i = 0; i < 30; i++) bare.step(P, i / 60); assert.equal(bare.state, CIRCLE);
// 0 alloc
if (global.gc) {
  sm.reset(); run(100); global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { sm.step(P, i / 60); if (i % 600 === 599) sm.reset(); } global.gc();
  assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'alloc');
}
// voxel entity: state -> clip + hidden + loop flag
{
  const ve = { transform: { x: 0, y: 0, z: -500, yawDeg: 0 }, components: { voxel: { model: 'seaMonster', anim: 'circle', loop: true, hidden: true } } };
  const m2 = createSeaMonster(vitals, shore, { ent: ve }); vitals.dead = false;
  assert.equal(ve.components.voxel.hidden, true, 'hidden at start');
  P.y = 1770 + SEA_EDGE_CONFIG.warnM + 4; for (let i = 0; i < 15; i++) m2.step(P, i / 60);
  assert.equal(m2.state, CIRCLE); assert.equal(ve.components.voxel.hidden, false); assert.equal(ve.components.voxel.anim, 'circle'); assert.equal(ve.components.voxel.loop, true);
  P.y = 1770 + SEA_EDGE_CONFIG.killM + 6; for (let i = 0; i < 15; i++) m2.step(P, i / 60);
  assert.equal(m2.state, RISE); assert.equal(ve.components.voxel.anim, 'rise'); assert.equal(ve.components.voxel.loop, false);
  const toP = Math.atan2(P.x - ve.transform.x, P.y - ve.transform.y); assert.ok(Number.isFinite(ve.transform.yawDeg) && toP === toP);
  for (let i = 0; i < C.riseSteps; i++) m2.step(P, i / 60);
  assert.equal(m2.state, STRIKE); assert.equal(ve.components.voxel.anim, 'strike'); assert.equal(ve.transform.z, P.surfaceZ);
  for (let i = 0; i < C.strikeSteps; i++) m2.step(P, i / 60);
  m2.step(P, 0); assert.equal(m2.state, HIDDEN); assert.equal(ve.components.voxel.hidden, true);
}
console.log('seaMonster ok');
