# M5 sprint 4 - "Walk-ready"

(PC-B PO opus, sprint planning 2026-10-11; owner-authorised "work on stories too". **PC-B PO, manager to ratify.** Rows go into `docs/pc-b-queue.md` `## M5 sprint 4` when the main session starts them.)

## Milestone status (2026-10-11)

**M4 "Keys and Relays": about 90 %.** All the systems are built. What is left is verification, clarity and the owner walk.

| M4 exit test item | state |
|---|---|
| A fresh player starts a new game | done (title, New Game, intro wake) |
| Plays Ch1-2, all main beats + errands, without a guide | **open.** 47 quests pass quest-sim, but the M4-C2 real-world run is still pending in the browser and there is no gap table yet. First-session bugs OB-055..058 / 063 / 066 are open |
| Finds and wears gear that shows on Wick | done (EQ-05 shells, EQ-10/11 drops, corpse loot OB-064/074); **needs owner walk** |
| Blocks with the shield | done (EQ-06); **needs owner walk** |
| Kills a beast with the bow | done (EQ-08/09). The sword/target cap bug OB-076 was fixed today (0a629f09); **needs owner walk** |
| Quit, Continue: same position, hearts, items, gear, quest flags (byte-stable) | done (verify-m4-exit PASS). M4-C2 AC3 re-checks it in the full run |
| Owner walks QL-20 + EQ-14 and calls the loop "playable" | **open.** Waits on OB-055 (notes) and OB-073 (ground) |
| Sign-off of the old po-review rows (M4-C1) | **open** (PO + tester batch) |
| River water (RIVER-01..04), OB-041 gate | done (PO OK) |
| M4-C3 chart labels + long-walk gate (optional) | po-review (MAP-28 half OK, MAP-14 leg PASS) |

**M5 "The Relay Line": about 20 %.**
- EP-DIALOGUE/NPC: ~5 %. The dialogue system and generated giver lines exist (M4). The Outwall NPCs, the 12 new characters and US-084/085 have not started; they are **blocked on owner approval of the characters** (quest-roadmap 2b).
- EP-QUEST 2: ~25 %. About 51 of ~100 quests (47 Ch1-2 + 4 QL-21 Ch3 opening). The main line beyond `mq.ow.fence` is not written.
- EP-REGION: ~15 %. The Outwall blockout (MAP-26), the band -> tier table (US-129a), the region banner (REGION-01) and the Ch1-2 hidden chests (US-104a) are in. 1 of ~74 MAP-26+ sites is built.
- EP-ENEMY 2: ~25 %. The wolf family is in (WOLF-D1/01). The tier look (US-129b/EQ-22) is blocked on the owner. The sentinel (US-102) has not started.
- EP-EQUIP 2: ~70 %. EQ-20/21/23 are built; EQ-22 is blocked on the owner.
- EP-PHYS part 2: ~30 %. Wading, splash and ripples are in (RIVER-01b, US-055a, PART-VIS-01). Floating props are open. Swimming is off (D-064, confirmed again 2026-10-11 "deep water still blocks"), so US-055b drops to the splash part only.
- Streaming (US-026b): 0 %. The M5 exit needs the frame budget to hold over the whole map.

## Goal
**Make M4 walk-ready and close it.** A fresh player gets through Ch1-2 with no stuck stretch, and the owner gets one checked build to walk. M5 keeps moving on the west bank (quests, secrets, one tougher beast).

Owner rules applied: every story comes from the roadmap, the M4 review or the sprint-3 "next" list. Environment uses existing meshes only. Animals are realistic and walk on 4 legs (the bear uses the existing `voxel_bear`). No Esc text anywhere. Texts are story.md keys or `NEEDS WRITER:`. No exile character names (2b is not approved). Magic stays off. No swimming (D-064).

## Stories

| id | slot | topic | arch note | ready | ends |
|---|---|---|---|---|---|
| M4-W1 | kestrel-4 | Owner-walk readiness gate (one script, one report) | no | **now** (after the M4-C2 browser run, same slot) | po-review |
| CL-01 | kestrel-1 | Ch1-2 guidance fixes from the M4-C2 gap table | no | after the M4-C2 gap table | po-review (owner look) |
| QL-22 | kestrel-3 | West-bank errand batch (6 quests, template pipeline) | no | **now** | po-review |
| US-104b | kestrel-3 (after QL-22) | West-bank hidden chests (US-104a generator) | no | **now** (queued behind QL-22) | po-review (owner look) |
| BEAR-01 | kestrel-1 (after CL-01) | Bear beast family for bands 6-7 | no (wolfBrain/beastSim pattern) | after owner Q1 | po-review (owner look) |
| STREAM-01 | kestrel-2 (after OB-073) | Placement residency by distance (US-026b step 1) | **ARCH-NOTE NEEDED** | after the note + OB-073 | arch-review |

File ownership (no two stories share a file; the same slot runs its two stories one after the other):
- **M4-W1:** new `tools/verify-m4-walk.mjs` (+ test), `docs/test-reports/m4-walk/`. It only reads `tools/verify-ch12-run.mjs`, `tools/verify-m4-exit.mjs` and `tools/route-walk.mjs`; it does not edit them.
- **CL-01:** `content/quests/ch1/*`, `content/quests/ch2/*` (objective/compass fields only), `docs/story.md` keys as `NEEDS WRITER:`, `game/js/main.js` only if a signal is missing.
- **QL-22:** new `content/quests/ch3/errands.json`, `content/quests/areas.json` (append only), test.
- **US-104b:** `tools/gen-secrets-ch12.mjs` -> a `--region` option (or new `tools/gen-secrets.mjs`), `content/worlds/world_m1.world.json`.
- **BEAR-01:** `game/js/quest/sim/beastConfig.js`, new `game/js/quest/sim/bearBrain.js` (+ test), `game/js/main.js` (model registration), `content/beasts/tiers.json` (one row if needed).
- **STREAM-01:** files per the note (expected `engine/world/` + `engine/render/` draw list). It must not touch the ground shader files OB-073 is in.

`NEEDS B1-main:` lines: the BEAR-01 spawn hook if main.js is busy with CL-01, and the STREAM-01 boot wiring.

## ACs (short)

**M4-W1 owner-walk readiness gate** (kestrel-4, ~0.75 d). Starts when the M4-C2 browser run and report exist; finishing that run is this slot's first step.
- AC1 `node tools/verify-m4-walk.mjs` runs, in order: `run-tests.mjs`, `check-deps.mjs`, `validate-content.mjs`, `quest-sim.mjs`, `route-walk.mjs` (all legs), `verify-m4-exit.mjs`, `verify-ch12-run.mjs`. It prints one line per step and exits non-zero on the first FAIL.
- AC2 it takes a headless still (240x90) at each of the 10 stops in m4-review section 4, using pose or position + yaw.
- AC3 it takes one still per bugs.md row in `fixed - verify` state that has an F3 position (OB-045..077). The row id goes into the file name, and it is listed in the report next to the bug text. Rows without a position are listed as "owner check only".
- AC4 `docs/test-reports/m4-walk/report.md` is one page: green/red per step, the walk stills, the OB verify table. The owner can open it before walking.
- AC5 it uses its own port (95xx) and stops only that server.

**CL-01 Ch1-2 guidance fixes** (kestrel-1, ~0.75 d). The input is the M4-C2 guidance-gap table (stretches > 30 s with no tracked objective, no compass target and no giver in view).
- AC1 every gap row gets a fix or a written "intended" reason in the report. Allowed fixes: a missing HUD objective, a compass target on the next beat, an auto-track of the next main quest on accept or done, or an objective text that names the place. No new markers, UI or mechanics.
- AC2 re-running `verify-ch12-run.mjs` shows **0 gap rows over 30 s** on the main line (errands may keep gaps the player chose).
- AC3 objective texts are <= 38 chars, story.md keys or `NEEDS WRITER:`, and have no key names except from the binding table.
- AC4 `quest-sim` all OK and the save round trip is unchanged (golden).

**QL-22 west-bank errand batch** (kestrel-3, ~0.75 d). 6 side quests on the template pipeline (38.44), with no named characters. They are accepted by reading a notice at the existing `owBoard` anchor (same read-to-accept pattern as `sq.hw.piers`) or found in the world. Mix: 2 hunt (wolves at gooseFarm, boars on the west bank), 1 fetch (an item at `barleyGate` back to `owBoard`), 1 deliver (owBoard -> owForge), 1 shoot targets (3 targets near `owPathPost`, existing target prop), 1 explore (pierStone -> ford west bank). Rewards: arrows, potions, band-5 gear rolls from the existing tables. No new heart or chart pieces.
- AC1 `quest-sim` all OK (57 quests); `validate-content` 0 findings; only existing anchors and meshes are used (no world json edit).
- AC2 Node chain test: each quest from accept to done with fed events; kills made before the accept count where the template allows it.
- AC3 texts are keys or `NEEDS WRITER:`, objectives <= 38 chars, no names from 2b.

**US-104b west-bank hidden chests** (kestrel-3 after QL-22, ~0.5 d). Same rules as US-104a for the ford west bank -> Outwall area: 3 chests off the path but visible from it at <= 25 m, using the existing chest mesh. The band from US-129a sets the loot tier (T3 there).
- AC1 `validate-content` 0 findings. Each chest is >= 8 m from the route-walk path and >= 3 m from other placements, sits on the ground (+- 0.05), and is reachable from the nearest `outwall` leg.
- AC2 the generator stays deterministic, and the US-104a chests are byte-identical (golden).
- AC3 one headless still per chest from the path.

**BEAR-01 bear beast family** (kestrel-1 after CL-01, ~1 d; **owner Q1 first**). Kind `bear` uses the existing `design/models/voxel_bear.js` (realistic, 4 legs, existing clips; any missing clip is listed for the designer, not invented). Behaviour, tier 2 at band 6-7: solitary, wanders slowly. It aggros at 12 m, or at 25 m when hit. It charges in a straight line with a 0.8 s rear-up telegraph, swipes for 2 hearts and has HP 3x boar. It does not chase past 30 m from home. A shield block stops the swipe but costs a stagger of 0.4 s. An arrow does not interrupt the charge. Spawns: 2 anchors at the nearest walkable band-6 spot. If none is open yet, use the Outwall north edge with `tier: 2` and record it as a temporary spot.
- AC1 Node, seeded: the telegraph is always >= 0.8 s before damage; block gives 0 damage + stagger; the home leash works; 0 alloc per step; the tier is applied once.
- AC2 the kill event + corpse loot go through the boar path (QL-22 hunt can count `bear` later).
- AC3 one browser pass: the telegraph reads at 10 m at 240x90, and no bear is stuck in the palisade.

**STREAM-01 placement residency** (kestrel-2 after OB-073, ~1 d after the note). US-026b step 1, aimed at the M5 exit ("streaming and band swaps hold the frame budget over the whole map"). **ARCH-NOTE NEEDED:** how far placement groups are kept resident (load/unload or just not submitted), what holds the cell grid, how it fits the 64-draw cap and the OB-039 frustum cull, the GPU buffer lifetime, and the save/entity state of unloaded groups.
- AC1 Node: resident set by distance with hysteresis (no thrash while standing on a border), 0 alloc per frame, deterministic.
- AC2 bench route tower -> ford -> Outwall: p95 is not worse than today and the resident mesh count drops at the far legs (numbers recorded).
- AC3 gpucompare all rows PASS (skill `gpucompare`); no visible pop inside the fog distance (headless stills at 2 borders).

## Order and readiness
- Ready now: QL-22 (k3), then US-104b (k3). The M4-C2 browser run, then M4-W1 (k4).
- CL-01 (k1) starts when the gap table exists. Until then k1 stays on the open OB fixes (OB-055/056/057/058/063/066/068/072).
- BEAR-01 (k1) waits on owner Q1.
- STREAM-01 (k2) waits on OB-073 and the architect note. A 5th agent (architect, opus) may write the note now.
- PO work in parallel (not a slot): M4-C1 batch verdict on the old po-review rows, and the sprint-3 verdicts.

## Not in this sprint (next)
US-054 cuttable tree (owner Q3), Outwall NPCs + US-042/084/085 talk beats (owner Q2), US-102 sentinel (owner Q4), US-129b/EQ-22 tier look (owner, open since sprint 1), floating props (US-055 remainder), more west-bank sites (MAP-26+).

## Owner questions
1. **BEAR-01:** is a bear the right first beast for levels 6-7 (it uses the existing voxel bear), or do you want a different animal?
2. **Characters:** please approve the 12 new characters (quest-roadmap.md 2b). Outwall NPCs, dialogue and the M5 main line are waiting on this; it is the biggest M5 blocker.
3. **US-054 cuttable tree** (old M3 sketch): still wanted? If yes, the PO proposes a small first step: the sword fells marked trees into a walkable log (existing meshes), with no physics pieces.
4. **US-102 clockwork sentinel:** keep it (it is a machine, not an animal), or replace it with another realistic beast family?
5. **EQ-22 / US-129b tier look:** A) realistic material shades (PO default) or B) per-tier colours?
6. **M4 close:** after the walk, should M4-C3 (chart labels, long-walk gate) count as M4 or move to M5?
