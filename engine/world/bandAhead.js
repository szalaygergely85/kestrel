// engine/world/bandAhead.js (OB109-B4 / WM-02, arch 38.58 + 38.59 decision 2): pure helpers for grid bake-ahead.
// `aheadOrder` ranks the <= 8 ring zones around the current zone: the zone ahead in the movement heading first, then the
// sides, then the rest (by cosine of heading vs zone direction; no heading = nearest zone centre first). Ties: lower j, lower i.
import { zoneAt } from './bandGrid.js';

/** Largest-overlap source: index of the rect in `rects` ([x0,y0,x1,y1] flat, stride 4, n rects) overlapping (x0,y0,x1,y1) most; -1 if none. */
export function bestOverlap(rects, n, x0, y0, x1, y1) {
  let best = -1, ba = 0;
  for (let k = 0; k < n; k++) {
    const w = Math.min(x1, rects[k * 4 + 2]) - Math.max(x0, rects[k * 4]), h = Math.min(y1, rects[k * 4 + 3]) - Math.max(y0, rects[k * 4 + 1]);
    if (w > 0 && h > 0 && w * h > ba) { ba = w * h; best = k; }
  }
  return best;
}

const _z = {};
/**
 * Fills `out` (array of {i,j,score}, reused; length set) with the ring zones of (ci,cj) in bake priority order.
 * @param {object} g makeGrid result
 * @param {number} hx @param {number} hy heading (any length; 0,0 = unknown)
 * @param {number} px @param {number} py player pose (m), used when the heading is unknown
 * @returns {Array} out
 */
export function aheadOrder(g, ci, cj, hx, hy, px, py, out) {
  const hl = Math.hypot(hx, hy), cs = g.chunk;
  let n = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= g.ni || j >= g.nj) continue;
    zoneAt(g, i, j, _z);
    let score;
    if (hl > 1e-6) { // cosine between the heading and the pitch direction to the zone
      const ox = di * g.stepX * cs, oy = dj * g.stepY * cs;
      score = (hx * ox + hy * oy) / (hl * Math.hypot(ox, oy));
    } else { // no heading: nearest edge first
      score = -Math.hypot((_z.cx0 + _z.cw / 2) * cs - px, (_z.cy0 + _z.ch / 2) * cs - py); // zones overlap, so rank by centre distance
    }
    const e = out[n] || (out[n] = { i: 0, j: 0, score: 0 });
    e.i = i; e.j = j; e.score = score; n++;
  }
  out.length = n;
  for (let a = 1; a < n; a++) { // insertion sort, n <= 8: score desc, then j, then i
    const e = out[a]; let b = a - 1;
    while (b >= 0 && (out[b].score < e.score - 1e-9 || (Math.abs(out[b].score - e.score) <= 1e-9 && (out[b].j > e.j || (out[b].j === e.j && out[b].i > e.i))))) { out[b + 1] = out[b]; b--; }
    out[b + 1] = e;
  }
  return out;
}
