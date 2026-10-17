// GATE-FLAKY-02a part B (arch 38.61 (2a)): the REAL per-tick river consumer (wading.before: ONE riverAt) with x AND y varying,
// all points inside the river, plus a mixed hit/miss window; strict < 8 B/step over the position store (tools/allocProbe.mjs).
// Run: node --expose-gc engine/world/river.alloc.test.js
import { createWater, collectWaterDefs } from './water.js';
import { World } from './World.js';
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';
import { createWading } from '../../game/js/quest/sim/wading.js';

const w = new World();
w.water = createWater(collectWaterDefs({ water: [{ id: 'c', shape: 'river', path: Array.from({ length: 11 }, (_, i) => [i * 60, 0, 10, 30, 1]) }] }, []));
w.physicsMode = 'mesh'; const sup = { floorH: -5 }; w.supportAt = () => sup;
let bad = 0; const chk = (n, c, x) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} (${x})`); if (!c) bad++; };

// correctness: riverAt fx/fy == flowAt within 1e-12 at 3 river points
const rq = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0, fx: 0, fy: 0 }, fl = [0, 0];
for (const [x, y] of [[20, 1], [95.5, -3.2], [400, 4.4]]) {
  const a = w.riverAt(x, y, rq), b = w.flowAt(x, y, fl);
  chk(`riverAt flow == flowAt at (${x},${y})`, a && b && Math.abs(rq.fx - fl[0]) < 1e-12 && Math.abs(rq.fy - fl[1]) < 1e-12, `${rq.fx},${rq.fy}`);
}

const N = 1000, IN_X = new Float64Array(N), IN_Y = new Float64Array(N), MX = new Float64Array(N), MY = new Float64Array(N);
for (let i = 0; i < N; i++) {
  IN_X[i] = (i * 7.3) % 500 + 5; IN_Y[i] = (i * 3.1) % 20 - 10;      // inside (half width 10... y within +-10)
  MX[i] = IN_X[i]; MY[i] = i % 3 === 0 ? 80 + (i % 7) : IN_Y[i];       // every 3rd point misses the river
}
const wd = createWading(w);
const e = { transform: { x: 0, y: 0, z: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } }, t = e.transform;
const base = allocProbe((n) => { for (let i = 0; i < n; i++) { const j = i % N; t.x = IN_X[j]; t.y = IN_Y[j]; } }, { n: 20000 });
const rIn = allocProbe((n) => { for (let i = 0; i < n; i++) { const j = i % N; t.x = IN_X[j]; t.y = IN_Y[j]; wd.before(e); } }, { n: 20000 });
if (skipNote(rIn, 'river alloc')) process.exit(bad ? 1 : 0);
const rMix = allocProbe((n) => { for (let i = 0; i < n; i++) { const j = i % N; t.x = MX[j]; t.y = MY[j]; wd.before(e); } }, { n: 20000 });
const a1 = rIn.perCall - base.perCall, a2 = rMix.perCall - base.perCall;
chk('wading.before in-river, x+y varying adds < 8 B/step', a1 < 8, `${a1.toFixed(2)} B (${rIn.perCall.toFixed(1)} vs ${base.perCall.toFixed(1)})`);
chk('wading.before mixed hit/miss adds < 8 B/step', a2 < 8, `${a2.toFixed(2)} B`);
if (bad) process.exit(1);
