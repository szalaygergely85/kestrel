// @ts-check
// engine/physics/bvh.js - ME-09 (docs/backlog.md, docs/architecture.md
// 27.15.7). Static triangle BVH: build once at load time (allocates), then
// zero-allocation queries. `refit` keeps the same topology for a mesh whose
// vertices move (grate collider, ME-11).
//
// engine/physics/* never imports engine/mesh/* at runtime (tools/check-deps.mjs
// rule 11 enforces this) - buildBvhFromMesh takes a MeshData-SHAPED plain
// object (duck-typed: .pos, .idx, .layout) as a parameter, never a live
// import of engine/mesh/MeshData.js. rigid.js/player code only ever gets
// indices, booleans and RayHit-shaped plain data back from this module -
// never raw nodes or triangles (27.10).
//
// Naming note vs. 27.15.7's Bvh typedef: the spec text lists a property
// named `nodeCount` twice - once as `number` (total node count) and once as
// `Int32Array` (per-node triangle count, inner 0, leaf 1..BVH_LEAF_MAX). One
// JS object can't have both under one key, so this implementation keeps
// `nodeCount` as the scalar total (paired with `triCount`, and matching the
// property's first, `number` occurrence in the doc) and names the per-node
// Int32Array `nodeTriCount`. Flagged for architect confirmation at review.

/** Max triangles per leaf. */
export const BVH_LEAF_MAX = 4;

/**
 * @typedef {Object} Bvh
 * @property {number} triCount
 * @property {number} nodeCount
 * @property {Float64Array} tri          9 per triangle, world m, BVH order
 * @property {Int32Array} triId          BVH order -> source triangle index (MeshData triangle)
 * @property {Float64Array} nodeMin      3 per node
 * @property {Float64Array} nodeMax      3 per node
 * @property {Int32Array} nodeStart      inner: left child (right = left + 1); leaf: first triangle (BVH order)
 * @property {Int32Array} nodeTriCount   inner 0; leaf 1..BVH_LEAF_MAX (see naming note above)
 * @property {Int32Array} stack          traversal stack (depth + 2); queries are not re-entrant per Bvh
 */

/** @typedef {{t:number, tri:number, u:number, v:number, nx:number, ny:number, nz:number}} RayHit */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * World = A*p + t (matrix12: A row-major 3x3 then t; DrawItem layout). Writes
 * 3 floats into `out` at `off`. `matrix12` null = identity.
 * @param {Float64Array|null} matrix12
 * @param {number} x @param {number} y @param {number} z
 * @param {Float64Array} out @param {number} off
 */
function transformPoint(matrix12, x, y, z, out, off) {
  if (!matrix12) {
    out[off] = x; out[off + 1] = y; out[off + 2] = z;
    return;
  }
  const a00 = matrix12[0], a01 = matrix12[1], a02 = matrix12[2];
  const a10 = matrix12[3], a11 = matrix12[4], a12 = matrix12[5];
  const a20 = matrix12[6], a21 = matrix12[7], a22 = matrix12[8];
  const tx = matrix12[9], ty = matrix12[10], tz = matrix12[11];
  out[off] = a00 * x + a01 * y + a02 * z + tx;
  out[off + 1] = a10 * x + a11 * y + a12 * z + ty;
  out[off + 2] = a20 * x + a21 * y + a22 * z + tz;
}

/**
 * Source-triangle vertex indices for triangle `t` (unrolled static: t*3..+2;
 * indexed terrain: idx[t*3..+2]).
 * @param {Uint16Array|Uint32Array|null} idx
 * @param {number} t
 * @param {Int32Array} out - length 3
 */
function srcVertIndices(idx, t, out) {
  if (idx) {
    out[0] = idx[t * 3]; out[1] = idx[t * 3 + 1]; out[2] = idx[t * 3 + 2];
  } else {
    out[0] = t * 3; out[1] = t * 3 + 1; out[2] = t * 3 + 2;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * @param {Float32Array|Float64Array} pos
 * @param {Uint16Array|Uint32Array|null} idx - null = unrolled (3 verts/triangle in `pos`)
 * @param {Float64Array|null} matrix12 - null = identity
 * @returns {Bvh}
 */
export function buildBvh(pos, idx, matrix12) {
  const srcTriCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);

  // World-space triangle vertex data, SOURCE order (9 floats/tri).
  const srcTri = new Float64Array(srcTriCount * 9);
  const vi = new Int32Array(3);
  for (let t = 0; t < srcTriCount; t++) {
    srcVertIndices(idx, t, vi);
    const o = t * 9;
    transformPoint(matrix12, pos[vi[0] * 3], pos[vi[0] * 3 + 1], pos[vi[0] * 3 + 2], srcTri, o);
    transformPoint(matrix12, pos[vi[1] * 3], pos[vi[1] * 3 + 1], pos[vi[1] * 3 + 2], srcTri, o + 3);
    transformPoint(matrix12, pos[vi[2] * 3], pos[vi[2] * 3 + 1], pos[vi[2] * 3 + 2], srcTri, o + 6);
  }

  // Centroids (float64, per 27.15.7).
  const ccx = new Float64Array(srcTriCount);
  const ccy = new Float64Array(srcTriCount);
  const ccz = new Float64Array(srcTriCount);
  for (let t = 0; t < srcTriCount; t++) {
    const o = t * 9;
    ccx[t] = (srcTri[o] + srcTri[o + 3] + srcTri[o + 6]) / 3;
    ccy[t] = (srcTri[o + 1] + srcTri[o + 4] + srcTri[o + 7]) / 3;
    ccz[t] = (srcTri[o + 2] + srcTri[o + 5] + srcTri[o + 8]) / 3;
  }

  // `order[i]` = source triangle index currently at BVH position i; permuted
  // in place while building, ends up as the final BVH-order -> source map.
  const order = new Int32Array(srcTriCount);
  for (let t = 0; t < srcTriCount; t++) order[t] = t;

  // Full binary tree: L leaves (L <= srcTriCount, when srcTriCount > 0) ->
  // 2L-1 nodes total. Upper bound, trimmed after build.
  const maxNodes = srcTriCount > 0 ? Math.max(1, 2 * srcTriCount - 1) : 1;
  const nodeMin = new Float64Array(maxNodes * 3);
  const nodeMax = new Float64Array(maxNodes * 3);
  const nodeStart = new Int32Array(maxNodes);
  const nodeTriCount = new Int32Array(maxNodes);
  let nodesUsed = 0;
  let maxDepth = 0;

  /** @param {number[]} arr - source triangle ids, sorted in place by centroid on `axis` */
  function sortByCentroid(arr, axis) {
    const key = axis === 0 ? ccx : axis === 1 ? ccy : ccz;
    arr.sort((a, b) => {
      const va = key[a], vb = key[b];
      if (va < vb) return -1;
      if (va > vb) return 1;
      return a - b; // deterministic tie-break: source index
    });
  }

  /**
   * Fills the already-allocated node slot `nodeIdx` for range [start, start+count).
   * @param {number} nodeIdx @param {number} start @param {number} count @param {number} depth
   */
  function buildRange(nodeIdx, start, count, depth) {
    if (depth > maxDepth) maxDepth = depth;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = order[i];
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        const vx = srcTri[o + k * 3], vy = srcTri[o + k * 3 + 1], vz = srcTri[o + k * 3 + 2];
        if (vx < minx) minx = vx; if (vy < miny) miny = vy; if (vz < minz) minz = vz;
        if (vx > maxx) maxx = vx; if (vy > maxy) maxy = vy; if (vz > maxz) maxz = vz;
      }
    }
    const b = nodeIdx * 3;
    nodeMin[b] = minx; nodeMin[b + 1] = miny; nodeMin[b + 2] = minz;
    nodeMax[b] = maxx; nodeMax[b + 1] = maxy; nodeMax[b + 2] = maxz;

    if (count <= BVH_LEAF_MAX) {
      nodeStart[nodeIdx] = start;
      nodeTriCount[nodeIdx] = count;
      return;
    }

    // Longest axis of the CENTROID bounds; ties x, y, z (strict > only).
    let cminx = Infinity, cminy = Infinity, cminz = Infinity;
    let cmaxx = -Infinity, cmaxy = -Infinity, cmaxz = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = order[i];
      const x = ccx[t], y = ccy[t], z = ccz[t];
      if (x < cminx) cminx = x; if (y < cminy) cminy = y; if (z < cminz) cminz = z;
      if (x > cmaxx) cmaxx = x; if (y > cmaxy) cmaxy = y; if (z > cmaxz) cmaxz = z;
    }
    const ex = cmaxx - cminx, ey = cmaxy - cminy, ez = cmaxz - cminz;
    let axis = 0;
    if (ey > ex) axis = 1;
    if (axis === 0 ? ez > ex : ez > ey) axis = 2;

    const slice = Array.from(order.subarray(start, start + count));
    sortByCentroid(slice, axis);
    for (let i = 0; i < count; i++) order[start + i] = slice[i];

    const mid = start + (count >> 1);
    const leftIdx = nodesUsed++;
    const rightIdx = nodesUsed++; // adjacent: rightIdx === leftIdx + 1
    nodeStart[nodeIdx] = leftIdx;
    nodeTriCount[nodeIdx] = 0;
    buildRange(leftIdx, start, mid - start, depth + 1);
    buildRange(rightIdx, mid, start + count - mid, depth + 1);
  }

  const rootIdx = nodesUsed++;
  buildRange(rootIdx, 0, srcTriCount, 0);

  // Trim to actual size and reorder tri/triId into final BVH order.
  const tri = new Float64Array(srcTriCount * 9);
  const triId = new Int32Array(srcTriCount);
  for (let i = 0; i < srcTriCount; i++) {
    const t = order[i];
    triId[i] = t;
    const so = t * 9, o = i * 9;
    for (let k = 0; k < 9; k++) tri[o + k] = srcTri[so + k];
  }

  return {
    triCount: srcTriCount,
    nodeCount: nodesUsed,
    tri,
    triId,
    nodeMin: nodeMin.slice(0, nodesUsed * 3),
    nodeMax: nodeMax.slice(0, nodesUsed * 3),
    nodeStart: nodeStart.slice(0, nodesUsed),
    nodeTriCount: nodeTriCount.slice(0, nodesUsed),
    stack: new Int32Array(maxDepth + 2),
  };
}

/**
 * Builds a BVH from a whole MeshData-shaped object (static or terrain) - a
 * plain duck-typed parameter, never a live `engine/mesh` import (see header).
 * @param {{pos: Float32Array|Float64Array, idx: Uint16Array|Uint32Array|null}} mesh
 * @param {Float64Array|null} matrix12
 * @returns {Bvh}
 */
export function buildBvhFromMesh(mesh, matrix12) {
  return buildBvh(mesh.pos, mesh.idx, matrix12);
}

/**
 * Recomputes world triangle data + node bounds for the SAME topology (grate
 * collider, ME-11). Zero allocation.
 * @param {Bvh} bvh
 * @param {Float32Array|Float64Array} pos
 * @param {Uint16Array|Uint32Array|null} idx
 * @param {Float64Array|null} matrix12
 */
export function refit(bvh, pos, idx, matrix12) {
  const triCount = bvh.triCount;
  if (triCount === 0) return; // ME-10a fix: an empty BVH has no root children to refit
  for (let i = 0; i < triCount; i++) {
    const t = bvh.triId[i];
    let i0, i1, i2;
    if (idx) { i0 = idx[t * 3]; i1 = idx[t * 3 + 1]; i2 = idx[t * 3 + 2]; }
    else { i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2; }
    const o = i * 9;
    transformPoint(matrix12, pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2], bvh.tri, o);
    transformPoint(matrix12, pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2], bvh.tri, o + 3);
    transformPoint(matrix12, pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2], bvh.tri, o + 6);
  }

  // Build allocates children (index > parent) before recursing into them, so
  // every descendant has a strictly greater index than its ancestors -
  // iterating node indices high-to-low always processes children first.
  for (let n = bvh.nodeCount - 1; n >= 0; n--) {
    const cnt = bvh.nodeTriCount[n];
    const b = n * 3;
    if (cnt > 0) {
      const start = bvh.nodeStart[n];
      let minx = Infinity, miny = Infinity, minz = Infinity;
      let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      for (let i = start; i < start + cnt; i++) {
        const o = i * 9;
        for (let k = 0; k < 3; k++) {
          const vx = bvh.tri[o + k * 3], vy = bvh.tri[o + k * 3 + 1], vz = bvh.tri[o + k * 3 + 2];
          if (vx < minx) minx = vx; if (vy < miny) miny = vy; if (vz < minz) minz = vz;
          if (vx > maxx) maxx = vx; if (vy > maxy) maxy = vy; if (vz > maxz) maxz = vz;
        }
      }
      bvh.nodeMin[b] = minx; bvh.nodeMin[b + 1] = miny; bvh.nodeMin[b + 2] = minz;
      bvh.nodeMax[b] = maxx; bvh.nodeMax[b + 1] = maxy; bvh.nodeMax[b + 2] = maxz;
    } else {
      const left = bvh.nodeStart[n], right = left + 1;
      const lb = left * 3, rb = right * 3;
      bvh.nodeMin[b] = Math.min(bvh.nodeMin[lb], bvh.nodeMin[rb]);
      bvh.nodeMin[b + 1] = Math.min(bvh.nodeMin[lb + 1], bvh.nodeMin[rb + 1]);
      bvh.nodeMin[b + 2] = Math.min(bvh.nodeMin[lb + 2], bvh.nodeMin[rb + 2]);
      bvh.nodeMax[b] = Math.max(bvh.nodeMax[lb], bvh.nodeMax[rb]);
      bvh.nodeMax[b + 1] = Math.max(bvh.nodeMax[lb + 1], bvh.nodeMax[rb + 1]);
      bvh.nodeMax[b + 2] = Math.max(bvh.nodeMax[lb + 2], bvh.nodeMax[rb + 2]);
    }
  }
}

// ---------------------------------------------------------------------------
// Queries (explicit stack, zero allocation, not re-entrant per Bvh)
// ---------------------------------------------------------------------------

/**
 * @param {Bvh} bvh
 * @param {number} x0 @param {number} y0 @param {number} z0
 * @param {number} x1 @param {number} y1 @param {number} z1
 * @param {Int32Array} out - BVH-order triangle indices
 * @param {number} maxOut
 * @returns {number} count written to `out`
 */
export function queryAABB(bvh, x0, y0, z0, x1, y1, z1, out, maxOut) {
  let count = 0;
  if (bvh.nodeCount === 0 || maxOut <= 0) return 0;
  const stack = bvh.stack;
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0 && count < maxOut) {
    const nodeIdx = stack[--sp];
    const b = nodeIdx * 3;
    if (bvh.nodeMax[b] < x0 || bvh.nodeMin[b] > x1 ||
        bvh.nodeMax[b + 1] < y0 || bvh.nodeMin[b + 1] > y1 ||
        bvh.nodeMax[b + 2] < z0 || bvh.nodeMin[b + 2] > z1) continue;
    const cnt = bvh.nodeTriCount[nodeIdx];
    if (cnt > 0) {
      const start = bvh.nodeStart[nodeIdx];
      for (let i = 0; i < cnt && count < maxOut; i++) {
        const ti = start + i;
        const o = ti * 9;
        let minx = bvh.tri[o], miny = bvh.tri[o + 1], minz = bvh.tri[o + 2];
        let maxx = minx, maxy = miny, maxz = minz;
        for (let k = 1; k < 3; k++) {
          const vx = bvh.tri[o + k * 3], vy = bvh.tri[o + k * 3 + 1], vz = bvh.tri[o + k * 3 + 2];
          if (vx < minx) minx = vx; if (vy < miny) miny = vy; if (vz < minz) minz = vz;
          if (vx > maxx) maxx = vx; if (vy > maxy) maxy = vy; if (vz > maxz) maxz = vz;
        }
        if (maxx < x0 || minx > x1 || maxy < y0 || miny > y1 || maxz < z0 || minz > z1) continue;
        out[count++] = ti;
      }
    } else {
      const left = bvh.nodeStart[nodeIdx];
      const right = left + 1;
      // Push right then left so left pops first (left-first order).
      stack[sp++] = right;
      stack[sp++] = left;
    }
  }
  return count;
}

/**
 * Robust slab test (handles axis-parallel rays without NaN): returns entry t
 * in [0, tMaxCur], or -1 on a miss.
 */
function slabEntry(minX, minY, minZ, maxX, maxY, maxZ, ox, oy, oz, dx, dy, dz, tMaxCur) {
  let t0 = 0, t1 = tMaxCur;
  if (dx === 0) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const invD = 1 / dx;
    let tn = (minX - ox) * invD, tf = (maxX - ox) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return -1;
  }
  if (dy === 0) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const invD = 1 / dy;
    let tn = (minY - oy) * invD, tf = (maxY - oy) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return -1;
  }
  if (dz === 0) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    const invD = 1 / dz;
    let tn = (minZ - oz) * invD, tf = (maxZ - oz) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return -1;
  }
  return t0;
}

/**
 * Double-sided Moeller-Trumbore against a stored (already-world) triangle.
 * Writes into the pre-existing `hit` scratch object (zero allocation) and
 * returns true on a strictly-closer hit than `hit.t` on entry (caller resets
 * `hit.t = tMax` first, or use the `raycast` wrapper below).
 */
function intersectTri(bvh, ti, ox, oy, oz, dx, dy, dz, bestT, hit) {
  const o = ti * 9;
  const p0x = bvh.tri[o], p0y = bvh.tri[o + 1], p0z = bvh.tri[o + 2];
  const p1x = bvh.tri[o + 3], p1y = bvh.tri[o + 4], p1z = bvh.tri[o + 5];
  const p2x = bvh.tri[o + 6], p2y = bvh.tri[o + 7], p2z = bvh.tri[o + 8];
  const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
  const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const invDet = 1 / det;
  const tvx = ox - p0x, tvy = oy - p0y, tvz = oz - p0z;
  const u = (tvx * px + tvy * py + tvz * pz) * invDet;
  if (u < 0 || u > 1) return false;
  const qx = tvy * e1z - tvz * e1y, qy = tvz * e1x - tvx * e1z, qz = tvx * e1y - tvy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  if (t < 0 || t >= bestT) return false;
  hit.t = t; hit.tri = ti; hit.u = u; hit.v = v;
  return true;
}

/** Unit winding normal of stored world triangle `ti`, written into `out` (RayHit-shaped). */
function writeHitNormal(bvh, ti, out) {
  const o = ti * 9;
  const p0x = bvh.tri[o], p0y = bvh.tri[o + 1], p0z = bvh.tri[o + 2];
  const p1x = bvh.tri[o + 3], p1y = bvh.tri[o + 4], p1z = bvh.tri[o + 5];
  const p2x = bvh.tri[o + 6], p2y = bvh.tri[o + 7], p2z = bvh.tri[o + 8];
  const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
  const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.nx = nx / len; out.ny = ny / len; out.nz = nz / len;
}

/**
 * Nearest hit in [0, tMax) (ME-10a fix: exclusive of tMax - `intersectTri`
 * rejects `t >= bestT`, and `bestT` starts at `tMax`). Visits the nearer
 * child first by slab entry (tie -> left), prunes by the current best t.
 * @param {Bvh} bvh
 * @param {number} ox @param {number} oy @param {number} oz
 * @param {number} dx @param {number} dy @param {number} dz
 * @param {number} tMax
 * @param {RayHit} out
 * @returns {boolean}
 */
export function raycast(bvh, ox, oy, oz, dx, dy, dz, tMax, out) {
  if (bvh.nodeCount === 0) return false;
  const stack = bvh.stack;
  let sp = 0;
  stack[sp++] = 0;
  let bestT = tMax;
  let bestTri = -1;
  const hit = out; // reuse caller's object as scratch (zero allocation)
  hit.t = bestT;
  while (sp > 0) {
    const nodeIdx = stack[--sp];
    const b = nodeIdx * 3;
    const entry = slabEntry(
      bvh.nodeMin[b], bvh.nodeMin[b + 1], bvh.nodeMin[b + 2],
      bvh.nodeMax[b], bvh.nodeMax[b + 1], bvh.nodeMax[b + 2],
      ox, oy, oz, dx, dy, dz, bestT,
    );
    if (entry < 0 || entry > bestT) continue;
    const cnt = bvh.nodeTriCount[nodeIdx];
    if (cnt > 0) {
      const start = bvh.nodeStart[nodeIdx];
      for (let i = 0; i < cnt; i++) {
        const ti = start + i;
        if (intersectTri(bvh, ti, ox, oy, oz, dx, dy, dz, bestT, hit)) {
          bestT = hit.t;
          bestTri = ti;
        }
      }
    } else {
      const left = bvh.nodeStart[nodeIdx];
      const right = left + 1;
      const lb = left * 3, rb = right * 3;
      const entryL = slabEntry(
        bvh.nodeMin[lb], bvh.nodeMin[lb + 1], bvh.nodeMin[lb + 2],
        bvh.nodeMax[lb], bvh.nodeMax[lb + 1], bvh.nodeMax[lb + 2],
        ox, oy, oz, dx, dy, dz, bestT,
      );
      const entryR = slabEntry(
        bvh.nodeMin[rb], bvh.nodeMin[rb + 1], bvh.nodeMin[rb + 2],
        bvh.nodeMax[rb], bvh.nodeMax[rb + 1], bvh.nodeMax[rb + 2],
        ox, oy, oz, dx, dy, dz, bestT,
      );
      const hitL = entryL >= 0, hitR = entryR >= 0;
      if (hitL && hitR) {
        // Nearer first; tie -> left. LIFO stack: push the farther one first.
        if (entryL <= entryR) { stack[sp++] = right; stack[sp++] = left; }
        else { stack[sp++] = left; stack[sp++] = right; }
      } else if (hitL) {
        stack[sp++] = left;
      } else if (hitR) {
        stack[sp++] = right;
      }
    }
  }
  if (bestTri < 0) return false;
  writeHitNormal(bvh, bestTri, out);
  out.t = bestT;
  out.tri = bestTri;
  return true;
}

/**
 * Early-out existence test (shadow rays / VPL visibility, later use).
 * @param {Bvh} bvh
 * @param {number} ox @param {number} oy @param {number} oz
 * @param {number} dx @param {number} dy @param {number} dz
 * @param {number} tMax
 * @returns {boolean}
 */
export function raycastAny(bvh, ox, oy, oz, dx, dy, dz, tMax) {
  if (bvh.nodeCount === 0) return false;
  const stack = bvh.stack;
  let sp = 0;
  stack[sp++] = 0;
  const scratch = _anyScratch;
  scratch.t = tMax;
  while (sp > 0) {
    const nodeIdx = stack[--sp];
    const b = nodeIdx * 3;
    const entry = slabEntry(
      bvh.nodeMin[b], bvh.nodeMin[b + 1], bvh.nodeMin[b + 2],
      bvh.nodeMax[b], bvh.nodeMax[b + 1], bvh.nodeMax[b + 2],
      ox, oy, oz, dx, dy, dz, tMax,
    );
    if (entry < 0) continue;
    const cnt = bvh.nodeTriCount[nodeIdx];
    if (cnt > 0) {
      const start = bvh.nodeStart[nodeIdx];
      for (let i = 0; i < cnt; i++) {
        if (intersectTri(bvh, start + i, ox, oy, oz, dx, dy, dz, tMax, scratch)) return true;
      }
    } else {
      const left = bvh.nodeStart[nodeIdx];
      const right = left + 1;
      stack[sp++] = right;
      stack[sp++] = left;
    }
  }
  return false;
}
/** Module-scratch RayHit-shaped object reused by `raycastAny` (zero allocation, not re-entrant). */
const _anyScratch = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };

/**
 * `raycast` with d = b - a, tMax = 1.
 * @param {Bvh} bvh
 * @param {number} ax @param {number} ay @param {number} az
 * @param {number} bx @param {number} by @param {number} bz
 * @param {RayHit} out
 * @returns {boolean}
 */
export function segment(bvh, ax, ay, az, bx, by, bz, out) {
  return raycast(bvh, ax, ay, az, bx - ax, by - ay, bz - az, 1, out);
}
