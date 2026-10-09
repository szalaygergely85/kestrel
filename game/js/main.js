// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import { loadPresets, resolveQuality, saveQuality, knobsFor } from './ui/gfxPresets.js';
import { resolveBootOptions, describeQuality } from './gfxBoot.js';
import { pickQuality, tierFromAdapter, p95 } from './gfxAuto.js'; // GFX-02
import { gatherAdapterInfo, showCard, AutoBench } from './gfxAutoRun.js';
import {
  probeWebGpu, AssetRegistry, createEngine, createRenderer, clampGrid, GRID_DEFAULT_COLS, resolveShadowLevel,
  GBuffer, bindShading, bindLevel,
  DebugOverlay, bootMark, bootSpan, bootNow, freezeBootMarks, bootEntries, bootReport, // BOOT-SPEED-01
  integrate, stepRollers, resolveBodyContacts, Camera, renderWorld, stepSectorAnims, stepAnimations,
  GpuCellPipeline, GpuOverlayPass, PASS_NAMES, WG_PASS_NAMES,
  VoxelPool, bindDecals, drawDecals,
  PITCH_CLAMP_PITCHED_DEG,
  ambientL, World, repackMaterials,
  updateInteraction, drawCrosshair,
  buildLightSet, syncEntityLights, makeLightBuffer, attachedLightPos, sunPathFrom, applySunHours, setWorldSun, setCloudShadow, setHorizonAo,
  isSoftwareRenderer,
  updateTriggers, moveCapsule, serialize, deserialize, createFadeLut, applySceneFade, clearMaskForSceneFade,
  createSceneDim, resetSceneDim, applySceneDim,
  loadContentPack, createRng, prebuildTerrainMesh,
  forwardOf, DEG2RAD, hexToRgb, resolveWaterLooks, createEntityEmitters,
} from '../../engine/index.js';
// US-047 (architecture.md section 5): pass internals + parity tooling +
// "may change" glue now live in engine/dev.js - main.js's dev-mode code
// paths (?bench=1, shadetest, ?gpucompare=1|shade) and the real-game mouse
// look/perf-spike-hunt glue (PlayerLook/FrameProfiler) import from there.
import {
  PlayerLook, FrameProfiler, blockContextMenu,
} from '../../engine/dev.js';
// US-048 (PC-B QUEUE 4 item 2): pose data now lives in content/dev-poses.js
// (a plain data module neither engine/game/tools' check-deps rules scan),
// not tools/bench-poses.js - see that file's own header comment. GATE_POSES
// is the one pose list still read directly by main.js itself (`?pose=`);
// GPU_COMPARE_POSES moved into game/js/dev/modes/gpucompare.js with the rest
// of the `?gpucompare=` mode code.
import { GATE_POSES } from '../../content/dev-poses.js';
import { prefetchLazyMeshesAtBoot } from './bootPrefetchHook.js'; // MESH-LOAD-01: boot prefetchNear call
import { parseCloudStrength, parseAoStrength } from './cloudParam.js'; // S8-B2-12a/S8-B2-20 NEEDS B1 item (2)/(1): `?clouds=<0..1>`/`?ao=<0..1>` parse/clamp
import { MODES } from './dev/modes/index.js';
import { loadCinematic, evaluatePath, createPlayback } from './dev/modes/cinematic.js';
import { drawPauseOverlay } from './ui/pauseOverlay.js';
import { updateSettings, drawSettingsPanel, isSettingsOpen, openSettings } from './ui/settings.js'; // US-038b
import { isPaused, resetSimAccumulator, duckAudio, unduckAudio, installAutoPause } from './ui/pause.js'; // US-062
// ---- US-020a: minimal procedural sound slice (game/js/audio/*, D-004) ----
import { initAudio, setMuted, toggleMute, isMuted } from './audio/synth.js';
import { resetGameAudio, stepGameAudio } from './audio/sfx.js';
// ---- end US-020a ----
import { loadSettings, saveSettings, getSaveStorage } from './platform/index.js'; // US-060: remembered mute (D-012)
import { applyLocalOverlay } from './localOverlay.js';
import { createBootCard } from './bootCard.js'; // boot loading card + ASCII progress bar
import { createBootStageTimer } from './bootStageTimer.js'; // S8-B1-20: per-stage ms (content/adapter/pipelines/world/meshes)
import { applyPlaytestOverlay } from './dev/playtest.js'; // US-034: editor play-test handoff (docs/architecture.md 24.11)
import { computeEndCardState, drawEndCard } from './ui/endCard.js';
import { initTitleCard, drawTitleCard } from './ui/titleCard.js';
import { stepEnd, endFadeAmount } from './quest/end.js';
import { stepBeacon } from './quest/beacon.js';
import { stepLantern } from './quest/lantern.js'; // OWN-REQ-006: hook-light off, same fixed-step slot as stepBeacon
import { removeSwordIfTaken } from './quest/swordTake.js'; // US-078c
import { resetNoteRead, stepNoteRead, isNoteOpen, pushNoteDim, drawNotePanel } from './quest/noteRead.js'; // READ-01
import { wakeFrame, drawEyelid, applyWakeOnLoad } from './quest/wake.js';
import { initMapCard, stepMapCard, isMapOpen, getMapPanel, getMapChart, drawMapCard } from './quest/mapCard.js';
import { resetHints, stepHints, drawHints, pushHintDim, setPaletteColors as setHintPaletteColors } from './quest/hints.js';
import { hooks as gameHooks, bridgeEngineEvents } from './gameHooks.js'; // D-050: the one seam to game content
import { createTitleMenuHost } from './titleMenuHost.js'; // US-090w: title menu (New / Continue / Settings) before play
import { createStorageAdapter } from './quest/save/saveState.js';
import { createSaveRelay } from './saveRelay.js'; // US-089w/US-096w: save + autosave + quest event hook
import { watchDeviceLost } from './deviceLost.js'; // S8-B1-10 (38.10c): device-lost card
import { createChestHook } from './chestHook.js'; // S8-B1-04: chest sim + item-get card, through the seam only
import { createMapFogHook } from './mapFogHook.js'; // S8-B1-16: visited-cell mask feed, through the seam only
import { createBeastSim } from './quest/sim/beastSim.js'; // US-079a (architecture.md 29.1)
import { buildBeastNav } from './quest/sim/beastNav.js';
import { presentBeasts } from './quest/beastView.js';
import { questOverlayStyles } from './quest/overlayStyles.js';
import { createVitals } from './quest/sim/vitals.js'; // US-080a1/a2 (architecture.md 30.2)
import { createTargeting } from './quest/targeting.js'; // US-128b (architecture.md 29.2)
import { stepTargetingInput } from './quest/targetingInput.js';
import { SWORD_CFG } from './quest/swordConfig.js'; // US-078d (architecture.md 30.1 + D-034 amendment)
import { createSwordSim } from './quest/sim/sword.js';
import { presentSword } from './quest/swordView.js';
import { loadSpellHandView, presentSpellHand, SPELL_HAND_ITEM } from './quest/spellHandView.js'; // HANDS-01c (37.8a)
import { createHands } from './quest/sim/hands.js'; // HANDS-01b (37.8a)
import { createFireballSim } from './quest/sim/fireball.js'; // SPELL-01a (37.14)
import { createFireballView } from './quest/fireballView.js'; // SPELL-01b (37.14 view)
import { createTargetables } from './quest/sim/targetables.js';
import { FIREBALL_CFG } from './quest/spellConfig.js';
import { START_DEMO, START_FULL } from './quest/startConfig.js';
import { createPracticeTarget, applyPropTargetables } from './quest/practiceTarget.js';
import { createParticleHooks, applyPropEmitters } from './quest/particleHooks.js'; // US-053c
import { createWaterfallHooks } from './quest/waterfallHooks.js';
import { createAmbientMotes } from './quest/ambient.js';
import { VITALS_DEFAULTS } from './quest/sim/vitalsConfig.js';
import { drawVitals, drawHurtEdge, kickDeg, applyDeathFade, computeDeathCardState, drawDeathCard } from './quest/vitalsView.js';
import { stepPickups, resetPickups } from './quest/sim/pickups.js'; // US-080b (30.2)
import { ensureInventory, validateItemDefs, migrateSword } from './quest/sim/inventory.js'; // US-091a1 (37.16.4)
import { presentPickups } from './quest/pickupsView.js';
import { createLoot, setLootApi } from './quest/sim/loot.js'; // US-091a2 (37.16.3)
import { LOOT_TABLE, LOOT_SEED_SALT } from './quest/sim/lootConfig.js';
import { createToastView } from './quest/toastView.js';
import { createInventoryView } from './quest/inventoryView.js'; // US-091b
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
// ME-19a: mesh GPU versus the rasterJS twin; one geometry-parity mode.
const isGeometryCompare = params.get('gpucompare') === '1';
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
const isGpuCompareMode = isGeometryCompare || params.get('gpucompare') === 'shade';
// GFX-01w: quality preset (grid, rays, shadow level, scatter density, LOD scale) resolved once at boot; explicit URL knobs win.
// Precedence: URL knob > ?quality= > saved > auto (GFX-02) > 'high'. Presets failing to load -> boot exactly as before (no preset).
// Capture/bench/compare pages stay on today's options unless ?quality= is given (must stay comparable across runs).
const savedSettings = loadSettings();
const isWaterfallPreview = params.get('waterfallpreview') === '1' && params.get('world') === 'waterfall_test';
const isCaptureOrBench = !!params.get('bench') || !!params.get('voxelbench') || !!params.get('gpucompare') || !!params.get('cinematic') || isWaterfallPreview;
// GFX-02: auto-pick runs only on a first launch (nothing saved, no ?quality=), never on capture/bench/compare/cinematic pages or
// automated browsers (navigator.webdriver); `?autoquality=0` skips it, `?autoquality=1` forces it (dev). Provisional preset = the adapter's
// candidate tier (chosen before createEngine, so no reboot is needed); the timed benchmark then confirms or steps it (see runGame).
const autoParam = params.get('autoquality');
const wantAutoQuality = autoParam === '1' || (autoParam !== '0' && savedSettings.quality === undefined && !params.has('quality') &&
  !isCaptureOrBench && params.get('capture') !== '1' && !navigator.webdriver);
let autoAdapter = null, autoProvisional = null;
if (wantAutoQuality) {
  try {
    autoAdapter = await gatherAdapterInfo(probeWebGpu);
    autoProvisional = { name: tierFromAdapter(autoAdapter).tier };
  } catch (err) { console.warn(`[quality] auto-pick adapter probe failed (${err.message})`); }
}
let resolvedQuality = null;
try {
  await loadPresets();
  // ?autoquality=1 ignores a saved choice (dev / redetect); otherwise saved wins as before.
  const savedForBoot = autoParam === '1' && autoProvisional ? undefined : savedSettings.quality;
  resolvedQuality = resolveQuality({ param: params, saved: { quality: savedForBoot, shadowQuality: savedSettings.shadowQuality }, auto: autoProvisional });
} catch (err) { console.warn(`[quality] presets unavailable (${err.message}) - booting without a preset`); }
const bootOpts = resolveBootOptions({ params, resolved: resolvedQuality, savedSettings, captureLike: isCaptureOrBench, geometryCompare: isGeometryCompare,
  defaultCols: GRID_DEFAULT_COLS, shadowLevel: resolveShadowLevel });
const gridParam = bootOpts.gridParam;
const gridResult = clampGrid(bootOpts.reqCols, bootOpts.reqRows);
if (gridParam && gridResult.clamped) {
  console.warn(`[grid] ?grid=${gridParam} clamped to ${gridResult.cols}x${gridResult.rows} (allowed range 160x60..480x180, 8:3 aspect - D-025)`);
}
// US-030b (14.2 item 5): default 2 on the gl2 GPU path (preset rays: low 1, medium 2, high 2, ultra 4); `?rays=1..4` overrides.
// `?gpucompare=1` always forces n=1 (14.2 item 8's parity contract), resolved inside resolveBootOptions.
const rayParam = Number(params.get('rays')); // raw URL value, passed to the compare/bench harnesses as before
const rays = bootOpts.rays;

// GFX-02: timed benchmark behind a loading card. Grid applies live (engine.setGrid); rays/shadows/scatter/LOD apply on the next launch
// (the preset is saved either way). `redetectQuality()` (window.redetectQuality, for the Settings "Detect again" button) re-runs it at
// the preset that is currently running and saves the result.
let autoBench = null, autoCard = null, autoRunning = null; // autoRunning = preset name the benchmark is measuring
let lastFrameT = 0, lastFrameDt = NaN;
function startAutoBench(at, redetect) {
  if (autoBench && autoBench.phase !== 'done') return false;
  autoRunning = at; autoCard = showCard();
  autoBench = new AutoBench({
    sample: () => (gpuPipeline && gpuPipeline.stats ? gpuPipeline.stats.gpuMsP95 : NaN),
    intervalMs: () => lastFrameDt,
    onDone: ({ samples, kind, minSamples, frameSamples }) => {
      if (autoCard) { autoCard.remove(); autoCard = null; }
      const r = pickQuality(autoAdapter, samples, { kind, at, minSamples, frameSamples });
      const saved = saveQuality(r.name, { save: saveSettings, load: loadSettings });
      let applied = 'unchanged';
      if (r.name !== at) {
        const m = /^(\d+)x(\d+)$/.exec(knobsFor(r.name).grid);
        if (m && !params.has('grid')) { const g = clampGrid(Number(m[1]), Number(m[2])); engine.setGrid(g.cols, g.rows); applied = `grid ${g.cols}x${g.rows} live, rest next launch`; }
        else applied = 'next launch';
        bootOpts.quality = { name: r.name, source: 'auto', reason: r.reason, note: applied };
      } else bootOpts.quality = { name: r.name, source: 'auto', reason: r.reason };
      const sv = [...samples].sort((a, b) => a - b);
      window.__autoQuality = { ...r, kind, samples: samples.length, p50: sv[sv.length >> 1], max: sv[sv.length - 1], frameP95: p95(frameSamples), adapter: autoAdapter, saved: saved.saved, applied, at };
      console.log(`[quality] auto-pick: ${r.name} (${r.reason}) saved=${saved.saved} ${applied}`);
    },
  });
  return true;
}
function redetectQuality() { return startAutoBench(bootOpts.quality ? bootOpts.quality.name : 'high', true); }
window.redetectQuality = redetectQuality;

let bootPrinted = false; // BOOT-SPEED-01: true after the first frame (declared before runGame can run)
let bootStageAtFrame = 0; // S8-B1-20: bootNow() at first frame; F3 shows the stage breakdown for 10 s after this
bootMark('main.js module start (imports done)');
// Boot loading card with an ASCII progress bar (not on capture/bench/gpucompare pages; `?bootcard=0` off, `=1` forces it).
const bootCard = (params.get('bootcard') === '1' || (params.get('bootcard') !== '0' && !isCaptureOrBench && params.get('capture') !== '1')) ? createBootCard() : null;
const bootProg = bootCard ? bootCard.progress : null, bootPaint = bootCard ? bootCard.paint : async () => {};
const bootStages = createBootStageTimer(bootNow); // S8-B1-20: starts in 'content' now; see enter() calls below
const canvas = document.getElementById('screen');
// US-027b (docs/architecture.md 21.9): tower/test_room/world_m1 are now
// content/*.json, loaded through the US-027a loader; `window.ASSETS` still
// carries palette/models/detailPass/uiStyle and the overworld_far terrain
// recipe (still a classic script - see game/index.html), passed as
// `codeParts` so `fromJSON` can overlay the JSON levels/worlds on top.
// MESH-LOAD-01: lazy mesh payloads in the game (colliders stay eager); capture/bench/compare pages stay eager so their results stay comparable. ?lazymesh=0 = eager.
const lazyMeshes = !isCaptureOrBench && params.get('lazymesh') !== '0';
const bundle = await loadContentPack('../content/manifest.json', { lazyMeshes });
if (bundle.lazyMeshes) window.__lazyMeshStore = bundle.lazyMeshes; // MESH-LOAD-01: dev handle (tools/lazymesh-trace.mjs, F3 debugging); the engine no longer sets it
// US-034 (24.11): `?playtest=1` overlays the editor's in-memory (possibly
// unsaved) level/world edits from `kestrel.playtest` onto `bundle` BEFORE
// the registry is built, so the rest of boot is unaware anything special
// happened - same content shape either way.
bootMark('content pack loaded (manifest + JSON + meshes)');
if (bootProg) { bootProg.phase('registry'); await bootPaint(); }
applyPlaytestOverlay(bundle);
await applyLocalOverlay(bundle, params, undefined, { lazyMeshes }); // git-ignored content/local/ (licence-restricted assets, this PC only)
if (window.ASSETS.spellFx) window.ASSETS.spellFx.attach(); // SPELL-01b: fireball sprites -> ASSETS.models (atlas) + presets -> ASSETS.particles, BEFORE the registry/atlas/defineEmitter loop
bootMark('local overlay applied');
const assets = AssetRegistry.fromJSON(bundle, window.ASSETS);
bootMark('AssetRegistry built');
bootStages.enter('adapter');
if (bootCard) bootCard.setStageLines(bootStages.cardText());
if (bootProg) { bootProg.phase('renderer'); await bootPaint(); }

// ART-01a (architecture.md 37.18 item 2): `?look=<key>` selects the active
// timeOfDay record BEFORE `bindShading`/`buildLightSet`/the terrain sun read it
// (load-time only - no runtime look switching, that is US-122). Unknown key ->
// warn + keep the default.
const lookParam = params.get('look');
if (lookParam) {
  if (assets.palette && assets.palette.timeOfDay && assets.palette.timeOfDay[lookParam]) {
    assets.palette.defaultTime = lookParam;
  } else {
    console.warn(`[look] ?look=${lookParam} is not a timeOfDay key - using "${assets.palette && assets.palette.defaultTime}"`);
  }
}

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

// BUG-BOOT-001 (Q9 item 3, architect ruling): a plain DOM fatal card (message + stack, no renderer dependency -
// same "throwaway canvas, no engine state" precedent as webgl2Gate.js above) instead of a silent black screen.
// Global `error`/`unhandledrejection` listeners catch anything a per-frame `update`/`render` throws (the
// architect's ruling: NOT a per-listener try/catch inside engine/core/events.js); `guardLoad` below additionally
// wraps the two synchronous load/restart call sites so their own throw (e.g. bad content JSON) is reported the
// same way. `?strict=1` rethrows instead of showing the card, for dev/CI.
function showFatalCard(err) {
  if (document.getElementById('fatal-error')) return; // already up - first error wins, dedupe the rest
  canvas.style.display = 'none';
  const div = document.createElement('div');
  div.id = 'fatal-error';
  Object.assign(div.style, {
    position: 'fixed', inset: '0', zIndex: '4000', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-start', textAlign: 'center', padding: '2em',
    background: '#000', color: '#f88', font: '14px "Courier New", monospace', lineHeight: '1.5',
    overflow: 'auto', whiteSpace: 'pre-wrap',
  });
  const title = document.createElement('div');
  Object.assign(title.style, { fontSize: '1.3em', color: '#fff', marginBottom: '0.6em' });
  title.textContent = 'Something broke.';
  const msg = document.createElement('div');
  msg.style.maxWidth = '48em';
  msg.textContent = (err && err.message) || String(err);
  const stack = document.createElement('div');
  Object.assign(stack.style, { maxWidth: '48em', opacity: '0.6', marginTop: '1em', fontSize: '0.85em' });
  stack.textContent = (err && err.stack) || '';
  div.appendChild(title); div.appendChild(msg); div.appendChild(stack);
  document.body.appendChild(div);
}

function fatalError(err) {
  console.error(err);
  if (params.get('strict') === '1') throw err;
  if (window.__debug && window.__debug.loop) window.__debug.loop.stop();
  showFatalCard(err);
}

/** Wraps a synchronous load/restart call (`engine.loadWorld`/`engine.setWorld`) so its own throw is reported the
 * same way as the global listeners below, instead of leaving a black screen behind a blank console error. */
function guardLoad(fn) {
  try { fn(); } catch (err) { fatalError(err); }
}

window.addEventListener('error', (evt) => fatalError(evt.error || evt.message));
window.addEventListener('unhandledrejection', (evt) => fatalError(evt.reason));
// US-091a1 (37.16.4): the designer item defs (design/items.js -> ASSETS.items). Validated once at boot
// (id/name/kind/stackMax/icon); a bad def throws naming the id, which the fatal-card listeners above catch.
// `null` (items.js script tag missing) skips validation - addItem/migrateSword then just no-op on unknown ids.
const itemDefs = window.ASSETS && window.ASSETS.items ? window.ASSETS.items.defs : null;
if (itemDefs) validateItemDefs(itemDefs);
// US-012: crosshair/prompt colors, resolved once from the palette's `ui`
// semantic keys (design/palette.js section 8) - `ASSETS.uiStyle` doesn't
// exist yet (that's US-015's art), so this is the game's own small style
// object; `drawCrosshair` itself only ever reads `style`, never `ASSETS`.
const P = assets.palette;
const crosshairStyle = {
  crosshair: { dim: P.colors[P.ui.crosshair], active: P.colors[P.ui.crosshairActive] },
  // plateBg: same dark plate as the item toast (design/items.js plate [10,11,16]); without it drawText's bg falls back to opaque white
  prompt: { color: P.colors[P.ui.prompt], keyColor: P.colors[P.ui.promptKey], plateBg: '#0a0b10' },
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
// WG-1c2: `?backend=webgpu|webgl2` (default webgl2); webgpu falls back to webgl2 with a warning (38.8a 16).
const shadowOpts = bootOpts.shadowOpts; // GFX-01w: shadow level from the preset (resolveShadowLevel) + ?shadows= / ?shadowinst / ?shadowres / ?shadowcast overrides (ME-15e/f, D-043: map is the default)
const tCR = bootNow();
const { rt: builtRt, pipeline: wgPipeline, device: gpuDevice, info: rendererInfo } = await createRenderer({ canvas, cols: gridResult.cols, rows: gridResult.rows, backend: params.get('backend') || 'webgl2',
  force2d: params.get('force2d') === '1', gpu: params.get('gpu') !== '0', rays, terrainEnabled: params.get('terrain') !== '0',
  shadows: shadowOpts, gpuCull: params.get('gpucull') !== '0',
  onCompileProgress: (done, total) => { bootStages.enter('pipelines'); if (bootCard) bootCard.setStageLines(bootStages.cardText()); if (bootProg) bootProg.count('compile', done, total); } }); // WG-4a: `?gpucull=0` = CPU instance cull on WebGPU; WG-3d: the WebGPU pipeline needs the same sun-shadow options as the engine
bootSpan('createRenderer total (' + rendererInfo.label + ')', tCR);
if (bootProg) { bootProg.phase('engine'); await bootPaint(); }
const tCE = bootNow();
const engine = createEngine({
  canvas, assets, cols: gridResult.cols, rows: gridResult.rows, rays,
  renderTarget: builtRt,
  renderPipeline: wgPipeline, // WG-2b (38.8a item 21): lets engine.setGrid resize a webgpu target + its WgCellPipeline
  force2d: params.get('force2d') === '1',
  gpu: params.get('gpu') !== '0',
  // OWN-REQ-003 (architecture.md 17.1): the fixed UI glyph layer's grid -
  // `assets.uiStyle.uiGrid` (design/models/title.js), default 160x60.
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 },
  // ME-15c/e/f (27.9a, D-043): the sun shadow MAP is the default; `?shadows=dda` keeps the old sun DDA until ME-19c.
  shadows: shadowOpts, // ME-15c/e/f (27.9a, D-043): see shadowOpts above
  gfx: bootOpts.gfx, // GFX-03/GFX-01w: scatter density + LOD scale from the preset (undefined = engine defaults)
});
bootSpan('createEngine', tCE);
// US-089w/US-096w: save relay (autosave 60 s + waystone, load at boot) and quest hook. `?save=0` off; capture/bench/compare/cinematic
// pages and automated browsers never load or save unless `?save=1` forces it (the headless reload check does).
const saveEnabled = params.get('save') !== '0' && (params.get('save') === '1' || !(isCaptureOrBench || params.get('capture') === '1' || params.has('at') || navigator.webdriver)); // `?at` = dev pose: never autosave it into slot 0
let saveRelay = null;
let deviceLostFrozen = false; // S8-B1-10 (38.10c): set once by watchDeviceLost's `freeze` hook below; gates `paused` in the frame loop
try {
  const questDef = await (await fetch('../content/quests/m1.quest.json')).json();
  saveRelay = createSaveRelay({ storage: getSaveStorage(), questDef, enabled: saveEnabled });
  saveRelay.bindEvents(engine.events);
  gameHooks.register(saveRelay.handlers());
  saveRelay.quest.onPoll = (name, a, b) => gameHooks.emitSimple(name, a, b);
  gameHooks.onSaveRequest(() => { if (saveRelay && gameHooks.ctx.world) saveRelay.save(gameHooks.ctx.world, { ending: gameHooks.ctx.state.ending }); });
} catch (e) { console.warn('[save] relay unavailable:', e && e.message); }
// S8-B1-10 (docs/architecture.md 38.10c "This story (~0.5 d)"): on device.lost (ignoring our own 'destroyed'
// dispose unless forced) stop stepping the sim, one synchronous autosave through the existing save relay
// (gameHooks.ctx.requestSave -> saveRelay.save, registered above), then a reload card. Logic lives in the pure
// deviceLost.js (Node-testable with a mock device); this is just the DOM/sim/save glue. No-op on webgl2 (device null).
watchDeviceLost(gpuDevice, {
  freeze: () => { deviceLostFrozen = true; },
  autosave: () => { if (saveRelay && gameHooks.ctx.requestSave) gameHooks.ctx.requestSave(); },
  showCard: () => {
    const card = document.createElement('div');
    card.id = 'device-lost-card';
    card.textContent = 'GPU reset - press R or click to reload';
    card.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(0,0,0,0.85);color:#fff;font:20px sans-serif;z-index:99999;cursor:pointer;text-align:center;';
    const reload = () => location.reload();
    card.addEventListener('click', reload);
    window.addEventListener('keydown', (ev) => { if (ev.code === 'KeyR') reload(); });
    document.body.appendChild(card);
  },
});
// Dev hook (38.10c): `?dev=1` only - window.__kestrel.loseDevice() simulates a loss for headless verification
// (tools/verify-device-lost.mjs) without a real GPU crash.
if (params.get('dev') === '1') {
  window.__kestrel = window.__kestrel || {};
  window.__kestrel.loseDevice = () => { if (gpuDevice && typeof gpuDevice._forceLost === 'function') gpuDevice._forceLost('dev hook'); };
  // S8-B2-13 NEEDS B1 item (2) (from 38.14): window.__kestrel.ripple(x, y, amp) for the owner look - the
  // passWater composite upload that actually draws the rings is another slot's item.
  window.__kestrel.ripple = (x, y, amp) => { if (engine.world && engine.world.water) engine.world.water.addRipple(x, y, amp); };
}
// S8-B1-15: MAP-01c baked chart (MAP-01b bake tool, content/chart/world_m1.chart.json) for the map card
// (quest/mapCard.js). Loaded once, like questDef above; a missing/bad file degrades to the plain (unbaked) card
// (initMapCard's 4th arg stays null below) rather than breaking world load.
let chartData = null;
try {
  chartData = await (await fetch('../content/chart/world_m1.chart.json')).json();
} catch (e) { console.warn('[map] chart unavailable:', e && e.message); }
// S8-B1-16: MAP-01d wiring - feeds the player's position into lane C's coarse visited-cell mask
// (quest/mapFog.js, S8-C-15) every tick through the seam (game/js/mapFogHook.js); no-op without a
// loaded chart (nothing for the fog to compose onto). `mapFogHook.fog` is read right below, after
// `gameHooks.boot(...)` has run `onBoot` for this world, to build the map card's `chartOptions.fog`.
const mapFogHook = chartData ? createMapFogHook(chartData.bounds) : null;
if (mapFogHook) gameHooks.register(mapFogHook);
// S8-B1-04: chest sim (quest/sim/chest.js) + item-get card (ui/itemGetCard.js), wired through the seam only - see
// game/js/chestHook.js. `defs: []` (NEEDS C: no content/chests/*.json / placement yet) - harmless no-op today.
const chestHook = (itemDefs && assets.uiStyle && assets.uiStyle.itemGetCard)
  ? createChestHook({
    defs: [], items: window.ASSETS.items, style: assets.uiStyle.itemGetCard, rgb: assets.palette.rgb,
    openedChestsOf: () => (saveRelay ? saveRelay.openedChests : []),
  })
  : null;
if (chestHook) gameHooks.register(chestHook);
// US-090w: title menu before play. Off for `?title=0`, capture/bench/compare/cinematic pages, `?capture=1`, `?at=`/`?pose=` dev poses and bare `?level=` rooms.
const menuWanted = params.get('title') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !params.has('at') && !params.has('pose') && !params.get('level') && !params.get('cinematic');
// D-025 (US-038a): `renderTarget` now resizes IN PLACE (`engine.setGrid`
// never replaces the object), so `rt` itself could be `const` - kept `let`
// only because `depthBuffer`/`gbuf` are still replaced with new
// (small, CPU-side) objects, by the fallback gate below (architect review 1
// item 2) and by any later live grid change (the `grid:changed` handler).
let { renderTarget: rt, depthBuffer } = engine;
const { input } = engine;
// OWN-REQ-003 (architecture.md 17.1): `engine.ui` is a single UiLayer for
// the whole run - `engine.setGrid` re-binds it in place (never replaces it),
// so capturing it once here (unlike `depthBuffer`) stays valid
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
// S8-B2-12a NEEDS B1 item (2): `?clouds=<0..1>` (default 0). WebGL2 (`rt.backend === 'gl2'`) stays 0 - the frozen
// GLSL ignores the cloud byte - only the Canvas2D/CPU path (and WebGPU, once kestrel-2's passLight upload lands)
// actually draws clouds. Applied via `setCloudShadow` after every `buildLightSet` below.
const cloudStrength = rt.backend === 'gl2' ? 0 : parseCloudStrength(params.get('clouds'));
// S8-B2-20 NEEDS B1 item (1): `?ao=<0..1>` (default 0). WebGL2 stays 0 (frozen GLSL ignores it, D-044). Applied
// via `setHorizonAo` after every `buildLightSet` below, same site as the cloud strength above.
const aoStrength = rt.backend === 'gl2' ? 0 : parseAoStrength(params.get('ao'));
// US-007 (14.3 item 8 fallback/switches): test-only sun disable, same shape
// as `?lights=0`.
const sunEnabled = params.get('sun') !== '0';
const timeHour = params.has('time') ? parseFloat(params.get('time')) : NaN;
if (params.has('time') && !Number.isFinite(timeHour)) console.warn('[time] expected finite clock hours');
// ARCH CHANGES item 3 (14.4 item 8): `?terrain=0` dev A/B switch - skips
// terrain on BOTH paths (GPU: `GpuCellPipeline`'s `_terrainActiveThisFrame`
// gate; JS/CPU: `compositor.js`'s `castTerrain` call). Same shape as
// `?lights=0`/`?sun=0` above. Needed for item 4's GPU-ms A/B measurement.
const terrainEnabled = params.get('terrain') !== '0';
// ME-19a: renderer query values are ignored; GPU and CPU both use mesh.
const renderer = 'mesh';
const waterfallPreset = window.ASSETS.waterfall;
if (waterfallPreset) window.ASSETS.waterLooks.waterfall = waterfallPreset.look;
const pitchClampDeg = PITCH_CLAMP_PITCHED_DEG;
// `matTable` always resolves against the REAL detail-pass module (so a
// v2-only material key, e.g. `ceiling_timber`, still finds its `.v1`
// fallback) - `useDetail` alone decides whether `shadeSurfaces` is allowed
// to take the v2 branch (see the `detailPass` arg passed to it below).
// D-025 (US-038a): `let`, not `const` - a live grid change rebuilds this
// (cellAspect = pxCellH/pxCellW changes with the grid) in the `grid:changed`
// handler below, same reasoning as `gbuf`/`rt`'s own re-read comment above.
bootMark('before bindShading/materials');
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
bootMark('after GBuffer/materials, before GL2 GpuCellPipeline');
let gpuPipeline = null;
if (rt.backend === 'gl2' && params.get('gpu') !== '0' && detailPass && matTable.allV2) {
  const candidate = new GpuCellPipeline(rt, { rays, terrainEnabled, shadows: engine.shadows });
  if (candidate.ready) {
    candidate.bind(matTable, assets.palette);
    candidate.setWaterLooks(window.ASSETS.waterLooks); // US-055a2c (Q12 item 8)
    gpuPipeline = candidate;
  }
}
// Architect review 1 item 2 (14.2 items 5/7 fallback matrix gap):
// `rt.backend === 'gl2'` only means RenderTarget.js's own probe found a
// real, non-software WebGL2 context - it says nothing about whether the
// cell pipeline actually compiled/linked (`candidate.ready` above, or
// `detailPass`/`matTable.allV2` not holding). When the gate above didn't
// produce a `gpuPipeline`, the CPU caster is about to run every frame
// (`fb.gpu` stays false, see `runGame`'s render()) - left at the
// default/`?grid=` grid it would cast at up to 320x120, 4x the CPU budget.
// Force the same `cpuGrid` RenderTarget.js already uses for `?gpu=0` and
// the software-renderer case (default 160x60), via `engine.setGrid`, and
// rebuild the CPU-side state that depends on grid size (`gbuf`; `rt`/
// `depthBuffer` come straight off `engine`, which `setGrid`
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
    gbuf = new GBuffer(rt.cols, rt.rows);
  }
}
// WG-2a: the WebGPU skeleton pipeline (createRenderer built it) is NOT a gpuPipeline yet (no scene passes: the CPU path keeps
// rendering); it only draws `?gpudebug=kind|plane|normal|depth` (G-buffer debug view) over the cells.
if (wgPipeline && wgPipeline.ready && rt.backend === 'webgpu') {
  wgPipeline.bind(matTable, assets.palette);
  wgPipeline.setWaterLooks(window.ASSETS.waterLooks); // WG-3e: same designer table as the GL pipeline (US-055a2c)
  const wgDebug = { kind: 0, plane: 1, normal: 2, depth: 3 }[params.get('gpudebug')];
  if (wgDebug !== undefined) wgPipeline.setDebugMode(wgDebug);
  console.log(`[WgCellPipeline] skeleton active (ported passes: ${wgPipeline.portedPasses.join(',')})${wgDebug !== undefined ? ', debug view ' + params.get('gpudebug') : ''}`);
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
bootMark('GL2 GpuCellPipeline built (webgl2 only) / sprite system next');
const sprites = createSpriteSystem({ assets, rt, gpuPipeline, wgPipeline });
if (gpuPipeline && gpuPipeline.ready && rt.backend === 'gl2') new GpuOverlayPass(rt, gpuPipeline, engine.overlay); // RE-07b (28.9)
// ---- end US-030c ----

// ---- US-053b/US-053c: particle presets + the draw layer (engine.particles.clear() on every 'world:loaded'
// already runs inside createEngine - US-053a's own precedent, nothing to do here for that). ----
if (sprites.pass) sprites.pass.bindParticleLayer(engine.particleLayer);
// WG-3f: WebGPU sprites + particles + fade/dim + overlay passes (frameComplete -> rt.gpuActive -> the CPU compositor stops drawing them)
bootMark('sprites/overlay bind start');
if (wgPipeline && wgPipeline.ready && rt.backend === 'webgpu') wgPipeline.bindSprites({ pool: sprites.pool, atlas: sprites.atlas, palette: assets.palette, particleLayer: engine.particleLayer, overlay: engine.overlay });
bootMark('sprites/overlay bound');
// GFX-01w/02: createRenderer builds the webgpu target at the CPU grid (38.8a item 14, pre-WG-3f rule). Once the WebGPU pipeline owns
// the whole frame, the requested (preset/URL) grid applies; otherwise (e.g. ?shadows=dda -> CPU shading) the CPU grid stays.
if (wgPipeline && wgPipeline.frameComplete && rt.backend === 'webgpu' && (rt.cols !== gridResult.cols || rt.rows !== gridResult.rows)) {
  engine.setGrid(gridResult.cols, gridResult.rows, { immediate: true });
  depthBuffer = engine.depthBuffer;
  gbuf = new GBuffer(rt.cols, rt.rows);
}
const particlePresets = window.ASSETS.particles;
if (window.ASSETS.boarFx) window.ASSETS.boarFx.attach(); // US-079b: copy boarFx's corpseDust preset into particles.presets before the defineEmitter loop below
if (particlePresets) {
  for (const k of Object.keys(particlePresets.presets)) {
    engine.particles.defineEmitter(k, particlePresets.toEmitterDef(k, assets.palette.rgb));
  }
}
if (waterfallPreset) {
  for (const k of Object.keys(waterfallPreset.presets)) engine.particles.defineEmitter(k, waterfallPreset.toEmitterDef(k, assets.palette.rgb));
}
// US-053a: created once for the page's lifetime (not per world load) - it follows 'world:loaded'/
// 'entity:added'/'entity:removed' internally and needs no dispose/recreate from this session.
const entityEmitters = createEntityEmitters(null, engine.particles, engine.events, (k) => engine.particles.defIdOf(k));
// SPELL-01b: the fireball view lives for the page; `bind` runs on every 'world:loaded' (lights + sim are rebuilt per world).
const fbView = window.ASSETS.spellFx ? createFireballView({ particles: engine.particles, palette: assets.palette, fx: window.ASSETS.spellFx, cfg: FIREBALL_CFG, events: engine.events }) : null;
const _emberEye = new Float64Array(3), _emberWorld = new Float64Array(3);

// ---- US-041a (15.3 item 1): the REAL gameplay voxel pool - `collect(world,
// cam)` fills it from `components.voxel` entities each frame (renderer holds
// no entity state itself, just this frame's projected instance list); the
// GPU path's own `gpuPipeline.frame()` calls `.project()` on it internally
// once bound (see GpuCellPipeline.js's `_passVoxel`), so only the CPU/JS
// oracle path (fb.gpu === false) needs an explicit `.project()` call
// here too (mirrors compositor.js reading `fb.voxelPool.list` pre-projected,
// same as the `?gpucompare=1` harness above does by hand). No live prop has
// a `.voxel` component yet (US-056 does the actual swap), so this is a
// no-op today - wiring only, ready for that story.
// US-078d (30.1 + D-034): the sword view-model's held model (`ASSETS.voxelModels.swordHeld`) is a raw classic-
// script global, not an AssetRegistry model yet - register a mesh-only copy once, same precedent as
// game/js/dev/modes/gpucompare.js's own identical block (must run BEFORE gameVoxelPool.bind below).
const swordHeldDef = window.ASSETS && window.ASSETS.voxelModels && window.ASSETS.voxelModels.swordHeld;
if (swordHeldDef && !assets.has('model', 'swordHeld')) {
  assets.add('model', 'swordHeld', { ...swordHeldDef, voxel: { ...swordHeldDef.voxel, meshOnly: true } });
}
// HANDS-01c: the spell glove (`voxelModels.spellHandL`, authored left) - same mesh-only registration as swordHeld.
const spellHandLDef = window.ASSETS && window.ASSETS.voxelModels && window.ASSETS.voxelModels.spellHandL;
if (spellHandLDef && !assets.has('model', 'spellHandL')) {
  assets.add('model', 'spellHandL', { ...spellHandLDef, voxel: { ...spellHandLDef.voxel, meshOnly: true } });
}
const gameVoxelPool = new VoxelPool();
gameVoxelPool.bind(assets, matTable);
// RE-02b F1 + review: 'mesh' only when the mesh GpuCellPipeline is really active (CPU fallback renders shear).
gameVoxelPool.renderer = renderer;
engine.overlay.renderer = renderer;
// US-078d: trail/ghost/spark style ids, resolved from the designer's palette colour keys (design/models/sword.js
// `viewModels.sword.trail`/`trailHard`/`sparks`) via the same hexToRgb(palette.colors[key]) convention hints.js/
// panel.js use - merged into the ONE setStyles call below (setStyles replaces the whole table, never additive).
const swordOverlayStyles = {
  trail0: { glyph: '-', fg: hexToRgb(P.colors.ironLight) },
  trail1: { glyph: '-', fg: hexToRgb(P.colors.mirror) },
  trail2: { glyph: '-', fg: hexToRgb(P.colors.white) },
  trailHead: { glyph: '=', fg: hexToRgb(P.colors.white) },
  ghost: { glyph: ':', fg: hexToRgb(P.colors.iron) },
  sparkHit: { glyph: '*', fg: hexToRgb(P.colors.flameCore) },
  sparkHitEmpty: { glyph: '.', fg: hexToRgb(P.colors.ember) },
  sparkHeavy: { glyph: '#', fg: hexToRgb(P.colors.flameOuter) },
  sparkHeavyEmpty: { glyph: '.', fg: hexToRgb(P.colors.emberDim) },
  sparkClink: { glyph: '+', fg: hexToRgb(P.colors.flameCore) },
};
engine.overlay.setStyles({ ...questOverlayStyles(assets.uiStyle), ...swordOverlayStyles,
  ...(window.ASSETS.boarFx && window.ASSETS.boarFx.overlay ? window.ASSETS.boarFx.overlay : {}), // US-079c: beastNotice (alert !) + beastNoticePop (white-hot first 6 steps), replacing the US-079a placeholder
  decal: { glyphs: '-|\\/', fg: hexToRgb(assets.palette.colors.scrawl) },
  decalFaint: { glyphs: '-|\\/', fg: hexToRgb(assets.palette.colors.scrawlFaint) } }); // US-079a/US-128/US-078d: beastNotice + target* + sword trail/spark overlay styles
const ovlStyles = {
  beastNotice: engine.overlay.styleId('beastNotice'), // US-079a (29.1): resolved once, not per frame
  beastNoticePop: engine.overlay.styleId('beastNoticePop'), // US-079c: white-hot first 6 notice steps
  // US-128b (29.2): resolved once, not per frame.
  target: engine.overlay.styleId('target'),
  targetFade: engine.overlay.styleId('targetFade'),
  targetNone: engine.overlay.styleId('targetNone'),
  targetBarFill: engine.overlay.styleId('targetBarFill'),
  targetBarEmpty: engine.overlay.styleId('targetBarEmpty'),
};
// US-078d (30.1): resolved once, not per frame - passed as swordView.js's `ids` argument.
const swordStyleIds = {
  trail0: engine.overlay.styleId('trail0'), trail1: engine.overlay.styleId('trail1'), trail2: engine.overlay.styleId('trail2'),
  trailHead: engine.overlay.styleId('trailHead'), ghost: engine.overlay.styleId('ghost'),
  sparkHit: engine.overlay.styleId('sparkHit'), sparkHitEmpty: engine.overlay.styleId('sparkHitEmpty'),
  sparkHeavy: engine.overlay.styleId('sparkHeavy'), sparkHeavyEmpty: engine.overlay.styleId('sparkHeavyEmpty'),
  sparkClink: engine.overlay.styleId('sparkClink'),
};
sprites.pool.renderer = renderer; // review item 1: sprite rects follow the pitched scene
if (gpuPipeline) { gpuPipeline.bindVoxels(gameVoxelPool); gpuPipeline.bindViewModel(engine.viewModel); } // US-078a (30.1)
const wgActive = !!(wgPipeline && wgPipeline.ready && rt.backend === 'webgpu'); // WG-2b: geometry-only WebGPU pipeline (CPU still shades)
if (wgActive) { wgPipeline.bindVoxels(gameVoxelPool); wgPipeline.bindViewModel(engine.viewModel); }
engine.attachMaterialTable(matTable); engine.instances.bindPool(gameVoxelPool); if (gpuPipeline) gpuPipeline.bindInstances(engine.instances); // RE-06 (28.6)
if (wgActive) wgPipeline.bindInstances(engine.instances);
// US-078d (30.1): the held sword's view-model handle, resolved once (gameVoxelPool already carries the
// mesh-only `swordHeld` model registered above). `window.ASSETS.viewModels.sword` is the raw classic-script
// def (same `globalThis.ASSETS.viewModels.sword` gpucompare.js reads - not part of the AssetRegistry's own
// JSON-sourced fields).
// HANDS-01b (37.8a erratum): the held geometry is right-hand, so load `swordForHand('right')` (identity pose) ONCE and
// mirror per hand with `vm.setHand` - never feed a pose-mirrored def to the engine mirror (it would mirror twice).
const swordAssetDef = window.ASSETS && window.ASSETS.swordForHand
  ? window.ASSETS.swordForHand('right') : window.ASSETS && window.ASSETS.viewModels && window.ASSETS.viewModels.sword;
const swordVmH = swordAssetDef ? (() => {
  const h = engine.viewModel.load('sword', swordAssetDef, gameVoxelPool);
  return {
    vm: engine.viewModel, h,
    clip: {
      idle: engine.viewModel.clipId(h, 'idle'), charge: engine.viewModel.clipId(h, 'charge'),
      swingLR: engine.viewModel.clipId(h, 'swingLR'), swingHard: engine.viewModel.clipId(h, 'swingHard'),
    },
    mount: { tip: engine.viewModel.mountId(h, 'tip'), mid: engine.viewModel.mountId(h, 'mid') },
    trail: {
      light: { samples: swordAssetDef.trail.samples, stepMs: swordAssetDef.trail.stepMs },
      hard: { samples: swordAssetDef.trailHard.samples, stepMs: swordAssetDef.trailHard.stepMs },
    },
    windows: { light: SWORD_CFG.light, hard: SWORD_CFG.hard },
  };
})() : null;

// HANDS-01c: second handle (after the sword) = the spell hand's idle view; shown only while the spell item is in a hand.
const spellVmH = window.ASSETS && window.ASSETS.viewModels && window.ASSETS.viewModels.spellHand && spellHandLDef
  ? loadSpellHandView(engine.viewModel, window.ASSETS.viewModels.spellHand, gameVoxelPool) : null;

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
  if (wgActive && wgPipeline.ready) wgPipeline.bind(matTable, assets.palette); // grid resize itself ran inside engine.applyGrid
  if (engine.world) for (const s of engine.world.structures) { if (s.kind === 'mesh') continue; bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }
  if (fb) { fb.depth = engine.depthBuffer; fb.gbuf = gbuf; fb.matTable = matTable; fb.light = makeLightBuffer(cols, rows); }
});

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine, gpuPipeline, gbuf, matTable, ambientL, depthBuffer, sprites };
bridgeEngineEvents(engine.events, gameHooks); // beast:died / inventory:added -> seam events
window.__debug.saveRelay = saveRelay; // US-089w: test hook (headless reload check)

// US-048 (PC-B QUEUE 4 item 2): the shared `ctx` every game/js/dev/modes/*
// module's `run(ctx)` reads from - built once here, after every module-scope
// `let`/`const` this file's dev modes used to close over is initialised, so
// each mode gets the exact same values its old inline function body read.
// These are one-shot dev pages (dispatched once, synchronously, right here,
// before any later mutation - e.g. the `grid:changed` handler re-assigning
// `matTable`/`gbuf` - could happen), so passing them by value like this is
// behaviour-identical to the old closures.
// S8-B1-09b: the WebGPU sprite/overlay pipelines compile asynchronously; harness modes (gpucompare, bench) need them wired before pose 1
if (wgPipeline && wgPipeline.spritesCompiled) await wgPipeline.spritesCompiled;
const ctx = {
  params, assets, rt, overlay, gpuPipeline, wgPipeline, matTable, gbuf, depthBuffer, detailPass,
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
} else if (params.has('cinematic')) {
  loadCinematic(params.get('cinematic')).then((path) => runGame('world', path)).catch((error) => {
    window.__cineError = error.message;
    overlay.visible = true; overlay.el.style.display = 'block'; overlay.el.textContent = error.message;
    console.error(error);
  });
} else {
  bootStages.enter('world');
  if (bootCard) bootCard.setStageLines(bootStages.cardText());
  if (bootProg) { bootProg.phase('world'); await bootPaint(); } // the world build below is one synchronous block: paint the phase first
  runGame('world'); // default: US-025 World (world_m1, or ?level=<name> for a bare single-level world)
  if (bootProg) bootProg.phase('frame');
}

async function runGame(mode, cinematic = null) {
  const physics = params.get('physics') === 'grid' ? 'grid' : params.get('physics') === 'mesh' || renderer === 'mesh' ? 'mesh' : 'grid';
  const worldLoadOpts = { physics,
    realTrees: renderer === 'mesh' && physics === 'mesh' && params.get('trees') !== '0',
    detail: renderer === 'mesh' && physics === 'mesh' && params.get('scatter') !== '0' }; // ENV-01a2: `?scatter=0` (not `?detail=0`, that is the US-028 v1-shading switch)
  if (params.get('debug') === '1' || params.get('f3') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`; ME-08c `?f3=1` = F3 pass times at start
  // US-020a: arms the (one-shot) first-gesture listeners only - creates
  // nothing yet, so there is no autoplay warning and no sound before input.
  initAudio();
  setMuted(loadSettings().muted); // US-060: apply the remembered mute before any sound can play

  let simTime = 0;
  let clothTick = 0; // CLOTH-1b3 (33.5): integer fixed-step counter for `w.cloths.tick`/`wind.sampleInto` (rule 15: no wall clock)
  let look = null;
  let playerHandle = null;
  let decalBind = null; // DECAL-01: refreshed on load/restart.
  let beasts = null; // US-079a (29.1): rebuilt on every 'world:loaded', below
  let vitals = null; // US-080a1/a2 (30.2): rebuilt on every 'world:loaded', below
  let targeting = null; // US-128b (29.2): rebuilt on every 'world:loaded', below
  let sword = null; // US-078d (30.1): rebuilt on every 'world:loaded', below
  let hands = null; // HANDS-01b (37.8a): LMB = left-hand item, RMB = right-hand item; rebuilt with the sword sim
  let fireball = null, fbTargets = null; // SPELL-01a (37.14): rebuilt with the sword sim on every 'world:loaded'
  // US-091b: pack-screen mouse. Hover -> UI cell under the pointer; a click while open must not re-lock the pointer
  // (PlayerLook's own canvas click handler), so a capture listener on window swallows it first.
  canvas.addEventListener('mousemove', (e) => {
    if (!invView || !invView.isOpen || !ui) return;
    const r = canvas.getBoundingClientRect();
    invView.setPointer(Math.floor((e.clientX - r.left) / r.width * ui.cols), Math.floor((e.clientY - r.top) / r.height * ui.rows));
  });
  window.addEventListener('click', (e) => { if (invView && invView.isOpen) e.stopPropagation(); }, true);
  // US-090w: title menu pointer - hover selects, click activates; the click never reaches PlayerLook's pointer-lock handler.
  const menuCell = (e) => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * ui.cols), Math.floor((e.clientY - r.top) / r.height * ui.rows)]; };
  canvas.addEventListener('mousemove', (e) => { if (menuHost && menuHost.active && !isSettingsOpen()) { const c = menuCell(e); menuHost.pointer(c[0], c[1], false); } });
  window.addEventListener('click', (e) => {
    if (!menuHost || !menuHost.active) return;
    e.stopPropagation();
    if (!isSettingsOpen()) { const c = menuCell(e); menuHost.pointer(c[0], c[1], true); }
  }, true);
  blockContextMenu(canvas); // RMB must not open the browser menu over the game canvas (never the window)
  let practiceTarget = null; // US-078d (30.1): rebuilt on every 'world:loaded', below
  let particleHooks = null; // US-053c: rebuilt on every 'world:loaded', below
  let loot = null; // US-091a2 (37.16.3): rebuilt on every 'world:loaded', after beasts + the pack
  let toasts = null; // US-091a2: the loot toast view, rebuilt with loot
  let invView = null; // US-091b: the pack screen (`I`), rebuilt with the pack
  let menuHost = null; // US-090w: title menu host while it is up (null = no menu / already closed)
  let invWasLocked = false; // pointer lock state when the pack opened (re-lock on close)
  let waterfallHooks = null;
  let ambientMotes = null;
  let lightSet = null; // US-006: built from the loaded world's level.def.lights, below
  let worldSunPath = null; // US-122a: fit the load-time sun before static/cinematic hour writes.
  const cinematicHours = cinematic && Number.isFinite(cinematic.keys[0].hour);
  let wasPaused = false; // US-062: edge-detects isPaused() to drive duck/resume + accumulator reset once
  if (mode === 'world' && !isCaptureOrBench) installAutoPause(); // US-062: blur/hidden -> forced pause, never auto-resumed

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
  const swordFwd = new Float64Array(2); // US-078d (30.1): reused forwardOf(look.yawDeg) output, no per-step allocation
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
    engine.events.on('world:loaded', (evt) => {
      const world = evt.world;
      bootMark('world:loaded (world built, handler start)');
      if (saveRelay) saveRelay.onWorldLoaded(); // US-089w: consume a pending restore (or reset game data on restart) before any sim is created
      decalBind = bindDecals(engine.overlay, world.decals);
      if (cinematic || Number.isFinite(timeHour)) worldSunPath = sunPathFrom(world.sun || assets.palette.lights.sun);
      // US-020a: reset every module-level audio counter (sector-anim rate
      // limit, footstep accumulator) here - the one
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
        if (s.kind === 'mesh') continue; // ME-14c1: no level
        bindLevel(matTable, s.level); // US-028: pre-warm material ids per placed level
        repackMaterials(s.packed, s.level, matTable); // US-030a: packed.mats was built with matTable=null at placeStructure time
      }
      // US-006: `level.def.lights` per placed structure -> world-space LightSet
      // (torch/lantern/beacon presets, docs/architecture.md 14.3). `?lights=0`
      // keeps the old uniform-ambient path (fb.lights stays null).
      if (lightsEnabled) {
        lightSet = buildLightSet(world, assets.palette);
        if (lightSet) setCloudShadow(lightSet, { strength: cloudStrength }); // S8-B2-12a NEEDS B1 item (2)
        if (lightSet) setHorizonAo(lightSet, { strength: aoStrength }); // S8-B2-20 NEEDS B1 item (1)
        if (lightSet) lightSet.emissive = !isGpuCompareMode && !params.get('gpucompare') && !(resolvedQuality && resolvedQuality.name === 'low'); // EMIS-01b (38.12): glowing voxels light the scene; off on Low and every gpucompare mode
        window.__debug.lights = lightSet; // EMIS-01b: test hook (derivedStats)
        // `?sun=0`: keep the sun's direction/color (F6/F7 still readable) but
        // force it off - `setSun` is the only writer of `on`.
        if (!sunEnabled) lightSet.setSun({ elevation: lightSet.sun.elevation, azimuth: lightSet.sun.azimuth, on: false });
      }
      if (Number.isFinite(timeHour)) applySunHours(world, lightSet, timeHour, worldSunPath, sunEnabled);
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
      // US-078d Q12 item 1(b): must run BEFORE createSwordSim/createTargeting below - both scan
      // `components.targetable` once at creation (rebuilt only on entity:added/removed after that), so a prop
      // whose `targetable` component gets added here instead of at World.load time would otherwise be invisible
      // to both of this load's targetable lists.
      applyPropTargetables(world);
      applyPropEmitters(world); // US-053c: content `emitters` -> components.emitters, same timing rule as applyPropTargetables above
      if (particleHooks) particleHooks.dispose();
      particleHooks = createParticleHooks(world, engine.events, engine.particles, particlePresets, engine.physics.gravity);
      if (waterfallHooks) waterfallHooks.dispose();
      waterfallHooks = waterfallPreset ? createWaterfallHooks(world, engine.particles, waterfallPreset) : null;
      if (ambientMotes) ambientMotes.dispose();
      // S8-B1-18 (closes US-019): ambient dust motes, off with ?ambient=0 and on the Low preset.
      ambientMotes = createAmbientMotes(world, engine.particles, { enabled: params.get('ambient') !== '0' && !(resolvedQuality && resolvedQuality.name === 'low'), rgb: assets.palette.rgb, palette: assets.palette });
      // US-079a (29.1): rebuilt on every load/restart, same precedent as lightSet above.
      // US-078d: beastSim now owns a `combat:hit` listener (the stagger behaviour) - drop the old world's one
      // before creating the next, same "dispose before re-create" precedent as targeting/vitals below.
      if (beasts) beasts.dispose();
      beasts = createBeastSim(world, { nav: worldDef.nav && buildBeastNav(world, worldDef.nav), rng: createRng(worldDef.nav?.seed ?? 1), events: engine.events });
      if (saveRelay) saveRelay.applyDeadToBeasts(beasts); // US-089w: restored dead beasts stay gone (create reset them alive)
      if (sword) sword.dispose();
      sword = createSwordSim(world, engine.events, SWORD_CFG, { spendMana: (n) => vitals && vitals.spendMana(n) }); // US-078d (30.1)
      hands = createHands(engine.events); // HANDS-01b: fresh router per load (the inventory is seeded just below)
      hands.register('sword', sword);
      if (fbTargets) fbTargets.dispose();
      fbTargets = createTargetables(world, engine.events);
      fireball = createFireballSim(world, engine.events, FIREBALL_CFG, fbTargets, { spendMana: (n) => vitals && vitals.spendMana(n) });
      hands.register('spell.fireball', fireball);
      if (fbView) fbView.bind(fireball, lightSet); // SPELL-01b: 4 flight + 2 flash + 1 ember light, never removed
      if (practiceTarget) practiceTarget.dispose();
      practiceTarget = createPracticeTarget(world, engine.events, SWORD_CFG); // US-078d (30.1)
      if (targeting) targeting.dispose(); // same "drop the old world's listeners first" precedent as vitals.dispose() below
      targeting = createTargeting(world, engine.events, {}); // US-128b (29.2): rebuilt on every load/restart
      // US-128b (29.2): ring samples follow the terrain slope (28.9 OVL_RING_LIFT). `null` on a no-terrain world
      // (`?level=<name>` ad-hoc, test_room) falls back to `rasterRing`'s own pre-existing flat-z branch.
      engine.overlay.setGroundFn(world.terrain ? (x, y) => world.terrain.groundAt(x, y) : null);
      if (vitals) vitals.dispose(); // Q9 item 1a: drop the old world's `combat:hit` listener before a new one is added below
      vitals = createVitals(world, engine.events, VITALS_DEFAULTS, { beasts, targeting,
        respawnPose: () => gameHooks.respawn(), // seam onRespawn(): first non-null {x,y,z,yawDeg} wins
        onDied: (t) => gameHooks.emitSimple('player:died', t.x, t.y, t.z),
        syncFacing: (t) => {
          if (!look) return;
          look.clearLock();
          look.yawDeg = t.yawDeg; look.pitchDeg = t.pitchDeg;
        },
      });
      resetPickups(world); // BUG-PICKUP-001: reindex retained drops on every load/restart.
      removeSwordIfTaken(world); // US-078c: a world with the flag already set shouldn't show a taken sword
      // US-091a1 (37.16.4 + 37.8a demo start): seed the pack only when missing, BEFORE
      // `initialState = serialize(...)` below, so `R` restarts keep the start pack. Owner answer 2: the
      // fireball is known from the start in the right hand; the sword is taken in the tower (swordTake.js
      // adds it to the pack + left hand), so the demo pack holds the fireball only. `?demo=0` = empty pack.
      // An old save whose sword flag is already set migrates: sword in the pack + left hand.
      ensureInventory(playerHandle.data, params.get('demo') === '0' ? START_FULL : START_DEMO); // startConfig.js
      if (world.state['tower.sword.taken'] && itemDefs) migrateSword(playerHandle.data.components.inventory, itemDefs);
      // US-091a2 (37.16.3): corpse loot + toast. Own RNG stream (nav seed ^ salt) so the beast wander RNG is never
      // perturbed; `beast.loot` (quest/index.js) reaches this load's sim through setLootApi.
      if (loot) loot.dispose();
      loot = itemDefs ? createLoot(world, engine.events, { items: itemDefs, beasts, table: LOOT_TABLE.boar,
        rng: createRng(((worldDef.nav?.seed ?? 1) ^ LOOT_SEED_SALT) >>> 0),
        inventoryOf: () => playerHandle.data.components.inventory || null }) : null;
      setLootApi(loot);
      if (toasts) toasts.dispose();
      toasts = itemDefs ? createToastView(engine.events, window.ASSETS.items.toast, itemDefs, assets.palette.rgb) : null;
      if (invView && invView.isOpen) invView.close();
      invView = itemDefs && window.ASSETS.uiStyle.inventory ? createInventoryView({
        style: window.ASSETS.uiStyle.inventory, items: window.ASSETS.items, rgb: assets.palette.rgb, toast: toasts,
        inventoryOf: () => (playerHandle && playerHandle.data.components.inventory) || null,
        healthOf: () => (playerHandle && playerHandle.data.components.health) || null,
        onHandsChanged: () => { if (hands && playerHandle) hands.step(playerHandle.data, false, false, false); }, // router sees the change now (cancel + setHand + hands:changed)
        onOpen: () => { invWasLocked = !!(look && look.locked); if (invWasLocked && document.exitPointerLock) document.exitPointerLock(); },
        onClose: () => { if (invWasLocked) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* click to resume */ } } },
      }) : null;
      resetNoteRead(assets.uiStyle); // READ-01: a restart never carries an open note panel over (runtime-only state, 7.6 item 6)
      const startT = playerHandle.data.transform;
      Object.assign(playerHandle.data.components.body || (playerHandle.data.components.body = {}), {
        radius: engine.physics.radius, height: engine.physics.height, eyeH: engine.physics.eyeHeight,
        vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: startT.z,
      });
      // ME-08c (27.16 item 10): `?pose=<slug>` (tools/bench-poses.js GATE_POSES) puts the player at a gate pose (side-by-side page); no wake sequence.
      const gatePose = mode === 'world' && GATE_POSES.find((g) => g.slug === params.get('pose'));
      if (gatePose) {
        const c = typeof gatePose.cam === 'function' ? gatePose.cam(rt, world) : gatePose.cam; // RE-02a: rtsHill58's eye depends on the live grid aspect
        const gz = c.groundEye && world.terrain ? world.terrain.groundAt(c.x, c.y) + c.z : c.z;
        Object.assign(startT, { x: c.x, y: c.y, z: gz - engine.physics.eyeHeight, yawDeg: c.yawDeg, pitchDeg: c.pitchDeg });
        playerHandle.data.components.body.peakZ = startT.z;
      }
      // Dev: `?at=x,y,z,yaw,pitch` = the F3 `world (x, y, z) yaw pitch` line (z = the F3 z = feet height in world metres); no wake sequence.
      let atParts = mode === 'world' && params.get('at') ? params.get('at').split(',').map(Number) : null;
      if (atParts && !(atParts.length >= 3 && atParts.slice(0, 3).every(Number.isFinite))) atParts = null; // a failed parse must not suppress the wake
      if (atParts) {
        Object.assign(startT, { x: atParts[0], y: atParts[1], z: atParts[2], yawDeg: atParts[3] || 0, pitchDeg: atParts[4] || 0 });
        playerHandle.data.components.body.peakZ = startT.z;
      }
      const waterfallView = worldDef.name === 'waterfall_test' && waterfallPreset?.views[params.get('waterfallview')];
      if (waterfallView) {
        Object.assign(startT, waterfallView);
        playerHandle.data.components.body.peakZ = startT.z;
      }
      if (look) look.dispose(); // arch review 1: no leaked click/pointerlock listeners across restarts
      look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg, { pitchClampDeg }); // Mesh first-person pitch clamp.
      look.sensDegPerPx = savedSettings.mouseSensitivity; // US-038b (no-op until PlayerLook reads instance fields, see NEEDS PC-A)
      look.invertY = savedSettings.invertY;
      if (cinematic) look.dispose(); // update's cinematic branch never reads game input
      // US-030c (ARCH CHANGES item 1): `?sprite=1` spawns the three test props in test_room.
      if (params.get('sprite') === '1') spawnTestSprites(world, startT);

      // ---- US-015: wake sequence + title card + map card + hints (7.6 item 6: runtime rebuilt here, every load AND every restart) ----
      questUiActive = typeof world.state['quest.wakeT'] === 'number' && !gatePose && !atParts && !cinematic;
      gameHooks.boot(world, playerHandle.data, engine.events, vitals, playerHandle.data.components.inventory || null); // D-050 seam (after vitals + inventory exist)
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
        // BUG-SAVE-WAKE-01: a loaded save whose wake is done stays standing (no replay, no title card).
        if (!applyWakeOnLoad(world.state, wakeCfg, wakeOut, playerHandle.data.components.body) && startPose && startPose.pose === 'lying') {
          playerHandle.data.components.body.eyeH = wakeCfg.startEyeH;
        }
        // OWN-REQ-003 (17.4): layout in the UI layer's OWN grid (identity
        // centre-scaling - panel.js/titleCard.js's sx/sy become 1), not the
        // scene's - the panel/title now draw into `ui`, not `rt`.
        initTitleCard(assets, ui.cols, ui.rows);
        // S8-B1-15: resolve the two world-space chart markers from live entities (never literal coordinates,
        // US-010 tech note 1) - the waystone is a top-level world prop, the relay is tower.level.json's
        // `beaconBowl` prop, namespaced `${structId}.${propId}` by World.load (engine/world/World.js:544).
        // `?level=`/adhoc worlds have neither entity and fall back to the plain (unbaked) card below.
        let chartOptions = null;
        if (chartData) {
          const markers = [];
          const waystone = world.get('endMarker');
          if (waystone) markers.push({ kind: 'waystone', x: waystone.data.transform.x, y: waystone.data.transform.y });
          const relay = world.get('tower.beaconBowl');
          if (relay) markers.push({ kind: 'relay', x: relay.data.transform.x, y: relay.data.transform.y });
          // S8-B1-16: known landmarks stay visible on the chart regardless of exploration - a visibility-only
          // reveal (mapFog.js's `reveal`, never touches the pencil route) of each marker's own cell, not the
          // player-visit feed (mapFogHook.js's per-tick `visit`) that gates the surrounding terrain.
          if (mapFogHook && mapFogHook.fog) for (const m of markers) mapFogHook.fog.reveal(m.x, m.y);
          chartOptions = { chart: chartData, markers, fog: mapFogHook ? mapFogHook.fog : null };
        }
        try {
          initMapCard(assets, ui.cols, ui.rows, chartOptions);
        } catch (e) {
          console.warn('[map] chart card init failed, falling back to the plain card:', e && e.message);
          initMapCard(assets, ui.cols, ui.rows);
        }
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
      window.__debug.beasts = beasts; window.__debug.hands = hands; window.__debug.sword = sword; window.__debug.fireball = fireball; window.__debug.invView = invView; // HANDS-01b: test hooks
      window.__debug.isMapOpen = isMapOpen; window.__debug.getMapPanel = getMapPanel; window.__debug.getMapChart = getMapChart; // S8-B1-15: test hook (tools/verify-map-wire.mjs)
    });

    // ME-11c (architecture.md 27.18): `?physics=mesh` opts into the mesh
    // collider path instead of the grid (default, unchanged when omitted).
    guardLoad(() => engine.loadWorld(worldDef, worldLoadOpts));
    // BUG-FP-001: on the mesh renderer the terrain mesh needs the far bake (streamed at 1 ms/frame = ~10-15 s) before
    // far tiles exist, so the ground stayed black after spawn. Bake + build the terrain mesh once at load, like rts-test.
    if (renderer === 'mesh' && engine.world.terrain) {
      const tb = performance.now();
      engine.world.terrain.bakeFarSync();
      prebuildTerrainMesh(engine.world.terrain);
      console.log(`[terrain] mesh prebuild ${(performance.now() - tb).toFixed(0)} ms`);
      bootSpan('terrain mesh prebuild', tb);
    }
    // US-017: taken right after World.load (the listener above has already
    // run synchronously by the time `loadWorld` returns - `Events.emit` is
    // synchronous) - so this already includes the body-physics defaults and
    // spawned test sprites, exactly like a restart's `deserialize` would
    // reproduce.
    initialState = serialize(engine.world);
    // US-089w: a saved slot replaces the fresh world (same swap the `R` restart uses); a bad save falls back to the fresh start.
    // US-090w: with the menu up, Continue loads the chosen slot later (below); no implicit slot-0 load.
    const savedWorld = saveRelay && !menuWanted ? saveRelay.load(assets, worldLoadOpts) : null;
    if (savedWorld) {
      try { engine.setWorld(savedWorld); } catch (err) {
        console.warn('[save] restore failed, starting fresh:', err && err.message);
        guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts)));
      }
    }
    // US-090w: the title menu. The world is already built behind it; New game just closes it (the world is fresh),
    // Continue swaps in the chosen slot (same swap as the boot load / `R`), Settings opens the normal panel on top.
    if (menuWanted && !cinematic) {
      menuHost = createTitleMenuHost({
        adapter: createStorageAdapter(getSaveStorage()),
        style: window.ASSETS && window.ASSETS.uiStyle ? window.ASSETS.uiStyle.menu : null,
        onNewGame: (slot) => { if (saveRelay) saveRelay.setSlot(slot); },
        onContinue: (slot, save) => {
          if (!saveRelay) return;
          saveRelay.setSlot(slot);
          const w = saveRelay.load(assets, worldLoadOpts, true);
          if (!w) { console.warn('[save] continue failed, starting fresh:', saveRelay.lastResult && saveRelay.lastResult.error); return; }
          try { engine.setWorld(w); } catch (err) {
            console.warn('[save] restore failed, starting fresh:', err && err.message);
            guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts)));
          }
        },
        onSettings: () => openSettings({ assets, engine, look }),
      });
      window.__debug.menuHost = menuHost;
    }
  }

  function update(dt) {
    lapStart();
    simTime += dt;
    clothTick++;
    if (cinematic) {
      simTime = clothTick / 60;
      const world = engine.world;
      stepSectorAnims(world, dt); world.water.step();
      evaluatePath(cinematic, simTime, cam);
      if (cinematicHours) applySunHours(world, lightSet, cam.hour, worldSunPath, sunEnabled);
      if (world.cloths) world.cloths.tick(clothTick, world.wind, cam.x, cam.y, cam.z);
      stepAnimations(world, dt * 1000);
      if (waterfallHooks) waterfallHooks.step();
      if (ambientMotes) ambientMotes.step(cam.x, cam.y, cam.z);
      entityEmitters.sync(); engine.particles.step();
      if (waterfallHooks) waterfallHooks.afterStep();
      return;
    }
    // US-090w: title menu up -> the sim stays frozen (wake timeline, autosave and quest poll start after it closes).
    if (menuHost && menuHost.active) {
      if (isSettingsOpen()) updateSettings(dt, input, { assets, engine, look, canOpen: false });
      else menuHost.step((c) => input.pressed(c));
      input.consumePressed(); input.consumeMouseDelta();
      return;
    }
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
      if (input.pressed('F6')) setWorldSun(engine.world, lightSet, lightSet.sun.elevation, lightSet.sun.azimuth - 5, sunEnabled);
      if (input.pressed('F7')) setWorldSun(engine.world, lightSet, lightSet.sun.elevation, lightSet.sun.azimuth + 5, sunEnabled);
    }
    // US-017 (7.4 item 2): "entering the end trigger locks input" - no
    // pointer-look, no WASD/jump, no `E`. `quest.endT` (world.state, set by
    // `quest.end`, game/js/quest/end.js) is the one flag both `update()` and
    // `render()` read for this - never a separate module-level bool (7.4's
    // "state that must reset lives in world.state" rule; a restart resets
    // it back to -1 for free, via `deserialize(initialState)`).
    const ending = mode === 'world' && playerHandle
      && typeof engine.world.state['quest.endT'] === 'number' && engine.world.state['quest.endT'] >= 0;

    // US-091b: the pack screen. Steps while paused too; eats every key edge while open (so M / S / N stay quiet).
    if (invView && mode === 'world' && playerHandle) {
      invView.step(dt, input, !ending && !isMapOpen() && !isSettingsOpen() && !isNoteOpen() && !!look
        && !(vitals && (vitals.dead || vitals.inputLocked)) && !(questUiActive && wakeOut.inputLocked));
    }
    const invOpen = !!(invView && invView.isOpen);
    const cardOpen = !!(chestHook && chestHook.card.isOpen); // S8-B1-04: item-get card gates input same as invOpen
    // ---- US-015: wake timeline + map card (world_m1 only, questUiActive) ----
    let uiLocked = false;
    let mPressedEdge = false;
    if (mode === 'world' && playerHandle && questUiActive && !ending) {
      engine.world.state['quest.wakeT'] += dt;
      wakeFrame(engine.world.state['quest.wakeT'], wakeCfg, wakeOut);
      if (wakeOut.inputLocked) playerHandle.data.components.body.eyeH = wakeOut.eyeH;
      mPressedEdge = input.pressed('KeyM');
      stepMapCard(engine.world, assets, dt, input, engine.world.state['quest.wakeT'], wakeOut.titleDoneAtSec);
      uiLocked = wakeOut.inputLocked || isMapOpen() || isSettingsOpen() || isNoteOpen() || invOpen || cardOpen || (vitals && vitals.inputLocked);
    }
    // US-038b: settings panel (S from pause, or its own entry point)
    // canOpen requires the pause overlay to actually be up (!look.locked) -
    // S is also WASD "move backward", so this must never trigger in play.
    updateSettings(dt, input, { assets, engine, look, canOpen: mode === 'world' && !ending && !!look && !look.locked && !isMapOpen() && !invOpen });
    uiLocked = uiLocked || isMapOpen() || isSettingsOpen() || isNoteOpen() || invOpen || cardOpen || !!(vitals && vitals.inputLocked);
    const paused = deviceLostFrozen || (mode === 'world' && !isCaptureOrBench && (isPaused({ ending, look, isMapOpen }) || ((invOpen || cardOpen) && !ending)));

    // US-087 follow-up: drain blocked input without advancing targeting timers.
    // An allowed lock update still precedes look.update so it turns toward the fresh point.
    if (mode === 'world' && playerHandle && targeting) {
      stepTargetingInput(targeting, dt, input, playerHandle.data, look, ending || uiLocked || paused);
    }
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
    if (paused !== wasPaused) {
      wasPaused = paused;
      if (paused) { duckAudio(); if (hands) hands.disarm(); } else { unduckAudio(); resetSimAccumulator(engine); } // HANDS-01b: the sim does not step while paused, so disarm at once
    }
    if (mode === 'world' && playerHandle && !paused) {
      if (ending || uiLocked || (vitals && vitals.inputLocked)) {
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
      // Sector animations update collision before player integration.
      lap(SEC.input);
      stepSectorAnims(engine.world, dt);
      engine.world.water.step(); // US-143a (35.2): wave clock tick, before `integrate` per the Q13 instruction
      integrate(playerHandle.data, dt, controls, engine.world, engine.physics);
      // CLOTH-1b3/1b5 (33.5): the player capsule pushes cloth; sleep-by-distance reads the eye (presentation-only,
      // never hashed/saved - cloths.js's own doc comment). Approx eye = feet + eyeH (good enough for a sleep radius).
      {
        const t = playerHandle.data.transform, body = playerHandle.data.components.body;
        engine.world.cloths.setBody(0, t.x, t.y, t.z, body.radius, body.height);
        engine.world.cloths.tick(clothTick, engine.world.wind, t.x, t.y, t.z + body.eyeH);
      }
      // US-013 (7.4 fixed-step order item 3): after `integrate`, so the
      // player's this-step velocity is what a push is measured against.
      stepRollers(engine.world, dt, engine.physics);
      // US-011 (7.5 item 3): the clip player, right after stepRollers (any
      // gameplay-driven `fps:0` clip is untouched by this - it only advances
      // timed clips like the burner flame / lantern glint / relay sparkle).
      stepAnimations(engine.world, dt * 1000);
      resolveBodyContacts(engine.world, playerHandle.data, engine.physics);
      if (beasts) { const pt = playerHandle.data.transform; beasts.step(pt.x, pt.y, pt.z); } // US-079a (29.1)
      // US-078d (30.1 + D-034 amendment): the sword steps after beasts.step, so a heavy-hit stagger acts from the
      // beast's NEXT step (deterministic, synchronous emit). `attackDown` is the amendment's exact gate expression.
      if (hands) {
        // HANDS-01b (37.8a): the router turns LMB/RMB + the gate into one `down` per item; every item sim is stepped
        // every step (down = false when it is in no hand).
        if (!uiLocked && !paused && !ending && !(vitals && vitals.inputLocked) && input.pressed('KeyH')) hands.swap(); // swap the two hands (owner 2026-10-07: no ?debug=1 needed; not while a menu/pause/death card is up)
        const gateOpen = look.locked && !uiLocked && !ending && !paused && !(vitals && vitals.inputLocked);
        hands.step(playerHandle.data, input.isDown('Mouse0') || input.pressed('Mouse0'), input.isDown('Mouse2') || input.pressed('Mouse2'), gateOpen);
        if (fireball) { // SPELL-01a: aim = unit 3D look vector (pitch > 0 = up); trig stays here, outside sim/
          forwardOf(look.yawDeg, swordFwd);
          const pr = look.pitchDeg * DEG2RAD, cp = Math.cos(pr);
          fireball.step(playerHandle.data, hands.downOf('spell.fireball'), swordFwd[0], swordFwd[1], swordFwd[0] * cp, swordFwd[1] * cp, Math.sin(pr));
          if (fbView) fbView.stepFx(); // SPELL-01b: trail emitters + burst particles (sim side, hashed)
        }
      }
      if (sword) {
        forwardOf(look.yawDeg, swordFwd);
        sword.step(playerHandle.data, swordFwd[0], swordFwd[1], hands ? hands.downOf('sword') : false);
      }
      if (practiceTarget) practiceTarget.step();
      if (vitals) {
        vitals.step(playerHandle.data, input.pressed('KeyE')); // US-080a1 (30.2)
        stepPickups(engine.world, playerHandle.data); // US-080b (30.2)
        // US-080a1 AC5 (`?debug=1` only): F8 toggles invulnerability, F9 deals 5 HP.
        if (params.get('debug') === '1') {
          if (input.pressed('F8')) vitals.setGodMode(!vitals.godMode);
          if (input.pressed('F9')) vitals.debugHit();
        }
      }
      // US-053c: after beast/sword/vitals steps, before entityEmitters.sync()/particles.step() per 32.1.
      if (particleHooks) particleHooks.step(playerHandle.data);
      if (waterfallHooks) waterfallHooks.step();
      if (ambientMotes) ambientMotes.step(playerHandle.data.x, playerHandle.data.y, playerHandle.data.z);
      entityEmitters.sync(); engine.particles.step();
      if (waterfallHooks) waterfallHooks.afterStep();
      lap(SEC.physics);
      // US-020a: footsteps (distance accumulator + `body.landed`) - after
      // physics settles this step's position/flags, same slot as the other
      // post-physics polls below.
      stepGameAudio(playerHandle.data);
      // US-017 (7.4 fixed-step order item 4): after physics settles, before
      // interaction - an enter edge on the end trigger sets `quest.endT`.
      updateTriggers(engine.world, engine, playerHandle.data);
      // US-012 (7.4 fixed-step order item 5): after physics settles this
      // step's position, before the event flush - `E` is edge-triggered the
      // same way Space is (US-009's convention). Forced false while ending
      // (input locked - no other interactable may fire mid-ending).
      updateInteraction(engine.world, engine, Camera.fromEntityInto(playerHandle.data, undefined, interactEye, pitchClampDeg), !ending && !uiLocked && input.pressed('KeyE'));
      // READ-01: the open note's fade + `[E]`/`[Esc]` close, right after
      // `updateInteraction` (which just fired `note.read` on the E edge). A
      // no-op while no note is open; the close guard (`state === 'open'`)
      // keeps the opening E press from also closing it.
      stepNoteRead(dt, input, !!(look && look.locked)); // BUG-NOTE-ESC-01: Esc under pointer lock = lock lost = close
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
      // US-089w/US-096w: world facts -> quest events, play clock, autosave (60 s, waystone). Not while dead/ending/waking.
      const hs = gameHooks.ctx.state; // facts the handlers cannot derive from the world
      hs.wakeDone = questUiActive && !wakeOut.inputLocked; hs.ending = !!ending; hs.canSave = !ending && !wakeOut.inputLocked && !(vitals && vitals.dead);
      // S8-B1-04: same gated E edge updateInteraction uses (false while a menu/card/note is up, see gameHooks.js
      // header) plus the ungated edge a handler's own modal needs to dismiss itself, and the look yaw (chest.js's
      // own reach/facing test wants the player's body forward, not the camera eye - see chestHook.js header).
      const ePressed = input.pressed('KeyE');
      hs.interactPressed = !ending && !uiLocked && ePressed; hs.interactRaw = ePressed; hs.playerYawDeg = look.yawDeg;
      gameHooks.tick(dt);
      lap(SEC.quest);
      engine.world.flushEvents();
      lap(SEC.events);

      // US-017 AC "R restarts the slice ... with all state reset": only
      // once `[R] Wake again` is showing (computeEndCardState's
      // `canRestart`) - never a bare `endT >= 0` check, so `R` can't cut the
      // walk/fade/typing short. `deserialize(initialState)` + `setWorld`
      // rebuilds a brand-new World (lamp/lever/grate/relay/map-card/
      // hints all come back from `initialState`, US-025's own round trip -
      // nothing is a hand-written reset list, per 7.4).
      if (ending && input.pressed('KeyR')) {
        const st = computeEndCardState(engine.world, assets.uiStyle);
        if (st.canRestart) {
          guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts)));
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
  // grid-sized fields (`depth`/`gbuf`/`matTable`/`light`) in place.
  fb = {
    rt, depth: depthBuffer, palette: assets.palette, lights: lightSet,
    light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf, matTable, detailPass, // US-028
    voxelPool: gameVoxelPool, // US-041a (15.3 item 1)
    instances: engine.instances, // RE-06 (28.6)
    viewModel: engine.viewModel, // US-078a (30.1): the held sword; both mesh twins draw it when shown
    waterLooks: resolveWaterLooks(window.ASSETS.waterLooks), // US-055a2c (Q12 item 8): JS twin, same table as gpuPipeline.setWaterLooks
    // US-030a: true once a ready GPU pipeline owns casting - `renderWorld`
    // (compositor.js) reads this and skips its whole CPU sequence; kept in
    // sync with `gpuPipeline`/`rt.gpuActive` right below `mode === 'world'`.
    gpu: false, renderer: 'mesh',
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
    sceneDim, // WG-3f: the WebGPU sprite pass reads it in wgPipeline.frame (GL gets it through sprites.pass.setSceneDim)
    // ARCH CHANGES item 3: `?terrain=0` dev A/B switch, CPU/JS-oracle side
    // (compositor.js reads this; the GPU side is `gpuPipeline.terrainEnabled`).
    terrainEnabled,
  };

  function render(alpha) {
    const renderStart = performance.now();
    const bootFirst = !bootPrinted;
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
      const eye = Camera.fromEntityInto(playerHandle.data, vitals ? vitals.eyeH() : undefined, renderEye, pitchClampDeg); // reused (rule 9: no per-frame Camera); US-080a2: eyeH sinks while dead
      cam.x = eye.x; cam.y = eye.y; cam.z = eye.z; cam.yawDeg = eye.yawDeg;
      cam.pitchDeg = eye.pitchDeg + (vitals ? kickDeg(vitals, simTime) : 0) + (fbView ? fbView.kickDeg() : 0); // US-080a2 (30.2): hurt pitch kick + SPELL-01b blast kick, render eye only - never written into `look`
      if (cinematic) evaluatePath(cinematic, simTime, cam);
      if (cinematicHours) applySunHours(engine.world, lightSet, cam.hour, worldSunPath, sunEnabled);
      fb.timeSec = simTime;
      // Arch review 1 (US-017): `lightSet` is rebuilt by the 'world:loaded'
      // handler on every restart - rebind it here, or `fb.lights` would keep
      // pointing at the previous world's LightSet (beacon state etc.).
      fb.lights = lightSet;
      if (fbView) { // SPELL-01b: ball/flash lights + the spell-hand coal glow, before lights.update below (glow = last frame's, 1 frame lag)
        fbView.present(alpha, cam);
        const sh = hands && !cinematic && spellVmH ? hands.handOf(SPELL_HAND_ITEM) : null;
        if (sh) {
          _emberEye[0] = (sh === 'left' ? -1 : 1) * FIREBALL_CFG.castOffset.right; _emberEye[1] = -FIREBALL_CFG.castOffset.fwd; _emberEye[2] = -FIREBALL_CFG.castOffset.down;
          spellVmH.vm.eyeToWorld(cam, _emberEye, _emberWorld);
          fbView.presentEmber(true, spellVmH.glow, _emberWorld[0], _emberWorld[1], _emberWorld[2]);
        } else fbView.presentEmber(false, 1, 0, 0, 0);
      }
      // US-006: carried-light sync (US-012's lantern, `components.light`)
      // then flicker/vis-grid update, once per rendered frame, BEFORE either
      // the CPU (`renderWorld`) or GPU (`gpuPipeline.frame`) path reads
      // `fb.lights` - the GPU path never calls into compositor.js's own
      // (CPU-only) lighting hook, so this must run here, not there.
      if (fb.lights) {
        syncEntityLights(fb.lights, engine.world, assets.palette, attachedLightPos, lightSyncPos);
        if (fb.lights.emissive) gameVoxelPool.offerEmissive(fb.lights, cam); // EMIS-01b: derived slots from last frame's voxel queue, before update() builds their vis
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
      fb.gpu = (!!gpuPipeline || (wgActive && wgPipeline.frameComplete)) && rt.gpuActive; // WG-3f: WebGPU owns the frame once shadow+water+sprites+overlay are wired
      // US-041a (15.3 item 1): `collect(world, cam)` every frame (cheap - the
      // entity ref list is cached by `world.renderVersion`, only distance is
      // recomputed); the GPU path projects internally, the CPU/JS oracle
      // needs its own explicit `.project()` before `renderWorld` reads
      // `fb.voxelPool.list` (compositor.js).
      gameVoxelPool.collect(engine.world, cam);
      if (!fb.gpu) gameVoxelPool.project(cam, rt, renderer); // ME-19a: CPU reference uses the same mesh camera.
      lap(SEC.voxel);
      // US-017 (7.4 "Fade"): 1 = off outside the end sequence. CPU path
      // only (compositor.js's early-out on `fb.gpu`) - see US-017-gpu.
      fb.sceneFade = endFadeAmount(engine.world, assets.uiStyle);
      engine.feedDetail(cam); // ENV-01a2: shared fed set before either render twin.
      fb.frameNo = (fb.frameNo || 0) + 1; // RE-15a: one host-owned counter for instances.js addToDrawList's memo
      renderWorld(fb, engine.world, cam);
      // US-053b/c: particle layer build, before sprites.render per 32.1 (the sprite pass reads the layer's touched
      // cells right after its own sprite loop).
      engine.particleLayer.build(engine.particles, cam, rt, fb.lights, engine.world, assets.palette, renderer);
      sprites.render(fb, engine.world, cam, fbView ? fbView.extra : undefined); // US-030c (ARCH CHANGES item 1): after the surfaces, before present()
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
      if (!fb.gpu && fb.fadeLut && typeof fb.sceneFade === 'number') {
        clearMaskForSceneFade(fb.rt);
        applySceneFade(fb.rt, fb.sceneFade, fb.fadeLut);
      }
      // US-079a (29.1): beast notice markers, recorded fresh every frame, right before the overlay flush below.
      engine.overlay.clear();
      drawDecals(decalBind, engine.overlay, cam, fb.lights, engine.world);
      if (beasts && !cinematic) presentBeasts(beasts, engine.world, engine.overlay, ovlStyles);
      if (targeting && !cinematic) targeting.present(engine.overlay, ovlStyles); // US-128b (29.2)
      // US-078d (30.1): hidden until the sword is actually taken (US-078a review note); no eyeFeel/bobPhase
      // system exists yet in this codebase, so `simTime` stands in as the walk-bob phase (cosmetic only).
      if (sword && swordVmH && !cinematic) {
        if (engine.world.state['tower.sword.taken'] && hands && hands.handOf('sword')) {
          const body = playerHandle.data.components.body;
          const swordMoving = !!body && body.grounded && (controls.forward !== 0 || controls.strafe !== 0);
          swordVmH.vm.setHand(swordVmH.h, hands.handOf('sword')); // flag write; the engine mirrors the authored-right model
          presentSword(sword, swordVmH, engine.overlay, cam, swordStyleIds, simTime, simTime, swordMoving);
        } else {
          swordVmH.vm.hide(swordVmH.h);
        }
      }
      if (spellVmH) {
        const sbody = playerHandle.data.components.body;
        const spellMoving = !!sbody && sbody.grounded && (controls.forward !== 0 || controls.strafe !== 0);
        presentSpellHand(spellVmH, hands && !cinematic ? hands.handOf(SPELL_HAND_ITEM) : null, simTime, simTime, spellMoving, fireball);
      }
      // RE-07a (28.9): CPU overlay composite after the fade (no-op without recorded ops; GPU twin = RE-07b).
      if (fb.gpu) engine.overlay.flush(cam); // RE-07b: GPU path rasterises here, GpuOverlayPass composites in present()
      else if (engine.overlay.stats.ops) engine.overlay.renderCpu(cam, fb.rt.cells, fb.depth.depth);
      lap(SEC.world);
      const ending = typeof engine.world.state['quest.endT'] === 'number' && engine.world.state['quest.endT'] >= 0;
      const uiLockedNow = questUiActive && !ending && (wakeOut.inputLocked || isMapOpen() || (vitals && vitals.inputLocked));
      // US-015 (docs/architecture.md 7.6 item 3): map-card / hint scene dim.
      // Reset every frame (so a leftover dim never bleeds into the ending
      // screen or a non-quest world), pushed only while active. CPU path
      // (`applySceneDim`) and GPU path (`sprites.pass.setSceneDim`, read by
      // `sprites.frag.js`'s `uDim*` uniforms inside `rt.present()` below)
      // both read the same `sceneDim` object, same precedent as `fadeLut`/
      // `fb.sceneFade` just above.
      resetSceneDim(sceneDim);
      if (invView) invView.pushDim(sceneDim); // US-091b
      if (chestHook) chestHook.card.pushDim(sceneDim); // S8-B1-04
      pushNoteDim(sceneDim); // READ-01: whole-scene x 0.35 while a note is open (no-op otherwise), before applySceneDim/setSceneDim below
      if (questUiActive && !ending) {
        const mapPanel = getMapPanel();
        // OWN-REQ-003 (17.5): `pushDim`/`pushHintDim` convert their UI-cell
        // plate rects to scene cells via `ui.sx`/`ui.sy` - the dim itself
        // always multiplies the SCENE grid (sceneDim.js).
        if (mapPanel) mapPanel.pushDim(sceneDim, ui);
        pushHintDim(ui, assets.uiStyle, sceneDim);
      }
      if (!fb.gpu) applySceneDim(rt, sceneDim);
      if (sprites.pass) sprites.pass.setSceneDim(sceneDim);
      // US-012 (7.4): crosshair + "[E] ..." prompt, emissive UI drawn after
      // the world/sprite passes, never depth-tested (architecture.md 8).
      // Hidden while ending or while wake/map-card input is locked (US-015:
      // there is never a usable target/prompt to show then).
      // OWN-REQ-003 (17.4): drawn into the fixed UI layer (`ui`), not the
      // scene (`rt`), so every one of these reads at the same physical size
      // regardless of `?grid=`.
      if (!ending && !uiLockedNow && !cinematic && !isWaterfallPreview) drawCrosshair(ui, crosshairStyle, engine.world.interaction);
      if (questUiActive && !ending) {
        if ((!isCaptureOrBench || params.get('save') === '1') && !wakeOut.inputLocked) gameHooks.drawHud(ui); // D-050 seam: today the quest relay's TEMPORARY objective line, top-left
        drawHints(ui, assets.uiStyle, fadeLut);
        // 17.4: an eyelid over the 3D view, not UI text. BUG-WEBGPU-EYELID-01: once the WebGPU frame is complete its presenter shows the sprite-pass
        // output, so CPU scene-cell writes never appear -> draw the lid on the UI layer there (an opaque full-row overlay); else in the scene grid.
        if (!(menuHost && menuHost.active)) drawEyelid(wgActive && wgPipeline.frameComplete ? ui : rt, assets.uiStyle, wakeOut.blinkOpen);
        drawTitleCard(ui, fb.timeSec * 1000, wakeOut.titleA, wakeOut.titleState, fadeLut);
        // S8-B1-15: the map card's own draw seam (mapCard.js:drawMapCard), not the generic drawUiPanel - it gives
        // blank (unexplored fog) cells an opaque black backing so they never show the scene through (ARCH note,
        // docs/lanes/pc-c.md batch 16); the fog itself is fed by mapFogHook.js (S8-B1-16).
        drawMapCard(ui, fb.timeSec * 1000, fadeLut);
        // US-080a2/080b (30.2): HP+MP HUD + hurt edge - hidden on title/map/end/death cards (visibleRule, uiStyle.vitals).
        if (vitals) {
          // Q9 item 2c: hidden on the title (wakeOut.inputLocked covers the wake/title timeline) and map cards too,
          // not just while dead - the end card is already covered by the `!ending` gate around this whole block.
          drawVitals(ui, engine.world, assets.uiStyle.vitals, fb.timeSec, !vitals.dead && !wakeOut.inputLocked && !isMapOpen(), vitals);
          drawHurtEdge(ui, vitals, fb.timeSec, assets.uiStyle.vitals);
          presentPickups(engine.world, assets.pickupStyle, fb.timeSec); // US-080b
          if (toasts && !vitals.dead && !wakeOut.inputLocked && !isMapOpen()) toasts.draw(ui, fb.timeSec); // US-091a2 loot toast
        }
      }
      // US-017: the end card, drawn last (over the faded scene) - `setCell`
      // marks these cells `mask = 1` (engine/render/CellBuffer.js), so a
      // second `applySceneFade` call (e.g. a future frame) never touches them.
      const endCardState = computeEndCardState(engine.world, assets.uiStyle);
      drawEndCard(ui, assets.uiStyle, P.colors, endCardState);
      // READ-01: the paper note panel, drawn last (over the dimmed scene + any
      // card) while open - a no-op otherwise. `notes` is `ASSETS.notes` (a raw
      // classic-script global, not an AssetRegistry kind, same precedent as
      // `window.ASSETS.particles`/`window.ASSETS.waterLooks` above).
      drawNotePanel(ui, window.ASSETS.notes, assets.uiStyle);
      if (invView) invView.draw(ui); // US-091b: the pack screen, over HUD + toast
      // US-080a1/a2 (30.2): death fade (CPU path, same gating as the end-card
      // scene fade above) + the death card (typed line + "[E] Wake again").
      if (vitals && vitals.dead) {
        if (!fb.gpu) applyDeathFade(fb.rt, vitals, fb.fadeLut);
        const deathCardState = computeDeathCardState(vitals, assets.uiStyle.vitals);
        drawDeathCard(ui, assets.uiStyle.vitals, deathCardState);
      }
    } else {
      const t = simTime + alpha * (1 / 60); // interpolated time for smooth animation between fixed sim steps
      drawDemoScene(rt, t, assets.palette.ramps.default);
    }
    // US-015 tester BUG-1: the map card owns the screen while open (its own
    // click/key dismiss), so the pause text must not overprint it (160x60).
    if (menuHost && menuHost.active && !isSettingsOpen()) menuHost.draw(ui); // US-090w: the card owns the screen (no pause text under it)
    if (mode === 'world' && !look.locked && !isMapOpen() && !(invView && invView.isOpen) && !cinematic && !isWaterfallPreview && !(menuHost && menuHost.active)) drawPauseOverlay(ui, rt, assets);
    // US-038b: settings panel, drawn over the pause overlay when open
    if (!cinematic && !isWaterfallPreview) drawSettingsPanel(ui, rt, assets, { showEntry: mode === 'world' && !(menuHost && menuHost.active) && !look.locked && !isMapOpen() && !(invView && invView.isOpen) });
    // US-029/US-030a: the real GPU work happens inside `rt.present()`'s
    // hook, right below - `cam`/`engine.world` are only meaningful in
    // 'world' mode (fb.gpu is false otherwise, so the pipeline falls
    // back to the legacy `_repackAndUpload` path, harmlessly, in 'demo'/
    // 'glyphs' mode - gbuf is simply empty there).
    // US-006: `fb.lights` (a real LightSet) on the main game loop; every
    // other call site in this file still passes `ambientL` (ambient-only,
    // 0 point lights - GpuCellPipeline.js's `_uploadLightUniforms` treats a
    // plain array as back-compat ambient-only input).
    lap(SEC.ui);
    if (wgActive && wgPipeline.ready) wgPipeline.frame(fb, (mode === 'world' && fb.lights) || ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    if (gpuPipeline) gpuPipeline.frame(fb, (mode === 'world' && fb.lights) || ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    lap(SEC.gpuFrame);
    rt.present();
    lap(SEC.present);
    if (autoBench && autoBench.phase !== 'done') { const t = performance.now(); lastFrameDt = lastFrameT ? t - lastFrameT : NaN; lastFrameT = t; autoBench.tick(); } // GFX-02
    // US-018 (architecture.md 16): "do not leave pass timing on when the
    // overlay is hidden and no bench runs" - a plain boolean set, cheap
    // enough to do unconditionally every frame.
    if (gpuPipeline) gpuPipeline.setPassTiming(overlay.visible || benchActive || (autoBench !== null && autoBench.phase !== 'done')); // GFX-02: pass timers = sum of passes, not the vsync-padded whole-frame span
    if (wgActive) wgPipeline.setPassTiming(overlay.visible || benchActive || (autoBench !== null && autoBench.phase !== 'done')); // S8-B1-07: same gate as the GL pipeline's pass timers, WG side

    const lastRenderMs = performance.now() - renderStart;
    if (bootFirst && bootProg) bootProg.finish();
    if (bootFirst) {
      bootPrinted = true; bootMark('first frame rendered'); freezeBootMarks();
      console.info('[boot] breakdown (ms since navigation start)\n' + bootReport()); window.__bootReport = bootReport();
      bootStages.enter('meshes'); // in case the mesh prefetch above was a no-op (lazy loading off) and never advanced the timer
      bootStages.finish();
      bootStageAtFrame = bootNow(); // S8-B1-20: F3 shows the stage breakdown for 10 s after this point, then drops it
      console.info(`[boot] stage total: ${bootStages.total().toFixed(0)} ms\n${bootStages.cardText()}`);
    }
    // US-018: the overlay text is only ever built while it will actually be
    // shown (`shouldRefresh` = visible + <= 4 Hz) - `?bench=1` builds/owns
    // its own overlay text instead (dev/perfBench.js), so it skips this.
    if (!benchActive && overlay.shouldRefresh(performance.now())) {
      // US-030a (14.2 item 7): "path: gpu|cpu  grid: WxH  rays: n" on the overlay.
      let extra = `grid draw: ${lastRenderMs.toFixed(2)} ms\ncells: ${rt.cols}x${rt.rows}\nbackend: ${rendererInfo.label}` +
        `\n${describeQuality(bootOpts, rt.cols, rt.rows, engine.rays)}` + // GFX-01w
        `\npath: ${rt.gpuActive ? 'gpu' : 'cpu'}  grid: ${rt.cols}x${rt.rows}  rays: ${engine.rays}` +
        (gpuPipeline ? `  upload ${gpuPipeline.stats.uploadMs.toFixed(2)}ms  gpu ${Number.isNaN(gpuPipeline.stats.gpuMsP50) ? 'n/a' : gpuPipeline.stats.gpuMsP50.toFixed(2) + 'ms'}` +
          // ARCH CHANGES item 4: `terrainSubmitMs*` is CPU draw-call submit
          // time, not a GPU cost - the real terrain GPU cost is the whole-frame
          // `gpuMs` A/B delta with vs without `?terrain=0` (measured + recorded
          // in this story's Programmer notes, docs/backlog.md).
          `  terrain cpu ${Number.isNaN(gpuPipeline.stats.terrainSubmitMsP50) ? 'n/a' : gpuPipeline.stats.terrainSubmitMsP50.toFixed(2) + 'ms'}` : '') +
        (!gpuPipeline && rt.stats ? `\nGPU present p50 ${Number.isNaN(rt.stats.gpuMsP50) ? 'n/a' : rt.stats.gpuMsP50.toFixed(2) + 'ms'}  p95 ${Number.isNaN(rt.stats.gpuMsP95) ? 'n/a' : rt.stats.gpuMsP95.toFixed(2) + 'ms'}` : '') +
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
        if (engine._detail) extra += `\ndetail fed ${engine._detail.fed}  culled ${engine.instances.stats.instancesCulled}  lod1 ${engine.instances.stats.instancesLod1}`;
        extra += '\npass ms: ' + PASS_NAMES.map((name, i) => {
          const v = gpuPipeline.stats.passMsP50[i];
          return `${name} ${Number.isNaN(v) ? 'n/a' : v.toFixed(2)}`;
        }).join('  ');
      }
      if (wgActive && wgPipeline.ready) extra += '\nwg pass ms: ' + WG_PASS_NAMES.map((name, i) => { const v = wgPipeline.stats.wgPassMsP50[i]; return name + ' ' + (Number.isNaN(v) ? 'n/a' : v.toFixed(2)); }).join('  '); // S8-B1-07
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
      if (bootPrinted) extra += '\nboot: ' + bootSummary();
      overlay.update(engine.loop.fps, engine.loop.frameMs, extra);
    }
    lap(SEC.overlay);
  }

  // MESH-LOAD-01: lazy meshes near the (possibly save-restored) spawn point load now, behind the boot card's
  // 'frame' phase - never on the first rendered frame. `playerHandle` is only null after a failed load
  // (guardLoad already reported it via fatalError); skip rather than throw on top of that.
  bootStages.enter('meshes');
  if (bootCard) bootCard.setStageLines(bootStages.cardText());
  if (playerHandle) await prefetchLazyMeshesAtBoot(bundle.lazyMeshes, engine.world, playerHandle.data.transform);

  if (wantAutoQuality && mode === 'world' && !cinematic && resolvedQuality) startAutoBench(resolvedQuality.name, false); // GFX-02
  const loop = engine.run({ update, render });
  if (cinematic && params.get('capture') === '1') {
    loop.stop();
    window.__cine = createPlayback(cinematic, update, render);
  }
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

/** F3: first-frame time + the 6 longest spans (full table: console / window.__bootReport). S8-B1-20: plus the
 * per-stage ms breakdown (bootStages.cardText()) and the stage total, shown for 10 s after the first frame only. */
function bootSummary() {
  const e = bootEntries(), last = e.length ? e[e.length - 1].t : 0;
  const top = e.filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 6).map((x) => `${x.label.replace(/ \(.*$/, '')} ${x.ms.toFixed(0)}`).join(', ');
  let s = `first frame ${last.toFixed(0)} ms; top spans: ${top}`;
  if (bootNow() - bootStageAtFrame < 10000) s += `\nstages (total ${bootStages.total().toFixed(0)} ms): ${bootStages.cardText().replace(/\n/g, ', ')}`;
  return s;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// `?voxelbench=1` (architecture.md 15.2 item 6, D-019 gate): renders every
// real voxel prop the tower spawns (US-056: lever, lantern, rubble,
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
  gpuPipeline.setSource('scene');

  function loadBenchWorld(def) {
    const w = World.load(def, assets, {});
    for (const s of w.structures) {
      if (s.kind === 'mesh') continue; // ME-14c1
      bindLevel(matTable, s.level);
      repackMaterials(s.packed, s.level, matTable);
    }
    return w;
  }
  const world = loadBenchWorld(assets.world('world_m1'));
  if (world.terrain) world.terrain.bakeFarSync();
  const lights = lightsEnabled ? buildLightSet(world, assets.palette) : null;
  if (lights) setCloudShadow(lights, { strength: cloudStrength }); // S8-B2-12a NEEDS B1 item (2)
  if (lights) setHorizonAo(lights, { strength: aoStrength }); // S8-B2-20 NEEDS B1 item (1)
  if (lights && !sunEnabled) lights.setSun({ elevation: lights.sun.elevation, azimuth: lights.sun.azimuth, on: false });
  if (lights) lights.update(0, world);

  const pool = new VoxelPool();
  pool.bind(assets, matTable);
  gpuPipeline.bindVoxels(pool);

  // US-056: `pool.collect(world, cam)` instead of a single hand-pushed
  // `lever` instance - `World.load` above already spawned every tower prop
  // with a merged voxel `ModelDef` as a real `components.voxel` entity
  // (15.3 item 1's spawn rule), so this now measures "with all props"
  // (lever, lantern, rubble x5, canvasHeap, gondola, strut - 9 of
  // the 11 total are in the wreck-room cluster, well under the 16-instance
  // cap; envelopeHeap and the summit relay sit apart). Cam (tower origin
  // 1480, 1018, 0 + local 14.0, 2.0, yaw 150, pitch 5) stands south-west of
  // the cluster looking across it - 10 of the 11 land on screen at once
  // (`?voxelbench` "instances" line), a harder GPU-upload case than any
  // single-prop framing while `collect` (cam-independent: gathers every
  // voxel entity in the world, nearest 16 win only past the cap) still pays
  // the pose cost for all of them regardless of the exact framing.
  const cam = { x: 1494.0, y: 1020.0, z: engine.physics.eyeHeight, yawDeg: 150, pitchDeg: 5 };

  const fb = {
    rt, depth: depthBuffer, palette: assets.palette, gbuf, matTable, detailPass,
    lights, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpu: true, renderer: 'mesh', voxelPool: pool,
  };

  const FRAMES = 300;
  for (let i = 0; i < FRAMES; i++) {
    pool.collect(world, cam);
    pool.project(cam, rt);
    renderWorld(fb, world, cam); // fb.gpu = true: primes ambientL only
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

// `?gpucompare=1` (isGeometryCompare) forced `rt` to the fixed reference box
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
