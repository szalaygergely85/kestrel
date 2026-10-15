# Main quest chain plan: tower to "Smoke in the North" (2026-10-15)

PO plan (opus) for OB-182 (split m1), OB-181 (no `?` at the Bend), OB-183 (stuck, nothing points to Rook), OB-178 (accept, never auto-start).
Rules of record: D-082, D-087, D-105, D-106, OB-156.

## Quest format (owner, 2026-10-15)

Every quest file has exactly these fields. The table below maps 1:1 to them.

```
{
  id, title,
  begin:    { npc: "<id>" } | { object: "<id>" },   // giver: '!' (gold main / blue side), Accept E / Exit Q
  end:      { npc: "<id>" },                        // return: '?' when all objectives are done, hand-in talk
  requires: { quests: ["<id>", ...], level: n },    // prereq quests and/or min level
  objectives: [ 1..3 ],                             // short plain steps
  rewards:  { items: [{ id, n }], coin: n }, // never empty
  next:     "<quest id>" | null                     // offered at the hand-in (never auto-started)
}
```

Mapping from today's files: `giver.npc` -> `begin.npc`; `giver.npc` + `objectGiver: true` -> `begin.object`; `giver.turnIn` / `returnText` -> `end.npc`; `requires: [{quest, done}]` -> `requires.quests`; `reward` -> `rewards`. Removed: `sections`, `silent`, `requires[].step` (a quest can only require whole quests). `main: true` stays (gold marks). New optional field `nextHint` (journal + hand-in line "Rook waits at the ford") - NEEDS WRITER.

**No exception:** every quest has a giver (D-105, owner 2026-10-15: no "Wake Up" quest). Quest 1 Find a Blade is offered by the note on the wall.

## The chain (play order)

Positions are world_m1 x,y. Burl = `bear` (1471, 1029) by the tower door. Rook = `rook` (982, 1060) at the ford ruin. Meadow stone = `endMarker` (1428, 1040). Bend stone = `relayBend` (1262, 1033). Ford stone = `relayFord` (992, 1079).
Rewards: NO XP (D-020); `chart.river` is the existing reward of mq.bend.call. "Heart Piece" and "Health Potion" use the existing item ids (programmer: look them up in the item table; do not invent new items). If coin is not wired yet, drop the coin and keep xp + item.

| # | quest id | title | requires | giver (begin) | objectives (1-3) | return to (end) | reward | next offered | what changes from today |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `tower.blade` | Find a Blade | none (first quest: the note is read when you get up) | the note `noteKeepLight` in the tower (object giver, `objectGiver: true`, allowed by D-087) | 1. Climb to the top of the tower. 2. Take the sword. 3. Leave through the tower door. | Burl, outside the tower door (1471, 1029), gold `?` | 1 Health Potion | `burl.boars` | Already exists; m1 q01/q02 (breach, sword, leave) removed so they are not tracked twice. Title "Not Safe" -> "Find a Blade". Objective "Sword" -> "Take the sword". Add `?` + hand-in at Burl (today Burl just offers boars). |
| 2 | `burl.boars` | Boars in the Woods | tower.blade | Burl at the tower door | 1. Drive off 5 boars in the woods. | Burl at the tower door, gold `?` | 2 Health Potions | `burl.follow` | Drop m1 q03 `beasts` objective. Add rewards + `next`. Mark as main (gold) - it is on the main chain. |
| 3 | `burl.follow` | Follow the Bear | burl.boars | Burl at the tower door (offered at the boar hand-in; Burl walks only on accept, D-105) | 1. Follow Burl. | Burl at the meadow stone (1428, 1040), gold `?` | 15 coin | `burl.stone` | Exists since today (OB-178). Drop m1 q04. Add rewards + `next`. |
| 4 | `burl.stone` | Wake the Stone | burl.follow | Burl at the meadow stone | 1. Wake the old stone. | Burl at the meadow stone, gold `?` | 1 Heart Piece | `mq.bend.road` | Exists since today. Drop m1 q05. Title "Wake the Waystone" -> "Wake the Stone". Add rewards + `next`. |
| 5 | `mq.bend.road` (new) | The Stone at the Bend | burl.stone | Burl at the meadow stone (her farewell talk) | 1. Take the road west. 2. Find the dead stone at the Bend. 3. Wake it. | Rook, who lands next to the Bend stone when it wakes (new ground perch beside (1262, 1033), reachable, OB-147), gold `?` | 20 coin | `mq.bend.call` | Split from m1 q06 (road, relayFound, relay1). NEW: hand-in with `?` at the Bend (fixes OB-181). Rook is met here, not 270 m away (fixes OB-183). Burl stays at the meadow. |
| 6 | `mq.bend.call` | The Stone's Call | mq.bend.road | Rook at the Bend | 1. Watch the Bend stone blink. 2. Read the knot on its base. | Rook at the Bend, gold `?` | River Map (`chart.river`, existing) | `mq.river.road` | Giver moves from Rook at the ford to Rook at the Bend (objectives are at the Bend anyway). `requires` was `m1 step relay1` -> `mq.bend.road`. Title "The Call Carries" -> "The Stone's Call". |
| 7 | `mq.river.road` | The River Road | mq.bend.call | Rook at the Bend (then Rook flies to the ford) | 1. Follow the road to the river. 2. Cross the stepping stones. | Rook at the ford ruin (982, 1060), gold `?` | 2 Health Potions | `mq.ford.mirror` | Gets the old `mq.ford.stones` objective (`fordWest`) as step 2: one-step quests from the same giver on the same walk are merged. `mq.ford.stones` is retired (save migration). The hand-in line names the ford ("I'll wait for you at the ford") - NEEDS WRITER. Compass + `!`/`?` on Rook at the ford. |
| 8 | `mq.ford.mirror` | The Missing Glass | mq.river.road | Rook at the ford ruin | 1. Take the glass from Rook's nest. 2. Wake the Ford stone (992, 1079). | Rook at the ford ruin, gold `?` | 1 Heart Piece | `mq.smoke` | Today it has NO return: add `end` Rook + `?` + hand-in. `requires` simplified to `mq.river.road`. |
| 9 | `mq.smoke` | Smoke in the North | mq.ford.mirror | Rook at the ford ruin | 1. Look at the mark on the Ford stone. 2. Follow the footpath north. | Rook at the ford ruin, gold `?` (Rook flies north with you later; for now he waits at the ford) | 30 coin | `null` for now (first chapter-2 quest later; open: the return should move to a character at `northLook` once ch2 has one) | Add rewards + `next`. |

Quest count: **10** (m1 retires; 2 new ids `mq.wake`, `mq.bend.road`; `mq.ford.stones` merged into `mq.river.road`).
Side quest `sq.burl.blue` is not on the main chain; it must pass the same validator (blue marks) but is out of scope here.

`index.json` legacy order after the change: `mq.wake, tower.blade, burl.boars, burl.follow, burl.stone, mq.bend.road, mq.bend.call, mq.river.road, mq.ford.mirror, mq.smoke, sq.burl.blue`.

### NEEDS WRITER (writer agent, after the code lands)
- `mq.wake`: journal lines for "Get up" / "Read the note".
- Every quest: one hand-in line at the return character + one `nextHint` line naming where the next giver is (e.g. "Rook waits at the ford").
- Burl's farewell offer of `mq.bend.road` at the meadow stone.
- Rook landing at the Bend stone (first meeting) + his `?` hand-in for `mq.bend.road`.
- Rook's "I'll wait for you at the ford" for `mq.river.road`.
- Reworded objectives above are PO drafts; the writer may polish but must keep them short and plain.

## Build steps (each small, Node-testable)

1. **Validator rule** - `tools/content-lint-rules.js` + `tools/validate-content.mjs` (tests in `tools/content-lint.test.mjs`, `tools/validate-content.test.mjs`): fail a quest that is missing `begin` / `end` / non-empty `rewards`, has 0 or more than 3 objectives, has a `next` or `requires.quests` id that does not exist, has `sections`, or carries `tutorialStart` when another quest already does. Object givers need `objectGiver: true` and stay <= 10 % of givers (D-087). Fixtures for each failure.
2. **Migrate the quest files** - `content/quests/*.quest.json` + `index.json` to the format above: new `mq.wake.quest.json`, `mq.bend.road.quest.json`; delete `m1.quest.json` and `mq.ford.stones.quest.json`; rewards/next/end per the table. Save migration in `game/js/quest/sim/questSaveV2.js`: an old save at m1 step X marks the matching new quests done and offers the next one; `mq.ford.stones` progress maps onto `mq.river.road` step 2. Node test for the save map.
3. **Runtime reads the format** - `game/js/quest/sim/quest.js` / `questBook.js`: `begin` drives the `!`, `end` drives the `?`, hand-in grants `rewards` (toast) and opens the `next` offer at the same character (Accept E / Exit Q, never auto-start; `mq.wake` is the only auto start). Remove section/silent chaining.
4. **`game/js/quest/questFlowAll.test.js` (new)** - walks the whole chain headless from waking to `mq.smoke`: for each quest asserts `!` on the giver before accept, not tracked before accept, `?` on `end` only when all objectives are done, rewards granted at hand-in, `next` offered (not started). Zero exceptions except `mq.wake` (tutorialStart). Must be in `node tools/run-tests.mjs`.
5. **Pointer after every hand-in** - `game/js/quest/wire/questMarks.js` + compass/map mark: right after a hand-in the compass and map point at the next quest's giver and it shows `!`; journal shows "Next: <nextHint>". Assert it inside questFlowAll.test.js for all 9 hand-ins (incl. Bend -> ford for Rook).
6. **Rook's two perches** - `game/js/quest/rookPerch.js` + `content/worlds/world_m1.world.json` (new ground spot `rookBend` beside the Bend stone, reachable on foot): Rook stands at the Bend from the Bend stone waking until `mq.river.road` is accepted, then at the ford perch (982, 1060). Extend `rookPerch.test.js`.
7. **Journal lists separate quests** - `game/js/ui/questLog.js`: one row per quest (active / done), each with its own 1-3 objectives, no "Beyond the Wall" group; `tools/verify-quest-log.mjs` updated.
8. **Editor Quests tab** - `tools/editor/questPanel.js` + `tools/editor/quest/lintQuest.js`: shows and edits exactly id, title, begin, end, requires (quests + level), objectives (max 3), rewards, next; lint runs the same rule as step 1 (`tools/editor/quest/lintAgree.test.mjs` parity).

Then: writer pass (lines above), main-session headless route walk, owner walk-test.


## Owner corrections 2026-10-15
- "Wake Up" removed: no quest for waking. Quest 1 = Find a Blade, offered by the note on the wall (object giver, D-087); you read it when you get up.
- NO XP and no player level (D-020, D-0xx progression x): rewards are items, coin, Heart Pieces, gear tiers, spells. `requires` = prerequisite QUESTS only (zone level bands stay a world property, not a quest gate).
- So there is NO exception any more: every quest has a giver, Accept, `?`, hand-in, reward, next.

## Version 2 (owner review 2026-10-15: fights + gear, fewer stone activations, Rook as an event, narrative tension)
Rules unchanged: every quest = giver `!` + Accept E / Exit Q, 1-3 objectives, `?` at the return character, hand-in, a reward, the next quest offered (D-105, D-106). No XP (D-020). Requires = the previous quest.

| # | Quest | Begin | Objectives | End | Reward | Next |
|---|---|---|---|---|---|---|
| 1 | Find a Blade | the note on the tower wall | climb the tower; take the sword; leave by the door | Burl, outside the door | Health Potion | Boars in the Woods |
| 2 | Boars in the Woods | Burl | drive off 5 boars | Burl | leather armour | Follow the Bear |
| 3 | Follow the Bear | Burl | walk with Burl to the meadow stone (she TALKS on the way: what she saw fall from the sky, the forest changing; she STOPS AND WAITS for you, never makes you chase her; short walk); wolves ambush halfway - drive them off | Burl at the meadow stone | Heart Piece | Wake the Stone |
| 4 | Wake the Stone | Burl at the stone | wake the meadow stone (FIRST activation: new - it saves your progress, it is where you come back after a fall, and later you can travel between woken stones; shown by the stone, not a tutorial text) | Burl | 15 coin | The Stone at the Bend |
| 5 | The Stone at the Bend | Burl (her farewell: "follow the road west, there is another") | take the road west; drive the goblins off the Bend stone; wake it (SECOND activation: shows the network - the two stones link) | EVENT on waking: a bright pulse shoots into the sky, a black bird lands - Rook: "Well, that's unfortunate." / "What is?" / "You. You woke it." -> `?` over Rook | bow + arrows (Rook, grudgingly: "you'll need reach") | The River Road |
| 6 | The River Road | Rook at the Bend (suspicious: "Waking stones draws eyes. Walk with me, I'll watch you.") | follow the road to the river; cross the stepping stones - a crocodile waits in the ford | Rook at the ford ruin | 2 Health Potions | The Missing Glass |
| 7 | The Missing Glass | Rook at the ford | the Ford stone is BROKEN (cracked, its glass gone) - it cannot be woken the normal way; take the glass back from Rook's old nest (guarded: a black bear has moved in); set the glass in the stone (THIRD stone, but a repair, not an activation) | Rook | first spell (the repaired stone gives it) + Heart Piece | Smoke in the North |
| 8 | Smoke in the North | Rook (now trusts you a little: tells part of what he knows) | look at the mark on the Ford stone; follow the path north to the smoke - goblins are burning a farm, drive them off | Rook | shield | chapter 2 |

What changed from version 1:
- "The Stone's Call" (examine the stone) is gone: its blink + knot clue becomes part of the Rook event in quest 5 and Rook's lines. Stone activations: meadow (new), Bend (network), Ford (broken -> repair quest, not a plain activation).
- Fights: 6 of 8 quests have one (boars, wolves, goblins, crocodile, bear, goblins). Gear steps: armour -> bow -> spell -> shield, Heart Pieces at 3 and 7.
- Tension: Rook is suspicious and hints that waking stones is dangerous ("draws eyes"); trust grows over 5-8.
- Quest 3 is a character moment, short, Burl waits for you (burlEscort LEAD_WAIT_M / WAIT_BARK already exist - check the walk length and the wait behaviour).
- All new lines NEEDS WRITER (writer agent: Burl's walk talk, Rook's arrival + suspicion, the broken stone).
- Owner 2026-10-15 ("and missing the fight"): EVERY quest has a fight. Quest 1: goblin scavengers are picking through the wreck at the tower top (first fight with the new sword). Quest 4: waking the stone draws a boar pack out of the trees; hold them off while the stone charges (~20 s), then it wakes. => 8/8 quests with a fight.
