# Kestrel – Product Backlog

> **PC-B handoff 2026-10-14 NIGHT (desktop RTX 4060) - START HERE (supersedes the blocks below).** Owner play-tested all day: OB-119..154 logged in docs/bugs.md (+ OB-064 reopened). Decisions D-079 (ground look A), D-080 (relays -> Waystones), D-081 (RPG item stats), D-082 (quests given/returned by characters), D-083 (bestiary 30+ types, respawn, roaming, AI, Easy/Normal/Hard).
> **Merged into pc-b tonight (see gate result below):** OB-064 gear into the pack; OB-119 GPU dispose deferred (c77fffe9 re-applied) + decor opt-in hotfix (`?decor=gpu`); OB-120 hp potions while magic locked; OB-121a grass radius 20 m; OB-121b + OB-154 underlay code (static, no wind term) but `carpet.underlay: 0` in content until the owner looks (set 0.6 to enable); OB-122 Nub removed; OB-123 whole-stone pick; OB-124/124b/125/126/133 quest markers (gold main, blue side), offer-not-accept, giver lines; OB-127 lamps; OB-128 no shield auto-equip; OB-129/130 chimney + shelf mushrooms removed; OB-131/143 floating trees/props; OB-132 voxel items (0 sprites in world_m1); OB-134 Health/Mana Potion; OB-137 names (prompt, journal, givers); OB-138 Rook-ruin stairs; OB-140 Unstuck; OB-144 far tree sway fade; OB-145 blocked waystone hints; OB-147 Rook perch + OB-152 roof chests down; OB-148 braziers under smoke; D-080 Waystones; BEAST-01 anim follows speed + stuck re-plan; BEAST-02 wolves use the wolf model; BEAST-03a archetype/kind data; GATE-FLAKY-02..05; ENV-01a-d + wire (decor opt-in), ENV-02a/b/c (look bake, not wired); CONTENT-LINT-01 (`node tools/content-lint.mjs`); decorFord cull-batch leak fix (kestrel-2 f38ebb01 NOT merged yet - re-run gpucompare decorFord first).
> **Known env issue:** this machine shows gpucompare colour drift on breach/breachDown/parapetSky/signal tower/outsideFar + underwaterLake x2 even at 3ffa5aaa (not code) -> refresh the rtx4060 baseline per D-039 after an idle-machine run; route walk boot/content-pack fetch errors happen only under heavy load (many agents + browsers) - gate on an idle machine.
> **Owner answers needed:** items epic docs/epics/ep-items-stats.md (5 questions: Tonics?, x10 numbers, rarity names, attribute requirements, damage numbers); bestiary epic docs/epics/ep-bestiary.md (5 questions: bosses, undead/bandits, difficulty change rule, respawn times, croc grab); buildings preview design/preview/buildings-voxel.html (stone vs timber cottage, tower ladder/stair); OB-136 river-quest plan docs/test-reports/ob136-quest-river-audit.md; OB-141 POI plan docs/test-reports/ob141-poi-plan.md (3 questions); OB-135 writer names table (docs/story.md "OB-135 plain names"); bug-catching: quest bot + playtester agent (opus or fable?).
> **Next (in order):** owner look at underlay (enable 0.6), GPU decor default-on again (OB-119 fixed), 23 tower-level sprites (content-lint R2), BEAST-03b/04/05 (arch 38.64), D-082 quest-giver conversion (PO + writer), ENV-02d (look WGSL), ENV-03 atmosphere code (owner pick of biome-atmos still open), OB-142 animals at the river check, OB-150 combat pass, voxel buildings import after the owner pick.

### Owner-requested workspace completion (2026-10-05)
| ID | Status | Files / evidence |
|---|---|---|

### Sprint 6 "Boar demo" + EP-HANDS (PO 2026-10-05, owner goal; D-038 item 2, D-040) - plan: docs/sprints/sprint-6.md
| ID | Title | Priority | Status | [PC] main files |
|---|---|---|---|---|
| US-079b | Boar HP + hurt + death lifecycle (4 HP, flash/flinch, tip over -> dust -> removed, `beast:died`, untargetable when dead, back on respawn/reload) | P0 | owner walk-test pending (stale-rows 2026-10-09). **ARCH OK (batch 2026-10-13): fix b87102c2 [PC-B game, 2026-10-06]** + owner walk-test. HP/death per 37.16.2; beastView drives voxel anim/t/hidden; sword dead-skip + cause:'sword'; particleHooks beast:sink corpseDust; main.js boarFx.attach(). Tests: beastSim 135/0, sword 100/0, particleHooks 27/0, beastView.test.js 10/0. **ARCH CHANGES fixed 2026-10-06:** (1) beastView now resets `frame 0, t 0, loop undefined` on clip change and drives die/sink via `frameTFromElapsed` over the clip durations (die [90,110,120,80,100], sink [500,100]); (2) `homeZ` added (create/hash/save/load) and `resetAll` restores `transform.z = homeZ`. Deviations (non-blocking): hurt window = spec's 10 steps; sink dust = one 14-burst. | `beastSim.js`, `beastConfig.js`, `beastView.js`, `sim/sword.js`, `particleHooks.js`, `game/js/main.js`, +tests (incl. `game/js/quest/beastView.test.js`) |
| US-079b0 | Engine seams: `components.voxel.hidden` skipped by VoxelPool (both collect branches) + `World.addInteractable` / `removeInteractable` | P0 | **arch-review [PC-B engine, 2026-10-06]** - voxel.hidden skipped in both collect branches (live flag, before the distance sort); World.addInteractable/removeInteractable per 37.16.1 (7.4 shape, live x/y/z, dup-key/name throws). voxelPool.test.js 41/0, world.test.js 109/0, interaction.test.js 21/0 (0-alloc unchanged). | `engine/render/voxelPool.js`, `engine/world/World.js`, `engine/world/interaction.js` (doc), `engine/render/voxelPool.test.js`, `engine/world/world.test.js` **ARCH OK (architect 2026-10-06, 78b3a44):** hidden skip in both collect branches (only VoxelPool collects voxels, grep), add/removeInteractable match 37.16.1 item 2; runtime recs (structId null, usedKey null) are safe in find/fire. |
| US-091a | Loot + inventory data: item defs, player inventory component, boar drop table, walk-over pickup + toast, save/load + death safe | P0 | todo - after US-079b; NEEDS PC-A: designer `design/items.js` + loot sprites | [PC-B game, ~0.75 d] `sim/inventory.js`, `sim/loot.js`, `pickups.js`, main.js **Arch 2026-10-05: architecture.md 37.16.3-4 (E-loot on the corpse; split US-091a1 data / US-091a2 loot+toast).** **PO 2026-10-05: SPLIT into US-091a1 + US-091a2 below; this row stays as the umbrella (close when both are done). Loot = press E at the corpse, not walk-over.** |
| US-091a2 | Loot roll at death + corpse `[E] Loot boar` interactable + toast ("+1 Boar Meat", "Pack full") | P0 | **PO OK 2026-10-07 - ready for owner look (all 6 ACs met per row; no reject). PO call: set interact radius 2.2 (about 1.9 m horizontal; 1.25 m is tight in a fight) - one-line lootConfig change, no re-review.** (PC-B checks PASS 2026-10-06) [PC-B game]. `sim/loot.js`: own RNG stream (nav seed ^ 0x10075), always 5 draws at `beast:died` (meat 100 / hide 60 / tusk 25 / orb 50 + kind), orb -> `spawnDrop`, meat/hide/tusk in `corpseN`; one `beast.loot` interactable per boar (radius 1.8, `requires: loot.<id>`) moved onto the body on death; E -> `addItem` per kind + `inventory:added` toast, leftovers -> `inventory:full` ("Pack full", still lootable), empty -> flag cleared + `despawnCorpse` (sink + dust); sink/timeout/`beasts:reset` clear flag + counts; stale `loot.*` flags dropped at create. `toastView.js` = designer `ASSETS.items.toast` (row 4 top-centre, max 3, newest at the bottom, 1.5 s, pop + fade, same item restarts its line with the total). Seed-1 rolls (meat hide tusk orb): 1101 1111 1100 1100 1101 1000 1100 1000; 1000 deaths = 100/~60/~25/~50 %. loot.test.js 37/0, toastView.test.js 16/0, tower.test.js 98/0 (`beast.loot` listed as runtime-only); 238/238 suites PASS, check-deps OK, route-walk (mesh) reaches the end. Owner look (headless 400x150, real game): prompt `[E] Loot boar` at ~1 m from the body, E -> "% +1 Boar Meat / & +1 Boar Hide" toast readable on its dark plate over grass, body sinks 0.3 m with dust. Note: radius 1.8 is 3D from body z + 0.35, so with eye height 1.6 the prompt appears within ~1.25 m horizontally - fine walking up to the body; recommend keeping it (PO could raise to 2.2 if it feels tight). Deviation: none from 37.16.3. | `sim/loot.js` (new), `sim/lootConfig.js` (new), `sim/loot.test.js` (new), `toastView.js` (new), `toastView.test.js` (new), `quest/index.js`, `tower.test.js`, `game/js/main.js` |
| HANDS-01 | Two hand slots: LMB left / RMB right (tap/hold), sword in either hand (mirrored), both hands drawn, dev swap | P0 | todo - after TORCH-01a + BUG-VM-001 left-hand; NEEDS PC-A: architecture.md 37.8 "hands" amendment + designer `spellHand` | [PC-B cross-track, ~1 d -> ARCH OK 01a/b/c (batch 2026-10-13)] `engine/render/viewModel.js`, `sim/sword.js`, `hands.js`, main.js **Arch 2026-10-05: architecture.md 37.8a (split HANDS-01a/b/c).** **PO 2026-10-05: SPLIT into HANDS-01a/b/c below (this row = umbrella); tap/hold threshold is per item (sword 0.4 s, fireball 0.6 s).** |
| HANDS-01a | View-model mirror (`setHand`/`handOf`, authored hand, det<0 winding flip in both twins) | P0 | **ARCH OK 2026-10-07 -> po-review (engine-internal: skip PO per lean rule, main session closes)** (nit: `setHand` does not validate `hand`; WGSL port: frontFace is pipeline state -> a CW-front pipeline variant for mirrored items). Was: arch-review [PC-B, 2026-10-07]. viewModel: authored hand (`def.hand` else rest x sign), `setHand`/`handOf` flag-only; mirrored handle negates `E[0..2]`/`e[0]` after the per-part pose (det<0), `item.mirror`, `mountEye` x negated; TORCH-01a nits folded in. Winding: rasterJS cull test `info.mirror ? A2 > 0 : A2 < 0`; GPU `gl.frontFace(item.mirror ? CW : CCW)` per voxel item, CCW restored (no GLSL). viewModel.test 104/0 (det<0 all parts/clips, = S x unmirrored < 1e-6, round trip bit-identical, mirrored coverage > 90 % of reflected, mirror=0 forced changes the render, 0-alloc, sword hash unchanged), DrawList.test 25/0. gpucompare d08ff00 vs after: 0 differences. 244/244, route identical. Note: +5 check-deps `gl.*` WARN lines (the frontFace calls; same D-029 item 9 class as the 189 existing in GpuCellPipeline). Deviation: no JS cull-off switch -> coverage + forced-flag checks instead of the spec cull-on == cull-off test. GPU flip only exercised once HANDS-01c adds the `handsSwapped` pose. | [PC-B cross-track, ~0.5 d -> arch-review (first review, core render)] `engine/render/viewModel.js`, `engine/mesh/DrawList.js`, `rasterJS.js`, `GpuCellPipeline.js`; 37.8a |
| HANDS-01b | Mouse2 + context-menu block, hands router, sword in either hand, inventory shape + demo start state, `?demo=0`, `H` dev swap | P0 | **ARCH OK 2026-10-07; PO OK 2026-10-07 (claims-only) -> testing** + owner try. Was: arch-review [PC-B, 2026-10-07] (input.js). input.js: Mouse2 down/up (same consume/blur rules), `blockContextMenu(el)` (dev.js export); `sim/hands.js` router: LMB -> left item, RMB -> right item via `downOf(id)` (tap/hold stays in each item sim: sword 0.4 s, fireball 0.6 s), hand change cancels + `setHand` + one `hands:changed`, closed gate cancels and re-arms only after button-up; `startConfig.js` START_DEMO / START_FULL (`?demo=0`); `H` swap with `?debug=1`; sword loaded once as `swordForHand('right')` (37.8a erratum) and mirrored to the left by HANDS-01a; fireball = no-op stub for SPELL-01a. input.test 12/0, hands.test 31/0 (tap/hold, gate, swap, real sword.js hits from either hand, save/load, replay hash, 0 heap growth). 246/246; route-walk identical, browser route walk reaches the end (0 frames > 25 ms); gpucompare 105/138 PASS before and after, 0 regressions. Headless: LMB swings left sword, H -> RMB swings it. Not done: F3 help list (no help text found). | [PC-B cross-track, ~0.75 d -> arch-review (input.js)] `engine/core/input.js`, `sim/hands.js`, `sim/inventory.js`, `startConfig.js`, `sim/sword.js`, `swordView.js`, main.js; 37.8a |
| HANDS-01c | Spell-hand idle view + gpucompare pose `handsSwapped` | P0 | **ARCH OK 2026-10-07 (opus batch: 7859dd1 dLSample is the first violating cell, 90.004 deg tie, D-039 record freezes metrics, no threshold widened) -> owner look.** Was: **owner look; ARCH ANSWER 2026-10-07: det<0 path is correct in both twins (no GLSL fix); the 1 dL cell is the known edge-on voxel-face coverage tie (nrmMaxDeg 90.004, not 180; k8 3017/3014). PC-B: add `cmpLight.dLSample` (cell, JS/GPU nrm + objectId), confirm the cell is a ~90 deg nrmViol cell, then record `handsSwapped` as D-039 known-FAIL** (was: ASK ARCHITECT mirror lighting [PC-B, 2026-10-07]). `spellHandView.js`: second view-model handle, visible while `spell.fireball` is in a hand, side via `setHand` (glove authored left -> mirrored in the right hand), designer `idle` clip + sword walk-bob, hidden in cinematics, 0-alloc; main.js registers `spellHandL` mesh-only; game/index.html now loads design/models/spell.js. spellHandView.test 12/0. gpucompare pose `handsSwapped` (game/js/dev/modes/gpucompare.js; sword mirrored in the right hand, glove unmirrored in the left - 4-handle cap): 0 previously passing rows regress (33 -> 34 FAIL), **new row FAILs**: faceViol 1, kind 0, depthViol 1, uvViol 5, nrmViol 5, dLViol 3 (dLMax 0.0626), fgMax 188. A mirrored sword alone fails the same (dLViol 3) while the unmirrored sibling passes -> tied to the mirror, NOT proven precision, so NOT recorded as D-039 known-FAIL. **ASK ARCHITECT:** do the light pass / normal path (`mat3(uModel)*n` on GPU, the JS twin equivalent) treat det<0 view-model items correctly? 247/247 (one unidentified flaky FAIL in 1 of 4 full runs); browser route walk reaches the end. | [PC-B game, ~0.25 d] `spellHandView.js`, main.js, `game/js/dev/gpucompare.js`; 37.8a **Follow-up done [PC-B, 2026-10-07]:** `cmpLight.dLSample` (engine/render/gpu/gpuCompare.js `dLSampleIdx` + `describeCellNormals`, logged by the gpucompare mode; diagnostic only). handsSwapped dL cell: idx 8767 (col 127, row 54), kind 8, face 7 both twins, objectId 15 both, JS nrm (-0.388, 0.210, 0.898) vs GPU (-0.599, 0.682, -0.419) = 90.004 deg -> the edge-on tie, **recorded as D-039 known-FAIL** (docs/test-reports/VOX-CAP-01.md addendum; must-not-worsen: faceViol 1, depthViol 1, uvViol 5, nrmViol 5, dLViol 3, dLMax 0.0626, fgMax 188). Same-machine gpucompare 27/144 FAIL before and after, 0 status changes. |
| SPELL-01a | Fireball sim: cast (tap 5 MP / hold 10 MP), swept projectile, US-136 explosion damage + knockback, no self-damage | P0 | **PO OK 2026-10-07 (claims-only) -> testing + owner try [PC-B, 2026-10-07]** (a1 + a2 done; PO note: 5 m light bound is SPELL-01b's cap, confirm it there). `sim/fireball.js` + `spellConfig.js` (FIREBALL_CFG) + `sim/targetables.js`; replaces the HANDS-01b stub, driven by `hands.downOf('spell.fireball')`. Charge = 36 steps (0.6 s); mana spent once on release (tap 5, hold 10; charged with 5-9 MP = tap ball; < 5 MP nothing, no cooldown); cooldown 30 steps; 4-ball cap refuses without a mana call; castOffset 0.22/0.50/0.135 from `viewModels.spellHand` (mirrored left); swept flight (`raySegment` + segment-vs-cylinder beasts), 24 m air burst; `explosionHits` -> `combat:hit` cause fire, knock by falloff; player knockback only (no self-damage); balls not saved (like the sword). fireball.test 59/0 (all ACs, no tunnelling at 16 m/s over 20 angles x 30 wall phases, real World + beastSim integration, replay hash, 0-alloc 10k steps). 248/248; route-walk identical; browser route walk reaches the end; headless RMB tap casts, MP 20 -> 15, no console errors. Trail: each slot exposes `serial` + `age` for SPELL-01b. | [PC-B game, ~0.75 d] `sim/fireball.js`, `spellConfig.js`, main.js **Arch 2026-10-05: architecture.md 37.14 (split SPELL-01a1/a2).** **PO 2026-10-05 ACs added (see section): mana on release; 5-9 MP charged release = normal ball; refused at 4-ball cap without spending; player knockback only; castOffset from `viewModels.spellHand.castOffset` (D-042); one persistent trail emitter per ball; lights bound at 5 m. Runs after HANDS-01b/c.** |
| SPELL-01b | Fireball view: flame sprite + trail + moving light, spell-hand clips, burst + flash + kick, light cap, gpucompare pose | P0 | **owner look [PC-B, 2026-10-07]**. `fireballView.js` per designer spellFx: core sprite (charged variant, 4-frame `fly`) interpolated by alpha; ONE persistent `fireTrail` emitter per ball serial (charged: +1 burst every 2nd step); lights bound once per world, off when idle (4 flight @ 5 m, tap 0.9 / charged 1.1, 2-light flash ring @ 6 m, + `spellEmber` = 7 slots); burst = `fireballBlast` sprite (designer ms durations) + fireballBurst/Smoke/Cinders + flash (`(1-age/9)^2`) + camera kick 1.5/2.5 deg within 6 m (render pitch only). spellHandView: charge / chargeHold / cast / castHard / fizzle clips + glow. `spellFx.attach()` moved before `AssetRegistry.fromJSON` (atlas). fireballView.test 31/0, spellHandView.test 20/0; 249/249, check-deps no new warnings; gpucompare new rows fireballInFlight + fireballBurst (+ shadow) PASS, 0 status changes (110/144); browser route walk reaches the end. Captures spell-01b-{flight,burst}.png (local): ball + blast match the preview, flash lights floor/wall. Skipped: chargeReady glint, handSparks, raise/lower clips, scorch decal (DECAL-01). Burst dir = flight dir (no hit normal in `fireball:burst`). Owner: glove look while charging/casting (too dark to judge headless), ball on the hillside. | [PC-B game, ~0.75 d] `fireballView.js`, main.js **Arch 2026-10-05: architecture.md 37.14 (no engine change; lights via LightSet).** |
| US-091b | Inventory screen: `I` pauses, hands strip + 6x4 ASCII-icon grid + details, assign to hands with LMB/RMB, use meat | P0 | **po-review + owner look [PC-B, 2026-10-07]**. `inventoryView.js` per designer `uiStyle.inventory`: `I` opens (pauses, closes the hands gate, releases pointer lock; re-locks on close only if it was locked), Esc/I close; hands strip + 6x4 icon grid + details; WASD/arrows/hover select; Q/LMB -> left, E/RMB -> right (router cancels + setHand at once), on a hand slot = empty it; Enter/U use: meat +10 HP (clamped, -1 stack, toast "Ate Boar Meat +10 HP"; "Not hurt" at full HP), hide/tusk "Material - no use yet". toastView `say()`; game/index.html loads inventory_ui.js. inventoryView.test 56/0 (incl. 0-alloc draw). 250/250, no new check-deps warnings, browser route walk reaches the end; headless: ate meat HP 22 -> 30, torch -> right hand. Capture us-091b-inventory.png matches the preview. Not done: fadeIn/fadeOut, slot-flash tests, eat sound (no SFX hook); all keys swallowed while open. | [PC-B game/UI, ~1 d] `inventoryView.js`, main.js |

### EP-ALIVE "Alive world" - MOVED to `docs/epics/ep-alive.md` (2026-10-08, verbatim: epic text, ENV-01a/01b/02/03/04, PC-B queues). Open rows keep their IDs there.

## Engine refactor backlog (architect survey 2026-09-24, D-006/D-010 reuse; not milestone-gated)
| ID | Title | Priority | Status |
|---|---|---|---|
| US-049 | D-017 pruning of fallback-only render code | P1 | todo |

## Epic PX "Direct 3D look - non-ASCII output mode" (architect 2026-09-30; D-029; sketches)
**The game's look stays ASCII unless the owner decides otherwise in a manager D-entry; these stories only make the engine capable** (D-029: the glyph pass is the last stage, so presenting the lit colour image directly is an engine output mode on the same scene/light pipeline). **Phasing:** PX-01..02 (switch + resolution) first; PX-03 needs ME-15/16; PX-04 oracle before any look is judged; PX-05..07 look + UI; PX-08 closes with the budget. Nothing here blocks RTS-01. **Tech note before dev:** one big note for PX-01+02 (pass graph per mode, targets, what resolve/deriv/edge do in pixel mode), one for PX-03+04 (shared light core, oracle metric).

| ID | Title | Priority | Status | notes |
|---|---|---|---|---|
| PX-01 | **Output-mode switch** `createEngine({ output: 'ascii' \| 'pixel' })`, `?output=` override; pipeline branches after light: ascii = shade/edge/cells as today, pixel = colour target + blit present; F3 shows the mode | P2 | todo (sketch) | [PC-A] `engine.js`, `GpuCellPipeline.js`, `RenderTargetGL.js` - deps: ME-12b. ACs: (1) `'ascii'` output identical (gpucompare 34/34); (2) `'pixel'` shows albedo x N.L on the tower pose; (3) mode chosen at load, no GPU leak on reload. 1 d |
| PX-02 | **Full-resolution targets decoupled from the cell grid** - G-buffer at canvas px x `renderScale` (0.5-1.0), projection terms from pixel W/H, resolve/deriv skipped in pixel mode | P2 | todo (sketch) | [PC-A] - deps: PX-01. ACs: (1) resize keeps aspect, no stretch; (2) renderScale 0.5 roughly halves raster time (timer); (3) cell grid size no longer affects pixel output. 1 d |
| PX-03 | **Pixel shading pass** - material base colour from `MaterialTable`/palette ramps, sun N.L + shadow map (ME-15), top-2 point lights + cube shadows (ME-16), sky ambient; light maths shared with the ASCII light pass (one GLSL include) | P2 | todo (sketch) | [PC-A] - deps: PX-02, ME-15, ME-16. ACs: (1) same pose: ASCII cell brightness vs pixel mean luminance per cell within 5 %; (2) shadows match `sunlit` bits; (3) no literals in GLSL (uniforms). 1 d |
| PX-04 | **Pixel-mode oracle** - `pixelShadeJS` computes colour at a fixed sample lattice (every 8th px) from the `rasterJS` G-buffer; `?gpucompare=pixel` | P2 | todo (sketch) | [PC-B JS + PC-A GPU compare] - deps: PX-03. ACs: (1) >= 99 % samples within +-4/255 per channel excl. geometry-edge samples; (2) JS half runs in Node. 1 d |
| PX-05a | **Voxel AO bake** - `voxelMesh.js` per-vertex corner AO (3-neighbour rule) stored in the mesh, behind a flag | P2 | todo (sketch) - **NEEDS PC-A: architect note (PC-B Q7 filler, 2026-10-01).** Row too thin to hand to a programmer: no exact corner-AO formula (which 3 neighbours, how the 0-3 levels map to shade), no named flag/opt-in mechanism, no target field in `MeshData`'s per-vertex layout (`aux8`? a new attribute?), and no interaction spelled out with the existing `AO_NONE` aux slot already used by `emitFaceQuad`/`emitPartFaces` in `voxelMesh.js`. | [PC-B] - deps: ME-07. ACs: (1) fixture corners give the expected 0-3 levels; (2) greedy merge only joins quads with equal AO; (3) ASCII output unchanged with the flag off. 0.5 d |
| PX-05b | **Voxel look** - per-voxel flat shading, world-anchored per-voxel colour jitter (hash of voxel coords), AO from PX-05a, optional outline from planeId/objectId discontinuities (edge rules reused in pixel space) | P2 | todo (sketch) | [PC-A] - deps: PX-03, PX-05a. ACs: (1) no shimmer when panning (`?flicker=1` within +10 %); (2) outline on/off option; (3) oracle PASS. 1 d |
| PX-06 | **Post** - distance fog (same curve as ASCII), tonemap + exposure uniform, optional `pixelate` (low renderScale + nearest upscale) and ordered-dither palette quantisation for a retro look; no temporal noise | P2 | todo (sketch) | [PC-A] - deps: PX-03. ACs: (1) each effect toggles by option; (2) dither screen-stable and deterministic; (3) <= 0.3 ms at 1080p. 1 d |
| PX-07 | **UI and overlays in both modes** - HUD/text layer (`CellBuffer` at its own cols/rows) composited as a transparent glyph layer over the pixel image; RE-07 overlays and RE-13 minimap in both modes | P2 | todo (sketch) | [PC-A] - deps: PX-01, RE-07. ACs: (1) F3, rings, bars, box rect visible in both modes (test poses); (2) HUD glyph size independent of renderScale. 1 d |
| PX-08 | **Pixel-mode budget + owner look page** - bench poses at 1920x1080, renderScale 1.0/0.75/0.5, owner Intel iGPU; side-by-side page ascii vs pixel (hillside + RTS pose) | P2 (epic close) | todo (sketch) | [PC-A] - deps: PX-05b, PX-06. ACs: (1) GPU p95 <= 8 ms at 1080p x 0.75 (proposal, confirmed at first measure), numbers in 27.8; (2) `over25 == 0`; (3) page runs from the static server. 1 d |

## Engine capability before M3: 3D glyph models = voxel models with rigid-part animation (D-016; sketched, see bottom of file)
| ID | Title | Priority | Status |
|---|---|---|---|
| US-041b | Creature clips (`idle`/`walk`) + bear voxel model + `design/preview/voxel.html` + walking-loop test (split from US-041, D-019) | P0 (before M3) | todo (sketch) – after US-041a |

## Physics + effects epic (owner requirement 2026-09-24: object physics before release; handoff 3 items 7+8; sketched, see bottom of file)
**Gate before US-051 starts:** physics-engine choice (extend the in-house `engine/physics` sphere/capsule code vs Rapier/WASM under D-015) needs an architect estimate + a manager decision (new D-entry).
**Architect estimate (2026-09-24):** see `docs/architecture.md` "Physics epic estimate (2026-09-24)" - recommends (A) in-house compound-sphere rigid bodies, ~11 story units; Rapier spike only if US-051a misses its settle test. Awaiting manager decision.

| Order | ID | Title | Priority | Milestone | Status |
|---|---|---|---|---|---|
| P1 | US-051 | Dynamic rigid props: drop, fall, tumble, settle (box/cylinder bodies) (engine story) | P0 | M2 | todo (sketch) - after the physics-engine decision |
| P2 | US-052 | Pick up, carry, put down, throw (e.g. a branch) (engine + game story) | P0 | M2 | todo (sketch) - after US-051, uses US-012 interaction |
| P3 | US-053 | Particle system: smoke, dust, sparks, splash drops (engine story) | P1 | M2 | todo (sketch) - folds in US-019 dust motes |
| P4 | US-054 | Cuttable tree -> trunk log + branches as physics pieces (engine + content story) | P0 | M3 | todo (sketch) - after US-051/052, the M2 sword, US-041 voxel |
| P5 | US-055 | Water surface + splash + floating props (engine story) | P1 | M3 | todo (sketch) - after US-051, US-053, US-026 |

## Epic EP-ELEMENTS "Particles, water, fire, wind, weather" (PO 2026-10-01, owner request; sketches, see `### US-053a` onwards near the bottom of the file)
**Scope:** particles, liquid surfaces, burning, fire spread, explosions, wind as a real force, weather/fog. Engine parts stay genre-neutral (D-006); which things burn, what explodes and the tuning numbers are content data. **Existing rows are linked, not duplicated:** US-053 (particles) and US-055 (water) stay the umbrella rows and close when their steps below are done; floating props stay in US-055 after US-051. US-093 (torch burns barriers/brush) and US-101 (Spark lights braziers) use this epic; US-082 (combat feel) uses the particles; US-121 "wind grass" stays a visual shader preset that will read the US-138 wind uniform; US-122 (day/night) and US-127 (light in fog) pair with US-139/140. **Object physics (US-051/052) is not a blocker:** every story here first works on the player capsule, entities and static world data; "pushes / ignites / floats physics bodies" is a later AC marked *(after US-051)*. **Phasing:** particles (053a-c) first, they feed everything else -> water (055a/b) and fire (132-135) -> explosions (136/137) -> wind (138) -> weather (139/140, stretch). **Tech note before dev (NEEDS PC-A: architect note):** US-053a+053b (one note: module home e.g. `engine/fx/`, pool layout, sprite-pass draw, JS twin), US-055a, US-132+133 (one note: status-effect component, flammability on materials vs entities, fire grid), US-136, US-138, US-139. Sim rules for every row: fixed step, seeded RNG, iteration by id, zero per-frame allocation, save-safe state where it persists.

| ID | Title / one-line story | Priority | Milestone / epic | Status |
|---|---|---|---|---|
| US-053a | Particle sim core (engine): pooled emitters + particles on the fixed step (rate, life, velocity + spread, gravity/buoyancy, drag, wind input), no drawing yet; Node tests | P1 | M3 EP-ELEMENTS (step of US-053) | … `engine/world/entityEmitters.js`, `engine.particles` option + clear on world:loaded, check-deps rule 16 (fx leaf; physics/nav may not import fx) + rule 15 scope; 84 Node tests; 500 live 0.010 ms / 2048 live 0.035 ms per step (bars 0.05/0.15); zero heap growth. engine.js wiring not browser-checked yet. Was: todo (sketch) [PC-A engine, new module] - NEEDS PC-A: architect note (053a+b). ~1 d (full history: backlog-archive.md "Row history 2026-10-06") |
| US-053c | Particle presets as data + first placements: burner flame + smoke on the *Kestrel* burner (replaces the OWN-REQ-008 billboard flame), sparks for US-078d/US-082, landing dust, splash drops; US-019 dust motes rebuilt as a preset | P1 | M3 EP-ELEMENTS (step of US-053) | … + dirty rows, zero alloc); presets embers 0.08 (glyphs `**+o+o+o`, brighter, life 1.0-1.8 s), smoke 0.25, sparks 0.05, dust 0.15; tests: 0 = single cell, near 3x3 / far 1x1, dirty/clear, zero heap, validation; 200/200. Cost 480x180 worst case 500 near particles 0.17 ms (was 0.11). -> arch-review (short opus) + owner look. **Particle footprint ARCH OK (opus 2026-10-03 night) -> owner look.** (full history: backlog-archive.md "Row history 2026-10-06") |
| US-053d | Particle presets part 2: `splash` drops (for US-055b) + `motes` (US-019 sun-shaft dust rebuilt as a preset, closes US-019) | P2 | M3 EP-ELEMENTS (step of US-053) | todo (sketch) [PC-B content + designer ramps] - deps: US-053c. ~0.5 d |
| US-055a | Water surface render (engine): water regions as world data (sector or terrain region + surface height), animated wave glyphs, depth tint, see-through in shallows; JS twin + gpucompare pose `water` | P1 | M3/M4 EP-ELEMENTS (step of US-055) | … max 32, validated), `World.waterAt(x, y, out)` -> surfaceZ/depth/region id/look (0.05 us at 32 regions), world block saved only when non-empty; 46 checks. 055a2 render next. Was: todo (sketch) [PC-A engine/render + world] - architect note 32.2; render half re-scoped by architecture.md 35.0 (owner: water mesh): 055a2 -> 055a2a layer pass (1 d) + 055a2b composite (0.75 d); 055a1 unchanged. ~1 d (full history: backlog-archive.md "Row history 2026-10-06") |
| US-055a2c | Water wiring + first visible water: (a) `engine/index.js` exports `resolveWaterLooks`; main.js `gpuPipeline.setWaterLooks(assets.waterLooks)` + `fb.waterLooks = resolveWaterLooks(...)`; (b) designer `design/water-looks.js` (`water` look, registered in the AssetRegistry); (c) one pond + one flooded … | P1 | M3/M4 EP-ELEMENTS (water) | … => a few spike frames out of 120, i.e. stalls/uploads landing inside the water timer, most likely from the 45acdee content (ENV-01 ground-detail instances/chunk uploads, tower dressing). PC-B: repeat 3 runs each at 45acdee vs the pre-sync commit, report max + count of frames >.25 ms, and A/B with ground detail off; if spikes stay with detail off, log which frames upload buffers/compile programs. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-055b | Wade, swim, splash: player wades (< 0.6 m) / swims (>= 0.6 m), splash particles + ripple ring on entry scaled by speed, water puts out burning (US-132) | P1 | M3/M4 EP-ELEMENTS (step of US-055) | todo (sketch) [PC-B game + PC-A `waterAt` query if 055a lacks it] - deps: US-055a, US-053c. ~1 d |
| US-141a | Flow data + scrolling surface (PO 2026-10-02, owner "water, waterfalls, waves"): water regions get `flow [vx,vy]` (m/s) as data + `World.flowAt(x,y,out)`; surface glyphs/foam streaks scroll with the flow in the water shade | P1 | M4 EP-ELEMENTS (water, step 1) | … region: bar 0.1 + 0.05 ms). 5 deviations accepted (radial `n = round(4r/W)` folds into 35.4; frozen-10 s poses -> PC-A swaps for the 35.10 tick-600 pose after 143a). capture-browser timeout not from this diff (62 poses vs default 120 s timeout). Nits: stray `find` JSDoc above `flowInto` in water.js; comment the radial `|s| < FLOW_MIN` -> linear fallback; radial seam test point near angle 4-eps. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-141b | Currents act: flow pushes the wading/swimming player (same `pushX/pushY` path as US-138b), carries floating props (after US-051) and water particles; river test level with a strong and a weak reach | P1 | M4 EP-ELEMENTS (water, step 2) | architect note (architecture.md 35.7) -> split 141b1 [PC-A `engine/fx` particle flow, 0.25 d] + 141b2 [PC-B game push + river level, 0.5 d] - deps: US-141a, US-055b, US-138b |
| US-141b1 | Particle flow (engine fx): `def.flow` + `sampleFlow` so water particles drift with the current | P1 | M4 EP-ELEMENTS (water, step 2a) | todo [PC-A engine/fx] - 0.25 d - deps: US-141a. ACs: parent row + architecture.md 35.7, 35.11 step 6 (drift test, zero allocation) |
| US-141b2 | Currents in play (game): flow push via `pushX/pushY`, water emitters with flow, river test level (strong + weak reach) | P1 | M4 EP-ELEMENTS (water, step 2b) | todo [PC-B game/js/quest + level] - 0.5 d - deps: US-141b1, US-138b, US-055b. ACs: parent row + architecture.md 35.7, 35.11 step 7 |
| US-142a | Waterfall view: a vertical falling sheet (animated glyph columns `\| : '`, emissive highlight streaks, fast scroll), foot spray/mist particles, plunge pool with expanding ripple rings; one placeable `waterfall` prop/preset in a test cliff | P1 | M4/M5 EP-ELEMENTS (water, step 3) | architect note (architecture.md 35.5: needs the engine hook) -> split 142a1 [PC-A engine sheet in the water layer, 0.75 d] + 142a2 [PC-B content `design/` + `game/js/quest`, designer ramps + preview, 0.75 d] - deps: US-053c, US-055a2b |
| US-142a1 | Waterfall sheet (engine): `waterfalls` block, sheet mesh in the water layer, sheet composite, gpucompare pose `waterfall` | P1 | M4/M5 EP-ELEMENTS (water, step 3a) | … floats 36/40-43/54/55, sheet flag bit 32, sheets never opaque so the edge suppression agrees), lip-relative f32 XY accepted, defs round-trip, sheet mesh derived. Follow-up nit (not blocking, fold into US-142a2): `WaterLayer._sheets` is keyed by mesh and never pruned, so each world load leaks <= 8 sheet buffers until dispose - clear it when the world changes (as ME-14c3 does for mesh buffers). (full history: backlog-archive.md "Row history 2026-10-06") |
| US-142a2 | Waterfall content: preset, lip + foot emitters, plunge pool (`flowRadial`), ripple rings, test cliff, preview page | P1 | M4/M5 EP-ELEMENTS (water, step 3b) | … as large flat rectangles - tune later.  **ARCH OK engine part (opus 2026-10-04, 82ebe56).** bindWorld disposes sheet buffers on world change, keeps clipmap/targets, idempotent dispose, mesh-only (WaterLayer only exists there); 10 checks cover it. Nit (optional): `frame(fb, light)` without a world unbinds and the next world frame re-uploads sheets - guard `if (world)` if any caller alternates. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-142b | Waterfall sound + cave: loud looping roar with distance falloff + pan (cf. US-020b), spray soaks the lens edge when close, optional walk-behind alcove with a hidden chest spot | P2 | M5/M6 EP-ELEMENTS (water, step 4) | todo (sketch, sound deferred to M6 polish per owner 2026-09-25) [PC-B `game/js/audio`, `game/js/quest`] - deps: US-142a, US-020b. ~0.5 d |
| US-143a | Wave height field (engine, Node only): `waveHeight(x,y,t,preset)` = sum of <= 4 seeded directional waves (amp, wavelength, speed, dir) on the fixed clock; `waterAt` returns the live surface z; presets calm / breezy / storm as data | P1 | M4/M5 EP-ELEMENTS (water, step 5) | … probe (scratch, deleted) stepped `world.water` 180 times and read `waterAt(1500, 1010)` (inside the `quietPond` region, r4 @ 1500,1010) every 30 steps - `surfaceZ` oscillated 2.483-2.511 m, confirming the tick isn't frozen anymore. `run-tests.mjs` 192 PASS/2 FAIL (pre-existing)/1 WARN; `check-deps.mjs` clean; `route-walk-browser.mjs` (dda port 9603, mesh port 9604) both clean, all legs completed. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-143b | Wave render + shoreline foam: surface visibly rises and falls (shade-pass normal/height perturbation or mesh vertex displacement, architect decides), wave crests lit by sun glint, foam glyphs (`* o .`) where depth < 0.3 m and on crests; JS twin, gpucompare pose `waves` | P1 | M4/M5 EP-ELEMENTS (water, step 6) | architect note (architecture.md 35.3; owner decision 2026-10-02: displaced water mesh) -> split 143b1 [PC-A displacement, 1 d] + 143b2 [PC-A shading + foam + designer ramps, 0.75 d] - deps: US-143a, US-055a2b |
| US-143b1 | Wave displacement (engine): vertex waves on the water mesh, fade, stitch, fragment normal, both twins, pose `waves` geometry | P1 | M4/M5 EP-ELEMENTS (water, step 6a) | todo [PC-A engine/render] - 1 d - deps: US-143a, US-055a2b. ACs: parent row + architecture.md 35.3, 35.11 step 8 (twin vs `waveHeight` within 1e-5 m, seams watertight with waves) **Binding note (architect, 055a2a review):** build the coarse-ring hole-edge midpoints with `ring = k - 1` (engine/mesh/waterMesh.js:335 `pushVert(x * s / 2, y * s / 2, k, ...)` -> `k - 1`) so the stitch rule is one case: neighbour offset = `WATER_RING_STEP[ring]`. `WATER_U_STRIDE` grows to 32 for the 4 x (kx, ky, A, c) here, not in 143a. |
| US-143b2 | Wave shading + foam (engine + designer ramps): sun on N, glint, bands, shore + crest foam, foam fade, pose `waves` | P1 | M4/M5 EP-ELEMENTS (water, step 6b) | todo [PC-A engine/render + designer ramps] - 0.75 d - deps: US-143b1. ACs: parent row + architecture.md 35.3, 35.11 step 9 |
| US-143c | Waves in play: floating objects (player swim bob, props after US-051, boat later) follow the live surface; calm/storm preset follows wind (US-138) and weather (US-140); sea test level | P2 | M5 EP-ELEMENTS (water, step 7) | architect note (architecture.md 35.7, 35.11 step 10) -> game only [PC-B game/level; engine `setSeaState` lands in 143a] - deps: US-143a/b, US-055b, US-138, US-140 (weather link may land later). ~0.75 d |
| US-144a | Underwater view: eye below surface gives blue-green tint + short fog, glyph swap to a bubbly ramp, light-shaft streaks, surface seen from below; JS twin | P1 | M4/M5 EP-ELEMENTS (water, step 8) | architect note (architecture.md 35.6) -> split 144a1 [PC-A shade + designer, 1 d] + 144a2 [PC-A sprites/particles under fog, 0.5 d] - deps: US-055a2b, US-143a, US-055b |
| US-144a1 | Underwater view (engine + designer): under state + hysteresis, fog, tint, glyph swap, shafts, ceiling, edges, pose `underwater` | P1 | M4/M5 EP-ELEMENTS (water, step 8a) | todo [PC-A engine/render + designer] - 1 d - deps: US-055a2b, US-143a. ACs: parent row + architecture.md 35.6, 35.11 step 13 |
| US-144a2 | Under-fog for sprites + particles (engine): `underFogK` in the sprite pass and the particle layer, with tests | P1 | M4/M5 EP-ELEMENTS (water, step 8b) | todo [PC-A engine/render + fx] - 0.5 d - deps: US-144a1. ACs: parent row + architecture.md 35.6, 35.11 step 14 |
| US-144b | Underwater play + sound: muffled low-pass audio, bubble particles on exhale, breath meter hook on the vitals sim (drain when head is under, refill above; drowning damage values are US-080 tuning) | P2 | M5 EP-ELEMENTS (water, step 9) | todo (sketch, audio part deferred to M6) [PC-B game + audio] - deps: US-144a, US-080a1, US-053c. ~0.5 d |
| US-132 | Burning status effect: as a player I can catch fire (and so can enemies and flammable props): damage over time, flame + smoke on whatever burns, spreads to touching flammable entities, put out by water or by time | P1 | M4 EP-ELEMENTS | todo (sketch) [PC-A engine status-effect component + PC-B game tuning] - deps: US-053c, US-080a1 (damage). NEEDS PC-A: architect note (132+133). ~1 d |
| US-133 | Fire spread (engine sim): flammable materials/props as data (fuel, ignite chance), a coarse fire cell grid with a neighbour-propagation rule (seeded, fixed step), fuel burns out -> charred material; wind bias hook; Node tests | P1 | M4 EP-ELEMENTS | … `fire:area` event; hooks World.fire=null, serialize writes `fire` when set, rule 15 scope; 4096-cell front tick 0.039 ms (saturated 0.096). Game side: build via createFireGrid + addArea, wire `world.surfaceAt` for sector floorMat, `grid.load(state.fire)` after load. Was: todo (sketch) [PC-A engine/world] - deps: none for the sim (view in US-134). NEEDS PC-A: architect note (132+133). ~1 d (full history: backlog-archive.md "Row history 2026-10-06") |
| US-134 | Fire view: burning cells render flame glyphs + emissive + smoke particles, a capped number of flicker lights per fire area, charred material swap visible after burn-out | P1 | M4 EP-ELEMENTS | todo (sketch) [PC-A engine/render + designer fire/char ramps] - deps: US-133, US-053c. ~1 d |
| US-135 | Fire in the game: a fire test room - torch/burner ignites dry brush, fire spreads across the patch, a wooden barrier burns away and opens a path, things in the fire catch fire (US-132) | P1 | M4 EP-ELEMENTS | todo (sketch) [PC-B content + game/js/quest] - deps: US-132, US-134; feeds US-093 (torch gates). ~0.5-1 d |
| US-137 | Explosion view + content: burst preset (flash, debris, smoke), short-lived flash light, camera kick, ignites flammables in radius (US-133), one explosive prop (e.g. a blast-bloom pod) | P2 | M4/M5 EP-ELEMENTS | todo (sketch) [PC-B content + game + designer] - deps: US-136, US-053c, US-133. ~1 d |
| US-139 | Height fog + fog banks (stretch): fog density that varies with height and with data-placed fog volumes (valley mist, swamp), drifting with wind, instead of only flat distance fog | P2 (stretch) | M5/M6 EP-ELEMENTS | todo (sketch) [PC-A engine/render light/shade pass + designer] - deps: US-138; pairs with US-127, US-121. NEEDS PC-A: architect note. ~1 d |
| US-140 | Weather states (stretch): clear / rain / storm / snow as a world state with transitions; rain + snow particles, wet darkening, rain puts out open fires, storm raises wind | P3 (stretch) | M6 EP-ELEMENTS | todo (sketch) [PC-B content/game + PC-A hooks if needed] - deps: US-053c, US-138, US-139, US-133; pairs with US-122. Split at planning if > 1 d |

## Milestone 6 "Polish & Release" (sketched, see bottom of file; D-012)
| ID | Title | Priority | Status |
|---|---|---|---|
| US-043 | Steam release: Electron wrapper + Steamworks + store assets | P0 (M6) | todo (sketch) |

## Milestone 5 "Engine Editor v0" (sketched, see bottom of file; D-010)
| ID | Title | Priority | Status |
|---|---|---|---|
| US-035 | Model frame editor | P0 (M5) | todo (sketch) |
| US-036 | Animations + events + preview | P0 (M5) | todo (sketch) |
| US-037 | ModelDef JSON save/load | P0 (M5) | todo (sketch) |

Per D-016 the M5 model editor edits **voxel models** (`ModelDef.voxel`: z-layer row strings, part boxes, rigid-part keyframes), as well as the existing 2D sprite frames.

## Game + engine gap epics (PO 2026-09-26, owner "what do we miss?"; milestones per the re-planned `docs/roadmap.md`, needs a manager D-entry)
Sketch rows only, except the three M3 openers (US-078/079/080) which have ACs below. PC tags are guesses; PO confirms at sprint planning. Existing rows are linked, not duplicated: mesh engine ME-00..34, streaming US-026b, save format CO-5, creature clips US-041b, dialogue US-042, Steam US-043, physics/particles/water US-051..055, model editor US-035..037, MCP/AI/text meshes US-075..077, sound US-020/020d, log US-021.
| ID | Title / one-line story | Priority | Milestone / epic | Status |
|---|---|---|---|---|
| US-078 | Sword swing + hit detection: as a player I swing a sword with the mouse and it hits what it visibly touches | P0 | M3 EP-COMBAT (opener) | … session 49 PASS): design/models/m3_props.js `voxelModels.practiceTarget` (old sword pell; clips flash 6 steps -> wobble 32 -> idle; targetable r 0.20 z 0.45-1.60) + `levelPatch.towerPracticeTarget` (14.6, 6.6, facing 270); optional `strawPuff`; preview design/preview/m3-props.html. Still NEEDS PC-A: m3Kit merge (7 colours, 5 materials, glyph set strawFace; script tag after title.js + sword.js). (full history: backlog-archive.md "Row history 2026-10-06") |
| US-078b | Engine queries: `World.raySegment`, `raycastColliders`, `meleeArc.arcHits`, overlay `segment` op + style `refPush` | P0 | M3 EP-COMBAT | … in interaction.js), new `engine/world/meleeArc.js` `arcHits` (index.js export), overlay `segment` op + style `refPush`; tests `raySegment.test.js` (28) + `overlay.test.js` s10 (4); raySegment 0.001 ms/1.6 m ray, arcHits 16 ents 0.0004 ms, zero alloc; 172/172 suites, check-deps clean; no deviations. Was: todo [PC-A or PC-B cross-track; engine/world, physics, ui; ~0.75 d -> arch-review] arch 30.1 (full history: backlog-archive.md "Row history 2026-10-06") |
| US-078c | Sword pickup: tower.level.json patch, `sword.take`, flag `tower.sword.taken`, carried light left | P0 | M3 EP-COMBAT | … into main.js's `'world:loaded'` handler by the main session (not in the original per-story scope, but needed since nothing else called it). 22/22 story tests, `run-tests.mjs`/`check-deps.mjs`/`content-canonical.test.mjs` green (1 pre-existing unrelated FAIL in `engine/mesh/shadowList.test.js`). [PC-B content + game/js/quest; ~0.5 d] arch 30.1 **ARCH OK (opus 2026-10-01) + PO OK -> testing.** (full history: backlog-archive.md "Row history 2026-10-06") |
| US-078d | Swing sim (**light tap + hard hold-release, one motion, D-034**; no L/R chain) + hits + `combat:hit` + view (trail, sparks) + practice target | P0 | M3 EP-COMBAT | … retune/deviation. Report US-078d-knockback.md. NEEDS PC-A: diff-only review + PO/owner feel check. **ARCH OK (architect opus, 2026-10-05, 7f1e378; ee8474f merge is docs-only):** test-only, no runtime change; real arc/LOS hits on a mesh World, both hands, exact D-034 numbers (3 m/s generic add, beast assign 4 m/s, accel 12, 36 steps, 19/30 m shove, frozen facing). -> PO/owner feel check. (full history: backlog-archive.md "Row history 2026-10-06") **Owner walk-test 2026-10-06: left-hand sword + knockback good -> done. Regression found: the practice post took no hits since PROP-COLLIDE-01b (its own prism collider blocked the sword's world-ray + LOS gates) - fixed by PC-A (sword.js `hitsOwnShape`, tools/practice-hit.test.mjs, negative control fails without the fix).** |
| US-079 | First enemy with simple AI (Hush-touched beast): as a player I meet a beast that notices me, telegraphs, charges and can be beaten | P0 | M3 EP-ENEMY (opener) | todo (sketch, ACs below) [PC-A engine AI/entity hooks; PC-B brain + content] - needs architect notes + designer; after US-078, US-041b. **2026-09-30 (D-032 A1):** pathfinding already exists (RE-05 A*, RE-08 flow field, RE-09 steering, RE-10). The brain + nav chase part is split out as **US-079a** (sprint 5). The rest of US-079 (clips, damage, hurt/die, drops) follows US-078/080/083 **Owner 2026-10-06: "I like the new boar" - real wild boar model (3981ee8, PC-A designer) accepted.** |
| US-080 | Hearts, damage, death + respawn: as a player I see my hearts, lose them when hit and wake again at the last relay when I fall | P0 | M3 EP-HEALTH (opener) | todo (sketch, ACs below) [PC-B HUD/quest; PC-A `health` component + damage events] - needs architect notes + designer. **(PO 2026-10-01) Now HP + mana bars; ACs rewritten; split into US-080a (HP/damage/death, ~1 d) and US-080b (mana + pickups, ~0.5 d), see `### US-080`** **Architect note done (2026-10-01): architecture.md 30.2, steps US-080a1/a2/b (rows below); all PC-B game, no engine step.** Designer done 2026-10-01: `uiStyle.vitals` (HP `#` / MP `=` 20-cell bars at UI (2,1)/(2,2), low pulse, chip, mana-short flash, `hurtEdge`, `deathCard`) + `m3Sprites.pickupHp` / `pickupMp` + `pickupStyle`, in m3_props.js. Still NEEDS PC-A: m3Kit merge, writer death line (placeholder in `deathCard.lines[0]`). |
| US-080a1 | Vitals sim: `health`, `combat:hit` listener, falls, invuln, death timeline, respawn at save point, beast `resetAll`, dev keys | P0 | M3 EP-HEALTH | **ARCH OK re-review 2026-10-07 (opus batch; 305e615) -> PO re-check.** … No main.js wiring in this step (US-080a2's job). [PC-B game/js/quest/sim; ~0.6 d] arch 30.2 **ARCH CHANGES (opus 2026-10-01) + PO REJECT -> dev -> fixes done 2026-10-02 (PC-B main session, queue 11 item 1) -> `NEEDS PC-A: short re-review` (dispose/offCombatHit + `vitals.tick`, beacon.js save point, main.js uiLocked/movement-lock OR + F8/F9 debug keys; `vitals.test.js` 47/47).** (full history: backlog-archive.md "Row history 2026-10-06") |
| US-080a2 | Vitals view: HP bar (UI layer), hurt edge + kick, death fade + card | P0 | M3 EP-HEALTH | **ARCH OK re-review 2026-10-07 (opus batch; 305e615 + 7d8d2ad). Nit, non-blocking: `computeDeathCardState` still pushes 1-2 `{id,text,count}` literals per frame while dead - reuse preallocated line slots when next touched.** … + designer HUD art + writer card] arch 30.2 **ARCH CHANGES (opus 2026-10-01; PO OK) -> dev -> fixes done 2026-10-02 (PC-B main session, queue 11 item 1) -> `NEEDS PC-A: short re-review` (age math now off `vitals.tick` not `simTime`, `computeDeathCardState` reuses one module-level state object, HP HUD also hidden on title/map via `wakeOut.inputLocked`/`isMapOpen()`; `vitalsView.test.js` 64/64).** (full history: backlog-archive.md "Row history 2026-10-06") |
| US-080b | Mana + HP/MP pickups (= PO 080b) | P0 | M3 EP-HEALTH | **ARCH OK re-review 2026-10-07 (opus batch; a207938 chip fix, loot.js `spawnDrop` flow green, check-deps OK).** … eyeball HP/MP bars + a pickup once `m3Kit` merges. [PC-B game/js/quest, main.js ~6 lines; ~0.5 d; after a1] arch 30.2 **Owner crash 2026-10-02 (fixed a207938):** MP style has no `chip` -> `drawBar` threw on the first mana spend (hard swing); fix + regression test in vitalsView.test.js. Lesson: code-read PO OK missed a cross-bar style assumption - PC-B run a hard swing in the route-walk next time. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-081 | Lock-on / target focus: as a player I hold a key to keep the nearest enemy centred so first-person melee stays readable | P1 | M3 EP-COMBAT | todo (sketch) [PC-A camera + PC-B game] - after US-079. **2026-09-30: built as US-128** (Z-targeting on `engine.overlay`). This row closes when US-128 is done |
| US-082 | Combat feel: hit-stop (50-80 ms), knockback, camera kick, enemy flash, hit sparks/death dust, so every hit feels heavy | P1 | M3 EP-COMBAT | PC-B 2026-10-09: slice HITSTOP-01 done (pure, not wired). Was: todo (sketch) [PC-B game + PC-A particles] - uses US-053; sounds wait for M6 unless the owner lifts the freeze |
| US-083 | Character animation state machine (engine): named clip states (idle/walk/run/windup/attack/hurt/die) with rigid-part pose cross-fade and frame events, for voxel and mesh models | P0 | M3 EP-ENEMY | PC-B 2026-10-09: slices ANIM-STATE-01a/b done (pure, not wired). Was: todo (sketch) [PC-A] - extends US-041b; needs architect notes |
| US-084 | NPC navigation (engine): walkable nav grid over terrain + meshes, A* paths, steering on the capsule physics, per-frame budget | P1 | M3 (needed by M5) EP-ENEMY/EP-NPC | todo (sketch) [PC-A] - after ME-11 (mesh colliders); Rust/WASM only if benched hot (D-015). **2026-09-30:** A* / flow field / steering exist (RE-05/08/09/10, `engine/nav/`), and US-079a is their first game use. US-084 shrinks to: a walkability grid built from mesh colliders + building footprints (not only the terrain slope), capsule-physics following for NPCs, and a per-frame budget. Re-estimate after US-079a |
| US-085 | AI behaviour component (engine): data-driven state machine with perception (sight cone + line of sight, hearing, light awareness), home area, leash, reused by enemies, animals, NPCs | P1 | M3 EP-ENEMY | PC-B 2026-10-09: slice AI-PERCEIVE-01 done (pure, not wired). Was: todo (sketch) [PC-A] - generalises the US-079 brain |
| US-086 | Guard / block with a shield (and optional parry window) | P2 | M3 EP-COMBAT | todo (sketch) [PC-B] - owner question 1 (roadmap) |
| US-087 | Input action map (engine): actions (move/look/attack/interact/lock/use-tool/menu) instead of raw keys, rebindable, one source for keyboard/mouse/gamepad | P1 | M3 EP-INPUT | todo (sketch) [PC-A] - basis for US-107/108. **Scoped PC-B audit gate only: NEEDS PC-A: PO review**, implemented 2026-10-04 in main.js + quest/targetingInput.js/test: Q/Tab/wheel suppressed and targeting timers frozen during pause/Settings/map/death/wake/end; wheel discarded, resume works. 100 new checks PASS; 211/211 suites PASS, check-deps OK; mesh route reaches end trigger. See US-087 follow-up section. |
| US-089 | Save/load runtime: resting at a woken relay saves, autosave on area change, versioned saves through the platform adapter (CO-5 format) | P0 | M4 EP-SAVE | todo (sketch) [PC-B game + PC-A engine save API] - after CO-5, US-080 |
| US-090 | Title/start menu: New game, Continue, 3 save slots (label "Wick - place - play time", D-013), delete slot, Settings | P0 | M4 EP-SAVE | todo (sketch) [PC-B] - after US-089; designer title/menu style |
| US-091 | Inventory + item data: items as content JSON, equip slots (sword, 2 tool slots), inventory panel, quick-select | P0 | M4 EP-ITEMS | todo (sketch) [PC-B] - designer `uiStyle.inventory` + item icons |
| US-092 | Chests + pickups: small/big chests, open animation, item-get card, hidden chest on the hillside (was M2 plan) | P1 | M4 EP-ITEMS | todo (sketch) [PC-B content + designer] - after US-091 |
| US-093 | First tool item that opens an area = the **torch** (PO 2026-10-01, D-030 amendment 1 Q4; replaces the lamp/grapple hook): lights dark rooms and burns wooden barriers/webs/dry brush, with at least 3 gated spots in the world | P0 | M4 EP-ITEMS | todo (sketch) [PC-A engine if it needs physics/rope, PC-B game] - needs architect notes |
| US-094 | First small dungeon: 3-5 rooms, one puzzle chain (plate + boulder/lever + light), small key + locked door, mini-boss, the tool as reward | P0 | M4 EP-DUNGEON | todo (sketch) [PC-A designer level + PC-B behaviours] - after ME-21 (mesh buildings), US-091 |
| US-095 | Vessels + gear levels (PO 2026-10-01, D-030 amendment 1 Q7): a vessel (4 pieces = 1 vessel) raises max HP by +10 or max mana by +10 (player's choice at pickup); sword Lv2 reforged at a forge; no XP (D-020) | P1 | M4 EP-ITEMS | todo (sketch) [PC-B] - after US-080a/b |
| US-096 | Quest system (engine flags/objectives/events, save-safe) + journal page on the chart card | P1 | M4 EP-QUEST | todo (sketch) [PC-A engine + PC-B UI] - extends today's quest flags; pairs with US-042 |
| US-097 | Chart with live position, woken relays and discovered places (fast travel between relays = owner question) | P2 | M4 EP-QUEST | todo (sketch) [PC-B] |
| US-098 | Day/night cycle: sun path + sky/ambient colours over a 24 min day, relay and lamp light matter at night | P2 | M4 EP-WORLD | todo (sketch) [PC-A] - after ME-15 shadow maps |
| US-099 | Exile village "Outwall": 3-5 NPCs with idle routines, talk via US-042, first to say "Wick" (D-013) | P1 | M5 EP-NPC | todo (sketch) [PC-B content + designer + writer] - after US-042, US-084, US-085 |
| US-100 | Chapter-two region: open area along the pencil line with 3 dead relays, landmarks and terrain overrides as data | P0 | M5 EP-REGION | todo (sketch) [PC-A designer + PC-B content] - after US-026b; owner question 6 |
| US-101 | Artificer's gauntlet + Spark: first spell (light verb: lights braziers/relays, stuns enemies), cooldown or aether meter | P0 | M5 EP-MAGIC | todo (sketch) [PC-B game + PC-A particles/light] |
| US-102 | Second enemy: stray Crown clockwork sentinel (patrol, ranged, weak spot) | P1 | M5 EP-ENEMY 2 | todo (sketch) [PC-B brain + designer] - after US-085 |
| US-103 | Ranged tool: bow or crossbow with arrows as physics bodies | P1 | M5 EP-ENEMY 2 | todo (sketch) [PC-A projectile physics + PC-B game] - unless it is the M4 tool |
| US-104 | Secrets + collectibles pass: hidden chests, heart pieces, chart pieces in chapters one and two | P2 | M5 EP-REGION | todo (sketch) [PC-B content] |
| US-105 | The Signal Source dungeon + boss (reason for the SOS, D-013 deferred reveal) | P1 | M5 or post-1.0 (owner question 5) | todo (sketch) [PC-A designer + writer] |
| US-106 | Crash intro: the *Kestrel* escape and crash as a short in-engine sequence before the wake (owner idea D-020) | P2 | M6 EP-POLISH | todo (sketch) [PC-B + designer + writer] |
| US-107 | Gamepad support: Steam Deck layout, look curve, UI navigation with the stick, button prompts | P0 | M6 EP-INPUT 2 | todo (sketch) [PC-A input + PC-B UI] - after US-087; US-043 needs it |
| US-108 | Key remapping row in Settings (keyboard + gamepad), conflicts shown, remembered | P1 | M6 EP-INPUT 2 | todo (sketch) [PC-B] - after US-087 |
| US-109 | Music: procedural/adaptive score (exploration, combat, relay wake stinger, night) | P1 | M6 EP-AUDIO | todo (sketch) [PC-B] - owner deferred sound to M6 |
| US-110 | Accessibility: cell-size / font scale, colourblind palette variants, toggle vs hold, visual cues for sounds, reduced shake | P1 | M6 EP-POLISH | todo (sketch) [PC-B + designer palettes] |
| US-111 | Performance + Steam Deck pass: 60 fps at 240x90 on the Deck, load times, memory | P0 | M6 EP-POLISH | todo (sketch) [PC-A] |
| US-112 | itch.io browser demo build (M1 + walk-out + combat slice), static bundle, page text by the writer | P1 | M3 exit EP-RELEASE | PC-B 2026-10-09: PC-B tooling parts PERF-GATE, COMBAT-CAPTURE done. Was: todo (sketch) [PC-B] - was end of M2 (D-012) |
| US-113 | Engine API reference generated from JSDoc (ME-00 types) + concept guide + content-format spec | P1 | Engine track EP-DOCS | todo (sketch) [PC-B tool + PC-A architect text] |
| US-114 | Engine examples: 3 runnable samples in `examples/` (lit room, terrain walk, props + physics), smoke-tested in run-tests | P1 | Engine track EP-EXAMPLES | todo (sketch) [PC-B] - after ME-19 |
| US-115 | Public API freeze: `@public`/`@internal` tags, semver 0.x, CHANGELOG, deprecation rule | P1 | Engine track EP-API | todo (sketch) [PC-A architect] - after US-047, ME-00 |
| US-116 | Licences: engine licence, `LICENSE` + `THIRD_PARTY_NOTICES` (TypeScript devDep, Electron/steamworks.js in the game build, fonts), asset licence for `design/` | P1 | Engine track EP-LICENSE | todo (sketch) [owner decision + PC-B] - owner question 10 |
| US-117 | Standalone engine package (ESM zip/npm, no build step) + engine name | P2 | Engine track EP-PACKAGE | todo (sketch) [PC-B] - after US-113..116 |
| US-118 | Localisation-ready strings: all UI/hint/dialogue text through one string table, ASCII-safe per locale | P2 | M6 EP-POLISH | todo (sketch) [PC-B + writer] |
| US-079a | First beast, brain + nav chase (no damage): a placeholder boar wanders, notices, paths around rocks/tower with RE nav, winds up and charges | P0 | M3 EP-ENEMY (sprint 5) | **PO OK 2026-10-01 (sonnet batch) -> testing; owner checks: "does it feel like it hunts me" (charge seen OK), nav stuck cases on a longer walk; placeholder look accepted** (was: dev done -> arch-review (PC-B, 2026-10-01)); **owner look 2026-10-01: boars notice and charge OK; placeholder does not read as a boar - accepted for test, real boar model + clips = US-079 (designer)**, ACs below [PC-B brain + content; PC-A architect note first] - architect note: architecture.md 29.1 |
| US-128 | Z-targeting: lock on to the nearest visible target, with a ring under it + a bar through `engine.overlay`, target cycling and the camera kept turned to the target (replaces the US-081 sketch) | P1 | M3 EP-COMBAT (sprint 5) | … story note). AC 7 (owner feel check) and the mesh-renderer walk still open. **US-128b PO OK (opus PO, 2026-10-02, 4100705) -> testing.** Owner walk-test: `?renderer=mesh`, Q-lock a boar, Tab-cycle to a second, walk past 20 m; lock reads clearly and is not nauseating at 240x90 and 400x150. Nit (fold into US-087): main.js:833-835 `uiLocked` does not cover the pause overlay, Q can lock while paused. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-129 | Enemy colour tiers: one beast model in 3 tiers (green / blue / red) via the team remap (RE-06 `setTeamMaterials`, `team.*` slots), with per-tier stats as data (HP x1/x2/x3, speed +0/+10/+20 %) | P2 | M3/M4 content | todo (sketch) [PC-B content + designer tier materials] - after US-079. AC sketch: 3 tiers can be told apart at 10 m at 240x90, one instanced model, tier set in content `entities[].tier` |
| US-130 | Map exploration: the chart card shows only the areas the player has seen (RE-11 `Visibility` grid over the overworld, saved via RE-11b), and dungeon maps fill in room by room | P1 | M4 EP-MAP | todo (sketch) [PC-B chart UI + PC-A architect note (first-person reveal radius/cone vs RE-11 unit sight)] - pairs with US-097. AC sketch: an unseen area is blank on the chart; walking there reveals it within 1 s; the result survives a save/load; a dungeon room shows on the map once entered |
| US-131 | Overworld minimap (RE-13), optional corner widget with fog from US-130 and a player arrow | P2 | M4 EP-MAP | todo (sketch) [PC-B] - **owner question: minimap on screen, or chart card only (Zelda-style)?** |
(US-088 intentionally unused: gear levels are folded into US-095.)

### US-078 Sword swing + hit detection  [Priority: P0 (M3 opener)] [Status: todo (sketch)]  [PC-A engine / PC-B game]
As a player, I want to swing a sword with the mouse and have it hit what it visibly touches, so that the world outside the tower can be fought in, not just walked.
Acceptance criteria:
- [ ] **Getting it (PO 2026-10-01, D-030 amendment 1 Q3):** the ruin-steel sword lies inside the tower at a designer-placed spot (a rack, plinth or the old guard's remains; not on the hillside), reachable from the wake spot without leaving the tower (`[E] Take sword`). Before that, attack input does nothing. Taking it sets a save-safe flag and the prop disappears.
- [ ] **Swing (owner 2026-10-01, D-034: one swing motion, light + hard):** left mouse (action `attack`). **Tap = light swing:** 0.35 s (windup 0.08 / active 0.12 / recover 0.15), damage 1 (x `damageScale`), no cost; pressing again during recover queues one more light swing (same motion), max 2, then 0.25 s rest. **Hold >= 0.4 s then release = hard swing:** the wind-up pose is held and shown while charging; release swings with damage x3, knockback + stagger (interrupts a beast windup/charge, pushes it ~1.5 m), costs 4 mana (not allowed / falls back to a light swing below 4 mana, with the US-080b mana-short flash); slower and risky: recover 0.45 s, walk x0.3 while charging and recovering. Walk speed x0.6 during a light swing; no swing in mid-air in M3. Numbers are placeholders for the owner feel check.
- [ ] **View model:** the sword is drawn in the lower right of the view as a first-person model with idle sway, a readable swing arc (>= 5 poses per swing) and never clips into walls (drawn in its own depth range). Readable at 160x60 and 240x90. With the sword taken, the carried light moves to the left side (0.3 m left instead of right, GDD 7.3).
- [ ] **Hit detection:** during the active window only, a hit arc in front of the eye: reach 1.6 m, 100 deg horizontal, from 1.0 m below to 0.3 m above eye height. Targets are entity hurt spheres; a target is hit at most once per swing; a target behind world geometry (ray from the eye to the hit point blocked) is not hit.
- [ ] **Hit event:** each hit sends `hit {source, target, damage: 1, dir, point}` to the target's behaviour. A test target (designer: a mossy practice stump or old armour stand near the sword) flashes white for 0.1 s and shows a 3-cell spark at the hit point.
- [ ] **World hit:** if the arc meets a wall/terrain within reach first, the swing stops early with a `*` spark for 0.1 s and 0.05 s hit-stop ("clink").
- [ ] **Hit event (PO 2026-10-01):** hits are also emitted as `combat:hit {source:'player', target, damage:1}` on `engine.events` (architecture.md 29.1) so US-080 and US-079a share one channel.
- [ ] **Block/parry hook (PO 2026-10-01, Q1):** the swing state exposes `canSwing()` and an `onBlockStart/onBlockEnd` seam so the shield (US-086) can cancel a swing and block; no shield logic in this story.
- [ ] **Tests:** Node tests for the arc query (in arc = hit, outside angle/reach = miss, behind a wall = miss, one hit per swing, chain timing) at the fixed 60 Hz step, deterministic. Hit query <= 0.1 ms with 16 entities, no per-frame allocation.
Design needed: yes - sword view model (idle + 2 swing directions, >= 5 poses each), world sword prop placed in the tower, practice target, spark glyphs (designer). **NEEDS PC-A: Designer done 2026-10-01 (preview verified by the main session: 39 checks PASS, no console errors): design/models/sword.js (voxelModels.sword pickup + swordHeld + viewModels.sword idle/swingLR/swingRL/trail/sparks, README 7.4), preview design/preview/sword.html; placement = levelPatch.towerSword (sword (12.86, 6.12, z 0.9) facing 110 in rubble heap cell 12,6, [E] Take sword, flag tower.sword.taken, scrawl STEEL FOR THE HUSH for the writer). Still NEEDS PC-A: swordKit merge (3 colours + 6 materials into palette.js/detail-pass.js, script tag), practice-target model (spot 14.6, 6.6), architect note for the view-model layer (owner: no hand/glove drawn, Wick never seen - OK?), architect note (PO 2026-10-01).**
Notes / dependencies: **needs architect notes (engine: hitboxes/hurt spheres, arc query in `World`, view-model render layer on the mesh pass, event routing).** **Needs designer (sword/enemy art).** After the phase-2 gate (ME-11 colliders) and ME-19 at best; can prototype on the current renderer if the architect agrees. US-082 adds the full feel; sounds wait for M6.

### US-079 First enemy with simple AI (Hush-touched beast)  [Priority: P0 (M3 opener)] [Status: todo (sketch)]  [PC-A engine / PC-B brain + content]
As a player, I want to meet a beast that notices me, warns me, charges and can be beaten, so that the sword has a purpose and the wild outside the Wall feels dangerous.
Acceptance criteria:
- [ ] **Model:** a creature about 1.0 m long and 0.7 m tall (working: a Hush-touched boar; owner question 2) with clips idle, walk, run, windup, charge, hurt, die (US-041b / US-083). Silhouette readable at 10 m at 160x60.
- [ ] **Stats:** 3 HP (3 sword hits), contact damage 1 heart, walk 1.5 m/s, chase 4.5 m/s, charge 7 m/s. Same capsule physics as the player (no climbing above step-up, turns back at drops > 1 m).
- [ ] **States:** `wander` (within 6 m of home, 2-4 s pauses) -> `notice` (player within 12 m inside a 120 deg view cone with line of sight, or within 3 m in any direction; 0.6 s pause with a `!` above its head) -> `chase` -> `windup` at 5 m (0.5 s, visible scrape + lowered head) -> `charge` (straight line up to 1.2 s or until it hits a wall/the player) -> `recover` (1.0 s, 2.0 s after a wall hit = open to hits) -> back to `chase`. `return` home and heal to full when the player is > 20 m away or out of sight for 5 s.
- [ ] **Hurt/die:** a hit flashes it white 0.1 s, flinches it 0.25 s and knocks it back 1.5 m; a hit during `windup` cancels the charge. At 0 HP: die clip 0.6 s, then it fades into dust over 0.5 s and is removed; 50 % chance to drop a heart (US-080).
- [ ] **Light:** it never enters a woken relay's light radius (safe zone, pillar "light is life").
- [ ] **Content:** 2 beasts placed on the hillside as `entities[]` in content JSON (`brain: "beast"`), none within 15 m of the breach. Killed beasts come back after a relay rest or a reload.
- [ ] **Tests + budget:** Node tests drive every state transition with scripted player positions; a 600-step replay is deterministic. AI for 8 beasts <= 0.3 ms/frame JS, no per-frame allocation.
Design needed: yes - beast model + 7 clips, `!` alert glyph, dust fade (designer). Writer: the beast's name.
Notes / dependencies: **needs architect notes (engine: AI/brain component hooks, perception ray, entity spawn/despawn + respawn state).** **Needs designer (sword/enemy art).** After US-078, US-041b; uses US-080 for damage. US-085 later generalises the brain; US-084 pathfinding is not needed here (direct steering + edge check). **2026-09-30:** superseded. The chase uses RE-05/09 nav (see US-079a), so the states + pathing ACs move there and this story keeps model/clips, hurt/die, drops, light safe zone and respawn.

### US-080 Hearts, damage, death + respawn  [Priority: P0 (M3 opener)] [Status: todo (sketch)]  [PC-B HUD/quest / PC-A health component]
**Rewritten (PO 2026-10-01, D-030 amendment 1 Q7/Q9): HP + mana bars, no hearts. Split: US-080a = HP, damage, death/respawn (ACs 1-5, 8); US-080b = mana + pickups + dev keys (ACs 6, 7).**
As a player, I want to see my HP and mana bars, lose HP when I get hit and wake again when I fall, so that fights have stakes but never cost me my progress.
Acceptance criteria:
- [ ] **1. HP bar (080a):** top-left bar, 20 cells wide (designer glyph art, ASCII 32-126 only, `[####....]` style), a number `hp/max` beside it, start 30/30. Readable at 160x60 and 240x90, hidden during the title, map and end cards. At <= 25 % the bar pulses red at 1 Hz.
- [ ] **2. Health component (080a):** player `health {hp, max}` as an entity component in the serialized state (survives save/load, CO-5); `max` is raised later by US-095 vessels.
- [ ] **3. Damage via events (080a):** a listener on `engine.events` `combat:hit {source, target, damage}` (architecture.md 29.1) applies `damage` to `target` when the target is the player; US-079a's beast already emits it (1 -> scaled to 5 HP by a `damageScale` constant, noted in the row). Falls > 6 m = 5 HP, > 10 m = 10 HP (changes GDD 5 "no fall damage"). On damage: 1.0 s invulnerability, red screen-edge flash 0.15 s, knockback 2 m/s away from the source, 2 deg camera kick.
- [ ] **4. Death + respawn (080a, D-030 amendment 1 Q9):** at 0 HP controls lock, the eye sinks to 0.4 m over 0.8 s, fade to black 1.5 s, card (writer text) with `[E] Wake again`. Respawn at the last save point (a woken relay; the tower wake spot until one exists, plus the autosave position once US-089 exists) with full HP and mana; enemies reset to home; world flags (torch, lever, sword, chests) are kept.
- [ ] **5. Dev (080a):** with `?debug=1`, one key toggles invulnerability and one deals 5 HP to the player.
- [ ] **6. Mana bar (080b):** a second bar below the HP bar in blue, 20 cells, `mp/max`, start 20/20 (`mana {mp, max}` component, serialized). `spendMana(n)` returns false and flashes the bar when short; regenerates 1 per 2 s, paused 3 s after spending. Nothing spends mana yet (D-021 spells later).
- [ ] **7. Pickups (080b):** a red restore-HP drop (+10 HP) and a blue restore-mana drop (+10 MP): they bob, are collected within 0.8 m, despawn after 20 s (blink the last 3 s); the beast drops one with 50 % chance (US-079a hook).
- [ ] **8. Tests (080a/b):** Node tests for damage/invulnerability timing, fall thresholds, death -> respawn (flags kept, HP and mana full, enemies reset), save round trip of `health` and `mana`, mana regen/spend timing, deterministic at the 60 Hz step.
Design needed: yes - HP/mana bar glyph art (frame, fill, low-pulse), pickup drops, damage flash colour, death card style (designer); death card text (writer).
Notes / dependencies: **needs architect notes (engine: `health` component + damage events, respawn hook in `World`).** **Needs designer (heart/HUD art).** Pairs with US-079; HP/mana upgrades come in US-095; relay save + autosave = US-089. **ACs rewritten 2026-10-01 per D-033 (PO).** **NEEDS PC-A: designer HP/mana bar art + architect note (health/mana components, respawn hook).**

### US-079a First beast, brain + nav chase  [Priority: P0 (M3, sprint 5)] [Status: dev done -> ARCH OK (batch 2026-10-13)]  [PC-B brain + content / PC-A architect note]
As a player, I want a beast on the hillside that notices me, finds its way around rocks and the tower, and charges me, so that the world outside feels alive and dangerous before the sword exists.
Acceptance criteria:
- [x] 1. **Placeholder model:** a simple voxel boar block (~1.0 m long, 0.7 m tall), readable as an animal at 10 m at 240x90. The programmer may build it; final art + clips = US-079 / US-041b. Only facing changes, no clips.
- [x] 2. **States** (numbers from US-079): `wander` (<= 6 m from home, 2-4 s pauses, walk 1.5 m/s) -> `notice` (player <= 12 m inside a 120 deg cone with line of sight, or <= 3 m any direction; 0.6 s pause, `!` above its head drawn as an overlay marker) -> `chase` (4.5 m/s) -> `windup` at 5 m (0.5 s) -> `charge` (7 m/s straight line, <= 1.2 s or until it hits a wall/the player) -> `recover` (1.0 s, 2.0 s after a wall hit) -> `chase`. `return` home when the player is > 20 m away or out of sight for 5 s; `return` walks at 1.5 m/s and may re-notice the player on the way (PO 2026-10-01).
- [x] 3. **Pathing:** `chase`/`return` follow an RE-05 A* path on a 1 m NavGrid (walkability from the terrain slope + water + tower footprint blocked; setup like `game/js/rts/sim/navSetup.js`, placed where the architect says). Re-path at most every 0.5 s or when the player moves > 2 m. RE-09 steering keeps 2 beasts from overlapping. In 5 scripted chases from the far side of the tower, the beast reaches the player without getting stuck. It never walks down a drop > 1 m.
- [x] 4. **Ground:** the beast stands on the terrain/mesh height (`supportAt` on `physics=mesh`) with no floating or sinking > 0.1 m on the hillside.
- [x] 5. **Contact:** when a charge reaches the player, a `combat:hit {source, target, damage: 1}` event is emitted on `engine.events` (no-op until US-080) (PO 2026-10-01). No player damage in this story.
- [x] 6. **Content:** 2 beasts in content JSON `entities[]` (`components.brain {kind: "beast", home}` + `components.targetable {radius, height}`) (PO 2026-10-01), none within 15 m of the breach, placed on the hillside route before the waystone.
- [x] 7. **Determinism + budget:** fixed step, seeded RNG, no wall clock (D-032 item 5). Node tests drive every state change with scripted player positions. The 600-step replay is bit-equal on two runs within one world load (not cross-machine, `groundAt`) (PO 2026-10-01). 8 beasts <= 0.3 ms/frame JS incl. pathing (paths amortised), zero per-frame allocation.
- [x] 8. `node tools/run-tests.mjs`, `node tools/check-deps.mjs` (game imports only `engine/index.js`, never `game/js/rts/`) green; `?gpucompare=1` unchanged. One browser pass on `?renderer=mesh&physics=mesh`.
Design needed: no (placeholder). Designer boar + clips come with US-079.
Notes / dependencies: dev only after the ME-12 GO. **NEEDS PC-A: architect note** (where the brain lives: `game/js/quest/` vs an engine `brain` hook, perception ray API, entity spawn from content, and whether the walkability setup moves from `game/js/rts/` into `engine/nav/`). Owner check: "does it feel like it hunts me?"

**dev done -> arch-review (PC-B, 2026-10-01).** Full SoA state machine per architecture.md 29.1: `game/js/quest/sim/beastConfig.js` (`BEAST_DEFAULTS`/`toSteps`), `sim/sight.js` (`canSee`, chunks any >5m segment into <=5m `hasLineOfSight` calls to keep the engine's 20-sample cap at 0.25m spacing), `sim/beastNav.js` (`buildBeastNav` wrapping `NavGrid.buildFromWorld` + A*, using RE-05c's `maxStepM`), `sim/beastSim.js` (`createBeastSim`, zero-alloc `step/hashInto/save/load/resetAll`), `beastView.js` (presentation-only, `yawFromDelta` not raw `atan2`, draws the `!` notice marker). `design/models/voxel_beast.js`: placeholder `boarPlaceholder` (0.5x1.0x0.7m, reuses already-merged `leather`/`canvas_dark` materials, no palette/detail-pass merge needed). `content/worlds/world_m1.world.json`: world-level `nav` block + `boar1`/`boar2` entities (~26m/~43m from the breach, verified walkable/flat). `game/js/quest/sim/beastSim.test.js`: 19 assertions (notice cone in/out, LOS-blocked unseen-timer return, >20m immediate return, wall-hit recovery, exactly-one-`combat:hit` contact, 5 scripted chases from 4 tower corners + 1 depth crossing all reaching contact <=30s never in a cost-0 cell and z within 0.1m of `supportAt`, 600-step determinism replay, save@300/load/same-hash@600, the RE-05c drop rule through `buildFromArrays`). Perf (8 beasts, worst case all chasing): mean 0.014 ms/step, p95 0.041 ms - well inside the 0.1/0.3 ms budget; zero-alloc heap check over 10k steps passes.

**Main session wiring** (not per-story scope, applied after both parallel agents finished): `game/index.html` 1 `<script>` line for `voxel_beast.js`; `game/js/main.js` - `createRng` added to the engine import, `createBeastSim`/`presentBeasts`/`questOverlayStyles` imports, `beasts` module-level var, `beasts = createBeastSim(world, {nav: worldDef.nav, rng: createRng(worldDef.nav?.seed ?? 1), events: engine.events})` in `'world:loaded'` next to `playerHandle`, `beasts.step(pt.x, pt.y, pt.z)` after `resolveBodyContacts`, `engine.overlay.clear()` + `presentBeasts(...)` right before the RE-07 overlay flush, `engine.overlay.setStyles(questOverlayStyles(assets.uiStyle))` + a resolved `ovlStyles = {beastNotice: engine.overlay.styleId('beastNotice')}` at boot. New `game/js/quest/overlayStyles.js` (`questOverlayStyles(uiStyle)` forwards `uiStyle.overlay` as-is - no style invented, just the one call site 29.1 asked for) and one placeholder `beastNotice` style (`!`, alert yellow) added to `design/models/title.js`'s existing `A.uiStyle.overlay` block (the US-128 designer styles were already there; `beastNotice` was the missing one blocking this wiring).

**Deviations flagged by the programmer** (none silent): (1) the "behind the tower"/"hidden 5s" ACs collapse into one test scenario - geometrically, no two points on opposite sides of the 24x14m tower footprint can both be within the 12m noticeR, so only the 20m loseR path can ever exercise occlusion; (2) `stats.astarNodes` approximates accumulated path length, not a true expanded-node count (`engine/nav/astar.js` never exposes that number); (3) two tuning constants not in the AC's numbered list (`DEFAULT_ACCEL 12 m/s^2` for non-charge states, wander/travel `maxNodes` 500/3000 split) and the charge wall-slow-streak counter reuses the otherwise-unused `unseen` field rather than adding a new SoA array.

Verification: `node game/js/quest/sim/beastSim.test.js` 19/19; `node tools/run-tests.mjs` green (1 pre-existing unrelated FAIL in `engine/mesh/shadowList.test.js`); `node tools/check-deps.mjs` OK, no new warnings (the beast `sim/**` files are clean on rule 15). Headless `tools/capture-browser.mjs --mode gpucompare` smoke-passed on both the default renderer and `?renderer=mesh` with the real world_m1 content (beasts + sword + overlay wiring all live in the render loop) - all poses PASS, no console errors - standing in for AC 8's "one browser pass" (no interactive Chrome available in this sandbox).

### US-128 Z-targeting (lock-on)  [Priority: P1 (M3, sprint 5)] [Status: po-review]  [PC-A camera + architect note / PC-B game wiring]
As a player, I want to lock on to an enemy with one key and keep it in view, so that first-person melee stays readable when the beast circles or charges.

**US-128b programmer report (2026-10-02).** `game/js/quest/targeting.js` (`createTargeting(world, events, cfg)`:
`step`/`present`/`clear`) + `targeting.test.js` (43 checks: centre-weighting, range 15/break 20 edges, LOS-hidden
skip + 60-vs-54-step break timing, cycle order+wrap, dead/removed breaks lock, `noTargetT`, present() ring/bar/fade/
no-target ops, perf <=0.05 ms + zero-alloc over 10k steps). `node tools/run-tests.mjs`/`check-deps.mjs` green (same
2 pre-existing unrelated FAILs + 1 WARN as baseline, nothing new). `engine/ui/overlay.test.js` unchanged (21/21).
Deviation (reasonable call, not a silent guess): the FOV test uses a horizontal dot product against a
`cos(hfovDeg/2)` threshold computed once at create time, not an atan2 yaw-offset per candidate per step (yaw-offset
math is used, as 29.2 says, for the Tab/wheel cycle - an occasional, not per-step, path). AC1-6 implemented; AC7
(owner feel check) and part of AC8 (the mesh-renderer walk) still need the main.js wiring below + an owner pass.
**main.js wiring (5 lines, main session applies):**
1. import: `import { createTargeting } from './quest/targeting.js';`
2. after world load (next to `beasts =`/`vitals =`): `targeting = createTargeting(world, engine.events, {});` then
   pass it into vitals' hooks (`createVitals(..., { beasts, targeting })`, replacing the current `targeting: null`).
3. in `update`, before `look.update(dt)`: `if (targeting) targeting.step(dt, input.pressed('KeyQ'), cycleDir(input), playerHandle.data, look);`
   where `cycleDir(input) = (input.pressed('Tab') ? (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? -1 : 1) : 0) + input.consumeWheel();`
4. in `render`, after `presentBeasts(...)`: `if (targeting) targeting.present(engine.overlay, ovlStyles);`
5. boot, next to the existing `engine.overlay.setStyles(...)`/`ovlStyles` lines: extend `ovlStyles` with
   `target: engine.overlay.styleId('target')`, `targetFade: engine.overlay.styleId('targetFade')`,
   `targetNone: engine.overlay.styleId('targetNone')`, `targetBarFill: engine.overlay.styleId('targetBarFill')`,
   `targetBarEmpty: engine.overlay.styleId('targetBarEmpty')` (styles already in `design/models/title.js`); also
   `engine.overlay.setGroundFn((x, y) => world.terrain.groundAt(x, y))` once at boot (terrain always exists outdoors).

Acceptance criteria:
- [ ] 1. **Lock:** `Q` (action `lock` once US-087 exists) locks the best target: the entity with a `targetable` flag that is <= 15 m away, in line of sight, and closest to the screen centre. Pressing `Q` again unlocks (toggle; hold mode = a later settings option). No target in range = a short "no target" tick (two 1-cell `x` at the crosshair +-2 cols, style `targetNone`, 0.3 s), no lock (PO 2026-10-01).
- [ ] 2. **Ring + bar:** a locked target shows an `engine.overlay` ground ring under it (radius = target radius + 0.2 m; designer colour, placeholder `ui.target`). It follows slopes and is hidden behind terrain/walls like the RE-07 rings. A small bar above it shows its HP when it has `health` (full bar placeholder until US-080).
- [ ] 3. **Camera:** while locked, the view yaw turns toward the target at <= 360 deg/s (pitch toward it, clamped to the pitched 70 deg clamp). Mouse look is damped to 25 % and becomes an offset around the target, clamped to +-20 deg yaw / +-10 deg pitch, no decay (PO 2026-10-01; owner tunes at the feel check), and movement becomes strafe/circle around the target.
- [ ] 4. **Cycle:** mouse wheel or `Tab` switches to the next valid target left/right of the current one. The ring moves at once.
- [ ] 5. **Break:** the lock drops when the target dies/despawns, goes > 20 m, or stays out of line of sight > 1.0 s. The ring fades out in 0.2 s (overlay has no alpha: the ring is drawn 0.2 s in the dimmer `targetFade` colour, PO 2026-10-01). Designer done (2026-10-01): styles in design/models/title.js ASSETS.uiStyle.overlay - target, targetFade, targetNone, targetBarFill, targetBarEmpty (29.2 ids); pass the object to engine.overlay.setStyles (merge with any other setStyles call) (placeholders fine for dev).
- [ ] 6. **Tests:** Node tests for target choice (centre-weighted, range, line of sight), cycling order, break rules and the yaw turn rate at the fixed step. Target query for 16 entities <= 0.05 ms, zero allocation.
- [ ] 7. **Owner feel check** on `?renderer=mesh` with the US-079a beasts: locking reads clearly at 240x90 and 400x150, and the camera turn does not make you sick.
- [ ] 8. Suites + check-deps green. Overlay tests + `rtsOverlay` gpucompare pose unchanged.
Design needed: yes, small. Lock ring colour/glyph + "no target" tick (designer `ui.target`); a placeholder is fine for dev.
Notes / dependencies: after US-079a. Uses RE-07 overlay (engine, done) and RE-04 pick/line-of-sight if useful. **NEEDS PC-A: architect note** (lock-on camera turn in `PlayerLook` as an option vs game-side, overlay ring API for a first-person view). Replaces the US-081 sketch.

---

## Engine refactor backlog – architect survey 2026-09-24 (D-006/D-010 reuse; not milestone-gated)

### US-046 Engine-owned frame renderer (`createWorldRenderer`)  [Priority: P1 (M1.5)] [Status: todo]
As a programmer building the M1.5 editor, I want the per-frame render orchestration extracted into an engine-owned `WorldRenderer`, so that both the game and the editor share identical frame assembly/render/present logic without duplicating subtle ordering rules.
Acceptance criteria:
- [ ] New `engine/render/WorldRenderer.js` exposes `renderer.frame(world, camPose, timeSec)` (fb assembly: GBuffer/MaterialTable/light buffer/`gpuDda`; `syncEntityLights` + `lights.update`; `renderWorld` vs `gpuPipeline.frame` choice incl. the `rt.gpuActive` context-loss rule; sprites; `present`) plus `renderer.stats`; overlay/crosshair stay caller-side.
- [ ] `engine/index.js` exports `createWorldRenderer` per an updated architecture.md section 5.
- [ ] `game/js/main.js` `runGame` is rewritten to call the new renderer.
- [ ] `?gpucompare=1` ALL PASS and all Node suites green, no behaviour change.
- [ ] `node tools/check-deps.mjs` OK.
Design needed: no.
Notes / dependencies: architect tech notes first (render ordering, context-loss rule). Must land before US-031 (M1.5 editor shell). See docs/architecture.md "Refactor candidates" item 1.

### US-049 D-017 pruning of fallback-only render code  [Priority: P1] [Status: todo]
As the architect/programmer maintaining the render backends, I want the fallback-only CPU code paths pruned now that the GPU path is the sole oracle-backed renderer (D-017), so that the API surface stays small for the M1.5 editor and there is only one shading reference to keep in parity.
Acceptance criteria:
- [ ] `cpuLightCap`/`selectCpuLights` (`lighting.js`) and the legacy inline-shade path (`?detail=0`, `fastShade.js`) are removed or reduced to `buildPowLUT` only, per the architect's call.
- [ ] `cpuGrid` forcing is removed where it is fallback-only.
- [ ] `?gpucompare=1` ALL PASS and all Node suites green, no behaviour change (the GPU/oracle output is bit-identical to before the prune).
- [ ] `tools/bench-cast.mjs` and affected tests updated so their numbers still mean what their docs say.
Design needed: no.
Notes / dependencies: the D-017 AC cleanup itself is already done (commit b462778); this story is the code prune. Pick up any time after the remaining M1 P0 stories are `done` — not gated on M1.5. Canvas2D/`force2d` removal is a separate later step, not in this story. Architect tech notes first (bit-identical oracle requirement).

## Milestone 5 "Engine Editor v0" – sketches (D-010, not yet refined; not M1 scope)

### US-035 Model frame editor  [Priority: P0 (M5)] [Status: todo (sketch)]
As a designer, I want a per-direction glyph/fg frame editor for ASCII models, so that I can draw a character's look without hand-writing frame data.
Acceptance criteria (sketch):
- [ ] `tools/model-editor/` grid editor: paint glyph + fg color per cell, per facing direction (at least 4-directional).
- [ ] Palette picker pulls from the master palette (US-002), no free-form colors outside it.
- [ ] Live preview of the current frame at in-game scale (per US-011 sizing).
- [ ] Copy/mirror a frame across directions to speed up symmetric poses.
- [ ] Frame data matches the existing ModelDef frame shape (no new format invented here).
Design needed: yes (the palette and an example model to edit against, e.g. the hero).
Notes / dependencies: US-011, US-002. Depends on the M1.5 editor shell's picking/render plumbing where reusable.

### US-036 Animations + events + preview  [Priority: P0 (M5)] [Status: todo (sketch)]
As a designer, I want to sequence frames into named animations with fps/loop and per-frame events, and preview them live, so that I can author walk/attack/hit cycles.
Acceptance criteria (sketch):
- [ ] Named animation tracks (e.g. "walk", "attack") each with an ordered frame list, fps, loop flag.
- [ ] Per-frame `events` (named tags, e.g. "hit", "footstep") editable and shown on the timeline.
- [ ] Onion-skin overlay of adjacent frames while editing.
- [ ] Live preview plays the animation using the real engine animation player (US-011), not a mock.
- [ ] Scrub/step controls (play, pause, step frame, loop toggle).
Design needed: no (consumes US-035 frames).
Notes / dependencies: US-035, US-011 (animation player).

### US-037 ModelDef JSON save/load  [Priority: P0 (M5)] [Status: todo (sketch)]
As a designer, I want to save a model's frames and animations to a ModelDef JSON file and load it back, so that models are authored as portable data.
Acceptance criteria (sketch):
- [ ] "Save" writes a ModelDef JSON to `design/models/` matching the engine's existing ModelDef schema.
- [ ] "Load" reads a ModelDef JSON back and reconstructs identical frames/animations (round-trip check).
- [ ] Schema version field, consistent error handling with US-027/US-034.
- [ ] Saved ModelDef loads correctly through `AssetRegistry` into a running game scene as a sanity check.
Design needed: no.
Notes / dependencies: US-035, US-036, US-027 (shared JSON conventions).

**D-016 note for US-035..037:** the model editor also edits **voxel models** (`ModelDef.voxel`, US-039). It needs a z-layer painter over row strings, a part-box tool (drag boxes, set pivots) and a rigid-part keyframe panel (`rot`/`pos` per part per frame, `events`). The live preview runs the real US-041 renderer. Saved voxel ModelDefs round-trip through the US-039 validator.

---

## Engine capability before M3: 3D glyph models (D-016, voxel + rigid parts; spec `docs/architecture.md` section 15) – sketches

Goal: creatures and NPCs (e.g. a talking bear) that the player can walk around, rendered per cell into the G-buffer as `KIND_MODEL (8)`, so they get the world's materials, the edge pass and lighting, and read as glyphs. Budget: model pass <= 0.5 ms p95 at 240x90, whole GPU pipeline still <= 4 ms. Interim for M1-M2: 8-direction billboards (Option C) through the US-030c sprite pass. Option B (meshes) is rejected for now. All three are engine stories (architect tech notes and review).

### US-041b Voxel creatures: `idle`/`walk` clips, bear model, voxel preview page  [Priority: P0 (before M3)] [Status: todo (sketch)]
As a player, I want a bear that breathes, turns its head and walks, lit by my lamp and the sun, so that creatures feel alive and physical.
Acceptance criteria (sketch):
- [ ] Creature clips on the US-041a mechanism: `idle` and `walk` clips, `events` (e.g. `step`) fire like sprite events (US-011), animation update <= 0.02 ms per entity. Facing follows the entity yaw each step (free yaw, US-041a).
- [ ] **Designer:** a bear voxel model (about 16x8x12 at 0.125 m, `idle` + `walk`) and `design/preview/voxel.html` (orbit, light sliders, clip picker), readable at 160x60 and 240x90.
- [ ] One bear placed in a test world walks a loop, with the lamp and the sun lighting it correctly on both paths (`?gpucompare=1` adds a `bearClose` pose). The US-018 budgets hold.
- [ ] `mounts` get their first consumer (e.g. `talk` as the US-042 prompt anchor) if US-042 is in the same milestone; otherwise helper-only stays.
Design needed: yes – the bear voxel model + preview page.
Notes / dependencies: US-041a. Target: `done` before M3 content starts (US-042 M3 NPCs). Maps the original US-041 AC lines 2 (clips part), 4 and 5.

**Original US-041 sketch (history, superseded by US-041a/US-041b):**
Acceptance criteria (sketch):
- [ ] Rotated parts write `face 7` plus the octahedral-packed normal (in the `GA.w` slot), and the `light` pass decodes it (the only change to the light pass). `faceK = 1` for kind 8, so there is no pop between rotated and unrotated shading. Light parity is `|dL| <= 1e-3` in gpucompare.
- [ ] Rigid-part animation: keyframes are linearly interpolated in JS on the fixed step (deterministic). `idle` and `walk` clips, `events` (e.g. `step`) fire like sprite events (US-011), and the animation update is <= 0.02 ms per entity.
- [ ] Entity binding: a `type: 'voxelModel'` entity with `{ model, transform, anim }`, facing from the entity yaw, and `mounts` reused (e.g. `talk` for the US-042 prompt anchor). State is serializable, and the renderer holds no entity state.
- [ ] **Designer:** a bear voxel model (about 16x8x12 at 0.125 m, `idle` + `walk`) and `design/preview/voxel.html` (orbit, light sliders, clip picker), readable at 160x60 and 240x90.
- [ ] One bear placed in a test world walks a loop, with the lamp and the sun lighting it correctly on both paths. The US-018 budgets hold.
Design needed: yes – the bear voxel model + preview page.
Notes / dependencies: US-040, US-006/007, US-016. Target: `done` before M3 content starts (US-042 M3 NPCs).
**D-019 split (PO to formalise):** **US-041a (M1 P0)** = rotated normals + light decode, `voxel` entity binding with fixed world yaw, rigid parts only as far as props need them (lever pull), `mounts` validated + helper; **US-041b (before M3)** = `idle`/`walk` creature clips, the bear model, `design/preview/voxel.html`, the walking-loop AC. The AC lines above map: line 1 -> 041a; line 2 -> 041a for the mechanism (no `idle`/`walk` content), 041b for the clips; line 3 -> 041a; lines 4-5 -> 041b.

**Architect tech notes: `docs/architecture.md` 15.3** (normative for US-041a; 2026-09-24). Summary:
1. **Binding is a component, not a type:** `components.voxel = { model, anim, t, frame, loop, speed, playing }` (same shape as `sprite`); `EntityHandle.play/stop` and `stepAnimations` act on `sprite ?? voxel` (`animComponent(e)`). Entity `type` stays `'prop'`; spawn picks `voxel` when `registry.model(key).voxel` exists, so swapping a prop's art needs no level edit and no save-format change. `VoxelPool.collect(world)` (cached by `renderVersion`), nearest 16 win, no state in the pool beyond what the component rebuilds; restart = `deserialize` + re-collect.
2. **Yaw:** `transform.yawDeg = facing`, free degrees, **never snapped by the engine**; `axisAligned` per pose decides face 1..6 vs face 7. Content rule: wall props at multiples of 90; clutter any yaw; boulder yaw = heading, no roll (D-019 item 5).
3. **Rotated normals:** face 7 + octahedral bits in `GA.w` (raw uint on GPU, `Uint32Array` alias on CPU); `light.frag`/`lightSurfaces` decode with the literal `unpackNormalOct` twin - the only light change; shade `aoD = Inf`, `fk = 1`; edge treats face 7 as vert. No model shadows/self-shadow in M1 (recorded).
4. **Lever pull = data:** model parts `plate` (root) + `handle` (child, hinge pivot); clips `idle` (1-frame loop) and `pull` (`durations [90,90,90,240]`, non-loop, `handle.rot.x` 0 -> -85, linear). `computeVoxelPose` already interpolates, `stepAnimations` already advances; a finished clip holds its last frame in the component, so the pulled lever survives save/load. `lever.pull` stays `play('pull')`. No clips needed for burner/relay/lamp/heaps in M1.
5. **Mounts:** `voxel.mounts[name] = { at, part? }` validated + `voxelMountWorld(...)`; consumers are US-042/US-022. In M1 flames/glows stay separate billboard prop entities in level data; lights stay `def.lights`.
6. **Tests/poses:** `world.test.js` (voxel spawn, round trip, both-components throws), `animation.test.js` (voxel component clip, hold, `animEnd` once), quest test (`voxel.anim === 'pull'`), `lighting.test.js` (face-7 decode), `voxel.test.js` (`voxelMountWorld`, nearest 16, zero alloc); `?gpucompare=1` real-prop poses: lever idle, lever mid-pull (`voxel.frame = 2, t = 45`, face 7 + `|dL| <= 1e-3`), crash room (flame billboard vs burner rim), boulder mid-roll; `?flicker=1`, `?bench=1` per 15.2 item 6; then the owner walk-check.
7. **Designer contract (15.3 item 6):** colour per material only (`mats` values need v2 records in `detail-pass.js`, else the GPU path is disabled); bright-rim/dark-body = distinct materials on rim vs body voxels; outline = edge pass + `edges.modelRim`; lever `>= 0.7 x 1.1 m`; flames/glows are billboard props.
8. **AC deltas for the PO:** "`type: 'voxelModel'`" is implemented as the `voxel` component on `type 'prop'` entities; "facing from the entity yaw" = free yaw, axis-aligned fast path automatic; `mounts` in 041a are validated + helper only (no billboard attach).

## Physics + effects epic – sketches (owner requirement 2026-09-24; M2-M3, before M6)

All five are **engine stories: architect tech notes first**. **Gate before US-051:** the physics-engine choice (extend the in-house `engine/physics` code vs Rapier `@dimforge/rapier3d-compat` / WASM per D-015; Rapier was rejected for the single US-013 boulder, but many stacked, tumbling bodies change the trade-off) needs an architect estimate (cost, determinism for saves, fixed timestep, `World` queries per D-007) and a manager decision recorded in `docs/decisions.md`. All queries still go through `World`; the JS fixed-step sim stays the oracle.

### US-051 Dynamic rigid props: drop, fall, tumble, settle  [Priority: P0 (M2)] [Status: todo (sketch)]
As a player, I want loose objects (crates, logs, stones, branches) to fall, tumble and come to rest believably, so that the world feels physical and not painted on.
Acceptance criteria (sketch):
- [ ] A generic dynamic-body component (box, cylinder/capsule, sphere; mass, friction, restitution) on the fixed timestep; the US-013 boulder runs on it (or stays on the roller with a documented reason) with its tests unchanged.
- [ ] A test room with 10 mixed bodies dropped from 3 m: all settle (sleep) within 3 s, none sink into floors/walls/steps or each other by more than 2 cm, none jitter at rest (sleeping bodies cost ~0 per step).
- [ ] Bodies collide with the player capsule both ways (the hero pushes a crate; a falling log stops on the hero without tunnelling), and against sector walls, floors, steps and terrain via `World` queries.
- [ ] 30 active bodies stay inside the US-018 JS budget (bench number in the story); determinism: the same inputs give the same resting poses in Node (save-safe).
- [ ] Bodies render with correct rotation (voxel models per D-016 once US-041 is done; a billboard fallback before that).
Design needed: yes – crate, small log, stone voxel/billboard models.
Notes / dependencies: physics-engine decision (see gate above), US-008/009/013. Landing thud hook for US-020 sound.

### US-052 Pick up, carry, put down, throw  [Priority: P0 (M2)] [Status: todo (sketch)]
As a player, I want to pick up a branch or a crate, carry it, set it down or throw it, so that I can bring things where they are needed and solve simple puzzles.
Acceptance criteria (sketch):
- [ ] `E` on a liftable body (mass <= 25 kg, flagged `liftable`) within 1.8 m picks it up (US-012 interaction prompt "Lift"); it is held in front of the hero at chest height and does not clip into walls (pushed back / dropped if blocked).
- [ ] Carrying: walk speed x0.7, no run, no sword swing; jump allowed only for items <= 5 kg.
- [ ] `E` again puts it down gently on the floor in front (a valid spot or no-op); `Mouse0` throws it along the view direction at 8 m/s for items <= 5 kg (scaled down linearly to 3 m/s at 25 kg) and it becomes a normal US-051 body.
- [ ] A carried item can be placed on a pressure plate (US-014-style trigger) and the trigger fires; the carried branch counts as a key item for a "bring the branch" test beat.
- [ ] Carry state is dropped cleanly on damage, restart (`R`) and level change; no allocations per step.
Design needed: yes – hold pose for the lifted item (offset per model), "Lift/Drop/Throw" hint text (writer).
Notes / dependencies: US-051, US-012, M2 sword (mutual exclusion with the swing).

### US-053 Particle system: smoke, dust, sparks, splash drops  [Priority: P1 (M2)] [Status: todo (sketch)]
As a player, I want smoke rising from fires, dust puffs when things land and sparks from metal hits, so that the world feels alive and impacts feel satisfying.
Acceptance criteria (sketch):
- [ ] An engine emitter component (rate, lifetime, velocity + spread, gravity/buoyancy, wind, drag, glyph ramp over life e.g. `@ O o . `, colour ramp, emissive flag), pooled, drawn through the GPU sprite pass with depth test; JS reference for gpucompare.
- [ ] Presets as data in `design/`: chimney/burner smoke (rises ~0.6 m/s, drifts with wind, fades over 4 s), landing dust (on US-051 impacts above 2 m/s), sparks (emissive, gravity, 0.4 s), splash drops (used by US-055).
- [ ] 500 live particles stay inside the US-018 budgets; lit by ambient + point lights (not emissive ones).
- [ ] US-019 dust motes in the sun shaft are re-built as a preset of this system (or US-019 is closed in favour of it).
Design needed: yes – glyph + colour ramps per preset, preview page.
Notes / dependencies: US-030c sprite pass, US-006/007 lighting. Burner smoke on the M1 *Kestrel* burner is the first placement.

### US-054 Cuttable tree -> log + branches as physics pieces  [Priority: P0 (M3)] [Status: todo (sketch)]
As a player, I want to cut down a tree with my sword and use the pieces, so that I can build a bridge, block a path or carry a branch where it is needed.
Acceptance criteria (sketch):
- [ ] A `cuttable` tree entity takes 3 sword hits (hit flash + chip particles from US-053); on the 3rd hit it tips over away from the hero (falls ~1.5 s, hinge at the stump) and lands with a dust puff.
- [ ] On landing it splits into data-defined pieces (1 trunk log ~40 kg, 2-3 branches ~3 kg, a stump that stays); each piece is a US-051 body; branches are `liftable` (US-052), the log can be pushed.
- [ ] A falling tree can span a 3 m gap as a walkable bridge (the player capsule walks along the log) in a test room.
- [ ] Cut trees stay cut through restart/save state per the level's state rules; max 8 loose pieces per sector (oldest sleeping twigs despawn).
Design needed: yes – tree voxel model split into parts (trunk, branches, stump), fall animation or physics hinge params, chip/leaf particle ramps.
Notes / dependencies: US-051, US-052, US-053, the M2 sword story, US-041 (voxel rigid parts). M3 because the sword and voxel models land before it.

### US-055 Water surface + splash + floating props  [Priority: P1 (M3)] [Status: todo (sketch)]
As a player, I want rivers and pools with a moving surface that splashes when I or objects enter it, and logs that float, so that water feels real and can be part of puzzles.
Acceptance criteria (sketch):
- [ ] Water as world data (sector or terrain region with a surface height); rendered on the GPU path with animated wave glyphs (`~ - =` ramp), depth tint, sky/light reflection, see-through to the floor in shallow water; JS reference in gpucompare.
- [ ] The player wades below 0.6 m depth (speed x0.6) and swims above it (no sword, slow, surface-locked); no drowning in this story.
- [ ] Bodies (US-051) and the player spawn splash particles (US-053) and a ring glyph ripple on entry scaled by speed; bodies with density < water float and drift with a data-defined current (a thrown branch floats downstream).
- [ ] Budgets (US-018) hold with one water region on screen.
Design needed: yes – water palette + glyph ramps, ripple/splash ramps, a test pool/river level.
Notes / dependencies: US-051, US-053, US-026 (terrain regions). Water puzzles in M4 build on this.

## Epic EP-ELEMENTS – sketches (PO 2026-10-01; table + scope in "Epic EP-ELEMENTS" near the top)

Sketch ACs only. Engine rows need an architect tech note before dev (listed in the epic header); numbers are PO proposals the note may adjust. US-053 and US-055 above stay the umbrella stories.

### US-053a Particle sim core (engine)  [Priority: P1 (M3)] [Status: todo (sketch)]  [PC-A engine]
As a player, I want smoke, sparks and dust to move believably, so that fires, hits and landings feel physical; as the engine, I want one pooled particle sim every effect can reuse.
Acceptance criteria (sketch):
- [ ] An emitter definition as data (rate or burst count, lifetime range, initial velocity + cone spread, gravity/buoyancy, drag, wind factor, max live count) attachable to an entity or a world point; start/stop/burst from code.
- [ ] Particles live in one preallocated pool (proposal 2000 slots, SoA typed arrays) on the fixed step; zero allocation per step; oldest particle is recycled when full.
- [ ] Deterministic: same seed + inputs give byte-identical particle state in Node after 600 steps.
- [ ] 500 live particles step in <= 0.3 ms JS (Node bench number recorded in the story).
- [ ] Wind input is a plain vector per step for now (US-138 later feeds it from `windAt`).
Design needed: no.
Notes / dependencies: NEEDS PC-A: architect note (one note for 053a+053b: module home, e.g. `engine/fx/`, layering vs `engine/physics/` stand-alone rule, pool layout). No collision with the world in this story (particles may pass through walls; optional floor kill-plane only).

### US-053c Particle presets + first placements  [Priority: P1 (M3)] [Status: dev done -> ARCH OK (batch 2026-10-13)]  [PC-B content + game/js/quest + main.js wiring]
As a player, I want the burner in the *Kestrel* to have a real flickering flame with rising smoke, sparks when my sword hits and a dust puff when I land hard, so that the first room already feels alive.
Acceptance criteria:
- [ ] 1. **Game wiring (from US-053b, architecture.md 32.1 "main.js" 4 lines):** boot defines the presets via `engine.particles.defineEmitter`; `sprites.pass?.bindParticleLayer(engine.particleLayer)`; update, after beast/sword/vitals steps: `entityEmitters.sync(); engine.particles.step()`; render, before `sprites.render`: `engine.particleLayer.build(engine.particles, cam, rt, engine.lights, engine.world, assets.palette, effRenderer)`. `particles.clear()` + `entityEmitters.invalidate()` on world load/restart. Never draws from the sim RNG.
- [ ] 2. **Presets as data** in the designer's file `design/models/particles.js` (follow 32.1 EmitterDef; colours as palette keys, resolved by the caller, glyphs 33..126 only): `flame` (emissive, rate ~40/s, rises ~1 m/s, life 0.4-0.6 s), `smoke` (accelZ +0.6, wind 1, life 3-4 s, fades over life, non-emissive), `sparks` (emissive, accelZ -9.8, burst 8-12, life 0.3-0.4 s), `dust` (burst ~10, speed 0.5-1.5 m/s, life 0.5-0.8 s, non-emissive). A Node test validates every preset through `defineEmitter` (no throw).
- [ ] 3. **Burner:** the *Kestrel* burner shows `flame` + `smoke` via `components.emitters` on its `flame` mount, replacing the OWN-REQ-008 billboard flame (billboard removed, not hidden); the point-light flicker is unchanged. Smoke rises past the burner and is hidden behind the pillar/walls (depth test).
- [ ] 4. **Sword sparks:** a `combat:hit` from the player's sword (US-078d) calls `burstAt(sparks)` at the hit point, cone along the hit normal when available (`setEmitterDir`); works without US-082.
- [ ] 5. **Landing dust:** a landing with fall speed above `LANDING_DUST_SPEED` (data const, 6 m/s) calls `burstAt(dust)` at the feet; no dust below it.
- [ ] 6. **Both renderers:** `?renderer=dda` and `?renderer=mesh` show the same particles; `?gpucompare=1` all poses PASS incl. `particles` at the 27.7 bars; no new check-deps WARN.
- [ ] 7. **Perf (32.1 numbers):** 500 live: JS step <= 0.05 ms, `build` <= 0.1 ms, GPU sprite-pass extra <= 0.05 ms p95, row upload <= 0.15 ms at 400x150, `over25 == 0`; zero per-frame allocation (an alloc test over the wiring if feasible). Record measured numbers in the row. Also apply the 053b nit (1): hoist `resolveFogColor` out of the slot loop.
- [ ] 8. **Decision (cutoff question): particles keep ignoring sprite `S.cutoff`, and lit smoke is dimmed by the emitter light only.** Why: per-particle cutoff would need the per-particle light the architect ruled out (32.1 "Do not"), and smoke at `fgMin` in a dark room is acceptable and cheap; mitigation = designer keeps smoke ramp colours dark/low-value (<= ~35 % of the palette brightness), so it reads as a faint glow, never as a lit cloud. Revisit only if the owner sees it in a dark room.
- [ ] 9. `node tools/run-tests.mjs` and `node tools/check-deps.mjs` green.
- [ ] 10. **Owner walk-test:** enter the *Kestrel*, see the burner flame flicker with smoke drifting up behind the pillar; swing at a wall/beast and see sparks; jump off the tower step and see a dust puff; flip `?renderer=dda`/`mesh` and confirm they look the same.
Design needed: yes (designer delivers before dev): `design/models/particles.js` with, per preset (`flame`, `smoke`, `sparks`, `dust`), a glyph ramp over life (<= 16 steps, e.g. flame `@Oo*.`, smoke `Oo:. `), a colour ramp of palette keys (flame yellow -> orange -> red; smoke grey, dark; sparks white-yellow -> orange; dust sand), emissive flag, and tuned rate/speed/life/spread numbers; plus `design/preview/particles.html` showing all four side by side (runs the real sim, loopable, lit and dark-room toggle).
Notes / dependencies: US-053a/b done, US-078d (sparks hook), OWN-REQ-008. Splash + motes -> US-053d. Wiring may be done by the PC-B main session (main.js is a shared hot file).

### US-055a Water surface render (engine)  [Priority: P1 (M3/M4)] [Status: todo (sketch)]  [PC-A engine/render + world]
As a player, I want pools and streams with a moving, see-through surface, so that water reads as water from a distance and up close.
Acceptance criteria (sketch):
- [ ] Water regions as world data (sector region first; terrain region once US-026 regions exist) with a surface height and a colour/material id; `World.waterAt(x, y)` returns surface height + depth (used by US-055b).
- [ ] Rendered on the GPU path: animated wave glyph ramp (`~ - =`), depth tint (shallow -> deep), floor visible through shallow water (<= 0.5 m), sky/light highlight on the surface; world-anchored (no swim when the camera turns).
- [ ] JS twin; gpucompare pose `water` PASSes; one water region on screen at 400x150 stays inside the D-029 GPU numbers.
Design needed: yes - water palette + glyph ramps, a test pool in a test level.
Notes / dependencies: NEEDS PC-A: architect note (water as a material vs a separate surface pass). US-026 for terrain regions (not a blocker for the sector version).

### US-055b Wade, swim, splash  [Priority: P1 (M3/M4)] [Status: todo (sketch)]  [PC-B game + PC-A query if missing]
As a player, I want to wade into a pool, swim when it gets deep and see it splash when I jump in, so that water is a place I can go, not a wall.
Acceptance criteria (sketch):
- [ ] Depth < 0.6 m: wade (speed x0.6); depth >= 0.6 m: swim (slow, surface-locked, no sword, no jump); no drowning in this story.
- [ ] Entering water spawns `splash` particles + a ring ripple glyph at the entry point, count scaled by vertical speed (a walk-in barely splashes, a jump from 3 m splashes hard).
- [ ] Entering water ends `burning` (US-132) on the player and on any burning entity that enters it.
- [ ] *(after US-051)* Bodies entering water splash too; floating props and currents stay in US-055.
Design needed: yes - ripple ramp (designer, with US-053c).
Notes / dependencies: US-055a, US-053c, US-132 (the extinguish AC lands with whichever story comes second).

### US-132 Burning status effect  [Priority: P1 (M4)] [Status: todo (sketch)]  [PC-A engine component + PC-B tuning]
As a player, I want to catch fire when I walk through flames (and set enemies on fire with my torch), so that fire is a danger and a weapon.
Acceptance criteria (sketch):
- [ ] A generic status-effect component (first effect `burning`: duration, damage per tick, tick interval) on any entity flagged `flammable`; save-safe while active.
- [ ] Burning deals damage over time through the existing damage path (US-080a1, proposal 1 HP per 0.5 s for 4 s); stepping into a burning fire cell (US-133) or touching a burning entity re-applies it.
- [ ] A burning entity emits `flame` + `smoke` particles (US-053c) and a small flicker light; the player sees a hurt-edge tint while burning.
- [ ] Spread: a burning entity ignites flammable entities within touch range (proposal 0.5 m) after 1 s of contact; non-flammable entities (stone, metal) never burn.
- [ ] Ends on timeout, on entering water (US-055b) or on rain (US-140 later); Node tests for timing, spread and determinism.
Design needed: yes - burning overlay tint for the hero view, flame attach points on the beast model.
Notes / dependencies: NEEDS PC-A: architect note (one note for 132+133: engine status-effect component vs `game/js/quest/sim`, flammability on materials vs entities). US-080a1, US-053c. No physics dependency.

### US-133 Fire spread (engine sim)  [Priority: P1 (M4)] [Status: todo (sketch)]  [PC-A engine/world]
As a player, I want a fire in dry grass to creep outward and burn itself out, so that I can use fire to clear a path or trap an enemy.
Acceptance criteria (sketch):
- [ ] Flammability as data: material entries (e.g. `dryGrass`, `wood`, `brush`) carry `fuel` (burn time) and `ignite` (chance per neighbour per step); props can be flagged flammable too. Stone/metal/water never burn.
- [ ] A coarse fire grid (proposal 0.5 m cells) built per sector/area from the flammable materials; each cell: unburnt / burning / burnt. Rule per fixed step: a burning cell ignites each flammable neighbour with its `ignite` chance (seeded RNG), burns for its `fuel`, then becomes burnt (charred material id).
- [ ] `fire.ignite(x, y, z)`, `fire.isBurning(x, y, z)` and a `fire:cell` event (ignite / burnt) for game code; wind bias hook (a per-step vector that raises downwind ignite chance; US-138 feeds it).
- [ ] Deterministic Node tests: a 20x20 grass patch lit in one corner burns out fully in the same steps every run; a stone strip stops the front; zero allocation per step; 4000 cells step in <= 0.2 ms.
- [ ] Burnt state is save-safe (a burnt patch stays burnt after save/load).
Design needed: no (charred material ids come with US-134).
Notes / dependencies: NEEDS PC-A: architect note (132+133). No physics dependency; *(after US-051)* burning props carried or rolled by physics move their fire with them.

### US-134 Fire view  [Priority: P1 (M4)] [Status: todo (sketch)]  [PC-A engine/render + designer]
As a player, I want a spreading fire to look like a wall of flickering flame and leave black ground behind, so that I can read where it is safe to walk.
Acceptance criteria (sketch):
- [ ] Burning cells draw flame glyphs (emissive, animated) + `smoke` particles (US-053c) on top of their surface; burnt cells switch to the charred material.
- [ ] Light: at most N flicker point lights per fire area (proposal 2, placed at the burning-cell centroid clusters) so a big fire never exhausts `MAX_LIGHTS`.
- [ ] A 20x20 burning patch at 400x150 stays inside the D-029 numbers; gpucompare pose `fire` (frozen fire state) PASSes.
Design needed: yes - flame glyph ramp, charred material colours.
Notes / dependencies: US-133, US-053c.

### US-135 Fire in the game  [Priority: P1 (M4)] [Status: todo (sketch)]  [PC-B content + game/js/quest]
As a player, I want to light dry brush with a flame and watch it burn open a way forward, so that fire is part of exploring, not just decoration.
Acceptance criteria (sketch):
- [ ] A fire test room: a dry brush patch, a wooden barrier blocking a doorway, a lit burner as the flame source; the player (dev key until US-093's torch exists) ignites the brush.
- [ ] Fire spreads across the patch (US-133), reaches the barrier, the barrier burns for ~3 s and is removed (path open, save-safe flag).
- [ ] The player standing in the fire catches fire (US-132); a beast (US-079a) chased through the patch catches fire too.
Design needed: yes - wooden barrier model + burnt variant, brush material (designer).
Notes / dependencies: US-132, US-134; US-093 torch reuses this room's rules for its 3 gated spots.

### US-136 Explosion query + force (engine)  [Priority: P2 (M4/M5)] [Status: todo (sketch)]  [PC-A engine/world + physics]
As a player, I want an explosion to hurt and throw back everything close to it, but not through a wall, so that blasts feel powerful and fair.
Acceptance criteria (sketch):
- [ ] `explode(pos, { radius, damage, impulse })` finds entities in range through `World`, falloff by distance (full at the centre, 0 at the radius), skipped when a wall blocks the line of sight to the target's centre.
- [ ] Emits one `explosion:hit` event per entity (amount, direction) for game code; the player capsule gets a knockback impulse (proposal 8 m/s at the centre) that respects walls and ceilings.
- [ ] Node tests: falloff values, occlusion behind a wall, knockback never tunnels the capsule through a wall; zero allocation per call.
- [ ] *(after US-051)* dynamic bodies in range get the same impulse.
Design needed: no.
Notes / dependencies: architect note now in `docs/architecture.md` **31.4** (`engine/physics/impulse.js`, stand-alone; needs US-078b `World.raySegment` first). US-080a1 for damage. **Owner (2026-10-01): wants to pick this up on PC-A next** - see the PC-A handoff pointer above.

### US-137 Explosion view + content  [Priority: P2 (M4/M5)] [Status: todo (sketch)]  [PC-B content + game + designer]
As a player, I want a blast to flash, shake the screen and throw out debris and smoke, and to set dry things around it on fire, so that it feels like a real explosion.
Acceptance criteria (sketch):
- [ ] An `explosion` particle burst preset (flash core, debris, smoke ring) + a short-lived point light (proposal 0.2 s, bright, warm) + camera kick scaled by distance.
- [ ] Flammable cells (US-133) and entities (US-132) inside the radius ignite.
- [ ] One explosive content prop (name from the writer, e.g. a blast-bloom pod) that explodes when hit by the sword or by fire, in a test room.
Design needed: yes - explosive prop model, burst ramps.
Notes / dependencies: US-136, US-053c, US-132/133.

### US-139 Height fog + fog banks (stretch)  [Priority: P2 (stretch, M5/M6)] [Status: todo (sketch)]  [PC-A engine/render + designer]
As a player, I want mist lying in a valley and fog rolling over a swamp, so that places have mood beyond flat distance fog.
Acceptance criteria (sketch):
- [ ] Fog density from height (thicker near a data-defined base height) plus data-placed fog volumes (box/ellipsoid, density, colour), applied in the light/shade pass; density glyphs where fog is thick.
- [ ] Fog volumes drift slowly with wind (US-138); world-anchored, no swim when the camera turns.
- [ ] JS twin + gpucompare pose `fogBank`; GPU cost <= 0.2 ms at 400x150.
Design needed: yes - fog colours/glyphs per region.
Notes / dependencies: NEEDS PC-A: architect note. US-138; pairs with US-127 (light in fog) and US-121 `look` presets.

### US-140 Weather states (stretch)  [Priority: P3 (stretch, M6)] [Status: todo (sketch)]  [PC-B content/game + PC-A hooks]
As a player, I want it to rain and storm sometimes, so that the world changes and rain can put out the fires I start.
Acceptance criteria (sketch):
- [ ] Weather as a world state (clear / rain / storm / snow) with timed or scripted transitions (fade over ~10 s), save-safe.
- [ ] Rain and snow as screen-anchored + world particles (US-053c presets), wet darkening of surfaces while raining, storm raises wind (US-138).
- [ ] Rain puts out open fire cells (US-133) and `burning` (US-132) after ~2 s.
Design needed: yes - rain/snow ramps, wet colour shift.
Notes / dependencies: US-053c, US-138, US-139, US-132/133; pairs with US-122 day/night. Split at planning if > 1 d.

### WATER-2 Flowing water, waterfalls, waves, underwater (PO 2026-10-02, owner request)  [US-141a/b, 142a/b, 143a/b/c, 144a/b; all todo (sketch)]
Design needed (all): yes - water look table additions (flow streak ramp, foam ramp `* o .`, crest glint, underwater tint/bubble ramp), waterfall glyph columns + spray ramp, test levels (river, cliff + falls, sea). Build on 055a/b; keep water an analytic layer (arch 32.2) unless the architect says otherwise.
**OPEN QUESTION for the architect (US-143, NEEDS PC-A):** arch 32.2 makes water a flat analytic plane, not mesh geometry. Owner wants "surface height that actually moves, mesh vertex displacement". Options: (a) keep the plane, perturb normal + ray-plane hit height by 2-3 wave octaves in the shade pass (cheap, floor/props stay visible, crests only look displaced); (b) add a displaced water mesh to the mesh renderer with alpha/see-through (true silhouette waves, but needs its own depth/blend rule). Architect picks; ACs below are written to hold for either. **ANSWERED (architect 2026-10-02, architecture.md 35): owner decided (b), displaced see-through water mesh in a cell-res water layer pass; AC relays in 35.13.**

**US-141a Flow data + scrolling surface**
- [ ] Region `flow: [vx,vy]` (m/s, |v| <= 6) is validated at load; `World.flowAt(x,y,out)` returns the flow of the highest-z region at the point, `[0,0]` outside water; zero allocation, <= 0.005 ms for 32 regions; Node tests incl. serialize round trip.
- [ ] Surface glyph hash is advected by `flow * timeSec` in the shade (JS twin the same); streaks visibly run downstream at 1 m/s vs 4 m/s in the river test level; still pools unchanged (existing `water` pose stays PASS).
- [ ] gpucompare pose `water` extended with a flowing region PASSes; extra cost <= 0.05 ms p95 at 400x150.
- Owner walk-test: stand at a river bank, glyphs clearly stream one way, faster in the narrow reach.

**US-141b Currents act**
- [ ] Wading/swimming player gets pushed by `flowAt * k` (k data, default 0.5 of flow speed) with a hard cap 3 m/s; walking against a 4 m/s reach is slower than with it; wall-fixture test (no tunnelling).
- [ ] Water particles (splash drops, bubbles, foam) drift with the flow; floating props follow the flow *(after US-051)*; a thrown test leaf/log in the river test level floats downstream and stops at the pool.
- [ ] Dry land unaffected (Node test).
- Owner walk-test: step into the strong reach and get carried; swim back out at the bank.

**US-142a Waterfall view**
**Note (arch 35.13):** needs an engine hook (a sheet in the water layer): 142a1 PC-A engine 0.75 d + 142a2 PC-B content 0.75 d. **US-141b:** 141b1 PC-A fx 0.25 d + 141b2 PC-B game 0.5 d. **US-144a:** 144a1 + 144a2. **US-055a:** 055a2 = 055a2a (layer) + 055a2b (composite), `water` pose and 32.2 look ACs unchanged.
- [ ] `waterfall` content def: top lip (x,y,z), width 1-6 m, drop height 2-20 m; sheet glyph columns fall at >= 8 m/s apparent speed, 2-3 brightness levels with emissive highlight streaks; seen from both sides.
- [ ] Spray: >= 1 particle emitter at the foot (mist, rate scaled by width x drop), drifting with wind (US-138); a second small emitter at the lip.
- [ ] Plunge pool: a water region at the foot emits ripple rings every ~0.4 s; flow pushes outwards from the foot (US-141 data).
- [ ] Test cliff level with a 10 m fall; frame cost with the fall on screen <= +0.3 ms p95 (JS twin warn-only).
- Owner walk-test: approach from downstream, hear/see spray build up, circle behind the sheet.

**US-142b Waterfall sound + cave**
- [ ] Looping roar gain follows distance (full <= 4 m, silent >= 40 m), pans left/right, louder for taller/wider falls; mute API respected (US-020d).
- [ ] Walk-behind alcove: a gap behind the sheet of >= 1.5 m, sheet drawn over it when looking out, muffled roar inside; one hidden pickup slot.
- Owner walk-test: walk into the cave, roar changes.

**US-143a Wave height field**
**AC amendment (arch 35.13):** `waves` = `none|calm|breezy|storm|sea`, default calm; all presets share one 4-wave spectrum, a state is an amplitude vector; `"sea"` regions follow `world.water.setSeaState(state, blendSec)` (engine work, lands here not in 143c); overrides via `assets.waterWaves` (engine defaults exist); time base = integer step tick (`water.step()`).
- [ ] `waveHeight(x,y,t,preset)` sums <= 4 waves with seeded phases; deterministic across runs; |h| <= preset amp sum (calm 0.03, breezy 0.12, storm 0.45 m); period of the main wave 3-8 s.
- [ ] `waterAt` out gets `surfaceZ` = region z + wave h, plus `flat z`; depth uses live z; Node hash test + 0.01 ms budget for 32 regions.
- [ ] Preset is per region data (`waves: "none"|"calm"|"breezy"|"storm"|"sea"`); default calm.

**US-143b Wave render + foam**
**AC amendment (arch 35.13):** displacement is a displaced see-through water mesh (owner decision 2026-10-02, arch 35.3), not shade-pass perturbation. Split 143b1 (displacement) + 143b2 (shading + foam).
- [ ] The surface visibly heaves: crest-to-trough >= preset amp at the camera, wavelength readable at 20 m; crests catch a sun glint, troughs darker; world-anchored.
- [ ] Foam glyphs `* o .` appear where water depth < 0.3 m (shoreline band, pulses with the wave) and on storm crests; foam fades by distance.
- [ ] JS twin + gpucompare pose `waves` PASS (calm + storm); shade extra <= 0.15 ms p95 at 400x150.
- Owner walk-test: stand on a beach, watch the waves roll in and foam line move.

**US-143c Waves in play**
- [ ] Player swimming bobs with `surfaceZ` (no jitter > 0.02 m at calm); any `floats` entity follows the live z with a small tilt-free bob; splash (055b) triggers at the live surface.
- [ ] Switching wind (US-138) between calm/storm changes the wave preset over ~5 s; the weather hook `setSeaState(state, blendSec)` already exists from 143a (arch 35.13: 143c is game side only: wind/weather -> `setSeaState`, floaters, test level); US-140 calls it later.
- [ ] Sea test level with a shoreline, storm toggle on a debug key.
- Owner walk-test: toggle storm, waves grow and the player bobs harder.

**US-144a Underwater view**
- [ ] When eye z < surface z in a region: blue-green tint (rgb from look table), ease-out fog `s(2 - s)`, full at 12 m (no `exp`, parity; arch 35.13), glyph ramp swapped to a bubbly one; surface visible from below as a bright glyph ceiling.
- [ ] Transition at the surface line is clean (no one-frame flicker; hysteresis 0.05 m); eye in a pool of depth < 0.3 m does not trigger it.
- [ ] JS twin; gpucompare pose `underwater` PASSes; cost <= +0.1 ms p95.
- Owner walk-test: dive, look up at the ceiling of waves, surface.

**US-144b Underwater play + sound**
- [ ] `vitals.breath` (max 10 s, tuning data) drains only with the head under, refills at 3x rate above; at 0 a damage tick per US-080 numbers; breath bar appears in the HUD only while below max.
- [ ] Bubble particles on exhale every ~2 s; audio low-pass engages under the surface (deferred to M6 polish if audio stays off).
- Owner walk-test: stay down until the bar empties, take damage, surface.

Order: 055a1 -> 055a2 -> 055b -> 141a -> 141b | 142a -> 142b | 143a -> 143b -> 143c | 144a -> 144b. 141a and 143 share one architect note.

### CLOTH-1 Cloth physics - "nice clothes"  [Priority: P1 (M3 content, engine first)] [Status: 1a/1a2/1b1/1b2/1b3/1b4 done; 1b5 stairwell-canvas half done 2026-10-03 (ruin-banner half deferred, no ruin content yet) -> NEEDS PC-A: PO/owner walk-test of the stairwell canvas + BUG-CLOTH-001 architect decision]

**AC amendments (architect 2026-10-02, architecture.md 33.7) override the ACs below where they differ:** 1a AC1 `step(wx,wy,wz,colliders)` fixed dt; AC2 2-8 substeps + tethers, same sag (<= 2 cm) at 4 vs 8; AC7 ground = plane, walls = boxes >= 0.2 m; AC8 no min node spacing (pop test stays); AC10 0.05 ms bare / 0.07 ms with 1 box + 1 capsule, <= 6 awake in <= 0.4 ms, off-screen sleep in 1b3; 1b AC1 shadow needs `?shadows=map` until ME-15d; 1b AC5 0.3 ms excludes the sun-map re-render; 1b AC2 glyphs via the existing material path.
As a player, I want banners, torn canvas and later capes to flutter, fold and settle like real cloth, so that the world feels alive and not like stiff placeholders.
Split (each ~1 programmer-day):
- **CLOTH-1a** engine cloth sim [PC-A: `engine/physics/cloth.js` + `cloth.test.js`, stand-alone, imports only from `engine/physics/`]. Verlet grid, pins, structural + shear + bend constraints, wind passed in as plain numbers, collision with sphere/capsule/box/ground, deterministic.
- **CLOTH-1b** render + content [PC-A render part (per-frame deformable mesh, two-sided, smooth normals) + designer (cloth material, glyph ramp, preview page) + PC-B placement]: stairwell balloon canvas + one banner on a ruin.
- **CLOTH-1c** capes/robes on characters (skinned-to-body pins, capsule collision against limbs) and optional tearing - later, M3 exiles; needs its own ACs at planning.
Acceptance criteria - CLOTH-1a (sim, measured in Node):
- [ ] `createCloth({cols, rows, size, pins, seed, ...})` and `cloth.step(dt, wx, wy, wz)`; fixed 60 Hz step (caller accumulates), no `engine/world` import (check-deps clean), zero allocation per step (test measures).
- [ ] Grid up to 24x16 nodes; constraints structural + shear + bend, stiffness set per cloth def (silk / canvas / heavy banner presets); 4-8 solver iterations configurable.
- [ ] No jitter at rest: pinned in zero wind for 5 s, max node speed < 0.005 m/s after 2 s and max position change between consecutive steps < 0.5 mm after 2 s.
- [ ] No visible stretching: under gravity alone, no structural edge exceeds 1.10x rest length (canvas) / 1.05x (banner) in steady state, including with pins moved at 3 m/s.
- [ ] Stable: 10 000 steps with random wind gusts (0 to 12 m/s) and random pin motion give no NaN/Inf and no node further than 3x cloth size from its pins.
- [ ] Wind response: with a steady 6 m/s wind the free edge deflects at least 30 degrees from vertical, with per-node flutter (deterministic hash, no `Math.random`) so neighbouring nodes do not move in lock-step (test: spatial variance of node velocity > 0); a gusting wind (windAt feed) shows swing amplitude changing over time.
- [ ] Settling: when the wind drops to 0 after a gust, node speed falls below 0.02 m/s within 4 s (damping tuned so it neither freezes instantly nor swings > 6 s).
- [ ] Collision: nodes never end inside the player capsule (r 0.35, h 1.8), a box (wall/pillar) or the ground plane/heightfield callback; cloth hanging against a wall stays on the open side (0 nodes penetrate over a 10 s windy run); cloth draped over a sphere/box rests on it without popping (max node displacement per step < 3 cm).
- [ ] Self-intersection / fold pops: bend constraints plus a min node spacing keep folds from flipping; test with a pin pushed through the cloth, with max per-step node displacement < 5 cm (no single-frame pops visible at 240x90).
- [ ] Deterministic: same seed + same inputs gives a bit-identical `hashInto` of node positions after 1 000 steps; different seeds differ.
- [ ] Perf: one 24x16 cloth step <= 0.05 ms (Node, warmed); 12 active cloths <= 0.6 ms/frame total; cloths farther than a distance threshold (default 40 m) or off screen are skipped (sleep) and wake without a pop.
Acceptance criteria - CLOTH-1b (render + content):
- [ ] Cloth drawn as a per-frame mesh on the mesh renderer: two-sided, smooth normals recomputed per step so light and shadow read across folds (a bright and a dark band visible on a draped banner under the sun), casts and receives shadow, takes dynamic light (torch tint visible).
- [ ] Designer ships a cloth material + glyph ramp (`~ ) ( /` etc, canvas vs banner palettes, fray/tear edge) and a preview page with a wind slider; PO checks the preview before dev.
- [ ] Tower stairwell: torn balloon canvas pinned at 2+ points sways in the breach wind (`windAt` sampled once per cloth per step at the anchor).
- [ ] One banner on a ruin flutters in the ambient wind; neither cloth clips through its wall or the stairs, and the player capsule pushes cloth aside when walking through.
- [ ] Render cost <= 0.3 ms GPU/CPU total for the two scenes at 240x90 (read from the existing GPU ms readout); no flicker of glyphs at rest (stable frame to frame when wind is 0).
Owner walk-test: go up the tower stairwell and stand under the balloon canvas. Nice means: it billows and ripples in gusts with a visible travelling wave, folds show light and shadow, it eases back to calm within a few seconds when the gust ends, it moves out of your way when you walk into it, nothing jitters or pops, and it never goes through the wall. Then look at the ruin banner from 20 m: it flutters continuously, with slightly different motion on each part.
Design needed: yes (CLOTH-1b: material, glyph ramp, preview page; a nice-cloth reference scene).
Notes / dependencies: US-138 `wind.sampleInto` (done, arch-review); mesh renderer (RE-15 line); US-020b wind sound may read the same gust value later. Numbers above are starting targets; the architect may adjust with a reason.
ASK ARCHITECT: (1) Sim method: plain Verlet + iterated constraints (my default) vs XPBD (stiffness independent of iteration count/dt) - is XPBD worth it at 24x16 within 0.05 ms?
ASK ARCHITECT: (2) Where does collision geometry come from: does `cloth.js` take a flat list of primitives (sphere/capsule/box) and a ground callback fed by the caller, to keep `engine/physics/` stand-alone, and who builds the list each frame (game/quest or an entities system)?
ASK ARCHITECT: (3) Render path: deformable mesh uploaded per frame to the mesh renderer (dynamic vertex buffer, GPU path and JS twin both) - what is the minimal API, and does it fit the shadow/`?gpucompare=1` rules?
ASK ARCHITECT: (4) Does the cloth system live as an entity system (`engine/entities`, ticked in the fixed step, sleep by distance) or as a game-owned object? Also save/replay: is cloth state excluded from saves (re-settle on load) and only hashed for replay tests?
ASK ARCHITECT: (5) Tearing for the balloon canvas: in CLOTH-1a (constraint removal, breaks determinism risk) or deferred to 1c? My proposal is deferred; pre-torn shape is baked into the mesh def.

**CLOTH-1b5 stairwell-canvas half done 2026-10-03 (PC-B: programmer agent for `content/levels/tower.level.json` + `engine/world/cloths.test.js`; main.js 2 lines + `w.cloths.setBody`/`.tick` wiring by the PC-B main session itself, shared-file rule).** `tower.stairwell.canvas` (16x12, preset `canvas`, mat `cloth.canvas`, the designer's own `stairwellCanvas` pins/holes from `design/cloth.js`) caught over the main stair shaft (steps 1-4, col16-19 row3), pinned at the top near the north-wall breach-side rubble (col15-16 row2); authored snag/floor box (top 1.35 m, below the 1.4 m stair-cheek-wall) + a wall box behind the sheet, per the 33.5 floor-box amendment. `content-canonical.test.mjs`/`validate-content.mjs`/`content-smoke.test.mjs`/`check-deps.mjs` all green; `cloths.test.js` updated (one assertion no longer hard-codes an empty base system now that real content carries a cloth) -> 55/55. **Surfaced `BUG-CLOTH-001`** (see the Bugs table): drawing this cloth from the 'inside, facing lantern/brazier' CO-3 camera pose exposes a latent float32-rounding bit-diff in `DrawList.js`'s cloth path, failing `sectorCaster.invariance.test.js` - `NEEDS PC-A: ASK ARCHITECT`, left failing (3rd suite FAIL alongside the 2 pre-existing flakes) pending that decision. **Ruin-banner half deferred**: no ruin structure is placed anywhere in content yet (ME-13 glTF import/placement, blocked for PC-B) - placing it on the tower's own wall instead and calling it a "ruin banner" was rejected as misleading for the PO/owner walk-test script; do this once a ruin exists. **Owner walk-test (once BUG-CLOTH-001 is resolved or waived):** go up the tower stairwell and stand under the balloon canvas (per the AC text above).

---

## Milestone 6 "Polish & Release" – sketches (D-012)

### US-043 Steam release: Electron wrapper + Steamworks + store assets  [Priority: P0 (M6)] [Status: todo (sketch)]
As a player on Steam, I want to buy and play *Kestrel* as a desktop game with achievements and cloud saves, so that it feels like a real release, not a web page.
Acceptance criteria (sketch, per D-012):
- [ ] `desktop/` (Electron `main.js` + `preload.js`, outside `engine/` and `game/`) loads the unchanged `game/` through a custom `app://` protocol. The game has no build step; `electron-builder` is packaging only. check-deps: `engine/` imports neither `desktop/` nor `game/js/platform/`.
- [ ] `steamworks.js` runs in the main process and is exposed as a small `platform` object (`isSteam`, `unlockAchievement(id)`, `saveWrite/saveRead`). `game/js/platform/` has the web implementation (localStorage/IndexedDB, no achievements) and the steam implementation. Saves and settings (US-038) go only through the adapter.
- [ ] Steam scope: achievements (the list is written by the PO in M6), Steam Cloud (Auto-Cloud on the save folder) and the overlay. Out of scope: workshop, leaderboards, multiplayer, DRM.
- [ ] Windows, Linux/Steam Deck (gamepad "Playable" needs the M6 gamepad story) and macOS builds run the GPU path with the same `?gpucompare=1` results as Chrome. The tester tests both the browser and Steam builds.
- [ ] No runtime network or CDN dependencies.
- [ ] **Store assets (designer, rendered from the real engine):** ASCII key art; capsules (header 920x430, small 462x174, main 1232x706, vertical 748x896, library 600x900, hero 3840x1240, logo); 5+ screenshots; a 30-60 s in-engine trailer. Writer: short and long store descriptions.
- [ ] Release order: the itch.io browser demo (M1+M2 slice) first, the Steam "Coming Soon" page once M3 is playable, launch at the end of M6. The $100 Steam Direct fee is budgeted by the owner.
Design needed: yes – key art, capsules, screenshots, trailer.
Notes / dependencies: D-012; US-038 (settings via the adapter), the M2 save-point story (versioned saves through the adapter), M6 gamepad. Probably splits into 3-4 stories when refined (wrapper, Steamworks, store assets, release checklist).

## Known issues / owner reports (tester checks these in every related test run)

| ID | Reported | Description | Status | Check in |
|---|---|---|---|---|

### US-063 Editor v0.1 polish  [Priority: P1] [Status: po-review]  [PC-B]
As the editor's first real users (owner + future content work), we want placing a prop to offer a real model picker instead of a hidden default, the "inside a structure" placement test to use the level's actual per-cell data instead of a loose bounding box, the ability to open a different world by URL, and an in-viewport reminder of every key - plus a README so opening the editor doesn't require reading source.
Acceptance criteria:
- [x] Placing a prop (`1` then click a surface) opens a searchable model list (every placeable prop/voxel model from the AssetRegistry) instead of seeding a silent default; picking a model commits the placement with that model, Esc cancels the whole placement.
- [x] The "inside a structure" placement test uses the level's real per-cell data (`world.sectorAt`/`world.structureAt`, the real `World` public API - confirmed via `engine/index.js`'s `World` export), not an axis-aligned bbox test; a click in a courtyard gap or any other cell-less hole inside a structure's bbox is refused with a message instead of silently treated as "inside".
- [x] `?world=<id>` opens a different world (an unknown id throws a clear "unknown world" error naming the known ones - verified live).
- [x] `H` toggles an in-viewport keyboard-help overlay listing every editor key (drawn into the glyph grid, not just the always-visible sidebar text).
- [x] `tools/editor/README.md` - a how-to covering open, fly, select, place, save to Downloads, load, play-test, and the "never saves over `content/`" guarantee.
- [x] Node tests for the inside-structure check (`classifyPlacement`) and the model-list filter (`listPlaceableModels`/`filterModelKeys`).
Design needed: no (reuses existing sidebar/panel styling).
Notes / dependencies: PC-B QUEUE 2 item 5 (docs/backlog.md top). This session resumed after a prior agent's harness was interrupted mid-story; its uncommitted work (all 5 files + README) was read and verified rather than redone.

Implementation/verification log: see docs/backlog-archive.md pass (e).

### US-064 Editor edit speed (US-032/US-033 follow-up: patch instead of rebuild)  [Priority: P1] [Status: po-review]  [PC-B]
As an editor user nudging/dragging/rotating/property-editing a prop or light, we want the edit to apply instantly (no visible stall) instead of paying a full `World.load` re-parse (measured 73-90 ms against the real tower, vs the architecture's 5 ms budget, US-033's own implementation note) on every single edit.
Acceptance criteria:
- [x] Moving/rotating/property-editing an EXISTING prop or light patches the live entity/light in place (reuses US-032's drag path: a live `transform`/`LightSet` handle write + `world.renderVersion++`/`frame.markDirty()`) and commits the doc change WITHOUT calling `World.load`.
- [x] Full rebuild (`World.load`/`engine.setWorld`) still happens on: add (new item), delete, an id-changing edit (rename), a structure-affecting change (e.g. a prop's `model`, a light's `preset` - no live setter exists for those), or undo/redo that crosses one of those boundary cases.
- [x] Node timing test: 100 nudges of one existing prop each take < 5 ms (median) on the new doc+patch path, with `World.load` never called in the loop.
- [x] Undo/redo still exact (existing suites green + a new patch-path-specific undo test proving a patched-then-undone edit produces byte-identical state to before the edit).
Design needed: no.
Notes / dependencies: PC-B QUEUE 2 item 6 (docs/backlog.md top). Files: `tools/editor/livepatch.js` (new), `tools/editor/main.js`, `tools/editor/frame.js`.

Implementation/verification log: see docs/backlog-archive.md pass (e).

### US-067 Editor asset library + tree visibility/lock  [Priority: P2 (M1.5+)] [Status: po-review]  [PC-B]
As the editor's user, I want a left-dock "Assets" tab that lists every placeable model with a small ASCII thumbnail (search to filter, click to arm placement), and scene-tree eye/lock icons per row so I can hide clutter or protect a prop from an accidental drag while I work on the rest of the level - without any of that leaking into the saved world/level JSON.
Acceptance criteria: see PC-B QUEUE 3 item 8 (docs/backlog.md top) for the exact wording; summary below.
- [x] A left-dock "Assets" tab (next to the scene tree) lists every placeable model (`listPlaceableModels`), each with its name and an ASCII thumbnail <= 16x8 cells in the model's own colours, built once and cached: sprite/billboard models = the idle clip's first frame, cropped/downsampled; voxel models = a front orthographic view (first solid voxel per column/row, its material colour + a shade glyph off the material's own ramp). A search box filters by name.
- [x] Click a thumbnail, then click the viewport, to place it - the SAME `placeAt` code path the US-063 model-picker modal uses (refused-inside-structure message included; Esc cancels; the ribbon shows the armed model's name).
- [x] Scene-tree rows get an eye (hidden = not drawn in the 3D viewport) and a lock (locked = skipped by viewport pick and drag) icon. Hidden/locked items stay selectable from the tree and editable in the inspector. The state survives a rebuild (add/delete/undo elsewhere) within the same editor session (in-memory only), is NEVER written to the saved world/level JSON, and play-test always shows everything (it reads the real doc, not this overlay).
- [x] Node tests: a thumbnail-builder test (deterministic output for one sprite fixture + one voxel fixture, the 16x8 cap enforced), a hidden/locked-skipped-by-pick test, and a save-output-byte-identical test (with vs without hide/lock toggled). Existing editor tests + `run-tests`/`check-deps` stay green.
- [x] One browser pass with a screenshot of the Assets tab in action (thumbnails visible, search filtering, a successful placement).
Design needed: no (reuses the US-066 reskin's dock/ribbon chrome).
Notes / dependencies: PC-B QUEUE 3 item 8 (after item 2/US-066). Files: `tools/editor/thumbnails.js` (new), `tools/editor/visibility.js` (new), `tools/editor/main.js`, `tools/editor/index.html`.

Implementation/verification log: see docs/backlog-archive.md pass (e).

### BUG-MANA-001 Insufficient-mana warning compares clocks with different origins

**NEEDS PC-A: PO review [PC-B game], P3, implemented 2026-10-04.** Related: US-080b, US-078d; same class of clock mismatch as the already-fixed hurt edge/kick (Q9 item 2a).

- PC-B implementation: `vitalsView.js` passes the mana warning's age in milliseconds to drawBar, measured entirely on the vitals tick clock. No failure maps to Infinity, preserving the existing zero-tick sentinel. No new state or main.js wiring. Production createVitals + drawVitals regression checks cover fresh tick 2 at boot time 999, both blink segments across pauses, resume, expiry, restart without stale flash, and unchanged fill. 17 new checks; view 82/82 PASS, vitals suites 2/2 PASS; full 210/210 suites PASS, check-deps OK (377 files, existing warnings). Deviation from the row's init/reset suggestion: directly fixes the mismatched-clock calculation, matching hurt-edge/kick timing. Existing reproduction below retained for review context.

**PO OK 2026-10-04 (PC-A PO) -> done** (HUD cue, covered by production drawVitals checks).

- Evidence: `vitalsView.js:118` ages `manaFlashTick / 60` against render `simTime`. `main.js:811` advances `simTime` before the pause gate; `vitals.step` runs only while unpaused, and recreating vitals resets its tick without resetting `simTime`. A fresh mana failure after either clock diverges can therefore appear expired immediately.
- Reproduction: call production `drawVitals` with an HP/MP player, `vitals={tick:2,manaFlashTick:2}`, and an MP `short` style (320 ms, two blinks). At `simTime=2/60`, the label uses the short-warning colour; at `simTime=999`, it uses the ordinary colour despite an age of zero vitals ticks. Both results asserted in the audit probe. Player scenario: pause for a second or restart, then exhaust mana and release a charged sword swing.
- Fix scope for PO: keep warning age on the same clock as the failure event; verify both blinks after pause/resume and restart, plus expiry. Existing tests only check `shortFlashOn` with already-correct elapsed milliseconds; add coverage through `drawVitals`.
- Verification: Node reproduction confirmed; existing `vitalsView.test.js` and `vitals.test.js` PASS in the full runner. No implementation or spec deviation in this audit. If approved, likely files: `vitalsView.js` + its tests; any main.js change also needs both route-walk renderers.

### BUG-RESPAWN-001 Restored player facing survives only until the next integration step

**NEEDS PC-A: PO review [PC-B game], P2, implemented 2026-10-04.** Related: US-080a1/US-080a2, architecture.md 30.2.

- PC-B implementation: `vitals.js` calls optional `syncFacing(transform)` after clearing targeting; `main.js` clears the look lock and copies the restored yaw plus existing pitch. Save/load already rebuilds PlayerLook from the loaded transform. `tools/respawn-facing.test.mjs` uses real Events, PlayerLook, targeting and integrate: saved/default spawn x locked/free look, stable for five fixed steps (14 checks). 210/210 suites PASS; check-deps OK (377 files, existing warnings); mesh browser route on port 9690 completes all legs, real E lever interaction and end trigger. No engine edits or new pitch-reset rule; current transform pitch is preserved pending any separate PC-A policy. Existing reproduction below retained for review context.

**PO OK 2026-10-04 (PC-A PO) -> testing** (visible camera facing after death; pitch kept as-is, accepted policy).

- Evidence: `vitals.js` respawn writes the saved/default `transform.yawDeg` and clears targeting, but main.js never synchronizes `look.yawDeg` to that restored transform. The next update copies `look` into `controls`, and `integrate.js:79-81` writes those controls back onto the transform. Clearing a lock does not restore camera yaw.
- Reproduction: initialize production `createVitals` with save xyz=(0,0,0), save yaw=90; change current player/look yaw to 210, set HP=0, run the 138-step death timeline and press E. Player yaw is 90 immediately after respawn. One real `integrate` on a flat sector with the unchanged look controls sets yaw to 210. Both values asserted in the audit probe. The default spawn-facing path has the same overwrite.
- Fix scope for PO: make the restored facing persist in both camera and body across following fixed steps, for default spawn and saved spawn, including death while target-locked. Decide intended respawn pitch in the scoped story; the current vitals code restores yaw only, so this audit does not invent a pitch rule.
- Verification: Node call-order reproduction confirmed; existing `vitals.test.js` PASS, but its respawn assertions stop before the next integration. No implementation or spec deviation in this audit. Likely files if approved: main.js plus a meaningful integration regression; both route-walk renderers required for main.js changes.

### BUG-PICKUP-001 Save/load retains pickup entities but clears their simulation index

**NEEDS PC-A: PO review [PC-B game], P3, implemented 2026-10-04, latent.** Related: US-080b; no automatic beast-death drop hook exists yet (US-079), and the shipped R restart returns to a pristine state without drops. Do not treat this as an already-observed live-game blocker.

- PC-B implementation: `resetPickups(world)` reindexes retained pickup components on load and removes excess oldest/least-life drops using the existing 16-slot policy; main.js passes the loaded world. `spawnDrop` skips every occupied generated ID, including unrelated entities, before slot eviction. No-world reset still clears fixture state. The per-step path is unchanged. 28 new real JSON serialize/deserialize checks cover HP/MP collection (saved baseZ even when the view hid transform.z), exact expiry at saved life 1200/5, mixed-order over-cap/ties, repeated reset and a fresh module's exact pickup_1/2/3 collision -> pickup_4/5. Pickups 45/45 PASS; full 210/210 suites PASS, check-deps OK (377 files, existing warnings); mesh browser route on port 9700 completes every leg, real E lever interaction and end trigger. No spec deviation. Existing reproduction below retained for review context.

**PO OK 2026-10-04 (PC-A PO) -> done** (latent; policy = loaded drops resume, 16-cap enforced).

- Evidence: `pickups.js:24-26` reset clears all 16 slots without rebuilding them from `world`; main.js calls it on every `world:loaded`. Serialization retains pickup entities/components, but `stepPickups` visits only indexed IDs. `presentPickups` scans world entities separately, so the restored drops can remain visible while never collecting or expiring.
- Reproduction: real `World.load` with player HP=20/max=30 at (0,0,0); `spawnDrop(world,'hp',0,0,0)`; JSON round-trip `serialize` -> `deserialize`; call the same `resetPickups()` used by main.js on load. After 1201 calls to `stepPickups` with the player at the drop, all slots are null, HP stays 20 and the pickup entity still has life=1200. All observations asserted in the audit probe. Existing save test checks only component data, omitting load-time reset and subsequent simulation.
- Fix scope for PO: decide whether loaded drops resume or are intentionally discarded, then keep entities and slot table consistent with that policy. If retained, cover collection, expiry, the 16-drop cap and unique IDs when spawning after a fresh-process load (module `nextId` currently starts at 1).
- Verification: Node real-World reproduction confirmed; existing `pickups.test.js` PASS. No implementation or spec deviation in this audit. Likely files if approved: `pickups.js`, its tests and main.js load hook; both route-walk renderers required for main.js changes.

### US-087 Scoped targeting pause/UI gate follow-up

**NEEDS PC-A: PO review [PC-B game], implemented 2026-10-04, P2 audit triage.** This completes only the US-128b pause-input finding merged into US-087; the engine action-map epic remains todo.

Scoped ACs from the PC-A audit triage, with developer checks:

- [x] Pause, Settings, map and death block Q locking/unlocking and Tab/Shift-Tab/wheel cycling; wake/end gates remain blocked too.
- [x] Blocked updates skip targeting.step entirely, preserving no-target/fade timers and accumulated LOS-loss state.
- [x] Blocked wheel input drains; resuming does not replay it. Fresh lock/cycle input works after resume.
- [x] Gate is resolved before targeting and after Settings updates, including worlds without quest UI.

Implementation: new `game/js/quest/targetingInput.js` drains wheel before a boolean gate; the allowed path preserves existing Q/Tab/wheel behavior with no per-step objects/arrays. `main.js` moves pause determination before targeting and refreshes UI flags outside questUiActive. `targetingInput.test.js` has 100 checks against real createTargeting, including the production isPaused pointer-unlocked reproduction, each gate/input direction, timer freeze and LOS loss/resume. Focused targeting suites 2/2 PASS; full 211/211 suites PASS, check-deps OK (379 files, existing warnings). Mesh browser route on 9710 completes every leg, real E lever interaction and end trigger. No engine changes or spec deviation; no broader action-map/rebinding implementation.

**PO OK 2026-10-04 (PC-A PO) -> done for the scoped gate ACs (4/4)**; US-087 action-map epic stays todo.

## EP-CHARGEN + KPKG (PC-B architect, 2026-10-10; architecture.md 38.29 / 38.30; D-053 + owner decisions 2026-10-10: voxel-built rigid rigs as real meshes, three.js preview, Tauri shell, game loads .glb/.kestrel)
**Order:**
1. Kit and core: CHARGEN-01, 02, 03, 04a/04b, 05.
2. Packages, in parallel with step 1: KPKG-01, 02, 03.
3. Exports: CHARGEN-06..12.
4. App: 13a, 13, 14, then the shell (19, 20).
5. In-game path: RIG-00 (PC-A note), RIG-01..03, then CHARGEN-15..17.
6. CHARGEN-18.

**Every row:**
- ends with `node tools/run-tests.mjs` + check-deps green;
- engine rows end in `arch-review` (PC-A).

| ID | Title | Pri | Status | Files |
|---|---|---|---|---|
| CHARGEN-01 | Human kit v0: 22-bone skeleton, base `m_avg` (head + jaw, underwear), slots, skin/hair/dye ramps + preview | P1 | todo [PC-B designer, 0.75 d] | `content/chargen/human.charkit.json`, `design/chargen/*`, `design/palette.js` (append), `design/preview/chargen_kit.html` |
| CHARGEN-02 | `engine/chargen`: validateKit, validateRecipe, composeCharacter | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.75 d] | `engine/chargen/*.js` + tests + fixture kit, `engine/index.js` |
| CHARGEN-03 | `engine/chargen`: meshCharacter (per-bone greedy -> RiggedModel), sampleClip, collapseRig | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.75 d] | `engine/chargen/mesh.js`, `clip.js`, `collapse.js` + tests |
| CHARGEN-04a | Master clips on 22 bones: idle, walk, run, talk, listen, wave | P1 | todo [PC-B designer, 0.75 d] | kit JSON, preview |
| CHARGEN-04b | Piece set 1 + base `f_avg` (3 hair, 2 beard, 3 top, 2 legs, 2 feet, 1 hat, 1 hood) | P1 | todo [PC-B designer, 0.75 d] | kit JSON, preview |
| CHARGEN-05 | Height rows, age, build pick, randomRecipe(seed) | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.5 d] | `engine/chargen/*` + tests |
| CHARGEN-06 | Export base: png palette, check-deps rules (`tools/export/**`, `vendor/three` only in `tools/chargen/**`) | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.25 d] | `tools/export/png.js`, `tools/check-deps.mjs` + tests |
| CHARGEN-07 | GLB-a: static `.glb` (mesh + palette texture + COLOR_0 + `extras.kestrel`) | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.5 d] (done with skin + baked clips = 08/09 scope in the writer) | `tools/export/gltfWrite.js`, `tools/chargen/export.mjs` + tests |
| CHARGEN-08 | GLB-b: rigid skin + 22 humanoid joints | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.5 d] (already delivered inside CHARGEN-07 writer; verified, no code change) | `gltfWrite.js` + tests |
| CHARGEN-09 | GLB-c: 6 baked animations | P1 | ARCH OK (batch 2026-10-13) [PC-B B1] (already in the CHARGEN-07 writer: 2 baked clips idle/wave, FK-checked in gltfWrite.test.mjs; 6-clip set waits for CHARGEN-04a) | `gltfWrite.js` + tests |
| CHARGEN-10 | FBX-a: binary FBX 7.4 static mesh + material/texture | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.75 d] (static part done: binary FBX 7.4, own reader in the test; Blender/Unity import not run) | `tools/export/fbxWrite.js` + tests |
| CHARGEN-11 | FBX-b: skeleton + skin clusters + bind pose (Unity Humanoid) | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.75 d] (opts.skeleton:true: 22 LimbNodes+NodeAttributes, rigid Skin + 22 Clusters, BindPose; static bytes unchanged; Blender/Unity import not run) | `fbxWrite.js` + tests |
| CHARGEN-12 | FBX-c anim stacks + OBJ/MTL + `.vox` (voxWrite split) | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.75 d] | `fbxWrite.js`, `objWrite.js`, `voxWrite.js`, `tools/vox-export.mjs` + tests |
| CHARGEN-13a | UI-independent facade `createChargen` + CLI | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.5 d] | `tools/chargen/core.js`, `tools/chargen/export.mjs` + test |
| CHARGEN-13 | App UI + three.js viewer (vendored, MIT): preview = parsed export `.glb`, orbit, clips, Random/seed, export buttons | P1 | po-review (owner look) [PC-B B1, 0.75 d] | `tools/chargen/index.html`, `ui.js`, `viewer.js`, `vendor/three/*` |
| CHARGEN-13b | App: .obj + .vox exports wired (core, CLI, UI, All formats zip) | P1 | po-review [PC-B B2] | tools/chargen/core.js, ui.js, export.mjs + tests |
| CHARGEN-14 | App Save/Open `.kestrel` + "All formats (.zip)" + `platform.js` adapter (browser fallback) | P1 | arch-review [PC-B B1, 0.5 d] - deps KPKG-02 | `tools/chargen/ui.js`, `platform.js`, `core.js` |
| CHARGEN-19 | Tauri shell + stage + unsigned Windows installer | P1 | todo [PC-B B1, 0.75 d] - deps 13, 14 | `tools/chargen-desktop/*` |
| CHARGEN-20 | Signed release builds (Windows, macOS notarized, Linux AppImage) | P2 | todo [PC-B B1, 0.5 d] - needs owner certificates (ESCALATE 38.29 item 8) | `tools/chargen-desktop/*` |
| RIG-00 | ARCH-NOTE NEEDED: rigged-model seam in VoxelPool/instances (prebuilt mesh + parts + clips) | P1 | done (38.32, PC-B architect opus, PC-A to ratify) | `docs/architecture.md` |
| RIG-01 | `engine/mesh/gltf.js`: rigid-skin + animation reader `readRiggedGlb` | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.75 d] | `engine/mesh/gltf.js` + tests |
| RIG-02 | Rigged model in the registry/pool: collapseRig output drawn on the mesh path, play/partRot/mounts/shadows | P1 | todo [B2 or PC-A] - RIG-02a DONE -> arch-review (kestrel-3, 2026-10-10; see docs/lanes/pc-b2.md); RIG-02b DONE -> arch-review (kestrel-3, 2026-10-10; see docs/lanes/pc-b2.md). Per 38.32: RIG-02a (0.5 d: readRiggedGlb fixes 38.32 item 6 + fromGlb + collapseRig pivotM/anchorCells), RIG-02b (0.75 d: riggedModelDef + voxelPack rig branch + buildRiggedMesh); tests 38.32 item 8 | `engine/mesh/gltf.js`, `engine/chargen/{collapse,fromGlb,rigModel,index}.js`, `engine/voxel/voxelPack.js`, `engine/mesh/voxelMesh.js`, `engine/index.js` + tests (38.32 item 9) |
| RIG-03 | loadPack/KPKG asset types `model.rigged` / `model.static` -> `bundle.models`; main.js registers `char.<id>` | P1 | ARCH OK (batch 2026-10-13) (engine half + RIG-03w main.js/charRegister.js done, B1) [PC-B B2] | `engine/content/loadPack.js`, `package.js`, `game/js/main.js` |
| CHARGEN-15 | First villager from a `.kestrel` (`.glb`) + dialogue, like Burl | P1 | removed (owner 2026-10-10, D-058: Fen out of the world; add-on package system 38.33 kept, content/packages/index.json empty) | package, `content/worlds/world_m1.world.json`, `game/js/main.js` |
| CHARGEN-16 | Player look: `player.look` in the save + `hand@look` retint + owner walk (picks option A/B) | P1 | po-review (owner walk) [PC-B B1] | `game/js/quest/save/saveState.js`, `game/js/main.js` |
| CHARGEN-17 | New-game creation screen (title-menu skin, in-game-look preview built at runtime) | P1 | parked (owner 2026-10-10: no character creation at the start; screen unwired from New game, code kept) | `game/js/ui/charCreate.js` + test, `game/js/titleMenuHost.js`, `tools/verify-charcreate.mjs` |
| CHARGEN-18 | Builds slim/heavy (m, f) + elder overlay + piece set 2 | P2 | todo [PC-B designer, 0.75 d] | kit JSON |
| CHARGEN-22a | Per-recipe detail, kit + recipe half (D-055, 38.34 items 1-2, 7): `kit.regions`/`resLevels`/`base.detail`/`slots.keep` validation, `downsample2` (keep-priority), `recipe.res` (missing = 1/1, head >= body), GAME_SAFE_RES + CHAR_GAME_MAX_QUADS; tests 38.34 item 8 b, c, g | P1 | ARCH OK (batch 2026-10-13) [PC-B kestrel-3, 0.75 d; done: downsample.js, kit regions/resLevels/detail/keep/seam/stretch/attachment-res checks, recipe.res + DEFAULT_RES/effectiveRes/clampRes/GAME_SAFE_RES/CHAR_GAME_MAX_QUADS, randomRecipe res from kit.defaults.res (no rng draw), engine/chargen/detail.test.js 38 checks; human_kit.js untouched (no res/regions yet, bytes identical)] | `engine/chargen/{kit,downsample,recipe,index}.js` + tests |
| CHARGEN-22b | Per-recipe detail, compose + mesh (38.34 items 2-3): CharGrid `blocks` (head at its own level), height block remap, `meshBlock` + finest-grid output (`rigged.cellM` = G); 1/1 byte-identical; tests 38.34 item 8 a, d, e, f | P1 | ARCH OK (batch 2026-10-13) [PC-B kestrel-3, done 2026-10-10: see docs/lanes/pc-b2.md] | `engine/chargen/{compose,height,mesh}.js` + `blocks.test.js` |
| CHARGEN-22c | Per-recipe detail, exports + game cap (38.34 items 4-5): `flattenGrid` + `.vox` at the finest level (one shape per bone), glb `cellM` = G, game loader refuses rigged glb > CHAR_GAME_MAX_QUADS, build-kit stats per level; test 38.34 item 8 h | P1 | ARCH OK (batch 2026-10-13) [PC-B kestrel-3] (done 8bf69597: vox at finest grid, savePackage clamp + warnings, charRegister quad cap; build-kit per-level stats not done) -> ARCH OK | `tools/export/voxWrite.js` (+ flatten helper), `tools/chargen/export.mjs`, `tools/chargen-build-kit.mjs`, `game/js/quest/charRegister.js` + tests |
| CHARGEN-22d | Chargen app rows "Body detail" (Standard/Fine) + "Head detail" (Standard/Fine/Ultra), disabled when not in `kit.resLevels`, live quad count; package Save clamps to GAME_SAFE_RES + `gameRes` with a warning; creation screen (CHARGEN-17) offers Head Standard/Fine only (38.34 items 4, 7) | P1 | po-review [PC-B, 0.5 d; app rows done in ui.js, Save clamp + creation screen not in scope] - deps 22c | `tools/chargen/{ui,core}.js`, `game/js/ui/charCreate.js` + tests |
| CHARGEN-22e | mesh.test alloc warm-up (default stays 1/1, owner) | P1 | po-review [PC-B B2] | engine/chargen/mesh.test.js, engine/chargen/allocProbe.mjs |
| CHARGEN-23 | Designer: head redraw at 1.25 cm (`base.detail.head["2"]`, D-055): eyes with lid + lash line, iris, catchlight; lips with upper/lower shape and corners; `keep` on eye/lip/brow chars; refresh the Standard head from L2 if it reads better; preview at L1/L2 + owner look | P1 | todo [PC-B designer, 0.75 d] - deps 22b (preview needs compose) | `design/chargen/human_kit.js`, `content/chargen/human.charkit.json`, preview |
| CHARGEN-23b | Designer: head at 0.625 cm (Ultra, procedural script), only after the owner OKs 23 | P3 | todo [PC-B designer] - deps 23 | `design/chargen/human_kit.js` |
| CHARGEN-24 | Designer: body at 1.25 cm (`base.detail.body["2"]`: body shapes re-evaluated at 2x, hand/foot tables nearest-upsampled first) | P3 | todo [PC-B designer] - deps 22b | `design/chargen/human_kit.js` |
| RIG-03w | main.js: register `char.<id>` for every `bundle.models` rigged entry (`riggedModelDef(collapseRig(riggedFromGlb(...)))`) before `VoxelPool.bind`; engine half (loadModels in package.js) exists | P1 | todo [PC-B kestrel-1, 0.25 d] - deps RIG-02b -> arch-review | `game/js/main.js` (small), `game/js/quest/charRegister.js` + test |
| RIG-GC-01 | gpucompare row `charRig` (rigged character, 1 instance, jaw partRot) + baseline entry; RIG-02 AC "0 PASS->FAIL" made repeatable | P1 | todo [PC-B kestrel-2, 0.5 d] - deps RIG-02b -> arch-review | `game/js/dev/modes/gpucompare.js`, gpucompare test, baseline json |
| RIG-04 | Rigged-model alloc + parity guard: Node bench for 100 `char.` instances over 10k project/pose steps (0 alloc) + LOD1 get returns LOD0 | P1 | ARCH OK (batch 2026-10-13) (alloc FIXED by RIG-04b, see lanes/pc-b2.md) [PC-B kestrel-4] | `tools/bench-rig.mjs`, `engine/chargen/rigPerf.test.js` |
| WILD-07a | Flyer brain engine half with a fake env + placeholder bird model (one box part, 3 clips); no designer art needed | P2 | arch-review [PC-B kestrel-3, 0.75 d] - deps WILD-04 (done); flyerBrain.js + test done, see lane note | `engine/fauna/flyerBrain.js` + test, `engine/fauna/fauna.js` (kind switch) |
| CHARGEN-21 | Chargen app: recipe JSON import/export + seed share string (`kst1:<seed>:<hash>`) + PNG thumbnail export (core, no three.js) | P2 | po-review [PC-B kestrel-4] | `tools/chargen/core.js`, `ui.js`, `export.mjs` + tests |
| GLTF-HAND-01 | Report-only: static `loadGltf` handedness vs glTF spec with a tiny asymmetric fixture (38.32 risk 3) | P2 | done (report: CORRECT, docs/test-reports/GLTF-HAND-01.md) | `tools/gltf-handedness-check.mjs` + test, `docs/test-reports/GLTF-HAND-01.md` |
| KPKG-01 | `engine/content/zip.js` reader + writer (stored + deflate via platform streams) | P1 | ARCH OK (batch 2026-10-13): fix beae3be5 [PC-B B2, 0.5 d] | `engine/content/zip.js` + test + fixture zip |
| KPKG-02 | `engine/content/package.js`: kestrel.json validate, openPackage, mountPackages, deps, duplicate ids | P1 | ARCH OK (batch 2026-10-13): fix beae3be5 [PC-B B2, 0.75 d] | `engine/content/package.js` + test, `engine/index.js` |
| KPKG-03 | `tools/pack.mjs` / `unpack.mjs` + package specs | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.5 d] | `tools/pack.mjs`, `tools/unpack.mjs`, `content/packages/*.pkg.json` + tests |
| KPKG-04 | Game boot `?pack=` mounts packages | P1 | po-review [PC-B B1] (ARCH OK after KPKG-01..03 fixes) (boots from dist/kestrel.base-1.0.0.kestrel with ?pack=../dist/..., first frame at 3.6 s, same as loose; missing file -> clear boot error; game/js/packBoot.js; dist/ now git-ignored; boot-prefetch-browser.mjs got --extra <query>) | `game/js/main.js` |
| KPKG-05 | Editor Import / Export `.kestrel` | P2 | todo [PC-B B1, 0.75 d] | `tools/editor/*` |
| KPKG-07 | HTTP Range streaming of stored entries for lazy meshes | P3 | todo [PC-B B2, 0.75 d] -> arch-review | `engine/content/package.js`, `engine/mesh/lazyMesh.js` |

### CHARGEN-01 Human kit v0  [P1] [todo] [PC-B designer]
- [ ] `human.charkit.json` (schema 1) holds:
  - the 22-bone `skeleton`;
  - base `m_avg` per 38.29 items 2-3: realistic (style-guide 0), voxel-built, with underwear;
  - a joint and a box for every bone;
  - a separate jaw;
  - `stretchRows`: shin and waist rows only.
- [ ] Ramps:
  - 5 skin tones, each with 4 shades plus the 8 hand skin keys;
  - 6 hair colours;
  - 3 eye colours;
  - 6 natural dyes.
- [ ] Every new key is appended to `design/palette.js`.
- [ ] `design/preview/chargen_kit.html` shows the base in all 5 tones. The owner OKs the realism before CHARGEN-04.

### CHARGEN-02 Compose  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- [ ] `validateKit` reports each of these, with one fixture per rule:
  - an unknown bone;
  - a base voxel outside every bone box;
  - an unknown material key;
  - more than 255 materials;
  - a stretch row through a forbidden bone.
- [ ] `composeCharacter` follows 38.29 item 4: compose order, `hides`, `thick` growth with bone inheritance.
- [ ] Two runs give byte-identical output.
- [ ] `engine/chargen` imports nothing outside `engine/`.

- Note (dev): `engine/chargen/{kit,recipe,compose,index}.js` + `chargen.test.js` (49 checks, fixture kit), exported from `engine/index.js`. Kit JSON shape is in the `kit.js` header (bases.layers = string[z][y]; stretchRows = int z rows; shells t = 0 at box top). Choices to confirm: stretch row is forbidden if its base voxels belong to any bone outside Hips/Spine/Left+RightLowerLeg; >255 materials = worst case (widest ramp per group + fixed keys) in validateKit, hard throw in compose; `hides` skips the hidden slots; thick n also repaints the original surface. Height/age/build/randomRecipe left to CHARGEN-05.

### CHARGEN-03 Mesh and clips  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- [ ] `meshCharacter` output:
  - one range per bone;
  - no interior faces;
  - no quad crosses bones.
- [ ] Record the quad count for `m_avg`; it must be <= 8000.
- [ ] `sampleClip`:
  - the quaternion equals Euler `Rz*Ry*Rx` within 1e-6;
  - no sign flips;
  - writes into caller arrays (0 alloc over 10k calls).
- [ ] `collapseRig` with the humanoid `partMap`:
  - gives <= 8 parts with 50 ms keys;
  - the rest pose equals the master.
- [ ] Build time is <= 10 ms (bench line in the row).

- Note (dev): `engine/chargen/{mesh,clip,collapse}.js` + `mesh.test.js` (37 checks, synthetic 22-bone 36x20x76 grid; the real m_avg quad count waits for CHARGEN-01: synthetic = 3195 quads, 0.65 ms warm). Formats (confirm): mesh = 4 verts/quad (implicit indices 0,1,2,0,2,3), `mat` per quad, `ranges` in quads per bone, metres from the anchor, Int8 axis normals; a face between two filled voxels is culled even across bones (watertight at rest; no joint caps). Clip = `{duration, loop?, keys:[{t, rot:{Bone:[rx,ry,rz]}, pos:{Hips:[cells]}}]}`, Euler lerped then converted; sign by lookup in a 5 ms sign-continuous table (stateless, deterministic); Hips pos out in metres. `collapseRig(rigged, partMap)` with `HUMANOID_PART_MAP` (compose 2 for body/head); output frames/durations in the VoxelClipDef shape (pos in cells, pivots in cells = `jointCells`); `MAX_PARTS`=8 mirrors MAX_VOX_PARTS (engine/chargen imports only itself; test pins it). Follow-up (kestrel-2): real `m_avg` (kit v0, no clothes) = 1927 quads (limit 8000), build 9 ms warm / 12.7 ms cold (one 10 ms-ish edge). sampleClip: 16 B/call was a measurement artifact (heapUsed moves in 16 B steps around scavenges; a 400k-call run does not scale), now measured as the median of 7 windows after warm-up = ~0 B/call on the 22-bone rig; also moved the Euler angles of the hot path through a Float64Array scratch (`eulerBufToQuat`) so no double is ever passed as a call argument (boxing risk when not inlined).

### CHARGEN-04a / 04b Clips and pieces  [P1] [todo] [PC-B designer]
- [ ] **04a:** idle, walk, run, talk (Jaw), listen and wave on the 22 bones. Durations are multiples of 50 ms; clips play in place.
- [ ] **04b:** the pieces fit `m_avg` and `f_avg`, and `validateKit` passes.
- [ ] A preview page shows each clip on the 22-bone rig and on the collapsed 8-part rig side by side. The owner gives an OK.

### CHARGEN-05 Sliders and random  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- [ ] Height -4..4 rows shifts the joints, boxes and anchors.
- [ ] `elder` = overlay, height -1 and tempo x1.15.
- [ ] `randomRecipe`: the same seed gives the same recipe, and all of 1000 seeds validate.

- Note (dev): `engine/chargen/{height,random}.js` + `height.test.js` (53 checks on the real kit), compose/recipe/mesh/index extended. Height: `heightBase(base, h)` duplicates (h>0) or deletes (h<0) |h| of the sorted `stretchRows`, picks spread evenly; size/layers/boxes/joints/anchors/mounts remapped (fractional z linear inside a row); feet stay on z 0; throws when a base has no stretchRows or a bone loses all rows. All heights -4..4 compose and mesh on m_avg. Elder: effective height = height-1 (min -4), every kit attachment of slot `overlay` painted last (none in kit v0; designer adds `elder_overlay`), `tempo` 1.15 on the grid and the RiggedModel (caller multiplies clip time). Build = pick another authored base (already supported by `recipe.base`). `randomRecipe(kit, seed)`: xorshift32, optional `kit.random` weights (see random.js header; defaults bell-shaped height, uniform otherwise, slot "none" weighs 1); 1000 seeds validate. Choices to confirm: attachments now place at Math.round(anchor+offset) (fractional anchors like head_top 69.5 were unusable before); `overlay` is a new slot name only valid for attachments (not a recipe slot).

### CHARGEN-06..09 png and glTF `.glb`  [P1] [todo] [PC-B B1]
- [ ] **06:**
  - the PNG decodes with `tools/png-read.mjs`;
  - the check-deps rules have fixtures.
- [ ] **07:**
  - the Khronos glTF Validator (web) reports 0 errors;
  - Blender 4.x imports a 1.75 m character with palette colours;
  - Godot 4 imports it.
- [ ] **08:**
  - Blender shows an armature with the 22 Unity names, and the mesh follows the bones;
  - the Godot bone map auto-fills with `SkeletonProfileHumanoid`.
- [ ] **09:**
  - 6 actions play in Blender and in Godot;
  - in Unity (glTFast) the clips play.
- [ ] Golden SHA-256: the same recipe gives the same bytes.
- [ ] Each step attaches a Blender CLI import log (`tools/chargen/verify-blender.py`) to the row.

- Note (dev, kestrel-2): batch-9 fixes in `engine/chargen` (overlay kit slot, array `partMap` validation, arm STRETCH_BONES + symmetry, same-bone face culling, array-only collapseRig). 06: `tools/export/png.js` (+test, round-trips `png-read`), check-deps rules 19 (tools/export browser-safe) + 20 (vendor/three only in tools/chargen) with fixtures. 07: `tools/export/gltfWrite.js` + `gltfWrite.test.mjs` (42 checks, golden SHA-256 pinned) + `tools/chargen/export.mjs` CLI; sample `docs/test-reports/chargen-sample.glb` (`--demo-clips`: kit v0 has `clips:{}`). DECIDED 2026-10-10: default colorMode is now 'white' (golden 66daffb3...; 'rgb' stays an option); the TEMP partMap shims are removed (kit re-emitted, kitfix merged). Open: (1) Khronos validator NOT run (npx has no local gltf-validator; downloading needs owner OK); (2) -; (3) -; (4) mounts stored in extras as authoring-axes metres from the anchor.

### CHARGEN-10..12 FBX, OBJ, VOX  [P1] [todo] [PC-B B1]
- Note (dev, kestrel-2): CHARGEN-10 done in `tools/export/fbxWrite.js` (`exportFbx(model,{rgbOf,colorMode})` -> {fbx,png}; CLI `export.mjs --fbx f.fbx` writes palette.png beside). Binary 7400, uncompressed arrays, Blender footer, Y-up cm, +Z front, quads, Normal/UV/Color(white default)/Material layers, Material lambert + Texture palette.png (DiffuseColor). Test (21 checks, own FBX reader, golden a651ae1e...) 175.0 cm tall. NOT run: Blender/Unity import (needs a manual look; sample docs/test-reports/chargen-sample.fbx). Next: 11 skeleton/skin/bindpose, 12 anim stacks + OBJ + VOX.
- [ ] **10 FBX static:**
  - Blender imports the binary FBX 7.4 at 1.75 m with the texture;
  - Unity imports it at the right scale.
- [ ] **11 FBX skeleton:**
  - **Unity: Rig = Humanoid -> Configure maps every required bone (green)** after "Enforce T-Pose";
  - Blender shows a 22-bone armature.
  - If this fails after one attempt -> ESCALATE (Blender-CLI fallback).
- [ ] **12 FBX animation:** the 6 stacks play on the Unity Humanoid avatar and in Blender.
- [ ] **12 OBJ:** OBJ + MTL + PNG import with colours in Blender and Unity.
- [ ] **12 VOX:**
  - the `.vox` opens in MagicaVoxel with one named object per bone;
  - it round-trips through `voxParse`;
  - a palette over 255 entries or an axis over 256 gives a clear error.
- [ ] Golden SHA-256 for every format.

### CHARGEN-13a / 13 / 14 Facade and app  [P1] [todo] [PC-B B1]
- [ ] **13a facade:**
  - `createChargen` matches 38.29 item 7;
  - no DOM, `fs`, Tauri or three references (a test greps for them);
  - a Node test runs recipe -> every format -> `.kestrel` -> reopen.
- [ ] **13 viewer:**
  - three.js is vendored with its LICENSE and a pinned version;
  - the viewer renders the parsed export `.glb`: lit, with a shadow, OrbitControls, clip play/scrub and turntable;
  - every UI change re-previews within 150 ms debounce + build;
  - no ASCII renderer and no Esc hint text (`no-esc-hint.test.mjs`).
- [ ] **13 buttons:** every export button gives the same bytes as the CLI.
- [ ] **14:** Save writes a `.kestrel` (38.30) that reopens to the identical recipe.
- [ ] **14:** "All formats (.zip)" holds glb, fbx + png, vox, and obj + mtl + png.
- [ ] **14:** the browser fallback works without Tauri.

### CHARGEN-19 / 20 Tauri desktop app  [P1/P2] [todo] [PC-B B1]
- [ ] **19 build:** `tools/chargen-desktop` builds with the Tauri CLI into a native window with no dev server.
- [ ] **19 files:** Open and Save use native dialogs (dialog + fs plugins, user-picked paths only). Saved files are byte-identical to the CLI.
- [ ] **19 security:**
  - CSP `default-src 'self'`;
  - no shell plugin;
  - the staged app contains no `game/` file.
- [ ] **19 installer:** the MSI/NSIS installer installs and runs on a clean Windows 11. Licence notices for three.js and Tauri are bundled.
- [ ] **20:** a signed Windows installer (no "unknown publisher"), a notarized macOS dmg and a Linux AppImage. Each opens, builds a random character and exports a `.glb` that opens in Blender.

### RIG-01..03 In-game rigged meshes  [P1] [todo] [PC-B B2 / PC-A]
- [ ] **01 reader:**
  - `readRiggedGlb` reads our exported `.glb` into a RiggedModel equal to `meshCharacter` output (positions within 1e-5, same ranges and clips);
  - non-rigid weights, more than 1 skin, or morph targets -> a clear error;
  - the static path is unchanged (existing gltf tests stay green).
- [ ] **02 draw:** per RIG-00. A `char.<id>` entity plays clips, takes the jaw `partRot`, has mounts and casts a shadow. 0 alloc over 10k steps. One `?gpucompare=1` run with 0 PASS->FAIL.
- [ ] **03 load:** a `.kestrel` with `models/<id>.glb` loads through `mountPackages` + loadPack and registers `char.<id>`. A missing `extras.kestrel.matKeys` gives a ContentError that points to `gltf-import --map`.

### CHARGEN-15 / 16 / 17 Game  [P1] [todo] [PC-B B1]
- [ ] **15:** one villager in `world_m1` loads from a `.kestrel` (`.glb`, no `.js` model). It idles, talks through a dialogue file, plays talk/listen and syncs the jaw (38.28). One browser pass.
- [ ] **16:**
  - `player.look` saves and loads; old saves get the default look;
  - the first-person hands (every variant) take the skin tone; the fire colours are unchanged;
  - the sleeve takes the top dye.
  - **Owner walk:** hands in 3 tones and a walking villager; the owner picks option A or B (38.29 item 1).
- [ ] **17:**
  - New game -> slot -> creation screen in the title-menu skin, with the 38.29 item 5 rows and a rotating in-game preview (runtime compose -> RiggedModel);
  - Random and Done work, with keyboard and mouse;
  - no Esc hint text;
  - a Node flow test and one capture.

### KPKG-01 Zip  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- [ ] Reads a Python `zipfile` fixture with stored and deflate entries.
- [ ] Write -> read round trip. Stored-only output is byte-deterministic.
- [ ] Errors for:
  - a bad CRC;
  - `..`, absolute or backslash paths;
  - more than 10000 entries;
  - the size and ratio limits.
- [ ] No imports outside `engine/content`.

### KPKG-02 Package  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- [ ] Rejects:
  - a missing `license.spdx`;
  - a bad `id`;
  - a newer `formatVersion`;
  - an asset path that is not in the zip.
- [ ] A content pack loaded loose and the same pack loaded through `mountPackages` give deep-equal bundles.
- [ ] A missing or too-old dependency -> ContentError. The same id in two packages -> ContentError that names both.

Note (dev): package.js + package.test.js (44 checks). mountPackages is async (reads content ids to detect duplicates) and also returns manifestUrl(id). Dup ids = typed asset ids + content-file ids (kind+id) across mounted packages; deps caret/exact, 0.x caret handled. model.rigged/static asset types are validated only (RIG-03 consumes them). Exported from engine/index.js.
### KPKG-03 / 04 / 05 Pack tools, boot, editor  [P1/P2] [todo] [PC-B B1]
- [ ] **03:** `node tools/pack.mjs content/packages/kestrel.chargen.human.pkg.json` writes `dist/*.kestrel`; unpack -> pack is a round trip.
- [ ] **04:** `?pack=dist/kestrel.base.kestrel` boots the same world as the loose files (one capture compare).
- [ ] **05:** the editor imports a `.kestrel` (assets with thumbnails) and exports selected assets with their dependencies.

Note (KPKG-03 dev): tools/pack.mjs (spec `entries` from/to/exclude globs -> deterministic dist/<id>-<version>.kestrel, re-validated via openPackage; also packs a dir holding kestrel.json) + tools/unpack.mjs + content/packages/kestrel.base.pkg.json (6.5 MB) + tools/pack.test.mjs (12 checks: determinism, unpack->pack byte-identical, errors, base packed bundle deep-equals loose). engine/index.js now also exports readZip/writeZip/crc32/checkZipPath/ZIP_LIMITS. content-smoke ignores content/packages/. Not done: `kestrel.chargen.human.pkg.json` (kit does not exist yet, CHARGEN rows); write its spec when it does. 04/05 still todo.

## EP-WILD Living forest: ambient wildlife (D-053; architecture 38.31; PC-B architect 2026-10-10)
**Order:**
1. WILD-01 and WILD-02 (B2) run in parallel with WILD-03 and WILD-04 (B1).
2. Then WILD-05 (B2) and WILD-06 (B1).
3. After the owner OKs the rabbit + deer preview: WILD-D1..D4, then WILD-07 and WILD-08.

**Every row:**
- ends with `node tools/run-tests.mjs` + check-deps green;
- engine rows end in `arch-review` (PC-A).

| ID | Title | Pri | Status | Files |
|---|---|---|---|---|
| WILD-01 | Voxel pose crossfade: `pushInstance` returns the slot, `blendInstance`, from-clip lerp in `sampleClip` | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.5 d] | `engine/voxel/voxelPose.js`, `engine/render/voxelPool.js` + tests |
| WILD-02 | `engine/entities/clipPlayer.js` (rate, phase, fade, once->next) + `gait.js` (pickGait, gaitRate) | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.5 d] | `engine/entities/clipPlayer.js`, `engine/entities/gait.js` + tests, `engine/index.js` |
| WILD-03 | `engine/fauna` def + spawner: compileFaunaDef, 64 m cell ring, habitat roll, caps, view-cone spawn rule, despawn + cooldown, check-deps rule 15 | P1 | ARCH OK (batch 2026-10-13) [PC-B B1, 0.75 d] | `engine/fauna/faunaDef.js`, `engine/fauna/spawner.js` + tests, `tools/check-deps.mjs` (+ fixture test) |
| WILD-04 | `engine/fauna` ground brain: idle/graze/move/alert/flee/return via perceive + leash, feelers, group alarm, gait rate | P1 | todo [PC-B B1, 0.75 d] - deps WILD-02, 03 -> arch-review | `engine/fauna/groundBrain.js`, `engine/fauna/fauna.js` + tests |
| WILD-05 | Fauna feed + `engine.feedVoxels` hook + bench | P1 | ARCH OK (batch 2026-10-13) [PC-B B2] - feed 0.0012 ms p95, 20 drawn / 11.9k quads (real rabbit+deer), 0 alloc; hook engine.feedVoxels; slot contract: slot.cp = clip player (WILD-04 must set it); test engine/voxel/faunaFeed.test.js (fauna cannot import render, rule 19) | `engine/fauna/feed.js`, `engine/render/frameRenderer.js` (one line), `tools/bench-fauna.mjs` |
| WILD-04 | `engine/fauna` ground brain: idle/graze/move/alert/flee/return via perceive + leash, feelers, group alarm, gait rate | P1 | ARCH OK (batch 2026-10-13) [PC-B B1] (impl done; see note) | `engine/fauna/groundBrain.js`, `engine/fauna/fauna.js` + tests |
| WILD-05 | Fauna feed + `engine.feedVoxels` hook + bench | P1 | todo [PC-B B2, 0.5 d] - deps WILD-01, 04 -> arch-review | `engine/fauna/feed.js`, `engine/render/frameRenderer.js` (one line), `tools/bench-fauna.mjs` |
| WILD-06 | Game wiring: FaunaEnv (habitat from terrain.typeAt, trunk grid, blocked, moveCircle), rabbit + deer in, reset on load, replay-hash test, owner walk | P1 | po-review [PC-B B1, 0.75 d] - deps WILD-05 | `game/js/wild/wildEnv.js` + test, `game/js/main.js` (small), `game/index.html` (script tag) |
| WILD-06b | Fauna avoids colliding placed meshes + tools/verify-wild.mjs headless spawn/draw check | P1 | po-review [PC-B B1] | game/js/wild/wildEnv.js + test, tools/verify-wild.mjs, game/js/main.js (debug getter) |
| WILD-07 | `engine/fauna` flyer brain: perch, takeoff, Bezier flight, land, flock | P2 | todo [PC-B B1, 0.75 d] - deps WILD-D3, 06 -> arch-review | `engine/fauna/flyerBrain.js` + test, `game/js/wild/wildEnv.js` (perchNear) |
| WILD-08 | Climber (squirrel: flee to trunk, climb, peek) + fox def wiring | P2 | todo [PC-B B1, 0.5 d] - deps WILD-D1, D2, 06 -> arch-review | `engine/fauna/groundBrain.js` + test |
| WILD-D1 | Squirrel voxel model + clips (idle, forage, hop, run, climb with the body pitched 90 deg in the clip, peek) | P2 | todo [PC-B designer, 0.75 d] - after the owner OKs the rabbit + deer preview | `design/models/voxel_wildlife.js`, `design/preview/wildlife.html` |
| WILD-D2 | Fox voxel model + clips (idle, sniff, walk, trot, run, alert, pounce) | P2 | todo [PC-B designer, 0.75 d] - after the owner OK | same |
| WILD-D3 | Songbird voxel model + clips (perch idle, hop, peck, takeoff, flap, glide, land) + `perchByModel` for the 6 forest tree models | P2 | todo [PC-B designer, 0.75 d] - after the owner OK | same + `wildlifeFx.bird` |
| WILD-D4 | `spawn` blocks for all species in `wildlifeFx` (habitats, cellChance, spawn/despawn/draw distances, caps, kind) | P1 | todo [PC-B designer + PO, 0.25 d] | `design/models/voxel_wildlife.js` |
| PLANT-SCALE-01 | Owner 2026-10-10: plants were bigger than the boar - uniform placement scale per Quaternius plant (tools/plant-scale.mjs, used by gen-meadow/gen-roadside; 261 world_m1 rows): bush 0.6, grass 0.3-0.4, fern 0.5, flowers/clover 0.25 (MESH-SCALE-01 min), plants 0.4-0.6, mushroom 0.4 | P1 | po-review [PC-B main, owner look] (gpucompare + route walk PASS) | `tools/plant-scale.mjs`, `tools/gen-meadow-meshes.mjs`, `tools/gen-roadside-meshes.mjs`, `content/worlds/world_m1.world.json`, `engine/world/scale.test.js` |
| PLANT-VOXEL-OFF-01 | Owner 2026-10-10: voxel plant scatter removed (tufts layer, voxel flowers, bushRound, fern, mushrooms); 'stones' layer keeps the small rocks/pebbles at the old density; shelf fungus Mushroom_Laetiporus off the ground (22 world_m1 rows removed, meshClass 'other' so generators skip it) | P1 | po-review [PC-B main, owner look] (gpucompare + route walk PASS) | `design/levels/overworld_far.js`, `content/worlds/world_m1.world.json`, `tools/editor/meshPlace.js`, `engine/mesh/scatterFeed.test.js` |
| WAYSTONE-NORMAL-01 | Waystone no longer ends/restarts the game (demo end trigger removed, D-056); quest shows complete, play continues | P0 | po-review [PC-B B1, owner look] | content/worlds/world_m1.world.json, route walks, tests |
| RESIZE-RECOVER-01 | WG pipeline: failed grid resize retries (3x) instead of staying on the CPU path | P1 | ARCH OK (batch 2026-10-13) [PC-B B1] | engine/render/gpu/wg/WgCellPipeline.js + test |
| FRAME-ALLOC-03 | frameRenderer zero-alloc gate back under 16 KB / 1000 steps | P1 | ARCH OK (batch 2026-10-13) [PC-B B1] | engine/render/frameRenderer.test.js (warm-up 25000), engine/render/sprites.js (camBasis uses pitchedTermsInto) |
| GPU-OFF-REASON-01 | WG pipeline warns why the GPU path turned off (+ fix any settings-driven silent off) | P1 | ARCH OK (batch 2026-10-13) [PC-B B1] | engine/render/gpu/wg/WgCellPipeline.js + test |
| CULL-CAP-01 | GPU path fell back to CPU (4-9 fps) when >128 cull args slots were in view ('args slot capacity exceeded (130 > 128)', found via GPU-OFF-REASON-01): MAX_CULL_BATCHES 64 -> 128, args slots sized for 4 ranges per LOD, supports() rejects a group that would overflow (non-cull path) instead of throwing mid-frame | P0 | ARCH OK (batch 2026-10-13) [PC-B main] (gpucompare + route walk + verify-wild PASS) | `engine/render/gpu/wg/passCull.js` + test |

### WILD-01 Voxel pose crossfade  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- Note (kestrel-3): `sampleClip` -> `sampleInto` x2 in `voxelPose.js`; `pushInstance` returns slot, `blendInstance`, from-fields on raw/projected/shadow slots in `voxelPool.js`. fromW<=0 byte-identical: 288 poses (boar, bear, quadruped12, all clips/frames) vs HEAD voxelPose, 0 mismatches. fromW=1 equals from-pose to 1e-9 (not bit-exact: cur+(from-cur)*1).
- [ ] `pushInstance` returns the raw index (-1 when dropped). `blendInstance(i, fromClip, fromFrame, fromTMs, fromW)` sets the from-clip on that slot.
- [ ] The projected and shadow slots carry the from-clip fields (38.31 item 8).
- [ ] Byte-identical pose when `fromW = 0` or `fromClip = -1`.
- [ ] `fromW = 1` equals the from-clip pose. `fromW = 0.5` is the mid lerp.
- [ ] No allocation (`--expose-gc` test). Existing voxel / gpucompare tests stay green.

### WILD-02 Clip player + gait  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B2]
- Note (kestrel-3): done in `engine/entities/clipPlayer.js` + `gait.js`, exported from `engine/index.js`; tests in `engine/voxel/crossfade.test.js` (30 checks incl. 100k-step heap test).
- [ ] `clipPlay`, `clipStep`, `clipSetPhase` and `clipFromW` work as in 38.31 item 8:
  - rate x2 = half the lap time;
  - phase 0.5 lands mid-clip;
  - once -> next (sitUp -> alert);
  - the smoothstep fade goes 1 -> 0.
- [ ] `pickGait` with 0.15 m/s hysteresis (no flip-flop at 1.5 m/s with the rabbit gaits). `gaitRate` is clamped to `rate[]`.
- [ ] Exported from `engine/index.js`. Zero allocation.

### WILD-03 Fauna def + spawner  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B1]
Note (programmer): all ACs below done and tested (faunaDef 17 checks, spawner 27 checks incl. 1e4-step heap test < 20 KB, check-deps fixture 77 pass).
- `compileFaunaDef(wildlifeFx, models, {warn})`: 2nd arg is a name -> pm resolver (function or object), not the pool. Clip indices must match across a species' models.
- check-deps rule is numbered **19**, not 15 (15 = determinism WARN, 16 = fx leaf are taken). Allowed set as in 38.31 item 1.
- Spawner API: `createSpawner(def, env, {seed, maxAlive})` -> `{slots, stats, update(dt,px,py,camX,camY,camFx,camFy,hfov), despawn(slot, cooldown), reset(), onSpawn, onDespawn}`. Spawn/despawn pass every 0.2 s. WILD-04's `createFauna` wraps it. Slots already carry the brain fields.
- Fixture copy of the rabbit/deer data: `engine/fauna/wildlifeFx.fixture.js`. Exported from engine/index.js: compileFaunaDef, createSpawner, FAUNA_MAX, FAUNA_CELL_M.
- [ ] `compileFaunaDef` resolves clip indices; a missing clip throws a message that names the species and the clip.
- [ ] `compileFaunaDef` validates the `dist` order and `spawn` defaults (38.31 item 2).
- [ ] Spawner:
  - same seed + same player path = same spawns;
  - no spawn inside the view cone within `drawM`;
  - global and per-species caps hold;
  - despawn past `despawnM`;
  - cell cooldown.
- [ ] The 7 x 7 ring re-centres without allocation. No `Math.random`.
- [ ] check-deps rule 15 (engine/fauna imports) + a fixture case.

### WILD-04 Ground brain  [P1] [ARCH OK (batch 2026-10-13)] [PC-B B1]
Note: groundBrain.js + fauna.js (createFauna: spawner + brains, onSpawn/onDespawn wired) + groundBrain.test.js (11 cases incl. 1e5 steps x 40 animals, heap growth <3 MB). Species lookup via slot.species; spawner yaw is degrees, converted in initGroundAnimal. despawnReq slot flag: fauna.js despawns it once out of view. Group alarm is by slot.group within 15 m. Deviations: flee min 2 s so far alarm victims are not leashed back at once; homeR default min(25, maxDistM*0.4).
- [ ] Fake-env tests:
  - notice -> alert -> flee as the player approaches;
  - `fleeIfRunning` when sprinting;
  - the flee path never enters the blocked disc or the water strip;
  - safe -> return home (leash);
  - a threat during RETURN still forces a flee;
  - the group alarm reaches members within 15 m;
  - the gait rate stays in `rate[]`;
  - the stuck rule turns the animal.
- [ ] Decision tick staggered at 10 Hz (2 Hz beyond `drawM`). Zero allocation over 1e4 steps with 40 animals.

### WILD-05 Feed + hook + bench  [P1] [todo] [PC-B B2]
- [ ] `engine.feedVoxels(pool, cam)` is called once after `voxelPool.collect`. No hook = byte-identical frame.
- [ ] Feed:
  - nearest-first;
  - in view (+10 deg) or < 6 m;
  - <= `drawMax`;
  - leaves 4 pool slots free.
- [ ] `tools/bench-fauna.mjs`: 40 alive / 20 drawn. Step <= 0.15 ms p95, feed <= 0.05 ms. Numbers in the row note.

### WILD-06 Game wiring  [P1] [todo] [PC-B B1]
- [ ] `wildEnv.js` implements FaunaEnv:
  - habitat bitmask from `terrain.typeAt` (centre + 4 ring samples at 12 m for the edge);
  - trunk bucket grid from `world.scatter`;
  - `blocked` / `moveCircle` via `structureAt`, the trunk grid, `waterAt` and `collideCircle`;
  - allocation-free.
- [ ] Rabbit + deer models are bound in the registry. Fauna steps after the player. `fauna.reset()` on load, new game and teleport.
- [ ] beastSim replay hash identical with fauna on and off (600 steps).
- [ ] One `capture-browser` frame with rabbits and deer. Then the owner walk: rabbits on the meadow, deer at the forest edge, both flee, no foot sliding, no snapping.

### WILD-07 Birds  [P2] [todo] [PC-B B1]
- [ ] Perch on trees (`perchNear`). Takeoff when the player is within `dist.flee`.
- [ ] The new perch is 30-70 m away and farther from the player. Flock shares the target, with a start delay.
- [ ] Landing error < 0.05 m. No perch -> fly out of view and despawn. Zero allocation.

### WILD-08 Squirrel + fox  [P2] [todo] [PC-B B1]
- [ ] Squirrel flees to the nearest trunk, climbs to 2-5 m on the far side from the player, then peeks.
- [ ] Fox runs as a ground species from data only (no new code paths beyond the `kind` switch). Tests with a fake trunk.

### WILD-D1..D4 Designer  [P2/P1] [todo] [PC-B designer]
- [ ] Start only after the owner OKs `design/preview/wildlife.html` (rabbit + deer).
- [ ] Realistic voxels (style-guide 0), four-legged animals on all fours; same file + preview.
- [ ] Ground models <= 2.5k quads, bird <= 0.4k (38.31 item 9).
- [ ] Gait clips tuned with `tunedMps` + `rate[]`.
- [ ] D3 includes `perchByModel` measured on the forest tree meshes. D4 sets the `spawn` blocks with the PO.

## EP-QUEST giver flow (D-058) (PC-B architect opus, 2026-10-10; architecture 38.35; PC-A to ratify)

No engine change (38.35). Order: QG-W1 + QG-D1 in parallel with QG-01/02 -> QG-03 -> QG-04, QG-05 -> owner walk. Placeholder text is fine until QG-W1 lands (swap = data only).

| ID | Slot | Size | Files | Deps |
|---|---|---|---|---|
| QG-01 | kestrel-3 (pure game sim, no main.js) | 0.5 d | `game/js/quest/sim/questBook.js` + test | - | ARCH OK (batch 2026-10-13)
| QG-02 | kestrel-3 | 0.5 d | `questBook.js` (`migrateQuestSave`), `game/js/quest/save/saveState.js`, `questSave.test.js` | QG-01 | ARCH OK (batch 2026-10-13)
| QG-03 | kestrel-1 | 0.75 d | `game/js/questRelay.js`, `game/js/saveRelay.js`, `game/js/quest/dialogueCtl.js`, `game/js/main.js`, `content/quests/m1.quest.json`, `content/quests/burl.boars.quest.json` (new) + wherever m1 is loaded, `content/dialogue/bear.dialogue.json`, `tools/validate-content.mjs` | QG-01, QG-02, QG-D1 (coin def; until then reward an existing item) |
| QG-04 | kestrel-1 | 0.5 d | `game/js/quest/wire/questMarks.js`, `game/js/quest/mapCard.js`, main.js marker wiring | QG-03, QG-D1 |
| QG-05 | kestrel-1 (VIEW DONE kestrel-2, mount = NEEDS B1-main) | 0.5 d | `game/js/ui/questLog.js` (+ preview), `game/js/quest/input/bindings.js`, `game/js/gameKeys.js`, main.js | QG-03 |
| COMPASS-01 | Golden pocket compass HUD module (D-061) | P1 | po-review [PC-B] | game/js/ui/compassHud.js + test; mount NEEDS B1-main |
| COMPASS-02 | Compass in the game (style, mount, hide rules) | P1 | po-review [PC-B B1, owner look] | game/index.html, game/js/main.js, game/js/ui/compassHud.js |
| QG-W1 | writer | 0.25 d | `docs/story.md` (Burl quest texts) - NEEDS WRITER | - |
| QG-D1 | designer | 0.25 d | `?` marker model (`questMarkReady`), `coin` glyph/icon | - |

### QG-01 questBook sim  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-3]
- [ ] `createQuestBook(mainDef, giverDefs, saved?)` + `validateGiverQuest` per 38.35 items 1, 2, 4; `quest.js` unchanged.
- [ ] Status ints unavailable/available/active/ready/done; `accept`, `handIn` (null unless ready; second call null), `quest.<id>.done` flag fed to every quest on hand-in.
- [ ] `hasKey`/`actKey` over a `Map` built at create; unknown key -> false, no throw. `giverMarks(outA, outR)`, `tracked()`, `version`, `onChange`, `toSave`, `hashInto`.
- [ ] Tests (38.35 item 11, questBook part) incl. facts before accept, accept-when-complete -> ready, 10k-step heap check.

### QG-02 Quest save field + migration  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-3]
- [ ] `save.game.quests` optional (38.35 item 9); `validateSave`/`collectSave`/`applySave` accept and round-trip it; old saves without it still load byte-identically.
- [ ] `migrateQuestSave`: three fixtures (prefix incl. `beasts` -> done, no reward; prefix ends at `sword` -> accepted with old dead boars, ready if 5/5; earlier -> nothing).
- [ ] `SAVE_VERSION` stays 1. `node tools/run-tests.mjs` + check-deps green.

### QG-03 Wire the book: Burl's quest playable  [P1] [po-review: owner walk] [PC-B kestrel-1]
Done (D-058 owner pick: no reward, writer texts QG-W1 in place): questRelay/saveRelay hold the book (`relay.quest.book`, m1 state = book.main), dialogueCtl routes `q.*` to `opt.book()`, main.js loads burl.boars + toasts "Quest accepted"/"Quest complete" via book.onChange; validate-content checks `q.<id>.<op>`; test `game/js/quest/questGiverFlow.test.js`. No reward code (spawnDrop path not built: no item reward). Browser walk + offer-box capture left to the main session.
- [ ] Relay/saveRelay hold the book (`relay.quest.state` still = m1 state); events fan out; `onChange` -> `gameHooks.emitSimple`.
- [ ] `m1.quest.json` `beasts` -> flag `quest.burl.boars.done` (same id/index); `burl.boars.quest.json` (giver `bear`, requires m1 `sword`, 5 boars, reward `coin` x10 placeholder).
- [ ] dialogueCtl flags adapter routes `q.*` to the book; `bear.dialogue.json` entries ready/active/available/talked/intro with offer (Accept/Later), reminder, hand-in nodes (placeholder lines until QG-W1).
- [ ] Hand-in grants via `addItem`, overflow `spawnDrop`; toasts "Quest accepted" / "Quest complete". HUD line follows `tracked()`.
- [ ] validate-content `q.<id>.<op>` cross-file check + fixture. `bearDialogue.test.js` cases (38.35 item 11).
- [ ] Coordinate with WAYSTONE-NORMAL-01: do not change `relay.poll` facts or the waystone step.
- [ ] One headless capture of the offer box; then owner walk: sword -> `!` on Burl -> Accept -> 5 boars -> `?` -> hand in -> coins + "Quest complete".

### QG-04 Giver markers: `!` / `?` over the NPC + map  [P1] [po-review] [PC-B kestrel-1]
- [ ] `questMarks` optional `host.source(out)` (default unchanged; existing test still passes) + test.
- [ ] Two instances in main.js fed by `book.giverMarks`: `questMark` while available, `questMarkReady` while ready, none while active/done.
- [ ] `mapCard` kinds `quest` / `questReady`; markers rebuilt on card open when `book.version` changed. Keep D-057 waystone kinds intact. mapCard test per kind.

### QG-05 Quest log screen (J)  [P1] [po-review] [PC-B kestrel-1]
- [ ] Binding `questLog` = `KeyJ` (rebindable, no conflict test break); opens/closes like the inventory and locks input.
- [ ] `questLog.js` over the book: Active (ready tagged with the return line) / Done, main quest listed; detail steps `[x]/[>]/[ ]` + `n/target`.
- [ ] Rows rebuilt only on `book.version` change; `drawLog` 0-alloc test; preview page updated; no "Esc to close" text (D-053).

### QG-W1 Burl's quest texts  [P1] [todo] [writer] NEEDS WRITER
- [ ] Quest title; offer lines (<= 56 chars each, 2-3 lines); choices Accept / Later (<= 40); accepted reply; later reply; reminder line; ready line; thanks line; step text `beasts` (HUD <= 38); `returnText` (<= 38); new m1 `beasts` HUD line ("go see Burl", <= 38); toasts "Quest accepted" / "Quest complete"; log headers Active / Done. ASCII only; Burl voice per the existing bear lines.

### QG-D1 `?` marker + coin  [P2] [design] [designer]
- designer 2026-10-10: `questMarkReady` done in `design/models/quest_mark.js` (twin of `questMark`, same record/clips/fx; `questMarkTurnIn` = alias), preview `design/preview/quest-mark.html` ('!' left, '?' right). Coin skipped (owner pick: no reward item).
- [ ] `questMarkReady` voxel model: `?` twin of `questMark` (same clips appear/active/complete, same size). `coin` item def glyph + icon in `design/items.js` (stackMax 999). Preview in the existing marker/item preview pages.

## World stage 1 (D-060)

PC-B architect opus, 2026-10-10 (owner-authorised while PC-A is offline; PC-A to ratify). Spec: architecture.md 38.36. Order: WS1-01, WS1-02 (kestrel-3) and WS1-05, WS1-W1 in parallel -> WS1-03 (kestrel-2) -> WS1-04 -> WS1-06a/b, WS1-07a/b (kestrel-1) -> WS1-08 gates -> owner walk. WS1-09 optional. Engine rows (01, 02, 03) end in `arch-review` (NEEDS PC-A).

| ID | Slot | Size | Files | Deps | Status |
|---|---|---|---|---|---|
| WS1-01 | kestrel-3 | 0.75 d | `engine/physics/bounds.js` (new) + test, `engine/physics/integrate.js` 4b, `engine/world/triggers.js`, `engine/world/World.js` (validateBounds), `engine/world/serialize.js`, `engine/world/world.test.js` | - | ARCH OK -> po-review [PC-B] |
| WS1-02 | kestrel-3 | 1 d | `engine/world/World.js` (band rect, nearBandKey), `engine/world/Terrain.js` (`bakeNearBand(cx0,cy0,cw,ch)`), JS `near.w/h` consumers (scatter, terrainShade, detailShade), `engine/world/terrainBand.test.js` (new) | - | ARCH CHANGES (build loop uses near.w for rows: tall bands get zero normals; see arch batch 2026-10-10) [PC-B] |
| WS1-03 | kestrel-2 | 0.5 d | `engine/render/gpu/wgsl/terrainRaster.wgsl.js`, `engine/render/gpu/wg/passRaster.js`, `TerrainTextures.js`, `ShadeTextures.js`, `passShade.js` (audit) | WS1-02 | ARCH OK -> po-review (gpucompare gate: main session) [PC-B] |
| WS1-04 | kestrel-4 | 0.5 d | `content/worlds/world_m1.world.json` (bounds union, terrainBand, `relayBend` + base mesh, `waystone` components), `design/levels/overworld_far.js` (relay exclude disc) | WS1-01, WS1-02 | po-review [PC-B] |
| WS1-05 | kestrel-4 | 0.75 d | `tools/gen-roadside-meshes.mjs` (flags + `scale` fix), `content/worlds/world_m1.world.json` (`roadW###`, `roadN###`), `design/levels/overworld_far.js` (printed capsules) | - (runs before WS1-04 lands: keep-out disc is in the tool) | po-review [PC-B] |
| WS1-06a | kestrel-1 | 0.5 d | `game/js/quest/sim/waystone.js` + test, `game/js/quest/wire/waystone.js` + test, `game/js/waystoneTouch.js` | WS1-04 (data; tests use fixtures) | po-review [PC-B] |
| WS1-06b | kestrel-1 | 0.75 d | `game/js/quest/relayWake.js` (new) + test, `game/js/quest/index.js` (behaviour `relay.wake`), `game/js/main.js` (step + interactable on world:loaded) | WS1-06a, WS1-W1 (placeholder text ok) | ARCH OK; PO OK (PC-B batch, PC-A to ratify) -> testing; follow-up: relay touch still shows the stone "remember" toast (per-kind text, WS1-W1) [PC-B] |
| WS1-07a | kestrel-1 | 0.5 d | `game/js/quest/mapCard.js` (`setMarker`, digits, travel line, digit keys) + `mapCard.test.js`, preview | WS1-06a | po-review [PC-B] |
| WS1-07b | kestrel-1 | 0.75 d | `game/js/quest/travel.js` (new) + test, `game/js/quest/sim/vitals.js` (`clearSafe`), `game/js/main.js` (wiring, fade draw, hzb invalidate) | WS1-07a | po-review [PC-B] |
| WS1-08 | kestrel-4 | 0.5 d | `tools/route-walk.mjs` (leg 8 + bound probe), bench/perf pose `roadBend`, gpucompare row | WS1-03, WS1-04, WS1-05 | ARCH OK; tooling done + gates PASS (route walk leg 8 1.8 m from relay, bound 1200.3, gpucompare roadBend NEW PASS 2026-10-10); PO OK (leg 8 + bound probe + gpucompare ACs); open: perf AC (roadBend + tower JS/GPU p95 <= 8 ms, heap flat, load delta) on a quiet machine [PC-B] |
| WS1-W1 | writer | 0.25 d | `docs/story.md` | - | todo NEEDS WRITER |

### WS1-01 Walk bound: union of circle/capsule parts  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-3] (engine)
- [ ] `engine/physics/bounds.js`: `projectBounds(bounds, x, y, radius, out)` + `boundsOvershoot(bounds, x, y, radius)` for `circle` and `union` of `circle`/`capsule` parts (1..8), per 38.36 item 1; imports nothing outside `engine/physics/`.
- [ ] integrate 4b and triggers `'bounds'` call the helper; `boundsHit` semantics unchanged; `shape:'circle'` worlds behave bit-identically (test compares old vs new projection on 1k random points).
- [ ] `validateBounds` accepts `union` (throws with the part index on bad data), returns a deep copy; `serialize.js` deep-copies parts.
- [ ] Tests: inside each part, circle/capsule seam, outside corner lands inside the union, velocity clip on the part normal, 0 alloc over 10k steps. `node tools/run-tests.mjs` + check-deps green. -> `arch-review`.

### WS1-02 Data-driven near band rect  [P1] [todo] [PC-B kestrel-3] (engine)
- [ ] Optional world field `terrainBand {cx0, cy0, cw, ch}` (ints, cw/ch 1..6), validated; absent = today's auto-centred 3x3 (same key, same bake, existing tests unchanged).
- [ ] `Terrain.bakeNearBand(cx0, cy0, cw, ch)`; `near.w = cw*64`, `near.h = ch*64`; `nearBandKey` includes the rect.
- [ ] Audit every JS read of `near.w`/`near.h` for a square assumption (list the files in the story); fix them.
- [ ] `terrainBand.test.js`: 5x3 bake == stitched `bakeChunk` grids; `groundAt` continuous across x 1280; scatterTrees/detail counts printed for world_m1 with `{8,7,5,3}` (trees <= maxTrees, detail <= maxPlacements); bake time printed (<= 160 ms target). -> `arch-review`.

### WS1-03 GPU: non-square near band  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-2] (engine render)
- [x] `terrainRaster.wgsl.js terrainTypeAt` uses separate width/height (`textureDimensions(uNearType)` or an extra uniform word); `passRaster`/`TerrainTextures`/`ShadeTextures`/`passShade` audited for `w == h`.
- [ ] gpucompare (`gpucompare` skill): every existing row within tolerance with world_m1 on `terrainBand {8,7,5,3}`, plus one dev fixture with a 3x5 (tall) band. -> `arch-review`.

### WS1-04 world_m1: stage-1 bounds, band, relay  [P1] [po-review] [PC-B kestrel-4]
- [ ] `bounds` = union: circle (1496.5, 1024.5) r 96 + capsule (1440,1034)-(1350,1048) r 40 + capsule (1350,1048)-(1240,1047) r 40. `terrainBand {cx0: 8, cy0: 7, cw: 5, ch: 3}`. `nav` unchanged; no beasts west of x 1400.
- [ ] Entity `relayBend` at (1262, 1033), z ground on an existing flat-topped Quaternius rock/stone mesh base (mesh structure, z = base top): voxel `relay` anim `dead`, collider, `light {preset:'relay', on:false}` 1.1 m up, `waystone {id:'ws_roadBend', label, kind:'relay', order:2}`. `endMarker` gets `waystone {id:'waystone', kind:'stone', order:1}` (id unchanged).
- [ ] Check that World.load and serialize keep the unknown component `waystone` on the entity; if not, stop and ASK ARCHITECT (no engine change in this row).
- [ ] `overworld_far.js detail.exclude`: disc (1262, 1033) r 8. Content-canonical + content-smoke tests green; one headless capture at (1268, 1040, yaw 270) shows the relay on its base, no float/sink.

### WS1-05 Dress the road west (existing meshes)  [P1] [po-review] [PC-B kestrel-4]
- [ ] `gen-roadside-meshes.mjs`: flags `--prefix --side left|right --u0 --u1 --v0 --v1 --count`; only the given prefix is replaced; `roadL###` untouched (diff shows no roadL change).
- [ ] Fix: `fmt()` writes `scale` (PLANT_SCALE); test or dry-run check that every plant row carries it.
- [ ] Runs: `roadW` left u 250..300 count ~60; `roadN` right u 110..300 v 8..26 count ~140, tree quota 0.25; keep-out disc relay (1262, 1033) r 8 and the WS1-08 route line (2 m). Printed capsules added to `overworld_far.js detail.exclude`, no warning.
- [ ] Report counts by class + mesh; mesh-place budget tool (`tools/mesh-place-budget.mjs`) green.

### WS1-06a Waystone list + save shape  [P1] [po-review] [PC-B kestrel-1]
- [ ] Sim: points from entities with `components.waystone` (ordered by `order`); `touch(id, pose)` = heal + one requestSave + anchor stored in `world.state['waystone.points'][id]`; `list(out)`, `anchor(id)`; `waystone {waystoneId, pos}` kept as the respawn record.
- [ ] Old save (`waystoneId:'waystone'`, no points map) seeds the map with that entry; `SAVE_VERSION` stays 1; a fresh game has an empty map.
- [ ] `waystoneTouch.js` list-driven for `kind:'stone'` points (meadow behaviour unchanged: same radius, re-arm, event `{id:'waystone'}`).
- [ ] Tests: order, touch, double touch, old-save seed, save round-trip, 0 alloc per step.
Note (kestrel-2, 2026-10-10): done; sim API `points` (entity data), `touch(id,pose)`, `list(out)`, `anchor`, `isTouched`, `has`, `register`, `canWake(id)` (opts.canWake gate, D-062 hook; default open). Wire builds points from `components.waystone` at boot; accepts kind waystone|relay. NEEDS B1-main: none for 06a; 06b/07 use `wire.sim`.

### WS1-06b Wake the road-bend relay  [P1] [po-review] [PC-B kestrel-1]
- [ ] Interactable `relay.<id>` (E, radius 2.2, WRITER prompt) for every `kind:'relay'` point, added on each `world:loaded`; behaviour `relay.wake` in `quest/index.js`.
- [ ] `relayWake.js`: dead -> `wake` clip + `playRelayHum` -> light on at `wakeLightFrame` (grow ramp if LightSet allows, else on) -> `awake` loop; sets `waystone.<id>.woken`, calls the sim touch, emits `prop:touched {id, kind:'relay'}`, toast (WRITER). E on an awake relay = touch only.
- [ ] Reload/restart: woken relays come back `awake` + light on, no hum; dead ones `dead`. Tower beacon keys untouched (tower.test.js green).
- [ ] Tests: wake once, timer/clip/light order, reload awake, 0 alloc per step. One headless capture of dead + awake.

### WS1-07a Map card: travel markers + pick  [P1] [po-review] [PC-B kestrel-1]
- [x] `createChartCard` `setMarker(x, y, kind|digit)` (one-cell update); untouched relay = `o`, touched points show their digit while the card is open; travel line at the bottom (WRITER labels).
- [x] Digit key on the open card with a touched target -> `onTravel(id)` callback; other keys keep today's close rule; quest kinds (QG-04) intact.
- [x] mapCard tests: digits per touched set, setMarker, digit vs close key, no alloc in draw. Preview updated.

### WS1-07b Travel: fade, teleport, reset  [P1] [po-review] [PC-B kestrel-1]
- [ ] `travel.js` state machine per 38.36 item 4 (0.35 s out / in, input locked, gates: alive, no dialogue/inventory/log, wake done, > 6 m from target).
- [ ] At black: anchor pose, zero velocity, re-ground, `hzb.invalidate('travel')`, `beasts.resetAll`, `targeting.clear`, `syncFacing`, `vitals.clearSafe()`, target becomes the respawn point (touch = heal + save).
- [ ] Tests: timings, gates, pose inside `bounds`, invalidate/reset calls, 0 alloc. Main session: one browser pass meadow -> relay -> meadow, fauna re-spawns, no frame of the old view after the fade.

### WS1-08 Gates: route walk, perf, gpucompare  [P1] [partly done: perf open] [PC-B kestrel-4]
- [ ] `route-walk.mjs` leg 8 waystone -> relay ((1420,1032) -> (1350,1050) -> (1270,1042)), grid + mesh, completes, no fall, ends <= 3 m from the relay; bound probe west of x 1200 stops at the bound.
- [ ] Perf pose `roadBend` (1268, 1040, yaw 270) + tower pose: JS <= 8 ms, GPU p95 <= 8 ms ultra, heap flat; load-time delta vs before WS1-02 printed. If GPU fails: report, fallback `cw: 4` (38.36 item 1).
- [ ] gpucompare row at `roadBend`; existing rows within tolerance.

### WS1-09 Optional m1 objective "Wake the relay at the road bend"  [P2] [todo] [PC-B kestrel-4]
- [ ] Only if trivial (38.36 item 5): m1 objective 7 `relay1`, flag `waystone.ws_roadBend.woken`; old save with 6/6 shows step 7, no replayed "quest complete"; the waystone-step save still fires once. Else close as won't-do.

### WS1-W1 Stage-1 texts  [P1] [todo] [writer] NEEDS WRITER
- [ ] Relay prompt (`[E] ...`, <= 24); wake toast (2 lines, <= 40 each, the relay hums awake + saved/remembered); travel labels "Meadow stone" / "Road-bend relay" (<= 18); map travel line header (<= 30); optional m1 step `relay1` HUD text (<= 38). ASCII only, canon voice (game-design 3).

## Chapter 1 build (D-062)

PC-B architect opus, 2026-10-10 (owner-authorised while PC-A is offline; PC-A to ratify). Spec: architecture.md 38.37. Script: docs/chapters/chapter-1-beyond-the-wall.md. Depends on: QG-01..05 (built), WS1-04/06a/06b (relay waystones), CHARGEN D-059 base (for Fen). Supersedes WS1-09 (close as won't-do) and the WS1-W1 relay wake toast (the notice replaces it). **OWNER QUESTIONS before CH1-D1b:** target tower height (recommendation: walls 12-14 m plus crown, today 6.5-8.5 m) and which side the door faces (recommendation: south-west, toward Burl and the road).
Order: writer rows + CH1-D1a + CH1-E1/E2 + CH1-01 in parallel -> CH1-02, CH1-03, CH1-04a -> CH1-04b, CH1-05, CH1-06 -> CH1-07 -> CH1-08a/b -> CH1-09 -> CH1-D1b (after the owner answer) -> CH1-10 gates -> owner walk. Engine rows (E1, E2) end in `arch-review` (NEEDS PC-A).

| ID | Slot | Size | Files | Deps | Status |
|---|---|---|---|---|---|
| CH1-01 | kestrel-4 | 0.75 d | `content/quests/m1.quest.json` (11 steps + sections), `content/quests/burl.boars.quest.json` (title), `content/quests/areas.json`, `content/worlds/world_m1.world.json` (area triggers `towerDoor`/`roadWest`/`bendRelay`), `game/js/quest/sim/questBook.js` (`validateSections`, `migrateM1Ch1`) + tests | - | ARCH OK; PO OK -> testing (towerDoor placeholder until CH1-D1a) [PC-B] |
| CH1-02 | kestrel-1 | 0.75 d | `game/js/questRelay.js` (`questFlag`, lantern feed out), `game/js/saveRelay.js` (run the migration), `game/js/main.js` (section toasts, marker bindings), `game/js/quest/hints.js` | CH1-01 | ARCH OK; PO OK -> testing (markers/compass for towerDoor/roadWest not browser-checked: owner/tester) [PC-B] |
| CH1-03 | kestrel-1 | 0.5 d | `game/js/quest/crystal.js` (new) + test, main.js (hook on `quest:ready` + `world:loaded`) | CH1-02, CH1-D2 (item def; a placeholder is fine) | ARCH OK; PO OK (module) - open: main.js mount (check on quest:ready + world:loaded, noteBoar on beast:died, teal burst, toast text, addItem) [PC-B] |
| CH1-04a | kestrel-1 | 0.5 d | `game/js/ui/noticeView.js` (new) + test, main.js mount, game text table | - | ARCH OK; PO OK (module) - open: main.js mount (hidden in menus/dialogue), relayWake showWakeNotice -> push('relay'), headless capture (verify-notice) [PC-B] |
| CH1-04b | kestrel-1 | 0.75 d | `game/js/quest/relayWake.js` (`kind:'stone'`), `game/js/waystoneTouch.js` (dormant), `game/js/quest/index.js` (`stone.wake`), world data `endMarker` (`dormant`, `notice`) | WS1-06b, CH1-03, CH1-04a, CH1-D2 | todo [PC-B] |
| CH1-05 | kestrel-4 | 0.5 d | `content/dialogue/bear.dialogue.json` (full graph 38.37 item 6), `content/dialogue/bear.barks.json` (new), `tools/validate-content.mjs` (`s.` keys, `barks` kind), `game/js/quest/bearDialogue.test.js` | CH1-W2 (placeholder text ok), CH1-06 | ARCH OK; PO OK (content) -> testing after the CH1-06 mount (s. keys need questFlag in the ctl); known gap -> CH1-07 AC: a "following" entry (no follow-offer replay) [PC-B] |
| CH1-06 | kestrel-1 | 0.5 d | `game/js/quest/dialogueCtl.js` (`s.` route) + test, `game/js/quest/barks.js` (new) + test, main.js mount | CH1-02 | ARCH OK; PO OK (module) - open: main.js mount (questFlag into createDialogueCtl + createBarks, load bear.barks.json, step early, draw after dialogue) [PC-B] |
| CH1-E1 | kestrel-3 | 0.5 d | `engine/nav/pathFollow.js` (new) + test, `engine/index.js` export | - | ARCH OK -> po-review [PC-B] (engine) |
| CH1-E2 | kestrel-3 | 0.75 d | `engine/world/World.js` (`kinematic` entity colliders, `setEntityCollider`), `engine/world/colliders.js` if needed, `engine/world/world.test.js` | - | ARCH OK -> po-review [PC-B] (engine) |
| CH1-07 | kestrel-1 | 1 d | `game/js/quest/npcWalk.js` (new) + test, `game/js/quest/npcBear.js` (pause turning while walking), main.js (Burl phases, auto-open stone talk, depart + hide, load rules), world data `bear` (`walks.follow`/`depart`, `collider.kinematic`) | CH1-E1, CH1-E2, CH1-05, CH1-06 | todo [PC-B] |
| CH1-08a | kestrel-4 | 0.5 d | `content/worlds/world_m1.world.json` (`fen` entity, `walks.emerge`), `content/dialogue/fen.dialogue.json` (new), `content/packages/index.json` + `villager.fen-*.kestrel`, `game/js/quest/fenDialogue.test.js` | CH1-D3, CH1-W4, WS1-04 | todo [PC-B] |
| CH1-08b | kestrel-1 | 0.5 d | main.js (Fen hidden until the relay wakes, emerge walk, auto-open, `fen.met`), uses `npcWalk.js` | CH1-07, CH1-08a, WS1-06b | todo [PC-B] |
| CH1-09 | kestrel-1 | 0.75 d | `game/js/quest/chapterCard.js` (new) + test, `game/js/ui/questLog.js` (Done row opens the journal), main.js, `design/models/notes.js` (`journalCh1` from CH1-W5) | CH1-02, CH1-W5 | ARCH OK; PO OK (module) - open: main.js mount (trigger on last m1 section, isLocked -> uiLocked, pushDim, draw, questLog onJournal -> journalCh1), headless capture [PC-B] |
| CH1-10 | kestrel-4 | 1 d | `tools/route-walk.mjs` (new tower legs + probes, Burl/Fen path clearance), `game/js/quest/ch1Walkthrough.test.js` (new), perf poses (tower exterior), gpucompare tower re-baseline | CH1-D1a/b, CH1-07, CH1-08b | todo [PC-B] |
| CH1-D1a | designer | 1 d | `content/levels/tower.level.json` (sword + note 1 to the top, `noteLeave`, parapet over the breach, way down, south-west door + steps, `doorBar` + `door.unbar`, `lantern.take` removed), `design/models/notes.js` (note texts), tower preview/capture | CH1-W1 (placeholder text ok) | todo [PC-B] |
| CH1-D1b | designer | 1 d | `content/levels/tower.level.json` (wall heights, rounded outer ring), `design/models/voxel_tower_crown.js` (new `towerCrown` + snagged envelope), world entity, `design/levels/overworld_far.js` if the footprint changes | OWNER QUESTION (height), CH1-D1a | todo [PC-B] owner look |
| CH1-D2 | designer | 0.5 d | `design/models/voxel_world.js` (waystone `dead`/`wake`/`awake` clips, brass crystal bowl, light preset), `design/items.js` (`aetherCrystal` glyph + icon), previews | - | PO OK (design, claims) - open: owner look (design/preview/voxel-props.html, item-icons.html); confirm suites voxel_world/items/validate-content green [PC-B] |
| CH1-D3 | designer | 0.5 d | chargen recipe Fen (male wanderer, patched clothes, worn boots, travelling staff; D-059 style) -> `villager.fen` package | CHARGEN D-059 base, owner look | PO OK (recipe, 000cb1c8; D-063 style supersedes D-059) - open: owner look (chargen_kit.html outfit Fen), `villager.fen` package moves to CH1-08a [PC-B] |
| CHARGEN-26b | designer | 0.5 d | `design/chargen/human_kit.js` detail pass (face, ears, hair, beard, hands, knight trim), kit rebuilt 1650 quads, export goldens | CHARGEN-26 | PO OK (design) - owner look (crown hair layer dropped to stay <= 1.78 m); civilian seams need engine per-shell paint (owner to decide) [PC-B] |
| CH1-W1 | writer | 0.25 d | `docs/story.md`: tower texts | - | todo NEEDS WRITER |
| CH1-W2 | writer | 0.5 d | `docs/story.md`: Burl lines + barks | - | todo NEEDS WRITER |
| CH1-W3 | writer | 0.25 d | `docs/story.md`: wake, crystal, notices | - | todo NEEDS WRITER |
| CH1-W4 | writer | 0.5 d | `docs/story.md`: Fen graph | - | todo NEEDS WRITER |
| CH1-W5 | writer | 0.25 d | `docs/story.md`: chapter card + journal | - | todo NEEDS WRITER |

### CH1-01 m1 chain data + migration  [P1] [po-review] [PC-B kestrel-4]
- [ ] `m1.quest.json` = the 11 steps of 38.37 item 1 (ids, order, `when`, `section`), `sections` with the 7 script titles; `lantern` removed. `burl.boars` title "Boars in the Woods".
- [ ] `areas.json` + world area-only triggers `towerDoor`, `roadWest`, `bendRelay` (`towerDoor` coordinates from CH1-D1a; until then a placeholder at the old breach outcrop, marked TODO).
- [ ] `validateSections` (every `section` names a declared section; the sections are contiguous runs).
- [ ] `migrateM1Ch1` per item 8 with fixtures: `[wake, lantern]` -> `[wake]`; `[wake, lantern, breach, sword]` -> `[wake, breach, sword]`; `+beasts` -> `[.., leave, beasts]`; 6/6 -> `[.., follow, waystone]` + flags `waystone.waystone.woken`, `burl.phase 4`, `aether.attuned`; already-new saves untouched; round trip. `node tools/run-tests.mjs` green.

### CH1-02 Wire the chain: quest flags, section toasts, markers, lamp out  [P1] [po-review] [PC-B kestrel-1]
- [ ] `questFlag(key, value)` in questRelay (sets world.state + feeds the book); the lantern feed is removed; saveRelay runs `migrateM1Ch1` before the book is built.
- [ ] "Quest complete: <section title>" toast when a section's last step completes live; no toast on restore (test).
- [ ] main.js marker bindings per 38.37 item 1 (compass points at each step's target).
- [ ] `hintBurner` `skipIfState` / `hintExit` texts from CH1-W1; `tower.test.js` updated for no lantern prompt; the beacon stays dormant.

### CH1-03 Aether crystal  [P1] [todo] [PC-B kestrel-1]
- [ ] `crystal.js`: when `burl.boars` turns ready, if not yet attuned: `addItem('aetherCrystal')`, `questFlag('aether.attuned')`, particle burst at the last boar, toast (CH1-W3). The same check runs on every `world:loaded` (self-heal).
- [ ] Tests: granted once, full pack still attuned, self-heal on an old save past the boars, 0 alloc per step.

### CH1-04a Notice view  [P1] [todo] [PC-B kestrel-1]
- [ ] `noticeView.js` per 38.37 item 4 (title + up to 3 lines, 0.3/3.5/0.5 s, queue of 2, non-blocking, hidden in menus/dialogue); mounted in main.js.
- [ ] Tests: queue order, timings, 0-alloc draw, hide rules. One headless capture.

### CH1-04b Dormant meadow stone, woken with the crystal  [P1] [po-review] [PC-B kestrel-1]
- [ ] `endMarker` `waystone {dormant: true, notice}`; `waystoneTouch` skips it until `waystone.waystone.woken`.
- [ ] `relayWake.js` handles `kind:'stone'`: interactable `requires: 'dlg.bear.stone.told'`; relays `requires: 'aether.attuned'`. Wake -> touch -> `questFlag` -> notice.
- [ ] Reload: the woken stone stays `awake`, light on, no hum; old saves with the waystone touched restore it awake (via the migration flag).
- [ ] Tests: no touch while dormant, wake once, reload, relay prompt hidden without attunement.

### CH1-05 Burl dialogue graph + barks data  [P1] [todo] [PC-B kestrel-4]
- [ ] `bear.dialogue.json` entries and nodes per 38.37 item 6 (script lines; the lamp line becomes the crystal per CH1-W2); hand-in flows into the follow lines.
- [ ] `bear.barks.json`: `bear.call`, `walk1` (birds), `walk2` (road/stones); validate-content checks the `barks` kind and `s.` keys.
- [ ] `bearDialogue.test.js`: entry per state (fresh, talked, available, active, ready, done/not following, arrived, woken, departing); every node reachable; every line <= 56 chars; Esc rules kept.

### CH1-06 Dialogue `s.` route + barks view  [P1] [todo] [PC-B kestrel-1]
- [ ] dialogueCtl: `s.<key>` has = `!!world.state[key]`, set = `questFlag(key)`; same once-at-open Map as `q.`.
- [ ] `barks.js`: loads a `barks` file, `play(barkId, speakerEntity)` once per id (flag `bark.<id>`), non-modal, typed, 1.6 s per line, cancelled when a dialogue opens; draws in the dialogue box style.
- [ ] Tests: adapter table, bark once, cancel on dialogue, 0-alloc draw.

### CH1-E1 Path follower (engine)  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-3]
- [x] `engine/nav/pathFollow.js` per 38.37 item 5 (API, look-ahead corners, yaw, `reset(seg)`), exported from `engine/index.js`.
- [x] Tests: arrival, seg count, resume, speedScale 0, 10k-step heap flat, determinism (two runs equal). check-deps green. -> `arch-review`.

### CH1-E2 Kinematic entity colliders (engine)  [P1] [ARCH OK (batch 2026-10-13)] [PC-B kestrel-3]
- [x] `components.collider.kinematic: true` -> the `npcs:kinematic` collider (<= 8 prisms); `World.setEntityCollider(id, x, y, z)` updates in place + refits bounds, 0 alloc.
- [x] Without the flag, `props:static` is byte-identical (existing tests unchanged). Serialize keeps the flag.
- [x] Tests: capsule blocked at the new spot, free at the old one, 0 alloc over 10k moves. If an in-place update is impossible, ASK ARCHITECT. -> `arch-review`.

### CH1-07 Burl escort + departure  [P1] [po-review] [PC-B kestrel-1]
- [ ] `npcWalk.js` per 38.37 item 5 (lead mode: wait > 10 m, resume < 6 m; barks at waypoints; `hideAtEnd`; walk/idle clips; ground z; collider follows).
- [ ] Burl phases 0-4 in world.state (`burl.phase`, `burl.wp`); `questFlag('burl.arrived')` at the stone; stone talk auto-opens within 4 m; the after-wake node starts the departure; hidden at the end of `depart`.
- [ ] Load rules per phase (mid-walk resumes from `burl.wp`; departing/gone = hidden). `bear.call` bark on first approach after `leave`.
- [ ] Tests: phases, wait/resume, barks once, load per phase, 0 alloc. One browser pass by the main session.

### CH1-08a Fen data: entity, dialogue, package  [P1] [todo] [PC-B kestrel-4]
- [ ] `fen` entity at Bend Relay (`char.fen`, `collider {kinematic:true}`, `dialogue:'fen'`, `walks.emerge` from behind the fallen wall), `voxel.hidden: true`.
- [ ] `fen.dialogue.json` per 38.37 item 6 (3 choice points that rejoin, end node sets `s.fen.met`, repeat entry); package in `content/packages/index.json` (38.33).
- [ ] `fenDialogue.test.js`: every node reachable, lines <= 56, end flag; packBoot test with the Fen package green.

### CH1-08b Fen at the relay  [P1] [po-review] [PC-B kestrel-1]
- [ ] Hidden until `waystone.ws_roadBend.woken`; after the notice, walks `emerge` and the dialogue auto-opens within 4 m (E works too); `fen.met` completes m1.
- [ ] Load: relay woken -> Fen visible at the end of `emerge`, the repeat entry if met. Tests.

### CH1-09 Chapter card + journal  [P1] [todo] [PC-B kestrel-1]
- [ ] `chapterCard.js` per 38.37 item 7 (dim 50 %, typed title + next chapter line, journal page in the note panel, E/Esc back to play, input locked).
- [ ] Flags `chapter.ch1.done`, `chapter.next = 'ch2'`; shows once, never on load. The J log Done row "Beyond the Wall" re-opens the journal.
- [ ] Tests: once, flags, journal hand-off, 0-alloc draw. One headless capture.

### CH1-10 Gates: route walk, walkthrough, perf, gpucompare  [P1] [todo] [PC-B kestrel-4]
- [ ] route-walk: tower legs wake -> top -> down -> door -> outside; probes: no exit over the parapet, door closed before the sword; Burl `follow`/`depart` + Fen `emerge` clearance (0.8 m from trunk/rock colliders, slope < 0.6, `follow` inside nav).
- [ ] `ch1Walkthrough.test.js` (38.37 item 9): the full chain completes, the section toasts fire once in order.
- [ ] Perf: tower interior, tower exterior (crown in view), `roadBend`: JS <= 8 ms, GPU p95 <= 8 ms ultra, heap flat. gpucompare tower rows re-baselined once after the owner looks at CH1-D1b; new tower-exterior row.

### CH1-D1a Tower route: sword at the top, door at the bottom  [P1] [todo] [designer]
- [ ] Sword prop + interactable + `noteSteelHush` (note 1) on the summit near the breach; `noteLeave` (note 2, `requires: 'tower.sword.taken'`) at the head of the way down.
- [ ] The breach becomes an overlook: the outcrop steps become rubble/a parapet (<= 1.2 m) over a drop the player cannot use; the way down needs no jump up (ramp/ledge if needed).
- [ ] South-west ground-floor door 1.2 m wide + steps <= 0.3 m from 0 to 2.4 m (level cells; grow `size.h` if needed); `doorBar` prop (`colliderOffVariant: 'open'`) + interactable `door.unbar` (`requires: 'tower.sword.taken'`).
- [ ] `lantern.take` interactable removed (props stay); interior exposure checked without the carried lamp (capture), fixed with level lights if needed. Provide the `towerDoor` + `doorMarker` coordinates for CH1-01.

### CH1-D1b Taller tower shell + crown  [P1] [todo] [designer] OWNER QUESTION (height) + owner look
- [ ] Wall cell `floorH` raised to the owner's target (rec. 12-14 m, jagged tops, west side lowest), outer ring chamfered to read round; captures of the wake pose + sun shaft before/after (keep the east wall height if the shaft is lost).
- [ ] `towerCrown` voxel model (round broken crown + the Kestrel's torn envelope snagged on it, ropes hanging), <= 8k surface voxels, placed at the tower origin; preview page; exterior capture from the meadow.

### CH1-D2 Waystone states + crystal item  [P1] [po-review] [designer]
- [ ] Waystone `dead`/`wake`/`awake` clips (aether mark dark -> teal), small brass crystal bowl on top, light preset; `idle` kept as an alias of `awake`.
- [ ] `aetherCrystal` item def (glyph, icon, name/desc from CH1-W3). Previews updated.

### CH1-D3 Fen recipe  [P1] [todo] [designer] owner look
- [ ] Chargen recipe in the D-059 in-between style: man, patched clothes, worn boots, an old travelling staff (as a held accessory if the chargen supports one, else a staff prop leaning beside him); saved as the `villager.fen` package (38.29 item 5). Owner looks before CH1-08a ships.

### CH1-W1 Tower texts  [P1] [todo] [writer] NEEDS WRITER
- [ ] Note 1 + note 2 (script texts, fitted to the note panel); review the 4 existing tower notes and `ASSETS.uiStyle.storyHints` for lamp/lantern mentions (rewrite or drop); `hintExit` (no "ends the chapter") and `hintBurner`; `[E]` prompts for the door bar (<= 24); m1 HUD step texts for all 11 steps (<= 38); the 7 section titles; Wick's "Better than empty hands." / "Nothing, they said." barks.

### CH1-W2 Burl lines  [P1] [todo] [writer] NEEDS WRITER
- [ ] Every script line for Quests 03-05 fitted to <= 56 chars (keep the meaning); choices <= 40; **rewrite "Try bringing your lamp closer."** to the crystal; one new Burl line reacting to the crystal the boars gave (aether hint, no lore beyond canon); walking barks (birds, road); farewell repeat line; `bear.call`.

### CH1-W3 Wake, crystal, notices  [P1] [todo] [writer] NEEDS WRITER
- [ ] Crystal item name + description + gain toast (<= 38); the script's prose "Wick raises the Kestrel's lamp" / "Wick holds his lamp" becomes crystal staging (stage note only); stone/relay prompts (<= 24); WAYSTONE AWAKENED and BEND RELAY AWAKENED notices (title <= 30, <= 3 lines of <= 38); Wick's relay lines "Another one." / "Let's see if Burl was right."

### CH1-W4 Fen graph  [P1] [todo] [writer] NEEDS WRITER
- [ ] The Quest 07 script split into speaker nodes, lines <= 56; 3 choice points that rejoin the main line; a 2-3 line repeat entry pointing at the river road; check "Then how did you wake that stone?" still reads right with the crystal.

### CH1-W5 Chapter card + journal  [P1] [todo] [writer] NEEDS WRITER
- [ ] "CHAPTER COMPLETE" card lines (chapter name, "Next chapter: The River and the Forgotten"); the final journal entry fitted to the note panel width; quest log Done label.
