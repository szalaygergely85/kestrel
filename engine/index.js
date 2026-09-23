// engine/index.js - the ONLY public entry point (docs/architecture.md
// section 2/5). Re-exports only, no logic. `game/` and `tools/` must import
// exactly this file, never a deep `engine/**` path (check-deps rule 3).
//
// US-024 Phase A/B status: the render/world/core surface below is real
// (moved unchanged, or newly written per architecture.md section 6/8).
// World/Terrain/serialize/Entity/Camera.fromEntity/EntityHandle/
// stepAnimations are stubs (US-025/US-011, see each module's header) - the
// SHAPE is normative now, the behaviour lands with those stories.
// Physics (`PHYSICS_DEFAULTS`, `moveCapsule`, `isSectorPassable`,
// `createEyeFeel`/`updateEyeFeel`) and `Player`/`integrate`'s real body are
// NOT exported yet: they still live in `game/js/physics/` and
// `game/js/entities/` and move here in US-024 Phase C.

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
export { beginFrame, castSectors, fillSky } from './render/sectorCaster.js';
export { castTerrain } from './render/terrainCaster.js';
export { drawSprites } from './render/sprites.js';
export { drawText } from './render/textDraw.js';
export { runShadeTest } from './render/shadeTest.js';

// renderWorld (US-025 compositor): stub until World is real.
export function renderWorld(fb, world, cam) {
  throw new Error('renderWorld: not implemented (US-025)');
}

// ---- physics (stubs; capsule/config move here in US-024 Phase C) ----------
export { moveSphere } from './physics/sphere.js';
export { integrate } from './physics/integrate.js';

// ---- entities ---------------------------------------------------------------
export { Entity } from './entities/Entity.js';
export { Camera } from './entities/Camera.js';
export { EntityHandle } from './entities/EntityHandle.js';
export { stepAnimations } from './entities/animation.js';

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
