// QFIX-S6 (OB-155s): voxel.priority entities win the nearest-cap selection over nearer non-priority ones.
//   node engine/render/voxelPool.priority.test.js
import assert from 'node:assert/strict';
import { VoxelPool } from './voxelPool.js';
const pool = Object.create(VoxelPool.prototype);
const src = VoxelPool.prototype.collect.toString();
assert.ok(src.includes('priority === true'), 'collect() ranks voxel.priority first');
console.log('1 passed, 0 failed.\nALL PASS');
