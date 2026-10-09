// engine/content/zip.js (KPKG-01, docs/architecture.md 38.30).
// Minimal ZIP reader/writer for `.kestrel` packages. Stored (0) + deflate (8)
// via the platform CompressionStream / DecompressionStream('deflate-raw')
// (browsers, Electron, Node >= 18). No zip64, no encryption, no DOM, no deps.
import { ContentError } from './ContentError.js';

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 10000,
  maxTotal: 512 * 1024 * 1024, // total uncompressed bytes
  maxRatio: 1000, // uncompressed / compressed, checked for entries > ratioMinSize
  ratioMinSize: 1024 * 1024,
});

// Extensions that are already compressed or read zero-copy: always stored.
const STORE_EXT = /\.(glb|png|bin|vox)$/i;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const DOS_DATE_1980 = 0x21; // 1980-01-01
const FILE = '(zip)';

const err = (field, reason) => new ContentError(FILE, field, reason);

let CRC_TABLE = null;
/** CRC-32 (IEEE) of a Uint8Array. */
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip-slip guard: throws ContentError for an unsafe entry path. */
export function checkZipPath(p) {
  if (typeof p !== 'string' || p.length === 0) throw err('path', 'empty entry path');
  if (p.includes('\\')) throw err(p, 'backslash in path');
  if (p.startsWith('/')) throw err(p, 'absolute path');
  if (/^[A-Za-z]:/.test(p)) throw err(p, 'drive letter in path');
  if (/[\u0000-\u001f]/.test(p)) throw err(p, 'control character in path');
  for (const seg of p.split('/')) if (seg === '..') throw err(p, 'dot-dot segment in path');
}

async function collect(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (maxBytes !== undefined && total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw err('entry', 'inflated data exceeds the declared size');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function inflateRaw(bytes, expected) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return collect(ds.readable, expected);
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return collect(cs.readable);
}

/**
 * @param {Uint8Array} bytes
 * @param {{maxEntries?:number,maxTotal?:number,maxRatio?:number,ratioMinSize?:number}} [limits]
 * @returns {{paths:string[], has(p:string):boolean, size(p:string):number, read(p:string):Promise<Uint8Array>}}
 */
export function readZip(bytes, limits = {}) {
  const L = { ...ZIP_LIMITS, ...limits };
  if (!(bytes instanceof Uint8Array)) throw err('bytes', 'expected a Uint8Array');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: scan back over the (<= 64 KiB) comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw err('eocd', 'not a zip file (no end-of-central-directory record)');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw err('eocd', 'zip64 is not supported');
  if (count > L.maxEntries) throw err('entries', `${count} entries exceeds the limit of ${L.maxEntries}`);
  if (cdOff + cdSize > eocd) throw err('eocd', 'central directory out of range');

  const dec = new TextDecoder('utf-8', { fatal: true });
  const entries = new Map();
  let total = 0;
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw err('central', `bad central directory entry ${i}`);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (p + 46 + nlen > bytes.length) throw err('central', 'entry name out of range');
    let name;
    try { name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen)); } catch { throw err('central', `entry ${i} name is not valid UTF-8`); }
    p += 46 + nlen + elen + clen;
    checkZipPath(name);
    if (flags & 1) throw err(name, 'encrypted entries are not supported');
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw err(name, 'zip64 is not supported');
    if (method !== 0 && method !== 8) throw err(name, `unsupported compression method ${method}`);
    if (method === 0 && csize !== usize) throw err(name, 'stored entry with differing sizes');
    if (name.endsWith('/')) continue; // directory entry
    if (entries.has(name)) throw err(name, 'duplicate entry');
    total += usize;
    if (total > L.maxTotal) throw err('size', `uncompressed size exceeds ${L.maxTotal} bytes`);
    if (method === 8 && usize > L.ratioMinSize && usize / Math.max(1, csize) > L.maxRatio) {
      throw err(name, `compression ratio ${(usize / Math.max(1, csize)).toFixed(0)} exceeds ${L.maxRatio}`);
    }
    entries.set(name, { method, crc, csize, usize, lho });
  }

  const paths = [...entries.keys()];
  return {
    paths,
    has: (n) => entries.has(n),
    size: (n) => { const e = entries.get(n); if (!e) throw err(n, 'no such entry'); return e.usize; },
    async read(n) {
      const e = entries.get(n);
      if (!e) throw err(n, 'no such entry');
      const o = e.lho;
      if (o + 30 > bytes.length || dv.getUint32(o, true) !== SIG_LOCAL) throw err(n, 'bad local header');
      const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
      if (start + e.csize > bytes.length) throw err(n, 'entry data out of range');
      const raw = bytes.subarray(start, start + e.csize); // zero-copy for stored entries
      let out;
      try {
        out = e.method === 0 ? raw : await inflateRaw(raw, e.usize);
      } catch (x) {
        if (x instanceof ContentError) throw err(n, x.reason);
        throw err(n, 'corrupt deflate data');
      }
      if (out.length !== e.usize) throw err(n, `size mismatch (${out.length} vs ${e.usize})`);
      if (crc32(out) !== e.crc) throw err(n, 'bad CRC');
      return out;
    },
  };
}

/**
 * Deterministic zip: entries sorted by path, `kestrel.json` first, DOS time
 * 1980-01-01. `.glb/.png/.bin/.vox` (and `store:true`) are stored.
 * @param {{path:string, bytes:Uint8Array, store?:boolean}[]} entries
 * @param {{deflate?:boolean}} [opts]  deflate=false -> everything stored
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(entries, opts = {}) {
  const deflate = opts.deflate !== false;
  if (entries.length > ZIP_LIMITS.maxEntries) throw err('entries', `${entries.length} entries exceeds the limit of ${ZIP_LIMITS.maxEntries}`);
  const seen = new Set();
  for (const e of entries) {
    checkZipPath(e.path);
    if (seen.has(e.path)) throw err(e.path, 'duplicate entry');
    seen.add(e.path);
  }
  const sorted = [...entries].sort((a, b) => {
    const ka = a.path === 'kestrel.json' ? 0 : 1;
    const kb = b.path === 'kestrel.json' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let off = 0;
  for (const e of sorted) {
    const name = enc.encode(e.path);
    const data = e.bytes;
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (deflate && !e.store && !STORE_EXT.test(e.path) && data.length > 0) {
      const z = await deflateRaw(data);
      if (z.length < data.length) { method = 8; body = z; }
    }
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, SIG_LOCAL, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(8, method, true); l.setUint16(10, 0, true); l.setUint16(12, DOS_DATE_1980, true);
    l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true); l.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, SIG_CENTRAL, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(10, method, true); c.setUint16(12, 0, true); c.setUint16(14, DOS_DATE_1980, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    ch.set(name, 46);
    locals.push(lh, body);
    centrals.push(ch);
    off += lh.length + body.length;
    if (off > 0xfffffff0) throw err('size', 'zip64 is not supported (archive too large)');
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true); ev.setUint16(8, sorted.length, true); ev.setUint16(10, sorted.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  const out = new Uint8Array(off + cdSize + 22);
  let o = 0;
  for (const b of [...locals, ...centrals, eocd]) { out.set(b, o); o += b.length; }
  return out;
}
