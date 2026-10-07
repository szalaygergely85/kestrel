# ED-MESH-01d — mesh scene picking and drag commit

Kind-9 samples resolve to mesh placements from hit-position bbox candidates,
with click-only ray/render-triangle testing when bounds overlap. Draw-order
planeId slots are not decoded as structure ids. Cloth samples stay surfaces;
they do not resolve to the tower. The existing nearer-entity fallback remains.

Scene clicks select world mesh structures. A second click with Move starts a
bounds ghost; snapping previews the same footprint ground rule as commit.
Release commits one existing field-edit record and rebuild; Escape discards
the ghost. Neither doc nor runtime placement is mutated while dragging.

Highlights project the world bbox's eight corners through the public pitched
projection helpers with reused scratch buffers. Small boxes retain the full
bracket; boxes exceeding the existing 400-cell area guard use four short
corner brackets (12 cells, the same glyphs, gold foreground and dark plate).
This makes close mesh selections visible without widening the prop guard or
spending an unbounded overlay budget.

Node tests cover kind-9/cloth routing, overlapping render triangles, draw-order
independence, bbox fallback, translated placements, CPU pick integration,
behind-camera bounds, and explicit plated/bounded highlight cells. Existing
ray and overlay tests pass.

Real GPU: RTX 4060 / ANGLE D3D11, WebGL2, 400x150 scene grid. Physical scene
click selected the new road rock as `mesh_1`; the hit's planeId was
-534773565, confirming no slot decoding dependency. Physical drag changed
origin x from 1475 to 1475.5 on release; doc origin stayed unchanged throughout
the preview. Move rebuild 9.6 ms; undo and physical Escape cancellation passed.
Screenshot `docs/test-reports/captures/ed-mesh-01d-selection.png` inspected:
**visible: yes** — rock, inspector and selected Outliner row clearly readable;
gold corner marks visible but thin at full viewport size. Browser/server stopped.

The final full suite also verifies PC-A's engine/WGSL merge received during the
01c final sync. Live geometry preview (01f) still needs 01e engine hooks; scale
(01g) needs MESH-INST-01. No engine, renderer or palette files edited by C.

Final validation: 280/280 suites PASS (0 FAIL/TIMEOUT/WARN), check-deps OK
(existing warnings), focused final mesh-pick test PASS, diff-check clean.
