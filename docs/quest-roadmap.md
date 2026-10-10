# Quest roadmap to release (~100 quests)

(PC-B writer opus with PO, owner request; signed per D-066.) Story row QL-R1 in docs/pc-b-queue.md.

Sources: D-067 (enclosed world, ~100 quests, gate key = last main reward, bands 1-5 / 5-10 by river side), D-065 (no dungeon, no magic, shield + bow, simple errands), D-060 (relays are the waystones), docs/questline-2026-10-10.md (Ch1-2, ratified; kept as is), architecture 38.44 (templates, packs, reward tables), GDD section 3 (canon). No XP (D-020): the band is zone difficulty plus gear tier.

## 0. Rules

- Templates (38.44): collect, deliver, fetch, kill (kill-n), talk, escort, explore. Main quests may chain `steps`.
- '!' and '?' only over talk/read targets. Steps use the compass. Never lock the player.
- Nobody says "Wick" before the exiles in Ch3 (canon). No magic words: the crystal wakes relays as an old mechanism.
- Maren stays unnamed. Her trace is only the lamp-trimmer's knot and an "M." (story.md 9.5). Hope, not proof.
- Region names are working names until MAP-27. Coordinates come later from MAP-00 / MAP-20.
- Reward shorthand: `gear T1..T5` = rewards.json table for the band (T1 b1-2, T2 b3-4, T3 b5-6, T4 b7-8, T5 b9-10), a slot picked by hash; `arrows N`; `potion` (healing draught); `heart piece`; `chart piece <area>`; `travel <relay>`; `lore` (note/journal line).
- New side ids carry the region code: TM meadow, RB road, EW eastwood, MR marsh, DN dunes, FC ford, OW outwall, LK lake, HF fells, SG signal hill.

## 1. World (assumed until MAP-00 lands)

Tower side, east bank, bands 1-5: Tower + Meadow (TM, 1), Old Road + Bend (RB, 1-2), Eastwood along the river (EW, 2-3), the Marsh in the low south-east (MR, 3-4), the Dunes, beach and estuary on the sea side (DN, 4-5). The Wall and Ferrum stand beyond the east edge (skyline only).
Across the river, west bank, bands 5-10: Ford + Crossroads (FC, 5), Outwall and its farms (OW, 5-6), the Lake (LK, 6-7), the High Fells and the river's source in the snowy north (HF, 7-8), and Signal Hill below the Walled Pass in the western mountains (SG, 8-10).
The river runs from the Fells to the estuary. The ford is the band gate.

## 2. Givers

| giver | kind | where | voice |
|---|---|---|---|
| Burl | bear (she) | berry slope TM; walks to EW, DN, SG | warm, calls him sky-cub |
| Nub | Burl's cub (no lines) | TM, EW | escort target |
| Rook | crow | Bend Relay, then the ford, then wherever relays wake | clipped, counts, keeps shinies |
| Skip | otter | east bank (EW), estuary (DN) | quick, teasing, hates still water |
| Stilt | heron | the Marsh | slow, few words, "stand still" |
| Slate | old tortoise | the Lake | very slow, remembers "the builders" |
| Crag | old mountain goat | Signal Hill ledges | gruff, knows the pass |
| Fen | exile post-rider (man, D-062) | trade post FC, Outwall | wrote the TAKEN tag |
| Hesk | exile elder (woman) | Outwall | first to say his name |
| Dorrin | exile smith | Outwall forge | blunt, reforges the sword |
| Sorrel | exile herb-woman | Outwall | does not believe animals talk |
| Pell | exile child | Outwall | wants to fly, wants the sea |
| Tam | old exile singer | Outwall | sings of "the ones before" |
| Ama | exile fisher | Lake shore | dry, misses her brother |
| Cobb | Ama's brother | lost in the Fells | found alive |
| objects | gondola, burner, packet, post, signpost, pages, drum, cairns, gate | - | read targets |

## 3. Main line (29 quests, 6 chapters)

Spine: follow the pencil line relay to relay to the Signal Tower, answer the call, and take the key to the Walled Pass.

### Ch1 "Beyond the Wall" (TM, RB; band 1) - built + mq.bend.call
Reveal: a woken relay repeats the call. The line is a voice.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| tower.blade | A Blade in the Ashes | 1 | note at the wake -> Burl | explore+fetch | climb the breach, take the steel, find the door | sword | - |
| burl.boars | Boars in the Woods | 1 | Burl | kill 5 | boars wreck the berry slope | crystal | tower.blade |
| m1.q04 | Follow the Bear | 1 | Burl | escort | she leads you to the old stone | - | burl.boars |
| m1.q05 | Awaken the Stone | 1 | Waystone | talk | feed the crystal to the meadow stone | travel Waystone | m1.q04 |
| m1.q06 | The Next Light | 1 | chain | explore | road west to the Bend Relay | travel Bend | m1.q05 |
| mq.bend.call | The Call Carries | 2 | Rook | steps explore+talk | the relay blinks the call; a knot on the brass | chart piece river | m1.q06 |

### Ch2 "The River and the Forgotten" (RB, FC; band 2-5) - ratified
Reveal: the Ford Relay bears the mark of the humming stones under the Low Wards. The line once reached Ferrum. Smoke means people.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.river.road | The River Road | 2 | chain | explore | follow the road to the water | - | mq.bend.call |
| mq.ford.stones | Stones in the Water | 4 | chain | explore | cross the stepping stones | - | mq.river.road |
| mq.ford.mirror | The Missing Glass | 5 | Rook -> Ford Relay | steps talk+fetch | Rook "kept" the relay glass on a ruin roof | travel Ford, River Boots | mq.ford.stones |
| mq.smoke | Smoke in the North | 5 | chain | explore | read the mark, follow the path north | journal Ch2 | mq.ford.mirror |

### Ch3 "The Cast-Out" (OW; band 5-6)
Reveal: the people Ferrum posted as FELL are alive. They hear the call too, but the line west is dead and the hills are beast country. Hesk is the first to say "Wick", once he gives it.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.ow.path | Cookfire Smoke | 5 | chain | explore | follow the footpath to a palisade | - | mq.smoke |
| mq.ow.fence | Wolves at the Fence | 5 | chain | kill 5 | wolves test the fence; faces watch from it | - | mq.ow.path |
| mq.ow.names | A Name at the Gate | 5 | Hesk | talk | "Ferrum says we're dead. Who are you?" | gear T3 | mq.ow.fence |
| mq.ow.relay | The Village Relay | 6 | Hesk -> relay | steps fetch+talk | Dorrin used the relay brass as a hinge; take it back | travel Outwall | mq.ow.names |
| mq.ow.board | The Board of the Dead | 6 | board (read) | explore | Ferrum's FELL notices, carried out and nailed up; one line cut away, a knot on the nail | chart piece west | mq.ow.relay |

### Ch4 "Older than the Wall" (LK, HF; band 6-8)
Reveal: the relay glyphs are older than Crown script. The line was built before the Wall. From the source peak the whole line shows: Ferrum in the east, the Signal Tower in the west, and the Walled Pass beside it.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.lk.bowl | The Drowned Relay | 6 | Ama | fetch | the lake relay stands in the shallows; Ama's net hauled up its bowl | - | mq.ow.board |
| mq.lk.wake | Light on the Water | 6 | chain | talk | wake the lake relay; its pulse doubles in the water | travel Lake | mq.lk.bowl |
| mq.lk.glyphs | Older Letters | 7 | Slate | explore 3 | three shore stones cut in letters no Crown clerk knows | lore | mq.lk.wake |
| mq.hf.cold | The Cold Relay | 7 | chain | steps explore+kill 6 | a wolf den in the ruin by the river's source | travel Fells | mq.lk.glyphs |
| mq.hf.sight | The Whole Line | 8 | chain | explore | from the peak, every woken relay blinks the call | chart piece line | mq.hf.cold |

### Ch5 "The Far Light" (SG; band 8-9)
Reveal: nobody is at the Signal Source. The caller blinks alone, and it has for years (canon). Why it calls is the M4 pick (ESCALATE, section 7). Every row here works with candidates A, B and C.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.sg.hill | Signal Hill | 8 | chain | explore | the teal light, close now, above dark pines | - | mq.hf.sight |
| mq.sg.hush | The Hush Thickens | 8 | Crag | kill 8 | the beasts grow wrong near the hill | gear T5 | mq.sg.hill |
| mq.sg.ledge | The Goat Road | 9 | Crag | escort | Crag leads you up the ledges, slowly, grumbling | - | mq.sg.hush |
| mq.sg.relay | The Last Relay | 9 | chain | talk | wake the last dead relay below the spire | travel Signal Hill | mq.sg.ledge |
| mq.sg.source | Nobody There | 9 | chain | explore | the spire top: a bowl, a mount, the light. No one. | lore (reveal) | mq.sg.relay |

### Ch6 "The Answer" (SG, gate; band 9-10)
Beat: the line was built to carry a call home. He sends an answer back along it. Then the call stops for the first time in years, and the silent mount gives up a key.

| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.gate.reply | Three Short, Three Long | 9 | Source | steps talk+explore | set the mount to answer; walk the beacon ring as it relays | - | mq.sg.source |
| mq.gate.home | Lights Going Home | 9 | chain | explore | from the ridge, the answer runs east relay by relay toward Ferrum | lore | mq.gate.reply |
| mq.gate.lock | The Walled Pass | 10 | chain | explore | a gate in the mountain wall, locked; three rings on the lock | - | mq.gate.home |
| mq.gate.key | The Knot on the Key | 10 | gate lock -> Source base | talk | the quiet bowl's base opens: an iron key, tied with a lamp-trimmer's knot | **key.gate** (last main, once) | mq.gate.lock |

After the key: the gate text reads "The key fits. Not yet." Part II opens after release (D-067), not built.

## 4. Side quests (71) by region

### TM Tower + Meadow (band 1) - 6
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.burl.blue | The Blue Ones | 1 | Burl | collect 5 | blue sprigs the boars missed | Smoke-Grey Cloak | burl.boars |
| sq.wreck.plate | Gondola Plate | 1 | gondola | fetch | the side plate needs a hide strap | Brass Buckler | burl.boars |
| sq.honey | Honey for a Crow | 1 | Burl -> Rook | deliver | "Tell it we're square." | arrows 10, Rook's Hood | sq.rook.shiny |
| sq.tm.burner | Keep the Burner | 1 | burner | collect 4 | dry wood to wake the Kestrel's burner | potion, lore | burl.boars |
| sq.tm.canvas | Canvas for a Den | 1 | Burl | fetch | the torn envelope below the breach; Burl wants it for bedding | gear T1 | sq.burl.blue |
| sq.tm.nub | Where's Nub? | 1 | Burl | explore 3 | small tracks, a torn bush, a wet print: her cub went wandering | heart piece | sq.tm.canvas |

### RB Old Road + Bend (band 1-2) - 6
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.rook.shiny | Shiny Things | 1 | Rook | collect 4 | Kestrel brass along the road | Hunter's Bow, arrows 10 | mq.bend.call |
| sq.packet | The Oilcloth Packet | 2 | packet | deliver | stitched FOR THE FORD POST | arrows 20, lore | mq.bend.call |
| sq.rb.page | Keeper's Page I | 2 | relay mount | explore | a log page pinned under the mount; the rest blew away | heart piece | mq.bend.call |
| sq.rb.miles | Milestones | 2 | milestone | explore 3 | worn stones count the miles to a city with no name | arrows 10, lore | m1.q06 |
| sq.rb.hogs | Road Hogs | 2 | Rook | kill 4 | boars dig the verge where Rook hides things | gear T1 | sq.rook.shiny |
| sq.rb.ask | Ask the Bear | 2 | Rook -> Burl | talk | Rook wants to know if bears eat crows. He won't ask himself. | potion | sq.honey |

### EW Eastwood + east bank (band 2-3) - 7
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.rook.caps | Red Caps | 3 | Rook | collect 5 | red-cap mushrooms by the water | heart piece | mq.ford.mirror |
| sq.ew.nub | Nub in the Brambles | 2 | Burl | escort | Nub is stuck and scared; walk him home | gear T1 | sq.tm.nub |
| sq.ew.lessons | Bear Lessons | 3 | Burl | kill 4 | wolves near the den; Burl wants Nub to watch | gear T2 | sq.ew.nub |
| sq.ew.dam | The Otter's Dam | 2 | Skip | collect 5 | driftwood for a broken dam; meet Skip | arrows 15 | mq.river.road |
| sq.ew.fish | Fish for a Crow | 3 | Skip -> Rook | deliver | a fish, from an otter, to a crow, unasked | potion | sq.ew.dam |
| sq.ew.camp | The Cold Camp | 3 | camp (read) | explore | a keeper's camp: a bedroll, a kettle, ash years old | gear T2, lore | mq.river.road |
| sq.ew.grip | Antler Grip | 3 | Rook | collect 3 | shed antlers for a better bow grip | gear T2 (bow) | sq.rook.shiny |

### MR the Marsh (band 3-4) - 6
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.mr.still | Stand Still | 3 | Stilt | explore 3 | wade to three pools and wait at each | lore | mq.river.road |
| sq.mr.reeds | Reed Pipes | 3 | Stilt | collect 6 | hollow reeds; "the wind should have a voice" | arrows 10 | sq.mr.still |
| sq.mr.adders | Adders | 4 | Stilt | kill 5 | adders in the heron's shallows | gear T2 | sq.mr.still |
| sq.mr.walk | The Sunken Boardwalk | 4 | sign (read) | explore | planks under black water lead to a hut on stilts | heart piece | sq.mr.still |
| sq.mr.page | Keeper's Page II | 4 | hut (read) | fetch | a page dried in a drowned lantern's tin | lore | sq.mr.walk, sq.rb.page |
| sq.mr.lights | Marsh Lights | 4 | Stilt | explore | follow the dusk fireflies to a crate: CROWN STORES - SEALED | gear T2 | sq.mr.adders |

### DN Dunes, beach + estuary (band 4-5) - 7
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.dn.mouth | The River's Mouth | 4 | Skip | explore 3 | sandbars where the river meets the sea | arrows 15, lore | sq.ew.dam |
| sq.dn.shells | Bright Shells | 4 | Skip | collect 6 | shells for an otter who "just likes them" | potion | sq.dn.mouth |
| sq.dn.crabs | Crab Beach | 5 | Skip | kill 6 | crabs took Skip's sunning rock | gear T2 | sq.dn.mouth |
| sq.dn.net | The Torn Net | 5 | Skip | fetch | a net in the dunes; whose? | arrows 20 | sq.dn.crabs |
| sq.dn.wreck | The Old Gondola | 5 | hull (read) | explore | another Crown balloon, decades old, sand to the rails. Someone got out before. | heart piece, lore | sq.dn.net |
| sq.dn.tide | The Tide Stones | 5 | stone (read) | explore 3 | glyph stones bare only at low tide | chart piece coast | sq.dn.mouth |
| sq.dn.salt | Salt for a Bear | 4 | Burl | fetch | Burl came to the sea; she wants a salt crust "for winter" | potion | sq.ew.lessons |

### FC Ford + Crossroads (band 5) - 6
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.straw | Three Straw Men | 5 | note post | kill 3 (targets) | three straw men, three arrows | Big Quiver | sq.rook.shiny |
| sq.fc.sign | The Signpost | 5 | signpost | fetch | the west arm fell in the river | arrows 10 | mq.ford.mirror |
| sq.fc.stores | Boars in the Stores | 5 | post note | kill 5 | boars broke the post's grain crock | gear T3 | sq.packet |
| sq.fc.spare | Leave What You Can Spare | 5 | basket | deliver | leave a hide in the basket; next visit, something waits | potion | sq.packet |
| sq.fc.ledger | Rook's Ledger | 5 | Rook | collect 5 | brass rings in the ruin; Rook says you owe him | gear T3 (head) | sq.honey |
| sq.fc.mule | The Lost Mule | 5 | Fen | escort | Fen's mule strayed to the ford; walk her back | gear T3 | mq.ow.names |

### OW Outwall + farms (band 5-6) - 11
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.ow.letters | Letters Down the Line | 5 | Fen -> Ama | deliver | the exiles' post runs camp to camp | arrows 20 | mq.ow.names |
| sq.ow.taken | Who Wrote TAKEN? | 5 | Fen | talk | Fen grins: the packet was his, years late | lore | sq.packet, mq.ow.names |
| sq.ow.forge | Cold Forge | 6 | Dorrin | collect 5 | iron nodules from the scree | sword reforged (gear T3) | mq.ow.relay |
| sq.ow.bellows | Bellows Leather | 6 | Dorrin | fetch | a wolf pelt for the bellows | gear T3 (shield) | sq.ow.forge |
| sq.ow.herbs | Bitterleaf | 5 | Sorrel | collect 6 | bitter herbs for her draughts | potion x2 | mq.ow.names |
| sq.ow.root | Bog Root | 6 | Sorrel | fetch | a root that grows only in the east marsh | heart piece | sq.ow.herbs |
| sq.ow.kite | Pell's Kite | 5 | Pell | fetch | the kite is in a tree; Pell wants to fly "like you did" | arrows 10 | mq.ow.names |
| sq.ow.sea | Pell Sees the Sea | 6 | Pell | escort | Pell has never seen the sea; walk him to the dunes | heart piece | sq.ow.kite, sq.dn.mouth |
| sq.ow.stakes | Mend the Fence | 5 | Hesk | collect 5 | sharpened stakes from the woodpile | gear T3 | mq.ow.names |
| sq.ow.night | The Night Fence | 6 | Hesk | kill 6 | wolves come after dark | heart piece | sq.ow.stakes |
| sq.ow.song | The Ones Before | 6 | Hesk -> Tam | talk | ask old Tam for the song nobody wrote down | lore | mq.ow.board |

### LK the Lake (band 6-7) - 8
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.lk.floats | Ama's Nets | 6 | Ama | collect 5 | net floats scattered by a storm | arrows 20 | mq.lk.bowl |
| sq.lk.lynx | Lynx at the Racks | 7 | Ama | kill 4 | lynx steal from the drying racks | gear T4 | sq.lk.floats |
| sq.lk.smoked | Smoked Fish | 6 | Ama -> Fen | deliver | the post's supper, carried back | potion | sq.ow.letters |
| sq.lk.slate | Slow Words | 7 | Slate | escort | Slate wants to reach the far shore stone, slowly | heart piece | mq.lk.wake |
| sq.lk.page | Keeper's Page III | 7 | bottle in reeds | fetch | a page in a stoppered bottle | lore | sq.mr.page |
| sq.lk.cairn | The Islet Cairn | 7 | cairn | explore | a wading path to a cairn on the islet | gear T4 | mq.lk.wake |
| sq.lk.brother | Gone Up the Fells | 7 | Ama | explore | Cobb went up for pelts and didn't come down | - | sq.lk.lynx |
| sq.lk.supper | A Fish Supper | 7 | Ama | talk | Cobb is home; Ama sets a third plate | gear T4 | sq.hf.cobb |

### HF High Fells + source (band 7-8) - 7
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.hf.cobb | Cobb on the Ledge | 7 | Cobb | escort | a sprained ankle and too much pride | gear T4 | sq.lk.brother |
| sq.hf.packs | Cobb's Packs | 7 | Cobb | collect 4 | the pelts he dropped on the way up | gear T4 (cloak) | sq.hf.cobb |
| sq.hf.rams | Ram Season | 8 | Cobb | kill 4 | rams hold the only path | gear T4 | sq.hf.cobb |
| sq.hf.drum | The Record Drum | 8 | sentinel wreck (read) | explore | a Crown sentinel in the snow; its drum reads M. - CAST OUT - RECORDED DEAD | lore | mq.hf.cold |
| sq.hf.spring | Where the River Starts | 8 | spring (read) | explore | a spring under the snow line, the whole river from one stone | heart piece | mq.hf.cold |
| sq.hf.cairns | Cairn Path | 8 | cairn | explore 4 | cairns in fog lead to a keeper's cache | arrows 30 | mq.hf.cold |
| sq.hf.ice | Thin Ice | 8 | tarn sign | explore | cross the frozen tarn to a cache on the far side | potion x2 | sq.hf.cairns |

### SG Signal Hill + gate foothills (band 8-10) - 7
| id | title | band | giver | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.sg.ledges | Crag's Ledges | 8 | Crag | explore 3 | the three ledges a goat trusts | gear T5 (boots) | mq.sg.hush |
| sq.sg.kid | Crag's Kid | 9 | Crag | escort | a kid on a ledge it can't get down from | heart piece | sq.sg.ledges |
| sq.sg.wolves | Hush Wolves | 9 | Crag | kill 6 | a pack that does not run from fire | gear T5 | sq.sg.ledges |
| sq.sg.page | Keeper's Page IV | 9 | keeper's shelter | fetch | the last page, under a stone at the spire foot | lore (reveal) | sq.lk.page, mq.sg.relay |
| sq.sg.watch | The Gate Watch | 10 | watchtower (read) | explore 3 | three towers on the pass wall; the bolts face this way | lore | mq.gate.lock |
| sq.sg.rook | Rook's Best Shiny | 9 | Rook | collect 4 | four glass beads; Rook trades his best thing | gear T5 (bow) | sq.fc.ledger, mq.sg.relay |
| sq.sg.burl | Bears Walk | 9 | Burl -> Rook | talk | Burl walked all the way west. "Bears walk." | heart piece | sq.dn.salt, mq.sg.relay |

## 5. Arcs (side quests that tell a small story)

- **Nub** (Burl): sq.tm.nub -> sq.ew.nub -> sq.ew.lessons -> sq.dn.salt -> sq.sg.burl. The bear who never leaves her slope walks west at the end.
- **Rook's hoard**: shiny -> honey -> rb.ask -> ew.grip -> fc.ledger -> sg.rook. He counts, keeps, and finally gives his best.
- **The post** (Fen): sq.packet -> fc.spare -> ow.taken -> ow.letters -> lk.smoked. The TAKEN hand gets a face.
- **Keeper's pages**: rb.page -> mr.page -> lk.page -> sg.page. Four log pages in the same hand as the tower log; page IV carries the M4 reveal text.
- **Someone got out before**: the hidden chest (Wayfarer Tunic) -> dn.wreck -> hf.drum -> mq.gate.key. Ambiguous traces of a skyworks hand, never named.
- **Ama and Cobb**: lk.floats -> lk.lynx -> lk.brother -> hf.cobb -> hf.packs -> lk.supper.
- **Pell**: ow.kite -> ow.sea. The child who wants the sky gets the sea instead.
- **Older than the Wall**: dn.tide -> mq.lk.glyphs -> ow.song -> sg.watch.

Memorable picks: The Call Carries, The Board of the Dead, The Old Gondola, The Record Drum, Slow Words, Pell Sees the Sea, Bears Walk, The Knot on the Key.

## 6. Totals and economy

| region | band | main | side |
|---|---|---|---|
| TM + RB | 1-2 | Ch1 (6) + 1 | 12 |
| EW, MR, DN | 2-5 | - | 20 |
| FC | 5 | 3 | 6 |
| OW | 5-6 | Ch3 (5) | 11 |
| LK + HF | 6-8 | Ch4 (5) | 15 |
| SG + gate | 8-10 | Ch5 + Ch6 (9) | 7 |
| **total** | | **29** | **71** |

**100 quests.** Side templates: explore 18, collect 15, fetch 11, kill 10, escort 6, deliver 6, talk 5. Main quests add explore, talk, kill, escort and chained steps.
**Heart pieces from quests: 12** (TM 1, RB 1, EW 1, MR 1, DN 1, OW 3, LK 1, HF 1, SG 2). Chests carry 12 more (3 in Ch1-2 per MAP-25, 9 to place), so 24 = 6 heart vessels (lint: total % 4 == 0).
**Arrows from quests: 210** (honey 10, shiny 10, packet 20, miles 10, dam 15, reeds 10, mouth 15, net 20, sign 10, letters 20, kite 10, floats 20, cairns 30, plus the post basket refills). The cap stays 30 / 50 with the Big Quiver.
**Gear:** T1 x3, T2 x6, T3 x7, T4 x6, T5 x4, plus named items (cloak, buckler, hood, bow, boots, quiver). The sword is reforged once at Dorrin's (T3). The table for each band per 38.44 item 6.
**Travel:** Waystone, Bend, Ford, Outwall, Lake, Fells, Signal Hill (7 relays, main line only, D-060).
**Chart pieces:** river, west, coast, line.
**key.gate:** given once, by mq.gate.key.

## 7. ESCALATE TO MANAGER

1. **M4 reveal pick (story.md 7: A, B or C).** It is needed before the Ch5 texts and Keeper's Page IV. Every row here is neutral. I recommend A+B (the shut-out people built the caller, and the keeper kept it fed), because the pages arc and the glyph arc then both pay off.
2. **The call stops (Ch6).** Answering it and silencing the SOS is a new canon event. The canon only fixes that it has sent for years. Proposal: add it to GDD 3 as the release ending.
3. **No magic for 1.0.** GDD 3 still lists the gauntlet, Spark, Gust and Ward. D-065 drops magic for now, so this roadmap uses none. Proposal: GDD 3 marks those "Part II or later". The crystal-woken relays stay.
4. **New characters.** Talking animals Skip, Stilt, Slate and Crag, the cub Nub, and the exiles Fen (as a man, D-062), Hesk, Dorrin, Sorrel, Pell, Tam, Ama and Cobb. These need an owner OK, plus designer models built from existing meshes or recolours.
5. **The old gondola wreck on the dunes** implies an earlier escape by air. It fits "FOR THE NEXT ONE OUT", but it needs a canon nod.
