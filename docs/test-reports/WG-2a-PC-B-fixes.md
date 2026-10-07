# WG-2a architecture corrections, PC-B, 2026-10-07

Implemented architecture 38.8a item 20 after merging PC-A `8dd8c23`.

- Validation scopes surround shader-module, render-pipeline and bind-group creation, including cached/lazy bind groups. `checkErrors()` drains their pending promises and reports captured and uncaptured errors.
- Subsample targets are `texSGI`, `texSGA` and `texSDepth`; cell-resolution names remain available for WG-3.
- Geometry readback at rays=1 returns four words per cell for GI, GA and Depth. Rays>1 throws the specified WG-3a resolve error.
- Debug uniform offsets are resolved once at module scope. Disposal releases the debug pipeline handle.

Real GPU: Chrome 154, NVIDIA RTX 4060 (Lovelace), WebGPU hardware adapter. A game boot and debug pass completed without page or validation errors. Readback at 160x60/rays=1 returned 38,400 words in each array. Rays=2 returned the exact specified error. Deliberately invalid WGSL produced captured shader-module and render-pipeline validation errors; `checkErrors()` drained the pending list to zero.

This remains the WG-2a skeleton: the CPU scene still renders; WG-2b raster and WG-3 resolve/shading are separate stories. No shader expressions, precision thresholds or GLSL changed.

Validation: device tests 53 passed / 0 failed; pipeline tests pass, including 1,000 warm debug frames without field lookups or new GPU resources; timer tests pass. Full suite: 263/263 pass. `check-deps OK` (462 files, 1,309 existing warnings); content validation 3,233 checks. Same-machine WebGL2 GPU comparison: 124 PASS / 20 known FAIL, all 144 row statuses identical to the previous PC-B run. No previously passing row regressed. Generated comparison capture removed after recording the result.
