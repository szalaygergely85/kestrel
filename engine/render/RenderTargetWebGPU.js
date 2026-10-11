// WG-1c1 (docs/architecture.md 38.1-38.8a): WebGPU glyph-grid present. Same public surface as RenderTargetGL (cols,
// rows, dpr, pxCellW/H, cellW/H, backend, cells, setCell*, clear, present, resize, setGrid, setUiLayer, setCell/Sprite/
// OverlayPass, canHoldGrid, readbackPresent), but device-only: it never touches navigator.gpu / GPU* (check-deps rule 17),
// everything goes through a `GpuDevice` (GpuDeviceWebGPU) built by createGpuDevice with this canvas attached.
//
// Per frame: two writeTexture uploads (scene fg/bg rgba8), one scene draw, then (UI layer bound) two more uploads and
// one UI draw into the same canvas pass, then device.submit(). Scene and UI use two pipelines (same WGSL) so each keeps
// its own cached bind group (no rebuild per frame). The atlas textures are rebuilt only on resize/DPR change.

import { CellBuffer } from './CellBuffer.js';
import { computeCellBox, fitCssSize } from './glyphMetrics.js';
import { rasterizeGlyphAtlas, glyphAtlasPixels, GLYPH_COUNT } from './glyphAtlas.js';
import { PRESENT_WGSL, PRESENT_BLOCK, PRESENT_TEXTURES } from './gpu/wgsl/present.wgsl.js';
import { FRAME_TIMER_SLOT } from './gpu/device/WebGpuTimer.js';

/** GRID-MAX-01: estimated render-target VRAM ceiling for a live grid (800x300 at 4 rays ~ 190 MB, so this only trips on tiny-limit devices). */
export const GRID_VRAM_BUDGET = 512 * 1048576;

const GRID_W = PRESENT_BLOCK.field('grid').word;
const SIZE_W = PRESENT_BLOCK.field('size').word;
const LAYER_W = PRESENT_BLOCK.field('layer').word;

export class RenderTargetWebGPU {
  /**
   * @param {HTMLCanvasElement} canvas the canvas `device` was created with (createGpuDevice({backend:'webgpu', canvas}))
   * @param {number} cols @param {number} rows @param {any} device a GpuDeviceWebGPU
   */
  constructor(canvas, cols, rows, device) {
    if (!device || device.backend !== 'webgpu') throw new Error('RenderTargetWebGPU: needs a webgpu GpuDevice');
    this.backend = 'webgpu';
    this.canvas = canvas;
    this.device = device;
    this.cols = cols;
    this.rows = rows;
    this.cells = new CellBuffer(cols, rows);
    this.cellW = 1; this.cellH = 1;
    this.pxCellW = 1; this.pxCellH = 1;
    this.glyphAscent = 1;
    this.fontSize = 16;
    this.dpr = 1;
    this.ready = true;
    this.stats = { gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN };
    this._warnedLost = false;
    this._uiLayer = null;
    this._clearOpts = { clear: true }; // hoisted: present() runs every frame
    this._pf = null; this._pb = null;
    this._cellPass = null; this._spritePass = null; this._overlayPass = null;
    this._measureCanvas = document.createElement('canvas');
    this._measureCtx = this._measureCanvas.getContext('2d', { willReadFrequently: true });
    this._atlasCanvas = document.createElement('canvas');
    this._atlasCtx = this._atlasCanvas.getContext('2d', { willReadFrequently: true });
    this._uniforms = new Float32Array(PRESENT_BLOCK.sizeWords); // reused every draw (zero alloc)
    this._target = device.canvasTarget();
    const desc = {
      vertex: { src: { wgsl: PRESENT_WGSL } },
      fragment: { src: { wgsl: PRESENT_WGSL }, targets: 1 },
      bindings: { uniformBytes: PRESENT_BLOCK.sizeBytes, textures: PRESENT_TEXTURES.slice() },
      targetFormats: ['canvas'],
    };
    this._pipeScene = device.createPipeline(desc);
    this._pipeUi = device.createPipeline(desc);
    this._texScene = [{ slot: 0, texture: null }, { slot: 1, texture: null }, { slot: 2, texture: null }];
    this._texUi = [{ slot: 0, texture: null }, { slot: 1, texture: null }, { slot: 2, texture: null }];
    this._bindScene = { uniforms: this._uniforms, textures: this._texScene };
    this._bindUi = { uniforms: this._uniforms, textures: this._texUi };
    this.fgTex = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.bgTex = device.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.atlasTex = null; this._uiFgTex = null; this._uiBgTex = null; this._uiAtlasTex = null;
    this._presentFg = null; this._presentBg = null;
    // 38.8a (9): device loss is only recorded by the device; warn once here, ready=false, reload to recover.
    if (device.lost && typeof device.lost.then === 'function') {
      device.lost.then((info) => {
        if (info && info.reason === 'destroyed') return;
        this.ready = false;
        if (!this._warnedLost) { this._warnedLost = true; console.warn('[RenderTargetWebGPU] GPU device lost: ' + (info && info.message || 'unknown') + ' - reload the page'); }
      });
    }
    this.resize();
  }

  /** Rasterizes the glyph strip at the current cell size into a (re)created linear rgba8 atlas texture. @returns {any} */
  _buildAtlas(old, m, filter = 'linear') {
    const ac = rasterizeGlyphAtlas(this._atlasCanvas, this._atlasCtx, m);
    if (old) this.device.dispose(old);
    const tex = this.device.createTexture({ format: 'rgba8', width: ac.width, height: ac.height, filter });
    this.device.writeTexture(tex, glyphAtlasPixels(ac, this._atlasCtx));
    return tex;
  }

  _rebuildAtlas() {
    this.atlasTex = this._buildAtlas(this.atlasTex, { pxCellW: this.pxCellW, pxCellH: this.pxCellH, fontPx: this.fontSize, ascent: this.glyphAscent });
  }

  // Same math as RenderTargetGL._rebuildUiAtlas (UI cell size = scene cell size * ui.sx/sy).
  _rebuildUiAtlas() {
    const ui = this._uiLayer;
    if (!ui) return;
    // OB-021: the UI cell is pxCell * ui.sx/sy, non-integer at 560x210 (3.5 x 3 px rows = 10.5): the old fractional atlas
    // truncated its canvas height (clipped descenders) and was bilinear-resampled (blurry). Round up to whole texels, scale the
    // font/ascent with the rounded cell, sample the atlas nearest. At integer ratios (<= 480x180) the numbers are unchanged.
    const w = Math.max(1, Math.ceil(this.pxCellW * ui.sx - 1e-6)), h = Math.max(1, Math.ceil(this.pxCellH * ui.sy - 1e-6));
    const kx = w / (this.pxCellW * ui.sx), ky = h / (this.pxCellH * ui.sy);
    let m = { pxCellW: w, pxCellH: h, fontPx: this.fontSize * ui.sy * ky, ascent: this.glyphAscent * ui.sy * ky };
    if (w !== this.pxCellW * ui.sx || h !== this.pxCellH * ui.sy) {
      // The scene cell (2x3 px at 560x210) is clamped to the budget so its ascent == the cell height: scaled up, the
      // descenders have no room (cut off). Fractional ratio -> fit the font to the rounded UI cell with real metrics.
      const b = computeCellBox(this._measureCtx, 1, 1, w, h, Infinity, true);
      m = { pxCellW: w, pxCellH: h, fontPx: b.fontPx, ascent: b.glyphAscent };
    }
    this._uiAtlasTex = this._buildAtlas(this._uiAtlasTex, m, 'nearest');
  }

  _buildUiTextures() {
    const ui = this._uiLayer, d = this.device;
    if (this._uiFgTex) { d.dispose(this._uiFgTex); d.dispose(this._uiBgTex); }
    this._uiFgTex = d.createTexture({ format: 'rgba8', width: ui.cols, height: ui.rows });
    this._uiBgTex = d.createTexture({ format: 'rgba8', width: ui.cols, height: ui.rows });
  }

  /** OWN-REQ-003 twin: binds a UiLayer drawn over the scene every frame. */
  setUiLayer(ui) {
    this._uiLayer = ui;
    this._buildUiTextures();
    this._rebuildUiAtlas();
  }

  resize(refAvailW, refAvailH, refDpr) {
    const dpr = refDpr != null ? refDpr : (window.devicePixelRatio || 1);
    const availW = refAvailW != null ? refAvailW : window.innerWidth;
    const availH = refAvailH != null ? refAvailH : window.innerHeight;
    if (availW <= 0 || availH <= 0) return;
    this._refBox = { availW: refAvailW, availH: refAvailH, dpr: refDpr }; // BUG-SQUARES-01: live window stays live (fit on) after setGrid
    this.dpr = dpr;
    const box = computeCellBox(this._measureCtx, this.cols, this.rows, availW * dpr, availH * dpr, Infinity, refAvailW == null); // BUG-SQUARES-01: 1:1 fit on the live window
    this.fontSize = box.fontPx;
    this.pxCellW = box.pxCellW;
    this.pxCellH = box.pxCellH;
    this.glyphAscent = box.glyphAscent;
    this.cellW = this.pxCellW / dpr;
    this.cellH = this.pxCellH / dpr;
    const css = fitCssSize(this.cellW * this.cols, this.cellH * this.rows, availW, availH, refAvailW == null ? 2 : 1); // display-only fit (live window may upscale <= 2x so Ultra is never a smaller picture)
    this.canvas.style.width = css.w + 'px';
    this.canvas.style.height = css.h + 'px';
    this.canvas.style.imageRendering = css.smooth ? 'auto' : ''; // BUG-SQUARES-01: '' = page CSS (pixelated) at 1:1
    this.canvas.width = this.pxCellW * this.cols; // the configured context follows the canvas size
    this.canvas.height = this.pxCellH * this.rows;
    this._rebuildAtlas();
    if (this._uiLayer) this._rebuildUiAtlas();
  }

  /**
   * GRID-MAX-01: pre-flight for engine.setGrid. Checks (a) the raster G-buffer sub-sample size (cols*rays x rows*rays) against
   * maxTextureDimension2D, (b) an estimated total VRAM for the per-grid targets (36 B per sub-sample raster G-buffer +
   * ~170 B per cell for resolve/deriv/light/shade/final/stable/glow/hzb) against GRID_VRAM_BUDGET.
   */
  canHoldGrid(cols, rows, rays = 1) {
    const lim = this.device.gpu && this.device.gpu.limits;
    const maxTex = lim ? lim.maxTextureDimension2D : 8192;
    const r = Math.max(1, rays | 0);
    const subC = cols * r, subR = rows * r;
    if (subC > maxTex || subR > maxTex) return { ok: false, reason: `grid ${cols}x${rows} at ${r} rays needs a ${subC}x${subR} G-buffer, exceeds maxTextureDimension2D ${maxTex}` };
    const subBytes = subC * subR * 36;
    const total = subBytes + cols * rows * 170;
    if (total > GRID_VRAM_BUDGET) return { ok: false, reason: `grid ${cols}x${rows} at ${r} rays needs ~${(total / 1048576).toFixed(0)} MB of render targets, over the ${(GRID_VRAM_BUDGET / 1048576).toFixed(0)} MB budget` };
    return { ok: true };
  }

  setGrid(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new CellBuffer(cols, rows);
    this._presentFg = null; this._presentBg = null; // 38.8a (17): the old textures are disposed below
    this.device.dispose(this.fgTex);
    this.device.dispose(this.bgTex);
    this.fgTex = this.device.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.bgTex = this.device.createTexture({ format: 'rgba8', width: cols, height: rows });
    const rb = this._refBox || {};
    this.resize(rb.availW, rb.availH, rb.dpr);
  }

  setCell(x, y, glyph, fg, bg) { this.cells.setCell(x, y, glyph, fg, bg); }
  setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) { this.cells.setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2); }
  clear(bg) { this.cells.clear(bg); }
  setCellPass(fn) { this._cellPass = fn || null; }
  setSpritePass(fn) { this._spritePass = fn || null; }
  setOverlayPass(fn) { this._overlayPass = fn || null; }
  /** WG-3f: present these textures (pipeline sprite/overlay output) instead of the CPU cell textures; null = back to fgTex/bgTex. */
  setPresentCells(fg, bg) { this._pf = fg || null; this._pb = bg || null; }

  /**
   * Test-only (never the frame loop). Reads back the two cell textures the last `present()` scene draw sampled.
   * Always a Promise on WebGPU (`await` it; 38.6). Call it right after `present()`; it is a frame boundary.
   * @returns {Promise<{fg: Uint8Array, bg: Uint8Array, sampledOwnTextures: boolean}>}
   */
  async readbackPresent(outFg, outBg) {
    const n = this.cols * this.rows * 4;
    outFg = outFg || (this._rbFg = this._rbFg || new Uint8Array(n));
    outBg = outBg || (this._rbBg = this._rbBg || new Uint8Array(n));
    const fg = this._presentFg, bg = this._presentBg;
    if (!fg || !bg) throw new Error('readbackPresent: no present() yet - call it right after present()');
    const rect = { x: 0, y: 0, w: this.cols, h: this.rows };
    await this.device.readback(fg, rect, outFg);
    await this.device.readback(bg, rect, outBg);
    return { fg: outFg, bg: outBg, sampledOwnTextures: fg === this.fgTex && bg === this.bgTex };
  }

  _draw(pipe, bind, tex, grid, gridCols, gridRows, layer) {
    const u = this._uniforms;
    u[GRID_W] = gridCols; u[GRID_W + 1] = gridRows;
    u[SIZE_W] = this.canvas.width; u[SIZE_W + 1] = this.canvas.height;
    u[LAYER_W] = layer;
    tex[0].texture = grid[0]; tex[1].texture = grid[1]; tex[2].texture = grid[2];
    this.device.bind(pipe, bind);
    this.device.draw(3);
  }

  present() {
    if (!this.ready) return;
    const d = this.device;
    // FIX-PASS: a pass some earlier code opened and never ended (an error swallowed inside a pass) used to crash here forever
    // ("beginPass: previous pass not ended"); end it, name its owner once per frame it happens, and carry on.
    if (d._pass && typeof d.abortPass === 'function') console.error('[RenderTargetWebGPU] stale GPU pass left open before present (aborted): ' + d.abortPass());
    d.timer.begin(FRAME_TIMER_SLOT); // WG-1b3: whole GPU present, including the cell-pass hook.
    try { // FIX-PASS: a throw anywhere below must not leave the frame's pass or timer span open (the next present would crash)
      d.writeTexture(this.fgTex, this.cells.fg);
      d.writeTexture(this.bgTex, this.cells.bg);
      if (this._cellPass) this._cellPass();
      if (this._spritePass) this._spritePass();
      if (this._overlayPass) this._overlayPass();
      if (d._pass && typeof d.abortPass === 'function') console.error('[RenderTargetWebGPU] cell-pass hook left a GPU pass open (aborted): ' + d.abortPass());

      d.beginPass(this._target, this._clearOpts);
      this._grid = this._grid || [null, null, null];
      const own = !(this._pf && this._pb); // WG-3f: the pipeline's sprite/overlay output replaces the CPU cell textures
      const pf = own ? this.fgTex : this._pf, pb = own ? this.bgTex : this._pb;
      this._grid[0] = pf; this._grid[1] = pb; this._grid[2] = this.atlasTex;
      this._draw(this._pipeScene, this._bindScene, this._texScene, this._grid, this.cols, this.rows, 0);
      this._presentFg = pf; this._presentBg = pb;
      if (this._uiLayer && this._uiFgTex) {
        const ui = this._uiLayer;
        d.writeTexture(this._uiFgTex, ui.cells.fg);
        d.writeTexture(this._uiBgTex, ui.cells.bg);
        this._grid[0] = this._uiFgTex; this._grid[1] = this._uiBgTex; this._grid[2] = this._uiAtlasTex;
        this._draw(this._pipeUi, this._bindUi, this._texUi, this._grid, ui.cols, ui.rows, 1);
      }
    } catch (e) {
      // FIX-RING: a failed frame used to skip submit(), so the uniform ring never reset and every later frame overflowed
      // ("uniform ring overflow" -> fatal). End the pass, submit what was recorded (resets the ring), drop this frame only.
      if (typeof d.abortPass === 'function') d.abortPass();
      d.timer.end();
      try { d.submit(); } catch (_) { if (d.uniformRing) d.uniformRing.reset(); d._encoder = null; }
      this.failedFrames = (this.failedFrames || 0) + 1;
      if (this.failedFrames <= 3 || this.failedFrames % 600 === 0) console.error(`[RenderTargetWebGPU] frame dropped (${this.failedFrames}):`, e);
      return;
    }
    d.endPass();
    d.timer.end();
    d.submit();
    if (d.timer.writeStats) d.timer.writeStats(this.stats);
  }
}

export { GLYPH_COUNT };
