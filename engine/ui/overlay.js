// engine/ui/overlay.js (RE-07a, docs/architecture.md 28.9). World-anchored RTS marks
// (ground ring, health-bar row, screen rect) rasterised in JS into a scene-grid layer
// (`ovl` rgb+glyph, `ovlZ` ref depth), then a depth-tested composite into the scene
// CellBuffer (glyph + fg only; bg and mask untouched). RE-07b adds the GPU composite that
// reads the very same layer, so which cells get a glyph is decided here by construction.
//
// Ops are numbers only (style = int id from `styleId`), recorded into one preallocated
// Float64Array; all work happens in `flush`. No allocation after `createOverlay`.
import { frameMatrix, projectPoint, PROJ_NEAR } from '../render/projection.js';

export const OVL_MAX_OPS = 1024;
export const OVL_MAX_TOUCHED = 16384;
export const OVL_MAX_STYLES = 64;
export const OVL_BIAS_M = 0.25;
export const OVL_BIAS_REL = 0.01;
export const OVL_RING_LIFT = 0.05;
export const OVL_RING_SAMPLES = 24;

function ov_empty8() { return new Uint8Array(0); }
function ov_emptyF() { return new Float32Array(0); }
const OP_RING = 1, OP_BAR = 2, OP_RECT = 3, OPW = 8;
const RING_COS = new Float64Array(OVL_RING_SAMPLES), RING_SIN = new Float64Array(OVL_RING_SAMPLES);
for (let k = 0; k < OVL_RING_SAMPLES; k++) { RING_COS[k] = Math.cos((k / OVL_RING_SAMPLES) * Math.PI * 2); RING_SIN[k] = Math.sin((k / OVL_RING_SAMPLES) * Math.PI * 2); }
// Segment-slope glyph slots of a style: horizontal, vertical, down-right, up-right.
const G_H = 0, G_V = 1, G_DR = 2, G_UR = 3;

/**
 * Creates the overlay (record ops with ring/bar/rect, then flush / renderCpu once per frame).
 * Layer arrays `ovl`, `ovlZ`, `touched` and the dirty-row span are the RE-07b GPU seam.
 * @param {number} [cols]
 * @param {number} [rows]
 * @returns {any}
 */
export function createOverlay(cols = 0, rows = 0) {
  const ops = new Float64Array(OVL_MAX_OPS * OPW);
  const styleGlyph = new Uint8Array(OVL_MAX_STYLES * 4); // glyph indices (char code - 32)
  const styleRgb = new Uint8Array(OVL_MAX_STYLES * 3);
  const touched = new Int32Array(OVL_MAX_TOUCHED);
  const M = new Float64Array(16);
  const p4 = new Float64Array(4);
  const grid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
  let keyToId = new Map();
  let nStyles = 0;
  let nOps = 0, nTouched = 0;
  let groundFn = null;
  let Lcols = 0, Lrows = 0, Lovl = ov_empty8(), LovlZ = ov_emptyF(); // closure copies of the layer (hot path)
  const rc = new Float64Array(OVL_RING_SAMPLES * 3); // ring scratch: cell col, row, ref per sample

  const ov = {
    cols: 0, rows: 0,
    ovl: new Uint8Array(0), ovlZ: new Float32Array(0),
    touched, // first `stats.cells` entries are valid
    // RE-07b seam: dirty row span = union of this frame's and last frame's touched rows.
    minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1,
    stats: { ops: 0, dropped: 0, cells: 0 },
    styleGlyph, styleRgb,

    /** @param {Object} styles {key: {glyph | glyphs(4 chars: - | \ /), fg:[r,g,b]}} */
    setStyles(styles) {
      keyToId = new Map(); nStyles = 0;
      for (const key of Object.keys(styles)) {
        const s = styles[key];
        if (nStyles >= OVL_MAX_STYLES) throw new Error('overlay.setStyles: too many styles');
        const g = s.glyphs || (s.glyph + s.glyph + s.glyph + s.glyph);
        if (typeof g !== 'string' || g.length !== 4) throw new Error(`overlay style '${key}': glyph/glyphs invalid`);
        for (let k = 0; k < 4; k++) {
          const code = g.charCodeAt(k);
          if (code <= 32 || code > 126) throw new Error(`overlay style '${key}': glyph must be printable and not a space`);
          styleGlyph[nStyles * 4 + k] = code - 32;
        }
        styleRgb[nStyles * 3] = s.fg[0]; styleRgb[nStyles * 3 + 1] = s.fg[1]; styleRgb[nStyles * 3 + 2] = s.fg[2];
        keyToId.set(key, nStyles++);
      }
    },
    /** Once at load; throws on an unknown key. */
    styleId(key) {
      const id = keyToId.get(key);
      if (id === undefined) throw new Error(`overlay.styleId: unknown style '${key}'`);
      return id;
    },
    /** (Re)allocates the layer for a scene grid (engine grid:changed). */
    bind(c, r, pxW = 1, pxH = 1) {
      ov.cols = c; ov.rows = r; grid.cols = c; grid.rows = r; grid.pxCellW = pxW; grid.pxCellH = pxH;
      ov.ovl = new Uint8Array(c * r * 4); ov.ovlZ = new Float32Array(c * r);
      Lcols = c; Lrows = r; Lovl = ov.ovl; LovlZ = ov.ovlZ;
      nTouched = 0; ov.stats.cells = 0; ov.minRow = 0; ov.maxRow = -1; ov.prevMinRow = 0; ov.prevMaxRow = -1;
    },
    clear() { nOps = 0; ov.stats.ops = 0; ov.stats.dropped = 0; },
    setGroundFn(fn) { groundFn = fn; },

    ring(x, y, z, r, style) {
      if (nOps >= OVL_MAX_OPS) { ov.stats.dropped++; return; }
      const o = nOps * OPW;
      ops[o] = OP_RING; ops[o + 1] = style; ops[o + 2] = x; ops[o + 3] = y; ops[o + 4] = z; ops[o + 5] = r;
      nOps++; ov.stats.ops = nOps;
    },
    bar(x, y, z, frac, width, style, emptyStyle) {
      if (nOps >= OVL_MAX_OPS) { ov.stats.dropped++; return; }
      const o = nOps * OPW;
      ops[o] = OP_BAR; ops[o + 1] = style; ops[o + 2] = x; ops[o + 3] = y; ops[o + 4] = z;
      ops[o + 5] = frac; ops[o + 6] = width; ops[o + 7] = emptyStyle;
      nOps++; ov.stats.ops = nOps;
    },
    rect(c0, r0, c1, r1, style) {
      if (nOps >= OVL_MAX_OPS) { ov.stats.dropped++; return; }
      const o = nOps * OPW;
      ops[o] = OP_RECT; ops[o + 1] = style;
      ops[o + 2] = c0 < c1 ? c0 : c1; ops[o + 3] = r0 < r1 ? r0 : r1;
      ops[o + 4] = c0 < c1 ? c1 : c0; ops[o + 5] = r0 < r1 ? r1 : r0;
      nOps++; ov.stats.ops = nOps;
    },

    /** Rasterises this frame's ops into the layer (wipes last frame's cells first). */
    flush(cam, c, r) {
      if (c !== undefined && (c !== ov.cols || r !== ov.rows)) ov.bind(c, /** @type {number} */ (r), grid.pxCellW, grid.pxCellH);
      const cols = ov.cols, rows = ov.rows;
      const ovl = ov.ovl, ovlZ = ov.ovlZ;
      let pMin = rows, pMax = -1;
      for (let t = 0; t < nTouched; t++) {
        const i = touched[t];
        ovl[i * 4 + 3] = 0; ovlZ[i] = 0;
        const row = (i / cols) | 0;
        if (row < pMin) pMin = row;
        if (row > pMax) pMax = row;
      }
      ov.prevMinRow = pMin; ov.prevMaxRow = pMax;
      nTouched = 0;
      let minRow = rows, maxRow = -1;
      if (nOps > 0) {
        frameMatrix(cam, grid, M);
        for (let k = 0; k < nOps; k++) {
          const o = k * OPW, type = ops[o], style = ops[o + 1] | 0;
          if (type === OP_RING) rasterRing(ops[o + 2], ops[o + 3], ops[o + 4], ops[o + 5], style);
          else if (type === OP_BAR) rasterBar(ops[o + 2], ops[o + 3], ops[o + 4], ops[o + 5], ops[o + 6] | 0, style, ops[o + 7] | 0);
          else rasterRect(ops[o + 2] | 0, ops[o + 3] | 0, ops[o + 4] | 0, ops[o + 5] | 0, style);
        }
        for (let t = 0; t < nTouched; t++) {
          const row = (touched[t] / cols) | 0;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
        }
      }
      ov.minRow = minRow; ov.maxRow = maxRow;
      ov.stats.cells = nTouched;
    },

    /** CPU path: flush + depth-tested composite into `cells` (a CellBuffer). No ops and nothing to wipe -> no work. */
    renderCpu(cam, cells, depth) {
      if (nOps === 0 && nTouched === 0) return;
      ov.flush(cam, cells.cols, cells.rows);
      applyOverlay(ov, cells, depth);
    },
  };

  /** Write rule (28.9 item 5): empty | screen op over non-screen | nearer ref. Ties: first wins. */
  function put(c, r, glyph, style, ref) {
    if (c < 0 || r < 0 || c >= Lcols || r >= Lrows) return;
    const i = r * Lcols + c;
    ref = Math.fround(ref); // compare at layer precision (ties stay ties)
    if (Lovl[i * 4 + 3] !== 0) {
      const cur = LovlZ[i];
      const win = ref === 0 ? cur !== 0 : (cur !== 0 && ref < cur);
      if (!win) return;
    } else {
      if (nTouched >= OVL_MAX_TOUCHED) { ov.stats.dropped++; return; }
      touched[nTouched++] = i;
    }
    const s3 = style * 3, i4 = i * 4;
    Lovl[i4] = styleRgb[s3]; Lovl[i4 + 1] = styleRgb[s3 + 1]; Lovl[i4 + 2] = styleRgb[s3 + 2];
    Lovl[i4 + 3] = glyph;
    LovlZ[i] = ref;
  }

  // Bresenham-style cell line, ref lerped per cell, glyph by segment slope.
  function line(c0, r0, z0, c1, r1, z1, style, first) {
    const dx = c1 - c0, dy = r1 - r0;
    const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
    const steps = adx > ady ? adx : ady;
    if (steps > 4 * (Lcols + Lrows)) return; // wildly off-screen segment
    let slot;
    if (adx > 2 * ady) slot = G_H; else if (ady > 2 * adx) slot = G_V; else slot = (dx > 0) === (dy > 0) ? G_DR : G_UR;
    const glyph = styleGlyph[style * 4 + slot];
    if (first || steps === 0) put(c0, r0, glyph, style, z0);
    // incremental DDA; the start cell is the previous segment's end cell (ring is a closed loop), so only put it when `first`
    const inv = 1 / steps, sx = dx * inv, sy = dy * inv, sz = (z1 - z0) * inv;
    let x = c0, y = r0, z = z0;
    for (let s = 1; s <= steps; s++) {
      x += sx; y += sy; z += sz;
      put(Math.floor(x + 0.5), Math.floor(y + 0.5), glyph, style, z);
    }
  }

  function rasterRing(x, y, z, radius, style) {
    const n = OVL_RING_SAMPLES;
    const W2 = Lcols * 0.5, H2 = Lrows * 0.5;
    let valid = 0;
    for (let k = 0; k < n; k++) {
      const px = x + RING_COS[k] * radius, py = y + RING_SIN[k] * radius;
      const pz = groundFn ? groundFn(px, py) + OVL_RING_LIFT : z;
      // same as projectPoint (x, y, w only; the ring needs no clip z)
      const w = M[3] * px + M[7] * py + M[11] * pz + M[15];
      if (w > PROJ_NEAR) {
        const iw = 1 / w;
        rc[k * 3] = Math.floor(W2 * ((M[0] * px + M[4] * py + M[8] * pz + M[12]) * iw) + W2);
        rc[k * 3 + 1] = Math.floor(H2 * ((M[1] * px + M[5] * py + M[9] * pz + M[13]) * iw) + H2);
        valid++;
      } else {
        rc[k * 3] = NaN; rc[k * 3 + 1] = NaN;
      }
      rc[k * 3 + 2] = w;
    }
    if (valid === 0) return;
    let prevDrawn = false;
    for (let k = 0; k < n; k++) {
      const a = k * 3, b = ((k + 1) % n) * 3;
      if (rc[a] !== rc[a] || rc[b] !== rc[b]) { prevDrawn = false; continue; } // NaN: behind the near plane
      line(rc[a], rc[a + 1], rc[a + 2], rc[b], rc[b + 1], rc[b + 2], style, !prevDrawn);
      prevDrawn = true;
    }
  }

  function rasterBar(x, y, z, frac, width, style, emptyStyle) {
    projectPoint(M, ov.cols, ov.rows, x, y, z, p4);
    const w = p4[3];
    if (w <= PROJ_NEAR || width <= 0) return;
    const row = Math.floor(p4[1]);
    const c0 = Math.floor(p4[0]) - (width >> 1);
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    const fill = Math.round(f * width);
    for (let k = 0; k < width; k++) {
      const st = k < fill ? style : emptyStyle;
      put(c0 + k, row, styleGlyph[st * 4 + G_H], st, w);
    }
  }

  function rasterRect(c0, r0, c1, r1, style) {
    const g = styleGlyph[style * 4 + G_H], gv = styleGlyph[style * 4 + G_V];
    for (let c = c0; c <= c1; c++) { put(c, r0, g, style, 0); put(c, r1, g, style, 0); }
    for (let r = r0 + 1; r < r1; r++) { put(c0, r, gv, style, 0); put(c1, r, gv, style, 0); }
  }

  if (cols > 0 && rows > 0) ov.bind(cols, rows);
  return ov;
}

/**
 * CPU composite (the JS twin of RE-07b's GPU pass): per touched cell, depth test
 * `ref <= sceneDepth + max(OVL_BIAS_M, OVL_BIAS_REL*ref)` (ref 0 = no test, sky/horizon
 * depth always passes), then write glyph + fg only (bg and mask untouched).
 * @param {any} ov
 * @param {{glyphIdx:Uint8Array, fg:Uint8Array}} cells
 * @param {Float32Array|null} depth  resolved per-cell view depth (CPU `fb.depth.depth`)
 */
export function applyOverlay(ov, cells, depth) {
  const n = ov.stats.cells, touched = ov.touched, ovl = ov.ovl, ovlZ = ov.ovlZ;
  const gi = cells.glyphIdx, fg = cells.fg;
  for (let t = 0; t < n; t++) {
    const i = touched[t];
    const g = ovl[i * 4 + 3];
    if (g === 0) continue;
    const ref = ovlZ[i];
    if (ref > 0 && depth) {
      const d = depth[i];
      if (d < 1e5) { // finite and below HORIZON_DEPTH (1e6); sky always passes
        const bias = OVL_BIAS_REL * ref > OVL_BIAS_M ? OVL_BIAS_REL * ref : OVL_BIAS_M;
        if (ref > d + bias) continue;
      }
    }
    gi[i] = g;
    const f = i * 4;
    fg[f] = ovl[f]; fg[f + 1] = ovl[f + 1]; fg[f + 2] = ovl[f + 2]; fg[f + 3] = g; // fg[+3] duplicates the glyph (CellBuffer layout)
  }
}
