# Owner bug log (OB-NNN)

Rule (owner, 2026-10-11): every finding the owner reports gets an **OB-NNN** number here at once, before any work starts.
Commits, agent prompts and lane entries cite the number. Status: `open` -> `fixed <commit>` (main session) -> `verified` (owner) or `reopened`.
Newest at the top of each table. Keep one line per bug; details go in the commit / lane entry.

## Open

| ID | Date | Owner report (short) | Where / notes | Status |
|---|---|---|---|---|
| OB-024 | 2026-10-11 | "What is this?" - wooden arch frame with a roof, crow on top, near the crossroads | Rook's nest ruin (MAP-23, ~975,1058): Medieval-kit arches + half roof + stair pile, nest + chest + Rook on the roof. Reads as scaffolding, not a ruined house. Proposal: rebuild as a broken STONE house (walls with gaps, fallen roof beams, rubble), same climb + roof. | open - owner to decide |
| OB-023 | 2026-10-11 | Mushroom (big shelf fungus) lies in the middle of the road; should grow on a trunk | Red caps cap1..5 (MAP-25, Laetiporus scaled 2.2) placed on the east bank edge without checking road/trees. Fix: place them on tree trunks / stumps / logs, off the road, sensible size. | open - in progress |
| OB-022 | 2026-10-11 | Dialogue: every short sentence needs its own E press - boring. Make lines shorter and GROUP consecutive lines of the same speaker into one box | Dialogue runner/box (game/js/quest/dialogue*). | open - in progress |
| OB-021 | 2026-10-11 | At 560x210 the text (settings menu) becomes blurry | UI layer at the top grid size: non-integer cell scaling / canvas resampling. | open - in progress |
| OB-020 | 2026-10-11 | Smoke north of the ford looks very bad (huge flat grey pillars) | The smokeColumn billboards (6x28 m sprites) removed at once; anchors kept. Proper smoke = thin rising particle plumes (existing particle system), owner to see it before it ships. Particle plumes (farSmoke) on smoke1..3; screenshot docs/test-reports/ob020-smoke-northlook.png. Owner: 'smoke is better, but if I get closer it becomes smaller' - puffs are capped at sizeM 1.0 (engine max) and only kept a minimum cell size far away; near they shrink to thin threads. Fix: bigger puffs that grow with age (raise the engine size cap for this preset), consistent size by distance. | reopened - in progress |
| OB-019 | 2026-10-11 | River looks strange at the ford: flat blue ground, no water shader, no water physics; stepping stones look like smudges | Only a 34x22 m `ford` water region exists (1012-1046 x 1058-1080); the rest of the river is ground painted with the water colour (type 2) with no water surface. 49 stepped water regions (gen-river-water.mjs) from y 832 to the mouth; limits: 8 nearest drawn, steep mountain part not covered. Owner: 'nicer, still work to do - engine and physics' -> v2: river/polyline water with sloped surface, smooth shoreline + depth fade, whole-river draw range, current physics; architect note first. | reopened - architect note |
| OB-018 | 2026-10-11 | A wooden post + table-like structure floats in the air in the forest ("any purpose?") | Identified from the owner's debug pose (1264.25,1041.35,-30.93 yaw 344): the Bend relay `relayBend` (1262,1033, z -30.97) - floats above the ground. | open - in progress |
| OB-017 | 2026-10-11 | Quick bar slot L shows the sword, but the sword is held in the RIGHT hand on screen | L/R slots are labelled as mouse buttons; the view holds the main weapon in the right hand. Owner: L = LEFT hand = MAIN hand (left mouse); R = right hand = off hand (right mouse). Sword/bow drawn + swung on the left (LMB), shield on the right (RMB); verify-equip-play checks sides. | verified (owner 2026-10-11: 'sword is good now') |
| OB-016 | 2026-10-11 | Walking west toward the river, 2 steps past a "beacon in the forest" (lamp-post structure among pines, river behind), teleported back to the tower. Debug mode on. | Root cause (likely): void rescue (fall > 30 m below last safe spot -> snap back) - safe spot only refreshed when grounded AND fallDistance 0; walking down the hill (tower +2 -> Bend relay -31) left small fallDistance, safe spot stayed at the tower. Fix: any grounded step is safe; void rule only while airborne. Test in vitals.test. | fixed - verify |
| OB-015 | 2026-10-11 | Relay/beacon stands "in the forest in a strange way" | Biome forest (MAP-01c) planted trees around the relay/waystone. Owner: no clearing, keep the trees. | closed - won't fix |
| OB-014 | 2026-10-11 | Game failed to load: `World.load: prop "tower.pallet" references unknown model "canvasHeap"` | Not reproducible on reload (game loads to the title). Likely a reload during a merge + generator run. | open - watch; reopen if seen again |
| OB-013 | 2026-10-11 | Editor shows `.` invalid: content level:world_geo util.biomeAreas function values | Editor treated the world_geo helper as a content file. | fixed (editor doc skips code-only levels) - verify |
| OB-012 | 2026-10-11 | Quick bar: sword in slot 1 / right hand; wants [L][R] mouse slots + 1-4 key slots, drag and drop | QB-6 redesign; browser check verify-quickbar PASS. | fixed - verify |
| OB-011 | 2026-10-11 | Potion box next to the HP bar: REMOVE it; potions show their count in Items and are dragged into the quick bar, whose slot shows the count | Supersedes the D-068 HUD button. HUD button + H potion key removed; bar slots show counts; slot key drinks. | fixed - verify |

## Fixed / answered (2026-10-11)

| ID | Owner report (short) | Fix | Status |
|---|---|---|---|
| OB-010 | T-posed woman next to Burl ("asked 6 times") | Synty `localHero` statue in git-ignored content/local/placements.json removed (backup in scratchpad) | fixed - verify |
| OB-009 | Stones at the tower foot still different from the tower | tower.level.json rock cells -> stone_moss / moss_top (TOWER-STONE-01) | fixed - verify |
| OB-008 | Lake "in the air" (flat water sheet above the river) | Glasswater bowl only under the water rect + shore shelf (LAKE-FIX) | fixed - verify |
| OB-007 | Editor looks different from the game | Editor now installs the geography (world_geo) like the game | fixed - verify |
| OB-006 | Resolution too big; max one step above ultra | Grid list capped at 560x210 (GRID-CAP) | fixed - verify |
| OB-005 | Game drops out: "uniform ring overflow" / "previous pass not ended" | Ring 4160 slots + failed frame dropped instead of fatal (FIX-RING); passes always ended (CRASH-PASS-01) | fixed - verify |
| OB-004 | Console: invalid colour "emberDark" | Wake eyelid resolves palette names to hex | fixed |
| OB-003 | J should list quest titles, open them, main vs side | QL-J + merged with QL-03 (Offered/Active/Done, T track, X abandon) | fixed - verify |
| OB-002 | Starting note "!" missing / character model missing / animals invisible (browser gate) | items catalog to loadQuestFiles; gearLook skips missing shells; voxelPool reserve for fauna (FIX-BROWSER-3) | fixed |
| OB-001 | Editor markers `*` and `o` | Answered: editor-only gizmos (lights, interactables) | answered |
