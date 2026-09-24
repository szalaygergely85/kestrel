# ASCII Quest – Roadmap

Owner: Manager. Updated: 2026-09-23 (D-010: M1.5 Editor Preview; model editor in M5. D-011: new story canon, M2-M4 themes. D-012 Steam in M6; D-013 writer proposals; D-014 strategy camera note; D-015 WASM/Rapier policy). 2026-09-24: D-017 JS reference only; D-018 object physics epic US-051..055 in M2/M3; D-019 voxel props in M1 (US-040 + US-041a pulled forward, US-041b creatures stay pre-M3).

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
- **GPU cell pipeline per D-009 (staged):** US-029 pipeline + shade/edge port + `?gpucompare=1` parity (gate: fail -> plan A, CPU) -> US-030 GLSL DDA + N-ray anti-shimmer + GPU sprites. JS path = correctness oracle only (D-017; no playable CPU fallback).
- Lighting: ambient + sun shaft with shadow + torch flicker + carried lantern (US-006/007 in GLSL, after US-030).
- The tower structure: wake spot, brazier, lantern, boulder, broken stair with jump gap, mid ledge with lever + grate, summit breach. Props/lights/interactables/triggers declared as level data.
- Far overworld view = terrain caster at far LOD, GPU-first (US-016, after US-030).
- Wake sequence, title, hints, end trigger + fade + restart.
- 60 fps, <= 8 ms JS + <= 4 ms GPU at the default grid (240x90 on GPU after US-030), grid configurable 160x60..320x120 (US-018).
- **D-019 (2026-09-24, owner OWN-REQ-001): tower props are voxel models, fixed in the world.** US-040 (GPU voxel pass A3) and US-041a (voxel lighting + entity binding + prop-only rigid parts) are M1 P0; the designer builds the solid props once as voxel ModelDefs (ART-OWN-001). Flames/glows/sparks stay billboards (BUG-OWN-003 slimmed to `fill` for those). Gate: US-040 fails gpucompare or 0.5 ms p95 after one fix round -> fall back to billboards + fill/outline + fixed yaw, voxel props move to M2.
- **D-017 (2026-09-24):** JS render path = correctness reference only (gpucompare + Node tests, no perf ACs); no playable CPU fallback - no WebGL2 shows a "WebGL2 required" screen.

**Engine build order (D-009, D-019):** US-028 -> US-025 -> US-029 -> US-030 -> US-006 -> US-007 -> US-011 -> US-016 (finishing) -> US-040 -> US-041a -> voxel props in `world_m1` + owner walk-check -> BUG-OWN-003 (slim, if still needed) -> US-018. Voxel prop art (ART-OWN-001) runs in parallel with US-040.
- **P1 (after all P0):** light the summit beacon (US-022, D-003).

**P2 stretch (not exit criteria):** dust motes (US-019), procedural WebAudio (US-020, D-004), wall scrawl (US-021), see-through grate (US-023).

**Out**
- Walking on terrain, combat, enemies, inventory, dialogue, NPCs, saving UI, audio asset files, editor UI.
- Voxel creatures and walk/idle clips (US-041b, before M3), the 7.7 billboard `outline` option, directional billboard views.

**Exit criteria:** PO OK + tester PASS on every P0 story; a stranger finishes the slice without instructions and without taking the lantern; `tools/check-deps.mjs` reports no engine -> game/design imports.

## Milestone 1.5 – "Editor Preview" (D-010) — status: planned (starts when M1 exit criteria are met)
Level viewer + object placer in `tools/editor/`, a second client of `engine/index.js`.
- **In:** load world, fly-cam, idle re-render skip; pick/select/move/yaw/delete; place props (existing models), lights (presets), triggers/hint zones; property panel (JSON components, behaviour-name dropdown); undo/redo; save/load world JSON (File System Access API + download fallback); Play-test in the game via `?world=` (world-file loading half of US-027).
- **Out:** terrain paint, structure/sector editing, model editing, multi-viewport, prefabs, CPU fallback, visual scripting, asset store.
- **Depends on:** US-025 (serialize, handles, renderVersion), US-030 (GPU grid, planeId picking, sprite pass), US-011, US-006/007, US-014/015.
- Stories (PO to write): US-031..US-034.

**Story (D-011 amendment 2, D-013):** fantasy canon with steampunk machine accents. Wick, a young man from machine-only Ferrum (no amnesia), is shot down in the stolen balloon *Kestrel* and holds a Crown sky-chart with his pencil course to the SOS (3 short, 3 long, 3 short). M1 is a text and art reskin only (lamp, wreckage, relay, signal tower). The only scope change is the US-015 map card (static overlay, `M` re-opens it).

## Milestone 2 – "Out of the Wreck" — status: planned
Step out of the breach onto real terrain: terrain caster near LOD + slope physics + chunk regeneration (US-026), JSON content packs (US-027; world-file loading moved to M1.5), day/night sun cycle, first melee enemy (Hush-touched beast), sword + lock-on, a hidden chest, the relay tower as save point. **Release prep (D-012):** settings menu (grid, sensitivity, invert Y, volume, fullscreen + pointer lock, pause on focus loss), saves via a `game/js/platform/` adapter with a versioned save format. **itch.io browser demo** (M1+M2 slice) at the end of M2. Architect may evaluate Rust/WASM for measured hot spots only (terrain bake, pathfinding; D-015).
- **Object physics epic, part 1 (D-018, owner-required before release):** in-house compound-sphere rigid bodies in `engine/physics/rigid.js`. US-051a (bodies + world contacts + sleep), then US-051b (body-body contacts, stacks <= 3, player contacts), then US-052 (pick up / carry / throw). US-053 particles (smoke, dust, sparks, splash; folds in US-019) can run in parallel. Gate: if US-051a misses the 10-body settle test after one fix round, a Rapier spike becomes its own story.

## Milestone 3 – "The Relay Line" — status: planned
Open region along the map route with 3 dead relays to wake (each a placed structure), an exile village with 3–5 NPCs and dialogue, the artificer's gauntlet + Spark (first magic), second enemy (clockwork sentinel), ranged tool (bow or crossbow), terrain overrides authored as data. Exile village working name "Outwall" (D-013, final name decided here). Steam "Coming Soon" page for wishlists once M3 is playable (D-012).
- **Object physics epic, part 2 (D-018):** US-054 cuttable tree that breaks into a log and branches as physics pieces (after US-051/052, the M2 sword and US-041 voxel), and US-055 water surface + splash + floating props (after US-051, US-053, US-026). The whole epic US-051..055 must be done before the M6 release.

## Milestone 4 – "The Signal Source" — status: planned
First dungeon = the signal's source (an ancient ruin with pressure doors and gear puzzles): keys, light puzzles (mirrors, shadow, aether), a boss, reward = first gauntlet crystal. The city of Ferrum stays out until after M6.

## Milestone 5 – "Engine Editor v0" — status: planned
`tools/` editor built on `engine/index.js`, extending the M1.5 editor: terrain paint/stamp, structure placement, live preview, JSON save/load. **ASCII model + animation editor** (D-010, `tools/model-editor/`): per-direction glyph/fg frames, named animations (fps/durations, loop, frame `events`), onion skin, live preview via the real animation player, save ModelDef JSON to `design/models/`. Out: rigs/tweening, image import, auto-LOD, visual scripting, asset store. Depends on US-027 + US-011. Stories US-035..US-037. Engine published as a standalone package.
- **Future engine capability (D-014, earliest here, post-M1):** 2D/2.5D strategy camera (ortho/iso projection over sectors + heightmap; first user = the editor's top-down map). Until then the architect keeps the renderer camera-agnostic by review rule (`CameraPose` + `projection` descriptor), no implementation cost.

## Milestone 6 – "Polish & Release" — status: planned
Performance pass, accessibility (font size, colorblind palettes), gamepad (Steam Deck), static web release, **Steam release (D-012)**: Electron wrapper in `desktop/` (Tauri rejected: WebKit WebGL2 risk on Linux/Deck), `steamworks.js` (achievements, Steam Cloud saves, overlay) behind the platform adapter, store assets rendered in-engine (ASCII key art, capsules, screenshots, trailer), store text by the writer, $100 Steam Direct fee. Order: itch.io demo (M2) -> Steam Coming Soon (M3) -> launch (end of M6).

## Tech policy notes
- **Rust/WASM (D-015):** only for bench-measured hot spots after a JS pass (terrain bake, pathfinding); prebuilt `.wasm` committed, source in `tools/wasm/`, JS kept as oracle/fallback. Engine stays JS + GLSL.
- **Rapier (D-015):** architect evaluates `@dimforge/rapier3d-compat` (vendored, no bundler) when US-013 comes up; adopt only if fixed-timestep, deterministic enough for saves, and queries still go through `World`. **Decided for object physics in D-018:** in-house rigid bodies. Rapier only becomes a spike story if US-051a fails its settle gate. Three.js only if arbitrary meshes are needed.
