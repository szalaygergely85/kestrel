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
uniform vec2 uGrid;       // (cols, rows)

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
  float glyphIdx = floor(fg.a * 255.0 + 0.5);

  vec2 atlasUv = vec2((glyphIdx + cellFrac.x) / GLYPH_COUNT, cellFrac.y);
  float a = texture(uAtlas, atlasUv).a;

  fragColor = vec4(mix(bg.rgb, fg.rgb, a), 1.0);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + info);
  }
  return sh;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link failed: ' + info);
  }
  return program;
}

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

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const availW = window.innerWidth;
    const availH = window.innerHeight;
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

  present() {
    if (this._contextLost) return;
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.cells.fg);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.cells.bg);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
