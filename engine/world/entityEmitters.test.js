// engine/world/entityEmitters.test.js (US-053a). Run: node engine/world/entityEmitters.test.js
// Also covers particles driven by the real US-138 wind field (kept here: engine/fx tests may not import world).
import { makeOk } from '../test/assert.js';
import { createParticles } from '../fx/particles.js';
import { createWind } from './wind.js';
import { createEntityEmitters } from './entityEmitters.js';
import { Events } from '../core/events.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const STEP = 1 / 60;
const BASE = { life: [1, 1], speed: [0, 0], glyphs: '@o.', colors: [[255, 255, 255], [128, 128, 128]] };
const mk = (o) => ({ ...BASE, ...o });
function sys(def, opts) { const p = createParticles(opts); return { p, id: p.defineEmitter('t', mk(def)) }; }
function steps(p, n) { for (let i = 0; i < n; i++) p.step(); }
function firstLive(p) { for (let i = 0; i < p.cap; i++) if (p.alive[i]) return i; return -1; }

// ---- particles + real wind field (US-138 createWind) ----
{
  const field = createWind({ dirDeg: 90, speed: 3 }, 1); // compass 90 = +x
  const { p, id } = sys({ life: [10, 10], speed: [0, 0], drag: 6, wind: 1, maxLive: 4 });
  const h = p.createEmitter(id, 0, 0, 0);
  p.burst(h, 1); p.step();
  p.sampleWind(field, 0);
  steps(p, 200);
  const i = firstLive(p);
  ok('sampleWind: particle drifts to the field wind', Math.abs(p.vx[i] - 3) < 1e-3 && Math.abs(p.vy[i]) < 1e-3, `${p.vx[i]} ${p.vy[i]}`);
}

// ---- entityEmitters ----
{
  const p = createParticles({ capacity: 128 });
  const id = p.defineEmitter('smoke', mk({ rate: 60, life: [1, 1], maxLive: 8 }));
  const ents = [];
  const world = { forEachEntity(fn) { for (const e of ents) fn(e, e.id); } };
  const events = new Events();
  const mkEnt = (idn, yaw, em) => ({ id: idn, type: 'prop', transform: { x: 10, y: 20, z: 1, yawDeg: yaw }, components: { emitters: em } });
  const entry = (o) => ({ preset: 'smoke', offset: { right: 1, fwd: 2, up: 3 }, on: true, ...o });
  const ee = createEntityEmitters(world, p, events, (k) => p.defIdOf(k));
  const e0 = mkEnt('e0', 0, [entry()]);
  ents.push(e0); events.emit('entity:added', { id: 'e0' });
  ee.sync();
  const h0 = Array.from({ length: 64 }, (_, i) => i).find((i) => p.emitters.used[i]);
  const at = () => [p.emitters.x[h0], p.emitters.y[h0], p.emitters.z[h0]];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // compass yaw 0: forward = (0,-1), right = (1,0)
  ok('offset at yaw 0: right +x, fwd -y, up +z', near(at(), [11, 18, 4]), at());
  e0.transform.yawDeg = 90; ee.sync();  // forward (1,0), right (0,1)
  ok('offset at yaw 90', near(at(), [12, 21, 4]), at());
  e0.transform.yawDeg = 225; ee.sync(); // forward (sin225, -cos225) = (-.7071, .7071), right (cos225, sin225) = (-.7071,-.7071)
  const s2 = Math.SQRT1_2;
  ok('offset at yaw 225', near(at(), [10 - s2 * 1 - s2 * 2, 20 - s2 * 1 + s2 * 2, 4]), at());
  e0.transform.x = 50; ee.sync();
  ok('follows the entity', Math.abs(at()[0] - (50 - s2 * 3)) < 1e-9);
  steps(p, 5);
  ok('on:true spawns', p.stats.live === 5, p.stats.live);
  e0.components.emitters[0].on = false; ee.sync(); steps(p, 5);
  ok('on:false stops (saved flag copied each sync)', p.stats.live === 5);
  e0.components.emitters[0].on = true;
  // add second entity with two emitters; first keeps its handle
  const e1 = mkEnt('e1', 0, [entry({ offset: undefined }), entry({ on: false })]);
  ents.push(e1); events.emit('entity:added', { id: 'e1' });
  const before = p.emitters.live[h0];
  ee.sync();
  ok('add rebuilds: 3 pairs, existing emitter kept (its particles survive)', ee.count === 3 && p.emitters.live[h0] === before && p.emitters.used[h0] === 1);
  let used = 0; for (let s = 0; s < 64; s++) used += p.emitters.used[s];
  ok('3 emitter slots in use', used === 3);
  ents.splice(0, 1); events.emit('entity:removed', { id: 'e0' });
  ee.sync();
  ok('remove rebuilds: 2 pairs; removed one released', ee.count === 2);
  steps(p, 80);
  used = 0; for (let s = 0; s < 64; s++) used += p.emitters.used[s];
  ok('released emitter slot freed after its particles die', used === 2, used);
  // unknown preset skipped
  ents.push(mkEnt('e2', 0, [entry({ preset: 'nope' })])); events.emit('entity:added', {}); ee.sync();
  ok('unknown preset skipped', ee.count === 2);
  // world swap
  const w2 = { forEachEntity(fn) { fn(mkEnt('n0', 0, [entry()]), 'n0'); } };
  p.clear(); events.emit('world:loaded', { world: w2 }); ee.sync();
  ok('world:loaded follows the new world', ee.count === 1 && p.isValid(p.createEmitter(id, 0, 0, 0)));
  // >64 pairs
  const many = []; const wm = { forEachEntity(fn) { for (const e of many) fn(e, e.id); } };
  const pm = createParticles(); pm.defineEmitter('smoke', mk({}));
  const em2 = createEntityEmitters(wm, pm, null, (k) => pm.defIdOf(k));
  for (let i = 0; i < 70; i++) many.push(mkEnt('m' + i, 0, [entry()]));
  em2.sync();
  ok('entity emitter pairs capped at 64', em2.count === 64);
}


console.log(`entityEmitters.test.js: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL ' + f); process.exit(1); }
