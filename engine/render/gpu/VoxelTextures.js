// engine/render/gpu/VoxelTextures.js - US-040 (docs/architecture.md 15.2
// item 3): pure packing for the voxel-model GPU textures. No `gl` calls here
// (Node-testable); `GpuCellPipeline.js` owns the actual texImage2D/
// texSubImage2D calls.
//
// VOX     R16UI, width 256, height ceil(total/256) (<= 256 rows) - texel =
//         MaterialTable id (0 = empty), linear index i -> (i&255, i>>8).
//         `modelBase[m]` is the per-model offset added to every part's
//         `atlasOff` when it is written into an instance row (15.2 item 2).
// VOXINST RGBA32F, width 8, height MAX_VOX_INSTANCES*9 - per-frame instance
//         rows (15.2 item 3): row 9i = header, row 9i+1+k = part k.

import { MAX_VOX_INSTANCES, MAX_VOX_PARTS, PART_STRIDE } from '../../voxel/VoxelModel.js';

export const VOX_ATLAS_WIDTH = 256;

export const VOXINST_WIDTH = 8;
export const VOXINST_ROWS_PER_INSTANCE = 1 + MAX_VOX_PARTS; // header + up to MAX_VOX_PARTS part rows
export const VOXINST_HEIGHT = MAX_VOX_INSTANCES * VOXINST_ROWS_PER_INSTANCE;

/**
 * Packs every bound model's `vox` (local material index atlas) through its
 * own `matIds` table into one shared VOX atlas (architecture.md 15.2 item
 * 2). `packedList` is an array of `PackedVoxelModel` (VoxelPool.bind's
 * `this.models` values, in a stable order - see VoxelPool.bind, which also
 * builds the matching modelKey -> index map `writeInstanceRows` needs).
 * @returns {{vox: Uint16Array, w: number, h: number, modelBase: Int32Array, version: number}}
 */
export function buildVoxelAtlas(packedList, version = 1) {
  const w = VOX_ATLAS_WIDTH;
  const n = packedList.length;
  const modelBase = new Int32Array(n);
  let total = 0;
  for (let m = 0; m < n; m++) {
    modelBase[m] = total;
    total += packedList[m].vox.length;
  }
  const h = Math.max(1, Math.ceil(total / w));
  if (h > 256) throw new Error(`buildVoxelAtlas: atlas needs ${h} rows (width ${w}), exceeds 256`);
  const vox = new Uint16Array(w * h);
  for (let m = 0; m < n; m++) {
    const pm = packedList[m];
    const base = modelBase[m];
    const voxLocal = pm.vox, matIds = pm.matIds;
    for (let k = 0; k < voxLocal.length; k++) {
      vox[base + k] = matIds[voxLocal[k]];
    }
  }
  return { vox, w, h, modelBase, version };
}

/**
 * Writes instance `i`'s VOXINST rows (architecture.md 15.2 item 3) into
 * `out` (Float32Array, length >= VOXINST_WIDTH*4*VOXINST_HEIGHT, RGBA32F
 * row-major). `pool` is a projected `VoxelPool` (`pool.list[i]` has `.pose`
 * from `instanceRect`/`computeVoxelPose` - i.e. the world-to-part-local L_k
 * affine, the SAME 12 values `marchVoxelRay` consumes - and `.rect`, the
 * whole-instance world AABB); `pool.eyeX/eyeY/eyeZ` (set by `project()`) is
 * the camera eye position `oL = A*eye + b` is computed against, in float64
 * JS (never on the GPU - the local ray is `oL + t*(A*d)`, t unchanged, so
 * the GPU never adds `b` to a possibly-far-from-origin world position).
 */
export function writeInstanceRows(pool, i, out) {
  const inst = pool.list[i];
  const pm = inst.model;
  const rect = inst.rect;
  const pose = inst.pose;
  const eyeX = pool.eyeX, eyeY = pool.eyeY, eyeZ = pool.eyeZ;
  const rowBase = i * VOXINST_ROWS_PER_INSTANCE;

  const o0 = (rowBase * VOXINST_WIDTH + 0) * 4;
  out[o0] = rect.minX; out[o0 + 1] = rect.minY; out[o0 + 2] = rect.minZ; out[o0 + 3] = pm.partCount;
  const o1 = (rowBase * VOXINST_WIDTH + 1) * 4;
  out[o1] = rect.maxX; out[o1 + 1] = rect.maxY; out[o1 + 2] = rect.maxZ; out[o1 + 3] = inst.slot;
  const o2 = (rowBase * VOXINST_WIDTH + 2) * 4;
  out[o2] = inst.z; out[o2 + 1] = pm.cellM; out[o2 + 2] = 0; out[o2 + 3] = 0;
  for (let t = 3; t < 8; t++) {
    const ot = (rowBase * VOXINST_WIDTH + t) * 4;
    out[ot] = 0; out[ot + 1] = 0; out[ot + 2] = 0; out[ot + 3] = 0;
  }

  const modelIdx = pool._modelIndexByKey[inst.modelKey];
  const base = pool.atlas.modelBase[modelIdx];

  for (let k = 0; k < pm.partCount; k++) {
    const pbase = k * PART_STRIDE;
    const a0 = pose[pbase], a1 = pose[pbase + 1], a2 = pose[pbase + 2];
    const a3 = pose[pbase + 3], a4 = pose[pbase + 4], a5 = pose[pbase + 5];
    const a6 = pose[pbase + 6], a7 = pose[pbase + 7], a8 = pose[pbase + 8];
    const bx = pose[pbase + 9], by = pose[pbase + 10], bz = pose[pbase + 11];
    const axisAligned = pose[pbase + 12];
    const oLx = a0 * eyeX + a1 * eyeY + a2 * eyeZ + bx;
    const oLy = a3 * eyeX + a4 * eyeY + a5 * eyeZ + by;
    const oLz = a6 * eyeX + a7 * eyeY + a8 * eyeZ + bz;

    const row = rowBase + 1 + k;
    const rt0 = (row * VOXINST_WIDTH + 0) * 4;
    out[rt0] = a0; out[rt0 + 1] = a1; out[rt0 + 2] = a2; out[rt0 + 3] = oLx;
    const rt1 = (row * VOXINST_WIDTH + 1) * 4;
    out[rt1] = a3; out[rt1 + 1] = a4; out[rt1 + 2] = a5; out[rt1 + 3] = oLy;
    const rt2 = (row * VOXINST_WIDTH + 2) * 4;
    out[rt2] = a6; out[rt2 + 1] = a7; out[rt2 + 2] = a8; out[rt2 + 3] = oLz;

    const pk = k * PART_STRIDE; // pm.parts (model-space box), separate from `pose` above
    const x0 = pm.parts[pk], y0 = pm.parts[pk + 1], z0 = pm.parts[pk + 2];
    const atlasOff = pm.parts[pk + 10];
    const bxN = pm.parts[pk + 11], byN = pm.parts[pk + 12], bzN = pm.parts[pk + 13];
    const rt3 = (row * VOXINST_WIDTH + 3) * 4;
    out[rt3] = x0; out[rt3 + 1] = y0; out[rt3 + 2] = z0; out[rt3 + 3] = atlasOff + base;
    const rt4 = (row * VOXINST_WIDTH + 4) * 4;
    const flags = (axisAligned ? 1 : 0) | (k << 1);
    out[rt4] = bxN; out[rt4 + 1] = byN; out[rt4 + 2] = bzN; out[rt4 + 3] = flags;
    for (let t = 5; t < 8; t++) {
      const rt = (row * VOXINST_WIDTH + t) * 4;
      out[rt] = 0; out[rt + 1] = 0; out[rt + 2] = 0; out[rt + 3] = 0;
    }
  }
}
