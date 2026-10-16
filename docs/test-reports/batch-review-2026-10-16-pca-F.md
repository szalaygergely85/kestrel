# Arch batch review F - PC-A, 2026-10-16

Reviewer: PC-A architect (opus), using the arch-batch-review skill. Range: `git log --no-merges 10e33596..HEAD --author=Gege` on pc-a at 34e7857e, plus the merge 12a5ec0f, which carries code of its own. Pure docs, content and GI commits are skipped.
Checks run:
- `node tools/check-deps.mjs`: OK (1616 files, 89 warnings, none new in the reviewed files).
- `node tools/run-tests.mjs` on Node 24.21.0: 954 PASS, 15 FAIL, 1 WARN. The failures are triaged below.
- I re-ran the targeted suites on their own.
- I timed beastPool.test against its pre-change version (ed09892a^), run against the current code.

## Verdicts

| Item | Commits | Verdict |
|---|---|---|
| AA-07a/b + AA-01c (view-model / model glyph history, joint coverage hold) | 0f8aed3b | **ARCH OK -> po-review** (owner judges flicker by look) |
| AA-int (one HIST layout, wgslNoDup gate) | 0d0dfcc5 | **ARCH OK** |
| AA-08 (soft road/terrain patch tone) | 2aeeea8d | **ARCH OK -> po-review** |
| AA-09 (UV re-anchor on both-255 holds) | 70144729 | **ARCH OK -> po-review** |
| AA-04a/b + sky keep rule | 275dce33, merge 12a5ec0f | **ARCH CHANGES** (2 items) |
| AA-03a/b (coverage-weighted colour) | 79f99bbb, cb5dab26 | **ARCH CHANGES** (1 item) |
| AA-01 / AA-01b (flicker metrics) | bf754685, e310d175 | **ARCH OK** (dev tooling) |
| AA-06 (mesh history across planeId flips) | 3b3cbfab | **ARCH OK** |
| OB-197 (footprint bevel) | 890e34e9 | **ARCH OK** |
| OB-204 (outdoor meshes skip height fog / in-scatter) | 6e63a25a | **ARCH OK** |
| OB-205 (`World.isOutdoorAt`, z-aware) | 15ac9bfa | **ARCH OK** |
| DAWN-COLOUR-01 | b9a53ca7 | **ARCH OK -> po-review** |
| SIGNAL-ALIVE-01 | 1c551536 (+ 05276a0c palette comment) | **ARCH OK -> po-review** |
| BEAST-POOL-BIND-LATE-01 | ed09892a (+ eae0b5c1) | **ARCH CHANGES** (1 item) |
| BEAST-POOL-c-FIX | 1bc93ee8 | **ratified** (ARCH OK) |
| FLICKER-GATE-01 | 715404a4 | **ARCH CHANGES** (1 item) |
| FOLIAGE-CAP-BENCH | 869e3bf4 | **ARCH CHANGES** (1 item, one line; land it before the owner's run tonight) |
| GATE-SAVERELAY | c8baa4be | **ratified** (ARCH OK) |
| OB-192 follow-up (faunaFeed test made cap-relative) | 4a332453 | **ARCH OK** (same asserts, not weakened) |
| 38.82b design (AA-11 / AA-12) | 58b99e6b | **ratified as design, parked** (see below) |

## Notes per item

**AA-07 / AA-int.**
- 0f8aed3b alone had a duplicate `SCell.mat` member, which is a WGSL compile error. 0d0dfcc5 fixed it and added the `wgslNoDup` gate. Good.
- The HIST layout is consistent across stable, resolve, stableCompare and stableDiag: `level | kind4<<8 | vmTag<<12 | mat<<16`. KIND_GRASS = 10 still fits in 4 bits.
- The level-byte codec (`encodeLevelByte` / `levelOfByte` / `covOfByte`) is only decoded in the stable pass and stableCompare. No other consumer reads the level texture.
- Known limits:
  - `jointHold` has no bound. It holds while the coverage stays at 1/4..3/4. This is the reason AA-12 exists.
  - The JS shade twin does not produce `cov`. Parity is proven only through stableCompare, which uses GPU input. That is acceptable, because the JS path has no sub-samples.

**AA-08.** The twin and WGSL change is line-for-line. `ii` is now f32 in both and only feeds `xf`. The terrainShade "colour jumps <= 4" check became "<= 12". This re-scopes a test metric (one big step is now several small ones). It is not a D-039 threshold, so I accept it.

**AA-09.**
- The twin and WGSL change is exact, and the mutation `255 hold never re-anchors` is caught. The probe runs with both switch states.
- Accepted risk: a surface with the same planeId that really slides by less than `lim` per frame keeps a pinned glyph for the whole move (a sliding door or a lift; colour still updates). No material scrolls UVs today. If the owner sees this, gate the re-anchor on static sectors.

**AA-04a/b - ARCH CHANGES:**
1. 38.82 makes a GPU `resolve-hyst` sub-check in the stable 2-frame gpucompare row normative: `resolveCellJS(..., histKey)` on frame B with the GPU's HIST readback of frame A, 0 non-tie mismatches. It does not exist. The only check is the WGSL emulator probe (`resolve.wgsl.test.js`), yet `aaHyst` is default ON. Add the sub-check (D-039).
2. The merge commit 12a5ec0f changed the rule. It now keeps the history key, sky included, while its group has >= n²/4 samples, so "6/16 vs 10/16 flips" became "keeps".
   - I ratify the rule: it is a symmetric 1/4..3/4 band, the twin and WGSL agree, and models are excluded.
   - Required: one paragraph in architecture.md 38.82 B (PC-B architect). Also, from now on, no feature code inside merge commits: it skips review.

**AA-03a/b - ARCH CHANGES:**
1. `engine/render/coverageColour.test.js` fails on Node 24 under `--expose-gc`: "matFlatColor alloc 1283896" over 20k calls, about 64 B per call. Make `matFlatColor` 0 alloc on Node 22 and 24. Do not widen the limit (38.61, NODE24-ALLOC).

Notes:
- The WGSL path does 4 `uMatF` loads per minority sample (38.82 planned 2). That is fine if the shade GPU p95 delta stays <= +0.12 ms. Record the F3 shade ms at AA-05.
- The twin's `minor` input has no production caller, so parity is at probe level. That is acceptable: the JS path has n = 1.

**OB-204 / OB-205.**
- `isOutdoorAt` runs once per frame and allocates nothing (scratch `_grid`). It has a test.
- The OB-204 switch is per frame, so outdoor sector walls also skip height fog. That is consistent with terrain.

**DAWN-COLOUR-01: does it also fix NIGHT-HAZE-01's far fog at night?** No, it only changes dawn.
- It changes 05:00-07:30: night@5 -> dawn@6.25 -> morning@7.5.
- The night slot (21:00-05:00) is untouched. Night far fog is still NIGHT-HAZE-01's own slot (f5de91c4, ARCH OK on PC-B).
- The biome haze driver has 3 slots, so dawn haze uses the dusk slot, while fogHour has its own dawn colour. This small mismatch is acceptable.
- Code checks:
  - The fogHour key packing is collision-free (t3 * 2^22, under 2^53).
  - `apply` still allocates nothing.
- Nit: the fogHour.test 06:54 assert is a tautology (`a || b` is always true).

**SIGNAL-ALIVE-01 (D-112).** The sequence is right:
- `.- .-.. .. ...- .`, 13 marks.
- Timing: dot 0.25 / dash 0.75 / gap 0.25 / letter gap 0.75 / pause 2.5. The cycle is 2.5 + 2.25 + 2.0 + 3.0 + 2.5 = 12.25 s.
- `decode(steps) == 'ALIVE'` is tested.
- The title frames, map card, menu text and Bend relay `pulseFactor` all read `ASSETS.signal`.

No SOS is left in engine, game, design or content code. Leftovers:
- the `tools/verify-ch12-run.mjs` lines 1 and 228 labels (nit);
- docs/story.md (writer item SIGNAL-ALIVE-TEXT).

**BEAST-POOL-BIND-LATE-01 - ARCH CHANGES:**
1. `beastPool.test.js` takes 10.9 s on its own. With the pre-change test file against the same code it takes 4.0 s, so the new block adds about 7 s (rule: under about 5 s). Cut the block, for example to 6 scan phases (0, 5, 11, 17, 23, 29), or warm one sim and branch it per phase. It must still fail with `markHot` reverted. Report the before/after time.

**Overflow answer:** `markHot` drops the record when 64 are queued (and drops duplicates by a linear search). A dropped record falls back to the sliced scan, which binds it within <= 59 steps. Nothing is corrupted, and bound, down, camp-dormant and dead records are re-validated. This is acceptable.
- 0 alloc per step: Int16Array, no closures.
- Non-blocking: `hot` / `hotN` (like `phase` / `nc`) are not in the dev snapshot. This is fine, because the persistent save does not store pool slots.

**FLICKER-GATE-01 - ARCH CHANGES:**
1. `newestCapture()` takes the newest `*-flicker-live-grid.json` in `captures/` whatever its age. If capture-browser exits 0 without writing (the startup failures the handoff reports happen in about 50 % of runs), the gate compares a stale capture. Fix: take the file's mtime and require it to be >= the time the spawn started, else FAIL.

Gating note: do not use the gate as a merge gate until FLICKER-METRIC-DET lands. The metric is bimodal (wallNear 5.2 vs 7.6 %), which is far above the +0.3 margin. After that, set the margins from the measured run-to-run spread, or gate on the median of 3 runs.

**FOLIAGE-CAP-BENCH - does it measure what the owner runs tonight?** Mostly yes.
- The command line is the documented one.
- It uses the same launch flags, 480x180 grid and `wgPipeline.stats` source as bench-presets.
- The D-085 limits are right: RTX 8 ms at every preset, Intel 10 ms at high, no limit for Intel ultra.
- Tris are counted as placement LOD0 `triCount`, the same unit as `FOLIAGE_TRI_CAP`. Distant LOD and impostor draws are therefore part of the measured cost, which is what the cap means.

ARCH CHANGES:
1. The verdict uses `pct(gpu95 snapshots, 0.95)`. That is about the maximum of the rolling 120-frame p95 over the 10 s window, so one upload or hitch spike decides the cap. It is also stricter than the bench-presets D-085 gate, which uses the median of P50 snapshots. Use the median of the `gpuMsP95` snapshots (= the window's p95) for the D-085 verdict, and keep the max as an extra column. This is one line. Land it before the owner's run, or the run has to be repeated.

Runtime risk (not blocking): it has never run in a browser. "no tree meshes harvested" at roadSouth or a missing `__debug.look` is possible. The port guard requires 9500-9998, which also applies on PC-A, and 9725 is fine.

**38.82b (AA-11 / AA-12): ratified as design, parked.**
- AA-12 measured worse and AA-11 was inconclusive. Neither is judged until FLICKER-METRIC-DET.
- The AA-12 branch reads GI.y bit 11 as `histLine` instead of the HIST level byte. That deviates from 38.82b and needs a note in any re-submit.
- The `temporalStable.test.js` "OB-193 far wall limit" assert is confirmed dead: it sits after the `ALL PASS` exit and asks for an impossible value (`== 0.02 && > 1/16`). Since AA-11a is parked, make the 38.82b fix (vd = 40, expect 0.1, move the block above the exit) a 10-minute item of its own now.

## Failing suites outside this batch's scope (Node 24, alloc)

`node tools/run-tests.mjs` on Node 24 also fails these. None was touched in this range, and all are alloc gates:

| Suite | Failure |
|---|---|
| beastSim.hunt | P5, 105 B per call |
| compositor.alloc | known (RENDER-ALLOC-01-GATE), 12.5 s |
| contactAO | alloc |
| passLight.pointShadow | 5144 B / 20k runs |
| waterComposite.alloc | known (WATER-ALLOC-01-FIX), 50 KB per call |
| leafFall | step allocs |
| lookBake | 2.24 B per call |
| raySegment | 17.5 B per call vs ALLOC_EXEMPT 15.2 |
| spearView | alloc |

animation, geoMap, burlEscort, content-smoke and archPatch pass when run on their own (fails under load only).

NODE24-ALLOC is marked done (37f6c96a), but these fail on PC-A's Node 24: reopen it with this list. Do not widen any limit.

## Next steps
- **PC-B programmers:**
  - AA-04c: the gpucompare `resolve-hyst` sub-check.
  - AA-03a fix: matFlatColor 0 alloc on Node 24.
  - BIND-LATE: cut the test time.
  - FLICKER-GATE: mtime guard.
  - FOLIAGE-CAP-BENCH: median of the p95 snapshots, before the owner's run.
  - The temporalStable dead-assert fix.
  - NODE24-ALLOC: reopen.
- **PC-B architect:** add the 38.82 B paragraph for the n²/4 sky keep rule.
- **PO:** po-review AA-07/08/09 (owner walk on the road for flicker), DAWN-COLOUR-01 (06:15 look) and SIGNAL-ALIVE-01 (title preview + Bend relay blink).
