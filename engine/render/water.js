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
  getClipmap, waterVertexJS, waterInsideJS, buildRiverMesh,
} from '../mesh/waterMesh.js';
import { defaultWaterLooks } from './waterLook.js';

export { waterVertexJS, waterInsideJS, getClipmap, WATER_U_STRIDE };

/** Slots 0..7 = regions, 8..11 = waterfall sheets (35.3), 12..13 = river ribbons (38.45; JS twin only until RIVER-03 ports the WGSL). */
export const WATER_SLOTS = 14;
export const WATER_RIVER_SLOT0 = 12;
export const WATER_RIVER_SLOTS = 2;
/** River LOD0 distance (m) and max draw runs per river (38.45 (2)). */
export const RIVER_LOD0_M = 192;
export const RIVER_RUNS_MAX = 8;
export const RIVER_RUNS_STRIDE = 1 + 2 * RIVER_RUNS_MAX;
const RSC = 136; // scratch run capacity per list (<= 129 runs for a 16 km river)
const RIVER_CULL_PAD = 1;
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
 * @property {number} riverCount - river ribbons selected (slots 12..12+riverCount-1)
 * @property {any[]} riverMesh - per river slot (0..1): the static ribbon mesh
 * @property {Int32Array} riverRuns - per river slot [nRuns, first0, count0, ...] (index ranges into the ribbon mesh; <= 8 runs)
 * @property {Int32Array} clip - per river slot 2 world.water region indices the ribbon is discarded inside (-1 = none)
 * @property {Int32Array} rsc - scratch (chunk run lists)
 * @property {Int32Array} runs - per slot [nRuns, first0, count0, first1, count1, first2, count2] (clipmap index ranges)
 * @property {Float64Array} dist - scratch (candidate distances)
 * @property {Int32Array} cand - scratch (candidate region indices)
 */

/** @returns {WaterSelection} */
export function createWaterSelection() {
  return {
    count: 0, sheetCount: 0, riverCount: 0, wtab: null, riverMesh: [null, null], riverRuns: new Int32Array(WATER_RIVER_SLOTS * RIVER_RUNS_STRIDE),
    clip: new Int32Array(WATER_RIVER_SLOTS * 2).fill(-1), rsc: new Int32Array(4 * RSC), sheets: new Array(WATER_RIVER_SLOT0).fill(null), O: new Float64Array(2), region: new Int32Array(WATER_SLOTS),
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
export function selectWater(world, cam, planes, sel, looks) {
  const wt = world && world.water;
  sel.count = 0; sel.sheetCount = 0; sel.riverCount = 0; sel.wtab = wt || null;
  sel.sheets.fill(null);
  const ex = cam.x, ey = cam.y;
  const ox = Math.floor(ex / WATER_SNAP + 0.5) * WATER_SNAP, oy = Math.floor(ey / WATER_SNAP + 0.5) * WATER_SNAP;
  sel.O[0] = ox; sel.O[1] = oy;

  // candidates: in frustum; key = 0 for the region holding the eye (nearest AABB otherwise)
  let n = 0;
  for (let i = 0; i < (wt ? wt.count : 0); i++) {
    if (wt.kind[i] === 3 || !wt.draw[i]) continue; // river ribbons: own slots (selectRivers); draw:false regions are physics-only
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
  if (wt && wt.rivers.length) selectRivers(wt, cam, planes, sel, looks || defaultWaterLooks(), ox, oy);
  return sel;
}

/** The river look's cull distance (look.riverFarM) of region `ri`. */
function riverFar(wt, ri, looks) {
  const rl = looks.riverByName.get(wt.lookNames[wt.look[ri]]) || looks.riverFallback;
  return rl[3];
}

/** Distance from (ex, ey, ez) to a box (0 inside). */
function boxDist(ex, ey, ez, x0, y0, z0, x1, y1, z1) {
  let dx = x0 - ex; if (dx < 0) dx = ex - x1; if (dx < 0) dx = 0;
  let dy = y0 - ey; if (dy < 0) dy = ey - y1; if (dy < 0) dy = 0;
  let dz = z0 - ez; if (dz < 0) dz = ez - z1; if (dz < 0) dz = 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Rivers (kind 3, draw): the nearest <= 2 inside the frustum and riverFarM take slots 12..13; chunks are culled / LOD'd / merged into <= 8 runs. */
function selectRivers(wt, cam, planes, sel, looks, ox, oy) {
  let n = 0;
  for (let i = 0; i < wt.count; i++) {
    if (wt.kind[i] !== 3 || !wt.draw[i]) continue;
    const rv = wt.rivers[wt.riv[i]], pad = rv.feather + 0.5;
    const zt = rv.z[0] + RIVER_CULL_PAD;
    if (classifyAABB(planes, rv.x0 - pad, rv.y0 - pad, rv.zmin - RIVER_CULL_PAD, rv.x1 + pad, rv.y1 + pad, zt, 0) === CULL_OUT) continue;
    const d = boxDist(cam.x, cam.y, cam.z, rv.x0 - pad, rv.y0 - pad, rv.zmin, rv.x1 + pad, rv.y1 + pad, zt);
    if (d > riverFar(wt, i, looks)) continue;
    // insertion into the nearest-2 list (ties: earlier region index stays first)
    if (n >= WATER_RIVER_SLOTS && !(d < sel.dist[WATER_RIVER_SLOTS - 1])) continue;
    let k = n < WATER_RIVER_SLOTS ? n++ : WATER_RIVER_SLOTS - 1;
    while (k > 0 && d < sel.dist[k - 1]) { sel.dist[k] = sel.dist[k - 1]; sel.cand[k] = sel.cand[k - 1]; k--; }
    sel.dist[k] = d; sel.cand[k] = i;
  }
  for (let k = 0; k < n; k++) fillRiver(wt, sel, k, sel.cand[k], cam, planes, looks, ox, oy);
  sel.riverCount = n;
}

function fillRiver(wt, sel, k, ri, cam, planes, looks, ox, oy) {
  const slot = WATER_RIVER_SLOT0 + k, rv = wt.rivers[wt.riv[ri]], u = sel.u, b = slot * WATER_U_STRIDE;
  const mesh = rv.mesh || (rv.mesh = buildRiverMesh(rv)); // static, built once
  sel.region[slot] = ri; sel.riverMesh[k] = mesh;
  if (!rv.clipIdx) { rv.clipIdx = new Int32Array(2).fill(-1); for (let c = 0; c < rv.clip.length; c++) rv.clipIdx[c] = wt.ids.indexOf(rv.clip[c]); }
  sel.clip[k * 2] = rv.clipIdx[0]; sel.clip[k * 2 + 1] = rv.clipIdx[1];
  u[b + U_KIND] = 3; u[b + U_Z] = rv.zmin; u[b + U_SLOT] = slot; u[b + U_UNDER] = 0; u[b + U_REGION] = ri;
  u[b + U_AABB] = rv.x0 - ox; u[b + U_AABB + 1] = rv.y0 - oy; u[b + U_AABB + 2] = rv.x1 - ox; u[b + U_AABB + 3] = rv.y1 - oy;
  u[b + U_SHAPE] = mesh.ox - ox; u[b + U_SHAPE + 1] = mesh.oy - oy; u[b + U_SHAPE + 2] = 0; u[b + U_SHAPE + 3] = 0;
  const far = riverFar(wt, ri, looks), ex = cam.x, ey = cam.y, ez = cam.z, ch = mesh.chunks, rsc = sel.rsc;
  // per-chunk visibility -> run lists per LOD (list L: starts at L*2*RSC, ends at L*2*RSC + RSC), chunk indices [start, end)
  let n0 = 0, n1 = 0;
  for (let ci = 0; ci < ch.length; ci++) {
    const c = ch[ci];
    if (classifyAABB(planes, c.x0 - 1, c.y0 - 1, c.z0 - RIVER_CULL_PAD, c.x1 + 1, c.y1 + 1, c.z1 + RIVER_CULL_PAD, 0) === CULL_OUT) continue;
    const d = boxDist(ex, ey, ez, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
    if (d > far) continue;
    const lod = d < RIVER_LOD0_M ? 0 : 1, base = lod * 2 * RSC, nr = lod ? n1 : n0;
    if (nr > 0 && rsc[base + RSC + nr - 1] === ci) rsc[base + RSC + nr - 1] = ci + 1;
    else { rsc[base + nr] = ci; rsc[base + RSC + nr] = ci + 1; if (lod) n1++; else n0++; }
  }
  // merge the smallest same-LOD gap until <= 8 runs (the gap chunks are drawn too: cheap)
  while (n0 + n1 > RIVER_RUNS_MAX) {
    let bl = -1, bj = 0, bg = 1e9;
    for (let lod = 0; lod < 2; lod++) {
      const base = lod * 2 * RSC, nr = lod ? n1 : n0;
      for (let j = 0; j + 1 < nr; j++) { const g = rsc[base + j + 1] - rsc[base + RSC + j]; if (g < bg) { bg = g; bl = lod; bj = j; } }
    }
    const base = bl * 2 * RSC, nr = bl ? n1 : n0;
    rsc[base + RSC + bj] = rsc[base + RSC + bj + 1];
    for (let j = bj + 1; j + 1 < nr; j++) { rsc[base + j] = rsc[base + j + 1]; rsc[base + RSC + j] = rsc[base + RSC + j + 1]; }
    if (bl) n1--; else n0--;
  }
  const ro = k * RIVER_RUNS_STRIDE, runs = sel.riverRuns;
  let nr = 0;
  for (let lod = 0; lod < 2; lod++) {
    const base = lod * 2 * RSC, cnt = lod ? n1 : n0;
    for (let j = 0; j < cnt; j++) {
      const a = ch[rsc[base + j]], z = ch[rsc[base + RSC + j] - 1];
      const first = lod ? a.lod1Start : a.lod0Start, last = lod ? z.lod1Start + z.lod1Count : z.lod0Start + z.lod0Count;
      runs[ro + 1 + nr * 2] = first; runs[ro + 2 + nr * 2] = last - first; nr++;
    }
  }
  runs[ro] = nr;
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
  const sel = selectWater(world, cam, planes, _sel, fb.waterLooks || defaultWaterLooks());
  if (sel.count + sel.sheetCount + sel.riverCount === 0) { fb.water = null; return null; }
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
  for (let k = 0; k < sel.riverCount; k++) {
    const item = _list.push(null, DRAW_WATER);
    item.objectId = WATER_RIVER_SLOT0 + k;
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

