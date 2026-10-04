# ME-14c3 PC-B findings — 2026-10-04

Implementation is local and unpublished. NEEDS PC-A: architect decisions on mesh edge precision, GPU budget, and smooth normals. Programmer agent completed the GPU edits before its usage limit interrupted the turn; the PC-B main session completed content wiring and verification.

## Implemented locally

- Shared resolved-mesh cache and strict material resolver feed GPU raster and sun shadows; cloth retains its own resolver. Material rebind releases cached GPU mesh buffers and invalidates the shadow skip key. Five buffer/rebind regressions pass.
- Kind 9 uses the 0.9 normalized-normal face rule, packed normals for face 7, no AO, wall faceK, vertical/up edges, and rim 1 in GLSL, matching the JS twin.
- Imported `PillarRound` (3448 triangles) and `WallBrokenMD` (3214 triangles), with `stone` / `stone_moss` sidecars under `tools/import-maps/ruins/`, manifest entries, ground-height placements at (1468,1042) and (1472,1042), and `world_m1: ruins` camera six metres south. Both are outside the tower and at least two metres from the boar homes/route line.
- Four existing fixtures now accommodate mixed level/mesh worlds. New content test checks materials, flat per-triangle normals, colliders, and clearance. Registry meshes remain unresolved.

## Verification

213/213 Node suites PASS; check-deps OK (380 files); content validation 552 checks; canonical content 7/7. Real GPU: NVIDIA RTX 4060 via ANGLE D3D11. Browser servers use `tools/serve.py`, ports 9740–9850; only owned processes are stopped. Capture JSON/PNGs are deleted after inspection. The screenshot showed the comparison overlay, so the owner-facing shaded-piece showcase shot remains outstanding. A repeat performance browser failed to boot; the successful alternating run below is the measured evidence. Local diagnostic driver retained at `.codex/ME-14c3/ruins-view.mjs` (untracked).

The capture tool's `--variant mesh` currently selects the frozen DDA migration comparison. This run overrides the query to **`gpucompare=1&renderer=mesh`**, so both sides use mesh rendering. No DDA browser comparison was run for this item.

- Close Ruins pose: geometry kind 100%, material 5030/5030, plane 5030/5030; depth/UV/face/normal violations 0. Shading glyph 99.98%, colour outside fraction 0.035%; lighting PASS. Overall PASS.
- Same pose with `shadows=map`: shadow-depth row PASS, 33 caster items. No threshold changes.
- Full set: 69 rows, 7 FAIL. Previous commit `d64e69b`, with the same pre-existing sword edits and the same additional camera row but no Ruins placements: 69 rows, 4 FAIL. The four existing failures are voxel-half-occlusion, RTS hill 60, cloth, and pitched held-sword rest. Three new FAILs: `parapetSky`, `signal tower`, `outsideNear`. Compare by row index because the set contains duplicate pose names.

## ASK ARCHITECT: edge precision

The first two new failures are kind-9 edge glyph/gain differences, not shadeCore differences. At `parapetSky`, row 52:

| Column | JS depth | GPU depth | Plane id (both) |
|---|---|---|---|
| 22 | 21.50185585 | 21.50187302 | -535821943 |
| 23 | 21.60364342 | 21.60373688 | -535821483 |
| 24 | 21.60415840 | 21.60337257 | -535822109 |
| 25 | 21.60363770 | 21.60370636 | -535821689 |

These small raster-depth differences reverse the exact `<=` / `>=` tests for convex/concave edges across adjacent pillar facets. JS rules at columns 22/23/25 are 4/5/4; GPU chooses different rules. Running JS shadeDetailFast on GPU UV/depth/derivative/light inputs reproduces the GPU pre-edge colours, isolating the discrepancy to edges. Geometry and lighting pass for both distant poses. `outsideNear` additionally has two geometry-violation cells (one depth/UV/z/plane discrepancy and one AO difference); it needs a separate raster precision review.

NEEDS PC-A: specify how almost-coplanar imported facets should participate in edge comparisons, or how the two raster paths should align depth precision. No edge tolerance, raster snapping policy, importer grouping, or comparison threshold was changed without a note.

## ASK ARCHITECT: performance and normals

400×150, fresh GPU pass-timer histories, 220 rendered frames per phase, alternating without/with the same two placements:

| Phase | Raster p50 ms | Raster p95 ms |
|---|---|---|
| Without, A | 0.541184 | 0.558432 |
| With, A | 0.891200 | 0.907040 |
| Without, B | 0.547168 | 0.562144 |
| With, B | 0.891328 | 0.918496 |

p95 deltas: 0.348608 and 0.356352 ms, above 0.3 ms. This is PC-B's RTX, not the owner's Arc. NEEDS PC-A: permitted optimization strategy or asset scope; no LOD/instancing/triangle reduction was invented.

37.1 requires an interpolated kind-9 normal but explicitly forbids changing `mesh.vert.js`, whose static path exports `flat vNrmW`. All 6662 current Ruins triangles have identical packed normals at their three vertices, so their path is valid. Arbitrary meshes with varying vertex normals cannot meet the generic rule through that flat varying. NEEDS PC-A: permit a smooth kind-9 normal varying, or explicitly constrain this phase to flat-shaded imports.

The Node and close-pose checks pass, but the full parity and performance gates do not. Do not mark ME-14c3 arch-review/complete or start c4 against it. The independent next ready queue item is ME-06c1 forest scatter.
