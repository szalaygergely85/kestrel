// WG-3d: device-only sun shadow map pass (WebGPU twin of GpuCellPipeline._passShadow, ME-15b/c/d, 27.9a). Depth only: the
// caster list (mesh/shadowList.js, MESH-SHADOW-02 budget incl.) is drawn with the raster VERTEX stages and uViewProj = M_sun
// into a sampled depth map (device format 'depth24' + sampled:true = depth32float on WebGPU).
// B1 plug-in (WgCellPipeline), all objects built once at construct time (38.8a 22b), zero allocation per frame:
//   const sh = new WgShadowPass(device, { shadows: opts.shadows, buffers: raster.buffers });   // sh.enabled === false when sun != 'map'
//   per frame, AFTER raster.prepare(p) / raster.run(p) (needs raster.list, levelCache, meshCache, strictMatIdFor):  sh.run(p, raster);
//   light pass: sunMode = sh.active ? 2 : 0 (GL: shadowActive && sun.on); light uSunShadow texture = sh.depthTex (kind 'depth', depth32float);
//   uSunShadowM = sh.sunMatF32 (column-major mat4, GL layout), uSunShadowRes = shadowOpts.res, uSunShadowTexelM = sh.sunMat.texelM,
//   uSunShadowBiasM = shadowOpts.biasM, uSunShadowNormalOff = shadowOpts.normalOffsetTexels (or read sh.lightParams()).
//   gpucompare: `await sh.readbackDepth(out)` fills Uint32Array(res*res) with the float32 bits of depth (shadowParity.js contract).
// The map is independent of the cell grid: no resize hook is needed. While `active` is false the light pass binds a dummy 1x1 depth texture.
// Depth range: every shadow vertex stage maps z into [0.5, 1] (raster.wgsl.js SHADOW_Z_LINE; 38.5 item 6) so the depthBias unit is 2^-24 at any depth;
// the terrain stage is SHADOW_TERRAIN_WGSL (own vs_main + fs_main, ONE shared block). GpuDeviceWebGPU keeps its fragment stage via fragment.src.entry.
import { MeshBuffers, CLOTH_DYN_LAYOUT, CLOTH_UV_LAYOUT, CLOTH_STRIDE_BYTES, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, MASK_UV_LAYOUT, MASK_UV_STRIDE_BYTES, TERRAIN_VERTEX_LAYOUT, TERRAIN_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES } from '../MeshBuffers.js';
import { RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_MASK_BLOCK, RASTER_MASK_SHADOW_WGSL, RASTER_SHADOW_WGSL, RASTER_VOXEL_SHADOW_WGSL, RASTER_INSTANCED_SHADOW_WGSL, RASTER_CLOTH_SHADOW_WGSL } from '../wgsl/raster.wgsl.js';
import { SHADOW_TERRAIN_BLOCK, SHADOW_TERRAIN_WGSL, SHADOW_DEPTH_COPY_WGSL, SHADOW_DEPTH_COPY_TEXTURES } from '../wgsl/shadow.wgsl.js';
import { NO_STRUCTURES } from './passRaster.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../../../mesh/shadowList.js';
import { DRAW_STATIC, DRAW_VOXEL, DRAW_TERRAIN, DRAW_INSTANCED, DRAW_CLOTH, instancedRanges } from '../../../mesh/DrawList.js';
import { terrainMeshSetFor } from '../../../mesh/terrainMesh.js';
import { sharedVoxelMeshCache } from '../../../mesh/voxelMesh.js';
import { INSTANCE_BYTES, MAX_INSTANCES_PER_FRAME, SHADOW_BAND_HYST_M } from '../../../mesh/instances.js';
import { WgCullPass } from './passCull.js';
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js'; // S8-B1-07: per-pass GPU timer slots
import { resolveSunShadowOptions, SUN_OFF_MATRIX, createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, sunShadowFogFar, shadowInputHash } from '../../shadowSun.js';

const MODEL = RASTER_BLOCK.field('model').word, VIEW = RASTER_BLOCK.field('viewProj').word;
const M_X0 = RASTER_MASK_BLOCK.field('maskX0').word, M_Y0 = RASTER_MASK_BLOCK.field('maskY0').word, M_W = RASTER_MASK_BLOCK.field('maskW').word;
const M_H = RASTER_MASK_BLOCK.field('maskH').word, M_CUT = RASTER_MASK_BLOCK.field('maskCut').word;
const T_MODEL = SHADOW_TERRAIN_BLOCK.field('model').word, T_VIEW = SHADOW_TERRAIN_BLOCK.field('viewProj').word;
const T_FOOT = SHADOW_TERRAIN_BLOCK.field('structFoot').word, T_COUNT = SHADOW_TERRAIN_BLOCK.field('structCount').word;
const INSTANCE_LAYOUT = [
  { name: 'iRow0', location: 6, components: 4, type: 'float', offsetBytes: 0 },
  { name: 'iRow1', location: 7, components: 4, type: 'float', offsetBytes: 16 },
  { name: 'iRow2', location: 8, components: 4, type: 'float', offsetBytes: 32 },
  { name: 'iMeta', location: 9, components: 2, type: 'uint', offsetBytes: 48 },
];

export class WgShadowPass {
  /** @param {any} device @param {{shadows?: any, buffers?: MeshBuffers, renderer?: string, gpuCull?: boolean}} [opts] gpuCull (default true, `?gpucull=0` = off): WG-4b compute cull of instanced casters */
  constructor(device, opts = {}) {
    this.device = device;
    const so = this.shadowOpts = resolveSunShadowOptions(opts.shadows, opts.renderer || 'mesh');
    this.enabled = so.sun === 'map';
    this.off = so.sun === 'off';         // GFX-03: sun lights, no shadows: no depth pass; `run` only publishes the "everything outside the box" matrix (sunMode 2, dummy depth texture)
    this.active = false;                 // this frame's map is valid (= GL shadowActive): light sunMode 2
    this.renders = 0; this.skips = 0;
    this.stats = { shadowItems: 0, shadowDraws: 0, shadowCpuMs: 0 };
    this.depthTex = null; this.target = null; this.pipes = [];
    this.ownBuffers = !opts.buffers; this.buffers = opts.buffers || new MeshBuffers(device);
    this.sunMat = createSunShadowMatrix(); this.sunMatF32 = new Float32Array(16);
    if (this.off) { for (let i = 0; i < 16; i++) this.sunMatF32[i] = SUN_OFF_MATRIX[i]; this.sunMat.texelM = 1; }
    this.list = createShadowList(); this.centre = new Float64Array(3); this.worldZ = { min: 0, max: 0 };
    this.key = new Int32Array(3); this.keyPrev = new Int32Array(3); this.keyValid = false;
    this.src = { centre: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0 }, meshLod0M: 25, instCastM: 48, cache: null, terrainSet: null, voxelPool: null, voxelMeshCache: sharedVoxelMeshCache, fogFarM: 2000, instances: null, cloths: null, matIdFor: undefined, meshCache: null, meshIdFor: undefined, gpu: /** @type {any} */ (null) };
    // WG-4b: instanced casters (meshGroup + single-range voxel units, buildShadowList `src.gpu`) cut on the GPU by the shadow kernel (cullShadow.wgsl.js); the rest stays on the CPU list
    this.cull = null; this.gpuGroups = []; this.gpuM0 = []; this.gpuM1 = []; this.gpuR = []; this.gpuL0 = []; this.gpuEntries = []; this.gpuN = 0; this._pair = [null, null];
    this._gpuHook = { accept: (g, m0, m1, R, lod0M) => this._accept(g, m0, m1, R, lod0M) };
    this.u = new Float32Array(RASTER_BLOCK.sizeWords);
    this.baseU = new Float32Array(this.u.buffer, 0, RASTER_BASE_BLOCK.sizeWords);
    this.tu = new Float32Array(SHADOW_TERRAIN_BLOCK.sizeWords); this.tbits = new Uint32Array(this.tu.buffer);
    this.bindDesc = { uniforms: this.baseU, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: null };
    this.clothStreams = [null];
    // ALPHA-01c: masked static casters (leaf-shaped shadows): own uniform copy + bind desc; the atlas texture is the raster pass's (`raster.maskTex`)
    this.mu = new Float32Array(RASTER_MASK_BLOCK.sizeWords); this.mbits = new Uint32Array(this.mu.buffer);
    this.maskTexBind = [{ slot: 0, texture: null }]; this.maskExtra = [null];
    this.maskBind = { uniforms: this.mu, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, extraBuffers: this.maskExtra, textures: this.maskTexBind };
    this.maskDraws = 0;
    this.instanceBuffers = new Map();
    this.passOpts = { clear: true };
    this.copyTex = null; this.copyTarget = null; this.copyPipe = null; this.copyBind = null;
    this.draws = 0; this._lp = null;
    if (!this.enabled) return;
    try {
      const res = so.res;
      this.depthTex = device.createTexture({ format: 'depth24', width: res, height: res, sampled: true });
      this.target = device.createTarget({ color: [], depth: this.depthTex });
      // GL polygonOffset(factor, units): factor = slope scale, units = constant (WebGPU: integer).
      this.depthBias = { factor: so.depthBias[0], units: Math.round(so.depthBias[1]) };
      this.staticPipe = this._pipeline(RASTER_SHADOW_WGSL, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, 'none', RASTER_BASE_BLOCK);
      this.voxelPipe = this._pipeline(RASTER_VOXEL_SHADOW_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', RASTER_BASE_BLOCK);
      this.maskPipe = this._pipeline(RASTER_MASK_SHADOW_WGSL, STATIC_VERTEX_LAYOUT, STATIC_STRIDE_BYTES, 'none', RASTER_MASK_BLOCK, false, [{ layout: MASK_UV_LAYOUT, strideBytes: MASK_UV_STRIDE_BYTES }], 'fs_mask_shadow', ['uint']);
      this.instancePipe = this._pipeline(RASTER_INSTANCED_SHADOW_WGSL, VOXEL_VERTEX_LAYOUT, VOXEL_STRIDE_BYTES, 'back', RASTER_BLOCK, true);
      this.clothPipe = this._pipeline(RASTER_CLOTH_SHADOW_WGSL, CLOTH_DYN_LAYOUT, CLOTH_STRIDE_BYTES, 'none', RASTER_BASE_BLOCK, false, [{ layout: CLOTH_UV_LAYOUT, strideBytes: 8 }]);
      this.terrainPipe = this._pipeline(SHADOW_TERRAIN_WGSL, TERRAIN_VERTEX_LAYOUT, TERRAIN_STRIDE_BYTES, 'none', SHADOW_TERRAIN_BLOCK, false, null, 'fs_main');
      if (opts.gpuCull !== false && typeof device.createComputePipeline === 'function') { this.cull = new WgCullPass(device, { shadow: true }); this.src.gpu = this._gpuHook; }
    } catch (e) { this.dispose(); throw e; }
  }

  // Vertex stage from the raster module; fragment stage omitted (depth only) unless `fragEntry` names one (terrain carve).
  _pipeline(code, layout, stride, cull, block, instanced = false, extraLayouts = null, fragEntry = null, textures = []) {
    const vertex = { src: { wgsl: code }, layout, strideBytes: stride };
    if (instanced) { vertex.instanceLayout = INSTANCE_LAYOUT; vertex.instanceStrideBytes = INSTANCE_BYTES; }
    if (extraLayouts) vertex.extraLayouts = extraLayouts;
    const pipe = this.device.createPipeline({ vertex, fragment: { src: fragEntry ? { wgsl: code, entry: fragEntry } : null, targets: 0 },
      bindings: { uniformBytes: block.sizeBytes, textures }, targetFormats: [], depthFormat: 'depth32f',
      depth: { test: true, write: true }, depthBias: this.depthBias, cull, frontFace: 'cw' });
    this.pipes.push(pipe);
    return pipe;
  }

  _accept(g, m0, m1, R, lod0M) {
    const cull = this.cull, n = this.gpuN;
    if (!cull) return false;
    const pair = this._pair; pair[0] = m0; pair[1] = m1;
    if (!cull.supports(g, pair)) return false;
    this.gpuGroups[n] = g; this.gpuM0[n] = m0; this.gpuM1[n] = m1; this.gpuR[n] = R; this.gpuL0[n] = lod0M; this.gpuN = n + 1;
    return true;
  }

  // Dirty-skip key part for the GPU-owned groups (their rows never reach the CPU list hash), O(groups) per frame, no row walk (WG-4b(c)):
  // (group id, ib.version, count) per group - writers bump the version (writeUnitInstance on change, touchInstances for raw writers) - plus the eye cell
  // (1 m, as before): the kernel's band hysteresis state depends on the exact eye, so a band crossing is picked up within a metre of eye travel.
  // The sun-box frustum part of the cut is in key[0] (sun matrix hash).
  _gpuHash(cam) {
    let h = 0x2545f491 | 0;
    h = Math.imul(h ^ Math.floor(cam.x), 16777619); h = Math.imul(h ^ Math.floor(cam.y), 16777619);
    for (let k = 0; k < this.gpuN; k++) {
      const g = this.gpuGroups[k];
      h = Math.imul(h ^ g.id, 16777619); h = Math.imul(h ^ g.ib.version, 16777619); h = Math.imul(h ^ g.count, 16777619);
    }
    return h;
  }

  // Outside any pass, before _render: queue the accepted batches and run the shadow kernel (one dispatch each).
  _cullRun(planes, cam, so) {
    const n = this.gpuN, cull = this.cull, pair = this._pair;
    if (!n) return;
    cull.begin({ planes, eye: cam, castM: so.instCastM, hystM: SHADOW_BAND_HYST_M });
    for (let i = 0; i < n; i++) { pair[0] = this.gpuM0[i]; pair[1] = this.gpuM1[i]; this.gpuEntries[i] = cull.add(this.gpuGroups[i], pair, this.gpuL0[i], this.gpuR[i]); }
    cull.run();
  }

  /** The light pass inputs for sunMode 2 (one reused object, refreshed per call). */
  lightParams() {
    const so = this.shadowOpts;
    const o = this._lp || (this._lp = { active: false, texture: null, matrix: this.sunMatF32, res: 0, texelM: 0, biasM: 0, normalOffsetTexels: 0 });
    o.active = this.active; o.texture = this.depthTex; o.res = so.res; o.texelM = this.sunMat.texelM; o.biasM = so.biasM; o.normalOffsetTexels = so.normalOffsetTexels;
    return o;
  }

  _fillFoot(world) {
    const structs = world.structures || NO_STRUCTURES, tu = this.tu;
    let n = 0;
    for (let i = 0; i < structs.length && n < MAX_STRUCTS; i++) {
      if (structs[i].kind === 'mesh') continue; // ME-14c1
      const b = structs[i].bbox; if (!b) continue;
      const o = T_FOOT + n * 4; tu[o] = b.x0; tu[o + 1] = b.y0; tu[o + 2] = b.x1; tu[o + 3] = b.y1; n++;
    }
    this.tbits[T_COUNT] = n;
    return n;
  }

  /**
   * TEST-ONLY (shadowParity.js): the CPU oracle caster list of the last frame. GPU-culled groups (WG-4b) are not in `this.list`, so with any of them the
   * list is rebuilt once with the hook off (full CPU path, same planes/sources) into a separate list; the twin then rasters it against the kernel's map.
   * @returns {import('../../../mesh/DrawList.js').DrawList}
   */
  casterList() {
    if (!this.gpuN || !this._raster || !this._world) return this.list;
    const src = this.src, hook = src.gpu;
    if (!this._refList) this._refList = createShadowList();
    src.gpu = null;
    buildShadowList(this._refList, this._raster.list, this._world, this.sunMat.planes, src);
    src.gpu = hook;
    return this._refList;
  }

  /** TEST-ONLY (shadowParity.js): the carve footprints of the last frame, same fields the JS twin ctx wants. @returns {{foot: Float32Array, count: number}|null} */
  footprints() {
    if (!this._world) return null;
    const count = this._fillFoot(this._world);
    return { foot: this.tu.subarray(T_FOOT, T_FOOT + count * 4), count };
  }

  _model(m, o = 0) {
    const M = this.u, n = MODEL;
    M[n] = m[o]; M[n + 1] = m[o + 3]; M[n + 2] = m[o + 6]; M[n + 3] = 0;
    M[n + 4] = m[o + 1]; M[n + 5] = m[o + 4]; M[n + 6] = m[o + 7]; M[n + 7] = 0;
    M[n + 8] = m[o + 2]; M[n + 9] = m[o + 5]; M[n + 10] = m[o + 8]; M[n + 11] = 0;
    M[n + 12] = m[o + 9]; M[n + 13] = m[o + 10]; M[n + 14] = m[o + 11]; M[n + 15] = 1;
  }

  /** ALPHA-01c: a static caster; masked ranges draw per range with the discard pipeline (the JS depth-only twin skips the same fragments). */
  _staticCaster(item, entry) {
    const mesh = item.mesh, mr = mesh.maskRanges, raster = this._raster;
    if (!mr || !raster || !raster.maskReady || !entry.uvMaskBuffer) { this._draw(this.staticPipe, entry, item.rangeCount * 3, item.rangeFirst * 3); return; }
    const rs = mesh.ranges, first = item.rangeFirst, last = first + item.rangeCount, bits = this.mbits;
    for (let p = 0; p < rs.length; p++) {
      const a = Math.max(first, rs[p].start), b = Math.min(last, rs[p].start + rs[p].count);
      if (b <= a) continue;
      if (mr[p * 5 + 2] < 0) { this._draw(this.staticPipe, entry, (b - a) * 3, a * 3); continue; }
      this.mu.set(this.baseU);
      bits[M_X0] = mr[p * 5]; bits[M_Y0] = mr[p * 5 + 1]; bits[M_W] = mr[p * 5 + 2]; bits[M_H] = mr[p * 5 + 3]; bits[M_CUT] = mr[p * 5 + 4];
      const bd = this.maskBind;
      bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = null; bd.instanceBuffer = null; this.maskExtra[0] = entry.uvMaskBuffer; this.maskTexBind[0].texture = raster.maskTex;
      this.device.bind(this.maskPipe, bd); this.device.draw((b - a) * 3, a * 3, 1);
      this.draws++; this.maskDraws++;
    }
  }

  _draw(pipe, entry, count, first, instanceBuffer = null, instances = 1) {
    const b = this.bindDesc;
    b.uniforms = pipe === this.instancePipe ? this.u : this.baseU;
    b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer || null; b.instanceBuffer = instanceBuffer; b.extraBuffers = null;
    this.device.bind(pipe, b); this.device.draw(count, first, instances);
    this.draws++;
  }

  /**
   * Build the caster list + sun matrix, dirty-skip, then draw. `p` = the WgCellPipeline (_light/_cam/_world/_table/_palette/_voxelPool/_instances/terrainEnabled),
   * `raster` = its WgRasterPass (prepared this frame: list, levelCache, meshCache, strictMatIdFor). @returns {boolean} map valid (= sunMode 2)
   */
  run(p, raster) {
    this.active = false;
    if (this.off) { // GFX-03: no caster list, no pass; the light pass samples nothing (receivers are outside the box)
      const sun = p._light && p._light.sun;
      this.active = !!(sun && sun.on);
      this.stats.shadowItems = 0; this.stats.shadowDraws = 0; this.stats.shadowCpuMs = 0;
      return this.active;
    }
    if (!this.enabled) return false;
    this._world = p._world; this._raster = raster;
    const so = this.shadowOpts, light = p._light, cam = p._cam, world = p._world, sun = light && light.sun;
    if (!sun || !sun.on || !cam || !world) return false;
    const list = this.list, src = this.src, st = this.stats;
    const tCpu0 = performance.now();
    sunShadowCentre(cam, so, this.centre);
    const c = src.centre; c.x = this.centre[0]; c.y = this.centre[1]; c.z = this.centre[2];
    src.cache = raster.levelCache;
    src.terrainSet = p.terrainEnabled && world.terrain ? terrainMeshSetFor(world.terrain) : null;
    const vp = p._voxelPool;
    if (vp && vp.shadowView) { vp.projectShadow(); src.voxelPool = vp.shadowView; } else src.voxelPool = null;
    src.instances = p._instances || null;
    this.gpuN = 0;
    src.eye.x = cam.x; src.eye.y = cam.y; src.meshLod0M = so.meshLod0M; src.instCastM = so.instCastM; src.meshCastM = so.meshCastM; src.meshCastCap = so.meshCastCap;
    src.cloths = world.cloths && world.cloths.count > 0 ? world.cloths : null;
    src.matIdFor = p._table ? p._table.idFor : undefined;
    src.meshCache = raster.meshCache; src.meshIdFor = raster.strictMatIdFor || undefined;
    src.fogFarM = sunShadowFogFar(p._palette, so);
    shadowWorldZ(world, raster.levelCache, this.worldZ);
    const sm = shadowSunMatrix(sun.dir, this.centre, so, this.worldZ, this.sunMat);
    const Mf = this.sunMatF32;
    for (let i = 0; i < 16; i++) Mf[i] = sm.M[i];
    buildShadowList(list, raster.list, world, sm.planes, src);
    const key = shadowInputHash(list, sm.M, world.structVersion | 0, this.key);
    key[2] = this.gpuN ? this._gpuHash(cam) : 0;
    st.shadowCpuMs = performance.now() - tCpu0;
    const prev = this.keyPrev;
    if (so.dirtySkip && this.keyValid && key[0] === prev[0] && key[1] === prev[1] && key[2] === prev[2]) {
      this.active = true; this.skips++; st.shadowItems = list.count; st.shadowDraws = 0;
      return true;
    }
    prev[0] = key[0]; prev[1] = key[1]; prev[2] = key[2]; this.keyValid = true; this.renders++;
    // S8-B1-07: cull (WG-4b, compute) + render (the depth map) share one 'shadow' timer slot - building the map is one bucket.
    wgSpanBegin(p, WG_PASS_SLOT.shadow);
    try { this._cullRun(sm.planes, cam, so); this._render(list, world, Mf); } finally { wgSpanEnd(p); }
    this.active = true; st.shadowItems = list.count; st.shadowDraws = this.draws;
    return true;
  }

  _render(list, world, Mf) {
    const d = this.device, u = this.u, tu = this.tu;
    for (let i = 0; i < 16; i++) { u[VIEW + i] = Mf[i]; tu[T_VIEW + i] = Mf[i]; }
    this.draws = 0;
    d.beginPass(this.target, this.passOpts); // clears depth to 1
    try {
      for (let i = 0; i < list.count; i++) { // static level quads
        const item = list.items[i];
        if (item.type !== DRAW_STATIC || !item.mesh || item.rangeCount <= 0) continue;
        this._model(item.matrix);
        this._staticCaster(item, this.buffers.get(item.mesh));
      }
      for (let i = 0; i < list.count; i++) { // voxel props: one draw per part
        const item = list.items[i];
        if (item.type !== DRAW_VOXEL || !item.mesh) continue;
        const entry = this.buffers.getVoxel(item.mesh), ranges = item.mesh.ranges;
        for (let part = 0; part < ranges.length; part++) {
          const r = ranges[part]; if (r.count <= 0) continue;
          this._model(item.partMatrices, part * 12);
          this._draw(this.voxelPipe, entry, r.count * 3, r.start * 3);
        }
      }
      let instTotal = 0; // instanced casters; overflow past the per-frame cap drops the rest (never throw for a shadow)
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_INSTANCED || !item.mesh || !item.instBuf) continue;
        const n = item.instCount;
        if (instTotal + n > MAX_INSTANCES_PER_FRAME) break;
        instTotal += n;
        let buffer = this.instanceBuffers.get(item.instBuf);
        if (!buffer) { buffer = d.createBuffer({ usage: 'vertex', data: item.instBuf.f32, dynamic: true }); this.instanceBuffers.set(item.instBuf, buffer); }
        else d.writeBuffer(buffer, item.instBuf.f32, 0);
        const entry = this.buffers.getVoxel(item.mesh), ranges = instancedRanges(item); // ONE_PART -> one whole-mesh range (38.9)
        for (let part = 0; part < ranges.length; part++) {
          const r = ranges[part]; if (r.count <= 0) continue;
          this._model(item.partMatrices, part * 12);
          this._draw(this.instancePipe, entry, r.count * 3, r.start * 3, buffer, n);
        }
      }
      for (let i = 0; i < this.gpuN; i++) { // WG-4b: GPU-culled instanced casters, one indirect draw per active band (identity part 0, as the CPU loop)
        const entries = this.gpuEntries[i];
        for (let band = 0; band < 2; band++) {
          const e = entries[band];
          if (!e.active) continue;
          this._model(e.parts.m, 0);
          const entry = this.buffers.getVoxel(e.mesh), bd = this.bindDesc;
          bd.uniforms = this.u; bd.vertexBuffer = entry.vertexBuffer; bd.indexBuffer = entry.indexBuffer || null; bd.instanceBuffer = e.instanceBuffer; bd.extraBuffers = null;
          d.bind(this.instancePipe, bd); d.drawIndirect(e.argsBuffer, e.argsOffset); this.draws++;
        }
      }
      const b = this.bindDesc;
      for (let i = 0; i < list.count; i++) { // cloth: two-sided, position + uv stream like the raster pass
        const item = list.items[i];
        if (item.type !== DRAW_CLOTH || !item.mesh || item.rangeCount <= 0) continue;
        const entry = this.buffers.getCloth(item.mesh);
        this._model(item.matrix);
        this.clothStreams[0] = entry.uvBuffer;
        b.uniforms = this.baseU; b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer; b.instanceBuffer = null; b.extraBuffers = this.clothStreams;
        d.bind(this.clothPipe, b); d.draw(item.rangeCount * 3, item.rangeFirst * 3, 1); this.draws++;
      }
      let footDone = false; // terrain: footprint carve in the fragment stage
      for (let i = 0; i < list.count; i++) {
        const item = list.items[i];
        if (item.type !== DRAW_TERRAIN || !item.mesh || item.rangeCount <= 0) continue;
        if (!footDone) { this._fillFoot(world); footDone = true; }
        const entry = this.buffers.get(item.mesh), mm = item.matrix, n = T_MODEL;
        tu[n] = mm[0]; tu[n + 1] = mm[3]; tu[n + 2] = mm[6]; tu[n + 3] = 0;
        tu[n + 4] = mm[1]; tu[n + 5] = mm[4]; tu[n + 6] = mm[7]; tu[n + 7] = 0;
        tu[n + 8] = mm[2]; tu[n + 9] = mm[5]; tu[n + 10] = mm[8]; tu[n + 11] = 0;
        tu[n + 12] = mm[9]; tu[n + 13] = mm[10]; tu[n + 14] = mm[11]; tu[n + 15] = 1;
        b.uniforms = tu; b.vertexBuffer = entry.vertexBuffer; b.indexBuffer = entry.indexBuffer; b.instanceBuffer = null; b.extraBuffers = null;
        d.bind(this.terrainPipe, b); d.draw(item.rangeCount * 3, item.rangeFirst * 3, 1); this.draws++;
      }
    } finally { d.endPass(); }
  }

  /**
   * TEST-ONLY (gpucompare depth parity, shadowParity.js): copies the depth map into r32uint (shadowDepthCopy) and reads it back.
   * Resources are created on first use, never on the frame path. @param {Uint32Array} out @returns {Promise<boolean>} false when no map was rendered this frame
   */
  async readbackDepth(out) {
    if (!this.active || !this.depthTex) return false;
    const d = this.device, res = this.shadowOpts.res;
    if (!this.copyPipe) {
      this.copyTex = d.createTexture({ format: 'r32ui', width: res, height: res });
      this.copyTarget = d.createTarget({ color: [this.copyTex] });
      this.copyPipe = d.createPipeline({ vertex: { src: { wgsl: SHADOW_DEPTH_COPY_WGSL } }, fragment: { src: { wgsl: SHADOW_DEPTH_COPY_WGSL }, targets: 1 },
        bindings: { uniformBytes: 0, textures: SHADOW_DEPTH_COPY_TEXTURES.slice() }, targetFormats: ['r32ui'], cull: 'none' });
      this.copyBind = { textures: [{ slot: 0, texture: this.depthTex }] };
    }
    d.beginPass(this.copyTarget, this.passOpts);
    d.bind(this.copyPipe, this.copyBind); d.draw(3, 0, 1);
    d.endPass();
    await d.readback(this.copyTex, { x: 0, y: 0, w: res, h: res }, out);
    return true;
  }

  dispose() {
    const d = this.device;
    for (const pipe of this.pipes) d.dispose(pipe);
    this.pipes.length = 0;
    for (const h of [this.copyPipe, this.copyTarget, this.copyTex, this.target, this.depthTex]) if (h) d.dispose(h);
    this.copyPipe = this.copyTarget = this.copyTex = this.target = this.depthTex = null;
    if (this.cull) { this.cull.dispose(); this.cull = null; this.src.gpu = null; }
    for (const buffer of this.instanceBuffers.values()) d.dispose(buffer);
    this.instanceBuffers.clear();
    if (this.ownBuffers) this.buffers.dispose();
    this.active = false;
  }
}
