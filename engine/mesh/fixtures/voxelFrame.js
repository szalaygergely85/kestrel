// Test-only mesh raster probe for the frozen voxel caster samples.
import { buildVoxelMesh } from '../voxelMesh.js';
import { DrawList, DRAW_VOXEL } from '../DrawList.js';
import { createRasterTarget, rasterDrawList, copyToGBuffer } from '../rasterJS.js';
import { GBuffer } from '../../render/GBuffer.js';
import { projTerms, shearProjection } from '../../render/projection.js';
import { computeVoxelPose, FORWARD } from '../../voxel/voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from '../../voxel/VoxelModel.js';

export function voxelFrame(pm, partNames, inst, cam, grid) {
  const mesh = buildVoxelMesh(pm, { id: 'golden-voxel', partNames });
  const pose = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
  computeVoxelPose(pm, inst, pose);
  const list = new DrawList(1);
  list.begin();
  const item = list.push(mesh, DRAW_VOXEL);
  for (let p = 0; p < pm.partCount; p++) {
    item.partMatrices.set(FORWARD.subarray(p * 12, p * 12 + 12), p * 12);
    item.partFlags[p] = pose[p * PART_STRIDE + 12];
  }
  item.zBase = inst.z;
  const terms = {};
  projTerms(cam, grid, terms);
  const M = new Float64Array(16);
  shearProjection(terms, M);
  const target = createRasterTarget(grid.cols, grid.rows, 1);
  rasterDrawList(list, target, { M, terms, snap: true });
  const gbuf = new GBuffer(grid.cols, grid.rows);
  gbuf.beginFrame();
  const depth = new Float32Array(grid.cols * grid.rows);
  copyToGBuffer(target, gbuf, depth);
  return { gbuf, depth };
}
