# PO batch 2026-10-15 (PC-A, claims only)

Inputs: `batch-review-2026-10-15-pca-A.md` + `-pca-B.md` (verdicts final), PC-B handoff "2026-10-14 LATE", lane entries `docs/lanes/pc-b1.md` / `pc-b2.md` (the truth for status), `docs/bugs.md`, D-079..D-102. Nothing was run. Verdict forms: `PO OK (PC-A 2026-10-15) -> testing` (owner-visible), `done (PO, no owner test)`, `PO REJECT`, `waits: ARCH CHANGES`. Browser-only / look ACs are owner walk steps in section 3 or main-session to-dos in section 4.

## 1. Engine items (ARCH OK in the two reports)

| Item | Verdict |
|---|---|
| SWIM-SAVE-01 | done (PO, no owner test). waterZ/waterFloorZ out of the saved body, swim.js self-contained; same commit as QFIX-S6 (which waits) but this part is independent |
| VOX-PARTS-16a | done (PO, no owner test). 8-part sha pin, 12-part fixture, 0 alloc |
| VOX-PARTS-16b | waits: gpucompare `vox12` row must PASS and fill >= 400 cells (ENV-GATEFIX says PASS in the 215-row run, cell count unchecked); then done |
| VOX-REGFIX | done (PO, no owner test). rigPerf 0.0 B/frame at HEAD (arch). Note: viewModel hashes only the first 8 parts of the buffers; accepted by architect |
| ANIM-C-01 | done (PO, no owner test) |
| ANIM-C-02 | done (PO, no owner test) |
| ANIM-C-03 | done (PO, no owner test). Open frame wart (fixture nose -y vs travel +y) was settled by ANIM-C-04's yaw rule |
| NAV-REACH-01 | PO OK (PC-A 2026-10-15) -> testing. Beast holds >= 1 s at the bank facing the player, RETURN after 3 s, test for the OB-149 ford case, 0 alloc. Owner steps 8. Advisory A3: add `bankT/bankHold/partialGoal` to `hashSim` at the next golden re-pin |
| NAV-LAYERS-01a | done (PO, no owner test) |
| NAV-LAYERS-01b | done (PO, no owner test). House bake 3.4 ms cold is over the 2 ms slice: 01d must slice by source (carried into 01d) |
| ENV-03b | done (PO, no owner test). Fog fit 0.0821 <= 0.09, identity pinned |
| ENV-03c | waits: AC "GPU budget bench" (`--query atmos=0` on vs off) not run, and the visible grade waits for the ENV-03 wiring fix. Then testing with walk step 20 |
| ENV-GATEFIX | done (PO, no owner test) |
| ED-FOLIAGE-03 | done (PO, no owner test). Note for ED-FOLIAGE-04/editor: `rebuildDecor` once per stroke end, not per dab |
| ED-LOGIC-01b | done (PO, no owner test). Shipped as `zone:*` events after the 01c fix |
| LOOK-TWIN-PERF | done (PO): closed by the architect. The +8 ms target is not met (+11..13 ms), accepted because after ENV-02d-FIX item 3 the twin runs only as the oracle |

Sent back by the architect (all `waits: ARCH CHANGES`, see the "PC-A review 2026-10-15 fixes" section at the top of `docs/pc-b-queue.md`): QFIX-S6, QFIX-S6b, ANIM-C-04, ANIM-BLEND-01a, ANIM-BLEND-01b, ANIM-BLEND-01c, NAV-LAYERS-01c, ENV-02d part 2, ENV-02d part 3, ENV-02d-LIVE, ENV-03 main wiring (f2c682bf), BEAST-ALLOC-01, BEAST-ALLOC-02, BEAST-ALLOC-02b, ED-LOGIC-01a. (15 items)

## 2. Game / content / tool items (lane entries checked)

### Quest pipeline (QFIX)
| Item | Verdict |
|---|---|
| QFIX-S1 | PO OK (PC-A 2026-10-15) -> testing. R1 57 -> 0, chest on the stair top, posts/stone for notePost, knot, pierStone, gondola anchor, buried markers raised. Use a NEW GAME until QFIX-S6-FIX lands (old saves keep old positions). Steps 2, 17 |
| QFIX-S2 | PO REJECT: AC "after S1/S5 real content = 0 errors" is not met. Lane: R12 = 10 (8 tower/sea level-floor false positives that the rule does not sample + chestCrossroads coarse AABB) and R13 = 3 (hiddenScrawl, fordMark, sealedGate) and the new rules are errors, so `node tools/content-lint.mjs` still exits 1. Fix: sample level floors / use the stair top in R12, give the 3 anchors a visible model (or allow-list with a reason), real run = 0. Row QFIX-S2-FIX |
| QFIX-S3 | PO OK (PC-A 2026-10-15) -> testing. Marker z from the model top, one marker per entity, no early `?` waypoint, transitive main rule, `markRules.test` over all quests. Gap: height from real packed models never seen in a browser (steps 1, 5, 14). Owner question 5 (waypoints now have no marker) |
| QFIX-S4 | PO OK (PC-A 2026-10-15) -> testing. Hand-in before offer, active never blocks, packet = pickup = accept and consumed, drops on the ground, reward names. Open: abandoning sq.packet does not respawn it (accepted, note). Steps 12, 13 |
| QFIX-S5a-1 | PO OK (PC-A 2026-10-15) -> testing. `objectGiver` mechanism, MQ_AUTO removed, main quests Accept/Not yet + hand-in. Gap for tester: "offered persists in the save" is not claimed in the lane |
| QFIX-S5a-2 | PO OK (PC-A 2026-10-15) -> testing. Post-keeper + 12 errands, R14 89 -> 65. NPC facing/clearance not checked visually (step 11). Owner question 6 |
| QFIX-S5a-3 | PO OK (PC-A 2026-10-15) -> testing. 4 flagged object givers here (+2 in S5b = 6 = D-087), R14 lists none of the 11 ids |
| QFIX-S5a-4 | PO OK (PC-A 2026-10-15) -> testing. Rook bend.call + ford.mirror Accept/Not yet, gold `?`, hand-in. Placeholder Rook lines NEEDS WRITER |
| QFIX-S5a-5 | PO OK (PC-A 2026-10-15) -> testing. river.road / ford.stones / smoke given and taken by Rook, chain walk test |
| QFIX-S5b-1 | PO OK (PC-A 2026-10-15) -> testing. Hesk/Dorrin take the board quests, board `!` only for sq.ow.trail |
| QFIX-S5b-2 | PO OK (PC-A 2026-10-15) -> testing. Hesk (938,930) stands inside the owPath zone, no walk-back needed (TPLFIX note) |
| QFIX-S5c-1 | PO OK (PC-A 2026-10-15) -> testing. Region giver mechanism is pure data (site + sites.json + npc) |
| QFIX-S5c-2 / S5c-3 | PO OK (PC-A 2026-10-15) -> testing (counted as 2). 10 wardens 2.5-3 m from each waystone; lane advises an owner walk-check of the positions (step 18). R14 no longer lists any sq.reg.* |
| QFIX-S5-CLOSE | PO OK (PC-A 2026-10-15) -> testing. keep-light note offers via `createNoteOffer`, objectOffer.test covers all 6 givers, R14 = 0. Not browser-checked (step 1) |
| QFIX-TPLFIX | done (PO, no owner test). Test fake index fixed, data untouched |
| B1-MAIN-FIX | done (PO, no owner test). A* rebind per same-size tile; OB-117 boot line was already in |
| QPIPE-LINT-01 | done (PO, no owner test). R14 enforces character givers and the <= 10 % object-giver cap (6 of 82) |
| PLAYER-TEXT-RELAY-01 | done (PO, no owner test). R4 lints "relay" in quests incl. legacy + snippets |
| QL-19-FIX (re-submitted) | PO OK (PC-A 2026-10-15) -> testing. The reject is withdrawn: `createWetStones` + `wetStones.step` are wired in main.js before `integrate` (commit e8353fc7), test covers boots x sprint x wet and the wiring. Step 10 |
| OB-161 (one main/gold rule), OB-162 (locked slots dimmed + "Locked - learn fire first"), OB-163 (`mark.taken`), OB-164 (marker above the model, via QFIX-S3), OB-165 (hint "Its glass is gone from the mount.") | PO OK (PC-A 2026-10-15) -> testing each (5 verdicts; lane entries "OB-155/156/157", QFIX-S3, QFIX-S5a-4). `docs/bugs.md` still lists them `open`: set to `fixed <commit> - owner to test` |
| DECOR-ON-01 | NOT FOUND in the lane files, queue or bugs.md (only in the 10-14 DAY handoff text "verify-decor PASS, OB-119"). Cannot give a verdict; main session to point to the commit or lane entry |

### Legs, gait, blend
| Item | Verdict |
|---|---|
| ANIM-A-01 | PO OK (PC-A 2026-10-15) -> testing. Gait clips on boar, otter, tortoise, cub (walk + trot), rabbit (new walk, unwired), planted <= 12 mm (max 5.95 mm). Preview look, step 22. Note: boar stub legs swing 49 deg at 1.5 m/s |
| ANIM-B-01a | PO OK (PC-A 2026-10-15) -> testing. Bear + black bear 12-part knee rigs, planted 6.4 / 9.2 mm, voxel identity test. Step 22 |
| ANIM-B-01b | PO OK (PC-A 2026-10-15) -> testing. Wolf + fox. Tuned speeds are slower than the old clips (wolf run 7 -> 2.4 m/s, fox 8 -> 1.3): the sim speed relies on clip-rate scaling, check by eye (step 9) |
| ANIM-B-01c | PO OK (PC-A 2026-10-15) -> testing. Deer + goat. Deer gallop 9 -> 4.2 m/s tuned |
| ANIM-B-01d | PO OK (PC-A 2026-10-15) -> testing. Heron (stalk) + goblin (walk, run 4.0 -> 2.6, carryTorch) |
| ANIM-C-05 | PO OK (PC-A 2026-10-15) -> testing. beastLegs attaches by `legRig` (bear, black bear, now wolf/fox/goat/deer/goblin too), `?legik=0` byte-identical, 13 Node checks. Step 3 (Burl on a hill). `createLegDriver` export is the only engine touch |
| ANIM-C-05b | PO OK (PC-A 2026-10-15) -> testing. The 18.9 mm slide was a measurement artifact (stance metric), real dt fed to the driver. Main session runs `verify-legs.mjs` |
| ANIM-BLEND-02 | PO OK (PC-A 2026-10-15) -> testing for wolf, boar, goblin, goblinTorch (blend sets, hitAdd, OB-150 windup rule test). Player rig + bear are NOT done (no run/attack/hurt clips): split to new row ANIM-BLEND-02b (designer clips first). Boar charge 4.0 m/s is an estimate (step 9) |
| ANIM-BLEND-03 | PO OK (PC-A 2026-10-15) -> testing. Beast view blender, `?animblend=0` kill switch, hit -> additive; player view is a no-op until 02b. Mid-fade pop: architect answer = no 3rd source, apply the "keep the larger weight" rule only if the owner sees a pop (step 9). ANIM-BLEND-03b (closure context, 40 -> 7 B/frame) is part of this and done. Stale test in `blend.test.js` ("boar: pm.blend is null") added to ANIM-BLEND-01a-FIX |
| ANIM-C-04b (new row) | A2 advisory: the fauna feed does not drive the gait clip time from Phi yet (38.67 says it does). Small row, see queue |

### Editor and logic
| Item | Verdict |
|---|---|
| ED-QUEST-01 | done (PO, no owner test). 83 quests / 17 files byte-identical round trip, errors block writes. Own small undo stack (not commands.js), accepted |
| ED-QUEST-02 | PO OK (PC-A 2026-10-15) -> testing. List, filter, flow, form, add/reorder/delete; verify-edq-02 PASS (browser). Save in the browser = file download |
| ED-QUEST-03 | PO OK (PC-A 2026-10-15) -> testing. Pick giver/return/targets, non-character refused. Gap: `verify-edq-03` NOT run, viewport click path not browser-checked (main session) |
| ED-QUEST-03b | done (PO, no owner test). Picks write only game formats (areas.json + zone, kill kind, questPickup item) |
| ED-QUEST-04 | PO OK (PC-A 2026-10-15) -> testing. Markers, rings, pins, show-all toggle; verify-edq-04 PASS. Editor passes no `topAt` yet (default 1.55 m) |
| ED-QUEST-05 | PO REJECT: AC says giver/return/target must stand on reachable walkable ground, not a roof (R12 + nav reach) and "R12 roof target" is one of the 4 hand-broken cases. Core + `lintQuest.test` have it with an injected ctx, but the panel's `buildLintCtx` skips R5/R12 (no walkable grid/support), so the live panel never fires it; `verify-edq-05` not run. Fix: feed `floorAt` + structure tops (+ nav walkability if available) into the panel ctx and run verify-edq-05. Row ED-QUEST-05-FIX |
| ED-QUEST-06 | PO OK (PC-A 2026-10-15) -> testing. 56-char cap by characters, 15 dialogue files byte-identical, Changed text export. Deviation noted: pack data has offer/active/ready/done, no separate accept/exit key. `verify-edq-06` not run |
| ED-QUEST-07 | PO OK (PC-A 2026-10-15) -> testing for presets + "Play from here" (`?qstate=`, 4 presets, real questBook, ignored in capture/bench). The AC sub-clause "unsaved quest edits livepatched to the running game tab" is not claimed anywhere: split to ED-QUEST-07b. `verify-edq-07` not run |
| ED-QUEST-08 | NOT BUILT (owner try, no lane entry). Owner task, step 15; todo until 02..07 are in testing |
| ED-QUEST-WIRE, -DEPS, -DEPS-2, -BROWSER, 05b | done (PO, no owner test) (counted as 5 fixes). BROWSER root cause (node:fs + .mjs in the panel import graph) fixed and guarded by `questBrowserLoad.test.js`; 05b adds `resolveGiver` parity |
| ED-FOLIAGE-01 | done (PO, no owner test). Deterministic brush, every reject rule, one batch record per stroke, referrer refusal |
| ED-FOLIAGE-02 | PO OK (PC-A 2026-10-15) -> testing. Tool T, ring cursor, ghosts, one commit per stroke, undo/redo; verify-edfol-02 PASS in the browser batch. Mouse path untested by hand (step 16) |
| ED-FOLIAGE-04 | PO OK (PC-A 2026-10-15) -> testing. Decor paint/erase/reset, canonical `<key>.decorPaint.json`, game loader `decorPaintLoad.js` wired (missing file = unchanged world). `verify-edfol-04` is a stub |
| ED-FOLIAGE-05 | PO OK (PC-A 2026-10-15) -> testing. Meter = hand sum, hard-cap refusal, re-snap in the same record, 0 floating after paint + terrain edit + undo. `FOLIAGE_TRI_CAP` 1.5 M is a guess: owner question 3 |
| ED-AI-01 | PO OK (PC-A 2026-10-15) -> testing. Archetypes/kinds moved to JSON, tables deep-equal baseline, validator + round trip. Gaps: JSON `import ... with {type:'json'}` not browser-checked (needs Chrome 123+; main session must boot the game page once and read the console), edit commands/undo not mentioned in the lane |
| ED-AI-04 | done (PO, no owner test). `spawnAreas.json` ships empty = identical groups, validator in validate-content. Same JSON-import boot check as ED-AI-01 |
| ED-LOGIC-01c | done (PO, no owner test). Gate + 3 goblins in 1 step, save/load no refire, no blocks = inert in main.js. Blocker found by the kestrel (bridge double `area:entered`) is fixed. Re-run its save/load test after ED-LOGIC-01a-FIX (save shape changes) |
| ED-AI-02, ED-AI-03 | not merged (clones `edai02`, `edai03`); no verdict |

### Tooling / content cleanups
| Item | Verdict |
|---|---|
| CHARGEN-22c-FIX | done (PO, no owner test). Reject withdrawn: per-level quad stats printed by `--check` + test |
| FERRUM-NOSPRITE-01 | PO OK (PC-A 2026-10-15) -> testing. No ferrumGlow entity or generator code, test + 38.46 note. Step 21 (distant tower at night) |
| LIFE-DET-01 | done (PO, no owner test). Replay hash with `fauna:null` + stub hunt/EAT |
| SIM-RULE15-01 | done (PO, no owner test). No rule-15 warnings for the two files; member placements shifted slightly (no pinned value changed). `engine/nav/perceive.js:25` still warns, out of scope |
| WMP-03-PROBE | done (PO, no owner test). allocProbe strict; fixed a real 24 B/step garbage source |
| GATE-FLAKY-06 | done (PO, no owner test). Real garbage left open (beastSim, LIFE-07) is now covered by BEAST-ALLOC rows |
| ENV-03a | done (PO, no owner test). Config + driver, 42 checks; the look is judged under ENV-03 wiring (step 20). Table picks = preview default A, owner may change |

## 3. Owner walk-test (one list, by place; use a NEW GAME until QFIX-S6-FIX lands)

**Tower**
1. Read the keep-light note on the tower top: a gold `!` sits above it (not inside the model), Accept / Exit appears, accept -> Burl shows a gold `?`. (QFIX-S5-CLOSE, S5a-3, S3, OB-164)

**Meadow**
2. Walk the meadow and the crossroads: no floating pines, chest on top of the stair, a visible post at notePost + knot and a stone at pierStone. (QFIX-S1)
3. Walk with Burl over a hill: his legs bend, feet plant, body pitches with the slope, no sliding; try `?legik=0` to compare. (ANIM-C-05, C-05b, B-01a)
4. Stand still, then walk: the new ground look (patches, tones) is calm when still and does not flicker when walking; compare `?look=0`. (ENV-02d-LIVE, D-079)
5. After Burl gives you the road step, his `!` disappears and a `?` shows above (not inside) the Bend waystone. (OB-163, OB-164, QFIX-S3)
6. Colours: main quests gold, side quests blue, one marker per character. (OB-161, QFIX-S3)
7. Press I with fire locked: fireball and potion slots show the item dimmed, hover says "Locked - learn fire first". (OB-162)
8. Goblins on the riverbank: they stop at the bank facing you, hold about a second, then go home after about 3 s, never walk in place. (NAV-REACH-01, OB-149, OB-150)
9. Fight a wolf, a goblin and a boar: walk -> run blends without a pop, a hit while running flinches, the boar winds up readably before the charge, speeds look right (clips are slower than before). Compare `?animblend=0`. (ANIM-BLEND-02/03, ANIM-B-01b/d, OB-150)

**Ford**
10. Sprint onto a wet ford stone without River Boots: short stumble + splash; with the boots: none. (QL-19-FIX)

**Bend / post-keeper**
11. At the trade post a post-keeper stands on reachable ground with a `!`; he gives and takes the 12 bend/ford errands even though the Bend waystone is 270 m away: is that OK or do you want a second NPC? (QFIX-S5a-2, S5a-3, owner question 6)
12. Packet: picking it up accepts the quest, the item is consumed at hand-in, drops lie on the ground (no hover). (QFIX-S4)
13. Stand at an entity with a ready hand-in and a new quest: E hands in first. (QFIX-S4)
14. Rook: gold `!`, Accept / Not yet for the mirror quest, gold `?` after the objectives, reward at the hand-in talk. Ford Waystone before the mirror: hint "Its glass is gone from the mount." (QFIX-S5a-4/5, OB-165)

**Outwall**
15. Hesk shows gold `!` for path / fence / board and blue for the wolves/boars/barley/range/raid/bears errands; the notice board only offers sq.ow.trail; Dorrin takes the parcel + ford errands; the pier stone is visible and offers sq.hw.piers. (QFIX-S5b-1/2, S1)

**Regions + wardens**
16. At 3 region waystones a warden stands 2.5-3 m beside the stone (not inside, reachable), gives and takes the errand; touching the waystone never accepts. (QFIX-S5c-1..3, OB-126)

**Menus**
17. Settings / Esc menu: nothing new in this batch; just confirm the game boots and Continue works (the `?atmos=0` and `?animblend=0` switches are URL-only).

**Editor (`tools/editor`)**
18. Quests tab: open sq.burl.blue, see the flow, edit the Accept text, pick Burl as giver (a post is refused), see markers and rings in the view, live lint list, line counter "n / 56", "Play from here" with "Ready to return". (ED-QUEST-02..07)
19. Build one side quest end to end (new quest, giver + return character, 2 objectives, reward, lines under 56, lint green), save, play it from "Not started". (ED-QUEST-08)
20. Foliage tool (T): paint a forest edge (one undo step per stroke), erase near a quest-referenced object (refused), switch to decor mode and paint a flower glade, press Measure and check the meter colours, raise terrain and confirm nothing floats. Confirm or change the 1.5 M triangle cap. (ED-FOLIAGE-02/04/05, owner question 3)

**Look checks that need no new code**
21. Atmosphere (provisional, wiring has ARCH CHANGES): cross meadow -> forest, fog and grade fade over about 1.5 s, compare `?atmos=0`; look at the far tower at night for any glow card (must be none). (ENV-03a/c, FERRUM-NOSPRITE-01)

**Design previews**
22. Knee seams at rest and the gait: `design/preview/voxel_bear.html`, `black-bear.html`, `wolf.html`, `wildlife.html` (fox, deer), `goat.html`, `heron.html` (stalk), `goblin.html` (walk, run, carryTorch); and the walk clips of otter, tortoise, cub, boar. (ANIM-A-01, B-01a..d)

Owner questions still open: (1) first logic ambush, which quest / area / existing gate model; (2) "both bridges" for nav floors; (3) FOLIAGE_TRI_CAP; (4) ANIM-IK-01 player only or drop; (5) QFIX-S3 removed the waypoint marks on hand-in-less main steps (compass only), OK?; (6) post-keeper takes all 12 errands, OK?

## 4. Main-session to-dos from the gaps (not owner)
- gpucompare `vox12` PASS with >= 400 cells (VOX-PARTS-16b); refresh the rtx4060 baseline per D-039 on an idle machine.
- Run `verify-edq-03/05/06/07`, `verify-wmp05`, `verify-legs`, and boot the game page once with a clean console (ED-AI-01/04 JSON import).
- Budget benches: ENV-02d (`--query look=0`), ENV-03 / ENV-03c (`--query atmos=0`) against D-085.
- `docs/bugs.md`: OB-161..165 are stale `open`; mark `fixed <commit> - owner to test`.
- DECOR-ON-01: find the commit / lane entry (NOT FOUND here).

## 5. Tally
- PO OK -> testing: 40 (39 game/content/tool + NAV-REACH-01; the OB-161..165 fixes and the QFIX-S5c-2/3 pair counted individually).
- done (PO, no owner test): 33 (13 engine incl. LOOK-TWIN-PERF + 20 game/tool, ED-QUEST-WIRE/DEPS/DEPS-2/BROWSER/05b counted as 5).
- `waits: ARCH CHANGES`: 15. `waits` other: 2 (VOX-PARTS-16b, ENV-03c).
- PO REJECT: 2 (QFIX-S2, ED-QUEST-05). Partial splits (still PO OK for the built part): ANIM-BLEND-02 -> 02b, ED-QUEST-07 -> 07b.
- NOT FOUND / not built / not merged: DECOR-ON-01, ED-QUEST-08, ED-AI-02, ED-AI-03.
