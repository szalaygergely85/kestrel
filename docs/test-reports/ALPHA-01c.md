# ALPHA-01c - alpha-cutout mask discard on the WebGPU path (WGSL only, D-044: no GLSL)

Date 2026-10-08, branch pc-b (B1 + B2 half). Spec: architecture.md 37.17 (steps b/c), 38.8a item 26d.

## What
- `engine/render/gpu/wgsl/raster.wgsl.js`: variant `'mask'` = static 64 B layout + `@location(10) aUVMask` + `texMask: texture_2d<u32>` (group 0 binding 0, `textureLoad` only). `maskTexel` / `maskDiscard` = `MaskAtlas.texel` / `sample` literally (f32 wrap `c - floor(c)`, f32 product, floor, clamp w-1; discard iff `a < cutoffByte`), discard before any output, `!front` flips the kind-9 normal. `RASTER_MASK_BLOCK` = base block + atlas rect + cutoff. Shadow variant `RASTER_MASK_SHADOW_WGSL` (shadow z line, fragment `fs_mask_shadow` = discard only). Both registered in `wgsl/index.js` (`rasterMask`, `rasterShadowMask`).
- `MeshBuffers`: optional `uvMaskBuffer` (the static stride is unchanged; `MASK_UV_LAYOUT` is bound as an extra stream).
- `wg/passRaster.js`, `wg/passShadow.js`: masked meshes (`maskRanges`) draw per mesh range (opaque ranges: the unchanged static pipeline; masked: mask pipeline), clipped to the item window like `rasterDrawList`. Atlas texture (r8ui) uploaded when the atlas object / version changes only (`maskUploads`), 0 per frame. No atlas / no uv stream = one opaque draw (as before). Masked meshes stay out of instanced groups (same JS feed).
- Harness (`game/js/dev/modes/gpucompare.js`, appended LAST): test-only world (second `world_m1` load + own `MaskAtlas`), fixture built in code (opaque post + 4 vertical cards + 1 tilted card, 2 m, 8x8 checker mask), poses `alphaLeaves` (6 m) and `alphaLeavesFar` (30 m). No committed content, no existing pose touched. `engine/index.js` exports `MaskAtlas, buildMaskAtlas, cutoffByte`.
- `gpuCompare.js`: `compareGeometry(..., {maskPose})`: a coverage tie counts as `maskTies` only when the JS twin's own 3x3 holds a kind/planeId change (mask edge / silhouette; JS kind 9 vs GPU sky counts there too); a disagreement deep inside a card stays a violation. Cap `max(4, ceil(0.02 * geometry cells))` replaces the boundary cap on these poses. Row fields `maskTies`, `maskTiesMax`, `maskTiesOk`, `holeCells`.
- `shadowParity.js`: the JS depth-only twin now receives `world.maskAtlas` (before, it drew masked meshes opaque and the 99.9 % tolerance hid it); mask poses gate `shadowDepth.hist.big < 200` (world_m1 content alone gives 100-145 in every row; 5 opaque cards add ~330).

## Gate (RTX machine, 160x60, same session)
| backend | PASS / FAIL | notes |
|---|---|---|
| WebGPU | 144 / 6 | the 6 baseline FAILs unchanged (crash room, lamp empty, voxel half occluded, viewModel rest pitch 20 pitched, handsSwapped, forestWalk). alphaLeaves: kind 100 %, k9 6503, maskTies 20/153, 0 holes, 0 depth/uv/nrm/face viol, dL 0, glyph 99.96 %; alphaLeavesFar: k9 1798, maskTies 8/126, glyph 99.89 %. Shadow rows PASS, `hist.big` 103 (437 when the twin draws the cards opaque), covMismatch ~0. |
| WebGL2 | 140 / 10 | 6 baseline + alphaLeaves, alphaLeavesFar and their two shadow rows = recorded known-FAIL (GL draws masked ranges opaque; maskTies 805 / 38, kind 99.2 %, nrm/face viol 259/283). No other row changed. |

Node: `node tools/run-tests.mjs` all PASS (typecheck clean after typing `uvMaskBuffer`), `check-deps` OK, `validate-content` OK. New Node checks: `wgsl/raster.wgsl.test.js` (40k texel/discard probes vs `MaskAtlas` on a 4x4 checker incl. u = 1.0, -0.25, 2.5, 0.1+0.2, tiny negatives, +-1 ulp-ish boundaries; string rules), `wg/passRaster.test.js` (per-range draws, uniforms, extra stream, 0 uploads over 500 frames, re-upload on atlas version, window clipping, fallbacks, dispose), `wg/passShadow.test.js` (mask caster pipeline), `gpuCompare.test.js` (maskTies rule + cap).

## Limits / open
- No PNG: the headless gpucompare page leaves the WebGPU canvas black after the readbacks (the text report covers it) and the harness does not `present()`; an owner look needs a live page with the fixture, which does not exist (test-only world). The numbers above are the evidence.
- `maskTies` is a screen-space proxy of 37.17 item 9 (the JS gbuf carries no `uvMask`): ties only count next to a JS-side edge in the 3x3; true texel-3x3 straddle needs per-cell uvMask in the JS gbuf (not added).
- GL path creates the (unused) `uvMaskBuffer` for masked meshes through the shared `MeshBuffers` (one small VBO per masked mesh); WebGL2 stays opaque for masked ranges by D-044.
- Instanced mesh groups never receive masked meshes (JS feed excludes them); ALPHA-01e must keep that or port a masked instanced variant.
