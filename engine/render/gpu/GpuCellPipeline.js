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
//
// Architect review 1 item 2 (blocking): a `webglcontextlost` event can fire
// at any time (driver reset, tab backgrounding on some platforms, GPU OOM);
// `RenderTargetGL` already recreates its own program/textures/atlas on
// `webglcontextrestored`, but this pipeline used to keep `ready = true` and
// `rt.gpuActive = true` pointing at now-deleted GL objects, with the CPU
// passes still no-oped by `rt.gpuActive` - i.e. a black world until
// something else touched the pipeline. This class listens on `rt.canvas`
// itself (added after `RenderTargetGL`'s own listener, so it always runs
// after `rt._initGL()` on restore - registration order is event-listener
// order): lost -> drop to CPU shading immediately (`ready = false`,
// `setEnabled(false)`, which must be allowed even though `ready` is already
// false); restored -> rebuild everything (`_initGL()` + `bind()` on the last
// bound table) and re-enable.
import { compileShader, linkProgram, createTexture2D, isSoftwareRenderer, formatFor } from './glUtil.js';
import { packMaterialTable } from './ShadeTextures.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { SHADE_FRAG_SRC } from './glsl/shade.frag.js';
import { EDGE_FRAG_SRC } from './glsl/edge.frag.js';
import { DEBUG_FRAG_SRC } from './glsl/debug.frag.js';
import { DDA_FRAG_SRC } from './glsl/dda.frag.js';
import { DERIV_FRAG_SRC } from './glsl/deriv.frag.js';
import { GpuTimer } from './GpuTimer.js';
import { buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan, MAX_STRUCTS } from './WorldTextures.js';
import { HFOV_DEG } from '../sectorCaster.js';
import { SKY_LUT_N } from './glsl/common.js';

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
    this._table = null; // last bound MaterialTable - rebind target on context restore

    // Registered once, up front, regardless of whether init below succeeds -
    // a lost context is possible even on a pipeline that never became ready
    // (harmless: `_handleContextLost` is a no-op when `ready` is already
    // false), and a later restore should still be able to (re)build it.
    this._onCtxLost = () => this._handleContextLost();
    this._onCtxRestored = () => this._handleContextRestored();
    rt.canvas.addEventListener('webglcontextlost', this._onCtxLost);
    rt.canvas.addEventListener('webglcontextrestored', this._onCtxRestored);

    try {
      this._initGL();
      this.ready = true;
      this._rebindLastTable();
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
    // US-030a: the two new passes (14.2 item 1/3) - cast (GLSL DDA, MRT
    // GI/GA/DEPTH) and deriv (GD, from GI/GA/DEPTH). Both all-uint targets
    // (`floatBitsToUint`), so neither needs `EXT_color_buffer_float`.
    this.progCast = linkProgram(gl, CELL_VERT_SRC, DDA_FRAG_SRC);
    this.progDeriv = linkProgram(gl, CELL_VERT_SRC, DERIV_FRAG_SRC);

    // --- G-buffer textures (US-030a: all-uint now - 14.2 item 3) ---
    this.texGI = createTexture2D(gl, gl.RG32UI, this.cols, this.rows);
    this.texGA = createTexture2D(gl, gl.RGBA32UI, this.cols, this.rows);
    this.texGD = createTexture2D(gl, gl.RGBA32UI, this.cols, this.rows);
    this.texDepth = createTexture2D(gl, gl.R32UI, this.cols, this.rows);
    // US-030a: per-frame UI mask upload (moved out of `_repackAndUpload`'s
    // GI.y packing - the cast pass reads it directly, see dda.frag.js).
    this.texMask = createTexture2D(gl, gl.R8UI, this.cols, this.rows);

    // --- pipeline-owned pass-1 output ---
    this.texShadeFg = createTexture2D(gl, gl.RGBA8, this.cols, this.rows);
    this.texShadeBg = createTexture2D(gl, gl.RGBA8, this.cols, this.rows);

    // --- data textures (rebuilt on bind()) ---
    this.texMatF = createTexture2D(gl, gl.RGBA32F, 1, 1);
    this.texMatI = createTexture2D(gl, gl.RGBA32I, 1, 1);
    this.texSetI = createTexture2D(gl, gl.RGBA32I, 1, 1);
    this.texSetF = createTexture2D(gl, gl.R32F, 1, 1);
    this.texGain = createTexture2D(gl, gl.R32F, 256, 1);
    // US-030a: sky gradient LUT (see _bakeSkyLUT) - a documented
    // simplification (flat gradient, no cloud texture) of `fastShadeSky`,
    // baked once per bind()/palette change, not per frame.
    this.texSky = createTexture2D(gl, gl.RGBA32F, SKY_LUT_N, 1);

    // --- world atlas textures (US-030a, WorldTextures.js; sized on first
    // use in _ensureWorldTextures - 1x1 placeholders until a world is bound
    // so `?gpucompare=shade`'s legacy 'upload' source never touches them) ---
    this.texWorldGeom = createTexture2D(gl, gl.RGBA32F, 1, 1);
    this.texWorldMats = createTexture2D(gl, gl.RGBA16UI, 1, 1);
    this.texWorldFlags = createTexture2D(gl, gl.RG8UI, 1, 1);
    this._worldAtlas = null;

    // --- FBOs ---
    this.fboCast = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCast);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texGI, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texGA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.texDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboCast incomplete');

    this.fboDeriv = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDeriv);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texGD, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboDeriv incomplete');

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

    // --- staging arrays (allocated once, architecture.md 9: no per-frame
    // allocation). US-030a: GA/GD/DEPTH are now uint textures
    // (`floatBitsToUint`) - `_GAf`/`_GDf`/`_DepthF` are Float32Array VIEWS
    // over the SAME ArrayBuffer as the Uint32Array actually uploaded
    // (`_GA`/`_GD`/`_Depth`), so writing a float and uploading its "uint"
    // alias is a free reinterpret-cast, matching `floatBitsToUint` exactly -
    // used only by the legacy `_repackAndUpload` ('upload' test-only source,
    // 14.1/US-029 compat - see `setSource`). ---
    this._GI = new Uint32Array(2 * n);
    const gaBuf = new ArrayBuffer(16 * n);
    this._GAf = new Float32Array(gaBuf); this._GA = new Uint32Array(gaBuf);
    const gdBuf = new ArrayBuffer(16 * n);
    this._GDf = new Float32Array(gdBuf); this._GD = new Uint32Array(gdBuf);
    const depthBuf = new ArrayBuffer(4 * n);
    this._DepthF = new Float32Array(depthBuf); this._Depth = new Uint32Array(depthBuf);
    this._MASK = new Uint8Array(n);
    this._source = 'dda'; // US-030a default; 'upload' is test-only (see setSource)

    this._locsShade = this._uniformLocs(this.progShade, SHADE_UNIFORMS);
    this._locsEdge = this._uniformLocs(this.progEdge, EDGE_UNIFORMS);
    this._locsDebug = this._uniformLocs(this.progDebug, DEBUG_UNIFORMS);
    this._locsCast = this._uniformLocs(this.progCast, CAST_UNIFORMS);
    this._locsDeriv = this._uniformLocs(this.progDeriv, DERIV_UNIFORMS);

    // Architect review 1 item 3 (blocking): texture bindings are now a
    // plain per-frame loop over these bind-time arrays of [loc, tex, unit]
    // tuples (built once here, not per pass call) - no closures, no result
    // objects allocated in `_passShade`/`_passEdgeOrDebug`. The sampler ->
    // unit mapping itself (`gl.uniform1i`) is also static, so it's set once
    // right here (item 4a), not every frame; only `gl.bindTexture` runs per
    // frame, because the physical unit gets reassigned to a different
    // texture between passes.
    this._shadeBinds = this._buildBindTable(this._locsShade, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uGD', this.texGD], ['uDepth', this.texDepth],
      ['uFgTex', this.rt.fgTex], ['uBgTex', this.rt.bgTex],
      ['uMatF', this.texMatF], ['uMatI', this.texMatI], ['uSetI', this.texSetI],
      ['uSetF', this.texSetF], ['uGain', this.texGain], ['uSky', this.texSky],
    ]);
    this._edgeBinds = this._buildBindTable(this._locsEdge, [
      ['uGI', this.texGI], ['uShadeFg', this.texShadeFg], ['uDepth', this.texDepth], ['uShadeBg', this.texShadeBg],
    ]);
    this._debugBinds = this._buildBindTable(this._locsDebug, [
      ['uGI', this.texGI], ['uShadeFg', this.texShadeFg],
    ]);
    // US-030a: cast (DDA) and deriv passes' own bind tables.
    this._castBinds = this._buildBindTable(this._locsCast, [
      ['uWorldGeom', this.texWorldGeom], ['uWorldMats', this.texWorldMats],
      ['uWorldFlags', this.texWorldFlags], ['uMask', this.texMask],
    ]);
    this._derivBinds = this._buildBindTable(this._locsDeriv, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uDepth', this.texDepth],
    ]);
    this._setSamplerUniforms(this.progShade, this._shadeBinds);
    this._setSamplerUniforms(this.progEdge, this._edgeBinds);
    this._setSamplerUniforms(this.progDebug, this._debugBinds);
    this._setSamplerUniforms(this.progCast, this._castBinds);
    this._setSamplerUniforms(this.progDeriv, this._derivBinds);

    this.timer = new GpuTimer(gl);

    // Readback FBO (test-only, gpuCompare.js) - 2 x cols*rows*4 bytes, allocated once.
    this._readbackFg = new Uint8Array(4 * n);
    this._readbackBg = new Uint8Array(4 * n);
  }

  // A context restore rebuilds every GL object from scratch, so the data
  // textures/static uniforms need re-uploading against the last bound table
  // (tech notes item 9 / architect review 1 item 2). Called by the
  // constructor and `_handleContextRestored` AFTER `this.ready` is set back
  // to true (`bind()` no-ops while `!ready`) - a no-op on first construction
  // since `_table` is still null there (main.js binds explicitly once it
  // sees `candidate.ready`).
  _rebindLastTable() {
    if (this._table) this.bind(this._table, this._palette);
  }

  // Builds a flat [loc, tex, unit] tuple list once (init/rebind time only -
  // never per frame). `unit` is assigned in array order and is stable for
  // the pipeline's lifetime (until the next `_initGL()`, e.g. on restore).
  _buildBindTable(loc, pairs) {
    const out = [];
    let unit = 0;
    for (const [name, tex] of pairs) {
      if (loc[name] == null) continue;
      out.push([loc[name], tex, unit++]);
    }
    return out;
  }

  _setSamplerUniforms(program, binds) {
    const gl = this.gl;
    gl.useProgram(program);
    for (const [loc, , unit] of binds) gl.uniform1i(loc, unit);
  }

  /**
   * `?gpu=0` / a console toggle (tech notes item 9): switches between the
   * GPU present hook and the CPU passes without disposing anything, so a
   * `WEBGL_lose_context`/restore cycle (or the debug page) can flip this at
   * runtime. Force-*enabling* still requires `ready` (a failed/lost
   * pipeline is never force-enabled); force-*disabling* is always allowed
   * (context loss must be able to turn this off even though `ready` is
   * already false by the time it calls this).
   */
  setEnabled(enabled) {
    if (enabled && !this.ready) return;
    this.rt.gpuActive = enabled;
    this.rt.setCellPass(enabled ? () => this._hook() : null);
  }

  /** `?gpudebug=kind|plane|shaded`: sets the debug uMode uniform once (not a per-frame value - see tech notes item 9). */
  setDebugMode(mode) {
    this.debugMode = mode;
    if (!this.ready || mode < 0) return;
    const gl = this.gl;
    gl.useProgram(this.progDebug);
    gl.uniform1i(this._locsDebug.uMode, mode);
  }

  _handleContextLost() {
    if (!this.ready) return; // already inactive (never initialised, or a previous loss)
    console.warn('[GpuCellPipeline] WebGL context lost, falling back to CPU shading');
    this.ready = false;
    this.setEnabled(false);
  }

  _handleContextRestored() {
    // `RenderTargetGL`'s own `webglcontextrestored` listener (registered
    // before this one, in its constructor) has already run `_initGL()` and
    // rebuilt `rt.fgTex`/`rt.bgTex` by the time this fires - listener order
    // follows registration order for the same event/target.
    try {
      this._initGL();
      this.ready = true;
      this._rebindLastTable();
      this.setEnabled(true);
      console.log('[GpuCellPipeline] WebGL context restored, GPU shading resumed');
    } catch (e) {
      console.warn('[GpuCellPipeline] restore failed, staying on CPU shading:', e);
      this.ready = false;
      this.rt.gpuActive = false;
    }
  }

  _uniformLocs(program, names) {
    const gl = this.gl;
    const m = {};
    for (const name of names) m[name] = gl.getUniformLocation(program, name);
    return m;
  }

  dispose() {
    this.rt.canvas.removeEventListener('webglcontextlost', this._onCtxLost);
    this.rt.canvas.removeEventListener('webglcontextrestored', this._onCtxRestored);
    const gl = this.gl;
    if (!gl) return;
    this.rt.setCellPass(null);
    // Best-effort cleanup; safe to call even if _initGL threw partway through.
    for (const tex of [this.texGI, this.texGA, this.texGD, this.texDepth, this.texShadeFg, this.texShadeBg,
      this.texMatF, this.texMatI, this.texSetI, this.texSetF, this.texGain, this.texSky,
      this.texMask, this.texWorldGeom, this.texWorldMats, this.texWorldFlags]) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const fbo of [this.fboShade, this.fboFinal, this.fboCast, this.fboDeriv]) if (fbo) gl.deleteFramebuffer(fbo);
    for (const p of [this.progShade, this.progEdge, this.progDebug, this.progCast, this.progDeriv]) if (p) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
    // US-030a: the world atlas textures are gone too - force a full
    // re-upload on the next frame after a context restore.
    this._worldAtlas = null;
  }

  /**
   * Rebuilds data textures from a bound MaterialTable, and (architect
   * review 1 item 4a) sets every uniform that only changes when `bind()`
   * runs - shading/fog/ao/faceK/edge constants, `uCellAspect` - directly
   * here, once, instead of every frame in `_passShade`/`_passEdgeOrDebug`.
   * Only `uLight`/`uTimeSec` remain per-frame (tech notes item 3). Called at
   * construction, on rebind (resize/detail toggle) and after a context
   * restore.
   */
  bind(table, palette) {
    if (!this.ready) return;
    this._table = table;
    this._palette = palette || this._palette; // US-030a: kept for _rebindLastTable/context restore
    const gl = this.gl;
    const packed = packMaterialTable(table);
    this._packed = packed;
    this._uploadDataTexture(this.texMatF, gl.RGBA32F, gl.RGBA, gl.FLOAT, packed.dims.matFWidth, packed.dims.nMat, packed.matF);
    this._uploadDataTexture(this.texMatI, gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, packed.dims.matIWidth, packed.dims.nMat, packed.matI);
    this._uploadDataTexture(this.texSetI, gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, packed.dims.setIWidth, packed.dims.nSet, packed.setI);
    this._uploadDataTexture(this.texSetF, gl.R32F, gl.RED, gl.FLOAT, packed.dims.setFWidth, packed.dims.nSet, packed.setF, 1);
    this._uploadDataTexture(this.texGain, gl.R32F, gl.RED, gl.FLOAT, 256, 1, packed.gain, 1);
    this._uniforms = packed.uniforms;
    this._bindStaticUniforms();
    if (this._palette) this._bakeSkyLUT(this._palette);
    if (this.debugMode >= 0) this.setDebugMode(this.debugMode);
  }

  /**
   * US-030a (docs/architecture.md 14.2 item 3, "Sky"): bakes a flat sky
   * gradient LUT (`SKY_LUT_N` RGBA32F samples over elevation
   * [0, materials.sky.elevTop]) from the bound palette's default
   * time-of-day, using the exact same stop-bracketing/lerp as
   * `fastShade.js`'s `fastShadeSky` - minus the cloud-noise texture lookup
   * (documented simplification, flagged for architect review: the GPU sky
   * is a flat gradient, no clouds; `?gpucompare=1`'s `compareCells` already
   * excludes every `kind == 0` cell, so this never affects a PASS/FAIL).
   * Baked once per `bind()` (palette/time-of-day rarely changes), not per
   * frame.
   */
  _bakeSkyLUT(P) {
    const rec = P.materials && P.materials.sky;
    if (!rec) return;
    const T = P.timeOfDay[P.defaultTime];
    const stops = T.sky;
    const elevTop = rec.elevTop;
    const data = this._skyLUTData || (this._skyLUTData = new Float32Array(4 * SKY_LUT_N));
    for (let i = 0; i < SKY_LUT_N; i++) {
      const t = i / (SKY_LUT_N - 1);
      let k = 0;
      for (; k < stops.length - 1; k++) if (t <= stops[k + 1].t) break;
      if (k >= stops.length - 1) k = stops.length - 2;
      const a = P.rgb[stops[k].c], b = P.rgb[stops[k + 1].c];
      const kk = (t - stops[k].t) / ((stops[k + 1].t - stops[k].t) || 1);
      data[i * 4] = a[0] + (b[0] - a[0]) * kk;
      data[i * 4 + 1] = a[1] + (b[1] - a[1]) * kk;
      data[i * 4 + 2] = a[2] + (b[2] - a[2]) * kk;
      data[i * 4 + 3] = 0;
    }
    this._uploadDataTexture(this.texSky, this.gl.RGBA32F, this.gl.RGBA, this.gl.FLOAT, SKY_LUT_N, 1, data);
    this._skyElevTop = elevTop;
    this.gl.useProgram(this.progShade);
    this.gl.uniform1f(this._locsShade.uSkyElevTop, elevTop);
  }

  _bindStaticUniforms() {
    const gl = this.gl, U = this._uniforms, loc = this._locsShade;
    gl.useProgram(this.progShade);
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

    const locE = this._locsEdge;
    gl.useProgram(this.progEdge);
    gl.uniform2i(locE.uGrid, this.cols, this.rows);
    gl.uniform1f(locE.uFogMax, U.edges ? U.edges.fogMax : 1);
    gl.uniform1fv(locE.uEdgeGlyph, U.edges ? U.edges.ruleGlyph : new Array(8).fill(0));
    gl.uniform1fv(locE.uEdgeGain, U.edges ? U.edges.ruleGain : new Array(8).fill(1));
    gl.uniform1f(locE.uFogStart, U.fog.start);
    gl.uniform1f(locE.uFogFull, U.fog.full);
  }

  _uploadDataTexture(tex, internalFormat, format, type, w, h, data, channels = 4) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, Math.max(1, h), 0, format, type, data);
  }

  /**
   * Stores refs for this frame; the actual GPU work happens inside
   * RenderTargetGL.present()'s hook. US-030a: `cam`/`world` are new
   * (optional, back-compat) - when both are given, the hook casts via the
   * GLSL DDA (`this._source` must be `'dda'`, the default); when either is
   * missing, it falls back to the legacy `_repackAndUpload` path (needs
   * `fb.gbuf` already filled by the CPU caster - `?gpucompare=shade`'s own
   * `fbCompare`, which never passes `cam`/`world`, keeps working unchanged).
   */
  frame(fb, light, cam, world) {
    this._fb = fb;
    this._light = light;
    this._cam = cam || null;
    this._world = world || null;
  }

  /** Test-only (14.2 item 7): forces the legacy 14.1 upload path even when `cam`/`world` are given - `?gpucompare=shade`. */
  setSource(mode) {
    this._source = mode;
  }

  /**
   * Test-only. Reads back the cells `present()` actually sampled - delegates
   * to `RenderTargetGL.readbackPresent()` (the textures bound on units 0/1
   * after its draw), NOT `rt.fgTex`/`rt.bgTex` by name as before, so a hook
   * that writes the right cells into the wrong texture fails `?gpucompare`
   * instead of passing it. Call right after `rt.present()`.
   */
  readback() {
    const r = this.rt.readbackPresent(this._readbackFg, this._readbackBg);
    return { fg: r.fg, bg: r.bg };
  }

  /**
   * US-030a (14.2 item 8, `?gpucompare=1` geometry parity): test-only
   * readback of `GI`/`GA`/`DEPTH` (all uint textures now) - never called
   * from the frame loop (14.1 section 8's "no `readPixels` in the frame
   * loop" rule stays intact; this is the SAME exemption `readback()` above
   * already has). WebGL2 guarantees `RGBA_INTEGER`/`UNSIGNED_INT` as a
   * legal read format for any `*_INTEGER` framebuffer regardless of its
   * real channel count, so all three come back 4-wide - callers index only
   * the channels each texture actually defines.
   */
  readbackGeometry() {
    const gl = this.gl;
    const n = this.cols * this.rows;
    this._readbackGI = this._readbackGI || new Uint32Array(4 * n);
    this._readbackGA = this._readbackGA || new Uint32Array(4 * n);
    this._readbackDepth = this._readbackDepth || new Uint32Array(4 * n);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const [tex, out] of [[this.texGI, this._readbackGI], [this.texGA, this._readbackGA], [this.texDepth, this._readbackDepth]]) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return { GI: this._readbackGI, GA: this._readbackGA, Depth: this._readbackDepth };
  }

  // Called by RenderTargetGL.present(), between its own texSubImage2D
  // uploads (JS fg/bg layer) and its draw call. Order (14.1 section 4):
  // repack+upload (this._repackAndUpload) -> pass1 shade -> pass2 edge/debug
  // -> restore. present() re-binds its own program/units/framebuffer/
  // viewport itself right after this returns.
  _hook() {
    const t0 = performance.now();
    this.timer.begin();
    const useDda = this._source !== 'upload' && !!this._cam && !!this._world;
    this._useDdaThisFrame = useDda;
    if (useDda) {
      this._uploadMask();
      this._ensureWorldTextures(this._world);
      this._computeCamBasis(this._cam);
    } else {
      this._repackAndUpload();
    }
    const t1 = performance.now();
    if (useDda) {
      this._passCast();
      this._passDeriv();
    }
    this._passShade();
    this._passEdgeOrDebug();
    this.timer.end();
    const t2 = performance.now();
    this.stats.uploadMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    this.timer.writeStats(this.stats); // writes gpuMs/gpuMsP50/gpuMsP95 in place - no allocation (architect review 1 item 3)
  }

  // US-030a: per-frame UI mask upload (14.2 item 3) - the cast pass reads
  // this directly (dda.frag.js) instead of the JS-side GI.y merge the
  // legacy `_repackAndUpload` still does for its own (uint) GI.
  _uploadMask() {
    const gl = this.gl;
    const mask = this._fb.rt.cells.mask;
    this._MASK.set(mask);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this._MASK);
    mask.fill(0);
  }

  // US-030a (WorldTextures.js): full rebuild on a `structVersion` bump
  // (structure placed/removed - texImage2D, resizes storage), else only the
  // dirty rows a `packed.version` bump touched (texSubImage2D) - "not per
  // frame" per 14.2 item 2's `world.structVersion` note.
  _ensureWorldTextures(world) {
    const gl = this.gl;
    // A different `World` object (runtime world switch, or `?gpucompare=1`'s
    // test_room -> world_m1) is always a full rebuild: `structVersion` is
    // per-world and two fresh worlds with one structure each both sit at 1,
    // so `planFrameUpdate` alone would happily keep casting the OLD atlas.
    if (!this._worldAtlas || this._worldAtlasWorld !== world) {
      this._worldAtlas = buildWorldTextures(world);
      this._worldAtlasWorld = world;
      this._uploadWorldAtlasFull();
      return;
    }
    // Architect review 1 item 3: `_frameUpdatePlan` is allocated once and
    // reused every frame (planFrameUpdate writes into it in place).
    const plan = planFrameUpdate(world, this._worldAtlas, this._frameUpdatePlan || (this._frameUpdatePlan = makeFrameUpdatePlan()));
    if (plan.rebuildNeeded) {
      this._worldAtlas = buildWorldTextures(world);
      this._uploadWorldAtlasFull();
      return;
    }
    const a = this._worldAtlas;
    for (let k = 0; k < plan.count; k++) {
      const y0 = plan.ranges[k * 2], y1 = plan.ranges[k * 2 + 1];
      const rows = y1 - y0 + 1;
      gl.bindTexture(gl.TEXTURE_2D, this.texWorldGeom);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, a.width, rows, gl.RGBA, gl.FLOAT, a.GEOM, y0 * a.width * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.texWorldMats);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, a.width, rows, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, a.MATS, y0 * a.width * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.texWorldFlags);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, y0, a.width, rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, a.FLAGS, y0 * a.width * 2);
    }
    if (plan.count) this._uploadUStruct();
  }

  _uploadWorldAtlasFull() {
    const gl = this.gl, a = this._worldAtlas;
    gl.bindTexture(gl.TEXTURE_2D, this.texWorldGeom);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, a.width, a.height, 0, gl.RGBA, gl.FLOAT, a.GEOM);
    gl.bindTexture(gl.TEXTURE_2D, this.texWorldMats);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, a.width, a.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, a.MATS);
    gl.bindTexture(gl.TEXTURE_2D, this.texWorldFlags);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, a.width, a.height, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, a.FLAGS);
    this._uploadUStruct();
  }

  _uploadUStruct() {
    const gl = this.gl, a = this._worldAtlas, loc = this._locsCast;
    const structA = this._uStructA || (this._uStructA = new Float32Array(MAX_STRUCTS * 4));
    const structB = this._uStructB || (this._uStructB = new Float32Array(MAX_STRUCTS * 4));
    for (let i = 0; i < MAX_STRUCTS; i++) {
      const o8 = i * 8, o4 = i * 4;
      structA[o4] = a.uStruct[o8]; structA[o4 + 1] = a.uStruct[o8 + 1];
      structA[o4 + 2] = a.uStruct[o8 + 2]; structA[o4 + 3] = a.uStruct[o8 + 3];
      structB[o4] = a.uStruct[o8 + 4]; structB[o4 + 1] = a.uStruct[o8 + 5];
      structB[o4 + 2] = a.uStruct[o8 + 6]; structB[o4 + 3] = a.uStruct[o8 + 7];
    }
    gl.useProgram(this.progCast);
    gl.uniform4fv(loc.uStructA, structA);
    gl.uniform4fv(loc.uStructB, structB);
    gl.uniform1i(loc.uStructCount, a.structCount);
  }

  // Camera basis (engine/render/sectorCaster.js's castScene, same formulas -
  // JS is the single source of truth, no trig duplicated in GLSL). Computed
  // once per frame, consumed by both the cast and deriv passes.
  _computeCamBasis(cam) {
    const hFovRad = HFOV_DEG * Math.PI / 180;
    const tanHalfHFov = Math.tan(hFovRad / 2);
    const yawRad = cam.yawDeg * Math.PI / 180;
    const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
    const planeX = -dirY * tanHalfHFov, planeY = dirX * tanHalfHFov;
    const screenAspect = (this.cols * (this.rt.pxCellW || 1)) / (this.rows * (this.rt.pxCellH || 1));
    const planeDistY = (this.rows / 2) * screenAspect / tanHalfHFov;
    const pitchRad = cam.pitchDeg * Math.PI / 180;
    const horizonRow = this.rows / 2 + Math.tan(pitchRad) * planeDistY;
    // Architect review 1 item 3: written in place into a once-allocated
    // object (`_ensureCamBasis`) instead of a fresh literal every frame.
    const cb = this._ensureCamBasis();
    cb.posX = cam.x; cb.posY = cam.y; cb.eyeH = cam.z;
    cb.dirX = dirX; cb.dirY = dirY; cb.planeX = planeX; cb.planeY = planeY;
    cb.horizonRow = horizonRow; cb.planeDistY = planeDistY; cb.tanHalfHFov = tanHalfHFov;
  }

  _ensureCamBasis() {
    return this._camBasis || (this._camBasis = {
      posX: 0, posY: 0, eyeH: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, horizonRow: 0, planeDistY: 0, tanHalfHFov: 0,
    });
  }

  _passCast() {
    const gl = this.gl, loc = this._locsCast, cb = this._camBasis;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCast);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progCast);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._castBinds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _passDeriv() {
    const gl = this.gl, loc = this._locsDeriv, cb = this._camBasis;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDeriv);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progDeriv);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._derivBinds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1f(loc.uTanHalfHFov, cb.tanHalfHFov);
    gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Legacy 14.1/US-029 path: test-only now (`?gpucompare=shade`, `setSource('upload')`)
  // - feeds the CPU `castSectors`-produced `fb.gbuf` into the SAME uint
  // G-buffer textures the DDA cast pass now writes, so `progShade`/`progEdge`
  // never need to know which source filled them.
  _repackAndUpload() {
    const gl = this.gl;
    const fb = this._fb;
    const gbuf = fb.gbuf, depth = fb.depth.depth;
    const n = this.cols * this.rows;
    const GI = this._GI, GAf = this._GAf, GA = this._GA, GDf = this._GDf, GD = this._GD;
    const DepthF = this._DepthF, Depth = this._Depth;
    const kind = gbuf.kind, mat = gbuf.mat, face = gbuf.face, planeId = gbuf.planeId;
    const uArr = gbuf.u, vArr = gbuf.v, zArr = gbuf.z, aoDArr = gbuf.aoD;
    const dudx = gbuf.dudx, dvdx = gbuf.dvdx, dudy = gbuf.dudy, dvdy = gbuf.dvdy;
    const mask = fb.rt.cells.mask;

    for (let i = 0; i < n; i++) {
      GI[i * 2] = planeId[i] >>> 0;
      GI[i * 2 + 1] = (kind[i] & 0xff) | ((face[i] & 0xf) << 8) | ((mask[i] & 0xf) << 12) | ((mat[i] & 0xffff) << 16);
      const gi4 = i * 4;
      GAf[gi4] = uArr[i]; GAf[gi4 + 1] = vArr[i]; GAf[gi4 + 2] = zArr[i]; GAf[gi4 + 3] = aoDArr[i];
      GDf[gi4] = dudx[i]; GDf[gi4 + 1] = dvdx[i]; GDf[gi4 + 2] = dudy[i]; GDf[gi4 + 3] = dvdy[i];
      DepthF[i] = depth[i];
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texGI);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RG_INTEGER, gl.UNSIGNED_INT, GI);
    gl.bindTexture(gl.TEXTURE_2D, this.texGA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, GA);
    gl.bindTexture(gl.TEXTURE_2D, this.texGD);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, GD);
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RED_INTEGER, gl.UNSIGNED_INT, Depth);

    mask.fill(0);
  }

  // Plain loop over a bind-time [loc, tex, unit] table - no closures, no
  // per-call allocation (architect review 1 item 3). The sampler->unit
  // uniform is already set once in `_setSamplerUniforms`; only the texture
  // unit's bound texture needs refreshing per frame/pass.
  _bindTextures(binds) {
    const gl = this.gl;
    for (let i = 0; i < binds.length; i++) {
      const b = binds[i];
      gl.activeTexture(gl.TEXTURE0 + b[2]);
      gl.bindTexture(gl.TEXTURE_2D, b[1]);
    }
  }

  _passShade() {
    const gl = this.gl, loc = this._locsShade, light = this._light;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShade);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progShade);
    gl.bindVertexArray(this.vao);

    this._bindTextures(this._shadeBinds);

    gl.uniform3f(loc.uLight, light[0], light[1], light[2]);
    gl.uniform1f(loc.uTimeSec, this._fb.timeSec || 0);

    // US-030a: `uGpuSky` toggles the kind==0 branch (14.2 item 3) - GLSL sky
    // (DDA path: JS `fillSky` never runs, see the module doc) vs. the 14.1
    // passthrough (legacy 'upload'/CPU-fed source, where `fillSky` already
    // painted `fgTex`/`bgTex` for those cells - unchanged behaviour).
    const useDda = this._useDdaThisFrame;
    gl.uniform1i(loc.uGpuSky, useDda ? 1 : 0);
    if (useDda) {
      const cb = this._camBasis;
      gl.uniform1f(loc.uHorizonRow, cb.horizonRow);
      gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _passEdgeOrDebug() {
    const gl = this.gl;
    const debug = this.debugMode >= 0;
    const program = debug ? this.progDebug : this.progEdge;
    const binds = debug ? this._debugBinds : this._edgeBinds;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFinal);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    this._bindTextures(binds);
    // uGrid/uFogMax/uEdgeGlyph/uEdgeGain/uFogStart/uFogFull (edge) and
    // uMode (debug) are all static once set - `_bindStaticUniforms()` /
    // `setDebugMode()`, not here (architect review 1 items 3/4a).

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

const SHADE_UNIFORMS = [
  'uGI', 'uGA', 'uGD', 'uDepth', 'uFgTex', 'uBgTex', 'uMatF', 'uMatI', 'uSetI', 'uSetF', 'uGain',
  'uLight', 'uTimeSec', 'uCellAspect', 'uCutoff', 'uLift', 'uFgMin', 'uFgMaxGain', 'uTintK',
  'uOverbright', 'uOverbrightMax', 'uAoR', 'uAoK', 'uFaceK', 'uFogFg', 'uFogBg', 'uFogStart', 'uFogFull',
  'uFogStipple0', 'uFogStipple1', 'uFogSparse', 'uFogSparseCodes', 'uFogHazeCodes', 'uFogSparseAlt', 'uFogHazeAlt',
  // US-030a: GPU sky (14.2 item 3).
  'uSky', 'uSkyElevTop', 'uGpuSky', 'uHorizonRow', 'uPlaneDistY',
];
const EDGE_UNIFORMS = ['uGI', 'uDepth', 'uShadeFg', 'uShadeBg', 'uGrid', 'uFogMax', 'uEdgeGlyph', 'uEdgeGain', 'uFogStart', 'uFogFull'];
const DEBUG_UNIFORMS = ['uGI', 'uShadeFg', 'uMode'];
// US-030a: cast (DDA) / deriv pass uniforms.
const CAST_UNIFORMS = [
  'uWorldGeom', 'uWorldMats', 'uWorldFlags', 'uMask', 'uStructA', 'uStructB', 'uStructCount',
  'uGrid', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY', 'uHorizonRow', 'uPlaneDistY',
];
const DERIV_UNIFORMS = ['uGI', 'uGA', 'uDepth', 'uGrid', 'uTanHalfHFov', 'uPlaneDistY'];
