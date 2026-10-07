# MESH-INST-01 - CPU-side batching of repeated placed kind-9 meshes (2026-10-07, lane B2)

Scope (main-session PC-B decision, PC-A may overrule): 37.15 item 3 UNSCALED mesh groups; placement scale deferred (no placement has a scale today; `s.scale !== undefined && !== 1` stays a single draw). No GLSL/WGSL change (D-044 freeze).

## What it does
`engine/mesh/meshGroups.js`: `MeshGroupSet` + `addMeshStructuresBatched`. Placed kind-9 props that share one registry mesh (LOD 0 - placements have no LOD yet) become ONE `DRAW_INSTANCED` item through the existing instanced raster path (`progMeshInst` / `rasterInstanced`), instead of one `DRAW_STATIC` item each.
- Same prop set as before: the nearest-`MAX_MESH_DRAWS` (64) selection in `addMeshStructures` still runs over ALL placements; grouped ones are only marked in `groups.chosen`. Lifting the cap for groups (the old row's idea) adds far props = a visible change, measured below, left as a follow-up.
- IDs: instance word 12 = `0xA000|structureIndex` (the single draw's object id, so picks are unchanged); planeId = `flat.x | (objectId & 0xF) << 24` (singles used a distance-order slot `<<20`).
- Not grouped (stay singles): a mesh with one placement, scaled placements, masked (alpha cutout) or > 8-range meshes, one-sided meshes (`meshIsSolid`: boundary edges above the base plane > 5 % of edges - grass cards 20-45 %, trees 2.5 %), and anything past `MAX_GROUPED_INSTANCES` (1024).
- Why `meshIsSolid`: the instanced path back-face culls, single placed-mesh draws never did. Node parity over every placed mesh of world_m1 showed grass losing 30 % of its cells when grouped; solid props lose none.
- Invalidation: rebuild when `world.structures` ref/length/`structVersion`, the material resolver or the draw cache changes, or when any member's object identity / frame x,y,z,yaw / scale differs from the build snapshot (checked per feed, no allocation).
- Shadow feed (`buildShadowList`) is untouched: singles, MESH-SHADOW-02 cap 4 / 25 m exactly as before.
- New `DRAW_FLAG_ONE_PART` (DrawList.js): the group's mesh is one identity part, so both twins draw `mesh.triCount` triangles as ONE range (the GL loop otherwise issues one instanced draw per `mesh.ranges` entry = 3 per group; without the flag GL draws did not drop at all, 55 -> 57).

## Feed shape for WG-4a (CPU side, what the WebGPU pass should consume)
Per group one `DrawItem`: `type DRAW_INSTANCED`, `mesh` = the resolved draw copy (`MeshDrawCache.get`), `flags & DRAW_FLAG_ONE_PART`, `partMatrices` identity, `instBuf` rows of 16 words (`INSTANCE_STRIDE`: `[A_r0 tx | A_r1 ty | A_r2 tz | objectId flags(0) 0 0]`, row-major yaw rotation = `frameMatrix12`), `instCount` = survivors (nearest-64 set and frustum: sphere t +- R, stable order), `aabb` = survivors +- R. GPU vertex data for a kind-9 mesh through the 32 B voxel layout is `buildMeshTriVertexData` (MeshBuffers.js: 3 verts per triangle in source order + identity index). `engine/render/gpu/wg/passRaster.js` still calls plain `addMeshStructures` (not touched, per the brief): to adopt, call `addMeshStructuresBatched` with its own `MeshGroupSet` and draw `DRAW_INSTANCED` items with the one-part flag.

## Files
Changed inside engine/mesh: `meshGroups.js` (new), `meshGroups.test.js` (new), `DrawList.js` (`addMeshStructures` `groups` arg, `DRAW_FLAG_ONE_PART`), `instances.js` (`makeInstanceGroup` extracted from `InstanceGroups.group`, behaviour identical), `rasterJS.js` (one-part flag in `rasterInstanced`).
Outside engine/mesh (minimal, listed as asked): `engine/render/gpu/MeshBuffers.js` (+ test: kind-9 triangle branch in `buildVoxelVertexData`; the instanced GL path required quads and threw on triangle meshes), `engine/render/gpu/GpuCellPipeline.js` (one `MeshGroupSet`, one feed line, one-part range in the instanced draw loop), `engine/render/compositor.js` (JS twin: one set, one feed line). Not touched: wg/*.js, main.js, capture-browser.mjs, backlog.md, GLSL/WGSL.

## Draws before / after (Node feed count, real world_m1 placements, `roadSouth` camera, 240x90, frustum culled)
| | draw items | GL draw calls | instanced props |
|---|---|---|---|
| before | 55 | 55 | 0 |
| after, without `DRAW_FLAG_ONE_PART` | 20 | 57 | 59 |
| after (final) | 20 | 20 | 59 |
(roadSouth has 329 placements, 55 inside the nearest-64 + frustum set; items 55 -> 20 = 5 grouped meshes + 15 singles/lone/grass.) Browser GL-call hook was not run (feed counts are exact: one `drawElementsInstanced` per group item after the flag).

## Parity and gates
- `engine/mesh/meshGroups.test.js` (35 checks): grouping (9 placements -> 3 items), single feed order, instance object ids, same resolved draw copy, scale exclusion (scaled one still its own single with its old id), masked / lone / over-cap / one-sided (grass) exclusion, invalidation (new / moved / yaw / replaced / scale-set / resolver change / removed), nearest-64 set identical to singles (90 placements -> 64 drawn, 2 items), JS-twin raster parity grouped vs singles (4378 covered cells: kind / objectId / mat / depth(1e-3) / normal bits all 0 diffs), shadow list still cap-4 singles and the 4 nearest by object id, 0 allocation over 1000 feeds. `MeshBuffers.test.js` +2 checks (triangle vertex words, identity index).
- Node parity over every placed mesh type (3 placements, yaw 0/70/140, scratch, not committed): 0 kind / objectId / mat differences for all solid meshes; RockPath_Round_Wide 6 of 200 cells within depth 1e-3 rel (f32 instance matrix vs f64 single matrix at silhouettes).
- `node tools/run-tests.mjs`: 276 PASS, 1 FAIL = `engine/world/terrain.test.js` (6.2 s timing flake under load from other lanes; passes alone, 35/35). `node tools/check-deps.mjs`: OK. typecheck PASS.
- gpucompare (webgl2, headless, 240x90, NVIDIA RTX 4060 / ANGLE D3D11), same machine, baseline = the scratch `git archive` of c633f41 captured before the change: 144 rows vs 144, **0 PASS->FAIL**, 0 FAIL->PASS, the same 6 known FAILs (breach / breachDown + shadow-depth rows). Per-row `kind9Cells` move by 1-4 cells in a few water poses (f32 instance rounding at silhouettes); no threshold changed.
- First attempt (cap lifted for groups, i.e. all grouped props drawn): one PASS->FAIL, `world_m1: waystoneLookBack` (kind9Cells 724 -> 1172, dLViol 0 -> 2, dLMax 1.06e-3, nrm 0.065 deg: 448 extra far-prop cells exposed 2 marginal light cells). Reverted to the nearest-64 selection; that is why the cap stays. Lifting it needs a D-039 decision / more precision work first.

## Limits / follow-ups
- GL draw calls depend on the mesh count per frame, not placements; trees (30 placements, 6 k tris) are the main winners once the cap is lifted.
- Group aabb is union of survivor translations +- R (R = max corner distance from the mesh origin), looser than a single's exact bbox, so a group can be kept when no instance is visible (no cells drawn, only the vertex cost).
- `fogFarM` still applies through the shared selection; the per-instance frustum cull is the voxel path's sphere test.
- No browser screenshot taken (output identical by the JS-twin test and gpucompare); PC-A may want one look at `?pose=roadSouth`.
