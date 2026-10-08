// @ts-check
// engine/render/gpu/MeshBuffers.js - ME-04 (docs/backlog.md, docs/
// architecture.md 27.2, 27.11 ME-04 row). Uploads a `MeshData` (ME-01,
// engine/mesh/MeshData.js) into one interleaved GL vertex buffer through
// GpuDevice.js only (never `gl.*` directly - check-deps.mjs rule 9), keyed
// by `mesh.id` + `mesh.meshVersion` so a re-upload happens only when the
// mesh actually changed (editor live-rebuild, dynamic sector meshes) - never
// once per frame (27.11 ME-04 AC "mock-device alloc test").
//
// Phase 1 scope (27.12: "Deletion happens only after phase gates" - this
// file grows incrementally, not all at once): `static` layout
// (engine/mesh/levelMesh.js's level meshes - the tower), extended by ME-06
// to `terrain` layout (engine/mesh/terrainMesh.js's near/far/stitch chunks
// - indexed, no uv/flat/aux, 27.3 "terrain layout has no uv"). Per-part
// voxel instancing (ME-07/08) is a later story's addition to this same
// cache, not implemented here - `get()` throws a clear error on any other
// layout so a caller finds out immediately rather than uploading garbage.
//
// Vertex layout (27.15.0 amendment 2, "Static vertex layout"): interleaved,
// stride 64 bytes = pos(12) + uv(8) + nrm(4) + flat(8) + aux(32). One
// ArrayBuffer, three typed-array VIEWS over it (Float32Array for the float
// fields, Uint32Array for the two uint32 ones) so `nrm`/`flat`'s exact bit
// patterns survive the upload unchanged (never round-tripped through a
// float).
import { AUX_STRIDE, FLAT_STRIDE, flatKind } from '../../mesh/MeshData.js';
import { KIND_MESH } from '../GBuffer.js';
import { onMeshEvicted } from '../../mesh/lazyMesh.js';

/** Bytes per vertex in the interleaved static buffer (27.15.0 amendment 2). */
export const STATIC_STRIDE_BYTES = 64;
/** Same stride, in 4-byte words (both the float and uint views share this indexing). */
const STRIDE_WORDS = STATIC_STRIDE_BYTES / 4; // 16

/**
 * Builds the interleaved static vertex buffer for one `MeshData` (layout
 * 'static' only). Exported (not just used internally) so a Node test can
 * decode it back and compare against `mesh.pos`/`uv`/`nrm`/`flat`/`aux`
 * field-by-field without a real GL context (the ME-04 "JS-twin/rasterJS
 * parity" check - both `rasterJS.js` and this GPU vertex buffer are built
 * from the exact same `MeshData`, so they can never silently disagree on
 * which byte means what).
 * @param {import('../../mesh/MeshData.js').MeshData} mesh
 * @returns {ArrayBuffer}
 */
export function buildStaticVertexData(mesh) {
  if (mesh.layout !== 'static') throw new Error(`buildStaticVertexData: mesh "${mesh.id}" is not 'static' layout (got "${mesh.layout}")`);
  const vertCount = mesh.pos.length / 3;
  const buf = new ArrayBuffer(vertCount * STATIC_STRIDE_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let v = 0; v < vertCount; v++) {
    const base = v * STRIDE_WORDS;
    f32[base + 0] = mesh.pos[v * 3 + 0];
    f32[base + 1] = mesh.pos[v * 3 + 1];
    f32[base + 2] = mesh.pos[v * 3 + 2];
    f32[base + 3] = mesh.uv[v * 2 + 0];
    f32[base + 4] = mesh.uv[v * 2 + 1];
    u32[base + 5] = mesh.nrm[v];
    u32[base + 6] = mesh.flat[v * FLAT_STRIDE + 0];
    u32[base + 7] = mesh.flat[v * FLAT_STRIDE + 1];
    for (let k = 0; k < AUX_STRIDE; k++) f32[base + 8 + k] = mesh.aux[v * AUX_STRIDE + k];
  }
  return buf;
}

/** The `PipelineDesc.vertex.layout` matching `buildStaticVertexData`'s byte layout - shared by mesh.vert.js's pipeline creation. */
export const STATIC_VERTEX_LAYOUT = Object.freeze([
  { name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 },
  { name: 'aUV', location: 1, components: 2, type: 'float', offsetBytes: 12 },
  { name: 'aNrmBits', location: 2, components: 1, type: 'uint', offsetBytes: 20 },
  { name: 'aFlat', location: 3, components: 2, type: 'uint', offsetBytes: 24 },
  { name: 'aAux0123', location: 4, components: 4, type: 'float', offsetBytes: 32 },
  { name: 'aAux4567', location: 5, components: 4, type: 'float', offsetBytes: 48 },
]);

/** ALPHA-01c: the optional mask-uv vertex stream (8 B/vertex, `mesh.uvMask`), bound as an extra stream at location 10 (WebGPU `extraLayouts`). */
export const MASK_UV_LAYOUT = Object.freeze([{ name: 'aUVMask', location: 10, components: 2, type: 'float', offsetBytes: 0 }]);
export const MASK_UV_STRIDE_BYTES = 8;

/** RE-06b (architecture 28.7): bytes per voxel vertex = the first 32 B of the static vertex (pos, uv, nrm, flat); aux is constant zero. */
export const VOXEL_STRIDE_BYTES = 32;
const VOXEL_STRIDE_WORDS = VOXEL_STRIDE_BYTES / 4; // 8

/** `STATIC_VERTEX_LAYOUT[0..3]` - same names/locations/offsets, stride 32 (locations 4/5 = generic attribs, zero). */
export const VOXEL_VERTEX_LAYOUT = Object.freeze(STATIC_VERTEX_LAYOUT.slice(0, 4));

/**
 * Build-time encoder for a voxel MeshData (unrolled quads, corners 0,1,2,0,2,3): 4 x 32 B
 * verts per quad + index pattern 4q+(0,1,2,0,2,3) = the exact unrolled triangle order, so
 * GPU primitive order equals rasterJS's. Validates the assumptions and throws with mesh.id.
 * @param {import('../../mesh/MeshData.js').MeshData} mesh
 * @returns {{vertex: ArrayBuffer, index: Uint16Array|Uint32Array, quadCount: number, vertexCount?: number, indexCount?: number}}
 */
export function buildVoxelVertexData(mesh) {
  if (mesh.layout === 'static' && mesh.triCount > 0 && flatKind(mesh.flat[1]) === KIND_MESH) return buildMeshTriVertexData(mesh); // MESH-INST-01
  if (mesh.layout !== 'static') throw new Error(`buildVoxelVertexData: mesh "${mesh.id}" is not 'static' layout (got "${mesh.layout}")`);
  if (mesh.triCount % 2 !== 0) throw new Error(`buildVoxelVertexData: mesh "${mesh.id}" has odd triCount ${mesh.triCount} (not quads)`);
  const quadCount = mesh.triCount / 2;
  for (let i = 0; i < mesh.aux.length; i++) {
    if (mesh.aux[i] !== 0) throw new Error(`buildVoxelVertexData: mesh "${mesh.id}" has non-zero aux at ${i}`);
  }
  const posU = new Uint32Array(mesh.pos.buffer, mesh.pos.byteOffset, mesh.pos.length);
  const uvU = new Uint32Array(mesh.uv.buffer, mesh.uv.byteOffset, mesh.uv.length);
  const sameVert = (a, b) => posU[a * 3] === posU[b * 3] && posU[a * 3 + 1] === posU[b * 3 + 1] && posU[a * 3 + 2] === posU[b * 3 + 2]
    && uvU[a * 2] === uvU[b * 2] && uvU[a * 2 + 1] === uvU[b * 2 + 1];
  const vertex = new ArrayBuffer(quadCount * 4 * VOXEL_STRIDE_BYTES);
  const f32 = new Float32Array(vertex);
  const u32 = new Uint32Array(vertex);
  const index = quadCount * 4 > 65536 ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
  for (let q = 0; q < quadCount; q++) {
    const s = q * 6; // unrolled source verts
    if (!sameVert(s + 3, s) || !sameVert(s + 4, s + 2)) throw new Error(`buildVoxelVertexData: mesh "${mesh.id}" quad ${q} is not (0,1,2,0,2,3)`);
    for (let c = 0; c < 4; c++) {
      const v = c === 3 ? s + 5 : s + c;
      const base = (q * 4 + c) * VOXEL_STRIDE_WORDS;
      f32[base] = mesh.pos[v * 3]; f32[base + 1] = mesh.pos[v * 3 + 1]; f32[base + 2] = mesh.pos[v * 3 + 2];
      f32[base + 3] = mesh.uv[v * 2]; f32[base + 4] = mesh.uv[v * 2 + 1];
      u32[base + 5] = mesh.nrm[v];
      u32[base + 6] = mesh.flat[v * FLAT_STRIDE]; u32[base + 7] = mesh.flat[v * FLAT_STRIDE + 1];
    }
    const i = q * 6, b = q * 4;
    index[i] = b; index[i + 1] = b + 1; index[i + 2] = b + 2; index[i + 3] = b; index[i + 4] = b + 2; index[i + 5] = b + 3;
  }
  return { vertex, index, quadCount };
}

/**
 * MESH-INST-01: the same 32 B voxel vertex for a placed kind-9 triangle mesh (not quads): 3 verts per triangle in source
 * order + identity index, so the primitive order equals rasterJS's and `range.start * 3` addresses triangle starts.
 * @param {import('../../mesh/MeshData.js').MeshData} mesh
 * @returns {{vertex: ArrayBuffer, index: Uint16Array|Uint32Array, quadCount: number, vertexCount: number, indexCount: number}}
 */
export function buildMeshTriVertexData(mesh) {
  for (let i = 0; i < mesh.aux.length; i++) {
    if (mesh.aux[i] !== 0) throw new Error(`buildMeshTriVertexData: mesh "${mesh.id}" has non-zero aux at ${i}`);
  }
  const V = mesh.triCount * 3;
  const vertex = new ArrayBuffer(V * VOXEL_STRIDE_BYTES);
  const f32 = new Float32Array(vertex), u32 = new Uint32Array(vertex);
  for (let v = 0; v < V; v++) {
    const base = v * VOXEL_STRIDE_WORDS;
    f32[base] = mesh.pos[v * 3]; f32[base + 1] = mesh.pos[v * 3 + 1]; f32[base + 2] = mesh.pos[v * 3 + 2];
    f32[base + 3] = mesh.uv[v * 2]; f32[base + 4] = mesh.uv[v * 2 + 1];
    u32[base + 5] = mesh.nrm[v];
    u32[base + 6] = mesh.flat[v * FLAT_STRIDE]; u32[base + 7] = mesh.flat[v * FLAT_STRIDE + 1];
  }
  const index = V > 65536 ? new Uint32Array(V) : new Uint16Array(V);
  for (let i = 0; i < V; i++) index[i] = i;
  return { vertex, index, quadCount: 0, vertexCount: V, indexCount: V };
}

/** Bytes per vertex in the interleaved terrain buffer (ME-06, 27.3 "terrain layout has no uv"): pos(12) + nrm(4). */
export const TERRAIN_STRIDE_BYTES = 16;
const TERRAIN_STRIDE_WORDS = TERRAIN_STRIDE_BYTES / 4; // 4

/**
 * Builds the interleaved terrain vertex buffer for one `MeshData` (layout
 * 'terrain' only - engine/mesh/terrainMesh.js's near/far/stitch chunks).
 * No `uv`/`flat`/`aux` (27.3 amendment) - just position and the smooth,
 * per-vertex analytic normal (oct-packed) `terrain.vert.js`'s vertex stage
 * unpacks and interpolates.
 * @param {import('../../mesh/MeshData.js').MeshData} mesh
 * @returns {ArrayBuffer}
 */
export function buildTerrainVertexData(mesh) {
  if (mesh.layout !== 'terrain') throw new Error(`buildTerrainVertexData: mesh "${mesh.id}" is not 'terrain' layout (got "${mesh.layout}")`);
  const vertCount = mesh.pos.length / 3;
  const buf = new ArrayBuffer(vertCount * TERRAIN_STRIDE_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let v = 0; v < vertCount; v++) {
    const base = v * TERRAIN_STRIDE_WORDS;
    f32[base + 0] = mesh.pos[v * 3 + 0];
    f32[base + 1] = mesh.pos[v * 3 + 1];
    f32[base + 2] = mesh.pos[v * 3 + 2];
    u32[base + 3] = mesh.nrm[v];
  }
  return buf;
}

/** The `PipelineDesc.vertex.layout` matching `buildTerrainVertexData`'s byte layout - shared by terrain.vert.js's pipeline creation. */
export const TERRAIN_VERTEX_LAYOUT = Object.freeze([
  { name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 },
  { name: 'aNrmBits', location: 1, components: 1, type: 'uint', offsetBytes: 12 },
]);

/** CLOTH-1b2 (33.5): the cloth's dynamic vertex buffer is the terrain stride (pos f32x3 + oct normal u32); uv lives in a separate static buffer. */
export const CLOTH_STRIDE_BYTES = TERRAIN_STRIDE_BYTES;
/** Cloth vertex layout: location 0 aPos + 2 aNrmBits from the dynamic buffer (16 B stride), location 1 aUV from the uv buffer (vec2, tight). */
export const CLOTH_DYN_LAYOUT = Object.freeze([
  { name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 },
  { name: 'aNrmBits', location: 2, components: 1, type: 'uint', offsetBytes: 12 },
]);
export const CLOTH_UV_LAYOUT = Object.freeze([{ name: 'aUV', location: 1, components: 2, type: 'float', offsetBytes: 0 }]);
/** Shadow pass: position only, same dynamic buffer and stride. */
export const CLOTH_SHADOW_LAYOUT = Object.freeze([CLOTH_DYN_LAYOUT[0]]);

/**
 * Packs a cloth mesh's `pos` (f32x3) + `nrm` (u32) into the interleaved 16 B/vertex scratch (zero allocation when
 * `f32`/`u32` views over a preallocated ArrayBuffer are passed).
 * @param {any} mesh @param {Float32Array} f32 @param {Uint32Array} u32
 */
export function packClothVertices(mesh, f32, u32) {
  const n = mesh.pos.length / 3;
  for (let v = 0; v < n; v++) {
    const b = v * 4;
    f32[b] = mesh.pos[v * 3]; f32[b + 1] = mesh.pos[v * 3 + 1]; f32[b + 2] = mesh.pos[v * 3 + 2];
    u32[b + 3] = mesh.nrm[v];
  }
}

/**
 * Per-world-pipeline cache: one GPU vertex buffer per `mesh.id`, re-uploaded
 * only when `mesh.meshVersion` changes (level dynamics rebuild a `dyn[tag]`
 * mesh event-driven, never per frame - engine/mesh/levelMesh.js's
 * `rebuildLevelMeshDyn`). `dispose()` frees every buffer through the same
 * device (mock or GpuDeviceGL2) that created them.
 */
export class MeshBuffers {
  /** @param {import('./device/GpuDevice.js').GpuDevice} device */
  constructor(device) {
    this.device = device;
    /** @type {Map<string, {vertexBuffer: any, version: number, mesh: any, vertexCount: number, indexBuffer?: any, indexCount?: number, uvMaskBuffer?: any}>} */
    this.cache = new Map();
    /** RE-06b: voxel-only entries (32 B vertex + index buffer), separate from `cache` so `get()` is untouched. @type {Map<string, {vertexBuffer: any, indexBuffer: any, indexType: 'u16'|'u32', version: number, mesh: any, vertexCount: number, indexCount: number}>} */
    this.voxelCache = new Map();
    /** CLOTH-1b2: cloth entries (dynamic 16 B vertex buffer + static uv + static index), keyed by `mesh.id`. @type {Map<string, any>} */
    this.clothCache = new Map();
    /** S8-B2-03: a lazy mesh whose payload was evicted frees its GPU buffers (re-uploaded by `get` when it loads again). */
    this._unsubEvict = onMeshEvicted((m) => this.release(m));
  }

  /** Frees the static-layout GPU buffers of one mesh (no-op when absent). @param {any} mesh */
  release(mesh) {
    const e = this.cache.get(mesh.id);
    if (!e) return; // keyed by id: the entry's mesh is the resolved draw copy of the registry mesh
    this.device.dispose(e.vertexBuffer);
    if (e.indexBuffer) this.device.dispose(e.indexBuffer);
    if (e.uvMaskBuffer) this.device.dispose(e.uvMaskBuffer);
    this.cache.delete(mesh.id);
  }

  /**
   * CLOTH-1b2 (33.5): GPU buffers of a `'cloth'` MeshData. The first call creates the dynamic vertex buffer, the static uv
   * and index buffers and a preallocated scratch; later calls `writeBuffer` ONCE when `mesh.meshVersion` differs from the
   * entry's (never a new buffer per frame, nothing when unchanged). Call after `pushClothItem` ran (it refreshes the arrays).
   * @param {any} mesh
   * @returns {{vertexBuffer: any, uvBuffer: any, indexBuffer: any, indexCount: number, vertexCount: number, version: number}}
   */
  getCloth(mesh) {
    let e = this.clothCache.get(mesh.id);
    if (e && e.mesh !== mesh) { // same id, another MeshData (a second cloth system): rebuild
      this.device.dispose(e.vertexBuffer); this.device.dispose(e.uvBuffer); this.device.dispose(e.indexBuffer);
      this.clothCache.delete(mesh.id);
      e = undefined;
    }
    if (!e) {
      if (mesh.layout !== 'cloth') throw new Error(`MeshBuffers.getCloth: mesh "${mesh.id}" is not 'cloth' layout (got "${mesh.layout}")`);
      const n = mesh.pos.length / 3;
      const scratch = new ArrayBuffer(n * CLOTH_STRIDE_BYTES);
      const f32 = new Float32Array(scratch), u32 = new Uint32Array(scratch);
      packClothVertices(mesh, f32, u32);
      e = {
        mesh, version: mesh.meshVersion, vertexCount: n, indexCount: mesh.idx.length, f32, u32, bytes: new Uint8Array(scratch),
        vertexBuffer: this.device.createBuffer({ usage: 'vertex', data: new Uint8Array(scratch), dynamic: true }),
        uvBuffer: this.device.createBuffer({ usage: 'vertex', data: mesh.uv }),
        indexBuffer: this.device.createBuffer({ usage: 'index', data: mesh.idx }),
      };
      this.clothCache.set(mesh.id, e);
    } else if (e.version !== mesh.meshVersion) {
      packClothVertices(mesh, e.f32, e.u32);
      this.device.writeBuffer(e.vertexBuffer, e.bytes, 0);
      e.version = mesh.meshVersion;
    }
    return e;
  }

  /**
   * RE-06b (28.7): GPU-side 32 B vertex + index buffer for a voxel MeshData (ME-08 + RE-06 paths only).
   * @param {import('../../mesh/MeshData.js').MeshData} mesh
   */
  getVoxel(mesh) {
    const existing = this.voxelCache.get(mesh.id);
    if (existing && existing.version === mesh.meshVersion && existing.mesh === mesh) return existing;
    if (existing) {
      this.device.dispose(existing.vertexBuffer);
      this.device.dispose(existing.indexBuffer);
    }
    const d = buildVoxelVertexData(mesh);
    const vertexBuffer = this.device.createBuffer({ usage: 'vertex', data: new Uint8Array(d.vertex) });
    const indexBuffer = this.device.createBuffer({ usage: 'index', data: d.index });
    const entry = {
      vertexBuffer, indexBuffer, indexType: /** @type {'u16'|'u32'} */ (d.index instanceof Uint16Array ? 'u16' : 'u32'),
      version: mesh.meshVersion, mesh, vertexCount: d.vertexCount ?? d.quadCount * 4, indexCount: d.indexCount ?? d.quadCount * 6,
    };
    this.voxelCache.set(mesh.id, entry);
    return entry;
  }

  /**
   * @param {import('../../mesh/MeshData.js').MeshData} mesh
   * @returns {{vertexBuffer: any, vertexCount: number, indexBuffer?: any, indexCount?: number, uvMaskBuffer?: any, version: number, mesh: import('../../mesh/MeshData.js').MeshData}}
   */
  get(mesh) {
    const existing = this.cache.get(mesh.id);
    if (existing && existing.version === mesh.meshVersion && existing.mesh === mesh) return existing;
    if (existing) {
      this.device.dispose(existing.vertexBuffer);
      if (existing.indexBuffer) this.device.dispose(existing.indexBuffer);
      if (existing.uvMaskBuffer) this.device.dispose(existing.uvMaskBuffer);
    }
    let entry;
    if (mesh.layout === 'terrain') {
      // ME-06: indexed layout - upload both the interleaved vertex buffer
      // and mesh.idx's index buffer (a chunk's topology is static per
      // width/tile shape, 27.15.5 - only the front/back vertex data
      // changes on a band flip, keyed by the SAME `meshVersion`).
      const data = buildTerrainVertexData(mesh);
      const vertexBuffer = this.device.createBuffer({ usage: 'vertex', data: new Uint8Array(data) });
      const indexBuffer = this.device.createBuffer({ usage: 'index', data: mesh.idx });
      entry = {
        vertexBuffer, indexBuffer, version: mesh.meshVersion, mesh,
        vertexCount: mesh.pos.length / 3, indexCount: mesh.idx.length,
      };
    } else if (mesh.layout === 'static') {
      const data = buildStaticVertexData(mesh);
      const vertexBuffer = this.device.createBuffer({ usage: 'vertex', data: new Uint8Array(data) });
      entry = /** @type {any} */ ({ vertexBuffer, version: mesh.meshVersion, mesh, vertexCount: mesh.pos.length / 3 });
      // ALPHA-01c: per-vertex mask uv as its own stream (the 64 B static stride is unchanged); masked-range draws bind it as an extra stream
      if (mesh.uvMask) entry.uvMaskBuffer = this.device.createBuffer({ usage: 'vertex', data: mesh.uvMask });
    } else {
      throw new Error(`MeshBuffers.get: mesh "${mesh.id}" has unsupported layout "${mesh.layout}" (static/terrain only - ME-06)`);
    }
    this.cache.set(mesh.id, entry);
    return entry;
  }

  /** Frees every cached buffer (context loss / world unload). */
  dispose() {
    if (this._unsubEvict) { this._unsubEvict(); this._unsubEvict = null; }
    for (const entry of this.cache.values()) {
      this.device.dispose(entry.vertexBuffer);
      if (entry.indexBuffer) this.device.dispose(entry.indexBuffer);
      if (entry.uvMaskBuffer) this.device.dispose(entry.uvMaskBuffer);
    }
    this.cache.clear();
    for (const entry of this.voxelCache.values()) {
      this.device.dispose(entry.vertexBuffer);
      this.device.dispose(entry.indexBuffer);
    }
    this.voxelCache.clear();
    for (const entry of this.clothCache.values()) {
      this.device.dispose(entry.vertexBuffer);
      this.device.dispose(entry.uvBuffer);
      this.device.dispose(entry.indexBuffer);
    }
    this.clothCache.clear();
  }
}
