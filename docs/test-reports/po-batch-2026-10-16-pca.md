# PO batch 2026-10-16 (PC-A, sonnet, claims-only)

Sources: batch-review-2026-10-16-pca-F.md (arch verdicts), lane entries pc-b1.md, docs/bugs.md, spot reads of code (chestDefs.js, itemSource.js, compassHud.js, r19 allow-list). Nothing was run. Owner quest rule (OB-156 / D-082 / D-087 / D-108) checked on every quest item: no violation found.

## Verdicts

| Item | Verdict |
|---|---|
| AA-07a/b + AA-01c | PO OK (PC-A 2026-10-16) -> testing. ARCH OK. OB-208 row: wallNear 10.2 -> 6.5, bushes 15.1 -> 7.9, crown 11.3 -> 7.7, avg 10.8 -> 7.2. Flicker is judged by look: owner walk. |
| AA-08 (soft road patch tone) | PO OK -> testing. Owner looks at road patches (hard threshold gone). Note: terrainShade jump check 4 -> 12 is a re-scoped metric, accepted by arch. |
| AA-09 (UV re-anchor) | PO OK -> testing. Re-measured on the pinned grid: 6.01 / glyphOnly 4.58 vs off 7.08 / 5.66. Known risk: a sliding surface with one planeId keeps a pinned glyph (none exists today). |
| AA-11 / AA-12 / AA-10 | Not in scope: parked, not merged. |
| DAWN-COLOUR-01 | PO OK -> testing. Dawn key + fogHour dawn slot, tests for 05:00 / 06:15 / 12 / 19. Owner look at 06:15. Nit: fogHour.test 06:54 assert is a tautology (non-blocking). Optional: main.js atmosDriver `dawn: 1` slot. |
| SIGNAL-ALIVE-01 | PO OK -> testing. ALIVE = 13 marks, 12.25 s cycle, decode test, no SOS in code. Leftover nits: tools/verify-ch12-run.mjs labels; SIGNAL-ALIVE-TEXT (writer) still open. |
| OB-197 | PO OK, part 1 fixed -> owner to test (stone bevel box filter). Reopen only if the blotches still differ near vs far. |
| OB-204 | PO OK -> owner to test. |
| OB-205 | PO OK -> owner to test. |
| OB-199 | PO OK -> owner to test. HUD line and needle only for ACCEPTED quests: matches the rule (needle for the tracked quest only). |
| OB-207 reopen | PO OK -> owner to test. Needle now falls back to the nearest beast home (respawn point) and never to a giver. questRules audit fails a beast source without spawn data. compassFetch.test covers it. |
| QUEST-HANDIN-BROWSER-01 | PO OK -> testing on code and the STEP_IDS cross-check. GAP: the browser run was never done, so "exits 0 on current content" is open: main session runs `node tools/verify-opening-chain.mjs 9725`. |
| QUEST-NEXT-GIVER-01 (+01b, offerToast) | PO OK -> testing. Derived offers from prerequisites, needle only when nothing is tracked/ready (D-108 fallback), toast gated on book.version, survives Continue. Arch nit: `poll()` allocates `[]` (non-blocking). |
| QUEST-TEXT-LINT-01 (R19) | PO OK -> done (no owner test). The earlier reject is fixed (objective <= 38 sub-check + fixture). |
| QUEST-WRITER-FILL-01 | **PO REJECT.** The 4 texts are written and content has 0 NEEDS WRITER, but the allow-list was not emptied. tools/content-lint-r19-allow.json still holds 4 now-stale entries, and a stale entry is itself an R19 error. Also `R19_ALLOW_MAX` is still 4 in tools/content-lint.test.mjs. Fix: empty the list, set the max to 0, show run-tests green. |
| UNDER-CRYPT-REWARD-01 (part) | PO OK -> testing for the Heart Piece (chestCrypt has +1 heart.piece, once). Coins 40-60: WAIVED (coin is pending:owner; same waiver as SPELL-02 AC3) until a currency exists. Owner may veto. |

## OWNER PRIORITY 1 (docs/pc-b-queue.md)

| Row | Result |
|---|---|
| QUEST-E2E-ALL | PO OK -> done. allQuests.e2e 91/91 plus questRules.e2e (R1-R9, all 86 giver quests + OB-206/207/209 classes). |
| QUEST-HANDIN-ALL | PO OK -> done. The opening chain ends in hand-ins (Burl, Burl, Rook). The R18 rule does not exist by name; R14 (no giver / auto hand-in) and the e2e cover it. |
| BEND-NPC-01 | PO OK -> testing. Joss 2.7 m from the Bend Waystone, 6 sq.rb + sq.fc.cog moved, e2e green. Main session: re-bake GI for the Bend zone. |
| COMPASS-TRACK-01 | PO OK -> testing (compassTrack.test, 5 cases). |
| QUEST-WALK-OWNER | Open: owner walk (PO OK to walk, round 6). |

OWNER PRIORITY 1 is code-complete but NOT closed: it needs the owner walk, the browser run of verify-opening-chain, and the GI re-bake check. QUEST-WRITER-FILL-01 is a separate rejected content item.

## Owner walk list (by place, 14 steps)

Road toward the Ford tower ruin (port 8000, Ctrl+F5, ultra)
1. Walk the road for 10 s, look at the dark road patches. Edges should be soft tone steps, not whole cells jumping every step (AA-08).
2. Look at tree crowns and bushes while walking. Fewer edge cells popping on and off (AA-07/09); F3 flicker numbers if shown.
3. Look at the held sword while walking: glyphs should stay calm, not swap MMMM / #### / xxxx every frame (AA-07a).
4. Tower wall near and far: the stone blotch pattern should stay the same while you move (OB-197).

Meadow / far hills (day)
5. Look at the far hills in haze. Far trees and buildings should be the same tone as the hills, not pale blobs (OB-204).

Ford cellar entrance (1007, 1057)
6. Step to within 2 m of the cellar from the grass: the outdoors must stay bright, no sudden dark navy (OB-205).
7. Walk down into the crypt and open the chest after room 3: Spell Scroll, Health Potion and a Heart Piece, once only, also after Save and Continue.

Bend Waystone (1262, 1030)
8. Joss stands next to the Waystone with a blue `!`. Talk, Accept, finish a road errand, hand it in to Joss: both marks gone. Check that he does not stand in the stone.
9. Waystone wake: the relay blinks Morse ALIVE (. - / . - . . / . . / . . . - / .) and repeats after a pause.

Opening chain (tower to the Bend)
10. Tower note: nothing is tracked until you press E (accept). Hand in at Burl; a toast says "New quest: Rook has work for you" and the compass points to Rook. Save, Continue: the needle is still there and the toast does not repeat.
11. Track two quests and switch: the needle follows the tracked one. When it is READY the needle points at the hand-in character with a `?` in the quest colour (gold main / blue side).
12. Take sq.wreck.plate (Gondola Plate, "Find hide for a strap"): the needle points at the boar area, not at Rook (OB-207).

Title / dawn
13. Title screen: the flourish and map-card star pulse in Morse ALIVE, not SOS.
14. Be in the meadow at 06:15: sunrise rose / orange horizon, then plain day blue by about 07:30; 05:00 stays night.

## Main-session to-dos (no owner needed)
- Run `node tools/verify-opening-chain.mjs 9725` (QUEST-HANDIN-BROWSER-01 AC).
- Re-bake GI for the Bend zone (`node tools/bake-gi.mjs`, check gi-fresh) for Joss.
- Send QUEST-WRITER-FILL-01 back to the programmer (allow-list to empty).
- Arch fixes still open before more flicker work: AA-04c resolve-hyst gpucompare sub-check, AA-03a matFlatColor alloc, FLICKER-GATE mtime guard, FOLIAGE-CAP-BENCH median verdict (before the owner's run tonight).
