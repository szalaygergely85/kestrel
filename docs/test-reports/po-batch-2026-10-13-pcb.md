# PO batch review 2026-10-13, PC-B (PC-B PO sonnet 2026-10-13)

Claims-only (arch-batch-review PO rules): nothing was run. Sources: sprint-5 ACs, architecture.md 38.54/38.56 step rows, 2026-10-13 lane entries in kestrel-1..4 (`pc-b1.md`, `pc-b2.md`) and `backlog.md` header.
Known deviations accepted for this batch: swim/eat/monster clips only just landed from the designer (not wired to entities), villagers Sorrel/Pell/Tam have no entities, `char.kit` has only idle/walk clips (work/talk fall back to idle), raids are flavour-only (owner question open: lost raid has no cost).
Browser/GPU gaps are explicit owner or main-session to-dos (marked TODO), not passes.

Result: 25 PO OK -> testing, 3 PO REJECT (BURL-HOME-01, SWIM-04d, OUT-03).

## Verdicts

- CH12-AC3B-01: PO OK -> testing. questSaveV2 now keeps the accept-order `s:<seq>`; test fails with the fix reverted. Walk: accept two quests, save, Continue, check the tracked quest is the last accepted. TODO main session: `node tools/verify-ch12-run.mjs <port>`, AC3b diff must be gone.
- BURL-HOME-01: PO REJECT: only a WIP on origin/burl-home-talk (d7d4341a), agent stopped at shutdown, not verified, test unfinished, `verify-ch12-run` E1-E6 not run, and there is no 2026-10-13 completion report. Back to programmer.
- CH12-RUN-02: PO OK -> testing (tools, Node only). The script finds pickups and loot, and AC3b waits are longer. TODO main session: run `verify-ch12-run.mjs`. The open `cog`/`emberpod` bug is covered by CH12-CONTENT-01.
- CH12-CONTENT-01: PO OK -> testing. Cog and emberpod are valid; the only loss path (full 24-slot pack) now drops the item at the feet with an `inventory:full` toast, tested. Walk: fill the pack, accept the cog quest, and the cog drops at your feet. TODO: browser run shows "pack slots used".
- OB-104 (pose): PO OK -> testing. The lakeEdge pose moved to the south shore (1215,556); the cliff notch is real geometry, handled by OB-104b (JS and WGSL twins, in arch-review). Walk: open the dev pose lakeEdge. TODO: look at `ob104-lakeEdge.png`; the notch at (1237,606) is still reachable (see OB-104b).
- OUT-01: PO OK -> testing. Hesk and Dorrin turn to face you within 6 m, and `ow.*.met` flags are saved. Walk: approach Hesk and Dorrin at Outwall and see them turn, talk once, reload and the flag is kept. Placeholder lines are "NEEDS WRITER".
- OUT-02: PO OK -> testing. The routine table plus test are in; the data file is `outwall.life.json`. Sorrel/Pell/Tam have no mesh (known). Walk: see Hesk and Dorrin move between their stops over a day (live only via LIFE-04).
- OUT-03: PO REJECT: nothing the player can see or talk to. No entity was placed or registered (4 animal models are not in index.html, 5 humans have no model), and all 4 anchors lie outside world_m1. Only the PENDING table and its test exist. Park as blocked on designer registration and a larger world; back to the backlog, not testing.
- QL-23: PO OK -> testing. 6 west-bank errands in the ch3b pack (errands2 47 pass, validate-content OK, quest-sim 72/72). Rows needing absent NPCs and items were skipped (accepted). Walk: take the notes at the Outwall board and finish sq.ow.night (kill the 5 wolves) and sq.ow.letters. Prose is "NEEDS WRITER".
- SWIM-02: PO OK -> testing. The stamina module drains 12 s swim / 6 s dive, refills 25/s, drowns 1 heart per 1.5 s, and is tested. Seen only through SWIM-05.
- SWIM-06a: PO OK -> testing. Pure sea-edge trigger (warn 60 / kill 90 / hyst 6). Seen only through SWIM-06b. Note: cliff coasts read as kill.
- SWIM-03b: PO OK -> testing. swimFeed and wading changes tested on the real Braid and Glasswater. Walk: wade into the Braid, you swim, with no rescue or teleport.
- SWIM-03c: PO OK -> testing. Wired in main.js: gear is stowed and the hand gate shuts while swimming. TODO main session: run `verify-swim.mjs` once (written, not run; the Braid is only 1.44 m deep, so the eye stays above water).
- SWIM-05: PO OK -> testing. The 12-cell ring, `vitals.kill` and `deathCause 'drown'` are tested, and the main.js hook is in SWIM-HOOKS-01. TODO owner: ring look and position unchecked in the browser.
- SWIM-06b: PO OK -> testing (logic). Hidden/circle/rise/strike with `vitals.kill('eaten')` is tested on the real sea. Known deviation: the entity is not placed and the model is not registered, so the monster is invisible and you only see ripples and the "eaten" death. TODO designer/B1: register `seaMonster` and place the entity.
- SWIM-04d: PO REJECT: dive key (`dive` action) and `swimInput.js` exist, but the lane says "NEEDS B1-main" (`controls.swimUp = swimUpOf(...)` per step) and SWIM-03c says swimUp is untouched (0). Nobody has wired it into main.js, so you cannot dive and the lake-bed chest `chestBed` cannot be opened in the game. Wire it (about 3 lines), then resubmit. Also unchecked: no settings or key-hint entry.
- SWIM-HOOKS-01: PO OK -> testing (Node only, main.js +6 lines). Walk: swim in the Braid for more than 12 s and you drown; swim far out in the sea and you get "eaten"; respawn resets the ring. TODO: the stamina ring look is unverified (`verify-swim.mjs`, not run).
- LIFE-02: PO OK -> testing. Schedule and needs logic and data are in (0.4 s test). Seen only through LIFE-04.
- LIFE-03: PO OK -> testing. Villagers move on schedule (A* at most 1 per step, bands, flee on `npcHit`, sleep). The test takes 12-16 s (above the hope). Seen through LIFE-04.
- LIFE-04: PO OK -> testing. Hesk and Dorrin walk and sleep on a schedule; the others are skipped (known). Walk: stay at Outwall from day to night. Deviation accepted: work/talk use idle.
- LIFE-04-COLLIDE: PO OK -> testing. `ensureBandFor` is no longer called (spy = 0 calls), and the talk interactable follows the NPC. Walk: talk to Hesk while he walks.
- LIFE-05: PO OK -> testing. Chat pairs (at most 3 m, social > 0.5, 90 s cooldown, barks within 8 m). Walk: stand 5 m from two chatting villagers and hear or see the bark lines. Lines are all "NEEDS WRITER" (the writer's villager chats exist in story.md and still need wiring).
- LIFE-07: PO OK -> testing. Wolf and bear hunt rabbit and deer, `STATE_EAT` (8 s), and the fox hunts the rabbit. Wired via LIFE-HOOKS-01. Walk: watch a wolf chase a deer in the woods. The eat clips just landed from the designer, and `beastView` still plays idle (TODO designer/B1).
- LIFE-08: PO OK -> testing. Goal wolf, alt-target hit, raids with a night roll, save keys. Raids are flavour-only (no cost for a lost raid; owner question open).
- LIFE-09: PO OK -> testing. `raids.json` (gooseFarm) and the quest `sq.ow.raid` are in. The accept-flag question is answered in HOOKS-01 (`q.<id>.accept` is mapped to `life.gate.<id>`). Deviation: no `area` objective. Walk: accept "Defend the Farm" at the board, wait at night at the goose pen, fight the wolves. Prose is "NEEDS WRITER".
- LIFE-10: PO OK -> testing. `tools/bench-life.mjs` PASS on all budget rows. Flags noted: beastSim 0.47-0.69 ms (32 beasts), raid extras not separable (INFO), a 24-villager budget is assumed but only 5 are benched. TODO: full 24 h run not done.
- LIFE-HOOKS-01: PO OK -> testing. main.js +6 lines, lifeWire day counter and gate sync, raids wired with the accept-flag fix. `beastSim.test` timed out under load (60 s) with unchanged code, so rerun it quiet. TODO main session: `verify-raid.mjs` and `verify-outwall-life.mjs` (need `save=1`) not run.
- M4-WALK-FIX-01: PO OK -> testing (tools only). The run-tests step uses `--expose-gc` and retries failures once; stops take poses from GATE_POSES slugs (stop 8 still an estimate). TODO main session: `node tools/verify-m4-walk.mjs --port <port>` end-to-end.

## Owner walk-test for today's features (play order)

1. Swim: walk into the Braid and Glasswater; you switch to swimming with no teleport, sword/bow/shield vanish, a tint appears under the surface. Climb out on a shelf.
2. Dive (only after SWIM-04d is wired): hold the dive key (LCtrl), swim to the Glasswater bed (about 1240,505) and open the bed chest (needs bottom, 10 arrows + sturdy gear).
3. Stamina and drown: stay swimming; the ring under the MP bar drains (12 s swim, 6 s dive), then 1 heart per 1.5 s, death cause "drown"; leaving the water refills it.
4. Sea monster: swim out from the beach past about 60 m (warning) and 90 m (kill) on the Long Strand; expect ripples, then "eaten" (no monster body until the model is placed).
5. Outwall by day: Hesk and Dorrin turn to you within 6 m, talk once (first-talk flag, saved), then reload to confirm it is kept.
6. Outwall day/night: wait or use `?time=`; they walk to their stops, hide and sleep at night, and the talk prompt follows them.
7. Chats: stay 5-8 m from two villagers and watch them pair, turn and bark (placeholder text).
8. Wolves hunting: in the woods, watch a wolf hunt a rabbit or deer and eat it; the player noticing pre-empts it.
9. Defend the Farm: accept sq.ow.raid at the Outwall board, stay at the goose pen from 21:00 to 05:00 (35 % per night, cooldown 2 days), kill the wolves, claim 2 potions + 15 arrows. Also the 6 west-bank errands (QL-23).
10. Also check Continue keeps the tracked quest (CH12-AC3B-01) and the lakeEdge pose (OB-104).

## Main-session note (2026-10-13)
- **BURL-HOME-01 reject is a reading error:** the PO read kestrel-1's lane file on the texts-1013 branch, which lacks the entry. The item is finished in commit 22112b0c (kestrel-1, branch burl-home-talk) and the browser gate passed: `verify-ch12-run` re-run = beats 1-14 + E1-E6 PASS (scratchpad ch12-rerun.log). Treat as **PO OK -> testing** (main session, evidence-based).
- **SWIM-04d** reject stands until the main.js swimUp/jump line lands (queued for the main.js holder).
- **OUT-03** reject stands: blocked by world bounds (anchors outside world_m1), not a code fault.
