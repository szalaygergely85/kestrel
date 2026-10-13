// engine/world/bandGrid.js (MAP-10, arch 38.43): generated near-band zone GRID. Pure functions, no World/Terrain
// imports, zero allocation in pick/zoneAt/margins. A zone is {i, j, cx0, cy0, cw, ch} (chunk units, 128 m chunks);
// zone (i,j) starts at chunk (ox + i*stepX, oy + j*stepY), clamped so it stays inside the chunk bounds.

export const CHUNK = 128;
const DEF_SWITCH = { prefetchX: 176, switchX: 112, prefetchY: 120, switchY: 88 };

/** Validates `def` (world json `terrainGrid`) and returns a plain grid with zone counts `ni` x `nj`. Throws on bad data. */
export function makeGrid(def, chunk = CHUNK) {
  if (!def || typeof def !== 'object') throw new Error('World.load: terrainGrid must be an object');
  const int = (k, lo, hi) => {
    const v = def[k];
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`World.load: terrainGrid.${k} must be an integer ${lo}..${hi}`);
    return v;
  };
  const cx0 = int('cx0', 0, 1e4), cy0 = int('cy0', 0, 1e4), cx1 = int('cx1', cx0 + 1, 1e4), cy1 = int('cy1', cy0 + 1, 1e4);
  const cw = int('cw', 1, 6), ch = int('ch', 1, 6), stepX = int('stepX', 1, cw), stepY = int('stepY', 1, ch);
  if (cx1 - cx0 < cw || cy1 - cy0 < ch) throw new Error('World.load: terrainGrid bounds are smaller than one zone');
  const ox = def.ox === undefined ? cx0 : def.ox, oy = def.oy === undefined ? cy0 : def.oy;
  if (!Number.isInteger(ox) || ox < cx0 || !Number.isInteger(oy) || oy < cy0) throw new Error('World.load: terrainGrid.ox/oy must be integers >= cx0/cy0');
  const sw = { ...DEF_SWITCH, ...(def.switch || {}) };
  for (const k of ['prefetchX', 'switchX', 'prefetchY', 'switchY']) if (typeof sw[k] !== 'number' || !isFinite(sw[k])) throw new Error(`World.load: terrainGrid.switch.${k} must be a finite number`);
  if (!(sw.switchX > 32 && sw.prefetchX > sw.switchX && sw.switchY > 32 && sw.prefetchY > sw.switchY)) throw new Error('World.load: terrainGrid.switch needs prefetch > switch > 32 on both axes');
  const ni = Math.max(1, Math.ceil((cx1 - cw - ox) / stepX) + 1), nj = Math.max(1, Math.ceil((cy1 - ch - oy) / stepY) + 1);
  const pin = [];
  if (def.pin !== undefined) { // WM-02: zones that are never evicted from the band cache
    if (!Array.isArray(def.pin)) throw new Error('World.load: terrainGrid.pin must be an array of [i, j]');
    for (const p of def.pin) {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] < 0 || p[1] < 0 || p[0] >= ni || p[1] >= nj) throw new Error('World.load: terrainGrid.pin entries must be [i, j] inside the grid');
      pin.push([p[0], p[1]]);
    }
  }
  return { cx0, cy0, cx1, cy1, cw, ch, stepX, stepY, ox, oy, switch: sw, ni, nj, chunk, pin };
}

const zx0 = (g, i) => Math.min(g.ox + i * g.stepX, g.cx1 - g.cw);
const zy0 = (g, j) => Math.min(g.oy + j * g.stepY, g.cy1 - g.ch);

/** Fills `out` with zone (i, j) (clamped into the grid). Returns `out`. */
export function zoneAt(g, i, j, out) {
  i = i < 0 ? 0 : i >= g.ni ? g.ni - 1 : i; j = j < 0 ? 0 : j >= g.nj ? g.nj - 1 : j;
  out.i = i; out.j = j; out.cx0 = zx0(g, i); out.cy0 = zy0(g, j); out.cw = g.cw; out.ch = g.ch;
  return out;
}

/** Zone id string ("g{i}_{j}"); allocates, call on prefetch / swap only. */
export const zoneId = (i, j) => `g${i}_${j}`;

/** Distance (m) from x (y) to the nearest x (y) edge of zone column i (row j); negative outside. */
export function marginX(g, i, x) { const a = zx0(g, i) * g.chunk; return Math.min(x - a, a + g.cw * g.chunk - x); }
export function marginY(g, j, y) { const a = zy0(g, j) * g.chunk; return Math.min(y - a, a + g.ch * g.chunk - y); }

/** Best zone for (x, y): max slack = min(mX - switchX, mY - switchY) over the <= 3x3 zones around the pose.
 *  Ties keep `cur` (when given), else lower j, then lower i. Writes out.i/out.j. */
export function best(g, cur, x, y, out) {
  const cs = g.chunk, sw = g.switch;
  let i0 = Math.floor((x / cs - g.ox) / g.stepX), j0 = Math.floor((y / cs - g.oy) / g.stepY);
  if (i0 < 0) i0 = 0; else if (i0 >= g.ni) i0 = g.ni - 1;
  if (j0 < 0) j0 = 0; else if (j0 >= g.nj) j0 = g.nj - 1;
  const ia = i0 > 0 ? i0 - 1 : 0, ib = i0 < g.ni - 1 ? i0 + 1 : g.ni - 1;
  const ja = j0 > 0 ? j0 - 1 : 0, jb = j0 < g.nj - 1 ? j0 + 1 : g.nj - 1;
  let bs = -Infinity, bi = ia, bj = ja;
  for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
    const s = Math.min(marginX(g, i, x) - sw.switchX, marginY(g, j, y) - sw.switchY);
    if (s > bs || (s === bs && cur && cur.i === i && cur.j === j)) { bs = s; bi = i; bj = j; }
  }
  out.i = bi; out.j = bj;
  return out;
}

/** Selection. `cur` = {i, j}. Returns 0 keep | 1 prefetch `out` | 2 swap to `out` as soon as it is ready.
 *  out = target (== cur when nothing is better). */
export function pick(g, cur, x, y, out) {
  const sw = g.switch, mX = marginX(g, cur.i, x), mY = marginY(g, cur.j, y);
  out.i = cur.i; out.j = cur.j;
  if (mX >= sw.prefetchX && mY >= sw.prefetchY) return 0;
  best(g, cur, x, y, out);
  if (out.i === cur.i && out.j === cur.j) return 0;
  return (mX < sw.switchX || mY < sw.switchY) ? 2 : 1;
}
