// Main loop: fixed 60 Hz update(dt) with an accumulator (capped so a slow
// frame/tab-switch cannot spiral into ever more catch-up steps), and a
// separate render(alpha) driven by requestAnimationFrame.

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
// US-018 (architecture.md 16): skip this many rAF intervals after start()/
// resetStats() (load/setup jank, not real frame pacing) and while the tab
// is hidden (rAF throttles to ~1/s in a background tab - not a stutter).
const SKIP_INTERVAL_FRAMES = 2;

export class Loop {
  /**
   * @param {(dt: number) => void} update - fixed-step simulation update, dt in seconds (always STEP)
   * @param {(alpha: number) => void} render - render callback; alpha in [0,1) is interpolation factor between the last two sim steps
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this._accumulator = 0;
    this._lastTime = null;
    this._rafId = null;
    this._running = false;

    // Perf bookkeeping exposed for the debug overlay.
    this.fps = 0;
    this.frameMs = 0;
    this._fpsSmoothing = 0.9;
    this._lastFrameStart = 0;

    // US-018 (architecture.md 16): raw (unsmoothed) per-tick perf stats for
    // the F3 overlay / `?bench=1`. One preallocated object, mutated in
    // place every tick - never replaced (rule 9, no per-frame allocation).
    this.stats = {
      simMs: 0, renderMs: 0, jsMs: 0,
      intervalMs: 0, worstIntervalMs: 0,
      over25: 0, frames: 0,
    };
    this._skipIntervals = SKIP_INTERVAL_FRAMES;
  }

  /**
   * Zeroes the accumulating counters (`worstIntervalMs`/`over25`/`frames`)
   * without touching the smoothed `fps`/`frameMs` display values. Used by
   * `?bench=1` to start a clean measurement window (between its 3 fixed
   * views, and right before the 60 s walk).
   */
  resetStats() {
    this.stats.worstIntervalMs = 0;
    this.stats.over25 = 0;
    this.stats.frames = 0;
    this._skipIntervals = SKIP_INTERVAL_FRAMES;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._skipIntervals = SKIP_INTERVAL_FRAMES;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
  }

  _tick = (now) => {
    if (!this._running) return;
    const frameStart = performance.now();

    let frameTime = (now - this._lastTime) / 1000;
    const intervalMs = now - this._lastTime;
    this._lastTime = now;
    // Clamp huge gaps (tab backgrounded, debugger pause) to avoid a spiral
    // of death; the accumulator loop below also caps steps per frame.
    if (frameTime > 0.25) frameTime = 0.25;

    this._accumulator += frameTime;

    let steps = 0;
    let simMs = 0;
    while (this._accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      const s0 = performance.now();
      this.update(STEP);
      simMs += performance.now() - s0;
      this._accumulator -= STEP;
      steps++;
    }
    // If we hit the step cap, drop the remaining backlog instead of ever
    // trying to catch up (prevents runaway update bursts).
    if (steps === MAX_STEPS_PER_FRAME) {
      this._accumulator = 0;
    }

    const alpha = this._accumulator / STEP;
    const r0 = performance.now();
    this.render(alpha);
    const renderMs = performance.now() - r0;

    const elapsed = performance.now() - frameStart;
    this.frameMs = this.frameMs * this._fpsSmoothing + elapsed * (1 - this._fpsSmoothing);
    const instFps = frameTime > 0 ? 1 / frameTime : 0;
    this.fps = this.fps * this._fpsSmoothing + instFps * (1 - this._fpsSmoothing);

    // US-018: raw per-tick breakdown (jsMs = simMs + renderMs, both CPU-side
    // only) - separate from the smoothed `frameMs`/`fps` above, which stay
    // unchanged for existing callers.
    const st = this.stats;
    st.simMs = simMs;
    st.renderMs = renderMs;
    st.jsMs = simMs + renderMs;
    st.intervalMs = intervalMs;
    if (this._skipIntervals > 0) {
      this._skipIntervals--;
    } else if (typeof document === 'undefined' || !document.hidden) {
      if (intervalMs > st.worstIntervalMs) st.worstIntervalMs = intervalMs;
      if (intervalMs > 25) st.over25++;
      st.frames++;
    }

    this._rafId = requestAnimationFrame(this._tick);
  };
}
