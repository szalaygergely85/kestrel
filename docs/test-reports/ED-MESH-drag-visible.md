# Imported mesh move preview

Owner report: an imported mesh disappears while being dragged, so its placement cannot be judged. The previous ED-MESH-01d gesture displayed only a translated bounding-box ghost. The editor now translates the selected runtime mesh's frame, origin and bounds together; the actual rendered geometry follows the ground-snapped cursor position. The authored yaw stays fixed.

This is a narrow editor translation preview requested by the owner, ahead of the queued public ED-MESH-01e hooks. It uses the existing runtime placement fields and `renderVersion`; no engine/render or game files change. The broader 01e engine setter, collider rebuild API and near-band-centre work remain open. Content and the merged collider BVH remain untouched during preview. Release restores the preview snapshot then uses the existing single command/World reload path, which rebuilds committed colliders. Escape, invalid drop and a replaced runtime cancel the gesture. Inspector edits, yaw and scale retain their existing paths.

Node regression compares a translated, rotated rock's frame/bounds to a fresh World load; checks exact restoration after 1,000 preview updates, unchanged content/BVH, invalid coordinates, no-op cancellation and stale runtime rejection.

Real GPU: RTX 4060 via ANGLE D3D11, WebGL2, scene grid 400x150. Physical mouse drag of `quaternius/Rock_Medium_1` moves runtime x=1475 to 1476.25 before release while content stays x=1475, undo size=1 and rebuild count=1. Release saves the exact preview origin, adds one undo record and one rebuild (~9.9 ms); undo and Escape restore content and geometry. Visibility: yes — the large rock stays clearly visible on the road and shifts right in the during-drag capture. No bounding-box-only substitute remains.

Screenshots inspected locally (git-ignored):

- `captures/ed-mesh-drag-before.png`
- `captures/ed-mesh-drag-during.png`
- `captures/ed-mesh-drag-cancelled.png`

The owner's local `content/worlds/world_m1.world.json` edits are preserved byte-for-byte (SHA256 `3a6ef838193922afc30c0b7200fc7a78259b4796c06d1932ab128848bb5d3b40`) and excluded from this commit.

Full suite and dependency results are recorded in the lane log with the shipping commit.
