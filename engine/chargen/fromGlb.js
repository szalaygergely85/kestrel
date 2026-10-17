// engine/chargen/fromGlb.js (RIG-02a, docs/architecture.md 38.32 item 5): riggedFromGlb(readRiggedGlb output) -> RiggedModel
// in the meshCharacter shape, so collapseRig(riggedFromGlb(glb), partMap) works on a .kestrel character .glb.
// Load time only. Bones: joint = minus the IBM translation (metres from the anchor, our axes), jointCells = joint / cellM
// (so anchorCells = 0). Mesh: the exporter's quads (4 vertices, indices 0,1,2 0,2,3 after the reader's winding flip).
import { sampleRiggedClip } from '../mesh/gltf.js';
import { quatToEuler } from './clip.js';
import { CLIP_STEP_MS as CLIP_RESAMPLE_MS } from './collapse.js';

const PALETTE_TEX_SIZE = 16; // tools/export/png.js texelUv
const REST_TOL = 1e-4;

function die(msg) { throw new Error(`riggedFromGlb: ${msg}`); }

export function riggedFromGlb(glb) {
  const ex = glb && glb.extras;
  if (!ex || ex.format !== 1) die('not a Kestrel character .glb; use the static glTF importer for other models');
  const cellM = ex.cellM;
  if (!(cellM > 0)) die('extras.cellM missing');
  const matKeys = Array.isArray(ex.matKeys) ? ex.matKeys.slice() : die('extras.matKeys missing');

  const nb = glb.bones.length;
  const bones = glb.bones.map((b) => {
    const r = b.rest.r;
    if (Math.abs(r[0]) > REST_TOL || Math.abs(r[1]) > REST_TOL || Math.abs(r[2]) > REST_TOL || Math.abs(Math.abs(r[3]) - 1) > REST_TOL) {
      die(`bone "${b.name}" has a non-identity rest rotation`);
    }
    const joint = [-b.ibm[12], -b.ibm[13], -b.ibm[14]];
    return {
      name: b.name, parent: b.parent < 0 ? null : glb.bones[b.parent].name,
      joint, jointCells: joint.map((v) => v / cellM),
    };
  });

  // ---- mesh: groups of 4 vertices, one bone per quad; stable sort by bone
  const m = glb.mesh;
  const nv = m.positions.length / 3;
  if (nv % 4) die(`${nv} vertices is not a multiple of 4 (not a quad mesh)`);
  if (!m.normals || !m.uvs) die('mesh needs NORMAL and TEXCOORD_0');
  const nq = nv / 4;
  if (m.indices.length !== 6 * nq) die('index count is not 6 per quad');
  const perBone = Array.from({ length: nb }, () => []);
  for (let q = 0; q < nq; q++) {
    const b = 4 * q;
    const bi = m.boneIndex[b];
    for (let k = 1; k < 4; k++) if (m.boneIndex[b + k] !== bi) die(`quad ${q} spans several bones`);
    const I = m.indices, o = 6 * q;
    if (I[o] !== b || I[o + 1] !== b + 1 || I[o + 2] !== b + 2 || I[o + 3] !== b || I[o + 4] !== b + 2 || I[o + 5] !== b + 3) die(`quad ${q} has an unexpected index pattern`);
    perBone[bi].push(q);
  }
  const pos = new Float32Array(12 * nq), nrm = new Int8Array(12 * nq), mat = new Uint8Array(nq);
  const ranges = [];
  let w = 0;
  for (let bi = 0; bi < nb; bi++) {
    const start = w;
    for (const q of perBone[bi]) {
      pos.set(m.positions.subarray(12 * q, 12 * q + 12), 12 * w);
      for (let k = 0; k < 12; k++) nrm[12 * w + k] = Math.round(m.normals[12 * q + k]);
      const u = m.uvs[8 * q], v = m.uvs[8 * q + 1];
      const tex = Math.floor(u * PALETTE_TEX_SIZE) + PALETTE_TEX_SIZE * Math.floor(v * PALETTE_TEX_SIZE);
      if (tex < 0 || tex >= matKeys.length) die(`quad ${q} material texel ${tex} outside matKeys`);
      mat[w] = tex + 1;
      w++;
    }
    ranges.push({ start, count: w - start });
  }

  // ---- clips: 50 ms keys, bone rot = Euler (Rz*Ry*Rx, unwrapped), Hips pos in cells
  const hipsBone = bones.findIndex((b) => b.parent === null);
  const clips = {};
  const eul = [0, 0, 0], prev = new Float64Array(3 * nb);
  for (const gc of glb.clips) {
    const n = Math.max(1, Math.round((gc.duration * 1000) / CLIP_RESAMPLE_MS));
    const loop = gc.loop !== false;
    const keys = [];
    prev.fill(0);
    for (let f = 0; f <= (loop ? n - 1 : n); f++) {
      const t = f * CLIP_RESAMPLE_MS;
      const s = sampleRiggedClip(glb, gc, t / 1000);
      const rot = {};
      for (let b = 0; b < nb; b++) {
        quatToEuler(s.r[4 * b], s.r[4 * b + 1], s.r[4 * b + 2], s.r[4 * b + 3], eul, 0);
        for (let a = 0; a < 3; a++) {
          eul[a] += 360 * Math.round((prev[3 * b + a] - eul[a]) / 360);
          prev[3 * b + a] = eul[a];
        }
        if (eul[0] || eul[1] || eul[2]) rot[bones[b].name] = [eul[0], eul[1], eul[2]];
      }
      const rest = glb.bones[hipsBone].rest.t;
      const pos3 = [0, 1, 2].map((a) => (s.t[3 * hipsBone + a] - rest[a]) / cellM);
      keys.push({ t, rot, pos: { [bones[hipsBone].name]: pos3 } });
    }
    clips[gc.name] = { duration: n * CLIP_RESAMPLE_MS, loop, keys };
  }

  const mounts = {};
  for (const [k, v] of Object.entries(ex.mounts || {})) mounts[k] = v.map((x) => x / cellM);

  return {
    cellM, bones,
    mesh: { quads: nq, pos, nrm, mat, ranges },
    matKeys, clips, tempo: 1, mounts,
  };
}
