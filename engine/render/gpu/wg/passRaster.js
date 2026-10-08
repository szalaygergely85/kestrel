// WG-2b/2c: device-only mesh + terrain raster (kind 7, ME-06 twin); cell shading stays on the CPU until WG-3c.
import { MeshBuffers, CLOTH_DYN_LAYOUT, CLOTH_UV_LAYOUT, CLOTH_STRIDE_BYTES, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, MASK_UV_LAYOUT, MASK_UV_STRIDE_BYTES, TERRAIN_VERTEX_LAYOUT, TERRAIN_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES } from '../MeshBuffers.js';
import { RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_MASK_BLOCK, RASTER_MASK_WGSL, RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL, RASTER_CLOTH_WGSL } from '../wgsl/raster.wgsl.js';
import { TERRAIN_BLOCK, TERRAIN_RASTER_WGSL, TERRAIN_TEXTURES } from '../wgsl/terrainRaster.wgsl.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { DrawList, LevelMeshCache, MeshDrawCache, addStructures, addMeshStructures, addCloths, DRAW_STATIC, DRAW_TERRAIN, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH, MAX_DRAW_ITEMS } from '../../../mesh/DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from '../../../mesh/meshGroups.js';
import { DRAW_FLAG_ONE_PART } from '../../../mesh/DrawList.js';
import { terrainMeshSetFor } from '../../../mesh/terrainMesh.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../../../mesh/voxelMesh.js';
import { INSTANCE_BYTES, MAX_INSTANCES_PER_FRAME } from '../../../mesh/instances.js';
import { KIND_MODEL, FACE_PACKED } from '../../GBuffer.js';
import { projTerms, shearProjection, pitchedTerms, createPitchedTerms, resolveProjection } from '../../projection.js';
import { frustumPlanes } from '../../../mesh/culling.js';
import { WgCullPass } from './passCull.js';

const MODEL = RASTER_BLOCK.field('model').word, VIEW = RASTER_BLOCK.field('viewProj').word;
const PLANE = RASTER_BLOCK.field('planeIdOr').word, ZBASE = RASTER_BLOCK.field('zBase').word;
const OBJECT = RASTER_BLOCK.field('objectId').word, AXIS = RASTER_BLOCK.field('axisAligned').word;
const FLAT = RASTER_BLOCK.field('flat').word;
const TEAM_SLOT = RASTER_BLOCK.field('teamSlot').word, TEAM_MAT = RASTER_BLOCK.field('teamMat').word;
const M_X0 = RASTER_MASK_BLOCK.field('maskX0').word, M_Y0 = RASTER_MASK_BLOCK.field('maskY0').word, M_W = RASTER_MASK_BLOCK.field('maskW').word;
const M_H = RASTER_MASK_BLOCK.field('maskH').word, M_CUT = RASTER_MASK_BLOCK.field('maskCut').word;
const T_MODEL = TERRAIN_BLOCK.field('model').word, T_VIEW = TERRAIN_BLOCK.field('viewProj').word;
const T_NEAR = TERRAIN_BLOCK.field('nearMap').word, T_FAR = TERRAIN_BLOCK.field('farMap').word, T_FOOT = TERRAIN_BLOCK.field('structFoot').word;
const T_OBJECT = TERRAIN_BLOCK.field('objectId').word, T_READY = TERRAIN_BLOCK.field('nearReady').word, T_COUNT = TERRAIN_BLOCK.field('structCount').word;
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
    this._oneRange = [{ start: 0, count: 0 }];
    this.grid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
    this.terms = {}; this.pitch = createPitchedTerms();
    this.view = new Float64Array(16); this.planes = new Float64Array(24);
    this.u = new Float32Array(RASTER_BLOCK.sizeWords); this.bits = new Uint32Array(this.u.buffer);
    this.baseU = new Float32Array(this.u.buffer, 0, RASTER_BASE_BLOCK.sizeWords);
    this.bindDesc = { uniforms: this.u, vertexBuffer: null, indexBuffer: null, instanceBuffer: null };
    this.clearOpts = { clear: { color: [[0, 0, 0, 0], [0, 0, 0, 0], [0x7f800000, 0, 0, 0]], depth: 1 } };
    this.vmClearOpts = { clear: { depth: 1 } };
    this.instanceBuffers = new Map();
    // ALPHA-01c: mask-discard static pipeline state (own uniform copy: the base `u` also holds the instanced team rows), R8UI atlas texture
    this.mu = new Float32Array(RASTER_MASK_BLOCK.sizeWords); this.mbits = new Uint32Array(this.mu.buffer);
    this.maskDraws = 0; this.maskTex = null; this.maskDims = [1, 1]; this.maskAtlas = null; this.maskVersion = -1; this.maskUploads = 0; this.maskReady = false;
    this.maskTexBind = [{ slot: 0, texture: null }]; this.maskExtra = [null];
    this.maskBind = { uniforms: this.mu, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: this.maskExtra, textures: this.maskTexBind };
    this.pipes = [];
    this.clothStreams = [null];
    // WG-4a: GPU cull of InstanceGroups batches (meshGroup + single-range voxel units). instances.js hands each supported group to `accept` instead of
    // compacting it on the CPU; MeshGroupSet groups (nearest-64 `chosen` selection is CPU-side) and multi-range voxel units keep the CPU path.
    this.cull = null;
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
      // Cloth: dynamic pos+oct normal (slot 0) + static uv (extra stream), two-sided (GL: CULL_FACE off, CCW = 'cw' after the clip-y flip).
      this.clothPipe = this._pipeline(RASTER_CLOTH_WGSL, CLOTH_DYN_LAYOUT, CLOTH_STRIDE_BYTES, 'none', 'cw', false, [{ layout: CLOTH_UV_LAYOUT, strideBytes: 8 }]);
      if (opts.gpuCull !== false && typeof device.createComputePipeline === 'function') this.cull = new WgCullPass(device);
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
    cull.begin({ planes: this.planes, viewProj: this.view, rows: p.rows, eye: null, maxDistM: 0 });
    for (let i = 0; i < n; i++) { pair[0] = this.gpuM0[i]; pair[1] = this.gpuM1[i]; this.gpuEntries[i] = cull.add(this.gpuGroups[i], pair); }
    cull.run();
  }

  _cullDraw() {
    let draws = 0;
    const b = this.bindDesc;
    for (let i = 0; i < this.gpuN; i++) {
      const entries = this.gpuEntries[i];
      for (let lod = 0; lod < 2; lod++) {
        const e = entries[lod];
        if (!e.active) continue;
        this.bits[PLANE] = 0; this.u[ZBASE] = 0; this.bits[OBJECT] = 0;
        this._model(e.parts.m, 0); this.bits[AXIS] = e.parts.flags[0] & 1;
        const entry = this.buffers.getVoxel(e.mesh);
        b.uniforms = this.u; b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = e.instanceBuffer; b.extraBuffers = null;
        this.device.bind(this.instancePipe, b); this.device.drawIndirect(e.argsBuffer, e.argsOffset);
        draws++;
      }
    }
    return draws;
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
    for (let i = 0; i < 16; i++) tu[T_VIEW + i] = this.view[i];
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
    this.pitched = resolveProjection(cam, 'mesh') === 'pitched';
    if (this.pitched) { pitchedTerms(cam, grid, this.pitch); this.view.set(this.pitch.M); }
    else { projTerms(cam, grid, this.terms); shearProjection(this.terms, this.view); }
    for (let i = 0; i < 16; i++) this.u[VIEW + i] = this.view[i];
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
    if (p._instances) {
      this.meshDrawArg.cache = this.meshCache; this.meshDrawArg.idFor = this.strictMatIdFor || null;
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

  _model(m, o = 0) {
    const M = this.u, n = MODEL;
    M[n] = m[o]; M[n + 1] = m[o + 3]; M[n + 2] = m[o + 6]; M[n + 3] = 0;
    M[n + 4] = m[o + 1]; M[n + 5] = m[o + 4]; M[n + 6] = m[o + 7]; M[n + 7] = 0;
    M[n + 8] = m[o + 2]; M[n + 9] = m[o + 5]; M[n + 10] = m[o + 8]; M[n + 11] = 0;
    M[n + 12] = m[o + 9]; M[n + 13] = m[o + 10]; M[n + 14] = m[o + 11]; M[n + 15] = 1;
  }

  _item(item) {
    this.bits[PLANE] = item.planeIdOr; this.u[ZBASE] = item.zBase;
    this.bits[OBJECT] = item.objectId; this.bits[AXIS] = 0;
  }

  _draw(pipe, entry, count, first, instanceBuffer = null, instances = 1) {
    const b = this.bindDesc;
    b.uniforms = pipe === this.instancePipe ? this.u : this.baseU;
    b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = instanceBuffer; b.extraBuffers = null;
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
      mu.set(this.baseU);
      bits[M_X0] = mr[p * 5]; bits[M_Y0] = mr[p * 5 + 1]; bits[M_W] = mr[p * 5 + 2]; bits[M_H] = mr[p * 5 + 3]; bits[M_CUT] = mr[p * 5 + 4];
      const bd = this.maskBind;
      bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = null; bd.instanceBuffer = null; this.maskExtra[0] = entry.uvMaskBuffer;
      this.device.bind(maskPipe, bd); this.device.draw((b - a) * 3, a * 3, 1);
      draws++; this.maskDraws++;
    }
    return draws;
  }

  _cloths(list) {
    let draws = 0;
    const b = this.bindDesc;
    for (let i = 0; i < list.count; i++) {
      const item = list.items[i];
      if (item.type !== DRAW_CLOTH || !item.mesh || item.rangeCount <= 0) continue;
      const entry = this.buffers.getCloth(item.mesh);
      this._item(item); this._model(item.matrix);
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
        this._model(item.partMatrices, part * 12); this.bits[AXIS] = item.partFlags[part] & 1;
        this._draw(item.mirror ? this.mirrorPipe : this.voxelPipe, entry, r.count * 3, r.start * 3); draws++;
      }
    }
    return draws;
  }

  run(p) {
    this.prepare(p);
    const list = this.list, d = this.device;
    this._cullRun(p);
    d.beginPass(p._t.targetRaster, this.clearOpts);
    let staticDraws = 0, instancedDraws = 0, instances = 0;
    this.maskDraws = 0;
    try {
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
        this._item(item); this._model(item.matrix);
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
        let ranges = item.mesh.ranges;
        if (item.flags & DRAW_FLAG_ONE_PART) { this._oneRange[0].count = item.mesh.triCount; ranges = this._oneRange; }
        for (let part = 0; part < ranges.length; part++) {
          const r = ranges[part]; if (r.count <= 0) continue;
          this._model(item.partMatrices, part * 12); this.bits[AXIS] = item.partFlags[part] & 1;
          this._draw(this.instancePipe, entry, r.count * 3, r.start * 3, buffer, item.instCount); instancedDraws++;
        }
      }
      if (this.gpuN) { const gd = this._cullDraw(); instancedDraws += gd; p.stats.gpuCullDraws = gd; } else p.stats.gpuCullDraws = 0;
      p.stats.clothDraws = this._cloths(list);
      p.stats.terrainDraws = this._terrain(list);
    } finally { d.endPass(); }
    if (this.vmList) {
      // A depth-only target clears the same depth attachment, preserving all colour G-buffer values.
      d.beginPass(p._t.targetVmDepth, this.vmClearOpts); d.endPass();
      d.beginPass(p._t.targetRaster);
      try { p.stats.vmDraws = this._voxels(this.vmList); } finally { d.endPass(); }
    } else p.stats.vmDraws = 0;
    p.stats.meshDraws = staticDraws; p.stats.maskDraws = this.maskDraws; p.stats.maskUploads = this.maskUploads; p.stats.instancedDraws = instancedDraws; p.stats.instances = instances;
    p.stats.voxelDraws += instancedDraws;
  }

  dispose() {
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
