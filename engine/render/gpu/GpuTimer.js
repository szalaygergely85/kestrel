// US-029 tech notes item 8: `EXT_disjoint_timer_query_webgl2` ring of 4
// queries around the present hook (upload + both passes + present draw).
// Polls `QUERY_RESULT_AVAILABLE`, drops results after `GPU_DISJOINT_EXT`,
// keeps a 120-entry ring -> `stats.gpuMsP50/P95`. No extension -> NaN, the
// overlay/bench prints "gpu n/a (frame time N ms)".
const RING_SIZE = 4;
const HISTORY = 120;

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

  stats() {
    if (!this.available || this._historyLen === 0) return { gpuMs: NaN, gpuMsP50: NaN, gpuMsP95: NaN };
    const arr = Array.from(this._history.subarray(0, this._historyLen)).sort((a, b) => a - b);
    const p50 = arr[Math.floor(arr.length * 0.5)];
    const p95 = arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))];
    return { gpuMs: arr[arr.length - 1], gpuMsP50: p50, gpuMsP95: p95 };
  }

  dispose() {
    if (!this.available) return;
    for (const q of this._queries) this.gl.deleteQuery(q);
  }
}
