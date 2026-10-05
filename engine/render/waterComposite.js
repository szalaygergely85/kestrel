// @ts-check
// engine/render/waterComposite.js - US-055a2b (docs/architecture.md 32.2 composite rules on the 35.3 water layer): the JS twin of
// `glsl/waterComposite.frag.js` (mesh renderer only). Reads the WATER layer (`fb.water`, a cell-resolution RasterTarget written by
// `renderWaterJS`: kind 1 = water, depth = vD, objectId = slot | back << 4) and composites it onto the already shaded cells.
//
// Per hit cell (dW < rawDepth, sky = Infinity):
//   a    = sky ? 1 : clamp((rawDepth - dW) / opaqueAt, 0, 1)                      (water path length -> opacity)
//   rgbW = clamp(mix(shallow, deep, column/tintDepth) * (ambientI + sunI * max(0, sunDir.z) * sunF), 0, 255)   (up normal, terrain `b` formula)
//   a <  seeThrough: keep the floor glyph outside the shore band, fg = mix(fg, fogged rgbW, a), bg = mix(bg, fogged rgbW * bgK, a)
//   a >= seeThrough: glyph = ramp[h % n], using the rotated, drifting brick hash (36.1b).
//                    fg mixes halfway to glint with probability glintP; bg uses the un-glinted rgbW * bgK.
//   shore (36.1c): foam glyph and rim foreground from column depth / edge distance; background unchanged.
//   fog (own distance dW, x pitched fog scale): see waterLook.js `waterFogParams`.
//   flow (US-141a, 35.4): a flowing slot replaces the ramp glyph by `look.streak` where the advected streak hash (waterLook.js `flowStreakHit`) says so.
// Edge suppression: an opaque (a >= seeThrough) surface cell sets `fb.waterMask[i] = 1`; `edgePass` skips masked cells so a
// submerged silhouette never draws through opaque water.
//
// Order in `renderWorld` (mesh): shade -> composite(surfaces) -> edgePass(mask) -> fillSky -> composite(sky). The GPU does the same
// in `_passWaterComposite` (after shade, before edge; the sky is already in the shade output there). Zero allocation after warm.
import { sunFromWorld } from './lighting.js';
import { unprojectCell, unprojectPitched, pitchedFogScale } from './projection.js';
import { lastWaterSelection } from './water.js';
import { WL_STRIDE, WL_SLOTS, WFOG_LEN, fillWaterSlotTable, defaultWaterLooks, waterFogParams, flowStreakHit, waterSurfaceHash, waterEdgeDistance, waterfallHash } from './waterLook.js';

const _table = new Float32Array(WL_SLOTS * WL_STRIDE);
const _fog = new Float32Array(WFOG_LEN);
const _p = new Float64Array(3);
const _floorP = new Float64Array(3);
const _sun = { dirX: 0, dirY: 0, dirZ: 1, ambientI: 0, sunI: 0 };
/** @type {Uint8Array|null} */
let _mask = null;

/** The slot table the last composite used (tests / the GPU uploader share the same packing). */
export function lastWaterSlotTable() { return _table; }

function byte(v) { return v <= 0 ? 0 : v >= 255 ? 255 : Math.floor(v + 0.5); }

/**
 * @param {any} fb - { rt, gbuf, depth, water, palette, matTable, light, timeSec, waterLooks?, waterMask? }
 * @param {any} world @param {any} terms - shear ProjTerms @param {any} pterms - PitchedTerms @param {boolean} pitched
 * @param {boolean} skyPass - false: surface cells (before the edge pass, builds `fb.waterMask`); true: sky cells (after fillSky)
 */
export function waterCompositeJS(fb, world, terms, pterms, pitched, skyPass) {
  const wt = fb.water;
  if (!wt) { if (!skyPass) fb.waterMask = null; return; }
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows, n = cols * rows;
  if (!skyPass) {
    if (!_mask || _mask.length !== n) _mask = new Uint8Array(n); else _mask.fill(0);
    fb.waterMask = _mask;
  }
  const sel = lastWaterSelection();
  fillWaterSlotTable(sel, world, fb.waterLooks || defaultWaterLooks(), _table, fb.timeSec || 0);
  waterFogParams(fb.matTable, fb.palette, !!world.terrain, _fog);
  const sun = sunFromWorld(world, fb.palette, _sun);
  const light = fb.light;
  const sunMapOn = !!(light && !light.uniform && light.sunMapOn);
  const kindArr = fb.gbuf.kind, depth = fb.depth.depth, wKind = wt.kind, wDepth = wt.depth, wObj = wt.objectId;
  const cells = fb.rt.cells || fb.rt;
  const gArr = cells.glyphIdx, fgArr = cells.fg, bgArr = cells.bg, mArr = cells.mask;
  const sunZ = sun.dirZ > 0 ? sun.dirZ : 0;
  const fStart = _fog[0], fFull = _fog[1], fCurve = _fog[2], fBgScale = _fog[3];

  for (let i = 0; i < n; i++) {
    if (wKind[i] !== 1) continue;
    const isSky = kindArr[i] === 0;
    if (isSky !== skyPass) continue;
    const dW = wDepth[i], raw = isSky ? Infinity : depth[i];
    if (!(dW < raw)) continue;
    const slot = wObj[i] & 15, lb = slot * WL_STRIDE, sheet = (wObj[i] & 32) !== 0;
    const opaqueAt = _table[lb + 3], seeThrough = _table[lb + 7], bgK = _table[lb + 13];
    let a = sheet ? _table[lb + 55] : isSky ? 1 : (raw - dW) / opaqueAt;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const col = i % cols, row = (i / cols) | 0;
    if (pitched) unprojectPitched(pterms, col, row, dW, _p); else unprojectCell(terms, col, row, dW, _p);

    let column = Infinity;
    if (!isSky) {
      if (pitched) unprojectPitched(pterms, col, row, raw, _floorP); else unprojectCell(terms, col, row, raw, _floorP);
      column = Math.max(0, _p[2] - _floorP[2]);
    }
    const tint = isSky ? a : Math.min(column / _table[lb + 38], 1);
    const k = sun.ambientI + sun.sunI * sunZ * (sunMapOn ? light.sunN[i] * 0.25 : 1);
    let wr = (_table[lb] + (_table[lb + 4] - _table[lb]) * tint) * k;
    let wg = (_table[lb + 1] + (_table[lb + 5] - _table[lb + 1]) * tint) * k;
    let wb = (_table[lb + 2] + (_table[lb + 6] - _table[lb + 2]) * tint) * k;
    wr = wr < 0 ? 0 : wr > 255 ? 255 : wr; wg = wg < 0 ? 0 : wg > 255 ? 255 : wg; wb = wb < 0 ? 0 : wb > 255 ? 255 : wb;

    let br0 = wr * bgK, bg0 = wg * bgK, bb0 = wb * bgK;
    const fi = i * 4;
    const opaque = !sheet && a >= seeThrough;
    let glyph = fgArr[fi + 3];
    if (opaque) {
      const h = waterSurfaceHash(_table, lb, _p[0], _p[1]);
      glyph = _table[lb + 16 + (h % (_table[lb + 12] | 0))];
      if (flowStreakHit(_table, lb, _p[0], _p[1])) glyph = _table[lb + 24]; // US-141a (35.4): flowing water streaks
      if ((h >>> 8) * (1 / 16777216) > 1 - _table[lb + 15]) {
        wr += (_table[lb + 8] - wr) * 0.5; wg += (_table[lb + 9] - wg) * 0.5; wb += (_table[lb + 10] - wb) * 0.5;
      }
    }
    if (sheet) {
      const h = waterfallHash(_table, lb, _p[0], _p[1], wt.z[i]);
      glyph = _table[lb + 16 + h % (_table[lb + 12] | 0)];
      const brightness = 0.6 + (h % 3) * 0.2;
      wr = Math.min(255, _table[lb] * k * brightness); wg = Math.min(255, _table[lb + 1] * k * brightness); wb = Math.min(255, _table[lb + 2] * k * brightness);
      br0 = wr * bgK; bg0 = wg * bgK; bb0 = wb * bgK;
      if ((h >>> 8) * (1 / 16777216) > 0.92) { wr = _table[lb + 8]; wg = _table[lb + 9]; wb = _table[lb + 10]; }
    }
    const e = waterEdgeDistance(_table, lb, _p[0], _p[1]);
    const shoreS = Math.max(0, Math.min(column / _table[lb + 52], e / _table[lb + 39]));
    const shore = !sheet && !isSky && shoreS < 1 && dW < _table[lb + 53];
    if (shore) {
      const nFoam = _table[lb + 47] | 0;
      glyph = _table[lb + 44 + Math.min(Math.floor(shoreS * nFoam), nFoam - 1)];
      wr = _table[lb + 48] + (wr - _table[lb + 48]) * shoreS;
      wg = _table[lb + 49] + (wg - _table[lb + 49]) * shoreS;
      wb = _table[lb + 50] + (wb - _table[lb + 50]) * shoreS;
    }
    // own fog (distance dW, x the pitched fog scale)
    const fd = pitched ? dW * pitchedFogScale(pterms, row) : dW;
    let f = (fd - fStart) / (fFull - fStart);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    if (fCurve !== 1) f = Math.pow(f, fCurve);
    let fBg = fBgScale * f; if (fBg > 1) fBg = 1;
    let fr = wr + (_fog[4] + (_fog[8] - _fog[4]) * f - wr) * f;
    let fg = wg + (_fog[5] + (_fog[9] - _fog[5]) * f - wg) * f;
    let fb2 = wb + (_fog[6] + (_fog[10] - _fog[6]) * f - wb) * f;
    let br = br0 + (_fog[12] + (_fog[16] - _fog[12]) * f - br0) * fBg;
    let bg = bg0 + (_fog[13] + (_fog[17] - _fog[13]) * f - bg0) * fBg;
    let bb = bb0 + (_fog[14] + (_fog[18] - _fog[14]) * f - bb0) * fBg;
    if (!opaque) { // see-through: tint the shaded floor cell by the opacity
      if (!shore) {
        fr = fgArr[fi] + (fr - fgArr[fi]) * a; fg = fgArr[fi + 1] + (fg - fgArr[fi + 1]) * a; fb2 = fgArr[fi + 2] + (fb2 - fgArr[fi + 2]) * a;
      }
      br = bgArr[fi] + (br - bgArr[fi]) * a; bg = bgArr[fi + 1] + (bg - bgArr[fi + 1]) * a; bb = bgArr[fi + 2] + (bb - bgArr[fi + 2]) * a;
    } else if (!isSky) _mask[i] = 1;
    gArr[i] = glyph;
    fgArr[fi] = byte(fr); fgArr[fi + 1] = byte(fg); fgArr[fi + 2] = byte(fb2); fgArr[fi + 3] = glyph;
    bgArr[fi] = byte(br); bgArr[fi + 1] = byte(bg); bgArr[fi + 2] = byte(bb); bgArr[fi + 3] = 255;
    if (mArr) mArr[i] = 1;
  }
}
