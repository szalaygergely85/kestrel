# WG-5b - drop WebGL2 (wip/wg5, uncommitted for the main session)

Removed: 39 files, about 7470 lines (all 41 WG-5a candidates: engine/render/gpu/glsl/*, GpuCellPipeline, RenderTargetGL,
GpuDeviceGL2 (+ .test, .stride.test), gridTargets (+test), glUtil, overlayPass, spritesPass, GpuTimer (+test), gl/index.js barrel,
crosshair/water/waterComposite/waterFlow/WgCellPipeline `.gl.test.js`, glsl.test, sunShadowLookup.glsl.test, TerrainTextures.features.test),
plus game/js/ui/webgl2Gate.js.

Changed:
- createRenderer: WebGPU only. On failure/absence calls `onWebGpuMissing(reason)` and returns the CPU Canvas2D target (160x60, no device/pipeline,
  info.webgpuMissing=true). `force2d` skips WebGPU without the callback (kept for tests/capture). `?backend=webgl2` only warns.
- RenderTarget.js is now the c2d-only factory; createGpuDevice always throws on failure (no `fallback`, no gl option; backend 'webgl2' throws).
- engine/index.js: GpuCellPipeline, PASS_NAMES, isSoftwareRenderer, GpuSpritePass, GpuOverlayPass exports removed. engine.js setGrid: `!wgReady` only.
- game main.js: default backend webgpu, `onWebGpuMissing` hides the canvas, dynamic-imports ./webgpuRequired.js (showWebGpuRequired(document.body,{reason}); kestrel-2's
  file, plain DOM fallback text if absent) and sets gpuBlocked (no game loop). GL gpuPipeline build/forced-CPU-grid/overlay/pass-ms removed;
  `gpuPipeline` stays `null` (dead branches in dev modes gpucompare/flicker/perfBench still read it: follow-up cleanup).
- rtsMain.js now fail()s (needs WebGPU port); leafPreview/spriteDev/spritesPage/tools/editor GL branches removed; capture-cinematic throws (needs port).
- tools: capture-browser `--backend webgl2` -> error, expectBackend 'webgpu', presentdiff oracle = `force2d=1`; check-deps rule 18 now engine-wide.
- Tests: sprites.wgsl.test/sprites.test GLSL parity cases dropped; createRenderer.test + GpuDeviceWebGPU.test rewritten for throw/onWebGpuMissing;
  meshInstances/setGridWebgpu tests lost their GL cases.

Results: `wg5a-plan.mjs` 0 reachable; check-deps OK; run-tests 411 suites, only load flakes (occlusion, terrainStroke, both PASS alone);
typecheck WARN is pre-existing (projection.js/colliders.js). No browser run.

Owner without WebGPU: canvas hidden, "WebGPU required" screen (reason no-api / no-adapter / device-failed), no game loop.
Not done / follow-ups: dead `gpuPipeline` branches in game/js/dev/modes/*, perfBench, spritesPage; tools/verify-*.mjs and viewport-fit-browser still assert
backend 'gl2'/`webgl2` args (need `webgpu`); GLSL `*.glslref.js` twins in wgsl/ kept (still used by WGSL parity tests); rtsMain/capture-cinematic WebGPU ports.
