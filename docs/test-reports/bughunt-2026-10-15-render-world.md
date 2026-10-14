# Bug hunt 2026-10-15, area 2/3: engine render + world + streaming (architect)

Scope read: `engine/world` (Terrain.js, World.js band streaming 1240-1600 + load 560-650, bandCache/bandGrid/bandAhead/bandBake, placementGrid), `engine/render/atmos.js`, `engine/render/gpu/VoxelTextures.js`, voxel parts-16 constants. Stopped early on the owner's time cap (coordinator message); the render passes (passRaster/passCull/passLight/passShadow/passWater, rasterJS/detailShade twins, DrawList, lazyMesh) were NOT reviewed.

Full Node run: `node tools/run-tests.mjs` reported 9 FAIL under full load; every suite in this area (impostorCard, riverRibbon, lookBake, raySegment, serialize.fire) PASSES when run alone (= the known GATE-FLAKY load flakes, not re-reported).

## Confirmed

### BH-R1 (low, editor-only) - band cache keys are memoised and never dropped when a structure is placed after load
- Evidence (code trace):
  - `engine/world/World.js:148-159` `nearBandKey` folds every non-mesh structure's bbox/origin/yaw/ring floorH into the band cache key (a structure changes the baked near heights through `structureBlend`).
  - `World.js:1268-1275` `_bandKey(k)` memoises that key in `_bandKeys[k]`; it is reset only in `_gridFill` (1249). `World.js:1314-1322` `_zoneKey(i,j)` memoises in `_zoneKeys`, cleared only by `terrain.onRebake` (638).
  - `World.js:933-948` `placeStructure` pushes the structure and bumps `renderVersion`/`structVersion` but never touches `_bandKeys`, `_zoneKeys`, `_pinKeys` or `bandCache` (and does not call `onRebake`).
  - Result: after `placeStructure` at runtime, `streamBand`/`bakeAhead`/`ensureBandFor` keep asking the cache with the OLD key -> `bandCache.has()` hits bundles baked without the new structure (near heights not flattened under it, scatter/detail not kept out, nav tile without its mask). A new bake for the current slot would even be stored under the old key again.
- Scope: no runtime caller outside `World.load` today (grep of game/ tools/ engine/ non-test), so it bites the editor / future runtime placement only.
- Fix (one line each): in `placeStructure` (and `placeMesh` is harmless: mesh kinds are skipped by the key) add `this._bandKeys.length = 0; this._bandKeysC.length = 0; this._zoneKeys.clear(); this._pinKeys = null; this.bandCache.invalidateRect(bbox.x0 - R, bbox.y0 - R, bbox.x1 + R, bbox.y1 + R);` (R = structure blend ring).
- Owner slot: kestrel-2 (world).

## Suspects (not confirmed, no probe run)
- `bandBake.js` `BandBakeJob.bundle()` with `terrain.realTrees === false`: `this.scatter` defaults to `world.scatter` (the LIVE band's scatter object) and is stored in the new zone's bundle; harmless only because `_publishBand` reads `hit.scatter` solely when `realTrees` is true.
- `bakeAhead` stores `b.zone = i*nj + j` while `prebakeBands`/`_publishBand` store the slot index; `zone` is informational, but any consumer comparing them would mis-match.
- `placementGrid.js` cell key `(cx*65536+cy)*8+cls` collides for `cy` outside +-32768 cells (documented limit; 2 Mm, not reachable).
- `Terrain.publishBand` version = `near.version + 1` of the band being replaced: monotonic, fine; but `setGroundLook` on a cached (non-live) bundle's near is never re-filled (cached bundles baked before `setGroundLook(cfg)` have no `look` array -> `stepBandState` handles it on copy, but a direct cache HIT publishes a band without `look`). Worth a probe: set ground look after a zone was cached, walk back into it.

## Not reviewed (time cap)
passRaster/passCull/passLight/passShadow/passWater host passes vs WGSL, rasterJS/detailShade twins, DrawList/instances/impostors, lazyMesh eviction, decor mask, atmosphere driver beyond `atmos.js` (read, no finding), resize/aspect paths, LOD hysteresis.
