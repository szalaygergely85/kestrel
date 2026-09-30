// @ts-check
// engine/world/Visibility.js (RE-11, docs/architecture.md 28.3). Leaf module:
// imports nothing. This is sim state - it advances only inside the fixed
// step, and 28.2's determinism and zero-allocation rules apply (no
// Math.random/Date.now/performance.now/trig, no Map/Set iteration order
// dependence, everything preallocated at construction).
//
// v1: sight circles only, no occlusion (a later story adds `opts.occluder`
// behind the same API). Per team t: `state[t]` is the R8 fog texel itself
// (0 unseen, 128 explored-not-visible, 255 visible); `count[t]` is the
// number of that team's sources currently covering the cell, derived from
// the source list and never saved. A cell's state is a pure function of its
// count: count 0 -> in [0,128] (unseen stays 0, previously-explored stays
// 128); count > 0 -> 255. Because state only reacts to 0<->1 transitions of
// `count`, repeated ++/-- from many sources commute - stamping/unstamping
// the same set of sources in any order leaves `state` byte-identical.
//
// Sources are a flat SoA keyed by an id -> slot map (`_idSlot`); slots come
// from a free list, exactly like NavGrid's blocker table, so add/remove
// never allocates once the map has grown past its first insertions for a
// given id. `setSource` is meant to be called once per unit per tick (see
// architecture.md 28.3's tick order) and is a true no-op - no unstamp/stamp,
// no map write - when the source's cell/radius/team mask haven't changed.

/** Row-major cell index of the sight-circle "half chord" span table. */
function buildSpanTable(maxRadiusCells) {
  const table = [];
  for (let r = 0; r <= maxRadiusCells; r++) {
    const row = new Int32Array(r + 1);
    for (let dy = 0; dy <= r; dy++) {
      row[dy] = Math.floor(Math.sqrt(r * r + r - dy * dy));
    }
    table.push(row);
  }
  return table;
}

export class Visibility {
  /**
   * @param {{x0:number, y0:number, w:number, h:number, cell?:number,
   *   teams?:number, maxSources?:number, maxRadiusCells?:number}} opts
   */
  constructor({ x0, y0, w, h, cell = 1, teams = 2, maxSources = 1024, maxRadiusCells = 16 }) {
    if (teams > 8) {
      throw new Error(`Visibility: teams (${teams}) exceeds the 8-bit team-mask limit`);
    }
    this.x0 = x0;
    this.y0 = y0;
    this.w = w | 0;
    this.h = h | 0;
    this.cell = cell;
    this.teams = teams | 0;
    this.maxSources = maxSources | 0;
    this.maxRadiusCells = maxRadiusCells | 0;

    const n = this.w * this.h;
    /** @type {Uint8Array[]} state[t][cy*w+cx]: 0 unseen, 128 explored, 255 visible. */
    this.state = [];
    /** @type {Uint16Array[]} count[t][cy*w+cx]: sources of team t covering the cell. */
    this.count = [];
    for (let t = 0; t < this.teams; t++) {
      this.state.push(new Uint8Array(n));
      this.count.push(new Uint16Array(n));
    }
    /** +1 whenever a cell of state[t] is written. */
    this.version = new Uint32Array(this.teams);

    // Source SoA, indexed by slot.
    this.cx = new Int32Array(this.maxSources);
    this.cy = new Int32Array(this.maxSources);
    this.rc = new Int32Array(this.maxSources);
    this.mask = new Uint8Array(this.maxSources);
    this.active = new Uint8Array(this.maxSources);

    /** @type {Map<number, number>} game id -> slot. Only grows/shrinks on
     * add/remove of a *new* id; updates to an existing id never touch it. */
    this._idSlot = new Map();
    this._freeList = new Int32Array(this.maxSources);
    for (let i = 0; i < this.maxSources; i++) this._freeList[i] = this.maxSources - 1 - i;
    this._freeTop = this.maxSources;

    // Dirty rect per team: [minX, minY, maxX, maxY) since the last
    // takeDirty(t, ...), or inactive if nothing changed yet.
    this._dirtyActive = new Uint8Array(this.teams);
    this._dirtyMinX = new Int32Array(this.teams);
    this._dirtyMinY = new Int32Array(this.teams);
    this._dirtyMaxX = new Int32Array(this.teams);
    this._dirtyMaxY = new Int32Array(this.teams);

    // Precomputed sight-circle table: span[r][dy] = floor(sqrt(r*r+r-dy*dy))
    // for 0 <= dy <= r <= maxRadiusCells. Built once; stamp/unstamp never
    // call Math.sqrt.
    this._span = buildSpanTable(this.maxRadiusCells);
  }

  /** cx/cy of the world point (x,y), no clamping (may land outside the grid). */
  _cellOf(x, y) {
    return [Math.floor((x - this.x0) / this.cell), Math.floor((y - this.y0) / this.cell)];
  }

  /** Marks (cx,cy) dirty for team t and bumps version[t]. Zero allocation. */
  _markDirty(t, cx, cy) {
    this.version[t]++;
    if (!this._dirtyActive[t]) {
      this._dirtyActive[t] = 1;
      this._dirtyMinX[t] = cx;
      this._dirtyMaxX[t] = cx + 1;
      this._dirtyMinY[t] = cy;
      this._dirtyMaxY[t] = cy + 1;
      return;
    }
    if (cx < this._dirtyMinX[t]) this._dirtyMinX[t] = cx;
    if (cx + 1 > this._dirtyMaxX[t]) this._dirtyMaxX[t] = cx + 1;
    if (cy < this._dirtyMinY[t]) this._dirtyMinY[t] = cy;
    if (cy + 1 > this._dirtyMaxY[t]) this._dirtyMaxY[t] = cy + 1;
  }

  /**
   * Applies (delta = +1) or removes (delta = -1) slot's sight circle,
   * clipped to the grid on all 4 sides (handles a negative origin and a
   * source whose circle only partly - or not at all - overlaps the grid).
   * Zero allocation.
   */
  _applySource(slot, delta) {
    const cx = this.cx[slot];
    const cy = this.cy[slot];
    const rc = this.rc[slot];
    const mask = this.mask[slot];
    const span = this._span[rc];
    const w = this.w;
    const h = this.h;
    const teams = this.teams;

    let y0 = cy - rc;
    if (y0 < 0) y0 = 0;
    let y1 = cy + rc;
    if (y1 >= h) y1 = h - 1;

    for (let cy2 = y0; cy2 <= y1; cy2++) {
      const dy = cy2 - cy;
      const s = span[dy < 0 ? -dy : dy];
      let cx0 = cx - s;
      if (cx0 < 0) cx0 = 0;
      let cx1 = cx + s;
      if (cx1 >= w) cx1 = w - 1;
      const rowBase = cy2 * w;
      for (let cx2 = cx0; cx2 <= cx1; cx2++) {
        const idx = rowBase + cx2;
        for (let t = 0; t < teams; t++) {
          if (!(mask & (1 << t))) continue;
          const cnt = this.count[t];
          const c = cnt[idx] + delta;
          cnt[idx] = c;
          if (delta > 0 && c === 1) {
            this.state[t][idx] = 255;
            this._markDirty(t, cx2, cy2);
          } else if (delta < 0 && c === 0) {
            this.state[t][idx] = 128;
            this._markDirty(t, cx2, cy2);
          }
        }
      }
    }
  }

  /**
   * Adds or moves source `id`. No-op (no unstamp/stamp, no allocation) if
   * the resulting (cx, cy, rc, mask) is unchanged from last call. Throws if
   * the radius exceeds `maxRadiusCells`, or (for a brand-new id) if every
   * source slot is in use.
   * @param {number} id @param {number} teamMask @param {number} x
   * @param {number} y @param {number} radiusM
   */
  setSource(id, teamMask, x, y, radiusM) {
    const cx = Math.floor((x - this.x0) / this.cell);
    const cy = Math.floor((y - this.y0) / this.cell);
    let rc = Math.floor(radiusM / this.cell + 0.5);
    if (rc < 0) rc = 0;
    if (rc > this.maxRadiusCells) {
      throw new Error(`Visibility.setSource: radius ${radiusM} (rc=${rc}) exceeds maxRadiusCells (${this.maxRadiusCells})`);
    }
    const mask = teamMask & 0xff;

    let slot = this._idSlot.get(id);
    if (slot === undefined) {
      if (this._freeTop === 0) {
        throw new Error(`Visibility.setSource: maxSources (${this.maxSources}) exceeded`);
      }
      slot = this._freeList[--this._freeTop];
      this._idSlot.set(id, slot);
      this.active[slot] = 1;
      this.cx[slot] = cx;
      this.cy[slot] = cy;
      this.rc[slot] = rc;
      this.mask[slot] = mask;
      this._applySource(slot, 1);
      return;
    }

    if (this.cx[slot] === cx && this.cy[slot] === cy && this.rc[slot] === rc && this.mask[slot] === mask) {
      return;
    }
    this._applySource(slot, -1);
    this.cx[slot] = cx;
    this.cy[slot] = cy;
    this.rc[slot] = rc;
    this.mask[slot] = mask;
    this._applySource(slot, 1);
  }

  /** Removes source `id` (no-op if it doesn't exist). The explored bit its
   * circle left behind is untouched (only the visible->explored transition
   * on count reaching 0 happens, per cell, exactly like any unstamp). */
  removeSource(id) {
    const slot = this._idSlot.get(id);
    if (slot === undefined) return;
    this._applySource(slot, -1);
    this.active[slot] = 0;
    this._idSlot.delete(id);
    this._freeList[this._freeTop++] = slot;
  }

  /** Drops every source (counts -> 0, every 255 -> 128) and forgets all
   * ids/slots. Used after `fromSave`: the game re-adds its sources on the
   * first tick. */
  clearSources() {
    for (let t = 0; t < this.teams; t++) {
      this.count[t].fill(0);
      const st = this.state[t];
      let changed = false;
      for (let i = 0; i < st.length; i++) {
        if (st[i] === 255) {
          st[i] = 128;
          changed = true;
        }
      }
      if (changed) {
        this.version[t]++;
        this._dirtyActive[t] = 1;
        this._dirtyMinX[t] = 0;
        this._dirtyMinY[t] = 0;
        this._dirtyMaxX[t] = this.w;
        this._dirtyMaxY[t] = this.h;
      }
    }
    this._idSlot.clear();
    this.active.fill(0);
    this.cx.fill(0);
    this.cy.fill(0);
    this.rc.fill(0);
    this.mask.fill(0);
    for (let i = 0; i < this.maxSources; i++) this._freeList[i] = this.maxSources - 1 - i;
    this._freeTop = this.maxSources;
  }

  /** 0|128|255 at the world point (x,y); 0 (unseen) if it's outside the grid. */
  stateAt(t, x, y) {
    const cx = Math.floor((x - this.x0) / this.cell);
    const cy = Math.floor((y - this.y0) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0;
    return this.state[t][cy * this.w + cx];
  }

  isVisible(t, x, y) {
    return this.stateAt(t, x, y) === 255;
  }

  isExplored(t, x, y) {
    return this.stateAt(t, x, y) !== 0;
  }

  /**
   * Writes the union of cells of team t that changed since the last call
   * into `out4` ([cx0, cy0, cx1, cy1), half-open) and resets it. Returns
   * false (out4 untouched) if nothing changed. Zero allocation.
   * @param {number} t @param {Int32Array} out4
   */
  takeDirty(t, out4) {
    if (!this._dirtyActive[t]) return false;
    out4[0] = this._dirtyMinX[t];
    out4[1] = this._dirtyMinY[t];
    out4[2] = this._dirtyMaxX[t];
    out4[3] = this._dirtyMaxY[t];
    this._dirtyActive[t] = 0;
    return true;
  }

  /** Marks every unseen cell of team t as explored (debug/scenario). Leaves
   * already-visible cells visible. */
  revealAll(t) {
    const st = this.state[t];
    let changed = false;
    for (let i = 0; i < st.length; i++) {
      if (st[i] === 0) {
        st[i] = 128;
        changed = true;
      }
    }
    if (changed) {
      this.version[t]++;
      this._dirtyActive[t] = 1;
      this._dirtyMinX[t] = 0;
      this._dirtyMinY[t] = 0;
      this._dirtyMaxX[t] = this.w;
      this._dirtyMaxY[t] = this.h;
    }
  }

  /**
   * Row-major run-length encoding of the explored bit (state !== 0) of
   * every team, runs alternating starting with "unexplored" (a leading
   * explored region gets a length-0 first run). Sources are not saved.
   */
  saveExplored() {
    const explored = [];
    for (let t = 0; t < this.teams; t++) {
      const st = this.state[t];
      const runs = [];
      let curBit = 0;
      let runLen = 0;
      for (let i = 0; i < st.length; i++) {
        const bit = st[i] !== 0 ? 1 : 0;
        if (bit === curBit) {
          runLen++;
        } else {
          runs.push(runLen);
          curBit = bit;
          runLen = 1;
        }
      }
      runs.push(runLen);
      explored.push(runs);
    }
    return {
      x0: this.x0, y0: this.y0, w: this.w, h: this.h, cell: this.cell,
      teams: this.teams, maxSources: this.maxSources, maxRadiusCells: this.maxRadiusCells,
      explored,
    };
  }

  /** Rebuilds a Visibility from `saveExplored()`'s output: explored cells
   * come back as state 128 (never 255 - sources aren't saved, so nothing is
   * "currently visible" right after a load). */
  static fromSave(obj) {
    const v = new Visibility({
      x0: obj.x0, y0: obj.y0, w: obj.w, h: obj.h, cell: obj.cell,
      teams: obj.teams, maxSources: obj.maxSources, maxRadiusCells: obj.maxRadiusCells,
    });
    for (let t = 0; t < obj.teams; t++) {
      const runs = obj.explored[t];
      const st = v.state[t];
      let idx = 0;
      let bit = 0;
      for (let r = 0; r < runs.length; r++) {
        const len = runs[r];
        if (bit === 1) {
          for (let k = 0; k < len; k++) st[idx + k] = 128;
        }
        idx += len;
        bit ^= 1;
      }
    }
    return v;
  }

  /** Hashes the state bytes of every team, in team order (counts follow
   * from the sources, so they aren't hashed separately). `h` is a
   * duck-typed hasher (see architecture.md 28.5): only `h.u8Array(arr,
   * start, end)` is used. */
  hashInto(h) {
    for (let t = 0; t < this.teams; t++) {
      const st = this.state[t];
      h.u8Array(st, 0, st.length);
    }
  }
}
