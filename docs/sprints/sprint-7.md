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
(PO fills in at sprint end: done / not done / bugs found.)

### Missing to be playable (placeholder, PO fills at review)
- [ ] ...
- Owner walk-test request: (to fill)
