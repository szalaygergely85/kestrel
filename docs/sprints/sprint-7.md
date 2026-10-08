# Sprint 7 (planned 2026-10-07 night, manager + PO; owner asked "plan more")

Owner: Owner (goal), Product Owner (stories/acceptance), Manager (scope). Basis: D-044 (full WebGPU, no new GLSL), D-045 (ended; no threshold widening, D-039 known-FAIL rule only), D-041/D-042 (Quaternius full detail, ASCII stays), D-043 (shadow maps default), owner idea 2026-10-07 (quality presets: Low for the Intel Arc iGPU, Ultra for the RTX 4060), skill `parallel-lanes` (lanes B1 / B2 / C, PC-A reviews/gates/merges).
Length: 1-2 weeks. Every lane has a numbered NEXT QUEUE in its lane file (`docs/lanes/pc-b1.md`, `pc-b2.md`, `pc-c.md`, section "SPRINT 7 NEXT QUEUE"); this file is the overview.

## Goal
**WebGPU parity + a look-good Quaternius forest + presets + editor mesh placement.**

## Sprint stories (headline items; full order and blockers in the lane files)
| # | ID | Lane / owner | Depends on | Gate | Done when |
|---|---|---|---|---|---|
| 1 | WG-3b..WG-3f (+ carry-overs 23a/24a, UI-PLATE-01 AC2) | B1 (Claude, PC-B main tree) | B2 WG-3d 24b fix before the shadow step | gpucompare per step, same-machine baseline, no PASS->FAIL, PC-A arch-review per step | `?backend=webgpu` full gpucompare PASS set = WebGL2 on PC-B and PC-A; `rt.gpuActive` on WebGPU |
| 2 | TREES-LP-b + TREES-LP-c (engine feed) -> QUAT-TREES-01 + QUAT-GROUND-01 (content) | B2 engine feed, then C content | B2 -> C; ALPHA-01b JS + ALPHA-01c WGSL for leafy crowns | arch-review (B2), owner look at `?pose=roadSouth` + forest walk (C) | Quaternius trees and ground cover at full detail in the overworld; F3 p95 at roadSouth not worse than the MESH-PERF-01 "before" row |
| 3 | GFX-01 + GFX-01w + GFX-02 + GFX-03 + GFX-04 (quality presets) | C (data + UI), B2 (engine knobs), B1 (main.js wiring + auto-pick), PC-A (gate) | owner answers 1-4 below; GFX-03 before GFX-01w | Node tests per part; PC-A per-preset gpucompare spot check (GFX-04); owner look at Low on the Arc and Ultra on the 4060 | a first-time player gets an auto-picked preset, can change it in Settings, and it is remembered; `?quality=` overrides |
| 4 | ED-MESH-01e -> 01f -> MESH-SCALE-01 -> 01g | B1 (01e engine hook), C (01f/01g editor), B2 (MESH-SCALE-01) | 01e before 01f; MESH-SCALE-01 before 01g | arch-review (01e, MESH-SCALE-01), PO review + owner editor check (01f/01g) | the owner places, drags (live), rotates and scales Quaternius meshes in the editor and they save, collide and render in the game |
| 5 | MESH-BIN-01 + MESH-LOAD-01 | B2 | MESH-FULL-01 (done); no C re-import while MESH-BIN-01 is open | arch-review, suites, `gen-mesh-colliders --check`, gpucompare unchanged | mesh payload ~10x smaller on disk and in git diffs; far meshes load lazily, no hitch > 50 ms when walking roadSouth -> forest |
| 6 | M4 openers, game side only: US-089a, US-090a, US-092a, US-096a (+ US-112a demo bundle) | C (pure sim/data/view modules + Node tests); main.js hooks = `NEEDS B1` rows (US-089w etc., next sprint) | designer (title + chest + item-get card), writer (objective/menu/demo text) on PC-A first | PO review (sonnet; opus for the owner-visible title menu) | each module has Node tests and a dev harness or preview; nothing wired into main.js yet unless B1 had time |
| 7 | MAP-01a..d Chart v2 (live in-lore world map on `M`; owner 2026-10-07; 01e minimap = owner question) | PC-A designer+writer (01a), C (01b/01c; 01d sprint 8) | 01a before 01c; 01b parallel; 01d after 01c + US-089a | PO review (opus, owner-visible); real-GPU screenshot 400x150 | `M` shows the baked world chart with the live player arrow |

Stretch / later in the sprint: WG-4a / WG-4b kernels (B2) + host side (B1), ALPHA-01b/c, EP-DESKTOP-SPIKE (C, after WG-3f per D-044 item 6), PREC-01a.

## PC-A work this sprint (review / plan / gates / merge)
- Batch reviews (skill `arch-batch-review`), opus; fable only for WG-4a first review.
- GFX-04 per-preset gpucompare spot checks on the Arc; MESH-PERF-01 full-detail "before" numbers (bar for WG-4c); OWNER-LOOK-ROADSOUTH with the owner.
- Designer (opus) ahead of C: `uiStyle.settings` Quality row, title/menu style (US-090a), chest model + open clip + item-get card (US-092a). Writer (opus): preset labels/descriptions, menu labels, objective texts (US-096a), itch.io page text (US-112b).
- Merges pc-b + pc-c -> pc-a -> master (tests + check-deps + gpucompare), skill `pc-a-merge-master` (write it at the first merge).

## Owner decisions needed (open)
1. **DECIDED (owner 2026-10-07): Ultra = rays 4** (4x4 = 16 sub-samples per cell; the engine default today is rays 2, so Medium and High keep 2 and Low uses 1). The owner liked rays 4 on the RTX 4060. Cost: G-buffer = rays^2 x the cell grid (rays 4 at 400x150 = 1600x600 = 960,000 samples per frame); raster pass is the biggest GPU cost, so GFX-04 must time Ultra on the 4060 and keep Arc/Low at rays 1. Only `?gpucompare=1` forces rays 1.
2. **Low = 160x60:** D-025 made 160x60 dev-only for players. Allow it for the Low preset (amend D-025), or make Low = 240x90 with no shadows? **DECIDED (owner 2026-10-07): Low = 240x90; shadows are a separate Off / Low / Mid / High setting.**
3. **Preset names:** plain Low / Medium / High / Ultra, or themed names (writer proposal)?
4. **Auto-pick:** a ~3 s benchmark on first launch (behind the loading card) is OK? Re-run only from Settings ("Detect again").
5. **Unverified third-party packs in the public repo** (Ruins, Voxel Pack, Cozy Nature; StickyBizcuit custom terms; LICENCE-AUDIT-01): keep while evidence is collected, restrict (git-ignore + local only), or remove? (architect asked the manager; needs the owner). **DECIDED (owner 2026-10-07, D-046): KEEP in the public repo for now; release/demo builds exclude them until licence evidence is on file (architect recommendation, to be confirmed before US-112).**
6. **Backlog rows to drop/archive:** wait for lane C's BACKLOG-TRIAGE recommendation column, then the owner signs off in one pass. PO candidates: archive built editor rows (US-031..034, US-063/064/066/067); drop/merge US-046, US-049 (superseded by WG-5a), US-070a/US-073 (superseded by shadow maps + WebGPU), US-121/124/126/127 (lighting wish list, re-open after WG-5), US-140, US-075/076 (MCP/AI chat).
7. **Browser demo needs WebGPU** (D-044): the itch.io demo (US-112) runs on Chrome/Edge only. OK, or pull EP-DESKTOP forward for the demo?
8. **Binary mesh files in git** (MESH-BIN-01): plain binary in the repo (small, not diffable) is the plan; Git LFS only if the owner wants it.

## Rules carried over
- No new GLSL (D-044). New render features WGSL-first after WG-3f. JS twin = oracle. Never widen a gpucompare threshold; only D-039 known-FAIL baselines for new content.
- One writer per file (parallel-lanes). C never edits `main.js`, `engine/render/**`, `docs/backlog.md`, `design/palette.js` (ask). B2 never edits `wg/*.js`, `main.js`, `capture-browser.mjs`, `backlog.md`.
- No silent asset changes: LOD1 / decimation only via an owner preview.
- Gates/benches one at a time per machine; only B1 runs gpucompare on PC-B.

## Review
See "## Review 2026-10-08 (PO)" at the end of this file (covers sprint 6 leftovers, sprint 7 and sprint 8 so far).

## Owner decisions 2026-10-07 (D-046, D-047)
- Presets: Low / Medium / High / Ultra; Low = 240x90; rays 1 / 2 / 2 / 4; shadows Off / Low / Mid / High (own setting).
- Demo: WebGPU-only, web (Chrome/Edge) + Electron desktop.
- Binary meshes: plain files, no Git LFS.
- Auto-pick: lookup + ~3 s benchmark, overridable; GFX-02 also adds a runtime adaptive step (grid size is the dynamic-resolution knob via engine.setGrid).
- Third-party unverified packs: keep in repo (D-046), exclude from release builds until licence evidence is on file.
- Still open: which US rows to drop (see docs/backlog-triage-sheet.md).

## Review 2026-10-08 (PO)
Scope: work landed 2026-10-06..08 (sprint 6 boar-demo leftovers, sprint 7, sprint 8 so far). Sources: docs/test-reports/batch-review-2026-10-08.md (architect verdicts 1-13, PO verdicts 1-5b, GFX-04), docs/lanes/pc-b1.md, pc-b2.md, pc-c.md, D-044..D-049. Claims-only: I ran nothing; verdicts rest on the architect text and lane reports.
Where things live: **master** = d1d6f23 (pc-b through WG-4b, MESH-SHADOW-02, ALPHA-01b) plus earlier pc-c modules (US-089a 20a20b4, US-096a 24ec1d0). **pc-a** additionally has pc-c through S8-C-03/S8-C-17 (merge 43e6a82) and the designer chest/item-icon/props sets (19cd5d1, f6a20b1); push to master pending. **pc-b only** (not merged, blocked on the GFX-02 fixes): GFX-01w, GFX-02, ALPHA-01c, ALPHA-01d, PREC-01a, MESH-SHADOW-02 rework, WG-4a fixes, WG-4b follow-up c. **pc-b2 only:** MESH-SCALE-01, MESH-BIN-01, MESH-LOAD-01, TREES-LP-c, S8-B2-01..09 work.

### Done (verdict OK)
- **WebGPU parity (sprint-7 goal 1): DONE.** WG-3b..3f + device follow-ups ARCH OK, PO OK; WebGPU = WebGL2 140/6 on the 4060; Arc 137/9 with 4 rows recorded as per-adapter known-FAIL (D-048). WG-4a compute cull + WG-4b shadow-caster cull ARCH OK (master), WG-4a fixes + WG-4b follow-up c ARCH OK (pc-b). PREC-01a camera-relative origin ARCH OK (pc-b; 4060 148/2; Arc confirmation pending, PC-A). Human look not done yet (owner to-do).
- **Presets (goal 3): mostly built, not shipped.** GFX-01a data/resolver PO OK; GFX-03 engine knobs ARCH OK; GFX-01w wiring PO OK (pc-b); GFX-04 partial (per-preset gpucompare 141/5 on all 4 presets; Arc route-walk p95 measured under load). GFX-02 auto-pick: ARCH CHANGES open.
- **Editor mesh placement (goal 4): partial.** ED-MESH-01b/c/d + polish + H help + drag-visible fix PO OK; MESH-SCALE-01 PO OK (pc-b2); S8-C-20a .vox import verification PO OK. ED-MESH-01e (engine hook), 01f (live drag), 01g / S8-C-16 (scale field) NOT done.
- **Mesh pipeline (goal 5): built, held.** MESH-SHADOW-02 rework PO OK (-41 % shadow tris at roadSouth); ALPHA-01b/c/d PO OK (WebGPU only, no real foliage flagged yet); TREES-LP-b/c ARCH OK; MESH-BIN-01 and MESH-LOAD-01 ARCH CHANGES open.
- **M4 openers (goal 6): all modules built, none wired.** US-089a save data, S8-C-02 play-time, US-096a quest sim, S8-C-12 quest-log view, US-090a + S8-C-03 title menu (PO OK 5b, designer + writer styling adopted), US-112a demo bundle tool, S8-C-17 content lint (D-049). US-092a chests not started (designer assets landed only now, 19cd5d1).
- **Chart (goal 7): bake tool only.** MAP-01b PO OK; MAP-01a design still `todo` (PC-A designer + writer); MAP-01c/01d not started.
- **Stretch:** EP-DESKTOP-SPIKE PO OK as spike; S8-B2-07 LOD dither PO OK (module only); S8-B2-09 HZB module ARCH OK; BUG-RTS-002 done.
- **Sprint 6 boar demo leftovers:** no new code; the owner demo walk (sword L/R, fireball tap/hold, loot, `I` pack + eat meat) is still an open owner check (walk-test B).

### Not done
QUAT-TREES-01 + QUAT-GROUND-01 (the "look-good Quaternius forest": blocked on ALPHA-01e, which waits behind B2's open fixes); ED-MESH-01e/f/g; GFX-02 merge and GFX-04 4060 numbers; MAP-01a/c/d; US-092a/S8-C-06/S8-C-07 chests + item-get card; every main.js wiring hook (S8-B1-01..04, S8-B1-15/16); WG-4c owner walk gate; PREFAB-SEAM; BUG-SHADOW-ONEPART-01.

### Bugs and risks found
1. GFX-02: Intel device-id regex misses the padded ANGLE label (Arc on a WebGL-only browser locked to `low`); AutoBench untested. Open since cb0bca2 - **blocks the pc-b merge**.
2. MESH-BIN-01: a corrupt `.mesh.bin` count allocates unbounded / loops (no fuzz test); mesh-import skill stale.
3. MESH-LOAD-01: one failed fetch makes a mesh invisible for the session (no retry), no `validateMesh` on decode, engine reads URL/window (`loadPack.js`), spawn area pops in (no `prefetchNear`).
4. BUG-SHADOW-ONEPART-01: multi-range meshGroups (trees) cast only range 0 shadows on GL, JS twin and WebGPU.
5. S8-B2-03 LRU leaks the instanced `voxelCache` GPU buffers; S8-B2-05 added a second, wrong-axis wind source; ME-20a and S8-B2-01 regexes missing backslashes; S8-B2-02 exits 1 instead of report-only.
6. Look risks (unverified by a human): wake eyelid blink possibly invisible under WebGPU; title-menu confirm screen draws inconsistently on real GPUs (NEEDS B1); ALPHA-01c/d leaves never seen live; Electron boot shows the browser file notice and starts at 160x60.
7. Perf: Arc Low/Medium ~33 ms p95 (30 fps) on the M1 route, measured under load; Ultra 50 ms. Re-measure idle.
8. Flaky-under-load suites: passRaster, terrainStroke, scatterFeed, colliders, barrier-refit heap (all pass alone).
9. Process: B1 shipped ~40 commits without the 2 small GFX-02 fixes; B2 started 5 new stories under a STOP. Result: two lanes' work is stranded off master.

### MISSING TO BE PLAYABLE (real game `game/index.html`, today)
Walking the loop wake -> lamp -> breach -> sword -> beasts -> waystone in index.html: wake (eyelid + `KESTREL` title card), lamp, breach, sword, boars, loot, `I` inventory, eat meat, hearts and death card all work (master). What the owner **cannot** do yet:
- **Start from a menu / continue a game.** Only the M1 title card shows. `titleMenu.js` (US-090a + S8-C-03) is a preview page only (`game/js/ui/titleMenu.preview.html`). Hook: S8-B1-03.
- **Save, quit, reload and keep progress.** `saveState.js` (US-089a, master) + play-time (S8-C-02, pc-a) are Node-tested modules only. Hook: S8-B1-01 (autosave 60 s + on waystone touch, load at boot).
- **Use the waystone.** It is a prop; touching it does nothing (no save, no heal, no respawn point, no quest step). Save part = S8-B1-01; heal + respawn-at-last-waystone after death has **no story yet** (PO to add a C sim row + B1 hook).
- **See what to do next.** `quest.js` + `m1.quest.json` (US-096a, master) and `questLog.js` (S8-C-12, preview only) exist; objective texts are written (docs/story.md) but still placeholders in the JSON. Hooks: S8-B1-02 + paste texts (S8-C-11 remainder).
- **Open a chest and get an item card.** Designer assets on pc-a (chest.js, chest.html, item-icons.html); sim/view S8-C-06 + S8-C-07 not started; hook S8-B1-04.
- **Pick quality/shadow presets in Settings.** Built on pc-b (GFX-01w/02), not on master until the GFX-02 fixes land.
- **Read a live map.** `M` shows the static M1 chart; live chart = MAP-01a (designer, todo) -> S8-C-14 -> S8-B1-15; fog of war S8-C-15 -> S8-B1-16.
- **Walk a leafy Quaternius forest.** Trees still the old set; ALPHA-01e (B2) -> QUAT-TREES-01/QUAT-GROUND-01 (C).
- **M4 content: first tool item, keys, a small dungeon room with a puzzle.** No stories in the sprint-8 queue at all (needs PO + manager epic planning, S8-A-18 scope cuts).

### Top-10 gaps, ranked (what the owner hits first), who unblocks, rough effort
| # | Gap | Unblocks | Effort |
|---|---|---|---|
| 1 | No title menu (New / Continue / slots) in the game | B1 S8-B1-03 (+ fix confirm-screen draw risk) | ~0.5-0.75 d |
| 2 | No save/load/autosave | B1 S8-B1-01 (+ S8-C-02 tick hook) | ~0.75 d |
| 3 | Waystone does nothing (save point, heal, respawn) | B1 S8-B1-01 (save) + NEW row C sim + B1 hook (heal/respawn) | ~0.5 d extra |
| 4 | No objective line / quest log | C paste S8-A-11 texts (~0.25 d) + B1 S8-B1-02 | ~0.75 d |
| 5 | Settings presets stranded on pc-b | B1 GFX-02 two fixes, then PC-A merges pc-b | ~0.25 d + merge |
| 6 | No chests / item-get card | C S8-C-06 + S8-C-07, then B1 S8-B1-04 | ~1.75 d |
| 7 | Live map missing | PC-A MAP-01a, C S8-C-14, B1 S8-B1-15 | ~2.25 d |
| 8 | Forest looks unfinished (no leafy Quaternius trees) | B2 5 open fixes -> ALPHA-01e; C QUAT-TREES-01/GROUND-01 | ~3 d |
| 9 | WebGPU look unverified (blink, shadows, water, leaves) | Owner walk-test; B1 fixes what fails | 0.5 d owner + ? |
| 10 | No M4 tool / key / dungeon room | PC-A PO + manager epic, then C/B1 | epic, > 5 d |

B1 is the bottleneck: gaps 1-6 all end in a `main.js` hook that only B1 may write (~2.75 d of hooks in total). Recommendation (needs manager OK): B1 does the playable hooks before PREFAB-SEAM, ED-MESH-01e, ONEPART and the S8-B1-06..14 engine items. Order: top of docs/sprints/sprint-8-queue.md.

### Owner walk-test ask
Please run **docs/owner-walktest-2026-10-08.md** (sections A-C, about 45 min; report each line `ok` / `not ok + one word`). Most urgent: A "WebGPU vs WebGL2 look", A "eyelid blink", A "title menu" (use `?backend=webgl2` on the Arc), B "earlier mesh to-dos / boar demo walk", C "GFX-04 p95 on an idle Arc". Also answer the BACKLOG-TRIAGE sheet and the cog-currency question listed there.
