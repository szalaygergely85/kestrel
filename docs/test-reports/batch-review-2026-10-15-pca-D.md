# Arch batch review D (PC-A, 2026-10-15)

Scope: engine-touching non-merge commits in `7d4e3ebe..HEAD` (b69b9304), without REV-*/-FIX re-submits and docs. Diff-only review, with probes where something looked wrong. Node v24.21.0 on PC-A.
- `node tools/check-deps.mjs`: OK (1518 files, 83 warnings). None are new rule breaks from these items. `validateUnder.js` origin math is load-time only. engine/physics stays stand-alone, and the engine imports no game/ or design/ code.
- `node tools/run-tests.mjs`: 902 suites, 884 PASS, 17 FAIL. 9 of the FAILs pass when run alone (parallel-load flakes). 8 also fail when run alone on Node 24. Only waterComposite.alloc (and maybe riverRibbon) are in this batch (see WATER-ALLOC-01). The other 6 (animBlendLegs, impostorCard, layersFlow, bvh, blend, beastSim.hunt) are older work or REV items. All 8 are alloc probes.
- PC-B architects already reviewed many of these items (lanes/pc-b1.md batches of 2026-10-15). Where marked "ratified", I re-read the diff and agree.

## Verdicts

| Item | Commits | Verdict |
|---|---|---|
| VOX-PRIO-01 | f2500725 | ARCH OK -> po-review (ratified; skip PO, engine bug) |
| LOD-RESET-01 | 230954fe, 8c730586, 9ceae836 | ARCH OK -> po-review (ratified the PC-B re-review: shadow cull band + GPU reset when wgActive) |
| BEAST-06a WIRE + main hook | 1e9e1b8a, 545a8cf7 (director part), 5ef95352 | ARCH OK -> po-review. Matches answer c: `resetSlot`, Int16Array slot->group at bind, gid `<region>/<group>`, own `spawnDirector.v1` key with respawnAt = seconds remaining, single save path. The BH2-E1 resetAll issue stays in its own row |
| BEAST-09a | 782296ad, c2ac09b4, e6727938 | ARCH OK -> po-review (ratified; crocs now have their own group counter) |
| BEAST-POOL-a / b | 3456672a, 3acf2319, cea78180 | ARCH OK -> po-review (ratified) |
| BEAST-POOL-c | 26db21ab | ARCH CHANGES: 1 (test runtime) |
| SIM-SPIKE-01 | 0c15b7ef | ARCH OK -> po-review (ratified) |
| GI-PROBE-01 / 02a / 02b / 07 | 04e7f656, da4952de, a46f3f0a, 524be53f | ARCH OK. Deterministic bake, no RNG, header + hash, manifest |
| GI-PROBE-02c | 814e7491 | ARCH OK. ASK answer: ~113 B/ray in `bvh.raycastRay` is fine, because it only runs in the offline bake tool, never per frame |
| GI-PROBE-03 | 8b7c36d2 | ARCH CHANGES: 2, 3 |
| GI-PROBE-04 / 04-perf / 04b (+ 93f27402) | 158c52c4, 904714ab, ce100a01 | ARCH OK as the oracle twin, together with GI-PROBE-06 item 4. Advisory A1 |
| GI-PROBE-05 | 113e58fb | ARCH OK -> po-review, gated (gate G1). Parity is 0/255 on 12800 points x 4 states; with GI off the WGSL and pipelines are byte-identical |
| GI-PROBE-06 (went to po-review without arch) | b3eaed59 + main.js | ARCH CHANGES: 4 |
| GI-SHIP-01 | b80773c6, 762b2a7b, 09047fb9 | ARCH CHANGES: 5 (blocked by item 2). Advisory A2 |
| UNDER-00b / 00c | 8cb3e1b7, 5a1b82a8 (+ skip-with-warn in 52a73baa) | ARCH OK -> po-review (ratified; the 00c condition landed: placeStructure returns null with one warn, World.load skips it, no other caller) |
| UNDER-03 (engine part) | 52a73baa | ARCH OK -> po-review |
| UNDER-01 / 02 / 07 / 08 | f9e93eaa, 385a8fbd, 1082e3cb, 50233ec4 | No engine change, goes to the PO. underSkeletons is rng-free. Audio `Math.random` is not sim code. 3 grid structures, under the cap of 8 |
| VOX-MESH-CACHE-01 re-review | fcce8175, 89c9afa4 | ARCH OK -> po-review. Both PC-B items are covered (6 builds in 1000 frames, no growth; a version bump frees every stale entry; release/dispose; cap-4 eviction) |
| WATER-FINISH-01a | 2fd9f497 | ARCH OK -> po-review (ratified). Carry the PC-B causticAt == causticHit assert into item 6 |
| WATER-ALLOC-01 | bf54ed30 | ARCH CHANGES: 6 |
| CONTACT-AO-01a / 01b | 184c1475, 3b0d729b | ARCH OK -> po-review (ratified; JS twin is oracle-only per the PC-B ruling) |
| SHADOW-TRIM-01 + HIDE-EXTREME-01 | 7d5318da | ARCH OK -> po-review (ratified) |
| SPRITE-LIGHT-CACHE-01 | 3529a8fe | ARCH OK -> po-review (ratified) |
| MESH-FEED-GRID-01 | 8c774385 | ARCH OK -> po-review (ratified) |
| WIND-GUST-01 | 90316d4e | ARCH OK -> po-review (ratified; the swayWindy re-baseline is a main-session gpucompare step) |
| PERF-JS-01 | beadaea8 | ARCH OK -> close (tools/profiling only) |
| WGSL-LINT-SWEEP | 6a969add | ARCH OK (ratified; a stale exception fails the test, 0.5 s) |
| ENG-API-01a / b / c / d-g | cc941dac, 9fdccf29, 48fd2f0b, e392a189 | ARCH OK -> po-review (manifest == exports, deprecated() has no per-call alloc, rule 21/22) |
| ANIM-IK-01 / 01b | 1b1019c8, 7b1020bf (+22bead2c) | ARCH OK -> po-review. footIk is 0 alloc (probe), IK-off hash unchanged, MAX_PARTS 16 == MAX_VOX_PARTS |
| B1-MAIN hooks 3 (footIkWire) | fc0013c0 | ARCH CHANGES: 7 |
| ANIM-C-04b | 34777d48 | ARCH OK -> po-review |
| ANIM-LOOKAT-01 (engine part) | efc73b85 | ARCH OK |
| BH-A1 | a50285f1 | ARCH OK (`activateAgent` = addAgent body at a fixed slot) |
| OB-174 `choiceFlag` | 206c8e9e | ARCH OK |
| OB-184 / OB-184b / SAPLINGS / OB-166 / ATLAS-GUARD / OB-189 | 7d39c5ba, 9228db49, 019b932b, 08707661, d8247d90, bca518ed, c4c15499, badde9d6 | ARCH OK (ratified PC-B) |
| GATE-FIX-12, GATE-FLAKY-08, integ1/integ2 test fixes | 56666684, 07cd314e, e9515756, 224269e9 | ARCH OK (test-only) |

## Required changes

1. **BEAST-POOL-c:** `beastPoolWorld.test.js` takes 7.3 s alone (5.5 s in the parallel run), over the ~5 s rule. Shorten the night walk or the step count, or move the p50/p99 timing part to `tools/bench-life.mjs`. The pool-max / kill / Continue / respawn asserts stay.
2. **GI-PROBE-03: grid worlds never fetch GI.** `World.loadGI` calls `loadAll(this.terrainBands && !this.terrainGrid ? ids : [])`, and nothing calls `loadGIZone`. world_m1 ships `terrainGrid`, so no `.gi.bin` is ever requested and `world.giField` stays null in the game. `giLoader.test` hides this because it deletes `terrainGrid` from the def. Fix: in a grid world, `loadGI` requests the live band's zone. `_gridFill` (or the bake-ahead pick) calls `this.giLoader.load(z.id)` once per zone (the loader remembers misses; one promise per zone, not per frame). `_giArrived` already attaches the field and flips it.
3. **GI-PROBE-03 test:** keep `terrainGrid` in one giLoader.test case. After the fetches settle, the start band's `giField` must be non-null, and a swap to another baked zone must flip it to that zone's field. The test must fail with item 2 reverted.
4. **GI-PROBE-06: GI only on the WebGPU path.** The JS twin costs +2.4 ms (terrain) + 0.9 ms (surfaces) at 240x90, over the 2 ms budget in 38.72 section 5. Treat it as oracle-only, like CONTACT-AO and groundLook. `giWire` / `giCfg` must be null when `!wgActive`, so the Canvas2D/WebGL2 fallback and the JS gameplay path run today's ambient. gpucompare and Node still set `LightSet.gi` themselves.
5. **GI-SHIP-01:** depends on item 2 (today the 5 MB of shipped files are never loaded). After item 2, the main session runs one headless check: `world.giField` is non-null in the start zone, plus the 4 GI gpucompare rows.
6. **WATER-ALLOC-01 does not hold on Node 24.** `waterComposite.alloc.test` fails: pitched 50 587 B/call (limit 1024); shear 209 B/call is fine. `riverRibbon.test` (with `--expose-gc`) also fails its zero-alloc check: 123 KB over 100 frames vs < 64 KB. Likely cause: `unprojW` forwards `_w[k]` as a double argument into the non-inlined `unprojectPitched`, and the rest of the pitched branch is not inlined on V8 12.x. Give projection an io-scratch variant (depth read from a Float64Array) and re-probe with `--trace-deopt` if needed. Both suites must pass on Node 22 and on Node 24. Do not raise LIMIT.
7. **footIkWire uses `world.terrain` as ground.** It ignores structures, mesh floors, bridge decks, ford stones and the crypt stair. Within +-0.6 m of terrain (tower ground floor, ramps, bridge ends) the feet snap to the terrain under the floor. Pass a 0-alloc adapter whose `groundAt(x, y)` uses the world support query (`supportAtOut` with the player's foot z, floor height or null). Add one test: on a placed floor 0.2 m above terrain, w stays 0.

## Gates and advisories

- **G1 (GI-PROBE-05, main session, before PO):** run the 4 gpucompare rows `giMeadowNoon`, `giForestDusk`, `giRuinInterior`, `giEmisNight`, and record the D-085 on-minus-off GPU bench (`--query gi=0` vs on; RTX all presets, Intel high) against 38.72 section 5 (0.25 / 0.06 ms). The GPU has no memo: each GI cell decodes 8 probes x 40 channels. If the bench is over budget, set `GI_PRESET.medium = false` before PO.
- **A1:** `GI_CACHE` = 65536 slots is about 8 MB per GIState. It is allocated on the first `lightAt` with GI, which also happens on the GPU path (sprites). Use 8192 slots, or size the cache from the field.
- **A2:** `bake-gi` uses one world-wide input hash, so any placement edit makes all 5 zones stale (85 s re-bake). Move to per-zone input hashes when edits get frequent.
- **Cross-cutting (not this batch):** on Node 24, alloc probes also fail in animBlendLegs, impostorCard (compactGroup 307 KB/300 frames), layersFlow (24 KB), bvh (5-9 B/call), blend (2 B/call) and beastSim.hunt (P5 106 B/step, LIFE-07/08 32-48 B/step). Route these to the REV re-review / main session before the next master merge.
