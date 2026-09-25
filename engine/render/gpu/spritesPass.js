// US-030c GPU sprite pass (docs/architecture.md 14.2 item 4, pass F). Owns
// its own program, the SPR list texture, the atlas/palette textures, the
// `edgeFg/edgeBg` copies and an FBO on rt.fgTex/bgTex. Runs from
// `RenderTargetGL.setSpritePass` right after `GpuCellPipeline`'s cell hook
// (present(): uploads -> cell pass -> sprite pass -> draw), reading the
// pipeline's `texGI`/`texDepth` (looked up at run time - a context restore
// recreates them).
//
// Deviation from 14.2 item 3/4 (flagged for architect review): the edge
// pass is NOT re-targeted to `edgeFg/edgeBg` inside GpuCellPipeline.js
// (US-030a owns that file this round). Instead this pass copies the edge
// output out of rt.fgTex/bgTex with two `copyTexSubImage2D` calls (2 x
// cols*rows*4 bytes on the GPU, no readback) and then draws back into
// rt.fgTex/bgTex reading the copies - the same "never read and write one
// texture in a pass" rule (14.1 section 4), one extra GPU-side copy. When
// 030a lands, `_passEdgeOrDebug` can bind this pass's `fboEdge` instead of
// `fboFinal` and the copy goes away (`run()` then skips `_copyEdge`).
//
// Not Node-testable (needs gl); the pure pieces are spritesAtlas.js,
// sprites.js and glsl/sprites.frag.js (sprites.test.js).
import { linkProgram, createTexture2D, deleteTexture2D, createFramebuffer2D, deleteFramebuffer2D } from './glUtil.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { spritesFragSrc } from './glsl/sprites.frag.js';
import { GpuTimer } from './GpuTimer.js';
import { MAX_SPRITES, SPR_TEXELS, SPR_STRIDE } from '../sprites.js';

const UNIFORMS = ['uGI', 'uDepth', 'uEdgeFg', 'uEdgeBg', 'uSpr', 'uAtlas', 'uPal', 'uCount',
  'uSceneFade', 'uFadeMinGain', 'uFadeRampLen', 'uFadeLut', 'uFadeRamp', // US-017
  'uDimAll', 'uDimCount', 'uDimRect', 'uDimMul']; // US-015 (docs/architecture.md 7.6 item 3)

export class GpuSpritePass {
  /**
   * @param {import('../RenderTargetGL.js').RenderTargetGL} rt
   * @param {import('./GpuCellPipeline.js').GpuCellPipeline} pipeline - ready pipeline (texGI/texDepth source)
   * @param {import('../sprites.js').SpritePool} pool - projected each frame by the caller
   * @param {ReturnType<import('./spritesAtlas.js').buildSpriteAtlas>} atlas
   * @param {Object} palette - `assets.palette` (fog.interior colour)
   * @param {{depthUint?: boolean}} [opts] - false only against the US-029 R32F depth texture
   */
  constructor(rt, pipeline, pool, atlas, palette, opts = {}) {
    this.rt = rt;
    this.gl = rt.gl;
    this.pipeline = pipeline;
    this.pool = pool;
    this.atlas = atlas;
    this.palette = palette;
    this.depthUint = opts.depthUint !== false;
    this.cols = rt.cols;
    this.rows = rt.rows;
    this.ready = false;
    this.stats = { uploadMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN, sprites: 0 };
    // US-017: per-frame scene fade. `sceneFade` (1 = off) is set by the
    // caller (spriteDev.js's `render()`, or the `?gpucompare=1` harness)
    // every frame, mirroring `fb.sceneFade`; `setFadeLut` uploads the LUT
    // once per identity change (the FadeLut object is built once in
    // main.js and never mutated).
    this.sceneFade = 1;
    this.fadeMinGain = 0;
    this.fadeRampLen = 1;
    this._fadeLutRef = null;
    // US-015: per-frame scene dim, mirrors `fb.sceneDim` (engine/ui/
    // sceneDim.js `SceneDim`) exactly like `sceneFade`/`fadeLut` above -
    // `setSceneDim` copies the caller's `{all, n, rects}` every frame (no
    // texture, just 4 rects worth of uniforms - see `run()`).
    this.dimAll = 1;
    this.dimCount = 0;
    this.dimRect = new Float32Array(16); // 4 rects x (x0,y0,x1,y1)
    this.dimMul = new Float32Array(4);
    this._onCtxLost = () => { if (this.ready) { this.ready = false; console.warn('[GpuSpritePass] WebGL context lost, sprites fall back to drawSprites'); } };
    this._onCtxRestored = () => this._restore();
    rt.canvas.addEventListener('webglcontextlost', this._onCtxLost);
    rt.canvas.addEventListener('webglcontextrestored', this._onCtxRestored);
    try {
      this._initGL();
      this.ready = true;
      rt.setSpritePass(() => this.run());
    } catch (e) {
      console.warn('[GpuSpritePass] init failed, sprites stay on drawSprites:', e);
      this.ready = false;
      this.dispose();
    }
  }

  _initGL() {
    const gl = this.gl, cols = this.cols, rows = this.rows;
    this._fadeLutRef = null; // US-017: force reupload after a (re)create/context-restore
    this.vao = gl.createVertexArray();
    this.program = linkProgram(gl, CELL_VERT_SRC, spritesFragSrc({ depthUint: this.depthUint }));
    this.loc = {};
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(this.program, name);

    this.texEdgeFg = createTexture2D(gl, gl.RGBA8, cols, rows);
    this.texEdgeBg = createTexture2D(gl, gl.RGBA8, cols, rows);
    this.texSpr = createTexture2D(gl, gl.RGBA32F, SPR_TEXELS, MAX_SPRITES);
    this.texPal = createTexture2D(gl, gl.RGBA32F, this.atlas.pal.length / 4, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texPal);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.atlas.pal.length / 4, 1, gl.RGBA, gl.FLOAT, this.atlas.pal);
    // RGBA8UI is not in glUtil's formatFor table (030a's file) - created here.
    this.texAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, this.atlas.width, this.atlas.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, this.atlas.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // US-017: fade LUT textures - zero-initialised (createTexture2D's null
    // data) dummies so binding is always valid before `setFadeLut` ever
    // runs (test/compare call sites that never wire up a fade); harmless
    // since the shader's fade branch is skipped whenever `uSceneFade >= 1`.
    this.texFadeLut = createTexture2D(gl, gl.R8UI, 128, 1);
    this.texFadeRamp = createTexture2D(gl, gl.R8UI, 1, 1);
    this._fadeRampTexLen = 1;

    // One FBO on rt.fgTex/bgTex: READ side for the edge copies, DRAW side for the composite.
    this.fboFinal = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt.fgTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.rt.bgTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GpuSpritePass: fboFinal incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Static uniforms: sampler units (bind order below) + fog colour.
    gl.useProgram(this.program);
    const units = ['uGI', 'uDepth', 'uEdgeFg', 'uEdgeBg', 'uSpr', 'uAtlas', 'uPal', 'uFadeLut', 'uFadeRamp'];
    for (let i = 0; i < units.length; i++) gl.uniform1i(this.loc[units[i]], i);
    // US-016 (14.4 item 14): fog colour is now per-sprite (SPR T4, resolved
    // in `SpritePool.project()`), not a single static uniform.

    this.timer = new GpuTimer(gl);
  }

  _restore() {
    // RenderTargetGL and GpuCellPipeline restore first (listener order ==
    // registration order); rt.fgTex/bgTex are new objects by now.
    //
    // Architect review 1 item 1: a `resizeGrid` call that arrived while this
    // pass was `!ready` early-returns without updating `cols/rows`, so they
    // can be stale relative to `rt`'s new size by the time a restore fires.
    // Re-read from `rt` before `_initGL()` so a restore always rebuilds at
    // the CURRENT grid.
    this.cols = this.rt.cols;
    this.rows = this.rt.rows;
    try {
      this._initGL();
      this.ready = true;
      this.rt.setSpritePass(() => this.run());
      console.log('[GpuSpritePass] WebGL context restored');
    } catch (e) {
      console.warn('[GpuSpritePass] restore failed:', e);
      this.ready = false;
    }
  }

  /**
   * D-025 (US-038a, architecture.md 22.3): live grid change - resize in
   * place, no shader recompile. `texEdgeFg/Bg` are this pass's own
   * grid-sized copies (`_copyEdge`); `fboFinal` attaches `rt.fgTex/bgTex`
   * directly, which `RenderTargetGL.setGrid` has ALREADY replaced by the
   * time this runs (engine.js's `applyGrid` order: rt first) - so this FBO
   * must be recreated too, even though the architecture's per-object table
   * only calls out `texEdgeFg/Bg` + `cols/rows` by name (its attachments
   * would otherwise point at deleted GL objects).
   */
  resizeGrid(cols, rows) {
    if (!this.ready) return;
    const gl = this.gl;
    this.cols = cols;
    this.rows = rows;
    deleteTexture2D(gl, this.texEdgeFg);
    deleteTexture2D(gl, this.texEdgeBg);
    this.texEdgeFg = createTexture2D(gl, gl.RGBA8, cols, rows);
    this.texEdgeBg = createTexture2D(gl, gl.RGBA8, cols, rows);
    deleteFramebuffer2D(gl, this.fboFinal);
    this.fboFinal = createFramebuffer2D(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt.fgTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.rt.bgTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GpuSpritePass.resizeGrid: fboFinal incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    this.rt.canvas.removeEventListener('webglcontextlost', this._onCtxLost);
    this.rt.canvas.removeEventListener('webglcontextrestored', this._onCtxRestored);
    this.rt.setSpritePass(null);
    const gl = this.gl;
    if (!gl) return;
    for (const t of [this.texEdgeFg, this.texEdgeBg, this.texSpr, this.texPal, this.texAtlas, this.texFadeLut, this.texFadeRamp]) if (t) gl.deleteTexture(t);
    if (this.fboFinal) gl.deleteFramebuffer(this.fboFinal);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
  }

  /**
   * US-017: upload `lut` (`engine/ui/fade.js`'s `FadeLut`, `{idx, ramp,
   * minGain}`) once per identity change - main.js builds it once at
   * startup, so this is a no-op every frame after the first. `idx`
   * (128 bytes) and `ramp` (rampLen bytes, rarely a multiple of 4) are
   * R8UI: `UNPACK_ALIGNMENT = 1` for the upload, restored to the GL
   * default (4) right after (reminder: non-4-aligned R8UI uploads read
   * garbage past row 0 without this).
   * @param {import('../../ui/fade.js').FadeLut} lut
   */
  setFadeLut(lut) {
    if (!lut || this._fadeLutRef === lut) return;
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texFadeLut);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, lut.idx);
    if (lut.ramp.length !== this._fadeRampTexLen) {
      gl.deleteTexture(this.texFadeRamp);
      this.texFadeRamp = createTexture2D(gl, gl.R8UI, lut.ramp.length, 1);
      this._fadeRampTexLen = lut.ramp.length;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texFadeRamp);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, lut.ramp.length, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, lut.ramp);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.fadeMinGain = lut.minGain;
    this.fadeRampLen = lut.ramp.length;
    this._fadeLutRef = lut;
  }

  /**
   * US-015: copies this frame's `SceneDim` (`{all, n, rects:Float32Array(20)}`,
   * `x0,y0,x1,y1,mul` per rect) into the plain per-uniform fields `run()`
   * uploads - no texture needed (at most 4 rects). A no-op call (`dim`
   * falsy) leaves the previous frame's values, same "caller sets it every
   * frame" contract as `sceneFade`.
   * @param {{all:number, n:number, rects:Float32Array}|null} dim
   */
  setSceneDim(dim) {
    if (!dim) return;
    this.dimAll = dim.all;
    this.dimCount = dim.n;
    for (let i = 0; i < dim.n * 5; i++) {
      const rectI = Math.floor(i / 5), field = i % 5;
      if (field === 4) this.dimMul[rectI] = dim.rects[i];
      else this.dimRect[rectI * 4 + field] = dim.rects[i];
    }
  }

  /** True when this pass draws the sprites this frame (else the caller runs `drawSprites`). */
  get active() {
    return this.ready && this.rt.gpuActive && this.pipeline.ready;
  }

  // Called from RenderTargetGL.present() after the cell pass. Even with
  // zero sprites the copy + composite runs (the pass output IS rt.fgTex/
  // bgTex), so the frame path is the same every frame.
  run() {
    if (!this.active) return;
    const gl = this.gl, pool = this.pool;
    const t0 = performance.now();
    this.timer.begin();
    const count = Math.min(pool.count, MAX_SPRITES);
    if (count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.texSpr);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPR_TEXELS, count, gl.RGBA, gl.FLOAT, pool.spr, 0);
    }
    this._copyEdge();
    const t1 = performance.now();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    this._bind(0, this.pipeline.texGI);
    this._bind(1, this.pipeline.texDepth);
    this._bind(2, this.texEdgeFg);
    this._bind(3, this.texEdgeBg);
    this._bind(4, this.texSpr);
    this._bind(5, this.texAtlas);
    this._bind(6, this.texPal);
    this._bind(7, this.texFadeLut);
    this._bind(8, this.texFadeRamp);
    gl.uniform1i(this.loc.uCount, count);
    // US-017: per-frame scene fade, matches CPU `applySceneFade` exactly.
    gl.uniform1f(this.loc.uSceneFade, this.sceneFade);
    gl.uniform1f(this.loc.uFadeMinGain, this.fadeMinGain);
    gl.uniform1i(this.loc.uFadeRampLen, this.fadeRampLen);
    // US-015: scene dim, matches CPU `applySceneDim` exactly.
    gl.uniform1f(this.loc.uDimAll, this.dimAll);
    gl.uniform1i(this.loc.uDimCount, this.dimCount);
    gl.uniform4fv(this.loc.uDimRect, this.dimRect);
    gl.uniform1fv(this.loc.uDimMul, this.dimMul);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.timer.end();
    const t2 = performance.now();
    this.stats.uploadMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    this.stats.sprites = count;
    this.timer.writeStats(this.stats);
  }

  _copyEdge() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboFinal);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindTexture(gl.TEXTURE_2D, this.texEdgeFg);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.cols, this.rows);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindTexture(gl.TEXTURE_2D, this.texEdgeBg);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.cols, this.rows);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  _bind(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }
}
