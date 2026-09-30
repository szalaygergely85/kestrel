// RE-07b GPU overlay composite (docs/architecture.md 28.9 items 2, 4, 6). The overlay cells are
// rasterised in JS (engine/ui/overlay.js `flush`, shared with the CPU path); this pass only uploads
// the dirty rows of that layer (`ovl` RGBA8 + `ovlZ` R32F) and, per cell, runs the depth compare
// `ref <= sceneDepth + max(OVL_BIAS_M, OVL_BIAS_REL*ref)` = the GLSL twin of `applyOverlay`.
// Output: a fullscreen triangle into an FBO with ONLY rt.fgTex attached (glyph + fg; bg stays),
// empty / hidden cells `discard`. Runs from `RenderTargetGL.setOverlayPass`, after the sprite
// pass (fade/dim) and before present()'s draw. Pass + upload are skipped when neither this frame
// nor the last had overlay cells. Not Node-testable (needs gl); GPU parity = `?gpucompare` pose rtsOverlay.
import { linkProgram, createTexture2D, deleteTexture2D } from './glUtil.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { GLSL_VERSION, PRECISION } from './glsl/common.js';
import { GpuTimer } from './GpuTimer.js';
import { OVL_BIAS_M, OVL_BIAS_REL } from '../../ui/overlay.js';

/** @param {{depthUint?: boolean}} [o] */
export function overlayFragSrc({ depthUint = true } = {}) {
  const depthDecl = depthUint
    ? 'uniform usampler2D uDepth;\nfloat depthAt(ivec2 c) { return uintBitsToFloat(texelFetch(uDepth, c, 0).r); }'
    : 'uniform sampler2D uDepth;\nfloat depthAt(ivec2 c) { return texelFetch(uDepth, c, 0).r; }';
  return `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 outFg;
uniform sampler2D uOvl;   // RGBA8: rgb colour, a = glyph index (0 = empty cell)
uniform sampler2D uOvlZ;  // R32F: ref depth (0 = no depth test)
${depthDecl}
const float BIAS_M = ${OVL_BIAS_M.toFixed(6)};
const float BIAS_REL = ${OVL_BIAS_REL.toFixed(6)};

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 o = texelFetch(uOvl, cell, 0);
  float g = floor(o.a * 255.0 + 0.5);
  if (g < 0.5) discard;
  float ref = texelFetch(uOvlZ, cell, 0).r;
  if (ref > 0.0) {
    float d = depthAt(cell);
    if (d < 1.0e5) { // sky / horizon depth (inf, 1e6) always passes
      if (ref > d + max(BIAS_M, BIAS_REL * ref)) discard;
    }
  }
  outFg = o; // rgb + glyph byte exactly as stored (CellBuffer fg layout: a duplicates the glyph)
}
`;
}

export class GpuOverlayPass {
  /**
   * @param {import('../RenderTargetGL.js').RenderTargetGL} rt
   * @param {import('./GpuCellPipeline.js').GpuCellPipeline} pipeline - texDepth source (looked up at run time)
   * @param {any} overlay - engine.overlay (layer arrays + dirty rows, engine/ui/overlay.js)
   * @param {{depthUint?: boolean}} [opts]
   */
  constructor(rt, pipeline, overlay, opts = {}) {
    this.rt = rt; this.gl = rt.gl; this.pipeline = pipeline; this.overlay = overlay;
    this.depthUint = opts.depthUint !== false;
    this.ready = false;
    this.cols = 0; this.rows = 0; this._fgTex = null; this._fullUpload = true; this._ovlRef = null;
    this.stats = { uploadMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN, rows: 0, runs: 0 };
    rt.overlayPassStats = this.stats; // F3 / gpucompare read the pass timer here
    this._onCtxLost = () => { this.ready = false; };
    this._onCtxRestored = () => {
      try { this._initGL(); this.ready = true; rt.setOverlayPass(() => this.run()); } catch (e) { console.warn('[GpuOverlayPass] restore failed:', e); }
    };
    rt.canvas.addEventListener('webglcontextlost', this._onCtxLost);
    rt.canvas.addEventListener('webglcontextrestored', this._onCtxRestored);
    try {
      this._initGL();
      this.ready = true;
      rt.setOverlayPass(() => this.run());
    } catch (e) {
      console.warn('[GpuOverlayPass] init failed, overlay stays on the CPU composite:', e);
      this.dispose();
    }
  }

  _initGL() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    this.program = linkProgram(gl, CELL_VERT_SRC, overlayFragSrc({ depthUint: this.depthUint }));
    this.loc = {
      uOvl: gl.getUniformLocation(this.program, 'uOvl'),
      uOvlZ: gl.getUniformLocation(this.program, 'uOvlZ'),
      uDepth: gl.getUniformLocation(this.program, 'uDepth'),
    };
    gl.useProgram(this.program);
    gl.uniform1i(this.loc.uOvl, 0); gl.uniform1i(this.loc.uOvlZ, 1); gl.uniform1i(this.loc.uDepth, 2);
    this.fbo = gl.createFramebuffer();
    this.timer = new GpuTimer(gl);
    this.texOvl = null; this.texOvlZ = null; this.cols = 0; this.rows = 0; this._fgTex = null;
    this._sync();
  }

  /** (Re)creates the layer textures / re-attaches rt.fgTex after a grid change (rt replaces fgTex in setGrid). */
  _sync() {
    const gl = this.gl, rt = this.rt;
    if (rt.cols !== this.cols || rt.rows !== this.rows) {
      deleteTexture2D(gl, this.texOvl); deleteTexture2D(gl, this.texOvlZ);
      this.texOvl = createTexture2D(gl, gl.RGBA8, rt.cols, rt.rows);
      this.texOvlZ = createTexture2D(gl, gl.R32F, rt.cols, rt.rows);
      this.cols = rt.cols; this.rows = rt.rows;
      this._fullUpload = true;
    }
    if (rt.fgTex !== this._fgTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.fgTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GpuOverlayPass: fbo incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._fgTex = rt.fgTex;
    }
  }

  dispose() {
    this.rt.canvas.removeEventListener('webglcontextlost', this._onCtxLost);
    this.rt.canvas.removeEventListener('webglcontextrestored', this._onCtxRestored);
    this.rt.setOverlayPass(null);
    const gl = this.gl;
    if (!gl) return;
    deleteTexture2D(gl, this.texOvl); deleteTexture2D(gl, this.texOvlZ);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
    this.ready = false;
  }

  /** True when the GPU composites the overlay this frame (the CPU `renderCpu` must then not run). */
  get active() { return this.ready && this.rt.gpuActive && this.pipeline.ready; }

  run() {
    if (!this.active) return;
    const ov = this.overlay;
    // layer not bound to the scene grid yet (engine rebinds on grid:changed, the next flush follows)
    if (ov.cols !== this.rt.cols || ov.rows !== this.rt.rows) return;
    const hasNow = ov.stats.cells > 0;
    const hadPrev = ov.prevMaxRow >= 0;
    if (!hasNow && !hadPrev) { this.stats.rows = 0; return; }
    const gl = this.gl;
    this._sync();
    // RE-07b review: `overlay.bind` swaps in fresh arrays on every accepted grid request, also at the
    // same size (prev rows reset) - the texture still holds the old rows, so re-upload everything once.
    if (ov.ovl !== this._ovlRef) { this._ovlRef = ov.ovl; this._fullUpload = true; }
    const t0 = performance.now();
    const cols = this.cols;
    // dirty rows = this frame's touched rows + last frame's (wiped) rows
    let r0 = this.rows, r1 = -1;
    if (hasNow) { r0 = ov.minRow; r1 = ov.maxRow; }
    if (hadPrev) { if (ov.prevMinRow < r0) r0 = ov.prevMinRow; if (ov.prevMaxRow > r1) r1 = ov.prevMaxRow; }
    if (this._fullUpload) { r0 = 0; r1 = this.rows - 1; this._fullUpload = false; }
    if (r1 >= r0) {
      const nr = r1 - r0 + 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texOvl);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, cols, nr, gl.RGBA, gl.UNSIGNED_BYTE, ov.ovl, r0 * cols * 4);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texOvlZ);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, cols, nr, gl.RED, gl.FLOAT, ov.ovlZ, r0 * cols);
      this.stats.rows = nr;
    }
    const t1 = performance.now();
    if (hasNow) {
      this.timer.begin();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, cols, this.rows);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texOvl);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texOvlZ);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.pipeline.texDepth);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.timer.end();
      this.timer.writeStats(this.stats);
    }
    this.stats.uploadMs = t1 - t0;
    this.stats.runs++;
  }
}
