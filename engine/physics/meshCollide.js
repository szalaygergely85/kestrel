// @ts-check
// engine/physics/meshCollide.js - ME-10a (docs/backlog.md, docs/architecture.md
// 27.17). Banded 2.5D mesh collider: the literal triangle-mesh twin of
// `moveCapsule` (capsule.js) - same iterative minimum-translation push-out,
// same <=4 iterations / single-deepest-contact-per-iteration / strict `>`
// tie-break / `dist == 0` defensive branch, but resolved against clipped
// triangle cross-sections instead of grid cells.
//
// ME-10a implements `moveCircleMesh` only. `probeSupport`, `meshSupportSector`
// and `moveSphereMesh` are ME-10b - not implemented here (see 27.17's step
// list); importing this module for them today is a mistake, not an oversight.
//
// Runtime imports: `./bvh.js` only (check-deps rule 11: engine/physics/**
// must not import engine/mesh/** at runtime). Tests build synthetic/real
// meshes via `buildBvh` directly, same as bvh.test.js.

import { queryAABB } from './bvh.js';

/** @typedef {Object} MeshCollider
 * @property {string} id              `${structure.id}` (base) or `${structure.id}:${tag}` (dynamic tag)
 * @property {'trimesh'} kind
 * @property {import('./bvh.js').Bvh} bvh   world-space (matrix baked at build)
 * @property {Float64Array} min       3, world AABB = bvh.nodeMin[0..2] (refreshed after refit)
 * @property {Float64Array} max       3
 * @property {boolean} enabled */

/** @typedef {{x:number, y:number, blockedX:boolean, blockedY:boolean, nx:number, ny:number, overflow:boolean}} CircleMove   moveCapsule's out + overflow */

/** @typedef {{floorZ:number, floorHit:boolean, fnx:number, fny:number, fnz:number, floorCollider:number, floorTri:number,
 *             ceilZ:number, ceilHit:boolean}} MeshSupport   floorZ = FLOOR_NONE (-1e9) when !floorHit; ceilZ = Infinity when !ceilHit */

export const FLOOR_NONE = -1e9;
export const MESH_PROBE_DROP = 256;   // m, max floor ray length below the start point (ME-10b)
export const MESH_PROBE_RISE = 64;    // m, max ceiling ray length (ME-10b)
export const MESH_CAND_MAX = 256;     // candidate triangles per collider per iteration

// SKIN as capsule.js: a tiny tolerance so a circle resting exactly on a
// contact (radius away, after a previous push-out) is never re-flagged as
// overlapping from float rounding, and so the slab test's open interval
// excludes geometry exactly at its boundary (a riser top at footZ +
// stepUpMax, a lintel/grate face exactly at footZ + height).
const SKIN = 1e-6;

// ---------------------------------------------------------------------------
// Module scratch (zero allocation per call; not re-entrant, as bvh.js's
// queries - never call moveCircleMesh from inside another moveCircleMesh).
// ---------------------------------------------------------------------------

const _cand = new Int32Array(MESH_CAND_MAX);
// Sutherland-Hodgman clip scratch: a triangle (3 verts) clipped by 2 z-planes
// grows to at most 5 verts (27.17); stride 3 (x, y, z) per vertex.
const _clipA = new Float64Array(5 * 3);
const _clipB = new Float64Array(5 * 3);

// ---------------------------------------------------------------------------
// Small geometry helpers (module-local, zero allocation)
// ---------------------------------------------------------------------------

/**
 * Unit winding normal of triangle `ti` (BVH order) stored in `bvh.tri`, same
 * cross-product convention as bvh.js's writeHitNormal.
 * @param {import('./bvh.js').Bvh} bvh
 * @param {number} ti
 * @returns {number} nz only (the walkability test only needs nz)
 */
function triNz(bvh, ti) {
  const o = ti * 9;
  const p0x = bvh.tri[o], p0y = bvh.tri[o + 1], p0z = bvh.tri[o + 2];
  const p1x = bvh.tri[o + 3], p1y = bvh.tri[o + 4], p1z = bvh.tri[o + 5];
  const p2x = bvh.tri[o + 6], p2y = bvh.tri[o + 7], p2z = bvh.tri[o + 8];
  const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
  const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  return nz / len;
}

/**
 * Sutherland-Hodgman clip of a convex polygon (stride-3 x,y,z vertices) by a
 * single z half-plane. `keepGE` true keeps z >= planeZ, false keeps z <=
 * planeZ. Writes into `outBuf` (caller-owned scratch) and returns the new
 * vertex count (<= inCount + 1).
 * @param {Float64Array} inBuf @param {number} inCount
 * @param {Float64Array} outBuf @param {boolean} keepGE @param {number} planeZ
 */
function clipHalfPlaneZ(inBuf, inCount, outBuf, keepGE, planeZ) {
  if (inCount === 0) return 0;
  let outCount = 0;
  for (let i = 0; i < inCount; i++) {
    const ai = i * 3, bi = ((i + 1) % inCount) * 3;
    const az = inBuf[ai + 2], bz = inBuf[bi + 2];
    const aIn = keepGE ? az >= planeZ : az <= planeZ;
    const bIn = keepGE ? bz >= planeZ : bz <= planeZ;
    if (aIn) {
      outBuf[outCount * 3] = inBuf[ai];
      outBuf[outCount * 3 + 1] = inBuf[ai + 1];
      outBuf[outCount * 3 + 2] = az;
      outCount++;
    }
    if (aIn !== bIn) {
      const dz = bz - az;
      const t = dz !== 0 ? (planeZ - az) / dz : 0;
      outBuf[outCount * 3] = inBuf[ai] + (inBuf[bi] - inBuf[ai]) * t;
      outBuf[outCount * 3 + 1] = inBuf[ai + 1] + (inBuf[bi + 1] - inBuf[ai + 1]) * t;
      outBuf[outCount * 3 + 2] = planeZ;
      outCount++;
    }
  }
  return outCount;
}

/** Signed shoelace area (stride-3 buf, xy only) - 0 for count < 3 (degenerate loop cancels). */
function polyArea(buf, count) {
  let a = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    a += buf[i * 3] * buf[j * 3 + 1] - buf[j * 3] * buf[i * 3 + 1];
  }
  return 0.5 * a;
}

/** Ray-casting point-in-polygon (stride-3 buf, xy only); only meaningful for count >= 3. */
function pointInPoly(buf, count, px, py) {
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = buf[i * 3], yi = buf[i * 3 + 1];
    const xj = buf[j * 3], yj = buf[j * 3 + 1];
    if ((yi > py) !== (yj > py)) {
      const xCross = xi + (xj - xi) * (py - yi) / (yj - yi);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

// Scratch object reused by closestOnPoly (zero allocation).
const _closest = { x: 0, y: 0, dist: 0 };

/** Closest point to (px, py) over the polygon's boundary edges (stride-3 buf, xy only);
 * degenerate (coincident/zero-length) edges handled defensively. count >= 1. */
function closestOnPoly(buf, count, px, py) {
  if (count === 1) {
    _closest.x = buf[0]; _closest.y = buf[1];
    _closest.dist = Math.hypot(px - buf[0], py - buf[1]);
    return _closest;
  }
  let bestDist = Infinity, bestX = buf[0], bestY = buf[1];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = buf[i * 3], ay = buf[i * 3 + 1];
    const bx = buf[j * 3], by = buf[j * 3 + 1];
    const ex = bx - ax, ey = by - ay;
    const lenSq = ex * ex + ey * ey;
    let qx, qy;
    if (lenSq < 1e-18) { // degenerate (zero-length) edge - closest is the shared point
      qx = ax; qy = ay;
    } else {
      let t = ((px - ax) * ex + (py - ay) * ey) / lenSq;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      qx = ax + ex * t; qy = ay + ey * t;
    }
    const dist = Math.hypot(px - qx, py - qy);
    if (dist < bestDist) { bestDist = dist; bestX = qx; bestY = qy; }
  }
  _closest.x = bestX; _closest.y = bestY; _closest.dist = bestDist;
  return _closest;
}

// ---------------------------------------------------------------------------
// moveCircleMesh
// ---------------------------------------------------------------------------

/**
 * Move a circle (capsule footprint) by (dx, dy) against the enabled trimesh
 * colliders' BANDED cross-section [zLo, zHi] - the literal mesh twin of
 * `moveCapsule` (capsule.js): iterative minimum-translation push-out,
 * resolving the single deepest contact each of up to 4 iterations, strict
 * `>` tie-break (first-found wins), `dist == 0` defensive revert.
 *
 * Band rule (27.17): `zLo = footZ + (grounded ? stepUpMax : 0)`, `zHi = footZ
 * + height`. A triangle is a blocker iff it is not walkable (`nz < walkCos`)
 * and its part inside the OPEN slab `zLo + SKIN < z < zHi - SKIN` is
 * non-empty (clipped by Sutherland-Hodgman, projected to xy).
 *
 * No per-call allocation: candidate ids, clip scratch and the closest-point
 * result all live in module scratch (not re-entrant, as bvh.js's queries).
 *
 * @param {MeshCollider[]} colliders
 * @param {number} count - live collider count (colliders.length may be larger)
 * @param {number} x @param {number} y
 * @param {number} dx @param {number} dy
 * @param {number} radius
 * @param {number} footZ
 * @param {boolean} grounded
 * @param {{height:number, stepUpMax:number, walkCos:number}} opts
 * @param {CircleMove} out - caller-owned scratch, overwritten and returned
 * @returns {CircleMove}
 */
export function moveCircleMesh(colliders, count, x, y, dx, dy, radius, footZ, grounded, opts, out) {
  let cx = x + dx;
  let cy = y + dy;
  let blockedX = false;
  let blockedY = false;
  let nx = 0;
  let ny = 0;
  let overflow = false;

  const zLo = footZ + (grounded ? opts.stepUpMax : 0);
  const zHi = footZ + opts.height;
  const zLoClip = zLo + SKIN;
  const zHiClip = zHi - SKIN;
  const skinRadius = radius - SKIN;
  const skinRadiusSq = skinRadius * skinRadius;
  const walkCos = opts.walkCos;

  for (let iter = 0; iter < 4; iter++) {
    const bx0 = cx - radius, bx1 = cx + radius;
    const by0 = cy - radius, by1 = cy + radius;

    let found = false;
    let bestDepth = -Infinity;
    let bestQx = 0, bestQy = 0, bestNx = 0, bestNy = 0, bestDist = 0;

    for (let ci = 0; ci < count; ci++) {
      const collider = colliders[ci];
      if (!collider.enabled || collider.kind !== 'trimesh') continue;
      const min = collider.min, max = collider.max;
      if (max[0] < bx0 || min[0] > bx1 || max[1] < by0 || min[1] > by1
        || max[2] < zLo || min[2] > zHi) continue;

      const bvh = collider.bvh;
      const candCount = queryAABB(bvh, bx0, by0, zLo, bx1, by1, zHi, _cand, MESH_CAND_MAX);
      if (candCount === MESH_CAND_MAX) overflow = true;

      for (let k = 0; k < candCount; k++) {
        const ti = _cand[k];
        if (triNz(bvh, ti) >= walkCos) continue; // walkable, not a blocker

        const o = ti * 9;
        _clipA[0] = bvh.tri[o]; _clipA[1] = bvh.tri[o + 1]; _clipA[2] = bvh.tri[o + 2];
        _clipA[3] = bvh.tri[o + 3]; _clipA[4] = bvh.tri[o + 4]; _clipA[5] = bvh.tri[o + 5];
        _clipA[6] = bvh.tri[o + 6]; _clipA[7] = bvh.tri[o + 7]; _clipA[8] = bvh.tri[o + 8];
        const n1 = clipHalfPlaneZ(_clipA, 3, _clipB, true, zLoClip);   // keep z > zLo + SKIN
        if (n1 === 0) continue;
        const n2 = clipHalfPlaneZ(_clipB, n1, _clipA, false, zHiClip); // keep z < zHi - SKIN
        if (n2 === 0) continue; // no part of this triangle is inside the open slab

        const area = Math.abs(polyArea(_clipA, n2));
        const inside = n2 >= 3 && area > 1e-12 && pointInPoly(_clipA, n2, cx, cy);
        const q = closestOnPoly(_clipA, n2, cx, cy);
        const dist = q.dist;

        let depth, cnx, cny;
        if (inside) {
          depth = radius + dist;
          if (dist > 0) { cnx = (q.x - cx) / dist; cny = (q.y - cy) / dist; }
          else { cnx = 0; cny = 0; }
        } else {
          if (dist * dist >= skinRadiusSq) continue; // not really overlapping (within the skin)
          depth = radius - dist;
          if (dist > 0) { cnx = (cx - q.x) / dist; cny = (cy - q.y) / dist; }
          else { cnx = 0; cny = 0; }
        }

        if (depth > bestDepth) {
          found = true;
          bestDepth = depth;
          bestQx = q.x; bestQy = q.y;
          bestNx = cnx; bestNy = cny;
          bestDist = dist;
        }
      }
    }

    if (!found) break;

    if (bestDist === 0) {
      // Defensive: centre exactly on the contact (capsule.js's dist == 0
      // branch) - revert the whole move rather than divide by a zero-length
      // normal.
      cx = x; cy = y;
      blockedX = true; blockedY = true;
      nx = 0; ny = 0;
      break;
    } else if (Math.abs(bestNy) < 1e-9) {
      // Face contact blocking X.
      cx = bestNx > 0 ? bestQx + radius : bestQx - radius;
      blockedX = true;
    } else if (Math.abs(bestNx) < 1e-9) {
      // Face contact blocking Y.
      cy = bestNy > 0 ? bestQy + radius : bestQy - radius;
      blockedY = true;
    } else {
      // Corner or diagonal wall: push out exactly `radius` along the
      // contact normal (circle-vs-point/edge) - integrate already projects
      // velocity, this just lets both axes move (US-008 rework #3 twin).
      cx = bestQx + bestNx * radius;
      cy = bestQy + bestNy * radius;
      nx = bestNx; ny = bestNy;
    }
  }

  out.x = cx;
  out.y = cy;
  out.blockedX = blockedX;
  out.blockedY = blockedY;
  out.nx = nx;
  out.ny = ny;
  out.overflow = overflow;
  return out;
}
