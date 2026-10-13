// GATE-FLAKY-02a (arch 38.61 point 2): river waterAt/riverAt/flowAt, strict < 8 B per query set.
// Mirrors the REAL consumer call shape (game/js/quest/sim/wading.js before()): coordinates are read from entity
// transform fields (heap numbers already), module-level helper, hoisted scratch. Own isolate, no shared polymorphism.
// Run: node --expose-gc engine/world/river.alloc.test.js
import { createWater, collectWaterDefs } from './water.js';
import { World } from './World.js';
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';

const w = new World();
w.water = createWater(collectWaterDefs({ water: [{ id: 'c', shape: 'river', path: Array.from({ length: 11 }, (_, i) => [i * 60, 0, 10, 30, 1]) }] }, []));
w.physicsMode = 'mesh'; const sup = { floorH: -5 }; w.supportAt = () => sup;
const out = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 }, kind = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0 }, fl = [0, 0];
// same shape as wading.before: ONE function taking the entity, reading t.x / t.y at each call (no double parameters of its own)
const before = (world, e) => { const t = e.transform; return world.waterAt(t.x, t.y, out) && world.riverAt(t.x, t.y, kind) && world.flowAt(t.x, t.y, fl); };
const PX = new Float64Array(1000), PY = new Float64Array(1000);
for (let i = 0; i < 1000; i++) { PX[i] = (i * 7.3) % 130 + 5; PY[i] = (i * 3.1) % 20 - 10; }
const e = { transform: { x: 0, y: 0 } }, t = e.transform;
let hit = 0;
// the entity's own position store (`t.x = PX[j]` re-boxes a double per tick in ANY consumer: integrate does it too) is subtracted,
// exactly like wading.alloc.test.js measures "wading.before adds < N B over integrate alone"; the queries themselves must add < 8 B.
const base = allocProbe((n) => { for (let i = 0; i < n; i++) { const j = i % 1000; t.x = PX[j]; t.y = PY[j]; } }, { n: 20000 });
const r = allocProbe((n) => { for (let i = 0; i < n; i++) { const j = i % 1000; t.x = PX[j]; t.y = PY[j]; if (before(w, e)) hit++; } }, { n: 20000 });
if (skipNote(r, 'river alloc')) process.exit(0);
const add = r.perCall - base.perCall;
console.log(`river waterAt+riverAt+flowAt: ${add.toFixed(2)} B/call over the position store (${r.perCall.toFixed(1)} vs ${base.perCall.toFixed(1)}, hits ${hit})`);
if (!(hit > 0) || !(add < 8)) { console.log('FAIL river alloc'); process.exit(1); }
console.log('ok   river alloc: queries add < 8 B/call');
