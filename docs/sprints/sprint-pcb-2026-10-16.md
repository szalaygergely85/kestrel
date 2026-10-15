# Sprint next (PC-B) - 2026-10-16  (PC-B PO draft, manager/owner to confirm)

**Goal:** the first hour of the game plays clean for the owner: quests, compass, combat, caves, looks.

Basis: owner priority 1 done (89 quests pass QUEST-E2E-ALL), D-108 compass, D-107 perf (CPU -25-30 %), OB-191 underground (6 sites), round 4 (integ4) integrating. Slots = kestrel-1..4 + main session. Rows are <= 1 day each.

| # | Story | Slot | Files | Acceptance criteria |
|---|---|---|---|---|
| 1 | QUEST-WALK-OWNER (browser walk + fixes) | main session + kestrel-4 for fixes | tools/capture-browser.mjs routes, game/js/quest/*, content/quests | AC1 headless-then-browser walk of the opening chain + 3 side quests: accept, complete, hand in; stills of `!`, `?`, needle for each (docs/test-reports/). AC2 every hand-in names and marks the next giver (OB-181/183: compass + `!`, journal "Next: ..."). AC3 the tracked-quest switch moves the compass at once. AC4 each bug found = OB row, fixed, QUEST-E2E-ALL still green. |
| 2 | OB-RETEST pack (today's OB fixes) | kestrel-3 (prep), owner verifies | docs/bugs.md, docs/lanes/pc-b1.md | AC1 one checklist page: each OB fixed today (OB-141/142/152/153/183/184/187-191), the 1-line how-to-see-it, a still or `?at=` link. AC2 rows moved fixed -> verified as the owner confirms. AC3 OB-110 / OB-175 stay open until the owner sends F3 line + still. |
| 3 | BH2-G1 difficulty knob (gear) | kestrel-3 (+ PO decision below) | engine/entities/beastSim.js, vitals wiring, Settings > Difficulty | AC1 PO decision: wire `playerDmg`, `respawn` and `eliteChance` now; hide Easy/Hard knobs with no consumer (windup, leash, flank, gear) until BEAST-06b. AC2 live `setDifficulty` rescales living beasts (Node test: hp/dmg before vs after). AC3 menu shows only working knobs. AC4 zero-alloc gates pass on Node 22. |
| 4 | BH2-E1 + E2 + E3 (logic reset + save safety) | kestrel-2 | game/js/quest/logicWire.js, engine/core/logic.js | AC1 logicWire listens to `beasts:reset` and re-runs spawn/despawn; test: reserve group + resetAll -> groupAlive 0 (cemetery trio stays asleep after Unstuck/map travel). AC2 `logic.save()` only when the pending queue changes. AC3 `hashInto` includes `resume`. AC4 existing logic tests green. |
| 5 | UNDER-DRESS crypt/cellar/cave dressing (existing meshes only) | designer-pass via kestrel-1 | design/levels (crypt, Ford cellar, sea cave), no new env designs | AC1 crypt, cellar and sea cave each get 12-20 placed props from existing meshes (bones, urns, rubble, torches, cobwebs-if-existing), torches as lights. AC2 3 stills per site (entry, centre, dark corner) in docs/test-reports/. AC3 structure cap stays 6/8, no new meshes, perf bench no worse than +0.1 ms. AC4 chest/enemy density test stays at 0 loose (OB152-DENSITY-FIX rule). |
| 6 | OB-136 Ford hub zone fix (needs owner choice) | kestrel-4 | content/quests (m1 chain targets), zone bands data | AC1 per owner answer: (A) Ford hub treated as a level 1-5 pocket (beast levels at the ford clamp to <= 5) or (B) the early quest objective moves to the tower side. AC2 audit test: no quest at level <= 5 has a target across the river unless pocket-flagged. AC3 QUEST-E2E-ALL green. Blocked until owner answers. |

Reserve (take if a slot frees): ANIM/WATER alloc rows per PC-A ruling (ANIM-BLEND-01a/c-FIX2, NAV-LAYERS-01c-FIX2, BEAST-ALLOC-FIX2, NODE24-ALLOC - needs Node 24 on PC-B), WIND-GUST-01b, PERF-MEASURE-02 (laptop), GLYPH-NORMAL-01 (only if owner approves the stills).

## Needs owner
1. OB-136: move the Ford hub to the tower side, or make it a level 1-5 pocket? (story 6)
2. Approve quest chain plan v2 (unblocks OB-181/182 closure).
3. GLYPH-NORMALS stills: keep or drop (gates GLYPH-NORMAL-01).
4. OB-189: are row stripes acceptable now at low + high?
5. Run PERF-MEASURE-02 on the laptop (occl preset decision).
6. Walk-test list in docs/lanes/pc-b1.md "PO batch 2"; hard reload (Ctrl+F5) after each push.
7. Confirm difficulty decision in story 3 (hide dead knobs vs wire all).

## Needs PC-A
1. Ruling: do alloc gates apply to oracle-only JS paths (WATER-ALLOC-01, RENDER-ALLOC-02)? PO proposal: warn-only.
2. BEAST-POOL-c-FIX: accept the 9.5 s test or split it.
3. A 9th structure site needs an engine story (cap 6/8 used, 38.75).
4. Ratify D-107, notes 37.16.5, 38.75-38.78, EP-UNDER G, section H.
5. NODE24-ALLOC verification (PC-B has no Node 24); the 2 shaftForest* frame-B gpucompare rows (wrongDir 12/4477).

> **Main-session note 2026-10-15:** stories 3 (BH2-G1: windup/notice/leash/playerDmg live + groupDelta/elite/flank) and 4 (BH2-E1/E2/E3) were DONE today on PC-B branches and are in integration round 4 (kestrel-4 integ4) - replace them with reserve items (gear knob, PERF-MEASURE-02 laptop, alloc rows per the PC-A ruling) at planning.
