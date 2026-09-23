// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import {
  AssetRegistry, createEngine,
  runShadeTest, runDetailShadeTest,
  GBuffer, bindShading, bindLevel,
  PlayerLook, DebugOverlay,
  integrate, Camera, renderWorld,
  GpuCellPipeline, runGpuCompare,
  loadLevel, beginFrame, castSectors, fillSky, computeDerivatives,
  shadeSurfaces, edgePass, ambientL,
} from '../../engine/index.js';
import { POSES as GPU_COMPARE_POSES } from '../../tools/bench-poses.js';
import { drawPauseOverlay } from './ui/pauseOverlay.js';
import { drawDemoScene } from './dev/demoScene.js';
import { drawGlyphsScreen } from './dev/glyphsScene.js';
import { fillWorstCase } from './dev/benchScene.js';

const params = new URLSearchParams(window.location.search);

const canvas = document.getElementById('screen');
const assets = AssetRegistry.fromGlobals(window.ASSETS);
const engine = createEngine({
  canvas, assets, cols: 160, rows: 60,
  force2d: params.get('force2d') === '1',
});
const { renderTarget: rt, depthBuffer, openSpans, input } = engine;
const overlay = new DebugOverlay(document.body);

// US-028: `?detail=0` renders the v1 look (A/B switch, no upkeep needed
// after this story - see docs/backlog.md US-028 AC "A/B switch"). Default
// is the v2 detail pass. `matTable`/`gbuf` are allocated once (module
// scope, this file only ever runs once per page load) and reused every
// frame, per architecture.md 8.1/9's "no per-frame allocation" rule.
const useDetail = params.get('detail') !== '0';
// `matTable` always resolves against the REAL detail-pass module (so a
// v2-only material key, e.g. `ceiling_timber`, still finds its `.v1`
// fallback) - `useDetail` alone decides whether `shadeSurfaces` is allowed
// to take the v2 branch (see the `detailPass` arg passed to it below).
const matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
const detailPass = useDetail ? assets.detailPass : null;
const gbuf = new GBuffer(rt.cols, rt.rows);

console.log(`[RenderTarget] back-end: ${rt.backend}`); // D-005: which back-end actually ran (gl2 / c2d-capped)

// US-029 tech notes item 1: the GPU cell pipeline is only ever constructed
// when every gate holds - `rt.backend === 'gl2'`, `?gpu=0` not set, a v2
// detail pass is bound AND covers every material this content pack uses
// (`matTable.allV2`; `?detail=0` sets `detailPass` to null above, so this
// condition is false there too, by construction). `isSoftwareRenderer` and
// shader compile/link failures are both handled INSIDE the constructor
// (tech notes item 9) - it never throws out here; `gpuPipeline.ready` is
// the one thing this file checks afterwards. Kept to this one `if` + one
// `new` + one `.bind()` call - everything else (the hook, the CPU no-op
// guards) lives in engine/render/gpu/ and engine/render/{detailShade,
// edgePass,CellBuffer,RenderTargetGL}.js, none of which is compositor.js/
// world/* (US-025, off-limits this story).
let gpuPipeline = null;
if (rt.backend === 'gl2' && params.get('gpu') !== '0' && detailPass && matTable.allV2) {
  const candidate = new GpuCellPipeline(rt);
  if (candidate.ready) {
    candidate.bind(matTable);
    gpuPipeline = candidate;
  }
}
const gpuDebugParam = params.get('gpudebug');
if (gpuPipeline && gpuDebugParam) {
  // Architect review 1 item 6 deviation: mode 2 is a "was this cell shaded"
  // indicator, not the real edge-rule code (no `ruleTex` MRT this story) -
  // named `shaded` here so nobody reads it as the rule.
  gpuPipeline.setDebugMode({ kind: 0, plane: 1, shaded: 2 }[gpuDebugParam] ?? -1);
}
// Architect review 1 minor item 4c: name the offending material keys when
// the gate didn't hold, so the content gap is visible without digging.
const inactiveReason = gpuPipeline
  ? ''
  : ' - JS shading' + (matTable.missingV2 && matTable.missingV2.length ? ` (missingV2: ${matTable.missingV2.join(', ')})` : '');
console.log(`[GpuCellPipeline] ${gpuPipeline ? 'active (' + gpuPipeline.rendererString + ')' : 'inactive' + inactiveReason}`);

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine };

if (params.get('bench') === '1') {
  runBenchmark(rt, overlay);
} else if (params.get('shadetest') === '1') {
  runShadeTest(assets.palette);
  if (assets.detailPass) runDetailShadeTest(assets.palette, assets.detailPass);
} else if (params.get('gpucompare') === '1') {
  runGpuCompareMode();
} else if (params.get('glyphs') === '1') {
  runGame('glyphs');
} else if (params.get('demo') === '1') {
  runGame('demo');
} else {
  runGame('world'); // default: US-025 World (world_m1, or ?level=<name> for a bare single-level world)
}

function runGame(mode) {
  if (params.get('debug') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`

  let simTime = 0;
  let look = null;
  let playerHandle = null;

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };

  if (mode === 'world') {
    // US-025: the real world (world_m1: terrain + the tower placed at its
    // recipe coordinates), or - `?level=<name>` - a bare single-level world
    // with no terrain (same shape `World.load` always expects, just with
    // `terrain: null`), so `test_room` stays reachable exactly as before.
    const levelParam = params.get('level');
    const worldDef = levelParam
      ? {
        name: `adhoc_${levelParam}`,
        terrain: null,
        structures: [{ id: levelParam, level: levelParam, origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
        entities: [{ id: 'player', type: 'player', spawn: { structure: levelParam, from: 'start' } }],
        state: {},
      }
      : assets.world('world_m1');

    const world = engine.loadWorld(worldDef);
    for (const s of world.structures) bindLevel(matTable, s.level); // US-028: pre-warm material ids per placed level

    playerHandle = world.get('player');
    const startT = playerHandle.data.transform;
    Object.assign(playerHandle.data.components.body || (playerHandle.data.components.body = {}), {
      radius: engine.physics.radius, height: engine.physics.height, eyeH: engine.physics.eyeHeight,
      vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: startT.z,
    });
    look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg);
  }

  function update(dt) {
    simTime += dt;
    if (input.pressed('F3')) overlay.toggle();
    if (look) look.update(dt);
    if (mode === 'world' && playerHandle) {
      controls.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      controls.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      controls.run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      // US-009: a HELD level, OR'd with the edge (`pressed`) so a Space tap
      // that starts and ends within one frame - between two fixed-step
      // updates - is never lost (integrate() does its own edge detection on
      // top of this, architecture.md section 5 `Controls` typedef).
      controls.jump = input.isDown('Space') || input.pressed('Space');
      controls.yawDeg = look.yawDeg;
      controls.pitchDeg = look.pitchDeg;
      integrate(playerHandle.data, dt, controls, engine.world, engine.physics);
      if (engine.world.terrain) engine.world.terrain.bakeFarStep(2); // US-025 AC: <= 2 ms/frame, amortised
      engine.world.flushEvents();
    }
    input.endFrame();
  }

  // Reused every frame (architecture.md section 9: no per-frame objects).
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
  const fb = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, lights: null, timeSec: 0,
    gbuf, matTable, detailPass, // US-028
  };

  function render(alpha) {
    const renderStart = performance.now();

    if (mode === 'glyphs') {
      drawGlyphsScreen(rt);
    } else if (mode === 'world') {
      // Player and camera live in WORLD coordinates (US-025 AC) - no origin
      // translation needed at the call site any more, `renderWorld` casts
      // each placed structure at its own origin internally (7.3).
      const eye = Camera.fromEntity(playerHandle.data);
      cam.x = eye.x; cam.y = eye.y; cam.z = eye.z; cam.yawDeg = eye.yawDeg; cam.pitchDeg = eye.pitchDeg;
      fb.timeSec = simTime;
      renderWorld(fb, engine.world, cam);
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    if (mode === 'world' && !look.locked) drawPauseOverlay(rt, assets);
    // US-029: `renderWorld` already ran (a no-op) `shadeSurfaces`/`edgePass`
    // when `rt.gpuActive` (set by the pipeline's constructor) - this just
    // hands it this frame's light + fb refs; the real GPU work happens
    // inside `rt.present()`'s hook, right below.
    if (gpuPipeline) gpuPipeline.frame(fb, ambientL);
    rt.present();

    const lastRenderMs = performance.now() - renderStart;
    let extra = `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rt.backend}` +
      `\nshade: ${rt.gpuActive ? 'gpu' : 'cpu'}` +
      (gpuPipeline ? `  upload ${gpuPipeline.stats.uploadMs.toFixed(2)}ms  gpu ${Number.isNaN(gpuPipeline.stats.gpuMsP50) ? 'n/a' : gpuPipeline.stats.gpuMsP50.toFixed(2) + 'ms'}` : '');
    if (mode === 'world') {
      const t = playerHandle.data.transform;
      const world = engine.world;
      const struct = world.structureAt(t.x, t.y);
      const sector = world.sectorAt(t.x, t.y);
      const sectorCh = struct ? struct.level.rows[Math.floor(t.y - struct.origin.y)][Math.floor(t.x - struct.origin.x)] : '(terrain)';
      const terrain = world.terrain;
      const terrainInfo = terrain
        ? `farReady ${terrain.farReady} (${(terrain.bakeProgress * 100).toFixed(0)}%) chunk (${Math.floor(t.x / terrain.chunkSize)},${Math.floor(t.y / terrain.chunkSize)})`
        : 'no terrain';
      extra += `\nworld (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}) yaw ${look.yawDeg.toFixed(0)} pitch ${look.pitchDeg.toFixed(0)}` +
        `${look.locked ? '' : ' [unlocked]'}\nstructure: ${struct ? struct.id : '(none)'} sector: '${sectorCh}'${sector ? '' : ' (outside)'}\n${terrainInfo}`;
    }
    overlay.update(engine.loop.fps, engine.loop.frameMs, extra);
  }

  const loop = engine.run({ update, render });
  window.__debug.loop = loop;
  window.__debug.world = engine.world;
  window.__debug.playerHandle = playerHandle;
  window.__debug.look = look;
  window.__debug.depthBuffer = depthBuffer;
}

// `?gpucompare=1` (US-029 AC "Parity page", tech notes item 7): casts the
// same `bench-cast.mjs` pose set (tools/bench-poses.js) against `test_room`
// on both paths and reports glyph/fg/bg parity. Shows PASS/FAIL on screen
// (the overlay) and in the console. Requires a working GPU pipeline - prints
// a clear message and does nothing else if one isn't active.
function runGpuCompareMode() {
  if (!gpuPipeline) {
    const msg = '[gpucompare] no active GpuCellPipeline (backend=' + rt.backend + ', detail=' + (detailPass ? 'on' : 'off') +
      ', allV2=' + matTable.allV2 + ') - nothing to compare.';
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }

  const level = loadLevel(assets.level('test_room'));
  bindLevel(matTable, level);
  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, light: ambientL, jsShade: shadeSurfaces, jsEdge: edgePass,
  };

  function castFrame(pose) {
    const cam = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    beginFrame(fbCompare);
    castSectors(fbCompare, level, cam, { x: 0, y: 0, z: 0 });
    computeDerivatives(fbCompare.gbuf, fbCompare.depth.depth);
    fillSky(fbCompare, cam);
    return cam;
  }

  const { rows, ok } = runGpuCompare(gpuPipeline, fbCompare, castFrame, GPU_COMPARE_POSES, null);

  let text = `?gpucompare=1  GpuCellPipeline: ${gpuPipeline.rendererString}\n`;
  for (const r of rows) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  glyph match (non-edge): ${r.glyphMatchPct.toFixed(2)}%  edge cells excluded: ${r.edgeCells}\n` +
      `  fg outside +-4: ${r.fgOutside}  bg outside +-4: ${r.bgOutside}  fgMax ${r.fgMax} bgMax ${r.bgMax}\n` +
      `  depth match: ${r.depthMatchPct}%  mat==0 cells: ${r.matZeroCount}\n`;
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: glyph=${r.glyphMatchPct.toFixed(2)}% fgOut=${r.fgOutside} bgOut=${r.bgOutside} fgMax=${r.fgMax} bgMax=${r.bgMax}`);
  }
  text += `\n${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare] ${ok ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows, ok };
}

// `?bench=1`: renders N worst-case frames (see dev/benchScene.js - every
// cell a unique, frame-varying, non-space glyph) back-to-back, outside the
// normal rAF loop, and reports avg/p95 for present() alone and for the full
// frame (fill + present). This is the reproducible measurement the US-001
// perf acceptance criterion is checked against.
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

window.addEventListener('resize', () => rt.resize());
// Some environments report a 0x0 viewport for a moment while a tab is
// hidden/unattached (see RenderTarget.resize's guard); re-check once it
// becomes visible so the grid never gets stuck at a degenerate size.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) rt.resize();
});
window.addEventListener('pageshow', () => rt.resize());
