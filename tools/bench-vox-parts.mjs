// VOX-PARTS-16b: 30-animal draw / JS-encode bench (architecture.md 38.67 section 1 cost estimate).
// 30 voxel instances of the 12-part fixture (and, as a reference, the 8-part quadruped12), pose + DrawList fill (addVoxelInstances) + the
// WgRasterPass voxel encode + the WgShadowPass sun caster encode, on the device mock (JS-twin path, no GPU). Reports ms p50/p95 and heap bytes/frame.
// Run: node --expose-gc tools/bench-vox-parts.mjs [--frames N]
import { packVoxelModel } from '../engine/index.js';
import { makeMockGpuDevice, VoxelMeshCache, addVoxelInstances, DrawList, WgRasterPass, WgShadowPass, quadruped12, quadruped16 } from '../engine/dev.js';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2), fi = args.indexOf('--frames');
const FRAMES = fi >= 0 ? Number(args[fi + 1]) : 2000, WARM = 300, N = 30;
const MATS = ['mat_a', 'mat_b', 'mat_c'], matId = (k) => MATS.indexOf(k) + 1;

function bench(label, def) {
  const names = Object.keys(def.parts), pm = packVoxelModel(def, matId);
  const items = [];
  for (let i = 0; i < N; i++) {
    items.push({ model: pm, modelKey: label, x: (i % 6) * 3, y: Math.floor(i / 6) * 3, z: 0, yawDeg: i * 37, clip: -1, frame: 0, tMs: 0, scale: 1,
      rect: { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 3, maxZ: 3 } });
  }
  const pool = { list: items }, cache = new VoxelMeshCache(), namesFor = () => names, list = new DrawList(64);
  const d = makeMockGpuDevice().device; let draws = 0;
  d.beginPass = () => {}; d.endPass = () => {}; d.draw = () => { draws++; };
  const raster = new WgRasterPass(d), sun = new WgShadowPass(d, { shadows: { sun: 'off' }, casters: true });
  const Mf = new Float64Array(16); Mf[0] = Mf[5] = Mf[10] = Mf[15] = 1;
  const tgt = {};
  const frame = () => {
    list.begin(); addVoxelInstances(list, pool, cache, namesFor);
    raster._voxels(list);
    sun.renderCasters(tgt, Mf, list, null, null, 0, false);
  };
  for (let i = 0; i < WARM; i++) frame();
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed, t = new Float64Array(FRAMES); draws = 0;
  for (let i = 0; i < FRAMES; i++) { const t0 = performance.now(); frame(); t[i] = performance.now() - t0; }
  if (global.gc) global.gc();
  const alloc = (process.memoryUsage().heapUsed - h0) / FRAMES;
  const s = Array.from(t).sort((a, b) => a - b);
  console.log(`${label} x${N} (${names.length} parts): p50 ${s[Math.floor(FRAMES * 0.5)].toFixed(4)} ms, p95 ${s[Math.floor(FRAMES * 0.95)].toFixed(4)} ms, `
    + `draws/frame ${(draws / FRAMES).toFixed(0)} (raster + sun), heap ${alloc.toFixed(1)} B/frame`);
  return { p95: s[Math.floor(FRAMES * 0.95)], alloc };
}
const a = bench('quadruped12', quadruped12), b = bench('quadruped16', quadruped16);
console.log(`delta p95 (12-part - 6-part): ${(b.p95 - a.p95).toFixed(4)} ms for 30 animals, raster + sun pass (note 38.67 estimate: +0.5-0.7 ms JS encode for raster + sun + point slots)`);
