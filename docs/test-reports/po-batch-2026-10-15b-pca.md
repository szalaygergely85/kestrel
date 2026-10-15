# PO batch 2026-10-15b (PC-A, claims only)

Inputs: `batch-review-2026-10-15-pca-C.md` (re-reviews) and `-pca-D.md` (new engine work), verdicts final; lane entries `docs/lanes/pc-b1.md` / `pc-b2.md` (truth for status); `docs/bugs.md`; owner quest rule OB-156 / D-082 / D-087 / D-108 (character giver, Accept/Exit, `?` + hand-in at a character). Nothing was run; the only file check was `game/index.html` (script tags for skeleton, crocodile, goat, tortoise, beast clips, lynx, aurochs, sb_objects are all present). Verdict forms: `PO OK (PC-A 2026-10-15b) -> testing` (owner-visible), `done (PO, no owner test)`, `PO REJECT: <why>`, `waits: ARCH CHANGES`, `waits: gate <what>`. The commit range was taken from the two arch reports and the lane entries (no git access in this run); items not found in either are listed in section 5.

Quest rule check: no change in this batch breaks the owner rule. OB-178 / OB-188 (Burl offers follow + stone, `?` and hand-in at Burl), OB-187 (blue `!` only when `requires` is met), QUEST-FORMAT (`next` only waits on the hand-in, never auto-starts) and questNext (OB-183) all keep character givers. Open gaps stay in the OWNER PRIORITY 1 rows (OB-181/182: m1 waypoint-ending steps, R17 legacy ids, no R18 yet).

## 1. Re-reviews (report C)

| Item | Verdict |
|---|---|
| QFIX-S6 / S6b | PO OK (PC-A 2026-10-15b) -> testing. Saved-only structures dropped and logged, z kept only if x/y same and \|dz\| <= 0.05, a/b/c fail when reverted. Continue is now safe to test; step 1 |
| ANIM-C-04 | done (PO, no owner test). 4/4 runs on PC-A, threshold unchanged |
| ANIM-BLEND-01a | waits: ARCH CHANGES (blend.test layered 0 B/call still 1.84-2.19 on Node 24). Row in section "PC-A review 2026-10-15b fixes". The stale "boar: pm.blend is null" expectation is still on the 01a row |
| ANIM-BLEND-01b | done (PO, no owner test). 1.0 s, totMs at pack time |
| ANIM-BLEND-01c | waits: ARCH CHANGES (animBlendLegs 0.98-1.38 B vs < 0.5) |
| NAV-LAYERS-01c | waits: ARCH CHANGES (layersFlow 24208 B / 200 iterations) |
| ENV-02d p2 / p3 / LIVE | PO OK (PC-A 2026-10-15b) -> testing. Look worlds per upload, `farVersion` bump, JS twin only as oracle (REV-MAIN). Close of ENV-02d waits: gate ENV-BUDGET (arch item 4, `--query look=0` bench). Step 3 |
| ENV-03 main wiring | PO OK (PC-A 2026-10-15b) -> testing (grade only on `!fb.gpu`, snap on world change/jump, outdoor needs terrain). ENV-03c close waits: gate ENV-BUDGET (`--query atmos=0` bench). Step 3 |
| BEAST-ALLOC-01 / 02 / 02b | waits: ARCH CHANGES (beastSim.core beast8 8.5 vs < 8; hunt LIFE-07/08 32 B, P5 102-107 vs < 100, 5.9-8.8 s). Probe length must be restored; thresholds unchanged |
| ED-LOGIC-01a | done (PO, no owner test). Save shape `[kind,argName,value]`, `r: blockId`, rev-checked pending rows; re-run the ED-LOGIC-01c save/load test is covered (logic/logicWire/farmAmbush green) |

## 2. Engine items (report D)

| Item | Verdict |
|---|---|
| VOX-PRIO-01 (OB-171) | done (PO, no owner test). Owner only watches that no character near a marker is missing (step 5) |
| LOD-RESET-01 | done (PO, no owner test). gpucompare look rows may share a world again; main session runs gpucompare |
| BEAST-06a WIRE + main hook | PO OK (PC-A 2026-10-15b) -> testing. `sim.resetSlot`, gid `<region>/<group>`, own `spawnDirector.v1` key, directorWire in main.js, save/load keeps timers. Kill a pack, leave, return later: it is back (step 9). BH2-E1 (resetAll wakes reserve groups) is its own row |
| BEAST-09a crocodiles | PO OK (PC-A 2026-10-15b) -> testing. The earlier hold is lifted: lane entry + tests exist, 4 crocs (ford, river, 2 reedmire), own group counter, `voxel_crocodile.js` tag is in index.html. Step 8 |
| BEAST-POOL-a / b | done (PO, no owner test). POOL 128, golden re-blessed once, dead/pending records stay bound |
| BEAST-POOL-c | waits: ARCH CHANGES (beastPoolWorld.test 7.3 s; keep asserts, move p50/p99 timing to bench-life) |
| SIM-SPIKE-01 | PO REJECT: AC is a per-step max <= 4 ms over 24 sim-hours in `bench-life --strict`; the lane measured only 2 sim-hours, beast max 4.7-6.9 ms (one 19.9 ms first run) and calls it GC/OS noise, so the gate is not shown to pass. Fix: run the 24 h strict gate (or a documented min-of-N), report the worst step, slice what is left (A* partial-goal back-off was named). Row SIM-SPIKE-01-FIX |
| GI-PROBE-01 / 02a / 02b / 02c / 04 / 07 | done (PO, no owner test) x6. Deterministic bake, header + hash, manifest, oracle twin. 02c ~113 B/ray is offline-only (arch ruling) |
| GI-PROBE-03 | waits: ARCH CHANGES (grid worlds never request `.gi.bin`; test hides it) |
| GI-PROBE-05 | waits: gate G1 (4 gpucompare rows `giMeadowNoon`, `giForestDusk`, `giRuinInterior`, `giEmisNight` + D-085 on-minus-off bench vs 0.25 / 0.06 ms; `GI_PRESET.medium = false` if over). Advisory A1 (GI_CACHE 8 MB) goes with it |
| GI-PROBE-06 | waits: ARCH CHANGES (GI only when `wgActive`; JS twin +3.3 ms is oracle-only) |
| GI-SHIP-01 | waits: ARCH CHANGES (blocked by GI-PROBE-03; ~5 MB of shipped files are never loaded today; headless check of `giField` after the fix) |
| UNDER-00b / 00c | done (PO, no owner test). `keepTerrain`, support gate 0.6 m, LOS/ray fix, grid physics skips with one warn |
| VOX-MESH-CACHE-01 | done (PO, no owner test). 6 builds in 1000 frames, version bump frees stale entries |
| WATER-FINISH-01a | done (PO, no owner test). Keys default 0 = byte-identical; owner stills wait for 01b (GPU). Carry the causticAt == causticHit assert into the WATER-ALLOC row |
| WATER-ALLOC-01 | waits: ARCH CHANGES (pitched 50587 B/call, riverRibbon 123 KB on Node 24) |
| CONTACT-AO-01a / 01b | done (PO, no owner test) x2. JS twin oracle-only; owner look comes with 01c hookup |
| SHADOW-TRIM-01 | waits: gate perf-pose (Intel shadow + point-shadow <= 1.5 ms at high, first point-shadow p95 recorded, gpucompare light rows unchanged, owner look at far shadows). PERF-MEASURE-02 still todo |
| HIDE-EXTREME-01 | PO OK (PC-A 2026-10-15b) -> testing. Settings list shows low / medium / high / ultra only (closes the OB-118 "secret preset"); saved `extreme` falls back to ultra. Step 1 |
| SPRITE-LIGHT-CACHE-01 | done (PO, no owner test). Main session: gpucompare parity + 20-sprite bench (-0.5 ms) |
| MESH-FEED-GRID-01 | waits: gate perf-pose (AC is >= 0.3 ms lower JS p95 at roadBend with no menu; the synthetic bench shows 1.71 -> 1.50 ms = 0.21 ms, draw-list digest identical). Not a reject yet: the real pose is unmeasured |
| WIND-GUST-01 | PO OK (PC-A 2026-10-15b) -> testing for the gust bands (forest sway ripples, calm worlds identical). The AC "leaf-fall emitter, cap 24" is not built (lane says out of the brief): split to WIND-GUST-01b. Main session re-baselines `swayWindy` once. Step 11 |
| PERF-JS-01 | done (PO, no owner test). Arch closed it (tools only); the `dimSceneRect < 2 %` table in `perf-2026-10-15.md` was not re-checked |
| WGSL-LINT-SWEEP | done (PO, no owner test) |
| ENG-API-01a..01h | done (PO, no owner test). Manifest == exports, rules 21/22 |
| ANIM-IK-01 / 01b (engine) | done (PO, no owner test): footIk 0 alloc, IK-off hash unchanged. The visible part (kit NPC feet) waits with footIkWire below |
| B1-MAIN hooks 3 (footIkWire) | waits: ARCH CHANGES (uses `world.terrain` instead of the support query) |
| ANIM-C-04b | done (PO, no owner test). Gait clip time follows Phi |
| ANIM-LOOKAT-01 | PO OK (PC-A 2026-10-15b) -> testing. NPC head follows you only while talking, beasts look at their target, `?lookat=0` off; turn direction still needs the owner look (step 7) |
| BH-A1 | done (PO, no owner test). `activateAgent` at a fixed slot, 5 asserts, replay hashes unchanged |
| ATLAS-GUARD | done (PO, no owner test). Owner just watches for missing HUD letters / black speckle |
| OB-166 (missing-species guard bca518ed) | done (PO, no owner test) for the guard; bug OB-166 stays open until the owner gives URL + first console error |
| GATE-FIX-7/9/12/13, GATE-FLAKY-08, CAPTURE-NOPAUSE, BENCH-LIFE-GOB08, LINT-WARN-01, integ test fixes | done (PO, no owner test), test/tool only |

## 3. Game / content / tool items

### Owner bugs (OB-1xx)
| Item | Verdict |
|---|---|
| OB-174 `choiceFlag` | PO OK (PC-A 2026-10-15b) -> testing. E = next / accept, Q = close, Q consumed (no lock-on toggle), hints say so. Step 4 |
| OB-135 plain names | PO OK (PC-A 2026-10-15b) -> testing. 556 strings audited, 0 findings. Owner question: "Health Orb" / "Mana Orb" (the rule's own example was Health Potion) and the lore names Blue Sprig, Red Cap, Waystone Glass, Teal Crystal. Step 14 |
| OB-141 west POIs | PO OK (PC-A 2026-10-15b) -> testing. 4 west POIs + 14 region look-at POIs (>= 4 per km2 per region), existing meshes. Texts note.westRuin / westStones <= 56 chars; note.poi.* texts are generator copy, writer should read them. Walk coordinates in step 12 |
| OB-150 steps 2-4, level scaling, KINDS-F | PO OK (PC-A 2026-10-15b) -> testing. Boar / wolf / bear / goblin hit a walking player, flank + 2 tokens, hp +25 % / dmg +12 % per level, kinds hpF/dmgF wired (the earlier "no entry" reject is lifted). Difficulty menu is mostly dead: row BH2-G1. Step 6 |
| OB-152 / earned chests | PO OK (PC-A 2026-10-15b) -> testing. 15 -> 11 chests, 0 loose in the old world, all in camps / ruins / puzzles. See OB152-DENSITY below: the gate is red for the new cellar/crypt chests. Step 13 |
| OB152-DENSITY | PO REJECT: the tool's `--max-loose 0` sub-check fails again since UNDER-03 (ford chestCellar1-3 counted as loose; the lane says "not investigated"), so the rule-of-record gate for "chests are earned" is red. Fix: grid-level interiors (cellar, crypt, `keepTerrain` sites) count as places (or the cellar loot are crates, not chests); test stays at 0 loose. Row OB152-DENSITY-FIX |
| OB-153 bestiary | PO OK (PC-A 2026-10-15b) -> testing. 15 kinds spawn (was 5), lynx + aurochs + skeleton models, goat / tortoise / deer / fox hurt-die-windup clips + CLIP-WIRE, 4 legs, existing palette keys; all script tags present. Not run per the designer entries: `run-tests --filter voxel,lynx,aurochs,skeleton` (main session to-do). Step 10 |
| OB-178 follow offered | PO OK (PC-A 2026-10-15b) -> testing. Burl offers burl.follow after the boar hand-in (Accept E / Exit Q), walks only after Accept, hand-in at Burl. Text lines follow.go / later NEEDS WRITER. Step 5 |
| OB-179 chests | PO OK (PC-A 2026-10-15b) -> testing. 15 -> 10, tools retired for deleted ids; heart-piece chests moved up to ~450 m: read the hint texts. Step 13 |
| OB-180 lamp flame | PO OK (PC-A 2026-10-15b) -> testing. Billboard flame in the cage (D-104), no voxel slab. Step 15 |
| OB-183 never stuck | PO OK (PC-A 2026-10-15b) -> testing for the "Next: talk to <Giver> (<place>)" line + compass pick. OB-183 itself stays open: hand-ins naming the next giver are part of OWNER PRIORITY 1. Step 5 |
| OB-184 undergrowth + clustering (184b) | PO OK (PC-A 2026-10-15b) -> testing. Existing meshes only, fill-only cluster multiply, arch validation done. Step 11 |
| SAPLINGS | PO OK (PC-A 2026-10-15b) -> testing. 569 saplings at 0.3-0.5 scale near trunks; no GPU/browser check was run. Step 11 |
| OB-184 forest ambience | PO OK (PC-A 2026-10-15b) -> testing. Wind, 3 bird patterns, woodpecker, night owls + crickets, quiet; never heard in a browser. Step 11 |
| OB-184 forest floor look | PO OK (PC-A 2026-10-15b) -> testing. "Mossy leaf litter" variant D, brightened after the luma probe; no gpucompare run. Step 11. OB-184 stays open for animals, light shafts (CANOPY-SHAFT rows), paths |
| OB-185 enemy density | PO OK (PC-A 2026-10-15b) -> testing. 85 / km2, longest empty road 175 m, MAX_BEASTS 320 (pool-backed now). Step 6 |
| OB-186 offer without list | PO OK (PC-A 2026-10-15b) -> testing. Paging E is swallowed (`offerArmed`). Step 5 |
| OB-187 blue `!` | PO OK (PC-A 2026-10-15b) -> testing. Gondola quest waits on burl.stone done. Step 5 |
| OB-188 waystone wake | PO OK (PC-A 2026-10-15b) -> testing. `requires` removed, prompt names the missing step, collider added. `verify-ob188.mjs` was written, not run: main-session to-do before the walk. Step 5 |
| OB-189 close-wall stripes | PO OK (PC-A 2026-10-15b) -> testing. Level 1-2 alternates in design/detail-pass.js, one MaterialTable for both twins; gpucompare goldens re-baselined once. Step 11 |
| OB-190 tracker | PO OK (PC-A 2026-10-15b) -> testing. HUD_ROW 4, test covers it. Step 5 |
| OB-175, OB-176, OB-181, OB-182 | no verdict, still open (OB-175 not reproduced, needs the owner's F3 line + clock + position; OB-176 owner retest; OB-181/182 = OWNER PRIORITY 1) |

### EP-UNDER (OB-191)
| Item | Verdict |
|---|---|
| OB-191 skeleton models + cemetery | PO OK (PC-A 2026-10-15b) -> testing. Warrior + archer rig with 10 clips incl. `rise`, 17 graves, fence, crypt facade; sb_objects tag present. Step 16 |
| UNDER-01 | PO OK (PC-A 2026-10-15b) -> testing. 3 at the cemetery at night, ruin pair in the whitecombs ruin, |dz| < 3 rule, 26 asserts; wired in main (hooks 6). The AC's dust puff on rise is not claimed: owner looks (step 16) |
| UNDER-02 | PO OK (PC-A 2026-10-15b) -> testing. Sealed door + Crypt Key, stair, 3 rooms, 7 torches, 5 skeletons, ONE chest only after the rooms are cleared (earned), flags saved, verify-under PASS 5/5. Deviation: the reward is arrows + potion + sturdy gear (no coin item and no heart piece; the AC asked for heart piece + coins): owner question. The key comes from UNDER-07, so test with `?dev=1` `window.__kestrel.giveItem('key.crypt')`. Step 17 |
| UNDER-03 (+ engine part) | PO OK (PC-A 2026-10-15b) -> testing. Trapdoor ladder in the Ford stall, 6x6 cellar, 5 crates, lamp, 3 loot containers, no beasts, flags saved. The lore note is a placeholder (NEEDS WRITER). Step 18 |
| UNDER-07 | PO REJECT: not built. Only the writer draft (Bram, "Restless Graves" + "The Sealed Crypt") exists in docs/story.md; there are no quest files. Build to the draft (it already follows the rule: Bram `!`, Accept / Exit, `?` and hand-in at Bram, 2 quests, nothing auto-starts) after the owner approves the text. Row stays todo |
| UNDER-08 | PO OK (PC-A 2026-10-15b) -> testing for the cemetery bed (wind, crow, night bell) and the cave/crypt bed (room tone, drips 1-5 s), 1.5 s crossfade, synth only. Deviation: no footstep / sword echo (no send bus); AC1 echo is open, accepted until the audio bus exists. Steps 16, 17 |

### Quest pipeline, text, tools, bug hunt
| Item | Verdict |
|---|---|
| QFIX-S2-FIX | done (PO, no owner test). The reject is withdrawn: R12 samples level floors and exact triangle tops, exception map 13 -> 4 with reasons, R13 anchors have a mesh, `content-lint` exit 0 |
| QUEST-FORMAT | done (PO, no owner test). Infra, `next` waits on the hand-in and never auto-starts, R17 (12 legacy ids WARN until the chain rewrite). Note: no rule yet that every quest has a character turnIn (R18 = QUEST-HANDIN-ALL) |
| WMP-10-APPLY | PO OK (PC-A 2026-10-15b) -> testing. Banner names roadWest / outwall, 10 region journals, `RELAY_WAKE.ws_highPastures`, ambient cue names. The travel header + TOAST consts in travel.js are not wired in main.js yet (carried, no owner step). Step 14 |
| TEXT-BATCH3-APPLY | PO OK (PC-A 2026-10-15b) -> testing. Farm ambush hint ("The gate slams shut. Goblins!"), 3 waystone hints, rook.ford.6 / .8 ("Look on the floor") and rook.mirror.active. Step 13 |
| ENGINE-GUIDE-01 | done (PO, no owner test). Guide + sample + test; the sample draw was fixed (createFrameRenderer) and `verify-engine-sample` PASS 7534 cells |
| BH-S1 / S2 / S3 | done (PO, no owner test) x1. Three save round trips, each fails on HEAD without the fix |
| BH-S4 + BH-S5 | done (PO, no owner test). Camp respawn emits `beast:respawned`; the director and regional packs must emit it too (arch note in the lane): carry into BH2-E1 |
| BH-S6 + BH-S7 | done (PO, no owner test) |
| BH-A2 / A3 / A4 | done (PO, no owner test). beastSim only, goldens unchanged |
| ED-QUEST-05-FIX | done (PO, no owner test). The reject is withdrawn: floorAt + walkable + structure tops feed R5 / R12, `verify-edq-05` PASS |
| ED-QUEST-07b | PO OK (PC-A 2026-10-15b) -> testing. Editor edits live-patch the running game tab; `verify-edq-07` PASS; the game-tab re-talk was not browser-checked. Step 19 |
| ED-LOGIC-01d | PO OK (PC-A 2026-10-15b) -> testing. Farm gate leaf closes + 3 goblins, no refire, save/load, R15 0 findings. Door hinge visual unverified. Step 13 |
| DLG-REPEAT | done (PO, no owner test) |
| BEAR-BITE | PO OK (PC-A 2026-10-15b) -> testing. Black bear bite 2 hearts at 200 ms, hit once, light hit does not cancel; alloc fixed by BITE-ALLOC (beast8 3.0 B/step, simShape guard). Step 6 |
| FOLIAGE-CAP-CONFIG + EDITOR-PATH-SMOKE | done (PO, no owner test). Cap in `content/editor/foliage.json` (owner question 3 is now a data edit) |

## 4. Owner walk-test (one list, by place; Continue is fine after QFIX-S6, New Game only where noted)

**Menu**
1. Continue an OLD save: it boots, no floating structures, quest and tracked quest are as you left them. Settings > quality cycles low / medium / high / ultra only (no secret 5th). (QFIX-S6, HIDE-EXTREME-01, OB-118)
2. Fresh clean console on load (JSON imports, `.gi.bin` is not requested yet). Look at nothing else in settings.

**Tower and meadow**
3. Stand still, then walk, on grass: ground look is calm and does not flicker; compare `?look=0`. At dawn / dusk cross meadow to forest: fog + grade fade in about 1.5 s (`?atmos=0` to compare). (ENV-02d, ENV-03)
4. Read the keep-light note and any sign or conversation: E = next / accept, Q = close, Q does not toggle lock-on. (OB-174)
5. Burl: boar hand-in, then the follow offer: Accept / Exit, no numbered list, the E that paged does not accept; Burl walks only after Accept; the objective shows top-left under the MP bar; at the meadow stone you cannot walk through it, E wakes it, `?` over Burl, hand-in; no blue `!` over the gondola until the stone is done. Then "Next: talk to ..." appears when nothing is active. (OB-178/186/187/188/190/183)

**Fights**
6. Walk away from a boar, wolf, bear, goblin: they catch and hit you; wolves flank; running escapes; an enemy every ~175 m on roads; far-zone enemies hit harder; black bear bites close in. (OB-150, OB-185, BEAR-BITE)
7. Talk to an NPC: the head turns to you only while talking; a nearby beast looks at its target. (ANIM-LOOKAT-01)
8. Ford / river: crocodiles in the water (1021,1025) and the river; a grab pins your movement, mash to break free. (BEAST-09a)
9. Kill a pack, walk away 3+ minutes, come back, and Continue once in between: the pack respawns, no id shuffle. (BEAST-06a)
10. Look for lynx, aurochs, deer, fox, mountain goat, snapping turtle: they walk on four legs and hurt / die / wind up without freezing. (OB-153)

**Forest**
11. Forest floor: mossy litter, ferns, bushes, mushrooms, saplings, clustering at trunks, wind + birds by day, owls + crickets at night; at a low-res wall (wreck, forestWalk) no light stripes; gust ripples run through crowns. (OB-184, SAPLINGS, OB-189, WIND-GUST-01)

**Ford and west**
12. Ford house (stall 1000,1060): see step 19. West of the ford: ruined gatehouse note (952,1093), standing stones (870,1100), goblin camp (880,1012) + guarded chest (878,1018), wagon (1020,1144). Region POIs: (1740,200), (252,514), (1360,950), (1480,1240), (1490,570). (OB-141)
13. Rook ruin (~976,1060): chests and nest on the floor inside, hint says "Look on the floor"; chests only in camps / ruins / puzzles (ford ruin room, campNorth 922,902, campEast 962,972); farm gate: the "The gate slams shut. Goblins!" ambush closes and opens. (OB-152, OB-179, TEXT-BATCH3, ED-LOGIC-01d)
14. Names: Old Sword, Health Orb, Mana Orb, Bomb, Brass Shield, Lantern, Fireball: plain enough, or should "Orb" be "Potion"? Region banners roadWest / outwall and the region journals read well. (OB-135, WMP-10)
15. Tower lamp on the crate: a real flame billboard in the cage, no flat slab. (OB-180)

**Cemetery, crypt, cellar (EP-UNDER)**
16. Cemetery (1644,1372) at night: graves, 3 skeletons rise (dust puff?) within 30 m, none pop in at < 8 m; at dawn they sink; one you kill stays dead until the next night; wind, crow, distant bell. Whitecombs ruin (1740,200) holds an idle pair. (UNDER-01, UNDER-08, OB-191)
17. Crypt: open with `?dev=1` then `window.__kestrel.giveItem('key.crypt')`; stair down has no snag, 3 rooms, torches, drips, 5 skeletons, the chest opens only after they are dead; leave, Save, Continue: door + chest state kept. Is the reward (arrows, potion, gear, no heart piece / coins) OK? (UNDER-02)
18. Ford stall trapdoor: E climbs down in 0.3 s, 6x6 cellar, crates + lamp, a note (placeholder text), loot stays taken after Continue. (UNDER-03)

**Editor**
19. Quests tab: edit an Accept line, switch to the game tab, re-talk: the new text shows without reload. (ED-QUEST-07b)

## 5. Not verdicted here (no lane entry or not in the arch reports)
SCENE-INTERIOR-2 (untuned on real meshes, needs a walk), CANOPY-SHAFT / NIGHT-SKY / CLOUD-FLUFF / WATER-FINISH-01b / ED-AI-05 (on branches or queued, not in report D), BEAST-08a/08b, NAV-LAYERS-01d ford, DECOR-ON-01 (still not found). OB-175 and OB-176 have no fix to review.

## 6. Main-session to-dos from the gaps (not owner)
- G1 for GI-PROBE-05, `?gpucompare=1` after the merge (re-baseline `swayWindy`, water rows, cloud/atmos rows once per D-039), perf-pose for MESH-FEED-GRID-01 / SHADOW-TRIM-01 / PERF-MEASURE-02, ENV-BUDGET (`look=0`, `atmos=0` benches).
- Run `node tools/verify-ob188.mjs`, `verify-edq-07`, and `node tools/run-tests.mjs --filter voxel,lynx,aurochs,skeleton,goat`, then `validate-content` (designer entries had no shell).
- After GI-PROBE-03-FIX: headless check that `world.giField` is non-null in the start zone (GI-SHIP-01).
- `docs/bugs.md`: statuses updated for the OB rows verdicted above.

## 7. Tally
- PO OK -> testing: 38
- done (PO, no owner test): 37
- waits: ARCH CHANGES: 10 (ANIM-BLEND-01a, 01c, NAV-LAYERS-01c, BEAST-ALLOC, BEAST-POOL-c, GI-PROBE-03, GI-PROBE-06, GI-SHIP-01, WATER-ALLOC-01, footIkWire)
- waits: gate: 3 (GI-PROBE-05 G1, SHADOW-TRIM-01, MESH-FEED-GRID-01) + ENV-02d / ENV-03c closes on ENV-BUDGET
- PO REJECT: 3 (SIM-SPIKE-01, OB152-DENSITY, UNDER-07)
- Withdrawn rejects: QFIX-S2, ED-QUEST-05, OB-150 level scaling / KINDS-F, BEAST-09a hold
