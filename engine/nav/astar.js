// @ts-check
// engine/nav/astar.js (RE-05, docs/architecture.md 28.2). Deterministic A*
// over a NavGrid: integer costs, fixed neighbour order, tie-break by
// (f, h, index) so the result never depends on Map/Set/insertion order.
// `createAStar` preallocates everything a query needs (N = grid.w*grid.h
// cells); `findPath`/`smoothPath`/`pathCrossesRect` allocate nothing.

import { IndexHeap } from './heap.js';

// Fixed neighbour order (28.2): N, E, S, W, then the 4 diagonals.
const NEI_DX = [0, 1, 0, -1, 1, 1, -1, -1];
const NEI_DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const STRAIGHT_COST = 10;
const DIAG_COST = 14;

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
  const n = grid.w * grid.h;
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
export function findPath(astar, sx, sy, gx, gy, outPath, opts = {}) {
  const grid = astar.grid;
  const w = grid.w, gh = grid.h;
  astar.partial = false;
  if (sx < 0 || sy < 0 || sx >= w || sy >= gh || gx < 0 || gy < 0 || gx >= w || gy >= gh) return 0;
  const si = sy * w + sx;
  const gi = gy * w + gx;
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
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {Int32Array} path @param {number} len @param {Float64Array} outXY
 */
export function smoothPath(grid, path, len, outXY) {
  if (len === 0) return 0;
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
