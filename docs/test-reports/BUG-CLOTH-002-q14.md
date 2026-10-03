# BUG-CLOTH-002 - stairwell cloth physics (2026-10-03)

Status: arch-review for the save/load change; NEEDS PC-A: PO review / owner stairwell look.

The real GPU feed already calls markDrawn correctly, and main.js already supplies the player capsule before each cloth tick. A visible cloth wakes on contact and runs; off-screen cloth sleeps as specified. The shipped world has no wind, so the stairwell canvas settles almost still. Added the small draft allowed by the bug row: a local 0.6 m/s northward zone, soft 0.5 m edge, push:false. Outside the stairwell stays calm; the draft cannot push the player. No canvas geometry, sleep rules or main.js changes.

The regression also reproduced a save/load issue: deserialize reconstructed the world without its authored wind. It now reads wind from the registered world content, keeping wind/cloth buffers out of saved state. The restoration assertion failed before this correction and passes afterwards.

New game/js/quest/clothPhysics.test.js loads the game-bound assets and actual world/tower content. It runs setBody -> tick -> markDrawn, matching the game fixed-step/render order. Checks: local draft and exterior calm, no player push, visible sway (0.1336 m maximum node displacement), rest sleep in calm air, wake and capsule displacement (0.3600 m), and authored-draft save/load restoration. Pins and physical collision behavior are provided by the existing cloth simulation.

Live headless real GPU mesh probe, own no-cache server on 9580 / CDP 9581: placed the player at (1497.5,1021.7), facing the cloth (yaw 180), resumed the actual game loop through the debug look state. After 524 steps: awake=1, bodyCount=1, lastDrawn=524, version=584, node movement=0.1166 m. The player integrates normally at stair floor z=0.6. Initial paused state had zero cloth steps and bodies, as expected. This is a debug-assisted simulation check; the owner's normal walk-through and preferred appearance still need review.

Full runner: 202/202 suites PASS, no FAIL/TIMEOUT/WARN. check-deps OK (365 files, existing warnings); canonical content 5/5. Browser/server stopped, temporary probe moved out of the repo. Engine render code and gameplay input are untouched.
