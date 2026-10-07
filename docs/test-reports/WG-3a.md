# WG-3a - resolve + deriv pipeline integration (arch-review)

2026-10-07, PC-B lane B1.

**Done.** New `engine/render/gpu/wg/passCell.js` (`WgCellPass`): resolve (sub-sample set -> `texGI/texGA/texDepth`) then deriv (-> `texGD`) as fullscreen passes, run in `WgCellPipeline._hook` after raster (also after the no-camera clear). Pipelines + bind descriptors built once in the constructor (the single `checkErrors` in `createRenderer` covers them, 22b); per frame only uniform words change (`n`; `cols/rows/tanHalfHFov/planeDistY` via `derivTerms`, the `_computeCamBasis` twin). `targets.js` now also allocates cell-res `texGI/texGA/texGD` (rgba32ui), `texDepth` (r32ui), `texMask` (r8ui, all zero = no UI-overlay bit, resolve's `uMask`) and `targetResolve/targetDeriv`. `readbackGeometry()` reads the resolved set at any rays (throw removed), cols*rows 4-wide, Depth spread from the 1-wide r32ui. `portedPasses` += resolve, deriv; `rt.gpuActive` stays false. No timer spans added (22a untouched). WGSL modules not modified.

**Harness (minimal, documented).** `?gpucompare=1` forces rays 1 for every row (main.js l.154). The existing `?gpucompare=1&rays=2` INFO block (resolved geometry at n=2 vs the JS twin; GL only, and broken: `GpuCellPipeline` was not imported there) now runs for WebGPU too and for GL (`game/js/dev/modes/gpucompare.js`): second pipeline of the same class, same terrain/shadow options and voxel/view-model/instance binds, awaited readback, no cells compare on WebGPU. Rows land in the capture JSON as `raw.infoRows`. Deriv is not compared by gpucompare (no readback in either backend); it is covered by B2's 1521-cell probe vs `computeDerivatives`.

**Tests.** `WgCellPipeline.test.js` updated (cell-res targets, pass order raster/resolve/deriv, bind textures + uniform words, rays-2 readback). `node tools/run-tests.mjs`: 274/274 PASS (incl. check-deps). `capture-browser --mode wgsl --backend webgpu`: 15 modules, 0 errors.

**gpucompare (RTX 4060, headless Chrome, 160x60, same machine; `--query "gpucompare=1[&backend=webgpu][&rays=2]"`, ports 951x).**
- Rays 1: WebGL2 geomOk 69/72, WebGPU 69/72, same failing rows (viewModel rest pitch 20, handsSwapped, forestWalk: known D-039 ties). 0 PASS->FAIL, no threshold touched.
- Rays 2 (resolved geometry, 34 INFO rows): WebGPU vs WebGL2 identical in kindMatchPct, holes, planeEqual, matEqual, depthViol, uvViol, matched on all 34 rows (diff 0); kindOk 34/34 on both.

**Open.** deriv output (`texGD`) has no GPU-vs-GL readback comparison; the UI-overlay mask is always 0 until the overlay pass is ported; light/shade/edge/shadow/water (WG-3b..e); timer spans (22a). Captures are git-ignored (the capture filename is per sha/grid, so consecutive runs overwrite each other: copy between runs).
