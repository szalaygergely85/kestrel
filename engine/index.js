// @ts-check
// engine/index.js - the ONLY public entry point (docs/architecture.md
// section 2/5). Re-exports only, no logic. `game/` and `tools/` must import
// exactly this file, never a deep `engine/**` path (check-deps rule 3).
//
// US-024 Phase C status: physics/entities moved in too (`config.js`,
// `capsule.js`, `Player.js`, `EyeFeel.js` - see each module's header). Only
// `integrate`/`moveSphere`/`Entity`/`Camera.fromEntity`/`EntityHandle`/
// `stepAnimations`/`World`/`Terrain`/`serialize` remain stubs (US-025/
// US-011/US-013) - the SHAPE is normative now, the behaviour lands with
// those stories.

// ---- bootstrap --------------------------------------------------------
export { mark as bootMark, span as bootSpan, bootNow, freezeBootMarks, bootEntries, bootReport } from './core/bootMarks.js'; // BOOT-SPEED-01
export { createBootProgress, asciiBar, BOOT_PHASES } from './core/bootProgress.js'; // boot loading card model
export { createEngine, clampGrid, GRID_MIN_COLS, GRID_MAX_COLS, GRID_DEFAULT_COLS } from './core/engine.js';

// ---- CO-1 coordinate/transform API (docs/coordinates.md section 3) ------------
export {
  DEG2RAD, RAD2DEG, QUARTER_COS, QUARTER_SIN, wrapDeg, shortestArcDeg, yawFromDelta, forwardOf, rightOf,
  rotateVec2, dirFromAzEl, localToWorld, worldToLocal, localDirToWorld, localYawToWorld,
  worldYawToLocal, frameBBox, rotatedSize, localCellToWorld, frameEquals, transformPoint,
} from './core/transform.js';
export { makeFrame as createFrame } from './core/transform.js'; // ENG-API-01c: makeFrame deprecated

// ---- content ------------------------------------------------------------
export { AssetRegistry } from './core/assets.js';
export { loadLevel } from './world/Level.js';
export { validateUnder, validateUnderSite } from './world/validateUnder.js'; // UNDER-00c

// ---- US-027a JSON content pack loader (architecture.md 21) ----------------
export { LATEST_SCHEMA, ID_COLLECTIONS, REF_FIELDS, KEY_ORDER, ORDERED_MAPS, ENVELOPE_KEYS } from './content/schema.js';
export { ContentError } from './content/ContentError.js';
export { migrateContent, MIGRATIONS } from './content/migrate.js';
export { stringifyContent } from './content/stringify.js';
export { maskToJSON, maskFromJSON, downsampleAlpha, MASK_ID_RE } from './content/maskFile.js'; // ALPHA-01a
export { prefabFromJSON, placePrefabItems, PREFAB_ITEM_TYPES } from './content/prefabFile.js'; // PREFAB-SEAM (38.11)
export { loadContentPack, globalId } from './content/loadPack.js';
export { validatePackageManifest, openPackage, mountPackages, loadPackageModels, checkDependencies, parseSemver, parseRange, KPKG_FORMAT, KPKG_FORMAT_VERSION, KPKG_SCHEME } from './content/package.js'; // KPKG-02 (38.30)
export { readZip, writeZip, crc32, checkZipPath, ZIP_LIMITS } from './content/zip.js'; // KPKG-01/03 (38.30)

// ---- world ----------------------------------------------------------------
export { gustBand } from './world/wind.js'; // WIND-GUST-01b: injected into createLeafFall (fx/** may not import world/**)
export { World, stepSectorAnims, PROP_SCALE_MIN, PROP_SCALE_MAX } from './world/World.js';
export { GIBake, encodeRaw as encodeGIBake } from './world/giBake.js'; // GI-PROBE-02b
export { createGIState, mixGIState } from './render/giProbe.js'; // GI-PROBE-06
export { createContactAO, setDynamicBlobs, buildContactBlobs, CAO_MAX } from './render/contactAO.js'; export { SHAFT_DEFAULTS } from './render/lightShaft.js'; // CONTACT-AO-01c / CANOPY-SHAFT-01c game hookup
export { writeGIFile, readGIFile, readGIHeader, isGIFileFresh } from './world/giFile.js';
export { zoneAt, zoneId, CHUNK as BAND_CHUNK } from './world/bandGrid.js';
export { makeGrid as createBandGrid } from './world/bandGrid.js'; // ENG-API-01c: makeGrid deprecated (generic word, area prefix)
export { validateCarpetConfig, buildCarpetClassMap, CARPET_MAX_VARIANTS, CARPET_DEFAULTS } from './world/carpet.js';
export { scatterTrees, validateScatterConfig, scatterDetail, validateDetailConfig, hash2 } from './world/scatter.js';
export { Terrain } from './world/Terrain.js';
export { createEditLayer, editLayerFromJSON, editLayerToJSON, applyDab, editHeightAt, heightDelta, typePaint, sampleDh, sampleType, setSampleDh, setSampleType, NO_PAINT } from './world/terrainEdits.js'; // ED-TERRAIN-1a
export { createGrassMask, maskAt as grassMaskAt, sampleAt as grassSampleAt, setSample as setGrassSample, grassMaskFromJSON, grassMaskToJSON, bakeAreasToMask, paintAt as decorPaintAt } from './world/grassMask.js'; // MASK-a (OB-096)
export { Level } from './world/Level.js';
export { serialize, deserialize } from './world/serialize.js';

// ---- render passes --------------------------------------------------------
// Frame/sky pass internals stay in engine/dev.js. ambientL/HFOV_DEG
// remain stable clients of the mesh render path and editor.
export { ambientL } from './render/sky.js';
export { PROJ_HFOV_DEG as HFOV_DEG } from './render/projection.js';
export { sunFromWorld } from './render/lighting.js';
export { shadeTerrainCells } from './render/terrainShade.js';
export { buildTuftAtlas, tuftLookup, tuftPlaneT, texelR, texelG, TUFT_ATLAS_DEFAULTS } from './render/tuftAtlas.js';
export { sunFromHours, sunPathFrom, SUN_PATH_DEFAULT } from './core/sunPath.js';
export { AO_DEFAULTS } from './render/horizonAo.js'; // host `?ao=` reads the engine defaults (B1 nit)
export { swayOffset, packWindUniforms, windSwayOn, INST_FLAG_SWAY, SWAY_K, SWAY_MAX } from './mesh/sway.js'; // S8-B2-06
export { packDecorLayers, DEFAULT_DENSITY_Q8 } from './mesh/decorScatter.js'; // ENV-01-WIRE: main.js builds the WgDecorPass config (38.62)
export { shadeTerrain } from './render/terrainShade.js';
export { makeTerrainShadeCtx as createTerrainShadeCtx } from './render/terrainShade.js'; // ENG-API-01c: makeTerrainShadeCtx deprecated
export { packTerrainTextures, TLOOK_WIDTH } from './render/gpu/TerrainTextures.js';
export { drawSprites, SpritePool, MAX_SPRITES } from './render/sprites.js';
export { validatePost, createPostState, composePost, postCells } from './render/post.js'; // POST-STACK-01a (38.73): per-cell finish chain, JS twin
export { createFogHour } from './render/fogHour.js'; // NIGHT-HAZE-01
export { createAtmosState, mixAtmos, applyAtmosToPalette, gradeCells, gradeRGB, ATMOS_FOG_FIT } from './render/atmos.js'; // ENV-03c: biome atmosphere (game driver = ENV-03a)
// ---- US-030c GPU sprite pass + atlas + parity harness ----------------------
export { buildSpriteAtlas } from './render/gpu/spritesAtlas.js';
export { drawText, drawTextScaled } from './render/textDraw.js';
// US-047: runShadeTest/runDetailShadeTest (shading parity harness) moved to
// engine/dev.js. Item 6b fix pass (docs/backlog.md): runSpriteCompare's only
// real caller is game/js/dev/spriteDev.js (a dev-only parity mode), so it
// belongs in engine/dev.js with the other parity harnesses, not the stable
// surface - moved there.

// ---- US-028 detail pass v2 (G-buffer shading, edge pass) -------------------
// US-069 (architecture.md 24.12 item 4): the full KIND_* range, not just the
// two callers had needed before the editor - `tools/editor/ray.js` used to
// hard-code KIND_NONE..KIND_CEIL as a workaround; it now imports the real
// constants from here.
export {
  GBuffer, KIND_NONE, KIND_WALL, KIND_STEP, KIND_UPPER, KIND_FLOOR, KIND_TOP, KIND_CEIL,
  KIND_TERRAIN, KIND_MODEL, FACE_PACKED, PLANEID_TERRAIN, packPlaneId,
} from './render/GBuffer.js';

// ---- US-039/US-040 voxel models (architecture.md 15.1/15.2) ---------------
// Exported now (15.2 item 1 supersedes 15.1's "no exports until US-041"):
// the gpucompare harness needs them.
export { validateVoxelModel, assertVoxelModel, MAX_VOX_PARTS, MAX_VOX_INSTANCES, MAX_VOX_INSTANCES_MESH, MESH_ONLY_MAX_DIM, MESH_ONLY_MAX_CELLS } from './voxel/VoxelModel.js';
export { packVoxelModel } from './voxel/voxelPack.js';
export { validateBlend, packBlend, BLEND_FADE_DEFAULT_MS, BLEND_FADE_MAX_MS } from './voxel/blendPack.js'; // ANIM-BLEND-01a (38.68)
export { deriveEmissiveLight, EMISSIVE_LIGHT_MIN } from './voxel/emissiveLight.js';
export { buildVoxelMesh, MESH_ONLY_MAX_QUADS } from './mesh/voxelMesh.js';
export { prebuildTerrainMesh } from './mesh/terrainMesh.js'; // ED-MESH-1a
export { createFrameRenderer } from './render/frameRenderer.js'; // ED-WG-01a (38.21)
export { createModelPreview, fitPreviewCamera } from './preview/modelPreview.js'; // EQ-04a (38.40)
export { loadGltf, buildMeshFromTris, KIND_MESH, readRiggedGlb, sampleRiggedClip } from './mesh/gltf.js'; // ME-13a (architecture.md 27.2 Public API); RIG-01
export { MaskAtlas, buildMaskAtlas, cutoffByte } from './render/MaskAtlas.js'; // ALPHA-01c: test worlds (gpucompare alphaLeaves) build their own atlas
// ME-13b: content/meshes/<id>.mesh.json (de)serialization + validation -
// needed by tools/gltf-import.mjs (and any future mesh-producing CLI tool)
// to write/round-trip a MeshData; MeshData's own typedef is already the
// documented public shape (27.3), these are just its (de)serialize/validate
// functions.
export { meshToJSON, meshFromJSON, validateMesh } from './mesh/MeshData.js';
export { encodeMeshBin, decodeMeshBin, meshFromBin, meshBinMeta, MESH_BIN_VERSION } from './mesh/meshBin.js'; // MESH-BIN-01
export { simplifyTriangles } from './mesh/simplify.js'; // TREES-LP-a: tools/dae-import.mjs
export { buildPrismProxy, buildHullProxy, HULL_MAX_FACES, planMeshCollision, PROXY_BAND_H, WALK_OVER_H } from './mesh/colliderProxy.js';
export { VoxelPool } from './render/voxelPool.js';
export { GLOW_LEVELS } from './render/glow.js'; // EMIS-03/04: emissive bleed + halo presets
export { bindShading, bindLevel } from './render/MaterialTable.js';
// RE-06 (28.6): instanced voxel units - per-instance buffer helpers + team colour remap.
export { createViewModelLayer, VM_OBJECT_ID, VM_MAX_HANDLES, VM_FEET_BELOW_EYE } from './render/viewModel.js'; // US-078a
export { bakeImpostor } from './mesh/impostorBake.js'; // R6c (38.60): opt-in tree card impostors (host bakes, then enableGroupImpostor)
export { enableGroupImpostor } from './mesh/impostorCard.js';
export { resolveGroupLod1 } from './mesh/instances.js';
export { createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE, UNIT_OBJECT_BASE, MAX_INSTANCES_PER_FRAME } from './mesh/instances.js';
export { bindDetailInstances, feedDetail, removeDetailInstances, DETAIL_OBJECT_BASE } from './mesh/scatterFeed.js';
// GFX-03: quality knobs (scatter density, LOD scale, tuft draw scale) and the sun shadow levels / 'off'.
export { GFX_DEFAULTS, GFX_RANGES, resolveGfxKnobs } from './mesh/gfxKnobs.js';
export { CLOUD_Q_SHIFT, resolveShadowLevel, SHADOW_LEVELS, resolveSunShadowOptions, SUN_SHADOW_DEFAULTS } from './render/shadowSun.js';
export { PSH_NEAR, POINT_SHADOW_DEFAULTS, resolvePointShadowOptions, FACE_TABLE, pointFaceOf, pointFaceMatrix, pointFacePlanes, pointFaceBounds, pointSphereBounds, pointDepthEncode, pointDepthDecode, pointShadowTaps, pointShadowInfo, pointShadowKey, quantiseOrigin, createShadowLightState, selectShadowLights } from './render/shadowPoint.js';
export { cloudShadeQ, cloudMul, packCloudUniforms } from './render/cloudShadow.js'; // S8-B2-12c (38.13)
export { buildTeamRemap, TEAM_SLOTS, MAX_TEAMS } from './render/teamRemap.js';
// US-047: computeDerivatives/shadeSurfaces/shadeV2 (detailShade.js) and
// edgePass moved to engine/dev.js - pass internals + parity tooling only,
// no stable client calls them directly.

// ---- world compositor (US-025) ---------------------------------------------
export { renderWorld } from './render/compositor.js';
export { packLevel, repackMaterials } from './world/packed.js';

// ---- US-006 lighting (ambient + point lights + flicker) -------------------
export {
  LightSet, buildLightSet, setWorldSun, applySunHours, applySunPair, syncEntityLights, lightAt, lightSurfaces,
  computeVisGrid, sunVisible, falloff as lightFalloff, packLightUniforms,
  MAX_LIGHTS, setLook, OUTDOOR_SHIFT,
} from './render/lighting.js';

export { makeLightBuffer as createLightBuffer } from './render/lighting.js'; // ENG-API-01c: makeLightBuffer deprecated
// ---- ART-01a look + roof map (docs/architecture.md 37.18 items 2/3) ----------
export { resolveLook, validateLook, blendLook } from './render/look.js';
export { buildRoofMap, outdoorAt, MAX_ROOF_BOXES } from './render/roofMap.js';

// ---- US-029 GPU cell pipeline (shading + edge pass on the GPU) ------------
export { probeWebGpu, evaluateWebGpuLimits } from './render/gpu/device/webgpuProbe.js'; // WG-1a
export { createGpuDevice } from './render/gpu/device/createGpuDevice.js'; // WG-1b2
export { createRenderer } from './render/createRenderer.js'; // WG-1c2
export { WG_PASS_NAMES } from './render/gpu/wg/WgCellPipeline.js'; // S8-B1-07: WgCellPipeline's real per-pass GPU timer names
export { RenderTargetWebGPU } from './render/RenderTargetWebGPU.js'; // WG-1c1
export { RenderTarget } from './render/RenderTarget.js'; // ENG-API-01c: CPU Canvas2D target factory (38.74)
export { CellBuffer } from './render/CellBuffer.js'; // WG-1c1 (present test page)
export { WGSL_MODULES, summarizeCompilation } from './render/gpu/wgsl/index.js'; // WG-1c1
export { resolveWaterLooks } from './render/waterLook.js'; // US-055a2c Q12 item 8: main.js's fb.waterLooks (JS twin)
// US-047: runGpuCompare/compareCells/compareGeometry/compareLight/poison*
// (gpucompare parity harness) moved to engine/dev.js.
export { flickerStep, flickerReprojStep, flickerGlyphReasons, GLYPH_REASONS, M255_KEYS, glyphClassTable } from './render/gpu/flicker.js';
export { setFoliageDice, setFoliageLight, setFoliageEdge } from './render/fogShape.js'; // AA-15 (OB-208): ?aafol=0; AA-16: ?aafoll=0; AA-17: ?aafoledge=0

// ---- physics ----------------------------------------------------------------
export { PHYSICS_DEFAULTS, PHYSICS } from './physics/config.js';
export { moveCapsule, isSectorPassable, sectorOrOutside } from './physics/capsule.js';
export { boundsOvershoot } from './physics/bounds.js'; // SPELL-R4: blink target bounds test
export { moveSphere } from './physics/sphere.js';
export { stepRollers, resolveBodyContacts, rollFrame } from './physics/roller.js';
export { integrate } from './physics/integrate.js';

// ---- entities ---------------------------------------------------------------
export { Entity } from './entities/Entity.js';
export { Camera } from './entities/Camera.js';
export { EntityHandle } from './entities/EntityHandle.js';
export { stepAnimations, animComponent } from './entities/animation.js';
export { createAnimState, blend as animBlend, BLEND_MS as ANIM_BLEND_MS, PRIORITY as ANIM_PRIORITY } from './entities/animState.js';
export { bindClips, applyAnimState, modelClipNames } from './entities/animClips.js';
export { createClipPlayer, clipPlay, clipStep, clipSetPhase, clipFromW } from './entities/clipPlayer.js';
export { createLegDriver } from './entities/legDriver.js'; // ANIM-C-05: game beastView leg IK wiring
export { createFootIk } from './entities/footIk.js'; // ANIM-IK-01b: game footIkWire (player/kit foot placement)
export { voxelPointWorld } from './voxel/voxelPose.js'; // ANIM-IK-01b: clip foot world position for footIkWire
export { pickGait, gaitRate } from './entities/gait.js';
export { tintAt, setTint, sampleTint } from './entities/tintEnvelope.js';
export { createEntityTintTable, clearEntityTints, pushEntityTint, pushEntityTintSample, fillEntityTints, entityTintAt, tintChannel, ENTITY_TINT_MAX } from './render/entityTint.js';
export { Player } from './entities/Player.js';
export { createEyeFeel, updateEyeFeel } from './entities/EyeFeel.js';

// ---- ui -----------------------------------------------------------------------
export { DebugOverlay } from './ui/debugOverlay.js';
export { drawCrosshair } from './ui/crosshair.js';

// ---- US-015 UI panels, rich text, scene dim (docs/architecture.md 7.6) ------
export { compileRichLine, drawRichLine, hexToRgb } from './ui/richText.js';
export { compileDialogue, validateDialogue, createDialogueRunner } from './ui/dialogue.js'; // DIALOGUE-01a1 (38.28)
export { buildPanelArt, createPanel, drawPanel, Panel } from './ui/panel.js';
export { createSceneDim, resetSceneDim, pushDimRect, applySceneDim } from './ui/sceneDim.js';
// ---- OWN-REQ-003 UI layer (docs/architecture.md 17) -------------------------
export { createUiLayer, clampUiCols, UI_GRID_ASPECT } from './ui/uiLayer.js';

// ---- RE-05 pathfinding: NavGrid + A* (docs/architecture.md 28.2) ------------
// Leaf module (engine/nav/**): never imports render/mesh/ui/world
// (check-deps rule 14); World is passed into buildFromWorld duck-typed.
export { NavGrid } from './nav/NavGrid.js';
export { createAStar, findPath, findPathCells, smoothPath, pathCrossesRect, planPath } from './nav/astar.js';
export { bakeSheets, createSheetBaker, buildLayersFromArrays, validateLinks, addAuthoredLinks } from './nav/sheets.js'; // NAV-LAYERS-01b/d

// ---- interaction (US-012) ------------------------------------------------------
export { findInteractTarget, updateInteraction, hasLineOfSight } from './world/interaction.js';
export { arcHits } from './world/meleeArc.js'; // US-078b melee wedge query
export { explosionHits } from './world/explosion.js'; // US-136 blast query (32.4)
export { applyImpulse, IMPULSE_MAX_H, IMPULSE_MAX_V } from './physics/impulse.js'; // US-136 knockback
export { createCloth, MAX_CLOTH_NODES, createClothColliders, setSphere as setClothSphere, setCapsule as setClothCapsule, setBox as setClothBox, setPlane as setClothPlane } from './physics/cloth.js'; // CLOTH-1a1 XPBD cloth (33)
export { createClothSystem, collectClothDefs, MAX_CLOTHS, MAX_CLOTH_BODIES, DEFAULT_CLOTH_PRESETS } from './world/cloths.js'; // CLOTH-1b3 cloth system (33.5)
export { attachedLightPos } from './entities/attach.js';

// ---- triggers + fade + restart (US-017) ------------------------------------
export { buildTriggers, updateTriggers } from './world/triggers.js';
export { createFadeLut, fadeGlyph, applySceneFade, clearMaskForSceneFade } from './ui/fade.js';

// ---- behaviours ---------------------------------------------------------------
export { registerBehaviour, unregisterBehaviour, registerInteraction, registerTrigger, getBehaviour, validateBehaviours, listBehaviours } from './core/behaviours.js';

// US-047 (architecture.md section 5): Input/PlayerLook/Events/FrameProfiler
// ("may change without notice") moved to engine/dev.js - dev-mode code
// (game/js/main.js, game/js/dev/*, tools/* except tools/editor/**) imports
// them from there now.

// ---- RE-01/28.1 pitched camera projection (docs/architecture.md 28.1) ------
// Only the pitched-camera API; the pre-existing shear-path exports
// (projTerms/shearProjection/projectPoint/unprojectCell/windowToCell/
// PROJ_HFOV_DEG/PROJ_NEAR/PROJ_FAR) stay internal/test-only as before.
export {
  createPitchedTerms, pitchedTerms, pitchedTermsInto, pitchedProjection, screenRay, unprojectPitched,
  worldToCell, pitchedEyeFromFocus, resolveProjection, fpVfovDeg, PITCH_CLAMP_PITCHED_DEG, PROJ_PITCHED_VFOV_DEG, pitchedFogScale, frameMatrix,
} from './render/projection.js';

// ---- RE-04 screen -> world picking (docs/architecture.md 28.1) ------------
export { rayTerrain, pickNearest, selectInRect } from './render/pick.js';

// ---- RE-08/RE-09 flow-field pathfinding + local avoidance (docs/architecture.md 28.2) --
export { createFlowField, FlowCache } from './nav/flowField.js';
export { createSteer } from './nav/steer.js';
export { createPathFollower } from './nav/pathFollow.js';
export { perceive, NOISE_SPRINT, NOISE_SWING } from './nav/perceive.js';
export { leashState, returnTarget, LEASH_HOME, LEASH_ENGAGE, LEASH_RETURN, LEASH_GIVEUP } from './nav/leash.js';

// ---- RE-11 fog-of-war visibility grid (docs/architecture.md 28.3) ---------
export { Visibility } from './world/Visibility.js';

// ---- RE-13 minimap (docs/architecture.md 28.4; generic names prefixed per architect note) --
export {
  createMinimap, minimapToWorld, worldToMinimap,
  bakeTerrain as bakeMinimapTerrain, update as updateMinimap, bindFog as bindMinimapFog,
} from './render/minimap.js';

// ---- RE-03 RTS camera controller (docs/architecture.md 28.1; generic names prefixed per architect note) --
export { createRtsCamera, update as updateRtsCamera, zoomBy as zoomRtsCamera } from './core/rtsCamera.js';

// ---- RE-14 deterministic sim: commands/rng/hash/replay + loop STEP --------
export { createCommandQueue } from './core/commands.js';
export { createRng } from './core/rng.js';
export { compileLogic, createLogic, validateLogic, LOGIC_LIMITS } from './core/logic.js'; // ED-LOGIC-01a
export { createHasher } from './core/hash.js';
export { createRecorder, createPlayer as createReplayPlayer } from './core/replay.js';
export { STEP as SIM_STEP } from './core/loop.js'; // architect RE-EXP review: not a bare STEP next to STEP_MIN/KIND_STEP

// ---- RE-07 selection overlay (docs/architecture.md 28.9) ----
export { createOverlay, applyOverlay, OVL_MAX_OPS } from './ui/overlay.js';

// ---- US-133 fire spread sim (architecture.md 32.3) ----
export { createFireGrid } from './world/fireGrid.js';

// ---- US-053a particle sim (docs/architecture.md 32.1) ----
export { createParticles, PARTICLE_CAP, MAX_EMITTERS as PARTICLE_MAX_EMITTERS } from './fx/particles.js';
export { createEntityEmitters } from './world/entityEmitters.js';

// ---- S8-B2-13b splash ripples (docs/architecture.md 38.14, the note of record) ----
export { createRipples, RIPPLE_LIFE, RIPPLE_SPEED, RIPPLE_W } from './fx/ripples.js';
export { defineHitSparks, hitSparks, HIT_SPARK_HUES } from './fx/hitSparks.js';
export { defineLeafFall, createLeafFall, LEAF_FALL } from './fx/leafFall.js';
export { defineWadeSplash, wadeSplashAt, arrowSplashAt, WADE_SPLASH } from './fx/wadeSplash.js';
export { laneCells, laneAlpha, LANE_CELL_M, LANE_ALPHA_MAX } from './fx/chargeLane.js';

// ---- US-055a1 water regions + query (architecture.md 32.2; the query is `World#waterAt`) ----
export { createWater, collectWaterDefs, WATER_MAX } from './world/water.js';
export { L_LAT, L_TX, L_TY } from './world/river.js'; // RIVER-01b: riverLocate scratch indices (game wading reads the bank side + tangent)
export { createWaterfalls, collectWaterfallDefs } from './world/waterfalls.js';

// DECAL-01: wall-text bindings over the shared overlay layer.
export { bindDecals, drawDecals } from './ui/decals.js';
export { LazyMeshStore, ensureMesh, requestMesh, meshReady } from './mesh/lazyMesh.js'; // MESH-LOAD-01
export { meshFeedStats, MAX_MESH_DRAWS, MAX_DRAW_ITEMS } from './mesh/DrawList.js'; // OB-039: single placed-mesh draws requested/kept/dropped (F3)
export * from './chargen/index.js'; // CHARGEN-02..05 (38.29)
export { riggedFromGlb } from './chargen/fromGlb.js'; // RIG-02a (38.32); not via chargen/index.js: loading gltf.js there shifts mesh.test's heap-based alloc probe

// ---- fauna (WILD-03, architecture.md 38.31) -----------------------------------
export { compileFaunaDef } from './fauna/faunaDef.js';
export { createFauna } from './fauna/fauna.js'; // WILD-06
export { createFaunaFeed, WILD_DRAW_MAX } from './fauna/feed.js';
export { createSpawner, FAUNA_MAX, CELL_M as FAUNA_CELL_M } from './fauna/spawner.js';
export { updateUnderState, UNDER_DEFAULT } from './render/underwater.js'; // SWIM-04c (38.54)
export { makeUnderState as createUnderState } from './render/underwater.js'; // ENG-API-01c: createX naming; makeUnderState deprecated
export { createAnimBlender } from './entities/animBlend.js'; // ANIM-BLEND-01b (38.68)
export { createLookAt } from './entities/lookAt.js'; // ANIM-LOOKAT-01 (38.69 lane note)

// ---- public typedefs (ENG-API-01c, 38.74; types only, no runtime export) -------
/** @typedef {import('./render/minimap.js').Minimap} Minimap */
/**
 * Injected world adapter of the ambient fauna (createFauna(def, env, ...)); game-side impl: game/js/wild/wildEnv.js.
 * @typedef {Object} FaunaEnv
 * @property {Function} groundAt @property {Function} slopeZ @property {Function} habitatAt @property {Function} blocked
 * @property {Function} moveCircle @property {Function} perchNear @property {Function} [trunkNear]
 */

// ---- bootstrap: ENG-API-01b deprecated aliases (38.74; tier `deprecated` in engine/api-1.0.json) ----
// Old names stay for one release; each warns once when setApiWarnings(true) (engine/core/deprecate.js).
export { setApiWarnings, deprecated } from './core/deprecate.js';
import { deprecated as _dep } from './core/deprecate.js';
import { makeFrame as _makeFrame } from './core/transform.js';
import { makeGrid as _makeGrid } from './world/bandGrid.js';
import { makeTerrainShadeCtx as _makeTerrainShadeCtx } from './render/terrainShade.js';
import { makeLightBuffer as _makeLightBuffer } from './render/lighting.js';
import { makeUnderState as _makeUnderState } from './render/underwater.js';
import { selfTestDevice as _selfTestDevice } from './render/gpu/device/createGpuDevice.js';
export const makeFrame = _dep('makeFrame', _makeFrame, 'createFrame');
export const makeGrid = _dep('makeGrid', _makeGrid, 'createBandGrid');
export const makeTerrainShadeCtx = _dep('makeTerrainShadeCtx', _makeTerrainShadeCtx, 'createTerrainShadeCtx');
export const makeLightBuffer = _dep('makeLightBuffer', _makeLightBuffer, 'createLightBuffer');
export const makeUnderState = _dep('makeUnderState', _makeUnderState, 'createUnderState');
// Dev tooling moved to engine/dev.js (fixtures + harnesses already live there; selfTestDevice added now).
export const selfTestDevice = _dep('selfTestDevice', _selfTestDevice, 'engine/dev.js');
