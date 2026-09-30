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
export { loadContentPack, globalId } from './content/loadPack.js';

// ---- world ----------------------------------------------------------------
export { World, stepSectorAnims } from './world/World.js';
export { Terrain } from './world/Terrain.js';
export { Level } from './world/Level.js';
export { serialize, deserialize } from './world/serialize.js';

// ---- render passes --------------------------------------------------------
// US-047 (architecture.md section 5): beginFrame/castSectors/fillSky are
// sector-cast pass internals used only by parity/bench tooling - moved to
// engine/dev.js. ambientL/HFOV_DEG stay here (stable clients: main.js render
// path, tools/editor/*).
export { ambientL, HFOV_DEG } from './render/sectorCaster.js';
export { castTerrain, shadeTerrainCells, marchTerrainRay, sunFromWorld, FOG_FULL, T_START, MAX_TERRAIN_STEPS, STEP_MIN, STEP_K } from './render/terrainCaster.js';
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
export { validateVoxelModel, assertVoxelModel, MAX_VOX_PARTS, MAX_VOX_INSTANCES } from './voxel/VoxelModel.js';
export { packVoxelModel } from './voxel/voxelPack.js';
export { castModels } from './voxel/voxelMarch.js';
export { VoxelPool } from './render/voxelPool.js';
export { bindShading, bindLevel } from './render/MaterialTable.js';
// RE-06 (28.6): instanced voxel units - per-instance buffer helpers + team colour remap.
export { createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE, UNIT_OBJECT_BASE, MAX_INSTANCES_PER_FRAME } from './mesh/instances.js';
export { buildTeamRemap, TEAM_SLOTS, MAX_TEAMS } from './render/teamRemap.js';
// US-047: computeDerivatives/shadeSurfaces/shadeV2 (detailShade.js) and
// edgePass moved to engine/dev.js - pass internals + parity tooling only,
// no stable client calls them directly.

// ---- world compositor (US-025) ---------------------------------------------
export { renderWorld } from './render/compositor.js';
export { packLevel, repackMaterials } from './world/packed.js';

// ---- US-006 lighting (ambient + point lights + flicker) -------------------
export {
  LightSet, buildLightSet, syncEntityLights, lightAt, lightSurfaces,
  computeVisGrid, sunVisible, falloff as lightFalloff, packLightUniforms,
  makeLightBuffer, MAX_LIGHTS,
} from './render/lighting.js';

// ---- US-029 GPU cell pipeline (shading + edge pass on the GPU) ------------
export { GpuCellPipeline, PASS_NAMES } from './render/gpu/GpuCellPipeline.js';
export { isSoftwareRenderer } from './render/gpu/glUtil.js';
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
  worldToCell, pitchedEyeFromFocus, resolveProjection, PROJ_PITCHED_VFOV_DEG, pitchedFogScale, frameMatrix,
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
