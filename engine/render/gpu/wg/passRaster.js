// WG-2b/2c: device-only mesh + terrain raster (kind 7, ME-06 twin); cell shading stays on the CPU until WG-3c.
import { MeshBuffers, CLOTH_DYN_LAYOUT, CLOTH_UV_LAYOUT, CLOTH_STRIDE_BYTES, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, MASK_UV_LAYOUT, MASK_UV_STRIDE_BYTES, VAO_LAYOUT, VAO_STRIDE_BYTES, TERRAIN_VERTEX_LAYOUT, TERRAIN_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES } from '../MeshBuffers.js';
import { RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_MASK_BLOCK, RASTER_MASK_WGSL, RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL, RASTER_INSTANCED_MASK_BLOCK, RASTER_INSTANCED_MASK_WGSL, RASTER_FLAG_VAO, rasterWgsl } from '../wgsl/raster.wgsl.js';
import { TERRAIN_BLOCK, TERRAIN_RASTER_WGSL, TERRAIN_TEXTURES } from '../wgsl/terrainRaster.wgsl.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { DrawList, LevelMeshCache, MeshDrawCache, addStructures, addMeshStructures, addCloths, DRAW_STATIC, DRAW_TERRAIN, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH, MAX_DRAW_ITEMS } from '../../../mesh/DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from '../../../mesh/meshGroups.js';
import { instancedRanges } from '../../../mesh/DrawList.js';
import { terrainMeshSetFor } from '../../../mesh/terrainMesh.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../../../mesh/voxelMesh.js';
import { INSTANCE_BYTES, MAX_INSTANCES_PER_FRAME } from '../../../mesh/instances.js';
import { KIND_MODEL, FACE_PACKED } from '../../GBuffer.js';
import { projTerms, shearProjection, pitchedTerms, createPitchedTerms, resolveProjection, viewProjAtOrigin } from '../../projection.js';
import { frustumPlanes } from '../../../mesh/culling.js';
import { WgCullPass } from './passCull.js';
import { WgHzbPass } from './passHzb.js'; // S8-B2-10c
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js'; // S8-B1-07: per-pass GPU timer slots
import { windSwayOn, packWindUniforms, SWAY_MAX } from '../../../mesh/sway.js'; // S8-B2-05/06 host wiring: per-frame wind uniforms + cull swayPad

const MODEL = RASTER_BLOCK.field('model').word, VIEW = RASTER_BLOCK.field('viewProj').word;
const PLANE = RASTER_BLOCK.field('planeIdOr').word, ZBASE = RASTER_BLOCK.field('zBase').word;
const OBJECT = RASTER_BLOCK.field('objectId').word, AXIS = RASTER_BLOCK.field('axisAligned').word;
const FLAT = RASTER_BLOCK.field('flat').word;
const TEAM_SLOT = RASTER_BLOCK.field('teamSlot').word, TEAM_MAT = RASTER_BLOCK.field('teamMat').word;
const M_X0 = RASTER_MASK_BLOCK.field('maskX0').word, M_Y0 = RASTER_MASK_BLOCK.field('maskY0').word, M_W = RASTER_MASK_BLOCK.field('maskW').word;
const M_H = RASTER_MASK_BLOCK.field('maskH').word, M_CUT = RASTER_MASK_BLOCK.field('maskCut').word;
// ALPHA-01f (b): same 5 mask fields, RASTER_INSTANCED_MASK_BLOCK's own word offsets (its prefix is byte-identical to RASTER_BLOCK's).
const IM_X0 = RASTER_INSTANCED_MASK_BLOCK.field('maskX0').word, IM_Y0 = RASTER_INSTANCED_MASK_BLOCK.field('maskY0').word;
const IM_W = RASTER_INSTANCED_MASK_BLOCK.field('maskW').word, IM_H = RASTER_INSTANCED_MASK_BLOCK.field('maskH').word, IM_CUT = RASTER_INSTANCED_MASK_BLOCK.field('maskCut').word;
// US-068b2 (38.19): `projMode` (2 = ortho) is the LAST word of every raster block; the word offsets differ per block (BASE's 38 overlaps RASTER's `origin`).
const P_BASE = RASTER_BASE_BLOCK.field('projMode').word, P_RASTER = RASTER_BLOCK.field('projMode').word, P_MASK = RASTER_MASK_BLOCK.field('projMode').word;
const P_IMASK = RASTER_INSTANCED_MASK_BLOCK.field('projMode').word, T_PROJ = TERRAIN_BLOCK.field('projMode').word;
const ORIGIN = RASTER_BLOCK.field('origin').word, T_MODEL_REL = TERRAIN_BLOCK.field('modelRel').word;
// S8-B2-05/06: wind/sway uniforms (RASTER_BLOCK, instanced variant only; the base/mask blocks end before them).
const WIND = RASTER_BLOCK.field('wind').word, WIND_T = RASTER_BLOCK.field('windT').word, WIND_K = RASTER_BLOCK.field('windK').word;
const T_MODEL = TERRAIN_BLOCK.field('model').word, T_VIEW = TERRAIN_BLOCK.field('viewProj').word;
const T_NEAR = TERRAIN_BLOCK.field('nearMap').word, T_FAR = TERRAIN_BLOCK.field('farMap').word, T_FOOT = TERRAIN_BLOCK.field('structFoot').word;
const T_OBJECT = TERRAIN_BLOCK.field('objectId').word, T_READY = TERRAIN_BLOCK.field('nearReady').word, T_COUNT = TERRAIN_BLOCK.field('structCount').word;
/**
 * PREC-01b (37.9 step 6) switch. true = terrain clip is camera-relative too (viewRel + modelRel = model - O). Measured 2026-10-08: with it ON the PASS row
 * 'signal tower' regresses (one far-terrain cell, 702 m, grazing: depth 702.52 vs 702.68, normal 0.94 deg); OFF = terrain stays absolute (its vertices are
 * 700 m+ away and no target row needs it) and every other PREC-01a gain is unchanged. Open ASK ARCHITECT, see docs/test-reports/PREC-01a.md.
 */
export const TERRAIN_REBASE = false;
/** Shared empty list for worlds without `structures` (no per-frame `|| []` allocation). */
export const NO_STRUCTURES = Object.freeze([]);
const INSTANCE_LAYOUT = [
  { name: 'iRow0', location: 6, components: 4, type: 'float', offsetBytes: 0 },
  { name: 'iRow1', location: 7, components: 4, type: 'float', offsetBytes: 16 },
  { name: 'iRow2', location: 8, components: 4, type: 'float', offsetBytes: 32 },
  { name: 'iMeta', location: 9, components: 2, type: 'uint', offsetBytes: 48 },
];

export class WgRasterPass {
  /** @param {any} device @param {{gpuCull?: boolean}} [opts] gpuCull (default true, `?gpucull=0` = off): WG-4a compute cull for ONE_PART instance batches */
  constructor(device, opts = {}) {
    this.device = device;
    this.buffers = new MeshBuffers(device);
    this.list = new DrawList(MAX_DRAW_ITEMS);
    this.levelCache = null; this.meshCache = new MeshDrawCache(); this.strictMatIdFor = null;
    this.meshGroups = new MeshGroupSet(); this.meshDrawArg = { cache: null, idFor: null }; // MESH-INST-01 / TREES-LP-b: same feed as GpuCellPipeline
    this.grid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
    this.terms = {}; this.pitch = createPitchedTerms();
    // PREC-01a (37.9, WebGPU twin of the GLSL plan): camera-relative raster. `view`/`planes` stay absolute f64 (culling, WG-4 cull kernels);
    // `viewRel` = view * T(O) (f32) is what every camera raster uniform carries. O = floor(cam.xy / 16) * 16 (z not rebased) snaps, so it rarely changes.
    // Shadow pass (sun matrix) and water stay absolute on purpose (37.9 step 5).
    this.view = new Float64Array(16); this.planes = new Float64Array(24);
    this.viewRel = new Float32Array(16); this.ox = 0; this.oy = 0;
    this.u = new Float32Array(RASTER_BLOCK.sizeWords); this.bits = new Uint32Array(this.u.buffer);
    this.baseU = new Float32Array(this.u.buffer, 0, RASTER_BASE_BLOCK.sizeWords);
    // S8-B2-05/06: persistent views into `this.u` (construct-once, no per-frame subarray) for packWindUniforms.
    this.windV = this.u.subarray(WIND, WIND + 4); this.windTV = this.u.subarray(WIND_T, WIND_T + 4); this.windKV = this.u.subarray(WIND_K, WIND_K + 64);
    this.windOn = false;
    this.bindDesc = { uniforms: this.u, vertexBuffer: null, indexBuffer: null, instanceBuffer: null };
    this.clearOpts = { clear: { color: [[0, 0, 0, 0], [0, 0, 0, 0], [0x7f800000, 0, 0, 0]], depth: 1 } };
    this.vmClearOpts = { clear: { depth: 1 } };
    this.instanceBuffers = new Map();
    // ALPHA-01c: mask-discard static pipeline state (own uniform copy: the base `u` also holds the instanced team rows), R8UI atlas texture
    this.mu = new Float32Array(RASTER_MASK_BLOCK.sizeWords); this.mbits = new Uint32Array(this.mu.buffer);
    this.maskDraws = 0; this.maskTex = null; this.maskDims = [1, 1]; this.maskAtlas = null; this.maskVersion = -1; this.maskUploads = 0; this.maskReady = false;
    this.maskTexBind = [{ slot: 0, texture: null }]; this.maskExtra = [null];
    this.maskBind = { uniforms: this.mu, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: this.maskExtra, textures: this.maskTexBind };
    // ALPHA-01f (b): instanced masked draw - own uniform copy (RASTER_INSTANCED_MASK_BLOCK's prefix = RASTER_BLOCK's, so `this.iu.set(this.u)` is exact), same mask texture.
    this.iu = new Float32Array(RASTER_INSTANCED_MASK_BLOCK.sizeWords); this.ibits = new Uint32Array(this.iu.buffer);
    this.maskExtraInst = [null];
    this.instanceMaskBind = { uniforms: this.iu, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: this.maskExtraInst, textures: this.maskTexBind };
    this.pipes = [];
    // ME-20c-c (38.18): vertex AO. `vaoOn` = lights.ao.strength > 0 this frame (set in prepare); `(variant, ao)` pipelines are built lazily the first time an
    // entry with `aoBuffer` is drawn while on. Extra streams are preallocated (zero per-frame allocation).
    this.vaoOn = false; this.aoPipes = { voxel: null, mirror: null, instance: null, instanceMask: null };
    this.aoExtra = [null]; this.maskExtraInstAo = [null, null];
    this.clothStreams = [null];
    // WG-4a: GPU cull of InstanceGroups batches (meshGroup + single-range voxel units). instances.js hands each supported group to `accept` instead of
    // compacting it on the CPU; MeshGroupSet groups (nearest-64 `chosen` selection is CPU-side) and multi-range voxel units keep the CPU path.
    this.cull = null;
    /** @type {any} S8-B2-10c HZB builder (only with opts.occl) */ this.hzb = null;
    this._hzbFwd = { x: 0, y: 1, z: 0 }; this._phase2 = false;
    this.gpuGroups = []; this.gpuM0 = []; this.gpuM1 = []; this.gpuEntries = []; this.gpuN = 0; this._pair = [null, null];
    this._gpuHook = { accept: (g, m0, m1) => this._accept(g, m0, m1) };
    // Terrain (ME-06 twin): own uniform block + the near/far type textures (r8ui, 1x1 placeholders until a bake is uploaded).
    this.tu = new Float32Array(TERRAIN_BLOCK.sizeWords); this.tbits = new Uint32Array(this.tu.buffer);
    this.terrainTex = [{ slot: 0, texture: null }, { slot: 1, texture: null }];
    this.terrainBind = { uniforms: this.tu, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: null, textures: this.terrainTex };
    this.nearTex = null; this.farTex = null; this.nearDims = [1, 1]; this.farDims = [1, 1]; this.nearVersion = -1; this.farVersion = -1; this.farWorld = null;
    try {
      this.nearTex = device.createTexture({ format: 'r8ui', width: 1, height: 1 });
      this.farTex = device.createTexture({ format: 'r8ui', width: 1, height: 1 });
      this.terrainTex[0].texture = this.nearTex; this.terrainTex[1].texture = this.farTex;
      this.terrainPipe = device.createPipeline({ vertex: { src: { wgsl: TERRAIN_RASTER_WGSL }, layout: TERRAIN_VERTEX_LAYOUT, strideBytes: TERRAIN_STRIDE_BYTES },
        fragment: { src: { wgsl: TERRAIN_RASTER_WGSL }, targets: 3 }, bindings: { uniformBytes: TERRAIN_BLOCK.sizeBytes, textures: TERRAIN_TEXTURES.slice() },
        targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'], depthFormat: 'depth24', depth: { test: true, write: true }, cull: 'none', frontFace: 'cw' });
      this.pipes.push(this.terrainPipe);
      this.staticPipe = this._pipeline(RASTER_WGSL, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, 'none');
      this.maskTex = device.createTexture({ format: 'r8ui', width: 1, height: 1 }); this.maskTexBind[0].texture = this.maskTex;
      // ALPHA-01c: same state as staticPipe (two-sided) + the mask-uv extra stream (location 10) + texMask at slot 0
      this.maskPipe = this._pipeline(RASTER_MASK_WGSL, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, 'none', 'cw', false, [{ layout: MASK_UV_LAYOUT, strideBytes: MASK_UV_STRIDE_BYTES }], RASTER_MASK_BLOCK, ['uint']);
      this.voxelPipe = this._pipeline(RASTER_VOXEL_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back');
      this.mirrorPipe = this._pipeline(RASTER_VOXEL_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'ccw');
      this.instancePipe = this._pipeline(RASTER_INSTANCED_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', true);
      // ALPHA-01f (b): instanced mesh-group masked draw - same state as instancePipe + the mask-uv extra stream (location 10) + texMask at slot 0
      this.instanceMaskPipe = this._pipeline(RASTER_INSTANCED_MASK_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', true, [{ layout: MASK_UV_LAYOUT, strideBytes: MASK_UV_STRIDE_BYTES }], RASTER_INSTANCED_MASK_BLOCK, ['uint']);
      // Cloth: dynamic pos+oct normal (slot 0) + static uv (extra stream), two-sided (GL: CULL_FACE off, CCW = 'cw' after the clip-y flip).
      this.clothPipe = this._pipeline(RASTER_CLOTH_WGSL, CLOTH_DYN_LAYOUT, CLOTH_STRIDE_BYTES, 'none', 'cw', false, [{ layout: CLOTH_UV_LAYOUT, strideBytes: 8 }]);
      if (opts.gpuCull !== false && typeof device.createComputePipeline === 'function') {
        // S8-B2-10c: `opts.occl` (default OFF, `?occl=1`) = two-phase HZB occlusion; this.hzb is created lazily with the pass (same device)
        this.cull = new WgCullPass(device, { occl: !!opts.occl });
        if (opts.occl) this.hzb = new WgHzbPass(device);
      }
    } catch (e) { this.dispose(); throw e; }
  }

  _accept(g, m0, m1) {
    const cull = this.cull, n = this.gpuN;
    if (!cull) return false;
    const pair = this._pair; pair[0] = m0; pair[1] = m1;
    if (!cull.supports(g, pair)) return false;
    this.gpuGroups[n] = g; this.gpuM0[n] = m0; this.gpuM1[n] = m1; this.gpuN = n + 1;
    return true;
  }

  // Before the raster pass (outside any pass): queue the accepted batches and run the kernel (one dispatch each).
  _cullRun(p) {
    const n = this.gpuN, cull = this.cull, pair = this._pair;
    if (!n) return;
    // S8-B2-10c: the previous frame's HZB, or null (first frame / resize / invalidateHzb / ortho = no usable forward) -> cull phase 1 runs with hzbOn 0
    let hz = null; this._phase2 = false;
    const hp = this.hzb;
    if (hp) {
      hp.resize(p._t.subCols, p._t.subRows); // no-op when unchanged; a new size invalidates
      const v = this.view, fx = v[3], fy = v[7], fz = v[11], fl = Math.hypot(fx, fy, fz); // clip.w row = dot(P - eye, fwd) * k (projection.js)
      if (fl > 1e-9) { const f = this._hzbFwd; f.x = fx / fl; f.y = fy / fl; f.z = fz / fl; hz = hp.descriptor(f); }
    }
    cull.begin({ planes: this.planes, viewProj: this.view, rows: p.rows, eye: null, maxDistM: 0, swayPad: this.windOn ? SWAY_MAX : 0, hzb: hz });
    this._phase2 = !!hz;
    for (let i = 0; i < n; i++) { pair[0] = this.gpuM0[i]; pair[1] = this.gpuM1[i]; this.gpuEntries[i] = cull.add(this.gpuGroups[i], pair); }
    cull.run();
  }

  // ALPHA-01f (d): entries are laid out `[lod*R + r]` (R = entries.length/2, fixed per batch); R = 1 (today's ONE_PART shape) is
  // the same [e0, e1] pair as before. A masked meshGroup range (mr[r*5+2] >= 0) draws through instanceMaskPipe (mask uniforms +
  // uv extra stream + atlas texture, same as _instancedMaskedRange's CPU path); an opaque range draws through instancePipe, unchanged.
  _cullDraw(phase2 = false) {
    let draws = 0;
    const b = this.bindDesc;
    for (let i = 0; i < this.gpuN; i++) {
      const entries = phase2 ? this.cull.phase2Entries(this.gpuGroups[i]) : this.gpuEntries[i], R = entries.length >> 1;
      for (let lod = 0; lod < 2; lod++) {
        for (let r = 0; r < R; r++) {
          const e = entries[lod * R + r];
          if (!e.active) continue;
          this.bits[PLANE] = 0; this.u[ZBASE] = 0; this.bits[OBJECT] = 0; this.u[ORIGIN] = this.ox;
          this._model(e.parts.m, 0);
          const entry = this.buffers.getVoxel(e.mesh); this.bits[AXIS] = this._axis(e.parts.flags[0], entry);
          const mr = e.mesh.maskRanges;
          if (mr && this.maskReady && entry.uvMaskBuffer && mr[r * 5 + 2] >= 0) {
            this.iu.set(this.u);
            const ib = this.ibits; ib[P_IMASK] = this.ortho ? 2 : 0;
            ib[IM_X0] = mr[r * 5]; ib[IM_Y0] = mr[r * 5 + 1]; ib[IM_W] = mr[r * 5 + 2]; ib[IM_H] = mr[r * 5 + 3]; ib[IM_CUT] = mr[r * 5 + 4];
            const bd = this.instanceMaskBind;
            bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = null; bd.instanceBuffer = e.instanceBuffer; this.maskTexBind[0].texture = this.maskTex;
            this.device.bind(this._instMask(entry), bd); this.device.drawIndirect(e.argsBuffer, e.argsOffset);
          } else {
            b.uniforms = this.u; b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = e.instanceBuffer;
            if (this.vaoOn && entry.aoBuffer) { this.aoExtra[0] = entry.aoBuffer; b.extraBuffers = this.aoExtra; this.device.bind(this._aoPipe('instance'), b); }
            else { b.extraBuffers = null; this.device.bind(this.instancePipe, b); } this.device.drawIndirect(e.argsBuffer, e.argsOffset);
          }
          draws++;
        }
      }
    }
    return draws;
  }

  // ME-20c-c: lazily built `(variant, ao)` pipeline; same state as the plain one + the ao stream (location 11) after any mask stream.
  _aoPipe(k) {
    let pp = this.aoPipes[k];
    if (pp) return pp;
    const ao = [{ layout: VAO_LAYOUT, strideBytes: VAO_STRIDE_BYTES }], opt = { ao: true };
    if (k === 'voxel') pp = this._pipeline(rasterWgsl('voxel', opt), VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', false, ao);
    else if (k === 'mirror') pp = this._pipeline(rasterWgsl('voxel', opt), VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'ccw', false, ao);
    else if (k === 'instance') pp = this._pipeline(rasterWgsl('instanced', opt), VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', true, ao);
    else pp = this._pipeline(rasterWgsl('instancedMask', opt), VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', true,
      [{ layout: MASK_UV_LAYOUT, strideBytes: MASK_UV_STRIDE_BYTES }, ao[0]], RASTER_INSTANCED_MASK_BLOCK, ['uint']);
    return (this.aoPipes[k] = pp);
  }

  /** axisAligned flag word: bit 0 = aligned, bit 1 = RASTER_FLAG_VAO (only for an entry carrying aoBuffer while AO is on). */
  _axis(flags, entry) { return (flags & 1) | (this.vaoOn && entry.aoBuffer ? RASTER_FLAG_VAO : 0); }

  // Instanced masked draw: picks the ao variant + binds [uvMask, ao] when the entry carries AO and the flag is on.
  _instMask(entry) {
    const bd = this.instanceMaskBind;
    if (this.vaoOn && entry.aoBuffer) {
      const x = this.maskExtraInstAo; x[0] = entry.uvMaskBuffer; x[1] = entry.aoBuffer; bd.extraBuffers = x;
      return this._aoPipe('instanceMask');
    }
    this.maskExtraInst[0] = entry.uvMaskBuffer; bd.extraBuffers = this.maskExtraInst;
    return this.instanceMaskPipe;
  }

  _pipeline(code, layout, stride, cull, frontFace = 'cw', instanced = false, extraLayouts = null, block = null, textures = []) {
    const vertex = { src: { wgsl: code }, layout, strideBytes: stride };
    if (instanced) { vertex.instanceLayout = INSTANCE_LAYOUT; vertex.instanceStrideBytes = INSTANCE_BYTES; }
    if (extraLayouts) vertex.extraLayouts = extraLayouts;
    const pipe = this.device.createPipeline({ vertex, fragment: { src: { wgsl: code }, targets: 3 },
      bindings: { uniformBytes: (block || (instanced ? RASTER_BLOCK : RASTER_BASE_BLOCK)).sizeBytes, textures },
      targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'], depthFormat: 'depth24', depth: { test: true, write: true }, cull, frontFace });
    this.pipes.push(pipe);
    return pipe;
  }

  // Replace a 1-channel r8ui texture by a (w x h) one when the size differs (rare: bake changes), then upload `data`.
  _uploadType(tex, dims, w, h, data) {
    if (dims[0] !== w || dims[1] !== h) { this.device.dispose(tex); tex = this.device.createTexture({ format: 'r8ui', width: w, height: h }); dims[0] = w; dims[1] = h; }
    this.device.writeTexture(tex, data);
    return tex;
  }

  // GpuCellPipeline._ensureTerrainTextures twin: far type on (farVersion | world), near type on near.version; never per frame.
  _terrainTextures(world) {
    const terrain = world && world.terrain;
    if (!terrain || !terrain.farReady) return;
    if (this.farVersion !== terrain.farVersion || this.farWorld !== world) {
      this.farTex = this._uploadType(this.farTex, this.farDims, terrain.mapW, terrain.mapH, terrain.farType);
      this.farVersion = terrain.farVersion; this.farWorld = world;
    }
    if (terrain.nearReady && this.nearVersion !== terrain.near.version) {
      this.nearTex = this._uploadType(this.nearTex, this.nearDims, terrain.near.w, terrain.near.h, terrain.near.type);
      this.nearVersion = terrain.near.version;
    }
    this.terrainTex[0].texture = this.nearTex; this.terrainTex[1].texture = this.farTex;
  }

  // ALPHA-01c: the R8UI mask atlas texture, re-uploaded only when the atlas object or its version changes (never per frame). Placeholder 1x1 until a world carries masks.
  _maskTexture(world) {
    const atlas = world && world.maskAtlas;
    if (!atlas || atlas.H <= 0) { this.maskReady = false; return; }
    if (this.maskAtlas !== atlas || this.maskVersion !== atlas.version) {
      const dims = this.maskDims;
      if (dims[0] !== atlas.W || dims[1] !== atlas.H) { this.device.dispose(this.maskTex); this.maskTex = this.device.createTexture({ format: 'r8ui', width: atlas.W, height: atlas.H }); dims[0] = atlas.W; dims[1] = atlas.H; }
      this.device.writeTexture(this.maskTex, atlas.data);
      this.maskTexBind[0].texture = this.maskTex; this.maskAtlas = atlas; this.maskVersion = atlas.version; this.maskUploads++;
    }
    this.maskReady = true;
  }

  // Per-frame terrain uniforms (GpuCellPipeline._passRaster terrain block): maps, near gate, structure footprint carve.
  _terrainUniforms(world) {
    const terrain = world.terrain, tu = this.tu;
    for (let i = 0; i < 16; i++) tu[T_VIEW + i] = TERRAIN_REBASE ? this.viewRel[i] : this.view[i];
    this.tbits[T_READY] = terrain.nearReady ? 1 : 0;
    if (terrain.nearReady && terrain.near) {
      const ng = terrain.near; tu[T_NEAR] = ng.x0; tu[T_NEAR + 1] = ng.y0; tu[T_NEAR + 2] = ng.cell; tu[T_NEAR + 3] = ng.w;
    }
    const fg = terrain._farGridDraw;
    if (fg) { tu[T_FAR] = fg.x0; tu[T_FAR + 1] = fg.y0; tu[T_FAR + 2] = terrain.mapCell; tu[T_FAR + 3] = terrain.mapW; }
    const structs = world.structures || NO_STRUCTURES;
    let n = 0;
    for (let i = 0; i < structs.length && n < MAX_STRUCTS; i++) {
      if (structs[i].kind === 'mesh') continue; // ME-14c1
      const b = structs[i].bbox; if (!b) continue;
      const o = T_FOOT + n * 4; tu[o] = b.x0; tu[o + 1] = b.y0; tu[o + 2] = b.x1; tu[o + 3] = b.y1; n++;
    }
    this.tbits[T_COUNT] = n;
    this.tbits[T_PROJ] = this.ortho ? 2 : 0; // US-068b2
  }

  _terrain(list) {
    let draws = 0;
    const b = this.terrainBind, tu = this.tu;
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_TERRAIN || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this.buffers.get(item.mesh), mm = item.matrix;
      const n = T_MODEL;
      tu[n] = mm[0]; tu[n + 1] = mm[3]; tu[n + 2] = mm[6]; tu[n + 3] = 0;
      tu[n + 4] = mm[1]; tu[n + 5] = mm[4]; tu[n + 6] = mm[7]; tu[n + 7] = 0;
      tu[n + 8] = mm[2]; tu[n + 9] = mm[5]; tu[n + 10] = mm[8]; tu[n + 11] = 0;
      tu[n + 12] = mm[9]; tu[n + 13] = mm[10]; tu[n + 14] = mm[11]; tu[n + 15] = 1;
      const r = T_MODEL_REL; // clip-only copy with the translation - O (f64 subtract before the f32 store); `model` stays absolute for vWorldPos
      for (let k = 0; k < 12; k++) tu[r + k] = tu[n + k];
      tu[r + 12] = TERRAIN_REBASE ? mm[9] - this.ox : mm[9]; tu[r + 13] = TERRAIN_REBASE ? mm[10] - this.oy : mm[10]; tu[r + 14] = mm[11]; tu[r + 15] = 1;
      this.tbits[T_OBJECT] = item.objectId;
      b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer;
      this.device.bind(this.terrainPipe, b); this.device.draw(item.rangeCount * 3, item.rangeFirst * 3, 1);
      draws++;
    }
    return draws;
  }

  bind(table) {
    this.levelCache = new LevelMeshCache(table.idFor);
    this.strictMatIdFor = (key) => {
      if (!table.hasKey(key)) throw new Error(`mesh material: palette key "${key}" is not defined in the palette / detail pass`);
      return table.idFor(key);
    };
  }

  // Same feed order and absolute f64 culling matrix as GpuCellPipeline._prepRaster.
  prepare(p) {
    const cam = p._cam, world = p._world, grid = this.grid;
    grid.cols = p.cols; grid.rows = p.rows; grid.pxCellW = p.rt.pxCellW || 1; grid.pxCellH = p.rt.pxCellH || 1;
    this._maskTexture(world);
    const rproj = resolveProjection(cam, 'mesh'); // US-068b2: 'ortho' is pitched-family (pitchedTerms builds its terms); projMode: 0 shear, 1 pitched, 2 ortho
    this.pitched = rproj === 'pitched' || rproj === 'ortho'; this.ortho = rproj === 'ortho'; this.projMode = this.ortho ? 2 : this.pitched ? 1 : 0;
    this.bits[P_RASTER] = this.ortho ? 2 : 0;
    const lt = p._light; this.vaoOn = !!(lt && lt.ao && lt.ao.strength > 0); // ME-20c-c
    if (this.pitched) { pitchedTerms(cam, grid, this.pitch); this.view.set(this.pitch.M); }
    else { projTerms(cam, grid, this.terms); shearProjection(this.terms, this.view); }
    this.ox = Math.floor(cam.x / 16) * 16; this.oy = Math.floor(cam.y / 16) * 16;
    viewProjAtOrigin(this.view, this.ox, this.oy, this.viewRel);
    this.u.set(this.viewRel, VIEW);
    this.u[ORIGIN] = this.ox; this.u[ORIGIN + 1] = this.oy; // instanced variant only (iRow.w - origin); the other variants' blocks end before it
    frustumPlanes(this.view, this.planes);
    const list = this.list;
    list.begin();
    this.gpuN = 0; this.meshDrawArg.gpu = this.cull ? this._gpuHook : null;
    if (this.levelCache) addStructures(list, world, cam, this.levelCache, 2000);
    if (this.strictMatIdFor) addMeshStructuresBatched(list, world, cam, this.meshCache, this.strictMatIdFor, 2000, this.meshGroups, this.planes);
    if (p.terrainEnabled && world.terrain) {
      this._terrainTextures(world); this._terrainUniforms(world);
      const set = terrainMeshSetFor(world.terrain); set.step(2); set.addToDrawList(list, cam);
    }
    const pool = p._voxelPool;
    if (pool) { pool.project(cam, p.rt, 'mesh'); if (pool.list.length) addVoxelInstances(list, pool, sharedVoxelMeshCache, pool.partNamesFor); }
    // S8-B2-05/06: per-frame wind uniforms (zero when sway is off: bit-identical to before) + the cull/instance sway padding.
    this.windOn = windSwayOn(world.wind);
    const fbT = p._fb; let tSec = 0; if (fbT) { const v = fbT.timeSec; if (v) tSec = v; } // no tagged phi: avoids a per-frame HeapNumber
    packWindUniforms(world.wind, tSec, this.windV, this.windTV, this.windKV);
    if (p._instances) {
      p._instances.swayPad = this.windOn ? SWAY_MAX : 0;
      this.meshDrawArg.cache = this.meshCache; this.meshDrawArg.idFor = this.strictMatIdFor || null; this.meshDrawArg.maskAtlas = (world && world.maskAtlas) || null; // ALPHA-01f-fix2: instanced masked groups share the static cache entry
      p._instances.addToDrawList(list, sharedVoxelMeshCache, this.planes, p._fb.frameNo, this.view, p.rows, this.meshDrawArg);
      p.stats.instancesCulled = p._instances.stats.instancesCulled; p.stats.instancesLod1 = p._instances.stats.instancesLod1;
    }
    if (world.cloths && world.cloths.count) addCloths(list, world.cloths, this.planes, p._table ? p._table.idFor : undefined);
    list.cull(this.planes);
    this.vmList = p._viewModel ? p._viewModel.buildList(cam, this.pitched) : null;
    const team = p._table && p._table.team;
    for (let k = 0; k < 4; k++) this.u[TEAM_SLOT + k] = team ? team.slotIds[k] : 0;
    for (let k = 0; k < 32; k++) this.u[TEAM_MAT + k] = team ? team.mat[k] : 0;
  }

  // ox/oy: render origin subtracted from the translation in f64 before the f32 store (world-space matrices); 0 for the instanced local part matrices.
  _model(m, o = 0, ox = 0, oy = 0) {
    const M = this.u, n = MODEL;
    M[n] = m[o]; M[n + 1] = m[o + 3]; M[n + 2] = m[o + 6]; M[n + 3] = 0;
    M[n + 4] = m[o + 1]; M[n + 5] = m[o + 4]; M[n + 6] = m[o + 7]; M[n + 7] = 0;
    M[n + 8] = m[o + 2]; M[n + 9] = m[o + 5]; M[n + 10] = m[o + 8]; M[n + 11] = 0;
    M[n + 12] = m[o + 9] - ox; M[n + 13] = m[o + 10] - oy; M[n + 14] = m[o + 11]; M[n + 15] = 1;
  }

  _item(item) {
    this.bits[PLANE] = item.planeIdOr; this.u[ZBASE] = item.zBase;
    this.bits[OBJECT] = item.objectId; this.bits[AXIS] = 0;
  }

  _draw(pipe, entry, count, first, instanceBuffer = null, instances = 1) {
    const b = this.bindDesc;
    const ao = this.vaoOn && entry.aoBuffer; // ME-20c-c: swap to the ao pipeline of the kind-9 variants; static/mask-less paths keep `pipe`
    if (ao) {
      if (pipe === this.voxelPipe) pipe = this._aoPipe('voxel'); else if (pipe === this.mirrorPipe) pipe = this._aoPipe('mirror'); else if (pipe === this.instancePipe) pipe = this._aoPipe('instance');
    }
    if (pipe === this.instancePipe || pipe === this.aoPipes.instance) { this.u[ORIGIN] = this.ox; b.uniforms = this.u; } // BASE `projMode` (word 38) shares RASTER's `origin.x`: restore
    else { this.bits[P_BASE] = this.ortho ? 2 : 0; b.uniforms = this.baseU; }
    b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = instanceBuffer;
    if (pipe === this.aoPipes.voxel || pipe === this.aoPipes.mirror || pipe === this.aoPipes.instance) { this.aoExtra[0] = entry.aoBuffer; b.extraBuffers = this.aoExtra; } else b.extraBuffers = null;
    this.device.bind(pipe, b); this.device.draw(count, first, instances);
  }

  /**
   * ALPHA-01c: one placed static mesh. Unmasked meshes = one draw (as before). A mesh with `maskRanges` draws per mesh range (opaque ranges with the
   * opaque pipeline, masked ranges with the mask pipeline), clipped to the item's [rangeFirst, rangeFirst+rangeCount) window like rasterDrawList.
   * @returns {number} draws issued
   */
  _staticMesh(item, pipe, maskPipe, mu, bits, entry) {
    const mesh = item.mesh, mr = mesh.maskRanges;
    if (!mr || !this.maskReady || !entry.uvMaskBuffer) { this._draw(pipe, entry, item.rangeCount * 3, item.rangeFirst * 3); return 1; }
    const rs = mesh.ranges, first = item.rangeFirst, last = first + item.rangeCount;
    let draws = 0;
    for (let p = 0; p < rs.length; p++) {
      const a = Math.max(first, rs[p].start), b = Math.min(last, rs[p].start + rs[p].count);
      if (b <= a) continue;
      if (mr[p * 5 + 2] < 0) { this._draw(pipe, entry, (b - a) * 3, a * 3); draws++; continue; }
      mu.set(this.baseU); bits[P_MASK] = this.ortho ? 2 : 0;
      bits[M_X0] = mr[p * 5]; bits[M_Y0] = mr[p * 5 + 1]; bits[M_W] = mr[p * 5 + 2]; bits[M_H] = mr[p * 5 + 3]; bits[M_CUT] = mr[p * 5 + 4];
      const bd = this.maskBind;
      bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = null; bd.instanceBuffer = null; this.maskExtra[0] = entry.uvMaskBuffer;
      this.device.bind(maskPipe, bd); this.device.draw((b - a) * 3, a * 3, 1);
      draws++; this.maskDraws++;
    }
    return draws;
  }

  /**
   * ALPHA-01f (b): one masked range of an instanced mesh group (TREES-LP-b kind-9 group with `maskRanges`), matching
   * `rasterJS.js` `rasterInstanced`'s per-range loop and `_staticMesh`'s "one draw per range" shape, instanceCount = N.
   * @returns {number} draws issued (always 1)
   */
  _instancedMaskedRange(entry, r, mr, part, buffer, instCount) {
    this.u[ORIGIN] = this.ox; this.iu.set(this.u); // RASTER_INSTANCED_MASK_BLOCK's prefix = RASTER_BLOCK's (model/viewProj/.../windK), same word offsets
    const ib = this.ibits; ib[P_IMASK] = this.ortho ? 2 : 0;
    ib[IM_X0] = mr[part * 5]; ib[IM_Y0] = mr[part * 5 + 1]; ib[IM_W] = mr[part * 5 + 2]; ib[IM_H] = mr[part * 5 + 3]; ib[IM_CUT] = mr[part * 5 + 4];
    const bd = this.instanceMaskBind;
    bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = null; bd.instanceBuffer = buffer;
    this.device.bind(this._instMask(entry), bd); this.device.draw(r.count * 3, r.start * 3, instCount);
    return 1;
  }

  _cloths(list) {
    let draws = 0;
    const b = this.bindDesc;
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_CLOTH || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this.buffers.getCloth(item.mesh);
      this._item(item); this._model(item.matrix, 0, this.ox, this.oy);
      this.bits[FLAT] = 0; this.bits[FLAT + 1] = (KIND_MODEL | (FACE_PACKED << 8) | (item.mesh.matId << 16)) >>> 0;
      this.clothStreams[0] = entry.uvBuffer;
      b.uniforms = this.baseU; b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer; b.instanceBuffer = null; b.extraBuffers = this.clothStreams;
      this.device.bind(this.clothPipe, b); this.device.draw(item.rangeCount * 3, item.rangeFirst * 3, 1);
      draws++;
    }
    return draws;
  }

  _voxels(list) {
    let draws = 0;
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_VOXEL || !item.mesh) continue;
      const entry = this.buffers.getVoxel(item.mesh), ranges = item.mesh.ranges;
      this._item(item);
      for (let part = 0; part < ranges.length; part++) {
        const r = ranges[part]; if (r.count <= 0) continue;
        this._model(item.partMatrices, part * 12, this.ox, this.oy); this.bits[AXIS] = this._axis(item.partFlags[part], entry);
        this._draw(item.mirror ? this.mirrorPipe : this.voxelPipe, entry, r.count * 3, r.start * 3); draws++;
      }
    }
    return draws;
  }

  run(p) {
    this.prepare(p);
    const list = this.list, d = this.device;
    // S8-B1-07: cull (compute) and raster (render) are separate timer slots - one span each, never nested.
    wgSpanBegin(p, WG_PASS_SLOT.cull);
    try { this._cullRun(p); } finally { wgSpanEnd(p); }
    let staticDraws = 0, instancedDraws = 0, instances = 0;
    this.maskDraws = 0;
    wgSpanBegin(p, WG_PASS_SLOT.raster);
    try {
      d.beginPass(p._t.targetRaster, this.clearOpts);
      try {
        for (let i = 0; i < list.count; i++) {
          const item = list.items[i];
          if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
          this._item(item); this._model(item.matrix, 0, this.ox, this.oy);
          this._staticMesh(item, this.staticPipe, this.maskPipe, this.mu, this.mbits, this.buffers.get(item.mesh)); staticDraws++;
        }
        p.stats.voxelDraws = this._voxels(list);
        for (let i = 0; i < list.count; i++) {
          const item = list.items[i];
          if (item.type !== DRAW_INSTANCED || !item.mesh || !item.instBuf) continue;
          instances += item.instCount;
          if (instances > MAX_INSTANCES_PER_FRAME) throw new Error(`instanced units over ${MAX_INSTANCES_PER_FRAME} per frame`);
          let buffer = this.instanceBuffers.get(item.instBuf);
          if (!buffer) { buffer = d.createBuffer({ usage: 'vertex', data: item.instBuf.f32, dynamic: true }); this.instanceBuffers.set(item.instBuf, buffer); }
          else d.writeBuffer(buffer, item.instBuf.f32, 0);
          this.bits[PLANE] = 0; this.u[ZBASE] = 0; this.bits[OBJECT] = 0;
          const entry = this.buffers.getVoxel(item.mesh);
          const ranges = instancedRanges(item);
          const mr = item.mesh.maskRanges; // ALPHA-01f (b): per-range mask lookup, same shape as _staticMesh's
          for (let part = 0; part < ranges.length; part++) {
            const r = ranges[part]; if (r.count <= 0) continue;
            this._model(item.partMatrices, part * 12); this.bits[AXIS] = this._axis(item.partFlags[part], entry);
            if (mr && this.maskReady && entry.uvMaskBuffer && mr[part * 5 + 2] >= 0) {
              this._instancedMaskedRange(entry, r, mr, part, buffer, item.instCount); instancedDraws++;
            } else {
              this._draw(this.instancePipe, entry, r.count * 3, r.start * 3, buffer, item.instCount); instancedDraws++;
            }
          }
        }
        if (this.gpuN) { const gd = this._cullDraw(); instancedDraws += gd; p.stats.gpuCullDraws = gd; } else p.stats.gpuCullDraws = 0;
        p.stats.clothDraws = this._cloths(list);
        p.stats.terrainDraws = this._terrain(list);
      } finally { d.endPass(); }
      if (this.hzb) this._occlPhase2(p); // S8-B2-10c: HZB build -> cull phase 2 -> raster B (before the viewmodel pass: it clears depth)
      if (this.vmList) {
        // A depth-only target clears the same depth attachment, preserving all colour G-buffer values.
        d.beginPass(p._t.targetVmDepth, this.vmClearOpts); d.endPass();
        d.beginPass(p._t.targetRaster);
        try { p.stats.vmDraws = this._voxels(this.vmList); } finally { d.endPass(); }
      } else p.stats.vmDraws = 0;
    } finally { wgSpanEnd(p); }
    p.stats.meshDraws = staticDraws; p.stats.maskDraws = this.maskDraws; p.stats.maskUploads = this.maskUploads; p.stats.instancedDraws = instancedDraws; p.stats.instances = instances;
    p.stats.voxelDraws += instancedDraws;
  }

  /** Camera cut / teleport (main.js): the next frame's cull phase 1 runs with hzbOn 0. */
  invalidateHzb() { if (this.hzb) this.hzb.invalidate(); }

  /**
   * S8-B2-10c, after raster pass A (outside any pass): copy the depth G-buffer (texSDepth, f32 bits of linear depth) -> ONE HZB build (it is phase 1's input NEXT frame),
   * then cull phase 2 (re-test the pending set against the fresh HZB, survivors -> dst2/dst3) and raster pass B (load, no clear; instanced mesh entries only).
   * Phase 1 and 2 of a frame without a valid previous HZB skip the re-test (nothing was occluded) but the HZB is still built.
   */
  _occlPhase2(p) {
    const hp = this.hzb;
    if (!this.gpuN) { hp.invalidate(); return; } // no batches this frame: the pyramid would go stale -> never reuse it
    const d = this.device;
    hp.build(p._t.texSDepth);
    if (!this._phase2) return;
    const fresh = hp.fresh(this._hzbFwd);
    this.cull.runPhase2(fresh);
    d.beginPass(p._t.targetRaster); // load-only: keeps colour G-buffers and depth24 of pass A
    try { p.stats.gpuCullDraws2 = this._cullDraw(true); } finally { d.endPass(); }
  }

  dispose() {
    if (this.hzb) { this.hzb.dispose(); this.hzb = null; }
    this.buffers.dispose();
    for (const pipe of this.pipes) this.device.dispose(pipe);
    this.pipes.length = 0;
    if (this.maskTex) this.device.dispose(this.maskTex);
    this.maskTex = null;
    if (this.nearTex) this.device.dispose(this.nearTex);
    if (this.farTex) this.device.dispose(this.farTex);
    this.nearTex = this.farTex = null;
    if (this.cull) { this.cull.dispose(); this.cull = null; }
    for (const buffer of this.instanceBuffers.values()) this.device.dispose(buffer);
    this.instanceBuffers.clear();
  }
}
