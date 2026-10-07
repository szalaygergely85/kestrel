# WG-2b - mesh raster (arch-review)

2026-10-07, PC-B lane B1. Supersedes the partial checkpoint.

**Done.** `wg/passRaster.js` draws static/kind-9, compact voxel, instanced, mirrored view-model (second pipeline, `frontFace:'ccw'` + back cull) and cloth into the 36 B raster G-buffer (`texSGI/texSGA/texSDepth`). Shipped geometry only (GL parity): no ALPHA-01c mask discard and no PREC-01..03 relative-origin upload (neither exists in `mesh.frag.js` / `GpuCellPipeline._prepRaster`); they land with their own steps.

**Decisions taken by the PC-B main session (PC-A may overrule in review)**
1. Cloth: `PipelineStageDesc.extraLayouts` + `BindDesc.extraBuffers` (WebGPU; GL2 keeps its VAO, mock ignores). Extra streams bind at slot `extraBase + i` after the mesh (0) and instance (1) buffers. Cloth = dynamic pos+oct normal (slot 0) + static uv (extra stream, location 1), no per-frame repack, cull none. The "visible cloth disables raster" throw is gone.
2. Shipped geometry ported, see above.
3. `createEngine({ renderPipeline })`: `setGrid` passes on `webgpu` when that pipeline is `ready`; `applyGrid` calls `rt.setGrid` then `renderPipeline.resizeGrid`. Everything else in 38.8a item 15 stays gl2-only. `main.js` passes `wgPipeline`, binds voxels/view model/instances, calls `wgPipeline.frame` per frame (raster only; CPU still shades, `rt.gpuActive` false) and forwards `?terrain=0`.
4. 22a: not applied (no raster timer span added). 22b: `createRenderer` already awaits one `device.checkErrors()` after the pipeline (incl. raster pipelines) is built; any error disposes it and the existing webgpu fallback runs.

**Tests.** `node tools/run-tests.mjs`: 267/267 PASS (new `engine/core/setGridWebgpu.test.js` 5 checks; `GpuDeviceWebGPU.test.js` 59 incl. 4 extra-stream checks; `passRaster.test.js` incl. cloth draw: pipeline, uv extra stream, material in flat.y, count/first). `check-deps` OK (466 files, 1309 existing warnings). `capture-browser --mode wgsl --backend webgpu`: 6 modules, 0 errors, 0 warnings.

**gpucompare (RTX 4060, Chrome headless, rays 1, 160x60, same machine).** `gpucompare.js` is now async; with only a `WgCellPipeline` it runs geometry rows only (cells/light/shadow/overlay need WG-3) and records `geomOk` on every row of both backends (cmpGeom.pass or the geometry half of the mesh gate).
- `?gpucompare=1&terrain=0` on both backends: WebGL2 geomOk 68/71, WebGPU 68/71. The three failing rows are the same on both with identical counts: `viewModel rest pitch 20 PITCHED CAMERA` (gvc 2), `viewModel handsSwapped` (gvc 6, dv 1, uv 5; mirrored pipeline, same known edge-on tie), `forestWalk` (gvc 6). No PASS->FAIL, no threshold touched. Cloth, instanced, voxel and view-model rows PASS.
- Default (terrain on) WebGPU: 33/71; every additional FAIL has kind loss/holes from terrain (and water/waterfall, which sit on terrain): WG-2c / WG-3e. Not a regression.
- Logs/captures are git-ignored. Run: `node tools/capture-browser.mjs --mode gpucompare [--backend webgpu] --query "gpucompare=1&terrain=0[&backend=webgpu]" --port 95xx`.

**Open.** Terrain raster (WG-2c); full cell/light rows (WG-3); owner 400x150 debug screenshot not taken; `?gpudebug=` view not re-checked on the new frame wiring beyond the `--mode wgsl` compile gate.
