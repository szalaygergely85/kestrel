# WG-2c - terrain raster (arch-review)

2026-10-07, PC-B lane B1.

**Done.** `wgsl/terrainRaster.wgsl.js` is a line-by-line port of `glsl/terrain.vert.js` (vertex: model -> viewProj, smooth oct normal unpacked in the vertex stage; fragment: struct-footprint discard, `terrainTypeAt` near-nearest-else-far-nearest, GI/GA/depth outputs identical to GL: planeId 0xFFFFFFFF, kind|FACE_PACKED|type, packed normal, objectId, GA = world xyz + 1e30 bits). `wg/passRaster.js` gained the terrain pipeline (cull none, frontFace cw, indexed u32), a `TerrainU` uniform block fed from the same sources as GL (`near`/`_farGridDraw`/`nearReady`/`world.structures[].bbox`, `MAX_STRUCTS`), and two r8ui type textures (1x1 placeholders; uploaded only when `farVersion`/world or `near.version` changes, resized only if the bake size changes; one bind group rebuild per change, no per-frame validation scopes). Draw order = GL (after cloth, before the view model). `OCT_NORMAL` is now exported from `raster.wgsl.js` for reuse; `wgsl/index.js` appended `rasterTerrain`.

**Voxel parts:** nothing to do, WG-2b already draws static, compact voxel, mirrored, instanced and view-model parts.

**Bug caught by the compile gate:** `type` is a reserved WGSL keyword (renamed `terrType`); the Node probes cannot see this.

**Tests.** `terrainRaster.wgsl.test.js`: 6000 type-lookup probes (near/far/outside/near-off) of the WGSL `terrainTypeAt`/`farTypeNearest` bodies evaluated as JS against `TerrainMeshSet.typeAt`, plus op-order/layout string checks against the GLSL twin. `passRaster.test.js` extended: terrain draw (pipeline, cull, count/first, objectId + model words, texture slots), texture upload only on version change. `node tools/run-tests.mjs`: 268/268 PASS. `check-deps` OK. `capture-browser --mode wgsl --backend webgpu`: 7 modules, 0 errors.

**gpucompare (RTX 4060, headless Chrome, rays 1, 160x60, terrain on, same machine).** Commands: `node tools/capture-browser.mjs --mode gpucompare --query "gpucompare=1" --port 95xx` (WebGL2) and `--backend webgpu --query "gpucompare=1&backend=webgpu"`.
- WebGL2 geomOk 69/72; WebGPU geomOk 69/72. Failing rows identical on both: viewModel rest pitch 20, viewModel handsSwapped, forestWalk (known D-039 ties, as in WG-2b).
- Over all 72 geometry rows, `kindMismatch`, `holesExclK8`, `kindMismatchExclK8` are equal on both backends (0 diffs). No PASS->FAIL, no threshold touched.
- Rows needing water (WG-3e): none differ; the geometry rows do not depend on the water pass.

**Open.** Cells/light/shadow rows on WebGPU (WG-3); water (WG-3e); `terrainDraws` stat is new on the WebGPU path only; no timer span added (38.8a 22a still open for the first per-pass span). Logs/captures git-ignored.
