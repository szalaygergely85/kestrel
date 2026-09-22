# ASCII Quest – Roadmap

Owner: Manager. Updated: 2026-09-22 (after D-006/D-007/D-008: reusable engine, open world).

## Product shape
- **Engine** (`engine/`): reusable, data-driven ASCII 3D engine (WebGL2 char-grid presenter, hybrid sector + terrain renderer, 2.5D physics, plain-data world/entities, serializable). A product of its own later, with an editor UI in `tools/`.
- **Game** (`game/` + `design/`): ASCII Quest, an open-world Zelda-like built on the engine.

## Milestone 1 – "The Awakening" (vertical slice) — status: IN PROGRESS

Goal: a polished 3–5 minute playable slice, from waking at the bottom of the Hollow Watchtower to stepping through the summit breach and seeing the overworld. Content unchanged by the open-world pivot; the engine underneath is now open-world-capable.

**In (P0)**
- WebGL2 char-grid RenderTarget (D-005) - done.
- Palette, ramps, materials (US-002) - done. Sector map format v2 (US-003) - done.
- Sector caster for structures with shared DepthBuffer (US-004), capsule physics (US-008/009).
- **Engine/game split per D-006 (US-023)** and **World model per D-007 (US-024)**: tower placed in one world frame, terrain sampler, serializable world/entity state.
- Lighting: ambient + sun shaft with shadow + torch flicker + carried lantern.
- The tower structure: wake spot, brazier, lantern, boulder, broken stair with jump gap, mid ledge with lever + grate, summit breach. Props/lights/interactables/triggers declared as level data.
- Far overworld view = terrain caster at far LOD composited with the sector caster (US-016).
- Wake sequence, title, hints, end trigger + fade + restart.
- 60 fps at 160x60 cells, <= 8 ms JS render (US-018).
- **P1 (after all P0):** light the summit beacon (US-022, D-003).

**P2 stretch (not exit criteria):** dust motes (US-019), procedural WebAudio (US-020, D-004), wall scrawl (US-021).

**Out**
- Walking on terrain, combat, enemies, inventory, dialogue, NPCs, saving UI, audio asset files, editor UI.

**Exit criteria:** PO OK + tester PASS on every P0 story; a stranger finishes the slice without instructions and without taking the lantern; `tools/check-deps.mjs` reports no engine -> game/design imports.

## Milestone 2 – "First Steps" — status: planned
Step out of the breach onto real terrain: terrain caster near LOD + slope physics + chunk regeneration (US-025), JSON content packs / world files (US-026), day/night sun cycle, first melee enemy, sword + lock-on, a hidden chest, save point at the tower.

## Milestone 3 – "The Dark Beacons" — status: planned
Open region with 3 beacons to relight (each a placed structure), a village with 3–5 NPCs and dialogue, second enemy type, ranged tool, terrain overrides authored as data.

## Milestone 4 – "The Depths" — status: planned
First dungeon (a large placed structure): keys, light puzzles (mirrors, shadow), a boss, item reward.

## Milestone 5 – "Engine Editor v0" — status: planned
`tools/` editor built on `engine/index.js`: terrain paint/stamp, structure placement, prop/light/trigger editing, live preview, JSON save/load. Engine published as a standalone package.

## Milestone 6 – "Polish & Release" — status: planned
Performance pass, accessibility (font size, colorblind palettes), gamepad, static release.
