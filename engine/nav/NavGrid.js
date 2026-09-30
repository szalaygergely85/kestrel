// @ts-check
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
//   version      int, +1 per build/change.
//   minCost      smallest non-zero cost value (A* heuristic scale).
//
// Do not: sample `groundAt` for walkability (camera-dependent, would make
// nav differ between sessions) - only the analytic terrain queries.

export class NavGrid {
  /** @param {{x0:number, y0:number, w:number, h:number, cell?:number}} opts */
  constructor({ x0, y0, w, h, cell = 1 }) {
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
  }

  cellX(x) { return Math.floor((x - this.x0) / this.cell); }
  cellY(y) { return Math.floor((y - this.y0) / this.cell); }
  cellCenterX(cx) { return this.x0 + (cx + 0.5) * this.cell; }
  cellCenterY(cy) { return this.y0 + (cy + 0.5) * this.cell; }
  index(cx, cy) { return cy * this.w + cx; }
  inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }

  /** Recomputes `cost`/`minCost` from `terrainCost`/`blockCount`. Called
   * after a full build; RE-10's block/unblock will call an equivalent over
   * just the dirty rect. */
  _recomputeCost() {
    const n = this.w * this.h;
    let minCost = Infinity;
    for (let i = 0; i < n; i++) {
      const c = this.blockCount[i] > 0 ? 0 : this.terrainCost[i];
      this.cost[i] = c;
      if (c > 0 && c < minCost) minCost = c;
    }
    this.minCost = Number.isFinite(minCost) ? minCost : 1;
    this.version++;
  }

  /**
   * Walkability from a (possibly fake, duck-typed) world's ANALYTIC terrain
   * queries - load time only, <= 50 ms at 256x256 (28.2 budget). Per cell
   * centre: unwalkable if `normal.z < cos(opts.maxSlopeDeg)` (default 30),
   * if `terrain.typeName(typeAt)` is in `opts.blockedTypes` (default
   * `['water']`), if `world.structureAt(x,y)` is truthy (structures block
   * in v1), or if `opts.mask[i]`. Otherwise
   * `terrainCost = opts.typeCost[typeName] ?? 1`. Every threshold comes
   * from `opts`, never a literal in the comparison itself.
   * @param {{terrain: {heightAt(x:number,y:number):number, normalAt(x:number,y:number,out:{x:number,y:number,z:number}):void, typeAt(x:number,y:number):number, typeName(id:number):string}, structureAt?: (x:number,y:number)=>boolean}} world
   * @param {{maxSlopeDeg?:number, blockedTypes?:string[], typeCost?:Record<string,number>, mask?:Uint8Array|null}} [opts]
   */
  buildFromWorld(world, opts = {}) {
    const maxSlopeDeg = opts.maxSlopeDeg ?? 30;
    const cosThresh = Math.cos(maxSlopeDeg * Math.PI / 180);
    const blockedTypes = opts.blockedTypes ?? ['water'];
    const typeCost = opts.typeCost ?? {};
    const mask = opts.mask ?? null;
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
    this._recomputeCost();
  }

  /**
   * Same walkability rules as `buildFromWorld`, from plain per-cell arrays
   * (test fixtures without a fake world). The slope test itself is done by
   * the caller against its own `maxSlopeDeg` (kept out of NavGrid so the
   * threshold is never a literal here either) and passed in as
   * `slopeOkU8[i]` (1 = passes, 0 = too steep). `typeU8[i]` indexes
   * `opts.typeNames`.
   * @param {Float32Array} heightF32
   * @param {Uint8Array} slopeOkU8
   * @param {Uint8Array} typeU8
   * @param {{blockedTypes?:string[], typeCost?:Record<string,number>, typeNames?:string[], mask?:Uint8Array|null}} [opts]
   */
  buildFromArrays(heightF32, slopeOkU8, typeU8, opts = {}) {
    const blockedTypes = opts.blockedTypes ?? ['water'];
    const typeCost = opts.typeCost ?? {};
    const typeNames = opts.typeNames ?? [];
    const mask = opts.mask ?? null;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      this.height[i] = heightF32[i];
      const typeName = typeNames[typeU8[i]] ?? '';
      let unwalkable = slopeOkU8[i] === 0;
      if (!unwalkable && blockedTypes.indexOf(typeName) !== -1) unwalkable = true;
      if (!unwalkable && mask && mask[i]) unwalkable = true;
      this.terrainCost[i] = unwalkable ? 0 : (typeCost[typeName] ?? 1);
    }
    this._recomputeCost();
  }
}
