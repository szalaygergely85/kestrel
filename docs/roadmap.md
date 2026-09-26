# ASCII Quest – Roadmap

Owner: Manager. Updated: 2026-09-23 (D-010: M1.5 Editor Preview; model editor in M5. D-011: new story canon, M2-M4 themes. D-012 Steam in M6; D-013 writer proposals; D-014 strategy camera note; D-015 WASM/Rapier policy). 2026-09-24: D-017 JS reference only; D-018 object physics epic US-051..055 in M2/M3; D-019 voxel props in M1 (US-040 + US-041a pulled forward, US-041b creatures stay pre-M3). D-020: sprint 1 planned (`docs/sprints/sprint-1.md`), no walk-on in M1, minimal sound slice P1, owner story/progression idea to M2+.

## Product shape
- **Engine** (`engine/`): reusable, data-driven ASCII 3D engine (WebGL2 char-grid presenter, hybrid sector + terrain renderer, 2.5D physics, plain-data world/entities, serializable). A product of its own later, with an editor UI in `tools/`.
- **Game** (`game/` + `design/`): ASCII Quest, an open-world Zelda-like built on the engine.

**Re-plan (2026-09-26, PO, owner request "what do we miss?"):** milestones M3-M6 re-cut below around the missing game loop (combat -> save/items/dungeon -> chapter two -> polish) plus a parallel **engine release track**. **Accepted in D-030** (with adjustments: D-029 gates first, game before engine track, M1.5 folded into ME-18, owner questions open). It supersedes the D-011 milestone themes for M3/M4, moves the D-010 "Engine Editor v0" milestone into the engine track, moves the itch.io demo (D-012) from end of M2 to end of M3 and Steam "Coming Soon" from M3 to M5. New rows: `docs/backlog.md` section "Game + engine gap epics" (US-078..US-118).

**Current (2026-09-26, D-029):** engine direction changed to our **own mesh engine** (architecture.md 27; ASCII look = final stage, JS + JSDoc/@ts-check, WebGL2 behind `GpuDevice`, WebGPU = phase 4). **M2 core is now mesh engine phases 0-2 + the walk-out running on it.** Sprint 4 = CO-2/CO-3 + mesh phase 0 (ME-00) + phase 1 (ME-01..08) + US-026b S1; gate = owner side-by-side. `dda/terrain/voxel.frag`, US-026b S5, US-070a frozen until the phase-1 gate. US-051a behind the phase-2 gate.

**Previous (2026-09-25):** M1 **done** (D-024). Sprint 3 (D-026, `docs/sprints/sprint-3.md`) opens M2: US-027a/b content format, US-038a/b settings + grids (D-025), US-026a walk-out. Sprint 4: US-026b streaming + US-051a object physics; US-031 editor at the earliest.

## Milestone 1 – "The Awakening" (vertical slice) — status: DONE (2026-09-25, D-024)

Goal: a polished 3–5 minute playable slice, from waking at the bottom of the Hollow Watchtower to stepping through the summit breach and seeing the overworld. Content unchanged by the open-world pivot; the engine underneath is now open-world-capable.

**In (P0)**
- WebGL2 char-grid RenderTarget (D-005) - done.
- Palette, ramps, materials (US-002) - done. Sector map format v2 (US-003) - done.
- Sector caster for structures with shared DepthBuffer (US-004), capsule physics (US-008/009).
- **Engine/game split per D-006 (US-024)** and **World model per D-007 (US-025)**: tower placed in one world frame, terrain sampler, serializable world/entity state.
- **GPU cell pipeline per D-009 (staged):** US-029 pipeline + shade/edge port + `?gpucompare=1` parity (gate: fail -> plan A, CPU) -> US-030 GLSL DDA + N-ray anti-shimmer + GPU sprites. JS path = correctness oracle only (D-017; no playable CPU fallback).
- Lighting: ambient + sun shaft with shadow + torch flicker + carried lantern (US-006/007 in GLSL, after US-030).
- The tower structure: wake spot, brazier, lantern, boulder, broken stair with jump gap, mid ledge with lever + grate, summit breach. Props/lights/interactables/triggers declared as level data.
- Far overworld view = terrain caster at far LOD, GPU-first (US-016, after US-030).
- Wake sequence, title, hints, end trigger + fade + restart.
- 60 fps, <= 8 ms JS + <= 4 ms GPU at the default grid (240x90 on GPU after US-030), grid configurable 160x60..320x120 (US-018). *(D-025: engine range 160x60..480x180, player options 240/320/400/480, via US-038a in M2.)*
- **D-019 (2026-09-24, owner OWN-REQ-001): tower props are voxel models, fixed in the world.** US-040 (GPU voxel pass A3) and US-041a (voxel lighting + entity binding + prop-only rigid parts) are M1 P0; the designer builds the solid props once as voxel ModelDefs (ART-OWN-001). Flames/glows/sparks stay billboards (BUG-OWN-003 slimmed to `fill` for those). Gate: US-040 fails gpucompare or 0.5 ms p95 after one fix round -> fall back to billboards + fill/outline + fixed yaw, voxel props move to M2.
- **D-017 (2026-09-24):** JS render path = correctness reference only (gpucompare + Node tests, no perf ACs); no playable CPU fallback - no WebGL2 shows a "WebGL2 required" screen.

**Engine build order (D-009, D-019):** US-028 -> US-025 -> US-029 -> US-030 -> US-006 -> US-007 -> US-011 -> US-016 (finishing) -> US-040 -> US-041a -> US-056 voxel props in `world_m1` + owner walk-check -> BUG-OWN-003 (slim, if still needed) -> US-018. Voxel prop art (ART-OWN-001) runs in parallel with US-040.
- **Ending (D-020):** no walk-on past the breach in M1. The end trigger stays, made deliberate by the vista, a summit hint and an "End of Chapter One" card (BUG-OWN-005, P0).
- **Sprint 1 (D-020):** US-016 finish -> US-040 -> US-041a -> US-056, BUG-OWN-005 in parallel, US-018 stretch. Exit = owner end-to-end walk-test.
- **Sprint 1: done** (goal met, owner walk-test 2026-09-25). **Sprint 2 (D-022, `docs/sprints/sprint-2.md`):** BUG-OWN-007 -> US-020a sound slice -> US-022 -> BUG-GPU-003 -> US-018 -> OWN-REQ-003 (stretch); OWN-REQ-004 decision (D-023) in parallel. Goal: M1 closes. **Sprint 2: done** (goal met, stranger test PASS -> M1 closed, D-024).
- **P1 (after all P0):** light the summit beacon (US-022, D-003); minimal procedural sound slice (lever, gear, grate, boulder, footsteps; carved out of US-020, D-020, not an exit criterion).

**P2 stretch (not exit criteria):** dust motes (US-019), rest of procedural WebAudio (US-020, D-004), wall scrawl (US-021), see-through grate (US-023).

**Out**
- Walking on terrain, combat, enemies, inventory, dialogue, NPCs, saving UI, audio asset files, editor UI.
- Voxel creatures and walk/idle clips (US-041b, before M3), the 7.7 billboard `outline` option, directional billboard views.

**Exit criteria:** PO OK + tester PASS on every P0 story; the owner's end-to-end walk-test (sprint 1 exit) passes; a stranger finishes the slice without instructions and without taking the lantern; `tools/check-deps.mjs` reports no engine -> game/design imports.

## Milestone 1.5 – "Editor Preview" (D-010) — status: unlocked (M1 done); editor code from sprint 4 at the earliest, after US-027a/b (D-023)
Level viewer + object placer in `tools/editor/`, a second client of `engine/index.js`.
- **In:** load world, fly-cam, idle re-render skip; pick/select/move/yaw/delete; place props (existing models), lights (presets), triggers/hint zones; property panel (JSON components, behaviour-name dropdown); undo/redo; save/load world JSON (File System Access API + download fallback); Play-test in the game via `?world=` (world-file loading half of US-027).
- **Out:** terrain paint, structure/sector editing, model editing, multi-viewport, prefabs, CPU fallback, visual scripting, asset store.
- **Depends on:** US-025 (serialize, handles, renderVersion), US-030 (GPU grid, planeId picking, sprite pass), US-011, US-006/007, US-014/015.
- Stories (PO to write): US-031..US-034.

**Story (D-011 amendment 2, D-013):** fantasy canon with steampunk machine accents. Wick, a young man from machine-only Ferrum (no amnesia), is shot down in the stolen balloon *Kestrel* and holds a Crown sky-chart with his pencil course to the SOS (3 short, 3 long, 3 short). M1 is a text and art reskin only (lamp, wreckage, relay, signal tower). The only scope change is the US-015 map card (static overlay, `M` re-opens it).

## Milestone 2 – "Out of the Wreck" — status: IN PROGRESS (sprint 3 closing; sprint 4 = mesh engine, D-029)
**Goal:** the M1 slice and the walk-out (wake -> breach -> hillside -> waystone) run on our own mesh renderer + mesh physics, looking the same or better.
**Epics:** EP-MESH phases 0-2 (ME-00..ME-12; phase 3 ME-13..21 runs on into M3), EP-COORD (CO-1..CO-8), EP-WORLD part 1 (US-026b S1-S4, S6, S7 streaming + `content/chunks/` + OWN-REQ-002), EP-PHYS part 1 (US-051a after the phase-2 gate). Done in M2: US-027a/b, US-038a/b, US-058, US-060, US-026a.
**Exit test:** phase-1 gate + phase-2 gate passed (below); the owner walks wake -> waystone on `?renderer=mesh&physics=mesh` with no seams, no fall-through, `?bench=1` inside the D-029 budget; all Node suites + check-deps + typecheck green.
**Mesh engine (D-029, architecture.md 27.11) - M2 exit criterion:** phase 0 (ME-00 typecheck) -> phase 1 (ME-01..08: tower, terrain, props as meshes via `?renderer=mesh`; **gate:** owner side-by-side "same or better" on 6 poses, gpucompare PASS, bench p95 <= 3.38 ms at 400x150 / 1.8 ms at 240x90) -> phase 2 (ME-09..12: BVH + capsule-vs-mesh, `World.contacts` = Rapier seam; **gate:** owner walk-test "plays the same", sim <= 1 ms) -> the walk-out (wake -> breach -> hillside -> waystone) runs on the mesh renderer + mesh physics. ~3.5-4 calendar weeks. **After the phase-2 gate (M2 tail / M3 head):** US-051a object physics, phase 3 (ME-13..21: glTF buildings, sun + point shadow maps = RT-look US-070b/c, editor on meshes, ME-19 deletes the casters). **Phase 4 WebGPU (ME-30..34):** only after ME-19 and a recorded trigger. **Frozen until phase-1 gate:** `dda/terrain/voxel.frag`, US-026b S5, US-070a; the order below is superseded where it conflicts.
**Sprint order:** sprint 3 = US-027a/b (content JSON), US-038a/b + US-060 (settings, D-025 grids), US-026a (bounded walk-out), US-058 validator; sprint 4 = CO-2/CO-3 + ME-00..08 + US-026b S1 (`docs/sprints/sprint-4.md`); sprint 5 = phase 2 (ME-09..12) + US-026b S2+; then M3 combat core (sword, first enemy, hearts). *(2026-09-26 re-plan: sword, first enemy, hidden chest, relay save point, day/night and the itch.io demo moved out of M2 into M3/M4 below; the settings menu is done.)*
**Owner story + progression idea (D-020, `docs/owner-ideas/2026-09-24-story-and-progression.md`), M2+:** crash intro animation (PO places it: M2 at the earliest, or M1.5 if it's a cheap title-card beat), vanished loved one + SOS hook (writer). Progression without XP: gear has levels (weapons, armour, shields; first in M2 with the sword); magic comes from beacons/wells/quests via a small skill tree (fireball, freeze, lightning, one big spell; starts with M3 Spark); bow in M3. Trading, crafting, animals/monsters/plants and the biomes (forest, desert, snow, mountains, wind) get assigned to M3+ once the GDD section exists.
*(Historical M2 scope before D-029 / the 2026-09-26 re-plan; the sword, enemy, chest, save point, day/night and demo items now live in M3/M4.)* Step out of the breach onto real terrain (US-026 replaces the M1 end trigger with the walk-out, D-020): terrain caster near LOD + slope physics + chunk regeneration (US-026), JSON content packs (US-027; world-file loading moved to M1.5), day/night sun cycle, first melee enemy (Hush-touched beast), sword + lock-on, a hidden chest, the relay tower as save point. **Release prep (D-012):** settings menu (grid, sensitivity, invert Y, volume, fullscreen + pointer lock, pause on focus loss), saves via a `game/js/platform/` adapter with a versioned save format. **itch.io browser demo** (M1+M2 slice) at the end of M2. Architect may evaluate Rust/WASM for measured hot spots only (terrain bake, pathfinding; D-015).
- **Object physics epic, part 1 (D-018, owner-required before release):** in-house compound-sphere rigid bodies in `engine/physics/rigid.js`. US-051a (bodies + world contacts + sleep), then US-051b (body-body contacts, stacks <= 3, player contacts), then US-052 (pick up / carry / throw). US-053 particles (smoke, dust, sparks, splash; folds in US-019) can run in parallel. Gate: if US-051a misses the 10-body settle test after one fix round, a Rapier spike becomes its own story.

## Milestone 3 – "Steel and Hush" (combat core) — status: planned (2026-09-26 re-plan)
**Goal:** Wick finds a sword on the hillside, fights the first beast, gets hurt, dies and wakes again, and it feels good.
**Epics:**
- EP-COMBAT: US-078 sword swing + hit detection (opener), US-081 lock-on / target focus, US-082 combat feel (hit-stop, knockback, shake, sparks), US-086 guard/block (sketch, owner question 1).
- EP-ENEMY: US-079 first enemy with simple AI (opener), US-041b creature clips, US-083 animation state machine, US-085 AI behaviour component, US-084 navigation/pathfinding (needed for M5 NPCs; the M3 enemy works with direct steering).
- EP-HEALTH: US-080 hearts, damage, death + respawn (opener).
- EP-INPUT: US-087 input action map (actions instead of raw keys; basis for remapping + gamepad in M6).
- Runs on in parallel: EP-MESH phase 3 (ME-13..21, ME-19 deletes the casters), EP-PHYS part 1 (US-051b, US-052, US-053 particles - hit sparks, death dust).
- Release: US-112 itch.io browser demo (M1 + walk-out + combat slice) at the M3 exit.
**Exit test:** a stranger plays wake -> tower -> breach -> takes the sword -> beats 2 beasts -> waystone without instructions (may die and respawn); the owner calls combat "readable and satisfying" at 240x90 (telegraphs visible, hits land, no unfair damage); `?bench=1` inside budget with 4 enemies active; tester PASS on US-078/079/080.

## Milestone 4 – "Keys and Relays" (the adventure loop) — status: planned (2026-09-26 re-plan)
**Goal:** the player can save and continue, collects items, and a first small dungeon gives a tool that opens a new part of the world.
**Epics:**
- EP-SAVE: CO-5 format (M2) -> US-089 save/load runtime (woken relay = save point + autosave), US-090 title menu with New / Continue / 3 save slots.
- EP-ITEMS: US-091 inventory + item data + equip screen, US-092 chests + pickups + item-get card, US-093 first tool item that opens an area, US-095 heart vessels + gear levels (no XP, D-020).
- EP-DUNGEON: US-094 first small dungeon (3-5 rooms, one puzzle chain, small key, mini-boss, tool as reward).
- EP-QUEST: US-096 quest flags/objectives + journal, US-097 chart with live position + woken relays.
- EP-WORLD part 2: US-026b finished (streaming), US-098 day/night cycle, US-054 cuttable tree (needs the M3 sword).
- Content speed-up: US-075 MCP server, US-076 editor AI chat, US-077 text-authored mesh shapes, ME-18 editor on meshes.
**Exit test:** a fresh player starts a new game, rests at a relay, quits, presses Continue and gets the same position, hearts, items and flags (byte-stable save round trip, M3 saves migrate); clears the dungeon in <= 20 min without a guide; uses the tool to enter an area that was blocked before.

## Milestone 5 – "The Relay Line" (chapter two) — status: planned (was M3 before the re-plan)
**Goal:** meet talking animals and the exiles, learn the first spell, wake three relays across a new region.
**Epics:**
- EP-DIALOGUE: US-042 dialogue system + first talking animal (may be pulled into M4 if cheap).
- EP-NPC: US-099 exile village "Outwall" (D-013: final name decided here) with 3-5 NPCs, idle routines, navigation (US-084/085).
- EP-REGION: US-100 chapter-two region with 3 dead relays (terrain overrides as data), US-104 secrets + collectibles pass.
- EP-MAGIC: US-101 artificer's gauntlet + Spark (first spell, the moment of belief).
- EP-ENEMY 2: US-102 clockwork sentinel; US-103 ranged tool (bow or crossbow, unless it is the M4 tool).
- EP-PHYS part 2 (D-018): US-055 water + splash + floating props (US-054 moved to M4). The whole US-051..055 epic is done before M6.
- US-105 the Signal Source dungeon + boss (was M4; ships in 1.0 or after, owner question 5).
- Steam "Coming Soon" page once M5 is playable (D-012 said M3; moved).
**Exit test:** a stranger plays chapters one and two (about 60-90 min) without a guide; exiles are the first to say "Wick" (D-013); streaming holds the frame budget across the whole region; writer signs off all dialogue.

## Milestone 6 – "Polish & Release" — status: planned
**Goal:** a release-quality build on web and Steam (Windows, Linux/Steam Deck), playable with keyboard/mouse or gamepad only.
**Epics:**
- EP-INPUT 2: US-107 gamepad (Steam Deck layout + UI navigation), US-108 key remapping in Settings.
- EP-AUDIO (owner deferred sound to M6): US-020 rest + US-020d, US-109 music (exploration / combat / relay stingers).
- EP-POLISH: US-053 particles (if not done in M3), US-110 accessibility (cell size, colourblind palettes, hold/toggle options, visual cues for sounds), US-111 performance + Steam Deck pass, US-106 crash intro (owner idea D-020), US-118 localisation-ready strings.
- EP-RELEASE: US-043 Steam (Electron in `desktop/`, `steamworks.js` behind the platform adapter, store assets rendered in-engine, writer store text, $100 Steam Direct fee), itch.io build updated.
Order: itch.io demo (end of M3) -> Steam Coming Soon (M5) -> launch (end of M6).
**Exit test:** release checklist PASS on Windows, Linux and Deck; one full gamepad-only playthrough; 60 fps at 240x90 on the Deck; zero open P0/P1 bugs; save from the demo build migrates.

## Engine release track (parallel to M3-M6; gates the engine release, not the game)
**Goal:** someone outside the team can build a small lit ASCII world with our engine using only the public API and the docs.
**Epics:**
- EP-API: ME-00 typecheck + typed public API, US-047 two-tier API, US-115 public API freeze (`@public`/`@internal`, semver 0.x, CHANGELOG, deprecation rule).
- EP-DOCS: US-113 API reference generated from JSDoc + concept guide + content-format spec (content packs, `.mesh.json`, ModelDef, chunks).
- EP-EXAMPLES: US-114 three runnable examples under `examples/` (lit room, terrain walk, props + physics), smoke-tested in `run-tests.mjs`.
- EP-LICENSE: US-116 engine licence + `LICENSE`/`THIRD_PARTY_NOTICES` (owner question 10).
- EP-EDITOR (was M5 "Engine Editor v0", D-010): US-035..037 model + animation editor, US-067 asset library, US-068 gizmo/ortho views, ME-18 editor on meshes, US-075..077 MCP/AI/text meshes. Future: 2D/2.5D strategy camera (D-014; renderer stays camera-agnostic by review rule).
- EP-PACKAGE: US-117 standalone engine package (ESM zip/npm, no build step) + engine name (GDD: still open).
**Exit test:** an outside developer follows the guide and gets one example running plus a walkable room with a prop and a light in under 1 hour; typecheck + check-deps clean; every public export documented; licence files present.

## Tech policy notes
- **Rust/WASM (D-015):** only for bench-measured hot spots after a JS pass (terrain bake, pathfinding); prebuilt `.wasm` committed, source in `tools/wasm/`, JS kept as oracle/fallback. Engine stays JS + GLSL.
- **Rapier (D-015):** architect evaluates `@dimforge/rapier3d-compat` (vendored, no bundler) when US-013 comes up; adopt only if fixed-timestep, deterministic enough for saves, and queries still go through `World`. **Decided for object physics in D-018:** in-house rigid bodies. Rapier only becomes a spike story if US-051a fails its settle gate. **D-029:** arbitrary meshes come from our own mesh engine (no Three.js); Rapier, if ever, sits behind `World.contacts` (27.10).
- **Dev dependencies (D-029):** root `package.json` with `devDependencies: { typescript }` only (typecheck of JSDoc); runtime stays build-free and dependency-free.

## Owner questions (PO, 2026-09-26 re-plan; answers go to `docs/decisions.md`)
1. **Combat style:** simple first-person swings + lock-on + dodge-step (PO proposal), or also block/parry with a shield in M3 (US-086)?
2. **First enemy:** a Hush-touched boar that charges (PO proposal, clear telegraph), a wolf pack, or the bear (US-041b model)?
3. **Where the sword is found:** a ruin-steel blade in a fallen statue on the hillside before the waystone (PO proposal), or in the tower / wreck?
4. **First tool item (M4):** a brass grapple hook from the *Kestrel* wreck (PO proposal: fits Wick + machines, opens cliffs/gaps), bow, bombs, or a lamp upgrade that burns brambles?
5. **Dungeons for 1.0:** a first small dungeon in M4 (proposal), and does the Signal Source dungeon + boss (answer to the SOS) ship in 1.0 or after release?
6. **Chapter two location:** the river valley along the pencil line toward the signal tower, with Outwall in a forest clearing (proposal), or another biome?
7. **Health:** 3 hearts with half-heart damage, fall damage from M3 (> 6 m), death = wake at the last relay keeping items (proposals)?
8. **Money and trading:** in 1.0 (a currency, a trader at Outwall) or no currency at all?
9. **Saving:** relay save points + autosave with 3 slots (proposal), or save anywhere?
10. **Engine:** licence (e.g. MIT vs source-available) and the engine's name.
11. **Release shape:** itch.io demo at the end of M3 OK? Steam full 1.0 after M6, or Early Access after M5?
