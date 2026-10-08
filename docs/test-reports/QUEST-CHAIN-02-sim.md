# QUEST-CHAIN-02 marker availability simulator

## Result

createQuestMarkers(def, bindings) derives marker target ids from the existing quest's completed prefix and flag/area facts. It shows targets only for the available objective slot whose take condition has not happened. The read/touch take step is distinct from its following item/beast goal: accepting hides the marker while that goal remains active. The completed prefix permanently records acceptance, without relying on a secondary flag that could be cleared. Already completed slots remain hidden, even if a former take flag is later cleared. Early take facts never cause a marker to flash when prerequisites complete.

No new taken-state save layer, quest version, marker entity, renderer integration or production quest change. Validates the existing quest definition/condition schema through validateQuestDefinition; target bindings are checked and copied at create. Reuses frozen target arrays and a shared empty array. markerTargets(state) never changes quest state or formats output; retained results cannot be mutated. One binding may identify several target props/areas, but duplicate target ids within a binding are rejected.

API: createQuestMarkers(def, [{objectiveId,targets:[propOrAreaId]}]). Bind the flag/area read/touch TAKE objective, rather than the later item/beast goal. Item/beast goal bindings and secondary take-condition overrides are rejected. The existing quest definition validates the take condition. The caller invokes markerTargets(existingQuestState), including restored state from the current save adapter. Marker movement/pop/fade/culling remain in the later wire/view story.


## Validation

Focused test with GC PASS: note1 visible until read; sword goal has no marker; note2 available after sword and gone on read; no beast marker; fifth distinct configured boar unlocks waystone; duplicate/unrelated deaths do not unlock it; touch hides waystone. A completed accept step hides its marker while the following item goal is still active, including after the former take flag is cleared and restored. Existing collectSave/applySave bytes and quest facts preserve the result. 600-step replay is deterministic and survives midpoint restore. Repeated queries do not mutate saves, bindings are copied, targets frozen/reused, invalid bindings/states rejected, and 200,000 alternating visible/empty queries meet the existing 64 KB GC bar.

All new chain strings/target ids/boar counts in the test are fixtures only, not approved product content. Final full gate: 312/312 suites PASS, zero FAIL/TIMEOUT/WARN. check-deps OK (549 files, 1,356 existing warnings). Pre-push fetch and merges of origin/master and origin/pc-a are already up to date at c2fbe55; no code changed after the full gate.

## Remaining story scope

**QUEST-CHAIN-02 is partial:** production m1 chain, note props/copy, five-boar roster/coordinates and owner look remain outstanding. NEEDS PC-A: confirm five-boar roster/anchors and deliver QUEST-TEXT-02 note/objective copy plus stable note1/note2/waystone prop and take-flag ids. Recommend authored read/touch flags for note1/note2/waystone and three additional approved hillside homes (matching the owner's five-boar idea); alternative keep the current two-boar chain until placement/copy is approved. The current production waystone condition is area:entered; the owner marker rule says disappear on TOUCH. Recommend make that new chain step a touched flag, or explicitly define the area event as a touch in wiring; do not silently hide on mere proximity. Until those contracts are supplied, the existing m1 quest/world are unchanged.

QUEST-MARK-01w and the other wire stories require gameHooks ARCH OK. The gold marker asset is now present, but this pure query step creates no visible entities. No owner screenshot/visibility claim for the simulator alone; perform the 3 m / 12 m real-GPU look when content/wiring lands. No main.js/engine/design/seam edits. Owner world placements preserved and excluded (SHA256 3A6EF838193922AFC30C0B7200FC7A78259B4796C06D1932AB128848BB5D3B40).
