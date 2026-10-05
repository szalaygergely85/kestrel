# ME-19a programmer verification - 2026-10-05

Queue 16 owner-first step; architecture37.13.2. Clean baseline3eaa11b. Status: **arch-review**.

Renderer selection is removed from the game, pipeline and browser tools. Legacy renderer query values are ignored; GPU frames and the CPU/Canvas2D reference use mesh, with the pitched first-person clamp. DEFAULT_RENDERER is removed. Sprite/voxel/overlay/particle defaults are mesh; the voxel default now uses its existing48-slot cap. GpuCellPipeline ignores opts.renderer and calls its normal input source scene. The shared framebuffer GPU flag is renamed consistently across producers and consumers.

The GPU-dda-versus-GPU-mesh migration comparison and its diff painter/pipelineDda are removed, as is game/sidebyside.html. gpucompare=1 is the mesh GPU/rasterJS comparison; shade remains. capture-browser rejects its removed mesh/dda variants, uses tools/serve.py no-cache serving, and labels imported geometry results mesh. route-walk-browser rejects --renderer. README and AGENTS capture examples match the surviving tool interface.

Files: engine/index.js; render/{compositor,GpuCellPipeline,sprites,voxelPool,particleLayer} and ui/overlay; main.js, rts/rtsMain.js, dev/{spritesPage,modes/gpucompare,modes/flicker}; editor/frame.js + main.js; capture-browser and route-walk-browser; sidebyside.html deletion; frame/capture/modes/voxelPool/VoxelTextures/overlay/meshKind9/pitched.pipeline tests; README/AGENTS. Existing unpublished Ruins/sword/render changes are preserved and excluded from the commit.

## Checks

- Working full runner228/228 PASS; isolated proposed code226/226 PASS; no FAIL/TIMEOUT/WARN. Dependencies OK in both (392/390 files; existing warnings), content validation and typecheck PASS.
- Editor frame27 assertions PASS, including ignored legacy renderer options and ordinary CPU mesh reference; constructor routing probe checks blank/mesh/dda/junk opts without allocating GL resources. Browser coverage verifies the actual GL path.
- Voxel pool41 assertions PASS, including default mesh/48 and existing selection/allocation coverage. Existing overlay22 assertions PASS. Capture-browser and mode suites PASS, including rejection of the removed migration mode/CLI variants.
- Six clean browser boots on port9554: plain URL, renderer=dda, renderer=junk, gpu=0, gpu=0&renderer=dda, force2d=1. Render-call trace reports fb.renderer=mesh in all six, with mesh sprite/overlay defaults. Three GPU cases report pipeline mesh/source scene; ordinary and ignored flags have identical boot metadata. CPU and Canvas2D cases fill8236 geometry cells at160x60; ordinary gpu=0 and ignored-renderer gpu=0 agree. Real R restart replaces the world and restores all six decals in every case; no browser exceptions. The fresh profile's ordinary GPU grid was240x90.
- Clean browser route on port9552 with no renderer or physics query: all10 legs complete, no falls, end trigger reached; physicsMode mesh, grid400x150.1801 recorded frames.485 trees/17,014 details; colliders tower/scatter:trunks/scatter:detail. Route timing is observational, not a new budget gate.

## Mesh GPU comparison

Default gpucompare=1,160x60, RTX4060 ANGLE/D3D11 on port9550: **all71 rows have byte-identical names, metrics and verdicts to the DECAL-01 clean baseline**.62 PASS, nine existing known-FAIL under D-039; zero new FAIL or prior-PASS regression. Existing shear camera poses and thresholds are preserved for19d. The known-FAIL metrics remain those recorded in VOX-CAP-01.md; decalScrawl remains PASS with12 glyphs shown on both twins, no overlay mismatch. No GLSL expressions changed. Generated capture JSON removed after keeping an uncommitted diagnostic copy.

## Boundaries and fixture notes

- Casters, atlases, GPU dda programs, sun-DDA shadows and LVIS remain for their scheduled later steps. The default game sun-shadow option stays dda; shadows=map remains opt-in. ME-19b is next;19c's sun/world-atlas removal waits PC-A ME-15e;19e waits ME-16.
- Extra seam files beyond the main step list: compositor and direct flag tests, flicker and spritesPage must receive gpu and an explicit mesh CPU framebuffer together. Otherwise an old consumer would render CPU geometry over a GPU frame, or the dev reference would still use the caster. No caster implementation was changed.
- The existing16-slot atlas/nearest-selection oracle fixtures now choose their existing frozen renderer explicitly, and the existing shear overlay fixture supplies projection:shear explicitly. Their expected values/limits are unchanged; these fixtures remain until19b/19d. No new legacy-renderer feature or browser acceptance path was added.
- Editor renderer/cpuMesh arguments remain compatibility inputs through19d-ed, but cannot select a different path. GpuCellPipeline renderer metadata stays mesh for its current projection/shadow seams. No cross-step projection/physics deletion.
- Shared hot-file edits are local. The three overlapping unpublished render/harness diffs were checked before staging; only the clean task blobs are in the index.
