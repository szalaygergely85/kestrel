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

/** MAP-01b (arch 38.42): the type table is data-sized from `recipe.terrain` (id = entry.id, <= 16 entries, no gaps; ids 0-4 fixed). */
const MAX_TYPES = 16;
function typeTables(look) {
  const names = TYPE_NAMES.slice(), floor = TYPE_FLOOR_MAT.slice();
  if (!look) return { names, floor };
  const keys = Object.keys(look);
  if (keys.length > MAX_TYPES) throw new Error(`Terrain: ${keys.length} terrain types (max ${MAX_TYPES})`);
  for (const k of keys) { const e = look[k]; names[e.id] = k; if (e.floor) floor[e.id] = e.floor; else if (e.id >= TYPE_FLOOR_MAT.length) floor[e.id] = 'grass'; }
  for (let i = 0; i < keys.length; i++) if (!names[i]) throw new Error(`Terrain: terrain type id gap at ${i}`);
  return { names, floor };
}

import { LookBaker, assertBlendM } from './lookBake.js';

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
    this.mapX0 = recipe.map.x0 || 0; // MAP-01b: far grid origin (default 0,0 = byte-identical)
    this.mapY0 = recipe.map.y0 || 0;
    // MAP-01b-FU: the WGSL/GLSL farTypeNearest bounds-checks both axes against mapW only
    if (this.mapW !== this.mapH) throw new Error(`Terrain: far map must be square (map.w ${this.mapW} != map.h ${this.mapH}; shaders only upload mapW)`);
    if (this.mapW > 512 || this.mapH > 512) throw new Error('Terrain: far grid max 512 x 512');
    const tt = typeTables(recipe.terrain);
    this.typeNames = tt.names; this.typeFloorMat = tt.floor;

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
    this._bb = null; // WS2-01 pending back band (beginNearBand)
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
    this._farGrid = { x0: this.mapX0, y0: this.mapY0, w: this.mapW, h: this.mapH, cell: this.mapCell, height: this.farH };
    // Same shape, but over the RENDER heights (with canopy) - the terrain
    // caster/march samples this one, never `_farGrid` (US-016).
    this._farGridDraw = { x0: this.mapX0, y0: this.mapY0, w: this.mapW, h: this.mapH, cell: this.mapCell, height: this.farHDraw };
    // Forest type id + canopy height (m), read once from the recipe (never
    // hard-coded - architecture.md 14.4 item 10 "recipe constants arrive
    // through TLOOK/uniforms from the registry", same principle in JS).
    this._forestTypeId = this.typeNames.indexOf('forest');
    this.groundLook = null; this.farLook = null; // ENV-02c: LookBaker + far RG8 look bytes (null = feature off, bytes unchanged)
    this._canopyM = (recipe.recipe && recipe.recipe.forest && recipe.recipe.forest.canopy) || 0;

    // Chunk geometry (AUD-04: the dormant 3x3 resident ring was removed; the near band is the only near truth).
    this.chunkSize = (recipe.chunk && recipe.chunk.size) || 128;
    this.nearCell = (recipe.chunk && recipe.chunk.nearCell) || 2;

    // US-026a (architecture.md 23.1 item 1): one contiguous 3x3-chunk near
    // band, baked once (synchronously) at World.load, never streamed/
    // regenerated in this story (that's US-026b's `chunk()`/`setCenter()`/
    // `bakeChunkStep()` above, untouched by this feature).
    this.near = null;
    this.nearReady = false;
    // Reused output object for `groundNormalAt` central-difference reads of
    // `groundAt` (rule 9: no per-call allocation on the query path).
    this._groundNormalScratch = { x: 0, y: 0, z: 1 };
    // BEAST-ALLOC-02 (arch 38.61): caller-owned *Out forms write doubles into Float64Arrays (no boxed returns).
    this._gOut4 = new Float64Array(4);
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

  /** NAV-PERF-01: central-difference step of `normalAt` and (when equal) of the recipe's typeAt slope; lets a baker on a grid of this cell size reuse one padded height ring. */
  get normalEps() { return 2; }

  /**
   * `typeAt` handed the four neighbour heights heightAt(x+e,y)/(x-e,y)/(x,y+e)/(x,y-e), e = `normalEps`, by a caller that already holds them
   * (saves 4 heightAt). Bit-identical to `typeAt` when the recipe's slopeEps equals `normalEps`; otherwise the hints are ignored.
   */
  typeAtWithHeights(x, y, hxp, hxm, hyp, hym) {
    this._bindEdits();
    const r = this.recipe.recipe;
    return (r && r.slopeEps === 2) ? this.util.typeAt(x, y, hxp, hxm, hyp, hym) : this.util.typeAt(x, y);
  }

  /** Material key name for a terrain type id (query/physics use only, US-025 - castTerrain itself lands in US-016). */
  floorMatFor(typeId) {
    return this.typeFloorMat[typeId] || 'grass';
  }

  typeName(typeId) {
    return this.typeNames[typeId] || 'grass';
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
  bakeNearBand(cx0, cy0, cw, ch) {
    // WS1-02 (arch 38.36): chunk RECT form `(cx0, cy0, cw, ch)` (non-square band, cw/ch 1..6). The legacy
    // 2-arg call `(cx, cy)` = the 3x3 band centred on chunk (cx, cy) = `(cx-1, cy-1, 3, 3)`, byte-identical.
    if (cw === undefined) { cx0 -= 1; cy0 -= 1; cw = 3; ch = 3; }
    if (!Number.isInteger(cw) || !Number.isInteger(ch) || cw < 1 || ch < 1 || cw > 6 || ch > 6) throw new Error(`bakeNearBand: cw/ch must be integers 1..6 (got ${cw}x${ch})`);
    this._bindEdits();
    const n = this.chunkSize / this.nearCell; // 64 near-cells per 128 m chunk
    const w = cw * n, h = ch * n;
    const x0 = cx0 * this.chunkSize;
    const y0 = cy0 * this.chunkSize;
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
    if (this.groundLook) { this.near.look = new Uint8Array(w * h * 2); this._fillNearLook(this.near); }
    this.nearReady = true;
  }

  // ---- stepped near-band re-bake (WS2-01, arch 38.38) -----------------------

  /**
   * Starts a background bake of a new near band `(cx0, cy0, cw, ch)` (chunk rect, same-size as the
   * current band in v1 so textures/mesh grids never realloc). Allocates FRESH back arrays (rare event,
   * no pooling: terrainMesh keys on the `near` object identity) and copies the cells that overlap the
   * current `near` (the bake is per-cell pure, so copy == re-bake, bit-identical). `nearBandStep`
   * then bakes the missing cells in row slices; `swapNearBand` publishes atomically. A pending bake is replaced.
   */
  beginNearBand(cx0, cy0, cw, ch) {
    const st = this.newBandState(cx0, cy0, cw, ch, this.near);
    this._bb = st;
    return st.b;
  }

  /**
   * ENV-02c (arch 38.63): turns the per-texel look bytes on (cfg = World opt `groundLook`) or off (null). Call before the bakes; an
   * already baked far grid / near band is filled at once. `cfg.blendM` (smallest biome blend, m), when given, must be >= 3 far texels.
   */
  setGroundLook(cfg) {
    // farVersion bump (arch REV-ENV02D): hosts key FARLOOK on it; smaller than a new lookVersion (same set of consumers re-key, toggle is rare/editor-only)
    if (!cfg) { this.groundLook = null; this.farLook = null; if (this.near) delete this.near.look; if (this.farReady) this.farVersion++; return; }
    if (cfg.blendM !== undefined) assertBlendM(cfg.blendM, this.mapCell);
    this.groundLook = new LookBaker(cfg, this.util);
    this.farLook = new Uint8Array(this.mapW * this.mapH * 2);
    if (this.farReady) { this._fillFarLook(); this.farVersion++; }
    if (this.nearReady) { const g = this.near; g.look = new Uint8Array(g.w * g.h * 2); this._fillNearLook(g); g.version++; }
  }
  _fillFarLook() {
    const L = this.groundLook, w = this.mapW, c = this.mapCell;
    for (let j = 0; j < this.mapH; j++) for (let i = 0; i < w; i++) L.bakeCell(this.mapX0 + (i + 0.5) * c, this.mapY0 + (j + 0.5) * c, this.farType[i + j * w], this.farLook, i + j * w);
  }
  _fillNearLook(g) {
    const L = this.groundLook, c = g.cell;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) L.bakeCell(g.x0 + (i + 0.5) * c, g.y0 + (j + 0.5) * c, g.type[i + j * g.w], g.look, i + j * g.w);
  }

  /**
   * OB109-B1 (38.58): the back-band state of `beginNearBand`, WITHOUT touching `_bb` / `near`. `src` = band to copy the
   * overlap from (`terrain.near`, a cached bundle's near, or null = bake every cell; per-cell pure so bytes are identical).
   * Drive it with `stepBandState`, finish with `finishBandState`.
   */
  newBandState(cx0, cy0, cw, ch, src) {
    if (!Number.isInteger(cw) || !Number.isInteger(ch) || cw < 1 || ch < 1 || cw > 6 || ch > 6) throw new Error(`beginNearBand: cw/ch must be integers 1..6 (got ${cw}x${ch})`);
    const cur = src || null, n = this.chunkSize / this.nearCell;
    const w = cw * n, h = ch * n, x0 = cx0 * this.chunkSize, y0 = cy0 * this.chunkSize;
    const HC = cur ? cur.height.constructor : Float32Array, TC = cur ? cur.type.constructor : Uint8Array, DC = cur ? cur.hDraw.constructor : Float32Array;
    const b = { x0, y0, w, h, cell: this.nearCell, height: new HC(w * h), type: new TC(w * h), hDraw: new DC(w * h), minH: 0, maxH: 0, version: 0 };
    if (this.groundLook) b.look = new Uint8Array(w * h * 2); // ENV-02c: (lo | hi << 4, w_hi) per texel
    // overlap in new-band cell coords [ox0,ox1) x [oy0,oy1)
    let ox0 = 0, ox1 = 0, oy0 = 0, oy1 = 0;
    // AUD-31: minH/maxH accumulated while copying/baking (same formula swapNearBand used in its own full pass)
    const can = this.realTrees ? 0 : this._canopyM, fid = this._forestTypeId;
    let mn = Infinity, mx = -Infinity, cpSrc = null, cpDx = 0, cpDy = 0;
    if (cur && cur.cell === b.cell) {
      const dx = Math.round((cur.x0 - x0) / b.cell), dy = Math.round((cur.y0 - y0) / b.cell); // cur origin in new coords
      ox0 = Math.max(0, dx); ox1 = Math.min(w, dx + cur.w); oy0 = Math.max(0, dy); oy1 = Math.min(h, dy + cur.h);
      if (ox1 > ox0 && oy1 > oy0) { cpSrc = cur; cpDx = dx; cpDy = dy; } // WM-02b: rows are copied in stepBandState (sliced)
      else { ox0 = ox1 = oy0 = oy1 = 0; }
    }
    return { b, ox0, ox1, oy0, oy1, row: 0, side: 0, sRow: 0, cur: 0, ce: 0, ready: false, mn, mx, canopy: can, fid, cx0, cy0, cw, ch, cpSrc, cpDx, cpDy, cpRow: oy0, sliceMs: 0, lastT: 0, late: 0 };
  }

  /** True while a back band is baking or waiting to be swapped. */
  get nearBandPending() { return this._bb != null; }
  /** Rect of the pending back band (`{cx0,cy0,cw,ch}` fields of the internal state) or null. */
  cancelNearBand() { this._bb = null; }

  /**
   * Bakes missing rows of the pending band until `msBudget` ms are used (always >= 1 slice of progress).
   * Per slice: one `util.bake` of a full row, or of the left/right spans around the overlap (documented
   * per-slice alloc exception, arch 38.38). Returns true once the band is complete.
   */
  nearBandStep(msBudget) {
    const st = this._bb;
    if (!st) return false;
    return this.stepBandState(st, msBudget);
  }

  /** OB109-B1: `nearBandStep` for an explicit state (see `newBandState`). */
  stepBandState(st, msBudget) {
    if (st.ready) return true;
    this._bindEdits();
    const b = st.b, w = b.w, h = b.h, cell = b.cell;
    const canopy = this.realTrees ? 0 : this._canopyM, forestId = this._forestTypeId;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let units = 0, late = 0; // arch fix: units (copy row / 32-cell slice) STARTED after the budget was already used up (deterministic overshoot count, <= 1 per call)
    if (st.cpSrc) { // WM-02b: overlap copy, row by row under the same budget (min/max order is irrelevant)
      const cur = st.cpSrc, dx = st.cpDx, dy = st.cpDy, len = st.ox1 - st.ox0, can = st.canopy, fid = st.fid;
      while (st.cpRow < st.oy1) {
        if (units++ > 0 && st.lastT - t0 >= msBudget) late++;
        const j = st.cpRow++, s0 = (j - dy) * cur.w + (st.ox0 - dx), d0 = j * w + st.ox0;
        b.height.set(cur.height.subarray(s0, s0 + len), d0);
        b.type.set(cur.type.subarray(s0, s0 + len), d0);
        b.hDraw.set(cur.hDraw.subarray(s0, s0 + len), d0);
        if (b.look) {
          if (cur.look) b.look.set(cur.look.subarray(s0 * 2, (s0 + len) * 2), d0 * 2);
          else { const L = this.groundLook, ey = b.y0 + (j + 0.5) * cell; for (let q = 0; q < len; q++) L.bakeCell(b.x0 + (st.ox0 + q + 0.5) * cell, ey, b.type[d0 + q], b.look, d0 + q); } // source baked before the look was on
        }
        let mn = st.mn, mx = st.mx;
        for (let i = d0, e = d0 + len; i < e; i++) { const v = b.height[i] + (b.type[i] === fid ? can : 0); if (v < mn) mn = v; if (v > mx) mx = v; }
        st.mn = mn; st.mx = mx;
        st.lastT = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (st.lastT - t0 >= msBudget) { st.late = late; return false; }
      }
      st.cpSrc = null;
    }
    while (st.row < h || st.cur < st.ce) {
      if (st.cur >= st.ce) { // next column span; WM-02: a span is baked in <= 32-cell slices so a 2 ms budget holds (cells are pure: bytes unchanged)
        const r = st.row;
        const inOv = r >= st.oy0 && r < st.oy1;
        if (!inOv) { st.cur = 0; st.ce = w; st.row++; }
        else if (st.side === 0) { st.cur = 0; st.ce = st.ox0; st.side = 1; }
        else { st.cur = st.ox1; st.ce = w; st.side = 0; st.row++; }
        st.sRow = r;
        if (st.ce <= st.cur) { st.cur = st.ce = 0; continue; }
      }
      const r = st.sRow, cs = st.cur, ce = Math.min(st.ce, cs + 32), s0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (units++ > 0 && s0 - t0 >= msBudget) late++;
      st.cur = ce; if (st.cur >= st.ce) st.cur = st.ce; // slice end; span done when cur reaches ce
      if (ce > cs) {
        const G = this.util.bake(b.x0 + cs * cell, b.y0 + r * cell, cell, ce - cs, 1);
        const o = r * w + cs;
        for (let i = 0; i < ce - cs; i++) {
          const hv = G.height[i];
          b.height[o + i] = hv; b.type[o + i] = G.type[i];
          b.hDraw[o + i] = hv + (G.type[i] === forestId ? canopy : 0);
          if (b.look) this.groundLook.bakeCell(b.x0 + (cs + i + 0.5) * cell, b.y0 + (r + 0.5) * cell, G.type[i], b.look, o + i);
          const v = b.height[o + i] + (b.type[o + i] === st.fid ? st.canopy : 0);
          if (v < st.mn) st.mn = v; if (v > st.mx) st.mx = v;
        }
      }
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now(), ds = t1 - s0;
      st.sliceMs = st.sliceMs > ds ? st.sliceMs * 0.98 + ds * 0.02 : ds; // WM-02b: predictive stop (decaying max slice cost)
      st.lastT = t1;
      if (t1 - t0 + st.sliceMs >= msBudget) break;
    }
    st.late = late;
    if (st.row >= h && st.cur >= st.ce) st.ready = true;
    return st.ready;
  }

  /** Atomic publish: the finished back band becomes `terrain.near` (new object identity, version+1). Throws if not ready. */
  swapNearBand() {
    const st = this._bb;
    if (!st || !st.ready) throw new Error('swapNearBand: no finished back band');
    const b = this.finishBandState(st);
    this.publishBand(b);
    this._bb = null;
    return b;
  }

  /** OB109-B1: finalises a finished state's bounds and returns its band (version 0 until published). */
  finishBandState(st) {
    if (!st.ready) throw new Error('finishBandState: band not ready');
    const b = st.b;
    b.minH = st.mn; b.maxH = st.mx; // AUD-31: accumulated in newBandState/stepBandState (no full pass here)
    return b;
  }

  /** OB109-B2 (38.58): makes a finished (possibly cached) band `near`; version = old + 1 (the only change a cached band ever gets). */
  publishBand(b) {
    b.version = (this.near ? this.near.version : 0) + 1;
    this.near = b; this.nearReady = true;
    return b;
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
    if (this.onRebake) this.onRebake(x0, y0, x1, y1); // OB109-B2: World drops overlapping cached bands
    this._bindEdits();
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
            if (g.look) this.groundLook.bakeCell(x, y, t, g.look, k);
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
      const c = this.mapCell, m = c + eps, ox = this.mapX0, oy = this.mapY0;
      const i0 = Math.max(0, Math.ceil((x0 - ox - m) / c - 0.5)), i1 = Math.min(this.mapW - 1, Math.floor((x1 - ox + m) / c - 0.5));
      const j0 = Math.max(0, Math.ceil((y0 - oy - m) / c - 0.5)), j1 = Math.min(this.mapH - 1, Math.floor((y1 - oy + m) / c - 0.5));
      if (i1 >= i0 && j1 >= j0) {
        const canopy = this._canopyM, forestId = this._forestTypeId, util = this.util;
        const hi0 = Math.ceil((x0 - ox - c) / c - 0.5), hi1 = Math.floor((x1 - ox + c) / c - 0.5);
        const hj0 = Math.ceil((y0 - oy - c) / c - 0.5), hj1 = Math.floor((y1 - oy + c) / c - 0.5);
        for (let j = j0; j <= j1; j++) {
          const y = oy + (j + 0.5) * c, rowH = j >= hj0 && j <= hj1;
          for (let i = i0; i <= i1; i++) {
            const x = ox + (i + 0.5) * c, k = i + j * this.mapW;
            const t = util.typeAt(x, y);
            if (rowH && i >= hi0 && i <= hi1) this.farH[k] = util.heightAt(x, y);
            this.farType[k] = t;
            if (this.farLook) this.groundLook.bakeCell(x, y, t, this.farLook, k);
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

  /**
   * Buffer core of `groundAt` (BEAST-ALLOC-02, arch 38.61 2b): reads b[0]=x, b[1]=y, writes b[2]=height. Same value bit for bit as
   * `groundAt`: the near-band bilinear is the recipe's `util.gridHeight` formula inlined (design contract: bilinear on a baked grid,
   * cell centres at +0.5); outside the band the analytic `heightAt`. No double args / boxed returns cross the call.
   */
  _groundCore(b) {
    const x = b[0], y = b[1];
    if (this.nearReady) {
      const G = this.near;
      const fx = (x - (G.x0 || 0)) / G.cell - 0.5, fy = (y - (G.y0 || 0)) / G.cell - 0.5;
      const i = Math.floor(fx), j = Math.floor(fy);
      if (!(i < 0 || j < 0 || i >= G.w - 1 || j >= G.h - 1)) {
        const u = fx - i, v = fy - j, W = G.w, H0 = G.height;
        const a = H0[i + j * W], c0 = H0[i + 1 + j * W], c = H0[i + (j + 1) * W], d = H0[i + 1 + (j + 1) * W];
        b[2] = a + (c0 - a) * u + (c - a) * v + (a - c0 - c + d) * u * v;
        return;
      }
    }
    b[2] = this.heightAt(x, y);
  }

  /** `groundAt` for caller buffer `io`: in io[0]=x, io[1]=y; out io[3]=height (io[2] is left alone). */
  groundAtBuf(io) {
    const t = this._gOut4;
    t[0] = io[0]; t[1] = io[1];
    this._groundCore(t);
    io[3] = t[2];
  }

  /** `groundNormalAt` for caller buffer `io`: in io[0]=x, io[1]=y; out io[4..6]=(nx, ny, nz); bit-identical to it. */
  groundNormalAtBuf(io) {
    const e = 2, t = this._gOut4, x = io[0], y = io[1];
    t[0] = x - e; t[1] = y; this._groundCore(t); const hL = t[2];
    t[0] = x + e; t[1] = y; this._groundCore(t); const hR = t[2];
    t[0] = x; t[1] = y - e; this._groundCore(t); const hD = t[2];
    t[0] = x; t[1] = y + e; this._groundCore(t); const hU = t[2];
    const dhdx = (hR - hL) / (2 * e);
    const dhdy = (hU - hD) / (2 * e);
    const len = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
    io[4] = -dhdx / len;
    io[5] = -dhdy / len;
    io[6] = 1 / len;
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
    if (this.groundLook) this._fillFarLook();
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
      const y = this.mapY0 + (this._bakeRow + 0.5) * cell;
      const rowBase = this._bakeRow * w;
      while (col < w) {
        const x = this.mapX0 + (col + 0.5) * cell;
        this.farH[rowBase + col] = this.util.heightAt(x, y);
        this.farType[rowBase + col] = this.util.typeAt(x, y);
        if (this.farLook) this.groundLook.bakeCell(x, y, this.farType[rowBase + col], this.farLook, rowBase + col);
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
    if (this.farLook) for (let i = 0; i < this.farLook.length; i++) { h ^= this.farLook[i]; h = Math.imul(h, 0x01000193); } // ENV-02c: only with looks on
    return h >>> 0;
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
