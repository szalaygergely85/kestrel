// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import { loadPresets, resolveQuality, saveQuality, knobsFor } from './ui/gfxPresets.js';
import { registerRiggedChars } from './quest/charRegister.js';
import { resolveBootOptions, describeQuality } from './gfxBoot.js';
import { pickQuality, tierFromAdapter, p95 } from './gfxAuto.js'; // GFX-02
import { gatherAdapterInfo, showCard, AutoBench } from './gfxAutoRun.js';
import {
  probeWebGpu, AssetRegistry, createEngine, createRenderer, clampGrid, GRID_DEFAULT_COLS, resolveShadowLevel,
  GBuffer, bindShading, bindLevel,
  DebugOverlay, bootMark, bootSpan, bootNow, freezeBootMarks, bootEntries, bootReport, // BOOT-SPEED-01
  integrate, stepRollers, resolveBodyContacts, Camera, renderWorld, stepSectorAnims, stepAnimations,
  WG_PASS_NAMES,
  VoxelPool, bindDecals, drawDecals,
  PITCH_CLAMP_PITCHED_DEG,
  ambientL, World, repackMaterials,
  updateInteraction, drawCrosshair,
  buildLightSet, syncEntityLights, makeLightBuffer, attachedLightPos, sunPathFrom, applySunHours, setWorldSun,
  updateTriggers, moveCapsule, serialize, deserialize, createFadeLut, applySceneFade, clearMaskForSceneFade,
  createSceneDim, resetSceneDim, applySceneDim,
  loadContentPack, createRng, prebuildTerrainMesh,
  forwardOf, DEG2RAD, hexToRgb, resolveWaterLooks, createEntityEmitters, AO_DEFAULTS,
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
import { parseCloudShadowFlag, devCloudShadow, parseAoStrength } from './cloudParam.js'; // S8-B2-12a/S8-B2-20 NEEDS B1 item (2)/(1): `?cloudshadow=1`/`?ao=<0..1>` parse
import { MODES } from './dev/modes/index.js';
import { loadCinematic, evaluatePath, createPlayback } from './dev/modes/cinematic.js';
import { createPauseMenu, PAUSE_KEYS } from './ui/pauseMenu.js'; // PAUSE-MENU-01 (D-053): replaces the old 'Click to resume' overlay
// CHARGEN-17 parked (owner 2026-10-10): import { createCharCreate } from './ui/charCreate.js';
import { createCreditsView } from './ui/creditsView.js'; // CREDITS-MOUNT-01
import { updateSettings, drawSettingsPanel, isSettingsOpen, openSettings, dimSceneRect } from './ui/settings.js'; // US-038b
import { isPaused, resetSimAccumulator, duckAudio, unduckAudio, installAutoPause } from './ui/pause.js'; // US-062
// ---- US-020a: minimal procedural sound slice (game/js/audio/*, D-004) ----
import { initAudio, setMuted, setVolume, toggleMute, isMuted } from './audio/synth.js';
import { resetGameAudio, stepGameAudio } from './audio/sfx.js';
// ---- end US-020a ----
import { createSafeBindings, resolveGameKeys } from './gameKeys.js'; // BINDINGS-WIRE-01
import { loadSettings, saveSettings, getSaveStorage } from './platform/index.js'; // US-060: remembered mute (D-012)
import { loadBootBundle } from './packBoot.js';
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
import { createWaystoneTouch } from './waystoneTouch.js'; // WAYSTONE-TOUCH-01
import { createWaystoneWire } from './quest/wire/waystone.js'; // WAYSTONE-01w
import { createTravel } from './quest/travel.js'; // WS1-07b: map travel (fade, teleport, reset)
import { createTitleMenuHost } from './titleMenuHost.js'; // US-090w: title menu (New / Continue / Settings) before play
import { createStorageAdapter } from './quest/save/saveState.js';
import { retintHand, lookOrDefault } from './quest/look/handLook.js'; // CHARGEN-16
import { createSaveRelay } from './saveRelay.js'; // US-089w/US-096w: save + autosave + quest event hook
import { parseOccl, createHzbInvalidator } from './occlGate.js'; // OCCL-MAIN-01
import { watchDeviceLost } from './deviceLost.js'; // S8-B1-10 (38.10c): device-lost card
import { createChestHook } from './chestHook.js'; // S8-B1-04: chest sim + item-get card, through the seam only
import { createMapFogHook } from './mapFogHook.js'; // S8-B1-16: visited-cell mask feed, through the seam only
import { wireTelegraphs, telegraphsEnabled } from './fx/telegraphWire.js'; // TELEGRAPH-WIRE-01 (lane B1)
import { stepCombatHint } from './quest/combatHint.js'; // COMBAT-HINT-01
import { createWild } from './wild/wildEnv.js'; // WILD-06: ambient rabbits + deer
import { createBeastSim } from './quest/sim/beastSim.js'; // US-079a (architecture.md 29.1)
import { buildBeastNav } from './quest/sim/beastNav.js';
import { presentBeasts } from './quest/beastView.js';
import { createBeastAnim } from './quest/beastAnim.js'; // ANIM-STATE-WIRE-01
import { questOverlayStyles } from './quest/overlayStyles.js';
import { createVitals } from './quest/sim/vitals.js'; // US-080a1/a2 (architecture.md 30.2)
import { createTargeting } from './quest/targeting.js'; // US-128b (architecture.md 29.2)
import { stepTargetingInput } from './quest/targetingInput.js';
import { SWORD_CFG } from './quest/swordConfig.js'; // US-078d (architecture.md 30.1 + D-034 amendment)
import { createSwordSim } from './quest/sim/sword.js';
import { presentSword } from './quest/swordView.js';
import { loadSpellHandView, presentSpellHand, SPELL_HAND_ITEM } from './quest/spellHandView.js'; // HANDS-01c (37.8a)
import { loadHandFireView, presentHandFire, bindHandFx, stepHandFx, setHandFlame, pushHandFlame } from './quest/handFireView.js'; // HAND-WIRE-01: realistic hand + always-on fire
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
import { createHitStop, hitStopEnabled } from './fx/hitStop.js'; // HITSTOP-01 (lane B1)
import { createDeathFlow, deathFlowEnabled } from './fx/deathFade.js'; // DEATH-FLOW-01 part 1 (lane B1)
import { createHurtFx, hurtFxEnabled } from './fx/hurtFx.js'; // HURT-FX-01 (lane B1): low-hearts pulse only (hurt edge + kick = US-080a2)
import { wireHitSparks, hitSparksEnabled } from './fx/hitSparkWire.js'; // HIT-SPARK-WIRE (lane B1)
import { parsePointShadows } from './pointShadowOpt.js'; // ME-16e: ?pointshadows=0|N
import { setReduceMotion, isReduceMotion, eyeZ, gateKick, textSizeCols } from './ui/comfort.js'; // SETTINGS-APPLY-01
import { PHYSICS } from '../../engine/index.js';
import { drawVitals, drawHurtEdge, kickDeg, applyDeathFade, computeDeathCardState, drawDeathCard } from './quest/vitalsView.js';
import { stepPickups, resetPickups } from './quest/sim/pickups.js'; // US-080b (30.2)
import { ensureInventory, validateItemDefs, migrateSword } from './quest/sim/inventory.js'; // US-091a1 (37.16.4)
import { presentPickups } from './quest/pickupsView.js';
import { createLoot, setLootApi } from './quest/sim/loot.js'; // US-091a2 (37.16.3)
import { createRelayWake, setRelayWakeApi } from './quest/relayWake.js'; // WS1-06b: wake the road-bend relay
import { createDialogueCtl, setDialogueApi } from './quest/dialogueCtl.js'; // DIALOGUE-01b2 (38.28)
import { createNpcTurn } from './quest/npcBear.js'; // NPC-BEAR-01 (38.28): turn-to-player
import { LOOT_TABLE, LOOT_SEED_SALT } from './quest/sim/lootConfig.js';
import { createToastView } from './quest/toastView.js';
import { createInventoryView } from './quest/inventoryView.js'; // US-091b
import { createQuestMarkers } from './quest/sim/questMarkers.js'; // QUEST-MARK-01w
import { registerQuestMarks } from './quest/wire/questMarks.js';
import { createQuestLogScreen, QUEST_LOG_KEYS } from './ui/questLog.js'; // QG-05
import { createCompassHud } from './ui/compassHud.js'; // COMPASS-02 (D-061)
import { createCrafting } from './quest/sim/crafting.js'; // MAIN-WIRE-01: crafting list on C
import { createCraftView } from './ui/craftView.js';
import { drawDemoScene } from './dev/demoScene.js';
import { drawGlyphsScreen } from './dev/glyphsScene.js';
import { ensureBenchBoars } from './dev/combatBench.js'; // COMBAT-BENCH-01
import { runPerfBench } from './dev/perfBench.js'; // US-018 (architecture.md 16) `?bench=1`
// ---- US-030c (ARCH CHANGES): sprite system wiring, kept to this one import ----
import { createSpriteSystem, spawnTestSprites } from './dev/spriteDev.js';
// ---- end US-030c ----
// ---- US-010: quest behaviours (registered by name before any World loads) ----
import { validateBehaviours, createRipples, createEntityTintTable, fillEntityTints, localToWorld } from '../../engine/index.js';
import './quest/index.js';
import { parseDemo, filterDemoParams, demoStorage, blockFKeys, createEndCard, drawDemoBuildLine } from './demoMode.js';
// ---- end US-010 ----

const demo = parseDemo(window.location.search); // DEMO-MODE-01: `?demo=1` public build; off = everything below is unchanged
const params = filterDemoParams(new URLSearchParams(window.location.search), demo); // demo: only quality/res/fx survive
const saveStorage = () => (demo.on ? demoStorage(getSaveStorage()) : getSaveStorage()); // demo: own save namespace, slots 1-3 untouched

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
const controlBindings = createSafeBindings(savedSettings.bindings); // BINDINGS-WIRE-01: invalid saved table -> defaults
const gameKeys = resolveGameKeys(controlBindings); // resolved once; re-run after a rebinding UI changes the table
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
  resolvedQuality = resolveQuality({ param: params, saved: { quality: savedForBoot, shadowQuality: savedSettings.shadowQuality, lodScale: savedSettings.lodScale }, auto: autoProvisional });
} catch (err) { console.warn(`[quality] presets unavailable (${err.message}) - booting without a preset`); }
const hitStop = createHitStop({ enabled: hitStopEnabled(params, isCaptureOrBench) }); // HITSTOP-01: off in capture/bench(+combat)/compare and ?fx=0
let deathRespawnDue = false; // DEATH-FLOW-01: fade finished -> next vitals.step gets a virtual [E] (its normal respawn path, pose logic untouched)
const deathFlow = createDeathFlow({ enabled: deathFlowEnabled(params, isCaptureOrBench), onRespawn: () => { deathRespawnDue = true; } });
setReduceMotion(savedSettings.reduceMotion); // SETTINGS-APPLY-01: read at boot, the Settings panel updates it live
const hurtFx = createHurtFx({ enabled: hurtFxEnabled(params, isCaptureOrBench), reduceMotion: isReduceMotion }); // HURT-FX-01: off in capture/bench/compare and ?fx=0
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
    sample: () => (wgActive && wgPipeline.stats ? wgPipeline.stats.gpuMsP95 : NaN), // S8-B1-08: WebGPU feeds the WG timer (wgActive is set before the first sample)
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
const bundle = await loadBootBundle(params, { lazyMeshes }, (m) => console.log('[pack] ' + m)); // KPKG-04 + CHARGEN-15 (38.33): ?pack= packages + content/packages/index.json add-ons (?addons=0 skips) over the loose base
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

// WG-5b: WebGPU is the only GPU backend. `?force2d=1` is the dev switch for the CPU Canvas2D reference path (no
// WebGPU, capped grid). When WebGPU is missing or fails, createRenderer calls `onWebGpuMissing` (below): the canvas is
// hidden, the "WebGPU required" screen (webgpuRequired.js) is shown and no game loop starts (`gpuBlocked`).
let gpuBlocked = false;
function onWebGpuMissing(reason) {
  gpuBlocked = true;
  canvas.style.display = 'none';
  const text = String(reason || '');
  const code = /navigator\.gpu/.test(text) ? 'no-api' : /no adapter/.test(text) ? 'no-adapter' : 'device-failed';
  console.warn('[webgpu] missing: ' + text);
  import('./webgpuRequired.js').then((m) => m.showWebGpuRequired(document.body, { reason: code })).catch(() => {
    const div = document.createElement('div');
    div.id = 'webgpu-required';
    div.textContent = 'WebGPU required to play. Use a current Chrome or Edge with hardware acceleration on, then reload.';
    div.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#0a0806;color:#e8d9a8;font:16px monospace;text-align:center;padding:2em';
    document.body.appendChild(div);
  });
}

// BUG-BOOT-001 (Q9 item 3, architect ruling): a plain DOM fatal card (message + stack, no renderer dependency -
// same "throwaway canvas, no engine state" precedent as the WebGPU-required screen) instead of a silent black screen.
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
// WG-5b: WebGPU is the only backend (`?backend=` is ignored with a warning).
const shadowOpts = bootOpts.shadowOpts; // GFX-01w: shadow level from the preset (resolveShadowLevel) + ?shadows= / ?shadowinst / ?shadowres / ?shadowcast overrides (ME-15e/f, D-043: map is the default)
const occlOpt = parseOccl(params, 'webgpu');
const pointShadowOpt = parsePointShadows(params, resolvedQuality && resolvedQuality.name); // ME-16e: default OFF in every mode unless the URL sets it
const tCR = bootNow();
const { rt: builtRt, pipeline: wgPipeline, device: gpuDevice, info: rendererInfo } = await createRenderer({ canvas, cols: gridResult.cols, rows: gridResult.rows, backend: params.get('backend') || 'webgpu', onWebGpuMissing,
  force2d: params.get('force2d') === '1', gpu: params.get('gpu') !== '0', rays, terrainEnabled: params.get('terrain') !== '0',
  stable: params.get('stable') === '1' || params.get('gpucompare') === '1', // US-073c (38.25): temporal glyph stability, default OFF; ?gpucompare=1 builds it for the `stable` row (the pass stays off for every other row)
  shadows: shadowOpts, gpuCull: params.get('gpucull') !== '0', occl: occlOpt.occl, pointShadows: pointShadowOpt.pointShadows, pointShadowLevel: pointShadowOpt.pointShadowLevel, // OCCL-MAIN-01: `?occl=1` two-phase HZB occlusion, default OFF, WebGPU only
  onCompileProgress: (done, total) => { bootStages.enter('pipelines'); if (bootCard) bootCard.setStageLines(bootStages.cardText()); if (bootProg) bootProg.count('compile', done, total); } }); // WG-4a: `?gpucull=0` = CPU instance cull on WebGPU; WG-3d: the WebGPU pipeline needs the same sun-shadow options as the engine
bootSpan('createRenderer total (' + rendererInfo.label + ')', tCR);
if (bootProg) { bootProg.phase('engine'); await bootPaint(); }
const tCE = bootNow();
const textSizeUiGrid = (g, size) => ({ ...g, cols: textSizeCols(g.cols, size), rows: undefined }); // rows follow cols (UI_GRID_ASPECT)
const engine = createEngine({
  canvas, assets, cols: gridResult.cols, rows: gridResult.rows, rays,
  renderTarget: builtRt,
  renderPipeline: wgPipeline, // WG-2b (38.8a item 21): lets engine.setGrid resize a webgpu target + its WgCellPipeline
  force2d: params.get('force2d') === '1',
  gpu: params.get('gpu') !== '0',
  // OWN-REQ-003 (architecture.md 17.1): the fixed UI glyph layer's grid -
  // `assets.uiStyle.uiGrid` (design/models/title.js), default 160x60.
  uiGrid: textSizeUiGrid((assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 }, savedSettings.textSize), // SETTINGS-APPLY-01: Text size -> UI grid density (next load)
  // ME-19c2: the sun shadow MAP is the only sun shadow path (the sun DDA is gone from the GPU shaders); `?shadows=` only picks level/res.
  shadows: shadowOpts, // ME-15c/e/f (27.9a, D-043): see shadowOpts above
  gfx: bootOpts.gfx, // GFX-03/GFX-01w: scatter density + LOD scale from the preset (undefined = engine defaults)
});
bootSpan('createEngine', tCE);
// S8-B2-13b NEEDS B1-main (38.14 "Owners"): one ripples ring buffer for the whole session, presentation-only
// (not saved, not hashed). `fb.ripples = ripples` below hands it to the renderer (duck-typed `{packInto}`,
// waterComposite.js twin/WGSL); the dev hook and the splash-entry call (US-055b) both call `ripples.add`.
const ripples = createRipples();
// US-089w/US-096w: save relay (autosave 60 s + waystone, load at boot) and quest hook. `?save=0` off; capture/bench/compare/cinematic
// pages and automated browsers never load or save unless `?save=1` forces it (the headless reload check does).
const saveEnabled = params.get('save') !== '0' && (params.get('save') === '1' || !(isCaptureOrBench || params.get('capture') === '1' || params.has('at') || navigator.webdriver)); // `?at` = dev pose: never autosave it into slot 0
let saveRelay = null;
let markWorld = null; // QUEST-MARK-01w: the current World (set per load before gameHooks.boot)
let titleMenuActive = true; // S8-B1-10: mirrors menuHost.active each frame (true until the first frame says otherwise); gates the loss autosave
let deviceLostFrozen = false; // S8-B1-10 (38.10c): set once by watchDeviceLost's `freeze` hook below; gates `paused` in the frame loop
try {
  const questDef = await (await fetch('../content/quests/m1.quest.json')).json();
  const giverDefs = [await (await fetch('../content/quests/burl.boars.quest.json')).json()]; // QG-03 (D-058): giver quests, state in the quest book
  const charKit = await (await fetch('../content/chargen/human.charkit.json')).json(); // CHARGEN-16: kit default look + hand skin tones
  saveRelay = createSaveRelay({ storage: saveStorage(), questDef, giverDefs, enabled: saveEnabled, defaultLook: charKit.defaults });
  window.__charKit = charKit;
  saveRelay.bindEvents(engine.events);
  gameHooks.register(saveRelay.handlers());
  saveRelay.quest.onPoll = (name, a, b) => gameHooks.emitSimple(name, a, b);
  gameHooks.onSaveRequest(() => { if (saveRelay && gameHooks.ctx.world) saveRelay.save(gameHooks.ctx.world, { ending: gameHooks.ctx.state.ending }); });
  // QUEST-MARK-01w: '!' markers over available take steps (patch docs/patches/QUEST-MARK-01w.diff). Off in capture/bench/?save=0.
  if (saveEnabled && window.ASSETS && window.ASSETS.questMarkFx) {
    const qm = createQuestMarkers(questDef, [{ objectiveId: 'waystone', targets: ['endMarker'] }]); // other take steps (wake/breach) have no prop to mark yet
    const MARK_TOP = { endMarker: 3.0, bear: 2.8 }; // prop top above its base z (waystone 24 voxels x 0.125 m); notes would use z + 1.55
    gameHooks.setQuestSource((out) => { const st = saveRelay.quest.state; out.done = saveRelay.quest.done; out.id = out.done ? '' : questDef.objectives[st.completed.length].id; out.targets = qm.markerTargets(st); });
    let markN = 0;
    const markHandle = (model) => { // entity handle for one marker; re-spawns itself when a world reload dropped the entity
      const id = 'questMark_' + (markN++); let w = null, ent = null, hidden = true, scale = 1, anim = 'idle', x = 0, y = 0, z = 0;
      const cur = () => {
        const mw = markWorld; if (!mw) return null;
        if (w !== mw || !ent || !ent.alive) { w = mw; ent = mw.get(id) || mw.spawn('prop', { x, y, z, yawDeg: 0, scale }, { voxel: { model, anim, loop: true, hidden } }, id); }
        return ent.data;
      };
      const push = () => { const d = cur(); if (!d) return; Object.assign(d.transform, { x, y, z }); d.transform.scale = scale; d.components.voxel.hidden = hidden; d.components.voxel.anim = anim; w.renderVersion++; };
      return {
        get hidden() { return hidden; }, set hidden(v) { if (v !== hidden) { hidden = v; push(); } },
        get scale() { return scale; }, set scale(v) { if (v !== scale) { scale = v; push(); } },
        get anim() { return anim; }, set anim(v) { if (v !== anim) { anim = v; push(); } },
        setPos(a, b, c) { x = a; y = b; z = c; push(); },
      };
    };
    const markResolve = (id, out) => { const h = markWorld && markWorld.get(id), t = h && h.data && h.data.transform; if (!t) return false; out.x = t.x; out.y = t.y; out.z = t.z + (MARK_TOP[id] || 1.55); return true; };
    registerQuestMarks(gameHooks, { fx: window.ASSETS.questMarkFx, resolve: markResolve, create: () => markHandle('questMark') });
    // QG-04: giver markers over Burl: '!' while his quest is available, '?' while ready, none while active/done (book.giverMarks)
    const gAvail = [], gReady = [];
    for (const [model, list] of [['questMark', gAvail], ['questMarkReady', gReady]]) {
      registerQuestMarks(gameHooks, { fx: window.ASSETS.questMarkFx, resolve: markResolve, create: () => markHandle(model),
        source: (out) => { const b = saveRelay.quest.book; b.giverMarks(gAvail, gReady); out.done = false; out.targets = list; } });
    }
  }
} catch (e) { console.warn('[save] relay unavailable:', e && e.message); }
// MAIN-WIRE-01: crafting recipes (content/items/recipes.json), loaded once; the craft view (key C) is built with the pack.
let recipeList = null;
try { recipeList = (await (await fetch('../content/items/recipes.json')).json()).recipes; } catch (e) { console.warn('[craft] recipes unavailable:', e && e.message); }
// S8-B1-10 (docs/architecture.md 38.10c "This story (~0.5 d)"): on device.lost (ignoring our own 'destroyed'
// dispose unless forced) stop stepping the sim, one synchronous autosave through the existing save relay
// (gameHooks.ctx.requestSave -> saveRelay.save, registered above), then a reload card. Logic lives in the pure
// deviceLost.js (Node-testable with a mock device); this is just the DOM/sim/save glue. No-op on webgl2 (device null).
watchDeviceLost(gpuDevice, {
  freeze: () => { deviceLostFrozen = true; },
  canSave: () => !!gameHooks.ctx.state.canSave && !titleMenuActive, // not on the title menu / wake / death: reload loads the last good save
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
  // S8-B2-13b NEEDS B1-main item (2) (from 38.14): window.__kestrel.ripple(x, y, amp) for the owner look - the
  // passWater composite upload that actually draws the rings is another slot's item. Ripples live in the
  // module-scope `ripples` ring buffer (engine/fx/ripples.js), not `world.water` (that field was removed).
  window.__kestrel.ripple = (x, y, amp) => { ripples.add(x, y, amp, fb ? fb.timeSec : 0); };
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
    openedChestsOf: () => (saveRelay ? saveRelay.openedChests : []), reduceMotion: isReduceMotion,
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
if (demo.on) blockFKeys(input); // demo: no F3 / F-key dev overlays
// DEMO-MODE-01: end card once per run on the waystone done event; Restart wipes the demo save and reloads.
const demoEnd = demo.on ? createEndCard({
  onRestart: () => { const a = createStorageAdapter(saveStorage()); for (let i = 0; i < 3; i++) a.deleteSlot(i); window.location.reload(); },
  onKeep: () => {} }) : null;
let waystoneWire = null; // WS1-07b: travel reads its sim (anchors / touch)
if (saveEnabled) gameHooks.register(waystoneWire = createWaystoneWire()); // WAYSTONE-01w: heal + save + toast on touch, respawn at the touched stone (off with ?save=0 / capture / bench)
gameHooks.register(createWaystoneTouch(gameHooks)); // WAYSTONE-TOUCH-01: prop:touched {waystone} on walk-in / E (lane C's WAYSTONE-01w listens)
// WAYSTONE-NORMAL-01 (D-056): the waystone no longer triggers the demo end card (demoEnd stays wired but is never triggered).
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
// S8-B2-12c: `?cloudshadow=1` (default off, WebGPU only; gl2 frozen GLSL ignores the cloud byte) puts a default cloud-shadow
// block into `lights.cloud` after every `buildLightSet` below (replaces the old `?clouds=`/setCloudShadow).
const cloudShadowOn = parseCloudShadowFlag(params.get('cloudshadow'));
// S8-B2-20 NEEDS B1 item (1): `?ao=<0..1>` (default 0). WebGL2 stays 0 (frozen GLSL ignores it, D-044). Applied
// into `lights.ao` after every `buildLightSet` below, same site as the cloud strength above.
const aoStrength = parseAoStrength(params.get('ao'));
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
// (tech notes item 9) - it never throws out here; `wgPipeline.ready` is
// the one thing this file checks afterwards. Kept to this one `if` + one
// `new` + one `.bind()` call - everything else (the hook, the CPU no-op
// guards) lives in engine/render/gpu/ and engine/render/{detailShade,
// edgePass,CellBuffer,RenderTargetGL}.js, none of which is compositor.js/
// world/* (US-025, off-limits this story).
// WG-2a: the WebGPU skeleton pipeline (createRenderer built it) (no scene passes in WG-2a); it draws `?gpudebug=kind|plane|normal|depth` (G-buffer debug view) over the cells.
if (wgPipeline && wgPipeline.ready && rt.backend === 'webgpu') {
  wgPipeline.bind(matTable, assets.palette);
  wgPipeline.setWaterLooks(window.ASSETS.waterLooks); // WG-3e: same designer table as the GL pipeline (US-055a2c)
  const wgDebug = { kind: 0, plane: 1, normal: 2, depth: 3 }[params.get('gpudebug')];
  if (wgDebug !== undefined) wgPipeline.setDebugMode(wgDebug);
  console.log(`[WgCellPipeline] skeleton active (ported passes: ${wgPipeline.portedPasses.join(',')})${wgDebug !== undefined ? ', debug view ' + params.get('gpudebug') : ''}`);
}
// Architect review 1 minor item 4c: name the offending material keys when the detail gate didn't hold.
console.log(`[WgCellPipeline] ${wgPipeline && wgPipeline.ready ? 'active' : 'inactive - JS shading' + (matTable.missingV2 && matTable.missingV2.length ? ` (missingV2: ${matTable.missingV2.join(', ')})` : '')}`);

// ---- US-030c (ARCH CHANGES item 1): sprite system, after the pipeline gate ----
bootMark('sprite system next');
const sprites = createSpriteSystem({ assets, rt, wgPipeline });
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
if (wgPipeline && (wgPipeline.frameComplete || (isGeometryCompare && params.get('refgrid'))) && rt.backend === 'webgpu' && (rt.cols !== gridResult.cols || rt.rows !== gridResult.rows)) {
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
// GPU path's own `wgPipeline.frame()` calls `.project()` on it internally
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
// HAND-WIRE-01: the realistic burning hand (`viewModels.hand`): every variant model (authored left) registered mesh-only.
let handDef = window.ASSETS && window.ASSETS.viewModels && window.ASSETS.viewModels.hand;
// CHARGEN-16: `hand@look` = the hand variants re-tinted to the player look (skin tone + top dye on the sleeve). The newest saved
// look is peeked at boot (a different look chosen later needs a page reload to show: handles are built once). Off in capture/bench/compare
// pages (gpucompare stays on today's hand) and falls back to the plain hand if the retint throws.
let handLookDef = null;
if (handDef && handDef.variants && !isCaptureOrBench && window.__charKit) {
  try {
    let best = null;
    if (saveRelay && saveRelay.adapter) for (const s of saveRelay.adapter.listSlots()) {
      const r = s.ok && s.meta ? saveRelay.adapter.readSlot(s.slot) : null;
      if (r && r.save && r.save.player && r.save.player.look && (!best || (s.meta.savedAt || 0) >= best.t)) best = { t: s.meta.savedAt || 0, look: r.save.player.look };
    }
    const rt = retintHand(handDef, lookOrDefault(window.__charKit, best && best.look), window.__charKit, window.ASSETS.voxelModels);
    for (const [name, rec] of Object.entries(rt.models)) assets.add('model', name, { ...rec, voxel: { ...rec.voxel, meshOnly: true } });
    handLookDef = rt.def;
  } catch (e) { console.warn('[look] hand@look retint failed, plain hand:', e && e.message); }
}
if (handDef && handDef.variants && handLookDef) {
  if (window.ASSETS.handFx) for (const k of window.ASSETS.handFx.attach()) {
    const pr = particlePresets.presets[k];
    if (pr.spreadDeg > 88.9) pr.spreadDeg = 88.9;
    engine.particles.defineEmitter(k, particlePresets.toEmitterDef(k, assets.palette.rgb));
  }
  handDef = handLookDef; // viewModel key 'hand' now loads the @look models (the plain ones are not registered: boot budget)
} else if (handDef && handDef.variants) {
  if (window.ASSETS.handFx) for (const k of window.ASSETS.handFx.attach()) { // HAND-WIRE-02: presets defined after the generic loop
    const pr = particlePresets.presets[k];
    if (pr.spreadDeg > 88.9) pr.spreadDeg = 88.9; // engine EmitterDef limit (<= 88.999); handChargeSparks asks 180 (designer note)
    engine.particles.defineEmitter(k, particlePresets.toEmitterDef(k, assets.palette.rgb));
  }
  for (const mk of Object.values(handDef.variants)) {
    const hd = window.ASSETS.voxelModels[mk];
    if (hd && !assets.has('model', mk)) assets.add('model', mk, { ...hd, voxel: { ...hd.voxel, meshOnly: true } });
  }
}
registerRiggedChars(assets, bundle.models); // RIG-03w: char.<id> from package .glb, before bind
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
const wgActive = !!(wgPipeline && wgPipeline.ready && rt.backend === 'webgpu'); // WG-2b: geometry-only WebGPU pipeline (CPU still shades)
engine.events.on('combat:hit', (p) => { if (p && p.source === 'player') hitStop.trigger(p.heavy ? 'heavy' : 'light'); }); // HITSTOP-01
const hzb = createHzbInvalidator(() => ((occlOpt.enabled || params.get('stable') === '1') && wgActive && wgPipeline.ready ? wgPipeline : null)); // OCCL-MAIN-01 (+ US-073c): cuts invalidate the HZB and the stable-pass history
if (wgActive) { wgPipeline.bindVoxels(gameVoxelPool); wgPipeline.bindViewModel(engine.viewModel); }
engine.attachMaterialTable(matTable); engine.instances.bindPool(gameVoxelPool); // RE-06 (28.6)
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
// HAND-WIRE-01: when the realistic hand asset is loaded it takes this handle (the glove stays the fallback). `spellVmH.vm/.glow` are shared.
const handFxOn = !!(handDef && handDef.variants && assets.has('model', handDef.model));
const handFbExtra = (pool) => { fbView.extra(pool); pushHandFlame(spellVmH, pool); }; // HAND-FIRE-FX-01: one extra callback, created once
const spellVmH = handFxOn ? loadHandFireView(engine.viewModel, handDef, gameVoxelPool) // idle-fire variants prebuilt; charge/cast variants build lazily on first use (boot budget)
  : (window.ASSETS && window.ASSETS.viewModels && window.ASSETS.viewModels.spellHand && spellHandLDef
    ? loadSpellHandView(engine.viewModel, window.ASSETS.viewModels.spellHand, gameVoxelPool) : null);
if (handFxOn) bindHandFx(spellVmH, engine.particles, FIREBALL_CFG.castOffset); // HAND-WIRE-02
if (handFxOn) engine.viewModel.warmVariants(spellVmH.h, [...handDef.cycles.flame.variants, ...handDef.cycles.flameRelax.variants]);

// D-025 (US-038a, architecture.md 22.3/22.7): the ONE `grid:changed`
// listener that rebuilds every game-owned, grid-sized object - the render
// pipeline/sprite pass resize IN PLACE (no shader recompile); `gbuf`/
// `matTable`/`fb`'s fields are small enough to just recreate (`cellAspect`
// can change with the grid); an already-loaded world's structures are
// re-bound against the fresh `matTable`, same as `'world:loaded'` does.
engine.events.on('grid:changed', ({ cols, rows }) => {
  if (sprites.pass) sprites.pass.resizeGrid(cols, rows);
  hzb.invalidate('resize');
  gbuf = new GBuffer(cols, rows);
  matTable = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
  engine.attachMaterialTable(matTable); // RE-06: re-applies engine.teamSpec to the new table
  if (wgActive && wgPipeline.ready) wgPipeline.bind(matTable, assets.palette); // grid resize itself ran inside engine.applyGrid
  if (engine.world) for (const s of engine.world.structures) { if (s.kind === 'mesh') continue; bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }
  if (fb) { fb.depth = engine.depthBuffer; fb.gbuf = gbuf; fb.matTable = matTable; fb.light = makeLightBuffer(cols, rows); }
});

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { input, overlay, rt, engine, gbuf, matTable, ambientL, depthBuffer, sprites, wgPipeline, hzb };
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
  params, assets, rt, overlay, wgPipeline, matTable, gbuf, depthBuffer, detailPass,
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
} else if (params.get('bench') === 'present' || params.get('bench') === '1' || params.get('bench') === 'combat') {
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
} else if (new URLSearchParams(window.location.search).get('demo') === 'scene') { // DEMO-MODE-01: the old US-048 dev scene moved from ?demo=1 to ?demo=scene
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
  // TREES-DEFAULT-01: mesh trees are the default forest; `?trees=voxel` is the dev fallback (design file stays pure data: it carries both species lists)
  { const ft = window.ASSETS.levels.overworld_far.recipe.forest.trees;
    if (params.get('trees') === 'voxel' && ft.speciesVoxel) ft.species = ft.speciesVoxel; }
  const worldLoadOpts = { physics,
    realTrees: renderer === 'mesh' && physics === 'mesh' && params.get('trees') !== '0',
    detail: renderer === 'mesh' && physics === 'mesh' && params.get('scatter') !== '0' }; // ENV-01a2: `?scatter=0` (not `?detail=0`, that is the US-028 v1-shading switch)
  if (params.get('debug') === '1' || params.get('f3') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`; ME-08c `?f3=1` = F3 pass times at start
  // US-020a: arms the (one-shot) first-gesture listeners only - creates
  // nothing yet, so there is no autoplay warning and no sound before input.
  initAudio();
  setVolume(loadSettings().volume); // SETTINGS-MOUNT-01
  setMuted(loadSettings().muted); // US-060: apply the remembered mute before any sound can play

  let simTime = 0;
  let clothTick = 0; // CLOTH-1b3 (33.5): integer fixed-step counter for `w.cloths.tick`/`wind.sampleInto` (rule 15: no wall clock)
  let look = null;
  let playerHandle = null;
  let decalBind = null; // DECAL-01: refreshed on load/restart.
  const entityTintTable = createEntityTintTable(); // TELEGRAPH-WIRE-01 part 2: one table, reused
  let telegraphWire = null; // TELEGRAPH-WIRE-01: rebuilt on 'world:loaded'
  let beastAnim = null; const beastAnimOn = params.get('beastanim') === '1'; // ANIM-STATE-WIRE-01: default OFF (wander/return would use the walk clip)
  let beasts = null; // US-079a (29.1): rebuilt on every 'world:loaded', below
  let vitals = null; // US-080a1/a2 (30.2): rebuilt on every 'world:loaded', below
  let travel = null; // WS1-07b: created once below (after wakeOut)
  let dialogueCtl = null; // DIALOGUE-01b2 (38.28): rebuilt on every 'world:loaded', below
  let wild = null; // WILD-06: ambient fauna, rebuilt on every 'world:loaded' (= reset on load / new game / restart)
  Object.defineProperty(window.__debug, 'wild', { configurable: true, get: () => (wild ? { alive: wild.stats.alive, drawn: wild.drawn ? wild.drawn() : 0 } : null) }); Object.defineProperty(window.__debug, 'wildRaw', { configurable: true, get: () => (wild ? { w: wild, pool: gameVoxelPool } : null) }); // verify-wild steps/feeds through this (headless sim never runs) // WILD-06b: read-only headless hook
  let bearTurn = null; // NPC-BEAR-01: Burl's turn-to-player, rebuilt on every 'world:loaded'
  // COMPASS-02 (D-061): golden pocket compass, bottom-right. Resolver maps quest targets to world positions; hide rules are set in update(), drawn in render().
  const compass = createCompassHud({ style: window.ASSETS && window.ASSETS.uiStyle && window.ASSETS.uiStyle.compass });
  let compassBookVer = -1, compassTick = 0, compassWorld = null, compassBreach = null, compassHide = true;
  const compassResolver = { resolve(kind, id, out) {
    const w = compassWorld; if (!w) return false;
    let e = null;
    if (kind === 'giver') e = w.get(id);
    else if (kind === 'flag') e = id === 'quest.burl.boars.done' ? w.get('bear') : null;   // Burl sets it on hand-in
    else if (kind === 'beast') { e = w.get(id); const h = e && e.data && e.data.components.health; if (h && h.hp <= 0) return false; }
    else if (kind === 'area') {
      if (id === 'breach') { if (!compassBreach) compassBreach = compassFindMarker(w, 'breach'); if (!compassBreach) return false; out.x = compassBreach.x; out.y = compassBreach.y; out.z = compassBreach.z; return true; }
      if (id === 'waystone') e = w.get('endMarker');
    }
    const t = e && e.data && e.data.transform; if (!t) return false;
    out.x = t.x; out.y = t.y; out.z = t.z; return true;
  } };
  window.__debug.compass = compass; window.__debug.compassRetarget = () => { const b = saveRelay && saveRelay.quest.book; return b ? compass.target(b, compassResolver) : null; }; window.__debug.compassHidden = () => compassHide; // tools/verify-compass.mjs
  function compassFindMarker(w, markerId) { // structure marker -> world position (same lookup as audio/ambient.js; load-time-ish, cached)
    const o = { x: 0, y: 0, z: 0 };
    for (const st of w.structures) { const m = st.level && st.level.def && st.level.def.markers && st.level.def.markers[markerId]; if (m) { localToWorld(st.frame, m.x, m.y, m.z || 0, o); return o; } }
    return null;
  }
  const vLocked = () => !!(vitals && vitals.inputLocked) || (travel && travel.inputLocked) || deathFlow.inputLocked || !!(dialogueCtl && dialogueCtl.locked); // DEATH-FLOW-01 part 2: the flow lock gates move/attack/jump/interact like the vitals lock (the virtual [E] bypasses it)
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
  canvas.addEventListener('mousemove', (e) => {
    if (menuHost && menuHost.active && !isSettingsOpen()) { const c = menuCell(e); menuHost.pointer(c[0], c[1], false); }
    else if (pauseMenu && pauseUp()) { const c = menuCell(e); pauseMenu.handlePointer(c[0], c[1], false); }
  });
  window.addEventListener('click', (e) => {
    if ((!menuHost || !menuHost.active) && pauseMenu && pauseUp()) { // PAUSE-MENU-01: a click never re-locks by itself; only the Resume row does
      e.stopPropagation(); const c = menuCell(e); pauseMenu.handlePointer(c[0], c[1], true); return;
    }
    if (!menuHost || !menuHost.active) return;
    e.stopPropagation();
    if (!isSettingsOpen()) { const c = menuCell(e); menuHost.pointer(c[0], c[1], true); }
  }, true);
  blockContextMenu(canvas); // RMB must not open the browser menu over the game canvas (never the window)
  let practiceTarget = null; // US-078d (30.1): rebuilt on every 'world:loaded', below
  let hitSparkWire = null; // HIT-SPARK-WIRE: rebuilt on every 'world:loaded'
  let particleHooks = null; // US-053c: rebuilt on every 'world:loaded', below
  let relayWake = null; // WS1-06b: rebuilt on every 'world:loaded'
  let loot = null; // US-091a2 (37.16.3): rebuilt on every 'world:loaded', after beasts + the pack
  let toasts = null; // US-091a2: the loot toast view, rebuilt with loot
  let invView = null; // US-091b: the pack screen (`I`), rebuilt with the pack
  let craftView = null, craftWasLocked = false; // MAIN-WIRE-01: crafting list (`C`), rebuilt with the pack
  let creditsInv = null; // CREDITS-MOUNT-01
  let menuHost = null; // US-090w: title menu host while it is up (null = no menu / already closed)
  let pauseMenu = null; // PAUSE-MENU-01: built once with the world, shown while the pointer is unlocked in play
  let pauseWas = false;
  // True while the pause menu is the thing on screen (same gate the old overlay used, minus Settings which owns the screen).
  function pauseUp() {
    return mode === 'world' && !!look && !look.locked && !isMapOpen() && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen()
      && !cinematic && !isWaterfallPreview && !(menuHost && menuHost.active) && !isSettingsOpen();
  }
  // QG-05: quest log (J). Built lazily per book (reset() replaces the book); pauses like the pack via qlOpen in invOpen.
  let qlView = null, qlBook = null, qlWasLocked = false, mapQmChart = null, mapQmVer = -1;
  const qlIsOpen = () => !!(qlView && qlView.isOpen());
  // QG-04: giver '!'/'?' on the M card, rebuilt only when the card is open and book.version / the chart changed
  function syncMapQuestMarks() {
    const c = getMapChart(), b = saveRelay && saveRelay.quest.book;
    if (!c || !b || !isMapOpen() || (c === mapQmChart && b.version === mapQmVer)) return;
    mapQmChart = c; mapQmVer = b.version;
    const a = [], r = [], list = []; b.giverMarks(a, r);
    for (const [ids, kind] of [[a, 'quest'], [r, 'questReady']]) for (const id of ids) {
      const e = engine.world.get(id), t = e && e.data && e.data.transform; if (t) list.push({ kind, x: t.x, y: t.y });
    }
    c.setQuestMarkers(list);
  }
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
  // WS1-07b: map travel. Callbacks read the live per-world closures; no world state is kept here.
  travel = createTravel({
    canTravel: () => !!(vitals && !vitals.dead && !wakeOut.inputLocked && !(dialogueCtl && dialogueCtl.open) && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen()),
    anchorOf: (id) => (waystoneWire && waystoneWire.sim ? waystoneWire.sim.anchor(id) : null),
    playerPos: () => playerHandle.data.transform,
    teleport: (pose) => {
      const t = playerHandle.data.transform, b = playerHandle.data.components.body;
      t.x = pose.x; t.y = pose.y; t.z = pose.z; t.yawDeg = pose.yawDeg; // anchor = a known-safe spot (the pose at the touch)
      if (b) { b.vx = 0; b.vy = 0; b.vz = 0; b.fallDistance = 0; }
      hzb.invalidate('travel');
      if (beasts) beasts.resetAll();
      if (targeting) targeting.clear();
      if (look) { look.clearLock(); look.yawDeg = t.yawDeg; look.pitchDeg = t.pitchDeg; }
      if (vitals) vitals.clearSafe();
    },
    arrive: (id, pose) => { if (waystoneWire && waystoneWire.sim) waystoneWire.sim.touch(id, pose); }, // respawn point = target (heal + save)
  });
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
        if (lightSet && cloudShadowOn) lightSet.cloud = devCloudShadow(); // S8-B2-12c
        if (lightSet && aoStrength > 0) lightSet.ao = { ...AO_DEFAULTS, strength: aoStrength }; // S8-B2-20 NEEDS B1 item (1)
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
      if (hitSparkWire) hitSparkWire.dispose();
      hitSparkWire = wireHitSparks(engine.events, engine.particles, () => (playerHandle && playerHandle.transform), hitSparksEnabled(params, isCaptureOrBench)); // HIT-SPARK-WIRE
      particleHooks = createParticleHooks(world, engine.events, engine.particles, particlePresets, engine.physics.gravity);
      if (waterfallHooks) waterfallHooks.dispose();
      waterfallHooks = waterfallPreset ? createWaterfallHooks(world, engine.particles, waterfallPreset) : null;
      if (ambientMotes) ambientMotes.dispose();
      // S8-B1-18 (closes US-019): ambient dust motes, off with ?ambient=0 and on the Low preset.
      ambientMotes = createAmbientMotes(world, engine.particles, { enabled: params.get('ambient') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !(resolvedQuality && resolvedQuality.name === 'low'), rgb: assets.palette.rgb, palette: assets.palette });
      // US-079a (29.1): rebuilt on every load/restart, same precedent as lightSet above.
      // US-078d: beastSim now owns a `combat:hit` listener (the stagger behaviour) - drop the old world's one
      // before creating the next, same "dispose before re-create" precedent as targeting/vitals below.
      wild = null; engine.feedVoxels = null; // WILD-06: off in capture/bench/compare/cinematic, `?at=`/`?pose=` dev poses and `?fauna=0`
      if (mode === 'world' && !cinematic && params.get('fauna') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !params.has('at') && !params.has('pose')) {
        try { wild = createWild({ world, pool: gameVoxelPool, fx: window.ASSETS.wildlifeFx, seed: 0x5EED }); if (wild) engine.feedVoxels = wild.feed; } catch (err) { console.warn('[wild] fauna off:', err && err.message); }
      }
      if (beasts) beasts.dispose();
      if (params.get('bench') === 'combat' || (benchActive && params.get('enemies') === '4')) ensureBenchBoars(world); // COMBAT-BENCH-01
      beasts = createBeastSim(world, { nav: worldDef.nav && buildBeastNav(world, worldDef.nav), rng: createRng(worldDef.nav?.seed ?? 1), events: engine.events });
      if (telegraphWire) telegraphWire.dispose(); // TELEGRAPH-WIRE-01 part 1
      telegraphWire = wireTelegraphs(engine.events, world, beasts, telegraphsEnabled(params, isCaptureOrBench));
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
      hurtFx.reset();
      vitals = createVitals(world, engine.events, VITALS_DEFAULTS, { beasts, targeting,
        respawnPose: () => { hzb.invalidate('respawn'); return gameHooks.respawn(); }, // seam onRespawn(): first non-null {x,y,z,yawDeg} wins
        onDied: (t) => { gameHooks.emitSimple('player:died', t.x, t.y, t.z); deathFlow.died(performance.now()); },
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
      // WS1-06b: one [E] interactable per kind:'relay' point (crystal-gated wake; woken ones restore awake from world.state).
      relayWake = createRelayWake({ world, palette: assets.palette, emit: (id, kind, p) => gameHooks.emitSimple('prop:touched', id, kind, p) });
      setRelayWakeApi(relayWake); window.__debug.relayWake = relayWake; // tools/verify-relay-wake.mjs
      // DIALOGUE-01b2 (38.28): box + runner; NPCs with a `dialogue` component get an [E] Talk interactable (none until NPC-BEAR-01 places one).
      if (dialogueCtl) dialogueCtl.dispose();
      dialogueCtl = createDialogueCtl({ world, dialogues: bundle.dialogues, events: engine.events, style: window.ASSETS.uiStyle.dialogue,
        jawOpenDeg: window.ASSETS.bearFx && window.ASSETS.bearFx.talk ? window.ASSETS.bearFx.talk.jawMaxDeg : undefined, // jaw hinge: rx opens, 0..jawMaxDeg (voxel_bear.js header)
        book: () => (saveRelay ? saveRelay.quest.book : null), // QG-03: `q.*` dialogue keys -> quest book
        onFlag: (k, v) => { if (k.charCodeAt(0) !== 113 || k.charCodeAt(1) !== 46) gameHooks.emitSimple('flag:set', 'dlg.' + k, v); } });
      setDialogueApi(dialogueCtl);
      bearTurn = createNpcTurn(world, 'bear'); // NPC-BEAR-01: null when the world has no bear
      compassWorld = world; compassBreach = null; compassBookVer = -1; compassTick = 0; // COMPASS-02: re-resolve against the new world
      if (bearTurn) dialogueCtl.addNpc('bear');
      if (toasts) toasts.dispose();
      toasts = itemDefs ? createToastView(engine.events, window.ASSETS.items.toast, itemDefs, assets.palette.rgb) : null;
      if (saveRelay) { // QG-03: book events -> seam + toasts (the reward, if any, is granted from book.lastReward; Burl's quest has none - owner pick)
        const tv = toasts, msg = window.ASSETS.items.toast && window.ASSETS.items.toast.messages && window.ASSETS.items.toast.messages.packFull;
        saveRelay.quest.book.onChange = (name, id) => {
          gameHooks.emitSimple(name, id);
          if (tv && msg) { if (name === 'quest:accepted') tv.say('Quest accepted', msg.fg); else if (name === 'quest:done') tv.say('Quest complete', msg.fg); }
        };
      }
      if (invView && invView.isOpen) invView.close();
      invView = itemDefs && window.ASSETS.uiStyle.inventory ? createInventoryView({
        style: window.ASSETS.uiStyle.inventory, items: window.ASSETS.items, rgb: assets.palette.rgb, toast: toasts,
        inventoryOf: () => (playerHandle && playerHandle.data.components.inventory) || null,
        healthOf: () => (playerHandle && playerHandle.data.components.health) || null,
        onHandsChanged: () => { if (hands && playerHandle) hands.step(playerHandle.data, false, false, false); }, // router sees the change now (cancel + setHand + hands:changed)
        onOpen: () => { invWasLocked = !!(look && look.locked); if (invWasLocked && document.exitPointerLock) document.exitPointerLock(); },
        onClose: () => { if (invWasLocked) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* click to resume */ } } },
      }) : null;
      if (craftView && craftView.isOpen) craftView.close();
      // owner 2026-10-09: "leave the crafting for now" - the C list is off unless ?craft=1 (module + tests stay)
      craftView = params.get('craft') === '1' && itemDefs && recipeList && window.ASSETS.uiStyle.inventory ? createCraftView({
        crafting: createCrafting(recipeList, { items: itemDefs }), recipes: recipeList, defs: itemDefs, rgb: window.ASSETS.uiStyle.inventory.rgb || assets.palette.rgb, toast: toasts,
        inventoryOf: () => (playerHandle && playerHandle.data.components.inventory) || null,
        onOpen: () => { craftWasLocked = !!(look && look.locked); if (craftWasLocked && document.exitPointerLock) document.exitPointerLock(); },
        onClose: () => { if (craftWasLocked) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* click to resume */ } } },
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
      hzb.invalidate('world-load'); // new world / restart / title New+Continue / ?at / ?pose: the start pose is a camera cut
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
      markWorld = world;
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
          chartOptions = { chart: chartData, markers, fog: mapFogHook ? mapFogHook.fog : null, travel: !waystoneWire ? null : { list: () => { const ws = waystoneWire.sim; if (!ws) return []; const l = []; const n = ws.list(l); const out = []; for (let i = 0; i < n; i++) out.push({ id: l[i].id, name: l[i].label, order: l[i].order, touched: l[i].touched, woken: true, x: l[i].x, y: l[i].y }); return out; } } };
        }
        try {
          initMapCard(assets, ui.cols, ui.rows, chartOptions);
          { const cv = getMapChart(); if (cv) cv.onTravel = (id) => travel.request(id); } // WS1-07b
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
      window.__debug.isMapOpen = isMapOpen; window.__debug.getMapPanel = getMapPanel; window.__debug.getMapChart = getMapChart; window.__debug.questBook = () => (saveRelay ? saveRelay.quest.book : null); window.__debug.questLogOpen = qlIsOpen; window.__debug.gameHooks = gameHooks; window.__debug.travel = travel; window.__debug.travelTo = (id) => travel.request(id, true); window.__debug.waystoneSim = () => (waystoneWire ? waystoneWire.sim : null); // QG-04/05: tools/verify-quest-ui.mjs hooks
      // S8-B1-15: test hook (tools/verify-map-wire.mjs)
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
    const makeMenuHost = () => createTitleMenuHost({
        adapter: createStorageAdapter(saveStorage()),
        style: window.ASSETS && window.ASSETS.uiStyle ? window.ASSETS.uiStyle.menu : null,
        onNewGame: (slot, chosenLook) => { if (saveRelay) { saveRelay.setSlot(slot); if (chosenLook) saveRelay.look = chosenLook; } }, // CHARGEN-17: Confirm stores player.look in the new save
        // CHARGEN-17 parked (owner 2026-10-10: "i dont want character creation in the beggining"): New game starts straight away.
        // createCharCreate is not passed, so titleMenuHost keeps its old behaviour; game/js/ui/charCreate.js stays in the repo unused.
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
        // CREDITS-MOUNT-01: licence inventory is fetched lazily on first open (menu only, never in capture/bench paths)
        createCredits: () => creditsInv && window.ASSETS?.uiStyle?.menu ? createCreditsView(creditsInv, { style: window.ASSETS.uiStyle.menu }) : null,
      });
    // PAUSE-MENU-01 (D-053): Resume / Settings / Save / Load / Back to main menu, in the title menu's skin.
    const relockPointer = () => { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* arrow-key fallback */ } };
    if (!cinematic && mode === 'world') pauseMenu = createPauseMenu({
      adapter: (saveRelay && saveRelay.adapter) || { listSlots: () => [], readSlot: () => ({ ok: true, save: null }) },
      style: window.ASSETS && window.ASSETS.uiStyle ? window.ASSETS.uiStyle.menu : null,
      onResume: relockPointer,
      onSettings: () => openSettings({ assets, engine, look }),
      onSave: () => !!(saveRelay && saveRelay.enabled && gameHooks.ctx.world && (gameHooks.ctx.requestSave(), saveRelay.lastResult && saveRelay.lastResult.op === 'save' && saveRelay.lastResult.ok)), // same path as the waystone save
      onLoad: (slot) => {
        if (!saveRelay) return;
        saveRelay.setSlot(slot);
        const w = saveRelay.load(assets, worldLoadOpts, true);
        if (!w) { console.warn('[save] load failed:', saveRelay.lastResult && saveRelay.lastResult.error); return; }
        try { engine.setWorld(w); } catch (err) { console.warn('[save] restore failed:', err && err.message); guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts))); return; }
        pauseMenu.reset(); relockPointer();
      },
      onMainMenu: () => { // fresh world behind the title menu, same as a first boot
        guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts)));
        if (menuWanted) { menuHost = makeMenuHost(); window.__debug.menuHost = menuHost; }
        pauseMenu.reset();
      },
      isDirty: () => !!(saveRelay && saveRelay.enabled && saveRelay.dirty),
    });
    if (menuWanted && !cinematic) {
      menuHost = makeMenuHost();
      fetch('../docs/licence-inventory.json').then((r) => r.json()).then((j) => { creditsInv = j; }).catch(() => {});
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
    if (demoEnd) demoEnd.step((c) => input.pressed(c));
    if (input.pressed(gameKeys.mute)) { toggleMute(); saveSettings({ muted: isMuted() }); } // US-060: remember across reload
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
    if (dialogueCtl && mode === 'world' && playerHandle && !ending) dialogueCtl.step(dt, input, look ? look.locked : undefined); // DIALOGUE-01b2: early, so the lock covers the closing key press
    if (invView && mode === 'world' && playerHandle) {
      invView.step(dt, input, !ending && !(craftView && craftView.isOpen) && !isMapOpen() && !isSettingsOpen() && !isNoteOpen() && !!look
        && !(vitals && (vitals.dead || vLocked())) && !(questUiActive && wakeOut.inputLocked));
    }
    const invOpen0 = !!(invView && invView.isOpen);
    if (craftView && mode === 'world' && playerHandle) { // MAIN-WIRE-01: C opens the crafting list anywhere (no workbench in the spec); same lock gate as the pack
      if (!craftView.isOpen && !invOpen0 && input.pressed('KeyC') && !ending && !isMapOpen() && !isSettingsOpen() && !isNoteOpen() && !!look
        && !(vitals && (vitals.dead || vLocked())) && !(questUiActive && wakeOut.inputLocked)) { craftView.open(); if (input.consumePressed) input.consumePressed(); }
      else craftView.step(dt, input);
    }
    if (chestHook && mode === 'world' && playerHandle) chestHook.stepUi(dt, input.pressed(gameKeys.interact)); // S8-B1-04: steps while paused too (an open card pauses the sim)
    if (mode === 'world' && playerHandle && saveRelay) { // QG-05: J toggles the quest log; while open it owns its keys
      if (qlIsOpen()) {
        for (const code of QUEST_LOG_KEYS) if (input.pressed(code) && qlView.handleKey(code)) { input.consumePressed(); break; }
        if (!qlIsOpen() && qlWasLocked && look && !look.locked) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* arrow-key fallback */ } }
      } else if (gameKeys.questLog && input.pressed(gameKeys.questLog) && !invOpen0 && !ending && !isMapOpen() && !isSettingsOpen() && !isNoteOpen() && !!look && look.locked
        && !(vitals && (vitals.dead || vLocked())) && !(questUiActive && wakeOut.inputLocked) && !(dialogueCtl && dialogueCtl.open)) {
        const bk = saveRelay.quest.book;
        if (!qlView || qlBook !== bk) { qlBook = bk; qlView = createQuestLogScreen(bk, { style: window.ASSETS.uiStyle && window.ASSETS.uiStyle.menu }); }
        qlWasLocked = look.locked; qlView.open(); input.consumePressed();
      }
    }
    syncMapQuestMarks();
    const invOpen = !!(invView && invView.isOpen) || !!(craftView && craftView.isOpen) || qlIsOpen(); // MAIN-WIRE-01: craft list locks input / pauses like the pack
    const cardOpen = !!(chestHook && chestHook.card.isOpen); // S8-B1-04: item-get card gates input same as invOpen
    // ---- US-015: wake timeline + map card (world_m1 only, questUiActive) ----
    let uiLocked = false;
    let mPressedEdge = false;
    if (mode === 'world' && playerHandle && questUiActive && !ending) {
      engine.world.state['quest.wakeT'] += dt;
      wakeFrame(engine.world.state['quest.wakeT'], wakeCfg, wakeOut);
      if (wakeOut.inputLocked) playerHandle.data.components.body.eyeH = wakeOut.eyeH;
      mPressedEdge = input.pressed(gameKeys.map);
      if (travel) travel.step(dt);
      stepMapCard(engine.world, assets, dt, input, engine.world.state['quest.wakeT'], wakeOut.titleDoneAtSec, !!(look && look.locked)); // BUG-NOTE-ESC-01
      uiLocked = wakeOut.inputLocked || isMapOpen() || isSettingsOpen() || isNoteOpen() || invOpen || cardOpen || vLocked();
    }
    // US-038b: settings panel (S from pause, or its own entry point)
    // canOpen requires the pause overlay to actually be up (!look.locked) -
    // S is also WASD "move backward", so this must never trigger in play.
    // PAUSE-MENU-01: the pause menu owns W/S/Enter while it is up (S no longer opens Settings; the Settings row does).
    if (pauseMenu) {
      const up = pauseUp();
      if (up && !pauseWas) pauseMenu.reset();
      pauseWas = up;
      if (up) { for (const code of PAUSE_KEYS) if (input.pressed(code) && pauseMenu.handleKey(code)) { input.consumePressed(); break; } }
    }
    updateSettings(dt, input, { assets, engine, look, canOpen: false });
    uiLocked = uiLocked || isMapOpen() || isSettingsOpen() || isNoteOpen() || invOpen || cardOpen || vLocked();
    titleMenuActive = !!(menuHost && menuHost.active);
    const paused = deviceLostFrozen || (mode === 'world' && !isCaptureOrBench && (isPaused({ ending, look, isMapOpen }) || ((invOpen || cardOpen) && !ending)));
    { // COMPASS-02 (D-061): retarget on book change + ~2 Hz, step the needle, hide rule (menus/pack/log/map/dialogue/death/title/capture modes/ending)
      const bk = saveRelay && saveRelay.quest.book;
      compassHide = !(mode === 'world' && playerHandle && bk && questUiActive) || ending || paused || isCaptureOrBench || uiLocked || titleMenuActive || isSettingsOpen() || isNoteOpen()
        || (dialogueCtl && dialogueCtl.open) || (vitals && vitals.dead) || deathFlow.active || (wakeOut && wakeOut.inputLocked);
      if (bk && (bk.version !== compassBookVer || ++compassTick >= 30)) { compassBookVer = bk.version; compassTick = 0; compass.target(bk, compassResolver); }
      if (playerHandle && look) { const pt = playerHandle.data.transform; compass.step(pt.x, pt.y, look.yawDeg, pt.z); }
    }

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
      if (ending || uiLocked || vLocked()) {
        controls.forward = 0; controls.strafe = 0; controls.run = false; controls.jump = false;
      } else {
        controls.forward = (input.isDown(gameKeys.forward) ? 1 : 0) - (input.isDown(gameKeys.backward) ? 1 : 0);
        controls.strafe = (input.isDown(gameKeys.right) ? 1 : 0) - (input.isDown(gameKeys.left) ? 1 : 0);
        controls.run = input.isDown(gameKeys.run) || input.isDown(gameKeys.run2);
        // US-009: a HELD level, OR'd with the edge (`pressed`) so a Space tap
        // that starts and ends within one frame - between two fixed-step
        // updates - is never lost (integrate() does its own edge detection on
        // top of this, architecture.md section 5 `Controls` typedef).
        controls.jump = input.isDown(gameKeys.jump) || input.pressed(gameKeys.jump);
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
      const simDue = hitStop.due(1000 / 60); // HITSTOP-01: the window gates beasts.step only; the sword freezes by its own hitStopHard counter
      if (beasts && simDue) { const pt = playerHandle.data.transform; beasts.step(pt.x, pt.y, pt.z); }
      if (wild) { const pt = playerHandle.data.transform; wild.step(dt, pt.x, pt.y, controls.run, look.yawDeg); } // WILD-06: ambient only, never hashed
      if (bearTurn) { const pt = playerHandle.data.transform; bearTurn.step(dt, pt.x, pt.y, !!(dialogueCtl && dialogueCtl.open)); } // NPC-BEAR-01 // US-079a (29.1)
      if (beasts && assets.uiStyle) stepCombatHint(engine.world, assets.uiStyle, beasts); // COMBAT-HINT-01: once-per-save first-fight hint (taken from lane C)
      if (telegraphWire) telegraphWire.step(performance.now());
      // US-078d (30.1 + D-034 amendment): the sword steps after beasts.step, so a heavy-hit stagger acts from the
      // beast's NEXT step (deterministic, synchronous emit). `attackDown` is the amendment's exact gate expression.
      if (hands) {
        // HANDS-01b (37.8a): the router turns LMB/RMB + the gate into one `down` per item; every item sim is stepped
        // every step (down = false when it is in no hand).
        if (!uiLocked && !paused && !ending && !vLocked() && input.pressed(gameKeys.swapHands)) hands.swap(); // swap the two hands (owner 2026-10-07: no ?debug=1 needed; not while a menu/pause/death card is up)
        const gateOpen = look.locked && !uiLocked && !ending && !paused && !vLocked();
        hands.step(playerHandle.data, input.isDown(gameKeys.useLeft) || input.pressed(gameKeys.useLeft), input.isDown(gameKeys.useRight) || input.pressed(gameKeys.useRight), gateOpen);
        if (fireball) { // SPELL-01a: aim = unit 3D look vector (pitch > 0 = up); trig stays here, outside sim/
          forwardOf(look.yawDeg, swordFwd);
          const pr = look.pitchDeg * DEG2RAD, cp = Math.cos(pr);
          fireball.step(playerHandle.data, hands.downOf('spell.fireball'), swordFwd[0], swordFwd[1], swordFwd[0] * cp, swordFwd[1] * cp, Math.sin(pr));
          if (fbView) fbView.stepFx(); // SPELL-01b: trail emitters + burst particles (sim side, hashed)
          if (handFxOn && spellVmH && !cinematic) { // HAND-WIRE-02: hand embers / ignite / charge sparks, sim side
            const hp = playerHandle.data.transform, hb = playerHandle.data.components.body;
            stepHandFx(spellVmH, hands.handOf(SPELL_HAND_ITEM), fireball, hp.x, hp.y, hp.z + (hb && hb.eyeH ? hb.eyeH : 1.6), swordFwd[0], swordFwd[1], swordFwd[0] * cp, swordFwd[1] * cp, Math.sin(pr));
          }
        }
      }
      if (sword) { // runs every step: inputs inside the hit-stop window are not lost
        forwardOf(look.yawDeg, swordFwd);
        sword.step(playerHandle.data, swordFwd[0], swordFwd[1], hands ? hands.downOf('sword') : false);
      }
      if (practiceTarget) practiceTarget.step();
      if (vitals) {
        const wasDead = vitals.dead;
        vitals.step(playerHandle.data, input.pressed(gameKeys.interact) || (deathFlow.active && deathRespawnDue)); // US-080a1 (30.2); DEATH-FLOW-01: fade end = virtual [E]
        if (wasDead && !vitals.dead) { deathRespawnDue = false; deathFlow.respawned(performance.now()); }
        deathFlow.step(performance.now());
        hurtFx.step(1000 / 60, vitals.hp, !vitals.dead); // HURT-FX-01
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
      if (ambientMotes) { const pt = playerHandle.data.transform; ambientMotes.step(pt.x, pt.y, pt.z); } // S8-B1-18: position lives on .transform
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
      updateInteraction(engine.world, engine, Camera.fromEntityInto(playerHandle.data, undefined, interactEye, pitchClampDeg), !ending && !uiLocked && input.pressed(gameKeys.interact));
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
      if (relayWake) relayWake.step(dt, lightSet); // WS1-06b: relay wake timer / light grow (no-op while all relays are dead)
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
        hintSignals.jump = input.pressed(gameKeys.jump);
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
      const ePressed = input.pressed(gameKeys.interact);
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
    waterLooks: resolveWaterLooks(window.ASSETS.waterLooks), // US-055a2c (Q12 item 8): JS twin, same table as wgPipeline.setWaterLooks
    ripples, // S8-B2-13b NEEDS B1-main (38.14): duck-typed {packInto} read by waterComposite.js; owned by the module-scope singleton above
    // US-030a: true once a ready GPU pipeline owns casting - `renderWorld`
    // (compositor.js) reads this and skips its whole CPU sequence; kept in
    // sync with `wgPipeline`/`rt.gpuActive` right below `mode === 'world'`.
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
    // (compositor.js reads this; the GPU side is `wgPipeline.terrainEnabled`).
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
      cam.x = eye.x; cam.y = eye.y; cam.z = eyeZ(eye.z, playerHandle.data.components.body, PHYSICS); cam.yawDeg = eye.yawDeg; // SETTINGS-APPLY-01: reduce motion drops head bob
      cam.pitchDeg = eye.pitchDeg + gateKick((vitals ? kickDeg(vitals, simTime) : 0) + (fbView ? fbView.kickDeg() : 0)); // US-080a2 (30.2): hurt pitch kick + SPELL-01b blast kick, render eye only - never written into `look`
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
          if (handFxOn) setHandFlame(spellVmH, true, cam, simTime); // HAND-FIRE-WRAP-01: flames wrapped round the drawn hand's mounts
        } else { fbView.presentEmber(false, 1, 0, 0, 0); if (handFxOn) setHandFlame(spellVmH, false, cam, simTime); }
      }
      // US-006: carried-light sync (US-012's lantern, `components.light`)
      // then flicker/vis-grid update, once per rendered frame, BEFORE either
      // the CPU (`renderWorld`) or GPU (`wgPipeline.frame`) path reads
      // `fb.lights` - the GPU path never calls into compositor.js's own
      // (CPU-only) lighting hook, so this must run here, not there.
      if (fb.lights) {
        syncEntityLights(fb.lights, engine.world, assets.palette, attachedLightPos, lightSyncPos);
        if (fb.lights.emissive) gameVoxelPool.offerEmissive(fb.lights, cam); // EMIS-01b: derived slots from last frame's voxel queue, before update() builds their vis
        fb.lights.update(fb.timeSec, engine.world);
      }
      lap(SEC.lights);
      // With a WebGPU pipeline owning the frame, `renderWorld` (compositor.js) is a no-op; `rt.gpuActive` guards a lost device.
      fb.gpu = wgActive && wgPipeline.frameComplete && rt.gpuActive; // WG-3f: WebGPU owns the frame once shadow+water+sprites+overlay are wired
      // US-041a (15.3 item 1): `collect(world, cam)` every frame (cheap - the
      // entity ref list is cached by `world.renderVersion`, only distance is
      // recomputed); the GPU path projects internally, the CPU/JS oracle
      // needs its own explicit `.project()` before `renderWorld` reads
      // `fb.voxelPool.list` (compositor.js).
      gameVoxelPool.collect(engine.world, cam);
      if (telegraphWire && beasts) { fillEntityTints(entityTintTable, beasts.entities, gameVoxelPool, performance.now()); fb.entityTints = entityTintTable; } else if (fb.entityTints) fb.entityTints = undefined; // TELEGRAPH-WIRE-01 part 2
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
      sprites.render(fb, engine.world, cam, fbView ? (handFxOn ? handFbExtra : fbView.extra) : undefined); // US-030c (ARCH CHANGES item 1): after the surfaces, before present()
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
      if (beasts && !cinematic) presentBeasts(beasts, engine.world, engine.overlay, ovlStyles, beastAnimOn ? (beastAnim || (beastAnim = createBeastAnim(16))) : undefined);
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
        (handFxOn ? presentHandFire : presentSpellHand)(spellVmH, hands && !cinematic ? hands.handOf(SPELL_HAND_ITEM) : null, simTime, simTime, spellMoving, fireball);
      }
      // RE-07a (28.9): CPU overlay composite after the fade (no-op without recorded ops; GPU twin = RE-07b).
      if (fb.gpu) engine.overlay.flush(cam); // RE-07b: GPU path rasterises here, GpuOverlayPass composites in present()
      else if (engine.overlay.stats.ops) engine.overlay.renderCpu(cam, fb.rt.cells, fb.depth.depth);
      lap(SEC.world);
      const ending = typeof engine.world.state['quest.endT'] === 'number' && engine.world.state['quest.endT'] >= 0;
      const uiLockedNow = questUiActive && !ending && (wakeOut.inputLocked || isMapOpen() || vLocked());
      // US-015 (docs/architecture.md 7.6 item 3): map-card / hint scene dim.
      // Reset every frame (so a leftover dim never bleeds into the ending
      // screen or a non-quest world), pushed only while active. CPU path
      // (`applySceneDim`) and GPU path (`sprites.pass.setSceneDim`, read by
      // `sprites.frag.js`'s `uDim*` uniforms inside `rt.present()` below)
      // both read the same `sceneDim` object, same precedent as `fadeLut`/
      // `fb.sceneFade` just above.
      resetSceneDim(sceneDim);
      if (invView) invView.pushDim(sceneDim); // US-091b
      if (craftView) craftView.pushDim(sceneDim); // MAIN-WIRE-01
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
        if ((!isCaptureOrBench || params.get('save') === '1') && !wakeOut.inputLocked) { gameHooks.drawHud(ui); if (relayWake) relayWake.drawHud(ui); } // D-050 seam: today the quest relay's TEMPORARY objective line, top-left
        drawHints(ui, assets.uiStyle, fadeLut);
        // 17.4: an eyelid over the 3D view, not UI text. BUG-WEBGPU-EYELID-01: once the WebGPU frame is complete its presenter shows the sprite-pass
        // output, so CPU scene-cell writes never appear -> draw the lid on the UI layer there (an opaque full-row overlay); else in the scene grid.
        if (!(menuHost && menuHost.active)) drawEyelid(wgActive && wgPipeline.frameComplete ? ui : rt, assets.uiStyle, wakeOut.blinkOpen);
        drawTitleCard(ui, fb.timeSec * 1000, wakeOut.titleA, wakeOut.titleState, fadeLut);
        // S8-B1-15: the map card's own draw seam (mapCard.js:drawMapCard), not the generic drawUiPanel - it gives
        // blank (unexplored fog) cells an opaque black backing so they never show the scene through (ARCH note,
        // docs/lanes/pc-c.md batch 16); the fog itself is fed by mapFogHook.js (S8-B1-16).
        drawMapCard(ui, fb.timeSec * 1000, fadeLut);
        if (travel) travel.draw(ui, ui.cols, ui.rows); // WS1-07b: fade over the world + card, under the later HUD
        // US-080a2/080b (30.2): HP+MP HUD + hurt edge - hidden on title/map/end/death cards (visibleRule, uiStyle.vitals).
        if (vitals) {
          // Q9 item 2c: hidden on the title (wakeOut.inputLocked covers the wake/title timeline) and map cards too,
          // not just while dead - the end card is already covered by the `!ending` gate around this whole block.
          drawVitals(ui, engine.world, assets.uiStyle.vitals, fb.timeSec, !vitals.dead && !wakeOut.inputLocked && !isMapOpen(), vitals);
          drawHurtEdge(ui, vitals, fb.timeSec, assets.uiStyle.vitals, isReduceMotion());
          hurtFx.draw(ui); // HURT-FX-01
          deathFlow.draw(ui, ui.cols, ui.rows); // DEATH-FLOW-01
          presentPickups(engine.world, assets.pickupStyle, fb.timeSec); // US-080b
          compass.setHidden(compassHide); compass.draw(ui, ui.cols, ui.rows, fb.timeSec); // COMPASS-02 (D-061)
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
      if (dialogueCtl) dialogueCtl.draw(ui, fb.timeSec); // DIALOGUE-01b2
      if (invView) invView.draw(ui); // US-091b: the pack screen, over HUD + toast
      if (craftView) craftView.draw(ui); // MAIN-WIRE-01
      if (qlIsOpen()) qlView.draw(ui); // QG-05
      // US-080a1/a2 (30.2): death fade (CPU path, same gating as the end-card
      // scene fade above) + the death card (typed line + "[E] Wake again").
      if (vitals && vitals.dead && !deathFlow.active) { // DEATH-FLOW-01 part 2: the flow replaces the old fade+card (old path stays when the flow is off)
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
    if (demo.on && menuHost && menuHost.active && !isSettingsOpen()) drawDemoBuildLine(ui);
    if (demoEnd) demoEnd.draw(ui);
    if (pauseMenu && pauseUp()) { // PAUSE-MENU-01: dim the scene like the Settings view, then the card (title menu skin)
      const sm = assets.uiStyle.menu; if (sm) dimSceneRect(rt, ui, 0, 0, ui.cols, ui.rows, sm.sceneDim.bgMul);
      pauseMenu.draw(ui);
    }
    // US-038b: settings panel, drawn over the pause overlay when open
    if (!cinematic && !isWaterfallPreview) drawSettingsPanel(ui, rt, assets, { showEntry: false });
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
    if (mode === 'world' && cam) hzb.trackPose(cam.x, cam.y, cam.z); // waystone / save-load / unannounced pose jumps
    if (wgActive && wgPipeline.ready) wgPipeline.frame(fb, (mode === 'world' && fb.lights) || ambientL, mode === 'world' ? cam : null, mode === 'world' ? engine.world : null);
    lap(SEC.gpuFrame);
    rt.present();
    lap(SEC.present);
    if (autoBench && autoBench.phase !== 'done') { const t = performance.now(); lastFrameDt = lastFrameT ? t - lastFrameT : NaN; lastFrameT = t; autoBench.tick(); } // GFX-02
    // US-018 (architecture.md 16): "do not leave pass timing on when the
    // overlay is hidden and no bench runs" - a plain boolean set, cheap
    // enough to do unconditionally every frame.
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
        `\npath: ${rt.gpuActive ? 'gpu' : 'cpu'}  grid: ${rt.cols}x${rt.rows}  rays: ${engine.rays}${occlOpt.enabled && wgActive ? '  occl on (' + hzb.count + ' cuts)  occl cull ' + (wgPipeline.stats ? (wgPipeline.stats.culledOccl || 0) : 0) : ''}` +
        (rt.stats ? `\nGPU present p50 ${Number.isNaN(rt.stats.gpuMsP50) ? 'n/a' : rt.stats.gpuMsP50.toFixed(2) + 'ms'}  p95 ${Number.isNaN(rt.stats.gpuMsP95) ? 'n/a' : rt.stats.gpuMsP95.toFixed(2) + 'ms'}` : '') +
        (mode === 'world' ? `\n${sprites.overlayLine()}` : ''); // US-030c (ARCH CHANGES item 1)
      // US-018: JS split (sim/render) from `loop.stats`.
      extra += `\njs sim ${engine.loop.stats.simMs.toFixed(2)}ms  render ${engine.loop.stats.renderMs.toFixed(2)}ms` +
        // D-025 (US-038a, architecture.md 22.6): last live grid-switch cost (F4).
        `  grid ${rt.cols}x${rt.rows}${Number.isNaN(engine.stats.lastGridSwitchMs) ? '' : ` (switch ${engine.stats.lastGridSwitchMs.toFixed(1)}ms)`}`;
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
  if (mode === 'world' && benchActive && params.get('bench') !== 'combat' && params.get('enemies') !== '4') { // COMBAT-BENCH-01: combatBench replaces the view sequence
    runPerfBench({ engine, playerHandle, overlay, input, rt, look, prof });
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
  const gpuPipeline = wgActive && wgPipeline.ready ? wgPipeline : null;
  if (!gpuPipeline) {
    console.error('[voxelbench] no active wgPipeline (backend=' + rt.backend + ') - nothing to measure.');
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
  if (lights && cloudShadowOn) lights.cloud = devCloudShadow(); // S8-B2-12c
  if (lights && aoStrength > 0) lights.ao = { ...AO_DEFAULTS, strength: aoStrength }; // S8-B2-20 NEEDS B1 item (1)
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
    ripples, // S8-B2-13b NEEDS B1-main (38.14): absent would be fine too (duck-typed), set for consistency with the gameplay fb
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
const doResize = () => (hzb.invalidate('resize'), isGpuCompareMode
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
