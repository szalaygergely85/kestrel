# ENV-01a2 ground-detail draw feed — 2026-10-05

PC-B Q16 item 2, architecture.md 37.4 including the group-dedup amendment. Implementation complete -> arch-review; owner appearance/content tuning and Arc performance review remain on PC-A (ENV-01b/c).

The canonical 17,003 placements bind to 19 render groups, or 25 with the six tree groups, without changing the 32-group cap or the recipe. Render keys use model/shadow/lodCells; species indices, collider definitions and placement order remain intact. The binding holds load-time master words with unique 0x40000 IDs, a Uint8 species-to-group table (255 for inactive species), and capacity min(group placement count,maxDraw). The nearest-tile feeder copies exact words, respects per-placement radii and the global cap, and skips writes for camera moves below refeedM. Main rendering feeds once before both twins; load/world swaps and comparison poses force a feed, and the engine helper also honors cam.teleport. Shadow opt-out is shared by the JS/GPU caster list. Instance upload capacity is now 4096. Ground-detail scripts and mesh/mesh flags are wired, with F3 fed/culled/LOD1 counters.

Previous scatter groups are removed before throwing validation, per the forest review amendment. If detail validation fails after tree creation, those new tree groups are also removed. Save/load rebuilds the binding; unloading leaves zero scatter groups.

Changed files: engine/mesh/scatterFeed.js and its test; instances.js/test; shadowList.js/test; engine/core/engine.js and scatterInstances.test.js; engine/index.js; game/index.html; game/js/main.js; game/js/dev/modes/gpucompare.js. The last file's existing unrelated Ruins/sword changes were excluded from the index. Other pre-existing local code/content/assets remain untouched and unpublished.

## Checks

- 177 focused assertions: feeder 73, core lifecycle 33, instances 55, shadow list 16. Includes 20 independent brute-force eye positions, shared-key word equality/capacity, separate shadow/LOD keys, inactive species mapping, canonical 19-group bind, no-write memo, forced feed, failures without stale groups and unload. The 1000-frame GC walk retains stable buffers (heap delta -71,384 B in the first focused run).
- Full working tree: 226/226 suites PASS. Isolated intended commit on 6e44d0c: 224/224 PASS. Both dependency checks OK; typecheck and content checks included in the full runner.
- Real mesh route at 400x150 reaches the end trigger, all 10 legs complete. First launch failed before __debug initialized; retry passed.
- Real RTX 4060 GPU parity: isolated clean 6e44d0c baseline has 69 rows, nine existing FAILs. After this change there are 70 rows: every existing metric is identical, and detailWalkout PASS. The working tree similarly has zero prior-PASS regressions (70 -> 71 rows, eight existing FAILs because its unrelated sword/Ruins patches differ).
- detailWalkout: kind 100%, zero holes/geometry/AO/light violations; glyph 99.9588%, three colour-outlier cells (one kind 8), k8 coverage 186 on each twin. Shadow-map pose PASS; depth parity 99.998748% within the slope bar, coverage mismatch 0.0000953674%. Thresholds/shaders unchanged.
- Live walk-out screenshot inspected: detail visible beside the clear path, F3 fed 240. Save round-trip: 17,003 placements,19 detail groups,25 total; disabling trees/detail unloads to0. The screenshot and generated capture JSON/PNGs were removed after inspection.

## Timing / remaining PC-A work

Local RTX 4060,400x150,300 settling frames per static sample: forced feed averaged0.0216-0.0314 ms (1000 refeeds), below0.1 ms. Walk-out fed240; forest fed354 (one LOD1 in the combined registry). These are local diagnostics, not the required Arc gate.

GPU p95 samples are noisy: walk-out on7.769 ms vs off11.029 ms; forest both6.953 ms vs neither1.704 ms. A separately booted shadows=map page confirms46 caster items and map p95 about0.0014 ms at the static walk-out, but total p95 was8.207 ms on vs10.032 ms off; forest both12.498 ms vs neither5.858 ms. Forest combined cost exceeds the1.5 ms bar on this machine. NEEDS PC-A: measure/tune ENV-01b/c on the owner's Arc, and separate imported-tree cost from ground detail before declaring the GPU budget met. No content/tree tuning is folded into this draw-feed step.

The off samples use World's detail/realTrees options with the same shaders. Existing ?detail=0 also selects the older material look and disables the GPU shading gate, so that URL is not a like-for-like GPU benchmark. Its scatter-disable wiring follows37.4 unchanged.

No additional implementation deviation from37.4. Owner walk-test and architectural review remain pending. Next queue item: TOWER-LEVER-01, then PROP-COLLIDE-01.
