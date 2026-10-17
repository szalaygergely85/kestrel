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

const nowMs = () => performance.now();

/** Triangles of node work between two clock reads in `BvhBuilder.step`. */
const STEP_CHECK_TRIS = 2048;

/**
 * Centroid order on one axis: key, then source index. A strict total order, so the sorted (or partitioned)
 * result never depends on the input order.
 * @param {Float64Array} key @param {number} a @param {number} b
 */
function lessC(key, a, b) { const ka = key[a], kb = key[b]; return ka < kb || (ka === kb && a < b); }

/** Insertion sort of order[lo..hi] (inclusive) by `lessC`. @param {Int32Array} order @param {Float64Array} key @param {number} lo @param {number} hi */
function sortSmall(order, key, lo, hi) {
  for (let i = lo + 1; i <= hi; i++) {
    const v = order[i];
    let j = i - 1;
    while (j >= lo && lessC(key, v, order[j])) { order[j + 1] = order[j]; j--; }
    order[j + 1] = v;
  }
}

/**
 * Quickselect: afterwards order[lo..nth-1] are the (nth-lo) smallest of order[lo..hi] (inclusive) by `lessC`.
 * Same split as a full sort (strict total order), O(n) instead of O(n log n).
 * @param {Int32Array} order @param {Float64Array} key @param {number} lo @param {number} hi @param {number} nth
 */
function selectNth(order, key, lo, hi, nth) {
  while (hi > lo) {
    if (hi - lo < 16) { sortSmall(order, key, lo, hi); return; }
    const m = (lo + hi) >> 1;
    let a = order[lo], b = order[m], t;
    const c = order[hi];
    if (lessC(key, b, a)) { t = a; a = b; b = t; }
    if (lessC(key, c, b)) { b = c; if (lessC(key, b, a)) b = a; }
    const pv = b; // median of three
    let i = lo, j = hi;
    while (i <= j) {
      while (lessC(key, order[i], pv)) i++;
      while (lessC(key, pv, order[j])) j--;
      if (i <= j) { t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
    }
    if (nth <= j) hi = j; else if (nth >= i) lo = i; else return;
  }
}

/**
 * PERF-03: resumable static-BVH build (`step(ms)` until true, then `result`). Produces the SAME Bvh bit for bit as
 * the former recursive build: the explicit stack visits nodes depth-first left-before-right (same node indices),
 * the centroid order is a strict total order (so a quickselect split at `mid` = the old full sort's halves), and a
 * half that becomes a leaf is fully sorted (its triangle order = the old sorted order). Allocates (load/bake time).
 */
export class BvhBuilder {
  /**
   * @param {Float32Array|Float64Array} pos
   * @param {Uint16Array|Uint32Array|null} idx - null = unrolled (3 verts/triangle in `pos`)
   * @param {Float64Array|null} matrix12 - null = identity
   */
  constructor(pos, idx, matrix12) {
    const n = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
    this.n = n;
    // World-space triangle vertex data, SOURCE order (9 floats/tri).
    const srcTri = new Float64Array(n * 9);
    const vi = new Int32Array(3);
    for (let t = 0; t < n; t++) {
      srcVertIndices(idx, t, vi);
      const o = t * 9;
      transformPoint(matrix12, pos[vi[0] * 3], pos[vi[0] * 3 + 1], pos[vi[0] * 3 + 2], srcTri, o);
      transformPoint(matrix12, pos[vi[1] * 3], pos[vi[1] * 3 + 1], pos[vi[1] * 3 + 2], srcTri, o + 3);
      transformPoint(matrix12, pos[vi[2] * 3], pos[vi[2] * 3 + 1], pos[vi[2] * 3 + 2], srcTri, o + 6);
    }
    // Centroids (float64, per 27.15.7).
    const ccx = new Float64Array(n), ccy = new Float64Array(n), ccz = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      ccx[t] = (srcTri[o] + srcTri[o + 3] + srcTri[o + 6]) / 3;
      ccy[t] = (srcTri[o + 1] + srcTri[o + 4] + srcTri[o + 7]) / 3;
      ccz[t] = (srcTri[o + 2] + srcTri[o + 5] + srcTri[o + 8]) / 3;
    }
    // `order[i]` = source triangle at BVH position i; permuted in place, ends as the BVH-order -> source map.
    const order = new Int32Array(n);
    for (let t = 0; t < n; t++) order[t] = t;
    /** @type {{srcTri:Float64Array, ccx:Float64Array, ccy:Float64Array, ccz:Float64Array, order:Int32Array}|null} build buffers, dropped by _finish */
    this.buf = { srcTri, ccx, ccy, ccz, order };
    // Full binary tree: L <= n leaves -> 2L-1 nodes. Upper bound, trimmed at the end.
    const maxNodes = n > 0 ? Math.max(1, 2 * n - 1) : 1;
    this.nodeMin = new Float64Array(maxNodes * 3);
    this.nodeMax = new Float64Array(maxNodes * 3);
    this.nodeStart = new Int32Array(maxNodes);
    this.nodeTriCount = new Int32Array(maxNodes);
    this.nodesUsed = 1; // root = node 0
    this.maxDepth = 0;
    /** @type {number[]} pending nodes, 4 ints each: nodeIdx, start, count, depth */
    this.stack = [0, 0, n, 0];
    /** @type {Bvh|null} */
    this.result = null;
  }

  /** Builds nodes for about `ms` milliseconds (>= 1 node per call). True when `result` is set. @param {number} ms */
  step(ms) {
    if (this.result) return true;
    const st = this.stack, t0 = nowMs();
    let work = 0, nodes = 0;
    while (st.length) {
      const depth = /** @type {number} */ (st.pop()), count = /** @type {number} */ (st.pop());
      const start = /** @type {number} */ (st.pop()), nodeIdx = /** @type {number} */ (st.pop());
      this._node(nodeIdx, start, count, depth);
      work += count; nodes++;
      if (work >= STEP_CHECK_TRIS) { work = 0; if (nowMs() - t0 >= ms) return false; }
    }
    if (nodes && nowMs() - t0 >= ms) return false; // budget spent: the final copy gets a call of its own
    this._finish();
    return true;
  }

  /**
   * Fills node `nodeIdx` for range [start, start+count) and queues its children (left is popped first).
   * @param {number} nodeIdx @param {number} start @param {number} count @param {number} depth
   */
  _node(nodeIdx, start, count, depth) {
    const { srcTri, ccx, ccy, ccz, order } = /** @type {NonNullable<BvhBuilder['buf']>} */ (this.buf);
    if (depth > this.maxDepth) this.maxDepth = depth;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = start; i < start + count; i++) {
      const o = order[i] * 9;
      for (let k = 0; k < 3; k++) {
        const vx = srcTri[o + k * 3], vy = srcTri[o + k * 3 + 1], vz = srcTri[o + k * 3 + 2];
        if (vx < minx) minx = vx; if (vy < miny) miny = vy; if (vz < minz) minz = vz;
        if (vx > maxx) maxx = vx; if (vy > maxy) maxy = vy; if (vz > maxz) maxz = vz;
      }
    }
    const b = nodeIdx * 3;
    this.nodeMin[b] = minx; this.nodeMin[b + 1] = miny; this.nodeMin[b + 2] = minz;
    this.nodeMax[b] = maxx; this.nodeMax[b + 1] = maxy; this.nodeMax[b + 2] = maxz;

    if (count <= BVH_LEAF_MAX) {
      this.nodeStart[nodeIdx] = start;
      this.nodeTriCount[nodeIdx] = count;
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
    const key = axis === 0 ? ccx : axis === 1 ? ccy : ccz;

    const mid = start + (count >> 1), end = start + count - 1;
    selectNth(order, key, start, end, mid);
    if (mid - start <= BVH_LEAF_MAX) sortSmall(order, key, start, mid - 1); // leaf halves keep the sorted order
    if (end + 1 - mid <= BVH_LEAF_MAX) sortSmall(order, key, mid, end);

    const leftIdx = this.nodesUsed++;
    const rightIdx = this.nodesUsed++; // adjacent: rightIdx === leftIdx + 1
    this.nodeStart[nodeIdx] = leftIdx;
    this.nodeTriCount[nodeIdx] = 0;
    this.stack.push(rightIdx, mid, start + count - mid, depth + 1, leftIdx, start, mid - start, depth + 1);
  }

  /** Trims to the used node count and reorders tri/triId into BVH order. */
  _finish() {
    const { srcTri, order } = /** @type {NonNullable<BvhBuilder['buf']>} */ (this.buf);
    const n = this.n, nu = this.nodesUsed;
    const tri = new Float64Array(n * 9);
    const triId = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const t = order[i];
      triId[i] = t;
      const so = t * 9, o = i * 9;
      for (let k = 0; k < 9; k++) tri[o + k] = srcTri[so + k];
    }
    this.result = {
      triCount: n,
      nodeCount: nu,
      tri,
      triId,
      nodeMin: this.nodeMin.slice(0, nu * 3),
      nodeMax: this.nodeMax.slice(0, nu * 3),
      nodeStart: this.nodeStart.slice(0, nu),
      nodeTriCount: this.nodeTriCount.slice(0, nu),
      stack: new Int32Array(this.maxDepth + 2),
    };
    this.buf = null; // free the build buffers
  }
}

/**
 * @param {Float32Array|Float64Array} pos
 * @param {Uint16Array|Uint32Array|null} idx - null = unrolled (3 verts/triangle in `pos`)
 * @param {Float64Array|null} matrix12 - null = identity
 * @returns {Bvh}
 */
export function buildBvh(pos, idx, matrix12) {
  const b = new BvhBuilder(pos, idx, matrix12);
  b.step(Infinity);
  return /** @type {Bvh} */ (b.result);
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

// Ray scratch: ox,oy,oz,dx,dy,dz, tMaxCur (6), slab entry t (7). Passing doubles as args/returns to the non-inlined helpers boxes
// them (~128 B/ray, GATE-FLAKY-02a part A2). Re-entrancy-safe: raycast/raycastAny never call themselves or user code while RAY is live.
const RAY = new Float64Array(8);
/** Layout length of the caller-owned ray array `[ox,oy,oz,dx,dy,dz,tMax]` taken by `raycastRay`/`raycastAnyRay`. */
export const RAY_LEN = 7;
// Private arg array for the scalar wrappers (`raycast`, `raycastAny`, `segment`). Convenience, cold paths only.
const _ARG = new Float64Array(RAY_LEN);
/**
 * Robust slab test (handles axis-parallel rays without NaN) of node `node` against RAY (tMaxCur = RAY[6]):
 * returns true on a hit and writes the entry t in [0, tMaxCur] to RAY[7]; false on a miss.
 */
function slabEntry(bvh, node) {
  const b = node * 3;
  const minX = bvh.nodeMin[b], minY = bvh.nodeMin[b + 1], minZ = bvh.nodeMin[b + 2];
  const maxX = bvh.nodeMax[b], maxY = bvh.nodeMax[b + 1], maxZ = bvh.nodeMax[b + 2];
  const ox = RAY[0], oy = RAY[1], oz = RAY[2], dx = RAY[3], dy = RAY[4], dz = RAY[5];
  let t0 = 0, t1 = RAY[6];
  if (dx === 0) {
    if (ox < minX || ox > maxX) return false;
  } else {
    const invD = 1 / dx;
    let tn = (minX - ox) * invD, tf = (maxX - ox) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return false;
  }
  if (dy === 0) {
    if (oy < minY || oy > maxY) return false;
  } else {
    const invD = 1 / dy;
    let tn = (minY - oy) * invD, tf = (maxY - oy) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return false;
  }
  if (dz === 0) {
    if (oz < minZ || oz > maxZ) return false;
  } else {
    const invD = 1 / dz;
    let tn = (minZ - oz) * invD, tf = (maxZ - oz) * invD;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return false;
  }
  RAY[7] = t0;
  return true;
}

/**
 * Double-sided Moeller-Trumbore against a stored (already-world) triangle.
 * Writes into the pre-existing `hit` scratch object (zero allocation) and
 * returns true on a strictly-closer hit than `hit.t` on entry (caller resets
 * `hit.t = tMax` first, or use the `raycast` wrapper below).
 */
function intersectTri(bvh, ti, hit) {
  const ox = RAY[0], oy = RAY[1], oz = RAY[2], dx = RAY[3], dy = RAY[4], dz = RAY[5], bestT = RAY[6];
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
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
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
 * Convenience, cold paths only (scalar args box at the call boundary); hot callers use `raycastRay`.
 */
export function raycast(bvh, ox, oy, oz, dx, dy, dz, tMax, out) {
  const r = _ARG;
  r[0] = ox; r[1] = oy; r[2] = oz; r[3] = dx; r[4] = dy; r[5] = dz; r[6] = tMax;
  return raycastRay(bvh, r, out);
}

/**
 * Hot-path form of `raycast`: `ray` is a caller-owned Float64Array(RAY_LEN) `[ox,oy,oz,dx,dy,dz,tMax]`, read-only here.
 * @param {Bvh} bvh @param {Float64Array} ray @param {RayHit} out
 * @returns {boolean}
 */
export function raycastRay(bvh, ray, out) {
  if (bvh.nodeCount === 0) return false;
  const stack = bvh.stack;
  let sp = 0;
  stack[sp++] = 0;
  let bestT = ray[6];
  RAY[0] = ray[0]; RAY[1] = ray[1]; RAY[2] = ray[2]; RAY[3] = ray[3]; RAY[4] = ray[4]; RAY[5] = ray[5]; RAY[6] = bestT;
  let bestTri = -1;
  const hit = out; // reuse caller's object as scratch (zero allocation)
  hit.t = bestT;
  while (sp > 0) {
    const nodeIdx = stack[--sp];
    if (!slabEntry(bvh, nodeIdx) || RAY[7] > bestT) continue;
    const cnt = bvh.nodeTriCount[nodeIdx];
    if (cnt > 0) {
      const start = bvh.nodeStart[nodeIdx];
      for (let i = 0; i < cnt; i++) {
        const ti = start + i;
        if (intersectTri(bvh, ti, hit)) {
          bestT = hit.t; RAY[6] = bestT;
          bestTri = ti;
        }
      }
    } else {
      const left = bvh.nodeStart[nodeIdx];
      const right = left + 1;
      const hitL = slabEntry(bvh, left), entryL = RAY[7];
      const hitR = slabEntry(bvh, right), entryR = RAY[7];
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
 * Convenience, cold paths only; hot callers use `raycastAnyRay`.
 */
export function raycastAny(bvh, ox, oy, oz, dx, dy, dz, tMax) {
  const r = _ARG;
  r[0] = ox; r[1] = oy; r[2] = oz; r[3] = dx; r[4] = dy; r[5] = dz; r[6] = tMax;
  return raycastAnyRay(bvh, r);
}

/**
 * Hot-path form of `raycastAny`: `ray` = caller-owned Float64Array(RAY_LEN) `[ox,oy,oz,dx,dy,dz,tMax]`, read-only.
 * @param {Bvh} bvh @param {Float64Array} ray
 * @returns {boolean}
 */
export function raycastAnyRay(bvh, ray) {
  if (bvh.nodeCount === 0) return false;
  const stack = bvh.stack;
  let sp = 0;
  stack[sp++] = 0;
  const scratch = _anyScratch;
  scratch.t = ray[6];
  RAY[0] = ray[0]; RAY[1] = ray[1]; RAY[2] = ray[2]; RAY[3] = ray[3]; RAY[4] = ray[4]; RAY[5] = ray[5]; RAY[6] = ray[6];
  while (sp > 0) {
    const nodeIdx = stack[--sp];
    if (!slabEntry(bvh, nodeIdx)) continue;
    const cnt = bvh.nodeTriCount[nodeIdx];
    if (cnt > 0) {
      const start = bvh.nodeStart[nodeIdx];
      for (let i = 0; i < cnt; i++) {
        if (intersectTri(bvh, start + i, scratch)) return true;
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
  const r = _ARG;
  r[0] = ax; r[1] = ay; r[2] = az; r[3] = bx - ax; r[4] = by - ay; r[5] = bz - az; r[6] = 1;
  return raycastRay(bvh, r, out);
}
