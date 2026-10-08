# ED-MESH-01b — mesh placement data

Implements architecture 37.20's placement helpers in `tools/editor/meshPlace.js`:
shared mesh classes/lifts/shadow defaults, five-point floor snap, rounded world
origins and normalised yaw, validation, reserved id-suffix rename check, and
validation before minting. IDs skip clashes and remain consumed after undo.
The roadside generator imports the same class/default table; dry-run succeeds.
No content files are regenerated.

Node tests cover slope and missing-floor/gap samples, bad fields, unregistered
meshes, finite coordinates, integer yaw, duplicate/suffix ids, default omission,
placement density warning, and minting after validation. Commands insert, move,
yaw, delete, undo and redo through the existing records on the real world_m1
document. The untouched file re-saves byte-identically; insertion adds one
canonical structure line and advances nextId; undo restores structures exactly.

Collider coverage loads the committed rock placements into isolated runtime
worlds with mesh physics. The new merged `meshes:static` collider contains the
placement id and blocks at the new footprint; the old footprint becomes clear.
This isolates the reload mechanism from unrelated world colliders. No collider
engine implementation changed.

This step adds no editor controls, so no owner-visible change or screenshot.
ED-MESH-01c wires arm/drag-drop, panel, keyboard and undo; 01d adds scene picking.

Validation: 273/273 suites PASS (zero FAIL/TIMEOUT/WARN), check-deps OK
(477 files, 1309 existing warnings), generator dry-run PASS, diff-check clean.
