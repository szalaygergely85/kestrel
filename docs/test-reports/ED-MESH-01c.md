# ED-MESH-01c — mesh placement and controls

Mesh Assets rows arm click placement or drag/drop onto the viewport. Both paths
use ED-MESH-01b's validated footprint snap and minted world structure ids. Drag
ghost uses the same snap as commit. Placement warns above 60 nearby meshes.
The Scene Tree lists mesh structures in a Meshes group and filter, leaving
level structures read-only. Mesh selection exposes world x/y/z, integer yaw,
shadow/collision overrides and id rename. Arrow/PgUp/PgDn, Q/E, G, delete,
undo/redo use existing edit records and coalesced rebuilds. True overrides are
removed from canonical data; scale remains unsupported.

Node tests cover horizontal re-snap, explicit z edits, invalid fields, default
override removal, and mesh-only Outliner rows, in addition to 01b's real-world
command/save/collider coverage. Focused doc/panel/placement tests pass.

Browser check uses real WebGL2 on RTX 4060 / ANGLE D3D11, 400x150 scene grid.
Physical mouse events dragged a mesh row into the viewport, showing the snapped
ghost and committing exactly one world mesh structure. Inspector fields,
yaw/nudge/drop, reserved-id refusal, default-key removal, whole-doc validation,
delete, undo restoration and redo deletion passed. Successful measured place
rebuild: 11.2 ms (architecture budget 30 ms). No runtime world object is
mutated directly; edits go through doc + rebuild.

Initial capture had readable inspector fields but a tree obscured the placed
rock. The clear-road follow-up at (1475,1034) confirmed **visible: yes** — a
large distinct rock on the road, readable inspector fields and selected Meshes
Outliner row. Screenshot `docs/test-reports/captures/ed-mesh-01c-placement.png`
inspected. The follow-up also passed physical click-to-arm + viewport placement,
minting `mesh_2` after deleting `mesh_1` (ids not reused). Place rebuild 11.7 ms.
The capture server
encountered connection refusals during module-loading bursts; using the same
no-cache handler with a larger temporary accept backlog allowed stable boot.
An early probe mistakenly serialised a Promise as an error; awaiting the
validation Promise confirmed no document error. Browser/server stopped after
each probe. No server or renderer runtime source changed.

Scene click-picking and dragging existing meshes belong to 01d. Live drag
preview needs 01e engine hooks, and scale needs MESH-INST-01.

Validation: 273/273 suites PASS (zero FAIL/TIMEOUT/WARN), check-deps OK,
existing warnings only; diff-check clean.
