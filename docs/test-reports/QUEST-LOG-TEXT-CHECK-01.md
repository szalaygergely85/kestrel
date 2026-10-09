# QUEST-LOG-TEXT-CHECK-01 (2026-10-09)

Extended tools/validate-content.test.mjs only; the linter rules remain owned
by PC-B (S8-C-17b). The regression reads the production m1 quest JSON and the
designer's item definitions in an isolated classic-script context. Every
objective text must be nonempty and at most 38 characters; every item name
at most 14, every description at most 38. Diagnostics identify the source
file, objective/item id and field, and print the offending value.

Current content: 6 objectives and 16 item definitions, 38 new field checks.
Focused validation suite: 113 passed, zero failed. No copy was edited, no
fixtures or existing linter rules changed, no runtime/UI/model/world edits.
No new owner-visible rendering change; no screenshot required.

check-deps OK (683 files), 1,270 existing warnings. Full gate NOT RUN: other lanes occupy the machine-wide gate. Published as WIP on wip/pc-b-text-length-guard; story remains unfinished.
The preceding required pc-b merge is also awaiting a full gate. Do not infer
renderer/integration acceptance from this focused text test.

Queue audit: WAYSTONE-01w still needs approved respawn anchors and touch/save
ownership. QUEST-MARK-01w needs production take-step bindings and a quest-state
reader on the registration seam. Recommend expose the existing relay snapshot
getter and authored bindings; alternative an explicit factory injection.
QUEST-CHAIN-02c five-boar count is owner-approved, but QUEST-TEXT-02 note2/updated
objective copy is absent; recommend writer supplies it, alternative expressly
approved placeholders. BEAST-TUNING-01 asks for a dodge/back-step invulnerability
window, while current vitals only exposes invulnerability after damage; recommend
define that check against the existing hit window (60 steps versus 0.5 s windup),
alternative specify/ship a dodge action first. Craft-view labels need writer
keys; recommend author them, alternative explicit placeholders. No invented
story text, guessed bindings or combat numbers were added.

Breach regression WIP remains wip/pc-b-breach-proximity (full terrain timing
156.1/181.0 ms against 150 ms; isolated PASS). Tree integration/audit WIP is
wip/pc-b-tree-lodcells; live voxel species block the mesh-only content change.
No unfinished WIP story is marked complete. Original owner world untouched.
