# Batch review 2026-10-13 (PC-B architect opus, D-066): stale `arch-review` rows

Scope: every row/heading whose status still said `arch-review` in docs/backlog.md, docs/pc-b-queue.md, docs/lanes/*.md (+ WG-5a/5b).
Phase 1 = triage against batch-review-*.md, arch-batch-*.md, arch-audit*.md, lane verdict blocks, backlog-archive.md, git log.
Phase 2 = diff-only review of the class (d) items. `node tools/check-deps.mjs` OK (1089 files, warnings only).
Probes run only where something looked off (run-tests on terrainBands, farMap timing). Machine was at ~95 % CPU (other clones), so suite timings in this file are upper bounds.

Classes: (a) verdict on file, (b) superseded/dead, (c) not in git, (d) truly pending, reviewed here.

| ID | class | verdict | evidence |
|---|---|---|---|
| ALPHA-01a | d | ARCH OK | 5549a3e4: maskFile validation (pow2, size, base64), validateMesh mask/uvMask rules; built on by ALPHA-01b..f (all ARCH OK) |
| ALPHA-01c | a | ARCH OK | batch-review-2026-10-08.md:130 |
| ALPHA-01d | a | ARCH OK | batch-review-2026-10-08.md:152 |
| AUD-30 | a | ARCH OK | arch-batch-2026-10-10-pcb.md:24 |
| AUD-31 | d | ARCH OK | 11dbb512: min/max accumulated in begin/step with the same formula; bakeParity/terrainBands compare minH/maxH |
| AUD-44 | d | ARCH OK (perf open) | 858c8d17 + 31dda3f0: game knob; the engine part (fitCssSize maxUp) was already ARCH OK as QUALITY-BOOT (arch-batch-2026-10-10-pcb.md:35). Point-shadow GPU p95 on high/ultra still unmeasured (pc-b1.md:364) |
| AUD2-01 | d | **ARCH CHANGES**: (1) `engine/world/terrainBands.test.js` has heap gates ("idle streamBand 10k calls < 0.2 MB", "idle after swap") and a slice-time gate but no `ensureGcChild()`; under `node tools/run-tests.mjs --filter terrainBands` it FAILS (0.93 MB, 21 ms slice), and with `--expose-gc` it passes 45/0. Add `ensureGcChild()` as the first statement (AUD2-40 pattern). Rest of c1072ca2 OK (allocGate, blendLook fixed shape, ensureBandFor keepM + test) | c1072ca2 |
| CH1-03 | a | ARCH OK | 0d8ecfd1 (PC-B batch: CH1-01..06/09) |
| CH1-E1 | a | ARCH OK | 0d8ecfd1 |
| CH1-E2 | a | ARCH OK | 0d8ecfd1 (nit fixed a6c50587) |
| CHAR-IMPORT-01 | d | ARCH OK (tools/game) | 3e6e09d3: Unity C# exporter + game localOverlay; no engine change, check-deps clean |
| CHARGEN-02 | d | ARCH OK | 1042b7d8 closes batch 9 items 5.1/5.2 (overlay kit slot, canonical array partMap check, symmetric arm stretch) |
| CHARGEN-03 | d | ARCH OK | 1042b7d8 closes batch 9 items 6.1/6.2 (same-bone culling, array-only collapseRig); note mesh.test.js 8.5 s under load |
| CHARGEN-05 | d | ARCH OK | ebb03160: heightBase / randomRecipe pure + deterministic (xorshift32), sampleClip scratch |
| CHARGEN-06 | d | ARCH OK (tools) | 1042b7d8: png.js + check-deps rules 19/20 with fixtures |
| CHARGEN-07 | d | ARCH OK (tools) | 1042b7d8 gltfWrite (golden, FK test) |
| CHARGEN-08 | d | ARCH OK (tools) | a34ca93d status only; code in the 07 writer |
| CHARGEN-09 | d | ARCH OK (tools) | in the 07 writer (6-clip set waits for CHARGEN-04a) |
| CHARGEN-10 | d | ARCH OK (tools) | bbbc37cd |
| CHARGEN-11 | d | ARCH OK (tools) | a815be33 (static bytes unchanged, golden) |
| CHARGEN-12 | d | ARCH OK (tools) | 75279091 (vox-export byte-identical on 13 models) |
| CHARGEN-13a | d | ARCH OK (tools) | 50a30364 |
| CHARGEN-22a | d | ARCH OK | 8f7c5118: downsample2 pure, region/seam/resLevel validation; no res = same bytes |
| CHARGEN-22b | d | ARCH OK | 6a814edc: 1/1 byte-identical (goldens), blocks.test |
| CHARGEN-22c | d | ARCH OK (tools/game) | 8bf69597: build-kit per-level stats still open (row says so) |
| CLOUD-WRAP-01 | a | ARCH OK | batch-review-2026-10-09-pcb.md:51 |
| CULL-CAP-01 | d | ARCH OK | 1c2145a4: supports() refuses an overflowing new group (non-cull path) instead of a mid-frame throw; test |
| DN-01 | a | ARCH OK | arch-batch-2026-10-10-pcb.md:34; its change 1 (passWater LUT on liveLookVersion) landed in 95b79ab3, reviewed below |
| DN-02 | d | ARCH OK | 95b79ab3: sky LUT re-bake keyed on liveLookVersion (counter test), night floor in all 3 JS readers + both WGSL sites. Notes: gpucompare covers 8 h only (night rows = DN-04b); the JS terrain fallback without a MaterialTable (`ctx._paletteShading`) has no floorLum |
| ED-WG-01 | a | ARCH OK | 01a/01b batch-review-2026-10-09-pcb.md:90/:92; 01c (4eace036, b939dd4d) tools-only, check-deps rule 18 green; accepted as done by the WG-5b review :166 |
| EMIS-03 | a | ARCH OK | arch-batch-2026-10-10-pcb.md:30 (all 3 lane headings) |
| FRAME-ALLOC-03 | d | ARCH OK | a2f55e6f: warm-up only, threshold unchanged; sprites pitchedTermsInto. Suite ~5 s |
| GFX-03 | a | ARCH OK | batch-review-2026-10-08.md:84 |
| GPU-OFF-REASON-01 | d | ARCH OK | fb84ed50: the warn/stack only on a true->false transition; `_offReason` runs in `_syncActive` (state changes, not per frame) |
| GS-01a / GS-01b / GS-01c | a | ARCH OK | arch-batch-2026-10-10-pcb.md:17-19 |
| HAND-BURN-01 | c | not in git (01a planned; only design WIP 7afbc8fa); row not edited | - |
| HANDS-01 | a | ARCH OK (01a/b/c) | 4b82cb78, 93341d64 |
| KPKG-01 | d | ARCH OK | beae3be5 closes batch 9 item 1 (':' anywhere, ADS test rows) |
| KPKG-02 | d | ARCH OK | beae3be5 closes item 2 (script entries refused package-wide, 7 test rows) |
| KPKG-03 | d | ARCH OK (tools) | beae3be5 closes item 3 (deflate option; pack.test 3.7 s under load) |
| MAP-01a | d | ARCH OK (content) | f075825b: design/ composer + engine test; empty layer list = same bytes |
| MAP-01b | d | ARCH OK + follow-ups | 62a96a62: origin applied in Terrain bake, far mesh, exclusion, typeAt and WGSL (farMap.x = mapX0). Follow-ups: (1) WGSL/GLSL `farTypeNearest` bounds-checks both axes against `mapW`; Terrain accepts w != h -> add `if (mapW !== mapH) throw` (or upload H); (2) farMap.test wall-clock gates (bake <= 1.5 s, worst step <= 4 ms) fail under load (worst step 12-118 ms at 95 % CPU) -> move them behind a BAKE_BENCH env like bakeParity; (3) scatter.js DETAIL_TYPES is a fixed name list, size it from the recipe like Terrain.typeNames |
| MAP-01c | d | ARCH OK | da14f9fe: biome hook validated, no hook / biome 0 = same placements, bake-time only |
| MAP-06a | d | ARCH OK | 1ae37f14: pure skyline cap, sea skirt <= 4 quads, shadow list skips it |
| MAP-06b | d | ARCH OK (+ owner look) | 8b912f99: WGSL twin of the cap via G-buffer z; skirt typeAt twin; PROJ_FAR 16000 (ortho depth ~1 mm); no threshold change; meadowSkyline rows PASS |
| MAP-11 / MAP-12 | a | ARCH OK | lanes/pc-b2.md:514 / :513 |
| MAP-13 | d | ARCH OK (game) | c4f77f08: bandPose + travel wait, test |
| ME-20c-a | d | ARCH OK | 0c545735 (+ probes b5ed97cb): vao lane perspective-correct, kind-9 light reads GI.z for the normal when GA.w carries AO, kind-9 aoD = +Inf on both twins; default byte-identical |
| ME-22 | a | ARCH OK | b03598f3 |
| MESH-FULL-01 | a | merge conditions on file f0e1efba, merged by PC-A a31b0c16, D-045 ended (decisions.md); the row's "arch-review" is history text, not edited | - |
| MESH-LOD-CELLS-01 | a | ARCH OK | batch-review-2026-10-09-pcb.md:50 |
| MESH-SHADOW-02 | a | ARCH OK | batch-review-2026-10-08.md:62 |
| NPC-BEAR-01 | a | ARCH OK | batch-review-2026-10-09-pcb.md:184 |
| OB-051a | a | ARCH OK | lanes/pc-b2.md:591 |
| OB-053a | a | ARCH OK | lanes/pc-b2.md:593 |
| OB-054 | b | superseded: OB-073 replaced the ground patch shading (PATCH_CELL code gone; OB-073 ARCH OK batch-review-2026-10-12-pcb.md) | terrainShade.js |
| OB-063 | b | superseded: OB-066 crosshair-ray pick replaced the cone gate (ARCH OK lanes/pc-b2.md:631, cleanup check :633) | - |
| OB-067 | b | superseded: its ARCH CHANGES (dead code) closed by OB-073 (backlog.md:28) | lanes/pc-b2.md:632 |
| PART-VIS-01 | d | ARCH OK | caaf95c0: bgMix 0 = byte-identical; JS round + premixed byte == GPU unorm path; partBg only read where partZ was written this frame |
| PREC-01a | a | ARCH OK | batch-review-2026-10-08.md:192 |
| PREC-04 / PREC-04b | a | ARCH OK | superseded by 37.1 A9; b2 ARCH OK 54ff9415; D-045 addendum (exception ended, architect batch f2b1e3a) |
| QG-01 / QG-02 | d | ARCH OK (game) | 808bedc8: pure sim + save migration, tests |
| QG-05 | d | ARCH OK (game) | e6719b93 view + 3d5fa462 mount |
| QL-T3 | d | ARCH OK (game) | c9dc155b: indexed == brute force over 1k events, 0 alloc, v1 migration tested |
| RE-15 | a | ARCH OK | RE-15a/b fixes e87291ae, RE-15c 4f8179cd |
| RESIZE-RECOVER-01 | d | ARCH OK | 52c3ed1b: old targets kept, 3 retries, device-lost/dispose clear the retry |
| RIG-01 | d | ARCH OK + note | af65f0c4: load-time only, rejects non-rigid/cubic/morph. Note: primitive indices are not range-checked against the vertex count (package glb is user data) - add the check next time gltf.js is touched |
| RIG-03 | d | ARCH OK | b08a3061 (+ game 4f4abe26): ContentError with kpkg:// path, duplicate ids refused |
| RIG-04 | d | ARCH OK + nit | 47110d17 + f51fb858: <= 64 B/frame gate. Nit: setRotFromPose duplicates setRot; let setRot write `_rotOut`-style scratch and share one body |
| S8-B2-10a / 10b | a | ARCH OK | batch-review-2026-10-09-pcb.md:42/:43 |
| SKY-GLOW-SOFT-01 | a | ARCH OK | arch-batch-2026-10-10-pcb.md:26 |
| TREES-LP-a | d | ARCH OK | 2551ad69 (buildMeshFromTris extracted verbatim, Quaternius re-import 0 changes) + 629317aa |
| US-053c | d | ARCH OK | game/content hooks; its engine footprint change was later replaced by OB-020 (ARCH OK lanes/pc-b2.md:510) |
| US-055a | d | ARCH OK | c2a4b831: existing particles/ripples, 0 alloc, deterministic |
| US-068 | a | ARCH OK | batch-review-2026-10-09-pcb.md:18/19/31/36/37/70/93 |
| US-079a | a | ARCH OK | 960b6400 |
| US-079b | d | ARCH OK (game) | b87102c2 closes 6326e6a3 items (clip reset + elapsed->frame, homeZ; sim save/load is test-only) |
| US-079b0 | a | ARCH OK | 6326e6a3 |
| WG-1b2 | a | ARCH OK | backlog.md:378 "WG-1a/1b1/1b2 ARCH OK + fix-up" (df82f466) |
| WG-1c2 | b | superseded by WG-5b b9884803 (backend switch removed, ARCH OK batch-review-2026-10-09-pcb.md:166) | - |
| WG-4b | a | ARCH OK | batch-review-2026-10-08.md:53, :92 |
| WG-5a / WG-5b | a | ARCH OK | batch-review-2026-10-09-pcb.md:142, :166 (rows still say todo; not edited: no `arch-review` status cell) |
| WILD-01 / WILD-02 | d | ARCH OK + note | db123267: fromW 0 byte-identical, 0 alloc. Note: crossfade lerps Euler components (no wrap); fine for authored keys |
| WILD-03 / WILD-04 | d | ARCH OK | 0a7506f9, aa19acff: typed-array ring, module scratch, check-deps fauna rule |
| WILD-05 | d | ARCH OK + nit | 9a367e43: 0 alloc insertion select. Nit: feed reads `pool._rawCount`; expose a public room/rawCount getter |
| WS1-01 / WS1-03 | a | ARCH OK | 0d8ecfd1 |
| WS2-01 / 02 / 03 | a | ARCH OK | arch-batch-2026-10-10-pcb.md:31-33 |
| WS2-04 | c | not in git as its own item (MAP-12 31aba93d covered the re-upload/origin audit + gridZone row; no `ford` row) - row not edited, PO to close or re-scope | - |
| WS2-05 | d | ARCH OK + nit | 9cad7b5b: nit: `bandReady` reads `world._bandPend`; use a public getter |
| WS2-06 | c | not in git as its own item (route leg 9 landed with WS2-07) - row not edited | - |

**Counts:** (a) 43, (b) 4, (c) 3, (d) 52 reviewed: 51 ARCH OK, 1 ARCH CHANGES (AUD2-01).

**Verdict:** all stale rows updated; one small ARCH CHANGES (AUD2-01: `ensureGcChild()` in terrainBands.test.js, the suite is red in run-tests today).
**Next steps:** programmer: AUD2-01 one-liner + MAP-01b follow-ups (square-grid assert, timing gates to an env flag); main session: re-measure suite runtimes on an idle machine (mesh.test, gltfWrite, fbxWrite, geoLayers, questLogScreen ran 6-84 s at 95 % CPU), gpucompare after merge for PART-VIS-01 / US-055a rows if not yet run; PO: close or re-scope WS2-04 / WS2-06 / HAND-BURN-01 rows; owner: AUD-44 point-shadow p95 on high/ultra, looks for MAP-06b, DN-02, CLOUD-WRAP-01, ED-WG-01, US-068.
