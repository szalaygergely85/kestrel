// @ts-check
// engine/render/gpu/wg/passCull.js - WG-4a (docs/architecture.md 38.3/38.8). Standalone half: B1 wires it into passRaster / WgCellPipeline.
// GPU instance cull per MESH-INST-01 batch (an InstanceGroup: MeshGroupSet group, InstanceGroups meshGroup/voxel group): the game's instance rows
// (16 words) are the kernel input, frustum + distance cull + LOD pick compact the survivors into one instance buffer per LOD and bump one
// indirect-args slot per (batch, LOD). JS twin / oracle: instances.js compactGroup (+ the distance test, see wgsl/cull.wgsl.js).
//
// Per frame:   cull.begin({ planes, viewProj, rows, eye, maxDistM })      planes = frustumPlanes() Float64Array(24)
//              const e = cull.add(group, [lod0Mesh, lod1Mesh|null]) ...   queue a batch; returns its draw entries (stable objects, up to 2)
//              cull.run()                                                 uploads rows, ONE args write, one dispatch per batch
//              raster pass:  device.bind(instancePipe, { vertexBuffer, indexBuffer, instanceBuffer: e.instanceBuffer, uniforms });
//                            device.drawIndirect(e.argsBuffer, e.argsOffset)         (only entries with `e.active`)
// Entry fields: group, lod, mesh (the resolved draw mesh of that LOD), instanceBuffer (storage|vertex handle, 64 B rows), argsBuffer, argsOffset (bytes),
//               maxInstances, parts (group.parts: partMatrices/flags for the raster uniforms; a DRAW_FLAG_ONE_PART batch has ONE identity part),
//               active (false when the LOD has no mesh). The drawn count is on the GPU only; the CPU never reads it (use readback in tests).
// One draw per entry: ONE_PART batches only (MeshGroupSet groups, meshGroup, single-range voxel units); a multi-range mesh needs one args slot per range
// (kernel fan-out) and throws here. Order of the drawn rows is NOT stable (atomic append); `item.aabb` is the whole group (R around every instance).
// Static batches (rows never change after build: MeshGroupSet groups) upload once with `cull.setStatic(group, true)`; `invalidate(group)` re-uploads.
import { createInstanceBuffer, groupRadius, INSTANCE_BYTES, INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { CULL_BLOCK, CULL_BUFFERS, CULL_WGSL, CULL_WORKGROUP } from '../wgsl/cull.wgsl.js';
import { CULL_SHADOW_BLOCK, CULL_SHADOW_BUFFERS, CULL_SHADOW_WGSL } from '../wgsl/cullShadow.wgsl.js';

export const MAX_CULL_BATCHES = 64;
export const CULL_IDLE_FRAMES = 600; // 38.10a: a batch untouched by add() for this many begin() calls (~10 s at 60 Hz) is swept
const ARGS_WORDS = 5; // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
const ARGS_BYTES = ARGS_WORDS * 4;
const W = (n) => CULL_BLOCK.field(n).word;
const WS = (n) => CULL_SHADOW_BLOCK.field(n).word; // WG-4b shadow mode block
const PLANES = W('planes'), EYE = W('eye'), LODROW = W('lodRow'), PARAMS = W('params'), COUNT = W('count'), LODON = W('lodOn'), SLOT0 = W('slot0'), SLOT1 = W('slot1');
const RANGECOUNT0 = W('rangeCount0'), RANGECOUNT1 = W('rangeCount1'); // ALPHA-01f (d): mesh ranges sharing each LOD's compacted instances
const SWAYPAD = W('swayPad'), SWAYPAD_S = WS('swayPad'); // S8-B2-05/06: metres added to R (SWAY_MAX while foliage sway is on, else 0)

/** @typedef {{group: any, lod: number, mesh: any, instanceBuffer: any, argsBuffer: any, argsOffset: number, maxInstances: number, parts: any, active: boolean, range?: number}} CullEntry */

/** @param {any} device @param {boolean} [shadow] WG-4b shadow-caster kernel (cullShadow.wgsl.js) @returns {any} the compute pipeline (create once; `device.createComputePipeline` is WebGPU/mock only) */
export function createCullPipeline(device, shadow = false) {
  if (shadow) return device.createComputePipeline({ src: { wgsl: CULL_SHADOW_WGSL, entry: 'cs_main' }, bindings: { uniformBytes: CULL_SHADOW_BLOCK.sizeBytes, buffers: [...CULL_SHADOW_BUFFERS] } });
  return device.createComputePipeline({ src: { wgsl: CULL_WGSL, entry: 'cs_main' }, bindings: { uniformBytes: CULL_BLOCK.sizeBytes, buffers: [...CULL_BUFFERS] } });
}

export class WgCullPass {
  /** @param {any} device @param {{maxBatches?: number, shadow?: boolean}} [opts] shadow = WG-4b sun-shadow caster mode (see `begin`/`add`) */
  constructor(device, opts = {}) {
    this.device = device;
    this.shadow = !!opts.shadow;
    this.maxBatches = opts.maxBatches || MAX_CULL_BATCHES;
    this.pipeline = createCullPipeline(device, this.shadow);
    this.argsCpu = new Uint32Array(this.maxBatches * 2 * ARGS_WORDS);
    this.argsBuffer = device.createBuffer({ usage: 'indirect', bytes: this.argsCpu.byteLength });
    /** @type {Map<any, any>} group -> batch state */
    this.batches = new Map();
    this._nextSlot = 0;
    /** @type {Uint32Array} args words of the used slots; rebuilt only when _nextSlot changes (no per-frame subarray, arch 2026-10-08) */
    this._argsView = this.argsCpu.subarray(0, 0);
    /** @type {Set<any>} groups marked static before their first add() */
    this._pendingStatic = new Set();
    /** @type {Int32Array} LIFO free list of freed 2-slot (R=1) bases (38.10a; deterministic, 0 alloc) */
    this._free = new Int32Array(this.maxBatches);
    this._freeTop = 0;
    /** @type {Map<number, number[]>} ALPHA-01f (d): LIFO free lists for R>1 slot BLOCKS (masked multi-range batches), keyed by block size
     *  (2*R); a freed block is only reused by a batch needing the SAME R (a 2-slot pair and a 2R-slot block are never aliased). Rare path. */
    this._freeBig = new Map();
    /** @type {number} bumped once per begin(); drives the idle sweep */
    this._frame = 0;
    const block = this.shadow ? CULL_SHADOW_BLOCK : CULL_BLOCK;
    this._ub = new ArrayBuffer(block.sizeBytes);
    this._uv = block.createViews(this._ub);
    this._bind = { buffers: [{ slot: 0, buffer: null }, { slot: 1, buffer: null }, { slot: 2, buffer: null }, { slot: 3, buffer: null }, { slot: 4, buffer: null }], uniforms: this._uv.f32 };
    /** @type {any[]} batches queued this frame */
    this.queue = [];
    this.frame = { planes: /** @type {Float64Array|null} */ (null), viewProj: /** @type {Float64Array|null} */ (null), rows: 0, eye: /** @type {any} */ (null), maxDistM: 0, castM: 0, hystM: 0 };
    this.stats = { batches: 0, dispatches: 0, instances: 0, uploads: 0, argsBytes: 0 };
  }

  /**
   * @param {{planes: Float64Array|null, viewProj?: Float64Array|null, rows?: number, eye?: {x: number, y: number, z: number}|null, maxDistM?: number}} f
   * planes null = no frustum cull; viewProj + rows enable the LOD pick for groups with `lodCells > 0`; eye + maxDistM > 0 enable the distance cull.
   * Shadow mode (WG-4b): planes = the sun-box planes, eye = camera eye (xy used), `castM` = band 1 radius (instCastM), `hystM` = band hysteresis;
   * the per-batch band-0 radius and group radius come with `add`.
   */
  begin(f) {
    const fr = this.frame;
    this._frame++;
    fr.castM = /** @type {any} */ (f).castM || 0; fr.hystM = /** @type {any} */ (f).hystM || 0;
    fr.planes = f.planes || null; fr.viewProj = f.viewProj || null; fr.rows = f.rows || 0; fr.eye = f.eye || null; fr.maxDistM = f.maxDistM || 0;
    fr.swayPad = /** @type {any} */ (f).swayPad || 0; // S8-B2-05/06
    this.queue.length = 0;
    const s = this.stats; s.batches = 0; s.dispatches = 0; s.instances = 0; s.uploads = 0; s.argsBytes = 0;
    // 38.10a idle sweep: a batch no add() stamped recently (editor/reload churn) is freed, <= maxBatches compares/frame
    let stale = null;
    for (const [g, b] of this.batches) {
      if (this._frame - b.lastFrame > CULL_IDLE_FRAMES) (stale || (stale = [])).push(g);
    }
    if (stale) for (const g of stale) this.removeBatch(g);
  }

  /** Marks a batch as static (rows uploaded once, then only on `invalidate`). @param {any} group @param {boolean} [on] */
  setStatic(group, on = true) { const b = this.batches.get(group); if (b) b.static = on; else if (on) this._pendingStatic.add(group); else this._pendingStatic.delete(group); }
  /** Forces the next frame to re-upload `group`'s rows. @param {any} group */
  invalidate(group) { const b = this.batches.get(group); if (b) b.uploaded = -1; }

  /**
   * Queues one batch for this frame. `meshes[0]` = LOD0 draw mesh, `meshes[1]` = LOD1 draw mesh or null (then the group's `lodCells` is ignored and everything is LOD0).
   * @param {any} group an InstanceGroup (ib rows, count, lodCells, _R, parts)
   * @param {[any, any|null]} meshes resolved draw meshes (MeshDrawCache.get / voxel mesh cache)
   * @param {number} [lod0M] shadow mode: band 0 radius (m); band 1 reaches `castM` @param {number} [R] shadow mode: the group radius the CPU twin uses
   * @returns {CullEntry[]} the batch's two entries (`entries[1].active` false without a LOD1 mesh)
   */
  add(group, meshes, lod0M = 0, R = 0) {
    let b = this.batches.get(group);
    if (!b) b = this._create(group, meshes);
    b.lastFrame = this._frame; // 38.10a: stamps the batch as used this frame (idle-sweep input)
    b.meshes0 = meshes[0]; b.meshes1 = meshes[1] || null; b.lod0M = lod0M; b.R = R; // lod0M / R: shadow mode only
    this._fillEntries(b);
    this.queue.push(b);
    return b.entries;
  }

  /**
   * B1 wiring (WG-4a): can this batch go through the kernel? ONE_PART only - a meshGroup (`g.mesh`, any static range count: drawn as one range),
   * or a voxel unit whose meshes are ONE range covering the whole mesh - and a free batch slot (or `g` is already a batch). Never throws.
   * @param {any} g @param {[any, any|null]|any[]} meshes
   */
  supports(g, meshes) {
    if (!this.batches.has(g) && this.batches.size >= this.maxBatches) return false;
    for (let i = 0; i < 2; i++) {
      const m = meshes[i];
      if (!m) continue;
      if (this.shadow) { // shadow: a meshGroup is ONE_PART (whole mesh as one range, 38.9); a voxel unit needs ONE range
        const r = m.ranges;
        if (!r || r.length < 1 || (!g.mesh && r.length !== 1)) return false;
        continue;
      }
      if (g.mesh) continue;
      const r = m.ranges;
      if (!r || r.length !== 1 || (r[0].start || 0) !== 0 || r[0].count !== m.triCount) return false;
    }
    return true;
  }

  /** @param {any} g @param {[any, any|null]} meshes */
  _create(g, meshes) {
    if (this.batches.size >= this.maxBatches) throw new Error(`WgCullPass: over ${this.maxBatches} batches`);
    if (!g.mesh) { // voxel units stay ONE_PART (supports() already enforces this; _create re-checks since add() can be called directly)
      for (const m of meshes) { if (m && m.ranges && m.ranges.length > 1) throw new Error('WgCullPass: multi-range meshes need an args slot per range (voxel units: ONE_PART batches only)'); }
    }
    let rc = 1; // ALPHA-01f (d): R = widest range count of either LOD mesh (meshGroups only; fixed for this batch's life)
    for (const m of meshes) { if (m && m.maskRanges && m.ranges && m.ranges.length > rc) rc = m.ranges.length; } // unmasked meshGroups stay ONE_PART: one range
    const d = this.device;
    const cap = g.ib.capacity;
    let slot;
    if (rc === 1) {
      if (this._freeTop > 0) slot = this._free[--this._freeTop]; // 38.10a: reuse a freed 2-slot pair (LIFO)
      else slot = this._allocSlots(2);
    } else {
      const key = 2 * rc, big = this._freeBig.get(key);
      if (big && big.length) slot = big.pop(); // reuse a freed block of the SAME size only (never aliased across R)
      else slot = this._allocSlots(key);
    }
    const b = {
      g, cap, slot, rc, static: this._pendingStatic.delete(g), uploaded: -1, view: /** @type {any} */ (null), viewCount: -1, lastFrame: this._frame,
      src: d.createBuffer({ usage: 'storage', bytes: cap * INSTANCE_BYTES }),
      lodPrev: d.createBuffer({ usage: 'storage', data: new Uint32Array(cap) }),
      dst: [d.createBuffer({ usage: 'storage', bytes: cap * INSTANCE_BYTES }), d.createBuffer({ usage: 'storage', bytes: cap * INSTANCE_BYTES })],
      meshes0: null, meshes1: null,
      entries: /** @type {CullEntry[]} */ ([]),
    };
    for (let lod = 0; lod < 2; lod++) {
      for (let r = 0; r < rc; r++) {
        b.entries.push({ group: g, lod, range: r, mesh: null, instanceBuffer: b.dst[lod], argsBuffer: this.argsBuffer, argsOffset: (b.slot + lod * rc + r) * ARGS_BYTES, maxInstances: cap, parts: g.parts, active: false });
      }
    }
    this.batches.set(g, b);
    return b;
  }

  /** Bumps `_nextSlot` by `n` ARGS_WORDS-sized slots, bound by `argsCpu`'s total capacity; rebuilds `_argsView`. @param {number} n @returns {number} the base slot */
  _allocSlots(n) {
    const slot = this._nextSlot, total = slot + n, cap = this.argsCpu.length / ARGS_WORDS;
    if (total > cap) throw new Error(`WgCullPass: args slot capacity exceeded (${total} > ${cap})`);
    this._nextSlot = total;
    this._argsView = this.argsCpu.subarray(0, total * ARGS_WORDS);
    return slot;
  }

  /** args words that never change per frame (indexCount, firstIndex, baseVertex, firstInstance) + the entry mesh/active flags.
   *  ALPHA-01f (d): `b.rc` > 1 (masked meshGroup) writes one record per `mesh.ranges[r]`; `b.rc` === 1 keeps today's single
   *  whole-mesh record (ONE_PART / voxel-one-range shapes), bit-identical. */
  _fillEntries(b) {
    const rc = b.rc;
    for (let lod = 0; lod < 2; lod++) {
      const mesh = lod === 0 ? b.meshes0 : b.meshes1;
      const base = b.slot + lod * rc;
      for (let r = 0; r < rc; r++) {
        const e = b.entries[lod * rc + r];
        e.mesh = mesh; e.active = !!mesh; e.parts = b.g.parts;
        const o = (base + r) * ARGS_WORDS;
        let first = 0;
        if (rc > 1) { // ALPHA-01f (d): masked meshGroup, one record per mesh.ranges[r]
          const rg = mesh && mesh.ranges && mesh.ranges[r];
          this.argsCpu[o] = rg && rg.count > 0 ? rg.count * 3 : 0; first = rg ? (rg.start || 0) * 3 : 0;
          e.active = e.active && this.argsCpu[o] > 0;
        } else if (this.shadow && b.g.mesh) { // meshGroup = DRAW_FLAG_ONE_PART: the whole mesh as one range (instancedRanges, 38.9)
          this.argsCpu[o] = mesh ? mesh.triCount * 3 : 0;
          e.active = e.active && this.argsCpu[o] > 0;
        } else if (this.shadow) { // voxel unit: ONE range (supports()); the shadow caster loop draws it with the identity part
          const r0 = mesh && mesh.ranges && mesh.ranges[0];
          this.argsCpu[o] = r0 && r0.count > 0 ? r0.count * 3 : 0; first = r0 ? (r0.start || 0) * 3 : 0;
          e.active = e.active && this.argsCpu[o] > 0;
        } else this.argsCpu[o] = mesh ? mesh.triCount * 3 : 0; // ONE_PART: the whole mesh as one range (rasterJS _oneRange)
        this.argsCpu[o + 1] = 0; this.argsCpu[o + 2] = first; this.argsCpu[o + 3] = 0; this.argsCpu[o + 4] = 0;
      }
    }
  }

  /** Uploads rows + args (one write) and dispatches the kernel per queued batch. Call outside any render pass, before the raster pass that draws the entries. */
  run() {
    const d = this.device, fr = this.frame, uv = this._uv, f = uv.f32, u = uv.u32, s = this.stats;
    // args: every used slot is rewritten (instanceCount 0 again) with ONE writeBuffer of the used range
    const usedWords = this._nextSlot * ARGS_WORDS;
    if (usedWords > 0) { d.writeBuffer(this.argsBuffer, this._argsView, 0); s.argsBytes = usedWords * 4; }
    const planes = fr.planes;
    for (let q = 0; q < this.queue.length; q++) {
      const b = this.queue[q], g = b.g, n = g.count;
      if (n <= 0) continue;
      const cnt = n > b.cap ? b.cap : n;
      if (!b.static || b.uploaded < 0 || b.uploaded < cnt) {
        if (b.viewCount !== cnt) { b.view = g.ib.u32.subarray(0, cnt * INSTANCE_STRIDE); b.viewCount = cnt; }
        d.writeBuffer(b.src, b.view, 0); b.uploaded = cnt; s.uploads++;
      }
      if (this.shadow) {
        const eye = fr.eye, f = uv.f32, u = uv.u32;
        if (fr.planes) { for (let i = 0; i < 24; i++) f[WS('planes') + i] = fr.planes[i]; }
        else { for (let i = 0; i < 6; i++) { const o = WS('planes') + i * 4; f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 1; } }
        const e = WS('eye'), pa = WS('params');
        f[e] = eye ? eye.x : 0; f[e + 1] = eye ? eye.y : 0; f[e + 2] = b.lod0M; f[e + 3] = fr.castM;
        f[pa] = b.R; f[pa + 1] = fr.hystM; f[pa + 2] = 0; f[pa + 3] = 0;
        u[WS('count')] = cnt; u[WS('slot0')] = b.slot * ARGS_WORDS; u[WS('slot1')] = (b.slot + b.rc) * ARGS_WORDS; u[WS('pad')] = 0;
        u[WS('rangeCount0')] = b.rc; u[WS('rangeCount1')] = b.rc; // ALPHA-01f (d)
        f[SWAYPAD_S] = fr.swayPad; // S8-B2-05/06
        const bd = this._bind.buffers;
        bd[0].buffer = b.src; bd[1].buffer = b.lodPrev; bd[2].buffer = b.dst[0]; bd[3].buffer = b.dst[1]; bd[4].buffer = this.argsBuffer;
        d.dispatch(this.pipeline, this._bind, Math.ceil(cnt / CULL_WORKGROUP), 1, 1);
        s.dispatches++; s.instances += cnt;
        continue;
      }
      let R = g._R;
      if (!(R > 0)) {
        R = b.meshes0 ? groupRadius(b.meshes0, g.parts) : 0;
        if (b.meshes1) { const R1 = groupRadius(b.meshes1, g.parts); if (R1 > R) R = R1; }
        g._R = R;
      }
      // uniform block (f32 view; the u32 fields share its memory)
      if (planes) { for (let i = 0; i < 24; i++) f[PLANES + i] = planes[i]; }
      else { for (let i = 0; i < 6; i++) { const o = PLANES + i * 4; f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 1; } } // d = 1 >= 0: nothing is outside
      const eye = fr.eye, md = fr.maxDistM;
      f[EYE] = eye ? eye.x : 0; f[EYE + 1] = eye ? eye.y : 0; f[EYE + 2] = eye ? eye.z : 0; f[EYE + 3] = eye && md > 0 ? md * md : 0;
      const vp = fr.viewProj;
      const lodOn = g.lodCells > 0 && !!vp && !!b.meshes1;
      if (lodOn && vp) {
        f[LODROW] = vp[3]; f[LODROW + 1] = vp[7]; f[LODROW + 2] = vp[11]; f[LODROW + 3] = vp[15];
        f[PARAMS + 1] = R * Math.sqrt(vp[1] * vp[1] + vp[5] * vp[5] + vp[9] * vp[9]) * fr.rows;
      } else { f[LODROW] = 0; f[LODROW + 1] = 0; f[LODROW + 2] = 0; f[LODROW + 3] = 0; f[PARAMS + 1] = 0; }
      f[PARAMS] = R; f[PARAMS + 2] = g.lodCells * 0.9; f[PARAMS + 3] = g.lodCells * 1.1;
      u[COUNT] = cnt; u[LODON] = lodOn ? 1 : 0; u[SLOT0] = b.slot * ARGS_WORDS; u[SLOT1] = (b.slot + b.rc) * ARGS_WORDS;
      u[RANGECOUNT0] = b.rc; u[RANGECOUNT1] = b.rc; // ALPHA-01f (d): b.rc fixed at _create; 1 = today's single record per LOD (bit-identical)
      f[SWAYPAD] = fr.swayPad; // S8-B2-05/06: metres added to R in the frustum test (cull.wgsl.js aabbOutside)
      const bd = this._bind.buffers;
      bd[0].buffer = b.src; bd[1].buffer = b.lodPrev; bd[2].buffer = b.dst[0]; bd[3].buffer = b.dst[1]; bd[4].buffer = this.argsBuffer;
      d.dispatch(this.pipeline, this._bind, Math.ceil(cnt / CULL_WORKGROUP), 1, 1);
      s.dispatches++; s.instances += cnt;
    }
    s.batches = this.queue.length;
  }

  /** Frees the batch of `group`: disposes its 4 buffers, zeroes its args words (so a stale slot never draws), pushes the
   * slot pair onto the free list for reuse, and drops it from `batches`/`_pendingStatic`. Only between frames (never
   * between `add` and `run`). @param {any} group */
  removeBatch(group) {
    const b = this.batches.get(group);
    if (!b) return;
    this.device.dispose(b.src); this.device.dispose(b.lodPrev); this.device.dispose(b.dst[0]); this.device.dispose(b.dst[1]);
    const rc = b.rc, o = b.slot * ARGS_WORDS, n = 2 * rc * ARGS_WORDS;
    for (let i = 0; i < n; i++) this.argsCpu[o + i] = 0;
    if (rc === 1) this._free[this._freeTop++] = b.slot; // 38.10a fast path, unchanged
    else { // ALPHA-01f (d): return the block to the free list of its OWN size only
      const key = 2 * rc; let big = this._freeBig.get(key);
      if (!big) { big = []; this._freeBig.set(key, big); }
      big.push(b.slot);
    }
    this.batches.delete(group);
    this._pendingStatic.delete(group);
  }

  /** Removes every batch (38.10a): called by `WgCellPipeline.bindInstances` when the bound groups object changes. */
  releaseAll() {
    for (const g of [...this.batches.keys()]) this.removeBatch(g);
  }

  dispose() {
    this.releaseAll();
    this.device.dispose(this.argsBuffer);
    this.device.dispose(this.pipeline);
    this.queue.length = 0;
  }
}

export { createInstanceBuffer };
