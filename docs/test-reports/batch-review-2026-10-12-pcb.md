# PC-B architect batch review 2026-10-12 (opus, D-066)

Diff-only review of 7 commits on `pc-b`. Suites run: placementGrid (115/115), interaction (45/45), terrainShade (86/86), shade.wgsl (43400 probes vs JS twins), quitSave all pass. check-deps OK (1046 files, warnings only, none new from these commits).

## 59c780d6 OB-073 step 1 calm ground: ARCH OK with notes
- Twin parity holds: JS and WGSL both drop dither, hashed glyph, close/band sets, glint and features, both pick the middle entry of TLOOK texel 4, and both write terrain level 255 (the LEVEL_ANIM import is gone). Shader hash is re-pinned, and the level splice test is updated.
- Note 1 (cleanup, next touch of the file): dead leftovers. `GLYPH_CELL`, `PATCH_DITHER` and `GLINT_RATE` are still exported but no longer read by the shade path. `timeSec` is unused in `shadeTerrain` in both twins. `ctx.features` (`makeTerrainShadeCtx`) and the TLOOK feature texels 8-15 / close texel 7 are now dead data. Remove them or mark them reserved so the editor does not author dead fields.
- Note 2: `stable` is now built and ON for every preset (`main.js:444`, `:905`). That was the owner's pick. Record the stable-pass GPU ms (perf pose, low preset) in the story so the D-007 budget stays accounted for.

## 68827108 OB-081 far tier blend + calm forest faces: ARCH OK
- At fw = 0 the blend is bit-identical in both twins (xf = i exactly, frac 0). At fw = 1 the clamp keeps i0/i1 inside 0..2. The `fpH` select chain in WGSL matches the JS `hashCell` branches. The calm face/trunk gate is the same in both twins. The test would fail if the change were reverted (far worst 5 vs near 95). gpucompare intel PASS on record.

## 09e0f74d OB-085 blend band 2-8 m: ARCH OK with notes
- This only changes a constant. Both twins read `FAR_BLEND_FP0/FP1`, so parity holds by construction, and the hash is re-pinned. The OB-081 test still passes at 400 m.
- gpucompare: not needed for ARCH OK, but it MUST run before this reaches master (D-039 merge gate: the shader text changed). It can wait for the next merge.

## 495a7ece OB-084 interaction pick on bodies / prop boxes / inside cone: ARCH OK with notes
- Hot path: `world.entity()` is a Map get with no allocation. The `propPickBox` result is cached on `rec.pick` (it allocates once per rec, never per frame). The inside-cone test only runs when `tn === 0` and has no allocation. The sim reads only entity transforms (sim state), so it stays deterministic. The engine does not import game code.
- Note 1 (`interaction.js:135`): the lazy cache stores `null` for good if the prop entity does not exist yet on the first evaluated frame, or if it has no colliders. The rec then quietly keeps the small default box. It also adds a property to the rec in the hot loop (hidden-class change). Preferred fix: resolve `rec.pick` once in `World.addInteractable` / at structure load (set it to `null` when there is no box), and re-resolve in `setMeshPlacement` / prop moves (the editor). Not blocking for static props.
- Note 2: no test covers the `propId` -> `propPickBox` path. Add one case (a level item on a prop picks on the prop's collider AABB) with the fix above.

## cf48d040 STREAM-01a placement grid: ARCH CHANGES
The code follows 38.51, but the per-cell `cellReach = max(member reach)` rule in my spec defeats the grid on world_m1. All 25 cells stay active at the tower (2288/2288), so AC5 ("active count at the tower < N") is only met through the per-placement compare (drawn 1750), and the 01b feeds would still walk all N. The rest is good: ring and hysteresis rules, ascending lists, tie-break on cell id, 0 allocations (gc probe), and determinism.
Required before 01b:
1. `placementGrid.js:46-48`: bucket by `(cx, cy, reachClass)` instead of `(cx, cy)`, where `reachClass = min(4, ceil(log2(reach / minM)))` (160/320/640/1280/2000 m). Each sub-cell gets its own tight `cellReach`, so small props in a cell go cold while a tower mesh stays active. Lists stay ascending (`_rebuildLists` scans structure indices). Update the AC5 assert to `activeCount < N` at the tower, and log the per-class cell counts.
2. `placementGrid.js:43-44`: a NaN reach (`r = 0` with `reachPerM = Infinity`) must map to `farM`, not `minM`. Otherwise the 01b AC1 "reachPerM = Infinity -> bit-identical" fails on degenerate bboxes. Add a test case for it.
3. `placementGrid.js:116`: on the uncapped `_first` update (load, and every `refreshPlacementGrid` rebuild after an editor `setMeshPlacement`), skip the selection sort and apply all changes directly. The sort is O(C^2) and C grows about 5x with item 1.
Note for 01b: feeds must read `world.refreshPlacementGrid()` each frame and never cache the grid object, because a rebuild replaces it.

## 6d669585 OB-079 quitSave: ARCH OK
- The module is pure, with the same `canSave` guard and title skip as autosave, and it never throws out of an unload handler. The test covers every branch. Game code only, no engine impact. Note: a save in `pagehide` must be synchronous (localStorage). Confirm `requestSave` does not defer to a later frame or a promise, or the save is lost on a real tab close.

## 05ec2f2a OB-082 lootToast scope fix: ARCH OK
- The top-level handle is set when the toast view is (re)built, and the guard makes it a no-op before boot. Game code only.
