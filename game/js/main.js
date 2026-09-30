// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import {
  AssetRegistry, createEngine, clampGrid, GRID_DEFAULT_COLS,
  GBuffer, bindShading, bindLevel,
  DebugOverlay,
  integrate, stepRollers, resolveBodyContacts, Camera, renderWorld, stepSectorAnims, stepAnimations,
  GpuCellPipeline, GpuOverlayPass, PASS_NAMES,
  VoxelPool,
  PITCH_CLAMP_PITCHED_DEG,
  ambientL, World, repackMaterials,
  updateInteraction, drawCrosshair,
  buildLightSet, syncEntityLights, makeLightBuffer, attachedLightPos,
  isSoftwareRenderer,
  updateTriggers, moveCapsule, serialize, deserialize, createFadeLut, applySceneFade, clearMaskForSceneFade,
  createSceneDim, resetSceneDim, applySceneDim, drawPanel as drawUiPanel,
  loadContentPack,
} from '../../engine/index.js';
// US-047 (architecture.md section 5): pass internals + parity tooling +
// "may change" glue now live in engine/dev.js - main.js's dev-mode code
// paths (?bench=1, shadetest, ?gpucompare=1|shade) and the real-game mouse
// look/perf-spike-hunt glue (PlayerLook/FrameProfiler) import from there.
import {
  PlayerLook, FrameProfiler,
} from '../../engine/dev.js';
// US-048 (PC-B QUEUE 4 item 2): pose data now lives in content/dev-poses.js
// (a plain data module neither engine/game/tools' check-deps rules scan),
// not tools/bench-poses.js - see that file's own header comment. GATE_POSES
// is the one pose list still read directly by main.js itself (`?pose=`);
// GPU_COMPARE_POSES moved into game/js/dev/modes/gpucompare.js with the rest
// of the `?gpucompare=` mode code.
import { GATE_POSES } from '../../content/dev-poses.js';
import { MODES } from './dev/modes/index.js';
import { drawPauseOverlay } from './ui/pauseOverlay.js';
import { updateSettings, drawSettingsPanel, isSettingsOpen } from './ui/settings.js'; // US-038b
import { isPaused, resetSimAccumulator, duckAudio, unduckAudio, installAutoPause } from './ui/pause.js'; // US-062
// ---- US-020a: minimal procedural sound slice (game/js/audio/*, D-004) ----
import { initAudio, setMuted, toggleMute, isMuted } from './audio/synth.js';
import { onSectorAnimated, onSectorAnimDone, resetGameAudio, stepGameAudio } from './audio/sfx.js';
// ---- end US-020a ----
import { loadSettings, saveSettings } from './platform/index.js'; // US-060: remembered mute (D-012)
import { applyPlaytestOverlay } from './dev/playtest.js'; // US-034: editor play-test handoff (docs/architecture.md 24.11)
import { computeEndCardState, drawEndCard } from './ui/endCard.js';
import { initTitleCard, drawTitleCard } from './ui/titleCard.js';
import { stepEnd, endFadeAmount } from './quest/end.js';
import { stepBeacon } from './quest/beacon.js';
import { stepLantern } from './quest/lantern.js'; // OWN-REQ-006: hook-light off, same fixed-step slot as stepBeacon
import { wakeFrame, drawEyelid } from './quest/wake.js';
import { initMapCard, stepMapCard, isMapOpen, getMapPanel } from './quest/mapCard.js';
import { resetHints, stepHints, drawHints, pushHintDim, setPaletteColors as setHintPaletteColors } from './quest/hints.js';
import { probeGpuSupport, showWebgl2RequiredScreen, showSoftwareRendererWarning } from './ui/webgl2Gate.js';
import { drawDemoScene } from './dev/demoScene.js';
import { drawGlyphsScreen } from './dev/glyphsScene.js';
import { runPerfBench } from './dev/perfBench.js'; // US-018 (architecture.md 16) `?bench=1`
// ---- US-030c (ARCH CHANGES): sprite system wiring, kept to this one import ----
import { createSpriteSystem, spawnTestSprites } from './dev/spriteDev.js';
// ---- end US-030c ----
// ---- US-010: quest behaviours (registered by name before any World loads) ----
import { validateBehaviours } from '../../engine/index.js';
import './quest/index.js';
// ---- end US-010 ----

const params = new URLSearchParams(window.location.search);

// US-030a (docs/architecture.md 14.2 item 5), range widened by D-025
// (US-038a, architecture.md 22.2): `?grid=WxH` clamped to 160x60..480x180
// (8:3 aspect kept, see `clampGrid`), logged once here on the user-facing
// param (the RenderTarget-internal cpu-fallback log is separate).
// `?gpucompare=1` (this story's DDA parity page, 14.2 item 8)
// always forces 160x60 regardless of `?grid=` - `?gpucompare=shade` (the
// unchanged US-029 shading-only page) keeps whatever grid was requested.
const isDdaCompare = params.get('gpucompare') === '1';
// ME-06 (27.7 item 3): `?gpucompare=mesh` (GPU dda vs GPU mesh) needs the
// same fixed 160x60/n=1/reference-box treatment as `?gpucompare=1` - both
// are geometry-parity pages comparing two GPU renders pixel for pixel.
const isMeshMigrationCompare = params.get('gpucompare') === 'mesh';
// ME-06 diagnostic: `&voxels=0` on either compare page empties the voxel
// instance queue on both sides after each pose's feed, so a mesh-vs-oracle
// gap can be split into "voxel props (ME-08)" vs "everything else".
const compareNoVoxels = params.get('voxels') === '0';
// ME-06 architect review item 5 (owner 2026-09-29: near step stays OFF until
// the phase-1 gate): `&nearstep=1` turns `overworld_far.nearLOD.step` on for a
// compare page only - DDA near-march diagnostics, never the shipped look.
const compareNearStep = params.get('nearstep') === '1';
// BUG-GPU-002 tooling fix: both compare pages (`=1` and `=shade`) need the
// window-independent fixed camera box, not just the DDA/geometry one - see
// the `rt.resize(GPU_COMPARE_REF_*)` comment below.
const isGpuCompareMode = isDdaCompare || isMeshMigrationCompare || params.get('gpucompare') === 'shade';
const gridParam = params.get('grid');
let reqCols = GRID_DEFAULT_COLS, reqRows;
if (gridParam) {
  const m = /^(\d+)x(\d+)$/i.exec(gridParam.trim());
  if (m) { reqCols = Number(m[1]); reqRows = Number(m[2]); }
  else console.warn(`[grid] ?grid=${gridParam} not "WxH" - using the default ${GRID_DEFAULT_COLS}`);
}
// US-038b: a saved grid choice applies at boot, unless ?grid= overrides it for
// this session - or unless this is a capture/bench/compare page (?bench=,
// ?voxelbench=, ?gpucompare=), which must stay comparable across runs
// regardless of what the player last saved (PC-A PO REJECT, backlog row 30f).
const savedSettings = loadSettings();
const isCaptureOrBench = !!params.get('bench') || !!params.get('voxelbench') || !!params.get('gpucompare');
if (!gridParam && !isCaptureOrBench) {
  const gm = /^(\d+)x(\d+)$/.exec(savedSettings.grid);
  if (gm) { reqCols = Number(gm[1]); reqRows = Number(gm[2]); }
}
if (isDdaCompare || isMeshMigrationCompare) { reqCols = 160; reqRows = 60; }
const gridResult = clampGrid(reqCols, reqRows);
if (gridParam && gridResult.clamped) {
  console.warn(`[grid] ?grid=${gridParam} clamped to ${gridResult.cols}x${gridResult.rows} (allowed range 160x60..480x180, 8:3 aspect - D-025)`);
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
// US-027b (docs/architecture.md 21.9): tower/test_room/world_m1 are now
// content/*.json, loaded through the US-027a loader; `window.ASSETS` still
// carries palette/models/detailPass/uiStyle and the overworld_far terrain
// recipe (still a classic script - see game/index.html), passed as
// `codeParts` so `fromJSON` can overlay the JSON levels/worlds on top.
const bundle = await loadContentPack('../content/manifest.json');
// US-034 (24.11): `?playtest=1` overlays the editor's in-memory (possibly
// unsaved) level/world edits from `kestrel.playtest` onto `bundle` BEFORE
// the registry is built, so the rest of boot is unaware anything special
// happened - same content shape either way.
applyPlaytestOverlay(bundle);
const assets = AssetRegistry.fromJSON(bundle, window.ASSETS);

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
  // OWN-REQ-003 (architecture.md 17.1): the fixed UI glyph layer's grid -
  // `assets.uiStyle.uiGrid` (design/models/title.js), default 160x60.
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 },
});
// D-025 (US-038a): `renderTarget` now resizes IN PLACE (`engine.setGrid`
// never replaces the object), so `rt` itself could be `const` - kept `let`
// only because `depthBuffer`/`openSpans`/`gbuf` are still replaced with new
// (small, CPU-side) objects, by the fallback gate below (architect review 1
// item 2) and by any later live grid change (the `grid:changed` handler).
let { renderTarget: rt, depthBuffer, openSpans } = engine;
const { input } = engine;
// OWN-REQ-003 (architecture.md 17.1): `engine.ui` is a single UiLayer for
// the whole run - `engine.setGrid` re-binds it in place (never replaces it),
// so capturing it once here (unlike `depthBuffer`/`openSpans`) stays valid
// across any later grid change.
const ui = engine.ui;
const overlay = new DebugOverlay(document.body);
// US-018 (architecture.md 16): true while `?bench=1`'s view/walk sequence
// owns the player + overlay text - `runGame`'s own per-frame overlay.update()
// and pass-timing flag both read this.
let benchActive = false;
// US-018 spike hunt: `?bench=1` only (null otherwise - every lap() below is
// then a single null test). Section ids = index into PROF_SECTIONS.
const PROF_SECTIONS = ['sim.input', 'sim.physics', 'sim.quest', 'r.bake', 'sim.events',
  'r.lights', 'r.voxel', 'r.world', 'r.ui', 'r.gpuFrame', 'r.present', 'r.overlay'];
const SEC = { input: 0, physics: 1, quest: 2, bake: 3, events: 4, lights: 5, voxel: 6, world: 7, ui: 8, gpuFrame: 9, present: 10, overlay: 11 };
let prof = null;
let lapT = 0;
function lapStart() { if (prof) lapT = performance.now(); }
function lap(i) { if (!prof) return; const t = performance.now(); prof.add(i, t - lapT); lapT = t; }
// US-020a: `initAudio()` is called from `runGame()` itself (below), not
// here at module scope - PC-B fix pass (optional item a): a keypress on a
// pure dev/bench page that never calls `runGame` (e.g. `?shadetest=1`,
// `?gpucompare=1`, `?flicker=1`, `?voxelbench=1`, `?bench=present`) has no
// reason to arm a WebAudio context that will sit there silent and idle.

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
// ME-04 (docs/backlog.md, architecture.md 27.11 ME-04 AC "createEngine({
// renderer: 'mesh' | 'dda' })"): `?renderer=mesh` opts into the GPU raster
// pass (tower only, this story); default 'dda' is every existing pass,
// completely unchanged.
const renderer = params.get('renderer') === 'mesh' ? 'mesh' : 'dda';
// RE-02b (28.1 A2 item 6): first person is pitched on the mesh renderer (look clamp 70), shear on dda (35).
// Set from the EFFECTIVE renderer once the GPU pipeline is known (review: ?renderer=mesh can fall back to CPU = shear).
let pitchClampDeg = 35;
// `matTable` always resolves against the REAL detail-pass module (so a
// v2-only material key, e.g. `ceiling_timber`, still finds its `.v1`
// fallback) - `useDetail` alone decides whether `shadeSurfaces` is allowed
// to take the v2 branch (see the `detailPass` arg passed to it below).
// D-025 (US-038a): `let`, not `const` - a live grid change rebuilds this
// (cellAspect = pxCellH/pxCellW changes with the grid) in the `grid:changed`
// handler below, same reasoning as `gbuf`/`rt`'s own re-read comment above.
let matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
const detailPass = useDetail ? assets.detailPass : null;
let gbuf = new GBuffer(rt.cols, rt.rows);
// D-025: assigned inside runGame() (the one real gameplay frame buffer) so
// the `grid:changed` handler below can refresh its grid-sized fields; stays
// null for the dev/bench pages that never call runGame.
let fb = null;

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
  const candidate = new GpuCellPipeline(rt, { rays, terrainEnabled, renderer });
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
    // D-025 (US-038a): `setGrid` now resizes `rt` IN PLACE (same object) -
    // `rt` (this `let`) already points at it, no reassignment needed; only
    // the small CPU-side objects `applyGrid` replaced need re-reading.
    engine.setGrid(cpuCols, cpuRows, { immediate: true });
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
if (gpuPipeline && gpuPipeline.ready && rt.backend === 'gl2') new GpuOverlayPass(rt, gpuPipeline, engine.overlay); // RE-07b (28.9)
// ---- end US-030c ----

// ---- US-041a (15.3 item 1): the REAL gameplay voxel pool - `collect(world,
// cam)` fills it from `components.voxel` entities each frame (renderer holds
// no entity state itself, just this frame's projected instance list); the
// GPU path's own `gpuPipeline.frame()` calls `.project()` on it internally
// once bound (see GpuCellPipeline.js's `_passVoxel`), so only the CPU/JS
// oracle path (fb.gpuDda === false) needs an explicit `.project()` call
// here too (mirrors compositor.js reading `fb.voxelPool.list` pre-projected,
// same as the `?gpucompare=1` harness above does by hand). No live prop has
// a `.voxel` component yet (US-056 does the actual swap), so this is a
// no-op today - wiring only, ready for that story.
const gameVoxelPool = new VoxelPool();
gameVoxelPool.bind(assets, matTable);
// RE-02b F1 + review: 'mesh' only when the mesh GpuCellPipeline is really active (CPU fallback renders shear).
const effRenderer = renderer === 'mesh' && gpuPipeline ? 'mesh' : 'dda';
pitchClampDeg = effRenderer === 'mesh' ? PITCH_CLAMP_PITCHED_DEG : 35;
gameVoxelPool.renderer = effRenderer;
engine.overlay.renderer = effRenderer;
sprites.pool.renderer = effRenderer; // review item 1: sprite rects follow the pitched scene
if (gpuPipeline) gpuPipeline.bindVoxels(gameVoxelPool);
engine.attachMaterialTable(matTable); engine.instances.bindPool(gameVoxelPool); if (gpuPipeline) gpuPipeline.bindInstances(engine.instances); // RE-06 (28.6)

// D-025 (US-038a, architecture.md 22.3/22.7): the ONE `grid:changed`
// listener that rebuilds every game-owned, grid-sized object - the render
// pipeline/sprite pass resize IN PLACE (no shader recompile); `gbuf`/
// `matTable`/`fb`'s fields are small enough to just recreate (`cellAspect`
// can change with the grid); an already-loaded world's structures are
// re-bound against the fresh `matTable`, same as `'world:loaded'` does.
engine.events.on('grid:changed', ({ cols, rows }) => {
  if (gpuPipeline) gpuPipeline.resizeGrid(cols, rows);
  if (sprites.pass) sprites.pass.resizeGrid(cols, rows);
  gbuf = new GBuffer(cols, rows);
  matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
  engine.attachMaterialTable(matTable); // RE-06: re-applies engine.teamSpec to the new table
  if (gpuPipeline) gpuPipeline.bind(matTable, assets.palette);
  if (engine.world) for (const s of engine.world.structures) { bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }
  if (fb) { fb.depth = engine.depthBuffer; fb.spans = engine.openSpans; fb.gbuf = gbuf; fb.matTable = matTable; fb.light = makeLightBuffer(cols, rows); }
});

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine, gpuPipeline, gbuf, matTable, ambientL, depthBuffer, sprites };

// US-048 (PC-B QUEUE 4 item 2): the shared `ctx` every game/js/dev/modes/*
// module's `run(ctx)` reads from - built once here, after every module-scope
// `let`/`const` this file's dev modes used to close over is initialised, so
// each mode gets the exact same values its old inline function body read.
// These are one-shot dev pages (dispatched once, synchronously, right here,
// before any later mutation - e.g. the `grid:changed` handler re-assigning
// `matTable`/`gbuf` - could happen), so passing them by value like this is
// behaviour-identical to the old closures.
const ctx = {
  params, assets, rt, overlay, gpuPipeline, matTable, gbuf, depthBuffer, openSpans, detailPass,
  engine, sprites, fadeLut,
  lightsEnabled, sunEnabled, terrainEnabled, renderer, rayParam, compareNoVoxels, compareNearStep,
  GPU_COMPARE_REF_W, GPU_COMPARE_REF_H, GPU_COMPARE_REF_DPR,
  runGame,
  // `?bench=1` (US-018): flips the two module-scope flags `runGame` itself
  // reads (`benchActive`, `prof`) before starting the world-mode loop - see
  // the `benchActive` hook right after `playerHandle` is assigned in
  // `runGame`. Exposed as a hook (not the flags themselves) so `runGame`'s
  // render path stays untouched, per this story's AC.
  startBench() {
    benchActive = true;
    prof = new FrameProfiler(PROF_SECTIONS);
    runGame('world');
  },
};
const modeByName = new Map(MODES.map((m) => [m.name, m]));

if (gpuBlocked) {
  // AC "no game loop running underneath": the WebGL2-required screen is
  // already up (shown above) and the canvas is hidden. `createEngine`
  // above still ran (it just falls onto RenderTargetCanvas2D like the old
  // fallback did, harmlessly, on the hidden canvas) but none of the
  // branches below - every one of which ends in a `runGame`/dev-mode rAF
  // loop - may start.
} else if (params.get('bench') === 'present' || params.get('bench') === '1') {
  modeByName.get('bench').run(ctx);
} else if (params.get('shadetest') === '1') {
  modeByName.get('shadetest').run(ctx);
} else if (params.get('gpucompare') === '1' || params.get('gpucompare') === 'shade' || params.get('gpucompare') === 'mesh') {
  modeByName.get('gpucompare').run(ctx);
} else if (params.get('flicker') === '1') {
  modeByName.get('flicker').run(ctx);
} else if (params.get('voxelbench') === '1') {
  runVoxelBenchMode();
} else if (params.get('glyphs') === '1') {
  modeByName.get('glyphs').run(ctx);
} else if (params.get('demo') === '1') {
  modeByName.get('demo').run(ctx);
} else {
  runGame('world'); // default: US-025 World (world_m1, or ?level=<name> for a bare single-level world)
}

function runGame(mode) {
  if (params.get('debug') === '1' || params.get('f3') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`; ME-08c `?f3=1` = F3 pass times at start
  // US-020a: arms the (one-shot) first-gesture listeners only - creates
  // nothing yet, so there is no autoplay warning and no sound before input.
  initAudio();
  setMuted(loadSettings().muted); // US-060: apply the remembered mute before any sound can play

  let simTime = 0;
  let look = null;
  let playerHandle = null;
  let lightSet = null; // US-006: built from the loaded world's level.def.lights, below
  let wasPaused = false; // US-062: edge-detects isPaused() to drive duck/resume + accumulator reset once
  if (mode === 'world' && !isCaptureOrBench) installAutoPause(); // US-062: blur/hidden -> forced pause, never auto-resumed

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
  // Reused every fixed step for `updateInteraction` (US-012 arch review,
  // 2026-09-24 item 2): `Camera.fromEntity` allocated a `new Camera` 60x/s.
  // The render path's own `Camera.fromEntity` call (below) may keep
  // allocating - it runs once per rendered frame, not per fixed step.
  const interactEye = new Camera();
  const renderEye = new Camera(); // US-018 spike hunt: render()'s eye, reused every frame

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
      : assets.world(params.get('world') || 'world_m1'); // US-034 (24.11): the play-test handoff's `?world=` param

    // US-017 (7.4 "Restart / world swap"): every runtime rebuild this block
    // used to do ONCE, inline, now happens on `'world:loaded'` - emitted by
    // `World.load` on the first `engine.loadWorld` call below AND by
    // `engine.setWorld` on every later restart (`R`, see `update()`) - so a
    // restart rebuilds `playerHandle`/`look`/`lightSet` exactly the same
    // way the first load did, with no separate hand-written reset path
    // (architecture.md 7.4's "module-level game variables are reset only in
    // the 'world:loaded' handler" rule).
    // US-020a: gear ratchet + grate rattle. Registered once here (runGame
    // itself only runs once per page load - a restart swaps `engine.world`
    // via `engine.setWorld`, it does not re-run this function or re-emit
    // `engine.events`), same precedent as the 'world:loaded' listener below.
    engine.events.on('world:sectorAnimated', onSectorAnimated);
    engine.events.on('world:sectorAnimDone', onSectorAnimDone);

    engine.events.on('world:loaded', (evt) => {
      const world = evt.world;
      // US-020a: reset every module-level audio counter (sector-anim rate
      // limit, footstep accumulator, boulder settle-watch) here - the one
      // place both the first load and every restart go through (7.4 rule).
      resetGameAudio(world);
      if (params.get('units')) import('./dev/unitsHarness.js').then((m) => m.startUnits(engine, matTable, params, world)); // RE-06 dev harness: ?units=N
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
      // ME-08c (27.16 item 10): `?pose=<slug>` (tools/bench-poses.js GATE_POSES) puts the player at a gate pose (side-by-side page); no wake sequence.
      const gatePose = mode === 'world' && GATE_POSES.find((g) => g.slug === params.get('pose'));
      if (gatePose) {
        const c = gatePose.cam, gz = c.groundEye && world.terrain ? world.terrain.groundAt(c.x, c.y) + c.z : c.z;
        Object.assign(startT, { x: c.x, y: c.y, z: gz - engine.physics.eyeHeight, yawDeg: c.yawDeg, pitchDeg: c.pitchDeg });
        playerHandle.data.components.body.peakZ = startT.z;
      }
      if (look) look.dispose(); // arch review 1: no leaked click/pointerlock listeners across restarts
      look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg, { pitchClampDeg }); // RE-02b: 70 on the pitched mesh camera, 35 shear
      look.sensDegPerPx = savedSettings.mouseSensitivity; // US-038b (no-op until PlayerLook reads instance fields, see NEEDS PC-A)
      look.invertY = savedSettings.invertY;
      // US-030c (ARCH CHANGES item 1): `?sprite=1` spawns the three test props in test_room.
      if (params.get('sprite') === '1') spawnTestSprites(world, startT);

      // ---- US-015: wake sequence + title card + map card + hints (7.6 item 6: runtime rebuilt here, every load AND every restart) ----
      questUiActive = typeof world.state['quest.wakeT'] === 'number' && !gatePose;
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
        // OWN-REQ-003 (17.4): layout in the UI layer's OWN grid (identity
        // centre-scaling - panel.js/titleCard.js's sx/sy become 1), not the
        // scene's - the panel/title now draw into `ui`, not `rt`.
        initTitleCard(assets, ui.cols, ui.rows);
        initMapCard(assets, ui.cols, ui.rows);
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

    // ME-11c (architecture.md 27.18): `?physics=mesh` opts into the mesh
    // collider path instead of the grid (default, unchanged when omitted).
    const physicsMode = params.get('physics') === 'mesh' ? 'mesh' : undefined;
    engine.loadWorld(worldDef, physicsMode && { physics: physicsMode });
    // US-017: taken right after World.load (the listener above has already
    // run synchronously by the time `loadWorld` returns - `Events.emit` is
    // synchronous) - so this already includes the body-physics defaults and
    // spawned test sprites, exactly like a restart's `deserialize` would
    // reproduce.
    initialState = serialize(engine.world);
  }

  function update(dt) {
    lapStart();
    simTime += dt;
    // US-020a: `N` = mute toggle, always available (does not conflict with
    // `M`'s map card, US-015) - a single flag in audio/synth.js's module
    // state (later Settings, US-038, can read it the same way).
    if (input.pressed('KeyN')) { toggleMute(); saveSettings({ muted: isMuted() }); } // US-060: remember across reload
    if (input.pressed('F3')) overlay.toggle();
    // D-025 (US-038a AC "dev switch until US-038b ships"): `?debug=1` only -
    // cycles the 4 player grids; `engine.setGrid` no-ops off a gl2 backend.
    if (params.get('debug') === '1' && input.pressed('F4')) {
      const G = [240, 320, 400, 480];
      engine.setGrid(G[(G.indexOf(rt.cols) + 1) % 4]);
    }
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
      uiLocked = wakeOut.inputLocked || isMapOpen() || isSettingsOpen();
    }
    // US-038b: settings panel (S from pause, or its own entry point)
    // canOpen requires the pause overlay to actually be up (!look.locked) -
    // S is also WASD "move backward", so this must never trigger in play.
    updateSettings(dt, input, { assets, engine, look, canOpen: mode === 'world' && !ending && !!look && !look.locked && !isMapOpen() });

    if (look && !ending) {
      // US-015 (7.6 item 5): while locked, PlayerLook still drains the raw
      // mouse delta every step (so nothing pent up snaps the camera once
      // input unlocks) but its result is simply discarded, not applied.
      if (uiLocked) input.consumeMouseDelta();
      else look.update(dt);
    }
    // US-062: real pause - freeze player/physics/quest/animations/triggers
    // while the pause overlay or Settings is up (the same condition main.js
    // already draws them with, ui/pause.js's `isPaused`); edge-detected once
    // here so audio ducks/resumes and the loop's accumulator resets exactly
    // on the transition, not on every paused step. `render()` is untouched,
    // so the scene keeps drawing. Never true for `?bench=`/`?gpucompare=`/
    // `?voxelbench=` (`isCaptureOrBench`).
    const paused = mode === 'world' && !isCaptureOrBench && isPaused({ ending, look, isMapOpen });
    if (paused !== wasPaused) {
      wasPaused = paused;
      if (paused) duckAudio(); else { unduckAudio(); resetSimAccumulator(engine); }
    }
    if (mode === 'world' && playerHandle && !paused) {
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
      lap(SEC.input);
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
      lap(SEC.physics);
      // US-020a: footsteps (distance accumulator + `body.landed`) and the
      // boulder-thud speed watch - after physics settles this step's
      // position/flags, same slot as the other post-physics polls below.
      stepGameAudio(playerHandle.data);
      // US-017 (7.4 fixed-step order item 4): after physics settles, before
      // interaction - an enter edge on the end trigger sets `quest.endT`.
      updateTriggers(engine.world, engine, playerHandle.data);
      // US-012 (7.4 fixed-step order item 5): after physics settles this
      // step's position, before the event flush - `E` is edge-triggered the
      // same way Space is (US-009's convention). Forced false while ending
      // (input locked - no other interactable may fire mid-ending).
      updateInteraction(engine.world, engine, Camera.fromEntityInto(playerHandle.data, undefined, interactEye, pitchClampDeg), !ending && !uiLocked && input.pressed('KeyE'));
      // US-022: the relay's own wake timer (clip switch wake -> awake, point
      // light on + 1.0 s grow) - a no-op every step before `beacon.light`
      // fires (game/js/quest/beacon.js), same "reads its own state key" split
      // as `stepEnd` below. `lightSet` may be null (`?lights=0` or before the
      // first `buildLightSet`) - `stepBeacon` treats that as a no-op past the
      // clip switch (the light ramp itself just does not run without one).
      stepBeacon(engine.world, lightSet, dt, assets.palette);
      // OWN-REQ-006: a no-op every step before `lantern.take` fires and every
      // step after (no ramp, unlike stepBeacon - the hook light just needs to
      // go off the instant the lamp is taken); same fixed step as
      // `updateInteraction` above, so it lands in the same rendered frame as
      // the carried light turning on and the flame prop's removal.
      stepLantern(engine.world, lightSet);
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
      lap(SEC.quest);
      engine.world.flushEvents();
      lap(SEC.events);

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
  // D-025 (US-038a): assigned (not `const`-declared) into the module-scope
  // `fb` above, so the top-level `grid:changed` handler can refresh its
  // grid-sized fields (`depth`/`spans`/`gbuf`/`matTable`/`light`) in place.
  fb = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, lights: lightSet,
    light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf, matTable, detailPass, // US-028
    voxelPool: gameVoxelPool, // US-041a (15.3 item 1)
    instances: engine.instances, // RE-06 (28.6)
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
    // OWN-REQ-003 (17.4): fresh/transparent every rendered frame, same
    // precedent as the scene's own per-frame overwrite (fillSky paints every
    // cell) - anything not redrawn below (e.g. a hint that just timed out)
    // must vanish, not linger from last frame.
    ui.clear();
    lapStart();
    // US-025 AC "<= 2 ms/frame, amortised": the far bake is render data
    // (never read by the sim), so it runs once per RENDERED frame - it used
    // to sit in update(), i.e. 2 ms per fixed step, 4-10 ms on a catch-up
    // frame with 2-5 steps (US-018 spike hunt).
    // US-018 follow-up: tightened from 2ms - Terrain.bakeFarStep is now
    // column-granular (checks the time budget every few cells, not once per
    // row), so a 1 ms target actually holds even on the first frame after
    // load/teleport instead of overrunning on one expensive row.
    if (mode === 'world' && engine.world.terrain) engine.world.terrain.bakeFarStep(1);
    lap(SEC.bake);

    if (mode === 'glyphs') {
      drawGlyphsScreen(rt);
    } else if (mode === 'world') {
      // Player and camera live in WORLD coordinates (US-025 AC) - no origin
      // translation needed at the call site any more, `renderWorld` casts
      // each placed structure at its own origin internally (7.3).
      const eye = Camera.fromEntityInto(playerHandle.data, undefined, renderEye, pitchClampDeg); // reused (rule 9: no per-frame Camera)
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
      lap(SEC.lights);
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
      // US-041a (15.3 item 1): `collect(world, cam)` every frame (cheap - the
      // entity ref list is cached by `world.renderVersion`, only distance is
      // recomputed); the GPU path projects internally, the CPU/JS oracle
      // needs its own explicit `.project()` before `renderWorld` reads
      // `fb.voxelPool.list` (compositor.js).
      gameVoxelPool.collect(engine.world, cam);
      if (!fb.gpuDda) gameVoxelPool.project(cam, rt, effRenderer); // RE-02b re-review: effective renderer (CPU fallback = shear)
      lap(SEC.voxel);
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
      // RE-07a (28.9): CPU overlay composite after the fade (no-op without recorded ops; GPU twin = RE-07b).
      if (fb.gpuDda) engine.overlay.flush(cam); // RE-07b: GPU path rasterises here, GpuOverlayPass composites in present()
      else if (engine.overlay.stats.ops) engine.overlay.renderCpu(cam, fb.rt.cells, fb.depth.depth);
      lap(SEC.world);
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
        // OWN-REQ-003 (17.5): `pushDim`/`pushHintDim` convert their UI-cell
        // plate rects to scene cells via `ui.sx`/`ui.sy` - the dim itself
        // always multiplies the SCENE grid (sceneDim.js).
        if (mapPanel) mapPanel.pushDim(sceneDim, ui);
        pushHintDim(ui, assets.uiStyle, sceneDim);
      }
      if (!fb.gpuDda) applySceneDim(rt, sceneDim);
      if (sprites.pass) sprites.pass.setSceneDim(sceneDim);
      // US-012 (7.4): crosshair + "[E] ..." prompt, emissive UI drawn after
      // the world/sprite passes, never depth-tested (architecture.md 8).
      // Hidden while ending or while wake/map-card input is locked (US-015:
      // there is never a usable target/prompt to show then).
      // OWN-REQ-003 (17.4): drawn into the fixed UI layer (`ui`), not the
      // scene (`rt`), so every one of these reads at the same physical size
      // regardless of `?grid=`.
      if (!ending && !uiLockedNow) drawCrosshair(ui, crosshairStyle, engine.world.interaction);
      if (questUiActive && !ending) {
        drawHints(ui, assets.uiStyle, fadeLut);
        drawEyelid(rt, assets.uiStyle, wakeOut.blinkOpen); // 17.4: stays in the scene grid (an eyelid over the 3D view, not UI text)
        drawTitleCard(ui, fb.timeSec * 1000, wakeOut.titleA, wakeOut.titleState, fadeLut);
        const mapPanel = getMapPanel();
        if (mapPanel) drawUiPanel(ui, mapPanel, fb.timeSec * 1000, fadeLut);
      }
      // US-017: the end card, drawn last (over the faded scene) - `setCell`
      // marks these cells `mask = 1` (engine/render/CellBuffer.js), so a
      // second `applySceneFade` call (e.g. a future frame) never touches them.
      const endCardState = computeEndCardState(engine.world, assets.uiStyle);
      drawEndCard(ui, assets.uiStyle, P.colors, endCardState);
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    // US-015 tester BUG-1: the map card owns the screen while open (its own
    // click/key dismiss), so the pause text must not overprint it (160x60).
    if (mode === 'world' && !look.locked && !isMapOpen()) drawPauseOverlay(ui, rt, assets);
    // US-038b: settings panel, drawn over the pause overlay when open
    drawSettingsPanel(ui, rt, assets, { showEntry: mode === 'world' && !look.locked && !isMapOpen() });
    // US-029/US-030a: the real GPU work happens inside `rt.present()`'s
    // hook, right below - `cam`/`engine.world` are only meaningful in
    // 'world' mode (fb.gpuDda is false otherwise, so the pipeline falls
    // back to the legacy `_repackAndUpload` path, harmlessly, in 'demo'/
    // 'glyphs' mode - gbuf is simply empty there).
    // US-006: `fb.lights` (a real LightSet) on the main game loop; every
    // other call site in this file still passes `ambientL` (ambient-only,
    // 0 point lights - GpuCellPipeline.js's `_uploadLightUniforms` treats a
    // plain array as back-compat ambient-only input).
    lap(SEC.ui);
    if (gpuPipeline) gpuPipeline.frame(fb, (mode === 'world' && fb.lights) || ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    lap(SEC.gpuFrame);
    rt.present();
    lap(SEC.present);
    // US-018 (architecture.md 16): "do not leave pass timing on when the
    // overlay is hidden and no bench runs" - a plain boolean set, cheap
    // enough to do unconditionally every frame.
    if (gpuPipeline) gpuPipeline.setPassTiming(overlay.visible || benchActive);

    const lastRenderMs = performance.now() - renderStart;
    // US-018: the overlay text is only ever built while it will actually be
    // shown (`shouldRefresh` = visible + <= 4 Hz) - `?bench=1` builds/owns
    // its own overlay text instead (dev/perfBench.js), so it skips this.
    if (!benchActive && overlay.shouldRefresh(performance.now())) {
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
      // US-018: JS split (sim/render/submit) from `loop.stats` + the
      // pipeline's own upload+draw submit time, and per-pass GPU ms
      // (`n/a` while `setPassTiming` is off or the extension is missing).
      const submitMs = gpuPipeline ? gpuPipeline.stats.uploadMs + gpuPipeline.stats.drawMs : NaN;
      extra += `\njs sim ${engine.loop.stats.simMs.toFixed(2)}ms  render ${engine.loop.stats.renderMs.toFixed(2)}ms` +
        `  submit ${Number.isNaN(submitMs) ? 'n/a' : submitMs.toFixed(2) + 'ms'}` +
        // D-025 (US-038a, architecture.md 22.6): last live grid-switch cost (F4).
        `  grid ${rt.cols}x${rt.rows}${Number.isNaN(engine.stats.lastGridSwitchMs) ? '' : ` (switch ${engine.stats.lastGridSwitchMs.toFixed(1)}ms)`}`;
      if (gpuPipeline) {
        extra += '\npass ms: ' + PASS_NAMES.map((name, i) => {
          const v = gpuPipeline.stats.passMsP50[i];
          return `${name} ${Number.isNaN(v) ? 'n/a' : v.toFixed(2)}`;
        }).join('  ');
      }
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
        const grounded = playerHandle.data.components.body && playerHandle.data.components.body.grounded;
        extra += `\nworld (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}) yaw ${look.yawDeg.toFixed(0)} pitch ${look.pitchDeg.toFixed(0)}` +
          `${look.locked ? '' : ' [unlocked]'}  grounded: ${grounded}\nstructure: ${struct ? struct.id : '(none)'} sector: '${sectorCh}'${sector ? '' : ' (outside)'}\n${terrainInfo}`;
      }
      overlay.update(engine.loop.fps, engine.loop.frameMs, extra);
    }
    lap(SEC.overlay);
  }

  const loop = engine.run({ update, render });
  loop.profiler = prof; // US-018 spike hunt (`?bench=1` only, else null)
  window.__debug.loop = loop;
  window.__debug.world = engine.world;
  window.__debug.playerHandle = playerHandle;
  window.__debug.look = look;
  window.__debug.depthBuffer = depthBuffer;

  // US-018 (architecture.md 16): `?bench=1` - the loop above is already
  // running, so the bench's own rAF-driven view/walk sequence can start
  // right away (`benchActive` set by the `?bench=1` dispatch branch, top of
  // this file).
  if (mode === 'world' && benchActive) {
    runPerfBench({ engine, playerHandle, overlay, gpuPipeline, input, rt, look, prof });
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// `?voxelbench=1` (architecture.md 15.2 item 6, D-019 gate): renders every
// real voxel prop the tower spawns (US-056: lever, lantern, boulder, rubble,
// canvasHeap, gondola, strut, envelopeHeap, relay - `pool.collect(world,
// cam)`, not a single hand-pushed instance) for many frames back to back and
// reads `gpuPipeline.stats.voxelMs*` (the same CPU submit-time bracket
// `terrainMs` uses - no nested GPU queries on ANGLE, US-016 finding). Load
// with `?voxelbench=1&grid=240x90&rays=2` (the gate's own grid/n; this mode
// does not force the grid itself, unlike `?bench=1`/`?gpucompare=1`, so the
// URL must ask for it).
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

  // US-056: `pool.collect(world, cam)` instead of a single hand-pushed
  // `lever` instance - `World.load` above already spawned every tower prop
  // with a merged voxel `ModelDef` as a real `components.voxel` entity
  // (15.3 item 1's spawn rule), so this now measures "with all props"
  // (lever, lantern, boulder, rubble x5, canvasHeap, gondola, strut - 10 of
  // the 12 total are in the wreck-room cluster, well under the 16-instance
  // cap; envelopeHeap and the summit relay sit apart). Cam (tower origin
  // 1480, 1018, 0 + local 14.0, 2.0, yaw 150, pitch 5) stands south-west of
  // the cluster looking across it - 11 of the 12 land on screen at once
  // (`?voxelbench` "instances" line), a harder GPU-upload case than any
  // single-prop framing while `collect` (cam-independent: gathers every
  // voxel entity in the world, nearest 16 win only past the cap) still pays
  // the pose cost for all of them regardless of the exact framing.
  const cam = { x: 1494.0, y: 1020.0, z: engine.physics.eyeHeight, yawDeg: 150, pitchDeg: 5 };

  const fb = {
    rt, depth: depthBuffer, spans: openSpans, palette: assets.palette, gbuf, matTable, detailPass,
    lights, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpuDda: true, voxelPool: pool,
  };

  const FRAMES = 300;
  for (let i = 0; i < FRAMES; i++) {
    pool.collect(world, cam);
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
