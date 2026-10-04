# BUG-CLOTH-002 cheek-wall passage — PC-B, 2026-10-04

Implemented Q15 priority B's PC-A placement decision. Tower column 18, row 4 changes from solid `c` (1.4 m cheek wall) to the existing non-solid `3` stair landing (0.9 m). This is one content cell. The original stair run, remaining cheek wall, canvas and mason's mark stay intact.

Replacing the wall with ground-level `.` was tested and rejected: it lowered the player into a pocket between the remaining solid wall and the adjacent 0.9 m stair, trapping the exact owner approach at (1498.3, 1022.3, 0). The matching stair landing allows passage without changing collision rules or cloth simulation.

Regression uses the owner's pose (1500.14, 1022.57, 1.8), yaw 276, pitch -17, forward for 180 fixed ticks. In grid and mesh physics the whole capsule clears the canvas row within 2.050 s and ends at (1494.667855, 1021.348128, -0.15). Contact-on and contact-off player trajectories match exactly. Comparing simulated fabric with and without capsule contact under the same wind shows 0.7762 m maximum parting beyond wind-only motion. The burner artwork still has no physical body.

Validation:

- Focused clothPhysics suite PASS (31 assertions); canonical content 9/9 PASS.
- Working tree 222/222 suites PASS; isolated publish candidate 219/219 PASS; dependency check, typecheck and content validation PASS.
- Real browser, mesh renderer at 400×150, both grid and mesh physics: actual game update/render callbacks complete all 180 steps from the owner pose and reach the same endpoint (mesh z differs only by Float32 rounding). Fabric movement is 0.7526 m; bodyCount 1; no browser exceptions.
- Full mesh route reaches the end trigger. No frozen dda renderer checks, render changes, cinematic tuning or clips.

Status: **NEEDS PC-A: PO review / owner walk-test**. The obstruction correction and regressions are implemented; the bug remains open until the owner confirms passage in the game. Forest/Ruins/sword investigations remain separate and their unpublished local changes are preserved. Next runnable Q15 item: ENV-01a1 ground-detail data.
