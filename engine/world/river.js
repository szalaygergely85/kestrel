// engine/world/river.js (OB-019 RIVER-01a, docs/architecture.md 38.45 (1)): the `river` water shape.
// Pure: a polyline def is validated, then compiled at load into resampled SoA samples + a 16 m bucket grid (CSR);
// `riverLocate` is the 0-alloc query (nearest segment of the cell's candidates). No rendering / physics here.
export const RIVER_MAX = 4;
export const RIVER_DS = 2;        // resample spacing along the arc (m)
export const RIVER_CELL = 16;     // bucket grid cell (m)
// riverLocate scratch layout (Float64Array rv.loc): s, lat, z, hw, tx, ty, v, cached x, cached y, inside flag
export const L_S = 0, L_LAT = 1, L_Z = 2, L_HW = 3, L_TX = 4, L_TY = 5, L_V = 6;
export const RIVER_FEATHER = 1.5; // default render feather (m); NOT part of the inside test
const SUB = 32;                   // Catmull-Rom sub-steps per control segment before resampling
const num = (v) => typeof v === 'number' && isFinite(v);

/** Default flow speed from the control-segment slope (38.45): clamp(0.6 + 8*slope, 0.6, 3). */
const defSpeed = (slope) => Math.min(3, Math.max(0.6, 0.6 + 8 * slope));

/**
 * Validates one raw river def (throws via `fail(msg)`), returns the normalised plain def fields
 * {path:[x,y,z,halfW,speed][], feather, clip:string[], draw}. `flowMax` = FLOW_MAX.
 */
export function normalizeRiver(r, fail, flowMax) {
  const p = r.path;
  if (!Array.isArray(p) || p.length < 2 || p.length > 256) fail('"path" must have 2..256 vertices');
  const path = [];
  for (let k = 0; k < p.length; k++) {
    const v = p[k];
    if (!Array.isArray(v) || (v.length !== 4 && v.length !== 5) || !v.every(num)) fail(`vertex ${k}: must be [x, y, z, halfW, speed?] (finite numbers)`);
    if (v[3] < 0.5 || v[3] > 60) fail(`vertex ${k}: halfW ${v[3]} outside 0.5..60`);
    if (v.length === 5 && (v[4] < 0.1 || v[4] > flowMax)) fail(`vertex ${k}: speed ${v[4]} outside 0.1..${flowMax}`);
    path.push([v[0], v[1], v[2], v[3], v.length === 5 ? v[4] : NaN]);
  }
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const ds = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (ds < 1 || ds > 64) fail(`vertex ${k}: segment length ${ds.toFixed(2)} outside 1..64 m`);
    if (b[2] > a[2] + 0.01) fail(`vertex ${k}: z rises downstream (${a[2]} -> ${b[2]})`);
    if (Math.abs(b[2] - a[2]) / ds > 0.6) fail(`vertex ${k}: slope ${(Math.abs(b[2] - a[2]) / ds).toFixed(3)} > 0.6`);
  }
  for (let k = 0; k < path.length; k++) {
    if (!isNaN(path[k][4])) continue;
    const j = k < path.length - 1 ? k : k - 1; // outgoing segment (last vertex: incoming)
    const a = path[j], b = path[j + 1];
    path[k][4] = defSpeed(Math.max(0, a[2] - b[2]) / Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const feather = r.feather === undefined ? RIVER_FEATHER : r.feather;
  if (!num(feather) || feather < 0 || feather > 16) fail('"feather" must be a finite number 0..16');
  const clip = r.clip === undefined ? [] : r.clip;
  if (!Array.isArray(clip) || clip.length > 2 || !clip.every((c) => typeof c === 'string' && c)) fail('"clip" must be an array of <= 2 region ids');
  return { path, feather, clip: clip.slice(), draw: r.draw !== false };
}

/** Compiles a normalised river (see `normalizeRiver`) into the query table. May allocate (load time only). */
export function compileRiver(id, nd) {
  const P = nd.path, M = P.length, feather = nd.feather;
  // 1) dense Catmull-Rom (x, y) with z / halfW / speed linear in the control parameter.
  const D = (M - 1) * SUB + 1;
  const dx = new Float64Array(D), dy = new Float64Array(D), dz = new Float64Array(D), dh = new Float64Array(D), dv = new Float64Array(D), dl = new Float64Array(D);
  for (let k = 0; k < M - 1; k++) {
    const p0 = P[Math.max(0, k - 1)], p1 = P[k], p2 = P[k + 1], p3 = P[Math.min(M - 1, k + 2)];
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB, t2 = t * t, t3 = t2 * t, o = k * SUB + j;
      dx[o] = 0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3);
      dy[o] = 0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3);
    }
  }
  dx[D - 1] = P[M - 1][0]; dy[D - 1] = P[M - 1][1];
  for (let o = 1; o < D; o++) dl[o] = dl[o - 1] + Math.hypot(dx[o] - dx[o - 1], dy[o] - dy[o - 1]);
  // z / halfW / speed: linear in ARC LENGTH between consecutive control vertices (so z(s) is exactly piecewise linear)
  for (let k = 0; k < M - 1; k++) {
    const p1 = P[k], p2 = P[k + 1], a = dl[k * SUB], len = dl[(k + 1) * SUB] - a;
    for (let j = 0; j <= SUB; j++) {
      const o = k * SUB + j, t = len > 0 ? (dl[o] - a) / len : j / SUB;
      dz[o] = p1[2] + (p2[2] - p1[2]) * t; dh[o] = p1[3] + (p2[3] - p1[3]) * t; dv[o] = p1[4] + (p2[4] - p1[4]) * t;
    }
  }
  const L = dl[D - 1];
  // 2) resample every <= RIVER_DS m of arc (even spacing, both ends hit exactly).
  const n = Math.ceil(L / RIVER_DS) + 1, step = L / (n - 1);
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), HW = new Float64Array(n), SP = new Float64Array(n);
  const TX = new Float64Array(n), TY = new Float64Array(n), S = new Float64Array(n), TAU = new Float64Array(n);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (o < D - 2 && dl[o + 1] < s) o++;
    const seg = dl[o + 1] - dl[o], t = seg > 0 ? Math.min(1, Math.max(0, (s - dl[o]) / seg)) : 0;
    X[i] = dx[o] + (dx[o + 1] - dx[o]) * t; Y[i] = dy[o] + (dy[o + 1] - dy[o]) * t; Z[i] = dz[o] + (dz[o + 1] - dz[o]) * t;
    HW[i] = dh[o] + (dh[o + 1] - dh[o]) * t; SP[i] = dv[o] + (dv[o + 1] - dv[o]) * t; S[i] = s;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const ex = X[b] - X[a], ey = Y[b] - Y[a], el = Math.hypot(ex, ey) || 1;
    TX[i] = ex / el; TY[i] = ey / el;
    if (i > 0) TAU[i] = TAU[i - 1] + (S[i] - S[i - 1]) / (0.5 * (SP[i] + SP[i - 1]));
  }
  // 3) inner bend radius must stay >= halfW + feather (else the ribbon would overlap itself).
  for (let i = 1; i < n - 1; i++) {
    const ax = X[i] - X[i - 1], ay = Y[i] - Y[i - 1], bx = X[i + 1] - X[i], by = Y[i + 1] - Y[i];
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    const dth = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (dth > 1e-9) {
      const rad = 0.5 * (al + bl) / dth;
      if (rad < HW[i] + feather) throw new Error(`World.load: water "${id}": bend at s=${S[i].toFixed(1)} m has radius ${rad.toFixed(2)} < halfW + feather ${(HW[i] + feather).toFixed(2)}`);
    }
  }
  // 4) bucket grid (CSR) over the AABB grown by max(hw) + feather.
  let hmax = 0, zmin = Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    hmax = Math.max(hmax, HW[i]); zmin = Math.min(zmin, Z[i]);
    x0 = Math.min(x0, X[i]); y0 = Math.min(y0, Y[i]); x1 = Math.max(x1, X[i]); y1 = Math.max(y1, Y[i]);
  }
  const g = hmax + feather;
  const gx0 = x0 - g, gy0 = y0 - g, gw = Math.ceil((x1 + g - gx0) / RIVER_CELL) + 1, gh = Math.ceil((y1 + g - gy0) / RIVER_CELL) + 1;
  const cells = gw * gh, cellStart = new Int32Array(cells + 1);
  const half = RIVER_CELL * Math.SQRT1_2; // cell centre -> corner (conservative capsule test)
  const visit = (fn) => {
    for (let i = 0; i < n - 1; i++) {
      const r = Math.max(HW[i], HW[i + 1]) + feather + half;
      const cxa = Math.max(0, Math.floor((Math.min(X[i], X[i + 1]) - r - gx0) / RIVER_CELL)), cxb = Math.min(gw - 1, Math.floor((Math.max(X[i], X[i + 1]) + r - gx0) / RIVER_CELL));
      const cya = Math.max(0, Math.floor((Math.min(Y[i], Y[i + 1]) - r - gy0) / RIVER_CELL)), cyb = Math.min(gh - 1, Math.floor((Math.max(Y[i], Y[i + 1]) + r - gy0) / RIVER_CELL));
      const sx = X[i + 1] - X[i], sy = Y[i + 1] - Y[i], l2 = sx * sx + sy * sy;
      for (let cy = cya; cy <= cyb; cy++) for (let cx = cxa; cx <= cxb; cx++) {
        const px = gx0 + (cx + 0.5) * RIVER_CELL, py = gy0 + (cy + 0.5) * RIVER_CELL;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - X[i]) * sx + (py - Y[i]) * sy) / l2)) : 0;
        if (Math.hypot(px - X[i] - sx * t, py - Y[i] - sy * t) <= r) fn(cy * gw + cx, i);
      }
    }
  };
  visit((c) => { cellStart[c + 1]++; });
  for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
  const segIdx = new Int32Array(cellStart[cells]), fill = cellStart.slice(0, cells);
  visit((c, i) => { segIdx[fill[c]++] = i; });
  return {
    id, n, x: X, y: Y, z: Z, hw: HW, sp: SP, tx: TX, ty: TY, s: S, tau: TAU, length: L, feather, clip: nd.clip, draw: nd.draw,
    gx0, gy0, gw, gh, cellStart, segIdx, hmax, zmin, x0: x0 - hmax, y0: y0 - hmax, x1: x1 + hmax, y1: y1 + hmax,
    loc: new Float64Array(10).fill(NaN), // Float64Array scratch: object double fields boxed (alloc) in V8
  
  };
}

/**
 * Nearest-segment query. Fills `rv.loc` (Float64Array, indices L_S, L_LAT (signed, + = left of flow), L_Z, L_HW, L_TX, L_TY, L_V) and returns true iff
 * |lat| <= hw (the feather is render-only). Repeating the same (x, y) is a cached no-op. 0 alloc.
 */
export function riverLocate(rv, x, y) {
  const loc = rv.loc;
  if (x === loc[7] && y === loc[8]) return loc[9] === 1;
  loc[7] = x; loc[8] = y; loc[9] = 0;
  const cx = Math.floor((x - rv.gx0) / RIVER_CELL), cy = Math.floor((y - rv.gy0) / RIVER_CELL);
  if (cx < 0 || cy < 0 || cx >= rv.gw || cy >= rv.gh) return false;
  const c = cy * rv.gw + cx, X = rv.x, Y = rv.y;
  let best = -1, bd = Infinity, bt = 0, bcross = 0;
  for (let k = rv.cellStart[c], e = rv.cellStart[c + 1]; k < e; k++) {
    const i = rv.segIdx[k];
    const sx = X[i + 1] - X[i], sy = Y[i + 1] - Y[i], px = x - X[i], py = y - Y[i];
    let t = (px * sx + py * sy) / (sx * sx + sy * sy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - sx * t, ey = py - sy * t, d = ex * ex + ey * ey;
    if (d < bd || (d === bd && i < best)) { bd = d; best = i; bt = t; bcross = sx * py - sy * px; }
  }
  if (best < 0) return false;
  const i = best, u = 1 - bt;
  const lat = bcross >= 0 ? Math.sqrt(bd) : -Math.sqrt(bd);
  const hw = rv.hw[i] * u + rv.hw[i + 1] * bt;
  loc[L_S] = rv.s[i] * u + rv.s[i + 1] * bt; loc[L_LAT] = lat; loc[L_HW] = hw;
  loc[L_Z] = rv.z[i] * u + rv.z[i + 1] * bt; loc[L_V] = rv.sp[i] * u + rv.sp[i + 1] * bt;
  const tx = rv.tx[i] * u + rv.tx[i + 1] * bt, ty = rv.ty[i] * u + rv.ty[i + 1] * bt, tl = Math.hypot(tx, ty) || 1;
  loc[L_TX] = tx / tl; loc[L_TY] = ty / tl;
  const inside = Math.abs(lat) <= hw;
  loc[9] = inside ? 1 : 0;
  return inside;
}
