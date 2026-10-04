# ENV-01a1 ground-detail data — PC-B, 2026-10-04

Implemented architecture.md 37.4 step a1. `scatterDetail` validates and normalizes content defaults, uses the specified world-aligned hash grid, rejects ground-type margins, steep slopes, structure footprints and disc/capsule exclusions, and produces a stable tile-sorted SoA. Weighted species, quantized yaw, sinking and dithered squared draw radii use the specified hash slots. Placement/species limits name their failing config key. Tree scatter code is unchanged.

`World.load({…}, assets, {detail:true})` derives `world.detail` after the tree scatter. Entity exclusion discs read finite positions from the registered authored world; moved saved entities and new runtime entities cannot move detail. No registered authored world means no entity-position fallback. Spawn-only entities have no finite authored x/y and are covered by structure exclusion. Derived detail is absent from saves. The public engine entry exposes the scatter/validation helpers; no game flags or draw feed are added in this step.

`buildDetailCollider` produces one optional mesh-only BVH: eight-sided rock prisms with top fans (24 triangles each), or yawed log boxes with four sides and tops (10 triangles). Bottom is z−.5, top z+h. Non-collider species contribute no triangles. Grid physics keeps its old colliders and movement.

Validation:

- 42 scatter + 15 world integration + 31 collider checks PASS (88 focused checks). Coverage includes byte-identical repeated scatter, type/slope/structure/capsule/entity exclusions, exact hash-derived values, stable tile ordering, named validation errors/hard cap, saved-entity independence, serialization, prism/37° log collision approaches, rock-top support, 600-step replay and bit-identical grid motion.
- Working tree: 225/225 suites PASS; isolated publish candidate: 222/222 PASS. Dependency check, typecheck and content validation PASS; existing tree-scatter/trunk suites PASS.
- Synthetic scatter measurement 2.097 ms (<40 ms warn-only target), 284 exclusion-fixture placements / 1504 two-layer placements; integration fixture 243 rocks.
- Dense synthetic collider stress fixture: 1829 solid placements; BVH 80.024 ms and full load 144.383 ms. BVH exceeds the 10 ms **warn-only** target. Record and remeasure actual collider densities when ENV-01d/01b content lands; this stress fixture is not a shipped content budget claim.
- Actual world_m1 load with detail enabled: recipe.detail absent, count 0, no detail collider. PC-A owns the pending models/recipe. No renderer, main.js, cinematic or clip work; no frozen dda checks.

Status: **arch-review** for PC-A. No deviation from the a1 data/collider scope. ENV-01a2 drawing remains gated on ME-06c3's merge; visible ground dressing also needs ENV-01d models/recipe and ENV-01b tuning.
