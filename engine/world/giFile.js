// engine/world/giFile.js - GI-PROBE-02b: `.gi.bin` container for one baked GIField (arch 38.72 section 3). Pure, no I/O.
// Layout: 32-byte header | JSON meta (utf8) | base Float32 (w*h) | valid Uint8 (w*h*layers) | data Uint8 (w*h*layers*88).
// Header: "KGIB" | u32 formatVersion | u32 metaLen | u32 payloadLen | 16 bytes = first 16 bytes of the sha256 content hash.
import { GI_CHANNELS } from '../render/giProbe.js';

export const GI_FILE_MAGIC = 'KGIB', GI_FILE_VERSION = 1, GI_HEADER_BYTES = 32;

const hexToBytes = (hex) => { const o = new Uint8Array(16); for (let i = 0; i < 16; i++) o[i] = parseInt(hex.substr(i * 2, 2), 16) || 0; return o; };

/** GIField + {hash (hex sha256), zone, world} -> Uint8Array (deterministic: same input, same bytes). */
export function writeGIFile(f, info) {
  const n = f.w * f.h * f.layers;
  const meta = new TextEncoder().encode(JSON.stringify({ world: info.world || '', zone: info.zone || '', hash: info.hash, x0: f.x0, y0: f.y0,
    cellM: f.cellM, w: f.w, h: f.h, layers: f.layers, layerDz: Array.from(f.layerDz), keyHours: Array.from(f.keyHours),
    scale: Array.from(f.scale), bias: Array.from(f.bias), channels: GI_CHANNELS, version: f.version }));
  const payload = f.w * f.h * 4 + n + n * GI_CHANNELS, out = new Uint8Array(GI_HEADER_BYTES + meta.length + payload), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = GI_FILE_MAGIC.charCodeAt(i);
  dv.setUint32(4, GI_FILE_VERSION, true); dv.setUint32(8, meta.length, true); dv.setUint32(12, payload, true);
  out.set(hexToBytes(info.hash), 16);
  let o = GI_HEADER_BYTES; out.set(meta, o); o += meta.length;
  for (let i = 0; i < f.w * f.h; i++, o += 4) dv.setFloat32(o, f.base[i], true);
  out.set(f.valid, o); o += n; out.set(f.data, o);
  return out;
}

/** Header only: {ok, version, metaLen, payloadLen, hash16 (32 hex chars)} or {ok:false, error}. */
export function readGIHeader(bytes) {
  if (bytes.length < GI_HEADER_BYTES) return { ok: false, error: 'too short' };
  for (let i = 0; i < 4; i++) if (bytes[i] !== GI_FILE_MAGIC.charCodeAt(i)) return { ok: false, error: 'bad magic' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hash16 = ''; for (let i = 16; i < 32; i++) hash16 += bytes[i].toString(16).padStart(2, '0');
  return { ok: true, version: dv.getUint32(4, true), metaLen: dv.getUint32(8, true), payloadLen: dv.getUint32(12, true), hash16 };
}

/** True when the file is readable, of this format version and baked from `hash` (hex). */
export function isGIFileFresh(bytes, hash) {
  const h = readGIHeader(bytes);
  return h.ok && h.version === GI_FILE_VERSION && h.hash16 === hash.slice(0, 32);
}

/** Bytes -> {field: GIField, meta}; throws on a bad / wrong-version file. */
export function readGIFile(bytes) {
  const h = readGIHeader(bytes);
  if (!h.ok) throw new Error('gi file: ' + h.error);
  if (h.version !== GI_FILE_VERSION) throw new Error('gi file: format version ' + h.version);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(GI_HEADER_BYTES, GI_HEADER_BYTES + h.metaLen)));
  const n = meta.w * meta.h * meta.layers;
  if (bytes.length !== GI_HEADER_BYTES + h.metaLen + h.payloadLen || h.payloadLen !== meta.w * meta.h * 4 + n + n * GI_CHANNELS) throw new Error('gi file: size mismatch');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = GI_HEADER_BYTES + h.metaLen;
  const base = new Float32Array(meta.w * meta.h);
  for (let i = 0; i < base.length; i++, o += 4) base[i] = dv.getFloat32(o, true);
  const valid = bytes.slice(o, o + n); o += n;
  const data = bytes.slice(o, o + n * GI_CHANNELS);
  return { meta, field: { x0: meta.x0, y0: meta.y0, cellM: meta.cellM, w: meta.w, h: meta.h, layers: meta.layers, layerDz: Float32Array.from(meta.layerDz), base,
    keyHours: Float32Array.from(meta.keyHours), scale: Float32Array.from(meta.scale), bias: Float32Array.from(meta.bias), data, valid, volumes: [], version: meta.version || 1 } };
}
