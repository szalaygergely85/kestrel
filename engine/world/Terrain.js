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
   * @param {{structures?: Array, realTrees?: boolean, edits?: Object}} [opts]  edits: a TerrainEditLayer (engine/world/terrainEdits.js)
   */
  constructor(recipe, opts = {}) {
    if (!recipe || !recipe.util || typeof recipe.util.heightAt !== 'function') {
      throw new Error('Terrain: recipe.util.heightAt is required (design/levels/*_far.js shape)');
    }
    this.recipe = recipe;
    this.util = recipe.util;
    this.realTrees = opts.realTrees === true;
    // ED-TERRAIN-1a (arch 37.12): the recipe's edit layer is module-global, so ALWAYS set it here
    // (a Terrain built without edits clears a previous one). Recipes without the hook are untouched.
    this.edits = opts.edits || null;
    if (typeof recipe.util.setEditLayer === 'function') recipe.util.setEditLayer(this.edits);

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
    // US-026a (architecture.md 23.4 "new early-out"): the far grid's own
    // minimum hDraw, min-combined with `near.minH` by the terrain caster to
    // bound a steep downward ray ("below every surface -> no hit").
    this.farMinH = 0;
    this.farReady = false;
    this.farVersion = 0;
    this._rbH = null; // rebakeRect height scratch (grow-only)
    this.farDirty = null; // ED-TERRAIN-1b: far texel rect touched by rebakeRect, consumed by TerrainMeshSet.markNearDirty
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

    // US-026a (architecture.md 23.1 item 1): one contiguous 3x3-chunk near
    // band, baked once (synchronously) at World.load, never streamed/
    // regenerated in this story (that's US-026b's `chunk()`/`setCenter()`/
    // `bakeChunkStep()` above, untouched by this feature).
    this.near = null;
    this.nearReady = false;
    // Reused output object for `groundNormalAt` central-difference reads of
    // `groundAt` (rule 9: no per-call allocation on the query path).
    this._groundNormalScratch = { x: 0, y: 0, z: 1 };
  }

  /** The recipe's edit layer is module-global: re-bind THIS terrain's layer before any call into the recipe (two Terrains, one recipe). */
  _bindEdits() {
    const u = this.util;
    if (u.getEditLayer && u.getEditLayer() !== this.edits) u.setEditLayer(this.edits);
  }

  /** Installs (or clears with null) the edit layer, e.g. the editor when no edits file exists. Callers re-bake what they need. */
  setEdits(layer) {
    this.edits = layer || null;
    this._bindEdits();
  }

  /** Analytic height (meters) at any real (x, y) - near-LOD quality everywhere. */
  heightAt(x, y) {
    this._bindEdits();
    return this.util.heightAt(x, y);
  }

  /** Analytic terrain type id at any real (x, y). */
  typeAt(x, y) {
    this._bindEdits();
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

  // ---- near band (US-026a, architecture.md 23) -----------------------------

  /**
   * Bakes the whole near band synchronously: a 192x192 grid of 2 m cells
   * (3x3 of the 128 m chunks, centered on the chunk containing world chunk
   * coordinates `(cx, cy)` - the same `Math.floor(x / chunkSize)` convention
   * `setCenter` uses internally). Uses `recipe.util.bake` directly (the same
   * pure function `bakeChunk` calls per-chunk), so the result is cell-for-
   * cell identical to baking the 9 `bakeChunk(cx+dx, cy+dy)` chunks and
   * stitching them - one array, no seams by construction. Synchronous (no
   * time-slicing): measured ~80 ms (AC 300 ms), called once from
   * `World.load` before any prop spawns. `hDraw` adds forest canopy, same
   * rule as `farHDraw`; `minH`/`maxH` are the band's hDraw extremes (render
   * escape bounds, mirrors `farMaxH`).
   */
  bakeNearBand(cx, cy) {
    this._bindEdits();
    const n = this.chunkSize / this.nearCell; // 64 near-cells per 128 m chunk
    const w = 3 * n, h = 3 * n;
    const x0 = (cx - 1) * this.chunkSize;
    const y0 = (cy - 1) * this.chunkSize;
    const G = this.util.bake(x0, y0, this.nearCell, w, h);

    const hDraw = new Float32Array(w * h);
    const canopy = this.realTrees ? 0 : this._canopyM, forestId = this._forestTypeId;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < G.height.length; i++) {
      const hv = G.height[i] + (G.type[i] === forestId ? canopy : 0);
      hDraw[i] = hv;
      if (hv < minH) minH = hv;
      if (hv > maxH) maxH = hv;
    }

    this.near = {
      x0, y0, w, h, cell: this.nearCell,
      height: G.height, type: G.type, hDraw, minH, maxH,
      version: (this.near ? this.near.version : 0) + 1,
    };
    this.nearReady = true;
  }

  /**
   * ED-TERRAIN-1b (arch 37.12): live dirty re-bake after a terrain edit. (x0,y0)-(x1,y1) is the world
   * rect of the EDITED lattice samples (e.g. `{i0,j0,i1,j1} * editCell` from `applyDab`). Re-bakes only the
   * near samples the edit can reach (rect + one cell of bilinear reach + the recipe's `slopeEps` for typeAt),
   * and the far texels under it, writing exactly what a full bake would (bit-identical; same formulas).
   * Sets `near.dirty` (band-local inclusive sample rect, unioned until `TerrainMeshSet.markNearDirty` consumes
   * it) and `farDirty` (far texel rect), bumps `near.version`/`farVersion`, only WIDENS minH/maxH (call
   * `recomputeBounds()` on stroke end). Allocation-free after the first call.
   * @returns {{i0:number,j0:number,i1:number,j1:number}|null} the near dirty rect (band-local) or null
   */
  rebakeRect(x0, y0, x1, y1) {
    this._bindEdits();
    if (this.nearReady) this._chunks.fill(null), this._centerCx = null; // 3x3 chunk cache is stale now
    const eps = (this.recipe.recipe && this.recipe.recipe.slopeEps) || this.nearCell;
    const g = this.near;
    let out = null;
    if (g) {
      const c = g.cell, m = c + eps;
      const i0 = Math.max(0, Math.ceil((x0 - m - g.x0) / c - 0.5)), i1 = Math.min(g.w - 1, Math.floor((x1 + m - g.x0) / c - 0.5));
      const j0 = Math.max(0, Math.ceil((y0 - m - g.y0) / c - 0.5)), j1 = Math.min(g.h - 1, Math.floor((y1 + m - g.y0) / c - 0.5));
      if (i1 >= i0 && j1 >= j0) {
        const canopy = this.realTrees ? 0 : this._canopyM, forestId = this._forestTypeId, util = this.util;
        let minH = g.minH, maxH = g.maxH;
        // Fast path: typeAt's slope reads heightAt at +-eps, which (eps == near cell) are the neighbour sample
        // centres, so one double-precision height pass over the rect + 1 ring feeds both height and type
        // (bit-identical: the same heightAt calls on the same coordinates). Otherwise plain typeAt.
        const fast = eps === c, hw = i1 - i0 + 3, hh = j1 - j0 + 3;
        if (fast) {
          if (!this._rbH || this._rbH.length < hw * hh) this._rbH = new Float64Array(hw * hh);
          const H = this._rbH;
          for (let j = 0; j < hh; j++) {
            const y = g.y0 + (j0 - 1 + j + 0.5) * c;
            for (let i = 0; i < hw; i++) H[i + j * hw] = util.heightAt(g.x0 + (i0 - 1 + i + 0.5) * c, y);
          }
        }
        for (let j = j0; j <= j1; j++) {
          const y = g.y0 + (j + 0.5) * c;
          for (let i = i0; i <= i1; i++) {
            const x = g.x0 + (i + 0.5) * c, k = i + j * g.w;
            let t;
            if (fast) {
              const q = (i - i0 + 1) + (j - j0 + 1) * hw, H = this._rbH;
              t = util.typeAt(x, y, H[q + 1], H[q - 1], H[q + hw], H[q - hw]);
              g.height[k] = H[q];
            } else {
              t = util.typeAt(x, y);
              g.height[k] = util.heightAt(x, y);
            }
            g.type[k] = t;
            const hv = g.height[k] + (t === forestId ? canopy : 0); // float32 height, double sum like bakeNearBand
            g.hDraw[k] = hv;
            if (hv < minH) minH = hv;
            if (hv > maxH) maxH = hv;
          }
        }
        g.minH = minH; g.maxH = maxH; g.version++;
        const d = g.dirty || (g.dirty = { i0, j0, i1, j1 });
        if (d.i0 > i0) d.i0 = i0; if (d.j0 > j0) d.j0 = j0; if (d.i1 < i1) d.i1 = i1; if (d.j1 < j1) d.j1 = j1;
        out = d;
      }
    }
    if (this.farReady) {
      const c = this.mapCell, m = c + eps;
      const i0 = Math.max(0, Math.ceil((x0 - m) / c - 0.5)), i1 = Math.min(this.mapW - 1, Math.floor((x1 + m) / c - 0.5));
      const j0 = Math.max(0, Math.ceil((y0 - m) / c - 0.5)), j1 = Math.min(this.mapH - 1, Math.floor((y1 + m) / c - 0.5));
      if (i1 >= i0 && j1 >= j0) {
        const canopy = this._canopyM, forestId = this._forestTypeId, util = this.util;
        const hi0 = Math.ceil((x0 - c) / c - 0.5), hi1 = Math.floor((x1 + c) / c - 0.5);
        const hj0 = Math.ceil((y0 - c) / c - 0.5), hj1 = Math.floor((y1 + c) / c - 0.5);
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * c, rowH = j >= hj0 && j <= hj1;
          for (let i = i0; i <= i1; i++) {
            const x = (i + 0.5) * c, k = i + j * this.mapW;
            const t = util.typeAt(x, y);
            if (rowH && i >= hi0 && i <= hi1) this.farH[k] = util.heightAt(x, y);
            this.farType[k] = t;
            const hv = this.farH[k] + (t === forestId ? canopy : 0);
            this.farHDraw[k] = hv;
            if (hv > this.farMaxH) this.farMaxH = hv;
            if (hv < this.farMinH) this.farMinH = hv;
          }
        }
        this.farVersion++;
        const d = this.farDirty || (this.farDirty = { i0, j0, i1, j1 });
        if (d.i0 > i0) d.i0 = i0; if (d.j0 > j0) d.j0 = j0; if (d.i1 < i1) d.i1 = i1; if (d.j1 < j1) d.j1 = j1;
      }
    }
    return out;
  }

  /** Exact near/far height-draw bounds after a stroke (rebakeRect only widens them). */
  recomputeBounds() {
    const g = this.near;
    if (g) {
      let minH = Infinity, maxH = -Infinity;
      const canopy = this.realTrees ? 0 : this._canopyM, forestId = this._forestTypeId; // same double sums as bakeNearBand
      for (let i = 0; i < g.hDraw.length; i++) { const v = g.height[i] + (g.type[i] === forestId ? canopy : 0); if (v < minH) minH = v; if (v > maxH) maxH = v; }
      g.minH = minH; g.maxH = maxH; g.version++;
    }
    if (this.farReady) {
      let minH = Infinity, maxH = -Infinity;
      const canopy = this._canopyM, forestId = this._forestTypeId; // same double sums as _finishBake
      for (let i = 0; i < this.farH.length; i++) { const v = this.farH[i] + (this.farType[i] === forestId ? canopy : 0); if (v < minH) minH = v; if (v > maxH) maxH = v; }
      this.farMinH = minH; this.farMaxH = maxH; this.farVersion++;
    }
  }

  /** Nearest (not bilinear) `near.type` texel at (x, y), or null outside the band/before `nearReady`. */
  _nearGridType(x, y) {
    const g = this.near;
    const i = Math.floor((x - g.x0) / g.cell);
    const j = Math.floor((y - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
    return g.type[i + j * g.w];
  }

  /**
   * Physics/renderer ground height (23.1 decision 2): bilinear on the baked
   * near band when `(x, y)` falls inside it, else the analytic `heightAt`
   * (outside the band, or before `nearReady`). Exact by construction inside
   * the band; within 0.01 m of `heightAt` at the band edge (23.7 AC).
   */
  groundAt(x, y) {
    if (this.nearReady) {
      const h = this.util.gridHeight(this.near, x, y);
      if (h !== null) return h;
    }
    return this.heightAt(x, y);
  }

  /** `groundAt`'s surface normal via a 2 m central difference, written into the caller-owned `out` (no allocation - mirrors `normalAt`). */
  groundNormalAt(x, y, out) {
    const e = 2;
    const hL = this.groundAt(x - e, y);
    const hR = this.groundAt(x + e, y);
    const hD = this.groundAt(x, y - e);
    const hU = this.groundAt(x, y + e);
    const dhdx = (hR - hL) / (2 * e);
    const dhdy = (hU - hD) / (2 * e);
    const len = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
    out.x = -dhdx / len;
    out.y = -dhdy / len;
    out.z = 1 / len;
    return out;
  }

  /** Physics/renderer ground type (23.1 decision 2): nearest `near.type` texel inside the band, else the analytic `typeAt`. */
  groundTypeAt(x, y) {
    if (this.nearReady) {
      const t = this._nearGridType(x, y);
      if (t !== null) return t;
    }
    return this.typeAt(x, y);
  }

  // ---- far bake -----------------------------------------------------------

  /** Bakes the whole far grid synchronously (test/checksum oracle - AC "bit-identical to a synchronous bake"). */
  bakeFarSync() {
    this._bindEdits();
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
    this._bindEdits();
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
    let maxH = -Infinity, minH = Infinity;
    for (let i = 0; i < this.farH.length; i++) {
      const h = this.farH[i] + (this.farType[i] === forestId ? canopy : 0);
      this.farHDraw[i] = h;
      if (h > maxH) maxH = h;
      if (h < minH) minH = h;
    }
    this.farMaxH = maxH;
    this.farMinH = minH;
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
    this._bindEdits();
    const t0 = now();
    while (this._chunkQueue.length && now() - t0 < msBudget) {
      const { cx, cy } = this._chunkQueue.shift();
      const G = this.util.bakeChunk(cx, cy);
      const slot = this._slot(cx, cy);
      this._chunks[slot] = { cx, cy, h: G.height, type: G.type, version: (this._chunks[slot] ? this._chunks[slot].version : 0) + 1 };
    }
  }
}

// ME-19b: shared sampling activation and height bounds, moved from terrainCaster.
export function activeNearLOD(terrain) {
  const nl = terrain.recipe && terrain.recipe.nearLOD;
  if (!terrain.nearReady || !nl || !nl.handover || !nl.step) return null;
  return nl;
}

/**
 * US-026a S5: the combined near+far height-draw bounds (`{minH, maxH}`),
 * gated by the SAME `activeNearLOD` check as the march itself - the single
 * source of truth for both `marchTerrainRay`'s early-outs (below) and the
 * GLSL uniform upload (`GpuCellPipeline.js`'s `_uploadTerrainUniforms`,
 * `uTerrainMaxH`), so the two never compute this differently.
 */
export function terrainHBounds(terrain) {
  const nl = activeNearLOD(terrain);
  if (nl) return { maxH: Math.max(terrain.farMaxH, terrain.near.maxH), minH: Math.min(terrain.farMinH, terrain.near.minH) };
  return { maxH: terrain.farMaxH, minH: terrain.farMinH };
}
