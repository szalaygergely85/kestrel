# PC-B queue

Updated 2026-10-06 by the PC-A main session. **Read this first, then `AGENTS.md` / `CLAUDE.md`** (DeepSeek trial agents: also `DEEPSEEK.md`, which limits you to 4 trial items). It replaces the long QUEUE blocks at the top of `docs/backlog.md`; story details stay in the backlog rows and `docs/architecture.md`.

## Rules (short)
- `git fetch origin && git merge origin/master` before each item and before pushing.
- One commit per item: code + its backlog row update. Push after each item.
- Done = the item's tests + `node tools/run-tests.mjs` all PASS + `node tools/check-deps.mjs` OK. Browser checks: `tools/serve.py <95xx>`, mesh route walk before any `game/js/main.js` push.
- Engine items (`engine/`) end in `arch-review`; content/UI items in `po-review` or an owner walk-test.
- D-039: a NEW gpucompare pose that fails only on JS/GPU precision may merge as a recorded known-FAIL; no previously passing row may regress; never widen thresholds.
- Unclear? Write `NEEDS PC-A: ...` at the end of the row (never in the ID column) and take the next item.
- Ports 9500-9999. Never stop the owner's server on 8000.

## 1. Ready now (in this order)
Done 2026-10-05/06: PROP-COLLIDE-01b, TOWER-BOULDER-01, ED-PLACE-BUG. **DeepSeek afternoon list: see `DEEPSEEK.md` (UI-XHAIR-01, READ-01, US-079b0, US-079b, Quaternius imports) - Codex takes the rest, never the same item.**
| # | Item | Spec | Ends in |
|---|---|---|---|
| 3 | **READ-01** readable notes: register `note.read`, apply `ASSETS.levelPatch.towerNotes` (design/models/notes.js), read panel from `uiStyle.note`, notes.js script tag in game + editor, update tower/content-smoke/restart tests | backlog row, design/preview/notes.html | owner walk-test |
| 4 | **UI-XHAIR-01** bigger crosshair with transparent background | backlog row | arch-review + owner look |
| 4b | **ME-19c** remove the GPU dda passes + world atlas + sun DDA (shadow maps are now the default, D-043) | architecture 37.13.2 + 37.13.5 | arch-review |

## 1b. Owner-found bugs 2026-10-06 (do first)
- **BUG-GONDOLA-FALL** (P0, Codex, physics): fell into the solid gondola and out of the world - see the row.
- **VOID-RESPAWN-01** (P1, DeepSeek OK): falling far below the world puts you back at the last safe spot.

## 2. Sprint 6 - boar demo (`docs/sprints/sprint-6.md`)
Lane A: **US-079b0** (engine: `voxel.hidden`, add/removeInteractable) -> **US-079b** (boar HP, hurt, death, lootable corpse) -> **US-079c** (fight readability, BUG-BOAR-OVERLAP) -> **US-091a1** (inventory data) -> **US-091a2** (loot on E, toast) -> **US-091b** (inventory screen).
Lane B: **HANDS-01a** (view-model model mirror + winding flip; see the 37.8a erratum about `swordForHand`) -> **HANDS-01b** (LMB/RMB input router, `?demo=0`) -> **HANDS-01c** (spell-hand idle, `handsSwapped` pose) -> **SPELL-01a** (fireball sim) -> **SPELL-01b** (fireball look).
Specs: architecture 37.16 (boar death), 37.8a (hands), 37.14 (fireball), D-040, D-042 item 2. Designer assets are on master (voxel_beast.js, items.js, spell.js, inventory_ui.js).
Two programmers at once only on disjoint files: lane A and lane B are disjoint except `sim/inventory.js` (US-091a1 vs HANDS-01b - never at the same time) and `sword.js` (US-079b before HANDS-01b).

## 2b. ART look engine (owner liked art-ref.html, D-041/D-042; architecture **37.18**) - default OFF, byte-identical until ART-ON
| Step | Who | Size | Content | After |
|---|---|---|---|---|
| ART-01a | **DeepSeek** | 0.6 d | `look.js` + `roofMap.js` + LightSet fields + `?look=` (JS only, no pixel change) | - |
| ART-04a | **DeepSeek** | 0.7 d | clouds JS twin (sky.js / fastShadeSky) | 01a |
| ART-01b | Codex | 1 d | hemisphere ambient + shadow tint in the light pass, both twins, roof texture, outdoor bit | 01a |
| ART-01c | Codex | 0.6 d | terrain hemisphere + tint, both twins | 01b |
| ART-03a | Codex | 0.8 d | haze.js + GLSL, terrain haze, edge gate | 01a |
| ART-03b | Codex | 1 d | material-path haze + glyph thinning | 01b |
| ART-04b | Codex | 0.8 d | clouds GPU + gpucompare `sky` metric | 04a |
All end in `arch-review`. ART-ON (designer colour keys + switch the default + owner look) is PC-A.

## 3. After that (or as fillers)
- **TREES-LP-a** Kenney Nature Kit Collada importer (`tools/dae-import.mjs` -> `buildMeshFromTris`; source `design/meshes/kenney/dae/`) - architecture 37.15 + D-042 item 4.
- **ALPHA-01a** alpha-cutout import + formats (architecture 37.17), then ALPHA-01b (after TREES-LP-b).
- Quaternius imports that need no cutout: dead trees, rocks, pebbles, rock paths, mushrooms, grass (architecture 37.17 list; source `design/meshes/quaternius/glTF/`).
- **ME-19d-ed** editor ray/select/pick plumbing (after PC-A's 19c/19d).

## Waiting on PC-A or the owner - do not start
- **TORCH-01b** torch pick-up - waits for HANDS-01b.
- **ENV-04** / cinematics - waits for an owner talk.
- **ED-GROUP-1**, **ED-TERRAIN-1c** - P2, after the boar demo (terrain 1a/1b are PC-A engine steps).
- **PREC-01a** camera-relative raster - after the visible-world items.
