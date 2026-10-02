// engine/world/meleeArc.js - US-078b (architecture.md 30.1). Pure 2.5D wedge
// query for melee swings: which cylinders (centre cx,cy, radius cr, z band
// cz..cz+ch) lie inside a slice of a circle sector. No trig, no allocation.

/**
 * @typedef {Object} MeleeArc   one slice of a swing, in world coordinates
 * @property {number} ex @property {number} ey   wedge apex (eye xy)
 * @property {number} zMin @property {number} zMax   vertical band
 * @property {number} ax @property {number} ay   unit vector of the first slice edge
 * @property {number} bx @property {number} by   unit vector of the second slice edge (< 180 deg from a)
 * @property {number} reach   metres from the apex to the cylinder's near surface
 */

/**
 * Hit iff [cz, cz+ch] overlaps [zMin, zMax], `dist2D - cr <= reach`, and the
 * centre is inside the wedge widened by `cr` (signed distance to each edge
 * line >= -cr, and dot(centre - apex, mid) >= -cr, mid = a + b).
 * Entities are given as SoA arrays: `cx, cy, cz, cr, ch` are indexed 0..count-1
 * (pass the arrays as the five numeric args). Writes hit indices into `outIdx`
 * and `outT = max(0, dist2D - cr)` into `outT`, sorted ascending by (t, index).
 * @param {MeleeArc} arc
 * @param {ArrayLike<number>} cx @param {ArrayLike<number>} cy @param {ArrayLike<number>} cz
 * @param {ArrayLike<number>} cr @param {ArrayLike<number>} ch
 * @param {number} count
 * @param {Int32Array|number[]} outIdx @param {Float64Array|number[]} outT
 * @returns {number} number of hits (capped by outIdx.length)
 */
export function arcHits(arc, cx, cy, cz, cr, ch, count, outIdx, outT) {
  const { ex, ey, zMin, zMax, ax, ay, bx, by, reach } = arc;
  const mx = ax + bx, my = ay + by;
  // Inward normals of the two edge lines (wedge is on the positive side of both):
  // edge a: points p with cross(a, p) <= 0 ... orientation from the sign of cross(a, b).
  const s = (ax * by - ay * bx) >= 0 ? 1 : -1;
  // Signed distance toward the inside: da = s*cross(a,p), db = -s*cross(b,p).
  const cap = outIdx.length;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const r = cr[i], z0 = cz[i];
    if (z0 + ch[i] < zMin || z0 > zMax) continue;
    const px = cx[i] - ex, py = cy[i] - ey;
    const d = Math.sqrt(px * px + py * py);
    if (d - r > reach) continue;
    if (s * (ax * py - ay * px) < -r) continue;
    if (-s * (bx * py - by * px) < -r) continue;
    if (px * mx + py * my < -r) continue;
    const t = d - r > 0 ? d - r : 0;
    // insertion into the sorted output by (t, index): indices ascend, so equal t goes after.
    let k = n < cap ? n : cap - 1;
    if (n >= cap && !(t < outT[k])) continue;
    while (k > 0 && outT[k - 1] > t) {
      outT[k] = outT[k - 1]; outIdx[k] = outIdx[k - 1]; k--;
    }
    outT[k] = t; outIdx[k] = i;
    if (n < cap) n++;
  }
  return n;
}
