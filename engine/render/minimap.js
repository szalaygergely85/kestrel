// @ts-check
// engine/render/minimap.js - RE-13 (docs/backlog.md "PC-B QUEUE 5" item 11,
// docs/architecture.md 28.4 "RE-13 minimap"). Pure JS RGBA8 minimap: a
// terrain image baked once (type colour x height shade), fog of war applied
// from an engine/world/Visibility-shaped `view`, per-frame unit dots and a
// camera footprint (the pitched frustum's screen corners projected onto
// terrain). Terrain, fog and units are duck-typed parameters - this module
// imports ONLY `screenRay` (engine/render/projection.js) and `rayTerrain`
// (engine/render/pick.js), per 28.4.
//
// Image convention: `rgba` is a Uint8ClampedArray(width*height*4), north up
// (image u = +x east, v = +y south). `sx = (x1-x0)/width`,
// `sy = (y1-y0)/height`. `minimapToWorld`/`worldToMinimap` are exact linear
// inverses of each other (pixel centre of pixel i is u = i + 0.5).
//
// Zero allocation in `update()`/`bindFog()` after `createMinimap` - all
// scratch (`_ray`, `_hit`) is preallocated on the returned `mm` object.

import { screenRay } from './projection.js';
import { rayTerrain } from './pick.js';

// Fallback max ray distance for the camera-footprint plane intersection when
// a screen-corner ray points up (`dz >= 0`, never reaches even the flat
// `z = terrain min` plane going forward) - a literal constant, not imported,
// per 28.4's "imports only screenRay/rayTerrain" rule (this is not PROJ_FAR).
const FOOTPRINT_FALLBACK_MAX_T = 2000;

// Light direction for the terrain bake shade term: normalize(-1, -1, 2),
// light from the north-west (28.4 "Bake"). Precomputed once (module load).
const LS_LEN = Math.sqrt(1 + 1 + 4);
const LS_X = -1 / LS_LEN, LS_Y = -1 / LS_LEN, LS_Z = 2 / LS_LEN;

/**
 * @typedef {Object} Minimap
 * @property {number} width @property {number} height
 * @property {number} x0 @property {number} y0 @property {number} x1 @property {number} y1
 * @property {number} sx @property {number} sy
 * @property {Uint8Array} teamRgb - stride 3, one entry per team (up to 8)
 * @property {number[]} unseenRgb @property {number[]} footprintRgb
 * @property {number} exploredQ8 @property {boolean} hideUnseen
 * @property {Uint8ClampedArray} base   - baked terrain RGB, stride 3, no fog
 * @property {Uint8ClampedArray} fogged - `base` through the fog LUT, stride 4 (alpha fixed 255)
 * @property {Uint8ClampedArray} rgba   - final output, stride 4 - what the caller uploads/draws
 * @property {Int32Array} visIdx        - per pixel-centre: `view` cell index, or -1 outside its grid
 */

/**
 * Allocates a `Minimap` (base/fogged/rgba/visIdx, all zeroed). No baking, no
 * fog binding yet - call `bakeTerrain` then `bindFog` before the first
 * `update`.
 * @param {{width?:number, height?:number, x0:number, y0:number, x1:number,
 *   y1:number, teamRgb: Uint8Array, unseenRgb?: number[], exploredQ8?: number,
 *   footprintRgb?: number[], hideUnseen?: boolean}} opts
 * @returns {Minimap}
 */
export function createMinimap(opts) {
  const width = opts.width || 256;
  const height = opts.height || 256;
  const n = width * height;
  const mm = {
    width, height,
    x0: opts.x0, y0: opts.y0, x1: opts.x1, y1: opts.y1,
    sx: (opts.x1 - opts.x0) / width,
    sy: (opts.y1 - opts.y0) / height,
    teamRgb: opts.teamRgb,
    unseenRgb: opts.unseenRgb || [0, 0, 0],
    exploredQ8: opts.exploredQ8 != null ? opts.exploredQ8 : 110,
    footprintRgb: opts.footprintRgb || [255, 255, 255],
    hideUnseen: opts.hideUnseen !== false,
    base: new Uint8ClampedArray(n * 3),
    fogged: new Uint8ClampedArray(n * 4),
    rgba: new Uint8ClampedArray(n * 4),
    visIdx: new Int32Array(n).fill(-1),
    _hMin: 0,
    // Fog-rebuild memo: forces a rebuild on the very first `update()`.
    _fogVersion: -1,
    _fogTeam: -1,
    // Preallocated scratch, reused every `update()` call (footprint rays).
    _ray: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 },
    _hit: { x: 0, y: 0, z: 0, t: 0, hit: false },
    _cornerPx: new Int32Array(8), // 4 corners x (px, py)
  };
  // 28.4's pseudocode calls these as methods (`mm.bakeTerrain(...)`,
  // `mm.bindFog(...)`, `mm.update(...)`) - thin bound wrappers around the
  // module-level functions below (kept free functions too, so tests and
  // internal reuse can call them directly with an explicit `mm`). This also
  // lets game/js/rts/ui/minimapView.js (presentation layer, deep-import of
  // engine/render/** is a check-deps finding for game code, rule 3) drive a
  // minimap purely through the `mm` instance it's handed, with no import of
  // this module at all.
  mm.bakeTerrain = (terrain, typeRgb, opts2) => bakeTerrain(mm, terrain, typeRgb, opts2);
  mm.bindFog = (view) => bindFog(mm, view);
  mm.update = (units, view, viewTeam, terms, terrain) => update(mm, units, view, viewTeam, terms, terrain);
  return mm;
}

/**
 * Bakes the terrain image once (load time, <= 30 ms at 256^2, no alloc after
 * this call): per pixel centre, the ANALYTIC `terrain.heightAt/normalAt/
 * typeAt` (camera-independent), `shade = (0.35 + 0.65*max(0,N.Ls)) *
 * (0.8 + 0.2*hn)` with `hn` = height normalised to `opts.hMin..hMax`,
 * `base = round(typeRgb * shade)`; a pixel where `opts.structureAt?.(x,y)`
 * is true gets `opts.structureRgb` instead.
 * @param {Minimap} mm
 * @param {{heightAt(x:number,y:number):number, normalAt(x:number,y:number,out:{x:number,y:number,z:number}):void, typeAt(x:number,y:number):number}} terrain
 * @param {Uint8Array} typeRgb - stride 3, one entry per terrain type id
 * @param {{hMin?:number, hMax?:number, structureAt?:(x:number,y:number)=>boolean, structureRgb?:number[]}} [opts]
 */
export function bakeTerrain(mm, terrain, typeRgb, opts = {}) {
  const hMin = opts.hMin != null ? opts.hMin : 0;
  const hMax = opts.hMax != null ? opts.hMax : 64;
  const hRange = hMax - hMin || 1;
  const structureAt = opts.structureAt;
  const structureRgb = opts.structureRgb || [255, 255, 255];
  mm._hMin = hMin;

  const normal = { x: 0, y: 0, z: 0 };
  const { width, height, x0, y0, sx, sy, base } = mm;
  for (let j = 0; j < height; j++) {
    const wy = y0 + (j + 0.5) * sy;
    const rowBase = j * width;
    for (let i = 0; i < width; i++) {
      const wx = x0 + (i + 0.5) * sx;
      const idx = (rowBase + i) * 3;
      if (structureAt && structureAt(wx, wy)) {
        base[idx] = structureRgb[0]; base[idx + 1] = structureRgb[1]; base[idx + 2] = structureRgb[2];
        continue;
      }
      const h = terrain.heightAt(wx, wy);
      terrain.normalAt(wx, wy, normal);
      const typeId = terrain.typeAt(wx, wy);
      let hn = (h - hMin) / hRange;
      if (hn < 0) hn = 0; else if (hn > 1) hn = 1;
      const nDotLs = normal.x * LS_X + normal.y * LS_Y + normal.z * LS_Z;
      const diffuse = nDotLs > 0 ? nDotLs : 0;
      const shade = (0.35 + 0.65 * diffuse) * (0.8 + 0.2 * hn);
      const tIdx = typeId * 3;
      base[idx] = Math.round(typeRgb[tIdx] * shade);
      base[idx + 1] = Math.round(typeRgb[tIdx + 1] * shade);
      base[idx + 2] = Math.round(typeRgb[tIdx + 2] * shade);
    }
  }
}

/**
 * Fills `mm.visIdx`: for every pixel centre, the `view` cell index
 * (`cy*view.w+cx`) it falls in, or -1 outside `view`'s grid. Resets the fog
 * memo so the next `update()` always rebuilds `fogged`. No allocation.
 * @param {Minimap} mm
 * @param {{x0:number, y0:number, w:number, h:number, cell:number}} view - a Visibility instance (or duck-typed equivalent)
 */
export function bindFog(mm, view) {
  const { width, height, x0, y0, sx, sy, visIdx } = mm;
  const { x0: vx0, y0: vy0, w: vw, h: vh, cell } = view;
  for (let j = 0; j < height; j++) {
    const wy = y0 + (j + 0.5) * sy;
    const cy = Math.floor((wy - vy0) / cell);
    const rowBase = j * width;
    const rowOk = cy >= 0 && cy < vh;
    for (let i = 0; i < width; i++) {
      if (!rowOk) { visIdx[rowBase + i] = -1; continue; }
      const wx = x0 + (i + 0.5) * sx;
      const cx = Math.floor((wx - vx0) / cell);
      visIdx[rowBase + i] = (cx >= 0 && cx < vw) ? (cy * vw + cx) : -1;
    }
  }
  mm._fogVersion = -1;
  mm._fogTeam = -1;
}

/** Rebuilds `mm.fogged` (stride 4, alpha fixed 255) from `mm.base` through
 * the fog LUT for `view.state[team]`, using `mm.visIdx` (no alloc). */
function rebuildFogged(mm, view, team) {
  const { width, height, base, fogged, visIdx, unseenRgb, exploredQ8 } = mm;
  const state = view.state[team];
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const vi = visIdx[i];
    const st = vi >= 0 ? state[vi] : 0;
    const o = i * 4;
    if (st === 255) {
      const b = i * 3;
      fogged[o] = base[b]; fogged[o + 1] = base[b + 1]; fogged[o + 2] = base[b + 2];
    } else if (st === 128) {
      const b = i * 3;
      fogged[o] = (base[b] * exploredQ8) >> 8;
      fogged[o + 1] = (base[b + 1] * exploredQ8) >> 8;
      fogged[o + 2] = (base[b + 2] * exploredQ8) >> 8;
    } else {
      fogged[o] = unseenRgb[0]; fogged[o + 1] = unseenRgb[1]; fogged[o + 2] = unseenRgb[2];
    }
    fogged[o + 3] = 255;
  }
}

/** Fills a clipped, filled square of `half`-radius centred at pixel
 * (cx, cy) with rgb - `half = 0` draws exactly the one pixel. No alloc. */
function drawSquare(rgba, width, height, cx, cy, half, r, g, b) {
  const x0 = cx - half < 0 ? 0 : cx - half;
  const x1 = cx + half >= width ? width - 1 : cx + half;
  const y0 = cy - half < 0 ? 0 : cy - half;
  const y1 = cy + half >= height ? height - 1 : cy + half;
  for (let y = y0; y <= y1; y++) {
    let idx = (y * width + x0) * 4;
    for (let x = x0; x <= x1; x++, idx += 4) {
      rgba[idx] = r; rgba[idx + 1] = g; rgba[idx + 2] = b; rgba[idx + 3] = 255;
    }
  }
}

/** Integer Bresenham line from (x0,y0) to (x1,y1), clipped per-pixel (bounds
 * check, not a full line-clip - fine at minimap resolution). No alloc. */
function drawLineClipped(rgba, width, height, x0, y0, x1, y1, r, g, b) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      rgba[idx] = r; rgba[idx + 1] = g; rgba[idx + 2] = b; rgba[idx + 3] = 255;
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// Screen-corner offsets for the camera footprint (28.1 cell convention:
// `(-0.5, 0)`, `(cols-0.5, 0)`, `(cols-0.5, rows)`, `(-0.5, rows)`).
function footprintCorner(terms, k, out2) {
  if (k === 0) { out2[0] = -0.5; out2[1] = 0; }
  else if (k === 1) { out2[0] = terms.cols - 0.5; out2[1] = 0; }
  else if (k === 2) { out2[0] = terms.cols - 0.5; out2[1] = terms.rows; }
  else { out2[0] = -0.5; out2[1] = terms.rows; }
}

const _cornerColRow = [0, 0];

/**
 * Per-UI-refresh update (28.4 "Update"), zero allocation: (1) rebuilds
 * `fogged` from `base` if `view.version[viewTeam]` (or `viewTeam` itself)
 * changed since the last call; (2) `rgba.set(fogged)`; (3) draws units in
 * index order as clipped filled squares (skips another team's unit unless
 * `hideUnseen` is off or its cell is currently visible to `viewTeam`);
 * (4) draws the camera footprint (4 screen corners -> `screenRay` ->
 * `rayTerrain`, falling back to the `z = terrain min` plane on a miss) as 4
 * clipped Bresenham edges.
 * @param {Minimap} mm
 * @param {{count:number, x:Float64Array, y:Float64Array, team:Uint8Array, half:Uint8Array}} units
 * @param {{state:Uint8Array[], version:Uint32Array, stateAt(t:number,x:number,y:number):number}} view
 * @param {number} viewTeam
 * @param {import('./projection.js').PitchedTerms} terms
 * @param {{groundAt(x:number,y:number):number}} terrain
 */
export function update(mm, units, view, viewTeam, terms, terrain) {
  if (mm._fogVersion !== view.version[viewTeam] || mm._fogTeam !== viewTeam) {
    rebuildFogged(mm, view, viewTeam);
    mm._fogVersion = view.version[viewTeam];
    mm._fogTeam = viewTeam;
  }
  mm.rgba.set(mm.fogged);

  const { width, height, x0, y0, sx, sy, rgba, teamRgb, hideUnseen } = mm;
  for (let k = 0; k < units.count; k++) {
    const team = units.team[k];
    if (hideUnseen && team !== viewTeam) {
      const x = units.x[k], y = units.y[k];
      if (view.stateAt(viewTeam, x, y) !== 255) continue;
    }
    const x = units.x[k], y = units.y[k];
    // floor (not round): pixel-space conversion must match minimapToWorld's
    // convention, where pixel i's centre is u = i + 0.5 (RE-13 fix).
    const px = Math.floor((x - x0) / sx);
    const py = Math.floor((y - y0) / sy);
    const ti = team * 3;
    drawSquare(rgba, width, height, px, py, units.half[k], teamRgb[ti], teamRgb[ti + 1], teamRgb[ti + 2]);
  }

  // Camera footprint: 4 screen corners -> world (rayTerrain, else the flat
  // z = terrain min plane) -> minimap pixels -> 4 clipped edges.
  const { _ray: ray, _hit: hit, _cornerPx: px } = mm;
  for (let k = 0; k < 4; k++) {
    footprintCorner(terms, k, _cornerColRow);
    screenRay(terms, _cornerColRow[0], _cornerColRow[1], ray);
    rayTerrain(terrain, ray, hit);
    let wx, wy;
    if (hit.hit) {
      wx = hit.x; wy = hit.y;
    } else {
      const t = ray.dz < 0 ? (mm._hMin - ray.oz) / ray.dz : FOOTPRINT_FALLBACK_MAX_T;
      wx = ray.ox + t * ray.dx; wy = ray.oy + t * ray.dy;
    }
    // floor (not round): same pixel-centre convention fix as above (RE-13).
    px[k * 2] = Math.floor((wx - x0) / sx);
    px[k * 2 + 1] = Math.floor((wy - y0) / sy);
  }
  // Plain indexed reads (not array destructuring) to avoid iterator-protocol
  // overhead/allocation on this hot per-frame path (RE-13 fix).
  const fr = mm.footprintRgb[0], fg = mm.footprintRgb[1], fb = mm.footprintRgb[2];
  for (let k = 0; k < 4; k++) {
    const kk = (k + 1) & 3;
    drawLineClipped(rgba, width, height, px[k * 2], px[k * 2 + 1], px[kk * 2], px[kk * 2 + 1], fr, fg, fb);
  }
}

/** `x = x0 + u*sx`, `y = y0 + v*sy` (pixel centre of pixel i is u = i+0.5). */
export function minimapToWorld(mm, u, v, out2) {
  out2[0] = mm.x0 + u * mm.sx;
  out2[1] = mm.y0 + v * mm.sy;
  return out2;
}

/** Exact inverse of `minimapToWorld`. */
export function worldToMinimap(mm, x, y, out2) {
  out2[0] = (x - mm.x0) / mm.sx;
  out2[1] = (y - mm.y0) / mm.sy;
  return out2;
}
