# ED-GROUP-1c - editor prefab save and stamps (2026-10-09)

Selection can now be saved as a prefab from Assets, loaded from a manifested file
or imported export, and stamped with an explicit yaw. The editor consumes the
merged public prefab seam; no engine or game bootstrap code changed.

Save uses groupSnapshot world positions, centroid XY/minimum-Z pivot and world
yaw. Visual props/lights retain authored visual/collider fields; IDs, group and
provenance/ref fields are stripped. World voxel components become prop model
fields; gameplay entity components are refused rather than silently lost. Titles
become lowercase snake IDs. Frozen engine parsing enforces the file contract.

Directory Save writes content/prefabs/<id>.prefab.json before appending the real
on-disk manifest, preserving unrelated entries. Existing manifested IDs are refused.
Cancellation/failure leaves the session asset dirty for retry. Download fallback
exports both files, with placement instructions in README. Ctrl+S accumulates all
pending prefab manifest entries. Loading validates against existing meshes too.

Each stamp expands through placePrefabItems and worldToItem into ordinary level
props/lights or world voxel entities. Accepted members receive fresh IDs, one new
group ID and prefab provenance. One insert batch means one undo record. Gap cells,
unknown models/presets, outside lights and excess lights are reported and skipped.
There are no linked instances or runtime prefab expansion.

Validation:
- prefab.test.mjs PASS: rotated source frame, original-pivot round trip to 1e-9,
  collider preservation/ref stripping, two independent stamps/IDs/groups, rotated
  local yaw, batch undo, partial refusal, canonical real loader round trip and
  reopened doc, cross-file lint, FSA write order/manifest preservation/cancel retry.
- Existing io 21/21 and doc 45/45 PASS. validate-content: 3,416 checks, zero findings.
- check-deps OK (651 files), 1,358 existing warnings.
- Full runner: 372/372 PASS, zero FAIL/TIMEOUT/WARN.
- Real RTX 4060/D3D11 WebGL2 400x150: physical Save button writes both files through
  a memory-backed FSA adapter, physical prefab-row arm/viewport clicks stamp two
  independent crate pairs at yaw 90, one undo per stamp, undo/redo and content
  loader/World reload PASS. Four unique IDs, two groups, all live entities. No
  checkout files are written by the browser fixture. Game boot: Game Play-test boot confirmed all four stamped entities, zero exceptions.
- Visible: yes - both dark crate pairs are distinct against green/gold ground at
  roughly 6 m; prefab title, Save button, yaw field and Assets entry are readable.
  Inspected docs/test-reports/captures/prefab-two-stamps.png (local/ignored).

Repeat: node tools/editor/verify-prefab.mjs 9880. Owner walk: open the editor,
select two plain props, title/save from Assets (choose content/), click the prefab
row and two ground points, undo/redo, save world/level, Play-test or reload the game.
Browser automation uses memory-backed directory handles; native directory chooser
interaction remains an owner walk check. Stamps may cross files, so persistent
click-to-select groups retain the existing per-file selection scope.

The first GPU check exposed missing provenance on newly added files (file ID lives
in the envelope, not def); main now supplies the envelope ID to the stamp helper.
An initial shell edit used Windows' default text encoding and failed on the prefab
glyph; the file was reconstructed from HEAD and the edit reapplied as UTF-8.

No production content/manifest, design, engine/render, game/main.js or backlog edits.
Final sync: master 33d7a40 and pc-a 467a0bf unchanged; diff check clean.
Original checkout owner edits untouched; continuation clone used. Owned processes
cleaned and port 8000 untouched. Ready for PC-A PO review.
