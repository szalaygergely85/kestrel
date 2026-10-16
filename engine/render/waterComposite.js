// @ts-check
// engine/render/waterComposite.js - US-055a2b (docs/architecture.md 32.2 composite rules on the 35.3 water layer): the JS twin of
// `glsl/waterComposite.frag.js` (mesh renderer only). Reads the WATER layer (`fb.water`, a cell-resolution RasterTarget written by
// `renderWaterJS`: kind 1 = water, depth = vD, objectId = slot | back << 4) and composites it onto the already shaded cells.
//
// Per hit cell (dW < rawDepth, sky = Infinity):
//   a    = sky ? 1 : clamp((rawDepth - dW) / opaqueAt, 0, 1)                      (water path length -> opacity)
//   rgbW = clamp(mix(shallow, deep, column/tintDepth) * (ambientI + sunI * max(0, sunDir.z) * sunF * cF), 0, 255) (up normal, terrain `b`
//          formula; S8-B2-12b 38.13: cF = 1 - cloudByte/255, the floor cell's cloud-shadow darkening, 1 at strength 0)
//   a <  seeThrough: keep the floor glyph outside the shore band, fg = mix(fg, fogged rgbW, a), bg = mix(bg, fogged rgbW * bgK, a)
//   a >= seeThrough: glyph = ramp[h % n], using the rotated, drifting brick hash (36.1b).
//                    fg mixes halfway to glint with probability glintP; bg uses the un-glinted rgbW * bgK.
//   shore (36.1c): foam glyph and rim foreground from column depth / edge distance; background unchanged.
//   fog (own distance dW, x pitched fog scale): see waterLook.js `waterFogParams`.
//   flow (US-141a, 35.4): a flowing slot replaces the ramp glyph by `look.streak` where the advected streak hash (waterLook.js `flowStreakHit`) says so.
//   ripples (S8-B2-13b, 38.14, the note of record): !sheet cells only, composite-only (no geometry change); reads `fb.ripples`
//   (duck-typed `{packInto}`, owned by `engine/fx/ripples.js`) via `waterLook.js rippleAccAt`; absent `fb.ripples` = 0 rings.
// Edge suppression: an opaque (a >= seeThrough) surface cell sets `fb.waterMask[i] = 1`; `edgePass` skips masked cells so a
// submerged silhouette never draws through opaque water.
//
// Order in `renderWorld` (mesh): shade -> composite(surfaces) -> edgePass(mask) -> fillSky -> composite(sky). The GPU does the same
// in `_passWaterComposite` (after shade, before edge; the sky is already in the shade output there). Zero allocation after warm.
import { sunFromWorld } from './lighting.js';
import { unprojectCell, unprojectPitched } from './projection.js';
import { lastWaterSelection } from './water.js';
import { SKY_LUT_N } from './gpu/wgsl/skyLut.js';
import { skyLutFromPalette, waterReflectAt, WATER_REFLECT } from './waterReflect.js';
import {
  WL_STRIDE, WL_TABLE_SLOTS, WFOG_LEN, RIPPLE_SLOTS, RIPPLE_ACC_MIN, DEFAULT_RIPPLE_GLYPH, DEFAULT_RIPPLE_GAIN,
  fillWaterSlotTable, defaultWaterLooks, waterFogParams, flowStreakHit, riverStreakHit, waterSurfaceHash, waterfallHash, rippleAccAt,
} from './waterLook.js';

import {
  WF_STRIDE, WF_SLOTS, CAUSTIC_CELL, CAUSTIC_HZ, fillWaterFinishTable, shearMirrorRow, reflAccept,
} from './waterFinish.js';

const _table = new Float32Array(WL_TABLE_SLOTS * WL_STRIDE); // 12 GPU slots + river slots 12..13 (38.45, JS twin)
const _fin = new Float32Array(WF_SLOTS * WF_STRIDE); // WATER-FINISH-01a (38.77) per-slot finish keys; all 0 = off
const _mir = new Float64Array(3);
const _fog = new Float32Array(WFOG_LEN);
const _rip = new Float32Array(RIPPLE_SLOTS * 4); // S8-B2-13b (38.14): 8 rings x (x, y, age, amp)
const _p = new Float64Array(3);
const _refl = new Float64Array(4); // AUD-42: [fresnel, skyR, skyG, skyB]
const _skyLut = new Float32Array(4 * SKY_LUT_N);
let _lutPalette = null, _lutTime = null, _lutElevTop = 0, _lutVer = 0, _lutFogVer = 0;
const _floorP = new Float64Array(3);
const _sun = { dirX: 0, dirY: 0, dirZ: 1, ambientI: 0, sunI: 0 };
/** @type {Uint8Array|null} */
let _mask = null;

/** The slot table the last composite used (tests / the GPU uploader share the same packing). */
export function lastWaterSlotTable() { return _table; }

// WATER-ALLOC-01: the loop body is too big for V8's cumulative inlining budget, so any call that RETURNS a double (or a uint32 >= 2^31)
// boxes a HeapNumber per cell (~66 KB/frame). Hot calls therefore return int32/bool only; double helpers are inlined below.
// Double ARGUMENTS to a non-inlined call box too, so the wrappers below take ints only and read the doubles from module scratch.
const _w = new Float64Array(3); // [dW, raw, rE] of the current cell (so the wrappers take no double argument)
let _tNow = 0;
const hashSurfI = (lb) => waterSurfaceHash(_table, lb, _p[0], _p[1]) | 0; // int32 bits; the loop reads them back with >>> 0
const hashFallI = (lb, wz, i) => waterfallHash(_table, lb, _p[0], _p[1], wz[i]) | 0;
const unprojW = (pitched, pterms, terms, col, row, k, out) => (pitched ? unprojectPitched(pterms, col, row, _w[k], out) : unprojectCell(terms, col, row, _w[k], out));
const flowHit = (lb) => flowStreakHit(_table, lb, _p[0], _p[1]);
const riverHit = (lb, wz, i) => riverStreakHit(_table, lb, wz[i], _w[2]);
// == causticHit(floorP0, floorP1, t, k) with hashFastU inlined by hand (terrainShade.js hashFastU; parity: waterFinish.test.js + the byte compare)
const causticAt = (fb8) => {
  let h = (Math.imul(Math.floor(_floorP[0] / CAUSTIC_CELL) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(_floorP[1] / CAUSTIC_CELL) | 0, 0x165667b1) ^ Math.imul(Math.floor(_tNow * CAUSTIC_HZ) | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) >>> 8) * (1 / 16777216) > 1 - _fin[fb8];
};
const mirrorShear = (terms, row) => shearMirrorRow(terms.horizonRow, row);
const mirrorPitched = (terms) => { // == projectDirPitched(terms, p - eye, mirrored z) inlined (doubles must not cross a non-inlined call)
  if (terms.ortho) return false;
  const dx = _p[0] - terms.eyeX, dy = _p[1] - terms.eyeY, dz = -(_p[2] - terms.eyeZ);
  const vd = dx * terms.fX + dy * terms.fY + dz * terms.fZ;
  _mir[2] = vd;
  if (!(vd > 1e-9)) return false;
  const vx = dx * terms.rX + dy * terms.rY, vy = dx * terms.uX + dy * terms.uY + dz * terms.uZ;
  _mir[0] = Math.floor((vx / vd / terms.tanHalfX + 1) * (terms.cols / 2) - 0.5 + 0.5);
  _mir[1] = Math.floor((1 - vy / vd / terms.tanHalfY) * (terms.rows / 2) + 0.5);
  return true;
};
const reflOk = (rowM, rows, wKind, kindArr, depth, mi) => reflAccept(rowM, rows, wKind[mi], kindArr[mi], depth[mi], _w[0]);
const rippleHit = (n) => rippleAccAt(_rip, n, _p[0], _p[1]) >= RIPPLE_ACC_MIN;
const reflectAt = (reflTerms) => waterReflectAt(reflTerms.eyeZ, _p[0] - reflTerms.eyeX, _p[1] - reflTerms.eyeY, _p[2] - reflTerms.eyeZ, _skyLut, _lutElevTop, _refl);
const R_SKY = WATER_REFLECT.skyMix, R_DARK = WATER_REFLECT.darken, R_FLOOR = WATER_REFLECT.skyFloor; // TEASER-QA-02 sky floor

function byte(v) { return v <= 0 ? 0 : v >= 255 ? 255 : Math.floor(v + 0.5); }

/**
 * @param {any} fb - { rt, gbuf, depth, water, palette, matTable, light, timeSec, waterLooks?, waterMask? }
 * @param {any} world @param {any} terms - shear ProjTerms @param {any} pterms - PitchedTerms @param {boolean} pitched
 * @param {boolean} skyPass - false: surface cells (before the edge pass, builds `fb.waterMask`); true: sky cells (after fillSky)
 */
const WATER_PATH_FLOOR_K = 4; // OB-111: path >= column * 4 (== column / sin 14.5 deg); WGSL twin uses the literal 4.0
export function waterCompositeJS(fb, world, terms, pterms, pitched, skyPass) {
  const wt = fb.water;
  if (!wt) { if (!skyPass) fb.waterMask = null; return; }
  const cols = fb.gbuf.cols, rows = fb.gbuf.rows, n = cols * rows;
  if (!skyPass) {
    if (!_mask || _mask.length !== n) _mask = new Uint8Array(n); else _mask.fill(0);
    fb.waterMask = _mask;
  }
  const pal = fb.palette;
  if (pal !== _lutPalette || (pal && (pal.defaultTime !== _lutTime || (pal.liveLookVersion | 0) !== _lutVer || (pal.liveFogVersion | 0) !== _lutFogVer))) { _lutPalette = pal; _lutTime = pal ? pal.defaultTime : null; _lutVer = pal ? (pal.liveLookVersion | 0) : 0; _lutFogVer = pal ? (pal.liveFogVersion | 0) : 0; _lutElevTop = skyLutFromPalette(pal, _skyLut); } // ENV-03b: re-bake on liveFogVersion (haze)
  const reflTerms = pitched ? pterms : terms, reflOn = _lutElevTop > 0 && !(pitched && pterms.ortho);
  const sel = lastWaterSelection();
  fillWaterSlotTable(sel, world, fb.waterLooks || defaultWaterLooks(), _table, fb.timeSec || 0);
  fillWaterFinishTable(sel, world, fb.waterLooks || defaultWaterLooks(), _fin);
  const timeSec = fb.timeSec || 0; _tNow = timeSec;
  waterFogParams(fb.matTable, fb.palette, !!world.terrain, _fog);
  // S8-B2-13b (38.14): fb.ripples is duck-typed {packInto} (engine/fx/ripples.js); absent (NEEDS B1-main not wired
  // yet, or no splashes this scene) = 0 rings, bit-identical to the pre-ripple render.
  const ripCount = (fb.ripples && typeof fb.ripples.packInto === 'function') ? fb.ripples.packInto(fb.timeSec || 0, _rip) : 0;
  const rippleGlyph = fb.rippleGlyph != null ? fb.rippleGlyph : DEFAULT_RIPPLE_GLYPH;
  const rippleGain = fb.rippleGain != null ? fb.rippleGain : DEFAULT_RIPPLE_GAIN;
  const sun = sunFromWorld(world, fb.palette, _sun);
  const sunUp = sun.dirZ > 0 && sun.sunI > 0;
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
    _w[0] = dW; _w[1] = raw;
    const slot = wObj[i] & 15, lb = slot * WL_STRIDE, sheet = (wObj[i] & 32) !== 0, ribbon = (wObj[i] & 64) !== 0;
    const opaqueAt = _table[lb + 3], seeThrough = _table[lb + 7], bgK = _table[lb + 13];
    let a = sheet ? _table[lb + 55] : isSky ? 1 : (raw - dW) / opaqueAt;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const col = i % cols, row = (i / cols) | 0;
    unprojW(pitched, pterms, terms, col, row, 0, _p);

    let column = Infinity;
    if (!isSky) {
      unprojW(pitched, pterms, terms, col, row, 1, _floorP);
      column = Math.max(0, _p[2] - _floorP[2]);
      if (!sheet) { a = Math.max(raw - dW, column * WATER_PATH_FLOOR_K) / opaqueAt; a = a < 0 ? 0 : a > 1 ? 1 : a; } // OB-111: a steep ray through a shallow column still counts as column / 0.25 m of water
    }
    // OB-019 RIVER-02 (38.45): ribbon texel word = slot | back<<4 | 1<<6 | rapidQ<<8 | e*1000<<16; alpha feather by edge distance and column.
    let rE = 0, rRapid = 0;
    if (ribbon) {
      const rw = wObj[i];
      rE = (rw >>> 16) * 0.001; _w[2] = rE; rRapid = ((rw >>> 8) & 255) * (1 / 255);
      const fe = _table[lb + 30], fs = _table[lb + 31];
      a = a * (fe > 0 ? Math.min(1, rE / fe) : 1) * Math.min(1, column / fs); // == riverAlpha (inlined: no boxed return)
    }
    const tint = isSky ? a : Math.min(column / _table[lb + 38], 1);
    // S8-B2-12b (38.13): cloud-darkening byte (`light.cloudQ[i]`, the JS-side copy of the floor cell's LIGHT.w bits
    // 24..31) scales the sun term here too; 0 at strength 0 or with no per-cell byte -> cF 1 -> bit-identical.
    const cF = (light && !light.uniform && light.cloudQ) ? 1 - light.cloudQ[i] * (1 / 255) : 1;
    const k = sun.ambientI + sun.sunI * sunZ * (sunMapOn ? light.sunN[i] * 0.25 : 1) * cF;
    let wr = (_table[lb] + (_table[lb + 4] - _table[lb]) * tint) * k;
    let wg = (_table[lb + 1] + (_table[lb + 5] - _table[lb + 1]) * tint) * k;
    let wb = (_table[lb + 2] + (_table[lb + 6] - _table[lb + 2]) * tint) * k;
    wr = wr < 0 ? 0 : wr > 255 ? 255 : wr; wg = wg < 0 ? 0 : wg > 255 ? 255 : wg; wb = wb < 0 ? 0 : wb > 255 ? 255 : wb;

    let br0 = wr * bgK, bg0 = wg * bgK, bb0 = wb * bgK;
    const fi = i * 4, fb8 = slot * WF_STRIDE;
    const opaque = !sheet && a >= seeThrough;
    let glyph = fgArr[fi + 3];
    if (opaque) {
      const h = hashSurfI(lb) >>> 0;
      glyph = _table[lb + 16 + (h % (_table[lb + 12] | 0))];
      if (ribbon ? riverHit(lb, wt.z, i) : flowHit(lb)) glyph = _table[lb + 24]; // US-141a (35.4) / 38.45: flowing water streaks
      if (ribbon && rRapid > 0 && (h >>> 8) * (1 / 16777216) < rRapid * _table[lb + 33]) { // rapids: foam glyph + rim tint
        glyph = _table[lb + 44];
        wr += (_table[lb + 48] - wr) * 0.5; wg += (_table[lb + 49] - wg) * 0.5; wb += (_table[lb + 50] - wb) * 0.5;
      }
      if ((h >>> 8) * (1 / 16777216) > 1 - _table[lb + 15]) {
        wr += (_table[lb + 8] - wr) * 0.5; wg += (_table[lb + 9] - wg) * 0.5; wb += (_table[lb + 10] - wb) * 0.5;
      }
      if (reflOn) { // AUD-42: sky tint at the mirrored elevation + fresnel (fg and bg)
        reflectAt(reflTerms);
        const F = _refl[0];
        const kS = (F > R_FLOOR ? F : R_FLOOR) * R_SKY, kA = 1 - R_DARK * (1 - F), kB = 1 - kS, s1 = _refl[1] * kS, s2 = _refl[2] * kS, s3 = _refl[3] * kS; // == waterReflectMix x6 (inlined)
        wr = wr * kA * kB + s1; wg = wg * kA * kB + s2; wb = wb * kA * kB + s3;
        br0 = br0 * kA * kB + s1; bg0 = bg0 * kA * kB + s2; bb0 = bb0 * kA * kB + s3;
        const rK = _fin[fb8 + 6];
        if (rK > 0) { // WATER-FINISH-01a (38.77 A): screen-space reflection of the far bank (shaded bg of the mirrored row)
          let rowM = -1, colM = col;
          if (!pitched) rowM = mirrorShear(terms, row);
          else if (mirrorPitched(pterms)) { colM = _mir[0]; rowM = _mir[1]; }
          if (rowM >= 0 && rowM < rows && colM >= 0 && colM < cols) {
            if (ripCount > 0 && rippleHit(ripCount)) rowM += (col & 1) ? 1 : -1; // ripple wobble
            const mi = rowM * cols + colM;
            if (rowM >= 0 && rowM < rows && reflOk(rowM, rows, wKind, kindArr, depth, mi)) {
              const m = F * rK > 1 ? 1 : F * rK, dim = _fin[fb8 + 7], mf = mi * 4;
              const mr = bgArr[mf] * dim, mg = bgArr[mf + 1] * dim, mb = bgArr[mf + 2] * dim;
              wr += (mr - wr) * m; wg += (mg - wg) * m; wb += (mb - wb) * m;
              br0 += (mr - br0) * m; bg0 += (mg - bg0) * m; bb0 += (mb - bb0) * m;
            }
          }
        }
      }
    }
    // S8-B2-13b (38.14, the note of record): splash ripples, !sheet only (incl. see-through: replaces the floor
    // glyph), before the sheet/shore blocks. acc/glyph/gain are a single global uniform now, not a per-slot look field.
    if (!sheet && ripCount > 0) { // 0 rings -> acc 0 < RIPPLE_ACC_MIN: skip the call
      const acc = rippleAccAt(_rip, ripCount, _p[0], _p[1]);
      if (acc >= RIPPLE_ACC_MIN) {
        glyph = rippleGlyph;
        const m = acc * rippleGain;
        wr += (255 - wr) * m; wg += (255 - wg) * m; wb += (255 - wb) * m;
      }
    }
    if (sheet) {
      const h = hashFallI(lb, wt.z, i) >>> 0;
      glyph = _table[lb + 16 + h % (_table[lb + 12] | 0)];
      const brightness = 0.6 + (h % 3) * 0.2;
      const kS = sun.ambientI + sun.sunI * cF; // OB-045: foam scatters every way (full sun term, no N.L) and hangs in front of the cliff (no cliff sun map)
      wr = Math.min(255, _table[lb] * kS * brightness); wg = Math.min(255, _table[lb + 1] * kS * brightness); wb = Math.min(255, _table[lb + 2] * kS * brightness);
      br0 = wr * bgK; bg0 = wg * bgK; bb0 = wb * bgK;
      if ((h >>> 8) * (1 / 16777216) > 0.92) { wr = _table[lb + 8]; wg = _table[lb + 9]; wb = _table[lb + 10]; }
    }
    const e = _table[lb + 51] === 1 ? _table[lb + 42] - Math.sqrt((_p[0] - _table[lb + 40]) * (_p[0] - _table[lb + 40]) + (_p[1] - _table[lb + 41]) * (_p[1] - _table[lb + 41]))
      : Math.min(_p[0] - _table[lb + 40], _p[1] - _table[lb + 41], _table[lb + 42] - _p[0], _table[lb + 43] - _p[1]); // == waterEdgeDistance (inlined)
    const shoreS = ribbon ? Math.max(0, Math.min(column / _table[lb + 52], 1)) : Math.max(0, Math.min(column / _table[lb + 52], e / _table[lb + 39]));
    const shore = !sheet && !isSky && shoreS < 1 && dW < _table[lb + 53];
    if (shore) {
      const nFoam = _table[lb + 47] | 0;
      glyph = _table[lb + 44 + Math.min(Math.floor(shoreS * nFoam), nFoam - 1)];
      wr = _table[lb + 48] + (wr - _table[lb + 48]) * shoreS;
      wg = _table[lb + 49] + (wg - _table[lb + 49]) * shoreS;
      wb = _table[lb + 50] + (wb - _table[lb + 50]) * shoreS;
    }
    // own fog (distance dW, x the pitched fog scale)
    let fd = dW;
    if (pitched) { // == pitchedFogScale (inlined)
      let fsc = pterms.cosP;
      if (!pterms.ortho) { const kk = pterms.cosP - (1 - (2 * row) / pterms.rows) * pterms.tanHalfY * pterms.sinP; fsc = kk > 0 ? kk : 0; }
      fd = dW * fsc;
    }
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
    if (!opaque && !shore && !isSky && !sheet && sunUp && _fin[fb8] > 0 && column < _fin[fb8 + 1] && causticAt(fb8)) {
      glyph = _fin[fb8 + 5]; // WATER-FINISH-01a (38.77 B): shallow caustic flicker on the see-through bed
      const kc = k * (1 - a);
      fr += _fin[fb8 + 2] * kc; fg += _fin[fb8 + 3] * kc; fb2 += _fin[fb8 + 4] * kc;
    }
    gArr[i] = glyph;
    fgArr[fi] = byte(fr); fgArr[fi + 1] = byte(fg); fgArr[fi + 2] = byte(fb2); fgArr[fi + 3] = glyph;
    bgArr[fi] = byte(br); bgArr[fi + 1] = byte(bg); bgArr[fi + 2] = byte(bb); bgArr[fi + 3] = 255;
    if (mArr) mArr[i] = 1;
  }
}
