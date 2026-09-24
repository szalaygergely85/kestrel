# Test report BUG-CAST-001 – Thin wall-top (TOP) band caster/GPU disagreement

Result: PASS

Verified against worktree `game_project_test` @ 284a106 (ARCH OK). Own server on port 9013, stopped after; port 8000 untouched.

Criteria:
- [x] `?gpucompare=1` 14/14 PASS (all rows, including "world_m1: boulder mid-roll")
- [x] `?gpucompare=1&sun=0` 14/14 PASS
- [x] boulder mid-roll fgMax 1 (<= 64 required)
- [x] edgeKindMismatch 0 on all rows except "facing stair + 1.0m platform" 1/1057 (pre-existing/unrelated, as documented)
- [x] `node engine/render/sectorCaster.cap.test.js` — 100 passed, 0 failed
- [x] `node engine/render/gpu/gpuCompare.test.js` — 35 passed, 0 failed
- [x] `node engine/render/lighting.test.js` — 116 passed, 0 failed
- [x] `node tools/check-deps.mjs` — OK (127 files)
- [x] `node --expose-gc tools/bench-cast.mjs --gc` — checksums, geometry/edge-rule, GC, heap-delta and flicker-metric checks all OK; only the v2-timing-vs-3.5ms-trigger check FAILed twice (best p50 4.806ms / 5.707ms), consistent with the known machine-load noise called out in the task, not a regression
- [x] Quick visual look at `?gpu=0` — no console errors; pointer-lock "Click to resume" overlay did not release in this automated browser (environment limitation, not exercised as a blocking criterion here since the numeric gpucompare checks already cover tower stairs/cap geometry)

Bugs: none found.

Performance: bench-cast checksums/geometry/GC all OK; timing check flaked on machine load (documented as expected, not gating).

Console errors: none observed (gpucompare pages and `?gpu=0`).

Suggestions (non-blocking): none.

Note: BUG-LIGHT-002 (row 25d, OWN-001 dLViol 3) remains open/out of scope, as expected — `world_m1: BUG-OWN-001 owner repro` row shows `light: MISMATCH dLViol 3` while still counted PASS overall (light mismatch not yet gated per architect notes).
