// STREAM-01a (docs/architecture.md 38.51): placement residency by distance. Derived data only: it never touches
// `world.structures`, is never serialized and never read by sim code. Cells of `cellM` metres hold mesh placements
// (members = ascending structure indices). Each cell is cold / warm / active by the xy distance from the eye to the
// cell's member AABB versus `cellReach` (= max member reach) with hysteresis. Feeds (01b) iterate `activeList` /
// `warmList` (ascending structure indices) instead of 0..N. `update` allocates nothing after the build.

export const PLACEMENT_GRID_DEFAULTS = Object.freeze({
  cellM: 64, reachPerM: 400, minM: 160, farM: 2000, hystM: 16, warmM: 120, maxCellsPerFrame: 8,
});

const COLD = 0, WARM = 1, ACTIVE = 2;

export class PlacementGrid {
  /**
   * @param {ArrayLike<any>} structures world.structures (only `kind === 'mesh'` entries with a bbox become members)
   * @param {Partial<typeof PLACEMENT_GRID_DEFAULTS>} [opts]
   */
  constructor(structures, opts) {
    const o = this.opts = Object.assign({}, PLACEMENT_GRID_DEFAULTS, opts || {});
    const n = this.n = structures.length;
    this.dirty = false;
    this.version = 0;       // bumps whenever activeList / warmList changed
    this.transitions = 0;   // total ring changes applied (tests)
    this.lastX = 0; this.lastY = 0;
    this._first = true;     // first update classifies everything uncapped (no empty first frame)
    this._pending = false;  // capped queue not drained yet: keep evaluating

    this.cellOf = new Int32Array(n).fill(-1); // structure index -> compact cell id (-1 = not a member)
    this.reach2 = new Float32Array(n);        // per-placement reach^2 (feeds compare d2 <= reach2)
    this.activeList = new Int32Array(n); this.activeCount = 0;
    this.warmList = new Int32Array(n); this.warmCount = 0;

    // pass 1: per-placement reach + bounds, bucket into raw cells
    const cell = o.cellM, keyOf = new Map();
    const px0 = new Float32Array(n), py0 = new Float32Array(n), px1 = new Float32Array(n), py1 = new Float32Array(n);
    const rawKey = new Int32Array(n).fill(-1);
    let members = 0;
    for (let i = 0; i < n; i++) {
      const s = structures[i];
      if (!s || s.kind !== 'mesh' || !s.bbox) continue;
      const b = s.bbox;
      const hx = (b.x1 - b.x0) * 0.5, hy = (b.y1 - b.y0) * 0.5, hz = (b.z1 - b.z0) * 0.5;
      const r = Math.sqrt(hx * hx + hy * hy + hz * hz);
      const reach = Math.min(o.farM, Math.max(o.minM, r * o.reachPerM)); // Infinity*0 guard below
      this.reach2[i] = (reach === reach) ? reach * reach : o.minM * o.minM;
      px0[i] = b.x0; py0[i] = b.y0; px1[i] = b.x1; py1[i] = b.y1;
      const cx = Math.floor(((b.x0 + b.x1) * 0.5) / cell), cy = Math.floor(((b.y0 + b.y1) * 0.5) / cell);
      const k = cx * 65536 + cy; // |cy| < 32768 cells
      let id = keyOf.get(k);
      if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
      rawKey[i] = id; members++;
    }
    const C = this.cellCount = keyOf.size;
    this.cellMinX = new Float32Array(C).fill(Infinity); this.cellMinY = new Float32Array(C).fill(Infinity);
    this.cellMaxX = new Float32Array(C).fill(-Infinity); this.cellMaxY = new Float32Array(C).fill(-Infinity);
    this.cellReach = new Float32Array(C);
    this.memStart = new Int32Array(C + 1);
    for (let i = 0; i < n; i++) {
      const c = rawKey[i];
      if (c < 0) continue;
      this.cellOf[i] = c; this.memStart[c + 1]++;
      if (px0[i] < this.cellMinX[c]) this.cellMinX[c] = px0[i];
      if (py0[i] < this.cellMinY[c]) this.cellMinY[c] = py0[i];
      if (px1[i] > this.cellMaxX[c]) this.cellMaxX[c] = px1[i];
      if (py1[i] > this.cellMaxY[c]) this.cellMaxY[c] = py1[i];
      const rr = Math.sqrt(this.reach2[i]);
      if (rr > this.cellReach[c]) this.cellReach[c] = rr;
    }
    for (let c = 0; c < C; c++) this.memStart[c + 1] += this.memStart[c];
    this.members = new Int32Array(members); // per cell, ascending structure index
    const fill = new Int32Array(C);
    for (let i = 0; i < n; i++) { const c = rawKey[i]; if (c >= 0) this.members[this.memStart[c] + fill[c]++] = i; }

    this.state = new Uint8Array(C);       // COLD / WARM / ACTIVE
    this._want = new Uint8Array(C);
    this._chg = new Int32Array(C);        // changed cells of this evaluation
    this._chgD = new Float32Array(C);
    this.memberCount = members;
  }

  /** Approximate resident bytes of the grid (typed arrays). */
  get bytes() {
    let b = 0;
    for (const k of Object.keys(this)) { const v = this[k]; if (ArrayBuffer.isView(v)) b += v.byteLength; }
    return b;
  }

  _dist(c, ex, ey) {
    const dx = ex < this.cellMinX[c] ? this.cellMinX[c] - ex : (ex > this.cellMaxX[c] ? ex - this.cellMaxX[c] : 0);
    const dy = ey < this.cellMinY[c] ? this.cellMinY[c] - ey : (ey > this.cellMaxY[c] ? ey - this.cellMaxY[c] : 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Once per rendered frame. Returns true when the lists changed. O(1) while the eye stays within hystM/2 of the
   * last evaluated position and no capped queue is pending.
   */
  update(ex, ey) {
    const o = this.opts;
    if (!this._first && !this._pending) {
      const dx = ex - this.lastX, dy = ey - this.lastY, h = o.hystM * 0.5;
      if (dx * dx + dy * dy < h * h) return false;
    }
    this.lastX = ex; this.lastY = ey;
    const C = this.cellCount, st = this.state, chg = this._chg, chgD = this._chgD;
    let nChg = 0;
    for (let c = 0; c < C; c++) {
      const d = this._dist(c, ex, ey), r = this.cellReach[c], cur = st[c];
      let want;
      if (cur === ACTIVE) want = d <= r + 2 * o.hystM ? ACTIVE : (d <= r + o.warmM + o.hystM ? WARM : COLD);
      else if (d <= r + o.hystM) want = ACTIVE;
      else if (cur === WARM) want = d <= r + o.warmM + o.hystM ? WARM : COLD;
      else want = d <= r + o.warmM ? WARM : COLD;
      if (want !== cur) { this._want[c] = want; chg[nChg] = c; chgD[nChg] = d; nChg++; }
    }
    let apply = this._first ? nChg : Math.min(nChg, o.maxCellsPerFrame);
    const total = apply;
    // nearest-entering first: selection of the smallest d, swap-remove (no allocation, <= maxCellsPerFrame passes)
    for (let k = 0; k < apply; k++) {
      let best = k;
      for (let j = k + 1; j < nChg; j++) if (chgD[j] < chgD[best] || (chgD[j] === chgD[best] && chg[j] < chg[best])) best = j;
      const tc = chg[best], td = chgD[best]; chg[best] = chg[k]; chgD[best] = chgD[k]; chg[k] = tc; chgD[k] = td;
      st[tc] = this._want[tc]; this.transitions++;
    }
    this._pending = nChg > apply;
    this._first = false;
    if (total === 0) return false;
    this._rebuildLists();
    return true;
  }

  _rebuildLists() {
    const n = this.n, cellOf = this.cellOf, st = this.state, al = this.activeList, wl = this.warmList;
    let a = 0, w = 0;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      const s = st[c];
      if (s === ACTIVE) al[a++] = i; else if (s === WARM) wl[w++] = i;
    }
    this.activeCount = a; this.warmCount = w; this.version++;
  }
}

export function createPlacementGrid(structures, opts) { return new PlacementGrid(structures, opts); }
