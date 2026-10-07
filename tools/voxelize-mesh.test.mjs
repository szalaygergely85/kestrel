// EXPERIMENT test: node tools/voxelize-mesh.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { run } from './voxelize-mesh.mjs';
import { validateVoxelModel } from '../engine/index.js';

if (!fs.existsSync('design/meshes/quaternius/glTF/Rock_Medium_1.gltf')) { console.log('skip - Quaternius sources not present'); process.exit(0); }
const a = run({ names: ['Rock_Medium_1'], res: [16, 32] }), b = run({ names: ['Rock_Medium_1'], res: [16, 32] });
assert.strictEqual(JSON.stringify(a), JSON.stringify(b)); console.log('ok - deterministic');
for (const [k, m] of Object.entries(a)) {
  const e = validateVoxelModel(m.voxel); assert.ok(!e || !e.length, k + ': ' + JSON.stringify(e));
  assert.ok(m.preview.voxels > 100); assert.ok(Math.max(...m.voxel.size) <= 32);
}
assert.ok(a.vx_Rock_Medium_1_32.preview.voxels > a.vx_Rock_Medium_1_16.preview.voxels); console.log('ok - valid, finer = more voxels');
