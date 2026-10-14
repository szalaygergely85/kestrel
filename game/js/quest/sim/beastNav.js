// game/js/quest/sim/beastNav.js (US-079a, architecture.md 29.1). Load-time only (may allocate) - same shape as
// game/js/rts/sim/navSetup.js, over the content world's `nav` block instead of a hard-coded PLAY_AREA.
// NAV-LAYERS-01d (38.71): structures flagged `nav: "floors"` bake sheets (ruin rooms, floors, stairs) on top of the ground layer.
import { NavGrid, createAStar, createSheetBaker } from '../../../../engine/index.js';

// D-103: world_m1 has no walkable bridge; the only crossing is the ford (stones fordS1..7 flagged nav:"floors" + nav.ford wading). The 2-storey house (OB-139) is flagged the same way when it lands.

/**
 * Sheet sources of the flagged structures that touch `rect`: placements sharing a `navGroup` (default: own id) form ONE source whose
 * AABB is the union of the placement AABBs (yaw/scale already folded into `bbox`). A lone placement gets a (mesh, yaw, scale) cache key.
 * Sorted by id, so the bake order (and bytes) never depend on structure order.
 * @param {any} world
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect
 */
export function navFloorSources(world, rect) {
  const groups = new Map();
  for (const s of world.structures || []) {
    if (!s.navFloors || !s.bbox) continue;
    const id = s.navGroup || s.id, g = groups.get(id);
    if (!g) groups.set(id, { id, x0: s.bbox.x0, y0: s.bbox.y0, x1: s.bbox.x1, y1: s.bbox.y1, zTop: s.bbox.z1 + 0.1, n: 1, one: s });
    else { g.x0 = Math.min(g.x0, s.bbox.x0); g.y0 = Math.min(g.y0, s.bbox.y0); g.x1 = Math.max(g.x1, s.bbox.x1); g.y1 = Math.max(g.y1, s.bbox.y1); g.zTop = Math.max(g.zTop, s.bbox.z1 + 0.1); g.n++; }
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.x1 <= rect.x0 || g.x0 >= rect.x1 || g.y1 <= rect.y0 || g.y0 >= rect.y1) continue;
    const src = { id: g.id, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, zTop: g.zTop };
    if (g.n === 1 && g.one.mesh) { // (def, yaw, scale) cache key: same piece placed again reuses the probed floors (translated by zBase)
      src.key = `${g.one.mesh.id ?? g.one.mesh.name ?? g.id}|${g.one.frame ? g.one.frame.yawDeg ?? 0 : 0}|${g.one.scale ?? 1}`; src.zBase = g.one.origin.z;
    }
    out.push(src);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Sliced sheet baker for one grid (or null when no flagged structure touches it): `step(ms)` bakes whole sources until `ms` is used up
 * (>= 1 source per call; the final call links + installs) and returns true when done. Install = `grid.layers` set.
 * @param {any} world
 * @param {any} grid NavGrid
 * @param {{cell?:number, maxStepM?:number, agentHeight?:number, maxSlopeDeg?:number}} [lcfg] `nav.layers` block
 * @param {Map<string, any>} [cache] (def,yaw) floor cache shared across tiles
 */
export function createLayerBaker(world, grid, lcfg = {}, cache = new Map()) {
  const srcs = navFloorSources(world, { x0: grid.x0, y0: grid.y0, x1: grid.x0 + grid.w * grid.cell, y1: grid.y0 + grid.h * grid.cell });
  if (!srcs.length) return null;
  const baker = createSheetBaker(grid, srcs, world.navFloorProbe(), { cell: lcfg.cell ?? 0.5, maxStepM: lcfg.maxStepM ?? 0.5, agentHeight: lcfg.agentHeight ?? 1.6, maxSlopeDeg: lcfg.maxSlopeDeg ?? 50, cache });
  let done = false;
  return {
    stats: baker.stats,
    step(ms) {
      if (done) return true;
      const t0 = performance.now();
      while (baker.stepSource()) if (performance.now() - t0 >= ms) return false;
      baker.finish(); done = true; // links + install: one more slice
      return true;
    },
  };
}

/** `cfg.layers` for `world.setNavTiles` (tile worlds): `(world, grid) => createLayerBaker(...)`, one shared (def,yaw) cache. */
export function makeNavTileLayers(lcfg) {
  const cache = new Map();
  return (world, grid) => createLayerBaker(world, grid, lcfg, cache);
}

/**
 * Builds a NavGrid + A* over `navCfg` (the content world's `nav` block:
 * `{area:{x0,y0,w,h}, cell, maxSlopeDeg, maxStepM, blockedTypes}`) and the real `world` (terrain + structures).
 * Flagged structures add sheets (`grid.layers`); a world without flagged structures is byte-identical to before.
 * @param {any} world engine World
 * @param {{area:{x0:number,y0:number,w:number,h:number}, cell?:number, maxSlopeDeg?:number, maxStepM?:number, blockedTypes?:string[], layers?:any, ford?:{maxDepth?:number, cost?:number}}} navCfg
 */
export function buildBeastNav(world, navCfg) {
  const a = navCfg.area;
  // NAV-LINKS-01b: `navCfg.ford = {maxDepth?, cost?}` makes shallow water (< maxDepth, default 0.6 m) walkable at the ford cost; absent = unchanged.
  const wq = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
  const ford = navCfg.ford && typeof world.waterAt === 'function'
    ? { maxDepth: navCfg.ford.maxDepth ?? 0.6, cost: navCfg.ford.cost ?? 4, depthAt: (x, y) => (world.waterAt(x, y, wq) ? wq.depth : -1) } : undefined;
  const grid = new NavGrid({ x0: a.x0, y0: a.y0, w: a.w, h: a.h, cell: navCfg.cell ?? 1 });
  grid.buildFromWorld(world, {
    maxSlopeDeg: navCfg.maxSlopeDeg ?? 30,
    maxStepM: navCfg.maxStepM ?? Infinity,
    blockedTypes: navCfg.blockedTypes ?? ['water'],
    ford,
  });
  if (typeof world.navFloorProbe === 'function') { const bk = createLayerBaker(world, grid, navCfg.layers); if (bk) while (!bk.step(1e9)); }
  const astar = createAStar(grid);
  return { grid, astar };
}

// BEAST-08a (architecture.md 38.64 item 5): per-nav-tile water mask + swim grids. Load-time only (may allocate).
export const WATER_DEEP_M = 0.6; // mask 1 = depth >= this (a swimmer's pool; shallower is wading, see nav.ford)
export const WATER_BANK_M = 4;   // mask 2 = non-deep cell within this distance of a mask-1 cell

/**
 * Water mask over `grid`'s rect, ONE `waterAt` call per cell (cell centre): 1 = depth >= 0.6 m, 2 = bank band (<= 4 m from a mask-1 cell),
 * 0 = else. `surf[i]` = water surface z of every wet cell (0 elsewhere). Deterministic (row-major scans only).
 * @param {any} world engine World (needs waterAt)
 * @param {any} grid NavGrid (only x0,y0,w,h,cell are read)
 * @param {{deep?:number, bank?:number}} [o]
 */
export function buildWaterMask(world, grid, o = {}) {
  const deep = o.deep ?? WATER_DEEP_M, bank = o.bank ?? WATER_BANK_M, w = grid.w, h = grid.h, n = w * h;
  const mask = new Uint8Array(n), surf = new Float32Array(n);
  const wq = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    if (world.waterAt(grid.cellCenterX(cx), grid.cellCenterY(cy), wq)) {
      const i = cy * w + cx;
      surf[i] = wq.surfaceZ;
      if (wq.depth >= deep) mask[i] = 1;
    }
  }
  const r = Math.ceil(bank / grid.cell), r2 = (bank / grid.cell) * (bank / grid.cell);
  const band = new Uint8Array(n);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    if (mask[cy * w + cx] !== 1) continue;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy; if (y < 0 || y >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx; if (x < 0 || x >= w || dx * dx + dy * dy > r2) continue;
        band[y * w + x] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) if (mask[i] === 0 && band[i]) mask[i] = 2;
  return { mask, surf };
}

/** NavGrid + A* whose walkable cells are the ones where `keep(mask[i])` is true (cost 1). Height = water surface. */
function maskNav(base, mask, surf, keep) {
  const n = mask.length, ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) ok[i] = keep(mask[i]) ? 1 : 0;
  const grid = new NavGrid({ x0: base.x0, y0: base.y0, w: base.w, h: base.h, cell: base.cell });
  grid.buildFromArrays(surf, ok, new Uint8Array(n), { blockedTypes: [], typeNames: [''] });
  return { grid, astar: createAStar(grid) };
}

/**
 * Water nav for swimmers: `mask`/`surf` plus `swim` (walkable = mask 1) and `croc` (mask 1 or 2) grids with their A*.
 * @param {any} world
 * @param {any} grid the land NavGrid (same rect)
 * @param {{deep?:number, bank?:number}} [o]
 */
export function buildWaterNav(world, grid, o) {
  const { mask, surf } = buildWaterMask(world, grid, o);
  return { mask, surf, grid, swim: maskNav(grid, mask, surf, (m) => m === 1), croc: maskNav(grid, mask, surf, (m) => m === 1 || m === 2) };
}
