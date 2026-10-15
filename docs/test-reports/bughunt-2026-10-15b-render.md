# Bug hunt round 2, area R (wg host passes vs JS twins, band look cache) - 2026-10-15

Architect (fable), 10-minute cap. Confirmed items only (Node probe output). Scope: `engine/render/gpu/wg/pass*.js` hosts, `engine/world/Terrain.js` band publish, round-1 suspect (cached band published without `look`).

## BH2-R1 - stale NEARLOOK texture bound after a cache-hit band swap (confirmed)

- **Severity:** medium (only when `setGroundLook` is toggled at runtime after bands were cached; `World.create` sets it before the first bake, so normal play is unaffected; editor/debug toggle path is wrong).
- **Evidence (Node probe, `engine/world/Terrain.js` + `WgRasterPass.prototype._lookTextures` on a stub device):**
  ```
  near(cur).look? true  cachedA.look? false
  frame1 (band B, look baked): lookActive true nearLook dims [192,192] ver 2
  frame2 (cached A, no look): near.version 3 lookActive true nearLookVersion 2 (stale, != near.version)
     nearLookTex bound = true  bound look belongs to band x0=64 but near.x0=0
  ```
- **Trace:**
  1. `engine/world/Terrain.js:266-271` `setGroundLook(cfg)` fills only `this.near` (and the far grid); cached bundles in `World.bandCache` keep a `near` without `look`.
  2. `engine/world/World.js:1529` `_publishBand` cache hit -> `terrain.publishBand(hit.near)` publishes that near (no `look`, `version` bumped).
  3. `engine/render/gpu/wg/passRaster.js:332-339` `_lookTextures`: `nl = terrain.near.look` is null -> the upload branch is skipped, but `T[3].texture = this.nearLookTex` (the PREVIOUS band's look bytes, previous origin) is still bound and `lookActive = true`, so the look pipeline samples the wrong band's look texels (also wrong dims if the cached band differs in size). JS twin (`detailShade.js`/`TerrainTextures.packNearTextures`) reads `near.look` directly and gets "no look" -> GPU/JS divergence.
  (Reverse toggle `setGroundLook(null)` is safe: `fl` null -> `lookActive = false`.)
- **Cause:** look bytes are a per-band side array, but the on/off toggle re-bakes only the live band; the host assumes `nearReady && groundLook` implies `near.look`.
- **One-line fix (world side, preferred):** in `setGroundLook(cfg)` after filling `near`, bake `look` for every cached bundle too (`World.onGroundLook` hook iterating `bandCache.map.values()` and calling `terrain._fillNearLook(b.near)`), or invalidate the cache (`bandCache.clear()`) on toggle. Host hardening (same commit): in `_lookTextures`, if `terrain.nearReady && !nl` -> `return` with `lookActive = false` (fall back to the no-look pipeline instead of binding a stale texture).
- **Slot:** kestrel-2 (GPU/world).
- **Test:** extend `engine/world/lookBake.test.js`: bake band A, publish B, `setGroundLook(CFG)`, `publishBand(A)` -> assert `A.look` exists (fix 1) and, with a stub device, `_lookTextures` sets `lookActive === false` when `near.look` is missing (fix 2).

## Scanned, no confirmed defect (time-boxed)
- `passWater.js`: uniform scratch sizes (`WATER_BLOCK.sizeWords`, `WL_SLOTS*WL_STRIDE`, `WFOG_LEN`, `RIPPLE_SLOTS*4`) consistent with their block defs; readback buffer sized `4*cols*rows`.
- `passCull.js`: batch free disposes all 4 buffers + occl buffers and zeroes args words before reuse; `dispose()` covers args/dummy/pipeline.
- `passRaster.js` `_terrainTextures`: near/far type textures re-key on version AND world (MAP-12) - correct; only the look path (BH2-R1) misses the "band without look" state.
- Not reached in the cap: passLight/passShadow constant diff vs `detailShade.js`, DrawList/impostor word indices, resize/aspect.
