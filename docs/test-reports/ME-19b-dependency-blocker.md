# ME-19b dependency handoff — 2026-10-05

Status: NEEDS PC-A. No ME-19b runtime changes or oracle fixture generation published.

After fetching, `origin/master` is already merged into `pc-b`; PC-A was checked through `4f77cdc`. ME-19a (`52da96e`) satisfies the renderer prerequisite. The blocker is the boundary between steps 19b and 19c in architecture §37.13.2:

- `GpuCellPipeline.js:51` imports the voxel atlas constants and `writeInstanceRows` from `VoxelTextures.js`. Its retained `_uploadVoxelInstances` calls the writer, which reads `pool.atlas` and `_modelIndexByKey`; 19b deletes both the module and the pool atlas fields, while 19c owns deletion of these GPU methods/resources.
- `glsl/voxel.frag.js:13` imports the same atlas constants. The pipeline still creates this program at boot, even though the mesh path does not execute it.
- `glsl/dda.frag.js:31` imports `MAX_RAY_STEPS/MAX_DIST` from `sectorCaster.js`; `glsl/terrain.frag.js:24` imports terrain-march constants from `terrainCaster.js`. These source modules disappear in 19b, while the GLSL programs remain until 19c. Moving the specified live sky/shading/data helpers does not resolve these imports.

NEEDS PC-A: choose the temporary boundary: retain/move the frozen GPU packing/constants until 19c, or authorize bringing deletion of the dead GPU voxel methods/resources and migration of the shader constants into 19b. Identify their destinations/removal scope. The world atlas and sun DDA must stay until ME-15e; no default-shadow change is proposed.

Additional observation for the eventual sky move: §37.13.1 item 3 explicitly drops the shear sky branch in 19b, while item 11 retains shear camera fixtures until 19d. A diagnostic on the unmodified `52da96e` code rendered sky-only 160×60 frames with 9×16 cells: forcing pitched rather than shear changes colour in 4,011 cells at pitch 0°, 7,977 at +20°, and 1,440 at −20°. Existing mesh comparison colour metrics exclude sky, so this is not evidence of a failing comparison row. The pitched-only sky requirement can be followed as written; record this intentional temporary difference if editor shear remains usable.

Full checks: working tree 228/228 suites PASS; isolated `52da96e` baseline 226/226 PASS; both include passing typecheck/content. Dependency checks: working 392 files/1298 existing warnings, isolated 390 files/1296 existing warnings; both print `check-deps OK`. Runtime, fixtures and unpublished work remain untouched.
