// @ts-check
// engine/mesh/culling.js - ME-02 (docs/backlog.md, docs/architecture.md
// 27.6, 27.15.3). AABB-vs-shear-frustum test used by `DrawList.build` (ME-03)
// to cull static mesh items before rasterising them. The frustum planes are
// derived from the exact `shearProjection` matrix (engine/render/
// projection.js) via the standard Gribb-Hartmann extraction - since that
// matrix's clip-space z already lands in OpenGL's [-1, 1] range (verified in
// projection.test.js: z_ndc(N) = -1, z_ndc(F) = 1), the textbook `w+z`
// (near) / `w-z` (far) planes apply unchanged.
//
// Hot path (called once per draw candidate per frame): no allocation, no
// closures, no destructuring, no returned objects - callers own `out24`/the
// AABB inputs.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (architecture.md 27.15.0). This file imports nothing.

/** `classifyAABB` result: box entirely outside at least one plane. */
export const CULL_OUT = 0;
/** `classifyAABB` result: box entirely inside every plane. */
export const CULL_IN = 1;
/** `classifyAABB` result: box crosses at least one plane, none fully excludes it. */
export const CULL_STRADDLE = 2;

/**
 * Extracts the 6 frustum planes (left, right, bottom, top, near, far) from a
 * `shearProjection` matrix `M` (column-major, `M[col*4+row]`, world -> clip)
 * by the standard Gribb-Hartmann method for an OpenGL-range clip space
 * (`z_ndc` in `[-1, 1]`). Each plane is 4 floats `(a, b, c, d)`, normalised so
 * `(a, b, c)` is unit length; a world point is inside iff
 * `a*x + b*y + c*z + d >= 0`. Zero allocation.
 * @param {Float64Array} M
 * @param {Float64Array} out24 - length >= 24, planes in order left, right, bottom, top, near, far
 * @returns {Float64Array}
 */
export function frustumPlanes(M, out24) {
  // Row extraction from column-major M[col*4+row]: row r's 4 coefficients
  // are M[0*4+r], M[1*4+r], M[2*4+r], M[3*4+r].
  const x0 = M[0], x1 = M[4], x2 = M[8], x3 = M[12]; // x_clip row
  const y0 = M[1], y1 = M[5], y2 = M[9], y3 = M[13]; // y_clip row
  const z0 = M[2], z1 = M[6], z2 = M[10], z3 = M[14]; // z_clip row
  const w0 = M[3], w1 = M[7], w2 = M[11], w3 = M[15]; // w_clip row

  writePlane(out24, 0, w0 + x0, w1 + x1, w2 + x2, w3 + x3); // left
  writePlane(out24, 4, w0 - x0, w1 - x1, w2 - x2, w3 - x3); // right
  writePlane(out24, 8, w0 + y0, w1 + y1, w2 + y2, w3 + y3); // bottom
  writePlane(out24, 12, w0 - y0, w1 - y1, w2 - y2, w3 - y3); // top
  writePlane(out24, 16, w0 + z0, w1 + z1, w2 + z2, w3 + z3); // near
  writePlane(out24, 20, w0 - z0, w1 - z1, w2 - z2, w3 - z3); // far
  return out24;
}

/**
 * Writes a normalised plane `(a, b, c, d)` into `out` at offset `o`.
 * @param {Float64Array} out
 * @param {number} o
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 */
function writePlane(out, o, a, b, c, d) {
  const len = Math.sqrt(a * a + b * b + c * c);
  const inv = len > 1e-20 ? 1 / len : 0;
  out[o] = a * inv;
  out[o + 1] = b * inv;
  out[o + 2] = c * inv;
  out[o + 3] = d * inv;
}

/**
 * Classifies a world-space AABB against the 6 planes from `frustumPlanes`
 * using the standard p-vertex/n-vertex test. Zero allocation.
 * @param {Float64Array} planes - as filled by `frustumPlanes` (24 floats)
 * @param {number} x0
 * @param {number} y0
 * @param {number} z0
 * @param {number} x1
 * @param {number} y1
 * @param {number} z1
 * @param {number} [marginM] - grows the box by this many metres along each plane normal (default 0)
 * @returns {0|1|2} CULL_OUT, CULL_IN or CULL_STRADDLE
 */
export function classifyAABB(planes, x0, y0, z0, x1, y1, z1, marginM) {
  const margin = marginM || 0;
  let straddling = false;
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const a = planes[o], b = planes[o + 1], c = planes[o + 2], d = planes[o + 3] + margin;
    // p-vertex: the AABB corner furthest along the plane normal.
    const px = a >= 0 ? x1 : x0;
    const py = b >= 0 ? y1 : y0;
    const pz = c >= 0 ? z1 : z0;
    if (a * px + b * py + c * pz + d < 0) return CULL_OUT;
    // n-vertex: the AABB corner nearest along the plane normal.
    const nx = a >= 0 ? x0 : x1;
    const ny = b >= 0 ? y0 : y1;
    const nz = c >= 0 ? z0 : z1;
    if (a * nx + b * ny + c * nz + d < 0) straddling = true;
  }
  return straddling ? CULL_STRADDLE : CULL_IN;
}
