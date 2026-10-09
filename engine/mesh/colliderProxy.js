// @ts-check
// engine/mesh/colliderProxy.js - MESH-PHYS-01. Build-time (tools / import) generator of the
// per-mesh COLLISION PROXY stored in the mesh json as `collider`, and of the `collide:false`
// walk-over decision. Pure functions, no imports (allocates freely; never runs per frame).
//
// Design choice (simplest robust option): a closed vertical convex PRISM. Footprint = convex hull of the
// mesh's xy points below `bandH` (the part a 1.8 m player can bump into), reduced to <= 8 vertices and
// re-inflated to keep the hull area; z from the mesh's lowest vertex to its highest. <= 8 sides => <= 28
// triangles (16 side + 6 top + 6 bottom), well under the 48 budget. Why not a general convex hull or
// decimated render tris: a 3D hull of a dead tree (trunk + wide branches) is a huge solid blob, a prism of
// the BAND footprint stays trunk-thin; prisms have exact flat tops (stand on a rock) and vertical walls
// (no slope-slide jitter, the walkCos test treats walls as pure blockers); and they are trivially
// watertight, so the capsule can never end "inside" through a hole. Cost of the simplification: a rock
// that narrows toward its top gets a slightly fat top ring - acceptable for cheap physics.

/** Footprint band: vertices up to this height above the lowest vertex shape the footprint (m). */
export const PROXY_BAND_H = 2.0;
/** A piece whose top is under this (m, mesh-local, origin = ground) needs no collider: stepUpMax is 0.45. */
export const WALK_OVER_H = 0.3;
/** Prism side cap (28 tris at 8). */
export const PROXY_MAX_SIDES = 8;
/** Mesh-id basenames that never collide (soft / decorative pieces regardless of height). */
export const SOFT_NAME_RE = /(^|\/)(Pebble|Grass|Mushroom)/i;

/** Monotone-chain convex hull of [x,y,...] pairs; CCW, no repeated points. */
function hull2(pts) {
  const n = pts.length / 2, idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1])
    - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const lower = [];
  for (const i of idx) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 1e-12) lower.pop(); lower.push(i); }
  const upper = [];
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 1e-12) upper.pop(); upper.push(i); }
  lower.pop(); upper.pop();
  return lower.concat(upper).map((i) => [pts[i * 2], pts[i * 2 + 1]]);
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return a / 2;
}

/**
 * @param {ArrayLike<number>} pos mesh-local positions, 3/vertex (unrolled triangles)
 * @param {{bandH?:number, maxSides?:number}} [opts]
 * @returns {number[]|null} proxy triangles (9 numbers each, mesh-local, CCW outward), or null if degenerate
 */
export function buildPrismProxy(pos, opts = {}) {
  const bandH = opts.bandH ?? PROXY_BAND_H, maxSides = opts.maxSides ?? PROXY_MAX_SIDES;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { if (pos[i] < zMin) zMin = pos[i]; if (pos[i] > zMax) zMax = pos[i]; }
  if (!(zMax > zMin)) return null;
  const band = [];
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] <= zMin + bandH) band.push(pos[i], pos[i + 1]);
  let poly = hull2(band);
  if (poly.length < 3 || Math.abs(polyArea(poly)) < 1e-6) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < band.length; i += 2) { x0 = Math.min(x0, band[i]); x1 = Math.max(x1, band[i]); y0 = Math.min(y0, band[i + 1]); y1 = Math.max(y1, band[i + 1]); }
    const e = 0.05; // sliver: a thin box
    poly = [[x0 - e, y0 - e], [x1 + e, y0 - e], [x1 + e, y1 + e], [x0 - e, y1 + e]];
  }
  const fullArea = polyArea(poly);
  // Drop the hull vertex whose removal loses the least area until <= maxSides remain.
  while (poly.length > maxSides) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
      const t = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      if (t < bestA) { bestA = t; best = i; }
    }
    poly.splice(best, 1);
  }
  // Re-inflate about the centroid so the reduced polygon keeps the hull's area (never smaller footprint).
  const k = Math.sqrt(fullArea / polyArea(poly));
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  const ring = poly.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
  const r = (v) => Math.round(v * 1000) / 1000;
  const out = [];
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const zb = r(zMin), zt = r(zMax), n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ab = [r(a[0]), r(a[1]), zb], bb = [r(b[0]), r(b[1]), zb], bt = [r(b[0]), r(b[1]), zt], at = [r(a[0]), r(a[1]), zt];
    tri(ab, bb, bt); tri(ab, bt, at);
  }
  const v = (i, z) => [r(ring[i][0]), r(ring[i][1]), z];
  for (let i = 1; i < n - 1; i++) { tri(v(0, zt), v(i, zt), v(i + 1, zt)); tri(v(0, zb), v(i + 1, zb), v(i, zb)); }
  return out;
}

// ---------------------------------------------------------------------------
// S8-B2-16: hull proxy. An explicitly-flagged alternative to the prism above:
// a true 3D convex hull of the mesh, capped at <= HULL_MAX_FACES triangles.
//
// The cap is enforced BEFORE running quickhull, not by decimating its output
// afterwards: sample the mesh's extreme ("support") point along each of 18
// fixed directions (the 6 face + 12 edge normals of a cube - the classic
// "18-DOP"), dedupe, then build the exact quickhull of just those <= 18
// points. A vertex of the convex hull of a point set S stays a vertex of the
// hull of any subset T subseteq S that contains it (an extreme point can't
// become a non-extreme combination of fewer points), so all <= 18 sampled
// points survive as hull vertices - none get discarded as "interior" - and
// for a simplicial (fully triangulated) convex polytope Euler's formula
// pins the face count exactly: F = 2V - 4, so V <= 18 guarantees F <= 32.
// Output is plain CCW-outward triangles in the mesh's `collider` array - the
// same shape buildPrismProxy emits - so the merged `meshes:static` BVH and
// `engine/physics/meshCollide.js` capsule sweeps need no changes at all: no
// new convex/GJK primitive, no new MeshCollider `kind`.
// ---------------------------------------------------------------------------

/** Hard cap (ARCH, S8-B2-16): never emit more than this many hull triangles. */
export const HULL_MAX_FACES = 32;

// 18-DOP sampling directions: 6 face normals + 12 edge directions of a cube.
const HULL_DOP_DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];
// Fixed, arbitrary (non-axis-aligned) direction used only to break exact ties
// deterministically (e.g. a flat cube face: every corner maximises the face
// normal equally) without depending on vertex iteration order.
const HULL_TIEBREAK = [0.5753, 0.1987, 0.3331];

const hSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const hCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hLen = (a) => Math.hypot(a[0], a[1], a[2]);

/** The 18-DOP support points of `pos` (mesh-local triangle soup), deduped. */
function hullSupportPoints(pos) {
  let maxAbs = 1;
  for (let i = 0; i < pos.length; i++) { const a = Math.abs(pos[i]); if (a > maxAbs) maxAbs = a; }
  const eps = maxAbs * 1e-7;
  const picked = [];
  for (const dir of HULL_DOP_DIRS) {
    let bi = -1, bd = -Infinity, bt = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const d = x * dir[0] + y * dir[1] + z * dir[2];
      if (d > bd + eps) { bd = d; bi = i; bt = x * HULL_TIEBREAK[0] + y * HULL_TIEBREAK[1] + z * HULL_TIEBREAK[2]; } else if (d > bd - eps) {
        const t = x * HULL_TIEBREAK[0] + y * HULL_TIEBREAK[1] + z * HULL_TIEBREAK[2];
        if (t > bt) { bt = t; bi = i; if (d > bd) bd = d; }
      }
    }
    if (bi >= 0) picked.push([pos[bi], pos[bi + 1], pos[bi + 2]]);
  }
  const grid = Math.max(eps, 1e-9), seen = new Set(), out = [];
  for (const p of picked) {
    const k = `${Math.round(p[0] / grid)},${Math.round(p[1] / grid)},${Math.round(p[2] / grid)}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return { pts: out, eps };
}

/**
 * Exact convex hull (incremental / "beneath-beyond") of a small point set.
 * @param {number[][]} pts @param {number} eps
 * @returns {number[][][]|null} faces, each [pa,pb,pc] = the three points from pts (CCW outward), or null if degenerate
 */
function quickHull3(pts, eps) {
  const n = pts.length;
  if (n < 4) return null;
  let i0 = 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i], b = pts[i0];
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) i0 = i;
  }
  let i1 = -1, best = -1;
  for (let i = 0; i < n; i++) if (i !== i0) { const d = hLen(hSub(pts[i], pts[i0])); if (d > best) { best = d; i1 = i; } }
  if (i1 < 0 || best < eps) return null;
  const dir01 = hSub(pts[i1], pts[i0]);
  let i2 = -1; best = -1;
  for (let i = 0; i < n; i++) if (i !== i0 && i !== i1) { const d = hLen(hCross(dir01, hSub(pts[i], pts[i0]))); if (d > best) { best = d; i2 = i; } }
  if (i2 < 0 || best < eps) return null;
  const n012 = hCross(hSub(pts[i1], pts[i0]), hSub(pts[i2], pts[i0])), n012Len = hLen(n012);
  if (n012Len < eps) return null;
  let i3 = -1; best = -1;
  for (let i = 0; i < n; i++) if (i !== i0 && i !== i1 && i !== i2) { const d = Math.abs(hDot(hSub(pts[i], pts[i0]), n012)) / n012Len; if (d > best) { best = d; i3 = i; } }
  if (i3 < 0 || best < eps) return null;

  const faceNormal = (f) => hCross(hSub(pts[f[1]], pts[f[0]]), hSub(pts[f[2]], pts[f[0]]));
  const cen = [0, 1, 2].map((k) => (pts[i0][k] + pts[i1][k] + pts[i2][k] + pts[i3][k]) / 4);
  let faces = [[i0, i1, i2], [i0, i1, i3], [i0, i2, i3], [i1, i2, i3]].map((f) => {
    const fn = faceNormal(f);
    return hDot(fn, hSub(cen, pts[f[0]])) > 0 ? [f[0], f[2], f[1]] : f; // flip so the normal points away from the centroid
  });

  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const p = pts[i], visible = [];
    for (const f of faces) {
      const fn = faceNormal(f), fl = hLen(fn);
      if (fl > 1e-15 && hDot(fn, hSub(p, pts[f[0]])) / fl > eps) visible.push(f);
    }
    if (!visible.length) continue; // p is inside (or on) the hull built so far
    const visibleSet = new Set(visible);
    const edgeMap = new Map();
    for (const f of faces) { edgeMap.set(`${f[0]},${f[1]}`, f); edgeMap.set(`${f[1]},${f[2]}`, f); edgeMap.set(`${f[2]},${f[0]}`, f); }
    const horizon = [];
    for (const f of visible) for (const [u, v] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
      const mirror = edgeMap.get(`${v},${u}`);
      if (!mirror || !visibleSet.has(mirror)) horizon.push([u, v]); // boundary of the hole left by the removed faces
    }
    faces = faces.filter((f) => !visibleSet.has(f));
    for (const [u, v] of horizon) faces.push([u, v, i]);
  }
  return faces.length >= 4 ? faces.map((f) => [pts[f[0]], pts[f[1]], pts[f[2]]]) : null;
}

/**
 * @param {ArrayLike<number>} pos mesh-local positions, 3/vertex (unrolled triangles)
 * @returns {number[]|null} proxy triangles (9 numbers each, mesh-local, CCW outward, <= HULL_MAX_FACES), or null if degenerate
 */
export function buildHullProxy(pos) {
  const { pts, eps } = hullSupportPoints(pos);
  const faces = quickHull3(pts, eps);
  if (!faces || faces.length > HULL_MAX_FACES) return null; // defensive: guarantee the cap, fall back to the prism instead
  const r = (v) => Math.round(v * 1000) / 1000;
  const out = [];
  for (const [a, b, c] of faces) out.push(r(a[0]), r(a[1]), r(a[2]), r(b[0]), r(b[1]), r(b[2]), r(c[0]), r(c[1]), r(c[2]));
  return out;
}

/**
 * The importer/generator decision for one mesh.
 * @param {string} id mesh id (soft-name rule)
 * @param {ArrayLike<number>} pos mesh-local positions
 * @param {{walkOverH?:number, parts?:string[], ranges?:{part:string,start:number,count:number}[], hull?:boolean}} [opts]
 *   parts+ranges (mesh json `colliderParts` + `ranges`): the prism footprint/height come only from those material ranges
 *   (trees: the trunk keys, so the crown never makes a fat collider); the walk-over decision still uses the whole mesh.
 *   hull (S8-B2-16, mesh json `colliderHull` + tool `--hull`, both required): build a convex hull instead of a prism.
 * @returns {{collide:boolean, collider:number[]|null, castShadow:boolean}} collide false => no collider at all
 */
export function planMeshCollision(id, pos, opts = {}) {
  let zMax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] > zMax) zMax = pos[i];
  // MESH-SHADOW-01: a walk-over / soft piece (pebble, path stone, mushroom, grass) also skips the sun shadow map.
  if (SOFT_NAME_RE.test(id) || zMax <= (opts.walkOverH ?? WALK_OVER_H)) return { collide: false, collider: null, castShadow: false };
  let src = pos;
  if (opts.parts && opts.parts.length && opts.ranges) {
    const tp = [];
    for (const r of opts.ranges) if (opts.parts.includes(r.part)) for (let i = r.start * 9; i < (r.start + r.count) * 9; i++) tp.push(pos[i]);
    if (tp.length) src = tp;
  }
  const collider = (opts.hull && buildHullProxy(src)) || buildPrismProxy(src);
  return collider ? { collide: true, collider, castShadow: true } : { collide: false, collider: null, castShadow: false };
}
