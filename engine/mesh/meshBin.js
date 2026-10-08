// @ts-check
// engine/mesh/meshBin.js - MESH-BIN-01 (docs/mesh-bin.md, architecture.md 37.19). Lossless binary payload for
// content/meshes/<id>.mesh.bin; the small <id>.mesh.json beside it carries the meta (ranges, mats, bbox, flags)
// and `"bin": "<id>.mesh.bin"`. Decoding gives a MeshData with the SAME typed-array bytes as the old all-JSON path
// (`meshFromJSON`); only the representation on disk is smaller (dedupe tables, constants, derived planar UVs).
// Pure functions, no I/O: the loader (engine/content/loadPack.js) fetches the ArrayBuffer.
//
// Layout (little endian, every section 16-byte aligned so views are zero-copy where the stream is stored raw):
//   header 32 B : magic u32 'KMSH', version u32, vertCount u32, triCount u32, sectionCount u32, totalBytes u32, 2 x reserved
//   section table (24 B each): id, enc, offset (absolute), byteLength, count (tuples after decode), extra (dict: unique count)
//   data...
import { MESH_VERSION } from './MeshData.js';

export const MESH_BIN_MAGIC = 0x48534d4b; // bytes 'K','M','S','H'
export const MESH_BIN_VERSION = 1;
const HEADER = 32, ENTRY = 24;

/** Section ids. */
export const SEC = { POS: 1, UV: 2, UVMASK: 3, NRM: 4, FLAT: 5, AUX: 6, IDX: 7, COLLIDER: 8 };
/** Encodings. */
export const ENC = { RAW: 0, CONST: 1, TRI: 2, DICT16: 3, DICT32: 4, UVPLANAR: 5 };

/** id -> { key, stride, f (float stream) } */
const STREAMS = {
  [SEC.POS]: { key: 'pos', stride: 3, f: true },
  [SEC.UV]: { key: 'uv', stride: 2, f: true },
  [SEC.UVMASK]: { key: 'uvMask', stride: 2, f: true },
  [SEC.NRM]: { key: 'nrm', stride: 1, f: false },
  [SEC.FLAT]: { key: 'flat', stride: 2, f: false },
  [SEC.AUX]: { key: 'aux', stride: 8, f: true },
  [SEC.IDX]: { key: 'idx', stride: 1, f: false },
  [SEC.COLLIDER]: { key: 'collider', stride: 9, f: true },
};
/** UVPLANAR modes: which two pos components become (u, v). Order = encoder preference. */
const PLANES = [[0, 1], [1, 2], [0, 2]];

const al = (n, a = 16) => Math.ceil(n / a) * a;

/** Same 32-bit view regardless of float/uint so dedupe is bit exact (-0, NaN safe). */
const bitsOf = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
const ctor = (f) => (f ? Float32Array : Uint32Array);

/** @returns {{enc:number, extra:number, parts:Uint8Array[], size:number}} */
function encodeStream(bits, stride, count) {
  const n = count * stride;
  const raw = { enc: ENC.RAW, extra: 0, size: n * 4, parts: /** @type {Uint8Array[]} */ ([]) };
  let best = raw;
  const view = (u32) => new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength);
  // CONST
  if (count > 0) {
    let same = true;
    for (let i = stride; i < n && same; i++) if (bits[i] !== bits[i % stride]) same = false;
    if (same) return { enc: ENC.CONST, extra: 0, parts: [view(bits.subarray(0, stride))], size: stride * 4 };
  }
  // TRI (one tuple per 3 vertices)
  if (count > 0 && count % 3 === 0) {
    let same = true;
    for (let t = 0; t < count && same; t++) {
      const b = Math.floor(t / 3) * 3;
      for (let k = 0; k < stride; k++) if (bits[t * stride + k] !== bits[b * stride + k]) { same = false; break; }
    }
    if (same) {
      const out = new Uint32Array((count / 3) * stride);
      for (let t = 0; t < count / 3; t++) for (let k = 0; k < stride; k++) out[t * stride + k] = bits[t * 3 * stride + k];
      const size = out.length * 4;
      if (size < best.size) best = { enc: ENC.TRI, extra: 0, parts: [view(out)], size };
    }
  }
  // DICT (first-use order)
  if (count > 0) {
    const map = new Map();
    const table = [];
    const ix = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      let key = '';
      for (let k = 0; k < stride; k++) key += bits[i * stride + k] + ',';
      let j = map.get(key);
      if (j === undefined) { j = table.length / stride; map.set(key, j); for (let k = 0; k < stride; k++) table.push(bits[i * stride + k]); }
      ix[i] = j;
    }
    const unique = table.length / stride;
    const wide = unique > 65536;
    const idxBytes = al(count * (wide ? 4 : 2), 4);
    const size = unique * stride * 4 + idxBytes;
    if (size < best.size) {
      const idxArr = wide ? ix : new Uint16Array(ix);
      const idxView = new Uint8Array(idxBytes);
      idxView.set(new Uint8Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
      best = { enc: wide ? ENC.DICT32 : ENC.DICT16, extra: unique, parts: [view(Uint32Array.from(table)), idxView], size };
    }
  }
  if (best === raw) return { ...raw, parts: [view(bits.subarray(0, n))] };
  return best;
}

/** UVPLANAR payload (one u8 mode per triangle) or null when some triangle's uv is not a pos projection. */
function planarModes(pos, uv, count) {
  if (count === 0 || count % 3) return null;
  const pb = bitsOf(pos), ub = bitsOf(uv);
  const modes = new Uint8Array(count / 3);
  for (let t = 0; t < modes.length; t++) {
    let m = -1;
    for (let p = 0; p < PLANES.length && m < 0; p++) {
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        const v = t * 3 + k;
        if (pb[v * 3 + PLANES[p][0]] !== ub[v * 2] || pb[v * 3 + PLANES[p][1]] !== ub[v * 2 + 1]) ok = false;
      }
      if (ok) m = p;
    }
    if (m < 0) return null;
    modes[t] = m;
  }
  return modes;
}

/**
 * Packs the vertex/collider streams of a MeshData into one binary blob. The result is deterministic.
 * @param {import('./MeshData.js').MeshData} mesh
 * @returns {Uint8Array}
 */
export function encodeMeshBin(mesh) {
  const vertCount = mesh.pos.length / 3;
  /** @type {{id:number, enc:number, count:number, extra:number, parts:Uint8Array[], size:number}[]} */
  const secs = [];
  const add = (id, arr, count) => {
    const s = STREAMS[id];
    const e = encodeStream(bitsOf(arr), s.stride, count);
    secs.push({ id, count, ...e });
  };
  add(SEC.POS, mesh.pos, vertCount);
  if (mesh.layout === 'terrain') add(SEC.UV, mesh.uv, mesh.uv.length / 2);
  else {
    const modes = planarModes(mesh.pos, mesh.uv, vertCount);
    const generic = encodeStream(bitsOf(mesh.uv), 2, vertCount);
    if (modes && modes.length < generic.size) secs.push({ id: SEC.UV, enc: ENC.UVPLANAR, count: vertCount, extra: 0, parts: [modes], size: modes.length });
    else secs.push({ id: SEC.UV, count: vertCount, ...generic });
  }
  if (mesh.uvMask) add(SEC.UVMASK, mesh.uvMask, vertCount);
  add(SEC.NRM, mesh.nrm, mesh.nrm.length);
  add(SEC.FLAT, mesh.flat, mesh.flat.length / 2);
  add(SEC.AUX, mesh.aux, mesh.aux.length / 8);
  if (mesh.idx) add(SEC.IDX, Uint32Array.from(mesh.idx), mesh.idx.length);
  if (mesh.collider) add(SEC.COLLIDER, mesh.collider, mesh.collider.length / 9);

  let off = al(HEADER + secs.length * ENTRY);
  const offs = secs.map((s) => { const o = off; off = al(off + s.size); return o; });
  const out = new Uint8Array(off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MESH_BIN_MAGIC, true);
  dv.setUint32(4, MESH_BIN_VERSION, true);
  dv.setUint32(8, vertCount, true);
  dv.setUint32(12, mesh.triCount, true);
  dv.setUint32(16, secs.length, true);
  dv.setUint32(20, off, true);
  secs.forEach((s, i) => {
    const e = HEADER + i * ENTRY;
    dv.setUint32(e, s.id, true); dv.setUint32(e + 4, s.enc, true); dv.setUint32(e + 8, offs[i], true);
    dv.setUint32(e + 12, s.size, true); dv.setUint32(e + 16, s.count, true); dv.setUint32(e + 20, s.extra, true);
    let p = offs[i];
    for (const part of s.parts) { out.set(part, p); p += part.length; }
  });
  return out;
}

const fail = (msg) => { throw new Error(`mesh.bin: ${msg}`); };

/** Aligned ArrayBuffer view of the bytes (copies only when a Node Buffer sits at an unaligned pool offset). */
function aligned(bytes) {
  if (bytes instanceof ArrayBuffer) return { buf: bytes, base: 0, len: bytes.byteLength };
  if (bytes.byteOffset % 4 === 0) return { buf: bytes.buffer, base: bytes.byteOffset, len: bytes.byteLength };
  const c = new Uint8Array(bytes.byteLength); c.set(bytes);
  return { buf: c.buffer, base: 0, len: c.byteLength };
}

/**
 * Parses and validates a .mesh.bin. Raw streams are zero-copy views into `bytes`; dedupe/constant/derived streams are expanded.
 * Throws `Error('mesh.bin: ...')` on a bad magic / version / truncated or inconsistent file.
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {{vertCount:number, triCount:number, pos:Float32Array, uv:Float32Array, uvMask?:Float32Array, nrm:Uint32Array, flat:Uint32Array, aux:Float32Array, idx?:Uint32Array, collider?:Float32Array}}
 */
export function decodeMeshBin(bytes) {
  const { buf, base, len } = aligned(bytes);
  if (len < HEADER) fail(`truncated (${len} bytes, header needs ${HEADER})`);
  const dv = new DataView(buf, base, len);
  if (dv.getUint32(0, true) !== MESH_BIN_MAGIC) fail('bad magic (not a .mesh.bin file)');
  const ver = dv.getUint32(4, true);
  if (ver !== MESH_BIN_VERSION) fail(`unsupported version ${ver} (this loader reads ${MESH_BIN_VERSION})`);
  const vertCount = dv.getUint32(8, true), triCount = dv.getUint32(12, true), nSec = dv.getUint32(16, true), total = dv.getUint32(20, true);
  if (len < total) fail(`truncated (${len} of ${total} bytes)`);
  if (nSec > 64 || HEADER + nSec * ENTRY > len) fail(`bad section count ${nSec}`);
  const out = /** @type {any} */ ({ vertCount, triCount });
  /** @type {Record<number, any>} */ const secs = {};
  for (let i = 0; i < nSec; i++) {
    const e = HEADER + i * ENTRY;
    const sec = { id: dv.getUint32(e, true), enc: dv.getUint32(e + 4, true), off: dv.getUint32(e + 8, true), size: dv.getUint32(e + 12, true), count: dv.getUint32(e + 16, true), extra: dv.getUint32(e + 20, true) };
    if (!STREAMS[sec.id]) fail(`unknown section id ${sec.id}`);
    if (sec.off % 16 || sec.off + sec.size > total) fail(`section ${sec.id} out of bounds`);
    secs[sec.id] = sec;
  }
  for (const need of [SEC.POS, SEC.UV, SEC.NRM, SEC.FLAT, SEC.AUX]) if (!secs[need]) fail(`missing section ${need}`);
  const decoded = {};
  const decode = (id) => {
    const sec = secs[id], st = STREAMS[id], T = ctor(st.f), n = sec.count * st.stride, o = base + sec.off;
    const need = (bytesNeeded) => { if (sec.size < bytesNeeded) fail(`section ${id} too short`); };
    switch (sec.enc) {
      case ENC.RAW: need(n * 4); return new T(buf, o, n);
      case ENC.CONST: {
        need(st.stride * 4);
        const src = new T(buf, o, st.stride), res = new T(n);
        for (let i = 0; i < n; i++) res[i] = src[i % st.stride];
        return res;
      }
      case ENC.TRI: {
        if (sec.count % 3) fail(`section ${id}: TRI count not a multiple of 3`);
        need((n / 3) * 4);
        const src = new T(buf, o, n / 3), res = new T(n);
        for (let v = 0; v < sec.count; v++) for (let k = 0; k < st.stride; k++) res[v * st.stride + k] = src[Math.floor(v / 3) * st.stride + k];
        return res;
      }
      case ENC.DICT16: case ENC.DICT32: {
        const wide = sec.enc === ENC.DICT32, tab = sec.extra * st.stride;
        need(tab * 4 + al(sec.count * (wide ? 4 : 2), 4));
        const table = new T(buf, o, tab), ix = wide ? new Uint32Array(buf, o + tab * 4, sec.count) : new Uint16Array(buf, o + tab * 4, sec.count);
        const res = new T(n);
        for (let i = 0; i < sec.count; i++) {
          const j = ix[i];
          if (j >= sec.extra) fail(`section ${id}: dictionary index ${j} out of range`);
          for (let k = 0; k < st.stride; k++) res[i * st.stride + k] = table[j * st.stride + k];
        }
        return res;
      }
      case ENC.UVPLANAR: {
        if (id !== SEC.UV) fail('UVPLANAR only valid for uv');
        if (sec.count % 3) fail('UVPLANAR count not a multiple of 3');
        need(sec.count / 3);
        const modes = new Uint8Array(buf, o, sec.count / 3), pos = decoded[SEC.POS], res = new Float32Array(n);
        for (let v = 0; v < sec.count; v++) {
          const m = modes[Math.floor(v / 3)];
          if (m >= PLANES.length) fail(`bad uv plane mode ${m}`);
          res[v * 2] = pos[v * 3 + PLANES[m][0]]; res[v * 2 + 1] = pos[v * 3 + PLANES[m][1]];
        }
        return res;
      }
      default: fail(`section ${id}: unknown encoding ${sec.enc}`);
    }
  };
  for (const id of [SEC.POS, SEC.UV, SEC.UVMASK, SEC.NRM, SEC.FLAT, SEC.AUX, SEC.IDX, SEC.COLLIDER]) {
    if (!secs[id]) continue;
    decoded[id] = decode(id);
    out[STREAMS[id].key] = decoded[id];
  }
  if (out.pos.length !== vertCount * 3) fail(`pos has ${out.pos.length / 3} vertices, header says ${vertCount}`);
  if (out.nrm.length !== out.pos.length / 3 && out.layout !== 'terrain') fail('nrm length does not match the vertex count');
  return out;
}

/** Meta `.mesh.json` keys that are NOT stored in the .bin (everything else of the old json is). */
export const BIN_STREAM_KEYS = ['pos', 'uv', 'uvMask', 'nrm', 'flat', 'aux', 'idx', 'collider'];

/**
 * Meta object for a MeshData (the small .mesh.json): same key order as `meshToJSON` minus the streams, plus `bin`.
 * @param {import('./MeshData.js').MeshData} mesh
 * @param {string} binName - file name relative to the meta file
 */
export function meshBinMeta(mesh, binName) {
  return {
    version: mesh.version, id: mesh.id, layout: mesh.layout, bin: binName,
    triCount: mesh.triCount, bbox: Array.from(mesh.bbox),
    ranges: mesh.ranges.map((r) => ({ ...r, ...(r.mask ? { mask: { tex: r.mask.tex, cutoff: r.mask.cutoff } } : {}) })),
    matKeys: mesh.matKeys.slice(),
    ...(mesh.mats ? { mats: { ...mesh.mats } } : {}),
    matsResolved: mesh.matsResolved, meshVersion: mesh.meshVersion,
    ...(mesh.castShadow === false ? { castShadow: false } : {}),
    ...(mesh.collide === false ? { collide: false } : {}),
  };
}

/**
 * MeshData from a meta object (parsed .mesh.json with a `bin` key) + the .mesh.bin bytes. Equal, array by array and byte by byte,
 * to `meshFromJSON` of the old all-JSON form.
 * @param {any} meta
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {import('./MeshData.js').MeshData}
 */
export function meshFromBin(meta, bytes) {
  const d = decodeMeshBin(bytes);
  if (meta.version !== MESH_VERSION) fail(`meta version ${meta.version} is not ${MESH_VERSION}`);
  if (d.triCount !== meta.triCount) fail(`header triCount ${d.triCount} != meta triCount ${meta.triCount}`);
  const isTerrain = meta.layout === 'terrain';
  return {
    version: meta.version,
    id: meta.id,
    layout: meta.layout,
    pos: d.pos,
    uv: d.uv,
    ...(d.uvMask ? { uvMask: d.uvMask } : {}),
    nrm: d.nrm,
    flat: d.flat,
    aux: d.aux,
    idx: d.idx && isTerrain ? d.idx : null,
    triCount: meta.triCount,
    bbox: Float64Array.from(meta.bbox),
    ranges: meta.ranges.map((r) => ({ start: r.start, count: r.count, ...(r.part !== undefined ? { part: r.part } : {}), ...(r.mask ? { mask: { tex: r.mask.tex, cutoff: r.mask.cutoff } } : {}) })),
    matKeys: meta.matKeys.slice(),
    ...(meta.mats ? { mats: { ...meta.mats } } : {}),
    matsResolved: meta.matsResolved,
    meshVersion: meta.meshVersion,
    ...(meta.castShadow === false ? { castShadow: false } : {}),
    ...(meta.collide === false ? { collide: false } : {}),
    ...(d.collider ? { collider: d.collider } : {}),
  };
}
