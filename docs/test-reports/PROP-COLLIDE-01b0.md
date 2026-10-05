# PROP-COLLIDE-01b0 — 2026-10-05

Status: **arch-review**; implements architecture.md 37.10's static-sprite amendment.

`World.rebuildPropColliders` now resolves authored colliders for static prop entities with a voxel or sprite component, using the existing prop override / model-default rule. Explicit `[]` opts out; missing shapes remain absent. Dynamic/roller props still warn and skip. Billboard and non-prop entities do not contribute collision shapes. Sprite scale validation and the shared closed BVH builder are unchanged. No content colliders were authored in this step.

Files: `engine/world/World.js`, `engine/world/propColliders.test.js`.

Validation: **240 prop checks PASS** (11 added), **31 unchanged detail checks PASS**. Full isolated prospective commit **222/222 suites PASS**, zero FAIL/TIMEOUT/WARN; working-tree run during parallel development **223/223 PASS**. `check-deps OK` (393 isolated files, 1,303 advisory warnings); typecheck and content validation PASS. No renderer or game-main changes belong to this commit, so browser rendering checks are not required by this step's gate.

New cases cover a model-default sprite prism (32 triangles and independently computed rotated world AABB), missing shapes, `[]`, explicit authored boxes, dynamic/roller warnings, and billboard/non-prop guards. Existing voxel cases remain passing. No spec deviations. Tower content and the owner walk-test remain PROP-COLLIDE-01b.

Developed beside TORCH-01a by two programmer agents with disjoint file ownership; commits remain separate. Unrelated local Ruins/render/content work is preserved.
