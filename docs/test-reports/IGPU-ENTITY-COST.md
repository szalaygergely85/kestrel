# IGPU-ENTITY-COST-01 - per-frame cost of 4 animated voxel boars + 128 hit sparks (mock device, Node)

Test: `engine/render/gpu/wg/WgCellPipeline.entityCost.test.js` (300 frames, 160x60 grid, sun on, real boarPlaceholder walk/charge clips, hitSparks presets, ParticleLayer built each frame; kestrel-1 buildCombatScene not in this tree, local fixture).
Budget: upload <= 64 KB/frame, no buffer creation after frame 10, sprite pool constant after frame 10.

| metric | value |
|---|---|
| upload bytes/frame, steady avg / max | 51063 / 57600 |
| upload bytes, first 11 frames (sum) | 577234 |
| writes (buffer+texture), avg per frame | 2.0 |
| draw calls/frame (last frame) | 70 (instanced 0) |
| voxel instances (boars) | 4 |
| live sparks (last frame) | 127 |
| sprites in pool (pool.count) | 0 (capacity 64; boars are voxel, not sprites) |
| particle layer cells touched | 104 |
| createBuffer calls after frame 10 | 0 |
| device createCount frame 11 -> 300 | 102 -> 102 |
| pipeline stats voxelInstances / voxelDraws / instances | 0 / 32 / 0 |

Bytes/frame by destination (avg over all 300 frames):

| destination | bytes/frame |
|---|---|
| tex:rgba8 160x60 | 25367 |
| tex:r32f 160x60 | 25367 |
| tex:rgba32i 64x50 | 171 |
| tex:rgba32f 32x95 | 162 |
| tex:r32f 32x50 | 21 |
| tex:rgba32i 4x95 | 20 |
| tex:r32f 256x1 | 3 |
| tex:rgba32f 32x1 | 2 |
| tex:rgba8ui 4x2 | 0 |
| tex:rgba32f 2x1 | 0 |
| tex:rgba32f 1x1 | 0 |
| tex:rg8ui 1x1 | 0 |
