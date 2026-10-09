# PC-B queue

## 5x queue (PC-B main session, 2026-10-09) (PC-B 5th agent, PC-A to ratify)
Rules: skill `pc-b-5x` (4 slots = clones kestrel-1..4, reviews stay on PC-A, 5th agent only when blocked/empty). Specs: `docs/sprints/sprint-8-queue.md` `### <ID>` + the architecture sections named there, or the backlog row named. Work each slot top-down; skip a blocked item and note why in the lane file. Every engine item ends in `arch-review`, UI/content in `po-review` (owner look). Refilled a second time 2026-10-09 (PC-B PO, owner-authorised) after the ripples/cloud/AO/ortho-a/ortho-c/QUAT-LOD-01/WG5A batch; every item below was checked against the code (grep) and the lane logs, not only the old list. Ownership: kestrel-1 = `game/js/main.js` + game hooks + `tools/editor`; kestrel-2 = `engine/render/gpu/wg/**`, GpuDeviceWebGPU, MeshBuffers, capture tools; kestrel-3 = `engine/mesh/**` + new wgsl/engine modules; kestrel-4 = other wgsl modules + importer/tools. Two slots never share a file.

**Done 2026-10-09 (do not queue):** S8-B1-10/18/04 fixes, SWAY host follow-up (INST_FLAG_SWAY is set in `engine/mesh/scatterFeed.js:69`), S8-B1-11 + 11b, ALPHA-01f-fix + fix2, PCB-PO-SHADOWLIST-01, PCB-PO-WG5A-01, S8-B2-12c, S8-B2-13b (both halves), S8-B2-20b, QUAT-LOD-01 part 2, US-079b0, US-068a, US-068c, ME-14, ME-17 (code; 27.8 table = main session `?bench=1`). Also verified done in code/lanes (PC-B PO, 2026-10-09): S8-B1-01/03/09/13/14/15/16/20, S8-B2-03 (lazyMesh.evict), 05/06/07 (lodDither, sway), 15, 16 (hullProxy), BUG-WEBGPU-EYELID-01 (main.js:1683), US-091a2/US-079b death+corpse lifecycle (beastSim), chest hook, map fog hook, EMIS-01a/01b, leaf_softtest palette cleanup.

**In progress:** US-068b1 (kestrel-4), S8-B1-11c (kestrel-2), S8-B2-10 architect note 38.20. **Blocked (not queued):** US-068d (after ED-WG-01), EMIS-03b/04 (see EMIS note under kestrel-3), chest placement, TwistedTree, ME-20c (note 38.18 only on origin/pc-a), ME-19 (D-052), QUEST-MARK-01w + QUEST-CHAIN-02 content (PC-A decisions: boar count/anchors, note texts, owner '!' glow rework), crafting UI (recipes are data only), Settings shadows rows, QUAT-TREES-01 / QUAT-GROUND-01 (owner look + PC-A supply of weights).

**kestrel-1 - game hooks + editor (`main.js`, `tools/editor` owner)** (PC-B PO, owner-authorised 2026-10-09)
1. `WAYSTONE-01w` wire the shipped waystone sim: `game/js/quest/wire/waystone.js` registers on the seam (`prop:touched` waystone -> `createWaystone(...).touch` = heal + one save request + toast; `player:died` -> respawn; `onRespawn` returns the point; main.js already routes `respawnPose: () => gameHooks.respawn()`). Spec: `docs/sprints/sprint-8-queue.md` `### WAYSTONE-01w`, `docs/test-reports/WAYSTONE-01.md`, `game/js/quest/sim/waystone.js` (`createWaystone(world, player, {waystones, spawn, requestSave})`), `docs/story.md` "Sprint 8 texts". Extra ACs: the waystone ids/spawn come from content (no hard-coded coordinates); with `?save=0` or capture/bench modes nothing registers; toast text is the story.md line, if no key exists write `NEEDS WRITER:` (<= 38 chars), do not invent. Files: `game/js/quest/wire/waystone.js` (+ test), 2-4 lines in `game/js/main.js`. Ends: po-review (owner look: touch stone, take damage, die, respawn on the stone with full hearts).
2. `CREDITS-MOUNT-01` mount the shipped Credits view in the title menu: a Credits row/action in the menu data -> `titleMenuHost.js` shows `createCreditsView(inventory, {style: ASSETS.uiStyle.menu})`, Up/Down/Enter/Home/End page, Esc = Back to the menu card (same pattern as `onSettings`). ACs: Node test with a fake adapter (open, page, Back returns, sim frozen while open as for Settings); capture/bench/compare/`?at=` modes unchanged. Spec: `docs/lanes/pc-c.md` S8-C-04 Credits entry (NEEDS B1 line), `game/js/ui/creditsView.js`, `game/js/titleMenuHost.js`. Files: `game/js/titleMenuHost.js` (+ test), the title-menu row data it reads, `game/js/main.js` (mount only). Ends: po-review (owner look on WebGPU and Arc webgl2).
3. `ED-GROUP-1c` prefab UI in the editor (= `S8-C-20b`; PREFAB-SEAM got ARCH OK 2026-10-09): save the selected group as a prefab, list prefabs in the library, place one (one undo step), `placePrefabItems` never mutates. Spec: `docs/sprints/sprint-8-queue.md` `### S8-C-20` (C-20b part), architecture.md 38.11. Files: `tools/editor/*` (+ tests, `groupOps.js`, `panel.js`). ~0.75 d. Ends: po-review (owner editor look).
4. `BINDINGS-WIRE-01` gameplay keys read through the shipped table: `main.js` builds `createBindings(saved)` (`game/js/quest/input/bindings.js`) and looks every existing keyboard action up through it; saved table persists with settings. ACs: Node test that the default table resolves each action to exactly today's key (no behaviour change, golden list of actions in the test); unknown/conflicting saved entries fall back to defaults; gamepad table stays empty; no rebinding UI (separate story). Spec: `docs/lanes/pc-c.md` S8-C-05 entry. Files: `game/js/main.js`, `game/js/quest/input/bindings.js` call sites + test. ~0.5 d. Ends: arch-review.

**kestrel-2 - B1 GPU spine (no `main.js`)** (PC-B PO, owner-authorised 2026-10-09)
1. `S8-B1-11c` in progress (see above).
2. `SWAY-GC-01` gpucompare coverage for wind sway: INST_FLAG_SWAY is now set on swaying species, so the wind uniform path has real content. Add 2 rows to `game/js/dev/modes/gpucompare.js` `runs`: `swayCalm` (wind off, must stay bit-identical to the same pose without the flag path) and `swayWindy` (fixture sets `world.wind` strength > 0 only inside the gpucompare mode, pose on a sway species near the road). ACs: no previously passing row changes; `swayWindy` JS twin vs WGSL raster PASS, or recorded as a new known-FAIL with metrics per D-039 (never widen thresholds); both rows added to the per-machine baseline via the S8-B1-13 tooling (`docs/test-reports/gpucompare-baseline-webgpu-intel.json`); gpucompare Node tests list the new row names. Spec: `docs/lanes/pc-b1.md` "wind/sway host uniforms" entry (2026-10-09, NOT DONE note), `engine/mesh/sway.js`, skill `gpucompare`. Files: `game/js/dev/modes/gpucompare.js`, gpucompare test + baseline json. ~0.5 d. Ends: arch-review.
3. `S8-B2-10-wire` passCull HZB texture wiring + occlusion counter, ONLY after architect note 38.20 exists and kestrel-4 has the `cull.wgsl.js` kernel part: `wg/passCull.js` builds the HZB (S8-B2-09 module) from last frame's depth, binds it, reports culled-by-occlusion at `?pose=roadSouth`. Spec: note 38.20 + `sprint-8-queue.md` `### S8-B2-10`. Files: `engine/render/gpu/wg/passCull.js` (+ test). Ends: arch-review.
Only 1 ready item besides the in-progress one; no other open wg/** work found. If kestrel-2 idles, main session may start the 5th agent.

**kestrel-3 - B2 engine/mesh/** + new modules** (PC-B PO, owner-authorised 2026-10-09)
1. `EMIS-03a-1` bleed JS twin (first half of EMIS-03a, new files only): `engine/render/bleed.js` `bleedCell` + `bleed.test.js` per architecture.md 38.12 (bleed pass). Constants from the owner pick recorded in `sprint-8-queue.md` "EMIS owner picks (2026-10-08)": MEDIUM = lightGain 0.8, bleedGain 1.2, haloBg 0.45, haloMin 0.08, haloR 3, ramp ` .':`. ACs: pure function, zero alloc (1e5 calls with `--expose-gc`), depth-aware weight falls to 0 across a depth step, symmetric H/V separable result equals the 2D reference within 1e-6, params exported as one frozen object. NOTE: the user brief says "owner glow pick pending"; the sprint file shows strength + hue already picked and only the quest-mark glow rework/derived-light-off questions open. Main session confirms before starting; if still pending, skip to item 2. EMIS-03a part 2 (MatF GLOW column, `rt.emissive`, `PASS_NAMES += 'bleed'`) and EMIS-03b/04 stay unqueued until part 1 is reviewed. Files: `engine/render/bleed.js`, `engine/render/bleed.test.js`. ~0.4 d. Ends: arch-review.
2. `MESH-QA-01` perf/triangle report for the species switch (owner decision pending on forestWalk tri budget): a tool `tools/mesh-tri-budget.mjs` (+ test) that, for `?pose=forestWalk` and `roadSouth`, lists instanced mesh groups in range with LOD0/LOD1 tri counts per species and the totals under the recorded LOD1 pick (Pine 35% / CommonTree 25% / TwistedTree 15%, 2a07a2b), using `engine/mesh` group data only (Node, no browser). ACs: deterministic JSON + table output; Node test on a fixture world; totals at both poses written to the end of `docs/test-reports/MESH-PERF-01.md`. Gives the owner the number the species switch waits on. Files: new `tools/mesh-tri-budget.mjs` + test (no engine edits). ~0.5 d. Ends: po-review.
Only 2 ready items; S8-B2-03/04/07 shipped (lazyMesh.evict, lodDither exist), ME-20c needs its format note first.

**kestrel-4 - B2 other WGSL modules + importer/tools** (PC-B PO, owner-authorised 2026-10-09)
1. `US-068b1` in progress; then `US-068b2` (split of 068b: GPU twin of ortho - raster depth from frag z, fog/hash cell, sprites/billboards, gpucompare pose `orthoIso`) per architecture.md 38.19 item 4. Ends: arch-review.
2. `S8-B2-10-kernel` cull.wgsl.js occlusion test + JS twin, ONLY after architect note 38.20 (the 2-phase/lag rule). ACs from `sprint-8-queue.md` `### S8-B2-10`: Node twin test = culled set is a superset-safe subset (no visible instance culled vs brute force on the bench poses); reports occlusion-culled count; kernel change gated by a uniform so occlusion-off is bit-identical. Files: `engine/render/gpu/wgsl/cull.wgsl.js` (+ test). Ends: arch-review. Pairs with kestrel-2 #3.
3. `S8-C-17b` content lint follow-ups deferred by D-049 (PC-B PO ACs): `tools/validate-content.mjs` + test add (a) every `areas.json` id used by a quest/trigger exists and vice versa has a marker, (b) every item id in recipes/chest tables/loot exists in `design/items.js`, (c) every text key the writer contract lists in `docs/story.md` "Sprint 8 texts" resolves to non-empty text <= its length limit (objectives <= 38). ACs: fixtures for each failing case (one finding per case, field path in message); real content = 0 findings; existing 75 fixtures unchanged. Files: `tools/validate-content.mjs`, `tools/validate-content.test.mjs`. ~0.5 d. Ends: po-review (tooling).
4. `WG-5a-2` GL-deletion prep part 2, after kestrel-2's `S8-B1-11c` lands (re-points `wg/passShade.js`): move `SKY_LUT_N`, `CELL_RAY_PITCHED` (and keep-or-drop `GLSL_VERSION`/`PRECISION`) out of `glsl/common.js` into a wgsl-side module, re-point all importers, re-run `node tools/wg5a-plan.mjs`; AC: `glsl/common.js` no longer reachable from any `wg/**` or `wgsl/**` file; run-tests green; do not delete glsl files (blocked by ED-WG-01). Spec: `docs/test-reports/WG-5a-plan.md`. Files: `engine/render/gpu/glsl/common.js`, `engine/render/gpu/wgsl/*`, `wg/passShade.js` (import line only). Ends: arch-review.

**Status checks left for the main session (no programmer):** `ME-12b` (code says `renderer = 'mesh'` is default; row is "moved to M3" - close it or list the `?renderer=dda` fallback wording), `BUG-FP-001` (GL-era black spawn, likely moot), `ME-15`/`ME-16` (sun shadow maps default per D-043; ME-16 point-light cube maps may be really open), `ME-18`/`ED-MESH-1` (need an architect note first), `ME-21` (needs the PO story + designer first), `US-070a/b`, `US-038`, `US-026`, `US-027`, `BUG-COORD-001` (stale-looking rows to close or re-tag), `US-079b`/`US-079c` backlog rows (status says todo; beastSim has death/corpse - mark done after a check). Cross-track and NOT for a programmer yet: `ED-WG-01` (+ `ED-MESH-1`) architect note, `US-026b`, `CO-6`.

**Held / owner:** D-050 hold stays for any new S8-B2 story PC-A hasn't reviewed. Owner: LOD1 pick recorded (2a07a2b), forestWalk tri budget measurement still open (see kestrel-3 #2). Glow-derived-light question for chests/lamp, chest placement, title-menu/glow-light/squares looks still await the owner (PC-B handoff 2026-10-09).

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

**ED-WG-01 split (PC-B architect, 2026-10-09; spec architecture.md 38.21; ED-MESH-1/1b closed as superseded by ME-19a, 1d check folded into 01c):**
- kestrel-2: `ED-WG-01a` engine `createFrameRenderer` (engine/render/frameRenderer.js + test, index.js export). Ends: arch-review.
- kestrel-1: `ED-WG-01c-baseline` first (capture the GL pick golden at ../game_project_test, 38.21 item 3). Then `ED-WG-01b` (after 01a): editor on frameRenderer + WebGPU default + overlay -> engine.ui; delete frame.js/sprites.js. Then `ED-WG-01c`: ray.js projection-helper routing + async pick + parity golden + check-deps rule. Ends: arch-review + owner look. Unblocks WG-5 (editor side) and US-068d.
- kestrel-1 later/optional: `ED-WG-01d` game main.js on createFrameRenderer (not a WG-5 prerequisite).
