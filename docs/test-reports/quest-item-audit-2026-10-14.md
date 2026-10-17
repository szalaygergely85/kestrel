# Quest / item / marker audit (OB-155, OB-156) - 2026-10-14

PC-A audit, branch `pc-a` at 4f38f67b (merge of the PC-B 2026-10-13/14 work). This was a report-only pass: no code, content or design files were changed. The checks ran in Node: content-lint, quest-sim, reach-check, prop-ground-lint, and scratch probes that load world_m1 with mesh physics, the fine terrain band and raycasts down through the mesh colliders. No browser pass was needed.

## Summary

- **Why the owner still sees floating items while R1 = 0:** R1 only checks world *structures*. It skips all 139 placed *entities* (pickups, chests, lamps, NPCs, inspect anchors). Its tree regex `/Tree/` does not match `Pine_*`, and it does not check legacy quests. The probe found these cases:
  - 20 pines float by 0.26 to 0.80 m.
  - The heart-piece chest `chestCrossroads` floats by 0.2 to 0.8 m over a stair mesh.
  - Leftover item drops hover 0.15 m and bob, by design: the view reuses the potion-orb hover for voxel gear.
  - A save restores the old content. Continue/Load takes entity transforms and components, and the whole structure list, from the save. Roof items, sprites and removed floating props come back for any save made before the fixes.
- **Wrong signs and markers:**
  - The `!`/`?` hangs at a fixed z + 1.55 m. Since D-080, the 13 waystones are 2.6 m tall, so their marker sits *inside* the stone. This covers 22 side quests plus the main-chain `?` at relayBend.
  - Two quest anchors lost their visible post when OB-143 removed the floating supports (`notePost`, `knot`). `pierStone` never had a mesh. Their prompts and markers float over empty grass.
  - The main chain uses `?` as a "go here" waypoint before anything is done. Burl's gold `!` for the road step never goes away when you talk to him.
  - Gold and blue markers stack on the same NPC.
- **Quest flow against the owner rule (OB-156 / D-082):** 82 giver quests in total.
  - 31 quests follow the rule: character giver, generated Accept / Not yet, `?` at a character after all objectives. They still have the marker-overlap issue in OB-155j.
  - 41 quests are given by an object or a waystone. `E` accepts at once, with no Accept/Exit.
  - 4 main quests auto-accept at the end of a talk. 3 of those auto hand-in, so there is no `?` and no return talk.
  - 5 quests start with no giver: no `!`, no `?`, no return.
  - `tower.blade` (take the sword, leave the tower) is main story but shows **blue**.
  - Object hand-in can be hijacked or blocked by another quest of the same object. Simulated: `sq.packet` cannot be handed in at the post while `sq.fc.stores` is active.
- **Counts:**
  - A floating/visibility: 7 findings.
  - B quest flow: 7.
  - C markers: 3.
  - D lint/other: 2.
  - By severity: 4 blockers, 11 major, 4 minor.

Owner workaround for the save issue (OB-155g): content fixes only show in a **New Game**. A Continue/Load keeps the old positions and models.

## Commands / evidence used

- `node tools/content-lint.mjs`: 135 findings (R1=0 R2=23 R5=0 R9=63 R10=48). R10 only covers pack quests (content-lint.mjs:192 `const quests = packs.quests...`).
- `node tools/quest-sim.mjs`: 83 quests, 83 OK. Every reward resolves.
- `node tools/reach-check.mjs`: 62 quest points, 0 outside the walk bounds.
- `lintWorld('world_m1', true)` (prop-ground-lint, every mesh): 20 `Pine_*` with float > 0.25 m, which floatingProps filters out (probe-floating-props.mjs:14).
- Scratch probes (session scratchpad, not committed):
  - `audit-ents.mjs`: every entity's base z vs terrain groundAt, level floor and the highest mesh-collider surface; voxel model bottom/top.
  - `anchors.mjs`: visible meshes within 3.5 m of each giver anchor.
  - `quests.mjs`: quest table.
  - `marks.mjs`: book.giverMarks/chainMarks through Ch1-2.
  - `inspect.mjs`: object hand-in order.
  - `water.mjs`: under-water quest objects.

## Findings

Each finding lists: proposed id, severity, evidence, root cause, a one-line fix and the track. "Story" groups findings into fix items of 1 day or less (see the end of this report).

### A. Floating, sunk and invisible objects

**1. OB-155a: 20 placed pines float by 0.26 to 0.80 m. Major. PC-B content/tools. Story S1.**
- **Evidence:** prop-ground-lint `lintWorld(all)` lowest vertex vs groundAt.
  - roadF075 Pine_5 (1021.1, 1086.9) floats 0.80 m: origin z -87.51, ground -88.77, mesh z0 -0.24 x 1.02.
  - roadW065 0.39, roadW063 0.38, roadW053 0.36, roadL101 0.35, roadW006 0.34, roadF065 0.32 (the red-cap tree of cap1).
  - Also roadN087, roadW047, roadW062, roadL192, roadL268 and others (Pine_1..5_LOD1).
- **Root cause:** the tree class is `/Tree/` everywhere:
  - tools/editor/meshPlace.js `meshClass` returns 'other' for `Pine_*`.
  - content-lint.mjs:170 R1 tree loop.
  - probe-floating.mjs:70 and floatingTrees.test.mjs:40.
  - probe-floating-props.mjs:14 excludes `Tree|Pine` from the prop check.
  - So the OB-131 re-ground (`resnap-rocks --trees`) and R1 never touched pines.
- **Fix:** treat `/Tree|Pine/` as tree in meshClass + R1 + the probes, then rerun `resnap-rocks --trees`.

**2. OB-155b: the heart-piece chest `chestCrossroads` floats over its platform. Major. PC-B content. Story S1.**
- **Evidence:**
  - Entity at (986.2, 1094.6, z -84.96), authored as a number (world_m1.world.json:2063).
  - The support under its footprint is the sloped stair mesh poi104 `Stairs_Exterior_Straight`. Sampled surface: -85.16 to -85.76. Terrain -85.8.
  - So the chest base floats 0.2 to 0.8 m. The note says it sits "on a 1 m stair-block platform".
- **Root cause:** a numeric z was authored over a stair mesh, not a flat block, and no rule checks entities.
- **Fix:** add a flat block, or set z to the support top. Keep it reachable (R5/reach-check).

**3. OB-155c: R1 cannot see the floats the owner reports. Major. PC-B tools. Story S2.**
- **Evidence / root cause:**
  1. R1 = `floatingProps()` (structures only) + `/Tree/` structures. **No world entity is checked**: 139 placed entities, including 22 quest pickups, 8 chests + 7 secret chests, 20 light entities (waystones + lamps), NPCs and inspect anchors.
  2. `Pine_*` and `Wall_*` are excluded (finding 1).
  3. `supportBoxes` accepts any placed-mesh AABB as support. That is coarse but not wrong.
  4. Runtime drops (finding 6) and saved worlds (finding 7) are outside any lint.
- **Fix:** add the two rules below to content-lint. A tiny allow-list is needed for the tower wall lanterns and notes, which are wall-mounted on purpose: tower.lantern/keeperLamp/stairLamp/swordLamp at +1.1 to 1.45 m, notes at +0.25 to 0.8 m.
  - **R12 entity-support:** for every world entity and level prop, base = z + voxel bottom x scale. Support = max(terrain groundAt in the fine band, level floorAt, highest mesh-collider surface under 5 footprint samples). Error when base - support > 0.15 m, or when a floor surface lies 0.1 to 0.9 m above the base (buried). The scratch probe `audit-ents.mjs` already does this in about 15 s.
  - **R13 anchor-visible:** every inspect/quest anchor without a model needs a visible mesh or voxel within 1 m (catches finding 4).

**4. OB-155d: three quest anchors are invisible (no post or stone), so their prompt and marker float over grass. Major. PC-B content + designer. Story S1.**
- **Evidence:** `anchors.mjs` found no mesh within 3.5 m.
  - `notePost` (966, 1086): giver of sq.straw and sq.fc.shrine, return of sq.post.spare, target of sq.burl.ask.
  - `knot` (1264.2, 1031.6): main objective lore.knot.read of mq.bend.call.
  - `pierStone` (978, 1050): giver of sq.hw.piers and sq.ow.ford.
- **Root cause:**
  - Commit 7c93314d (OB-143 `probe-floating-props --remove`) deleted every non-strand Prop_Support "and the marker-post planks nailed to them": poi115/poi116 at notePost and poi117/poi118 at knot. It also removed poi010/poi011 at (990, 1060.5) next to the trade post (please check whether that was the post sign of sq.fc.sign "The West Arm").
  - `pierStone` was moved by QL-21 from (1045, 1320) as an anchor only (tools/gen-outwall.mjs:172). It never had a mesh.
- **Fix:** the designer gives each anchor a grounded voxel or mesh post (note post, knotted marker post, standing stone), with no Prop_Support. Check with R13.

**5. OB-155e: the gondola quest anchor is off the wreck, and the wreck is still a sprite. Minor. PC-B content. Story S1.**
- **Evidence:**
  - Entity `gondola` (1496, 1024, 0) is the giver of sq.wreck.plate. The visible wreck `tower.gondola` (a sprite, R2) is at (1495.4, 1026.7), 2.8 m away, so the blue `!` hangs beside the wreck.
  - R2: 23 tower props are still `components.sprite` (OB-132 only converted world_m1).
- **Fix:** move the anchor onto the gondola (or resolve the marker to `tower.gondola`). Voxelize the 23 tower sprites as the OB-132 follow-up.

**6. OB-155f: leftover item drops float and bob. Major. PC-B quest code. Story S4.**
- **Evidence:**
  - game/js/quest/pickupsView.js:55 sets `t.z = p.baseZ + def.hoverM + bob`, with `def = pickupStyle.mp` or `.hp` for every other kind, including `'item'`. Values: hoverM 0.15, bob ±0.04 m (design/models/m3_props.js:656).
  - The OB-132 voxel gear and potion models are designed to lie on the ground ("gear flat on the ground"), so they now hover 11 to 19 cm.
  - `spawnLeftoverDrop` (pickups.js:120) puts ring offsets 0.6 m around the player but keeps the player's z, so on a slope the item floats or sinks.
- **Fix:** no hover/bob for kind 'item' (keep it for hp/mp orbs), and take baseZ from `groundAt`/supportAt at the ring point.

**7. OB-155g: Continue/Load brings back old content positions, models and structures. Blocker. PC-A engine (serialize) + PC-B save. Story S6.**
- **Evidence:** engine/world/serialize.js.
  - :202 a saved entity that is still content keeps its *saved* transform and components.
  - :194 `structures: state.structures.map(...)`: the whole structure list comes from the save.
  - World.js:861 only `ed.z === 'ground'` entities are re-snapped; restored ones have a numeric z.
- **Consequence:** in a save made before tonight's merge, these fixes do not appear:
  - OB-147 (Rook off the roof) and OB-152 (nest, chestBoots, chestRook off the roof).
  - OB-132 (sprites to voxel: the old `components.sprite` comes back).
  - OB-129, OB-131 and OB-143 (removed floating supports, chimney, re-grounded trees come back).
  - This matches "items in the air / on the roof / everything".
- **Fix:** for content-owned entities and structures, take position and model from current content unless the sim moved them (dynamic/body/opened/removed state). Bump the save version so old saves migrate.

### B. Quest flow against the owner rule (table at the end)

**8. OB-155k: main/side colour is wrong for main-story quests. Major. PC-B quest code + data. Story S3.**
- **Evidence:**
  - questBook.js:300: `isMain = def.main === true || m1 waits on quest.<id>.done`.
  - `tower.blade` (note -> take the sword -> leave the tower -> Burl, the prerequisite of burl.boars) has no `main` and is not an m1 flag. So the very first quest shows a **blue** `!` on the note and a **blue** `?` on Burl (marks.mjs: "left tower: blue? bear").
  - `mq.river.road` and `mq.ford.stones` (prerequisites of the main mq.ford.mirror) are side quests.
- **Fix:** `main: true` in the data for these 3 quests, or make isMain transitive (any quest a main quest requires).

**9. OB-155l: 41 of 82 quests are given and accepted by objects or waystones, with no Accept/Exit. Blocker (D-082 / OB-156 rule 1+2). PO + writer + PC-B content. Stories S5a-c.**
- **Evidence:** table at the end, accept column "E/touch accepts at once".
  - questBook.js:279 `book.inspect` accepts the first AVAILABLE quest on E.
  - Waystones: errands.js:133 (OB-126) the 1st touch shows a banner, the 2nd touch accepts. There is no Exit, and `offered` resets every session.
  - The givers:
    - waystones: relayBend 6, relayFord 6, 10 region relays;
    - `owBoard`: 9 quests, including main mq.ow.board;
    - `post` 3, `notePost` 2, `pierStone` 2;
    - `gondola`, `packet`, `noteKeepLight` (tower.blade).
  - 41 returns go to objects or waystones: 18 inspect anchors, 22 waystones, owForge.
- **Fix (per area, one story each):**
  - S5a Ch1-2: a post-keeper / ferry NPC at the trade post takes post, notePost, packet and relayFord/relayBend errands. Burl takes tower.blade's hand-out after the note.
  - S5b Outwall: Hesk or a board-keeper takes the owBoard and pierStone quests.
  - S5c regions: one NPC per waystone. Objects become objective targets only.

**10. OB-155m: 4 main quests auto-accept at the end of a talk, and 3 auto hand-in. Major. PC-B content + quest code. Story S5a.**
- **Evidence:**
  - rook.dialogue.json and hesk.dialogue.json put `setFlag "s.<id>.accept"` on an `end` node, not a choice: mq.bend.call, mq.ford.mirror, mq.ow.names, mq.ow.relay. The snippet generator skips main quests (questSnippets.js:66 `d.main`).
  - errands.js:54 `MQ_AUTO = {mq.ford.mirror, mq.ow.names, mq.ow.relay}` hands in as soon as READY. No `?` appears, there is no return talk, and the reward pops anywhere.
- **Fix:** an Accept / Not yet choice in those offer nodes, plus a hand-in node at the giver. Remove MQ_AUTO.

**11. OB-155n: 5 quests have no giver at all (auto-start). Major. PO + writer. Story S5a/b.**
- **Evidence:** `giver` is undefined (QL-T1 giverless) for mq.smoke, mq.ow.path, mq.ow.fence (main) and mq.river.road, mq.ford.stones. They start silently when `requires` are met. They get no `!`, no Accept/Exit, no `?` and no return. This is also the OB-126 "quest in the journal I didn't pick up" pattern.
- **Fix:** give each one a character (Rook for river/ford/smoke, Hesk for the Outwall path/fence), or turn them into m1 chain steps with a talk start.

**12. OB-155o: object hand-in is hijacked or blocked by another quest of the same object. Blocker. PC-B quest code. Story S4.**
- **Evidence:** questBook.js:279-293 `inspect()`:
  - It first accepts any AVAILABLE quest the object gives.
  - Then it returns `refuse` on the *first* ACTIVE quest with that turnIn, before it looks at READY ones.
  - Simulated (`inspect.mjs`):
    - sq.packet READY + sq.fc.stores AVAILABLE, E on `post` gives `accept sq.fc.stores`.
    - Second E gives `refuse sq.fc.stores`.
    - sq.packet cannot be handed in until the boars of sq.fc.stores are dead.
  - The same pattern exists at owBoard (9 quests), relayBend/relayFord (give + receive) and relay_downs.
- **Fix:** hand in READY quests first, skip ACTIVE ones that are not this hand-in, and accept only through an explicit offer (the Accept/Exit card of finding 9).

**13. OB-155p: quest objects that are "taken" stay in the world or in the pack. Minor. PC-B quest code/content. Story S4.**
- **Evidence:**
  - sq.packet: E on the `packet` voxel accepts and `giveOnAccept` puts a packet in the pack. The packet model stays on the ground (no questPickup, no remove; there is no `packet` handling in game/js).
  - `requireItem` quests keep the item after hand-in (questBook.js handIn, `requireItem` is only checked): sq.fc.sign keeps `signArm` ("You lay the arm in the basket") and sq.wreck.plate keeps `boar.hide`.
- **Fix:** make the packet a questPickup (pickup = accept), and add `consumeItem` for requireItem hand-ins.

**14. OB-155q: generated hand-in lines show raw item ids. Minor. PC-B quest code. Story S4.**
- **Evidence:** questSnippets.js:30 builds `{reward}` from `i.id`. 4 quests have no writer `ready` lines and say e.g. "Take this: potion.hp, 15 arrow": sq.ow.night, sq.ow.letters, sq.ow.song, sq.ow.news. R3 does not lint generated text.
- **Fix:** use the item def `name` in slotValues, and add a test.

### C. Signs, markers and return-point positions

**15. OB-155h: markers are buried inside waystones and cut through the Outwall board. Blocker. PC-B quest code. Story S3.**
- **Evidence:**
  - main.js:547 `MARK_TOP = {endMarker: 3.0, bear: 1.1, noteKeepLight: 0.14}`. Every other id uses the default **1.55** (main.js:566). The glyph spans base + 0.35 to + 1.12 (quest_mark.js:17), so 1.90 to 2.67 m above the entity.
  - Since D-080 (e171f54d) all 13 relays use the `waystone` model, top **2.625 m** (audit-ents). The glyph sits inside the stone for:
    - the blue `!` of 22 waystone errands;
    - the gold `?` of m1 steps relayFound/relay1 at relayBend;
    - the returns at relayFord, relayBend and relay_downs.
  - `owBoard`: the board is `ow191` Door_1_Flat x1.15, top 2.45 m, so the glyph cuts through its top.
  - `rook` (crow x1.6, top 0.38 m on the crate): the glyph floats 1.5 m above the bird.
- **Root cause:** the marker height comes from a per-id table, not from the model.
- **Fix:** marker base = entity z + model top (voxel bbox top x scale; for an anchor, the highest mesh under it) + 0.1. Delete MARK_TOP/MARK_DY special cases, except the wall note.

**16. OB-155i: `?` is used as a waypoint before the step is done, and the chain `!` never clears. Major. PC-B quest code + data. Story S3.**
- **Evidence:**
  - questBook.js:315 `chainMarks`: if the current m1 step has `mark.start`, a gold `!` shows for the whole step. Otherwise a gold `?` shows at `mark.end` *as soon as the step starts*.
  - m1.quest.json marks: leave `end doorMarker`, waystone `end endMarker`, road `start bear, end relayBend`, relayFound and relay1 `end relayBend`.
  - marks.mjs: "sword taken: gold? doorMarker", "burl arrived: gold? endMarker", "road west: gold? relayBend". There is nothing to return at these points (rule 3).
  - The gold `!` on Burl (road) stays until the area roadWest is entered, even after the talk (rule 4).
- **Fix:** chain steps follow the giver rule: a talk-accept clears `!`, and `?` only at a hand-in character when complete. Waypoints go on the compass or HUD, not as `?`.

**17. OB-155j: gold and blue, and `!` and `?`, stack on the same NPC. Major. PC-B quest code. Story S3.**
- **Evidence:** main.js:572 registers 4 independent wires (gold `!`, gold `?`, blue `!`, blue `?`). Each dedupes only inside itself (questMarks.js `rec` per id), so one giver can carry up to 4 overlapping glyphs at the same xyz. marks.mjs:
  - "waystone woken": gold `!` bear (chain) + blue `!` bear (8 side quests).
  - "ford west": gold `!` rook + blue `!` rook (5).
  - After a side quest turns READY at Burl while others are available: blue `?` + blue `!`.
- **Fix:** one marker per entity with priority gold `?` > blue `?` > gold `!` > blue `!` (a return beats an offer).

### D. Lint coverage and other

**18. OB-155r: content-lint skips the 10 legacy quests and every giverless quest. Major. PC-B tools. Story S2.**
- **Evidence:** content-lint.mjs:192 `const quests = packs.quests.map(...)` loads packs only. m1, tower.blade, burl.boars, sq.burl.blue and mq.* (index.json `legacy`) are never checked by R3, R5, R9 or R10. R10 only flags `giver.npc`, so it misses giverless quests, chain marks, MQ_AUTO and hand-written auto-accepts.
- **Fix:** load legacy files like quest-sim does (`loadQuestFiles`). Add **R14 quest-flow:** every quest needs a character giver, an Accept/Exit choice, a character return and no auto hand-in. Check generated snippet text with R3.

**19. OB-155s: risk of markers or items popping out at busy spots (voxel instance cap). Minor. PC-A engine. Story S6 (check only).**
- **Evidence:** engine/voxel/VoxelModel.js:17 sets `MAX_VOX_INSTANCES = 16` (DDA path) and `_MESH = 48`; the nearest ones win. Quest markers are voxel props too. Content alone has 25-26 voxel entities within 80 m of the trade post, the Rook ruin and the tower, before runtime beasts/fauna and up to 4 marker entities per giver. OB-132's commit already flagged "NEEDS ENGINE: VoxelPool nearest-16 limit".
- **Fix:** confirm which cap the owner's preset uses. Give markers and quest objects priority in the selection.

**Info, not a bug:** `chestBed` (1240, 505) is 17.8 m under the Glasswater surface. This is intended (SWIM-04d dive chest, `needsBottom`). The PO should confirm that 17.8 m is a fair dive.

## Fix stories (each 1 day or less)

| Story | Track | Findings | Content |
|---|---|---|---|
| S1 | PC-B content + designer | a, b, d, e | re-ground pines, fix the crossroads chest, visible posts/stone at notePost, knot, pierStone (+ check poi010), gondola anchor; tower sprites to voxel as a separate OB-132 follow-up |
| S2 | PC-B tools | c, r | content-lint R12 entity-support, R13 anchor-visible, R14 quest-flow, legacy quests + generated text in R3/R10 |
| S3 | PC-B quest code | h, i, j, k | marker height from the model, single marker per entity with priority, chain marks follow the rule, main flag/isMain fix |
| S4 | PC-B quest code | f, o, p, q | drop hover/ground z, inspect hand-in order, packet as questPickup + consume requireItem, reward names in snippets |
| S5a | PO + writer + PC-B | l, m, n (Ch1-2) | trade-post NPC takes post/notePost/packet/relayBend/relayFord errands; Rook main quests get Accept/Exit + hand-in; mq.river.road/ford.stones/smoke get a giver |
| S5b | PO + writer + PC-B | l, n (Outwall) | owBoard/pierStone quests to Hesk/Dorrin or a board-keeper; mq.ow.path/fence get a giver; Hesk accept/exit + hand-in |
| S5c | PO + writer + PC-B | l (regions) | one NPC per region waystone for the 10 sq.reg.* errands |
| S6 | PC-A engine | g, s | content wins over the save for content-owned entities/structures (+ save version), voxel cap priority check |

## Quest table (82 giver quests; m1 chain marks in OB-155i)

Columns:
- **accept step:** what the game does on talk or E.
- **`!` colour shown:** what book.isMain picks.
- **`?` appears:** when book.giverMarks shows it. READY means all objectives are done, which is correct for giver quests.
- **Picked-up objects:** quest pickups are removed on pickup (questPickups.js, world.remove; they stay taken across saves). The exception is the packet (OB-155p).
- **`!` after accept:** removed for every giver quest (status leaves AVAILABLE). The `?` is removed after hand-in.
- **Deviation codes:**
  - D-082: giver or return is not a character.
  - NO-ACCEPT/EXIT: the quest is accepted without an Accept/Exit choice.
  - NO-GIVER: auto-start, no giver.
  - NO-RETURN: auto hand-in, no return talk.
  - COL: wrong marker colour.
  - BURIED: the marker sits inside the waystone.
  - INVISIBLE: the anchor has no visible model.
  - HAND-IN hijack: see OB-155o.
- **Rows marked OK** still have the overlap issue in OB-155j.

| quest | main/side | giver (kind) | accept step | `!` colour shown | `?` appears | return point (kind) | deviations |
|---|---|---|---|---|---|---|---|
| burl.boars | main | bear (char) | Accept/Exit choice | gold | all objectives done | bear (char) | OK |
| mq.bend.call | main | rook (char) | AUTO-accept at end of talk (no choice) | gold | all objectives done | rook (char) | NO-ACCEPT/EXIT (auto-accept) |
| mq.ford.mirror | main | rook (char) | AUTO-accept at end of talk (no choice) | gold | never (auto hand-in, MQ_AUTO) | rook (char) | NO-ACCEPT/EXIT (auto-accept); NO-RETURN |
| mq.ford.stones | side | - | none (auto-start) | none | never | - | COL (main story, shown none); NO-GIVER (auto-start: no ! / accept / ? / return) |
| mq.river.road | side | - | none (auto-start) | none | never | - | COL (main story, shown none); NO-GIVER (auto-start: no ! / accept / ? / return) |
| mq.smoke | main | - | none (auto-start) | none | never | - | NO-GIVER (auto-start: no ! / accept / ? / return) |
| sq.burl.blue | side | bear (char) | Accept/Exit choice | blue | all objectives done | bear (char) | OK |
| tower.blade | side | noteKeepLight (object) | E/touch accepts at once | blue | all objectives done | bear (char) | COL (main story, shown blue); D-082 giver is object; NO-ACCEPT/EXIT |
| sq.tm.nub | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.boars.n | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.boars.w | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.boars.s | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.meat | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.stone | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.hint | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.tower | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.scout | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.ask | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | target notePost is an INVISIBLE anchor |
| sq.burl.walk | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.burl.parcel | side | bear (char) | generated Accept/Not yet | blue | all objectives done | post (object(inspect)) | D-082 return is object(inspect); HAND-IN can be hijacked (OB-155o) |
| sq.post.spare | side | post (object(inspect)) | E/touch accepts at once | blue | all objectives done | notePost (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; INVISIBLE anchor; HAND-IN can be hijacked (OB-155o) |
| sq.straw | side | notePost (object(inspect)) | E/touch accepts at once | blue | all objectives done | notePost (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; INVISIBLE anchor; HAND-IN can be hijacked (OB-155o) |
| sq.rb.shield | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.rb.regards | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayBend (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.rb.road | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayBend (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.ford | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.smoke | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.cross | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.again | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.tm.gap | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.tm.wood | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.tm.cart | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.rb.lamps | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayBend (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.rb.rocks | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayBend (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.rb.parcel | side | relayBend (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.he.wallow | side | rook (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.he.farm | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.dw.bees | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.dw.stones | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.fc.stores | side | post (object(inspect)) | E/touch accepts at once | blue | all objectives done | post (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; HAND-IN can be hijacked (OB-155o) |
| sq.fc.caps | side | rook (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.fc.well | side | rook (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.fc.shrine | side | notePost (object(inspect)) | E/touch accepts at once | blue | all objectives done | notePost (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; INVISIBLE anchor; HAND-IN can be hijacked (OB-155o) |
| sq.fc.jetty | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayFord (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.cog | side | relayFord (waystone) | E/touch accepts at once | blue | all objectives done | relayBend (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.fc.ask | side | rook (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.rook.gift | side | rook (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| sq.wreck.plate | side | gondola (object(inspect)) | E/touch accepts at once | blue | all objectives done | gondola (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker 2.8 m off the wreck |
| sq.honey | side | bear (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.rook.shiny | side | rook (char) | generated Accept/Not yet | blue | all objectives done | rook (char) | OK |
| sq.packet | side | packet (object) | E/touch accepts at once | blue | all objectives done | post (object(inspect)) | D-082 giver is object; D-082 return is object(inspect); NO-ACCEPT/EXIT; HAND-IN can be hijacked (OB-155o); packet stays in world after accept |
| sq.burl.fire | side | bear (char) | generated Accept/Not yet | blue | all objectives done | bear (char) | OK |
| mq.ow.path | main | - | none (auto-start) | none | never | - | NO-GIVER (auto-start: no ! / accept / ? / return) |
| mq.ow.fence | main | - | none (auto-start) | none | never | - | NO-GIVER (auto-start: no ! / accept / ? / return) |
| mq.ow.names | main | hesk (char) | AUTO-accept at end of talk (no choice) | gold | never (auto hand-in, MQ_AUTO) | hesk (char) | NO-ACCEPT/EXIT (auto-accept); NO-RETURN |
| mq.ow.relay | main | hesk (char) | AUTO-accept at end of talk (no choice) | gold | never (auto hand-in, MQ_AUTO) | hesk (char) | NO-ACCEPT/EXIT (auto-accept); NO-RETURN |
| mq.ow.board | main | owBoard (object(inspect)) | E/touch accepts at once | gold | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.hw.piers | side | pierStone (object(inspect)) | E/touch accepts at once | blue | all objectives done | pierStone (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; INVISIBLE anchor |
| sq.fc.sign | side | post (object(inspect)) | E/touch accepts at once | blue | all objectives done | post (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; HAND-IN can be hijacked (OB-155o) |
| sq.ow.wolves | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.boars | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.parcel | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owForge (object) | D-082 giver is object(inspect); D-082 return is object; NO-ACCEPT/EXIT; marker cuts through board |
| sq.ow.ford | side | pierStone (object(inspect)) | E/touch accepts at once | blue | all objectives done | pierStone (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; INVISIBLE anchor |
| sq.ow.barley | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.range | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.raid | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.night | side | hesk (char) | generated Accept/Not yet | blue | all objectives done | hesk (char) | OK |
| sq.ow.bears | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.letters | side | hesk (char) | generated Accept/Not yet | blue | all objectives done | dorrin (char) | OK |
| sq.ow.song | side | hesk (char) | generated Accept/Not yet | blue | all objectives done | hesk (char) | OK |
| sq.ow.trail | side | owBoard (object(inspect)) | E/touch accepts at once | blue | all objectives done | owBoard (object(inspect)) | D-082 giver is object(inspect); D-082 return is object(inspect); NO-ACCEPT/EXIT; marker cuts through board; HAND-IN can be hijacked (OB-155o) |
| sq.ow.news | side | dorrin (char) | generated Accept/Not yet | blue | all objectives done | dorrin (char) | OK |
| sq.reg.glasswater | side | relay_glasswater (waystone) | E/touch accepts at once | blue | all objectives done | relay_glasswater (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.northwood | side | relay_northwood (waystone) | E/touch accepts at once | blue | all objectives done | relay_northwood (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.highPastures | side | relay_highPastures (waystone) | E/touch accepts at once | blue | all objectives done | relay_highPastures (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.ashMile | side | relay_ashMile (waystone) | E/touch accepts at once | blue | all objectives done | relay_ashMile (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.downs | side | relay_downs (waystone) | E/touch accepts at once | blue | all objectives done | relay_downs (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.reg.signalHill | side | relay_signalHill (waystone) | E/touch accepts at once | blue | all objectives done | relay_signalHill (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.heath | side | relay_heath (waystone) | E/touch accepts at once | blue | all objectives done | relay_heath (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.reedmire | side | relay_reedmire (waystone) | E/touch accepts at once | blue | all objectives done | relay_reedmire (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
| sq.reg.strand | side | relay_strand (waystone) | E/touch accepts at once | blue | all objectives done | relay_downs (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone); HAND-IN can be hijacked (OB-155o) |
| sq.reg.whitecombs | side | relay_whitecombs (waystone) | E/touch accepts at once | blue | all objectives done | relay_whitecombs (waystone) | D-082 giver is waystone; D-082 return is waystone; NO-ACCEPT/EXIT; BURIED marker (inside waystone) |
