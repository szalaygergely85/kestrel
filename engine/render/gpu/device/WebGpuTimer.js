// WG-1b3 (38.7): timestamp spans, resolved asynchronously through a three-frame ring.
// Pass descriptors and recording metadata are preallocated; full rings drop timing, never wait.
export const FRAME_TIMER_SLOT = 10;
// S8-B1-07: one slot per real WG pass (WgCellPipeline + passRaster/passShadow/passCell/passShade/passSprites/passOverlay),
// slots 0-9 so FRAME_TIMER_SLOT (10) never collides - `writePassStats` reads slot === array index directly. 'resolve' covers
// both the resolve and deriv draw calls (GpuCellPipeline.PASS_RESOLVE precedent: one query spans both). Mutually exclusive
// with FRAME_TIMER_SLOT per frame (spans never nest - see WgCellPipeline._hook): when per-pass timing is on, the pipeline
// ends the whole-frame span early (still unwritten at that point) so each pass below can open its own.
export const WG_PASS_NAMES = Object.freeze(['cull', 'raster', 'shadow', 'resolve', 'water', 'light', 'shade', 'edge', 'sprites', 'overlay']);
export const WG_PASS_SLOT = Object.freeze({ cull: 0, raster: 1, shadow: 2, resolve: 3, water: 4, light: 5, shade: 6, edge: 7, sprites: 8, overlay: 9 });
// Defensive helpers for the WG pass files (passRaster/passShadow/passCell/passShade): `p` is normally the WgCellPipeline
// (`_passTimingOn` + `device`), but several Node tests call a pass's `run()` directly with a minimal stand-in object that
// has neither - these just no-op then, same as timing being off.
export function wgSpanBegin(p, slot) { if (p && p._passTimingOn && p.device && p.device.timer) p.device.timer.begin(slot); }
export function wgSpanEnd(p) { if (p && p._passTimingOn && p.device && p.device.timer) p.device.timer.end(); }
const SLOT_COUNT = 16;
const MAX_SPANS = 128;
const HISTORY = 120;

export class WebGpuTimer {
  constructor(gpu, consts) {
    this.gpu = gpu;
    this._c = consts;
    this.available = !!gpu.features?.has('timestamp-query');
    this._disposed = false;
    this._frame = null;
    this._attempted = false;
    this._active = -1;
    this._serial = 0;
    this._history = new Float64Array(SLOT_COUNT * HISTORY);
    this._length = new Uint16Array(SLOT_COUNT);
    this._pos = new Uint16Array(SLOT_COUNT);
    this._latestSerial = new Float64Array(SLOT_COUNT);
    this._latest = new Float64Array(SLOT_COUNT).fill(NaN);
    this._p50 = new Float64Array(SLOT_COUNT).fill(NaN);
    this._p95 = new Float64Array(SLOT_COUNT).fill(NaN);
    this._dirty = new Uint8Array(SLOT_COUNT);
    this._scratch = new Float64Array(HISTORY);
    this._rings = [];
    if (!this.available) return;
    try {
      for (let i = 0; i < 3; i++) {
        const r = { busy: false, count: 0, serial: 0, query: null, resolve: null, read: null,
          slots: new Uint8Array(MAX_SPANS), written: new Uint8Array(MAX_SPANS),
          first: [], next: [], totals: new Float64Array(SLOT_COUNT), seen: new Uint8Array(SLOT_COUNT) };
        this._rings.push(r);
        r.query = gpu.createQuerySet({ type: 'timestamp', count: MAX_SPANS * 2 });
        r.resolve = gpu.createBuffer({ size: MAX_SPANS * 16, usage: consts.buf.QUERY_RESOLVE | consts.buf.COPY_SRC });
        r.read = gpu.createBuffer({ size: MAX_SPANS * 16, usage: consts.buf.MAP_READ | consts.buf.COPY_DST });
        for (let j = 0; j < MAX_SPANS; j++) {
          r.first.push({ querySet: r.query, beginningOfPassWriteIndex: j * 2, endOfPassWriteIndex: j * 2 + 1 });
          r.next.push({ querySet: r.query, endOfPassWriteIndex: j * 2 + 1 });
        }
      }
    } catch (error) { this.dispose(); throw error; }
  }

  begin(slot) {
    if (!this.available || this._disposed) return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error('WebGpuTimer.begin: invalid slot');
    if (this._active >= 0) throw new Error('WebGpuTimer.begin: span already open');
    if (!this._attempted) {
      this._attempted = true;
      for (let i = 0; i < this._rings.length; i++) {
        const r = this._rings[i];
        if (!r.busy) { this._frame = r; break; }
      }
    }
    const r = this._frame;
    if (!r || r.count === MAX_SPANS) return;
    const i = r.count++;
    r.slots[i] = slot; r.written[i] = 0;
    this._active = i;
  }

  end() { this._active = -1; }

  // The first pass starts the span; every pass rewrites its end timestamp (last wins).
  attach(passDesc) {
    const r = this._frame, i = this._active;
    if (!r || i < 0) { passDesc.timestampWrites = undefined; return; }
    passDesc.timestampWrites = r.written[i] ? r.next[i] : r.first[i];
    r.written[i] = 1;
  }

  // Called before encoder.finish(); mapAsync starts only after queue.submit().
  resolve(encoder) {
    const r = this._frame;
    this._active = -1;
    this._frame = null;
    this._attempted = false;
    if (!r || !r.count) return null;
    if (!encoder) { r.count = 0; return null; }
    let written = false;
    for (let i = 0; i < r.count; i++) if (r.written[i]) { written = true; break; }
    if (!written) { r.count = 0; return null; }
    r.serial = ++this._serial;
    r.busy = true;
    encoder.resolveQuerySet(r.query, 0, r.count * 2, r.resolve, 0);
    encoder.copyBufferToBuffer(r.resolve, 0, r.read, 0, r.count * 16);
    return r;
  }

  collect(r) {
    if (!r) return;
    // Promise/view creation belongs to asynchronous readback, never begin/attach/end.
    r.read.mapAsync(this._c.map.READ).then(() => {
      if (this._disposed) return;
      const words = new BigUint64Array(r.read.getMappedRange());
      r.totals.fill(0); r.seen.fill(0);
      for (let i = 0; i < r.count; i++) {
        if (!r.written[i]) continue;
        const start = words[i * 2], end = words[i * 2 + 1];
        if (end < start) continue;
        const slot = r.slots[i];
        r.totals[slot] += Number(end - start) / 1e6;
        r.seen[slot] = 1;
      }
      for (let slot = 0; slot < SLOT_COUNT; slot++) if (r.seen[slot]) this._push(slot, r.totals[slot], r.serial);
    }).catch(() => { /* map rejection/device loss: drop the sample */ }).finally(() => {
      if (!this._disposed) r.read.unmap();
      r.count = 0; r.busy = false;
    });
  }

  _push(slot, ms, serial) {
    this._history[slot * HISTORY + this._pos[slot]] = ms;
    this._pos[slot] = (this._pos[slot] + 1) % HISTORY;
    if (this._length[slot] < HISTORY) this._length[slot]++;
    if (serial >= this._latestSerial[slot]) { this._latestSerial[slot] = serial; this._latest[slot] = ms; }
    this._dirty[slot] = 1;
  }

  _stats(slot) {
    if (!this._dirty[slot]) return;
    this._dirty[slot] = 0;
    const n = this._length[slot], scratch = this._scratch;
    // Small fixed history: in-place insertion sort avoids temporary typed-array views.
    for (let i = 0; i < n; i++) {
      const v = this._history[slot * HISTORY + i];
      let j = i;
      while (j > 0 && scratch[j - 1] > v) { scratch[j] = scratch[j - 1]; j--; }
      scratch[j] = v;
    }
    this._p50[slot] = scratch[Math.floor(n * 0.5)];
    this._p95[slot] = scratch[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  writeStats(out, slot = FRAME_TIMER_SLOT) {
    this._stats(slot);
    out.gpuMs = this._latest[slot]; out.gpuMsP50 = this._p50[slot]; out.gpuMsP95 = this._p95[slot];
  }

  writePassStats(outP50, outP95) {
    for (let slot = 0; slot < outP50.length; slot++) {
      this._stats(slot);
      outP50[slot] = this._p50[slot]; outP95[slot] = this._p95[slot];
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const r of this._rings) {
      r.query?.destroy(); r.resolve?.destroy(); r.read?.destroy();
    }
  }
}
