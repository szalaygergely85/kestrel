// Main loop: fixed 60 Hz update(dt) with an accumulator (capped so a slow
// frame/tab-switch cannot spiral into ever more catch-up steps), and a
// separate render(alpha) driven by requestAnimationFrame.

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

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
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
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
    this._lastTime = now;
    // Clamp huge gaps (tab backgrounded, debugger pause) to avoid a spiral
    // of death; the accumulator loop below also caps steps per frame.
    if (frameTime > 0.25) frameTime = 0.25;

    this._accumulator += frameTime;

    let steps = 0;
    while (this._accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.update(STEP);
      this._accumulator -= STEP;
      steps++;
    }
    // If we hit the step cap, drop the remaining backlog instead of ever
    // trying to catch up (prevents runaway update bursts).
    if (steps === MAX_STEPS_PER_FRAME) {
      this._accumulator = 0;
    }

    const alpha = this._accumulator / STEP;
    this.render(alpha);

    const elapsed = performance.now() - frameStart;
    this.frameMs = this.frameMs * this._fpsSmoothing + elapsed * (1 - this._fpsSmoothing);
    const instFps = frameTime > 0 ? 1 / frameTime : 0;
    this.fps = this.fps * this._fpsSmoothing + instFps * (1 - this._fpsSmoothing);

    this._rafId = requestAnimationFrame(this._tick);
  };
}
