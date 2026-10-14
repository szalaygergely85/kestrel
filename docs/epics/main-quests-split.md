# Main story split into short quests (D-103, D-104, D-105, D-106)

PO (sonnet, PC-B), 2026-10-14. Sources: `content/quests/m1.quest.json`, `tower.blade`, `burl.boars`, `mq.*.quest.json`, `ch12/pack.json`, `ch3/pack.json`, `ch3b/pack.json`, `regions/pack.json`, `docs/epics/qfix-s5-givers.md`, `docs/story.md` (q01-q06, QL-W1, Ch3 main, quest-giver NPCs), `game/js/quest/giverNpcs.js`, `docs/epics/ep-items-stats.md` section 9.

## Rules used (owner)
- **D-103:** no auto-step chain. Every main quest is a short WoW quest: giver `!` -> offer window (Accept / Decline) -> 1-3 objectives -> `?` -> hand-in window (Complete + reward). Gold = main. The only object giver in the main line is the tower note (opening).
- **D-104:** quests are separate chains. A main quest `requires` exactly the previous main quest (done). A side quest has NO `requires`, except step 2+ of a side chain, which requires the previous quest of its own chain. `opensAfter` is treated the same as `requires` (removed unless it is the chain link).
- **D-105 / D-106:** pacing uses `minLevel` (data only). The level is the PLAYER-LEVEL-01 gear formula (ep-items-stats section 9), **hidden**: never shown, no "Level N", no "Requires level" text. Under the level: no `!`, the quest is not offered, and the giver may say a "come back when you're stronger" line instead. `minLevel` is checked only when the quest is offered/accepted; an accepted quest is never re-locked (the level can drop when gear comes off). Zones: near side 1-5, far side (west bank) 5-10.
- **D-098** markers unchanged: `!` take, grey `?` until done, gold `?` ready; for reach/wake/use objectives the `?` hangs over the place itself while that objective is active (old m1 `mark.end` anchors kept: doorMarker, endMarker, relayBend). After a hand-in the same character offers the next main quest right away.
- **D-020 / D-078:** rewards are small items from existing defs, no XP.
- **Giver presence is not a prerequisite:** where a character stands (Burl at home vs escorting, Rook's spot, Tobin hidden until `mq.smoke` done, `GIVER_GATES`) is NPC state, not quest data. It stays.
- A character with both offers shows the main offer first in the talk list, then side offers.

## 1. New main quests, in story order

The old m1 step `wake` is not an objective: it is the intro (flag `wake`); the note that gives quest 1 is pinned behind the wake spot. All other m1 steps are objectives below.

| # | id | Title | Giver | Turn-in | Objectives | Reward | Requires | minLevel | Reuses (keys) | NEEDS WRITER |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `mq.tower` (replaces `tower.blade` + m1 q01/q02) | A Blade in the Ashes | tower note `noteKeepLight` (object, the 1 allowed) | Burl | reach `breach` (m1 breach); take `sword` (m1 sword); reach `towerDoor`, `?` on doorMarker (m1 leave) | potion.hp x1 | none (story start) | 1 | offer = `note.keepLight`; HUD `m1.breach/sword/leave`; journals of `tower.blade`; `bark.wick.sword`, `toast.door.open`, `bark.wick.meadow`, `bear.call` (bark); active at Burl `bear.early`, `bear.blade.wait`; hand-in `bear.meet` (+ `bear.crash` branch) | - |
| 2 | `mq.boars` (replaces `burl.boars` + m1 q03) | Boars in the Woods | Burl | Burl | kill 5 boars (`boar1..5`) (m1 beasts) | Teal Crystal `aetherCrystal` x1 + flag `aether.attuned` (granted at hand-in, PO-CH1-13) | mq.tower | 1 | `bear.q.offer`, `bear.q.choice.*`, `bear.q.accepted`, `bear.q.later`, `bear.q.active`, `bear.q.ready` (with the PO-CH1-13 gift lines 4-7 from story.md q04 OPEN), `bear.q.thanks`; journal `quest.burl.boars.beasts` | `toast.crystal.found` reword: given by Burl, not "under the last boar" (<= 38) |
| 3 | `mq.stone` (m1 q04 + q05) | The Old Stone | Burl | Burl (at the stone) | follow Burl to the stone (flag `burl.arrived`) (m1 follow); wake the waystone (flag `waystone.waystone.woken`, `?` on endMarker) (m1 waystone) | potion.hp x1 (travel unlock comes from the stone) | mq.boars | 1 | offer `bear.follow`; active `bear.following`, `bear.wait`, `bear.walk1/2`; arrival `bear.stone`, `bear.stone.again`; `prompt.stone.wake`, `notice.waystone`; hand-in `bear.woken` (1-5) | - |
| 4 | `mq.road` (m1 q06) | The Road West | Burl | Rook at the Bend | reach `roadWest` (m1 road); reach `bendRelay` (m1 relayFound); wake the Bend waystone (flag `waystone.ws_roadBend.woken`, `?` on relayBend) (m1 relay1) | potion.hp x2 | mq.stone | 1 | offer `bear.woken` (6-13); active `bear.departing`; journal `m1.section.q06.desc`; `bark.wick.relay`, `hint.relay.nocrystal`, `notice.relay`; hand-in `rook.meet` (1-7) | - |
| 5 | `mq.bend.call` (kept) | The Call Carries | Rook (Bend) | Rook (Bend) | watch the pulse (flag `relay.bend.pulseSeen`); read the knot (flag `lore.knot.read`) | chart.river x1 | mq.road | 1 | offer `rook.meet` (8); active `rook.call.active`; `bark.wick.relayPulse/2`, `note.knot`; hand-in `rook.call.ready` (1-5) + Ch1 card + `journalCh1` | - |
| 6 | `mq.river.road` (kept) | The River Road | Rook (Bend) | Rook (east bank, by `riverBank`) | reach `riverBank` | potion.hp x1 | mq.bend.call | 1 | offer `rook.call.ready` (6); active `rook.repeat`; `bark.wick.river`; hand-in `rook.road.stronger` | 1 offer line (Rook); 1 hand-in line after `rook.road.stronger` pointing to the bear ("the bear knows fire") |
| 7 | `mq.ember` (was side `sq.burl.fire`) | Burl's Ember | Burl | Burl | collect 3 `emberpod` in Cinder Hollow | Fireball (spellbook, D-099/D-100) + potion.mp x1 | mq.river.road | 5 | `sq.burl.fire` lines offer/active/ready/done | offer line 1 "Salt in my larder" refers to a side quest -> reword; under-level line for Burl ("come back stronger", <= 56) |
| 8 | `mq.ford.stones` (kept) | Stones in the Water | Burl | Rook (west bank, today's spot) | reach `fordWest` (cross the stepping stones) | arrow x10 | mq.ember | 5 | hand-in `rook.ford` (1-2) | 1-2 offer lines (Burl sends you over the river); 1 active line (Burl) |
| 9 | `mq.ford.mirror` (kept) | The Missing Glass | Rook | Rook | take `relay.mirror`; wake the Ford waystone (flag `waystone.ws_ford.woken`) | potion.hp x2 | mq.ford.stones | 5 | offer `rook.ford` (3-7); active `rook.mirror.active`; `hint.relay.nomirror`, `notice.relayFord.title`; hand-in `rook.mirror.done` | - |
| 10 | `mq.smoke` (kept) | Smoke in the North | Rook | Rook | read the mark (flag `lore.fordMark.read`); reach `northLook` | arrow x10 | mq.ford.mirror | 5 | offer `rook.ford.repeat`; `note.fordMark`, `bark.wick.smoke`; Ch2 card + `journalCh2` stay where they fire today | 1 offer line; 1-2 hand-in lines (Rook: smoke means people) |
| 11 | `mq.ow.fence` (merges `mq.ow.path` + `mq.ow.fence` + `mq.ow.names`) | Wolves at the Fence | Rook | Hesk | reach `owPath` (the track to the smoke); kill 5 wolves (`wolf1..5`) | gear table `gear.t3` (from mq.ow.names) | mq.smoke | 5 | journals of mq.ow.path / mq.ow.fence; hand-in = `mq.ow.names` lines offer + ready ("Stop there..." ... "Come in, Wick"), done line | 1 offer line (Rook) |
| 12 | `mq.ow.relay` (kept) | The Village Waystone | Hesk | Hesk | ask Dorrin (flag `talk.dorrin`); take `relay.brass`; wake the village waystone (flag `waystone.ws_outwall.woken`) | potion.hp x2 | mq.ow.fence | 5 | lines offer/active/ready; hand-in = `done` line | - |
| 13 | `mq.ow.board` (kept) | The Board of the Dead | Hesk | Hesk | read the board (flag `lore.owBoard.read`) | chart.westFells x1 | mq.ow.relay | 5 | lines offer/active/ready (board narration) | 1 hand-in line (Hesk) |

Notes
- **Rook's spots (needed for 4-11):** A = Bend (until `mq.river.road` is accepted), B = east bank by `riverBank` (while `mq.river.road` is active/ready; "I will be there first. Wings."), C = west bank, today's spot (975, 1054) (after `mq.river.road` is done). Spot switch = hide/show, like `GIVER_GATES`.
- **The river gate (D-095) now lives in the chain:** `mq.ember` and everything after it have `minLevel 5`. Until then Burl has no gold `!` and says the under-level line; Rook's `rook.road.stronger` already tells the player why.
- **Burl's crystal (PO-CH1-13)** moves from the last-boar burst to the `mq.boars` hand-in.
- Retired ids: `m1`, `tower.blade`, `burl.boars`, `sq.burl.fire`, `mq.ow.path`, `mq.ow.names` (save migration below; `m1.legacy` test fixture stays).

## 2. Save migration (pure function, runs once after `migrateM1Ch1`, sets `save.mqSplit = 1`, idempotent)

Last m1 step done (old `quest.completed`) -> new states. "per book" = copy the old book entry state + progress (offered / active / ready / done).

| m1 last done | mq.tower | mq.boars | mq.stone | mq.road | Other |
|---|---|---|---|---|---|
| none / `wake` | per `tower.blade` book (none -> offered by the note) | - | - | - | |
| `breach` | active, breach done (or `tower.blade` state if further) | - | - | - | |
| `sword` | active, breach + sword done | - | - | - | |
| `leave` | ready (hand in to Burl); done if `tower.blade` done | per `burl.boars` book (kill count kept) | - | - | |
| `beasts` | done | done; ensure `aetherCrystal` + `aether.attuned` | offered (active if flag `s.burl.follow` set) | - | |
| `follow` | done | done | active, follow done | - | |
| `waystone` | done | done | done | active (the old chain had it running) | |
| `road` | done | done | done | active, road done | |
| `relayFound` | done | done | done | active, road + relayFound done | |
| `relay1` | done | done | done | done | `mq.bend.call` per book (none -> offered by Rook) |

Other quests:
- `sq.burl.fire` any state -> `mq.ember` same state + progress; fireball unlock flag kept.
- `mq.ow.names` done -> `mq.ow.fence` done. Else old `mq.ow.fence` ready/done or `mq.ow.names` offered/active -> `mq.ow.fence` ready. Else old `mq.ow.path` done -> `mq.ow.fence` active (owPath done, wolf count from the old fence). Else old `mq.ow.path` active -> `mq.ow.fence` active.
- Kept main ids keep their book state. If a save has `mq.river.road` done before `mq.bend.call` (parallel today), nothing is undone; Rook's spot follows the most advanced done quest.
- No retro rewards for the new quests 1-4 (only the crystal, which the story needs). The `m1` tracker is dropped; the tracked quest = the active main quest.

## 3. Audit of every quest's `requires` (D-104) and `minLevel` (D-105)

minLevel rule for side quests: west-bank site (relayFord, Rook spot C, Outwall) or an old `sq.burl.fire` gate -> **5** (far-side errands with tougher beasts -> 6); otherwise `max(1, band - 1)`. Region quests: the far-side five -> 5; the other five -> the band.js zone level at their waystone (programmer fills the number, Node test pins it).
"none" = remove `requires` / `opensAfter` entirely. The flag `burl.home` is Burl's state (she offers side quests only when at home), not a quest prerequisite.

### Main (old ids)
| Quest | Today requires / opensAfter | New requires | minLevel | Change |
|---|---|---|---|---|
| m1 | - | - | - | retired (section 2) |
| tower.blade | storyStart | -> mq.tower: none | 1 | rename + main |
| burl.boars | tower.blade done | -> mq.boars: mq.tower | 1 | rename + main |
| mq.bend.call | m1 step relay1 | mq.road | 1 | |
| mq.river.road | m1 step relay1 | mq.bend.call | 1 | was parallel with bend.call |
| sq.burl.fire | opensAfter mq.river.road | -> mq.ember: mq.river.road | 5 | becomes main |
| mq.ford.stones | river.road step riverBank + sq.burl.fire done | mq.ember | 5 | fire gate -> minLevel |
| mq.ford.mirror | bend.call done + ford.stones step fordWest | mq.ford.stones | 5 | |
| mq.smoke | ford.mirror done | mq.ford.mirror | 5 | |
| mq.ow.path | smoke step north + sq.burl.fire done | -> merged into mq.ow.fence: mq.smoke | 5 | merged |
| mq.ow.fence | ow.path step explore | mq.smoke | 5 | now holds path + names |
| mq.ow.names | ow.fence step kill | - | - | merged (hand-in of mq.ow.fence) |
| mq.ow.relay | ow.names done | mq.ow.fence | 5 | |
| mq.ow.board | ow.relay done | mq.ow.relay | 5 | |

### Side chains (requires = previous of the chain)
| Chain | Order |
|---|---|
| Burl boar hunt | sq.burl.boars.n -> sq.burl.boars.w -> sq.burl.boars.s -> sq.burl.scout -> sq.burl.ask |
| Burl stone | sq.burl.stone -> sq.burl.hint |
| Burl meat | sq.burl.meat -> sq.burl.parcel -> sq.post.spare |
| Burl farm | sq.tm.gap -> sq.tm.wood -> sq.tm.cart (today wood and cart both need gap: made linear) |
| Bees | sq.dw.bees -> sq.dw.stones |
| Straw field | sq.straw -> sq.fc.shrine |
| Rook bend | sq.rb.shield -> sq.rb.regards -> sq.rb.road (today both need shield: made linear) |
| Rook lamps | sq.rb.lamps -> sq.rb.rocks -> sq.rb.parcel |
| Ford post A | sq.fc.ford -> sq.fc.smoke -> sq.fc.cross -> sq.fc.again |
| Ford post B | sq.fc.ford -> sq.fc.jetty -> sq.fc.cog (branch: each step still has one previous) |
| Rook ask | sq.fc.ask -> sq.rook.gift |
| Outwall wolves | sq.ow.wolves -> sq.ow.night -> sq.ow.bears |

### Side quests (all)
| Quest | Band | Today requires / opensAfter | New requires | minLevel |
|---|---|---|---|---|
| sq.burl.blue | - | burl.boars done + burl.home | none | 1 |
| sq.tm.nub | 1 | burl.boars + burl.home | none | 1 |
| sq.burl.boars.n | 1 | burl.boars + burl.home | none (chain head) | 1 |
| sq.burl.boars.w | 1 | + boars.n | sq.burl.boars.n | 1 |
| sq.burl.boars.s | 2 | + boars.w | sq.burl.boars.w | 1 |
| sq.burl.meat | 1 | burl.boars + burl.home | none | 1 |
| sq.burl.stone | 1 | burl.boars + burl.home | none | 1 |
| sq.burl.hint | 1 | + burl.stone | sq.burl.stone | 1 |
| sq.burl.tower | 1 | burl.boars + burl.home | none | 1 |
| sq.burl.scout | 2 | + boars.s + sq.burl.fire | sq.burl.boars.s | 5 |
| sq.burl.ask | 4 | + burl.scout | sq.burl.scout | 3 |
| sq.burl.walk | 1 | burl.boars + burl.home | none | 1 |
| sq.burl.parcel | 2 | + burl.meat | sq.burl.meat | 1 |
| sq.post.spare | 4 | + burl.parcel | sq.burl.parcel | 3 |
| sq.straw | 5 | sq.tm.nub | none | 4 |
| sq.rb.shield | 2 | m1 relay1 + sq.burl.fire | none | 5 |
| sq.rb.regards | 2 | m1 relay1 + rb.shield | sq.rb.shield | 1 |
| sq.rb.road | 2 | m1 relay1 + rb.shield | sq.rb.regards | 1 |
| sq.fc.ford | 4 | river.road riverBank + sq.burl.fire | none | 5 |
| sq.fc.smoke | 5 | riverBank + fc.ford | sq.fc.ford | 5 |
| sq.fc.cross | 5 | riverBank + fc.smoke | sq.fc.smoke | 5 |
| sq.fc.again | 4 | riverBank + fc.cross | sq.fc.cross | 5 |
| sq.tm.gap | 1 | burl.boars + burl.home | none | 1 |
| sq.tm.wood | 1 | + tm.gap | sq.tm.gap | 1 |
| sq.tm.cart | 1 | + tm.gap | sq.tm.wood | 1 |
| sq.rb.lamps | 2 | m1 relay1 | none | 1 |
| sq.rb.rocks | 2 | relay1 + rb.lamps | sq.rb.lamps | 1 |
| sq.rb.parcel | 2 | relay1 + rb.rocks + sq.burl.fire | sq.rb.rocks | 5 |
| sq.he.wallow | 2 | riverBank + sq.burl.fire | none | 5 |
| sq.he.farm | 3 | burl.boars + burl.home + burl.scout | none | 2 |
| sq.dw.bees | 2 | burl.boars + burl.home + burl.scout | none | 1 |
| sq.dw.stones | 3 | + dw.bees | sq.dw.bees | 2 |
| sq.fc.stores | 5 | riverBank | none | 4 |
| sq.fc.caps | 4 | riverBank + sq.burl.fire | none | 5 |
| sq.fc.well | 4 | riverBank + sq.burl.fire | none | 5 |
| sq.fc.shrine | 4 | riverBank + sq.straw | sq.straw | 3 |
| sq.fc.jetty | 4 | riverBank + fc.ford | sq.fc.ford | 5 |
| sq.fc.cog | 5 | riverBank + fc.jetty | sq.fc.jetty | 5 |
| sq.fc.ask | 4 | riverBank + burl.boars + burl.home + sq.burl.fire | none | 5 |
| sq.rook.gift | 5 | riverBank + burl.boars + burl.home + fc.ask | sq.fc.ask | 5 |
| sq.wreck.plate | 2 | burl.boars | none | 1 |
| sq.honey | 3 | opensAfter mq.bend.call | none | 2 |
| sq.rook.shiny | 3 | opensAfter mq.bend.call + sq.burl.fire | none | 5 |
| sq.packet | 3 | opensAfter mq.bend.call | none | 2 |
| sq.hw.piers | (ch3 5-10) | opensAfter mq.ford.mirror | none | 5 |
| sq.fc.sign | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.wolves | (ch3) | opensAfter mq.ford.mirror | none (chain head) | 5 |
| sq.ow.boars | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.parcel | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.ford | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.barley | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.range | (ch3) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.raid | (ch3) | opensAfter mq.ford.mirror | none | 6 |
| sq.ow.night | (ch3b) | opensAfter sq.ow.wolves | sq.ow.wolves | 6 |
| sq.ow.bears | (ch3b) | opensAfter sq.ow.night | sq.ow.night | 6 |
| sq.ow.letters | (ch3b) | opensAfter mq.ow.names | none | 5 |
| sq.ow.song | (ch3b) | opensAfter mq.ow.board | none | 5 |
| sq.ow.trail | (ch3b) | opensAfter mq.ford.mirror | none | 5 |
| sq.ow.news | (ch3b) | opensAfter mq.ow.relay | none | 5 |
| sq.reg.glasswater | - | waystone woken + sq.burl.fire | none | 5 |
| sq.reg.highPastures | - | waystone woken + sq.burl.fire | none | 5 |
| sq.reg.signalHill | - | waystone woken + sq.burl.fire | none | 5 |
| sq.reg.heath | - | waystone woken + sq.burl.fire | none | 5 |
| sq.reg.whitecombs | - | waystone woken + sq.burl.fire | none | 5 |
| sq.reg.northwood | - | waystone woken | none | zone level |
| sq.reg.ashMile | - | waystone woken | none | zone level |
| sq.reg.downs | - | waystone woken | none | zone level |
| sq.reg.reedmire | - | waystone woken | none | zone level |
| sq.reg.strand | - | waystone woken | none | zone level |

Story risk (no prerequisite any more): texts that assume a main beat: `sq.honey` ("that crow on the old stone"), `sq.burl.walk`, `sq.rb.regards`, `sq.burl.ask`, `sq.ow.letters` / `sq.ow.song` / `sq.ow.news` (name, board, village waystone), region journals ("Waystone showed ..."). See owner question 2.

## 4. Programmer rows
In `docs/pc-b-queue.md`, heading "## Main story split (D-103)".

## Owner questions
1. **Tobin in the main line?** D-103's example says "Smoke -> Tobin". Tobin stands at the meadow post (1426, 1044), about 400 m east of the smoke, so a main step with him would send the player back east. Proposal: Tobin stays a side giver who appears after `mq.smoke` (as today), and the main line goes Rook -> Hesk. OK?
2. **Side quests that assume a main beat** (list above) now have no prerequisite, so they can be offered out of story order (e.g. Hesk offering "Wolf Bounty" before "Stop there. Hands where I can see them"). Proposal: (a) the writer rewords them to read in any order, and (b) a character offers side quests only after the first talk with them (a "met" state on the NPC, like Burl's home state, not a quest prerequisite). Alternative: let these few require their main quest. Which one?
3. **Rook moves:** to hand quests in where they happen, Rook stands at the Bend (Ch1), then on the east bank of the river (end of "The River Road"), then on the west bank (today's spot). He just appears at the new spot (crow, "Wings."). OK, or keep him in one place and move the hand-ins?
