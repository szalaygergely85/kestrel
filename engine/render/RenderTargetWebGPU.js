// WG-1c1 (docs/architecture.md 38.1-38.8a): WebGPU glyph-grid present. Same public surface as RenderTargetGL (cols,
// rows, dpr, pxCellW/H, cellW/H, backend, cells, setCell*, clear, present, resize, setGrid, setUiLayer, setCell/Sprite/
// OverlayPass, canHoldGrid, readbackPresent), but device-only: it never touches navigator.gpu / GPU* (check-deps rule 17),
// everything goes through a `GpuDevice` (GpuDeviceWebGPU) built by createGpuDevice with this canvas attached.
//
// Per frame: two writeTexture uploads (scene fg/bg rgba8), one scene draw, then (UI layer bound) two more uploads and
// one UI draw into the same canvas pass, then device.submit(). Scene and UI use two pipelines (same WGSL) so each keeps
// its own cached bind group (no rebuild per frame). The atlas textures are rebuilt only on resize/DPR change.

import { CellBuffer } from './CellBuffer.js';
import { computeCellBox } from './glyphMetrics.js';
import { rasterizeGlyphAtlas, glyphAtlasPixels, GLYPH_COUNT } from './glyphAtlas.js';
import { PRESENT_WGSL, PRESENT_BLOCK, PRESENT_TEXTURES } from './gpu/wgsl/present.wgsl.js';
import { FRAME_TIMER_SLOT } from './gpu/device/WebGpuTimer.js';

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
  _buildAtlas(old, m) {
    const ac = rasterizeGlyphAtlas(this._atlasCanvas, this._atlasCtx, m);
    if (old) this.device.dispose(old);
    const tex = this.device.createTexture({ format: 'rgba8', width: ac.width, height: ac.height, filter: 'linear' });
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
    this._uiAtlasTex = this._buildAtlas(this._uiAtlasTex, {
      pxCellW: this.pxCellW * ui.sx, pxCellH: this.pxCellH * ui.sy, fontPx: this.fontSize * ui.sy, ascent: this.glyphAscent * ui.sy,
    });
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
    this._refBox = { availW, availH, dpr: refDpr };
    this.dpr = dpr;
    const box = computeCellBox(this._measureCtx, this.cols, this.rows, availW * dpr, availH * dpr);
    this.fontSize = box.fontPx;
    this.pxCellW = box.pxCellW;
    this.pxCellH = box.pxCellH;
    this.glyphAscent = box.glyphAscent;
    this.cellW = this.pxCellW / dpr;
    this.cellH = this.pxCellH / dpr;
    this.canvas.style.width = this.cellW * this.cols + 'px';
    this.canvas.style.height = this.cellH * this.rows + 'px';
    this.canvas.width = this.pxCellW * this.cols; // the configured context follows the canvas size
    this.canvas.height = this.pxCellH * this.rows;
    this._rebuildAtlas();
    if (this._uiLayer) this._rebuildUiAtlas();
  }

  /** WebGPU twin of the GL pre-flight: only the 2D texture dimension limit matters for the cell textures. */
  canHoldGrid(cols, rows) {
    const lim = this.device.gpu && this.device.gpu.limits;
    const max = lim ? lim.maxTextureDimension2D : 8192;
    return (cols > max || rows > max) ? { ok: false, reason: `grid ${cols}x${rows} exceeds maxTextureDimension2D ${max}` } : { ok: true };
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
    d.timer.begin(FRAME_TIMER_SLOT); // WG-1b3: whole GPU present, including the cell-pass hook.
    d.writeTexture(this.fgTex, this.cells.fg);
    d.writeTexture(this.bgTex, this.cells.bg);
    if (this._cellPass) this._cellPass();
    if (this._spritePass) this._spritePass();
    if (this._overlayPass) this._overlayPass();

    d.beginPass(this._target, this._clearOpts);
    this._grid = this._grid || [null, null, null];
    this._grid[0] = this.fgTex; this._grid[1] = this.bgTex; this._grid[2] = this.atlasTex;
    this._draw(this._pipeScene, this._bindScene, this._texScene, this._grid, this.cols, this.rows, 0);
    this._presentFg = this.fgTex; this._presentBg = this.bgTex;
    if (this._uiLayer && this._uiFgTex) {
      const ui = this._uiLayer;
      d.writeTexture(this._uiFgTex, ui.cells.fg);
      d.writeTexture(this._uiBgTex, ui.cells.bg);
      this._grid[0] = this._uiFgTex; this._grid[1] = this._uiBgTex; this._grid[2] = this._uiAtlasTex;
      this._draw(this._pipeUi, this._bindUi, this._texUi, this._grid, ui.cols, ui.rows, 1);
    }
    d.endPass();
    d.timer.end();
    d.submit();
    if (d.timer.writeStats) d.timer.writeStats(this.stats);
  }
}

export { GLYPH_COUNT };
