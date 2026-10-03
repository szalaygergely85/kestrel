# BUG-CLOTH-002 - stairwell cloth physics (2026-10-03)

Status: arch-review for the save/load change; NEEDS PC-A: PO review / owner stairwell look.

The real GPU feed already calls markDrawn correctly, and main.js already supplies the player capsule before each cloth tick. A visible cloth wakes on contact and runs; off-screen cloth sleeps as specified. The shipped world has no wind, so the stairwell canvas settles almost still. Added the small draft allowed by the bug row: a local 0.6 m/s northward zone, soft 0.5 m edge, push:false. Outside the stairwell stays calm; the draft cannot push the player. No canvas geometry, sleep rules or main.js changes.

The regression also reproduced a save/load issue: deserialize reconstructed the world without its authored wind. It now reads wind from the registered world content, keeping wind/cloth buffers out of saved state. The restoration assertion failed before this correction and passes afterwards.

New game/js/quest/clothPhysics.test.js loads the game-bound assets and actual world/tower content. It runs setBody -> tick -> markDrawn, matching the game fixed-step/render order. Checks: local draft and exterior calm, no player push, visible sway (0.1336 m maximum node displacement), rest sleep in calm air, wake and capsule displacement (0.3600 m), and authored-draft save/load restoration. Pins and physical collision behavior are provided by the existing cloth simulation.

Live headless real GPU mesh probe, own no-cache server on 9580 / CDP 9581: placed the player at (1497.5,1021.7), facing the cloth (yaw 180), resumed the actual game loop through the debug look state. After 524 steps: awake=1, bodyCount=1, lastDrawn=524, version=584, node movement=0.1166 m. The player integrates normally at stair floor z=0.6. Initial paused state had zero cloth steps and bodies, as expected. This is a debug-assisted simulation check; the owner's normal walk-through and preferred appearance still need review.

Full runner: 202/202 suites PASS, no FAIL/TIMEOUT/WARN. check-deps OK (365 files, existing warnings); canonical content 5/5. Browser/server stopped, temporary probe moved out of the repo. Engine render code and gameplay input are untouched.

## Owner passage follow-up

The complete Node route walker, with all game-bound model registrations loaded, passes all nine legs for both grid and mesh physics, including stairs and the final trigger. The closed-grate leg is correctly blocked as expected. The stock Node entry alone lacks the sword registration; a temporary bootstrap supplied the actual game script registrations without changing runtime code.

Real-browser direct movement check on no-cache ports 9582 (mesh/mesh) and 9584 (dda/grid): set the player at world (1496.5,1021.5,0.3), face east and supply KeyW through the game input. Both advance across the cloth-covered steps to (1499.7,1021.5,1.2). The endpoint meets the existing wall where the route turns south. This establishes passage along the authored stair route, not every possible approach through the fabric. The longer browser route driver did not return its final report and was interrupted; no complete browser-route PASS is claimed.

World.js builds burnerFire as a sprite without a body (only dynamic props receive bodies). World colliders derive from structure geometry; cloth collider boxes constrain fabric nodes only. No blocker fix was inferred from appearance. NEEDS PC-A: owner F3 position, approach direction and physics mode for the blocked case; if the desired route crosses the sheet at local y=4 instead of the stairs at y=3.5, provide the approved geometry/placement correction.

## Exact owner pose and earlier-version comparison

Investigated owner world (1500.14,1022.57,1.80), yaw276, pitch-17. Default game physics is grid even with renderer=mesh (main.js only opts into mesh physics with physics=mesh).

The stop is reproduced transiently: grid clamps x to 1499.3 while the player slides north along the wall. This is radius 0.3 east of the col18/19 boundary. Tower col18,row4 is authored solid `c`, the 1.4m stair-cheek wall; its description explicitly limits entry to the stair base. capsule.js's existing MAP_FORMAT v2 contract blocks solid cells at ANY height. The eye is outside the cloth bbox during the blocked interval. BurnerFire has no body; cloth's collider boxes constrain the fabric, not world movement.

Node simulation held forward for three fixed-step seconds (real integration + sector animation + rollers + body contacts, cloth tick before rollers / render mark after the step). Grid ends (1495.667855,1021.348128,0); mesh ends (1494.559448,1022.290559,-0.300000012). Both advance beyond the canvas area. Disabling cloth gives exactly the same full x/y/z trajectory in each mode. Grid has a temporary blocked-X interval; mesh has none on this approach.

Baseline f49a714 compared in the specified isolated ../game_project_test checkout. All sampled movement steps and both final positions are exactly identical to the current version, with cloth both enabled and disabled. The baseline already clamps x1499.3 at steps30/60/90. There is no failing endpoint pair for a binary bisect, so no breaking commit can truthfully be named. No git bisect marks were invented.

Normal browser URL (renderer=mesh, F3, default grid physics), own no-cache server9586/CDP9587, actual game input and loop: debug setup represents the owner already awake (wakeT100, map dismissed, look locked). A first three-wall-second check included a startup interval with zero sim steps, then reached the temporary wall stop; the extended check continues past it. Sample at wakeT103.2667 is (1494.739634,1021.3,-0.15), beyond the cloth, before reaching the next authored wall at x1494.3. Cloth awake/bodyCount become1 during movement; the eye is outside the fabric at the blocked samples. This is debug-assisted live movement evidence, not an owner walk-test verdict.

Added owner-pose regressions to game/js/quest/clothPhysics.test.js: full step-by-step movement equality with/without cloth in grid and mesh, three-second passage beyond the cheek corner, and non-solid fire artwork. The existing sway/contact/save-load checks still pass. No runtime geometry, physics, collision or input change.

NEEDS PC-A: decide whether the authored solid cheek wall `c` is intended on this approach or revise the wall/canvas placement. Changing height semantics for all solid grid cells would contradict the existing physics contract and requires an architect specification. Owner walk-test still required; BUG-CLOTH-002 remains open for that decision.

Verification: 202/202 suites PASS, no FAIL/TIMEOUT/WARN; check-deps OK (366 files, existing warnings). Temporary probes removed; only own browser/server processes stopped. Comparison checkout left clean at f49a714 for follow-up.

## Post-sync verification (2026-10-04)

Merged PC-A ME-14c1 bab88e6, preserving the uncommitted sword debug probe. Full runner 203/203 PASS. check-deps OK. Full mesh GPU comparison: 66 poses, same four earlier non-water FAIL rows, no new FAIL. Both browser routes reach the end trigger (mesh9592, dda9602, own no-cache servers). Mesh route flags falls on upper-steps/summit/outcrop/hillside legs; DDA reports no falls but uses the lever interaction fallback. These are recorded for PC-A and are not claimed as a clean owner playthrough. The first concurrently launched DDA route never exposed debug state; isolated DDA startup and the sequential fresh-profile retry succeed. All own servers/browsers stopped and generated capture removed.
