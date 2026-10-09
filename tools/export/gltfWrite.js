// tools/export/gltfWrite.js (CHARGEN-07, docs/architecture.md 38.29 items 5/6): RiggedModel -> binary glTF 2.0 (.glb).
// Browser-safe (no fs, no node built-ins), deterministic: the same model + options give the same bytes
// (no timestamps, sorted extras keys).
//
//   exportGlb(model, {rgbOf, recipe?, partMap?, colorMode?}) -> Uint8Array
//     model   = engine meshCharacter() output (RiggedModel: bones[{name,parent,joint}], mesh, matKeys, clips, mounts, tempo)
//     rgbOf   = (matKey) -> [r,g,b] 0..255 (sRGB); texel i of the 16x16 palette PNG = matKeys[i]; mesh.mat is 1-based
//     recipe  = the CharRecipe, stored in extras.kestrel.recipe     partMap = array form, default HUMANOID_PART_MAP
//     colorMode 'rgb' (default): COLOR_0 = the palette colour as linear float (glTF COLOR_0 is linear);
//               'white': COLOR_0 = 1,1,1. NOTE glTF MULTIPLIES COLOR_0 with the base colour texture, so 'rgb' plus the
//               palette texture shows ~rgb^2 in viewers that apply vertex colours (three.js, glTFast); Blender ignores it.
//
// Layout: scene nodes = [Body mesh node (skinned), Hips joint node]; node 1..22 = the 22 humanoid bones in skeleton
// order (parents first, translation-only rest pose, identity rotation); skin.joints = those 22 nodes, rigid weights
// (1,0,0,0); inverseBindMatrices = translate(-jointWorld).
// Axes: (X,Y,Z)_gltf = (-x, z, -y) from authoring (x east, y south, z up), metres, the character faces +Z. The map is
// a reflection, so triangle winding is reversed and a rotation quaternion (x,y,z,w) becomes (x,-z,y,w).
// Animations: one per clip, LINEAR rotation channel for every bone + a Hips translation channel, frames =
// round(duration / tempo * 30); loop clips end on their first frame.
// Root extras.kestrel = {format:1, matKeys, partMap, mounts (authoring axes, metres from the anchor, like the
// joints), cellM, tempo, recipe}.
import { sampleClip, HUMANOID_PART_MAP } from '../../engine/index.js';
import { paletteTexture, texelUv } from './png.js';

const FPS = 30;
const FLOAT = 5126, UBYTE = 5121, USHORT = 5123, UINT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

// authoring (x,y,z) -> glTF (-x, z, -y)
const toGltf = (v) => [-v[0], v[2], -v[1]];
const srgbToLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

/** JSON-safe copy with object keys sorted (stable bytes whatever the key order of the input). */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = stable(v[k]); return o; }
  return v;
}

class Blob {
  constructor() { this.chunks = []; this.length = 0; this.views = []; this.accessors = []; }
  /** Adds bytes as a bufferView (4-byte aligned); returns its index. */
  view(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const v = { buffer: 0, byteOffset: this.length, byteLength: bytes.length };
    if (target) v.target = target;
    this.views.push(v);
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this.views.length - 1;
  }
  accessor(typed, target, componentType, type, count, extra = {}) {
    this.accessors.push({ bufferView: this.view(typed, target), componentType, count, type, ...extra });
    return this.accessors.length - 1;
  }
  bytes() {
    const out = new Uint8Array(this.length + ((4 - (this.length % 4)) % 4));
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

const minMax = (arr, n) => {
  const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity);
  for (let i = 0; i < arr.length; i += n) for (let k = 0; k < n; k++) { const x = arr[i + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; }
  return { min, max };
};

export function exportGlb(model, opts = {}) {
  const { rgbOf, recipe = null, partMap = HUMANOID_PART_MAP, colorMode = 'rgb' } = opts;
  if (typeof rgbOf !== 'function') throw new Error('exportGlb: opts.rgbOf(matKey) -> [r,g,b] is required');
  if (colorMode !== 'rgb' && colorMode !== 'white') throw new Error(`exportGlb: colorMode must be 'rgb' or 'white', got ${colorMode}`);
  if (!Array.isArray(partMap)) throw new Error('exportGlb: partMap must be the array form');
  const { bones, mesh, matKeys } = model;
  const nb = bones.length, nq = mesh.quads, nv = 4 * nq;
  if (!nq) throw new Error('exportGlb: empty mesh');
  if (matKeys.length > 256) throw new Error(`exportGlb: ${matKeys.length} materials (max 256)`);

  const palette = matKeys.map((k) => {
    const c = rgbOf(k);
    if (!c || c.length < 3) throw new Error(`exportGlb: rgbOf("${k}") gave no colour`);
    return c;
  });
  const tex = paletteTexture(palette);

  // ---- vertex attributes (4 vertices per quad; indices 0,2,1 0,3,2 because the axis map is a reflection)
  const pos = new Float32Array(3 * nv), nrm = new Float32Array(3 * nv), uv = new Float32Array(2 * nv), col = new Float32Array(3 * nv);
  const joints = new Uint8Array(4 * nv), weights = new Uint8Array(4 * nv);
  const lin = palette.map((c) => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]);
  for (let q = 0; q < nq; q++) {
    const m = mesh.mat[q] - 1;
    if (!(m >= 0 && m < matKeys.length)) throw new Error(`exportGlb: quad ${q} has material ${mesh.mat[q]} outside matKeys`);
    const [u, v] = texelUv(m);
    for (let k = 0; k < 4; k++) {
      const i = 4 * q + k, s = 3 * i, a = 12 * q + 3 * k;
      pos[s] = -mesh.pos[a]; pos[s + 1] = mesh.pos[a + 2]; pos[s + 2] = -mesh.pos[a + 1];
      nrm[s] = -mesh.nrm[a]; nrm[s + 1] = mesh.nrm[a + 2]; nrm[s + 2] = -mesh.nrm[a + 1];
      uv[2 * i] = u; uv[2 * i + 1] = v;
      if (colorMode === 'rgb') { col[s] = lin[m][0]; col[s + 1] = lin[m][1]; col[s + 2] = lin[m][2]; } else col.fill(1, s, s + 3);
      weights[4 * i] = 255;
    }
  }
  mesh.ranges.forEach((r, bi) => { for (let q = r.start; q < r.start + r.count; q++) for (let k = 0; k < 4; k++) joints[4 * (4 * q + k)] = bi; });
  const big = nv > 65535;
  const idx = big ? new Uint32Array(6 * nq) : new Uint16Array(6 * nq);
  for (let q = 0; q < nq; q++) {
    const b = 4 * q, o = 6 * q;
    idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1; idx[o + 3] = b; idx[o + 4] = b + 3; idx[o + 5] = b + 2;
  }

  // ---- skeleton (joint world positions in glTF axes)
  const jw = bones.map((b) => toGltf(b.joint));
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
  const ibm = new Float32Array(16 * nb);
  for (let i = 0; i < nb; i++) {
    ibm[16 * i] = ibm[16 * i + 5] = ibm[16 * i + 10] = ibm[16 * i + 15] = 1;
    ibm[16 * i + 12] = -jw[i][0]; ibm[16 * i + 13] = -jw[i][1]; ibm[16 * i + 14] = -jw[i][2];
  }

  const blob = new Blob();
  const meshAttrs = {
    POSITION: blob.accessor(pos, ARRAY_BUFFER, FLOAT, 'VEC3', nv, minMax(pos, 3)),
    NORMAL: blob.accessor(nrm, ARRAY_BUFFER, FLOAT, 'VEC3', nv),
    TEXCOORD_0: blob.accessor(uv, ARRAY_BUFFER, FLOAT, 'VEC2', nv),
    COLOR_0: blob.accessor(col, ARRAY_BUFFER, FLOAT, 'VEC3', nv),
    JOINTS_0: blob.accessor(joints, ARRAY_BUFFER, UBYTE, 'VEC4', nv),
    WEIGHTS_0: blob.accessor(weights, ARRAY_BUFFER, UBYTE, 'VEC4', nv, { normalized: true }),
  };
  const indices = blob.accessor(idx, ELEMENT_ARRAY_BUFFER, big ? UINT : USHORT, 'SCALAR', idx.length);
  const ibmAcc = blob.accessor(ibm, 0, FLOAT, 'MAT4', nb);
  const imageView = blob.view(tex.png, 0);

  // ---- nodes: 0 = skinned mesh, 1..nb = bones
  const nodes = [{ name: 'Body', mesh: 0, skin: 0 }];
  bones.forEach((b, i) => {
    const p = b.parent == null ? null : boneIndex.get(b.parent);
    const t = p == null ? jw[i] : [jw[i][0] - jw[p][0], jw[i][1] - jw[p][1], jw[i][2] - jw[p][2]];
    nodes.push({ name: b.name, translation: t });
  });
  bones.forEach((b, i) => {
    if (b.parent == null) return;
    const pn = nodes[1 + boneIndex.get(b.parent)];
    (pn.children || (pn.children = [])).push(1 + i);
  });
  const roots = bones.map((b, i) => (b.parent == null ? 1 + i : -1)).filter((i) => i >= 0);
  if (roots.length !== 1) throw new Error(`exportGlb: skeleton needs exactly one root, has ${roots.length}`);
  const hipsNode = roots[0], hipsBone = hipsNode - 1;

  // ---- animations
  const animations = [];
  const tempo = model.tempo || 1;
  const quat = new Float64Array(4 * nb), hips = [0, 0, 0];
  for (const name of Object.keys(model.clips || {}).sort()) {
    const clip = model.clips[name];
    if (!(clip.duration > 0)) throw new Error(`exportGlb: clip "${name}" has no duration`);
    const durS = clip.duration / 1000 / tempo;
    const n = Math.max(1, Math.round(durS * FPS));
    const times = new Float32Array(n + 1);
    const rot = Array.from({ length: nb }, () => new Float32Array(4 * (n + 1)));
    const trn = new Float32Array(3 * (n + 1));
    for (let f = 0; f <= n; f++) {
      times[f] = (f / n) * durS;
      sampleClip(model, clip, (f / n) * clip.duration, quat, hips);
      for (let b = 0; b < nb; b++) {
        rot[b][4 * f] = quat[4 * b]; rot[b][4 * f + 1] = -quat[4 * b + 2]; rot[b][4 * f + 2] = quat[4 * b + 1]; rot[b][4 * f + 3] = quat[4 * b + 3];
      }
      const h = toGltf(hips);
      trn[3 * f] = jw[hipsBone][0] + h[0]; trn[3 * f + 1] = jw[hipsBone][1] + h[1]; trn[3 * f + 2] = jw[hipsBone][2] + h[2];
    }
    const timeAcc = blob.accessor(times, 0, FLOAT, 'SCALAR', n + 1, { min: [times[0]], max: [times[n]] });
    const samplers = [], channels = [];
    for (let b = 0; b < nb; b++) {
      const out = blob.accessor(rot[b], 0, FLOAT, 'VEC4', n + 1);
      channels.push({ sampler: samplers.length, target: { node: 1 + b, path: 'rotation' } });
      samplers.push({ input: timeAcc, interpolation: 'LINEAR', output: out });
    }
    channels.push({ sampler: samplers.length, target: { node: hipsNode, path: 'translation' } });
    samplers.push({ input: timeAcc, interpolation: 'LINEAR', output: blob.accessor(trn, 0, FLOAT, 'VEC3', n + 1) });
    animations.push({ name, channels, samplers, extras: { kestrel: { loop: clip.loop !== false } } });
  }

  // mounts are grid cells in the model; the .glb stores them like the joints (authoring axes, metres from the anchor).
  // anchor (cells) = Hips jointCells - Hips joint / cellM.
  const mounts = {};
  const cm = model.cellM;
  for (const [k, m] of Object.entries(model.mounts || {})) {
    mounts[k] = m.map((v, a) => Math.round((v - (bones[hipsBone].jointCells[a] - bones[hipsBone].joint[a] / cm)) * cm * 1e6) / 1e6);
  }
  const kestrel = stable({ format: 1, matKeys, partMap, mounts, cellM: cm, tempo, recipe });
  const bin = blob.bytes();
  const json = {
    asset: { version: '2.0', generator: 'kestrel-chargen' },
    scene: 0,
    scenes: [{ name: 'Character', nodes: [0, hipsNode] }],
    nodes,
    meshes: [{ name: 'Body', primitives: [{ attributes: meshAttrs, indices, material: 0, mode: 4 }] }],
    skins: [{ name: 'Armature', skeleton: hipsNode, joints: bones.map((_, i) => 1 + i), inverseBindMatrices: ibmAcc }],
    materials: [{ name: 'Palette', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ name: 'palette', bufferView: imageView, mimeType: 'image/png' }],
    accessors: blob.accessors,
    bufferViews: blob.views,
    buffers: [{ byteLength: bin.length }],
    extras: { kestrel },
  };
  if (animations.length) json.animations = animations;

  // ---- GLB container: header, JSON chunk (space padded), BIN chunk (zero padded)
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) { const j2 = new Uint8Array(jsonBytes.length + jpad).fill(0x20); j2.set(jsonBytes); jsonBytes = j2; }
  const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20);
  const bo = 20 + jsonBytes.length;
  dv.setUint32(bo, bin.length, true); dv.setUint32(bo + 4, 0x004e4942, true); out.set(bin, bo + 8);
  return out;
}
