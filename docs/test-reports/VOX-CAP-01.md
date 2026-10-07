# VOX-CAP-01 programmer verification - 2026-10-05

Queue 16 item 4; architecture 37.7; clean baseline 09b6fa5. Status: **arch-review**.

Mesh pools now accept 48 voxel entities; the frozen renderer retains its 16-slot constant and gets the specified upload overflow guard. Renderer assignment updates the active cap immediately. Raw records, nearest-selection arrays, projected poses and shadow poses are allocated for 48 at construction; projected records survive shrink/regrow. Overflow warnings name the active cap and are formatted only once per cap. Below-cap entity order and above-cap nearest-first selection are preserved.

Files: engine/voxel/VoxelModel.js, engine/index.js, engine/render/voxelPool.js + test, engine/render/gpu/GpuCellPipeline.js, comments in engine/render/viewModel.js and engine/mesh/DrawList.js, engine/mesh/voxelMesh.test.js. One extra harness line in game/js/dev/modes/gpucompare.js sets its separate pool renderer before collecting; otherwise mesh parity would silently keep testing the old 16-prop list. Existing unrelated Ruins/sword/render changes are excluded from this commit.

## Checks

- voxelPool: 40 assertions PASS, including 30 entities below cap, nearest 48 of 60, warn once, both projection lists, renderer switching, shrink/regrow identity, mesh push feed and GPU overflow guard. Three 1,000-frame collect/project/shadow/switch trials: minimum post-GC heap growth 240 bytes, below the existing 64 KB gate; all preallocated record identities preserved.
- voxelMesh: 213 assertions PASS, including 48 unique objectIds and slot 47 id 0x802F below unit/view-model ranges.
- Working tree: 227/227 suites PASS; isolated proposed code: 225/225 PASS; no FAIL/TIMEOUT/WARN. Both dependency checks OK (391/389 files respectively), including content validation and typecheck. main.js is unchanged.
- Clean live browser at renderer=mesh, grid=400x150 on port 9534: gl2 pool cap 48; all 20 world voxel entities queued, all 20 shadow-projected; 17 are tower props. The spec's 21 count predates lever removal. No content entity added to match the old count. Stair landing camera (1499.5,1027.8,4.6), yaw280/pitch-10: 13 projected survivors (normal screen culling), capture inspected after advancing the startup fade; no missing queue entries or browser exceptions. Floor lamps remain sprites.
- Local RTX4060 CPU collect + project + addVoxelInstances, 600 measured frames after 60 warm frames: p50 0, p95 0.10000000894069672 ms, maximum 0.20000000298023224 ms (browser clock quantized). Below 0.35 ms CPU budget. F3 read once; per-pass GPU timings n/a, so the extra-GPU <=0.3 ms p95 bar remains **NEEDS PC-A: owner Arc benchmark**. The single startup GPU timer result is not a performance verdict.
- No frozen-renderer browser checks performed. Full runner retains its existing regression suites. No shader expression, comparison threshold or capture-pose changes.

## Clean mesh GPU comparison

Baseline and proposed code: 70 rows at 160x60, RTX4060 ANGLE/D3D11. **Zero prior-PASS regression; nine existing FAIL rows have byte-identical metrics.** Eight PASS rows change as additional props become available; the other 62 rows are unchanged. Crash room, lamp empty and open stair landing metrics are unchanged (their visible props already fell inside nearest 16). Capture JSONs were deleted after comparison; diagnostic copies and the stair screenshot stay outside the commit.

Changed rows below list CPU/GPU kind-8 counts (equal in every case) and checked matched-geometry cells. All remain PASS with zero geometry/AO/light violations; no threshold widening.

| Pose | Kind-8 before -> after | Matched cells before -> after |
|---|---|---|
| world_m1: breach | 0 -> 11 | 5064 -> 5029 |
| world_m1: breachDown | 0 -> 8 | 9196 -> 9169 |
| world_m1: parapetSky | 0 -> 2 | 719 -> 713 |
| world_m1: signal tower | 0 -> 12 | 4115 -> 4079 |
| world_m1: terrainNearTower | 52 -> 61 | 6582 -> 6571 |
| world_m1: bandEdge | 55 -> 66 | 4946 -> 4936 |
| world_m1: rtsOverlay (RE-07b, pitched -58 at the tower, 30 rings + 30 bars + rect) | 102 -> 107 | 7230 -> 7230 |
| world_m1: detailWalkout (ENV-01a2, ground scatter) | 186 -> 195 | 7281 -> 7267 |

Known-FAIL baseline below is unchanged under D-039. Geometry columns are mesh8a geomViol / geomViolCells / violNonK8; AO is cmpGeom.aoViol; light is cmpLight.dLViol; colour is k8Outside / fgMaxNonK8 / bgMaxNonK8. Lamp-empty remains PREC-03; other failures retain their existing precision follow-ups.

| Pose | Geometry | AO | Light | Colour | Glyph mismatch / match % |
|---|---|---|---|---|---|
| world_m1: lamp empty (post pickup) | 35 / 34 / 33 | 33 | 3 | 7 / 40 / 7 | 9 / 99.89526358664028 |
| world_m1: voxel half occluded (stair edge) | 0 / 0 / 0 | 0 | 0 | 9 / 87 / 21 | 59 / 99.33114159392359 |
| world_m1: rtsHill60 (RE-02a pitched RTS view, hillside) | 0 / 0 / 0 | 0 | 0 | 1 / 136 / 44 | 12 / 99.8741610738255 |
| world_m1: fpLevel0 (RE-02b first person, pitched default) | 6 / 3 / 0 | 0 | 3 | 14 / 47 / 23 | 34 / 99.60488088320744 |
| world_m1: cloth (CLOTH-1b2, 16x12 banner built through the system, 6 m/s wind x 120 steps then frozen, sun az 135 el 30) | 0 / 0 / 0 | 0 | 0 | 0 / 136 / 44 | 9 / 99.83161833489243 |
| world_m1: viewModel rest pitch 0 (US-078a, held sword, crash room) | 10 / 4 / 0 | 0 | 3 | 14 / 38 / 17 | 37 / 99.5512975988358 |
| world_m1: viewModel rest pitch 0 PITCHED CAMERA (BUG-VM-001, held sword, crash room) | 10 / 4 / 0 | 0 | 3 | 14 / 38 / 17 | 37 / 99.5512975988358 |
| world_m1: viewModel rest pitch 20 PITCHED CAMERA (BUG-VM-001, held sword, crash room) | 9 / 4 / 1 | 0 | 2 | 10 / 40 / 16 | 20 / 99.7677659080353 |
| world_m1: forestWalk (ME-06c3, dense canopy) | 10 / 3 / 0 | 0 | 3 | 120 / 0 / 0 | 115 / 97.71780115102203 |

Both pitched view-model rows still have one item in each twin and vmOk=true. Sunlit mismatches are zero in all nine known-FAIL rows. Lit-flip fractions: fpLevel0 0.00010416666666666667; both viewModel pitch0 rows 0.00020833333333333335; viewModel pitch20 0.00020885547201336674; all others 0.

## Addendum 2026-10-07 (HANDS-01c): `handsSwapped` recorded as D-039 known-FAIL

Row `world_m1: viewModel handsSwapped (HANDS-01c, sword right = mirrored + spell glove left, crash room)`, 240x90 grid, RTX4060 ANGLE/D3D11, baseline = 8174d21 in the clean worktree (144 rows, 27 FAIL before and after, 0 status changes).
Architect 2026-10-07: det<0 path is correct in both twins; the residue is the edge-on voxel-face coverage tie. Confirmed with `cmpLight.dLSample` (new, diagnostic only): first dL cell idx 8767 = col 127 / row 54, kind 8, face 7 (both twins), objectId 15 (both), JS normal (-0.388, 0.2096, 0.8975) vs GPU (-0.5993, 0.6824, -0.4186), angle 90.004 deg (not 180).
Metrics (must not get worse): faceViol 1, depthViol 1, uvViol 5, nrmViol 5 (nrmMaxDeg 90.004), dLViol 3 (dLMax 0.0626), kind 100 %, fgMax 188 (fgMaxNonK8 4), vmItems 2/2, vmOk true.
