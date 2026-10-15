// game/js/main.js - bootstrap (US-024 Phase B+C, D-006). Imports only
// engine/index.js and reads `window.ASSETS` exactly once (via
// `AssetRegistry.fromGlobals`), then builds the engine with `createEngine`.
//
// Player/physics moved into engine/ in US-024 Phase C
// (engine/entities/Player.js, engine/physics/*), so this now comes from
// engine/index.js like everything else (check-deps rule 3).

import { applyImpostorBoot, reapplyRememberedImpostors } from './ui/impostorPreset.js'; // R6-WIRE
import { groundLookFromParams } from './look/groundLookConfig.js'; // ENV-02d
import { buildAtmosConfig } from './look/atmosConfig.js'; import { createAtmosDriver } from './look/atmosDriver.js'; // ENV-03
import { createFogHour, createAtmosState, mixAtmos, applyAtmosToPalette, gradeCells, createPostState, composePost, postCells } from '../../engine/index.js';
import { createFxHook, resolveFx } from './fxHook.js';
import { resolveGI, createGIWire, giLoadOptions } from './look/giWire.js';
import { resolveFootIk, createFootIkWire, createSupportGround } from './look/footIkWire.js'; // ANIM-IK-01b: kit character foot placement (?footik=0 off) // GI-PROBE-06
import { sceneOf } from './look/sceneFlag.js'; import { resolvePost } from './look/postConfig.js'; // POST-STACK-01c // ENV-03: `?atmos=0` = no driver, palette untouched
import { parseDecorMode, buildDecorConfig, guardDecorRun } from './decorHost.js'; // ENV-01-WIRE
import { loadPresets, resolveQuality, saveQuality, knobsFor, dropStaleOverrides, carpetQualityFor, carpetBuildFor } from './ui/gfxPresets.js';
import { loadQuestFiles, showBootErrors } from './questBoot.js';
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
  createPitchedTerms, pitchedTermsInto, worldToCell, resolveProjection, hasLineOfSight, HFOV_DEG, // INT-HL-01
  ambientL, World, repackMaterials,
  updateInteraction, drawCrosshair,
  buildLightSet, syncEntityLights, createLightBuffer, attachedLightPos, sunPathFrom, applySunHours, applySunPair, setWorldSun, blendLook,
  updateTriggers, moveCapsule, serialize, deserialize, createFadeLut, applySceneFade, clearMaskForSceneFade,
  createSceneDim, resetSceneDim, applySceneDim,
  loadContentPack, grassMaskFromJSON, createRng, prebuildTerrainMesh, hitSparks,
  forwardOf, DEG2RAD, hexToRgb, resolveWaterLooks, createEntityEmitters, AO_DEFAULTS, compileDialogue, NavGrid, createAStar,
} from '../../engine/index.js';
// US-047 (architecture.md section 5): pass internals + parity tooling +
// "may change" glue now live in engine/dev.js - main.js's dev-mode code
// paths (?bench=1, shadetest, ?gpucompare=1|shade) and the real-game mouse
// look/perf-spike-hunt glue (PlayerLook/FrameProfiler) import from there.
import {
  PlayerLook, FrameProfiler, blockContextMenu, terrainMeshSetFor,
} from '../../engine/dev.js';
// US-048 (PC-B QUEUE 4 item 2): pose data now lives in content/dev-poses.js
// (a plain data module neither engine/game/tools' check-deps rules scan),
// not tools/bench-poses.js - see that file's own header comment. GATE_POSES
// is the one pose list still read directly by main.js itself (`?pose=`);
// GPU_COMPARE_POSES moved into game/js/dev/modes/gpucompare.js with the rest
// of the `?gpucompare=` mode code.
import { GATE_POSES } from '../../content/dev-poses.js';
import { prefetchLazyMeshesAtBoot, prefetchAllLazyMeshes } from './bootPrefetchHook.js'; // MESH-LOAD-01: boot prefetchNear call
import { parseCloudShadowFlag, devCloudShadow, parseAoStrength } from './cloudParam.js'; // S8-B2-12a/S8-B2-20 NEEDS B1 item (2)/(1): `?cloudshadow=1`/`?ao=<0..1>` parse
import { MODES } from './dev/modes/index.js';
import { loadCinematic, evaluatePath, createPlayback } from './dev/modes/cinematic.js';
import { createPauseResume } from './quest/pauseResume.js'; // OB-068
import { entityTop, markZ } from './quest/markTop.js'; // OB-155h/OB-164: marker height from the model top
import { createPauseMenu, PAUSE_KEYS } from './ui/pauseMenu.js'; // PAUSE-MENU-01 (D-053): replaces the old 'Click to resume' overlay
// CHARGEN-17 parked (owner 2026-10-10): import { createCharCreate } from './ui/charCreate.js';
import { createCreditsView } from './ui/creditsView.js'; // CREDITS-MOUNT-01
import { updateSettings, drawSettingsPanel, isSettingsOpen, openSettings, dimSceneRect } from './ui/settings.js'; // US-038b
import { tickClock, clockHour, createClockDriver, seedClockFromParam, CLOCK_KEY, CLOCK_DEFAULTS } from './quest/worldClock.js'; // DN-03: day/night clock (D-064)
import { isPaused, resetSimAccumulator, duckAudio, unduckAudio, installAutoPause } from './ui/pause.js'; // US-062
// ---- US-020a: minimal procedural sound slice (game/js/audio/*, D-004) ----
import { initAudio, setMuted, setVolume, toggleMute, isMuted } from './audio/synth.js';
import { resetGameAudio, stepGameAudio } from './audio/sfx.js';
// ---- end US-020a ----
import { createSafeBindings, resolveGameKeys } from './gameKeys.js'; // BINDINGS-WIRE-01
import { loadSettings, saveSettings, getSaveStorage } from './platform/index.js'; // US-060: remembered mute (D-012)
import { loadBootBundle } from './packBoot.js';
import { applyLocalOverlay } from './localOverlay.js';
import { createBootCard, createLandCard } from './bootCard.js';
import { createFarHold } from './farHold.js'; // OB-109: hold boot/world swaps until the far terrain is baked // boot loading card + ASCII progress bar
import { createBootStageTimer } from './bootStageTimer.js'; // S8-B1-20: per-stage ms (content/adapter/pipelines/world/meshes)
import { addAiReserve } from './quest/sim/aiReserve.js'; // ED-AI-06: reserve slots for "Drop pack here" (dev/playtest only)
import { drawAiLabels } from './dev/aiLabels.js'; // ED-AI-06: ?dev=1 state labels over beast heads
import { create as createQuestPatchRecv } from './quest/questPatchRecv.js'; // ED-QUEST-07b: editor live quest/dialogue text (dev runs only)
let questGenCtx = null; // ED-QUEST-07b: { giverDefs, snip } so a patched dialogue is regenerated like at boot
import { create as createAiPatchRecv, broadcastFactory } from './quest/aiPatchRecv.js'; // ED-AI-RECV: editor live creature edits (dev runs only)
import { applyPlaytestOverlay } from './dev/playtest.js'; // US-034: editor play-test handoff (docs/architecture.md 24.11)
import { computeEndCardState, drawEndCard } from './ui/endCard.js';
import { initTitleCard, drawTitleCard } from './ui/titleCard.js';
import { stepEnd, endFadeAmount } from './quest/end.js';
import { stepBeacon } from './quest/beacon.js';
import { stepLantern } from './quest/lantern.js'; // OWN-REQ-006: hook-light off, same fixed-step slot as stepBeacon
import { removeSwordIfTaken } from './quest/swordTake.js'; // US-078c
import { applyDoorState } from './quest/doorToggle.js'; // DOOR-TOGGLE-01
import { noteRead, resetNoteRead, stepNoteRead, isNoteOpen, getOpenNoteId, isNoteEscGrace, pushNoteDim, drawNotePanel, setNoteOfferProvider } from './quest/noteRead.js'; // READ-01
import { createNoteOffer } from './quest/objectOffer.js'; // QFIX-S5-CLOSE: keep-light note close -> Accept/Exit offer
import { wakeFrame, drawEyelid, applyWakeOnLoad } from './quest/wake.js';
import { initMapCard, stepMapCard, isMapOpen, getMapPanel, getMapChart, drawMapCard } from './quest/mapCard.js';
import { request as requestHint, resetHints, stepHints, drawHints, pushHintDim, setPaletteColors as setHintPaletteColors } from './quest/hints.js';
import { hooks as gameHooks, bridgeEngineEvents } from './gameHooks.js'; // D-050: the one seam to game content
import { createWaystoneTouch } from './waystoneTouch.js'; // WAYSTONE-TOUCH-01
import { createWaystoneWire } from './quest/wire/waystone.js'; // WAYSTONE-01w
import { createTravel } from './quest/travel.js'; // WS1-07b: map travel (fade, teleport, reset)
import { aspectRatio } from './settings/options.js'; // OB-117: saved picture ratio at boot
import { ensureBand, bandReady, placeLoaded, gridEnabled, gridVariant, legacyVariant } from './quest/bandPose.js'; // MAP-13: band at any pose; WM-05: grid default, ?grid=0 = legacy bands
import { createTitleMenuHost, withRelock } from './titleMenuHost.js'; // US-090w: title menu (New / Continue / Settings) before play
import { createStorageAdapter } from './quest/save/saveState.js';
import { retintHand, lookOrDefault } from './quest/look/handLook.js'; // CHARGEN-16
import { createQuitSave } from './quest/quitSave.js'; // OB-079
import { parseQstateParam, applyQuestPreset } from './quest/statePreset.js'; // ED-QUEST-07
import { createSaveRelay } from './saveRelay.js'; // US-089w/US-096w: save + autosave + quest event hook
import { parseOccl, createHzbInvalidator } from './occlGate.js'; // OCCL-MAIN-01
import { watchDeviceLost } from './deviceLost.js'; // S8-B1-10 (38.10c): device-lost card
import { createQuestPickups, itemLabel } from './questPickups.js'; // QUESTS-01
import { setInspectSink, wrapText } from './quest/questInspect.js'; // QL-04
import { createErrands, labelOf, gateOnMeet, isWorn, bannerLines } from './quest/errands.js'; // QL-WIRE: Ch1-2 errands
import { generateAll, generateForNpc } from './quest/questSnippets.js'; // QL-T4: generated q.<id>.* dialogue routes
import { createUnderHook } from './underHook.js'; // B1-MAIN hooks 7: Ford cellar ladder + crypt door/chest
import { createSpellBook } from './quest/sim/spellBook.js'; // EP-SPELLS
import { computeTotals, createTotals } from './quest/sim/stats.js'; // SPELL-04: INT -> fireball damage
const fbTotals = createTotals();
import { raisable, useScroll as useSpellScroll, SCROLL_ID as SPELL_SCROLL_ID } from './quest/sim/spellScroll.js';
import { SPELL_DEFS } from './quest/spellDefs.js';
import { countOf as invCountOf } from './quest/sim/inventory.js';
import { createHeartHook } from './heartHook.js'; // QL-08: heart pieces -> max HP
import { createChestHook } from './chestHook.js'; // S8-B1-04: chest sim + item-get card, through the seam only
import { createMapFogHook } from './mapFogHook.js'; // S8-B1-16: visited-cell mask feed, through the seam only
import { wireTelegraphs, telegraphsEnabled } from './fx/telegraphWire.js'; // TELEGRAPH-WIRE-01 (lane B1)
import { stepCombatHint } from './quest/combatHint.js'; // COMBAT-HINT-01
import { createRegionBanner } from './quest/regionBanner.js'; // REGION-01: region-entry banner
import { stepActionHints, resetActionHints } from './quest/actionHints.js'; // FS-01
import { addSideMarks } from './quest/markSide.js'; // OB-125: light-blue side-quest markers
import { bootRegionAmbient } from './quest/regionAmbientWire.js'; // WMP-03: region ambient life
import { createWild } from './wild/wildEnv.js'; // WILD-06: ambient rabbits + deer
import { createGoblinWire } from './life/goblinWire.js'; // GOB-07b
import { createLifeWire, prepareRaidDefs, createOutwallLife } from './life/lifeWire.js'; // LIFE-HOOKS-01: wolf raids wiring
import { planWorldLife } from './quest/sim/worldGen.js';
import { bootRegionalBeasts } from './quest/sim/regionalBeastsBoot.js'; // WM-12
import { createLogicWire } from './logic/logicWire.js'; // ED-LOGIC-01c
import { loadDecorPaint } from './decorPaintLoad.js'; // ED-FOLIAGE-04
import { createDirectorWire } from './quest/sim/directorWire.js'; // BEAST-06a main hook (arch 38.64 answer c)
import { createSpawnDirector, buildGroups, regionalMembers } from './quest/sim/spawnDirector.js';
import { spawnRegionalBeasts } from './quest/sim/regionalBeasts.js';
import { setForestAmbienceSources } from './audio/forestAmbience.js'; // OB-184
import { setUndergroundSources } from './audio/undergroundAmbience.js'; import { createUnderSpawner, UNDER_SITES } from './quest/sim/underSkeletons.js'; // UNDER-01 / UNDER-08
import { createBeastSim, isBeastDeadState } from './quest/sim/beastSim.js';
import { kindOf } from './quest/sim/quest.js'; // US-079a (architecture.md 29.1)
import { ensureWolves } from './quest/sim/wolfBrain.js'; // WOLF-01
import { ensureBears } from './quest/sim/bearBrain.js'; // BEAR-01 (D-069): black bears in Thornwood
import { stepFireballHints, resetFireballHints } from './quest/fireballHints.js'; // FB-03
import { startMpFade } from './quest/vitalsView.js'; // FB-03: MP bar fades in on unlock
const fbS = { fbOn: false, hand: null, casting: false, manaFlashTick: 0 }; // FB-03: reused hint input
import { buildBeastNav, buildWaterNav } from './quest/sim/beastNav.js';
import { createGrabPin } from './quest/grabPin.js'; import { createNpcLook } from './quest/npcLook.js'; // BEAST-08b pin (D-088) / ANIM-LOOKAT-01 AC3
import { presentBeasts } from './quest/beastView.js';
import { createBeastLegs } from './quest/beastLegs.js'; // ANIM-C-05: leg IK for beasts (?legik=0 off)
import { createBeastLook } from './quest/beastLook.js'; // ANIM-LOOKAT-01: beast head look-at (?lookat=0 off)
import { createBeastBlend } from './quest/beastBlend.js'; // ANIM-BLEND-03: clip blending for beasts (?animblend=0 off)
import { createBeastAnim } from './quest/beastAnim.js'; // ANIM-STATE-WIRE-01
import { questOverlayStyles } from './quest/overlayStyles.js';
import { createVitals } from './quest/sim/vitals.js'; // US-080a1/a2 (architecture.md 30.2)
import { createTargeting } from './quest/targeting.js'; // US-128b (architecture.md 29.2)
import { stepTargetingInput } from './quest/targetingInput.js';
import { SWORD_CFG } from './quest/swordConfig.js'; // US-078d (architecture.md 30.1 + D-034 amendment)
import { createSwordSim, ST_LIGHT, ST_HARD } from './quest/sim/sword.js';
import { presentSword } from './quest/swordView.js';
import { loadSpellHandView, presentSpellHand, SPELL_HAND_ITEM } from './quest/spellHandView.js'; // HANDS-01c (37.8a)
import { loadHandFireView, presentHandFire, bindHandFx, stepHandFx, setHandFlame, pushHandFlame } from './quest/handFireView.js'; // HAND-WIRE-01: realistic hand + always-on fire
import { equip as equipItem, migrateEquipment, stepEquipment, defenceOf, nightBonus } from './quest/sim/equipment.js'; // EQ-02
import { refreshRolledGear } from './quest/sim/rolledGear.js'; // ITEM-WIRE-01: equipment.rolled -> components.rolledGear
import { createHands } from './quest/sim/hands.js'; // HANDS-01b (37.8a)
import { createFireballSim } from './quest/sim/fireball.js'; // SPELL-01a (37.14)
import { createGustView, defineGustFx } from './quest/gustView.js'; // SPELL-07b
import { createFireballView } from './quest/fireballView.js'; // SPELL-01b (37.14 view)
import { createShieldSim } from './quest/sim/shield.js'; // EQ-07 (38.41 a)
import { createArrowSim } from './quest/sim/arrows.js'; // EQ-09 (38.41 b)
import { createWetStones } from './quest/sim/wetStones.js'; // QL-19: wet ford stones + River Boots sure footing
import { createBand } from './quest/sim/band.js'; // US-129a: level band for beasts + loot
import { createWadeFx } from './quest/sim/wadeFx.js'; // US-055a
import { createSwimWire } from './quest/swimWire.js'; // SWIM-03c (38.54)
import { swimUpOf, jumpOf } from './quest/swimInput.js'; // SWIM-04d
import { createShore } from './quest/seaEdge.js'; // SWIM-HOOKS-01
import { createSafeSpots } from './quest/sim/safeSpots.js'; // OB-140
import { createWading } from './quest/sim/wading.js'; // RIVER-04 (38.45 (3)): river wading around the player's integrate
import { BOW_CFG } from './quest/bowConfig.js'; // EQ-09
import { createQuickbar, ensureQuickbar, autoFill, assign as qbAssign, clearSlot as qbClear, syncHandSlots, HAND_SLOTS } from './quest/sim/quickbar.js'; // EQ-12 + QB-6
import { createQuickbarDrag } from './quest/quickbarDrag.js'; // QB-6: drag and drop onto the bar while the menu is open
import { createQuickbarView } from './quest/quickbarView.js'; // EQ-12 + D-068
import { createEquipPlay, registerGearItems } from './quest/equipPlay.js'; // EQ-07/09: LMB/RMB/Q routing, bow draw, pick-up
import { createStubItemSim } from './quest/sim/hands.js'; // EQ-07: no-op sims so the router arms shield / bow
import { EQUIP_VIEW_MODELS, loadShieldView, presentShield, loadBowView, presentBow, drawBlockSpark, createArrowView } from './quest/equipView.js'; // EQ-07/09
import { playShieldClank, playBowShot, playRelayHum } from './audio/sfx.js'; // EQ-07/09
import { createTargetables } from './quest/sim/targetables.js';
import { FIREBALL_CFG, refreshLocked } from './quest/spellConfig.js';
import { createSpellDispatcher } from './quest/sim/spellCast.js'; // SPELL-04
import { createWardSim } from './quest/sim/ward.js'; import { createFireRingSim } from './quest/sim/fireRing.js'; import { createGustSim } from './quest/sim/gust.js'; // SPELL-06/07
import { featuresFromParams, fireballOn } from './quest/features.js'; // D-065: fireball off unless ?fireball=1
import { START_DEMO, START_FULL, startFor } from './quest/startConfig.js';
import { createPracticeTarget, applyPropTargetables } from './quest/practiceTarget.js';
import { createParticleHooks, applyPropEmitters } from './quest/particleHooks.js'; // US-053c
import { createWaterfallHooks } from './quest/waterfallHooks.js';
import { createAmbientMotes } from './quest/ambient.js';
import { createFireflies, fireflyProbes } from './fx/fireflyWire.js'; // FIREFLY-NIGHT-01
import { createUnderCreep, applyCreepLights, creepMistDensity, createFirstEntry } from './quest/under/creep.js'; // UNDER-LIGHT-CREEP-01
import { VITALS_DEFAULTS } from './quest/sim/vitalsConfig.js';
import { createHitStop, hitStopEnabled } from './fx/hitStop.js'; // HITSTOP-01 (lane B1)
import { createDeathFlow, deathFlowEnabled } from './fx/deathFade.js'; // DEATH-FLOW-01 part 1 (lane B1)
import { createHurtFx, hurtFxEnabled } from './fx/hurtFx.js'; // HURT-FX-01 (lane B1): low-hearts pulse only (hurt edge + kick = US-080a2)
import { wireHitSparks, hitSparksEnabled } from './fx/hitSparkWire.js'; // HIT-SPARK-WIRE (lane B1)
import { parsePointShadows, presetPointShadowsOn } from './pointShadowOpt.js'; // ME-16e: ?pointshadows=0|N
import { parseGlow } from './glowOpt.js'; // EMIS-03/04: bleed + halo knob
import { setReduceMotion, isReduceMotion, eyeZ, gateKick, textSizeCols } from './ui/comfort.js'; // SETTINGS-APPLY-01
import { PHYSICS, createUnderState, setApiWarnings } from '../../engine/index.js';
if (new URLSearchParams(window.location.search).get('debug') === '1') setApiWarnings(true); // ENG-API-01h: dev flag only - deprecated engine names warn once
import { meshFeedStats, MAX_MESH_DRAWS, MAX_DRAW_ITEMS } from '../../engine/index.js'; // OB-039: F3 mesh draw cap line
import { createModelPreview, createCharCache } from '../../engine/index.js'; // EQ-03/04: Character tab model preview
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, HUMANOID_SPLIT_LEG_RIG, createFootIk, voxelPointWorld } from '../../engine/index.js'; // OB-086: the kit character in the world
import { drawArrowCount, drawVitals, drawHurtEdge, drawWardRing, kickDeg, applyDeathFade, computeDeathCardState, drawDeathCard } from './quest/vitalsView.js';
import { stepPickups, resetPickups } from './quest/sim/pickups.js'; // US-080b (30.2)
import { ensureInventory, validateItemDefs, migrateSword, addItem } from './quest/sim/inventory.js'; // US-091a1 (37.16.4)
import { presentPickups } from './quest/pickupsView.js';
import { createLoot, setLootApi } from './quest/sim/loot.js'; // US-091a2 (37.16.3)
import { createRelayWake, setRelayWakeApi } from './quest/relayWake.js'; // WS1-06b: wake the road-bend relay
import { talkNpcIds } from './quest/npcNames.js'; // R6-FIX A
import { createDialogueCtl, setDialogueApi } from './quest/dialogueCtl.js'; // DIALOGUE-01b2 (38.28)
import { createCrystalGrant } from './quest/crystal.js'; // CH1-MOUNT: CH1-03 aether crystal after the boars
import { createNpcWalk } from './quest/npcWalk.js'; // CH1-07
import { createBurlEscort } from './quest/burlEscort.js'; // CH1-07
import { createNubFollow } from './quest/nubFollow.js'; // NUB-01: Burl's cub follows her
import { createBarks } from './quest/barks.js'; // CH1-MOUNT: CH1-06 bark one-liners (Burl)
import { createChapterCard, CHAPTER2_TEXT, FLAG_DONE_CH2 } from './quest/chapterCard.js'; // CH1-MOUNT: CH1-09 chapter end card
import { createNoticeView } from './ui/noticeView.js'; // CH1-MOUNT: CH1-04a notice banner
import { createNpcTurn } from './quest/npcBear.js'; // NPC-BEAR-01 (38.28): turn-to-player
import { createOutwall } from './quest/outwall.js'; // OUT-01: Hesk/Dorrin turn + met flags
import { LOOT_TABLE, LOOT_SEED_SALT } from './quest/sim/lootConfig.js';
import { createToastView } from './quest/toastView.js';
import { createInventoryScreen } from './quest/inventoryScreen.js'; // US-091b + OB-112: one inventory screen (I / C / Tab)
import { createQuestMarkers } from './quest/sim/questMarkers.js'; // QUEST-MARK-01w
import { registerQuestMarks } from './quest/wire/questMarks.js';
import { createQuestLogScreen, QUEST_LOG_KEYS } from './ui/questLog.js'; // QG-05
import { GIVER_INFO } from './questNext.js'; // QUEST-NEXT-GIVER-01
import { createOfferToast } from './quest/offerToast.js'; // new derived offer -> "New quest" toast
import { createCompassHud } from './ui/compassHud.js'; // COMPASS-02 (D-061)
import { createCombatHud } from './ui/combatHud.js'; import { setEnemyBarsOn, setDamageNumbersOn } from './ui/combatHudFlags.js'; // HPBAR-02 + DMGNUM-01 (D-086)
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
import { defineLeafFall, createLeafFall, gustBand } from '../../engine/index.js'; // WIND-GUST-01b
import { validateBehaviours, createRipples, defineWadeSplash, createEntityTintTable, fillEntityTints, localToWorld } from '../../engine/index.js';
import { selectHints, createHintSet, pulseStep, buildHintColors, HINT_GLYPH } from './quest/useHints.js'; // INT-HL-01
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
const FEATURES = featuresFromParams(new URLSearchParams(window.location.search)); // not via filterDemoParams: dev flag
let fbOn = false; // FB-01 (38.53): fireball usable (dev override or world.state['magic.fireball']); one live read per sim step + per present, never captured at boot
const LOCKED = { 'spell.fireball': 1, 'potion.mp': 1 }; // SPELL-04: locked = tier 0 for every spell.<id> (+ mana potion); refilled by syncFb() each sim step / frame
const isGeometryCompare = (params.get('gpucompare') === '1' || params.get('gpucompare') === 'emissive');
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
const savedSettings = dropStaleOverrides(loadSettings(), { save: saveSettings }); // QUALITY-STALE-01
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
setEnemyBarsOn(savedSettings.enemyBars); setDamageNumbersOn(savedSettings.dmgNumbers); // HPBAR-02 / DMGNUM-01: Combat HUD switches (default On)
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
if (window.ASSETS.levels.world_geo && params.get('geo') !== '0') window.ASSETS.levels.world_geo.util.installGeo(window.ASSETS.levels.overworld_far.util); // MAP-02/03/05 (38.42): geography layers + biomes; keep rect byte-identical; ?geo=0 off
if (bootProg) { bootProg.phase('registry'); await bootPaint(); }
applyPlaytestOverlay(bundle);
await applyLocalOverlay(bundle, params, undefined, { lazyMeshes }); // git-ignored content/local/ (licence-restricted assets, this PC only)
if (window.ASSETS.equipment) { // EQ-07/09: shield + bow + arrows -> ASSETS.models; the view-only ones are registered mesh-only below (boot budget), arrow/arrowStuck stay full models for the instance groups
  window.ASSETS.equipment.attach();
  for (const n of window.ASSETS.equipment.list) if (n !== 'arrow' && n !== 'arrowStuck' && window.ASSETS.models) delete window.ASSETS.models[n];
}
if (window.ASSETS.spellFx) window.ASSETS.spellFx.attach(); // SPELL-01b: fireball sprites -> ASSETS.models (atlas) + presets -> ASSETS.particles, BEFORE the registry/atlas/defineEmitter loop
bootMark('local overlay applied');
try { addSideMarks(window.ASSETS); } catch (e) { console.warn('[marks] side variant off:', e && e.message); } // OB-125
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
if (lookParam && lookParam !== '0') { // '0' = ENV-02d ground-look off
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
// INT-HL-01: faint use-hint markers (colour table from the prompt key colour; scratch reused every frame)
const useHintColors = buildHintColors(P.colors[P.ui.promptKey]), useHintSet = createHintSet(), useHintTerms = createPitchedTerms(), useHintGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
const useHintProject = (x, y, z, o) => worldToCell(useHintTerms, x, y, z, o);
const aiLabelTerms = createPitchedTerms(), aiLabelGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 }; // ED-AI-06 (?dev=1 labels)
const aiLabelProject = (x, y, z, o) => worldToCell(aiLabelTerms, x, y, z, o);
const aiLabelGround = (x, y) => { const t = engine.world.terrain; return t && t.heightAt ? t.heightAt(x, y) : 0; };
const useHintLos = (ax, ay, az, bx, by, bz) => hasLineOfSight(engine.world, ax, ay, az, bx, by, bz);
const crosshairStyle = {
  crosshair: { dim: P.colors[P.ui.crosshair], active: P.colors[P.ui.crosshairActive] },
  // plateBg: same dark plate as the item toast (design/items.js plate [10,11,16]); without it drawText's bg falls back to opaque white
  prompt: { color: P.colors[P.ui.prompt], keyColor: P.colors[P.ui.promptKey], plateBg: '#0a0b10', scale: 2 }, // OB-051: 2x prompt glyphs
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
const pointShadowOpt = parsePointShadows(params, resolvedQuality && resolvedQuality.name, presetPointShadowsOn(resolvedQuality, isCaptureOrBench, params)); // ME-16e/AUD-44: ON by preset (high/ultra), `?pointshadows=0|N` overrides
const tCR = bootNow();
const { rt: builtRt, pipeline: wgPipeline, device: gpuDevice, info: rendererInfo } = await createRenderer({ canvas, cols: gridResult.cols, rows: gridResult.rows, backend: params.get('backend') || 'webgpu', onWebGpuMissing,
  force2d: params.get('force2d') === '1', gpu: params.get('gpu') !== '0', rays, resolveBandM: bootOpts.raysFarM, terrainEnabled: params.get('terrain') !== '0',
  stable: params.get('stable') !== '0', // US-073c (38.25) + OB-073 D (owner 2026-10-12): temporal glyph stability, default ON (`?stable=0` off); ?gpucompare=1 builds it for the `stable` row (the pass stays off for every other row)
  shadows: shadowOpts, gpuCull: params.get('gpucull') !== '0', occl: occlOpt.occl, pointShadows: pointShadowOpt.pointShadows, pointShadowLevel: pointShadowOpt.pointShadowLevel, glow: parseGlow(params, resolvedQuality && resolvedQuality.name), // EMIS-03/04: emissive bleed + halo (High/Ultra, ?emissive=); OCCL-MAIN-01: `?occl=1` two-phase HZB occlusion, default OFF, WebGPU only
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
const wadeFx = createWadeFx(engine.particles, ripples); // US-055a: wade splash + leg rings + arrow water hit
defineWadeSplash(engine.particles, {});
defineGustFx(engine.particles); defineLeafFall(engine.particles, {}); const leafFall = createLeafFall(engine.particles, gustBand); // WIND-GUST-01b: leaves shed under travelling gust bands
const worldBand = window.ASSETS.levels.world_geo ? createBand(window.ASSETS.levels.world_geo.regions) : null; // US-129a (null = tier 1)
const wadeArrowHit = (x, y, z) => wadeFx.arrowHit(x, y, z, fb ? fb.timeSec : 0); // one closure, not per frame
engine.events.on('magic.unlocked', () => startMpFade(fb ? fb.timeSec : 0)); // FB-03: the MP bar fades in (same clock drawVitals gets)
// US-089w/US-096w: save relay (autosave 60 s + waystone, load at boot) and quest hook. `?save=0` off; capture/bench/compare/cinematic
// pages and automated browsers never load or save unless `?save=1` forces it (the headless reload check does).
const saveEnabled = params.get('save') !== '0' && (params.get('save') === '1' || !(isCaptureOrBench || params.get('capture') === '1' || params.has('at') || navigator.webdriver)); // `?at` = dev pose: never autosave it into slot 0
let saveRelay = null;
let dirWire = null; // BEAST-06a: regional respawn director wire (rebuilt with every beast sim)
let qstateItems = null; // ED-QUEST-07: pack items granted by the ?qstate preset (new-game boot only)
let markWorld = null; // QUEST-MARK-01w: the current World (set per load before gameHooks.boot)
let titleMenuActive = true; // S8-B1-10: mirrors menuHost.active each frame (true until the first frame says otherwise); gates the loss autosave
let deviceLostFrozen = false; // S8-B1-10 (38.10c): set once by watchDeviceLost's `freeze` hook below; gates `paused` in the frame loop
// CH1-02 nit: area trigger per id, cached per world (compass + quest markers; no closure/find per call).
const areaTrigCache = new Map(); let areaTrigWorld = null;
function areaTrigger(w, id) {
  if (w !== areaTrigWorld) { areaTrigCache.clear(); areaTrigWorld = w; }
  let t = areaTrigCache.get(id);
  if (t === undefined) { t = w.triggers.find((q) => q.key === 'world.' + id) || null; areaTrigCache.set(id, t); }
  return t;
}
let inspectTexts = null; // content/dialogue/inspect.json
let bearBarks = null; // CH1-06: content/dialogue/bear.barks.json (not in the content manifest)
{
  // AUD2-09: per-file loads; a missing file is logged by name and shown on screen (no silent quest-less game)
  const qb = await loadQuestFiles((u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), { wantBarks: saveEnabled, items: itemDefs ? Object.values(itemDefs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier })) : [] }); // QL-WIRE: EQ-13 gear rewards resolve against the design item defs
  bearBarks = qb.bearBarks;
  inspectTexts = await fetch('../content/dialogue/inspect.json').then((r) => (r.ok ? r.json() : null)).catch(() => null); // QL-T4+: look-at table (errands.js loadTexts)
  if (qb.giverDefs) { // QL-WIRE: errands open after Burl's first greeting; his errand lines become dialogue routes
    qb.giverDefs = gateOnMeet(qb.giverDefs);
    try { // QL-T4: every giver NPC with a dialogue gets generated ready / offer / active routes (writer lines override the snippets)
      const ids = [...new Set(qb.giverDefs.map((d) => d.giver && d.giver.npc).concat(qb.giverDefs.map((d) => d.giver && d.giver.turnIn)))].filter((id) => id && bundle.dialogues && bundle.dialogues[id]);
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      const [snip, ...rawList] = await Promise.all([get('../content/dialogue/quest-snippets.json').catch(() => null), ...ids.map((id) => get('../content/dialogue/' + id + '.dialogue.json').catch(() => null))]);
      const raws = {}; ids.forEach((id, i) => { if (rawList[i]) raws[id] = rawList[i]; });
      const gen = generateAll(raws, qb.giverDefs, snip || {});
      questGenCtx = { giverDefs: qb.giverDefs, snip: snip || {} };
      for (const id of Object.keys(gen)) if (gen[id] !== raws[id]) bundle.dialogues[id] = compileDialogue(gen[id]);
      for (const oid of new Set(qb.giverDefs.filter((d) => d.objectGiver === true && d.giver).map((d) => d.giver.npc))) { // D-087: object givers get an Accept/Exit offer dialogue 'obj.<id>'
        const shell = { kind: 'dialogue', schema: 1, id: 'obj.' + oid, speakers: { obj: { label: 'NOTE' }, you: { label: 'YOU', player: true } }, entry: [{ node: 'obj.none' }], nodes: { 'obj.none': { end: true, lines: ['Nothing more here.'], speaker: 'obj' } } };
        const g = generateForNpc(shell, oid, qb.giverDefs, snip || {});
        if (g !== shell) bundle.dialogues['obj.' + oid] = compileDialogue(g);
      }
    } catch (e) { console.warn('[QL-T4] quest dialogue off:', e && e.message); }
  }
  window.__debug = window.__debug || {}; window.__debug.bootErrors = qb.errors;
  if (qb.errors.length) showBootErrors(document, qb.errors);
  if (qb.questDef && qb.giverDefs && qb.charKit) { try {
  const { questDef, giverDefs, charKit } = qb;
  saveRelay = createSaveRelay({ storage: saveStorage(), questDef, giverDefs, enabled: saveEnabled, defaultLook: charKit.defaults,
    freshPreset: () => { // ED-QUEST-07: editor "Play from here" `?qstate=<questId>:<preset>`; fresh run only, ignored in capture/bench, never writes a slot
      const qs = (isCaptureOrBench || params.get('capture') === '1') ? null : parseQstateParam(location.search); if (!qs) return null;
      try { const r = applyQuestPreset({ main: questDef, givers: giverDefs }, qs.questId, qs.preset); qstateItems = r.items; return r.save; } catch (err) { console.warn('[qstate] preset failed:', err && err.message); return null; }
    } });
  window.__charKit = charKit;
  saveRelay.bindEvents(engine.events);
  gameHooks.register(saveRelay.handlers());
  saveRelay.quest.onPoll = (name, a, b) => gameHooks.emitSimple(name, a, b);
  gameHooks.onSaveRequest(() => { if (saveRelay && gameHooks.ctx.world) { if (dirWire) dirWire.save(gameHooks.ctx.world.state); } if (saveRelay && gameHooks.ctx.world) saveRelay.save(gameHooks.ctx.world, { ending: gameHooks.ctx.state.ending }); });
  // QUEST-MARK-01w: '!' markers over available take steps (patch docs/patches/QUEST-MARK-01w.diff). Off in capture/bench/?save=0.
  if (saveEnabled && window.ASSETS && window.ASSETS.questMarkFx) {
    const qm = createQuestMarkers(questDef, [ // CH1-02 (38.37 item 1): flag/area steps only; item steps (sword) and wake/breach get no marker. doorMarker/roadWest resolve to their area trigger (markResolve)
      { objectiveId: 'leave', targets: ['doorMarker'] }, /* MARK-FOLLOW-01: no mark while following Burl (owner) */ { objectiveId: 'waystone', targets: ['endMarker'] },
      { objectiveId: 'road', targets: ['roadWest'] }, { objectiveId: 'relayFound', targets: ['relayBend'] }, { objectiveId: 'relay1', targets: ['relayBend'] }]);
    const MARK_AREA = { doorMarker: 'towerDoor', roadWest: 'roadWest' }; const MARK_AT = { doorMarker: { x: 1495.5, y: 1030.5 } }; // owner 2026-10-10: the leave marker hangs in the open SW doorway (cell Q), not at the area centre (that sat in the wall) // marker id -> world area trigger id (no entity)
    const MARK_TOP = { endMarker: 3.0, noteKeepLight: 0.14 }; /* OB-155h: overrides only; everything else hangs above the model top (quest/markTop.js) */ const MARK_DY = { noteKeepLight: -0.03 }; const MARK_SCALE = { noteKeepLight: 0.4 }; // OB-095 (owner: too big, should almost touch the note + wall): the page is z 0.80-1.04 on the wall; a 0.4-scale '!' (0.31 m glyph, 0.14 m float) puts its bottom ~4 cm above the page top, centre 0.1 m off the wall (clears it while spinning). // QUEST-CHAIN-Q-01: the page sits ON the tower wall (y 10.0 local, interior = smaller y): hang the '!' 0.55 m inside so it is not half in / through the wall // prop top above its base z (waystone 24 voxels x 0.125 m; bear 22 voxels x 0.05 m = 1.1 m, glyph floats 0.35 m above); notes would use z + 1.55 (owner 2026-10-10: "!" too high)
    gameHooks.setQuestSource((out) => { const st = saveRelay.quest.state; out.done = saveRelay.quest.done; out.id = out.done ? '' : questDef.objectives[st.completed.length].id; out.targets = qm.markerTargets(st); });
    let markN = 0;
    const markHandle = (model) => { // entity handle for one marker; re-spawns itself when a world reload dropped the entity
      const id = 'questMark_' + (markN++); let w = null, ent = null, hidden = true, scale = 1, anim = 'idle', x = 0, y = 0, z = 0;
      const cur = () => {
        const mw = markWorld; if (!mw) return null;
        if (w !== mw || !ent || !ent.alive) { w = mw; ent = mw.get(id) || mw.spawn('prop', { x, y, z, yawDeg: 0, scale }, { voxel: { model, anim, loop: true, hidden, priority: 2 } }, id); }
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
    const MARK_ENT = { noteKeepLight: 'tower.noteKeepLight' }; // level props are world entities '<placementId>.<propId>'
    const markResolve = (id, out) => { const h = markWorld && markWorld.get(MARK_ENT[id] || (saveRelay.quest.book ? saveRelay.quest.book.entityFor(id) : id)), t = h && h.data && h.data.transform; if (!t) { const a = MARK_AREA[id], tr = a && markWorld && areaTrigger(markWorld, a); if (!tr) return false; const at = MARK_AT[id] || tr, gz = markWorld.heightAt(at.x, at.y); out.x = at.x; out.y = at.y; out.z = (gz == null ? 0 : gz) + 2.2; return true; } out.x = t.x; out.y = t.y + (MARK_DY[id] || 0); out.z = markZ(t, entityTop(markWorld, h.data, (k) => gameVoxelPool.models.get(k)), MARK_TOP[id]); out.s = MARK_SCALE[id] || 1; return true; };
    // MARK-GIVER-ONLY-01 (owner), amended OB-124b: objective steps get no per-step waypoint mark here; instead book.chainMarks (m1 objective.mark data) adds gold '!' at the start entity / '?' at the end entity of the current main step (below). Flip to re-enable if a distinct waypoint symbol is designed.
    const OBJECTIVE_MARKS = false;
    if (OBJECTIVE_MARKS) registerQuestMarks(gameHooks, { fx: window.ASSETS.questMarkFx, resolve: markResolve, create: () => markHandle('questMark') });
    // QG-04: giver markers over Burl: '!' while his quest is available, '?' while ready, none while active/done (book.giverMarks)
    const gAvail = [], gReady = [], sAvail = [], sReady = []; // OB-125: main chain = gold, side quests = light blue (book.isMain, from quest data)
    for (const [model, list] of [['questMark', gAvail], ['questMarkReady', gReady], ['questMarkSide', sAvail], ['questMarkReadySide', sReady]]) {
      registerQuestMarks(gameHooks, { fx: window.ASSETS.questMarkFx, resolve: markResolve, create: () => markHandle(model),
        source: (out) => { const b = saveRelay.quest.book; b.markLists(gAvail, gReady, sAvail, sReady); /* OB-155j: one marker per entity */ out.done = false; out.targets = list; } });
    }
  }
  } catch (e) { console.error('[save] relay setup failed:', e); window.__debug.bootErrors.push({ file: 'save relay', message: String(e && e.message) }); showBootErrors(document, [{ file: 'save relay', message: '' }]); }
  }
}
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
  window.__kestrel.giveItem = (id, n = 1) => { const ph = window.__debug && window.__debug.playerHandle, inv = ph && ph.data.components.inventory; return inv && itemDefs ? addItem(inv, itemDefs, id, n) : 0; }; // UNDER hooks 7: ?dev=1 only, e.g. giveItem('key.crypt') until UNDER-07
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
const underHook = createUnderHook({ getBeasts: () => (window.__debug && window.__debug.beasts) || null, openedChestsOf: () => (saveRelay ? saveRelay.openedChests : []),
  afterMove: () => { hzb.invalidate('ladder'); }, notify: (t) => { if (lootToast) lootToast.say(t, [226, 214, 176]); } }); // B1-MAIN hooks 7 (UNDER-03/02)
let lootToast = null; // OB-082: the toast view lives in the boot block below (let toasts); the chest hook reaches it through this
const chestHook = (itemDefs && assets.uiStyle && assets.uiStyle.itemGetCard)
  ? createChestHook({
    defs: [], items: window.ASSETS.items, style: assets.uiStyle.itemGetCard, rgb: assets.palette.rgb,
    openedChestsOf: () => (saveRelay ? saveRelay.openedChests : []), reduceMotion: isReduceMotion,
    canOpenGate: (id) => underHook.canOpenChest(id), // UNDER-02: chestCrypt only once room 3 is cleared
    notify: (t) => { if (lootToast) lootToast.say(t, [226, 214, 176]); }, // OB-075 (+ OB-082: was a ReferenceError on every loot): chest / gear loot = a toast line, not the item-get card
  })
  : null;
gameHooks.register(underHook); // B1-MAIN hooks 7
if (chestHook) gameHooks.register(chestHook);
if (chestHook) gameHooks.register(createHeartHook({ getCard: () => chestHook.card, notify: (t) => { if (lootToast) lootToast.say(t, [226, 214, 176]); } })); // QL-08; OB-105: heart piece = toast, not the card
// QUESTS-01: generic world pickup prop + pack counts for collect/deliver objectives + hand-in reward grant (game/js/questPickups.js)
let questBeastSim = null; // SOFTLOCK-01: the live beast sim for the kill-quest accept rule (set where the sim is built)
if (saveRelay) saveRelay.quest.setLivingOfKind((kind) => { const s = questBeastSim; if (!s || !s.ids) return 99; let n = 0; for (let i = 0; i < s.ids.length; i++) if (kindOf(s.ids[i]) === kind && !s.down[i] && !isBeastDeadState(s.state[i])) n++; return n; }); // SOFTLOCK-01 + R6-FIX C: installed on every book the relay creates/loads (not lazily in questPickups.sync)
const questPickups = (itemDefs && saveRelay) ? createQuestPickups({ getBook: () => saveRelay.quest.book, feed: (e) => saveRelay.quest.feed(e), defs: itemDefs, isWorn }) : null; // QL-WIRE: requireEquipped hand-ins
if (questPickups) gameHooks.register(questPickups);
// US-090w: title menu before play. Off for `?title=0`, capture/bench/compare/cinematic pages, `?capture=1`, `?at=`/`?pose=` dev poses and bare `?level=` rooms.
const menuWanted = params.get('title') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !params.has('at') && !params.has('pose') && !params.get('level') && !params.get('cinematic');
// D-025 (US-038a): `renderTarget` now resizes IN PLACE (`engine.setGrid`
// never replaces the object), so `rt` itself could be `const` - kept `let`
// only because `depthBuffer`/`gbuf` are still replaced with new
// (small, CPU-side) objects, by the fallback gate below (architect review 1
// item 2) and by any later live grid change (the `grid:changed` handler).
let { renderTarget: rt, depthBuffer } = engine;
// OB-117: apply the saved picture ratio at boot (settings panel applies it live); gpucompare/capture/bench pages keep the reference box.
if (!isCaptureOrBench && params.get('capture') !== '1' && typeof rt.setAspect === 'function') rt.setAspect(aspectRatio(loadSettings().aspect));
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
// DN-03 (38.39): the clock runs in play unless frozen. `?timefreeze=1` / capture, bench, gpucompare, cinematic, ?at=, ?pose= keep today's static look.
const dayLenMin = params.has('daylen') ? parseFloat(params.get('daylen')) : NaN;
const clockCfg = { dayLenS: Number.isFinite(dayLenMin) && dayLenMin > 0 ? dayLenMin * 60 : CLOCK_DEFAULTS.dayLenS, startHour: CLOCK_DEFAULTS.startHour };
const clockFrozen = params.get('timefreeze') === '1' || isCaptureOrBench || !!params.get('cinematic') || params.has('at') || params.has('pose');

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
// QUALITY-BOOT-01: the WebGPU target is built at the 160x60 CPU grid; if the pipeline is not frameComplete yet at this point, the saved
// quality's grid used to be dropped for the whole session (panel said Ultra, render stayed low; re-selecting Ultra called setGrid). Keep it pending.
const bootCpuCols = rt.cols;
let pendingBootGrid = !!(wgPipeline && rt.backend === 'webgpu' && (rt.cols !== gridResult.cols || rt.rows !== gridResult.rows) && !(isGeometryCompare) && !isCaptureOrBench);
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
// EQ-07/09: shield + bow view-model meshes (mesh-only, authored left), same precedent as swordHeld.
if (window.ASSETS.equipment) for (const n of EQUIP_VIEW_MODELS) { // designer note (EQ-D1): shieldHeld anchor y 4.5 > size y 4 fails voxel validation; clamped here (0.5 voxel), asset untouched
  const d = window.ASSETS.voxelModels[n];
  if (d && !assets.has('model', n)) assets.add('model', n, { ...d, voxel: { ...d.voxel, anchor: d.voxel.anchor.map((v, i) => Math.min(v, d.voxel.size[i])), meshOnly: true } });
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
// The default kit character (human kit v8 shapes) as the `char.kit` world model (player body + NPCs). The OB-086 demo copy that
// stood 2 m east of Burl (demo.kitChar) was removed on the owner's request 2026-10-15.
let kitFootCells = null; // ANIM-IK-01b: foot cells of the kit legRig (footIkWire)
if (window.__charKit && !assets.has('model', 'char.kit')) {
  try { const K = window.__charKit; const grid = composeCharacter(K, K.defaults); const sw = window.ASSETS.chargenSwimClips; if (sw) Object.assign(grid.clips, sw.clips); /* SWIM-ASSETS-01: swim/tread/dive, in-game player only */ const kitDef = riggedModelDef(collapseRig(meshCharacter(grid), K.partMap), { legRig: HUMANOID_SPLIT_LEG_RIG, lookAt: { part: 'head', yawLimitDeg: 60, pitchLimitDeg: 25, hz: 2 } }); kitFootCells = kitDef.voxel.legRig ? kitDef.voxel.legRig.legs.map((l) => l.foot) : null; /* ANIM-IK-01b: split-leg rig */ assets.add('model', 'char.kit', kitDef); }
  catch (e) { console.warn('[char.kit] ' + e.message); }
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
const wgActive = !!(wgPipeline && wgPipeline.ready && rt.backend === 'webgpu'); // WG-2b: geometry-only WebGPU pipeline (CPU still shades)
engine.events.on('combat:hit', (p) => { if (p && p.source === 'player') hitStop.trigger(p.heavy ? 'heavy' : 'light'); }); // HITSTOP-01
const hzb = createHzbInvalidator(() => ((occlOpt.enabled || params.get('stable') !== '0') && wgActive && wgPipeline.ready ? wgPipeline : null), { onCut: () => { if (engine.instances && engine.instances.resetLodHistory) engine.instances.resetLodHistory(); if (wgActive && wgPipeline.resetLodHistory) wgPipeline.resetLodHistory(); } }); // OCCL-MAIN-01 (+ US-073c): cuts invalidate the HZB and the stable-pass history
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
// EQ-07/09: shield + bow first-person handles (left arm) and the arrow instance groups; null when the designer asset is missing.
let shieldVmH = null, bowVmH = null, arrowView = null, blockSparkAt = -1e9;
try {
  const evm = window.ASSETS && window.ASSETS.viewModels;
  if (evm && evm.shield && assets.has('model', 'shieldHeld')) shieldVmH = loadShieldView(engine.viewModel, evm.shield, gameVoxelPool);
  if (evm && evm.bow && assets.has('model', 'bowDraw3')) bowVmH = loadBowView(engine.viewModel, evm.bow, gameVoxelPool);
  if (assets.has('model', 'arrow') && assets.has('model', 'arrowStuck')) arrowView = createArrowView(engine);
} catch (e) { console.warn('[EQ-07/09] equipment views off:', e && e.message); }
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
  if (fb) { fb.depth = engine.depthBuffer; fb.gbuf = gbuf; fb.matTable = matTable; fb.light = createLightBuffer(cols, rows); }
});

// Internal hook for manual/automated smoke-testing in a console - not part
// of the game's own UI.
window.__debug = { chestHook, input, overlay, rt, engine, gbuf, matTable, ambientL, depthBuffer, sprites, wgPipeline, hzb, meshFeedStats };
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
} else if (params.get('gpucompare') === '1' || params.get('gpucompare') === 'emissive' || params.get('gpucompare') === 'shade' || params.get('gpucompare') === 'mesh') {
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
  const farHold = createFarHold(); let landCard = null; // OB-109
  const physics = params.get('physics') === 'grid' ? 'grid' : params.get('physics') === 'mesh' || renderer === 'mesh' ? 'mesh' : 'grid';
  // TREES-DEFAULT-01: mesh trees are the default forest; `?trees=voxel` is the dev fallback (design file stays pure data: it carries both species lists)
  { const ft = window.ASSETS.levels.overworld_far.recipe.forest.trees;
    if (params.get('trees') === 'voxel' && ft.speciesVoxel) ft.species = ft.speciesVoxel; }
  const worldLoadOpts = { physics,
    realTrees: renderer === 'mesh' && physics === 'mesh' && params.get('trees') !== '0',
    detail: renderer === 'mesh' && physics === 'mesh' && params.get('scatter') !== '0',
    groundLook: wgActive ? groundLookFromParams(params, window.BIOME_LOOK, window.ASSETS.levels.overworld_far) : null }; // ENV-02d (REV-MAIN: WebGPU path only - the JS twin costs +12 ms at 480x180, oracle/Node only) (ENV-02d-LIVE: the LEVEL def holds .terrain, not its inner .recipe): `?look=0` -> null // ENV-01a2: `?scatter=0` (not `?detail=0`, that is the US-028 v1-shading switch)
  // ENV-01-WIRE (38.62): GPU decor scatter, only on the WebGPU mesh renderer with the GPU cull; `?decor=cpu` keeps today's CPU layers (decorGpu false = byte-identical)
  let decorPass = null; const decorDbg = { total: 0, frameErrors: 0, bad: false };
  { const dl = ((window.ASSETS.levels.overworld_far?.recipe?.detail?.layers) || []).some((l) => l.gpu); // every early-out names its reason once (?decor=cpu is silent)
    const why = !parseDecorMode(params.get('decor'), true) ? null : !worldLoadOpts.detail ? 'detail scatter off (needs mesh renderer + mesh physics, no ?scatter=0)'
      : !wgPipeline ? 'no wgPipeline' : !wgPipeline.ready ? 'wgPipeline not ready' : rt.backend !== 'webgpu' ? 'backend ' + rt.backend : !wgPipeline._rasterPass ? 'no raster pass'
      : !dl ? 'recipe has no gpu detail layers' : '';
    if (why) console.warn('[decor] GPU decor not enabled: ' + why);
    else if (why === '') {
      decorPass = wgPipeline._rasterPass.enableDecor(); // null without the GPU cull
      if (decorPass) { worldLoadOpts.decorGpu = true; guardDecorRun(decorPass, decorDbg, console.warn); } // cumulative dispatch / error counters for __debug.decorStats
      else console.warn('[decor] GPU decor not enabled: no GPU cull pass (?gpucull=0 or no compute)');
    } }
  { // OB-073-D2f: the grass carpet (38.52); OB-096 (owner: grass everywhere, square): ON per quality preset (OB-103b/D-075 G1: low = off, medium/high/ultra scale radius+density), `?carpet=0` forces off, `?carpet=1` forces on; ramp palette keys -> 0..255 RGB triplets
    const rcp = window.ASSETS.levels.overworld_far && window.ASSETS.levels.overworld_far.recipe && window.ASSETS.levels.overworld_far.recipe.carpet;
    if (rcp && renderer === 'mesh' && carpetBuildFor(!!bootOpts.quality, params.get('carpet'))) worldLoadOpts.carpet = { ...rcp, variants: rcp.variants.map((v) => ({ ...v, ramp: v.ramp.map((k) => Array.from(hexToRgb(assets.palette.colors[k]))) })) };
    // MASK-e2 (38.52 OB-096): baked paint layer (content/grassmask/overworld_far.grassMask.json) = how much grass; World takes the layer directly
    const gm = bundle.grassMasks && bundle.grassMasks.overworld_far;
    if (worldLoadOpts.carpet && gm) worldLoadOpts.carpet.mask = grassMaskFromJSON(gm);
    if (worldLoadOpts.carpet) engine.events.on('world:loaded', (e) => { const w = (e && e.world) || engine.world; if (w && w.setCarpetQuality) w.setCarpetQuality(carpetQualityFor(resolvedQuality && resolvedQuality.knobs, params.get('carpet'))); }); // OB-103b: preset knob -> world (Settings quality change: settings.js applyQuality)
  }
  { const dp = await loadDecorPaint('overworld_far', grassMaskFromJSON); if (dp) worldLoadOpts.decorPaint = dp; } // ED-FOLIAGE-04: painted decor density (none = unchanged world)
  if (params.get('debug') === '1' || params.get('f3') === '1') overlay.toggle(); // per CLAUDE.md `?debug=1`; ME-08c `?f3=1` = F3 pass times at start
  // US-020a: arms the (one-shot) first-gesture listeners only - creates
  // nothing yet, so there is no autoplay warning and no sound before input.
  initAudio();
  setVolume(loadSettings().volume); // SETTINGS-MOUNT-01
  setMuted(loadSettings().muted); // US-060: apply the remembered mute before any sound can play
  setForestAmbienceSources({ biomeAt: (x, y) => { const u = window.ASSETS?.levels?.overworld_far?.util; return u && u.biomeAt ? u.biomeAt(x, y) : 0; }, hour: () => clockHour(engine.world.state, clockCfg) }); // OB-184: lazy lookups, silent on non-terrain worlds

  let simTime = 0;
  let clothTick = 0; // CLOTH-1b3 (33.5): integer fixed-step counter for `w.cloths.tick`/`wind.sampleInto` (rule 15: no wall clock)
  let look = null;
  let playerHandle = null;
  let decalBind = null; // DECAL-01: refreshed on load/restart.
  const entityTintTable = createEntityTintTable(); // TELEGRAPH-WIRE-01 part 2: one table, reused
  let telegraphWire = null; // TELEGRAPH-WIRE-01: rebuilt on 'world:loaded'
  let beastLegs = null; const beastLegsOn = params.get('legik') !== '0'; // ANIM-C-05
  let footIkWire = null; const footIkOn = resolveFootIk(params, isCaptureOrBench); // ANIM-IK-01b: created after world load (needs world.terrain)
  let beastBlend = null; const animblend = params.get('animblend') !== '0'; // ANIM-BLEND-03
  const grabPin = createGrabPin(() => beasts); engine.events.on('beast:grab', grabPin.onGrab); engine.events.on('world:loaded', grabPin.reset); let npcLook = null; // BEAST-08b: croc pin = movement-only
  let beastLook = null; const lookatOn = params.get('lookat') !== '0'; // ANIM-LOOKAT-01
  let beastAnim = null; const beastAnimOn = params.get('beastanim') === '1'; // ANIM-STATE-WIRE-01: default OFF (wander/return would use the walk clip)
  // WMP-05: map travel is refused in combat (aggro beast within 40 m or the hit-invuln window is up); same sim the hp-regen gate reads.
  const mapTravelBlocked = () => { const t = playerHandle && playerHandle.data.transform; return !!((vitals && vitals.invuln > 0) || (beasts && t && beasts.aggroNear(t.x, t.y, 40))); };
  let logicWire = null, logicUnreg = null; // ED-LOGIC-01c: rebuilt with the beast sim on every 'world:loaded'
  let underSpawners = []; let underScene = 'outdoor'; // UNDER-01 spawners (rebuilt with the sim); UNDER-08 cached scene flag (written by the DN-03 block)
  let beasts = null; // US-079a (29.1): rebuilt on every 'world:loaded', below
  // ED-AI-RECV: editor Creatures tab -> sim.patchArchetype over BroadcastChannel; only editor play-test / ?dev=1, never capture/bench; getSim reads the current sim (survives world reloads)
  const aiDevRun = (params.get('playtest') === '1' || params.get('dev') === '1') && !isCaptureOrBench && params.get('capture') !== '1' && !navigator.webdriver; // ED-AI-06: editor live-test runs only
  if (aiDevRun) createAiPatchRecv(broadcastFactory, () => beasts, () => (dirWire ? dirWire.director : null));
  if (aiDevRun) createQuestPatchRecv(broadcastFactory, { // ED-QUEST-07b: never in normal play; patched text is memory-only (book.toSave holds state, not defs)
    getBook: () => (saveRelay ? saveRelay.quest.book : null), getDialogues: () => bundle.dialogues, compile: compileDialogue,
    regen: (id, raw) => (questGenCtx ? (generateAll({ [id]: raw }, questGenCtx.giverDefs, questGenCtx.snip)[id] || raw) : raw) });
  let vitals = null; // US-080a1/a2 (30.2): rebuilt on every 'world:loaded', below
  let travel = null; // WS1-07b: created once below (after wakeOut)
  let dialogueCtl = null; // DIALOGUE-01b2 (38.28): rebuilt on every 'world:loaded', below
  let lifeWire = null, raidDefs = null; // LIFE-HOOKS-01
  try { raidDefs = prepareRaidDefs(await (await fetch('../content/life/raids.json')).json()); } catch (e) { console.warn('[life] raids off:', e && e.message); }
  let regionAmbTable = null, regionAmb = null; // WMP-03: content/life/regionAmbient.json; no audio cue API for birdsong/insects yet -> onCue is a no-op (knownCues [])
  try { regionAmbTable = await (await fetch('../content/life/regionAmbient.json')).json(); } catch (e) { console.warn('[regionAmbient] off:', e && e.message); }
  let goblinWire = null, goblinJson = null; // GOB-07b: goblin camps + enemy spears (content/life/goblinCamps.json)
  try { goblinJson = await (await fetch('../content/life/goblinCamps.json')).json(); } catch (e) { console.warn('[goblins] off:', e && e.message); }
  // ED-LOGIC-01d: content/logic/index.json {files:[*.logic.json], props:'props.json'} -> ASSETS.logicBlocks (content order) + ASSETS.logicProps (mesh-prop states)
  try {
    const dir = '../content/logic/', idx = await (await fetch(dir + 'index.json')).json(), blocks = [];
    for (const n of idx.files || []) blocks.push(...await (await fetch(dir + n)).json());
    window.ASSETS.logicBlocks = blocks;
    window.ASSETS.logicProps = idx.props ? await (await fetch(dir + idx.props)).json() : {};
  } catch (e) { console.warn('[logic] content off:', e && e.message); }
  Object.defineProperty(window.__debug, 'goblinWire', { configurable: true, get: () => goblinWire }); // verify-goblins
  let tileDormTick = 0; // WM-04
  let wild = null; // WILD-06: ambient fauna, rebuilt on every 'world:loaded' (= reset on load / new game / restart)
  Object.defineProperty(window.__debug, 'lifeWire', { configurable: true, get: () => lifeWire }); // LIFE-HOOKS-01: verify-raid reads/forces raids through this
  Object.defineProperty(window.__debug, 'wild', { configurable: true, get: () => (wild ? { alive: wild.stats.alive, drawn: wild.drawn ? wild.drawn() : 0 } : null) }); Object.defineProperty(window.__debug, 'wildRaw', { configurable: true, get: () => (wild ? { w: wild, pool: gameVoxelPool } : null) }); // verify-wild steps/feeds through this (headless sim never runs) // WILD-06b: read-only headless hook
  let outLife = null, lifeNav = null, lifeData = null; // LIFE-04: Outwall villagers + chat
  Object.defineProperty(window.__debug, 'outLife', { configurable: true, get: () => outLife }); // LIFE-04: tools/verify-outwall-life.mjs
  try { lifeData = { life: await (await fetch('../content/life/outwall.life.json')).json(), barks: await (await fetch('../content/dialogue/life.barks.json')).json() }; } catch (e) { console.warn('[life] villagers off:', e && e.message); }
  let outwall = null; // OUT-01: Hesk/Dorrin facing + met flags, rebuilt on 'world:loaded'
  let bearTurn = null; // NPC-BEAR-01: Burl's turn-to-player, rebuilt on every 'world:loaded'
  // COMPASS-02 (D-061): golden pocket compass, bottom-right. Resolver maps quest targets to world positions; hide rules are set in update(), drawn in render().
  const compass = createCompassHud({ style: window.ASSETS && window.ASSETS.uiStyle && window.ASSETS.uiStyle.compass });
  let compassBookVer = -1, compassTick = 0, compassWorld = null, compassBreach = null, compassHide = true;
  const COMPASS_FLAG = { 'quest.burl.boars.done': 'bear', 'quest.burl.follow.done': 'bear', 'burl.arrived': 'bear', 'waystone.waystone.woken': 'endMarker', 'waystone.ws_roadBend.woken': 'relayBend', 'waystone.ws_ford.woken': 'relayFord' };
  const COMPASS_ITEM = { sword: 'tower.sword' }; // COMPASS-QUEST-01: item step -> the level prop entity (placementId.propId)
  // PO-CH1-12: giver ids that are level props (placementId.propId) resolve through one helper for compass + map marks.
  const GIVER_ENT = { noteKeepLight: 'tower.noteKeepLight' };
  const giverEntity = (w, id) => w.get(GIVER_ENT[id] || (saveRelay && saveRelay.quest.book ? saveRelay.quest.book.entityFor(id) : id)); // QL-04: object givers / hand-ins resolve through def.giver.entity / turnInEntity
  const compassResolver = { resolve(kind, id, out) {
    const w = compassWorld; if (!w) return false;
    let e = null;
    if (kind === 'giver') e = giverEntity(w, id);
    else if (kind === 'flag') e = w.get(COMPASS_FLAG[id] || ''); // CH1-02: flag step -> the prop/NPC that sets it (Burl hand-in, bear escort, stone, relay)
    else if (kind === 'item') e = w.get(COMPASS_ITEM[id] || id);
    else if (kind === 'beast') { e = w.get(id); const h = e && e.data && e.data.components.health; if (h && h.hp <= 0) return false; }
    else if (kind === 'area') {
      if (id === 'breach') { if (!compassBreach) compassBreach = compassFindMarker(w, 'breach'); if (!compassBreach) return false; out.x = compassBreach.x; out.y = compassBreach.y; out.z = compassBreach.z; return true; }
      if (id === 'waystone') e = w.get('endMarker');
      else { // QL-B2 follow-up: data-driven - any area id with an area-only world zone (key world.<id>; hintStone = hillPath) gets an arrow
        const tr = areaTrigger(w, id === 'hintStone' ? 'hillPath' : id);
        if (tr) { out.x = tr.x; out.y = tr.y; out.z = NaN; return true; }
      }
    }
    const t = e && e.data && e.data.transform; if (!t) return false;
    out.x = t.x; out.y = t.y; out.z = t.z; return true;
  } };
  const nextCtx = { resolve: (k, id, o) => compassResolver.resolve(k, id, o), x: 0, y: 0 }; // OB-183: 'Next:' line + journal name the nearest giver
  if (saveRelay) saveRelay.quest.nextCtx = nextCtx;
  const combatHud = createCombatHud({ events: engine.events, rgb: assets.palette.rgb, band: worldBand }); // HPBAR-02 + DMGNUM-01: enemy bars + damage numbers
  combatHud.bars.bars.setDifficulty(savedSettings.difficulty); // HPBAR-03: saved Easy/Hard shifts the shown level from the start
  window.__debug.compass = compass; window.__debug.compassRetarget = () => { const b = saveRelay && saveRelay.quest.book; return b ? compass.target(b, compassResolver) : null; }; window.__debug.compassHidden = () => compassHide; // tools/verify-compass.mjs
  function compassFindMarker(w, markerId) { // structure marker -> world position (same lookup as audio/ambient.js; load-time-ish, cached)
    const o = { x: 0, y: 0, z: 0 };
    for (const st of w.structures) { const m = st.level && st.level.def && st.level.def.markers && st.level.def.markers[markerId]; if (m) { localToWorld(st.frame, m.x, m.y, m.z || 0, o); return o; } }
    return null;
  }
  const vLocked = () => !!(vitals && vitals.inputLocked) || (travel && travel.inputLocked) || deathFlow.inputLocked; // DIALOGUE-LOCK-01 (owner: never lock during game): dialogue/notes/chapter card/notices no longer lock movement or look; only menus, death, travel fade and the intro wake do. // DEATH-FLOW-01 part 2: the flow lock gates move/attack/jump/interact like the vitals lock (the virtual [E] bypasses it)
  const syncFb = () => { fbOn = fireballOn(engine.world, FEATURES); if (spellBook) { refreshLocked(LOCKED, spellBook.tiers()); if (fbOn) { delete LOCKED['spell.fireball']; delete LOCKED['potion.mp']; } } }; // SPELL-04
  const qbToast = (res) => { // EQ-12: quick-bar / potion feedback (no menu, never locks)
    const T = { none: 'No potions', full: 'Not hurt', refuse: 'Cannot use that now', empty: '' };
    if (toasts && T[res]) toasts.say(T[res], [226, 214, 176]);
  };
  const qbPlayOk = () => !!(vitals && !vitals.dead) && !wakeOut.inputLocked && !isMapOpen() && !isSettingsOpen() && !qbBlocked && !(invView && invView.isOpen) && !vLocked();
  let targeting = null; // US-128b (29.2): rebuilt on every 'world:loaded', below
  let sword = null; // US-078d (30.1): rebuilt on every 'world:loaded', below
  let hands = null; // HANDS-01b (37.8a): LMB = left-hand item, RMB = right-hand item; rebuilt with the sword sim
  let wetStones = null; // QL-19: rebuilt on every 'world:loaded'
  let swimWire = null; // SWIM-03c: water feed + gear gate, rebuilt on every 'world:loaded'
  const safeWa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
  const safeSpots = createSafeSpots(); // OB-140: last safe grounded spots for pause-menu Unstuck
  let wading = null; // RIVER-04: rebuilt on every 'world:loaded' (beasts keep their own nav block, depth >= 0.6: not wired here)
  let offerToast = null, offerToastMsg = null; // toast once per new book.nextOffers() entry
  let equipPlay = null, shieldSim = null, arrowSim = null; // EQ-07/09: rebuilt on every 'world:loaded'
  let quickbar = null, qbView = null, qbTick = 0, qbBlocked = false; // EQ-12: sim rebuilt per world, view per page
  let wardSim = null, fireRingSim = null, gustSim = null, gustView = null; // SPELL-06/07 (rebuilt per world)
  let fireball = null, fbTargets = null, spellBook = null, spellCaster = null; // SPELL-01a (37.14): rebuilt with the sword sim on every 'world:loaded'
  // US-091b: pack-screen mouse. Hover -> UI cell under the pointer; a click while open must not re-lock the pointer
  // (PlayerLook's own canvas click handler), so a capture listener on window swallows it first.
  canvas.addEventListener('mousemove', (e) => {
    if (!invView || !invView.isOpen || !ui) return;
    const r = canvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / r.width * ui.cols), cy = Math.floor((e.clientY - r.top) / r.height * ui.rows);
    invView.setPointer(cx, cy); qbDrag.move(cx, cy);
  });
  // QB-6: drag and drop onto the quick bar (drawn inside the menu). Press picks up the item under the pointer (or a bar slot), release drops.
  const qbCell = (e) => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * ui.cols), Math.floor((e.clientY - r.top) / r.height * ui.rows)]; };
  const qbDrag = createQuickbarDrag({
    slotAt: (cx, cy) => (qbView && ui ? qbView.slotAt(ui, cx, cy) : -1),
    idAt: (s) => { const q = playerHandle && playerHandle.data.components.quickbar; return q ? q[s] || null : null; },
    assign: (s, id) => !!playerHandle && itemDefs && !LOCKED[id] && qbAssign(playerHandle.data, itemDefs, s, id),
    clear: (s) => !!playerHandle && itemDefs && qbClear(playerHandle.data, s, itemDefs),
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !invView || !invView.isOpen || !ui) { qbDrag.cancel(); return; }
    const c = qbCell(e); invView.setPointer(c[0], c[1]); qbDrag.down(c[0], c[1], invView.hoverItemId);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !qbDrag.active) return;
    const c = ui ? qbCell(e) : [0, 0], res = qbDrag.up(c[0], c[1]);
    if (!res || !toasts) return;
    const nm = itemDefs && itemDefs[res.id] ? itemDefs[res.id].name : res.id, SL = ['Left mouse', 'Right mouse', 'Key 1', 'Key 2', 'Key 3', 'Key 4'];
    if (res.kind === 'assign') toasts.say(SL[res.slot] + ': ' + nm, [120, 200, 120]);
    else if (res.kind === 'clear') toasts.say(SL[res.slot] + ' cleared', [226, 214, 176]);
    else if (res.kind === 'refuse') toasts.say(res.slot < HAND_SLOTS ? 'That does not fit this hand' : 'Cannot be placed on the quick bar', [220, 110, 60]);
  });
  window.addEventListener('click', (e) => { if (invView && invView.isOpen) e.stopPropagation(); }, true);
  // US-090w: title menu pointer - hover selects, click activates; the click never reaches PlayerLook's pointer-lock handler.
  const menuCell = (e) => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * ui.cols), Math.floor((e.clientY - r.top) / r.height * ui.rows)]; };
  canvas.addEventListener('mousemove', (e) => {
    if (menuHost && menuHost.active && !isSettingsOpen()) { const c = menuCell(e); menuHost.pointer(c[0], c[1], false); }
    else if (pauseMenu && pauseUp()) { const c = menuCell(e); pauseMenu.handlePointer(c[0], c[1], false); }
  });
  window.addEventListener('click', (e) => {
    if (pauseResume.active) { pauseResume.click(); e.stopPropagation(); return; } // OB-068/072: the re-locking click is consumed (no attack, no PlayerLook double request)
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
  // CH1-MOUNT (38.37): notice banner (page lifetime) + crystal grant / barks / chapter card (rebuilt per world; only when saves are live = never in capture/bench/compare/?at=)
  const notice = createNoticeView();
const inspectObject = (id) => { // QL-04: inspect an object giver / hand-in prop: accept or hand in, show its short text (banner, never locks)
  const b = saveRelay && saveRelay.quest.book, r = b && b.inspect(id); if (!r) return null;
  if (r.action === 'offer') { if (dialogueCtl) dialogueCtl.openObject(id); return r; } // D-087: object giver = Accept/Exit dialogue, no auto-accept
  const d = b.def(b.index(r.id)); // QL-WIRE: the writer's def.lines (offer / ready / active) win over the short giver text
  notice.push(String(d.title || r.id).slice(0, 30), bannerLines(d, r.action, wrapText) || wrapText(r.text || (r.action === 'handin' ? 'Done.' : r.action === 'accept' ? 'Quest accepted.' : 'Not yet.')));
  return r;
};
const noteOffer = createNoteOffer({ getBook: () => (saveRelay ? saveRelay.quest.book : null), inspect: inspectObject }); // QFIX-S5-CLOSE: tower.blade is an objectGiver; the page opens the offer when it closes
setNoteOfferProvider((id) => noteOffer.offerFor(id)); // OB-173: the note panel itself offers [E] Accept / [Q] Close (no separate offer dialogue)
  // QL-WIRE: Ch1-2 errands: object givers (post / notePost / relays), talk.<site>, target1..3.hit (sword + arrow = combat:hit), escort flag
  const errands = createErrands({ getBook: () => (saveRelay ? saveRelay.quest.book : null), questFlag: (k, v) => saveRelay.quest.questFlag(k, v), inspect: inspectObject, note: (t, l) => notice.push(t, l), texts: inspectTexts });
  setInspectSink((id) => errands.inspected(id));
  engine.events.on('combat:hit', (p) => errands.hit(p));
  gameHooks.register({ onEvent: (name, d) => errands.onEvent(name, d) });
  window.__debug.errands = errands; let errandTick = 0;
  let regionBanner = null, regionBannerWorld = null, regionBannerBlocked = false; // REGION-01
  let crystal = null, barks = null, chapterCard = null, chapterCard2 = null, ch1Hidden = true;
  let burlReopen = false; // PO-CH1-07 latch
  let escort = null; // CH1-07 Burl escort (rebuilt per world, saves live only)
  let nub = null; const nubWtmp = {}; // NUB-01: Nub's follow behaviour (rebuilt per world, never saved)
  window.__debug.notice = notice; window.__debug.ch1Hidden = () => ch1Hidden; // tools/verify-relay-wake.mjs
  engine.events.on('beast:died', (p) => { // crystal burst lands where the last boar fell
    if (!crystal || !p || typeof p.id !== 'string') return;
    const h = engine.world.get(p.id), t = h && h.data && h.data.transform; if (t) crystal.noteBoar(t.x, t.y, t.z);
  });
  let loot = null; // US-091a2 (37.16.3): rebuilt on every 'world:loaded', after beasts + the pack
  let toasts = null; // US-091a2: the loot toast view, rebuilt with loot
  let invView = null; // US-091b: the pack screen (`I`), rebuilt with the pack
  let craftView = null, craftWasLocked = false; // MAIN-WIRE-01: crafting list (`C`), rebuilt with the pack
  let creditsInv = null; // CREDITS-MOUNT-01
  let menuHost = null; // US-090w: title menu host while it is up (null = no menu / already closed)
  let pauseMenu = null; // PAUSE-MENU-01: built once with the world, shown while the pointer is unlocked in play
  let pauseWas = false;
  const pauseResume = createPauseResume(() => { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); }); // OB-068: Esc in the pause menu resumes
  // OB-072: resumed-unlocked: ANY pointerdown / non-Esc keydown on the document is the activation gesture that re-takes the lock (a refused request = keep waiting).
  // The gesture is swallowed (swallowGesture -> input.consumePressed() next step) so it never also attacks / interacts.
  let swallowGesture = false;
  document.addEventListener('pointerdown', () => { if (pauseResume.gesture('Mouse0')) swallowGesture = true; }, true);
  document.addEventListener('keydown', (e) => { if (pauseResume.gesture(e.code)) swallowGesture = true; }, true);
  // OB-072: Keyboard Lock (Chrome/Edge, fullscreen only): Esc arrives as a keydown and the pointer lock is NOT released.
  let kbLockOn = false;
  const kbLockApi = () => (typeof navigator !== 'undefined' && navigator.keyboard && navigator.keyboard.lock ? navigator.keyboard : null);
  document.addEventListener('fullscreenchange', () => {
    const kb = kbLockApi(); if (!kb) return;
    if (document.fullscreenElement) { try { Promise.resolve(kb.lock(['Escape'])).then(() => { kbLockOn = !!document.fullscreenElement; }, () => { kbLockOn = false; }); } catch (e) { kbLockOn = false; } }
    else { kbLockOn = false; pauseResume.reset(); try { kb.unlock(); } catch (e) { /* ignore */ } }
  });
  const toggleFullscreen = () => { try { const r = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* unsupported: no change */ } };
  // True while the pause menu is the thing on screen (same gate the old overlay used, minus Settings which owns the screen).
  function pauseUp() {
    return mode === 'world' && !!look && (!look.locked || pauseResume.soft) && !pauseResume.active && !isMapOpen() && !isNoteOpen() && !isNoteEscGrace() && !(dialogueCtl && dialogueCtl.escGrace.active) && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen() // OB-049: Esc closes the note only
      && !cinematic && !isWaterfallPreview && !(menuHost && menuHost.active) && !isSettingsOpen();
  }
  // QG-05: quest log (J). Built lazily per book (reset() replaces the book); pauses like the pack via qlOpen in invOpen.
  let qlView = null, qlBook = null, qlWasLocked = false, mapQmChart = null, mapQmVer = -1;
  const qlIsOpen = () => !!(qlView && qlView.isOpen()); window.__debug.questLogSnapshot = () => (qlView ? qlView.snapshot() : null); // OB-097: tools/verify-journal.mjs
  // QG-04: giver '!'/'?' on the M card, rebuilt only when the card is open and book.version / the chart changed
  function syncMapQuestMarks() {
    const c = getMapChart(), b = saveRelay && saveRelay.quest.book;
    if (!c || !b || !isMapOpen() || (c === mapQmChart && b.version === mapQmVer)) return;
    mapQmChart = c; mapQmVer = b.version;
    const a = [], r = [], list = []; b.giverMarks(a, r);
    for (const [ids, kind] of [[a, 'quest'], [r, 'questReady']]) for (const id of ids) {
      const e = giverEntity(engine.world, id), t = e && e.data && e.data.transform; if (t) list.push({ kind, x: t.x, y: t.y });
    }
    c.setQuestMarkers(list);
  }
  let invWasLocked = false; // pointer lock state when the pack opened (re-lock on close)
  let waterfallHooks = null;
  const creepFirst = createFirstEntry(); let underCreep = null, creepSt = { amb: 1, fl: 1 }, creepMistBase = 0; let ambientMotes = null, fireflies = null; // FIREFLY-NIGHT-01: night-only, same flag as ambientMotes (off on Low), indoor/underground probe inside
  const fxHook = createFxHook(resolveFx(params, rt.backend, resolvedQuality && resolvedQuality.knobs)); window.__debug.fxHook = fxHook; // CONTACT-AO-01c / CANOPY-SHAFT-01c: lights.cao / lights.shaft only on WebGPU high+ (null otherwise)
  let lightSet = null; let giWire = null; const giCfg = resolveGI(params, resolvedQuality && resolvedQuality.name, wgActive); // GI-PROBE-06: baked bounce light; `?gi=0` = null = today's frames
  // US-006: built from the loaded world's level.def.lights, below
  const atmosLast = { w: null }; engine.events.on('world:loaded', () => { atmosLast.w = null; }); // REV-MAIN: forces a snap on the next atmosphere step
   let fogHour = null; const applyFogHour = (P, h) => { if (!fogHour && window.FOG_HOUR) fogHour = createFogHour(P, window.FOG_HOUR); if (fogHour) fogHour.apply(h); }; // NIGHT-HAZE-01: far fog colour follows the hour
   let atmosDrv = null, atmosCfg = null, atmosV = -1, atmosBase = null; const atmosState = createAtmosState(); // ENV-03: biome atmosphere driver (null = off)
  const postQ = resolvedQuality && resolvedQuality.name, postCfg0 = resolvePost(window.POST_LOOK, params, postQ, 'outdoor'), postState = createPostState(); let postCfg = postCfg0, postV = -2; const sceneScratch = {}; let sceneNow = 'outdoor'; // SCENE-INTERIOR: sceneOf() flag; postCfg re-resolved only on change // POST-STACK-01c: `?post=0` = null = today's frames; scene stays 'outdoor' until an interior flag exists
  let clockDriver = null; // DN-03: step-quantised sun/look/ambient driver, rebuilt on every 'world:loaded'
  let clockTimeApplied = false; // DN-03: ?time= seeds the clock once, not on every restart
  let worldSunPath = null; // US-122a: fit the load-time sun before static/cinematic hour writes.
  const cinematicHours = cinematic && Number.isFinite(cinematic.keys[0].hour);
  let wasPaused = false; // US-062: edge-detects isPaused() to drive duck/resume + accumulator reset once
  if (mode === 'world' && !isCaptureOrBench && params.get('nopause') !== '1') installAutoPause(); // US-062: blur/hidden -> forced pause, never auto-resumed

  // Reused every physics step (architecture.md section 9 rule 9.3: no
  // per-step allocations) - US-009 hoisted this out of update()'s body,
  // where it used to be rebuilt as a fresh object literal every call.
  const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
  const eqCtx = { gate: false, fx: 0, fy: 1, fz: 0, ex: 0, ey: 0, ez: 0, px: 0, py: 0, pz: 0, interact: false }; // EQ-07/09: reused per-step context
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
  const placePlayer = (pose) => { // shared by map travel and OB-140 Unstuck
      const t = playerHandle.data.transform, b = playerHandle.data.components.body;
      t.x = pose.x; t.y = pose.y; t.z = pose.z; t.yawDeg = pose.yawDeg; // anchor = a known-safe spot (the pose at the touch)
      if (b) { b.vx = 0; b.vy = 0; b.vz = 0; b.fallDistance = 0; }
      hzb.invalidate('travel');
      ensureBand(engine.world, pose); // WS2-05/MAP-13: band for the target (any grid zone) while black
      if (beasts) beasts.resetAll();
      if (targeting) targeting.clear();
      if (look) { look.clearLock(); look.yawDeg = t.yawDeg; look.pitchDeg = t.pitchDeg; }
      if (vitals) vitals.clearSafe();
  };
  travel = createTravel({
    canTravel: () => !!(vitals && !vitals.dead && !wakeOut.inputLocked && !(dialogueCtl && dialogueCtl.open) && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen()),
    anchorOf: (id) => (waystoneWire && waystoneWire.sim ? waystoneWire.sim.anchor(id) : null),
    playerPos: () => playerHandle.data.transform,
    teleport: placePlayer,
    bandReady: () => bandReady(engine.world), // MAP-13: WS2-05: fade-in waits for the band (ensureBandFor is synchronous, so true at once)
    arrive: (id, pose) => { if (waystoneWire && waystoneWire.sim) waystoneWire.sim.touch(id, pose); }, // respawn point = target (heal + save)
  });
  const wakeOut = { blackA: 1, blinkOpen: 0, eyeH: 0, inputLocked: true, titleState: 'none', titleA: 0, wakeDoneAtSec: 0, titleDoneAtSec: 0 };
  const wakeCfg = { blackSec: 1.0, riseSec: 1.2, blinkCurve: [[0, 0], [1.5, 1]], titleIn: 1, titleHold: 3, titleOut: 1, startEyeH: 0.3, bodyEyeH: 1.6 };
  let questUiActive = false;
  const actionSig = { invOpen: false, journalOpen: false, swing: false, block: false, shot: false, swap: false, slotKey: false, questAccepted: false }; // FS-01
  let actSwapT = 0, actShotTick = 0;
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
      : (() => { // US-034 (24.11): the play-test handoff's `?world=` param
        const wd = assets.world(params.get('world') || 'world_m1');
        if (gridEnabled(params)) return wd.terrainBands ? gridVariant(wd, window.ASSETS.levels.world_geo) : wd; // WM-05: world_m1 ships terrainGrid + polygon bounds (default)
        return wd.terrainGrid ? legacyVariant(wd) : wd; // ?grid=0: old terrainBands + capsule bounds for one sprint
      })();

    // US-017 (7.4 "Restart / world swap"): every runtime rebuild this block
    // used to do ONCE, inline, now happens on `'world:loaded'` - emitted by
    // `World.load` on the first `engine.loadWorld` call below AND by
    // `engine.setWorld` on every later restart (`R`, see `update()`) - so a
    // restart rebuilds `playerHandle`/`look`/`lightSet` exactly the same
    // way the first load did, with no separate hand-written reset path
    // (architecture.md 7.4's "module-level game variables are reset only in
    // the 'world:loaded' handler" rule).
    engine.events.on('world:band', (ev) => { // WM-04: the nav tile swapped with the band -> beasts rebind + re-plan, dormancy by tile
      if (beasts && ev && ev.nav && playerHandle) { const pt = playerHandle.data.transform; beasts.rebindNav(ev.nav, pt.x, pt.y); }
      if (outLife && ev && ev.nav && playerHandle) { const pt = playerHandle.data.transform; outLife.rebindNav(ev.nav, pt.x, pt.y); } // OUT-LIFE-TILE: villagers follow the tile too
    });
    engine.events.on('world:band', () => hzb.invalidate('band')); // WS2-05: near/far seam jumped -> cut the HZB + stable history
    // OB-073-D2f: hand the GPU carpet pass the class map + near heights on every world load / band swap (version bump re-uploads)
    let carpetVer = 0;
    const pushCarpet = (wIn) => { const w = wIn || engine.world, nb = w && w.terrain && w.terrain.near; if (!wgPipeline || !wgPipeline.setCarpet) return; if (!w || !w.carpet || !nb) { wgPipeline.setCarpet(null, null, 0); return; } wgPipeline.setCarpet(w.carpet, { data: nb.hDraw, w: nb.w, h: nb.h, x0: nb.x0, y0: nb.y0, cell: nb.cell }, ++carpetVer); };
    // ENV-01-WIRE: configure the decor pass once per world, then hand it the band's baked masks + near heights (re-uploaded only when they change)
    let decorWorld = null, decorLast = null, decorVer = 0, decorWarned = false; // decorVer: numeric version for setMasks + setNear, bumped per event (Terrain edits write hDraw in place, like the carpet)
    const pushDecor = (wIn) => {
      if (!decorPass || decorDbg.bad) return;
      const w = wIn || engine.world || decorLast, nb = w && w.terrain && w.terrain.near; // engine.world is not swapped in yet while World.load emits world:loaded/scatter: remember the event's world
      if (wIn) decorLast = wIn;
      if (!w) return; // nothing to push yet (never switch a configured pass off for a missing world)
      if (!w || !w.decorGpu || !w.decor || !nb) { decorPass.setMasks(null, 0); decorPass.setNear(null, 0); { const why = 'world ' + !!w + ', decorGpu ' + !!(w && w.decorGpu) + ', decor masks ' + !!(w && w.decor) + ', near band ' + !!nb; if (why !== decorWarned) { decorWarned = why; console.warn('[decor] pushDecor: pass stays off (' + why + ')'); } } return; }
      try {
        if (decorWorld !== w) {
          const cq = w.carpetQuality, built = buildDecorConfig(w.terrain.recipe.recipe.detail, (id) => assets.mesh(id), {
            density: resolvedQuality && resolvedQuality.knobs ? resolvedQuality.knobs.decorDensity : 1,
            carpetRadiusM: w.carpet && cq && cq.on ? (w.carpet.cfg.radiusM || 12) * cq.radiusScale : 0, warn: console.warn });
          if (!built) { decorDbg.bad = true; console.warn('[decor] GPU decor disabled: no gpu layers in the recipe'); return; }
          decorPass.configure(built.cfg); decorWorld = w;
        }
        ++decorVer; decorPass.setMasks(w.decor, decorVer); decorPass.setNear({ data: nb.hDraw, w: nb.w, h: nb.h, x0: nb.x0, y0: nb.y0, cell: nb.cell }, decorVer);
      } catch (e) { decorDbg.bad = true; decorPass.setMasks(null, 0); console.warn('[decor] GPU decor disabled: ' + (e && e.message)); }
    };
    engine.events.on('world:loaded', (e) => pushDecor(e && e.world)); engine.events.on('world:band', () => pushDecor()); engine.events.on('world:scatter', (e) => pushDecor(e && e.world));
    window.__debug = window.__debug || {}; // verify-decor.mjs: count = candidate lattice cells of the last frame (no readback), dispatches/frameErrors cumulative
    window.__debug.decorStats = () => ({ on: !!(decorPass && decorPass.on), count: decorPass ? decorPass.stats.lastThreads : 0, dispatches: decorDbg.total, frameErrors: decorDbg.frameErrors });
    engine.events.on('world:loaded', (e) => pushCarpet(e && e.world)); engine.events.on('world:band', () => pushCarpet()); engine.events.on('world:scatter', () => pushCarpet()); // review 12d: refreshTerrainScatter rebuilds the carpet too // the event's world: engine.world is not swapped yet when world:loaded fires
    engine.events.on('world:loaded', (evt) => {
      const world = evt.world;
      bootMark('world:loaded (world built, handler start)');
      if (saveRelay) saveRelay.onWorldLoaded(); // US-089w: consume a pending restore (or reset game data on restart) before any sim is created
      decalBind = bindDecals(engine.overlay, world.decals);
      if (cinematic || Number.isFinite(timeHour) || !clockFrozen) worldSunPath = sunPathFrom(world.sun || assets.palette.lights.sun);
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
        footIkWire = footIkOn && kitFootCells && world.terrain ? createFootIkWire({ pool: gameVoxelPool, createFootIk, voxelPointWorld, footCells: kitFootCells, ground: createSupportGround(world), /* FOOTIK-WIRE-FIX: floors, not bare terrain */ offFor: (e) => { if (!playerHandle || e !== playerHandle.data) return false; const b = e.components && e.components.body; return !!b && (b.swimming || b.grounded === false); } }) : null; // ANIM-IK-01b
        giWire = giCfg && lightSet ? createGIWire(giCfg, world, lightSet) : null; if (giWire && world.loadGI) giLoadOptions((u) => fetch(u).then((r) => (r.ok ? r.text() : null)), '../content/gi/manifest.json').then((o) => world.loadGI(o)).catch(() => {}); // GI-PROBE-07: manifest hashes, missing = quiet {} // GI-PROBE-06: no expectHash (the bake tool writes no manifest; the runtime cannot hash); missing files = quiet null
        // `?sun=0`: keep the sun's direction/color (F6/F7 still readable) but
        // force it off - `setSun` is the only writer of `on`.
        if (!sunEnabled) lightSet.setSun({ elevation: lightSet.sun.elevation, azimuth: lightSet.sun.azimuth, on: false });
      }
      clockDriver = null;
      if (!clockFrozen && assets.palette.daySchedule) {
        // DN-03 (38.39 item 4/7): hour from world.state (restored by the save relay above); a forced step makes the first frame right.
        if (!clockTimeApplied) seedClockFromParam(world.state, timeHour);
        clockTimeApplied = true;
        const P = assets.palette;
        // DN-02 (owner: shadows must not visibly move): the light/shadow sun (lightSet.sun) only follows the clock in 30 game-minute slots,
        // eased over SHADOW_EASE_STEPS steps; world.sun (sky glow, fog, terrain sun) + sky/ambient/colours stay smooth every step.
        let shadowHour = NaN, steps = 0;
        const SHADOW_SLOT_H = 0.5, SHADOW_EASE_STEPS = 4;
        clockDriver = createClockDriver((hq, force) => {
          const target = Math.floor(hq / SHADOW_SLOT_H) * SHADOW_SLOT_H;
          let dh = ((target - shadowHour + 36) % 24) - 12; // signed, wrapped
          if (!(Math.abs(dh) <= SHADOW_SLOT_H * 1.01) || force) { shadowHour = target; dh = 0; steps = 0; } // load / jump / first step: snap
          else if (dh !== 0) { const st = SHADOW_SLOT_H / SHADOW_EASE_STEPS; shadowHour = Math.abs(dh) <= st + 1e-9 ? target : shadowHour + Math.sign(dh) * st; }
          shadowHour = ((shadowHour % 24) + 24) % 24;
          const gMoon = applySunPair(world, lightSet, shadowHour, hq, worldSunPath, sunEnabled); if (giWire) giWire.clock(hq, gMoon); // GI-PROBE-06: mix on hour step only // AUD2-02: ONE sun/moon decision for the stepped light/shadow sun and the smooth world.sun
          const L = blendLook(P, hq, P.daySchedule);
          applyFogHour(P, hq);
          if (lightSet) { const hu = P.hue[L.ambient]; lightSet.ambient[0] = hu[0] * L.ambientI; lightSet.ambient[1] = hu[1] * L.ambientI; lightSet.ambient[2] = hu[2] * L.ambientI; creepSt.amb = 1; }
        });
        clockDriver.update(clockHour(world.state, clockCfg), true);
        { const G = window.ASSETS.levels.world_geo, far = window.ASSETS.levels.overworld_far, f = P.fog && (P.fog.farBase || P.fog.far); // ENV-03: only with BIOME_LOOK + geo biomes + terrain (and a running clock: capture/gpucompare never get a driver)
          if (!atmosDrv && params.get('atmos') !== '0' && window.BIOME_LOOK && G && G.biomes && far && far.util && far.util.biomeBlend && f) {
            atmosCfg = buildAtmosConfig(window.BIOME_LOOK, G.biomes); atmosBase = /* NIGHT-HAZE: night biome haze works only because near/far are the same arrays fogHour writes in place */ { start: f.start, full: f.full, curve: f.curve || 1, near: P.rgb[f.color], far: P.rgb[f.colorFar] };
            atmosDrv = createAtmosDriver({ nEntries: atmosCfg.table.n, biomeToEntry: atmosCfg.biomeToEntry, biomeBlend: (x, y, o) => far.util.biomeBlend(x, y, o), schedule: P.daySchedule, slotOf: { morning: 0, noon: 0, dusk: 1, night: 2 }, frozenSlot: 0 }); } }
      } else if (cinematic && !cinematicHours && params.has('cinehour') && Number.isFinite(parseFloat(params.get('cinehour'))) && assets.palette.daySchedule) {
        // capture-cinematic `--hour H` (dev only): clock frozen at H with the FULL live look (sun/moon pair, sky, fog colour, clouds, ambient), like gpucompare's applyHourOverride
        const P = assets.palette, hr = ((parseFloat(params.get('cinehour')) % 24) + 24) % 24;
        seedClockFromParam(world.state, hr); clockTimeApplied = true;
        applySunPair(world, lightSet, hr, hr, worldSunPath, sunEnabled);
        const L = blendLook(P, hr, P.daySchedule);
        applyFogHour(P, hr);
        if (lightSet) { const hu = P.hue[L.ambient]; for (let i = 0; i < 3; i++) lightSet.ambient[i] = hu[i] * L.ambientI; }
      } else if (Number.isFinite(timeHour)) { applyFogHour(assets.palette, timeHour); if (!clockTimeApplied) { seedClockFromParam(world.state, timeHour); clockTimeApplied = true; } applySunHours(world, lightSet, timeHour, worldSunPath, sunEnabled); } // frozen clock: the NPC schedules still read the ?time= hour
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
      if (cinematic && params.get('clean') === '1' && playerHandle) { const pv = playerHandle.data.components.voxel; if (pv) { pv.hidden = true; world.renderVersion++; } } // capture-cinematic --clean: no player body in teaser frames (HUD/hands/markers are already off in cinematic)
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
      if (fireflies) fireflies.dispose();
      if (underCreep) underCreep.dispose(); creepSt = { amb: 1, fl: 1 }; underCreep = createUnderCreep(engine.particles, { enabled: params.get('creep') !== '0' && !isCaptureOrBench && params.get('capture') !== '1', quality: resolvedQuality && resolvedQuality.name, rgb: assets.palette.rgb }); // UNDER-LIGHT-CREEP-01
      // S8-B1-18 (closes US-019): ambient dust motes, off with ?ambient=0 and on the Low preset.
      ambientMotes = createAmbientMotes(world, engine.particles, { enabled: params.get('ambient') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !(resolvedQuality && resolvedQuality.name === 'low'), rgb: assets.palette.rgb, palette: assets.palette });
      fireflies = createFireflies(fireflyProbes(world, assets.palette), engine.particles, { enabled: params.get('ambient') !== '0' && !isCaptureOrBench && params.get('capture') !== '1' && !(resolvedQuality && resolvedQuality.name === 'low') }); // FIREFLY-NIGHT-01
      // US-079a (29.1): rebuilt on every load/restart, same precedent as lightSet above.
      // US-078d: beastSim now owns a `combat:hit` listener (the stagger behaviour) - drop the old world's one
      // before creating the next, same "dispose before re-create" precedent as targeting/vitals below.
      if (wild && wild.dispose) wild.dispose();
      wild = null; regionAmb = null; engine.feedVoxels = null; // WILD-06: off in capture/bench/compare/cinematic, `?at=`/`?pose=` dev poses and `?fauna=0`
      if (mode === 'world' && !cinematic && params.get('fauna') !== '0' && !isCaptureOrBench && params.get('capture') !== '1') {
        try { wild = createWild({ world, pool: gameVoxelPool, fx: window.ASSETS.wildlifeFx, seed: 0x5EED, events: engine.events, legIk: new URLSearchParams(location.search).get('legik') !== '0' }); if (wild) engine.feedVoxels = wild.feed; regionAmb = bootRegionAmbient({ table: regionAmbTable, geo: window.ASSETS.levels && window.ASSETS.levels.world_geo, wild }); } catch (err) { console.warn('[wild] fauna off:', err && err.message); }
      }
      if (beasts) beasts.dispose();
      if (params.get('bench') === 'combat' || (benchActive && params.get('enemies') === '4')) ensureBenchBoars(world); // COMBAT-BENCH-01
      ensureWolves(world); // WOLF-01: turns MAP-26 anchors wolf1..5 into wolf beasts (no-op while they are absent)
      ensureBears(world); // BEAR-01: blackBear1..3 -> bear beasts
      if (goblinWire) { goblinWire.dispose(); goblinWire = null; } // GOB-07b: before the new sim (camps add members)
      if (goblinJson && !isCaptureOrBench && mode === 'world') goblinWire = createGoblinWire({ world, events: engine.events, state: world.state, json: goblinJson, terrain: world.terrain, groundAt: (x, y) => world.terrain.groundAt(x, y) });
      // WM-04 (38.59 dec. 3): grid worlds (?grid=1) have no fixed nav.area - the world builds one nav tile per band with the SAME params as the fixed grid
      // and swaps it on world:band; beasts start on the live tile. Fixed-area worlds (default) keep buildBeastNav byte-identical.
      if (world.terrainGrid && worldDef.nav) {
        const nc = worldDef.nav;
        world.setNavTiles({ create: (x0, y0, w, h, cell) => new NavGrid({ x0, y0, w, h, cell }), maxSlopeDeg: nc.maxSlopeDeg ?? 30, maxStepM: nc.maxStepM ?? Infinity, blockedTypes: nc.blockedTypes ?? ['water'] });
      }
      const gridNav = world.terrainGrid && world.nav ? { grid: world.nav, astar: createAStar(world.nav) } : null;
      let regionalList = null; // BEAST-06a: the spawned herd list feeds the spawn director
      bootRegionalBeasts(world, window.ASSETS?.levels?.world_geo, params, isCaptureOrBench, (w, g, sd) => (regionalList = spawnRegionalBeasts(w, g, sd, undefined, loadSettings().difficulty))); // BH2-G1: group size/elites follow the difficulty at world load (a Settings change applies to group size on the NEXT world load; elites/tactics switch live)
      // // WM-12: regional herds, after World.load, before the sim
      if (goblinWire && world.terrainGrid && gridEnabled(params)) { // WMP-02: far goblin camps, last in slot order (authored, regional, far camps)
        goblinWire.addFarCamps(planWorldLife(world, window.ASSETS?.levels?.world_geo, 12, loadSettings().difficulty).camps); // WMP-09: authored-only avoid, same defs on Continue
      }
      if (aiDevRun) addAiReserve(world, 12, [0, 0]); // ED-AI-06: parked test creatures (never in normal play)
      beasts = createBeastSim(world, { tileNav: !!gridNav, nav: (lifeNav = gridNav || (worldDef.nav && buildBeastNav(world, worldDef.nav))), rng: createRng(worldDef.nav?.seed ?? 1), events: engine.events, band: worldBand, fauna: wild ? wild.fauna : null, playerMaxHp: VITALS_DEFAULTS.maxHp, hpPerDamage: VITALS_DEFAULTS.beastDamageScale, difficulty: loadSettings().difficulty /* OB-150: 'easy'|'normal'|'hard'; Settings > Difficulty (DIFF-MENU), read on each world load; live change via beasts.setDifficulty */, waterNav: gridNav ? (() => { try { return buildWaterNav(world, gridNav.grid); } catch (e) { return null; } })() : null }); // LIFE-07: predators hunt the ambient fauna
      questBeastSim = beasts;
      // ED-LOGIC-01c: logic wire, rebuilt with every sim; no blocks (01d loads them) = nothing registered, nothing written
      if (logicUnreg) { logicUnreg(); logicUnreg = null; } if (logicWire && logicWire.dispose) logicWire.dispose(); logicWire = null;
      { const lb = (window.ASSETS && window.ASSETS.logicBlocks) || []; // 01d: content/logic/*.logic.json blocks; hint/sound callbacks wired with 01d
        if (lb.length && saveRelay) {
          try {
            logicWire = createLogicWire({ world, blocks: lb, book: saveRelay.quest.book, inventory: playerHandle && playerHandle.data.components.inventory, sim: beasts, nav: world.nav, hooks: gameHooks, meshStates: window.ASSETS.logicProps, hint: (id) => requestHint(world, assets.uiStyle, id), feed: (e) => saveRelay.quest.feed(e), player: () => playerHandle && playerHandle.data.transform });
            logicUnreg = gameHooks.register(logicWire.handlers()); logicWire.onWorldLoaded();
          } catch (err) { console.warn('[logic] wire failed:', err && err.message); logicWire = null; }
        } }
      if (dirWire) { dirWire.dispose(); dirWire = null; } // BEAST-06a: regional respawn director (off in capture/bench like the herds)
      if (regionalList && regionalList.length && !isCaptureOrBench) { try { // answer c: groups '<region>/<group>', bind(sim) slot->group, beast:died -> slotDied(slot), state 'spawnDirector.v1'
        const dirSeed = worldDef.nav?.seed ?? 1, dirMembers = regionalMembers(regionalList, (id) => beasts.slotOf(id)), dirGroups = buildGroups(dirMembers, dirSeed);
        let dw = null; const dir = createSpawnDirector({ groups: dirGroups, dayLenSec: clockCfg.dayLenS, viewHalfRad: HFOV_DEG * Math.PI / 360, los: (ax, ay, bx, by) => hasLineOfSight(world, ax, ay, world.terrain.heightAt(ax, ay) + 1.6, bx, by, world.terrain.heightAt(bx, by) + 1), onRespawn: (gi, g) => dw.respawn(gi, g), seed: dirSeed, firstSlot: dirMembers.length, // ED-AI-05b: live area edits park members only when the sim really holds that id at that slot
          onDespawn: (g, k) => { const m = g.members[k], sl = g.slots[k]; if (m && beasts.slotOf(m.id) === sl && beasts.setDown) beasts.setDown(sl, true); } });
        dw = createDirectorWire({ director: dir, sim: beasts, events: engine.events }); dw.load(world.state); dirWire = dw;
      } catch (err) { console.warn('[director] wire failed:', err && err.message); dirWire = null; } }
      combatHud.setSim(beasts); // HPBAR-02 + DMGNUM-01
      underSpawners = []; try { for (const site of UNDER_SITES) underSpawners.push(createUnderSpawner({ sim: beasts, site, state: world.state, structureAt: (x, y) => world.structureAt(x, y) })); } catch (err) { console.warn('[under] spawner failed:', err && err.message); underSpawners = []; } // UNDER-01
      { const ce = world.entity && world.entity('cemetery1'), cp = ce && (ce.transform || ce); // UNDER-08: no cemetery entity -> module default anchor
        setUndergroundSources({ anchors: cp && Number.isFinite(cp.x) ? [{ x: cp.x, y: cp.y }] : null, sceneOf: () => underScene, ambienceAt: (x, y) => { const st = world.structureAt(x, y); return (st && st.level && st.level.ambience) || null; }, hour: () => clockHour(world.state, clockCfg) }); }
      if (goblinWire) goblinWire.attach(beasts, { onClank: () => playShieldClank() }); // GOB-07b: camps + spear sim + view
      if (lifeWire) { lifeWire.dispose(); lifeWire = null; } // LIFE-08: night raids (content/life/raids.json), rebuilt with every beast sim
      if (raidDefs && !isCaptureOrBench && mode === 'world') lifeWire = createLifeWire({ ...raidDefs, campDefs: goblinWire ? goblinWire.campDefs : undefined, sim: beasts, events: engine.events, state: world.state, world, book: () => (saveRelay ? saveRelay.quest.book : null) });
      if (telegraphWire) telegraphWire.dispose(); // TELEGRAPH-WIRE-01 part 1
      telegraphWire = wireTelegraphs(engine.events, world, beasts, telegraphsEnabled(params, isCaptureOrBench));
      if (saveRelay) saveRelay.applyDeadToBeasts(beasts); // US-089w: restored dead beasts stay gone (create reset them alive)
      if (sword) sword.dispose();
      sword = createSwordSim(world, engine.events, SWORD_CFG, { spendMana: (n) => vitals && vitals.spendMana(n) }); // US-078d (30.1)
      hands = createHands(engine.events); // HANDS-01b: fresh router per load (the inventory is seeded just below)
      hands.register('sword', sword);
      if (fbTargets) fbTargets.dispose();
      fbTargets = createTargetables(world, engine.events);
      spellBook = createSpellBook(world.state); spellCaster = createSpellDispatcher((id) => spellBook.tier(id) || (id === 'fireball' && fbOn ? 1 : 0)); // SPELL-04
      fireball = createFireballSim(world, engine.events, FIREBALL_CFG, fbTargets, { spendMana: (n) => vitals && vitals.spendMana(n), isEnabled: () => fireballOn(world, FEATURES), tier: () => spellBook.tier('fireball') || 1, damageMul: () => { const c = playerHandle && playerHandle.data.components; return computeTotals(c && c.rolledGear || null, fbTotals).fireDmgMul; } }); // INT: stats fireDmgMul at cast (rolled gear: rolledGear.js)
      hands.register('spell.fireball', fireball); spellCaster.register('fireball', () => fireball.requestTap());
      // SPELL-06/07 registrations (learned-only: the dispatcher answers 'locked' at tier 0)
      wardSim = createWardSim({ spendMana: (n) => vitals && vitals.spendMana(n), tier: () => spellBook.tier('ward') || 1 }); spellCaster.register('ward', () => wardSim.cast());
      fireRingSim = createFireRingSim(fireball, { spendMana: (n) => vitals && vitals.spendMana(n), tier: () => spellBook.tier('fireRing') || 1, damageMul: () => { const c = playerHandle && playerHandle.data.components; return computeTotals(c && c.rolledGear || null, fbTotals).fireDmgMul; } }); spellCaster.register('fireRing', () => fireRingSim.cast(playerHandle.data));
      gustSim = createGustSim(world, engine.events, fbTargets, { spendMana: (n) => vitals && vitals.spendMana(n), tier: () => spellBook.tier('gust') || 1 }); spellCaster.register('gust', () => gustSim.requestCast());
      if (gustView) gustView.dispose(); gustView = isCaptureOrBench ? null : createGustView({ particles: engine.particles, events: engine.events }); // SPELL-07b: wind streaks + hit puff (off in capture/bench)
      // EQ-07/09 (38.41): shield sim + arrow sim + the routing glue; shield/bow items get no-op sims so the router arms them (RMB -> left hand, LMB -> right hand)
      shieldSim = createShieldSim();
      arrowSim = createArrowSim(world, engine.events, BOW_CFG, fbTargets, wadeArrowHit);
      safeSpots.reset();
      wading = createWading(world);
      swimWire = createSwimWire(world); // SWIM-03c: needs world.waterAt / flowAt
      wetStones = createWetStones(worldDef.structures); // QL-19
      if (itemDefs) registerGearItems(hands, itemDefs, () => createStubItemSim());
      equipPlay = createEquipPlay({ hands, shield: shieldSim, arrows: arrowSim, defs: itemDefs || {}, bowCfg: BOW_CFG, swordDamage: SWORD_CFG.light.damage,
        say: (t) => { if (toasts) toasts.say(t, [226, 214, 176]); } });
      quickbar = itemDefs ? createQuickbar(itemDefs, undefined, (id, pl) => spellCaster ? spellCaster.cast(id, pl) : 'empty') : null; qbTick = 0; // EQ-12: sip timer lives per world
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
      vitals = createVitals(world, engine.events, VITALS_DEFAULTS, { beasts, targeting, block: shieldSim, absorb: (n) => (wardSim ? wardSim.absorb(n) : n), // SPELL-06 absorb hook; EQ-07: hooks.block = the shield sim
        dmgMul: () => (beasts && beasts.difficulty ? beasts.difficulty.playerDmg : 1), // BH2-G1: sim.difficulty is the resolved row (kept current by applyDifficulty/setDifficulty)
        defence: () => { const c = playerHandle && playerHandle.data.components; return c && c.equipment && itemDefs ? defenceOf(c.equipment, itemDefs) : 0; }, // EQ-02
        defenceBonus: () => { const c = playerHandle && playerHandle.data.components; return c && c.equipment && itemDefs ? nightBonus(c.equipment, itemDefs, clockHour(world.state, clockCfg)) : 0; }, // QL-19: night cloak +10 %
        respawnPose: () => { hzb.invalidate('respawn'); const rp = gameHooks.respawn(); ensureBand(world, rp); return rp; }, // WS2-05: band for the respawn pose // seam onRespawn(): first non-null {x,y,z,yawDeg} wins
        onDied: (t) => { gameHooks.emitSimple('player:died', t.x, t.y, t.z); deathFlow.died(performance.now()); },
        syncFacing: (t) => {
          if (!look) return;
          look.clearLock();
          look.yawDeg = t.yawDeg; look.pitchDeg = t.pitchDeg;
        },
      });
      if (swimWire) { const gg = window.ASSETS.levels.world_geo, sh = world.get('seaMonster'); swimWire.bindVitals(vitals, { shore: gg && gg.coast ? createShore(gg.coast) : null, ripples, ent: sh ? sh.data : null }); window.__debug.swimWire = swimWire; } // SWIM-HOOKS-01: stamina ring + sea monster (entity optional)
      resetPickups(world); // BUG-PICKUP-001: reindex retained drops on every load/restart.
      applyDoorState(world); // DOOR-TOGGLE-01: tower door prop/collider/prompt follow the saved tower.door.open
      removeSwordIfTaken(world); // US-078c: a world with the flag already set shouldn't show a taken sword
      // US-091a1 (37.16.4 + 37.8a demo start): seed the pack only when missing, BEFORE
      // `initialState = serialize(...)` below, so `R` restarts keep the start pack. Owner answer 2: the
      // fireball is known from the start in the right hand; the sword is taken in the tower (swordTake.js
      // adds it to the pack + left hand), so the demo pack holds the fireball only. `?demo=0` = empty pack.
      // An old save whose sword flag is already set migrates: sword in the pack + left hand.
      ensureInventory(playerHandle.data, startFor(params.get('demo') !== '0', fireballOn(engine.world, FEATURES))); // startConfig.js (fireball locked -> empty right hand)
      if (!window.__fbEquipHooked) window.__fbEquipHooked = true, engine.events.on('magic.unlocked', () => { const c = playerHandle && playerHandle.data.components; if (c && c.inventory && c.equipment && itemDefs && c.equipment.off === null && c.equipment.set !== 'ranged') equipItem(c.inventory, c.equipment, itemDefs, 'spell.fireball'); }); // FB-01/03 fix: the unlock puts the spell into the free off hand (RMB); hands are derived from equipment, so inventory.right alone never held it
      if (world.state['tower.sword.taken'] && itemDefs) migrateSword(playerHandle.data.components.inventory, itemDefs);
      if (qstateItems && itemDefs) { for (const it of qstateItems) addItem(playerHandle.data.components.inventory, itemDefs, it.id, it.n); qstateItems = null; } // ED-QUEST-07: preset grants
      if (itemDefs) migrateEquipment(playerHandle.data, itemDefs); // EQ-02: old saves sword->main, shield->off (before initialState)
      // US-091a2 (37.16.3): corpse loot + toast. Own RNG stream (nav seed ^ salt) so the beast wander RNG is never
      // perturbed; `beast.loot` (quest/index.js) reaches this load's sim through setLootApi.
      if (loot) loot.dispose();
      loot = itemDefs ? createLoot(world, engine.events, { items: itemDefs, beasts, table: LOOT_TABLE.boar, band: worldBand,
        rng: createRng(((worldDef.nav?.seed ?? 1) ^ LOOT_SEED_SALT) >>> 0),
        inventoryOf: () => playerHandle.data.components.inventory || null }) : null;
      setLootApi(loot); window.__debug.loot = loot; // OB-064: tools/verify-boar-loot.mjs
      // WS1-06b: one [E] interactable per kind:'relay' point (crystal-gated wake; woken ones restore awake from world.state).
      relayWake = createRelayWake({ stoneAccepted: () => !!(saveRelay && saveRelay.quest.book.statusOf('burl.stone') >= 2), questFlag: saveEnabled && saveRelay ? (k) => saveRelay.quest.questFlag(k) : undefined, world, palette: assets.palette, notice: saveEnabled ? notice : null, emit: (id, kind, p) => gameHooks.emitSimple('prop:touched', id, kind, p) });
      setRelayWakeApi(relayWake); window.__debug.relayWake = relayWake; // tools/verify-relay-wake.mjs
      // DIALOGUE-01b2 (38.28): box + runner; NPCs with a `dialogue` component get an [E] Talk interactable (none until NPC-BEAR-01 places one).
      if (dialogueCtl) dialogueCtl.dispose();
      dialogueCtl = createDialogueCtl({ world, dialogues: bundle.dialogues, events: engine.events, style: window.ASSETS.uiStyle.dialogue,
        jawOpenDeg: window.ASSETS.bearFx && window.ASSETS.bearFx.talk ? window.ASSETS.bearFx.talk.jawMaxDeg : undefined, // jaw hinge: rx opens, 0..jawMaxDeg (voxel_bear.js header)
        book: () => (saveRelay ? saveRelay.quest.book : null), // QG-03: `q.*` dialogue keys -> quest book
        questFlag: saveRelay ? (k) => saveRelay.quest.questFlag(k) : undefined, // CH1-06: `s.*` dialogue keys
        onTalk: (npcId) => { errands.talked(npcId); if (outwall) outwall.talked(npcId); if (outLife) outLife.talked(npcId); }, // OUT-01 ow.<npc>.met; QL-WIRE: talk.<site> flag for 'talk' errands
        onFlag: (k, v) => { if (k.charCodeAt(0) !== 113 || k.charCodeAt(1) !== 46) gameHooks.emitSimple('flag:set', 'dlg.' + k, v); } });
      setDialogueApi(dialogueCtl); window.__debug.dialogue = dialogueCtl; // tools/verify-ch12-run.mjs: read-only test hook
      errands.load(world); // QL-WIRE: [E] Inspect on post / notePost
      bearTurn = createNpcTurn(world, 'bear'); // NPC-BEAR-01: null when the world has no bear
      try { // VOX-PRIO-01 (OB-171): quest givers + quest item props rank above plain props when the voxel cap bites (markers are tier 2 in markHandle)
        const ids = new Set(Object.values(COMPASS_ITEM)); ids.add('bear');
        if (questGenCtx) for (const d of questGenCtx.giverDefs) { if (d && d.giver) { ids.add(d.giver.npc); ids.add(d.giver.turnIn); } }
        for (const id of ids) { const e = id && giverEntity(world, id); const v = e && e.data && e.data.components && e.data.components.voxel; if (v && !(v.priority > 1)) v.priority = 1; }
      } catch (err) { console.warn('[voxprio]', err && err.message); }
      compassWorld = world; compassBreach = null; compassBookVer = -1; compassTick = 0; // COMPASS-02: re-resolve against the new world
      if (bearTurn) dialogueCtl.addNpc('bear');
      dialogueCtl.addNpc('rook'); // Rook the crow: no-op until the entity exists in the world
      outwall = saveEnabled && saveRelay ? createOutwall({ world, questFlag: (k) => saveRelay.quest.questFlag(k) }) : null;
      for (const nid of talkNpcIds(questGenCtx ? questGenCtx.giverDefs : [], bundle.dialogues)) if (nid !== 'bear') dialogueCtl.addNpc(nid); // QWALK-WARDEN-TALK + R6-FIX A: EVERY giver/turn-in npc with a dialogue (wardens, Bram, Joss ...) gets [E] Talk (bear: bearTurn rule above; addNpc is idempotent)
      dialogueCtl.addNpc('hesk'); dialogueCtl.addNpc('dorrin'); // Ch3 Outwall NPCs (world_m1 entities, char.kit model registered at boot; both share the default kit look, no tint)
      if (outLife) outLife.dispose(); // LIFE-04: villagers replace the OUT-02 spawn hook; only with saves live (same gate as OUT-01), never in capture/bench
      outLife = lifeData && outwall && lifeNav && mode === 'world' ? createOutwallLife({ world, life: lifeData.life, nav: lifeNav, tileNav: !!(world.terrainGrid && world.nav && lifeNav === world.nav), events: engine.events, state: world.state, outwall, dialogue: dialogueCtl, barksData: lifeData.barks, style: window.ASSETS.uiStyle.dialogue, hour: clockHour(world.state, clockCfg) }) : null;
      crystal = barks = chapterCard = chapterCard2 = escort = null;
      if (bearTurn) bearTurn.paused = false;
      if (saveEnabled && saveRelay) { // CH1-MOUNT: all three need the quest relay (flags + book)
        const rq = saveRelay.quest, tmsg = () => window.ASSETS.items && window.ASSETS.items.toast && window.ASSETS.items.toast.messages && window.ASSETS.items.toast.messages.packFull;
        crystal = createCrystalGrant({ world, questFlag: (k) => rq.questFlag(k),
          addItem: (id) => { const inv = playerHandle && playerHandle.data.components.inventory; return inv && itemDefs ? addItem(inv, itemDefs, id, 1) : 0; },
          burst: (x, y, z) => { try { hitSparks(engine.particles, x, y, z + 0.3, 0, 0, 1, 24, 2); } catch (e) { /* hit sparks not defined: no burst */ } }, // hue 2 = aether cyan
          toast: () => { const m = tmsg(); if (toasts && m) toasts.say('A teal crystal lay under the last boar.', m.fg); } }); // story.md toast.crystal.found (PO-CH1-13: reads as GIVEN by Burl, not a pickup)
        crystal.check(rq.book.statusOf('burl.boars'));
        if (bearBarks) barks = createBarks({ world, data: bearBarks, questFlag: (k) => rq.questFlag(k), dialogue: dialogueCtl, style: window.ASSETS.uiStyle.dialogue });
        // CH1-07 (38.37 item 5): Burl walks (follow -> stone, depart) + proximity talk; load rules per phase. Needs the bear entity.
        const rm = (id) => world.removeInteractable('npc.' + id), nearTalk = (id) => dialogueCtl.openFor(id);
        nub = null; // NUB-01: rebuilt below with Burl's walk
        const bw = bearTurn ? createNpcWalk(world, 'bear', { barks, removeInteractable: rm }) : null;
        if (bw) {
          const bt = world.get('bear').data.transform;
          escort = createBurlEscort({ world, walk: bw, questFlag: (k) => rq.questFlag(k), barks, id: 'bear', x: () => bt.x, y: () => bt.y,
            dialogueOpen: () => dialogueCtl.open, afterLeave: () => rq.state.completed.includes('leave'), requestOpen: nearTalk, noticeBusy: () => notice.active,
            restore: () => dialogueCtl.addNpc('bear'), hideSafe: true, leadStatus: () => rq.book.statusOf('sq.burl.walk') }); // sq.burl.walk: Burl leads along walks.toBend // QL-05: Burl's home switch re-adds her [E] Talk
          escort.load();
          const nubH = world.get('nub'); // NUB-01
          nub = nubH ? createNubFollow({ handle: nubH, groundAt: (x, y) => (world.terrain ? world.terrain.groundAt(x, y) : bt.z), isWater: (x, y) => world.waterAt(x, y, nubWtmp), seed: 1, burl: { x: () => bt.x, y: () => bt.y, walking: () => bw.walking, hidden: () => bw.hidden } }) : null;
        }
        window.__debug.escort = escort; // tools/verify-ch1-mount.mjs
        chapterCard = createChapterCard({ world, openNote: (id) => noteRead({ world, def: { noteId: id } }), isNoteOpen, setFlag: (k, v) => rq.questFlag(k, v) });
        chapterCard2 = createChapterCard({ world, openNote: (id) => noteRead({ world, def: { noteId: id } }), isNoteOpen, setFlag: (k, v) => rq.questFlag(k, v), text: CHAPTER2_TEXT, flagDone: FLAG_DONE_CH2, flagNext: 'chapter.next', nextVal: 'ch3' }); // QL-17: Ch2 card after mq.smoke
      }
      if (toasts) toasts.dispose();
      toasts = itemDefs ? createToastView(engine.events, window.ASSETS.items.toast, itemDefs, assets.palette.rgb) : null;
      lootToast = toasts; // OB-082
      qbView = itemDefs ? createQuickbarView({ defs: itemDefs, keys: window.ASSETS.items.keys, rgb: assets.palette.rgb }) : null; // EQ-12
      if (saveRelay) { // QG-03: book events -> seam + toasts (the reward, if any, is granted from book.lastReward; Burl's quest has none - owner pick)
        const tv = toasts, msg = window.ASSETS.items.toast && window.ASSETS.items.toast.messages && window.ASSETS.items.toast.messages.packFull;
        saveRelay.quest.onSection = (title) => { if (tv && msg) tv.say('Quest complete: ' + title, msg.fg); const ws = world.state; if (chapterCard && saveRelay.quest.done && ws['waystone.waystone.woken'] && ws['waystone.ws_roadBend.woken']) chapterCard.trigger(); /* PO-CH1-08: card only after the meadow stone AND the relay */ }; // CH1-02: live section completion only
        offerToast = createOfferToast(saveRelay.quest.book, (g) => GIVER_INFO[g] ? GIVER_INFO[g].name : g.charAt(0).toUpperCase() + g.slice(1)); offerToast.seed(); offerToastMsg = msg; // QUEST-NEXT-GIVER-01 (compass: compassHud.target)
        saveRelay.quest.book.onChange = (name, id) => {
          gameHooks.emitSimple(name, id);
          if (logicWire && (name === 'quest:accepted' || name === 'quest:done')) logicWire.notify(name === 'quest:accepted' ? 'quest.accepted' : 'quest.done', 'quest', id); // ED-LOGIC-01c
          if (name === 'quest:accepted') actionSig.questAccepted = true; // FS-01: first accepted quest -> [J] Journal hint
          if (name === 'quest:ready' && id === 'burl.boars' && crystal) crystal.check('ready'); // CH1-03
          if (name === 'quest:ready' && id === 'burl.boars' && dialogueCtl && dialogueCtl.open) burlReopen = true; // PO-CH1-07: boars were already dead when accepted -> Burl speaks again (the hand-in) once this box closes
          if (name === 'quest:done' && id === 'mq.smoke' && chapterCard2) chapterCard2.trigger(); // QL-17: Ch2 end card + journalCh2
          if (name === 'quest:done' && questPickups) questPickups.grantReward(saveRelay.quest.book.lastReward); // QUESTS-01: hand-in reward -> pack (+ toast)
          if (tv && msg) { const bk = saveRelay.quest.book, qt = (bk.def(bk.index(id)) || {}).title; if (name === 'quest:accepted') tv.say('Quest accepted: ' + qt, msg.fg); else if (name === 'quest:done') tv.say('Quest complete: ' + qt, msg.fg); }
        };
      }
      if (invView && invView.isOpen) invView.close();
      const liveSpellBook = { tier: (id) => (spellBook ? spellBook.tier(id) : 0), canRaise: (id) => !!spellBook && spellBook.canRaise(id) }; // ONE per-world book (the `spellBook` set on 'world:loaded'): Spells tab, pack overlay and fireball tier hook all read it
      const spendSpellScroll = (id) => { if (!playerHandle || !spellBook) return 0; const r = useSpellScroll(playerHandle.data.components.inventory, spellBook, id); return r.ok ? r.level : 0; }; // ONE scroll spend path (pack overlay + Spells tab)
      invView = itemDefs && window.ASSETS.uiStyle.inventory ? createInventoryScreen({
        style: window.ASSETS.uiStyle.inventory, tabOpens: false, items: window.ASSETS.items, rgb: assets.palette.rgb, toast: toasts,
        inventoryOf: () => (playerHandle && playerHandle.data.components.inventory) || null,
        slotLockText: () => 'Locked - learn fire first', // OB-156
        isSlotDisabled: (i) => { if (!playerHandle) return false; const inv = playerHandle.data.components.inventory, sl = inv && inv.slots[i]; return !!(sl && sl.id && LOCKED[sl.id]); }, // FB-01: spell + mana potion cells show as locked until unlocked (Items + Character tabs)
        healthOf: () => (playerHandle && playerHandle.data.components.health) || null,
        spellChoice: { // D-114: Spell Scroll -> the player chooses a learned spell (the fireball is today's only spell)
          options: () => (spellBook ? raisable(spellBook) : []),
          pick: (id) => spendSpellScroll(id),
        },
        spellPage: { defs: SPELL_DEFS, book: liveSpellBook, useScroll: (id) => spendSpellScroll(id), // SPELL-03: Spells tab; same spend path as the pack overlay
          scrolls: () => (playerHandle && playerHandle.data.components.inventory ? invCountOf(playerHandle.data.components.inventory, SPELL_SCROLL_ID) : 0) },
        onHandsChanged: () => { if (hands && playerHandle) hands.step(playerHandle.data, false, false, false); }, // router sees the change now (cancel + setHand + hands:changed)
        quickbar: itemDefs ? { assign: (n, id) => !!playerHandle && !LOCKED[id] && qbAssign(playerHandle.data, itemDefs, n + HAND_SLOTS, id) } : undefined, // EQ-12: 1-4 over an item in the Items / Character tab (key n = bar slot n + 2)
        characterKey: params.get('craft') !== '1', // EQ-03: C opens the Character tab (the crafting list keeps C under ?craft=1)
        character: window.__charKit ? { // EQ-03/04: lazy preview + char cache, built on the first Character-tab open
          equipmentOf: () => (playerHandle && playerHandle.data.components.equipment) || null,
          getLook: () => lookOrDefault(window.__charKit, saveRelay && saveRelay.look),
          charCache: createCharCache(window.__charKit, 4), kit: window.__charKit,
          createPreview: () => createModelPreview(assets),
          onGearChanged: () => { if (hands && playerHandle) hands.step(playerHandle.data, false, false, false); },
        } : undefined,
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
      placeLoaded(world, startT, () => gameHooks.respawn()); // WS2-05/MAP-13: saved pose outside a polygon bound -> last relay; band for the final pose (no-op without bands)
      hzb.invalidate('world-load'); // new world / restart / title New+Continue / ?at / ?pose: the start pose is a camera cut
      const waterfallView = worldDef.name === 'waterfall_test' && waterfallPreset?.views[params.get('waterfallview')];
      if (waterfallView) {
        Object.assign(startT, waterfallView);
        playerHandle.data.components.body.peakZ = startT.z;
      }
      if (look) look.dispose(); // arch review 1: no leaked click/pointerlock listeners across restarts
      look = new PlayerLook(canvas, input, startT.yawDeg, startT.pitchDeg, { pitchClampDeg }); // Mesh first-person pitch clamp.
      if (params.get('nopause') === '1') Object.defineProperty(look, 'locked', { get: () => true, set: () => {}, configurable: true }); // CAPTURE-NOPAUSE: headless never gets pointer lock -> treat as locked so isPaused/menu/input gates stay open (mouse look does nothing without real lock)
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
          chartOptions = { chart: chartData, markers, geo: (window.ASSETS.levels.world_geo && params.get('geo') !== '0') ? { G: window.ASSETS.levels.world_geo, U: window.ASSETS.levels.overworld_far.util } : null, /* MAP-28 */ fog: mapFogHook ? mapFogHook.fog : null, travel: !waystoneWire ? null : { list: () => { const ws = waystoneWire.sim; if (!ws) return []; const l = []; const n = ws.list(l); const out = []; for (let i = 0; i < n; i++) out.push({ id: l[i].id, name: l[i].label, order: l[i].order, touched: l[i].touched, woken: true, x: l[i].x, y: l[i].y }); return out; } } };
        }
        { // WM-10: the whole-map view is the default M card (?map=chart keeps the baked chart); region.seen drives fog + names
          const wg = window.ASSETS.levels.world_geo, rbN = window.ASSETS.uiRegionBanner;
          if (wg && rbN && params.get('map') !== 'chart') chartOptions = Object.assign(chartOptions || { markers: [], travel: null }, { worldMap: { geo: wg, lockUnseen: true, names: rbN.names, getSeen: () => world.state['region.seen'] } });
        }
        try {
          initMapCard(assets, ui.cols, ui.rows, chartOptions);
          { const cv = getMapChart(); if (cv) { cv.onTravel = (id) => travel.request(id); cv.travelBlocked = () => mapTravelBlocked(); } } // WS1-07b
        } catch (e) {
          console.warn('[map] chart card init failed, falling back to the plain card:', e && e.message);
          initMapCard(assets, ui.cols, ui.rows);
        }
        resetHints(); resetActionHints(); resetFireballHints(); if (regionBanner) regionBanner.reset(); // REGION-01
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
      window.__debug.beasts = beasts; window.__debug.hands = hands; window.__debug.sword = sword; window.__debug.fireball = fireball; window.__debug.invView = invView; window.__debug.getUi = () => ui; // HANDS-01b: test hooks; EQ-04: verify-equip-play reads the UI cells of the Character view box
      window.__debug.equipPlay = equipPlay; window.__debug.quickbar = quickbar; window.__debug.vmHandles = { sword: swordVmH && swordVmH.h, shield: shieldVmH && shieldVmH.h, bow: bowVmH && bowVmH.h }; window.__debug.shieldSim = shieldSim; window.__debug.arrowSim = arrowSim; window.__debug.vitals = vitals; window.__debug.wakeOut = wakeOut; // EQ-07/09: tools/verify-equip-play.mjs hooks
      window.__debug.isNoteOpen = isNoteOpen; window.__debug.pauseUp = pauseUp; window.__debug.openNote = (id) => noteRead({ world: engine.world, def: { noteId: id } }); /* OB-049: tools/verify-note-close.mjs */ window.__debug.isMapOpen = isMapOpen; window.__debug.getMapPanel = getMapPanel; window.__debug.getMapChart = getMapChart; window.__debug.questBook = () => (saveRelay ? saveRelay.quest.book : null); window.__debug.questLogOpen = qlIsOpen; window.__debug.gameHooks = gameHooks; window.__debug.travel = travel; window.__debug.travelTo = (id) => travel.request(id, true); window.__debug.waystoneSim = () => (waystoneWire ? waystoneWire.sim : null); // QG-04/05: tools/verify-quest-ui.mjs hooks
      // S8-B1-15: test hook (tools/verify-map-wire.mjs)
    });

    // ME-11c (architecture.md 27.18): `?physics=mesh` opts into the mesh
    // collider path instead of the grid (default, unchanged when omitted).
    guardLoad(() => engine.loadWorld(worldDef, worldLoadOpts));
    if (params.get('stream') === '0' && engine.world) engine.world.streaming.enabled = false; // STREAM-01b: `?stream=0` = all placements resident (def.streaming passes through World.load)
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
        onNewGame: withRelock((slot, chosenLook) => { if (saveRelay) { saveRelay.setSlot(slot); if (chosenLook) saveRelay.look = chosenLook; } }, () => relockPointer()), // NEWGAME-PAUSED-01: menu key/click is the gesture that re-locks the pointer (else look.locked=false = isPaused) // CHARGEN-17: Confirm stores player.look in the new save
        // CHARGEN-17 parked (owner 2026-10-10: "i dont want character creation in the beggining"): New game starts straight away.
        // createCharCreate is not passed, so titleMenuHost keeps its old behaviour; game/js/ui/charCreate.js stays in the repo unused.
        onContinue: withRelock((slot, save) => {
          if (!saveRelay) return;
          saveRelay.setSlot(slot);
          const w = saveRelay.load(assets, worldLoadOpts, true);
          if (!w) { console.warn('[save] continue failed, starting fresh:', saveRelay.lastResult && saveRelay.lastResult.error); return; }
          try { engine.setWorld(w); } catch (err) {
            console.warn('[save] restore failed, starting fresh:', err && err.message);
            guardLoad(() => engine.setWorld(deserialize(initialState, assets, worldLoadOpts)));
          }
        }, () => relockPointer()),
        onSettings: () => openSettings({ assets, engine, look, onDifficulty: (d) => { if (beasts && beasts.setDifficulty) beasts.setDifficulty(d); combatHud.bars.bars.setDifficulty(d); } }),
        // CREDITS-MOUNT-01: licence inventory is fetched lazily on first open (menu only, never in capture/bench paths)
        createCredits: () => creditsInv && window.ASSETS?.uiStyle?.menu ? createCreditsView(creditsInv, { style: window.ASSETS.uiStyle.menu }) : null,
      });
    // PAUSE-MENU-01 (D-053): Resume / Settings / Save / Load / Back to main menu, in the title menu's skin.
    const relockPointer = () => { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* arrow-key fallback */ } };
    if (!cinematic && mode === 'world') pauseMenu = createPauseMenu({
      adapter: (saveRelay && saveRelay.adapter) || { listSlots: () => [], readSlot: () => ({ ok: true, save: null }) },
      style: window.ASSETS && window.ASSETS.uiStyle ? window.ASSETS.uiStyle.menu : null,
      onResume: () => { if (pauseResume.soft) pauseResume.resume(); else relockPointer(); }, // OB-072: soft pause = lock never lost
      onSettings: () => openSettings({ assets, engine, look, onDifficulty: (d) => { if (beasts && beasts.setDifficulty) beasts.setDifficulty(d); combatHud.bars.bars.setDifficulty(d); } }),
      onFullscreen: toggleFullscreen, // OB-072
      onUnstuck: isCaptureOrBench || params.get('capture') === '1' ? null : () => { // OB-140: newest safe spot >= 3 m away (always allowed, also in combat)
        const t = playerHandle.data.transform, p = safeSpots.pick(t.x, t.y, t.z);
        if (!p) return false;
        placePlayer({ x: p.x, y: p.y, z: p.z, yawDeg: p.yawDeg });
        if (toasts) toasts.say('Moved to safe ground.', [226, 214, 176]);
        return true;
      },
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
    // QUALITY-BOOT-01: apply the saved quality's grid as soon as the GPU pipeline renders - BEFORE the title-menu early return below (it used to sit after it, so a boot via the title menu stayed at the CPU grid). Skipped if the player already picked a grid.
    if (pendingBootGrid && wgPipeline.frameComplete && rt.gpuActive) { pendingBootGrid = false; if (rt.cols === bootCpuCols) engine.setGrid(gridResult.cols, gridResult.rows); }
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
    if (farHold.active) { input.consumePressed(); input.consumeMouseDelta(); return; } // OB-109: world swap waiting for the far bake: sim frozen
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
    if (barks && mode === 'world' && !ending && !ch1Hidden) barks.step(dt); // CH1-06: early, before the dialogue step
    if (dialogueCtl && mode === 'world' && playerHandle && !ending) { dialogueCtl.step(dt, input, look ? look.locked : undefined); const pt0 = playerHandle.data.transform; dialogueCtl.closeIfFar(pt0.x, pt0.y); } // DIALOGUE-01b2: early, so the lock covers the closing key press
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
        if (!qlView || qlBook !== bk) { qlBook = bk; qlView = createQuestLogScreen(bk, { style: window.ASSETS.uiStyle && window.ASSETS.uiStyle.menu, giverName: (id) => { const n = { bear: 'Burl', rook: 'Rook', hesk: 'Hesk', dorrin: 'Dorrin' }[id]; if (n) return n; const l = labelOf(id); return l.charAt(0).toUpperCase() + l.slice(1); }, nextCtx: () => nextCtx, itemName: (id) => { const d = window.ASSETS.items && window.ASSETS.items.defs[id]; return d && d.name ? d.name : itemLabel(null, id); }, onJournal: () => noteRead({ world: engine.world, def: { noteId: engine.world.state['chapter.ch2.done'] ? 'journalCh2' : 'journalCh1' } }) }); }
        qlWasLocked = look.locked; qlView.open(); input.consumePressed();
      }
    }
    syncMapQuestMarks();
    const invOpen = !!(invView && invView.isOpen) || !!(craftView && craftView.isOpen) || qlIsOpen(); // MAIN-WIRE-01: craft list locks input / pauses like the pack
    const cardOpen = !!(chestHook && chestHook.card.isOpen); // S8-B1-04: item-get card gates input same as invOpen
    if (mode === 'world' && playerHandle && engine.world.terrainBands) { const pt = playerHandle.data.transform; engine.world.streamBand(pt.x, pt.y, 2); } // WS2-05 (38.38): near-band streaming, player pose only, <= 2 ms
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
      uiLocked = wakeOut.inputLocked || isMapOpen() || isSettingsOpen() || invOpen || cardOpen || vLocked();
    }
    // US-038b: settings panel (S from pause, or its own entry point)
    // canOpen requires the pause overlay to actually be up (!look.locked) -
    // S is also WASD "move backward", so this must never trigger in play.
    // PAUSE-MENU-01: the pause menu owns W/S/Enter while it is up (S no longer opens Settings; the Settings row does).
    if (pauseMenu) {
      // OB-072: keyboard-lock path: Esc keydown while the pointer is locked. Plain play -> soft pause (lock kept); any other Esc owner
      // (note, map, pack, dialogue, ...) keeps its "Esc = lock lost" meaning, so release the lock ourselves for those.
      if (kbLockOn && look && look.locked && !pauseResume.soft && !ending && input.pressed('Escape')) {
        if (mode === 'world' && !isMapOpen() && !isNoteOpen() && !isNoteEscGrace() && !(dialogueCtl && dialogueCtl.open) && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen() && !cinematic && !(menuHost && menuHost.active) && !isSettingsOpen()) { pauseResume.softPause(); input.consumePressed(); }
        else if (document.exitPointerLock) document.exitPointerLock();
      }
      pauseResume.tick(!!(look && look.locked), input); // OB-068
      if (swallowGesture) { swallowGesture = false; input.consumePressed(); } // OB-072
      const up = pauseUp();
      if (up && !pauseWas) pauseMenu.reset();
      pauseWas = up;
      if (up) { for (const code of PAUSE_KEYS) if (input.pressed(code)) { if (pauseMenu.handleKey(code)) { input.consumePressed(); break; } if (code === 'Escape') { pauseResume.resume(); input.consumePressed(); break; } } } // OB-068: Esc on the main page = Resume
    }
    updateSettings(dt, input, { assets, engine, look, canOpen: false });
    uiLocked = uiLocked || isMapOpen() || isSettingsOpen() || invOpen || cardOpen || vLocked(); // DIALOGUE-LOCK-01: note panel + chapter card no longer lock
    titleMenuActive = !!(menuHost && menuHost.active);
    ch1Hidden = isCaptureOrBench || !saveEnabled || titleMenuActive || ending || invOpen || cardOpen || isMapOpen() || isSettingsOpen() || isNoteOpen() || qlIsOpen() || !!(dialogueCtl && dialogueCtl.open) || !!(vitals && vitals.dead); // CH1-MOUNT: notices/barks hidden under any menu/dialogue
    notice.update(dt, ch1Hidden); if (chapterCard && !ending) chapterCard.update(dt); if (chapterCard2 && !ending) chapterCard2.update(dt); // CH1-04a / CH1-09
    const paused = deviceLostFrozen || (mode === 'world' && !isCaptureOrBench && (pauseResume.soft || isPaused({ ending, look, isMapOpen: () => isMapOpen() || pauseResume.active || isNoteEscGrace() || !!(dialogueCtl && dialogueCtl.escGrace.active) }) || ((invOpen || cardOpen) && !ending)));
    { // COMPASS-02 (D-061): retarget on book change + ~2 Hz, step the needle, hide rule (menus/pack/log/map/dialogue/death/title/capture modes/ending)
      const bk = saveRelay && saveRelay.quest.book;
      compassHide = !(mode === 'world' && playerHandle && bk && questUiActive) || ending || paused || isCaptureOrBench || uiLocked || titleMenuActive || isSettingsOpen() || isNoteOpen()
        || (dialogueCtl && dialogueCtl.open) || (vitals && vitals.dead) || deathFlow.phase !== 'idle' || (wakeOut && wakeOut.inputLocked); // phase, not .active (= the feature flag, always true)
      if (playerHandle) { const pt0 = playerHandle.data.transform; nextCtx.x = pt0.x; nextCtx.y = pt0.y; compass.setNear(pt0.x, pt0.y); }
      if (bk && (bk.version !== compassBookVer || ++compassTick >= 30)) { compassBookVer = bk.version; compassTick = 0; compass.target(bk, compassResolver); }
      if (playerHandle && look) { const pt = playerHandle.data.transform; compass.step(pt.x, pt.y, look.yawDeg, pt.z); }
    }

    // US-087 follow-up: drain blocked input without advancing targeting timers.
    // An allowed lock update still precedes look.update so it turns toward the fresh point.
    if (mode === 'world' && playerHandle && targeting) {
      stepTargetingInput(targeting, dt, input, playerHandle.data, look, ending || uiLocked || paused, gameKeys.lockTarget); // EQ-07: lock moved Q -> R
    }
    if (look && !ending) {
      // US-015 (7.6 item 5): while locked, PlayerLook still drains the raw
      // mouse delta every step (so nothing pent up snaps the camera once
      // input unlocks) but its result is simply discarded, not applied.
      if (uiLocked || isNoteOpen() || pauseResume.soft) input.consumeMouseDelta(); // OB-057: reading a note freezes the view
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
      if (clockDriver && !titleMenuActive) { const w = engine.world; tickClock(w.state, dt, clockCfg); clockDriver.update(w.state[CLOCK_KEY]);
        if (atmosDrv) { const t = playerHandle.data.transform; const sceneNow2 = sceneOf(w, t, sceneScratch, dt, playerHandle.data.components.body); underScene = sceneNow2; if (sceneNow2 !== sceneNow) { sceneNow = sceneNow2; if (postCfg0) { postCfg = resolvePost(window.POST_LOOK, params, postQ, sceneNow); postV = -2; } } atmosDrv.step(t.x, t.y, clockHour(w.state, clockCfg), dt, sceneNow === 'outdoor' && !!w.terrain /* REV-MAIN ENV-03 #3: only the overworld terrain world is outdoor */); if (atmosLast.w !== w) { atmosDrv.snap(); atmosLast.w = w; } /* #2: new world (world:loaded / respawn / restart / travel) -> snap now; teleports > 50 m snap inside the driver (atmosDriver.js) */ if (atmosDrv.out.version !== atmosV) { atmosV = atmosDrv.out.version; mixAtmos(atmosCfg.table, atmosDrv.active ? atmosDrv.out : null, atmosBase, atmosState); applyAtmosToPalette(assets.palette, atmosState); } } } // ENV-03 // DN-03: stops on title/pause (this block), runs through respawn/restart/travel
      if (ending || uiLocked || vLocked() || isNoteOpen()) { // OB-057 (owner): no movement while a note is open
        controls.forward = 0; controls.strafe = 0; controls.run = false; controls.jump = false;
      } else {
        controls.forward = (input.isDown(gameKeys.forward) ? 1 : 0) - (input.isDown(gameKeys.backward) ? 1 : 0);
        controls.strafe = (input.isDown(gameKeys.right) ? 1 : 0) - (input.isDown(gameKeys.left) ? 1 : 0);
        controls.run = input.isDown(gameKeys.run) || input.isDown(gameKeys.run2);
        if (equipPlay && equipPlay.speedScale < 1) { controls.forward *= equipPlay.speedScale; controls.strafe *= equipPlay.speedScale; } // EQ-07: shield raised = walk x0.6
        // US-009: a HELD level, OR'd with the edge (`pressed`) so a Space tap
        // that starts and ends within one frame - between two fixed-step
        // updates - is never lost (integrate() does its own edge detection on
        // top of this, architecture.md section 5 `Controls` typedef).
        controls.jump = input.isDown(gameKeys.jump) || input.pressed(gameKeys.jump);
        { const sb = playerHandle && playerHandle.data.components.body; controls.swimUp = swimUpOf(controls.jump, input.isDown(gameKeys.dive), sb); controls.jump = jumpOf(controls.jump, sb); } // SWIM-04d: Space = swim up / Left Ctrl = dive in water, jump on land
      }
      grabPin.apply(controls, input.pressed(gameKeys.forward) || input.pressed(gameKeys.backward) || input.pressed(gameKeys.left) || input.pressed(gameKeys.right) || input.pressed(gameKeys.jump)); // BEAST-08b: croc pin blocks movement only
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
      if (wading) wading.before(playerHandle.data, playerHandle.data.components.body.speedScale); // RIVER-04: slowdown + current push (river water only)
      if (wetStones && wetStones.count > 0) { // QL-19: sprint onto a wet ford stone without River Boots = 0.4 s slow step (x0.5)
        const pc = playerHandle.data.components, pt = playerHandle.data.transform;
        const m = wetStones.step(pc.equipment, itemDefs, controls.run && (controls.forward !== 0 || controls.strafe !== 0), pt.x, pt.y, dt);
        if (m < 1) { controls.forward *= m; controls.strafe *= m; }
        if (wetStones.state && wetStones.state.fresh) wadeFx.arrowHit(pt.x, pt.y, pt.z, fb ? fb.timeSec : 0); // QL-19b: splash + ring on the slip step (US-055a fx)
      }
      if (swimWire) swimWire.before(playerHandle.data); // SWIM-03c: water -> body fields + current, after wading.before (which resets speedScale from `other`)
      integrate(playerHandle.data, dt, controls, engine.world, engine.physics);
      { // OB-140: sample a safe spot (grounded, alive, not swimming / deep water)
        const sb = playerHandle.data.components.body, st = playerHandle.data.transform;
        let dry = !!sb && !sb.swimming;
        if (dry && typeof engine.world.waterAt === 'function' && engine.world.waterAt(st.x, st.y, safeWa) && safeWa.depth > 0.6) dry = false;
        safeSpots.step(dt, st.x, st.y, st.z, st.yawDeg, dry && sb.grounded && !(vitals && vitals.dead));
      }
      if (swimWire) swimWire.afterStep(playerHandle.data, fb ? fb.timeSec : 0); // SWIM-HOOKS-01: stamina/drown + sea monster
      wadeFx.step(playerHandle.data, fb ? fb.timeSec : 0); // deep water (> 1.0 m) is a wall (D-064)
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
      if (beasts && simDue) { const pt = playerHandle.data.transform; beasts.step(pt.x, pt.y, pt.z); if (underSpawners.length) { forwardOf(look.yawDeg, swordFwd); const uh = clockHour(engine.world.state, clockCfg); for (let i = 0; i < underSpawners.length; i++) underSpawners[i].step(dt, pt.x, pt.y, pt.z, swordFwd[0], swordFwd[1], uh); } if (dirWire) { forwardOf(look.yawDeg, swordFwd); dirWire.director.step(dt, pt.x, pt.y, swordFwd[0], swordFwd[1]); } if (beasts.tileMode && (++tileDormTick % 60) === 0) beasts.updateTileDormancy(pt.x, pt.y); } // WM-04: 200 m dormancy at ~1 Hz
      if (goblinWire && simDue) { const pt = playerHandle.data.transform; goblinWire.step(engine.world.state['clock.day'] | 0, pt.x, pt.y); } // GOB-07b
      if (lifeWire && simDue) lifeWire.step(clockHour(engine.world.state, clockCfg)); // LIFE-08: raids roll at night
      if (wild) { const pt = playerHandle.data.transform; wild.step(dt, pt.x, pt.y, controls.run, look.yawDeg); if (regionAmb) regionAmb.step(dt, pt.x, pt.y); } // WILD-06: ambient only, never hashed
      if (escort) { const uiHold = uiLocked || !!(dialogueCtl && dialogueCtl.open); /* AUD-06 */ const pt = playerHandle.data.transform; if (escort) { if (burlReopen && !(dialogueCtl && (dialogueCtl.open || dialogueCtl._closing))) { burlReopen = false; const bh = engine.world.get('bear'), bt2 = bh && bh.data.transform; if (bt2 && (bt2.x - pt.x) ** 2 + (bt2.y - pt.y) ** 2 <= 36) dialogueCtl.openFor('bear'); } escort.step(dt, pt.x, pt.y, uiHold); if (bearTurn) bearTurn.paused = escort.busy; } } // CH1-07/08b: before the bear turn
      if (nub) nub.step(dt); // NUB-01: same fixed step as the escort
      if (outwall) { const pt = playerHandle.data.transform; outwall.step(dt, pt.x, pt.y); if (outLife && simDue) outLife.step(dt, clockHour(engine.world.state, clockCfg), pt.x, pt.y); } // OUT-01 (owns yaw only when idle) + LIFE-04
      if (bearTurn) { const pt = playerHandle.data.transform; bearTurn.step(dt, pt.x, pt.y, !!(dialogueCtl && dialogueCtl.open)); } // NPC-BEAR-01 // US-079a (29.1)
      if (beasts && assets.uiStyle) stepCombatHint(engine.world, assets.uiStyle, beasts); // COMBAT-HINT-01: once-per-save first-fight hint (taken from lane C)
      if (telegraphWire) telegraphWire.step(performance.now());
      // US-078d (30.1 + D-034 amendment): the sword steps after beasts.step, so a heavy-hit stagger acts from the
      // beast's NEXT step (deterministic, synchronous emit). `attackDown` is the amendment's exact gate expression.
      syncFb(); // FB-01: one read per sim step
      if (hands) {
        // HANDS-01b (37.8a): the router turns LMB/RMB + the gate into one `down` per item; every item sim is stepped
        // every step (down = false when it is in no hand).
        if (!uiLocked && !paused && !ending && !vLocked() && input.pressed(gameKeys.swapHands)) hands.swap(); // swap the two hands (owner 2026-10-07: no ?debug=1 needed; not while a menu/pause/death card is up)
        refreshRolledGear(playerHandle.data); // ITEM-WIRE-01: rebuilds only when an equipped rolled item changed
        if (itemDefs) stepEquipment(playerHandle.data, itemDefs); // EQ-02/OB-017: hands are derived (left = main/ranged, right = off)
        const gateOpen = look.locked && !uiLocked && !ending && !paused && !vLocked() && !(swimWire && swimWire.active(playerHandle.data)); // SWIM-03c: gear stowed while swimming (gate shut = hands.step disarms)
        // OB-017: hands.step(player, rawLeftHand, rawRightHand): the LEFT hand (main sword / bow) follows LMB,
        // the RIGHT hand (off: shield) follows RMB. Q swaps the weapon set (0.3 s, buttons held back only for that time).
        const swapHeld = equipPlay ? equipPlay.pre(playerHandle.data, input.pressed(gameKeys.swapSet), gateOpen) : false;
        hands.step(playerHandle.data, !swapHeld && (input.isDown(gameKeys.useLeft) || input.pressed(gameKeys.useLeft)), !swapHeld && (input.isDown(gameKeys.useRight) || input.pressed(gameKeys.useRight)), gateOpen);
        if (equipPlay) { // EQ-07/09: shield raise/block, bow draw/shoot, arrows + pick-up (look vector: trig stays here)
          forwardOf(look.yawDeg, swordFwd);
          const pr2 = look.pitchDeg * DEG2RAD, cp2 = Math.cos(pr2), pt2 = playerHandle.data.transform, pb2 = playerHandle.data.components.body;
          eqCtx.gate = gateOpen; eqCtx.fx = swordFwd[0] * cp2; eqCtx.fy = swordFwd[1] * cp2; eqCtx.fz = Math.sin(pr2);
          eqCtx.px = pt2.x; eqCtx.py = pt2.y; eqCtx.pz = pt2.z; eqCtx.ex = pt2.x; eqCtx.ey = pt2.y; eqCtx.ez = pt2.z + (pb2 && pb2.eyeH ? pb2.eyeH : 1.6);
          eqCtx.interact = input.pressed(gameKeys.interact);
          const shotBefore = equipPlay.bow.shotTick;
          equipPlay.post(playerHandle.data, eqCtx);
          if (equipPlay.bow.shotTick !== shotBefore) playBowShot();
        }
        if (quickbar) { // EQ-12 AC3/AC4 + D-068: keys 1-4 act per item kind, H drinks a red draught. While a dialogue choice list is open the digits belong to
          // the dialogue (its own pick consumes the edge; out-of-range digits are held back too). Sip = 0.6 s, never locks movement.
          const pl = playerHandle.data; ensureQuickbar(pl, itemDefs); quickbar.step(); qbBlocked = ending || paused;
          if ((++qbTick % 30) === 0) autoFill(pl, itemDefs);
          if (qbPlayOk()) {
            const choosing = !!(dialogueCtl && dialogueCtl.open && dialogueCtl.runner.state === 'choosing');
            if (!choosing) for (let n = 0; n < 4; n++) if (input.pressed('Digit' + (n + 1))) { qbToast(LOCKED[pl.components.quickbar[n + HAND_SLOTS]] ? 'empty' : quickbar.press(pl, n)); break; } // FB-01: a locked mana potion key does nothing
          }
        }
        if (fireball) { // SPELL-01a: aim = unit 3D look vector (pitch > 0 = up); trig stays here, outside sim/
          forwardOf(look.yawDeg, swordFwd);
          const pr = look.pitchDeg * DEG2RAD, cp = Math.cos(pr);
          fireball.step(playerHandle.data, fbOn && hands.downOf('spell.fireball'), swordFwd[0], swordFwd[1], swordFwd[0] * cp, swordFwd[1] * cp, Math.sin(pr));
          if (wardSim) wardSim.step(); if (fireRingSim) fireRingSim.step(); if (gustSim) gustSim.step(playerHandle.data, swordFwd[0], swordFwd[1]); if (gustView) gustView.stepFx(); // SPELL-06/07
          if (fbView) fbView.stepFx(); // SPELL-01b: trail emitters + burst particles (sim side, hashed)
          if (fbOn && handFxOn && spellVmH && !cinematic) { // HAND-WIRE-02 (FB-01: locked = no hand fire): hand embers / ignite / charge sparks, sim side
            const hp = playerHandle.data.transform, hb = playerHandle.data.components.body;
            stepHandFx(spellVmH, hands.handOf(SPELL_HAND_ITEM), fireball, hp.x, hp.y, hp.z + (hb && hb.eyeH ? hb.eyeH : 1.6), swordFwd[0], swordFwd[1], swordFwd[0] * cp, swordFwd[1] * cp, Math.sin(pr));
          }
        }
      }
      if (sword) { // runs every step: inputs inside the hit-stop window are not lost
        forwardOf(look.yawDeg, swordFwd);
        sword.step(playerHandle.data, swordFwd[0], swordFwd[1], hands ? (equipPlay ? equipPlay.swordDown : hands.downOf('sword')) : false); // EQ-07: no swing while the shield is raised
      }
      if (practiceTarget) practiceTarget.step();
      if (++errandTick % 64 === 0) errands.escortTick(); // QL-WIRE
      if (vitals) {
        const wasDead = vitals.dead;
        vitals.step(playerHandle.data, input.pressed(gameKeys.interact) || (deathFlow.active && deathRespawnDue)); // US-080a1 (30.2); DEATH-FLOW-01: fade end = virtual [E]
        if (wasDead && !vitals.dead) { if (swimWire) swimWire.reset(); deathRespawnDue = false; deathFlow.respawned(performance.now()); }
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
      { const pt = playerHandle.data.transform; leafFall.step(engine.world.scatter, engine.world.wind, pt.x, pt.y, clothTick); } // WIND-GUST-01b
      if (ambientMotes) { const pt = playerHandle.data.transform; ambientMotes.step(pt.x, pt.y, pt.z); if (fireflies) fireflies.step(pt.x, pt.y); } // S8-B1-18: position lives on .transform
      if (underCreep && playerHandle) { const pt = playerHandle.data.transform, st = engine.world.structureAt(pt.x, pt.y); const amb = (st && st.level && st.level.ambience) || null; underCreep.step(amb, pt.x, pt.y, pt.z); if (amb && underCreep.out.w > 0 && creepFirst.first(st.id || st.name || amb)) playRelayHum(); // chill cue, once per site per session
        applyCreepLights(lightSet, underCreep.out, creepSt); } // UNDER-LIGHT-CREEP-01
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
      updateInteraction(engine.world, engine, Camera.fromEntityInto(playerHandle.data, undefined, interactEye, pitchClampDeg), !ending && !uiLocked && !isNoteOpen() && input.pressed(gameKeys.interact)); // NOTE-CLOSE-01: while a note is up, E only closes it (never re-reads)
      // READ-01: the open note's fade + `[E]`/`[Esc]` close, right after
      // `updateInteraction` (which just fired `note.read` on the E edge). A
      // no-op while no note is open; the close guard (`state === 'open'`)
      // keeps the opening E press from also closing it.
      stepNoteRead(dt, input, !!(look && look.locked), interactEye); // BUG-NOTE-ESC-01: Esc under pointer lock = lock lost = close
      if (saveRelay && engine.world && engine.world.state['tower.sword.taken'] === true) saveRelay.quest.book.actKey('q.tower.blade.accept'); // PO-CH1-01: taking the sword is the safety net when the offer was skipped (no-op unless available)
      // OB-173: noteOffer.step (offer dialogue on note close) retired - the note panel accepts directly
      // QFIX-S5-CLOSE: reading the wake-spot page = Accept/Exit offer for 'A Blade in the Ashes' (objectGiver, D-087), opened when the note closes
      if (saveRelay && engine.world && engine.world.state['tower.sword.taken'] === true && saveRelay.quest.book.statusOf('tower.blade') === 2) { // PO-CH1-09: sword in hand and Burl (outside) within 10 m = the player left the tower (old saves / door missed): the blade is ready to hand in
        const bh = engine.world.get('bear'), bt3 = bh && bh.data.transform, p3 = playerHandle.data.transform;
        if (bt3 && (bt3.x - p3.x) ** 2 + (bt3.y - p3.y) ** 2 <= 100) saveRelay.quest.feed({ type: 'area:entered', id: 'towerDoor' });
      }
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
        if (offerToast && toasts && offerToastMsg) for (const line of offerToast.poll()) toasts.say(line, offerToastMsg.fg); // derived next offer after a hand-in / main step
        { // FS-01: M4 action hints; done-actions read from the live sims (swing/block/shot/swap/slot key/windows)
          actionSig.invOpen = !!(invView && invView.isOpen); actionSig.journalOpen = qlIsOpen();
          actionSig.swing = !!(sword && sword.state >= ST_LIGHT && sword.state <= ST_HARD);
          actionSig.block = !!(shieldSim && shieldSim.raised);
          const shotT = equipPlay ? equipPlay.bow.shotTick : 0; actionSig.shot = shotT > -1e8 && shotT !== actShotTick; actShotTick = shotT;
          const swT = equipPlay ? equipPlay.swapT : 0; actionSig.swap = swT > 0 && actSwapT === 0; actSwapT = swT;
          actionSig.slotKey = false; for (let n = 0; n < 4; n++) if (input.pressed('Digit' + (n + 1))) { actionSig.slotKey = true; break; }
          if (playerHandle) stepActionHints(engine.world, assets.uiStyle, controlBindings, playerHandle.data, itemDefs || {}, actionSig);
          if (hands && vitals) { fbS.fbOn = fbOn; fbS.hand = hands.handOf('spell.fireball'); fbS.casting = hands.downOf('spell.fireball'); fbS.manaFlashTick = vitals.manaFlashTick; stepFireballHints(engine.world, assets.uiStyle, controlBindings, fbS); } // FB-03
          actionSig.questAccepted = false;
        }
        stepHints(engine.world, assets.uiStyle, dt, hintSignals); // reused object (7.6 item 9: no per-step allocation)
        { // REGION-01: banner on region entry (queued while a panel / dialogue / note / travel fade is up)
          const rbA = window.ASSETS.uiRegionBanner, geo = window.ASSETS.levels && window.ASSETS.levels.world_geo;
          if (rbA && geo && (!regionBanner || regionBannerWorld !== engine.world)) { regionBannerWorld = engine.world; regionBanner = createRegionBanner({ style: rbA.style, names: rbA.names, regions: geo.regions, state: engine.world.state, colors: assets.palette.colors }); }
          if (regionBanner) { const rt0 = playerHandle.data.transform; regionBannerBlocked = uiLocked || (!!dialogueCtl && dialogueCtl.open) || isNoteOpen() || notice.active; regionBanner.step(dt, rt0.x, rt0.y, regionBannerBlocked); }
        }
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
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }; window.__debug.cam = cam; // OB-017: verify-equip-play reads the eye
  // US-006: reused per-frame scratch for `syncEntityLights`'s
  // `attachedLightPos` output (architecture.md 9 - no per-frame allocation).
  const lightSyncPos = new Float64Array(3);
  // D-025 (US-038a): assigned (not `const`-declared) into the module-scope
  // `fb` above, so the top-level `grid:changed` handler can refresh its
  // grid-sized fields (`depth`/`gbuf`/`matTable`/`light`) in place.
  fb = {
    rt, depth: depthBuffer, palette: assets.palette, lights: lightSet,
    light: createLightBuffer(rt.cols, rt.rows), timeSec: 0,
    gbuf, matTable, detailPass, // US-028
    voxelPool: gameVoxelPool, // US-041a (15.3 item 1)
    instances: engine.instances, // RE-06 (28.6)
    viewModel: engine.viewModel, // US-078a (30.1): the held sword; both mesh twins draw it when shown
    waterLooks: resolveWaterLooks(window.ASSETS.waterLooks), // US-055a2c (Q12 item 8): JS twin, same table as wgPipeline.setWaterLooks
    under: createUnderState(), // SWIM-04b/c: compositor + passShade call updateUnderState(eye vs surface) each frame
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

  let legRenderT = 0, legDtMs = 1000 / 60;
  function render(alpha) {
    const renderStart = performance.now();
    { const lt = legRenderT; legRenderT = renderStart; legDtMs = lt > 0 ? Math.min(50, Math.max(1, renderStart - lt)) : 1000 / 60; } // ANIM-C-05b: real frame time for the leg driver
    const bootFirst = !bootPrinted;
    if (farHold.active) { // OB-109: Continue/Load/back-to-menu swapped in a fresh Terrain: bake at full speed behind a card, no world render
      if (!farHold.step() && landCard) { landCard.remove(); landCard = null; } else if (landCard) landCard.set(farHold.frac);
      return;
    }
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
    if (mode === 'world' && engine.world.terrain) {
      engine.world.terrain.bakeFarStep(1);
      // AUD-34: terrain-mesh row builds (2 ms) moved here from the raster prepare hook; passRaster skips its own step when this flag is set.
      if (wgPipeline && terrainEnabled) { wgPipeline.terrainStepExternal = true; terrainMeshSetFor(engine.world.terrain).step(2); }
    }
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
      syncFb(); // FB-01: same-frame appearance after unlock
      if (wgPipeline && wgPipeline.setCarpetFrame && engine.world && engine.world.carpet) { const wp = engine.world.wind && engine.world.wind.params; wgPipeline.setCarpetFrame(fb.timeSec, wp && wp.speed > 0 ? wp : null); } // OB-073-D2f: blade sway time + wind
      // Arch review 1 (US-017): `lightSet` is rebuilt by the 'world:loaded'
      // handler on every restart - rebind it here, or `fb.lights` would keep
      // pointing at the previous world's LightSet (beacon state etc.).
      fb.lights = lightSet;
      if (fbView) { // SPELL-01b: ball/flash lights + the spell-hand coal glow, before lights.update below (glow = last frame's, 1 frame lag)
        fbView.present(alpha, cam);
        const sh = hands && !cinematic && fbOn && spellVmH ? hands.handOf(SPELL_HAND_ITEM) : null;
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
        if (giWire) giWire.sync(); // GI-PROBE-06: pointer compare; flips LightSet.gi when world.giField changes
        if (fxHook.cao || fxHook.shaft) { const pt = playerHandle && playerHandle.data.transform; fxHook.update(fb.lights, engine.world, pt ? pt.x : cam.x, pt ? pt.y : cam.y, pt ? pt.z : 0, 0.35, cam.x, cam.y); } // CONTACT-AO-01c / CANOPY-SHAFT-01c
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
      if (footIkWire) footIkWire.step(cam.dtMs || 1000 / 60); // ANIM-IK-01b: LegPose on kit characters (flat ground = w 0 = today's pose)
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
      if (postCfg && postV !== atmosV) { postV = atmosV; composePost(atmosState, postCfg, postState); creepMistBase = postState.mist[3] > 0 ? postState.mist[0] : 0; } if (postCfg && underCreep && creepMistBase > 0) postState.mist[0] = creepMistDensity(creepMistBase, underCreep.out.mist); if (postCfg && wgPipeline && wgPipeline._spritesPass) wgPipeline._spritesPass.post = postState; // POST-STACK-01c: compose for both paths (the GPU sprite pass reads the same state); the JS finish runs below, after the fade
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
      if (!fb.gpu) { if (postCfg) postCells(rt, fb.depth && fb.depth.depth, postState); else if (atmosState.on) gradeCells(rt, atmosState); } // REV-MAIN ENV-03 #1: JS-path finish incl. the grade ONLY off the GPU path, AFTER the CPU fade/dim (the GPU grades after fade too)
      // US-079a (29.1): beast notice markers, recorded fresh every frame, right before the overlay flush below.
      engine.overlay.clear();
      drawDecals(decalBind, engine.overlay, cam, fb.lights, engine.world);
      if (goblinWire) goblinWire.update(); // GOB-07b: spear view
      if (beastLegs) beastLegs.dtMs = legDtMs; if (lookatOn && beastLook && playerHandle) { const lt = playerHandle.data.transform; beastLook.setTarget(lt.x, lt.y, lt.z + 1.5); } if (beasts && !cinematic) presentBeasts(beasts, engine.world, engine.overlay, ovlStyles, beastAnimOn ? (beastAnim || (beastAnim = createBeastAnim(16))) : undefined, beastLegsOn ? (beastLegs || (beastLegs = createBeastLegs({ pool: gameVoxelPool }))) : undefined, cam, animblend ? (beastBlend || (beastBlend = createBeastBlend({ pool: gameVoxelPool }))) : undefined, lookatOn ? (beastLook || (beastLook = createBeastLook({ pool: gameVoxelPool }))) : undefined); // ANIM-C-05, ANIM-BLEND-03, ANIM-LOOKAT-01
      if (beastLook) (npcLook || (npcLook = createNpcLook(beastLook, () => (dialogueCtl && dialogueCtl.open ? dialogueCtl.speaker : null), () => 'player'))).step(engine.world); // ANIM-LOOKAT-01 AC3: NPC head follows only during dialogue
      if (beastLegsOn && !cinematic && mode === 'world') { const bh = engine.world.get('bear'), bv = bh && bh.data.components && bh.data.components.voxel; if (bv) (beastLegs || (beastLegs = createBeastLegs({ pool: gameVoxelPool }))).stepNpc('bear', bh.data, bv, cam.x, cam.y, engine.world.terrain); } // ANIM-C-05: Burl (scripted NPC bear)
      if (targeting && !cinematic) targeting.present(engine.overlay, ovlStyles); // US-128b (29.2)
      // US-078d (30.1): hidden until the sword is actually taken (US-078a review note); no eyeFeel/bobPhase
      // system exists yet in this codebase, so `simTime` stands in as the walk-bob phase (cosmetic only).
      const swimGear = !!(swimWire && swimWire.active(playerHandle.data)); // SWIM-03c: gear views hidden while swimming
      if (sword && swordVmH && !cinematic) {
        if (!swimGear && engine.world.state['tower.sword.taken'] && hands && hands.handOf('sword')) {
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
        (handFxOn ? presentHandFire : presentSpellHand)(spellVmH, hands && !cinematic && !swimGear && fbOn ? hands.handOf(SPELL_HAND_ITEM) : null, simTime, simTime, spellMoving, fireball);
      }
      if (equipPlay && !cinematic) { // EQ-07/09: first-person shield (right arm) / bow (left arm) + the arrow instances
        const eq7 = playerHandle.data.components.equipment, b7 = playerHandle.data.components.body;
        const mv7 = !!b7 && b7.grounded && (controls.forward !== 0 || controls.strafe !== 0);
        const tk7 = vitals ? vitals.tick : 0;
        const meleeOut = !swimGear && !!eq7 && eq7.set === 'melee' && eq7.off !== null && equipPlay.swapT === 0;
        const rangedOut = !swimGear && !!eq7 && eq7.set === 'ranged' && eq7.ranged !== null;
        if (presentShield(shieldVmH, meleeOut, shieldSim, tk7, simTime, mv7)) { playShieldClank(); blockSparkAt = simTime; }
        presentBow(bowVmH, rangedOut, equipPlay.bow, equipPlay.swapFrac, equipPlay.bow.tick, simTime, mv7);
        if (arrowView) { const pt7 = playerHandle.data.transform; arrowView.present(arrowSim, pt7.x, pt7.y); }
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
      if (chapterCard) chapterCard.pushDim(sceneDim); if (chapterCard2) chapterCard2.pushDim(sceneDim); // CH1-09
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
      useHintSet.n = 0; // INT-HL-01: hidden in dialogue/notes/menus/map/travel/title/death/cinematic; targeted object shows its prompt instead
      if (!ending && !uiLockedNow && !cinematic && !isWaterfallPreview && playerHandle && mode === 'world' && look && look.locked && !isNoteOpen() && !isSettingsOpen() && !(dialogueCtl && dialogueCtl.open)
        && !(vitals && vitals.dead) && deathFlow.phase === 'idle' && !wakeOut.inputLocked && !(travel && travel.inputLocked) && !(invView && invView.isOpen) && !(craftView && craftView.isOpen) && !qlIsOpen() && !(menuHost && menuHost.active)
        && resolveProjection(cam, 'mesh') === 'pitched') {
        useHintGrid.cols = rt.cols; useHintGrid.rows = rt.rows; useHintGrid.pxCellW = rt.pxCellW || 1; useHintGrid.pxCellH = rt.pxCellH || 1;
        pitchedTermsInto(useHintTerms, cam, useHintGrid);
        selectHints(engine.world, cam, engine.world.interaction.targetKey, useHintProject, useHintGrid, useHintLos, useHintSet);
        const hc = useHintColors[pulseStep(fb.timeSec)];
        for (let i = 0; i < useHintSet.n; i++) ui.setGlyph(Math.floor(useHintSet.col[i] / ui.sx), Math.floor(useHintSet.row[i] / ui.sy), HINT_GLYPH, hc);
      }
      if (params.get('dev') === '1' && beasts && !cinematic && mode === 'world' && resolveProjection(cam, 'mesh') === 'pitched') { // ED-AI-06: state names over heads
        aiLabelGrid.cols = rt.cols; aiLabelGrid.rows = rt.rows; aiLabelGrid.pxCellW = rt.pxCellW || 1; aiLabelGrid.pxCellH = rt.pxCellH || 1;
        pitchedTermsInto(aiLabelTerms, cam, aiLabelGrid);
        drawAiLabels(ui, beasts, aiLabelProject, cam.x, cam.y, aiLabelGround);
      }
      if (window.__debug) window.__debug.useHints = useHintSet; // tools/verify-use-hints.mjs
      if (questUiActive && !ending) {
        if ((!isCaptureOrBench || params.get('save') === '1') && !wakeOut.inputLocked) { gameHooks.drawHud(ui); if (relayWake) relayWake.drawHud(ui); } // D-050 seam: today the quest relay's TEMPORARY objective line, top-left
        drawHints(ui, assets.uiStyle, fadeLut);
        if (regionBanner && !regionBannerBlocked) regionBanner.draw(ui); // REGION-01: top-centre, clear of the prompt (below the cross) and the bottom-left hints
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
          drawVitals(ui, engine.world, assets.uiStyle.vitals, fb.timeSec, !vitals.dead && !wakeOut.inputLocked && !isMapOpen(), vitals, fbOn);
          if (swimWire) swimWire.draw(ui, assets.uiStyle.vitals, playerHandle.data, fb.timeSec); // SWIM-HOOKS-01
          drawHurtEdge(ui, vitals, fb.timeSec, assets.uiStyle.vitals, isReduceMotion()); drawWardRing(ui, wardSim); // SPELL-06
          if (equipPlay) { // EQ-07/09: block spark + the arrow count next to the hearts while the bow set is out
            const eqH = engine.world.get('player').data.components.equipment, hudOn = !vitals.dead && !wakeOut.inputLocked && !isMapOpen();
            if (eqH && eqH.set === 'ranged' && eqH.ranged !== null) drawArrowCount(ui, assets.uiStyle.vitals, eqH.quiver ? eqH.quiver.n : 0, hudOn);
            if (hudOn) drawBlockSpark(ui, ui.cols, ui.rows, (fb.timeSec - blockSparkAt) * 1000);
          }
          if (qbView && quickbar && playerHandle) { // EQ-12 + D-068: quick bar bottom-centre (OB-011: no potion HUD button; not in menus / cinematics)
            const qbOn = !vitals.dead && !wakeOut.inputLocked && !isMapOpen() && !isSettingsOpen() && !(invView && invView.isOpen) && !cinematic;
            qbView.drawBar(ui, playerHandle.data, quickbar.st, qbOn, LOCKED);
          }
          hurtFx.draw(ui); // HURT-FX-01
          deathFlow.draw(ui, ui.cols, ui.rows); // DEATH-FLOW-01
          presentPickups(engine.world, assets.pickupStyle, fb.timeSec); // US-080b
          compass.setHidden(compassHide); compass.draw(ui, ui.cols, ui.rows, fb.timeSec); // COMPASS-02 (D-061)
          if (!isCaptureOrBench && playerHandle) { const hp = playerHandle.data.transform; combatHud.frame(cam, fb.rt, ui, hp.x, hp.y, targeting ? targeting.targetId : null, fb.timeSec); combatHud.draw(ui, vitals.dead || wakeOut.inputLocked || isMapOpen() || isSettingsOpen() || pauseResume.soft || pauseResume.active || ending || !!(invView && invView.isOpen)); } // HPBAR-02 + DMGNUM-01
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
      if (barks && !ch1Hidden) barks.draw(ui, fb.timeSec); // CH1-06
      if (outLife && !(dialogueCtl && dialogueCtl.open)) outLife.draw(ui, fb.timeSec); // LIFE-04 overheard chat
      notice.draw(ui, ch1Hidden); // CH1-04a
      if (chapterCard) chapterCard.draw(ui); if (chapterCard2) chapterCard2.draw(ui); // CH1-09
      if (invView) invView.draw(ui); // US-091b: the pack screen, over HUD + toast
      if (invView && invView.isOpen && qbView && quickbar && playerHandle) { // QB-6: the bar inside the menu = the drag-and-drop target; the dragged icon rides the pointer
        syncHandSlots(playerHandle.data); qbView.drawBar(ui, playerHandle.data, quickbar.st, true, LOCKED);
        qbView.drawGhost(ui, qbDrag.ghostId, qbDrag.st.x, qbDrag.st.y);
      }
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
    } else if (mode === 'world' && pauseResume.active && !cinematic) { // OB-072: resumed-unlocked hint (no Esc text)
      const t = 'Click to continue', x0 = Math.floor((ui.cols - t.length) / 2), y0 = Math.floor(ui.rows / 2);
      for (let i = 0; i < t.length; i++) ui.setCell(x0 + i, y0, t[i], '#e8e2d0', '#0a0b10');
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
      extra += `\nmesh singles ${meshFeedStats.kept}/${meshFeedStats.requested} (cap ${MAX_MESH_DRAWS})${meshFeedStats.dropped ? '  DROPPED ' + meshFeedStats.dropped : ''}  draws ${meshFeedStats.drawItems}/${MAX_DRAW_ITEMS}${meshFeedStats.overflow || meshFeedStats.groupsDropped || meshFeedStats.instDropped ? `  OVERFLOW ${meshFeedStats.overflow} grp ${meshFeedStats.groupsDropped} inst ${meshFeedStats.instDropped}` : ''}`; // OB-039
      { const g = engine.world && engine.world.placementGrid; if (g) extra += `
stream act ${g.activeCount}/${g.memberCount} warm ${g.warmCount} cells ${g.cellCount}  cls ${Array.from(g.classCells).join('/')}${engine.world.streaming.enabled ? '' : '  [OFF]'}`; } // STREAM-01b
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
  // OB-109: "load up everything": every lazy mesh of the world while the bar is up ('props' slice, 60-75 %). `?prefetchall=0` = old near-spawn only.
  if (bootProg && bundle.lazyMeshes && params.get('prefetchall') !== '0') {
    bootProg.phase('props'); await bootPaint();
    const r = await prefetchAllLazyMeshes(bundle.lazyMeshes, engine.world, (d, t) => bootProg.count('props', d, t));
    window.__prefetchAll = r; await bootPaint();
  }
  // OB-109: finish the far terrain behind the boot card ('land' = last 40 % of the bar) so the first frame already has the mountains.
  // Capture/bench pages have no card and keep the in-frame 1 ms bake. Later world swaps (Continue/Load/menu) hold via farHold in update/render.
  if (bootProg && params.get('farhold') !== '0' && mode === 'world' && engine.world && engine.world.terrain && farHold.begin(engine.world.terrain, params.get('prebake') !== '0' ? engine.world : null)) { // OB109-B3: + band pre-bake as the second half of the bar
    const t0 = performance.now();
    bootProg.phase('land'); await bootPaint();
    while (farHold.step()) { bootProg.fraction('land', farHold.frac); await bootPaint(); }
    window.__farHoldMs = performance.now() - t0;
    console.info(`[boot] far terrain + bands baked behind the card in ${window.__farHoldMs.toFixed(0)} ms (${farHold.slices} slices, bands ${(engine.world.bandCache.bytes / 1048576).toFixed(1)} MB)`);
  }
  { // R6-WIRE: card impostors from the quality preset (after the pre-bake; capture/bench pages without a preset stay impostor-free)
    const fo = window.ASSETS && window.ASSETS.levels && window.ASSETS.levels.overworld_far && window.ASSETS.levels.overworld_far.recipe && window.ASSETS.levels.overworld_far.recipe.forest;
    if (resolvedQuality && resolvedQuality.knobs && fo && fo.trees) applyImpostorBoot(engine, resolvedQuality.knobs, { species: fo.trees.species, log: console.warn, imp: params.get('imp') });
    // bindScatterInstances rebuilds the tree groups on both events: reapply the remembered knobs AFTER the engine's own listener (registered earlier)
    if (resolvedQuality && resolvedQuality.knobs && fo && fo.trees) for (const ev of ['world:scatter', 'world:loaded']) engine.events.on(ev, () => { try { reapplyRememberedImpostors(engine); } catch (e) { console.warn('impostor reapply', e); } });
  }
  window.__farReadyAtBoot = !!(engine.world && engine.world.terrain && engine.world.terrain.farReady);
  if (bootProg) engine.events.on('world:loaded', ({ world: nw }) => {
    if (!bootPrinted || !nw || !nw.terrain || !farHold.begin(nw.terrain, params.get('prebake') !== '0' ? nw : null)) return;
    if (!landCard) landCard = createLandCard();
    landCard.set(0);
  });
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
    lights, light: createLightBuffer(rt.cols, rt.rows), timeSec: 0, gpu: true, renderer: 'mesh', voxelPool: pool,
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
const quitSave = createQuitSave({ canSave: () => !!gameHooks.ctx.state.canSave, titleActive: () => titleMenuActive, save: () => { if (saveRelay && saveRelay.enabled && gameHooks.ctx.requestSave) gameHooks.ctx.requestSave(); } }); // OB-079: quit = save
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) doResize(); else quitSave.onVisibility(true);
});
window.addEventListener('pagehide', () => quitSave.onPageHide());
window.addEventListener('pageshow', doResize);
