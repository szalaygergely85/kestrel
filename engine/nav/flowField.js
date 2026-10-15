// @ts-check
// engine/nav/flowField.js (RE-08, docs/architecture.md 28.2). Dijkstra flow
// field over a NavGrid: one deterministic integration from a goal set out to
// every reachable cell, plus a per-cell direction so many agents can share
// one field instead of running A* per unit (see 28.2 "Do not: run per-unit
// A* for large group moves").
//
// `createFlowField(grid)` preallocates everything a build needs (N =
// grid.w*grid.h cells); `begin`/`step`/`dirAt` allocate nothing afterwards.

// Fixed neighbour order (28.2, same as astar.js): N, E, S, W, then the 4
// diagonals. `dir[i]` stores the index into this table (0..7), or the two
// sentinels below.
const NEI_DX = [0, 1, 0, -1, 1, 1, -1, -1];
const NEI_DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const STRAIGHT_COST = 10;
const DIAG_COST = 14;

const UNREACHED = 0xffffffff;
const DIR_LINK = 253; // NAV-LAYERS-01c: next move is a link; ff.next[idx] holds the target cell
const DIR_GOAL = 254;
const DIR_NONE = 255;

// Precomputed unit vectors for `dirAt` (28.2: "the diagonal uses the
// literal 1/sqrt(2)" - never Math.sqrt at runtime in the hot path).
const INV_SQRT2 = 0.7071067811865476;
const DIR_VX = [0, 1, 0, -1, INV_SQRT2, INV_SQRT2, -INV_SQRT2, -INV_SQRT2];
const DIR_VY = [-1, 0, 1, 0, -INV_SQRT2, INV_SQRT2, INV_SQRT2, -INV_SQRT2];

import { firstLink, sheetOfLocal } from './sheets.js';
import { LQ } from './NavGrid.js';

/** True if a diagonal step from (cx,cy) to (cx+dx,cy+dy) does not cut a
 * corner: both orthogonal cells between them must be walkable. Same rule as
 * astar.js. Straight steps (dx===0 or dy===0) are always allowed here. */
function diagonalOk(cost, w, cx, cy, dx, dy, nx, ny) {
  if (dx === 0 || dy === 0) return true;
  const o1 = cy * w + nx;
  const o2 = ny * w + cx;
  return cost[o1] !== 0 && cost[o2] !== 0;
}

// RE-08p (docs/architecture.md 28.2): a binary min-heap specialized for this
// file only (NOT the shared IndexHeap in heap.js - astar.js/RE-05 keeps using
// that one unchanged). Same push/pop/has/decreaseKey/clear contract as
// IndexHeap, but with the priority comparison inlined: `key` is a
// Uint32Array indexed by HEAP POSITION (not item id) holding a snapshot of
// that slot's `integ` value, so every sift step is a plain typed-array read
// (`key[i] < key[j]`) instead of a closure call through `less(a, b)`. `key`
// is kept in sync with `integ` at the only two points integ can change for
// a heap member: push (new entry) and decreaseKey (integ[item] just got
// smaller) - every other heap mutation (siftUp/siftDown swaps, pop's
// move-last-to-root) just moves the existing key alongside its item, it
// never recomputes it, so key[i] always equals integ[heap[i]]. Ties break by
// item index, exactly like IndexHeap's closure did, inlined too. Zero
// allocation after construction.
// Scratch for the heap key (a double travelling through non-inlined calls is boxed on Node 24; a typed-array slot is not).
const _T = new Float64Array(1);
class FlowFieldHeap {
  /** @param {number} capacity */
  constructor(capacity) {
    this.capacity = capacity | 0;
    this.heap = new Int32Array(this.capacity);
    this.key = new Uint32Array(this.capacity);
    /** heapPos[item] = index in `heap`, or -1 if `item` is not in the heap. */
    this.heapPos = new Int32Array(this.capacity).fill(-1);
    this.size = 0;
  }

  get length() {
    return this.size;
  }

  has(item) {
    return this.heapPos[item] >= 0;
  }

  /** Resets to empty. O(size), not O(capacity) - same as IndexHeap. */
  clear() {
    const heap = this.heap, heapPos = this.heapPos;
    for (let i = 0; i < this.size; i++) heapPos[heap[i]] = -1;
    this.size = 0;
  }

  /** @param {number} item @param {number} k - current integ[item] */
  push(item, k) { _T[0] = k; this.pushT(item); }

  /** push with the key already in `_T[0]` (no boxed double crosses the call). */
  pushT(item) {
    const i = this.size++;
    this.heap[i] = item;
    this.key[i] = _T[0];
    this.heapPos[item] = i;
    this._siftUpT(i, item);
  }

  /** Removes and returns the top (highest-priority) item. Undefined if empty. */
  pop() {
    const heap = this.heap, key = this.key, heapPos = this.heapPos;
    const top = heap[0];
    heapPos[top] = -1;
    this.size--;
    if (this.size > 0) {
      const last = heap[this.size];
      const lastKey = key[this.size];
      heap[0] = last;
      key[0] = lastKey;
      heapPos[last] = 0;
      this._siftDown(0, last, lastKey);
    }
    return top;
  }

  /** Call after `item`'s priority has improved (integ[item] got smaller).
   * @param {number} item @param {number} k - current integ[item] */
  decreaseKey(item, k) { _T[0] = k; this.decreaseKeyT(item); }

  decreaseKeyT(item) {
    const i = this.heapPos[item];
    if (i >= 0) { this.key[i] = _T[0]; this._siftUpT(i, item); }
  }

  _siftUp(i, item, k) { _T[0] = k; this._siftUpT(i, item); }

  _siftUpT(i, item) {
    const k = _T[0];
    const heap = this.heap, key = this.key, heapPos = this.heapPos;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentItem = heap[parent];
      const parentKey = key[parent];
      // less(item, parentItem): k < parentKey, tie-break by item index.
      if (!(k < parentKey || (k === parentKey && item < parentItem))) break;
      heap[i] = parentItem;
      key[i] = parentKey;
      heapPos[parentItem] = i;
      i = parent;
    }
    heap[i] = item;
    key[i] = k;
    heapPos[item] = i;
  }

  _siftDown(i, item, k) {
    const heap = this.heap, key = this.key, heapPos = this.heapPos, size = this.size;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      let smallestItem = item;
      let smallestKey = k;
      if (l < size) {
        const lItem = heap[l], lKey = key[l];
        if (lKey < smallestKey || (lKey === smallestKey && lItem < smallestItem)) {
          smallest = l; smallestItem = lItem; smallestKey = lKey;
        }
      }
      if (r < size) {
        const rItem = heap[r], rKey = key[r];
        if (rKey < smallestKey || (rKey === smallestKey && rItem < smallestItem)) {
          smallest = r; smallestItem = rItem; smallestKey = rKey;
        }
      }
      if (smallest === i) break;
      heap[i] = smallestItem;
      key[i] = smallestKey;
      heapPos[smallestItem] = i;
      i = smallest;
    }
    heap[i] = item;
    key[i] = k;
    heapPos[item] = i;
  }
}

/**
 * Preallocates a flow field over `grid`: `integ` Uint32Array(N) (0xFFFFFFFF
 * = unreached), `dir` Uint8Array(N) (0..7 = neighbour index above, 254 =
 * goal, 255 = none/unreached) and its own FlowFieldHeap (RE-08p). Reuse one instance per
 * distinct group-move "channel"; `FlowCache` below manages a small pool of
 * these keyed by goal set + grid version.
 * @param {import('./NavGrid.js').NavGrid} grid
 */
export function createFlowField(grid) {
  const n = grid.totalCells; // = w*h without layers
  const ff = {
    grid,
    integ: new Uint32Array(n),
    dir: new Uint8Array(n),
    /** NAV-LAYERS-01c: link target per cell (only when grid.layers). */
    next: grid.layers !== null ? new Int32Array(n).fill(-1) : null,
    cellsDone: 0,
    rvFlag: null, rvOrder: null, // NAV-FLOW-REV reverse link index (layers only), refreshed in begin()
    rvL: null, rvFrom: null, rvTo: null, rvN: -1, // the layers / link arrays rvFlag was built for (begin's 0-alloc cache check)
    heap: /** @type {FlowFieldHeap} */ (/** @type {unknown} */ (null)),
  };
  ff.heap = new FlowFieldHeap(n);
  ff.integ.fill(UNREACHED);
  ff.dir.fill(DIR_NONE);

  /**
   * Starts a new integration from `goalCells` (Int32Array of cell indices,
   * first `count` entries). Resets `integ`/`dir`/`cellsDone` and seeds the
   * heap; call `step()` afterwards to actually run Dijkstra. Duplicate goal
   * cells are ignored after the first. Zero allocation.
   * @param {Int32Array} goalCells @param {number} count
   */
  ff.begin = function begin(goalCells, count) {
    ff.integ.fill(UNREACHED);
    ff.dir.fill(DIR_NONE);
    ff.heap.clear();
    ff.cellsDone = 0;
    const L = grid.layers;
    // same freshness key as reverseLinks' cache, checked here first: WeakMap.get boxes ~40 B per call in Maglev (Node 24)
    if (L !== null && (ff.rvL !== L || ff.rvFrom !== L.from || ff.rvTo !== L.to || ff.rvN !== L.nLinks)) {
      const rv = reverseLinks(L, n); ff.rvFlag = rv.flag; ff.rvOrder = rv.order;
      ff.rvL = L; ff.rvFrom = L.from; ff.rvTo = L.to; ff.rvN = L.nLinks;
    }
    if (ff.next !== null) ff.next.fill(-1);
    for (let i = 0; i < count; i++) {
      const g = goalCells[i];
      if (ff.heap.has(g)) continue;
      ff.integ[g] = 0;
      ff.dir[g] = DIR_GOAL;
      ff.heap.push(g, 0);
    }
  };

  /**
   * Settles up to `cellBudget` cells (Dijkstra pops), so a large field can
   * be spread over several ticks (28.2 budget: `step(16384)` <= 0.8 ms).
   * Deterministic regardless of chunking: N calls with budgets summing to
   * B settle exactly the same `integ`/`dir` as one call with budget B.
   * Returns true once every reachable cell is settled (heap empty).
   * @param {number} cellBudget
   */
  ff.step = function step(cellBudget) {
    const g = ff.grid;
    if (g.layers !== null) return stepLayered(ff, cellBudget);
    const w = g.w, h = g.h;
    const cost = g.cost;
    const integ = ff.integ, dir = ff.dir, heap = ff.heap;
    let budget = cellBudget;

    while (heap.length > 0 && budget > 0) {
      const idx = heap.pop();
      budget--;
      ff.cellsDone++;
      const cx = idx % w;
      const cy = (idx / w) | 0;

      // Single pass over the 8 neighbours does both jobs at once: (1) picks
      // the direction toward the lowest-integ neighbour (28.2; ties go by
      // neighbour order, which the strict `<` gives for free - each k
      // reads `integ[nIdx]` before this same iteration could write it, so
      // merging with the relax step below changes nothing), and (2) relaxes
      // (Dijkstra) using the same bounds/walkable/corner check, so the grid
      // and corner tests only run once per neighbour instead of twice.
      const needsDir = dir[idx] !== DIR_GOAL;
      let bestK = -1;
      let bestInteg = UNREACHED;
      const selfInteg = integ[idx];
      for (let k = 0; k < 8; k++) {
        const dx = NEI_DX[k], dy = NEI_DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (cost[nIdx] === 0) continue;
        if (!diagonalOk(cost, w, cx, cy, dx, dy, nx, ny)) continue;

        if (needsDir) {
          const v = integ[nIdx];
          if (v < bestInteg) { bestInteg = v; bestK = k; }
        }

        const edgeCost = (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * cost[nIdx];
        const tentative = selfInteg + edgeCost;
        if (tentative < integ[nIdx]) {
          integ[nIdx] = tentative;
          if (heap.has(nIdx)) heap.decreaseKey(nIdx, tentative);
          else heap.push(nIdx, tentative);
        }
      }
      if (needsDir) dir[idx] = bestK === -1 ? DIR_NONE : bestK;
    }

    return heap.length === 0;
  };

  /**
   * Cell direction at world position (x,y) as a unit vector, written into
   * `out2` ({x,y}, caller-owned). Outside the grid, or a cell that is a
   * goal/unreached, gives (0,0). Zero allocation.
   * With layers the cell is `grid.locate(x, y, z)` (z optional: omitted = ground) and a link move points at
   * the link target's centre.
   * @param {number} x @param {number} y @param {{x:number,y:number}} out2 @param {number} [z]
   */
  /** Layered grids only: `dirAt` with the query (x, y, z) already in the NavGrid scratch `LQ` (no boxed doubles; steer's hot path). */
  ff.dirAtQ = function dirAtQ(out2) { return dirAtLayered(ff, out2); };

  ff.dirAt = function dirAt(x, y, out2, z) {
    const g = ff.grid;
    if (g.layers !== null) { LQ[0] = x; LQ[1] = y; LQ[2] = z === undefined ? -1e9 : z; return dirAtLayered(ff, out2); }
    const cx = g.cellX(x);
    const cy = g.cellY(y);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) {
      out2.x = 0; out2.y = 0;
      return out2;
    }
    const d = ff.dir[g.index(cx, cy)];
    if (d > 7) {
      out2.x = 0; out2.y = 0;
      return out2;
    }
    out2.x = DIR_VX[d];
    out2.y = DIR_VY[d];
    return out2;
  };

  return ff;
}

// ---- NAV-LAYERS-01c: Dijkstra over ground + sheets + links (docs/architecture.md 38.71) ----
// Edge cost = cost of the entered cell * (10 | 14) * unit of that cell's grid (finest-cell units, as astar.js); a link
// costs its `lcost`. NAV-FLOW-REV: links are expanded in REVERSE (from link.to back to link.from), so a one-way drop
// lets cells above it flow to the drop top when the goal is below, and cells below never route through it.
const _fp = { x: 0, y: 0, z: 0 };

function relaxLayered(ff, nIdx) { // tentative cost comes in through _T[0] (no boxed double)
  const integ = ff.integ, heap = ff.heap, tentative = _T[0];
  if (tentative < integ[nIdx]) {
    integ[nIdx] = tentative;
    if (heap.has(nIdx)) heap.decreaseKeyT(nIdx);
    else heap.pushT(nIdx);
  }
}

// Reverse link index (links sorted by `to`, plus a per-cell flag), cached on the layers object; rebuilt only when the
// link table arrays are replaced (addAuthoredLinks/bake). Door open/close changes flags only, read live above.
const _revCache = new WeakMap(); // keyed by layers object (keeps L's hidden class untouched)
function reverseLinks(L, total) {
  let rv = _revCache.get(L);
  if (rv !== undefined && rv.from === L.from && rv.to === L.to && rv.n === L.nLinks) return rv;
  const K = L.nLinks, order = new Int32Array(K), flag = new Uint8Array(total);
  for (let k = 0; k < K; k++) order[k] = k;
  order.sort((a, b) => (L.to[a] - L.to[b]) || (a - b));
  for (let k = 0; k < K; k++) flag[L.to[k]] = 1;
  rv = { from: L.from, to: L.to, n: K, order, flag }; _revCache.set(L, rv);
  return rv;
}

function firstRev(order, to, n, idx) {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (to[order[mid]] < idx) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function relaxReverse(ff, g, L, order, idx, selfInteg) {
  const N = g.w * g.h;
  for (let r = firstRev(order, L.to, L.nLinks, idx); r < L.nLinks; r++) {
    const j = order[r];
    if (L.to[j] !== idx) break;
    if (L.kind[j] === 1 && (L.flags[j] & 1) === 0) continue; // closed door
    const fIdx = L.from[j];
    if ((fIdx < N ? g.cost[fIdx] : L.cost[fIdx - N]) === 0) continue;
    _T[0] = selfInteg + L.lcost[j]; relaxLayered(ff, fIdx);
  }
}

function stepLayered(ff, cellBudget) {
  const g = ff.grid, L = g.layers;
  const N = g.w * g.h, w = g.w, h = g.h;
  const integ = ff.integ, dir = ff.dir, next = ff.next, heap = ff.heap;
  const gU = L.groundU, maxStep = L.maxStepM;
  const rvFlag = ff.rvFlag, rvOrder = ff.rvOrder;
  let budget = cellBudget;
  while (heap.length > 0 && budget > 0) {
    const idx = heap.pop();
    budget--;
    ff.cellsDone++;
    const needsDir = dir[idx] !== DIR_GOAL;
    let bestK = -1, bestInteg = UNREACHED, bestLink = -1;
    const selfInteg = integ[idx];
    if (idx < N) {
      const cx = idx % w, cy = (idx / w) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = NEI_DX[k], dy = NEI_DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (g.cost[nIdx] === 0) continue;
        if (!diagonalOk(g.cost, w, cx, cy, dx, dy, nx, ny)) continue;
        if (needsDir) { const v = integ[nIdx]; if (v < bestInteg) { bestInteg = v; bestK = k; } }
        _T[0] = selfInteg + (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * g.cost[nIdx] * gU; relaxLayered(ff, nIdx);
      }
    } else {
      const local = idx - N, s = sheetOfLocal(L, local), b = L.base[s], sw = L.w[s], sh = L.h[s], u = L.u[s];
      const l = local - b, cx = l % sw, cy = (l / sw) | 0, z0 = L.height[local];
      for (let k = 0; k < 8; k++) {
        const dx = NEI_DX[k], dy = NEI_DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        const nl = b + ny * sw + nx;
        if (L.cost[nl] === 0) continue;
        const dz = L.height[nl] - z0;
        if (dz > maxStep || dz < -maxStep) continue;
        if (dx !== 0 && dy !== 0 && (L.cost[b + cy * sw + nx] === 0 || L.cost[b + ny * sw + cx] === 0)) continue;
        const nIdx = N + nl;
        if (needsDir) { const v = integ[nIdx]; if (v < bestInteg) { bestInteg = v; bestK = k; } }
        _T[0] = selfInteg + (dx !== 0 && dy !== 0 ? DIAG_COST : STRAIGHT_COST) * L.cost[nl] * u; relaxLayered(ff, nIdx);
      }
    }
    // Forward links (idx -> to) only choose this cell's direction; they never relax (the field grows from the goal).
    if (needsDir && L.linkFlag[idx] !== 0) {
      for (let j = firstLink(L, idx); j < L.nLinks && L.from[j] === idx; j++) {
        if (L.kind[j] === 1 && (L.flags[j] & 1) === 0) continue; // closed door
        const nIdx = L.to[j];
        if ((nIdx < N ? g.cost[nIdx] : L.cost[nIdx - N]) === 0) continue;
        const v = integ[nIdx]; if (v < bestInteg) { bestInteg = v; bestK = DIR_LINK; bestLink = nIdx; }
      }
    }
    // NAV-FLOW-REV: relax REVERSE links (every j with to === idx pulls its `from` cell in at integ + lcost), so a
    // one-way drop is only expanded from its low end back to its high end; two-way kinds are in the table both ways.
    if (rvFlag[idx] !== 0) relaxReverse(ff, g, L, rvOrder, idx, selfInteg);
    if (needsDir) {
      dir[idx] = bestK === -1 ? DIR_NONE : bestK;
      next[idx] = bestLink;
    }
  }
  return heap.length === 0;
}

function dirAtLayered(ff, out2) {
  const g = ff.grid;
  const x = LQ[0], y = LQ[1];
  const idx = g.locateQ();
  if (idx < 0) { out2.x = 0; out2.y = 0; return out2; }
  const d = ff.dir[idx];
  if (d === DIR_LINK) {
    g.cellPos(ff.next[idx], _fp);
    const dx = _fp.x - x, dy = _fp.y - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) { out2.x = 0; out2.y = 0; return out2; }
    out2.x = dx / len; out2.y = dy / len;
    return out2;
  }
  if (d > 7) { out2.x = 0; out2.y = 0; return out2; }
  out2.x = DIR_VX[d]; out2.y = DIR_VY[d];
  return out2;
}

/** In-place insertion sort of the first `count` entries of an Int32Array.
 * Cheap and allocation-free for the small goal sets flow fields use. */
function insertionSortInPlace(arr, count) {
  for (let i = 1; i < count; i++) {
    const v = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > v) { arr[j + 1] = arr[j]; j--; }
    arr[j + 1] = v;
  }
}

function sameKey(a, b, count) {
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A small LRU pool of flow fields over one `grid`, keyed by (sorted goal
 * cells, grid.version) so a stale grid version never hands back a field
 * built against old walkability - any `block`/`unblock` bumps `version`
 * and every cached field for that grid is naturally invalidated (the
 * version compare misses and the slot is rebuilt).
 *
 * LRU is ranked by the sim tick the caller passes into `get` - never wall
 * time (28.2 determinism rule) - so eviction order is reproducible in a
 * replay. `slots` is small (default 8) by design, so `get` ranks all slots
 * with a plain index scan rather than a Map: this keeps the whole cache
 * inside typed arrays (no Map/Set iteration-order dependence anywhere in
 * engine/nav) and the scan itself is O(slots), i.e. cheaper than a hash
 * lookup would be at this size. Only the constructor allocates.
 */
export class FlowCache {
  /**
   * @param {import('./NavGrid.js').NavGrid} grid
   * @param {number} [slots]
   * @param {number} [maxGoals] - upper bound on goal-cell count per query.
   */
  constructor(grid, slots = 8, maxGoals = 256) {
    this.grid = grid;
    this.slots = slots;
    this.maxGoals = maxGoals;
    this._fields = new Array(slots);
    this._goalKey = new Array(slots);
    this._goalCount = new Int32Array(slots).fill(-1);
    this._version = new Int32Array(slots).fill(-1);
    this._lastUsed = new Float64Array(slots).fill(-1);
    this._scratch = new Int32Array(maxGoals);
    for (let i = 0; i < slots; i++) {
      this._fields[i] = createFlowField(grid);
      this._goalKey[i] = new Int32Array(maxGoals);
    }
  }

  /**
   * Returns the flow field for these goal cells at the grid's current
   * version: a cache hit just bumps that slot's `tick`; a miss evicts the
   * least-recently-used slot (by `tick`, ties by lowest slot index) and
   * calls `begin()` on it - the caller still drives `step()` to actually
   * build it (so a big field can spread over ticks the same way an
   * uncached one does). `tick` must be the caller's sim tick, monotonic,
   * never `Date.now()`/`performance.now()`.
   * @param {Int32Array} goalCells @param {number} count @param {number} tick
   */
  get(goalCells, count, tick) {
    if (count > this.maxGoals) throw new Error('FlowCache: goal count exceeds maxGoals');
    const scratch = this._scratch;
    for (let i = 0; i < count; i++) scratch[i] = goalCells[i];
    insertionSortInPlace(scratch, count);

    const version = this.grid.version;
    for (let s = 0; s < this.slots; s++) {
      if (this._goalCount[s] === count && this._version[s] === version
        && sameKey(this._goalKey[s], scratch, count)) {
        this._lastUsed[s] = tick;
        return this._fields[s];
      }
    }

    let victim = 0;
    let victimUsed = this._lastUsed[0];
    for (let s = 1; s < this.slots; s++) {
      if (this._lastUsed[s] < victimUsed) { victim = s; victimUsed = this._lastUsed[s]; }
    }

    const key = this._goalKey[victim];
    for (let i = 0; i < count; i++) key[i] = scratch[i];
    this._goalCount[victim] = count;
    this._version[victim] = version;
    this._lastUsed[victim] = tick;

    const ff = this._fields[victim];
    ff.begin(scratch, count);
    return ff;
  }
}
