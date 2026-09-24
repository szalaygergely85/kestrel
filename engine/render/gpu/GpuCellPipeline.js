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
import { packTerrainTextures } from './TerrainTextures.js';
import { CELL_VERT_SRC } from './glsl/cell.vert.js';
import { SHADE_FRAG_SRC } from './glsl/shade.frag.js';
import { EDGE_FRAG_SRC } from './glsl/edge.frag.js';
import { DEBUG_FRAG_SRC } from './glsl/debug.frag.js';
import { DDA_FRAG_SRC } from './glsl/dda.frag.js';
import { RESOLVE_FRAG_SRC } from './glsl/resolve.frag.js';
import { DERIV_FRAG_SRC } from './glsl/deriv.frag.js';
import { LIGHT_FRAG_SRC } from './glsl/light.frag.js';
// US-016 (14.4 GPU build order steps 2/3): pass A2 program + the shared sun helper.
import { TERRAIN_FRAG_SRC } from './glsl/terrain.frag.js';
import { sunFromWorld } from '../terrainCaster.js';
import { GpuTimer } from './GpuTimer.js';
import { buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan, MAX_STRUCTS } from './WorldTextures.js';
import { HFOV_DEG } from '../sectorCaster.js';
import { SKY_LUT_N } from './glsl/common.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_VIS_CELLS } from '../lighting.js';

const EMPTY3 = [0, 0, 0]; // fallback ambient when `frame()` was handed neither a LightSet nor an array.

export class GpuCellPipeline {
  constructor(rt, opts = {}) {
    this.rt = rt;
    this.gl = rt.gl;
    this.cols = rt.cols;
    this.rows = rt.rows;
    // US-030b (14.2 item 3): rays-per-axis for the N-ray coverage cast, fixed
    // for this pipeline instance's lifetime (a rays change needs a fresh
    // pipeline, like a grid change does - see engine.js's `rays` option/
    // `?rays=`). Clamped defensively; main.js already clamps its own
    // `?rays=` parse to 1..4.
    this.rays = Math.max(1, Math.min(4, Math.round(opts.rays || 1)));
    this.ready = false;
    this.stats = {
      uploadMs: 0, repackMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN,
      // US-016 step 6: terrain pass A2 own cost (NaN when the pass didn't run this frame's timer window, or the timer extension is unavailable).
      terrainGpuMs: NaN, terrainGpuMsP50: NaN, terrainGpuMsP95: NaN,
    };
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
    // US-030b (14.2 item 3, pass B): votes the sub-sample G-buffer down to
    // the per-cell one below.
    this.progResolve = linkProgram(gl, CELL_VERT_SRC, RESOLVE_FRAG_SRC);
    this.progDeriv = linkProgram(gl, CELL_VERT_SRC, DERIV_FRAG_SRC);
    // US-006 (14.3 item 3): the light pass - cast/resolve/deriv -> light -> shade -> edge.
    this.progLight = linkProgram(gl, CELL_VERT_SRC, LIGHT_FRAG_SRC);
    // US-016 (14.4 item 2, GPU build order step 2): pass A2, between cast and resolve.
    this.progTerrain = linkProgram(gl, CELL_VERT_SRC, TERRAIN_FRAG_SRC);

    // --- G-buffer textures (US-030a: all-uint now - 14.2 item 3) - these are
    // the RESOLVED, per-cell (cols x rows) textures; deriv/shade/edge/debug/
    // sprites/gpuCompare all keep reading these exactly as before. ---
    this.texGI = createTexture2D(gl, gl.RG32UI, this.cols, this.rows);
    this.texGA = createTexture2D(gl, gl.RGBA32UI, this.cols, this.rows);
    this.texGD = createTexture2D(gl, gl.RGBA32UI, this.cols, this.rows);
    this.texDepth = createTexture2D(gl, gl.R32UI, this.cols, this.rows);
    // US-030b (14.2 item 3, pass A): the SUB-sample G-buffer, sized
    // cols*rays x rows*rays - the cast pass's own output, consumed only by
    // the resolve pass (geometry) and the shade pass (continuous-output
    // averaging over the resolved winner's group).
    this.subCols = this.cols * this.rays;
    this.subRows = this.rows * this.rays;
    this.texSGI = createTexture2D(gl, gl.RG32UI, this.subCols, this.subRows);
    this.texSGA = createTexture2D(gl, gl.RGBA32UI, this.subCols, this.subRows);
    this.texSDepth = createTexture2D(gl, gl.R32UI, this.subCols, this.subRows);
    // US-016 (14.4 item 2): "set 2" - the terrain pass's own sub-sample
    // G-buffer (a copy of set 1 unless a sub-ray's terrain march hit is
    // nearer). Resolve reads set 2 when terrain is active this frame, set 1
    // otherwise (bind-time choice, no uniform - item 2).
    this.texSGI2 = createTexture2D(gl, gl.RG32UI, this.subCols, this.subRows);
    this.texSGA2 = createTexture2D(gl, gl.RGBA32UI, this.subCols, this.subRows);
    this.texSDepth2 = createTexture2D(gl, gl.R32UI, this.subCols, this.subRows);
    // US-030a: per-frame UI mask upload - now read by the RESOLVE pass
    // (14.2 item 3: mask is a per-cell, not per-sub-sample, property).
    this.texMask = createTexture2D(gl, gl.R8UI, this.cols, this.rows);
    // US-006 (14.3 items 3/5): per-cell light (RGBA32UI, floatBitsToUint)
    // and the LVIS occlusion atlas (R8UI, MAX_VIS_DIM x (MAX_LIGHTS*MAX_VIS_DIM) -
    // see engine/render/lighting.js's module doc for the boxed-per-light
    // convention this atlas shares with the JS reference).
    this.texLight = createTexture2D(gl, gl.RGBA32UI, this.cols, this.rows);
    this.texLVis = createTexture2D(gl, gl.R8UI, MAX_VIS_DIM, MAX_LIGHTS * MAX_VIS_DIM);
    // Architect review 1 item 4: per-slot "what version does THIS texture
    // hold" - reset to -1 (never matches a real `LightSet.visVersion`, which
    // starts at 0) whenever `texLVis` is (re)created, i.e. right here, so a
    // context restore re-uploads every static light's grid on its next frame.
    this._lvisUploaded = new Int32Array(MAX_LIGHTS).fill(-1);

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

    // --- US-016 (14.4 item 3/build-order step 1) far-terrain textures - 1x1
    // placeholders until a world with `terrain.farReady` is bound, same
    // pattern as the world atlas above. Not yet consumed by any program (no
    // pass A2/kind-7 branch exists yet); `_ensureTerrainTextures` below only
    // uploads them, so this addition is inert until step 2 lands.
    this.texFarH = createTexture2D(gl, gl.R32F, 1, 1);
    this.texFarType = createTexture2D(gl, gl.R8UI, 1, 1);
    this.texTlook = createTexture2D(gl, gl.RGBA32F, 1, 1);
    this._terrainVersion = -1;
    this._terrainWorld = null;
    this._terrainPacked = null;

    // --- FBOs ---
    // US-030b: the sub-sample cast pass (A) writes SGI/SGA/SDepth here; the
    // resolve pass (B) reads those back and writes the RESOLVED GI/GA/Depth
    // into the (unchanged) `fboCast` FBO below - deriv/shade/edge never know
    // the difference.
    this.fboCastSub = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCastSub);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texSGI, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texSGA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.texSDepth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboCastSub incomplete');

    // US-016 (14.4 item 2): pass A2 `terrain` writes "set 2" here.
    this.fboTerrainSub = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSub);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texSGI2, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texSGA2, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.texSDepth2, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboTerrainSub incomplete');

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

    this.fboLight = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboLight);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texLight, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fboLight incomplete');

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
    // US-030b: mirror buffers for the legacy 'upload' test source (14.2 item
    // 7's `?gpucompare=shade`) - it feeds the CPU-cast G-buffer straight into
    // the resolved GI/GA/Depth, bypassing cast/resolve; the shade pass now
    // ALWAYS averages over the sub-grid, so that path also mirrors its own
    // single sample into SGI/SGA/SDepth's (0,0,cols,rows) sub-rect and
    // `_passShade` binds `uN = 1` for it (see `setSource`/`_passShade`).
    this._SGI = new Uint32Array(2 * n);
    const sgaBuf = new ArrayBuffer(16 * n);
    this._SGAf = new Float32Array(sgaBuf); this._SGA = new Uint32Array(sgaBuf);
    const sdepthBuf = new ArrayBuffer(4 * n);
    this._SDepthF = new Float32Array(sdepthBuf); this._SDepth = new Uint32Array(sdepthBuf);

    this._locsShade = this._uniformLocs(this.progShade, SHADE_UNIFORMS);
    this._locsEdge = this._uniformLocs(this.progEdge, EDGE_UNIFORMS);
    this._locsDebug = this._uniformLocs(this.progDebug, DEBUG_UNIFORMS);
    this._locsCast = this._uniformLocs(this.progCast, CAST_UNIFORMS);
    this._locsResolve = this._uniformLocs(this.progResolve, RESOLVE_UNIFORMS);
    this._locsDeriv = this._uniformLocs(this.progDeriv, DERIV_UNIFORMS);
    this._locsLight = this._uniformLocs(this.progLight, LIGHT_UNIFORMS);
    this._locsTerrain = this._uniformLocs(this.progTerrain, TERRAIN_UNIFORMS);

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
      // US-030b: the sub-sample G-buffer, for shadeCore's per-sub-sample average.
      ['uSGI', this.texSGI], ['uSGA', this.texSGA],
      ['uFgTex', this.rt.fgTex], ['uBgTex', this.rt.bgTex],
      ['uMatF', this.texMatF], ['uMatI', this.texMatI], ['uSetI', this.texSetI],
      ['uSetF', this.texSetF], ['uGain', this.texGain], ['uSky', this.texSky],
      // US-006: per-cell light, written by the light pass right before this one.
      ['uLightTex', this.texLight],
      // US-016 (14.4 item 5): terrain colour/glyph look-up (b/normal arrive
      // pre-computed via GA.w - see terrain.frag.js's doc comment on why
      // uFarH stays out of this program's texture-unit budget).
      ['uTlook', this.texTlook],
    ]);
    this._edgeBinds = this._buildBindTable(this._locsEdge, [
      ['uGI', this.texGI], ['uShadeFg', this.texShadeFg], ['uDepth', this.texDepth], ['uShadeBg', this.texShadeBg],
    ]);
    this._debugBinds = this._buildBindTable(this._locsDebug, [
      ['uGI', this.texGI], ['uShadeFg', this.texShadeFg],
    ]);
    // US-030a/US-030b: cast (DDA, sub-sample), resolve (vote) and deriv
    // passes' own bind tables. Cast no longer reads the mask (moved to
    // resolve - 14.2 item 3).
    this._castBinds = this._buildBindTable(this._locsCast, [
      ['uWorldGeom', this.texWorldGeom], ['uWorldMats', this.texWorldMats],
      ['uWorldFlags', this.texWorldFlags],
    ]);
    // US-016 (14.4 item 2): resolve reads set 2 (the terrain pass's output)
    // when terrain is active this frame, set 1 (the cast pass's raw output)
    // otherwise - a bind-time choice between two prebuilt tables (no
    // uniform, no per-frame allocation), picked in `_passResolve`.
    this._resolveBindsSet1 = this._buildBindTable(this._locsResolve, [
      ['uSGI', this.texSGI], ['uSGA', this.texSGA], ['uSDepth', this.texSDepth], ['uMask', this.texMask],
    ]);
    this._resolveBindsSet2 = this._buildBindTable(this._locsResolve, [
      ['uSGI', this.texSGI2], ['uSGA', this.texSGA2], ['uSDepth', this.texSDepth2], ['uMask', this.texMask],
    ]);
    // US-016 (14.4 item 2): pass A2 reads set 1 (cast pass output) plus the
    // far-terrain textures (step 1).
    this._terrainBinds = this._buildBindTable(this._locsTerrain, [
      ['uSGI', this.texSGI], ['uSGA', this.texSGA], ['uSDepth', this.texSDepth],
      ['uFarH', this.texFarH], ['uFarType', this.texFarType],
    ]);
    this._derivBinds = this._buildBindTable(this._locsDeriv, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uDepth', this.texDepth],
    ]);
    // US-006/US-007: light pass reads the resolved GI/Depth (kind/face,
    // distance) + the LVIS atlas, plus (US-007) the world atlas the sun DDA
    // walks - same textures `_castBinds` binds for `dda.frag.js`, bound
    // again here on light's own sampler units (a different program).
    this._lightBinds = this._buildBindTable(this._locsLight, [
      ['uGI', this.texGI], ['uDepth', this.texDepth], ['uLVis', this.texLVis],
      ['uWorldGeom', this.texWorldGeom], ['uWorldFlags', this.texWorldFlags],
    ]);
    this._setSamplerUniforms(this.progShade, this._shadeBinds);
    this._setSamplerUniforms(this.progEdge, this._edgeBinds);
    this._setSamplerUniforms(this.progDebug, this._debugBinds);
    this._setSamplerUniforms(this.progCast, this._castBinds);
    // US-016: both resolve source tables share the same sampler->unit
    // mapping (built from the same `_locsResolve`), so setting it once
    // against either table covers both - `_bindTextures` only ever changes
    // which texture a unit points at, never the unit itself.
    this._setSamplerUniforms(this.progResolve, this._resolveBindsSet1);
    this._setSamplerUniforms(this.progDeriv, this._derivBinds);
    this._setSamplerUniforms(this.progLight, this._lightBinds);
    this._setSamplerUniforms(this.progTerrain, this._terrainBinds);

    // US-006: staging array for the per-frame `uVisBox` upload (allocated
    // once - architecture.md 9); `uLightPos`/`uLightCol` upload straight
    // from the LightSet's own arrays (already in the right layout).
    this._visBoxF = new Float32Array(4 * MAX_LIGHTS);

    this.timer = new GpuTimer(gl);
    // US-016 step 6 (14.4 item 4 budget "<= 1.0 ms p95 of the 4 ms"): the
    // terrain pass runs INSIDE `this.timer`'s own begin()/end() span (the
    // whole `_hook()`), and `EXT_disjoint_timer_query_webgl2` allows only
    // ONE active TIME_ELAPSED_EXT query per context at a time - a second,
    // nested `beginQuery` would be a no-op (INVALID_OPERATION), so a second
    // `GpuTimer` here can never report anything but n/a. Tried
    // `TIMESTAMP_EXT` query-counters (not an "active" span, so they can
    // coexist with an active TIME_ELAPSED_EXT query) bracketing
    // `_passTerrain()` first, but ANGLE/D3D11 (the owner's real GPU) reports
    // `queryCounterEXT` present yet always returns the SAME clock value for
    // both queries (delta always exactly 0) - a known driver gap, not a
    // logic bug here. Falls back to a CPU `performance.now()` submit-time
    // bracket around just the terrain draw call, same honest-labelling as
    // this file's existing `uploadMs`/`drawMs` (also CPU submit time, not a
    // GPU query) - good enough to check the pass against its budget even
    // though it can't separate GPU-side overlap from CPU dispatch cost.
    this._terrainGpuMsHistory = new Float32Array(16);
    this._terrainGpuMsHistoryLen = 0;
    this._terrainGpuMsHistoryPos = 0;

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
      this.texSGI, this.texSGA, this.texSDepth, this.texSGI2, this.texSGA2, this.texSDepth2,
      this.texMatF, this.texMatI, this.texSetI, this.texSetF, this.texGain, this.texSky,
      this.texMask, this.texWorldGeom, this.texWorldMats, this.texWorldFlags,
      this.texLight, this.texLVis, this.texFarH, this.texFarType, this.texTlook]) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const fbo of [this.fboShade, this.fboFinal, this.fboCast, this.fboCastSub, this.fboTerrainSub, this.fboDeriv, this.fboLight]) if (fbo) gl.deleteFramebuffer(fbo);
    for (const p of [this.progShade, this.progEdge, this.progDebug, this.progCast, this.progResolve, this.progDeriv, this.progLight, this.progTerrain]) if (p) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.timer) this.timer.dispose();
    // US-030a: the world atlas textures are gone too - force a full
    // re-upload on the next frame after a context restore.
    this._worldAtlas = null;
    // US-016: same for the far-terrain textures.
    this._terrainVersion = -1;
    this._terrainWorld = null;
    this._terrainPacked = null;
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

  /**
   * BUG-LIGHT-001 (docs/backlog.md row 25b, architecture.md 14.3 item 7
   * debt): test-only readback of `LIGHT` (RGBA32UI: xyz = floatBitsToUint(L),
   * w = sunlit | litCount << 8), same exemption/shape as `readbackGeometry`
   * - lets `?gpucompare=1` split a light-PASS mismatch (this readback vs
   * `lightAt()`/`fb.light`) from a shade-pass-only mismatch.
   */
  readbackLight() {
    const gl = this.gl;
    const n = this.cols * this.rows;
    this._readbackLight = this._readbackLight || new Uint32Array(4 * n);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texLight, 0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this._readbackLight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    return this._readbackLight;
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
      this._ensureTerrainTextures(this._world);
      this._computeCamBasis(this._cam);
    } else {
      this._repackAndUpload();
    }
    const t1 = performance.now();
    // US-016 (14.4 item 8): pass A2 runs only when the bound world has
    // terrain AND its far bake is ready - otherwise resolve reads set 1
    // untouched, same as before this story.
    this._terrainActiveThisFrame = useDda && !!(this._world && this._world.terrain && this._world.terrain.farReady);
    if (useDda) {
      this._passCast();
      if (this._terrainActiveThisFrame) {
        this._terrainTsBegin();
        this._passTerrain();
        this._terrainTsEnd();
      }
      this._passResolve();
      this._passDeriv();
    }
    // US-006 (14.3 item 3): light pass runs unconditionally (also over the
    // legacy 'upload' source's mirrored GI/Depth - see `_repackAndUpload`),
    // right before shade, exactly like `deriv` already does.
    this._passLight();
    this._passShade();
    this._passEdgeOrDebug();
    this.timer.end();
    const t2 = performance.now();
    this.stats.uploadMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    this.timer.writeStats(this.stats); // writes gpuMs/gpuMsP50/gpuMsP95 in place - no allocation (architect review 1 item 3)
    this._pollTerrainTs();
  }

  // US-016 step 6: CPU `performance.now()` bracket around just the terrain
  // draw call (see the constructor comment for why a true GPU query can't
  // be nested inside `this.timer`'s whole-frame span, and why the
  // TIMESTAMP_EXT alternative measured 0 on the owner's real GPU).
  _terrainTsBegin() { this._terrainT0 = performance.now(); }

  _terrainTsEnd() {
    const ms = performance.now() - this._terrainT0;
    this._terrainGpuMsHistory[this._terrainGpuMsHistoryPos] = ms;
    this._terrainGpuMsHistoryPos = (this._terrainGpuMsHistoryPos + 1) % this._terrainGpuMsHistory.length;
    if (this._terrainGpuMsHistoryLen < this._terrainGpuMsHistory.length) this._terrainGpuMsHistoryLen++;
  }

  _pollTerrainTs() {
    if (this._terrainGpuMsHistoryLen === 0) { this.stats.terrainGpuMs = NaN; this.stats.terrainGpuMsP50 = NaN; this.stats.terrainGpuMsP95 = NaN; return; }
    // Small history (16 entries, at most once/frame) - an in-place sort of
    // a tiny reused scratch is cheap enough to do every call (no per-frame
    // allocation: `_terrainTsScratch` is created once, lazily, below).
    if (!this._terrainTsScratch) this._terrainTsScratch = new Float32Array(this._terrainGpuMsHistory.length);
    const n = this._terrainGpuMsHistoryLen, scratch = this._terrainTsScratch;
    for (let i = 0; i < n; i++) scratch[i] = this._terrainGpuMsHistory[i];
    const view = scratch.subarray(0, n);
    view.sort();
    this.stats.terrainGpuMs = view[n - 1];
    this.stats.terrainGpuMsP50 = view[Math.floor(n * 0.5)];
    this.stats.terrainGpuMsP95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
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
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, a.width, rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, a.FLAGS, y0 * a.width * 2);
    }
    if (plan.count || plan.uStructDirty) this._uploadUStruct();
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

  // US-016 (14.4 item 3, build order step 1): uploads `FARH`/`FARTYPE`/
  // `TLOOK` once when `terrain.farReady` first flips, and again only when
  // `terrain.farVersion` changes - never per frame (item 3's "do not"
  // list). A different `world` object (world switch / `?gpucompare=1`) is
  // always a re-upload for the same reason `_ensureWorldTextures` treats it
  // that way. No-op (and `_terrainPacked` left stale) while the world has no
  // terrain or the bake hasn't finished - the caller checks `_terrainPacked`
  // before using it (step 2+; nothing reads it yet).
  _ensureTerrainTextures(world) {
    const terrain = world && world.terrain;
    if (!terrain || !terrain.farReady) return;
    if (this._terrainVersion === terrain.farVersion && this._terrainWorld === world) return;
    const packed = packTerrainTextures(terrain, this._palette);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texFarH);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, packed.width, packed.height, 0, gl.RED, gl.FLOAT, packed.farH);
    gl.bindTexture(gl.TEXTURE_2D, this.texFarType);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, packed.width, packed.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, packed.farType);
    gl.bindTexture(gl.TEXTURE_2D, this.texTlook);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, packed.tlookWidth, packed.tlookHeight, 0, gl.RGBA, gl.FLOAT, packed.tlook);
    this._terrainPacked = packed;
    this._terrainVersion = terrain.farVersion;
    this._terrainWorld = world;
    this._uploadTerrainUniforms(terrain, this._palette);
  }

  // US-016 (14.4 items 3-5, GPU build order steps 2/3): the terrain
  // constants that only change when the far bake (re)runs, not per frame -
  // `uFarMap`/`uTerrainMaxH` for the pass A2 march (progTerrain), and the
  // recipe bands + far-fog colours for the shade pass's kind==7 branch
  // (progShade); both also need `uFarMap` (the shade pass's own
  // `farHBilinear` call, for the hit-point normal).
  _uploadTerrainUniforms(terrain, palette) {
    const gl = this.gl;
    const farMap = [0, 0, terrain.mapCell, terrain.mapW];
    gl.useProgram(this.progTerrain);
    gl.uniform4fv(this._locsTerrain.uFarMap, farMap);
    gl.uniform1f(this._locsTerrain.uTerrainMaxH, terrain.farMaxH);

    const recipe = terrain.recipe;
    const fogRec = palette && palette.fog && palette.fog.far;
    const locS = this._locsShade;
    gl.useProgram(this.progShade);
    if (recipe && recipe.bands) {
      gl.uniform1f(locS.uBandNear, recipe.bands.near);
      gl.uniform1f(locS.uBandMid, recipe.bands.mid);
    }
    if (fogRec && palette.rgb) {
      const nearRGB = palette.rgb[fogRec.color], farRGB = palette.rgb[fogRec.colorFar];
      gl.uniform1f(locS.uTerrainFogStart, fogRec.start);
      gl.uniform1f(locS.uTerrainFogFull, fogRec.full);
      gl.uniform1f(locS.uTerrainFogCurve, fogRec.curve || 1);
      if (nearRGB) gl.uniform3f(locS.uTerrainFogNearRGB, nearRGB[0], nearRGB[1], nearRGB[2]);
      if (farRGB) gl.uniform3f(locS.uTerrainFogFarRGB, farRGB[0], farRGB[1], farRGB[2]);
    }
  }

  // US-007: the light pass now also needs `uStructA/B/Count` (its own sun
  // DDA's `findStruct`, light.frag.js) - uploaded to BOTH programs here
  // (each has its own uniform locations; the packed `structA`/`structB`
  // arrays are shared, built once per call).
  _uploadUStruct() {
    const gl = this.gl, a = this._worldAtlas;
    const structA = this._uStructA || (this._uStructA = new Float32Array(MAX_STRUCTS * 4));
    const structB = this._uStructB || (this._uStructB = new Float32Array(MAX_STRUCTS * 4));
    // US-007 (14.3 item 4 amendment iv, JS twin: lighting.js's sunVisible):
    // max over every placed structure of origin.z + maxH (world space) -
    // the sun DDA's global escape height once the ray has left every
    // footprint but must still clear the tallest structure anywhere.
    let worldMaxH = 0;
    for (let i = 0; i < a.structCount; i++) {
      const o8 = i * 8;
      const m = a.uStruct[o8 + 2] + a.uStruct[o8 + 7];
      if (m > worldMaxH) worldMaxH = m;
    }
    for (let i = 0; i < MAX_STRUCTS; i++) {
      const o8 = i * 8, o4 = i * 4;
      structA[o4] = a.uStruct[o8]; structA[o4 + 1] = a.uStruct[o8 + 1];
      structA[o4 + 2] = a.uStruct[o8 + 2]; structA[o4 + 3] = a.uStruct[o8 + 3];
      structB[o4] = a.uStruct[o8 + 4]; structB[o4 + 1] = a.uStruct[o8 + 5];
      structB[o4 + 2] = a.uStruct[o8 + 6]; structB[o4 + 3] = a.uStruct[o8 + 7];
    }
    gl.useProgram(this.progCast);
    gl.uniform4fv(this._locsCast.uStructA, structA);
    gl.uniform4fv(this._locsCast.uStructB, structB);
    gl.uniform1i(this._locsCast.uStructCount, a.structCount);
    gl.useProgram(this.progLight);
    gl.uniform4fv(this._locsLight.uStructA, structA);
    gl.uniform4fv(this._locsLight.uStructB, structB);
    gl.uniform1i(this._locsLight.uStructCount, a.structCount);
    gl.uniform1f(this._locsLight.uWorldMaxH, worldMaxH);
    // US-016 (14.4 item 4): the terrain march's own skip-interval structure list.
    gl.useProgram(this.progTerrain);
    gl.uniform4fv(this._locsTerrain.uStructA, structA);
    gl.uniform4fv(this._locsTerrain.uStructB, structB);
    gl.uniform1i(this._locsTerrain.uStructCount, a.structCount);
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
    // US-030b (14.2 item 3, pass A): renders at SUB-sample resolution
    // (cols*rays x rows*rays) into fboCastSub (SGI/SGA/SDepth) - `uGrid`
    // stays the BASE grid (cameraX/slope normalise by cols/rows, not the
    // sub-grid; see dda.frag.js's per-fragment decode).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCastSub);
    gl.viewport(0, 0, this.subCols, this.subRows);
    gl.useProgram(this.progCast);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._castBinds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1i(loc.uN, this.rays);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // US-016 (14.4 items 2/4, GPU build order step 2): pass A2 - the same
  // sub-sample resolution/camera basis as `_passCast`, reading set 1
  // (fboCastSub's own output) and writing set 2 (fboTerrainSub).
  _passTerrain() {
    const gl = this.gl, loc = this._locsTerrain, cb = this._camBasis;
    const terrain = this._world.terrain;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTerrainSub);
    gl.viewport(0, 0, this.subCols, this.subRows);
    gl.useProgram(this.progTerrain);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._terrainBinds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1i(loc.uN, this.rays);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.uniform1f(loc.uTerrainMaxH, terrain.farMaxH);
    // US-016 (14.4 item 4): the interim sun (D-007 wording) - `sunFromWorld`
    // (terrainCaster.js) is the single source of truth the JS oracle uses
    // too (build order step 1). Cheap (a few trig calls); recomputed every
    // frame rather than cached because nothing here tracks a "did timeOfDay
    // change" version the way `_ensureTerrainTextures` tracks `farVersion`.
    const sun = sunFromWorld(this._world, this._palette);
    gl.uniform3f(loc.uSunDir, sun.dirX, sun.dirY, sun.dirZ);
    gl.uniform1f(loc.uAmbientI, sun.ambientI);
    gl.uniform1f(loc.uSunI, sun.sunI);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // US-030b (14.2 item 3, pass B): votes the sub-sample G-buffer down to the
  // per-cell GI/GA/Depth (fboCast, unchanged target - deriv/shade/edge never
  // know the sub-grid existed). US-016 (14.4 item 2): reads set 2 (the
  // terrain pass's output) when terrain ran this frame, set 1 otherwise -
  // a bind-time choice between two prebuilt tables, no uniform.
  _passResolve() {
    const gl = this.gl, loc = this._locsResolve;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCast);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progResolve);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._terrainActiveThisFrame ? this._resolveBindsSet2 : this._resolveBindsSet1);
    gl.uniform1i(loc.uN, this.rays);
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

  /**
   * US-006 (14.3 item 3): the light pass. `this._light` (set by `frame()`)
   * is either a `LightSet` (real point lights + ambient) or a plain
   * `[r,g,b]` ambient-only array (back-compat - every dev-tool call site
   * that still passes `ambientL` directly, e.g. `?gpucompare=*`/`?flicker=1`,
   * keeps working unchanged: 0 point lights, same numeric result as before
   * this story). Camera basis reuses `this._camBasis` (computed by
   * `_computeCamBasis` on the DDA path; on the legacy 'upload' source it is
   * whatever the last DDA frame left it at, or the zeroed default - harmless,
   * since that source only ever carries ambient-only light in practice).
   */
  _passLight() {
    const gl = this.gl, loc = this._locsLight;
    this._uploadLightUniforms();
    const cb = this._camBasis || this._ensureCamBasis();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboLight);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progLight);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._lightBinds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _uploadLightUniforms() {
    const gl = this.gl, loc = this._locsLight;
    gl.useProgram(this.progLight);
    const light = this._light;
    const isSet = light && typeof light === 'object' && light.pos && light.col && typeof light.count === 'number';
    if (!isSet) {
      // Back-compat ambient-only array (or null/undefined) - no sun either.
      const a = light || EMPTY3;
      gl.uniform3f(loc.uAmbient, a[0] || 0, a[1] || 0, a[2] || 0);
      gl.uniform1i(loc.uLightCount, 0);
      gl.uniform1i(loc.uSunOn, 0);
      return;
    }
    gl.uniform3f(loc.uAmbient, light.ambient[0], light.ambient[1], light.ambient[2]);
    // US-007 (14.3 item 3): sun uniforms - `LightSet.sun` (`setSun`'s dir/
    // col, buildLightSet's `sun.col`). `?sun=0` (game/js/main.js) drives
    // `sun.on` false through `setSun`, same switch as `?lights=0` above.
    const sun = light.sun;
    gl.uniform1i(loc.uSunOn, sun && sun.on ? 1 : 0);
    if (sun) {
      gl.uniform3f(loc.uSunDir, sun.dir[0], sun.dir[1], sun.dir[2]);
      gl.uniform3f(loc.uSunCol, sun.col[0], sun.col[1], sun.col[2]);
    }
    const n = Math.min(MAX_LIGHTS, light.count);
    gl.uniform1i(loc.uLightCount, n);
    if (n <= 0) return;
    gl.uniform4fv(loc.uLightPos, light.pos);
    gl.uniform4fv(loc.uLightCol, light.col);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const o = i * 4;
      this._visBoxF[o] = light.visOx[i]; this._visBoxF[o + 1] = light.visOy[i];
      this._visBoxF[o + 2] = light.visW[i]; this._visBoxF[o + 3] = light.visH[i];
    }
    gl.uniform4fv(loc.uVisBox, this._visBoxF);
    // 14.3 item 5: dirty LVIS slots only, one contiguous MAX_VIS_DIM x
    // MAX_VIS_DIM texSubImage2D per slot (light.vis's per-slot block is
    // already exactly that, row-major - see engine/render/lighting.js).
    gl.bindTexture(gl.TEXTURE_2D, this.texLVis);
    // MAX_VIS_DIM (33) is not a multiple of the default UNPACK_ALIGNMENT
    // (4), so the driver expects each source row padded to 36 bytes unless
    // told otherwise - without this, texSubImage2D rejects the tightly
    // packed `MAX_VIS_DIM*MAX_VIS_DIM`-byte slice with "ArrayBufferView not
    // big enough for request". Reset to the engine-wide default (4) right
    // after - no other texture upload in this file relies on alignment 1.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Architect review 1 item 4: upload keyed by `light.visVersion[i]` vs
    // this pipeline's OWN last-uploaded version - not a one-frame
    // `visDirty` flag, which is cleared by the NEXT `LightSet.update()`
    // regardless of whether this (or any) pipeline actually consumed it.
    for (let i = 0; i < n; i++) {
      if (light.visVersion[i] === this._lvisUploaded[i]) continue;
      const rows = light.vis.subarray(i * MAX_VIS_CELLS, (i + 1) * MAX_VIS_CELLS);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, i * MAX_VIS_DIM, MAX_VIS_DIM, MAX_VIS_DIM, gl.RED_INTEGER, gl.UNSIGNED_BYTE, rows);
      this._lvisUploaded[i] = light.visVersion[i];
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
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

    // US-030b: mirror the same (already resolved) values into the sub-grid
    // textures' (0,0,cols,rows) sub-rect, so `_passShade`'s per-sub-sample
    // average - run with `uN = 1` for this test-only source, see
    // `_passShade` - has exactly one matching sample per cell (itself),
    // reproducing the pre-030b combined shader bit for bit. The extra mask/
    // cov bits GI carries are irrelevant here: shade.frag.js's sub-sample
    // key match only reads kind/planeId/mat (giKind/giMat).
    gl.bindTexture(gl.TEXTURE_2D, this.texSGI);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RG_INTEGER, gl.UNSIGNED_INT, GI);
    gl.bindTexture(gl.TEXTURE_2D, this.texSGA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, GA);
    gl.bindTexture(gl.TEXTURE_2D, this.texSDepth);
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
    const gl = this.gl, loc = this._locsShade;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShade);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progShade);
    gl.bindVertexArray(this.vao);

    this._bindTextures(this._shadeBinds);

    // US-006: light is now `uLightTex` (bound in `_shadeBinds`, filled by
    // `_passLight` right before this call) - no `uLight` uniform any more.
    gl.uniform1f(loc.uTimeSec, this._fb.timeSec || 0);
    // US-030b: the legacy 'upload' test source (14.2 item 7) only mirrors a
    // single sample per cell into the sub-grid textures (see
    // `_repackAndUpload`) - shadeCore's average must run at n=1 for it,
    // regardless of the pipeline's configured `this.rays`.
    gl.uniform1i(loc.uN, this._source === 'upload' ? 1 : this.rays);

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
  'uGI', 'uGA', 'uGD', 'uDepth', 'uSGI', 'uSGA', 'uN', 'uFgTex', 'uBgTex', 'uMatF', 'uMatI', 'uSetI', 'uSetF', 'uGain',
  'uLightTex', 'uTimeSec', 'uCellAspect', 'uCutoff', 'uLift', 'uFgMin', 'uFgMaxGain', 'uTintK',
  'uOverbright', 'uOverbrightMax', 'uAoR', 'uAoK', 'uFaceK', 'uFogFg', 'uFogBg', 'uFogStart', 'uFogFull',
  'uFogStipple0', 'uFogStipple1', 'uFogSparse', 'uFogSparseCodes', 'uFogHazeCodes', 'uFogSparseAlt', 'uFogHazeAlt',
  // US-030a: GPU sky (14.2 item 3).
  'uSky', 'uSkyElevTop', 'uGpuSky', 'uHorizonRow', 'uPlaneDistY',
  // US-016 (14.4 item 5): terrain (kind==7) branch - `b` arrives via GA.w.
  'uTlook', 'uBandNear', 'uBandMid',
  'uTerrainFogStart', 'uTerrainFogFull', 'uTerrainFogCurve', 'uTerrainFogNearRGB', 'uTerrainFogFarRGB',
];
const EDGE_UNIFORMS = ['uGI', 'uDepth', 'uShadeFg', 'uShadeBg', 'uGrid', 'uFogMax', 'uEdgeGlyph', 'uEdgeGain', 'uFogStart', 'uFogFull'];
const DEBUG_UNIFORMS = ['uGI', 'uShadeFg', 'uMode'];
// US-030a/US-030b: cast (DDA, sub-sample) / resolve (vote) / deriv pass uniforms.
const CAST_UNIFORMS = [
  'uWorldGeom', 'uWorldMats', 'uWorldFlags', 'uStructA', 'uStructB', 'uStructCount',
  'uGrid', 'uN', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY', 'uHorizonRow', 'uPlaneDistY',
];
const RESOLVE_UNIFORMS = ['uSGI', 'uSGA', 'uSDepth', 'uMask', 'uN'];
const DERIV_UNIFORMS = ['uGI', 'uGA', 'uDepth', 'uGrid', 'uTanHalfHFov', 'uPlaneDistY'];
// US-006/US-007: light pass uniforms (14.3 items 3/4).
const LIGHT_UNIFORMS = [
  'uGI', 'uDepth', 'uLVis', 'uGrid', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY',
  'uHorizonRow', 'uPlaneDistY', 'uAmbient', 'uLightCount', 'uLightPos', 'uLightCol', 'uVisBox',
  'uSunDir', 'uSunCol', 'uSunOn', 'uWorldGeom', 'uWorldFlags', 'uStructA', 'uStructB', 'uStructCount', 'uWorldMaxH',
];
// US-016 (14.4 items 2-4, GPU build order step 2): pass A2 terrain march.
const TERRAIN_UNIFORMS = [
  'uSGI', 'uSGA', 'uSDepth', 'uFarH', 'uFarType', 'uFarMap',
  'uStructA', 'uStructB', 'uStructCount',
  'uGrid', 'uN', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY',
  'uHorizonRow', 'uPlaneDistY', 'uTerrainMaxH', 'uSunDir', 'uAmbientI', 'uSunI',
];
