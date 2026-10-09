// WG-3e: device-only water layer + water composite (WebGPU twin of GpuCellPipeline._passWater / _passWaterComposite, US-055a2a/b,
// architecture.md 35.3). Standalone: B1 wires it into WgCellPipeline.
//
// B1 plug-in (all pipelines / bind descriptors / targets are built at construct + resize time, 38.8a 22b; nothing per frame):
//   const wp = new WgWaterPass(device);                      // pipelines + clipmap buffers + 1x1 dummy WATER texture
//   wp.resize(cols, rows, rays)                              // in resizeGrid (rays unused: the layer is cell resolution); creates WATER/depth/comp targets
//   wp.bindWorld(world)                                      // on World change (uploads waterfall sheet buffers; frees the old ones)
//   wp.setLooks(table)                                       // = setWaterLooks (resolveWaterLooks once; absent -> engine defaults)
//   GL order (GpuCellPipeline.frame, mesh renderer): raster -> resolve -> deriv -> [water] -> light -> shade -> [composite] -> edge
//   1. right after raster.prepare(p) (GL does the selection in _prepRaster):  wp.prepare(p, raster)  -> wp.active
//        p fields read: _cam, _world, _table, _palette, _fb.timeSec; raster fields read: view (f64 viewProj), planes.
//      right after deriv, before light:  wp.runWater(t.texDepth)   (r32uint resolved depth; no-op when inactive)
//   2. right after shade, before edge:   wp.runComposite({ shadeFg, shadeBg, gi, depth, light, shadowActive }, p)  (no-op when inactive)
//        shadeFg/shadeBg = shade targets' rgba8 textures, gi = texGI, depth = texDepth, light = texLight (rgba32uint), shadowActive = sh.active.
//        p fields read: _cam, _world, _palette, _light, _fb.timeSec, cols, rows, rt.pxCellW/H, _rasterPass.{pitched,pitch}.
//   3. edge pass inputs:  fg/bg = wp.active ? wp.edgeFg / wp.edgeBg (composite output) : the shade fg/bg;
//        WATER slot (edge texture 4) = wp.edgeWaterTexture (the WATER texture when active, the 1x1 dummy otherwise); edge waterOn = wp.active ? 1 : 0;
//        edge wos rows = wp.waterOS (Float32Array(WL_SLOTS*2): per slot opaqueAt, seeThrough; copy as 6 contiguous vec4 rows, 24 floats).
//   4. stats: wp.stats.{waterSlots, waterDraws}.  5. gpucompare: `await wp.readbackWater(out?)` -> Uint32Array(4*cols*rows) (readbackWater contract; null when inactive).
//   Formats: WATER 'rgba32ui' (+ own depth24 target), comp outputs 'rgba8' (sampled by edge as float). dispose() frees everything.
import { WATER_BLOCK, WATER_WGSL, WATER_TEXTURES } from '../wgsl/water.wgsl.js';
import { WATER_COMPOSITE_BLOCK, WATER_COMPOSITE_WGSL, WATER_COMPOSITE_TEXTURES } from '../wgsl/waterComposite.wgsl.js';
import { WaterLayer, WATER_VERTEX_LAYOUT, WATER_VERTEX_STRIDE_BYTES, WATER_CLEAR_X } from '../waterLayer.js';
import { selectWater, createWaterSelection, RUNS_STRIDE } from '../../water.js';
import { WATER_U_STRIDE, U_KIND, U_Z, U_AABB, U_SHAPE, U_SLOT } from '../../../mesh/waterMesh.js';
import {
  WL_STRIDE, WL_SLOTS, WFOG_LEN, RIPPLE_SLOTS, DEFAULT_RIPPLE_GLYPH, DEFAULT_RIPPLE_GAIN,
  defaultWaterLooks, resolveWaterLooks, fillWaterSlotTable, waterFogParams,
} from '../../waterLook.js';
import { sunFromWorld } from '../../lighting.js';
import { PROJ_HFOV_DEG } from '../../projection.js';

const WF = (n) => WATER_BLOCK.field(n).word;
const W_MVP = WF('mvp'), W_AABB = WF('aabb'), W_SHAPE = WF('shape'), W_Z = WF('z'), W_KIND = WF('kind'), W_SLOT = WF('slot');
const CF = (n) => WATER_COMPOSITE_BLOCK.field(n).word;
const C_COLS = CF('gridCols'), C_ROWS = CF('gridRows'), C_SUNMAP = CF('sunMapOn'), C_PROJ = CF('projMode'), C_SUNDIR = CF('sunDir');
const C_AMB = CF('ambientI'), C_SUNI = CF('sunI'), C_POSX = CF('posX'), C_POSY = CF('posY'), C_EYEH = CF('eyeH'), C_DIRX = CF('dirX'), C_DIRY = CF('dirY');
const C_PLANEX = CF('planeX'), C_PLANEY = CF('planeY'), C_HORIZON = CF('horizonRow'), C_PLANEDY = CF('planeDistY'), C_TIME = CF('timeSec');
const C_PA = CF('pitchA'), C_PB = CF('pitchB'), C_PC = CF('pitchC'), C_WL = CF('wl'), C_WFOG = CF('wfog');
// S8-B2-13b (38.14, the note of record): splash ripples. `rippleCount` (i32), the global `rippleGlyph`/`rippleGain`
// uniform (fb overrides, else waterLook.js defaults), and `ripple` (8 x vec4: x, y, age, amp per live ring).
const C_RIPPLE_COUNT = CF('rippleCount'), C_RIPPLE_GLYPH = CF('rippleGlyph'), C_RIPPLE_GAIN = CF('rippleGain'), C_RIPPLE = CF('ripple');

export class WgWaterPass {
  /** @param {any} device */
  constructor(device) {
    this.device = device;
    this.cols = 0; this.rows = 0;
    this.active = false;
    this.stats = { waterSlots: 0, waterDraws: 0 };
    this.layer = new WaterLayer(device);
    this.sel = createWaterSelection();
    this.looks = defaultWaterLooks();
    this.wlTable = new Float32Array(WL_SLOTS * WL_STRIDE);
    this.wfog = new Float32Array(WFOG_LEN);
    this.waterOS = new Float32Array(WL_SLOTS * 2);
    this.sunScratch = { dirX: 0, dirY: 0, dirZ: 1, ambientI: 0, sunI: 0 };
    this.cam = { posX: 0, posY: 0, eyeH: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, horizonRow: 0, planeDistY: 0 };
    this.wu = new Float32Array(WATER_BLOCK.sizeWords); this.wi = new Int32Array(this.wu.buffer); this.wb = new Uint32Array(this.wu.buffer);
    this.cu = new Float32Array(WATER_COMPOSITE_BLOCK.sizeWords); this.ci = new Int32Array(this.cu.buffer);
    this._rip32 = new Float32Array(RIPPLE_SLOTS * 4); // S8-B2-13b (38.14): packInto scratch, allocated once
    this.view = null; // the raster pass's f64 viewProj (set by prepare)
    this.clearOpts = { clear: { color: [[WATER_CLEAR_X, 0, 0, 0]], depth: 1 } };
    this.waterTex = [{ slot: 0, texture: null }];
    this.waterBind = { uniforms: this.wu, textures: this.waterTex, vertexBuffer: null, indexBuffer: null };
    this.compTex = [0, 1, 2, 3, 4, 5].map((slot) => ({ slot, texture: null }));
    this.compBind = { uniforms: this.cu, textures: this.compTex };
    this.dummy = null; this.waterPipe = null; this.compPipe = null; this.clip = null; this._bound = null;
    try {
      this.waterPipe = device.createPipeline({
        vertex: { src: { wgsl: WATER_WGSL }, layout: WATER_VERTEX_LAYOUT, strideBytes: WATER_VERTEX_STRIDE_BYTES },
        fragment: { src: { wgsl: WATER_WGSL }, targets: 1 },
        bindings: { uniformBytes: WATER_BLOCK.sizeBytes, textures: WATER_TEXTURES.slice() },
        targetFormats: ['rgba32ui'], depthFormat: 'depth24', depth: { test: true, write: true }, cull: 'none', frontFace: 'cw',
      });
      this.compPipe = device.createPipeline({
        vertex: { src: { wgsl: WATER_COMPOSITE_WGSL } }, fragment: { src: { wgsl: WATER_COMPOSITE_WGSL }, targets: 2 },
        bindings: { uniformBytes: WATER_COMPOSITE_BLOCK.sizeBytes, textures: WATER_COMPOSITE_TEXTURES.slice() },
        targetFormats: ['rgba8', 'rgba8'], cull: 'none',
      });
      this.dummy = device.createTexture({ format: 'rgba32ui', width: 1, height: 1 });
      this.clip = this.layer.clipmap(); // static buffers, uploaded once
    } catch (e) { this.dispose(); throw e; }
  }

  /** Targets for a grid; the water layer is cell resolution so `rays` is accepted for API symmetry only. */
  resize(cols, rows, _rays) {
    if (cols === this.cols && rows === this.rows && this.layer.target) return;
    this.cols = cols; this.rows = rows;
    this.layer.resize(cols, rows);
  }

  /** Sheet (waterfall) buffers belong to one world: prewarm them here so frames upload nothing. */
  bindWorld(world) {
    if (this._bound === world) return;
    this.layer.bindWorld(world);
    this._bound = world;
    const falls = world && world.waterfalls;
    for (let i = 0; falls && i < falls.length; i++) this.layer.sheet(falls[i].mesh);
  }

  /** = setWaterLooks: the designer table resolved to numbers once (absent -> engine defaults). */
  setLooks(table) { this.looks = table ? resolveWaterLooks(table) : defaultWaterLooks(); }

  /** Edge-pass texture for the WATER slot: the layer when water drew this frame, else the 1x1 dummy. */
  get edgeWaterTexture() { return this.active ? this.layer.texture : this.dummy; }
  get edgeFg() { return this.layer.compFg; }
  get edgeBg() { return this.layer.compBg; }
  get texture() { return this.layer.texture; }

  /**
   * Selection + per-slot look/fog tables (GL _prepRaster tail). @param {any} p WgCellPipeline @param {any} raster its WgRasterPass (prepared this frame)
   * @returns {boolean} water active this frame
   */
  prepare(p, raster) {
    const world = p._world, sel = this.sel;
    this.view = raster.view;
    selectWater(world, p._cam, raster.planes, sel);
    this.active = (sel.count + sel.sheetCount) > 0 && !!this.layer.target;
    this.stats.waterSlots = sel.count + sel.sheetCount;
    if (this.active) {
      const t = this.wlTable, os = this.waterOS;
      fillWaterSlotTable(sel, world, this.looks, t, (p._fb && p._fb.timeSec) || 0);
      waterFogParams(p._table, p._palette, !!world.terrain, this.wfog);
      for (let s = 0; s < WL_SLOTS; s++) { os[s * 2] = t[s * WL_STRIDE + 3]; os[s * 2 + 1] = t[s * WL_STRIDE + 7]; }
    } else this.stats.waterDraws = 0;
    return this.active;
  }

  /** The clipmap draws into the WATER target (GL _passWater). @param {any} sceneDepth r32uint resolved depth texture */
  runWater(sceneDepth) {
    if (!this.active) return;
    const d = this.device, sel = this.sel, layer = this.layer, u = sel.u, wu = this.wu, wi = this.wi, wb = this.wb, M = this.view;
    this.waterTex[0].texture = sceneDepth;
    const ox = sel.O[0], oy = sel.O[1];
    for (let k = 0; k < 12; k++) wu[W_MVP + k] = M[k];
    for (let k = 0; k < 4; k++) wu[W_MVP + 12 + k] = M[k] * ox + M[4 + k] * oy + M[12 + k]; // viewProj * T(O, 0), f64 -> f32
    const bd = this.waterBind;
    let draws = 0;
    d.beginPass(layer.target, this.clearOpts);
    try {
      for (let s = 0; s < sel.count; s++) {
        const b = s * WATER_U_STRIDE, ro = s * RUNS_STRIDE;
        for (let k = 0; k < 4; k++) { wu[W_AABB + k] = u[b + U_AABB + k]; wu[W_SHAPE + k] = u[b + U_SHAPE + k]; }
        wu[W_Z] = u[b + U_Z]; wi[W_KIND] = u[b + U_KIND]; wb[W_SLOT] = u[b + U_SLOT];
        bd.vertexBuffer = this.clip.vertexBuffer; bd.indexBuffer = this.clip.indexBuffer;
        d.bind(this.waterPipe, bd);
        for (let r = 0; r < sel.runs[ro]; r++) { d.draw(sel.runs[ro + 2 + r * 2], sel.runs[ro + 1 + r * 2], 1); draws++; }
      }
      for (let k = 0; k < sel.sheetCount; k++) {
        const slot = 8 + k, fall = sel.sheets[slot], buffers = layer.sheet(fall.mesh), b = slot * WATER_U_STRIDE;
        wi[W_KIND] = 2; wu[W_SHAPE] = u[b + U_SHAPE]; wu[W_SHAPE + 1] = u[b + U_SHAPE + 1]; wu[W_SHAPE + 2] = 0; wu[W_SHAPE + 3] = 0;
        wb[W_SLOT] = slot;
        bd.vertexBuffer = buffers.vertexBuffer; bd.indexBuffer = buffers.indexBuffer;
        d.bind(this.waterPipe, bd);
        d.draw(fall.mesh.index.length, 0, 1); draws++;
      }
    } finally { d.endPass(); }
    this.stats.waterDraws = draws;
  }

  _camBasis(cam, cols, rows, rt) {
    const tanHalfHFov = Math.tan(PROJ_HFOV_DEG * Math.PI / 180 / 2);
    const yawRad = cam.yawDeg * Math.PI / 180;
    const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
    const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
    const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
    const cb = this.cam;
    cb.posX = cam.x; cb.posY = cam.y; cb.eyeH = cam.z; cb.dirX = dirX; cb.dirY = dirY;
    cb.planeX = -dirY * tanHalfHFov; cb.planeY = dirX * tanHalfHFov;
    cb.horizonRow = rows / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY; cb.planeDistY = planeDistY;
    return cb;
  }

  /**
   * Composite the WATER layer onto the shade output (GL _passWaterComposite). Cells without water are copied.
   * @param {{shadeFg:any, shadeBg:any, gi:any, depth:any, light:any, shadowActive?: boolean}} inp @param {any} p WgCellPipeline
   */
  runComposite(inp, p) {
    if (!this.active) return;
    const d = this.device, cu = this.cu, ci = this.ci, cb = this._camBasis(p._cam, p.cols, p.rows, p.rt || {});
    const sun = sunFromWorld(p._world, p._palette, this.sunScratch);
    const light = p._light, rp = p._rasterPass, pitched = !!(rp && rp.pitched);
    ci[C_COLS] = p.cols; ci[C_ROWS] = p.rows;
    ci[C_SUNMAP] = inp.shadowActive && light && light.sun && light.sun.on ? 1 : 0;
    ci[C_PROJ] = pitched ? 1 : 0;
    cu[C_SUNDIR] = sun.dirX; cu[C_SUNDIR + 1] = sun.dirY; cu[C_SUNDIR + 2] = sun.dirZ;
    cu[C_AMB] = sun.ambientI; cu[C_SUNI] = sun.sunI;
    cu[C_POSX] = cb.posX; cu[C_POSY] = cb.posY; cu[C_EYEH] = cb.eyeH; cu[C_DIRX] = cb.dirX; cu[C_DIRY] = cb.dirY;
    cu[C_PLANEX] = cb.planeX; cu[C_PLANEY] = cb.planeY; cu[C_HORIZON] = cb.horizonRow; cu[C_PLANEDY] = cb.planeDistY;
    const fb = p._fb, timeSec = (fb && fb.timeSec) || 0;
    cu[C_TIME] = timeSec;
    if (pitched) {
      const q = rp.pitch;
      cu[C_PA] = q.fX; cu[C_PA + 1] = q.fY; cu[C_PA + 2] = q.fZ; cu[C_PA + 3] = q.tanHalfX;
      cu[C_PB] = q.rX; cu[C_PB + 1] = q.rY; cu[C_PB + 2] = q.uX; cu[C_PB + 3] = q.uY;
      cu[C_PC] = q.uZ; cu[C_PC + 1] = q.tanHalfY; cu[C_PC + 2] = q.cosP; cu[C_PC + 3] = q.sinP;
    }
    cu.set(this.wlTable, C_WL); cu.set(this.wfog, C_WFOG);
    // S8-B2-13b (38.14, the note of record): splash ripples, zero-alloc (this._rip32 preallocated on construct).
    // fb.ripples is duck-typed {packInto} (engine/fx/ripples.js); absent = 0 rings. 0 rings: only rippleCount
    // changes - the `ripple` words are never read past rippleCount (shader's early break), so leave them untouched.
    const ripN = fb && fb.ripples ? fb.ripples.packInto(timeSec, this._rip32) : 0;
    ci[C_RIPPLE_COUNT] = ripN;
    if (ripN > 0) cu.set(this._rip32, C_RIPPLE);
    ci[C_RIPPLE_GLYPH] = (fb && fb.rippleGlyph != null) ? fb.rippleGlyph : DEFAULT_RIPPLE_GLYPH;
    cu[C_RIPPLE_GAIN] = (fb && fb.rippleGain != null) ? fb.rippleGain : DEFAULT_RIPPLE_GAIN;
    const tx = this.compTex;
    tx[0].texture = inp.shadeFg; tx[1].texture = inp.shadeBg; tx[2].texture = inp.gi; tx[3].texture = inp.depth;
    tx[4].texture = this.layer.texture; tx[5].texture = inp.light;
    d.beginPass(this.layer.compTarget);
    d.bind(this.compPipe, this.compBind);
    d.draw(3, 0, 1);
    d.endPass();
  }

  /** gpucompare: WATER target (rgba32uint, cols x rows x 4 words); null when no water drew this frame. @param {Uint32Array} [out] */
  async readbackWater(out) {
    if (!this.active || !this.layer.texture) return null;
    const n = this.cols * this.rows;
    const buf = out && out.length === 4 * n ? out : (this._rb && this._rb.length === 4 * n ? this._rb : (this._rb = new Uint32Array(4 * n)));
    await this.device.readback(this.layer.texture, { x: 0, y: 0, w: this.cols, h: this.rows }, buf);
    return buf;
  }

  dispose() {
    const d = this.device;
    this.layer.dispose();
    for (const k of ['waterPipe', 'compPipe', 'dummy']) if (this[k]) { try { d.dispose(this[k]); } catch (_) { /* best effort */ } this[k] = null; }
    this.active = false; this._bound = null;
  }
}
