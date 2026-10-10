// @ts-check
// engine/mesh/gltf.js - ME-13a (docs/backlog.md, docs/architecture.md 27.2
// "gltf.js .glb/.gltf (static nodes, materials by name) -> MeshData (phase
// 3)", 27.3 "glTF" paragraph, 27.4 glTF column, 27.13 "do not" list).
// Minimal, from-scratch, static-only glTF/GLB reader: no skinning, no
// animation, no morph targets, no textures - rigid node transforms are
// BAKED into the output vertices, materials are referenced by NAME only
// (the name -> engine-material mapping is a sidecar file, ME-13b's job,
// not this file's).
//
// `loadGltf(buffer, id, opts)` NEVER does file I/O (no fetch, no
// fs.readFile): it parses whatever `buffer` (ArrayBuffer/Uint8Array/string)
// is handed to it. A `.glb` is self-contained (JSON chunk + BIN chunk). A
// plain `.gltf` JSON with an external `.bin` (not a data: URI) cannot be
// resolved by this module alone - the caller (a CLI tool, not engine/)
// reads that file and passes its bytes via `opts.buffers[bufferIndex]`.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (27.15.0) - never gpu/*, game/ or design/. No runtime
// library (27.13 "do not add a runtime library"): everything below is
// hand-rolled.
//
// Reuses MeshData.js's pure helpers (packFlat1, packNormalOct via
// octNormal.js, validateMesh/assertMesh) rather than duplicating that
// packing logic. `StaticMeshBuilder.addQuad` is NOT used here: it bakes
// one shared face normal across all 6 vertices of a quad, which cannot
// express the per-vertex SMOOTHED normals a glTF smoothing group needs (a
// smooth vertex's normal differs from its triangle's flat face normal) -
// so this file assembles the typed arrays itself, in exactly the shape
// `StaticMeshBuilder.build()` produces (same field types/order), and
// validates the result with `assertMesh` before returning it.
import { FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED, KIND_MESH } from '../render/GBuffer.js';
import { MESH_VERSION, AUX_STRIDE, FLAT_STRIDE, AO_NONE, packFlat1, assertMesh } from './MeshData.js';
import { packNormalOct } from '../voxel/octNormal.js';
import { DEG2RAD } from '../core/transform.js';
import { simplifyTriangles } from './simplify.js'; // ME-SIMPLIFY-01

/** @typedef {import('./MeshData.js').MeshData} MeshData */

// KIND_MESH (= 9) lives in engine/render/GBuffer.js (ME-14c1); re-exported here for existing importers.
export { KIND_MESH };

// Top nibble of the glTF planeId (27.4: `(0xE<<28)|(objectId&0xFF)<<20|groupId`)
// - distinguishes it from packPlaneId's structSeq-based walls/planes (top 3
// bits only) and from voxelMesh.js's 0xF tag; same raw-bit-packing
// convention voxelMesh.js uses for its own flat[0].
const TAG_MESH = 0xE;

/**
 * `flat[0]` base for a glTF triangle. `objectId` defaults to 0 here (no
 * draw-time OR exists yet - ME-13a only produces a standalone MeshData, it
 * is not placed by a DrawItem).
 * @param {number} groupId - smoothing-group id (0-based, this mesh only)
 * @param {number} [objectId]
 * @returns {number}
 */
export function meshPlaneIdBase(groupId, objectId = 0) {
  return ((TAG_MESH << 28) | ((objectId & 0xff) << 20) | (groupId & 0xfffff)) >>> 0;
}

// ---------------------------------------------------------------------------
// Small linear-algebra helpers (build time only - may allocate; plain
// column-major 4x4 arrays, D-029 item 10: no gl-matrix, no three.js).
// ---------------------------------------------------------------------------

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Column-major 4x4 multiply: returns a * b (b applied first). */
function mat4Mul(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Quaternion (x,y,z,w) + translation + scale -> column-major 4x4 (glTF TRS order: T * R * S). */
function mat4FromTRS(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const r00 = (1 - (yy + zz)) * s[0], r01 = (xy + wz) * s[0], r02 = (xz - wy) * s[0];
  const r10 = (xy - wz) * s[1], r11 = (1 - (xx + zz)) * s[1], r12 = (yz + wx) * s[1];
  const r20 = (xz + wy) * s[2], r21 = (yz - wx) * s[2], r22 = (1 - (xx + yy)) * s[2];
  return [
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    t[0], t[1], t[2], 1,
  ];
}

/** Local matrix of a glTF node: explicit `matrix` wins, else TRS (defaults identity/[0,0,0,1]/[1,1,1]). */
function nodeLocalMatrix(node) {
  if (Array.isArray(node.matrix)) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  return mat4FromTRS(t, r, s);
}

/** Transforms a point by a column-major 4x4 matrix, writes into `out`. */
function mat4TransformPoint(m, x, y, z, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/**
 * Determinant of a column-major 4x4 matrix's upper-left 3x3 block (col0 =
 * m[0..2], col1 = m[4..6], col2 = m[8..10]). Negative means the node's world
 * transform flips handedness (e.g. Blender's `scale: [-1, 1, 1]` mirror) -
 * ME-13a arch review item 1: triangle winding must be flipped to compensate,
 * or a mirrored mesh renders inside-out.
 * @param {number[]} m
 * @returns {number}
 */
function det3(m) {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  );
}

/** glTF (x,y,z) -> world (x,-z,y) (27.3: Blender export convention, +Y up). Pure rotation (orthonormal), so points and the normals derived from transformed points both use it directly. */
function axisConvert(x, y, z) {
  return [x, -z, y];
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return;
  v[0] /= len; v[1] /= len; v[2] /= len;
}

// ---------------------------------------------------------------------------
// GLB container (header + JSON chunk + optional BIN chunk).
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian

/**
 * Splits a `.glb` ArrayBuffer into its JSON text and binary chunk (if any).
 * @param {ArrayBuffer} ab
 * @param {string} id
 * @returns {{json: string, bin: Uint8Array|null}}
 */
function parseGlbContainer(ab, id) {
  const dv = new DataView(ab);
  if (dv.byteLength < 12) bad(id, `GLB header truncated (${dv.byteLength} bytes)`);
  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) bad(id, `not a GLB container (bad magic 0x${magic.toString(16)})`);
  const version = dv.getUint32(4, true);
  if (version !== 2) bad(id, `unsupported GLB version ${version} (only 2 is supported)`);
  const length = dv.getUint32(8, true);
  if (length > dv.byteLength) bad(id, `GLB length field ${length} exceeds buffer size ${dv.byteLength}`);

  let offset = 12;
  let json = null, bin = null;
  while (offset + 8 <= length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (dataStart + chunkLength > length) bad(id, `GLB chunk at byte ${offset} overruns the container`);
    if (chunkType === 0x4e4f534a) { // 'JSON'
      json = new TextDecoder('utf-8').decode(new Uint8Array(ab, dataStart, chunkLength));
    } else if (chunkType === 0x004e4942) { // 'BIN\0'
      bin = new Uint8Array(ab, dataStart, chunkLength);
    } // unknown chunk types are skipped (forward-compat, nothing we need)
    offset = dataStart + chunkLength;
  }
  if (json === null) bad(id, 'GLB container has no JSON chunk');
  return { json, bin };
}

/** Decodes a `data:...;base64,xxxx` URI into a Uint8Array (`atob` is a global in both browsers and Node >= 16 - no `Buffer` dependency, so this stays portable). */
function decodeDataUri(uri, id, context) {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (!m) bad(id, `${context} has a non-base64 data URI (unsupported)`);
  const binStr = atob(m[1]);
  const out = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i);
  return out;
}

/**
 * Resolves every `json.buffers[]` entry into a Uint8Array: a GLB-embedded
 * buffer (no `uri`) uses `glbBin`; a `data:` URI is decoded in place; any
 * other `uri` (an external `.bin` file) must come from `opts.buffers[i]`
 * (this module never reads a file itself - 27.13).
 * @param {Object} json
 * @param {Uint8Array|null} glbBin
 * @param {Uint8Array[]|undefined} providedBuffers
 * @param {string} id
 * @returns {Uint8Array[]}
 */
function resolveBuffers(json, glbBin, providedBuffers, id) {
  const buffers = json.buffers || [];
  return buffers.map((b, i) => {
    if (b.uri === undefined) {
      if (!glbBin) bad(id, `buffer ${i} has no uri and the container has no BIN chunk`);
      return glbBin;
    }
    if (b.uri.startsWith('data:')) return decodeDataUri(b.uri, id, `buffer ${i}`);
    if (providedBuffers && providedBuffers[i]) return providedBuffers[i];
    bad(
      id,
      `buffer ${i} references external file "${b.uri}" - loadGltf never reads files itself; ` +
      `pass its bytes as opts.buffers[${i}] (the caller/CLI tool reads the .bin, not engine/mesh/gltf.js)`,
    );
  });
}

// ---------------------------------------------------------------------------
// Accessor reading.
// ---------------------------------------------------------------------------

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Reads one accessor into a plain number[][] (one row per element - build
 * time only, allocation is fine). Only FLOAT (5126) is supported for
 * vertex attributes (the exporters this story targets - Blender's glTF
 * export - always use FLOAT for POSITION/NORMAL/TEXCOORD_0); normalized
 * integer accessors would need de-normalization math this story does not
 * implement (DEVIATION, flagged in the handback). Index accessors (UBYTE/
 * USHORT/UINT) pass `allowIndexTypes: true`.
 * @param {Object} json
 * @param {Uint8Array[]} buffers
 * @param {number} accIdx
 * @param {string} id
 * @param {{allowIndexTypes?: boolean}} [opts]
 * @returns {number[][]}
 */
function readAccessor(json, buffers, accIdx, id, opts = {}) {
  const acc = json.accessors && json.accessors[accIdx];
  if (!acc) bad(id, `accessor ${accIdx} does not exist`);
  if (acc.sparse) bad(id, `accessor ${accIdx} uses sparse storage (unsupported)`);
  const numComp = TYPE_COMPONENTS[acc.type];
  if (!numComp) bad(id, `accessor ${accIdx} has unsupported type "${acc.type}"`);
  const compSize = COMPONENT_BYTES[acc.componentType];
  if (!compSize) bad(id, `accessor ${accIdx} has unsupported componentType ${acc.componentType}`);
  const normInt = opts.allowNormalized && acc.normalized === true && (acc.componentType === 5121 || acc.componentType === 5123);
  if (!opts.allowIndexTypes && !normInt && acc.componentType !== 5126) {
    bad(id, `accessor ${accIdx} componentType ${acc.componentType} is not FLOAT (only FLOAT vertex attributes are supported)`);
  }
  if (acc.bufferView === undefined) bad(id, `accessor ${accIdx} has no bufferView (zero-filled accessors are unsupported)`);
  const bv = json.bufferViews[acc.bufferView];
  if (!bv) bad(id, `accessor ${accIdx} references missing bufferView ${acc.bufferView}`);
  const buf = buffers[bv.buffer];
  if (!buf) bad(id, `bufferView ${acc.bufferView} references missing buffer ${bv.buffer}`);
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || numComp * compSize;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const readOne = (byteAt) => {
    switch (acc.componentType) {
      case 5120: return dv.getInt8(byteAt);
      case 5121: return dv.getUint8(byteAt);
      case 5122: return dv.getInt16(byteAt, true);
      case 5123: return dv.getUint16(byteAt, true);
      case 5125: return dv.getUint32(byteAt, true);
      case 5126: return dv.getFloat32(byteAt, true);
      default: bad(id, `unreachable componentType ${acc.componentType}`); return 0;
    }
  };

  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const base = byteOffset + i * stride;
    if (base + numComp * compSize > buf.byteLength) bad(id, `accessor ${accIdx} element ${i} reads past the end of its buffer`);
    const row = new Array(numComp);
    for (let c = 0; c < numComp; c++) row[c] = readOne(base + c * compSize);
    if (normInt) { const d = acc.componentType === 5121 ? 255 : 65535; for (let c = 0; c < numComp; c++) row[c] /= d; }
    out[i] = row;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validator (throws, naming the offending node/primitive - water.js's
// `bad(id, msg)` convention).
// ---------------------------------------------------------------------------

function bad(id, msg) { throw new Error(`glTF ${id}: ${msg}`); }

/** Throws on anything this importer does not support (skinning, animation, morph targets, non-triangle primitives). */
function validateUnsupported(json, id) {
  if (Array.isArray(json.skins) && json.skins.length > 0) bad(id, 'has a "skins" array - skinning is not supported (ME-13a: static meshes only)');
  if (Array.isArray(json.animations) && json.animations.length > 0) bad(id, 'has an "animations" array - animation is not supported (ME-13a: static meshes only)');
  for (const node of json.nodes || []) {
    if (node.skin !== undefined) bad(id, `node "${node.name || '(unnamed)'}" has a "skin" - skinning is not supported`);
    if (Array.isArray(node.weights) && node.weights.length > 0) bad(id, `node "${node.name || '(unnamed)'}" has morph "weights" - morph targets are not supported`);
  }
  for (let mi = 0; mi < (json.meshes || []).length; mi++) {
    const mesh = json.meshes[mi];
    for (let pi = 0; pi < (mesh.primitives || []).length; pi++) {
      const prim = mesh.primitives[pi];
      if (Array.isArray(prim.targets) && prim.targets.length > 0) {
        bad(id, `mesh "${mesh.name || mi}" primitive ${pi} has morph "targets" - morph targets are not supported`);
      }
      if (prim.mode !== undefined && prim.mode !== 4) {
        bad(id, `mesh "${mesh.name || mi}" primitive ${pi} has mode ${prim.mode} - only TRIANGLES (4) is supported`);
      }
      if (prim.attributes === undefined || prim.attributes.POSITION === undefined) {
        bad(id, `mesh "${mesh.name || mi}" primitive ${pi} has no POSITION attribute`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scene-graph walk: bakes every node's world matrix, visits each mesh-bearing node once.
// ---------------------------------------------------------------------------

/**
 * @param {Object} json
 * @param {string} id
 * @returns {{node: Object, nodeIdx: number, world: number[]}[]}
 */
function collectMeshNodes(json, id) {
  const sceneIdx = json.scene !== undefined ? json.scene : 0;
  const scene = (json.scenes || [])[sceneIdx];
  if (!scene) bad(id, `scene ${sceneIdx} does not exist`);
  const roots = scene.nodes || [];
  const out = [];
  const visiting = new Set();

  function walk(nodeIdx, parentWorld) {
    if (visiting.has(nodeIdx)) bad(id, `node ${nodeIdx} participates in a cycle (not a tree)`);
    visiting.add(nodeIdx);
    const node = json.nodes[nodeIdx];
    if (!node) bad(id, `scene references missing node ${nodeIdx}`);
    const world = mat4Mul(parentWorld, nodeLocalMatrix(node));
    if (node.mesh !== undefined) out.push({ node, nodeIdx, world });
    for (const c of node.children || []) walk(c, world);
    visiting.delete(nodeIdx);
  }
  for (const r of roots) walk(r, mat4Identity());
  return out;
}

// ---------------------------------------------------------------------------
// Smoothing groups (27.4 glTF planeId row: "connected, coplanar within 1 cm,
// normals within 5 deg"). Operates per primitive (one call's worth of baked
// triangles); groupId offsets across primitives are applied by the caller.
// ---------------------------------------------------------------------------

const SMOOTH_ANGLE_DEG = 5;
const SMOOTH_ANGLE_COS = Math.cos(SMOOTH_ANGLE_DEG * DEG2RAD);
const SMOOTH_COPLANAR_M = 0.01; // 1 cm

/** 1 mm position bucket key - identifies "the same vertex" across triangles (connectivity), not the 1 cm smoothing tolerance. */
function weldKey(x, y, z) {
  return `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;
}

/**
 * @param {{p0:number[], p1:number[], p2:number[], normal:number[]}[]} tris - already world+axis-converted
 * @param {number} [angleCos] - cos(crease angle); two triangles sharing an edge union into the
 *   same smoothing group only when their face-normal angle is BELOW this (same coplanar-within-1cm
 *   rule either way). Defaults to `SMOOTH_ANGLE_COS` (today's hardcoded 5 deg) - S8-B2-15's `--crease
 *   <deg>` is the only caller that overrides it; omitting it (or passing the default 5 deg) must stay
 *   byte-identical to the pre-S8-B2-15 output (ARCH: "--crease only changes how groups split by angle").
 * @returns {Uint32Array} groupId per triangle (0-based, first-occurrence order)
 */
function computeSmoothGroups(tris, angleCos = SMOOTH_ANGLE_COS) {
  const n = tris.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

  // welded vertex key -> triangle indices touching it, to find shared edges
  // (2 triangles sharing >= 2 welded vertices share an edge, not just a corner).
  /** @type {Map<string, number[]>} */
  const byVertex = new Map();
  for (let t = 0; t < n; t++) {
    for (const p of [tris[t].p0, tris[t].p1, tris[t].p2]) {
      const k = weldKey(p[0], p[1], p[2]);
      let list = byVertex.get(k);
      if (!list) { list = []; byVertex.set(k, list); }
      list.push(t);
    }
  }

  const sharedCount = new Map(); // "a,b" (a<b) -> count of shared welded vertices
  for (const [, list] of byVertex) {
    const uniq = Array.from(new Set(list));
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = Math.min(uniq[i], uniq[j]), b = Math.max(uniq[i], uniq[j]);
        const key = `${a},${b}`;
        sharedCount.set(key, (sharedCount.get(key) || 0) + 1);
      }
    }
  }
  for (const [key, count] of sharedCount) {
    if (count < 2) continue; // only a shared corner, not a shared edge
    const [a, b] = key.split(',').map(Number);
    const na = tris[a].normal, nb = tris[b].normal;
    const cosAngle = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
    if (cosAngle < angleCos) continue;
    // Plane offset: signed distance from b's centroid to a's plane.
    const cbx = (tris[b].p0[0] + tris[b].p1[0] + tris[b].p2[0]) / 3;
    const cby = (tris[b].p0[1] + tris[b].p1[1] + tris[b].p2[1]) / 3;
    const cbz = (tris[b].p0[2] + tris[b].p1[2] + tris[b].p2[2]) / 3;
    const dx = cbx - tris[a].p0[0], dy = cby - tris[a].p0[1], dz = cbz - tris[a].p0[2];
    const dist = Math.abs(dx * na[0] + dy * na[1] + dz * na[2]);
    if (dist > SMOOTH_COPLANAR_M) continue;
    union(a, b);
  }

  // Remap root ids to dense 0-based ids, first-occurrence order (determinism).
  const remap = new Map();
  const groupId = new Uint32Array(n);
  for (let t = 0; t < n; t++) {
    const root = find(t);
    let g = remap.get(root);
    if (g === undefined) { g = remap.size; remap.set(root, g); }
    groupId[t] = g;
  }
  return groupId;
}

/**
 * Per-vertex smooth normal: average of the face normals of every triangle
 * in the SAME smoothing group that touches that exact (welded) vertex
 * position. A vertex touched by only one same-group triangle keeps that
 * triangle's own flat face normal (average of one item).
 * @param {{p0:number[],p1:number[],p2:number[],normal:number[]}[]} tris
 * @param {Uint32Array} groupId
 * @returns {number[][][]} one [nx,ny,nz] per (triangle, corner)
 */
function computeVertexNormals(tris, groupId) {
  const n = tris.length;
  /** @type {Map<string, number[]>} */
  const byVertexGroup = new Map(); // "weldKey|group" -> running [sx,sy,sz,count]
  const keysPerCorner = new Array(n);
  for (let t = 0; t < n; t++) {
    const pts = [tris[t].p0, tris[t].p1, tris[t].p2];
    const keys = new Array(3);
    for (let c = 0; c < 3; c++) {
      const p = pts[c];
      const key = `${weldKey(p[0], p[1], p[2])}|${groupId[t]}`;
      keys[c] = key;
      let acc = byVertexGroup.get(key);
      if (!acc) { acc = [0, 0, 0, 0]; byVertexGroup.set(key, acc); }
      acc[0] += tris[t].normal[0]; acc[1] += tris[t].normal[1]; acc[2] += tris[t].normal[2]; acc[3] += 1;
    }
    keysPerCorner[t] = keys;
  }
  const out = new Array(n);
  for (let t = 0; t < n; t++) {
    const row = new Array(3);
    for (let c = 0; c < 3; c++) {
      const acc = byVertexGroup.get(keysPerCorner[t][c]);
      const v = [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]];
      normalize3(v);
      row[c] = v;
    }
    out[t] = row;
  }
  return out;
}

/** Dominant world axis of a face normal (27.4: "dominant axis; 7 when no axis dominates (max abs(n_i) < 0.9)"). */
function dominantFace(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const m = Math.max(ax, ay, az);
  if (m < 0.9) return FACE_PACKED;
  if (ax === m) return nx >= 0 ? FACE_E : FACE_W;
  if (ay === m) return ny >= 0 ? FACE_N : FACE_S;
  return nz >= 0 ? FACE_U : FACE_D;
}

/** Planar UV (metres) from a triangle's own dominant-axis tangent plane (27.3/27.4: "planar per group along the group's tangent axes"), same per-face convention voxelMesh.js uses for its quads. */
function planarUv(face, x, y, z) {
  switch (face) {
    case FACE_W: case FACE_E: return [y, z];
    case FACE_N: case FACE_S: return [x, z];
    case FACE_U: case FACE_D: return [x, y];
    default: return [x, y];
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Parses a static `.glb`/`.gltf` buffer into one `MeshData` (27.3, 27.4
 * glTF column). Node transforms are baked into the vertices; there is no
 * runtime scene graph. Materials are captured by NAME only, in `matKeys`
 * (first-use order) - `matsResolved` stays `false`; mapping those names to
 * engine materials is a sidecar step (ME-13b), not this function's job.
 * @param {ArrayBuffer|Uint8Array|string} buffer
 * @param {string} id - MeshData id, e.g. `gltf:<file>/<localId>`
 * @param {{alpha?: boolean, textures?: Record<string,{tex:string,w:number,h:number,alpha:Uint8Array}>, opaque?: string[], warnings?: string[], buffers?: Uint8Array[], uv?: 'planar'|'source', simplifyRatio?: number, crease?: number, triMat?: (uv0:number[],uv1:number[],uv2:number[],matName:string)=>string}} [opts] - `triMat`: per-triangle material name from the source UVs (MESH-UVMAP-01); `uv`: 'planar' (default, world-metre planar UVs, 27.4; glTF TEXCOORD_0 are colour-atlas values, not metres) or 'source' (keep TEXCOORD_0). `crease`: S8-B2-15 `--crease <deg>`
 *   (default off/`undefined` = today's hardcoded 5 deg smoothing-group angle, byte-identical); when
 *   given, triangles sharing an edge weld into one smoothing group (averaged normals) whenever their
 *   face-normal angle is below this, instead of 5 deg - triangle count and vertex welding (`weldKey`)
 *   are unchanged, only which groups the already-welded vertices fall into. `buffers[i]`: bytes for
 *   `json.buffers[i]` when its `uri` is an external file (not a data: URI
 *   and not GLB-embedded) - this module never reads a file itself.
 * ALPHA-01a (37.17): `opts.alpha = true` turns every `alphaMode: 'MASK'` material into a masked range (`mask: {tex, cutoff}`, cutoff = alphaCutoff
 *   or 0.5) and fills `uvMask` with the source TEXCOORD_0 of those triangles. `opts.textures[materialName]` = the downsampled 8-bit alpha plane
 *   (+ its mask id `tex`; the tool reads the PNG, never this module). `opts.opaque` = material names forced opaque. Auto-opaque rule: a MASK
 *   material whose texels (inside the UV bbox of its own triangles) are all >= cutoffByte is imported opaque, with a line in `opts.warnings`.
 *   Masked ranges are ordered after every opaque range (triangles reordered to match, stable); masked primitives are never simplified.
 * @returns {MeshData}
 */
export function loadGltf(buffer, id, opts = {}) {
  let ab;
  if (typeof buffer === 'string') {
    ab = new TextEncoder().encode(buffer).buffer;
  } else if (buffer instanceof ArrayBuffer) {
    ab = buffer;
  } else if (buffer instanceof Uint8Array) {
    ab = /** @type {ArrayBuffer} */ (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  } else {
    bad(id, 'buffer must be an ArrayBuffer, Uint8Array or string');
    return /** @type {never} */ (undefined);
  }

  const dv0 = new DataView(ab);
  let jsonText, glbBin = null;
  if (ab.byteLength >= 4 && dv0.getUint32(0, true) === GLB_MAGIC) {
    const container = parseGlbContainer(ab, id);
    jsonText = container.json;
    glbBin = container.bin;
  } else {
    jsonText = new TextDecoder('utf-8').decode(new Uint8Array(ab));
  }

  let json;
  try {
    json = JSON.parse(jsonText);
  } catch (e) {
    bad(id, `JSON parse failed: ${e.message}`);
  }
  if (!json.asset || typeof json.asset.version !== 'string') bad(id, 'missing "asset.version"');
  if (!json.asset.version.startsWith('2')) bad(id, `unsupported glTF version "${json.asset.version}" (only 2.x is supported)`);

  validateUnsupported(json, id);

  const buffers = resolveBuffers(json, glbBin, opts.buffers, id);
  const meshNodes = collectMeshNodes(json, id);
  if (meshNodes.length === 0) bad(id, 'has no mesh-bearing nodes reachable from the default scene');

  // ALPHA-01a: which materials are masked (decided once per material, after seeing the UV bbox of all its triangles)
  /** @type {Map<number, {tex:string, cutoff:number}|null>} */
  const maskOf = new Map();
  if (opts.alpha) resolveMasks(json, meshNodes, buffers, opts, maskOf, id);

  // --- Pass 1: bake every primitive's triangles (world+axis-converted),
  // flat face normal, material name, source uv ----------------------------
  /** @typedef {{p0:number[],p1:number[],p2:number[],normal:number[],matName:string,uv0:number[]|null,uv1:number[]|null,uv2:number[]|null}} BakedTri */
  /** @type {BakedTri[]} */
  const allTris = [];
  /** @type {{part: string, triStart: number, triCount: number, mask?: {tex:string, cutoff:number}}[]} */
  const primRanges = [];
  const tmp = [0, 0, 0];

  for (const { node, nodeIdx, world } of meshNodes) {
    const mesh = json.meshes[node.mesh];
    const mirrored = det3(world) < 0; // per-node constant, computed once (not per triangle)
    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const prim = mesh.primitives[pi];
      const posRows = readAccessor(json, buffers, prim.attributes.POSITION, id);
      const uvRows = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, buffers, prim.attributes.TEXCOORD_0, id) : null;
      let idxList = null;
      if (prim.indices !== undefined) {
        idxList = readAccessor(json, buffers, prim.indices, id, { allowIndexTypes: true }).map((r) => r[0]);
      }
      const vertCount = posRows.length;
      const triIdx = idxList || Array.from({ length: vertCount }, (_, i) => i);
      if (triIdx.length % 3 !== 0) bad(id, `mesh "${mesh.name || node.mesh}" primitive ${pi} vertex/index count ${triIdx.length} is not a multiple of 3`);

      const matName = prim.material !== undefined
        ? (json.materials && json.materials[prim.material] && json.materials[prim.material].name) || `material_${prim.material}`
        : 'default';

      let bakedPos = new Array(vertCount);
      for (let v = 0; v < vertCount; v++) {
        mat4TransformPoint(world, posRows[v][0], posRows[v][1], posRows[v][2], tmp);
        bakedPos[v] = axisConvert(tmp[0], tmp[1], tmp[2]);
      }
      // MESH-UVMAP-01: `opts.triMat(uv0, uv1, uv2, matName)` (needs TEXCOORD_0) names a material per triangle; the primitive is split
      // into one group per name (first-appearance order) and each group is simplified on its own, so keys are never merged.
      const primMask = (opts.alpha && prim.material !== undefined && maskOf.get(prim.material)) || null;
      if (primMask && !uvRows) bad(id, `masked material "${matName}" needs TEXCOORD_0`);
      /** @type {{matName:string, idx:number[]}[]} */
      const groups = [];
      if (opts.triMat && uvRows) {
        const byName = new Map();
        for (let t = 0; t < triIdx.length / 3; t++) {
          const u0 = uvRows[triIdx[t * 3]], u1 = uvRows[triIdx[t * 3 + 1]], u2 = uvRows[triIdx[t * 3 + 2]];
          const nm = opts.triMat(u0, u1, u2, matName);
          let g = byName.get(nm);
          if (!g) { g = { matName: nm, idx: [] }; byName.set(nm, g); groups.push(g); }
          g.idx.push(triIdx[t * 3], triIdx[t * 3 + 1], triIdx[t * 3 + 2]);
        }
      } else groups.push({ matName, idx: triIdx });
      for (const grp of groups) {
        const gIdx = grp.idx;
        let triIdxUse = gIdx;
        let gPos = bakedPos;
        // ME-SIMPLIFY-01: `opts.simplifyRatio` (0 < r < 1) reduces each primitive to r x its triangles (quadric edge collapse,
        // positions welded; planar UVs and smoothing groups are derived afterwards, so source UVs cannot be kept).
        if (opts.simplifyRatio > 0 && opts.simplifyRatio < 1 && !primMask) {
          if (opts.uv === 'source') bad(id, 'simplifyRatio cannot keep source UVs (use planar)');
          const target = Math.max(4, Math.round((gIdx.length / 3) * opts.simplifyRatio));
          const red = simplifyTriangles(bakedPos, gIdx, target);
          gPos = red.positions; triIdxUse = red.idx;
        }
        const triStart = allTris.length;
        const triCount = triIdxUse.length / 3;
        for (let t = 0; t < triCount; t++) {
          let ia = triIdxUse[t * 3], ib = triIdxUse[t * 3 + 1], ic = triIdxUse[t * 3 + 2];
          if (mirrored) { const tmpI = ib; ib = ic; ic = tmpI; } // compensate the handedness flip
          const p0 = gPos[ia], p1 = gPos[ib], p2 = gPos[ic];
          // Flat face normal from the baked (world+axis-converted) triangle - geometry already carries the node
          // transform + axis swap, so a plain cross product here needs no separate normal-matrix step.
          const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
          const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
          const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
          normalize3(normal);
          const keepUv = uvRows && triIdxUse === gIdx;
          allTris.push({
            p0, p1, p2, normal, matName: grp.matName,
            uv0: keepUv ? uvRows[ia] : null, uv1: keepUv ? uvRows[ib] : null, uv2: keepUv ? uvRows[ic] : null,
          });
        }
        const base = node.name || `node${nodeIdx}`;
        primRanges.push({ part: groups.length > 1 ? `${base}#${pi}:${grp.matName}` : `${base}#${pi}`, triStart, triCount, ...(primMask ? { mask: primMask } : {}) });
      }
    }
  }

  if (primRanges.some((r) => r.mask)) {
    const o = orderMaskedLast(allTris, primRanges);
    return buildMeshFromTris(o.tris, o.ranges, id, opts);
  }
  return buildMeshFromTris(allTris, primRanges, id, opts);
}

/** Stable reorder: opaque ranges first, then masked ranges grouped by mask texture + cutoff (first-appearance order). Triangles move with their range. */
function orderMaskedLast(allTris, primRanges) {
  const maskKey = (r) => `${r.mask.tex}@${r.mask.cutoff}`;
  const order = [...primRanges.filter((r) => !r.mask)];
  const seen = [];
  for (const r of primRanges) if (r.mask && !seen.includes(maskKey(r))) seen.push(maskKey(r));
  for (const k of seen) for (const r of primRanges) if (r.mask && maskKey(r) === k) order.push(r);
  const tris = [];
  const ranges = order.map((r) => {
    const triStart = tris.length;
    for (let t = 0; t < r.triCount; t++) tris.push(allTris[r.triStart + t]);
    return { ...r, triStart };
  });
  return { tris, ranges };
}

/**
 * ALPHA-01a: fills `maskOf` (material index -> {tex, cutoff} | null) for every MASK material that is used. Throws if `opts.textures[name]` is missing.
 * Auto-opaque rule (37.17): no texel < cutoffByte inside the UV bbox of the material's own triangles -> opaque + warning.
 */
function resolveMasks(json, meshNodes, buffers, opts, maskOf, id) {
  const mats = json.materials || [];
  const bbox = new Map(); // material index -> [umin, vmin, umax, vmax]
  for (const { node } of meshNodes) {
    for (const prim of json.meshes[node.mesh].primitives) {
      const mi = prim.material;
      if (mi === undefined || !mats[mi] || mats[mi].alphaMode !== 'MASK' || prim.attributes.TEXCOORD_0 === undefined) continue;
      const rows = readAccessor(json, buffers, prim.attributes.TEXCOORD_0, id);
      let idx = null;
      if (prim.indices !== undefined) idx = readAccessor(json, buffers, prim.indices, id, { allowIndexTypes: true }).map((r) => r[0]);
      const use = idx || rows.map((_, i) => i);
      let b = bbox.get(mi);
      if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; bbox.set(mi, b); }
      for (const i of use) {
        const r = rows[i];
        if (r[0] < b[0]) b[0] = r[0];
        if (r[1] < b[1]) b[1] = r[1];
        if (r[0] > b[2]) b[2] = r[0];
        if (r[1] > b[3]) b[3] = r[1];
      }
    }
  }
  const forced = new Set(opts.opaque || []);
  for (const [mi, b] of bbox) {
    const name = mats[mi].name || `material_${mi}`;
    if (forced.has(name)) { maskOf.set(mi, null); continue; }
    const t = opts.textures && opts.textures[name];
    if (!t) bad(id, `masked material "${name}" needs opts.textures["${name}"] = {tex, w, h, alpha} (or force it opaque with opts.opaque)`);
    const cutoff = typeof mats[mi].alphaCutoff === 'number' ? Math.round(mats[mi].alphaCutoff * 1e5) / 1e5 : 0.5; // f32 in the file: 1e-5 like the other floats
    if (!(cutoff > 0 && cutoff < 1)) bad(id, `material "${name}" alphaCutoff ${cutoff} must be in (0,1)`);
    const cutByte = Math.round(cutoff * 255);
    if (texelsAllOpaque(t, b, cutByte)) {
      maskOf.set(mi, null);
      if (opts.warnings) opts.warnings.push(`material "${name}" is alphaMode MASK but has no texel < ${cutByte} in its UV region: imported opaque`);
    } else maskOf.set(mi, { tex: t.tex, cutoff });
  }
}

/** True when every texel covered by the UV bbox (wrapping, repeat) is >= cutByte. */
function texelsAllOpaque(t, b, cutByte) {
  const span = (lo, hi, n) => {
    const a = Math.floor(lo * n), z = Math.floor(hi * n);
    if (z - a + 1 >= n) return null; // whole axis
    const out = [];
    for (let i = a; i <= z; i++) out.push(((i % n) + n) % n);
    return out;
  };
  const xs = span(b[0], b[2], t.w), ys = span(b[1], b[3], t.h);
  const nx = xs ? xs.length : t.w, ny = ys ? ys.length : t.h;
  for (let j = 0; j < ny; j++) {
    const y = ys ? ys[j] : j;
    for (let i = 0; i < nx; i++) if (t.alpha[y * t.w + (xs ? xs[i] : i)] < cutByte) return false;
  }
  return true;
}

/**
 * Shared back end of the static-mesh importers (glTF here, Collada in tools/dae-import.mjs): baked triangles -> MeshData.
 * Smoothing groups per primitive range, per-vertex normals, planar (or source) UVs, typed arrays, assertMesh.
 * @param {{p0:number[],p1:number[],p2:number[],normal:number[],matName:string,uv0:number[]|null,uv1:number[]|null,uv2:number[]|null}[]} allTris
 *   world-space, axis-converted, winding already fixed, `normal` = unit flat face normal
 * @param {{part: string, triStart: number, triCount: number, mask?: {tex: string, cutoff: number}}[]} primRanges
 * @param {string} id
 * @param {{uv?: 'planar'|'source', crease?: number}} [opts] - `crease`: S8-B2-15 `--crease <deg>`
 *   (default off = `undefined`, keeps today's hardcoded 5 deg threshold byte-identical); when set,
 *   overrides the smoothing-group angle test (coplanar-within-1cm rule unchanged either way).
 * @returns {MeshData}
 */
export function buildMeshFromTris(allTris, primRanges, id, opts = {}) {
  const angleCos = typeof opts.crease === 'number' ? Math.cos(opts.crease * DEG2RAD) : SMOOTH_ANGLE_COS;
  // --- Pass 2: smoothing groups (per primitive, then offset to a mesh-global id) --
  const groupIdAll = new Uint32Array(allTris.length);
  let groupOffset = 0;
  for (const range of primRanges) {
    const slice = allTris.slice(range.triStart, range.triStart + range.triCount);
    const g = computeSmoothGroups(slice, angleCos);
    let maxG = -1;
    for (let i = 0; i < g.length; i++) {
      groupIdAll[range.triStart + i] = g[i] + groupOffset;
      if (g[i] > maxG) maxG = g[i];
    }
    groupOffset += maxG + 1;
  }
  const vertexNormalsAll = computeVertexNormals(allTris, groupIdAll);

  // --- Pass 3: assemble the typed arrays directly (StaticMeshBuilder's
  // addQuad bakes one shared normal per quad - it cannot express per-vertex
  // smoothed normals, so this mirrors its build() output shape by hand,
  // reusing packFlat1/packNormalOct/MESH_VERSION/AUX_STRIDE/FLAT_STRIDE). --
  const triCount = allTris.length;
  const V = triCount * 3;
  const pos = new Float32Array(V * 3);
  const uv = new Float32Array(V * 2);
  const nrm = new Uint32Array(V);
  const flat = new Uint32Array(V * FLAT_STRIDE);
  const aux = new Float32Array(V * AUX_STRIDE);
  const matIndex = new Map();
  const matKeys = [];
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  /** @type {import("./MeshData.js").MeshRange[]} */
  const ranges = primRanges.map((r) => (r.mask ? { start: r.triStart, count: r.triCount, part: r.part, mask: { tex: r.mask.tex, cutoff: r.mask.cutoff } } : { start: r.triStart, count: r.triCount, part: r.part }));
  // ALPHA-01a: uvMask (source TEXCOORD_0) only when some range is masked; zeros on the opaque triangles
  const uvMask = ranges.some((r) => r.mask) ? new Float32Array(V * 2) : null;
  if (uvMask) {
    for (const r of ranges) {
      if (!r.mask) continue;
      for (let t = r.start; t < r.start + r.count; t++) {
        const tri = allTris[t];
        if (!tri.uv0) throw new Error(`glTF ${id}: masked range "${r.part}" has a triangle without TEXCOORD_0`);
        const src = [tri.uv0, tri.uv1, tri.uv2];
        for (let c = 0; c < 3; c++) { uvMask[(t * 3 + c) * 2] = src[c][0]; uvMask[(t * 3 + c) * 2 + 1] = src[c][1]; }
      }
    }
  }

  for (let t = 0; t < triCount; t++) {
    const tri = allTris[t];
    const face = dominantFace(tri.normal[0], tri.normal[1], tri.normal[2]);
    let mi = matIndex.get(tri.matName);
    if (mi === undefined) { mi = matKeys.length; matKeys.push(tri.matName); matIndex.set(tri.matName, mi); }
    const flat0 = meshPlaneIdBase(groupIdAll[t]);
    const flat1 = packFlat1(KIND_MESH, face, mi);
    const vn = vertexNormalsAll[t];
    const pts = [tri.p0, tri.p1, tri.p2];
    const srcUv = (opts.uv === 'source' && tri.uv0) ? [tri.uv0, tri.uv1, tri.uv2] : null;

    for (let c = 0; c < 3; c++) {
      const v = t * 3 + c;
      const p = pts[c];
      pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
      const uvc = srcUv ? srcUv[c] : planarUv(face, p[0], p[1], p[2]);
      uv[v * 2] = uvc[0]; uv[v * 2 + 1] = uvc[1];
      nrm[v] = packNormalOct(vn[c][0], vn[c][1], vn[c][2]);
      flat[v * FLAT_STRIDE] = flat0;
      flat[v * FLAT_STRIDE + 1] = flat1;
      for (let a = 0; a < AUX_STRIDE; a++) aux[v * AUX_STRIDE + a] = a === 1 ? AO_NONE : 0;
      if (p[0] < bbox[0]) bbox[0] = p[0];
      if (p[1] < bbox[1]) bbox[1] = p[1];
      if (p[2] < bbox[2]) bbox[2] = p[2];
      if (p[0] > bbox[3]) bbox[3] = p[0];
      if (p[1] > bbox[4]) bbox[4] = p[1];
      if (p[2] > bbox[5]) bbox[5] = p[2];
    }
  }
  if (triCount === 0) { bbox[0] = bbox[1] = bbox[2] = bbox[3] = bbox[4] = bbox[5] = 0; }

  /** @type {MeshData} */
  const mesh = {
    version: MESH_VERSION,
    id,
    layout: 'static',
    pos, uv, ...(uvMask ? { uvMask } : {}), nrm, flat, aux,
    idx: null,
    triCount,
    bbox: Float64Array.from(bbox),
    ranges: ranges.length ? ranges : [{ start: 0, count: triCount }],
    matKeys,
    matsResolved: false,
    meshVersion: 1,
  };
  assertMesh(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// RIG-01: rigid-skin + animation reader (docs/architecture.md 38.x item 5).
// Load-time only. Output is in OUR axes (axisConvert applied to positions,
// translations, quaternions, inverse bind matrices, scales).
// ---------------------------------------------------------------------------

// RIG-02a (architecture.md 38.32 item 6): the rigged reader is the exact inverse of tools/export/gltfWrite.js, whose
// map authoring (x,y,z) -> glTF (-x, z, -y) is a REFLECTION. So glTF (X,Y,Z) -> ours (-X, -Z, Y), the quaternion
// (x,y,z,w)_gltf -> (x, z, -y, w) and triangle winding is flipped. The static loadGltf map (axisConvert) is untouched.
function rigPoint(x, y, z) { return [-x, -z, y]; }
function quatConvert(x, y, z, w) { return [x, z, -y, w]; }

/** M' = C M C^-1 for a column-major 4x4 (C = axisConvert as a matrix). */
function mat4ConvertBasis(m) {
  const C = [-1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // glTF -> ours (column-major)
  const Ci = [-1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
  return mat4Mul(mat4Mul(C, m), Ci);
}

function slerp(a, b, t, out, o) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let s = 1;
  if (d < 0) { d = -d; s = -1; }
  let k0, k1;
  if (d > 0.9995) { k0 = 1 - t; k1 = t * s; } else {
    const th = Math.acos(d), sn = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / sn; k1 = Math.sin(t * th) / sn * s;
  }
  const x = a[0] * k0 + b[0] * k1, y = a[1] * k0 + b[1] * k1, z = a[2] * k0 + b[2] * k1, w = a[3] * k0 + b[3] * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l; out[o + 3] = w / l;
}

/**
 * Samples a clip at time `t` (clamped to [0,duration]; STEP holds the
 * previous key, LINEAR lerps / slerps). Bones without a channel keep rest.
 * @param {Object} model RiggedModel
 * @param {Object} clip  one of model.clips
 * @param {number} t
 * @returns {{t: Float32Array, r: Float32Array, s: Float32Array}} per-bone local TRS (3n, 4n, 3n)
 */
export function sampleRiggedClip(model, clip, t) {
  const n = model.bones.length;
  const out = { t: new Float32Array(n * 3), r: new Float32Array(n * 4), s: new Float32Array(n * 3) };
  for (let b = 0; b < n; b++) {
    const rest = model.bones[b].rest;
    out.t.set(rest.t, b * 3); out.r.set(rest.r, b * 4); out.s.set(rest.s, b * 3);
  }
  const tt = Math.min(Math.max(t, 0), clip.duration);
  for (const ch of clip.channels) {
    const times = ch.times, comps = ch.path === 'rotation' ? 4 : 3;
    const dst = ch.path === 'translation' ? out.t : ch.path === 'rotation' ? out.r : out.s;
    let i = 0;
    while (i + 1 < times.length && times[i + 1] <= tt) i++;
    const v = ch.values, o = ch.bone * comps;
    const last = i + 1 >= times.length;
    if (ch.interpolation === 'STEP' || last || tt <= times[0]) {
      for (let c = 0; c < comps; c++) dst[o + c] = v[i * comps + c];
      continue;
    }
    const f = (tt - times[i]) / (times[i + 1] - times[i]);
    if (comps === 4) {
      slerp(v.subarray(i * 4, i * 4 + 4), v.subarray(i * 4 + 4, i * 4 + 8), f, dst, o);
    } else {
      for (let c = 0; c < 3; c++) dst[o + c] = v[i * 3 + c] * (1 - f) + v[(i + 1) * 3 + c] * f;
    }
  }
  return out;
}

/**
 * Reads a rigid-skinned, animated .glb (or .gltf JSON / ArrayBuffer / Uint8Array).
 * Accepts JOINTS_0/WEIGHTS_0 only when each vertex has one weight of 1 (within 1e-3);
 * anything else (smooth weights, CUBICSPLINE, morph weights, several skins) throws.
 * @param {ArrayBuffer|Uint8Array|string} bytes
 * @param {string} [id]
 * @param {{buffers?: Uint8Array[]}} [opts]
 * @returns {{
 *   bones: {name:string, parent:number, node:number, rest:{t:number[],r:number[],s:number[]}, ibm:number[]}[],
 *   mesh: {positions:Float32Array, normals:Float32Array|null, uvs:Float32Array|null, indices:Uint32Array, boneIndex:Uint8Array, materials:number[]},
 *   clips: {name:string, duration:number, loop:boolean, channels:{bone:number, path:string, interpolation:string, times:Float32Array, values:Float32Array}[]}[],
 *   extras: Object|null }} bone parent is an index into bones (-1 root); boneIndex is per vertex.
 */
export function readRiggedGlb(bytes, id = 'rigged', opts = {}) {
  let ab;
  if (typeof bytes === 'string') ab = new TextEncoder().encode(bytes).buffer;
  else if (bytes instanceof ArrayBuffer) ab = bytes;
  else if (bytes instanceof Uint8Array) ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  else bad(id, 'buffer must be an ArrayBuffer, Uint8Array or string');

  let jsonText, glbBin = null;
  if (ab.byteLength >= 4 && new DataView(ab).getUint32(0, true) === GLB_MAGIC) {
    const c = parseGlbContainer(ab, id);
    jsonText = c.json; glbBin = c.bin;
  } else jsonText = new TextDecoder('utf-8').decode(new Uint8Array(ab));
  let json;
  try { json = JSON.parse(jsonText); } catch (e) { bad(id, `JSON parse failed: ${e.message}`); }
  const buffers = resolveBuffers(json, glbBin, opts.buffers, id);

  const skins = json.skins || [];
  if (skins.length !== 1) bad(id, `expected exactly one skin, found ${skins.length}`);
  const skin = skins[0];
  const joints = skin.joints || [];
  if (joints.length === 0) bad(id, 'skin has no joints');
  if (joints.length > 255) bad(id, `skin has ${joints.length} joints (max 255, boneIndex is a byte)`);
  const nodes = json.nodes || [];
  const jointOf = new Map(joints.map((n, i) => [n, i]));

  // Parent per node from the children lists, then per bone (nearest joint ancestor).
  const nodeParent = new Array(nodes.length).fill(-1);
  nodes.forEach((nd, i) => (nd.children || []).forEach((c) => { nodeParent[c] = i; }));
  const ibmRaw = skin.inverseBindMatrices !== undefined ? readAccessor(json, buffers, skin.inverseBindMatrices, id) : null;
  const bones = joints.map((nodeIdx, bi) => {
    const nd = nodes[nodeIdx];
    if (!nd) bad(id, `joint ${bi} references missing node ${nodeIdx}`);
    if (Array.isArray(nd.matrix)) bad(id, `joint node "${nd.name || nodeIdx}" uses a matrix; use TRS`);
    let p = nodeParent[nodeIdx];
    while (p !== -1 && !jointOf.has(p)) p = nodeParent[p];
    const t = nd.translation || [0, 0, 0], r = nd.rotation || [0, 0, 0, 1], s = nd.scale || [1, 1, 1];
    return {
      name: nd.name || `bone${bi}`,
      parent: p === -1 ? -1 : jointOf.get(p),
      node: nodeIdx,
      rest: { t: rigPoint(t[0], t[1], t[2]), r: quatConvert(r[0], r[1], r[2], r[3]), s: [s[0], s[2], s[1]] },
      ibm: ibmRaw ? mat4ConvertBasis(ibmRaw[bi]) : mat4Identity(),
    };
  });

  // Mesh: every primitive of every node that uses the skin (positions are in skin/bind space).
  const pos = [], nrm = [], uv = [], idx = [], boneIdx = [], mats = [];
  let hasN = true, hasUv = true;
  nodes.forEach((nd, ni) => {
    if (nd.skin === undefined) return;
    if (nd.skin !== 0) bad(id, `node "${nd.name || ni}" uses skin ${nd.skin}`);
    const mesh = json.meshes[nd.mesh];
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) bad(id, `mesh "${mesh.name || nd.mesh}" has mode ${prim.mode} - only TRIANGLES`);
      if (Array.isArray(prim.targets) && prim.targets.length) bad(id, 'morph targets are not supported');
      const a = prim.attributes;
      if (a.POSITION === undefined) bad(id, 'primitive has no POSITION');
      if (a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) bad(id, 'skinned primitive lacks JOINTS_0/WEIGHTS_0');
      const base = pos.length;
      const P = readAccessor(json, buffers, a.POSITION, id);
      const J = readAccessor(json, buffers, a.JOINTS_0, id, { allowIndexTypes: true });
      const W = readAccessor(json, buffers, a.WEIGHTS_0, id, { allowNormalized: true });
      for (let v = 0; v < P.length; v++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (W[v][k] > W[v][best]) best = k;
        let others = 0;
        for (let k = 0; k < 4; k++) if (k !== best) others += Math.abs(W[v][k]);
        if (Math.abs(W[v][best] - 1) > 1e-3 || others > 1e-3) {
          bad(id, `non-rigid skin weights at vertex ${v} (weights ${W[v].map((x) => +x.toFixed(4)).join(',')}); only one weight of 1 per vertex is supported`);
        }
        const j = J[v][best];
        if (j >= joints.length) bad(id, `vertex ${v} joint index ${j} out of range`);
        boneIdx.push(j);
        pos.push(rigPoint(P[v][0], P[v][1], P[v][2]));
      }
      if (a.NORMAL !== undefined) readAccessor(json, buffers, a.NORMAL, id).forEach((n) => nrm.push(rigPoint(n[0], n[1], n[2])));
      else hasN = false;
      if (a.TEXCOORD_0 !== undefined) readAccessor(json, buffers, a.TEXCOORD_0, id).forEach((u) => uv.push(u));
      else hasUv = false;
      const before = idx.length;
      if (prim.indices !== undefined) readAccessor(json, buffers, prim.indices, id, { allowIndexTypes: true }).forEach((i) => idx.push(i[0] + base));
      else for (let v = 0; v < P.length; v++) idx.push(base + v);
      for (let k = before; k + 2 < idx.length; k += 3) { const t1 = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t1; } // reflection: flip winding
      for (let k = 0; k < (idx.length - before) / 3; k++) mats.push(prim.material === undefined ? -1 : prim.material);
    }
  });
  if (pos.length === 0) bad(id, 'no skinned mesh primitives found');

  // Animations.
  const clips = (json.animations || []).map((an, ai) => {
    let duration = 0;
    const channels = an.channels.map((ch) => {
      const tgt = ch.target;
      if (!['translation', 'rotation', 'scale'].includes(tgt.path)) bad(id, `animation "${an.name || ai}" targets unsupported path "${tgt.path}"`);
      if (!jointOf.has(tgt.node)) bad(id, `animation "${an.name || ai}" targets non-joint node ${tgt.node}`);
      const smp = an.samplers[ch.sampler];
      const interpolation = smp.interpolation || 'LINEAR';
      if (interpolation !== 'LINEAR' && interpolation !== 'STEP') bad(id, `animation "${an.name || ai}" uses ${interpolation} (only LINEAR/STEP)`);
      const times = Float32Array.from(readAccessor(json, buffers, smp.input, id), (r) => r[0]);
      const raw = readAccessor(json, buffers, smp.output, id);
      if (raw.length !== times.length) bad(id, `animation "${an.name || ai}" sampler output/input length mismatch`);
      const comps = tgt.path === 'rotation' ? 4 : 3;
      const values = new Float32Array(raw.length * comps);
      raw.forEach((r, i) => {
        const c = tgt.path === 'translation' ? rigPoint(r[0], r[1], r[2])
          : tgt.path === 'rotation' ? quatConvert(r[0], r[1], r[2], r[3]) : [r[0], r[2], r[1]];
        values.set(c, i * comps);
      });
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
      return { bone: jointOf.get(tgt.node), path: tgt.path, interpolation, times, values };
    });
    const kx = an.extras && an.extras.kestrel;
    return { name: an.name || `clip${ai}`, duration, loop: !(kx && kx.loop === false), channels };
  });

  const flat = (rows, k) => { const f = new Float32Array(rows.length * k); rows.forEach((r, i) => f.set(r.slice(0, k), i * k)); return f; };
  return {
    bones,
    mesh: {
      positions: flat(pos, 3), normals: hasN ? flat(nrm, 3) : null, uvs: hasUv ? flat(uv, 2) : null,
      indices: Uint32Array.from(idx), boneIndex: Uint8Array.from(boneIdx), materials: mats,
    },
    clips,
    extras: (json.extras && json.extras.kestrel) || null,
  };
}
