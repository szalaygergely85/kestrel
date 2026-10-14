# Main story split into short quests (D-103 .. D-109)

PO (sonnet, PC-B), 2026-10-14; revised the same day for the owner answers D-108 + D-109. Sources: `content/quests/m1.quest.json`, `tower.blade`, `burl.boars`, `mq.*.quest.json`, `ch12/pack.json`, `ch3/pack.json`, `ch3b/pack.json`, `regions/pack.json`, `docs/epics/qfix-s5-givers.md`, `docs/story.md` (q01-q06, QL-W1, Ch3 main, quest-giver NPCs incl. Tobin), `game/js/quest/giverNpcs.js`, `docs/epics/ep-items-stats.md` section 9.

## Rules used (owner)
- **D-103:** no auto-step chain. Every main quest is a short WoW quest: giver `!` -> offer window (Accept / Decline) -> 1-3 objectives -> `?` -> hand-in window (Complete + reward). Gold = main. The only object giver in the main line is the tower note (opening).
- **D-104:** quests are separate chains. A main quest `requires` exactly the previous main quest (done). A side quest has NO `requires`, except step 2+ of a side chain, which requires the previous quest of its own chain. `opensAfter` is treated the same as `requires` (removed unless it is the chain link).
- **D-108 (2) exception:** a side quest whose text assumes the player has met a character in the main story may also require that main quest (the "meeting" quest). So a side quest has at most 2 requires: its chain link (if any) + at most one listed main quest (whitelist = section 3, column "Main req").
- **D-105 / D-106:** pacing uses `minLevel` (data only). The level is the PLAYER-LEVEL-01 gear formula (ep-items-stats section 9), **hidden**: never shown, no "Level N", no "Requires level" text. Under the level: no `!`, the quest is not offered, and the giver says a "come back when you're stronger" line instead. `minLevel` is checked only when the quest is offered/accepted; an accepted quest is never re-locked (the level can drop when gear comes off). Zones: near side 1-5, far side (west bank, Outwall) 5-10.
- **D-108 (1) + D-109:** Tobin is in the main chain after Smoke. The Outwall quests are the LAST main quests. **Chapter I ends at the gate (Outwall), reached around hidden level 10 - no main quest after it.** The final hand-in is to Hesk at the gate (`owGate`) and is marked "Chapter I complete".
- **D-108 (3):** Rook moves along the story (Bend -> east bank -> west bank) and takes hand-ins where they happen.
- **D-098** markers unchanged: `!` take, grey `?` until done, gold `?` ready; for reach/wake/use objectives the `?` hangs over the place itself while that objective is active (old m1 `mark.end` anchors kept: doorMarker, endMarker, relayBend). After a hand-in the same character offers the next main quest right away (if the level allows; else the under-level line).
- **D-020 / D-078:** rewards are small items from existing defs, no XP.
- **Giver presence is not a prerequisite:** where a character stands (Burl at home vs escorting, Rook's spot, Tobin hidden until `mq.smoke` done, `GIVER_GATES`) is NPC state, not quest data. It stays.
- A character with both offers shows the main offer first in the talk list, then side offers.

## 1. New main quests, in story order (15)

The old m1 step `wake` is not an objective: it is the intro (flag `wake`); the note that gives quest 1 is pinned behind the wake spot. All other m1 steps are objectives below.

Level curve (hidden, minLevel): 1 1 1 2 2 3 | 5 5 6 6 | 7 8 | 9 9 10. Near side (quests 1-6) 1-3; the river gate (D-095) is quest 7 at 5; far side 5-10; the gate (quest 15) at 10.

| # | id | Title | Giver | Turn-in | Objectives | Reward | Requires | minLevel | Reuses (keys) | NEEDS WRITER |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `mq.tower` (replaces `tower.blade` + m1 q01/q02) | A Blade in the Ashes | tower note `noteKeepLight` (object, the 1 allowed) | Burl | reach `breach` (m1 breach); take `sword` (m1 sword); reach `towerDoor`, `?` on doorMarker (m1 leave) | potion.hp x1 | none (story start) | 1 | offer = `note.keepLight`; HUD `m1.breach/sword/leave`; journals of `tower.blade`; `bark.wick.sword`, `toast.door.open`, `bark.wick.meadow`, `bear.call` (bark); active at Burl `bear.early`, `bear.blade.wait`; hand-in `bear.meet` (+ `bear.crash` branch) | - |
| 2 | `mq.boars` (replaces `burl.boars` + m1 q03) | Boars in the Woods | Burl | Burl | kill 5 boars (`boar1..5`) (m1 beasts) | Teal Crystal `aetherCrystal` x1 + flag `aether.attuned` (granted at hand-in, PO-CH1-13) | mq.tower | 1 | `bear.q.offer`, `bear.q.choice.*`, `bear.q.accepted`, `bear.q.later`, `bear.q.active`, `bear.q.ready` (with the PO-CH1-13 gift lines 4-7 from story.md q04 OPEN), `bear.q.thanks`; journal `quest.burl.boars.beasts` | `toast.crystal.found` reword: given by Burl, not "under the last boar" (<= 38) |
| 3 | `mq.stone` (m1 q04 + q05) | The Old Stone | Burl | Burl (at the stone) | follow Burl to the stone (flag `burl.arrived`) (m1 follow); wake the waystone (flag `waystone.waystone.woken`, `?` on endMarker) (m1 waystone) | potion.hp x1 (travel unlock comes from the stone) | mq.boars | 1 | offer `bear.follow`; active `bear.following`, `bear.wait`, `bear.walk1/2`; arrival `bear.stone`, `bear.stone.again`; `prompt.stone.wake`, `notice.waystone`; hand-in `bear.woken` (1-5) | - |
| 4 | `mq.road` (m1 q06) | The Road West | Burl | Rook at the Bend (spot A) | reach `roadWest` (m1 road); reach `bendRelay` (m1 relayFound); wake the Bend waystone (flag `waystone.ws_roadBend.woken`, `?` on relayBend) (m1 relay1) | potion.hp x2 | mq.stone | 2 | offer `bear.woken` (6-13); active `bear.departing`; journal `m1.section.q06.desc`; `bark.wick.relay`, `hint.relay.nocrystal`, `notice.relay`; hand-in `rook.meet` (1-7) | - |
| 5 | `mq.bend.call` (kept) | The Call Carries | Rook (A) | Rook (A) | watch the pulse (flag `relay.bend.pulseSeen`); read the knot (flag `lore.knot.read`) | chart.river x1 | mq.road | 2 | offer `rook.meet` (8); active `rook.call.active`; `bark.wick.relayPulse/2`, `note.knot`; hand-in `rook.call.ready` (1-5) + Ch1 card + `journalCh1` | - |
| 6 | `mq.river.road` (kept) | The River Road | Rook (A) | Rook (east bank, spot B) | reach `riverBank` | potion.hp x1 | mq.bend.call | 3 | offer `rook.call.ready` (6); active `rook.repeat`; `bark.wick.river`; hand-in `rook.road.stronger` | 1 offer line (Rook); 1 hand-in line after `rook.road.stronger` pointing to the bear ("the bear knows fire") |
| 7 | `mq.ember` (was side `sq.burl.fire`) | Burl's Ember | Burl | Burl | collect 3 `emberpod` in Cinder Hollow | Fireball (spellbook, D-099/D-100) + potion.mp x1 | mq.river.road | 5 | `sq.burl.fire` lines offer/active/ready/done | offer line 1 "Salt in my larder" refers to a side quest -> reword |
| 8 | `mq.ford.stones` (kept) | Stones in the Water | Burl | Rook (west bank, spot C) | reach `fordWest` (cross the stepping stones) | arrow x10 | mq.ember | 5 | hand-in `rook.ford` (1-2) | 1-2 offer lines (Burl sends you over the river); 1 active line (Burl) |
| 9 | `mq.ford.mirror` (kept) | The Missing Glass | Rook (C) | Rook (C) | take `relay.mirror`; wake the Ford waystone (flag `waystone.ws_ford.woken`) | potion.hp x2 | mq.ford.stones | 6 | offer `rook.ford` (3-7); active `rook.mirror.active`; `hint.relay.nomirror`, `notice.relayFord.title`; hand-in `rook.mirror.done` | - |
| 10 | `mq.smoke` (kept) | Smoke in the North | Rook (C) | Rook (C) | read the mark (flag `lore.fordMark.read`); reach `northLook` | arrow x10 | mq.ford.mirror | 6 | offer `rook.ford.repeat`; `note.fordMark`, `bark.wick.smoke`; Ch2 card + `journalCh2` stay where they fire today | 1 offer line; 1-2 hand-in lines (Rook: smoke means people; the caps hand on the TAKEN tags belongs to someone at the trade post) |
| 11 | `mq.post.tags` (NEW, Tobin) | The Hand on the Tags | Rook (C) | Tobin (`postKeeper`, trade post 1426, 1044) | reach the trade post (area around `post`, r 10; `?` over `post`) | potion.hp x1 | mq.smoke | 7 | Tobin `npc.postKeeper.greet.first` as hand-in line 1; sets `postKeeper.met` | 1 offer line (Rook, sends you to the post); 1-2 hand-in lines (Tobin: yes, the tags are his; he counts, he does not ask) |
| 12 | `mq.post.west` (was side `sq.fc.sign`, Tobin) | The West Arm | Tobin | Tobin | take `signArm` (in the ford shallows, as today) | arrow x10 | mq.post.tags | 8 | journal/objText of `sq.fc.sign`; hand-in `npc.postKeeper.thanks.sign` | offer in Tobin's voice (replaces the basket-tag lines); 1 hand-in line: the west arm points to the track north, to people who do not want finding (leads to quest 13) |
| 13 | `mq.ow.fence` (merges `mq.ow.path` + `mq.ow.fence` + `mq.ow.names`) | Wolves at the Fence | Tobin (was Rook) | Hesk (at the gate `owGate`) | reach `owPath` (the track to the smoke); kill 5 wolves (`wolf1..5`) | gear table `gear.t3` (from mq.ow.names) | mq.post.west | 9 | journals of mq.ow.path / mq.ow.fence; hand-in = `mq.ow.names` lines offer + ready ("Stop there..." ... "Come in, Wick"), done line | 1 offer line (Tobin, not Rook) |
| 14 | `mq.ow.relay` (kept) | The Village Waystone | Hesk | Hesk | ask Dorrin (flag `talk.dorrin`); take `relay.brass`; wake the village waystone (flag `waystone.ws_outwall.woken`) | potion.hp x2 | mq.ow.fence | 9 | lines offer/active/ready; hand-in = `done` line | - |
| 15 | `mq.ow.board` (kept) **FINAL: Chapter I complete** | The Board of the Dead | Hesk | Hesk (at the gate) | read the board (flag `lore.owBoard.read`) | chart.westFells x1 | mq.ow.relay | 10 | lines offer/active/ready (board narration) | 1-2 hand-in lines (Hesk, a closing beat for the chapter); end card + credits text (MQ-SPLIT-7) |

Notes
- **Rook's spots (D-108 (3)):** A = Bend (until `mq.river.road` is accepted), B = east bank by `riverBank` (while `mq.river.road` is active/ready; "I will be there first. Wings."), C = west bank, today's spot (975, 1054) (after `mq.river.road` is done; stays there to the chapter end). Spot switch = hide/show, like `GIVER_GATES`. One Rook visible at a time.
- **Tobin (D-108 (1)):** still hidden until `mq.smoke` is done (NPC state, story.md 2193). Quest 11 sends the player back east to the trade post (about 400 m; the Bend waystone at 1262, 1033 is the short way). Quest 12 sends him to the ford shallows and back; quest 13 sends him west/north to the Outwall. Travel by waystones keeps this short.
- **The river gate (D-095) lives in the chain:** `mq.ember` at minLevel 5. Until then Burl has no gold `!` and says the under-level line; Rook's `rook.road.stronger` already tells the player why.
- **Under-level line per main giver** (one each, <= 56, no numbers): Burl, Rook, Tobin, Hesk -> MQ-SPLIT-W.
- **Chapter end (D-109):** `mq.ow.board` carries `"chapterEnd": 1`. Its hand-in sets flag `chapter.1.complete` and fires the end card + credits hook (MQ-SPLIT-7). No main quest has `requires: mq.ow.board`. After the card the player is back in the world (owner question 1).
- **Burl's crystal (PO-CH1-13)** moves from the last-boar burst to the `mq.boars` hand-in.
- Retired ids: `m1`, `tower.blade`, `burl.boars`, `sq.burl.fire`, `sq.fc.sign`, `mq.ow.path`, `mq.ow.names` (save migration below; `m1.legacy` test fixture stays).

## 2. Save migration (pure function, runs once after `migrateM1Ch1`, sets `save.mqSplit = 1`, idempotent)

Last m1 step done (old `quest.completed`) -> new states. "per book" = copy the old book entry state + progress (offered / active / ready / done). Migration writes only active / ready / done; "offered" is never stored - it is recomputed by the normal offer check (so `minLevel` applies to it).

| m1 last done | mq.tower | mq.boars | mq.stone | mq.road | Other |
|---|---|---|---|---|---|
| none / `wake` | per `tower.blade` book (none -> offered by the note) | - | - | - | |
| `breach` | active, breach done (or `tower.blade` state if further) | - | - | - | |
| `sword` | active, breach + sword done | - | - | - | |
| `leave` | ready (hand in to Burl); done if `tower.blade` done | per `burl.boars` book (kill count kept) | - | - | |
| `beasts` | done | done; ensure `aetherCrystal` + `aether.attuned` | active if flag `s.burl.follow` set, else none (offered by Burl) | - | |
| `follow` | done | done | active, follow done | - | |
| `waystone` | done | done | done | active (the old chain had it running) | |
| `road` | done | done | done | active, road done | |
| `relayFound` | done | done | done | active, road + relayFound done | |
| `relay1` | done | done | done | done | `mq.bend.call` per book |

Other quests:
- `sq.burl.fire` any state -> `mq.ember` same state + progress; fireball unlock flag kept.
- `sq.fc.sign` any state -> `mq.post.west` same state + progress (signArm kept).
- `mq.post.tags` (new): done if flag `postKeeper.met` is set or any quest with Tobin as giver/turn-in is past offered; else none (Rook offers it after `mq.smoke`).
- `mq.ow.names` done -> `mq.ow.fence` done. Else old `mq.ow.fence` ready/done or `mq.ow.names` offered/active -> `mq.ow.fence` ready. Else old `mq.ow.path` done -> `mq.ow.fence` active (owPath done, wolf count from the old fence). Else old `mq.ow.path` active -> `mq.ow.fence` active.
- **Monotonic rule (last step):** if any main quest is active/ready/done, every main quest before it in section 1 is set done (no rewards, no flags except the crystal rule). This covers saves already at the Outwall that never met Tobin or found the sign arm, and saves with `mq.river.road` done before `mq.bend.call` (parallel today). Nothing is ever undone.
- No retro rewards for new or skipped quests (only the crystal, which the story needs). The `m1` tracker is dropped; the tracked quest = the active main quest.
- `chapter.1.complete` is set if `mq.ow.board` ends up done (no end card replay on load).

## 3. Audit of every quest's `requires` (D-104, D-108) and `minLevel` (D-105)

minLevel rule for side quests: near side 1-5 = `max(1, band - 1)` capped at 5; west bank (Rook spot C, ford) 5-6; Tobin's west-bank errands 6-7; Outwall / Dorrin 9. Region quests: band.js zone level at their waystone, clamped 1-5 on the near side and 5-10 on the far side (programmer fills the number, Node test pins it).
"none" = remove `requires` / `opensAfter` entirely. The flag `burl.home` is Burl's state (she offers side quests only when at home), not a quest prerequisite.
"Main req" = the D-108 (2) meeting exception: the side quest also requires that main quest done (whitelist for the lint test).

### Main (old ids)
| Quest | Today requires / opensAfter | New requires | minLevel | Change |
|---|---|---|---|---|
| m1 | - | - | - | retired (section 2) |
| tower.blade | storyStart | -> mq.tower: none | 1 | rename + main |
| burl.boars | tower.blade done | -> mq.boars: mq.tower | 1 | rename + main |
| (new) mq.stone | m1 steps | mq.boars | 1 | new |
| (new) mq.road | m1 steps | mq.stone | 2 | new |
| mq.bend.call | m1 step relay1 | mq.road | 2 | |
| mq.river.road | m1 step relay1 | mq.bend.call | 3 | was parallel with bend.call |
| sq.burl.fire | opensAfter mq.river.road | -> mq.ember: mq.river.road | 5 | becomes main |
| mq.ford.stones | river.road step riverBank + sq.burl.fire done | mq.ember | 5 | fire gate -> minLevel |
| mq.ford.mirror | bend.call done + ford.stones step fordWest | mq.ford.stones | 6 | |
| mq.smoke | ford.mirror done | mq.ford.mirror | 6 | |
| (new) mq.post.tags | - | mq.smoke | 7 | new, Tobin |
| sq.fc.sign | opensAfter mq.ford.mirror | -> mq.post.west: mq.post.tags | 8 | becomes main |
| mq.ow.path | smoke step north + sq.burl.fire done | -> merged into mq.ow.fence | - | merged |
| mq.ow.fence | ow.path step explore | mq.post.west | 9 | now holds path + names; giver Tobin |
| mq.ow.names | ow.fence step kill | - | - | merged (hand-in of mq.ow.fence) |
| mq.ow.relay | ow.names done | mq.ow.fence | 9 | |
| mq.ow.board | ow.relay done | mq.ow.relay | 10 | FINAL, `chapterEnd` |

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
Meeting rule used for "Main req": Rook-given or Rook-turn-in -> `mq.road` (meet Rook); Tobin giver or turn-in -> `mq.post.tags` (meet Tobin); Hesk-given -> `mq.ow.fence` (meet Hesk); Dorrin-given or Dorrin turn-in -> `mq.ow.relay` (meet Dorrin); plus the text cases (sq.honey, sq.burl.walk, region journals, sq.ow.song). Chain steps 2+ get a main req only if their own giver/turn-in differs from the head's.

| Quest | Band | Today requires / opensAfter | Chain req | Main req (D-108) | minLevel |
|---|---|---|---|---|---|
| sq.burl.blue | - | burl.boars done + burl.home | none | - | 1 |
| sq.tm.nub | 1 | burl.boars + burl.home | none | - | 1 |
| sq.burl.boars.n | 1 | burl.boars + burl.home | none (chain head) | - | 1 |
| sq.burl.boars.w | 1 | + boars.n | sq.burl.boars.n | - | 1 |
| sq.burl.boars.s | 2 | + boars.w | sq.burl.boars.w | - | 1 |
| sq.burl.meat | 1 | burl.boars + burl.home | none | - | 1 |
| sq.burl.stone | 1 | burl.boars + burl.home | none | - | 1 |
| sq.burl.hint | 1 | + burl.stone | sq.burl.stone | - | 1 |
| sq.burl.tower | 1 | burl.boars + burl.home | none | - | 1 |
| sq.burl.scout | 2 | + boars.s + sq.burl.fire | sq.burl.boars.s | - | 5 |
| sq.burl.ask | 4 | + burl.scout | sq.burl.scout | - | 5 |
| sq.burl.walk | 1 | burl.boars + burl.home | none | mq.stone (text assumes the walk to the stone) | 1 |
| sq.burl.parcel | 2 | + burl.meat | sq.burl.meat | - | 1 |
| sq.post.spare | 4 | + burl.parcel | sq.burl.parcel | mq.post.tags (turn-in Tobin) | 3 |
| sq.straw | 5 | sq.tm.nub | none | mq.post.tags | 4 |
| sq.rb.shield | 2 | m1 relay1 + sq.burl.fire | none | mq.post.tags (turn-in Tobin) | 5 |
| sq.rb.regards | 2 | m1 relay1 + rb.shield | sq.rb.shield | - (head already needs Tobin; Rook met earlier) | 5 |
| sq.rb.road | 2 | m1 relay1 + rb.shield | sq.rb.regards | - | 5 |
| sq.fc.ford | 4 | river.road riverBank + sq.burl.fire | none | mq.post.tags | 6 |
| sq.fc.smoke | 5 | riverBank + fc.ford | sq.fc.ford | - | 6 |
| sq.fc.cross | 5 | riverBank + fc.smoke | sq.fc.smoke | - | 7 |
| sq.fc.again | 4 | riverBank + fc.cross | sq.fc.cross | - | 7 |
| sq.tm.gap | 1 | burl.boars + burl.home | none | - | 1 |
| sq.tm.wood | 1 | + tm.gap | sq.tm.gap | - | 1 |
| sq.tm.cart | 1 | + tm.gap | sq.tm.wood | - | 1 |
| sq.rb.lamps | 2 | m1 relay1 | none | mq.road | 1 |
| sq.rb.rocks | 2 | relay1 + rb.lamps | sq.rb.lamps | - | 1 |
| sq.rb.parcel | 2 | relay1 + rb.rocks + sq.burl.fire | sq.rb.rocks | - | 5 |
| sq.he.wallow | 2 | riverBank + sq.burl.fire | none | mq.road | 5 |
| sq.he.farm | 3 | burl.boars + burl.home + burl.scout | none | - | 2 |
| sq.dw.bees | 2 | burl.boars + burl.home + burl.scout | none | - | 1 |
| sq.dw.stones | 3 | + dw.bees | sq.dw.bees | - | 2 |
| sq.fc.stores | 5 | riverBank | none | mq.post.tags | 4 |
| sq.fc.caps | 4 | riverBank + sq.burl.fire | none | mq.road | 5 |
| sq.fc.well | 4 | riverBank + sq.burl.fire | none | mq.road | 5 |
| sq.fc.shrine | 4 | riverBank + sq.straw | sq.straw | - (head already needs Tobin) | 3 |
| sq.fc.jetty | 4 | riverBank + fc.ford | sq.fc.ford | - | 6 |
| sq.fc.cog | 5 | riverBank + fc.jetty | sq.fc.jetty | - | 7 |
| sq.fc.ask | 4 | riverBank + burl.boars + burl.home + sq.burl.fire | none | mq.road | 5 |
| sq.rook.gift | 5 | riverBank + burl.boars + burl.home + fc.ask | sq.fc.ask | - | 5 |
| sq.wreck.plate | 2 | burl.boars | none | mq.road (turn-in Rook) | 1 |
| sq.honey | 3 | opensAfter mq.bend.call | none | mq.road ("that crow on the old stone") | 2 |
| sq.rook.shiny | 3 | opensAfter mq.bend.call + sq.burl.fire | none | mq.road | 5 |
| sq.packet | 3 | opensAfter mq.bend.call | none | mq.post.tags (turn-in Tobin) | 2 |
| sq.fc.sign | (ch3) | opensAfter mq.ford.mirror | - | - | becomes main `mq.post.west` |
| sq.hw.piers | (ch3 5-10) | opensAfter mq.ford.mirror | none | mq.ow.relay (Dorrin) | 9 |
| sq.ow.wolves | (ch3) | opensAfter mq.ford.mirror | none (chain head) | mq.ow.fence (Hesk) | 9 |
| sq.ow.boars | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.fence | 9 |
| sq.ow.parcel | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.relay (turn-in Dorrin) | 9 |
| sq.ow.ford | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.relay (Dorrin) | 9 |
| sq.ow.barley | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.fence | 9 |
| sq.ow.range | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.fence | 9 |
| sq.ow.raid | (ch3) | opensAfter mq.ford.mirror | none | mq.ow.fence | 9 |
| sq.ow.night | (ch3b) | opensAfter sq.ow.wolves | sq.ow.wolves | - | 9 |
| sq.ow.bears | (ch3b) | opensAfter sq.ow.night | sq.ow.night | mq.ow.relay (giver Dorrin, head is Hesk) | 9 |
| sq.ow.letters | (ch3b) | opensAfter mq.ow.names | none | mq.ow.fence (names) | 9 |
| sq.ow.song | (ch3b) | opensAfter mq.ow.board | none | mq.ow.board (after the chapter end, owner question 1) | 10 |
| sq.ow.trail | (ch3b) | opensAfter mq.ford.mirror | none | mq.ow.relay (Dorrin) | 9 |
| sq.ow.news | (ch3b) | opensAfter mq.ow.relay | none | mq.ow.relay (village waystone) | 9 |
| sq.reg.glasswater | - | waystone woken + sq.burl.fire | none | mq.stone (journal "Waystone showed ...") | zone level (5-10) |
| sq.reg.highPastures | - | waystone woken + sq.burl.fire | none | mq.stone | zone level (5-10) |
| sq.reg.signalHill | - | waystone woken + sq.burl.fire | none | mq.stone | zone level (5-10) |
| sq.reg.heath | - | waystone woken + sq.burl.fire | none | mq.stone | zone level (5-10) |
| sq.reg.whitecombs | - | waystone woken + sq.burl.fire | none | mq.stone | zone level (5-10) |
| sq.reg.northwood | - | waystone woken | none | mq.stone | zone level (1-5) |
| sq.reg.ashMile | - | waystone woken | none | mq.stone | zone level (1-5) |
| sq.reg.downs | - | waystone woken | none | mq.stone | zone level (1-5) |
| sq.reg.reedmire | - | waystone woken | none | mq.stone | zone level (1-5) |
| sq.reg.strand | - | waystone woken | none | mq.stone | zone level (1-5) |

Remaining story risk (no main req, writer checks they read in any order): `sq.burl.ask` (crossroads post), `sq.rb.regards`. Tobin's ford errands `sq.fc.ford/smoke/cross/again/jetty/cog` still have FORD RELAY "TICK" lines: voice pass in MQ-SPLIT-W (story.md 2192).

**Soft-lock guard:** the hidden level comes only from gear + spells. Between two main quests the player must be able to reach the next `minLevel` with the rewards open to him at that point (main + side quests + loot). MQ-SPLIT-8 checks this in the quest sim; if a step fails, the PO lowers that `minLevel` (data only), not the curve's end (gate = 10).

## 4. Programmer rows
In `docs/pc-b-queue.md`, heading "## Main story split (D-103)".

## Owner answers (D-108, 2026-10-14)
1. Tobin in the main line: **yes**, after Smoke (quests 11-13).
2. Side quests that assume a main meeting: **may require their main quest** (section 3 "Main req").
3. Rook moves along the story: **approved** (spots A/B/C).

## Owner questions (open)
1. **After "Chapter I complete":** proposal: end card + credits, then the player is back in the world at Hesk (free roam, side quests incl. `sq.ow.song` still open, save works), and the title screen shows "Chapter I complete" on that save. Alternative: the credits end the run (back to the title, save locked). Which one?
2. **Tobin's two main quests:** proposal = "The Hand on the Tags" (Rook sends you to the trade post) + "The West Arm" (the old side quest `sq.fc.sign` promoted: the restored sign points to the track north, Tobin then sends you to the Outwall). OK, or should Tobin's beat be something else?
