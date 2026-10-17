# Quest depth proposal (OB-225, PO opus, 2026-10-17)

Status: PROPOSAL for owner approval. No content has been changed. Source: `docs/quest-objectives.md` (89 quests),
`content/quests/ch12/pack.json`, `content/quests/regions/pack.json`, `content/logic/farm.logic.json`, D-082/087/098/105/106/108.

Every reworked quest keeps the owner rule (OB-156 / D-106 / D-108): a character giver with a `!` (gold main, blue side),
Accept / Exit, 1-3 short objectives, a `?` + hand-in at a character, a reward every time, and the hand-in offers the next
quest. Journal lines stay <= 38 chars, names stay plain, and the world uses existing meshes and kinds only.

## 1. Diagnosis (why the quests feel boring)

1. 31 of the 70 side quests are one `explore` step: walk into a circle, nothing happens, walk back. The "find" lives only in the hand-in text ("eleven holes", "plates for three").
2. Things the game already has are not used by quests. The farm ambush is wired, but the quest says "Look at the gate". The dry-well inspect gives the Freeze book, but the quest says "look". River Boots sit in a chest that no quest points to.
3. The bounties are copies of each other: 9 of the 10 warden quests are "Drive off N boars/wolves/bears", with no place, twist or story.
4. Nothing is at stake and nothing changes. No fight starts, no door opens, nobody is saved, and nothing stays different afterwards. The reward is mostly 5-10 arrows, so it feels like a chore.
5. Some quests repeat each other and fill the journal with chores: crossroads x3, ford crossing x4, Burl "go look at X" x8.

## 2. Rework of the 20 weakest side quests

Mechanics key: **INS** = inspect text sets the `talk.<id>` flag (errands.inspected). **AMB** = logic block `area.enter`/`flag.set` ->
`beasts.spawn` reserve group (the farm.logic.json pattern). **KILL** = kill by ids. **CHEST** = chest anchor + CHEST_TABLES row; opening sets
the chest flag. **ESC** = escort template. **PROP** = `prop.state` open/closed variants (Door_1_Round, as in D-103). **PICK** = item pickup + item-get card.
Merges are marked with **MERGE** / **CUT**.

| id (title) | New hook (why the giver cares) | Objectives -> what happens | Payoff / reward | Mechanics | Content needed (existing assets only) | Eff |
|---|---|---|---|---|---|---|
| sq.burl.tower "Look at the Tower Door" -> **"Scratches at the Door"** | Burl: something claws the door at night. Her cub sleeps near it. | 1 Read the claw marks (low, fresh, two sizes) -> 2 foxes burst from the tower ground floor. 2 Drive off the two foxes. 3 Pick up what they dragged out: a dented brass lamp hood from the *Kestrel*. | Burl: "Foxes. Rude, but small." 2 brass scraps + 10 arrows. The lamp hood is a story beat (Wick's own ship). | INS, AMB, KILL, PICK | inspect `inspect.towerScratch` on the existing door; reserve group `tower.foxes` (2 `fox`, tier 1); logic block; pickup `brass.scrap` at the door; 4 lines | S |
| sq.tm.cart "The Cart on the Road" -> **"The Tipped Cart"** | Burl smells honey and fear on a cart. Someone left in a hurry and might still be hurt. | 1 Search the tipped cart (existing `inspect.wagon`). 2 Drive off the cart robbers: 2 `bandit_cutthroat` come out of the verge grass (AMB on the inspect flag). 3 Open the strongbox under the cart. | Strongbox: honeycomb + 10 arrows + a worn gear roll. Burl gets the honeycomb, which feeds "Honey for a Crow". | INS, AMB, KILL, CHEST | group `cart.bandits` (2, tier 1); chest anchor `chestCart` (existing chest mesh) + table; logic block | M |
| sq.rb.rocks "Rocks at the Forest Edge" -> **"The Cairn Marks"** | Joss: someone stacks way-marks by his road, and he wants to know who walks it. | 1 Read the first cairn ("three stones = three hundred paces, west"). 2 Follow the cairns to the last one, where a `lynx` waits on the rock (ambusher, "near" aggro). 3 Open the cache under the last cairn. | Cache: 12 arrows + a sturdy gear roll. Joss: "Trimmers' marks. Your kind came this way." (Maren hint, writer to confirm.) | INS, KILL, CHEST | 3 existing rock placements tagged inspect (`note.cairn1..3`); 1 `lynx` placement; `chestCairn` + table | S |
| sq.fc.well "The Dry Well" -> **"The Cold Well"** | Rook: cold air comes up out of the well, and she won't go near it. | 1 Look into the dry well (existing `rsInspectWell`; the first look already gives the Freeze book). 2 Read the Freeze book (`item.got book.spell.freeze` -> flag). | The Freeze spell (already wired) + 1 mana potion. The quest finally points at a spell the player could walk past. | INS, PICK, flag | quest data + 3 lines only (spellBooks.js already places the book) | S |
| sq.fc.shrine "The Fallen Shrine" -> **"Who Pushed the Shrine"** | Bram: the shrine fell west, against the wind. Somebody pushed it. | 1 Read the shrine stone (existing `inspect.shrine`, new line: "pushed from below"). 2 Two `skeleton_warrior` rise from the grave earth behind it (AMB). Defeat them. | Bram: "Below. Like the crypt." A gear roll (`gear.t2`) + the hand-in offers "The Sealed Crypt" line hint (no new quest). | INS, AMB, KILL | reserve group `shrine.bones` (2 skeletons, tier 1); logic block; 1 inspect line | M |
| sq.burl.stone "Check on the Stone" + sq.burl.hint "The Hill Path" -> **MERGE "The Humming Stone"** | Burl: the stone hums since you woke it, and a walker sat by it once, long ago. | 1 Put your hand on the waystone (touch flag). 2 Read the knot tied at its foot (inspect: a skyworks hitch, very old, the same knot as at the Bend). | Story clue: a lamp-trimmer passed here (Maren). Reward: Health Potion + 10 arrows. **CUT** sq.burl.hint (an empty path walk). | INS, touch | inspect `note.stoneKnot` on the existing waystone base; writer: 2 lines, no contradiction with M4 canon | S |
| sq.tm.gap "The Open Gate" -> **"The Open Gate"** | Burl: boars don't unlatch gates. Something opened it, and the boars will use it. | 1 Reach the gap -> 2 `boar` charge through it (AMB). 2 Drive them off. 3 Shut the gate (E on the gate leaf -> `prop.state closed` + flag). | The gate stays shut (the world changes). 10 arrows + Burl's line: "Nub. He learned latches." | AMB, KILL, PROP | `Door_1_Round` placed in the existing fence gap as prop `meadowGate` (open/closed, D-103 pattern); group `gap.boars`; 2 logic blocks | M |
| sq.tm.wood "The Woodcutter's Corner" -> **"Spiders in the Stack"** | Burl: something in the woodpile bit her nose. | 1 Look at the stack (existing `inspect.woodpile`) -> 4 `spiderling` swarm out with one `wood_spider` behind them (AMB). 2 Clear the nest. 3 Open the woodcutter's box. | Box: a worn axe-type main weapon roll (or `gear.t1`) + Health Potion. This is the first swarm fight in Ch1. | INS, AMB, KILL, CHEST | group `wood.spiders` (4+1, tier 1); `chestWood` + table | M |
| sq.dw.stones "The Standing Stones" -> **"The Watchers' Ring"** | Burl: the ring is cut like the humming stone. Who watched from there? | 1 Read the ring stones (existing `note.westStones`). 2 Climb the tallest stone and look down the road (area on the stone top: a small vertical goal). 3 Open the watcher's cache at its foot. | Cache: 2 Health Potions + 12 arrows + a sturdy roll. Line: "They watched the road. For whom?" | INS, area (climb), CHEST | area `standTop` (r 1.5 on the top stone); `chestRing` + table | S |
| sq.fc.jetty "Rotten Planks" -> **"Rotten Planks"** (feeds A Cog for the Bend) | Bram: a brass cog washed onto the jetty end, and Joss needs it. | 1 Walk out on the old jetty. 2 Pick up the cog at the end -> a `reed_eel` strikes from the water by the planks. 3 Drive off the eel. | The cog (it was Joss's missing part; sq.fc.cog now has a source) + 10 arrows. | area, PICK, AMB, KILL | pickup `cog` at the jetty end; group `jetty.eel` (1, water); logic block on `item.got cog` | S |
| sq.he.wallow "The Boar Wallow" -> **"Old Tusk"** | Rook: a giant boar sits on her buried hides and she wants them back. | 1 Reach the wallow -> "Old Tusk" rises (one `boar`, elite class, tier 3, bigger). 2 Defeat Old Tusk. 3 Dig out Rook's hide bundle (chest in the mud). | Hides: 2 `boar.hide` (feeds "Gondola Plate") + `gear.t1`. Rook: "Eleven holes. One very dead boar." | AMB, KILL (elite), CHEST | group `wallow.oldTusk` (elite, once per save, D-094/D-095); `chestWallow` + table | M |
| sq.he.farm "Plates for Three" -> **"Plates for Three"** | Burl: she smelled bread at the farm once. Who lived there? | 1 Reach the farm gate (the ambush is already wired: the gate shuts, 3 goblins). 2 Defeat the three goblins (ids of `farm.goblins`; the gate opens). 3 Read the note on the table: "Gone to the Outwall. Back by spring." | Hope instead of grief: the family is alive (a seed for the Outwall/Hesk chapter). Reward `gear.t2`. | AMB (exists), KILL, INS | change the objectives only + `note.farmTable` inspect on the existing table prop; Burl's ready lines rewritten | S |
| sq.fc.smoke "North Watch" -> **"North Watch"** | Bram: smoke every third night in the north. Is it goblins or people? | 1 Climb the north lookout -> 2 `goblin_archer` shoot from the rocks above (AMB). 2 Drive off the archers. 3 Read the watcher's tally on the rock ("smoke every 3rd night; goblins carry it"). | A ranged fight on a height. The tally points at `mq.smoke` / campNorth. 15 arrows + Health Potion. | area, AMB, KILL, INS | group `north.archers` (2, tier 2); inspect `note.northTally` | M |
| sq.fc.cross "The Crossroads Report" + sq.burl.ask "Word from the Crossroads" -> **MERGE "Robbed Basket"** (giver Bram) | Bram: the crossroads basket feeds walkers, and someone keeps emptying it. | 1 Reach the crossroads -> 2 `bandit_cutthroat` + 1 `bandit_archer` at the basket (AMB). 2 Drive off the robbers. 3 Read the note post (the existing talk.notePost flag). | 15 arrows + Health Potion, and the basket line "Leave What You Can Spare" now has a reason. **CUT** sq.burl.ask (Burl keeps fewer errands). | AMB, KILL, INS | group `cross.bandits` (3, tier 2); logic block; repoint requires of sq.post.spare | M |
| sq.fc.ford "Wet Boots" + sq.fc.again "Back Across" -> **MERGE "Wet Boots"** | Bram: a boot-maker's crate went into the ford in spring. Those boots don't slip on wet stone. | 1 Cross to the west bank. 2 Find the sunk crate below the ford stones (existing `chestBoots` = River Boots, unique); a `snapping_turtle` guards it. | River Boots (sure footing, existing passive) from the chest + 10 arrows from Bram. **CUT** Back Across. | area, CHEST, KILL | 1 `snapping_turtle` placement by `chestBoots`; the quest reward drops the duplicate tier-2 feet | S |
| sq.burl.scout "Scout the River" -> **"Loud Water"** | Burl: something took her fish-spot. The river has teeth now. | 1 Reach the river bank. 2 Read the warning stake ("IT CIRCLES FIRST", existing `note.strand.monster` style, new text). 3 Drive off the three `shore_crab` on the bank. | First water-edge fight; teaches "don't wade here yet" before the ford gate (D-095). Gear body/legs (kept). | area, INS, KILL | inspect `note.riverStake` on an existing post mesh; group `bank.crabs` (3, tier 1) | S |
| sq.rb.road "Down the Road West" -> **"Walk Joss to the Wreck"** | Joss wants brass from your wreck for his mallet, but he is scared of the road. | 1 Walk with Joss to the wreck (escort template, npc `joss`). 2 Mid-road 2 `grey_wolf` attack Joss (AMB on area `roadWest`) -> drive them off. | Joss mends your shield at the wreck: a sturdy shield roll + 5 brass scraps lie open to pick up. | ESC, AMB, KILL | escort path `joss -> wreck` (generalised burlEscort); group `road.wolves` (2); Joss walks home after (existing behaviour) | M |

Net result: 20 quests -> 17 (3 cuts: sq.burl.hint, sq.fc.again, sq.burl.ask). 15 of the 17 now contain a fight, a find or both;
6 open a chest; 3 change the world (gate shut, gate opens, cog fitted).

## 3. Warden bounty twists (one each)

| Quest | Twist | Objectives (kill stays objective 1) | Content |
|---|---|---|---|
| sq.reg.glasswater | The boars are running *from* something. | 1 Drive off 3 boars -> `group.cleared` spawns a `river_crocodile` in the shallows. 2 Defeat the crocodile (short grab, D-096). | group `glass.croc` (1, reserve) + logic block |
| sq.reg.northwood | Wolves circle a lost red-deer fawn. | 1 Drive off 3 wolves (group around the fawn). 2 Follow the fawn's tracks to the wolves' den (area). 3 Open the den stash: the warden's lost horn + arrows. | group `nw.pack`, 1 `red_deer` (skittish) placement, area `nwDen`, `chestNwDen` |
| sq.reg.highPastures | A bigger bear leads the two. | 1 Drive off 2 bears -> 2 "Greyback" (`cave_bear`, elite, once per save) comes down. Defeat Greyback. | group `hp.greyback` (elite) + logic block; reward up to `gear.t3` |
| sq.reg.ashMile | Ash Mile is quiet by day and loud at night. | 1 Drive off 2 boars. 2 After dark, drive off 3 `dusk_bat` (a night-only kind, so it only counts at night). | regional night group of `dusk_bat` near ws_ashMile |
| sq.reg.downs | Somebody is driving the herd. | 1 Drive off 4 boars. 2 Defeat the `goblin_torch_bearer` herding them (ids). | 1 torch bearer in the boar group |
| sq.reg.signalHill | The pack has a white leader. | 1 Drive off 3 wolves -> 2 the `white_wolf` alpha comes out on the crest. Defeat it. | group `sh.alpha` (elite white_wolf) + logic block |
| sq.reg.heath | The boars dug up a buried box. | 1 Drive off 3 boars. 2 Open the dug-up lockbox in the heather. | `chestHeath` + table (sturdy roll) |
| sq.reg.reedmire | Lights in the reeds lure walkers in. | 1 Drive off 3 boars. 2 After dark, put out the 2 `wisp` lights in the reeds (a night-only kind). | night group `reed.wisps` |
| sq.reg.strand | The road to the Downs is watched. | 1 Carry the arrows to Edda. On the Downs road, 2 `bandit_archer` ambush you (AMB, area). 2 Bring Edda's reply back to the Strand warden (talk). | group `strand.road` + logic block; 2 Edda lines |
| sq.reg.whitecombs | A climber went up and never came down. | 1 Drive off 2 bears. 2 Find the climber's pack in the bears' den (chest): a rope token + `potion.hp` x2 + a sturdy roll. | `chestCombDen` + table, 1 inspect note in the pack |

## 4. NEW short quests (OPTIONAL, they use mechanics no quest uses yet)

| New id / title / giver | Hook | Objectives | Mechanics | Needs |
|---|---|---|---|---|
| **N1** sq.new.cellar "The Stone on the Hatch" / Bram | A boulder rolled onto his cellar hatch in a rockslip. | 1 Lift the boulder off with Telekinesis (Lv3 lift/throw, SPELL-R7). 2 Go down and bring up the smoked meat crate (existing cellar chests). | telekinesis roller, CHEST | 1 roller-tagged existing rock; **one small new logic event** `prop.moved` (roller > 1.5 m from home) -> architect note |
| **N2** sq.rb.lamps rework "Light the Verge" / Joss | The road lamps are dark, so wolves hunt the verge at dusk. | 1 Light 3 road lamps with Fireball. 2 Wolves come at the light -> drive off 2. | fireball, PROP, AMB | **new event** `prop.hit {cause:'fire'}` + lamp `lit` variant (light exists) -> architect note |
| **N3** sq.new.limp "The Limping Deer" / Dorrin | A hurt deer crossed the ford, and something follows it. | 1 Follow the tracks (3 track areas, sq.tm.nub style) across the ford. 2 Defeat the `lynx` at the kill. 3 Bring Dorrin the lynx hide (fetch `boar.hide` -> reuse, or a new `hide` item id). | tracking, ford, KILL, fetch | existing only (tracks = area chain) |
| **N4** sq.new.smugglers "The Smugglers' Mark" / Rook | Rook saw men hide shiny things under the strand. | 1 Read the mark at the ford (existing `note.fordMark`). 2 Read the smugglers' note (existing `note.smugglers`). 3 Open the sea-cave chest (existing `chestStrandCave`). | INS chain, CHEST | existing only (quest data + lines) |
| **N5** sq.new.throw "Off the Roof" / Hesk | A goblin archer sits on the barn roof shooting geese. | 1 Pull the archer down with Telekinesis (push/pull, existing). 2 Defeat it. | telekinesis on beasts, KILL | existing only (archer placement on a roof the player cannot reach, OB-147 is about givers, not enemies) |

## 5. Build order and stories

Top 8 by fun per effort (existing mechanics only, no engine change): **QD-01 Plates for Three, QD-02 The Cold Well,
QD-03 Wet Boots (merge), QD-04 Scratches at the Door, QD-05 The Tipped Cart, QD-06 The Humming Stone (merge),
QD-07 Rotten Planks + cog, QD-08 Warden twists A (glasswater croc, highPastures Greyback, signalHill alpha).**
Then QD-09..QD-14 (the rest of section 2), QD-15 warden twists B, and QD-16/17 (the optional new quests that need no code). N1/N2 need an architect note first.

Common ACs for every QD story (they are not repeated in the rows):
- [ ] `node tools/quest-sim.mjs --all` passes (no dead end; the reworked quest is reachable and completes).
- [ ] `node tools/quest-e2e-content.mjs` has a scripted run for each touched quest: accept at the giver -> each objective fires from the real event (inspect flag / group cleared / chest flag / item.got) -> `?` at the hand-in character -> reward in the pack -> the next quest is offered.
- [ ] `node tools/quest-graph-lint.mjs` + `node tools/quest-zone-lint.mjs` + `node tools/run-tests.mjs` are green, and OB-156 lint passes (character giver, objectGiver share <= 10 %).
- [ ] Every objText and journal line is <= 38 chars and uses plain names. No new mesh or design file is added (`git diff --stat design/models` is empty).
- [ ] An objective reached before accepting does not count (OB-115). A chest that was already opened completes its step at once, never soft-locks.
- [ ] Each logic block has a Node test in the `game/js/logic/farmAmbush.test.js` pattern (fires once, only while the quest is active, and the group clears).

| Row | Story | Track | Specific ACs | Eff |
|---|---|---|---|---|
| QD-01 | Plates for Three: fight + note | PC-B (content/quests/ch12, content/dialogue/inspect.json) | 3 objectives (reach / 3 goblins by ids / read `note.farmTable`); the gate opens on clear (existing block); Burl's ready lines name the Outwall note | S |
| QD-02 | The Cold Well | PC-B (ch12 pack) | step 2 completes on `item.got book.spell.freeze`; e2e: the quest ends with the Freeze spell known + 1 `potion.mp` | S |
| QD-03 | Wet Boots merge, cut Back Across | PC-B (ch12 pack, world placement) | `sq.fc.again` is removed from the pack and from every `requires` (graph lint); step 2 = the `chestBoots` flag; the turtle is placed within 6 m; the reward has no second feet item | S |
| QD-04 | Scratches at the Door | PC-B (ch12, logic, inspect) | inspect -> `tower.foxes` spawns once; 2 fox kills by id; brass pickup gives an item-get card | S |
| QD-05 | The Tipped Cart | PC-B (ch12, logic, chestDefs row, placement) | `cart.bandits` spawn only after the inspect while the quest is active; `chestCart` opens once and gives honeycomb | M |
| QD-06 | The Humming Stone merge, cut Hill Path | PC-B (ch12, inspect) + writer 2 lines | `sq.burl.hint` removed with requires repointed; 2 objectives (touch, `note.stoneKnot`) | S |
| QD-07 | Rotten Planks + cog source | PC-B (ch12, logic, placement) | the cog pickup sits at the jetty end; the eel spawns on `item.got cog`; sq.fc.cog stays completable (sim) | S |
| QD-08 | Warden twists A (3 quests) | PC-B (regions pack, logic, spawn data) | each 2nd objective is fed by `group.cleared` of the first group; elite groups are once per save (spawnDirector boss rule test); rewards stepped up | M |
| QD-09 | Old Tusk + Who Pushed the Shrine | PC-B | elite boar once per save; skeleton group by day too (reserve, not night-gated) | M |
| QD-10 | Open Gate + Spiders in the Stack | PC-B (+ `meadowGate` prop variant) | the gate prop open/closed has the collider off/on (D-103 pattern); the gate stays shut after save/load | M |
| QD-11 | Cairn Marks + Watchers' Ring | PC-B | 3 cairn inspects in order; `standTop` area reachable (nav/jump check in the e2e) | S |
| QD-12 | North Watch + Robbed Basket (cut Word from the Crossroads) | PC-B | ranged group on the lookout; `sq.burl.ask` removed; sq.post.spare requires repointed | M |
| QD-13 | Loud Water | PC-B | crab group on the east bank only (no ford crossing before the D-095 gate) | S |
| QD-14 | Walk Joss to the Wreck | PC-B (escort data) -> ASK ARCHITECT if the escort needs code beyond npc id | Joss arrives (escort flag); the wolf ambush fires once mid-road; Joss is never killed (the escort NPC is invulnerable or flees) | M |
| QD-15 | Warden twists B (other 7) | PC-B | night steps only count at night (dusk_bat/wisp `when: night`); Strand return talk at the Strand warden | M |
| QD-16/17 | Optional N3 + N4 (+ N5) | PC-B | existing mechanics only; same common ACs | S each |
| QD-18 | ARCH-NOTE: `prop.moved` + `prop.hit{cause}` logic events (for N1/N2) | PC-A/arch | architect note first; parked until the owner picks N1/N2 | - |

Open questions for the owner: (a) Is it OK that the Humming Stone and Cairn Marks give small Maren clues? The writer
checks them against canon. (b) Elite "Old Tusk"/"Greyback" come back never (once per save, D-094)? (c) Should N1/N2 (one small
new logic event each) go ahead?
