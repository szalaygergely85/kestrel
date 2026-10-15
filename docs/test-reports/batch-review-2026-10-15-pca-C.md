# Arch batch re-review C (PC-A, 2026-10-15)

Scope: PC-B re-submits of the ARCH CHANGES in `batch-review-2026-10-15-pca-A.md` / `-pca-B.md`. Diff-only, checked against each numbered item. Probes run on PC-A (Node v24.21.0, `--expose-gc`). `node tools/check-deps.mjs`: OK (1518 files, 83 warnings, none new from these items).

Commits: e9d0374a (REV-S6), 0e03c3be (REV-ANIM), c02c0d11 (REV-ANIM-2), cfb4b003 (REV-NAV + REV-BEASTALLOC), 12712465 (REV-BEASTALLOC-2), 96b7cac6 (REV-ENV02D), 545a8cf7 (REV-MAIN), 5b8a8d89 (REV-LOGIC).

## Verdicts

| Item | Verdict |
|---|---|
| QFIX-S6 / S6b | **ARCH OK -> po-review**. Items 1-3 are done: saved-only structures are dropped and logged; `currentContentIds` comes from the current structures; `dynamics` is skipped for absent ids; z is kept only when `\|dz\| <= 0.05`. Cases a/b/c are in contentWins.test (a and b fail with the fix reverted). |
| ANIM-C-04 | **ARCH OK -> po-review**. feedLegs now uses allocProbe, and yaw goes through `driver.io[3]`. It passed 4/4 runs on PC-A with the 32 KB threshold unchanged. |
| ANIM-BLEND-01a | **ARCH CHANGES (still open)**. The `_sa` scratch landed, but blend.test "layered pose: 0 B/call" still fails on Node 24.21 (1.84 / 1.94 / 2.19 B/call against < 1, 3 runs). Next step: measure as a delta against the null-layers baseline (stated in the test), or find the remaining source. The threshold stays. |
| ANIM-BLEND-01b | **ARCH OK -> po-review**. animBlend.test takes 1.0 s; `totMs` is set at pack time (voxelPack/blendPack). |
| ANIM-BLEND-01c | **ARCH CHANGES (still open)**. The legDriver/fadeMs scratch landed, but animBlendLegs "0 B/step blender + driver" still fails on PC-A: 1.38 / 1.35 / 0.98 against < 0.5. It got worse because n went 100k -> 50k. Find the source; do not trade it away with probe size. |
| NAV-LAYERS-01c | **ARCH CHANGES (still open)**. The LQ scratch halved the garbage, but layersFlow "0 alloc ... steer.step" still grows a deterministic 24208 B per 200 iterations (about 120 B/iter; was 48192). The gate fails at cfb4b003 and at HEAD. Bisect the remaining source with the same method as before. Candidates: `smoothPath` z output, `findPathCells`, or the non-Q `locate`/`dirAt` wrappers still on the steer path. |
| ENV-02d p2 / p3 / LIVE | **ARCH OK -> po-review**. Items 1-2 are done: `nearLookWorld`/`farLookWorld` are set only on upload; `setGroundLook` bumps `farVersion`; both have tests. Item 3 is in REV-MAIN. Item 4 (budget) remains the ENV-BUDGET main-session measurement, needed before close. |
| ENV-03 main wiring | **ARCH OK -> po-review**. (1) The JS grade/post runs only when `!fb.gpu`, after fade/dim. (2) `snap()` on a world change (`world:loaded`, restart) and on a > 50 m jump inside the driver. (3) outdoor requires `w.terrain`. Item 4 (budget) goes to ENV-BUDGET. |
| BEAST-ALLOC-01 / 02 / 02b | **ARCH CHANGES (still open)**. The parity test is OK (3600 points, three modes). The split broke the alloc gates on PC-A. beastSim.core gives beast8 own 8.5 against < 8 (1 of 2 runs). beastSim.hunt fails 3 every run: LIFE-07 own 32 / full 46-50, LIFE-08 own 32, and P5 102-107 against < 100. Before cfb4b003 the old single file was clean (life07 1.5, life08 0.9). Cause: the probes were cut to `{ n: 1500, warm: 4 }` (with `n: 5000` in a scratch copy, LIFE-07/08 pass again). The split also moved P5 over its cap. hunt also takes 5.9-8.8 s (rule: < ~5 s). Fix: restore probe length and warm-up (or a separate `beastAlloc.test.js`), keep every file <= ~5 s, and make all gates pass on PC-A without changing thresholds. |
| ED-LOGIC-01a | **ARCH OK -> po-review**. Items 1-4 are done, with 8 new assertions: events are saved as `[kind, argName, value]`, rev-checked pending rows, `r: blockId` resume with 40 actions, and the `todo` snapshot before phase 1. Old saves still load (an old intern-id event is dropped). logic, logicWire and farmAmbush are green. |

## Next steps
- kestrel-3: ANIM-BLEND-01a, ANIM-BLEND-01c, NAV-LAYERS-01c. Each alloc gate must pass on PC-A's Node 24.21; probe sizes and thresholds stay as they are.
- kestrel-2: BEAST-ALLOC-FIX, with the probe length restored, P5 fixed, and both files <= ~5 s.
- Main session: ENV-BUDGET (bench-presets look/atmos deltas) before ENV-02d / ENV-03c close. The OK items go to the PO batch.
