// engine/content/maskFile.js - ALPHA-01a (docs/architecture.md 37.17): content/masks/<id>.mask.json, an 8-bit alpha mask.
//   {kind:'mask', schema:1, id:'quaternius/Leaves_NormalTree', w:256, h:256, cutoffDefault:0.2, data:'<base64 of w*h bytes>'}
// Pure (no file I/O). The importer writes it (maskToJSON), loadContentPack reads it (maskFromJSON).

export const MASK_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z][A-Za-z0-9_-]*)*$/;
export const MASK_MAX_RES = 1024;

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64decode(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @param {string} id @param {number} w @param {number} h @param {number} cutoffDefault @param {Uint8Array} bytes - w*h alpha bytes, row 0 = image row 0 */
export function maskToJSON(id, w, h, cutoffDefault, bytes) {
  return { kind: 'mask', schema: 1, id, w, h, cutoffDefault, data: b64encode(bytes) };
}

/** Parses + validates a mask file object. Throws Error naming the problem. @returns {{id:string,w:number,h:number,cutoffDefault:number,data:Uint8Array}} */
export function maskFromJSON(obj) {
  if (!obj || obj.kind !== 'mask') throw new Error('not a mask file (kind must be "mask")');
  if (typeof obj.id !== 'string' || !MASK_ID_RE.test(obj.id)) throw new Error(`bad mask id ${JSON.stringify(obj.id)}`);
  for (const k of ['w', 'h']) {
    const v = obj[k];
    if (!Number.isInteger(v) || v < 1 || v > MASK_MAX_RES || (v & (v - 1)) !== 0) throw new Error(`mask ${obj.id}: ${k} ${v} must be a power of two <= ${MASK_MAX_RES}`);
  }
  if (typeof obj.cutoffDefault !== 'number' || !(obj.cutoffDefault > 0 && obj.cutoffDefault < 1)) throw new Error(`mask ${obj.id}: cutoffDefault ${obj.cutoffDefault} must be in (0,1)`);
  if (typeof obj.data !== 'string') throw new Error(`mask ${obj.id}: data must be a base64 string`);
  let data;
  try { data = b64decode(obj.data); } catch (e) { throw new Error(`mask ${obj.id}: data is not valid base64`); }
  if (data.length !== obj.w * obj.h) throw new Error(`mask ${obj.id}: data has ${data.length} bytes, expected w*h = ${obj.w * obj.h}`);
  return { id: obj.id, w: obj.w, h: obj.h, cutoffDefault: obj.cutoffDefault, data };
}

/** Box-average downsample of an alpha plane (f64 sum, Math.round) to dw x dh. Source dims need not be multiples; each cell covers [x*sw/dw, (x+1)*sw/dw) rounded to whole source texels (at least 1). */
export function downsampleAlpha(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[yy * sw + xx];
      out[y * dw + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}
