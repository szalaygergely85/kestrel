# WG-3e: water on WebGPU (B1, 2026-10-08) - DONE, arch-review

## RESOLVED
Root cause: `game/js/main.js` never passed the designer water-look table to the WebGPU pipeline (`wgPipeline.setWaterLooks(window.ASSETS.waterLooks)`, as GL does); pitched poses use the look table (tint/foam/glint), shear poses fell back to engine defaults that happened to match. Fix = that one line. Gate: run-tests 284 PASS, typecheck + check-deps OK, --mode wgsl 20 modules 0 errors, sun map WebGPU 140/6 and dda 66/7 (= WebGL2 baselines; the remaining FAILs are the old WG-3f/viewmodel/forest rows), 4 top-down water poses and rtsHillSky15 PASS.

## History (superseded by the above)

## Wiring done
- `WgCellPipeline`: owns `WgWaterPass` (resize in ctor/resizeGrid, `setWaterLooks`, `bindWorld` in `frame`, `readbackWater`, dispose); `portedPasses += 'water'`.
- `WgCellPass.run`: `wp.prepare` after raster (before resolve), `wp.runWater(texDepth)` after deriv before light; `WgShadePass.run(p,t,cam,water)`: `water.runComposite` between shade and edge; edge reads `edgeFg/edgeBg/edgeWaterTexture`, `waterOn`, `wos` (24 floats) when active.
- `gpucompare.js` WG branch: WG-3e wait removed (only WG-3f waits remain), waterfall layer row (`waterfallRow`, shared with GL) runs on WebGPU too. `WgCellPipeline.test.js` portedPasses updated.

## Gate (RTX 4060, headless, same machine; ports 9620-9625)
- run-tests 284 PASS, typecheck clean, check-deps OK, `--mode wgsl` 20 modules 0 errors.
- sun map: WebGL2 140 PASS / 6 FAIL (= WG-3d). WebGPU 135 / 11: the 6 known + FAIL water pond top-down, pond look top-down, murky look top-down, flowing radial pool top-down, rtsHillSky15 (WAS PASS in WG-3d = PASS->FAIL).
- dda: WebGL2 66 / 7. WebGPU 61 / 12 (same 5 extra).
- PASS on WebGPU (= GL): towerShadowGrass (real PASS now), pond grazing, sea, river grazing, waterfall front/back (incl. waterfall layer rows), all shadow-depth rows.

## Open bug (stop rule hit, ~70 calls)
All failing rows are PITCHED (projMode 1). pond top-down: glyph 88.9 % (GL 99.91), fgOutside 3408 (GL 37), geometry/light rows PASS. Findings (probe on `pond top-down`, composite pass debug output):
- WATER layer matches the JS twin (2036/2036 cells, kind+objectId; depth max err 3.8e-6).
- Composite uniforms correct in-shader (pitchA/C, projMode=1, eye == pitch eye, grid 160x60); P.xyz output == hand-computed eye+dir*dW; fog f = 0 (not fog); tint .85, a .68 plausible.
- comp output (readback of layer.compFg/Bg) == final cells, so the edge pass is not the cause. Final water cells differ in colour (bluer: JS 20,40,52 vs WG 17,46,77, bg ratio .45 vs .6) and glyph (WG 13/29, JS 94/13). Same WGSL path passes the shear poses.
- Not yet checked: JS-twin `waterSurfaceHash`/`fillWaterSlotTable` value vs the table packed in `wlTable` for these slots; k (sunF from light.w) in water cells; `opaque` decision (a >= seeThrough) vs JS. Next step: dump `wlTable` row of slot 0 + shader-side r0/r1/r3/seeThrough for cell 5965 vs the JS `_table`.
