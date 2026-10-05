# ME-15e - sun shadow map default (PC-A programmer, 2026-10-05, base 11b521b)

Machine: Intel Arc iGPU (0x7D45, D3D11/ANGLE), headless Chrome. Default NOT switched (perf gate missed, see 3).

## 0. Tool hang (also BUG-BENCH-01)
- gpucompare: `--query "shadows=map"` REPLACES the whole query (`gpucompare=1` is gone), so the page loads the plain game and `window.__gpuCompare` never appears. Correct: `--query "gpucompare=1&shadows=map"` or the new `--shadows map` flag. A full map run takes ~3 min and completes.
- bench: `--mode bench --variant world` works at 11b521b (240x90 and default grid): 4 views x 360 frames + 60 s walk + boot = ~108 s, so a timeout under ~120 s (tool default 120000) expires just before `window.__bench`. Output with `--timeout-ms 250000`: all 4 views + walk, GPU p95 4.6 ms on the walk. The earlier 400 s timeouts do not reproduce (likely run during the ME-19a edits / concurrent runs); the synthetic KeyW keydown is delivered (`input.isDown('KeyW')` true, walk counts 2/60 s ...).
- Fix: `tools/capture-browser.mjs` gets `--shadows <map|dda>` (appended to the mode's query) and a warning when `--query` has no mode parameter; test added. `tools/route-walk-browser.mjs --extra "k=v&..."`. `game/js/main.js`: `?shadowres=N` dev override.

## 1. gpucompare `shadows=map`
Before fix: 14 FAIL rows. Map-only: `card open`, `sceneFade` (varies with run), `bandEdge`, `rtsHill58/60/Sky15`, `water pond/murky top-down`, `swingLR t=160 pitch 0`, `particles` - all with holes (GPU frame empty: kind 6 %, k8gpu 0).
Cause (one bug, not shadow maths): the dirty-skip path of `_passShadow` returns early; `_passRaster` cleared depth with `gl.depthMask` still false (left by the test-only `readbackShadowDepthBits` copy pass, `depth.write:false`), a masked clear leaves last frame's depth, every fragment fails LESS -> blank GPU frame. Only the second pose with the same camera/caster set (skip hits) is affected; with `dirtySkip:false` all poses pass (proof). Latent in the real game too (any pass leaving depthMask false before a skipped frame).
Fix: `gl.depthMask(true)` before the sentinel clear in `GpuCellPipeline._passRaster` (one line).
After fix (full run, `gpucompare=1&shadows=map`): 5 FAIL, all identical in the dda run and already D-039 baselines: `lamp empty` (dLViol 3), `viewModel rest pitch 0` (dLViol 3, litFlip 2), `rest pitch 0 PITCHED` (same), `rest pitch 20 PITCHED` (dLViol 2, litFlip 2), `forestWalk` (glyph 97.7 %; light OK in map). Sun-map sunlit mismatch 0 on all five. `fpLevel0` (dLViol 3, dda run) passes in map. 0 map-only FAIL rows; 0 JS/GPU twin mismatches found, nothing widened.

## 2/3. Performance (route walk, 400x150, forest on, dev iGPU)
| run | GPU p50 | GPU p95 | shadow pass p50 | map renders/skips |
|---|---|---|---|---|
| dda (2 runs) | 9.74 / 9.65 | 18.05 / 14.54 | - | - |
| map dirty-skip | 15.55 | 24.76 | 9.23 | 1002 / 1092 |
| map `--noskip 1` | 16.91 | 29.25 | 10.55 | 1849 / 0 |
| map res 1536 | 9.99 | 26.26 | 8.54 | 899 / 1432 |
| map res 1024 | 12.37 | 19.50 | 7.43 | 993 / 1281 |
| no trees/scatter: dda | 2.10 | 2.81 | - | - |
| no trees/scatter: map | 2.71 | 3.61 | 0.99 | 1172 / 1167 |
Bars: skip <= +1.0 ms, forced <= +1.5 ms p95. Forest on: +6.7..10 ms (skip), +11..15 ms (forced) -> MISSED. Forest off: +0.8 ms p95 -> within bar.
Diagnosis: the cost is the forest in the shadow pass. Resolution barely matters (1024 still 7.4 ms), so it is vertex bound: 47 items / 64 draws = 12 terrain (62k tris) + 13 instanced tree groups (554 instances, ~47k tris per instance set at LOD0) + 20 voxel props. Needs an architect call (not done here): shadow-only LOD for instanced voxel/tree groups (coarse LOD or proxy mesh), a tighter instance radius than the 192 m box, or terrain ring LOD past ~48 m (amendment-3 fallback 2). Also note dda itself is 14-18 ms p95 with the forest on this iGPU (ENV-01c territory).

## 4. Default
Not switched: `shadows` stays `dda` unless `?shadows=map`; `rtsMain.js` pin unchanged. Suites 226/226 PASS, check-deps OK, mesh route walk 10/10 legs complete (map and dda).
