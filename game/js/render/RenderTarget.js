// RenderTarget: a fixed logical grid of (glyph, fg, bg) cells drawn onto a
// single <canvas> as colored monospace characters. This is the stable
// drawing surface every later system (raycaster, lighting, UI) writes into.
//
// Public API (per US-001 acceptance criteria - unchanged across the perf
// rework below):
//   setCell(x, y, glyph, fg, bg)  - write one cell (fg/bg as "#rrggbb"/"#rgb" hex strings)
//   clear(bg)                     - fill the whole grid with a glyph-less bg
//   present()                     - flush the grid to the canvas
//
// --- Perf history (US-001 PO reject #1) ---------------------------------
// v1 drew every cell with ctx.fillRect + ctx.fillText: ~9600 canvas calls/
// frame - far too slow (font shaping/hinting has real per-call cost; this
// measured ~110ms/frame for a full worst-case redraw).
// v2 (this file) composites a full-resolution pixel buffer in plain JS -
// one glyph alpha-mask lookup + a color blend per device pixel - and
// blits it with a SINGLE ctx.putImageData call. This is the fastest and
// most STABLE option measured for this project (see the numbers recorded
// in docs/backlog.md US-001): its cost is proportional to device pixel
// count (cols*pxCellW x rows*pxCellH), not to cell count, which does mean
// it scales with window size x devicePixelRatio - see the note below.
//
// v3 was tried and reverted: cache tinted glyph tiles (one small canvas per
// (glyph, quantized-color) pair, drawn with ctx.drawImage) so cost would be
// bounded by cols*rows instead of device pixels. Three variants of this
// (per-tile canvas allocation, then a capped Map cache, then a pre-allocated
// canvas pool) were all measured as 1-2 orders of magnitude SLOWER than v2
// in this project's actual measurement environment (hundreds of ms to
// several seconds per frame, wildly unstable) - canvas object creation and,
// worse, `globalCompositeOperation` switches were both individually
// pathological here (a single composite-mode switch appeared to cost
// milliseconds, not microseconds). v2's plain-JS-array approach has almost
// no canvas API calls in its hot path (one putImageData/frame) and was the
// only architecture that produced stable, predictable numbers.
//
// KNOWN LIMITATION (flagged for the PO): because v2's cost scales with
// device pixel count, it does not fully satisfy "cost should scale with
// the 160x60 grid, not the window". See the `?bench=1` numbers recorded in
// docs/backlog.md US-001 at 1x and the best available 2x-ish DPR in this
// environment, and the STOP note if the 8ms/frame budget is not met at 2x -
// per the reject notes, closing that gap is a PO/manager call between
// capping the backing resolution (less crisp at very high DPR) and a
// WebGL2 back-end behind this same RenderTarget interface.

const DEFAULT_COLS = 160;
const DEFAULT_ROWS = 60;

export class RenderTarget {
  constructor(canvas, cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cols = cols;
    this.rows = rows;

    // Cell buffers (flat arrays, row-major). Kept as plain arrays of
    // strings/glyphs rather than objects per cell to avoid per-frame
    // allocation churn.
    const size = cols * rows;
    this.glyphs = new Array(size).fill(' ');
    this.fgColors = new Array(size).fill('#ffffff');
    this.bgColors = new Array(size).fill('#000000');

    this.cellW = 1; // CSS px
    this.cellH = 1; // CSS px
    this.pxCellW = 1; // device px
    this.pxCellH = 1; // device px
    this.glyphAscent = 1; // device px, baseline offset from the cell's top
    this.fontSize = 16;
    this.dpr = 1;

    this._colorCache = new Map(); // "#rrggbb" -> {r,g,b,word}
    this._glyphAtlas = new Map(); // glyph char -> Uint8ClampedArray alpha mask (pxCellW*pxCellH)
    this._measureCanvas = document.createElement('canvas');
    this._measureCtx = this._measureCanvas.getContext('2d', { willReadFrequently: true });
    this._atlasCanvas = document.createElement('canvas');
    this._atlasCtx = this._atlasCanvas.getContext('2d', { willReadFrequently: true });

    // Degenerate 1px-cell fallback so present() has something valid to draw
    // into even if resize() bails below (0x0 viewport - see its guard);
    // a real resize() (triggered by 'resize'/'visibilitychange'/'pageshow'
    // in main.js) replaces this once a real viewport size is available.
    this.canvas.width = cols;
    this.canvas.height = rows;
    this._imageData = this.ctx.createImageData(cols, rows);
    this._pixels32 = new Uint32Array(this._imageData.data.buffer);

    this.resize();
  }

  // Measures every printable ASCII glyph (32-126) at a given font pixel
  // size and returns the box that fits all of them with no clipping:
  // { width: max advance width, ascent: max ascent, descent: max descent,
  //   height: ascent + descent }. Used by resize() to derive cell size from
  // real font metrics instead of a hard-coded aspect ratio.
  _measureGlyphs(fontPx) {
    const ctx = this._measureCtx;
    ctx.font = `${fontPx}px "Courier New", monospace`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    let maxWidth = 0;
    let maxAscent = 0;
    let maxDescent = 0;
    for (let code = 32; code <= 126; code++) {
      const m = ctx.measureText(String.fromCharCode(code));
      if (m.width > maxWidth) maxWidth = m.width;
      // actualBoundingBox* is well supported in Chrome; fall back to a
      // reasonable fraction of the font size if a browser ever lacks it.
      const asc = m.actualBoundingBoxAscent != null ? m.actualBoundingBoxAscent : fontPx * 0.8;
      const desc = m.actualBoundingBoxDescent != null ? m.actualBoundingBoxDescent : fontPx * 0.25;
      if (asc > maxAscent) maxAscent = asc;
      if (desc > maxDescent) maxDescent = desc;
    }
    return { width: maxWidth, ascent: maxAscent, descent: maxDescent, height: maxAscent + maxDescent };
  }

  // Recomputes cell size / canvas pixel size to fit the window, deriving the
  // cell box from MEASURED glyph metrics (not a hard-coded aspect ratio) so
  // no printable ASCII glyph is ever clipped, at 1x or 2x devicePixelRatio.
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const availW = window.innerWidth;
    const availH = window.innerHeight;

    // A hidden/unattached tab (e.g. mid-navigation, backgrounded) can report
    // a 0x0 viewport. Skip resizing rather than collapsing the grid to 1px
    // cells; a later resize (see main.js's visibility/pageshow listeners)
    // will pick up the real size once one is available.
    if (availW <= 0 || availH <= 0) return;

    this.dpr = dpr;
    const availPxW = availW * dpr;
    const availPxH = availH * dpr;
    const perColPxW = availPxW / this.cols;
    const perRowPxH = availPxH / this.rows;

    // Measure once at a large reference size (stable metrics, minimal
    // rounding noise) to estimate the font size that fits the per-cell
    // pixel budget in both dimensions, then re-measure AT that exact size
    // so the final cell box is derived from real, not extrapolated, metrics.
    const REF = 128;
    const refMetrics = this._measureGlyphs(REF);
    const scale = Math.min(perColPxW / refMetrics.width, perRowPxH / refMetrics.height);
    // Small safety margin: glyph metrics don't scale perfectly linearly
    // with font size (hinting/rounding), so back off very slightly from the
    // naive linear estimate before re-measuring for the real box.
    const fontPx = Math.max(1, Math.floor(REF * scale * 0.97));
    const metrics = this._measureGlyphs(fontPx);

    this.fontSize = fontPx;
    // +1px padding guards against sub-pixel rounding in measureText itself.
    this.pxCellW = Math.max(1, Math.ceil(metrics.width));
    this.pxCellH = Math.max(1, Math.ceil(metrics.height) + 1);
    this.glyphAscent = Math.ceil(metrics.ascent) + 1;

    this.cellW = this.pxCellW / dpr;
    this.cellH = this.pxCellH / dpr;

    const cssW = this.cellW * this.cols;
    const cssH = this.cellH * this.rows;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = this.pxCellW * this.cols;
    this.canvas.height = this.pxCellH * this.rows;

    this._imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    this._pixels32 = new Uint32Array(this._imageData.data.buffer);
    this._glyphAtlas.clear(); // cell pixel size changed - every cached mask is the wrong size now
  }

  setCell(x, y, glyph, fg, bg) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyphs[i] = glyph;
    this.fgColors[i] = fg;
    this.bgColors[i] = bg;
  }

  clear(bg = '#000000') {
    this.glyphs.fill(' ');
    this.fgColors.fill('#ffffff');
    this.bgColors.fill(bg);
  }

  // Parses a "#rgb" / "#rrggbb" string to {r,g,b,word}, caching the result
  // since the same palette colors recur across many cells and frames.
  // `word` is the color packed as a little-endian uint32 (0xAABBGGRR) ready
  // to write straight into the Uint32Array pixel view.
  _parseColor(str) {
    let c = this._colorCache.get(str);
    if (c) return c;

    let r = 255, g = 255, b = 255;
    if (str && str[0] === '#') {
      if (str.length === 7) {
        r = parseInt(str.slice(1, 3), 16);
        g = parseInt(str.slice(3, 5), 16);
        b = parseInt(str.slice(5, 7), 16);
      } else if (str.length === 4) {
        r = parseInt(str[1] + str[1], 16);
        g = parseInt(str[2] + str[2], 16);
        b = parseInt(str[3] + str[3], 16);
      }
    }
    const word = (255 << 24) | (b << 16) | (g << 8) | r;
    c = { r, g, b, word };
    this._colorCache.set(str, c);
    return c;
  }

  // Rasterizes one glyph into a device-pixel-sized alpha mask, once, and
  // caches it until the next resize (cell pixel size changes). At most ~95
  // distinct glyphs ever exist (printable ASCII), so this cache is tiny and
  // never evicted.
  _buildGlyphMask(glyph) {
    let mask = this._glyphAtlas.get(glyph);
    if (mask) return mask;

    const w = this.pxCellW;
    const h = this.pxCellH;
    const ac = this._atlasCanvas;
    if (ac.width !== w || ac.height !== h) {
      ac.width = w;
      ac.height = h;
    }
    const actx = this._atlasCtx;
    actx.clearRect(0, 0, w, h);

    if (glyph !== ' ' && glyph != null) {
      actx.font = `${this.fontSize}px "Courier New", monospace`;
      actx.textBaseline = 'alphabetic';
      actx.textAlign = 'left';
      actx.fillStyle = '#ffffff';
      actx.fillText(glyph, 0, this.glyphAscent);
    }

    const img = actx.getImageData(0, 0, w, h);
    mask = new Uint8ClampedArray(w * h);
    // Alpha channel is the glyph's coverage (white text on transparent bg).
    for (let p = 0; p < mask.length; p++) mask[p] = img.data[p * 4 + 3];

    this._glyphAtlas.set(glyph, mask);
    return mask;
  }

  present() {
    const { cols, rows, pxCellW, pxCellH, glyphs, fgColors, bgColors } = this;
    const canvasW = this.canvas.width;
    const pixels = this._pixels32;

    for (let cy = 0; cy < rows; cy++) {
      const py0 = cy * pxCellH;
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const glyph = glyphs[i];
        const bg = this._parseColor(bgColors[i]);
        const px0 = cx * pxCellW;
        const rowBase = py0 * canvasW + px0;

        if (glyph === ' ' || glyph == null) {
          // Fast path: solid background fill, no glyph blending - a single
          // native TypedArray.fill per row instead of per-pixel writes.
          for (let j = 0; j < pxCellH; j++) {
            const rowStart = rowBase + j * canvasW;
            pixels.fill(bg.word, rowStart, rowStart + pxCellW);
          }
          continue;
        }

        const mask = this._buildGlyphMask(glyph);
        const fg = this._parseColor(fgColors[i]);
        const { r: br, g: bgc, b: bb } = bg;
        const { r: fr, g: fgg, b: fb } = fg;

        for (let j = 0; j < pxCellH; j++) {
          let idx = rowBase + j * canvasW;
          let mi = j * pxCellW;
          for (let k = 0; k < pxCellW; k++) {
            const a = mask[mi];
            if (a === 0) {
              pixels[idx] = bg.word;
            } else if (a === 255) {
              pixels[idx] = fg.word;
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
