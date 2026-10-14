// @ts-check
// engine/nav/sheets.js (NAV-LAYERS-01a, docs/architecture.md 38.71). Data side of
// the multi-level nav: extra floor "sheets" over the ground grid + a link table.
// No world/physics imports (leaf). `bakeSheets` (geometry probe, step 01b) is at the end.
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

// ---------------------------------------------------------------------------
// NAV-LAYERS-01b: bake sheets from geometry through a probe callback.
// ---------------------------------------------------------------------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_FLOORS = 4;

/**
 * Bakes sheets + auto links for `sources` and installs them via buildLayersFromArrays.
 * Leaf module: geometry arrives only through `probe(x, y, footZ, out) -> boolean`, which writes the
 * highest surface at or below footZ into out.z / out.nz (surface normal z) and returns false if none.
 * @param {import('./NavGrid.js').NavGrid} grid
 * @param {{id:string|number, x0:number, y0:number, x1:number, y1:number, zTop:number, cell?:number}[]} sources
 *   world-space AABBs (yaw already folded into the box by the caller); sorted by id here.
 * @param {(x:number, y:number, footZ:number, out:{z:number, nz:number}) => boolean} probe
 * @param {{maxStepM?:number, agentHeight?:number, maxSlopeDeg?:number, autoDrops?:boolean, maxDropM?:number,
 *   cell?:number, maxSheetCells?:number, maxLinks?:number, keepIsolated?:boolean}} [opts]
 * @returns {{layers:any, stats:{id:string|number, ms:number, cells:number, sheets:number}[], dropped:number}}
 */
export function bakeSheets(grid, sources, probe, opts = {}) {
  const maxStepM = opts.maxStepM ?? 0.5;
  const agentH = opts.agentHeight ?? 1.6;
  const minNz = Math.cos((opts.maxSlopeDeg ?? 50) * Math.PI / 180);
  const maxDrop = opts.maxDropM ?? 3;
  const maxCells = opts.maxSheetCells ?? MAX_SHEET_CELLS;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const srcs = sources.slice().sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const sheets = []; // {src, x0,y0,w,h,cell, cost, height}
  const stats = [];
  const hit = { z: 0, nz: 1 };
  let totalCells = 0;

  for (const src of srcs) {
    const t0 = now();
    const cell = src.cell ?? opts.cell ?? grid.cell;
    const gx0 = grid.x0 + Math.floor((src.x0 - grid.x0) / cell) * cell;
    const gy0 = grid.y0 + Math.floor((src.y0 - grid.y0) / cell) * cell;
    const W = Math.ceil((src.x1 - gx0) / cell - 1e-9), H = Math.ceil((src.y1 - gy0) / cell - 1e-9);
    if (W <= 0 || H <= 0) { stats.push({ id: src.id, ms: 0, cells: 0, sheets: 0 }); continue; }
    const nC = W * H;
    // 1. floors per cell (descending z), slope + headroom filtered.
    const fz = new Float32Array(nC * MAX_FLOORS), fn = new Uint8Array(nC);
    const zs = [], nzs = [];
    for (let c = 0; c < nC; c++) {
      const px = gx0 + ((c % W) + 0.5) * cell, py = gy0 + (((c / W) | 0) + 0.5) * cell;
      zs.length = 0; nzs.length = 0;
      let foot = src.zTop;
      while (zs.length < MAX_FLOORS && probe(px, py, foot, hit)) {
        zs.push(hit.z); nzs.push(hit.nz);
        foot = hit.z - 0.3;
      }
      let k = 0;
      for (let i = 0; i < zs.length; i++) {
        if (nzs[i] < minNz) continue;
        if (i > 0 && zs[i - 1] - zs[i] < agentH) continue; // headroom cut: ceiling too low
        fz[c * MAX_FLOORS + k++] = zs[i];
      }
      fn[c] = k;
    }
    // 2. flood fill nodes (cell, floor) into components; a component never holds two floors of one cell.
    const comp = new Int16Array(nC * MAX_FLOORS).fill(-1);
    const occ = new Int32Array(nC); // comp id + 1 occupying the cell
    const queue = [];
    const compNodes = [];
    for (let c0 = 0; c0 < nC; c0++) {
      for (let f0 = 0; f0 < fn[c0]; f0++) {
        const n0 = c0 * MAX_FLOORS + f0;
        if (comp[n0] >= 0) continue;
        const id = compNodes.length, nodes = [];
        compNodes.push(nodes);
        queue.length = 0; queue.push(n0); comp[n0] = id; occ[c0] = id + 1;
        for (let qi = 0; qi < queue.length; qi++) {
          const n = queue[qi], c = (n / MAX_FLOORS) | 0, z = fz[n];
          nodes.push(n);
          const cx = c % W, cy = (c / W) | 0;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const c2 = ny * W + nx;
            if (occ[c2] === id + 1) continue;
            for (let f = 0; f < fn[c2]; f++) {
              const n2 = c2 * MAX_FLOORS + f;
              if (comp[n2] >= 0 || Math.abs(fz[n2] - z) > maxStepM) continue;
              comp[n2] = id; occ[c2] = id + 1; queue.push(n2);
              break;
            }
          }
        }
      }
    }
    // 3. one sheet per component (tight rect).
    let cells = 0;
    for (const nodes of compNodes) {
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (const n of nodes) {
        const c = (n / MAX_FLOORS) | 0, cx = c % W, cy = (c / W) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      const cost = new Uint8Array(w * h), height = new Float32Array(w * h);
      for (const n of nodes) {
        const c = (n / MAX_FLOORS) | 0, i = (((c / W) | 0) - minY) * w + (c % W - minX);
        cost[i] = 1; height[i] = fz[n];
      }
      totalCells += w * h; cells += w * h;
      if (totalCells > maxCells) throw new Error(`bakeSheets: source "${src.id}" pushes sheets past maxSheetCells ${maxCells}`);
      sheets.push({ src: src.id, x0: gx0 + minX * cell, y0: gy0 + minY * cell, w, h, cell, cost, height });
    }
    stats.push({ id: src.id, ms: now() - t0, cells, sheets: compNodes.length });
  }

  // 4. auto links (step both ways, optional one-way drops) between sheets and to ground.
  const finest = Math.min(grid.cell, ...sheets.map((s) => s.cell));
  const endKey = (e) => (e.s + 1) * 0x1000000 + e.y * 4096 + e.x; // w, h < 4096
  const recs = new Map(); // key -> link (deduped)
  const addLink = (a, b, kind) => {
    const ka = endKey(a), kb = endKey(b);
    if (kind === LINK_STEP) { // symmetric: canonical order, one record per pair
      const key = ka < kb ? ka + ':' + kb : kb + ':' + ka;
      if (!recs.has(key)) recs.set(key, ka < kb ? { from: a, to: b, kind } : { from: b, to: a, kind });
    } else {
      const key = ka + '>' + kb;
      if (!recs.has(key)) recs.set(key, { from: a, to: b, kind });
    }
  };
  for (let s = 0; s < sheets.length; s++) {
    const sh = sheets[s];
    const reach = sh.cell / 2 + finest / 2;
    for (let ly = 0; ly < sh.h; ly++) for (let lx = 0; lx < sh.w; lx++) {
      const i = ly * sh.w + lx;
      if (!sh.cost[i]) continue;
      const z = sh.height[i];
      const cx = sh.x0 + (lx + 0.5) * sh.cell, cy = sh.y0 + (ly + 0.5) * sh.cell;
      for (let d = 0; d < 4; d++) {
        const qx = cx + DIRS[d][0] * reach, qy = cy + DIRS[d][1] * reach;
        const link = (to, z2) => {
          const dz = z - z2;
          if (Math.abs(dz) <= maxStepM) addLink({ s, x: lx, y: ly }, to, LINK_STEP);
          else if (opts.autoDrops && dz > maxStepM && dz <= maxDrop) addLink({ s, x: lx, y: ly }, to, LINK_DROP);
        };
        const gx = Math.floor((qx - grid.x0) / grid.cell), gy = Math.floor((qy - grid.y0) / grid.cell);
        if (grid.inBounds(gx, gy)) {
          const gi = gy * grid.w + gx;
          if (grid.cost[gi] > 0) link({ s: -1, x: gx, y: gy }, grid.height[gi]);
        }
        for (let t = 0; t < sheets.length; t++) {
          if (t === s) continue;
          const o = sheets[t];
          const ox = Math.floor((qx - o.x0) / o.cell), oy = Math.floor((qy - o.y0) / o.cell);
          if (ox < 0 || oy < 0 || ox >= o.w || oy >= o.h || !o.cost[oy * o.w + ox]) continue;
          link({ s: t, x: ox, y: oy }, o.height[oy * o.w + ox]);
        }
      }
    }
  }
  const all = [...recs.values()];
  // 5. drop sheets not reachable from ground (wall tops, roofs): ground-linked sheets + step-link closure.
  let keep = sheets.map(() => true);
  if (!opts.keepIsolated) {
    keep = sheets.map(() => false);
    const adj = sheets.map(() => []), stack = [];
    for (const l of all) {
      const f = l.from.s, t = l.to.s;
      if (f === -1 && t >= 0) { if (!keep[t]) { keep[t] = true; stack.push(t); } }
      else if (t === -1 && f >= 0) { if (l.kind === LINK_STEP && !keep[f]) { keep[f] = true; stack.push(f); } }
      else if (f >= 0 && t >= 0) { adj[f].push(t); if (l.kind === LINK_STEP) adj[t].push(f); }
    }
    while (stack.length) { const s = stack.pop(); for (const t of adj[s]) if (!keep[t]) { keep[t] = true; stack.push(t); } }
  }
  const remap = new Int32Array(sheets.length).fill(-1);
  const outSheets = [];
  let dropped = 0;
  sheets.forEach((sh, s) => { if (keep[s]) { remap[s] = outSheets.length; outSheets.push(sh); } else dropped++; });
  const links = [];
  for (const l of all) {
    const f = l.from.s === -1 ? -1 : remap[l.from.s], t = l.to.s === -1 ? -1 : remap[l.to.s];
    if ((l.from.s !== -1 && f < 0) || (l.to.s !== -1 && t < 0)) continue;
    links.push({ from: { s: f, x: l.from.x, y: l.from.y }, to: { s: t, x: l.to.x, y: l.to.y }, kind: l.kind });
  }
  links.sort((p, q) => (p.from.s - q.from.s) || (p.from.y - q.from.y) || (p.from.x - q.from.x) ||
    (p.to.s - q.to.s) || (p.to.y - q.to.y) || (p.to.x - q.to.x) || (p.kind - q.kind));
  if (outSheets.length === 0) return { layers: null, stats, dropped };
  const layers = buildLayersFromArrays(grid, { sheets: outSheets, links }, { maxStepM, maxSheetCells: maxCells, maxLinks: opts.maxLinks });
  return { layers, stats, dropped };
}
