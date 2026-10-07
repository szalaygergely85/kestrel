// @ts-check
// engine/physics/meshCollide.js - ME-10a/b (docs/backlog.md, docs/architecture.md
// 27.17). Banded 2.5D mesh collider: the literal triangle-mesh twin of
// `moveCapsule` (capsule.js) - same iterative minimum-translation push-out,
// same <=4 iterations / single-deepest-contact-per-iteration / strict `>`
// tie-break / `dist == 0` defensive branch, but resolved against clipped
// triangle cross-sections instead of grid cells.
//
// ME-10a implemented `moveCircleMesh`. ME-10b adds `probeSupport` (floor +
// ceiling raycast probe), `meshSupportSector` (sector-shaped merge with an
// optional terrain floor, the `World.supportAt`/`sectorOrOutside` twin) and
// `moveSphereMesh` (the `sphere.js` twin). `integrate.js`'s hooks are ME-10c
// - not wired here.
//
// Runtime imports: `./bvh.js` only (check-deps rule 11: engine/physics/**
// must not import engine/mesh/** at runtime). Tests build synthetic/real
// meshes via `buildBvh` directly, same as bvh.test.js.

import { queryAABB, raycast } from './bvh.js';

/** @typedef {Object} MeshCollider
 * @property {string} id              `${structure.id}` (base) or `${structure.id}:${tag}` (dynamic tag)
 * @property {'trimesh'} kind
 * @property {import('./bvh.js').Bvh} bvh   world-space (matrix baked at build)
 * @property {Float64Array} min       3, world AABB = bvh.nodeMin[0..2] (refreshed after refit)
 * @property {Float64Array} max       3
 * @property {boolean} enabled
 * @property {Array<{id:string,start:number,count:number}>} [parts]  MESH-PHYS-01: per-structure triangle ranges of the merged `meshes:static` collider (debug/tools only) */

/** @typedef {{x:number, y:number, blockedX:boolean, blockedY:boolean, nx:number, ny:number, overflow:boolean}} CircleMove   moveCapsule's out + overflow */

/** @typedef {{floorZ:number, floorHit:boolean, fnx:number, fny:number, fnz:number, floorCollider:number, floorTri:number,
 *             ceilZ:number, ceilHit:boolean}} MeshSupport   floorZ = FLOOR_NONE (-1e9) when !floorHit; ceilZ = Infinity when !ceilHit */
/** @typedef {{floorH:number, ceilH:(number|'sky'), solid:boolean, terrain:boolean, slope:boolean,
 *             nx:number, ny:number, nz:number}} MeshSector   meshSupportSector's output (World.supportAt/sectorOrOutside shape, 27.18) */

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

// probeSupport's two raycasts (floor down, ceiling up) reuse one RayHit-shaped
// scratch object each - not re-entrant, as bvh.js's own queries.
const _floorRay = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
const _ceilRay = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };

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
 * @param {{height:number, stepUpMax:number, walkCos:number, airStepUp?:number}} opts
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

// ---------------------------------------------------------------------------
// probeSupport
// ---------------------------------------------------------------------------

/**
 * Centre-point floor/ceiling probe against the enabled trimesh colliders
 * whose horizontal (xy) AABB contains (x, y) - the mesh twin of a grid
 * `sectorAt`/`outsideSector` lookup, but by raycast instead of a cell index.
 *
 * Floor: straight down from `(x, y, footZ + up)`, `up = grounded ?
 * stepUpMax + SKIN : (opts.airStepUp || 0) + SKIN` (airborne never snaps up, unless the body opts in, onto something above the
 * feet), `tMax = up + MESH_PROBE_DROP + SKIN`. Nearest hit wins (strictly
 * smaller t; a tie keeps the lower collider index, since a later collider's
 * raycast is called with the already-narrowed `tMax` and `intersectTri`
 * rejects `t >= bestT`). Any slope counts as floor here - walkability is
 * `moveCircleMesh`'s job, not this probe's; a 51 deg ramp is stood on (and,
 * via `meshSupportSector`, slid down). Normal flipped so `fnz >= 0`.
 *
 * Ceiling: straight up from `(x, y, max(footZ, floorZ) + SKIN)`, `tMax =
 * MESH_PROBE_RISE`. Vertical walls are parallel to this ray and never hit.
 *
 * Zero allocation (module RayHit scratch, not re-entrant - never call this
 * from inside another probeSupport/moveCircleMesh/moveSphereMesh).
 *
 * @param {MeshCollider[]} colliders
 * @param {number} count
 * @param {number} x @param {number} y
 * @param {number} footZ
 * @param {boolean} grounded
 * @param {{height:number, stepUpMax:number, walkCos:number, airStepUp?:number}} opts
 * @param {MeshSupport} out
 * @returns {MeshSupport}
 */
export function probeSupport(colliders, count, x, y, footZ, grounded, opts, out) {
  // BUG-GONDOLA-FALL: a body may opt in (opts.airStepUp, integrate.js sets it) to probe up to that far above the feet while
  // airborne. A depenetration squeeze (prop box face vs a stepped tower wall, gap < capsule width) can leave the feet a
  // few cm BELOW a floor top they stand in; with up = SKIN that floor was missed and the player fell out of the world.
  // Grid twin: airborne z <= floorH lands. Other callers (null opts, water, AI) keep the strict airborne probe.
  const up = (grounded ? opts.stepUpMax : (opts && opts.airStepUp) || 0) + SKIN;
  const originZ = footZ + up;
  const tMaxDrop = up + MESH_PROBE_DROP + SKIN;

  let floorHit = false;
  let floorT = tMaxDrop;
  let floorCollider = -1;
  let floorTri = -1;
  let fnx = 0, fny = 0, fnz = 0;

  for (let ci = 0; ci < count; ci++) {
    const c = colliders[ci];
    if (!c.enabled || c.kind !== 'trimesh') continue;
    const min = c.min, max = c.max;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1]) continue;
    if (raycast(c.bvh, x, y, originZ, 0, 0, -1, floorT, _floorRay)) {
      floorHit = true;
      floorT = _floorRay.t;
      floorCollider = ci;
      floorTri = _floorRay.tri;
      fnx = _floorRay.nx; fny = _floorRay.ny; fnz = _floorRay.nz;
    }
  }
  if (floorHit && fnz < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
  const floorZ = floorHit ? originZ - floorT : FLOOR_NONE;

  const ceilOriginZ = Math.max(footZ, floorZ) + SKIN; // floorZ = FLOOR_NONE when !floorHit -> footZ wins
  let ceilHit = false;
  let ceilT = MESH_PROBE_RISE;
  for (let ci = 0; ci < count; ci++) {
    const c = colliders[ci];
    if (!c.enabled || c.kind !== 'trimesh') continue;
    const min = c.min, max = c.max;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1]) continue;
    if (raycast(c.bvh, x, y, ceilOriginZ, 0, 0, 1, ceilT, _ceilRay)) {
      ceilHit = true;
      ceilT = _ceilRay.t;
    }
  }
  const ceilZ = ceilHit ? ceilOriginZ + ceilT : Infinity;

  out.floorZ = floorZ;
  out.floorHit = floorHit;
  out.fnx = fnx; out.fny = fny; out.fnz = fnz;
  out.floorCollider = floorCollider;
  out.floorTri = floorTri;
  out.ceilZ = ceilZ;
  out.ceilHit = ceilHit;
  return out;
}

// ---------------------------------------------------------------------------
// meshSupportSector
// ---------------------------------------------------------------------------

/**
 * Merges a `probeSupport` result with an optional terrain floor into the
 * sector shape `integrate.js`/`sectorOrOutside` already consume (World's
 * `supportAt`, 27.18). `terrainZ` NaN = no terrain under this point (all NaN
 * comparisons are false, so `terrain` correctly comes out false; `Math.max`
 * would otherwise poison `floorH` to NaN, so it is special-cased below).
 *
 * `terrain = terrainZ >= sup.floorZ` (terrain wins ties - 23.3's terrain
 * slide rule owns the terrain-floor case). `slope = !terrain && sup.floorHit`
 * - true whenever the mesh floor (not a terrain merge) is the support, same
 * as `sector.terrain` gates the grid slide branch; flat mesh floors have
 * `nz = 1` so the caller's `nz < slideStartCos` check never fires (27.17:
 * "flat floors have nz = 1 and never slide") - `slope` itself does not mean
 * "currently sliding".
 *
 * @param {MeshSupport} sup
 * @param {number} terrainZ - NaN = no terrain
 * @param {number} tnx @param {number} tny @param {number} tnz - terrain normal (used iff terrain wins)
 * @param {MeshSector} out
 * @returns {MeshSector}
 */
export function meshSupportSector(sup, terrainZ, tnx, tny, tnz, out) {
  const terrain = terrainZ >= sup.floorZ;
  const floorH = Number.isNaN(terrainZ) ? sup.floorZ : Math.max(sup.floorZ, terrainZ);
  const slope = !terrain && sup.floorHit;

  out.floorH = floorH;
  out.ceilH = sup.ceilHit ? sup.ceilZ : 'sky';
  out.solid = false;
  out.terrain = terrain;
  out.slope = slope;
  if (terrain) {
    out.nx = tnx; out.ny = tny; out.nz = tnz;
  } else {
    out.nx = sup.fnx; out.ny = sup.fny; out.nz = sup.fnz;
  }
  return out;
}

// ---------------------------------------------------------------------------
// moveSphereMesh
// ---------------------------------------------------------------------------

/**
 * `moveCircleMesh` with height 2r, stepUpMax 0, grounded true (the
 * `sphere.js`/`moveSphere` twin). `opts` is caller-owned and reused every
 * call, like `moveSphere`'s - this only overwrites `height`/`stepUpMax`
 * in place, it never allocates a fresh options object (`walkCos` is left as
 * the caller set it).
 * @param {MeshCollider[]} colliders
 * @param {number} count
 * @param {number} x @param {number} y
 * @param {number} dx @param {number} dy
 * @param {number} radius
 * @param {number} z - the sphere's bottom (moveCircleMesh's footZ convention)
 * @param {{height:number, stepUpMax:number, walkCos:number, airStepUp?:number}} opts - caller-owned scratch, overwritten in place
 * @param {CircleMove} out
 * @returns {CircleMove}
 */
export function moveSphereMesh(colliders, count, x, y, dx, dy, radius, z, opts, out) {
  opts.height = radius * 2;
  opts.stepUpMax = 0;
  return moveCircleMesh(colliders, count, x, y, dx, dy, radius, z, /* grounded */ true, opts, out);
}

// ---------------------------------------------------------------------------
// raycastColliders (US-078b, architecture.md 30.1)
// ---------------------------------------------------------------------------

const _rcHit = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Nearest hit of the ray `o + t*d`, t in [0, tMax), against the enabled
 * trimesh colliders (AABB slab reject, then `bvh.raycast`). `d` need not be
 * unit: `t` is in units of `d` (pass `d = b - a, tMax = 1` for a segment).
 * Writes `out` (RayHit-shaped: t, tri, u, v, nx, ny, nz) + `out.collider` (index)
 * and returns true on a hit; `out` is left untouched on a miss. Zero
 * allocation, not re-entrant (module scratch).
 * @param {MeshCollider[]} colliders @param {number} count
 * @param {number} ox @param {number} oy @param {number} oz
 * @param {number} dx @param {number} dy @param {number} dz
 * @param {number} tMax
 * @param {{t:number, tri:number, u:number, v:number, nx:number, ny:number, nz:number, collider?:number}} out
 * @returns {boolean}
 */
export function raycastColliders(colliders, count, ox, oy, oz, dx, dy, dz, tMax, out) {
  let best = tMax;
  let found = false;
  for (let ci = 0; ci < count; ci++) {
    const c = colliders[ci];
    if (!c.enabled || c.kind !== 'trimesh') continue;
    // Slab test of the ray [0, best] against the collider AABB.
    let t0 = 0, t1 = best;
    const mn = c.min, mx = c.max;
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz;
      const d = a === 0 ? dx : a === 1 ? dy : dz;
      if (Math.abs(d) < 1e-12) {
        if (o < mn[a] || o > mx[a]) ok = false;
      } else {
        let ta = (mn[a] - o) / d, tb = (mx[a] - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
    }
    if (!ok) continue;
    if (raycast(c.bvh, ox, oy, oz, dx, dy, dz, best, _rcHit)) {
      best = _rcHit.t;
      found = true;
      out.t = _rcHit.t; out.tri = _rcHit.tri; out.u = _rcHit.u; out.v = _rcHit.v;
      out.nx = _rcHit.nx; out.ny = _rcHit.ny; out.nz = _rcHit.nz;
      out.collider = ci;
    }
  }
  return found;
}
