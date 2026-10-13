# Architect batch review 2026-10-13 (PC-B signs, D-066; opus)

Diff-only review of 11 commits on `pc-b`. Suites run: geo-perf, bandAhead (4x), navTile, beastTile, perfR2P4, underwater, terrainShade, shade.wgsl, glyphMetrics, gfxPresets, gfxKnobs, check-deps (OK, 1697 files).

1. WM-01 184478ea: ARCH OK -> po-review
   Skips are exact (smooth = 1 past the margin, exp(-784) underflows to 0, snow fbm >= 0); 11 pins pass (3.4 s). Note: the `ell` `_cs` cache goes stale if an editor mutates `rot`, and it throws on frozen defs. Precompute it per layer before the geo editor lands.
2. WM-02 e6683327 + WM-02b 98165dd7: ARCH CHANGES: (1) `bandAhead.test` is flaky: the wall-clock assert `bake-active call max <= 2.5 ms` failed 3 of 4 local runs (2.8 / 5.9 / 11.9 ms; GC/JIT outliers). Replace the max assert with a deterministic one (at most one 32-cell slice or one copy row after the budget ran out, counted in the job) and keep p95/p99 as they are. (2) Test runtime is 6.7 s: shorten the walk (e.g. 6 zone rows) or move the 12-zone walk into a bench, so the suite stays under ~5 s. (3) Remove the unused per-call `now` closure in `World.bakeAhead` (it allocates every idle frame).
   The rest is right: heading order, best-overlap source, pins validated and never evicted, 32 MB cap, sliced copy, cached bundle == fresh bake.
3. WM-03 f1a1285d: ARCH CHANGES: (1) `_publishBand` builds a missing `bundle.nav` synchronously on the swap frame (whole tile, ~61k `structureAt`). That is a bake on a swap frame (38.58/38.59 "Do not"). Make `setNavTiles` fill `nav` for every bundle already in the cache (load time, behind the fade), and count any fallback that still fires in play (`navLate++`, like `bandMisses`). Add a test with a bundle put in the cache before `setNavTiles` -> `navLate === 0` after a swap into it.
   Otherwise good: the factory is injected (engine/world never imports engine/nav), the tile is in `bundleBytes`, and the walk shows a 100 % match with `buildFromWorld` and 0 misses.
4. WM-04 521e0bca: ARCH CHANGES: (1) `tileMode` turns on only in `rebindNav`, so on a grid world beasts are never tile-dormant until the first band swap, and homes outside the start tile path on it. Enable tile mode when the sim is created with a grid tile (e.g. `opts.tileNav: true` -> `tileMode = true` + `updateTileDormancy(spawn)`), and add a beastTile check "dormancy applied before any swap".
   Note: `_astarCache` keeps one A* scratch set per tile that was ever live (not counted in the 32 MB). Prefer one A* rebound per tile of the same size.
5. OB-103b de64208f: ARCH OK -> po-review
   Note: `checkCarpetWindow` runs only from `setCarpetQuality` (not per frame), which is fine. The `world:loaded` listener in runGame is registered per runGame call. Confirm runGame runs once per page.
6. PERF-R2P4 26e117e1: ARCH OK -> po-review
   `group.maxDistM` is the existing OB-089 per-group cut, read by both `compactGroup` and passCull, so this is the same rule. Placement r2 and the group cut both scale by `tuftDrawScale`. gpucompare and the owner look are still open (main session).
7. PERF-R4 3ae3802f: ARCH OK -> po-review
   'high' is still bit-identical to the defaults; the 'ultra' tier only trims the caster ranges.
8. SWIM-04c 5a71ae22: ARCH CHANGES: (1) On a submerged frame the JS twin calls `fillSky` twice. After the early sky + `underwaterPass`, compositor.js line 435 `if (!fb.skipSky) fillSky(...)` runs again and repaints every depth-Infinity cell with untinted sky, which undoes the under tint (the GPU order is shade -> under -> edge). Guard line 435 with `&& !underDone`, and drop the dead `!underDone` on line 427. (2) The new test is regex-on-source only. Add one behavioural check: a submerged frame where a sky cell keeps the under tint (fails with the fix reverted). Re-run gpucompare underwaterLake + ceiling.
9. G2 df362bda: ARCH OK -> po-review (gpucompare by the main session still required before owner look)
   JS == WGSL with the tier on and off (3000 probes), level 254 only where fgw > 0, uniforms appended after `cliff`. Note: WGSL clamps `fgT[typeId]` for typeId >= 16 but JS reads undefined. Add a load-time assert `typeNames.length <= FG_TYPES`.
10. OB-117 f0d59890: ARCH OK -> po-review
   The gpucompare ref-box path in RenderTargetWebGPU is still `fitCssSize(..., 1)` (same as before), and the test pins it. Notes: Canvas2D `setAspect` reads a `_refBox` it never stores, and its comment "fills the whole window" is stale. The non-uniform CSS stretch means `cellW/cellH` != the CSS cell size, so future mouse-to-cell mapping must use the CSS box. The boot `setAspect` line (B1-main) is still open.

## P3 answer (ASK ARCHITECT, G2 class tint)
Do NOT bind the carpet classMap in the shade pass. The classMap is an eye-centred window sized to the carpet radius (radiusM * radiusScale * 1.5 + slack, 38.52 item 4). The far tier starts where that window ends, so it would have no class data there. Covering it would mean a much bigger map (memory + a slower sliced mask job) and one more texture plus a fetch per terrain cell in the hottest pass. Keep the per-ground-type colour (`fgT`). If owners want regional variety far out, add a coarse region/biome byte to the near TerrainTextures (baked with the band, per 2 m cell) as its own story. Twin rule as usual.

## Re-review 2026-10-13b
a. WM-02/02b + WM-03 + WM-04 b248a5ba: ARCH OK -> po-review
   Note: the late counter is almost always 0 by construction (each loop exits once the budget is spent); fine as a structural guard. NavTileFill grows `c.bytes` after put without an evict check: the cache may sit a few hundred KB over cap until the next put (accept; evict on the next put).
b. SWIM-04c + G2 assert + Canvas2D _refBox 8e218d1b: ARCH OK -> po-review (gpucompare underwaterLake + ceiling by the main session still required)
c. WM-06 d29c50e7: ARCH OK -> po-review
   Margin policy: 32 MB is an LRU cap, so a peak at ~cap is normal; the real gate is 0 sync bakes / 0 band:late. Keep 32 MB; raise it (max 36 MB, inside the 40 MB D-077 budget) only when a walk shows a miss, and only after trying "evict the zone farthest from the player first" instead of LRU.
d. WM-07/07b 890b2d41 + 3d05332f: ARCH OK -> po-review
   Byte-identical claim holds: `biomeOnly` and `_onTrunk` only touch biomeOnly layers, and they use hash draws only (no rng shift). Species without `trunkR` give NaN -> no exclusion (fails safe).
e. R6a 30aaa681: ARCH OK -> po-review. Deviations accepted: 16-bit oct split over bytes 2/3 (hi) + 6/7 (lo) is needed for the <= 1/127 AC; the private 32x32 raster is fine because both twins read the same baked bytes.
   Required doc follow-up (main session, with R6b): update 38.60 item 2 (texel layout + own raster); R6b WGSL/JS decode must use `decodeImpNormal`'s byte order.
f. streamRoute.test 75abd72a: ARCH OK. The cut rule matches placementGrid (`cutM > 0 && d > cutM && !isLandmark(s, keepFar)`); the test is the bbox distance <= reach, so it is consistent.

## R6 + cache + villagers (2026-10-13c)
Architect (opus, PC-B per D-066). Reviewed from the diffs only; no probes needed.

**R6c ASK ARCHITECT answers**
(a) frag_depth: ACCEPT. Shifted-point depth is the 38.60 item 5 design (terrain, fog and HZB see a real silhouette, and crossing cards sort per texel). The exemption is for `impostorCard` only, and the index.test.js guard enforces that. The cost (no early-Z on 2-tri cards) is acceptable. Keep the JS twin as it is.
(b) Vertex-stage read-only storage `cards`: ACCEPT. In core WebGPU this limit defaults to maxStorageBuffersPerShaderStage (>= 8; the D3D12/Vulkan Intel and RTX 4060 targets qualify). Guard: at pipeline creation, if `(device.limits.maxStorageBuffersInVertexStage ?? 8) < 1`, disable cards (log once). Trees then fall back to today's cut. Do not request compat mode.
(c) cull.wgsl mesh-side band: the pin change is APPROVED for part 2. Part 2 spec:
 1. New `engine/render/gpu/wg/WgCardPass.js` owns the cs_card compute pipeline and the card render pipeline. The render pipeline uses passRaster's 3 colour targets, its depth format and its compare. depthWrite is on, cullMode none. There is one preallocated ImpU slot per species, and the card dst buffers are STORAGE (sized to g.ib.capacity).
 2. Args: 4 words per species in the existing indirect args buffer. The host writes vertexCount=6. instanceCount is zeroed by the existing args reset. The draw is `drawIndirect`, non-indexed.
 3. Atlas: one read-only storage buffer. A species is appended on enableGroupImpostor (`atlasBase` = word offset) and uploaded once (version check), never per frame. Above 2 MB the species is skipped and logged.
 4. cull.wgsl (when CullU impM > 0): at d >= impM+8, no mesh copy. For impM <= d < impM+8, OR `impBandBits(d, impM, 0)` into word 13 of the mesh copy and skip the LOD-hysteresis dither (same as compactGroup `!inImpBand`). With impM = 0 the output must equal today's (passCull.test).
 5. Frame order: dispatch cs_card in the cull compute pass, next to the instance cull (frustum + distance; card HZB stays out until the R3 re-run). Then mesh raster, then the card drawIndirect in the same render pass after the instanced mesh draws and before the view-model depth clear. HZB is built afterwards. Both shadow passes ignore cards.
 6. Per frame: 0 allocations (uniforms go into the preallocated ArrayBuffer). The CPU compactGroup card bucket must not also be drawn on the GPU path.
 7. ACs: passCull.test LOD-3 counts and band bits match compactGroup on a seeded band scene. gpucompare impMid/impBand are identical; tie cells are allowed only at GPU atan2/cos view-pick or oct boundaries, with a note in the story. Default rows stay unchanged with `?imp` off. Record the bench-presets roadSouth GPU delta.

**Verdicts**
a. R6b 12d0c21f: ARCH OK -> po-review. Off is byte-identical (impOn gate). The band is complementary and replaces the hysteresis dither. Cards never cast. 0-alloc scratch. Nit (optional): cos/sin of `view*pi/4+yaw` is computed per fragment in impDecodeTexel; hoist it per card.
b. WM-CACHE-01 eae685ac: ARCH OK -> po-review. Farthest-centre eviction keeps pinned, current, pending and newest. `regrow` keeps the grown bundle and trims (this replaces the old byte fix-up). The NaN focus LRU fallback is fine. setFocus per call is O(1).
c. R6c part 1 3bda29e9: ARCH OK -> po-review (part 1 scope). The WGSL helpers mirror the twin. impBandBits constants equal LDT_ACTIVE/LDT_INVERT. The JS frame wiring is off unless a species opts in. The rows are behind `?imp=1`. Note: the probes are f64 JS translations, and real-GPU parity is proven only by the part 2 gpucompare.
d. OUT-LIFE-TILE 0cb383eb: ARCH OK -> po-review. rebindNav re-plans walkers on the new grid (A* per grid in a WeakMap). Dormancy (outside the tile or > 200 m) freezes state, re-snaps on return, and is skipped in chat. Fixed-area is unchanged. NEEDS B1-main: the main.js wiring (`tileNav: !!gridNav` + `world:band` rebind) as in the lane note.

## R6c part 2 (2026-10-13d)
Architect (opus, PC-B per D-066), a36e069c, from the diff only.
ARCH CHANGES (2 small items, then -> po-review + gpucompare):
 1. Atlas bytes are keyed per group, not per bake. `_upload` on a re-bake writes `imp.bytes.byteLength` at the old `baseBytes` without checking the size. A larger bake overwrites the next species or runs past 2 MB (a writeBuffer validation error). Also, a streamed group that is dropped after 600 idle frames and then re-created gets a fresh range each time. Over a long walk the atlas fills, and later species are skipped silently. Fix: allocate atlas ranges in a `Map(imp.bytes -> {base, bytes})`, so the same bake is reused by every group and every re-create. If a re-bake has a different size, append a new range (or skip and log). Add a test for both cases.
 2. 0 alloc per frame with more than one species: every species binds the same `rpipe` with a different `dst`, so `bind()` sees `stoCur` change and calls `createBindGroup` every species, every frame. Cache the group per descriptor: when `desc.storageBuffers` is given, store the built group on the desc (`desc._grp` + the buffers it was built from) and reuse it. Add a mock test where 2 species x 2 frames give 2 createBindGroup calls total.
Notes: the frame order (ensure -> cull.run -> cs_card -> mesh -> cards -> HZB), shadows never seeing cards, the guard, the minimal device extension (`nsto = 0` keeps existing pipelines on today's path) and impM = 0 (impMeshBits returns 0, `| 0` is a no-op) are OK. passCull.imp.test fails if the band or drop rule is reverted (mesh flags/count asserts). The bump allocator is fine for a load-time bake once item 1 dedupes by bake. Still open: gpucompare impMid/impBand and the roadSouth bench delta (AC 7, main session).
