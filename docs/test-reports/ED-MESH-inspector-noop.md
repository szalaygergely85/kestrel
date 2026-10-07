# ED-MESH-01c follow-up — unchanged inspector fields

Leaving an unchanged mesh ID field previously ran rename validation and
reported the minted `_N` suffix as forbidden. Leaving unchanged numeric fields
also committed redundant edit records. The mesh inspector now compares the
parsed field value with its displayed source value before invoking a command.
Returning an invalid field to its original value clears the error without an
edit. Changed fields still use the existing validation and commit paths.

The Node regression dispatches the actual rendered inputs' blur/change
callbacks through a small DOM fixture: unchanged fields do not rename or
commit, changed reserved ids report errors, blank numeric fields remain
invalid, changed numbers/checkboxes produce patches, inherited mesh defaults
are reflected, and the source placement remains untouched.

Real GPU: WebGL2 / RTX 4060 / ANGLE D3D11, 400x150 scene grid. After placing
`mesh_1`, blurring/changing every unchanged field kept undo size 1 and rebuild
count 1, with no error. Typing `invalid_123` reported the reserved suffix;
restoring `mesh_1` cleared the error and kept undo size 1. Screenshot
`docs/test-reports/captures/ed-mesh-inspector-noop.png` inspected:
**visible: yes** — minted ID and other inspector fields readable, no erroneous
validation message, selected rock clearly visible. Browser/server stopped.

Only mesh inspector behaviour changed; no engine or content edits. The next
queue steps still require 01e live-preview hooks and placement scale support.

Validation: 281/281 suites PASS (zero FAIL/TIMEOUT/WARN), check-deps OK
(489 files, 1310 existing warnings), diff-check clean.
