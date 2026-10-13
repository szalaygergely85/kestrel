// MASK-b (38.52 amendment, OB-096 grass mask): near-band density mask = paint * (1 - stamp).
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import { validateCarpetConfig, buildCarpetMask, CarpetMaskJob } from './carpet.js';
import { createGrassMask, setSample, maskAt } from './grassMask.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const N = 192;
function fixture() {
  const g = { x0: 0, y0: 0, w: N, h: N, cell: 2, height: new Float32Array(N * N), type: new Uint8Array(N * N) };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.type[x + y * N] = Math.floor(x / 20) % 5; // 40 m bands
  const recipe = { map: { w: N, h: N, cell: 2 }, chunk: { size: 128, nearCell: 2 }, recipe: { forest: { trees: { species: [{ trunkR: 0.4 }] } } },
    util: { heightAt: () => 0, typeAt: () => 0, gridHeight: () => 0, bake: () => g, generate: () => g, biomeAt: () => 0 } };
  const t = new Terrain(recipe); t.bakeNearBand(1, 1); t.near.x0 = 0; t.near.y0 = 0; return t;
}
const t = fixture();
const road = t.typeNames[4]; // columns x 160..200 m
const cfg = { seed: 1, cutGround: [road], variants: [{ name: 'm', ground: [t.typeNames[0]], density: 0.5, heightM: [0.1, 0.2], ramp: ['a', 'b'] }] };
validateCarpetConfig(cfg, t.typeNames); checks++;
assert.throws(() => validateCarpetConfig({ ...cfg, cutGround: ['lava'] }, t.typeNames), /carpet\.cutGround/); checks++;
assert.throws(() => validateCarpetConfig({ ...cfg, mask: {} }, t.typeNames), /carpet\.mask/); checks++;

const structs = [{ bbox: { x0: 20, y0: 20, x1: 30, y1: 28 } }];     // a crate/building
const scatter = { count: 1, x: new Float64Array([60]), y: new Float64Array([60]), species: new Uint8Array([0]) }; // trunk r 0.4 + 0.3
const m = buildCarpetMask(t, cfg, null, structs, scatter);
const at = (x, y, mm = m) => mm.data[Math.floor((x - mm.x0) / mm.cellM) + Math.floor((y - mm.y0) / mm.cellM) * mm.w];
ok(m.w === 768 && m.h === 768 && m.cellM === 0.5 && m.data instanceof Uint8Array, 'window = class-map window at 0.5 m');
// stamp core stays exactly 0 (including the bbox edge cells), far outside = full (no layer = 255)
ok(at(20.1, 20.1) === 0 && at(25, 24) === 0 && at(29.9, 27.9) === 0, 'core 0 under the structure');
ok(at(100, 100) === 255 && at(10, 10) === 255, 'no layer = 255 off-stamp');
// edge ramps outward: monotone rising away from the bbox, strictly between 0 and 255 somewhere, full within ~1.5 m
const ramp = []; for (let d = 0.25; d <= 2.5; d += 0.5) ramp.push(at(30 + d, 24));
ok(ramp.every((v, i) => i === 0 || v >= ramp[i - 1]), 'ramp monotone ' + ramp.join(','));
ok(ramp[0] > 0 || ramp[1] > 0, 'ramp starts at the edge');
ok(ramp.some((v) => v > 0 && v < 255), 'ramp has soft values');
ok(at(32, 24) === 255, 'full density 2 m outside');
ok(at(61, 60) === 255 || at(62, 60) === 255, 'outside the trunk disc is full'); ok(at(60, 60) === 0 && at(60.5, 60) === 0, 'tree trunk disc core 0');
// ground type cut: road columns 0, grass 255
ok(at(180, 100) === 0 && at(170, 300) === 0, 'cutGround cell = 0');
ok(at(150, 100) === 255 && at(100, 100) === 255, 'non-cut ground = 255'); // 150 m is 10 m from the road edge at 160
ok(at(159.9, 100) < 255 && at(157, 100) === 255, 'road edge feathers outward');
// paint * stamp
const paintFn = (x) => (x < 50 ? 0.5 : 1), paint = { sample: paintFn }; // object form; function form checked below
const mp = buildCarpetMask(t, cfg, paint, structs, scatter, null);
ok(Math.abs(at(10, 10, mp) - 128) <= 1 && at(100, 100, mp) === 255, 'paint 0.5 -> 128, paint 1 -> 255');
ok(at(25, 24, mp) === 0, 'stamp wins over paint');
ok(Buffer.from(buildCarpetMask(t, cfg, paintFn, structs, scatter, null).data).equals(Buffer.from(mp.data)), 'function paint == object paint');
// reuse + rect rebuild: 0 alloc on repeat, same bytes
const keep = m.data, before = Buffer.from(m.data);
const r1 = buildCarpetMask(t, cfg, null, structs, scatter, m);
ok(r1 === m && r1.data === keep && before.equals(Buffer.from(r1.data)), 'full rebuild reuses buffers, same bytes');
const rect = { x0: 15, y0: 15, x1: 40, y1: 35 };
const r2 = buildCarpetMask(t, cfg, null, structs, scatter, m, rect);
ok(r2 === m && before.equals(Buffer.from(r2.data)), 'rect rebuild == full result');
structs.push({ bbox: { x0: 100, y0: 100, x1: 102, y1: 102 } });
buildCarpetMask(t, cfg, null, structs, scatter, m, { x0: 95, y0: 95, x1: 108, y1: 108 });
const full = buildCarpetMask(t, cfg, null, structs, scatter, null);
ok(Buffer.from(full.data).equals(Buffer.from(m.data)), 'rect rebuild after a new stamp == fresh full build');
if (global.gc) {
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20; i++) buildCarpetMask(t, cfg, null, structs, scatter, m, rect);
  global.gc(); ok(process.memoryUsage().heapUsed - h0 < 200000, 'rect rebuild ~0 alloc');
}
let t0 = performance.now(); buildCarpetMask(t, cfg, null, structs, scatter, m); const msFull = performance.now() - t0;
t0 = performance.now(); buildCarpetMask(t, cfg, null, structs, scatter, m, rect); const msRect = performance.now() - t0;
if (msFull > 40) console.warn(`carpetMask: full build ${msFull.toFixed(1)} ms (> 40 ms budget)`);
if (msRect > 3) console.warn(`carpetMask: rect build ${msRect.toFixed(1)} ms (> 3 ms budget)`);
ok(buildCarpetMask({ nearReady: false }, cfg, null, [], null) === null, 'null before nearReady');

// World hooks: load-like rebuild, band swap, editor rect; maskVersion bumps
const w = new World(); w.terrain = t; w._carpetCtx = { cfg: { ...cfg, mask: paint }, recipe: t.recipe }; w.structures = structs; w.scatter = scatter;
w._rebuildCarpet();
ok(w.carpet.mask && w.carpet.mask.w === 768 && w.carpet.maskVersion === 1, 'World builds carpet.mask, version 1');
ok(at(10, 10, w.carpet.mask) === 128 && at(100, 104, w.carpet.mask) === 255, 'World uses cfg.mask paint');
const data0 = w.carpet.mask.data;
w._rebuildCarpet(); // band swap path
ok(w.carpet.maskVersion === 2 && w.carpet.mask.data === data0, 'band swap rebuild bumps maskVersion, buffer reused');
w.rebuildCarpetMask({ x0: 15, y0: 15, x1: 40, y1: 35 });
ok(w.carpet.maskVersion === 3, 'rebuildCarpetMask(rect) bumps maskVersion');

// ---- sliced build (band swap): same bytes as the sync build, budgeted steps, old mask valid until swap, layer paint input
const layer = createGrassMask(0.5, 64);
for (let i = 0; i < 400; i++) for (let j = 0; j < 100; j++) setSample(layer, i, j, ((i * 7 + j * 13) % 200) + 20);
validateCarpetConfig({ ...cfg, mask: layer }, t.typeNames); checks++;
const syncL = buildCarpetMask(t, cfg, layer, structs, scatter, null);
const syncF = buildCarpetMask(t, cfg, (x, y) => maskAt(layer, x, y), structs, scatter, null);
ok(Buffer.from(syncL.data).equals(Buffer.from(syncF.data)), 'GrassMaskLayer paint == function paint bytes');
ok(syncL.data.some((v) => v > 0 && v < 255), 'layer paint changes the mask');
const job = new CarpetMaskJob(t, cfg, layer, structs, scatter, null);
let steps = 0, maxStepMs = 0;
while (!job.step(0)) { steps++; if (steps > 100000) break; } // budget 0 = one work unit per call
ok(job.done && steps > 20, 'sliced build takes many steps: ' + steps);
ok(Buffer.from(job.result.data).equals(Buffer.from(syncL.data)), 'sliced build == sync build bytes');
// per-step budget: each step with a 1 ms budget stays near it (unit granularity = 8 rows)
const job2 = new CarpetMaskJob(t, cfg, layer, structs, scatter, null);
let nSteps = 0, sumMs = 0;
while (true) { const a = performance.now(); const d = job2.step(1); const dt = performance.now() - a; sumMs += dt; maxStepMs = Math.max(maxStepMs, dt); nSteps++; if (d) break; }
if (maxStepMs > 4) console.warn(`carpetMask: slice step ${maxStepMs.toFixed(2)} ms for a 1 ms budget`);
ok(nSteps > 1 && (!process.env.BAKE_BENCH || (sumMs / nSteps < 2 && maxStepMs < 25)), `slice step respects budget (avg ${(sumMs / nSteps).toFixed(2)}, max ${maxStepMs.toFixed(2)} ms, ${nSteps} steps)`);
ok(Buffer.from(job2.result.data).equals(Buffer.from(syncL.data)), 'budgeted slices == sync bytes');
// 0 alloc per step on a reused buffer
if (global.gc) {
  const back = job2.result; global.gc(); const h1 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 5; k++) { const jb = new CarpetMaskJob(t, cfg, null, structs, scatter, back); while (!jb.step(1)); }
  global.gc(); ok(process.memoryUsage().heapUsed - h1 < 200000, 'sliced rebuild on reused back buffer ~0 alloc');
}
// World: band swap starts a job, front mask untouched (version/data) until stepCarpetMask completes it
const w2 = new World(); w2.terrain = t; w2._carpetCtx = { cfg: { ...cfg, mask: layer }, recipe: t.recipe }; w2.structures = structs; w2.scatter = scatter;
w2._rebuildCarpet();
const front0 = w2.carpet.mask, snap0 = Buffer.from(front0.data), v0 = w2.carpet.maskVersion;
structs.push({ bbox: { x0: 140, y0: 40, x1: 143, y1: 43 } });
w2._rebuildCarpet(true);
ok(w2._maskJob && w2.carpet.mask === front0 && w2.carpet.maskVersion === v0 && snap0.equals(Buffer.from(front0.data)), 'old mask stays valid and unchanged while the back build is pending');
ok(w2.stepCarpetMask(0) === true && w2.carpet.mask === front0, 'one tiny step: still pending, no swap');
while (w2.stepCarpetMask(1));
ok(w2.carpet.mask !== front0 && w2.carpet.maskVersion === v0 + 1 && w2._maskBack === front0, 'swap + maskVersion++ at completion, old front becomes back');
ok(Buffer.from(w2.carpet.mask.data).equals(Buffer.from(buildCarpetMask(t, cfg, layer, structs, scatter, null).data)), 'swapped mask == fresh sync build');
w2._rebuildCarpet(true); while (w2.stepCarpetMask(1)); // second swap reuses buffers
ok(w2.carpet.mask === front0 && w2._maskBack !== front0 && w2.carpet.maskVersion === v0 + 2, 'ping-pong reuses both buffers');
w2._rebuildCarpet(true); w2.rebuildCarpetMask(); ok(!w2._maskJob, 'a sync full rebuild supersedes the pending job');
console.log(`carpetMask.test: ${checks} checks ok (full ${msFull.toFixed(1)} ms, rect ${msRect.toFixed(2)} ms)`);

// MASK-a timing probe: near-band mask build with a real paint layer over the 192x192 m window (logs ms, no hard gate except a loose 250 ms)
{
  const { createGrassMask, setSample, maskAt } = await import('./grassMask.js');
  const layer = createGrassMask();
  for (let j = 0; j < 384; j++) for (let i = 0; i < 384; i++) setSample(layer, i, j, ((i >> 3) + (j >> 3)) & 1 ? 255 : 90);
  const pf = (x, y) => maskAt(layer, x, y);
  for (let r = 0; r < 3; r++) buildCarpetMask(t, cfg, pf, structs, scatter, null); // warm-up
  let best = Infinity;
  for (let r = 0; r < 5; r++) { const t0 = performance.now(); buildCarpetMask(t, cfg, pf, structs, scatter, null); best = Math.min(best, performance.now() - t0); }
  console.log(`MASK-a probe: buildCarpetMask with paint layer, ${N}x${N} m: ${best.toFixed(1)} ms (best of 5, target < 60)`);
  ok(best < 250, 'paint-layer mask build not pathological: ' + best);
}
