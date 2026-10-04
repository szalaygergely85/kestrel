# US-142a2 waterfall views — PC-B implementation check, 2026-10-04

The test cliff has a 6 m wide, 8 m high waterfall, a sheltered walkable alcove, a circular plunge pool and two live viewpoints. Existing palette colours/materials are reused. `design/preview/waterfall.html` shows the front and back together; its walk links preserve ordinary game input/pause behavior.

Content numbers are listed in the preview: fall speed 10 m/s, alpha .75; lip 12/s, spray 48/s, mist 16/s; rings every .7 s, 32 points, initial radius .18 m, expansion 1.6 m/s, life 1.5 s. Pool radius 3.2 m, depth .9 m, outward flow .7 m/s. Foot emitters use the exact ballistic landing point (9, 8.916629695, 0). Four persistent emitters and 188 particle slots per fall; eight falls fit the shared 2048-particle/64-emitter limits (1504/32).

`WaterLayer.bindWorld` disposes cached sheet vertex/index buffers when the world identity changes, preserving targets/clipmap. The mesh pipeline calls it before drawing. Game hooks rebuild on world load and update rings through the particle SoA without per-frame allocations.

Validation:

- 29/29 waterfall hook/content/particle checks, including real `World.load`, malformed-drop validation, budget, growing/fading rings, disposal and a warmed 20,000-tick heap gate; 10/10 sheet-cache lifecycle checks.
- Working tree: 221/221 suites PASS, dependency check OK. Isolated publish candidate: 219/219 suites PASS, dependency check OK. Canonical-content validation and typecheck are included.
- Real GPU, mesh, 400×150, NVIDIA RTX 4060/D3D11: front water p95 .058368 ms; back .091136 ms (bar < .25 ms). Composite p95 .058368/.077824 ms. Both views retain one sheet/one pool and 126/130 live particles; camera positions checked separately. No browser exceptions.
- Full mesh GPU comparison: 68 rows, four existing baseline FAIL rows (voxel half occlusion, rtsHill60, cloth, pitched sword rest), zero new FAIL rows.
- Mesh route walk after final viewpoint fix reaches the end trigger. No frozen dda checks were run.

Deviations: the owner requested views before clips; no waterfall cinematic path, capture or world_m1 placement is added. The dedicated test cliff and preview fulfill the current content ACs. Ramp `|:'` interprets the row's escaped Markdown pipe literally; tuning remains for PC-A/owner visual review. Engine cache change -> arch-review; content -> NEEDS PC-A: PO review / owner look. Arc measurements remain PC-A hardware work.
