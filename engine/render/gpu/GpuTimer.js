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
