// @ts-check
// engine/nav/sheets.js (NAV-LAYERS-01a, docs/architecture.md 38.71). Data side of
// the multi-level nav: extra floor "sheets" over the ground grid + a link table.
// No world/physics imports (leaf). `bakeSheets` (geometry probe) is step 01b.
//
// Cell index space: ground 0..N-1, sheet cells N + base[s] + ly*w[s] + lx.
// grid.layers (null for ground-only grids) holds typed arrays only; see 38.71.

export const LINK_STEP = 0, LINK_DOOR = 1, LINK_DROP = 2, LINK_LADDER = 3, LINK_AUTHORED = 4;
export const LINK_OPEN = 1; // flags bit 0 (doors: set = open; other kinds ignore it)
export const MAX_SHEET_CELLS = 32768, MAX_LINKS = 4096;

/** Largest sheet s with base[s] <= local (binary search, 0 alloc). */
export function sheetOfLocal(layers, local) {
  const base = layers.base;
  let lo = 0, hi = layers.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (base[mid] <= local) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Global cell index of sheet cell (s, lx, ly). */
export function sheetCellIndex(grid, s, lx, ly) {
  const L = grid.layers;
  return grid.w * grid.h + L.base[s] + ly * L.w[s] + lx;
}

/** Lower bound of a link cost: octile distance between the two cell centres in finest-cell units (x minCost). */
function linkLowerBound(grid, a, b, minCost) {
  const pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  grid.cellPos(a, pa); grid.cellPos(b, pb);
  const f = grid.layers.finest;
  const dx = Math.abs(pa.x - pb.x) / f, dy = Math.abs(pa.y - pb.y) / f;
  return Math.floor(minCost * (10 * Math.max(dx, dy) + 4 * Math.min(dx, dy)) + 1e-6);
}

/**
 * Builds `grid.layers` from plain arrays (fixtures / bake output). Ground arrays are untouched.
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {{sheets: {x0:number,y0:number,w:number,h:number,cell:number,cost:Uint8Array,height:Float32Array}[],
 *   links?: {from:{s:number,x:number,y:number}, to:{s:number,x:number,y:number}, cost?:number, kind?:number, flags?:number, stateIdx?:number}[]}} spec
 *   link ends: s = -1 ground (x,y = ground cell), else sheet index. Kinds 0/1/3 are mirrored (both ways); 2 and 4 one way.
 * @param {{maxStepM?:number, maxSheetCells?:number, maxLinks?:number}} [opts]
 */
export function buildLayersFromArrays(grid, spec, opts = {}) {
  const maxStepM = opts.maxStepM ?? 0.5;
  const S = spec.sheets.length, N = grid.w * grid.h;
  const base = new Int32Array(S + 1);
  let finest = grid.cell;
  for (let s = 0; s < S; s++) {
    const sh = spec.sheets[s];
    if (sh.cost.length !== sh.w * sh.h || sh.height.length !== sh.w * sh.h) throw new Error(`sheet ${s}: array size != w*h`);
    base[s + 1] = base[s] + sh.w * sh.h;
    if (sh.cell < finest) finest = sh.cell;
  }
  const L = base[S];
  if (L > (opts.maxSheetCells ?? MAX_SHEET_CELLS)) throw new Error(`sheets: ${L} cells exceed maxSheetCells`);
  // u = step-cost unit of a cell size (cell / finest); must be a whole number (power of two in practice).
  const uOf = (cell, what) => {
    const u = Math.round(cell / finest);
    if (Math.abs(u * finest - cell) > 1e-9 || u < 1) throw new Error(`${what}: cell ${cell} is not a multiple of the finest cell ${finest}`);
    return u;
  };
  const layers = {
    count: S, finest, maxStepM, groundU: uOf(grid.cell, 'ground'), minCost: 255,
    x0: new Float64Array(S), y0: new Float64Array(S), w: new Int16Array(S), h: new Int16Array(S),
    cell: new Float32Array(S), u: new Uint8Array(S), base,
    cost: new Uint8Array(L), height: new Float32Array(L), linkFlag: new Uint8Array(N + L),
    nLinks: 0,
    from: new Int32Array(0), to: new Int32Array(0), lcost: new Uint16Array(0),
    kind: new Uint8Array(0), flags: new Uint8Array(0), stateIdx: new Int16Array(0),
  };
  for (let s = 0; s < S; s++) {
    const sh = spec.sheets[s];
    layers.x0[s] = sh.x0; layers.y0[s] = sh.y0; layers.w[s] = sh.w; layers.h[s] = sh.h;
    layers.cell[s] = sh.cell; layers.u[s] = uOf(sh.cell, `sheet ${s}`);
    layers.cost.set(sh.cost, base[s]); layers.height.set(sh.height, base[s]);
    for (let i = 0; i < sh.cost.length; i++) if (sh.cost[i] > 0 && sh.cost[i] < layers.minCost) layers.minCost = sh.cost[i];
  }
  grid.layers = layers;
  grid.totalCells = N + L;

  // Link table: resolve ends, mirror two-way kinds, sort by (from, to, input order) -> same bytes every run.
  const idxOf = (e, what) => {
    if (e.s === -1) {
      if (!grid.inBounds(e.x, e.y)) throw new Error(`link ${what}: ground cell out of bounds`);
      return e.y * grid.w + e.x;
    }
    if (e.s < 0 || e.s >= S || e.x < 0 || e.y < 0 || e.x >= layers.w[e.s] || e.y >= layers.h[e.s]) throw new Error(`link ${what}: bad sheet cell`);
    return N + base[e.s] + e.y * layers.w[e.s] + e.x;
  };
  const recs = [];
  const links = spec.links ?? [];
  const minCost = Math.min(layers.minCost, grid.minCost);
  for (let k = 0; k < links.length; k++) {
    const l = links[k];
    const a = idxOf(l.from, k + ' from'), b = idxOf(l.to, k + ' to');
    const kind = l.kind ?? LINK_STEP;
    const lb = linkLowerBound(grid, a, b, minCost);
    const cost = l.cost ?? Math.max(1, lb);
    if (cost < lb) throw new Error(`link ${k}: cost ${cost} below admissible bound ${lb}`);
    const flags = l.flags ?? (kind === LINK_DOOR ? 0 : LINK_OPEN);
    const si = l.stateIdx ?? -1;
    recs.push({ a, b, cost, kind, flags, si, ord: recs.length });
    if (kind === LINK_STEP || kind === LINK_DOOR || kind === LINK_LADDER) recs.push({ a: b, b: a, cost, kind, flags, si, ord: recs.length });
  }
  if (recs.length > (opts.maxLinks ?? MAX_LINKS)) throw new Error(`links: ${recs.length} exceed maxLinks`);
  recs.sort((p, q) => p.a - q.a || p.b - q.b || p.ord - q.ord);
  const K = recs.length;
  layers.nLinks = K;
  layers.from = new Int32Array(K); layers.to = new Int32Array(K); layers.lcost = new Uint16Array(K);
  layers.kind = new Uint8Array(K); layers.flags = new Uint8Array(K); layers.stateIdx = new Int16Array(K);
  for (let k = 0; k < K; k++) {
    const r = recs[k];
    layers.from[k] = r.a; layers.to[k] = r.b; layers.lcost[k] = r.cost;
    layers.kind[k] = r.kind; layers.flags[k] = r.flags; layers.stateIdx[k] = r.si;
    layers.linkFlag[r.a] = 1;
  }
  grid.version++;
  return layers;
}

/** First link index with from === idx (nLinks if none). Binary search, 0 alloc. */
export function firstLink(layers, idx) {
  let lo = 0, hi = layers.nLinks;
  const from = layers.from;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (from[mid] < idx) lo = mid + 1; else hi = mid;
  }
  return lo;
}
