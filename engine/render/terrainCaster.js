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
import { KIND_TERRAIN, PLANEID_TERRAIN, FACE_PACKED } from './GBuffer.js';
import { HFOV_DEG } from './sectorCaster.js';
import { packTerrainTextures } from './gpu/TerrainTextures.js';
import { shadeTerrain, makeTerrainShadeCtx, hashFast01 } from './terrainShade.js';
import { packNormalOct, unpackNormalOct } from '../voxel/octNormal.js';

export const FOG_FULL = 1500;
export const T_START = 0.5;
// US-026a (23.4/23.7 S4): 128 -> 320 - "one shared constant, both paths"
// (S5 ports this same value into the GLSL march; never bumped on only one).
export const MAX_TERRAIN_STEPS = 320;
// D-017: the GPU's own march schedule - the JS oracle uses this on every path.
export const STEP_MIN = 3;
export const STEP_K = 0.03;
// US-026a (23.1 decision 6): the dither's own hash salt (`hashFast01(cell2,
// DITHER_SEED)`), distinct from every other terrain hash salt (glyph tier
// hA, glyph pick hB=7, glint, jitter=10, features=20+) so the near/far pick
// never correlates with any of them.
// US-026a S5: exported so `terrain.frag.js`'s GLSL march imports the SAME
// value (never a hand-copied literal - the "do not" list bans 130/170/0.5/
// 0.012 as engine-code literals; this salt is the same class of constant).
export const DITHER_SEED = 9;

const MAX_SKIPS = 8; // MAX_STRUCTS (compositor.js)
const skipT = new Float64Array(MAX_SKIPS * 2);
const camBasisScratch = { dirX: 0, dirY: 0, planeX: 0, planeY: 0, tanHalfHFov: 0, planeDistY: 0, horizonRow: 0 };
// US-026a: `near` records whether the hit resolved against the near band
// (2 m) or the far grid (8 m) - `castTerrain` reads it to pick NEARTYPE vs
// FARTYPE and the c=2/c=8 normal difference (23.4 "Hit sample").
const hitOut = { t: 0, x: 0, y: 0, h: 0, near: false };
// Cast-time normal scratch (castTerrain's own per-hit normal, before it's
// packed into aoD) - kept separate from `shadeNrm` (shadeTerrainCells' own
// decode-time scratch below) so the two call sites never alias.
const castNrmScratch = { x: 0, y: 0, z: 1 };
const shadeOut = { glyph: 32, fg: new Uint8Array(3), bg: new Uint8Array(3) };
// `H(px,py,t)` scratch (23.4 "Height sampling") - reused across every march
// step and bisection iteration, never allocated.
const hSample = { h: 0, near: false };
// `shadeTerrainCells`'s own unpacked-normal scratch (array-like, the shape
// `unpackNormalOct` writes into).
const shadeNrm = new Float64Array(3);

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

// ---- US-026a near band (23.1 decision 6, 23.4) ----------------------------
//
// `nearLOD(terrain)` reads `terrain.recipe.nearLOD` and returns it only when
// it's actually usable (the near band is baked AND the recipe carries both
// `handover` and `step` - never a fallback default: the "do not" list bans
// 130/170/0.5/0.012 as engine-code literals, so an incomplete recipe simply
// never engages near sampling, falling back to the pre-US-026a far-only
// behaviour rather than guessing the numbers).
// US-026a S5: exported so `GpuCellPipeline.js`'s uniform upload gates
// `uNearReady` off the SAME check the JS march uses (never a second,
// drifting re-derivation of "is near sampling active").
export function activeNearLOD(terrain) {
  const nl = terrain.recipe && terrain.recipe.nearLOD;
  if (!terrain.nearReady || !nl || !nl.handover || !nl.step) return null;
  return nl;
}

/**
 * US-026a S5: the combined near+far height-draw bounds (`{minH, maxH}`),
 * gated by the SAME `activeNearLOD` check as the march itself - the single
 * source of truth for both `marchTerrainRay`'s early-outs (below) and the
 * GLSL uniform upload (`GpuCellPipeline.js`'s `_uploadTerrainUniforms`,
 * `uTerrainMaxH`), so the two never compute this differently.
 */
export function terrainHBounds(terrain) {
  const nl = activeNearLOD(terrain);
  if (nl) return { maxH: Math.max(terrain.farMaxH, terrain.near.maxH), minH: Math.min(terrain.farMinH, terrain.near.minH) };
  return { maxH: terrain.farMaxH, minH: terrain.farMinH };
}

/**
 * `useNear(t, px, py)` (23.4): a stable dither, keyed on the 2 m WORLD cell
 * (never the screen cell - "do not" list item 10) - `< h0` always near,
 * `>= h1` always far, in between a per-cell coin flip whose bias ramps
 * linearly with `t` (so the fraction of near-sampled cells falls off
 * monotonically as `t` crosses the handover band, never a hard seam).
 */
export function useNear(nl, t, px, py) {
  const h0 = nl.handover[0], h1 = nl.handover[1];
  if (t >= h1) return false;
  if (t < h0) return true;
  const cx = Math.floor(px / 2), cy = Math.floor(py / 2);
  return hashFast01(cx, cy, DITHER_SEED) > (t - h0) / (h1 - h0);
}

/**
 * `H(px, py, t)` (23.4): bilinear on the near band when `useNear`, else the
 * far grid - "NEARH 'outside' (half-cell rim) -> FARH for that sample" (the
 * near band's own `gridHeight` already returns null past its rim, so a near
 * pick just falls through to the far sample below). Writes `{h, near}` into
 * `out` (no allocation - every march step and bisection iteration calls
 * this, `hSample` is the one shared scratch instance).
 */
function sampleH(terrain, nl, t, px, py, out) {
  if (nl && useNear(nl, t, px, py)) {
    const h = terrain.util.gridHeight(terrain.near, px, py);
    if (h !== null) { out.h = h; out.near = true; return out; }
  }
  out.h = terrain.util.gridHeight(terrain._farGridDraw, px, py);
  out.near = false;
  return out;
}

/**
 * The march (docs/architecture.md 14.4 item 4, extended by 23.4's near
 * sampling/schedule), literal JS twin of the GLSL pass. `terrain.farReady`
 * must be true. Returns true and fills `out` ({t, x, y, h, near}) on a hit -
 * `out.near` says whether the hit resolved against the near band or the far
 * grid (`castTerrain` uses it to pick NEARTYPE/FARTYPE and the c=2/c=8
 * normal). Reads `terrain.near`/`terrain.recipe.nearLOD` through the
 * `terrain` argument itself - no new parameter (23.4 "JS oracle" note).
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {number} ex world eye x, {number} ey world eye y, {number} eyeH eye height
 * @param {number} dx unit-ish ray direction x, {number} dy ray direction y (NOT normalised - same convention as the sector caster)
 * @param {number} slope d(height)/d(t) of the ray
 * @param {number} tMax
 * @param {Float64Array} skips - 2 floats [tIn, tOut] per skip interval
 * @param {number} nSkips
 * @param {{stepMin?:number, stepK?:number, maxSteps?:number, tStart?:number}} opts
 * @param {{t:number,x:number,y:number,h:number,near:boolean}} out
 */
export function marchTerrainRay(terrain, ex, ey, eyeH, dx, dy, slope, tMax, skips, nSkips, opts, out) {
  const stepMin = opts.stepMin != null ? opts.stepMin : STEP_MIN;
  const stepK = opts.stepK != null ? opts.stepK : STEP_K;
  const maxSteps = opts.maxSteps != null ? opts.maxSteps : MAX_TERRAIN_STEPS;
  const nl = activeNearLOD(terrain);
  const nearH1 = nl ? nl.handover[1] : -Infinity;
  const nearStepMin = nl ? nl.step.min : stepMin;
  const nearStepK = nl ? nl.step.k : stepK;

  // 23.4 "new early-out" bounds: combine the far grid's extremes with the
  // near band's (when active) - a hill inside the band can be taller/deeper
  // than anything on the coarse far grid.
  const hb = terrainHBounds(terrain);
  const maxHDraw = hb.maxH, minHDraw = hb.minH;

  if (!(slope < 0) && eyeH >= maxHDraw) return false; // climbing above every hill, from the start

  let t0 = opts.tStart != null ? opts.tStart : T_START;
  for (let step = 0; step < maxSteps; step++) {
    // 23.4 march schedule: the near step size applies while `t0` hasn't yet
    // cleared the handover's upper bound, regardless of which grid the NEXT
    // sample actually resolves to (the schedule is keyed on `t0`, `useNear`
    // is keyed on `t` - two independent per-step decisions).
    const dt = t0 < nearH1 ? Math.max(nearStepMin, nearStepK * t0) : Math.max(stepMin, stepK * t0);
    let t1 = t0 + dt, last = false;
    if (t1 >= tMax) { t1 = tMax; last = true; }

    const hAtT1 = eyeH + slope * t1;
    if (slope > 0 && hAtT1 > maxHDraw) return false; // climbing above every hill

    const px = ex + dx * t1, py = ey + dy * t1;
    sampleH(terrain, nl, t1, px, py, hSample);
    const H = hSample.h;
    if (H === null) return false; // outside the far map: haze, the sky pass paints it

    let inSkip = false;
    for (let k = 0; k < nSkips; k++) {
      if (t1 >= skips[k * 2] && t1 <= skips[k * 2 + 1]) { inSkip = true; break; }
    }
    if (!inSkip && hAtT1 < H) {
      // 5 bisection steps on f(t) = h(t) - H(p(t)) in [t0, t1]. At the near
      // step schedule's floor (0.5 m) this converges to 0.5/32 ~= 16 mm.
      let a = t0, b = t1;
      for (let bi = 0; bi < 5; bi++) {
        const tm = (a + b) * 0.5;
        const hm = eyeH + slope * tm;
        sampleH(terrain, nl, tm, ex + dx * tm, ey + dy * tm, hSample);
        const Hm2 = hSample.h === null ? H : hSample.h;
        if (hm < Hm2) b = tm; else a = tm;
      }
      const tHit = (a + b) * 0.5;
      out.t = tHit; out.x = ex + dx * tHit; out.y = ey + dy * tHit; out.h = eyeH + slope * tHit;
      sampleH(terrain, nl, tHit, out.x, out.y, hSample);
      out.near = hSample.near;
      return true;
    }
    // 23.4 "new early-out": no hit at t1 (this step's own H test just
    // passed), and the ray's own height has already dropped below the
    // lowest point ANY surface reaches - a steep descending ray only gets
    // lower from here, so it can never hit going forward either (this is a
    // strict SUPERSET check: whenever it would fire at the SAME t1 as a real
    // hit, `hAtT1 < H` above already caught it and returned first).
    if (slope < 0 && hAtT1 < minHDraw) return false;
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

/**
 * Surface normal (23.4 "Hit sample"): a `c`=2 m central difference of the
 * near band when `isNear`, else `c`=8 m of `farHDraw` (item 4) - falls back
 * to the smooth analytic surface (`groundAt`/`heightAt`) at a sample past
 * either grid's edge, same "no seam" rule `groundNormalAt` already uses.
 */
function terrainNormal(terrain, x, y, isNear, out) {
  const c = isNear ? 2 : 8;
  const grid = isNear ? terrain.near : terrain._farGridDraw;
  const gridHeight = terrain.util.gridHeight;
  let hL = gridHeight(grid, x - c, y); if (hL === null) hL = isNear ? terrain.groundAt(x - c, y) : terrain.heightAt(x - c, y);
  let hR = gridHeight(grid, x + c, y); if (hR === null) hR = isNear ? terrain.groundAt(x + c, y) : terrain.heightAt(x + c, y);
  let hD = gridHeight(grid, x, y - c); if (hD === null) hD = isNear ? terrain.groundAt(x, y - c) : terrain.heightAt(x, y - c);
  let hU = gridHeight(grid, x, y + c); if (hU === null) hU = isNear ? terrain.groundAt(x, y + c) : terrain.heightAt(x, y + c);
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

// US-026a (23.4, mirrors voxelMarch.js's own `getAoAlias`/lighting.js's
// `aoU32`): the packed-normal bits for a KIND_TERRAIN+FACE_PACKED cell live
// in `gbuf.aoD`'s bit pattern, written/read through a Uint32Array alias of
// the SAME buffer - cached per GBuffer identity (not per frame/call).
const _terrainAoAliasCache = new WeakMap();
function terrainAoAlias(gbuf) {
  let alias = _terrainAoAliasCache.get(gbuf);
  if (!alias || alias.buffer !== gbuf.aoD.buffer) {
    alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
    _terrainAoAliasCache.set(gbuf, alias);
  }
  return alias;
}

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
      // US-026a 23.4 "Hit sample": NEARTYPE (nearest) when the hit resolved
      // against the near band, else FARTYPE - and `face = FACE_PACKED` with
      // an octahedral-packed normal (c=2 near / c=8 far), so `lightSurfaces`
      // lights terrain through the SAME generic FACE_PACKED decode every
      // voxel-model part already uses (no kind-7-specific branch there).
      let type = hitOut.near ? terrain._nearGridType(hitOut.x, hitOut.y) : null;
      if (type === null) type = farTypeNearest(terrain, hitOut.x, hitOut.y);
      if (fb.gbuf) {
        const idx = row * cols + x;
        terrainNormal(terrain, hitOut.x, hitOut.y, hitOut.near, castNrmScratch);
        const bits = packNormalOct(castNrmScratch.x, castNrmScratch.y, castNrmScratch.z);
        fb.gbuf.writeSample(idx, KIND_TERRAIN, type, FACE_PACKED, PLANEID_TERRAIN, hitOut.x, hitOut.y, hitOut.h, 0);
        terrainAoAlias(fb.gbuf)[idx] = bits;
      }
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
 * US-026a 23.4 "Lighting"/"Shade pass" rework: `N` is now decoded from the
 * packed normal `castTerrain` wrote (`aoD`, via `FACE_PACKED`) instead of
 * being re-derived by a central difference here - exact for a near hit (the
 * old code always used the c=8 far difference, even inside the near band).
 * `b = ambientI + sunI*max(0,N.sunDir)` stays analytic/shadow-free (D-007:
 * no terrain shadow rays); `Lc` is `fb.light`'s already-computed per-cell
 * point-light contribution (`lightSurfaces` runs before this in
 * `compositor.js` and now skips the sun term for kind 7 - lighting.js -
 * so `Lc` never double-counts the sun `b` already adds). `bT = b +
 * max(Lc.r,Lc.g,Lc.b)` picks the tier/gain; the lamp then tints `fg`
 * directly (`+= Lc*0.5`, clamped) - a lit patch of grass reads warmer, not
 * just brighter.
 * @param {{rt, gbuf, palette, light}} fb
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
  const light = fb.light;
  const alias = terrainAoAlias(gbuf);
  for (let i = 0; i < n; i++) {
    if (gbuf.kind[i] !== KIND_TERRAIN) continue;
    const u = gbuf.u[i], v = gbuf.v[i], t = fb.depth.depth[i];
    unpackNormalOct(alias[i], shadeNrm);
    const ndotl = shadeNrm[0] * sun.dirX + shadeNrm[1] * sun.dirY + shadeNrm[2] * sun.dirZ;
    const b = sun.ambientI + sun.sunI * Math.max(0, ndotl);
    let lr = 0, lg = 0, lb = 0;
    if (light && !light.uniform) {
      const o = i * 3; lr = light.rgb[o]; lg = light.rgb[o + 1]; lb = light.rgb[o + 2];
    } else if (light && light.uniform) {
      lr = light.rgb[0]; lg = light.rgb[1]; lb = light.rgb[2];
    }
    const bT = b + Math.max(lr, Math.max(lg, lb));
    shadeTerrain(t, gbuf.mat[i], bT, u, v, timeSec, ctx, shadeOut);
    shadeOut.fg[0] = clampByte(shadeOut.fg[0] + lr * 0.5 * 255);
    shadeOut.fg[1] = clampByte(shadeOut.fg[1] + lg * 0.5 * 255);
    shadeOut.fg[2] = clampByte(shadeOut.fg[2] + lb * 0.5 * 255);
    const x = i % gbuf.cols, y = (i / gbuf.cols) | 0;
    cells.setCellRGB(x, y, shadeOut.glyph, shadeOut.fg[0], shadeOut.fg[1], shadeOut.fg[2], shadeOut.bg[0], shadeOut.bg[1], shadeOut.bg[2]);
  }
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.floor(v + 0.5);
}
