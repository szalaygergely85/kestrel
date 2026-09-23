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
import { linkProgram, createTexture2D } from './glUtil.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { spritesFragSrc } from './glsl/sprites.frag.js';
import { GpuTimer } from './GpuTimer.js';
import { MAX_SPRITES, SPR_TEXELS, SPR_STRIDE } from '../sprites.js';

const UNIFORMS = ['uGI', 'uDepth', 'uEdgeFg', 'uEdgeBg', 'uSpr', 'uAtlas', 'uPal', 'uCount', 'uFogColor'];

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
    const units = ['uGI', 'uDepth', 'uEdgeFg', 'uEdgeBg', 'uSpr', 'uAtlas', 'uPal'];
    for (let i = 0; i < units.length; i++) gl.uniform1i(this.loc[units[i]], i);
    const fogC = this.palette.rgb[this.palette.fog.interior.color];
    gl.uniform3f(this.loc.uFogColor, fogC[0], fogC[1], fogC[2]);

    this.timer = new GpuTimer(gl);
  }

  _restore() {
    // RenderTargetGL and GpuCellPipeline restore first (listener order ==
    // registration order); rt.fgTex/bgTex are new objects by now.
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

  dispose() {
    this.rt.canvas.removeEventListener('webglcontextlost', this._onCtxLost);
    this.rt.canvas.removeEventListener('webglcontextrestored', this._onCtxRestored);
    this.rt.setSpritePass(null);
    const gl = this.gl;
    if (!gl) return;
    for (const t of [this.texEdgeFg, this.texEdgeBg, this.texSpr, this.texPal, this.texAtlas]) if (t) gl.deleteTexture(t);
    if (this.fboFinal) gl.deleteFramebuffer(this.fboFinal);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
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
    gl.uniform1i(this.loc.uCount, count);
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
