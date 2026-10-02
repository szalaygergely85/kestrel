// @ts-check
// engine/mesh/clothMesh.js - CLOTH-1b1 (docs/architecture.md 33.1 item 3, 33.5). The deformable
// indexed MeshData layout 'cloth' built from an `engine/physics/cloth.js` cloth:
//   pos (mesh-local = world - origin, so f32 keeps sub-mm precision far from the world origin),
//   nrm (packNormalOct of the smooth, area-weighted vertex normal, rewritten when the sim moved),
//   uv (rest-space metres, static), idx (the cloth's triangle list, static, shared by reference).
// Imports only engine/voxel/octNormal.js (27.15.0). Zero allocation per update.
//
// meshVersion ownership: the CLOTH SYSTEM (engine/world/cloths.js `tick`) bumps `mesh.meshVersion` when
// `cloth.version` changed (shadow dirty-skip, 27.9a amendment 4). `updateClothMesh` therefore only refreshes
// the arrays, gated on its own `clothVersion` stamp; pass `bump = true` for a mesh that has no system.
import { packNormalOct } from '../voxel/octNormal.js';

/**
 * @param {any} cloth - engine/physics/cloth.js cloth (pos Float64Array 3N, n, cols, rows, tri Uint16Array, version)
 * @param {string} id
 * @param {number} matId - resolved MaterialTable id (kind-8 mat of every fragment)
 * @param {ArrayLike<number>} origin - [x, y, z] world offset subtracted from positions (the draw item translates by it back)
 * @param {number} [du] - rest spacing along columns in metres (cloth system: size[0]/(cols-1)); omitted = measured from cloth.pos
 * @param {number} [dv] - rest spacing along rows in metres
 * @returns {any} MeshData with layout 'cloth' (+ `origin`, `matId`, `clothVersion`, private scratch)
 */
export function createClothMesh(cloth, id, matId, origin, du, dv) {
  const N = cloth.n, tri = cloth.tri;
  const cols = cloth.cols;
  const uv = new Float32Array(2 * N);
  // Rest-space metres: u along columns, v along rows. The cloth system passes the exact rest spacing (du, dv).
  // Fallback for system-less callers (tests): measured from cloth.pos NOW - only rest-space if the cloth has not
  // moved yet (a lazily created mesh of a simulated cloth must get du/dv from the system).
  const p = cloth.pos;
  const dc = du !== undefined ? du : cols > 1 ? Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]) : 1;
  const dr = dv !== undefined ? dv : cloth.rows > 1 ? Math.hypot(p[3 * cols] - p[0], p[3 * cols + 1] - p[1], p[3 * cols + 2] - p[2]) : 1;
  for (let i = 0; i < N; i++) { uv[2 * i] = (i % cols) * dc; uv[2 * i + 1] = Math.floor(i / cols) * dr; }
  const mesh = {
    version: 1,
    id: `cloth:${id}`,
    layout: 'cloth',
    pos: new Float32Array(3 * N),
    uv,
    nrm: new Uint32Array(N),
    flat: new Uint32Array(0),
    aux: new Float32Array(0),
    idx: tri,
    triCount: tri.length / 3,
    bbox: new Float64Array(6),
    ranges: [{ start: 0, count: tri.length / 3 }],
    matKeys: [],
    matsResolved: true,
    meshVersion: cloth.version,
    origin: new Float64Array([origin[0], origin[1], origin[2]]),
    matId,
    clothVersion: -1,
    _nrm64: new Float64Array(3 * N), // area-weighted accumulation scratch
  };
  updateClothMesh(mesh, cloth);
  return mesh;
}

/**
 * Copies positions (minus origin), recomputes smooth per-vertex normals and the bbox. No-op (returns false) when
 * `cloth.version` equals the stamp of the last update. Zero allocation.
 * @param {any} mesh
 * @param {any} cloth
 * @param {boolean} [bump] - also `mesh.meshVersion++` (only for meshes not driven by a cloth system)
 * @returns {boolean} true when the arrays were rewritten
 */
export function updateClothMesh(mesh, cloth, bump) {
  if (mesh.clothVersion === cloth.version) return false;
  mesh.clothVersion = cloth.version;
  const N = cloth.n, src = cloth.pos, dst = mesh.pos, org = mesh.origin;
  const ox = org[0], oy = org[1], oz = org[2];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = src[3 * i] - ox, y = src[3 * i + 1] - oy, z = src[3 * i + 2] - oz;
    dst[3 * i] = x; dst[3 * i + 1] = y; dst[3 * i + 2] = z;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const bb = mesh.bbox;
  bb[0] = x0; bb[1] = y0; bb[2] = z0; bb[3] = x1; bb[4] = y1; bb[5] = z1;

  // Vertex normal = sum of (unnormalised, i.e. area-weighted) face normals cross(b - a, c - a) of the triangles
  // that use the vertex. Computed from the f32 mesh positions, the same numbers the rasteriser sees.
  const acc = mesh._nrm64, idx = mesh.idx;
  acc.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = dst[b] - dst[a], uy = dst[b + 1] - dst[a + 1], uz = dst[b + 2] - dst[a + 2];
    const vx = dst[c] - dst[a], vy = dst[c + 1] - dst[a + 1], vz = dst[c + 2] - dst[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
  }
  const nrm = mesh.nrm;
  for (let i = 0; i < N; i++) {
    const nx = acc[3 * i], ny = acc[3 * i + 1], nz = acc[3 * i + 2];
    // a vertex used by no triangle (hole node) keeps +z; packNormalOct needs a non-zero vector
    nrm[i] = (nx === 0 && ny === 0 && nz === 0) ? packNormalOct(0, 0, 1) : packNormalOct(nx, ny, nz);
  }
  if (bump) mesh.meshVersion++;
  return true;
}
