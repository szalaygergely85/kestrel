# Quest line, Chapters 1-2 (proposal)

(PC-B writer opus, owner request 2026-10-10; PC-A to ratify)

Owner asks: "we need a proper quest line". Later the same day the owner added: "pick, deliver, get items... easy peasy" side quests, **no dungeon**, and **no magic for now**. The shield (block) and the bow with arrows take magic's place as the gear rewards. This is a proposal only. Nothing in canon, content or code changes until PC-A / the manager ratifies it.

Basis: GDD section 3 (Wick is never named on screen, D-013; the Kestrel; Ferrum; the SOS; the pencil line of relays), story.md (Burl's voice, Ch1 texts, Maren option A as an implied "she"), D-058 / D-060 / D-062 / D-064, and content/quests/*.json.

## 0. Rules this plan keeps

- '!' shows over a giver and '?' over the hand-in target, and only on things you talk to or read. Steps get no world mark; the compass points to them (D-064, D-061).
- Fen is removed (D-058). There are no human NPCs in Ch1-2. The givers are Burl, one new talking animal (Rook, section 3), notes and objects.
- No XP. Rewards are items, heart pieces, arrows, a chart piece, a travel point or lore.
- No dungeon, nothing under the tower and no north-bank entrance. Everything happens in the open world: tower, meadow, road, Bend Relay, river, ford, crossroads, Ford Relay.
- No magic words. The crystal still wakes the relays, because that is built, but nobody calls it magic or aether and there is no spell. Nobody says "Wick".
- Quest conditions today are `flag | item | area | beasts` (game/js/quest/sim/quest.js). Items are a set with no counts, so "collect 5" needs **one new condition `pickups`** that copies `beasts`: `{type:"pickups", ids:[...], count}`, counted from a `pickedUp` list. That is the only new quest-engine code this plan needs.

## 1. Main quest spine

**Why west:** the pencil line on the stolen chart runs from tower to tower toward the blinking light. Someone out here is alive. So "she" could be too (Maren, never named in Ch1-2).
**What the relays are (Ch1 reveal):** a woken relay does not just glow. It **repeats the call**, 3 short, 3 long, 3 short, in time with the far tower. The line is a voice, built to carry the SOS from the far hills toward Ferrum, and it went dead tower by tower.
**Ch2 reveal:** the Ford Relay carries the same cut mark as the humming stones under the Low Wards. The line once reached the city. On the far bank there are fresh signs of people (a trade post, a footpath, smoke).
**Hook:** Ch2 ends looking north at cookfire smoke. People live out here, so Ch3 is the unnamed village (stage 3).

### Chapter 1 "Beyond the Wall" (stages 0-1, mostly built)

| id | title | giver '!' -> hand-in '?' | objectives | reward | status |
|---|---|---|---|---|---|
| tower.blade | A Blade in the Ashes | note `noteKeepLight` (wake spot) -> Burl (1471,1029) | area breach; item sword; area towerDoor | sword (already), Burl met | built |
| burl.boars | Boars in the Woods | Burl -> Burl | beasts boar1..5 | Teal Crystal (`aether.attuned`) | built |
| m1 q04/q05 | Follow the Bear / Awaken the Stone | Burl escort | flag burl.arrived; flag waystone woken | travel point 1, The Waystone (1428,1040) | built |
| m1 q06 | The Next Light | (chain) | area roadWest (1340,1048); area bendRelay; flag ws_roadBend woken | travel point 2, Bend Relay (1262,1033) | built |
| **mq.bend.call** NEW | **The Call Carries** | Rook (perched on Bend Relay) -> Rook | 1. watch the relay pulse (flag `relay.bend.pulseSeen`, set 4 s after the wake); 2. read the knot on the mount (flag `lore.knot.read`); 3. talk to Rook | chart piece "river" (the M card shows the ford) + chapter card | NEW |

**mq.bend.call** is the reveal beat and stands in for Fen's old q07. Code: after the Bend Relay wakes, its light plays the SOS pattern 3 times (the D-013 timings exist for the signal tower; reuse them on this relay's light). Add an inspect prop "knot" on the relay mount and the Rook NPC. Texts:

| key | who | text |
|---|---|---|
| `bark.wick.relayPulse` | YOU | `It's blinking. Three short. Three long.` |
| `bark.wick.relayPulse2` | YOU | `It's passing the call along.` |
| `prompt.knot` | prompt | `[E] Look at the knot` |
| `note.knot.title` | note | `A knot on the brass` |
| `note.knot` (1) | note | `A skyworks hitch. Lamp-trimmers tie it.` |
| `note.knot` (2) | note | `Pulled tight. Weathered grey. Years old.` |
| `rook.meet` (1) | ROOK | `Ha. The fell-bird walks.` |
| `rook.meet` (2) | YOU | `...You talk too.` |
| `rook.meet` (3) | ROOK | `Talk. Count. Keep. Crows do all three.` |
| `rook.meet` (4) | ROOK | `Your stone blinks now. Like the far one.` |
| `rook.meet` (5) | YOU | `It's passing the call along. Toward home.` |
| `rook.meet` (6) | ROOK | `The loud hill? The loud hill never listens.` |
| `rook.meet` (7) | ROOK | `West is the river. The next stone is cold.` |
| `rook.meet` (8) | ROOK | `I will be there first. Wings.` |
| `rook.repeat` | ROOK | `River. West. Do not drown, fell-bird.` |
| `toast.chart.river` | toast | `Chart piece: the river and the ford.` |

`note.knot` is the approved Maren hook ("a lamp-trimmer's knot", story.md section 9.5), moved from a well to the relay mount. Nobody names her. Rook calls Ferrum "the loud hill", which echoes Burl. The final journal line `journalCh1 (6)` stays as it is.

### Chapter 2 "The River and the Forgotten" (stage 2: ford, crossroads, Ford Relay)

| id | title | giver '!' -> hand-in '?' | objectives | reward |
|---|---|---|---|---|
| mq.river.road | The River Road | (chain from mq.bend.call) | area `riverBank` (1045,1066, r 12) | none (bark) |
| mq.ford.stones | Stones in the Water | (chain) | area `fordWest` (1010,1072, r 8): you are across the stepping stones | none |
| mq.ford.mirror | The Missing Glass | Rook (ford, east end of the stones ~1040,1060) -> Ford Relay | 1. talk to Rook; 2. item `relay.mirror` (Rook's nest on the crossroads ruin roof, ~975,1058); 3. flag `waystone.ws_ford.woken` | travel point 3, Ford Relay (992,1079), **River Boots** (feet; in a chest by the nest) |
| mq.smoke | Smoke in the North | (chain) | 1. read the Ford Relay mark (flag `lore.fordMark.read`); 2. area `northLook` (~955,1005, r 10) | chapter card + journal Ch2 |

**mq.ford.mirror:** the Ford Relay is dead and its mirror is missing. A dormant relay's E gives the new hint `hint.relay.nomirror` until the player holds `relay.mirror`. Code: a small `requires` item on the ws_ford waystone in relayWake. The nest is a short climb on Medieval Village ruin props (a broken house; roof reached by rubble steps), so it asks for traversal, not combat. Two wary boars graze nearby (reuse the DRESS-01 pattern).

**mq.smoke:** after the wake, an inspect prop on the relay base shows the mark. A footpath runs north toward ws_outwall (905,940). At `northLook` the player sees smoke columns above the trees. This is the stage 3 boundary: smoke billboards only, no village built.

| key | who | text |
|---|---|---|
| `mq.river.road` | HUD | `Follow the road to the river` |
| `bark.wick.river` | YOU | `Water. Loud as the steam mains.` |
| `mq.ford.stones` | HUD | `Cross the stepping stones` |
| `mq.ford.mirror.1` | HUD | `Ask Rook about the cold relay` |
| `mq.ford.mirror.2` | HUD | `Take the glass from Rook's nest` |
| `mq.ford.mirror.3` | HUD | `Wake the Ford Relay` |
| `rook.ford` (1) | ROOK | `Slow walker. Wet boots?` |
| `rook.ford` (2) | YOU | `The relay here is dead. Its glass is gone.` |
| `rook.ford` (3) | ROOK | `Gone? No. Kept. Kept is different.` |
| `rook.ford` (4) | YOU | `You took it.` |
| `rook.ford` (5) | ROOK | `It fell. I found it. Then it was mine.` |
| `rook.ford` (6) | ROOK | `Old house roof, by the crossing. Take it.` |
| `rook.ford` (7) | ROOK | `I have other shinies. Many.` |
| `hint.relay.nomirror` | toast | `The mount is empty. Glass is missing.` |
| `item.relay.mirror` | item | `Relay Glass` / `Round, silvered, scratched by claws.` |
| `notice.relayFord.title` | notice | `FORD RELAY AWAKENED` |
| `prompt.fordMark` | prompt | `[E] Look at the mark` |
| `note.fordMark.title` | note | `A mark cut in the base` |
| `note.fordMark` (1) | note | `Three rings and a line through them.` |
| `note.fordMark` (2) | note | `The same mark as the stones under the Wards.` |
| `note.fordMark` (3) | note | `The ones that hum.` |
| `mq.smoke` | HUD | `Follow the footpath north` |
| `bark.wick.smoke` | YOU | `Smoke. Cookfires. Out here?` |
| `chapter.card.name` | card | `The River and the Forgotten` |
| `journalCh2` | note | `The relays are not lamps. They are a voice.` / (empty) / `Someone built a line to reach the city.` / `Ferrum stopped answering.` / (empty) / `North of the ford, smoke. People.` / `If people live out here, so could she.` / `- W.` |

## 2. Side quests (simple errands)

Every one is 1-2 objectives: pick up, deliver or fetch, with the reward handed over at the '?'.

| id | title | giver '!' -> hand-in '?' | objectives | reward | where | needs |
|---|---|---|---|---|---|---|
| sq.burl.blue | The Blue Ones | Burl (berry slope, 1471,1029) -> Burl | pickups `berry1..5` (count 5): blue sprigs on bushes | **Smoke-Grey Cloak** (cloak slot) | north meadow below groveNorthWest, 1438-1456 x 998-1014 (wary boars nearby) | `pickups` cond., 5 sprig pickups on existing bushes |
| sq.wreck.plate | Gondola Plate | the Kestrel gondola in the tower (inspect, ground floor) -> gondola | item `boar.hide` (loot any boar) | **Brass Buckler** (shield, block) | tower ground floor (~1496,1024) | gondola as a giver object, shield item + block (new code if missing) |
| sq.rook.shiny | Shiny Things | Rook (Bend Relay) -> Rook | pickups `brass1..4`: Kestrel brass scraps | **Hunter's Bow + 10 arrows** | brass around the tower foot, meadow and road verge (1490,1010), (1465,1047), (1405,1040), (1300,1048) | `pickups`, brass.scrap pickups, bow + arrows (new code) |
| sq.honey | Honey for a Crow | Burl -> Rook (Bend Relay or the ford) | item `honeycomb` (Burl gives it on accept) | 10 arrows + **Rook's Hood** (head) | Burl -> Rook | turnIn on another NPC (exists, tower.blade does it) |
| sq.rook.caps | Red Caps | Rook (ford) -> Rook | pickups `cap1..5`: red-cap mushrooms | heart piece 2 | forest edge on the east riverbank, 1050-1080 x 1030-1100 | `pickups`, mushroom pickup prop (new small model or recolour) |
| sq.packet | The Oilcloth Packet | packet in the Bend Relay base (read) -> trade post at the ford | item `packet` (taken on accept), deliver to the post | 20 arrows in the post's basket + lore | Bend Relay -> post on the west bank by the crossroads (~1000,1066) | post + basket prop (village props), packet item |
| sq.straw | Three Straw Men | note on a target post (crossroads) -> the post | flags `target1..3.hit` (arrow hits) | Big Quiver (arrow cap +20) | three straw targets, crossroads field ~965-990 x 1085-1100 | arrow hit -> flag (needs the bow) |

Unlocks: sq.burl.blue and sq.wreck.plate open after burl.boars is handed in. sq.rook.shiny and sq.packet open after mq.bend.call. sq.honey opens after both. sq.rook.caps opens after mq.ford.mirror. sq.straw opens once the player has the bow. Heart pieces: 4 make a heart (`heart.piece`). One comes from sq.rook.caps and three sit in chests (meadow grove, Bend Relay ridge, crossroads ruin), so the first full heart vessel lands in Ch2. The chest behind `scrawl.hiddenChest` (FOR THE NEXT ONE OUT) holds the **Wayfarer Tunic** (body), left by someone who got out before.

### Equipment (owner 2026-10-10: "we need to be able to dress")

The PO turns this into an equipment story. Every outfit piece is visible on the player model (chargen pieces, D-063 style) and gives a small passive. No stats screen and no XP.

| slot | Ch1-2 items (source) | effect (proposal) |
|---|---|---|
| main hand | Ruin Steel (tower.blade) | melee |
| offhand | Brass Buckler (sq.wreck.plate) | block |
| ranged | Hunter's Bow (sq.rook.shiny); arrows as ammo, Big Quiver raises the cap | shoot |
| head | Rook's Hood (sq.honey) | cosmetic + rain look |
| body | Wayfarer Tunic (hidden chest); start = Low Ward work shirt | small damage cut |
| cloak | Smoke-Grey Cloak (sq.burl.blue) | warmth at night (ties to day/night, D-064) |
| feet | River Boots (mq.ford.mirror) | sure footing on wet stepping stones |

Needs: equip slots in the inventory/equip screen (US-091 exists as a base), chargen pieces for the hood, tunic, cloak and boots, and the item-get card. Later armour uses the same body/head slots.

| key | who | text |
|---|---|---|
| `burl.blue.done` (2) REPLACE | BURL | `A cloak was on my slope. Smells of smoke.` |
| `burl.blue.done` (3) | BURL | `Yours, I think. Nights get cold, sky-cub.` |
| `item.cloak` | item | `Smoke-Grey Cloak` / `Wool, singed at the hem. Warm.` |
| `rook.honey.done` (3) | ROOK | `And this. On a branch. Fits a fell-bird.` |
| `item.hood` | item | `Rook's Hood` / `Dark cloth, one black feather sewn in.` |
| `item.boots` | item | `River Boots` / `Greased leather. Wet stones, sure feet.` |
| `item.tunic` | item | `Wayfarer Tunic` / `Patched twice. Left for the next one.` |

### Side quest texts (draft)

| key | who | text |
|---|---|---|
| `burl.blue.offer` (1) | BURL | `The boars trampled half my bushes, sky-cub.` |
| `burl.blue.offer` (2) | BURL | `The blue sprigs by the north trees still stand.` |
| `burl.blue.offer` (3) | BURL | `Five would do. Don't eat any. I'll know.` |
| `burl.blue.active` | BURL | `Blue ones. North trees. Five. I'm counting.` |
| `burl.blue.done` (1) | BURL | `Oh, look at them. Not one nibbled.` |
| `burl.blue.done` (2) | BURL | `Found this in the roots. Warm. Yours.` |
| `sq.burl.blue` | HUD | `Pick five blue sprigs` |
| `item.heart.piece` | item | `Heart Piece` / `A warm red stone. Four make a heart.` |
| `prompt.gondola` | prompt | `[E] Look at the gondola` |
| `note.gondola` (1) | note | `The side plate hangs by one rivet.` |
| `note.gondola` (2) | note | `Bent round. Light. A strap would hold it.` |
| `sq.wreck.plate` | HUD | `Find hide for a strap` |
| `toast.buckler` | toast | `Brass Buckler. Hold right mouse to block.` (the binding follows the controls story) |
| `rook.shiny.offer` (1) | ROOK | `Your sky-boat dropped shinies. Everywhere.` |
| `rook.shiny.offer` (2) | ROOK | `Four brass bits. Bring them. I trade fair.` |
| `rook.shiny.done` (1) | ROOK | `One, two, three, four. Good count.` |
| `rook.shiny.done` (2) | ROOK | `A bow, from the river. Not shiny. Yours.` |
| `sq.rook.shiny` | HUD | `Find four brass scraps` |
| `burl.honey.offer` (1) | BURL | `That crow on the old stone. Loud thing.` |
| `burl.honey.offer` (2) | BURL | `Take it this comb. Tell it we're square.` |
| `rook.honey.done` (1) | ROOK | `Sticky. From the bear? Hm. Square, then.` |
| `rook.honey.done` (2) | ROOK | `Sticks with feathers. Hunters lose them.` |
| `sq.honey` | HUD | `Bring Burl's honeycomb to Rook` |
| `rook.caps.offer` | ROOK | `Red caps grow by the water. Five. I'm hungry.` |
| `rook.caps.done` | ROOK | `Red, red, red, red, red. Take this. Warm stone.` |
| `sq.rook.caps` | HUD | `Pick five red caps by the river` |
| `note.packet.title` | note | `Oilcloth, tied with twine` |
| `note.packet` (1) | note | `Stitched on the cloth: FOR THE FORD POST.` |
| `note.packet` (2) | note | `It has waited here a long time.` |
| `sq.packet` | HUD | `Leave the packet at the ford post` |
| `note.post` (1) | note | `A basket on a post. Arrows inside, and a tag:` |
| `note.post` (2) | note | `TAKEN. LEAVE WHAT YOU CAN SPARE.` |
| `note.straw` (1) | note | `Three straw men. Three arrows. Three hits.` |
| `note.straw` (2) | note | `The quiver under the post is for whoever can.` |
| `sq.straw` | HUD | `Hit the three straw men` |

The `TAKEN` tag in the post's basket is fresh, unsigned handwriting. It is the second sign of people, alongside the smoke, and it names nobody.

## 3. Second talking animal: Rook (proposal)

**Rook**, an old crow, uses the existing bird model scaled up and recoloured black with a grey beak. That is a designer check. Rook speaks in short clipped words and counts things. Rook keeps shiny things and trades fairly. He calls Wick "fell-bird" (a bird that fell) and Ferrum "the loud hill", which he shares with Burl. He knows the line by sight: "stones", "the far one". He never says "Wick" and never says magic.

Rook fits canon: GDD 3 lists talking animals in M2-M3. In Ch1 he sits on the Bend Relay. In Ch2 he is at the ford ("I will be there first. Wings."), so he is a moving giver. That is one NPC entity per stage, or a position switch on a flag.

## 4. Content and code needs (existing vs new)

- **Exists:** giver flow + turnIn on another NPC, notes as givers, `area`/`flag`/`item`/`beasts` conditions, waystone/relay wake + travel, the crystal, boars + loot (`boar.hide`), sword, chests, item-get card, `heart.piece` item def, bird/fox/deer/rabbit models, village props, stepping stones (D-064), compass.
- **New, small:** `pickups` condition (count over unique pickup ids) plus a generic `pickup` prop; the Rook NPC + `rook.dialogue.json`; relay SOS pulse after the wake (reuse the D-013 timings); a `requires` item on ws_ford; inspect props (knot, ford mark, gondola, post, packet); area zones `riverBank`, `fordWest`, `northLook`; smoke billboards north; heart-piece -> heart vessel at 4.
- **New, larger (owner gear call):** the shield + block, and the bow + arrows (aim, projectile, arrow count, hit -> flag, pickup refill). These are engine/entities work and need an architect note first.
- **Text cleanup:** `note.leave` (4) "Something moves beneath the tower." and `note.steelHush` (6) hint at something under the tower. With no dungeon, propose rewording them to the outside (for example "Something walks the woods at night."). That is a story.md change for the writer after ratification.

## 5. Owner questions (recommended default in brackets)

1. Does Burl go back to her berry slope (1471,1029) after the Waystone, so she can give errands? [Yes: she "walks into the forest" and is found home again later.]
2. Add Rook the crow as the second talking animal, at the Bend Relay in Ch1 and the ford in Ch2? [Yes.]
3. Keep the crystal waking the relays, just never called magic? [Yes. It is built and reads as an old mechanism.]
4. Gate the Ford Relay behind the missing glass from Rook's nest (a short climb)? [Yes. It is the Ch2 main-quest task.]
5. Arrows: found, rewarded and refilled at chests/posts only, with no buying while there is no currency, a cap of 30 (50 with the Big Quiver), and arrows that stick and can be picked up again? [Yes.]
6. Outfit pieces: visible on the player and each with one small passive (cloak = warm at night, boots = sure footing), and heart pieces at 4 per heart (1 quest + 3 chests)? [Yes.]

## 6. Build order

1. `pickups` condition + generic pickup prop + tests (Node-first). Unlocks 4 errands.
2. Equipment slots story (PO): head/body/cloak/feet/offhand/ranged in the equip screen + chargen pieces. Then sq.burl.blue (Burl's return + sprigs + cloak), which is data + dialogue only.
3. Rook NPC + `rook.dialogue.json` + mq.bend.call (relay SOS pulse, knot inspect, chart piece).
4. sq.wreck.plate + shield/block. Architect note first, then sq.honey (data only).
5. Bow + arrows (architect note) -> sq.rook.shiny, sq.packet, sq.straw.
6. Ch2 main: riverBank/fordWest zones -> mq.ford.mirror (crossroads ruin + nest, relay `requires`) -> mq.smoke (mark, footpath, smoke, journal, chapter card).
7. sq.rook.caps + the two heart-piece chests, then one owner walk of Ch1-2.
