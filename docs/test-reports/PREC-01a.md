# PREC-01a - camera-relative render origin, WebGPU raster path (2026-10-08, lane B1)

37.9 steps applied to WGSL (GLSL/GpuCellPipeline frozen, D-044). Origin O = floor(cam.xy/16)*16, z not rebased.
Files: engine/render/projection.js (viewProjAtOrigin), gpu/wg/passRaster.js, gpu/wgsl/raster.wgsl.js (instanced `origin`), gpu/wgsl/terrainRaster.wgsl.js (`modelRel`),
tests gpu/renderOrigin.test.js (new), wg/passRaster.test.js, wgsl/raster.wgsl.test.js, wgsl/terrainRaster.wgsl.test.js.

## Node probe (renderOrigin.test.js, f32-emulated vertex stage, 20k points 2-17 m ahead)
| pose | abs w err | abs screen | rel w err | rel screen | instanced rel w |
|---|---|---|---|---|---|
| parapetSky | 2.85e-4 m | 1.98e-2 cell | 2.16e-6 m | 1.47e-4 | 2.05e-6 m |
| forestWalk (approx pose) | 2.34e-4 | 1.34e-2 | 2.37e-6 | 4.83e-5 | 2.37e-6 |
| shear 87.6 deg | 2.44e-4 | 1.38e-2 | 7.53e-6 | 2.05e-4 | 7.01e-6 |

## gpucompare (headless, real GPU, 240x90 grid)
Suites: run-tests 311 suites all PASS 0 WARN (colliders.test.js and once passRaster heap check were flaky; the heap check is now 100k frames / 4 MB), check-deps OK.

| backend | baseline (0163503) | after |
|---|---|---|
| webgpu map shadows | 144 PASS / 6 FAIL | 148 / 2 |
| webgl2 | 140 / 10 | 140 / 10, every row's metrics byte-identical |
| webgpu `--shadows dda` | 66 / 7 (task note) | 72 / 3 (fails: crash room, voxel half, forestWalk) |

Per target row (webgpu): before -> after
- forestWalk: FAIL -> PASS (cellsOutside 21 -> 3, fgMax 63 -> 9, uvViol 6 -> 1)
- lamp empty: FAIL -> PASS (dLViol 3 -> 0, dLMax 0.304 -> 8.1e-5, fgMax 96 -> 1) - the light dLMax was precision too, PREC-03b not needed
- viewModel rest pitch 20: FAIL -> PASS; viewModel handsSwapped: FAIL -> PASS (dLViol 3 -> 0, fgMax 188 -> 42)
- voxel half occluded: FAIL -> FAIL (geom PASS, light PASS; cells: 55 kind-2 glyph mismatches, outsideByKind kind1 41 / kind2 110 / kind8 9; cellsOutside 161 -> 160, fgMax 98) - shading difference, not vertex precision
- crash room: FAIL -> FAIL (cmpGeom + cmpLight fail: dLViol 3 at sample idx 8399, dLMax 0.0101 unchanged; cellsOutside 6 -> 0, fgMax 32 -> 1)
- parapetSky: PASS -> PASS. No PASS -> FAIL in the shipped config.

## Open: terrain clip rebase (37.9 step 6 / PREC-01b) - ASK ARCHITECT
With the terrain clip rebased (viewRel + modelRel = chunk - O) the PASS row `signal tower` regresses to FAIL (webgpu 147/3): one kind-7 far-terrain cell (100,37),
JS xy (772.161,1073.395) depth 702.524 vs GPU xy (772.000,1073.404) depth 702.682 (terrainUvMaxErr 0.0046 -> 0.161), normal 0.94 deg -> nrmViol 1 (violNonK8 1).
Grazing hit at 700 m, so a 0.16 m depth shift = a sub-pixel ownership flip, no other metric moved. With terrain left absolute: 148/2, no regression, so
`TERRAIN_REBASE = false` in passRaster.js (shader `modelRel` plumbing kept; flip the const to test). No row needs the terrain rebase.
Question: accept as D-039 tie and enable it, or keep terrain absolute (current)?
