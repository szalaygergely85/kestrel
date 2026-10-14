// @ts-check
// engine/nav/astar.js (RE-05, docs/architecture.md 28.2). Deterministic A*
// over a NavGrid: integer costs, fixed neighbour order, tie-break by
// (f, h, index) so the result never depends on Map/Set/insertion order.
// `createAStar` preallocates everything a query needs (N = grid.w*grid.h
// cells); `findPath`/`smoothPath`/`pathCrossesRect` allocate nothing.

import { IndexHeap } from './heap.js';
import { firstLink, sheetOfLocal } from './sheets.js';

// Fixed neighbour order (28.2): N, E, S, W, then the 4 diagonals.
const NEI_DX = [0, 1, 0, -1, 1, 1, -1, -1];
const NEI_DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const STRAIGHT_COST = 10;
const DIAG_COST = 14;
// Shared default for findPath's `opts` - nothing in the function mutates it,
// so one module-level object avoids a fresh {} allocation on every call
// that omits opts.
const EMPTY_OPTS = {};

function octile(dx, dy, minCost) {
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  const mx = adx > ady ? adx : ady;
  const mn = adx < ady ? adx : ady;
  return minCost * (STRAIGHT_COST * mx + 4 * mn);
}

/** Preallocates everything a `findPath` query against `grid` needs (N =
 * grid.w*grid.h cells): no per-query allocation afterwards. Reuse one
 * instance for every query against that grid. */
export function createAStar(grid) {
  const n = grid.totalCells; // = w*h without layers (NAV-LAYERS-01a)
  const astar = {
    grid,
    g: new Int32Array(n),
    h: new Int32Array(n),
    f: new Int32Array(n),
    parent: new Int32Array(n),
    openStamp: new Uint32Array(n),
    closedStamp: new Uint32Array(n),
    generation: 0,
    partial: false,
    gxm: 0, gym: 0, // layered search: goal in metres
    gen: 0, gIdx: 0,
    scratch: new Int32Array(n), // planPath's cell path (LIFE-01)
    heap: /** @type {IndexHeap} */ (/** @type {unknown} */ (null)),
  };
  astar.heap = new IndexHeap(n, (a, b) => {
    if (astar.f[a] !== astar.f[b]) return astar.f[a] < astar.f[b];
    if (astar.h[a] !== astar.h[b]) return astar.h[a] < astar.h[b];
    return a < b;
  });
  return astar;
}

/**
 * Finds a path from cell (sx,sy) to (gx,gy) in `astar.grid`, writing cell
 * indices start..goal into `outPath` (Int32Array, caller-owned, must hold
 * at least grid.w*grid.h entries) and returning the path length.
 *
 * Returns 0 if the start cell is out of bounds or unwalkable. If the goal
 * is unreachable/unwalkable/out of bounds, or `opts.maxNodes` expansions
 * are hit first, returns the path to the best closed cell instead (smallest
 * h, then smallest g, then smallest index) and sets `astar.partial = true`
 * (`false` on an exact path to the goal).
 * @param {ReturnType<typeof createAStar>} astar
 * @param {number} sx @param {number} sy @param {number} gx @param {number} gy
 * @param {Int32Array} outPath
 * @param {{maxNodes?: number}} [opts]
 */
export function findPath(astar, sx, sy, gx, gy, outPath, opts = EMPTY_OPTS) {
  const grid = astar.grid;
  const w = grid.w, gh = grid.h;
  astar.partial = false;
  if (sx < 0 || sy < 0 || sx >= w || sy >= gh || gx < 0 || gy < 0 || gx >= w || gy >= gh) return 0;
  const si = sy * w + sx;
  const gi = gy * w + gx;
  if (grid.layers !== null) return findPathCells(astar, si, gi, outPath, opts);
  if (grid.cost[si] === 0) return 0;

  const maxNodes = opts.maxNodes ?? Infinity;
  const { g, h, f, parent, openStamp, closedStamp, heap } = astar;
  const gen = ++astar.generation;
  heap.clear();

  g[si] = 0;
  h[si] = octile(gx - sx, gy - sy, grid.minCost);
  f[si] = h[si];
  parent[si] = -1;
  openStamp[si] = gen;
  heap.push(si);

  let bestClosed = si;
  let bestH = h[si];
  let bestG = 0;
  let reachedGoal = si === gi;
  let nodesExpanded = 0;

  while (heap.length > 0 && !reachedGoal) {
    const idx = heap.pop();
    closedStamp[idx] = gen;
    const cx = idx % w;
    const cy = (idx / w) | 0;

    if (h[idx] < bestH
      || (h[idx] === bestH && g[idx] < bestG)
      || (h[idx] === bestH && g[idx] === bestG && idx < bestClosed)) {
      bestClosed = idx; bestH = h[idx]; bestG = g[idx];
    }

    if (idx === gi) { reachedGoal = true; break; }

    nodesExpanded++;
    if (nodesExpanded > maxNodes) break;

    for (let k = 0; k < 8; k++) {
      const dx = NEI_DX[k], dy = NEI_DY[k];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= gh) continue;
      const nIdx = ny * w + nx;
      if (grid.cost[nIdx] === 0) continue;
      if (closedStamp[nIdx] === gen) continue;
      if (dx !== 0 && dy !== 0) {
        // No corner cutting: both orthogonal neighbours must be walkable.
        const o1 = cy * w + nx;
        const o2 = ny * w + cx;
        if (grid.cost[o1] === 0 || grid.cost[o2] === 0) continue;
      }
      const stepCost = (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * grid.cost[nIdx];
      const tentativeG = g[idx] + stepCost;
      const isOpen = openStamp[nIdx] === gen;
      if (!isOpen || tentativeG < g[nIdx]) {
        g[nIdx] = tentativeG;
        parent[nIdx] = idx;
        if (!isOpen) h[nIdx] = octile(gx - nx, gy - ny, grid.minCost);
        f[nIdx] = g[nIdx] + h[nIdx];
        if (!isOpen) {
          openStamp[nIdx] = gen;
          heap.push(nIdx);
        } else {
          heap.decreaseKey(nIdx);
        }
      }
    }
  }

  const final = reachedGoal ? gi : bestClosed;
  astar.partial = !reachedGoal;

  let count = 0;
  let cur = final;
  while (cur !== -1) {
    outPath[count++] = cur;
    cur = parent[cur];
  }
  for (let a = 0, b = count - 1; a < b; a++, b--) {
    const t = outPath[a]; outPath[a] = outPath[b]; outPath[b] = t;
  }
  return count;
}

// ---- NAV-LAYERS-01a: A* over ground + sheets + links (docs/architecture.md 38.71) ----
// Step costs are in finest-cell units: straight 10*cost*u, diagonal 14*cost*u, u = cell/finestCell.
// Heuristic = floor(minCost * octile(metres/finest)); integer link/step costs keep it consistent.
const _p = { x: 0, y: 0, z: 0 };

function cellCostL(grid, i) {
  const n = grid.w * grid.h;
  return i < n ? grid.cost[i] : grid.layers.cost[i - n];
}

function heuristicL(astar, idx) {
  const grid = astar.grid;
  grid.cellPos(idx, _p);
  const L = grid.layers;
  const adx = Math.abs(_p.x - astar.gxm) / L.finest, ady = Math.abs(_p.y - astar.gym) / L.finest;
  const mx = adx > ady ? adx : ady, mn = adx < ady ? adx : ady;
  const mc = grid.minCost < L.minCost ? grid.minCost : L.minCost;
  return Math.floor(mc * (STRAIGHT_COST * mx + 4 * mn) + 1e-6);
}

/** Relax edge idx -> nIdx with integer step cost (shared by ground / sheet / link moves). */
function relaxL(astar, idx, nIdx, stepCost) {
  const { g, h, f, parent, openStamp, heap } = astar;
  const tentativeG = g[idx] + stepCost;
  const isOpen = openStamp[nIdx] === astar.gen;
  if (!isOpen || tentativeG < g[nIdx]) {
    g[nIdx] = tentativeG;
    parent[nIdx] = idx;
    if (!isOpen) h[nIdx] = heuristicL(astar, nIdx);
    f[nIdx] = g[nIdx] + h[nIdx];
    if (!isOpen) { openStamp[nIdx] = astar.gen; heap.push(nIdx); } else heap.decreaseKey(nIdx);
  }
}

/**
 * Layered A* between global cell indices (ground 0..N-1, sheet cells N..). Same contract as `findPath`
 * (partial path to the closest closed cell when the goal is unreachable / maxNodes hit). Used by `findPath`
 * itself whenever `grid.layers` is set; call it directly to start/end on a sheet cell (`grid.locate`).
 * @param {ReturnType<typeof createAStar>} astar
 * @param {number} si @param {number} gi @param {Int32Array} outPath
 * @param {{maxNodes?: number}} [opts]
 */
export function findPathCells(astar, si, gi, outPath, opts = EMPTY_OPTS) {
  const grid = astar.grid, L = grid.layers;
  astar.partial = false;
  const N = grid.w * grid.h, total = grid.totalCells;
  if (si < 0 || gi < 0 || si >= total || gi >= total) return 0;
  if (cellCostL(grid, si) === 0) return 0;
  grid.cellPos(gi, _p);
  astar.gxm = _p.x; astar.gym = _p.y;

  const maxNodes = opts.maxNodes ?? Infinity;
  const { g, h, parent, openStamp, closedStamp, heap } = astar;
  const gen = ++astar.generation;
  astar.gen = gen;
  heap.clear();
  g[si] = 0; h[si] = heuristicL(astar, si); astar.f[si] = h[si]; parent[si] = -1;
  openStamp[si] = gen; heap.push(si);

  let bestClosed = si, bestH = h[si], bestG = 0;
  let reachedGoal = si === gi, nodesExpanded = 0;
  const w = grid.w, gh = grid.h, maxStep = L.maxStepM, gU = L.groundU;

  while (heap.length > 0 && !reachedGoal) {
    const idx = heap.pop();
    closedStamp[idx] = gen;
    if (h[idx] < bestH || (h[idx] === bestH && g[idx] < bestG) || (h[idx] === bestH && g[idx] === bestG && idx < bestClosed)) {
      bestClosed = idx; bestH = h[idx]; bestG = g[idx];
    }
    if (idx === gi) { reachedGoal = true; break; }
    nodesExpanded++;
    if (nodesExpanded > maxNodes) break;

    if (idx < N) {
      const cx = idx % w, cy = (idx / w) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = NEI_DX[k], dy = NEI_DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= gh) continue;
        const nIdx = ny * w + nx;
        if (grid.cost[nIdx] === 0 || closedStamp[nIdx] === gen) continue;
        if (dx !== 0 && dy !== 0 && (grid.cost[cy * w + nx] === 0 || grid.cost[ny * w + cx] === 0)) continue;
        relaxL(astar, idx, nIdx, (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * grid.cost[nIdx] * gU);
      }
    } else {
      const local = idx - N, s = sheetOfLocal(L, local), b = L.base[s], sw = L.w[s], sh = L.h[s], u = L.u[s];
      const l = local - b, cx = l % sw, cy = (l / sw) | 0, z0 = L.height[local];
      for (let k = 0; k < 8; k++) {
        const dx = NEI_DX[k], dy = NEI_DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        const nl = b + ny * sw + nx;
        const nIdx = N + nl;
        if (L.cost[nl] === 0 || closedStamp[nIdx] === gen) continue;
        const dz = L.height[nl] - z0;
        if (dz > maxStep || dz < -maxStep) continue;
        if (dx !== 0 && dy !== 0 && (L.cost[b + cy * sw + nx] === 0 || L.cost[b + ny * sw + cx] === 0)) continue;
        relaxL(astar, idx, nIdx, (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * L.cost[nl] * u);
      }
    }

    if (L.linkFlag[idx] !== 0) {
      for (let j = firstLink(L, idx); j < L.nLinks && L.from[j] === idx; j++) {
        if (L.kind[j] === 1 && (L.flags[j] & 1) === 0) continue; // closed door
        const nIdx = L.to[j];
        if (closedStamp[nIdx] === gen || cellCostL(grid, nIdx) === 0) continue;
        relaxL(astar, idx, nIdx, L.lcost[j]);
      }
    }
  }

  const final = reachedGoal ? gi : bestClosed;
  astar.partial = !reachedGoal;
  let count = 0, cur = final;
  while (cur !== -1) { outPath[count++] = cur; cur = parent[cur]; }
  for (let a = 0, b2 = count - 1; a < b2; a++, b2--) { const t = outPath[a]; outPath[a] = outPath[b2]; outPath[b2] = t; }
  return count;
}

/** Bresenham supercover line of sight between two cells, `cost > 0` only,
 * same no-corner-cutting rule as `findPath` (a diagonal step past two
 * blocked orthogonal neighbours is never "in sight"). Zero allocation. */
function hasLineOfSight(grid, ia, ib) {
  const w = grid.w;
  const x0 = ia % w, y0 = (ia / w) | 0;
  const x1 = ib % w, y1 = (ib / w) | 0;
  if (grid.cost[y0 * w + x0] === 0 || grid.cost[y1 * w + x1] === 0) return false;
  const dx = x1 > x0 ? x1 - x0 : x0 - x1;
  const dy = y1 > y0 ? y1 - y0 : y0 - y1;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    let stepX = 0, stepY = 0;
    if (e2 > -dy) { err -= dy; stepX = sx; }
    if (e2 < dx) { err += dx; stepY = sy; }
    if (stepX !== 0 && stepY !== 0) {
      const o1 = y * w + (x + stepX);
      const o2 = (y + stepY) * w + x;
      if (grid.cost[o1] === 0 || grid.cost[o2] === 0) return false;
    }
    x += stepX; y += stepY;
    if (grid.cost[y * w + x] === 0) return false;
  }
  return true;
}

/**
 * String-pulls `path` (cell indices, length `len`) into world-space
 * waypoints at cell centres, using the `cost > 0` line-of-sight test above.
 * Writes `outXY` (Float64Array, caller-owned, >= 2*len entries) as
 * [x0,y0,x1,y1,...] and returns the waypoint count. Never produces a
 * segment that crosses a `cost === 0` cell.
 * With `grid.layers` (NAV-LAYERS-01c) the pull runs per run of cells in one space (ground or one sheet) joined by
 * ordinary moves; a space switch or a link keeps both its end cells as waypoints. Optional `outZ` (>= len entries)
 * receives each waypoint's cell z (layered grids only).
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {Int32Array} path @param {number} len @param {Float64Array} outXY @param {Float64Array} [outZ]
 */
export function smoothPath(grid, path, len, outXY, outZ) {
  if (len === 0) return 0;
  if (grid.layers !== null) return smoothLayered(grid, path, len, outXY, outZ);
  const w = grid.w;
  let count = 0;
  const first = path[0];
  outXY[0] = grid.cellCenterX(first % w);
  outXY[1] = grid.cellCenterY((first / w) | 0);
  count = 1;
  if (len === 1) return count;

  let anchor = 0;
  for (let i = 1; i < len - 1; i++) {
    if (!hasLineOfSight(grid, path[anchor], path[i + 1])) {
      const idx = path[i];
      outXY[count * 2] = grid.cellCenterX(idx % w);
      outXY[count * 2 + 1] = grid.cellCenterY((idx / w) | 0);
      count++;
      anchor = i;
    }
  }
  const last = path[len - 1];
  outXY[count * 2] = grid.cellCenterX(last % w);
  outXY[count * 2 + 1] = grid.cellCenterY((last / w) | 0);
  count++;
  return count;
}

/**
 * True if any of `path`'s first `len` cells falls inside the half-open cell
 * rect `{cx0, cy0, cx1, cy1}`. Used to decide which cached paths need a
 * re-plan when a footprint changes (RE-10).
 * @param {Int32Array} path @param {number} len
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {{cx0:number, cy0:number, cx1:number, cy1:number}} rect
 */
export function pathCrossesRect(path, len, grid, rect) {
  const w = grid.w;
  const { cx0, cy0, cx1, cy1 } = rect;
  for (let i = 0; i < len; i++) {
    const idx = path[i];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) return true;
  }
  return false;
}

/**
 * LIFE-01 free-target helper: plan (sx,sy,gx,gy world metres) on `grid`, smooth, and write waypoint x,y pairs into
 * `outBuf` (Float64Array, caller-owned; capacity = outBuf.length>>1 waypoints, extra corners are dropped but the last
 * waypoint is always the path end). Returns the waypoint count, 0 if the start is off-grid/blocked.
 * `astar.partial` is true when the goal was unreachable/blocked/over `maxNodes` (the path then ends at the closest
 * reached cell). Allocates nothing.
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {ReturnType<typeof createAStar>} astar
 * @param {Float64Array} outBuf
 */
export function planPath(grid, astar, sx, sy, gx, gy, outBuf, maxNodes = 1500) {
  const cells = astar.scratch;
  const len = findPath(astar, grid.cellX(sx), grid.cellY(sy), grid.cellX(gx), grid.cellY(gy), cells, { maxNodes });
  if (len === 0) return 0;
  let count = smoothPath(grid, cells, len, outBuf);
  const cap = outBuf.length >> 1;
  if (count > cap) {
    const last = cells[len - 1];
    outBuf[(cap - 1) * 2] = grid.cellCenterX(last % grid.w);
    outBuf[(cap - 1) * 2 + 1] = grid.cellCenterY((last / grid.w) | 0);
    count = cap;
  }
  return count;
}

// ---- NAV-LAYERS-01c: smoothing across sheets / links ----
const _sp = { x: 0, y: 0, z: 0 };

/** True if path cells a -> b are one ordinary 8-neighbour move inside one space (not a link). */
function plainMove(grid, a, b) {
  const n = grid.w * grid.h, L = grid.layers;
  if (a < n && b < n) {
    const dx = (b % grid.w) - (a % grid.w), dy = ((b / grid.w) | 0) - ((a / grid.w) | 0);
    return dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1;
  }
  if (a < n || b < n) return false;
  const s = sheetOfLocal(L, a - n);
  if (sheetOfLocal(L, b - n) !== s) return false;
  const sw = L.w[s], la = a - n - L.base[s], lb = b - n - L.base[s];
  const dx = (lb % sw) - (la % sw), dy = ((lb / sw) | 0) - ((la / sw) | 0);
  return dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1;
}

/** Line of sight inside one sheet: cost > 0, |dz| <= maxStepM per cell step, no corner cutting. */
function sheetLineOfSight(grid, ia, ib) {
  const n = grid.w * grid.h, L = grid.layers;
  const s = sheetOfLocal(L, ia - n), b = L.base[s], sw = L.w[s], maxStep = L.maxStepM;
  const la = ia - n - b, lb = ib - n - b;
  const x0 = la % sw, y0 = (la / sw) | 0, x1 = lb % sw, y1 = (lb / sw) | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    let stepX = 0, stepY = 0;
    if (e2 > -dy) { err -= dy; stepX = sx; }
    if (e2 < dx) { err += dx; stepY = sy; }
    const px = x, py = y;
    if (stepX !== 0 && stepY !== 0) {
      const o1 = b + y * sw + (x + stepX), o2 = b + (y + stepY) * sw + x;
      if (L.cost[o1] === 0 || L.cost[o2] === 0) return false;
      const z0 = L.height[b + py * sw + px];
      if (Math.abs(L.height[o1] - z0) > maxStep || Math.abs(L.height[o2] - z0) > maxStep) return false;
    }
    x += stepX; y += stepY;
    const c = b + y * sw + x;
    if (L.cost[c] === 0) return false;
    if (Math.abs(L.height[c] - L.height[b + py * sw + px]) > maxStep) return false;
  }
  return true;
}

function emitWaypoint(grid, idx, outXY, outZ, count) {
  grid.cellPos(idx, _sp);
  outXY[count * 2] = _sp.x; outXY[count * 2 + 1] = _sp.y;
  if (outZ) outZ[count] = _sp.z;
}

function smoothLayered(grid, path, len, outXY, outZ) {
  let count = 0, a = 0;
  while (a < len) {
    // run [a..b]: consecutive path cells joined by plain moves in one space
    let b = a;
    while (b + 1 < len && plainMove(grid, path[b], path[b + 1])) b++;
    emitWaypoint(grid, path[a], outXY, outZ, count++);
    if (b > a) {
      const ground = path[a] < grid.w * grid.h;
      let anchor = a;
      for (let i = a + 1; i < b; i++) {
        const los = ground ? hasLineOfSight(grid, path[anchor], path[i + 1]) : sheetLineOfSight(grid, path[anchor], path[i + 1]);
        if (!los) { emitWaypoint(grid, path[i], outXY, outZ, count++); anchor = i; }
      }
      emitWaypoint(grid, path[b], outXY, outZ, count++);
    }
    a = b + 1;
  }
  return count;
}
