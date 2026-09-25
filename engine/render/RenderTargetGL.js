// WebGL2 fullscreen cell-shader back-end (D-005). Primary RenderTarget
// back-end: renders the entire 160x60 glyph grid with ONE draw call. Per
// frame: two texSubImage2D uploads (fg, bg - each a direct upload of the
// persistent CellBuffer typed arrays, no repacking) and one
// drawArrays(TRIANGLES, 0, 3) fullscreen triangle. The fragment shader
// resolves screen position -> cell -> (fg, bg, glyph) -> atlas texel ->
// mix(bg, fg, coverage). GPU cost is trivial at any resolution/DPR; CPU
// cost per frame is two small texture uploads and one draw call - no
// per-cell JS work at all, unlike every Canvas2D approach tried in the
// US-001 rework history (see RenderTargetCanvas2D.js).
//
// Public API matches RenderTargetCanvas2D.js exactly (see RenderTarget.js,
// the factory that picks between them): cols, rows, dpr, pxCellW, pxCellH,
// cellW, cellH, backend, setCell, setCellRGB, clear, present, resize.

import { CellBuffer } from './CellBuffer.js';
import { computeCellBox, FONT_STACK } from './glyphMetrics.js';
import { compileShader, linkProgram } from './gpu/glUtil.js';

const GLYPH_COUNT = 95; // printable ASCII 32-126

const VERTEX_SRC = `#version 300 es
// Fullscreen triangle from gl_VertexID alone - no vertex buffer needed.
// id 0,1,2 -> pos (0,0),(2,0),(0,2); after *2-1 this covers NDC [-1,3],
// which clips down to exactly the visible [-1,1]^2 square with vUv in [0,1]
// across that visible region.
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  vUv = pos;
}
`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFg;    // RGBA8 cols x rows, NEAREST: (r,g,b,glyphIdx)
uniform sampler2D uBg;    // RGBA8 cols x rows, NEAREST: (r,g,b,255)
uniform sampler2D uAtlas; // RGBA8 95 x 1 cells, LINEAR: coverage in .a
uniform vec2 uGrid;       // (cols, rows) - the SCENE grid on pass 0, the UI grid on pass 1
// OWN-REQ-003 (architecture.md 17.2): present() draws TWICE with this same
// program - pass 0 (uLayer=0) is the scene, unchanged; pass 1 (uLayer=1)
// rebinds uFg/uBg/uAtlas/uGrid to the UI layer's own textures/atlas/grid and
// discards every cell the UI layer didn't write this frame (bg.a < 0.5 -
// UiLayer.clear() zeroes bg alpha, CellBuffer.setCell* always writes 255,
// so bg.a doubles as the per-cell "was this written" mask). No blending -
// only discard - so a UI glyph keeps its own bg exactly (a hard cell edge,
// same rule as the scene's own cells - 17.2's "no alpha blending").
uniform int uLayer;

const float GLYPH_COUNT = ${GLYPH_COUNT.toFixed(1)};

void main() {
  // vUv.y=0 is the BOTTOM of the screen in GL clip space; flip so row 0 of
  // the grid (cell y=0) is the TOP of the screen, matching setCell(x,y,...).
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 cellPos = uv * uGrid;
  vec2 cellFrac = fract(cellPos);
  ivec2 cell = clamp(ivec2(floor(cellPos)), ivec2(0), ivec2(uGrid) - 1);

  vec4 fg = texelFetch(uFg, cell, 0);
  vec4 bg = texelFetch(uBg, cell, 0);
  if (uLayer == 1 && bg.a < 0.5) discard;
  float glyphIdx = floor(fg.a * 255.0 + 0.5);

  vec2 atlasUv = vec2((glyphIdx + cellFrac.x) / GLYPH_COUNT, cellFrac.y);
  float a = texture(uAtlas, atlasUv).a;

  fragColor = vec4(mix(bg.rgb, fg.rgb, a), 1.0);
}
`;

function createDataTexture(gl, unit, cols, rows) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class RenderTargetGL {
  constructor(canvas, cols, rows) {
    this.backend = 'gl2';
    this.canvas = canvas;
    this.cols = cols;
    this.rows = rows;
    this.cells = new CellBuffer(cols, rows);

    this.cellW = 1; this.cellH = 1;
    this.pxCellW = 1; this.pxCellH = 1;
    this.glyphAscent = 1;
    this.fontSize = 16;
    this.dpr = 1;

    this._contextLost = false;
    this._measureCanvas = document.createElement('canvas');
    this._measureCtx = this._measureCanvas.getContext('2d', { willReadFrequently: true });
    this._atlasCanvas = document.createElement('canvas');
    this._atlasCtx = this._atlasCanvas.getContext('2d', { willReadFrequently: true });

    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      this._initGL();
      this._rebuildAtlas();
      if (this._uiLayer) { this._buildUiTextures(); this._rebuildUiAtlas(); } // OWN-REQ-003
    });

    this._initGL();
    this.resize();
  }

  // (Re)builds the program, VAO and data textures. Called once at
  // construction and again after a WebGL context restore.
  _initGL() {
    const gl = this.gl;
    this.program = linkProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uFg'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uBg'), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uAtlas'), 2);
    this._uGrid = gl.getUniformLocation(this.program, 'uGrid');
    gl.uniform2f(this._uGrid, this.cols, this.rows);
    this._uLayer = gl.getUniformLocation(this.program, 'uLayer'); // OWN-REQ-003
    gl.uniform1i(this._uLayer, 0);

    // WebGL2 guarantees a default VAO, but bind an explicit (empty) one -
    // no vertex attributes are used (see the gl_VertexID trick above), it
    // just needs to exist and be bound while drawing.
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.fgTex = createDataTexture(gl, 0, this.cols, this.rows);
    this.bgTex = createDataTexture(gl, 1, this.cols, this.rows);

    this.atlasTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  // Rasterizes printable ASCII 32-126 once into an offscreen Canvas2D at
  // the current device-pixel cell size, as a 95x1-cell horizontal strip,
  // and uploads it as the LINEAR-filtered glyph atlas texture. Rebuilt only
  // on resize/DPR change (and on context restore).
  _rebuildAtlas() {
    const gl = this.gl;
    const w = this.pxCellW * GLYPH_COUNT;
    const h = this.pxCellH;
    const ac = this._atlasCanvas;
    ac.width = w;
    ac.height = h;
    const actx = this._atlasCtx;
    actx.clearRect(0, 0, w, h);
    actx.font = `${this.fontSize}px ${FONT_STACK}`;
    actx.textBaseline = 'alphabetic';
    actx.textAlign = 'left';
    actx.fillStyle = '#ffffff';
    for (let code = 32; code <= 126; code++) {
      const idx = code - 32;
      if (code === 32) continue; // space: leave fully transparent
      actx.fillText(String.fromCharCode(code), idx * this.pxCellW, this.glyphAscent);
    }

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, ac);
  }

  // OWN-REQ-003 (architecture.md 17.2): binds `ui` (an `engine/ui/uiLayer.js`
  // UiLayer) as a second, fixed-size cell grid `present()` draws over the
  // scene every frame (see the fragment shader's `uLayer` branch above).
  // Called once by `createEngine` and again by `engine.setGrid` (a new
  // RenderTarget instance - the UiLayer object itself is never re-created).
  setUiLayer(ui) {
    this._uiLayer = ui;
    if (this._contextLost) return;
    this._buildUiTextures();
    this._rebuildUiAtlas();
  }

  // (Re)builds the UI layer's own fg/bg data textures, sized to `ui.cols x
  // ui.rows` (fixed for the run - see uiLayer.js) - a THIRD pair of texture
  // units (3, 4) so the scene's own fg/bg stay bound at units 0/1 for
  // `readbackPresent` (14.2 item 8's parity contract - `?gpucompare=1` reads
  // back "whatever is bound on units 0/1", which must stay the SCENE).
  _buildUiTextures() {
    const gl = this.gl;
    const ui = this._uiLayer;
    if (this._uiFgTex) { gl.deleteTexture(this._uiFgTex); gl.deleteTexture(this._uiBgTex); }
    this._uiFgTex = createDataTexture(gl, 3, ui.cols, ui.rows);
    this._uiBgTex = createDataTexture(gl, 4, ui.cols, ui.rows);
    if (!this._uiAtlasTex) {
      this._uiAtlasTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this._uiAtlasTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }

  // Same idea as `_rebuildAtlas`, but rasterized at the UI layer's own
  // (larger) cell size - `fontPx * sy` (architecture.md 17.2): `ui.sy` is the
  // scene-to-UI scale factor (>= 1, since the UI grid is fixed at <= the
  // scene grid), so UI glyphs stay legible however small the scene's own
  // cells get at 240x90/320x120.
  _rebuildUiAtlas() {
    const ui = this._uiLayer;
    if (!ui || this._contextLost) return;
    const gl = this.gl;
    const uiFontPx = this.fontSize * ui.sy;
    const uiPxCellW = this.pxCellW * ui.sx;
    const uiPxCellH = this.pxCellH * ui.sy;
    const uiGlyphAscent = this.glyphAscent * ui.sy;

    const ac = this._atlasCanvas;
    const w = uiPxCellW * GLYPH_COUNT;
    const h = uiPxCellH;
    ac.width = w;
    ac.height = h;
    const actx = this._atlasCtx;
    actx.clearRect(0, 0, w, h);
    actx.font = `${uiFontPx}px ${FONT_STACK}`;
    actx.textBaseline = 'alphabetic';
    actx.textAlign = 'left';
    actx.fillStyle = '#ffffff';
    for (let code = 32; code <= 126; code++) {
      const idx = code - 32;
      if (code === 32) continue;
      actx.fillText(String.fromCharCode(code), idx * uiPxCellW, uiGlyphAscent);
    }

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this._uiAtlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, ac);
  }

  // `refAvailW`/`refAvailH`/`refDpr` (all optional) override the
  // window-derived box with a fixed one - used ONLY by `?gpucompare=1`/
  // `?gpucompare=shade` (main.js) so the GPU and CPU/JS oracle both cast
  // against an identical, window-size-independent pxCellW/pxCellH (and
  // therefore identical `screenAspect`, see sectorCaster.js/GpuCellPipeline.
  // js/sprites.js). Normal gameplay never passes these - `resize()` with no
  // args is byte-for-byte the old window-derived behaviour.
  resize(refAvailW, refAvailH, refDpr) {
    const dpr = refDpr != null ? refDpr : (window.devicePixelRatio || 1);
    const availW = refAvailW != null ? refAvailW : window.innerWidth;
    const availH = refAvailH != null ? refAvailH : window.innerHeight;
    if (availW <= 0 || availH <= 0) return; // see RenderTargetCanvas2D.js for why

    this.dpr = dpr;
    const box = computeCellBox(this._measureCtx, this.cols, this.rows, availW * dpr, availH * dpr);
    this.fontSize = box.fontPx;
    this.pxCellW = box.pxCellW;
    this.pxCellH = box.pxCellH;
    this.glyphAscent = box.glyphAscent;
    this.cellW = this.pxCellW / dpr;
    this.cellH = this.pxCellH / dpr;

    const cssW = this.cellW * this.cols;
    const cssH = this.cellH * this.rows;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = this.pxCellW * this.cols;
    this.canvas.height = this.pxCellH * this.rows;

    if (this._contextLost) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform2f(this._uGrid, this.cols, this.rows);
    this._rebuildAtlas();
    if (this._uiLayer) this._rebuildUiAtlas(); // OWN-REQ-003: UI cell size tracks the scene's (fontPx/pxCell change on resize/DPR)
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

  // US-029 tech notes item 4: lets a `GpuCellPipeline` run its shade/edge
  // passes between the cell uploads and the draw, without this file knowing
  // anything about the GPU pipeline (D-006: no tower/game-specific code
  // here, and no upward dependency on engine/render/gpu/). `fn` runs with
  // its own framebuffer/program/viewport state; `present()` re-binds its
  // own program, texture units 0-2 and `bindFramebuffer(null)` + the canvas
  // viewport right after, so it never relies on state surviving the hook.
  setCellPass(fn) {
    this._cellPass = fn || null;
  }

  // US-030c: a second slot, run right after the cell pass (sprite composite
  // - engine/render/gpu/spritesPass.js). Same contract as `setCellPass`.
  setSpritePass(fn) {
    this._spritePass = fn || null;
  }

  // Test-only (`?gpucompare=*`, never the frame loop - readPixels stalls the
  // GPU): reads back EXACTLY the two cell textures the last `present()` draw
  // sampled - whatever is bound on texture units 0 (`uFg`) and 1 (`uBg`)
  // right now - rather than `this.fgTex`/`this.bgTex` by name. So a pipeline
  // hook that writes correct cells into some texture present() does NOT
  // sample (or leaves the wrong one bound) fails a parity check instead of
  // passing it. Call it right after `present()`, before any other GL work.
  // `sampledOwnTextures` is false when units 0/1 hold something other than
  // this target's own fg/bg textures (a present() wiring bug, not a shading
  // one). Buffers are reused across calls when `outFg`/`outBg` are omitted.
  readbackPresent(outFg, outBg) {
    const gl = this.gl;
    const n = this.cols * this.rows * 4;
    outFg = outFg || (this._rbFg = this._rbFg || new Uint8Array(n));
    outBg = outBg || (this._rbBg = this._rbBg || new Uint8Array(n));
    gl.activeTexture(gl.TEXTURE0);
    const fgBound = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.activeTexture(gl.TEXTURE1);
    const bgBound = gl.getParameter(gl.TEXTURE_BINDING_2D);
    if (!fgBound || !bgBound) throw new Error('readbackPresent: no cell texture bound on unit 0/1 - call it right after present()');
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fgBound, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, outFg);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bgBound, 0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, outBg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return { fg: outFg, bg: outBg, sampledOwnTextures: fgBound === this.fgTex && bgBound === this.bgTex };
  }

  present() {
    if (this._contextLost) return;
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.cells.fg);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.cells.bg);

    if (this._cellPass) this._cellPass();
    if (this._spritePass) this._spritePass(); // US-030c

    // A texture is never read AND written in the same pass (14.1 section
    // 4) - the hook may have left its own program/framebuffer/units bound,
    // so restore everything present()'s own draw needs before drawing.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // OWN-REQ-003 (architecture.md 17.2): a second fullscreen-triangle draw
    // with the SAME program, over the scene just drawn - `uLayer=1` cells
    // with `bg.a < 0.5` (nothing written by the UI layer this frame) are
    // discarded, so only the scene shows through there; every written UI
    // cell replaces the scene pixel outright (no blending, per 17 "Do not").
    // Units 0/1/2 are rebound to the scene's own fg/bg/atlas right after, so
    // `readbackPresent` (called right after `present()` by `?gpucompare=1`)
    // still reads exactly the scene textures it always has (17.6: the UI
    // layer never enters that parity comparison).
    if (this._uiLayer && this._uiFgTex) {
      const ui = this._uiLayer;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._uiFgTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ui.cols, ui.rows, gl.RGBA, gl.UNSIGNED_BYTE, ui.cells.fg);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._uiBgTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ui.cols, ui.rows, gl.RGBA, gl.UNSIGNED_BYTE, ui.cells.bg);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this._uiAtlasTex);

      gl.uniform1i(this._uLayer, 1);
      gl.uniform2f(this._uGrid, ui.cols, ui.rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Restore scene state (units 0/1/2 + uniforms) for readbackPresent/the next frame.
      gl.uniform1i(this._uLayer, 0);
      gl.uniform2f(this._uGrid, this.cols, this.rows);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    }
  }
}
