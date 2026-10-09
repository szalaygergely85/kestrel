# Sprint 8 queue (PO draft, 2026-10-08)

**PO RECOMMENDED ORDER 2026-10-08 (goal: playable loop with save + title menu; gap list in docs/sprints/sprint-7.md "Review 2026-10-08 (PO)"; B1 hooks before B1 engine items, needs manager OK):**
1. B1 GFX-02 two ARCH fixes (~0.25 d) -> PC-A merges pc-b to master. 2. B1 S8-B1-01 save relay + autosave + waystone-touch save + load (~0.75 d). 3. B1 S8-B1-03 title menu mount + confirm-screen draw fix (~0.5 d).
4. C pastes S8-A-11 objective texts into `m1.quest.json` (~0.25 d), then B1 S8-B1-02 quest hook + questLog HUD (~0.5 d). 5. C S8-C-06 chest sim (~0.75 d) and 6. C S8-C-07 item-get card (~0.5 d), both in parallel with B1 steps 1-4.
7. B1 S8-B1-04 chest hook (~0.5 d). 8. PC-A MAP-01a chart design + text (~1 d, parallel now). 9. C S8-C-14 chart card -> B1 S8-B1-15 `M` wiring (~1.25 d). 10. NEW row (PO to write): waystone heal + respawn-at-last-waystone (C sim + B1 hook, ~0.5 d).
Parallel, off the critical path: B2 finishes the 5 batch-12 fixes, then ALPHA-01e -> C QUAT-TREES-01 (forest look). PREFAB-SEAM, ED-MESH-01e, ONEPART and S8-B1-06..14 wait until step 7 is done.

Rules: D-044 (no new GLSL, WGSL only for render features), JS twin = oracle, never widen a gpucompare threshold (D-039 known-FAIL only), engine never imports `game/`, `engine/physics/` stand-alone. B1 owns `game/js/main.js`, `wg/**`, `createRenderer.js`, `capture-browser.mjs`, `gpuCompare.js`; B2 owns `engine/render/gpu/wgsl/**` modules, `wg/pass*.js` new standalone files it created, `engine/mesh/**`, importer/gltf tools. Every engine item ends in `arch-review`. Format: `[priority, size, deps]`. "owner look" = owner-visible.

**ARCH validation 2026-10-08 (architect, against origin/master 82de306 + origin/pc-b a27dffc + origin/pc-b2 24b13dc).** Markers: `ARCH-NOTE NEEDED` (no dev before the note), `DUP of X` / `DONE` / `DROP: reason`, `ARCH:` = corrected file/seam/dep. Not merged to master yet: GFX-02 + GFX-01w (pc-b), MESH-SCALE-01 73ddef1 + MESH-BIN-01 24b13dc (pc-b2).

| ID | needs note | reason |
|---|---|---|
| S8-B1-06 | yes (small) | args-slot free list + prune `GpuDeviceWebGPU` dispatch bind-group cache (`p.groups`) on buffer dispose |
| S8-B1-09 | yes (small) | new `createPipelineAsync` on the `GpuDevice` interface (GL2 + mock too) |
| S8-B1-10 | yes | 38.8a(9) rule today = warn + reload; full rebuild touches every GPU resource owner (> 1 d) - re-scope |
| S8-B2-03 | yes | eviction crosses `engine/mesh` registry and render-side GPU buffers (B1 files) |
| S8-B2-04 | yes | new per-vertex attribute = MeshData + KMSH bin format + vertex layout change |
| S8-B2-05 | yes (small) | `engine/world/wind.js` already exists; which part goes to WGSL (gust kernel table, zones) |
| S8-B2-06 | yes | sway must widen cull/shadow-cull bounds; uniform slot; shadow variants |
| S8-B2-07 | yes | band needs both LODs drawn (cull kernel emits to 2 lists, B1 args) |
| S8-B2-10 | yes (fable) | previous-frame HZB cannot promise "never wrongly culled" without a 2-phase test |
| S8-B2-12 | yes (small) | `sunlit` is a bit flag in LIGHT, not a float; uniform slot |
| S8-B2-13 | yes | WaterU layout, who owns `addRipple` (engine/world/water.js vs render) |
| S8-B2-17 | yes | oracle = existing `engine/fx/particles.js`; is a GPU sim worth it at 2048 cap |
| S8-B2-18 | yes | GPU writes into PART/PART_Z need storage texture + depth atomics; WgSpritesPass is B1 |
| S8-B2-20 | yes | horizon taps on deriv depth; uniform slot; after B2-04 note |
| S8-C-20 | yes (S8-A-02) | `prefab` kind in `engine/content/loadPack.js` KNOWN_KINDS |

## Lane B1

### S8-B1-01 US-089w save relay + autosave + load hook [P0, ~0.75 d, deps: lane C saveState.js (US-089a)]
Mount C's `saveState.js` in `game/js/main.js`: autosave every 60 s and on waystone touch, load at boot when a slot exists, `?save=0` disables.
- [ ] Node test with a fake storage: round trip of player pos/hearts/inventory/flags through the relay is byte-stable.
- [ ] Headless capture: reload restores position within 0.01 m; no console errors.
Files: `game/js/main.js` (+ `game/js/dev/` harness).
ARCH: dep done (US-089a 20a20b4); API = `collectSave`/`applySave`/`stringifyGameSave`/`parseGameSave`/`createStorageAdapter` (3 slots built in). Bind restored quest/chests/dead IDs before beastSim's reset-on-create (C log).

### S8-B1-02 US-096w quest event hook [P0, ~0.5 d, deps: lane C quest.js (US-096a)]
Feed game events (enemy killed, item picked, area entered, chest opened) from main.js into C's quest module; objective text shown via existing HUD slot.
- [ ] Node test: scripted event sequence advances the demo quest to done.
- [ ] Quest state is included in the S8-B1-01 save and survives reload.
Files: `game/js/main.js`.

### S8-B1-03 US-090w title menu mount [P0, ~0.5 d, deps: lane C titleMenu.js (US-090a) + PO OK on it]
Show the title menu before world boot (New / Continue / Settings), Continue greyed when no save, boot continues behind the menu card.
- [ ] Headless capture shows the menu at 400x150; Enter starts the game; `?title=0` skips it.
- [ ] Continue loads the S8-B1-01 save. Owner look.
Files: `game/js/main.js`. NEEDS PC-A: PO OK on US-090a first.

### S8-B1-04 US-092w chest interaction hook [P1, ~0.5 d, deps: lane C chest module (US-092a), designer chest model]
Interact key near a chest plays the open clip, grants the item into the inventory, shows the item-get card, marks the chest opened in the save.
- [ ] Node test: chest opens once, item added once, state persisted.
- [ ] Owner look: headless capture of the item-get card.
Files: `game/js/main.js`. NEEDS PC-A: designer (chest + card) done first.

### S8-B1-05 DONE 27c68ca (ARCH OK 2026-10-08) - passCull `_gpuHash` replaced by per-group version counter [was P0]
Kept for ID stability: shipped as WG-4b follow-up (c). Remaining bit: log shadow renders/skips cull on vs off (gate before WG-4c) - done in the 27c68ca report (324/1476 on, 636/1164 off).

### S8-B1-06 Cull batch release on group removal [P1, ~0.5 d, deps: S8-B1-05]
ARCH-NOTE NEEDED (small, S8-A-01). Free the batch slot (args offset, instance buffer) when a group is removed so the 64-group cliff (CPU fallback) is not hit by reload/edit churn.
ARCH: `WgCullPass.removeBatch` already frees the buffers; missing = args-slot free list (`_nextSlot` only grows). Also prune the device dispatch bind-group cache (`GpuDeviceWebGPU.dispatch` `p.groups`, never pruned) on buffer dispose - device edit, B1 file.
- [ ] Node test: add/remove 500 groups in a loop keeps live batches <= 64 and never falls back to CPU cull.
- [ ] 0 new device resources after warm-up.
Files: `wg/passCull.js`.
NOTE WRITTEN: architecture.md 38.10a

### S8-B1-07 WebGPU per-pass GPU timer (timestamp-query) [P1, ~0.75 d, deps: none]
Use `timestamp-query` when the adapter has it: ms for cull / raster / shadow / light / shade / edge / sprites in the F3 panel (EMA), nothing when unsupported.
- [ ] Node test with a mock device: pass order, ring of 3 query sets, no `mapAsync` stall (results read 2 frames late).
- [ ] Capture on the 4060: F3 shows per-pass ms, sum within 15 % of frame ms.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, F3 panel line in `main.js`.
ARCH: the timestamp ring already exists (WG-1b3 da34e69: `device/WebGpuTimer.js`, 3-ring, 16 slots, `begin(slot)/end()`, p50/p95, `writeStats`; RenderTargetWebGPU times the present in `FRAME_TIMER_SLOT`). Story = assign one slot per WG pass in `WgCellPipeline` (the `setPassTiming` seam) + F3 lines; no new query-set code. ~0.5 d. Mock-ring AC is already covered by `WebGpuTimer.test.js` - test the slot mapping instead.

### S8-B1-08 GFX-02 ultra step-up from the WebGPU timer [P1, ~0.5 d, deps: S8-B1-07]
`AutoBench` gets kind 'gpu' samples on WebGPU, so `high` with p95 < 7 ms can try `ultra` once (today WebGPU never picks ultra).
- [ ] Node test (injected samples): high -> ultra when p95 < 7, stays when 7-14, steps down when > 14.
- [ ] Note in `GFX-02.md` updated. Owner look: Ultra auto-pick on the 4060.
Files: `game/js/gfxAutoRun.js`, `gfxAuto.js` (+tests).
ARCH: deps also = GFX-02 ARCH CHANGES fixes (cb0bca2, batch 6) landed + pc-b merged (files exist only on pc-b). Note is `docs/test-reports/GFX-02.md`. `AutoBench.sample()` just needs the WebGpuTimer p95 sum. Risk: GFX-02.md says ultra is unreachable under vsync on the 4060 (GL timer included the vsync wait) - the AC must state vsync on/off.

### S8-B1-09 Async pipeline compile behind the loading card [P1, ~0.75 d total = 09a ~0.4 d device side (beginCompileBatch/endCompileBatch, createPipelineAsync, createComputePipelineAsync; GL2 + mock resolve sync) + 09b ~0.35 d pipeline + boot wiring; note architecture.md 38.10b; deps: none]
ARCH-NOTE NEEDED (small, S8-A-01: `createPipelineAsync`/`createComputePipelineAsync` on the `GpuDevice` interface, GL2 + mock resolve sync; none exists today). Build all WG render/compute pipelines with `createRenderPipelineAsync`/`createComputePipelineAsync` during boot and log compile ms per pipeline.
- [ ] No first-frame hitch: first 5 frames after boot all < 50 ms in a headless capture trace.
- [ ] Boot log lists pipeline name + ms, total printed; Node mock test that boot waits on all promises.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, `main.js`.
NOTE WRITTEN: architecture.md 38.10b

### S8-B1-10 Device-lost: pause + autosave + reload card [P1, ~0.5 d, RE-SCOPED per architecture.md 38.10c, deps: S8-B1-01]
RE-SCOPED 2026-10-08: ACs below replace the old ones (pipelines rebuilt / scene back in 2 s). New ACs: (1) Node mock device firing `lost` -> game pauses, one autosave, card "GPU reset - press R or click to reload" shown; (2) dev hook `window.__kestrel.loseDevice()` triggers it; reload boots from the autosave. Full in-place rebuild = later story DEVICE-LOST-2 (> 1 d; needs a renderer-swap seam in the engine).
ARCH-NOTE NEEDED - re-scope: today `WgCellPipeline._onLost` + `RenderTargetWebGPU` warn and set `ready=false` ("reload to recover", 38.8a(9)); a real rebuild touches every GPU resource owner (targets, MeshBuffers/world/terrain textures, all passes, sprite atlas) = > 1 d. Proposed 0.5 d instead: lost -> autosave (S8-B1-01) + "GPU reset, reload" card + one-key reload; full rebuild = later story. Original: On `device.lost` rebuild device, pipelines and world uploads once; second loss in 10 s shows a "GPU reset, reload" card.
- [ ] Node test with a mock device firing `lost`: pipelines rebuilt, `ready` true again, second loss shows the card.
- [ ] Headless: `device.destroy()` via a dev hook, scene reappears within 2 s.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, `main.js`.
NOTE WRITTEN: architecture.md 38.10c

### S8-B1-11 Zero per-frame allocation in the WG frame loop [P1, ~0.5 d, deps: none]
Cache bind groups and descriptors in `WgCellPipeline.run` and the passes it calls.
ARCH: mostly in place (38.8a(17): writeTexture reuse, `texDirty` texture groups, dispatch groups cached by buffer identity, passCull args view cached). Story = write the 1000-frame test first, fix only what it finds; ~0.5 d is honest.
- [ ] Node 1000-frame heap test with the mock device: heap growth ~0 and 0 new device resources per frame.
- [ ] gpucompare rows unchanged vs same-machine baseline.
Files: `wg/WgCellPipeline.js`, `wg/pass*.js` (call sites only, B2's passes get a written `NEEDS B2`).

### S8-B1-12 Resize / DPR / fullscreen on WebGPU [P1, ~0.5 d, deps: none]
Canvas resize, devicePixelRatio change and F11 fullscreen keep aspect and the grid, no stretched glyphs, no leak.
- [ ] Node test: 200 random resizes with the mock device leave resource counts flat.
- [ ] Capture at 3 window sizes shows the same 400x150 grid letterboxed correctly. Owner look.
Files: `RenderTargetWebGPU.js`, `main.js`.
ARCH: `RenderTargetWebGPU.resize(availW, availH, dpr)` + atlas rebuild on DPR already exist; this is a verify + leak-test story. Takes over the 50-live-`setGrid` leak AC from S8-B1-17 (`engine.setGrid` -> `rt.setGrid` + `WgCellPipeline.resizeGrid`).

### S8-B1-13 gpucompare per-backend baseline file + auto diff [P0, ~0.5 d, deps: none]
`--baseline <file>` writes a JSON of row verdicts per backend/adapter and later runs print only PASS->FAIL, FAIL->PASS and new rows (exit 1 on PASS->FAIL).
- [ ] Node test on fixture verdict lists: regress, fixed, new, known-FAIL handling (D-039 list).
- [ ] Baselines for webgpu + webgl2 on the 4060 committed under `docs/test-reports/`.
Files: `gpuCompare.js`, `game/js/dev/modes/gpucompare.js`.
ARCH: wrong file: `engine/render/gpu/gpuCompare.js` is the in-page compare library (engine, no file I/O). The flag + baseline JSON + diff go in `tools/capture-browser.mjs` (its gpucompare mode already parses rows; known-FAIL stays report-only) with the pure diff in a tools helper (e.g. `tools/gpucompare-baseline.mjs` + test). Key baselines per adapter (D-048 Arc rows).

### S8-B1-14 capture-browser `--route` frame-time trace [P1, ~0.75 d, deps: none]
Headless walk along a named route (roadSouth -> forest) recording per-frame ms, p50/p95/max, draw counts, shadow renders; file name carries backend + preset.
- [ ] Output JSON with fixed schema; Node test of the stats on a fake trace (percentiles exact).
- [ ] 4060 numbers for High + Ultra recorded in the GFX-04 and WG-4c prep rows.
Files: `tools/capture-browser.mjs`, `game/js/dev/`.
ARCH: partial DUP of `tools/route-walk-browser.mjs` (ME-12: headless walk of the M1 route, already outputs sim/js/gpu/shadow p50/p95/max). Extend that tool instead (backend + preset in the file name, draw counts, shadow renders/skips, fixed JSON schema); ~0.5 d.

### S8-B1-15 MAP-01c wiring: `M` toggles the chart [P1, ~0.5 d, deps: lane C mapCard.js (MAP-01c)]
Mount C's mapCard in main.js: `M` toggles, Esc closes, live x/y/yaw each frame, input blocked while open.
ARCH: partly DONE - main.js already imports `initMapCard/stepMapCard/isMapOpen/getMapPanel` (main.js:60, 920) and reads `KeyM` (1013). Story = only the delta if MAP-01c changes the `stepMapCard` signature; likely ~0.25 d.
- [ ] Node test: toggle state machine and that no player input reaches the sim while open.
- [ ] Real-GPU capture at 400x150 with the arrow on the chart. Owner look.
Files: `game/js/main.js`.

### S8-B1-16 MAP-01d wiring: Visibility feed + saved fog mask [P1, ~0.5 d, deps: S8-B1-15, S8-B1-01, lane C MAP-01d]
Feed the visited-cell stream (Visibility or coarse grid) from the player to the map module and include its mask in the save.
- [ ] Node test: byte-stable mask round trip through the save.
- [ ] Walk 100 m in a capture: explored area grows, rest stays blank paper. Owner look.
Files: `game/js/main.js`.

### S8-B1-17 DUP of GFX-01w (a7dbeae + 767355c, pc-b): "restart to apply", live grid, F3 `quality:` line already shipped; leak AC moved to S8-B1-12. Settings "restart to apply" + live grid apply check [P1, ~0.5 d, deps: none]
Quality / shadow changes show the "restart to apply" line; grid change applies live through `engine.setGrid`.
- [ ] Node test with the mock device: 50 live grid changes keep resource counts flat (`resizeGrid` leak check).
- [ ] F3 shows `quality: <name> (auto|saved|url)` after a change.
Files: `game/js/main.js`, `wg/WgCellPipeline.js`.

### S8-B1-18 US-019 ambient dust motes in sunbeams [P2, ~0.5 d, deps: none]
Deterministic ~60 slow motes around the player through the existing particle layer (WebGPU sprites pass handles it), lit only when sunlit, off with `?ambient=0` and on Low preset.
- [ ] Node test: same seed + time gives same positions; count never exceeds the pool; 0 alloc per frame.
- [ ] Owner look: capture in forest light shaft. Needs the engine emitter API only (no new render code); else write `ASK ARCHITECT`.
Files: `game/js/quest/ambient.js` (new), one mount line in `main.js`.
ARCH: = US-053d `motes` preset (backlog: "closes US-019"). The engine particle system exists (`engine/fx/particles.js`, `emitterDef.js`, cap 2048; drawn by the sprites pass via `particleLayer.js`); do it as a preset + emitter placement (designer ramp), not a new sim. "Lit only when sunlit" needs a sun-visibility query per mote - if no public helper, ASK ARCHITECT.

### S8-B1-19 WG-5a deletion plan (report + check-deps script) [P1, ~0.5 d, deps: none]
No deletion: a Node script lists every importer of `GpuCellPipeline`, `GpuDeviceGL2`, `glsl/`, `gridTargets`, `glUtil`, `RenderTargetGL`, dda paths and tests that need rewriting.
- [ ] `tools/wg5a-plan.mjs` prints importer counts; output pasted into the WG-5a row.
- [ ] Order of removal in 4 commits, each green (suites + check-deps).
Files: `tools/wg5a-plan.mjs` (new), WG-5a row.

### S8-B1-20 Boot stage timing + loading card progress [P2, ~0.5 d, deps: S8-B1-09]
Loading card shows stage names (adapter, pipelines, content, meshes, world) with ms; boot total logged and shown in F3 for 10 s.
- [ ] Node test: stage tracker orders and sums correctly with a fake clock.
- [ ] Boot to first frame on the 4060 recorded in the row (budget proposal 4 s). Owner look.
Files: `game/js/main.js`.

## Lane B2

### S8-B2-01 WGSL limits and layout test [P0, ~0.5 d, deps: none]
Test that every module in `WGSL_MODULES` stays inside default WebGPU limits.
- [ ] Per-module sampled textures <= 16, uniform block <= 64 KB, vertex attributes <= 16, targets <= 8.
- [ ] Fails with a readable message when a patch (e.g. mask, flicker) pushes shade over 16 textures.
Files: `wgsl/wgsl.test.js` (extend), `wgsl/index.js` read-only.
ARCH: no `wgsl/wgsl.test.js`; use `engine/render/gpu/wgsl/index.test.js` (or the existing `engine/render/gpu/wgsl.test.js`). `WGSL_MODULES` exists. Count bindings from the module text/binding tables, not from a device.

### S8-B2-02 `validate-mesh` budget report [P0, ~0.5 d, deps: none]
Tool reports per registered mesh: tris, ranges, bytes, collider kind, one-sided open-edge %, and exits 1 over budget (tris > 20k, ranges > 8, bytes > 1 MB, configurable).
- [ ] Node test on fixtures (over/under budget).
- [ ] Table for all current meshes pasted into the row.
Files: `tools/validate-mesh.mjs` (new), mesh-import skill line.
ARCH: reuse `tools/mesh-budgets.mjs` (MESH_BUDGETS) - and per MESH-FULL-01 (owner: original detail) budgets are REPORT-ONLY: default exit 0 with warnings, exit 1 only with `--strict`. Bytes column after MESH-BIN-01 (pc-b2 24b13dc) is merged.

### S8-B2-03 Mesh LRU eviction [P1, ~0.75 d, deps: MESH-LOAD-01]
ARCH-NOTE NEEDED (eviction spans `engine/mesh` + render GPU buffers owned by B1). Meshes farther than `loadM + 60 m` and unused for 20 s are released (CPU data and GPU buffers); colliders stay.
- [ ] Node test with a fake fetch: walk out and back, count loaded/evicted, no thrash within the hysteresis band.
- [ ] Heap and GPU buffer count flat over a 1000-frame loop route.
Files: `engine/mesh/` loader + registry.

### S8-B2-04 ME-20a importer vertex AO [P1, ~0.75 d, deps: none]
ARCH-NOTE NEEDED (new MeshData attribute = KMSH bin format + vertex layout + MeshData byte-identity test). Importer bakes per-vertex AO (hemisphere ray test against the mesh, 32 rays) into a vertex attribute, opt-in `--ao`.
- [ ] Node test: closed corner vertex AO < open top vertex AO; deterministic output across runs.
- [ ] No change to existing meshes unless re-imported; ASCII-visible look page needs designer preview (NEEDS PC-A: designer).
Files: gltf importer, `engine/mesh/` data types (read-only use in shade is ME-20b).

### S8-B2-05 `windAt(x,z,t)` shared wind field [P1, ~0.5 d, deps: none]
Pure JS function in `engine/core` (direction, gust, 2 octaves, fully deterministic) plus its WGSL twin text in `common.wgsl.js`.
- [ ] Node test: JS vs WGSL probe within 1e-5 over 5000 samples; same output for same inputs.
- [ ] Wind params as one options object (`dirDeg`, `speed`, `gust`), default zero.
Files: `engine/core/wind.js` (new), `wgsl/common.wgsl.js` (append).
ARCH: partial DUP - `engine/world/wind.js` (US-138, 32.5: `createWind(def, seed)`, base + gust kernel table `WIND_K_SIZE` 64 + 16 zones, trig-free, `sampleInto`) already exists. Do NOT add `engine/core/wind.js`; story = WGSL twin of the existing sampler (base + gust; zones optional) + JS-vs-WGSL probe. ARCH-NOTE NEEDED (small): kernel table upload + which zones go to the GPU.

### S8-B2-06 Wind sway for kind-9 foliage and grass [P1, ~0.75 d, deps: S8-B2-05, B1 wiring for the time uniform]
ARCH-NOTE NEEDED (cull + shadow-cull bounds must grow by max sway, `cull.wgsl.js`/`cullShadow.wgsl.js`; uniform slot; "grass" = which draw kind). Instanced vertex stage displaces by `height^2 * windAt` (trunk base fixed), also in the shadow variants.
- [ ] JS twin step + Node oracle test: time 0 or wind 0 = bit-identical to today; gpucompare rows unchanged at defaults.
- [ ] Owner look: two captures at different times show tree tops moved, trunks still. WGSL only.
Files: `wgsl/raster.wgsl.js` patch, `engine/mesh/rasterJS.js`; `NEEDS B1`: time uniform from main.js/passRaster.

### S8-B2-07 LOD dither crossfade [P1, ~0.5 d, deps: none]
ARCH-NOTE NEEDED (in the band both LODs must be drawn: cull kernel writes the instance to both LOD lists, B1 args layout). Note: `lodDither` in `shade.wgsl.js` is the terrain shade LOD, unrelated. Screen-door crossfade over a 3 m band between LOD0 and LOD1 using a hash of the pixel (ASCII cells: stable per cell), module patch + twin.
- [ ] Node test: band coverage sums to 1 across the two LODs; no popping row difference at band edges in twin vs oracle.
- [ ] gpucompare unchanged with the feature off by default. NEEDS B1 to wire the uniform.
Files: `wgsl/raster.wgsl.js`, `engine/mesh/rasterJS.js`, `wgsl/cull.wgsl.js` (LOD pick unchanged).

### S8-B2-08 DUP / DROP: point-light flicker already exists - `engine/render/lighting.js` per-light `flicker:{hzMin,hzMax,amount,jitter}` + seed, folded on the CPU into `col` (uLightCol) for both backends; no WGSL change needed. Light flicker parameters [P1, ~0.5 d, deps: none]
Each point light gets `flickerAmp`, `flickerHz`, `seed`; intensity multiplier computed in the light module (no CPU RNG), identical in the JS twin.
- [ ] Node test: amp 0 = unchanged output; deterministic for a time; bounds `1 +- amp`.
- [ ] Owner look: torch pose capture at two times. NEEDS PC-A: architect small note on the uniform slot (light block 1264 B).
Files: `wgsl/light.wgsl.js`, `engine/render/lighting.js`.

### S8-B2-09 HZB depth pyramid module [P1, ~0.75 d, deps: none]
Standalone `wgsl/hzb.wgsl.js` (max-depth downsample chain, compute) + JS twin + Node oracle.
- [ ] Twin vs kernel probe on random depth rows: exact for powers of two and non-power-of-two sizes.
- [ ] Module registered, 0 compile errors via capture-browser `--mode wgsl`.
Files: `wgsl/hzb.wgsl.js` (new), `wgsl/index.js` (append).

### S8-B2-10 Occlusion test in the cull kernel [P1, ~0.75 d, deps: S8-B2-09, B1 passCull wiring]
ARCH-NOTE NEEDED (fable, core render): previous-frame HZB alone cannot guarantee "never wrongly culled" (disocclusion, fast turns); needs a 2-phase test (re-test culled set against this frame's HZB) or a stated lag rule. Second-pass AABB test against the previous-frame HZB with a conservative margin; instances never wrongly culled.
- [ ] Node twin test: no visible instance culled (set superset of brute force visible) on bench poses.
- [ ] Reports culled-by-occlusion count at roadSouth. NEEDS B1 to wire the HZB texture; writes `NEEDS B1` row.
Files: `wgsl/cull.wgsl.js`, JS twin in `wg/passCull.js` oracle helpers (read-only to B1 file; ask first).

### S8-B2-11 LOD1 preview tool for the owner [P1, ~0.5 d, deps: none]
Tool generates a decimated LOD1 candidate for a mesh and a side-by-side preview page; never writes to the registry (no silent changes).
- [ ] Preview shows LOD0/LOD1 tris, ASCII render at 3 distances.
- [ ] Owner picks; only then QUAT-LOD-01 imports it. NEEDS PC-A: owner decision.
Files: `tools/mesh-lod-preview.mjs`, `design/preview/` page.

### S8-B2-12 Cloud shadows on the sun term [P2, ~0.75 d, deps: S8-B2-05]
NOTE WRITTEN: architecture.md 38.13 (PC-B 5th agent, PC-A RATIFIED 2026-10-09) - split 12a light pass ~0.6 d / 12b terrain+water consumers ~0.35 d; was: `sunlit` is a bit in the LIGHT rgba32uint word (`sunlit | litCount<<8 | sunN<<SUN_N_SHIFT`), not a float - scale the sun contribution to L (and decide sunN), keep the bit; uniform slot. Wind source = existing `engine/world/wind.js`. Scrolling low-frequency noise multiplies `sunlit` in the light module (strength uniform, default 0); wind direction moves it.
- [ ] Node twin test: strength 0 bit-identical; strength 1 stays in [0.4, 1].
- [ ] Owner look: roadSouth at two times. WGSL + twin only.
Files: `wgsl/light.wgsl.js`, `engine/render/lighting.js`; `NEEDS B1` uniform wiring.

### S8-B2-13 Water ripples from splashes [P2, ~0.75 d, deps: none]
`WaterU` gets 8 ripple rings (`x,z,t0,amp`) displacing the glyph/flow term in the composite; JS twin in the water layer.
- [ ] Node probe test: no rings = unchanged; ring expands at fixed speed and fades by 2 s.
- [ ] `engine` API `water.addRipple(x,z,amp)` with ring buffer; owner look on a splash pose.
Files: `wgsl/water.wgsl.js`, `wgsl/waterComposite.wgsl.js`, `wg/passWater.js`, `engine/render/waterLayer.js`.
NOTE WRITTEN: architecture.md 38.14 (PC-B 5th agent, PC-A RATIFIED 2026-10-09) - composite-only (WaterCompositeU, not WaterU), ring on `world.water`, ~0.75 d one step; was: (WaterU layout in `uniformBlock.js`; ring buffer owner: `engine/world/water.js` state vs render). Paths: `engine/render/gpu/waterLayer.js` (not engine/render/), JS twins `engine/render/waterComposite.js` + `rasterWaterTri` in `engine/mesh/rasterJS.js`. Links to US-055b (splash entry ring).

### S8-B2-14 Wetness (rain darkening) uniform [P2, ~0.5 d, deps: none]
Global `wetness 0..1` darkens albedo and boosts specular-like gain in shade, default 0.
- [ ] Node probe: wetness 0 bit-identical; 1 lowers luminance by 10-25 %.
- [ ] Texture count in shade stays 16 (S8-B2-01 passes).
Files: `wgsl/shade.wgsl.js`, `engine/render/detailShade.js`.

### S8-B2-15 Importer crease angle and vertex weld [P2, ~0.5 d, deps: none]
`--crease <deg>` (default off) welds vertices and averages normals below the angle.
- [ ] Node test: cube stays hard at 45 deg; sphere becomes smooth; tri count unchanged.
- [ ] No existing mesh changes unless re-imported.
Files: gltf importer.
ARCH: `engine/mesh/gltf.js` already welds by position (`weldKey`) and reports smoothing groups; `--crease` only changes how groups split by angle. Files: `tools/gltf-import.mjs`, `engine/mesh/gltf.js`.

### S8-B2-16 Convex-hull collider option for rocks [P2, ~0.75 d, deps: none]
`gen-mesh-colliders --hull` builds a convex hull (<= 32 faces) for flagged meshes; capsule sweeps use it.
- [ ] Node test: capsule blocked on the hull face, free just outside; `--check` 0 diffs for default meshes.
- [ ] Collider build time per rock logged. Skill `engine-physics-colliders`.
Files: `tools/gen-mesh-colliders`, `engine/mesh` collider data (physics stays stand-alone).
ARCH: 0.75 d is honest only if the hull is emitted as triangles into the existing static mesh BVH (`engine/physics/meshCollide.js` path) - NO new convex/GJK primitive in `engine/physics/`. File: `tools/gen-mesh-colliders.mjs`.

### S8-B2-17 GPU particle kernel + JS twin [P2, ~1 d, deps: none]
`wgsl/particles.wgsl.js` compute (integrate, gravity, drag, ground plane, lifetime) for up to 4096 particles; JS twin is the oracle.
- [ ] Node oracle: same positions within 1e-5 after 300 steps from the same seed.
- [ ] Deterministic hash RNG, no `Math.random`. Registered, 0 compile errors.
Files: `wgsl/particles.wgsl.js` (new), `engine/entities` twin (new file); NEEDS PC-A: architect note (32.x seam).
DROP (PC-B 5th agent, PC-A RATIFIED 2026-10-09): architecture.md 38.15. At the 2048 cap the CPU sim costs 0.08 ms and `particleLayer.build` 0.35 ms (Node, all slots live, 400x150). A GPU sim would need a GPU splat (18) or a readback, would cost ~1.5 d, and would lose the f64 `hashInto` determinism. Revisit 17+18 together when `PARTICLE_CAP` >= 8192 or `step + build` > 1 ms measured. Wrong seam noted: the oracle is the existing CPU sim `engine/fx/particles.js` (rule 16), not a new `engine/entities` file.

### S8-B2-18 Particle splat output module [P2, ~0.75 d, deps: S8-B2-17]
DROP (PC-B 5th agent, PC-A RATIFIED 2026-10-09): architecture.md 38.16. It depends on 17, which is dropped. No texture atomics exist, so it would need a packed-key `atomicMin` buffer plus a resolve pass. That loses the exact "fround depth, lower slot wins" parity, and saves at most 0.35 ms at the cap. Same revisit trigger as 17. (Facts: PART rgba8 / PART_Z r32float are CPU-uploaded by `particleLayer.js` today; consumer `WgSpritesPass` is B1.) Writes live particles into the PART / PART_Z layer textures so the existing sprites pass shows them.
- [ ] Probe test: depth-ordered nearest wins, out-of-grid skipped.
- [ ] B1 wiring row written (`NEEDS B1`); CPU particles unchanged by default.
Files: `wgsl/particleSplat.wgsl.js` (new), `wgsl/index.js` (append).

### S8-B2-19 DROP (until PO re-scopes): CLOTH-DRAPE-01 is done (f561e1d, stairwell balloon drape); cloth capsule/sphere/plane colliders exist (CLOTH-1a2, `engine/physics/cloth.js` + `engine/world/cloths.js`); there is no hero cape asset. A cape = designer asset + animated rig capsules per step = new story + note. CLOTH-DRAPE-01 collide with the body [P2, ~0.75 d, deps: none]
Cloth (cape/banner) collides with 2 capsules (torso + leg) and a ground plane.
- [ ] Node test: no vertex deeper than 2 cm inside any capsule over 600 steps of a walking pose.
- [ ] 0 alloc per step; capsule data passed in (no import of game). Owner look on the hero cape.
Files: engine cloth module (path to confirm in the story), tests.

### S8-B2-20 ME-20b horizon AO light-pass term [P2, ~1 d, deps: S8-B2-04]
NOTE WRITTEN: architecture.md 38.17 (PC-B 5th agent, PC-A RATIFIED 2026-10-09). Re-scoped to horizon AO only, ~0.6 d, one step:
- 4 taps on the existing `uDepth` binding.
- `LIGHT_BLOCK` word 31 `aoStrength`; the size stays 1280 B.
- It multiplies only the ambient share, as the last line, after 12a.
- Deps are now 12a (48ffaac), not B2-04.

Vertex AO cannot reach the GPU today: `buildMeshTriVertexData` throws on non-zero aux, so do not commit `--ao` meshes. It moves to the new ME-20c (needs a note). NEEDS B1: passLight word 31 upload, `?ao=` in main.js, gpucompare forces 0. Original text: Optional AO term in the light module from vertex AO plus a depth horizon sample (4 taps), strength default 0.
- [ ] Node probe: strength 0 bit-identical; 1 darkens concave corners, never brightens.
- [ ] gpucompare unchanged at default; owner look on tower interior. WGSL only; `NEEDS B1` uniform.
Files: `wgsl/light.wgsl.js`, `engine/render/lighting.js`.

## Lane C

Lane C (Codex): pure sim/data/view modules, Node tests, preview pages, tools. Never `engine/render`, `main.js`, `backlog.md`, `palette.js`. Anything needing main.js is a `NEEDS B1` row, pointing at the S8-B1 wiring story. Status goes to `docs/lanes/pc-c.md`.

### S8-C-01 DONE / DUP of US-089a (20a20b4, on master): `game/js/quest/save/saveState.js` + test, 3-slot storage + memory adapters, v1 migration. US-089a saveState collect/apply + storage adapter [P0, ~0.75 d, deps: none]
`game/js/quest/save/saveState.js`: collect/apply player pos/hearts/mana/inventory/hands/flags/chests/beasts, `saveVersion` + migrate, localStorage + in-memory adapters.
- [ ] Node: collect -> serialise -> apply -> collect is byte-identical; a v0 fixture migrates to current.
- [ ] Corrupt JSON / missing slot returns `null`, never throws.
Files: `game/js/quest/save/saveState.js` + test. Unblocks S8-B1-01. No owner look.

### S8-C-02 Save slots API (3 slots, label, delete) [P0, ~0.5 d, deps: S8-C-01]
Slot index/meta layer: `list()`, `write(i)`, `remove(i)`, label "Wick - place - play time" (D-013), play-time accumulator.
- [ ] Node: 3 slots independent; delete leaves the others; label text from meta only (no full load).
- [ ] Play time adds dt only while `tick(dt, playing)` is true.
Files: `game/js/quest/save/slots.js` + test. Feeds S8-C-03 and S8-B1-03.
ARCH: mostly DUP of US-089a (3 slots, isolated delete, name/place/play-time meta already in saveState.js). Remaining = the play-time accumulator only (~0.25 d), inside saveState.js or a tiny helper; no second slot layer.

### S8-C-03 US-090a PO fixes + backend flag [P0, ~0.25 d, deps: PO review of US-090a]
Apply PO review notes to `titleMenu.js`; preview must not hard-code `backend:'webgpu'` (arch note, Arc = webgl2 per D-048): take `?backend=`.
- [ ] Preview opens with `?backend=webgl2` and `webgpu`; Node nav test still green.
- [ ] Slot rows use S8-C-02 meta. Owner look (PO opus first review).
Files: `game/js/ui/titleMenu.js`, its preview page. NEEDS PC-A: PO verdict, S8-A-04 style, S8-A-12 labels.

### S8-C-04 Title menu extras: Settings sub-view + Credits [P1, ~0.75 d, deps: S8-C-03]
Pure view modules `settingsView.js` (quality, shadows, grid, volume, text size, reduce-motion flags) and `creditsView.js` (from `docs/licence-inventory.json`, StickyBizcuit line when used, OWN-REQ-013).
- [ ] Node: every setting round-trips through a plain options object; credits lists every inventory entry exactly once.
- [ ] Keyboard-only navigation works (arrows, Enter, Esc) in the preview page.
ARCH: a Settings panel already exists (`game/js/ui/settings.js` + test, GFX-01 Quality row); extend it rather than a parallel `settingsView.js`.
Files: `game/js/ui/settingsView.js`, `creditsView.js` + tests + preview. Persist = S8-B1-17. NEEDS PC-A: S8-A-05 (uiStyle.settings), S8-A-12.

### S8-C-05 Controls rebinding data + conflict check [P1, ~0.5 d, deps: S8-C-04]
`game/js/quest/input/bindings.js`: default bind table, rebind, conflict detection, serialise to settings.
- [ ] Node: rebind to a used key swaps or refuses (explicit result), reset restores defaults.
- [ ] Gamepad and keyboard tables are separate keys.
Files: `bindings.js` + test. NEEDS B1: main.js reads the table (not scheduled; keep the row).

### S8-C-06 US-092a chest sim + loot table [P1, ~0.75 d, deps: S8-C-01, S8-A-06 designer chest model]
`game/js/quest/sim/chest.js`: closed/opening/open states with a 0.6 s open timer, loot table (fixed + weighted, seeded), one hidden hillside chest in content.
- [ ] Node: opens once, grants once, state round-trips through the save; seeded loot same result twice.
- [ ] Interact range 1.6 m and facing check are data fields.
Files: `game/js/quest/sim/chest.js`, `content/chests/*.json` + test. Hook = S8-B1-04.
ARCH: reuse `game/js/quest/sim/loot.js` (`createLoot`, lootConfig) for the table; chest state saves through `collectSave({openedChests})`.

### S8-C-07 Item-get card view [P1, ~0.5 d, deps: S8-C-06, S8-A-07, S8-A-13]
`game/js/ui/itemGetCard.js`: pauses 1.5 s or until a key, icon + name + one line, queue when several arrive together.
- [ ] Node: timer, key-dismiss, queue order of 3 items; zero alloc per frame after warm-up.
- [ ] Preview page at 400x150. Owner look (PO opus first review).
Files: `game/js/ui/itemGetCard.js` + test + preview. Hook = S8-B1-04.

### S8-C-08 DUP (mostly): item defs live in `design/items.js` (`ASSETS.items`, icons) and the model in `game/js/quest/sim/inventory.js` (24 slots, add/remove/stack, `assignHand`, hash). A new `content/items/items.json` would be a dual source (`tools/content-no-dual-source.test.mjs`). Keep only missing fields (heal amount, stack cap) as edits there. Item database + inventory model [P1, ~0.75 d, deps: S8-A-13]
`content/items/items.json` + `game/js/quest/sim/inventory.js`: item defs (kind, stack, hand-slot, heal amount), add/remove/stack/cap.
- [ ] Node: stack cap, overflow returns remainder, equip into left/right hand, serialise.
- [ ] Content lint (S8-C-17) passes on the db; every item has an icon id and a name key.
Files: `content/items/items.json`, `inventory.js` + test.

### S8-C-09 DUP of US-091b: `game/js/quest/inventoryView.js` (+test) exists - `I` opens/closes, main.js pauses, style `ASSETS.uiStyle.inventory` (`design/models/inventory_ui.js`). Only gaps vs the ACs below, if any. Inventory screen view module [P1, ~1 d, deps: S8-C-08, S8-A-05, S8-A-07]
`game/js/ui/inventoryView.js`: grid list of items, selection, equip to hands, detail line, empty state.
- [ ] Node: navigation wraps, equip swaps hands, 0 alloc per frame.
- [ ] Preview page with a 12-item fixture. Owner look.
Files: `inventoryView.js` + test + preview. NEEDS B1: open key + pause (S8-B1 row to add).

### S8-C-10 Crafting recipe data + sim [P2, ~0.5 d, deps: S8-C-08]
`content/items/recipes.json` + `crafting.js`: inputs -> output, can-craft check, consume atomically.
- [ ] Node: partial inventory refuses and changes nothing; success consumes exactly the inputs.
- [ ] Recipe ids reference existing items (lint rule).
Files: `crafting.js`, `recipes.json` + test. Not in the M1 slice; data only.

### S8-C-11 DONE / DUP of US-096a (24ec1d0, on master): `game/js/quest/sim/quest.js` + `content/quests/m1.quest.json`, 600-step hash; only the S8-A-11 texts remain (data edit). US-096a quest sim + M1 chain [P0, ~0.75 d, deps: S8-A-11 objective texts]
`game/js/quest/sim/quest.js` + `content/quests/m1.quest.json`: wake -> lantern -> breach -> sword -> 2 beasts -> waystone driven by events; serialisable.
- [ ] Node: scripted events complete the chain; out-of-order events ignored; 600-step replay hash stable.
- [ ] State round-trips via S8-C-01. Unblocks S8-B1-02.
Files: `quest.js`, `m1.quest.json` + test.

### S8-C-12 Quest log / objective HUD view [P1, ~0.5 d, deps: S8-C-11]
`game/js/ui/questLog.js`: current objective line (one line for the HUD slot) + log list of done/active.
- [ ] Node: text switches on state change, long text truncates to the slot width with an ellipsis.
- [ ] Preview page with the M1 chain stepped by buttons.
Files: `questLog.js` + test + preview.

### S8-C-13 M3 quest content: breach and sword beats [P1, ~0.5 d, deps: S8-C-11, S8-A-11]
Add flags, triggers and area ids for the breach/sword beats as data; no code beyond the data loader.
- [ ] Content lint (S8-C-17) green; every trigger area id exists in the world JSON.
- [ ] Node: chain test extended to the M3 branch.
Files: `content/quests/*.json`, loader test. Placement of triggers is a world edit via the editor (note in row).

### S8-C-14 MAP-01c chart card module [P1, ~1 d, deps: MAP-01a/b done]
`game/js/quest/mapCard.js`: draws the baked chart, player arrow from live x/y/yaw, waystone/relay markers, `M`/Esc state machine.
- [ ] Node: zero alloc per frame; arrow position math for 4 yaws; toggle state machine.
- [ ] Real-GPU screenshot at 400x150 via the dev harness. Owner look. Wiring = S8-B1-15.
Files: `mapCard.js` + test only.
ARCH: `game/js/quest/mapCard.js` already exists and is mounted (first-show card, `M` edge in main.js); extend it, keep `initMapCard/stepMapCard/isMapOpen/getMapPanel` stable or write `NEEDS B1` (S8-B1-15).

### S8-C-15 MAP-01d fog mask + pencil route [P1, ~1 d, deps: S8-C-14, S8-C-01]
Explored mask (coarse grid), "NOTHING" blank paper, pencil route polyline (decimated), serialise as bytes.
- [ ] Node: mask grows when cells are fed; route decimation keeps <= 256 points; byte-stable save round trip.
- [ ] Screenshot with 100 m of walk in the harness. Owner look. Wiring = S8-B1-16.
Files: `mapCard.js` (+ `mapFog.js`) + test.

### S8-C-16 ED-MESH-01g scale field with validation [P1, ~0.5 d, deps: B2 MESH-SCALE-01]
Editor property field + keys for uniform scale (snap 0.05), clamp to 0.25..4 before `placeMesh`, round-trip in world JSON.
- [ ] Node: 0.1 and 9 are refused with a message, 1.37 snaps to 1.35; save/load keeps scale.
- [ ] Undo restores the old scale (see S8-C-18).
Files: `tools/editor/*` + test. If MESH-SCALE-01 is not landed, stop and write `NEEDS B2`.
ARCH: MESH-SCALE-01 = ARCH OK 73ddef1 on pc-b2, not yet on master (wait for the merge). `World.placeMesh` does not clamp - the editor validates (batch 7). Reuse `tools/editor/scale.js` (ED-SCALE-1c prop scale validator).

### S8-C-17 Content lint + validate-content rules [P1, ~0.75 d, deps: none]
`tools/lint-content.mjs`: checks ids unique, references resolve (items, quests, chests, meshes, areas), required text keys present; exit 1 on error.
- [ ] Node test with fixtures per rule (broken ref, duplicate id, missing name).
- [ ] Run on `content/` and `design/` today; findings pasted into the row, fixed or filed.
Files: `tools/lint-content.mjs` + test; added to `run-tests.mjs` list only if the owner OKs the runtime.
ARCH: partial DUP - `tools/validate-content.mjs` (`validateContent`, `validateMeshFiles`, `validateMaskFiles` + test) already exists; add the new rules there, no second linter.

### S8-C-18 Editor undo/redo coverage test [P1, ~0.5 d, deps: none]
Table-driven test that every editor command (place, move, delete, scale, light edit, terrain stamp, group) undoes and redoes to an identical world JSON.
- [ ] One test row per command; failures listed by name.
- [ ] Redo stack clears on a new edit; 200-op random walk ends equal to the start after 200 undos.
Files: `tools/editor/*.test.js`. Fixes go to the owning module (editor only).

### S8-C-19 DONE: ED-TERRAIN-1c shipped in sprint 6 (backlog handoff "ED-TERRAIN-1c (editor terrain brush)", `tools/editor/terrainBrush.js` + test). Only file gaps vs the ACs below as a bug row. ED-TERRAIN-1c terrain UI [P1, ~1 d, deps: ED-TERRAIN-1a/b done]
Editor panel: brush raise/lower/smooth/flatten, radius, strength, material paint; one stroke = one undo step.
- [ ] Node: stroke on a fixture heightmap changes only cells in radius; undo restores it bit-exact.
- [ ] Brush radius 1..16 and strength are clamped; save/load round trip.
Files: `tools/editor/terrain*.js`, `panel.js` section + test. Owner look at the walk-through.

### S8-C-20 SPLIT: C-20a BUG-RTS-002 (DONE 150ccf5) + BUG-ED-VOX-1 [~0.25 d, no deps]; C-20b ED-GROUP-1c prefab UI [~0.75 d, deps: PREFAB-SEAM (B1), architecture.md 38.11]
Prefab save/place panel (group selection -> `.prefab.json` -> place instance) and the two dev-page bugs: fix BUG-RTS-002 and BUG-ED-VOX-1 per their backlog rows.
- [ ] Node: group -> prefab -> place twice gives two independent instances; undo removes one.
- [ ] Both bug rows have a Node or capture check named in the row and pass.
Files: `tools/editor/*`, `game/js/dev/` page files. Do the two bugs first (0.25 d) if the seam is late; prefab part waits.
ARCH: size not honest at 1 d (prefab UI + 2 bugs); split into C-20a (BUG-RTS-002 + BUG-ED-VOX-1, both already in lane C queue add 4) and C-20b (prefab UI after S8-A-02). Seam today: `engine/content/loadPack.js` `KNOWN_KINDS = ['level','world','mesh','terrainEdits','mask']` - no `prefab`.
NOTE WRITTEN: architecture.md 38.11

## PC-A

PC-A has no programmer. Each row is one role's work (<= 1 day). Tag = who does it. Sprint 8 is the plan; archive and merge routine only after the gates.

### S8-A-01 [architect, opus] Tech notes for B1 render/GPU stories [P0, ~0.5 d, deps: none]
Short notes (architecture.md 38.x) before dev for S8-B1-05, 06, 07, 10, 11, 12 (version counter, batch release, timestamp query ring, device-lost, bind-group cache, resize).
- [ ] One section per ID with invariants, seams and the test the programmer must write.
- [ ] Stories for which no note is needed are listed (B1-01..04, 08, 09, 13..20).
ARCH 2026-10-08: corrected list = notes for B1-06, 09, 10 only (05 DONE; 07 timer exists, 38.7 covers it; 11/12 verify-first stories, 38.8a(17) covers them).
NOTE WRITTEN: architecture.md 38.10

### S8-A-02 [architect, opus] Seam notes: `prefab` kind in loadPack + MESH-SCALE-01 [P0, ~0.5 d, deps: none]
Unblocks S8-C-20 and S8-C-16: where the `prefab` kind lives (engine/content/loadPack.js), data shape, who owns it (B1 or B2), and the scale field path through placeMesh and colliders.
- [ ] Note + named owner lane for each; story rows added to the B1/B2 lists by the main session.
ARCH 2026-10-08: MESH-SCALE-01 half is done (73ddef1 ARCH OK, pc-b2); this row = `prefab` kind only (~0.25 d).
NOTE WRITTEN: architecture.md 38.11

### S8-A-03 [architect, opus] Tech notes for B2 stories [P1, ~0.75 d, deps: none]
Notes for S8-B2-03 (LRU), 04 (AO), 06/07 (wind sway, dither), 08 (flicker slot in the 1264 B light block), 10 (HZB occlusion), 13 (ripple), 17/18 (particle kernel seam, 32.x), 19 (cloth path).
- [ ] One section per ID, uniform slot offsets stated, gpucompare rows that must stay unchanged named.
- [ ] Stories that can start without a note are listed (B2-01, 02, 05, 09, 11, 14, 15, 16).
ARCH 2026-10-08: corrected list = notes for B2-03, 04, 05 (small), 06, 07, 10 (fable), 12 (small), 13, 17, 18, 20; 08 DUP, 19 DROP. No note: 01, 02, 09, 11, 14, 15, 16. Realistic size ~1.5 d -> split into two rows (render-core 06/07/10 first).

### S8-A-04 [designer] Title menu style (uiStyle.menu) [P0, ~0.75 d, deps: none]
Style tokens and a preview page for the title menu card: palette, border glyphs, selected-row look, disabled Continue, slot rows. For S8-C-03 and S8-B1-03.
- [ ] `design/preview/title-menu-style.html` at 400x150 grid; 2 sizes tested.
- [ ] Palette uses existing `design/palette.js` ids (no new hot-file edits without the main session).
Owner look.

### S8-A-05 [designer] uiStyle.settings and inventory panel style [P1, ~0.75 d, deps: S8-A-04]
ARCH: inventory half partly DUP - `uiStyle.inventory` exists (`design/models/inventory_ui.js`, US-091b); only the settings controls are new. Style for the settings list (slider, toggle, select) and the inventory grid (cell, selected, equipped mark, detail line).
- [ ] Preview page showing each control in 3 states (normal, focus, disabled).
- [ ] Tokens named so S8-C-04 and S8-C-09 read them without code changes.
Owner look.

### S8-A-06 [designer] Chest model + 0.6 s open clip [P1, ~1 d, deps: none]
Voxel or mesh chest (closed/open), 0.6 s lid animation, glow when closed-with-loot, fits a 1.6 m interact range. Preview page with the clip.
- [ ] Model + clip frames in `design/models/chest.js`, registered per design README.
- [ ] Preview shows closed, mid-open, open at two distances.
Owner look. Unblocks S8-C-06, S8-B1-04.

### S8-A-07 [designer] Item icons + item-get card style [P1, ~1 d, deps: S8-A-13 item list]
12 icons (sword, shield, lantern, potion, key, bow, bomb, heart piece, rupee-equivalent, 3 materials) at 5x3 cells, and the card frame (title bar, glow).
- [ ] Preview page grid of icons at 1x and 2x; each readable in a 1-colour fallback.
- [ ] Icon ids match `items.json` (S8-C-08).
Owner look.

### S8-A-08 [designer] M1 props set [P1, ~1 d, deps: none]
Waystone variants, lantern post, breach rubble, sword pedestal; each with a collider note and a preview.
- [ ] 4 props in `design/models/`, each <= the voxel budget in the style guide.
- [ ] Preview page at day and night light. Owner look.

### S8-A-09 [designer] TREES-LP-d low-poly trees pass [P1, ~1 d, deps: none]
Finish the low-poly tree set (see TREES-LP rows, `design/models/cubecloud_trees.js` in the tree): 3 species, 2 sizes, tri budget per validate-mesh (S8-B2-02), sway-ready trunk base.
- [ ] Preview page comparing old and new trees at 3 distances; tri counts listed.
- [ ] No registry change without the owner's pick (no silent asset changes).
Owner look.

### S8-A-10 [designer] ART-02..05 look sheets [P2, ~1 d, deps: none]
One look sheet each for ART-02, 03, 04, 05 with before/after captures from the current renderer (see backlog rows for their scopes).
- [ ] One HTML sheet per ART ID, 3 poses each, notes on what the engine must still provide.
- [ ] Owner picks per sheet; outcome recorded in the row.

### S8-A-11 [writer] Objective and quest texts for M1/M3 [P0, ~0.5 d, deps: none]
Objective lines for wake -> lantern -> breach -> sword -> 2 beasts -> waystone, each <= 38 chars (HUD slot), plus completion line and one hint line each. Canon: game-design section 3.
- [ ] Text in `docs/story.md`, keyed by objective id; the lengths checked.
- [ ] Unblocks S8-C-11 and S8-C-13.

### S8-A-12 [writer] Title / settings / credits labels [P1, ~0.25 d, deps: none]
Labels for New, Continue, slots, delete-confirm, settings names, credits header, "Press Enter".
- [ ] One flat key list in `docs/story.md`, each <= 20 chars unless marked.
- [ ] Unblocks S8-C-03/04.

### S8-A-13 [writer] Item names and lines + NPC/scrawl set [P1, ~0.75 d, deps: none]
12 item names (<= 14 chars) with one-line descriptions (<= 38 chars), the hidden-chest scrawl, 3 NPC/scrawl lines for the M1 area.
- [ ] Keys match S8-C-08 ids; list given to the designer first (S8-A-07).
- [ ] Lore stays inside canon (game-design section 3).

### S8-A-14 [PO] PO OK reviews batch: US-090a and C modules [P0, ~0.5 d, deps: S8-C-03]
First review of title menu (opus), then S8-C-01, 02, 11 as batch PO OK against ACs.
- [ ] One verdict per story in the lane file / backlog row; rejects listed with exact missing items.
- [ ] Statuses updated by the main session.

### S8-A-15 [PO] Sprint 8 review + "missing to be playable" list [P0, ~0.5 d, deps: end of sprint]
Summary in `docs/sprints/sprint-8.md`: done / not done / bugs, and the gap list of what still stops a first full playthrough (save, quest, chest, map, title).
- [ ] Gap list ordered by what the owner hits first.
- [ ] Owner walk-test requested.

### S8-A-16 [PO] Owner walk-test checklist (sprint 8) [P1, ~0.25 d, deps: none]
Step list, each with expected result: boot, title, new game, walk roadSouth, chest, quest line, save, reload, map, F3 numbers on the 4060.
- [ ] 15 steps or fewer, each pass/fail checkable. In `docs/sprints/sprint-8.md`.

### S8-A-17 [PO + manager] Backlog triage decisions [P1, ~0.5 d, deps: `docs/backlog-triage-sheet.md`]
Apply owner answers on the triage sheet: each open row becomes keep / cut / defer with a reason; produce the archive list for the janitor.
- [ ] Every row in the sheet has a decision. Cuts listed in one place.
- [ ] Owner open questions summarised in <= 10 lines.

### S8-A-18 [manager] Decisions: WG-5 timing, Steam/release, scope cut list [P0, ~0.5 d, deps: S8-B1-19 plan]
New D-xxx entries: (1) when WebGL2 is deleted (before or after WG-4c walk; D-048 Arc risk), (2) release target (itch demo only vs Steam) and the licence blocker (Ruins redistribution, D-046 revisit), (3) scope cuts for M4.
- [ ] Each decision has a date, options considered and the answer, in `docs/decisions.md`.
- [ ] `docs/roadmap.md` updated to match.

### S8-A-19 [main session] Gates: WG-4c walk + per-preset gpucompare + perf table [P0, ~1 d, deps: S8-B1-05, 13, 14]
Run the WG-4c full-detail walk with the owner; gpucompare for Low/Med/High/Ultra on both backends; one perf table (p50/p95 per preset per backend).
- [ ] Table in `docs/test-reports/` with the numbers and the MESH-PERF-01 bar verdict.
- [ ] Known-FAIL list unchanged (D-039) or the change explained.

### S8-A-20 [main session + janitor] `pc-a-merge-master` skill + archive and dead-code report [P1, ~0.75 d, deps: S8-A-17]
Write `.claude/skills/pc-a-merge-master/SKILL.md` (merge pc-b/pc-c + pc-a, run-tests, check-deps, gpucompare, push). Janitor: archive done/cut rows to `docs/backlog-archive.md` after S8-A-17, and report dead code / unused exports.
- [ ] Skill lists the exact commands and the order; used once for the next merge.
- [ ] Backlog under ~150 KB; dead-code report lists files only (no edits).

### PREFAB-SEAM (new, lane B1) [P1, ~0.25 d, deps: none; note architecture.md 38.11]
`prefab` kind: `schema.js`, NEW pure `engine/content/prefabFile.js` (`prefabFromJSON`, `placePrefabItems`), `loadPack.js` KNOWN_KINDS + `bundle.prefabs`; prefab ids lowercase_underscore (37.11 example becomes `crate_corner`). Tests: 3 files per 38.11. Unblocks S8-C-20b. Engine never writes files; placing a prefab = one undo step.

### DEVICE-LOST-2 (backlog idea, not scheduled) [P2, > 1 d]
Rebuild every GPU resource owner in place after `device.lost` (list in architecture.md 38.10c); needs a renderer-swap seam. Only if the reload-card version proves annoying.

### LEAF-PREVIEW-01 (new, lane C) [P1, ~0.5 d, deps: ALPHA-01c/01d on pc-b]
Standalone leaf-fixture preview page for the owner (see docs/lanes/pc-c.md QUEUE TOP). AC: page opens on webgpu, soft-edge toggle, one real-GPU screenshot in the report; no engine or main.js edits.

## Playable-loop additions (PO, D-050)

Seam = `game/js/gameHooks.js` from S8-B1-01 (`onBoot`, `onTick(dt)`, `onEvent(name,data)` with `area:entered`/`prop:touched`/`beast:died`/`item:got`/`player:died`/`flag:set`, `drawHud(cells)`, `onRespawn`). Lane C owns `game/js/quest/wire/**` and never edits main.js, engine or the seam; a missing hook point = `NEEDS B1:`. Supersedes the B1 hook parts of S8-B1-02 and S8-B1-04 (B1 keeps S8-B1-01/03). Order for C: WAYSTONE-01 -> after seam lands: WAYSTONE-01w, S8-C-HOOK-QUEST, S8-C-HOOK-CHEST.

### WAYSTONE-01 sim: save point, heal, respawn [P0, lane C, ~0.5 d, deps: US-089a saveState.js, vitals]
Pure sim, no main.js. Touching a waystone = autosave request + heal to full + sets the respawn point; death respawns at the last waystone.
- [ ] Node test: `touch(id)` sets hearts to max, stores `{waystoneId, pos}`; `onDeath()` returns that pos + full hearts; with no waystone touched it returns the spawn point.
- [ ] Node test: state is plain JSON, round-trips via `collectSave`/`applySave` byte-stable; same input sequence gives the same state (no Date/Math.random).
Files: `game/js/quest/sim/waystone.js` + `waystone.test.js`. No owner look.

### WAYSTONE-01w wire: waystone on the seam [P0, lane C, ~0.5 d, deps: WAYSTONE-01, S8-B1-01 seam, S8-A-08 waystone prop]
Register on the seam: `prop:touched` (waystone) -> sim touch + save request + HUD toast; `player:died` -> sim respawn; `onRespawn` returns the point.
- [ ] Node test with a fake seam: touch event heals, requests one save, queues one toast; death event respawns at that waystone.
- [ ] Headless capture: touch a waystone, take damage, die, respawn on the stone with full hearts; toast visible in `drawHud`. Toast text from `docs/story.md` '## Sprint 8 texts' (`place.waystone` as title, done line `The stone hums. The signal answers.`). If no dedicated toast key exists: `NEEDS WRITER:` one line <= 38 chars, do not invent.
Files: `game/js/quest/wire/waystone.js` + test. Owner look. NEEDS B1: gameHooks seam (S8-B1-01).

### S8-C-HOOK-QUEST objective line + quest log wiring (replaces S8-B1-02 hook) [P0, lane C, ~0.5 d, deps: S8-B1-01 seam, US-096a quest.js, S8-A-11 texts in m1.quest.json]
Feed seam events (`beast:died`, `item:got`, `area:entered`, `flag:set`) into quest.js; show the current objective text in the HUD slot via `drawHud`; quest state saved.
- [ ] Node test with a fake seam: scripted event sequence advances wake -> waystone to done; HUD line equals the story.md text for each step.
- [ ] Quest state is in the save (round trip via saveState) and survives reload (headless capture).
- [ ] questLog (S8-C-12 view, if landed) opens from the seam input event; else leave a `NEEDS B1:` note for the key binding.
Files: `game/js/quest/wire/quest.js` + test. Owner look. NEEDS B1: gameHooks seam.

### S8-C-HOOK-CHEST DROPPED 2026-10-09 (B1 built S8-B1-04 = game/js/chestHook.js; chest content/placement + first-chest reward stay C/owner). Old title: chest + item-get card wiring (replaces S8-B1-04 hook) [P1, lane C, ~0.5 d, deps: S8-B1-01 seam, S8-C-06 chest sim, S8-C-07 item-get card, S8-A-06/07 designer assets]
On `prop:touched` for a chest: sim open once, item into inventory, item-get card via `drawHud`, chest opened flag saved.
- [ ] Node test with a fake seam: chest opens once, item added once, a second touch does nothing, state persisted.
- [ ] Headless capture of the item-get card at 400x150; reload keeps the chest open. Owner look.
Files: `game/js/quest/wire/chest.js` + test. NEEDS B1: gameHooks seam (open-clip trigger via event if the seam lacks it).

### SEAM-REVIEW gameHooks seam diff review [P0, architect (opus), ~0.25 d, deps: S8-B1-01 landed]
Diff-only review of the S8-B1-01 commit's `game/js/gameHooks.js` and its call points in main.js. Short verdict.
- [ ] `ARCH OK`/`ARCH CHANGES`: the six events, `onTick`, `drawHud`, `onRespawn` are called at fixed points; handler errors cannot break the frame; wire modules can register without touching main.js.
- [ ] Confirms lane C can build WAYSTONE-01w, S8-C-HOOK-QUEST, S8-C-HOOK-CHEST on it unchanged; missing hook points listed for B1. Gates the three wire stories.
Files: read-only. No owner look.

## Quest markers + chain v2 (owner idea 2026-10-08, PC-A)
Owner: WoW-style golden 3D '!' above the active quest note; note 1 "find something to defend yourself in the wild" -> take the sword; a second note on the way up "kill 5 boars"; after the 5th boar the next '!' is on the waystone. Today `content/quests/m1.quest.json` has wake -> lantern -> breach -> sword -> beasts (2: boar1, boar2) -> waystone; world_m1 has only 2 boars.
### QUEST-MARK-01 asset [designer, IN PROGRESS 2026-10-08]
`design/models/quest_mark.js`: `questMark` (gold '!'), `questMarkTurnIn` (gold '?', later), `ASSETS.questMarkFx` {floatM 0.35, bobM 0.08, spin 0.5 rev/s, popMs 300, fadeMs 250, visibleRangeM 40}, clips idle/pop/fade, preview design/preview/quest-mark.html.
**MARKER RULE (owner 2026-10-08): the '!' shows over a quest that is AVAILABLE and disappears the moment the player TAKES it (reads the note / touches the giver), not when the step is completed.** After taking, the HUD objective line carries the step; the next '!' appears only when the next quest becomes available (note2 after the sword is taken; the waystone '!' after the 5th boar dies). Optional later: gold '?' (`questMarkTurnIn`) at a turn-in target.
### QUEST-CHAIN-02 sim + content [lane C, ~0.75 d, deps: none for sim; NEEDS PC-A decision on boar count]
(1) m1.quest.json: new objective `note1` "Read the note: find something to defend yourself" (flag/prop touch) before `sword`; `note2` (second note on the way up) before `beasts`; `beasts` count 2 -> 5 with boar ids boar1..boar5; waystone last. (2) `game/js/quest/sim/questMarkers.js` (+ Node test): `markerTargets()` returns the id(s) of the prop/area that carry a '!' = quests AVAILABLE and NOT YET TAKEN (note1 until read; sword step has no marker once note1 is taken, the sword is its own pickup; note2 once the sword is taken, until read; beasts: none; waystone '!' once the 5th boar died, until touched); a taken quest never shows a marker; deterministic, save-safe, zero alloc per step. (3) content: 3 more boars (boar3..5) with home positions on the hillside path in world_m1.world.json (shared file: ask PC-A for the coordinates or propose them in the log), second note decal/prop `note2` text from the writer. Owner look: boar count/placement and note text.
### QUEST-MARK-01w wire [lane C via gameHooks seam, ~0.5 d, deps: seam ARCH OK (B1), QUEST-MARK-01, QUEST-CHAIN-02]
`game/js/quest/wire/questMarks.js` on `onBoot/onTick/onEvent(flag:set|item:got|beast:died|prop:touched)`: spawn/hide `questMark` voxel entities (`components.voxel.hidden` seam, US-079b0) at `markerTargets()` anchors, play pop on appear and fade on TAKE (`prop:touched` / `flag:set` quest-taken), cull beyond visibleRangeM. No main.js/engine edits (NEEDS B1 line if a hook point is missing). Owner look: marker readable at 3 m and 12 m, disappears the moment the quest is taken.
### QUEST-TEXT-02 [writer, ~0.25 d]
Texts for note1, note2 ("kill 5 boars" in canon voice), objective lines for `note1/note2/beasts(5)`, HUD <= 38 chars. Append to docs/story.md '## Sprint 8 texts'.

## Emissive lighting (owner ask 2026-10-08)
Owner: glowing voxels (chest glint, quest '!', lamps, signal relay, embers, runes) light their surroundings; nicest look at good speed. Design: architecture.md 38.12 (derived point lights: DO first; bleed pass: High/Ultra; halo in edge: High/Ultra; Low = material self-emissive only; all three forced off in every `?gpucompare=` mode). Order: owner sees derived lights first, bleed/halo after picking a strength in EMIS-00.
### EMIS-00 strength mockups [designer, ~0.5 d, deps: none]
`design/preview/emissive.html`: night scene with the '!' at 3 m and 12 m, a lamp, embers; weak / medium / strong (`bleedGain`, `haloBg`, `glyphRamps.halo`). Owner picks one.
### EMIS-01a derive emissive lights [lane B1, ~0.75 d, deps: none]
`engine/voxel/emissiveLight.js` (pure `deriveEmissiveLight`), stored on the packed model, def override `light: {preset} | false`, flicker from the material. Node tests (38.12 (1)). Ends in arch-review.
### EMIS-01b LightSet derived pool + feed [lane B1, ~0.75 d, deps: EMIS-01a]
`LightSet.beginDerived/offerDerived/endDerived` (ranking, 1.25x hysteresis, zero alloc), voxel-pool feed (root pose), `gfxPresets` knob `emissive`, forced off under `?gpucompare=`. Tests + bench row. Ends in arch-review.
### EMIS-02 gate + perf, owner shot [PC-A, ~0.25 d, deps: EMIS-01b]
gpucompare rows unchanged; perf table derived on/off (Arc 400x150 High); slot swaps per minute on the m1 route; night owner shot of the '!' and a lamp.
### EMIS-03a bleed plumbing + JS twin [lane B1, ~0.5 d, deps: EMIS-00 pick]
MatF `GLOW` column, `rt.emissive` flags + presets, `PASS_NAMES += 'bleed'` + frame timer slot move, `engine/render/bleed.js` `bleedCell` twin + tests.
### EMIS-03b bleed WGSL pass [lane B2, ~1 d, deps: EMIS-03a]
`wgsl/bleed.wgsl.js` (H+V, depth-aware, sky halo in .a) + `wg/passBleed.js`, shade binding 16 adds `texBleed.rgb * bleedGain` to Lc. WGSL string tests. Ends in arch-review.
### EMIS-04 halo in edge [lane B2, ~0.5 d, deps: EMIS-03b]
edge.wgsl.js + edgePass.js twin: bg lift + `glyphRamps.halo` on space cells only. Ends in arch-review.
### EMIS-05 compare rows + perf table [PC-A, ~0.25 d, deps: EMIS-04]
`?gpucompare=emissive` rows, perf table High 400x150 / Ultra 480x180 (target < 1 ms total), Low 240x90 night readability check (fallback: 1-cell halo at Low).

### EMIS owner picks (2026-10-08)
Strength = MEDIUM (lightGain 0.8, bleedGain 1.2, haloBg 0.45, haloMin 0.08, haloR 3, ramp ` .':`; designer: haloR >= 3 or the '!' gets no halo at 12 m). Glow hue = warm orange-gold (a little orange): approves `materials[k].glowColor` (small palette edit, append-only; e.g. emberHot/brassLight family). Owner wants the WHOLE quest '!' glowing (white-gold with a little orange), NOT a dark silhouette: QUEST-MARK rework (dark iron outline removed or one faint warm-dark rim voxel; whole glyph emissive). Still open for the owner: derived light off for chests/hook lamp?; wick/coal voxels for lamp+brazier?; bleed reach.

### BUG-WEBGPU-EYELID-01 (owner walk-test 2026-10-08) [B1, P1, ~0.25 d]
Owner on `game/index.html?backend=webgpu` (master): the wake-up eyelid blink is NOT visible (WebGL2 shows it). Cause (confirmed by code read): `drawEyelid(rt, uiStyle, open)` (game/js/quest/wake.js:79, called main.js:1396) writes CPU cells into `rt.cells`, but with `frameComplete` the WebGPU presenter shows the sprite-pass output (rt.setPresentCells, WgCellPipeline.js:9-10/125), so CPU scene-cell writes are never shown. Fix: draw the eyelid through the path the GPU frame DOES present (the engine ui/overlay layer, same as the editor help overlay fix, or a tiny eyelid overlay pass), keep the WebGL2 result identical. AC: Node test for the eyelid cells on the ui layer; headless capture at t=0.3 s on both backends shows the lid; owner look.
### BOOT-SPEED-01 (owner 2026-10-08: "slow, already taking 3 sec") [B1, P1]
WebGPU boot takes ~3 s before the first frame: expected cause = synchronous pipeline compile (~25 pass constructors). This is S8-B1-09 (architecture.md 38.10b: compile batch + loading card, boot waits on all promises, log per-pipeline ms). Raise it to the top of B1's post-hook list; first step: a boot-time breakdown (`performance.now()` marks: adapter, device, each pass constructor, content load, mesh load, first frame) printed to the console and F3 so the 3 s is measured, then 09a/09b.

### Owner to-dos after PO batch 2 (2026-10-09)
1. Window fit: normal Chrome window, quality high 400x150 + 480x180, then medium and low: hearts + top-left objective visible (BUG-HUD-OFFSCREEN-01); WebGPU wake-up blink visible (EYELID); reload after wake + Esc on a note.
2. Pop check: `?at=1446.63,1024.64,2.02,227,1` and `?at=1448.31,1026.52,2.08,229,3` (z = feet): dead tree + rock drawn at both, no popping on a 2 m step (BUG-MESH-MISSING-01); webgl2 `waystoneLookBack` known-FAIL ruling is PC-A's.
3. Leaves: `game/leaf-preview.html?backend=webgpu` look, and PICK LOD1 in `design/preview/lod1-trees.html` (unblocks QUAT-LOD-01 + species switch; forest still voxel until ALPHA-01f).
4. Map: open `game/js/quest/mapCard.preview.html` and `?fog=1`: chart readable, arrow ok; decide fog scale (100 m = ~5 glyphs: accept or ask for zoom/larger reveal). Not in the game until S8-B1-15/16.
5. Title menu + item card + credits + quest log previews (WebGPU and Arc webgl2); confirm-screen frame loss LOOK RISK.
6. RECIPES-01 quantities (torch/shield/bow); data only. PC-A decisions owed: settings shadows, boar roster/chest/spawn anchors, breach trigger = marker proximity via AREAS-01 (PO proposal, B1 hook).
7. Not walkable yet: waystone, quest markers, chests/card, bindings, crafting, map keys (wiring by B1 after gameHooks ARCH OK); boot time + lazy mesh unmeasured. pc-b/pc-b2 merge waits on D-039/D-051 known-FAIL records.

## PC-B fill 2026-10-09 (PO)
Verified before writing: seam `game/js/gameHooks.js` exists (drawHud/onRespawn/player:died called in main.js); `sim/waystone.js`, `chest.js`, `questMarkers.js`, `quest.js` sims exist, but `game/js/quest/wire/` is EMPTY (no WAYSTONE-01w, S8-C-HOOK-QUEST/CHEST, QUEST-MARK-01w yet) -> waystone heal/respawn, objective line, chest wiring are lane C wire work (`NEEDS C`), not B1. Slice-1 content (river widen, bridge placement, valley layout) waits on owner approval of `design/levels/valley_layout.md`; only the engine-side rules are queued here. All stories <= ~0.75 d, each ends in `arch-review` (engine) or `po-review` (UI), Node tests first.

### Slot kestrel-1 (main.js hooks)
**PBF-K1-01 Wire registry in main.js [P0, ~0.25 d, deps: seam]** Lane C wire modules (`game/js/quest/wire/*.js`) need a registration point so C never touches main.js.
- [ ] `game/js/quest/wire/index.js` manifest (array of `{id, src}`) + main.js loads it and calls `gameHooks.register` per module, in order; a missing/throwing module logs once and boot continues.
- [ ] Node test (`gameHooks.test.js` or `wireRegistry.test.js`): 3 fake modules register in order; one that throws in `onBoot` is skipped and the other two still get `onTick`.
- [ ] `?wire=0` skips all wire modules (for gpucompare/capture). Empty manifest = today's behaviour byte-identical.
Files: `game/js/main.js` (one block), `game/js/quest/wire/index.js`, test. Unblocks WAYSTONE-01w, S8-C-HOOK-QUEST/CHEST, QUEST-MARK-01w (all lane C; waystone sim already on master). NEEDS C: those wire modules.

**PBF-K1-02 BUG-WEBGPU-EYELID-01 fix [P1, ~0.5 d, deps: none; spec = the BUG row above]** Eyelid invisible under WebGPU because `drawEyelid` writes `rt.cells` (wake.js:79, main.js ~1396).
- [ ] Eyelid drawn through the presented path (ui/overlay layer) on both backends; WebGL2 result identical (cell-for-cell Node test of the eyelid cells on the ui layer at t=0.0/0.3/0.6 s).
- [ ] Headless `capture-browser` at t=0.3 s on `?backend=webgpu` shows the lid rows (screenshot path in the lane file). Engine part (overlay API) = kestrel-2 PBF-K2-02; K1 does the main.js call.
Files: `game/js/quest/wake.js`, `game/js/main.js`. Ends in po-review (owner look). Order: after PBF-K2-02 lands the overlay hook, else take the ui-layer route if it already exists (check `engine/ui`).

**PBF-K1-03 Beast level badge HUD [P1, ~0.5 d, deps: D-052 item 3, seam drawHud]** Fixed beast levels per zone, shown near the beast health bar.
- [ ] `beastConfig.js`: `level` per beast def (boar = 2, data only, default 1); `hudBadge.js` (pure): `badgeText(level)` -> `Lv N` and a tier colour key (<=2 plain, 3-5 yellow, 6-10 red; colours from existing palette keys, no new palette entries).
- [ ] Badge drawn beside the target health bar via `gameHooks.drawHud` or the existing bar draw; hidden when no target; no per-frame allocation (Node test with a counter).
- [ ] Node test: badge text/colour for levels 1, 2, 5, 6, 10, missing level.
Files: `game/js/quest/hudBadge.js` + test, `beastConfig.js`, one call in main.js/seam. Owner look (po-review, opus PO). Not blocked on any owner decision (badge chosen over tier-colour-only; colour tiers are a data table the owner can retune).

**PBF-K1-04 Desktop/Electron boot fixes [P1, ~0.5 d, deps: none; sprint-7 look risk 6]** Electron boot shows the browser "file" notice and starts at 160x60.
- [ ] Notice shown only when `location.protocol === 'file:'` in a non-Electron UA; Electron (detect `process.versions.electron` or UA `Electron/`) never shows it. Pure `bootEnv.js` + Node test over 4 UA/protocol combos.
- [ ] Start grid = the saved/auto preset (same rule as the browser: GFX preset from settings or the detected tier), never a hard 160x60; Node test of the pick function.
- [ ] Headless check in a plain browser unchanged (screenshot at 400x150).
Files: `game/js/bootEnv.js` + test, `game/js/main.js` (one call), Electron wrapper file only if it sets the size (find via grep `160`). No owner decision needed.

**PBF-K1-05 PICK-UP / touch events for the seam [P1, ~0.25 d, deps: PBF-K1-01]** C's quest/chest wires need `item:got` and `flag:set` emitted at the real call sites.
- [ ] Audit: list in the lane file where main.js picks up items, sets flags, kills beasts; emit `item:got {id,count}`, `flag:set {key,value}`, `beast:died {id,kind}` at each (only those missing).
- [ ] `gameHooks.test.js` line per event with a fake handler; no behaviour change when no handler is registered.

**Blocked on owner (do not start):** breach trigger by marker proximity (AREAS-01), bridge B repair rule (D-052 owner Q1), spell tier/upgrade design.

### Slot kestrel-2 (GPU spine, no main.js)
**PBF-K2-01 BUG-FLICKER-BRANCH-01 measurement tool [P1, ~0.5 d, deps: S8-B1-14 optional]** Make the flicker measurable instead of eyeballed.
- [ ] `tools/capture-browser.mjs --mode flicker --at <pose> --frames 120`: captures N consecutive presented frames, writes per-frame hash plus count of cells that change frame-to-frame with the camera and sun static (json under `docs/test-reports/captures/`).
- [ ] Pure `tools/flickerStat.mjs` + Node test: synthetic frame sequences (static = 0 changed cells, 1 cell toggling = reported at its position, whole-frame noise = flagged).
- [ ] Runs on `?backend=webgpu` and `webgl2`; one pose from the owner report on the branch (ask the lane file for the pose; if none, use the tower road pose from gpucompare rows). Report only; no render change.

**PBF-K2-02 Overlay path for CPU-drawn UI under WebGPU [P1, ~0.75 d, deps: none, ARCH-NOTE NEEDED (small)]** Root cause of BUG-WEBGPU-EYELID-01 and the ED help overlay: CPU writes to `rt.cells` are not shown when `frameComplete`.
- [ ] Design question for the architect: ui layer composited after the sprite pass (`rt.setPresentCells` path) vs a tiny overlay pass; pick the cheaper (<0.1 ms).
- [ ] Implementation: `engine/ui` overlay cells reach the WebGPU presenter; Node test with the mock presenter (overlay cell present in the final buffer, absent overlay = identical buffer, zero alloc).
- [ ] gpucompare rows unchanged (overlay empty in all modes). Lets PBF-K1-02 and the editor help overlay (lane C LOOK RISK) work.

### Slot kestrel-3 (B2 engine/mesh: valley engine side + diagnosis)
**PBF-K3-01 Walkable slope limit + border no-fall-out tests [P0, ~0.5 d, deps: none; EP-WORLD-VALLEY slice 1 engine side]** `engine/physics` already has slope handling (integrate/config/terrainWalk); make the border rule explicit and tested.
- [ ] One config value `walkSlopeMaxDeg` (default today's behaviour) documented in architecture.md; terrain above it = slide/blocked, never climbable.
- [ ] Node test on a synthetic heightfield: 20/35/50/70 degree ramps (limit 45) - player cannot climb the steep ones, no tunnelling at 3x gravity jump speeds, no fall-out at the map edge square (clamp or wall; test all 4 edges).
- [ ] `engine/physics` stays stand-alone (check-deps OK). Route-walk border legs are PC-A/designer later.

**PBF-K3-02 Bridge deck mesh collider test [P1, ~0.5 d, deps: mesh-import skill, no real bridge asset yet]** Bridges are placed meshes with colliders (D-052).
- [ ] Synthetic bridge (deck + rails as a `buildMeshFromTris` fixture) through the collider build: deck walkable (player steps on at both ends, 0.3 m step), rails block, walking under the arch passes.
- [ ] Node test at walking and sprint speed: crossing 20 m deck end to end without falling; jump onto the rail is blocked or ledge-stable (document which).
- [ ] mesh-import skill gets a 3-line "bridge/deck collider" note. Real bridge asset: designer later, not this story.

**PBF-K3-03 Wade surface flag on water [P1, ~0.75 d, ARCH-NOTE NEEDED, deps: none]** Owner 2026-10-09: the big river is wadeable, not a collider wall (layout sheet "Engine ask").
- [ ] Architect note: `world.water` region/cell attribute `wade {speedMul, currentX, currentZ}`; where physics reads it (engine/physics must stay stand-alone: pass as a callback/sampler, not an import).
- [ ] Node test: speedMul 0.4 applied in water <= knee depth, current pushes 0.6 m/s south, deep water (> chest) unchanged (existing swim/sink rule), deterministic.
- [ ] Values are data defaults from the layout PROPOSAL (x0.4, ford x0.7, 0.6 m/s); owner may retune, so keep them in config, not code.

**PBF-K3-04 Biome map layer read by scatter [P1, ~0.75 d, ARCH-NOTE NEEDED, deps: none; EP-WORLD-VALLEY slice 3 engine side]** Editor-paintable biome layer (lane C paints later) drives scatter.
- [ ] Architect note first: layer format (1 byte per 16 x 24 m cell or per terrain cell, in world data beside `terrainEdits`), save/load, `biomeAt(x,z)` sampler.
- [ ] `engine/world/scatter.js` takes an optional `biomeAt` and a per-recipe `biomes: [ids]` mask; no layer = byte-identical scatter (existing scatter tests unchanged).
- [ ] Node test: recipe restricted to biome 2 spawns only inside biome-2 cells; boundary cell deterministic; zero alloc in the hot sampler.

**PBF-K3-05 BUG-WHITE-PIXELS-01 diagnosis [P1, ~0.5 d, deps: PBF-K2 pose row]** Pose `?at=1500.58,1022.77,1.80,185,-24`.
- [ ] Node-first: reproduce with the JS twin if possible; add a `holes` counter (white/blank cells inside the mesh silhouette) to gpucompare output for that pose on both backends.
- [ ] Written diagnosis in the lane file: cause (alpha-mask discard, depth, LOD pop, cull) with one evidence line each; propose a fix as a new story, do not fix in this one.

### Slot kestrel-4 (B2 modules + importer)
**PBF-K4-01 Forest triangle budget report [P1, ~0.5 d, deps: none]** Owner LOD1 pick needs a tri budget on forestWalk (D-051).
- [ ] `tools/validate-mesh.mjs --budget forestWalk`: per-species tri count x placed instances in the pose view, near/mid/far split with the current LOD ranges; json + 10-line text table.
- [ ] Node test on a fixture scatter (known counts); report numbers for both LOD1 candidates in `design/preview/lod1-trees.html`.
- [ ] Result pasted in the lane file for PC-A and the owner pick; no asset changes.

**PBF-K4-02 Asset pack licence gate [P2, ~0.5 d, deps: none]** D-052: every new pack needs a licence entry.
- [ ] `tools/check-licences.mjs`: every directory under `design/meshes/*` that is tracked (or imported into `content/`) must have a matching section in `THIRD_PARTY_NOTICES.md` (name, source URL, licence); exits 1 listing the missing ones; git-ignored source dirs are skipped.
- [ ] Node test with a fixture tree (ok / missing entry / ignored dir); added to `tools/run-tests.mjs` automatically via `*.test.mjs`.
- [ ] StickyBizcuit easter-egg note (memory: public repo) is reported as a warning, not failure.

## New Quaternius packs (owner 2026-10-09; sources extracted, git-ignored; CC0, notices written)
Packs in `design/meshes/source/`: **quaternius_ultimate_stylized_nature** (BirchTree_1-5, MapleTree_1-5, DeadTree_1-10, Bush*, Flower_*/clumps, Grass_Small/Large; glTF), **quaternius_textured_stylized_trees** (Birch_1-10, DeadBirch_1-10, Pine_1-5, Tree_1-10, DeadTree_1-10; FBX/OBJ only, no glTF: needs a Collada/OBJ/FBX path or Blender export, check first), **quaternius_fantasy_props_megakit** (94 glTF props: Chest_Wood, Key_Gold/Metal, Torch_Metal, Lantern_Wall, Barrel, Crate_*, Bench, Table_*, Chair, Sword_Bronze, Shield_Wooden, Axe/Pickaxe, Anvil, Cauldron, Banner, Scroll, Potion, Coin_Pile, books, shelves, stalls...).
- **NEWPACK-01 (lane C, content, ~1 d, `mesh-import` skill):** import a FIRST slice from Ultimate Stylized Nature for the valley forest/meadow: 2 birch + 2 maple + 2 dead trees, Bush + Bush_Flowers, Flower_1/2 clumps, Grass_Small. Budgets per MESH-SIMP-01/37.19 (no silent decimation of owner-visible art: preview options page first, e.g. `tools/mesh-lod-preview.mjs`), masks for leaf cards, trunk-only colliderParts, manifest + notices. Owner picks the look from a preview page BEFORE the game uses them (they compete with CommonTree/Pine; forest species switch is still blocked on ALPHA-01f d + owner LOD1 pick).
- **NEWPACK-02 (lane C, ~1 d):** Fantasy Props first slice for M4 / chest / village dressing: Chest_Wood (chest model for S8-B1-04 / S8-C chest defs), Key_Gold, Key_Metal, Torch_Metal, Lantern_Wall, Barrel, Crate_Wooden, Bench, Sword_Bronze. Same import rules; chest + keys feed the chest defs and the M4 key/door epic.
- **NEWPACK-03 (PC-B kestrel-4, ~0.5 d, ARCH check first):** can the importer read `.fbx`/`.obj` (Textured Stylized Trees has no glTF)? Report only: either extend `tools/gltf-import.mjs` input handling or note a Blender/assimp step; no code before PC-A answers.
- Rules: every import updates `THIRD_PARTY_NOTICES.md` + `docs/licences.md`; sources stay git-ignored; no owner-art reshaping.

