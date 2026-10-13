# PO batch review - PC-B, 2026-10-11 (D-066)

PO (opus, first review of owner-visible items). Claims-only review: ACs (docs/sprints/m5-sprint-3.md, docs/bugs.md) against the lane entries (docs/lanes/pc-b1.md, pc-b2.md) and spot checks in the code. No browser was used and nothing was run. Browser-only ACs are listed as owner or main-session to-dos.

**Result:** 23 PO OK, 2 PO REJECT (M4-C2, INT-HL-01).

## Sprint 3

| ID | Verdict | Notes / to-dos |
|---|---|---|
| FS-01 action hints | **PO OK -> owner look** | 7 `act*` rows are in title.js. Labels come from the live bindings (`fmt`), the longest text is 33 chars and none mentions Esc. The AC1-3 Node tests pass. To-do: AC4 is not run yet. Main session runs `node tools/verify-action-hints.mjs 95xx`, and the stills must show that no hint overlaps the 2x OB-051 prompt. `[1-4]` is a fixed label (digits are not in the bindings table), which is OK. |
| M4-C2 Ch1-2 run + gap report | **PO REJECT** | (1) AC3: the last real run still failed AC3b (after Continue, the player has no `health` component after 20 s). Nobody has checked whether this is a game bug or a script bug. (2) AC4/AC5: there is no `docs/test-reports/m4-c2/report.md` and no guidance-gap table, because the reworked script was never run in a browser. The gap table is the deliverable of this story. Required: run `node tools/verify-ch12-run.mjs 9560` once, fix or explain AC3b (a real Continue bug would be P0), and commit the report with its stills. |
| US-104a hidden chests | **PO OK -> testing** | 4 `chestSmall` chests, deterministic generator, 8-25 m from the road, validate-content and coplanar-lint at 0, 8 % gear via SECRET_TABLE. No new heart pieces or chart pieces. To-do: the AC3 stills (`node tools/verify-secrets-ch12.mjs 9650`). The LOS check uses terrain only, so trees can hide a chest. secretRook sits at 24.3 m (the limit is 25 m) and is measured from the ford-track end. Owner should confirm it can be seen. |
| REGION-01 region banner | **PO OK -> owner look** | 40 Node asserts cover the AC1/AC2 rules (jitter, 10 min, queue, save, nameless regions). The palette key is `gold` and the drawing uses the OB-051 scaled path. Deviation accepted: there is no meadow region, so the still crosses roadWest -> ford. To-dos: (a) AC3 stills, which were not forced to 240x90/560x210 (`verify-region-banner.mjs`). (b) roadWest and outwall have no name, so the writer should name them (Outwall is a place players will reach). |
| QL-19b wet stones | **PO OK -> testing** | x0.4 for 0.4 s, no re-trigger within 1 s, nothing with boots, Node table passes. AC3: the splash reuses `wadeFx.arrowHit` (existing US-055a FX, wired at main.js:1931). To-do: AC2 `node tools/route-walk.mjs` ford legs (not run, low risk). Nit: the comment at main.js:1927 still says "x0.5". |
| INT-HL-01 use highlight | **PO REJECT** | (1) **Real bug: the marker is invisible.** `HINT_GLYPH = '·'` (U+00B7, code 183). `CellBuffer.setCell` maps any code above 126 to glyph 0 (space), so the cell draws as a blank. The comment "font already has it: used by HUD separators" is wrong: useHints.js is the only file that uses this character. (2) The spec was not followed. There was no architect note (ARCH-NOTE NEEDED) and no owner answer to Q1. The build is a gold dot marker on the UI layer (close to option B), not the AC brightness pulse on the object's cells. AC1 (cell mask), AC2 (gpucompare row) and AC3 (stills) are therefore not met as written. Required: the owner picks Q1 first. If the owner picks B, the PO re-writes the ACs for a UI-layer marker, the glyph becomes ASCII (`'` as in option B, or `.`/`*`), and a Node test asserts the drawn glyph index is not 0. Then run `verify-use-hints.mjs`. |

## Owner / playtester bugs

| ID | Verdict | Notes / to-dos |
|---|---|---|
| OB-048/049/055/056/057 notes | **PO OK -> owner verify** | The footer reads `[E] Close` with no Esc text. Movement and look are frozen while a note is open (main.js:1880/1896). E only closes the note and never re-reads it. Esc grace covers the note and dialogue. The walk-away close is now unused because the player cannot move, which is fine. OB-055 depends on the OB-066 ray: owner re-tries the tower note. |
| OB-051 2x prompt | **PO OK -> owner look** | ARCH OK. `scale: 2` is in main.js:422 and verify-prompt-scale passes (32 cells). To-do: main session checks the WGSL UI pass on a real GPU. |
| OB-052 -> 063 -> 066 targeting | **PO OK -> owner verify** | Final version: a crosshair ray against pick boxes, nearest hit wins, with LOS (ARCH OK). Owner poses 304/-19 and 264/-30 are in the tests. Non-blocking: the gondola assertion passes vacuously when d > 2 (pin the pose). verify-interact-aim was not re-run. |
| OB-053a-d z-fighting | **PO OK -> owner look** | coplanar-lint finds 0 same-tier pairs, the test asserts 0, and tower step 8 is allow-listed with its reason. To-do: main session runs gpucompare and the 10-nudge GI probe for 053a. |
| OB-047/059/060 removed props | **PO OK (047, 060); 059 waits for the owner** | All 10 vines and both X-beams (poi077/078) are removed, and the generators skip them. OB-059: no floating remnant was found. Owner should say which one it is: the `farTower` billboard or the `ow037` gate arch. Also check content/local/placements.json (the Synty statue history). |
| OB-058 named prompts | **PO OK, follow-up open** | Prompts now name the object (`[E] Talk to Burl`, `Inspect basket`, `Read pinned page`). The test checks <= 28 chars and no Esc. **The writer names in docs/story.md "Prompt names (OB-058/066)" are NOT applied yet** (`errands.js:30` still has basket / note post / pinned page; gondola, keeper's log and mason's chit are unchanged). This needs a small content story. |
| OB-061 dark trees | **PO OK -> owner look** | ARCH OK: LOD1 cards are now two-sided. The cause is a hypothesis that nobody has checked visually. |
| OB-062/062b water | **PO OK -> owner look** | Data only: streak glyph `=`, softer shore, earth-coloured bank instead of the rock ring. z -87 is real bank ground. No capture was made of 062b. |
| OB-064/074/075 loot | **PO OK -> testing** | Gear and potions stay in the corpse until E. Loot shows a "Looted: X" toast and no card (the heart piece keeps its card). Tests pass (loot 300 kills, chestHook). Open: the boar crystal still goes to the pack on quest:ready by design, so owner should say if that is wanted. A save made mid-swing before the change cannot be loaded. |
| OB-065/069 character head | **PO OK -> owner look** | The fine head (res 2) is now the default (quads 2114 / 3881 / 2798, under the 4096 cap). The OB-071 body shape pass is still open (designer). To-do: main session re-baselines the gpucompare `char.gc` row. |
| OB-068/072 Esc + mouse | **PO OK -> owner verify** | Esc in the pause menu now resumes. The pointer re-locks on the next click or key, a "Click to continue" line shows meanwhile, and fullscreen uses Keyboard Lock. No Esc hint text is printed. Headless runs cannot test pointer lock, so the owner has to try it in Chrome. |
| OB-070 Mixamo export | **PO OK -> owner verify** | "For Mixamo (.zip)": FBX + palette, T-pose, 180 cm, welded mesh, 16 checks. Separate finding: the `fbxWrite.test.mjs` golden SHA already fails at HEAD. The suite is red and needs its own ticket. |
| OB-076 sword cap 16 -> 64 | **PO OK -> testing (needs ARCH OK on the cap)** | Root cause found (26 targetables > 16). The test hits the 26th target and fails with the old cap of 16. |
| OB-077 HP regen | **PO OK -> testing** | Matches the bug spec exactly: 8 s delay, +1 HP per 2 s, no regen while a beast is aggro'd within 15 m, values in vitalsConfig. 5 tests. |
| Fall damage 4 m | **PO OK -> testing** | `fallThreshold6m: 4`. Tests cover 3.9, 4.0, 4.1, 6.1, 10.0 and 10.1 m. |

## Owner walk checklist (priority order)
1. **Combat at the Ford and on the Outwall track:** sword-hit a Ford boar and a wolf (OB-076). Loot the corpse with E: gear and potions come only on E, with a "Looted: X" line and no big card (OB-064/074/075).
2. **Tower start note:** E reads it, the footer says `[E] Close`, you cannot walk or look while it is open, and E, click and Esc all close it. Esc does not open the pause menu (OB-048/049/055/056/057).
3. **Pause:** Esc opens it, Esc again resumes, the next click or key brings mouse look back without a swing. Also try Fullscreen from the pause menu (OB-068/072).
4. **[E] prompts at the tower top and the gondola:** the prompt shows only when the crosshair is on the object. The text is 2x big and names the thing (OB-066/051/058).
5. **New game up to the first boar:** the [I] Items, [J] Journal and [LMB] Swing hints come one at a time and never cover the prompt (FS-01).
6. **After a fight:** stand still and the HP refills from about 8 s. Jump off a ledge higher than 4 m and you take 5 damage (OB-077, fall damage).
7. **Walk the road west to the ford:** the place-name banner fades in once and does not repeat when you step back and forth (REGION-01).
8. **At the ford:** check the water look (OB-062). Sprint onto a stepping stone without River Boots: short slip and a splash. With the boots: nothing (QL-19b).
9. **Look around:** mid-distance trees have no navy blobs (OB-061), the tower front and floor do not flicker (OB-053), there are no vines or X-beams. Point out the J-shape if it is still there (OB-059).
10. **Secrets and chargen:** spot the 4 hidden chests (Rook's ruin, Bend, straw field, river bank, US-104a). In chargen, check the fine head default and try the "For Mixamo (.zip)" upload (OB-069/070).
