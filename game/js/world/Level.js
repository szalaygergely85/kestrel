// Forwarding shim (US-024 Phase A): Level.js moved to engine/world/Level.js
// as part of the engine/game split (D-006). Kept only so
// game/js/physics/*.test.js, physicsTestMain.js and worldTestMain.js (still
// un-moved until US-024 Phase C, which owns physics/entities) keep working
// unchanged. Do not add new imports of this path - import from
// 'engine/index.js' instead (loadLevel, Level).
export * from '../../../engine/world/Level.js';
