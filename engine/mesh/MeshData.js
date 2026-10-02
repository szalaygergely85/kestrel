// @ts-check
// engine/mesh/MeshData.js - ME-01 (docs/backlog.md, docs/architecture.md 27.3,
// 27.15.2). The in-memory mesh format shared by every mesh builder
// (levelMesh, terrainMesh, voxelMesh, gltf) and consumed by the rasteriser
// (ME-03) and the GPU raster pass (ME-04). Two layouts:
//   - 'static' (levels, voxels, glTF): UNROLLED - 3 verts per triangle, no
//     index, every vertex carries its own flat/aux "flat-shaded" data.
//   - 'terrain': indexed grid, smooth per-vertex normals, no uv/flat/aux.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (architecture.md 27.15.0 "Imports of the new modules") -
// never a caster, gpu/*, game/ or design/.
import { packNormalOct } from '../voxel/octNormal.js';
import { packPlaneId } from '../render/GBuffer.js';

/** Schema version (27.3). */
export const MESH_VERSION = 1;
/** Floats per vertex in the `aux` array (27.15.0 amendment 2). */
export const AUX_STRIDE = 8;
/** Uints per vertex in the `flat` array. */
export const FLAT_STRIDE = 2;

/** `aux[1]` (aoMode) values (27.15.2). */
export const AO_NONE = 0;
export const AO_WALL = 1;
export const AO_PLANE = 2;

/** "No limit" sentinel inside vertex data - never `Infinity` in a GPU attribute. */
export const AO_FAR = 1e30;

/**
 * @typedef {Object} MeshRange
 * @property {number} start - first triangle index (triangle units, not vertex/index units)
 * @property {number} count - triangle count
 * @property {string} [part] - voxel part name / glTF primitive name
 */

/**
 * @typedef {Object} MeshData
 * @property {1} version
 * @property {string} id - `level:<name>`, `level:<name>#<tag>`, `vox:<modelKey>`, `terrain:<...>`
 * @property {'static'|'terrain'|'cloth'} layout
 * @property {Float32Array} pos - 3 floats/vertex, mesh-local metres
 * @property {Float32Array} uv - static: 2 floats/vertex (metres); terrain: length 0
 * @property {Uint32Array} nrm - 1 uint/vertex, packNormalOct of the mesh-local unit normal
 * @property {Uint32Array} flat - static: 2 uints/vertex [planeIdBase, kind|face<<8|mat<<16]; terrain: length 0
 * @property {Float32Array} aux - static: 8 floats/vertex (AO layout, see levelMesh.js); terrain: length 0
 * @property {Uint16Array|Uint32Array|null} idx - terrain: 3/triangle; static: null
 * @property {number} triCount - total triangle count
 * @property {Float64Array} bbox - [x0,y0,z0,x1,y1,z1] mesh-local
 * @property {MeshRange[]} ranges - draw sub-ranges, triangle units, >= 1 range
 * @property {string[]} matKeys - mat bits index this list until resolveMats()
 * @property {boolean} matsResolved - true once mat bits are real MaterialTable ids
 * @property {number} meshVersion - bumped on every in-place rebuild
 */

/**
 * Packs (kind, face, mat) into `flat[1]` (same layout as GI.y: kind 0-7,
 * face 8-11, mat 16-31 - here mat gets the full remaining 16 bits since a
 * MeshData mat slot is either a `matKeys` index or a resolved id, both < 2^16).
 * @param {number} kind
 * @param {number} face
 * @param {number} mat
 * @returns {number}
 */
export function packFlat1(kind, face, mat) {
  return ((kind & 0xff) | ((face & 0xf) << 8) | ((mat & 0xffff) << 16)) >>> 0;
}
/** @param {number} f1 @returns {number} */
export function flatKind(f1) { return f1 & 0xff; }
/** @param {number} f1 @returns {number} */
export function flatFace(f1) { return (f1 >>> 8) & 0xf; }
/** @param {number} f1 @returns {number} */
export function flatMat(f1) { return (f1 >>> 16) & 0xffff; }

/**
 * `flat[0]` (planeId, before the draw item ORs its own structSeq/instance
 * bits in - `planeIdOr`, ME-03) for a wall-type quad. Identical formula to
 * `sectorCaster.js`'s `primeWallGSample` (`packPlaneId(structSeq, face, coord)`
 * with structSeq = 0 here).
 * @param {number} face
 * @param {number} boundary - integer grid coordinate of the boundary line
 * @returns {number}
 */
export function wallPlaneIdBase(face, boundary) {
  return packPlaneId(0, face, boundary);
}

/**
 * `flat[0]` for a plane (floor/top/ceil) quad. Identical formula to
 * `sectorCaster.js`'s `castPlane` (`packPlaneId(structSeq, gkind, round(h*1000)+0x800000)`).
 * @param {number} kind
 * @param {number} h - plane height, metres
 * @returns {number}
 */
export function planePlaneIdBase(kind, h) {
  return packPlaneId(0, kind, Math.round(h * 1000) + 0x800000);
}

/**
 * Build-time accumulator for a 'static' MeshData. May allocate freely (JS
 * arrays); `build()` packs everything into typed arrays once.
 */
export class StaticMeshBuilder {
  /** @param {string} id */
  constructor(id) {
    this.id = id;
    /** @type {number[]} */ this._pos = [];
    /** @type {number[]} */ this._uv = [];
    /** @type {number[]} */ this._nrm = [];
    /** @type {number[]} */ this._flat = [];
    /** @type {number[]} */ this._aux = [];
    this.triCount = 0;
    /** @type {string[]} */ this.matKeys = [];
    /** @type {Map<string, number>} */ this._matIndex = new Map();
    /** @type {MeshRange[]} */ this._ranges = [];
    /** @type {MeshRange|null} */ this._openRange = null;
    this._bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  }

  /**
   * First-use-order material key -> index. Reused across calls for the same key.
   * @param {string} key
   * @returns {number}
   */
  matIndex(key) {
    let i = this._matIndex.get(key);
    if (i === undefined) {
      i = this.matKeys.length;
      this.matKeys.push(key);
      this._matIndex.set(key, i);
    }
    return i;
  }

  /**
   * Starts a new draw sub-range at the current triangle count. Closes any
   * previously open range first. Optional when the mesh has a single range
   * (build() then makes one covering everything).
   * @param {string} [part]
   */
  beginRange(part) {
    if (this._openRange) this._openRange.count = this.triCount - this._openRange.start;
    this._openRange = { start: this.triCount, count: 0, part };
    this._ranges.push(this._openRange);
  }

  /**
   * Adds a quad (2 triangles: corners (0,1,2) and (0,2,3)) with one shared
   * normal/flat/aux (identical on all 6 emitted vertices, so provoking-vertex
   * rules never matter - 27.15.2).
   * @param {number[]} p12 - 4 corners x xyz (12 numbers)
   * @param {number[]} uv8 - 4 corners x uv (8 numbers)
   * @param {number} nx
   * @param {number} ny
   * @param {number} nz
   * @param {number} flat0 - planeIdBase
   * @param {number} flat1 - packFlat1(kind, face, mat)
   * @param {number[]} aux8 - 8 floats, see levelMesh.js's AO layout doc
   */
  addQuad(p12, uv8, nx, ny, nz, flat0, flat1, aux8) {
    const nrmPacked = packNormalOct(nx, ny, nz);
    const corners = [0, 1, 2, 0, 2, 3];
    for (let k = 0; k < 6; k++) {
      const c = corners[k];
      const px = p12[c * 3], py = p12[c * 3 + 1], pz = p12[c * 3 + 2];
      this._pos.push(px, py, pz);
      this._uv.push(uv8[c * 2], uv8[c * 2 + 1]);
      this._nrm.push(nrmPacked);
      this._flat.push(flat0, flat1);
      for (let a = 0; a < AUX_STRIDE; a++) this._aux.push(aux8[a]);
      if (px < this._bbox[0]) this._bbox[0] = px;
      if (py < this._bbox[1]) this._bbox[1] = py;
      if (pz < this._bbox[2]) this._bbox[2] = pz;
      if (px > this._bbox[3]) this._bbox[3] = px;
      if (py > this._bbox[4]) this._bbox[4] = py;
      if (pz > this._bbox[5]) this._bbox[5] = pz;
    }
    this.triCount += 2;
  }

  /** @returns {MeshData} */
  build() {
    if (this._openRange) {
      this._openRange.count = this.triCount - this._openRange.start;
      this._openRange = null;
    }
    if (this._ranges.length === 0) this._ranges.push({ start: 0, count: this.triCount });
    const bbox = this.triCount > 0 ? this._bbox : [0, 0, 0, 0, 0, 0];
    return {
      version: MESH_VERSION,
      id: this.id,
      layout: 'static',
      pos: Float32Array.from(this._pos),
      uv: Float32Array.from(this._uv),
      nrm: Uint32Array.from(this._nrm),
      flat: Uint32Array.from(this._flat),
      aux: Float32Array.from(this._aux),
      idx: null,
      triCount: this.triCount,
      bbox: Float64Array.from(bbox),
      ranges: this._ranges,
      matKeys: this.matKeys,
      matsResolved: false,
      meshVersion: 1,
    };
  }
}

function isFiniteArray(arr) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

/**
 * Validates a MeshData against the 27.15.2 schema. Never throws.
 * @param {MeshData} mesh
 * @returns {{errors: string[]}}
 */
export function validateMesh(mesh) {
  const errors = [];
  const push = (path, problem) => errors.push(`${path}: ${problem}`);

  if (!mesh || typeof mesh !== 'object') { push('(root)', 'not an object'); return { errors }; }
  if (mesh.version !== 1) push('version', `expected 1, got ${JSON.stringify(mesh.version)}`);
  if (typeof mesh.id !== 'string' || mesh.id === '') push('id', 'must be a non-empty string');
  if (mesh.layout !== 'static' && mesh.layout !== 'terrain' && mesh.layout !== 'cloth') {
    push('layout', `expected 'static', 'terrain' or 'cloth', got ${JSON.stringify(mesh.layout)}`);
    return { errors }; // can't validate lengths meaningfully without a valid layout
  }
  const isStatic = mesh.layout === 'static';

  if (!(mesh.pos instanceof Float32Array)) push('pos', 'must be a Float32Array');
  if (!(mesh.uv instanceof Float32Array)) push('uv', 'must be a Float32Array');
  if (!(mesh.nrm instanceof Uint32Array)) push('nrm', 'must be a Uint32Array');
  if (!(mesh.flat instanceof Uint32Array)) push('flat', 'must be a Uint32Array');
  if (!(mesh.aux instanceof Float32Array)) push('aux', 'must be a Float32Array');
  if (mesh.idx !== null && !(mesh.idx instanceof Uint16Array) && !(mesh.idx instanceof Uint32Array)) {
    push('idx', 'must be Uint16Array, Uint32Array or null');
  }
  if (!(mesh.bbox instanceof Float64Array) && !Array.isArray(mesh.bbox)) push('bbox', 'must be a Float64Array (or number[])');
  if (errors.length) return { errors }; // typed-array class errors make length checks meaningless

  const posLen = mesh.pos.length;
  if (posLen % 3 !== 0) push('pos', `length ${posLen} is not a multiple of 3`);
  const V = posLen / 3;

  if (mesh.nrm.length !== V) push('nrm', `length ${mesh.nrm.length}, expected ${V} (1/vertex)`);

  if (isStatic) {
    if (V % 3 !== 0) push('pos', `length ${posLen} (${V} verts) is not a multiple of 3 (unrolled triangles)`);
    if (mesh.uv.length !== V * 2) push('uv', `length ${mesh.uv.length}, expected ${V * 2} (2/vertex)`);
    if (mesh.flat.length !== V * FLAT_STRIDE) push('flat', `length ${mesh.flat.length}, expected ${V * FLAT_STRIDE} (2/vertex)`);
    if (mesh.aux.length !== V * AUX_STRIDE) push('aux', `length ${mesh.aux.length}, expected ${V * AUX_STRIDE} (8/vertex)`);
    if (mesh.idx !== null) push('idx', 'must be null on a static mesh');
    if (mesh.triCount !== V / 3) push('triCount', `${mesh.triCount}, expected ${V / 3} (from vertex count)`);

    // Flat/aux must be identical on the 3 vertices of each triangle.
    for (let t = 0; t < mesh.triCount; t++) {
      const v0 = t * 3;
      for (let k = 0; k < FLAT_STRIDE; k++) {
        const a = mesh.flat[v0 * FLAT_STRIDE + k];
        for (let j = 1; j < 3; j++) {
          if (mesh.flat[(v0 + j) * FLAT_STRIDE + k] !== a) {
            push(`flat[tri ${t}]`, `component ${k} differs between the triangle's 3 vertices`);
          }
        }
      }
      for (let k = 0; k < AUX_STRIDE; k++) {
        const a = mesh.aux[v0 * AUX_STRIDE + k];
        for (let j = 1; j < 3; j++) {
          if (mesh.aux[(v0 + j) * AUX_STRIDE + k] !== a) {
            push(`aux[tri ${t}]`, `component ${k} differs between the triangle's 3 vertices`);
          }
        }
      }
    }

    // kind 1..9, face 1..7; unresolved mat bits < matKeys.length.
    for (let v = 0; v < V; v++) {
      const f1 = mesh.flat[v * FLAT_STRIDE + 1];
      const kind = flatKind(f1), face = flatFace(f1), mat = flatMat(f1);
      if (kind < 1 || kind > 9) push(`flat[vert ${v}]`, `kind ${kind} out of range 1..9`);
      if (face < 1 || face > 7) push(`flat[vert ${v}]`, `face ${face} out of range 1..7`);
      if (!mesh.matsResolved && mat >= mesh.matKeys.length) {
        push(`flat[vert ${v}]`, `mat index ${mat} >= matKeys.length (${mesh.matKeys.length})`);
      }
    }
  } else {
    const what = mesh.layout === 'cloth' ? 'cloth' : 'terrain';
    // CLOTH-1b1 (33.5): cloth = indexed like terrain, plus a static uv (2/vertex, rest-space metres)
    if (what === 'cloth') {
      if (mesh.uv.length !== V * 2) push('uv', `length ${mesh.uv.length}, expected ${V * 2} (2/vertex)`);
    } else if (mesh.uv.length !== 0) push('uv', 'must be empty on a terrain mesh');
    if (mesh.flat.length !== 0) push('flat', `must be empty on a ${what} mesh`);
    if (mesh.aux.length !== 0) push('aux', `must be empty on a ${what} mesh`);
    if (!mesh.idx) push('idx', `required on a ${what} mesh`);
    else {
      if (mesh.idx.length % 3 !== 0) push('idx', `length ${mesh.idx.length} is not a multiple of 3`);
      for (let i = 0; i < mesh.idx.length; i++) {
        if (mesh.idx[i] >= V) { push(`idx[${i}]`, `index ${mesh.idx[i]} >= vertex count ${V}`); break; }
      }
      if (mesh.triCount !== Math.floor(mesh.idx.length / 3)) {
        push('triCount', `${mesh.triCount}, expected ${Math.floor(mesh.idx.length / 3)} (from idx length)`);
      }
    }
  }

  if (!isFiniteArray(mesh.pos)) push('pos', 'contains a non-finite value');
  if (mesh.uv.length > 0 && !isFiniteArray(mesh.uv)) push('uv', 'contains a non-finite value');
  if (isStatic) {
    for (let i = 0; i < mesh.aux.length; i++) {
      if (!Number.isFinite(mesh.aux[i])) { push(`aux[${i}]`, 'contains a non-finite value (use AO_FAR, never Infinity)'); break; }
    }
  }

  // bbox contains every position (1e-6 tolerance).
  if (mesh.bbox && mesh.bbox.length === 6) {
    const [x0, y0, z0, x1, y1, z1] = mesh.bbox;
    const eps = 1e-6;
    for (let v = 0; v < V; v++) {
      const px = mesh.pos[v * 3], py = mesh.pos[v * 3 + 1], pz = mesh.pos[v * 3 + 2];
      if (px < x0 - eps || px > x1 + eps || py < y0 - eps || py > y1 + eps || pz < z0 - eps || pz > z1 + eps) {
        push('bbox', `does not contain vertex ${v} (${px},${py},${pz})`);
        break;
      }
    }
  } else {
    push('bbox', 'must have length 6');
  }

  // ranges inside [0, triCount].
  if (!Array.isArray(mesh.ranges) || mesh.ranges.length === 0) {
    push('ranges', 'must be a non-empty array');
  } else {
    for (let i = 0; i < mesh.ranges.length; i++) {
      const r = mesh.ranges[i];
      if (!r || typeof r.start !== 'number' || typeof r.count !== 'number') {
        push(`ranges[${i}]`, 'must be {start, count}');
        continue;
      }
      if (r.start < 0 || r.count < 0 || r.start + r.count > mesh.triCount) {
        push(`ranges[${i}]`, `[${r.start}, ${r.start + r.count}) outside [0, ${mesh.triCount}]`);
      }
    }
  }

  return { errors };
}

/**
 * @param {MeshData} mesh
 */
export function assertMesh(mesh) {
  const { errors } = validateMesh(mesh);
  if (errors.length) throw new Error(errors.join('\n'));
}

/**
 * Resolves `matKeys` indices in `flat[1]`'s mat bits into real MaterialTable
 * ids, in place. Only valid once (throws on an already-resolved mesh).
 * @param {MeshData} mesh
 * @param {(key: string) => number} matIdFor
 */
export function resolveMats(mesh, matIdFor) {
  if (mesh.matsResolved) throw new Error(`resolveMats: mesh "${mesh.id}" is already resolved`);
  if (mesh.layout === 'static') {
    const ids = mesh.matKeys.map((k) => matIdFor(k));
    for (let v = 0; v < mesh.flat.length / FLAT_STRIDE; v++) {
      const i1 = v * FLAT_STRIDE + 1;
      const f1 = mesh.flat[i1];
      const kind = flatKind(f1), face = flatFace(f1), matIdx = flatMat(f1);
      mesh.flat[i1] = packFlat1(kind, face, ids[matIdx]);
    }
  }
  mesh.matsResolved = true;
}

function arr(a) { return a ? Array.from(a) : a; }

/**
 * Content form (plain number arrays, stable key order) - not the canonical
 * `engine/content/stringify.js` writer (out of engine/mesh's allowed import
 * list), but the same shape.
 * @param {MeshData} mesh
 */
export function meshToJSON(mesh) {
  return {
    version: mesh.version,
    id: mesh.id,
    layout: mesh.layout,
    pos: arr(mesh.pos),
    uv: arr(mesh.uv),
    nrm: arr(mesh.nrm),
    flat: arr(mesh.flat),
    aux: arr(mesh.aux),
    idx: mesh.idx ? arr(mesh.idx) : null,
    triCount: mesh.triCount,
    bbox: arr(mesh.bbox),
    ranges: mesh.ranges.map((r) => (r.part !== undefined ? { start: r.start, count: r.count, part: r.part } : { start: r.start, count: r.count })),
    matKeys: mesh.matKeys.slice(),
    matsResolved: mesh.matsResolved,
    meshVersion: mesh.meshVersion,
  };
}

/** @returns {MeshData} */
export function meshFromJSON(obj) {
  const isTerrain = obj.layout === 'terrain';
  return {
    version: obj.version,
    id: obj.id,
    layout: obj.layout,
    pos: Float32Array.from(obj.pos),
    uv: Float32Array.from(obj.uv),
    nrm: Uint32Array.from(obj.nrm),
    flat: Uint32Array.from(obj.flat),
    aux: Float32Array.from(obj.aux),
    idx: obj.idx ? (isTerrain ? Uint32Array.from(obj.idx) : null) : null,
    triCount: obj.triCount,
    bbox: Float64Array.from(obj.bbox),
    ranges: obj.ranges.map((r) => (r.part !== undefined ? { start: r.start, count: r.count, part: r.part } : { start: r.start, count: r.count })),
    matKeys: obj.matKeys.slice(),
    matsResolved: obj.matsResolved,
    meshVersion: obj.meshVersion,
  };
}
