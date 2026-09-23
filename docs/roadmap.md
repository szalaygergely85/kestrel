# ASCII Quest – Roadmap

Owner: Manager. Updated: 2026-09-23 (D-010: M1.5 Editor Preview; model editor in M5. D-011: new story canon, M2-M4 themes).

## Product shape
- **Engine** (`engine/`): reusable, data-driven ASCII 3D engine (WebGL2 char-grid presenter, hybrid sector + terrain renderer, 2.5D physics, plain-data world/entities, serializable). A product of its own later, with an editor UI in `tools/`.
- **Game** (`game/` + `design/`): ASCII Quest, an open-world Zelda-like built on the engine.

## Milestone 1 – "The Awakening" (vertical slice) — status: IN PROGRESS

Goal: a polished 3–5 minute playable slice, from waking at the bottom of the Hollow Watchtower to stepping through the summit breach and seeing the overworld. Content unchanged by the open-world pivot; the engine underneath is now open-world-capable.

**In (P0)**
- WebGL2 char-grid RenderTarget (D-005) - done.
- Palette, ramps, materials (US-002) - done. Sector map format v2 (US-003) - done.
- Sector caster for structures with shared DepthBuffer (US-004), capsule physics (US-008/009).
- **Engine/game split per D-006 (US-024)** and **World model per D-007 (US-025)**: tower placed in one world frame, terrain sampler, serializable world/entity state.
- **GPU cell pipeline per D-009 (staged):** US-029 pipeline + shade/edge port + `?gpucompare=1` parity (gate: fail -> plan A, CPU) -> US-030 GLSL DDA + N-ray anti-shimmer + GPU sprites. JS path = oracle + fallback (160x60 forced).
- Lighting: ambient + sun shaft with shadow + torch flicker + carried lantern (US-006/007 in GLSL, after US-030).
- The tower structure: wake spot, brazier, lantern, boulder, broken stair with jump gap, mid ledge with lever + grate, summit breach. Props/lights/interactables/triggers declared as level data.
- Far overworld view = terrain caster at far LOD, GPU-first (US-016, after US-030).
- Wake sequence, title, hints, end trigger + fade + restart.
- 60 fps, <= 8 ms JS + <= 4 ms GPU at the default grid (240x90 on GPU after US-030; 160x60 on fallback), grid configurable 160x60..320x120 (US-018).

**Engine build order (D-009):** US-028 -> US-025 -> US-029 -> US-030 -> US-006 -> US-007 -> US-016 -> US-011 -> ... -> US-018.
- **P1 (after all P0):** light the summit beacon (US-022, D-003).

**P2 stretch (not exit criteria):** dust motes (US-019), procedural WebAudio (US-020, D-004), wall scrawl (US-021), see-through grate (US-023).

**Out**
- Walking on terrain, combat, enemies, inventory, dialogue, NPCs, saving UI, audio asset files, editor UI.

**Exit criteria:** PO OK + tester PASS on every P0 story; a stranger finishes the slice without instructions and without taking the lantern; `tools/check-deps.mjs` reports no engine -> game/design imports.

## Milestone 1.5 – "Editor Preview" (D-010) — status: planned (starts when M1 exit criteria are met)
Level viewer + object placer in `tools/editor/`, a second client of `engine/index.js`.
- **In:** load world, fly-cam, idle re-render skip; pick/select/move/yaw/delete; place props (existing models), lights (presets), triggers/hint zones; property panel (JSON components, behaviour-name dropdown); undo/redo; save/load world JSON (File System Access API + download fallback); Play-test in the game via `?world=` (world-file loading half of US-027).
- **Out:** terrain paint, structure/sector editing, model editing, multi-viewport, prefabs, CPU fallback, visual scripting, asset store.
- **Depends on:** US-025 (serialize, handles, renderVersion), US-030 (GPU grid, planeId picking, sprite pass), US-011, US-006/007, US-014/015.
- Stories (PO to write): US-031..US-034.

**Story (D-011):** fantasy canon with steampunk machine accents. The hero is shot down in a stolen balloon, has amnesia and holds a map to the SOS. M1 is a text and art reskin only (lamp, wreckage, relay, signal tower). The only scope change is the US-015 map card (static overlay, `M` re-opens it).

## Milestone 2 – "Out of the Wreck" — status: planned
Step out of the breach onto real terrain: terrain caster near LOD + slope physics + chunk regeneration (US-026), JSON content packs (US-027; world-file loading moved to M1.5), day/night sun cycle, first melee enemy (Hush-touched beast), sword + lock-on, a hidden chest, the relay tower as save point.

## Milestone 3 – "The Relay Line" — status: planned
Open region along the map route with 3 dead relays to wake (each a placed structure), an exile village with 3–5 NPCs and dialogue, the artificer's gauntlet + Spark (first magic), second enemy (clockwork sentinel), ranged tool (bow or crossbow), terrain overrides authored as data.

## Milestone 4 – "The Signal Source" — status: planned
First dungeon = the signal's source (an ancient ruin with pressure doors and gear puzzles): keys, light puzzles (mirrors, shadow, aether), a boss, reward = first gauntlet crystal. The city of Ferrum stays out until after M6.

## Milestone 5 – "Engine Editor v0" — status: planned
`tools/` editor built on `engine/index.js`, extending the M1.5 editor: terrain paint/stamp, structure placement, live preview, JSON save/load. **ASCII model + animation editor** (D-010, `tools/model-editor/`): per-direction glyph/fg frames, named animations (fps/durations, loop, frame `events`), onion skin, live preview via the real animation player, save ModelDef JSON to `design/models/`. Out: rigs/tweening, image import, auto-LOD, visual scripting, asset store. Depends on US-027 + US-011. Stories US-035..US-037. Engine published as a standalone package.

## Milestone 6 – "Polish & Release" — status: planned
Performance pass, accessibility (font size, colorblind palettes), gamepad, static release.
