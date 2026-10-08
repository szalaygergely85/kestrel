# WG-4b: GPU shadow-caster cull for the WebGPU sun shadow pass (B1, 2026-10-08)

Kernel: the WG-4a camera kernel does not fit (the CPU shadow test is `fillShadowBands`: horizontal eye distance with persistent +-2 m hysteresis bands, then the sun-box planes), so `wgsl/cullShadow.wgsl.js` is new (CULL_SHADOW_BLOCK, bandUpdate + shared `CULL_AABB_FN` now exported from cull.wgsl.js, cs_main, registered in wgsl/index.js). `WgCullPass` got `{shadow: true}` (own pipeline/uniform block; `begin({planes, eye, castM, hystM})`, `add(group, meshes, lod0M, R)`; args from `ranges[0]`).

Wiring: `buildShadowList` takes optional `src.gpu.accept(g, mesh0, mesh1, R, lod0M)` (only with `src.eye`, same bands/radii as the CPU code; unsupported groups keep the CPU path). `WgShadowPass` (opts.gpuCull, default on, `?gpucull=0` off): accepted groups skip `fillShadowBands`, the kernel runs (one dispatch each) only when the map is re-rendered, `instancePipe` + `drawIndirect` per band. The meshShadowBudget (25 m / cap) stays off and is not in the kernel (it never applied to instanced groups). Dirty-skip: GPU groups are not in the CPU list hash, so `key[2]` hashes their count + quantized rows + the eye 1 m cell.

Supported: meshGroup (any range count: the CPU caster loop only draws `ranges[0]` with the identity part, the kernel mirrors that) and single-range voxel units. Multi-range voxel units, cloth, structures stay CPU.

Parity oracle: the twin in `shadowParity.js` rasters `sh.list`, which no longer holds the GPU groups; it now uses `WgShadowPass.casterList()` (TEST-ONLY, rebuilds the full CPU list with the hook off). Without that the first gate run showed lowpolyTrees/forestWalk shadowDepth FAIL (twin missing the trees).

Tests: cullShadow.wgsl.test (string rules, band/plane probe vs fillShadowBands over 12 moving eyes incl. band state), passShadowCull.test (drawn set per band == CPU buildShadowList over 10 poses, dispatch + drawIndirect counts, args, CPU fallback group, gpucull off, dirty skip, 0 B/frame, dispose). `node tools/run-tests.mjs`: 299 PASS (typecheck no WARN), check-deps OK.

Gate (`--backend webgpu`, real GPU): gpucompare map 140 PASS / 6 FAIL with gpucull on, rows byte-identical to `gpucull=0`; dda 66 PASS / 7 FAIL. All shadowDepth rows PASS as in the baseline.

Open: (1) The CPU/GL caster loops ignore DRAW_FLAG_ONE_PART, so a multi-range meshGroup (trees) casts only its range 0 in both GL and WebGPU shadows (the raster pass draws all ranges); pre-existing, mirrored here on purpose, worth a fix on both sides (PC-A, GL oracle). (2) Kernel band state advances only on re-rendered frames (CPU advances every frame); differences only within +-2 m of the 25/48 m cuts. (3) The shadow cull holds its own copy of the rows (second upload per group) next to the camera cull. (4) f32 vs f64 distance: boundary instances can flip band; none seen. (5) No webgpu bench timing recorded.
