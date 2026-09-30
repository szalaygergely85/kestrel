// @ts-check
// engine/render/pick.js - RE-04 (docs/backlog.md "PC-B QUEUE 5" item 3,
// docs/architecture.md 28.1 "RE-04 engine/render/pick.js"). Screen -> world
// picking on top of the RE-01 pitched camera (engine/render/projection.js):
// a terrain ray march + bisection, a ray-vs-cylinder nearest-unit pick, and
// a screen-rect selection test. Zero allocation after module load (only the
// module-level scratch below); every function takes caller-owned `out`.
//
// `ray` everywhere here is the `{ox,oy,oz,dx,dy,dz}` shape `screenRay`
// (projection.js) produces: origin = eye, `dir` not normalised (its forward
// component is 1, so `t` along `dir` is view depth `vd` when the ray comes
// from `screenRay`; `rayTerrain`/`pickNearest` work on any such ray, e.g. a
// vertical probe ray built by the caller).

import { worldToCell } from './projection.js';

/**
 * @typedef {Object} PickRay
 * @property {number} ox @property {number} oy @property {number} oz
 * @property {number} dx @property {number} dy @property {number} dz
 */

/**
 * @typedef {Object} Terrain
 * @property {(x:number, y:number) => number} groundAt - rendered ground z
 */

/**
 * @typedef {Object} RayTerrainOut
 * @property {number} x @property {number} y @property {number} z
 * @property {number} t
 * @property {boolean} hit
 */

/**
 * Marches `ray` against `terrain.groundAt` (28.1 RE-04): linear steps of
 * `opts.step` (default 0.5 m) from `t = 0` to `opts.maxT` (default
 * `4*ray.oz/-ray.dz`, i.e. 0 when `ray.dz >= 0` - a ray that never points
 * down never reaches the ground), then 24 bisections once a step crosses
 * below `groundAt` ("below" = the sample's `z` is less than the ground
 * height there - what is rendered). Zero allocation.
 * @param {Terrain} terrain
 * @param {PickRay} ray
 * @param {RayTerrainOut} out
 * @param {{step?:number, maxT?:number}} [opts]
 * @returns {RayTerrainOut}
 */
export function rayTerrain(terrain, ray, out, opts) {
  const step = (opts && opts.step != null) ? opts.step : 0.5;
  const maxT = (opts && opts.maxT != null)
    ? opts.maxT
    : (ray.dz < 0 ? (4 * ray.oz) / -ray.dz : 0);
  const { ox, oy, oz, dx, dy, dz } = ray;

  let prevT = 0;
  let t = 0;
  let x = ox, y = oy, z = oz;
  let below = z < terrain.groundAt(x, y);

  while (!below && t < maxT) {
    prevT = t;
    t = Math.min(t + step, maxT);
    x = ox + t * dx; y = oy + t * dy; z = oz + t * dz;
    below = z < terrain.groundAt(x, y);
  }

  if (!below) {
    out.x = x; out.y = y; out.z = z; out.t = t; out.hit = false;
    return out;
  }

  let lo = prevT, hi = t;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const mx = ox + mid * dx, my = oy + mid * dy, mz = oz + mid * dz;
    if (mz < terrain.groundAt(mx, my)) hi = mid; else lo = mid;
  }
  out.x = ox + hi * dx; out.y = oy + hi * dy; out.z = oz + hi * dz;
  out.t = hi; out.hit = true;
  return out;
}

const PICK_EPS = 1e-9;

/**
 * Nearest unit hit by `ray`, each unit a vertical cylinder: base point
 * `(positions[k*3], positions[k*3+1], positions[k*3+2])`, `radii[k]`,
 * `heights[k]` (z in `[baseZ, baseZ+height]`). Smallest `t >= 0`; ties
 * (within 1e-9) resolve to the lower index; -1 if no unit is hit. Zero
 * allocation.
 * @param {PickRay} ray
 * @param {Float64Array} positions - stride 3, base points
 * @param {Float64Array|number[]} radii
 * @param {Float64Array|number[]} heights
 * @param {number} count
 * @returns {number}
 */
export function pickNearest(ray, positions, radii, heights, count) {
  const { ox, oy, oz, dx, dy, dz } = ray;
  let bestT = Infinity, bestIdx = -1;

  for (let k = 0; k < count; k++) {
    const bx = positions[k * 3], by = positions[k * 3 + 1], bz = positions[k * 3 + 2];
    const r = radii[k], h = heights[k];
    const ex = ox - bx, ey = oy - by;
    const a = dx * dx + dy * dy;

    let horizLo, horizHi;
    if (a < 1e-12) {
      // Ray has no horizontal motion: it's inside the infinite cylinder for
      // every t (or never, if it starts outside the radius).
      if (ex * ex + ey * ey - r * r > 0) continue;
      horizLo = -Infinity; horizHi = Infinity;
    } else {
      const b = 2 * (ex * dx + ey * dy);
      const c = ex * ex + ey * ey - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      horizLo = (-b - sq) / (2 * a);
      horizHi = (-b + sq) / (2 * a);
    }

    let zLo, zHi;
    if (Math.abs(dz) < 1e-12) {
      if (oz < bz || oz > bz + h) continue;
      zLo = -Infinity; zHi = Infinity;
    } else {
      const tz1 = (bz - oz) / dz;
      const tz2 = (bz + h - oz) / dz;
      zLo = Math.min(tz1, tz2); zHi = Math.max(tz1, tz2);
    }

    const lo = Math.max(horizLo, zLo, 0);
    const hi = Math.min(horizHi, zHi);
    if (lo > hi) continue;

    if (lo < bestT - PICK_EPS) { bestT = lo; bestIdx = k; }
  }

  return bestIdx;
}

// Module-level scratch for selectInRect - the function itself never
// allocates; reused across calls and callers.
const _rectScratch = new Float64Array(3);

/**
 * Ids (ascending) of units whose base point projects inside the inclusive
 * screen rect `[c0,c1] x [r0,r1]` and is in front of the camera (`vd > 0`).
 * Iterates `k` ascending, so `outIds` comes out ascending. Zero allocation.
 * Caller must pass an already-normalised rect (`c0 <= c1`, `r0 <= r1`) - this
 * function does no swapping/normalisation itself; a flipped rect just
 * matches nothing (the `col >= c0 && col <= c1` checks both fail).
 * @param {import('./projection.js').PitchedTerms} terms
 * @param {number} c0 @param {number} r0 @param {number} c1 @param {number} r1
 * @param {Float64Array} positions - stride 3, base points
 * @param {number} count
 * @param {Int32Array|number[]} outIds
 * @returns {number} number of ids written to `outIds`
 */
export function selectInRect(terms, c0, r0, c1, r1, positions, count, outIds) {
  let n = 0;
  for (let k = 0; k < count; k++) {
    const x = positions[k * 3], y = positions[k * 3 + 1], z = positions[k * 3 + 2];
    worldToCell(terms, x, y, z, _rectScratch);
    if (_rectScratch[2] <= 0) continue;
    const col = _rectScratch[0], row = _rectScratch[1];
    if (col >= c0 && col <= c1 && row >= r0 && row <= r1) {
      outIds[n++] = k;
    }
  }
  return n;
}
