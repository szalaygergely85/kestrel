# Test report BUG-LIGHT-001 – Surface light-pass CPU/GPU parity

Result: PASS

Tested at commit 171c42c (worktree `../game_project_test`), own server port 9009 (stopped after; port 8000 untouched).

Criteria:
- [x] `?gpucompare=1`: `light: OK` on every row except the `BUG-OWN-001` pose (expected `light: MISMATCH`, dLViol 3 — pre-existing owner repro, carried by BUG-CAST-001 per the architect review). All 13 other poses PASS light; same 13/14 overall PASS set as before, "boulder mid-roll" is the sole FAIL and is a geometry (kind/silhouette-edge) mismatch, not light — fgMax 102 (sun on) / 77 (`&sun=0`), matching the numbers already documented under BUG-CAST-001.
- [x] `?gpucompare=1&sun=0`: same pattern, light OK everywhere except OWN-001; boulder mid-roll geometry FAIL (fgMax 77) unchanged.
- [x] `node engine/render/lighting.test.js`: 116 passed, 0 failed.
- [x] `node engine/render/gpu/gpuCompare.test.js`: 35 passed, 0 failed.
- [x] `node tools/check-deps.mjs`: OK (127 files).
- [x] `node --expose-gc tools/bench-cast.mjs --gc`: checksums match the embedded baseline in every run (glyph mismatches=0, color-tolerance violations=0); the v2-total-vs-3.5ms escalation-trigger timing flips PASS/FAIL across repeated runs (2.8–7.2 ms) purely from machine load — not a correctness regression and not in scope for this bug (perf budget is US-018). Checksums are the correctness signal and are always OK.
- [x] No console errors during `?gpucompare=1`, `?gpucompare=1&sun=0`, or a plain load.
- [~] Tower visual spot-check: headless pointer lock is unavailable in this environment (matches prior tester notes), so a live click-through play wasn't possible; instead relied on the in-game tower poses already exercised by `?gpucompare=1` ("crash room", "lever mid-pull", "relay at distance", "lamp empty"), which all render with `light: OK` and clean shading (fgOut 0, fgMax <=1) — lighting looks correct at those poses.

Bugs: none found. BUG-LIGHT-001 scope (point-light/sun light-pass parity) is fixed; the remaining boulder-mid-roll FAIL is geometry/kind-edge, already re-filed as BUG-CAST-001 and correctly excluded from this story's acceptance.

Performance: not separately measured beyond bench-cast; no stutter observed during manual navigation.

Console errors: none.

Suggestions (non-blocking): none.
