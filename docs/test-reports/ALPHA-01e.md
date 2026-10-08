# ALPHA-01e - leafy Quaternius trees/bushes: import done, species switch BLOCKED (ASK ARCHITECT)

Date 2026-10-08, branch pc-b2 (base d20c5f6), lane B2.

## Done
- Imported (LOD0, full source detail, `--masks content/masks`, meta + bin, collider proxy): CommonTree_1..5 (6265/5648/3505/4066/3182 tris), Pine_1..5 (3947/3648/4964/3370/1646), Bush_Common (900), Bush_Common_Flowers (1368). Leaf ranges masked (`quaternius/Leaves_NormalTree_C`, `Leaf_Pine_C`, `Leaves_TwistedTree_C`, `Flowers`, cutoff 0.2), bark ranges opaque (auto-opaque rule WARN on Bark_NormalTree, as designed). mats: bark `timber_old`, CommonTree leaves `leaf`, pine `leaf_dark`, bush `leaf_light` (+ flowers `petal_yellow`). 4 mask files (`content/masks/quaternius/`, manifest `masks`), 12 meshes in `content/manifest.json`.
- Collision: `withCollision` (tools/gltf-import.mjs) now sets `colliderParts` = the opaque (bark) ranges for `CommonTree|Pine|TwistedTree_n`, so the 28-tri prism comes from the trunk only (crowns would be 4 m wide); `gen-mesh-colliders --check` 0.
- `edge:'soft'` on the real `leaf`, `leaf_dark`, `leaf_light` (design/palette.js + design/detail-pass.js). `*_softtest` clones KEPT: the gpucompare alphaLeaves fixture is in game/js/dev/modes/gpucompare.js (B1 file) -> NEEDS B1. ShadeTextures.test expects the 3 real + 2 clones.
- THIRD_PARTY_NOTICES Quaternius line extended (47 models, masks). content-smoke test accepts `manifest.masks`. Chart re-baked (inputHash only).
- Trunk measurements for the species (bark radius at z 0.4..1.4, lowest leaf card) are in design/levels/overworld_far.js as a comment block; CommonTree trunkR 0.45-0.5, Pine 0.35-0.45.

## BLOCKED: species switch
`InstanceGroups.meshGroup` throws on masked ranges (instances.js:342) and `meshGroups.js` keeps masked meshes out of groups; forest scatter (1500 trees) is only possible as instanced mesh groups. Switching the species now makes `World.load`/`bindScatterInstances` throw, so the voxel species stay active. Porting the masked INSTANCED variant is not trivial (est. 1-1.5 d): rasterJS instanced mask + per-range, WGSL `instanced` + shadow variants with the uvMask vertex stream and `texMask`, `MeshBuffers` voxel entry uvMask stream, GPU-cull indirect args per range with a mask pipeline, passRaster + passShadow (B1 files), lift meshGroup throw, gpucompare poses with masked instanced trees (B1 file). NEEDS ARCHITECT: approve the port and its owner (B2 for engine/mesh + wgsl; B1 for passRaster/passShadow/gpucompare).
NEEDS OWNER: LOD1 pick (design/preview/lod1-trees.html); `meshFar`/`lodCells` hooks not touched (mesh groups still have no LOD).

## Gates (RTX, same session, base = git archive of d20c5f6)
- gpucompare webgpu: base 148 PASS / 2 FAIL, new 148 / 2, same rows; only changed metric: `lowpolyTrees` `cmpCells.fgMeanAbs` 0.004866 -> 0.004708 (leaf soft). forestWalk/forestEdge unchanged (voxel species still active): old = new, so no forestWalk re-baseline yet.
- gpucompare webgl2: base 139 PASS / 11 FAIL, new 138 / 12. One PASS->FAIL: `lowpolyTrees` (fgOutside 1140, cells outside 4.5 %, edge-pass only): the TREES-LP-b lowpoly tree uses `leaf`, now `edge:'soft'`; the frozen GLSL edge pass (D-044) does not know soft, so it diverges exactly like the 4 alphaLeaves known-FAIL rows. NEEDS PC-A: D-039 ruling (record `lowpolyTrees` as WebGL2 known-FAIL, same class) or keep `leaf*` un-flagged until the species switch lands.
- run-tests 334/334 PASS 0 WARN; check-deps OK; validate-content OK; validate-mesh 51 meshes 0 over budget (report: CommonTree/Pine are 1.6k-6.3k tris vs the 2000 per-id report budget, MESH-FULL keeps them); gen-mesh-colliders --check 0; route walk 10/10 legs completed, endTriggered.
- Screenshot pair: not taken (no leafy tree is placed until the species switch).
