# BUG-RTS-002: RTS page content scripts

2026-10-08, lane C. The dev page now loads the current game page's classic
content scripts in the same order, including the missing environment model
packs, item/UI definitions and water looks. Optional local voxel content uses
the same removable script as game/index.html. No bootstrap or renderer change.

Real GPU headless Chrome, 400x150, WebGL2 mesh: page loads world_m1 and 200
units without an unknown-model exception. Physical box selection selected six
own units; clicking an own unit selected one. Interaction capture ran 1,231
frames, with no exception/error; the existing warning about five unregistered
gameplay behaviours is expected in this standalone RTS bootstrap.

Inspected captures/rts-content/400x150-page.png: terrain, tower and cyan
selection rings are visible; F3 and bottom control text are readable. Units
remain small/dark against the busy world, an existing RTS look limitation;
this fix restores content availability rather than changing unit art.

The existing ?bench=1 hook required no implementation. A separate run
completed 300 measured frames at 400x150 with 200 units: GPU p50 5.012 ms,
p95 5.848 ms, instances 100, culled 156, lod1 0. Null per-pass queries remain
informational as documented in the hook; this is not the PC-A iGPU delta gate.

Preview: game/rts-test.html?grid=400x150&f3=1 (add &bench=1 for the finite
benchmark). Scratch probes use tools/serve.py with no-cache headers and ports
9842/9843 and 9844/9845, then stop only their own server/browser. No frozen
renderer checks were run. Owner world bytes and all other pages are preserved.

Full 306/306 suites PASS, 0 FAIL/TIMEOUT/WARN. check-deps OK (524 files,
existing 1,356 warnings); diff check clean.
