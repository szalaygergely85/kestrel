# OB-073 D2 near-field grass carpet: stories (PC-B architect opus, 2026-10-12; owner-authorised, PC-A to ratify)

Spec + design: `docs/bugs.md` OB-073 (step D2), `docs/architecture.md` 38.52 (normative). Each step is <= 1 programmer-day and one topic, and is tested in Node first. Engine steps end in `arch-review`. Order: D2a -> D2b -> D2c -> D2d -> D2e. D2f (content) can run in parallel from D2a on, D2g comes last.

## OB-073-D2a [PC-B, engine/world, Node, 0.75 d] carpet config + class map
Scope: `validateCarpetConfig(cfg, typeNames)` and `buildCarpetClassMap(terrain, recipe, cfg, out?)`: a Uint8 grid of `classCellM` over the near band, 0 = none, first matching variant by ground type name + optional `recipe.util.biomeAt`. World opt `carpet` -> `world.carpet = {cfg, classMap, x0, y0, w, h}` (derived, never serialized), rebuilt by the near-band rebake hook (38.38).
ACs: (1) two builds are byte-identical; (2) path/water/rock cells = 0, and a synthetic biome table maps to the expected variant ids; (3) the validator throws naming the key (`carpet.variants[2].heightM`, unknown ground type, > 15 variants, ramp length not 2..4); (4) the save/world hash is unchanged with the carpet on or off; (5) build <= 50 ms on world_m1 (warn only); (6) a band rebake rebuilds it and nothing else re-allocates.
Files: `engine/world/carpet.js` (new), `engine/world/carpet.test.js` (new), `engine/world/World.js` (opt + rebake hook), `engine/index.js` (exports).

## OB-073-D2b [PC-B, engine/render, Node, 1 d] JS reference trace
Scope: `engine/render/carpet.js`: the lattice blade (38.52 items 1-3: root, rank, height, patch noise, variant via the jittered class map, wind lean from `engine/world/wind.js`), `traceCarpet(eye, dir, tHit, ctx, timeSec, out)` (item 4: DDA front to back, NMAX 24, never truncated) and the fade (item 5, `groundFootprint` from `terrainShade.js`). Constants exported for the WGSL twin.
ACs: (1) the same world point gives the same blade (root/height/variant) for 50 eye positions (world-anchored); (2) with wind 0, shifting the eye 0.1 m changes the hit/no-hit of < 2 % of cells over a synthetic 240x90 view, excluding the fade front; (3) no hit is ever returned where `fp > 2w` or `dXY > radiusM`; (4) a segment needing > NMAX steps returns no hit (never a partial trace); (5) the brute-force reference (every lattice cell in the disc) agrees on the hit for 10k random rays; (6) 0 alloc over 10k traces (`--expose-gc`).
Files: `engine/render/carpet.js` (new), `engine/render/carpet.test.js` (new).

## OB-073-D2c [PC-B, engine/render, Node, 1 d] KIND_GRASS in the JS frame
Scope: `KIND_GRASS = 10` in `GBuffer.js`. `carpetCells(gbuf, fb, cam, ctx, timeSec)` writes carpet cells (kind/mat/u/v/face/z + depth, 38.52 item 7) after resolve and before lighting in the JS frame. Lighting treats kind 10 like terrain (sun map, cloud shadow, AO `mix(0.55,1,h01)`, lean-tilted normal). Shade branch `shadeGrass` (ramp colour, glyph by h01/lean, terrain fog). Edge/glow treat it like terrain. The stable level byte works like a mesh cell. Pick/objectId are unchanged.
ACs: (1) with the carpet off the JS frame is bit-identical to before (existing suites PASS); (2) a synthetic meadow frame shows kind-10 cells only on variant ground within radiusM, and none over path/water; (3) a box mesh behind blades keeps its depth where no blade is hit and is hidden where one is; (4) the ramp is monotone base -> tip (h01 0 darker than 1) after lighting; (5) the edge pass draws no outline on kind-10 cells; (6) 0 alloc per frame over 600 frames.
Files: `engine/render/GBuffer.js`, `engine/render/carpet.js` (`carpetCells`), `engine/render/lighting.js`, `engine/render/terrainShade.js` (only the kind-10 branch, not the calm-ground code), `engine/render/edgePass.js`, `engine/render/glow.js`, the JS frame entry that calls resolve -> lighting, tests next to each.

## OB-073-D2d [PC-B, engine/render/gpu, Node + headless, 1 d] WebGPU carpet pass
Scope: `engine/render/gpu/wgsl/carpet.wgsl.js` (`CARPET_WGSL`, built from the D2b constant exports) and `engine/render/gpu/wg/passCarpet.js` (a compute pass after `resolve`, before `light`). The class map is an r8uint texture plus the near-band height texture, and the variant table is a uniform (16 x 64 B). It writes the gbuffer targets + depth in place. `PASS_NAMES` / WG timer slot `carpet`. The HZB stays built from the pre-carpet depth.
ACs: (1) the wgsl source test passes (the constants equal the JS exports, uniform layout offsets match, `limits.test.js` OK); (2) with the carpet off, gpucompare is 0 PASS->FAIL and the pass is not encoded; (3) frameAlloc test: 0 alloc per frame with the carpet on; (4) the class map re-uploads only on a rebake (spy).
Files: `engine/render/gpu/wgsl/carpet.wgsl.js` (+test), `engine/render/gpu/wg/passCarpet.js`, `engine/render/gpu/wg/WgCellPipeline.js` (pass order, PASS_NAMES), `engine/render/gpu/wg/targets.js` (class map texture), `engine/render/gpu/wgsl/index.js`.

## OB-073-D2e [PC-B, engine/render/gpu, Node + headless, 1 d] GPU light/shade branches + gpucompare pose
Scope: kind-10 branches in `light.wgsl.js`, `shade.wgsl.js` (`shadeGrass` twin of D2c; the calm-ground code stays untouched), `edge.wgsl.js`, `glow.wgsl.js`, and the stable level in `stable.wgsl.js`. New gpucompare pose `carpetMeadow` (38.52 twins paragraph), with the carpet on only for that pose.
ACs: (1) all existing poses are 0 PASS->FAIL; (2) on `carpetMeadow`, kind-10 coverage agrees on >= 98 % of cells and colour is within the existing thresholds (no widening); (3) the wgsl suites PASS; (4) one headless still of `?pose=meadow` is saved to `docs/test-reports/ob073/`.
Files: `engine/render/gpu/wgsl/light.wgsl.js`, `shade.wgsl.js`, `edge.wgsl.js`, `glow.wgsl.js`, `stable.wgsl.js` (+ their tests), `engine/render/gpu/gpuCompare.js` (pose), `tools/` gpucompare pose list if separate.

## OB-073-D2f [PC-B, content + game, 0.5 d; designer for the ramps] carpet data + wiring
Scope: `recipe.carpet` in `design/levels/overworld_far.js` with 4 variants: meadow, straw, riverbank, outwall (38.52 item 6). Append ramp palette keys (base -> tip) to `design/palette.js`, and match the ground type colours to each carpet's mean colour. Credit SMM Stylized Grass (MIT, SirMishMash, technique only) in `docs/licences.md`. NEEDS B1-main lines (38.52): `game/js/main.js` passes the resolved carpet, `?carpet=0`, and the gfx preset key `carpetRadiusScale`.
ACs: (1) `validateCarpetConfig` OK on the real recipe (Node world-load test); (2) the class-map share per variant at 3 poses (meadow, ford bank, Outwall) is printed and each pose shows its intended variant; (3) `?carpet=0` gives today's frame; (4) the licence line is present.
Files: `design/levels/overworld_far.js`, `design/palette.js` (append only), `docs/licences.md`, `game/js/main.js` (B1-main, <= 8 lines), a world-load test under `game/` or `engine/world/`.

## OB-073-D2g [main session, 0.25 d] measure + owner look
Scope: `tools/capture-browser.mjs --mode flicker --walk` at meadow + forestWalk, carpet on vs off (wind 0 and 2 m/s). `?bench=1` p95 on the Intel iGPU and the RTX 4060 at 480x180 and 240x90. Owner walk-look.
ACs: (1) the flips with wind 0 are <= the step-1 calm-ground baseline + 2 pp; (2) the budgets in 38.52 hold (else tune in the 38.52 order: radiusM, NMAX, density); (3) the owner says the carpet reads as grass and does not shimmer; (4) the numbers are recorded in the OB-073 row.
Files: `docs/test-reports/ob073/` (report + stills), `docs/bugs.md` (OB-073 row).
