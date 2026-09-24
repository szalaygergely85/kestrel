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
   - **Owner amendment 2 (2026-09-23):** after seeing 320x120 on normal screens (4-6 px cells, glyphs unreadable), the owner set the **GPU-path default to 240x90**, with the grid **changeable in an in-game settings menu** (160x60 / 240x90 / 320x120, maybe auto-by-window later). `?grid=WxH` stays as the dev override. Settings menu = new UI story (PO to write).
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

## D-011 New story canon: fantasy with steampunk machines, "Signal" (walled city, stolen balloon, crash, amnesia, map to the SOS)

**Date:** 2026-09-23
**Owner request:** "something different actually a bit steampunk ... zelda ... but fps version ... live in a city, segregated, coming sos signal ... steals a aircraft or balloon, and he shoot down, maybe only amnesia, but the map to the sos signal source." **Correction (same day):** "maybe not steampunk, fantasy... but some steampunk machines". So the world is **fantasy first**, and machines are a flavour layer.
**Owner amendment (2026-09-23): game title and hero name = "Kestrel".** The amnesiac hero reads the brass name board on the balloon's gondola ("KESTREL") and thinks it is their own name, so the player goes by Kestrel. The game title is **Kestrel** (it replaces the working title "ASCII Quest" / "ASCII Quest: Signal"). The mistaken name is a deliberate story thread for later reveals (who the hero really is). The engine name is still open (owner is considering it).
**Owner amendment 2 (2026-09-23): NO amnesia (too close to Zelda BotW).** The hero is a **young man from Ferrum** who remembers everything but is new to everything outside. The city teaches that no humans survive beyond the Wall, only the wild. He sees the SOS, steals the balloon/zeppelin *Kestrel*, is shot down, and the adventure starts. **Ferrum is a city of machines only** (brass, steam, gears; magic is a myth/forbidden). **Outside, magic is real**; he doesn't believe in it at first, and discovering it is part of the adventure and of the upgrade system. So the 'name board / borrowed name' thread from amendment 1 is **dropped**: *Kestrel* stays the airship's name and the game title, and the hero gets his own name (writer proposes). This supersedes the 'Crown keeps mages' line in the story.
**Status:** Accepted (replaces the D-001 story framing and the "Ember and Ash" canon; D-001 geometry, D-003 beat and all engine decisions stand; amends GDD 1 and 3, roadmap M2-M4 themes; `docs/story.md` superseded)

### Context
M1 content is mostly approved as geometry and art (tower layout, lantern, boulder, lever/grate, wake/title art). The engine does not care about the story. The risk is losing approved M1 work. The owner wants a new premise, not a new game: the pillars, the first-person view and the Zelda loop stay.

### Options
1. **Full rewrite, new M1 location (a crash in the city or a canyon).** Fits the premise literally, but throws away US-010 layout, lighting script and the approved wake art. It adds weeks of work and restarts design reviews.
2. **Reframe: the crash lands in the existing ruined tower.** Same geometry and beats, new meaning. Most M1 work becomes a text or art reskin. The "climb to see the world" pillar maps directly onto "climb to find where the map points".
3. **Keep Emberlands and add steampunk dressing only.** Cheapest, but it ignores the owner's city, SOS and crash story.
4. (Style axis, after the correction) **Full steampunk world** vs **fantasy with machine accents**. Full steampunk means brass everywhere, loses the approved stone, wood and moss look, and clashes with swords and magic. Fantasy with accents keeps the approved materials and makes the machines special, and rare means readable. **We chose fantasy with accents.**

### Decision
**Option 2, fantasy with machine accents.**

**Canon**
- **The world: the Emberlands** (name kept). It is a fantasy realm of hills, forests, moss-grown ruins and old magic. The steampunk layer is only the machines: they are rare, brass and copper, and hand-built by artificers.
- **The city: Ferrum**, a walled, tiered medieval city of stone and timber. It is segregated. The **Crown** (upper tiers, mages and artificer guilds) holds the magic and the machines: airships, gear-driven gates, pressure doors. The **Low Wards** (lower tiers) do the labour and are forbidden both. The **Wall Law** says nobody leaves, because outside is dead (the "Hush").
- **The signal:** a repeating SOS pulse from far outside the Wall. It is an aether light blinking on the horizon, and a hum in the city's old relay stones. The Crown denies it. Someone out there is alive.
- **The hero:** a Low Ward skyworks hand (internal name "Wick" kept; nameless on screen; never seen). They steal a small Crown patrol balloon, the *Kestrel*, and fly toward the signal. Ferrum's wall-ballistae shoot it down.
- **Partial amnesia:** the hero remembers the city and their trade (they can read gauges and work levers), but not the flight, the crash, or why they chose to go. They wake holding a **hand-inked map** with the signal source marked, a route through old relay towers, and notes in their own handwriting they don't remember writing. Why they went is the mystery that carries the story.
- **The Hollow Watchtower** becomes an **old signal relay**: a roofless, moss-grown ruined round stone tower. At the summit sits its dead relay, an aether-crystal bowl in a brass-and-mirror mount (magic plus machine). The *Kestrel* crashed through its broken roof.
- **Hook (M1):** from the summit breach you see the torn balloon envelope snagged below. Behind you, Ferrum's walled lights sit on the horizon. Ahead, in the direction of the map, a faint pulsing light on a far tower: the signal. Nothing is explained.
- **Pillars (gameplay):** first-person Zelda-like adventure. Sword first, magic second, gear and upgrades gate the map (Zelda-style tool gating).
  - **Sword:** steel swords found in ruins, then reforged at forges.
  - **Magic = Aether**, a fantasy magic of light, fed by aether crystals. It is channeled through an **artificer's gauntlet**, a machine accent. Every spell is a light verb, so pillar 1 "Light is life" stays literal: Spark (ignite, light), Gust (push, jump), Ward.
  - **Upgrades:** gauntlet crystals (new spells), heart vessels (health), sword reforging, map pieces.
  - **Core loop:** restart dead relays along the map route (this replaces "relight beacons"; the mechanics are the same).
- **Tone:** **curious, defiant, wondrous.** Warm lamplight and the odd gleam of brass against cold, vast, overgrown ruins. It is still mostly wordless in M1: the story comes from the wreckage, the map and your own handwriting. It is less melancholy and more "I broke out, now what's out here?".

**M1 impact** (scope, engine order and exit criteria are unchanged)
- **Text or art only:**
  - US-010: layout unchanged. The designer adds balloon wreckage props (gondola, torn canvas, ropes, burner) as level data.
  - US-011: the brazier becomes the *Kestrel's* smoldering burner. Same light preset.
  - US-012: the lantern becomes the **Kestrel's brass lamp**, salvaged from the gondola. New model and text.
  - US-013: boulder. No change.
  - US-014: the lever gains a brass gear housing. The grate stays iron. Reskin.
  - US-016: the far_tower billboard becomes the **signal tower** (static aether-teal emissive light in M1; the pulse is P2), and Ferrum's lights are added on the opposite horizon.
  - US-017: new end-card text.
  - US-021: the scrawl becomes an old relay-keeper's log.
  - US-022: "light the beacon" becomes **"wake the relay"** (bring the lamp to the crystal bowl). Same interaction, text and art.
- **Scope change (only one):** **US-015** gains a **map card**. It is a static ASCII map shown once after the wake-up (any key dismisses it), and `M` re-opens it. It is a UI overlay only: no inventory, no marker tracking.

**M2-M4**
- **M2 "Out of the Wreck":** terrain, sword, first enemy (wild beast or Hush-touched creature), hidden chest, the relay as save point.
- **M3 "The Relay Line":** 3 dead relays on the map route, an exile village (people cast out of Ferrum) with NPCs, the gauntlet with Spark, a ranged tool (bow or crossbow). Second enemy: a stray Crown clockwork sentinel.
- **M4 "The Signal Source":** the dungeon is the source, an ancient ruin with pressure doors and gear puzzles, then a boss, and the reward is the first gauntlet crystal. The truth behind the SOS stays open.
- **Ferrum itself** stays **out** until after M6. It is seen only as horizon lights and in flashback text.

**Visual direction (designer): 80-90% fantasy, 10-20% machines**
- **Base world, unchanged:** the approved stone, wood and iron ramps and the sky. Add **moss and ivy** (greens, `" ; ,` on stone tops and cracks) and **magic glow**.
- **Aether glow:** cyan-teal emissive with `* + .` sparkle. It is reserved for magic, crystals and the signal.
- **Machine accents** (only on machines: the balloon, the lamp, the lever housing, the relay mount, later doors and sentinels):
  - brass: warm yellow-orange with bright top steps.
  - copper: red-orange, with verdigris teal as `%` or `:`.
  - rivets: `o` or `.` on `=` plates.
  - gears: `*` or `@` hubs.
  - pipes: `|` `=` with `+` joints.
  - gauges: `(@)`.
  - balloon canvas: pale ochre `~ )`.
  - steam: `. ' ~` near-white fading to fog.
- **Light rules:**
  - Keep the warm lamp vs cool sky contrast.
  - Ferrum's lights are warm amber pinpoints.
  - Machines must stay readable at 160x60: silhouette first, and no rivet noise on small props.

### Consequences
- No engine or story-order changes. M1 finishes on schedule, and the designer and writer work in parallel with the programmers.
- The PO must update GDD section 2 pillar 1 (the core-loop wording), sections 7 and 8 text, and backlog notes for the listed stories plus the US-015 acceptance criteria.
- The approved lantern, title and scrawl art needs a re-check by the PO after the reskin. Geometry approvals stand.

---

## D-012 Steam release in M6: Electron wrapper + steamworks.js, browser demo (itch.io) first

**Date:** 2026-09-23
**Owner request:** "steam sounds cool" (queued idea f, backlog handoff).
**Status:** Accepted (planned for M6; only the "needed earlier" items below touch earlier milestones)

### Context
The game is pure HTML/JS/WebGL2 with no build step (guardrail). Steam needs a native executable, Steamworks integration (achievements, cloud saves, overlay) and store assets. The renderer depends on WebGL2 behaving exactly as tested (D-009 parity gate on Chrome).

### Options
1. **Electron.** Bundles Chromium: the same WebGL2/ANGLE stack we test in Chrome, on Windows, macOS, Linux and Steam Deck. `steamworks.js` is built for Electron/Node. Cost: ~100-150 MB download, higher RAM. Mature, many shipped Steam games.
2. **Tauri.** ~5-10 MB, uses the system webview: WebView2 (Chromium) on Windows, but WKWebView on macOS and WebKitGTK on Linux/Steam Deck, whose WebGL2 is weaker and untested by our parity gate. Steamworks needs Rust-side bindings; a second language in the shipping path.
3. **Browser only (itch.io / web).** Zero wrapper cost, no Steam.

### Decision
**Option 1, Electron, for the Steam build; the browser build stays the primary development target and ships first as a demo.**
- **Wrapper:** `desktop/` folder (Electron `main.js` + `preload.js`), outside `engine/` and `game/`. It loads the unchanged `game/` via a custom `app://` protocol (ES modules do not load from `file://`). The engine never knows it is in Electron. `electron-builder` is a packaging tool only; the game itself still has no build step. Tauri is rejected for now because of the WebKit WebGL2 risk on Linux/Deck; re-evaluate only if download size becomes a store problem.
- **Steamworks:** `steamworks.js` in the Electron main process, exposed through `preload.js` as a tiny `platform` object (`unlockAchievement(id)`, `saveWrite/saveRead`, `isSteam`). The game talks to a `game/js/platform/` adapter with a **web** implementation (localStorage/IndexedDB, no achievements) and a **steam** implementation. Scope in M6: achievements, Steam Cloud saves (Auto-Cloud on the save folder), overlay. Out: workshop, leaderboards, multiplayer, DRM.
- **Release order:** (1) browser demo on **itch.io** (the M1+M2 slice, free) as the feedback funnel, (2) Steam "Coming Soon" page for wishlists once M3 is playable, (3) Steam launch at the end of M6. $100 Steam Direct fee, budgeted by the owner.
- **Store assets (designer, M6, rendered from the real engine, not faked):** ASCII key art; capsules (header 920x430, small 462x174, main 1232x706, vertical 748x896, library 600x900 + hero 3840x1240 + logo); 5+ screenshots; a 30-60 s trailer captured in-engine. Writer: short/long store description.
- **Needed earlier (so M6 is packaging, not rework):**
  - **Settings menu** (queued idea c; grid 160/240/320 per D-009 amendment 2, plus mouse sensitivity, invert Y, volume, fullscreen, key rebinding later): M2, P1. Settings persist through the platform adapter.
  - **Saves:** the M2 save point writes `serialize()` output through the platform adapter only (never direct `localStorage` in game code); versioned save format (`saveVersion`) from the first save story.
  - **Fullscreen + pointer lock:** a toggle and correct resize handling (grid re-fit, no stretch) in the settings story; Electron maps it to window fullscreen.
  - **No network or CDN dependencies** at runtime; all assets relative paths (already true).
  - **Gamepad** (M6 already; required for Steam Deck "Playable").
  - **Pause on focus loss / overlay open** (M2 with the settings menu).

### Consequences
- One new folder (`desktop/`) in M6, one adapter folder (`game/js/platform/`) from the first save/settings story; check-deps: `engine/` must not import either.
- The browser build and the Steam build run the same `game/` code; the tester tests both in M6.
- PO: add the settings-menu story to M2 and the platform-adapter criterion to the save-point story.

---

## D-013 Writer's proposals from `docs/story.md` section 6

**Date:** 2026-09-23
**Status:** Accepted (canon amendments to D-011 amendment 2; GDD section 3 updated by the PO, not by the manager)

### Decision (per proposal)
1. **Hero name "Wick": ACCEPTED.** It is his real name (no borrowed-name thread, per amendment 2). Where it shows: the relay-keeper's log does not know him; **his own pencil notes on the map are signed "W."** in M1 (US-015 map card); the full name is first **spoken by the exiles in M3** dialogue and appears in save-slot labels. **Not** on the title card (the title is *Kestrel*). The hero is never seen.
2. **SOS pattern 3 short, 3 long, 3 short: ACCEPTED as canon.** Timing for the P2 pulse animation (designer): short = 0.25 s on, long = 0.75 s on, 0.25 s gap inside a letter, 0.75 s between letters, 2.5 s pause before repeat. Used identically in the log text, the signal tower emissive and any later sound (D-004).
3. **"The log is old" (the signal predates Wick's escape): ACCEPTED as a constraint, reveal DEFERRED.** The log stays vague in M1. The writer drafts 2-3 candidate explanations for the M4 reveal in `docs/story.md`; the manager picks one before M4 content starts. No M1-M3 text may contradict "the SOS has been sending for years".
4. **Exile village name "Outwall": DEFERRED to M3** as the working name. The writer may offer alternatives when the M3 village stories are written; nothing in M1/M2 names it.
5. **GDD section 3 is stale: ACCEPTED.** The manager does not edit `game-design.md` (the PO is editing it now).

### PO note (apply to GDD section 3 in your current edit)
- Remove partial amnesia and the "Crown mages" line; Ferrum is **machines only** (brass, steam, gears; magic is myth/forbidden), **magic is real outside**, Wick does not believe it at first.
- Hero: **Wick**, a young Low Ward skyworks hand from Ferrum, remembers everything, new to everything outside; name shown per item 1.
- The map is a **Crown sky-chart** (stolen with the *Kestrel*) with **Wick's pencil course** and notes signed "W.", not a handwritten map he doesn't remember.
- SOS = 3 short, 3 long, 3 short (timing above); it has been sending for years (reveal deferred).
- Exile village: unnamed in canon, working name "Outwall" (M3).
- Also fix the matching lines in the D-011 US-015 map-card ACs if they still say "hand-inked map / notes you don't remember".

### Consequences
- Designer: pulse timing for the P2 signal animation; "W." signature on the map card art.
- Writer: M4 reveal candidates (item 3) before M4.

---

## D-014 2D / 2.5D strategy camera: future engine capability, renderer kept camera-agnostic at no extra cost now

**Date:** 2026-09-23
**Owner idea:** a 2D/2.5D strategy (top-down / isometric) camera as a future capability of the engine (queued idea e).
**Status:** Accepted (roadmap note; no story before M5)

### Options
1. **Build it now.** Adds an orthographic/isometric projection path to the GPU DDA, terrain and sprite passes during M1. Delays M1; no game feature needs it.
2. **Ignore it.** Risk: first-person assumptions leak into world, picking and sprite code and make it expensive later.
3. **Keep the renderer camera-agnostic by rule, build the camera later.** Nearly free: the engine already has an explicit `CameraPose` (architecture.md section 10).

### Decision
**Option 3.** The strategy camera is an **engine-product feature, post-M1, earliest M5** ("Engine Editor v0" / engine as a standalone package; the M1.5/M5 editor's top-down map view is its natural first user). Not a game feature for M1-M4.
Architect guardrail from now on (review checklist item, no refactor of existing code):
- The camera is data: `CameraPose` + a `projection` descriptor (`{ kind: 'perspective', fov }` today; `'ortho'`/`'iso'` reserved). Passes get rays/projection from one place, not from inlined first-person math.
- `World`, physics, entities, picking and serialization never assume a first-person player camera (picking goes through the planeId target, which works for any projection).
- Do not implement ortho/iso or pay any runtime cost for it now; if a guardrail would cost more than ~0.5 day in a story, the architect notes it and skips it.

### Consequences
- No M1 scope change. When the feature is picked up, it is an engine story with architect tech notes (ortho DDA over the sector grid and heightmap is simpler than perspective; the grid cell aspect is the main design question).

---

## D-015 Rust/WASM and third-party physics: only for measured hot spots; engine stays JS + GLSL

**Date:** 2026-09-23
**Status:** Accepted (policy; queued ideas d and g)

### Decision
- **Engine language stays JS + GLSL shaders.** Rust/WASM is allowed **only for a hot spot measured by the bench** (`tools/bench-cast.mjs` / `?bench=1`) that still misses budget after a JS optimisation pass. Candidates: terrain far-grid bake / chunk regeneration (US-016, US-026) and pathfinding (M2+ enemies). Architect evaluates in M2 if measurements say so.
- **No build step preserved:** a WASM module ships as a prebuilt `.wasm` committed to the repo, loaded with `WebAssembly.instantiateStreaming`; the Rust source and its build script live under `tools/wasm/` (dev-only). The JS implementation stays as the oracle and fallback, with a parity test, like D-009.
- **Rapier (physics):** the architect evaluates `@dimforge/rapier3d-compat` (ES module with embedded WASM, vendored locally, no bundler) **when US-013 (boulder) comes up**, against extending the in-house sphere code. Adopt only if it stays on our fixed timestep, is deterministic enough for saves, and all floor/collision queries still come from `World` (D-007). Otherwise the in-house physics stays.
- **Three.js:** evaluated only if a story needs arbitrary meshes (see the queued 3D glyph-model estimate); not adopted by default.

### Consequences
- No change to M1. Any WASM or Rapier adoption is an engine story with architect tech notes and a vendored, version-pinned dependency.

## D-016 3D glyph models: voxel models with rigid-part animation (Option A)
**Date:** 2026-09-23
**Status:** Accepted (owner decision)
**Decision:** Creatures/NPCs (e.g. a talking bear) that must be walked around use **voxel models** (a small 3D grid of material cells), animated by **rigid parts** (head, limbs, and so on). They are rendered per cell into the G-buffer (kind 8), so they reuse `shadeCore/shadeTail`, the edge pass and lighting, and look like the rest of the glyph world. Budget <= 0.5 ms p95 at 240x90. 3 stories: (1) format + JS oracle (Node-only; can start after US-030b is ARCH OK), (2) GPU pass + gpucompare, (3) lighting/animation integration (after US-016 and US-006/007). Target: before M3. **Option C** (8-direction billboards via the US-030c sprite pass) is the cheap interim for M1-M2. Option B (meshes) is rejected for now. Spec: `docs/architecture.md` section 15. The M5 model editor (US-035..037) edits voxel models.

## D-017 JS render path: correctness reference only, no playable CPU fallback (amends D-009 item 5 and D-005)
**Date:** 2026-09-24
**Status:** Accepted (answers the owner's question "do we need CPU support at all?")

### Context
D-009 gave the JS path two jobs: (a) oracle for `?gpucompare=1` and all Node tests, and (b) a playable fallback (`?gpu=0`, no WebGL2, software renderer) at 160x60. Role (a) caught real GPU bugs in US-006/US-007. Role (b) keeps adding perf work (US-006 4-nearest-light cap and budget, US-016 coarse step, US-018 `?gpu=0` fps/8 ms gates) for a tiny audience: the shipping target is Steam via Electron (D-012, bundled Chromium = WebGL2 guaranteed); the browser demo/itch.io audience without WebGL2 is ~2-3 % and would get a poor 160x60 experience anyway.

### Options
- **(A) Keep D-009 as is.** Every GPU feature is built twice with perf ACs on both. Highest cost, near-zero players served.
- **(B) JS = correctness reference only; no-WebGL2 -> clear "WebGL2 required" screen.** Keeps the bug-catching oracle, removes all CPU perf work.
- **(C) Drop the JS path entirely.** Cheapest now, but loses the oracle and headless Node tests that just found real bugs. Rejected.

### Decision
**(B).**
1. The JS path is the **reference implementation**: it must match the GPU under `?gpucompare=1` (US-029 thresholds) and back every Node test/bench. It carries **no perf ACs and no frame budget**; clarity beats speed. New GPU passes still ship with a JS reference + parity test (D-009 item 6 unchanged).
2. **No playable CPU fallback as a product requirement.** No WebGL2 or context-creation failure -> a clear full-screen "WebGL2 required" message (with a short how-to: update browser / enable hardware acceleration), no crash. Software renderer (SwiftShader/llvmpipe/Basic Render) -> run the GPU path with a one-line "performance may be poor" warning.
3. `?gpu=0` stays as a **dev/debug switch** (view the reference output in-browser); "renders correctly" is enough, speed is irrelevant. Its 160x60 grid force may be dropped if the reference is too slow at the chosen grid; any grid is allowed.
4. The Canvas2D presenter (`?force2d=1`) is frozen: kept while it costs nothing, no new ACs, may be removed later by an engine story.
5. The 8 ms JS budget (D-009 item 3) still applies to the **GPU path's** JS work (sim, uploads, light set).

### Consequences
- Removes the CPU-fallback perf ACs from US-006, US-016, US-018, US-038 (list in the manager reply to the PO); M1 exit no longer requires a playable fallback.
- US-029 needs a small follow-up: the "WebGL2 required" screen replaces the auto-fallback (content/UI, not an engine rewrite).
- Existing CPU perf code (e.g. `selectCpuLights`) may stay; no one is required to maintain its speed.

## D-018 Object physics epic (US-051..055): own compound-sphere rigid bodies in `engine/physics/rigid.js`; Rapier only as a gated fallback
**Date:** 2026-09-24
**Status:** Accepted (owner requirement: object physics before release)

### Context
The owner requires object physics before release: props that fall/tumble/settle (US-051), pick up/carry/throw (US-052), particles (US-053), cuttable trees that break into physics pieces (US-054), water + splash + floating props (US-055). D-015 said to evaluate Rapier against the in-house code. Architect estimate: `docs/architecture.md` "Physics epic estimate (2026-09-24)".

### Options
- **(A) Extend `engine/physics`** with compound-sphere rigid bodies. ~11 units. World contacts go straight through `World` (D-007), so sectors, grates and terrain work as they do now. Deterministic JSON save state, 0 alloc per step. Risk: stacking quality.
- **(B) Rapier (WASM).** ~13-14 units. Most exact shapes, but the static world has to be mirrored (sectors, terrain heightfields, live grates), the snapshot is binary, a JSON pose restore diverges, the player needs glue code, and it adds a ~2 MB dependency for a handful of bodies.
- **(C) cannon-es.** ~13 units. Same mirroring problem as B, unmaintained since 2022, allocates every step (GC hitches, breaks rule 9).

### Decision
**(A).** Compound-sphere/capsule rigid bodies (quaternion pose, diagonal inertia, sequential impulses with fixed 8 iterations, Baumgarte correction, sleep islands) in `engine/physics/rigid.js`. All world queries go through `World`. The US-013 roller stays as it is.
1. **Scope guard:** the AC is "settle in 3 s, <= 2 cm drift, no jitter", stacks of at most 3. This is not a physics sandbox.
2. **Split:** US-051a (bodies + world contacts + sleep) and US-051b (body-body contacts, stacking <= 3, two-way player contacts). Both are engine stories with architect tech notes and review.
3. **Exit gate:** if US-051a misses the 10-body drop test after **one** fix round, the architect escalates a **Rapier spike** as its own engine story (vendored, version-pinned, per D-015). A's contact API is kept stable so B could slot in behind it. No second fix round on A without a manager decision.
4. **Order:** US-053 (particles) can start in parallel because it does not depend on this choice. Then US-051a -> US-051b -> US-052 (M2). US-054 and US-055 come in M3, after the M2 sword and the voxel work (US-041). All five are done before the M6 release.

### Consequences
- Answers the D-015 Rapier question for object physics. The engine stays pure JS and no WASM dependency is added.
- The M2 and M3 scope grows by the epic (see roadmap). A sleeping log is a walkable oriented capsule for `moveCapsule`, which covers log bridges without new player code.
- Rigid body state (pose/vel/angVel/sleep) becomes part of the versioned save format (M2 release prep).

## D-019 M1 tower props become voxel models: US-040 + a props slice of US-041 pulled into M1 (answers OWN-REQ-001)
**Date:** 2026-09-24
**Status:** Accepted

### Context
Owner walk-test (backlog rows 25f/25g/25h): the tower props (lever, burner, lamp, canvas, rubble, wreckage, relay, boulder) turn to face the player, are hard to recognise and look see-through. "Real 3D, fixed in the world" is the owner's main visual complaint. D-016 already chose voxel models (US-039 format + JS oracle `castModels` done; US-040 GPU pass and US-041 lighting/animation planned "before M3"; Option C 8-direction billboards named as the M1-M2 interim). Architect notes 7.7 (billboard `fill` + optional `outline`) are ready but not built; the designer is reworking billboard art.

### Options
- **(A) Pull US-040 + US-041 forward; M1 props become voxel models.** Fixes all three complaints at the root (fixed orientation, true silhouette from any angle, solid by construction, edge pass outlines it). Prop art is done once, in the format the M5 editor and M3 NPCs use. Cost: M1 slips by about 2 engine stories + voxel prop art; risk = a new GPU pass late in M1 (mitigated: the oracle and format are done and tested, gpucompare harness exists).
- **(B) Ship M1 with billboards + fill/outline + interim fixed-yaw or 4-8 directional views; convert in M2.** Smaller M1 slip, but fixed-yaw cards go paper-thin edge-on, directional views multiply art 4-8x, and all of it is thrown away in M2 (art done twice or three times). The owner's main complaint is only half-fixed in the slice they judge.

### Decision
**(A), with a scope guard.**
1. **US-040** (GPU voxel pass A3 + gpucompare) becomes **M1 P0**, compare poses = tower props (lever, burner), not the bear.
2. **US-041 is split.** **US-041a (M1 P0):** voxel lighting incl. rotated normals, entity binding (`type: 'voxelModel'`, fixed world yaw), rigid-part animation only as far as the props need it (lever pull, burner/relay idle if any), prop `mounts` (light anchors, E-prompt). **US-041b (before M3, unchanged target):** creature clips (idle/walk), the bear model + `design/preview/voxel.html` orbit page.
3. **What stays a billboard:** flames, glows, sparks, the carried-lamp halo, horizon billboards (US-016). BUG-OWN-003 shrinks to `fill` for those remaining sprites (only if the owner still sees see-through flames after the switch); the 7.7 `outline` option is dropped from M1.
4. **Art is done once.** The designer stops billboard rework of solid props now and builds them as voxel ModelDefs (US-039 format, previewed via the `castModels` oracle until the GPU pass lands). ART-OWN-001 = voxel prop art with readability ACs (visible lever, wall contrast, 160x60 and 240x90). Billboard art for flames/glows is still in scope.
5. **Boulder:** a voxel sphere with fixed yaw; roll rotation only if US-041a gives it for free (rotated normals); not an AC.
6. **Order:** finish US-016 (pass A2 slot) -> US-040 -> US-041a -> swap props in `world_m1` + PO walk-check with the owner -> BUG-OWN-003 (slim, if still needed) -> US-018 final perf (budget now includes the model pass <= 0.5 ms p95). Voxel prop art runs in parallel with US-040.
7. **Exit gate:** if US-040 fails `?gpucompare=1` or its 0.5 ms p95 budget after **one** fix round, M1 falls back to option (B) (billboards + 7.7 fill/outline, fixed-yaw props) and voxel props move to M2. No second fix round without a manager decision.

### Consequences
- M1 grows by US-040 + US-041a + voxel prop art; the M1 date slips accordingly. M1.5 and later milestones shift by the same amount; D-016's pre-M3 target for creatures is unchanged (US-041b).
- The billboard sprite pass stays in the engine for effects and horizon billboards (US-030c work is not wasted).
- US-042 animals, US-054 tree pieces and the M5 model editor build on the same voxel path already proven in M1.

## D-020 Sprint 1 scope; no walk-on past the breach in M1; minimal sound slice to P1 (sprint 2); owner story idea to M2+
**Date:** 2026-09-24
**Status:** Accepted

### Context
Sprint 0 review (`docs/sprints/sprint-0.md`): the slice isn't finishable for a first-time player yet. The breach shows empty sky (US-016 A2 missing), the ending reads like a respawn (BUG-OWN-005), and props are unreadable and turn to face the player (D-019 work). The PO proposed a sprint 1 list, asked for a walk-on ruling, proposed a minimal sound slice at P1 and flagged US-022. The owner also filed a story + progression idea (`docs/owner-ideas/2026-09-24-story-and-progression.md`).

### Options
- **Walk-on:** (a) let the player walk out onto the terrain in M1; (b) keep the end trigger at the breach and do the walk-out in M2 with US-026. With (a) the player walks onto far-LOD terrain that has no near LOD and no slope physics, so the first thing they see outside is a broken world. (b) costs nothing and matches the M1 goal.
- **Sprint 1 size:** 6 stories incl. sound + US-022, or 5 + 1 stretch. US-016 A2, US-040 and US-041a are three GPU/engine stories in sequence with architect reviews, which already fills a sprint.
- **Sound:** keep P2 (D-004), or move a minimal slice to P1. Gap 4 (lever -> grate cause and effect) is real, and a grate rattle is the cheapest fix, but it isn't a blocker for "can finish and knows it's the end".

### Decision
1. **No walk-on in M1** (option b). The end trigger stays at the breach. The ending is made deliberate by the US-016 vista, the summit hint and the "End of Chapter One" card (BUG-OWN-005 PO ACs). In M2, US-026 replaces the end trigger with the walk-out.
2. **Sprint 1** = US-016 finish, US-040, US-041a, **US-056** (new: M1 voxel prop swap + owner walk-check), BUG-OWN-005; US-018 as stretch. Goal: *a first-time player can finish the tower and knows it's the end.* Exit = owner end-to-end walk-test (`docs/sprints/sprint-1.md`).
3. **Minimal sound slice goes to P1 for M1** (partly amends D-004): lever clunk, gear ratchet, grate rattle, boulder thud, footsteps, procedural WebAudio only. The PO carves it out of US-020 as its own story. It's still **not an M1 exit criterion**. It's first in line for sprint 2, together with US-022 (P1, D-003) and BUG-OWN-003 slim if the US-056 walk-check needs it.
4. **Owner story/progression idea** (crash intro animation, vanished loved one, SOS; no XP, gear levels, magic from beacons/wells/quests with a small skill tree, bow, trading, crafting, biomes) goes to the GDD (writer + PO) and to roadmap M2+. M1 content stays the tower slice. The crash intro animation is **not** added to M1; the PO places it (M2 at the earliest, or M1.5 if it stays a cheap title-card beat).

### Consequences
- The M1 build order gets rows 17a (US-040) and 25l (US-056). The M1 exit gains the owner end-to-end playthrough as the explicit acceptance test.
- If US-040 hits the D-019 fallback gate, sprint 1 swaps US-041a/US-056 for the fallback (b) billboard fill/outline + fixed yaw work. The goal stays the same.
- The GDD gets a progression section (no XP) that later milestones must respect (M2 sword, M3 Spark/bow).
