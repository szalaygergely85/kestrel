# OB-136 audit: early quests vs the river (PO, 2026-10-13)

River centre (design/levels/overworld_far.js riverX): x_r(y) = 1120 + 110 sin(y/260) + 45 sin(y/95+1.3). At y=1034 this is ~1021; at the ford (y 1068) ~1028. Tower side = east (x > ~1035). Water half-width 10. Positions below are from docs/questline-2026-10-10.md (plan values; world_m1.world.json not re-checked).

Finding: the Bend relay (1262,1034) and the packet (1260.6,1034.8) are ~240 m EAST of the river = tower side. They are NOT a crossing. The owner's "second quest brings you here" is the correct tower side; the violation is what the chain does next (mq.river.road -> stones -> west bank).

| # | Quest | Target(s) / position | Side | Violates? |
|---|---|---|---|---|
| 1 | tower.blade | note, Burl (1471,1029), tower door | tower | no |
| 2 | burl.boars | boars in woods near tower | tower | no |
| 3 | m1 q04/q05 | Waystone (1428,1040) | tower | no |
| 4 | m1 q06 The Next Light | roadWest (1340,1048), Bend relay (1262,1033) | tower | no |
| 5 | mq.bend.call | Rook + relay + knot (1262,1034) | tower | no |
| 6 | sq.burl.blue / sq.wreck.plate / sq.rook.shiny (brass 1300-1490) | meadow, tower | tower | no |
| 7 | mq.river.road | area riverBank (1045,1066,r12) | tower bank, edge of water | no (edge; r12 reaches x 1033, still east) |
| 8 | mq.ford.stones | area fordWest (1010,1072,r8) | WEST | YES |
| 9 | mq.ford.mirror | Rook ford east end (1040,1060) ok; nest ~975,1058, Ford Relay (992,1079), boots chest | WEST | YES |
| 10 | mq.smoke | northLook (955,1005), ws_outwall (905,940) | WEST | YES |
| 11 | sq.packet | deliver to post ~1000,1066 | WEST | YES (pickup is tower side) |
| 12 | sq.straw | targets 965-990 x 1085-1100 | WEST | YES |
| 13 | sq.rook.caps | caps 1050-1080 x 1030-1100 | tower (east bank) | no |
| 14 | sq.honey | Burl -> Rook (Bend relay or ford) | tower if Bend | no, pin to Bend |

World map bands: Ford + Crossroads region is rated Lv 4-5 (edge of the gateway), west-bank heartland 5-6.

## Proposals
- Chain gate (main fix): mq.ford.stones, mq.ford.mirror, mq.smoke (Ch2 west bank) start only after the level-5 beat (D-069 Burl fireball). mq.river.road stays as the last early quest and ends with the bark at the east bank; hand-off text: "come back when you are stronger" (Rook line). Free crossing (D-070) stays physically open; only the quest pointers/markers change.
- mq.ford.mirror: if it must stay early, move Rook's nest + mirror to the east bank (existing crossroads-ruin props only exist west; alternative: the Bend relay ridge chest, which exists east), and wake Ford Relay later. Preferred: defer the whole quest (above).
- sq.packet: keep the accept at the packet (1260.6,1034.8); change the deliver target to a tower-side NPC/post (Burl at 1471,1029, or a basket prop by the Waystone 1428,1040). Reuse the original post as a second, later delivery only if wanted.
- sq.straw: move the three targets to the tower-side meadow (e.g. the 1405,1040 / 1465,1047 verge used by brass scraps) or defer past level 5.
- sq.honey: pin the turn-in to Rook at the Bend relay, never the ford.
- Also guard against other "region errands" (not audited in code: not enough call budget): rule for QL authors: any objective x < ~1035 requires the flag set by the level-5 beat.
