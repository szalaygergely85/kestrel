# PC-B queue

## 5x queue (PC-B main session, 2026-10-09) - START HERE
Rules: skill `pc-b-5x` (4 slots = clones kestrel-1..4, reviews stay on PC-A, 5th agent only when blocked/empty). Specs: `docs/sprints/sprint-8-queue.md` `### <ID>` + the architecture sections named there. Work each slot top-down; skip a blocked item and note why in the lane file. Every engine item ends in `arch-review`, UI/content in `po-review` (owner look).

**kestrel-1 - B1 game hooks (`main.js` owner)**
1. S8-B1-04 chest interaction hook (~0.5 d; C deps done: S8-C-06 chest sim, S8-C-07 item-get card).
2. S8-B1-15 MAP-01c `M` toggles the chart (~0.5 d; C S8-C-14 done).
3. S8-B1-16 MAP-01d Visibility feed + saved fog mask (~0.5 d; C S8-C-15 done).
4. MESH-LOAD-01 boot `prefetchNear` call (NEEDS B1 from B2 batch 15, small).
5. S8-B1-10 device-lost card (re-scoped, 38.10c, ~0.5 d).
6. S8-B1-20 boot stage timing + loading card progress (~0.5 d).
7. `main.js` lines that other slots raise as `NEEDS B1-main:` (S8-B1-07 F3 lines, S8-B1-12 resize hook) - take them between items.

**kestrel-2 - B1 GPU spine (no `main.js`)**
1. S8-B1-06 cull batch release (38.10a) - IN PROGRESS in `../kestrel` (started before the switch; ships from there).
2. S8-B1-12 resize / DPR / fullscreen on WebGPU (~0.5 d; `main.js` part -> `NEEDS B1-main:`).
3. S8-B1-11 zero per-frame allocation in the WG loop (~0.5 d).
4. S8-B1-07 per-pass GPU timer slots (~0.5 d; F3 lines -> `NEEDS B1-main:`), then S8-B1-08 ultra step-up (~0.5 d).
5. B2 host wiring: wind/sway uniforms in raster + shadow (NEEDS B1 from S8-B2-05/06, batch 15).
6. ALPHA-01f (b) host side: `MeshBuffers` uvMask stream + pass wiring, after kestrel-3 ships the WGSL module.
7. gpucompare pose pair (owner eyes, BUG-MESH-MISSING-01): two rows `?at=1446.63,1024.64,2.02,227,1` and `?at=1448.31,1026.52,2.08,229,3`.
8. S8-B1-14 capture-browser `--route` frame-time trace (~0.75 d), then S8-B1-19 WG-5a deletion plan (~0.5 d).

**kestrel-3 - B2 masked instanced meshes (ALPHA-01f, WebGPU only, D-051)**
1. ALPHA-01f (a) JS twin - IN PROGRESS in the retired `../game_project_b2` worktree; the main session moves the diff to kestrel-3 and ships it.
2. ALPHA-01f (b) WGSL instanced mask variant (module + twin test; host side = kestrel-2 item 6).
3. ALPHA-01f (c) shadow variant. 4. ALPHA-01f (d) GPU cull / indirect args per range.
5. ALPHA-01e nit: `withCollision` name regex -> generic rule "masked + opaque ranges -> colliderParts = opaque ranges".
Species switch stays blocked on the owner LOD1 pick + forestWalk tri budget (PC-A).

**kestrel-4 - B2 modules + importer**
1. S8-B2-14 follow-up: terrain twin reads wetness (`terrainShade.js` / `TERRAIN_SHADE_WGSL`).
2. S8-B2-15 importer crease angle + vertex weld (~0.5 d).
3. S8-B2-16 convex-hull collider option for rocks (~0.75 d; `engine/physics` stays stand-alone).
4. Notes written 2026-10-09 (architecture.md 38.13-38.16), now UNBLOCKED in this order: (a) S8-B2-13 water ripples (38.14 as written by PC-B's 5th agent, PC-A ratified: ring on `world.water.addRipple`, composite-only (WaterCompositeU); NOT the `engine/fx/ripples.js` variant - ignore any older mention; then `NEEDS B1` passWater + `NEEDS B1-main` splash hook), (b) S8-B2-12 cloud shadows (38.13, split 12a light pass / 12b terrain+water consumers; LIGHT.w bits 24..31; light/shade/waterComposite WGSL + lighting.js twin; `NEEDS B1` passLight), (c) S8-B2-20 horizon AO (38.16; same files as (b), so strictly after it; `NEEDS B1` passLight). (a) and (b) both touch `waterComposite.*`: never in two slots at once. S8-B2-17 + S8-B2-18 GPU particles: **DROPPED** (38.15). Still ARCH-NOTE NEEDED elsewhere: S8-B2-03/04/06/07/10.
5. EMIS-03b / EMIS-04 only after the owner picks the glow strength (EMIS-00 mockup).

**PC-A additions 2026-10-09 (after arch batch 18; put at the TOP of the named slot, they are small):**
- **kestrel-1 #0 (do first, ~0.1 d):** gameHooks batch-17 ARCH CHANGES: bridge engine `interaction:fired {key,name}` -> `prop:touched {id:key, kind:name, x,y,z}` in `bridgeEngineEvents` + a `gameHooks.test.js` line; `emitSimple('prop:touched', id, kind)` with no 4th arg must not throw (missing `c` = 0,0,0). S8-B1-04/15/16 need it. Also BUG-NOTE-ESC-01 (P2): Esc under pointer lock closes nothing - treat `pointerlockchange` to unlocked as close for note/settings/inventory/map or show only [E] (`game/js/quest/noteRead.js:46`).
- **kestrel-2 #0 (~0.1 d):** EMIS-01b ARCH CHANGES: `VoxelPool#pushInstance` builds the light seed with strings (`x.toFixed(2)+','...`) every push; hash `Math.round(x*100)`, y, z with `Math.imul` instead, no strings (derivedLights.test.js must stay green). Also in the gpucompare pose-pair item: add the BUG-WHITE-PIXELS-01 pose `?at=1500.58,1022.77,1.80,185,-24` (holes counter, both backends), and after that repoint the `alphaLeaves` fixture to `leaf`/`leaf_dark` and delete the `*_softtest` clones (palette.js, detail-pass.js, ShadeTextures.test.js).
- **kestrel-3 #0 (~0.1 d):** stale comments `engine/mesh/DrawList.js:420` and `meshGroups.js:98` still say "nearest-64".
- Review state: EMIS-01b wiring (d5bdf6d) and S8-B1-13 (59d1db8) ARCH OK; baseline files are 4060-only (PC-A creates the Arc ones). D-051 known-FAIL rows (WebGL2 waystoneLookBack, lowpolyTrees, 4 alphaLeaves) stay in the baseline as known-FAIL; do not touch thresholds.

**PC-A batch 19 fixes (2026-10-09; do these BEFORE new items, each small):**
- **kestrel-1:** S8-B1-04 ARCH CHANGES = real soft-lock: an open item card sets `paused` (main.js ~1193) but `gameHooks.tick` only runs inside the `!paused` block, so `card.step` never runs and the card never closes. Step the card outside the paused block (like `invView`), remove it from `onTick`, add a Node test with a main.js-shaped loop (no tick while paused) that dismisses the card. Only after that -> po-review. Then the gameHooks `interaction:fired` bridge (see #0 above).
- **kestrel-2:** S8-B1-11 ARCH CHANGES: the zero-alloc test reads the heap after a forced GC, so per-frame garbage passes (verified: +200 B/frame still green). Read heap BEFORE the GC, spawn with `--max-semi-space-size=64`, assert growth < ~16 KB; keep the after-GC check as the leak check; add the allocation mutation as a must-fail self-test. Then EMIS-01b seed fix (#0 above). Nit S8-B1-06: idle sweep `for..of` over the batches Map every frame in `begin()`.
- **kestrel-3/4 (B2):** S8-B2-16 ARCH CHANGES: (1) the `colliderHull: true` data flag alone must select the hull (today a default `gen-mesh-colliders` run / re-import turns it back into the prism and `--check` fails); (2) `engine/mesh/hullProxy.test.js` takes 9.5 s (> 5 s): drop the full-content `--check` spawn at line 150; mention in the mesh-import skill that the hull is built from 18 sampled points (can be smaller than the mesh). Nit ALPHA-01f(b): `RASTER_INSTANCED_MASK_BLOCK` should share one field array with `RASTER_BLOCK`.
- ARCH OK/done: S8-B1-06, S8-B1-12, S8-B2-14b, S8-B2-15, ALPHA-01f (a)(b)(c), ALPHA-01e nit. ALPHA-01f host wiring (uvMask stream, passRaster, shadow ONE_PART fix for masked groups in `shadowList.js`, gpucompare row) = kestrel-2; then step (d).

**PC-B fill 2026-10-09 (PO; specs under `## PC-B fill 2026-10-09 (PO)` in `docs/sprints/sprint-8-queue.md`; append at the END of each slot's list):**
- **kestrel-1:** PBF-K1-01 wire registry (unblocks all lane C wire modules; wire/ is empty) - PBF-K1-02 eyelid fix on WebGPU (after K2-02) - PBF-K1-03 beast level badge HUD - PBF-K1-04 desktop/Electron boot notice + start grid - PBF-K1-05 `item:got`/`flag:set`/`beast:died` emit audit.
- **kestrel-2:** PBF-K2-01 flicker measurement (`capture-browser --mode flicker`) - PBF-K2-02 overlay path for CPU UI under WebGPU (ARCH-NOTE NEEDED, small).
- **kestrel-3:** PBF-K3-01 walk slope limit + border tests - PBF-K3-02 bridge deck collider test - PBF-K3-03 wade surface flag (ARCH-NOTE NEEDED) - PBF-K3-04 biome map layer read by scatter (ARCH-NOTE NEEDED) - PBF-K3-05 BUG-WHITE-PIXELS-01 diagnosis.
- **kestrel-4:** PBF-K4-01 forest triangle budget report - PBF-K4-02 asset licence gate script.
- Waystone heal/respawn, objective line, chest wiring = lane C wire modules (`NEEDS C`: WAYSTONE-01w, S8-C-HOOK-QUEST/CHEST; only the sims exist). Blocked on owner: valley layout approval (river widen, bridge placement), bridge B rule, spell upgrades, AREAS-01 breach trigger.

- **kestrel-4 (new, report only):** NEWPACK-03 - can the importer read `.fbx`/`.obj`? (docs/sprints/sprint-8-queue.md '## New Quaternius packs'); NEWPACK-01/02 are lane C.

**PC-A answers to the PC-B evening handoff (2026-10-09):** (1) 5x rule + skill `pc-b-5x` + `tools/browser-batch.mjs` RATIFIED. (2) S8-C-HOOK-CHEST dropped (B1 built S8-B1-04); chest content + the first-chest reward decision stay C/owner (NEWPACK-02 imports Chest_Wood). (3) Gates against the Intel baseline on PC-B: OK; PC-A uses the Arc baseline (`-arc.json`). (4) 5th-agent notes 38.13 (12a/12b), 38.14, 38.15/38.16 DROP, 38.17 RATIFIED; architecture.md already merged (order 38.15-17 before 38.13-14 left as is). (5) ME-20c vertex AO: note 38.18 written (20c-a/b B2, 20c-c B1); never commit `--ao` meshes until 20c-c is merged and gpucompare is green. (6) the 2 pre-existing `gen-mesh-colliders --check` diffs (ruins Fences/Line, Moss/GroundMossXS): C owns, ignore in gates. (7) arch-review queue acknowledged; **PUSH the unpushed clone commits now** (kestrel-1 S8-B1-15/16 + MESH-LOAD-01, kestrel-2 S8-B1-07, kestrel-3 ALPHA-01f d + notes, kestrel-4 S8-B2-12a/b) after ONE batched gate, so PC-A can review. Also open from batch 19 (still required): S8-B1-04 paused-card soft-lock fix, S8-B1-11 test, S8-B2-16 two fixes, gameHooks bridge, EMIS-01b seed. After your queue: take the PBF-K* rows and NEWPACK-03; janitor run for the lane-log archive is OK (5th agent, haiku).

**SLOT FLOOR RULE (owner 2026-10-09): every slot keeps AT LEAST 5 open, startable items at all times (5-5-5-5).** The PC-B main session counts them at every handoff/push; below 5 it moves items from the REFILL POOL below into the slot (append to the slot list), and if the pool for that slot has < 3 left it runs the 5th agent (PO sonnet) to write more stories, and tells PC-A in the lane file (`NEEDS PC-A: refill pool`). PC-A tops the pool up at every review batch. Blocked items (ARCH-NOTE NEEDED, owner decision) do NOT count toward the 5.

**REFILL POOL (2026-10-09, PC-A; take top-down, each = one <= ~1 d story, spec in the named place):**
- **kestrel-1 (main.js / hooks):** (1) BUG-NOTE-ESC-01 Esc under pointer lock (`game/js/quest/noteRead.js:46`; settings/inventory/map too); (2) EMIS-02 slot-swap count + F3 line + night owner shot (38.12); (3) answer lane C `NEEDS B1:` hook points as they appear (waystone heal/respawn WAYSTONE-01w wiring, S8-C-HOOK-QUEST objective line) - check `docs/lanes/pc-c.md` tail each time; (4) `?quality` / Settings "restart to apply" and F3 `quality:` regression check as a Node + verify script (S8-B1-17 AC leftovers); (5) BACKLOG-TRIAGE batch of ~40 rows (`docs/backlog.md` -> archive, owner-visible rule; haiku OK); (6) PBF-K1-01..05 (sprint-8-queue '## PC-B fill').
- **kestrel-2 (GPU spine, no main.js):** (1) TEST-GAPS-WG (RenderTargetWebGPU + createRenderer tests); (2) DIAG-SWIFTSHADER (cause of headless fallback failure, `CAP_LOG=1`); (3) GFX-04 per-preset gpucompare on 3 poses + route-walk numbers on the Intel iGPU into the row (use `tools/browser-batch.mjs`); (4) S8-B1-19 WG-5a deletion plan (report + check-deps script; WG-5 itself waits for WG-4c); (5) S8-B1-10 device-lost card GPU side (38.10c); (6) PBF-K2-01/02; (7) cloud/AO/ripple host wiring leftovers.
- **kestrel-3 (B2 engine/mesh/WGSL):** (1) QUAT-LOD-01 importer `lods` support (owner LOD1 picks are recorded in `design/preview/lod1-trees.html` data, see PC-B handoff 2026-10-09 evening) ~0.5 d; (2) PBF-K3-01..05; (3) S8-B2-20 horizon AO (38.17); (4) ME-20c 20c-a (JS twin, ~0.5 d) then 20c-b (WGSL, ~0.4 d) - note 38.18 is written, needs S8-B2-20 merged first; 20c-c (~0.5 d, MeshBuffers + passRaster) goes to kestrel-2; (5) MESH-SCALE follow-ups / BUG-MESH-MISSING pose checks; (6) S8-B2-10 occlusion cull (needs fable ARCH-NOTE first: blocked).
- **kestrel-4 (B2 modules + importer + content tools):** (1) S8-B2-13 water ripples (38.14); (2) S8-B2-16 two ARCH fixes; (3) NEWPACK-03 FBX/OBJ import feasibility report; (4) PBF-K4-01/02 (forest tri budget report, licence gate script); (5) EDITOR-LOAD-01 (editor boot regression `tools/editor/main.js`); (6) S8-B2-03/04/06/07 re-check: ARCH-NOTE NEEDED ones need a 5th-agent note first (blocked until then); (7) EMIS-03a/b only after the owner picks glow strength (blocked on owner).

**Owner decisions 2026-10-09 (ME-20c, 38.18):** ONE shared `?ao` knob for horizon + vertex AO (combined by min). Import time and file size are NOT a concern: bake `--ao` on all meshes where it helps (rocks, trunks, buildings, props) - the owner picks per mesh from a preview after 20c-c; the 'no --ao mesh committed' rule still holds until 20c-c is merged and gpucompare is green.

**Held / owner:** D-050 hold: PC-A reviews no NEW S8-B2 story until batch-12 items 4/5 + batch-13 B are re-reviewed. B2 keeps building (ALPHA-01f is ARCH-approved); unreviewed commits stay off master. Owner: LOD1 pick (`design/preview/lod1-trees.html`), glow strength, title-menu + glow-light + squares looks (PC-B handoff 2026-10-09).

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
