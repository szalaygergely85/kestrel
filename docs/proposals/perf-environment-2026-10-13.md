# Performance for a denser environment (grass, foliage, props) - options ranked

(PC-B architect fable 2026-10-13, owner request.) Question: "what else can we do for optimization ... to have more grass and environment, but keep the performance?" Scope: WebGPU frame renderer (`engine/render/gpu/wg/*`), Intel iGPU laptop as the floor, RTX 4060 as the ceiling. No code changed; Node-only probes. Related notes: architecture.md 37.15, 37.19 (speed plan table), 38.20 (HZB), 38.25 (stable), 38.46, 38.51 (streaming), 38.52 (carpet + amendments), 38.56 (e), 38.58; `docs/test-reports/MESH-PERF-01.md`.

## 0. The measured frame (owner's F3, Intel iGPU, 480x180 ultra)
frame 19 ms; wg pass ms: cull 0.13, raster **15.07**, shadow 2.23, resolve **4.92**, water 0.13, light 0.20, shade 0.66, edge 0.07, sprites 0.13 (sum ~23.5 ms of GPU work: the frame is GPU-bound, JS is not the limit). mesh singles 5/5 (cap 64), draws 135/512, stream act 1813/2021.

**The one fact that explains both big numbers:** the `ultra` preset is `grid 480x180, rays 4` (`content/settings/gfx-presets.json`). The raster G-buffer is sized `(cols*rays) x (rows*rays)` = **1920 x 720 = 1.38 M sub-samples at 36 B each** (2x rgba32uint + r32uint + depth24, `wg/targets.js`): ~50 MB of G-buffer per frame before overdraw, and `resolve` reads all 16 sub-samples per cell (86k cells x 16 x 36 B = 50 MB) - that is the 4.9 ms. On the MESH-PERF-01 WebGL2 probe (240x90, rays 1 = 21.6k samples) fragment/ROP work was measurably zero and vertex invocations dominated; at 64x the sample count that is no longer true - ultra on the iGPU is fill/bandwidth-bound and renders at close to native pixel resolution. The ASCII advantage (86k cells) is given away by the preset, not by the engine. Honest caveat: no per-rays timing exists on the Intel WebGPU path yet; the estimates below are bandwidth arithmetic and must be measured first (section 7, step 1).

Other facts: `?occl=1` HZB two-phase occlusion exists (`passHzb.js`, 38.20) but is **default OFF** and untested on this pose; GPU-driven cull + `drawIndirect` covers instanced groups (trees, detail, mesh groups) but not singles/terrain/voxels; mesh LOD is per-species `lodCells` x `lodScale` (ultra 1.25 = LOD0 kept longer); trees are cut at 140 m (`forest.trees.maxDistM`), buildings at 180 m (`streaming.cutM`, landmarks `keepFar`); the carpet is OFF by default (measured 3.2 ms at 480x180 before TUFT-PERF-01b/OB-103 bounds, budget 0.35 ms); `tools/bench-cast.mjs` does not exist on this branch (removed with the DDA path); Node benches available: `bench-carpet.mjs` (browser, CDP), `bench-shadow.mjs`, `bench-life.mjs`, `bench-fauna.mjs`, `bench-mesh-collide.mjs`, `bench-physics.mjs`, `bench-rig.mjs`.

Ranking key: **gain** = visual gain for dense grass/foliage/props or ms saved; **cost** = programmer-days; **twin** = JS-twin / gpucompare impact (D-039: thresholds never widened).

## 1. Raster cost (15 ms): breakdown and options
Where the 15 ms goes (estimate from the facts above, to be confirmed by R1): ~50-60 % fill/ROP at 1920x720 incl. tree overdraw (crowns of 5-10 LOD0 trees within ~27 m overlap 2-4x), ~25 % vertex invocations (LOD0 trees 9-11k tris each, ~26 us/ktri on the WebGL2 instanced path; WebGPU not re-measured), ~10 % terrain near band + skirts, rest singles/voxels. Two-sided masked leaf ranges `discard` -> no early-z for those ranges.

| # | Option | What | Expected | Cost | Risk | Twin / gpucompare | Needs |
|---|---|---|---|---|---|---|---|
| R1 | **Rays 4 -> 2 at 480x180 on the iGPU tier** (preset change, measure first) | `ultra` becomes `rays 2` on Intel (GFX-02 tier picks it); RTX keeps 4 | raster 15 -> ~6-8 ms, resolve 4.9 -> ~1.3 ms (4x fewer samples); look: slightly more glyph flicker on thin edges (stable pass compensates) | 0.25 d (preset json + a 2-row Arc measurement) | owner look: edge quality | none (presets are content) | - |
| R2 | **Tree LOD aggressiveness** | per-species `lodCells` so LOD1 (15-35 % tris) engages at ~15-20 m instead of ~27 m+; `lodScale` 1.25 -> 1.0 at ultra; TwistedTree `lodCells` ~300 (MESH-PERF-01 table) | vertex share -40..60 % (~1-2 ms at rays 4, ~1 ms at rays 2) | 0.25 d content + tool sweep (`mesh-tri-budget.mjs`) | pop at the switch (dither band exists) | none (data) | owner look |
| R3 | **Enable HZB occlusion (`?occl=1`) where it pays** | measure the 38.20 decision rule on this pose (iGPU + RTX): `raster + raster2 + hzb + cull2 <= raster - 0.3 ms` | forest/town poses -10..30 % raster; open meadow ~0 (fixed cost 0.5-1 ms iGPU) | 0.25 d measure; 0 build | pays only in dense poses; iGPU fixed cost | identical cells by rule (any diff = bug) | S8-B2-10d gate |
| R4 | **Shadow caster trim at ultra** | `instCastM` 48 -> 32 m, `meshLod0M` 25 -> 16, shadow LOD1 always | shadow 2.2 -> ~1.4 ms | 0.25 d (knobs exist, 37.19 opt 1) | softer far shadows | shadow map not compared cell-exact; light pass PASS expected | - |
| R5 | **Depth pre-pass for opaque instanced groups** | draw LOD0 crowns' opaque ranges depth-only first, then full G-buffer with `depthCompare: equal` | overdraw of the 36 B G-buffer -50..70 % in forests at rays >= 2; ~0 at rays 1 | 1 d engine (new pipeline variant, pass order) | doubles vertex work for the pre-passed set (bad on vertex-bound GPUs: only for rays >= 2) | bit-identical output (same depth test) | R1 measured first |
| R6 | **Mid-range tree impostors (37.19 opt 4)** | baked per-mesh G-buffer cards (kind/face/normal/mat/depth, 8 yaws, cell-res), one quad per tree 40-140 m | trees beyond LOD1 ~2 tris + 1 cell-size texel fetch; lets `maxDistM` grow 140 -> 300+ m with real silhouettes | 1.5 d engine + 0.5 d tool | parallax/pop at the card switch; light pass must shade the card's stored normal | new kind or face flag in both twins; new gpucompare pose | LOD1 content, R2 |
| R7 | **Triangle budget per species (report -> gate)** | `mesh-tri-budget.mjs` bar: LOD0 <= 6k, LOD1 <= 1.5k, LOD2 <= 400 per tree, enforced by validate-content for scatter species | keeps R2/R6 wins from regressing | 0.25 d tools | none | none | - |
| R8 | **Merged static batches per band chunk** (props, not trees) | one vertex buffer per 64 m cell for the active small props (`placementGrid` cell = batch key), rebuilt on ring change in the stream budget | draws 135 -> ~60; CPU submit -; GPU ~0 (vertex count unchanged) | 1 d | rebuild hitches if done in the swap frame (slice it) | DrawList item order changes -> gpucompare re-baseline of tie cells | STREAM-01c |

Not recommended now: indirect draws for singles/terrain (the GPU cull already covers the only numerous class, instances), meshlets, per-range cluster culling (37.19 opt 5), shader/varying trimming (measured zero).

## 2. The ASCII advantage: render at cell resolution
The final image is 86k cells. Everything that rasterises more than ~1-2 samples per cell is paying for detail the glyph grid throws away in `resolve`.

| # | Option | What | Expected | Cost | Risk | Twin | Needs |
|---|---|---|---|---|---|---|---|
| A1 | **Per-band ray count** | rays 2 near (rows below the horizon / depth < 40 m), rays 1 beyond: the raster target stays one texture; far geometry is drawn into every 2nd sub-sample via a stencil/scissor on the depth band, or (simpler) the resolve weights only sub-sample 0 for far cells and the far draw items use a half-res viewport | resolve reads -40 %, far fill -75 %; near edges keep rays 2 | 1.5 d (resolve twin + viewport logic) | two codepaths in resolve; horizon band must be conservative | resolve twin changes: re-baseline all poses | R1 |
| A2 | **Temporal reuse of the far band (US-073 stable as the base)** | the stable pass already reprojects history per cell; extend it with a "hold far cells" rule: cells with depth > 60 m and a valid reprojection skip the raster (not drawn), taking colour/glyph from history; refresh in a 1/4 checkerboard per frame | far fill and far vertex work -75 % on calm frames; 0 on fast turns (history invalid) | 2 d (pass order: raster needs a per-cell "skip" mask -> only possible as a draw-list distance split + checkerboard scissor), complex | ghosting on moving far objects (fauna/beasts far away), owner-visible; correctness rule "never wrongly culled" bends | new gpucompare sequence row | US-073 default ON first (owner look pending) |
| A3 | **Cell-resolution raster for rays 1 + sub-cell coverage by `edge`** | keep rays 1 on low/medium and recover thin-edge quality with the existing `cov` bits and the stable pass instead of super-sampling | resolve ~0.3 ms, raster ~3-4 ms at 480x180 (vertex-bound) | 0 d (preset) + 0.5 d edge tuning | thin branches/grass strokes flicker more | none | R1 numbers |

Recommendation: A1 only if R1 shows rays 2 still too slow on the iGPU; A2 is parked (big, owner-visible risk) until A1 and the carpet are in.

## 3. Grass and ground cover at scale
Cost model for the carpet (38.52, `passCarpet`, per screen cell): cost ~ traced cells x mean DDA steps x tuft tests. Measured: 3.18 ms at 480x180 before the exact-bound fixes (TUFT-PERF-01b: steps 28 -> 5.3, calls 91 -> 20 by construction, plus a trace-independent ~0.8 ms copy/fixed cost to isolate); OB-103 re-extends the walk to `radiusM`, so expect ~1.5-2.5 ms at 480x180 radius 12 m on the iGPU today, ~0.1-0.2 ms on the RTX. Density changes cost almost nothing (hash per lattice cell); radius and height are the cost knobs (steps scale ~linearly with radius / cellM).

| # | Option | What | Expected | Cost | Risk | Twin | Needs |
|---|---|---|---|---|---|---|---|
| G1 | **Finish TUFT-PERF-01a/b/c + OB-103a, then presets (OB-103b)** | measure split, exact culls, row-band scissor; preset `carpet` knob: medium `{0.5, 0.6}`, high `{1,1}`, ultra `{1.4, 1.25}` | carpet ON by default: iGPU medium <= 0.35 ms, RTX ultra ~17 m radius; **this is the single biggest visual gain for "more grass"** | 2.5 d total (already split) | straw fields stay expensive (2 m layer) | per story, carpetMeadow row, no widening | - |
| G2 | **Far grass as ground glyph pattern, not geometry** (beyond the carpet radius) | terrain shade: a second glyph tier for `grass*` types - height-field-looking `"` `'` `,` strokes with the carpet's ramp colours and a wind phase from `windAt` (colour/glyph only, no depth) | continuous look from the carpet edge to the horizon, no ring; ~0.05 ms (shade pass math) | 0.5 d (shade twin + designer glyph table) | none visual beyond taste; must stay 254-level (animated) for the stable pass | shade twin + re-pin `shadeTerrain` tests, old poses change -> re-baseline | G1 colours |
| G3 | **GPU-instanced tuft impostors for the 12-30 m band** | 1-cell-wide 2-tri cards with the OB-103 `MINW` floor, from the detail scatter (`INST_FLAG_SWAY`, exists: `tuftDrawScale`), density by cell hash | visible clumps where the carpet has thinned; ~0.3-0.5 ms per 1500 cards (vertex-bound) | 0.5 d content (detail species) + 0 engine | sub-cell flicker (38.50) if cards < 1 cell: keep >= 1 cell | none (existing path) | G1 |
| G4 | **Density masks everywhere** (MASK-a..e) | the painted grass mask + structure stamps + `cutGround`; bake-ahead with the band cache (38.58) | no grass in paths/floors, soft edges; 0 frame cost | in flight | - | carpetMeadow row | - |
| G5 | **LOD-by-cell for the carpet (per-row trace budget)** | rows near the horizon get `NMAX` 32 and `cellM` x2 lattice (coarse tufts) | carpet -30 % steps | 0.5 d | moving ring artefacts (38.52 forbids distance-sized lattice) - use the screen row, not distance | twin | after G1 only if over budget |
| G6 | **Wind on the GPU only** | already the case for instanced sway and the carpet (uniforms only); nothing to do | - | 0 | - | - | - |

Numbers: at 480x180 the carpet traces ~50-77k rays; each 1 m of radius is ~0.4-0.5 step/ray after 01b; OB-103's `radiusScale 1.4` is ~+40 % steps. Presets are the right lever (owner's "grass amount per quality preset" = `densScale` + `radiusScale`, section 6).

## 4. Props and scatter density
| # | Option | What | Expected | Cost | Risk | Twin | Needs |
|---|---|---|---|---|---|---|---|
| P1 | **Instance everything static that repeats** | placed small props (crates, barrels, fences, rocks) go through `MeshGroupSet` already; verify in F3 that singles stay <= 8; add the `prefab` kind rows to groups | draws flat as density grows; vertex cost linear in tris | 0.25 d audit | - | item order | - |
| P2 | **STREAM-01c + cell-batched residency** | finish 01c; `maxCellsPerFrame` 8 keeps ring changes smooth | lets the map hold 5-10k placements; frame cost flat | in flight | - | - | - |
| P3 | **Far "detail only on the ground texture"** | beyond `cutM`: props vanish, but the terrain type carries a tint/glyph for "ruins/field/orchard" per 2 m class cell (the carpet class map already exists) | far fields read as fields; 0 ms | 0.5 d designer + shade glyph tier (shares G2) | - | shade twin | G2 |
| P4 | **Per-species draw distance + reach class** | `maxDistM` per detail species (mushrooms 25 m, bushes 60 m, rocks 120 m) in the GPU cull (OB-089 path) | detail instances -50 % far, 0 look loss (sub-cell anyway) | 0.25 d content | - | none | - |
| P5 | **Prop LOD1/LOD2 from the generator** (`treeGen`-style rocks/bushes, 37.15 TREES-LP-f) | cheap authored LODs for the Quaternius props | vertex share of props -60 % | 1 d tools + content | look | none | - |

## 5. CPU side (JS, 8 ms budget)
Owner's frame is GPU-bound; JS is not the limit today. Node numbers (this machine, `node --expose-gc tools/bench-life.mjs`): see the appendix at the end (run during this note). Budgets 38.56 (e): life <= 0.25 ms mean, fauna <= 0.15 ms, beastSim extras <= 0.1 ms per step.

| # | Option | What | Expected | Cost | Risk | Needs |
|---|---|---|---|---|---|---|
| C1 | **Band cache + pre-bake (38.58, OB109-B1..B4)** | no terrain/scatter/collider bake in play; swaps = upload | kills the 3-24 ms swap frames and the 300-500 ms zone bakes | in flight (2 d) | memory 16 MB cap | - |
| C2 | **Worker for bakes** (terrain bands, nav grid 0.9 s, carpet mask, mesh decode) | a `tools`-free `engine/core/bakeWorker.js`: pure functions already (Terrain band bake, `buildBeastNav`, `buildCarpetMask`, mesh bin decode) run in a Worker, typed arrays transferred | the loading bar and idle bake-ahead stop stalling the main thread; frame p99 during streaming -> flat | 1.5 d (worker entry + transfer + tests in Node via `worker_threads`) | determinism: same code, same inputs -> same bytes (test by hash); no DOM in engine code (already true) | C1 (cache gives the worker a target) |
| C3 | **OffscreenCanvas** | not needed: the renderer is WebGPU on the main thread and JS render cost is ~1.5-2 ms; moving the pipeline to a worker buys nothing while GPU-bound | - | 0 | - | - |
| C4 | **WASM** | only if a Node profile shows a hot pure-math loop > 1 ms/frame (none today: render JS ~2 ms, sim < 0.5 ms); the JS twins would need a third twin | - | - | parity burden | measured need |
| C5 | **Sim LOD bands** (38.56 near/mid/far) | already specified; keep the mid band at 15 Hz | - | in flight | - | - |

## 6. Quality presets: what scales per tier
Owner idea "grass amount per quality preset" = yes, via `world.setCarpetQuality({radiusScale, densScale, minWCells})` + `scatter` + `lodScale` (all exist or are in OB-103b). Proposed table (owner to confirm; measured per row in section 7):

| preset | tier target | grid / rays | carpet (radius, dens) | detail scatter | lodScale | shadows | stable |
|---|---|---|---|---|---|---|---|
| low | old iGPU | 240x90 / 1 | off | 0.5 | 0.6 | low, instCastM 24 | on |
| medium | Intel iGPU (owner laptop) | 480x180 / **1** or 400x150 / 2 | 0.5 / 0.6 (6 m) | 0.75 | 0.8 | mid, instCastM 32 | on |
| high | Intel Arc / entry dGPU | 480x180 / 2 | 1 / 1 (12 m) | 1 | 1 | high, 48 | on |
| ultra | RTX 4060 | 480x180 / 4 | 1.4 / 1.25 (17 m) | 1 | 1.25 | high + point | on |
| extreme | RTX | 560x210 / 4 | 1.4 / 1.5 | 1 | 1.5 | high + point | on |

Rule: the iGPU preset must never rasterise more than ~2 sub-samples per cell; grass density and radius are the "more environment" knobs; `rays` is the "sharper edges" knob and is the most expensive thing in the table.

## 7. Measurement and budget table
Tools: F3 `wg pass ms` line (p50 per pass), `?f3=1`; `tools/bench-carpet.mjs` (`--split` after TUFT-PERF-01a, `INPAGE=3 CQ='{radiusScale:0.5}'`); `tools/bench-shadow.mjs`; `tools/mesh-tri-budget.mjs --pose --lod-cells`; `tools/capture-browser.mjs --mode flicker --walk`; `node --expose-gc tools/bench-life.mjs`; `tools/route-walk.mjs` poses for the p95 sweep; `?gpucompare=1` after every twin change. Missing and worth 0.25 d: a `tools/bench-presets.mjs` (CDP, like bench-carpet) that loads one pose per preset x rays and prints the pass table - it answers R1/A1/A3 in one run on each GPU.

Budget per pass at 480x180 (p95, ms), to be hit after steps 1-5:

| pass | Intel iGPU (medium, rays 1-2) | RTX 4060 (ultra, rays 4) |
|---|---|---|
| cull + hzb + cull2 | 0.3 | 0.2 |
| raster (+ raster2) | **5.0** | 3.0 |
| shadow (+ pshadow) | 1.5 | 1.5 |
| resolve | 1.3 (rays 2) / 0.4 (rays 1) | 1.5 |
| carpet | 0.35 | 0.15 |
| water + light + shade + edge + stable + sprites + overlay | 1.5 | 1.0 |
| **GPU total** | **<= 10 (frame 16.7 with margin)** | **<= 7.5** |
| JS render + sim | <= 4 + <= 1 | <= 4 + <= 1 |

## Recommended order (top 5) and target
1. **R1 + bench-presets (0.5 d, PC-A/owner laptop):** measure rays 1/2/4 at 480x180 on the iGPU; set the iGPU tier to rays <= 2. Expected: raster 15 -> 6-8, resolve 4.9 -> 1.3; frame 19 -> ~11 ms. Nothing else moves the owner's number this much for this little.
2. **G1: carpet perf stories (TUFT-PERF-01a/b/c, OB-103a/b) -> carpet ON by preset (2.5 d, PC-B):** the "more grass" ask itself; medium 6 m sparse on Intel, 12-17 m on RTX, at <= 0.35 ms iGPU.
3. **R2 + R4 + P4 (0.75 d, content + knobs):** per-species `lodCells` (TwistedTree ~300), `lodScale` 1.0 on Intel, `instCastM` 32 / `meshLod0M` 16, per-species detail `maxDistM`. Expected ~2 ms at ultra, owner look on the LOD switch.
4. **G2 + P3 far ground glyph tier (0.5 d, PC-B shade twin + designer):** grass/field/ruin character from the carpet edge to the horizon for ~0.05 ms; closes the "ring" and lets the carpet radius stay small on Intel.
5. **R3 HZB gate + R6 impostors (0.25 d measure, then 2 d):** turn `occl` on where the rule holds; then card impostors so trees can be seen to 300 m again for ~2 tris each.

Then: R5 depth pre-pass (only if rays >= 2 stays), A1 per-band rays (only if R1 is not enough), C2 bake worker (after 38.58), R7 tri-budget gate, P5 prop LODs. Parked: A2 temporal far-band reuse, WASM, OffscreenCanvas.

Target: Intel iGPU at 480x180 (rays <= 2) **<= 10 ms GPU / 60 fps with the carpet on at 6 m**; RTX 4060 at ultra **<= 7.5 ms GPU with the carpet at 17 m, trees to 300 m via impostors**.

ESCALATE TO MANAGER (small): (a) does `ultra` mean "RTX only" (then rays 4 stays) or "best the machine can do" (then GFX-02 tiering must pick rays by GPU, recommendation: tier by GPU, rays <= 2 on integrated); (b) impostors (R6) add a new G-buffer card kind in both twins - a D-039-level item, recommended after step 4 numbers.

## Appendix: bench-life (Node, this PC, 2026-10-13)
`node --expose-gc tools/bench-life.mjs --hours 1` (the 24 h `--quiet` run prints nothing by design; the 1 h run has the same per-step shape). Per fixed step, ms:

| system (goblins 48 beasts scenario) | p50 | p95 | p99.9 | max | mean |
|---|---|---|---|---|---|
| villagers | 0.002 | 0.012 | 0.27 | 1.99 | 0.005 |
| life (villagers + schedule + raids) | 0.003 | 0.013 | 0.33 | 2.00 | 0.006 |
| fauna | 0.005 | 0.020 | 0.33 | 3.94 | 0.009 |
| **beast** | **0.29** | **0.68** | **15.0** | **51.7** | 0.38 (0.79 mean "in Outwall") |
| spears | 0.008 | 0.017 | 0.38 | 2.05 | 0.010 |

Budgets 38.56 (e): all capped rows PASS (life mean 0.007-0.010 vs 0.25; fauna 0.008-0.017 vs 0.15; A* <= 1/step; 0-alloc rows PASS); one FLAG is functional, not perf (`goblin torch raid started: 0`, the forced nightly raid did not start in a 1 h window - expected for 1 h, re-check at 24 h). Reading for this proposal: the living world costs **< 1 ms per step** in total; the only CPU item worth a look is **beastSim p99.9 15 ms / max 52 ms** (one step in ~1000; the bench note attributes max to GC/OS noise, but 15 ms at p99.9 is one hitch every ~17 s and should be profiled once: `node --cpu-prof tools/bench-life.mjs --hours 1`, 0.25 d). Load-time band warm-up 197-289 ms per scenario = the 38.58 bake that moves behind the loading bar. Conclusion for section 5: no CPU work is needed for "more environment"; spend the days on the GPU items.
