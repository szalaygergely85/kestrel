# CHEST-PLACE-01 / BOAR-ROSTER-01 proposals - 2026-10-09

Proposal-only deliverable per the lane C unblock queue. The new editor wrapper
loads the existing chestSmall asset, refreshes the public voxel pool, and uses the
existing place/rename/field-edit commands in memory. It does not save or change
production world/quest content, grant loot, or author new design assets.

| ID | World x | World y | Feet z / yaw | Recommendation |
|---|---:|---:|---|---|
| hillsideChest | 1471.25 | 1050.25 | ground (preview 2.345527 m), yaw 90 | Small chest on the start hillside, behind existing roadL207 rock, facing east for the side approach. Fixed 1 shield + 1 heart.piece; confirm the heart ID before applying. |
| boar1 | 1461.01 | 1031 | ground | Keep the existing home and ID. First of the two existing beasts on the waystone route. |
| boar2 | 1444.02 | 1035 | ground | Keep the existing home and ID. Second existing beast further along that route. |
| initialSpawn | 1497 | 1027.5 | 0, yaw 330 | Keep current tower.start + placed frame. Original wake pitch 30; standing preview uses eye height 1.6. |

Why: the quest already names exactly boar1 and boar2 with count 2, so no additional
beasts or roster migration are needed. The player's actual loaded spawn transform
matches the authored start. Chest is about 34.4 m from wake, 29.5 m from the breach
and 18.3 m off the nearby path sample; this is a hidden side excursion, not a blocker
on the main route. Existing roadL207 bounds end at y=1049.06094; even a conservative
0.35 m chest half-footprint ends no farther north than 1049.90 (0.84 m clear). This
is a bounds check, not a full gameplay collision walk.

Visible: yes - at a normal 1.6 m eye height and 1.5 m approach the complete chest,
brass latch and dark bands are distinct against green grass. From the main path it
is obscured by the existing rock/tree line (expected for a hidden chest). The two
boars read as dark silhouettes along the path, one nearer and one further away.
The editor selection marker is an authoring aid, not a proposed gameplay marker.
No new glow/light or terrain/scatter changes are added by this proposal.

Owner preview: tools/editor/anchors.preview.html; buttons select chest close
approach, path, boar route and existing wake anchor. Header carries the proposal
coordinates. The chest is session-only; do not save the preview fixture.
Repeat: node tools/editor/verify-anchors.mjs 9880.

Evidence: real RTX 4060/D3D11 WebGL2 at 400x150, source ID/home/spawn assertions,
preview contains the original five world entities plus only hillsideChest, and
physical pose-button clicks and zero JS exceptions. Production world bytes compared before/after the browser pass.
Captures (ignored): docs/test-reports/captures/anchors-{chest,road,boars,spawn}.png,
anchors.json. First capture had no chest because its late-loaded model was missing
from the editor pool; the preview now explicitly rebinds the existing pool. Initial
close camera clipped the chest; final 1.5 m / -40 degree view shows it completely.
These are fixture corrections; no renderer/engine/product workaround.

Full runner: 370/370 PASS, zero FAIL/TIMEOUT/WARN. check-deps OK (646 files), 1,358 existing warnings.
Browser scripts syntax-check; diff-check clean. Owned server/browser/profile cleaned
up, port 8000 untouched; original checkout world edits untouched.

NEEDS PC-A / owner: approve these anchors and confirm heart.piece. Recommend retain
both boar homes and the current spawn, with the optional east-facing chest behind
roadL207; alternative choose a nearer-road chest site if an 18 m detour is too hidden.
Heart recommendation is the existing inventory upgrade heart.piece; if healing was
intended, choose the exact pickup reward contract before content is applied.
After approval: separate content/placement commit using the editor tools, then B1
loads the chest definitions into the existing hook (main.js still supplies defs:[]).
