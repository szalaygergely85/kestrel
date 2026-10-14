# Kestrel – Product Backlog

> **PC-B handoff 2026-10-14 NIGHT (desktop RTX 4060) - START HERE (supersedes the blocks below).** Owner play-tested all day: OB-119..154 logged in docs/bugs.md (+ OB-064 reopened). Decisions D-079 (ground look A), D-080 (relays -> Waystones), D-081 (RPG item stats), D-082 (quests given/returned by characters), D-083 (bestiary 30+ types, respawn, roaming, AI, Easy/Normal/Hard).
> **Merged into pc-b tonight (see gate result below):** OB-064 gear into the pack; OB-119 GPU dispose deferred (c77fffe9 re-applied) + decor opt-in hotfix (`?decor=gpu`); OB-120 hp potions while magic locked; OB-121a grass radius 20 m; OB-121b + OB-154 underlay code (static, no wind term) but `carpet.underlay: 0` in content until the owner looks (set 0.6 to enable); OB-122 Nub removed; OB-123 whole-stone pick; OB-124/124b/125/126/133 quest markers (gold main, blue side), offer-not-accept, giver lines; OB-127 lamps; OB-128 no shield auto-equip; OB-129/130 chimney + shelf mushrooms removed; OB-131/143 floating trees/props; OB-132 voxel items (0 sprites in world_m1); OB-134 Health/Mana Potion; OB-137 names (prompt, journal, givers); OB-138 Rook-ruin stairs; OB-140 Unstuck; OB-144 far tree sway fade; OB-145 blocked waystone hints; OB-147 Rook perch + OB-152 roof chests down; OB-148 braziers under smoke; D-080 Waystones; BEAST-01 anim follows speed + stuck re-plan; BEAST-02 wolves use the wolf model; BEAST-03a archetype/kind data; GATE-FLAKY-02..05; ENV-01a-d + wire (decor opt-in), ENV-02a/b/c (look bake, not wired); CONTENT-LINT-01 (`node tools/content-lint.mjs`); decorFord cull-batch leak fix (kestrel-2 f38ebb01 NOT merged yet - re-run gpucompare decorFord first).
> **Known env issue:** this machine shows gpucompare colour drift on breach/breachDown/parapetSky/signal tower/outsideFar + underwaterLake x2 even at 3ffa5aaa (not code) -> refresh the rtx4060 baseline per D-039 after an idle-machine run; route walk boot/content-pack fetch errors happen only under heavy load (many agents + browsers) - gate on an idle machine.
> **Owner answers needed:** items epic docs/epics/ep-items-stats.md (5 questions: Tonics?, x10 numbers, rarity names, attribute requirements, damage numbers); bestiary epic docs/epics/ep-bestiary.md (5 questions: bosses, undead/bandits, difficulty change rule, respawn times, croc grab); buildings preview design/preview/buildings-voxel.html (stone vs timber cottage, tower ladder/stair); OB-136 river-quest plan docs/test-reports/ob136-quest-river-audit.md; OB-141 POI plan docs/test-reports/ob141-poi-plan.md (3 questions); OB-135 writer names table (docs/story.md "OB-135 plain names"); bug-catching: quest bot + playtester agent (opus or fable?).
> **Next (in order):** owner look at underlay (enable 0.6), GPU decor default-on again (OB-119 fixed), 23 tower-level sprites (content-lint R2), BEAST-03b/04/05 (arch 38.64), D-082 quest-giver conversion (PO + writer), ENV-02d (look WGSL), ENV-03 atmosphere code (owner pick of biome-atmos still open), OB-142 animals at the river check, OB-150 combat pass, voxel buildings import after the owner pick.

(Owner-requested workspace completion (2026-10-05): empty table, removed 2026-10-14)

### Sprint 6 "Boar demo" + EP-HANDS (PO 2026-10-05, owner goal; D-038 item 2, D-040) - plan: docs/sprints/sprint-6.md
| ID | Title | Priority | Status | [PC] main files |
|---|---|---|---|---|
| US-079b | Boar HP + hurt + death lifecycle (4 HP, flash/flinch, tip over -> dust -> removed, `beast:died`, untargetable when dead, back on respawn/reload) | P0 | owner walk-test pending (stale-rows 2026-10-09). **ARCH OK (batch 2026-10-13): fix b87102c2 [PC-B game, 2026-10-06]** + owner walk-test. HP/death per 37.16.2; beastView drives voxel anim/t/hidden; sword dead-skip + cause:'sword'; particleHooks beast:sink corpseDust; main.js boarFx.attach(). Tests: beastSim 135/0, sword 100/0, particleHooks 27/0, beastView.test.js 10/0. **ARCH CHANGES fixed 2026-10-06:** (1) beastView now resets `frame 0, t 0, loop undefined` on clip change and drives die/sink via `frameTFromElapsed` over the clip durations (die [90,110,120,80,100], sink [500,100]); (2) `homeZ` added (create/hash/save/load) and `resetAll` restores `transform.z = homeZ`. Deviations (non-blocking): hurt window = spec's 10 steps; sink dust = one 14-burst. | `beastSim.js`, `beastConfig.js`, `beastView.js`, `sim/sword.js`, `particleHooks.js`, `game/js/main.js`, +tests (incl. `game/js/quest/beastView.test.js`) |
| US-091a | Loot + inventory data: item defs, player inventory component, boar drop table, walk-over pickup + toast, save/load + death safe | P0 | todo - after US-079b; NEEDS PC-A: designer `design/items.js` + loot sprites | [PC-B game, ~0.75 d] `sim/inventory.js`, `sim/loot.js`, `pickups.js`, main.js **Arch 2026-10-05: architecture.md 37.16.3-4 (E-loot on the corpse; split US-091a1 data / US-091a2 loot+toast).** **PO 2026-10-05: SPLIT into US-091a1 + US-091a2 below; this row stays as the umbrella (close when both are done). Loot = press E at the corpse, not walk-over.** |
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

(moved to backlog-archive.md 2026-10-14: "Engine capability before M3" table, US-041b)

## Physics + effects epic (owner requirement 2026-09-24: object physics before release; handoff 3 items 7+8; sketched, see bottom of file)
**Gate before US-051 starts:** physics-engine choice (extend the in-house `engine/physics` sphere/capsule code vs Rapier/WASM under D-015) needs an architect estimate + a manager decision (new D-entry).
**Architect estimate (2026-09-24):** see `docs/architecture.md` "Physics epic estimate (2026-09-24)" - recommends (A) in-house compound-sphere rigid bodies, ~11 story units; Rapier spike only if US-051a misses its settle test. Awaiting manager decision.

| Order | ID | Title | Priority | Milestone | Status |
|---|---|---|---|---|---|
| P2 | US-052 | Pick up, carry, put down, throw (e.g. a branch) (engine + game story) | P0 | M2 | todo (sketch) - after US-051, uses US-012 interaction |
| P5 | US-055 | Water surface + splash + floating props (engine story) | P1 | M3 | todo (sketch) - after US-051, US-053, US-026 |

## Epic EP-ELEMENTS "Particles, water, fire, wind, weather" (PO 2026-10-01, owner request; sketches, see `### US-053a` onwards near the bottom of the file)
**Scope:** particles, liquid surfaces, burning, fire spread, explosions, wind as a real force, weather/fog. Engine parts stay genre-neutral (D-006); which things burn, what explodes and the tuning numbers are content data. **Existing rows are linked, not duplicated:** US-053 (particles) and US-055 (water) stay the umbrella rows and close when their steps below are done; floating props stay in US-055 after US-051. US-093 (torch burns barriers/brush) and US-101 (Spark lights braziers) use this epic; US-082 (combat feel) uses the particles; US-121 "wind grass" stays a visual shader preset that will read the US-138 wind uniform; US-122 (day/night) and US-127 (light in fog) pair with US-139/140. **Object physics (US-051/052) is not a blocker:** every story here first works on the player capsule, entities and static world data; "pushes / ignites / floats physics bodies" is a later AC marked *(after US-051)*. **Phasing:** particles (053a-c) first, they feed everything else -> water (055a/b) and fire (132-135) -> explosions (136/137) -> wind (138) -> weather (139/140, stretch). **Tech note before dev (NEEDS PC-A: architect note):** US-053a+053b (one note: module home e.g. `engine/fx/`, pool layout, sprite-pass draw, JS twin), US-055a, US-132+133 (one note: status-effect component, flammability on materials vs entities, fire grid), US-136, US-138, US-139. Sim rules for every row: fixed step, seeded RNG, iteration by id, zero per-frame allocation, save-safe state where it persists.

| ID | Title / one-line story | Priority | Milestone / epic | Status |
|---|---|---|---|---|
| US-053d | Particle presets part 2: `splash` drops (for US-055b) + `motes` (US-019 sun-shaft dust rebuilt as a preset, closes US-019) | P2 | M3 EP-ELEMENTS (step of US-053) | todo (sketch) [PC-B content + designer ramps] - deps: US-053c. ~0.5 d |
| US-055a2c | Water wiring + first visible water: (a) `engine/index.js` exports `resolveWaterLooks`; main.js `gpuPipeline.setWaterLooks(assets.waterLooks)` + `fb.waterLooks = resolveWaterLooks(...)`; (b) designer `design/water-looks.js` (`water` look, registered in the AssetRegistry); (c) one pond + one flooded … | P1 | M3/M4 EP-ELEMENTS (water) | … => a few spike frames out of 120, i.e. stalls/uploads landing inside the water timer, most likely from the 45acdee content (ENV-01 ground-detail instances/chunk uploads, tower dressing). PC-B: repeat 3 runs each at 45acdee vs the pre-sync commit, report max + count of frames >.25 ms, and A/B with ground detail off; if spikes stay with detail off, log which frames upload buffers/compile programs. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-141b | Currents act: flow pushes the wading/swimming player (same `pushX/pushY` path as US-138b), carries floating props (after US-051) and water particles; river test level with a strong and a weak reach | P1 | M4 EP-ELEMENTS (water, step 2) | architect note (architecture.md 35.7) -> split 141b1 [PC-A `engine/fx` particle flow, 0.25 d] + 141b2 [PC-B game push + river level, 0.5 d] - deps: US-141a, US-055b, US-138b |
| US-141b1 | Particle flow (engine fx): `def.flow` + `sampleFlow` so water particles drift with the current | P1 | M4 EP-ELEMENTS (water, step 2a) | todo [PC-A engine/fx] - 0.25 d - deps: US-141a. ACs: parent row + architecture.md 35.7, 35.11 step 6 (drift test, zero allocation) |
| US-141b2 | Currents in play (game): flow push via `pushX/pushY`, water emitters with flow, river test level (strong + weak reach) | P1 | M4 EP-ELEMENTS (water, step 2b) | todo [PC-B game/js/quest + level] - 0.5 d - deps: US-141b1, US-138b, US-055b. ACs: parent row + architecture.md 35.7, 35.11 step 7 |
| US-142a | Waterfall view: a vertical falling sheet (animated glyph columns `\| : '`, emissive highlight streaks, fast scroll), foot spray/mist particles, plunge pool with expanding ripple rings; one placeable `waterfall` prop/preset in a test cliff | P1 | M4/M5 EP-ELEMENTS (water, step 3) | architect note (architecture.md 35.5: needs the engine hook) -> split 142a1 [PC-A engine sheet in the water layer, 0.75 d] + 142a2 [PC-B content `design/` + `game/js/quest`, designer ramps + preview, 0.75 d] - deps: US-053c, US-055a2b |
| US-142a2 | Waterfall content: preset, lip + foot emitters, plunge pool (`flowRadial`), ripple rings, test cliff, preview page | P1 | M4/M5 EP-ELEMENTS (water, step 3b) | (triage 2026-10-14: unsure - engine part ARCH OK and `game/js/quest/waterfallHooks.test.js` exists; owner look not recorded here) … as large flat rectangles - tune later.  **ARCH OK engine part (opus 2026-10-04, 82ebe56).** bindWorld disposes sheet buffers on world change, keeps clipmap/targets, idempotent dispose, mesh-only (WaterLayer only exists there); 10 checks cover it. Nit (optional): `frame(fb, light)` without a world unbinds and the next world frame re-uploads sheets - guard `if (world)` if any caller alternates. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-142b | Waterfall sound + cave: loud looping roar with distance falloff + pan (cf. US-020b), spray soaks the lens edge when close, optional walk-behind alcove with a hidden chest spot | P2 | M5/M6 EP-ELEMENTS (water, step 4) | todo (sketch, sound deferred to M6 polish per owner 2026-09-25) [PC-B `game/js/audio`, `game/js/quest`] - deps: US-142a, US-020b. ~0.5 d |
| US-143b | Wave render + shoreline foam: surface visibly rises and falls (shade-pass normal/height perturbation or mesh vertex displacement, architect decides), wave crests lit by sun glint, foam glyphs (`* o .`) where depth < 0.3 m and on crests; JS twin, gpucompare pose `waves` | P1 | M4/M5 EP-ELEMENTS (water, step 6) | architect note (architecture.md 35.3; owner decision 2026-10-02: displaced water mesh) -> split 143b1 [PC-A displacement, 1 d] + 143b2 [PC-A shading + foam + designer ramps, 0.75 d] - deps: US-143a, US-055a2b |
| US-143b1 | Wave displacement (engine): vertex waves on the water mesh, fade, stitch, fragment normal, both twins, pose `waves` geometry | P1 | M4/M5 EP-ELEMENTS (water, step 6a) | todo (triage 2026-10-14: unsure - `engine/world/waves.js` (US-143a) exists, check whether vertex displacement in `engine/mesh/waterMesh.js` is built) [PC-A engine/render] - 1 d - deps: US-143a, US-055a2b. ACs: parent row + architecture.md 35.3, 35.11 step 8 (twin vs `waveHeight` within 1e-5 m, seams watertight with waves) **Binding note (architect, 055a2a review):** build the coarse-ring hole-edge midpoints with `ring = k - 1` (engine/mesh/waterMesh.js:335 `pushVert(x * s / 2, y * s / 2, k, ...)` -> `k - 1`) so the stitch rule is one case: neighbour offset = `WATER_RING_STEP[ring]`. `WATER_U_STRIDE` grows to 32 for the 4 x (kx, ky, A, c) here, not in 143a. |
| US-143b2 | Wave shading + foam (engine + designer ramps): sun on N, glint, bands, shore + crest foam, foam fade, pose `waves` | P1 | M4/M5 EP-ELEMENTS (water, step 6b) | todo [PC-A engine/render + designer ramps] - 0.75 d - deps: US-143b1. ACs: parent row + architecture.md 35.3, 35.11 step 9 |
| US-143c | Waves in play: floating objects (player swim bob, props after US-051, boat later) follow the live surface; calm/storm preset follows wind (US-138) and weather (US-140); sea test level | P2 | M5 EP-ELEMENTS (water, step 7) | architect note (architecture.md 35.7, 35.11 step 10) -> game only [PC-B game/level; engine `setSeaState` lands in 143a] - deps: US-143a/b, US-055b, US-138, US-140 (weather link may land later). ~0.75 d |
| US-144a | Underwater view: eye below surface gives blue-green tint + short fog, glyph swap to a bubbly ramp, light-shaft streaks, surface seen from below; JS twin | P1 | M4/M5 EP-ELEMENTS (water, step 8) | architect note (architecture.md 35.6) -> split 144a1 [PC-A shade + designer, 1 d] + 144a2 [PC-A sprites/particles under fog, 0.5 d] - deps: US-055a2b, US-143a, US-055b |
| US-144a1 | Underwater view (engine + designer): under state + hysteresis, fog, tint, glyph swap, shafts, ceiling, edges, pose `underwater` | P1 | M4/M5 EP-ELEMENTS (water, step 8a) | todo (partly built: `engine/render/underwater.js` + `underwater.test.js` exist; triage 2026-10-14: unsure - check pose `underwater` + remaining ACs) [PC-A engine/render + designer] - 1 d - deps: US-055a2b, US-143a. ACs: parent row + architecture.md 35.6, 35.11 step 13 |
| US-144a2 | Under-fog for sprites + particles (engine): `underFogK` in the sprite pass and the particle layer, with tests | P1 | M4/M5 EP-ELEMENTS (water, step 8b) | todo [PC-A engine/render + fx] - 0.5 d - deps: US-144a1. ACs: parent row + architecture.md 35.6, 35.11 step 14 |
| US-144b | Underwater play + sound: muffled low-pass audio, bubble particles on exhale, breath meter hook on the vitals sim (drain when head is under, refill above; drowning damage values are US-080 tuning) | P2 | M5 EP-ELEMENTS (water, step 9) | todo (sketch, audio part deferred to M6) [PC-B game + audio] - deps: US-144a, US-080a1, US-053c. ~0.5 d |
| US-132 | Burning status effect: as a player I can catch fire (and so can enemies and flammable props): damage over time, flame + smoke on whatever burns, spreads to touching flammable entities, put out by water or by time | P1 | M4 EP-ELEMENTS | todo (sketch) [PC-A engine status-effect component + PC-B game tuning] - deps: US-053c, US-080a1 (damage). NEEDS PC-A: architect note (132+133). ~1 d |
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
| US-079 | First enemy with simple AI (Hush-touched beast): as a player I meet a beast that notices me, telegraphs, charges and can be beaten | P0 | M3 EP-ENEMY (opener) | todo (sketch, ACs below) [PC-A engine AI/entity hooks; PC-B brain + content] - needs architect notes + designer; after US-078, US-041b. **2026-09-30 (D-032 A1):** pathfinding already exists (RE-05 A*, RE-08 flow field, RE-09 steering, RE-10). The brain + nav chase part is split out as **US-079a** (sprint 5). The rest of US-079 (clips, damage, hurt/die, drops) follows US-078/080/083 **Owner 2026-10-06: "I like the new boar" - real wild boar model (3981ee8, PC-A designer) accepted.** |
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
| US-128 | Z-targeting: lock on to the nearest visible target, with a ring under it + a bar through `engine.overlay`, target cycling and the camera kept turned to the target (replaces the US-081 sketch) | P1 | M3 EP-COMBAT (sprint 5) | … story note). AC 7 (owner feel check) and the mesh-renderer walk still open. **US-128b PO OK (opus PO, 2026-10-02, 4100705) -> testing.** Owner walk-test: `?renderer=mesh`, Q-lock a boar, Tab-cycle to a second, walk past 20 m; lock reads clearly and is not nauseating at 240x90 and 400x150. Nit (fold into US-087): main.js:833-835 `uiLocked` does not cover the pause overlay, Q can lock while paused. (full history: backlog-archive.md "Row history 2026-10-06") |
| US-129 | Enemy colour tiers: one beast model in 3 tiers (green / blue / red) via the team remap (RE-06 `setTeamMaterials`, `team.*` slots), with per-tier stats as data (HP x1/x2/x3, speed +0/+10/+20 %) | P2 | M3/M4 content | todo (sketch) [PC-B content + designer tier materials] - after US-079. AC sketch: 3 tiers can be told apart at 10 m at 240x90, one instanced model, tier set in content `entities[].tier` |
| US-130 | Map exploration: the chart card shows only the areas the player has seen (RE-11 `Visibility` grid over the overworld, saved via RE-11b), and dungeon maps fill in room by room | P1 | M4 EP-MAP | todo (sketch) [PC-B chart UI + PC-A architect note (first-person reveal radius/cone vs RE-11 unit sight)] - pairs with US-097. AC sketch: an unseen area is blank on the chart; walking there reveals it within 1 s; the result survives a save/load; a dungeon room shows on the map once entered |
| US-131 | Overworld minimap (RE-13), optional corner widget with fog from US-130 and a player arrow | P2 | M4 EP-MAP | todo (sketch) [PC-B] - **owner question: minimap on screen, or chart card only (Zelda-style)?** |
(US-088 intentionally unused: gear levels are folded into US-095.)

### US-079 First enemy with simple AI (Hush-touched beast)  [Priority: P0 (M3 opener)] [Status: todo (sketch) (triage 2026-10-14: unsure - boar model, HP/death (US-079b), loot (US-091a2) built; light safe zone + respawn rule not verified; likely covered by BEAST-* / D-083 bestiary epic)]  [PC-A engine / PC-B brain + content]
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

## Physics + effects epic – sketches (owner requirement 2026-09-24; M2-M3, before M6)

All five are **engine stories: architect tech notes first**. **Gate before US-051:** the physics-engine choice (extend the in-house `engine/physics` code vs Rapier `@dimforge/rapier3d-compat` / WASM per D-015; Rapier was rejected for the single US-013 boulder, but many stacked, tumbling bodies change the trade-off) needs an architect estimate (cost, determinism for saves, fixed timestep, `World` queries per D-007) and a manager decision recorded in `docs/decisions.md`. All queries still go through `World`; the JS fixed-step sim stays the oracle.

### US-052 Pick up, carry, put down, throw  [Priority: P0 (M2)] [Status: todo (sketch) (triage 2026-10-14: unsure - depended on US-051, which D-089 supersedes with parked ENG-PHYS-EXT-01; needs re-scope)]
As a player, I want to pick up a branch or a crate, carry it, set it down or throw it, so that I can bring things where they are needed and solve simple puzzles.
Acceptance criteria (sketch):
- [ ] `E` on a liftable body (mass <= 25 kg, flagged `liftable`) within 1.8 m picks it up (US-012 interaction prompt "Lift"); it is held in front of the hero at chest height and does not clip into walls (pushed back / dropped if blocked).
- [ ] Carrying: walk speed x0.7, no run, no sword swing; jump allowed only for items <= 5 kg.
- [ ] `E` again puts it down gently on the floor in front (a valid spot or no-op); `Mouse0` throws it along the view direction at 8 m/s for items <= 5 kg (scaled down linearly to 3 m/s at 25 kg) and it becomes a normal US-051 body.
- [ ] A carried item can be placed on a pressure plate (US-014-style trigger) and the trigger fires; the carried branch counts as a key item for a "bring the branch" test beat.
- [ ] Carry state is dropped cleanly on damage, restart (`R`) and level change; no allocations per step.
Design needed: yes – hold pose for the lifted item (offset per model), "Lift/Drop/Throw" hint text (writer).
Notes / dependencies: US-051, US-012, M2 sword (mutual exclusion with the swing).

### US-055 Water surface + splash + floating props  [Priority: P1 (M3)] [Status: todo (sketch) (triage 2026-10-14: unsure - surface 055a, swim 055b and splash are built; only "floating props" remains and it needs ENG-PHYS-EXT-01 (D-089, parked))]
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

### US-043 Steam release: Electron wrapper + Steamworks + store assets  [Priority: P0 (M6)] [Status: todo (sketch) (triage 2026-10-14: unsure - D-053 "no public demo" and D-090 "Electron desktop + web only" may reshape Steam scope; owner to confirm)]
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
| CHARGEN-14 | App Save/Open `.kestrel` + "All formats (.zip)" + `platform.js` adapter (browser fallback) | P1 | ARCH OK (PC-A batch 2026-10-14) -> po-review [PC-B B1, 0.5 d] - deps KPKG-02 | `tools/chargen/ui.js`, `platform.js`, `core.js` |
| CHARGEN-19 | Tauri shell + stage + unsigned Windows installer | P1 | todo [PC-B B1, 0.75 d] - deps 13, 14 | `tools/chargen-desktop/*` |
| CHARGEN-20 | Signed release builds (Windows, macOS notarized, Linux AppImage) | P2 | todo [PC-B B1, 0.5 d] - needs owner certificates (ESCALATE 38.29 item 8) | `tools/chargen-desktop/*` |
| RIG-00 | ARCH-NOTE NEEDED: rigged-model seam in VoxelPool/instances (prebuilt mesh + parts + clips) | P1 | done (38.32, PC-B architect opus, PC-A to ratify) | `docs/architecture.md` |
| RIG-01 | `engine/mesh/gltf.js`: rigid-skin + animation reader `readRiggedGlb` | P1 | ARCH OK (batch 2026-10-13) [PC-B B2, 0.75 d] | `engine/mesh/gltf.js` + tests |
| RIG-02 | Rigged model in the registry/pool: collapseRig output drawn on the mesh path, play/partRot/mounts/shadows | P1 | todo [B2 or PC-A] - RIG-02a ARCH OK (PC-A batch 2026-10-14) -> po-review (kestrel-3, 2026-10-10; see docs/lanes/pc-b2.md); RIG-02b DONE -> arch-review (kestrel-3, 2026-10-10; see docs/lanes/pc-b2.md). Per 38.32: RIG-02a (0.5 d: readRiggedGlb fixes 38.32 item 6 + fromGlb + collapseRig pivotM/anchorCells), RIG-02b (0.75 d: riggedModelDef + voxelPack rig branch + buildRiggedMesh); tests 38.32 item 8 | `engine/mesh/gltf.js`, `engine/chargen/{collapse,fromGlb,rigModel,index}.js`, `engine/voxel/voxelPack.js`, `engine/mesh/voxelMesh.js`, `engine/index.js` + tests (38.32 item 9) |
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
| WILD-07a | Flyer brain engine half with a fake env + placeholder bird model (one box part, 3 clips); no designer art needed | P2 | ARCH OK (PC-A batch 2026-10-14) -> po-review [PC-B kestrel-3, 0.75 d] - deps WILD-04 (done); flyerBrain.js + test done, see lane note | `engine/fauna/flyerBrain.js` + test, `engine/fauna/fauna.js` (kind switch) |
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
| WS1-02 | kestrel-3 | 1 d | `engine/world/World.js` (band rect, nearBandKey), `engine/world/Terrain.js` (`bakeNearBand(cx0,cy0,cw,ch)`), JS `near.w/h` consumers (scatter, terrainShade, detailShade), `engine/world/terrainBand.test.js` (new) | - | ARCH OK (PC-A batch 2026-10-14; fix a6c50587) -> po-review [PC-B] |
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
