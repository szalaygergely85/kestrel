# Backlog size report (2026-10-08)

Janitor report (read-only). Source: `docs/backlog.md` (465.8 KB, 1591 lines). Limit per CLAUDE.md "Lean process": ~150 KB.

Method: sections = each `### ` block up to the next heading (its table rows are inside it). Rows = each table row line. Status from `[Status: ...]` in the heading, else the first "Status" text. Classes: **archive-eligible** = status says done/closed/dropped/archived/passed/superseded and the text has no NEEDS / owner to-do / owner walk / owner look marker; **done-but-owner-todo** = done status but such a marker is present (check before moving); **open** = anything else. Sizes are UTF-8 bytes.

## 1. Largest sections (25) and largest table rows (25)

### 1a. Largest `### ID` sections

| # | ID | Bytes | Line | Status (heading) | Class |
|---|---|---:|---:|---|---|
| 1 | EP-ALIVE | 124456 | 111 | Status \| [PC] main files \| | open |
| 2 | Mesh | 18018 | 519 | PASSED (owner GO 2026-09-29, D-029 amendment 1) | done-but-owner-todo |
| 3 | Sprint | 14766 | 96 | Status \| [PC] main files \| | open |
| 4 | CLOTH-1 | 8729 | 1285 | 1a/1a2/1b1/1b2/1b3/1b4 done; 1b5 stairwell-canvas half done 2026-10-03 (ruin-ba... | open |
| 5 | WATER-2 | 7193 | 1224 | (none) | open |
| 6 | US-079a | 7187 | 741 | dev done -> arch-review | open |
| 7 | US-041b | 6108 | 1010 | todo (sketch) | open |
| 8 | ALPHA-01 | 5613 | 1581 | Status / track \| | open |
| 9 | US-128 | 5260 | 763 | po-review | open |
| 10 | US-078 | 4477 | 698 | todo (sketch) | open |
| 11 | US-053c | 4169 | 1112 | dev done -> arch-review (2026-10-03) | open |
| 12 | HANDS-01 | 3811 | 1512 | todo | open |
| 13 | US-038 | 3772 | 826 | todo | open |
| 14 | US-080 | 3282 | 726 | todo (sketch) | open |
| 15 | Owner-requested | 3182 | 88 | Status \| Files / evidence \| | open |
| 16 | US-031 | 3056 | 882 | testing | open |
| 17 | US-032 | 3006 | 904 | testing | open |
| 18 | US-066 | 2890 | 950 | PO OK (2026-09-26) -> `testing` | open |
| 19 | US-034 | 2868 | 937 | testing | open |
| 20 | BUG-PICKUP-001 | 2779 | 1411 | (none) | open |
| 21 | US-079 | 2644 | 713 | todo (sketch) | open |
| 22 | TREES-LP | 2540 | 1571 | Status / track \| | open |
| 23 | US-067 | 2491 | 1372 | po-review | open |
| 24 | US-079b | 2487 | 1441 | todo | open |
| 25 | BUG-RESPAWN-001 | 2461 | 1398 | (none) | open |

### 1b. Largest table rows

| # | ID | Bytes | Line | Status column | Class |
|---|---|---:|---:|---|---|
| 1 | ED-TERRAIN-1 | 8121 | 166 | todo - PO ACs done, awaiting architect note (37.10+) | archive-eligible |
| 2 | MESH-FULL-01 | 5636 | 460 |  | open |
| 3 | MESH-GPUCMP-01 | 4851 | 147 | **ARCH 2026-10-07: port approved with 4 required changes, see architecture.md 37.1 A6 -> ... | open |
| 4 | MESH-PHYS-01 | 3052 | 143 | **ARCH OK 2026-10-07; PO OK 2026-10-07 -> testing** (owner walk-test: walk the road verge... | open |
| 5 | WG-1c2 | 2978 | 445 |  | open |
| 6 | BUG-GONDOLA-FALL | 2921 | 157 | **ARCH CHANGES 2026-10-07 (fix itself OK)**: (1) `engine/physics/gondolaFall.test.js` tak... | open |
| 7 | WG-1b2 | 2853 | 443 |  | open |
| 8 | MESH-UVMAP-01 | 2810 | 145 | **owner look; ARCH OK 2026-10-07 (gltf.js `triMat`: engine stays pure, callback + determi... | open |
| 9 | WG-2a | 2640 | 446 |  | open |
| 10 | CLOTH-DRAPE-01 | 2608 | 156 | **owner look; ARCH OK 2026-10-07 (content matches the arch entry)** [PC-B, 2026-10-07] - ... | open |
| 11 | HANDS-01c | 2410 | 106 | **ARCH OK 2026-10-07 (opus batch: 7859dd1 dLSample is the first violating cell, 90.004 de... | open |
| 12 | PREC-04b | 2368 | 475 |  | open |
| 13 | MESH-GPU-01 | 2223 | 142 | todo NEEDS PC-A architect note (GPU mesh structures) | open |
| 14 | UI-XHAIR-01 | 2165 | 135 | … for the grids-differ rare path). Crosshair: single `+` below 320 cols, 3x3 open cross (` | open |
| 15 | MESH-SIMP-01 | 2096 | 144 | **owner look [PC-B, 2026-10-07]**. `engine/mesh/simplify.test.js` (plane/cube/sphere: tar... | open |
| 16 | PREC-04 | 2005 | 461 |  | open |
| 17 | US-091a2 | 1967 | 102 | **PO OK 2026-10-07 - ready for owner look (all 6 ACs met per row; no reject). PO call: se... | open |
| 18 | WG-2b | 1955 | 447 |  | open |
| 19 | 30p | 1910 | 360 |  | open |
| 20 | WG-1a | 1850 | 441 |  | open |
| 21 | WG-1c1 | 1814 | 444 |  | open |
| 22 | PROP-COLLIDE-01 | 1736 | 134 | 01a done; **01b0 arch-review [PC-B,2026-10-05]**;01b **NEEDS PC-A: PO review / owner walk... | open |
| 23 | SPELL-01a | 1688 | 107 | **PO OK 2026-10-07 (claims-only) -> testing + owner try [PC-B, 2026-10-07]** (a1 + a2 don... | open |
| 24 | ALPHA-01a | 1681 | 1585 |  | open |
| 25 | PREC-04b2 | 1678 | 477 |  | open |

## 2. Classification totals

- Sections (64): 0 archive-eligible, 1 done-but-owner-todo, 63 open.
- Table rows (354): 5 archive-eligible, 1 done-but-owner-todo, 348 open.

## 3. Movable bytes if all done/closed items moved

Sections and rows overlap (a table row lives inside its `###` section), so the figures are shown separately, not added:

- Whole sections, archive-eligible: **0 bytes (0.0 KB)**. Done-but-owner-todo sections (need a human check first): 18018 bytes. Open sections: 282064 bytes.
- Table rows only, archive-eligible: **9740 bytes (9.5 KB)**. Done-but-owner-todo rows: 1035 bytes. Open rows: 242398 bytes.
- File total: 477026 bytes.

## 4. Handoff blocks (all 13 found; the file has no more than 13, so "oldest 20" = all)

Latest per PC: PC-A 2026-10-08 (L3, 1135 B); PC-B 2026-10-08 (L5, 1493 B). Every older block of the same PC is superseded by that one.

| # | PC | Date | Line | Bytes | Superseded? | Start of text |
|---|---|---|---:|---:|---|---|
| 1 | PC-A | 2026-09-30 | 306 | 1593 | yes (by 2026-10-08) | > **PC-A handoff 2026-09-30 LATE (supersedes the end-of-day block below) - START HERE, PC-A.** Done after the  |
| 2 | PC-A | 2026-09-30 | 307 | 9341 | yes (by 2026-10-08) | > **PC-A handoff 2026-09-30 (end of day, weekly limit ~62-65 % - stopped on purpose). START HERE, PC-A.** Done |
| 3 | PC-A | 2026-10-01 | 295 | 7668 | yes (by 2026-10-08) | > **PC-A handoff 2026-10-01 - START HERE, PC-A.** Weekly ~3 % used this session (owner cap 5 %). Done: merged  |
| 4 | PC-B | 2026-10-05 | 80 | 490 | yes (by 2026-10-08) | > **PC-B handoff 2026-10-05:** Tower props are solid, and the eastern route reaches the ending; ready for PO r |
| 5 | PC-A | 2026-10-05 | 94 | 1742 | yes (by 2026-10-08) | > **PC-A handoff 2026-10-05 EVENING - START HERE, PC-A (supersedes the 2026-10-05 morning handoff).** Weekly ~ |
| 6 | PC-B | 2026-10-06 | 44 | 890 | yes (by 2026-10-08) | > **PC-B handoff 2026-10-06 (night, round 3 done):** Boars now have HP, fight legibly (no merging, one charger |
| 7 | PC-B | 2026-10-06 | 56 | 854 | yes (by 2026-10-08) | > **PC-B handoff 2026-10-06 (night):** The whole DeepSeek trial list is cleared. Boars have HP and die; the ed |
| 8 | PC-B | 2026-10-06 | 67 | 805 | yes (by 2026-10-08) | > **PC-B handoff 2026-10-06:** Two owner-visible UI items are done. The crosshair is bigger on large windows > |
| 9 | PC-A | 2026-10-06 | 92 | 1333 | yes (by 2026-10-08) | > **PC-A handoff 2026-10-06 - START HERE, PC-A (supersedes the 2026-10-05 evening one).** Weekly ~36 % (owner  |
| 10 | PC-B | 2026-10-07 | 17 | 2576 | yes (by 2026-10-08) | > **PC-B handoff 2026-10-07:** Physics and the road meshes got cheaper and safer; the stairwell has a real clo |
| 11 | PC-A | 2026-10-07 | 42 | 1146 | yes (by 2026-10-08) | > **PC-A handoff 2026-10-07 (night) - START HERE.** Done today: VOID-RESPAWN-01 reviewed + merged (2 fixes), c |
| 12 | PC-A | 2026-10-08 | 3 | 1135 | no (latest of PC) | > **PC-A handoff 2026-10-08 - START HERE (PC-A).** Done: batch review lanes B+C (docs/test-reports/batch-revie |
| 13 | PC-B | 2026-10-08 | 5 | 1493 | no (latest of PC) | > **PC-B handoff 2026-10-08 (late; B1 `pc-b`): WG chain built through WG-4b; PC-B WG work now waits for WG-4c. |

All handoff blocks: 13, total 31066 bytes; superseded: 11 blocks, 28438 bytes.

## 5. Duplicate IDs

| ID | Occurrences | Where |
|---|---:|---|
| US-070b | 2 | heading L512; table L392 |
| US-078 | 2 | heading L698; table L644 |
| US-079 | 2 | heading L713; table L648 |
| US-080 | 2 | heading L726; table L649 |
| US-079a | 2 | heading L741; table L690 |
| US-128 | 2 | heading L763; table L691 |
| US-026 | 2 | heading L804; table L567 |
| US-027 | 2 | heading L815; table L568 |
| US-038 | 2 | heading L826; table L569 |
| US-042 | 2 | heading L844; table L570 |
| US-046 | 2 | heading L859; table L376 |
| US-049 | 2 | heading L870; table L371 |
| US-031 | 2 | heading L882; table L377 |
| US-032 | 2 | heading L904; table L378 |
| US-033 | 2 | heading L924; table L379 |
| US-034 | 2 | heading L937; table L380 |
| US-066 | 2 | heading L950; table L381 |
| US-035 | 2 | heading L970; table L634 |
| US-036 | 2 | heading L981; table L635 |
| US-037 | 2 | heading L992; table L636 |
| US-041b | 2 | heading L1010; table L575 |
| US-053a | 2 | heading L1101; table L594 |
| US-053c | 2 | heading L1112; table L595 |
| US-055a | 2 | heading L1128; table L597 |
| US-055b | 2 | heading L1137; table L599 |
| US-132 | 2 | heading L1147; table L617 |
| US-133 | 2 | heading L1158; table L618 |
| US-134 | 2 | heading L1169; table L619 |
| US-135 | 2 | heading L1178; table L620 |
| US-136 | 2 | heading L1187; table L621 |
| US-137 | 2 | heading L1197; table L622 |
| US-139 | 2 | heading L1206; table L623 |
| US-140 | 2 | heading L1215; table L624 |
| CLOTH-1 | 2 | heading L1285; table L536 |
| US-043 | 2 | heading L1326; table L629 |
| US-063 | 2 | heading L1346; table L384 |
| US-064 | 2 | heading L1360; table L385 |
| US-067 | 2 | heading L1372; table L382 |
| BUG-MANA-001 | 2 | heading L1385; table L531 |
| BUG-RESPAWN-001 | 2 | heading L1398; table L530 |
| BUG-PICKUP-001 | 2 | heading L1411; table L532 |
| US-087 | 2 | heading L1424; table L659 |
| US-079b | 2 | heading L1441; table L99 |
| US-091a | 2 | heading L1467; table L101 |
| US-079b0 | 2 | heading L1480; table L100 |
| US-091a2 | 2 | heading L1500; table L102 |
| HANDS-01 | 2 | heading L1512; table L103 |
| SPELL-01a | 2 | heading L1531; table L107 |
| SPELL-01b | 2 | heading L1546; table L108 |
| US-091b | 2 | heading L1558; table L109 |
| MESH-INST-01 | 2 | table L151; table L466 |
| MESH-LOAD-01 | 2 | table L152; table L494 |
| ED-MESH-01 | 2 | table L153; table L484 |

A queue-table row and a `###` section with the same ID is the expected pattern. Two `###` sections or two table rows for one ID with different content is a real duplicate.

## 6. Summary and caveats

- **Movable now (clean):** 9.5 KB of done table rows (archive-eligible, no open marker) plus 1.0 KB of done rows that carry an owner marker (check first). The Mesh phase-1 gate section (`### Mesh phase-1 gate`, L519, 18.0 KB, PASSED) is the only done section; it carries an "owner GO" historical note and is flagged for a human check. Upper bound about 28 KB, roughly 6 % of the file. Overall this is not enough to reach 150 KB.
- **Why the file is big:** 282 KB sits in open sections, mostly sketch epics. `EP-ALIVE` alone is 124 KB (its section has no `[Status]` tag, so the status above is a table header, and it has no clear done/open split). Open table rows are 242 KB. Shrinking the file needs a PO/manager decision on the sketch sections (`todo (sketch)`: US-035..037, US-041b, US-053a..055b, US-132..140, WATER-2, US-043, TREES-LP, ALPHA-01), not a janitor move. Candidate moves for a PO decision only: the sketch sections above and the open ED-TERRAIN-1 row (8.1 KB).
- **Status parsing caveats:** sections without a `[Status: ...]` tag fall back to the first "Status" text, which can be a table header (EP-ALIVE, Sprint, ALPHA-01, TREES-LP, Owner-requested). Rows classed "open" by the `->`/`todo`/`testing`/`dev`/`po-review`/`arch-review`/`NEEDS` markers, so "dev done -> arch-review" counts as open.
- **Done-but-not-moved candidates by hand:** rows in the queue table that say `done` but mention `owner` are kept by this rule; each needs the owner check named in the row before moving.
- **Duplicate IDs (real):** MESH-INST-01 (queue row L151 vs lane row L466), MESH-LOAD-01 (L152 vs L494), ED-MESH-01 (L153 vs L484). These are two rows with different status text; reconcile in one place (PC-A/PC-B sync). The 50 `US-xxx` / `CLOTH-1` / `BUG-*` / `SPELL-*` / `HANDS-01` pairs are a queue-table row plus a `###` section, which is the intended pattern.
- **Handoffs:** 13 blocks, 31 KB in total; 11 superseded (28.4 KB) by the latest block of the same PC. Archiving all but the latest per PC would save about 28 KB;
- Nothing was edited except this report file. The scratch script that produced the numbers is in the session scratchpad, not in the repo.
