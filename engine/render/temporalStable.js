// @ts-check
// engine/render/temporalStable.js - US-073a (docs/architecture.md 38.25): the pitched/ortho JS twin of the future
// WGSL `stable` pass (073b/073c). `stable.js` (shear-only) stays untouched until ME-19d.
//
// Per frame: `beginFrame(st, cam, grid, flags)` builds the camera terms + the history-validity decision; then
// `stabilize(inp, hist, out, st)` reprojects every cell into the previous camera and applies the integer rules.
// Reprojection is eye-relative f64: P - eyePrev = dEye + vd*dirCur (both term sets re-centred on eye 0, dEye added),
// using the real `unprojectPitched` / `worldToCell`. History cell = floor(x + 0.5) (never round-half-even).
// Integer rules: |c-p| > CHANNEL_SNAP ? c : (p + c + 1) >> 1 per byte; glyph held while |lvC - lvP| <= 1.
// Always-fresh cells: sky (kind 0), kind 8, water, edge, level 254 (animated, either side), mixed 255/ramp, kind/planeId mismatch, UV drift.
// 38.25 amendment: UV drift limit = 1.0/detail; both-sides-255 cells blend colours and hold the glyph unless the fg snapped (anchor u/v kept).
// Zero allocation per frame once `createStableState()` and the buffers exist.

import { createPitchedTerms, pitchedTerms, unprojectPitched, worldToCell } from './projection.js';
import { KIND_NONE, KIND_MODEL, KIND_MESH } from './GBuffer.js';

/** Per-channel snap threshold (0-255): bigger jumps skip the blend. */
export const CHANNEL_SNAP = 48;
/** Default material texel density when `inp.detail` is omitted. */
export const DEFAULT_DETAIL = 16;
/** Auto-cut distance (m) and angle (deg): beyond either, history is off for the frame. */
export const CUT_DIST_M = 2;
export const CUT_ANGLE_DEG = 3;
/** Level byte meaning "no ramp glyph / passthrough". */
export const LEVEL_NONE = 255;
/** Level byte meaning "animated glyph, never hold" (shade's terrain shimmer branch). Ramp levels stay < 254. */
export const LEVEL_ANIM = 254;
/** UV drift limit in texels-of-1/detail units (38.25 amendment B). */
export const UV_LIM_TEXELS = 1.0;
/** OB-193: the UV drift limit also scales with the cell's own world footprint (x this); a nearest-cell reprojection error is up to ~0.7 cell, so a fixed 1/detail limit (6 cm) rejected history on every wall farther than ~2 m at grid 400 -> the texel hash re-rolled each frame (glyph crawl). */
export const STABLE_FOOT_K = 1.0;
/** AA-07a: the view model's objectId range (raster.wgsl.js: 0xFFFF - handIndex, GI.w). */
export const VM_ID_MIN = 0xFFF8;
/** History tag of a cell: 0 = not a view-model cell, else 1 + (0xFFFF - objectId) (1..8, fits 4 bits of the GPU history word). */
export function vmTagOf(objectId) { return (objectId >= VM_ID_MIN && objectId <= 0xFFFF) ? (0xFFFF - objectId) + 1 : 0; }
/**
 * AA-07b: the shade pass's level byte carries the joint coverage (quarters) in spare bits. 254 = animated, 255 = none (no coverage),
 * bit 7 set = line cell (level none) with coverage in bits 5-6, else level in bits 0-4 and coverage in bits 5-6 (0 = 0/4 or 4/4: no info).
 * @param {number} level 0..31 ramp level, 255 = none @param {number} covQ coverage in quarters 0..4 @param {boolean} isLine
 */
export function encodeLevelByte(level, covQ, isLine) {
  if (covQ < 1 || covQ > 3) return level;
  if (level === 255) return isLine ? (0x80 | (covQ << 5)) : 255;
  return level < 32 ? (level | (covQ << 5)) : level;
}
/** @returns {number} the level of an encoded level byte (255 = none, 254 = animated) */
export function levelOfByte(b) { return b >= 254 ? b : (b & 0x80) ? 255 : (b & 31); }
/** @returns {number} the joint coverage in quarters (1..3) of an encoded level byte, 0 = unknown / 0/4 / 4/4 */
export function covOfByte(b) { return b >= 254 ? 0 : (b >> 5) & 3; }
const TIE_EPS_CELL = 1e-3;
const TIE_EPS_UV = 1e-4;

/**
 * @typedef {Object} StableInput  this frame's fresh cells
 * @property {number} cols
 * @property {number} rows
 * @property {Uint8Array} kind
 * @property {Uint16Array} [mat] - material id (AA-04a: carried into history for resolve hysteresis; absent = 0)
 * @property {Int32Array} planeId
 * @property {Uint16Array} [mat] - OB-198: material id (GI.y >> 16); absent = 0
 * @property {Uint32Array} [objectId] - AA-07a: GI.w; absent = no view model
 * @property {Uint8Array} [cov] - AA-07b: joint coverage in quarters (1..3 = mixed); absent = 0
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Float32Array} vd- view depth per cell (GPU: f32 bits in the depth target)
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
 * @property {Uint16Array} [mat] - OB-198: material id (GI.y >> 16); absent = 0
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Uint8Array} level
 * @property {Uint8Array|Uint16Array} glyph
 * @property {Uint32Array} fg
 * @property {Uint32Array} bg
 */

/** UV drift limit (m) of one cell: max(1/detail, STABLE_FOOT_K * larger cell side at depth vd); ortho keeps the texel limit. Twin: stable.wgsl.js. */
export function uvDriftLimit(vd, tanHalfX, tanHalfY, cols, rows, detail, ortho, footK = STABLE_FOOT_K) {
  const lim = UV_LIM_TEXELS / detail;
  if (ortho) return lim;
  const foot = footK * vd * 2 * Math.max(tanHalfX / cols, tanHalfY / rows);
  return foot > lim ? foot : lim;
}

/** Allocates the buffers of one history/output set (ping-pong two of these). */
export function createStableBuffers(cols, rows) {
  const n = cols * rows;
  return {
    cols, rows,
    kind: new Uint8Array(n), planeId: new Int32Array(n), mat: new Uint16Array(n), vm: new Uint8Array(n), // vm: AA-07a view-model tag
    u: new Float32Array(n), v: new Float32Array(n),
    level: new Uint8Array(n), glyph: new Uint16Array(n),
    fg: new Uint32Array(n), bg: new Uint32Array(n),
    tie: new Uint8Array(n), // output only: 1 = half-cell / half-texel case where f32 may differ from f64
    fresh: new Uint8Array(n), // output only: 1 = cell took no history
    hsrc: new Int32Array(n), // output only: history cell index the cell reprojected to (-1 = none), set before the kind/plane reject
    held255: new Uint8Array(n), // output only: 1 = both-255 glyph held (STABLE-LEVEL255-01)
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
    aaGlyph: true, // OB-198 (1): glyph hysteresis +-1 level (off = hold only at equal level); ?aaglyph=0
    aaMesh: true, // OB-198 (2): KIND_MESH history survives a planeId change when the material matches; ?aamesh=0
    aaVm: true, // AA-07a: kind-8 models take history (view model: same cell, key objectId+mat; world props: material key + reprojection); ?aavm=0
    aaAnchor: true, // AA-09: a both-255 hold of a static surface re-anchors (writes the CURRENT u/v) so cumulative drift cannot re-roll it; ?aaanchor=0
    aaEdge: true, // AA-18 (OB-208): edge cells (final != shade) take history like any cell (glyph hold) instead of passing through; ?aaedge=0
    aaJoint: true, // AA-07b: a line<->ramp mismatch holds the history glyph while the joint coverage is 1/4..3/4; ?aajoint=0
    footK: STABLE_FOOT_K, // tests may set 0 to isolate the texel limit
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
      const vmTag = (st.aaVm && kind === KIND_MODEL && inp.objectId) ? vmTagOf(inp.objectId[i]) : 0;
      out.kind[i] = kind; out.vm[i] = vmTag; out.planeId[i] = inp.planeId[i]; out.mat[i] = inp.mat ? inp.mat[i] : 0; out.u[i] = inp.u[i]; out.v[i] = inp.v[i];
      out.level[i] = lvC; out.glyph[i] = inp.glyph[i]; out.fg[i] = inp.fg[i]; out.bg[i] = inp.bg[i];
      out.tie[i] = 0; out.fresh[i] = 1; out.hsrc[i] = -1; out.held255[i] = 0;
      if (!valid) continue;
      if (kind === KIND_NONE || (kind === KIND_MODEL && !st.aaVm) || lvC === LEVEL_ANIM) continue;
      if (inp.edge && inp.edge[i] && !st.aaEdge) continue; // AA-18: with aaEdge an outline appearing on a kept surface holds the history glyph (the disappearing side already did)
      if (inp.water && inp.water[i]) continue;
      const vd = inp.vd[i];
      if (!(vd > 0) || !Number.isFinite(vd)) continue;

      let h;
      if (vmTag !== 0) {
        h = i; out.hsrc[i] = h; // AA-07a: the view model is camera-attached, its history is the SAME cell (no reprojection, no tie)
      } else {
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
        h = hr * cols + hc;
        out.hsrc[i] = h;
      }

      if (hist.kind[h] !== kind) continue;
      if ((hist.vm ? hist.vm[h] : 0) !== vmTag) continue; // view-model key = objectId (+ mat below); a different object drops the history
      const matSame = (hist.mat ? hist.mat[h] : 0) === (inp.mat ? inp.mat[i] : 0);
      if (vmTag !== 0) {
        if (!matSame) continue;
      } else if (hist.planeId[h] !== inp.planeId[i]) {
        // OB-198 (2): mesh planeIds flip almost every step; the material is the stable key (the UV drift limit below still guards)
        // AA-07a: same for world kind-8 props
        if (!(matSame && ((st.aaMesh && kind === KIND_MESH) || (st.aaVm && kind === KIND_MODEL)))) continue;
      }
      const lvP = hist.level[h];
      if (lvP === LEVEL_ANIM) continue;
      const c255 = lvC === LEVEL_NONE, p255 = lvP === LEVEL_NONE;
      // AA-07b: a line<->ramp mismatch on a cell with joint coverage 1/4..3/4 is the 50 pct joint vote flipping: hold the history glyph
      const jointHold = c255 !== p255 && st.aaJoint && inp.cov && inp.cov[i] >= 1 && inp.cov[i] <= 3;
      if (c255 !== p255 && !jointHold) continue; // mixed ramp/non-ramp: a real pattern edge, always fresh
      if (vmTag === 0) {
        const detail = (inp.detail ? inp.detail[i] : 0) || DEFAULT_DETAIL;
        const du = inp.u[i] - hist.u[h], dv = inp.v[i] - hist.v[h];
        const dUV = Math.sqrt(du * du + dv * dv);
        const lim = uvDriftLimit(vd, relCur.tanHalfX, relCur.tanHalfY, cols, rows, detail, ortho, st.footK);
        if (Math.abs(dUV - lim) < TIE_EPS_UV) out.tie[i] = 1;
        if (dUV >= lim) continue;
      }

      out.fresh[i] = 0; used++;
      out.fg[i] = blend(hist.fg[h], inp.fg[i]);
      out.bg[i] = blend(hist.bg[h], inp.bg[i]);
      if (jointHold) { out.glyph[i] = hist.glyph[h]; out.level[i] = lvP; continue; }
      if (c255) {
        // both sides non-ramp: hold the texture glyph unless the fg snapped (light/door/flash re-rolls the cell); keep the history's anchor u/v
        const a = hist.fg[h], b = inp.fg[i];
        const snapped = Math.abs(((b >> 16) & 255) - ((a >> 16) & 255)) > CHANNEL_SNAP || Math.abs(((b >> 8) & 255) - ((a >> 8) & 255)) > CHANNEL_SNAP
          || Math.abs((b & 255) - (a & 255)) > CHANNEL_SNAP;
        if (!snapped) {
          out.glyph[i] = hist.glyph[h]; out.held255[i] = 1;
          // AA-09: static surface (same planeId, mesh also same material, not a model) re-anchors: keep the CURRENT u/v already in out; else the old history anchor
          const reAnchor = st.aaAnchor && vmTag === 0 && kind !== KIND_MODEL && hist.planeId[h] === inp.planeId[i] && (kind !== KIND_MESH || matSame);
          if (!reAnchor) { out.u[i] = hist.u[h]; out.v[i] = hist.v[h]; }
        }
        continue;
      }
      const hold = st.aaGlyph ? Math.abs(lvC - lvP) <= 1 : lvC === lvP;
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

// ---- AA-04b (38.82): f32 twin of common.wgsl.js reprojectCell, used by the resolve hysteresis (the stable twin above stays f64) ----
const F = Math.fround;
function terms32(t) {
  return [t.fX, t.fY, t.fZ, t.tanHalfX, t.rX, t.rY, t.uX, t.uY, t.uZ, t.tanHalfY].map(F);
}
/** f32 camera words (what packStableUniforms writes) from a twin state after `beginFrame`: {cur[10], prev[10], dEye[3], cols, rows, ortho}. */
export function stableTerms32(st, cols, rows) {
  return { cur: terms32(st.cur), prev: terms32(st.prev), dEye: [F(st.dEx), F(st.dEy), F(st.dEz)], cols, rows, ortho: st.cur.ortho === 1 ? 1 : 0 };
}
/**
 * f32 line-by-line twin of reprojectCell (common.wgsl.js). Writes (colF, rowF, vdPrev) into `out` (length >= 3).
 * Term order in cur/prev: fX fY fZ tanHalfX | rX rY uX uY | uZ tanHalfY.
 */
export function reprojectF32(T, col, row, vd, out) {
  const c = T.cur, p = T.prev, e = T.dEye, colsF = F(T.cols), rowsF = F(T.rows);
  vd = F(vd);
  const a = F(F(F(F(2) * F(F(col) + 0.5)) / colsF - 1) * c[3]);
  const b = F(F(1 - F(F(2) * F(row)) / rowsF) * c[9]);
  let px, py, pz;
  if (T.ortho === 1) {
    px = F(F(F(a * c[4]) + F(b * c[6])) + F(vd * c[0]));
    py = F(F(F(a * c[5]) + F(b * c[7])) + F(vd * c[1]));
    pz = F(F(b * c[8]) + F(vd * c[2]));
  } else {
    px = F(F(F(c[0] + F(a * c[4])) + F(b * c[6])) * vd);
    py = F(F(F(c[1] + F(a * c[5])) + F(b * c[7])) * vd);
    pz = F(F(c[2] + F(b * c[8])) * vd);
  }
  const wx = F(px + e[0]), wy = F(py + e[1]), wz = F(pz + e[2]);
  const vdP = F(F(F(wx * p[0]) + F(wy * p[1])) + F(wz * p[2]));
  const vx = F(F(wx * p[4]) + F(wy * p[5]));
  const vy = F(F(F(wx * p[6]) + F(wy * p[7])) + F(wz * p[8]));
  let cf = 0, rf = 0;
  if (T.ortho === 1) {
    cf = F(F(F(vx / p[3]) + 1) * F(colsF * 0.5)) - 0.5; cf = F(cf);
    rf = F(F(1 - F(vy / p[9])) * F(rowsF * 0.5));
  } else if (vdP > 0) {
    cf = F(F(F(F(vx / vdP) / p[3]) + 1) * F(colsF * 0.5)); cf = F(cf - 0.5);
    rf = F(F(1 - F(F(vy / vdP) / p[9])) * F(rowsF * 0.5));
  }
  out[0] = cf; out[1] = rf; out[2] = vdP;
  return out;
}
