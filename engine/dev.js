// engine/dev.js - the DEV/INTERNAL tier of the engine's public surface
// (docs/architecture.md section 5; US-047, "Refactor candidates" item 3).
// Re-exports only, no logic - same underlying files engine/index.js also
// re-exports from, just a different curated surface.
//
// What lives here: render-pass internals used only by parity/bench tooling
// (beginFrame/castSectors/fillSky, computeDerivatives/shadeSurfaces/shadeV2,
// edgePass), the shading and GPU/CPU parity harnesses (runShadeTest/
// runDetailShadeTest, runGpuCompare/compareCells/compareGeometry/
// compareLight/poisonNonSky/poisonAllCells), and the handful of "may change
// without notice" glue classes engine/index.js used to carry (Input,
// PlayerLook, Events, FrameProfiler).
//
// Who may import this file (tools/check-deps.mjs rules 7/8): game/js/dev/*,
// game/js/main.js, and tools/* EXCEPT tools/editor/**. game/js/quest/*,
// game/js/ui/* and tools/editor/** must not - they get only the stable
// engine/index.js surface.

// ---- sector-cast pass internals (parity/bench tooling only) --------------
export { beginFrame, castSectors, fillSky } from './render/sectorCaster.js';

// ---- shading parity harness (US-028 detail pass v2) ------------------------
export { runShadeTest, runDetailShadeTest } from './render/shadeTest.js';
export { computeDerivatives, shadeSurfaces, shadeV2 } from './render/detailShade.js';
export { edgePass } from './render/edgePass.js';

// ---- GPU/CPU parity harness (?gpucompare=1) --------------------------------
export {
  runGpuCompare, compareCells, compareGeometry, compareLight, poisonNonSky, poisonAllCells,
} from './render/gpu/gpuCompare.js';

// ---- "may change without notice" glue (docs/architecture.md section 5) ----
// PlayerLook has no reusable-engine home per architecture.md section 2's
// folder table - it is DOM/canvas/pointer-lock first-person mouse-look
// glue specific to this game's bootstrap - so it is re-exported here rather
// than duplicated in game/.
export { Input } from './core/input.js';
export { PlayerLook } from './core/playerLook.js';
export { Events } from './core/events.js';
export { FrameProfiler } from './core/FrameProfiler.js'; // US-018 spike hunt (worst-frame section breakdown)
