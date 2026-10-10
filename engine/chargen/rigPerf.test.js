// engine/chargen/rigPerf.test.js - RIG-04 (docs/architecture.md 38.32): rig models in VoxelPool / VoxelMeshCache.
//   node --expose-gc engine/chargen/rigPerf.test.js      (the alloc checks SKIP without --expose-gc)
// Allocation is the heapUsed delta over short windows (no scavenge inside one); min across windows.
import fs from 'node:fs';
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, randomRecipe, HUMANOID_PART_MAP } from './index.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { VoxelMeshCache, buildVoxelMesh, MESH_ONLY_MAX_QUADS } from '../mesh/voxelMesh.js';
import { VoxelPool } from '../render/voxelPool.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const CLIPS = { walk: { duration: 600, loop: true, keys: [{ t: 0 }, { t: 300, rot: { LeftUpperArm: [30, 0, 0] } }] }, idle: { duration: 800, loop: true, keys: [{ t: 0 }, { t: 400, rot: { Head: [0, 0, 10] } }] } };
const keys = [], defs = {};
for (let c = 0; c < 3; c++) {
  const g = composeCharacter({ ...kit, clips: CLIPS }, randomRecipe(kit, 1000 + c));
  defs['char.' + c] = riggedModelDef(collapseRig(meshCharacter(g), kit.partMap || HUMANOID_PART_MAP)); keys.push('char.' + c);
}
const mats = new Map();
const idFor = (m) => { if (!mats.has(m)) mats.set(m, mats.size + 1); return mats.get(m); };
const pool = new VoxelPool(); pool.renderer = 'mesh';
pool.bind({ keys: () => keys, model: (k) => defs[k] }, { idFor });
const pm = pool.models.get('char.0');
ok('char. model packs as a rig pm', !!pm.rig && pm.meshOnly === true && pm.clips.length === 2);

// LOD1 get returns the LOD0 mesh for a rig model (no pm.vox to downsample)
const names = Object.keys(defs['char.0'].voxel.parts), cache = new VoxelMeshCache();
ok('LOD1 get returns the LOD0 mesh for a rig pm', cache.get(pm, 'char.0', names, 1) === cache.get(pm, 'char.0', names, 0));

// quad budget message names the model
{
  const big = packVoxelModel(defs['char.0'].voxel, idFor);
  const tile = (a, q) => { const o = new Float32Array(12 * q); for (let i = 0; i < o.length; i++) o[i] = a[i % 12]; return o; };
  const r = big.rig, n = MESH_ONLY_MAX_QUADS + 1;
  const huge = { ...big, rig: { ...r, quads: n, pos: tile(r.pos, n), nrm: tile(r.nrm, n), mat: new Uint8Array(n).fill(1), ranges: r.ranges.map((g, i) => (i === 0 ? { start: 0, count: n } : { start: n, count: 0 })) } };
  let msg = '';
  try { buildVoxelMesh(huge, { id: 'char.huge', partNames: names }); } catch (e) { msg = e.message; }
  ok('rig over MESH_ONLY_MAX_QUADS throws a message naming the model and the budget', /char\.huge/.test(msg) && /MESH_ONLY_MAX_QUADS/.test(msg), msg);
}

const cam = { x: 0, y: 40, z: 20, yawDeg: 0, pitchDeg: -20 }, rt = { cols: 160, rows: 80, pxCellW: 1, pxCellH: 2 };
const frame = (stage, step) => {
  pool.beginFrame();
  for (let i = 0, n = (step % 3 === 2) ? 4 : 48; i < n; i++) pool.pushInstance(keys[i % 3], (i % 8) - 4, (i >> 3) * 1.2, 0, (i * 37) % 360, i & 1, 0, (step * 17 + i * 90) % 1000);
  if (stage >= 1) pool.project(cam, rt);
  if (stage >= 2) pool.projectShadow();
};
ok('pushed + projected rig instances are listed', (frame(2, 0), pool.list.length > 0 && pool.shadowList.length > 0));

if (global.gc) {
  for (let i = 0; i < 25000; i++) frame(2, i); // Node 24 tiers up late (FRAME-ALLOC-03)
  const measure = (stage) => {
    let best = Infinity;
    for (let w = 0; w < 30; w++) {
      global.gc();
      const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 200; i++) frame(stage, i);
      best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 200);
    }
    return best;
  };
  const push = measure(0), proj = measure(2);
  ok('rig pushInstance: 0 bytes per frame', push < 8, String(push));
  // RIG-04b: was ~1.4-2 kB/frame (setRot's boxed double args per posed part); now setRotFromPose reads the angles from scratch.
  ok('rig push+project+projectShadow (48 inst): <= 64 B/frame', proj <= 64, String(proj));
  console.log(`  rig push+project+projectShadow (48 inst): ${proj.toFixed(1)} B/frame`);
} else console.log('SKIP zero-alloc (run with --expose-gc)');

if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log(`rigPerf: ${pass} passed`);
