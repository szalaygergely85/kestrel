// @ts-check
// engine/render/temporalStable.js - US-073a (docs/architecture.md 38.25): the pitched/ortho JS twin of the future
// WGSL `stable` pass (073b/073c). `stable.js` (shear-only) stays untouched until ME-19d.
//
// Per frame: `beginFrame(st, cam, grid, flags)` builds the camera terms + the history-validity decision; then
// `stabilize(inp, hist, out, st)` reprojects every cell into the previous camera and applies the integer rules.
// Reprojection is eye-relative f64: P - eyePrev = dEye + vd*dirCur (both term sets re-centred on eye 0, dEye added),
// using the real `unprojectPitched` / `worldToCell`. History cell = floor(x + 0.5) (never round-half-even).
// Integer rules: |c-p| > CHANNEL_SNAP ? c : (p + c + 1) >> 1 per byte; glyph held while |lvC - lvP| <= 1.
// Always-fresh cells: sky (kind 0), kind 8, water, edge, level 255 (either side), kind/planeId mismatch, UV drift.
// Zero allocation per frame once `createStableState()` and the buffers exist.

import { createPitchedTerms, pitchedTerms, unprojectPitched, worldToCell } from './projection.js';
import { KIND_NONE, KIND_MODEL } from './GBuffer.js';

/** Per-channel snap threshold (0-255): bigger jumps skip the blend. */
export const CHANNEL_SNAP = 48;
/** Default material texel density when `inp.detail` is omitted. */
export const DEFAULT_DETAIL = 16;
/** Auto-cut distance (m) and angle (deg): beyond either, history is off for the frame. */
export const CUT_DIST_M = 2;
export const CUT_ANGLE_DEG = 3;
/** Level byte meaning "no ramp glyph / passthrough". */
export const LEVEL_NONE = 255;
const TIE_EPS_CELL = 1e-3;
const TIE_EPS_UV = 1e-4;

/**
 * @typedef {Object} StableInput  this frame's fresh cells
 * @property {number} cols
 * @property {number} rows
 * @property {Uint8Array} kind
 * @property {Int32Array} planeId
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Float32Array} vd - view depth per cell (GPU: f32 bits in the depth target)
 * @property {Uint8Array} level - ramp level, 255 = none
 * @property {Uint8Array|Uint16Array} glyph
 * @property {Uint32Array} fg - packed 0xRRGGBB (final, after edge)
 * @property {Uint32Array} bg
 * @property {Uint8Array} [edge] - 1 = edge cell (final != shade): passed through
 * @property {Uint8Array} [water] - 1 = water-layer cell: always fresh
 * @property {Float32Array} [detail]
 */
/**
 * @typedef {Object} StableHist  last frame's output (also the shape of StableOut minus `tie`)
 * @property {Uint8Array} kind
 * @property {Int32Array} planeId
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Uint8Array} level
 * @property {Uint8Array|Uint16Array} glyph
 * @property {Uint32Array} fg
 * @property {Uint32Array} bg
 */

/** Allocates the buffers of one history/output set (ping-pong two of these). */
export function createStableBuffers(cols, rows) {
  const n = cols * rows;
  return {
    cols, rows,
    kind: new Uint8Array(n), planeId: new Int32Array(n),
    u: new Float32Array(n), v: new Float32Array(n),
    level: new Uint8Array(n), glyph: new Uint16Array(n),
    fg: new Uint32Array(n), bg: new Uint32Array(n),
    tie: new Uint8Array(n), // output only: 1 = half-cell / half-texel case where f32 may differ from f64
    fresh: new Uint8Array(n), // output only: 1 = cell took no history
  };
}

/** Persistent per-pass state (all terms preallocated). */
export function createStableState() {
  return {
    cur: createPitchedTerms(), prev: createPitchedTerms(),
    relCur: createPitchedTerms(), relPrev: createPitchedTerms(),
    dEx: 0, dEy: 0, dEz: 0,
    hasPrev: false,
    histValid: false,
    _pcell: new Float64Array(3), _pw: new Float64Array(3), _pc: new Float64Array(3),
  };
}

function copyTerms(d, s) {
  d.projection = s.projection; d.near = s.near; d.cols = s.cols; d.rows = s.rows; d.aspect = s.aspect;
  d.eyeX = s.eyeX; d.eyeY = s.eyeY; d.eyeZ = s.eyeZ;
  d.fX = s.fX; d.fY = s.fY; d.fZ = s.fZ; d.rX = s.rX; d.rY = s.rY;
  d.uX = s.uX; d.uY = s.uY; d.uZ = s.uZ;
  d.tanHalfX = s.tanHalfX; d.tanHalfY = s.tanHalfY;
  d.yawDeg = s.yawDeg; d.pitchDeg = s.pitchDeg; d.vfovDeg = s.vfovDeg; d.cosP = s.cosP; d.sinP = s.sinP;
  d.ortho = s.ortho; d.halfW = s.halfW; d.halfH = s.halfH;
}

function angDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360; else if (d < -180) d += 360;
  return Math.abs(d);
}

/**
 * Advances the camera terms (prev <- cur, cur <- cam) and decides `st.histValid`.
 * @param {ReturnType<typeof createStableState>} st
 * @param {object} cam - pitched/ortho cam ({x,y,z,yawDeg,pitchDeg,...})
 * @param {{cols:number,rows:number,pxCellW?:number,pxCellH?:number}} grid - the REAL grid (pxCellW/pxCellH)
 * @param {{invalidate?:boolean}} [flags] - invalidate: resize, quality change, cells not shaded, debug mode, teleport/cut, world load, enable
 * @param {object} [terms] - optional precomputed `pitchedTerms(cam, grid)` of this frame (device pass: skips the recompute and the twin-only eye-relative sets)
 */
export function beginFrame(st, cam, grid, flags, terms) {
  const t = st.prev; st.prev = st.cur; st.cur = t; // swap, no alloc
  // US-073c: the device pass hands in the terms the raster pass already built this frame (same cam + grid): copying them is
  // allocation-free, a second pitchedTerms call boxes ~48 B of doubles per frame (PITCHED-ALLOC) and the GPU path never needs relCur/relPrev.
  if (terms) copyTerms(st.cur, terms); else pitchedTerms(cam, grid, st.cur);
  const c = st.cur, p = st.prev;
  let valid = st.hasPrev && !(flags && flags.invalidate);
  if (valid && (c.cols !== p.cols || c.rows !== p.rows || c.ortho !== p.ortho
    || (c.ortho && c.halfH !== p.halfH))) valid = false;
  st.dEx = c.eyeX - p.eyeX; st.dEy = c.eyeY - p.eyeY; st.dEz = c.eyeZ - p.eyeZ;
  if (valid) {
    const d2 = st.dEx * st.dEx + st.dEy * st.dEy + st.dEz * st.dEz;
    // ortho eyes are 500 m back; the shift between frames is still the real camera move, so the same rule applies
    if (d2 > CUT_DIST_M * CUT_DIST_M
      || angDelta(p.yawDeg, c.yawDeg) > CUT_ANGLE_DEG || Math.abs(c.pitchDeg - p.pitchDeg) > CUT_ANGLE_DEG) valid = false;
  }
  st.hasPrev = true;
  st.histValid = valid;
  if (terms) return valid; // device path: the WGSL pass takes the basis vectors and dEye from st.cur/st.prev
  // eye-relative term sets (eye = 0); dEye is added to the unprojected point
  copyTerms(st.relCur, c); st.relCur.eyeX = 0; st.relCur.eyeY = 0; st.relCur.eyeZ = 0;
  copyTerms(st.relPrev, p); st.relPrev.eyeX = 0; st.relPrev.eyeY = 0; st.relPrev.eyeZ = 0;
  return valid;
}

function blend(pk, ck) {
  const pr = (pk >> 16) & 255, pg = (pk >> 8) & 255, pb = pk & 255;
  const cr = (ck >> 16) & 255, cg = (ck >> 8) & 255, cb = ck & 255;
  const r = Math.abs(cr - pr) > CHANNEL_SNAP ? cr : (pr + cr + 1) >> 1;
  const g = Math.abs(cg - pg) > CHANNEL_SNAP ? cg : (pg + cg + 1) >> 1;
  const b = Math.abs(cb - pb) > CHANNEL_SNAP ? cb : (pb + cb + 1) >> 1;
  return (r << 16) | (g << 8) | b;
}

/**
 * @param {StableInput} inp
 * @param {StableHist} hist - last frame's output (ignored when !st.histValid)
 * @param {ReturnType<typeof createStableBuffers>} out - also next frame's history; must not alias `hist`
 * @param {ReturnType<typeof createStableState>} st - after `beginFrame`
 * @returns {number} count of cells that took history
 */
export function stabilize(inp, hist, out, st) {
  const cols = inp.cols, rows = inp.rows, n = cols * rows;
  const valid = st.histValid;
  const w = st._pw, pc = st._pc;
  const dEx = st.dEx, dEy = st.dEy, dEz = st.dEz;
  const relCur = st.relCur, relPrev = st.relPrev;
  const ortho = relCur.ortho === 1;
  let used = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      // fresh by default; hist fields always describe THIS frame for the next one
      const kind = inp.kind[i], lvC = inp.level[i];
      out.kind[i] = kind; out.planeId[i] = inp.planeId[i]; out.u[i] = inp.u[i]; out.v[i] = inp.v[i];
      out.level[i] = lvC; out.glyph[i] = inp.glyph[i]; out.fg[i] = inp.fg[i]; out.bg[i] = inp.bg[i];
      out.tie[i] = 0; out.fresh[i] = 1;
      if (!valid) continue;
      if (kind === KIND_NONE || kind === KIND_MODEL || lvC === LEVEL_NONE) continue;
      if (inp.edge && inp.edge[i]) continue;
      if (inp.water && inp.water[i]) continue;
      const vd = inp.vd[i];
      if (!(vd > 0) || !Number.isFinite(vd)) continue;

      unprojectPitched(relCur, col, row, vd, w);
      w[0] += dEx; w[1] += dEy; w[2] += dEz;
      worldToCell(relPrev, w[0], w[1], w[2], pc);
      if (!ortho && pc[2] <= 0) continue;
      const colF = pc[0], rowF = pc[1];
      // tie mask (US-073b): set as soon as the cell reaches the history lookup, so a later reject made on a history cell that f32 may
      // pick differently (half-cell case) is still marked; the UV-drift tie is added below
      const fc = colF - Math.floor(colF), fr = rowF - Math.floor(rowF);
      if (Math.abs(fc - 0.5) < TIE_EPS_CELL || Math.abs(fr - 0.5) < TIE_EPS_CELL) out.tie[i] = 1;
      const hc = Math.floor(colF + 0.5), hr = Math.floor(rowF + 0.5);
      if (!(hc >= 0 && hc < cols && hr >= 0 && hr < rows)) continue;
      const h = hr * cols + hc;

      if (hist.kind[h] !== kind || hist.planeId[h] !== inp.planeId[i]) continue;
      const lvP = hist.level[h];
      if (lvP === LEVEL_NONE) continue;
      const detail = (inp.detail ? inp.detail[i] : 0) || DEFAULT_DETAIL;
      const du = inp.u[i] - hist.u[h], dv = inp.v[i] - hist.v[h];
      const dUV = Math.sqrt(du * du + dv * dv);
      const lim = 0.5 / detail;
      if (Math.abs(dUV - lim) < TIE_EPS_UV) out.tie[i] = 1;
      if (dUV >= lim) continue;

      out.fresh[i] = 0; used++;
      out.fg[i] = blend(hist.fg[h], inp.fg[i]);
      out.bg[i] = blend(hist.bg[h], inp.bg[i]);
      const hold = Math.abs(lvC - lvP) <= 1;
      if (hold) { out.glyph[i] = hist.glyph[h]; out.level[i] = lvP; }
    }
  }
  return used;
}

// --- US-073b: adapters from what the GPU actually has to the twin's per-cell input shapes (38.25 item 3) ---

/**
 * Edge mask as the WGSL pass sees it: a cell is an edge cell when the edge pass changed it, i.e. final != shade
 * (any of fg r/g/b, bg r/g/b, or the glyph). Inputs are packed 0xRRGGBB + glyph byte of both layers.
 * @param {Uint32Array} finalFg @param {Uint32Array} finalBg @param {ArrayLike<number>} finalGlyph
 * @param {Uint32Array} shadeFg @param {Uint32Array} shadeBg @param {ArrayLike<number>} shadeGlyph
 * @param {Uint8Array} out
 */
export function edgeMaskFromShade(finalFg, finalBg, finalGlyph, shadeFg, shadeBg, shadeGlyph, out) {
  for (let i = 0; i < out.length; i++) {
    out[i] = (finalFg[i] !== shadeFg[i] || finalBg[i] !== shadeBg[i] || finalGlyph[i] !== shadeGlyph[i]) ? 1 : 0;
  }
  return out;
}

/** Water mask as the WGSL pass sees it: the layer word holds a finite vD (x bits != +Inf) and is not flagged (bit 5 of w). */
export function waterMaskFromLayer(layerX, layerW, out) {
  for (let i = 0; i < out.length; i++) out[i] = (layerX[i] !== 0x7f800000 && (layerW[i] & 32) === 0) ? 1 : 0;
  return out;
}
