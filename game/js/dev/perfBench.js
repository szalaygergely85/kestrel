// game/js/dev/perfBench.js - US-018 `?bench=1` (docs/architecture.md
// section 16). Renamed from the old canvas-only bench (US-001, now
// `?bench=present`, kept as-is in main.js).
//
// Runs on top of the NORMAL running game loop (`runGame('world')` has
// already called `engine.run()` by the time this is invoked) - this module
// never ticks physics/render itself, it only:
//   1. teleports the player through 3 fixed poses (60 warm-up + 300
//      measured frames each, sampled every rAF via its own counting loop),
//   2. then waits for the first real WASD input and measures 60 s of actual
//      walking (`engine.loop.resetStats()` at the start, so `worstIntervalMs`/
//      `over25` cover only the walk),
//   3. reports fps/JS/GPU (+ per-pass GPU) avg/p95/max and a pass/fail line
//      per view + the walk, to the overlay (`setText`), `window.__bench` and
//      the console.
//
// Poses (a)/(b) below are this programmer's own approximation of "ground
// floor facing the brazier + sun shaft" / "mid ledge looking down"
// (tower.js local geometry: brazier at 18.5,6.5; sun patch centre-west
// floor x~13-17,y~4-8; mid ledge 19..21,9..11 at 3.0 m) - NOT designer/PO
// verified coordinates (architecture.md 16 allows this: "designer/PO supply
// poses if no existing pose fits"). Pose (c) is the exact `world_m1: breach`
// pose from the `?gpucompare=1` table in this same file.
const WARMUP_FRAMES = 60;
const MEASURE_FRAMES = 300;
const WALK_SECONDS = 60;
const MAX_SAMPLES = Math.max(MEASURE_FRAMES, 75 * WALK_SECONDS); // headroom up to 75 fps for the walk

const PASS_LABELS = ['cast', 'terrain', 'voxel', 'resolve', 'light', 'shade', 'edge'];

export const VIEWS = [
  { name: 'ground floor (brazier + sun shaft)', x: 1494, y: 1026, z: 1.6, yawDeg: 110, pitchDeg: 0 },
  { name: 'mid ledge, looking down', x: 1500, y: 1028, z: 4.6, yawDeg: 200, pitchDeg: -30 },
  { name: 'summit, out the breach', x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: 0 },
];

function sum(arr, n) { let s = 0; for (let i = 0; i < n; i++) s += arr[i]; return s; }
function avg(arr, n) { return n === 0 ? NaN : sum(arr, n) / n; }
function max(arr, n) { let m = 0; for (let i = 0; i < n; i++) if (arr[i] > m) m = arr[i]; return m; }
function p95(arr, n) {
  if (n === 0) return NaN;
  const sorted = Array.from(arr.slice(0, n)).sort((a, b) => a - b);
  return sorted[Math.min(n - 1, Math.floor(n * 0.95))];
}

/**
 * @param {object} ctx
 * @param {object} ctx.engine - the running `createEngine()` instance (`engine.loop` must already be started)
 * @param {object} ctx.playerHandle - `world.get('player')`
 * @param {object} ctx.overlay - `DebugOverlay`
 * @param {object|null} ctx.gpuPipeline - `GpuCellPipeline` or null (CPU fallback: GPU numbers report "n/a")
 * @param {object} ctx.input - `Input`
 * @param {object} ctx.rt - the active `RenderTarget`
 * @param {object} ctx.look - `PlayerLook` (US-005) - the mouse-look state main.js
 *   copies onto `controls.yawDeg/pitchDeg` every fixed step (see `integrate()`'s
 *   call site in main.js). Arch review 1 item 1: `teleport()` used to only set
 *   the transform's yaw/pitch directly, but the very next physics step
 *   overwrote it again from `look.yawDeg/pitchDeg` (mouse-driven) - so all 3
 *   views ended up facing wherever the mouse happened to be, not the pose.
 *   Re-applying the pose onto `look` too (every measured frame, not just
 *   once - the mouse can keep moving mid-measurement) keeps the transform
 *   pinned to the intended facing for the whole view.
 */
export function runPerfBench(ctx) {
  const { engine, playerHandle, overlay, gpuPipeline, input, rt, look } = ctx;
  const loop = engine.loop;
  if (gpuPipeline) gpuPipeline.setPassTiming(true);
  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';

  const results = [];
  const jsHist = new Float32Array(MAX_SAMPLES);
  const gpuHist = new Float32Array(MAX_SAMPLES);
  const intervalHist = new Float32Array(MAX_SAMPLES);

  function teleport(pose) {
    const t = playerHandle.data.transform;
    const body = playerHandle.data.components.body;
    // `pose.z` is EYE height (matches the `?gpucompare=1` pose table this
    // file's (c) view was copied from), but `transform.z` is the FOOT
    // position - `Camera.fromEntity` adds `body.eyeH` back on top
    // (engine/entities/Camera.js `fromEntityInto`). Subtract it here, or
    // the entity spawns too high and free-falls to the real terrain/sector
    // floor before landing on an unintended eye height.
    const eyeH = (body && typeof body.eyeH === 'number') ? body.eyeH : 1.6;
    t.x = pose.x; t.y = pose.y; t.z = pose.z - eyeH; t.yawDeg = pose.yawDeg; t.pitchDeg = pose.pitchDeg;
    if (body) { body.vx = 0; body.vy = 0; body.vz = 0; body.grounded = true; }
    // Arch review 1 item 1: also pin `look` (main.js copies `look.yawDeg/
    // pitchDeg` onto `controls`, then onto the transform, every fixed
    // step - without this the next physics step snaps the view back to
    // wherever the mouse is).
    if (look) { look.yawDeg = pose.yawDeg; look.pitchDeg = pose.pitchDeg; }
  }

  function measureView(pose, onDone) {
    let frame = 0, n = 0;
    function tick() {
      // Re-teleport every frame (position + look yaw/pitch + zero
      // velocity), not just once at the start - the fixed-step loop and any
      // stray mouse movement would otherwise drift the pose over 360 frames.
      teleport(pose);
      frame++;
      if (frame <= WARMUP_FRAMES) { requestAnimationFrame(tick); return; }
      if (n < MEASURE_FRAMES) {
        jsHist[n] = loop.stats.jsMs;
        intervalHist[n] = loop.stats.intervalMs;
        gpuHist[n] = gpuPipeline ? gpuPipeline.stats.gpuMsP50 : NaN;
        n++;
        requestAnimationFrame(tick);
        return;
      }
      results.push(buildResult(pose.name, jsHist, gpuHist, intervalHist, n, null));
      onDone();
    }
    requestAnimationFrame(tick);
  }

  function buildResult(name, jsArr, gpuArr, intervalArr, n, walkExtra) {
    const avgFps = n > 0 ? n / (sum(intervalArr, n) / 1000) : NaN;
    return {
      name,
      avgFps,
      jsAvg: avg(jsArr, n), jsP95: p95(jsArr, n), jsMax: max(jsArr, n),
      gpuP50: avg(gpuArr, n), gpuP95: p95(gpuArr, n),
      passP50: gpuPipeline ? Array.from(gpuPipeline.stats.passMsP50) : null,
      worstIntervalMs: walkExtra ? walkExtra.worstIntervalMs : undefined,
      over25: walkExtra ? walkExtra.over25 : undefined,
    };
  }

  function runViews(i) {
    if (i >= VIEWS.length) { runWalk(); return; }
    overlay.setText(`?bench=1  view ${i + 1}/${VIEWS.length}: ${VIEWS[i].name}\nwarming up...`);
    measureView(VIEWS[i], () => runViews(i + 1));
  }

  // Arch review 1 item 2: the walk phase used to `setText` (string
  // allocation) AND allocate a fresh `() => walkTick(startedAt, n)` closure
  // every single rAF for 60 s. `walkStartedAt`/`walkN` are plain outer-scope
  // state instead of closed-over call args, so `requestAnimationFrame`
  // always gets the same `walkTick` function reference, and the overlay
  // text is only rebuilt when `overlay.shouldRefresh()` allows it (<= 4 Hz,
  // same throttle rule as the normal HUD - architecture.md 16).
  let walkStartedAt = 0;
  let walkN = 0;

  function runWalk() {
    overlay.setText('?bench=1  views done - walk now (WASD) to start the 60 s walk measurement');
    requestAnimationFrame(waitForMove);
  }

  function waitForMove() {
    if (input.isDown('KeyW') || input.isDown('KeyA') || input.isDown('KeyS') || input.isDown('KeyD')) {
      loop.resetStats();
      walkStartedAt = performance.now();
      walkN = 0;
      requestAnimationFrame(walkTick);
      return;
    }
    requestAnimationFrame(waitForMove);
  }

  function walkTick() {
    const now = performance.now();
    const elapsed = now - walkStartedAt;
    if (walkN < MAX_SAMPLES) {
      jsHist[walkN] = loop.stats.jsMs;
      intervalHist[walkN] = loop.stats.intervalMs;
      gpuHist[walkN] = gpuPipeline ? gpuPipeline.stats.gpuMsP50 : NaN;
      walkN++;
    }
    if (overlay.shouldRefresh(now)) {
      overlay.setText(`?bench=1  walking... ${(elapsed / 1000).toFixed(0)}/${WALK_SECONDS}s`);
    }
    if (elapsed < WALK_SECONDS * 1000) { requestAnimationFrame(walkTick); return; }
    results.push(buildResult('60s walk', jsHist, gpuHist, intervalHist, walkN,
      { worstIntervalMs: loop.stats.worstIntervalMs, over25: loop.stats.over25 }));
    finish();
  }

  function finish() {
    const lines = [`?bench=1  grid ${rt.cols}x${rt.rows}  backend ${rt.backend}  path ${rt.gpuActive ? 'gpu' : 'cpu'}`];
    for (const r of results) {
      // AC (docs/backlog.md US-018): >= 58 fps avg, JS <= 2 ms avg target
      // (never above the binding 8 ms max), GPU <= 4 ms, over25 == 0 (walk only).
      const passFps = r.avgFps >= 58;
      const passJs = r.jsAvg <= 2 && r.jsMax <= 8;
      const passGpu = !gpuPipeline || Number.isNaN(r.gpuP50) || r.gpuP50 <= 4;
      const passWalk = r.over25 === undefined || r.over25 === 0;
      const verdict = (passFps && passJs && passGpu && passWalk) ? 'PASS' : 'CHECK';
      lines.push(`-- ${r.name} [${verdict}] --`);
      lines.push(`fps avg ${r.avgFps.toFixed(1)}  js avg/p95/max ${r.jsAvg.toFixed(2)}/${r.jsP95.toFixed(2)}/${r.jsMax.toFixed(2)} ms  ` +
        `gpu p50/p95 ${Number.isNaN(r.gpuP50) ? 'n/a' : r.gpuP50.toFixed(2)}/${Number.isNaN(r.gpuP95) ? 'n/a' : r.gpuP95.toFixed(2)} ms`);
      if (r.passP50) {
        lines.push('  pass p50 ms: ' + r.passP50.map((v, i) => `${PASS_LABELS[i]} ${Number.isNaN(v) ? 'n/a' : v.toFixed(2)}`).join('  '));
      }
      if (r.worstIntervalMs !== undefined) lines.push(`  worst interval ${r.worstIntervalMs.toFixed(1)} ms  over25 ${r.over25}`);
    }
    const text = lines.join('\n');
    window.__bench = results;
    console.log('[bench] US-018:', results);
    overlay.setText(text);
  }

  runViews(0);
}
