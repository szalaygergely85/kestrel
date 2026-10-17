# Backlog audit 2026-10-13 (janitor, report only)

Scope: `docs/backlog.md` and `docs/pc-b-queue.md` story rows and `### ID` headings whose status is not done/dropped/superseded/merged/closed; `docs/bugs.md` OB rows. Git = `git log --all`. Heuristic: "landed commit" = subject starts with the ID (optionally `Merge` or `prefix:`); "docs" commits never count. Verdicts from `docs/test-reports/batch-review-*.md`, `po-batch*.md`. Tester PASS = a line in `docs/test-reports/**/*.md` naming the ID with PASS. Nothing was edited.

## Counts

| class | rows |
|---|---|
| LIKELY DONE | 11 |
| STATUS STALE | 278 |
| OWNER LOOK | 24 |
| STILL OPEN | 172 |
| UNSURE | 148 |
| OB STALE (bugs.md) | 47 |
| OB UNSURE | 33 |
| OB OPEN | 4 |
| OB already verified/closed | 5 |
| OB awaiting owner | 14 |

Duplicate IDs across active rows: 114


## LIKELY DONE

| ID | file:line | current status | suggested | evidence |
|---|---|---|---|---|
| HANDS-01b | backlog.md:157 | **ARCH OK 2026-10-07; PO OK 2026-10-07 (claims-only) -> testing** + owner try. Was: arch-review | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit a6e6a65e HANDS-01b: RMB input + context-menu block, hands ro |
| SPELL-01a | backlog.md:159 | **PO OK 2026-10-07 (claims-only) -> testing + owner try [PC-B, 2026-10-07]** (a1 + a2 done; PO  | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 7d1a3f38 SPELL-01a: fireball simulation (tap/hold mana, 4-ba |
| US-066 | backlog.md:819 | PO OK (2026-09-26) -> `testing` | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 1d73975e US-066: reskin the M1.5 editor to the Stitch "Retro |
| WS1-06b | backlog.md:1939 | ARCH OK; PO OK (PC-B batch, PC-A to ratify) -> testing; follow-up: relay touch still shows the  | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit afac44ce WS1-06b review fix: relayWake forces AWAKE 3 s afte |
| CH1-01 | backlog.md:2016 | ARCH OK; PO OK -> testing (towerDoor placeholder until CH1-D1a) [PC-B] | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 1e3650ad CH1-01 follow-up: world.test expects the 6 world tr |
| CH1-02 | backlog.md:2017 | ARCH OK; PO OK -> testing (markers/compass for towerDoor/roadWest not browser-checked: owner/te | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 3204c465 CH1-02 (D-062): wire the m1 chain - questRelay.ques |
| CH1-03 | backlog.md:2018 | ARCH OK; PO OK (module) - open: main.js mount (check on quest:ready + world:loaded, noteBoar on | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 5290b83d CH1-03 (D-062): game/js/quest/crystal.js createCrys |
| CH1-04a | backlog.md:2019 | ARCH OK; PO OK (module) - open: main.js mount (hidden in menus/dialogue), relayWake showWakeNot | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit e6034edf CH1-04a (D-062): game/js/ui/noticeView.js notice ba |
| CH1-05 | backlog.md:2021 | ARCH OK; PO OK (content) -> testing after the CH1-06 mount (s. keys need questFlag in the ctl); | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 117734ab CH1-05 (D-062): Burl full dialogue graph (9 entries |
| CH1-06 | backlog.md:2022 | ARCH OK; PO OK (module) - open: main.js mount (questFlag into createDialogueCtl + createBarks,  | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit b62646b6 CH1-06 (D-062): dialogueCtl s.<key> route (world.st |
| CH1-09 | backlog.md:2028 | ARCH OK; PO OK (module) - open: main.js mount (trigger on last m1 section, isLocked -> uiLocked | check: row still reads testing/open - PO OK rows stay in testing until tester PASS | commit 757f9eef CH1-09 (D-062): game/js/quest/chapterCard.js (dim 5 |

## STATUS STALE
Suggested status = next step from the verdict on file (or arch-review if none). Rows whose status cell has no clear first phrase are included with the commit as evidence; check the row text before editing.

| ID | file:line | current status | suggested | evidence |
|---|---|---|---|---|
| US-079b | backlog.md:151 | owner walk-test pending (stale-rows 2026-10-09). **arch-review [PC-B game, 2026-10-06]** + owne | arch-review | commit b87102c2 US-079b ARCH fixes: beastView clip pose (frame/t vi |
| US-079b0 | backlog.md:152 | **arch-review [PC-B engine, 2026-10-06]** - voxel.hidden skipped in both collect branches (live | arch-review | commit 78b3a449 US-079b0: engine seams for boar death (voxel.hidden |
| EP-ALIVE | backlog.md:163 | (no status tag) | arch-review | commit 0e16a341 EP-ALIVE: ENV-01d ground detail models + recipe.det |
| US-068 | backlog.md:254 | PC-B 2026-10-09: US-068 a/b/c/d done -> arch-review + owner look. Was: queued 2026-10-09 (owner | arch-review | commit ac115d34 docs: US-068 tech note 38.19 (ortho camera + editor |
| BUG-COORD-001 | backlog.md:257 | … the phase-1 gate is a go, shadow maps replace the sun DDA -> only part (a)+(b) for point-ligh | arch-review | commit 86e8dd18 BUG-COORD-001: light occlusion + sunVisible in the  |
| CO-8 | backlog.md:261 | … 143 suites, 142 PASS (1 pre-existing unrelated typecheck WARN, run twice clean), `check-deps. | arch-review | commit c42aa635 docs: CO-8 done -> arch-review; PC-B queue 5 fully  |
| US-073 | backlog.md:267 | … the real grid spec incl. `pxCellW/pxCellH` (the oracle's `_gridScratch` defaults them to 1),  | arch-review | commit 3f505195 US-073 step 1 ARCH CHANGES: reuse projection.js ter |
| US-075 | backlog.md:268 | todo (sketch) [PC-B] - all edits through the editor command layer (undo + validation); read-onl | arch-review | commit 7f47f8ef docs: US-075 MCP server, US-076 editor AI chat, US- |
| US-119 | backlog.md:271 | Trailer tool: camera-path files (`design/cinematics/*.json`: keyframes pos/yaw/pitch/time, easi | arch-review | commit 16522687 docs: US-119 trailer tool (camera paths + frame cap |
| ME-13b | backlog.md:283 | Mesh phase 3: `.obj` (+ `.mtl`) static-mesh importer - `tools/obj-import.mjs` -> the same `cont | arch-review | commit 7a7bcd03 docs: ME-13b fixes + ME-14a + ME-14b ARCH OK -> don |
| ME-14c | backlog.md:285 | (no status cell) … Ruins/main+shadow rows PASS,only prior-PASS parapetSky regresses (8 equal-ke | arch-review | commit bb8120d8 docs: ME-14c taken by PC-A (owner) |
| ME-15b | backlog.md:287 | (no status cell) <= 16 + 0.05*slope` on >= 99.9 % (actual >= 99.9998 %, coverage mismatch 0 %)  | arch-review | commit edb08735 ME-15b review fixes: no-alloc depth-only beginPass  |
| ME-15c | backlog.md:288 | … %, n mismatch <= 0.024 %). **Perf: map +1.0-1.1 ms GPU p95** on the 400x150 route walk (4.1 v | arch-review | commit 3044fbda docs: ME-15c ARCH OK -> po-review, 27.9a amendment  |
| ME-15d | backlog.md:289 | … = n` drops posed records -> never-shrinking slot array (zero alloc); (2) two perf rows per po | arch-review | commit cbc219f3 ME-15d: sun shadow dirty-skip (shadowInputHash, siz |
| BUG-RTS-002 | backlog.md:290 | … doesn't assume a specific pass index is always non-null), and the RE-15 `instances`/`instance | po-review (ARCH OK on file) | commit 150ccf53 BUG-RTS-002: refresh the RTS page content scripts; verdict test-reports\batch-review-2026-10-08.md:131 - **BUG-RTS-002** `ARCH OK |
| ME-16 | backlog.md:292 | PC-B 2026-10-09: ME-16a-f in arch-review, default OFF, ME-16g gate pending. Was: todo [PC-A] -  | testing (PO OK on file) | commit 768d90c6 ME-16 isolation: instanced-caster fixture - CPU sha; verdict test-reports\batch-review-2026-10-09-pcb.md:83 8. **ME-16 alloc partia |
| ME-17 | backlog.md:293 | todo [PC-A] - deps: ME-06 | arch-review | commit 83a17bbe docs: ME-17 status check - all ACs in code except t |
| ME-19 | backlog.md:295 | PC-B 2026-10-09: ME-19c1/19c2 done. Was: … (`?renderer` switch out, PC-A or PC-B cross-track) - | arch-review | commit 4f77cdc8 Plans: ME-19 dda removal (37.13, steps 19a-f, owner |
| WG-1b2 | backlog.md:314 | **arch-review (fix-up done 2026-10-07):** layout drops group 1 when uniformBytes==0; cached emp | arch-review | commit df82f466 WG-1b2 fix-up (empty bind groups, bump-allocated un |
| WG-1c1 | backlog.md:315 | Files: `glyphAtlas.js` (extract), `RenderTargetWebGPU.js`, `wgsl/present.wgsl.js`, `wgsl/index. | arch-review | commit 53b146f8 docs: WG-1c1 ARCH OK + 38.8a addendum for WG-1c2 |
| WG-1c2 | backlog.md:316 | arch-review (fix-up done 2026-10-07: editor passes clampGrid(gridFromParam) cols/rows to create | arch-review | commit a6da6858 docs: WG-1c2 taken by PC-B (in dev) |
| WG-2a | backlog.md:317 | depth` and `&gpu=0`: gpuErrors [] and no page errors; plain boot (webgl2) unchanged (gl2, 240 c | arch-review | commit 2a77768b WG-2a: apply architecture corrections to validation |
| WG-3c | backlog.md:322 | **PC-A 2026-10-08 carry-overs DONE (Node tests, not yet committed): resizeGrid failure -> ready | po-review (ARCH OK on file) | commit 9c935a1c WG-3c follow-up: towerShadowGrass is the world_m1 p; verdict test-reports\batch-review-2026-10-08.md:9 / WG-2b, WG-2c, WG-3b, WG-3c |
| WG-3d | backlog.md:323 | **arch-review (B1 wiring 0d166d9 + merged with PC-A 24b 2026-10-08: passShadow uses SHADOW_TERR | testing (PO OK on file) | commit 0d166d9f WG-3d: WebGPU sun shadow map wired (WgShadowPass af; verdict test-reports\batch-review-2026-10-08.md:10 / WG-3d (sun shadow map) /  |
| WG-3e | backlog.md:324 | **arch-review (B1 wiring ed3feff, gate in docs/test-reports/WG-3e.md).** **host module d6ba011  | testing (PO OK on file) | commit ed3feff4 WG-3e: WebGPU water wired (WgWaterPass: water raste; verdict test-reports\batch-review-2026-10-08.md:11 / WG-3e (water) / ARCH OK - |
| WG-3f | backlog.md:325 | Files: `wg/passSprites.js`, `wgsl/sprites.wgsl.js`, overlay port. Done when: **full PASS set =  | testing (PO OK on file) | commit fe1f5861 WG-3f: WebGPU sprites + overlay wired (WgSpritesPas; verdict test-reports\batch-review-2026-10-08.md:12 / WG-3f (sprites + overlay) |
| WG-4b | backlog.md:327 | **Follow-up (c) done (B1 2026-10-08, docs/test-reports/WG-4b-c.md): _gpuHash = eye 1 m cell + p | po-review (ARCH OK on file) | commit 27c68ca9 WG-4b follow-up (c): shadow dirty-skip without row ; verdict test-reports\batch-review-2026-10-08.md:53 / WG-4b shadow-caster cull  |
| WG-5a | backlog.md:329 | todo [PC-B cross-track -> arch-review] ~1 d - deps: WG-4c | testing (PO OK on file) | commit 97b0d0c5 WG-5a-4: GL-only exports moved to engine/render/gl/; verdict test-reports\batch-review-2026-10-09-pcb.md:142 13. **WG-5a-4 (k4 97b0 |
| WG-5b | backlog.md:330 | todo [PC-B cross-track -> arch-review] ~0.5 d - deps: WG-5a | po-review (ARCH OK on file) | commit b9884803 WG-5b: drop the WebGL2 backend (D-053, owner WG-4c ; verdict test-reports\batch-review-2026-10-09-pcb.md:166 6. **WG-5b/5c (k4 b988 |
| MESH-FULL-01 | backlog.md:331 | Files: `tools/reimport-quaternius.mjs`, `design/meshes/`, `design/levels/overworld_far.js`. Don | see verdict (CHANGES/REJECT on file) | commit a31b0c16 MESH-FULL-01: full-detail Quaternius re-import merg; verdict test-reports\batch-review-2026-10-08.md:183 - **S8-B2-02** (6d0fe56) ` |
| PREC-04 | backlog.md:332 | arch-review [PC-A] 2026-10-07 - Files: `engine/render/gpu/gpuCompare.js`, `game/js/dev/modes/gp | arch-review | commit bb59a997 PREC-04 (partial): harness tie rule A8 (meshTies, n |
| QUAT-TREES-01 | backlog.md:334 | Files: `design/levels/overworld_far.js` (line 49 `lodCells`, now 6), `design/meshes/quaternius/ | po-review (ARCH OK on file) | commit d44e36e6 QUAT-TREES-01 (flag) + TREE-LODCELLS-01: ?trees=mes; verdict test-reports\batch-review-2026-10-09-pcb.md:200 11. **QUAT-TREES-01 (f |
| MESH-SHADOW-02 | backlog.md:336 | **arch-review (rework 2026-10-08, report docs/test-reports/MESH-SHADOW-02b.md): nearest-4 cap d | testing (PO OK on file) | commit b966edb8 MESH-SHADOW-02 rework + ALPHA-01b ARCH CHANGES: mes; verdict test-reports\batch-review-2026-10-08.md:62 / MESH-SHADOW-02 rework (b9 |
| DIAG-SWIFTSHADER | backlog.md:342 | Files: diagnosis; `tools/capture-browser.mjs` if a flag fix. Done when: cause found with `CAP_L | arch-review | commit 239c6186 DIAG-SWIFTSHADER: record logged reproduction and mi |
| EP-DESKTOP-SPIKE | backlog.md:344 | todo [lane C (sprint 7, after WG-3f per D-044 item 6) -> PC-A review] ~0.5 d | testing (PO OK on file) | commit a31d48fc EP-DESKTOP-SPIKE: skip installed dependencies in th; verdict test-reports\batch-review-2026-10-08.md:83 / EP-DESKTOP-SPIKE (f79e6dc |
| BACKLOG-TRIAGE | backlog.md:345 | Files: `docs/backlog.md`, `docs/backlog-archive.md`. Batches of ~40 rows, owner-visible rule: m | arch-review | commit 90bab91c BACKLOG-TRIAGE: refresh the sheet and owner decisio |
| PREC-04b | backlog.md:346 | arch-review [PC-A] (b1 built, **b2 todo -> [PC-B cross-track]**, see row PREC-04b2) - **ARCH 20 | arch-review | commit 8dd8c23c docs: PREC-04b rule A9 (b1/b2), WG-2a ARCH CHANGES  |
| CHAR-IMPORT-01 | backlog.md:353 | Files: `tools/unity/KestrelGltfExport.cs` (editor menu, active parts only, skinned baked, root- | arch-review | commit 3e6e09d3 CHAR-IMPORT-01: Unity glTF character exporter + wor |
| CHAR-COL-01 | backlog.md:354 | `design/palette.js`: colours `skin` #b98466, `skinShade`, `hairDark`; materials `skin`, `hair_d | arch-review | commit cfdcb586 CHAR-COL-01 fix: v2 detail-pass records for skin +  |
| QUAT-LOD-01 | backlog.md:356 | todo, after QUAT-TREES-01 [PC-B cross-track -> arch-review PC-A] ~1 d | arch-review | commit 296fb81d QUAT-LOD-01 part 2: mesh instance groups switch to  |
| GFX-03 | backlog.md:361 | Files: `engine/mesh/**`, engine scatter feed, `engine/index.js`. **AC:** defaults bit-identical | po-review (ARCH OK on file) | commit 2c273d30 GFX-03: engine quality knobs (shadows.sun 'off', re; verdict test-reports\batch-review-2026-10-08.md:84 / GFX-03 (2c273d3) / ARCH O |
| GFX-04 | backlog.md:362 | **AC:** each preset: gpucompare on 3 poses (crash, roadSouth, forestWalk) no PASS->FAIL vs the  | testing (PO OK on file) | commit 9e8f84d6 GFX-04-pc: browser-batch --presets [--gpu] runs gpu; verdict test-reports\batch-review-2026-10-09-pcb.md:96 19. **SWAY-GC-01, GFX-0 |
| ED-MESH-01e | backlog.md:363 | todo [lane B1, sprint 7 -> arch-review] ~0.5 d | arch-review | commit 795e6f43 ED-MESH-01e follow-ups: rebuildMeshColliders refits |
| MESH-SCALE-01 | backlog.md:364 | todo [lane B2, sprint 7 -> arch-review] ~0.75 d - deps: MESH-INST-01 | testing (PO OK on file) | commit 73ddef13 MESH-SCALE-01: uniform scale on placed meshes end t; verdict test-reports\batch-review-2026-10-08.md:109 / MESH-SCALE-01 (73ddef1)  |
| MESH-LOAD-01 | backlog.md:365 | todo [lane B2, sprint 7 -> arch-review] ~1 d - deps: MESH-BIN-01 | see verdict (CHANGES/REJECT on file) | commit f20eb106 MESH-LOAD-01 boot: prefetchNear lazy meshes around ; verdict test-reports\batch-review-2026-10-08.md:162 / MESH-LOAD-01 lazy mesh p |
| US-096a | backlog.md:366 | todo [lane C, sprint 7] ~0.75 d - writer: objective texts (PC-A) | testing (PO OK on file) | commit 24ec1d03 US-096a: simulate save-safe quest flags and objecti; verdict test-reports\batch-review-2026-10-08.md:16 / US-096a / ARCH OK -> po-r |
| US-089a | backlog.md:367 | todo [lane C, sprint 7] ~0.75 d - deps: CO-5 (done) | testing (PO OK on file) | commit 20a20b4e US-089a: collect and restore versioned game saves; verdict test-reports\batch-review-2026-10-08.md:17 / US-089a / ARCH OK -> po-r |
| US-090a | backlog.md:369 | todo [lane C, sprint 7] ~0.75 d - deps: US-089a; designer (title/menu style) + writer (labels)  | testing (PO OK on file) | commit fcdb6029 US-090a: add the standalone title menu and preview; verdict test-reports\batch-review-2026-10-08.md:112 / US-090a (fcdb602) / ARCH |
| US-112a | backlog.md:370 | Files: `tools/demo/build-demo.mjs` (+test). **AC:** `dist/demo/` + zip; every referenced file p | testing (PO OK on file) | commit 703c50a9 US-112a: load the packaging parser optionally; verdict test-reports\batch-review-2026-10-08.md:18 / US-112a / ARCH CHANGES (C |
| MAP-01a | backlog.md:373 | Files: `design/preview/chart.html`, `design/ui/chart.js` (palette/glyph table), text in `docs/s | arch-review | commit f075825b MAP-01a (38.42): terrain layer composer in overworl |
| MAP-01b | backlog.md:374 | todo [lane C, sprint 7] ~1 d - parallel to 01a (glyph table plugged in after) | testing (PO OK on file) | commit 62a96a62 MAP-01b: far grid origin + size (cap 512, default b; verdict test-reports\batch-review-2026-10-08.md:19 / MAP-01b / ARCH CHANGES (C |
| MAP-01c | backlog.md:375 | todo [lane C, sprint 7/8] ~1 d - deps: 01a + 01b | arch-review | commit da14f9fe MAP-01c: biome planting (compileBiomes hook in scat |
| MESH-PERF-01 | backlog.md:379 | **Instanced 3x probe (2026-10-07):** cost is NOT fragment/raster/overdraw/VS-ALU/varyings (each | arch-review | commit def6eb24 docs: MESH-PERF-01 profile (instanced trees dominat |
| BUG-SHADOW-ONEPART-01 | backlog.md:380 | todo [PC-A] ~0.5 d - needs architect notes first (source: arch verdicts 2, WG-4b follow-up a) | arch-review | commit b144458c docs: BUG-SHADOW-ONEPART-01 tech note 38.9, split i |
| MESH-BIN-01 | backlog.md:381 | todo [lane B2 -> arch-review] ~1 d - deps: MESH-FULL-01 | see verdict (CHANGES/REJECT on file) | commit e6cab080 MESH-BIN-01 ARCH CHANGES: decodeMeshBin count check; verdict test-reports\batch-review-2026-10-08.md:124 - **MESH-BIN-01** `ARCH CH |
| RTS-01a | backlog.md:394 | … (main.js untouched), z from terrain.groundAt, sync terrain prebuild at load, placeholder team | arch-review | commit 2059fd36 RTS-01a: RTS spike step a (game/rts-test.html + gam |
| RTS-01b | backlog.md:395 | … separation). Also in: designer RTS unit model `design/models/rts_unit.js` (1.0x0.8x1.6 m, tea | arch-review | commit d512f7c3 RTS-01b: move orders (A* small groups, shared flow  |
| BUG-RTS-001 | backlog.md:396 | … JS twin flips at the denser 0.25 m hash-cell boundaries. Architect: accept as new baseline (r | arch-review | commit 9e5631d8 BUG-RTS-001: pitched-pose gpucompare gate (architec |
| BUG-FP-002 | backlog.md:398 | … + rtsOverlay new baseline under the pitched gate, now also applied to pitchedDefault fp poses | arch-review | commit 59df5516 BUG-FP-002 review follow-ups: perCellHashSize helpe |
| BUG-ED-VOX-1 | backlog.md:399 | **Editor: imported .vox gets into Assets but cannot be placed/seen** (owner 2026-10-01, design/ | testing (PO OK on file) | commit 960472cc BUG-ED-VOX-1: editor re-binds the voxel pool after ; verdict test-reports\batch-review-2026-10-08.md:164 / S8-C-20a BUG-ED-VOX-1 ve |
| BUG-VM-001 | backlog.md:400 | … is a comment only, so no conflict with HANDS-01a today. **Constraint for HANDS-01a (37.8a err | arch-review | commit a24ab049 BUG-VM-001: publish hand-param sword mirror and lat |
| BUG-TUNNEL-001 | backlog.md:402 | **Rare fall-through-the-floor on `physics=mesh` right as the tower grate opens** (found 2026-10 | arch-review | commit b289bd1b docs: BUG-TUNNEL-001 - rare grate fall-through on p |
| BUG-RESPAWN-001 | backlog.md:403 | (no status cell) [PC-B] `game/js/quest/sim/vitals.js`, `game/js/main.js`, `tools/respawn-facing | arch-review | commit cbc702dd BUG-RESPAWN-001: preserve restored facing through p |
| BUG-MANA-001 | backlog.md:404 | (no status cell) [PC-B] `game/js/quest/vitalsView.js`, `game/js/quest/vitalsView.test.js` | arch-review | commit 7d8d2adb BUG-MANA-001: age mana warning on the vitals clock |
| BUG-PICKUP-001 | backlog.md:405 | (no status cell) [PC-B] `game/js/quest/sim/pickups.js`, `game/js/quest/sim/pickups.test.js`, `g | arch-review | commit 450881b9 BUG-PICKUP-001: rebuild retained drop slots on load |
| RE-02b | backlog.md:413 | … GPU timer -> real GPU p95 on fpDown60 at 400x150), **b7 owner feel check**: on ?renderer=mesh | arch-review | commit 3bf448b7 RE-02b: CPU-path voxel projection uses the effectiv |
| PX-05a | backlog.md:431 | todo (sketch) - **NEEDS PC-A: architect note (PC-B Q7 filler, 2026-10-01).** Row too thin to ha | arch-review | commit 9e5d9080 docs: PX-05a flagged NEEDS PC-A architect note (PC- |
| US-053a | backlog.md:467 | … `engine/world/entityEmitters.js`, `engine.particles` option + clear on world:loaded, check-de | arch-review | commit 342268c5 US-053a ARCH OK -> done (eGen masked); US-133 ARCH  |
| US-055a | backlog.md:470 | … max 32, validated), `World.waterAt(x, y, out)` -> surfaceZ/depth/region id/look (0.05 us at 3 | testing (PO OK on file) | commit c2a4b831 US-055a: wade splash + ripple rings (engine/fx/wade; verdict test-reports\po-batch-2026-10-11-pcb.md:15 / QL-19b wet stones / **PO  |
| US-055a2c | backlog.md:471 | Water wiring + first visible water: (a) `engine/index.js` exports `resolveWaterLooks`; main.js  | arch-review | commit db0a00e1 US-055a2c: record pond bowl verification and post-s |
| US-142a1 | backlog.md:478 | (no status cell) … floats 36/40-43/54/55, sheet flag bit 32, sheets never opaque so the edge su | arch-review | commit 6e94d8d9 US-142a1: render two-sided ballistic waterfall shee |
| US-143a | backlog.md:481 | (no status cell) … probe (scratch, deleted) stepped `world.water` 180 times and read `waterAt(1 | arch-review | commit 3a53e87b US-143a: wire water.step() into the fixed step (Q13 |
| US-133 | backlog.md:491 | … `fire:area` event; hooks World.fire=null, serialize writes `fire` when set, rule 15 scope; 40 | arch-review | commit 766c21d7 US-133 review fixes -> done: sim-tick wind, floorAt |
| US-078 | backlog.md:517 | … session 49 PASS): design/models/m3_props.js `voxelModels.practiceTarget` (old sword pell; cli | arch-review | commit 489562e4 US-078 content step: swordKit merged (3 bronze colo |
| US-078b | backlog.md:518 | … in interaction.js), new `engine/world/meleeArc.js` `arcHits` (index.js export), overlay `segm | arch-review | commit 0a8d963d US-078b: World.raySegment, raycastColliders, meleeA |
| US-078c | backlog.md:519 | … into main.js's `'world:loaded'` handler by the main session (not in the original per-story sc | arch-review | commit 05c61489 US-078c: sword pickup (tower.level.json, sword.take |
| US-078d | backlog.md:520 | … retune/deviation. Report US-078d-knockback.md. NEEDS PC-A: diff-only review + PO/owner feel c | arch-review | commit 7f1e378f US-078d: verify heavy knockback through real sword  |
| US-087 | backlog.md:532 | todo (sketch) [PC-A] - basis for US-107/108. **Scoped PC-B audit gate only: NEEDS PC-A: PO revi | arch-review | commit cbf189fa US-087: gate targeting input and timers during paus |
| US-078 | backlog.md:571 | todo (sketch) | arch-review | commit 489562e4 US-078 content step: swordKit merged (3 bronze colo |
| US-079a | backlog.md:614 | dev done -> arch-review | arch-review | commit ee662e6e US-079a: beast brain + nav chase (first enemy, no d |
| US-053a | backlog.md:970 | todo (sketch) | arch-review | commit 342268c5 US-053a ARCH OK -> done (eGen masked); US-133 ARCH  |
| US-053c | backlog.md:981 | dev done -> arch-review (2026-10-03) | arch-review | commit 7d66e6da US-053c polish: particle footprint by distance (siz |
| US-055a | backlog.md:997 | todo (sketch) | testing (PO OK on file) | commit c2a4b831 US-055a: wade splash + ripple rings (engine/fx/wade; verdict test-reports\po-batch-2026-10-11-pcb.md:15 / QL-19b wet stones / **PO  |
| US-133 | backlog.md:1027 | todo (sketch) | arch-review | commit 766c21d7 US-133 review fixes -> done: sim-tick wind, floorAt |
| US-136 | backlog.md:1056 | todo (sketch) | arch-review | commit e0312d3a US-136: explosionHits query + applyImpulse knockbac |
| CLOTH-1 | backlog.md:1154 | 1a/1a2/1b1/1b2/1b3/1b4 done; 1b5 stairwell-canvas half done 2026-10-03 (ruin-banner half deferr | arch-review | commit 7db30639 docs: CLOTH-1 PO ACs + architect note (architecture |
| BUG-MANA-001 | backlog.md:1252 | (no status tag) | arch-review | commit 7d8d2adb BUG-MANA-001: age mana warning on the vitals clock |
| BUG-RESPAWN-001 | backlog.md:1265 | (no status tag) | arch-review | commit cbc702dd BUG-RESPAWN-001: preserve restored facing through p |
| BUG-PICKUP-001 | backlog.md:1278 | (no status tag) | arch-review | commit 450881b9 BUG-PICKUP-001: rebuild retained drop slots on load |
| US-087 | backlog.md:1291 | (no status tag) | arch-review | commit cbf189fa US-087: gate targeting input and timers during paus |
| US-079b | backlog.md:1308 | todo | arch-review | commit b87102c2 US-079b ARCH fixes: beastView clip pose (frame/t vi |
| US-079c | backlog.md:1321 | todo | arch-review | commit 7c5dbc5c US-079c: boar fight readability (de-overlap, one ch |
| US-079b0 | backlog.md:1347 | todo | arch-review | commit 78b3a449 US-079b0: engine seams for boar death (voxel.hidden |
| US-091a1 | backlog.md:1356 | todo | arch-review | commit 41bffd69 US-091a1: inventory data (24 slots + hands, demo st |
| SPELL-01a | backlog.md:1398 | todo | arch-review | commit 7d1a3f38 SPELL-01a: fireball simulation (tap/hold mana, 4-ba |
| SPELL-01b | backlog.md:1413 | todo | arch-review | commit f4d9d625 SPELL-01b: fireball look (core sprite, trail per ba |
| US-091b | backlog.md:1425 | todo | arch-review | commit 77ed46b0 US-091b: inventory screen (I pauses; hands strip, 6 |
| TREES-LP | backlog.md:1438 | (no status tag) | po-review (ARCH OK on file) | commit e3cbd9b2 TREES-LP-c: ground-cover (detail) species accept me; verdict test-reports\batch-review-2026-10-08.md:180 - **TREES-LP-c** (e3cbd9b) |
| TREES-LP-a | backlog.md:1442 | **arch-review (gltf.js `buildMeshFromTris` export) + owner look [PC-B, 2026-10-07]** ~0.75 d ** | arch-review | commit 629317aa TREES-LP-a follow-up: trunk-aware collision in one  |
| TREES-LP-b | backlog.md:1443 | todo [PC-B engine -> arch-review] ~1 d - deps: ME-14c3 published, PREC-01a preferred | arch-review | commit 5febb839 TREES-LP-b: instanced kind-9 mesh groups (meshGroup |
| PREC-01a | backlog.md:1444 | arch-review [PC-B engine -> PC-A] - `projection.js viewProjAtOrigin`, `wg/passRaster.js` (O = f | po-review (ARCH OK on file) | commit 1a9d4c23 PREC-01a: WebGPU camera-relative render origin (O =; verdict test-reports\batch-review-2026-10-08.md:192 - **PREC-01a 1a9d4c2 (B1): |
| TREES-LP-c | backlog.md:1445 | todo [PC-B -> arch-review] ~0.5 d - deps: b, d | po-review (ARCH OK on file) | commit e3cbd9b2 TREES-LP-c: ground-cover (detail) species accept me; verdict test-reports\batch-review-2026-10-08.md:180 - **TREES-LP-c** (e3cbd9b) |
| ALPHA-01a | backlog.md:1453 | **arch-review [PC-B, 2026-10-07]** (step a only, no renderer change). MeshRange `mask {tex, cut | arch-review | commit 5549a3e4 ALPHA-01a: alpha-cutout import + formats (mask rang |
| ALPHA-01b | backlog.md:1454 | **AC:** a masked 2 m quad with a 4x4 checker mask matches the brute-force oracle (kind/planeId/ | testing (PO OK on file) | commit c8383f8a ALPHA-01b: JS-side alpha cutout (MaskAtlas, mask re; verdict test-reports\batch-review-2026-10-08.md:63 / ALPHA-01b ARCH CHANGES fi |
| ALPHA-01c | backlog.md:1455 | **arch-review [PC-B B1+B2, 2026-10-08, WGSL only, no GLSL]**: `RASTER_MASK_WGSL` (+ shadow vari | testing (PO OK on file) | commit c2c417c0 ALPHA-01c: WebGPU alpha-cutout masks (rasterMask/ra; verdict test-reports\batch-review-2026-10-08.md:130 - **ALPHA-01c** `ARCH OK - |
| ALPHA-01e | backlog.md:1457 | todo [PC-B -> arch-review] ~0.75 d - deps: c, TREES-LP-d (LOD1 meshes) | arch-review | commit 9d9933fe ALPHA-01e nit: withCollision picks opaque-range col |
| ALPHA-01f | backlog.md:1458 | todo [B2, ARCH-approved 2026-10-09]; before species switch: owner LOD1 pick + forestWalk triang | testing (PO OK on file) | commit d4af9004 ALPHA-01f-fix3 (folded into merge 65886ddc): instan; verdict test-reports\batch-review-2026-10-09-pcb.md:10 4. **ALPHA-01f-fix + sh |
| EP-TALK | backlog.md:1464 | (no status tag) | testing (PO OK on file) | commit ba2ee381 docs: EP-TALK epic (owner: talking voxel bear) - BE; verdict test-reports\po-batch2-2026-10-09-pcb.md:12 / BEAR-LINES-01 (story.md  |
| BEAR-LINES-01 | backlog.md:1468 | todo [PC-B writer, ~0.25 d; no deps] | testing (PO OK on file) | commit 6ec317f2 docs: BEAR-LINES-01 - Burl the bear: name, personal; verdict test-reports\po-batch2-2026-10-09-pcb.md:12 / BEAR-LINES-01 (story.md  |
| NPC-BEAR-01 | backlog.md:1469 | arch-review [PC-B game, kestrel-3; touched engine/world/World.js] - deps: designer `voxel_bear. | testing (PO OK on file) | commit 7112252d NPC-BEAR-01: Burl placed in world_m1 (1471.0, 1029.; verdict test-reports\batch-review-2026-10-09-pcb.md:184 1. **NPC-BEAR-01, the  |
| NPC-TALK-ANIM-01 | backlog.md:1472 | Jaw lip-sync to the typed text (vowel open, space/punctuation closed) + epic owner walk | testing (PO OK on file) | commit 552e083e NPC-TALK-ANIM-01: game/js/quest/jawSync.js - jaw fo; verdict test-reports\batch-review-2026-10-09-pcb.md:190 5. **NPC-TALK-ANIM-01  |
| BEAR-LINES-01 | backlog.md:1474 | todo | testing (PO OK on file) | commit 6ec317f2 docs: BEAR-LINES-01 - Burl the bear: name, personal; verdict test-reports\po-batch2-2026-10-09-pcb.md:12 / BEAR-LINES-01 (story.md  |
| NPC-BEAR-01 | backlog.md:1484 | arch-review | testing (PO OK on file) | commit 7112252d NPC-BEAR-01: Burl placed in world_m1 (1471.0, 1029.; verdict test-reports\batch-review-2026-10-09-pcb.md:184 1. **NPC-BEAR-01, the  |
| NPC-TALK-ANIM-01 | backlog.md:1517 | todo | testing (PO OK on file) | commit 552e083e NPC-TALK-ANIM-01: game/js/quest/jawSync.js - jaw fo; verdict test-reports\batch-review-2026-10-09-pcb.md:190 5. **NPC-TALK-ANIM-01  |
| CHARGEN-01 | backlog.md:1541 | `content/chargen/human.charkit.json`, `design/chargen/*`, `design/palette.js` (append), `design | see verdict (CHANGES/REJECT on file) | commit 9b51162d CHARGEN-01 face v2 (owner: redesign the face): m_av; verdict test-reports\batch-review-2026-10-09-pcb.md:291 7. **CHARGEN-01 kit ge |
| CHARGEN-02 | backlog.md:1542 | arch-review [PC-B B2, 0.75 d] | see verdict (CHANGES/REJECT on file) | commit 1042b7d8 CHARGEN-02/03 batch 9 fixes + CHARGEN-06 + CHARGEN-; verdict test-reports\batch-review-2026-10-09-pcb.md:276 5. **CHARGEN-02 kit /  |
| CHARGEN-03 | backlog.md:1543 | arch-review [PC-B B2, 0.75 d] | see verdict (CHANGES/REJECT on file) | commit 4ad032d3 CHARGEN-03 (38.29): engine/chargen meshCharacter (p; verdict test-reports\batch-review-2026-10-09-pcb.md:283 6. **CHARGEN-03 mesh / |
| CHARGEN-05 | backlog.md:1546 | arch-review [PC-B B2, 0.5 d] | arch-review | commit ebb03160 CHARGEN-05 (38.29) + CHARGEN-03 follow-up: heightBa |
| CHARGEN-08 | backlog.md:1549 | arch-review [PC-B B1, 0.5 d] (already delivered inside CHARGEN-07 writer; verified, no code cha | arch-review | commit a34ca93d CHARGEN-08/09: status - rigid skin + baked clips al |
| CHARGEN-10 | backlog.md:1551 | arch-review [PC-B B1, 0.75 d] (static part done: binary FBX 7.4, own reader in the test; Blende | arch-review | commit bbbc37cd CHARGEN-10 (static FBX) + glb colour default: tools |
| CHARGEN-11 | backlog.md:1552 | arch-review [PC-B B1, 0.75 d] (opts.skeleton:true: 22 LimbNodes+NodeAttributes, rigid Skin + 22 | arch-review | commit a815be33 CHARGEN-11: FBX skeleton option - 22 LimbNodes, rig |
| CHARGEN-12 | backlog.md:1553 | arch-review [PC-B B1, 0.75 d] | arch-review | commit 75279091 CHARGEN-12: FBX clips (AnimationStack/Layer per cli |
| CHARGEN-13a | backlog.md:1554 | arch-review [PC-B B1, 0.5 d] | arch-review | commit 50a30364 CHARGEN-13a: tools/chargen/core.js createChargen fa |
| CHARGEN-14 | backlog.md:1557 | App Save/Open `.kestrel` + "All formats (.zip)" + `platform.js` adapter (browser fallback) | arch-review | commit 6846cbf8 CHARGEN-14: tools/chargen/platform.js createPlatfor |
| RIG-01 | backlog.md:1561 | arch-review [PC-B B2, 0.75 d] | arch-review | commit af65f0c4 RIG-01: readRiggedGlb + sampleRiggedClip in engine/ |
| RIG-03 | backlog.md:1563 | arch-review (engine half + RIG-03w main.js/charRegister.js done, B1) [PC-B B2] | arch-review | commit b08a3061 RIG-03 (engine half): engine/content/package.js loa |
| CHARGEN-22a | backlog.md:1568 | arch-review [PC-B kestrel-3, 0.75 d; done: downsample.js, kit regions/resLevels/detail/keep/sea | arch-review | commit 8f7c5118 CHARGEN-22a: per-recipe detail kit + recipe half (3 |
| CHARGEN-22b | backlog.md:1569 | arch-review [PC-B kestrel-3, done 2026-10-10: see docs/lanes/pc-b2.md] | arch-review | commit 6a814edc CHARGEN-22b: mixed-resolution compose + mesh (38.34 |
| CHARGEN-22c | backlog.md:1570 | arch-review [PC-B kestrel-3] (done 8bf69597: vox at finest grid, savePackage clamp + warnings,  | arch-review | commit 8bf69597 CHARGEN-22c: .vox at the finest grid (flattenGrid,  |
| CHARGEN-23 | backlog.md:1573 | Designer: head redraw at 1.25 cm (`base.detail.head["2"]`, D-055): eyes with lid + lash line, i | arch-review | commit 808d1532 CHARGEN-23: kit rebuilt with the fine head detail b |
| RIG-03w | backlog.md:1576 | todo [PC-B kestrel-1, 0.25 d] - deps RIG-02b -> arch-review | arch-review | commit 4f4abe26 RIG-03w: game/js/quest/charRegister.js registerRigg |
| RIG-GC-01 | backlog.md:1577 | todo [PC-B kestrel-2, 0.5 d] - deps RIG-02b -> arch-review | arch-review | commit 08c6cf68 RIG-GC-01: gpucompare row world_m1: charRig (rigged |
| RIG-04 | backlog.md:1578 | arch-review (alloc FIXED by RIG-04b, see lanes/pc-b2.md) [PC-B kestrel-4] | arch-review | commit 47110d17 RIG-04 (partial): tools/bench-rig.mjs (100 char. in |
| WILD-07a | backlog.md:1579 | arch-review [PC-B kestrel-3, 0.75 d] - deps WILD-04 (done); flyerBrain.js + test done, see lane | arch-review | commit 9c870fcd WILD-07a: engine/fauna/flyerBrain.js (perch/hop/tak |
| KPKG-01 | backlog.md:1582 | arch-review [PC-B B2, 0.5 d] -> arch-review | see verdict (CHANGES/REJECT on file) | commit 6409f001 KPKG-01 (38.30): engine/content/zip.js readZip / wr; verdict test-reports\batch-review-2026-10-09-pcb.md:253 1. **KPKG-01 zip.js**: |
| KPKG-02 | backlog.md:1583 | arch-review [PC-B B2, 0.75 d] -> arch-review | see verdict (CHANGES/REJECT on file) | commit 5b675dd3 KPKG-02 (38.30): engine/content/package.js validate; verdict test-reports\batch-review-2026-10-09-pcb.md:259 2. **KPKG-02 package.j |
| KPKG-03 | backlog.md:1584 | arch-review [PC-B B1, 0.5 d] | see verdict (CHANGES/REJECT on file) | commit eba0b65d KPKG-03 (pack part): tools/pack.mjs (spec -> determ; verdict test-reports\batch-review-2026-10-09-pcb.md:266 3. **KPKG-03 pack/unpa |
| CHARGEN-01 | backlog.md:1589 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit 9b51162d CHARGEN-01 face v2 (owner: redesign the face): m_av; verdict test-reports\batch-review-2026-10-09-pcb.md:291 7. **CHARGEN-01 kit ge |
| CHARGEN-02 | backlog.md:1604 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit 1042b7d8 CHARGEN-02/03 batch 9 fixes + CHARGEN-06 + CHARGEN-; verdict test-reports\batch-review-2026-10-09-pcb.md:276 5. **CHARGEN-02 kit /  |
| CHARGEN-03 | backlog.md:1617 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit 4ad032d3 CHARGEN-03 (38.29): engine/chargen meshCharacter (p; verdict test-reports\batch-review-2026-10-09-pcb.md:283 6. **CHARGEN-03 mesh / |
| CHARGEN-05 | backlog.md:1639 | (no status tag) | arch-review | commit ebb03160 CHARGEN-05 (38.29) + CHARGEN-03 follow-up: heightBa |
| CHARGEN-10 | backlog.md:1665 | (no status tag) | arch-review | commit bbbc37cd CHARGEN-10 (static FBX) + glb colour default: tools |
| CHARGEN-13a | backlog.md:1682 | (no status tag) | arch-review | commit 50a30364 CHARGEN-13a: tools/chargen/core.js createChargen fa |
| RIG-01 | backlog.md:1707 | (no status tag) | arch-review | commit af65f0c4 RIG-01: readRiggedGlb + sampleRiggedClip in engine/ |
| CHARGEN-15 | backlog.md:1715 | (no status tag) | arch-review | commit 3bb57694 CHARGEN-15 tests: content-smoke resolves add-on cha |
| KPKG-01 | backlog.md:1728 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit 6409f001 KPKG-01 (38.30): engine/content/zip.js readZip / wr; verdict test-reports\batch-review-2026-10-09-pcb.md:253 1. **KPKG-01 zip.js**: |
| KPKG-02 | backlog.md:1738 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit 5b675dd3 KPKG-02 (38.30): engine/content/package.js validate; verdict test-reports\batch-review-2026-10-09-pcb.md:259 2. **KPKG-02 package.j |
| KPKG-03 | backlog.md:1748 | (no status tag) | see verdict (CHANGES/REJECT on file) | commit eba0b65d KPKG-03 (pack part): tools/pack.mjs (spec -> determ; verdict test-reports\batch-review-2026-10-09-pcb.md:266 3. **KPKG-03 pack/unpa |
| WILD-01 | backlog.md:1767 | arch-review [PC-B B2, 0.5 d] | arch-review | commit db123267 WILD-01 + WILD-02 (38.31): voxel pose crossfade (sa |
| WILD-03 | backlog.md:1769 | arch-review [PC-B B1, 0.75 d] | arch-review | commit 0a7506f9 WILD-03 (38.31): engine/fauna faunaDef (clip resolu |
| WILD-04 | backlog.md:1770 | todo [PC-B B1, 0.75 d] - deps WILD-02, 03 -> arch-review | arch-review | commit aa19acff WILD-04 (38.31): engine/fauna groundBrain (idle/gra |
| WILD-05 | backlog.md:1771 | arch-review [PC-B B2] - feed 0.0012 ms p95, 20 drawn / 11.9k quads (real rabbit+deer), 0 alloc; | arch-review | commit 4d0ea403 WILD-05: fox (flee, pounce), squirrel (climberBrain |
| WILD-04 | backlog.md:1772 | arch-review [PC-B B1] (impl done; see note) | arch-review | commit aa19acff WILD-04 (38.31): engine/fauna groundBrain (idle/gra |
| WILD-05 | backlog.md:1773 | todo [PC-B B2, 0.5 d] - deps WILD-01, 04 -> arch-review | arch-review | commit 4d0ea403 WILD-05: fox (flee, pounce), squirrel (climberBrain |
| WILD-06 | backlog.md:1774 | Game wiring: FaunaEnv (habitat from terrain.typeAt, trunk grid, blocked, moveCircle), rabbit +  | arch-review | commit e1ee42c1 WILD-06: game wiring of ambient fauna - game/js/wil |
| RESIZE-RECOVER-01 | backlog.md:1785 | arch-review [PC-B B1] | arch-review | commit 52c3ed1b RESIZE-RECOVER-01: WgCellPipeline failed grid resiz |
| FRAME-ALLOC-03 | backlog.md:1786 | arch-review [PC-B B1] | arch-review | commit a2f55e6f FRAME-ALLOC-03: frameRenderer zero-alloc gate - Nod |
| GPU-OFF-REASON-01 | backlog.md:1787 | WG pipeline warns why the GPU path turned off (+ fix any settings-driven silent off) | arch-review | commit fb84ed50 GPU-OFF-REASON-01: WgCellPipeline warns once per GP |
| CULL-CAP-01 | backlog.md:1788 | arch-review [PC-B main] (gpucompare + route walk + verify-wild PASS) | arch-review | commit 1c2145a4 CULL-CAP-01: fix the GPU path dropping to CPU mid-s |
| WILD-01 | backlog.md:1790 | (no status tag) | arch-review | commit db123267 WILD-01 + WILD-02 (38.31): voxel pose crossfade (sa |
| WILD-03 | backlog.md:1808 | (no status tag) | arch-review | commit 0a7506f9 WILD-03 (38.31): engine/fauna faunaDef (clip resolu |
| WILD-04 | backlog.md:1825 | (no status tag) | arch-review | commit aa19acff WILD-04 (38.31): engine/fauna groundBrain (idle/gra |
| WILD-05 | backlog.md:1838 | (no status tag) | arch-review | commit 4d0ea403 WILD-05: fox (flee, pounce), squirrel (climberBrain |
| WILD-06 | backlog.md:1847 | (no status tag) | arch-review | commit e1ee42c1 WILD-06: game wiring of ambient fauna - game/js/wil |
| QG-01 | backlog.md:1879 | arch-review | arch-review | commit 808bedc8 QG-01 + QG-02 (D-058): game/js/quest/sim/questBook. |
| QG-03 | backlog.md:1881 | (no status cell) QG-01, QG-02, QG-D1 (coin def; until then reward an existing item) | arch-review | commit 599c1a20 QG-03 (D-058): Burl's boar quest end to end - quest |
| QG-04 | backlog.md:1882 | (no status cell) QG-03, QG-D1 | arch-review | commit 3d5fa462 QG-04 + QG-05 mount (D-058): giver markers ! (avail |
| QG-05 | backlog.md:1883 | kestrel-1 (VIEW DONE kestrel-2, mount = NEEDS B1-main) | arch-review | commit 4f7e906e QG-05 test: quest title is the writer's 'Boars in t |
| QG-W1 | backlog.md:1886 | (no status cell) - | arch-review | commit 6f2379bd QG-W1: Burl's boar quest texts (writer, opus) in do |
| QG-D1 | backlog.md:1887 | designer | arch-review | commit dadd12de QG-D1: ? quest-ready marker questMarkReady (designe |
| QG-01 | backlog.md:1889 | (no status tag) | arch-review | commit 808bedc8 QG-01 + QG-02 (D-058): game/js/quest/sim/questBook. |
| QG-03 | backlog.md:1900 | (no status tag) | arch-review | commit 599c1a20 QG-03 (D-058): Burl's boar quest end to end - quest |
| QG-04 | backlog.md:1910 | (no status tag) | arch-review | commit 3d5fa462 QG-04 + QG-05 mount (D-058): giver markers ! (avail |
| QG-05 | backlog.md:1915 | (no status tag) | arch-review | commit 4f7e906e QG-05 test: quest title is the writer's 'Boars in t |
| QG-W1 | backlog.md:1920 | (no status tag) | arch-review | commit 6f2379bd QG-W1: Burl's boar quest texts (writer, opus) in do |
| QG-D1 | backlog.md:1923 | (no status tag) | arch-review | commit dadd12de QG-D1: ? quest-ready marker questMarkReady (designe |
| WS1-04 | backlog.md:1936 | `content/worlds/world_m1.world.json` (bounds union, terrainBand, `relayBend` + base mesh, `ways | arch-review | commit 14168122 WS1-04 (D-060): world_m1 bounds union (circle r96 + |
| WS1-05 | backlog.md:1937 | `tools/gen-roadside-meshes.mjs` (flags + `scale` fix), `content/worlds/world_m1.world.json` (`r | arch-review | commit 4a13e1ec WS1-05 (D-060): gen-roadside-meshes prefixes roadW/ |
| WS1-W1 | backlog.md:1944 | todo NEEDS WRITER | arch-review | commit 597d09b4 WS1-W1: relay waystone texts (writer, opus) - Bend  |
| WS1-01 | backlog.md:1946 | (no status tag) | arch-review | commit dc02cf33 WS1-01 (D-060): engine/physics/bounds.js projectBou |
| WS1-02 | backlog.md:1952 | (no status tag) | arch-review | commit a6c50587 WS1-02 ARCH CHANGES fix: TerrainMeshSet.step builds |
| WS1-03 | backlog.md:1958 | (no status tag) | arch-review | commit ab0d9546 WS1-03 (D-060): terrainRaster.wgsl terrainTypeAt re |
| WS1-04 | backlog.md:1962 | (no status tag) | arch-review | commit 14168122 WS1-04 (D-060): world_m1 bounds union (circle r96 + |
| WS1-05 | backlog.md:1968 | (no status tag) | arch-review | commit 4a13e1ec WS1-05 (D-060): gen-roadside-meshes prefixes roadW/ |
| WS1-06a | backlog.md:1974 | (no status tag) | arch-review | commit 317ffefb WS1-06a (D-060/D-057): waystone sim for many points |
| WS1-06b | backlog.md:1981 | (no status tag) | arch-review | commit afac44ce WS1-06b review fix: relayWake forces AWAKE 3 s afte |
| WS1-07a | backlog.md:1987 | (no status tag) | arch-review | commit 95edfc03 WS1-07a (D-057/D-060): map card travel UI - digit m |
| WS1-07b | backlog.md:1992 | (no status tag) | arch-review | commit a054dfba WS1-07b (D-057/D-060): map travel - game/js/quest/t |
| WS1-08 | backlog.md:1997 | (no status tag) | arch-review | commit 42dfafcc docs: WS1-08 gates PASS (perf open), CH1-D2 po-revi |
| WS1-W1 | backlog.md:2005 | (no status tag) | arch-review | commit 597d09b4 WS1-W1: relay waystone texts (writer, opus) - Bend  |
| CH1-07 | backlog.md:2025 | `game/js/quest/npcWalk.js` (new) + test, `game/js/quest/npcBear.js` (pause turning while walkin | arch-review | commit cec09576 CH1-07 mount + CH1-04b + CH1-08b (D-062): main.js m |
| CH1-08a | backlog.md:2026 | todo [PC-B] | arch-review | commit 9bf0ac58 CH1-08a (D-062): Fen data - build-villager --recipe |
| CH1-10 | backlog.md:2029 | todo [PC-B] | arch-review | commit 2f020476 CH1-10 gate fixes: route-walk imports moveCircleMes |
| CH1-D1a | backlog.md:2030 | designer | arch-review | commit 5527bb80 CH1-D1a follow-up: route-walk legs 3/4/5b/7a re-rou |
| CH1-D1b | backlog.md:2031 | `content/levels/tower.level.json` (wall heights, rounded outer ring), `design/models/voxel_towe | arch-review | commit fd8f2a73 CH1-D1b part 1 (D-062): taller tower walls (designe |
| CH1-01 | backlog.md:2041 | (no status tag) | arch-review | commit 1e3650ad CH1-01 follow-up: world.test expects the 6 world tr |
| CH1-02 | backlog.md:2047 | (no status tag) | arch-review | commit 3204c465 CH1-02 (D-062): wire the m1 chain - questRelay.ques |
| CH1-03 | backlog.md:2053 | (no status tag) | arch-review | commit 5290b83d CH1-03 (D-062): game/js/quest/crystal.js createCrys |
| CH1-04a | backlog.md:2057 | (no status tag) | arch-review | commit e6034edf CH1-04a (D-062): game/js/ui/noticeView.js notice ba |
| CH1-05 | backlog.md:2067 | (no status tag) | arch-review | commit 117734ab CH1-05 (D-062): Burl full dialogue graph (9 entries |
| CH1-06 | backlog.md:2072 | (no status tag) | arch-review | commit b62646b6 CH1-06 (D-062): dialogueCtl s.<key> route (world.st |
| CH1-E1 | backlog.md:2077 | (no status tag) | arch-review | commit 105de570 CH1-E1 + CH1-E2 (D-062): engine/nav/pathFollow.js c |
| CH1-07 | backlog.md:2086 | (no status tag) | arch-review | commit cec09576 CH1-07 mount + CH1-04b + CH1-08b (D-062): main.js m |
| CH1-08a | backlog.md:2092 | (no status tag) | arch-review | commit 9bf0ac58 CH1-08a (D-062): Fen data - build-villager --recipe |
| CH1-09 | backlog.md:2101 | (no status tag) | arch-review | commit 757f9eef CH1-09 (D-062): game/js/quest/chapterCard.js (dim 5 |
| CH1-10 | backlog.md:2106 | (no status tag) | arch-review | commit 2f020476 CH1-10 gate fixes: route-walk imports moveCircleMes |
| CH1-D1a | backlog.md:2111 | (no status tag) | arch-review | commit 5527bb80 CH1-D1a follow-up: route-walk legs 3/4/5b/7a re-rou |
| CH1-D1b | backlog.md:2117 | (no status tag) | arch-review | commit fd8f2a73 CH1-D1b part 1 (D-062): taller tower walls (designe |
| CH1-D2 | backlog.md:2121 | (no status tag) | arch-review | commit ba6b31bb CH1-D2 follow-up: palette lights.waystone (aether 0 |
| CH1-D3 | backlog.md:2125 | (no status tag) | arch-review | commit 000cb1c8 CH1-D3 (D-062/D-063): Fen recipe (designer, opus) - |
| ART-01a | pc-b-queue.md:113 | (no status cell) - | arch-review | commit 1b7ccc5e ART-01a: look engine data + roof map (resolveLook/v |
| ART-04a | pc-b-queue.md:114 | (no status cell) 01a | arch-review | commit 30eb7dad ART-04a: clouds JS twin (cloudAt + drift + value no |
| WS2-01 | pc-b-queue.md:193 | arch-review (NEEDS PC-A) | arch-review | commit 0de80a23 WS2-01 (38.38): terrainBands zones (1..4 same size, |
| WS2-02 | pc-b-queue.md:194 | arch-review (NEEDS PC-A) | arch-review | commit 4d230191 WS2-02 (38.38): resumable TreeScatterJob/DetailScat |
| WS2-03 | pc-b-queue.md:195 | arch-review (NEEDS PC-A) | arch-review | commit d643b4b7 WS2-03 (38.38): terrainMesh far re-bake carve uses  |
| WS2-05 | pc-b-queue.md:197 | arch-review (NEEDS PC-A) | arch-review | commit 9cad7b5b WS2-05 (38.38): main.js streamBand each frame (terr |
| WS2-07 | pc-b-queue.md:199 | content/worlds/world_m1.world.json, design/levels/overworld_far.js (detail.exclude), gen-roadsi | testing (PO OK on file) | commit 41c72457 WS2-07 (D-064 ford = stepping stones): world_m1 ter; verdict test-reports\po-batch-m4-2026-10-11.md:6 - PO OK: 29 (WS2-07, DN-04a,  |
| GROUND-SEAM-01 | pc-b-queue.md:205 | (no status tag) | arch-review | commit 12f0582a docs: GROUND-SEAM-01 story GS-01a..e (tower outer r |
| GS-01a | pc-b-queue.md:216 | arch-review (NEEDS PC-A) | arch-review | commit 37e8031e GS-01a (GROUND-SEAM-01): Level legend flag terrainF |
| GS-01b | pc-b-queue.md:217 | arch-review (NEEDS PC-A) | arch-review | commit 40ec6b76 GS-01b + AUD-02/33: GPU terrain raster + shadow car |
| GS-01c | pc-b-queue.md:218 | arch-review (NEEDS PC-A) | arch-review | commit 661dbe60 GS-01c: scatterDetail keep-out = structClearM aroun |
| DN-01 | pc-b-queue.md:229 | engine/render/look.js (+test), engine/render/lighting.js (moon switch, night floor), engine/ren | arch-review | commit 4257249d DN-01 (38.39): blendLook(P,hour,schedule,out) -> P. |
| DN-02 | pc-b-queue.md:230 | arch-review (NEEDS PC-A) | po-review (ARCH OK on file) | commit 95b79ab3 DN-02 (38.39) + shadow fix (owner: shadows move eve; verdict test-reports\po-batch-2026-10-10-evening-pcb.md:26 **Fix (pick one):** |
| DN-04a | pc-b-queue.md:232 | PO OK (2026-10-11) | testing (PO OK on file) | commit 80d22a27 DN-04a (38.39): shared tools/tool-url.mjs (withTime; verdict test-reports\po-batch-m4-2026-10-11.md:6 - PO OK: 29 (WS2-07, DN-04a,  |
| DN-04b | pc-b-queue.md:233 | po-review (2026-10-11 kestrel-3): 4 frozen rows (dusk 19.5 h + night 23 h x Bend lamps / tower) | arch-review | commit c17cca67 DN-04b + MAP-07 + MAP-14/M4-C3 gates: dusk/night gp |
| DN-Q1 | pc-b-queue.md:234 | owner | arch-review | commit b8c3a28d DN-Q1 (owner: sun still visibly moving): default ga |
| EQ-01 | pc-b-queue.md:247 | design/items.js (+ content items), game/js/quest/sim/inventory.js `validateItemDefs` (+test) | testing (PO OK on file) | commit e596ef70 EQ-01: gear item data - equip:{slot,tier,def,shell,; verdict test-reports\po-batch-2026-10-12-pcb.md:6 Already marked PO OK in the  |
| EQ-02 | pc-b-queue.md:248 | PO OK (2026-10-11) | arch-review | commit 791e5fe9 EQ-02: equipment component (equip/unequip, full pac |
| EQ-04 | pc-b-queue.md:250 | ready (38.40) | arch-review | commit 85f03f3e decisions: EQ-04 preview stage budget 12 ms |
| EQ-05 | pc-b-queue.md:251 | ready (38.40 item 6: cache.js, SHELL_ORDER, game gearLook.js) | arch-review | commit 243936fd EQ-05: createCharCache (LRU by recipe hash, recompo |
| EQ-06 | pc-b-queue.md:252 | ready (38.41) | arch-review | commit 9075570c EQ-06: shield block sim (createShieldSim raise 7/lo |
| EQ-08 | pc-b-queue.md:254 | PO OK (2026-10-11) | arch-review | commit 7a402561 EQ-08: arrow sim (sim/arrows.js + bowConfig BOW_CFG |
| EQ-10 | pc-b-queue.md:256 | AC1 loot = 0..4 rolled entries from a table (replaces fixed `ITEMS_PER_CORPSE` 3); seeded rng,  | arch-review | commit 2d694a87 EQ-10 + chest contents: rolled loot (0..4, seeded;  |
| EQ-11 | pc-b-queue.md:257 | PO OK (2026-10-11) | arch-review | commit 7cd65d2c EQ-11: content/items/loot.json (boar 4 %, container |
| MAP-01a | pc-b-queue.md:270 | design/levels/overworld_far.js (layer composer, keep mask, GeoFields) + engine/world/geoLayers. | arch-review | commit f075825b MAP-01a (38.42): terrain layer composer in overworl |
| MAP-01b | pc-b-queue.md:271 | READY (38.42). AC1 `map.x0/y0` far grid origin + w/h <= 512 (default 0,0,256,256 byte-identical | testing (PO OK on file) | commit 62a96a62 MAP-01b: far grid origin + size (cap 512, default b; verdict test-reports\batch-review-2026-10-08.md:19 / MAP-01b / ARCH CHANGES (C |
| MAP-01c | pc-b-queue.md:272 | READY after 01a. AC1 per-biome forest species weights + fill, detail `densityMult`; biome 0 ins | arch-review | commit da14f9fe MAP-01c: biome planting (compileBiomes hook in scat |
| MAP-04 | pc-b-queue.md:275 | PO OK (2026-10-11; ARCH OK; geoMap.test 21 ok; dry stretch below ford = RIVER-04 open item) | testing (PO OK on file) | commit 70134cc2 MAP-04: river polyline source -> Glasswater -> ford; verdict test-reports\po-batch-2026-10-12-pcb.md:8 MAP-04 is PO OK and ARCH OK. |
| MAP-06a | pc-b-queue.md:277 | arch-review | arch-review | commit 1ae37f14 MAP-06a (JS twin only, held until 06b): skyline fog |
| MAP-06b | pc-b-queue.md:278 | arch-review + owner look | arch-review | commit d59397e1 handoff: MAP-06b ready to merge; skyline picture |
| MAP-08 | pc-b-queue.md:280 | arch done (2026-10-11 kestrel-6, PC-B architect opus): option B baked far mesh `far/ferrum_far` | arch-review | commit bc0406a0 MAP-08 draft dusk picture |
| MAP-09 | pc-b-queue.md:281 | Locked gate pass (owner 2026-10-11): in the fourth-side mountains a fortified pass - gate + wal | arch-review | commit 093f5c87 MAP-09: the Sealed Gate (gen-sealed-gate.mjs: curta |
| MAP-10 | pc-b-queue.md:282 | PO OK (2026-10-11; ARCH OK; terrainGrid.test 27 PASS) | arch-review | commit 5ec1ae53 MAP-10: band grid (bandGrid.js pure zone pick + hys |
| MAP-11 | pc-b-queue.md:283 | PO OK (2026-10-11; ARCH OK; polygon bounds only live with ?grid=1) | arch-review | commit 1d6b3a40 MAP-11: polygon walk bounds (64 m buckets, 0 alloc, |
| MAP-12 | pc-b-queue.md:284 | PO OK (2026-10-11; ARCH OK; condition: run gpucompare row `gridZone` once, not yet run) | arch-review | commit 31aba93d MAP-12: near type upload keyed on world + version ( |
| MAP-13 | pc-b-queue.md:285 | arch-review | arch-review | commit c4f77f08 MAP-13: ensureBand on load / travel / respawn (fade |
| MAP-21 | pc-b-queue.md:288 | PO OK (2026-10-11; 6 bushes per sq.burl.blue) | arch-review | commit a20b017c MAP-21/22/24: POI props generator (gen-poi-props.mj |
| MAP-26 | pc-b-queue.md:293 | MAP-10..13, MAP-20, owner go after the stage 2 walk | arch-review | commit 516e8ea1 MAP-26: Outwall blockout from existing meshes (tool |
| QL-T1 | pc-b-queue.md:305 | ready (38.44 items 1-4, 6, 7) | arch-review | commit 71458d90 QL-T1: quest templates (7 kinds, steps, opensAfter, |
| QL-T2 | pc-b-queue.md:306 | ready (38.44 items 10-11) | arch-review | commit ab5ea025 QL-T2: quest graph lint (giver sites placed, reacha |
| QL-T3 | pc-b-queue.md:307 | Per 38.44 items 8-9: fact -> listener index, status recompute only for touched quests + depende | arch-review | commit c9dc155b QL-T3: indexed quest feed (only listening quests +  |
| QL-T4 | pc-b-queue.md:308 | Per 38.44 item 5: generated `q.<id>.ready/active/available` entries + nodes per site, writer `l | arch-review | commit 04fee805 QL-T4: generated quest dialogue for every giver (q. |
| QL-W1 | pc-b-queue.md:309 | PO OK (2026-10-11) | arch-review | commit fa277361 QL-W1 + MAP-27 (writer, owner-authorised while PC-A |
| QL-01 | pc-b-queue.md:311 | `pickups` condition `{type:"pickups", ids:[...], count}` counted from a `pickedUp` list (copy o | testing (PO OK on file) | commit 73418754 QL-01: collect/deliver quest objectives (absolute i; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| QL-02 | pc-b-queue.md:312 | Lint: every `pickups` id exists as a placed `prop.pickup`, count <= ids, every quest `area` id  | testing (PO OK on file) | commit 9cc688d8 QL-02 follow-up: quest lint skips flag-only require; verdict test-reports\po-batch-2026-10-12-pcb.md:6 Already marked PO OK in the  |
| QL-04 | pc-b-queue.md:314 | PO OK (2026-10-11) | arch-review | commit ff56a5ed QL-04 + QL-08: objects as quest givers/hand-ins (gi |
| QL-05 | pc-b-queue.md:315 | PO OK (2026-10-11; burl.home + sq.burl.blue + escort lead; burlEscort tests) | testing (PO OK on file) | commit 9dba5dcc QL-05 + QL-03: Burl returns to her berry slope afte; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| QL-09 | pc-b-queue.md:319 | po-review (M4 build 2026-10-11, kestrel-4): quest in ch12 pack.json, anchors via gen-poi-props. | testing (PO OK on file) | commit cc490a35 QL-09..12: wreck plate (boar hide -> Brass Buckler); verdict test-reports\po-batch-2026-10-12-pcb.md:11 - QL-09 (wreck.plate), QL-1 |
| QL-14 | pc-b-queue.md:324 | WS2-07 (done) | arch-review | commit accd13e1 QL-14 follow-up: world.test expects 9 world-level t |
| QL-16 | pc-b-queue.md:326 | po-review (2026-10-11, kestrel-5): added `gear.feet.riverBoots` (unique, skipped by loot.js gea | testing (PO OK on file) | commit 28b9092f QL-16/17/19: River Boots (unique, not in loot rolls; verdict test-reports\po-batch-2026-10-12-pcb.md:12 - QL-16 (ford.mirror): PO O |
| QL-19 | pc-b-queue.md:329 | po-review (2026-10-11, kestrel-5): equipment.js nightBonus (any cloak +0.10 reduction clock 21- | testing (PO OK on file) | commit e8353fc7 QL-19: River Boots wired - sprinting onto a wet for; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| RIVER-01a | pc-b-queue.md:338 | PO OK (2026-10-11; ARCH OK; river.test 37) | testing (PO OK on file) | commit e5ac7a58 RIVER-01a (OB-019): river water shape - validation,; verdict test-reports\po-batch-m4-2026-10-11.md:6 - PO OK: 29 (WS2-07, DN-04a,  |
| RIVER-01b | pc-b-queue.md:339 | PO OK (2026-10-11; ARCH OK; wading.test 28) | arch-review | commit 13455759 RIVER-01b (OB-019): river physics - body pushX/push |
| RIVER-02 | pc-b-queue.md:340 | PO OK (2026-10-11, main session correction: RIVER-04 resolution 38.45-6 merged - bed carved, wa | arch-review | commit 435a3074 RIVER-02 (OB-019): river ribbon mesh (64 m chunks,  |
| RIVER-03 | pc-b-queue.md:341 | PO OK (2026-10-11, main session correction: RIVER-04 resolution 38.45-6 merged - bed carved, wa | arch-review | commit 963d355d RIVER-03 (OB-019): WebGPU river ribbon (waterRiver. |
| RIVER-04 | pc-b-queue.md:342 | tools/gen-river-water.mjs v2, content/worlds/world_m1.world.json, game/js/dev/riverWater.test.j | arch-review | commit 0f62311d RIVER-04 (OB-019): river resolution (architect 38.4 |
| M4-C1 | pc-b-queue.md:348 | Batch verdict on every row still marked po-review (EQ-01..13, QL-01..19, MAP-02..05, EQ-D1/D2,  | arch-review | commit 583b6173 M4-C1 PO batch verdict: 29 PO OK, 19 owner-look, 12 |
| M4-C2 | pc-b-queue.md:349 | PO REJECT (2026-10-11): only verify-m4-exit (save/Continue) exists; no scripted Ch1-2 run of al | testing (PO OK on file) | commit 1062e836 M4-C2 follow-up (CL-01 input): verify-ch12-run --wa; verdict test-reports\po-batch-2026-10-11-pcb.md:5 **Result:** 23 PO OK, 2 PO R |
| EQ-20 | pc-b-queue.md:357 | new design/itemsWeapons.js (+test), content/loot/weapons.json (data only); items.js gets ONE re | arch-review | commit 220e2372 EQ-20: sword/bow/shield sturdy + fine tiers (damage |
| EQ-21 | pc-b-queue.md:358 | design/items.js (tiers + 14 defs), game/js/quest/sim/band.js (`gearItemTier`), game/js/quest/si | arch-review | commit 0e7882c7 EQ-21: armour tiers 4-5 (tempered def 4, warden def |
| EQ-23 | pc-b-queue.md:360 | todo | arch-review | commit dd864413 EQ-23: quest-reward leftovers drop as a world picku |
| MAP-26 | pc-b-queue.md:367 | todo (po-review) | arch-review | commit 516e8ea1 MAP-26: Outwall blockout from existing meshes (tool |
| QL-21 | pc-b-queue.md:368 | todo (po-review) | arch-review | commit fcc3e17d QL-21 texts: ch3 quest titles/objectives/lines, Out |
| WOLF-D1 | pc-b-queue.md:369 | new design/models/voxel_wolf.js, design/preview/wolf.html, design/palette.js (append 3-4 entrie | arch-review | commit 6989db98 WOLF-D1 wiring: wolves use the voxel wolf model + w |
| WOLF-01 | pc-b-queue.md:370 | todo (po-review) | arch-review | commit 26c49335 WOLF-01: wolf pack beast (crouch/leap/retreat, per- |
| US-129a | pc-b-queue.md:371 | todo (po-review) | arch-review | commit fa59c03d US-129a: zone band -> beast stats + gear-drop tier  |
| US-055a | pc-b-queue.md:372 | todo (arch-review) | testing (PO OK on file) | commit c2a4b831 US-055a: wade splash + ripple rings (engine/fx/wade; verdict test-reports\po-batch-2026-10-11-pcb.md:15 / QL-19b wet stones / **PO  |
| PART-VIS-01 | pc-b-queue.md:373 | dev done, arch-review | arch-review | commit caaf95c0 PART-VIS-01: particle bgMix tints the cell backgrou |

## OWNER LOOK

| ID | file:line | current status | suggested | evidence |
|---|---|---|---|---|
| US-091a2 | backlog.md:154 | **PO OK 2026-10-07 - ready for owner look (all 6 ACs met per row; no reject). PO call: set inte | owner-look | commit 54140271 US-091a2: boar loot roll at death, corpse [E] Loot  |
| HANDS-01c | backlog.md:158 | **ARCH OK 2026-10-07 (opus batch: 7859dd1 dLSample is the first violating cell, 90.004 deg tie, | owner-look | commit 7859dd13 HANDS-01c follow-up: gpucompare cmpLight.dLSample;  |
| ED-WG-01 | backlog.md:247 | PC-B 2026-10-09: 01a/b/c done -> arch-review + owner editor look. Was: todo (D-052) - **hard pr | owner-look | commit 06669874 docs: ED-WG-01 tech note 38.21 (createFrameRenderer; verdict test-reports\batch-review-2026-10-09-pcb.md:166 6. **WG-5b/5c (k4 b988 |
| UI-PLATE-01 | backlog.md:352 | **AC2 DONE PC-A 2026-10-08: CellBuffer._parseColor warns once on undefined/invalid colour (whit | owner-look | commit 5b661025 UI-PLATE-01: confirm selection overlay visibility o |
| ED-MESH-01 | backlog.md:355 | **polish 3fb557f/67170c9/875c465 ARCH OK 2026-10-08 (38.8a item 26f) -> po-review; H-help overl | owner-look | commit 32143ed5 ED-MESH-01: show key help and fit the editor viewpo; verdict test-reports\batch-review-2026-10-08.md:20 / ED-MESH-01 help/viewport  |
| US-053c | backlog.md:468 | … + dirty rows, zero alloc); presets embers 0.08 (glyphs `**+o+o+o`, brighter, life 1.0-1.8 s), | owner-look | commit 7d66e6da US-053c polish: particle footprint by distance (siz |
| US-079a | backlog.md:563 | **PO OK 2026-10-01 (sonnet batch) -> testing; owner checks: "does it feel like it hunts me" (ch | owner-look | commit ee662e6e US-079a: beast brain + nav chase (first enemy, no d |
| US-091a2 | backlog.md:1367 | testing - PO OK 2026-10-07, owner look pending; radius -> 2.2 | owner-look | commit 54140271 US-091a2: boar loot roll at death, corpse [E] Loot  |
| ALPHA-01d | backlog.md:1456 | arch-review [WGSL + JS twin only, 2026-10-08: edge:'soft' flag, silhouette-only rule, softGain  | owner-look | commit 5bbea599 ALPHA-01d: soft foliage edges (material edge:'soft'; verdict test-reports\batch-review-2026-10-08.md:152 / ALPHA-01d soft foliage e |
| CH1-D2 | backlog.md:2032 | PO OK (design, claims) - open: owner look (design/preview/voxel-props.html, item-icons.html); c | owner-look | commit ba6b31bb CH1-D2 follow-up: palette lights.waystone (aether 0 |
| CH1-D3 | backlog.md:2033 | PO OK (recipe, 000cb1c8; D-063 style supersedes D-059) - open: owner look (chargen_kit.html out | owner-look | commit 000cb1c8 CH1-D3 (D-062/D-063): Fen recipe (designer, opus) - |
| CHARGEN-26b | backlog.md:2034 | PO OK (design) - owner look (crown hair layer dropped to stay <= 1.78 m); civilian seams need e | owner-look | commit 98973f98 CHARGEN-26b (D-063): character detail pass (designe |
| GS-01d | pc-b-queue.md:219 | PO OK - owner look pending (2026-10-11; walk-out seam + gpucompare tower-outside rows still to  | owner-look | commit 41f83fab GS-01d: tower outside grass cells (, ; l = 115) fla; verdict test-reports\po-batch-m4-2026-10-11.md:7 - PO OK - owner look pending: |
| GS-01e | pc-b-queue.md:220 | PO OK - owner look pending (2026-10-11; wall courses by eye from 20/35 m) | owner-look | commit 97668c44 GS-01e (owner: lower tower walls lack the brick loo; verdict test-reports\po-batch-m4-2026-10-11.md:7 - PO OK - owner look pending: |
| DN-03 | pc-b-queue.md:231 | PO OK - owner look pending (2026-10-11; owner walk at `?daylen=120`) | owner-look | commit aeb390bb DN-03 (38.39): game clock worldClock.js in world.st; verdict test-reports\po-batch-2026-10-10-evening-pcb.md:20 ### PO REJECT - DN- |
| EQ-D1 | pc-b-queue.md:245 | PO OK - owner look pending (2026-10-11; verify-equip-play PASS; shieldHeld anchor y 4.5 > size  | owner-look | commit 15852cb2 EQ-D1: equipment models - shieldHeld/shieldBack (0.; verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| EQ-03 | pc-b-queue.md:249 | PO OK - owner look pending (2026-10-11; drag-to-equip not built, E/Enter/click work) | owner-look | commit 6fdadcdf EQ-03 + EQ-04 wiring: Items / Character menu (I / C; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| EQ-07 | pc-b-queue.md:253 | PO OK - owner look pending (2026-10-11; verify-equip-play PASS block 21/21) | owner-look | commit 250057fa EQ-07 + EQ-09: shield + bow in play - LMB sword / d; verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| EQ-12 | pc-b-queue.md:258 | PO OK - owner look pending (2026-10-11; redesigned by QB-6 to 6 slots, verify-quickbar PASS) | owner-look | commit f94d4af8 EQ-12 + D-068: quick bar 1-4 (assign by hover + dig; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| MAP-02 | pc-b-queue.md:273 | PO OK - owner look pending (2026-10-11; geoMap.test 13 ok; gpucompare + in-game look by main se | owner-look | commit f4f36a46 MAP-02/03/05: geography on (installGeo: ridges + pe; verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| MAP-23 | pc-b-queue.md:290 | PO OK - owner look pending (2026-10-11; rebuilt as stone house OB-024; route-walk R1 climb: lan | owner-look | commit 7a68a138 MAP-23 + MAP-25: Rook's nest ruin (arch walls, rubb |
| MAP-28 | pc-b-queue.md:295 | PO OK - owner look pending (2026-10-11; mapWorld.test PASS, wired in main.js) | owner-look | commit b4d578ea MAP-28 wiring: chart gets the world_geo data (off w; verdict test-reports\po-batch-2026-10-12-pcb.md:13 - M4-C3 (MAP-28 labels, MAP |
| QL-06 | pc-b-queue.md:316 | PO OK - owner look pending (2026-10-11; deviation accepted: one Rook on the nest roof only, no  | owner-look | commit 38d068d2 QL-06: Rook the talking crow (crow model 1.6x at th; verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| QL-07 | pc-b-queue.md:317 | PO OK - owner look pending (2026-10-11; SOS pulse x3, knot, chart.river; rookQuests.test) | owner-look | commit 50e94e38 QL-07 + QL-16 (M4): Bend relay SOS blink after wake; verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |

## UNSURE

| ID | file:line | current status | suggested | evidence |
|---|---|---|---|---|
| HANDS-01a | backlog.md:156 | **ARCH OK 2026-10-07 -> po-review (engine-internal: skip PO per lean rule, main session closes) | no tester PASS line found; check tester report | commit 4b82cb78 docs: HANDS-01a/b ARCH OK, HANDS-01c answered (D-03 |
| SPELL-01b | backlog.md:160 | **owner look [PC-B, 2026-10-07]**. `fireballView.js` per designer spellFx: core sprite (charged |  | commit f4d9d625 SPELL-01b: fireball look (core sprite, trail per ba |
| US-091b | backlog.md:161 | **po-review + owner look [PC-B, 2026-10-07]**. `inventoryView.js` per designer `uiStyle.invento |  | commit 77ed46b0 US-091b: inventory screen (I pauses; hands strip, 6 |
| US-067 | backlog.md:253 | po-review [PC-B] (2026-09-27): `tools/editor/thumbnails.js`+`visibility.js` (new) + `main.js`/` |  | - |
| US-072 | backlog.md:266 | todo (sketch) [PC-A] - after US-070; architect estimate |  | - |
| US-076 | backlog.md:269 | AI chat panel in the editor: chat drives the open editor live through the same commands as the  |  | - |
| US-077 | backlog.md:270 | todo (sketch) [PC-A architect notes, PC-B tool] - pairs with the glTF importer |  | - |
| US-120 | backlog.md:272 | todo (sketch) [PC-A architect notes + PC-B runtime/editor] - after mesh phase 2; game menus US- |  | - |
| ME-06c | backlog.md:281 | … +scatterInstances.test.js, game/index.html, main.js, dev/modes/gpucompare.js. No threshold/sh |  | - |
| ME-14 | backlog.md:284 | todo [PC-B] `engine/content/*`, `engine/world/World.js`, `tools/validate-content.mjs` - deps: M |  | - |
| RE-15d | backlog.md:291 | todo [PC-A, ~0.1 d] - after BUG-RTS-002 |  | - |
| ME-19c | backlog.md:296 | todo [PC-A ~1 d] -> `arch-review`; after 19b + ME-15e |  | - |
| ME-19e | backlog.md:298 | todo [PC-A ~0.5 d] after ME-16 |  | - |
| ME-20 | backlog.md:300 | PC-B 2026-10-09: ME-20c a/b/c done -> arch-review. Was: todo [PC-B JS + PC-A GLSL 0.5 d] - deps |  | - |
| ME-22 | backlog.md:302 | **Large voxel models (mesh-only)** (owner 2026-09-30: "can I import bigger vox files?") - expli |  | commit 66647c1b ME-22: large voxel models (mesh-only) -> arch-revie |
| WG-1a | backlog.md:312 | **ARCH OK 2026-10-07 -> po-review (engine-internal: PO may skip)** [PC-B cross-track -> arch-re | no tester PASS line found; check tester report | commit 32622897 WG-1a: WebGPU probe + capture flags (Arc xe-lpg: 12 |
| WG-1b1 | backlog.md:313 | **ARCH OK 2026-10-07 -> po-review (engine-internal: PO may skip)**; ring variable-size alloc ca | no tester PASS line found; check tester report | commit 8db5347a WG-1b1: GpuDevice shape additions (38.3), uniformBl |
| WG-2b | backlog.md:318 | **ARCH OK 2026-10-07 (opus batch) -> po-review; decisions (a) extra vertex streams, (b) shipped | no tester PASS line found; check tester report | commit f024b079 WG-2b: WebGPU mesh raster (static, kind-9, instance; verdict test-reports\batch-review-2026-10-08.md:9 / WG-2b, WG-2c, WG-3b, WG-3c |
| WG-2c | backlog.md:319 | **ARCH CHANGES 2026-10-07 (small, B1; 38.8a item 24): terrain raster itself OK, WG-3 wiring may |  | commit 7628f173 WG-2c: WebGPU terrain raster (geomOk 69/72 = WebGL2; verdict test-reports\batch-review-2026-10-08.md:9 / WG-2b, WG-2c, WG-3b, WG-3c |
| WG-3a | backlog.md:320 | **modules ARCH OK 2026-10-07 (178e911, B2: resolve/deriv WGSL + probes); B1 plug-in 6bcff74 ARC | no tester PASS line found; check tester report | commit 6bcff743 WG-3a: WebGPU resolve + deriv passes (WgCellPass),  |
| WG-3b | backlog.md:321 | **module ARCH OK 2026-10-07 (178e911, light WGSL + 15200 probes); open: B1 plug-in + light-row  | no tester PASS line found; check tester report | commit b6347284 WG-3b fix: WebGPU raster consumes the MESH-INST-01/; verdict test-reports\batch-review-2026-10-08.md:9 / WG-2b, WG-2c, WG-3b, WG-3c |
| WG-4a | backlog.md:326 | **ARCH CHANGES 2026-10-08 (batch-review-2026-10-08.md) fixed (B1): run() writes a cached _argsV |  | commit 773d964f WG-4a ARCH CHANGES: WgCullPass caches the args view; verdict test-reports\batch-review-2026-10-08.md:14 / WG-4a part 1 / ARCH CHANG |
| WG-4c | backlog.md:328 | todo [PC-A + owner; who picks up: PC-A runs it with the owner walk, PC-B does not] - deps: WG-4 |  | verdict test-reports\batch-review-2026-10-09-pcb.md:166 6. **WG-5b/5c (k4 b988 |
| MESH-INST-01 | backlog.md:337 | **ARCH OK 2026-10-07 (f3f0a19, 38.8a item 25c; follow-up probe forestEdge kind-9) -> done (engi | no tester PASS line found; check tester report | commit f3f0a19b MESH-INST-01: CPU-side instance batching of unit-sc |
| BUG-GONDOLA-FALL-b | backlog.md:338 | Fix ARCH CHANGES: test must run <= 5 s with the `--full` flag; fix wording |  | commit 99ed4e0f BUG-GONDOLA-FALL-b: gondola test 50 s -> 1.3 s (ful |
| HANDS-01c-b | backlog.md:339 | Files: `engine/render/gpu/gpuCompare*`, baseline list/D-039 note. No GLSL fix needed (architect |  | - |
| WG-1b3 | backlog.md:340 | **ARCH OK 2026-10-07 (opus batch; nesting rule for WG-2b/3 in 38.8a item 22) -> po-review** [PC | no tester PASS line found; check tester report | commit da34e692 WG-1b3: add asynchronous WebGPU timestamp ring and  |
| TEST-GAPS-WG | backlog.md:341 | **ARCH OK 2026-10-07 (opus batch: flip/mirror/index-shift now fail the gate, exit 1) -> po-revi | no tester PASS line found; check tester report | commit 7fbb4969 TEST-GAPS-WG: verify renderer fallback, grid invali |
| EDITOR-LOAD-01 | backlog.md:343 | **ARCH OK 2026-10-07 (opus batch; grid/backend lines unchanged: 240x90 default, gl2 gate kept)* | no tester PASS line found; check tester report | commit cc2aaa61 EDITOR-LOAD-01: show startup stages and catch initi |
| PREC-04b2 | backlog.md:348 | **ARCH OK 2026-10-07 (opus batch) -> po-review (harness only, PO may skip).** PC-A Intel gate f | no tester PASS line found; check tester report | commit 5fe40f20 PREC-04b2: classify oracle texel ties and apply the |
| WG-2a-b | backlog.md:349 | **ARCH OK 2026-10-07 (opus batch) -> done (folded into WG-2a)** [PC-B cross-track -> PC-A] |  | - |
| LICENCE-AUDIT-01 | backlog.md:351 | **follow-up 4736b9a ARCH OK 2026-10-08 (facts only; ESCALATE TO MANAGER: Ruins candidate forbid | no tester PASS line found; check tester report | commit bda8e165 LICENCE-AUDIT-01: inventory third-party assets and  |
| OWNER-WALK-FIXES | backlog.md:357 | todo, trigger = owner reports [PC-B] |  | - |
| GFX-01 | backlog.md:358 | Files: `content/settings/gfx-presets.json`, `game/js/ui/gfxPresets.js` (+test), `game/js/ui/set |  | - |
| GFX-01w | backlog.md:359 | **ARCH CHANGES (batch 5) done: sun-off captures webgl2 + webgpu in GFX-01w.md (sunlit, no valid |  | commit 767355cc GFX-01w ARCH CHANGES: sun-off captures per backend ; verdict test-reports\batch-review-2026-10-08.md:15 / GFX-01a / ARCH OK -> po-r |
| GFX-02 | backlog.md:360 | **ARCH CHANGES (verdicts 6/13) done (B1 main session): tierFromAdapter Intel ids 0x0*7d |  | commit ccbce775 GFX-02 ARCH CHANGES: Intel Arc iGPU ids match zero-; verdict test-reports\batch-review-2026-10-08.md:99 / GFX-02 (cb0bca2) / ARCH C |
| HAND-ART-01 | backlog.md:382 | **design done, owner look [PC-A designer 2026-10-08, uncommitted]** |  | - |
| HAND-BURN-01 | backlog.md:383 | todo after the owner look - split: **01a [B1 -> arch-review, ~0.5 d] NEEDS PC-A architect note* |  | - |
| ED-SCALE-1 | backlog.md:408 | **Per-object scale in the editor** (owner 2026-10-01: "I can't resize objects"; owner picked pe |  | commit a2e55ff7 docs: ED-SCALE-1 architect note (architecture.md 34 |
| CLOTH-1 | backlog.md:409 | **Cloth physics - "nice clothes"** (owner 2026-10-01: "physics of clothes ... I want nice cloth |  | commit 7db30639 docs: CLOTH-1 PO ACs + architect note (architecture |
| OWN-REQ-012 | backlog.md:410 | **RTS design direction from player complaints** (owner, 2026-09-30): single-player campaigns, d |  | - |
| RE-02 | backlog.md:412 | **Pitched camera = the general mesh camera** (D-029 Amendment 2, 2026-09-30: widened from "RTS  |  | - |
| RE-07c | backlog.md:414 | todo |  | - |
| RE-08q | backlog.md:415 | (no status cell) [PC-B] `engine/nav/flowField.js` - targets: full 256x256 build <= 3 ms, step(1 |  | - |
| RE-15 | backlog.md:417 | RE-15a [PC-B, cross-track -> arch-review] cull + compaction + frameNo memo + F3 stats (engine/m |  | - |
| PX-01 | backlog.md:427 | todo (sketch) |  | - |
| US-038 | backlog.md:442 | todo - sprint 3 (D-026); split 2026-09-25: US-038a live `engine.setGrid` [PC-A, architect notes |  | - |
| US-042 | backlog.md:443 | todo (sketch) |  | - |
| US-053d | backlog.md:469 | todo (sketch) [PC-B content + designer ramps] - deps: US-053c. ~0.5 d |  | - |
| US-055b | backlog.md:472 | todo (sketch) [PC-B game + PC-A `waterAt` query if 055a lacks it] - deps: US-055a, US-053c. ~1  |  | - |
| US-141a | backlog.md:473 | Flow data + scrolling surface (PO 2026-10-02, owner "water, waterfalls, waves"): water regions  |  | commit 06c7b4a5 docs: US-141a ARCH OK -> done, headless gpucompare  |
| US-142a2 | backlog.md:479 | … as large flat rectangles - tune later. **ARCH OK engine part (opus 2026-10-04, 82ebe56).** bi | no tester PASS line found; check tester report | commit 82ebe567 US-142a2: add waterfall front/back views and pool e |
| US-143b1 | backlog.md:483 | todo [PC-A engine/render] - 1 d - deps: US-143a, US-055a2b. ACs: parent row + architecture.md 3 |  | - |
| US-043 | backlog.md:502 | todo (sketch) |  | - |
| US-035 | backlog.md:507 | todo (sketch) |  | - |
| US-079 | backlog.md:521 | todo (sketch, ACs below) [PC-A engine AI/entity hooks; PC-B brain + content] - needs architect  |  | - |
| US-080a1 | backlog.md:523 | **ARCH OK re-review 2026-10-07 (opus batch; 305e615) -> PO re-check.** … No main.js wiring in t | no tester PASS line found; check tester report | commit b5778b7f US-080a1: vitals sim (HP, combat:hit listener, fall |
| US-080a2 | backlog.md:524 | **ARCH OK re-review 2026-10-07 (opus batch; 305e615 + 7d8d2ad). Nit, non-blocking: `computeDeat | no tester PASS line found; check tester report | commit 10764cff US-080a2: vitals view (HP HUD, hurt edge/kick, deat |
| US-080b | backlog.md:525 | **ARCH OK re-review 2026-10-07 (opus batch; a207938 chip fix, loot.js `spawnDrop` flow green, c | no tester PASS line found; check tester report | commit 1cf6bada US-080b: mana + HP/MP pickups (architecture.md 30.2 |
| US-082 | backlog.md:527 | PC-B 2026-10-09: slice HITSTOP-01 done (pure, not wired). Was: todo (sketch) [PC-B game + PC-A  |  | - |
| US-085 | backlog.md:530 | PC-B 2026-10-09: slice AI-PERCEIVE-01 done (pure, not wired). Was: todo (sketch) [PC-A] - gener |  | - |
| US-112 | backlog.md:556 | PC-B 2026-10-09: PC-B tooling parts PERF-GATE, COMBAT-CAPTURE done. Was: todo (sketch) [PC-B] - |  | - |
| US-128 | backlog.md:564 | … story note). AC 7 (owner feel check) and the mesh-renderer walk still open. **US-128b PO OK ( |  | - |
| US-079 | backlog.md:586 | todo (sketch) |  | - |
| US-128 | backlog.md:636 | po-review |  | - |
| US-038 | backlog.md:699 | todo |  | - |
| US-042 | backlog.md:717 | todo (sketch) |  | - |
| US-046 | backlog.md:732 | todo |  | - |
| US-031 | backlog.md:755 | testing |  | commit a80cec96 US-031 follow-up: add check-deps rule 6 (editor mus |
| US-032 | backlog.md:776 | testing |  | commit 8c62368d US-032: pick/select/move/delete (tools/editor/*) |
| US-033 | backlog.md:795 | testing |  | commit a3f28dbc US-033: place props/lights/triggers + property pane |
| US-034 | backlog.md:807 | testing |  | commit 062b6a79 US-034: World JSON save/load + play-test (tools/edi |
| US-035 | backlog.md:839 | todo (sketch) |  | - |
| US-051 | backlog.md:914 | todo (sketch) |  | - |
| US-055b | backlog.md:1006 | todo (sketch) |  | - |
| US-043 | backlog.md:1195 | todo (sketch) |  | - |
| US-063 | backlog.md:1213 | po-review |  | commit 2750c934 US-063: editor v0.1 polish - model picker, real per |
| US-064 | backlog.md:1227 | po-review |  | commit 4eadd934 US-064: editor edit speed - patch live instead of f |
| US-067 | backlog.md:1239 | po-review |  | - |
| ALPHA-01f | backlog.md:1459 | todo [PC-A] ~0.25 d - deps: e; owner walk-test "stylized forest" |  | commit d4af9004 ALPHA-01f-fix3 (folded into merge 65886ddc): instan; verdict test-reports\batch-review-2026-10-09-pcb.md:10 4. **ALPHA-01f-fix + sh |
| MESH-LOD1-ACCEPT-01 | backlog.md:1460 | todo [PC-A] ~0.25 d - from Batch 8 (ALPHA-01f-fix3) |  | - |
| US-089w | backlog.md:1461 | po-review [lane B1] |  | verdict test-reports\batch-review-2026-10-08.md:35 / US-089a save data (sim) / |
| US-096w | backlog.md:1462 | po-review [lane B1] |  | verdict test-reports\batch-review-2026-10-08.md:34 / US-096a quest flags + obj |
| DIALOGUE-01a | backlog.md:1470 | todo [PC-B, ~0.75 d] - **ARCH-NOTE NEEDED** (engine/ui vs game split, content kind) |  | - |
| DIALOGUE-01a | backlog.md:1496 | todo - ARCH-NOTE NEEDED |  | - |
| CHARGEN-06 | backlog.md:1547 | arch-review [PC-B B1, 0.25 d] |  | - |
| CHARGEN-07 | backlog.md:1548 | arch-review [PC-B B1, 0.5 d] (done with skin + baked clips = 08/09 scope in the writer) |  | - |
| CHARGEN-13 | backlog.md:1555 | po-review (owner look) [PC-B B1, 0.75 d] |  | commit 9593c3d3 CHARGEN-13 fix: empty favicon link (404 counted as  |
| CHARGEN-13b | backlog.md:1556 | po-review [PC-B B2] |  | commit c15cae18 CHARGEN-13b: .obj + .vox wired into the chargen fac |
| RIG-02 | backlog.md:1562 | todo [B2 or PC-A] - RIG-02a DONE -> arch-review (kestrel-3, 2026-10-10; see docs/lanes/pc-b2.md |  | - |
| CHARGEN-15 | backlog.md:1564 | removed (owner 2026-10-10, D-058: Fen out of the world; add-on package system 38.33 kept, conte |  | commit 3bb57694 CHARGEN-15 tests: content-smoke resolves add-on cha |
| CHARGEN-16 | backlog.md:1565 | po-review (owner walk) [PC-B B1] |  | commit 34b957bc CHARGEN-16: player.look (CharRecipe) in the save +  |
| CHARGEN-17 | backlog.md:1566 | parked (owner 2026-10-10: no character creation at the start; screen unwired from New game, cod |  | commit 95617c9b CHARGEN-17 parked (owner: no character creation at  |
| CHARGEN-22d | backlog.md:1571 | po-review [PC-B, 0.5 d; app rows done in ui.js, Save clamp + creation screen not in scope] - de |  | commit 8c37107a CHARGEN-22d: chargen app rows Body detail / Head de |
| CHARGEN-22e | backlog.md:1572 | mesh.test alloc warm-up (default stays 1/1, owner) |  | commit 12cae3cb CHARGEN-22e: chargen mesh.test sampleClip alloc mea |
| CHARGEN-24 | backlog.md:1575 | todo [PC-B designer] - deps 22b |  | - |
| CHARGEN-21 | backlog.md:1580 | po-review [PC-B kestrel-4] |  | - |
| KPKG-04 | backlog.md:1585 | po-review [PC-B B1] (ARCH OK after KPKG-01..03 fixes) (boots from dist/kestrel.base-1.0.0.kestr | no tester PASS line found; check tester report | commit d210df0c KPKG-04 (38.30): game boots from .kestrel packages ; verdict test-reports\batch-review-2026-10-09-pcb.md:272 4. **KPKG-04 packBoot  |
| CHARGEN-06 | backlog.md:1646 | (no status tag) |  | - |
| WILD-02 | backlog.md:1768 | arch-review [PC-B B2, 0.5 d] |  | - |
| WILD-06b | backlog.md:1775 | po-review [PC-B B1] |  | commit e1030df8 WILD-06b fix: __debug.wild getter in scope of let w |
| WILD-D2 | backlog.md:1779 | todo [PC-B designer, 0.75 d] - after the owner OK |  | commit 4c7364ab WILD-D2 (designer): fox, squirrel, songbird (robin  |
| PLANT-SCALE-01 | backlog.md:1782 | po-review [PC-B main, owner look] (gpucompare + route walk PASS) |  | commit e2c32950 PLANT-SCALE-01: real-world plant sizes (owner: boar |
| PLANT-VOXEL-OFF-01 | backlog.md:1783 | po-review [PC-B main, owner look] (gpucompare + route walk PASS) |  | commit 6c574eb2 PLANT-VOXEL-OFF-01 (owner: remove voxel plants; yel |
| WAYSTONE-NORMAL-01 | backlog.md:1784 | po-review [PC-B B1, owner look] |  | commit 5407716c WAYSTONE-NORMAL-01 (owner, D-056): the waystone no  |
| WILD-02 | backlog.md:1798 | (no status tag) |  | - |
| QG-02 | backlog.md:1880 | arch-review |  | - |
| COMPASS-01 | backlog.md:1884 | po-review [PC-B] |  | commit 57aaa70b COMPASS-01 (D-061): game/js/ui/compassHud.js pure H |
| COMPASS-02 | backlog.md:1885 | po-review [PC-B B1, owner look] |  | commit b332b38e COMPASS-02 (D-061): golden pocket compass in the ga |
| QG-02 | backlog.md:1895 | (no status tag) |  | - |
| WS1-01 | backlog.md:1933 | ARCH OK -> po-review [PC-B] | no tester PASS line found; check tester report | commit dc02cf33 WS1-01 (D-060): engine/physics/bounds.js projectBou |
| WS1-02 | backlog.md:1934 | ARCH CHANGES (build loop uses near.w for rows: tall bands get zero normals; see arch batch 2026 |  | commit a6c50587 WS1-02 ARCH CHANGES fix: TerrainMeshSet.step builds |
| WS1-03 | backlog.md:1935 | ARCH OK -> po-review (gpucompare gate: main session) [PC-B] | no tester PASS line found; check tester report | commit ab0d9546 WS1-03 (D-060): terrainRaster.wgsl terrainTypeAt re |
| WS1-06a | backlog.md:1938 | po-review [PC-B] |  | commit 317ffefb WS1-06a (D-060/D-057): waystone sim for many points |
| WS1-07a | backlog.md:1940 | po-review [PC-B] |  | commit 95edfc03 WS1-07a (D-057/D-060): map card travel UI - digit m |
| WS1-07b | backlog.md:1941 | po-review [PC-B] |  | commit a054dfba WS1-07b (D-057/D-060): map travel - game/js/quest/t |
| WS1-08 | backlog.md:1942 | ARCH OK; tooling done + gates PASS (route walk leg 8 1.8 m from relay, bound 1200.3, gpucompare | no tester PASS line found; check tester report | commit 42dfafcc docs: WS1-08 gates PASS (perf open), CH1-D2 po-revi |
| WS1-09 | backlog.md:1943 | won't-do: superseded by CH1-01 (38.37) [PC-B] |  | - |
| WS1-09 | backlog.md:2002 | (no status tag) |  | - |
| CH1-04b | backlog.md:2020 | todo [PC-B] |  | - |
| CH1-E1 | backlog.md:2023 | ARCH OK -> po-review [PC-B] (engine) | no tester PASS line found; check tester report | commit 105de570 CH1-E1 + CH1-E2 (D-062): engine/nav/pathFollow.js c |
| CH1-E2 | backlog.md:2024 | ARCH OK -> po-review [PC-B] (engine) |  | - |
| CH1-08b | backlog.md:2027 | main.js (Fen hidden until the relay wakes, emerge walk, auto-open, `fen.met`), uses `npcWalk.js |  | - |
| CH1-W1 | backlog.md:2035 | todo NEEDS WRITER |  | - |
| CH1-W5 | backlog.md:2039 | todo NEEDS WRITER |  | - |
| CH1-04b | backlog.md:2061 | (no status tag) |  | - |
| CH1-E2 | backlog.md:2081 | (no status tag) |  | - |
| CH1-08b | backlog.md:2097 | (no status tag) |  | - |
| CH1-W1 | backlog.md:2128 | (no status tag) |  | - |
| CH1-W5 | backlog.md:2140 | (no status tag) |  | - |
| OQ-WS2-1 | pc-b-queue.md:200 | OWNER QUESTION |  | - |
| EQ-09 | pc-b-queue.md:255 | PO OK - owner look pending (2026-10-11; 4 deg FOV-in at full draw not built, minor) |  | verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| EQ-13 | pc-b-queue.md:259 | PO OK (2026-10-11) |  | - |
| MAP-00 | pc-b-queue.md:267 | IN PROGRESS. AC0 enclosed world (owner 2026-10-11): river + mountains on two sides, sea on one  |  | verdict test-reports\po-batch-m4-2026-10-11.md:6 - PO OK: 29 (WS2-07, DN-04a,  |
| MAP-03 | pc-b-queue.md:274 | PO OK - owner look pending (2026-10-11; meadow skyline peaks) |  | verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| MAP-05 | pc-b-queue.md:276 | PO OK - owner look pending (2026-10-11; lake/marsh look) |  | verdict test-reports\po-batch-2026-10-12-pcb.md:7 Already PO OK pending owner  |
| MAP-07 | pc-b-queue.md:279 | PO REJECT (2026-10-11): docs/test-reports/MAP-geo.md does not exist; run route-walk (all legs), |  | verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| MAP-14 | pc-b-queue.md:286 | po-review (2026-10-11 kestrel-3): route-walk leg 10 (calls verify-grid-walk: 8 swaps, band:late |  | verdict test-reports\po-batch-2026-10-12-pcb.md:13 - M4-C3 (MAP-28 labels, MAP |
| MAP-25 | pc-b-queue.md:292 | PO OK - owner look pending (2026-10-11; smoke plumes OB-020, caps on trunks OB-023) |  | - |
| MAP-27 | pc-b-queue.md:294 | PO OK (2026-10-11; names used by MAP-28 labels) |  | - |
| QL-03 | pc-b-queue.md:313 | PO OK - owner look pending (2026-10-11; J log tabs MAIN/SIDE, T track, X abandon; verify-quest- |  | verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| QL-08 | pc-b-queue.md:318 | PO OK (2026-10-11; heartPieces.test; m4Exit round-trip) |  | - |
| QL-10 | pc-b-queue.md:320 | po-review (M4 build 2026-10-11, kestrel-4): quest in ch12 pack.json, anchors via gen-poi-props. |  | verdict test-reports\po-batch-2026-10-12-pcb.md:11 - QL-09 (wreck.plate), QL-1 |
| QL-11 | pc-b-queue.md:321 | po-review (M4 build 2026-10-11, kestrel-4): quest in ch12 pack.json, anchors via gen-poi-props. |  | verdict test-reports\po-batch-2026-10-12-pcb.md:11 - QL-09 (wreck.plate), QL-1 |
| QL-12 | pc-b-queue.md:322 | po-review (M4 build 2026-10-11, kestrel-4): quest in ch12 pack.json, anchors via gen-poi-props. |  | verdict test-reports\po-batch-2026-10-12-pcb.md:11 - QL-09 (wreck.plate), QL-1 |
| QL-13 | pc-b-queue.md:323 | PO OK (2026-10-11; sq.straw + target1..3.hit hook; errands.test) |  | - |
| QL-17 | pc-b-queue.md:327 | po-review (2026-10-11, kestrel-5): content/quests/mq.smoke.quest.json (mark flag lore.fordMark. |  | verdict test-reports\po-batch-2026-10-12-pcb.md:14 - EQ-03, EQ-12, QL-01, QL-0 |
| M4-C3 | pc-b-queue.md:350 | po-review (2026-10-11 kestrel-3): MAP-28 half OK (mapWorld.test wired, chart labels + chart-pie |  | verdict test-reports\po-batch-2026-10-12-pcb.md:13 - M4-C3 (MAP-28 labels, MAP |

## STILL OPEN
No landed commit and no verdict/tester line. Listed with status only.

| ID | file:line | current status |
|---|---|---|
| US-091a | backlog.md:153 | todo - after US-079b; NEEDS PC-A: designer `design/items.js` + loot sprites |
| HANDS-01 | backlog.md:155 | todo - after TORCH-01a + BUG-VM-001 left-hand; NEEDS PC-A: architecture.md 37.8 "hands" amendme |
| US-049 | backlog.md:241 | todo |
| CO-4 | backlog.md:258 | (no status cell) deferred (D-028: with the first rotated/second structure; throw stays) [PC-A] |
| US-071 | backlog.md:265 | todo (sketch) [PC-A] - after US-070; architect estimate |
| US-121 | backlog.md:274 | todo (sketch) [PC-A architect + designer] - after ME-06/ME-15 settle `shade.frag`/`light.frag`; |
| US-122 | backlog.md:275 | todo (sketch) [PC-A engine + designer colour curves] - US-119 trailer tool uses `time` per keyf |
| US-123 | backlog.md:276 | todo (sketch) [PC-A engine] ~1.5 d - after ME-16; pairs with the torch tool (roadmap owner answ |
| US-124 | backlog.md:277 | todo (sketch) [PC-A engine] ~2-3 d - after US-123 |
| US-125 | backlog.md:278 | todo (sketch) [PC-A engine] ~2 d - best together with US-072 |
| US-126 | backlog.md:279 | todo (sketch) [PC-A architect + engine] ~4-5 d |
| US-127 | backlog.md:280 | todo (sketch) [PC-A engine + designer glyph ramp] ~3 d - after ME-15 (+US-123 for spots) |
| ME-18 | backlog.md:294 | todo [PC-B] `tools/editor/*`, `pick.js` - deps: ME-14, US-067 |
| ME-19d | backlog.md:297 | todo [PC-A ~1 d] -> `arch-review`; after 19c |
| ME-19f | backlog.md:299 | todo [PC-B + main session ~0.5 d] after 19d |
| ME-21 | backlog.md:301 | Mesh phase 3: proof content - 2-storey glTF building on the hillside with door + stairs; walk i |
| ME-30 | backlog.md:303 | todo (sketch, phase 4 WebGPU) [PC-A] - deps: ME-19 + a recorded trigger (D-029 item 6) |
| ME-31 | backlog.md:304 | todo (sketch, phase 4 WebGPU) [PC-A] - deps: ME-30 |
| ME-32 | backlog.md:305 | todo (sketch, phase 4 WebGPU) [PC-B] - deps: ME-30 |
| ME-33 | backlog.md:306 | todo (sketch, phase 4 WebGPU) [PC-A] - deps: ME-31, ME-32 |
| QUAT-GROUND-01 | backlog.md:335 | Files: `design/levels/overworld_far.js` (scatter tables), scatter feed. Done when: density by g |
| OWNER-LOOK-ROADSOUTH | backlog.md:347 | todo [PC-A + owner] - deps: MESH-FULL-01 |
| ALPHA-01b-note | backlog.md:350 | (no status cell) - |
| US-092a | backlog.md:368 | todo [lane C, sprint 7] ~1 d - designer (chest model + 0.6 s open clip + card style) + writer ( |
| US-112b | backlog.md:371 | todo [PC-A writer, sprint 7] ~0.25 d |
| M4-WIRE-01 | backlog.md:372 | todo [lane B1, sprint 8] - deps: US-089a/090a/092a/096a |
| MAP-01d | backlog.md:376 | todo [lane C, sprint 8] ~1 d - deps: 01c + US-089a (builds on US-130 RE-11 Visibility or a coar |
| MAP-01e | backlog.md:377 | todo - OWNER QUESTION, not scheduled |
| US-070b | backlog.md:385 | todo |
| BUG-MESH-TIE-001 | backlog.md:401 | Original yaw-30 / pitch-20 scene crease face-4/3 tie, reproduced with sword hidden; non-K8 outs |
| RE-12 | backlog.md:416 | todo (sketch) |
| RE-16 | backlog.md:418 | todo (sketch) |
| PX-02 | backlog.md:428 | todo (sketch) |
| PX-03 | backlog.md:429 | todo (sketch) |
| PX-04 | backlog.md:430 | todo (sketch) |
| PX-05b | backlog.md:432 | todo (sketch) |
| PX-06 | backlog.md:433 | todo (sketch) |
| PX-07 | backlog.md:434 | todo (sketch) |
| PX-08 | backlog.md:435 | **Pixel-mode budget + owner look page** - bench poses at 1920x1080, renderScale 1.0/0.75/0.5, o |
| US-026 | backlog.md:440 | todo (sketch) - split D-026: **US-026a** bounded walk-out (near LOD band, slope walk/slide, end |
| US-041b | backlog.md:448 | todo (sketch) – after US-041a |
| US-141b | backlog.md:474 | (no status cell) architect note (architecture.md 35.7) -> split 141b1 [PC-A `engine/fx` particl |
| US-141b1 | backlog.md:475 | todo [PC-A engine/fx] - 0.25 d - deps: US-141a. ACs: parent row + architecture.md 35.7, 35.11 s |
| US-141b2 | backlog.md:476 | todo [PC-B game/js/quest + level] - 0.5 d - deps: US-141b1, US-138b, US-055b. ACs: parent row + |
| US-142a | backlog.md:477 | architect note (architecture.md 35.5: needs the engine hook) -> split 142a1 [PC-A engine sheet  |
| US-142b | backlog.md:480 | todo (sketch, sound deferred to M6 polish per owner 2026-09-25) [PC-B `game/js/audio`, `game/js |
| US-143b | backlog.md:482 | architect note (architecture.md 35.3; owner decision 2026-10-02: displaced water mesh) -> split |
| US-143b2 | backlog.md:484 | todo [PC-A engine/render + designer ramps] - 0.75 d - deps: US-143b1. ACs: parent row + archite |
| US-143c | backlog.md:485 | (no status cell) architect note (architecture.md 35.7, 35.11 step 10) -> game only [PC-B game/l |
| US-144a | backlog.md:486 | architect note (architecture.md 35.6) -> split 144a1 [PC-A shade + designer, 1 d] + 144a2 [PC-A |
| US-144a1 | backlog.md:487 | todo [PC-A engine/render + designer] - 1 d - deps: US-055a2b, US-143a. ACs: parent row + archit |
| US-144a2 | backlog.md:488 | todo [PC-A engine/render + fx] - 0.5 d - deps: US-144a1. ACs: parent row + architecture.md 35.6 |
| US-144b | backlog.md:489 | todo (sketch, audio part deferred to M6) [PC-B game + audio] - deps: US-144a, US-080a1, US-053c |
| US-132 | backlog.md:490 | todo (sketch) [PC-A engine status-effect component + PC-B game tuning] - deps: US-053c, US-080a |
| US-134 | backlog.md:492 | todo (sketch) [PC-A engine/render + designer fire/char ramps] - deps: US-133, US-053c. ~1 d |
| US-135 | backlog.md:493 | todo (sketch) [PC-B content + game/js/quest] - deps: US-132, US-134; feeds US-093 (torch gates) |
| US-137 | backlog.md:495 | todo (sketch) [PC-B content + game + designer] - deps: US-136, US-053c, US-133. ~1 d |
| US-139 | backlog.md:496 | todo (sketch) [PC-A engine/render light/shade pass + designer] - deps: US-138; pairs with US-12 |
| US-140 | backlog.md:497 | todo (sketch) [PC-B content/game + PC-A hooks if needed] - deps: US-053c, US-138, US-139, US-13 |
| US-036 | backlog.md:508 | todo (sketch) |
| US-037 | backlog.md:509 | todo (sketch) |
| US-080 | backlog.md:522 | todo (sketch, ACs below) [PC-B HUD/quest; PC-A `health` component + damage events] - needs arch |
| US-081 | backlog.md:526 | todo (sketch) [PC-A camera + PC-B game] - after US-079. **2026-09-30: built as US-128** (Z-targ |
| US-083 | backlog.md:528 | PC-B 2026-10-09: slices ANIM-STATE-01a/b done (pure, not wired). Was: todo (sketch) [PC-A] - ex |
| US-084 | backlog.md:529 | todo (sketch) [PC-A] - after ME-11 (mesh colliders); Rust/WASM only if benched hot (D-015). **2 |
| US-086 | backlog.md:531 | todo (sketch) [PC-B] - owner question 1 (roadmap) |
| US-089 | backlog.md:533 | todo (sketch) [PC-B game + PC-A engine save API] - after CO-5, US-080 |
| US-090 | backlog.md:534 | todo (sketch) [PC-B] - after US-089; designer title/menu style |
| US-091 | backlog.md:535 | todo (sketch) [PC-B] - designer `uiStyle.inventory` + item icons |
| US-092 | backlog.md:536 | todo (sketch) [PC-B content + designer] - after US-091 |
| US-093 | backlog.md:537 | todo (sketch) [PC-A engine if it needs physics/rope, PC-B game] - needs architect notes |
| US-094 | backlog.md:538 | todo (sketch) [PC-A designer level + PC-B behaviours] - after ME-21 (mesh buildings), US-091 |
| US-095 | backlog.md:539 | todo (sketch) [PC-B] - after US-080a/b |
| US-096 | backlog.md:540 | todo (sketch) [PC-A engine + PC-B UI] - extends today's quest flags; pairs with US-042 |
| US-097 | backlog.md:541 | todo (sketch) [PC-B] |
| US-098 | backlog.md:542 | todo (sketch) [PC-A] - after ME-15 shadow maps |
| US-099 | backlog.md:543 | todo (sketch) [PC-B content + designer + writer] - after US-042, US-084, US-085 |
| US-100 | backlog.md:544 | todo (sketch) [PC-A designer + PC-B content] - after US-026b; owner question 6 |
| US-101 | backlog.md:545 | todo (sketch) [PC-B game + PC-A particles/light] |
| US-102 | backlog.md:546 | todo (sketch) [PC-B brain + designer] - after US-085 |
| US-103 | backlog.md:547 | todo (sketch) [PC-A projectile physics + PC-B game] - unless it is the M4 tool |
| US-104 | backlog.md:548 | todo (sketch) [PC-B content] |
| US-105 | backlog.md:549 | todo (sketch) [PC-A designer + writer] |
| US-106 | backlog.md:550 | todo (sketch) [PC-B + designer + writer] |
| US-107 | backlog.md:551 | todo (sketch) [PC-A input + PC-B UI] - after US-087; US-043 needs it |
| US-108 | backlog.md:552 | todo (sketch) [PC-B] - after US-087 |
| US-109 | backlog.md:553 | todo (sketch) [PC-B] - owner deferred sound to M6 |
| US-110 | backlog.md:554 | todo (sketch) [PC-B + designer palettes] |
| US-111 | backlog.md:555 | todo (sketch) [PC-A] |
| US-113 | backlog.md:557 | todo (sketch) [PC-B tool + PC-A architect text] |
| US-114 | backlog.md:558 | todo (sketch) [PC-B] - after ME-19 |
| US-115 | backlog.md:559 | todo (sketch) [PC-A architect] - after US-047, ME-00 |
| US-116 | backlog.md:560 | todo (sketch) [owner decision + PC-B] - owner question 10 |
| US-117 | backlog.md:561 | todo (sketch) [PC-B] - after US-113..116 |
| US-118 | backlog.md:562 | todo (sketch) [PC-B + writer] |
| US-129 | backlog.md:566 | todo (sketch) [PC-B content + designer tier materials] - after US-079. AC sketch: 3 tiers can b |
| US-130 | backlog.md:567 | todo (sketch) [PC-B chart UI + PC-A architect note (first-person reveal radius/cone vs RE-11 un |
| US-131 | backlog.md:568 | todo (sketch) [PC-B] - **owner question: minimap on screen, or chart card only (Zelda-style)?** |
| US-080 | backlog.md:599 | todo (sketch) |
| US-026 | backlog.md:677 | todo |
| US-027 | backlog.md:688 | todo |
| US-049 | backlog.md:743 | todo |
| US-036 | backlog.md:850 | todo (sketch) |
| US-037 | backlog.md:861 | todo (sketch) |
| US-041b | backlog.md:879 | todo (sketch) |
| US-052 | backlog.md:925 | todo (sketch) |
| US-053 | backlog.md:936 | todo (sketch) |
| US-054 | backlog.md:946 | todo (sketch) |
| US-055 | backlog.md:956 | todo (sketch) |
| US-132 | backlog.md:1016 | todo (sketch) |
| US-134 | backlog.md:1038 | todo (sketch) |
| US-135 | backlog.md:1047 | todo (sketch) |
| US-137 | backlog.md:1066 | todo (sketch) |
| US-139 | backlog.md:1075 | todo (sketch) |
| US-140 | backlog.md:1084 | todo (sketch) |
| WATER-2 | backlog.md:1093 | (no status tag) |
| US-091a | backlog.md:1334 | todo |
| HANDS-01 | backlog.md:1379 | todo |
| TREES-LP-d | backlog.md:1446 | todo [PC-A designer] ~0.75 d - deps: a; owner OK on preview |
| TREES-LP-e | backlog.md:1447 | todo [PC-A] ~0.25 d - deps: c |
| ALPHA-01 | backlog.md:1449 | (no status tag) |
| DIALOGUE-01b | backlog.md:1471 | todo [PC-B game/UI, ~1 d] - deps: 01a, NPC-BEAR-01, BEAR-LINES-01; designer `uiStyle.dialogue` |
| DIALOGUE-01b | backlog.md:1506 | todo |
| CHARGEN-04a | backlog.md:1544 | todo [PC-B designer, 0.75 d] |
| CHARGEN-04b | backlog.md:1545 | todo [PC-B designer, 0.75 d] |
| CHARGEN-09 | backlog.md:1550 | arch-review [PC-B B1] (already in the CHARGEN-07 writer: 2 baked clips idle/wave, FK-checked in |
| CHARGEN-19 | backlog.md:1558 | todo [PC-B B1, 0.75 d] - deps 13, 14 |
| CHARGEN-20 | backlog.md:1559 | todo [PC-B B1, 0.5 d] - needs owner certificates (ESCALATE 38.29 item 8) |
| CHARGEN-18 | backlog.md:1567 | todo [PC-B designer, 0.75 d] |
| CHARGEN-23b | backlog.md:1574 | Designer: head at 0.625 cm (Ultra, procedural script), only after the owner OKs 23 |
| KPKG-05 | backlog.md:1586 | todo [PC-B B1, 0.75 d] |
| KPKG-07 | backlog.md:1587 | todo [PC-B B2, 0.75 d] -> arch-review |
| CHARGEN-04a | backlog.md:1634 | (no status tag) |
| CHARGEN-19 | backlog.md:1697 | (no status tag) |
| WILD-07 | backlog.md:1776 | todo [PC-B B1, 0.75 d] - deps WILD-D3, 06 -> arch-review |
| WILD-08 | backlog.md:1777 | todo [PC-B B1, 0.5 d] - deps WILD-D1, D2, 06 -> arch-review |
| WILD-D1 | backlog.md:1778 | todo [PC-B designer, 0.75 d] - after the owner OKs the rabbit + deer preview |
| WILD-D3 | backlog.md:1780 | todo [PC-B designer, 0.75 d] - after the owner OK |
| WILD-D4 | backlog.md:1781 | todo [PC-B designer + PO, 0.25 d] |
| WILD-07 | backlog.md:1857 | (no status tag) |
| WILD-08 | backlog.md:1862 | (no status tag) |
| WILD-D1 | backlog.md:1866 | (no status tag) |
| CH1-W2 | backlog.md:2036 | todo NEEDS WRITER |
| CH1-W3 | backlog.md:2037 | todo NEEDS WRITER |
| CH1-W4 | backlog.md:2038 | todo NEEDS WRITER |
| CH1-W2 | backlog.md:2131 | (no status tag) |
| CH1-W3 | backlog.md:2134 | (no status tag) |
| CH1-W4 | backlog.md:2137 | (no status tag) |
| ART-01b | pc-b-queue.md:115 | (no status cell) 01a |
| ART-01c | pc-b-queue.md:116 | (no status cell) 01b |
| ART-03a | pc-b-queue.md:117 | (no status cell) 01a |
| ART-03b | pc-b-queue.md:118 | (no status cell) 01b |
| ART-04b | pc-b-queue.md:119 | (no status cell) 04a |
| WS2-04 | pc-b-queue.md:196 | arch-review (NEEDS PC-A) |
| WS2-06 | pc-b-queue.md:198 | arch-review (NEEDS PC-A) |
| OQ-WS2-2 | pc-b-queue.md:201 | OWNER QUESTION |
| OQ-WS2-3 | pc-b-queue.md:202 | OWNER QUESTION |
| OQ-WS2-4 | pc-b-queue.md:203 | OWNER QUESTION |
| DN-Q2 | pc-b-queue.md:235 | owner |
| DN-Q3 | pc-b-queue.md:236 | owner |
| EQ-D2 | pc-b-queue.md:246 | PO REJECT (2026-10-11): no `uiStyle.character` / `uiStyle.quickbar` in design/models/inventory_ |
| EQ-14 | pc-b-queue.md:260 | owner |
| MAP-A1 | pc-b-queue.md:268 | ARCH-NOTE geography + skyline: recipe-layer API in `design/levels/overworld_far.js` (sea/coast, |
| MAP-20 | pc-b-queue.md:287 | designer |
| MAP-22 | pc-b-queue.md:289 | PO OK (2026-10-11; route-walk leg 9e PASS) |
| MAP-24 | pc-b-queue.md:291 | PO OK (2026-10-11) |
| MAP-29 | pc-b-queue.md:296 | owner |
| QL-D1 | pc-b-queue.md:310 | PO OK - owner look pending (2026-10-11; crow = WILD-ART-02, Rook reads as crow? nest OB-036; mi |
| QL-15 | pc-b-queue.md:325 | PO OK (2026-10-11; ford refuses without glass flag, crystal hint text instead of hint.relay.nom |
| QL-18 | pc-b-queue.md:328 | PO OK (2026-10-11; sq.fc.caps + 3 chests + hidden chest; 4 pieces reachable) |
| QL-20 | pc-b-queue.md:330 | owner |
| EQ-22 | pc-b-queue.md:359 | **BLOCKED: owner decision.** Tier look on Wick + icons. Option A realistic shades: same shell,  |

## OB rows (docs/bugs.md)
Rule: an OB row can only move to `fix in - OWNER TO TEST`, never to verified/closed (only the owner does that).

### OB STALE
| ID | line | current status | suggested | commits citing it |
|---|---|---|---|---|
| OB-101 | 13 | fixed 6a84fef5 - OWNER TO VERIFY (?carpet=1, walk out of the tower) | fix <commit> - OWNER TO TEST | 39a38f34 TUFT-01b (OB-102): carpet AC4 grazing fixture at cellM 0.05 after the  / 6a84fef5 OB-101: grass reaches the rad |
| OB-085 | 29 | fixing (main session) | fix <commit> - OWNER TO TEST | 09e0f74d OB-085: rock material crawled while walking closer - OB-081 far tier b |
| OB-082 | 32 | fixed (main session) - verify: loot a chest + a boar/wolf gear drop | fix <commit> - OWNER TO TEST | 05ec2f2a OB-082: loot crash 'toasts is not defined' - the OB-075 chest-hook not |
| OB-080 | 34 | fixed 26655b29 (saveState dropTransient strips questMark*, heals old saves; migrateSword g | fix <commit> - OWNER TO TEST | 0dd2d2c7 OB-080 + handoff update (M4-C2 done overnight) |
| OB-052 | 62 | fixed 08cce6b7 (cone 40 deg, nearest wins, hysteresis) - arch-review, verify | fix <commit> - OWNER TO TEST | 3df1c82f Merge OB-052 (kestrel-3) into pc-b / 08cce6b7 OB-052: forgiving interact aim - cone 40 deg, score = angle + 15* |
| OB-051 | 63 | fixed cdc6434d (2x prompt glyphs, 38.48) - arch-review, verify | fix <commit> - OWNER TO TEST | e8017aef Arch batch review: OB-051/052/053a ARCH OK; 38.49 precision correction / 8a68f9a1 B1-main: OB-051 prompt scale  |
| OB-049 | 65 | fixed 295b5c73 + b480c253 (dialogue too) - verify Esc with the mouse locked | fix <commit> - OWNER TO TEST | b480c253 OB-049: shared escGrace helper - Esc closes an open dialogue (as notes / 295b5c73 OB-048 + OB-049: note shows a |
| OB-048 | 66 | fixed 295b5c73 - verify (try Esc/click/walk-away in game) | fix <commit> - OWNER TO TEST | 03aad91a bugs.md: OB-048/049/051/052 fixed, OB-053 progress / 295b5c73 OB-048 + OB-049: note shows a clickable << CLOSE  |
| OB-047 | 67 | fixed (pending commit): it was a hanging vine (Prop_Vine5 rs413, tower west wall, no wall  | fix <commit> - OWNER TO TEST | ddf3874b OB-055/056/057: notes freeze movement + view, walk-away close off (it  / 99e4b4af OB-046: remove the Ferrum cit |
| OB-044 | 70 | fixed - verify (climb OK; Rook no longer blocks the deck; R1 reaches nest + both chests) | fix <commit> - OWNER TO TEST | c73a5efd bugs.md: OB-044 fixed / 72566193 OB-044: Rook no longer blocks the roof deck (collider removed) - nest, |
| OB-043 | 71 | fixed b06fcb85 | fix <commit> - OWNER TO TEST | b06fcb85 OB-043 + MAP-08: draw list degrades instead of throwing (512 items, 61 / f087e023 bugs.md: OB-043 draw list at  |
| OB-042 | 72 | fixed (ob042-bow merged) - verify | fix <commit> - OWNER TO TEST | 867f2c8d bugs.md: OB-048..053 from playtester feedback (note close, Esc, intera / 392002ab OB-042 follow-up: named 'Pack |
| OB-041 | 73 | fixed (GPU terrain interpolates world - render origin; f32 edge ties; gpucompare 0 PASS->F | fix <commit> - OWNER TO TEST | 4d7575ac bugs.md: OB-041 fixed / d89f4732 OB-041: GPU terrain interpolated absolute world position (/x/ ~1460 m, |
| OB-040 | 74 | fixed - the test script raced (game Continue was correct); verify-m4-exit PASS | fix <commit> - OWNER TO TEST | e8a9d539 bugs.md: OB-040 fixed (script) / b35a6164 OB-040: verify-m4-exit script races fixed (awaited setup, clearSafe o |
| OB-039 | 75 | fixed - verify (frustum cull before the 64-draw cap; F3 shows dropped) | fix <commit> - OWNER TO TEST | 810cc115 MESH-INST-02 (OB-039 follow-up): masked + open placed meshes batch int / b58d12dd OB-039: mesh draw cap filled  |
| OB-038 | 76 | fixed - verify (west bank clumps, hedge, fences, trade-post awning) | fix - OWNER TO TEST (no commit cited) | - |
| OB-037 | 77 | fixed - verify (reeds/ferns/rocks on the ford banks) | fix - OWNER TO TEST (no commit cited) | - |
| OB-036 | 78 | fixed - verify (log + grass nest) | fix - OWNER TO TEST (no commit cited) | - |
| OB-035 | 79 | fixed - verify (Prop_Support sign posts) | fix - OWNER TO TEST (no commit cited) | - |
| OB-034 | 80 | fixed - verify (per-section seeds) | fix - OWNER TO TEST (no commit cited) | - |
| OB-033 | 81 | fixed - verify (boars near the Bend, deer at the river, closer spawns; note: only ~1 anima | fix - OWNER TO TEST (no commit cited) | - |
| OB-032 | 82 | fixed - verify (placed trees used for perching/climbing) | fix <commit> - OWNER TO TEST | 22e7ede3 bugs.md: OB-032/033 fixed / b6d13fe3 OB-032/033: birds + squirrels use the placed roadside trees (placedTre |
| OB-031 | 83 | fixed - verify (Bend + trade-post lamps lit, chimney smoke) | fix <commit> - OWNER TO TEST | 24578ca0 bugs.md: OB-031, 034-039 fixed / e19d1434 Design walk fixes OB-031,034-038: Bend + trade-post lamps lit, chimne |
| OB-030 | 84 | fixed - verify (autosave + restore banner; direct save after the 8000 server restarts) | fix <commit> - OWNER TO TEST | 54651d82 bugs.md: OB-030 fixed / a9b66931 OB-030: editor autosave to IndexedDB (5 s + pagehide) with a restore b |
| OB-029 | 85 | fixed - verify (unused filter + delete; pending-deletes list applied by the main session) | fix <commit> - OWNER TO TEST | 4c0988d6 OB-028 + OB-029: editor scene tree groups (foldable, counts, sub-group / a55ccaf7 bugs.md: OB-021 fixed, OB-029 |
| OB-028 | 86 | fixed - verify (foldable groups + user groups) | fix <commit> - OWNER TO TEST | 2f5e1385 bugs.md: OB-027 lost, OB-028/029 fixed, OB-030 editor autosave / 4c0988d6 OB-028 + OB-029: editor scene tree gr |
| OB-026 | 88 | fixed - verify (readable crumpled canvas heap; owner did not choose, made readable) | fix <commit> - OWNER TO TEST | 7b3c63d8 bugs.md: OB-026 fixed / dffe104c OB-026: wake-spot canvas heap readable - crumpled torn envelope canvas |
| OB-025 | 89 | fixed - owner to judge (human kit v4; compare at design/preview/chargen_kit.html) | fix <commit> - OWNER TO TEST | f85a9467 Design walk 2026-10-11 report + OB-031..038 gaps logged; OB-025 compar / 1c5e0d8e bugs.md: OB-025 ready for the |
| OB-024 | 90 | fixed - verify (ruined stone house from the Medieval Village kit; docs/test-reports/ob024- | fix <commit> - OWNER TO TEST | b53d5e4a bugs.md: OB-024 fixed / 8d19eb42 OB-024: Rook's nest is a ruined stone house (Medieval Village CC0: une |
| OB-023 | 91 | fixed - verify | fix <commit> - OWNER TO TEST | 04c47bbf bugs.md: OB-023 fixed / e708be0d OB-023: red caps grow on tree trunks (Laetiporus at 0.5-1.1 m, scale 1 |
| OB-022 | 92 | fixed - verify (same-speaker lines grouped per page; Burl first talk 48 -> 28 E presses) | fix <commit> - OWNER TO TEST | 4a968547 OB-022: dialogue pages - consecutive same-speaker lines merge into one / 5d255c6c bugs.md: OB-021 blurry text a |
| OB-021 | 93 | fixed - verify (UI atlas whole texels + nearest sampling) | fix <commit> - OWNER TO TEST | a55ccaf7 bugs.md: OB-021 fixed, OB-029 editor asset delete / 99685165 OB-021: crisp UI text at 560x210 - UI atlas cell r |
| OB-020 | 94 | fixed - verify (puff footprint cap 3 -> 12 cells, size grows with age 1.5 -> 7 m) | fix <commit> - OWNER TO TEST | 62c4e50f OB-020: smoke keeps its size up close - particle footprint cap 3 -> 12 / 5b38abbb bugs.md: OB-020 reopened (smo |
| OB-018 | 96 | fixed - verify (relays z 'ground', plinths lowered; relayGround.test) | fix <commit> - OWNER TO TEST | 97e3a8e6 bugs.md: OB-018/020/022 fixed, OB-026/027 logged; river crossing decis / 09054c6e OB-018: relays stood 0.5-0.6  |
| OB-016 | 98 | fixed - verify | fix <commit> - OWNER TO TEST | 15029926 OB-016: walking downhill from the tower to the Bend relay snapped the  / aad13ee9 OB-016 harness: tools/verify- |
| OB-013 | 101 | fixed (editor doc skips code-only levels) - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-012 | 102 | fixed - verify | fix <commit> - OWNER TO TEST | a92abc3d bugs.md: OB-011, OB-012 fixed / 1be5d9fb OB-011: potion HUD button removed (potions via Items count + quick bar |
| OB-011 | 103 | fixed - verify | fix <commit> - OWNER TO TEST | a92abc3d bugs.md: OB-011, OB-012 fixed / 1be5d9fb OB-011: potion HUD button removed (potions via Items count + quick bar |
| OB-010 | 109 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-009 | 110 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-008 | 111 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-007 | 112 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-006 | 113 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-005 | 114 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-004 | 115 | fixed | fix - OWNER TO TEST (no commit cited) | - |
| OB-003 | 116 | fixed - verify | fix - OWNER TO TEST (no commit cited) | - |
| OB-002 | 117 | fixed | fix - OWNER TO TEST (no commit cited) | - |

### OB UNSURE
| ID | line | current status | suggested | commits citing it |
|---|---|---|---|---|
| OB-103 | 11 | open - OB-103a (far strokes: min on-screen width, radius fade, live fpK, setCarpetQuality) | status open; check commit(s) | 83a2aa2a bugs.md: OB-103 grass fades at 3-6 m (owner) |
| OB-097 | 17 | open - building | status open; check commit(s) | ed810167 OB-097 texts: writer journal summaries in all 92 quest steps (template / 27cc24d2 OB-097: two-pane journal - le |
| OB-096 | 18 | step 1 in - step 2 open | status open; check commit(s) | 6b5ade2b MASK-c (OB-096): blades read the grass mask (bilerp, < 0.04 none, heig / ef173c6d MASK-e2 (OB-096): the game lo |
| OB-092 | 23 | open - designer | status open; check commit(s) | de380356 OB-092 preview: hand close-ups framed on the hand bone box (5 views in / 66f5d6ee NUB-D1 + OB-092: Nub (bearCub |
| OB-091 | 24 | open - designer | status open; check commit(s) | 6369490e World gates: OB-091 no longer deletes the meadow's rock/pebble dressin / fff74993 OB-091: designed forest desce |
| OB-086 | 28 | demo in - owner decides v8b | status open; check commit(s) | 61f33902 OB-086: the kit character (human kit v8) stands in the game next to Bu |
| OB-083 | 31 | open - next | status open; check commit(s) | 52077832 OB-083 follow-up: Mixamo T-pose export centres the footprint (v8 block / 5bda43ba OB-083: human kit v8 - body + |
| OB-078 | 36 | open - designer (fable) | status open; check commit(s) | f39fb550 OB-078: human kit v7 head pass (rounded skull + occiput, sloped nose w / 6fd3d0cf OB-071: human kit v6 body sha |
| OB-077 | 37 | open - fixing | status open; check commit(s) | 42f4ff14 Merge OB-077 regen (kestrel-4) into pc-b / 7c2ec031 OB-077: out-of-combat HP regen (+1 hp / 2 s after 8 s witho |
| OB-076 | 38 | open - fixing (priority) | status open; check commit(s) | 0f32280e verify-boar-loot: OB-076 step waits for the strike after the charged h / 6fd3d0cf OB-071: human kit v6 body sha |
| OB-075 | 39 | open | status open; check commit(s) | 05ec2f2a OB-082: loot crash 'toasts is not defined' - the OB-075 chest-hook not / 0a629f09 OB-076: sword/targeting track |
| OB-074 | 40 | open | status open; check commit(s) | 0a629f09 OB-076: sword/targeting tracked only the first 16 targetables (26 in t / 91738e5e tests: voxWrite pins res 1/1  |
| OB-073 | 41 | reopened 2026-10-12: owner 'STILL flickering' after the smooth-noise merge (squares gone,  | status open; check commit(s) | d4f38381 OB-073-D2f wiring fix: pushCarpet uses the world:loaded event's world  / 446791ca OB-073-D2f wiring: 12 blade r |
| OB-072 | 42 | open - fixing | status open; check commit(s) | 7973409c Merge INT-HL-01 + OB-072 (kestrel-1) into pc-b / a6369f82 OB-072: mouse comes back after Esc-resume (document-l |
| OB-071 | 43 | open - designer (fable) | status open; check commit(s) | 6fd3d0cf OB-071: human kit v6 body shape (oval torso, shoulders/neck, tapered a / 2d67ea5b bugs.md: OB-071..073 |
| OB-070 | 44 | open - fixing | status open; check commit(s) | 1e9d7d1b Merge OB-070 test follow-up (kestrel-4) / 3bf71a56 OB-070: mixamo test 16 checks (placement, transforms, normal |
| OB-069 | 45 | open - owner pick | status open; check commit(s) | 91738e5e tests: voxWrite pins res 1/1 (OB-069 fine head default); mixamo materi / 9600e57e Merge OB-069 fine face defaul |
| OB-068 | 46 | open | status open; check commit(s) | 5c85caa8 Merge OB-068 (kestrel-1) into pc-b / e64ce1ab OB-068: Esc in the pause menu resumes (lock re-taken on the next  |
| OB-067 | 47 | open - next free slot | status open; check commit(s) | c1545f62 Merge OB-067 (kestrel-5) into pc-b / 4439bc57 OB-067: ground glyph/glint/close features keyed on the 1 m world  |
| OB-066 | 48 | open - fixing | status open; check commit(s) | 92a35f3b Merge OB-066 ray targeting (kestrel-3) into pc-b / 2a0f8209 OB-066: [E] targeting = crosshair ray vs the object |
| OB-065 | 49 | open | status open; check commit(s) | f408f05e OB-065: human kit v5 - flat male chest (clothes follow), detailed fine / a0b3454e bugs.md: OB-064 boar loot bef |
| OB-064 | 50 | open | status open; check commit(s) | 595a2bd4 Merge OB-064 (kestrel-1) into pc-b / 7073b65c OB-064: rolled gear stays in the corpse until E (was a ground pic |
| OB-063 | 51 | open | status open; check commit(s) | fe22167c Merge OB-063 interact gate (kestrel-3) into pc-b / 826e38da OB-063: interact gate tightened (22 deg horizontal  |
| OB-062 | 52 | open | status open; check commit(s) | 62b8bf5b check-deps: OB-062 test imports via engine/dev.js / f88d8963 Merge OB-062 river look (kestrel-3) into pc-b |
| OB-061 | 53 | open | status open; check commit(s) | 3baf75d6 OB-089: masked trees' LOD1 leaf cards drawn with the open (two-sided,  / c4829780 Merge OB-061 (kestrel-2) into |
| OB-060 | 54 | open | status open; check commit(s) | f3697e38 Merge OB-060 (kestrel-4) into pc-b / 6f4e0aba OB-060: crossed X-beam trusses poi077/poi078 (Roof_Support2, one  |
| OB-059 | 55 | open | status open; check commit(s) | 50d15457 OB-059: dark signal-tower billboard removed (invisible farTower anchor |
| OB-055 | 58 | open - investigating | status open; check commit(s) | ddf3874b OB-055/056/057: notes freeze movement + view, walk-away close off (it  |
| OB-058 | 59 | open | status open; check commit(s) | f8fec16a Merge INT-HL-01 fix + OB-058 names (kestrel-1) into pc-b / 6618765b INT-HL-01 fix: highlight glyph '*' (the mid |
| OB-054 | 60 | open - fixing (OB-054a/b) | status open; check commit(s) | 7c03da5d Merge OB-054 ground colour fix (kestrel-3) into pc-b / 67f2de55 OB-054: ground patch colour + close-band jitter |
| OB-053 | 61 | in progress: lint d99c0b4d found 845 flicker pairs (Sealed Gate, Outwall roofs) -> generat | status open; check commit(s) | 03aad91a bugs.md: OB-048/049/051/052 fixed, OB-053 progress / 9300de3d Merge OB-053 lint (kestrel-4) into pc-b |
| OB-019 | 95 | reopened - architect note | status open; check commit(s) | 0f62311d RIVER-04 (OB-019): river resolution (architect 38.45-6) - bed carved m / 963d355d RIVER-03 (OB-019): WebGPU riv |
| OB-001 | 118 | answered | status open; check commit(s) | 15e6dd97 OB bug log (owner rule): docs/bugs.md with OB-001..OB-016 from today's |

### OB OPEN
| ID | line | status |
|---|---|---|
| OB-057 | 56 | open |
| OB-056 | 57 | open |
| OB-050 | 64 | superseded by OB-057 |
| OB-014 | 100 | open - watch; reopen if seen again |

## Duplicate IDs

- US-079b: backlog.md:151 (owner walk-test pending (stale-rows 2026); backlog.md:1308 (todo)
- US-079b0: backlog.md:152 (**arch-review [PC-B engine, 2026-10-06]*); backlog.md:1347 (todo)
- MAP-01a: backlog.md:373 (Files: `design/preview/chart.html`, `des); pc-b-queue.md:270 (design/levels/overworld_far.js (layer co)
- MAP-01b: backlog.md:374 (todo [lane C, sprint 7] ~1 d - parallel ); pc-b-queue.md:271 (READY (38.42). AC1 `map.x0/y0` far grid )
- MAP-01c: backlog.md:375 (todo [lane C, sprint 7/8] ~1 d - deps: 0); pc-b-queue.md:272 (READY after 01a. AC1 per-biome forest sp)
- BUG-RESPAWN-001: backlog.md:403 ((no status cell) [PC-B] `game/js/quest/s); backlog.md:1265 ((no status tag))
- BUG-MANA-001: backlog.md:404 ((no status cell) [PC-B] `game/js/quest/v); backlog.md:1252 ((no status tag))
- BUG-PICKUP-001: backlog.md:405 ((no status cell) [PC-B] `game/js/quest/s); backlog.md:1278 ((no status tag))
- US-053a: backlog.md:467 (… `engine/world/entityEmitters.js`, `eng); backlog.md:970 (todo (sketch))
- US-055a: backlog.md:470 (… max 32, validated), `World.waterAt(x, ); backlog.md:997 (todo (sketch)); pc-b-queue.md:372 (todo (arch-review))
- US-133: backlog.md:491 (… `fire:area` event; hooks World.fire=nu); backlog.md:1027 (todo (sketch))
- US-078: backlog.md:517 (… session 49 PASS): design/models/m3_pro); backlog.md:571 (todo (sketch))
- US-087: backlog.md:532 (todo (sketch) [PC-A] - basis for US-107/); backlog.md:1291 ((no status tag))
- US-079a: backlog.md:614 (dev done -> arch-review); backlog.md:563 (**PO OK 2026-10-01 (sonnet batch) -> tes)
- US-053c: backlog.md:981 (dev done -> arch-review (2026-10-03)); backlog.md:468 (… + dirty rows, zero alloc); presets emb)
- CLOTH-1: backlog.md:1154 (1a/1a2/1b1/1b2/1b3/1b4 done; 1b5 stairwe); backlog.md:409 (**Cloth physics - "nice clothes"** (owne)
- SPELL-01a: backlog.md:1398 (todo); backlog.md:159 (**PO OK 2026-10-07 (claims-only) -> test)
- SPELL-01b: backlog.md:1413 (todo); backlog.md:160 (**owner look [PC-B, 2026-10-07]**. `fire)
- US-091b: backlog.md:1425 (todo); backlog.md:161 (**po-review + owner look [PC-B, 2026-10-)
- ALPHA-01f: backlog.md:1458 (todo [B2, ARCH-approved 2026-10-09]; bef); backlog.md:1459 (todo [PC-A] ~0.25 d - deps: e; owner wal)
- BEAR-LINES-01: backlog.md:1468 (todo [PC-B writer, ~0.25 d; no deps]); backlog.md:1474 (todo)
- NPC-BEAR-01: backlog.md:1469 (arch-review [PC-B game, kestrel-3; touch); backlog.md:1484 (arch-review)
- NPC-TALK-ANIM-01: backlog.md:1472 (Jaw lip-sync to the typed text (vowel op); backlog.md:1517 (todo)
- CHARGEN-01: backlog.md:1541 (`content/chargen/human.charkit.json`, `d); backlog.md:1589 ((no status tag))
- CHARGEN-02: backlog.md:1542 (arch-review [PC-B B2, 0.75 d]); backlog.md:1604 ((no status tag))
- CHARGEN-03: backlog.md:1543 (arch-review [PC-B B2, 0.75 d]); backlog.md:1617 ((no status tag))
- CHARGEN-05: backlog.md:1546 (arch-review [PC-B B2, 0.5 d]); backlog.md:1639 ((no status tag))
- CHARGEN-10: backlog.md:1551 (arch-review [PC-B B1, 0.75 d] (static pa); backlog.md:1665 ((no status tag))
- CHARGEN-13a: backlog.md:1554 (arch-review [PC-B B1, 0.5 d]); backlog.md:1682 ((no status tag))
- RIG-01: backlog.md:1561 (arch-review [PC-B B2, 0.75 d]); backlog.md:1707 ((no status tag))
- KPKG-01: backlog.md:1582 (arch-review [PC-B B2, 0.5 d] -> arch-rev); backlog.md:1728 ((no status tag))
- KPKG-02: backlog.md:1583 (arch-review [PC-B B2, 0.75 d] -> arch-re); backlog.md:1738 ((no status tag))
- KPKG-03: backlog.md:1584 (arch-review [PC-B B1, 0.5 d]); backlog.md:1748 ((no status tag))
- CHARGEN-15: backlog.md:1715 ((no status tag)); backlog.md:1564 (removed (owner 2026-10-10, D-058: Fen ou)
- WILD-01: backlog.md:1767 (arch-review [PC-B B2, 0.5 d]); backlog.md:1790 ((no status tag))
- WILD-03: backlog.md:1769 (arch-review [PC-B B1, 0.75 d]); backlog.md:1808 ((no status tag))
- WILD-04: backlog.md:1770 (todo [PC-B B1, 0.75 d] - deps WILD-02, 0); backlog.md:1772 (arch-review [PC-B B1] (impl done; see no); backlog.md:1825 ((no status tag))
- WILD-05: backlog.md:1771 (arch-review [PC-B B2] - feed 0.0012 ms p); backlog.md:1773 (todo [PC-B B2, 0.5 d] - deps WILD-01, 04); backlog.md:1838 ((no status tag))
- WILD-06: backlog.md:1774 (Game wiring: FaunaEnv (habitat from terr); backlog.md:1847 ((no status tag))
- QG-01: backlog.md:1879 (arch-review); backlog.md:1889 ((no status tag))
- QG-03: backlog.md:1881 ((no status cell) QG-01, QG-02, QG-D1 (co); backlog.md:1900 ((no status tag))
- QG-04: backlog.md:1882 ((no status cell) QG-03, QG-D1); backlog.md:1910 ((no status tag))
- QG-05: backlog.md:1883 (kestrel-1 (VIEW DONE kestrel-2, mount = ); backlog.md:1915 ((no status tag))
- QG-W1: backlog.md:1886 ((no status cell) -); backlog.md:1920 ((no status tag))
- QG-D1: backlog.md:1887 (designer); backlog.md:1923 ((no status tag))
- WS1-04: backlog.md:1936 (`content/worlds/world_m1.world.json` (bo); backlog.md:1962 ((no status tag))
- WS1-05: backlog.md:1937 (`tools/gen-roadside-meshes.mjs` (flags +); backlog.md:1968 ((no status tag))
- WS1-W1: backlog.md:1944 (todo NEEDS WRITER); backlog.md:2005 ((no status tag))
- WS1-01: backlog.md:1946 ((no status tag)); backlog.md:1933 (ARCH OK -> po-review [PC-B])
- WS1-02: backlog.md:1952 ((no status tag)); backlog.md:1934 (ARCH CHANGES (build loop uses near.w for)
- WS1-03: backlog.md:1958 ((no status tag)); backlog.md:1935 (ARCH OK -> po-review (gpucompare gate: m)
- WS1-06a: backlog.md:1974 ((no status tag)); backlog.md:1938 (po-review [PC-B])
- WS1-06b: backlog.md:1981 ((no status tag)); backlog.md:1939 (ARCH OK; PO OK (PC-B batch, PC-A to rati)
- WS1-07a: backlog.md:1987 ((no status tag)); backlog.md:1940 (po-review [PC-B])
- WS1-07b: backlog.md:1992 ((no status tag)); backlog.md:1941 (po-review [PC-B])
- WS1-08: backlog.md:1997 ((no status tag)); backlog.md:1942 (ARCH OK; tooling done + gates PASS (rout)
- CH1-07: backlog.md:2025 (`game/js/quest/npcWalk.js` (new) + test,); backlog.md:2086 ((no status tag))
- CH1-08a: backlog.md:2026 (todo [PC-B]); backlog.md:2092 ((no status tag))
- CH1-10: backlog.md:2029 (todo [PC-B]); backlog.md:2106 ((no status tag))
- CH1-D1a: backlog.md:2030 (designer); backlog.md:2111 ((no status tag))
- CH1-D1b: backlog.md:2031 (`content/levels/tower.level.json` (wall ); backlog.md:2117 ((no status tag))
- CH1-01: backlog.md:2041 ((no status tag)); backlog.md:2016 (ARCH OK; PO OK -> testing (towerDoor pla)
- CH1-02: backlog.md:2047 ((no status tag)); backlog.md:2017 (ARCH OK; PO OK -> testing (markers/compa)
- CH1-03: backlog.md:2053 ((no status tag)); backlog.md:2018 (ARCH OK; PO OK (module) - open: main.js )
- CH1-04a: backlog.md:2057 ((no status tag)); backlog.md:2019 (ARCH OK; PO OK (module) - open: main.js )
- CH1-05: backlog.md:2067 ((no status tag)); backlog.md:2021 (ARCH OK; PO OK (content) -> testing afte)
- CH1-06: backlog.md:2072 ((no status tag)); backlog.md:2022 (ARCH OK; PO OK (module) - open: main.js )
- CH1-E1: backlog.md:2077 ((no status tag)); backlog.md:2023 (ARCH OK -> po-review [PC-B] (engine))
- CH1-09: backlog.md:2101 ((no status tag)); backlog.md:2028 (ARCH OK; PO OK (module) - open: main.js )
- CH1-D2: backlog.md:2121 ((no status tag)); backlog.md:2032 (PO OK (design, claims) - open: owner loo)
- CH1-D3: backlog.md:2125 ((no status tag)); backlog.md:2033 (PO OK (recipe, 000cb1c8; D-063 style sup)
- MAP-26: pc-b-queue.md:293 (MAP-10..13, MAP-20, owner go after the s); pc-b-queue.md:367 (todo (po-review))
- US-091a: backlog.md:153 (todo - after US-079b; NEEDS PC-A: design); backlog.md:1334 (todo)
- HANDS-01: backlog.md:155 (todo - after TORCH-01a + BUG-VM-001 left); backlog.md:1379 (todo)
- US-049: backlog.md:241 (todo); backlog.md:743 (todo)
- US-026: backlog.md:440 (todo (sketch) - split D-026: **US-026a**); backlog.md:677 (todo)
- US-041b: backlog.md:448 (todo (sketch) – after US-041a); backlog.md:879 (todo (sketch))
- US-132: backlog.md:490 (todo (sketch) [PC-A engine status-effect); backlog.md:1016 (todo (sketch))
- US-134: backlog.md:492 (todo (sketch) [PC-A engine/render + desi); backlog.md:1038 (todo (sketch))
- US-135: backlog.md:493 (todo (sketch) [PC-B content + game/js/qu); backlog.md:1047 (todo (sketch))
- US-137: backlog.md:495 (todo (sketch) [PC-B content + game + des); backlog.md:1066 (todo (sketch))
- US-139: backlog.md:496 (todo (sketch) [PC-A engine/render light/); backlog.md:1075 (todo (sketch))
- US-140: backlog.md:497 (todo (sketch) [PC-B content/game + PC-A ); backlog.md:1084 (todo (sketch))
- US-036: backlog.md:508 (todo (sketch)); backlog.md:850 (todo (sketch))
- US-037: backlog.md:509 (todo (sketch)); backlog.md:861 (todo (sketch))
- US-080: backlog.md:522 (todo (sketch, ACs below) [PC-B HUD/quest); backlog.md:599 (todo (sketch))
- DIALOGUE-01b: backlog.md:1471 (todo [PC-B game/UI, ~1 d] - deps: 01a, N); backlog.md:1506 (todo)
- CHARGEN-04a: backlog.md:1544 (todo [PC-B designer, 0.75 d]); backlog.md:1634 ((no status tag))
- CHARGEN-19: backlog.md:1558 (todo [PC-B B1, 0.75 d] - deps 13, 14); backlog.md:1697 ((no status tag))
- WILD-07: backlog.md:1776 (todo [PC-B B1, 0.75 d] - deps WILD-D3, 0); backlog.md:1857 ((no status tag))
- WILD-08: backlog.md:1777 (todo [PC-B B1, 0.5 d] - deps WILD-D1, D2); backlog.md:1862 ((no status tag))
- WILD-D1: backlog.md:1778 (todo [PC-B designer, 0.75 d] - after the); backlog.md:1866 ((no status tag))
- CH1-W2: backlog.md:2036 (todo NEEDS WRITER); backlog.md:2131 ((no status tag))
- CH1-W3: backlog.md:2037 (todo NEEDS WRITER); backlog.md:2134 ((no status tag))
- CH1-W4: backlog.md:2038 (todo NEEDS WRITER); backlog.md:2137 ((no status tag))
- US-091a2: backlog.md:154 (**PO OK 2026-10-07 - ready for owner loo); backlog.md:1367 (testing - PO OK 2026-10-07, owner look p)
- US-067: backlog.md:253 (po-review [PC-B] (2026-09-27): `tools/ed); backlog.md:1239 (po-review)
- US-038: backlog.md:442 (todo - sprint 3 (D-026); split 2026-09-2); backlog.md:699 (todo)
- US-042: backlog.md:443 (todo (sketch)); backlog.md:717 (todo (sketch))
- US-055b: backlog.md:472 (todo (sketch) [PC-B game + PC-A `waterAt); backlog.md:1006 (todo (sketch))
- US-043: backlog.md:502 (todo (sketch)); backlog.md:1195 (todo (sketch))
- US-035: backlog.md:507 (todo (sketch)); backlog.md:839 (todo (sketch))
- US-079: backlog.md:521 (todo (sketch, ACs below) [PC-A engine AI); backlog.md:586 (todo (sketch))
- US-128: backlog.md:564 (… story note). AC 7 (owner feel check) a); backlog.md:636 (po-review)
- DIALOGUE-01a: backlog.md:1470 (todo [PC-B, ~0.75 d] - **ARCH-NOTE NEEDE); backlog.md:1496 (todo - ARCH-NOTE NEEDED)
- CHARGEN-06: backlog.md:1547 (arch-review [PC-B B1, 0.25 d]); backlog.md:1646 ((no status tag))
- WILD-02: backlog.md:1768 (arch-review [PC-B B2, 0.5 d]); backlog.md:1798 ((no status tag))
- QG-02: backlog.md:1880 (arch-review); backlog.md:1895 ((no status tag))
- WS1-09: backlog.md:1943 (won't-do: superseded by CH1-01 (38.37) [); backlog.md:2002 ((no status tag))
- CH1-04b: backlog.md:2020 (todo [PC-B]); backlog.md:2061 ((no status tag))
- CH1-E2: backlog.md:2024 (ARCH OK -> po-review [PC-B] (engine)); backlog.md:2081 ((no status tag))
- CH1-08b: backlog.md:2027 (main.js (Fen hidden until the relay wake); backlog.md:2097 ((no status tag))
- CH1-W1: backlog.md:2035 (todo NEEDS WRITER); backlog.md:2128 ((no status tag))
- CH1-W5: backlog.md:2039 (todo NEEDS WRITER); backlog.md:2140 ((no status tag))

## Top 10 stale rows (checked by hand against the commit and the verdict line)
| ID | file:line | current status | suggested | evidence |
|---|---|---|---|---|
| WG-3e | backlog.md:324 | arch-review | testing | commit ed3feff4; batch-review-2026-10-08.md:31 PO OK -> testing (provisional) |
| US-096a | backlog.md:366 | todo | testing | commit 24ec1d03; batch-review-2026-10-08.md:34 PO OK -> testing (provisional) |
| US-089a | backlog.md:367 | todo | testing | commit 20a20b4e; batch-review-2026-10-08.md:35 PO OK -> testing (provisional) |
| WG-3d | backlog.md:323 | arch-review | testing | commits 0d166d9f, 6cde02f8; batch-review-2026-10-08.md:30 PO OK -> testing (provisional) |
| MESH-SCALE-01 | backlog.md:364 | todo | po-review | commit 73ddef13; batch-review-2026-10-08.md:109 ARCH OK -> po-review |
| US-090a | backlog.md:369 | todo | testing (logic) | commit fcdb6029; batch-review-2026-10-08.md:112 ARCH OK, :143 PO OK -> testing |
| WG-5b | backlog.md:330 | todo | po-review | commit b9884803; batch-review-2026-10-09-pcb.md:166 ARCH OK |
| WG-5a | backlog.md:329 | todo | po-review | commits 97b0d0c5, a644699d; batch-review-2026-10-09-pcb.md:142 ARCH OK |
| QUAT-TREES-01 | backlog.md:334 | design | po-review | commit d44e36e6; batch-review-2026-10-09-pcb.md:200 ARCH OK |
| MAP-01b | backlog.md:374 | todo | UNSURE - re-review | commits 71f57ab5, 62a96a62, 2cd39496; batch-review-2026-10-08.md:19 ARCH CHANGES (C), no later ARCH OK found |

## Caveats
- Suggestions come from a heuristic that reads any verdict line naming the ID. A few rows (e.g. MESH-SCALE-01 in the STATUS STALE table) show the wrong next step; check the verdict line before editing.
- The "LIKELY DONE" table is short: only 11 rows, and none has a tester PASS line. Tester reports rarely name story IDs with PASS.
- Rows in pc-b-queue.md have no status column; they are listed by landed-commit evidence only.
- Test-report and verdict parsing reads only `.md` files; PNG evidence was ignored.
- The Owner rule is respected: no OB row is suggested as verified or closed. 14 OB rows are "fix in - OWNER TO TEST" and 5 are already closed by the owner.
- Helper scripts: `C:/Users/GERGEL~1.SZA/AppData/Local/Temp/claude/C--dev-projects-kestrel/1a01500f-f322-4cad-8798-31243ff9165d/scratchpad/` (audit.py, classify2.py, report.py).
