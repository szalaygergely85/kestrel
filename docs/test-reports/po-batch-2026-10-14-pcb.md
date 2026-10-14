# PO batch 2026-10-14 (PC-B, claims-only, nothing run)

Basis: ARCH OK in batch-review-2026-10-14-pcb.md batches 2-5 and the lane entries. I did not re-read the code and ran nothing.

| Item | Verdict |
|---|---|
| ENV-01a (+fix) JS twin | PO OK -> testing |
| ENV-01b (+fix) | PO OK -> testing |
| ENV-01c (+fix) WGSL module | PO OK -> testing |
| ENV-01d (+fix) | PO OK -> testing |
| ENV-01-WIRE (+fix) | PO OK -> testing, with a gap (below). The claimed verify-decor result is PASS, count 2019, 0 frame errors. |
| GATE-FLAKY-02a/b/c + part A/B | PO OK (engine-internal, no owner test). Claim: 3 full run-tests runs green, 718/719. |
| GATE-FLAKY-03 (bvh raycastRay) | PO OK (engine-internal, no owner test) |
| GATE-FLAKY-04 (World.raySegmentRay) | PO OK (engine-internal, no owner test). The remaining 12.1 B/call is the Terrain.groundAt boxed return, which the architect accepted as an exemption. |

## Gaps (not passes)
- gpucompare row decorFord was a NEW FAIL (98.3 % kind match). The run's tree changed mid-run, so the result is not trustworthy. A clean re-run is pending. ENV-01 cannot go to done until decorFord passes.
- decorMeadow PASS. This is a claim, not re-checked.
- The owner has not seen GPU decor yet.
- I did not check the ENV-01 ACs (docs/pc-b-queue.md, architecture.md 38.62 Steps) item by item, so these OKs rest on ARCH OK plus the lane claims.

## Owner walk-test (ENV-01, owner-visible)
1. Open the game at the meadow, then at the ford, with the default (GPU decor). Check that grass, flowers and rocks show up, with no flicker or pop-in, no holes, and no console errors.
2. Reload with `?decor=cpu` at the same spots and compare density and species mix with the default. They should look the same, or very close.

## Owner to-do
- Do the ENV-01 walk-test at the meadow and the ford, default against `?decor=cpu`.
- Have the main session run a clean `?gpucompare=1` for decorFord, with the tree untouched during the run.
- Report any visual difference as an OB-NNN row in docs/bugs.md.
- After the decorFord re-run and the walk-test both pass, mark ENV-01 as done.
