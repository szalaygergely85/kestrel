// engine/chargen/collapse.js (CHARGEN-03, docs/architecture.md 38.29 item 1): collapseRig(rigged, partMap) -> PartRig.
// Folds the 22 master bones into <= MAX_PARTS parts for the in-game voxel-style pose path.
// partMap = [{name, bones:[root, ...], parent: partName|null, compose?: n}]  (parents listed first)
//   - part pivot = the root bone's joint (cells, same space as VoxelPartDef.pivot);
//   - part rotation = the root bone's local rotation composed with the next (compose - 1) bones of the list
//     (body and head use compose 2), resampled to 50 ms keys in our Euler order Rz*Ry*Rx;
//   - part pos = the root bone's Hips pos (cells) when the root is Hips.
// PartRig: {cellM, parts:[{name,parent:index|-1,pivot:[x,y,z] cells,bones:[names]}], bones:[...], mesh (one range per part,
//   same layout as meshCharacter), matKeys, clips:{name:{loop,interp:'linear',durations:[50..],frames:[{part:{rot,pos?}}]}}, mounts}
export const MAX_PARTS = 8; // engine/chargen imports only itself; the test pins this to MAX_VOX_PARTS
import { sampleClip, quatToEuler } from './clip.js';

export const HUMANOID_PART_MAP = [
  { name: 'body', bones: ['Hips', 'Spine'], parent: null, compose: 2 },
  { name: 'chest', bones: ['Chest', 'LeftShoulder', 'RightShoulder'], parent: 'body' },
  { name: 'head', bones: ['Neck', 'Head'], parent: 'chest', compose: 2 },
  { name: 'jaw', bones: ['Jaw'], parent: 'head' },
  { name: 'armL', bones: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'], parent: 'chest' },
  { name: 'armR', bones: ['RightUpperArm', 'RightLowerArm', 'RightHand'], parent: 'chest' },
  { name: 'legL', bones: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes'], parent: 'body' },
  { name: 'legR', bones: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes'], parent: 'body' },
];

export const CLIP_STEP_MS = 50;

function qmul(a, ao, b, bo, out) { // out = a * b (x,y,z,w)
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

export function collapseRig(rigged, partMap) {
  if (!Array.isArray(partMap) || !partMap.length) throw new Error('collapseRig: empty partMap');
  if (partMap.length > MAX_PARTS) throw new Error(`collapseRig: ${partMap.length} parts, max ${MAX_PARTS}`);
  const boneIdx = new Map(rigged.bones.map((b, i) => [b.name, i]));
  const partOfBone = new Map();
  const partIdx = new Map();
  partMap.forEach((p, pi) => {
    if (partIdx.has(p.name)) throw new Error(`collapseRig: duplicate part "${p.name}"`);
    partIdx.set(p.name, pi);
    for (const bn of p.bones) {
      if (!boneIdx.has(bn)) throw new Error(`collapseRig: part "${p.name}" names unknown bone "${bn}"`);
      if (partOfBone.has(bn)) throw new Error(`collapseRig: bone "${bn}" is in two parts`);
      partOfBone.set(bn, pi);
    }
  });
  for (const b of rigged.bones) if (!partOfBone.has(b.name)) throw new Error(`collapseRig: bone "${b.name}" is in no part`);
  const parts = partMap.map((p, pi) => {
    const root = rigged.bones[boneIdx.get(p.bones[0])];
    let parent = -1;
    if (p.parent != null) {
      if (!partIdx.has(p.parent) || partIdx.get(p.parent) >= pi) throw new Error(`collapseRig: part "${p.name}" parent "${p.parent}" unknown or later`);
      parent = partIdx.get(p.parent);
    }
    if (root.parent != null && partOfBone.get(root.parent) !== parent) throw new Error(`collapseRig: part "${p.name}" root bone parent is not in part "${p.parent}"`);
    return { name: p.name, parent, pivot: root.jointCells.slice(), bones: p.bones.slice() };
  });

  // mesh: concatenate the bone ranges part by part
  const src = rigged.mesh;
  let total = 0;
  for (const p of parts) for (const bn of p.bones) total += src.ranges[boneIdx.get(bn)].count;
  const pos = new Float32Array(12 * total), nrm = new Int8Array(12 * total), mat = new Uint8Array(total);
  const ranges = [];
  let q = 0;
  for (const p of parts) {
    const start = q;
    for (const bn of p.bones) {
      const r = src.ranges[boneIdx.get(bn)];
      pos.set(src.pos.subarray(12 * r.start, 12 * (r.start + r.count)), 12 * q);
      nrm.set(src.nrm.subarray(12 * r.start, 12 * (r.start + r.count)), 12 * q);
      mat.set(src.mat.subarray(r.start, r.start + r.count), q);
      q += r.count;
    }
    ranges.push({ start, count: q - start });
  }

  // clips: 50 ms keys, part rotation = composed bone rotations, Euler unwrapped against the previous key
  const nb = rigged.bones.length;
  const quat = new Float64Array(4 * nb);
  const hips = [0, 0, 0];
  const tmp = [0, 0, 0, 1], acc = [0, 0, 0, 1], eul = [0, 0, 0], prev = new Float64Array(3 * parts.length);
  const clips = {};
  for (const [cname, clip] of Object.entries(rigged.clips || {})) {
    if (!(clip.duration > 0) || clip.duration % CLIP_STEP_MS) throw new Error(`collapseRig: clip "${cname}" duration must be a multiple of ${CLIP_STEP_MS} ms`);
    const n = clip.duration / CLIP_STEP_MS;
    const frames = [];
    const durations = [];
    prev.fill(0);
    for (let f = 0; f < n; f++) {
      sampleClip(rigged, clip, f * CLIP_STEP_MS, quat, hips);
      const frame = {};
      parts.forEach((p, pi) => {
        const k = partMap[pi].compose || 1;
        let o = 4 * boneIdx.get(p.bones[0]);
        acc[0] = quat[o]; acc[1] = quat[o + 1]; acc[2] = quat[o + 2]; acc[3] = quat[o + 3];
        for (let c = 1; c < k && c < p.bones.length; c++) {
          o = 4 * boneIdx.get(p.bones[c]);
          qmul(acc, 0, quat, o, tmp);
          acc[0] = tmp[0]; acc[1] = tmp[1]; acc[2] = tmp[2]; acc[3] = tmp[3];
        }
        quatToEuler(acc[0], acc[1], acc[2], acc[3], eul, 0);
        for (let a = 0; a < 3; a++) { // unwrap to the previous key's angle (|delta| <= 180)
          const pv = f === 0 ? 0 : prev[3 * pi + a];
          eul[a] += 360 * Math.round((pv - eul[a]) / 360);
          prev[3 * pi + a] = eul[a];
        }
        const e = { rot: [eul[0], eul[1], eul[2]] };
        if (p.bones[0] === 'Hips') e.pos = [hips[0] / rigged.cellM, hips[1] / rigged.cellM, hips[2] / rigged.cellM];
        frame[p.name] = e;
      });
      frames.push(frame);
      durations.push(CLIP_STEP_MS);
    }
    clips[cname] = { loop: clip.loop !== false, interp: 'linear', durations, frames };
  }

  return {
    cellM: rigged.cellM,
    parts,
    mesh: { quads: total, pos, nrm, mat, ranges },
    matKeys: rigged.matKeys.slice(),
    clips,
    mounts: rigged.mounts,
  };
}
