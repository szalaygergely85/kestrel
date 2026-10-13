// engine/mesh/vertexAo.js (ME-20c / architect note 38.18): the shared corner rule for baked vertex AO.
// `gltf-import --ao` (ME-20a) stores per-triangle-corner visibility (1 = open) in aux[5..7], flat over a triangle's three
// vertices: vertex v = 3t + c reads lane 5 + c. Kind-9 (KIND_MESH) static meshes only. Pure; imports MeshData constants.
import { AUX_STRIDE, FLAT_STRIDE, flatKind } from './MeshData.js';

const KIND_MESH_ID = 9; // GBuffer.KIND_MESH (kept literal: this module must not pull the render layer in)
const _cache = new WeakMap();

/** AO of vertex `v` (corner rule): `aux[v*AUX_STRIDE + 5 + v % 3]`. */
export function vertexAoAt(mesh, v) {
  return mesh.aux[v * AUX_STRIDE + 5 + (v % 3)];
}

/** True when a static mesh has any non-zero lane 5..7 on a kind-9 vertex (meshes are immutable once built: cached). */
export function meshHasVertexAo(mesh) {
  if (!mesh || mesh.layout !== 'static' || !mesh.aux || !mesh.flat) return false;
  let r = _cache.get(mesh);
  if (r !== undefined) return r;
  r = false;
  const V = mesh.flat.length / FLAT_STRIDE;
  for (let v = 0; v < V && !r; v++) {
    if (flatKind(mesh.flat[v * FLAT_STRIDE + 1]) !== KIND_MESH_ID) continue;
    const o = v * AUX_STRIDE;
    if (mesh.aux[o + 5] !== 0 || mesh.aux[o + 6] !== 0 || mesh.aux[o + 7] !== 0) r = true;
  }
  _cache.set(mesh, r);
  return r;
}
