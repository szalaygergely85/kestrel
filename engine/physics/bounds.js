// engine/physics/bounds.js (WS1-01, architecture.md 38.36 item 1).
// Walk bound = one circle or a union (1..8) of convex parts (circle / capsule).
// Stand-alone: imports nothing. Zero allocation (caller-owned `out`).
//   bounds: {shape:'polygon', pts:[[x,y],...]} (MAP-11, see below)
//         | {shape:'circle', x, y, r}
//         | {shape:'union', parts:[{shape:'circle',x,y,r} | {shape:'capsule',ax,ay,bx,by,r}, ...]}
const EPS = 1e-6;

// Distance from (x,y) to the part's core (point or segment); writes the core point to `core`.
const core = { x: 0, y: 0 };
function partDist(p, x, y) {
  if (p.shape === 'capsule') {
    const sx = p.bx - p.ax, sy = p.by - p.ay;
    const l2 = sx * sx + sy * sy;
    let t = l2 > 0 ? ((x - p.ax) * sx + (y - p.ay) * sy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    core.x = p.ax + sx * t; core.y = p.ay + sy * t;
  } else {
    core.x = p.x; core.y = p.y;
  }
  return Math.hypot(x - core.x, y - core.y);
}

// ---- MAP-11 polygon bounds (arch 38.43) -----------------------------------------------------------
// {shape:'polygon', pts:[[x,y],...]}: walk = inside a simple polygon (3..128 verts). A 64 m bucket grid is built
// once (compilePolygon, non-enumerable `_poly`); a query reads ONE bucket: edges within PAD of it, plus an
// inside flag at the bucket centre; inside(p) = flag XOR parity of the centre->p segment crossing local edges.
const BUCKET = 64, PAD = 64;
const _o = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Throws on a bad polygon (3..128 finite verts, no repeated vertex, no self-intersection/touching). */
export function validatePolygon(pts) {
  if (!Array.isArray(pts) || pts.length < 3 || pts.length > 128) throw new Error('World.load: bounds.pts must be an array of 3..128 [x, y] points');
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !isFinite(p[0]) || !isFinite(p[1])) throw new Error(`World.load: bounds.pts[${i}] must be [x, y] finite numbers`);
    const q = pts[(i + 1) % n];
    if (q && p[0] === q[0] && p[1] === q[1]) throw new Error(`World.load: bounds.pts[${i}] repeats the next point`);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
    const a = pts[i], b = pts[(i + 1) % n], c = pts[j], d = pts[(j + 1) % n];
    const o1 = _o(a[0], a[1], b[0], b[1], c[0], c[1]), o2 = _o(a[0], a[1], b[0], b[1], d[0], d[1]);
    const o3 = _o(c[0], c[1], d[0], d[1], a[0], a[1]), o4 = _o(c[0], c[1], d[0], d[1], b[0], b[1]);
    const bbox = Math.min(a[0], b[0]) <= Math.max(c[0], d[0]) && Math.min(c[0], d[0]) <= Math.max(a[0], b[0]) &&
                 Math.min(a[1], b[1]) <= Math.max(c[1], d[1]) && Math.min(c[1], d[1]) <= Math.max(a[1], b[1]);
    if (bbox && o1 * o2 <= 0 && o3 * o4 <= 0) throw new Error(`World.load: bounds polygon edges ${i} and ${j} intersect or touch`);
  }
  return n;
}

/** Builds (once) the bucket grid on the bounds object; call at load so the first step allocates nothing. */
export function compilePolygon(b) {
  if (b._poly) return b._poly;
  const pts = b.pts, n = pts.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    ax[i] = p[0]; ay[i] = p[1]; bx[i] = q[0]; by[i] = q[1];
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    area += p[0] * q[1] - q[0] * p[1];
  }
  const gw = Math.max(1, Math.ceil((x1 - x0) / BUCKET)), gh = Math.max(1, Math.ceil((y1 - y0) / BUCKET)), nb = gw * gh;
  const start = new Int32Array(nb + 1);
  let list = null, cur = null;
  for (let pass = 0; pass < 2; pass++) {
    for (let e = 0; e < n; e++) {
      const i0 = Math.max(0, Math.floor((Math.min(ax[e], bx[e]) - PAD - x0) / BUCKET)), i1 = Math.min(gw - 1, Math.floor((Math.max(ax[e], bx[e]) + PAD - x0) / BUCKET));
      const j0 = Math.max(0, Math.floor((Math.min(ay[e], by[e]) - PAD - y0) / BUCKET)), j1 = Math.min(gh - 1, Math.floor((Math.max(ay[e], by[e]) + PAD - y0) / BUCKET));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * gw + i; if (pass) list[cur[k]++] = e; else start[k + 1]++; }
    }
    if (!pass) { for (let k = 0; k < nb; k++) start[k + 1] += start[k]; list = new Int32Array(start[nb]); cur = start.slice(0, nb); }
  }
  const cx = new Float64Array(nb), cy = new Float64Array(nb), inside = new Uint8Array(nb);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    cx[k] = x0 + (i + 0.5) * BUCKET + 0.0137; cy[k] = y0 + (j + 0.5) * BUCKET + 0.0291; // off-centre: avoids vertex hits
    let c = 0; // ray to +x over ALL edges (build time only)
    for (let e = 0; e < n; e++) if ((ay[e] > cy[k]) !== (by[e] > cy[k]) && cx[k] < ax[e] + (cy[k] - ay[e]) * (bx[e] - ax[e]) / (by[e] - ay[e])) c ^= 1;
    inside[k] = c;
  }
  const P = { n, ax, ay, bx, by, x0, y0, gw, gh, start, list, cx, cy, inside, orient: area >= 0 ? 1 : -1 };
  Object.defineProperty(b, '_poly', { value: P, enumerable: false });
  return P;
}

// query scratch: nearest distance, nearest point, inside flag, nearest edge
let _d = 0, _qx = 0, _qy = 0, _in = false, _e = 0;
function nearestEdge(P, x, y, e) {
  const sx = P.bx[e] - P.ax[e], sy = P.by[e] - P.ay[e], l2 = sx * sx + sy * sy;
  let t = l2 > 0 ? ((x - P.ax[e]) * sx + (y - P.ay[e]) * sy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = P.ax[e] + sx * t, qy = P.ay[e] + sy * t, d = Math.hypot(x - qx, y - qy);
  if (d < _d) { _d = d; _qx = qx; _qy = qy; _e = e; }
}
function polyQuery(P, x, y) {
  _d = Infinity; _e = 0;
  const bi = Math.floor((x - P.x0) / BUCKET), bj = Math.floor((y - P.y0) / BUCKET);
  if (bi >= 0 && bj >= 0 && bi < P.gw && bj < P.gh) {
    const k = bj * P.gw + bi, s = P.start[k], t = P.start[k + 1];
    if (s === t) { // no edge within PAD: the bucket flag decides
      if (P.inside[k]) { _d = PAD; _in = true; _qx = x; _qy = y; return; }
    } else {
      for (let m = s; m < t; m++) nearestEdge(P, x, y, P.list[m]);
      let c = P.inside[k]; const px = P.cx[k], py = P.cy[k];
      for (let m = s; m < t; m++) { // crossings of centre -> point
        const e = P.list[m];
        if ((_o(px, py, x, y, P.ax[e], P.ay[e]) >= 0) === (_o(px, py, x, y, P.bx[e], P.by[e]) >= 0)) continue;
        if ((_o(P.ax[e], P.ay[e], P.bx[e], P.by[e], px, py) >= 0) !== (_o(P.ax[e], P.ay[e], P.bx[e], P.by[e], x, y) >= 0)) c ^= 1;
      }
      _in = c === 1; return;
    }
  }
  // outside the grid, or an empty outside bucket: brute force over all edges (rare: an escaped body)
  for (let e = 0; e < P.n; e++) nearestEdge(P, x, y, e);
  _in = false;
}

/** Signed overshoot of a capsule body (radius) past the bound: <= 0 inside, > 0 outside. */
export function boundsOvershoot(bounds, x, y, radius) {
  if (bounds.shape === 'polygon') {
    polyQuery(bounds._poly || compilePolygon(bounds), x, y);
    return _in ? radius - _d : _d + radius;
  }
  if (bounds.shape !== 'union') return partDist(bounds, x, y) - (bounds.r - radius);
  const parts = bounds.parts;
  let best = Infinity;
  for (let i = 0; i < parts.length; i++) {
    const o = partDist(parts[i], x, y) - (parts[i].r - radius);
    if (o < best) best = o;
  }
  return best;
}

/**
 * If outside, writes the projected position and outward unit normal into out
 * {x, y, nx, ny} and returns true; inside (or degenerate) returns false.
 */
export function projectBounds(bounds, x, y, radius, out) {
  if (bounds.shape === 'polygon') {
    const P = bounds._poly || compilePolygon(bounds);
    // up to 4 passes: at a convex vertex one push leaves the body 0.7 R from each wall, the next passes finish it
    let hit = false;
    for (let it = 0; it < 4; it++) {
      polyQuery(P, x, y);
      if (_in && !(radius - _d > 1e-9)) break;
      let nx, ny; // outward unit normal at the nearest edge point
      if (_d > EPS) { const s = _in ? -1 : 1; nx = s * (x - _qx) / _d; ny = s * (y - _qy) / _d; }
      else { const sx = P.bx[_e] - P.ax[_e], sy = P.by[_e] - P.ay[_e], l = Math.hypot(sx, sy) || 1; nx = P.orient * sy / l; ny = -P.orient * sx / l; }
      x = _qx - nx * radius; y = _qy - ny * radius;
      if (!hit) { out.nx = nx; out.ny = ny; hit = true; }
    }
    if (hit) { out.x = x; out.y = y; }
    return hit;
  }
  let part = bounds;
  if (bounds.shape === 'union') {
    const parts = bounds.parts;
    let best = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const o = partDist(parts[i], x, y) - (parts[i].r - radius);
      if (o <= 0) return false;
      if (o < best) { best = o; part = parts[i]; }
    }
  }
  const d = partDist(part, x, y);
  const lim = part.r - radius;
  if (!(d > lim && d > EPS)) return false;
  const nx = (x - core.x) / d, ny = (y - core.y) / d;
  out.x = core.x + nx * lim;
  out.y = core.y + ny * lim;
  out.nx = nx; out.ny = ny;
  return true;
}
