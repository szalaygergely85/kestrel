// @ts-check
// engine/render/water.js - US-055a2a (docs/architecture.md 35.3): the water layer's per-frame CPU side, mesh renderer only.
//
// - `selectWater(world, cam, planes, sel)`: which regions draw this frame (<= 8 regions -> slots 0..7; slots 8..11 are
//   waterfall sheets, US-142a1), their uniforms (everything folded into f64 relative to the origin `O`),
//   and which clipmap ring ranges each region needs. Zero allocation.
// - `renderWaterJS(fb, world, cam, M, planes)`: the JS twin of `GpuCellPipeline._passWater` - rasterises the SAME clipmap
//   (DRAW_WATER items) into a cell-resolution `RasterTarget` (fb.water) that `waterComposite` (US-055a2b) reads.
//
// Do not (35.12): write water into the main G-buffer / draw list / picking / physics / shadow list, displace vertices
// on the CPU, or move the clipmap unsnapped. This file only chooses regions and fills uniforms.
import { classifyAABB, CULL_OUT } from '../mesh/culling.js';
import { WATER_MAX } from '../world/water.js';
import { DrawList, DRAW_WATER } from '../mesh/DrawList.js';
import { createRasterTarget, clearRasterTarget, rasterDrawList } from '../mesh/rasterJS.js';
import {
  WATER_RING_COUNT, WATER_RING_HALF, WATER_SNAP, WATER_U_STRIDE, U_KIND, U_Z, U_AABB, U_SHAPE, U_SLOT, U_UNDER, U_REGION,
  getClipmap, waterVertexJS, waterInsideJS,
} from '../mesh/waterMesh.js';

export { waterVertexJS, waterInsideJS, getClipmap, WATER_U_STRIDE };

/** Slots 0..7 = regions, 8..11 = waterfall sheets (35.3). */
export const WATER_SLOTS = 12;
export const WATER_REGION_SLOTS = 8;
/** Region AABB growth (m) so a clamped vertex never trims the region proper (35.3 vertex step 1). */
export const WATER_AABB_GROW = 0.5;
/** Vertical slack (m) of a region's culling box (waves later add up to ~0.5 m). */
const CULL_Z_PAD = 1;

/** Max (start, count) index runs per draw: rings 0..3 + skirt merge into <= 3 runs. */
const RUNS_STRIDE = 7;

/**
 * @typedef {Object} WaterSelection
 * @property {number} sheetCount - selected sheets in slots 8..11
 * @property {any[]} sheets - per-slot static sheet or null
 * @property {number} count - regions selected (slots 0..count-1; sheetCount is separate)
 * @property {Float64Array} O - [ox, oy]: the eye xy snapped to WATER_SNAP (shared by every slot)
 * @property {Int32Array} region - slot -> index into `world.water`
 * @property {Float64Array} u - WATER_SLOTS * WATER_U_STRIDE per-slot block (f64, local to O; see waterMesh.js U_*)
 * @property {Int32Array} runs - per slot [nRuns, first0, count0, first1, count1, first2, count2] (clipmap index ranges)
 * @property {Float64Array} dist - scratch (candidate distances)
 * @property {Int32Array} cand - scratch (candidate region indices)
 */

/** @returns {WaterSelection} */
export function createWaterSelection() {
  return {
    count: 0, sheetCount: 0, sheets: new Array(WATER_SLOTS).fill(null), O: new Float64Array(2), region: new Int32Array(WATER_SLOTS),
    u: new Float64Array(WATER_SLOTS * WATER_U_STRIDE), runs: new Int32Array(WATER_SLOTS * RUNS_STRIDE),
    dist: new Float64Array(WATER_MAX), cand: new Int32Array(WATER_MAX),
  };
}

function regionContains(wt, i, x, y) {
  if (x < wt.x0[i] || y < wt.y0[i]) return false;
  if (wt.kind[i] === 1) {
    if (x > wt.x1[i] || y > wt.y1[i]) return false;
    const dx = x - wt.cx[i], dy = y - wt.cy[i];
    return dx * dx + dy * dy <= wt.r2[i];
  }
  return x < wt.x1[i] && y < wt.y1[i];
}

/**
 * Fills `sel` for this frame: <= 8 regions inside the frustum, the region holding the eye first, then nearest AABB first.
 * `planes` = `frustumPlanes(viewProj)` (24 floats). Pure and allocation-free after `createWaterSelection`.
 * @param {{water: any, waterfalls?: any[]}} world
 * @param {{x:number,y:number,z:number}} cam
 * @param {Float64Array} planes
 * @param {WaterSelection} sel
 * @returns {WaterSelection}
 */
export function selectWater(world, cam, planes, sel) {
  const wt = world && world.water;
  sel.count = 0; sel.sheetCount = 0;
  sel.sheets.fill(null);
  const ex = cam.x, ey = cam.y;
  const ox = Math.floor(ex / WATER_SNAP + 0.5) * WATER_SNAP, oy = Math.floor(ey / WATER_SNAP + 0.5) * WATER_SNAP;
  sel.O[0] = ox; sel.O[1] = oy;

  // candidates: in frustum; key = 0 for the region holding the eye (nearest AABB otherwise)
  let n = 0;
  for (let i = 0; i < (wt ? wt.count : 0); i++) {
    const z = wt.z[i];
    if (classifyAABB(planes, wt.x0[i], wt.y0[i], z - CULL_Z_PAD, wt.x1[i], wt.y1[i], z + CULL_Z_PAD, 0) === CULL_OUT) continue;
    let dx = wt.x0[i] - ex; if (dx < 0) dx = ex - wt.x1[i]; if (dx < 0) dx = 0; // distance from the eye to the AABB
    let dy = wt.y0[i] - ey; if (dy < 0) dy = ey - wt.y1[i]; if (dy < 0) dy = 0;
    sel.cand[n] = i;
    sel.dist[n] = regionContains(wt, i, ex, ey) ? -1 : Math.sqrt(dx * dx + dy * dy);
    n++;
  }
  const take = Math.min(n, WATER_REGION_SLOTS);
  for (let s = 0; s < take; s++) { // partial selection sort (n <= 32): nearest first, ties -> lower region index
    let b = s;
    for (let k = s + 1; k < n; k++) if (sel.dist[k] < sel.dist[b] || (sel.dist[k] === sel.dist[b] && sel.cand[k] < sel.cand[b])) b = k;
    if (b !== s) {
      const d = sel.dist[s]; sel.dist[s] = sel.dist[b]; sel.dist[b] = d;
      const c = sel.cand[s]; sel.cand[s] = sel.cand[b]; sel.cand[b] = c;
    }
    fillSlot(wt, sel, s, sel.cand[s], cam, ox, oy);
  }
  sel.count = take;
  const falls = world && world.waterfalls;
  n = 0;
  for (let i = 0; falls && i < falls.length; i++) {
    const m = falls[i].mesh;
    if (classifyAABB(planes, m.x0, m.y0, m.z0, m.x1, m.y1, m.z1, 0) === CULL_OUT) continue;
    const lip = falls[i].lip;
    const dx = (lip[0] + lip[2]) * 0.5 - ex, dy = (lip[1] + lip[3]) * 0.5 - ey, dz = falls[i].z - cam.z;
    sel.cand[n] = i; sel.dist[n++] = dx * dx + dy * dy + dz * dz;
  }
  sel.sheetCount = Math.min(n, 4);
  for (let k = 0; k < sel.sheetCount; k++) {
    let best = k;
    for (let j = k + 1; j < n; j++) if (sel.dist[j] < sel.dist[best] || (sel.dist[j] === sel.dist[best] && sel.cand[j] < sel.cand[best])) best = j;
    const d = sel.dist[k]; sel.dist[k] = sel.dist[best]; sel.dist[best] = d;
    const i = sel.cand[k]; sel.cand[k] = sel.cand[best]; sel.cand[best] = i;
    const slot = 8 + k, b = slot * WATER_U_STRIDE, fall = falls[sel.cand[k]];
    sel.sheets[slot] = fall;
    sel.u[b + U_KIND] = 2; sel.u[b + U_SLOT] = slot;
    sel.u[b + U_SHAPE] = fall.lip[0] - ox; sel.u[b + U_SHAPE + 1] = fall.lip[1] - oy;
  }
  return sel;
}

/** Slot uniforms + ring runs for region `i` (everything local to O, f64). */
function fillSlot(wt, sel, slot, i, cam, ox, oy) {
  const u = sel.u, b = slot * WATER_U_STRIDE;
  sel.region[slot] = i;
  u[b + U_KIND] = wt.kind[i];
  u[b + U_Z] = wt.z[i];
  const ax0 = wt.x0[i] - WATER_AABB_GROW - ox, ay0 = wt.y0[i] - WATER_AABB_GROW - oy;
  const ax1 = wt.x1[i] + WATER_AABB_GROW - ox, ay1 = wt.y1[i] + WATER_AABB_GROW - oy;
  u[b + U_AABB] = ax0; u[b + U_AABB + 1] = ay0; u[b + U_AABB + 2] = ax1; u[b + U_AABB + 3] = ay1;
  if (wt.kind[i] === 1) {
    u[b + U_SHAPE] = wt.cx[i] - ox; u[b + U_SHAPE + 1] = wt.cy[i] - oy; u[b + U_SHAPE + 2] = wt.r2[i]; u[b + U_SHAPE + 3] = 0;
  } else {
    u[b + U_SHAPE] = wt.x0[i] - ox; u[b + U_SHAPE + 1] = wt.y0[i] - oy; u[b + U_SHAPE + 2] = wt.x1[i] - ox; u[b + U_SHAPE + 3] = wt.y1[i] - oy;
  }
  u[b + U_SLOT] = slot;
  u[b + U_UNDER] = cam.z < wt.z[i] && regionContains(wt, i, cam.x, cam.y) ? 1 : 0;
  u[b + U_REGION] = i;
  ringRuns(ax0, ay0, ax1, ay1, sel.runs, slot * RUNS_STRIDE);
}

/**
 * Clipmap index runs a region AABB (local to O) needs: ring k when the box meets square(h_k) and is not wholly inside
 * the finer ring's square; the skirt when the box leaves square(h_3). Adjacent included ranges merge into one run.
 * @param {number} ax0 @param {number} ay0 @param {number} ax1 @param {number} ay1
 * @param {Int32Array} out @param {number} o
 */
export function ringRuns(ax0, ay0, ax1, ay1, out, o) {
  const rs = getClipmap().rangeStart;
  let nRuns = 0, curFirst = -1, curEnd = -1;
  for (let r = 0; r <= WATER_RING_COUNT; r++) { // r = 4 is the skirt
    let used;
    if (r < WATER_RING_COUNT) {
      const h = WATER_RING_HALF[r];
      used = ax1 > -h && ax0 < h && ay1 > -h && ay0 < h;
      if (used && r > 0) {
        const hi = WATER_RING_HALF[r - 1];
        if (ax0 >= -hi && ax1 <= hi && ay0 >= -hi && ay1 <= hi) used = false; // wholly inside the finer ring
      }
    } else {
      const h = WATER_RING_HALF[WATER_RING_COUNT - 1];
      used = ax0 < -h || ax1 > h || ay0 < -h || ay1 > h;
    }
    if (!used) continue;
    if (curFirst >= 0 && rs[r] === curEnd) { curEnd = rs[r + 1]; continue; }
    if (curFirst >= 0) { out[o + 1 + nRuns * 2] = curFirst; out[o + 2 + nRuns * 2] = curEnd - curFirst; nRuns++; }
    curFirst = rs[r]; curEnd = rs[r + 1];
  }
  if (curFirst >= 0) { out[o + 1 + nRuns * 2] = curFirst; out[o + 2 + nRuns * 2] = curEnd - curFirst; nRuns++; }
  out[o] = nRuns;
}

export { RUNS_STRIDE };

// ---------------------------------------------------------------------------
// JS twin of the GPU water pass
// ---------------------------------------------------------------------------
const _sel = createWaterSelection();
const _list = new DrawList(WATER_SLOTS);
const _ctx = { M: /** @type {Float64Array|null} */ (null), snap: true, sceneDepth: /** @type {Float32Array|null} */ (null), water: _sel };
/** @type {import('../mesh/rasterJS.js').RasterTarget|null} */
let _target = null;

/**
 * Rasterises this frame's water layer into a cell-resolution target and stores it as `fb.water` (null when no region is
 * selected). Reads the resolved scene depth `fb.depth.depth` (d units, Infinity = sky) for the occluder, so call it after
 * the scene was copied into the G-buffer. Zero allocation once warm.
 * @param {any} fb @param {any} world @param {{x:number,y:number,z:number}} cam
 * @param {Float64Array} M - world -> clip (the scene's viewProj) @param {Float64Array} planes - its frustum planes
 * @param {boolean} [countWrites] - test instrumentation: per-pixel coverage counter in `target.writes`
 */
export function renderWaterJS(fb, world, cam, M, planes, countWrites) {
  const sel = selectWater(world, cam, planes, _sel);
  if (sel.count + sel.sheetCount === 0) { fb.water = null; return null; }
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows;
  if (!_target || _target.cols !== cols || _target.rows !== rows || !!_target.writes !== !!countWrites) _target = createRasterTarget(cols, rows, 1, { countWrites: !!countWrites });
  else clearRasterTarget(_target);
  _list.begin();
  for (let k = 0; k < sel.count + sel.sheetCount; k++) {
    const s = k < sel.count ? k : 8 + k - sel.count;
    const item = _list.push(null, DRAW_WATER);
    item.objectId = s;
    item.water = sel;
  }
  _ctx.M = M;
  _ctx.sceneDepth = fb.depth.depth;
  rasterDrawList(_list, _target, _ctx);
  fb.water = _target;
  return _target;
}

/** The last selection `renderWaterJS` made (tests / the composite step). */
export function lastWaterSelection() { return _sel; }

