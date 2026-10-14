// GI-PROBE-05 (arch 38.72 item 4): owns the GPU storage buffer of the baked probe field, shared by the light and shade passes
// (one per device). sync(gi) is cheap and 0-alloc in steady state: a full upload only when the field object / version changes,
// a 128-byte header write only when the mix state changed (mixGIState bumps gi.version, ~1/s). Returns the storage-buffer bind list or null (GI off).
import { packGIField, packGIMix, GI_HDR_WORDS } from '../../giGpu.js';

export class WgGiBuffer {
  constructor(device) {
    this.device = device; this.buf = null; this.bytes = 0; this.field = null; this.fver = -1; this.mixVer = -1;
    this.sto = [{ slot: 0, buffer: null }];
    this.hdr = new Uint32Array(GI_HDR_WORDS); this.hdrF = new Float32Array(this.hdr.buffer);
    this.stats = { fullUploads: 0, headerWrites: 0 };
  }

  /** @param {any} gi LightSet.gi (createGIState) or null @returns {{slot:number,buffer:any}[]|null} */
  sync(gi) {
    if (!gi || !gi.on || !gi.field) return null;
    const f = gi.field, d = this.device;
    if (f !== this.field || f.version !== this.fver) {
      const words = packGIField(f, gi); // alloc only on a field change (band swap), never per frame
      if (!this.buf || this.bytes !== words.byteLength) {
        if (this.buf) d.dispose(this.buf);
        this.buf = d.createBuffer({ usage: 'storage', data: words, dynamic: true }); this.bytes = words.byteLength;
      } else d.writeBuffer(this.buf, words, 0, words.byteLength);
      this.hdr.set(words.subarray(0, GI_HDR_WORDS)); // static header words kept CPU-side so a mix update rewrites the whole 128 B header
      this.sto[0].buffer = this.buf; this.field = f; this.fver = f.version; this.mixVer = gi.version; this.stats.fullUploads++;
      return this.sto;
    }
    if (gi.version !== this.mixVer) {
      packGIMix(gi, this.hdr, this.hdrF);
      d.writeBuffer(this.buf, this.hdr, 0, GI_HDR_WORDS * 4); this.mixVer = gi.version; this.stats.headerWrites++;
    }
    return this.sto;
  }

  dispose() { if (this.buf) { try { this.device.dispose(this.buf); } catch (_) { /* best effort */ } this.buf = null; } this.field = null; }
}

const shared = new WeakMap();
/** One WgGiBuffer per device (light + shade passes share the upload). */
export function giBufferFor(device) { let g = shared.get(device); if (!g) { g = new WgGiBuffer(device); shared.set(device, g); } return g; }
