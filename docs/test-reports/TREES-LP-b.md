# TREES-LP-b - Instanced kind-9 mesh groups (2026-10-07, lane B2)

Spec: architecture.md 37.15 items 3, 4, 5. D-044: no GLSL/WGSL change. Reuses MESH-INST-01 (`DRAW_FLAG_ONE_PART`, `makeInstanceGroup`, kind-9 triangle branch in `MeshBuffers`).

## What it does
- `InstanceGroups.meshGroup(mesh, capacity)` (engine/mesh/instances.js): an `InstanceGroup` with `g.mesh` (registry MeshData, unresolved), one identity part, LOD off, same instance words as voxel groups (`writeUnitInstance`). Throws on non-static / masked meshes. Counts toward the 32-group cap.
- `addToDrawList(list, cache, planes, frameNo, viewProj, rows, meshDraw)`: `meshDraw = {cache: MeshDrawCache, idFor}`; a mesh group resolves `meshDraw.cache.get(g.mesh, idFor)`, compacts with the same `compactGroup` (memoised on frameNo) and pushes one `DRAW_INSTANCED` item with `DRAW_FLAG_ONE_PART`. `meshDraw` null/omitted/`idFor` null -> mesh groups skipped. Voxel path untouched. (`this.pool` is no longer required for mesh groups.)
- `buildShadowList`: mesh-group branch using `src.meshCache`/`src.meshIdFor`; with `src.eye` the group is cut at `instCastM` (48 m; `fillShadowBands` with lod0M == castM so band 1 stays empty) and plane-culled, without eye the full buffer; `castShadow === false` or no meshCache -> not in the list.
- Callers: `compositor.js` (module-level `meshDrawArg`, idFor refreshed per frame) and `GpuCellPipeline.js` (`_meshDrawArg`) pass it. `wg/passRaster.js` not touched (mesh groups skipped on WebGPU until WG-4a adopts them).
- Item 5 content hook: `scatter.js` validator `species[i]: exactly one of model/mesh`; `World.load` resolves `world.scatterMeshes[i] = assets.mesh(id)` once (unknown id throws `World.load: forest.trees.species[i] references unknown mesh "id"`); `bindScatterInstances` makes a `meshGroup` per mesh species (same words, `SCATTER_OBJECT_BASE | i`, `castShadow = species.shadow !== false`, no `lodCells`). Live world content unchanged (no species switched).
- Item 4 (A1 crease gate, same-placement scope): NOT implemented. `grep` shows neither `edgePass.js` nor `edge.frag.js` has any kind-9 crease rule (A1 was never built, see architecture.md 37.1 A1 / ME-14c3 notes), so it is a new rule in both twins = GLSL. `NEEDS PC-A: item 4 needs GLSL (frozen)`.

## Tests
- `engine/mesh/meshInstances.test.js` (17 checks, Kenney `tree_oak` stub, 6 instances): static 6 items -> 1 instanced item; raster JS twin group == 6 static placements: 8241 covered cells, kind / objectId / mat / depth 0 diffs, normal bits 2 (< 0.2 %); cull + stable compaction (4 -> 2), memo on frameNo; meshDraw null -> skipped; masked / missing mesh throw; shadow list (banded, no eye, beyond instCastM, no meshCache, castShadow false); 0 allocation over 1000 frames (camera + shadow feeds).
- `engine/core/scatterMesh.test.js` (12): validator XOR (neither / both / empty / non-string), mixed voxel + mesh world: 2 groups, words == placements, `shadow:false` -> castShadow false, reload without realTrees leaves 0 groups, unknown mesh id throws naming the species.
- `node tools/run-tests.mjs`: 278 PASS, 1 FAIL `engine/world/colliders.test.js` (2 s timing flake while lane B1 ran gpucompare; 32 passed alone). `check-deps` OK. `validate-content` OK.
- gpucompare webgl2 headless 240x90, ANGLE D3D11 RTX 4060, same-machine baseline = `git archive` of be10424 run first: 144 rows -> 146 rows, **0 PASS/FAIL changes**, same 6 known FAILs. New pose `world_m1: lowpolyTrees (6 instanced kind-9 trees, eye 8 m)` (mesh renderer only) PASS + its shadow-depth parity row PASS (kind9Cells 5231, nonSky 8197, kindMismatch 0, depthViol 0, nrmViol 0, geomViolCells 1).

## Harness edits (minimal, listed)
`game/js/dev/modes/gpucompare.js`: imports `meshFromJSON, writeUnitInstance`; fetches `content/meshes/kenney/tree_oak.mesh.json` into `ctx.lowpolyTreeMesh` before `buildCompareRuns` (missing = pose skipped); one pose block (`compareInstances.meshGroup`, 6 trees at x 1458-1462, y 1017-1033, camera (1470,1025) yaw 270). main.js not touched.

## Limits
- Mesh groups are for closed/solid meshes (the instanced path back-face culls, like MESH-INST-01's `meshIsSolid` rule); not enforced by `meshGroup`.
- Mesh shadow cast distance = `instCastM` (48 m), one band; budget bars (item 8) are TREES-LP-e.
- Timing of the new pose not benchmarked.
