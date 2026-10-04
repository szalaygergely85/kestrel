# ME-14c3 amendment follow-up — 2026-10-04

NEEDS PC-A: outsideNear remains FAIL after architecture.md 37.1 A1+A2. A2 explicitly requires stopping and reporting the cell; the implementation remains local and unpublished. ME-14c4 remains gated.

The programmer implemented the kind-9 decoded-normal crease gate in JS/GLSL (default 30 degrees), the GA sampler/uniform binding, and the kind-8/9 geometry allowance with AO excluded for both kinds. The four-cell cap and colour thresholds remain unchanged. Tests cover coplanar/45-degree/mixed-kind pairs, default/custom uniforms, and the geometry/AO split: 44 edge checks, four added comparison checks, five added uniform checks. All 217 suites PASS in the isolated prospective checkout; typecheck PASS, check-deps OK (382 files). The content test checks flat normals on all 6,662 triangles. mesh.vert.js is unchanged.

## Mesh parity

Real GPU, RTX 4060 / ANGLE D3D11, 160x60: 69 rows, six FAILs. Four are unchanged baseline failures (voxel half occlusion, rtsHill60, cloth, pitched sword rest). The two additional failures are parapetSky and outsideNear. The baseline is d3d7e3c before the local implementation; its runtime code matches the previously measured 6748810 baseline. The Ruins pose and signal tower PASS. Ruins with shadows=map also PASS.

parapetSky geometry and lighting PASS; five non-edge glyph mismatches, glyph match 99.06542%, eight colour-outside cells (1.10193%). This is still a kind-9 colour/glyph failure after the crease gate. No colour exemption was added.

outsideNear has two geometry-violation cells, violNonMesh=1. The mesh raster allowance can cover the first cell, but cannot cover the second, kind-2 cell. Lighting and colour checks PASS; geometry FAILs. Exact samples from the same pose:

| Cell (column,row) | Field | JS | GPU |
|---|---|---|---|
| (122,41), index 6682 | kind | 9 | 9 |
| | planeId | -535821894 | -535822215 |
| | depth | 5.030520439147949 | 5.149982929229736 |
| | u | -0.5873103141784668 | -0.5058096647262573 |
| | v / world z | 2.3999686241149902 | 2.420645236968994 |
| (55,50), index 8055 | kind | 2 | 2 |
| | planeId | 50331654 | 50331654 |
| | depth | 27.6390323638916 | 27.63813018798828 |
| | AO | 0.12694193422794342 | 0.12810683250427246 |

NEEDS PC-A: the next permitted fix for the kind-2 AO mismatch and residual parapetSky colour/glyph mismatch. The kind-9 plane/depth difference is reported as A2 requests. No tolerance, depth bias, plane grouping, asset geometry or draw order was changed to work around these results.

## A3 evidence

400x150, shadows off, fixed Ruins camera, 80 warm-up + 140 measured frames per phase. Instrumented GL buffer uploads, resolved-mesh cache identity changes, and draws against the two imported mesh buffers. Every measured phase has zero mesh uploads, zero cache rebuilds and zero buffer uploads across the entire pipeline. One placement gives exactly 140 mesh draws, two give 280.

| Placements | Raster p50 ms | Raster p95 ms |
|---|---|---|
| 0 | 0.472192 | 0.484960 |
| 1, A | 0.710080 | 0.724320 |
| 2, A | 0.845568 | 0.858400 |
| 1, B | 0.722272 | 0.767104 |
| 2, B | 0.843232 | 0.855776 |

One-to-two-placement p95 deltas: 0.134080 / 0.088672 ms. Zero-to-two delta for the first pair: 0.373440 ms. These are RTX observations, not the owner's Arc gate; ME-14c5 still owns that measurement. No GPU optimization, LOD or instancing was introduced.

Browser servers used tools/serve.py, ports 9790–9820, with only owned processes stopped. The capture query explicitly selected gpucompare=1&renderer=mesh; no frozen DDA comparison ran. Capture JSON/PNGs were removed. Diagnostic drivers/results remain untracked under .codex/ME-14c3. Existing sword edits remain separate and unpublished.
