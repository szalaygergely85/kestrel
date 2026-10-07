# ED-MESH-01 — asset discovery and thumbnails

The Assets tab lists registered imported meshes in separate pack folders and
includes them in search. Mesh thumbnails use the actual imported geometry,
centred and fitted from its bounds. Existing model placement remains available;
mesh rows are preview-only until the structure editing contract is supplied.
No geometry simplification, content activation or palette changes were made.

## Verification

- Node coverage uses real Quaternius rocks and Ruins fence geometry: grouping,
  search, distinct model/mesh icon identities, centred mini-worlds, camera fit
  and unchanged source level data. Existing model icon tests also pass.
- Real GPU: WebGL2, NVIDIA RTX 4060 / ANGLE D3D11, 400x150 scene grid, editor
  served on owned port 9800. Browser and server stopped after capture.
- Live registry contains 35 Quaternius meshes. Folder and search checks passed;
  all three `Rock_Medium` results had rendered thumbnails, with zero icon
  failures and at most one thumbnail rendered per frame. Clicking a mesh row
  left placement unarmed, drag absent and document clean.
- Screenshot: `docs/test-reports/captures/ed-mesh-01-assets.png` (local capture).
  **Visible: yes** — three distinct rock previews and their labels are readable
  against the Assets panel's dark background. Screenshot inspected.
- Ruins geometry is covered by the Node fixture, but is absent from the live
  manifest and therefore does not appear in the browser library. Its existing
  licence evidence gap was not bypassed by activating it here.

Validation: 266/266 suites PASS (zero FAIL/TIMEOUT/WARN); `check-deps OK`
(468 files, 1309 pre-existing warnings); `git diff --check` clean.

## Remaining ED-MESH-01 work

Placement, move/yaw, collider rebuild and save round-trip still require PC-A's
structure editing note. Scale additionally requires B2 MESH-INST-01 support.
Recommend defining the structure selection/edit/rebuild contract first and
shipping supported transforms, then scale; alternative: wait for scale support
and deliver all remaining acceptance criteria together. This report covers a
clean discovery step, not completion of the whole story.
