# PO batch 2 review 2026-10-09 (PC-B) - owner-authorised while PC-A offline

Scope: PC-B items finished since `po-batch-2026-10-09-pcb.md` and `po-lanec-2026-10-09.md`.
Method and limits: this PO session had only read/grep/write tools (no shell, no git log, no test runs, no browser). I read the lane logs (`docs/lanes/pc-b1.md`, `pc-b2.md`), the queue ACs (`docs/backlog.md` EP-TALK block, `docs/lanes/pc-c-add-2026-10-09c.md`), the architect's `batch-review-2026-10-09-pcb.md` (kestrel-2, batches 5 and 6), `docs/story.md`, `docs/decisions.md` D-053, `design/style-guide.md` section 0, and spot reads of code in the main tree and kestrel-1..4. Test counts are the logs' claims. Many items are still uncommitted in kestrel-1/2/4 (marked below); PO OK means "ACs met per log and code read, move to testing". It is not an owner look. Backlog rows were not edited. No commit made.

Owner rules applied: style-guide section 0 (rule 5 = never print "Esc to close" / "[Esc] close" / "Esc: leave" hints; rule 2 = four-legged animals on four legs; rule 3 = no boxy look), D-053.

## Verdicts

| Item | Verdict |
|---|---|
| BEAR-LINES-01 (story.md "EP-TALK: the bear") | PO OK (see notes) |
| NPC-BEAR-01 (k3 7112252d, a0536e4d; ARCH OK batch 6) | PO OK on code; NEEDS OWNER WALK (spot, berry bush) |
| DIALOGUE-01a1 / 01a2 (d1f0db33, 2b5f9a05) | PO OK |
| DIALOGUE-01b1 / 01b2 (e253aa06, 662af2c7) | PO OK; NEEDS OWNER WALK |
| DIALOGUE-STYLE-01 (a46bf3c2) | PO OK; NEEDS OWNER WALK (box skin) |
| NPC-TALK-ANIM-01 (552e083e) | PO OK; NEEDS OWNER WALK (closes EP-TALK) |
| Burl v2 (2c40b88f) | PO OK on stats; NEEDS OWNER WALK (look) |
| QUALITY-GRID-01 | PO OK; NEEDS OWNER WALK |
| SETTINGS-MOUNT-01 (k1, uncommitted) | PO REJECT: "Esc back" hint in the footer (style-guide rule 5). Small fix, see below |
| SETTINGS-APPLY-01 (k1, uncommitted) | PO OK for reduceMotion; textSize applies at next boot only: NEEDS OWNER decision |
| SAVE-TIME-01 (k4, uncommitted) | PO OK (closes the Continue-recency gap in po-lanec) |
| WAYSTONE-01w (k1/k2 `quest/wire/waystone.js`) | PO OK on code; NEEDS OWNER WALK + OWNER pick of anchors A/B |
| QUEST-CHAIN-02c, 5 boars (k4 + pc-b2 log) | PO OK on data; NEEDS OWNER WALK (placement) |
| COMBAT-HINT-01 (k4; main.js line `stepCombatHint` present in the main tree) | PO OK; NEEDS OWNER WALK |
| QUEST-MARK-01w (k4) + MAIN-WIRE-01 (k1) | PO OK on code; NEEDS OWNER WALK (marker at 3/12 m was never captured) |
| TELEGRAPH-STYLE-01 (k4, uncommitted) | PO OK conditional; NEEDS OWNER WALK (spec deviation, see below) |
| COMBAT-REACH-01 (k1) | PO OK; NEEDS OWNER WALK (short) |
| DEATH-FLOW-01 part 1 (7190e09) | PO OK (already in batch 1) |
| DEATH-FLOW-01 part 2 (k1, uncommitted) | PO OK; closes the open `inputLocked` point from batch 1; NEEDS OWNER WALK |
| HITSTOP 70 ms (D-053) | PO OK: `hitStopMs: 70` in `beastConfig.js`; `hitStopHard`/cap path in sword.js |
| BEAST-PERCEIVE-01w (k1 adapter) | PO OK conditional on ARCH re-check; see notes |
| BEAST-TUNING-01 (k1) | PO OK for (a)(b); story stays OPEN for the dodge AC (no dodge in code) |
| M3-EXIT-WALK-01 (`docs/test-reports/M3-exit-walk.md`) | PO OK (doc) |
| HAND-REAL-01 (9d36a143 / 02ea73f9, designer) | PO OK on spec; NEEDS OWNER WALK (look) |
| HAND-WIRE-01 (k1 `quest/handFireView.js`, uncommitted) | PO OK on code; NEEDS OWNER WALK |
| MESH-TONE-AMP-01 | PO OK; NEEDS OWNER WALK (look) |
| GRID-TEXEL-GLYPH-01a/b (k3 eee2c3a2, c4d167da; ARCH OK) | PO OK; NEEDS OWNER WALK (F1 octave pop, stone/brick/rock_soft) |
| DECAL-VIS-01 (k1, uncommitted) | PO OK; NEEDS OWNER WALK (chalk marks in dark and lit rooms) |
| CRAFT-VIEW-01 | parked (owner 2026-10-09: "leave the crafting for now"); open on C only with `?craft=1` |

## Notes behind the verdicts

**EP-TALK**
- BEAR-LINES-01: 10 lines total, 6 per path, one choice with 3 replies (<= 33 chars), a repeat line, `wave` on the greeting, `laugh` on the berry joke. All lines <= 54 chars. No "Wick", no SOS explanation (branch c only says the light is old), Wick disbelieves. Name "Burl" with a 3-sentence personality. Meets every AC. The backlog row still says `todo` and NPC-BEAR-01 says `arch-review`: flip them when the status pass is done.
- NPC-BEAR-01: collider via `components.collider {r,h}` in `World.rebuildPropColliders`, ARCH OK. Open doc follow-up from the architect (one line each in architecture 38.28 item 5 and the PROP-COLLIDE-01b amendment). Placement AC said "beside a berry bush"; the bush is `Bush_Common_Flowers` because no berry mesh exists. Owner looks at it in the walk.
- DIALOGUE-01b: input lock with `dialogueCtl.locked` is in `vLocked()`; Esc closes as an input only. The box footer is `E: next   W/S: choose`, no Esc text: complies with rule 5. Nits: `design/models/title.js:411` comment and `design/preview/dialogue-box.html:125` still show "Esc: leave" (preview fallback and comment, not in the game). Remove both next time the designer touches them.
- DIALOGUE-STYLE-01 fixes the earlier gap where the view ignored the designer palette-key skin.
- Burl v2 meets style-guide rules 2 and 3 per the commit (four legs in every clip, rounded slices, 1988 tris at LOD0, voxel-bear test 12/12). I did not see it; the owner decides.

**SETTINGS-MOUNT-01 REJECT, exact list**
1. `design/models/menu_ui.js:291` (`uiStyle.settings.full.keyHints`) is `'W/S select   A/D change   Enter toggle   Esc back'` with `keys: [..., 'Esc']`. Remove "Esc back" from `text` and `keys`. Style-guide section 0 rule 5 binds.
2. Same for the legacy panel hint `design/models/title.js:379` (`'W/S select  A/D change  Esc back'`, shown when `settings.full` is missing) and the title slot menu `menu_ui.js:151` / `game/js/ui/titleMenu.js:50` ("Esc: back" / "Esc back"; TITLE-MENU-02 on pc-c replaces the slot hints, so check after pc-c is merged).
3. The rest of the ACs are met per log: both Quality and shadows rows work, grid change applies live and is refused cleanly, `lodScale` saved and read at next boot, volume live, mute live. `settingsMount.test.js` and the filtered suites 13/13 are claimed. Also still true from po-lanec: pc-c is not merged into pc-b, so the staged cherry-picks must land in one commit.
- Also flagged (not in scope today): `game/js/ui/craftText.js:6` hint `Esc close` and `design/models/notes.js` "[E] / [Esc] close" model data. `noteRead.js` already prints an empty footer. Fix craftText before CRAFT-VIEW-01 is unparked.

**SETTINGS-APPLY-01**: `reduceMotion` is live (head bob removed, kicks 0, hurt edge and low-hp pulse static). `textSize` multiplies the UI grid at boot only, because the engine UI layer is fixed at creation (live = NEEDS ARCH). OWNER decision: accept "text size applies next launch" or ask for live. The Settings note under the row should say it, without any Esc text.

**TELEGRAPH-STYLE-01**: the AC said hot orange -> white -> off with contrast >= 3:1 on grass and dirt. The programmer found hot orange only reaches ~1.2:1 on turf and made step 1 dark ember `#3a0600`. The test passes by redefinition. This is a visible deviation: owner decides between the dark ember windup and a lighter ground-lane approach. Preview: `design/preview/telegraph.html`.

**COMBAT-HINT-01**: text is `hint.combat.dodge` ("Step aside late. Boars turn slow.", 33 chars). The block hint is skipped (no guard, US-086 is an open owner question). It polls sim state for CHASE/WINDUP/CHARGE since no `beast:aggro` event exists; fine. Once per save through `hints.shown` in `world.state`.

**BEAST-PERCEIVE-01w**: the engine part had ARCH CHANGES (rename z to y); kestrel-1 reports the rename done with beastSim hashes unchanged. I could not confirm the new test "sprinting player is heard from 1.5x walking distance" and "leash returns home" in the log: programmer to confirm they exist in `beastSim.test.js`, and an ARCH re-check is still wanted.

**BEAST-TUNING-01**: `COMBAT_TARGETS` plus 16 checks, no values changed. The AC about dodge/iframes cannot be tested because no dodge exists. Keep the story open; D-053 flat 8 ms GPU p95 is a separate perf gate.

**QUEST-CHAIN-02c**: `m1.quest.json` has `"Bring down the five wild boars"` (31 chars) with ids boar1..boar5; boars 3..5 at (1472,1050), (1452,1054), (1431,1054); chart rebaked; quest.test.js and a new `boarPlacement.test.js`. D-053 fixed the count at 5. The line in `story.md` is `obj.beasts5`; confirm the text matches the writer key exactly when merging.

**QUEST-MARK-01w + MAIN-WIRE-01**: seam getter `setQuestSource` and `main.js` wiring are in the main tree; marker pops, fades, culls at 40 m, one entity per id, zero-alloc. The AC capture at 3 m and 12 m was not made. MAIN-WIRE-01 also wires the US-073c hzb getter and craft on key C (`?craft=1` only, after the parking).

**DEATH-FLOW-01 part 2**: `vLocked()` now includes `deathFlow.inputLocked` (main.js ~883), the virtual [E] bypasses it, the old vitalsView fade and card are suppressed while the flow is active. This resolves the batch-1 question. Nit: `DEATH_LINE` is a hard-coded copy of `death.line` ("Dark again. The light still blinks.", 35 chars); it matches story.md today.

**HAND-REAL-01 / HAND-WIRE-01**: wiring is done in kestrel-1 (`handFireView.js`: idle = fireIdle, press = charge, hold, release = fireCast, otherwise chargeOut; glove stays the fallback). Matches rule 4 (fire always on, fist charges). The owner decides the look.

**MESH-TONE-AMP-01 / GRID-TEXEL-GLYPH-01 / DECAL-VIS-01**: palette tones stay within +-10 RGB; `glyph: 'texel'` is set on three materials in `design/detail-pass.js` (stone, brick, rock_soft: matches D-053); the open gpucompare run and the before/after tower capture are still main-session work. DECAL-VIS-01 floors the decal multiplier so chalk reads in dark rooms but dark scenes stay dark.

## Open items blocking a clean flip to testing
- SETTINGS-MOUNT-01: remove the "Esc back" hints (above).
- BEAST-PERCEIVE-01w: ARCH re-check and confirm the two new tests.
- Everything uncommitted in kestrel-1/2/4 (SETTINGS-*, SAVE-TIME, DECAL-VIS, COMBAT-REACH, HAND-WIRE, TELEGRAPH-STYLE, COMBAT-HINT, QUEST-MARK, DEATH-FLOW part 2) must be committed and merged into `pc-b` before testing; run `node tools/run-tests.mjs` + `node tools/check-deps.mjs` after the merge.
- Backlog hygiene: EP-TALK rows still read `todo`/`arch-review`.

## Consolidated owner walk (10 steps)
1. Boot, wake, walk out of the breach to Burl (16 m from the breach): the bear is on four legs and not boxy; it turns to you within 4 m; spot and berry bush OK. `[E] Talk`: the full first conversation with a choice, text types, jaw moves with the vowels, talk/listen/wave/laugh play, you cannot move or swing, taking damage closes it, no Esc text anywhere in the box. Talk again (repeat line). Confirm the box skin matches the menus.
2. Open Settings from the title and from pause: Quality row changes the grid live (try high and ultra), shadows, volume, mute, text size, reduce motion (turn on and check bob/shake). Report whether text size needs live apply. Check the footer shows no Esc text (this is the REJECT item).
3. Title menu: Continue picks the most recently played slot with 2+ saves; Load resumes the slot.
4. Waystone: touch it (heal, toast, save), die, and confirm you respawn at that stone; pick the anchor A or B.
5. Fight the boars (now 5; objective reads "Bring down the five wild boars"): check the placement of boars 3-5, the windup telegraph at 240x90 (dark ember step: readable or not), the first-fight dodge hint appears once, hits land (70 ms hit-stop), swinging at the practice dummy next to the wall connects.
6. Die to a boar: fade, one centred line, no old death card, input locked during the fade, respawn at the stone with full hearts.
7. The quest marker above the waystone objective at 3 m and 12 m (pop, fade, no clutter); with crafting parked, key C does nothing without `?craft=1`.
8. Cast with the realistic hand: fire burns around it all the time, closing the fist charges, release throws; knuckles and fire read at 240x90.
9. Look pass on the world: stone/brick/rock walls (per-cell glyphs, F1 octave pop while walking), tone variation on meshes, chalk decals in a dark room and a lit one.
10. Decisions needed from you: textSize live vs next launch; telegraph dark ember vs lighter; anchors A/B; chest proposal A/B (po-lanec); whether the "Esc back" hints in the legacy title and slot menus also go.
