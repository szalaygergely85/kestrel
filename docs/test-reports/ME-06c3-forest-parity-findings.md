# ME-06c3 forest render — arch-review, 2026-10-04

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

## Queue 16 publication under D-039

The preceding STOP is superseded by owner decision D-039 and Queue 16 item 1. Verified against master 3697250 in the clean test worktree, with only forest implementation applied. Latest grove data yields **485 trees**, six groups: oak 114/89, birch 82/45, pine 79/76. All 7,760 instance words match the authored scatter, IDs are unique; 23 binding checks PASS. No shader, comparison threshold or cinematic change.

69-row real RTX4060/D3D11 mesh comparison: **no previously passing row regresses** against the immediately preceding 68-row master capture. Master already has eight FAIL rows: lamp-empty, voxel half-occluded, rtsHill60, fpLevel0, shear sword rest pitch0, pitched sword rest pitch0/pitch20, and cloth. Forest adds only its recorded precision FAIL; follow-up PREC-01 is owned by PC-A.

The forest known-FAIL baseline is unchanged: 100% kind match, zero holes, zero non-kind-8 geometry violations; **one geometry cell (105,48)**, material65/59 and depth5.702/8.067, one depth/UV/z violation each, face/AO/normal violations zero. **66 kind-8 colour outliers**, 7,745 non-sky cells, glyph match99.1978979394%, foreground/background max118/15, non-kind-8 max0. Light PASS with dLMax1.1920928955e-7. No baseline deterioration.

Browser at400x150: forest canopy visible (56 drawn,429 culled); **breach view visibly contains trees**, 213 drawn/272 culled, nearest trunk21.4121m at(1499.1702,1042.2611). Save/reload retains485 placements and replaces groups; trees-off/unload leaves zero groups. No browser exceptions. Mesh route reaches end trigger; owner forest walk-test and Arc budget remain PC-A checks. Game enables real trees with `renderer=mesh&physics=mesh`; `trees=0` disables them as37.2 specifies.

Final checks: 225/225 working-tree suites PASS; 223/223 isolated suites PASS; dependency/typecheck/content checks PASS. Status: **arch-review / NEEDS PC-A: owner forest walk-test**. ENV-01a2 is next in Queue16. Capture diagnostics retained locally; generated JSON/PNGs removed.
