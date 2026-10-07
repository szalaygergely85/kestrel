# Lane B1 - WebGPU spine (Claude, PC-B main tree, branch `pc-b`)

Skill: `parallel-lanes`, `wgsl-port`, `pc-b-sync-verify`, `gpucompare`. Spec: architecture.md 38.x (read 38.8a items 20-22), D-044, D-045.
Order (WG first, owner 2026-10-07): 0 merge origin/pc-a + suites; 1 PREC-04b2 (A9 items 4+5; gates need it); 2 WG-2b mesh raster (A6 smooth normal, A7 edge rule, mirrored-item pipeline frontFace cw, ALPHA-01c discard); 3 WG-2c terrain/voxel raster; 4 integrate B2's WGSL modules one per commit with its gate: WG-3a resolve+deriv, 3b light, 3c shade+edge, 3d sun shadow, 3e water, 3f sprites+overlay; 5 MESH-INST-01 (pull forward, WG-4a needs it; B2 may build it) then WG-4a compute cull, WG-4b; 6 WG-5a/5b only after WG-4c (PC-A + owner walk).
Gate per step: gpucompare rows reach the WebGL2 PASS set on this machine, no PASS->FAIL, deltas in the row.
Status log (newest first): (none yet)
