# PROP-COLLIDE-01a programmer verification — 2026-10-05

Queue 16 item 3b, engine step 01a; architecture 37.10. One derived `props:static` BVH combines explicitly authored static voxel-prop boxes/prisms. Prop `colliders` overrides the model default; `[]` opts out. Centres, dimensions and extra yaw use each live entity's world pose and uniform scale. Boxes have 12 triangles, prisms 32; both have closed tops and bottoms, with no ground skirt. Sprite/billboard props and dynamic rollers are skipped; a dynamic prop with collider data warns with its id. Grid mode stays unchanged.

`World.rebuildPropColliders()` replaces the existing entry in place (or removes an empty entry). The editor calls it only through the committed live-patch path, including undo/redo; drag previews do not call it. Shapes/BVHs are never serialized. On load, the method runs after entity restoration so saved prop transforms produce the same collider geometry as the live saved world.

## Checks

- `engine/world/propColliders.test.js`: **229 checks PASS**. Box facing 0/90/37 and scale 1.5 against independent corner bounds; scaled/rotated prism bounds; eight-direction 0.5 m crate capsule contact within 1e-6; top support and underside ceiling; overrides, sprites, dynamic warning, grid, malformed data, deterministic build, edited pose/scale rebuild, save/load with 200 bit-equal collision probes, 600-step replay hash and empty rebuild.
- `engine/world/detailColliders.test.js`: **31 checks PASS**, file unchanged. A separate 512-placement mixed box/prism/empty baseline check proves all BVH arrays and bounds byte-identical: 5814 triangles, triangle SHA256 `efa3d67ee446173d93bf336fc802c990b34861fada51bf4fe2a0383cbbc6e894`.
- Initial and final merged working-tree full runners: **227/227 suites PASS**; isolated proposed engine/editor code: **225/225 PASS**, zero FAIL/TIMEOUT/WARN. Final dependency check OK (391 files; existing warnings), including typecheck/content gates.
- Mesh browser routes, ports 9520 and final merged 9528: **10/10 legs complete**, no falls, end trigger reached, default physics selection verified without a physics query. This verifies the engine change against current shipping content; tower collider data belongs to 01b.
- Synthetic 25-prop/300-triangle complete World rebuild (30 warm-up, 100 samples): p50 **0.512 ms**, p95 **0.809 ms**, max **1.005 ms** while suites were running. Builder alone: p50 0.447 ms, p95 0.597 ms, max 0.793 ms. Actual authored tower timing awaits 01b.

## Sync and scope

Final PC-A sync includes `50988f4`: ground scatter opt-out is `?scatter=0`; `?detail=0` remains the shading switch. The merged main keeps MESH-PHYS-DEFAULT's default and explicit grid override. An isolated browser recheck (ports 9524/9525) passes plain URL, grid override, detail=0, and trees=0/scatter=0, each with the real R restart. Detail=0 retains all 17,014 scatter placements and 25 groups; scatter opt-out clears them. No exceptions/fatal card.

Files: `engine/world/colliders.js`, `World.js`, new `propColliders.test.js`, one committed-edit hook in `tools/editor/main.js`; synced main/spec/backlog plus this report. No engine render or shader changes. Existing unrelated Ruins/sword/render edits are excluded.

Implementation placement differs from the spec's spawn-loop wording: collider collection runs after **both** the content-prop spawn and saved-entity loops, through the same rebuild method. This is necessary to read restored transforms instead of skipping saved props. Save/load equality is tested.

Status: **01a arch-review**. **01b NEEDS PC-A:** 37.10 explicitly skips sprite/billboard props but requires floor-lantern prism collision. `floorLantern` is a sprite in `design/models/lantern.js:117` (rather than the 01b table's m3_props.js). Should explicitly authored colliders be allowed on static sprite props, or will PC-A supply a voxel floor-lantern model? Content changes are deferred until that decision; owner collision/corridor walk-test remains pending. Next unblocked queue item after 01a is VOX-CAP-01 unless PC-A resolves 01b first.
