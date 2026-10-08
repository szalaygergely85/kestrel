# Sprint 8 queue (PO draft, 2026-10-08)

Rules: D-044 (no new GLSL, WGSL only for render features), JS twin = oracle, never widen a gpucompare threshold (D-039 known-FAIL only), engine never imports `game/`, `engine/physics/` stand-alone. B1 owns `game/js/main.js`, `wg/**`, `createRenderer.js`, `capture-browser.mjs`, `gpuCompare.js`; B2 owns `engine/render/gpu/wgsl/**` modules, `wg/pass*.js` new standalone files it created, `engine/mesh/**`, importer/gltf tools. Every engine item ends in `arch-review`. Format: `[priority, size, deps]`. "owner look" = owner-visible.

## Lane B1

### S8-B1-01 US-089w save relay + autosave + load hook [P0, ~0.75 d, deps: lane C saveState.js (US-089a)]
Mount C's `saveState.js` in `game/js/main.js`: autosave every 60 s and on waystone touch, load at boot when a slot exists, `?save=0` disables.
- [ ] Node test with a fake storage: round trip of player pos/hearts/inventory/flags through the relay is byte-stable.
- [ ] Headless capture: reload restores position within 0.01 m; no console errors.
Files: `game/js/main.js` (+ `game/js/dev/` harness).

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
Free the batch slot (args offset, instance buffer) when a group is removed so the 64-group cliff (CPU fallback) is not hit by reload/edit churn.
- [ ] Node test: add/remove 500 groups in a loop keeps live batches <= 64 and never falls back to CPU cull.
- [ ] 0 new device resources after warm-up.
Files: `wg/passCull.js`.

### S8-B1-07 WebGPU per-pass GPU timer (timestamp-query) [P1, ~0.75 d, deps: none]
Use `timestamp-query` when the adapter has it: ms for cull / raster / shadow / light / shade / edge / sprites in the F3 panel (EMA), nothing when unsupported.
- [ ] Node test with a mock device: pass order, ring of 3 query sets, no `mapAsync` stall (results read 2 frames late).
- [ ] Capture on the 4060: F3 shows per-pass ms, sum within 15 % of frame ms.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, F3 panel line in `main.js`.

### S8-B1-08 GFX-02 ultra step-up from the WebGPU timer [P1, ~0.5 d, deps: S8-B1-07]
`AutoBench` gets kind 'gpu' samples on WebGPU, so `high` with p95 < 7 ms can try `ultra` once (today WebGPU never picks ultra).
- [ ] Node test (injected samples): high -> ultra when p95 < 7, stays when 7-14, steps down when > 14.
- [ ] Note in `GFX-02.md` updated. Owner look: Ultra auto-pick on the 4060.
Files: `game/js/gfxAutoRun.js`, `gfxAuto.js` (+tests).

### S8-B1-09 Async pipeline compile behind the loading card [P1, ~0.5 d, deps: none]
Build all WG render/compute pipelines with `createRenderPipelineAsync`/`createComputePipelineAsync` during boot and log compile ms per pipeline.
- [ ] No first-frame hitch: first 5 frames after boot all < 50 ms in a headless capture trace.
- [ ] Boot log lists pipeline name + ms, total printed; Node mock test that boot waits on all promises.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, `main.js`.

### S8-B1-10 Device-lost recovery [P1, ~0.5 d, deps: none]
On `device.lost` rebuild device, pipelines and world uploads once; second loss in 10 s shows a "GPU reset, reload" card.
- [ ] Node test with a mock device firing `lost`: pipelines rebuilt, `ready` true again, second loss shows the card.
- [ ] Headless: `device.destroy()` via a dev hook, scene reappears within 2 s.
Files: `GpuDeviceWebGPU.js`, `wg/WgCellPipeline.js`, `main.js`.

### S8-B1-11 Zero per-frame allocation in the WG frame loop [P1, ~0.5 d, deps: none]
Cache bind groups and descriptors in `WgCellPipeline.run` and the passes it calls.
- [ ] Node 1000-frame heap test with the mock device: heap growth ~0 and 0 new device resources per frame.
- [ ] gpucompare rows unchanged vs same-machine baseline.
Files: `wg/WgCellPipeline.js`, `wg/pass*.js` (call sites only, B2's passes get a written `NEEDS B2`).

### S8-B1-12 Resize / DPR / fullscreen on WebGPU [P1, ~0.5 d, deps: none]
Canvas resize, devicePixelRatio change and F11 fullscreen keep aspect and the grid, no stretched glyphs, no leak.
- [ ] Node test: 200 random resizes with the mock device leave resource counts flat.
- [ ] Capture at 3 window sizes shows the same 400x150 grid letterboxed correctly. Owner look.
Files: `RenderTargetWebGPU.js`, `main.js`.

### S8-B1-13 gpucompare per-backend baseline file + auto diff [P0, ~0.5 d, deps: none]
`--baseline <file>` writes a JSON of row verdicts per backend/adapter and later runs print only PASS->FAIL, FAIL->PASS and new rows (exit 1 on PASS->FAIL).
- [ ] Node test on fixture verdict lists: regress, fixed, new, known-FAIL handling (D-039 list).
- [ ] Baselines for webgpu + webgl2 on the 4060 committed under `docs/test-reports/`.
Files: `gpuCompare.js`, `game/js/dev/modes/gpucompare.js`.

### S8-B1-14 capture-browser `--route` frame-time trace [P1, ~0.75 d, deps: none]
Headless walk along a named route (roadSouth -> forest) recording per-frame ms, p50/p95/max, draw counts, shadow renders; file name carries backend + preset.
- [ ] Output JSON with fixed schema; Node test of the stats on a fake trace (percentiles exact).
- [ ] 4060 numbers for High + Ultra recorded in the GFX-04 and WG-4c prep rows.
Files: `tools/capture-browser.mjs`, `game/js/dev/`.

### S8-B1-15 MAP-01c wiring: `M` toggles the chart [P1, ~0.5 d, deps: lane C mapCard.js (MAP-01c)]
Mount C's mapCard in main.js: `M` toggles, Esc closes, live x/y/yaw each frame, input blocked while open.
- [ ] Node test: toggle state machine and that no player input reaches the sim while open.
- [ ] Real-GPU capture at 400x150 with the arrow on the chart. Owner look.
Files: `game/js/main.js`.

### S8-B1-16 MAP-01d wiring: Visibility feed + saved fog mask [P1, ~0.5 d, deps: S8-B1-15, S8-B1-01, lane C MAP-01d]
Feed the visited-cell stream (Visibility or coarse grid) from the player to the map module and include its mask in the save.
- [ ] Node test: byte-stable mask round trip through the save.
- [ ] Walk 100 m in a capture: explored area grows, rest stays blank paper. Owner look.
Files: `game/js/main.js`.

### S8-B1-17 Settings "restart to apply" + live grid apply check [P1, ~0.5 d, deps: none]
Quality / shadow changes show the "restart to apply" line; grid change applies live through `engine.setGrid`.
- [ ] Node test with the mock device: 50 live grid changes keep resource counts flat (`resizeGrid` leak check).
- [ ] F3 shows `quality: <name> (auto|saved|url)` after a change.
Files: `game/js/main.js`, `wg/WgCellPipeline.js`.

### S8-B1-18 US-019 ambient dust motes in sunbeams [P2, ~0.5 d, deps: none]
Deterministic ~60 slow motes around the player through the existing particle layer (WebGPU sprites pass handles it), lit only when sunlit, off with `?ambient=0` and on Low preset.
- [ ] Node test: same seed + time gives same positions; count never exceeds the pool; 0 alloc per frame.
- [ ] Owner look: capture in forest light shaft. Needs the engine emitter API only (no new render code); else write `ASK ARCHITECT`.
Files: `game/js/quest/ambient.js` (new), one mount line in `main.js`.

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

### S8-B2-02 `validate-mesh` budget report [P0, ~0.5 d, deps: none]
Tool reports per registered mesh: tris, ranges, bytes, collider kind, one-sided open-edge %, and exits 1 over budget (tris > 20k, ranges > 8, bytes > 1 MB, configurable).
- [ ] Node test on fixtures (over/under budget).
- [ ] Table for all current meshes pasted into the row.
Files: `tools/validate-mesh.mjs` (new), mesh-import skill line.

### S8-B2-03 Mesh LRU eviction [P1, ~0.75 d, deps: MESH-LOAD-01]
Meshes farther than `loadM + 60 m` and unused for 20 s are released (CPU data and GPU buffers); colliders stay.
- [ ] Node test with a fake fetch: walk out and back, count loaded/evicted, no thrash within the hysteresis band.
- [ ] Heap and GPU buffer count flat over a 1000-frame loop route.
Files: `engine/mesh/` loader + registry.

### S8-B2-04 ME-20a importer vertex AO [P1, ~0.75 d, deps: none]
Importer bakes per-vertex AO (hemisphere ray test against the mesh, 32 rays) into a vertex attribute, opt-in `--ao`.
- [ ] Node test: closed corner vertex AO < open top vertex AO; deterministic output across runs.
- [ ] No change to existing meshes unless re-imported; ASCII-visible look page needs designer preview (NEEDS PC-A: designer).
Files: gltf importer, `engine/mesh/` data types (read-only use in shade is ME-20b).

### S8-B2-05 `windAt(x,z,t)` shared wind field [P1, ~0.5 d, deps: none]
Pure JS function in `engine/core` (direction, gust, 2 octaves, fully deterministic) plus its WGSL twin text in `common.wgsl.js`.
- [ ] Node test: JS vs WGSL probe within 1e-5 over 5000 samples; same output for same inputs.
- [ ] Wind params as one options object (`dirDeg`, `speed`, `gust`), default zero.
Files: `engine/core/wind.js` (new), `wgsl/common.wgsl.js` (append).

### S8-B2-06 Wind sway for kind-9 foliage and grass [P1, ~0.75 d, deps: S8-B2-05, B1 wiring for the time uniform]
Instanced vertex stage displaces by `height^2 * windAt` (trunk base fixed), also in the shadow variants.
- [ ] JS twin step + Node oracle test: time 0 or wind 0 = bit-identical to today; gpucompare rows unchanged at defaults.
- [ ] Owner look: two captures at different times show tree tops moved, trunks still. WGSL only.
Files: `wgsl/raster.wgsl.js` patch, `engine/mesh/rasterJS.js`; `NEEDS B1`: time uniform from main.js/passRaster.

### S8-B2-07 LOD dither crossfade [P1, ~0.5 d, deps: none]
Screen-door crossfade over a 3 m band between LOD0 and LOD1 using a hash of the pixel (ASCII cells: stable per cell), module patch + twin.
- [ ] Node test: band coverage sums to 1 across the two LODs; no popping row difference at band edges in twin vs oracle.
- [ ] gpucompare unchanged with the feature off by default. NEEDS B1 to wire the uniform.
Files: `wgsl/raster.wgsl.js`, `engine/mesh/rasterJS.js`, `wgsl/cull.wgsl.js` (LOD pick unchanged).

### S8-B2-08 Light flicker parameters [P1, ~0.5 d, deps: none]
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
Second-pass AABB test against the previous-frame HZB with a conservative margin; instances never wrongly culled.
- [ ] Node twin test: no visible instance culled (set superset of brute force visible) on bench poses.
- [ ] Reports culled-by-occlusion count at roadSouth. NEEDS B1 to wire the HZB texture; writes `NEEDS B1` row.
Files: `wgsl/cull.wgsl.js`, JS twin in `wg/passCull.js` oracle helpers (read-only to B1 file; ask first).

### S8-B2-11 LOD1 preview tool for the owner [P1, ~0.5 d, deps: none]
Tool generates a decimated LOD1 candidate for a mesh and a side-by-side preview page; never writes to the registry (no silent changes).
- [ ] Preview shows LOD0/LOD1 tris, ASCII render at 3 distances.
- [ ] Owner picks; only then QUAT-LOD-01 imports it. NEEDS PC-A: owner decision.
Files: `tools/mesh-lod-preview.mjs`, `design/preview/` page.

### S8-B2-12 Cloud shadows on the sun term [P2, ~0.75 d, deps: S8-B2-05]
Scrolling low-frequency noise multiplies `sunlit` in the light module (strength uniform, default 0); wind direction moves it.
- [ ] Node twin test: strength 0 bit-identical; strength 1 stays in [0.4, 1].
- [ ] Owner look: roadSouth at two times. WGSL + twin only.
Files: `wgsl/light.wgsl.js`, `engine/render/lighting.js`; `NEEDS B1` uniform wiring.

### S8-B2-13 Water ripples from splashes [P2, ~0.75 d, deps: none]
`WaterU` gets 8 ripple rings (`x,z,t0,amp`) displacing the glyph/flow term in the composite; JS twin in the water layer.
- [ ] Node probe test: no rings = unchanged; ring expands at fixed speed and fades by 2 s.
- [ ] `engine` API `water.addRipple(x,z,amp)` with ring buffer; owner look on a splash pose.
Files: `wgsl/water.wgsl.js`, `wgsl/waterComposite.wgsl.js`, `wg/passWater.js`, `engine/render/waterLayer.js`.

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

### S8-B2-16 Convex-hull collider option for rocks [P2, ~0.75 d, deps: none]
`gen-mesh-colliders --hull` builds a convex hull (<= 32 faces) for flagged meshes; capsule sweeps use it.
- [ ] Node test: capsule blocked on the hull face, free just outside; `--check` 0 diffs for default meshes.
- [ ] Collider build time per rock logged. Skill `engine-physics-colliders`.
Files: `tools/gen-mesh-colliders`, `engine/mesh` collider data (physics stays stand-alone).

### S8-B2-17 GPU particle kernel + JS twin [P2, ~1 d, deps: none]
`wgsl/particles.wgsl.js` compute (integrate, gravity, drag, ground plane, lifetime) for up to 4096 particles; JS twin is the oracle.
- [ ] Node oracle: same positions within 1e-5 after 300 steps from the same seed.
- [ ] Deterministic hash RNG, no `Math.random`. Registered, 0 compile errors.
Files: `wgsl/particles.wgsl.js` (new), `engine/entities` twin (new file); NEEDS PC-A: architect note (32.x seam).

### S8-B2-18 Particle splat output module [P2, ~0.75 d, deps: S8-B2-17]
Writes live particles into the PART / PART_Z layer textures so the existing sprites pass shows them.
- [ ] Probe test: depth-ordered nearest wins, out-of-grid skipped.
- [ ] B1 wiring row written (`NEEDS B1`); CPU particles unchanged by default.
Files: `wgsl/particleSplat.wgsl.js` (new), `wgsl/index.js` (append).

### S8-B2-19 CLOTH-DRAPE-01 collide with the body [P2, ~0.75 d, deps: none]
Cloth (cape/banner) collides with 2 capsules (torso + leg) and a ground plane.
- [ ] Node test: no vertex deeper than 2 cm inside any capsule over 600 steps of a walking pose.
- [ ] 0 alloc per step; capsule data passed in (no import of game). Owner look on the hero cape.
Files: engine cloth module (path to confirm in the story), tests.

### S8-B2-20 ME-20b horizon AO light-pass term [P2, ~1 d, deps: S8-B2-04]
Optional AO term in the light module from vertex AO plus a depth horizon sample (4 taps), strength default 0.
- [ ] Node probe: strength 0 bit-identical; 1 darkens concave corners, never brightens.
- [ ] gpucompare unchanged at default; owner look on tower interior. WGSL only; `NEEDS B1` uniform.
Files: `wgsl/light.wgsl.js`, `engine/render/lighting.js`.

## Lane C

Lane C (Codex): pure sim/data/view modules, Node tests, preview pages, tools. Never `engine/render`, `main.js`, `backlog.md`, `palette.js`. Anything needing main.js is a `NEEDS B1` row, pointing at the S8-B1 wiring story. Status goes to `docs/lanes/pc-c.md`.

### S8-C-01 US-089a saveState collect/apply + storage adapter [P0, ~0.75 d, deps: none]
`game/js/quest/save/saveState.js`: collect/apply player pos/hearts/mana/inventory/hands/flags/chests/beasts, `saveVersion` + migrate, localStorage + in-memory adapters.
- [ ] Node: collect -> serialise -> apply -> collect is byte-identical; a v0 fixture migrates to current.
- [ ] Corrupt JSON / missing slot returns `null`, never throws.
Files: `game/js/quest/save/saveState.js` + test. Unblocks S8-B1-01. No owner look.

### S8-C-02 Save slots API (3 slots, label, delete) [P0, ~0.5 d, deps: S8-C-01]
Slot index/meta layer: `list()`, `write(i)`, `remove(i)`, label "Wick - place - play time" (D-013), play-time accumulator.
- [ ] Node: 3 slots independent; delete leaves the others; label text from meta only (no full load).
- [ ] Play time adds dt only while `tick(dt, playing)` is true.
Files: `game/js/quest/save/slots.js` + test. Feeds S8-C-03 and S8-B1-03.

### S8-C-03 US-090a PO fixes + backend flag [P0, ~0.25 d, deps: PO review of US-090a]
Apply PO review notes to `titleMenu.js`; preview must not hard-code `backend:'webgpu'` (arch note, Arc = webgl2 per D-048): take `?backend=`.
- [ ] Preview opens with `?backend=webgl2` and `webgpu`; Node nav test still green.
- [ ] Slot rows use S8-C-02 meta. Owner look (PO opus first review).
Files: `game/js/ui/titleMenu.js`, its preview page. NEEDS PC-A: PO verdict, S8-A-04 style, S8-A-12 labels.

### S8-C-04 Title menu extras: Settings sub-view + Credits [P1, ~0.75 d, deps: S8-C-03]
Pure view modules `settingsView.js` (quality, shadows, grid, volume, text size, reduce-motion flags) and `creditsView.js` (from `docs/licence-inventory.json`, StickyBizcuit line when used, OWN-REQ-013).
- [ ] Node: every setting round-trips through a plain options object; credits lists every inventory entry exactly once.
- [ ] Keyboard-only navigation works (arrows, Enter, Esc) in the preview page.
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

### S8-C-07 Item-get card view [P1, ~0.5 d, deps: S8-C-06, S8-A-07, S8-A-13]
`game/js/ui/itemGetCard.js`: pauses 1.5 s or until a key, icon + name + one line, queue when several arrive together.
- [ ] Node: timer, key-dismiss, queue order of 3 items; zero alloc per frame after warm-up.
- [ ] Preview page at 400x150. Owner look (PO opus first review).
Files: `game/js/ui/itemGetCard.js` + test + preview. Hook = S8-B1-04.

### S8-C-08 Item database + inventory model [P1, ~0.75 d, deps: S8-A-13]
`content/items/items.json` + `game/js/quest/sim/inventory.js`: item defs (kind, stack, hand-slot, heal amount), add/remove/stack/cap.
- [ ] Node: stack cap, overflow returns remainder, equip into left/right hand, serialise.
- [ ] Content lint (S8-C-17) passes on the db; every item has an icon id and a name key.
Files: `content/items/items.json`, `inventory.js` + test.

### S8-C-09 Inventory screen view module [P1, ~1 d, deps: S8-C-08, S8-A-05, S8-A-07]
`game/js/ui/inventoryView.js`: grid list of items, selection, equip to hands, detail line, empty state.
- [ ] Node: navigation wraps, equip swaps hands, 0 alloc per frame.
- [ ] Preview page with a 12-item fixture. Owner look.
Files: `inventoryView.js` + test + preview. NEEDS B1: open key + pause (S8-B1 row to add).

### S8-C-10 Crafting recipe data + sim [P2, ~0.5 d, deps: S8-C-08]
`content/items/recipes.json` + `crafting.js`: inputs -> output, can-craft check, consume atomically.
- [ ] Node: partial inventory refuses and changes nothing; success consumes exactly the inputs.
- [ ] Recipe ids reference existing items (lint rule).
Files: `crafting.js`, `recipes.json` + test. Not in the M1 slice; data only.

### S8-C-11 US-096a quest sim + M1 chain [P0, ~0.75 d, deps: S8-A-11 objective texts]
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

### S8-C-17 Content lint + validate-content rules [P1, ~0.75 d, deps: none]
`tools/lint-content.mjs`: checks ids unique, references resolve (items, quests, chests, meshes, areas), required text keys present; exit 1 on error.
- [ ] Node test with fixtures per rule (broken ref, duplicate id, missing name).
- [ ] Run on `content/` and `design/` today; findings pasted into the row, fixed or filed.
Files: `tools/lint-content.mjs` + test; added to `run-tests.mjs` list only if the owner OKs the runtime.

### S8-C-18 Editor undo/redo coverage test [P1, ~0.5 d, deps: none]
Table-driven test that every editor command (place, move, delete, scale, light edit, terrain stamp, group) undoes and redoes to an identical world JSON.
- [ ] One test row per command; failures listed by name.
- [ ] Redo stack clears on a new edit; 200-op random walk ends equal to the start after 200 undos.
Files: `tools/editor/*.test.js`. Fixes go to the owning module (editor only).

### S8-C-19 ED-TERRAIN-1c terrain UI [P1, ~1 d, deps: ED-TERRAIN-1a/b done]
Editor panel: brush raise/lower/smooth/flatten, radius, strength, material paint; one stroke = one undo step.
- [ ] Node: stroke on a fixture heightmap changes only cells in radius; undo restores it bit-exact.
- [ ] Brush radius 1..16 and strength are clamped; save/load round trip.
Files: `tools/editor/terrain*.js`, `panel.js` section + test. Owner look at the walk-through.

### S8-C-20 ED-GROUP-1c prefab UI + BUG-RTS-002 + BUG-ED-VOX-1 [P1, ~1 d, deps: PC-A `prefab` seam in loadPack (S8-A-02)]
Prefab save/place panel (group selection -> `.prefab.json` -> place instance) and the two dev-page bugs: fix BUG-RTS-002 and BUG-ED-VOX-1 per their backlog rows.
- [ ] Node: group -> prefab -> place twice gives two independent instances; undo removes one.
- [ ] Both bug rows have a Node or capture check named in the row and pass.
Files: `tools/editor/*`, `game/js/dev/` page files. Do the two bugs first (0.25 d) if the seam is late; prefab part waits.

## PC-A

PC-A has no programmer. Each row is one role's work (<= 1 day). Tag = who does it. Sprint 8 is the plan; archive and merge routine only after the gates.

### S8-A-01 [architect, opus] Tech notes for B1 render/GPU stories [P0, ~0.5 d, deps: none]
Short notes (architecture.md 38.x) before dev for S8-B1-05, 06, 07, 10, 11, 12 (version counter, batch release, timestamp query ring, device-lost, bind-group cache, resize).
- [ ] One section per ID with invariants, seams and the test the programmer must write.
- [ ] Stories for which no note is needed are listed (B1-01..04, 08, 09, 13..20).

### S8-A-02 [architect, opus] Seam notes: `prefab` kind in loadPack + MESH-SCALE-01 [P0, ~0.5 d, deps: none]
Unblocks S8-C-20 and S8-C-16: where the `prefab` kind lives (engine/content/loadPack.js), data shape, who owns it (B1 or B2), and the scale field path through placeMesh and colliders.
- [ ] Note + named owner lane for each; story rows added to the B1/B2 lists by the main session.

### S8-A-03 [architect, opus] Tech notes for B2 stories [P1, ~0.75 d, deps: none]
Notes for S8-B2-03 (LRU), 04 (AO), 06/07 (wind sway, dither), 08 (flicker slot in the 1264 B light block), 10 (HZB occlusion), 13 (ripple), 17/18 (particle kernel seam, 32.x), 19 (cloth path).
- [ ] One section per ID, uniform slot offsets stated, gpucompare rows that must stay unchanged named.
- [ ] Stories that can start without a note are listed (B2-01, 02, 05, 09, 11, 14, 15, 16).

### S8-A-04 [designer] Title menu style (uiStyle.menu) [P0, ~0.75 d, deps: none]
Style tokens and a preview page for the title menu card: palette, border glyphs, selected-row look, disabled Continue, slot rows. For S8-C-03 and S8-B1-03.
- [ ] `design/preview/title-menu-style.html` at 400x150 grid; 2 sizes tested.
- [ ] Palette uses existing `design/palette.js` ids (no new hot-file edits without the main session).
Owner look.

### S8-A-05 [designer] uiStyle.settings and inventory panel style [P1, ~0.75 d, deps: S8-A-04]
Style for the settings list (slider, toggle, select) and the inventory grid (cell, selected, equipped mark, detail line).
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
