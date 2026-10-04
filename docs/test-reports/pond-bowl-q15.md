# Q15 item 4 — pond bowl re-check, 2026-10-04

Verification of the published 36.1b glint and 36.1c depth/shore code with PC-A's `quietPondBowl` terrain. No runtime code, terrain, look values or comparison limits changed. The old uniform ~0.1 m centre-depth blocker is resolved. Water changes remain **arch-review / NEEDS PC-A: owner appearance review**.

Canonical `world_m1`, water surface 2.5 m, radius 4 m, centre (1500,1010). Pond look: tintDepth .8 m, foamDepth .25 m, shoreW .5 m. Query measurements use `terrain.groundAt` (bilinear); mesh measurements vertically intersect actual prebuilt drawable near MeshData triangles, including chunk origins. They are geometry measurements, not GPU pixel-depth reads.

| Sample | Query column m | Drawable mesh column m | Tint / shore reading |
|---|---:|---:|---|
| Centre | .811055 | .811055 | Full deep tint 1; no shallow foam |
| Eight rim points, r4 | .125763–.171511 | .122456–.171457 | Tint .153–.214 on mesh; edge shore term 0 |
| Eight shelf points, r3.1 | .213037–.284841 | .205751–.387255 | Mesh tint .257–.484; foam term <1 at 6/8 points |

The SE/NW shelf triangle samples are .387255 m deep and do not enter the shallow-depth foam band; the queried shelf also varies (4/8 foam points). Largest query-versus-triangle shelf difference .108179 m. This is a visible tuning consideration for PC-A/owner review; no claim of a continuous inner foam ring is made. The exact outer boundary satisfies the edge-band condition at all eight samples.

Real GPU (NVIDIA RTX 4060, ANGLE/D3D11), mesh at 400×150, two authored water regions, player (1500,1016), yaw 0, pitch −15: 120 warm-up frames then 600 fixed update/render frames. Pass timing uses its existing 120-result history. Water p50/p95 .043008/.063488 ms; **wcomp p50/p95 .034816/.046080 ms**, below .1 ms. No browser exceptions. Screenshot inspected: darker pond centre and lighter edge are visible. Arc-specific numbers remain PC-A hardware verification.

Full mesh GPU comparison at 160×60: 68 rows, all **7/7 requested water poses PASS**, waterfall front/back also PASS. Four unchanged non-water baseline FAIL rows: voxel half occlusion, rtsHill60, cloth, pitched sword rest. Zero new FAIL rows. Capture JSON/PNG outputs removed after diagnostics were retained locally.

All checks: **225/225 working-tree suites PASS; 222/222 isolated suites PASS**, dependency check, typecheck and content validation PASS. Initial isolated checkout was 67b0f73; blocked forest/Ruins/sword runtime changes are excluded.

Final sync merged PC-A 0ced41e as 45acdee (ground-detail assets/recipe and Awakening tower dressing). Repeated geometry measurements are identical; the same Node counts, dependency/typecheck/content checks pass. Programmer verified the updated walkway: 31 owner-pose assertions PASS in grid/mesh, capsule crosses in 2.050 s, cloth parts .7729 m; mesh browser route completes 12/12 legs and reaches the end trigger without falls. Owner walk-test remains pending.

Post-sync solo timing, same pond setup and warm-up: water p50/p95 .031744/1.619968 ms; **wcomp p50/p95 .026624/.059392 ms**, still below .1 ms. The separate water-pass p95 increased; NEEDS PC-A: investigate this content-sync performance change before claiming the wider .25 ms water-pass bar. Timing history is 120 GPU results, not all 600 frames.

Post-sync mesh oracle (`gpucompare=1&renderer=mesh`): 68 rows; all seven water and both waterfall rows PASS. Four prior FAILs remain; one additional **lamp empty (post pickup)** FAIL after the tower dressing merge: 100% kind match, zero depth violations, 33 non-kind-8 AO violations, one UV/face violation, light dLMax .304170. NEEDS PC-A: architect assessment of the new tower-content parity failure; no tolerance or renderer changes made. This is not a clean full-scene parity result. Diagnostics retained locally; generated capture JSON/PNGs removed. Clips remain on hold.
