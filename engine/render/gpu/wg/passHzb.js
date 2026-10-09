// @ts-check
// engine/render/gpu/wg/passHzb.js - S8-B2-10c (docs/architecture.md 38.20): ONE hierarchical-Z build per frame from the raster depth G-buffer.
// Per frame (WgCellPipeline calls it between raster pass A and the cull phase 2, outside any render pass):
//   copy depth texture (r32ui = f32 bits of LINEAR depth, +Inf = sky) -> level-0 staging buffer (rows padded to 256 B)
//   -> hzb.wgsl max-chain, one dispatch per level (dst texel = max of the src texels it covers; level >= 1 dense)
//   -> every level copied into the ONE packed `buffer` the cull kernel reads at binding 5
//      (level 0 with row pitch `pitch` words, then dense levels at off(L+1) = off(L) + pitch_L * h_L - cull.wgsl.js layout).
// Why per-level scratch buffers + copies: WebGPU forbids one buffer being read-only and read_write storage in the same dispatch, so the chain
// reads/writes separate buffers and the packed buffer is only ever a copy destination (then read by the cull dispatches).
// Buffers are created in `resize` only (zero allocation per frame). `valid` is false until the first build and after resize/invalidate();
// the host then runs cull phase 1 with hzbOn 0 (descriptor() returns null).
import { HZB_BLOCK, HZB_BUFFERS, HZB_WGSL, HZB_WORKGROUP } from '../wgsl/hzb.wgsl.js';
import { hzbLevelSizes } from '../../../mesh/hzb.js';

const U = (n) => HZB_BLOCK.field(n).word;

/** @param {any} device @returns {any} the compute pipeline (create once; WebGPU/mock only) */
export function createHzbPipeline(device) {
  return device.createComputePipeline({ src: { wgsl: HZB_WGSL, entry: 'cs_main' }, bindings: { uniformBytes: HZB_BLOCK.sizeBytes, buffers: [...HZB_BUFFERS] } });
}

export class WgHzbPass {
  /** @param {any} device */
  constructor(device) {
    this.device = device;
    this.pipeline = createHzbPipeline(device);
    this.w = 0; this.h = 0; this.pitch = 0; this.levels = 0;
    /** @type {any} packed pyramid read by the cull kernel (binding 5) */ this.buffer = null;
    /** @type {any[]} scratch buffer per level (index 0 = padded copy target, >= 1 dense) */ this._lv = [];
    /** @type {{w: number, h: number}[]} */ this._sizes = [];
    /** @type {number[]} word offset of each level inside `buffer` */ this._off = [];
    this._ub = new ArrayBuffer(HZB_BLOCK.sizeBytes);
    this._uv = HZB_BLOCK.createViews(this._ub);
    this._bind = { buffers: [{ slot: 0, buffer: null }, { slot: 1, buffer: null }], uniforms: this._uv.f32 };
    /** @type {boolean} true after a build and until resize/invalidate */ this.valid = false;
    this._desc = { buffer: /** @type {any} */ (null), w: 0, h: 0, levels: 0, pitch: 0, fwd: /** @type {number[]} */ ([0, 1, 0]), margin: 0.05 };
    this.stats = { builds: 0, dispatches: 0, copies: 0 };
  }

  /** (Re)allocates for a level-0 size of w x h (= the raster target); marks the HZB invalid. No-op when the size is unchanged. @param {number} w @param {number} h */
  resize(w, h) {
    if (w === this.w && h === this.h && this.buffer) return;
    this._release();
    const d = this.device, sizes = hzbLevelSizes(w, h);
    this.w = w; this.h = h; this._sizes = sizes; this.levels = sizes.length;
    this.pitch = ((w * 4 + 255) & ~255) / 4; // 256 B aligned rows (copyTextureToBuffer)
    this._off.length = 0;
    let words = 0;
    for (let L = 0; L < sizes.length; L++) {
      this._off.push(words);
      const rows = sizes[L].h, rowWords = L === 0 ? this.pitch : sizes[L].w;
      words += rowWords * rows;
      this._lv.push(d.createBuffer({ usage: 'storage', bytes: rowWords * rows * 4 }));
    }
    this.buffer = d.createBuffer({ usage: 'storage', bytes: words * 4 });
    this.valid = false;
  }

  /** Marks the pyramid stale: the next frame's cull phase 1 runs with hzbOn 0 (first frame, resize, camera cut / teleport). */
  invalidate() { this.valid = false; }

  /**
   * Phase-1 cull input: the descriptor of the LAST built pyramid, or null when invalid (-> hzbOn 0). Reused object (no allocation).
   * @param {{x: number, y: number, z: number}} fwd unit view forward of THIS frame's camera
   */
  descriptor(fwd) {
    if (!this.valid) return null;
    const o = this._desc;
    o.buffer = this.buffer; o.w = this.w; o.h = this.h; o.levels = this.levels; o.pitch = this.pitch; o.fwd[0] = fwd.x; o.fwd[1] = fwd.y; o.fwd[2] = fwd.z;
    return o;
  }

  /**
   * Builds the pyramid from `depthTex` (w x h r32ui). Must run outside a render pass. Afterwards `valid` is true and `fresh(fwd)` is the
   * descriptor for cull phase 2. @param {any} depthTex
   */
  build(depthTex) {
    if (!this.buffer) throw new Error('WgHzbPass.build: resize() first');
    const d = this.device, f = this._uv.u32, s = this.stats, sz = this._sizes;
    d.copyTextureToBuffer(depthTex, this._lv[0], this.w, this.h, this.pitch * 4); s.copies++;
    d.copyBufferToBuffer(this._lv[0], 0, this.buffer, 0, this.pitch * sz[0].h * 4); s.copies++;
    for (let L = 0; L + 1 < sz.length; L++) {
      f[U('srcW')] = sz[L].w; f[U('srcH')] = sz[L].h; f[U('dstW')] = sz[L + 1].w; f[U('dstH')] = sz[L + 1].h; f[U('srcPitch')] = L === 0 ? this.pitch : 0;
      this._bind.buffers[0].buffer = this._lv[L]; this._bind.buffers[1].buffer = this._lv[L + 1];
      d.dispatch(this.pipeline, this._bind, Math.ceil(sz[L + 1].w / HZB_WORKGROUP), Math.ceil(sz[L + 1].h / HZB_WORKGROUP), 1); s.dispatches++;
      d.copyBufferToBuffer(this._lv[L + 1], 0, this.buffer, this._off[L + 1] * 4, sz[L + 1].w * sz[L + 1].h * 4); s.copies++;
    }
    s.builds++;
    this.valid = true;
  }

  /** Descriptor of the pyramid built THIS frame (cull phase 2 input); same reused object as `descriptor`. @param {{x: number, y: number, z: number}} fwd */
  fresh(fwd) { return this.descriptor(fwd); }

  _release() {
    const d = this.device;
    for (const b of this._lv) d.dispose(b);
    this._lv.length = 0;
    if (this.buffer) d.dispose(this.buffer);
    this.buffer = null; this.w = 0; this.h = 0;
  }

  dispose() { this._release(); this.device.dispose(this.pipeline); }
}
