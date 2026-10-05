# ME-15f - shadow casters by distance (PC-A programmer, 2026-10-05)

Machine: Intel Arc iGPU (0x7D45, D3D11/ANGLE), headless Chrome, route walk 400x150, forest on. Default NOT flipped.

## Change
- `shadowList.js`: RE-06 groups with `src.eye` are bucketed per instance by horizontal eye distance: <= `meshLod0M` 25 m LOD0, <= `instCastM` 48 m LOD1, beyond none, +-2 m hysteresis (`g.shadowBand`), plus the shadow-plane sphere cull, in one loop (`fillShadowBands` in `instances.js`). No `src.eye` = old path (full `g.ib`, LOD0).
- `instances.js`: group gets engine-owned `shadowIb[2]`, `shadowCount[2]`, `shadowBand`; camera `drawIb/drawCount` untouched.
- `shadowSun.js`: defaults `meshLod0M 25`, `instCastM 48`, validation `0 < meshLod0M <= instCastM`. `compositor.js` + `GpuCellPipeline.js` feed `src.eye/meshLod0M/instCastM`. `main.js`: `?shadowinst=N`.
- Tests: `shadowList.test.js` (+16: exact band counts, hysteresis at 25 and 48, bit-equal rows, camera buffers unchanged, planes drop, no-eye path, 0 alloc over 1000 builds, castShadow:false), `shadowSun.test.js` (+2).

## Results
- `node tools/run-tests.mjs`: 222/223 PASS; the one FAIL (`engine/world/terrain.test.js`) passes alone (35/35) = timing flake under load. check-deps OK.
- gpucompare `--shadows map`: FAIL = crash room, lamp empty, viewModel rest pitch 20 PITCHED, forestWalk. The dda run (same tree) fails crash room, lamp empty, rest pitch 0 PITCHED, rest pitch 20 PITCHED, forestWalk: all D-039 dLViol-family, none instanced-related (sun-map sunlit mismatch 0 on crash room; forestWalk map: light pass true, glyph 97.74 % vs 97.7 before, sunlit mismatch 1 cell). 0 map-only FAIL. Shadow depth parity PASS on all poses.

## Bench (GPU ms, p50 / p95; shadow pass p50)
| run | p50 | p95 | shadow pass p50 |
|---|---|---|---|
| dda (2 runs) | 9.28 / 9.53 | 11.30 / 12.13 | - |
| map skip, 48 m (2 runs) | 10.49 / 10.97 | 14.71 / 15.57 | 3.24 / 3.26 |
| map `--noskip 1`, 48 m | 11.44 | 14.22 | 3.33 |
| map skip, `shadowinst=32` | 10.58 | 13.32 | 2.16 |
| map noskip, `shadowinst=32` | 10.78 | 13.66 | 2.77 |
Before (ME-15e): dda p95 14.5-18.1, map skip p95 24.76 (shadow pass p50 9.23), noskip 29.25 (10.55). Shadow pass -65 %.
Delta vs dda (means of dda 11.7 p95): skip 48 m +3.4, noskip 48 m +2.5, skip 32 m +1.6, noskip 32 m +2.0. Bars +1.0 / +1.5: NOT met (32 m closer, still missed). `shadowCpuMs` p95 0.6-0.7 ms (item 12 bar 0.15; list build + hash, not re-split here). 10/10 route legs complete in all runs.

## Next
Per amendment 5: ME-15g (coarse shadow-only hull per voxel model for the LOD1 band) and/or cut the remaining non-forest pass cost (terrain ~62k tris, 20 voxel props); owner forestWalk look check not done (default not flipped).
