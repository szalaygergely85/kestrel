// engine/world/grassMask.js (MASK-a, docs/architecture.md 38.52 amendment, OB-096).
// Sparse chunked grass-density paint layer: one u8 (0..255 = 0..1) per 0.5 m lattice sample. Pure render data:
// never in saves. Lattice sample (gi,gj) sits at x = gi*cell; maskAt is bilinear over the lattice.
// Absent chunk = 0 (unpainted). No layer at all (null/undefined) = 1 everywhere (today's behaviour).
import { toB64, fromB64 } from './terrainEdits.js';

/** @typedef {{cell:number, chunkSize:number, n:number, chunks: Map<number,Uint8Array>}} GrassMaskLayer */

/** @returns {GrassMaskLayer} */
export function createGrassMask(cell = 0.5, chunkSize = 64) {
  if (!(cell > 0) || !(chunkSize > 0) || !Number.isInteger(chunkSize / cell)) {
    throw new Error(`grassMask: chunkSize ${chunkSize} must be a whole multiple of cell ${cell}`);
  }
  return { cell, chunkSize, n: chunkSize / cell, chunks: new Map(), _lk: -1, _lc: null };
}

// Internal chunk key is a number (no string alloc per sample); string "cx,cy" only in the JSON.
const OFF = 1 << 11, KS = 1 << 12; // Smi keys: +-2048 chunks (+-131 km at 64 m)
const ckey = (cx, cy) => (cx + OFF) * KS + (cy + OFF);

// layer._lk/_lc cache the last looked-up chunk key and chunk (maskAt hits the same chunk for its 4 samples).
function chunkAt(layer, cx, cy, create) {
  const key = ckey(cx, cy);
  if (key === layer._lk && layer._lc) return layer._lc;
  let c = layer.chunks.get(key);
  if (!c && create) { c = new Uint8Array(layer.n * layer.n); layer.chunks.set(key, c); }
  if (c) { layer._lk = key; layer._lc = c; }
  return c || null;
}

/** Raw u8 (0..255) of global lattice sample (gi,gj); 0 when the chunk is absent. */
export function sampleAt(layer, gi, gj) {
  const n = layer.n, cx = Math.floor(gi / n), cy = Math.floor(gj / n);
  const c = chunkAt(layer, cx, cy, false);
  return c ? c[gi - cx * n + (gj - cy * n) * n] : 0;
}
export function setSample(layer, gi, gj, u8) {
  const n = layer.n, cx = Math.floor(gi / n), cy = Math.floor(gj / n);
  chunkAt(layer, cx, cy, true)[gi - cx * n + (gj - cy * n) * n] = u8 < 0 ? 0 : u8 > 255 ? 255 : Math.round(u8);
}

/** Bilinear density 0..1 at world (x,y). No layer (null/undefined) = 1 everywhere. */
export function maskAt(layer, x, y) {
  if (!layer) return 1;
  if (layer.chunks.size === 0) return 0;
  const fx = x / layer.cell, fy = y / layer.cell;
  const gi = Math.floor(fx), gj = Math.floor(fy), u = fx - gi, v = fy - gj;
  const a = sampleAt(layer, gi, gj), b = sampleAt(layer, gi + 1, gj);
  const c = sampleAt(layer, gi, gj + 1), d = sampleAt(layer, gi + 1, gj + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) / 255;
}

// ---- JSON ----------------------------------------------------------------------
const KEY_RE = /^-?\d+,-?\d+$/;

/** Validates and builds a layer from a parsed `grassMask` file object. Throws Error on bad data. */
export function grassMaskFromJSON(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('grassMask: not an object');
  if (obj.kind !== undefined && obj.kind !== 'grassMask') throw new Error(`grassMask: bad kind "${obj.kind}"`);
  if (obj.schema !== undefined && obj.schema !== 1) throw new Error(`grassMask: unsupported schema ${obj.schema}`);
  const layer = createGrassMask(obj.cell === undefined ? 0.5 : obj.cell, obj.chunkSize === undefined ? 64 : obj.chunkSize);
  const chunks = obj.chunks || {};
  const n2 = layer.n * layer.n;
  for (const key of Object.keys(chunks)) {
    if (!KEY_RE.test(key)) throw new Error(`grassMask: bad chunk key "${key}"`);
    if (typeof chunks[key] !== 'string') throw new Error(`grassMask: chunk ${key} must be a base64 string`);
    const p = key.indexOf(',');
    layer.chunks.set(ckey(+key.slice(0, p), +key.slice(p + 1)), fromB64(chunks[key], n2, `chunk ${key}`));
  }
  return layer;
}

/** Deterministic plain object: chunks sorted by key, all-zero chunks dropped. */
export function grassMaskToJSON(layer, id = '') {
  const chunks = {}, named = [];
  for (const [k, c] of layer.chunks) named.push([`${Math.floor(k / KS) - OFF},${(k % KS) - OFF}`, c]);
  named.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)); // same string order as before
  for (const [key, c] of named) {
    let any = false;
    for (let i = 0; i < c.length; i++) if (c[i] !== 0) { any = true; break; }
    if (any) chunks[key] = toB64(c);
  }
  const out = { kind: 'grassMask', schema: 1, id, cell: layer.cell };
  if (layer.chunkSize !== 64) out.chunkSize = layer.chunkSize;
  out.chunks = chunks;
  return out;
}

// ---- bake carpet variant `areas` into the layer ---------------------------------
function smooth01(d, r) { const t = d >= r ? 1 : d <= 0 ? 0 : d / r; return 1 - t * t * (3 - 2 * t); }

// Signed distance (m) from (x,y) to the shape: <= 0 inside.
function areaDist(a, x, y) {
  if (a.shape === 'disc') return Math.hypot(x - a.x, y - a.y) - a.r;
  if (a.shape === 'rect') {
    const dx = Math.max(a.x0 - x, 0, x - a.x1), dy = Math.max(a.y0 - y, 0, y - a.y1);
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
    return -1; // inside
  }
  const ex = a.bx - a.ax, ey = a.by - a.ay, l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((x - a.ax) * ex + (y - a.ay) * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - a.ax - ex * t, y - a.ay - ey * t) - a.r;
}
function areaBounds(a, m) {
  if (a.shape === 'disc') return [a.x - a.r - m, a.y - a.r - m, a.x + a.r + m, a.y + a.r + m];
  if (a.shape === 'rect') return [a.x0 - m, a.y0 - m, a.x1 + m, a.y1 + m];
  return [Math.min(a.ax, a.bx) - a.r - m, Math.min(a.ay, a.by) - a.r - m, Math.max(a.ax, a.bx) + a.r + m, Math.max(a.ay, a.by) + a.r + m];
}

/**
 * Rasterises every variant's `areas` (disc/capsule/rect) into `layer` with max-combine: inside = 255, outside ramps
 * to 0 over `featherM` (smooth01). Variants without `areas` are skipped (no shape). Returns the layer.
 */
export function bakeAreasToMask(layer, variants, featherM = 0) {
  const cell = layer.cell, f = Math.max(0, featherM);
  for (const v of variants || []) {
    if (!v || !v.areas) continue;
    for (const a of v.areas) {
      const b = areaBounds(a, f);
      const i0 = Math.ceil(b[0] / cell), i1 = Math.floor(b[2] / cell), j0 = Math.ceil(b[1] / cell), j1 = Math.floor(b[3] / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = areaDist(a, i * cell, j * cell);
        const w = d <= 0 ? 1 : f > 0 ? smooth01(d, f) : 0;
        if (w <= 0) continue;
        const u = Math.round(w * 255);
        if (u > sampleAt(layer, i, j)) setSample(layer, i, j, u);
      }
    }
  }
  return layer;
}
