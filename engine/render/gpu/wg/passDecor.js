// @ts-check
// engine/render/gpu/wg/passDecor.js - ENV-01d (docs/architecture.md 38.62): host of the GPU decor scatter (decor.wgsl.js, twin: engine/mesh/decorScatter.js).
// Per frame (inside the cull span, B1 wiring in passRaster._cullRun):
//   cull.begin(..); cull.add(..) ...; decor.queue();  cull.run();  decor.run(fr, p)
//   queue(): addGenerated per layer (stamps the batches, fills args once). run(): ONE compute dispatch per layer over the side x side lattice around the eye;
//   the kernel appends rows into the layer's slab and bumps the args slots (zeroed by cull.run()'s single args write). Raster draws `decor.entries` like cull entries
//   (`decor.on`; entry.instanceOffset = byte offset into the slab, device.bind desc.instanceOffset).
// Host data (all supplied by the caller, engine never reads design/): configure({packed, layers:[{species:[{meshes:[m0,m1|null], parts, group?}], fadeCm:Int32Array}],
//   carpetRadiusM, objectId, radiusM}); setMasks(bundle.decor, version) uploads the baked mask bytes ONLY when `version` (band key) changes;
//   setNear(nearH {data,w,h,x0,y0,cell}, version) uploads the r32f near-band height ONLY when `version` changes. run(fr): fr = {eye:{x,y} (m), planes:Float64Array(24), swayPad}.
// 0 allocation per frame after warm-up (preallocated bind descs / views; uploads happen on version changes only).
import { WG_PASS_SLOT, wgSpanBegin, wgSpanEnd } from '../device/WebGpuTimer.js';
import { DECOR_BLOCK, DECOR_BUFFERS, DECOR_WGSL, DECOR_WORKGROUP } from '../wgsl/decor.wgsl.js';
import { decorSide, layerOff, L_NSPECIES } from '../../../mesh/decorScatter.js';
import { INSTANCE_BYTES } from '../../../mesh/instances.js';

/** 38.62 budget: sum over layers of side^2 x 2 LODs x species = real slab rows (checked at configure, throws naming the layer). */
export const DECOR_MAX_ROWS = 16384;
const W = (n) => DECOR_BLOCK.field(n).word;
const PLANES = W('planes'), PARAMS = W('params'), NEAR_ORG = W('nearOrg'), SWAY = W('swayPad'), EYE_X = W('eyeX'), EYE_Y = W('eyeY'), LAYER = W('layer'), SIDE = W('side'), CAP = W('cap'),
  IX0 = W('ix0'), IY0 = W('iy0'), MW = W('mw'), MH = W('mh'), CARPET = W('carpetCut'), ARGS_BASE = W('argsBase'), OBJ = W('objectId'), NEAR_W = W('nearW'), NEAR_H = W('nearH');

/** @param {any} device @returns {any} the compute pipeline (create once) */
export function createDecorPipeline(device) {
  return device.createComputePipeline({ src: { wgsl: DECOR_WGSL, entry: 'cs_decor' }, bindings: { uniformBytes: DECOR_BLOCK.sizeBytes, buffers: [...DECOR_BUFFERS], textures: ['float'] } });
}

export class WgDecorPass {
  /** @param {any} device @param {import('./passCull.js').WgCullPass} cull the cull pass that owns the args buffer / generated slots (not shadow mode) */
  constructor(device, cull) {
    if (!cull || cull.shadow) throw new Error('WgDecorPass: needs a non-shadow WgCullPass');
    this.device = device; this.cull = cull;
    this.pipeline = createDecorPipeline(device);
    this.on = false;            // draw + dispatch only when configured AND masks AND near are set
    this.packed = null; this.layers = /** @type {any[]} */ ([]); this.cfg = null;
    /** @type {any[][]} entries per layer (index = species*2 + lod); refreshed by queue() */
    this.entries = [];
    this.dw = null; this.nearTex = null; this.near = null; this._nearVer = NaN; this._nearW = 0; this._nearH = 0;
    this._maskVer = NaN; this._masks = null;
    this._ub = new ArrayBuffer(DECOR_BLOCK.sizeBytes); this._uv = DECOR_BLOCK.createViews(this._ub);
    this._bind = { buffers: [{ slot: 0, buffer: null }, { slot: 1, buffer: null }, { slot: 2, buffer: null }, { slot: 3, buffer: null }, { slot: 4, buffer: null }], textures: [{ slot: 0, texture: null }], uniforms: this._uv.f32 };
    this.stats = { dispatches: 0, maskUploads: 0, nearUploads: 0, slabRows: 0, lastThreads: 0 };
  }

  /** Builds per-layer state (call when the content / decorDensity / fov changes, not per frame). Throws naming the layer when the row budget is exceeded. */
  configure(cfg) {
    const d = this.device, packed = cfg.packed;
    if (cfg.layers.length !== packed.nLayers) throw new Error('WgDecorPass.configure: layers.length != packed.nLayers');
    let rows = 0, slab = 0;
    for (let l = 0; l < packed.nLayers; l++) {
      const cap = decorSide(packed, l) ** 2, ns = packed.words[layerOff(l) + L_NSPECIES];
      if (cfg.layers[l].species.length !== ns || cfg.layers[l].fadeCm.length !== ns) throw new Error(`WgDecorPass.configure: layer ${l} species/fadeCm count != packed (${ns})`);
      rows += cap * 2 * ns; slab = rows;
      if (rows > DECOR_MAX_ROWS) throw new Error(`WgDecorPass.configure: layer ${l} exceeds DECOR_MAX_ROWS (${rows} > ${DECOR_MAX_ROWS})`);
      for (const sp of cfg.layers[l].species) for (const m of sp.meshes) if (m && m.maskRanges) throw new Error(`WgDecorPass.configure: layer ${l}: masked meshes are not supported`);
    }
    this.release();
    this.cfg = cfg; this.packed = packed; this.stats.slabRows = slab;
    this.dw = d.createBuffer({ usage: 'storage', data: packed.words });
    for (let l = 0; l < packed.nLayers; l++) {
      const L = cfg.layers[l];
      this.layers.push({ key: { decorLayer: l }, side: decorSide(packed, l), cap: decorSide(packed, l) ** 2, groups: Math.ceil(decorSide(packed, l) ** 2 / DECOR_WORKGROUP) | 0, specs: L.species, dfade: d.createBuffer({ usage: 'storage', data: L.fadeCm }), mask: null, maskBytes: 0, ix0: 0, iy0: 0, w: 0, h: 0 });
      this.entries.push([]);
    }
    this._maskVer = NaN; this._update();
  }

  /** Uploads the baked masks (bundle.decor = {layers:[{mask,ix0,iy0,w,h}]}) when `version` changed; null = no masks (pass off). @param {any} decor @param {number} version */
  setMasks(decor, version) {
    if (!decor || !decor.layers) { this._masks = null; this._update(); return; }
    if (decor === this._masks && version === this._maskVer) return;
    const d = this.device;
    this._masks = decor; this._maskVer = version;
    for (let l = 0; l < this.layers.length && l < decor.layers.length; l++) {
      const L = this.layers[l], m = decor.layers[l], bytes = (m.mask.length + 3) & ~3;
      if (!L.mask || L.maskBytes < bytes) { if (L.mask) d.dispose(L.mask); L.mask = d.createBuffer({ usage: 'storage', bytes }); L.maskBytes = bytes; }
      const pad = new Uint8Array(bytes); pad.set(m.mask); // upload-time only (band change), not per frame
      d.writeBuffer(L.mask, new Uint32Array(pad.buffer), 0);
      L.ix0 = m.ix0; L.iy0 = m.iy0; L.w = m.w; L.h = m.h; this.stats.maskUploads++;
    }
    this._update();
  }

  /** Uploads the near-band height (r32f) when `version` changed; null = off. @param {{data: Float32Array, w: number, h: number, x0: number, y0: number, cell: number}|null} nearH @param {number} version */
  setNear(nearH, version) {
    if (!nearH) { this.near = null; this._update(); return; }
    if (nearH === this.near && version === this._nearVer) return;
    const d = this.device;
    if (!this.nearTex || this._nearW !== nearH.w || this._nearH !== nearH.h) {
      if (this.nearTex) d.dispose(this.nearTex);
      this.nearTex = d.createTexture({ format: 'r32f', width: nearH.w, height: nearH.h }); this._nearW = nearH.w; this._nearH = nearH.h;
    }
    d.writeTexture(this.nearTex, nearH.data, { x: 0, y: 0, w: nearH.w, h: nearH.h }, 0); this.stats.nearUploads++;
    this.near = nearH; this._nearVer = version; this._update();
  }

  _update() {
    let masks = !!this._masks && this.layers.length > 0 && !!this.near;
    for (let l = 0; masks && l < this.layers.length; l++) if (!this.layers[l].mask) masks = false;
    this.on = !!this.cfg && masks;
  }

  /** Between cull.begin() and cull.run(): registers the generated batches (stamp + args fill on change). No-op when off. */
  queue() {
    if (!this.on) return;
    for (let l = 0; l < this.layers.length; l++) this.entries[l] = this.cull.addGenerated(this.layers[l].key, this.layers[l].specs, this.layers[l].cap);
  }

  /** After cull.run() (its args write zeroed every instanceCount), outside any pass: one dispatch per layer. @param {{eye: {x: number, y: number}, planes: Float64Array|null, swayPad?: number}} fr @param {any} [p] timing host */
  run(fr, p = null) {
    const s = this.stats; s.dispatches = 0; s.lastThreads = 0;
    if (!this.on) return;
    const d = this.device, f = this._uv.f32, u = this._uv.u32, i = this._uv.i32, bd = this._bind.buffers, near = /** @type {any} */ (this.near);
    const cfg = this.cfg, planes = fr.planes;
    if (planes) { for (let k = 0; k < 24; k++) f[PLANES + k] = planes[k]; }
    else { for (let k = 0; k < 6; k++) { const o = PLANES + k * 4; f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 1; } } // d = 1 >= 0: nothing outside
    f[PARAMS] = cfg.radiusM; f[PARAMS + 1] = 0; f[PARAMS + 2] = 0; f[PARAMS + 3] = 0;
    f[NEAR_ORG] = near.x0; f[NEAR_ORG + 1] = near.y0; f[NEAR_ORG + 2] = near.cell; f[NEAR_ORG + 3] = 0;
    f[SWAY] = fr.swayPad === undefined ? 0 : fr.swayPad;
    i[EYE_X] = Math.round(fr.eye.x * 100); i[EYE_Y] = Math.round(fr.eye.y * 100); // integer cm: every decision downstream is integer (38.62)
    i[CARPET] = cfg.carpetRadiusM > 0 ? Math.round((cfg.carpetRadiusM + 2) * 100) : 0;
    u[OBJ] = cfg.objectId >>> 0; i[NEAR_W] = near.w; i[NEAR_H] = near.h;
    this._bind.textures[0].texture = this.nearTex; bd[0].buffer = this.dw;
    wgSpanBegin(p, WG_PASS_SLOT.decor);
    try {
      for (let l = 0; l < this.layers.length; l++) {
        const L = this.layers[l], info = this.cull.generatedInfo(L.key);
        if (!info) continue;
        u[LAYER] = l; u[SIDE] = L.side; u[CAP] = L.cap; i[IX0] = L.ix0; i[IY0] = L.iy0; i[MW] = L.w; i[MH] = L.h; u[ARGS_BASE] = info.argsBase;
        bd[1].buffer = L.mask; bd[2].buffer = L.dfade; bd[3].buffer = info.slab; bd[4].buffer = this.cull.argsBuffer;
        d.dispatch(this.pipeline, this._bind, L.groups, 1, 1);
        s.dispatches++; s.lastThreads += L.cap;
      }
    } finally { wgSpanEnd(p); }
  }

  /** Frees the per-layer GPU state (configure() calls it first). */
  release() {
    const d = this.device;
    for (const L of this.layers) { this.cull.removeBatch(L.key); if (L.mask) d.dispose(L.mask); d.dispose(L.dfade); }
    if (this.dw) d.dispose(this.dw);
    this.layers = []; this.entries = []; this.dw = null; this.cfg = null; this.packed = null; this.on = false; this._maskVer = NaN; this._masks = null;
  }

  dispose() {
    this.release();
    if (this.nearTex) this.device.dispose(this.nearTex);
    this.nearTex = null; this.near = null;
    this.device.dispose(this.pipeline);
  }
}

export { INSTANCE_BYTES };
