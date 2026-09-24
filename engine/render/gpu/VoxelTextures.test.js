// engine/render/gpu/VoxelTextures.test.js - US-040 Node tests (architecture.md
// 15.2 item 8): atlas layout (modelBase, index mapping, atlas[i] ==
// matIds[vox[i]]), row-limit assert, writeInstanceRows values equal
// computeVoxelPose output and the rect equals castModels's rect (via the
// shared instanceRect helper both paths call), culling count, zero alloc.
// Run: node engine/render/gpu/VoxelTextures.test.js

import { MAX_VOX_INSTANCES, PART_STRIDE } from '../../voxel/VoxelModel.js';
import { packVoxelModel } from '../../voxel/voxelPack.js';
import { computeVoxelPose } from '../../voxel/voxelPose.js';
import { VoxelPool } from '../voxelPool.js';
import { buildVoxelAtlas, writeInstanceRows, VOX_ATLAS_WIDTH, VOXINST_WIDTH, VOXINST_ROWS_PER_INSTANCE } from './VoxelTextures.js';
import quadruped12 from '../../voxel/fixtures/quadruped12.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const MAT_IDS = { mat_a: 1, mat_b: 2, mat_c: 3 };
const table = { idFor: (k) => MAT_IDS[k] };

// A registry stub with a single voxel model 'bear' - just enough of
// VoxelPool.bind's `registry.keys('model')` / `registry.model(key)` contract.
function makeRegistry(models) {
  const keys = Object.keys(models);
  return { keys: (kind) => (kind === 'model' ? keys : []), model: (k) => models[k] };
}

// =============================================================================
// buildVoxelAtlas
// =============================================================================

const pm = packVoxelModel(quadruped12, table.idFor);

{
  const atlas = buildVoxelAtlas([pm], 1);
  ok('atlas width is 256', atlas.w === VOX_ATLAS_WIDTH);
  ok('modelBase[0] is 0 for a single model', atlas.modelBase[0] === 0);
  ok('atlas height covers the model (ceil(len/256))', atlas.h === Math.max(1, Math.ceil(pm.vox.length / VOX_ATLAS_WIDTH)));
  let allEqual = true;
  for (let i = 0; i < pm.vox.length; i++) {
    if (atlas.vox[i] !== pm.matIds[pm.vox[i]]) { allEqual = false; break; }
  }
  ok('atlas[i] == matIds[vox[i]] for every voxel of a single model', allEqual);
  ok('atlas.version echoes the passed version', atlas.version === 1);
}

{
  const pm2 = packVoxelModel(quadruped12, table.idFor);
  const atlas = buildVoxelAtlas([pm, pm2], 3);
  ok('modelBase[1] equals model 0 vox length (two-model offset)', atlas.modelBase[1] === pm.vox.length);
  let allEqual = true;
  for (let i = 0; i < pm2.vox.length; i++) {
    if (atlas.vox[atlas.modelBase[1] + i] !== pm2.matIds[pm2.vox[i]]) { allEqual = false; break; }
  }
  ok('atlas[base+i] == matIds[vox[i]] for the second model', allEqual);
}

{
  // Row-limit assert: a model whose vox atlas alone needs > 256*256 texels
  // must throw rather than silently truncate.
  const bigDef = {
    version: 1, cellM: 0.1, size: [16, 16, 16], anchor: [0, 0, 0],
    mats: { '#': 'm' },
    layers: Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => '#'.repeat(16))),
    parts: { root: { box: [0, 0, 0, 16, 16, 16], pivot: [0, 0, 0] } }, // 4096 voxels
  };
  const bigPm = packVoxelModel(bigDef, () => 1);
  const list = [];
  for (let i = 0; i < 17; i++) list.push(bigPm); // 17 * 4096 = 69632 > 256*256=65536
  let threw = false;
  try { buildVoxelAtlas(list, 1); } catch (e) { threw = /exceeds 256/.test(e.message); }
  ok('buildVoxelAtlas throws when the atlas needs > 256 rows', threw);
}

// =============================================================================
// VoxelPool.bind builds the same atlas + a modelKey -> index map
// =============================================================================

const registry = makeRegistry({ bear: { voxel: quadruped12 } });
const pool = new VoxelPool();
pool.bind(registry, table);

{
  ok('pool.atlas is built at bind time', !!pool.atlas);
  ok('pool._modelIndexByKey maps the only model to index 0', pool._modelIndexByKey.bear === 0);
  let allEqual = true;
  const bearPm = pool.models.get('bear');
  for (let i = 0; i < bearPm.vox.length; i++) {
    if (pool.atlas.vox[i] !== bearPm.matIds[bearPm.vox[i]]) { allEqual = false; break; }
  }
  ok('pool.atlas matches buildVoxelAtlas([bearPm])', allEqual);
}

{
  const before = pool.atlas.version;
  pool.bind(registry, table);
  ok('re-bind bumps atlas.version (GPU re-upload key)', pool.atlas.version === before + 1);
}

// =============================================================================
// writeInstanceRows: values equal computeVoxelPose output and instanceRect's rect
// =============================================================================

{
  const cam = { x: 0, y: -3, z: 0.9, yawDeg: 180, pitchDeg: 0 };
  const rt = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 };
  pool.beginFrame();
  pool.pushInstance('bear', 0, 0, 0, 180, -1, 0, 0);
  pool.project(cam, rt);
  ok('one visible instance projects into pool.list', pool.list.length === 1);

  const inst = pool.list[0];
  const out = new Float32Array(VOXINST_WIDTH * 4 * VOXINST_ROWS_PER_INSTANCE * MAX_VOX_INSTANCES);
  writeInstanceRows(pool, 0, out);

  // Header row (row 0): aabbMin.xyz, partCount / aabbMax.xyz, slot / feetZ, cellM.
  ok('header T0.xyz == rect.minX/Y/Z', out[0] === inst.rect.minX && out[1] === inst.rect.minY && out[2] === inst.rect.minZ);
  ok('header T0.w == partCount', out[3] === inst.model.partCount);
  const o1 = 1 * 4;
  ok('header T1.xyz == rect.maxX/Y/Z', out[o1] === inst.rect.maxX && out[o1 + 1] === inst.rect.maxY && out[o1 + 2] === inst.rect.maxZ);
  ok('header T1.w == slot', out[o1 + 3] === inst.slot);
  const o2 = 2 * 4;
  ok('header T2.x == feetZ, T2.y == cellM', out[o2] === inst.z && out[o2 + 1] === inst.model.cellM);

  // Part 0 row: A/oL must equal computeVoxelPose's own L_k (the SAME array
  // instanceRect already wrote into inst.pose - writeInstanceRows must not
  // recompute the pose, only read it and fold in the eye).
  const poseCheck = new Float64Array(inst.pose.length);
  computeVoxelPose(inst.model, inst, poseCheck);
  let poseMatches = true;
  for (let i = 0; i < inst.model.partCount * PART_STRIDE; i++) {
    if (Math.abs(poseCheck[i] - inst.pose[i]) > 1e-9) { poseMatches = false; break; }
  }
  ok('instanceRect wrote the same pose computeVoxelPose would (sanity)', poseMatches);

  const row1 = 1; // row index of part 0 (instance i=0: rowBase=0, part rows start at rowBase+1)
  const rt0 = (row1 * VOXINST_WIDTH + 0) * 4;
  const a0 = inst.pose[0], a1 = inst.pose[1], a2 = inst.pose[2], bx = inst.pose[9];
  const expectedOLx = a0 * pool.eyeX + a1 * pool.eyeY + a2 * pool.eyeZ + bx;
  ok('part 0 row T0 == (A row0, oL.x)', out[rt0] === a0 && out[rt0 + 1] === a1 && out[rt0 + 2] === a2 && Math.abs(out[rt0 + 3] - expectedOLx) < 1e-4);

  const rt3 = (row1 * VOXINST_WIDTH + 3) * 4;
  const modelIdx = pool._modelIndexByKey.bear;
  const expectedAtlasOff = inst.model.parts[10] + pool.atlas.modelBase[modelIdx]; // part 0's atlasOff (PART_STRIDE field 10)
  ok('part 0 row T3.w == atlasOff + modelBase', out[rt3 + 3] === expectedAtlasOff);

  const rt4 = (row1 * VOXINST_WIDTH + 4) * 4;
  const expectedAxisAligned = inst.pose[12]; // 1 or 0
  ok('part 0 row T4.w low bit == axisAligned flag', (out[rt4 + 3] & 1) === expectedAxisAligned);
  ok('part 0 row T4.w >> 1 == part index 0', (out[rt4 + 3] >> 1) === 0);
}

// =============================================================================
// Culling count: past MAX_VOX_INSTANCES per frame, pushInstance itself drops
// extras (with a one-time warning - VoxelPool.pushInstance, unchanged since
// US-040 step 1); project() then never sees more than MAX_VOX_INSTANCES
// queued, so its own list/atlas-row math stays within the VOXINST texture's
// MAX_VOX_INSTANCES*9 rows.
// =============================================================================

{
  const cam = { x: 0, y: -3, z: 0.9, yawDeg: 180, pitchDeg: 0 };
  const rt = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 };
  pool.beginFrame();
  for (let i = 0; i < MAX_VOX_INSTANCES + 3; i++) pool.pushInstance('bear', 0, 0, 0, 180, -1, 0, 0);
  pool.project(cam, rt);
  ok('extra pushes past MAX_VOX_INSTANCES never reach project()', pool.list.length === MAX_VOX_INSTANCES, `list=${pool.list.length}`);
}

// =============================================================================
// Zero allocation (writeInstanceRows on a warm pool/out buffer)
// =============================================================================

if (typeof globalThis.gc === 'function') {
  const cam = { x: 0, y: -3, z: 0.9, yawDeg: 180, pitchDeg: 0 };
  const rt = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 };
  const out = new Float32Array(VOXINST_WIDTH * 4 * VOXINST_ROWS_PER_INSTANCE * MAX_VOX_INSTANCES);
  for (let i = 0; i < 500; i++) {
    pool.beginFrame();
    pool.pushInstance('bear', 0, 0, 0, 180, -1, 0, 0);
    pool.project(cam, rt);
    writeInstanceRows(pool, 0, out);
  }
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) {
    pool.beginFrame();
    pool.pushInstance('bear', 0, 0, 0, 180, -1, 0, 0);
    pool.project(cam, rt);
    writeInstanceRows(pool, 0, out);
  }
  globalThis.gc();
  const after = process.memoryUsage().heapUsed;
  const delta = after - before;
  ok('5000 project+writeInstanceRows calls: heapUsed delta < 256 KB', delta < 262144, `delta=${delta}`);
} else {
  console.log('SKIP zero-alloc check (run with --expose-gc)');
}

console.log(`\n[VoxelTextures.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
