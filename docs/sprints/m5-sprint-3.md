# M5 sprint 3 - "First thirty minutes"

(PC-B PO opus, sprint planning 2026-10-11; owner-authorised "continue with other stories". **PC-B PO, manager to ratify.**) M5 sprint 1 + 2 are implemented (po-review / arch-review; EQ-22 blocked on the owner). OB-048..053 are being worked now and are NOT in this sprint (OB-048 note close, OB-049 Esc order, OB-051 prompt size, OB-052 cone, OB-053 z-fight).

**Goal:** a first-time player always knows what to press and where to go in the first 30 minutes (tower -> meadow -> ford), and finds something for looking off the path.

Why: playtester Simon got stuck on the starting note (OB-048) and missed usable objects (OB-052). The M1 hint system (US-015, GDD 7.4) only knows move/run/jump/mouse/chart; nothing teaches the M4 actions (items, journal, block, bow, quick bar). M4-C2 (the scripted Ch1-2 run) was PO REJECTed and never built, so nobody has measured where a new player is left without a goal.

Owner rules applied: no feature that was not already discussed. Every story comes from the roadmap, GDD 7.4, the M4 review gap list, an OB note or the sprint-1 "next" list. Environment uses existing meshes only (chest, Medieval kit). No "Esc to close" text, and no Esc text in any hint. Texts are story.md keys or `NEEDS WRITER:`. Key labels come from the binding table, never hard-coded. Magic stays off.

## Stories

| id | slot | topic | arch note | ready | ends |
|---|---|---|---|---|---|
| FS-01 | kestrel-1 | Action hints for the M4 controls (GDD 7.4 hint system) | no (hints.js FIFO, combatHint.js pattern) | **now** | po-review (owner look) |
| M4-C2 | kestrel-4 | Scripted fresh-player Ch1-2 run + guidance-gap report | no | **now** | po-review |
| US-104a | kestrel-3 | Ch1-2 secrets: hidden chests off the path | no | **now** | po-review (owner look) |
| REGION-01 | kestrel-4 (after M4-C2) | Region-entry banner with the approved place names | no | **now** (queued behind M4-C2) | po-review (owner look) |
| QL-19b | kestrel-3 (after US-104a) | Wet stepping stones wired into movement (River Boots matter) | no | **now** (queued behind US-104a) | po-review |
| INT-HL-01 | kestrel-2 | Faint highlight on usable things in range (OB-052 remainder) | **ARCH-NOTE NEEDED** | after the note + owner Q1 | arch-review |

File ownership (no two stories share a file):
- **FS-01:** `game/js/main.js`, new `game/js/quest/actionHints.js` (+ test), `design/models/title.js` (hint rows only).
- **M4-C2:** new `tools/verify-ch12-run.mjs` (+ test), new `game/js/dev/modes/ch12run.js`, `docs/test-reports/m4-c2/`.
- **US-104a:** new `tools/gen-secrets-ch12.mjs` (+ test), `content/worlds/world_m1.world.json`.
- **REGION-01:** new `game/js/quest/regionBanner.js` (+ test), new `design/ui-region-banner.js`.
- **QL-19b:** new `game/js/quest/sim/wetStones.js` (+ test), `game/js/quest/sim/equipment.js` (call only).
- **INT-HL-01:** files per the architect note. `engine/world/interaction.js` belongs to OB-052, so the note must not reopen it while OB-052 is in arch-review.

`NEEDS B1-main:` lines (B1-main session, not the slots): REGION-01 step + draw call, QL-19b step-slow hook into the movement speed, INT-HL-01 wiring if the note needs it.

## ACs (short)

**FS-01 M4 action hints** (kestrel-1, ~0.75 d). New `actionHints.js` follows the `combatHint.js` pattern. It requests hints through `hints.js` (same FIFO, one at a time, fade 0.3 s, 8 s timeout, once per save in `hints.shown`/`hints.done`), and main.js feeds it the signals. Hint rows are added to `uiStyle.hints` in title.js. Trigger -> hint -> done-on:
- first item or gear picked up -> `[I] Items` -> Items window opened
- first quest accepted -> `[J] Journal` -> journal opened
- sword taken -> `[LMB] Swing` -> first swing
- shield equipped -> `Hold [RMB] Block` -> first block raise
- bow equipped -> `Hold [LMB] Draw, release to shoot` -> first arrow shot
- second weapon in the bar -> `[Q] Swap weapon` -> first swap
- first potion picked up -> `[1-4] Use the quick bar` -> first slot key used
- AC1 Node, fed events: each hint fires once on its trigger and never again after its done action (also when the action came first). Never two hints at once. Save round trip keeps shown/done. 0 alloc per step.
- AC2 key labels come from the live binding table (a rebind changes the label). No hint text mentions Esc. Texts <= 38 chars.
- AC3 the existing M1 hints (move/run/jump/capture/chart/burner/combatDodge) are unchanged (golden test on their ids and order).
- AC4 one browser pass of a new game up to the first boar: the stills show the hints in order and none overlaps the OB-051 prompt.

**M4-C2 scripted fresh-player Ch1-2 run** (kestrel-4, ~0.75 d). Re-spec of the rejected M4-C2 row. A headless script plays a NEW game in the real browser world (the `verify-m4-exit` harness, `tools/capture-browser.mjs` pattern, own port 95xx). It drives the player along the route-walk legs and fires the real interactions (note, sword, Burl, every Ch1-2 main beat and errand).
- AC1 every Ch1-2 main beat and every errand reaches done. The report lists any quest that cannot be finished, with its last objective.
- AC2 the gear picked up on the way is equipped and shows on the player (Character view still).
- AC3 save, quit, Continue: same position, hearts, items, equipment and quest flags (byte-stable save compare).
- AC4 **guidance-gap table**: sampled every 5 s, one row per stretch longer than 30 s with no tracked HUD objective, no compass target and no `!`/`?` giver in view. Columns: where (x,y), game time, last event. This table is the input for the next clarity fixes.
- AC5 report `docs/test-reports/m4-c2/report.md` with one still per main beat. Exit code is non-zero on any AC1/AC3 failure.

**US-104a Ch1-2 hidden chests** (kestrel-3, ~0.75 d). Roadmap EP-REGION US-104, Ch1-2 part only. 4 hidden chests (existing chest entity + mesh), each off the main path but visible from it at <= 25 m, so they reward a look around. Candidate spots: behind Rook's ruin, a forest hollow north of the Bend, the straw-field edge, the river bank below the ford (the generator picks exact spots that pass the checks). Loot uses the existing chest table (gear 8 %, band tier from US-129a). No new heart pieces or chart pieces, and existing ones do not move.
- AC1 `node tools/validate-content.mjs` 0 findings. Each chest is >= 8 m from the road/route-walk path, >= 3 m from other placements, on the ground (z = ground +- 0.05), and reachable (route-walk grid path from the nearest leg, no stuck spot).
- AC2 Node: the generator is deterministic (same seed = byte-identical json) and lists the 4 ids plus their nearest road point.
- AC3 one headless still per chest from the road showing it in view at 240x90.

**REGION-01 region-entry banner** (kestrel-4 after M4-C2, ~0.5 d). This was on the sprint-1 "next" list. Place names are approved (MAP-27 PO OK, owner 2026-10-11). On entering a world_geo region, its story.md place name fades in top-centre on the UI layer (0.4 s in, 2.5 s hold, 0.6 s out). Same font scale path as the OB-051 prompt. Shown on the first entry per save; after that only after >= 10 min away. Never during dialogue, menus, notes or the travel fade (it is queued instead). Style lives in the new design/ui-region-banner.js and uses existing palette keys.
- AC1 Node: an entry fires once, a border jitter (+-3 m for 20 s) never re-fires it, the 10 min rule works, and it is queued while a panel is open. Save round trip keeps the seen-set. 0 alloc per step.
- AC2 a region without an approved name shows nothing (no placeholder on screen); the test lists those regions.
- AC3 headless stills crossing tower -> meadow and meadow -> ford at 240x90 and 560x210, sharp text.

**QL-19b wet stones in movement** (kestrel-3 after US-104a, ~0.5 d). QL-19 left the rule pure and unwired (`wetStoneStep`/`hasSureFooting` in equipment.js). The new wetStones.js decides "standing on a wet stone" from the existing ford stepping-stone ids (no world json edit). A sprint onto one without River Boots gives the 0.4 s slow step (speed x0.4). With the boots: nothing. No fall, no damage, never a lock.
- AC1 Node table: boots on/off x walk/sprint x wet/dry stone. The slow step lasts exactly 0.4 s and does not re-trigger on the same stone within 1 s. 0 alloc.
- AC2 `node tools/route-walk.mjs` ford legs still PASS (route-walk walks, it does not sprint).
- AC3 the slow step plays the existing stumble/foot-splash cue only (US-055a droplets, no new FX).

**INT-HL-01 usable-thing highlight** (kestrel-2, ~1 d after the note). This is the OB-052 remainder ("maybe a faint highlight/marker on usable things in range", lane pc-b2 line 561). **ARCH-NOTE NEEDED:** where it lives (per-cell brightness/tint mask on the drawn object's cells vs a sprite glint), the GPU path (WGSL twin + gpucompare row, or UI-layer only), and how it reads the interaction set without game imports in engine. PO intended feel (default, pending owner Q1): usable things within 3 m get a slow, faint brightness pulse (+12 % max, 1.4 s period). The targeted one holds steady at +20 %. No outline, no text, no icon.
- AC1 Node: the mask covers only the cells of in-range interactables. Off when a menu/note/dialogue is open. 0 alloc per frame. <= 0.1 ms JS twin at 240x90.
- AC2 gpucompare row `interactHighlight` PASS and no existing row changes (skill `gpucompare`).
- AC3 headless stills: the tower note + the sword at 2 m, the Bend relay at 3 m, at 240x90 and 560x210.

## Order and readiness
- Ready now: FS-01 (k1), M4-C2 (k4), US-104a (k3). Queued behind them (also ready): REGION-01 (k4), QL-19b (k3).
- kestrel-2 is idle until INT-HL-01 has its note. A 5th agent (architect, opus) may write it now. The programmer starts after the note and the owner's answer to Q1 (or the PO default if the owner says "go").
- The guidance-gap table from M4-C2 feeds the next sprint's clarity fixes. Expect 1-2 small content stories from it (an objective missing at a beat, a giver out of view).

## Not in this sprint (next)
Clarity fixes from the M4-C2 gap table; EQ-22 / US-129b tier look (owner); Outwall NPCs + mq.ow.names onward (character approval); US-102 sentinel; US-054 cuttable tree; US-055b swim; US-104b Ch3 secrets.

## Owner questions
1. **INT-HL-01 look:** A) faint brightness pulse on usable things within 3 m, steady when targeted (PO default); B) a small glint mark `'` above them; C) no highlight, the wider prompt cone (OB-052) is enough.
2. **FS-01 hint list:** OK with the 7 hints above (Items, Journal, Swing, Block, Bow, Swap, Quick bar)? Should any be dropped?
3. **REGION-01:** banner on the first entry per save plus re-entry after 10 min (PO default), or only on the first entry ever?
4. **US-104a:** 4 hidden chests on this side of the river OK, or a different count?
5. Not planned, asking only: do you want a Controls page in the pause menu (a list of all keys)? This would be a new feature, so it is not in the sprint unless you say yes.

## Sprint review (PC-B PO opus, 2026-10-11; manager to ratify)

All 6 stories were implemented today. None is `done` yet: each waits for the PO verdict and, where marked, an owner look.

| id | result | status |
|---|---|---|
| FS-01 | 7 M4 action hints on the hints.js FIFO, key labels from the binding table, no Esc text | po-review (owner look: Q2 hint list) |
| M4-C2 | Ch1-2 run script + dev mode built, Node part green. The **browser run is still pending**, so there is no guidance-gap table yet | po-review once the browser run and report exist |
| US-104a | 4 hidden chests off the Ch1-2 path, deterministic generator | po-review (owner look: Q4 count) |
| REGION-01 | Region-entry banner with the approved place names | po-review (owner look: Q3 re-entry rule) |
| QL-19b | Wet ford stones slow a sprint without River Boots | po-review |
| INT-HL-01 | Faint highlight on usable things in range (architect note written) | po-review / owner look (Q1 look) |

Owner and playtester bug flow today: **33 reports (OB-045..OB-077)** went into docs/bugs.md. Most are fixed in today's commits and wait for the owner to verify them. Still open: the chargen human (OB-069/070/071), the ground look (OB-073, top priority) and a handful of world-look rows (OB-059..062).

Not done in the sprint: the guidance-gap table that should drive the clarity fixes. It needs the M4-C2 browser run, which is carried over to sprint 4.

## Missing to be playable (gap list, from bugs.md themes)
1. **First-session clarity.** Reading notes broke after the merge (OB-055). The note close key is unclear (OB-056). Notes must freeze movement (OB-057). Prompts must name the object (OB-058). There is no measured guidance-gap table yet (M4-C2 browser run).
2. **Interaction.** The `[E]` prompt picks an object that is off-screen or off to the side (OB-063, OB-066). After Esc closes pause, the mouse look does not come back (OB-068, OB-072).
3. **Ground and world look.** The ground squares shimmer and then turned into big flat blocks (OB-054/067/073). Water at the ford looks flat with hard edges (OB-062). Far trees draw as dark blobs (OB-061). A floating dark J-shape hangs in the sky (OB-059). Beams float in the air near crates (OB-060). Faces z-fight (OB-053).
4. **Combat and loot.** All fixed today, owner to verify: the sword never hit the Ford boars or wolves (OB-076, cap 16 -> 64); loot waits in the corpse until E (OB-064/074); a `Looted: X` toast replaces the big card (OB-075); HP regenerates out of combat (OB-077).
5. **Sign-off.** M4-C1 (PO batch verdict + tester on the old po-review rows) and the owner walk (QL-20 / EQ-14) have not happened yet.

**Owner walk-test request:** once OB-055 and OB-073 are in, please walk docs/sprints/m4-review-2026-10-11.md section 4 (15-20 min). On the way, check the FS-01 hints, the region banner, one hidden chest and the highlight.
