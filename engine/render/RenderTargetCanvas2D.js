// Canvas2D fallback back-end (D-005), used only when `canvas.getContext(
// 'webgl2')` is unavailable (or `?force2d=1` is set for testing) - see
// RenderTarget.js, the factory that picks between this and RenderTargetGL.
//
// --- Perf history (US-001 rework #1, before D-005 introduced the WebGL2
// back-end as primary) -----------------------------------------------------
// v1 drew every cell with ctx.fillRect + ctx.fillText: ~9600 canvas calls/
// frame - far too slow (font shaping/hinting has real per-call cost; this
// measured ~110ms/frame for a full worst-case redraw).
// v2 (this file) composites a full-resolution pixel buffer in plain JS -
// one glyph alpha-mask lookup + a color blend per device pixel - and
// blits it with a SINGLE ctx.putImageData call. This was the fastest and
// most stable Canvas2D option measured for this project (see the numbers
// recorded in docs/backlog.md US-001): its cost is proportional to device
// pixel count (cols*pxCellW x rows*pxCellH), not to cell count, which is
// exactly why D-005 made this the FALLBACK only, capping pxCellH <= 16
// device px (CSS-upscaled, softer at high DPR) to bound that cost, with a
// from-scratch WebGL2 back-end (RenderTargetGL.js) as the primary path.
// v3 (drawImage-based tinted glyph tile caching, in three variants) was
// tried and reverted during rework #1: it measured 1-2 orders of magnitude
// SLOWER than v2 in this project's measurement environment - canvas object
// creation and especially `globalCompositeOperation` switches were both
// individually pathological there.

import { CellBuffer } from './CellBuffer.js';
import { computeCellBox, FONT_STACK } from './glyphMetrics.js';

const MAX_PX_CELL_H = 16; // D-005: cap the fallback's backing resolution, CSS-upscale

export class RenderTargetCanvas2D {
  constructor(canvas, cols, rows) {
    this.backend = 'c2d-capped';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cols = cols;
    this.rows = rows;
    this.cells = new CellBuffer(cols, rows);

    this.cellW = 1; this.cellH = 1;
    this.pxCellW = 1; this.pxCellH = 1;
    this.glyphAscent = 1;
    this.fontSize = 16;
    this.dpr = 1;

    this._glyphAtlas = new Array(95).fill(null); // glyphIdx -> Uint8ClampedArray alpha mask
    this._measureCanvas = document.createElement('canvas');
    this._measureCtx = this._measureCanvas.getContext('2d', { willReadFrequently: true });
    this._atlasCanvas = document.createElement('canvas');
    this._atlasCtx = this._atlasCanvas.getContext('2d', { willReadFrequently: true });

    // Degenerate 1px-cell fallback so present() has something valid to draw
    // into even if resize() bails below (0x0 viewport); a real resize()
    // (triggered by 'resize'/'visibilitychange'/'pageshow' in main.js)
    // replaces this once a real viewport size is available.
    this.canvas.width = cols;
    this.canvas.height = rows;
    this._imageData = this.ctx.createImageData(cols, rows);
    this._pixels32 = new Uint32Array(this._imageData.data.buffer);

    this.resize();
  }

  // `refAvailW`/`refAvailH`/`refDpr` (all optional) override the
  // window-derived box with a fixed one - used ONLY by `?gpucompare=1`/
  // `?gpucompare=shade` (main.js), see RenderTargetGL.resize's header
  // comment. Normal gameplay never passes these.
  resize(refAvailW, refAvailH, refDpr) {
    const dpr = refDpr != null ? refDpr : (window.devicePixelRatio || 1);
    const availW = refAvailW != null ? refAvailW : window.innerWidth;
    const availH = refAvailH != null ? refAvailH : window.innerHeight;

    // A hidden/unattached tab (e.g. mid-navigation, backgrounded) can report
    // a 0x0 viewport. Skip resizing rather than collapsing the grid to 1px
    // cells; a later resize (see main.js's visibility/pageshow listeners)
    // will pick up the real size once one is available.
    if (availW <= 0 || availH <= 0) return;

    this.dpr = dpr;
    const box = computeCellBox(this._measureCtx, this.cols, this.rows, availW * dpr, availH * dpr, MAX_PX_CELL_H);
    this.fontSize = box.fontPx;
    this.pxCellW = box.pxCellW;
    this.pxCellH = box.pxCellH;
    this.glyphAscent = box.glyphAscent;

    this.cellW = this.pxCellW / dpr;
    this.cellH = this.pxCellH / dpr;

    // The backing resolution is capped (MAX_PX_CELL_H) but the element
    // still fills the window via CSS - browsers upscale it (accepted
    // softness, see D-005).
    this.canvas.style.width = (availW) + 'px';
    this.canvas.style.height = (availH) + 'px';
    this.canvas.width = this.pxCellW * this.cols;
    this.canvas.height = this.pxCellH * this.rows;

    this._imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    this._pixels32 = new Uint32Array(this._imageData.data.buffer);
    this._glyphAtlas.fill(null); // cell pixel size changed - every cached mask is the wrong size now
  }

  setCell(x, y, glyph, fg, bg) {
    this.cells.setCell(x, y, glyph, fg, bg);
  }

  setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) {
    this.cells.setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2);
  }

  clear(bg) {
    this.cells.clear(bg);
  }

  // OWN-REQ-003 (architecture.md 17.3): `ui` (an `engine/ui/uiLayer.js`
  // UiLayer) is merged into `this.cells` at the top of `present()` every
  // frame - see below. No texture/atlas of its own on this path: the CPU
  // back-end already rasterizes glyphs on demand at ITS OWN cell size
  // (`_buildGlyphMask`), so a UI cell just becomes a normal scene cell.
  setUiLayer(ui) {
    this._uiLayer = ui;
  }

  /**
   * D-025 (US-038a, architecture.md 22.3): symmetry with `RenderTargetGL.
   * setGrid` - `engine.setGrid` never actually reaches this back-end (its
   * "no GPU grid" branch returns early for anything that isn't a real gl2
   * context, per 22.6 item 2), so this is defensive/future-proofing rather
   * than a path exercised by gameplay today. No textures to leak here (the
   * CPU back-end has none) - just the cell buffer and the backing canvas,
   * same as the constructor, minus the degenerate 1x1 placeholder.
   */
  setGrid(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new CellBuffer(cols, rows);
    this.resize();
  }

  // Rasterizes one glyph into a device-pixel-sized alpha mask, once, and
  // caches it (by numeric glyphIdx) until the next resize.
  _buildGlyphMask(glyphIdx) {
    let mask = this._glyphAtlas[glyphIdx];
    if (mask) return mask;

    const w = this.pxCellW;
    const h = this.pxCellH;
    const ac = this._atlasCanvas;
    if (ac.width !== w || ac.height !== h) { ac.width = w; ac.height = h; }
    const actx = this._atlasCtx;
    actx.clearRect(0, 0, w, h);

    if (glyphIdx !== 0) {
      actx.font = `${this.fontSize}px ${FONT_STACK}`;
      actx.textBaseline = 'alphabetic';
      actx.textAlign = 'left';
      actx.fillStyle = '#ffffff';
      actx.fillText(String.fromCharCode(glyphIdx + 32), 0, this.glyphAscent);
    }

    const img = actx.getImageData(0, 0, w, h);
    mask = new Uint8ClampedArray(w * h);
    for (let p = 0; p < mask.length; p++) mask[p] = img.data[p * 4 + 3]; // alpha channel = coverage

    this._glyphAtlas[glyphIdx] = mask;
    return mask;
  }

  // OWN-REQ-003 (architecture.md 17.3): copies every UI-layer cell the game
  // wrote this frame (`mask[i] === 1`) into the scene CellBuffer, just
  // before the pixel-compositing loop below reads it - so the UI shows up
  // exactly like any other scene cell (its glyph drawn at the SCENE's own
  // cell pixel size, the CPU back-end's one shading rule). At the default
  // 160x60 CPU grid (`RenderTarget.js`'s forced `cpuGrid`) this IS the
  // uiGrid default too, so this is the 1:1 fast path - byte-identical to
  // the pre-OWN-REQ-003 picture (the game used to draw straight into the
  // scene at these same coordinates). No allocation: reuses `this.cells`'
  // typed arrays.
  _mergeUiLayer() {
    const ui = this._uiLayer;
    if (!ui) return;
    const dst = this.cells;
    if (ui.cols === this.cols && ui.rows === this.rows) {
      const src = ui.cells;
      const n = ui.cols * ui.rows;
      for (let i = 0; i < n; i++) {
        if (!src.mask[i]) continue;
        dst.glyphIdx[i] = src.glyphIdx[i];
        const fi = i * 4;
        dst.fg[fi] = src.fg[fi]; dst.fg[fi + 1] = src.fg[fi + 1]; dst.fg[fi + 2] = src.fg[fi + 2]; dst.fg[fi + 3] = src.fg[fi + 3];
        dst.bg[fi] = src.bg[fi]; dst.bg[fi + 1] = src.bg[fi + 1]; dst.bg[fi + 2] = src.bg[fi + 2]; dst.bg[fi + 3] = 255;
        dst.mask[i] = 1;
      }
      return;
    }
    // Rare path (17.3's "otherwise" - a CPU grid that doesn't match the UI
    // grid, e.g. a future non-default `cpuGrid`): nearest-neighbour block
    // fill, still allocation-free.
    const src = ui.cells;
    const sx = this.cols / ui.cols, sy = this.rows / ui.rows;
    for (let uy = 0; uy < ui.rows; uy++) {
      const y0 = Math.round(uy * sy), y1 = Math.min(this.rows, Math.round((uy + 1) * sy));
      for (let ux = 0; ux < ui.cols; ux++) {
        const ui_i = uy * ui.cols + ux;
        if (!src.mask[ui_i]) continue;
        const x0 = Math.round(ux * sx), x1 = Math.min(this.cols, Math.round((ux + 1) * sx));
        const fi = ui_i * 4;
        const gIdx = src.glyphIdx[ui_i];
        const fr = src.fg[fi], fg1 = src.fg[fi + 1], fb = src.fg[fi + 2];
        const br = src.bg[fi], bgc = src.bg[fi + 1], bb = src.bg[fi + 2];
        for (let cy = y0; cy < y1; cy++) {
          for (let cx = x0; cx < x1; cx++) {
            this.setCellRGB(cx, cy, gIdx, fr, fg1, fb, br, bgc, bb);
          }
        }
      }
    }
  }

  present() {
    this._mergeUiLayer();
    const { cols, rows, pxCellW, pxCellH } = this;
    const { glyphIdx: glyphIdxArr, fg: fgArr, bg: bgArr } = this.cells;
    const canvasW = this.canvas.width;
    const pixels = this._pixels32;

    for (let cy = 0; cy < rows; cy++) {
      const py0 = cy * pxCellH;
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const gIdx = glyphIdxArr[i];
        const fi = i * 4;
        const br = bgArr[fi], bgc = bgArr[fi + 1], bb = bgArr[fi + 2];
        const bgWord = (255 << 24) | (bb << 16) | (bgc << 8) | br;
        const px0 = cx * pxCellW;
        const rowBase = py0 * canvasW + px0;

        if (gIdx === 0) {
          // Fast path: solid background fill, no glyph blending - a single
          // native TypedArray.fill per row instead of per-pixel writes.
          for (let j = 0; j < pxCellH; j++) {
            const rowStart = rowBase + j * canvasW;
            pixels.fill(bgWord, rowStart, rowStart + pxCellW);
          }
          continue;
        }

        const mask = this._buildGlyphMask(gIdx);
        const fr = fgArr[fi], fgg = fgArr[fi + 1], fb = fgArr[fi + 2];
        const fgWord = (255 << 24) | (fb << 16) | (fgg << 8) | fr;

        for (let j = 0; j < pxCellH; j++) {
          let idx = rowBase + j * canvasW;
          let mi = j * pxCellW;
          for (let k = 0; k < pxCellW; k++) {
            const a = mask[mi];
            if (a === 0) {
              pixels[idx] = bgWord;
            } else if (a === 255) {
              pixels[idx] = fgWord;
            } else {
              const t = a / 255;
              const r = br + (fr - br) * t;
              const g = bgc + (fgg - bgc) * t;
              const b = bb + (fb - bb) * t;
              pixels[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
            idx++;
            mi++;
          }
        }
      }
    }

    this.ctx.putImageData(this._imageData, 0, 0);
  }
}
