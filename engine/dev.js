// @ts-check
// engine/dev.js - the DEV/INTERNAL tier of the engine's public surface
// (docs/architecture.md section 5; US-047, "Refactor candidates" item 3).
// Re-exports only, no logic - same underlying files engine/index.js also
// re-exports from, just a different curated surface.
//
// What lives here: render-pass internals used only by parity/bench tooling
// (beginFrame/fillSky, computeDerivatives/shadeSurfaces/shadeV2,
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

// ---- mesh frame/sky pass internals (parity/bench tooling only) ------------
export { beginFrame } from './render/compositor.js';
export { fillSky } from './render/sky.js';

// ---- shading parity harness (US-028 detail pass v2) ------------------------
export { runShadeTest, runDetailShadeTest } from './render/shadeTest.js';
export { computeDerivatives, shadeSurfaces, shadeV2 } from './render/detailShade.js';
export { edgePass } from './render/edgePass.js';

// ---- GPU/CPU parity harness (?gpucompare=1) --------------------------------
export {
  runGpuCompare, compareCells, compareGeometry, compareLight, describeCellNormals, poisonNonSky, poisonAllCells, unpackReadback,
  classifyMigrationCells, MIGRATION_CATS, compareShadowDepth,
} from './render/gpu/gpuCompare.js';
// ME-15b (27.9a item 10): GPU sun shadow depth vs the rasterJS depth-only twin.
export { createShadowParityRunner } from './render/gpu/shadowParity.js';
export { runStableRow, compareStableRow } from './render/gpu/wg/stableCompare.js'; // US-073c: gpucompare `stable` row
// ME-06 (27.15.5a item 6): compare harnesses settle the shared terrain mesh set before each pose.
export { terrainMeshSetFor } from './mesh/terrainMesh.js';

// ---- GPU/CPU sprite parity harness (?spritecompare=1, US-030c) -------------
// Item 6b fix pass: moved from engine/index.js - its only real caller is
// game/js/dev/spriteDev.js's `?spritecompare=1` dev mode.
export { runSpriteCompare } from './render/gpu/spritesCompare.js';

// ---- cell grid buffer (dev/perf tooling only) ------------------------------
// Item 6b fix pass: added so tools/perf/uiDraw.perf.test.mjs can build a raw
// scene RenderTarget without importing engine/render/CellBuffer.js directly
// (tools/* may only import engine/index.js + engine/dev.js, check-deps rule 3/7).
export { CellBuffer } from './render/CellBuffer.js';

// ---- "may change without notice" glue (docs/architecture.md section 5) ----
// PlayerLook has no reusable-engine home per architecture.md section 2's
// folder table - it is DOM/canvas/pointer-lock first-person mouse-look
// glue specific to this game's bootstrap - so it is re-exported here rather
// than duplicated in game/.
export { Input, blockContextMenu } from './core/input.js';
export { PlayerLook } from './core/playerLook.js';
export { Events } from './core/events.js';
export { FrameProfiler } from './core/FrameProfiler.js'; // US-018 spike hunt (worst-frame section breakdown)

// ---- pitched camera helpers (RE-02a: gpucompare's focus-driven RTS poses) ----
export { pitchedEyeFromFocus, PROJ_PITCHED_VFOV_DEG } from './render/projection.js';

// ---- mesh-collision bench internals (MESH-PHYS-01, tools/bench-mesh-collide.mjs) ----
export { buildWorldColliders } from './world/colliders.js';
export { moveCircleMesh, probeSupport } from './physics/meshCollide.js';
export { buildBvhFromMesh } from './physics/bvh.js';
export { frameMatrix12 } from './mesh/DrawList.js';
