// MASK-b (38.52 amendment, OB-096 grass mask): near-band density mask = paint * (1 - stamp).
import assert from 'node:assert/strict';
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import { validateCarpetConfig, buildCarpetMask } from './carpet.js';

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
console.log(`carpetMask.test: ${checks} checks ok (full ${msFull.toFixed(1)} ms, rect ${msRect.toFixed(2)} ms)`);
