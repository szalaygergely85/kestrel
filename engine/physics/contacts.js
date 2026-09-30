// @ts-check
// engine/physics/contacts.js - ME-11b (docs/backlog.md, docs/architecture.md
// 27.18 "The Rapier seam"). The one free-3D contact-manifold API a future
// rigid-body solver (`rigid.js`, US-051 - not built yet) will consume:
// sphere/capsule vs every triangle candidate from `world.colliders`'
// per-collider BVH (`queryAABB`), plus one heightfield contact from
// `world.terrain`. Nothing here decides movement or is called from
// `roller.js`/`integrate.js`/`Player.js` (those use `collideCircle`/
// `collideSphere`/`supportAt` - the 2.5D banded twins, 27.17); this module
// is a self-contained, independent surface, zero allocation per call.
//
// Closest-point math: Ericson, "Real-Time Collision Detection" 5.1.5
// (closest point on a triangle to a point) for `shape.type === 'sphere'`;
// for `shape.type === 'capsule'` the minimum distance between the vertical
// axis segment and the triangle is the smallest of five candidate pairs -
// point-vs-triangle at each axis endpoint (5.1.5 again) and segment-vs-segment
// (5.1.9's `ClosestPtSegmentSegment`) between the axis and each of the
// triangle's three edges. This is the standard reduction used for
// segment-vs-triangle closest points (every nearest-feature case - a face,
// an edge, or a vertex - is covered by one of those five pairs) and needs no
// heap allocation, unlike a general GJK/EPA distance query.
//
// `shape.z` is the Rapier-style shape-position convention (unlike
// `moveSphereMesh`/`moveCircleMesh`'s `z` = the sphere's bottom / capsule's
// footZ, engine/physics/meshCollide.js, which is a "feet" convention):
// a sphere's CENTRE is `(x, y, z)` directly, and a capsule's segment runs
// from `(x, y, z)` to `(x, y, z + h)` - `z` is the lower segment endpoint,
// not the feet. Callers that track feet (the 2.5D banded twins, 27.17)
// convert by adding the sphere radius before calling `contacts()`.
//
// Runtime imports: `./bvh.js` only (check-deps rule 11: engine/physics/**
// never imports engine/mesh/**).
import { queryAABB } from './bvh.js';

export const CONTACT_MAX = 16;

// Candidate triangles per collider per query - same budget class as
// meshCollide.js's MESH_CAND_MAX (256), plenty for any local contact patch.
const CAND_MAX = 256;

// ---------------------------------------------------------------------------
// Module scratch (zero allocation per call to `contacts()`; not re-entrant,
// as bvh.js's own queries - never call `contacts` from inside `contacts`).
// ---------------------------------------------------------------------------
const _cand = new Int32Array(CAND_MAX);
// Closest point on a triangle (closestPtPointTriangle's output).
const _tp = { x: 0, y: 0, z: 0 };
// Second closest-point-on-triangle scratch (capsule's second axis endpoint).
const _tp2 = { x: 0, y: 0, z: 0 };
// Segment-vs-segment scratch (closestPtSegmentSegment's output).
const _ss = { s: 0, t: 0, c1x: 0, c1y: 0, c1z: 0, c2x: 0, c2y: 0, c2z: 0, distSq: 0 };
// One confirmed contact, filled by {sphere,capsule}TriangleContact before
// being copied into the caller's ContactList.
const _hit = { depth: -Infinity, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0 };

/**
 * @typedef {Object} ContactList
 * @property {number} count
 * @property {Float64Array} px @property {Float64Array} py @property {Float64Array} pz
 * @property {Float64Array} nx @property {Float64Array} ny @property {Float64Array} nz
 * @property {Float64Array} depth
 * @property {Int32Array} collider  index into `world.colliders`
 * @property {Int32Array} tri       BVH-order triangle index within that collider (as `probeSupport`'s `floorTri`)
 */

/** A fresh, zeroed `ContactList` (CONTACT_MAX-sized parallel arrays), reused by the caller every step. @returns {ContactList} */
export function createContactList() {
  return {
    count: 0,
    px: new Float64Array(CONTACT_MAX),
    py: new Float64Array(CONTACT_MAX),
    pz: new Float64Array(CONTACT_MAX),
    nx: new Float64Array(CONTACT_MAX),
    ny: new Float64Array(CONTACT_MAX),
    nz: new Float64Array(CONTACT_MAX),
    depth: new Float64Array(CONTACT_MAX),
    collider: new Int32Array(CONTACT_MAX),
    tri: new Int32Array(CONTACT_MAX),
  };
}

// ---------------------------------------------------------------------------
// Ericson RTCD 5.1.5 - closest point on triangle ABC to point P.
// ---------------------------------------------------------------------------

/** Writes the closest point on triangle (a,b,c) to point (px,py,pz) into `out`. */
function closestPtPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out.x = ax; out.y = ay; out.z = az; return; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out.x = bx; out.y = by; out.z = bz; return; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.x = ax + v * abx; out.y = ay + v * aby; out.z = az + v * abz;
    return;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out.x = cx; out.y = cy; out.z = cz; return; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.x = ax + w * acx; out.y = ay + w * acy; out.z = az + w * acz;
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.x = bx + w * (cx - bx); out.y = by + w * (cy - by); out.z = bz + w * (cz - bz);
    return;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out.x = ax + abx * v + acx * w;
  out.y = ay + aby * v + acy * w;
  out.z = az + abz * v + acz * w;
}

// ---------------------------------------------------------------------------
// Ericson RTCD 5.1.9 - closest points between two segments.
// ---------------------------------------------------------------------------

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

/** Writes s, t and both closest points + squared distance into `out` for segments p1-q1 and p2-q2. */
function closestPtSegmentSegment(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, out) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-15;
  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0; s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1x = p1x + d1x * s, c1y = p1y + d1y * s, c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t, c2y = p2y + d2y * t, c2z = p2z + d2z * t;
  out.s = s; out.t = t;
  out.c1x = c1x; out.c1y = c1y; out.c1z = c1z;
  out.c2x = c2x; out.c2y = c2y; out.c2z = c2z;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  out.distSq = dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// Per-shape / per-triangle contact test. Writes into `_hit` (depth, contact
// point on the triangle, unit normal from the triangle point toward the
// shape) when the triangle is within `r` of the shape; `_hit.depth` is set
// to `-Infinity` (never a real depth, since a real depth is always <= r)
// when the triangle is too far.
// ---------------------------------------------------------------------------

/** Unit face normal of (a,b,c), written into `_hit.nx/ny/nz` - the only fallback when the closest distance is ~0 (degenerate: the shape's reference point sits exactly on the triangle). */
function faceNormalFallback(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  _hit.nx = nx / len; _hit.ny = ny / len; _hit.nz = nz / len;
}

const ZERO_DIST_EPS = 1e-12;

function sphereTriangleContact(cx0, cy0, cz0, r, ax, ay, az, bx, by, bz, cx, cy, cz) {
  closestPtPointTriangle(cx0, cy0, cz0, ax, ay, az, bx, by, bz, cx, cy, cz, _tp);
  const dx = cx0 - _tp.x, dy = cy0 - _tp.y, dz = cz0 - _tp.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist >= r) { _hit.depth = -Infinity; return; }
  _hit.depth = r - dist;
  _hit.px = _tp.x; _hit.py = _tp.y; _hit.pz = _tp.z;
  if (dist > ZERO_DIST_EPS) {
    _hit.nx = dx / dist; _hit.ny = dy / dist; _hit.nz = dz / dist;
  } else {
    faceNormalFallback(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
}

function capsuleTriangleContact(px, py, pz, qx, qy, qz, r, ax, ay, az, bx, by, bz, cx, cy, cz) {
  // Candidate 1/2: each axis endpoint vs the triangle (5.1.5).
  closestPtPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, _tp);
  let bestDistSq = (px - _tp.x) ** 2 + (py - _tp.y) ** 2 + (pz - _tp.z) ** 2;
  let bestAxX = px, bestAxY = py, bestAxZ = pz;
  let bestTpX = _tp.x, bestTpY = _tp.y, bestTpZ = _tp.z;

  closestPtPointTriangle(qx, qy, qz, ax, ay, az, bx, by, bz, cx, cy, cz, _tp2);
  const dq = (qx - _tp2.x) ** 2 + (qy - _tp2.y) ** 2 + (qz - _tp2.z) ** 2;
  if (dq < bestDistSq) {
    bestDistSq = dq; bestAxX = qx; bestAxY = qy; bestAxZ = qz;
    bestTpX = _tp2.x; bestTpY = _tp2.y; bestTpZ = _tp2.z;
  }

  // Candidates 3-5: the axis segment vs each triangle edge (5.1.9). Unrolled
  // (no array-of-arrays literal per call - that allocated 3 arrays/call and
  // broke the zero-allocation gate).
  closestPtSegmentSegment(px, py, pz, qx, qy, qz, ax, ay, az, bx, by, bz, _ss);
  if (_ss.distSq < bestDistSq) {
    bestDistSq = _ss.distSq;
    bestAxX = _ss.c1x; bestAxY = _ss.c1y; bestAxZ = _ss.c1z;
    bestTpX = _ss.c2x; bestTpY = _ss.c2y; bestTpZ = _ss.c2z;
  }
  closestPtSegmentSegment(px, py, pz, qx, qy, qz, bx, by, bz, cx, cy, cz, _ss);
  if (_ss.distSq < bestDistSq) {
    bestDistSq = _ss.distSq;
    bestAxX = _ss.c1x; bestAxY = _ss.c1y; bestAxZ = _ss.c1z;
    bestTpX = _ss.c2x; bestTpY = _ss.c2y; bestTpZ = _ss.c2z;
  }
  closestPtSegmentSegment(px, py, pz, qx, qy, qz, cx, cy, cz, ax, ay, az, _ss);
  if (_ss.distSq < bestDistSq) {
    bestDistSq = _ss.distSq;
    bestAxX = _ss.c1x; bestAxY = _ss.c1y; bestAxZ = _ss.c1z;
    bestTpX = _ss.c2x; bestTpY = _ss.c2y; bestTpZ = _ss.c2z;
  }

  const dist = Math.sqrt(bestDistSq);
  if (dist >= r) { _hit.depth = -Infinity; return; }
  _hit.depth = r - dist;
  _hit.px = bestTpX; _hit.py = bestTpY; _hit.pz = bestTpZ;
  if (dist > ZERO_DIST_EPS) {
    _hit.nx = (bestAxX - bestTpX) / dist; _hit.ny = (bestAxY - bestTpY) / dist; _hit.nz = (bestAxZ - bestTpZ) / dist;
  } else {
    faceNormalFallback(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
}

// ---------------------------------------------------------------------------
// Terrain (heightfield) contact - one contact, from `world.terrain`'s
// `groundAt`/`groundNormalAt` tangent plane under the sphere's CENTRE (x, y)
// (Rapier shape-position convention, see the file header: `shape.z` is the
// sphere's centre, not its feet). A sphere resting exactly on flat ground
// has its centre at `z = groundZ + r`, i.e. `dist === r`, `depth === 0`.
// ---------------------------------------------------------------------------
const _tn = { x: 0, y: 0, z: 0 };

function terrainContact(world, shape) {
  const groundZ = world.terrain.groundAt(shape.x, shape.y);
  const n = world.terrain.groundNormalAt(shape.x, shape.y, _tn);
  const cx = shape.x, cy = shape.y, cz = shape.z;
  // Signed distance from the centre to the ground's tangent plane along its
  // normal (positive = above ground).
  const dist = (cx - shape.x) * n.x + (cy - shape.y) * n.y + (cz - groundZ) * n.z;
  const depth = shape.r - dist;
  if (depth <= 0) { _hit.depth = -Infinity; return; }
  _hit.depth = depth;
  // Contact point: the centre projected onto the plane along the normal.
  _hit.px = cx - dist * n.x; _hit.py = cy - dist * n.y; _hit.pz = cz - dist * n.z;
  _hit.nx = n.x; _hit.ny = n.y; _hit.nz = n.z;
}

// ---------------------------------------------------------------------------
// Zero-allocation in-place insertion sort of the filled contacts by depth
// desc, then collider asc, then tri asc (CONTACT_MAX <= 16 - insertion sort
// is plenty; `Array.prototype.sort` over a typed array would allocate a
// temporary array under the hood via the comparator path, so this is
// hand-rolled over the parallel arrays directly).
// ---------------------------------------------------------------------------
function sortContacts(out) {
  const n = out.count;
  for (let i = 1; i < n; i++) {
    const px = out.px[i], py = out.py[i], pz = out.pz[i];
    const nx = out.nx[i], ny = out.ny[i], nz = out.nz[i];
    const depth = out.depth[i], collider = out.collider[i], tri = out.tri[i];
    let j = i - 1;
    while (j >= 0 && isBefore(depth, collider, tri, out.depth[j], out.collider[j], out.tri[j])) {
      out.px[j + 1] = out.px[j]; out.py[j + 1] = out.py[j]; out.pz[j + 1] = out.pz[j];
      out.nx[j + 1] = out.nx[j]; out.ny[j + 1] = out.ny[j]; out.nz[j + 1] = out.nz[j];
      out.depth[j + 1] = out.depth[j]; out.collider[j + 1] = out.collider[j]; out.tri[j + 1] = out.tri[j];
      j--;
    }
    out.px[j + 1] = px; out.py[j + 1] = py; out.pz[j + 1] = pz;
    out.nx[j + 1] = nx; out.ny[j + 1] = ny; out.nz[j + 1] = nz;
    out.depth[j + 1] = depth; out.collider[j + 1] = collider; out.tri[j + 1] = tri;
  }
}
/** True iff (depthA, colA, triA) sorts strictly before (depthB, colB, triB): depth desc, then collider asc, then tri asc. */
function isBefore(depthA, colA, triA, depthB, colB, triB) {
  if (depthA !== depthB) return depthA > depthB;
  if (colA !== colB) return colA < colB;
  return triA < triB;
}

// Writes `_hit` into `out` as contact `colliderIdx`/`triIdx`. When `out` is
// already at CONTACT_MAX, keeps the CONTACT_MAX DEEPEST contacts seen so far
// instead of the first CONTACT_MAX found: replaces the current shallowest
// entry only if `_hit.depth` is strictly deeper (ties keep the earlier-found
// contact, so results stay deterministic under a fixed candidate order).
// O(CONTACT_MAX) scan for the shallowest slot - CONTACT_MAX is <= 16, so this
// is cheaper than keeping a separate heap, and allocates nothing.
function pushContact(out, colliderIdx, triIdx) {
  if (out.count < CONTACT_MAX) {
    const idx = out.count++;
    out.px[idx] = _hit.px; out.py[idx] = _hit.py; out.pz[idx] = _hit.pz;
    out.nx[idx] = _hit.nx; out.ny[idx] = _hit.ny; out.nz[idx] = _hit.nz;
    out.depth[idx] = _hit.depth;
    out.collider[idx] = colliderIdx;
    out.tri[idx] = triIdx;
    return;
  }
  let minIdx = 0;
  let minDepth = out.depth[0];
  for (let i = 1; i < CONTACT_MAX; i++) {
    if (out.depth[i] < minDepth) { minDepth = out.depth[i]; minIdx = i; }
  }
  if (_hit.depth <= minDepth) return;
  out.px[minIdx] = _hit.px; out.py[minIdx] = _hit.py; out.pz[minIdx] = _hit.pz;
  out.nx[minIdx] = _hit.nx; out.ny[minIdx] = _hit.ny; out.nz[minIdx] = _hit.nz;
  out.depth[minIdx] = _hit.depth;
  out.collider[minIdx] = colliderIdx;
  out.tri[minIdx] = triIdx;
}

/**
 * Fills `out` with every contact between `shape` and `world.colliders`
 * (trimesh candidates via each collider's BVH `queryAABB`) plus, when
 * `world.terrain` exists, one heightfield contact under the shape's centre
 * (`shape.z`, the Rapier shape-position convention - see file header).
 * Sorted by `depth` desc, then `collider` asc, then `tri` asc. Keeps the
 * `CONTACT_MAX` DEEPEST contacts found (not just the first `CONTACT_MAX`):
 * once full, a new contact replaces the current shallowest entry only if it
 * is strictly deeper. No allocation, no error on truncation. Zero allocation.
 * @param {{colliders: Array<Object>, terrain?: Object}} world
 * @param {{type:'sphere'|'capsule', x:number, y:number, z:number, r:number, h?:number}} shape
 * @param {ContactList} out
 * @returns {number} out.count
 */
export function contacts(world, shape, out) {
  out.count = 0;
  const isCapsule = shape.type === 'capsule';
  const r = shape.r;
  const px = shape.x, py = shape.y, pz = shape.z;
  const qz = isCapsule ? pz + shape.h : pz;

  const shapeMinZ = (isCapsule ? Math.min(pz, qz) : pz) - r;
  const shapeMaxZ = (isCapsule ? Math.max(pz, qz) : pz) + r;
  const shapeMinX = px - r, shapeMaxX = px + r;
  const shapeMinY = py - r, shapeMaxY = py + r;

  const colliders = world.colliders || [];
  for (let ci = 0; ci < colliders.length; ci++) {
    const c = colliders[ci];
    if (!c.enabled || c.kind !== 'trimesh') continue;
    const min = c.min, max = c.max;
    if (min[0] > shapeMaxX || max[0] < shapeMinX
      || min[1] > shapeMaxY || max[1] < shapeMinY
      || min[2] > shapeMaxZ || max[2] < shapeMinZ) continue;

    const cnt = queryAABB(c.bvh, shapeMinX, shapeMinY, shapeMinZ, shapeMaxX, shapeMaxY, shapeMaxZ, _cand, CAND_MAX);
    const bvhTri = c.bvh.tri;
    for (let k = 0; k < cnt; k++) {
      const ti = _cand[k];
      const o = ti * 9;
      const ax = bvhTri[o], ay = bvhTri[o + 1], az = bvhTri[o + 2];
      const bx = bvhTri[o + 3], by = bvhTri[o + 4], bz = bvhTri[o + 5];
      const cx = bvhTri[o + 6], cy = bvhTri[o + 7], cz = bvhTri[o + 8];

      if (isCapsule) capsuleTriangleContact(px, py, pz, px, py, qz, r, ax, ay, az, bx, by, bz, cx, cy, cz);
      else sphereTriangleContact(px, py, pz, r, ax, ay, az, bx, by, bz, cx, cy, cz);

      if (_hit.depth > 0) pushContact(out, ci, ti);
    }
  }

  if (world.terrain) {
    terrainContact(world, shape);
    // terrain has no `world.colliders` index of its own
    if (_hit.depth > 0) pushContact(out, -1, -1);
  }

  sortContacts(out);
  return out.count;
}
