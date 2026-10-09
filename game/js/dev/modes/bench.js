// US-048: `?bench=present` and `?bench=1` dev modes, both keyed off the same
// `bench` URL param (moved verbatim out of game/js/main.js).
//
// `?bench=present` (US-001 canvas benchmark, architecture.md 16): raw
// CellBuffer present() only, outside the normal rAF loop - `runBenchmark`
// below is a pure function of `rt`/`overlay` (plus the imported
// `fillWorstCase` scene), so it moved here unchanged.
//
// `?bench=1` (US-018, architecture.md 16): the real 3 fixed world-mode
// views + 60s walk, timed inside the normal game loop. That whole sequence
// lives in `runGame`/`runPerfBench` (main.js keeps `runGame` - US-048 AC
// "do not restructure runGame's render path"), so this mode just flips the
// two module-scope flags `runGame` itself reads (`benchActive`, `prof`) via
// `ctx.startBench()`, a one-line hook main.js exposes for exactly this.
import { fillWorstCase } from '../benchScene.js';
import { runCombatBench } from '../combatBench.js'; // COMBAT-BENCH-01

export const name = 'bench';

function round2(n) {
  return Math.round(n * 100) / 100;
}

// `?bench=present`: renders N worst-case frames (every cell a unique,
// frame-varying, non-space glyph) back-to-back and reports avg/p95 for
// present() alone and for the full frame (fill + present). This is the
// reproducible measurement the US-001 perf acceptance criterion is checked
// against.
function runBenchmark(rt, overlay) {
  const FRAMES = 600;
  const presentTimes = new Array(FRAMES);
  const frameTimes = new Array(FRAMES);

  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now();
    fillWorstCase(rt, i);
    const t1 = performance.now();
    rt.present();
    const t2 = performance.now();
    presentTimes[i] = t2 - t1;
    frameTimes[i] = t2 - t0;
  }

  const stats = (arr) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const max = sorted[sorted.length - 1];
    return { avg, p95, max };
  };

  const presentStats = stats(presentTimes);
  const frameStats = stats(frameTimes);

  const result = {
    frames: FRAMES,
    backend: rt.backend,
    canvasPxW: rt.canvas.width,
    canvasPxH: rt.canvas.height,
    devicePixelRatio: rt.dpr,
    pxCellW: rt.pxCellW,
    pxCellH: rt.pxCellH,
    present: { avgMs: round2(presentStats.avg), p95Ms: round2(presentStats.p95), maxMs: round2(presentStats.max) },
    fullFrame: { avgMs: round2(frameStats.avg), p95Ms: round2(frameStats.p95), maxMs: round2(frameStats.max) },
  };

  window.__bench = result;
  console.log('[bench] US-001 worst-case, 600 frames:', result);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '14px "Courier New", monospace';
  overlay.el.textContent =
    `BENCH (${FRAMES} worst-case frames)  backend: ${result.backend}\n` +
    `canvas: ${result.canvasPxW}x${result.canvasPxH} px  (dpr ${result.devicePixelRatio}, cell ${result.pxCellW}x${result.pxCellH}px)\n` +
    `present(): avg ${result.present.avgMs} ms  p95 ${result.present.p95Ms} ms  max ${result.present.maxMs} ms\n` +
    `full frame: avg ${result.fullFrame.avgMs} ms  p95 ${result.fullFrame.p95Ms} ms  max ${result.fullFrame.maxMs} ms\n` +
    `budget: <= 8 ms/frame for 60 fps`;
}

export function run(ctx) {
  if (ctx.params.get('bench') === 'present') {
    // US-001: never feeds the GPU cell pipeline a frame (no fb/cam/world), so
    // its hook must be off.
    if (ctx.gpuPipeline) ctx.gpuPipeline.setEnabled(false);
    runBenchmark(ctx.rt, ctx.overlay);
  } else {
    ctx.startBench();
    // COMBAT-BENCH-01: `?bench=combat` / `?bench=1&enemies=4` (main.js then skips runPerfBench's view sequence).
    if (ctx.params.get('bench') === 'combat' || ctx.params.get('enemies') === '4') runCombatBench(ctx);
  }
}
