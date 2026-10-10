// engine/voxel/voxelPack.js - US-039 packer (architecture.md 15.1
// "Packed model"). Runs at bind time, may allocate (it is NOT a hot-path
// function - only computeVoxelPose/marchVoxelRay/castModels/packNormalOct
// are, per the tech notes' "do not allocate" list).

import { assertVoxelModel, PART_STRIDE, MAX_VOX_PARTS } from './VoxelModel.js';
import { deriveEmissiveLight } from './emissiveLight.js';

/**
 * Packs a validated VoxelModelDef into a PackedVoxelModel (architecture.md
 * 15.1). Throws (via assertVoxelModel) if `def` fails validation.
 * `matIdFor(materialKey) -> number` resolves a `mats` value to a
 * MaterialTable id. Optional `lightInfo = {matInfo, presetInfo, override}`
 * (EMIS-01a, see emissiveLight.js) fills `pm.emissiveLight` (record or null);
 * without it `pm.emissiveLight` is null.
 */
export function packVoxelModel(def, matIdFor, lightInfo) {
  if (def.rig) return packRiggedModel(def, matIdFor); // RIG-02b (38.32): prebuilt quads, no layers
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

  const { clips, clipIndex } = packClips(def, partNames, partCount);
  const mounts = packMounts(def, partNames);
  const partIndex = packPartIndex(partNames, partCount);

  return {
    sx, sy, sz,
    cellM: def.cellM,
    partCount,
    partIndex,
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
    mounts,
    emissiveLight: lightInfo ? deriveEmissiveLight(def, lightInfo.matInfo, lightInfo.presetInfo, lightInfo.override) : null,
  };
}

// ---- shared with the rig branch (RIG-02b): clips / mounts / partIndex are packed by the same code ----
function packClips(def, partNames, partCount) {
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

  return { clips, clipIndex };
}

function packMounts(def, partNames) {
  // ---- mounts (US-041a, 15.3 item 5) -----------------------------------------
  // `partIdx` resolved once here (not per `voxelMountWorld` call, rule 9) -
  // `assertVoxelModel` above already guarantees every named `part` exists;
  // an omitted `part` defaults to the model's root (part index 0).
  const mounts = {};
  const defMounts = def.mounts || {};
  for (const name of Object.keys(defMounts)) {
    const m = defMounts[name];
    mounts[name] = { at: new Float64Array(m.at), partIdx: m.part !== undefined ? partNames.indexOf(m.part) : 0 };
  }

  return mounts;
}

function packPartIndex(partNames, partCount) {
  // TALK-E1 (38.28 item 7): part name -> index, frozen, so a per-step `partRot` lookup is done once by the caller.
  const partIndex = {};
  for (let i = 0; i < partCount; i++) partIndex[partNames[i]] = i;
  Object.freeze(partIndex);

  return partIndex;
}

// ---- RIG-02b (38.32 item 4): rigged header (no layers) -> PackedVoxelModel with pm.rig ----
function checkRiggedHeader(def) {
  const fail = (m) => { throw new Error('packVoxelModel (rig): ' + m); };
  const names = Object.keys(def.parts || {});
  const n = names.length;
  if (n < 1 || n > MAX_VOX_PARTS) fail(n + ' parts, need 1..' + MAX_VOX_PARTS);
  names.forEach((nm, i) => {
    const pd = def.parts[nm];
    if (!pd || !Array.isArray(pd.box) || pd.box.length !== 6 || !Array.isArray(pd.pivot) || pd.pivot.length !== 3) fail('part ' + nm + ' needs box[6] and pivot[3]');
    if (pd.parent !== undefined && !(names.indexOf(pd.parent) >= 0 && names.indexOf(pd.parent) < i)) fail('part ' + nm + ' parent must be an earlier part');
  });
  const r = def.rig;
  if (!r.ranges || r.ranges.length !== n) fail('rig.ranges.length must equal the part count');
  if (!(r.pos instanceof Float32Array) || r.pos.length !== 12 * r.quads || r.nrm.length !== 12 * r.quads || r.mat.length !== r.quads) fail('rig pos/nrm/mat sizes do not match rig.quads');
  let sum = 0;
  for (const rg of r.ranges) { if (rg.start !== sum) fail('rig.ranges must be contiguous in part order'); sum += rg.count; }
  if (sum !== r.quads) fail('rig.ranges do not cover all quads');
  for (let q = 0; q < r.quads; q++) if (r.mat[q] < 1 || r.mat[q] > r.matKeys.length) fail('rig.mat out of range at quad ' + q);
  for (const [cn, cd] of Object.entries(def.animations || {})) {
    if (!Array.isArray(cd.frames) || !cd.frames.length || !Array.isArray(cd.durations) || cd.durations.length !== cd.frames.length) fail('clip ' + cn + ' malformed');
    for (const fr of cd.frames) for (const pn of Object.keys(fr)) if (!(pn in def.parts)) fail('clip ' + cn + ' names unknown part ' + pn);
  }
  for (const [mn, m] of Object.entries(def.mounts || {})) {
    if (!Array.isArray(m.at) || m.at.length !== 3 || (m.part !== undefined && !(m.part in def.parts))) fail('mount ' + mn + ' malformed');
  }
}

function packRiggedModel(def, matIdFor) {
  checkRiggedHeader(def);
  const partNames = Object.keys(def.parts);
  const partCount = partNames.length;
  const parts = new Float64Array(partCount * PART_STRIDE);
  for (let i = 0; i < partCount; i++) {
    const pd = def.parts[partNames[i]];
    const base = i * PART_STRIDE;
    for (let k = 0; k < 6; k++) parts[base + k] = pd.box[k];
    parts[base + 6] = pd.pivot[0]; parts[base + 7] = pd.pivot[1]; parts[base + 8] = pd.pivot[2];
    parts[base + 9] = pd.parent !== undefined ? partNames.indexOf(pd.parent) : -1;
    // 10..15 stay 0: no atlas
  }
  const matKeys = def.rig.matKeys;
  const matIds = new Uint16Array(matKeys.length + 1);
  for (let i = 1; i <= matKeys.length; i++) matIds[i] = matIdFor(matKeys[i - 1]);
  const { clips, clipIndex } = packClips(def, partNames, partCount);
  return {
    sx: def.size[0], sy: def.size[1], sz: def.size[2],
    cellM: def.cellM,
    partCount,
    partIndex: packPartIndex(partNames, partCount),
    version: 1,
    anchor: new Float64Array(def.anchor),
    parts,
    vox: new Uint8Array(0),
    matIds,
    clips,
    clipIndex,
    mounts: packMounts(def, partNames),
    emissiveLight: null, // v1: deriveEmissiveLight reads layers
    rig: def.rig,
  };
}
