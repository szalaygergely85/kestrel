// engine/voxel/voxelPack.js - US-039 packer (architecture.md 15.1
// "Packed model"). Runs at bind time, may allocate (it is NOT a hot-path
// function - only computeVoxelPose/marchVoxelRay/castModels/packNormalOct
// are, per the tech notes' "do not allocate" list).

import { assertVoxelModel, PART_STRIDE } from './VoxelModel.js';

/**
 * Packs a validated VoxelModelDef into a PackedVoxelModel (architecture.md
 * 15.1). Throws (via assertVoxelModel) if `def` fails validation.
 * `matIdFor(materialKey) -> number` resolves a `mats` value to a
 * MaterialTable id.
 */
export function packVoxelModel(def, matIdFor) {
  assertVoxelModel(def);

  const [sx, sy, sz] = def.size;
  const partNames = Object.keys(def.parts);
  const partCount = partNames.length;

  // ---- part boxes + atlas offsets -------------------------------------------
  const boxes = new Array(partCount);
  let atlasTotal = 0;
  for (let i = 0; i < partCount; i++) {
    const pd = def.parts[partNames[i]];
    const x0 = pd.box[0], y0 = pd.box[1], z0 = pd.box[2];
    const x1 = pd.box[3], y1 = pd.box[4], z1 = pd.box[5];
    const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
    boxes[i] = { x0, y0, z0, x1, y1, z1, bx, by, bz, atlasOff: atlasTotal };
    atlasTotal += bx * by * bz;
  }

  const parts = new Float64Array(partCount * PART_STRIDE);
  for (let i = 0; i < partCount; i++) {
    const pd = def.parts[partNames[i]];
    const b = boxes[i];
    const parentIdx = pd.parent !== undefined ? partNames.indexOf(pd.parent) : -1;
    const base = i * PART_STRIDE;
    parts[base] = b.x0; parts[base + 1] = b.y0; parts[base + 2] = b.z0;
    parts[base + 3] = b.x1; parts[base + 4] = b.y1; parts[base + 5] = b.z1;
    parts[base + 6] = pd.pivot[0]; parts[base + 7] = pd.pivot[1]; parts[base + 8] = pd.pivot[2];
    parts[base + 9] = parentIdx;
    parts[base + 10] = b.atlasOff;
    parts[base + 11] = b.bx; parts[base + 12] = b.by; parts[base + 13] = b.bz;
    parts[base + 14] = 0; parts[base + 15] = 0;
  }

  // ---- mats -> local index (1..255, insertion order of non-null entries) ----
  const matKeys = Object.keys(def.mats);
  const charToLocal = new Map();
  const localToKey = [null]; // index 0 unused
  for (let i = 0; i < matKeys.length; i++) {
    const k = matKeys[i];
    const v = def.mats[k];
    if (v === null) continue;
    localToKey.push(v);
    charToLocal.set(k, localToKey.length - 1);
  }
  const matIds = new Uint16Array(localToKey.length);
  for (let i = 1; i < localToKey.length; i++) matIds[i] = matIdFor(localToKey[i]);

  // ---- vox atlas: first-part-in-index-order ownership -----------------------
  const vox = new Uint8Array(atlasTotal);
  const claimed = new Uint8Array(sx * sy * sz);
  for (let i = 0; i < partCount; i++) {
    const b = boxes[i];
    for (let z = b.z0; z < b.z1; z++) {
      const row = def.layers[z];
      for (let y = b.y0; y < b.y1; y++) {
        const rowStr = row[y];
        for (let x = b.x0; x < b.x1; x++) {
          const gi = x + sx * (y + sy * z);
          if (claimed[gi]) continue;
          const ch = rowStr[x];
          const local = charToLocal.get(ch);
          if (local === undefined) continue; // '.' or ' ' - empty
          claimed[gi] = 1;
          const off = b.atlasOff + (x - b.x0) + b.bx * ((y - b.y0) + b.by * (z - b.z0));
          vox[off] = local;
        }
      }
    }
  }

  // ---- clips ------------------------------------------------------------------
  const clips = [];
  const clipIndex = {};
  const anims = def.animations || {};
  const clipNames = Object.keys(anims);
  for (let ci = 0; ci < clipNames.length; ci++) {
    const name = clipNames[ci];
    const cd = anims[name];
    const n = cd.frames.length;
    const durMs = new Float32Array(n);
    if (cd.fps !== undefined) {
      const d = 1000 / cd.fps;
      for (let i = 0; i < n; i++) durMs[i] = d;
    } else {
      for (let i = 0; i < n; i++) durMs[i] = cd.durations[i];
    }
    const step = cd.interp === 'step';
    const keys = new Float64Array(n * partCount * 6);
    for (let f = 0; f < n; f++) {
      const frame = cd.frames[f];
      for (let p = 0; p < partCount; p++) {
        const pf = frame[partNames[p]];
        const base = f * partCount * 6 + p * 6;
        const rot = pf && pf.rot;
        const pos = pf && pf.pos;
        keys[base] = rot ? rot[0] : 0;
        keys[base + 1] = rot ? rot[1] : 0;
        keys[base + 2] = rot ? rot[2] : 0;
        keys[base + 3] = pos ? pos[0] : 0;
        keys[base + 4] = pos ? pos[1] : 0;
        keys[base + 5] = pos ? pos[2] : 0;
      }
    }
    const tagNames = cd.events ? Object.keys(cd.events).sort() : [];
    const tagCodes = new Int16Array(n);
    for (let ti = 0; ti < tagNames.length; ti++) {
      const val = cd.events[tagNames[ti]];
      const idxs = Array.isArray(val) ? val : [val];
      for (let j = 0; j < idxs.length; j++) tagCodes[idxs[j]] |= (1 << ti);
    }
    clips.push({ name, n, loop: !!cd.loop, step, durMs, keys, tagCodes });
    clipIndex[name] = ci;
  }

  return {
    sx, sy, sz,
    cellM: def.cellM,
    partCount,
    // 15.1: "version++ on every repack" (the GPU re-upload key, US-040) -
    // that increment is the LIVE model's responsibility across repacks of
    // the same model; a fresh pack always starts at 1.
    version: 1,
    anchor: new Float64Array(def.anchor),
    parts,
    vox,
    matIds,
    clips,
    clipIndex,
  };
}
