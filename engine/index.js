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
export { createEngine } from './core/engine.js';

// ---- content ------------------------------------------------------------
export { AssetRegistry } from './core/assets.js';
export { loadLevel } from './world/Level.js';

// ---- world ----------------------------------------------------------------
export { World } from './world/World.js';
export { Terrain } from './world/Terrain.js';
export { Level } from './world/Level.js';
export { serialize, deserialize } from './world/serialize.js';

// ---- render passes --------------------------------------------------------
export { beginFrame, castSectors, fillSky, ambientL } from './render/sectorCaster.js';
export { castTerrain } from './render/terrainCaster.js';
export { drawSprites } from './render/sprites.js';
export { drawText } from './render/textDraw.js';
export { runShadeTest, runDetailShadeTest } from './render/shadeTest.js';

// ---- US-028 detail pass v2 (G-buffer shading, edge pass) -------------------
export { GBuffer } from './render/GBuffer.js';
export { bindShading, bindLevel } from './render/MaterialTable.js';
export { computeDerivatives, shadeSurfaces, shadeV2 } from './render/detailShade.js';
export { edgePass } from './render/edgePass.js';

// renderWorld (US-025 compositor): stub until World is real.
export function renderWorld(fb, world, cam) {
  throw new Error('renderWorld: not implemented (US-025)');
}

// ---- physics ----------------------------------------------------------------
export { PHYSICS_DEFAULTS, PHYSICS } from './physics/config.js';
export { moveCapsule, isSectorPassable, sectorOrOutside } from './physics/capsule.js';
export { moveSphere } from './physics/sphere.js';
export { integrate } from './physics/integrate.js';

// ---- entities ---------------------------------------------------------------
export { Entity } from './entities/Entity.js';
export { Camera } from './entities/Camera.js';
export { EntityHandle } from './entities/EntityHandle.js';
export { stepAnimations } from './entities/animation.js';
export { Player } from './entities/Player.js';
export { createEyeFeel, updateEyeFeel } from './entities/EyeFeel.js';

// ---- ui -----------------------------------------------------------------------
export { DebugOverlay } from './ui/debugOverlay.js';

// ---- behaviours ---------------------------------------------------------------
export { registerBehaviour, registerInteraction, registerTrigger, getBehaviour } from './core/behaviours.js';

// ---- not (yet) in the normative API, but exported for main.js's use ---------
// (check-deps rule 3 forces every game/tools import through this one file;
// PlayerLook has no reusable-engine home per architecture.md section 2's
// folder table - it is DOM/canvas/pointer-lock first-person mouse-look
// glue specific to this game's bootstrap - so it is re-exported here rather
// than duplicated in game/. May change without notice, per the header note
// on architecture.md section 5.)
export { Input } from './core/input.js';
export { PlayerLook } from './core/playerLook.js';
export { Events } from './core/events.js';
