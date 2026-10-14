# QFIX-S5 - quest givers and hand-ins (D-082, D-087, OB-155l/m/n, OB-156)

PO (sonnet), 2026-10-14. Source: `content/quests/*.json`, `ch12/pack.json`, `ch3/pack.json`, `ch3b/pack.json`, `regions/pack.json`.
Today most pack quests only have `site` (where they start), not a character. Proposal: every quest gets explicit `giver` and `turnIn` ids
(existing root-quest field names; `tower.blade` already has `turnIn: "bear"`). An object giver also gets `objectGiver: true` (D-087).

## Rules
- Counted givers: all quests with a giver = 44 (ch12) + 14 (ch3) + 6 (ch3b) + 10 (regions) + 8 root quests = **82**. m1 (q01..q06) is the story chain (scripted opening, Burl in the middle), not counted; its beats keep Burl as the speaker.
- Object givers allowed: 5-10 % = **4-8 of 82**. Proposal: **6 (7.3 %)**. Lint fails above 10 % (> 8).
- Every object giver: a visible anchor (note / item model on the ground, QFIX-S1/S2 R13), Accept / Exit on read or pick-up, a `?` at the return, and a CHARACTER as `turnIn`.
- Every character giver/turn-in stands on walkable ground (R12, OB-147) and hands in with a talk (reward given there, no auto hand-in).
- Characters: **Burl** (bear, tower/waystone), **Rook** (trader at the road bend), **Hesk** (Outwall farm), **Dorrin** (Outwall forge), **Post-keeper** (NEW, beside the crossroads post / notePost). NEEDS WRITER: name + 12-18 lines (offer / done) for the Post-keeper; NEEDS DESIGNER: a Post-keeper voxel (reuse the human base of Hesk/Dorrin with a new palette + hat is enough, no new model kit).

## The 6 object givers (kept on purpose)
| Quest | Object | Why it works | Turn-in |
|---|---|---|---|
| sq.packet | oilcloth packet on the ground (found item) | a lost parcel, pick-up = Accept/Exit | Post-keeper |
| sq.wreck.plate | gondola plate at the wreck (found item) | pure exploration find | Rook |
| sq.post.spare | scrawled note on the post | one of the "notes can stay" cases | Post-keeper |
| sq.fc.shrine | weathered note at the notePost | note | Post-keeper |
| sq.rb.shield | shield left at the bend (found item) | item story, turn-in at the ford | Post-keeper |
| sq.ow.parcel | parcel left at the Outwall board (found item) | item, delivered by hand | Dorrin |

## Table: Chapters 1-2 (S5a)
| Quest | Today (site) | Giver -> turn-in | Note |
|---|---|---|---|
| tower.blade | start | story start (no giver) -> Burl (`turnIn: bear`) | keep; opening beat |
| burl.boars | root | Burl -> Burl | |
| sq.burl.blue | root, giver in data | Burl -> Burl | |
| mq.bend.call | root, giver in data | Rook -> Rook | returnText "Talk to Rook" |
| mq.ford.mirror | root, giver in data | Rook -> Rook | gets Accept/Exit + hand-in |
| mq.ford.stones | root | Burl -> Burl | starts only after the level-5 beat (D-095) |
| mq.smoke | root | Burl -> Burl | same beat |
| mq.river.road | root | Rook -> Rook | ends on the east bank, "come back stronger" (D-095) |
| sq.tm.nub, sq.burl.boars.n/w/s, sq.burl.meat, sq.burl.stone, sq.burl.hint, sq.burl.tower, sq.burl.scout, sq.burl.ask, sq.burl.walk, sq.burl.parcel, sq.tm.gap, sq.tm.wood, sq.tm.cart, sq.he.farm, sq.dw.bees, sq.dw.stones, sq.honey, sq.burl.fire | burl | Burl -> Burl | 20 quests; too many for one NPC? Accepted: they unlock in sequence (`requires`), never all at once |
| sq.he.wallow, sq.fc.caps, sq.fc.well, sq.fc.ask, sq.rook.gift, sq.rook.shiny | rook | Rook -> Rook | 6 |
| sq.rb.regards, sq.rb.road, sq.rb.lamps, sq.rb.rocks, sq.rb.parcel | relayBend (waystone) | Rook -> Rook | waystone is never a giver (D-082); Rook stands at the bend (mq.bend.call precedent). Programmer checks Rook's real position; if > 40 m from the Bend waystone, move these to the Post-keeper |
| sq.fc.ford, sq.fc.smoke, sq.fc.cross, sq.fc.again, sq.fc.jetty, sq.fc.cog | relayFord (waystone) | Post-keeper -> Post-keeper | 6 |
| sq.fc.stores, sq.straw, sq.fc.sign | post / notePost | Post-keeper -> Post-keeper | straw hand-in was at notePost (object) -> now the keeper |
| sq.packet, sq.wreck.plate, sq.post.spare, sq.fc.shrine, sq.rb.shield | object | see the object table | 5 of the 6 |

## Table: Chapter 3 Outwall (S5b)
| Quest | Today | Giver -> turn-in |
|---|---|---|
| mq.ow.path, mq.ow.fence | no giver | Hesk -> Hesk (Accept/Exit + hand-in) |
| mq.ow.names, mq.ow.relay | hesk | Hesk -> Hesk |
| mq.ow.board | owBoard | Hesk -> Hesk |
| sq.ow.wolves, sq.ow.boars, sq.ow.barley, sq.ow.range, sq.ow.raid, sq.ow.night, sq.ow.letters, sq.ow.song | owBoard / hesk | Hesk -> Hesk (song: Dorrin as target) |
| sq.hw.piers, sq.ow.ford | pierStone | Dorrin -> Dorrin |
| sq.ow.bears, sq.ow.trail | owBoard | Dorrin -> Dorrin ("the forge hands out odd jobs"; NEEDS WRITER to adjust the offer lines from "the board") |
| sq.ow.news | dorrin | Dorrin -> Dorrin |
| sq.ow.parcel | owBoard | OBJECT (above) -> Dorrin |

No new NPC for S5b. Notice board = decoration only (no giver). Hesk carries 13 quests, sequenced by `opensAfter`.

## Table: regions (S5c)
10 region quests (sq.reg.*) give and return at the waystone bowl today. New: one **region NPC** within 12 m of each waystone gives and takes it (waystone stays target + heal/save/travel).
| Quest | Waystone | NPC (names NEEDS WRITER) |
|---|---|---|
| sq.reg.glasswater, northwood, highPastures, ashMile, downs, signalHill, heath, reedmire, strand, whitecombs | relay_<id> | 10 NPCs, one each |
Designer: 3 body variants x palettes (hunter, herder, ferryman/shore-walker) = 10 looks with distinct hats/colours; reuse the human voxel base. Writer: per NPC 1 offer + 1 done line, lines <= 56 chars, no relay word (D-080), no "Wick" (D-013).

## Result
Object givers 6 of 82 = 7.3 %. Characters: Burl 24 (burl.boars, blue, stones, smoke + 20 side quests; plus the opening turn-in), Rook 14 (+1 object return), Post-keeper 9 (+4 object returns), Hesk 13, Dorrin 6 (+1 object return), 10 region NPCs.

## Order
S5a-1 (data + lint support) -> S5a-2 (Burl) / S5a-3 (Rook + mains) / S5a-4 (Post-keeper + object givers) -> S5a-5 (whole-set test). S5b and S5c reuse the S5a pattern. Needs QFIX-S3 (single marker per entity) and S4 (hand-in order) first.
