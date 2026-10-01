// @ts-check
import { minNormalZFromSlopeDeg } from '../core/transform.js';

// engine/nav/NavGrid.js (RE-05, docs/architecture.md 28.2). Leaf module:
// engine/nav/** may only import engine/nav/** + engine/core/** (check-deps
// rule 14). World is passed into `buildFromWorld` as a duck-typed parameter
// - this file never imports engine/world.
//
// Layout: cell index i = cy*w + cx. World metres convert through the
// origin: cellX(x) = floor((x-x0)/cell), cellCenterX(cx) = x0 + (cx+0.5)*cell.
//
//   terrainCost  Uint8Array(N)  0 = unwalkable (slope/type/structure/mask);
//                               1..254 = entry-cost multiplier; derived, never saved.
//   blockCount   Uint16Array(N) footprints covering the cell (RE-10). This
//                               story never writes it (stays 0 everywhere)
//                               but allocates it so RE-10 can extend `cost`
//                               without changing NavGrid's shape.
//   cost         Uint8Array(N)  blockCount>0 ? 0 : terrainCost - the ONLY
//                               array A* and the flow field read.
//   height       Float32Array(N) analytic ground z at the centre (info only).
//   version      int, +1 per build/change; dirty = ring of 8
//                {version, cx0, cy0, cx1, cy1} (half-open), see `takeDirty`.
//   minCost      smallest non-zero cost value (A* heuristic scale).
//
// Do not: sample `groundAt` for walkability (camera-dependent, would make
// nav differ between sessions) - only the analytic terrain queries.
//
// Footprints (RE-10): `block`/`unblock`/`blockWorldRect` maintain `cost` and
// `minCost` incrementally (never a full-grid rescan) via a histogram of how
// many *currently walkable* (blockCount === 0) cells hold each terrainCost
// value 1..254 - `_costHist[v]`. `minCost` is the smallest `v` with
// `_costHist[v] > 0`. The owner table (ownerId -> rect/mask) and the mask
// pool are preallocated at construction (`maxBlockers`, `maxFootprintCells`)
// so `block`/`unblock` never allocate.

const DIRTY_RING_SIZE = 8;

export class NavGrid {
  /** @param {{x0:number, y0:number, w:number, h:number, cell?:number, maxBlockers?:number, maxFootprintCells?:number}} opts */
  constructor({ x0, y0, w, h, cell = 1, maxBlockers = 1024, maxFootprintCells = 1024 }) {
    this.x0 = x0;
    this.y0 = y0;
    this.w = w | 0;
    this.h = h | 0;
    this.cell = cell;
    const n = this.w * this.h;
    this.terrainCost = new Uint8Array(n);
    this.blockCount = new Uint16Array(n);
    this.cost = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.version = 0;
    this.minCost = 1;

    // Cost histogram over currently-walkable cells (index = terrainCost
    // value 1..254), kept in sync by `_recomputeCost`/`block`/`unblock` so
    // `minCost` never needs a full-grid rescan.
    this._costHist = new Uint32Array(256);

    // Footprint owner table (RE-10), preallocated for `maxBlockers` slots.
    this._maxBlockers = maxBlockers | 0;
    this._maxFootprintCells = maxFootprintCells | 0;
    this._slotOwner = new Int32Array(this._maxBlockers);
    this._slotX0 = new Int16Array(this._maxBlockers);
    this._slotY0 = new Int16Array(this._maxBlockers);
    this._slotX1 = new Int16Array(this._maxBlockers);
    this._slotY1 = new Int16Array(this._maxBlockers);
    this._slotHasMask = new Uint8Array(this._maxBlockers);
    this._maskPool = new Uint8Array(this._maxBlockers * this._maxFootprintCells);
    this._freeList = new Int32Array(this._maxBlockers);
    for (let i = 0; i < this._maxBlockers; i++) this._freeList[i] = this._maxBlockers - 1 - i;
    this._freeTop = this._maxBlockers;
    /** @type {Map<number, number>} ownerId -> slot. Only touched by
     * block/unblock/loadBlockers (not a per-tick hot path). */
    this._ownerSlot = new Map();

    // Dirty ring: last `DIRTY_RING_SIZE` {version, rect} pushes, oldest
    // overwritten first. See `takeDirty`.
    this._dirtyVersion = new Int32Array(DIRTY_RING_SIZE);
    this._dirtyX0 = new Int16Array(DIRTY_RING_SIZE);
    this._dirtyY0 = new Int16Array(DIRTY_RING_SIZE);
    this._dirtyX1 = new Int16Array(DIRTY_RING_SIZE);
    this._dirtyY1 = new Int16Array(DIRTY_RING_SIZE);
    this._dirtyCount = 0;
  }

  cellX(x) { return Math.floor((x - this.x0) / this.cell); }
  cellY(y) { return Math.floor((y - this.y0) / this.cell); }
  cellCenterX(cx) { return this.x0 + (cx + 0.5) * this.cell; }
  cellCenterY(cy) { return this.y0 + (cy + 0.5) * this.cell; }
  index(cx, cy) { return cy * this.w + cx; }
  inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }

  /** Recomputes `cost`/`minCost`/`_costHist` from `terrainCost`/`blockCount`
   * over the whole grid. Called after a full build (`buildFromWorld`/
   * `buildFromArrays`); `block`/`unblock` instead update `cost` and the
   * histogram incrementally over just their rect. */
  _recomputeCost() {
    const n = this.w * this.h;
    this._costHist.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.blockCount[i] > 0 ? 0 : this.terrainCost[i];
      this.cost[i] = c;
      if (c > 0) this._costHist[c]++;
    }
    this._updateMinCost();
    this.version++;
  }

  /** Sets `minCost` to the smallest histogram bucket with a live cell,
   * or 1 if none (grid fully unwalkable/blocked). O(254), not O(N). */
  _updateMinCost() {
    const hist = this._costHist;
    for (let v = 1; v < hist.length; v++) {
      if (hist[v] > 0) { this.minCost = v; return; }
    }
    this.minCost = 1;
  }

  /** Pushes a dirty rect into the ring, overwriting the oldest slot once
   * full. `version` is stamped at push time. */
  _pushDirty(cx0, cy0, cx1, cy1) {
    const i = this._dirtyCount % DIRTY_RING_SIZE;
    this._dirtyVersion[i] = this.version;
    this._dirtyX0[i] = cx0;
    this._dirtyY0[i] = cy0;
    this._dirtyX1[i] = cx1;
    this._dirtyY1[i] = cy1;
    this._dirtyCount++;
  }

  /**
   * Writes every dirty rect pushed after `sinceVersion` into `outCells`
   * (Int32Array, caller-owned, >= 4*8 = 32 entries), oldest first, as
   * `[cx0,cy0,cx1,cy1, ...]` (half-open cell rects). Returns the rect
   * count written, or **-1** if the ring has wrapped past `sinceVersion`
   * (some changes between `sinceVersion` and the oldest rect still in the
   * ring were overwritten and lost) - the caller must then treat the whole
   * grid as dirty and use `grid.version` as its new watermark. Zero
   * allocation.
   * @param {number} sinceVersion
   * @param {Int32Array} outCells
   */
  takeDirty(sinceVersion, outCells) {
    const total = this._dirtyCount;
    if (total === 0 || sinceVersion >= this.version) return 0;
    const kept = total < DIRTY_RING_SIZE ? total : DIRTY_RING_SIZE;
    const oldestKeptVersion = this._dirtyVersion[(total - kept) % DIRTY_RING_SIZE];
    if (sinceVersion < oldestKeptVersion - 1) return -1;
    let n = 0;
    for (let k = 0; k < kept; k++) {
      const idx = (total - kept + k) % DIRTY_RING_SIZE;
      if (this._dirtyVersion[idx] <= sinceVersion) continue;
      outCells[n * 4] = this._dirtyX0[idx];
      outCells[n * 4 + 1] = this._dirtyY0[idx];
      outCells[n * 4 + 2] = this._dirtyX1[idx];
      outCells[n * 4 + 3] = this._dirtyY1[idx];
      n++;
    }
    return n;
  }

  /**
   * Blocks `[cx0,cy0)..(cx1,cy1)` (half-open cell rect, clamped to the
   * grid) for `ownerId`. `maskU8`, if given, is row-major over the rect
   * (`(cy-cy0)*(cx1-cx0) + (cx-cx0)`, 1 = this cell is part of the
   * footprint) - omit it to block every cell in the rect. Increments
   * `blockCount` per covered cell, recomputes `cost`/`minCost` in the
   * rect, bumps `version` once and pushes one dirty rect. Throws if
   * `ownerId` is already blocked or the owner table (`maxBlockers`) is
   * full. Zero allocation (the owner table and mask pool are
   * preallocated).
   * @param {number} ownerId
   * @param {number} cx0 @param {number} cy0 @param {number} cx1 @param {number} cy1
   * @param {Uint8Array} [maskU8]
   */
  block(ownerId, cx0, cy0, cx1, cy1, maskU8) {
    if (this._ownerSlot.has(ownerId)) {
      throw new Error(`NavGrid.block: owner ${ownerId} is already blocked`);
    }
    if (this._freeTop === 0) {
      throw new Error(`NavGrid.block: maxBlockers (${this._maxBlockers}) exceeded`);
    }
    cx0 = cx0 < 0 ? 0 : cx0;
    cy0 = cy0 < 0 ? 0 : cy0;
    cx1 = cx1 > this.w ? this.w : cx1;
    cy1 = cy1 > this.h ? this.h : cy1;
    const rw = cx1 - cx0;
    const rh = cy1 - cy0;
    const hasMask = !!maskU8;
    if (hasMask) {
      const cells = rw > 0 && rh > 0 ? rw * rh : 0;
      if (cells > this._maxFootprintCells) {
        throw new Error(`NavGrid.block: footprint (${cells} cells) exceeds maxFootprintCells (${this._maxFootprintCells})`);
      }
    }

    const slot = this._freeList[--this._freeTop];
    this._slotOwner[slot] = ownerId;
    this._slotX0[slot] = cx0;
    this._slotY0[slot] = cy0;
    this._slotX1[slot] = cx1;
    this._slotY1[slot] = cy1;
    this._slotHasMask[slot] = hasMask ? 1 : 0;
    if (hasMask) {
      const base = slot * this._maxFootprintCells;
      const cells = rw * rh;
      for (let i = 0; i < cells; i++) this._maskPool[base + i] = maskU8[i] ? 1 : 0;
    }
    this._ownerSlot.set(ownerId, slot);

    const hist = this._costHist;
    for (let cy = cy0; cy < cy1; cy++) {
      for (let cx = cx0; cx < cx1; cx++) {
        if (hasMask) {
          const mi = (cy - cy0) * rw + (cx - cx0);
          if (!this._maskPool[slot * this._maxFootprintCells + mi]) continue;
        }
        const i = this.index(cx, cy);
        if (this.blockCount[i] === 0) {
          const tc = this.terrainCost[i];
          if (tc > 0) hist[tc]--;
          this.cost[i] = 0;
        }
        this.blockCount[i]++;
      }
    }
    this._updateMinCost();
    this.version++;
    this._pushDirty(cx0, cy0, cx1, cy1);
  }

  /**
   * Removes `ownerId`'s footprint, restoring `blockCount`/`cost` for every
   * cell it covered (byte-identical to before `block` if no other owner
   * overlapped it). Bumps `version` once and pushes one dirty rect. Throws
   * if `ownerId` is not currently blocked. Zero allocation.
   * @param {number} ownerId
   */
  unblock(ownerId) {
    const slot = this._ownerSlot.get(ownerId);
    if (slot === undefined) {
      throw new Error(`NavGrid.unblock: owner ${ownerId} is not blocked`);
    }
    const cx0 = this._slotX0[slot];
    const cy0 = this._slotY0[slot];
    const cx1 = this._slotX1[slot];
    const cy1 = this._slotY1[slot];
    const hasMask = this._slotHasMask[slot] === 1;
    const rw = cx1 - cx0;

    const hist = this._costHist;
    for (let cy = cy0; cy < cy1; cy++) {
      for (let cx = cx0; cx < cx1; cx++) {
        if (hasMask) {
          const mi = (cy - cy0) * rw + (cx - cx0);
          if (!this._maskPool[slot * this._maxFootprintCells + mi]) continue;
        }
        const i = this.index(cx, cy);
        this.blockCount[i]--;
        if (this.blockCount[i] === 0) {
          const tc = this.terrainCost[i];
          this.cost[i] = tc;
          if (tc > 0) hist[tc]++;
        }
      }
    }

    this._ownerSlot.delete(ownerId);
    this._freeList[this._freeTop++] = slot;
    this._updateMinCost();
    this.version++;
    this._pushDirty(cx0, cy0, cx1, cy1);
  }

  /**
   * World-space convenience over `block`: covers every cell the rect
   * `[x0,x1) x [y0,y1)` overlaps by more than 1e-6 m (a rect edge exactly
   * on a cell boundary does not pull in the outside neighbour cell).
   * @param {number} ownerId
   * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   * @param {Uint8Array} [maskU8]
   */
  blockWorldRect(ownerId, x0, y0, x1, y1, maskU8) {
    const EPS = 1e-6;
    const cx0 = Math.floor((x0 - this.x0) / this.cell + EPS);
    const cy0 = Math.floor((y0 - this.y0) / this.cell + EPS);
    const cx1 = Math.ceil((x1 - this.x0) / this.cell - EPS);
    const cy1 = Math.ceil((y1 - this.y0) / this.cell - EPS);
    this.block(ownerId, cx0, cy0, cx1, cy1, maskU8);
  }

  /**
   * Snapshots every current footprint as
   * `[{owner, rect:[cx0,cy0,cx1,cy1], mask?:number[]}]`, sorted by owner.
   * May allocate (28.2: constructors/`create*`/`buildFromWorld`/
   * `saveBlockers` are the allocating calls).
   */
  saveBlockers() {
    const owners = Array.from(this._ownerSlot.keys()).sort((a, b) => a - b);
    const out = new Array(owners.length);
    for (let k = 0; k < owners.length; k++) {
      const owner = owners[k];
      const slot = this._ownerSlot.get(owner);
      const cx0 = this._slotX0[slot];
      const cy0 = this._slotY0[slot];
      const cx1 = this._slotX1[slot];
      const cy1 = this._slotY1[slot];
      /** @type {{owner:number, rect:number[], mask?:number[]}} */
      const rec = { owner, rect: [cx0, cy0, cx1, cy1] };
      if (this._slotHasMask[slot] === 1) {
        const rw = cx1 - cx0;
        const rh = cy1 - cy0;
        const cells = rw * rh;
        const base = slot * this._maxFootprintCells;
        const mask = new Array(cells);
        for (let i = 0; i < cells; i++) mask[i] = this._maskPool[base + i];
        rec.mask = mask;
      }
      out[k] = rec;
    }
    return out;
  }

  /**
   * Clears every current footprint, then re-applies `arr` (the
   * `saveBlockers` shape) in order via `block`. Not a hot-path call
   * (load time / footprint-set restore), so - like `buildFromWorld` - it
   * may allocate.
   * @param {{owner:number, rect:number[], mask?:number[]}[]} arr
   */
  loadBlockers(arr) {
    for (const owner of Array.from(this._ownerSlot.keys())) this.unblock(owner);
    for (const rec of arr) {
      const [cx0, cy0, cx1, cy1] = rec.rect;
      const mask = rec.mask ? Uint8Array.from(rec.mask) : undefined;
      this.block(rec.owner, cx0, cy0, cx1, cy1, mask);
    }
  }

  /**
   * Hashes deterministic sim state into `h` (duck-typed external hasher,
   * see engine/core/hash.js's `createHasher()` - only `h.u32`/`h.u8Array`
   * are used; NavGrid never imports hash.js). Per the architect: over
   * `blockCount`/`cost` only, NEVER `_ownerSlot`/the slot tables - the
   * owner-id -> slot bookkeeping is not part of deterministic sim state
   * (two grids that reached the same blockCount/cost via a different
   * owner-id allocation history must hash identically). `blockCount` is a
   * Uint16Array with no dedicated batch method on `h`, so it's mixed word
   * by word via `h.u32`; `cost` (Uint8Array) uses `h.u8Array` directly.
   */
  hashInto(h) {
    const blockCount = this.blockCount;
    for (let i = 0; i < blockCount.length; i++) h.u32(blockCount[i]);
    h.u8Array(this.cost, 0, this.cost.length);
  }

  /**
   * RE-05c: second pass over `height`, after the per-cell walkability pass
   * and before `_recomputeCost()`. A still-walkable cell is dropped
   * (`terrainCost` forced to 0) if any in-grid 8-neighbour's height differs
   * by more than `maxStepM`. No-op (and zero allocation) when `maxStepM` is
   * `Infinity` - today's behaviour, the default for callers that don't pass
   * it. The decision is made into a scratch `Uint8Array(N)` first from the
   * first-pass `terrainCost`/`height` only, then applied - so a drop never
   * cascades into making a neighbour drop within the same pass (order
   * independent). The scratch buffer is lazily allocated once per grid size
   * and reused across builds.
   * @param {number} maxStepM
   */
  _applyMaxStepM(maxStepM) {
    if (!(maxStepM < Infinity)) return;
    const w = this.w, h = this.h, n = w * h;
    const height = this.height;
    const terrainCost = this.terrainCost;
    if (!this._stepDrop || this._stepDrop.length !== n) this._stepDrop = new Uint8Array(n);
    const drop = this._stepDrop;
    drop.fill(0);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const i = this.index(cx, cy);
        if (terrainCost[i] === 0) continue; // already unwalkable, nothing to drop
        const hi = height[i];
        let bad = false;
        for (let dy = -1; dy <= 1 && !bad; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (Math.abs(height[this.index(nx, ny)] - hi) > maxStepM) { bad = true; break; }
          }
        }
        if (bad) drop[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      if (drop[i]) terrainCost[i] = 0;
    }
  }

  /**
   * Walkability from a (possibly fake, duck-typed) world's ANALYTIC terrain
   * queries - load time only, <= 50 ms at 256x256 (28.2 budget). Per cell
   * centre: unwalkable if `normal.z < cos(opts.maxSlopeDeg)` (default 30),
   * if `terrain.typeName(typeAt)` is in `opts.blockedTypes` (default
   * `['water']`), if `world.structureAt(x,y)` is truthy (structures block
   * in v1), or if `opts.mask[i]`. Otherwise
   * `terrainCost = opts.typeCost[typeName] ?? 1`. Every threshold comes
   * from `opts`, never a literal in the comparison itself. `opts.minNormalZ`
   * sets the walkability threshold directly (skips the degrees conversion)
   * when present; otherwise it is derived from `opts.maxSlopeDeg` via
   * `minNormalZFromSlopeDeg` (engine/core/transform.js — the one place this
   * trig conversion is allowed to live, rule 15). `opts.maxStepM`
   * (default `Infinity`, RE-05c) then drops any still-walkable cell next to
   * an in-grid 8-neighbour whose height differs by more than `maxStepM` -
   * see `_applyMaxStepM`.
   * @param {{terrain: {heightAt(x:number,y:number):number, normalAt(x:number,y:number,out:{x:number,y:number,z:number}):void, typeAt(x:number,y:number):number, typeName(id:number):string}, structureAt?: (x:number,y:number)=>boolean}} world
   * @param {{maxSlopeDeg?:number, minNormalZ?:number, blockedTypes?:string[], typeCost?:Record<string,number>, mask?:Uint8Array|null, maxStepM?:number}} [opts]
   */
  buildFromWorld(world, opts = {}) {
    const cosThresh = opts.minNormalZ ?? minNormalZFromSlopeDeg(opts.maxSlopeDeg ?? 30);
    const blockedTypes = opts.blockedTypes ?? ['water'];
    const typeCost = opts.typeCost ?? {};
    const mask = opts.mask ?? null;
    const maxStepM = opts.maxStepM ?? Infinity;
    const terrain = world.terrain;
    const normal = { x: 0, y: 0, z: 0 };
    for (let cy = 0; cy < this.h; cy++) {
      const y = this.cellCenterY(cy);
      for (let cx = 0; cx < this.w; cx++) {
        const i = this.index(cx, cy);
        const x = this.cellCenterX(cx);
        this.height[i] = terrain.heightAt(x, y);
        terrain.normalAt(x, y, normal);
        const typeId = terrain.typeAt(x, y);
        const typeName = terrain.typeName(typeId);
        let unwalkable = normal.z < cosThresh;
        if (!unwalkable && blockedTypes.indexOf(typeName) !== -1) unwalkable = true;
        if (!unwalkable && world.structureAt && world.structureAt(x, y)) unwalkable = true;
        if (!unwalkable && mask && mask[i]) unwalkable = true;
        this.terrainCost[i] = unwalkable ? 0 : (typeCost[typeName] ?? 1);
      }
    }
    this._applyMaxStepM(maxStepM);
    this._recomputeCost();
  }

  /**
   * Same walkability rules as `buildFromWorld`, from plain per-cell arrays
   * (test fixtures without a fake world). The slope test itself is done by
   * the caller against its own `maxSlopeDeg` (kept out of NavGrid so the
   * threshold is never a literal here either) and passed in as
   * `slopeOkU8[i]` (1 = passes, 0 = too steep). `typeU8[i]` indexes
   * `opts.typeNames`. `opts.maxStepM` (default `Infinity`, RE-05c) is the
   * same second-pass drop rule as `buildFromWorld` - see `_applyMaxStepM`.
   * @param {Float32Array} heightF32
   * @param {Uint8Array} slopeOkU8
   * @param {Uint8Array} typeU8
   * @param {{blockedTypes?:string[], typeCost?:Record<string,number>, typeNames?:string[], mask?:Uint8Array|null, maxStepM?:number}} [opts]
   */
  buildFromArrays(heightF32, slopeOkU8, typeU8, opts = {}) {
    const blockedTypes = opts.blockedTypes ?? ['water'];
    const typeCost = opts.typeCost ?? {};
    const typeNames = opts.typeNames ?? [];
    const mask = opts.mask ?? null;
    const maxStepM = opts.maxStepM ?? Infinity;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      this.height[i] = heightF32[i];
      const typeName = typeNames[typeU8[i]] ?? '';
      let unwalkable = slopeOkU8[i] === 0;
      if (!unwalkable && blockedTypes.indexOf(typeName) !== -1) unwalkable = true;
      if (!unwalkable && mask && mask[i]) unwalkable = true;
      this.terrainCost[i] = unwalkable ? 0 : (typeCost[typeName] ?? 1);
    }
    this._applyMaxStepM(maxStepM);
    this._recomputeCost();
  }
}
