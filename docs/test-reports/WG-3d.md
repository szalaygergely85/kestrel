# WG-3d: sun shadow map on WebGPU (B1, 2026-10-08)

Wiring of B2's `WgShadowPass` (passShadow.js) into the WebGPU pipeline.

## Changes
- `WgCellPipeline`: owns the `WgShadowPass` (shares `raster.buffers`), runs it after raster, before light; `portedPasses += 'shadow'` (when sun = map); `shadowOpts` = resolved options; `readbackShadowDepthBits` -> `readbackDepth`. rt.gpuActive stays false.
- `passLight` (sunMode 2, `sunShadowM/Res/TexelM/BiasM/NormalOff`, depth texture bound, dummy 1x1 otherwise), `passShade` (`sunMapOn` = shadow active && sun on), `passCell` passes the shadow pass through.
- `GpuDeviceWebGPU.createPipeline`: fragment stage also emitted with 0 colour targets when the descriptor names an entry (+ device test).
- `SHADOW_TERRAIN_PIPE_WGSL` moved to `wgsl/shadow.wgsl.js`, registered as `shadowTerrainPipe` in `WGSL_MODULES` (20 modules, 0 errors on `--mode wgsl`).
- `shadowParity.js`: `runAsync(wgPipeline)` (uses `readbackDepth`); `gpucompare.js`: shadow rows on WebGPU, JS twin gets `shadowOpts`/sun map on WebGPU, sun-map poses no longer a "WG-3d wait"; towerShadowGrass handled as a WG-3e water wait (main session hunk: the 135 kind-7 cells are the pond darkened by the JS water composite, not a shadow bug).
- `game/js/main.js`: `createRenderer` now receives the same `shadows` options as the engine (before, `?shadows=dda` never reached the WebGPU pipeline).
- Depth bias: GL `polygonOffset(2, 4)` vs WebGPU `depthBias {factor 2, units 4}` needed no change: shadowDepth rows match GL (withinPct 99.9993-99.9995 %, maxUlp 127316-127319 vs 127316-127317 only in far outlier bucket; same hist). Thresholds untouched.

## Gate (same machine, headless, RTX 4060)
- run-tests 283 PASS; typecheck clean; check-deps OK; wgsl 20 modules 0 errors.
- gpucompare default (sun map): WebGL2 140 PASS / 6 FAIL; WebGPU 140 PASS / 6 FAIL, identical fail set (crash room, lamp empty, voxel half occluded, viewModel rest pitch 20 PITCHED, handsSwapped, forestWalk). All 73 `[shadow depth parity]` rows PASS on both; burnerShadowFloor, fpBoxEdge, leverSunShaft, rtsHill58Shadow, towerShadowGrass PASS.
- `--shadows dda`: GL 7 FAIL; WebGPU the same 7 + towerShadowGrass (as in WG-3c; before the water-wait hunk) - no new FAIL, no PASS->FAIL. dda run not repeated after the water-wait hunk (only affects that row).
- The first WebGL2 run timed out twice under lane B2 load; retried with `--timeout-ms 420000`.
