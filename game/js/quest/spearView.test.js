// GOB-07a: spearView. Run: node --expose-gc game/js/quest/spearView.test.js
// Real enemy arrow sim + a stub world; checks flying / stuck / blocked / hidden poses and 0 alloc per update.
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_goblin.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createArrowSim, createPlayerTarget } from './sim/arrows.js';
import { GOBLIN_SPEAR_CFG } from './bowConfig.js';
import { createSpearView } from './spearView.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const events = { on() { return () => {}; }, emit() {} };
const ents = new Map();
const player = { data: { transform: { x: 500, y: 500, z: 0 }, components: {} } };
const ground = { z: 0.2 };
const world = {
  addEntity: (e) => ents.set(e.id, e), get: (id) => (id === 'player' ? player : null), flowAt() {},
  raySegment(ax, ay, az, bx, by, bz, out) { // flat ground at ground.z
    if (bz > ground.z) return false;
    out.t = (az - ground.z) / (az - bz); out.x = ax + (bx - ax) * out.t; out.y = ay + (by - ay) * out.t; out.z = ground.z; return true;
  },
};
const sim = createArrowSim(world, events, GOBLIN_SPEAR_CFG, createPlayerTarget(world), null, { owner: 'enemy' });
const view = createSpearView({ world, sim, groundAt: () => 0 });
ok('pool = flying + stuck slots, all hidden at start', ents.size === sim.flying.n + sim.stuck.n && [...ents.values()].every((e) => e.components.voxel.model === 'goblinSpear'));
view.update();
ok('free slots hidden', [...ents.values()].every((e) => e.components.voxel.hidden === true));

// flying: heading +x (east), rising
sim.fireVel(0, 0, 1.4, 10, 0, 5, 1, 'g1');
sim.step(); view.update();
const f = view.flyEntities[0], fv = f.components.voxel;
ok('flying spear: visible, clip fly, at the sim position', fv.hidden === false && fv.anim === 'fly' && Math.abs(f.transform.x - sim.flying.x[0]) < 1e-9 && Math.abs(f.transform.z - sim.flying.z[0]) < 1e-9);
ok('flying yaw follows the flight direction (east = 90)', Math.abs(f.transform.yawDeg - 90) < 1e-6, f.transform.yawDeg);
ok('rising spear pitches nose UP (rx < 0) on part shaft', fv.partRot && fv.partRot.part === 'shaft' && fv.partRot.rx < -20 && fv.partRot.rx > -40, fv.partRot && fv.partRot.rx);
for (let i = 0; i < 120 && sim.flyingCount > 0; i++) sim.step();
ok('spear landed: flying slot hidden, a stuck slot used', sim.flyingCount === 0 && sim.stuckCount === 1);
view.update();
ok('flying slot hidden after landing', fv.hidden === true);
const s = view.stuckEntities[0], sv = s.components.voxel;
ok('stuck: at the sim hit point, yaw = flight yaw, wobble first', sv.hidden === false && sv.anim === 'stuckWobble' && Math.abs(s.transform.x - sim.stuck.x[0]) < 1e-9 && Math.abs(s.transform.yawDeg - 90) < 5 && !sv.partRot, `${sv.anim} yaw=${s.transform.yawDeg}`);
for (let i = 0; i < 20; i++) sim.step();
view.update();
ok('stuck after the wobble window: clip stuck', sv.anim === 'stuck');

// blocked: dz = -1 stick (shield drop) is placed on the ground, clip blocked
sim.reset();
ground.z = -50; // nothing to hit: place via the shield path using a player target hit is heavy; emulate the stuck record directly
sim.stuck.alive[3] = 1; sim.stuck.serial[3] = 99; sim.stuck.age[3] = 0; sim.stuck.x[3] = 7; sim.stuck.y[3] = 8; sim.stuck.z[3] = 1.1;
sim.stuck.dx[3] = 0; sim.stuck.dy[3] = 0; sim.stuck.dz[3] = -1;
view.update();
const b = view.stuckEntities[3], bv = b.components.voxel;
ok('blocked spear: clip blocked, placed on the ground (z from groundAt) under the hit', bv.anim === 'blocked' && b.transform.z === 0 && b.transform.x === 7 && b.transform.y === 8 && bv.hidden === false);
sim.stuck.alive[3] = 0; view.update();
ok('slot freed -> hidden', bv.hidden === true);

// 0 alloc per update with a spear in flight
ground.z = 0.2; sim.fireVel(0, 0, 1.4, 10, 0, 5, 1, 'g1'); sim.step();
for (let i = 0; i < 200; i++) view.update();
global.gc && global.gc();
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 20000; i++) view.update();
const grew = process.memoryUsage().heapUsed - h0;
// plain-object double field stores box a HeapNumber in V8 (same in beastView); no arrays/objects are created: < 100 B per call
ok('view.update creates no objects (< 100 B/call heap growth, double-field boxing only)', grew < 20000 * 100, grew);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
