# BUG-VM-001 left-hand publication — PC-B, 2026-10-05

Status: arch-review; PC-A PO/owner walk-test remains (left-hand sword, right-to-left swing, matching trail).

The existing pitched-camera fix is retained. This completes its requested header/rotation tests and publishes the prescribed left-hand asset mirror. `swordForHand(left|right)` reflects rest, every authored clip, signed bob and lead edge once at binding; main selects `SWORD_CFG.hand` (left by default). Tip/mid trail mounts reflect through the existing view-model transform.

D-040 and the new architecture 37.8a supersede the earlier `sweepRtoL` proposal: original right-hand arc bounds remain as `_R` with a compatibility alias, `_L` negates only local x, and light/hard entry latch the sim hand. `setHand` affects the next swing; both values enter the deterministic hash. No reversed slice index. Full per-handle geometry/winding reflection (D-042), hand slots, input routing and inventory remain HANDS-01 after TORCH-01a; this factory is initial binding only, not the future runtime swap mechanism.

Files: design/models/sword.js; engine/render/viewModel.js + test; game/js/main.js; game/js/dev/modes/gpucompare.js (only the two pitched poses use permitted yaw 40); game/js/quest/swordConfig.js; game/js/quest/sim/sword.js + test; tools/sword-left.test.mjs.

## Verification

- Working full runner: 228/228 PASS, 0 FAIL/TIMEOUT/WARN. Isolated story checkout: 227/227 PASS. Both include typecheck, content validation and deps. Standalone deps: working 395 files/1298 warnings, isolated 394/1296 warnings, check-deps OK; existing warnings unchanged.
- Sword sim 92/92; asset/actual tip+mid mounts 124/124; view model 55/55. Light/charged both hands, missing-hand default, invalid hand, mid-swing swaps, next-swing order, existing heap check. Pitched rotation orthonormal/determinant +1 within 1e-9; tip screen-lock within 0.5 cell at yaw 0/37/225 and pitch 0/±20.
- Real GPU mesh default at 160x60 (tool rejects explicit `--variant mesh`; omitted per its current API). Compared with clean merged 9f30c70: 71 rows, all 65 non-sword rows byte-identical, no prior-PASS regression, nine known FAILs reduce to seven. Four shear poses retain yaw 30 and pass; pitched yaw 40 pitch 0 improves to PASS, pitch 20 retains the accepted scene AO FAIL. Five hillside metrics changed after PC-A e72727f, reproduced exactly in its clean baseline. Later 9701c0f sync is docs-only.
- Clean mesh route on port 9580: all 10 legs complete, end trigger true, 1798 frames, 485 trees/17014 detail placements.
- Live browser on port 9564: real sword.take handler removes prop, sets taken flag, draws one sword at negative eye x; real Mouse0 tap drives poses and trail segments; R restart returns hidden/untaken. This is a handler/input smoke, not an owner interaction walk-test.
- Hidden diagnostic at yaw 40: both twins report zero view-model items. Pitch 0: geometry cells 1, non-K8 0, AO 0. Pitch 20: geometry cells 1, non-K8 1, AO 1. Visibility assertions intentionally fail when hidden. No runtime exceptions.
- First post-sync full capture timed out; fresh-port retry, live probe and baseline completed. Owned servers/browser profiles stopped; generated capture JSON deleted after extracting metrics.

## Exact sword metrics and D-039 baseline

Existing thresholds remain unchanged. PREC-03 owns the scene AO cell (87,8), kind 1, same face/plane: AO JS 3.482539176940918 / GPU 0.9997844696044922. With sword shown, pitch 20 has 2 geometry cells (one sword crease and that scene cell); hidden probe isolates the scene cell.

| Pose | Result | Geometry cells | Non-K8 | AO violations | Normal max deg | Outside cells | FG/BG max | Light max delta | VM GPU/JS |
|---|---|---|---|---|---|---|---|---|---|
| world_m1: viewModel rest pitch 0 (US-078a, held sword, crash room) | PASS | 1 | 0 | 0 | 89.99907064662477 | 19 | 80/17 | 0.0006035566329956055 | —/— |
| world_m1: viewModel rest pitch 30 (US-078a, held sword, crash room) | PASS | 2 | 0 | 0 | 88.85625189667701 | 12 | 116/22 | 0.00018963217735290527 | —/— |
| world_m1: viewModel swingLR t=160 pitch 0 (US-078a, held sword, crash room) | PASS | 3 | 0 | 0 | 89.99990381210975 | 42 | 61/17 | 0.0006035566329956055 | —/— |
| world_m1: viewModel swingLR t=160 pitch 30 (US-078a, held sword, crash room) | PASS | 3 | 0 | 0 | 90.00190950369326 | 48 | 141/18 | 0.00025404244661331177 | —/— |
| world_m1: viewModel rest pitch 0 PITCHED CAMERA (BUG-VM-001, held sword, crash room) | PASS | 3 | 0 | 0 | 89.99728930842262 | 14 | 101/18 | 0.000720679759979248 | 1/1 |
| world_m1: viewModel rest pitch 20 PITCHED CAMERA (BUG-VM-001, held sword, crash room) | known FAIL: PREC-03 | 2 | 1 | 1 | 89.99839461337535 | 20 | 94/15 | 0.04497206211090088 | 1/1 |

Pitched pitch-20 additional baseline: geometry violations 4; depth 0, UV 1, face 0, z 1, normal 1, holes 0; glyph mismatches 16/8830 (99.81879954699886% match); outside fraction 0.002087464774031938; K8 outside 16; non-K8 FG max 26; light delta violations 3, lit flips 0. Both pitched shown poses vmOk=true (1 item per twin).
