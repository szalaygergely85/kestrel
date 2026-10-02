// engine/mesh/voxelRaster.test.js (ME-07 review item 3, docs/architecture.md
// 27.15.6 step 4): voxel props through the mesh raster path (`VoxelPool` ->
// `addVoxelInstances` -> `rasterDrawList`) vs the CPU march (`castModels`) at
// 3 poses (lever, burner, boulder; 160x60), plus the zero-allocation gate.
// Run: node engine/mesh/voxelRaster.test.js  (re-spawns itself with --expose-gc)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VoxelPool } from '../render/voxelPool.js';
import { castModels } from '../voxel/voxelMarch.js';
import { GBuffer, KIND_MODEL } from '../render/GBuffer.js';
import { DepthBuffer } from '../render/DepthBuffer.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { DrawList } from './DrawList.js';
import { addVoxelInstances, VoxelMeshCache } from './voxelMesh.js';
import { rasterDrawList, createRasterTarget, copyToGBuffer } from './rasterJS.js';
import { makeOk } from '../test/assert.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/voxel_props.js';
import '../../design/models/voxel_tower.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const VM = globalThis.ASSETS.voxelModels;
const KEYS = ['lever', 'burner', 'boulder'];
const registry = {
  keys(kind) { return kind === 'model' ? KEYS : []; },
  model(key) { return { voxel: VM[key].voxel }; },
};
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
pool.bind(registry, table);
const partNamesFor = (k) => pool._partNames.get(k);

function isEdgeCell(kind, cols, rows, x, y, i) {
  const k = kind[i];
  return (y > 0 && kind[i - cols] !== k) || (y < rows - 1 && kind[i + cols] !== k)
    || (x > 0 && kind[i - 1] !== k) || (x < cols - 1 && kind[i + 1] !== k);
}

const COLS = 160, ROWS = 60;
const rt = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 };
// (Eye z is nudged off the voxel-layer grid: a horizon ray exactly on a layer boundary grazes it and both casters tie-break differently.)
// Camera 2.5 m south of the prop looking along -y ... (yaw picked per probe below).
const POSES = [
  { name: 'lever', key: 'lever', yawDeg: 25 },
  { name: 'burner', key: 'burner', yawDeg: 140 },
  { name: 'boulder', key: 'boulder', yawDeg: 0 },
  // ED-SCALE-1a: scaled props, mesh vs CPU oracle
  { name: 'lever x2', key: 'lever', yawDeg: 25, scale: 2 },
  { name: 'burner x0.5', key: 'burner', yawDeg: 140, scale: 0.5 },
];

for (const pose of POSES) {
  const pm = pool.models.get(pose.key);
  const h = pm.sz * pm.cellM * (pose.scale || 1);
  const cam = { x: 0, y: 2.2 + h, z: 0.5 * h + 0.3137, yawDeg: 0, pitchDeg: 0 };
  pool.beginFrame();
  pool.pushInstance(pose.key, 0, 0, 0, pose.yawDeg, -1, 0, 0, pose.scale || 1);
  pool.project(cam, rt);
  ok(`${pose.name}: instance survives the pool cull`, pool.list.length === 1);

  // CPU oracle.
  const fb = { rt, depth: new DepthBuffer(COLS, ROWS).depth, gbuf: new GBuffer(COLS, ROWS) };
  fb.gbuf.beginFrame();
  castModels(fb, pool.list, cam, { faceMode: 'nearest' });
  const ref = fb.gbuf;

  // Mesh path.
  const terms = {};
  projTerms(cam, rt, terms);
  const M = new Float64Array(16);
  shearProjection(terms, M);
  const list = new DrawList(16);
  list.begin();
  addVoxelInstances(list, pool, new VoxelMeshCache(), partNamesFor);
  const target = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, target, { M, terms, snap: true });
  const got = new GBuffer(COLS, ROWS);
  got.beginFrame();
  const gotDepth = new Float32Array(COLS * ROWS);
  copyToGBuffer(target, got, gotDepth);

  let refModel = 0, checked = 0, kindEq = 0, matched = 0, planeEq = 0, matEq = 0, depthOk = 0;
  const detail = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (ref.kind[i] === KIND_MODEL) refModel++;
      if (ref.kind[i] !== KIND_MODEL && got.kind[i] !== KIND_MODEL) continue;
      if (isEdgeCell(ref.kind, COLS, ROWS, x, y, i)) continue;
      checked++;
      if (ref.kind[i] !== got.kind[i]) { if (detail.length < 5) detail.push(`(${x},${y}) ref=${ref.kind[i]} mesh=${got.kind[i]}`); continue; }
      kindEq++;
      if (ref.kind[i] !== KIND_MODEL) continue;
      matched++;
      if (ref.planeId[i] === got.planeId[i]) planeEq++;;
      if (ref.mat[i] === got.mat[i]) matEq++;;
      const d0 = fb.depth[i], d1 = gotDepth[i];
      if (Math.abs(d0 - d1) <= 0.01 * d0) depthOk++;
    }
  }
  const pct = (a, b) => (b ? 100 * a / b : 0);
  console.log(`  ${pose.name}: refModel=${refModel} checked=${checked} kind=${pct(kindEq, checked).toFixed(2)}% plane=${pct(planeEq, matched).toFixed(2)}% mat=${pct(matEq, matched).toFixed(2)}% depth=${pct(depthOk, matched).toFixed(2)}%`);
  ok(`${pose.name}: reference has kind-8 cells`, refModel > 40, String(refModel));
  ok(`${pose.name}: kind equal >= 98% (excl. kind edges)`, pct(kindEq, checked) >= 98, detail.join(' | '));
  ok(`${pose.name}: planeId equal >= 99% of matched`, pct(planeEq, matched) >= 99);
  ok(`${pose.name}: mat equal >= 99% of matched`, pct(matEq, matched) >= 99);
  ok(`${pose.name}: depth within 1% on >= 99% of matched`, pct(depthOk, matched) >= 99);
}

// ---- zero-allocation gate: 1000 addVoxelInstances calls ------------------
{
  const cam = { x: 0, y: 3, z: 1, yawDeg: 0, pitchDeg: 0 };
  pool.beginFrame();
  for (let i = 0; i < 3; i++) pool.pushInstance(KEYS[i], i * 0.5, 0, 0, 30 * i);
  pool.project(cam, rt);
  const cache = new VoxelMeshCache();
  const list = new DrawList(16);
  list.begin();
  addVoxelInstances(list, pool, cache, partNamesFor); // warm
  // min of 3 trials x 10000 calls: GC noise is ~+-40 KB, a real 8 B/call leak still shows ~80 KB in every trial
  let growth = Infinity;
  for (let trial = 0; trial < 3; trial++) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let f = 0; f < 10000; f++) { list.begin(); addVoxelInstances(list, pool, cache, partNamesFor); }
    global.gc();
    growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  ok('zero-alloc: 10000 addVoxelInstances calls grow the heap < 64 KB (min of 3 trials)', growth < 65536, `growth=${growth}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
