# ALPHA-01d - soft foliage edges (`edge: 'soft'`), JS twin + WGSL only (D-044: no GLSL)

Date 2026-10-08, branch pc-b, lane B1. Spec: architecture.md 37.17 step d, 38.8a item 24.

## What
- Material flag `edge: 'soft'` (palette v1 or detail-pass v2 material, validated in `tools/validate-content.mjs`: only `'soft'` allowed). `MaterialTable.bindShading` builds `table.soft` (Uint8Array by material id) + `table.softEdge(id)`; `ShadeTextures` packs `F_SOFT_EDGE = 1<<16` into MAT_I row 0 `.y` (shade ignores the bit).
- `edgePass.js` (`edgeRules(..., mat, soft)`, `edgePass(..., suppress, soft)`): a soft cell never sees another soft cell as "farther" (no cap/lip/side between leaf cards at any depth/normal), takes only cap/lip/side (against sky or a non-soft neighbour), never convex/concave/seam*/nosing; rule gain = `edges.softGain` (default 0.85, `design/detail-pass.js`), glyph kept. Terrain cells (kind 7) carry a terrain type in `mat`, so they are never soft (found by the first gate run: 14 regressed rows, fixed). Non-soft cells and a missing/all-zero table are bit-identical (test).
- `edge.wgsl.js`: same decision block (`softMat(kind, mat)` reads the shade MAT_I texture, new edge texture slot 5 `'sint'`; `softGain` replaces `pad0` in `EdgeU`, layout unchanged); host `wg/passShade.js` writes the uniform and binds `texMatI`. WebGL2 untouched (soft materials keep today's edges there = recorded difference on the alphaLeaves poses only).
- Test fixture: test-only materials `leaf_softtest` / `leaf_dark_softtest` (clones of leaf / leaf_dark with `edge:'soft'`, appended in `design/palette.js` + `design/detail-pass.js`, used only by the gpucompare alphaLeaves cards in `game/js/dev/modes/gpucompare.js`). No committed world material is soft.
- `gpuCompare.js` ruleFlips twin now passes the GPU material + soft table to `edgeRules`; `compositor.js` passes `fb.matTable.soft`.

## Tests / gate (RTX machine, default grid, same session)
- Node: `edgePass.test.js` (+11 soft checks: no inner edges, silhouette kept, only cap/lip/side, non-soft column unchanged, gain 85 / glyph kept / 145 without table / softGain override), `edge.wgsl.test.js` (string rules; decideRule vs edgeRules with soft mats 2/3 over 5164 cells; 7 mutations caught incl. terrain), `ShadeTextures.test.js` (flag round trip, only the two clones soft), `WgCellPipeline.test.js` (6 edge textures). `run-tests` all PASS 0 WARN (full run, see below), check-deps OK, validate-content OK.
- gpucompare WebGPU: 144 PASS / 6 FAIL (same 6 baseline FAILs); vs c2c417c only the two alphaLeaves rows changed (ruleFlips 8 -> 7, fgMeanAbs ~0.034 -> 0.036), both PASS. WebGL2: 140 / 10 (6 baseline + 4 alphaLeaves known-FAIL), only the alphaLeaves rows differ (JS twin soft, GL not). No threshold changed.

## Candidate real materials (NOT flagged; owner look decides)
`leaf`, `leaf_dark`, `leaf_light` (ME-06c4 canopies, also the mats map of imported Quaternius CommonTree / Pine / Bush / Petal cards in ALPHA-01e). Flag them by adding `edge: 'soft'` to the palette and detail-pass record of the same key.

## Open
- No PNG / owner look (the fixture exists only in the test world); the numbers are the evidence. AC "owner one-look" still open.
- Soft test is per material id: a soft material used on a wall/floor sector would also lose convex/concave outlines (intended for foliage only).
