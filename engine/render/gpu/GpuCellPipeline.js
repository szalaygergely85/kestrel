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
import { allocGridTargets, freeGridTargets } from './gridTargets.js';
import { packMaterialTable } from './ShadeTextures.js';
import { packTerrainTextures, packNearTextures } from './TerrainTextures.js';
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
// US-026a S5 (23.4): the shared near-band gate/bounds helpers, plus the
// dither salt (uniform, never a hand-copied literal) - the JS oracle
// (terrainCaster.js) and this pipeline's uniform upload use the SAME
// `terrainHBounds` so `uTerrainMaxH` never drifts from the JS march's own
// combined bound.
import { sunFromWorld, terrainHBounds, activeNearLOD } from '../terrainCaster.js';
// US-040 (15.2 items 3/4, build order step 3): pass A3 `voxel` - VOX/VOXINST
// texture layout + the GLSL march itself.
import { VOXEL_FRAG_SRC } from './glsl/voxel.frag.js';
import { VOX_ATLAS_WIDTH, VOXINST_WIDTH, VOXINST_ROWS_PER_INSTANCE, writeInstanceRows } from './VoxelTextures.js';
import { MAX_VOX_INSTANCES } from '../../voxel/VoxelModel.js';
import { GpuTimer, GpuPassTimer } from './GpuTimer.js';
import { buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan, MAX_STRUCTS } from './WorldTextures.js';
import { HFOV_DEG } from '../sectorCaster.js';
import { SKY_LUT_N } from './glsl/common.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_VIS_CELLS } from '../lighting.js';
// ME-04 (docs/backlog.md, docs/architecture.md 27.2/27.4/27.11 ME-04 row):
// the GPU raster pass - `renderer:'mesh'` only, additive (the default
// `renderer:'dda'` path above is untouched by any of these).
import { GpuDeviceGL2 } from './device/GpuDeviceGL2.js';
import { MeshBuffers, CLOTH_DYN_LAYOUT, CLOTH_UV_LAYOUT, CLOTH_STRIDE_BYTES, STATIC_VERTEX_LAYOUT, TERRAIN_VERTEX_LAYOUT, TERRAIN_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES } from './MeshBuffers.js';
import { MESH_VERT_SRC, MESH_INST_VERT_SRC, MESH_CLOTH_VERT_SRC } from './glsl/mesh.vert.js';
import { MESH_FRAG_SRC, MESH_CLOTH_FRAG_SRC } from './glsl/mesh.frag.js';
// ME-06 (docs/backlog.md, docs/architecture.md 27.4, 27.15.5): terrain in
// the raster pass - its own program (`terrain.vert.js`'s kind-7 variant)
// and a persistent `TerrainMeshSet` per bound `Terrain` (one `step()`/
// `addToDrawList()` per rendered frame, exactly like the CPU's own amortised
// band-flip rebuild - `_passRaster` never rebuilds inside a fixed step).
import { TERRAIN_VERT_SRC, TERRAIN_RASTER_FRAG_SRC } from './glsl/terrain.vert.js';
import { terrainMeshSetFor } from '../../mesh/terrainMesh.js';
import { KIND_TERRAIN, KIND_MODEL, FACE_PACKED } from '../GBuffer.js';
import { DrawList, LevelMeshCache, addStructures, DRAW_STATIC, DRAW_TERRAIN, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH, addCloths, MAX_DRAW_ITEMS } from '../../mesh/DrawList.js';
import { MAX_INSTANCES_PER_FRAME, INSTANCE_BYTES } from '../../mesh/instances.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../../mesh/voxelMesh.js';
import { projTerms, shearProjection, createPitchedTerms, pitchedTerms, resolveProjection, assertProjectionRenderer } from '../projection.js';
import { frustumPlanes } from '../../mesh/culling.js';
// ME-15b (27.9a): sun shadow map pass (depth only, before the raster pass).
import { resolveSunShadowOptions, createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar, shadowInputHash } from '../shadowSun.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../../mesh/shadowList.js';
import { SHADOW_FRAG_SRC, SHADOW_TERRAIN_FRAG_SRC, SHADOW_DEPTH_COPY_FRAG_SRC } from './glsl/shadow.frag.js';
import { CELL_VERT_SRC as SHADOW_COPY_VERT_SRC } from './glsl/cell.vert.js';
// US-055a2a (35.3): the water layer pass (mesh renderer only): clipmap draws into the cell-resolution WATER target.
import { WATER_VERT_SRC } from './glsl/water.vert.js';
import { WATER_FRAG_SRC } from './glsl/water.frag.js';
// US-055a2b (35.3): the water composite - its own fullscreen pass between shade and edge (shade is at the 16-sampler cap).
import { WATER_COMPOSITE_FRAG_SRC } from './glsl/waterComposite.frag.js';
import { WL_STRIDE, WL_SLOTS, WFOG_LEN, defaultWaterLooks, resolveWaterLooks, fillWaterSlotTable, waterFogParams } from '../waterLook.js';
import { WaterLayer, WATER_CLEAR_X } from './waterLayer.js';
import { selectWater, createWaterSelection, RUNS_STRIDE } from '../water.js';
import { WATER_U_STRIDE, U_KIND, U_Z, U_AABB, U_SHAPE, U_SLOT } from '../../mesh/waterMesh.js';

const EMPTY3 = [0, 0, 0]; // fallback ambient when `frame()` was handed neither a LightSet nor an array.

// US-018 (architecture.md 16): fixed pass slot order for per-pass GPU
// timing - `sprites` is tracked by its own existing GpuTimer (sprites.js),
// reported alongside these, not a slot here. "resolve" covers both the
// resolve and deriv draw calls (one query spans both, per the tech notes).
export const PASS_NAMES = Object.freeze(['cast', 'terrain', 'voxel', 'resolve', 'light', 'shade', 'edge', 'shadow', 'water', 'wcomp']);
const PASS_CAST = 0, PASS_TERRAIN = 1, PASS_VOXEL = 2, PASS_RESOLVE = 3, PASS_LIGHT = 4, PASS_SHADE = 5, PASS_EDGE = 6, PASS_SHADOW = 7, PASS_WATER = 8, PASS_WCOMP = 9;
const PASS_STATS_EVERY = 30; // matches GpuTimer's own STATS_EVERY - see _pollTerrainTs/_pollVoxelTs

function sumFinite(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) if (!Number.isNaN(arr[i])) s += arr[i];
  return s;
}

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
    // ARCH CHANGES item 3 (14.4 item 8): `?terrain=0` dev A/B switch -
    // default true (terrain on), main.js passes `false` to force pass A2 off
    // regardless of `world.terrain.farReady` (see `_terrainActiveThisFrame`).
    this.terrainEnabled = opts.terrainEnabled !== false;
    // ME-04 (27.11 ME-04 AC "createEngine({ renderer: 'mesh' | 'dda' })"):
    // 'dda' (default) is every pass this class had before this story,
    // completely untouched; 'mesh' additionally builds the raster-pass
    // program/device/caches below and swaps pass A for `_passRaster()` in
    // `_hook()` - resolve/deriv/light/shade/edge run unchanged either way.
    this.renderer = opts.renderer === 'mesh' ? 'mesh' : 'dda';
    // ME-15b (27.9a item 1): `createEngine({ shadows })` (main.js passes `engine.shadows`) merged over
    // SUN_SHADOW_DEFAULTS once; `sun` defaults to 'map' on the mesh renderer, 'dda' otherwise.
    this.shadowOpts = resolveSunShadowOptions(opts.shadows, this.renderer);
    this.ready = false;
    this.stats = {
      uploadMs: 0, repackMs: 0, drawMs: 0, gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN,
      // ARCH CHANGES item 4: renamed from `terrainGpuMs*` - this is a CPU
      // `performance.now()` bracket around the pass A2 draw call (submit
      // time), NOT a GPU-side cost (see the constructor comment above on
      // why a real GPU query can't be nested here). The real terrain GPU
      // cost is measured as the whole-frame `gpuMs` A/B delta with vs
      // without `?terrain=0` - see main.js and this story's Programmer notes.
      terrainSubmitMs: NaN, terrainSubmitMsP50: NaN, terrainSubmitMsP95: NaN,
      // US-040 (15.2 item 6): same CPU submit-time bracket, around pass A3.
      voxelMs: NaN, voxelMsP50: NaN, voxelMsP95: NaN, voxelInstances: 0, voxelDraws: 0, instancedDraws: 0, instances: 0, /* RE-06 */ // voxelDraws (ME-08c): mesh path draw calls for voxel parts last frame (ME-17 baseline)
      waterSlots: 0, waterDraws: 0, // US-055a2a: water regions selected / clipmap draw calls last frame
      shadowItems: 0, shadowDraws: 0, shadowCpuMs: 0, // ME-15b: sun shadow pass caster items / draw calls last frame
      instancesCulled: 0, instancesLod1: 0, // RE-15a (28.13 point 8): F3 `inst <drawn>/<total> lod1 <n> cull <culled>`
      // US-018 (architecture.md 16): real per-pass GPU ms, filled only
      // while `setPassTiming(true)` (F3 overlay open or `?bench=1`) - NaN
      // otherwise. `passMsP50`/`passMsP95` line up with `PASS_NAMES`.
      passMsP50: new Float32Array(PASS_NAMES.length).fill(NaN),
      passMsP95: new Float32Array(PASS_NAMES.length).fill(NaN),
    };
    this._passTimingOn = false;
    this.debugMode = -1; // -1 = off (edge pass runs normally)
    this._fb = null;
    this._light = null;
    this._table = null; // last bound MaterialTable - rebind target on context restore
    // US-040 (15.2 item 2): the VoxelPool this pipeline draws, set by
    // bindVoxels() - null until the caller has one (US-040 has no entity
    // binding yet, so a dev harness/main.js owns pushInstance()).
    this._voxelPool = null;
    this._viewModel = null; // US-078a: ViewModelLayer (engine.viewModel), set by bindViewModel()
    this._vmList = null;
    this._instances = null; // RE-06: InstanceGroups (engine.instances), set by bindInstances()

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
    // US-040 (15.2 item 4, GPU build order step 3): pass A3, ping-ponging
    // between the SAME two sub-sample sets A1/A2 already own (no third set).
    this.progVoxel = linkProgram(gl, CELL_VERT_SRC, VOXEL_FRAG_SRC);
    // ME-04: the raster pass' own program (real geometry, not the
    // fullscreen-triangle CELL_VERT_SRC every other pass above uses) - only
    // compiled/allocated when this instance is the 'mesh' renderer, so the
    // default 'dda' pipeline's init cost/VRAM is exactly unchanged.
    this.progMesh = null;
    this._meshDevice = null;
    this._meshBuffers = null;
    this._levelMeshCache = null;
    this._meshDrawList = null;
    if (this.renderer === 'mesh') {
      this.progMesh = linkProgram(gl, MESH_VERT_SRC, MESH_FRAG_SRC);
      // RE-06 (28.6): instanced voxel units - second program (instanced vert + the same frag),
      // one pipeline-owned dynamic instance VBO refilled per frame, divisors set once on its VAO.
      this.progMeshInst = linkProgram(gl, MESH_INST_VERT_SRC, MESH_FRAG_SRC);
      // CLOTH-1b2 (33.5): cloth program (cloth vert + cloth frag) and its VAO: attribs 0/1/2 (pos, uv, nrm) from two buffers.
      this.progMeshCloth = linkProgram(gl, MESH_CLOTH_VERT_SRC, MESH_CLOTH_FRAG_SRC);
      // US-055a2a (35.3): water layer - program, VAO (one vec4 attribute), static clipmap buffers + WATER target (lazy, WaterLayer)
      this.progWater = linkProgram(gl, WATER_VERT_SRC, WATER_FRAG_SRC);
      this._waterVao = gl.createVertexArray();
      // 36.1: slot/fog arrays plus a conservative 32-vector allowance for scalar/projection uniforms.
      if (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < WL_SLOTS * WL_STRIDE / 4 + WFOG_LEN / 4 + 32) {
        throw new Error('water composite exceeds the fragment uniform vector budget');
      }
      this.progWaterComp = linkProgram(gl, CELL_VERT_SRC, WATER_COMPOSITE_FRAG_SRC);
      this._water = null; // WaterLayer, created with the device below
      this._waterLooks = defaultWaterLooks(); // US-055a2b: setWaterLooks() binds the designer table
      this._waterTable = new Float32Array(WL_SLOTS * WL_STRIDE);
      this._waterFog = new Float32Array(WFOG_LEN);
      this._waterOS = new Float32Array(WL_SLOTS * 2); // edge pass: per slot (opaqueAt, seeThrough)
      this._waterSun = { dirX: 0, dirY: 0, dirZ: 1, ambientI: 0, sunI: 0 };
      this._waterSel = createWaterSelection();
      this._waterActive = false;
      this._waterMvp = new Float32Array(16);
      this._waterClearU = new Uint32Array([WATER_CLEAR_X, 0, 0, 0]);
      this._waterClearD = new Float32Array([1]);
      this._meshClothVao = gl.createVertexArray();
      gl.bindVertexArray(this._meshClothVao);
      for (let a = 0; a <= 2; a++) gl.enableVertexAttribArray(a);
      gl.bindVertexArray(null);
      this._meshInstVbo = gl.createBuffer();
      this._meshInstVao = gl.createVertexArray();
      gl.bindVertexArray(this._meshInstVao);
      // RE-06b (28.7): voxel attribs 0-3 enabled, 4/5 (aux) disabled -> generic constant zero.
      for (let a = 0; a <= 3; a++) gl.enableVertexAttribArray(a);
      for (let a = 6; a <= 9; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribDivisor(a, 1); }
      this._meshVoxVao = gl.createVertexArray();
      gl.bindVertexArray(this._meshVoxVao);
      for (let a = 0; a <= 3; a++) gl.enableVertexAttribArray(a);
      gl.bindVertexArray(null);
      this._teamSlotI32 = new Int32Array(4);
      this._teamMatI32 = new Int32Array(32);
      this._meshDevice = new GpuDeviceGL2(gl);
      this._meshBuffers = new MeshBuffers(this._meshDevice);
      this._water = new WaterLayer(this._meshDevice);
      // ME-06: was 64 (level structures only, ME-04) - terrain items (9 near
      // chunks + 1 stitch + up to `_farTiles.length` far tiles, e.g. 64 for
      // overworld_far) push real worlds well past that, hence the shared
      // MAX_DRAW_ITEMS cap (27.8's own preallocation constant) instead of a
      // second, smaller ad hoc number.
      this._meshDrawList = new DrawList(MAX_DRAW_ITEMS);
      this._meshViewProj = new Float64Array(16);
      this._meshViewProjF32 = new Float32Array(16);
      this._meshModelF32 = new Float32Array(16);
      this._meshFrustumPlanes = new Float64Array(24);
      this._meshGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 }; // RE-02a: reused, no per-frame literal
      this._meshTerms = { cols: 0, rows: 0, eyeX: 0, eyeY: 0, eyeZ: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, tanHalf: 0, planeDistX: 0, planeDistY: 0, horizonRow: 0, tanPitch: 0 };
      this._meshVao = gl.createVertexArray();
      // ME-06 (27.4/27.15.5): terrain's own program/VAO - a different
      // vertex layout (pos+nrm only, indexed) and its own near/far type
      // texture lookup, so it cannot share `progMesh`/`_meshVao` (the
      // DRAW_STATIC level-quad pipeline). One `TerrainMeshSet` per `Terrain`
      // instance, shared with the JS twin via `terrainMeshSetFor`'s own
      // WeakMap (27.15.5a item 6) - survives a world switch without leaking
      // the old one - `dispose()` below never needs to walk it, GC does.
      this.progMeshTerrain = linkProgram(gl, TERRAIN_VERT_SRC, TERRAIN_RASTER_FRAG_SRC);
      this._meshTerrainVao = gl.createVertexArray();
      // Structure footprints (x0, y0, x1, y1 per placed structure) for the
      // terrain raster frag's carve (terrain.vert.js header) - filled per
      // frame in `_passRaster`, allocated once.
      this._meshStructFoot = new Float32Array(MAX_STRUCTS * 4);
      this._structCount = 0;
      this._rasterTerrainSet = null;
      // ME-15b (27.9a): sun shadow map - 2048^2 (default) depth24 texture, depth-only target, programs reusing the
      // raster pass' vertex shaders with an empty fragment stage. All allocated once; zero per-frame allocation.
      this.shadowActive = false;
      this._shadowDepthTex = null;
      this._shadowTarget = null;
      this.progShadow = null; this.progShadowTerrain = null; this.progShadowInst = null; this.progShadowCloth = null;
      this._copyPipeline = null; this._copyTarget = null; this._copyTex = null;
      if (this.shadowOpts.sun === 'map') {
        const dev = this._meshDevice, res = this.shadowOpts.res;
        this._shadowDepthTex = dev.createTexture({ format: 'depth24', width: res, height: res, sampled: true });
        this._shadowTarget = dev.createTarget({ color: [], depth: this._shadowDepthTex });
        this.progShadow = linkProgram(gl, MESH_VERT_SRC, SHADOW_FRAG_SRC);
        this.progShadowTerrain = linkProgram(gl, TERRAIN_VERT_SRC, SHADOW_TERRAIN_FRAG_SRC);
        this.progShadowInst = linkProgram(gl, MESH_INST_VERT_SRC, SHADOW_FRAG_SRC); // ME-15c: RE-06 instanced casters
        this.progShadowCloth = linkProgram(gl, MESH_CLOTH_VERT_SRC, SHADOW_FRAG_SRC); // CLOTH-1b2: depth-only cloth casters
        this._sunMat = createSunShadowMatrix();
        this._sunMatF32 = new Float32Array(16);
        this._shadowList = createShadowList();
        this._shadowCentre = new Float64Array(3);
        this._shadowKey = new Int32Array(2); this._shadowKeyPrev = new Int32Array(2); this._shadowKeyValid = false; // ME-15d dirty-skip
        this.shadowRenders = 0; this.shadowSkips = 0; // ME-15d counters (AC 2)
        this._shadowWorldZ = { min: 0, max: 0 };
        this._shadowSrc = { centre: { x: 0, y: 0, z: 0 }, cache: null, terrainSet: null, voxelPool: null, voxelMeshCache: sharedVoxelMeshCache, fogFarM: 2000, instances: null, cloths: null, matIdFor: undefined };
      }
    }

    // --- G-buffer + shade-output textures and every FBO built ON them
    // (US-030a: all-uint now - 14.2 item 3): US-038a (D-025, architecture.md
    // 22.4) pulled all of this - the RESOLVED per-cell textures, the
    // sub-sample sets, mask/light and the 7 FBOs - out into `gridTargets.js`
    // (`allocGridTargets`), the one place that knows how to (re)allocate
    // them; `resizeGrid` below reuses it for a live grid change without
    // recompiling anything. The fields land on `this` exactly as before
    // (Object.assign), so every other method in this class keeps reading
    // `this.texGI`/`this.fboCast`/etc. unchanged. ---
    this.subCols = this.cols * this.rays;
    this.subRows = this.rows * this.rays;
    this._t = allocGridTargets(gl, this.cols, this.rows, this.rays, this.rt.fgTex, this.rt.bgTex);
    Object.assign(this, this._t);
    // US-006 (14.3 items 3/5): the LVIS occlusion atlas (R8UI, MAX_VIS_DIM x
    // (MAX_LIGHTS*MAX_VIS_DIM)) - NOT grid-sized (fixed dims), so it stays
    // outside gridTargets.js/resizeGrid - see engine/render/lighting.js's
    // module doc for the boxed-per-light convention this atlas shares with
    // the JS reference.
    this.texLVis = createTexture2D(gl, gl.R8UI, MAX_VIS_DIM, MAX_LIGHTS * MAX_VIS_DIM);
    // Architect review 1 item 4: per-slot "what version does THIS texture
    // hold" - reset to -1 (never matches a real `LightSet.visVersion`, which
    // starts at 0) whenever `texLVis` is (re)created, i.e. right here, so a
    // context restore re-uploads every static light's grid on its next frame.
    this._lvisUploaded = new Int32Array(MAX_LIGHTS).fill(-1);

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
    // US-026a S5 (23.4): near-band textures - same 1x1-placeholder pattern,
    // uploaded (packNearTextures) only when `terrain.near.version` changes,
    // independently of the far-bake version above (23.7 S5 "note the layout
    // in a comment": see TerrainTextures.js's own doc comment on NEARH/
    // NEARTYPE/TLOOK's feature texels).
    this.texNearH = createTexture2D(gl, gl.R32F, 1, 1);
    this.texNearType = createTexture2D(gl, gl.R8UI, 1, 1);
    this._terrainNearVersion = -1;

    // --- US-040 (15.2 items 2/3) voxel textures - VOX (the shared atlas,
    // 1x1 placeholder until bindVoxels() uploads a real one on atlas.version
    // change) and VOXINST (fixed size: MAX_VOX_INSTANCES*9 rows, width 8 -
    // never resized, only texSubImage2D'd per frame with the live count). ---
    this.texVOX = createTexture2D(gl, gl.R16UI, 1, 1);
    this.texVOXINST = createTexture2D(gl, gl.RGBA32F, VOXINST_WIDTH, VOXINST_ROWS_PER_INSTANCE * MAX_VOX_INSTANCES);
    this._voxAtlasVersion = -1;
    this._voxInstF = new Float32Array(VOXINST_WIDTH * 4 * VOXINST_ROWS_PER_INSTANCE * MAX_VOX_INSTANCES);
    this._voxRectF = new Float32Array(4 * MAX_VOX_INSTANCES);
    this._voxelSubmitMsHistory = new Float32Array(16);
    this._voxelSubmitMsHistoryLen = 0;
    this._voxelSubmitMsHistoryPos = 0;

    // --- staging arrays (allocated once, architecture.md 9: no per-frame
    // allocation). US-030a: GA/GD/DEPTH are now uint textures
    // (`floatBitsToUint`) - `_GAf`/`_GDf`/`_DepthF` are Float32Array VIEWS
    // over the SAME ArrayBuffer as the Uint32Array actually uploaded
    // (`_GA`/`_GD`/`_Depth`), so writing a float and uploading its "uint"
    // alias is a free reinterpret-cast, matching `floatBitsToUint` exactly -
    // used only by the legacy `_repackAndUpload` ('upload' test-only source,
    // 14.1/US-029 compat - see `setSource`). ---
    // ME-06: _GI widens 2 -> 4 words/cell (RGBA32UI: z = kind-7 packed
    // normal via the getAoAlias-style transfer `_repackAndUpload` does
    // below, w = objectId, unused by this legacy path - 0).
    this._GI = new Uint32Array(4 * n);
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
    this._SGI = new Uint32Array(4 * n); // ME-06: mirrors _GI's widened shape
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
    this._locsVoxel = this._uniformLocs(this.progVoxel, VOXEL_UNIFORMS);
    this._locsMesh = this.progMesh ? this._uniformLocs(this.progMesh, MESH_UNIFORMS) : null;
    this._locsWater = this.progWater ? this._uniformLocs(this.progWater, WATER_UNIFORMS) : null;
    this._locsWaterComp = this.progWaterComp ? this._uniformLocs(this.progWaterComp, WATER_COMP_UNIFORMS) : null;
    this._locsMeshCloth = this.progMeshCloth ? this._uniformLocs(this.progMeshCloth, MESH_CLOTH_UNIFORMS) : null;
    this._locsShadowCloth = this.progShadowCloth ? this._uniformLocs(this.progShadowCloth, ['uModel', 'uViewProj']) : null;
    this._locsMeshInst = this.progMeshInst ? this._uniformLocs(this.progMeshInst, MESH_INST_UNIFORMS) : null;
    this._locsMeshTerrain = this.progMeshTerrain ? this._uniformLocs(this.progMeshTerrain, TERRAIN_MESH_UNIFORMS) : null;
    this._locsShadow = this.progShadow ? this._uniformLocs(this.progShadow, ['uModel', 'uViewProj']) : null;
    this._locsShadowInst = this.progShadowInst ? this._uniformLocs(this.progShadowInst, ['uModel', 'uViewProj']) : null;
    this._locsShadowTerrain = this.progShadowTerrain ? this._uniformLocs(this.progShadowTerrain, ['uModel', 'uViewProj', 'uStructFoot', 'uStructCount']) : null;

    // Architect review 1 item 3 (blocking): texture bindings are now a
    // plain per-frame loop over these bind-time arrays of [loc, tex, unit]
    // tuples (built once here, not per pass call) - no closures, no result
    // objects allocated in `_passShade`/`_passEdgeOrDebug`. The sampler ->
    // unit mapping itself (`gl.uniform1i`) is also static, so it's set once
    // right here (item 4a), not every frame; only `gl.bindTexture` runs per
    // frame, because the physical unit gets reassigned to a different
    // texture between passes.
    this._buildAllBindTables();

    // US-006: staging array for the per-frame `uVisBox` upload (allocated
    // once - architecture.md 9); `uLightPos`/`uLightCol` upload straight
    // from the LightSet's own arrays (already in the right layout).
    this._visBoxF = new Float32Array(4 * MAX_LIGHTS);

    this.timer = new GpuTimer(gl);
    // US-018 (architecture.md 16): per-pass timer, used only while
    // `setPassTiming(true)` - built alongside `this.timer` (both cheap to
    // construct; the disjoint-timer query ring is the only GL cost and
    // `GpuPassTimer` starts empty/idle until `begin()` is actually called).
    this.passTimer = new GpuPassTimer(gl, PASS_NAMES.length);
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
    // ARCH CHANGES item 5: reused every frame by `sunFromWorld`'s `out` param.
    this._sunScratch = { dirX: 0, dirY: 0, dirZ: 0, ambientI: 0, sunI: 0 };
    this._terrainSubmitMsHistory = new Float32Array(16);
    this._terrainSubmitMsHistoryLen = 0;
    this._terrainSubmitMsHistoryPos = 0;

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

  /**
   * D-025 (US-038a, architecture.md 22.3/22.6): builds every [loc, tex,
   * unit] bind table AND sets each program's static sampler->unit uniforms -
   * factored out of `_initGL()` so `resizeGrid()` can call it again after a
   * live grid change. Reading `this.texGI`/`this.rt.fgTex`/etc. HERE (rather
   * than remapping old->new texture references in the existing tables) is
   * the reason this works correctly for BOTH kinds of grid-sized texture:
   * ones this pipeline owns (recreated by `allocGridTargets`, already
   * `Object.assign`-ed onto `this` by the time this runs) and `rt.fgTex`/
   * `rt.bgTex` (owned by `RenderTargetGL`, already recreated by its own
   * `setGrid` - engine.js's `applyGrid` runs that FIRST). A previous version
   * of `resizeGrid` patched the old tables via an old-texture -> new-texture
   * map that only knew about this pipeline's OWN textures, so `uFgTex`/
   * `uBgTex` (the two entries in `_shadeBindsSet1`/`Set2` pointing at `rt`'s textures)
   * kept sampling the just-deleted pre-resize `fgTex`/`bgTex` objects -
   * `gl.drawArrays` raised `INVALID_OPERATION` for the whole shade pass
   * (caught via `?gpucompare=1&roundtrip=1`, which is exactly why that flag
   * exists - a plain, non-`roundtrip` `?gpucompare=1` never resizes, so it
   * could never have caught this).
   */
  _buildAllBindTables() {
    // BUG-GPU-SHADE-001 fix: `uSGI`/`uSGA` here MUST track `_subSetCur` the
    // same way `_resolveBindsSet1`/`_resolveBindsSet2` already do (see that
    // pair's own comment below) - `shadeCore`'s per-sub-sample average loop
    // (shade.frag.js) re-reads the sub-sample G-buffer directly, by the SAME
    // (kind, planeId, mat) key `resolve.frag.js` voted on. When terrain
    // and/or a voxel-model hit flips the "current" sub-sample set to 2 for
    // this frame (terrain/voxel write into whichever set the OTHER one
    // isn't), a single fixed `texSGI`/`texSGA` binding here silently reads
    // the STALE set-1 (plain cast) data instead - the resolved cell's own
    // (kind, planeId, mat) then matches NONE of that stale sub-sample's
    // members, `shadeCore`'s loop finds `count == 0`, and `main()`'s safety
    // net (shade.frag.js ~line 490) falls back to the raw JS layer texture
    // cells for that pixel: transparent alpha with whatever default color
    // sat in `uFgTex`/`uBgTex` (this pipeline never initializes them to
    // anything - a stray opaque-black/white sentinel), instead of the real
    // shaded surface. Visually: solid black (the compositor's fallback for
    // an alpha-0 cell) or a near-white sentinel up close, on exactly the
    // cells whose closest hit came from terrain/a voxel model that frame -
    // this is BUG-GPU-SHADE-001 ("props render solid black/white in the
    // editor and the game's own GPU path"). Fixed the same way resolve
    // already does it: two prebuilt tables, picked by `_subSetCur` at
    // `_passShade()`'s bind-time (no per-frame allocation, no new uniform).
    this._shadeBindsSet1 = this._buildBindTable(this._locsShade, [
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
    this._shadeBindsSet2 = this._buildBindTable(this._locsShade, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uGD', this.texGD], ['uDepth', this.texDepth],
      ['uSGI', this.texSGI2], ['uSGA', this.texSGA2],
      ['uFgTex', this.rt.fgTex], ['uBgTex', this.rt.bgTex],
      ['uMatF', this.texMatF], ['uMatI', this.texMatI], ['uSetI', this.texSetI],
      ['uSetF', this.texSetF], ['uGain', this.texGain], ['uSky', this.texSky],
      ['uLightTex', this.texLight],
      ['uTlook', this.texTlook],
    ]);
    this._edgeBinds = this._buildBindTable(this._locsEdge, [
      ['uGI', this.texGI], ['uShadeFg', this.texShadeFg], ['uDepth', this.texDepth], ['uShadeBg', this.texShadeBg],
      ['uWater', null], // US-055a2b: entries 1 / 3 / 4 are re-pointed per frame (composite output + WATER) while a water layer exists
    ]);
    // US-055a2b: the composite pass reads shade's output + GI/DEPTH/LIGHT; uWater (the 6th) is re-pointed per frame
    this._waterCompBinds = this.progWaterComp ? this._buildBindTable(this._locsWaterComp, [
      ['uShadeFg', this.texShadeFg], ['uShadeBg', this.texShadeBg], ['uGI', this.texGI], ['uDepth', this.texDepth],
      ['uLightTex', this.texLight], ['uWater', null],
    ]) : null;
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
      // US-026a S5 (23.4): near-band textures - inert (uNearReady == 0)
      // until a world with `terrain.nearReady && activeNearLOD` is bound.
      ['uNearH', this.texNearH], ['uNearType', this.texNearType],
    ]);
    // ME-06: the raster pass' own terrain program only needs the type
    // (mat) lookup textures - no height sampling (real triangles supply
    // z), no sub-sample input (it draws real geometry, not a fullscreen
    // triangle).
    this._meshTerrainBinds = this.progMeshTerrain ? this._buildBindTable(this._locsMeshTerrain, [
      ['uFarType', this.texFarType], ['uNearType', this.texNearType],
    ]) : null;
    // US-040 (15.2 item 4): pass A3 ping-pongs between set 1 (fboCastSub's
    // textures) and set 2 (fboTerrainSub's) - two bind tables sharing the
    // same sampler->unit mapping (both built from `_locsVoxel`), one per
    // "which set is the input this frame" (GpuCellPipeline picks by
    // `_subSetCur`, see `_passVoxel`/`_hook`).
    this._voxelBindsSet1In = this._buildBindTable(this._locsVoxel, [
      ['uSGI', this.texSGI], ['uSGA', this.texSGA], ['uSDepth', this.texSDepth],
      ['uVOX', this.texVOX], ['uVOXINST', this.texVOXINST],
    ]);
    this._voxelBindsSet2In = this._buildBindTable(this._locsVoxel, [
      ['uSGI', this.texSGI2], ['uSGA', this.texSGA2], ['uSDepth', this.texSDepth2],
      ['uVOX', this.texVOX], ['uVOXINST', this.texVOXINST],
    ]);
    this._derivBinds = this._buildBindTable(this._locsDeriv, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uDepth', this.texDepth],
    ]);
    // US-006/US-007: light pass reads the resolved GI/Depth (kind/face,
    // distance) + the LVIS atlas, plus (US-007) the world atlas the sun DDA
    // walks - same textures `_castBinds` binds for `dda.frag.js`, bound
    // again here on light's own sampler units (a different program).
    this._lightBinds = this._buildBindTable(this._locsLight, [
      ['uGI', this.texGI], ['uGA', this.texGA], ['uDepth', this.texDepth], ['uLVis', this.texLVis],
      ['uWorldGeom', this.texWorldGeom], ['uWorldFlags', this.texWorldFlags],
      ['uSunShadow', this._shadowDepthTex ? this._shadowDepthTex.handle : null], // ME-15c (null = DDA sun: sampler unused)
    ]);
    // `_shadeBindsSet1`/`Set2` list every entry in the same order (only the
    // uSGI/uSGA texture object differs), so their unit assignment is
    // identical - either table sets the same sampler-unit uniforms.
    this._setSamplerUniforms(this.progShade, this._shadeBindsSet1);
    this._setSamplerUniforms(this.progEdge, this._edgeBinds);
    if (this.progWaterComp) this._setSamplerUniforms(this.progWaterComp, this._waterCompBinds);
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
    if (this.progMeshTerrain) this._setSamplerUniforms(this.progMeshTerrain, this._meshTerrainBinds);
    // US-040: both voxel bind tables share the same sampler->unit mapping
    // (same reasoning as the terrain resolve tables above).
    this._setSamplerUniforms(this.progVoxel, this._voxelBindsSet1In);
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

  /**
   * US-018 (architecture.md 16): on = every pass runs inside its own
   * `passTimer` query instead of the single whole-frame `timer` span ("do
   * not leave pass timing on when the overlay is hidden and no bench runs" -
   * 8 queries/frame for nothing). Just a flag; the actual query dispatch
   * happens in `_hook()`. Caller (main.js) passes `overlay.visible ||
   * benchActive`.
   */
  setPassTiming(on) {
    this._passTimingOn = !!on;
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
    //
    // Architect review 1 item 1: a `resizeGrid` call that arrived while this
    // pipeline was `!ready` (e.g. mid context-loss) early-returns WITHOUT
    // updating `cols/rows/subCols/subRows`, so those fields can be stale
    // relative to `rt`'s new size by the time a restore fires. Re-read them
    // from `rt` (the source of truth) before `_initGL()` so a restore always
    // rebuilds at the CURRENT grid, never the stale one.
    this.cols = this.rt.cols;
    this.rows = this.rt.rows;
    this.subCols = this.cols * this.rays;
    this.subRows = this.rows * this.rays;
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
    // Architect review 1 item 3: the grid-sized textures/FBOs (this._t, the
    // exact set `allocGridTargets`/`freeGridTargets` own) go through
    // `freeGridTargets` instead of a hand-listed `gl.deleteTexture`/
    // `deleteFramebuffer` loop, so they route through `glUtil`'s `glCounts`
    // dev counter (kept honest across a context loss/restore) and there is
    // one single owner of that field list instead of two that can drift.
    freeGridTargets(gl, this._t);
    this._t = null;
    for (const tex of [this.texMatF, this.texMatI, this.texSetI, this.texSetF, this.texGain, this.texSky,
      this.texWorldGeom, this.texWorldMats, this.texWorldFlags,
      this.texLVis, this.texFarH, this.texFarType, this.texTlook,
      this.texNearH, this.texNearType,
      this.texVOX, this.texVOXINST]) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const p of [this.progShade, this.progEdge, this.progDebug, this.progCast, this.progResolve, this.progDeriv, this.progLight, this.progTerrain, this.progVoxel, this.progMesh, this.progMeshInst, this.progMeshTerrain, this.progShadow, this.progShadowTerrain, this.progShadowInst, this.progMeshCloth, this.progShadowCloth, this.progWater, this.progWaterComp]) if (p) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
    // ME-04: the raster pass' own VAO + MeshBuffers cache (device.dispose()
    // frees every vertex buffer MeshBuffers uploaded, mirroring how every
    // other data texture above is freed on teardown/context loss). ME-06:
    // the terrain program shares that same MeshBuffers/device cache, only
    // its own VAO is separate.
    if (this._meshVao) gl.deleteVertexArray(this._meshVao);
    if (this._meshInstVao) gl.deleteVertexArray(this._meshInstVao);
    if (this._meshClothVao) gl.deleteVertexArray(this._meshClothVao);
    if (this._waterVao) gl.deleteVertexArray(this._waterVao);
    if (this._meshVoxVao) gl.deleteVertexArray(this._meshVoxVao);
    if (this._meshInstVbo) gl.deleteBuffer(this._meshInstVbo);
    if (this._meshTerrainVao) gl.deleteVertexArray(this._meshTerrainVao);
    if (this._meshBuffers) this._meshBuffers.dispose();
    if (this._water) this._water.dispose();
    if (this._meshDevice) this._meshDevice.dispose();
    if (this.timer) this.timer.dispose();
    // US-030a: the world atlas textures are gone too - force a full
    // re-upload on the next frame after a context restore.
    this._worldAtlas = null;
    // US-016: same for the far-terrain textures.
    this._terrainVersion = -1;
    this._terrainWorld = null;
    this._terrainPacked = null;
    // US-026a S5: same for the near-terrain textures.
    this._terrainNearVersion = -1;
    // US-040: force a full VOX re-upload on the next bindVoxels() call.
    this._voxAtlasVersion = -1;
  }

  /**
   * D-025 (US-038a, architecture.md 22.1/22.3/22.4/22.6): live grid change -
   * resize IN PLACE, never a new pipeline (no shader recompile, no program/
   * VAO/data-texture churn). Frees every grid-sized texture/FBO
   * (`gridTargets.js`), reallocates them at the new size (against `rt`'s
   * ALREADY-resized fg/bg - the caller, `engine.js`'s `applyGrid`, runs
   * `rt.setGrid` first), then patches every existing bind-table tuple that
   * pointed at an old grid-sized texture to point at its replacement -
   * `loc`/`unit` never change, only which texture a unit samples, so the
   * tables themselves (and every non-grid-sized entry in them, e.g. uMatF/
   * uWorldGeom/uVOX) are reused as-is. Called by main.js's `grid:changed`
   * listener, right after `bind()` is NOT needed again (bind() only handles
   * the MaterialTable-derived data textures/uniforms, untouched by a grid
   * change - `cellAspect` is handled separately, see the table in
   * architecture.md 22.3's "game (main.js)" row).
   */
  resizeGrid(cols, rows) {
    if (!this.ready) return;
    const gl = this.gl;
    const old = this._t;

    // Architect review 1 item 2: alloc runs BEFORE anything old is freed
    // (as before), but now `this.cols/rows/subCols/subRows` are only
    // committed AFTER a successful alloc - on a realistic out-of-memory
    // failure at the new size, `allocGridTargets` throws (already
    // self-cleaning per its own fix), `old` is still intact and untouched,
    // and this pipeline falls back cleanly instead of the exception
    // escaping into `applyGrid` -> `loop.render` and killing the rAF loop.
    let t;
    try {
      t = allocGridTargets(gl, cols, rows, this.rays, this.rt.fgTex, this.rt.bgTex);
    } catch (e) {
      console.error('[GpuCellPipeline] resizeGrid failed at', `${cols}x${rows}`, '- falling back to CPU shading at the old grid:', e);
      this.ready = false;
      this.rt.gpuActive = false;
      this.setEnabled(false);
      return;
    }
    freeGridTargets(gl, old);
    this.cols = cols;
    this.rows = rows;
    this.subCols = cols * this.rays;
    this.subRows = rows * this.rays;
    this._t = t;
    Object.assign(this, t);

    // Rebuilds every [loc, tex, unit] bind table AND `rt.fgTex`/`rt.bgTex`'s
    // own entry in `_shadeBindsSet1`/`Set2` - see `_buildAllBindTables`'s own comment
    // for why this (re-reading current fields) is correct where an
    // old-texture -> new-texture remap of only THIS pipeline's own textures
    // was not (it missed `rt`'s fg/bg, which `RenderTargetGL.setGrid` had
    // already replaced by the time this method runs).
    this._buildAllBindTables();

    // Static uGrid uniform on the edge program (bind()'s own
    // _bindStaticUniforms sets this once - resizeGrid doesn't call bind()).
    gl.useProgram(this.progEdge);
    gl.uniform2i(this._locsEdge.uGrid, cols, rows);

    // Staging arrays sized by cols*rows / subCols*subRows (architecture.md
    // 9: allocated here, not per frame - same shapes as `_initGL`'s).
    const n = cols * rows;
    this._GI = new Uint32Array(4 * n); // ME-06: widened, see _initGL's own comment
    const gaBuf = new ArrayBuffer(16 * n);
    this._GAf = new Float32Array(gaBuf); this._GA = new Uint32Array(gaBuf);
    const gdBuf = new ArrayBuffer(16 * n);
    this._GDf = new Float32Array(gdBuf); this._GD = new Uint32Array(gdBuf);
    const depthBuf = new ArrayBuffer(4 * n);
    this._DepthF = new Float32Array(depthBuf); this._Depth = new Uint32Array(depthBuf);
    this._MASK = new Uint8Array(n);
    this._SGI = new Uint32Array(4 * n); // ME-06: widened
    const sgaBuf = new ArrayBuffer(16 * n);
    this._SGAf = new Float32Array(sgaBuf); this._SGA = new Uint32Array(sgaBuf);
    const sdepthBuf = new ArrayBuffer(4 * n);
    this._SDepthF = new Float32Array(sdepthBuf); this._SDepth = new Uint32Array(sdepthBuf);
    this._readbackFg = new Uint8Array(4 * n);
    this._readbackBg = new Uint8Array(4 * n);
    // Lazy readbacks are cached with `||` (see readbackGeometry/readbackLight) -
    // MUST be reset to null so the next call reallocates at the new size.
    this._readbackGI = null;
    this._readbackGA = null;
    this._readbackDepth = null;
    this._readbackLight = null;
  }

  /**
   * US-040 (15.2 items 1/2): binds the VoxelPool this pipeline draws voxel
   * model instances from - `pool` must already have been `pool.bind(registry,
   * table)`-ed. Called once (or whenever the registry/table changes, e.g.
   * `bind()`'s own caller); the VOX atlas is re-uploaded lazily, only when
   * `pool.atlas.version` changes (never per frame - 15.2 "do not" list).
   */
  bindVoxels(pool) {
    this._voxelPool = pool;
  }

  /** US-078a (architecture.md 30.1): binds `engine.viewModel`; `_passRaster` draws its list after a depth-only clear. */
  bindViewModel(vm) {
    this._viewModel = vm;
    this._vmList = null;
  }

  /** RE-06: binds the `InstanceGroups` (engine.instances) whose groups `_passRaster` draws instanced. */
  bindInstances(groups) {
    this._instances = groups;
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
    // ME-04: a rebind means matIdFor may have changed (new palette/detail
    // pass) - rebuild the level-mesh cache from scratch rather than risk a
    // stale mat id baked into an old MeshData (LevelMeshCache itself only
    // rebuilds a structure's OWN mesh on its `packed.version` change, never
    // on a matIdFor change, so this is the one seam that must reset it).
    if (this.renderer === 'mesh') this._levelMeshCache = new LevelMeshCache(table.idFor);
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
    gl.uniform1f(locE.uModelRim, U.edges ? U.edges.modelRim : 1);
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
    // RE-02a (28.1): 'pitched' only exists on the mesh renderer - fail loudly at the entry.
    if (cam) assertProjectionRenderer(cam, this.renderer);
    this._fb = fb;
    this._light = light;
    this._cam = cam || null;
    this._world = world || null;
    if (this.renderer === 'mesh' && this._water) this._water.bindWorld(this._world);
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
    // US-018: pass timing is all-or-nothing per frame - either the single
    // whole-frame `timer` span (default, unchanged) or `passTimer` wrapping
    // each pass individually (never both: a nested TIME_ELAPSED_EXT query
    // is illegal - see the constructor comment above `this.timer`).
    const passTimingOn = this._passTimingOn && this.passTimer.available;
    if (!passTimingOn) this.timer.begin();
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
    this._terrainActiveThisFrame = useDda && this.terrainEnabled && !!(this._world && this._world.terrain && this._world.terrain.farReady);
    // US-040 (15.2 item 2): project this frame's queued voxel instances
    // (pose -> AABB -> screen rect -> cull) - the SAME instanceRect step
    // castModels uses, so the two paths can never disagree. `pool.beginFrame
    // ()`/`pushInstance()` are the caller's responsibility (US-040 has no
    // entity binding yet); this only consumes what is already queued.
    this._voxelActiveThisFrame = false;
    if (useDda && this._voxelPool) {
      // ME-08a (27.16 item 6): the mesh path draws voxels as triangles in
      // `_passRaster`, so the DDA voxel atlas (VRAM + upload) is skipped.
      if (this.renderer !== 'mesh') this._ensureVoxelAtlas(this._voxelPool);
      this._voxelPool.project(this._cam, this.rt, this.renderer);
      this._voxelActiveThisFrame = this._voxelPool.list.length > 0;
    }
    if (useDda && this.renderer === 'mesh') {
      // ME-04: pass A entirely replaced by the raster pass (27.11 ME-04 AC
      // "'mesh' skips A1-A3") - no terrain/voxel pass this story (ME-06/08
      // add their own draws to `_passRaster` later); `_subSetCur = 1`
      // because `_passRaster` writes the SAME set-1 textures `_passCast`
      // does (fboRasterSub reuses fboCastSub's texSGI/texSGA/texSDepth), so
      // resolve/deriv below are byte-for-byte the same call they already are.
      this._prepRaster();
      this.shadowActive = false;
      if (this._shadowTarget) { // ME-15b: sun shadow map before the raster pass (27.9a)
        if (passTimingOn) this.passTimer.begin(PASS_SHADOW);
        this._passShadow();
        if (passTimingOn) this.passTimer.end();
      }
      if (passTimingOn) this.passTimer.begin(PASS_CAST);
      this._passRaster();
      if (passTimingOn) this.passTimer.end();
      this._subSetCur = 1;
      if (passTimingOn) this.passTimer.begin(PASS_RESOLVE);
      this._passResolve();
      this._passDeriv();
      if (passTimingOn) this.passTimer.end();
      // US-055a2a (35.3): the water layer, right after deriv and before light (its own timing span: spans never nest).
      if (this._waterActive) {
        if (passTimingOn) this.passTimer.begin(PASS_WATER);
        this._passWater();
        if (passTimingOn) this.passTimer.end();
      }
    } else if (useDda) {
      if (passTimingOn) this.passTimer.begin(PASS_CAST);
      this._passCast();
      if (passTimingOn) this.passTimer.end();
      this._subSetCur = 1; // cast always writes set 1 (fboCastSub's textures)
      if (this._terrainActiveThisFrame) {
        this._terrainTsBegin();
        if (passTimingOn) this.passTimer.begin(PASS_TERRAIN);
        this._passTerrain();
        if (passTimingOn) this.passTimer.end();
        this._terrainTsEnd();
        this._subSetCur = 2;
      }
      if (this._voxelActiveThisFrame) {
        this._voxelTsBegin();
        if (passTimingOn) this.passTimer.begin(PASS_VOXEL);
        this._passVoxel();
        if (passTimingOn) this.passTimer.end();
        this._voxelTsEnd();
        this._subSetCur = this._subSetCur === 1 ? 2 : 1;
      }
      // One query spans both resolve + deriv (tech notes: "resolve (resolve
      // + deriv)") - they are two draw calls of the same logical pass.
      if (passTimingOn) this.passTimer.begin(PASS_RESOLVE);
      this._passResolve();
      this._passDeriv();
      if (passTimingOn) this.passTimer.end();
    }
    // US-006 (14.3 item 3): light pass runs unconditionally (also over the
    // legacy 'upload' source's mirrored GI/Depth - see `_repackAndUpload`),
    // right before shade, exactly like `deriv` already does.
    if (passTimingOn) this.passTimer.begin(PASS_LIGHT);
    this._passLight();
    if (passTimingOn) this.passTimer.end();
    if (passTimingOn) this.passTimer.begin(PASS_SHADE);
    this._passShade();
    if (passTimingOn) this.passTimer.end();
    if (this._waterActive) { // US-055a2b: composite the water layer onto the shade output (the edge pass then reads the composite)
      if (passTimingOn) this.passTimer.begin(PASS_WCOMP);
      this._passWaterComposite();
      if (passTimingOn) this.passTimer.end();
    }
    if (passTimingOn) this.passTimer.begin(PASS_EDGE);
    this._passEdgeOrDebug();
    if (passTimingOn) this.passTimer.end();
    if (!passTimingOn) this.timer.end();
    const t2 = performance.now();
    this.stats.uploadMs = t1 - t0;
    this.stats.drawMs = t2 - t1;
    if (passTimingOn) {
      // writes passMsP50/passMsP95 in place - no allocation (same rule as
      // GpuTimer.writeStats below); gpuMs/gpuMsP50/gpuMsP95 become the sum
      // of the per-pass values so the overlay/bench's existing "gpu Nms"
      // line still means "whole frame" when pass timing is on.
      this.passTimer.writeStats(this.stats.passMsP50, this.stats.passMsP95);
      this.stats.gpuMsP50 = sumFinite(this.stats.passMsP50);
      this.stats.gpuMsP95 = sumFinite(this.stats.passMsP95);
      this.stats.gpuMs = this.stats.gpuMsP50;
    } else {
      this.stats.passMsP50.fill(NaN);
      this.stats.passMsP95.fill(NaN);
      this.timer.writeStats(this.stats); // writes gpuMs/gpuMsP50/gpuMsP95 in place - no allocation (architect review 1 item 3)
    }
    this._pollTerrainTs();
    this._pollVoxelTs();
  }

  // US-016 step 6: CPU `performance.now()` bracket around just the terrain
  // draw call (see the constructor comment for why a true GPU query can't
  // be nested inside `this.timer`'s whole-frame span, and why the
  // TIMESTAMP_EXT alternative measured 0 on the owner's real GPU).
  _terrainTsBegin() { this._terrainT0 = performance.now(); }

  _terrainTsEnd() {
    const ms = performance.now() - this._terrainT0;
    this._terrainSubmitMsHistory[this._terrainSubmitMsHistoryPos] = ms;
    this._terrainSubmitMsHistoryPos = (this._terrainSubmitMsHistoryPos + 1) % this._terrainSubmitMsHistory.length;
    if (this._terrainSubmitMsHistoryLen < this._terrainSubmitMsHistory.length) this._terrainSubmitMsHistoryLen++;
  }

  _pollTerrainTs() {
    const s = this.stats;
    if (this._terrainSubmitMsHistoryLen === 0) { s.terrainSubmitMs = NaN; s.terrainSubmitMsP50 = NaN; s.terrainSubmitMsP95 = NaN; return; }
    // `terrainSubmitMs` itself is just the latest raw sample - cheap, no
    // sort needed. Architect review (16, "fix the per-frame subarray"): the
    // sort behind the p50/p95 percentiles only actually reruns every
    // `PASS_STATS_EVERY` calls (same caching GpuTimer/GpuPassTimer use
    // above), not every single frame - `_terrainTsScratch` is allocated
    // once, lazily, and reused.
    const lastPos = (this._terrainSubmitMsHistoryPos - 1 + this._terrainSubmitMsHistory.length) % this._terrainSubmitMsHistory.length;
    s.terrainSubmitMs = this._terrainSubmitMsHistory[lastPos];
    this._terrainTsCalls = (this._terrainTsCalls || 0) + 1;
    if (this._terrainTsCachedP50 === undefined || Number.isNaN(this._terrainTsCachedP50) || this._terrainTsCalls % PASS_STATS_EVERY === 0) {
      if (!this._terrainTsScratch) this._terrainTsScratch = new Float32Array(this._terrainSubmitMsHistory.length);
      const n = this._terrainSubmitMsHistoryLen, scratch = this._terrainTsScratch;
      for (let i = 0; i < n; i++) scratch[i] = this._terrainSubmitMsHistory[i];
      const view = scratch.subarray(0, n);
      view.sort();
      this._terrainTsCachedP50 = view[Math.floor(n * 0.5)];
      this._terrainTsCachedP95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
    }
    s.terrainSubmitMsP50 = this._terrainTsCachedP50;
    s.terrainSubmitMsP95 = this._terrainTsCachedP95;
  }

  // US-040 (15.2 item 6): same CPU submit-time bracket as _terrainTsBegin/
  // End (see the constructor comment on why a real GPU query can't nest
  // inside `this.timer`'s span) - around just the voxel pass draw call.
  _voxelTsBegin() { this._voxelT0 = performance.now(); }

  _voxelTsEnd() {
    const ms = performance.now() - this._voxelT0;
    this._voxelSubmitMsHistory[this._voxelSubmitMsHistoryPos] = ms;
    this._voxelSubmitMsHistoryPos = (this._voxelSubmitMsHistoryPos + 1) % this._voxelSubmitMsHistory.length;
    if (this._voxelSubmitMsHistoryLen < this._voxelSubmitMsHistory.length) this._voxelSubmitMsHistoryLen++;
  }

  _pollVoxelTs() {
    const s = this.stats;
    if (this._voxelSubmitMsHistoryLen === 0) { s.voxelMs = NaN; s.voxelMsP50 = NaN; s.voxelMsP95 = NaN; return; }
    const lastPos = (this._voxelSubmitMsHistoryPos - 1 + this._voxelSubmitMsHistory.length) % this._voxelSubmitMsHistory.length;
    s.voxelMs = this._voxelSubmitMsHistory[lastPos];
    this._voxelTsCalls = (this._voxelTsCalls || 0) + 1;
    if (this._voxelTsCachedP50 === undefined || Number.isNaN(this._voxelTsCachedP50) || this._voxelTsCalls % PASS_STATS_EVERY === 0) {
      if (!this._voxelTsScratch) this._voxelTsScratch = new Float32Array(this._voxelSubmitMsHistory.length);
      const n = this._voxelSubmitMsHistoryLen, scratch = this._voxelTsScratch;
      for (let i = 0; i < n; i++) scratch[i] = this._voxelSubmitMsHistory[i];
      const view = scratch.subarray(0, n);
      view.sort();
      this._voxelTsCachedP50 = view[Math.floor(n * 0.5)];
      this._voxelTsCachedP95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
    }
    s.voxelMsP50 = this._voxelTsCachedP50;
    s.voxelMsP95 = this._voxelTsCachedP95;
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
    let changed = false;
    if (this._terrainVersion !== terrain.farVersion || this._terrainWorld !== world) {
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
      changed = true;
    }
    if (this._ensureNearTerrainTextures(terrain)) changed = true;
    if (changed) this._uploadTerrainUniforms(terrain, this._palette);
  }

  // US-026a S5 (23.4): uploads `NEARH`/`NEARTYPE` once when `terrain.near.
  // version` changes - independent of the far-bake version above (the near
  // band is baked synchronously in `World.load`, 23.1 decision 1, so this
  // usually flips once, right after the far bake). No-op while the world
  // has no near band baked yet (`terrain.nearReady` false). Returns true
  // when it actually uploaded (so the caller knows to re-push uniforms too).
  _ensureNearTerrainTextures(terrain) {
    if (!terrain.nearReady) return false;
    if (this._terrainNearVersion === terrain.near.version) return false;
    const packed = packNearTextures(terrain);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texNearH);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, packed.width, packed.height, 0, gl.RED, gl.FLOAT, packed.nearH);
    gl.bindTexture(gl.TEXTURE_2D, this.texNearType);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, packed.width, packed.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, packed.nearType);
    this._terrainNearVersion = terrain.near.version;
    return true;
  }

  // US-016 (14.4 items 3-5, GPU build order steps 2/3), extended by US-026a
  // S5 (23.4): the terrain constants that only change when the far/near bake
  // (re)runs, not per frame - `uFarMap`/`uTerrainMaxH`/near-band uniforms for
  // the pass A2 march (progTerrain), and the recipe bands + far-fog colours
  // + near-detail uniforms for the shade pass's kind==7 branch (progShade).
  _uploadTerrainUniforms(terrain, palette) {
    const gl = this.gl;
    // ARCH CHANGES item 5: read the real origin from `terrain._farGridDraw`
    // (`Terrain.js`, the same grid `castTerrain`'s `gridHeight` samples)
    // instead of hard-coding `x0/y0 = 0` - both are 0 for every current
    // recipe (`overworld_far`), but this keeps one source of truth instead
    // of a silently-stale assumption if a future recipe origin moves.
    const grid = terrain._farGridDraw;
    const farMap = [grid.x0, grid.y0, terrain.mapCell, terrain.mapW];
    const hb = terrainHBounds(terrain); // US-026a S5: combines near.maxH/minH when active - single source of truth (23.4).
    const nl = activeNearLOD(terrain); // US-026a S5: the march pass's OWN (strict) gate - terrain.nearReady && handover && step.
    gl.useProgram(this.progTerrain);
    gl.uniform4fv(this._locsTerrain.uFarMap, farMap);
    gl.uniform1f(this._locsTerrain.uTerrainMaxH, hb.maxH);
    gl.uniform1f(this._locsTerrain.uFarMinH, terrain.farMinH);
    gl.uniform1i(this._locsTerrain.uNearReady, nl ? 1 : 0);
    if (terrain.nearReady && terrain.near) {
      const ng = terrain.near;
      gl.uniform4f(this._locsTerrain.uNearMap, ng.x0, ng.y0, ng.cell, ng.w);
      gl.uniform1f(this._locsTerrain.uNearMinH, ng.minH);
    }
    if (nl) {
      gl.uniform2f(this._locsTerrain.uHandover, nl.handover[0], nl.handover[1]);
      gl.uniform2f(this._locsTerrain.uNearStep, nl.step.min, nl.step.k);
    }

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
      // BUG-GPU-005: the edge pass gates kind-7 cells on the same terrain fog.
      const locEd = this._locsEdge;
      gl.useProgram(this.progEdge);
      gl.uniform1f(locEd.uTerrainFogStart, fogRec.start);
      gl.uniform1f(locEd.uTerrainFogFull, fogRec.full);
      gl.uniform1f(locEd.uTerrainFogCurve, fogRec.curve || 1);
      gl.useProgram(this.progShade);
    }
    // US-026a S5 (23.4 near-detail): a DIFFERENT, more lenient gate than
    // `uNearReady` above - literal twin of terrainShade.js's
    // `makeTerrainShadeCtx` (`recipe.nearLOD.bands`/`.handover` alone, never
    // gated on `terrain.nearReady`/`.step` - see that file's own doc
    // comment on why the shading gate and the march gate differ).
    const nearLOD = recipe && recipe.nearLOD;
    const nearDetailOn = !!(nearLOD && nearLOD.bands && nearLOD.handover);
    gl.uniform1i(locS.uNearDetailOn, nearDetailOn ? 1 : 0);
    if (nearDetailOn) {
      gl.uniform2f(locS.uHandover, nearLOD.handover[0], nearLOD.handover[1]);
      gl.uniform1f(locS.uCloseBand, nearLOD.bands.close);
    }
  }

  // US-040 (15.2 item 2): re-uploads the VOX atlas only when `pool.atlas.
  // version` changed (bind()/re-bind, never per frame - 15.2 "do not"
  // list's "upload VOX per frame"). Full texImage2D (the atlas can grow
  // taller as models are added) rather than texSubImage2D.
  _ensureVoxelAtlas(pool) {
    if (!pool.atlas || pool.atlas.version === this._voxAtlasVersion) return;
    const gl = this.gl, atlas = pool.atlas;
    gl.bindTexture(gl.TEXTURE_2D, this.texVOX);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, atlas.w, atlas.h, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, atlas.vox);
    this._voxAtlasVersion = atlas.version;
  }

  // US-040 (15.2 item 3): packs this frame's projected instances' VOXINST
  // rows + uVoxRect (screen rect in cells, half-open) into the once-
  // allocated scratch arrays, then one texSubImage2D of `count*
  // VOXINST_ROWS_PER_INSTANCE` rows (<= 18 KB per 15.2 item 3's budget).
  _uploadVoxelInstances(pool) {
    const gl = this.gl;
    const count = pool.list.length;
    const rectF = this._voxRectF;
    for (let i = 0; i < count; i++) {
      writeInstanceRows(pool, i, this._voxInstF);
      const inst = pool.list[i];
      const o = i * 4;
      rectF[o] = inst.rect.minCol; rectF[o + 1] = inst.rect.minRow;
      rectF[o + 2] = inst.rect.maxCol + 1; rectF[o + 3] = inst.rect.maxRow + 1; // half-open
    }
    if (count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.texVOXINST);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VOXINST_WIDTH, count * VOXINST_ROWS_PER_INSTANCE, gl.RGBA, gl.FLOAT, this._voxInstF);
    }
    this.stats.voxelInstances = count;
  }

  // US-040 (15.2 item 4): pass A3 - reads whichever sub-sample set was
  // written last (`_subSetCur`, set by `_hook`) and writes the OTHER one;
  // `_hook` flips `_subSetCur` again right after calling this.
  _passVoxel() {
    const gl = this.gl, loc = this._locsVoxel, cb = this._camBasis;
    const pool = this._voxelPool;
    this._uploadVoxelInstances(pool);
    const readSet1 = this._subSetCur === 1;
    const outFbo = readSet1 ? this.fboTerrainSub : this.fboCastSub;
    const binds = readSet1 ? this._voxelBindsSet1In : this._voxelBindsSet2In;
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, this.subCols, this.subRows);
    gl.useProgram(this.progVoxel);
    gl.bindVertexArray(this.vao);
    this._bindTextures(binds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1i(loc.uN, this.rays);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.uniform1i(loc.uVoxCount, pool.list.length);
    gl.uniform4fv(loc.uVoxRect, this._voxRectF);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    // RE-02a: the pitched terms ride along (only when the cam asks for them); light/shade/edge
    // read them through `_uploadPitchUniforms`, the raster pass through `_pitchTerms.M`.
    this._pitched = resolveProjection(cam, this.renderer) === 'pitched';
    if (this._pitched) {
      const t = this._pitchTerms || (this._pitchTerms = createPitchedTerms());
      const g = this._meshGrid || (this._meshGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 });
      g.cols = this.cols; g.rows = this.rows; g.pxCellW = this.rt.pxCellW || 1; g.pxCellH = this.rt.pxCellH || 1;
      pitchedTerms(cam, g, t);
      const a = this._pitchA || (this._pitchA = new Float32Array(4));
      const b = this._pitchB || (this._pitchB = new Float32Array(4));
      const c = this._pitchC || (this._pitchC = new Float32Array(4));
      a[0] = t.fX; a[1] = t.fY; a[2] = t.fZ; a[3] = t.tanHalfX;
      b[0] = t.rX; b[1] = t.rY; b[2] = t.uX; b[3] = t.uY;
      c[0] = t.uZ; c[1] = t.tanHalfY; c[2] = t.cosP; c[3] = t.sinP;
      const tr = this._world && this._world.terrain;
      this._hashCell = -(2 * t.tanHalfX / this.cols); // BUG-FP-002: per-cell mode on every pitched frame
    } else {
      this._hashCell = 0;
    }
  }

  /** RE-02a: `uProjMode` + the pitched basis for a program (light/shade/edge). Program must be in use. */
  _uploadPitchUniforms(loc) {
    const gl = this.gl;
    const on = !!this._pitched && this._useDdaThisFrame;
    gl.uniform1i(loc.uProjMode, on ? 1 : 0);
    if (on) {
      gl.uniform4fv(loc.uPitchA, this._pitchA);
      gl.uniform4fv(loc.uPitchB, this._pitchB);
      gl.uniform4fv(loc.uPitchC, this._pitchC);
    }
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

  /**
   * ME-04 (docs/backlog.md, docs/architecture.md 27.2/27.4/27.11 ME-04 row):
   * the GPU raster pass - an alternative way to fill pass A's sub-sample
   * output (`fboRasterSub`, gridTargets.js: the SAME `texSGI`/`texSGA`/
   * `texSDepth` textures `fboCastSub` writes, plus this pass' own depth24
   * renderbuffer for the real triangle-vs-triangle z-test). Only called
   * when `this.renderer === 'mesh'`; `resolve`/`deriv`/`light`/`shade`/
   * `edge` read whichever set was written last exactly as they already do
   * for the DDA path (`_subSetCur`) - no changes there.
   *
   * Scope: `DRAW_STATIC` items (engine/mesh/levelMesh.js level meshes - the
   * tower, ME-04) and, since ME-06, `DRAW_TERRAIN` items (engine/mesh/
   * terrainMesh.js near/far/stitch chunks) - drawn by a second program/VAO
   * right after the level-mesh loop, into the SAME sub-sample targets (one
   * shared depth buffer, so a structure and the terrain under it never
   * seam). Voxel items (ME-08) are still skipped - their cells stay at the
   * "nothing drawn" sentinel this pass clears to, same as any kind-0 cell.
   */
  _prepRaster() {
    const cam = this._cam, world = this._world;

    // Camera basis: the ONE shear-camera matrix (engine/render/projection.js)
    // world -> clip - the same matrix rasterJS.js and the CPU caster agree
    // the DDA ray formula is the inverse of (27.5/27.15.3).
    const grid = this._meshGrid;
    grid.cols = this.cols; grid.rows = this.rows; grid.pxCellW = this.rt.pxCellW || 1; grid.pxCellH = this.rt.pxCellH || 1;
    if (this._pitched) {
      // RE-02a (28.1): rotated view matrix; `_computeCamBasis` already filled `_pitchTerms`.
      this._meshViewProj.set(this._pitchTerms.M);
    } else {
      projTerms(cam, grid, this._meshTerms);
      shearProjection(this._meshTerms, this._meshViewProj);
    }
    for (let i = 0; i < 16; i++) this._meshViewProjF32[i] = this._meshViewProj[i];
    frustumPlanes(this._meshViewProj, this._meshFrustumPlanes);

    const list = this._meshDrawList;
    list.begin();
    // 2000 m fog-far cull, matching the DDA/compositor path's own
    // MAX_STRUCTS/fog-cull convention (DrawList.js's addStructures) - not a
    // recipe constant read here on purpose (this story's scope is the
    // tower; a real fogFarM wiring is ME-06's terrain-parity concern).
    addStructures(list, world, cam, this._levelMeshCache, 2000);
    // ME-06 (27.15.5): one `TerrainMeshSet` per bound `Terrain` instance,
    // built lazily and advanced by at most 2 ms per RENDERED frame (never
    // inside a fixed step, never inside this draw loop itself) - the same
    // amortised band-flip rebuild the CPU near-band bake already uses.
    // `terrain.farReady`/`.near` gate exactly like the DDA terrain pass
    // (`_terrainActiveThisFrame`), so an unbaked terrain draws nothing
    // (matching the DDA path's own no-op until `farReady`).
    let terrainMeshSet = null;
    if (this.terrainEnabled && world && world.terrain) {
      terrainMeshSet = terrainMeshSetFor(world.terrain);
      terrainMeshSet.step(2);
      terrainMeshSet.addToDrawList(list, cam);
    }
    // ME-08a (27.16 item 5): voxel prop instances (already posed + screen-
    // culled by `VoxelPool.project` in `frame()`), after the terrain items
    // and before the frustum cull (a second, cheap cull).
    const voxelPool = this._voxelPool;
    if (voxelPool && voxelPool.list.length > 0) {
      addVoxelInstances(list, voxelPool, sharedVoxelMeshCache, voxelPool.partNamesFor);
    }
    // RE-06 (28.6): instanced unit groups, after the ME-08 voxel items, before the cull.
    // RE-15a fixes (28.13 point 4, PC-B Q7 item 1): per-instance cull + compaction, memoized on the
    // host-owned `this._fb.frameNo` (bumped once per actual rendered frame by the caller - main.js's
    // render tick / gpucompare's per-pose bump - not by this pipeline), so the GPU pass and the JS mesh
    // twin (`compositor.js`'s `renderWorldMesh`) share one counter instead of two independent ones.
    if (this._instances) {
      this._instances.addToDrawList(list, sharedVoxelMeshCache, this._meshFrustumPlanes, this._fb.frameNo, this._meshViewProj, this.rows);
      this.stats.instancesCulled = this._instances.stats.instancesCulled;
      this.stats.instancesLod1 = this._instances.stats.instancesLod1;
    }
    // CLOTH-1b2 (33.5): cloths after the voxel feed (the JS twin's order); `addCloths` refreshes each drawn cloth's arrays
    // (`updateClothMesh`) and stamps `markDrawn`; `MeshBuffers.getCloth` uploads afterwards, in the raster/shadow loops.
    if (world && world.cloths && world.cloths.count > 0) addCloths(list, world.cloths, this._meshFrustumPlanes, this._table ? this._table.idFor : undefined);
    list.cull(this._meshFrustumPlanes);
    this._rasterTerrainSet = terrainMeshSet;
    // US-078a: the view-model layer's own (never culled) list, null only when no model is bound (BUG-VM-001 fix:
    // draws under a pitched camera too, since that's the mesh renderer's own default first-person mode).
    this._vmList = this._viewModel ? this._viewModel.buildList(cam, this._pitched) : null;
    // US-055a2a (35.3): which water regions draw this frame (<= 8; none = the pass is skipped, nothing allocated).
    selectWater(world, cam, this._meshFrustumPlanes, this._waterSel);
    this._waterActive = (this._waterSel.count + this._waterSel.sheetCount) > 0 && !!this._water;
    this.stats.waterSlots = this._waterSel.count + this._waterSel.sheetCount;
    if (this._waterActive) { // US-055a2b: per-slot look rows + own fog (cheap f32 copies, no allocation)
      fillWaterSlotTable(this._waterSel, world, this._waterLooks, this._waterTable, this._fb.timeSec || 0);
      waterFogParams(this._table, this._palette, !!world.terrain, this._waterFog);
      for (let s = 0; s < WL_SLOTS; s++) { this._waterOS[s * 2] = this._waterTable[s * WL_STRIDE + 3]; this._waterOS[s * 2 + 1] = this._waterTable[s * WL_STRIDE + 7]; }
    }
    if (!this._waterActive) this.stats.waterDraws = 0;
  }

  _passRaster() {
    const gl = this.gl, loc = this._locsMesh;
    const world = this._world;
    const list = this._meshDrawList;
    const terrainMeshSet = this._rasterTerrainSet;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboRasterSub);
    gl.viewport(0, 0, this.subCols, this.subRows);
    // Sentinel clear (14.2 item 3's "kind 0 = nothing drawn"): GI/GA all
    // zero, DEPTH = 0x7f800000 (the +Inf bit pattern dda.frag.js's own
    // kind==0 branch writes) - shade.frag.js's `kindU == 0u` branch (sky)
    // reads exactly this on every cell the raster pass never touches.
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferuiv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferuiv(gl.COLOR, 2, [0x7f800000, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);

    gl.useProgram(this.progMesh);
    gl.bindVertexArray(this._meshVao);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE); // 27.15.2: "Phase 1 draws with cull none in both twins"
    gl.uniformMatrix4fv(loc.uViewProj, false, this._meshViewProjF32);

    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this._meshBuffers.get(item.mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
      for (const attr of STATIC_VERTEX_LAYOUT) {
        gl.enableVertexAttribArray(attr.location);
        if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, 64, attr.offsetBytes);
        else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, 64, attr.offsetBytes);
      }
      const m = item.matrix;
      const M = this._meshModelF32;
      M[0] = m[0]; M[1] = m[3]; M[2] = m[6]; M[3] = 0;
      M[4] = m[1]; M[5] = m[4]; M[6] = m[7]; M[7] = 0;
      M[8] = m[2]; M[9] = m[5]; M[10] = m[8]; M[11] = 0;
      M[12] = m[9]; M[13] = m[10]; M[14] = m[11]; M[15] = 1;
      gl.uniformMatrix4fv(loc.uModel, false, M);
      gl.uniform1i(loc.uPlaneIdOr, item.planeIdOr);
      gl.uniform1f(loc.uZBase, item.zBase);
      gl.uniform1i(loc.uObjectId, item.objectId);
      gl.uniform1i(loc.uAxisAligned, 0);
      gl.drawArrays(gl.TRIANGLES, item.rangeFirst * 3, item.rangeCount * 3);
    }

    // ME-08a (27.16 items 1/4): voxel props - one draw per (instance, part) (see `_drawVoxelItems`).
    const voxelDraws = this._drawVoxelItems(list, loc);
    const GL_IDX_U16 = gl.UNSIGNED_SHORT, GL_IDX_U32 = gl.UNSIGNED_INT;

    // RE-06 (28.6): DRAW_INSTANCED groups - raw gl here (the device `draw()` instances gap stays
    // with ME-19). One orphaned 128 KB VBO per frame, one bufferSubData per group, one
    // drawArraysInstanced per part. Same depth buffer / viewport as above.
    let instancedDraws = 0, instTotal = 0;
    {
      let any = false;
      for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_INSTANCED) { any = true; break; }
      if (any) {
        const locI = this._locsMeshInst;
        gl.useProgram(this.progMeshInst);
        gl.bindVertexArray(this._meshInstVao);
        gl.uniformMatrix4fv(locI.uViewProj, false, this._meshViewProjF32);
        gl.uniform1i(locI.uPlaneIdOr, 0);
        gl.uniform1f(locI.uZBase, 0);
        gl.uniform1i(locI.uObjectId, 0);
        const team = this._table && this._table.team;
        const ts = this._teamSlotI32, tm = this._teamMatI32;
        for (let k = 0; k < 4; k++) ts[k] = team ? team.slotIds[k] : 0;
        for (let k = 0; k < 32; k++) tm[k] = team ? team.mat[k] : 0;
        gl.uniform1iv(locI.uTeamSlot, ts);
        gl.uniform1iv(locI.uTeamMat, tm);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshInstVbo);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES_PER_FRAME * INSTANCE_BYTES, gl.DYNAMIC_DRAW); // orphan
        const M = this._meshModelF32;
        for (let i = 0; i < list.count; i++) {
          const item = list.items[i];
          if (item.type !== DRAW_INSTANCED || !item.mesh || !item.instBuf) continue;
          const n = item.instCount;
          if (instTotal + n > MAX_INSTANCES_PER_FRAME) throw new Error(`instanced units over ${MAX_INSTANCES_PER_FRAME} per frame`);
          const baseBytes = instTotal * INSTANCE_BYTES;
          gl.bindBuffer(gl.ARRAY_BUFFER, this._meshInstVbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, baseBytes, item.instBuf.f32, 0, n * 16);
          gl.vertexAttribPointer(6, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes);
          gl.vertexAttribPointer(7, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes + 16);
          gl.vertexAttribPointer(8, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes + 32);
          gl.vertexAttribIPointer(9, 2, gl.UNSIGNED_INT, INSTANCE_BYTES, baseBytes + 48);
          instTotal += n;
          const mesh = item.mesh;
          const entry = this._meshBuffers.getVoxel(mesh);
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
          for (let a = 0; a < VOXEL_VERTEX_LAYOUT.length; a++) {
            const attr = VOXEL_VERTEX_LAYOUT[a];
            if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, VOXEL_STRIDE_BYTES, attr.offsetBytes);
            else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, VOXEL_STRIDE_BYTES, attr.offsetBytes);
          }
          const idxEnum = entry.indexType === 'u16' ? GL_IDX_U16 : GL_IDX_U32;
          const idxBytes = entry.indexType === 'u16' ? 2 : 4;
          const ranges = mesh.ranges;
          const pm = item.partMatrices;
          for (let p = 0; p < ranges.length; p++) {
            const range = ranges[p];
            if (range.count <= 0) continue;
            const o = p * 12;
            M[0] = pm[o]; M[1] = pm[o + 3]; M[2] = pm[o + 6]; M[3] = 0;
            M[4] = pm[o + 1]; M[5] = pm[o + 4]; M[6] = pm[o + 7]; M[7] = 0;
            M[8] = pm[o + 2]; M[9] = pm[o + 5]; M[10] = pm[o + 8]; M[11] = 0;
            M[12] = pm[o + 9]; M[13] = pm[o + 10]; M[14] = pm[o + 11]; M[15] = 1;
            gl.uniformMatrix4fv(locI.uModel, false, M);
            gl.uniform1i(locI.uAxisAligned, item.partFlags[p] & 1);
            gl.drawElementsInstanced(gl.TRIANGLES, range.count * 3, idxEnum, range.start * 3 * idxBytes, n);
            instancedDraws++;
          }
        }
      }
    }
    gl.disable(gl.CULL_FACE); // RE-06c: never leave cull on past the voxel loops
    this.stats.voxelDraws = voxelDraws + instancedDraws;
    this.stats.instancedDraws = instancedDraws;
    this.stats.instances = instTotal;

    // CLOTH-1b2 (33.5): cloths - indexed 16 B dynamic vertices + static uv, smooth normal, two-sided (the fragment stage
    // flips N on back faces). frontFace is set explicitly (the winding the A2 sign rule of the JS twin assumes), cull none.
    this.stats.clothDraws = this._drawCloths(list, false);

    // ME-06: terrain items (near chunks, stitch, far tiles), same depth
    // buffer/viewport - a different program (terrain.vert.js's kind-7
    // variant), VAO (pos+nrm, no uv/flat/aux, 27.3) and index buffer per
    // item (indexed layout, unlike the unrolled static one above).
    if (terrainMeshSet && this.progMeshTerrain) {
      const locT = this._locsMeshTerrain;
      gl.useProgram(this.progMeshTerrain);
      gl.bindVertexArray(this._meshTerrainVao);
      this._bindTextures(this._meshTerrainBinds);
      gl.uniformMatrix4fv(locT.uViewProj, false, this._meshViewProjF32);
      // ME-06 (27.15.5's `typeAt`): "near nearest texel inside the band"
      // gates on `terrain.nearReady` alone (never the march pass' own
      // stricter `activeNearLOD`, which also requires a configured
      // handover/step - height sampling concerns this raster path's real
      // triangles have no part in). Uploaded once per frame here, not
      // cached per-program-version like `_uploadTerrainUniforms`: this
      // program only draws a handful of items per frame, the cost is noise.
      const terrain = world.terrain;
      gl.uniform1i(locT.uNearReady, terrain.nearReady ? 1 : 0);
      if (terrain.nearReady && terrain.near) {
        const ng = terrain.near;
        gl.uniform4f(locT.uNearMap, ng.x0, ng.y0, ng.cell, ng.w);
      }
      // Same source of truth `_uploadTerrainUniforms` reads for the march
      // pass' own `uFarMap` (ARCH CHANGES item 5: never a hard-coded 0,0).
      const fg = terrain._farGridDraw;
      gl.uniform4f(locT.uFarMap, fg.x0, fg.y0, terrain.mapCell, terrain.mapW);
      // Structure footprint carve (architect fix, ME-06): the DDA's
      // `buildSkips` rule - terrain is never drawn inside a placed
      // structure's 2D bbox. Same `world.structures[].bbox` the CPU caster
      // reads, capped at MAX_STRUCTS like every other structure uniform.
      const foot = this._meshStructFoot;
      const structCount = this._fillStructFoot(world);
      gl.uniform4fv(locT.uStructFoot, foot);
      gl.uniform1i(locT.uStructCount, structCount);
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_TERRAIN || !item.mesh || item.rangeCount <= 0) continue;
        const entry = this._meshBuffers.get(item.mesh);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
        for (const attr of TERRAIN_VERTEX_LAYOUT) {
          gl.enableVertexAttribArray(attr.location);
          if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, TERRAIN_STRIDE_BYTES, attr.offsetBytes);
          else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, TERRAIN_STRIDE_BYTES, attr.offsetBytes);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
        const m = item.matrix;
        const M = this._meshModelF32;
        M[0] = m[0]; M[1] = m[3]; M[2] = m[6]; M[3] = 0;
        M[4] = m[1]; M[5] = m[4]; M[6] = m[7]; M[7] = 0;
        M[8] = m[2]; M[9] = m[5]; M[10] = m[8]; M[11] = 0;
        M[12] = m[9]; M[13] = m[10]; M[14] = m[11]; M[15] = 1;
        gl.uniformMatrix4fv(locT.uModel, false, M);
        gl.uniform1i(locT.uObjectId, item.objectId);
        gl.drawElements(gl.TRIANGLES, item.rangeCount * 3, gl.UNSIGNED_INT, item.rangeFirst * 3 * 4);
      }
    }

    // US-078a (architecture.md 30.1): first-person view model - a depth-only clear, then the same voxel draw
    // loop over the layer's own list (G-buffer written like any prop; never clipped by walls).
    const vmList = this._vmList;
    if (vmList) {
      gl.useProgram(this.progMesh);
      gl.uniformMatrix4fv(loc.uViewProj, false, this._meshViewProjF32);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.stats.vmDraws = this._drawVoxelItems(vmList, loc);
      gl.disable(gl.CULL_FACE);
    } else {
      this.stats.vmDraws = 0;
    }
  }

  /**
   * CLOTH-1b2: draws every `DRAW_CLOTH` item of `list`: raster pass (`shadow` false: progMeshCloth, `_locsMeshCloth`) or sun
   * depth pass (`shadow` true: progShadowCloth, position only; `uViewProj` = `_sunMatF32`). Cull NONE, frontFace CCW set
   * explicitly. One `MeshBuffers.getCloth` per item (a `writeBuffer` only when the mesh version changed). Returns the draw count.
   * @param {import('../../mesh/DrawList.js').DrawList} list @param {boolean} shadow
   */
  _drawCloths(list, shadow) {
    let any = false;
    for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_CLOTH) { any = true; break; }
    if (!any) return 0;
    const gl = this.gl, loc = shadow ? this._locsShadowCloth : this._locsMeshCloth;
    gl.useProgram(shadow ? this.progShadowCloth : this.progMeshCloth);
    gl.bindVertexArray(this._meshClothVao);
    gl.frontFace(gl.CCW);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(loc.uViewProj, false, shadow ? this._sunMatF32 : this._meshViewProjF32);
    let draws = 0;
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_CLOTH || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this._meshBuffers.getCloth(item.mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
      const a0 = CLOTH_DYN_LAYOUT[0], a2 = CLOTH_DYN_LAYOUT[1];
      gl.vertexAttribPointer(a0.location, a0.components, gl.FLOAT, false, CLOTH_STRIDE_BYTES, a0.offsetBytes);
      // attribs 1/2 are set in the shadow pass too (the shared vertex shader declares them; an enabled-but-unbound attrib is a GL error)
      gl.vertexAttribIPointer(a2.location, a2.components, gl.UNSIGNED_INT, CLOTH_STRIDE_BYTES, a2.offsetBytes);
      const a1 = CLOTH_UV_LAYOUT[0];
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.uvBuffer.handle);
      gl.vertexAttribPointer(a1.location, a1.components, gl.FLOAT, false, 0, a1.offsetBytes);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
      this._setModel(loc.uModel, item.matrix, 0);
      if (!shadow) {
        gl.uniform1i(loc.uPlaneIdOr, item.planeIdOr);
        gl.uniform1f(loc.uZBase, item.zBase);
        gl.uniform1i(loc.uObjectId, item.objectId);
        gl.uniform2ui(loc.uFlat, 0, (KIND_MODEL | (FACE_PACKED << 8) | (item.mesh.matId << 16)) >>> 0);
      }
      gl.drawElements(gl.TRIANGLES, item.rangeCount * 3, gl.UNSIGNED_SHORT, item.rangeFirst * 3 * 2);
      draws++;
    }
    gl.disable(gl.CULL_FACE);
    return draws;
  }

  /**
   * ME-08a / US-078a: draws every `DRAW_VOXEL` item of `list` with the mesh program `loc` (already in use, `uViewProj`
   * set) - one draw per (item, part) over `mesh.ranges[p]`, `uModel` = that part's world matrix. Sets the voxel VAO and
   * back-face cull (RE-06c); leaves CULL_FACE enabled (the caller disables it). Returns the draw count.
   * @param {import('../../mesh/DrawList.js').DrawList} list
   * @param {any} loc
   */
  _drawVoxelItems(list, loc) {
    const gl = this.gl;
    let voxelDraws = 0;
    // RE-06b (28.7): voxel paths use 32 B verts + index buffer; aux (locations 4/5) = generic zero.
    const GL_IDX_U16 = gl.UNSIGNED_SHORT, GL_IDX_U32 = gl.UNSIGNED_INT;
    gl.vertexAttrib4f(4, 0, 0, 0, 0);
    gl.vertexAttrib4f(5, 0, 0, 0, 0);
    gl.bindVertexArray(this._meshVoxVao);
    // RE-06c (28.10): back-face cull for closed voxel meshes only (front = positive snapped area = CCW).
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.CULL_FACE);
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_VOXEL || !item.mesh) continue;
      const mesh = item.mesh;
      const entry = this._meshBuffers.getVoxel(mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
      for (let a = 0; a < VOXEL_VERTEX_LAYOUT.length; a++) {
        const attr = VOXEL_VERTEX_LAYOUT[a];
        if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, VOXEL_STRIDE_BYTES, attr.offsetBytes);
        else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, VOXEL_STRIDE_BYTES, attr.offsetBytes);
      }
      const idxEnum = entry.indexType === 'u16' ? GL_IDX_U16 : GL_IDX_U32;
      const idxBytes = entry.indexType === 'u16' ? 2 : 4;
      gl.uniform1i(loc.uPlaneIdOr, item.planeIdOr);
      gl.uniform1f(loc.uZBase, item.zBase);
      gl.uniform1i(loc.uObjectId, item.objectId);
      const ranges = mesh.ranges;
      const M = this._meshModelF32;
      const pm = item.partMatrices;
      for (let p = 0; p < ranges.length; p++) {
        const range = ranges[p];
        if (range.count <= 0) continue;
        const o = p * 12;
        M[0] = pm[o]; M[1] = pm[o + 3]; M[2] = pm[o + 6]; M[3] = 0;
        M[4] = pm[o + 1]; M[5] = pm[o + 4]; M[6] = pm[o + 7]; M[7] = 0;
        M[8] = pm[o + 2]; M[9] = pm[o + 5]; M[10] = pm[o + 8]; M[11] = 0;
        M[12] = pm[o + 9]; M[13] = pm[o + 10]; M[14] = pm[o + 11]; M[15] = 1;
        gl.uniformMatrix4fv(loc.uModel, false, M);
        gl.uniform1i(loc.uAxisAligned, item.partFlags[p] & 1);
        gl.drawElements(gl.TRIANGLES, range.count * 3, idxEnum, range.start * 3 * idxBytes);
        voxelDraws++;
      }
    }
    return voxelDraws;
  }

  /** Structure footprints (x0, y0, x1, y1 per placed structure, capped at MAX_STRUCTS) into `_meshStructFoot`; returns the count (raster + shadow terrain carve). */
  _fillStructFoot(world) {
    const structs = world.structures || [];
    const foot = this._meshStructFoot;
    let structCount = 0;
    for (let i = 0; i < structs.length && structCount < MAX_STRUCTS; i++) {
      if (structs[i].kind === 'mesh') continue; // ME-14c1
      const b = structs[i].bbox;
      if (!b) continue;
      const o4 = structCount * 4;
      foot[o4] = b.x0; foot[o4 + 1] = b.y0; foot[o4 + 2] = b.x1; foot[o4 + 3] = b.y1;
      structCount++;
    }
    this._structCount = structCount;
    return structCount;
  }

  /** `m` = DrawItem 3x4 (row-major rotation+translation) at offset `o` -> the shared column-major mat4 scratch -> uniform `loc`. */
  _setModel(loc, m, o) {
    const M = this._meshModelF32;
    M[0] = m[o]; M[1] = m[o + 3]; M[2] = m[o + 6]; M[3] = 0;
    M[4] = m[o + 1]; M[5] = m[o + 4]; M[6] = m[o + 7]; M[7] = 0;
    M[8] = m[o + 2]; M[9] = m[o + 5]; M[10] = m[o + 8]; M[11] = 0;
    M[12] = m[o + 9]; M[13] = m[o + 10]; M[14] = m[o + 11]; M[15] = 1;
    this.gl.uniformMatrix4fv(loc, false, M);
  }

  /**
   * ME-15b (docs/architecture.md 27.9, 27.9a): the sun shadow pass. Orthographic depth of the shadow
   * caster list (`buildShadowList`: culled with the sun frustum, not the camera's) from the snapped sun
   * matrix into the 2048^2 depth24 map; same vertex shaders as the raster pass with `uViewProj = M_sun`,
   * empty fragment stage, polygon offset from `shadows.depthBias`. Skipped (map untouched, `shadowActive`
   * false) when there is no sun. The light pass does NOT read the map yet (ME-15c): the image is unchanged.
   * Sprites / kind 0 are not casters. Zero allocation per frame.
   */
  _passShadow() {
    const so = this.shadowOpts, light = this._light, cam = this._cam, world = this._world;
    const sun = light && light.sun;
    if (!sun || !sun.on || !cam || !world) return;
    const gl = this.gl, list = this._shadowList, src = this._shadowSrc;
    const tCpu0 = performance.now();
    sunShadowCentre(cam, so, this._shadowCentre);
    const c = src.centre;
    c.x = this._shadowCentre[0]; c.y = this._shadowCentre[1]; c.z = this._shadowCentre[2];
    src.cache = this._levelMeshCache;
    src.terrainSet = this._rasterTerrainSet;
    // ME-15c (27.9a amendment, caster gaps a/b): props posed WITHOUT the screen cull (casters behind the player),
    // RE-06 instanced groups with their full instance buffer, structure cull at the real fog distance.
    const vp = this._voxelPool;
    if (vp && vp.shadowView) { vp.projectShadow(); src.voxelPool = vp.shadowView; } else src.voxelPool = null;
    src.instances = this._instances || null;
    src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null; // CLOTH-1b2
    src.matIdFor = this._table ? this._table.idFor : undefined;
    src.fogFarM = sunShadowFogFar(this._palette, so);
    shadowWorldZ(world, this._levelMeshCache, this._shadowWorldZ);
    const sm = shadowSunMatrix(sun.dir, this._shadowCentre, so, this._shadowWorldZ, this._sunMat);
    const Mf = this._sunMatF32;
    for (let i = 0; i < 16; i++) Mf[i] = sm.M[i];
    buildShadowList(list, this._meshDrawList, world, sm.planes, src);

    // ME-15d dirty-skip (27.9a item 12): the depth map is a pure function of (M, structVersion, caster list); equal
    // hash = the texture still holds the right depth, so skip the whole GL pass (the CPU build above stays, ~0.1 ms).
    const key = shadowInputHash(list, sm.M, world.structVersion | 0, this._shadowKey);
    this.stats.shadowCpuMs = performance.now() - tCpu0; // ME-15d: matrix + list + key (27.9a item 12: <= 0.15 ms p95)
    const prev = this._shadowKeyPrev;
    if (so.dirtySkip && this._shadowKeyValid && key[0] === prev[0] && key[1] === prev[1]) {
      this.shadowActive = true; this.shadowSkips++;
      this.stats.shadowItems = list.count; this.stats.shadowDraws = 0;
      return;
    }
    prev[0] = key[0]; prev[1] = key[1]; this._shadowKeyValid = true; this.shadowRenders++;

    this._meshDevice.beginPass(this._shadowTarget, { clear: true }); // binds the FBO, sets the viewport, clears depth to 1
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(so.depthBias[0], so.depthBias[1]);
    let draws = 0;

    // DRAW_STATIC level quads (cull none, as the raster pass).
    const loc = this._locsShadow;
    gl.useProgram(this.progShadow);
    gl.bindVertexArray(this._meshVao);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(loc.uViewProj, false, Mf);
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this._meshBuffers.get(item.mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
      for (const attr of STATIC_VERTEX_LAYOUT) {
        gl.enableVertexAttribArray(attr.location);
        if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, 64, attr.offsetBytes);
        else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, 64, attr.offsetBytes);
      }
      this._setModel(loc.uModel, item.matrix, 0);
      gl.drawArrays(gl.TRIANGLES, item.rangeFirst * 3, item.rangeCount * 3);
      draws++;
    }

    // Voxel props: one draw per part, closed meshes back-face culled (RE-06c) - same state as the raster pass.
    gl.vertexAttrib4f(4, 0, 0, 0, 0);
    gl.vertexAttrib4f(5, 0, 0, 0, 0);
    gl.bindVertexArray(this._meshVoxVao);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.CULL_FACE);
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_VOXEL || !item.mesh) continue;
      const mesh = item.mesh;
      const entry = this._meshBuffers.getVoxel(mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
      for (let a = 0; a < VOXEL_VERTEX_LAYOUT.length; a++) {
        const attr = VOXEL_VERTEX_LAYOUT[a];
        if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, VOXEL_STRIDE_BYTES, attr.offsetBytes);
        else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, VOXEL_STRIDE_BYTES, attr.offsetBytes);
      }
      const idxEnum = entry.indexType === 'u16' ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
      const idxBytes = entry.indexType === 'u16' ? 2 : 4;
      const ranges = mesh.ranges, pm = item.partMatrices;
      for (let p = 0; p < ranges.length; p++) {
        const range = ranges[p];
        if (range.count <= 0) continue;
        this._setModel(loc.uModel, pm, p * 12);
        gl.drawElements(gl.TRIANGLES, range.count * 3, idxEnum, range.start * 3 * idxBytes);
        draws++;
      }
    }

    // RE-06 instanced casters (ME-15c): same instanced vertex shader + draw as the raster pass, depth only.
    {
      let any = false;
      for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_INSTANCED) { any = true; break; }
      if (any) {
        const locI = this._locsShadowInst;
        gl.useProgram(this.progShadowInst);
        gl.bindVertexArray(this._meshInstVao);
        gl.uniformMatrix4fv(locI.uViewProj, false, Mf);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._meshInstVbo);
        gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES_PER_FRAME * INSTANCE_BYTES, gl.DYNAMIC_DRAW); // orphan
        const GL_IDX_U16 = gl.UNSIGNED_SHORT, GL_IDX_U32 = gl.UNSIGNED_INT;
        const M = this._meshModelF32;
        let instTotal = 0;
        for (let i = 0; i < list.count; i++) {
          const item = list.items[i];
          if (item.type !== DRAW_INSTANCED || !item.mesh || !item.instBuf) continue;
          const n = item.instCount;
          if (instTotal + n > MAX_INSTANCES_PER_FRAME) break; // shadow-only overflow: drop the rest (never throw for a shadow)
          const baseBytes = instTotal * INSTANCE_BYTES;
          gl.bindBuffer(gl.ARRAY_BUFFER, this._meshInstVbo);
          gl.bufferSubData(gl.ARRAY_BUFFER, baseBytes, item.instBuf.f32, 0, n * 16);
          gl.vertexAttribPointer(6, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes);
          gl.vertexAttribPointer(7, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes + 16);
          gl.vertexAttribPointer(8, 4, gl.FLOAT, false, INSTANCE_BYTES, baseBytes + 32);
          gl.vertexAttribIPointer(9, 2, gl.UNSIGNED_INT, INSTANCE_BYTES, baseBytes + 48);
          instTotal += n;
          const mesh = item.mesh;
          const entry = this._meshBuffers.getVoxel(mesh);
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
          for (let a = 0; a < VOXEL_VERTEX_LAYOUT.length; a++) {
            const attr = VOXEL_VERTEX_LAYOUT[a];
            if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, VOXEL_STRIDE_BYTES, attr.offsetBytes);
            else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, VOXEL_STRIDE_BYTES, attr.offsetBytes);
          }
          const idxEnum = entry.indexType === 'u16' ? GL_IDX_U16 : GL_IDX_U32;
          const idxBytes = entry.indexType === 'u16' ? 2 : 4;
          const ranges = mesh.ranges, pm = item.partMatrices;
          for (let p = 0; p < ranges.length; p++) {
            const range = ranges[p];
            if (range.count <= 0) continue;
            const o = p * 12;
            M[0] = pm[o]; M[1] = pm[o + 3]; M[2] = pm[o + 6]; M[3] = 0;
            M[4] = pm[o + 1]; M[5] = pm[o + 4]; M[6] = pm[o + 7]; M[7] = 0;
            M[8] = pm[o + 2]; M[9] = pm[o + 5]; M[10] = pm[o + 8]; M[11] = 0;
            M[12] = pm[o + 9]; M[13] = pm[o + 10]; M[14] = pm[o + 11]; M[15] = 1;
            gl.uniformMatrix4fv(locI.uModel, false, M);
            gl.drawElementsInstanced(gl.TRIANGLES, range.count * 3, idxEnum, range.start * 3 * idxBytes, n);
            draws++;
          }
        }
      }
    }
    gl.disable(gl.CULL_FACE);

    // CLOTH-1b2: cloth casters, depth only, cull none (two-sided), same polygon offset.
    draws += this._drawCloths(list, true);

    // Terrain chunks/tiles: indexed layout, footprint carve in the fragment stage.
    let anyTerrain = false;
    for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_TERRAIN) { anyTerrain = true; break; }
    if (anyTerrain) {
      const locT = this._locsShadowTerrain;
      gl.useProgram(this.progShadowTerrain);
      gl.bindVertexArray(this._meshTerrainVao);
      gl.uniformMatrix4fv(locT.uViewProj, false, Mf);
      const structCount = this._fillStructFoot(world);
      gl.uniform4fv(locT.uStructFoot, this._meshStructFoot);
      gl.uniform1i(locT.uStructCount, structCount);
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_TERRAIN || !item.mesh || item.rangeCount <= 0) continue;
        const entry = this._meshBuffers.get(item.mesh);
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.vertexBuffer.handle);
        for (const attr of TERRAIN_VERTEX_LAYOUT) {
          gl.enableVertexAttribArray(attr.location);
          if (attr.type === 'uint') gl.vertexAttribIPointer(attr.location, attr.components, gl.UNSIGNED_INT, TERRAIN_STRIDE_BYTES, attr.offsetBytes);
          else gl.vertexAttribPointer(attr.location, attr.components, gl.FLOAT, false, TERRAIN_STRIDE_BYTES, attr.offsetBytes);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indexBuffer.handle);
        this._setModel(locT.uModel, item.matrix, 0);
        gl.drawElements(gl.TRIANGLES, item.rangeCount * 3, gl.UNSIGNED_INT, item.rangeFirst * 3 * 4);
        draws++;
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this._meshDevice.endPass();
    this.shadowActive = true;
    this.stats.shadowItems = list.count;
    this.stats.shadowDraws = draws;
  }

  /**
   * TEST-ONLY (gpucompare depth parity, 27.9a item 10): copies the shadow map's depth bits into an R32UI
   * texture (depth24 cannot be `readPixels`'d) through the GpuDevice and reads them back into `out`
   * (`Uint32Array`, res*res; each value = the float32 bits of depth01 in [0,1]). Returns false when the
   * map was not rendered this frame. Allocates the copy resources on first use (never on the frame path).
   * @param {Uint32Array} out
   */
  readbackShadowDepthBits(out) {
    if (!this.shadowActive || !this._shadowDepthTex) return false;
    const dev = this._meshDevice, res = this.shadowOpts.res;
    if (!this._copyPipeline) {
      this._copyTex = dev.createTexture({ format: 'r32ui', width: res, height: res });
      this._copyTarget = dev.createTarget({ color: [this._copyTex] });
      this._copyPipeline = dev.createPipeline({
        vertex: { src: { glsl: SHADOW_COPY_VERT_SRC } },
        fragment: { src: { glsl: SHADOW_DEPTH_COPY_FRAG_SRC }, targets: 1 },
        depth: { test: false, write: false }, cull: 'none',
      });
    }
    dev.beginPass(this._copyTarget, { clear: true });
    dev.bind(this._copyPipeline, { textures: [{ slot: 0, texture: this._shadowDepthTex }] }); // sampler uShadowDepth defaults to unit 0
    dev.draw(3, 0, 1);
    dev.endPass();
    dev.readback(this._copyTex, { x: 0, y: 0, w: res, h: res }, out);
    return true;
  }

  // US-016 (14.4 items 2/4, GPU build order step 2): pass A2 - the same
  // sub-sample resolution/camera basis as `_passCast`, reading set 1
  // (fboCastSub's own output) and writing set 2 (fboTerrainSub). US-026a S5
  // (23.4 "Lighting"): the sun no longer uploads here (this pass only
  // writes the packed normal now) - `uTerrainMaxH`/near uniforms are
  // version-gated statics, uploaded by `_uploadTerrainUniforms` instead of
  // every frame.
  /**
   * US-055a2a (35.3): the water layer. One clipmap draw per selected region (indexed, only the ring runs its AABB needs,
   * <= 3 draws) into the cell-resolution WATER target (RGBA32UI + its own depth24), cleared every frame to x = +Inf.
   * Vertices never upload per frame; the origin O and the region are folded into one f32 matrix + a few uniforms
   * (f64 on the CPU). The occluder reads the resolved scene DEPTH (`texDepth`). Nothing reads WATER yet (US-055a2b).
   */
  _passWater() {
    const gl = this.gl, loc = this._locsWater, sel = this._waterSel, layer = this._water;
    layer.resize(this.cols, this.rows);
    const clip = layer.clipmap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.target.handle);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.depthMask(true);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearBufferuiv(gl.COLOR, 0, this._waterClearU);
    gl.clearBufferfv(gl.DEPTH, 0, this._waterClearD);
    gl.useProgram(this.progWater);
    gl.bindVertexArray(this._waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, clip.vertexBuffer.handle);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, clip.indexBuffer.handle);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE); // both faces (the view from below is 144a); `back` comes from gl_FrontFacing
    gl.frontFace(gl.CCW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.uniform1i(loc.uSceneDepth, 0);
    const M = this._meshViewProj, F = this._waterMvp, ox = sel.O[0], oy = sel.O[1], u = sel.u;
    for (let k = 0; k < 12; k++) F[k] = M[k];
    for (let k = 0; k < 4; k++) F[12 + k] = M[k] * ox + M[4 + k] * oy + M[12 + k]; // viewProj * T(O, 0), f64 -> f32
    gl.uniformMatrix4fv(loc.uMVP, false, F);
    let draws = 0;
    for (let s = 0; s < sel.count; s++) {
      const b = s * WATER_U_STRIDE, ro = s * RUNS_STRIDE;
      gl.uniform4f(loc.uAabb, u[b + U_AABB], u[b + U_AABB + 1], u[b + U_AABB + 2], u[b + U_AABB + 3]);
      gl.uniform1f(loc.uZ, u[b + U_Z]);
      gl.uniform1i(loc.uKind, u[b + U_KIND]);
      gl.uniform4f(loc.uShape, u[b + U_SHAPE], u[b + U_SHAPE + 1], u[b + U_SHAPE + 2], u[b + U_SHAPE + 3]);
      gl.uniform1ui(loc.uSlot, u[b + U_SLOT]);
      for (let r = 0; r < sel.runs[ro]; r++) {
        gl.drawElements(gl.TRIANGLES, sel.runs[ro + 2 + r * 2], gl.UNSIGNED_SHORT, sel.runs[ro + 1 + r * 2] * 2);
        draws++;
      }
    }
    for (let k = 0; k < sel.sheetCount; k++) {
      const slot = 8 + k, fall = sel.sheets[slot], buffers = layer.sheet(fall.mesh), b = slot * WATER_U_STRIDE;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertexBuffer.handle);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer.handle);
      gl.uniform1i(loc.uKind, 2);
      gl.uniform4f(loc.uShape, u[b + U_SHAPE], u[b + U_SHAPE + 1], 0, 0);
      gl.uniform1ui(loc.uSlot, slot);
      gl.drawElements(gl.TRIANGLES, fall.mesh.index.length, gl.UNSIGNED_SHORT, 0);
      draws++;
    }
    this.stats.waterDraws = draws;
    gl.disable(gl.DEPTH_TEST);
  }

  /**
   * US-055a2b: binds the designer water look table (`assets.waterLooks`, `{name: look}`), resolved to numbers once. Absent -> the
   * engine default look for every region. Throws naming a bad look.
   */
  setWaterLooks(table) { this._waterLooks = resolveWaterLooks(table); }

  /**
   * US-055a2b (32.2 / 35.3): composites the WATER layer onto the shade output (fullscreen, MRT fg/bg). Cells without water are copied.
   * Its output (the layer's compFg/compBg) is what the edge pass reads this frame. Twin: engine/render/waterComposite.js.
   */
  _passWaterComposite() {
    const gl = this.gl, loc = this._locsWaterComp, layer = this._water, cb = this._camBasis || this._ensureCamBasis();
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.compTarget.handle);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progWaterComp);
    gl.bindVertexArray(this.vao);
    const binds = this._waterCompBinds;
    binds[5][1] = layer.texture.handle;
    this._bindTextures(binds);
    gl.uniform2i(loc.uGrid, this.cols, this.rows);
    gl.uniform1f(loc.uTimeSec, this._fb.timeSec || 0);
    gl.uniform1i(loc.uSunMapOn, this.shadowActive && this._light && this._light.sun && this._light.sun.on ? 1 : 0);
    const sun = sunFromWorld(this._world, this._palette, this._waterSun);
    gl.uniform3f(loc.uSunDir, sun.dirX, sun.dirY, sun.dirZ);
    gl.uniform1f(loc.uAmbientI, sun.ambientI);
    gl.uniform1f(loc.uSunI, sun.sunI);
    gl.uniform1f(loc.uPosX, cb.posX); gl.uniform1f(loc.uPosY, cb.posY); gl.uniform1f(loc.uEyeH, cb.eyeH);
    gl.uniform1f(loc.uDirX, cb.dirX); gl.uniform1f(loc.uDirY, cb.dirY);
    gl.uniform1f(loc.uPlaneX, cb.planeX); gl.uniform1f(loc.uPlaneY, cb.planeY);
    gl.uniform1f(loc.uHorizonRow, cb.horizonRow); gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    gl.uniform4fv(loc.uWL, this._waterTable);
    gl.uniform4fv(loc.uWFog, this._waterFog);
    this._uploadPitchUniforms(loc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** US-055a2a: test-only readback of the WATER target (RGBA32UI, cols x rows x 4 words), null when no water drew. */
  readbackWater() {
    const gl = this.gl, layer = this._water;
    if (!layer || !layer.target || !this._waterActive) return null;
    const n = this.cols * this.rows;
    this._readbackWater = this._readbackWater && this._readbackWater.length === 4 * n ? this._readbackWater : new Uint32Array(4 * n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.target.handle);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this._readbackWater);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this._readbackWater;
  }

  _passTerrain() {
    const gl = this.gl, loc = this._locsTerrain, cb = this._camBasis;
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // US-030b (14.2 item 3, pass B): votes the sub-sample G-buffer down to the
  // per-cell GI/GA/Depth (fboCast, unchanged target - deriv/shade/edge never
  // know the sub-grid existed). US-016/US-040 (14.4 item 2, 15.2 item 4):
  // reads whichever set A1/A2/A3 wrote last (`_subSetCur`, tracked by
  // `_hook` as each optional pass flips it) - a bind-time choice between two
  // prebuilt tables, no uniform.
  _passResolve() {
    const gl = this.gl, loc = this._locsResolve;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboCast);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.progResolve);
    gl.bindVertexArray(this.vao);
    this._bindTextures(this._subSetCur === 2 ? this._resolveBindsSet2 : this._resolveBindsSet1);
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
    this._uploadPitchUniforms(loc);
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
      gl.uniform1i(loc.uSunMode, 0);
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
    // ME-15c: sun mode 2 (shadow map: the sun DDA is skipped) only when this frame's shadow pass actually ran.
    const mapOn = this.shadowActive && !!sun && sun.on;
    gl.uniform1i(loc.uSunMode, mapOn ? 2 : (sun && sun.on ? 1 : 0));
    if (mapOn) {
      const so = this.shadowOpts;
      gl.uniformMatrix4fv(loc.uSunShadowM, false, this._sunMatF32);
      gl.uniform1f(loc.uSunShadowRes, so.res);
      gl.uniform1f(loc.uSunShadowTexelM, this._sunMat.texelM);
      gl.uniform1f(loc.uSunShadowBiasM, so.biasM);
      gl.uniform1f(loc.uSunShadowNormalOff, so.normalOffsetTexels);
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
    // ME-06 (27.1 item 5): the CPU oracle (terrainCaster.js's `castTerrain`)
    // still packs a kind-7 cell's normal into `gbuf.aoD`'s bit pattern (its
    // own `getAoAlias` trick) - this legacy path transfers those bits into
    // GI.z so shade.frag.js's single (now GI.z-only) read site still gets a
    // real normal for a terrain pose run through `?gpucompare=shade`'s
    // 'upload' source, not just the GPU DDA/mesh paths.
    const aoAlias = new Uint32Array(aoDArr.buffer, aoDArr.byteOffset, aoDArr.length);

    for (let i = 0; i < n; i++) {
      GI[i * 4] = planeId[i] >>> 0;
      GI[i * 4 + 1] = (kind[i] & 0xff) | ((face[i] & 0xf) << 8) | ((mask[i] & 0xf) << 12) | ((mat[i] & 0xffff) << 16);
      GI[i * 4 + 2] = kind[i] === KIND_TERRAIN ? aoAlias[i] : 0;
      GI[i * 4 + 3] = 0; // objectId - unread by this legacy path
      const gi4 = i * 4;
      GAf[gi4] = uArr[i]; GAf[gi4 + 1] = vArr[i]; GAf[gi4 + 2] = zArr[i];
      GAf[gi4 + 3] = kind[i] === KIND_TERRAIN ? 1.0e30 : aoDArr[i];
      GDf[gi4] = dudx[i]; GDf[gi4 + 1] = dvdx[i]; GDf[gi4 + 2] = dudy[i]; GDf[gi4 + 3] = dvdy[i];
      DepthF[i] = depth[i];
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texGI);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, GI);
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
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, GI);
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

    // BUG-GPU-SHADE-001 fix: pick the bind table matching whichever
    // sub-sample set is actually current this frame (same rule
    // `_passResolve` uses) - see `_buildAllBindTables`'s comment.
    this._bindTextures(this._subSetCur === 2 ? this._shadeBindsSet2 : this._shadeBindsSet1);

    // US-006: light is now `uLightTex` (bound in `_shadeBindsSet1`/`Set2`, filled by
    // `_passLight` right before this call) - no `uLight` uniform any more.
    gl.uniform1f(loc.uTimeSec, this._fb.timeSec || 0);
    gl.uniform1i(loc.uSunMapOn, this.shadowActive && this._light && this._light.sun && this._light.sun.on ? 1 : 0); // ME-15c: terrain sun term *= n/4
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
    this._uploadPitchUniforms(loc); // RE-02a
    if (loc.uHashCell) gl.uniform1f(loc.uHashCell, this._pitched && this._useDdaThisFrame ? (this._hashCell || 0) : 0); // BUG-RTS-001 (28.11a): per frame (not version-gated)
    if (useDda) {
      const cb = this._camBasis;
      gl.uniform1f(loc.uHorizonRow, cb.horizonRow);
      gl.uniform1f(loc.uPlaneDistY, cb.planeDistY);
    }

    // US-026a S5 (23.4 "Lighting"): the sun, moved here from the (now
    // normal-only) march pass - `sunFromWorld` (terrainCaster.js) is the
    // single source of truth the JS oracle uses too. Cheap (a few trig
    // calls); recomputed every frame since nothing here tracks a "did
    // timeOfDay change" version. Only meaningful while the bound world has
    // terrain (kind==7 cells exist only then) - harmless zeros otherwise.
    if (this._world && this._world.terrain) {
      const sun = sunFromWorld(this._world, this._palette, this._sunScratch);
      gl.uniform3f(loc.uSunDir, sun.dirX, sun.dirY, sun.dirZ);
      gl.uniform1f(loc.uAmbientI, sun.ambientI);
      gl.uniform1f(loc.uSunI, sun.sunI);
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

    // US-055a2b: with a water layer the edge input is the composite output; WATER feeds the opaque-water outline suppression
    const wl = !debug && this._waterActive ? this._water : null;
    if (!debug) {
      binds[1][1] = wl ? wl.compFg.handle : this.texShadeFg;
      binds[3][1] = wl ? wl.compBg.handle : this.texShadeBg;
      binds[4][1] = wl ? wl.texture.handle : null;
    }
    this._bindTextures(binds);
    if (!debug) {
      gl.uniform1i(this._locsEdge.uWaterOn, wl ? 1 : 0);
      if (wl) gl.uniform2fv(this._locsEdge.uWOS, this._waterOS);
      this._uploadPitchUniforms(this._locsEdge); // RE-02a: fog distance scale
    }
    // uGrid/uFogMax/uEdgeGlyph/uEdgeGain/uFogStart/uFogFull (edge) and
    // uMode (debug) are all static once set - `_bindStaticUniforms()` /
    // `setDebugMode()`, not here (architect review 1 items 3/4a).

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

const SHADE_UNIFORMS = [
  'uGI', 'uGA', 'uGD', 'uDepth', 'uSGI', 'uSGA', 'uN', 'uFgTex', 'uBgTex', 'uMatF', 'uMatI', 'uSetI', 'uSetF', 'uGain',
  'uLightTex', 'uSunMapOn', 'uTimeSec', 'uCellAspect', 'uCutoff', 'uLift', 'uFgMin', 'uFgMaxGain', 'uTintK',
  'uOverbright', 'uOverbrightMax', 'uAoR', 'uAoK', 'uFaceK', 'uFogFg', 'uFogBg', 'uFogStart', 'uFogFull',
  'uFogStipple0', 'uFogStipple1', 'uFogSparse', 'uFogSparseCodes', 'uFogHazeCodes', 'uFogSparseAlt', 'uFogHazeAlt',
  // US-030a: GPU sky (14.2 item 3).
  'uSky', 'uSkyElevTop', 'uGpuSky', 'uHorizonRow', 'uPlaneDistY',
  'uProjMode', 'uPitchA', 'uPitchB', 'uPitchC', // RE-02a (28.1 A2): pitched sky + fog scale
  // US-016 (14.4 item 5): terrain (kind==7) branch.
  'uTlook', 'uBandNear', 'uBandMid',
  'uTerrainFogStart', 'uTerrainFogFull', 'uTerrainFogCurve', 'uTerrainFogNearRGB', 'uTerrainFogFarRGB',
  // US-026a S5 (23.4): the sun (moved out of the march pass - `aoD` now
  // carries the packed normal, decoded and lit here) + near-detail (close
  // band/jitter/2 m-vs-8 m hash-cell switch, gated by uNearDetailOn).
  'uSunDir', 'uAmbientI', 'uSunI', 'uNearDetailOn', 'uHandover', 'uCloseBand', 'uHashCell',
];
const EDGE_UNIFORMS = ['uGI', 'uDepth', 'uShadeFg', 'uShadeBg', 'uGrid', 'uFogMax', 'uEdgeGlyph', 'uEdgeGain', 'uModelRim', 'uFogStart', 'uFogFull', 'uTerrainFogStart', 'uTerrainFogFull', 'uTerrainFogCurve', 'uProjMode', 'uPitchA', 'uPitchB', 'uPitchC', 'uWater', 'uWaterOn', 'uWOS'];
const DEBUG_UNIFORMS = ['uGI', 'uShadeFg', 'uMode'];
// US-030a/US-030b: cast (DDA, sub-sample) / resolve (vote) / deriv pass uniforms.
const CAST_UNIFORMS = [
  'uWorldGeom', 'uWorldMats', 'uWorldFlags', 'uStructA', 'uStructB', 'uStructCount',
  'uGrid', 'uN', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY', 'uHorizonRow', 'uPlaneDistY',
];
const RESOLVE_UNIFORMS = ['uSGI', 'uSGA', 'uSDepth', 'uMask', 'uN'];
const WATER_COMP_UNIFORMS = [
  'uShadeFg', 'uShadeBg', 'uGI', 'uDepth', 'uWater', 'uLightTex', 'uGrid', 'uTimeSec', 'uSunMapOn', 'uSunDir', 'uAmbientI', 'uSunI',
  'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY', 'uHorizonRow', 'uPlaneDistY', 'uWL', 'uWFog',
  'uProjMode', 'uPitchA', 'uPitchB', 'uPitchC',
];
const WATER_UNIFORMS = ['uMVP', 'uAabb', 'uZ', 'uKind', 'uShape', 'uSlot', 'uSceneDepth'];
const MESH_UNIFORMS = ['uModel', 'uViewProj', 'uPlaneIdOr', 'uZBase', 'uObjectId', 'uAxisAligned'];
// RE-06: the instanced variant adds the team remap arrays (element 0 location for uniform1iv).
const MESH_INST_UNIFORMS = [...MESH_UNIFORMS, 'uTeamSlot', 'uTeamMat'];
// CLOTH-1b2: the cloth variant: flat data in `uFlat` (no aFlat/aux attributes), no uAxisAligned (always 0).
const MESH_CLOTH_UNIFORMS = ['uModel', 'uViewProj', 'uPlaneIdOr', 'uZBase', 'uObjectId', 'uFlat'];
// ME-06: terrain's own raster program (terrain.vert.js) - no planeIdOr/
// zBase (terrain items always carry 0/0, 27.15.5), but its own objectId
// uniform (no per-vertex flat data to derive it from, unlike mesh.frag.js's
// structSeq trick) and the near/far type-lookup textures.
const TERRAIN_MESH_UNIFORMS = [
  'uModel', 'uViewProj', 'uObjectId',
  'uNearType', 'uNearMap', 'uNearReady', 'uFarType', 'uFarMap',
  'uStructFoot', 'uStructCount',
];
const DERIV_UNIFORMS = ['uGI', 'uGA', 'uDepth', 'uGrid', 'uTanHalfHFov', 'uPlaneDistY'];
// US-006/US-007: light pass uniforms (14.3 items 3/4).
const LIGHT_UNIFORMS = [
  'uGI', 'uGA', 'uDepth', 'uLVis', 'uGrid', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY',
  'uHorizonRow', 'uPlaneDistY', 'uAmbient', 'uLightCount', 'uLightPos', 'uLightCol', 'uVisBox',
  'uSunDir', 'uSunCol', 'uSunOn', 'uWorldGeom', 'uWorldFlags', 'uStructA', 'uStructB', 'uStructCount', 'uWorldMaxH',
  'uProjMode', 'uPitchA', 'uPitchB', 'uPitchC', // RE-02a
  'uSunMode', 'uSunShadowM', 'uSunShadowRes', 'uSunShadowTexelM', 'uSunShadowBiasM', 'uSunShadowNormalOff', 'uSunShadow', // ME-15c
];
// US-016 (14.4 items 2-4, GPU build order step 2): pass A2 terrain march.
const TERRAIN_UNIFORMS = [
  'uSGI', 'uSGA', 'uSDepth', 'uFarH', 'uFarType', 'uFarMap',
  'uStructA', 'uStructB', 'uStructCount',
  'uGrid', 'uN', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY',
  'uHorizonRow', 'uPlaneDistY', 'uTerrainMaxH',
  // US-026a S5 (23.4): near-band march - uSunDir/uAmbientI/uSunI moved OUT
  // of this program (the shade pass computes `b` now, see SHADE_UNIFORMS).
  'uNearH', 'uNearType', 'uNearMap', 'uNearReady', 'uFarMinH', 'uNearMinH', 'uHandover', 'uNearStep',
];
// US-040 (15.2 items 3/4, GPU build order step 3): pass A3 voxel march.
const VOXEL_UNIFORMS = [
  'uSGI', 'uSGA', 'uSDepth', 'uVOX', 'uVOXINST', 'uVoxCount', 'uVoxRect',
  'uGrid', 'uN', 'uPosX', 'uPosY', 'uEyeH', 'uDirX', 'uDirY', 'uPlaneX', 'uPlaneY',
  'uHorizonRow', 'uPlaneDistY',
];
