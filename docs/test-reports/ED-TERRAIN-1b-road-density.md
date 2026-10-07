# ED-TERRAIN-1b: full-detail roadside merge follow-up (PC-B, 2026-10-07)

Merged PC-A `c0bf843`, preserving PREC-04 tie masks and PC-B HANDS-01c light diagnostics. A real-GPU gpucompare run on each branch gave the same 20 FAIL / 124 PASS rows (144 total), with zero PASS-to-FAIL changes. No thresholds or GLSL changed.

The merged terrain-stroke check failed at 179.4 ms in isolation and 180.7 ms under CPU profiling, above its unchanged 150 ms limit. The profile attributed 121 ms over four refresh calls to the anonymous structure-box scan in `scatterDetail`: every candidate visited up to 329 structure boxes.

`scatterDetail` now builds a tile index of expanded structure AABBs once per scatter call. Candidates check only their tile's boxes, using the same inclusive bounds. It does not cache mutable placements across strokes, alter RNG order, skip exclusions or change terrain/geometry.

The independent regression oracle scatters without structures, brute-force filters against 301 boxes, then compares count and every x/y/z/yaw/species/radius field with the indexed output. It covers negative coordinates, tile boundaries, boxes outside the near band and overlapping extents. `scatterDetail.test.js`: 49 checks. `terrainStroke.test.js`: 12 checks, including fresh-load equivalence for scatter and colliders.

Two isolated runs: first stroke 123.7 / 115.9 ms; warm repeat 109.9 / 105.6 ms. Tree/detail counts remain 454 / 16141. No owner-visible art change.

Shipment checks: 261/261 suites PASS; check-deps OK (462 files, existing warnings); validate-content 3233 checks. Real-GPU mesh browser route at 400x150 reaches the end trigger. Engine status: arch-review.
