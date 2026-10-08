# WG-4a: GPU instance cull wired into the WebGPU raster pass (B1, 2026-10-08)

Wiring: `WgRasterPass` owns a `WgCullPass`. `InstanceGroups.addToDrawList` gets `meshDraw.gpu.accept(g, mesh0, mesh1)`; an accepted group is not compacted on the CPU and gets no DrawList item. Before the raster pass `_cullRun` does `cull.begin/add/run` (planes, view, rows as the CPU path), inside the pass `_cullDraw` binds `instancePipe` with the kernel's storage buffer (VERTEX usage, 64 B rows = INSTANCE_LAYOUT) and calls `drawIndirect`. Supported: meshGroup and single-range voxel units (`WgCullPass.supports`); everything else keeps the CPU path. Switch: `?gpucull=0` (main.js -> createRenderer -> WgCellPipeline -> WgRasterPass `gpuCull`).

Tests: passRaster.test (dispatch + drawIndirect per supported batch, CPU fallback for multi-range, gpuCull:false unchanged, no buffer creation, heap growth < 4 MB over 20000 frames), meshInstances.test (hook accept/refuse); `node tools/run-tests.mjs` 296 PASS, check-deps OK.

Gate (real GPU, `--backend webgpu`): gpucompare map shadows 140 PASS / 6 FAIL, dda 66/7; with `gpucull=0` identical output (diff empty, same per-row metrics). GPU path was exercised (stats gpuCull draws: lowpolyTrees 1, forestWalk 12, detailWalkout 36; `gpuCull` is now in the `stats=` JSON of the geometry row). No depth-tie differences seen.

Open: MeshGroupSet groups (placed props, `chosen` nearest-64 on the CPU) stay on the CPU, so `setStatic` is unused; removed groups keep their cull batch (buffers + args slot, max 64) until pass dispose; `stats.instances/instancesCulled` do not count GPU-culled groups; no webgpu bench mode run (draws/ms not recorded); maxDistM/eye are not passed (CPU path has no distance cull).
