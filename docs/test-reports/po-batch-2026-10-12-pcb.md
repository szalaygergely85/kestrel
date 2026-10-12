# PO batch 2026-10-12 (PC-B PO, D-066) - M4-C1 + today's po-review items

Basis: lane entries in docs/lanes/pc-b1.md and the row text in docs/pc-b-queue.md. Code was not re-run. Verdicts rest on the lane evidence (Node suites, notes) plus a spot read of the ACs.

## A. Old po-review rows (M4-C1)
Already marked PO OK in the queue (2026-10-11), so no change needed: EQ-01, 02, 08, 10, 11, 13; QL-02, 04, 08, 13, 14, 15, 18.
Already PO OK pending owner look: EQ-D1, EQ-07, EQ-09, MAP-02, MAP-03, MAP-05, QL-07.
MAP-04 is PO OK and ARCH OK.

Rows still at po-review, now judged:
- QL-09 (wreck.plate), QL-10 (honey), QL-11 (rook.shiny), QL-12 (packet): PO OK. Each is a quest-pack row, with anchors from gen-poi-props and quest-sim 51/51. Shell-only (the Node quest-sim passes, but nobody has played them). They are covered by the verify-ch12-run E+ pass (M4-C2b).
- QL-16 (ford.mirror): PO OK. The River Boots chest is added, the item is unique and loot rolls are unchanged (tested). Owner look: the nest-roof chest is reachable.
- M4-C3 (MAP-28 labels, MAP-14 leg 10): PO OK. Route-walk leg 10 PASS: 8 swaps, no band:late, no fall, max swap 1.1 ms. Pose lakeEdge JS p95 7.2 ms, under the 8 ms limit.
- EQ-03, EQ-12, QL-01, QL-03, QL-05, QL-06, QL-17, QL-19, MAP-07..09: their status text was omitted from my grep (long lines). Not verified here, so PO OK is NOT given. The main session should open those rows.
- Not PO-reviewable: EQ-04/05/06 are "ready" (not built). EQ-14 and QL-20 are owner walks.

## B. Today's items
- QL-22 texts (8062dcec): PO OK. Four quests are applied, the `parcel` item name is capped at 14 characters and validate-content is OK. sq.ow.barley and sq.ow.range are NOT applied, so QL-22 is only partly done (needs the writer or an owner decision on givers). Rows stay open for those two.
- M4-W1 (c2133083): needs browser. Run `node tools/verify-m4-walk.mjs --port 9725` (or `--stills-only`). The Node side is fine. The stop poses are estimates, so a pose tweak is expected after the first look.
- M4-C2b (00671c75): needs browser. Run `node tools/verify-ch12-run.mjs 9725`, and with `--walk`. Not run since the E+ pass was added. AC1 is not proven until it has been run, and FORCED lines are expected. PO OK is on hold until the report lists what is left.
- FB-02 (431f8c95 + 29b6c067): PO OK pending owner look. Emberpod1 was moved to (1043,1044); pods 2 and 3 are clean in Node. The prerequisite is changed to mq.ford.mirror. The 13 burlFire checks pass. Owner should check: the pods sit in "Cinder Hollow" (temporary), the Burl's Ember quest text, and that fireball unlocks and the MP bar appears after turn-in. The turn-in narration sits in `lines.ready` (writer/PO note, acceptable).
- FB-03 (8f6f66ec): PO OK pending owner look. The main.js wiring is done per the commit. Owner should check: the "[Hold <key>] charge fire. Let go: throw." hint text and its timing, the MP bar fade-in (0.6 s), and that locked cells show empty or dimmed before the unlock. Not browser-tested.
- BEAR-D1/D2 (8410e50c, 46ce693b): PO OK pending owner look. Run `node tools/voxel-bear-black.test.mjs` and `node tools/validate-content.mjs` (the designer had no shell). Owner should check design/preview/black-bear.html: the coat reads as black at 10 m and 20 m, and the all-fours bluff windup with paw stomps reads as a threat (it replaces the spec's rear-up, per the owner's no-rear-up ruling). Palette keys furBear* are still interim until appended to palette.js and detail-pass.js.
- OB-083 v8 shapes (5bda43ba): needs a main-session run before any verdict. The kit JSON is not rebuilt and no suite was run. The v7 backup, build and tests are in the lane NEEDS list. Owner look afterwards: the 21-cell square shoulders, flat blocks and 14 % skull on the chargen_kit.html v8/v7 switch.
- OB-086 demo char (61f33902): no lane entry found and I did not read the commit. No verdict; the main session should supply its evidence.

## C. Still blocking M4 close
1. Rows whose status I could not read (see A) need a verdict.
2. The M4-C2b browser run (CL-01 AC1 coverage, ~25 quests untouched or FORCED) and the M4-W1 stills.
3. The OB-083 rebuild and tests, plus BEAR-D2 validate-content.
4. Owner looks: EQ-D1/07/09, MAP-02/03/05, QL-07, FB-02/03, bears and OB-083. Then EQ-14 and QL-20 walks.
5. QL-22 barley and range texts.
6. Walk-only FAILs: E3, E5 and the AC3b tracked count.

## Main-session corrections (2026-10-12)
- OB-083: the kit WAS rebuilt and tested (5bda43ba: human.charkit.json v8, 1444 quads, chargen suites + validate-content PASS, gltf/fbx goldens re-pinned, Mixamo export re-centred 52077832) -> PO OK pending owner look (owner already looked in game, OB-086: wants more; v8b proposed).
- BEAR-D1/D2: tests were run by the main session (voxel-bear-black 8/8, validate-content OK).
- OB-086: demo character next to Burl (61f33902), ARCH OK with notes (batch-review-2026-10-12b) -> PO OK pending owner look (owner looked).
