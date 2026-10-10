# Quest roadmap to release (~100 quests)

(PC-B writer opus with PO, owner request; signed per D-066.) Story row QL-R1 in docs/pc-b-queue.md. Revised 2026-10-11 to the owner-approved world map (D-067): docs/world-map-2026-10-11.md + design/levels/world_geo.js.

Sources: D-067 (enclosed world, ~100 quests, gate key = last main reward, bands 1-5 / 5-10 by river side), D-065 (no dungeon, no magic: sword, shield, bow; simple errands), D-064 (marks, never lock), D-060 (relays are the waystones), D-058 (Fen removed), docs/questline-2026-10-10.md (Ch1-2, ratified; kept), architecture 38.44 (templates, packs, reward tables), GDD section 3 (canon). No XP (D-020): the band is zone difficulty plus gear tier.

## 0. Rules

- Templates (38.44): collect, deliver, fetch, kill (kill-n), talk, escort, explore. Main quests may chain `steps`.
- '!' and '?' only over givers / hand-in targets (someone or something you talk to or read). Steps use the compass. Never lock the player (escorts wait, they don't hold you).
- No magic (D-065). The crystal wakes relays as an old mechanism. No dungeon: caves, adits and the quarry are shallow open sites.
- Nobody says "Wick" before the exiles in Ch3 (canon).
- Maren stays unnamed. Her trace is only the lamp-trimmer's knot and an "M." (story.md 9.5). Hope, not proof.
- Every quest sits at a real site: `site (x,y)` = world_geo.sites, engine metres, x east, y south. "(P)" names from the map are used as approved.
- Band = the region's level band from world_geo.regions. The Whitecombs run 5 (east) to 9-10 (west); the river gorge up to Highspring tarn is taken as 7-8.
- Reward shorthand: `gear T1..T5` = rewards.json table for the band (T1 b1-2, T2 b3-4, T3 b5-6, T4 b7-8, T5 b9-10), slot by hash; `arrows N`; `potion` (healing draught); `heart piece`; `chart piece <area>`; `travel <relay>`; `lore` (note/journal line).
- Region codes in side ids: TM tower, RB road west, HE heartland east, DW Downs, LS Long Strand, AM Ash Mile, NW Northwood, FC ford, GW Glasswater (old ids `lk`), OW Outwall, HW heartland west, RM Reedmire (old ids `mr`), TW Thornwood, SH Signal Hill (old ids `sg`), HC Heath coast, HP High Pastures, WF West Fells, WC Whitecombs.

## 1. World (D-067, approved)

Tower side, east of the river, bands 1-5: Tower Hill + meadow (1), Road West + Bend (1-2), river heartland east (2-3), the Downs (2-3), the Long Strand + Gullhaven (3-4), the Ash Mile under the Wall (3-4), Northwood (4-5), Ford + Crossroads (4-5), Glasswater + North Bank (4-6, east shore 4-5, west shore 6).
Across the river, bands 5-10: Outwall fields (5-6), heartland west (5-6), the Reedmire (5-7), the Thornwood (6-7), Signal Hill + Signal Head (7-8), the Heath coast (8-9), High Pastures (8-9), West Fells + the Sealed Gate (9-10). North: the Whitecombs (5 east .. 9-10 west).
The river runs from Highspring tarn (1193,130) through Glasswater (1235,505), past the ford (1028,1068) and the Reedmire, to the estuary (1180,1725). Sea south. Ferrum's Wall east (x ~1985; bounds stop at 1880).
Relay line (main travel): meadow waystone, Bend, Ford, Outwall, North Bank (stage 4, a relay in the north bank ruins, 1150,800), ws_signalNorth, Signal tower. Side relay: Mire. The Ash Mile stump never wakes.

## 2. Givers

| giver | kind | where (site) | voice |
|---|---|---|---|
| Burl | bear (she) | berry slope, Tower Hill; later the Downs, Gullhaven, Signal Hill | warm, calls him sky-cub |
| Nub | Burl's cub (no lines) | Tower Hill, flower meadow (1300,900) | escort target |
| Rook | crow | Bend Relay, then his nest in the crossroads ruin (975,1058), then wherever relays wake | clipped, counts, keeps shinies |
| Skip | otter | under the Gullhaven jetty (1500,1715) | quick, teasing, hates still water |
| Stilt | heron | eel weirs (1210,1660), Reedmire | slow, few words, "stand still" |
| Slate | old tortoise | island ruin, Glasswater (1270,520) | very slow, remembers "the builders" |
| Crag | old mountain goat | Signal Head ledges; goatherds' summer hut (520,420) | gruff, knows the pass |
| Hesk | exile elder (woman) | Outwall (905,940) | first to say his name |
| Dorrin | exile smith | Outwall forge | blunt, reforges the sword |
| Sorrel | exile herb-woman | Outwall | does not believe animals talk |
| Pell | exile child | Outwall | wants to fly, wants the sea |
| Tam | old exile singer, once rode the post | Outwall | sings of "the ones before" |
| Ama | exile fisher | fisher's jetty, Glasswater (1100,560) | dry, misses her brother |
| Cobb | Ama's brother | lost by the ice cave (980,250) | found alive |
| objects | gondola, burner, packet, boards, signs, stones, pages, drum, hull, gate | - | read targets |

### 2b. Owner OK needed (new characters)

| who | pitch |
|---|---|
| Nub | Burl's cub; no lines; wanders off, gets stuck, watches his mother fight. |
| Skip | Otter of the empty fishing village; teasing, restless, gives the coast errands. |
| Stilt | Heron of the Reedmire; speaks rarely; teaches the player to stand still and look. |
| Slate | Ancient tortoise on the Glasswater islet; remembers "the builders" of the line. |
| Crag | Old goat of Signal Head; grumbles, leads the player up the ledges in Ch5. |
| Hesk | Exile elder at Outwall; the first person to say "Wick". |
| Dorrin | Exile smith; used the relay brass as a hinge; reforges the sword. |
| Sorrel | Exile herb-woman; pragmatic, refuses to believe the animals talk. |
| Pell | Exile child; wants to fly like the player did; gets the sea instead. |
| Tam | Old exile singer; rode the post once and wrote the TAKEN tag. |
| Ama | Exile fisher at Glasswater; hauled the relay bowl up in her net. |
| Cobb | Ama's brother; went up the river for pelts, found hurt but proud. |

Models: designer, from existing meshes or recolours (owner rule).

## 3. Main line (29 quests, 6 chapters)

Spine: follow the pencil line relay to relay to the Signal tower, answer the call, take the key to the Sealed Gate.

### Ch1 "Beyond the Wall" (Tower Hill, Road West; band 1-2) - built + mq.bend.call
Reveal: a woken relay repeats the call. The line is a voice.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| tower.blade | A Blade in the Ashes | 1 | note at the wake -> Burl; Hollow Watchtower (1496.5,1024.5) | explore+fetch | climb the breach, take the steel, find the door | sword | - |
| burl.boars | Boars in the Woods | 1 | Burl, berry slope | kill 5 | boars wreck the berry slope | crystal | tower.blade |
| m1.q04 | Follow the Bear | 1 | Burl | escort | she leads you to the old stone | - | burl.boars |
| m1.q05 | Awaken the Stone | 1 | meadow waystone (1428,1040) | talk | feed the crystal to the stone | travel Waystone | m1.q04 |
| m1.q06 | The Next Light | 1 | chain | explore | road west to the Bend Relay (1262,1033) | travel Bend | m1.q05 |
| mq.bend.call | The Call Carries | 2 | Rook, Bend Relay | steps explore+talk | the relay blinks the call; a knot on the brass | chart piece river | m1.q06 |

### Ch2 "The River and the Forgotten" (Road West, Ford; band 2-5) - ratified
Reveal: the Ford Relay bears the mark of the humming stones under the Low Wards. The line once reached Ferrum. Smoke means people.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.river.road | The River Road | 2 | chain; the road down to the water | explore | follow the road to the river | - | mq.bend.call |
| mq.ford.stones | Stones in the Water | 4 | chain; stepping stones (1028,1068) | explore | cross the stepping stones | - | mq.river.road |
| mq.ford.mirror | The Missing Glass | 5 | Rook -> Ford Relay (992,1079) | steps talk+fetch | Rook "kept" the relay glass in his nest on the crossroads ruin | travel Ford, River Boots | mq.ford.stones |
| mq.smoke | Smoke in the North | 5 | chain; north look (955,1005) | explore | read the mark; smoke above the fields | journal Ch2 | mq.ford.mirror |

### Ch3 "The Cast-Out" (Outwall fields; band 5-6)
Reveal: the people Ferrum posted as FELL are alive. They hear the call too, but the line west is dead and the woods are beast country. Hesk is the first to say "Wick", once he gives it.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.ow.path | Cookfire Smoke | 5 | chain; north track to Outwall (905,940) | explore | follow the track to a palisade | - | mq.smoke |
| mq.ow.fence | Wolves at the Fence | 5 | chain; goose farm (860,990) | kill 5 | wolves test the fence; faces watch from it | - | mq.ow.path |
| mq.ow.names | A Name at the Gate | 5 | Hesk, Outwall gate | talk | "Ferrum says we're dead. Who are you?" | gear T3 | mq.ow.fence |
| mq.ow.relay | The Village Relay | 6 | Hesk -> Outwall relay (912,952) | steps fetch+talk | Dorrin hung the barley-farm gate (975,900) on the relay brass; take it back | travel Outwall | mq.ow.names |
| mq.ow.board | The Board of the Dead | 6 | board in Outwall (read) | explore | Ferrum's FELL notices, carried out and nailed up; one line cut away, a knot on the nail | chart piece west | mq.ow.relay |

### Ch4 "Older than the Wall" (Glasswater, Whitecombs; band 6-8)
Reveal: the relay glyphs are older than Crown script. The line was built before the Wall. From above Highspring tarn the whole line shows: Ferrum in the east, the Signal tower in the west, the Sealed Gate as a notch in the Fells.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.lk.bowl | The Drowned Bowl | 6 | Ama, fisher's jetty (1100,560) | fetch | her net hauled up a relay bowl; the North Bank relay is missing one | - | mq.ow.board |
| mq.lk.wake | Light on the Water | 6 | North Bank relay, north bank ruins (1150,800) | talk | seat the bowl, wake the relay; its pulse doubles on the lake | travel North Bank | mq.lk.bowl |
| mq.lk.glyphs | Older Letters | 6 | Slate, island ruin (1270,520) | explore 3 | three shore stones (Glasswater beach 1180,430; island ruin; reed-cutters' camp 1360,560) cut in letters no Crown clerk knows | lore | mq.lk.wake |
| mq.wc.cold | The Cold Climb | 7 | chain; ice cave (980,250) | steps explore+kill 6 | up the river gorge; wolves winter in the shallow ice cave | gear T4 | mq.lk.glyphs |
| mq.wc.sight | The Whole Line | 8 | chain; ridge above Highspring tarn (1193,130) | explore | every woken relay blinks the call, east to west | chart piece line | mq.wc.cold |

### Ch5 "The Far Light" (Signal Hill + Signal Head; band 7-8)
Reveal: nobody is at the Signal Source. The caller blinks alone, and it has for years (canon). Why it calls is the M4 pick (section 7). Every row works with candidates A, B and C.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.sg.hill | The Old West Road | 7 | chain; Old West Road through the Thornwood edge to ws_signalNorth (695,1090) | steps explore+talk | the teal light, close now; wake the waystone below it | travel Signal North | mq.wc.sight |
| mq.sg.hush | The Hush Thickens | 7 | Crag, keeper's lodge (790,1180) | kill 8 | the beasts grow wrong near the hill | gear T4 | mq.sg.hill |
| mq.sg.ledge | The Goat Road | 8 | Crag | escort | Crag leads you up the ledges from the lodge, slowly, grumbling | - | mq.sg.hush |
| mq.sg.relay | The Last Relay | 8 | chain; dead mount at the Signal tower foot (713.8,1232.1) | talk | wake the last dead relay below the spire | travel Signal tower | mq.sg.ledge |
| mq.sg.source | Nobody There | 8 | chain; Signal tower top | explore | a bowl, a mount, the light. No one. | lore (reveal) | mq.sg.relay |

### Ch6 "The Answer" (Signal Hill, West Fells; band 8-10)
Beat: the line was built to carry a call home. He sends an answer back along it. The call stops for the first time in years, and the silent mount gives up a key.

| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| mq.gate.reply | Three Short, Three Long | 8 | Signal Source | steps talk+explore | set the mount to answer; walk the beacon ring as it relays | - | mq.sg.source |
| mq.gate.home | Lights Going Home | 8 | chain; Signal Head cliff (760,1405) | explore | the answer runs east relay by relay toward Ferrum | lore | mq.gate.reply |
| mq.gate.lock | The Sealed Gate | 9 | chain; Old West Road past the gate garrison ruin (360,880) to the Sealed Gate (240,840) | explore | walls across the pass, two towers, a barred gate; three rings on the lock | - | mq.gate.home |
| mq.gate.key | The Knot on the Key | 10 | gate lock -> Signal tower base -> Sealed Gate | steps talk+explore | the quiet bowl's base opens: an iron key tied with a lamp-trimmer's knot; carry it west | **key.gate** (last main, once) | mq.gate.lock |

At the gate: "The key fits. Not yet." Part II opens after release (D-067), not built.

## 4. Side quests (71) by region

### TM Tower Hill + meadow (band 1) - 4
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.burl.blue | The Blue Ones | 1 | Burl, berry slope | collect 5 | blue sprigs the boars missed | Smoke-Grey Cloak | burl.boars |
| sq.wreck.plate | Gondola Plate | 1 | gondola, crash below the tower | fetch | the side plate needs a hide strap | Brass Buckler | burl.boars |
| sq.tm.burner | Keep the Burner | 1 | burner, crash below the tower | collect 4 | dry wood to wake the Kestrel's burner | potion, lore | burl.boars |
| sq.tm.nub | Where's Nub? | 1 | Burl | explore 3 | small tracks past the meadow waystone (1428,1040), a torn bush, a wet print | heart piece | sq.burl.blue |

### RB Road West + Bend (band 1-2) - 4
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.rook.shiny | Shiny Things | 1 | Rook, Bend Relay (1262,1033) | collect 4 | Kestrel brass along the road | Hunter's Bow, arrows 10 | mq.bend.call |
| sq.packet | The Oilcloth Packet | 2 | packet, road verge -> trade post (1000,1066) | deliver | stitched FOR THE FORD POST | arrows 20, lore | mq.bend.call |
| sq.rb.page | Keeper's Page I | 2 | Bend Relay mount | explore | a log page pinned under the mount; the rest blew away | heart piece | mq.bend.call |
| sq.rb.ask | Ask the Bear | 2 | Rook -> Burl | talk | Rook wants to know if bears eat crows. He won't ask himself. | potion | sq.honey |

### HE River heartland, east bank (band 2-3) - 3
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.he.hogs | The Boar Wallow | 2 | Rook | kill 4 | boars at the wallow (1330,1150) dig up Rook's hides | gear T1 | sq.rook.shiny |
| sq.ew.nub | Nub in the Brambles | 2 | Burl | escort | Nub is stuck in the flower meadow (1300,900); walk him home | gear T1 | sq.tm.nub |
| sq.he.farm | Plates for Three | 3 | river farm gate (read) (1100,1250) | explore | plates set for three, the gate chained from outside | gear T2, lore | mq.river.road |

### DW the Downs (band 2-3) - 5
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.honey | Honey for a Crow | 2 | Burl -> Rook | deliver | comb from the bee farm (1530,1190): "Tell it we're square." | arrows 10, Rook's Hood | sq.rook.shiny |
| sq.ew.lessons | Bear Lessons | 3 | Burl | kill 4 | wolves at the drovers' camp (1380,1330); Burl wants Nub to watch | gear T2 | sq.ew.nub |
| sq.dw.stones | The Standing Stones | 3 | stone (read) (1480,1480) | explore 3 | a ring of stones cut with the relay's letters | lore | mq.bend.call |
| sq.dw.poppies | Red Things | 3 | Rook | collect 5 | poppy heads from the poppy fields (1700,1430); Rook likes red | heart piece | sq.honey |
| sq.dw.mill | Nailed Sails | 3 | windmill ruin (read) (1800,1540) | explore | sails nailed still; a notice: NO GRAIN PAST THE WALL | gear T2 | mq.river.road |

### LS the Long Strand + Gullhaven (band 3-4) - 6
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.ls.holt | The Otter's Holt | 3 | Skip, Gullhaven jetty (1500,1715) | collect 5 | driftwood for his holt under the jetty; meet Skip | arrows 15 | mq.river.road |
| sq.ls.empty | Gullhaven | 3 | village board (read) | explore 3 | doors open, nets dry, kettles cold; CLEARED - WALL LAW | chart piece coast | sq.ls.holt |
| sq.ls.shells | Bright Shells | 3 | Skip | collect 6 | shells at the seal rocks (1780,1765); he "just likes them" | potion | sq.ls.holt |
| sq.ls.crabs | Crab Beach | 4 | Skip | kill 6 | crabs took the dune camp (1350,1700) and Skip's sunning rock | gear T2 | sq.ls.shells |
| sq.ls.wreck | The Old Gondola | 4 | hull (read), beach wreck (1680,1760) | explore | another Crown balloon, decades old, sand to the rails. Someone got out before. | heart piece, lore | sq.ls.crabs |
| sq.ls.salt | Salt for a Bear | 4 | Burl, Gullhaven | fetch | a salt crust from the rocks under the lighthouse ruin (1865,1705), "for winter" | potion | sq.ew.lessons |

### AM the Ash Mile (band 3-4) - 2
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.am.scraps | The Fall Line | 3 | Rook | collect 5 | Kestrel scraps along the scrap trail (1650,1015); brass makes a better grip | gear T2 (bow) | sq.rook.shiny |
| sq.am.stump | The Cut Relay | 4 | relay stump (read) (1760,1012) | explore | a relay sawn off at the knee, facing the Wall; ballista bolts in the ash. It never wakes. | lore | sq.am.scraps |

### NW Northwood (band 4-5) - 3
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.nw.camp | The Logging Camp | 4 | camp board (read) (1600,700) | explore | axes left in the stumps, a tally that stops mid-row | gear T2 | mq.river.road |
| sq.nw.den | The Wolf Den | 5 | camp board: WOLVES - DO NOT CAMP | kill 6 | the den (1800,780) | gear T3 | sq.nw.camp |
| sq.nw.watch | The Pine Watchtower | 5 | watchtower (read) (1720,560) | explore | a Crown spyglass bolted to the rail, aimed at the river, not the Wall | gear T3, lore | sq.nw.camp |

### FC Ford + Crossroads (band 4-5) - 5
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.straw | Three Straw Men | 5 | note post, straw targets (978,1092) | kill 3 (targets) | three straw men, three arrows | Big Quiver | sq.rook.shiny |
| sq.fc.sign | The Signpost | 5 | signpost, crossroads ruin (975,1058) | fetch | the west arm fell in the river | arrows 10 | mq.ford.mirror |
| sq.fc.stores | Boars in the Stores | 5 | trade post note (1000,1066) | kill 5 | boars broke the post's grain crock | gear T3 | sq.packet |
| sq.fc.spare | Leave What You Can Spare | 5 | basket, trade post | deliver | leave a hide in the basket; next visit, something waits | potion | sq.packet |
| sq.fc.ledger | Rook's Ledger | 5 | Rook, nest | collect 5 | brass rings in the crossroads ruin; Rook says you owe him | gear T3 (head) | sq.honey |

### GW Glasswater + North Bank (band 4-6) - 6
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.lk.floats | Ama's Nets | 6 | Ama, fisher's jetty (1100,560) | collect 5 | floats along Glasswater beach (1180,430) after a storm | arrows 20 | mq.lk.bowl |
| sq.lk.lynx | Lynx at the Racks | 6 | Ama | kill 4 | lynx steal from the drying racks | gear T3 | sq.lk.floats |
| sq.lk.slate | Slow Words | 6 | Slate, island ruin (1270,520) | escort | to the shore stone by the reed-cutters' camp (1360,560), slowly | heart piece | mq.lk.wake |
| sq.lk.page | Keeper's Page III | 6 | bottle in the reeds, reed-cutters' camp | fetch | a page in a stoppered bottle | lore | sq.mr.page |
| sq.lk.brother | Gone Up the River | 6 | Ama | explore | Cobb went up the gorge for pelts and didn't come down | - | sq.lk.lynx |
| sq.lk.supper | A Fish Supper | 6 | Ama | talk | Cobb is home; Ama sets a third plate | gear T3 | sq.wc.cobb |

### OW Outwall fields (band 5-6) - 8
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.ow.letters | Letters Down the Line | 5 | Hesk -> Ama | deliver | the exiles' post runs camp to camp | arrows 20 | mq.ow.names |
| sq.ow.taken | Who Wrote TAKEN? | 5 | Tam | talk | the packet was his, years late; he rode the post once | lore | sq.packet, mq.ow.names |
| sq.ow.forge | Cold Forge | 6 | Dorrin | collect 5 | charcoal from the Thornwood burners (610,1110) | sword reforged (gear T3) | mq.ow.relay |
| sq.ow.herbs | Bitterleaf | 5 | Sorrel | collect 6 | bitter herbs in the orchard (930,860) | potion x2 | mq.ow.names |
| sq.ow.root | Bog Root | 6 | Sorrel | fetch | a root from the peat cutters (1250,1440) | heart piece | sq.ow.herbs |
| sq.ow.sea | Pell Sees the Sea | 6 | Pell | escort | Pell has never seen the sea; walk him to Gullhaven (1500,1715) | heart piece | mq.ow.names, sq.ls.holt |
| sq.ow.night | The Night Fence | 6 | Hesk | kill 6 | wolves come after dark at the goose farm (860,990) | heart piece | mq.ow.names |
| sq.ow.song | The Ones Before | 6 | Hesk -> Tam | talk | ask old Tam for the song nobody wrote down | lore | mq.ow.board |

### HW River heartland, west bank (band 5-6) - 1
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.hw.piers | The Pulled Bridge | 5 | pier stone (read), old bridge piers (1045,1320) | explore | the bridge was pulled down from the west bank; chisel marks, a Crown stamp | arrows 10, lore | mq.ford.mirror |

### RM the Reedmire (band 5-7) - 5
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.mr.still | Stand Still | 5 | Stilt, eel weirs (1210,1660) | explore 3 | wade to three pools and wait at each | lore | mq.ford.stones |
| sq.mr.adders | Adders | 6 | Stilt | kill 5 | adders at the heron rookery (990,1600) | gear T3 | sq.mr.still |
| sq.mr.walk | The Sunken Boardwalk | 6 | sign (read) | explore | planks under black water lead to the stilt hut (1150,1560) | heart piece | sq.mr.still |
| sq.mr.page | Keeper's Page II | 6 | stilt hut | fetch | a page dried in a drowned lantern's tin | lore | sq.mr.walk, sq.rb.page |
| sq.mr.relay | The Mire Relay | 7 | Mire relay (1060,1470) | talk | a side relay in the reeds, glass crusted with salt; wake it | travel Mire | sq.mr.walk |

### TW the Thornwood (band 6-7) - 3
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.tw.oak | The Hollow Oak | 6 | oak (read) (650,960) | explore | an oak hollow enough to stand in; a blanket, a carved tally of nights | heart piece | mq.ow.board |
| sq.tw.lodge | The Hunter's Lodge | 7 | lodge note (760,880) | kill 5 | lynx at the hung meat | gear T4 | sq.tw.oak |
| sq.tw.shrine | The Moss Shrine | 7 | shrine stone (read) (720,790) | explore | under the moss, the relay letters again | lore | mq.lk.glyphs |

### SH Signal Hill + Signal Head (band 7-8) - 4
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.sg.ledges | Crag's Ledges | 8 | Crag | explore 3 | the three ledges above Signal Head cove a goat trusts | gear T4 (boots) | mq.sg.hush |
| sq.sg.page | Keeper's Page IV | 8 | keeper's lodge hearth (790,1180) | fetch | the last page, under a hearth stone | lore (reveal) | sq.lk.page, mq.sg.relay |
| sq.sg.rook | Rook's Best Shiny | 8 | Rook | collect 4 | four glass beads in Signal Head cove (760,1405); he trades his best thing | gear T4 (bow) | sq.fc.ledger, mq.sg.relay |
| sq.sg.burl | Bears Walk | 8 | Burl -> Rook | talk | Burl walked all the way west. "Bears walk." | heart piece | sq.ls.salt, mq.sg.relay |

### HC the Heath coast (band 8-9) - 3
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.hc.wolves | Hush Wolves | 8 | crofter farm door (read) (560,1300) | kill 6 | a pack that does not run from fire | gear T4 | mq.sg.hush |
| sq.hc.chapel | The Heath Chapel | 9 | chapel door (read) (420,1330) | explore | a bell with no clapper; names cut in the door, all struck through | gear T5, lore | sq.hc.wolves |
| sq.hc.cave | The Smugglers' Cave | 9 | cave mouth (480,1475) | explore | a shallow sea cave; a dry cask on a ledge | arrows 30 | sq.hc.wolves |

### HP High Pastures (band 8-9) - 2
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.hp.kid | Crag's Kid | 9 | Crag, goatherds' summer hut (520,420) | escort | a kid on a ledge it can't get down from | heart piece | sq.sg.ledges |
| sq.hp.rams | Ram Season | 9 | Crag | kill 4 | rams hold the path to the shepherd's fold (420,640) | gear T5 | sq.hp.kid |

### WF West Fells + the Sealed Gate (band 9-10) - 3
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.wf.drum | The Record Drum | 9 | sentinel wreck below the fells watchtower (330,1180) | explore | a Crown sentinel in the heather; its drum reads M. - CAST OUT - RECORDED DEAD | lore | mq.sg.source |
| sq.wf.adit | The Copper Adit | 9 | adit mouth (read) (200,1060) | explore | ten metres in: a keeper's cache, dry | potion x2, gear T5 | sq.wf.drum |
| sq.wf.watch | The Gate Watch | 10 | garrison ruin (read) (360,880) | explore 3 | three towers on the pass wall; the bolts face this way | lore | mq.gate.lock |

### WC the Whitecombs (band 5-8) - 4
| id | title | band | giver / site | tmpl | hook | reward | after |
|---|---|---|---|---|---|---|---|
| sq.wc.hermit | The Hermit's Shelter | 5 | shelter (read) (1450,300) | explore | a cold shelter at the snow line; the relay line scratched on the wall | lore | sq.nw.watch |
| sq.wc.cobb | Cobb on the Ledge | 7 | Cobb, by the ice cave (980,250) | escort | a sprained ankle and too much pride; down to the jetty | gear T4 | sq.lk.brother |
| sq.wc.packs | Cobb's Packs | 7 | Cobb | collect 4 | the pelts he dropped in the gorge | gear T4 (cloak) | sq.wc.cobb |
| sq.wc.spring | Where the River Starts | 8 | spring (read), Highspring tarn (1193,130) | explore | the whole river from one stone under the snow | lore | mq.wc.sight |

## 5. Arcs

- **Nub** (Burl): tm.nub -> ew.nub -> ew.lessons -> ls.salt -> sg.burl. The bear who never leaves her slope walks west at the end.
- **Rook's hoard**: shiny -> honey -> rb.ask -> dw.poppies / am.scraps -> fc.ledger -> sg.rook. He counts, keeps, and finally gives his best.
- **The post**: packet -> fc.spare -> ow.taken -> ow.letters. The TAKEN hand gets a face (Tam).
- **Keeper's pages**: rb.page -> mr.page -> lk.page -> sg.page; the hollow oak and the hermit's shelter are his old stops. Page IV carries the M4 reveal.
- **Someone got out before**: hidden chest (Wayfarer Tunic) -> ls.wreck -> wf.drum -> mq.gate.key. Traces of a skyworks hand, never named.
- **Ama and Cobb**: lk.floats -> lk.lynx -> lk.brother -> wc.cobb -> wc.packs -> lk.supper.
- **Pell**: ow.sea. The child who wants the sky gets the sea.
- **Older than the Wall**: dw.stones -> mq.lk.glyphs -> tw.shrine -> ow.song -> wf.watch.
- **Cleared land**: he.farm, dw.mill, ls.empty, nw.camp, am.stump. The tower side was emptied before the Wall shut (section 7.5).

Memorable picks: The Call Carries, The Board of the Dead, Gullhaven, The Old Gondola, The Record Drum, Slow Words, Pell Sees the Sea, Bears Walk, The Knot on the Key.

## 6. Totals and economy

| region | band | main | side |
|---|---|---|---|
| Tower Hill + meadow | 1 | 4 | 4 |
| Road West + Bend | 1-2 | 3 | 4 |
| heartland east | 2-3 | - | 3 |
| the Downs | 2-3 | - | 5 |
| Long Strand + Gullhaven | 3-4 | - | 6 |
| the Ash Mile | 3-4 | - | 2 |
| Northwood | 4-5 | - | 3 |
| Ford + Crossroads | 4-5 | 3 | 5 |
| Glasswater + North Bank | 4-6 | 3 | 6 |
| Outwall fields | 5-6 | 5 | 8 |
| heartland west | 5-6 | - | 1 |
| the Reedmire | 5-7 | - | 5 |
| the Thornwood | 6-7 | - | 3 |
| Signal Hill + Signal Head | 7-8 | 7 | 4 |
| the Heath coast | 8-9 | - | 3 |
| High Pastures | 8-9 | - | 2 |
| West Fells + Sealed Gate | 9-10 | 2 | 3 |
| the Whitecombs | 5-8 | 2 | 4 |
| **total** | | **29** | **71** |

**100 quests.** Main: 10 in bands 1-5 (Ch1-2), 19 in bands 5-10 (Ch3-6).
Side templates: explore 24, collect 13, kill 12, fetch 7, talk 6, escort 5, deliver 4.
**Heart pieces from quests: 12** (TM, RB, DW, LS, GW, OW x3, RM, TW, SH, HP). Chests carry 12 more (3 in Ch1-2 per MAP-25, 9 to place), 24 = 6 heart vessels (lint: total % 4 == 0).
**Arrows from quests: 145** (shiny 10, packet 20, honey 10, holt 15, sign 10, floats 20, letters 20, piers 10, cave 30), plus the post basket refills. Cap 30 / 50 with the Big Quiver.
**Gear:** T1 x2, T2 x6, T3 x9 (incl. reforged sword, mq.ow.names), T4 x8 (incl. mq.wc.cold, mq.sg.hush), T5 x3, plus named items (cloak, buckler, hood, bow, River Boots, quiver).
**Travel:** Waystone, Bend, Ford, Outwall, North Bank, Signal North, Signal tower (main, 7) + Mire (side).
**Chart pieces:** river, west, coast, line.
**key.gate:** given once, by mq.gate.key.

## 7. ESCALATE TO MANAGER

1. **M4 reveal pick (story.md 7: A, B or C)** - needed before Ch5 texts and Page IV. Recommend A+B.
2. **The call stops (Ch6)** - new canon event; add to GDD 3 as the release ending.
3. **Magic in GDD 3** (gauntlet, Spark, Gust, Ward) - mark "Part II or later" per D-065.
4. **New characters** - section 2b table needs an owner OK.
5. **Cleared land + empty Gullhaven** - the tower side was emptied by Wall Law; Gullhaven stands empty so "smoke means people" stays the Ch3 reveal (answers OQ-MAP-2 that way). Needs a canon nod.
6. **The old gondola** on the Long Strand implies an earlier escape by air. Canon nod.
7. **Fen** - this roadmap follows the removal (D-058); D-062 later brought him back for Ch1 "Not Alone". Confirm; his post-rider role is now Tam's.
8. **Map notes for the designer** - Ch4 needs the river gorge walkable up to Highspring tarn (OQ-MAP-3), band 7-8 there; the Ash Mile stump (x 1760) must be reachable (doc calls it out of bounds); the North Bank relay needs a site in the north bank ruins.
