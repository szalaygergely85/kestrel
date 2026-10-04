# ME-06c3 forest render — NEEDS PC-A, 2026-10-04

Local implementation binds six species groups (473 trees) at world load, writes exact RE-06 instance words with unique `0x20000 | placementIndex` IDs, removes owned groups on load/swap, and retains unrelated unit groups. Game flags enable trees only with mesh renderer + mesh physics; `?trees=0` disables them. Restart forwards those options. Forest models are loaded after sb_objects.js.

The new mesh-only `forestWalk` uses a separately loaded tree-enabled world. Existing comparison rows keep their original tree-disabled worlds. The camera is in the densest 30 m disc nearest spawn, approximately (1364.04, 966.31), ground + standing eye height, yaw 270, pitch +30, with trunk-clearance validation. Species groups are bound only for this pose and unloaded afterward. No cinematic paths or clips changed (owner hold).

Checks: 23 binding/lifecycle/error-guard checks PASS; isolated 220/220 suites PASS, working tree 222/222 PASS, deps/typecheck OK. Mesh route reaches end trigger. Real-GPU 400×150 forest view shows trunks around and canopy overhead; 473 placements = six group counts 108/87/80/45/79/74, 56 drawn + 417 culled. Browser restart retains all 473 trees and removes old groups; switching to trees-off leaves zero groups. No browser exceptions. Arc budget belongs to ME-06c5, not measured here.

**GPU gate fails:** real RTX 4060/D3D11 mesh comparison at 160×60 has 69 rows: the four unchanged baseline failures plus new forestWalk. Forest metrics:

- Kind matches 100%; zero holes/non-kind-8 geometry violations; light PASS (sunlit mismatch 0, dL max 1.19e-7).
- One non-edge kind-8 geometry disagreement at cell (105,48): material 65 JS vs 59 GPU, depths 5.702 vs 8.067. Geometry totals: depth/UV/z violations 1 each; face/AO/normal violations 0.
- 66 kind-8 colour-outlier cells (0.852% of 7745 non-sky); glyph match 99.198%; foreground max difference 118, background 15; non-kind-8 foreground/background differences 0.
- Colour sample cells include (22,0), (29,0), (32,0), (52,0), (62,0), (66,0), (89,0), (90,1), (91,1), (122,1). Existing limits have not been relaxed.

Binding audit: both twins read identical Float32 instance words through unchanged writeUnitInstance; placement IDs are unique and their new high bit is preserved. Existing JS instancing composes I*P in float64 while the vertex shader composes part position and instance row dot products in float32. This appears to expose existing arbitrary-yaw, large-world voxel precision/look-hash differences; it is not proven solely by the metrics. No shader change is authorized by 37.2's binding task.

**NEEDS PC-A: ASK ARCHITECT:** provide the scoped JS/GLSL precision/shading fix or an explicit decision for forestWalk's one kind-8 geometry tie and 66 colour outliers. Local engine/game implementation stays unpublished until the new pose passes. ENV-01a2 remains gated on ME-06c3 being merged. Next runnable item is BUG-CLOTH-002 cheek-wall fix, then independent ENV-01a1 data.
