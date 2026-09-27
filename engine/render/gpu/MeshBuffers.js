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
// file grows incrementally, not all at once): `static` layout only
// (engine/mesh/levelMesh.js's level meshes - the tower). `terrain`-layout
// MeshData (indexed, ME-05/ME-06) and per-part voxel instancing (ME-07/08)
// are a later story's addition to this same cache, not implemented here -
// `get()` throws a clear error on a non-static mesh so a caller finds out
// immediately rather than uploading garbage.
//
// Vertex layout (27.15.0 amendment 2, "Static vertex layout"): interleaved,
// stride 64 bytes = pos(12) + uv(8) + nrm(4) + flat(8) + aux(32). One
// ArrayBuffer, three typed-array VIEWS over it (Float32Array for the float
// fields, Uint32Array for the two uint32 ones) so `nrm`/`flat`'s exact bit
// patterns survive the upload unchanged (never round-tripped through a
// float).
import { AUX_STRIDE, FLAT_STRIDE } from '../../mesh/MeshData.js';

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
    /** @type {Map<string, {vertexBuffer: any, version: number, vertexCount: number}>} */
    this.cache = new Map();
  }

  /**
   * @param {import('../../mesh/MeshData.js').MeshData} mesh
   * @returns {{vertexBuffer: any, vertexCount: number}}
   */
  get(mesh) {
    const existing = this.cache.get(mesh.id);
    if (existing && existing.version === mesh.meshVersion) return existing;
    if (existing) this.device.dispose(existing.vertexBuffer);
    const data = buildStaticVertexData(mesh);
    const vertexBuffer = this.device.createBuffer({ usage: 'vertex', data: new Uint8Array(data) });
    const entry = { vertexBuffer, version: mesh.meshVersion, vertexCount: mesh.pos.length / 3 };
    this.cache.set(mesh.id, entry);
    return entry;
  }

  /** Frees every cached buffer (context loss / world unload). */
  dispose() {
    for (const entry of this.cache.values()) this.device.dispose(entry.vertexBuffer);
    this.cache.clear();
  }
}
