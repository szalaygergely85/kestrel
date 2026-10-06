// engine/world/terrainEdits.js (ED-TERRAIN-1a, docs/architecture.md 37.12).
// Sparse per-chunk edit layer on the 2 m near grid: integer-centimetre height
// deltas + ground-type paint. Pure (no imports). The recipe
// (design/levels/overworld_far.js) reads it duck-typed through
// `util.setEditLayer(layer)`: only `heightDelta(x,y)` / `typePaint(x,y)` are called.
//
// Sample (i,j) of chunk (cx,cy) sits at x = cx*chunkSize + i*cell (a lattice point).
//  - heightDelta: bilinear over the lattice samples (missing chunk/neighbour = 0).
//  - typePaint: the sample whose 2 m cell [gi*cell, (gi+1)*cell) contains the point
//    (the near bake evaluates cell CENTRES, so floor, not round, keeps ties out of it).
// Integer storage => what the editor holds in memory is exactly what gets saved.

export const NO_PAINT = 255;

/** @typedef {{cell:number, chunkSize:number, n:number, chunks: Map<string,{dh:Int16Array,type:Uint8Array}>}} TerrainEditLayer */

/** @returns {TerrainEditLayer} */
export function createEditLayer(cell = 2, chunkSize = 128) {
  if (!(cell > 0) || !(chunkSize > 0) || !Number.isInteger(chunkSize / cell)) {
    throw new Error(`terrainEdits: chunkSize ${chunkSize} must be a whole multiple of cell ${cell}`);
  }
  const layer = {
    cell, chunkSize, n: chunkSize / cell, chunks: new Map(),
    heightDelta(x, y) { return heightDelta(layer, x, y); },
    typePaint(x, y) { return typePaint(layer, x, y); },
  };
  return layer;
}

const mod = (a, n) => ((a % n) + n) % n;

function chunkAt(layer, gi, gj, create) {
  const n = layer.n, cx = Math.floor(gi / n), cy = Math.floor(gj / n), key = cx + ',' + cy;
  let c = layer.chunks.get(key);
  if (!c && create) {
    c = { dh: new Int16Array(n * n), type: new Uint8Array(n * n).fill(NO_PAINT) };
    layer.chunks.set(key, c);
  }
  return c || null;
}

/** Height delta (cm) of global lattice sample (gi,gj); 0 when the chunk is absent. */
export function sampleDh(layer, gi, gj) {
  const c = chunkAt(layer, gi, gj, false);
  return c ? c.dh[mod(gi, layer.n) + mod(gj, layer.n) * layer.n] : 0;
}
/** Paint type of global sample (gi,gj), or NO_PAINT. */
export function sampleType(layer, gi, gj) {
  const c = chunkAt(layer, gi, gj, false);
  return c ? c.type[mod(gi, layer.n) + mod(gj, layer.n) * layer.n] : NO_PAINT;
}
export function setSampleDh(layer, gi, gj, cm) {
  const c = chunkAt(layer, gi, gj, true);
  c.dh[mod(gi, layer.n) + mod(gj, layer.n) * layer.n] = Math.max(-32768, Math.min(32767, Math.round(cm)));
}
export function setSampleType(layer, gi, gj, t) {
  chunkAt(layer, gi, gj, true).type[mod(gi, layer.n) + mod(gj, layer.n) * layer.n] = t;
}

/** Bilinear height delta in metres (0 for an empty layer). */
export function heightDelta(layer, x, y) {
  if (layer.chunks.size === 0) return 0;
  const fx = x / layer.cell, fy = y / layer.cell;
  const gi = Math.floor(fx), gj = Math.floor(fy), u = fx - gi, v = fy - gj;
  const a = sampleDh(layer, gi, gj), b = sampleDh(layer, gi + 1, gj);
  const c = sampleDh(layer, gi, gj + 1), d = sampleDh(layer, gi + 1, gj + 1);
  if (a === 0 && b === 0 && c === 0 && d === 0) return 0;
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 0.01;
}

/** Paint type id at (x,y), or -1 for none. */
export function typePaint(layer, x, y) {
  if (layer.chunks.size === 0) return -1;
  const t = sampleType(layer, Math.floor(x / layer.cell), Math.floor(y / layer.cell));
  return t === NO_PAINT ? -1 : t;
}

// ---- JSON (base64 little-endian) -------------------------------------------

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str, expectLen, what) {
  let s;
  try { s = atob(str); } catch (e) { throw new Error(`terrainEdits: ${what} is not valid base64`); }
  if (s.length !== expectLen) throw new Error(`terrainEdits: ${what} has ${s.length} bytes, expected ${expectLen}`);
  const out = new Uint8Array(expectLen);
  for (let i = 0; i < expectLen; i++) out[i] = s.charCodeAt(i);
  return out;
}
function dhToBytes(dh) {
  const b = new Uint8Array(dh.length * 2);
  for (let i = 0; i < dh.length; i++) { const v = dh[i] & 0xffff; b[i * 2] = v & 255; b[i * 2 + 1] = v >> 8; }
  return b;
}
function dhFromBytes(b) {
  const dh = new Int16Array(b.length / 2);
  for (let i = 0; i < dh.length; i++) dh[i] = ((b[i * 2] | (b[i * 2 + 1] << 8)) << 16) >> 16;
  return dh;
}

const KEY_RE = /^-?\d+,-?\d+$/;

/** Validates and builds a layer from a parsed `terrainEdits` file object. Throws Error on bad data. */
export function editLayerFromJSON(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('terrainEdits: not an object');
  if (obj.kind !== undefined && obj.kind !== 'terrainEdits') throw new Error(`terrainEdits: bad kind "${obj.kind}"`);
  const layer = createEditLayer(obj.cell === undefined ? 2 : obj.cell, obj.chunkSize === undefined ? 128 : obj.chunkSize);
  const chunks = obj.chunks || {};
  const n2 = layer.n * layer.n;
  for (const key of Object.keys(chunks)) {
    if (!KEY_RE.test(key)) throw new Error(`terrainEdits: bad chunk key "${key}"`);
    const e = chunks[key];
    if (!e || typeof e.dh !== 'string' || typeof e.type !== 'string') throw new Error(`terrainEdits: chunk ${key} needs dh + type strings`);
    const dh = dhFromBytes(fromB64(e.dh, n2 * 2, `chunk ${key} dh`));
    const type = fromB64(e.type, n2, `chunk ${key} type`);
    layer.chunks.set(key, { dh, type });
  }
  return layer;
}

/** Deterministic plain object: chunks sorted by key, all-zero/unpainted chunks dropped. */
export function editLayerToJSON(layer, id = '') {
  const chunks = {};
  for (const key of [...layer.chunks.keys()].sort()) {
    const c = layer.chunks.get(key);
    if (isEmptyChunk(c)) continue;
    chunks[key] = { dh: toB64(dhToBytes(c.dh)), type: toB64(c.type) };
  }
  const out = { kind: 'terrainEdits', schema: 1, id, cell: layer.cell };
  if (layer.chunkSize !== 128) out.chunkSize = layer.chunkSize;
  out.chunks = chunks;
  return out;
}

function isEmptyChunk(c) {
  for (let i = 0; i < c.dh.length; i++) if (c.dh[i] !== 0 || c.type[i] !== NO_PAINT) return false;
  return true;
}

// ---- brush dabs --------------------------------------------------------------

function smooth01(d, r) { const t = d >= r ? 1 : d <= 0 ? 0 : d / r; return 1 - t * t * (3 - 2 * t); } // 1 centre -> 0 at r (recipe smooth())

/** Height the brush edits against: the recipe's `baseHeightAt` (no structure blend) when present, else `heightAt`. */
export function editHeightAt(terrain, x, y) {
  const u = terrain.util;
  return u && typeof u.baseHeightAt === 'function' ? u.baseHeightAt(x, y) : terrain.heightAt(x, y);
}

/**
 * Applies one brush dab, editing `dh` so the TOTAL height moves (reads `terrain.heightAt`, which
 * must already see this layer through the recipe hook). Ops:
 *  raise/lower: +-strength metres * falloff.   flatten: toward `target` (default: height at the dab
 *  centre) by strength(0..1)*falloff.   smooth: toward the 3x3 mean by strength(0..1)*falloff.
 *  paint: strength = terrain type id; hard edge (d <= r), no falloff.
 * `outRect` (optional) receives the touched global sample rect {i0,j0,i1,j1} (inclusive) or null.
 * @returns {boolean} whether anything changed
 */
export function applyDab(layer, terrain, op, x, y, r, strength, outRect, target) {
  const cell = layer.cell;
  // Paint samples are cell CENTRES ((i+0.5)*cell, see typePaint); height samples are lattice points (i*cell).
  const o = op === 'paint' ? 0.5 : 0;
  const i0 = Math.ceil((x - r) / cell - o), i1 = Math.floor((x + r) / cell - o);
  const j0 = Math.ceil((y - r) / cell - o), j1 = Math.floor((y + r) / cell - o);
  if (outRect) { outRect.i0 = i0; outRect.j0 = j0; outRect.i1 = i1; outRect.j1 = j1; }
  if (i1 < i0 || j1 < j0) return false;
  let changed = false;
  if (op === 'paint') {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - y) > r) continue;
      if (sampleType(layer, i, j) !== strength) { setSampleType(layer, i, j, strength); changed = true; }
    }
    return changed;
  }
  const w = i1 - i0 + 1, h = j1 - j0 + 1, add = new Float64Array(w * h);
  if (op === 'flatten' && target === undefined) target = editHeightAt(terrain, x, y);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = i * cell, py = j * cell, d = Math.hypot(px - x, py - y);
    if (d > r) continue;
    const f = smooth01(d, r);
    let dm; // metres
    if (op === 'raise') dm = strength * f;
    else if (op === 'lower') dm = -strength * f;
    else if (op === 'flatten') dm = (target - editHeightAt(terrain, px, py)) * strength * f;
    else if (op === 'smooth') {
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += editHeightAt(terrain, px + di * cell, py + dj * cell);
      dm = (sum / 9 - editHeightAt(terrain, px, py)) * strength * f;
    } else throw new Error(`terrainEdits: unknown op "${op}"`);
    add[(i - i0) + (j - j0) * w] = dm * 100;
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = add[(i - i0) + (j - j0) * w];
    if (a === 0) continue;
    const before = sampleDh(layer, i, j);
    const next = Math.max(-32768, Math.min(32767, Math.round(before + a)));
    if (next !== before) { setSampleDh(layer, i, j, next); changed = true; }
  }
  return changed;
}
