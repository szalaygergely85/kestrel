// @ts-check
// engine/render/gpu/wg/WgCardPass.js - R6c part 2 (D-075 step 5, docs/architecture.md 38.60; arch spec 2026-10-13c). Host side of the tree card impostors.
// Per opted-in species (a GPU-cull group with `imp` + `impM > 0`): `cs_card` (impostor.wgsl.js) appends the far trees (d >= impM) to a card bucket
// (STORAGE, sized g.ib.capacity) and bumps ONE non-indexed args record {vertexCount 6, instanceCount, 0, 0} in passCull's args buffer; the card
// render pipeline draws it with `drawIndirect` after the instanced mesh draws. The mesh-side half (no mesh copy at d >= impM + 8, band bits) lives in cull.wgsl.js.
// Frame order (passRaster): ensure() -> cull.run() -> dispatch() [compute, in the cull span] -> raster pass: meshes -> cull draws -> draw() -> HZB build.
// Shadows never see cards. Off (no species / limit guard) = nothing here runs and the cull output is byte-identical to before (impM word stays 0).
import { IMP_BLOCK, IMP_CULL_WGSL, IMP_CULL_BUFFERS, IMP_CARD_WGSL, IMP_CARD_WORKGROUP } from '../wgsl/impostor.wgsl.js';
import { RASTER_FLAG_VAO } from '../wgsl/raster.wgsl.js';
import { INSTANCE_BYTES } from '../../../mesh/instances.js';

export const CARD_ATLAS_MAX_BYTES = 2 * 1024 * 1024; // one read-only storage buffer for every species' bake
export const MAX_CARD_SPECIES = 64;                   // = DrawList MAX_DRAW_CARDS
export const CARD_IDLE_FRAMES = 600;
export const CARD_POOL_PER_SPECIES = 4;              // R6e: dropped dst buffers kept per bake for re-created groups
const ARGS_WORDS = 5, ARGS_BYTES = 20;                // passCull's record size; the non-indexed draw reads the first 4 words
const F = (n) => IMP_BLOCK.field(n).word;
const PLANES = F('planes'), EYE = F('eye'), PARAMS = F('params'), IMP = F('imp'), VP = F('vp'), VIEW = F('view'), COUNT = F('count'), SLOT = F('slot'),
  SWAYPAD = F('swayPad'), ATLAS_BASE = F('atlasBase'), FLAGS = F('flags'), DEPTH_TIER = F('depthTier');

export class WgCardPass {
  /** @param {any} device @param {any} cull the WgCullPass (args buffer + slot allocator + per-batch src buffers) */
  constructor(device, cull) {
    this.device = device; this.cull = cull; this.on = false;
    this.species = new Map(); this.active = new Array(MAX_CARD_SPECIES).fill(null); this.nActive = 0;
    this.atlas = null; this.atlasUsed = 0; this.ranges = new Map(); this._frame = 0; this._stale = null; this._warned = false;
    this.cpipe = null; this.rpipe = null;
    this._free = new Int32Array(MAX_CARD_SPECIES); this._freeTop = 0;
    this.pool = new Map(); // R6e: bake bytes -> [{dst, slot, cap}] of dropped species, reused by re-created groups of the same species (destroyed in dispose())
    this._sweepFn = (sp, g) => { if (this._frame - sp.last > CARD_IDLE_FRAMES) (this._stale || (this._stale = [])).push(g); };
    const lim = device.caps && device.caps.maxStorageBuffersInVertexStage;
    if ((lim === undefined || lim === null ? 8 : lim) < 1) { this._log('maxStorageBuffersInVertexStage < 1: card impostors off (trees keep the mesh cut)'); return; }
    if (typeof device.createComputePipeline !== 'function' || typeof device.drawIndirect !== 'function') return;
    try {
      this.cpipe = device.createComputePipeline({ src: { wgsl: IMP_CULL_WGSL, entry: 'cs_card' }, bindings: { uniformBytes: IMP_BLOCK.sizeBytes, buffers: [...IMP_CULL_BUFFERS] } });
      // same state as passRaster's instanced pipes: 3 colour targets, depth24, depth test + write (the fragment writes frag_depth), no back-face cull
      this.rpipe = device.createPipeline({ vertex: { src: { wgsl: IMP_CARD_WGSL }, layout: [], strideBytes: 0 }, fragment: { src: { wgsl: IMP_CARD_WGSL }, targets: 3 },
        bindings: { uniformBytes: IMP_BLOCK.sizeBytes, textures: [], buffers: ['read', 'read'] },
        targetFormats: ['rgba32ui', 'rgba32ui', 'r32ui'], depthFormat: 'depth24', depth: { test: true, write: true }, cull: 'none', frontFace: 'cw' });
      this.on = true;
    } catch (e) { this._log('pipeline creation failed (' + (e && e.message) + '): card impostors off'); }
  }

  _log(msg) { if (!this._warned) { this._warned = true; if (typeof console !== 'undefined') console.warn('WgCardPass: ' + msg); } }

  /** Registers (once) / refreshes a species for GPU-cull group `g`; sets `g._cardOk` (read by passCull before it writes CullU.impM). Call before cull.run(). */
  ensure(g) {
    if (!this.on || !g.imp || !(g.impM > 0)) { g._cardOk = false; return null; }
    let sp = this.species.get(g);
    if (!sp) sp = this._create(g);
    if (!sp || sp.skip) { g._cardOk = false; return null; }
    if (sp.bytes !== g.imp.bytes) this._upload(sp, g.imp); // version check: a re-bake swaps the bytes object
    sp.last = this._frame; g._cardOk = true;
    return sp;
  }

  _create(g) {
    const bytes = g.imp.bytes, n = bytes ? bytes.byteLength : 0;
    const sp = { g, skip: false, last: this._frame, bytes: null, base: 0, baseBytes: 0, slot: -1, dst: null, ub: new ArrayBuffer(IMP_BLOCK.sizeBytes), uf: null, uu: null,
      cbind: null, sto: null, rbind: null };
    this.species.set(g, sp);
    if (!this._range(bytes)) { sp.skip = true; this._log('species skipped (atlas ' + (this.atlasUsed + n) + ' B > ' + CARD_ATLAS_MAX_BYTES + ' B, or bad size)'); return sp; }
    const pl = this.pool.get(bytes); let pe = null;
    if (pl) for (let i = pl.length - 1; i >= 0; i--) if (pl[i].cap >= g.ib.capacity) { pe = pl[i]; pl[i] = pl[pl.length - 1]; pl.pop(); break; }
    if (pe) { sp.slot = pe.slot; sp.dst = pe.dst; sp.cap = pe.cap; } else {
      try {
        if (this._freeTop > 0) sp.slot = this._free[--this._freeTop]; else sp.slot = this.cull._allocSlots(1);
      } catch (e) { sp.skip = true; this._log('args slot capacity exceeded: species skipped'); return sp; }
    }
    if (!this.atlas) this.atlas = this.device.createBuffer({ usage: 'storage', bytes: CARD_ATLAS_MAX_BYTES });
    this.cull.argsCpu[sp.slot * ARGS_WORDS] = 6; // vertexCount; instanceCount is zeroed by the existing per-frame args write
    if (!sp.dst) { sp.dst = this.device.createBuffer({ usage: 'storage', bytes: g.ib.capacity * INSTANCE_BYTES }); sp.cap = g.ib.capacity; }
    const v = IMP_BLOCK.createViews(sp.ub); sp.uf = v.f32; sp.uu = v.u32;
    sp.cbind = { buffers: [{ slot: 0, buffer: null }, { slot: 1, buffer: sp.dst }, { slot: 2, buffer: this.cull.argsBuffer }], uniforms: sp.uf };
    sp.sto = [{ slot: 0, buffer: sp.dst }, { slot: 1, buffer: this.atlas }];
    sp.rbind = { uniforms: sp.uf, vertexBuffer: null, indexBuffer: null, instanceBuffer: null, storageBuffers: sp.sto };
    this._upload(sp, g.imp);
    return sp;
  }

  /** One atlas range per bake (keyed by the bytes object): a re-created group reuses it; a re-bake gets its own. null = bad size / over the cap. */
  _range(bytes) {
    let r = this.ranges.get(bytes);
    if (r) return r;
    const n = bytes ? bytes.byteLength : 0;
    if (!n || n % 4 || this.atlasUsed + n > CARD_ATLAS_MAX_BYTES) return null;
    r = { base: this.atlasUsed >> 2, baseBytes: this.atlasUsed, bytes: n, written: false };
    this.atlasUsed += n; this.ranges.set(bytes, r);
    return r;
  }

  _upload(sp, imp) {
    const r = this._range(imp.bytes);
    sp.bytes = imp.bytes; // always: a skipped re-bake must not retry every frame
    if (!r) { this._log('re-bake skipped (atlas ' + this.atlasUsed + ' B used, cap ' + CARD_ATLAS_MAX_BYTES + ' B): keeping the old range'); return; }
    if (!r.written) { this.device.writeBuffer(this.atlas, imp.bytes, r.baseBytes, r.bytes); r.written = true; }
    sp.baseBytes = r.baseBytes; sp.base = r.base;
  }

  /**
   * After cull.run(), outside any pass: one cs_card dispatch per species. `fr` = { w, h (raster samples = cols * n, rows * n), ox, oy (render origin), viewRel (f32
   * camera-relative viewProj), vaoOn }. @param {any[]} groups @param {number} n @param {{w: number, h: number, ox: number, oy: number, viewRel: Float32Array, vaoOn: boolean}} fr
   */
  dispatch(groups, n, fr) {
    this.nActive = 0; this._frame++;
    if (!this.on) return;
    const cull = this.cull, cf = cull.frame;
    for (let i = 0; i < n; i++) {
      const g = groups[i], sp = g._cardOk ? this.species.get(g) : null;
      if (!sp) continue;
      const b = cull.batches.get(g);
      if (!b || g.count <= 0) continue;
      const cnt = g.count > b.cap ? b.cap : g.count, f = sp.uf, u = sp.uu;
      if (cf.planes) { for (let k = 0; k < 24; k++) f[PLANES + k] = cf.planes[k]; } else { for (let k = 0; k < 6; k++) { const o = PLANES + k * 4; f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 1; } }
      const eye = cf.eye, md = g.maxDistM > 0 ? g.maxDistM : cf.maxDistM; // same cut as the mesh copy (OB-089)
      f[EYE] = eye ? eye.x : 0; f[EYE + 1] = eye ? eye.y : 0; f[EYE + 2] = eye ? eye.z : 0; f[EYE + 3] = eye && md > 0 ? md * md : 0;
      f[PARAMS] = g._R || 0; f[PARAMS + 1] = 0; f[PARAMS + 2] = 0; f[PARAMS + 3] = 0;
      f[IMP] = g.impM; f[IMP + 1] = g.imp.radius; f[IMP + 2] = g.imp.vMin; f[IMP + 3] = g.imp.vMax;
      for (let k = 0; k < 16; k++) f[VP + k] = fr.viewRel[k];
      f[VIEW] = fr.w; f[VIEW + 1] = fr.h; f[VIEW + 2] = fr.ox; f[VIEW + 3] = fr.oy;
      u[COUNT] = cnt; u[SLOT] = sp.slot * ARGS_WORDS; f[SWAYPAD] = 0; u[ATLAS_BASE] = sp.base; u[FLAGS] = fr.vaoOn ? RASTER_FLAG_VAO : 0; u[DEPTH_TIER] = 1;
      sp.cbind.buffers[0].buffer = b.src;
      this.device.dispatch(this.cpipe, sp.cbind, Math.ceil(cnt / IMP_CARD_WORKGROUP), 1, 1);
      this.active[this.nActive++] = sp;
    }
    this._stale = null; this.species.forEach(this._sweepFn);
    const st = this._stale;
    if (st) { this._stale = null; for (const g of st) this._drop(g); }
  }

  _drop(g) {
    const sp = this.species.get(g); if (!sp) return;
    this.species.delete(g); g._cardOk = false;
    if (sp.slot >= 0) this.cull.argsCpu[sp.slot * ARGS_WORDS + 1] = 0;
    const key = sp.bytes; let pl = key ? this.pool.get(key) : null;
    if (sp.dst && key && (!pl || pl.length < CARD_POOL_PER_SPECIES)) { // keep dst + args slot for the next group of this species
      if (!pl) this.pool.set(key, pl = []);
      pl.push({ dst: sp.dst, slot: sp.slot, cap: sp.cap });
    } else {
      if (sp.dst) this.device.dispose(sp.dst);
      if (sp.slot >= 0 && this._freeTop < MAX_CARD_SPECIES) this._free[this._freeTop++] = sp.slot;
    }
    // the atlas range stays in `ranges` (keyed by its bake): a re-created group reuses it, so churn does not grow the atlas
  }

  /** Inside the raster pass, after the instanced mesh draws and before the view-model depth clear. @returns {number} draws */
  draw() {
    if (!this.on) return 0;
    for (let i = 0; i < this.nActive; i++) {
      const sp = this.active[i];
      this.device.bind(this.rpipe, sp.rbind);
      this.device.drawIndirect(this.cull.argsBuffer, sp.slot * ARGS_BYTES);
    }
    return this.nActive;
  }

  dispose() {
    for (const g of [...this.species.keys()]) this._drop(g);
    this.pool.forEach((pl) => { for (const e of pl) this.device.dispose(e.dst); }); this.pool.clear();
    if (this.atlas) this.device.dispose(this.atlas);
    if (this.cpipe) this.device.dispose(this.cpipe);
    if (this.rpipe) this.device.dispose(this.rpipe);
    this.on = false;
  }
}
