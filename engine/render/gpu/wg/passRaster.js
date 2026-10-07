// WG-2b: device-only mesh raster. Terrain/voxel coverage is resolved in WG-2c; cell shading stays on the CPU until WG-3c.
import { MeshBuffers, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES } from '../MeshBuffers.js';
import { RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_WGSL, RASTER_VOXEL_WGSL, RASTER_INSTANCED_WGSL } from '../wgsl/raster.wgsl.js';
import { DrawList, LevelMeshCache, MeshDrawCache, addStructures, addMeshStructures, addCloths, DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH, MAX_DRAW_ITEMS } from '../../../mesh/DrawList.js';
import { terrainMeshSetFor } from '../../../mesh/terrainMesh.js';
import { addVoxelInstances, sharedVoxelMeshCache } from '../../../mesh/voxelMesh.js';
import { INSTANCE_BYTES, MAX_INSTANCES_PER_FRAME } from '../../../mesh/instances.js';
import { projTerms, shearProjection, pitchedTerms, createPitchedTerms, resolveProjection } from '../../projection.js';
import { frustumPlanes } from '../../../mesh/culling.js';

const MODEL = RASTER_BLOCK.field('model').word, VIEW = RASTER_BLOCK.field('viewProj').word;
const PLANE = RASTER_BLOCK.field('planeIdOr').word, ZBASE = RASTER_BLOCK.field('zBase').word;
const OBJECT = RASTER_BLOCK.field('objectId').word, AXIS = RASTER_BLOCK.field('axisAligned').word;
const TEAM_SLOT = RASTER_BLOCK.field('teamSlot').word, TEAM_MAT = RASTER_BLOCK.field('teamMat').word;
const INSTANCE_LAYOUT = [
  { name: 'iRow0', location: 6, components: 4, type: 'float', offsetBytes: 0 },
  { name: 'iRow1', location: 7, components: 4, type: 'float', offsetBytes: 16 },
  { name: 'iRow2', location: 8, components: 4, type: 'float', offsetBytes: 32 },
  { name: 'iMeta', location: 9, components: 2, type: 'uint', offsetBytes: 48 },
];

export class WgRasterPass {
  constructor(device) {
    this.device = device;
    this.buffers = new MeshBuffers(device);
    this.list = new DrawList(MAX_DRAW_ITEMS);
    this.levelCache = null; this.meshCache = new MeshDrawCache(); this.strictMatIdFor = null;
    this.grid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
    this.terms = {}; this.pitch = createPitchedTerms();
    this.view = new Float64Array(16); this.planes = new Float64Array(24);
    this.u = new Float32Array(RASTER_BLOCK.sizeWords); this.bits = new Uint32Array(this.u.buffer);
    this.baseU = new Float32Array(this.u.buffer, 0, RASTER_BASE_BLOCK.sizeWords);
    this.bindDesc = { uniforms: this.u, vertexBuffer: null, indexBuffer: null, instanceBuffer: null };
    this.clearOpts = { clear: { color: [[0, 0, 0, 0], [0, 0, 0, 0], [0x7f800000, 0, 0, 0]], depth: 1 } };
    this.vmClearOpts = { clear: { depth: 1 } };
    this.instanceBuffers = new Map();
    this.pipes = [];
    try {
      this.staticPipe = this._pipeline(RASTER_WGSL, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, 'none');
      this.voxelPipe = this._pipeline(RASTER_VOXEL_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back');
      this.mirrorPipe = this._pipeline(RASTER_VOXEL_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'ccw');
      this.instancePipe = this._pipeline(RASTER_INSTANCED_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', 'cw', true);
    } catch (e) { this.dispose(); throw e; }
  }

  _pipeline(code, layout, stride, cull, frontFace = 'cw', instanced = false) {
    const vertex = { src: { wgsl: code }, layout, strideBytes: stride };
    if (instanced) { vertex.instanceLayout = INSTANCE_LAYOUT; vertex.instanceStrideBytes = INSTANCE_BYTES; }
    const pipe = this.device.createPipeline({ vertex, fragment: { src: { wgsl: code }, targets: 3 },
      bindings: { uniformBytes: (instanced ? RASTER_BLOCK : RASTER_BASE_BLOCK).sizeBytes, textures: [] },
      targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'], depthFormat: 'depth24', depth: { test: true, write: true }, cull, frontFace });
    this.pipes.push(pipe);
    return pipe;
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
    this.pitched = resolveProjection(cam, 'mesh') === 'pitched';
    if (this.pitched) { pitchedTerms(cam, grid, this.pitch); this.view.set(this.pitch.M); }
    else { projTerms(cam, grid, this.terms); shearProjection(this.terms, this.view); }
    for (let i = 0; i < 16; i++) this.u[VIEW + i] = this.view[i];
    frustumPlanes(this.view, this.planes);
    const list = this.list;
    list.begin();
    if (this.levelCache) addStructures(list, world, cam, this.levelCache, 2000);
    if (this.strictMatIdFor) addMeshStructures(list, world, cam, this.meshCache, this.strictMatIdFor, 2000);
    if (p.terrainEnabled && world.terrain) {
      const set = terrainMeshSetFor(world.terrain); set.step(2); set.addToDrawList(list, cam);
    }
    const pool = p._voxelPool;
    if (pool) { pool.project(cam, p.rt, 'mesh'); if (pool.list.length) addVoxelInstances(list, pool, sharedVoxelMeshCache, pool.partNamesFor); }
    if (p._instances) {
      p._instances.addToDrawList(list, sharedVoxelMeshCache, this.planes, p._fb.frameNo, this.view, p.rows);
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
    b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = instanceBuffer;
    this.device.bind(pipe, b); this.device.draw(count, first, instances);
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
    // Explicit blocker rather than silently disappearing deformable geometry.
    for (let i = 0; i < list.count; i++) if (list.items[i].type === DRAW_CLOTH) {
      throw new Error('WG-2b NEEDS PC-A: cloth requires the specified additional per-vertex buffer interface');
    }
    d.beginPass(p._t.targetRaster, this.clearOpts);
    let staticDraws = 0, instancedDraws = 0, instances = 0;
    try {
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
        this._item(item); this._model(item.matrix);
        this._draw(this.staticPipe, this.buffers.get(item.mesh), item.rangeCount * 3, item.rangeFirst * 3); staticDraws++;
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
        const entry = this.buffers.getVoxel(item.mesh), ranges = item.mesh.ranges;
        for (let part = 0; part < ranges.length; part++) {
          const r = ranges[part]; if (r.count <= 0) continue;
          this._model(item.partMatrices, part * 12); this.bits[AXIS] = item.partFlags[part] & 1;
          this._draw(this.instancePipe, entry, r.count * 3, r.start * 3, buffer, item.instCount); instancedDraws++;
        }
      }
    } finally { d.endPass(); }
    if (this.vmList) {
      // A depth-only target clears the same depth attachment, preserving all colour G-buffer values.
      d.beginPass(p._t.targetVmDepth, this.vmClearOpts); d.endPass();
      d.beginPass(p._t.targetRaster);
      try { p.stats.vmDraws = this._voxels(this.vmList); } finally { d.endPass(); }
    } else p.stats.vmDraws = 0;
    p.stats.meshDraws = staticDraws; p.stats.instancedDraws = instancedDraws; p.stats.instances = instances;
    p.stats.voxelDraws += instancedDraws;
  }

  dispose() {
    this.buffers.dispose();
    for (const pipe of this.pipes) this.device.dispose(pipe);
    this.pipes.length = 0;
    for (const buffer of this.instanceBuffers.values()) this.device.dispose(buffer);
    this.instanceBuffers.clear();
  }
}
