# PC-B queue

## 5x queue (PC-B main session, 2026-10-09) (PC-B 5th agent, PC-A to ratify)
Rules: skill `pc-b-5x` (4 slots = clones kestrel-1..4, reviews stay on PC-A, 5th agent only when blocked/empty). Specs: `docs/sprints/sprint-8-queue.md` `### <ID>` + the architecture sections named there, or the backlog row named. Work each slot top-down; skip a blocked item and note why in the lane file. Every engine item ends in `arch-review`, UI/content in `po-review` (owner look). Refilled 2026-10-09 after a full gate batch shipped nearly all of S8-B1-01..20 and S8-B2-01/02/09/11/12a/12b/13/14/14b/15/16/20 + ALPHA-01e/01f a-d; this list is what verifiably remains (checked against `git log origin/pc-b origin/pc-b2 origin/master`).

**kestrel-1 - B1 game hooks (`main.js` owner)**
1. `S8-B2-13b` NEEDS B1-main (ripples, pc-b2 897ccb8, lands after the B2 gate): `createRipples()` at boot, `fb.ripples = it`; dev hook `__kestrel.ripple(x,y,amp)` -> `ripples.add(x,y,amp,timeSec)` (main.js:406 still calls the removed `world.water.addRipple`); US-055b splash-entry `add`. Spec: architecture.md 38.14 rework note. Files: `game/js/main.js`. Ends: arch-review.
2. `S8-B2-12c` NEEDS B1-main, after kestrel-4 #1 ships: rename the dev param `?clouds=` -> `?cloudshadow=1` (new uniform name). Spec: architecture.md 38.13/38.16a rework note. Files: `game/js/main.js`. Ends: arch-review.
3. `US-079b0` Engine seams: hidden voxel + runtime interactables - `VoxelPool` skips an entity with `components.voxel.hidden===true` in both collect branches; `World.addInteractable(spec)`/`removeInteractable(key)` for runtime-added lootable corpses, found by `findInteractTarget`. Spec: backlog.md `### US-079b0` (~line 1293), architecture.md 37.16.1. Files: `engine/render/voxelPool.js`, `engine/world/World.js` + their tests. ~0.3 d. Ends: arch-review.

**kestrel-2 - B1 GPU spine (no `main.js`)**
1. `S8-B2-13b` NEEDS B1 (pc-b2 897ccb8, lands after the B2 gate): `wg/passWater.js` drop the `RIPPLE_MAX`/`packRipples` imports, call `p._fb.ripples.packInto(timeSec, this.rip32)` (8x4), write `rippleGlyph`/`rippleGain`/`ripple[]` words; then delete the two compat shims (`engine/world/water.js RIPPLE_MAX`, `waterLook.js packRipples`). Spec: architecture.md 38.14 rework note. Files: `engine/render/gpu/wg/passWater.js`, `engine/world/water.js`, `engine/render/waterLook.js`. Ends: arch-review.
2. NEEDS B1 from `S8-B2-12c`+`S8-B2-20b`, sequenced after kestrel-4 #1 and #2 both ship: `wg/passLight.js _uploadLight` copies the reworked cloud-drift/`cloudShadeQ` fields and the AO vec4 into the new `LIGHT_BLOCK` layout (words move per 38.13/38.16). Spec: architecture.md 38.13 + 38.16. Files: `engine/render/gpu/wg/passLight.js` + test. Ends: arch-review.
Only 2 ready items this refill - S8-B1-06/07/08/11/12/14/19, the wind/sway host wiring and ALPHA-01f (b)/(c)/(d) host wiring are all already shipped (checked git log); no other open wg/** work found.

**kestrel-3 - B2 engine/mesh/** + new wgsl modules**
1. `QUAT-LOD-01` part 2: runtime distance switch to the `lods` LOD1 mesh for mesh instance groups, near-LOD0 cap (LOD1 assets + `lods` meta landed part 1, pc-b2 728d90f/4d17347). Spec: backlog.md `| QUAT-LOD-01` row (~line 296) AC 2-4. Files: `engine/mesh/**`. Ends: arch-review (perf before/after at `?pose=roadSouth` run by the main session, not this slot).
2. `PCB-PO-SHADOWLIST-01` ALPHA-01f (c) test gap: add a direct assert that `shadowList.js`'s `buildShadowList` itself emits `flags=0` (not `DRAW_FLAG_ONE_PART`) for a masked-range instanced-group shadow item - today only exercised indirectly via `passShadow.test.js`'s hand-set `it.flags=0` fixture. Spec: `docs/lanes/pc-b2.md` GAP note on the "ALPHA-01f host b/c/d" arch-review entry. Files: `engine/mesh/shadowList.js`, `shadowList.test.js`. ~0.2 d. Ends: arch-review.
Only 2 ready items this refill - ALPHA-01f (a-d) and the ALPHA-01e nit are all shipped; S8-B2-03/04/06/07/10 stay ARCH-NOTE NEEDED (skip); species switch stays owner-blocked (LOD1 pick is now recorded, forestWalk tri budget still open).

**kestrel-4 - B2 other WGSL modules + importer/tools**
1. `S8-B2-12c` cloud-shadow rework: drift from `look.clouds` (`cloudDriftOffset`), `look.clouds.shadow` via `setLook`, `cloudShadeQ` along the sun ray to `deckH`, `LIGHT_BLOCK` appends `cloudA/cloudB` (drop word 30 + word-316 `cloud`), render reads no `engine/world`. Spec: architecture.md 38.13 / 38.16a. Files: `engine/render/cloudShadow.js`, `engine/render/lighting.js`, `engine/render/gpu/wgsl/light.wgsl.js`, `common.wgsl.js`. Ends: arch-review. Then its `NEEDS B1` (passLight for kestrel-2 #2, `?cloudshadow=1` for kestrel-1 #2).
2. `S8-B2-20b` horizon-AO rework, strictly after #1, same files: tap radius in metres -> cells (`rc` from `radiusM*planeDistY/dist`, clamp 1..maxCells), `ao` vec4 appended after the 38.13 fields (drop word 31), `look.ao` via `setLook`. Spec: architecture.md 38.13 / 38.16. Files: `engine/render/horizonAo.js`, `engine/render/lighting.js`, `engine/render/gpu/wgsl/light.wgsl.js`. Ends: arch-review.
3. `PCB-PO-WG5A-01` WG-5a GL-deletion prep: move the 4 blocking constants/strings out of the glsl files flagged "STILL REACHABLE" in `docs/test-reports/WG-5a-plan.md` - `MAX_SUB` out of `glsl/resolve.frag.js` into `wgsl/resolve.wgsl.js`, `MAX_SUB` out of `glsl/shade.frag.js` into `wgsl/shade.wgsl.js`, `meshFragSrc` out of `glsl/mesh.frag.js` into wherever `wgsl/raster.wgsl.test.js` needs it, `spritesFragSrc` out of `glsl/sprites.frag.js` into wherever `wgsl/sprites.wgsl.test.js` needs it; re-point each listed importer; do not delete the glsl files yet (leave `common.js`'s `SKY_LUT_N`/`GLSL_VERSION`/`PRECISION`/`CELL_RAY_PITCHED` - it also feeds `wg/passShade.js` - for a follow-up). AC: re-run `node tools/wg5a-plan.mjs`, these 4 files no longer show "STILL REACHABLE"; run-tests green. Files: `engine/render/gpu/glsl/{resolve,shade,mesh,sprites}.frag.js`, `engine/render/gpu/wgsl/{resolve,shade,raster,sprites}.wgsl*.js`. Ends: arch-review.
Skip EMIS-03b/EMIS-04 (owner glow-strength pick still pending, EMIS-00 mockup) until the owner picks.

**Blocked/held (checked, not queued):** EMIS-03b/EMIS-04 - owner glow-strength pick (EMIS-00 mockup) not done. Chest placement, TwistedTree LOD0 import look / QUAT-TREES-01 leaf look - owner decision pending. S8-B2-03/04/06/07/10, ME-20c - `ARCH-NOTE NEEDED`, no note written yet. `OWNER-WALK-FIXES` - trigger = owner reports, no code before that. PC-A-only rows (US-070b, US-026/027/038/046/049) left alone. D-050 hold stays in force for any new S8-B2 story PC-A hasn't reviewed.

**Held / owner:** D-050 hold unchanged: PC-A reviews no NEW S8-B2 story until the still-open batch-12/13 re-reviews land; B2 keeps building, unreviewed commits stay off master. Owner: LOD1 pick is now recorded (Pine 35% / CommonTree 25% / TwistedTree 15%, 2a07a2b) - forestWalk tri budget measurement still open before the species switch. Glow strength (EMIS-00), chest placement, and title-menu/glow-light/squares looks still await the owner (PC-B handoff 2026-10-09).

---

Updated 2026-10-06 by the PC-A main session. **Read this first, then `AGENTS.md` / `CLAUDE.md`** (DeepSeek trial agents: also `DEEPSEEK.md`, which limits you to 4 trial items). It replaces the long QUEUE blocks at the top of `docs/backlog.md`; story details stay in the backlog rows and `docs/architecture.md`.

## Current PC-A handover (2026-10-07 evening; owner: WG first, parallel lanes)

**The queue is now split into lanes: B1 `docs/lanes/pc-b1.md` (WebGPU spine, branch `pc-b`), B2 `docs/lanes/pc-b2.md` (WGSL modules, worktree `../game_project_b2`, branch `pc-b2`), C `docs/lanes/pc-c.md` (Codex, branch `pc-c`).** Read skill `parallel-lanes` first. This file's older ordering (Quaternius first) is superseded: WG chain first; Quaternius/content rows moved to lane C; MESH-INST-01/MESH-SHADOW-02 to lane B2.

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

- **US-079b fixes** (ARCH CHANGES 2026-10-06, see the row): reset frame/t/loop on every clip change + elapsed-ms -> frame for `die`/`sink` (Node test: die at 250 ms = frame 2, t 50); store/restore/save `homeZ` so a respawned boar is not 0.3 m low. Then a fresh opus re-review of that diff only. (DeepSeek OK)
- **CLOTH-DRAPE-01** real hanging balloon cloth in the stairwell: the exact `cloths[]` entry is in the row (anchor on step I lip, 8x10 nodes, pins, holes, 2 step-column colliders). Mesh route walk only (dda is frozen). Owner look from the ground and steps H/I. (DeepSeek OK)

- **ED-TERRAIN-1c** editor terrain brush (raise/lower/flatten/smooth/paint, radius+strength, ring cursor, one undo per stroke, save `content/terrain/<key>.edits.json` + manifest): engine steps 1a/1b are ARCH OK with fixes; the exact API to call is at the END of the ED-TERRAIN-1 row (load -> setEdits, per dab applyDab + rebakeRect, stroke end refreshTerrainScatter, undo via sampleDh/sampleType snapshots, save editLayerToJSON). (DeepSeek OK, tools/editor)

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
