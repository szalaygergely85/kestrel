# forestEdge kind-9 delta after MESH-INST-01 (lane B2 probe, 2026-10-08)

Question (architecture.md 38.8a item 25c): gpucompare pose `world_m1: forestEdge` kind-9 rows went nMismatch 0 -> 7 / glyph 0 -> 3 after MESH-INST-01. Precision class or JS-twin divergence?

## Method (Node only, scratch probe, no browser)
`World.load(world_m1)` + the exact forestEdge camera (1401.80, 1038.32, -0.78, yaw 240, pitch 10), 320x120 cells. Same camera/draw feed rendered twice with the JS raster twin: (a) `addMeshStructures` singles (f64 `frameMatrix12` item matrix), (b) `addMeshStructuresBatched` with a `MeshGroupSet` (f32 instance matrix rows, MESH-INST-01). Compared per cell: kind, objectId, mat, depth, packed normal.

## Result
- 21 single items -> 7 batched items (25 groups, 296 members, 31 instances kept); 14 956 covered cells.
- kind: 1 cell differs (a silhouette-edge cell: single draw has kind 9 at depth 24.65 m, grouped has none); objectId 0, mat 0, depth 0 cells beyond 1e-3 rel (max rel 3.5e-4).
- normal bits: 518 cells differ (3.5 %): 514 of them by < 0.1 degree (octahedral-quantisation flips), 4 by 1 to 100 degrees. All 4 sit on the same objectId at depth equal to ~1e-4 m, 3 of 4 on an object/depth boundary: the other triangle of the same prop wins a tie at a mesh edge or ridge.

## Cause
The instance matrix is stored as f32 (16-word rows). World translation here is x ~ 1400 m, where one f32 ulp is 1.2e-4 m (0.1 mm); the f64 single path keeps full precision. A 0.1 mm shift of a whole prop moves a handful of edge samples across a triangle edge, which flips the winning triangle (-> a different smooth/flat normal -> glyph) or drops a silhouette cell. Nothing else differs, and no systematic offset exists (objectId, mat, depth all match).

## Verdict: precision class, NOT a twin divergence
Recorded, no code change. Same class as the already accepted f32-vs-f64 world-coordinate rows (large-coordinate worlds). The GPU instanced path uses the same f32 rows, so GPU vs the grouped twin does not see it; GPU vs singles twin sees up to this many edge cells. The grouped twin and the single path stay in the documented tolerance (0 id/mat diffs, depth <= 3.5e-4 rel, normal flips only at triangle ties).

If the gpucompare rows must go back to 0, the only lever is to make the instance translation camera-relative (subtract a per-frame f64 origin before the f32 write, plus the same offset in the view matrix); not worth the cost for a 7-cell delta. Decision for PC-A: accept as precision class.
