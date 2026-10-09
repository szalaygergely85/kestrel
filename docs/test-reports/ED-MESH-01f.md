# ED-MESH-01f - public mesh drag and committed live patches (2026-10-09)

The editor now previews imported-mesh moves through World.setMeshPlacement rather
than writing runtime frame/origin/bbox fields. Preview preserves snapshot yaw and
uniform scale, reuses its setter payload, and refuses invalid/stale targets. Escape
restores the original pose through the same API; authored data and collider BVH stay
unchanged during the gesture.

Move/yaw records in world structures are now live-patchable. Release, inspector,
nudge, yaw and undo/redo reuse the existing command stack and live patch path.
Patch targets are resolved before applying a batch. Mesh collider rebuild occurs
once per committed batch when physicsMode is mesh. Geometry/world identity remain
live; add/delete/mesh/scale/shadow/collision/provenance edits retain the full reload
path. Classification compares removed keys too, so deleting a structural override
cannot be mistaken for a pose-only edit.

The editor's default load remains grid physics. ?physics=mesh enables the public
mesh collision path for authoring checks; structural reloads retain that mode.
README documents live commits and replaces the obsolete 'scale awaits support' line
with the already-shipped SCALE field and Minus/Equal controls.

Validation:
- Existing meshDragPreview test extended: public setter actually called, 1.35 scale
  preserved, fresh-load bounds, 1,000 updates/exact cancel, unchanged authored data
  and collider object, invalid/no-op/stale refusal PASS.
- New meshLivePatch.test.mjs: move + yaw / undo / redo vs fresh scaled World geometry
  and merged collider parts/positions/min/max, unchanged placement/world structure
  version, deferred collider replacement, structural/removed-key/batch refusal PASS.
- Existing livepatch: 49/49 PASS.
- Real RTX 4060/D3D11 WebGL2 400x150: physical drag moved x=1475 ->1475.75 while
  document stayed x=1475, undo size 1 and World rebuild count 1. Release matched
  preview, undo size 2, same World, rebuild count still 1; mesh collider rebuilt
  exactly once. Undo/redo restored/moved the same live World with one collider
  rebuild each. A second drag + physical Escape restored the original pose with
  no further collider rebuild. Zero JS exceptions.
- Default grid-mode browser run also passed with zero mesh collider rebuilds.
- Full runner: 371/371 PASS, zero FAIL/TIMEOUT/WARN.
- check-deps OK (648 files), 1,358 existing warnings; diff check clean.

Visible: yes - imported rock stays large and clear against grass/sky at 6 m through
its live move. Inspected docs/test-reports/captures/mesh-live-drag.png (ignored).
Repeat: node tools/editor/verify-mesh-live.mjs 9880.
Owner walk: tools/editor/index.html?grid=400x150&physics=mesh, place/select a rock,
move/release, undo/redo and Escape; move/yaw no longer rebuild the World.

No engine/render, game/main.js, design or production content changes. Original
checkout owner-world edits untouched. All fixture edits were memory only; owned
server/browser/profile cleaned up, port 8000 untouched. The first browser harness
attempt failed because its generic evaluate helper did not await dynamic import;
explicit CDP awaitPromise corrected the harness, no product workaround.

Ready for PC-A review. Remaining prefab follow-up can now consume the merged
PREFAB-SEAM, subject to its existing 37.11/38.11 notes.
