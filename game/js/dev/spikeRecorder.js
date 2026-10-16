// game/js/dev/spikeRecorder.js - PERF-05: `?spikes=1` frame-spike attribution (dev only; off = never constructed, the
// main.js lap() hooks stay a single null test). A FrameProfiler that, besides the worst frame, records EVERY frame whose
// CPU work (sim + render) or rAF interval exceeds `thresholdMs`: the top 3 sections, the unattributed rest (GC / JIT /
// driver), sim steps, the JS heap drop inside the frame and between frames (a drop = a GC ran), and the previous frame's
// top section (a long interval with a short CPU frame = the previous frame's work or a GPU/compositor wait).
// Records are plain objects in a ring of the last `keep` spikes (allocates only on a spike) -> `window.__spikes`.
import { FrameProfiler } from '../../../engine/dev.js';

const heapNow = () => (typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0);

export class SpikeRecorder extends FrameProfiler {
  constructor(names, { thresholdMs = 25, keep = 400 } = {}) {
    super(names);
    this.thresholdMs = thresholdMs; this.keep = keep;
    this.records = []; this.count = 0; this.frames = 0;
    this.prev = new Float64Array(this.names.length); this.prevJs = 0;
    this._t0 = 0; this._lastT0 = 0; this._heap0 = 0; this._lastHeapEnd = 0;
    this.lastLine = '';
  }

  beginFrame() {
    this.prev.set(this.cur);
    this.cur.fill(0);
    this._lastT0 = this._t0; this._t0 = performance.now();
    this._heap0 = heapNow();
  }

  /** top-k sections of `arr` as "name ms" text (spike path only). */
  _top(arr, k) {
    const idx = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] >= 0.05) idx.push(i);
    idx.sort((a, b) => arr[b] - arr[a]);
    return idx.slice(0, k).map((i) => ({ name: this.names[i], ms: +arr[i].toFixed(2) }));
  }

  endFrame(simMs, renderMs, steps) {
    super.endFrame(simMs, renderMs, steps);
    const js = simMs + renderMs, itv = this._lastT0 > 0 ? this._t0 - this._lastT0 : 0;
    const heapEnd = heapNow();
    const gcIn = Math.max(0, this._heap0 - heapEnd) / 1048576, gcBetween = Math.max(0, this._lastHeapEnd - this._heap0) / 1048576;
    this._lastHeapEnd = heapEnd;
    this.frames++;
    if (js > this.thresholdMs || itv > this.thresholdMs) {
      let covered = 0;
      for (let i = 0; i < this.cur.length; i++) covered += this.cur[i];
      const rec = { frame: this.frame - 1, t: +this._t0.toFixed(1), js: +js.toFixed(2), itv: +itv.toFixed(2), steps,
        top: this._top(this.cur, 3), unattr: +Math.max(0, js - covered).toFixed(2),
        gcInMb: +gcIn.toFixed(2), gcBetweenMb: +gcBetween.toFixed(2), prevJs: +this.prevJs.toFixed(2), prevTop: this._top(this.prev, 1) };
      if (this.records.length >= this.keep) this.records.shift();
      this.records.push(rec); this.count++;
      const t = rec.top[0];
      this.lastLine = `spike: ${t ? t.name + ' ' + t.ms.toFixed(1) : 'unattributed ' + rec.unattr.toFixed(1)} ms (js ${rec.js.toFixed(1)} itv ${rec.itv.toFixed(1)}, ${this.count}/${this.frames})`;
    }
    this.prevJs = js;
  }
}
