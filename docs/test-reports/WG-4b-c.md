# WG-4b follow-up (c): per-group version key for the shadow dirty-skip

Change: `WgShadowPass._gpuHash` no longer walks the GPU-owned instance rows. Key part 2 = eye cell (floor x, floor y; 1 m, unchanged) + per GPU-owned group
(`g.id`, `g.ib.version`, `g.count`). O(groups) per frame.

Version bumps (engine/mesh/instances.js): `InstanceBuffer.version`; `writeUnitInstance` bumps only when the 16 row words actually change (a static unit
rewritten every frame keeps skipping); `touchInstances(ib)` for raw `f32/u32` writers; `feedDetail` (scatterFeed.js, raw u32 copies) bumps every group on a refeed;
`MeshGroupSet` rebuilds create new groups (new `id`). `makeInstanceGroup` assigns a unique `id`.

Band state: kept CPU-parity by keeping the 1 m eye cell (the kernel's band hysteresis depends on the exact eye; an exact per-instance slack needs a row walk).
The sun-box frustum part is already in key[0] (sun matrix hash). Not stricter than before; unchanged re-render rule on eye motion.

## Renders / skips (Node, device mock, 1240-instance fixture: 700 trees + 500 voxel units GPU-owned, 40 CPU fallback; dirtySkip on; scripted walk)
| route | gpucull on (version key) | gpucull off (CPU list hash) |
|---|---|---|
| walk ~4.5 m/s, 1800 frames (30 s, 135 m) | 324 renders / 1476 skips | 636 renders / 1164 skips |
| idle 600 frames | 1 / 599 | 1 / 599 |

Key cost (1200 GPU rows): old row walk 56.2 us/call, new version key 0.09 us/call. Shadow prep CPU per frame on the walk: 0.025 ms (on) vs 0.042 ms (off).
Renders on = one per 1 m eye cell crossed (~ expected); off re-renders on every CPU-list change (band flip / frustum entry). No live browser walk was run
(main.js is being edited by another agent); the numbers are from the scripted pose sequence.

## Tests (passShadowCull.test.js, dirty-skip block)
static scene skips; raw write + `touchInstances` re-renders; `writeUnitInstance` changed row bumps / identical rewrite does not (skips); count change re-renders;
eye crossing a cell re-renders; skip frames read 0 GPU-owned rows (Proxy count); heap flat over 1000 frames (existing block, +26 KB < 64 KB).

## Gates
`node tools/run-tests.mjs`: 302 suites, 302 PASS, 0 FAIL, 0 WARN. `node tools/check-deps.mjs`: OK (515 files).
`capture-browser.mjs --mode gpucompare --port 9551 --backend webgpu`: 146 rows, 140 PASS / 6 FAIL (same six rows as baseline: crash room, lamp empty, voxel half occluded,
viewModel pitch 20, handsSwapped, forestWalk); all shadowDepth rows PASS; no threshold touched.

Open: exact band-flip pickup is still the 1 m eye cell (see above); raw writers of `ib.f32/u32` outside the engine must call `touchInstances(ib)` (none found in game/).
