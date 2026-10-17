// GS-01b: GPU side of World.structure.carveMask. Packs the carve masks of the (<= MAX_STRUCTS) non-mesh structures into one r8ui texture,
// row-stacked (structure k owns rows [rowOff[k], rowOff[k] + h) at columns [0, w), w x h = its bbox in whole metres, 1 = carve) and writes
// the per-structure vec4 (rowOff, hasMask, 0, 0) into a pass's terrain uniform block. Rebuilt only when the mask list changes (references
// compared; structures place/remove rarely); a frame with an unchanged list allocates and uploads nothing. Structures without a mask carve the
// whole bbox as before (hasMask = 0). Order == the passes' structFoot packing (skip kind 'mesh' / no bbox), shared via `sync`.
import { MAX_STRUCTS } from './WorldTextures.js';

export class StructMaskAtlas {
  /** @param {any} device GpuDevice */
  constructor(device) {
    this.device = device;
    this.tex = device.createTexture({ format: 'r8ui', width: 1, height: 1 });
    this.w = 1; this.h = 1; this.n = -1; this.uploads = 0;
    this.refs = /** @type {(Uint8Array|null)[]} */ (new Array(MAX_STRUCTS).fill(null));
    this.rowOff = new Int32Array(MAX_STRUCTS);
    this._data = new Uint8Array(1);
  }

  /**
   * Refresh from `structs` and write `structMask[k] = (rowOff, hasMask, 0, 0)` at `tu[word + 4k]` for the k used boxes.
   * @param {any[]} structs world.structures @param {Float32Array} tu uniform block words @param {number} word offset of the structMask field
   * @returns {number} boxes used (same count the pass writes into structCount)
   */
  sync(structs, tu, word) {
    let n = 0, dirty = false;
    for (let i = 0; i < structs.length && n < MAX_STRUCTS; i++) {
      const s = structs[i];
      if (s.kind === 'mesh' || !s.bbox) continue;
      const m = s.carveMask || null;
      if (this.refs[n] !== m) dirty = true;
      n++;
    }
    if (n !== this.n) dirty = true;
    if (dirty && this.tex) this._rebuild(structs, n); // after dispose() (tex null) the uniforms are still written, no GPU work
    for (let k = 0; k < n; k++) {
      const o = word + k * 4, has = this.refs[k] !== null;
      tu[o] = this.rowOff[k]; tu[o + 1] = has ? 1 : 0; tu[o + 2] = 0; tu[o + 3] = 0;
    }
    return n;
  }

  _rebuild(structs, n) {
    let W = 1, H = 0;
    for (let i = 0, k = 0; i < structs.length && k < n; i++) {
      const s = structs[i];
      if (s.kind === 'mesh' || !s.bbox) continue;
      const m = s.carveMask || null, w = (s.bbox.x1 - s.bbox.x0) | 0, h = (s.bbox.y1 - s.bbox.y0) | 0;
      if (m && m.length !== w * h) throw new Error(`StructMaskAtlas: carveMask ${m.length} != ${w}x${h}`);
      this.refs[k] = m; this.rowOff[k] = m ? H : 0;
      if (m) { if (w > W) W = w; H += h; }
      k++;
    }
    for (let k = n; k < MAX_STRUCTS; k++) { this.refs[k] = null; this.rowOff[k] = 0; }
    if (H === 0) H = 1;
    if (W !== this.w || H !== this.h) {
      this.device.dispose(this.tex);
      this.tex = this.device.createTexture({ format: 'r8ui', width: W, height: H });
      this.w = W; this.h = H;
    }
    if (this._data.length !== W * H) this._data = new Uint8Array(W * H); else this._data.fill(0);
    for (let i = 0, k = 0; i < structs.length && k < n; i++) {
      const s = structs[i];
      if (s.kind === 'mesh' || !s.bbox) continue;
      const m = this.refs[k];
      if (m) {
        const w = (s.bbox.x1 - s.bbox.x0) | 0, h = (s.bbox.y1 - s.bbox.y0) | 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this._data[(this.rowOff[k] + y) * W + x] = m[y * w + x];
      }
      k++;
    }
    this.device.writeTexture(this.tex, this._data);
    this.n = n; this.uploads++;
  }

  dispose() { if (this.tex) { this.device.dispose(this.tex); this.tex = null; } }
}
