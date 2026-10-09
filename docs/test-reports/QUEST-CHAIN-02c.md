# QUEST-CHAIN-02c - five-boar hillside content (2026-10-09)

D-053 approves five boars. Added three homes using the existing boar model,
brain and targetable components; boar1/2 unchanged. Updated the production
beasts condition to boar1..5/count 5 and copied the writer's obj.beasts5
line verbatim: Bring down the five wild boars. No new story copy/assets.
The note2 writer text now exists, but the production quest has no note
take-step or note text keys. No speculative note placement/schema added;
QUEST-MARK-01w still requires authored take bindings and the state reader.

| Home | XY metres | Final analytic height | Slope degrees |
|---|---|---:|---:|
| boar3 | 1470, 1008 | 2.3836 | 0.294 |
| boar4 | 1450, 1058 | 1.6395 | 3.611 |
| boar5 | 1430, 1017 | 0.8954 | 5.205 |

Proposals logged in the lane file before application. Slopes use final
terrain central differences at 0.5 m; all are grass and below 30 degrees.
New homes are at least 41 m apart and 22.8 m from existing homes. Live
floorAt and analytic terrain differ by less than 0.003 m at new homes:
no raised structure support. z stays ground-relative. Physical encounter
difficulty and route discovery remain owner/PO review, not a balance claim.

Quest, questMarkers and saveRelay focused suites PASS. The 600-step chain
replay hash is deliberately pinned to 417817816; uninterrupted and midpoint
reload bytes/hash match. Four distinct kills leave the objective active;
the fifth finishes it. SaveRelay's production-data regression now carries
and restores all five deaths; no relay/runtime/engine edits.
Content lint OK (3565 checks, 3 mesh-only models). Dependency check OK
(710 files), 35 warnings. Content fixture suite 116 PASS.
Full gate NOT RUN: other lanes started new full runs, GPU comparison and
flicker checks before a free machine window. Published WIP on
wip/pc-b-five-boars; not marked complete.

Indexed chart check initially reported stale; rebaked from the staged world,
then --check --index PASS (240x120, 67766 bytes). Input hash:
504fc074266cbe45ce3139c5867a5ac11b86b2fa62ecafdba69c68f0b9970464.
Only inputs/inputHash changed, not chart terrain heights or categories.
Changed input hashes include the new world and the previously merged
manifest, overworld recipe and World.js; none of those three files was
edited for this story.

Real NVIDIA Lovelace WebGPU 400x150 editor capture from standing eye height
1.6 m, 5 m east of each new home; zero runtime exceptions. Visible: yes -
dark boar silhouettes distinct against turf, feet on the ground, plausible
size at 5 m. Viewed all three screenshots, including boar3 against forest.
Repeat: node tools/editor/verify-five-boars.mjs 9880. Ignored captures:
boar3-home.png, boar4-home.png, boar5-home.png and five-boars.json.
Verifier cleans only its own server/browser/profile; port 8000 untouched.
Original owner world in the other clone untouched. Owner look remains open.
