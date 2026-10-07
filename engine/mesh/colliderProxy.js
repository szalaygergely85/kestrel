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

/**
 * The importer/generator decision for one mesh.
 * @param {string} id mesh id (soft-name rule)
 * @param {ArrayLike<number>} pos mesh-local positions
 * @param {{walkOverH?:number}} [opts]
 * @returns {{collide:boolean, collider:number[]|null, castShadow:boolean}} collide false => no collider at all
 */
export function planMeshCollision(id, pos, opts = {}) {
  let zMax = -Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] > zMax) zMax = pos[i];
  // MESH-SHADOW-01: a walk-over / soft piece (pebble, path stone, mushroom, grass) also skips the sun shadow map.
  if (SOFT_NAME_RE.test(id) || zMax <= (opts.walkOverH ?? WALK_OVER_H)) return { collide: false, collider: null, castShadow: false };
  const collider = buildPrismProxy(pos);
  return collider ? { collide: true, collider, castShadow: true } : { collide: false, collider: null, castShadow: false };
}
