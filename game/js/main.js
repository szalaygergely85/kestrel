// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import {
  AssetRegistry, createEngine, clampGrid, GRID_DEFAULT_COLS,
  runShadeTest, runDetailShadeTest,
  GBuffer, bindShading, bindLevel,
  PlayerLook, DebugOverlay,
  integrate, Camera, renderWorld,
  GpuCellPipeline, runGpuCompare, compareCells, compareGeometry, poisonAllCells,
  loadLevel, beginFrame, castSectors, fillSky, computeDerivatives,
  shadeSurfaces, edgePass, ambientL, World, repackMaterials, drawSprites,
} from '../../engine/index.js';
import { POSES as GPU_COMPARE_POSES } from '../../tools/bench-poses.js';
import { drawPauseOverlay } from './ui/pauseOverlay.js';
import { drawDemoScene } from './dev/demoScene.js';
import { drawGlyphsScreen } from './dev/glyphsScene.js';
import { fillWorstCase } from './dev/benchScene.js';
// ---- US-030c (ARCH CHANGES): sprite system wiring, kept to this one import ----
import { createSpriteSystem, spawnTestSprites, placeCompareSprites } from './dev/spriteDev.js';
// ---- end US-030c ----
// ---- US-010: quest behaviours (registered by name before any World loads) ----
import { validateBehaviours } from '../../engine/index.js';
import './quest/index.js';
// ---- end US-010 ----

const params = new URLSearchParams(window.location.search);

// US-030a (docs/architecture.md 14.2 item 5): `?grid=WxH` clamped to
// 160x60..320x120 (8:3 aspect kept, see `clampGrid`), logged once here on
// the user-facing param (the RenderTarget-internal cpu-fallback log is
// separate). `?gpucompare=1` (this story's DDA parity page, 14.2 item 8)
// always forces 160x60 regardless of `?grid=` - `?gpucompare=shade` (the
// unchanged US-029 shading-only page) keeps whatever grid was requested.
const isDdaCompare = params.get('gpucompare') === '1';
const gridParam = params.get('grid');
let reqCols = GRID_DEFAULT_COLS, reqRows;
if (gridParam) {
  const m = /^(\d+)x(\d+)$/i.exec(gridParam.trim());
  if (m) { reqCols = Number(m[1]); reqRows = Number(m[2]); }
  else console.warn(`[grid] ?grid=${gridParam} not "WxH" - using the default ${GRID_DEFAULT_COLS}`);
}
if (isDdaCompare) { reqCols = 160; reqRows = 60; }
const gridResult = clampGrid(reqCols, reqRows);
if (gridParam && gridResult.clamped) {
  console.warn(`[grid] ?grid=${gridParam} clamped to ${gridResult.cols}x${gridResult.rows} (allowed range 160x60..320x120, 8:3 aspect)`);
}
const rayParam = Number(params.get('rays'));
const rays = Number.isFinite(rayParam) && rayParam >= 1 && rayParam <= 4 ? Math.round(rayParam) : 1;

const canvas = document.getElementById('screen');
const assets = AssetRegistry.fromGlobals(window.ASSETS);
const engine = createEngine({
  canvas, assets, cols: gridResult.cols, rows: gridResult.rows, rays,
  force2d: params.get('force2d') === '1',
  gpu: params.get('gpu') !== '0',
});
// `rt`/`depthBuffer`/`openSpans`/`gbuf` are `let`, not `const`: the fallback
// gate below (architect review 1 item 2) may call `engine.setGrid` once at
// startup, which replaces all three on `engine` - re-read here so every
// later reference (fb, sprites, window.__debug, render()) sees the
// post-fallback grid, not the original 240x90/`?grid=` request.
let { renderTarget: rt, depthBuffer, openSpans } = engine;
const { input } = engine;
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
let gbuf = new GBuffer(rt.cols, rt.rows);

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
    candidate.bind(matTable, assets.palette);
    gpuPipeline = candidate;
  }
}
// Architect review 1 item 2 (14.2 items 5/7 fallback matrix gap):
// `rt.backend === 'gl2'` only means RenderTarget.js's own probe found a
// real, non-software WebGL2 context - it says nothing about whether the
// cell pipeline actually compiled/linked (`candidate.ready` above, or
// `detailPass`/`matTable.allV2` not holding). When the gate above didn't
// produce a `gpuPipeline`, the CPU caster is about to run every frame
// (`fb.gpuDda` stays false, see `runGame`'s render()) - left at the
// default/`?grid=` grid it would cast at up to 320x120, 4x the CPU budget.
// Force the same `cpuGrid` RenderTarget.js already uses for `?gpu=0` and
// the software-renderer case (default 160x60), via `engine.setGrid`, and
// rebuild the CPU-side state that depends on grid size (`gbuf`; `rt`/
// `depthBuffer`/`openSpans` come straight off `engine`, which `setGrid`
// already replaced - this is the `grid:changed` event's payload, applied
// synchronously here since nothing GPU-side has consumed the old sizes yet).
if (rt.backend === 'gl2' && !gpuPipeline) {
  const { cols: cpuCols, rows: cpuRows } = engine.gridRequest.cpuGrid;
  if (rt.cols !== cpuCols || rt.rows !== cpuRows) {
    console.warn(`[grid] GpuCellPipeline unavailable on a gl2 backend - forcing the CPU fallback grid ${cpuCols}x${cpuRows} (was ${rt.cols}x${rt.rows})`);
    rt = engine.setGrid(cpuCols, cpuRows);
    depthBuffer = engine.depthBuffer;
    openSpans = engine.openSpans;
    gbuf = new GBuffer(rt.cols, rt.rows);
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

// ---- US-030c (ARCH CHANGES item 1): sprite system, after the pipeline gate ----
const sprites = createSpriteSystem({ assets, rt, gpuPipeline });
// ---- end US-030c ----

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine, gpuPipeline, gbuf, matTable, ambientL, depthBuffer, sprites };

if (params.get('bench') === '1') {
  runBenchmark(rt, overlay);
} else if (params.get('shadetest') === '1') {
  runShadeTest(assets.palette);
  if (assets.detailPass) runDetailShadeTest(assets.palette, assets.detailPass);
} else if (params.get('gpucompare') === '1') {
  runGpuCompareDdaMode();
} else if (params.get('gpucompare') === 'shade') {
  runGpuCompareShadeMode();
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
    // ---- US-010: `?strict=1` turns World.load's behaviour warning into a hard error ----
    if (params.get('strict') === '1') {
      const missing = validateBehaviours(world);
      if (missing.length) throw new Error(`[strict] behaviours referenced by level data but not registered: ${missing.join(', ')}`);
    }
    // ---- end US-010 ----
    for (const s of world.structures) {
      bindLevel(matTable, s.level); // US-028: pre-warm material ids per placed level
      repackMaterials(s.packed, s.level, matTable); // US-030a: packed.mats was built with matTable=null at placeStructure time
    }

    playerHandle = world.get('player');
    const startT = playerHandle.data.transform;
    Object.assign(playerHandle.data.components.body || (playerHandle.data.components.body = {}), {
      radius: engine.physics.radius, height: engine.physics.height, eyeH: engine.physics.eyeHeight,
      vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: startT.z,
    });
    look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg);
    // US-030c (ARCH CHANGES item 1): `?sprite=1` spawns the three test props in test_room.
    if (params.get('sprite') === '1') spawnTestSprites(world, startT);
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
    // US-030a: true once a ready GPU pipeline owns casting - `renderWorld`
    // (compositor.js) reads this and skips its whole CPU sequence; kept in
    // sync with `gpuPipeline`/`rt.gpuActive` right below `mode === 'world'`.
    gpuDda: false,
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
      // US-030a AC "the CPU caster no longer runs on the gl2 path": with a
      // ready GPU pipeline, `renderWorld` is a one-line no-op (compositor.js)
      // and the GLSL DDA (this frame's cam/world, below) does the entire
      // cast+shade+edge sequence instead.
      // Architect review 1 item 2: `rt.gpuActive` too, not just `!!gpuPipeline`
      // - after a failed WebGL2 context restore `gpuActive` goes false but
      // `gpuPipeline` itself is still the same (now-dead) object, so without
      // this check `renderWorld` would keep skipping the CPU cast -> black
      // world instead of falling back to it.
      fb.gpuDda = !!gpuPipeline && rt.gpuActive;
      renderWorld(fb, engine.world, cam);
      sprites.render(fb, engine.world, cam); // US-030c (ARCH CHANGES item 1): after the surfaces, before present()
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    if (mode === 'world' && !look.locked) drawPauseOverlay(rt, assets);
    // US-029/US-030a: the real GPU work happens inside `rt.present()`'s
    // hook, right below - `cam`/`engine.world` are only meaningful in
    // 'world' mode (fb.gpuDda is false otherwise, so the pipeline falls
    // back to the legacy `_repackAndUpload` path, harmlessly, in 'demo'/
    // 'glyphs' mode - gbuf is simply empty there).
    if (gpuPipeline) gpuPipeline.frame(fb, ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    rt.present();

    const lastRenderMs = performance.now() - renderStart;
    // US-030a (14.2 item 7): "path: gpu|cpu  grid: WxH  rays: n" on the overlay.
    let extra = `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rt.backend}` +
      `\npath: ${rt.gpuActive ? 'gpu' : 'cpu'}  grid: ${rt.cols}x${rt.rows}  rays: ${engine.rays}` +
      (gpuPipeline ? `  upload ${gpuPipeline.stats.uploadMs.toFixed(2)}ms  gpu ${Number.isNaN(gpuPipeline.stats.gpuMsP50) ? 'n/a' : gpuPipeline.stats.gpuMsP50.toFixed(2) + 'ms'}` : '') +
      (mode === 'world' ? `\n${sprites.overlayLine()}` : ''); // US-030c (ARCH CHANGES item 1)
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

// `?gpucompare=shade` (US-029 AC "Parity page", tech notes item 7; US-030a
// 14.2 item 7 keeps this test-only mode: `pipeline.setSource('upload')`
// feeds the CPU-cast G-buffer into the same uint textures the DDA cast pass
// now writes, isolating the shading/edge passes from the DDA itself). Casts
// the same `bench-cast.mjs` pose set (tools/bench-poses.js) against
// `test_room` on both paths and reports glyph/fg/bg parity. Shows PASS/FAIL
// on screen (the overlay) and in the console. Requires a working GPU
// pipeline - prints a clear message and does nothing else if one isn't active.
function runGpuCompareShadeMode() {
  if (!gpuPipeline) {
    const msg = '[gpucompare] no active GpuCellPipeline (backend=' + rt.backend + ', detail=' + (detailPass ? 'on' : 'off') +
      ', allV2=' + matTable.allV2 + ') - nothing to compare.';
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }

  gpuPipeline.setSource('upload'); // 14.2 item 7: force the legacy CPU-fed G-buffer path for this test

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

  let text = `?gpucompare=shade  GpuCellPipeline: ${gpuPipeline.rendererString}\n`;
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

// `?gpucompare=1` (US-030a AC "Parity: with N = 1 the GPU cast matches the
// JS caster"; docs/architecture.md 14.2 item 8): the DDA parity page. Runs
// at 160x60/n=1 (forced at bootstrap - see the `?grid=`/`isDdaCompare`
// block near the top of this file), casting `test_room` as a real `World`
// (so `renderWorld`'s `fb.gpuDda` branch is exercised exactly as gameplay
// uses it) through both paths from the same camera poses: `renderWorld`
// with `fb.gpuDda = false` for the CPU oracle (fills `fb.gbuf`/`fb.depth`
// and, via `shadeSurfaces`/`edgePass`, `rt.cells`), then poisons `rt.cells`
// (same non-tautology guard `runGpuCompare` uses) and re-runs with
// `fb.gpuDda = true` for the real GLSL DDA + GPU shade/edge. `compareCells`
// reports shading parity; `compareGeometry` (new, pure) reports geometry
// parity from a `readbackGeometry()` of `GI`/`GA`/`DEPTH`.
function runGpuCompareDdaMode() {
  if (!gpuPipeline) {
    const msg = '[gpucompare] no active GpuCellPipeline (backend=' + rt.backend + ', detail=' + (detailPass ? 'on' : 'off') +
      ', allV2=' + matTable.allV2 + ') - nothing to compare.';
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }
  if (rt.cols !== 160 || rt.rows !== 60) {
    console.warn(`[gpucompare] expected 160x60 for ?gpucompare=1, got ${rt.cols}x${rt.rows} - the grid-forcing block at the top of main.js may have been bypassed.`);
  }

  gpuPipeline.setSource('dda');

  // Two worlds: `test_room` with the shared US-029 pose set, plus `world_m1`
  // at the player's spawn pose (tower start, world (1497, 1027.5), yaw 330,
  // pitch 30) - the pose that exposed the "colour blocks, no glyphs" bug
  // (`ambientL` never primed on the GPU path) which the test_room poses
  // alone let through. `castTerrain` is still a no-op stub, so world_m1's
  // terrain adds no CPU-only cells here (see the US-030a notes, deviation 5).
  function loadCompareWorld(def) {
    const w = World.load(def, assets, {});
    for (const s of w.structures) {
      bindLevel(matTable, s.level);
      repackMaterials(s.packed, s.level, matTable); // US-030a: see the runGame('world') call site
    }
    return w;
  }
  const testRoom = loadCompareWorld(
    { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] },
  );
  const worldM1 = loadCompareWorld(assets.world('world_m1'));
  const m1Player = worldM1.get('player').data;
  const m1Eye = Camera.fromEntity(m1Player, engine.physics.eyeHeight);
  const runs = [
    ...GPU_COMPARE_POSES.map((pose) => ({ world: testRoom, name: `test_room: ${pose.name || '(pose)'}`, cam: { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg } })),
    { world: worldM1, name: `world_m1: player spawn (${m1Eye.x.toFixed(1)}, ${m1Eye.y.toFixed(1)}) yaw ${m1Eye.yawDeg} pitch ${m1Eye.pitchDeg}`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } },
    // Architect review 1 item 1: BUG-OWN-001's owner repro pose (tower,
    // sector 'L' looking over the closed grate 'G', ceilH 3.0 < eye) as a
    // 7th row. World position (debug overlay, feet/floor z) is (1500.69,
    // 1027.36, 3.00); cam.z here is EYE height (feet + eyeHeight 1.60 =
    // 4.60), matching every other row's `cam` convention above.
    { world: worldM1, name: 'world_m1: BUG-OWN-001 owner repro (1500.69, 1027.36) yaw 236 pitch -29',
      cam: { x: 1500.69, y: 1027.36, z: 3.00 + engine.physics.eyeHeight, yawDeg: 236, pitchDeg: -29 } },
  ];

  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, gpuDda: false,
  };

  const cols = rt.cols, rows = rt.rows, n = cols * rows;

  const rowsOut = [];
  let overallOk = true;
  let sampledOwnTextures = true;
  for (const { world, name, cam } of runs) {
    // GPU FIRST, from a poisoned, mask-free JS layer (`poisonAllCells`): the
    // GPU frame must produce every cell on its own, with no CPU pass having
    // run since the last pose - the `ambientL` bug only ever looked right
    // because the CPU oracle had just primed the light. `renderWorld` on
    // the DDA path is what primes it now (compositor.js), exactly as in
    // gameplay; then read back precisely what `present()` sampled.
    // US-030c (ARCH CHANGES item 1): place + project the compare sprites for
    // this pose once, before either path renders - the GPU sprite pass reads
    // the pool's projected texels inside rt.present() below, and the JS
    // `drawSprites` oracle reads the same pool after the CPU render.
    sprites.pool.reset();
    placeCompareSprites(cam, sprites.pool);
    sprites.pool.project(cam, rt, ambientL);

    poisonAllCells(rt.cells, n);
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam); // DDA path: primes ambientL, otherwise a no-op - real work is frame + present
    gpuPipeline.frame(fbCompare, ambientL, cam, world);
    rt.present(); // cell pass + GPU sprite pass (sprites.pass, registered on rt)
    const rb = rt.readbackPresent();
    sampledOwnTextures = sampledOwnTextures && rb.sampledOwnTextures;
    const gpuFg = rb.fg, gpuBg = rb.bg;
    const { GI, GA, Depth } = gpuPipeline.readbackGeometry();

    // CPU oracle second. `shadeSurfaces`/`edgePass` (inside `renderWorld`)
    // no-op whenever `rt.gpuActive` (set once by the pipeline's constructor)
    // - toggle it off around this pass, like `runGpuCompare` does, or
    // `rt.cells` never gets written. Writes fb.gbuf/fb.depth/rt.cells, all
    // consumed by the compares below before the next pose poisons them.
    const wasActive = rt.gpuActive;
    rt.gpuActive = false;
    fbCompare.gpuDda = false;
    renderWorld(fbCompare, world, cam); // full CPU cast + shade + edge + sky
    drawSprites(fbCompare, sprites.pool); // US-030c (ARCH CHANGES item 1): JS sprite oracle onto rt.cells
    rt.gpuActive = wasActive;

    // Architect review 1 item 5: `?gpucompare=1` (unlike the strict
    // `?gpucompare=shade` page) allows up to 0.5% of non-sky cells outside
    // +-4/channel, capped at a max delta of 64 (a shading-band flip, not a
    // wrong colour) - the world_m1 spawn/stair near-misses' documented
    // tolerance, re-checked after the BUG-OWN-001 fix above.
    const cmpCells = compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.005);
    const cmpGeom = compareGeometry(gbuf, depthBuffer.depth, GI, GA, Depth, cols, rows);
    const ok = cmpCells.pass && cmpGeom.pass;
    overallOk = overallOk && ok;
    rowsOut.push({ pose: name, cmpCells, cmpGeom, ok });
  }
  overallOk = overallOk && sampledOwnTextures;

  let text = `?gpucompare=1  GpuCellPipeline: ${gpuPipeline.rendererString}  grid: ${cols}x${rows}  rays: 1` +
    `  readback: present() units 0/1${sampledOwnTextures ? '' : '  (NOT rt.fgTex/bgTex - present() wiring bug)'}\n`;
  for (const r of rowsOut) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  geometry: kind ${r.cmpGeom.kindMatchPct.toFixed(2)}%  matEq ${r.cmpGeom.matEqual}/${r.cmpGeom.matched}  planeEq ${r.cmpGeom.planeEqual}/${r.cmpGeom.matched}` +
      `  depthViol ${r.cmpGeom.depthViol}  uvViol ${r.cmpGeom.uvViol}\n` +
      `  shading: glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}%  fgOut ${r.cmpCells.fgOutside}  bgOut ${r.cmpCells.bgOutside}` +
      `  outside ${(r.cmpCells.outsideFrac * 100).toFixed(3)}% (<=0.5%)  fgMax ${r.cmpCells.fgMax}  bgMax ${r.cmpCells.bgMax} (<=64)  poisonedSurvivors ${r.cmpCells.poisonedSurvivors}\n`;
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: kind=${r.cmpGeom.kindMatchPct.toFixed(2)}% glyph=${r.cmpCells.glyphMatchPct.toFixed(2)}% poisonedSurvivors=${r.cmpCells.poisonedSurvivors}`);
  }
  text += `\n${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare] ${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows: rowsOut, ok: overallOk };
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
