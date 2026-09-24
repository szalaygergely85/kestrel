# Test Run 2026-09-24 (late)

## Summary
- **Total test suites**: 44
- **Failing suites**: 0
- **check-deps**: PASS

All suites passing; 2,368 assertions across test suite, all passed.

## Results by Suite

| Suite | Pass | Fail | Status |
|-------|------|------|--------|
| engine/core/behaviours.test.js | 9 | 0 | PASS |
| engine/core/playerLook.test.js | 10 | 0 | PASS |
| engine/entities/animation.test.js | 21 | 0 | PASS |
| engine/entities/attach.test.js | 10 | 0 | PASS |
| engine/entities/eyeFeel.test.js | 18 | 0 | PASS |
| engine/entities/handle.test.js | 15 | 0 | PASS |
| engine/physics/jump.test.js | 111 | 0 | PASS |
| engine/physics/physics.test.js | 187 | 0 | PASS |
| engine/physics/roller.test.js | 31 | 0 | PASS |
| engine/render/compositor.test.js | 10 | 0 | PASS |
| engine/render/gpu/flicker.test.js | 9 | 0 | PASS |
| engine/render/gpu/glsl.test.js | 56 | 0 | PASS |
| engine/render/gpu/gpuCompare.test.js | 38 | 0 | PASS |
| engine/render/gpu/ShadeTextures.test.js | 1283 | 0 | PASS |
| engine/render/gpu/sprites.test.js | 95 | 0 | PASS |
| engine/render/gpu/TerrainTextures.test.js | 15 | 0 | PASS |
| engine/render/gpu/VoxelTextures.test.js | 25 | 0 | PASS |
| engine/render/gpu/WorldTextures.test.js | 16 | 0 | PASS |
| engine/render/lighting.test.js | 120 | 0 | PASS |
| engine/render/sectorCaster.cap.test.js | 100 | 0 | PASS |
| engine/render/terrainCaster.test.js | 130 | 0 | PASS |
| engine/render/terrainShade.test.js | 46 | 0 | PASS |
| engine/render/voxelPool.test.js | 12 | 0 | PASS |
| engine/ui/fade.test.js | 19 | 0 | PASS |
| engine/ui/panel.test.js | 23 | 0 | PASS |
| engine/ui/richText.test.js | 13 | 0 | PASS |
| engine/ui/sceneDim.test.js | 7 | 0 | PASS |
| engine/voxel/voxel.test.js | 64 | 0 | PASS |
| engine/world/interaction.test.js | 21 | 0 | PASS |
| engine/world/packed.test.js | 6 | 0 | PASS |
| engine/world/sectorAnim.test.js | 85 | 0 | PASS |
| engine/world/serialize.test.js | 12 | 0 | PASS |
| engine/world/terrain.test.js | 19 | 0 | PASS |
| engine/world/triggers.test.js | 17 | 0 | PASS |
| engine/world/world.test.js | 40 | 0 | PASS |
| game/js/quest/boulder.test.js | 30 | 0 | PASS |
| game/js/quest/hints.test.js | 21 | 0 | PASS |
| game/js/quest/mapCard.test.js | 13 | 0 | PASS |
| game/js/quest/restart.test.js | 16 | 0 | PASS |
| game/js/quest/tower.test.js | 90 | 0 | PASS |
| game/js/quest/wake.test.js | 17 | 0 | PASS |
| game/js/ui/endCard.test.js | 17 | 0 | PASS |
| game/js/ui/titleCard.test.js | 6 | 0 | PASS |

## Dependency Check

| Tool | Status |
|------|--------|
| check-deps.mjs | PASS (136 files) |

## Details

**Suites run with**: `node --expose-gc <suite>`
**Tools run**: All `.test.js` and `.test.mjs` files under engine/, game/, and tools/
**Date**: 2026-09-24
