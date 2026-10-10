# Architect batch review, PC-B engine work 2026-10-10

(PC-B architect opus, owner request; PC-A to ratify)

Scope: `git diff 6c9334e4..HEAD -- engine` on branch review-arch (= pc-b tip 7ba03936), 79 files. Diff-only review.
Gates run: `node tools/check-deps.mjs` OK (889 files; 46 warnings, all in game/). `node tools/run-tests.mjs`: all green except `engine/mesh/occlusion.test.js`, which FAILed once in the parallel run and passes on its own (timing flake under load, not from this diff).

## ARCH CHANGES (most severe first)

1. **DN-01 / AUD-42: the GPU water sky LUT ignores the live look.** `engine/render/gpu/wg/passWater.js:207` re-bakes only when the palette object or `defaultTime` changes. The JS twin (`waterComposite.js:64`) also keys on `P.liveLookVersion`. With the DN-03 clock running, the GPU reflection stays on the load-time look while the JS twin follows the clock, so parity breaks at dusk and night. Required: add `(pal.liveLookVersion|0) !== this._lutVer` to the cache key, the same as the JS side, plus a mock-device counter test (one re-bake per version bump, none otherwise). Add this file to DN-02's scope: the DN-02 row lists only passShade `_bakeSky`. Sequencing note: DN-03 already runs the clock in the live game, but passShade `_bakeSky` (line 153 reads `P.timeOfDay[P.defaultTime]`; cache key at line 216) and `floorLum` are still DN-02 work. Until DN-02 lands, the GPU sky gradient stays at the morning look while ambient, sun and the JS sky change. Either land DN-02 next, or keep `?timefreeze` as the default until it lands.
2. **DOOR-CLOSE-01: game feel hardcoded in the engine.** `engine/world/interaction.js:135` hardcodes `0.9` m and `70` deg. Required: make them `cfg.nearDist` / `cfg.nearConeDeg` with exported defaults (next to DEFAULT_CONE_DEG), read them the same way as `reach`/`coneDeg` (line 107/108), and add them to `INTERACT_CFG` (line 161). Behaviour stays identical. Small fix.

## Per item

| Item | Verdict | Notes / risk |
|---|---|---|
| GS-01a terrainFloor + carveMask | ARCH OK | `isTerrainFloor` is gated on outside + non-solid. The mask is in level-local cells, which is valid only because `placeStructure` throws on yawSteps != 0. When CO-4 adds rotation, the mask must rotate with the grid. RISK: `engine/mesh/levelMesh.js` now imports `world/Level.js` (mesh -> world). check-deps allows it, but a pure helper in mesh/ would be cleaner. |
| GS-01b GPU carve mask (StructMaskAtlas, structMask.wgsl) | ARCH OK | One shared `inStructFoot` for terrainRaster + shadow. JS `insideStructFoot` uses the same truncation and indexing. Uniform fields are appended, so earlier offsets don't move. The atlas rebuilds only when the list of mask references changes, so 0 allocations per frame. The box order matches the compositor (skips mesh / no bbox). |
| GS-01c scatterDetail keep-out | ARCH OK | `structBlocks` uses the same w from the bbox as the atlas. No mask = old bbox rule. |
| GS-01f collision-only floors | ARCH OK | All 4 collider builds pass `collisionFloors`. RISK: the walk height is the level floorH but the drawn surface is the terrain height. Keep the ring cells authored flat to the terrain (ringProbe covers today's tower). |
| AUD-02/33 instance upload + shadow share | ARCH OK | The version/count skip is correct. A shared raster copy is used only when version and count match, so it holds the same bytes and the hazard is moot. Every compaction writer now bumps the version. RISK: any future raw `ib.u32` writer that forgets `touchInstances` leaves GPU rows stale (silent). Consider a dev-only assert in passUpload.test that greps writers. |
| AUD-03 ledge invariant | ARCH OK | integrate.js and Player.js agree. RISK: a body that ends up more than stepUpMax below its floor (e.g. a sector anim lifting a floor faster than 0.45 m per tick, or a teleport into a ledge) now stays below it instead of popping up. Fine for today's content. Watch lifts. |
| AUD-04/34 ring removal + external step | ARCH OK | No callers left. Nits: the stale comment at `Terrain.js:90` mentions `bakeChunkStep`; `terrainStepExternal` is an ad-hoc field that main.js sets on the pipeline. Document it on WgCellPipeline (JSDoc / ctor opt). |
| AUD-30 bake fast path | ARCH OK | The code change is in design/ (content). bakeParity.test checks it is bit-identical. |
| AUD-09 bounds test | ARCH OK | Test-only. The re-spawn with --expose-gc is fine. |
| AUD-40 + SKY-GLOW-SOFT-01 | ARCH OK | One params object, WGSL generated from it. JS and GPU use the same ray basis, dither index and gate (`skyGlowOn` = terrain + timeOfDay), and the appended uniforms don't move earlier offsets. |
| AUD-45 + edge-gate fix | ARCH OK | `out.f = fLin` matches the GPU edge gate. The JS cell direction uses the same terms as the WGSL. Per-cell cost is only where f > 0. |
| AUD-47 + order fix | ARCH OK | Bits 20-26 are reserved and documented. No objectId consumer compares veg ids (entity tint uses exact unit ids; planeId uses `&0xF`). RISK: the CPU v1 path (no `rec.v2`) still applies the gain after fog, while the WGSL applies it before. This only affects v1 materials. |
| AUD-42 water reflect | ARCH OK (see change 1) | Same expression order in both twins. Off for ortho on both sides. |
| EMIS-03/04 + GLOW-TUNE-01 | ARCH OK | glow.js and glow.wgsl.js match term for term (kernel t^3, depth gate, terrain excluded, rounding). The pass is off without opts.glow (byte-identical). It has no timer slot, so its cost is unmeasured in passMs. Measure once on Ultra. |
| WS2-01 band zones + stepped bake | ARCH OK | Copying the overlap equals a re-bake (per-cell pure). The swap is atomic. Only `terrainBands` is saved; the active band is derived. 0 allocations while idle. Nits: `Terrain.js:257` `const now = ...` is unused (and the Date.now branch isn't called), and the JSDoc above `cancelNearBand` describes a rect getter. RISK: a live terrain edit (`rebakeRect`) during a pending bake leaves the copied overlap stale. That is editor-only; cancel the pending band in rebakeRect. |
| WS2-02 resumable scatter jobs | ARCH OK | `scatterTrees` / `scatterDetail` = job run to completion, so stepped == one-shot by construction. RISK: the `Object.create(terrain)` view shares mutable scratch objects (e.g. `_groundNormalScratch`). That is safe only while jobs run synchronously in one slice, as now. |
| WS2-03 far carve during pending swap | ARCH OK | The exclusion moves only at publish. `_exclRect` is a test hook. |
| DN-01 blendLook / liveLook / moon | ARCH OK for its own scope (see change 1 for the missing GPU reader) | 0 allocations after the first call; byte-identical when unset. Note: the `$live.*` keys are written into P.rgb/P.hue, so palette content is mutated at runtime. Tools that serialise or validate the palette must skip the `$live.` prefix. |
| QUALITY-BOOT fitCssSize maxUp | ARCH OK | RISK (look): `smooth: s !== 1` also filters an exact 2x upscale, which blurs glyphs. Consider keeping pixelated sampling when s is an integer. |
| DOOR-TOGGLE rebuildPropColliders variant fallback | ARCH OK | Falls back to `p.variant` only when the component variant is undefined. |
| DOOR-CLOSE-01 interaction cone | ARCH CHANGES (change 2) | |

Count: 19 ARCH OK, 2 ARCH CHANGES (AUD-42/DN-01 GPU water LUT key; DOOR-CLOSE-01 cfg). Both are small. Re-review: opus, diff-only.
