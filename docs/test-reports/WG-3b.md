# WG-3b - light pass pipeline integration (arch-review)

2026-10-07, PC-B lane B1.

**Done.** New `engine/render/gpu/wg/passLight.js` (`WgLightPass`), run by `WgCellPass.run` after deriv when camera+world exist. Twin of `GpuCellPipeline._passLight/_uploadLightUniforms/_ensureWorldTextures`: LightU uniform words (ambient, sun on/dir/col, lights pos/col/visBox, cam basis, pitched A/B/C from the raster pass terms, struct A/B/count/worldMaxH); LVIS slots uploaded only when `visVersion` changed; world GEOM (rgba32float) + FLAGS (rg8uint) atlas uploaded on a new World / structVersion bump, else dirty rows only (`planFrameUpdate`). Pipeline + bind descriptor built once (22b). `sunMode` is 0/1 only (DDA); `uSunShadow` is a 1x1 sampled `depth24` dummy until WG-3d. `targets.js`: `texLight` (rgba32ui) + `targetLight`. `WgCellPipeline.readbackLight()` real (cols*rows 4-wide Uint32Array); `portedPasses` += 'light'; `rt.gpuActive` unchanged. No timer spans added (22a untouched). `light.wgsl.js` NOT modified.

**Device additions (small, needed by the plug-in contract):** TextureDesc formats `rgba32f` (rgba32float) and `rg8ui` (rg8uint) in `webgpuFormats.js`, `GpuDeviceGL2.glInternalFormat`, `GpuDevice.js` typedef (B2's sprites plug-in needs rgba32float too).

**Harness.** `game/js/dev/modes/gpucompare.js`: the WebGPU row now reads `readbackLight()` and runs `compareLight` against the JS twin (`cmpLight`, `lightWaits` in the row, `light=...` in the console line); a row whose twin uses the sun map (`cmpLight.sunMap`) is recorded but not gated (waits for WG-3d). Geometry rows untouched.

**Tests.** `WgCellPipeline.test.js` extended (texLight/targetLight, readbackLight shape, light pass bind/textures/dummy depth, LVIS upload once, no per-frame resource creation). `node tools/run-tests.mjs`: 277/277 PASS. check-deps OK. `--mode wgsl --backend webgpu`: 19 modules, 0 errors.

**gpucompare (RTX 4060, headless, 160x60, same machine, ports 9511-9516).**
- Light, `--shadows dda` (both twins on the DDA sun, the shadow-free path): GL 67/71 light rows PASS, WebGPU 67/71 PASS, 0 PASS->FAIL, identical PASS set (fails on both: crash room, lamp empty, handsSwapped dLViol 3 each, 1 more).
- Light, default run (GL = sun map where a pose has one; WebGPU twin = DDA): GL 69/72, WebGPU 67/72. The two extra WebGPU fails are `viewModel rest pitch 0 PITCHED CAMERA` and `forestWalk`; both also fail on GL under `--shadows dda`, i.e. they are the sun-map poses that wait for WG-3d (`sunMode` 2). Under the dda comparison every row matches GL.
- Geometry: WebGPU 40/72 geomOk, IDENTICAL row by row to a clean `git archive be10424` WebGPU run (40 PASS / 32 FAIL). NOTE: this is not the 69/72 of WG-3a: a regression came in with MESH-INST-01 (f3f0a19, CPU instance batching, meshTies in `breach`, `breachDown`, outside/hill poses, cloth, water...) and is NOT caused by WG-3b. Needs its own ticket (architect/PC-B2: kind-9 instanced batches on WebGPU).
- No thresholds touched.

**Open.** Sun-map mode (WG-3d); a WG-3b light row cannot exceed the geometry state of its pose (cells with wrong geometry are still compared). Captures are git-ignored.

## Fix (MESH-INST-01 feed on WebGPU) - B1, 2026-10-07
Cause confirmed: `wg/passRaster.js` still used plain `addMeshStructures` and no `meshDraw` arg, while GL pipeline + JS twin use `addMeshStructuresBatched` (MESH-INST-01) and `_instances.addToDrawList(..., meshDraw)` (TREES-LP-b): different kind-9 planeIds/draw set -> meshTies rows broke (69/72 -> 40/72).
Change (`passRaster.js` only, no WGSL): own `MeshGroupSet` + `meshDrawArg`; `addMeshStructuresBatched(..., this.meshGroups, this.planes)`; meshDraw passed to instances; instanced draw honours `DRAW_FLAG_ONE_PART` (single range over `mesh.triCount`). The existing instanced WGSL needed nothing extra. Test: `passRaster.test.js` one-part group = one instanced draw.
Results (RTX 4060, 160x60, ports 9521-9523): gpucompare WebGPU geomOk 70/73 (was 40/72; 73rd row = lowpolyTrees passes; the 3 fails = viewModel pitched pitch 20, handsSwapped, forestWalk, same rows GL fails). Light `--shadows dda`: WebGPU 68/73, no PASS->FAIL vs WG-3b; `--mode wgsl` 19 modules 0 errors. run-tests 278/279: `engine/world/colliders.test.js` failed once under load, passes alone (32/0). check-deps OK. No thresholds touched.
