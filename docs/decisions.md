# ASCII Quest – Architecture & Design Decision Records

Numbered, append-only. Newest at the bottom. Format: Title / Date / Context / Options / Decision / Consequences.

---

## D-001 Awakening location: the Hollow Watchtower ("The Sunken Beacon")

**Date:** 2026-09-22
**Status:** Accepted

### Context
Round 1 kick-off. We need the first place the player wakes up. It must set tone and the world hook, be small enough to be the entire first vertical slice, show off the ASCII 3D look (dynamic lighting, physics), teach move / look / jump / interact, and open naturally into the overworld.

### Options considered
1. **Shrine / crypt under the earth (BotW-style Shrine of Resurrection).** Pro: strong "who am I" hook, fully enclosed = tiny render load, torchlight looks great. Con: pure interior; sun/outdoor shading and the "open world" promise are not shown until the very end; heavily derivative.
2. **Village house / bedroom (OoT/LttP-style).** Pro: warm, safe, immediate NPCs. Con: NPCs, dialogue, and a village are big scope; a flat room with a bed shows almost nothing of 3D lighting or physics; low drama.
3. **Beach / shipwreck (Wind Waker / Link's Awakening).** Pro: iconic, outdoors from frame one. Con: water rendering and a wide-open horizon are the hardest things to do well in ASCII; no natural "contained tutorial" walls; performance risk on frame one.
4. **Hollow ruined watchtower on a hilltop.** The player wakes on a stone floor at the bottom of a crumbled, roofless round tower. A fire-pit/torch lights the interior; sunlight falls in a shaft through the broken roof and gaps in the wall. A collapsed spiral stair climbs the inner wall; the final gap requires a jump. At the top the wall is breached and the whole overworld is visible below: the tower is a "beacon" that has gone dark. Pro: combines the enclosed tutorial of (1) with the outdoor payoff of (3), in one small space (~12x12 cell footprint, 3 floors). Torch (warm point light) + sun shaft (cool directional) in one shot is the best possible demo of our lighting model. Rubble, a rolling boulder/barrel, and stair gaps show physics. Vertical layout teaches jump organically. The dark beacon is the world hook: "the beacons are out, relight them." Con: needs a heightmap/multi-level interior (more than a flat room), and the summit reveal needs an LOD'd far view.

### Decision
**Option 4: the player awakens at the bottom of the Hollow Watchtower** (working name "The Sunken Beacon"), a roofless ruined stone tower on a hill at the edge of the world. Interior is torch-lit, pierced by a sun shaft; a broken spiral stair leads up; a breach at the top opens onto the overworld view and a descending path outside.

### Rationale
- Best tone/hook per unit of scope: solitude, ruin, a dead beacon, and one clear question ("why is the light out?") without a single line of dialogue.
- One scene demonstrates every technical pillar we are selling: ASCII 3D, two lighting types (warm point light + cool directional sun with shadow), physics (gravity, jump, rubble, a rolling object), verticality.
- Controls are taught by geometry, not text: walk to torch (move), look up at the sun shaft (look), climb stairs and jump the gap (jump), pull the lever / pick up the lantern (interact).
- The exit is the reward: the first view of the open world is earned by climbing, and the slice ends the moment the player steps out. Clean cut for Milestone 1.

### Consequences
- The world engine must support multi-level interiors from day one (not just a flat outdoor heightmap). This constrains D-002.
- The summit view requires a cheap far-distance overworld render (fog/LOD) even in Milestone 1; it may be a static-ish low-detail heightmap.
- No NPCs, dialogue, combat, or inventory in Milestone 1. The lantern is the only pickup and is purely a light source.
- Story canon fixed: the world has beacons; ours is dark; the player is its (forgotten) keeper. PO owns the details.

---

## D-002 Rendering approach for Milestone 1: column-raycast walls + per-column floor/ceiling casting, glyph density shading on a single canvas

**Date:** 2026-09-22
**Status:** Accepted

### Context
D-001 requires an enclosed multi-level interior with a point light, a directional sun shaft, and a far outdoor view. We must hit 60 fps in a browser with no build step, drawing a grid of colored glyphs.

### Options considered
1. **Wolfenstein-style grid raycaster** (one ray per screen column, walls only, flat floor/ceiling). Pro: trivial, fast. Con: no verticality, no stairs, no roof holes; cannot do the tower.
2. **Heightmap / voxel-column projection (Comanche-style)**. Pro: great for outdoor terrain, cheap. Con: poor for interiors with overhangs and multi-level floors; walls look like terraces.
3. **Full software rasterizer (triangles, z-buffer) into the char grid.** Pro: fully general, any geometry, correct lighting per cell. Con: most code, most risk; at ~160x60 cells it is actually cheap per-pixel, but the pipeline (clipping, z-buffer, meshes) is large for round 1.
4. **Hybrid: tile/grid raycaster with variable wall heights + per-row floor/ceiling casting per level, plus sector-based multi-floor ("Doom-lite" sectors).** Pro: enough verticality for stairs, ledges and a roofless tower; per-column cost is O(depth) so 160x60 at 60 fps is easy; lighting is computed per hit-point (distance to torch, sun-shaft test) and mapped to a glyph density ramp. Con: no true look-up/down (use y-shearing), no arbitrary meshes; entities are billboards.

### Decision
**Option 4 for Milestone 1**: a sector-based raycaster (Doom-lite) with per-sector floor and ceiling heights, y-shear for look up/down, billboard sprites for the player-visible props, and a separate cheap heightmap-projection pass for the far overworld seen through the breach. All output goes to one `<canvas>` as a grid of (glyph, fg, bg) cells; brightness -> glyph ramp (` .:-=+*#%@`), hue from light color. Lighting = ambient + sun (directional, with a shadow test against the roof-hole polygon) + N point lights (torch, carried lantern) with distance falloff and flicker.

Revisit for Milestone 3 (open world): expect to add or switch to heightmap projection outdoors; the char-grid renderer interface (`RenderTarget.setCell(x,y,glyph,fg,bg)`) is kept stable so the back-end can be swapped.

### Consequences
- Level data = 2D grid of sectors (floor height, ceiling height, wall/floor/ceiling material, light id). Designer authors tilesets/materials; Programmer authors the tower grid from the PO/Designer layout.
- Physics is 2.5D: capsule on XY, height on Z per sector, step-up threshold for stairs, gravity, jump. Rolling boulder = sphere on the same model.
- Target grid: 160x60 cells (adjust to window), fixed 60 Hz sim, render decoupled.
- Known limits accepted: no arched geometry (arches are faked with sector height steps), no true 6DOF look.

---

## D-003 US-022 "Light the summit beacon" is IN Milestone 1 as P1 (optional final beat)

**Date:** 2026-09-22
**Status:** Accepted (amends D-001 consequence "the lantern is purely a light source")

### Context
The PO's GDD makes "relight the beacons" the core loop. D-001 left the summit bowl cold so the slice ends on a question. PO proposes US-022: at the bowl, `[E] Light the beacon` with the carried lantern starts a large fire. Cost: one more point light + one large fire animation.

### Options
(a) Keep it cold (D-001 as written). Cheapest; ending is a pure question, but the player never performs the game's core verb.
(b) Add to M1 as P1, after all P0 stories (PO recommendation). Small cost: the point-light system already supports 4 lights and the brazier already needs a fire animation; the beacon fire is the same asset scaled up.
(c) Opening beat of M2. Defers cost, but M2 then opens with a backtrack up the tower, and M1 never demonstrates the loop.

### Decision
**(b).** US-022 is in M1 as **P1**, built only after every P0 story is `done`. Constraints:
- Lighting the beacon is **optional**; the breach end trigger works either way. The lantern is not consumed (light is shared, the player keeps it).
- End text varies: unlit = `The beacons are dark.`; lit = `One beacon burns. The others are dark.` then `The world waits.` (US-017 gets this small extension).
- Beacon fire art = brazier flame frames scaled to the 12x4 bowl (Designer reuses US-011 frames; no new design story).
- Beacon light: radius 12 m, warm, but it must pass the US-018 budget at the summit view; if it costs the 60 fps target, cut the radius before cutting the feature.
- The distant tower stays dark after lighting (the hook survives).

### Consequences
- Backlog: US-022 status `todo`, P1, dependencies US-011, US-012, US-017. Roadmap M1 "In" list updated; M1 exit criteria unchanged (P0 only).
- D-001 consequence "no pickups beyond the lantern, purely a light source" is amended: the lantern also lights the beacon.

---

## D-004 Sound is P2 in Milestone 1, procedural only, never an exit criterion

**Date:** 2026-09-22
**Status:** Accepted

### Context
Roadmap said sound is "out / nice-to-have if trivial". PO filed US-020 (brazier, footsteps, boulder, lever, grate, wind) as P2 after all P0.

### Options
(a) Keep out of M1 entirely. (b) Confirm P2 after P0, with a scope cap. (c) Raise to P1.

### Decision
**(b), confirmed with a cap:** US-020 stays P2, picked up only when every P0 is `done` and US-022 (P1) is done or explicitly deferred. Scope cap: WebAudio procedural synthesis only (noise-based crackle, wind, clicks), **no audio asset files** in M1, one story of effort; if it grows, cut sounds rather than extend. M key mute required. Sound is not an M1 exit criterion and testers do not fail M1 on audio.

### Consequences
- Roadmap M1 wording changed from "Out" to "P2 stretch, not exit criterion".
- `game/assets/audio/` is not created in M1.

### Manager notes on PO gap-fills (no separate ADR)
- Lever raises an iron grate (portcullis) on the upper stair: **agreed**; it is the single mechanism D-001 asked for and animating a sector ceiling is cheap.
- Lantern as a *soft* gate for the gap (stairs readable without it): **agreed**, and I want it enforced in testing: the slice must be completable without ever taking the lantern.
- Boulder rolls down a slope into the NW hollow at -0.3 m: **agreed**. Flag: with radius 0.6 m the boulder is a *hard* gate at the stair base (jump apex 1.05 m). Acceptable because a walk-into push clears it, but US-013 must guarantee it can never come to rest somewhere that blocks the stair or the wake area again (the hollow must be the only stable resting place, and restart resets it).
- Minor disagreement: US-012 "lantern cannot be dropped" plus US-022 must not read as "lantern consumed" - the player keeps it (fixed in D-003).

---

## D-005 RenderTarget back-end: WebGL2 fullscreen cell-shader, Canvas2D with capped backing resolution as fallback

**Date:** 2026-09-22
**Status:** Accepted (refines D-002 "single canvas" - the canvas stays, the context changes)

### Context
US-001 is blocked on the 8 ms / 58 fps budget for a full 160x60 redraw. Canvas2D v1 (fillText per cell) was ~110 ms; v2 (JS per-pixel compositing + one putImageData) measured 21-31 ms in the only environment agents can measure in; drawImage tile caches (v3) were pathological there. v2's cost is proportional to device pixels (~4.6 M at 1440x900 @2x), not to cells, so it is structurally expensive on real hardware too. Agents cannot measure reliably, so a design that is fast *by construction* is worth more than one that is tuned by measurement.

### Options
- **(A) Cap backing resolution, CSS-upscale.** Bounds v2's cost (e.g. 160x60 cells at 8x16 px = 1.2 M px, ~5-8 ms) but stays on the JS-per-pixel path, is blurry at 2x DPR, and will compete for the same main-thread budget as the raycaster and lighting.
- **(B) WebGL2 back-end behind the unchanged RenderTarget API.** Per frame: upload ~77 KB of cell data (160x60 x glyph index + fg + bg) as two tiny textures and draw one fullscreen quad; the fragment shader resolves cell -> atlas texel -> mix(bg, fg, alpha). GPU cost is trivial at any resolution, CPU cost is one texSubImage2D + one drawArrays. Crisp at any DPR. Risk: WebGL2 unavailable (rare in 2026 Chrome/Firefox/Safari) or software-rendered.
- **(C) Keep Canvas2D v2 and accept.** Fails the budget before a single wall is drawn. Rejected.

### Decision
**(B) WebGL2 fullscreen cell-shader is the primary back-end; (A) is the fallback.** The `RenderTarget` public API (`setCell`, `clear`, `present`, `cols`, `rows`, resize behaviour) does not change; the raycaster and UI never know which back-end is active.

Direction to the programmer (US-001 rework #2):
1. Store cells in typed arrays, not string arrays: `glyphIdx: Uint8Array(cols*rows)` (ASCII code - 32, 0 = space), `fg: Uint8Array(cols*rows*4)`, `bg: Uint8Array(cols*rows*4)`. `setCell` keeps accepting hex strings but resolves them through the existing color cache into bytes. Add `setCellRGB(x, y, glyphIdx, r,g,b, r2,g2,b2)` as an allocation-free fast path for the raycaster (US-004 should use it).
2. Textures: `uCells` RGBA8 160x60 = (glyphIdx, 0,0,0) or pack glyph into the alpha of the fg texture: `uFg` RGBA8 (r,g,b, glyphIdx), `uBg` RGBA8 (r,g,b, 255). Two `texSubImage2D` calls per frame, NEAREST filtering.
3. Glyph atlas: on resize, render printable ASCII 32..126 once into an offscreen Canvas2D at the current device-pixel cell size (metrics-based sizing from rework #1 is kept), upload as an R8/alpha texture strip (95 x 1 cells), LINEAR filtering. Rebuild only on resize/DPR change.
4. Fragment shader: `cell = floor(vUv * gridSize)`, fetch fg/bg/glyph, `atlasUv = ((glyphIdx + fract(vUv.x*cols)) / 95, fract(vUv.y*rows))`, `color = mix(bg, fg, a)`. One `drawArrays(TRIANGLES, 0, 3)` fullscreen triangle. No per-frame allocations, no state changes beyond the two uploads.
5. Fallback: if `canvas.getContext('webgl2')` returns null or context creation fails, instantiate the Canvas2D v2 path with the backing cell size capped at **pxCellH <= 16 device px** (CSS upscales the canvas; accept softness). Log which back-end is active on the F3 overlay (`gl2` / `c2d-capped`). Handle `webglcontextlost`/`restored` by rebuilding textures.
6. Bench acceptance: `?bench=1` stays. Because agents cannot measure real hardware, US-001 passes on **structural** grounds (one draw call, <= 80 KB upload/frame, zero per-frame allocations, verified by reading the code) plus the user's real-Chrome `?bench=1` numbers when available; the PO records them in US-001. The 8 ms budget remains binding for US-004/US-018 measurements.
7. Keep the Canvas2D v2 file as `RenderTargetCanvas2D.js`; new file `RenderTargetGL.js`; `RenderTarget.js` becomes the factory that picks one. Do not delete the perf history comment - move it to the Canvas2D file.

### Consequences
- The rendering budget is now spent where it belongs: raycasting + lighting in JS (US-004..007), presentation on the GPU.
- Any future "post effects" (fade to black in US-017, glyph dimming, vignette) can be done in the shader for free, but are not required to be.
- Fallback users on non-WebGL2 browsers get a softer image; that is accepted for M1.
- Shader code lives in JS template strings (no build step, no external libraries).

---

## D-006 Engine / game split: `engine/` is a standalone, data-driven library; `game/` and `design/` are the product built on it

**Date:** 2026-09-22
**Status:** Accepted

### Context
User direction: the engine must become a reusable product with its own UI (editor, asset tools) later. Today everything is under `game/js/`, and the renderer/raycaster read `window.ASSETS.palette` globals set by classic scripts in `design/`.

### Options
1. Keep one tree, tag engine files by convention. Cheap now, rots immediately; no enforceable boundary.
2. Separate top-level `engine/` package with an explicit public API, dependency injection for all data, game and content on top. One move story now, clean forever.
3. Full monorepo/package tooling (npm workspaces, bundler). Violates "no build step".

### Decision
**Option 2.** Layout (ES modules everywhere; no build step; served statically):

```
engine/                      # reusable library. NEVER imports from game/, design/, tools/
  index.js                   # the only public entry: re-exports the API below
  core/     loop.js input.js events.js assets.js (AssetRegistry: palette, models, levels, terrain recipes)
  render/   RenderTarget*.js CellBuffer.js glyphMetrics.js DepthBuffer.js sectorCaster.js terrainCaster.js sprites.js compositor.js textDraw.js
  world/    Level.js (sector grid) Terrain.js (heightmap sampler + chunks) World.js (terrain + placed structures + entities) serialize.js
  physics/  config.js capsule.js sphere.js terrainCollide.js integrate.js
  entities/ Entity.js (plain-data entities, id/type/transform/components) Camera.js
  ui/       debugOverlay.js overlay primitives (hints, prompts, fades) - engine-level, skinnable
game/                        # ASCII Quest, the product
  index.html world-test.html
  js/main.js                 # bootstrap: builds AssetRegistry from design/, creates engine, runs the quest
  js/quest/  (wake sequence, interactions: lantern/lever/beacon, end trigger, hints, story text)
design/                      # content pack: palette, models, levels, terrain recipes, previews (unchanged owner: designer)
tools/                       # future editor UI (level/terrain/prop editors). Not built in M1/M2; layout reserved.
docs/
```

Rules:
1. **Dependency direction:** `game/ -> engine/`, `game/ -> design/` (as data), `tools/ -> engine/`. `engine/` imports nothing outside itself. Enforced by `tools/check-deps.mjs` (a 30-line Node script that greps import paths; run manually / by the tester, not a build step).
2. **No globals in the engine.** The engine never reads `window.ASSETS`. `game/js/main.js` reads the classic-script globals from `design/` and passes them into `new AssetRegistry({ palette, models, levels, terrain })`. Later, the editor loads the same shapes from JSON files. `design/*.js` stay classic scripts for now (previews depend on them); a JSON export is an M2+ tool.
3. **Engine defines interfaces, content implements them.** The engine documents the shape of a palette (`ramps`, `materials`, `lights`, `util.shade/shadeSky`), a model (frames, anchor, emissive cells), a level (MAP_FORMAT v2), a terrain recipe (`heightAt`, type rules). `design/` supplies instances. Type shapes live as JSDoc typedefs in `engine/core/assets.js`.
4. **Everything the editor will need to touch is plain data.** Levels, placed structures, props, lights, interactables, triggers, entity spawns and terrain overrides are declared in level/world data (JSON-serializable objects), not constructed in code. Game code registers *behaviours* by name (`registerInteraction('lantern.take', fn)`); data references them by name. `engine/world/serialize.js` round-trips world + entity state to JSON (needed for the editor and for save games).
5. **Public API** (`engine/index.js`): `createEngine({canvas, assets, cols, rows})` returning `{ renderTarget, world, input, loop, camera, events }`; `World.load(worldDef)`, `World.placeStructure(levelDef, origin)`, `World.floorAt/sectorAt/heightAt`; render passes `castSectors`, `castTerrain`, `drawSprites`, `drawText`; physics `moveCapsule`, `moveSphere`, `integrate`; `Entity`, `Camera`; `serialize/deserialize`. Anything not exported from `engine/index.js` is private.
6. **Timing:** the physical move is one story (US-024), executed **after** US-004 and US-008 reach `po-review` and **before** US-006 starts. New files created from now on go straight to the new paths.

### Consequences
- One-time import-path churn (US-024). Programmers must not start new engine work under `game/js/` after D-006.
- The designer's reference shader (`palette.util.shade`) remains the shading oracle; the engine consumes it through the injected palette.
- The editor (tools/) becomes possible without engine changes: it is a second client of `engine/index.js`.

---

## D-007 Open world architecture: hybrid renderer (sector caster for structures + heightmap terrain caster), one world frame, deterministic chunked terrain

**Date:** 2026-09-22
**Status:** Accepted (extends D-002; D-002's "separate far pass" becomes the coarse LOD of a first-class terrain renderer)

### Context
The game is open-world. D-002 chose a Doom-lite sector raycaster with a cheap far heightmap view. US-004 (sector caster) and US-008 (capsule physics vs sectors) are in flight; the designer's US-016 terrain recipe (seeded analytic noise, 256x256 at 8 m) exists.

### Options
- **(i) Hybrid, both first-class:** sector caster renders "structures" (tower, houses, dungeons: sector grids placed in the world); a per-column heightmap caster renders terrain; the two composite through a shared per-cell depth buffer. Physics queries one `World` that answers from the structure if inside a footprint, else from terrain.
- **(ii) Unified ray-marched terrain with sector interiors embedded.** One algorithm, but ray-marching a heightfield per cell in JS at 160x60 with interiors is slower and would discard US-004.
- **(iii) Full software rasterizer with meshes.** Most general, most code, no reuse of anything built.

### Decision
**(i) Hybrid.** Both passes are per-column algorithms writing (row, depth) into a shared `DepthBuffer` (Float32Array cols*rows) and a per-column open vertical span, so compositing is natural and cheap.

World model:
- **One world frame** in meters: x east, y south, z up (same as MAP_FORMAT v2 and the designer's recipe). The camera and all entities live in world coordinates.
- **Terrain** = deterministic recipe (seed + analytic noise, the US-016 recipe generalised) providing `heightAt(x,y)` and `typeAt(x,y)`, plus optional authored overrides (per-chunk JSON deltas: height stamps, type paints) for the editor. Evaluated at **2 m cells near** (within ~300 m, with distance-scaled step LOD) and **8 m cells far** (300-1500 m, the existing US-016 grid). Same function, two sample densities: no seam.
- **Chunks** 64x64 near-cells (128 m). Keep 3x3 resident around the player; generation is deterministic and a few ms, so "streaming" is regeneration, no IO. Far grid is baked once at load (65k cells).
- **Structures** = existing sector levels (1 m cells) placed with `World.placeStructure(levelDef, {x, y, z, yawSteps})`. Inside a structure footprint the structure owns floor/ceiling/collision and terrain is not drawn; the structure's outer ring cells define the ground blend (the tower's 2.4 m grass ring already matches the recipe's hilltop). The Hollow Watchtower is placed at recipe coordinates (1480, 1018).
- **Physics on terrain:** `World.floorAt(x,y)` returns bilinear terrain height outside structures; walkable slope limit 50 degrees (steeper = slide), same capsule and sphere code (`terrainCollide.js` adds the slope test). Boulder and player share it.
- **Lighting on terrain:** ambient + sun N dot L from height-grid normals; point lights apply within radius; no terrain shadow rays in M1/M2. Sector-caster sun shadow test is unchanged.
- **Budget (8 ms JS):** sectors 2-3 ms, terrain 2-3 ms, sprites 1 ms, UI < 0.5 ms. Present is 0.1 ms (D-005). Measured in US-018.
- **ASCII grid constraint:** 160 rays means a 2 m cell subtends less than a column beyond ~150 m; the step-LOD handles it, and the designer's glyph bands (near/mid/far) already encode that.

### Consequences
- US-016 is implemented as `engine/render/terrainCaster.js` at far LOD writing through the `DepthBuffer`, not as a one-off background pass. Near LOD + walking on terrain is the first M2 story.
- US-004 must write depths and treat out-of-level rays as open (see D-008).
- Level.js stays as the structure format; `World.js` is new (US-025).
- Interiors with multiple structures, caves and dungeons are just more placed structures; no renderer change.

---

## D-008 In-flight work and Milestone 1 scope after D-006/D-007

**Date:** 2026-09-22
**Status:** Accepted

### Decision
M1 content is **unchanged** (wake in the tower, climb, breach, see the world, step out, optional beacon). M1 is now built on the open-world-capable engine: the tower is a placed structure in a world, the far view is the terrain caster at far LOD. M1 exit criteria unchanged (all P0 done). New engine plumbing is P0 because everything after depends on it.

In-flight work:
- **US-004 (sector caster) - continue as-is, plus three small additions** to its acceptance criteria: (1) write per-cell depth into a shared `DepthBuffer` (Float32Array cols*rows, meters) alongside `setCellRGB`; (2) when a ray leaves the level grid, do **not** paint void/sky: leave the remaining open span for the next pass (expose per-column `[topRow, bottomRow, depth]` of the unresolved span); (3) accept an optional level origin offset `{x,y,z}` in the camera/level call so the same code works when the level is placed in the world. No move of files yet.
- **US-008 (physics) - continue as-is**, with one change: all "is this cell passable / what is the floor here" answers must come from the passed-in `level`/`world` object (`sectorAt`, `floorAt`), never from a hardcoded "outside the grid = wall" branch. Make `isSectorPassable(null)` a query on the world (`world.outsideSector()` or equivalent) so terrain can later stand in for out-of-grid cells. No move of files yet.
- **US-016 (designer) - delivered 2026-09-22 and accepted by the manager as the seed of the world terrain system; release it to the PO as-is.** It already matches D-007: same world axes, tower at (1480, 1018), hilltop 2.4 m matching the level's grass ring, seeded analytic recipe, per-column projection sharing the sector horizon, drawn only where the sector pass leaves the column open, 4 ms budget. The recipe is promoted to the **world terrain recipe**. Follow-up **US-016b (design, P0, small)** rather than rework: (a) confirm `heightAt(x,y)`/`typeAt(x,y)` are continuous analytic functions usable at any sample spacing (2 m near, 8 m far), (b) near-LOD look spec for 2 m cells within 300 m (the existing near glyph bands are the start), (c) flat 2.4 m crown radius covering tower footprint + outcrop, and the **handover rule**: within 6 m of a structure's outer ring the terrain height blends linearly to the ring height, so the current 1.8 m mismatch becomes exactly 0 where the player can stand (needed by US-025/US-026, cosmetic for M1's far view), (d) one-paragraph sketch of per-chunk overrides (height stamp, type paint) for the future editor. The programmer side of US-016 (terrain caster far LOD through `DepthBuffer`) is unchanged.
- **US-010/011/012/014/015/017 (props, interactions, hints, end):** add one criterion each: props, lights, interactables, triggers and hint zones are declared in the tower level data (`def.props`, `def.lights`, `def.interactables`, `def.triggers`), behaviours referenced by name and registered from `game/js/quest/`.

New P0 stories for the PO (in build order, all M1):
- **US-024 Engine/game split** (after US-004 and US-008 reach po-review, before US-006): move per D-006 layout, `engine/index.js` public API, `AssetRegistry` injection replacing `window.ASSETS` reads inside the engine, `tools/check-deps.mjs`, both HTML pages still work, `?bench=1`/`?glyphs=1`/`?shadetest=1` still work.
- **US-025 World model**: `World.js` (terrain sampler from recipe, `placeStructure`, `floorAt/sectorAt/heightAt` in world coords, chunk cache 3x3), tower placed at recipe coordinates, player and camera in world coordinates, `serialize.js` round-trip of world + entity state.
- **US-016 (rewrite as engine story)**: terrain caster far LOD through `DepthBuffer` + compositor with the sector caster; acceptance from the current US-016 stays.
- **US-026 (M2, first story)**: terrain caster near LOD, walking on terrain with slope limit, chunk regeneration on movement, step out of the breach without a fade.
- **US-027 (M2)**: JSON export of `design/` content packs + world file loading from JSON (editor prerequisite).

### Consequences
- Roadmap M1 gains US-024/US-025 and reframes US-016; M2 becomes "step out onto the terrain". Budget risk: two extra P0 stories in M1, accepted because they are prerequisites, not features.
- *ID note (PO, 2026-09-22):* story IDs were renumbered to avoid a clash with the existing US-023 (see-through grate, P2). Engine/game split = **US-024**, World model = **US-025**, M2 near-LOD terrain = **US-026**, M2 JSON content packs = **US-027**. References in D-006 to D-008 and in the roadmap have been updated.

---

## D-009 Renderer compute location: full GPU per-cell pipeline (staged), JS path as oracle and fallback

**Date:** 2026-09-23
**Owner approval:** confirmed by the owner on 2026-09-23 ("lets go with the recommended option b gpu").
**Status:** Accepted (extends D-005: the GPU now computes cells, not only presents them; D-007 hybrid world model unchanged)

### Context
Owner feedback: the image looks flat / low-detail, shimmers ("lines jumping") when moving, and a bigger grid is wanted. Constraints: stays a browser game, stays an ASCII character grid. Architect input in `docs/architecture.md` section 14: under the CPU path, sectors + lighting + terrain already reach the 8 ms JS wall at 160x60, and the only real shimmer fix (N rays per cell with coverage vote) is unaffordable in JS.

### Options
- **(A) CPU + optimisations.** 0-1 stories. Grid stuck at 160x60, shimmer only masked (hysteresis), every later feature is a budget fight.
- **(B) Full GPU per-cell (DDA, shade, edge, lighting, terrain, sprites in GLSL), staged.** ~3 extra M1 engine stories; frees ~5-6 ms JS; 240x90 trivial; real shimmer fix. Risks: GLSL debugging, float32 edge mismatches, two implementations of the rules, ~2-3 % users without WebGL2.
- **(C) Hybrid (CPU casters, GPU shade/edge).** 3 stories, only ~0.9 ms freed, grid ~180x68, no shimmer fix; same two-implementation cost for a fraction of the gain.

### Decision
**(B), staged, with C as stage 1 and a hard parity gate.**

1. **Order (M1):** US-029 (GPU pipeline + data textures + G-buffer upload + shade/edge port + `?gpucompare=1`) -> US-030 (GLSL sector DDA multi-structure + spans, N-ray coverage anti-shimmer, GPU sprite pass) -> US-006 lighting in GLSL (JS reference kept, unbudgeted) -> US-007 -> US-016 terrain GPU-first. Lighting goes after US-030 so it is written once against the final pipeline.
2. **Gate / kill switch:** US-029 must pass `?gpucompare=1` (glyph match >= 99 % excluding kind-boundary cells, fg/bg +-4, depth 1 %) **and** run on the owner's real hardware. If it fails and cannot be fixed within one rework, fall back to **A** (US-004c) and US-006/US-016 proceed on the CPU; no further GPU work in M1.
3. **Budgets:** the **8 ms JS/frame budget stays binding** (target after US-030: <= 2 ms JS). New **GPU budget: <= 4 ms** at the default grid on the owner's laptop, measured via `?bench=1` (EXT_disjoint_timer_query where available, else frame time). US-018 checks both.
4. **Grid size becomes a setting** (`createEngine({cols, rows})` + URL `?grid=WxH` + an in-game option later), allowed range 160x60 to 320x120, cell aspect preserved. **Default 160x60 until US-030 is `done`, then 240x90 on the `gl2` GPU path.** Design art (models, UI, text) must stay readable at both; the designer checks the previews at 240x90.
   - **Owner amendment (2026-09-23):** the owner chose **320x120 as the GPU-path default** after US-030 (was 240x90). 240x90 stays as a selectable step-back if the owner walk-test finds glyphs too small. Budgets and designer checks move to 320x120. The CPU fallback stays 160x60.
5. **Fallback policy:** no WebGL2, context-creation failure, or a software renderer (`UNMASKED_RENDERER` contains SwiftShader/llvmpipe/Basic Render) -> JS path + existing Canvas2D-capped/GL presenter, **grid forced to 160x60**, coverage anti-shimmer off, lighting via the JS reference at reduced light count. Fallback must be playable end-to-end (M1 exit), not visually equal. `?gpu=0` forces it for testing; F3 overlay shows `gpu` / `cpu`.
6. **The JS path is the oracle**: every GLSL pass ships with a parity test against it; `shadetest`, `bench-cast` and designer oracles stay headless in Node. No headless-browser CI in M1 (would be a separate decision).

### Consequences
- M1 grows by ~3 engine stories (US-029, US-030; US-006/US-016 are rewritten, not added). Accepted: writing lighting and terrain for the CPU first and porting later would cost more.
- US-006 and US-016 are blocked on US-030 `done` (or on the gate failing -> plan A).
- US-011 sprites draw through the US-030 GPU pass (JS `sprites.js` stays as reference/fallback).
- Public API unchanged (`renderWorld` picks the pipeline); engine remains data-driven for the M5 editor.

---

## D-010 Editors: "M1.5 Editor Preview" (level viewer + object placer) after M1; ASCII model + animation editor in M5

**Date:** 2026-09-23
**Owner request:** "yes, i want all": (1) a model + animation editor ("create a person graphic, make the animation, use it as an object in JS"), (2) an early small editor right after M1.
**Status:** Accepted (extends D-006 rule 4 and architecture.md section 10 / 10.1; amends roadmap M1.5, M5)

### Context
D-006 made everything the editor touches plain data; architecture.md 10 lists the extension points (explicit `CameraPose`, `renderVersion` idle skip, picking via 1-cell `readPixels` of the planeId target, `serialize/deserialize`, entity handles). M1 is not finished; M2 already carries near-LOD terrain, slope physics, JSON content packs, first enemy, sword and save point.

### Options (where item 2 goes)
1. **Fold into M2.** No extra milestone, but M2 is already the heaviest milestone (new terrain LOD + combat); editor bugs and M2 feature bugs would block each other, and M2 content could not be authored with the tool.
2. **New M1.5 "Editor Preview" between M1 and M2.** Small (4 stories), uses only what M1 delivers, one world (the tower) to test against. Proves the D-006 extension points on real data before M2 builds more on them; if serialize/handles/picking are wrong we learn it with 1 structure, not 4. M2 content (chest, enemy spawn, save point) is then placed with the tool, not hand-typed.
3. **Defer to M5.** Zero risk now, but the extension points stay untested for 3 milestones and all M2-M4 content is hand-authored.

### Decision
**Option 2: M1.5 "Editor Preview"**, started only when M1 exit criteria are met (never pulled into M1). The model editor stays in **M5** as part of "Engine Editor v0" (it needs the JSON content-pack format from US-027, M2, and the sprite/animation player from US-011).

**M1.5 scope (in):** `tools/editor/index.html`, a second client of `engine/index.js` (check-deps: tools -> engine only; reads `design/` data through the same AssetRegistry bootstrap as the game).
- Load the world, free fly-cam (noclip, no physics), F3 stats.
- Idle re-render skip (`renderVersion` + pose + anim time) pulled forward from M5; it is the editor's frame budget.
- Pick (GPU planeId `readPixels`; entity id channel for sprites), select, move (ground-plane drag + arrow nudge, 0.25 m snap, `floorAt` drop), yaw, delete.
- Place from a list: existing models as props, light presets, box triggers/hint zones. Property panel = generic editor over the entity's JSON components; behaviour names as a dropdown of registered names (never code entry). Light/trigger radii drawn as overlays.
- Undo/redo (snapshot of `serialize()` per operation, 50 steps; the world is small).
- Save world JSON (File System Access API `showSaveFilePicker`, download fallback; no server-side write, `python -m http.server` stays read-only) and load it back; **Play** opens `game/index.html?world=<file>` (or a sessionStorage handoff), so the world-file-loading half of US-027 moves into M1.5; content-pack export stays in M2.
- All mutations go through `world.spawn/get/remove` + `setComponent` (handles), so every edit bumps `renderVersion` and round-trips.

**M1.5 out:** terrain paint/stamp, structure/sector geometry editing, structure placement, model editing, multiple viewports, transform gizmos beyond drag+nudge, prefab system, the CPU fallback (editor requires the gl2 path; shows a clear message otherwise), visual scripting, asset store, multi-user.

**M5 model + animation editor scope (in):** `tools/model-editor/`: per-frame, per-direction (`S/E/N/W`) cell grid of glyph + fg palette key (+ emissive flag), size/anchor/world size; named animations with `fps` or `durations`, `loop`, frame `events` tags (`{ hit: 1, step: [1,3] }`, reserved names `animEnd/arrive/interact/removed` rejected); onion skin, copy/mirror frame; live preview through a real engine instance (`spawn` + `play` + `stepAnimations` + `drawSprites`, direction rotation, 160x60 and 320x120 readability check); load existing models; save ModelDef JSON to `design/models/*.json` (US-027 format, validated by `AssetRegistry.fromJSON`); a "place in world" hand-off to the level editor. **Out:** skeletal rigs/tweening, image-to-ASCII import, auto-generated LODs (hand-authored `lods.half` only), sound events, visual scripting, asset store.

**Dependencies (hard gates):**
- M1.5 needs M1 `done`, specifically: US-025 (serialize/deserialize, spawn/get/remove, handle cache, `renderVersion`), US-030 (GPU grid + planeId target for picking + GPU sprite pass), US-011 (sprites/models drawn from entity data), US-006/007 (lights as entities with presets), US-014/015 triggers as data.
- M5 model editor needs US-027 (JSON content packs, `AssetRegistry.fromJSON`) and US-011 (`events`, clips, `stepAnimations`).

### Consequences
- M2 starts ~4 stories later; accepted, M2 content authoring gets faster and the engine API is validated early.
- Any engine change the editor needs is an engine story (architect tech notes + review), not an editor hack; the goal of M1.5 is "no engine changes except the idle skip and world-file loading".
- The editor is a dev tool: tester runs it on the owner's browser (Chrome/Edge); Firefox gets the download fallback.
