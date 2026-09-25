// US-029 tech notes item 8: `EXT_disjoint_timer_query_webgl2` ring of 4
// queries around the present hook (upload + both passes + present draw).
// Polls `QUERY_RESULT_AVAILABLE`, drops results after `GPU_DISJOINT_EXT`,
// keeps a 120-entry ring -> `stats.gpuMsP50/P95`. No extension -> NaN, the
// overlay/bench prints "gpu n/a (frame time N ms)".
//
// Architect review 1 item 3 (blocking, per-frame allocations): the old
// `stats()` did `Array.from(...).sort(...)` (a fresh array + comparator
// closure) every call, and the caller did `Object.assign(this.stats, ...)`
// (another fresh object) every frame. `writeStats(out)` below writes
// straight into the caller's preallocated object instead, and only
// re-sorts the ring (into a preallocated scratch buffer, in place, no
// comparator closure - numeric sort on a typed array) every `STATS_EVERY`
// calls; between recomputes it returns the last cached percentiles.
const RING_SIZE = 4;
const HISTORY = 120;
const STATS_EVERY = 30;

export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.available = !!this.ext;
    this._queries = this.available ? Array.from({ length: RING_SIZE }, () => gl.createQuery()) : null;
    this._pending = new Array(RING_SIZE).fill(false);
    this._ringIdx = 0;
    this._history = new Float32Array(HISTORY);
    this._historyLen = 0;
    this._historyPos = 0;
    this._activeQuery = null;
    this._scratch = new Float32Array(HISTORY); // recompute scratch, allocated once
    this._statsCalls = 0;
    this._cachedGpuMs = NaN;
    this._cachedP50 = NaN;
    this._cachedP95 = NaN;
  }

  // Call once, right before the sequence you want timed (upload -> pass1 ->
  // pass2 -> present draw); call `end()` right after.
  begin() {
    if (!this.available) return;
    this._pollAll();
    const gl = this.gl;
    const i = this._ringIdx;
    if (this._pending[i]) return; // ring still full, skip this frame's timing rather than stall
    this._activeQuery = this._queries[i];
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this._activeQuery);
  }

  end() {
    if (!this.available || !this._activeQuery) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this._pending[this._ringIdx] = true;
    this._ringIdx = (this._ringIdx + 1) % RING_SIZE;
    this._activeQuery = null;
  }

  _pollAll() {
    const gl = this.gl, ext = this.ext;
    for (let i = 0; i < RING_SIZE; i++) {
      if (!this._pending[i]) continue;
      const q = this._queries[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      this._pending[i] = false;
      if (disjoint) continue; // drop this result
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this._push(ns / 1e6);
    }
  }

  _push(ms) {
    this._history[this._historyPos] = ms;
    this._historyPos = (this._historyPos + 1) % HISTORY;
    if (this._historyLen < HISTORY) this._historyLen++;
  }

  /**
   * Writes `gpuMs`/`gpuMsP50`/`gpuMsP95` onto `out` in place (no return
   * allocation). The sort that derives the percentiles only actually runs
   * every `STATS_EVERY` calls (or once, the first time data exists) -
   * between recomputes this just re-reads the last cached values, so a
   * per-frame call here allocates nothing and does no sort most frames.
   */
  writeStats(out) {
    if (!this.available || this._historyLen === 0) {
      out.gpuMs = NaN; out.gpuMsP50 = NaN; out.gpuMsP95 = NaN;
      return;
    }
    this._statsCalls++;
    if (Number.isNaN(this._cachedP50) || this._statsCalls % STATS_EVERY === 0) this._recompute();
    out.gpuMs = this._cachedGpuMs;
    out.gpuMsP50 = this._cachedP50;
    out.gpuMsP95 = this._cachedP95;
  }

  _recompute() {
    const n = this._historyLen;
    const scratch = this._scratch;
    for (let i = 0; i < n; i++) scratch[i] = this._history[i];
    const view = scratch.subarray(0, n);
    view.sort(); // numeric in-place sort on a typed array - no comparator closure, no new array
    this._cachedP50 = view[Math.floor(n * 0.5)];
    this._cachedP95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
    this._cachedGpuMs = view[n - 1];
  }

  dispose() {
    if (!this.available) return;
    for (const q of this._queries) this.gl.deleteQuery(q);
  }
}

// US-018 (architecture.md 16): per-pass GPU timing. Only *nested*
// TIME_ELAPSED_EXT queries are illegal on this extension - SEQUENTIAL,
// non-overlapping spans (one pass ends before the next begins) are legal,
// so one query per pass slot, run in fixed order, works exactly like
// `GpuTimer` above but with `slotCount` independent rings/histories
// instead of one. `begin(slot)`/`end()` (no slot arg on `end()` - only one
// span is ever open at a time, tracked in `_activeSlot`) mirror GpuTimer's
// own begin()/end(). Same disjoint/availability/`STATS_EVERY` rules.
export class GpuPassTimer {
  constructor(gl, slotCount) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.available = !!this.ext;
    this.slotCount = slotCount;
    this._queries = this.available
      ? Array.from({ length: slotCount }, () => Array.from({ length: RING_SIZE }, () => gl.createQuery()))
      : null;
    this._pending = this.available
      ? Array.from({ length: slotCount }, () => new Array(RING_SIZE).fill(false))
      : null;
    this._ringIdx = new Int32Array(slotCount);
    this._activeQuery = null;
    this._activeSlot = -1;
    this._history = this.available
      ? Array.from({ length: slotCount }, () => new Float32Array(HISTORY))
      : null;
    this._historyLen = new Int32Array(slotCount);
    this._historyPos = new Int32Array(slotCount);
    this._scratch = new Float32Array(HISTORY); // shared recompute scratch, allocated once
    this._cachedP50 = new Float32Array(slotCount).fill(NaN);
    this._cachedP95 = new Float32Array(slotCount).fill(NaN);
    this._statsCalls = 0;
  }

  /**
   * Call right before a single pass's draw call; `end()` right after it.
   * Arch review 1 item 3: this used to `_pollAll()` on every call - with 7
   * passes/frame that's ~7 full ring-scans/frame for one poll's worth of
   * work. `writeStats()` already polls once before reading percentiles
   * (same as `GpuTimer.writeStats`'s caller pattern), so `begin()` no
   * longer polls at all; a slot's ring only frees up once per frame.
   */
  begin(slot) {
    if (!this.available) return;
    const i = this._ringIdx[slot];
    if (this._pending[slot][i]) return; // that slot's ring is still full - skip timing this pass this frame
    this._activeQuery = this._queries[slot][i];
    this._activeSlot = slot;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this._activeQuery);
  }

  end() {
    if (!this.available || !this._activeQuery) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const slot = this._activeSlot;
    this._pending[slot][this._ringIdx[slot]] = true;
    this._ringIdx[slot] = (this._ringIdx[slot] + 1) % RING_SIZE;
    this._activeQuery = null;
    this._activeSlot = -1;
  }

  _pollAll() {
    const gl = this.gl, ext = this.ext;
    for (let slot = 0; slot < this.slotCount; slot++) {
      const pend = this._pending[slot];
      for (let i = 0; i < RING_SIZE; i++) {
        if (!pend[i]) continue;
        const q = this._queries[slot][i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        pend[i] = false;
        if (disjoint) continue;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        this._push(slot, ns / 1e6);
      }
    }
  }

  _push(slot, ms) {
    this._history[slot][this._historyPos[slot]] = ms;
    this._historyPos[slot] = (this._historyPos[slot] + 1) % HISTORY;
    if (this._historyLen[slot] < HISTORY) this._historyLen[slot]++;
  }

  /**
   * Writes p50/p95 for every slot onto the caller's preallocated
   * `outP50`/`outP95` (Float32Array(slotCount)) in place - no allocation.
   * Same recompute-every-`STATS_EVERY`-calls caching as `GpuTimer.writeStats`.
   */
  writeStats(outP50, outP95) {
    if (!this.available) { outP50.fill(NaN); outP95.fill(NaN); return; }
    this._pollAll(); // catch a same-frame result (e.g. the last pass ended) before reading it back
    this._statsCalls++;
    const due = this._statsCalls % STATS_EVERY === 0;
    for (let slot = 0; slot < this.slotCount; slot++) {
      if (this._historyLen[slot] === 0) { outP50[slot] = NaN; outP95[slot] = NaN; continue; }
      if (Number.isNaN(this._cachedP50[slot]) || due) this._recompute(slot);
      outP50[slot] = this._cachedP50[slot];
      outP95[slot] = this._cachedP95[slot];
    }
  }

  _recompute(slot) {
    const n = this._historyLen[slot];
    const hist = this._history[slot];
    const scratch = this._scratch;
    for (let i = 0; i < n; i++) scratch[i] = hist[i];
    const view = scratch.subarray(0, n);
    view.sort();
    this._cachedP50[slot] = view[Math.floor(n * 0.5)];
    this._cachedP95[slot] = view[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  dispose() {
    if (!this.available) return;
    for (const ring of this._queries) for (const q of ring) this.gl.deleteQuery(q);
  }
}
