# ED-GROUP-1a: multi-select

Scope: architecture 37.11 step 1a. Selection is now `{items, primary}`; existing single-item paths read the primary member. Plain click replaces the set, Shift/Ctrl+click toggles props/lights, and a drag starting on empty viewport space selects their projected pivots. Shift/Ctrl box selection adds without duplicates; Escape preserves the previous set. World prop entities are included; mesh/level structures, triggers, interactables and other entity types stay outside multi-select v1.

The Scene Tree marks every selected content row. The inspector names the primary item its fields edit. Each selected prop/mesh/light is highlighted; large prop bounds use the same bounded corner marks already used for meshes, without increasing the per-item 400-cell guard. Markers draw before selection so secondary selected lights retain their gold highlight. The box overlay reuses its gesture rectangle rather than allocating one per frame.

Box candidates include each placed level's authored frame, exclude unplaced level files, and use runtime positions for resolved `z: "ground"` props. Viewport box selection excludes hidden/locked items. Selection-only gestures never change content, dirty flags, undo or the runtime structure list. Renames/undo follow all selected copies, including a secondary member, while preserving the primary index.

Node fixtures: immutable replace/toggle and primary fallback; placement identity; rename/inverse rename across copies and a secondary member; forward/reverse/additive/empty/edge box hits with a fixed pitched camera; behind-camera/off-viewport exclusion; translated/rotated level frames; world prop eligibility; runtime ground height; no content mutation. Existing editor overlay tests pass with explicit dark plates.

Physical browser check: RTX 4060 via ANGLE D3D11, WebGL2, grid 400x150. Camera inside the tower at (1497, 1028, 2.7), yaw 0, pitch -12. Real Outliner Shift/Ctrl clicks and viewport Shift/Ctrl clicks add/remove a prop. A box selects five tower props plus two lights; all seven rows are selected, and the inspector reads "7 selected" with its primary light. Additive selection keeps the extra member and deduplicates the existing set. Hidden/locked exclusions and Escape pass. The document remains byte-identical, undo size=0 and rebuild count=0 throughout selection checks. A separate mesh-drag regression still previews actual geometry, commits once and restores on undo/Escape.

Screenshot `captures/ed-group-1a-multi-select.png` inspected locally (git-ignored). Visibility: yes — all selected rows have clear cyan accents, the primary/count label is readable, and gold brackets/marker cells are visible in the scene, though thin at the full viewport size.

Group move/rotate/delete/duplicate and persistent `group` fields are step 1b; reusable prefabs are step 1c. They are not reported complete here. No engine/render/game files or authored content are changed. The owner's local world JSON retains SHA256 `3a6ef838193922afc30c0b7200fc7a78259b4796c06d1932ab128848bb5d3b40` and is excluded from this commit.

Final full-suite/dependency results are recorded in the lane log with the shipping commit.
