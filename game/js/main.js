// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import {
  AssetRegistry, createEngine, loadLevel, Player,
  beginFrame, castSectors, fillSky, runShadeTest,
  PlayerLook, DebugOverlay,
} from '../../engine/index.js';
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

console.log(`[RenderTarget] back-end: ${rt.backend}`); // D-005: which back-end actually ran (gl2 / c2d-capped)

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine };

if (params.get('bench') === '1') {
  runBenchmark(rt, overlay);
} else if (params.get('shadetest') === '1') {
  runShadeTest(assets.palette);
} else if (params.get('glyphs') === '1') {
  runGame('glyphs');
} else if (params.get('demo') === '1') {
  runGame('demo');
} else {
  runGame('raycast'); // default: US-004 sector raycaster on test_room
}

function runGame(mode) {
  if (params.get('debug') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`

  let simTime = 0;
  let level = null;
  let player = null;
  let look = null;
  let origin = { x: 0, y: 0, z: 0 };

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };

  if (mode === 'raycast') {
    level = loadLevel(assets.level('test_room'));
    if (!level) {
      console.error('[main] test_room failed to load (see errors above) - falling back to the demo scene.');
      mode = 'demo';
    } else {
      // US-005 owns turning (mouse/pointer-lock, arrow-key fallback);
      // Player (US-008/US-009, game/js/entities/Player.js) owns moving -
      // see the "Integration hook" note at the bottom of that file. No
      // physics integration here yet (US-025 splits this into Entity +
      // integrate()): movement is Player's current simple noclip-on-the-floor
      // behaviour.
      player = new Player(level);
      look = new PlayerLook(canvas, input, player.yawDeg, player.pitchDeg);

      // D-008 item 3 test switch: `?origin=1480,1018` renders test_room as
      // if it were a structure placed at that world offset. Player/PlayerLook
      // keep moving/colliding in the level's own LOCAL coordinates
      // (unaffected); only the eye position handed to castSectors (below) is
      // translated to world coordinates (+origin).
      const originParam = params.get('origin');
      if (originParam) {
        const [ox, oy] = originParam.split(',').map(Number);
        if (Number.isFinite(ox) && Number.isFinite(oy)) origin = { x: ox, y: oy, z: 0 };
      }
    }
  }

  function update(dt) {
    simTime += dt;
    if (input.pressed('F3')) overlay.toggle();
    if (look) look.update(dt);
    if (player) {
      controls.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      controls.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      controls.run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      // US-009: a HELD level, OR'd with the edge (`pressed`) so a Space tap
      // that starts and ends within one frame - between two fixed-step
      // updates - is never lost (Player does its own edge detection on top
      // of this, architecture.md section 5 `Controls` typedef).
      controls.jump = input.isDown('Space') || input.pressed('Space');
      controls.yawDeg = look.yawDeg;
      controls.pitchDeg = look.pitchDeg;
      player.update(dt, controls, level);
    }
    input.endFrame();
  }

  // Reused every frame (architecture.md section 9: no per-frame objects).
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
  const fb = { rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, lights: null, timeSec: 0 };

  function render(alpha) {
    const renderStart = performance.now();

    if (mode === 'glyphs') {
      drawGlyphsScreen(rt);
    } else if (mode === 'raycast') {
      // test_room is the whole world for now (origin = {0,0,0} unless
      // ?origin=... - see above) and there is no terrain pass yet, so
      // beginFrame + castSectors + fillSky reproduces this story's original
      // stand-alone look exactly (architecture.md section 5 compatibility
      // note: this replaces `skyFallback: true`).
      const eye = player.getEyeTransform(); // {x, y, z, yawDeg, pitchDeg} in LEVEL-local meters
      cam.x = eye.x + origin.x; cam.y = eye.y + origin.y; cam.z = eye.z + origin.z;
      cam.yawDeg = eye.yawDeg; cam.pitchDeg = eye.pitchDeg;
      fb.timeSec = simTime;
      beginFrame(fb);
      castSectors(fb, level, cam, origin);
      fillSky(fb, cam);
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    if (mode === 'raycast' && !look.locked) drawPauseOverlay(rt, assets);
    rt.present();

    const lastRenderMs = performance.now() - renderStart;
    const extra = mode === 'raycast'
      ? `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rt.backend}\n` +
        `pos (${player.x.toFixed(2)}, ${player.y.toFixed(2)}) yaw ${look.yawDeg.toFixed(0)} pitch ${look.pitchDeg.toFixed(0)}` +
        `${look.locked ? '' : ' [unlocked]'}`
      : `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rt.backend}`;
    overlay.update(engine.loop.fps, engine.loop.frameMs, extra);
  }

  const loop = engine.run({ update, render });
  window.__debug.loop = loop;
  window.__debug.level = level;
  window.__debug.player = player;
  window.__debug.look = look;
  window.__debug.depthBuffer = depthBuffer;
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
