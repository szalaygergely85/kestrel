# Tech review 2026-10-15: speed and beauty (PC-B fable architect, owner-requested; PC-A to read)

Read-only review. Sources: `docs/architecture.md` 38.0-38.8, 38.20, 38.25, 38.46, 38.52, 38.56, 38.58, 38.60-38.65, 38.72-38.73; `docs/proposals/perf-environment-2026-10-13.md`; `docs/test-reports/{perf-2026-10-11,trees-perf-2026-10-10,MESH-PERF-01}.md`; `content/settings/gfx-presets.json`; `engine/render/frameRenderer.js`, `engine/render/gpu/wg/*` (WgCellPipeline `_hook`, passRaster, passShadow, passPointShadow, passCell, passStable, passCarpet, targets), `engine/mesh/*` feeds. No bench was run (a full gate was running on this machine; numbers below would have been noise). "Measured" = a number recorded in a report; "estimated" = my reading of the code and the proposal.

## Owner summary (plain language)

1. **Where the time goes today.** On the RTX 4060 at `ultra` (480x180, 4 rays) the GPU needs only 2.3-4.9 ms of the 8 ms budget; the **JavaScript side is the tight one at 6.9-8.0 ms** (p95, measured 2026-10-11), and about a quarter of that is a measuring artefact (the pause menu dimming in headless runs), so real play is ~5-6 ms JS. On the Intel laptop at `ultra` the GPU needs 19 ms (raster 15, resolve 5): that preset is simply too big for it; at `high` (400x150, 2 rays, the D-075 rule) the laptop should land near 8-10 ms GPU, but **nobody has recorded a laptop `high` number yet**.
2. **Biggest speed wins:** (a) measure the laptop at `high`/`medium` and switch HZB occlusion + impostors on per preset (built, still off: `occl: null`); (b) cut JS render work: the mesh feed still scans every placed structure each frame, and sprites re-trace sun visibility per sprite per frame; (c) remove the beast-sim spikes (p50 0.3 ms, but p99.9 **15 ms** and max **52 ms** per step in bench-life) - these are the hitches you feel, not the average.
3. **Biggest beauty wins:** (a) baked bounce light (GI probes, note 38.72 is written): dark interiors, warm bounce under trees, no more flat ambient; (b) the post stack (38.73: vignette, per-biome grade, mist in caves/cellars, bloom on fire) - half built; (c) ASCII-native touches that cost nearly nothing: a night sky with stars and a moon disc, sun shafts under the forest canopy from the shadow map, wind gusts that travel across grass and crowns.
4. Nothing here needs a new renderer or a library. All of it stays inside the twin/gpucompare rules (D-039), and most items are 0.5-1 day each.

## 1. Frame-time budget today (per preset)

Presets (`content/settings/gfx-presets.json`): low 240x90 r1 | medium 240x90 r2 | high 400x150 r2 | ultra 480x180 r4 | extreme 560x210 r4. Budget D-085: GPU <= 8 ms RTX at every preset, <= 10 ms Intel at high; JS <= 8 ms (D-007). G-buffer = (cols*rays) x (rows*rays) at 36 B/sample: ultra = 1.38 M samples, extreme = 1.88 M (never measured).

| Machine / preset | GPU p95 | JS p95 | Source | Notes |
|---|---|---|---|---|
| RTX 4060 ultra, 5 perf poses, sim on | 2.3-4.9 ms | 6.9-8.0 ms | measured, perf-2026-10-11 + 38.46 (4 agents on the box) | JS includes ~28 % `dimSceneRect` harness artefact -> real ~5-6 ms |
| RTX 4060 ultra/high, camera spin, sim paused | 1.7-2.1 / 0.8 ms | 4.7 / 4.1 ms | measured, trees-perf-2026-10-10 | frame p95 5.2 ms = 190+ fps headroom |
| Intel iGPU ultra (owner F3, 2026-10-13) | 19 ms frame; raster 15.07, resolve 4.92, shadow 2.23, shade 0.66, light 0.20, sprites 0.13 | not the limit | measured (one F3 line) | fill/bandwidth bound at 1920x720 sub-samples |
| Intel iGPU high (400x150 r2) | est. raster 5-7, resolve ~1.3, shadow ~1.5-2.2 -> 9-11 ms | est. 4-6 ms | **estimated**, no report | R1 (D-075 step 1) is still unmeasured; `tools/bench-presets.mjs --gpu intel` exists |
| Intel medium (240x90 r2) | est. 3-5 ms | est. 3-5 ms | estimated | 86k -> 21.6k cells; the safe laptop preset |

Top GPU costs (both GPUs, in order): raster of the sub-sampled G-buffer (trees LOD0 9-11k tris, 2-4x crown overdraw, instanced vertex fetch 64 B/vertex); resolve (reads rays^2 x 36 B per cell); sun shadow map + point-shadow faces (6 faces/light, `faceCap` round-robin, **no p95 number recorded**, lane pc-b1 line 203); carpet (0.35 ms budget at high); everything after light (shade, edge, stable, glow, sprites, overlay) ~1-1.5 ms.

Top JS costs per frame on the GPU path (`frameRenderer.step` still runs these on the CPU every frame): `voxelPool.collect` over 320 beast slots + fauna + props; `instances.addToDrawList` / `addMeshStructures` = linear scan of all structures (~13 % of the 10-11 profile); `sprites.project` with per-sprite `lightAt` + `sunVisibleP` DDA (was 53 % before the `_gridStructures` cache; still per sprite per frame); `buildShadowList` (`shadowCpuMs`) + point-shadow list builds; `particleLayer.build`; uniform ring writes (8256 slots). Sim: bench-life (Node, 48 beasts engaged): villagers/fauna/spears < 0.02 ms p95, **beast 0.29 p50 / 0.68 p95 / 15.0 p99.9 / 51.7 max ms per step** - the spikes are the issue, the mean is fine. Allocation: 0-B gates (38.61 allocProbe) hold; GC is not a top cost; GATE-FLAKY rows are load flakes, not leaks. The JS twin (CPU path) is oracle-only: groundLook +12 ms, post twin 5.8 ms - irrelevant in play, must not be "optimised" at the cost of twin exactness.

## 2. Speed: ranked opportunities

Columns: impact (ms or %), effort (programmer-days), risk, parity (JS twin / gpucompare).

| # | Opportunity | Impact | Effort | Risk | Parity |
|---|---|---|---|---|---|
| S1 | **Measure Intel high/medium with `tools/bench-presets.mjs --gpu intel --imp on`, occl 0/1 (R1 + R3-MEASURE, both still `todo`)**; set preset `occl` (today `null` everywhere) and confirm the laptop never runs ultra (D-075) | decides everything below for the laptop; occl: -10..30 % raster in forest/town, ~0 in meadow | 0.25 (owner laptop, main session) | none | none (HZB has a twin, "never wrongly culled") |
| S2 | **Beast-sim spike hunt**: `bench-life --strict` gains a max-per-step gate (<= 4 ms); find the 15-52 ms steps (A* bursts, respawn/director, raid start) and slice them over steps | removes the felt hitches; no change to p50 | 1 | low; determinism kept (same slicing every run) | none |
| S3 | **Mesh feed via `placementGrid`** instead of the `addMeshStructures` linear scan (STREAM-01 already keeps per-cell members) | -0.3..-0.7 ms JS at roadside poses (13 % of profile) | 1 | low: draw-list hash must stay identical at 5 poses | none if push order is unchanged (38.46) |
| S4 | **Sprite light amortisation**: cache `sunVisibleP`/`lightAt` per sprite, refresh when the sprite moved > 0.25 m, the light set version bumped, or every 4th frame | -0.5..-1.5 ms JS with 20+ sprites in view | 0.75 | light lags <= 4 frames on fast sprites (invisible at 60 Hz) | gpucompare = single fresh frame: identical |
| S5 | **JS profile without the harness artefact** (`perf-pose --cpuprof` with pointer lock emulated / `?nomenu=1`), top-10 self time at 3 poses | tells whether S3/S4 are the right next cuts (today's profile is 28 % menu dimming) | 0.5 | none | none |
| S6 | **Shadow trim at high** (R4): `instCastM` 48 -> 32 m, `meshLod0M` 25 -> 16, shadow LOD1 always; first point-shadow p95 number; `faceCap` per preset | Intel shadow 2.2 -> ~1.4 ms | 0.5 | softer far shadows (owner look) | shadow map not cell-compared; light rows PASS expected |
| S7 | **Beast slot pooling** (BEAST-POOL a/b/c, 37.16.5, rows exist): dormant records out of `voxelPool.collect` and the sim loop | -0.2..-0.5 ms JS; enables > 320 beasts | in flight (3 x 1) | medium (save/load of unbound records) | none |
| S8 | **Resolve at rays 4** (RTX only): per-band rays (A1: rays 2 beyond ~40 m) or a compute resolve with shared loads | RTX resolve ~1.5 -> ~0.6 ms | 1-1.5 | medium; RTX has 3+ ms GPU headroom, so low priority | resolve is in the twin: rows must be re-recorded (thresholds unchanged) |
| S9 | **GPU cull for singles/terrain/voxels** (today only instanced groups go through `cull.wgsl` + `drawIndirect`) | small: singles cap 64, voxels <= 48, terrain 81 items; < 0.3 ms JS | 1.5 | medium | none |
| S10 | **Band bake-ahead in a Worker** (C2 in the proposal) | smoother first visits only: bakes are already sliced <= 2 ms and cached (38.58) | 1.5 (structured-clone of terrain data) | low; pure bake = deterministic | none |
| S11 | **Temporal reuse of far cells** (reproject history for depth > X; A2 parked) | GPU -20..40 % raster on open views | 2+ | **high**: ghosting on ASCII cells, history-dependent output | breaks single-frame parity; rows would need history off -> not recommended now |
| S12 | **Worker for beast A\* / sim** | moves ~0.3-0.7 ms off the main thread | 2 | **high**: rule 15 determinism (results must land at a fixed step), save/replay | none directly | 

Not worth doing now: OffscreenCanvas (renderer is already GPU-side, C3), WASM (no pure-math loop > 1 ms, C4), async compute (WebGPU has no async queues in the browser; the decor compute already overlaps nothing), allocation work (gates are green).

## 3. Beauty: ranked opportunities (ASCII direction, D-039 parity noted)

| # | Opportunity | What it looks like | Cost | Parity |
|---|---|---|---|---|
| B1 | **GI probes** (38.72, note written; GI-PROBE-01..06 rows) | dark interiors/caves/cellars (EP-UNDER needs this), warm ground bounce, sky-occluded shade under crowns; macro GI x micro AO | ~6 d total (6 steps <= 1 d) + Node bake tool | existing rows unchanged (field null); 4 new rows; owner decision GI-Q1 |
| B2 | **Post stack** (38.73; `post.js` twin landed, 01b WGSL + 01c data/presets open) | vignette, per-preset grade over the biome grade, mist in interiors, bloom = glow pass | 2 d | 4 new rows; existing unchanged |
| B3 | **Night sky: stars + moon disc on kind-0 cells** (hash glyph `.` `+` `*` with the sky LUT, moon from `applySunPair`) | the night reads as night; cheap atmosphere | 0.5 d | **parity-free**: kind-0 cells are excluded from gpucompare |
| B4 | **Canopy light shafts** = extend AUD-45 `fogShape` sun in-scatter with 8 shadow-map taps along the view ray per cell (`sunShadowTaps` exists in both twins) | god rays in the forest, dust in cave mouths; bg-colour lift along the sun direction | 1.5 d; est. 0.3 ms RTX / ~1 ms Intel -> high/ultra only | both twins; 2 new rows (forest noon, cave mouth) |
| B5 | **Glyph from normals + silhouette** (data ramp per material: N.L band x normal orientation -> `/` `\` `_` `^` `|`; depth-discontinuity outline from the deriv pass) | the most ASCII-native upgrade: slopes, roofs and ridges read as drawn strokes, not only as colour | 1.5 d engine (shade.wgsl + `shadeSurfaces`) + designer ramp data | both twins; every row re-recorded (glyph byte changes) -> D-039-level item, owner look first |
| B6 | **Wind gusts** (a travelling gust front in the quantised `windCtx`, crowns + carpet + decor sway share it; leaf-fall particles under trees in wind) | the forest moves as one; "alive" | 0.75 d | uniforms only (wind is already quantised): rows unchanged at t = 0 |
| B7 | **Fire D-104 look pass** (billboard body + tongues/embers/smoke particles; in flight OB-172) | tapered tongues, white-hot base, ember specks | 0.5 d designer + programmer | sprite rows; particle crop test exists |
| B8 | **Water finish** (RIVER-A1 v2 and ripples exist): bank foam at flow > x, shallow-bed caustic glyph flicker, wet rock darkening within 0.5 m of water | rivers and the ford read as moving water, shores look wet | 1 d | water rows (`readbackWater`) |
| B9 | **Contact AO ring for placed meshes** (ground-tier darkening within R of a prop's footprint, in the terrain shade) | props sit on the ground instead of floating visually (OB-114-type complaints) | 0.5 d | both twins; terrain rows re-recorded |
| B10 | **Fireflies / wisps at night** (particles in glades, derived lights capped) + **torch flicker** on derived lights | night life, matches D-094 undead-at-night | 0.5 d | particles: existing rows unchanged |
| B11 | **Sub-cell detail with quadrant/box glyphs** (2x2 block elements when a cell straddles two depths) | sharper silhouettes at rays 1-2 | 1 d | glyph atlas + rows; **owner decision: Unicode blocks are not ASCII** |
| B12 | Per-biome colour grading | covered by ENV-03 (in flight: ENV-FIX-MAIN arch-review, ENV-BUDGET measure todo) | 0.5 d to close | done per 38.65 |

## 4. Two-sprint proposal (each story <= 1 day, Node ACs; engine steps -> arch-review on PC-A)

**Sprint P1 "hold 60 on the laptop at high, free 2 ms JS on the RTX, no hitches"**

| ID | Story | Files | Lane | AC (short) |
|---|---|---|---|---|
| PERF-MEASURE-02 | S1: bench-presets Intel high/medium, occl 0/1, imp on; RTX ultra occl 0/1; table in the story; preset `occl` set per the 38.60 rule | tools/bench-presets.mjs (run only), content/settings/gfx-presets.json | PC-A (owner laptop) + main session | Intel high <= 10 ms GPU or a listed next cut; `occl` boolean per preset |
| PERF-JS-01 | S5: cpuprof at roadBend/meadowDetail/fordDetail without the menu artefact; top-10 self-time table | tools/perf-pose.mjs, docs/test-reports/perf-2026-10-15.md | PC-B kestrel (tools) | artefact < 2 % of profile; table recorded |
| SIM-SPIKE-01 | S2: `bench-life --strict` max-per-step gate (<= 4 ms); slice the found bursts (A* queue, director/respawn, raid start) | tools/bench-life.mjs, game/js/quest/sim/*.js, life/raids.js | PC-B kestrel (game) | max step <= 4 ms over 24 h; p50 unchanged; state hash identical to before at 3 fixed seeds |
| MESH-FEED-GRID-01 | S3: `addMeshStructures` via `placementGrid` cells in the frustum | engine/mesh/meshGroups.js, engine/world/placementGrid.js | PC-B cross-track -> PC-A arch-review | draw-list hash identical at 5 poses; JS render p95 -0.3 ms at roadBend; 0 alloc |
| SPRITE-LIGHT-CACHE-01 | S4: per-sprite sun/light cache with move/version/4-frame invalidation; `?spritecache=0` | engine/render/sprites.js (+ test) | PC-B cross-track -> PC-A arch-review | fresh-frame output byte-identical; gpucompare rows unchanged; JS -0.5 ms at 20 sprites |
| SHADOW-TRIM-01 | S6: high-preset caster knobs + point-shadow `faceCap` per preset + first point-shadow p95 | content presets, game/js/pointShadowOpt.js, tools/bench-shadow.mjs | PC-B content + main session measure | Intel shadow+pshadow <= 1.5 ms at high; owner look on far shadows |

**Sprint P2 "lit and alive"**

| ID | Story | Files | Lane | AC (short) |
|---|---|---|---|---|
| GI-PROBE-01 | B1 step 1: field format, encode/decode, `sampleGI`, `mixGIState` | engine/render/giProbe.js (+ test) | PC-B kestrel-2 -> PC-A arch-review | 38.72 table row 01 |
| GI-PROBE-02a | B1 step 2: sliced bake core on a fixture world | engine/world/giBake.js (+ test) | PC-B kestrel-4 -> PC-A arch-review | 38.72 row 02a (two runs byte-identical) |
| POST-STACK-01b | B2: `POST_WGSL` in the sprites fragment, `SpritesU` append, 4 rows | sprites.wgsl.js, passSprites.js, gpucompare.js | PC-B kestrel-2 -> PC-A arch-review | 38.73 row 01b; existing rows unchanged |
| POST-STACK-01c | B2: data + presets + `?post=0` + preview | design/look/post.js, game/js/look/postConfig.js, design/preview/post.html | PC-B kestrel-4 + kestrel-1 | 38.73 row 01c; owner stills day/dusk/interior |
| NIGHT-SKY-01 | B3: stars + moon disc on kind-0 cells in `fillSky`/`fastShadeSky` and the GPU sky branch | engine/render/sky.js, shade.wgsl.js (kind 0), design palette keys | PC-B kestrel -> arch-review (small) | kind-0 only; day output unchanged; owner still at 23:00 |
| WIND-GUST-01 | B6: gust front in `windCtx` (quantised), shared by crowns/carpet/decor; leaf-fall emitter under trees when gust > k | engine/render/compositor.js `windCtx`, engine/world/wind, particles preset | PC-B kestrel -> arch-review | rows unchanged at t = 0; 0 alloc; owner look in the forest |

Then (P3 candidates, in this order): CANOPY-SHAFT-01 (B4, note first), GLYPH-NORMAL-01 (B5, note + owner look on a still before any code), WATER-FINISH-01 (B8), CONTACT-AO-01 (B9), GI-PROBE-02b..06, BEAST-POOL a/b/c (already queued).

## 5. Needs an owner decision

1. **GI-Q1 (38.72):** ship baked `.gi.bin` (~1 MB per zone, ~5 MB per world revision) in git, re-baked by a tool when placements change. Recommendation: yes (bake in play breaks the 38.58 "nothing baked" rule and costs 20-60 s per zone).
2. **Laptop preset:** confirm the Intel laptop plays at `high` (400x150, rays 2) per D-075, and whether `extreme` (560x210 r4, 1.9 M samples, never measured) should stay in the list or be hidden until measured. Recommendation: hide `extreme` until PERF-MEASURE-02 includes it.
3. **Sprite light cache (SPRITE-LIGHT-CACHE-01):** sprite lighting may lag up to 4 frames (~67 ms) on fast movers. Recommendation: accept; invisible at 60 Hz, and gpucompare stays fresh-frame.
4. **Workers (S10/S12):** none today. A worker for A*/sim needs a manager decision because of rule 15 (same result every run) - ESCALATE only if SIM-SPIKE-01 cannot slice the bursts under 4 ms. Recommendation: slice first, no worker.
5. **Glyph language (B5, B11):** (a) may the engine change the glyph byte from normals/silhouettes (every gpucompare row gets re-recorded once, thresholds unchanged)? (b) are Unicode quadrant/box glyphs allowed, or is the style strictly ASCII? Recommendation: (a) yes after one owner still; (b) no, stay ASCII.
6. **Light shafts (B4):** shadow-map march (physically right, ~1 ms Intel, high/ultra only) vs a screen-space radial smear (cheap, fake). Recommendation: shadow-map march, high/ultra only, off at low/medium.
7. **Post twin over budget:** `postCells` measured ~5.8 ms vs the 0.8 ms twin budget (oracle path only). Recommendation: warn-only gate at 8 ms for the twin; the GPU path keeps the 38.73 budgets.
