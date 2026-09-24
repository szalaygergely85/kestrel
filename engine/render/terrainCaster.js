// US-016 (docs/architecture.md 14.4): far-LOD terrain - the JS oracle/CPU
// path (`castTerrain`, `marchTerrainRay`) plus the deferred terrain shading
// pass (`shadeTerrainCells`, called from `compositor.js` right after
// `shadeSurfaces`, since a kind-7 cell needs a completely different look-up
// (TLOOK, not MaterialTable) than every other kind).
//
// D-017: this is the oracle only - it always uses the SAME step schedule the
// GPU march uses (`stepMin 3, stepK 0.03, maxSteps 128`), no coarser "CPU
// fallback" option and no perf budget of its own (`?gpucompare=1` is the
// only thing that runs it).
//
// No per-frame allocation (architecture.md 9): every scratch array below is
// module-level and reused; `castTerrain`'s only per-call allocation is the
// `hitOut`/`nrmOut` objects, which are themselves module-level singletons.
import { KIND_TERRAIN, PLANEID_TERRAIN } from './GBuffer.js';
import { HFOV_DEG } from './sectorCaster.js';
import { packTerrainTextures } from './gpu/TerrainTextures.js';
import { shadeTerrainFar, makeTerrainShadeCtx } from './terrainShade.js';

export const FOG_FULL = 1500;
export const T_START = 0.5;
export const MAX_TERRAIN_STEPS = 128;
// D-017: the GPU's own march schedule - the JS oracle uses this on every path.
export const STEP_MIN = 3;
export const STEP_K = 0.03;

const MAX_SKIPS = 8; // MAX_STRUCTS (compositor.js)
const skipT = new Float64Array(MAX_SKIPS * 2);
const camBasisScratch = { dirX: 0, dirY: 0, planeX: 0, planeY: 0, tanHalfHFov: 0, planeDistY: 0, horizonRow: 0 };
const hitOut = { t: 0, x: 0, y: 0, h: 0 };
const nrmOut = { x: 0, y: 0, z: 1 };
const shadeOut = { glyph: 32, fg: new Uint8Array(3), bg: new Uint8Array(3) };

function computeCamBasis(cam, rt, out) {
  const cols = rt.cols, rows = rt.rows;
  const tanHalfHFov = Math.tan(HFOV_DEG * Math.PI / 360);
  const yawRad = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalfHFov, planeY = dirX * tanHalfHFov;
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const horizonRow = rows / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY;
  out.dirX = dirX; out.dirY = dirY; out.planeX = planeX; out.planeY = planeY;
  out.tanHalfHFov = tanHalfHFov; out.planeDistY = planeDistY; out.horizonRow = horizonRow;
  return out;
}

/** 2D slab test of ray (ex,ey)+(dx,dy)*t against [x0,x1)x[y0,y1) - writes [tIn,tOut] into `out` (2 floats at `outOff`). */
function slab2D(ex, ey, dx, dy, x0, y0, x1, y1, out, outOff) {
  let tMin = -Infinity, tMax = Infinity;
  if (dx !== 0) {
    const t1 = (x0 - ex) / dx, t2 = (x1 - ex) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
  } else if (ex < x0 || ex > x1) return false;
  if (dy !== 0) {
    const t1 = (y0 - ey) / dy, t2 = (y1 - ey) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
  } else if (ey < y0 || ey > y1) return false;
  if (tMax < tMin || tMax < 0) return false;
  out[outOff] = Math.max(0, tMin); out[outOff + 1] = tMax;
  return true;
}

/**
 * Builds this column's skip intervals (2D slab per placed structure - item 4:
 * "cells in a structure bbox belong to the structure"), writing into `skips`
 * (>= 2*MAX_SKIPS floats). Returns the count written.
 */
function buildSkips(structures, ex, ey, dx, dy, skips) {
  let n = 0;
  for (let i = 0; i < structures.length && n < MAX_SKIPS; i++) {
    const b = structures[i].bbox;
    if (slab2D(ex, ey, dx, dy, b.x0, b.y0, b.x1, b.y1, skips, n * 2)) n++;
  }
  return n;
}

/**
 * The march (docs/architecture.md 14.4 item 4), literal JS twin of the GLSL
 * pass. `terrain.farReady` must be true. Returns true and fills `out`
 * ({t, x, y, h}) on a hit.
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {number} ex world eye x, {number} ey world eye y, {number} eyeH eye height
 * @param {number} dx unit-ish ray direction x, {number} dy ray direction y (NOT normalised - same convention as the sector caster)
 * @param {number} slope d(height)/d(t) of the ray
 * @param {number} tMax
 * @param {Float64Array} skips - 2 floats [tIn, tOut] per skip interval
 * @param {number} nSkips
 * @param {{stepMin?:number, stepK?:number, maxSteps?:number, tStart?:number}} opts
 * @param {{t:number,x:number,y:number,h:number}} out
 */
export function marchTerrainRay(terrain, ex, ey, eyeH, dx, dy, slope, tMax, skips, nSkips, opts, out) {
  const stepMin = opts.stepMin != null ? opts.stepMin : STEP_MIN;
  const stepK = opts.stepK != null ? opts.stepK : STEP_K;
  const maxSteps = opts.maxSteps != null ? opts.maxSteps : MAX_TERRAIN_STEPS;
  const grid = terrain._farGridDraw;
  const gridHeight = terrain.util.gridHeight;

  if (!(slope < 0) && eyeH >= terrain.farMaxH) return false; // climbing above every hill, from the start

  let t0 = opts.tStart != null ? opts.tStart : T_START;
  for (let step = 0; step < maxSteps; step++) {
    const dt = Math.max(stepMin, stepK * t0);
    let t1 = t0 + dt, last = false;
    if (t1 >= tMax) { t1 = tMax; last = true; }

    const hAtT1 = eyeH + slope * t1;
    if (slope > 0 && hAtT1 > terrain.farMaxH) return false; // climbing above every hill

    const px = ex + dx * t1, py = ey + dy * t1;
    const H = gridHeight(grid, px, py);
    if (H === null) return false; // outside the far map: haze, the sky pass paints it

    let inSkip = false;
    for (let k = 0; k < nSkips; k++) {
      if (t1 >= skips[k * 2] && t1 <= skips[k * 2 + 1]) { inSkip = true; break; }
    }
    if (!inSkip && hAtT1 < H) {
      // 5 bisection steps on f(t) = h(t) - H(p(t)) in [t0, t1].
      let a = t0, b = t1;
      for (let bi = 0; bi < 5; bi++) {
        const tm = (a + b) * 0.5;
        const hm = eyeH + slope * tm;
        const Hm = gridHeight(grid, ex + dx * tm, ey + dy * tm);
        const Hm2 = Hm === null ? H : Hm;
        if (hm < Hm2) b = tm; else a = tm;
      }
      const tHit = (a + b) * 0.5;
      out.t = tHit; out.x = ex + dx * tHit; out.y = ey + dy * tHit; out.h = eyeH + slope * tHit;
      return true;
    }
    if (last) return false;
    t0 = t1;
  }
  return false;
}

function farTypeNearest(terrain, x, y) {
  const ix = Math.floor(x / terrain.mapCell), iy = Math.floor(y / terrain.mapCell);
  if (ix < 0 || iy < 0 || ix >= terrain.mapW || iy >= terrain.mapH) return 0;
  return terrain.farType[iy * terrain.mapW + ix];
}

/** Surface normal via a `c`=8 m central difference of `farHDraw` (item 4). */
function terrainNormal(terrain, x, y, out) {
  const c = 8;
  const grid = terrain._farGridDraw, gridHeight = terrain.util.gridHeight;
  const hL = gridHeight(grid, x - c, y) ?? terrain.heightAt(x - c, y);
  const hR = gridHeight(grid, x + c, y) ?? terrain.heightAt(x + c, y);
  const hD = gridHeight(grid, x, y - c) ?? terrain.heightAt(x, y - c);
  const hU = gridHeight(grid, x, y + c) ?? terrain.heightAt(x, y + c);
  const dhdx = (hR - hL) / (2 * c), dhdy = (hU - hD) / (2 * c);
  const len = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
  out.x = -dhdx / len; out.y = -dhdy / len; out.z = 1 / len;
  return out;
}

/**
 * `world.structures[0].level.def.sun` (D-007) until US-007 owns this
 * uniform (compositor.js's own doc comment for `castTerrain`). Exported
 * (14.4 build-order step 1: "move sunFromWorld into one exported helper so
 * both paths use the same sun") so the GPU pipeline's own uniform upload
 * (step 2+) computes the identical sun direction the JS oracle uses - no
 * second copy of the azimuth/elevation -> dir math.
 */
// Module-level scratch: `castTerrain`'s own per-frame call (below) passes no
// `out`, so it needs a default target that isn't a fresh object literal -
// architecture.md section 9 (no per-frame allocation). `GpuCellPipeline.js`
// passes its own instance-scratch object instead (ARCH CHANGES item 5).
const _sunScratch = { dirX: 0, dirY: 0, dirZ: 0, ambientI: 0, sunI: 0 };

export function sunFromWorld(world, palette, out = _sunScratch) {
  const T = palette.timeOfDay[palette.defaultTime];
  let az = 112.5, elev = T.sunElev;
  const s0 = world.structures[0];
  if (s0 && s0.level && s0.level.def && s0.level.def.sun && s0.level.def.sun.azimuth != null) {
    az = s0.level.def.sun.azimuth; elev = s0.level.def.sun.elevation;
  }
  const azRad = az * Math.PI / 180, elRad = elev * Math.PI / 180, cosEl = Math.cos(elRad);
  out.dirX = Math.sin(azRad) * cosEl; out.dirY = -Math.cos(azRad) * cosEl; out.dirZ = Math.sin(elRad);
  out.ambientI = T.ambientI; out.sunI = T.sunI;
  return out;
}

/**
 * JS oracle / CPU fallback (D-017): for every cell of every open span left
 * by the sector pass, marches the same ray `castColumn` would (n=1, the
 * exact cell centre), writes `fb.gbuf` (kind=KIND_TERRAIN, mat=terrain TYPE
 * id, NOT a MaterialTable id - `shadeTerrainCells` is kind 7's only
 * consumer) and `fb.depth`. Never draws inside a structure's own footprint
 * (skip intervals). No-op until `terrain.farReady`.
 *
 * Deviation flagged for architect review: assumes per-column hit/miss is
 * monotonic by row (bounded heightfield, single "escape above every hill"
 * transition) to know how far to `narrowBottom` the open span - every row is
 * still marched independently (no early break), so a genuine non-monotonic
 * gap (a miss row sandwiched between two hits, not expected on
 * `overworld_far`'s rolling-hill recipe) would leave that one cell
 * unresolved rather than mis-shaded.
 * @param {{rt, depth, spans, gbuf, palette}} fb
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 * @param {import('../world/World.js').World} [world] - for structure skip bboxes + the interim sun (see `sunFromWorld`)
 * @param {{timeSec?:number}} [opts]
 */
export function castTerrain(fb, terrain, cam, world, opts = {}) {
  if (!terrain || !terrain.farReady) return; // no terrain, or not baked yet - leave every span open for fillSky
  const spans = fb.spans;
  if (!spans) return;
  const rt = fb.rt;
  const cb = computeCamBasis(cam, rt, camBasisScratch);
  const structures = (world && world.structures) || [];
  const marchOpts = { stepMin: STEP_MIN, stepK: STEP_K, maxSteps: MAX_TERRAIN_STEPS };
  const cols = rt.cols;

  const rows = rt.rows, depthArr = fb.depth.depth;
  for (let x = 0; x < cols; x++) {
    const cameraX = (2 * (x + 0.5)) / cols - 1;
    const rayDirX = cb.dirX + cb.planeX * cameraX;
    const rayDirY = cb.dirY + cb.planeY * cameraX;
    const nSkips = buildSkips(structures, cam.x, cam.y, rayDirX, rayDirY, skipT);
    // Item 1: "tMax = min(sectorDepth, FOG_FULL)" - sectorDepth is the
    // PER-CELL resolved sector depth (the GPU's SDEPTH), which is +Infinity
    // for every cell still inside the open span by construction (a row only
    // stays in [top, bottom] while nothing has written `fb.depth` there yet -
    // OpenSpans' own invariant). `spans.depth[x]` is a DIFFERENT, per-column
    // value (how far the sector DDA stepped before giving up / leaving the
    // structure's grid) - not a depth bound for the terrain ray at all; using
    // it here was a bug (it capped the march at the structure's own exit
    // distance, so terrain past e.g. a breach opening never got marched).
    const tMax = FOG_FULL;

    // Architect fix (US-016 ASK, 2026-09-24): march EVERY cell the sector
    // pass left without a finite depth (kind 0, incl. rows it already
    // painted as sky and closed off the span), exactly like pass A2's
    // `kindA != 0 -> return` - the open span alone misses sky-filled rows
    // below the horizon behind a low far ceiling (summit-east pose). And the
    // DDA's own row convention: sample at `row` (cy + oy, oy = 0 at n = 1),
    // not `row + 0.5` (that half-row offset was a 1-5 % depth error).
    const open = spans.isOpen(x), top = spans.top[x], bottom = spans.bottom[x];
    let minHitRow = bottom + 1; // "no hits yet" inside the open span
    for (let row = 0; row < rows; row++) {
      if (depthArr[row * cols + x] !== Infinity) continue; // a structure claimed this cell
      const slope = (cb.horizonRow - row) / cb.planeDistY;
      if (!marchTerrainRay(terrain, cam.x, cam.y, cam.z, rayDirX, rayDirY, slope, tMax, skipT, nSkips, marchOpts, hitOut)) continue;
      const type = farTypeNearest(terrain, hitOut.x, hitOut.y);
      if (fb.gbuf) fb.gbuf.writeSample(row * cols + x, KIND_TERRAIN, type, 0, PLANEID_TERRAIN, hitOut.x, hitOut.y, hitOut.h, 0);
      fb.depth.set(x, row, hitOut.t);
      if (open && row >= top && row < minHitRow) minHitRow = row;
    }
    if (open && minHitRow <= bottom) spans.narrowBottom(x, minHitRow - 1);
  }
}

/** Lazily (re)builds and caches `terrain`'s shading context, keyed by `farVersion`. */
function ensureShadeCtx(terrain, palette) {
  if (terrain._shadeCtx && terrain._shadeCtxVersion === terrain.farVersion) return terrain._shadeCtx;
  const packed = packTerrainTextures(terrain, palette);
  terrain._shadeCtx = makeTerrainShadeCtx(terrain.recipe, packed, palette);
  terrain._shadeCtxVersion = terrain.farVersion;
  return terrain._shadeCtx;
}

/**
 * Shades every `KIND_TERRAIN` cell `castTerrain` wrote this frame - a
 * separate pass from `shadeSurfaces` (`detailShade.js`) because terrain
 * looks up colour/glyph through `TLOOK` (recipe-driven), never through a
 * `MaterialTable`. Call right after `shadeSurfaces`, before `edgePass` (same
 * ordering requirement: the edge pass reads the just-shaded `rt.cells`).
 * No-op when the world has no terrain or nothing was cast this frame.
 * @param {{rt, gbuf, palette}} fb
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {import('../world/World.js').World} world
 * @param {number} [timeSec]
 */
export function shadeTerrainCells(fb, terrain, world, timeSec = 0) {
  if (!terrain || !terrain.farReady || !fb.gbuf) return;
  const gbuf = fb.gbuf, palette = fb.palette;
  const ctx = ensureShadeCtx(terrain, palette);
  const sun = sunFromWorld(world, palette);
  const cells = fb.rt.cells || fb.rt;
  const n = gbuf.cols * gbuf.rows;
  for (let i = 0; i < n; i++) {
    if (gbuf.kind[i] !== KIND_TERRAIN) continue;
    const u = gbuf.u[i], v = gbuf.v[i], t = fb.depth.depth[i];
    terrainNormal(terrain, u, v, nrmOut);
    const ndotl = nrmOut.x * sun.dirX + nrmOut.y * sun.dirY + nrmOut.z * sun.dirZ;
    const b = sun.ambientI + sun.sunI * Math.max(0, ndotl);
    shadeTerrainFar(t, gbuf.mat[i], b, u, v, timeSec, ctx, shadeOut);
    const x = i % gbuf.cols, y = (i / gbuf.cols) | 0;
    cells.setCellRGB(x, y, shadeOut.glyph, shadeOut.fg[0], shadeOut.fg[1], shadeOut.fg[2], shadeOut.bg[0], shadeOut.bg[1], shadeOut.bg[2]);
  }
}
