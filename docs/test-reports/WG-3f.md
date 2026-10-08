# WG-3f (B1 wiring) - sprites + overlay on WebGPU, 2026-10-08

Wiring: `WgCellPipeline.bindSprites({pool, atlas, palette, particleLayer, overlay})` builds `WgSpritesPass` + `WgOverlayPass`; both resize in `resizeGrid`, dispose with the pipeline.
Per frame (`frame()`): `fb.sceneFade`, `fb.fadeLut`, `fb.sceneDim` -> sprite pass. In the cell hook, after edge and only when the cell pass shaded: sprites (also with 0 sprites) then overlay into `sp.outFg`.
`frameComplete` = ready && shadow MAP && water && sprites && overlay (not with `?shadows=dda`). It sets `rt.gpuActive` and `rt.setPresentCells(sp.outFg, sp.outBg)` (RenderTargetWebGPU presents them; debug view / failure / non-shaded frame fall back to the CPU cells).
main.js: `fb.gpu` also true when the WebGPU pipeline is frameComplete (CPU cast/sprites/fade/dim skipped, overlay flushed for the GPU), `fb.sceneDim` added, `bindSprites` after the sprite system. spriteDev.createSpriteSystem skips `drawSprites` then.
gpucompare: WG-3f wait removed (final cell rows honest, read through `wg.readbackCells()` -> `sp.readbackCells()`), overlay flushed + JS twin `renderCpu` for WebGPU too.

Gate (this machine, default shadows map unless noted):
- webgpu: 140 PASS / 6 FAIL; webgl2: 140 PASS / 6 FAIL; identical FAIL set (crash room, lamp empty, voxel half occluded, vm rest pitch 20, vm handsSwapped, forestWalk). cellsWait count 0 of 73 rows.
- webgpu `--shadows dda`: 66 PASS / 7 FAIL (== baseline).
- presentdiff webgpu: pctExact 100, badCells 0.
- Node: WgCellPipeline.test.js extended (bind, complete/gpuActive, present override, fade/dim, resize, failure, dda), run-tests and check-deps OK.

Known: CPU draws into rt.cells in world mode that the GL path also loses (e.g. drawEyelid) are not shown on WebGPU either once frameComplete (same as GL's cell replacement; not verified in an interactive page).
