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
  rotateVec2, dirFromAzEl, makeFrame, localToWorld, worldToLocal, localDirToWorld, localYawToWorld,
  worldYawToLocal, frameBBox, rotatedSize, localCellToWorld, frameEquals, transformPoint,
} from './core/transform.js';

// ---- content ------------------------------------------------------------
export { AssetRegistry } from './core/assets.js';
export { loadLevel } from './world/Level.js';

// ---- US-027a JSON content pack loader (architecture.md 21) ----------------
export { LATEST_SCHEMA, ID_COLLECTIONS, REF_FIELDS, KEY_ORDER, ORDERED_MAPS, ENVELOPE_KEYS } from './content/schema.js';
export { ContentError } from './content/ContentError.js';
export { migrateContent, MIGRATIONS } from './content/migrate.js';
export { stringifyContent } from './content/stringify.js';
export { maskToJSON, maskFromJSON, downsampleAlpha, MASK_ID_RE } from './content/maskFile.js'; // ALPHA-01a
export { loadContentPack, globalId } from './content/loadPack.js';

// ---- world ----------------------------------------------------------------
export { World, stepSectorAnims, PROP_SCALE_MIN, PROP_SCALE_MAX } from './world/World.js';
export { scatterTrees, validateScatterConfig, scatterDetail, validateDetailConfig, hash2 } from './world/scatter.js';
export { Terrain } from './world/Terrain.js';
export { createEditLayer, editLayerFromJSON, editLayerToJSON, applyDab, editHeightAt, heightDelta, typePaint, sampleDh, sampleType, setSampleDh, setSampleType, NO_PAINT } from './world/terrainEdits.js'; // ED-TERRAIN-1a
export { Level } from './world/Level.js';
export { serialize, deserialize } from './world/serialize.js';

// ---- render passes --------------------------------------------------------
// Frame/sky pass internals stay in engine/dev.js. ambientL/HFOV_DEG
// remain stable clients of the mesh render path and editor.
export { ambientL } from './render/sky.js';
export { PROJ_HFOV_DEG as HFOV_DEG } from './render/projection.js';
export { sunFromWorld } from './render/lighting.js';
export { shadeTerrainCells } from './render/terrainShade.js';
export { sunFromHours, sunPathFrom, SUN_PATH_DEFAULT } from './core/sunPath.js';
export { swayOffset, packWindUniforms, windSwayOn, INST_FLAG_SWAY, SWAY_K, SWAY_MAX } from './mesh/sway.js'; // S8-B2-06
export { shadeTerrain, makeTerrainShadeCtx } from './render/terrainShade.js';
export { packTerrainTextures, TLOOK_WIDTH } from './render/gpu/TerrainTextures.js';
export { drawSprites, SpritePool, MAX_SPRITES } from './render/sprites.js';
// ---- US-030c GPU sprite pass + atlas + parity harness ----------------------
export { buildSpriteAtlas } from './render/gpu/spritesAtlas.js';
export { GpuSpritePass } from './render/gpu/spritesPass.js';
export { drawText } from './render/textDraw.js';
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
export { buildVoxelMesh, MESH_ONLY_MAX_QUADS } from './mesh/voxelMesh.js';
export { prebuildTerrainMesh } from './mesh/terrainMesh.js'; // ED-MESH-1a
export { loadGltf, buildMeshFromTris, KIND_MESH } from './mesh/gltf.js'; // ME-13a (architecture.md 27.2 Public API)
export { MaskAtlas, buildMaskAtlas, cutoffByte } from './render/MaskAtlas.js'; // ALPHA-01c: test worlds (gpucompare alphaLeaves) build their own atlas
// ME-13b: content/meshes/<id>.mesh.json (de)serialization + validation -
// needed by tools/gltf-import.mjs (and any future mesh-producing CLI tool)
// to write/round-trip a MeshData; MeshData's own typedef is already the
// documented public shape (27.3), these are just its (de)serialize/validate
// functions.
export { meshToJSON, meshFromJSON, validateMesh } from './mesh/MeshData.js';
export { encodeMeshBin, decodeMeshBin, meshFromBin, meshBinMeta, MESH_BIN_VERSION } from './mesh/meshBin.js'; // MESH-BIN-01
export { simplifyTriangles } from './mesh/simplify.js'; // TREES-LP-a: tools/dae-import.mjs
export { buildPrismProxy, planMeshCollision, PROXY_BAND_H, WALK_OVER_H } from './mesh/colliderProxy.js';
export { VoxelPool } from './render/voxelPool.js';
export { bindShading, bindLevel } from './render/MaterialTable.js';
// RE-06 (28.6): instanced voxel units - per-instance buffer helpers + team colour remap.
export { createViewModelLayer, VM_OBJECT_ID, VM_MAX_HANDLES, VM_FEET_BELOW_EYE } from './render/viewModel.js'; // US-078a
export { createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE, UNIT_OBJECT_BASE, MAX_INSTANCES_PER_FRAME } from './mesh/instances.js';
export { bindDetailInstances, feedDetail, removeDetailInstances, DETAIL_OBJECT_BASE } from './mesh/scatterFeed.js';
// GFX-03: quality knobs (scatter density, LOD scale, tuft draw scale) and the sun shadow levels / 'off'.
export { GFX_DEFAULTS, GFX_RANGES, resolveGfxKnobs } from './mesh/gfxKnobs.js';
export { resolveShadowLevel, SHADOW_LEVELS, resolveSunShadowOptions, SUN_SHADOW_DEFAULTS } from './render/shadowSun.js';
export { buildTeamRemap, TEAM_SLOTS, MAX_TEAMS } from './render/teamRemap.js';
// US-047: computeDerivatives/shadeSurfaces/shadeV2 (detailShade.js) and
// edgePass moved to engine/dev.js - pass internals + parity tooling only,
// no stable client calls them directly.

// ---- world compositor (US-025) ---------------------------------------------
export { renderWorld } from './render/compositor.js';
export { packLevel, repackMaterials } from './world/packed.js';

// ---- US-006 lighting (ambient + point lights + flicker) -------------------
export {
  LightSet, buildLightSet, setWorldSun, applySunHours, syncEntityLights, lightAt, lightSurfaces,
  computeVisGrid, sunVisible, falloff as lightFalloff, packLightUniforms,
  makeLightBuffer, MAX_LIGHTS, setLook, OUTDOOR_SHIFT,
} from './render/lighting.js';

// ---- ART-01a look + roof map (docs/architecture.md 37.18 items 2/3) ----------
export { resolveLook, validateLook } from './render/look.js';
export { buildRoofMap, outdoorAt, MAX_ROOF_BOXES } from './render/roofMap.js';

// ---- US-029 GPU cell pipeline (shading + edge pass on the GPU) ------------
export { GpuCellPipeline, PASS_NAMES } from './render/gpu/GpuCellPipeline.js';
export { isSoftwareRenderer } from './render/gpu/glUtil.js';
export { probeWebGpu, evaluateWebGpuLimits } from './render/gpu/device/webgpuProbe.js'; // WG-1a
export { createGpuDevice, selfTestDevice } from './render/gpu/device/createGpuDevice.js'; // WG-1b2
export { createRenderer } from './render/createRenderer.js'; // WG-1c2
export { RenderTargetWebGPU } from './render/RenderTargetWebGPU.js'; // WG-1c1
export { CellBuffer } from './render/CellBuffer.js'; // WG-1c1 (present test page)
export { WGSL_MODULES, summarizeCompilation } from './render/gpu/wgsl/index.js'; // WG-1c1
export { resolveWaterLooks } from './render/waterLook.js'; // US-055a2c Q12 item 8: main.js's fb.waterLooks (JS twin)
// US-047: runGpuCompare/compareCells/compareGeometry/compareLight/poison*
// (gpucompare parity harness) moved to engine/dev.js.
export { flickerStep } from './render/gpu/flicker.js';

// ---- physics ----------------------------------------------------------------
export { PHYSICS_DEFAULTS, PHYSICS } from './physics/config.js';
export { moveCapsule, isSectorPassable, sectorOrOutside } from './physics/capsule.js';
export { moveSphere } from './physics/sphere.js';
export { stepRollers, resolveBodyContacts, rollFrame } from './physics/roller.js';
export { integrate } from './physics/integrate.js';

// ---- entities ---------------------------------------------------------------
export { Entity } from './entities/Entity.js';
export { Camera } from './entities/Camera.js';
export { EntityHandle } from './entities/EntityHandle.js';
export { stepAnimations, animComponent } from './entities/animation.js';
export { Player } from './entities/Player.js';
export { createEyeFeel, updateEyeFeel } from './entities/EyeFeel.js';

// ---- ui -----------------------------------------------------------------------
export { DebugOverlay } from './ui/debugOverlay.js';
export { drawCrosshair } from './ui/crosshair.js';

// ---- US-015 UI panels, rich text, scene dim (docs/architecture.md 7.6) ------
export { compileRichLine, drawRichLine, hexToRgb } from './ui/richText.js';
export { buildPanelArt, createPanel, drawPanel, Panel } from './ui/panel.js';
export { createSceneDim, resetSceneDim, pushDimRect, applySceneDim } from './ui/sceneDim.js';
// ---- OWN-REQ-003 UI layer (docs/architecture.md 17) -------------------------
export { createUiLayer, clampUiCols, UI_GRID_ASPECT } from './ui/uiLayer.js';

// ---- RE-05 pathfinding: NavGrid + A* (docs/architecture.md 28.2) ------------
// Leaf module (engine/nav/**): never imports render/mesh/ui/world
// (check-deps rule 14); World is passed into buildFromWorld duck-typed.
export { NavGrid } from './nav/NavGrid.js';
export { createAStar, findPath, smoothPath, pathCrossesRect } from './nav/astar.js';

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
  createPitchedTerms, pitchedTerms, pitchedProjection, screenRay, unprojectPitched,
  worldToCell, pitchedEyeFromFocus, resolveProjection, fpVfovDeg, PITCH_CLAMP_PITCHED_DEG, PROJ_PITCHED_VFOV_DEG, pitchedFogScale, frameMatrix,
} from './render/projection.js';

// ---- RE-04 screen -> world picking (docs/architecture.md 28.1) ------------
export { rayTerrain, pickNearest, selectInRect } from './render/pick.js';

// ---- RE-08/RE-09 flow-field pathfinding + local avoidance (docs/architecture.md 28.2) --
export { createFlowField, FlowCache } from './nav/flowField.js';
export { createSteer } from './nav/steer.js';

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
export { createHasher } from './core/hash.js';
export { createRecorder, createPlayer as createReplayPlayer } from './core/replay.js';
export { STEP as SIM_STEP } from './core/loop.js'; // architect RE-EXP review: not a bare STEP next to STEP_MIN/KIND_STEP

// ---- RE-07 selection overlay (docs/architecture.md 28.9) ----
export { createOverlay, applyOverlay, OVL_MAX_OPS } from './ui/overlay.js';
export { GpuOverlayPass } from './render/gpu/overlayPass.js'; // RE-07b

// ---- US-133 fire spread sim (architecture.md 32.3) ----
export { createFireGrid } from './world/fireGrid.js';

// ---- US-053a particle sim (docs/architecture.md 32.1) ----
export { createParticles, PARTICLE_CAP, MAX_EMITTERS as PARTICLE_MAX_EMITTERS } from './fx/particles.js';
export { createEntityEmitters } from './world/entityEmitters.js';

// ---- US-055a1 water regions + query (architecture.md 32.2; the query is `World#waterAt`) ----
export { createWater, collectWaterDefs, WATER_MAX } from './world/water.js';
export { createWaterfalls, collectWaterfallDefs } from './world/waterfalls.js';

// DECAL-01: wall-text bindings over the shared overlay layer.
export { bindDecals, drawDecals } from './ui/decals.js';
export { LazyMeshStore, ensureMesh, requestMesh, meshReady } from './mesh/lazyMesh.js'; // MESH-LOAD-01
