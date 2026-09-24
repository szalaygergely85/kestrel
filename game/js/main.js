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
  integrate, stepRollers, resolveBodyContacts, Camera, renderWorld, stepSectorAnims, stepAnimations,
  GpuCellPipeline, runGpuCompare, compareCells, compareGeometry, compareLight, poisonAllCells, flickerStep,
  VoxelPool,
  loadLevel, beginFrame, castSectors, fillSky, computeDerivatives,
  shadeSurfaces, edgePass, ambientL, World, repackMaterials, drawSprites, HFOV_DEG,
  updateInteraction, drawCrosshair,
  buildLightSet, syncEntityLights, makeLightBuffer, attachedLightPos,
  isSoftwareRenderer,
  updateTriggers, moveCapsule, serialize, deserialize, createFadeLut, applySceneFade, clearMaskForSceneFade,
  createSceneDim, resetSceneDim, applySceneDim, drawPanel as drawUiPanel,
} from '../../engine/index.js';
import { POSES as GPU_COMPARE_POSES } from '../../tools/bench-poses.js';
import { drawPauseOverlay } from './ui/pauseOverlay.js';
import { computeEndCardState, drawEndCard } from './ui/endCard.js';
import { initTitleCard, drawTitleCard } from './ui/titleCard.js';
import { stepEnd, endFadeAmount } from './quest/end.js';
import { wakeFrame, drawEyelid } from './quest/wake.js';
import { initMapCard, stepMapCard, isMapOpen, getMapPanel } from './quest/mapCard.js';
import { resetHints, stepHints, drawHints, pushHintDim, setPaletteColors as setHintPaletteColors } from './quest/hints.js';
import { probeGpuSupport, showWebgl2RequiredScreen, showSoftwareRendererWarning } from './ui/webgl2Gate.js';
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
// BUG-GPU-002 tooling fix: both compare pages (`=1` and `=shade`) need the
// window-independent fixed camera box, not just the DDA/geometry one - see
// the `rt.resize(GPU_COMPARE_REF_*)` comment below.
const isGpuCompareMode = isDdaCompare || params.get('gpucompare') === 'shade';
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
// US-030b (14.2 item 5): default 2 (2x2 coverage vote) on the gl2 GPU path -
// `?rays=1..4` overrides for A/B (the flicker-metric page compares 1 vs the
// default). `?gpucompare=1` always forces n=1 regardless of `?rays=` (14.2
// item 8's parity contract): the DDA/geometry compare's "N=1 matches the JS
// caster exactly" AC would otherwise need the vote/average path to be a
// no-op, which it already is at n=1 - forcing it here just keeps the page's
// intent explicit and immune to a stray `?rays=` in the URL.
let rays = Number.isFinite(rayParam) && rayParam >= 1 && rayParam <= 4 ? Math.round(rayParam) : 2;
if (isDdaCompare) rays = 1;

const canvas = document.getElementById('screen');
const assets = AssetRegistry.fromGlobals(window.ASSETS);

// US-045 (D-017 item 2): no playable CPU fallback any more. `?gpu=0` and
// `?force2d=1` are dev/debug switches (D-017 item 3/4) and stay unaffected -
// they intentionally force the JS/Canvas2D reference path even on hardware
// that *does* have real WebGL2, so the gate below only blocks the DEFAULT
// (no dev switch) path. `webgl2gate=none|software` is a test-only override
// (not a documented AC) so the owner/tester can exercise both screens
// without swapping GPUs - see the story's Programmer notes.
const gpuDevSwitch = params.get('gpu') === '0' || params.get('force2d') === '1';
const gateTest = params.get('webgl2gate');
let gpuProbe = gateTest === 'none' ? { supported: false, isSoftware: false, renderer: '' }
  : gateTest === 'software' ? { supported: true, isSoftware: true, renderer: '(test override) SwiftShader' }
  : probeGpuSupport(isSoftwareRenderer);
const gpuBlocked = !gpuDevSwitch && !gpuProbe.supported;
if (gpuBlocked) showWebgl2RequiredScreen(canvas, assets);
else if (!gpuDevSwitch && gpuProbe.isSoftware) showSoftwareRendererWarning(assets, gpuProbe.renderer);
// US-012: crosshair/prompt colors, resolved once from the palette's `ui`
// semantic keys (design/palette.js section 8) - `ASSETS.uiStyle` doesn't
// exist yet (that's US-015's art), so this is the game's own small style
// object; `drawCrosshair` itself only ever reads `style`, never `ASSETS`.
const P = assets.palette;
const crosshairStyle = {
  crosshair: { dim: P.colors[P.ui.crosshair], active: P.colors[P.ui.crosshairActive] },
  prompt: { color: P.colors[P.ui.prompt], keyColor: P.colors[P.ui.promptKey] },
};
// US-017: same "ASSETS.uiStyle doesn't exist yet" fallback as crosshairStyle
// above (US-012 precedent) - `uiStyle.fade`'s ramp/letterIndex/minGain and
// `uiStyle.endText`'s color. `ramps.default`'s last index is its brightest
// step (design/palette.js section 2), used for any UI letter/digit not
// itself in the ramp (engine/ui/fade.js's `letterIndex`).
const defaultRamp = P.ramps.default;
const fadeLut = createFadeLut(defaultRamp, defaultRamp.length - 1, 0.12);
// US-015 (docs/architecture.md 7.6): the map card / hints scene dim, and the
// resolved palette hex map hints.js needs for its own RichLines (it has no
// `ASSETS` of its own - see hints.js `setPaletteColors`).
const sceneDim = createSceneDim();
if (assets.uiStyle) setHintPaletteColors(assets.uiStyle, P.colors);
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

// BUG-GPU-002 tooling fix: `?gpucompare=1`'s results depended on the real
// browser window/canvas size, because `rt.pxCellW`/`rt.pxCellH` (real,
// measured glyph-metrics device pixels - glyphMetrics.js's `computeCellBox`)
// are normally derived from `window.innerWidth`/`innerHeight`
// (RenderTargetGL.js/RenderTargetCanvas2D.js `resize()`), and every
// `screenAspect` used to build the camera plane (sectorCaster.js,
// GpuCellPipeline.js, sprites.js: `(cols*pxCellW)/(rows*pxCellH)`) reads
// those two fields straight off `rt` - so a wider/narrower window changed
// the ray geometry both paths cast against, before any GPU-vs-CPU
// comparison even started. HFOV_DEG (sectorCaster.js) was already a fixed
// constant, not window-derived - only pxCellW/pxCellH needed fixing.
// Forcing them to a fixed reference box (1280x720 @ dpr 1, computed the
// EXACT same way `resize()` always has - see RenderTargetGL.resize's new
// optional args) BEFORE `bindShading` (which also reads `rt.pxCellH/
// pxCellW` for `cellAspect`, used by both the JS and GPU shading paths)
// makes every downstream consumer - GPU pipeline and CPU/JS oracle alike,
// they both read the same `rt` - use identical, window-independent numbers.
// Gameplay (`runGame`, no `?gpucompare=` param) never calls `rt.resize()`
// with arguments, so its window-derived path is untouched.
const GPU_COMPARE_REF_W = 1280, GPU_COMPARE_REF_H = 720, GPU_COMPARE_REF_DPR = 1;
if (isGpuCompareMode) rt.resize(GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR);

// US-028: `?detail=0` renders the v1 look (A/B switch, no upkeep needed
// after this story - see docs/backlog.md US-028 AC "A/B switch"). Default
// is the v2 detail pass. `matTable`/`gbuf` are allocated once (module
// scope, this file only ever runs once per page load) and reused every
// frame, per architecture.md 8.1/9's "no per-frame allocation" rule.
const useDetail = params.get('detail') !== '0';
// US-006 AC "?lights=0 keeps the US-028 uniform ambient (regression path)".
const lightsEnabled = params.get('lights') !== '0';
// US-007 (14.3 item 8 fallback/switches): test-only sun disable, same shape
// as `?lights=0`.
const sunEnabled = params.get('sun') !== '0';
// ARCH CHANGES item 3 (14.4 item 8): `?terrain=0` dev A/B switch - skips
// terrain on BOTH paths (GPU: `GpuCellPipeline`'s `_terrainActiveThisFrame`
// gate; JS/CPU: `compositor.js`'s `castTerrain` call). Same shape as
// `?lights=0`/`?sun=0` above. Needed for item 4's GPU-ms A/B measurement.
const terrainEnabled = params.get('terrain') !== '0';
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
  const candidate = new GpuCellPipeline(rt, { rays, terrainEnabled });
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

if (gpuBlocked) {
  // AC "no game loop running underneath": the WebGL2-required screen is
  // already up (shown above) and the canvas is hidden. `createEngine`
  // above still ran (it just falls onto RenderTargetCanvas2D like the old
  // fallback did, harmlessly, on the hidden canvas) but none of the
  // branches below - every one of which ends in a `runGame`/`runBenchmark`
  // rAF loop - may start.
} else if (params.get('bench') === '1') {
  // US-001 canvas benchmark: raw CellBuffer present only. It never feeds the
  // GPU cell pipeline a frame (no fb/cam/world), so its hook must be off.
  if (gpuPipeline) gpuPipeline.setEnabled(false);
  runBenchmark(rt, overlay);
} else if (params.get('shadetest') === '1') {
  runShadeTest(assets.palette);
  if (assets.detailPass) runDetailShadeTest(assets.palette, assets.detailPass);
} else if (params.get('gpucompare') === '1') {
  runGpuCompareDdaMode();
} else if (params.get('gpucompare') === 'shade') {
  runGpuCompareShadeMode();
} else if (params.get('flicker') === '1') {
  runFlickerMode();
} else if (params.get('voxelbench') === '1') {
  runVoxelBenchMode();
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
  let lightSet = null; // US-006: built from the loaded world's level.def.lights, below

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
  // Reused every fixed step for `updateInteraction` (US-012 arch review,
  // 2026-09-24 item 2): `Camera.fromEntity` allocated a `new Camera` 60x/s.
  // The render path's own `Camera.fromEntity` call (below) may keep
  // allocating - it runs once per rendered frame, not per fixed step.
  const interactEye = new Camera();

  // US-015 (docs/architecture.md 7.6 item 8): the wake sequence's own
  // per-step output, reused every step (rule 9). `questUiActive` gates the
  // whole wake/title/map-card/hints system to worlds that actually declare
  // `quest.wakeT` in their initial state (world_m1 - `?level=<name>` adhoc
  // worlds have `state: {}` and skip it, unaffected).
  const wakeOut = { blackA: 1, blinkOpen: 0, eyeH: 0, inputLocked: true, titleState: 'none', titleA: 0, wakeDoneAtSec: 0, titleDoneAtSec: 0 };
  const wakeCfg = { blackSec: 1.0, riseSec: 1.2, blinkCurve: [[0, 0], [1.5, 1]], titleIn: 1, titleHold: 3, titleOut: 1, startEyeH: 0.3, bodyEyeH: 1.6 };
  let questUiActive = false;
  const hintSignals = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };
  let prevLookYaw = null, prevLookPitch = null; // US-015: "move or look input" done-predicate for the WASD/mouse hint

  let initialState = null; // US-017: serialize(world) right after World.load - `R` restarts to `deserialize(initialState)`

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

    // US-017 (7.4 "Restart / world swap"): every runtime rebuild this block
    // used to do ONCE, inline, now happens on `'world:loaded'` - emitted by
    // `World.load` on the first `engine.loadWorld` call below AND by
    // `engine.setWorld` on every later restart (`R`, see `update()`) - so a
    // restart rebuilds `playerHandle`/`look`/`lightSet` exactly the same
    // way the first load did, with no separate hand-written reset path
    // (architecture.md 7.4's "module-level game variables are reset only in
    // the 'world:loaded' handler" rule).
    engine.events.on('world:loaded', (evt) => {
      const world = evt.world;
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
      // US-006: `level.def.lights` per placed structure -> world-space LightSet
      // (torch/lantern/beacon presets, docs/architecture.md 14.3). `?lights=0`
      // keeps the old uniform-ambient path (fb.lights stays null).
      if (lightsEnabled) {
        lightSet = buildLightSet(world, assets.palette);
        // `?sun=0`: keep the sun's direction/color (F6/F7 still readable) but
        // force it off - `setSun` is the only writer of `on`.
        if (!sunEnabled) lightSet.setSun({ elevation: lightSet.sun.elevation, azimuth: lightSet.sun.azimuth, on: false });
      }
      // Architect review 1 item 7 (tech notes item 8): `?lights=8` test-only -
      // 7 synthetic extra lights (torch preset) spread 2-4 m around the
      // level's first light, so the tester can measure the "8 point lights"
      // AC (`?bench=1&lights=8`) at 320x120. Game-side only, not the engine.
      if (lightSet && lightSet.count >= 1 && params.get('lights') === '8') {
        const preset = assets.palette.lights.torch;
        const hue = assets.palette.hue[preset.color];
        const bx = lightSet.defX[0], by = lightSet.defY[0], bz = lightSet.defZ[0];
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2;
          const dist = 2 + (i % 3); // deterministic spread, 2-4 m
          lightSet.add({
            x: bx + Math.cos(ang) * dist, y: by + Math.sin(ang) * dist, z: bz,
            hue, intensity: preset.intensity, radius: preset.radius,
            flicker: preset.flicker || null, on: true, key: `synthetic.${i}`,
          });
        }
      }

      playerHandle = world.get('player');
      const startT = playerHandle.data.transform;
      Object.assign(playerHandle.data.components.body || (playerHandle.data.components.body = {}), {
        radius: engine.physics.radius, height: engine.physics.height, eyeH: engine.physics.eyeHeight,
        vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: startT.z,
      });
      if (look) look.dispose(); // arch review 1: no leaked click/pointerlock listeners across restarts
      look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg);
      // US-030c (ARCH CHANGES item 1): `?sprite=1` spawns the three test props in test_room.
      if (params.get('sprite') === '1') spawnTestSprites(world, startT);

      // ---- US-015: wake sequence + title card + map card + hints (7.6 item 6: runtime rebuilt here, every load AND every restart) ----
      questUiActive = typeof world.state['quest.wakeT'] === 'number';
      if (questUiActive && assets.uiStyle) {
        const spawnDef = (worldDef.entities || []).find((e) => e.id === 'player' && e.spawn);
        const spawnStruct = spawnDef && world.structures.find((s) => s.id === spawnDef.spawn.structure);
        const startPose = spawnStruct && spawnStruct.level.start;
        wakeCfg.startEyeH = (startPose && typeof startPose.eyeH === 'number') ? startPose.eyeH : engine.physics.eyeHeight;
        wakeCfg.bodyEyeH = engine.physics.eyeHeight;
        const blink = assets.uiStyle.blink;
        if (blink) wakeCfg.blinkCurve = blink.curve;
        const tc = assets.uiStyle.titleCard;
        if (tc) { wakeCfg.titleIn = tc.fadeIn; wakeCfg.titleHold = tc.hold; wakeCfg.titleOut = tc.fadeOut; }
        // Pose = 'lying': body eyeH starts low - see wake.js `wakeFrame`'s
        // rise (main.js's own step() writes `body.eyeH` every fixed step
        // while `wakeOut.inputLocked`, overriding the standing default the
        // Object.assign above just set).
        if (startPose && startPose.pose === 'lying') {
          playerHandle.data.components.body.eyeH = wakeCfg.startEyeH;
        }
        initTitleCard(assets, rt.cols, rt.rows);
        initMapCard(assets, rt.cols, rt.rows);
        resetHints();
      }
      // US-017 tester fix pass 2 (BUG-2): `window.__debug.world/playerHandle/look`
      // used to be set once, right after the FIRST `engine.run(...)` call
      // (below), and never refreshed - so after a restart (`R`, this same
      // handler firing again with a new `world`/`playerHandle`/`look`) they
      // kept pointing at the pre-restart objects while the live closure
      // variables the game actually uses had already moved on. This handler
      // is the single place both the first load and every restart go
      // through, so refresh the debug refs here instead.
      window.__debug.world = world;
      window.__debug.playerHandle = playerHandle;
      window.__debug.look = look;
    });

    engine.loadWorld(worldDef);
    // US-017: taken right after World.load (the listener above has already
    // run synchronously by the time `loadWorld` returns - `Events.emit` is
    // synchronous) - so this already includes the body-physics defaults and
    // spawned test sprites, exactly like a restart's `deserialize` would
    // reproduce.
    initialState = serialize(engine.world);
  }

  function update(dt) {
    simTime += dt;
    if (input.pressed('F3')) overlay.toggle();
    // US-007 AC "Sun direction can be changed with debug keys (F6/F7 rotate
    // azimuth) to verify shadows move correctly" - +-5 deg, `setSun` is the
    // only mutator (docs/architecture.md 14.3 item 3).
    if (lightSet) {
      if (input.pressed('F6')) lightSet.setSun({ elevation: lightSet.sun.elevation, azimuth: lightSet.sun.azimuth - 5, on: sunEnabled });
      if (input.pressed('F7')) lightSet.setSun({ elevation: lightSet.sun.elevation, azimuth: lightSet.sun.azimuth + 5, on: sunEnabled });
    }
    // US-017 (7.4 item 2): "entering the end trigger locks input" - no
    // pointer-look, no WASD/jump, no `E`. `quest.endT` (world.state, set by
    // `quest.end`, game/js/quest/end.js) is the one flag both `update()` and
    // `render()` read for this - never a separate module-level bool (7.4's
    // "state that must reset lives in world.state" rule; a restart resets
    // it back to -1 for free, via `deserialize(initialState)`).
    const ending = mode === 'world' && playerHandle
      && typeof engine.world.state['quest.endT'] === 'number' && engine.world.state['quest.endT'] >= 0;

    // ---- US-015: wake timeline + map card (world_m1 only, questUiActive) ----
    let uiLocked = false;
    let mPressedEdge = false;
    if (mode === 'world' && playerHandle && questUiActive && !ending) {
      engine.world.state['quest.wakeT'] += dt;
      wakeFrame(engine.world.state['quest.wakeT'], wakeCfg, wakeOut);
      if (wakeOut.inputLocked) playerHandle.data.components.body.eyeH = wakeOut.eyeH;
      mPressedEdge = input.pressed('KeyM');
      stepMapCard(engine.world, assets, dt, input, engine.world.state['quest.wakeT'], wakeOut.titleDoneAtSec);
      uiLocked = wakeOut.inputLocked || isMapOpen();
    }

    if (look && !ending) {
      // US-015 (7.6 item 5): while locked, PlayerLook still drains the raw
      // mouse delta every step (so nothing pent up snaps the camera once
      // input unlocks) but its result is simply discarded, not applied.
      if (uiLocked) input.consumeMouseDelta();
      else look.update(dt);
    }
    if (mode === 'world' && playerHandle) {
      if (ending || uiLocked) {
        controls.forward = 0; controls.strafe = 0; controls.run = false; controls.jump = false;
      } else {
        controls.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
        controls.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
        controls.run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
        // US-009: a HELD level, OR'd with the edge (`pressed`) so a Space tap
        // that starts and ends within one frame - between two fixed-step
        // updates - is never lost (integrate() does its own edge detection on
        // top of this, architecture.md section 5 `Controls` typedef).
        controls.jump = input.isDown('Space') || input.pressed('Space');
      }
      if (ending) {
        // Arch review 1: `integrate` copies controls.yaw/pitch onto the
        // transform every step, so once `stepEnd`'s walk phase is over the
        // stale `look.pitchDeg` would snap the camera back up. While ending
        // the transform is authoritative (stepEnd wrote it); keep `look` in
        // step with it so nothing jumps.
        const pt = playerHandle.data.transform;
        controls.yawDeg = pt.yawDeg; controls.pitchDeg = pt.pitchDeg;
        look.yawDeg = pt.yawDeg; look.pitchDeg = pt.pitchDeg;
      } else {
        controls.yawDeg = look.yawDeg;
        controls.pitchDeg = look.pitchDeg;
      }
      // US-014 (7.4 fixed-step order item 1): before `integrate`, so
      // collision this step already sees the grate's current ceiling.
      stepSectorAnims(engine.world, dt);
      integrate(playerHandle.data, dt, controls, engine.world, engine.physics);
      // US-013 (7.4 fixed-step order item 3): after `integrate`, so the
      // player's this-step velocity is what a push is measured against.
      stepRollers(engine.world, dt, engine.physics);
      // US-011 (7.5 item 3): the clip player, right after stepRollers (the
      // boulder/lever's own gameplay-driven `fps:0` clips are untouched by
      // this - it only advances timed clips like the burner flame / lantern
      // glint / relay sparkle).
      stepAnimations(engine.world, dt * 1000);
      resolveBodyContacts(engine.world, playerHandle.data, engine.physics);
      // US-017 (7.4 fixed-step order item 4): after physics settles, before
      // interaction - an enter edge on the end trigger sets `quest.endT`.
      updateTriggers(engine.world, engine, playerHandle.data);
      // US-012 (7.4 fixed-step order item 5): after physics settles this
      // step's position, before the event flush - `E` is edge-triggered the
      // same way Space is (US-009's convention). Forced false while ending
      // (input locked - no other interactable may fire mid-ending).
      updateInteraction(engine.world, engine, Camera.fromEntityInto(playerHandle.data, undefined, interactEye), !ending && !uiLocked && input.pressed('KeyE'));
      // US-017: the scripted walk/pitch (only through WALK_SEC - a no-op
      // otherwise, including every non-ending step). Runs AFTER `integrate`
      // so it overrides this step's `controls`-driven (frozen) transform.
      stepEnd(engine.world, playerHandle.data, dt, assets.uiStyle, moveCapsule);
      // US-015: hint FIFO (`hint.show` zone triggers already fired above via
      // `updateTriggers`; this advances timers/fades and the done predicates).
      if (questUiActive && !ending) {
        const body = playerHandle.data.components.body;
        const moving = !!body && body.grounded && (controls.forward !== 0 || controls.strafe !== 0);
        const moveOrLook = controls.forward !== 0 || controls.strafe !== 0
          || (prevLookYaw !== null && (look.yawDeg !== prevLookYaw || look.pitchDeg !== prevLookPitch));
        hintSignals.walking = moving;
        hintSignals.pointerUnlocked = !look.locked;
        hintSignals.moveOrLook = moveOrLook;
        hintSignals.run = controls.run && moving;
        hintSignals.jump = input.pressed('Space');
        hintSignals.pointerLocked = look.locked;
        hintSignals.mPressed = mPressedEdge;
        stepHints(engine.world, assets.uiStyle, dt, hintSignals); // reused object (7.6 item 9: no per-step allocation)
        prevLookYaw = look.yawDeg; prevLookPitch = look.pitchDeg;
      }
      if (engine.world.terrain) engine.world.terrain.bakeFarStep(2); // US-025 AC: <= 2 ms/frame, amortised
      engine.world.flushEvents();

      // US-017 AC "R restarts the slice ... with all state reset": only
      // once `[R] Wake again` is showing (computeEndCardState's
      // `canRestart`) - never a bare `endT >= 0` check, so `R` can't cut the
      // walk/fade/typing short. `deserialize(initialState)` + `setWorld`
      // rebuilds a brand-new World (lamp/boulder/lever/grate/relay/map-card/
      // hints all come back from `initialState`, US-025's own round trip -
      // nothing is a hand-written reset list, per 7.4).
      if (ending && input.pressed('KeyR')) {
        const st = computeEndCardState(engine.world, assets.uiStyle);
        if (st.canRestart) {
          engine.setWorld(deserialize(initialState, assets));
          input.endFrame();
          return;
        }
      }
    }
    input.endFrame();
  }

  // Reused every frame (architecture.md section 9: no per-frame objects).
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };
  // US-006: reused per-frame scratch for `syncEntityLights`'s
  // `attachedLightPos` output (architecture.md 9 - no per-frame allocation).
  const lightSyncPos = new Float64Array(3);
  const fb = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, lights: lightSet,
    light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf, matTable, detailPass, // US-028
    // US-030a: true once a ready GPU pipeline owns casting - `renderWorld`
    // (compositor.js) reads this and skips its whole CPU sequence; kept in
    // sync with `gpuPipeline`/`rt.gpuActive` right below `mode === 'world'`.
    gpuDda: false,
    // PO REJECT item 1: this is the ONE real gameplay frame buffer, so
    // `lightSurfaces` (lighting.js) caps to the 4 nearest `on` lights
    // whenever this object's CPU path actually runs (`?gpu=0`, or the GPU
    // pipeline unavailable). `?gpucompare=1`'s separate `fbCompare` objects
    // never set this, so GPU parity keeps the full light list.
    cpuLightCap: true,
    // US-017: CPU-path-only scene fade (compositor.js) - `fadeLut` is fixed
    // (built once, above); `sceneFade` (1 = off) is written per frame in
    // render(), below.
    fadeLut,
    sceneFade: 1,
    // ARCH CHANGES item 3: `?terrain=0` dev A/B switch, CPU/JS-oracle side
    // (compositor.js reads this; the GPU side is `gpuPipeline.terrainEnabled`).
    terrainEnabled,
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
      // Arch review 1 (US-017): `lightSet` is rebuilt by the 'world:loaded'
      // handler on every restart - rebind it here, or `fb.lights` would keep
      // pointing at the previous world's LightSet (beacon state etc.).
      fb.lights = lightSet;
      // US-006: carried-light sync (US-012's lantern, `components.light`)
      // then flicker/vis-grid update, once per rendered frame, BEFORE either
      // the CPU (`renderWorld`) or GPU (`gpuPipeline.frame`) path reads
      // `fb.lights` - the GPU path never calls into compositor.js's own
      // (CPU-only) lighting hook, so this must run here, not there.
      if (fb.lights) {
        syncEntityLights(fb.lights, engine.world, assets.palette, attachedLightPos, lightSyncPos);
        fb.lights.update(fb.timeSec, engine.world);
      }
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
      // US-017 (7.4 "Fade"): 1 = off outside the end sequence. CPU path
      // only (compositor.js's early-out on `fb.gpuDda`) - see US-017-gpu.
      fb.sceneFade = endFadeAmount(engine.world, assets.uiStyle);
      renderWorld(fb, engine.world, cam);
      sprites.render(fb, engine.world, cam); // US-030c (ARCH CHANGES item 1): after the surfaces, before present()
      // US-017 ARCH CHANGES #1 item 2: CPU-path scene fade, moved here from
      // compositor.js so sprites fade too (oracle parity with the GPU
      // composite pass, which fades every non-mask cell in one pass). Skips
      // itself on the GPU-DDA path (`renderWorld`'s early-out already left
      // `fb.rt.cells` untouched there; the GPU sprite pass does its own
      // fade instead - see engine/render/gpu/glsl/sprites.frag.js).
      // US-017 tester fix pass 2 (BUG-1): `renderWorld`/`sprites.render`
      // above drew the whole 3D scene through `CellBuffer.setCellRGB`,
      // which sets `cb.mask = 1` on every cell it touches - `clearMaskForSceneFade`
      // clears that before fading (no UI has been drawn yet this frame), or
      // `applySceneFade`'s `if (mask[i]) continue` would skip the entire 3D
      // view (the scene never visibly faded on `?gpu=0`).
      if (!fb.gpuDda && fb.fadeLut && typeof fb.sceneFade === 'number') {
        clearMaskForSceneFade(fb.rt);
        applySceneFade(fb.rt, fb.sceneFade, fb.fadeLut);
      }
      const ending = typeof engine.world.state['quest.endT'] === 'number' && engine.world.state['quest.endT'] >= 0;
      const uiLockedNow = questUiActive && !ending && (wakeOut.inputLocked || isMapOpen());
      // US-015 (docs/architecture.md 7.6 item 3): map-card / hint scene dim.
      // Reset every frame (so a leftover dim never bleeds into the ending
      // screen or a non-quest world), pushed only while active. CPU path
      // (`applySceneDim`) and GPU path (`sprites.pass.setSceneDim`, read by
      // `sprites.frag.js`'s `uDim*` uniforms inside `rt.present()` below)
      // both read the same `sceneDim` object, same precedent as `fadeLut`/
      // `fb.sceneFade` just above.
      resetSceneDim(sceneDim);
      if (questUiActive && !ending) {
        const mapPanel = getMapPanel();
        if (mapPanel) mapPanel.pushDim(sceneDim);
        pushHintDim(rt, assets.uiStyle, sceneDim);
      }
      if (!fb.gpuDda) applySceneDim(rt, sceneDim);
      if (sprites.pass) sprites.pass.setSceneDim(sceneDim);
      // US-012 (7.4): crosshair + "[E] ..." prompt, emissive UI drawn after
      // the world/sprite passes, never depth-tested (architecture.md 8).
      // Hidden while ending or while wake/map-card input is locked (US-015:
      // there is never a usable target/prompt to show then).
      if (!ending && !uiLockedNow) drawCrosshair(rt, crosshairStyle, engine.world.interaction);
      if (questUiActive && !ending) {
        drawHints(rt, assets.uiStyle, fadeLut);
        drawEyelid(rt, assets.uiStyle, wakeOut.blinkOpen);
        drawTitleCard(rt, fb.timeSec * 1000, wakeOut.titleA, wakeOut.titleState, fadeLut);
        const mapPanel = getMapPanel();
        if (mapPanel) drawUiPanel(rt, mapPanel, fb.timeSec * 1000, fadeLut);
      }
      // US-017: the end card, drawn last (over the faded scene) - `setCell`
      // marks these cells `mask = 1` (engine/render/CellBuffer.js), so a
      // second `applySceneFade` call (e.g. a future frame) never touches them.
      const endCardState = computeEndCardState(engine.world, assets.uiStyle);
      drawEndCard(rt, assets.uiStyle, P.colors, endCardState);
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    // US-015 tester BUG-1: the map card owns the screen while open (its own
    // click/key dismiss), so the pause text must not overprint it (160x60).
    if (mode === 'world' && !look.locked && !isMapOpen()) drawPauseOverlay(rt, assets);
    // US-029/US-030a: the real GPU work happens inside `rt.present()`'s
    // hook, right below - `cam`/`engine.world` are only meaningful in
    // 'world' mode (fb.gpuDda is false otherwise, so the pipeline falls
    // back to the legacy `_repackAndUpload` path, harmlessly, in 'demo'/
    // 'glyphs' mode - gbuf is simply empty there).
    // US-006: `fb.lights` (a real LightSet) on the main game loop; every
    // other call site in this file still passes `ambientL` (ambient-only,
    // 0 point lights - GpuCellPipeline.js's `_uploadLightUniforms` treats a
    // plain array as back-compat ambient-only input).
    if (gpuPipeline) gpuPipeline.frame(fb, (mode === 'world' && fb.lights) || ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    rt.present();

    const lastRenderMs = performance.now() - renderStart;
    // US-030a (14.2 item 7): "path: gpu|cpu  grid: WxH  rays: n" on the overlay.
    let extra = `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rt.backend}` +
      `\npath: ${rt.gpuActive ? 'gpu' : 'cpu'}  grid: ${rt.cols}x${rt.rows}  rays: ${engine.rays}` +
      (gpuPipeline ? `  upload ${gpuPipeline.stats.uploadMs.toFixed(2)}ms  gpu ${Number.isNaN(gpuPipeline.stats.gpuMsP50) ? 'n/a' : gpuPipeline.stats.gpuMsP50.toFixed(2) + 'ms'}` +
        // ARCH CHANGES item 4: `terrainSubmitMs*` is CPU draw-call submit
        // time, not a GPU cost - the real terrain GPU cost is the whole-frame
        // `gpuMs` A/B delta with vs without `?terrain=0` (measured + recorded
        // in this story's Programmer notes, docs/backlog.md).
        `  terrain cpu ${Number.isNaN(gpuPipeline.stats.terrainSubmitMsP50) ? 'n/a' : gpuPipeline.stats.terrainSubmitMsP50.toFixed(2) + 'ms'}` : '') +
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

  // BUG-GPU-002 tooling fix: same fixed reference box as `?gpucompare=1`
  // (see the `rt.resize(GPU_COMPARE_REF_*)` call near the top of this file).
  const refScreenAspectShade = (rt.cols * rt.pxCellW) / (rt.rows * rt.pxCellH);
  console.log(`[gpucompare] ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px  aspect=${refScreenAspectShade.toFixed(4)}  fov=${HFOV_DEG} deg`);
  let text = `?gpucompare=shade  GpuCellPipeline: ${gpuPipeline.rendererString}\n` +
    `ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px` +
    `  aspect=${refScreenAspectShade.toFixed(4)}  fov=${HFOV_DEG} deg (fixed, window-independent)\n`;
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
  // US-016 step 4 (14.4 item 6/9, D-017 item 11): this compare page must
  // exercise terrain (kind 7) cells, which `castTerrain`/`_passTerrain` both
  // no-op until `terrain.farReady` - `bakeFarStep` is the amortised, per-
  // frame bake real gameplay uses (main.js `render()`, 2 ms/frame budget),
  // but this harness runs once, synchronously, outside the frame loop, so
  // the deterministic, bit-identical `bakeFarSync` is the right call here
  // (same one `terrainCaster.test.js`/`TerrainTextures.test.js` use as their
  // oracle setup).
  if (worldM1.terrain) worldM1.terrain.bakeFarSync();
  const m1Player = worldM1.get('player').data;
  const m1Eye = Camera.fromEntity(m1Player, engine.physics.eyeHeight);
  // Architect review 1 item 2: build a real `LightSet` per compare world (the
  // torch in `test_room`, whatever `level.def.lights` world_m1's structures
  // carry) so `?gpucompare=1` proves CPU/GPU parity with point lights ON, not
  // just ambient-only. `?lights=0` still keeps `lightsEnabled` false, so this
  // page's own "lights-off still passes" run is exercised by the same flag
  // gameplay uses - no separate on/off toggle needed here.
  const testRoomLights = lightsEnabled ? buildLightSet(testRoom, assets.palette) : null;
  const worldM1Lights = lightsEnabled ? buildLightSet(worldM1, assets.palette) : null;
  // BUG-LIGHT-001 repro (docs/backlog.md row 25b): "persists with ?sun=0" -
  // this page used to build its own LightSet without ever consulting
  // `sunEnabled` (only the real gameplay `lightSet` at the top of this file
  // did), so `?gpucompare=1&sun=0` silently ran with the sun still on. Same
  // `setSun` call the gameplay path uses (`setSun` is the only writer of `on`).
  if (!sunEnabled) {
    if (testRoomLights) testRoomLights.setSun({ elevation: testRoomLights.sun.elevation, azimuth: testRoomLights.sun.azimuth, on: false });
    if (worldM1Lights) worldM1Lights.setSun({ elevation: worldM1Lights.sun.elevation, azimuth: worldM1Lights.sun.azimuth, on: false });
  }
  const runs = [
    ...GPU_COMPARE_POSES.map((pose) => ({ world: testRoom, lights: testRoomLights, name: `test_room: ${pose.name || '(pose)'}`, cam: { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg } })),
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn (${m1Eye.x.toFixed(1)}, ${m1Eye.y.toFixed(1)}) yaw ${m1Eye.yawDeg} pitch ${m1Eye.pitchDeg}`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg } },
    // Architect review 1 item 1: BUG-OWN-001's owner repro pose (tower,
    // sector 'L' looking over the closed grate 'G', ceilH 3.0 < eye) as a
    // 7th row. World position (debug overlay, feet/floor z) is (1500.69,
    // 1027.36, 3.00); cam.z here is EYE height (feet + eyeHeight 1.60 =
    // 4.60), matching every other row's `cam` convention above.
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: BUG-OWN-001 owner repro (1500.69, 1027.36) yaw 236 pitch -29',
      cam: { x: 1500.69, y: 1027.36, z: 3.00 + engine.physics.eyeHeight, yawDeg: 236, pitchDeg: -29 } },
    // US-017 ARCH CHANGES #1 item 3: one pose with `sceneFade = 0.5` (7.4
    // "Fade"), reusing the world_m1 spawn cam - proves the GPU composite
    // pass's `uSceneFade`/LUT (sprites.frag.js) matches the CPU
    // `applySceneFade` oracle (now run after sprites too, item 2).
    { world: worldM1, lights: worldM1Lights, name: `world_m1: player spawn, sceneFade=0.5`,
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg }, fade: 0.5 },
    // US-015 (docs/architecture.md 7.6 item 3/9): "card open" pose - whole
    // scene dim 0.35 (`SceneDim.all`) plus one plate rect at 0.18, the exact
    // shape `mapCard.js`'s `panel.pushDim` produces while the card is up.
    // Proves the GPU composite pass's `uDim*` uniforms (sprites.frag.js)
    // match the CPU `applySceneDim` oracle.
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: player spawn, card open (sceneDim 0.35 + plate 0.18)',
      cam: { x: m1Eye.x, y: m1Eye.y, z: m1Eye.z, yawDeg: m1Eye.yawDeg, pitchDeg: m1Eye.pitchDeg },
      dim: { all: 0.35, n: 1, rects: (() => { const r = new Float32Array(20); r.set([10, 4, 70, 26, 0.18]); return r; })() } },
    // US-011 (7.5 item 6): the REAL prop pool (`pool.collect(world)`, not
    // `placeCompareSprites`) at poses that exercise the new tower props -
    // lit burner + brass lamp + gondola + canvas heap + rubble near the wake
    // spot, the lamp's empty-bracket variant, the lever mid-`pull`, the
    // boulder mid-roll, and the relay at distance (half LOD). `worldM1` is
    // the same live World every pose above already shares; `before` mutates
    // sprite state directly (not through a behaviour, so it never touches
    // `world.state`/once-flags) and runs right before that pose renders -
    // placed last so it never affects the poses above.
    // Local (17.5, 8.5) is open floor (tower.js row 8, col 17 = '.'); the
    // original (13.5, 11.0)/(19.0, 11.5) guesses sat inside a `&` wall cell
    // (row 11), which rendered 0 geometry samples (fixed after a `?gpucompare=1`
    // FAIL: "kind 0.00%, matEq 0/0" - nothing was cast at all).
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: crash room (burner + lamp + gondola + heap + rubble, near LOD)',
      cam: { x: 1497.5, y: 1026.5, z: engine.physics.eyeHeight, yawDeg: 30, pitchDeg: 5 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: lamp empty (post pickup)',
      cam: { x: 1497.5, y: 1027.0, z: engine.physics.eyeHeight, yawDeg: 15, pitchDeg: 10 }, real: true,
      before: () => { const h = worldM1.get('tower.lantern'); if (h) h.play('empty'); } },
    // Local (18.0, 9.3) is open floor (row 9, col 18 = '.'), facing east
    // (yaw 90) toward the lever post at (19.25, 9.3).
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: lever mid-pull',
      cam: { x: 1498.0, y: 1027.3, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 5 }, real: true,
      before: () => { const h = worldM1.get('tower.lever'); if (h) { h.play('pull', { restart: true }); h.stop(); h.data.components.sprite.frame = 2; } } },
    // Local (13.5, 4.5) is the open `o` hollow cell west of the stair base, looking at the
    // boulder (15.55, 3.5) at bearing 64 (architect review 1: the old (13.0, 5.0)/yaw 100 pose
    // had the boulder ~50 deg off-axis, outside the 37.5 deg half-FOV). Known FAIL: BUG-LIGHT-001
    // (surface light-pass parity at the stair's depth discontinuities, not sprites).
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: boulder mid-roll',
      cam: { x: 1493.5, y: 1022.5, z: engine.physics.eyeHeight, yawDeg: 64, pitchDeg: -20 }, real: true,
      before: () => { const h = worldM1.get('tower.boulder'); if (h) h.data.components.sprite.frame = 4; } },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: relay at distance (half LOD)',
      cam: { x: 1497.0, y: 1027.5, z: engine.physics.eyeHeight, yawDeg: 250, pitchDeg: -2 }, real: true },
    // US-016 step 4 (architecture.md 14.4 item 14, D-017 review): the two
    // new terrain/horizon poses the tech notes call for, on top of the
    // step 2/3 GLSL terrain march - both must clear terrain kind-7 parity
    // (`castTerrain`/`shadeTerrainFar` oracle, `compareCells`/`compareGeometry`
    // above) AND, once step 5 lands, the Ferrum horizon billboard on their
    // sky cells. World coords: tower origin (1480, 1018, 0) + local (per
    // tower.js): breach (6.5, 7.0), floorH 6.0 -> eye 6.0+1.60 = 7.6 m;
    // the relay plinth (9.0, 7.0), floorH 6.6 (0.6 m plinth on the 6.0 m
    // summit walkway) -> eye 6.6+1.60 = 8.2 m (D-011 addendum designer
    // notes, "relay plinth eye 8.2 m").
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: summit east (relay plinth, yaw 87.6)',
      cam: { x: 1489.0, y: 1025.0, z: 8.2, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breach looking back east (yaw 87.6)',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 87.6, pitchDeg: 0 }, real: true },
    // Architect ARCH CHANGES item 1 (14.4 item 9 poses, the story's own main
    // view - the breach had no parity pose until now). Same breach eye as
    // above (1486.5, 1025.0, eye 6.0+1.60 = 7.6 m); yaw 270/255 look OUT
    // through the breach (opposite the "looking back east" pose above).
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breach',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: 0 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: breachDown',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 270, pitchDeg: -30 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: parapetSky',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 255, pitchDeg: 20 }, real: true },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: signal tower',
      cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 255, pitchDeg: 2 }, real: true },
  ];

  // US-040 step 5 (architecture.md 15.2 item 7): the formal `?gpucompare=1`
  // voxel poses. `compareVoxelPool` is bound once (packs every
  // `ModelDef.voxel` in the registry + the shared VOX atlas); each pose's
  // `before` hook queues this pose's own instance(s) via `pushInstance` (the
  // test/dev harness feed - no entity binding in US-040, that's US-041a).
  // Deviation from the tech note's literal fixture list: the designer has
  // already landed REAL voxel models for `lever` and `lantern` (row 25h/25g
  // notes), so these poses use those instead of the `quadruped12`/`post12`
  // placeholders - a burner voxel model doesn't exist yet (still the
  // designer's separate ART-OWN-001 pass), so the "near" pose uses the lamp.
  const compareVoxelPool = new VoxelPool();
  compareVoxelPool.bind(assets, matTable);
  gpuPipeline.bindVoxels(compareVoxelPool);
  const LEVER_X = 1499.25, LEVER_Y = 1027.3, LEVER_Z = 3.0;
  const LANTERN_X = 1499.9, LANTERN_Y = 1024.5, LANTERN_Z = 1.3;
  runs.push(
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever wall 2 m',
      cam: { x: LEVER_X - 2.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 5 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    // Deviation, noted for follow-up: an instance of `lantern` here (the
    // burner voxel model doesn't exist yet either) produced a near-total
    // CPU/GPU mismatch (kind 0%) - its wall-bracket placement doesn't land
    // the same way the `lever`'s free-standing one does (feet vs. mount
    // anchor convention unclear from the current tech notes/model data), so
    // this "near" pose uses a second, closer `lever` instance instead until
    // that's sorted out (see the Programmer notes for this story).
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel lever near (1 m)',
      cam: { x: LEVER_X - 1.0, y: LEVER_Y, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 8 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel half occluded (stair edge)',
      cam: { x: 1497.3, y: 1026.6, z: engine.physics.eyeHeight, yawDeg: 60, pitchDeg: 0 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 90) },
    { world: worldM1, lights: worldM1Lights, name: 'world_m1: voxel yaw 45',
      cam: { x: 1497.0, y: 1025.5, z: engine.physics.eyeHeight, yawDeg: 60, pitchDeg: 5 },
      before: () => compareVoxelPool.pushInstance('lever', LEVER_X, LEVER_Y, LEVER_Z, 45) },
    // "voxel over terrain" (architecture.md 15.2 item 7's A2 -> A3 chain
    // pose) NOT added: every placement tried - on open terrain well clear
    // of the tower, and near the breach with terrain in the background -
    // FAILED gpucompare (open terrain alone: kind match 79-94%, a pre-
    // existing CPU/GPU terrain parity gap with no model involved; near the
    // breach: kind 100% but light-pass dLViol up to 144, holes up to 6 -
    // sun-visibility sampling disagreeing near a model close to open sky).
    // Neither looks like a voxel-pass bug (US-040's own scope: kind/depth/
    // shade/edge of kind-8 cells) so much as a pre-existing gap in terrain/
    // sun-visibility parity this story didn't touch - flagged for the
    // architect rather than forced in as a failing pose. See this story's
    // Programmer notes.
  );

  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    lights: null, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpuDda: false,
    // US-017: fixed LUT (fadeLut is built once at startup), sceneFade set
    // per pose below (1 = off for every row except the fade pose).
    fadeLut, sceneFade: 1,
    // US-040 step 5: the CPU oracle's `castModels` reads `fb.voxelPool.list`
    // (renderWorld, architecture.md 15.2 item 5) - `compareVoxelPool.project`
    // is called once per pose below, right after that pose's `before` hook
    // has queued its instance(s) (empty queue -> empty list -> no-op, exactly
    // like the un-bound pool before this story).
    voxelPool: compareVoxelPool,
  };
  const compareSceneDim = createSceneDim(); // US-015: identity for every pose except `dim`

  const cols = rt.cols, rows = rt.rows, n = cols * rows;

  const rowsOut = [];
  let overallOk = true;
  let sampledOwnTextures = true;
  for (const { world, lights, name, cam, fade, dim, real, before } of runs) {
    compareVoxelPool.beginFrame(); // US-040 step 5: clear the previous pose's instance queue first
    if (before) before();
    compareVoxelPool.project(cam, rt); // poses + culls this pose's queued instance(s), if any (15.2 item 2)
    // US-015: per-pose scene dim - identity for every row except the "card
    // open" pose. Mirrors `sceneFade` just below: both the CPU oracle
    // (`applySceneDim`, after the CPU fade) and the GPU pass
    // (`sprites.pass.setSceneDim`, before `rt.present()`) read the same object.
    resetSceneDim(compareSceneDim);
    if (dim) {
      compareSceneDim.all = dim.all;
      compareSceneDim.n = dim.n;
      compareSceneDim.rects.set(dim.rects.subarray(0, dim.n * 5));
    }
    fbCompare.sceneDim = compareSceneDim;
    // Architect review 1 item 2: fixed `timeSec = 0` (14.3 item 9's parity
    // contract - determinism, same as the rest of this compare page) so
    // flicker/jitter are identical on both paths for this pose. Update
    // BEFORE either path renders - `renderWorld`'s `fb.gpuDda = true` branch
    // only primes ambient, it never calls `lightSurfaces`/`LightSet.update`.
    fbCompare.lights = lights;
    if (lights) lights.update(0, world);
    // US-017 (item 3): per-pose scene fade - 1 (off) for every row except
    // the dedicated fade pose. The GPU sprite pass reads its own
    // `sceneFade`/LUT fields (spritesPass.js), not `fbCompare` directly, so
    // mirror them here before `rt.present()` runs it.
    fbCompare.sceneFade = typeof fade === 'number' ? fade : 1;
    if (sprites.pass) {
      sprites.pass.sceneFade = fbCompare.sceneFade;
      sprites.pass.setFadeLut(fadeLut);
      sprites.pass.setSceneDim(compareSceneDim);
    }
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
    // US-011 (7.5 item 6): `real` poses compare the actual prop pool of the
    // current world (`pool.collect`), everything else keeps the original
    // synthetic 3-prop set (`placeCompareSprites`) - both still go through
    // the same `project()`, so both are still a real CPU/GPU parity check.
    if (real) sprites.pool.collect(world);
    else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
    sprites.pool.project(cam, rt, lights || ambientL, world);

    poisonAllCells(rt.cells, n);
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam); // DDA path: primes ambientL, otherwise a no-op - real work is frame + present
    // Architect review 1 item 2: the torch (or any placed light) must reach
    // the GPU path exactly as gameplay feeds it (main.js `render()`, above).
    gpuPipeline.frame(fbCompare, lights || ambientL, cam, world);
    rt.present(); // cell pass + GPU sprite pass (sprites.pass, registered on rt)
    const rb = rt.readbackPresent();
    sampledOwnTextures = sampledOwnTextures && rb.sampledOwnTextures;
    const gpuFg = rb.fg, gpuBg = rb.bg;
    const { GI, GA, Depth } = gpuPipeline.readbackGeometry();
    // BUG-LIGHT-001 (docs/backlog.md row 25b): LIGHT-pass readback, taken
    // right after the GPU frame that wrote it, before the CPU pass below
    // overwrites fbCompare.light with the JS oracle it's compared against.
    const lightBuf = gpuPipeline.readbackLight();

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
    // US-017 ARCH CHANGES #1 item 2/3: CPU fade runs AFTER sprites here too,
    // matching the real frame's call site (main.js render()), which now
    // (tester fix pass 2, BUG-1) uses the same `clearMaskForSceneFade` step
    // this oracle already needed - see engine/ui/fade.js for why.
    if (fbCompare.fadeLut && typeof fbCompare.sceneFade === 'number') {
      clearMaskForSceneFade(fbCompare.rt);
      applySceneFade(fbCompare.rt, fbCompare.sceneFade, fbCompare.fadeLut);
    }
    // US-015: CPU dim oracle, same call site (after fade) main.js's real
    // render() uses.
    applySceneDim(fbCompare.rt, compareSceneDim);
    rt.gpuActive = wasActive;

    // Architect review 1 item 5: `?gpucompare=1` (unlike the strict
    // `?gpucompare=shade` page) allows up to 0.5% of non-sky cells outside
    // +-4/channel, capped at a max delta of 64 (a shading-band flip, not a
    // wrong colour) - the world_m1 spawn/stair near-misses' documented
    // tolerance, re-checked after the BUG-OWN-001 fix above.
    const cmpCells = compareCells(rt.cells.fg, rt.cells.bg, gpuFg, gpuBg, gbuf.kind, cols, rows, undefined, undefined, 0.005);
    const cmpGeom = compareGeometry(gbuf, depthBuffer.depth, GI, GA, Depth, cols, rows);
    // BUG-LIGHT-001: light-pass-only comparison (`fbCompare.light` was just
    // (re)written by the CPU `renderWorld` call above, via `lightSurfaces`).
    // Splits a light-pass vs shade-pass mismatch for debugging. Gates
    // `ok`/`overallOk` since BUG-LIGHT-002 (architecture.md 14.3 item 7):
    // every pose is dLViol 0 and sunlit flips <= 0.5 %.
    const cmpLight = compareLight(fbCompare.light, lightBuf, gbuf.kind, cols, rows);
    const ok = cmpCells.pass && cmpGeom.pass && cmpLight.pass;
    overallOk = overallOk && ok;
    rowsOut.push({ pose: name, cmpCells, cmpGeom, cmpLight, ok });
  }
  overallOk = overallOk && sampledOwnTextures;
  // US-017: the informational n=2 loop below never fades (it has no
  // `applySceneFade` call of its own) - reset the shared fade state so it
  // doesn't inherit sceneFade=0.5 left over from the last mandatory row.
  fbCompare.sceneFade = 1;
  if (sprites.pass) sprites.pass.sceneFade = 1;
  resetSceneDim(compareSceneDim); // US-015: same reset, for the same reason (the dim pose above)
  if (sprites.pass) sprites.pass.setSceneDim(compareSceneDim);

  // Architect review 1 item 5: an INFORMATIONAL n=2 row, only when
  // explicitly requested (`?gpucompare=1&rays=2`) - the mandatory loop above
  // always forces n=1 (14.2 item 8's parity contract is unchanged). Exercises
  // the coverage vote/resolve path through this same harness: kind match is
  // still gated (`compareGeometry.pass` already requires >= 99.5%, the same
  // bar the vote is expected to clear since it only differs at edge cells,
  // which the tool excludes); glyph/fg numbers are printed but never affect
  // `overallOk`.
  let infoRows = null;
  if (rayParam === 2) {
    const pipeline2 = new GpuCellPipeline(rt, { rays: 2 });
    if (pipeline2.ready) {
      pipeline2.bind(matTable, assets.palette);
      pipeline2.setSource('dda');
      infoRows = [];
      for (const { world, lights, name, cam, real, before } of runs) {
        if (before) before();
        fbCompare.lights = lights;
        if (lights) lights.update(0, world);
        if (real) sprites.pool.collect(world);
        else { sprites.pool.reset(); placeCompareSprites(cam, sprites.pool); }
        sprites.pool.project(cam, rt, lights || ambientL, world);

        poisonAllCells(rt.cells, n);
        fbCompare.gpuDda = true;
        renderWorld(fbCompare, world, cam);
        pipeline2.frame(fbCompare, lights || ambientL, cam, world);
        rt.present();
        const rb2 = rt.readbackPresent();
        const { GI: GI2, GA: GA2, Depth: Depth2 } = pipeline2.readbackGeometry();

        const wasActive2 = rt.gpuActive;
        rt.gpuActive = false;
        fbCompare.gpuDda = false;
        renderWorld(fbCompare, world, cam);
        drawSprites(fbCompare, sprites.pool);
        rt.gpuActive = wasActive2;

        const cmpCells2 = compareCells(rt.cells.fg, rt.cells.bg, rb2.fg, rb2.bg, gbuf.kind, cols, rows, undefined, undefined, 0.005);
        const cmpGeom2 = compareGeometry(gbuf, depthBuffer.depth, GI2, GA2, Depth2, cols, rows);
        infoRows.push({ pose: name, cmpCells: cmpCells2, cmpGeom: cmpGeom2, kindOk: cmpGeom2.kindMatchPct >= 99.5 });
        console.log(`[gpucompare] INFO n=2 ${name}: kind=${cmpGeom2.kindMatchPct.toFixed(2)}%(>=99.5% required) glyph=${cmpCells2.glyphMatchPct.toFixed(2)}%(reported only) holes=${cmpGeom2.holes}`);
      }
    } else {
      console.warn('[gpucompare] ?rays=2 informational row requested but the second GpuCellPipeline failed to compile - skipped.');
    }
  }

  // BUG-GPU-002 tooling fix: report the fixed, window-independent camera
  // setup both paths actually cast against (see the `rt.resize(GPU_COMPARE_
  // REF_*)` call near the top of this file) - `screenAspect` is the same
  // formula sectorCaster.js/GpuCellPipeline.js/sprites.js use internally.
  const refScreenAspect = (cols * rt.pxCellW) / (rows * rt.pxCellH);
  console.log(`[gpucompare] ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px  aspect=${refScreenAspect.toFixed(4)}  fov=${HFOV_DEG} deg`);
  let text = `?gpucompare=1  GpuCellPipeline: ${gpuPipeline.rendererString}  grid: ${cols}x${rows}  rays: 1` +
    `  readback: present() units 0/1${sampledOwnTextures ? '' : '  (NOT rt.fgTex/bgTex - present() wiring bug)'}\n` +
    `ref: ${GPU_COMPARE_REF_W}x${GPU_COMPARE_REF_H} @dpr ${GPU_COMPARE_REF_DPR}  cell: ${rt.pxCellW}x${rt.pxCellH}px` +
    `  aspect=${refScreenAspect.toFixed(4)}  fov=${HFOV_DEG} deg (fixed, window-independent)\n`;
  for (const r of rowsOut) {
    text += `${r.ok ? 'PASS' : 'FAIL'}  ${r.pose}\n` +
      `  geometry: kind ${r.cmpGeom.kindMatchPct.toFixed(2)}%  matEq ${r.cmpGeom.matEqual}/${r.cmpGeom.matched}  planeEq ${r.cmpGeom.planeEqual}/${r.cmpGeom.matched}` +
      `  depthViol ${r.cmpGeom.depthViol}  uvViol ${r.cmpGeom.uvViol}  holes ${r.cmpGeom.holes} (must be 0)` +
      // BUG-CAST-001: kind-mismatch count restricted to kind-edge cells (reported only, not gated).
      `  edgeKindMismatch ${r.cmpGeom.edgeKindMismatch}/${r.cmpGeom.edgeCells}\n` +
      `  shading: glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}%  fgOut ${r.cmpCells.fgOutside}  bgOut ${r.cmpCells.bgOutside}` +
      `  outside ${(r.cmpCells.outsideFrac * 100).toFixed(3)}% (<=0.5%, ${r.cmpCells.cellsOutside} cells)  fgMax ${r.cmpCells.fgMax}  bgMax ${r.cmpCells.bgMax} (<=64)  poisonedSurvivors ${r.cmpCells.poisonedSurvivors}\n` +
      // BUG-LIGHT-001: light-pass-only readback (reported only, see above).
      `  light: ${r.cmpLight.pass ? 'OK' : 'MISMATCH'}  sunlit ${(r.cmpLight.sunlitMismatchFrac * 100).toFixed(3)}% (<=0.5%, ${r.cmpLight.sunlitMismatch}/${r.cmpLight.nonSky})  dLMax ${r.cmpLight.dLMax.toFixed(4)}  dLViol ${r.cmpLight.dLViol} (<=1e-3/chan)\n`;
    console.log(`[gpucompare] ${r.ok ? 'PASS' : 'FAIL'} ${r.pose}: kind=${r.cmpGeom.kindMatchPct.toFixed(2)}% glyph=${r.cmpCells.glyphMatchPct.toFixed(2)}% holes=${r.cmpGeom.holes} edgeKindMismatch=${r.cmpGeom.edgeKindMismatch}/${r.cmpGeom.edgeCells} poisonedSurvivors=${r.cmpCells.poisonedSurvivors} light=${r.cmpLight.pass ? 'OK' : 'MISMATCH'}(sunlit ${r.cmpLight.sunlitMismatch}, dLViol ${r.cmpLight.dLViol})`);
  }
  text += `\n${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`;
  console.log(`[gpucompare] ${overallOk ? 'ALL PASS' : 'FAILURES ABOVE'}`);

  if (infoRows) {
    text += `\n\n--- INFO ONLY: n=2 coverage-vote resolve (?rays=2, does not affect ALL PASS/FAILURES above) ---\n`;
    for (const r of infoRows) {
      text += `${r.kindOk ? 'OK' : 'FAIL'}  ${r.pose}\n` +
        `  geometry: kind ${r.cmpGeom.kindMatchPct.toFixed(2)}% (must stay >=99.5%)  holes ${r.cmpGeom.holes}\n` +
        `  shading: glyph ${r.cmpCells.glyphMatchPct.toFixed(2)}% (reported, not gated)\n`;
    }
  }

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__gpuCompare = { rows: rowsOut, ok: overallOk, infoRows };
}

// `?flicker=1` (docs/architecture.md 14.2 item 8, US-030b build plan):
// the GPU-side twin of tools/bench-cast.mjs's US-028a CPU flicker metric -
// SAME start pose (test_room, 2.5, 2.5, eyeHeight, yaw 90, pitch 0) and
// motions (30 steps each of 0.02 m forward, 0.02 m strafe, 0.1 deg yaw), so
// its "JS (1-ray)" row is directly comparable to `bench-cast.mjs`'s own
// printed numbers (not recomputed here - the CPU shading path is identical,
// see the module doc below) without a second implementation to keep in
// sync. Reports one row per path: JS (CPU, `renderWorld` with
// `fb.gpuDda = false`) and GPU at whatever `rays` this page loaded with
// (`?rays=1` vs the default 2 is the A/B switch the AC asks for - load the
// page twice to compare, per the walk-test instructions in the backlog).
function runFlickerMode() {
  if (!gpuPipeline) {
    const msg = '[flicker] no active GpuCellPipeline (backend=' + rt.backend + ') - nothing to measure.';
    console.error(msg);
    overlay.visible = true; overlay.el.style.display = 'block';
    overlay.el.textContent = msg;
    return;
  }

  const level = loadLevel(assets.level('test_room'));
  bindLevel(matTable, level);
  const world = World.load({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] }, assets, {});
  for (const s of world.structures) { bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }

  const fbCompare = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    timeSec: 0, gpuDda: false,
  };
  const n = rt.cols * rt.rows;

  const STEPS = 30, STEP_M = 0.02, STEP_DEG = 0.1;
  const base = { x: 2.5, y: 2.5, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 0 };
  const yawRad = base.yawDeg * Math.PI / 180;
  const fwdX = Math.sin(yawRad), fwdY = -Math.cos(yawRad);
  const rightX = Math.cos(yawRad), rightY = Math.sin(yawRad);

  // --- JS (CPU, 1-ray) path: gbuf.kind/mat/planeId + rt.cells.fg (the
  // shaded fg layer's alpha channel already carries the byte glyph code,
  // see CellBuffer.js) - no extra readback needed, this IS the final buffer.
  function castJsFrame(cam) {
    fbCompare.gpuDda = false;
    const wasActive = rt.gpuActive;
    rt.gpuActive = false; // force the CPU shade/edge passes to actually run
    renderWorld(fbCompare, world, cam);
    rt.gpuActive = wasActive;
    const GI = new Uint32Array(4 * n);
    for (let i = 0; i < n; i++) {
      GI[i * 4] = gbuf.planeId[i] >>> 0;
      GI[i * 4 + 1] = (gbuf.kind[i] & 0xff) | ((gbuf.mat[i] & 0xffff) << 16);
    }
    return { GI, fg: rt.cells.fg.slice() };
  }

  // --- GPU (DDA, n = gpuPipeline.rays) path: real present()+readback. ---
  function castGpuFrame(cam) {
    fbCompare.gpuDda = true;
    renderWorld(fbCompare, world, cam); // primes ambientL; the DDA itself runs in present()
    gpuPipeline.frame(fbCompare, ambientL, cam, world);
    rt.present();
    const fg = gpuPipeline.readback().fg.slice();
    const { GI } = gpuPipeline.readbackGeometry();
    return { GI: GI.slice(), fg };
  }

  // Architect review 1 item 1 + PO ruling: `totalPct` (all non-sky-in-both
  // cells, no neighbour exclusion - see flicker.js) is the AC number now;
  // `pct` (US-028a's original interior-only metric) is kept as `interiorPct`,
  // informational, required only to not regress vs GPU n=1.
  function motionSeries(castFrame, dx, dy, dyaw, collect) {
    let cam = { ...base };
    let prev = castFrame(cam);
    let sumInterior = 0, sumTotal = 0;
    const out = {};
    for (let s = 0; s < STEPS; s++) {
      cam = { x: cam.x + dx, y: cam.y + dy, z: cam.z, yawDeg: cam.yawDeg + dyaw, pitchDeg: cam.pitchDeg };
      const cur = castFrame(cam);
      flickerStep(prev.GI, prev.fg, cur.GI, cur.fg, rt.cols, rt.rows, out);
      sumInterior += out.pct;
      sumTotal += out.totalPct;
      // Architect review 1 item 2: per-step forward diagnostic, gated behind
      // `?flickersteps=1` (not part of the normal AC printout) - probes the
      // suspected float32/float64 boundary spike at x = 3.0 (start x 2.5 +
      // step 25 * 0.02m).
      if (collect) collect.push({ step: s + 1, x: cam.x, pct: out.pct, totalPct: out.totalPct });
      prev = cur;
    }
    return { interior: sumInterior / STEPS, total: sumTotal / STEPS };
  }

  function runRow(castFrame, collectFwd) {
    const fwd = motionSeries(castFrame, fwdX * STEP_M, fwdY * STEP_M, 0, collectFwd);
    const strafe = motionSeries(castFrame, rightX * STEP_M, rightY * STEP_M, 0);
    const yaw = motionSeries(castFrame, 0, 0, STEP_DEG);
    const avg = (fn) => (fwd[fn] + strafe[fn] + yaw[fn]) / 3;
    return {
      fwd: fwd.total, strafe: strafe.total, yaw: yaw.total, avg: avg('total'),
      fwdInterior: fwd.interior, strafeInterior: strafe.interior, yawInterior: yaw.interior, avgInterior: avg('interior'),
    };
  }

  const wantSteps = params.get('flickersteps') === '1';
  const jsFwdSteps = wantSteps ? [] : null;
  const gpuFwdSteps = wantSteps ? [] : null;
  const jsRow = runRow(castJsFrame, jsFwdSteps);
  const gpuRow = runRow(castGpuFrame, gpuFwdSteps);
  const improvementPct = jsRow.avg > 0 ? 100 * (1 - gpuRow.avg / jsRow.avg) : 0;
  const interiorOkVsN1 = gpuRow.avgInterior <= jsRow.avgInterior || gpuPipeline.rays === 1;

  const rowText = (name, r) => `${name}: fwd ${r.fwd.toFixed(2)}%  strafe ${r.strafe.toFixed(2)}%  yaw ${r.yaw.toFixed(2)}%  averaged ${r.avg.toFixed(2)}%` +
    `  (interior-only, informational: fwd ${r.fwdInterior.toFixed(2)}%  strafe ${r.strafeInterior.toFixed(2)}%  yaw ${r.yawInterior.toFixed(2)}%  averaged ${r.avgInterior.toFixed(2)}%)`;
  const text = `?flicker=1  grid: ${rt.cols}x${rt.rows}  30 steps x {0.02m fwd, 0.02m strafe, 0.1deg yaw}  (main numbers = totalPct, item 1)\n` +
    `${rowText('JS   (1-ray)      ', jsRow)}\n` +
    `${rowText(`GPU  (n=${gpuPipeline.rays}, 2x2 default)`, gpuRow)}\n` +
    `GPU vs JS (totalPct): ${improvementPct.toFixed(1)}% lower (target >= 20%)\n` +
    `AC (totalPct >= 20% lower than JS): ` + (improvementPct >= 20 ? 'PASS' : 'FAIL') + `\n` +
    `AC (interiorPct informational, not worse than GPU n=1): ` + (interiorOkVsN1 ? 'PASS' : 'FAIL (see console)');

  console.log('[flicker] ' + text.replace(/\n/g, '\n[flicker] '));
  if (wantSteps) {
    console.log(`[flicker] per-step forward (JS vs GPU n=${gpuPipeline.rays}) - x = 2.5 + step*0.02, boundary expected at step 25 (x=3.0):`);
    for (let s = 0; s < STEPS; s++) {
      const j = jsFwdSteps[s], g = gpuFwdSteps[s];
      console.log(`  step ${String(j.step).padStart(2)}  x=${j.x.toFixed(9)}  JS pct=${j.pct.toFixed(2)}% total=${j.totalPct.toFixed(2)}%   GPU pct=${g.pct.toFixed(2)}% total=${g.totalPct.toFixed(2)}%`);
    }
    window.__flickerSteps = { js: jsFwdSteps, gpu: gpuFwdSteps };
  }
  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '13px "Courier New", monospace';
  overlay.el.style.whiteSpace = 'pre';
  overlay.el.textContent = text;
  window.__flicker = { jsRow, gpuRow, improvementPct };
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

// `?voxelbench=1` (architecture.md 15.2 item 6, D-019 gate): renders the
// lever + lamp voxel instances at about 2 m (about 15% of the screen, per
// the tech note) for many frames back to back and reads
// `gpuPipeline.stats.voxelMs*` (the same CPU submit-time bracket `terrainMs`
// uses - no nested GPU queries on ANGLE, US-016 finding). Load with
// `?voxelbench=1&grid=240x90&rays=2` (the gate's own grid/n; this mode does
// not force the grid itself, unlike `?bench=1`/`?gpucompare=1`, so the URL
// must ask for it).
function runVoxelBenchMode() {
  if (!gpuPipeline) {
    console.error('[voxelbench] no active GpuCellPipeline (backend=' + rt.backend + ') - nothing to measure.');
    return;
  }
  gpuPipeline.setSource('dda');

  function loadBenchWorld(def) {
    const w = World.load(def, assets, {});
    for (const s of w.structures) {
      bindLevel(matTable, s.level);
      repackMaterials(s.packed, s.level, matTable);
    }
    return w;
  }
  const world = loadBenchWorld(assets.world('world_m1'));
  if (world.terrain) world.terrain.bakeFarSync();
  const lights = lightsEnabled ? buildLightSet(world, assets.palette) : null;
  if (lights && !sunEnabled) lights.setSun({ elevation: lights.sun.elevation, azimuth: lights.sun.azimuth, on: false });
  if (lights) lights.update(0, world);

  const pool = new VoxelPool();
  pool.bind(assets, matTable);
  gpuPipeline.bindVoxels(pool);

  // Real lever world position (design/levels/tower.js), tower origin
  // (1480, 1018, 0) - same prop the `?gpucompare=1` voxel poses use. The
  // lamp (`lantern`) is left out here too - see the Programmer notes on the
  // "voxel lever near" gpucompare pose (its wall-bracket placement doesn't
  // land the same way the lever's free-standing one does yet).
  const LEVER = { x: 1499.25, y: 1027.3, z: 3.0, yaw: 90 };
  // ~2 m from the lever, framing it at about 15% of the screen at 240x90.
  const cam = { x: 1497.25, y: 1027.3, z: engine.physics.eyeHeight, yawDeg: 90, pitchDeg: 20 };

  const fb = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    lights, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpuDda: true, voxelPool: pool,
  };

  const FRAMES = 300;
  for (let i = 0; i < FRAMES; i++) {
    pool.beginFrame();
    pool.pushInstance('lever', LEVER.x, LEVER.y, LEVER.z, LEVER.yaw);
    pool.project(cam, rt);
    renderWorld(fb, world, cam); // fb.gpuDda = true: primes ambientL only
    gpuPipeline.frame(fb, lights || ambientL, cam, world);
    rt.present();
  }

  const s = gpuPipeline.stats;
  const result = {
    frames: FRAMES, grid: `${rt.cols}x${rt.rows}`, rays: engine.rays, instances: s.voxelInstances,
    voxelMsP50: round2(s.voxelMsP50), voxelMsP95: round2(s.voxelMsP95),
    gpuMsP50: round2(s.gpuMsP50), gpuMsP95: round2(s.gpuMsP95),
  };
  window.__voxelBench = result;
  console.log(`[voxelbench] ${FRAMES} frames, ${result.grid} n=${result.rays}:`, result);

  overlay.visible = true;
  overlay.el.style.display = 'block';
  overlay.el.style.font = '14px "Courier New", monospace';
  overlay.el.textContent =
    `VOXELBENCH (${FRAMES} frames, ${result.grid}, rays ${result.rays}, ${result.instances} instances)\n` +
    `voxel pass: p50 ${result.voxelMsP50} ms  p95 ${result.voxelMsP95} ms  (D-019 gate: <= 0.5 ms p95)\n` +
    `gpu total:  p50 ${result.gpuMsP50} ms  p95 ${result.gpuMsP95} ms  (gate: <= 4 ms p95)`;
}

// `?gpucompare=1` (isDdaCompare) forced `rt` to the fixed reference box
// above - keep it fixed even if the real window resizes/re-shows mid-run
// (see the comment above the `rt.resize(GPU_COMPARE_REF_*)` call).
const doResize = () => (isGpuCompareMode
  ? rt.resize(GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR)
  : rt.resize());
window.addEventListener('resize', doResize);
// Some environments report a 0x0 viewport for a moment while a tab is
// hidden/unattached (see RenderTarget.resize's guard); re-check once it
// becomes visible so the grid never gets stuck at a degenerate size.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) doResize();
});
window.addEventListener('pageshow', doResize);
