// US-029 GPU cell pipeline (docs/backlog.md US-029 tech notes, docs/
// architecture.md 14.1). Owns the FBOs, G-buffer + data textures, staging
// arrays, programs, `frame()`, the present hook and `stats`/`ready`. Not
// Node-testable (needs `gl`) - see ShadeTextures.test.js/gpuCompare.test.js/
// glsl.test.js for the Node-testable pieces this file assembles.
//
// Lifecycle: `new GpuCellPipeline(rt)` (rt = a ready RenderTargetGL) tries to
// compile/link everything; on any failure it logs a warning and leaves
// `ready = false` (the caller/bootstrap runs the JS passes instead - the
// game must still run, tech notes item 9). `bind(table)` is called once at
// construction and again whenever `bindShading` reruns (resize -> cellAspect
// change, `?detail=0` toggle - though `?detail=0` implies `allV2` is false,
// so the pipeline would not have been constructed at all in that case).
import { compileShader, linkProgram, createTexture2D, isSoftwareRenderer } from './glUtil.js';
import { packMaterialTable } from './ShadeTextures.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { SHADE_FRAG_SRC } from './glsl/shade.frag.js';
import { EDGE_FRAG_SRC } from './glsl/edge.frag.js';
import { DEBUG_FRAG_SRC } from './glsl/debug.frag.js';
import { GpuTimer } from './GpuTimer.js';

export class GpuCellPipeline {
  constructor(rt) {
    this.rt = rt;
    this.gl = rt.gl;
    this.cols = rt.cols;
    this.rows = rt.rows;
    this.ready = false;
    this.stats = { uploadMs: 0, repackMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN };
    this.debugMode = -1; // -1 = off (edge pass runs normally)
    this._fb = null;
    this._light = null;
    try {
      this._initGL();
      this.ready = true;
      // US-029: `rt.gpuActive` is the flag `shadeSurfaces`/`edgePass` (both
      // engine/render/*.js, not owned by US-025) check to no-op the CPU
      // shading/edge passes for this frame - see detailShade.js/edgePass.js.
      // Setting it here means compositor.js (US-025, in review, off-limits
      // this story) needs no change at all: it keeps calling shadeSurfaces/
      // edgePass exactly as before; they just do nothing while the GPU owns
      // the frame, and the present() hook (below) does the real work.
      this.setEnabled(true);
    } catch (e) {
      console.warn('[GpuCellPipeline] init failed, falling back to CPU shading:', e);
      this.ready = false;
      this.rt.gpuActive = false;
      this.dispose();
    }
  }

  _initGL() {
    const gl = this.gl;
    const { isSoftware, renderer } = isSoftwareRenderer(gl);
    this.rendererString = renderer;
    if (isSoftware) throw new Error('software renderer: ' + renderer);

    const n = this.cols * this.rows;
    this.vao = gl.createVertexArray();

    this.progShade = linkProgram(gl, CELL_VERT_SRC, SHADE_FRAG_SRC);
    this.progEdge = linkProgram(gl, CELL_VERT_SRC, EDGE_FRAG_SRC);
    this.progDebug = linkProgram(gl, CELL_VERT_SRC, DEBUG_FRAG_SRC);

    // --- G-buffer textures (per-frame upload targets) ---
    this.texGI = createTexture2D(gl, gl.RG32UI, this.cols, this.rows);
    this.texGA = createTexture2D(gl, gl.RGBA32F, this.cols, this.rows);
    this.texGD = createTexture2D(gl, gl.RGBA32F, this.cols, this.rows);
    this.texDepth = createTexture2D(gl, gl.R32F, this.cols, this.rows);

    // --- pipeline-owned pass-1 output ---
    this.texShadeFg = createTexture2D(gl, gl.RGBA8, this.cols, this.rows);
    this.texShadeBg = createTexture2D(gl, gl.RGBA8, this.cols, this.rows);

    // --- data textures (rebuilt on bind()) ---
    this.texMatF = createTexture2D(gl, gl.RGBA32F, 1, 1);
    this.texMatI = createTexture2D(gl, gl.RGBA32I, 1, 1);
    this.texSetI = createTexture2D(gl, gl.RGBA32I, 1, 1);
    this.texSetF = createTexture2D(gl, gl.R32F, 1, 1);
    this.texGain = createTexture2D(gl, gl.R32F, 256, 1);

    // --- FBOs ---
    this.fboShade = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShade);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texShadeFg, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texShadeBg, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboShade incomplete');

    this.fboFinal = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt.fgTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.rt.bgTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboFinal incomplete');

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- staging arrays (allocated once, architecture.md 9: no per-frame allocation) ---
    this._GI = new Uint32Array(2 * n);
    this._GA = new Float32Array(4 * n);
    this._GD = new Float32Array(4 * n);

    this._locsShade = this._uniformLocs(this.progShade, SHADE_UNIFORMS);
    this._locsEdge = this._uniformLocs(this.progEdge, EDGE_UNIFORMS);
    this._locsDebug = this._uniformLocs(this.progDebug, DEBUG_UNIFORMS);

    this.timer = new GpuTimer(gl);

    // Readback FBO (test-only, gpuCompare.js) - 2 x cols*rows*4 bytes, allocated once.
    this._readbackFg = new Uint8Array(4 * n);
    this._readbackBg = new Uint8Array(4 * n);

  }

  /**
   * `?gpu=0` / a console toggle (tech notes item 9): switches between the
   * GPU present hook and the CPU passes without disposing anything, so a
   * `WEBGL_lose_context`/restore cycle (or the debug page) can flip this at
   * runtime. `enabled` requires `ready` - a failed pipeline is never
   * force-enabled.
   */
  setEnabled(enabled) {
    if (!this.ready) return;
    this.rt.gpuActive = enabled;
    this.rt.setCellPass(enabled ? () => this._hook() : null);
  }

  _uniformLocs(program, names) {
    const gl = this.gl;
    const m = {};
    for (const name of names) m[name] = gl.getUniformLocation(program, name);
    return m;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.rt.setCellPass(null);
    // Best-effort cleanup; safe to call even if _initGL threw partway through.
    for (const tex of [this.texGI, this.texGA, this.texGD, this.texDepth, this.texShadeFg, this.texShadeBg,
      this.texMatF, this.texMatI, this.texSetI, this.texSetF, this.texGain]) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const fbo of [this.fboShade, this.fboFinal]) if (fbo) gl.deleteFramebuffer(fbo);
    for (const p of [this.progShade, this.progEdge, this.progDebug]) if (p) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
  }

  /** Rebuilds data textures from a bound MaterialTable. Called at construction and on rebind (resize/detail toggle). */
  bind(table) {
    if (!this.ready) return;
    const gl = this.gl;
    const packed = packMaterialTable(table);
    this._packed = packed;
    this._uploadDataTexture(this.texMatF, gl.RGBA32F, gl.RGBA, gl.FLOAT, packed.dims.matFWidth, packed.dims.nMat, packed.matF);
    this._uploadDataTexture(this.texMatI, gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, packed.dims.matIWidth, packed.dims.nMat, packed.matI);
    this._uploadDataTexture(this.texSetI, gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, packed.dims.setIWidth, packed.dims.nSet, packed.setI);
    this._uploadDataTexture(this.texSetF, gl.R32F, gl.RED, gl.FLOAT, packed.dims.setFWidth, packed.dims.nSet, packed.setF, 1);
    this._uploadDataTexture(this.texGain, gl.R32F, gl.RED, gl.FLOAT, 256, 1, packed.gain, 1);
    this._uniforms = packed.uniforms;
  }

  _uploadDataTexture(tex, internalFormat, format, type, w, h, data, channels = 4) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, Math.max(1, h), 0, format, type, data);
  }

  /** Stores refs for this frame; the actual GPU work happens inside RenderTargetGL.present()'s hook. */
  frame(fb, light) {
    this._fb = fb;
    this._light = light;
  }

  readback() {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt.fgTex, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this._readbackFg);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt.bgTex, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this._readbackBg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return { fg: this._readbackFg, bg: this._readbackBg };
  }

  // Called by RenderTargetGL.present(), between its own texSubImage2D
  // uploads (JS fg/bg layer) and its draw call. Order (14.1 section 4):
  // repack+upload (this._repackAndUpload) -> pass1 shade -> pass2 edge/debug
  // -> restore. present() re-binds its own program/units/framebuffer/
  // viewport itself right after this returns.
  _hook() {
    const t0 = performance.now();
    this.timer.begin();
    this._repackAndUpload();
    const t1 = performance.now();
    this._passShade();
    this._passEdgeOrDebug();
    this.timer.end();
    const t2 = performance.now();
    this.stats.uploadMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    Object.assign(this.stats, this.timer.stats());
  }

  _repackAndUpload() {
    const gl = this.gl;
    const fb = this._fb;
    const gbuf = fb.gbuf, depth = fb.depth.depth;
    const n = this.cols * this.rows;
    const GI = this._GI, GA = this._GA, GD = this._GD;
    const kind = gbuf.kind, mat = gbuf.mat, face = gbuf.face, planeId = gbuf.planeId;
    const uArr = gbuf.u, vArr = gbuf.v, zArr = gbuf.z, aoDArr = gbuf.aoD;
    const dudx = gbuf.dudx, dvdx = gbuf.dvdx, dudy = gbuf.dudy, dvdy = gbuf.dvdy;
    const mask = fb.rt.cells.mask;

    for (let i = 0; i < n; i++) {
      GI[i * 2] = planeId[i] >>> 0;
      GI[i * 2 + 1] = (kind[i] & 0xff) | ((face[i] & 0xf) << 8) | ((mask[i] & 0xf) << 12) | ((mat[i] & 0xffff) << 16);
      const gi4 = i * 4;
      GA[gi4] = uArr[i]; GA[gi4 + 1] = vArr[i]; GA[gi4 + 2] = zArr[i]; GA[gi4 + 3] = aoDArr[i];
      GD[gi4] = dudx[i]; GD[gi4 + 1] = dvdx[i]; GD[gi4 + 2] = dudy[i]; GD[gi4 + 3] = dvdy[i];
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texGI);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RG_INTEGER, gl.UNSIGNED_INT, GI);
    gl.bindTexture(gl.TEXTURE_2D, this.texGA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.FLOAT, GA);
    gl.bindTexture(gl.TEXTURE_2D, this.texGD);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.FLOAT, GD);
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RED, gl.FLOAT, depth);

    mask.fill(0);
  }

  _bindCommonTextures(loc, unitBase) {
    const gl = this.gl;
    let unit = unitBase;
    const bind = (name, tex, target = gl.TEXTURE_2D) => {
      if (loc[name] == null) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
      gl.uniform1i(loc[name], unit);
      unit++;
    };
    return { bind, next: () => unit };
  }

  _passShade() {
    const gl = this.gl, loc = this._locsShade, U = this._uniforms, light = this._light;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShade);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progShade);
    gl.bindVertexArray(this.vao);

    const { bind } = this._bindCommonTextures(loc, 0);
    bind('uGI', this.texGI); bind('uGA', this.texGA); bind('uGD', this.texGD); bind('uDepth', this.texDepth);
    bind('uFgTex', this.rt.fgTex); bind('uBgTex', this.rt.bgTex);
    bind('uMatF', this.texMatF); bind('uMatI', this.texMatI); bind('uSetI', this.texSetI);
    bind('uSetF', this.texSetF); bind('uGain', this.texGain);

    gl.uniform3f(loc.uLight, light[0], light[1], light[2]);
    gl.uniform1f(loc.uTimeSec, this._fb.timeSec || 0);
    gl.uniform1f(loc.uCellAspect, U.cellAspect);
    gl.uniform1f(loc.uCutoff, U.shading.cutoff);
    gl.uniform1f(loc.uLift, U.shading.lift);
    gl.uniform1f(loc.uFgMin, U.shading.fgMin);
    gl.uniform1f(loc.uFgMaxGain, U.shading.fgMaxGain);
    gl.uniform1f(loc.uTintK, U.shading.tint);
    gl.uniform1f(loc.uOverbright, U.shading.overbright);
    gl.uniform1f(loc.uOverbrightMax, U.shading.overbrightMax);
    gl.uniform1f(loc.uAoR, U.ao.r);
    gl.uniform1f(loc.uAoK, U.ao.k);
    gl.uniform1fv(loc.uFaceK, U.faceK);
    gl.uniform3f(loc.uFogFg, U.fog.fgRGB[0], U.fog.fgRGB[1], U.fog.fgRGB[2]);
    gl.uniform3f(loc.uFogBg, U.fog.bgRGB[0], U.fog.bgRGB[1], U.fog.bgRGB[2]);
    gl.uniform1f(loc.uFogStart, U.fog.start);
    gl.uniform1f(loc.uFogFull, U.fog.full);
    gl.uniform1f(loc.uFogStipple0, U.fog.stipple0);
    gl.uniform1f(loc.uFogStipple1, U.fog.stipple1);
    gl.uniform1f(loc.uFogSparse, U.fog.sparse);
    gl.uniform2i(loc.uFogSparseCodes, U.fog.sparseCodes[0], U.fog.sparseCodes[1] || 0);
    gl.uniform2i(loc.uFogHazeCodes, U.fog.hazeCodes[0], U.fog.hazeCodes[1] || 0);
    gl.uniform1i(loc.uFogSparseAlt, U.fog.sparseAlt);
    gl.uniform1i(loc.uFogHazeAlt, U.fog.hazeAlt);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _passEdgeOrDebug() {
    const gl = this.gl, U = this._uniforms;
    const debug = this.debugMode >= 0;
    const program = debug ? this.progDebug : this.progEdge;
    const loc = debug ? this._locsDebug : this._locsEdge;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    const { bind } = this._bindCommonTextures(loc, 0);
    bind('uGI', this.texGI);
    bind('uShadeFg', this.texShadeFg);
    if (!debug) {
      bind('uDepth', this.texDepth);
      bind('uShadeBg', this.texShadeBg);
      gl.uniform2i(loc.uGrid, this.cols, this.rows);
      gl.uniform1f(loc.uFogMax, U.edges ? U.edges.fogMax : 1);
      gl.uniform1fv(loc.uEdgeGlyph, U.edges ? U.edges.ruleGlyph : new Array(8).fill(0));
      gl.uniform1fv(loc.uEdgeGain, U.edges ? U.edges.ruleGain : new Array(8).fill(1));
      gl.uniform1f(loc.uFogStart, U.fog.start);
      gl.uniform1f(loc.uFogFull, U.fog.full);
    } else {
      gl.uniform1i(loc.uMode, this.debugMode);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

const SHADE_UNIFORMS = [
  'uGI', 'uGA', 'uGD', 'uDepth', 'uFgTex', 'uBgTex', 'uMatF', 'uMatI', 'uSetI', 'uSetF', 'uGain',
  'uLight', 'uTimeSec', 'uCellAspect', 'uCutoff', 'uLift', 'uFgMin', 'uFgMaxGain', 'uTintK',
  'uOverbright', 'uOverbrightMax', 'uAoR', 'uAoK', 'uFaceK', 'uFogFg', 'uFogBg', 'uFogStart', 'uFogFull',
  'uFogStipple0', 'uFogStipple1', 'uFogSparse', 'uFogSparseCodes', 'uFogHazeCodes', 'uFogSparseAlt', 'uFogHazeAlt',
];
const EDGE_UNIFORMS = ['uGI', 'uDepth', 'uShadeFg', 'uShadeBg', 'uGrid', 'uFogMax', 'uEdgeGlyph', 'uEdgeGain', 'uFogStart', 'uFogFull'];
const DEBUG_UNIFORMS = ['uGI', 'uShadeFg', 'uMode'];
