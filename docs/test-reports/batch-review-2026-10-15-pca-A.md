# Arch batch review A (PC-A, 2026-10-15)

Scope: commits on origin/pc-b (merged into pc-a at c4cd8ba5). Diff-only review, with probes where something looked wrong. Node v24.21.0 on PC-A. `node tools/check-deps.mjs`: OK (1371 files, 74 warnings, none from these items). engine/physics stays stand-alone (swim.js no longer imports core/math).

## Verdicts

| Item | Commits | Verdict |
|---|---|---|
| QFIX-S6 + S6b | d20a4041, 30763b94 | **ARCH CHANGES** (1-3) |
| SWIM-SAVE-01 | d20a4041 | **ARCH OK -> po-review** |
| VOX-PARTS-16a | f8855134 (+55f8e685) | **ARCH OK -> po-review** |
| VOX-PARTS-16b | e901a7ac (+cf7f4384) | **ARCH OK -> po-review**. Gate for the main session: the gpucompare `vox12` row must PASS, and it must cover >= 400 cells (not checked yet) |
| VOX-REGFIX | e0a5f955 | **ARCH OK -> po-review** (rigPerf 0.0 B/frame at HEAD) |
| ANIM-C-01 | f8fd0ef6 | **ARCH OK -> po-review** |
| ANIM-C-02 | 8269133b | **ARCH OK -> po-review** |
| ANIM-C-03 | cec37364 | **ARCH OK -> po-review** |
| ANIM-C-04 | 274d9da6 | **ARCH CHANGES** (4) |
| ANIM-C-05 / 05b | ffce26c3, ac855d18 | Not reviewed: these are game-side (game/js/quest/beastLegs*; engine only gains the `createLegDriver` export). They go to the PO |
| ANIM-BLEND-01a | f5cf34c1 | **ARCH CHANGES** (5) |
| ANIM-BLEND-01b | 806f4115 | **ARCH CHANGES** (6) |
| ANIM-BLEND-01c | d311d32e | **ARCH CHANGES** (7) |
| NAV-REACH-01 | 46bc25fd | **ARCH OK -> po-review** (advisory A3) |
| NAV-LAYERS-01a | f782cc69 | **ARCH OK -> po-review** |
| NAV-LAYERS-01b | 385557cc | **ARCH OK -> po-review** |
| NAV-LAYERS-01c | 8921d88e | **ARCH CHANGES** (8) |

## Required changes

**QFIX-S6/S6b (serialize.js)**
1. **Removed content structures come back.** `contentStructures` keeps every saved structure whose id is not in the current content ("saved-only structures are kept"). Nothing spawns structures at runtime: there is no `structures.push`/`addStructure` in engine/ or game/js. So every saved-only structure is one that content has deleted. Example: the 8 floating Prop_Support structures removed by 7c93314d (OB-143) reappear on an old save, which fails the story AC ("an old save shows the OB-143 fixes"). The fix:
   - Under the content rule, drop saved structures that are missing from current content, and log them the same way dropped entities are logged.
   - Re-apply `dynamics` only to ids that are still present.
   - Build `currentContentIds` (line ~144) from the CURRENT world's structures, not from `state.structures`.
   - If runtime structures ever exist, give them an explicit `runtime: true` flag later.
2. **A z-only content fix loses.** The overlay keeps the saved z whenever x/y are unchanged. A content fix that re-grounds an entity at the same x/y, or changes its authored numeric z, therefore never shows. Keep the saved z only when x/y are unchanged AND `|saved z - content z| <= 0.05 m` (the ground-snap noise is about 2e-3).
3. **Tests in serialize.contentWins.test.js.** Each case must fail with the fix reverted:
   - (a) A structure that is in the save but removed from content is gone after load.
   - (b) A same-x/y entity whose z changed in content takes the content z.
   - (c) A content entity whose x/y changed in content keeps its saved runtime state: voxel anim/frame (opened chest), door state, health. S6b added the overlay but no test of it against changed content. Today it is covered only implicitly, by the unchanged-content round trips.

**ANIM-C-04**

4. **The feedLegs.test "driver adds ~0 B/frame" check is flaky on PC-A.** It failed 5 of 7 runs, at HEAD, e0a5f955 and its own commit, at 83-89 KB per 1500 frames (about 55-60 B/frame). It measures a single gc'd window, not the 38.61 recipe. Switch it to `allocProbe` (warm-up, then the minimum of 5 windows) and compare against the plain feed. If the allocation is still there, find it: a likely suspect is the double args of `legPass(..., yawDeg, r)` or `driver.update`, boxed when not inlined.

**ANIM-BLEND**

5. **01a: the `blend.test` "layered pose: 0 B/call" gate fails on PC-A.** It measured 1.89-1.99 B/call against a limit of < 1, and fails at f5cf34c1 too. A bisect in a scratch copy showed the same harness with `inst.layers = null` already gives about 1.2 B/call, and the from source plus additive add about 1 B on top.
   - Pass the double args of the new layer calls (the extra `sampleInto` sources and the additive delta) through typed scratch, as 01b did with `_dt`.
   - Then make the gate pass on Node 24.21. If the null-layers baseline is the cause, measure the layered path as a delta against it and say so in the test.
6. **01b: animBlend.test takes 7.4 s standalone** (the rule is < about 5 s). Cut the iteration counts.
   - Advisory: `cacheTotals` adds `totMs` to the shared packed clip objects at `attach`. Compute it at pack time (`packClips`/`packBlend`) instead, so the pm shape is fixed after pack.
7. **01c: the animBlendLegs.test "0 B/step blender + driver" gate fails on PC-A.** It measured 0.62-0.78 against a limit of < 0.5, and fails at d311d32e too. Find the source and fix it. The likely candidates are double args, or a boxed return in the io[11] / F_PAT path or in the test's `frameC`. Do not raise the threshold (D-039 spirit).

**NAV-LAYERS-01c**

8. **The layered `steer.step` allocates about 240 B/step.** In layersFlow.test, "0 alloc: layered flow build + dirAt + smoothPath + steer.step" grows a deterministic 48192 B, and fails at 8921d88e too. A bisect in a scratch copy:
   - flow build, `dirAt`, `findPathCells` and `smoothPath` are each clean;
   - only `steer.step` on the layered grid allocates.
   
   Likely cause: double args (x, y, z) passed to the non-inlined `walkableAtZ(grid, x, y, z)` (up to 3 calls per agent per step), to `grid.locate(x, y, z)`, and to `ff.dirAt(..., z)`. Pass them through a module Float64Array scratch, or inline them. The gate must pass unchanged.

## Advisories (no re-review needed)
- A1 S6b: the overlay lets the save win for every field of a component that content also has, and re-adds non-identity components that content removed. That covers runtime state, but authored component fields changed in content stay stale in old saves (for example `questPickup.item` or dialogue ids). Long term, mark the runtime fields per component kind in the schema. For now, record it as a known limit in the lane.
- A2 ANIM-C-04: 38.67 "Clips" says the fauna feed drives the gait clip time from Phi. The feed does not do this yet: head, tail and bob run on the clip player's own clock. Make it a small follow-up row, or fold it into ANIM-BLEND-03.
- A3 NAV-REACH-01: `bankT`/`bankHold`/`partialGoal` are behaviour state, but they are missing from `hashSim`. Add them the next time the beast goldens are re-pinned for another reason. Not worth re-pinning for this alone.
- A4 VOX-PARTS-16: the bench measures JS only: 30 animals with 12 parts cost +0.07 ms p95 over the 6-part reference, with raster + sun encode only. GPU cost against D-085 is still estimated (+0.1-0.3 ms on Intel high). Check it on the first owner bench after ANIM-B-01a ships knee models.
- A5 voxelMesh.test.js:225 and chargen rig.test.js:130 still decode the layer with `0x3FFFF`. That is harmless for parts < 8. Tidy it to `0x1FFFF` with the next touch.

## ASK ARCHITECT: "ANIM-BLEND mid-fade pop (needs a 3rd source)"
**Answer: no 3rd source and no baked pose layer for now.** Reasons:
- The current trick already covers the common cases exactly. It reuses the from-slot's A/B pair as {current dominant, old from} at the old fromW, which is exact whenever the sources are single clips.
- The only case that collapses is a request change in the middle of a fade while a speed set is half-blended. With the leg solve on, the legs are overridden after all layers anyway, so only body, head and tail can jump. Walk and run differ little there.
- A 3rd source costs AnimLayers 20 -> 24 floats, a 6th `sampleInto` per pose, and a format change.
- A baked pose needs the pose output inside the blender. That would make engine/entities depend on voxelPose output per slot (+96 doubles per slot), which is the wrong direction.

**Cheap rule to apply in ANIM-BLEND-03 or a small 01d, only if the owner sees a pop:** at a mid-fade change, keep exactly the source with the larger displayed weight and collapse the other one.
- If `fromW < 0.5` and the current source is a set, copy the full current set (A/B/w2 at its phase) into the from slot and drop the old from.
- Otherwise use today's path.

The worst pop is then min(fromW, 1 - fromW) x the difference of the dropped source, and it is usually much smaller. Revisit a real 3rd source only if the owner's look at ANIM-BLEND-03 still shows a visible jump.

## Next steps
- kestrel-2 (or whoever owns serialize): items 1-3, then re-review by architect opus with the diff only.
- kestrel-3: items 4-8 (alloc gates + animBlend runtime). Re-review: opus, diff + this file. The alloc probes must pass on PC-A's Node 24.21; the main session re-runs `node tools/run-tests.mjs --filter feedLegs|blend|layersFlow`.
- Main session: run the gpucompare `vox12` row (VOX-PARTS-16b gate). The ARCH OK items go to the PO batch.
