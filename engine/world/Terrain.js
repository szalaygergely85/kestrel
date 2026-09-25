// engine/world/Terrain.js (US-025, D-007). Real implementation per
// docs/architecture.md section 7 and 7.2, tech notes build-order item 1.
//
// A sampler over the injected terrain recipe (design/levels/overworld_far.js
// shape, v2: `recipe.util.{heightAt, typeAt, generate, bakeChunk, gridHeight}`
// are pure/analytic functions of any real (x, y) - see that module's header).
// `Terrain` adds: the far 8 m bake (amortised, resumable), a bit-identical
// synchronous bake for the checksum test, and a 3x3 near-chunk cache.
//
// No allocation on the query path (`heightAt`/`typeAt`/`farHeightAt`/
// `sample`/`normalAt`) - `normalAt` writes into the caller-owned `out`.

const TYPE_NAMES = ['grass', 'forest', 'water', 'rock', 'path'];
// US-025 scope: castTerrain itself is still a no-op stub (US-016), so this
// mapping is cosmetic/query-only for now - it only has to name an EXISTING
// palette material key, not look right yet.
const TYPE_FLOOR_MAT = ['grass', 'grass', 'rock', 'rock', 'grass'];

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class Terrain {
  /**
   * @param {Object} recipe - `assets.terrain(key)` (design/levels/overworld_far.js shape).
   * @param {{structures?: Array}} [opts]
   */
  constructor(recipe, opts = {}) {
    if (!recipe || !recipe.util || typeof recipe.util.heightAt !== 'function') {
      throw new Error('Terrain: recipe.util.heightAt is required (design/levels/*_far.js shape)');
    }
    this.recipe = recipe;
    this.util = recipe.util;

    this.mapW = recipe.map.w;
    this.mapH = recipe.map.h;
    this.mapCell = recipe.map.cell;

    // Far bake (arch 7.2): R32F/R8UI-shaped typed arrays, GPU-upload-ready.
    this.farH = new Float32Array(this.mapW * this.mapH);
    this.farType = new Uint8Array(this.mapW * this.mapH);
    // US-016 (architecture.md 14.4 item 3): `farHDraw = farH + canopy` on
    // forest texels only - the RENDER height (terrain caster/GLSL march);
    // `farH` itself stays physics-only (ground level, no canopy). Built at
    // bake end alongside `farMaxH` (max over the whole grid, the march's
    // "climbing above every hill" escape bound, item 4).
    this.farHDraw = new Float32Array(this.mapW * this.mapH);
    this.farMaxH = 0;
    this.farReady = false;
    this.farVersion = 0;
    this._bakeRow = 0;
    // US-018 follow-up: column offset within `_bakeRow` - `bakeFarStep`
    // checks the time budget every `BAKE_CHECK_COLS` columns, not just once
    // per full row, so one expensive/wide row can't blow past msBudget (a
    // row here is 256 cells x heightAt+typeAt each, observed ~4 ms on the
    // owner's real GPU right after load/teleport with the old row-granular
    // check).
    this._bakeCol = 0;
    // Reused "grid" view object handed to `recipe.util.gridHeight` (no
    // per-call allocation) - farH is the whole 2048x2048 m map at (0,0).
    this._farGrid = { x0: 0, y0: 0, w: this.mapW, h: this.mapH, cell: this.mapCell, height: this.farH };
    // Same shape, but over the RENDER heights (with canopy) - the terrain
    // caster/march samples this one, never `_farGrid` (US-016).
    this._farGridDraw = { x0: 0, y0: 0, w: this.mapW, h: this.mapH, cell: this.mapCell, height: this.farHDraw };
    // Forest type id + canopy height (m), read once from the recipe (never
    // hard-coded - architecture.md 14.4 item 10 "recipe constants arrive
    // through TLOOK/uniforms from the registry", same principle in JS).
    this._forestTypeId = TYPE_NAMES.indexOf('forest');
    this._canopyM = (recipe.recipe && recipe.recipe.forest && recipe.recipe.forest.canopy) || 0;

    // Near chunks (arch 7.2): 64x64 cells of 2 m (128 m), 3x3 resident ring
    // in a fixed 9-slot array - `slot = (cy mod 3)*3 + (cx mod 3)`, never a
    // string-keyed Map on the query path.
    this.chunkSize = (recipe.chunk && recipe.chunk.size) || 128;
    this.nearCell = (recipe.chunk && recipe.chunk.nearCell) || 2;
    this._chunks = new Array(9).fill(null); // { cx, cy, h, type, version }
    this._centerCx = null;
    this._centerCy = null;
    this._chunkQueue = []; // [{cx, cy}] pending bakes, drained by bakeChunkStep
  }

  /** Analytic height (meters) at any real (x, y) - near-LOD quality everywhere. */
  heightAt(x, y) {
    return this.util.heightAt(x, y);
  }

  /** Analytic terrain type id at any real (x, y). */
  typeAt(x, y) {
    return this.util.typeAt(x, y);
  }

  /** Material key name for a terrain type id (query/physics use only, US-025 - castTerrain itself lands in US-016). */
  floorMatFor(typeId) {
    return TYPE_FLOOR_MAT[typeId] || 'grass';
  }

  typeName(typeId) {
    return TYPE_NAMES[typeId] || 'grass';
  }

  /** Bilinear height on the baked far 8 m grid; null outside the grid or before `farReady`. */
  farHeightAt(x, y) {
    if (!this.farReady) return null;
    return this.util.gridHeight(this._farGrid, x, y);
  }

  /** Picks near (analytic) or far (baked grid) by distance to the camera (< 300 m = near), per 7 "Terrain" note. */
  sample(x, y, camDist) {
    if (camDist < 300 || !this.farReady) return this.heightAt(x, y);
    const h = this.farHeightAt(x, y);
    return h === null ? this.heightAt(x, y) : h;
  }

  /** Surface normal (unit vector) via a 2 m central difference, written into the caller-owned `out` (no allocation). */
  normalAt(x, y, out) {
    const e = 2;
    const hL = this.heightAt(x - e, y);
    const hR = this.heightAt(x + e, y);
    const hD = this.heightAt(x, y - e);
    const hU = this.heightAt(x, y + e);
    const dhdx = (hR - hL) / (2 * e);
    const dhdy = (hU - hD) / (2 * e);
    // Surface tangents (1,0,dhdx) and (0,1,dhdy); normal = their cross
    // product, normalized: (-dhdx, -dhdy, 1) / length.
    const len = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
    out.x = -dhdx / len;
    out.y = -dhdy / len;
    out.z = 1 / len;
    return out;
  }

  // ---- far bake -----------------------------------------------------------

  /** Bakes the whole far grid synchronously (test/checksum oracle - AC "bit-identical to a synchronous bake"). */
  bakeFarSync() {
    const G = this.util.generate();
    this.farH.set(G.height);
    this.farType.set(G.type);
    this._bakeRow = this.mapH;
    this._bakeCol = 0;
    this._finishBake();
  }

  /**
   * Advances the far bake by at most `msBudget` ms of wall-clock time,
   * column-granular within each row (resumable) - call every frame from the
   * render loop until `farReady`. A no-op once `farReady`. US-018 follow-up:
   * the time check used to happen only once per full row, so a single wide
   * or expensive row could overrun msBudget by itself (observed ~4 ms on a
   * 2 ms budget on the owner's real GPU); it now checks every
   * `BAKE_CHECK_COLS` cells so the overrun is bounded to a small column
   * chunk, not a whole row.
   */
  bakeFarStep(msBudget = 2) {
    if (this.farReady) return;
    const t0 = now();
    const w = this.mapW, cell = this.mapCell;
    const BAKE_CHECK_COLS = 4;
    let col = this._bakeCol;
    outer: while (this._bakeRow < this.mapH) {
      const y = (this._bakeRow + 0.5) * cell;
      const rowBase = this._bakeRow * w;
      while (col < w) {
        const x = (col + 0.5) * cell;
        this.farH[rowBase + col] = this.util.heightAt(x, y);
        this.farType[rowBase + col] = this.util.typeAt(x, y);
        col++;
        if ((col & (BAKE_CHECK_COLS - 1)) === 0 && now() - t0 >= msBudget) {
          this._bakeCol = col;
          break outer;
        }
      }
      col = 0;
      this._bakeCol = 0;
      this._bakeRow++;
      if (now() - t0 >= msBudget) break;
    }
    if (this._bakeRow >= this.mapH) this._finishBake();
  }

  /** US-016: builds `farHDraw`/`farMaxH` from the just-finished `farH`/`farType` bake, then flips `farReady`. */
  _finishBake() {
    const canopy = this._canopyM, forestId = this._forestTypeId;
    let maxH = -Infinity;
    for (let i = 0; i < this.farH.length; i++) {
      const h = this.farH[i] + (this.farType[i] === forestId ? canopy : 0);
      this.farHDraw[i] = h;
      if (h > maxH) maxH = h;
    }
    this.farMaxH = maxH;
    this.farReady = true;
    this.farVersion++;
  }

  /** Bake progress in [0, 1]. */
  get bakeProgress() {
    return this.mapH === 0 ? 1 : (this._bakeRow + this._bakeCol / this.mapW) / this.mapH;
  }

  /** FNV-1a over `Uint32Array(farH.buffer)` then `farType` (bit-identical bake check). */
  checksum() {
    let h = 0x811c9dc5 | 0;
    const u32 = new Uint32Array(this.farH.buffer);
    for (let i = 0; i < u32.length; i++) {
      h ^= u32[i];
      h = Math.imul(h, 0x01000193);
    }
    for (let i = 0; i < this.farType.length; i++) {
      h ^= this.farType[i];
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ---- near chunks ----------------------------------------------------------

  _slot(cx, cy) {
    return (((cy % 3) + 3) % 3) * 3 + (((cx % 3) + 3) % 3);
  }

  /** Resident chunk at (cx, cy), or null if not currently resident (not yet baked by `bakeChunkStep`). */
  chunk(cx, cy) {
    const slot = this._slot(cx, cy);
    const c = this._chunks[slot];
    return c && c.cx === cx && c.cy === cy ? c : null;
  }

  /**
   * Recenters the resident 3x3 ring on the chunk containing (x, y). Queues
   * only the chunks not already resident (a one-chunk move regenerates
   * exactly the new row/column, per AC) - draining happens in `bakeChunkStep`.
   */
  setCenter(x, y) {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    if (cx === this._centerCx && cy === this._centerCy) return;
    this._centerCx = cx;
    this._centerCy = cy;
    this._chunkQueue.length = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ccx = cx + dx, ccy = cy + dy;
        const existing = this.chunk(ccx, ccy);
        if (!existing) this._chunkQueue.push({ cx: ccx, cy: ccy });
      }
    }
  }

  /** Bakes queued chunks, spending at most `msBudget` ms this call. */
  bakeChunkStep(msBudget = 5) {
    const t0 = now();
    while (this._chunkQueue.length && now() - t0 < msBudget) {
      const { cx, cy } = this._chunkQueue.shift();
      const G = this.util.bakeChunk(cx, cy);
      const slot = this._slot(cx, cy);
      this._chunks[slot] = { cx, cy, h: G.height, type: G.type, version: (this._chunks[slot] ? this._chunks[slot].version : 0) + 1 };
    }
  }
}
