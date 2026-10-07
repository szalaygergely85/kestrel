// engine/render/MaskAtlas.js - ALPHA-01b (docs/architecture.md 37.17 items 2, 10): one R8UI atlas of alpha masks.
// Pure (imports nothing). Shelf packing (rows of equal-or-lower height), deterministic when ids are added sorted
// (`buildMaskAtlas`). `sample` is the JS twin's per-fragment texel rule (no allocation); the GPU twin does the same with
// `texelFetch` on a nearest, mip-less R8UI texture.

/** Atlas width and height ceiling (37.17: max 2048^2 = 4 MB). */
export const MASK_ATLAS_MAX = 2048;

/** @param {number} f - cutoff in (0,1) -> byte compared as `texel < cutoffByte` -> discard */
export function cutoffByte(f) { return Math.round(f * 255); }

export class MaskAtlas {
  /** @param {{maxW?: number, maxH?: number}} [opts] */
  constructor(opts) {
    this.maxW = (opts && opts.maxW) || MASK_ATLAS_MAX;
    this.maxH = (opts && opts.maxH) || MASK_ATLAS_MAX;
    this.W = this.maxW;
    /** Used height (grows with add; `data.length === W * H`). */
    this.H = 0;
    this.data = new Uint8Array(0);
    /** @type {Map<string, {x0:number,y0:number,w:number,h:number}>} */
    this.rects = new Map();
    /** Bumped on every add: the GPU re-uploads when it changes (never per frame). */
    this.version = 0;
    this._shelfY = 0; this._shelfH = 0; this._cursorX = 0;
  }

  /** @param {string} id @param {number} w @param {number} h @param {Uint8Array} bytes - w*h, row 0 = image row 0 */
  add(id, w, h, bytes) {
    if (this.rects.has(id)) throw new Error(`MaskAtlas: duplicate mask id "${id}"`);
    if (!(w >= 1 && h >= 1) || bytes.length !== w * h) throw new Error(`MaskAtlas: mask "${id}" has ${bytes.length} bytes, expected ${w}x${h}`);
    if (w > this.W) throw new Error(`MaskAtlas: mask "${id}" ${w}x${h} is wider than the atlas (${this.W})`);
    let x = this._cursorX, y = this._shelfY, shelfH = this._shelfH;
    if (x + w > this.W) { y += shelfH; x = 0; shelfH = 0; } // new shelf
    if (y + h > this.maxH) throw new Error(`MaskAtlas: full, cannot place "${id}" ${w}x${h} (${this.W}x${this.maxH})`);
    this._cursorX = x + w; this._shelfY = y; this._shelfH = Math.max(shelfH, h);
    const needH = y + this._shelfH;
    if (needH > this.H) { // grow (add-time only): rows are W wide, new rows zero
      const nd = new Uint8Array(this.W * needH);
      nd.set(this.data);
      this.data = nd; this.H = needH;
    }
    for (let r = 0; r < h; r++) this.data.set(bytes.subarray(r * w, r * w + w), (y + r) * this.W + x);
    this.rects.set(id, { x0: x, y0: y, w, h });
    this.version++;
  }

  /** @param {string} id @returns {{x0:number,y0:number,w:number,h:number}|undefined} */
  rect(id) { return this.rects.get(id); }

  /** Texel index of coordinate `u` in a `w`-texel axis: repeat wrap, f32 rounding, clamp (37.17 item 2). */
  static texel(u, w) {
    const ub = Math.fround(u);
    const tu = ub - Math.floor(ub);
    const t = Math.floor(Math.fround(tu * w));
    return t < w - 1 ? t : w - 1;
  }

  /** The alpha byte at (u, v) of the mask rect (x0, y0, w, h). No allocation. */
  sample(x0, y0, w, h, u, v) {
    return this.data[(y0 + MaskAtlas.texel(v, h)) * this.W + x0 + MaskAtlas.texel(u, w)];
  }
}

/** Packs every `assets.mask(id)` (ids sorted) into a fresh atlas; `assets` needs `keys('mask')` + `mask(id)`. */
export function buildMaskAtlas(assets) {
  const atlas = new MaskAtlas();
  if (!assets || typeof assets.keys !== 'function') return atlas; // stub registries (tests) carry no masks
  const ids = assets.keys('mask').slice().sort();
  for (const id of ids) { const m = assets.mask(id); atlas.add(id, m.w, m.h, m.data); }
  return atlas;
}
