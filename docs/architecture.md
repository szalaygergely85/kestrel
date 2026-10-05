# ASCII Quest – Engine Architecture

Owner: Architect. Created 2026-09-22. Works inside the manager's decisions D-002, D-005, D-006, D-007, D-008 (`docs/decisions.md`). Story-specific notes live in `docs/backlog.md` ("Tech notes (architect)"); anything reusable lives here. When this file and a story note disagree, this file wins and the story note gets fixed.

Contents: 1 Layers · 2 Folder layout · 3 Dependency rule and `check-deps` · 4 Conventions · 5 Public API (`engine/index.js`) · 6 AssetRegistry and content interfaces · 7 World model · 8 Frame pipeline and budgets · 9 Allocation rules · 10 Serialization and editor extension points · 11 Testing strategy · 12 Performance notes · 13 Do-not list · ... · 27 Mesh engine (own renderer, ASCII as the final stage; GpuDevice backend, phases 0-4, gates, stories ME-00..ME-34)

---

## 1. Layers

```
+-----------------------------------------------------------------+
| game/  (ASCII Quest)          | tools/ (editor, exporters, checks)|
|  main.js bootstrap, quest/    |  second client of the engine      |
+-------------------------------+-----------------------------------+
| design/  content pack: palette, models, levels, terrain recipe,   |
|          world files. Plain data + the designer's reference       |
|          shaders. Loaded by game/ or tools/, handed to the engine.|
+-----------------------------------------------------------------+
| engine/index.js  the ONLY public entry                            |
|  core/    loop, input, events, assets (AssetRegistry), behaviours |
|  render/  RenderTarget (GL2 / C2D), CellBuffer, DepthBuffer,      |
|           OpenSpans, sectorCaster, terrainCaster, sprites,        |
|           compositor, textDraw, lighting                          |
|  world/   Level (sector grid), Terrain (recipe sampler + chunks), |
|           World (terrain + placed structures + entities), serialize|
|  physics/ config, capsule, sphere, terrainCollide, integrate      |
|  entities/ Entity (plain data), Camera                            |
|  ui/      overlay primitives (fade, hint, prompt, text), debug    |
+-----------------------------------------------------------------+
| browser: <canvas>, WebGL2 / Canvas2D, requestAnimationFrame       |
+-----------------------------------------------------------------+
```

Rules of thumb:
- The engine knows **shapes** (what a palette, model, level, recipe, world file look like). Content knows **instances**. Game code knows **behaviours** (named functions data refers to).
- The engine has no idea what a tower, lantern or beacon is. If a word from the GDD appears in `engine/`, it is a bug.
- Everything the future editor must touch is plain JSON-safe data (levels, world files, entity state, terrain overrides). Classes hold caches and typed arrays, never authoritative state.

## 2. Folder layout (target, per D-006)

```
engine/
  index.js                      public API, re-exports only (no logic)
  README.md                     purpose, folder map, API list, check-deps
  core/    loop.js input.js events.js assets.js behaviours.js
  render/  RenderTarget.js RenderTargetGL.js RenderTargetCanvas2D.js CellBuffer.js glyphMetrics.js
           DepthBuffer.js OpenSpans.js sectorCaster.js terrainCaster.js sprites.js compositor.js
           textDraw.js lighting.js shadeTest.js
  world/   Level.js MAP_FORMAT.md Terrain.js World.js serialize.js
  physics/ config.js capsule.js sphere.js terrainCollide.js integrate.js
  entities/ Entity.js Camera.js Player.js EyeFeel.js
  ui/      debugOverlay.js overlay.js
game/
  index.html world-test.html physics-test.html
  js/main.js                    bootstrap: AssetRegistry from design/ globals -> createEngine -> quest
  js/quest/                     wake, title, hints, interactions (lantern/lever/beacon), end trigger, restart
  js/dev/                       page-only harnesses: worldTestMain.js physicsTestMain.js demoScene.js glyphsScene.js benchScene.js
design/  (unchanged owner: designer) palette.js models/ levels/ (incl. test_room.js, world_m1.js) preview/
tools/   check-deps.mjs bench-cast.mjs (headless caster bench) export-content.mjs (US-027) editor/ (M5)
docs/
```

What goes where (decision table):

| Thing | Folder | Why |
|---|---|---|
| Anything that renders cells, samples geometry, integrates physics, loads/validates content shapes | `engine/` | reusable by any game/editor |
| Tuning numbers with gameplay meaning (walk speed, jump) | `engine/physics/config.js` **as defaults**, overridable via `createEngine({ physics })` | US-008 criterion; the editor tweaks them as data |
| Dev harnesses that import only `engine/index.js` and draw on their own canvas | `game/js/dev/` | not shipped API, not engine |
| Named behaviours (`lantern.take`, `quest.end`, `hint.show`) | `game/js/quest/` | game meaning |
| Reference shaders (`palette.util.shade`) | `design/palette.js` (oracle) | the engine's fast path must match it (`?shadetest=1`) |
| Node scripts | `tools/` | not served |

## 3. Dependency rule and `tools/check-deps.mjs`

Direction: `game/ -> engine/index.js`, `game/ -> design/` (as data via globals or JSON), `tools/ -> engine/index.js`. `engine/` imports **only** `engine/`. `design/` imports nothing (classic scripts).

`node tools/check-deps.mjs` (no dependencies, exit code 1 on any finding, prints `file:line: message`):

1. For every `engine/**/*.js`: every `import ... from '<spec>'`, `export ... from '<spec>'` and `import('<literal>')` must resolve (path-normalised) inside `engine/`. Bare specifiers (`'fs'`, `'three'`) are findings too (no libraries, no Node built-ins in the engine).
2. For every `engine/**/*.js`: the regexes `window\.ASSETS`, `globalThis\.ASSETS`, `\bASSETS\.` (outside comments), `document\.getElementById`, `location\.search`, `URLSearchParams` are findings. The engine receives the canvas, the assets and the options as arguments; it never looks for them.
3. For every `game/**/*.js` and `tools/**/*.js`: an import that resolves inside `engine/` must be exactly `engine/index.js` (deep imports are findings). `game/js/dev/*` is not exempt.
4. `design/**/*.js`: any `import`/`export` statement is a finding (they must stay classic scripts until US-027 provides the JSON path).
5. JSDoc `import('...')` inside comments is ignored (strip `/* */` and `//` first).
6. Prints `check-deps OK (N files)` on success. Tester runs it for every story from US-024 on; it is an M1 exit criterion.

## 4. Conventions

- **Units:** meters, seconds, degrees in data and public APIs; radians only inside a function.
- **World frame:** x east, y south, z up. One frame for everything (D-007). A level's local frame maps to world by `origin` (`world = local + origin`, no rotation in M1; `yawSteps` = quarter turns clockwise, reserved, 0 only until a story needs it).
- **Cells:** cell `(col,row)` covers `[col, col+1) x [row, row+1)` in level-local meters; centre `(col+0.5, row+0.5)`. `rows[row][col]` in level data (row 0 = north edge). Terrain near cells are 2 m, far cells 8 m, chunks 128 m = 64x64 near cells, chunk key `floor(x/128),floor(y/128)`.
- **Angles:** `yawDeg` compass: 0 = north (-y), 90 = east (+x), clockwise. `pitchDeg` positive = up, clamped +-35. Forward vector: `(sin yaw, -cos yaw)`. Right vector: `(cos yaw, sin yaw)`. Sun `azimuth` = compass direction the light comes FROM; `elevation` above horizon.
- **Screen:** column `x` 0..cols-1 left to right, row `y` 0..rows-1 top to bottom; `horizonRow = rows/2 + tan(pitch) * planeDistY`; a world height `h` at perpendicular distance `d` projects to `row = horizonRow - (h - eyeZ)/d * planeDistY`. Every pass (sectors, terrain, sprites) must use these two formulas from one shared helper (`render/projection.js` or exported from `sectorCaster.js`) so horizons line up at every pitch.
- **Heights:** `floorH` on a solid cell = wall top (MAP_FORMAT v2 2.4). Camera `z` = eye height in world meters (not above floor). Entity `transform.z` = feet.
- **Depth:** perpendicular camera-plane distance in meters, `Infinity` = sky/unresolved.
- **Time:** fixed simulation step `1/60 s`, max 5 steps per frame; render interpolates with `alpha`. Animations take `timeSec` from the engine clock, never `Date.now()` (determinism, replay).
- **Materials/colors:** by palette key everywhere in data; hex only in `palette.colors`.
- **Ids:** entity/prop/interactable/structure ids are strings unique within their world; sector tags (`tag: 'grate'`) address groups of cells.

## 5. Public API – `engine/index.js`

Everything not listed here is private and may change without notice. Typedefs are normative; implementations may add fields, never remove or retype them.

```js
// ---- bootstrap -------------------------------------------------------------
/**
 * @typedef {Object} EngineOptions
 * @property {HTMLCanvasElement} canvas
 * @property {AssetRegistry} assets
 * @property {number} [cols=160]  @property {number} [rows=60]
 * @property {boolean} [force2d=false]        Canvas2D fallback for testing
 * @property {Partial<PhysicsConfig>} [physics] overrides merged over defaults
 * @property {Window|EventTarget} [inputTarget=window]
 */
/**
 * @typedef {Object} Engine
 * @property {RenderTarget} renderTarget   setCell/setCellRGB/clear/present/resize, cols, rows, pxCellW, pxCellH, backend
 * @property {DepthBuffer}  depthBuffer    Float32Array(cols*rows) meters, Infinity = none
 * @property {OpenSpans}    openSpans      per-column unresolved span, see 8
 * @property {World|null}   world          set by engine.loadWorld()
 * @property {Input}        input          isDown/pressed/mouseDelta/pointerLock (US-005)
 * @property {Loop}         loop           start/stop, fps, frameMs, stats
 * @property {Camera}       camera         {x,y,z,yawDeg,pitchDeg} + helpers
 * @property {Events}       events         on/off/emit (see 10)
 * @property {AssetRegistry} assets
 * @property {PhysicsConfig} physics
 * @property {(worldDef: WorldDef) => World} loadWorld
 * @property {(cb: FrameCallbacks) => void}  run   wires update/render, see 8
 */
export function createEngine(opts: EngineOptions): Engine

// ---- content ----------------------------------------------------------------
export class AssetRegistry            // see 6
export function loadLevel(def: LevelDef): Level | null      // validates, logs, null on error (US-003)

// ---- world ------------------------------------------------------------------
export class World                    // see 7
export class Terrain                  // recipe sampler + chunk cache (US-025)
export class Level                    // sector grid (US-003), local frame
export function serialize(world: World): WorldState          // JSON-safe (see 10)
export function deserialize(state: WorldState, assets: AssetRegistry): World

// ---- render passes (all allocation-free, all take an explicit camera) --------
/** @typedef {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} CameraPose  z = eye, world meters */
/**
 * @typedef {Object} FrameBuffers
 * @property {RenderTarget} rt   @property {DepthBuffer} depth   @property {OpenSpans} spans
 * @property {Palette} palette   @property {LightSet} lights  (US-006/007: ambient, sun, point lights, in world coords)
 * @property {number} timeSec
 * @property {GBuffer} gbuf          per-cell surface samples written by the casters, read by the grid passes (8.1, US-028)
 * @property {LightBuffer} light     accumulated light per cell or uniform (8.1)
 * @property {boolean} detail        false = v1 shading for every material (`?detail=0`)
 * @property {number} structSeq      reset by beginFrame, incremented per castSectors call (planeId bits 28-30)
 */
export function beginFrame(fb: FrameBuffers): void            // depth.clear(), spans.reset(); rt is NOT cleared (full coverage is guaranteed by the compositor)
export function castSectors(fb: FrameBuffers, level: Level, cam: CameraPose, origin: Vec3): void
                                                             // walls/steps/lintels/floors/ceilings into rt+depth; narrows fb.spans; NEVER paints sky
export function castTerrain(fb: FrameBuffers, terrain: Terrain, cam: CameraPose, opts?: {lodFar?: boolean}): void
                                                             // fills only inside fb.spans, writes depth, narrows spans (US-016/026)
export function fillSky(fb: FrameBuffers, cam: CameraPose): void   // whatever is still open in fb.spans -> shadeSky, depth Infinity
export function drawSprites(fb: FrameBuffers, sprites: SpriteInstance[], cam: CameraPose): void  // depth-tested billboards (US-011)
export function drawText(rt: RenderTarget, x: number, y: number, text: string, fg: string, bg?: string): void  // UI only, hex or palette key
export function renderWorld(fb: FrameBuffers, world: World, cam: CameraPose): void  // the compositor: the sequence in 8, for the common case

// ---- physics (pure functions over a WorldQuery, see 7) -------------------------
export const PHYSICS_DEFAULTS: PhysicsConfig
export function moveCapsule(world: WorldQuery, x, y, dx, dy, radius, footZ, grounded, opts, out: MoveResult): MoveResult
       // MoveResult = {x, y, blockedX, blockedY, nx, ny}: blockedX/Y = a FACE contact on that axis; nx/ny = unit normal of the
       // last CORNER contact (0,0 if none). `out` is caller-owned scratch (rule 9.3: no per-step object returns). Resolution is an
       // iterative minimum-translation push-out, deepest contact first (max 4 iterations); see US-008 ARCH CHANGES for the algorithm
       // and the two invariants ((res-pre).d >= 0, |res-target| <= |d|). Velocity response: zero blocked axes, then clip v against n.
       // WorldQuery.outsideSector is mandatory (Player dereferences the resolved sector).
export function moveSphere (world: WorldQuery, x, y, dx, dy, radius, z, opts, out: MoveResult): MoveResult   // US-013, see 7.4 (out param, rule 9.3)
/**
 * @typedef {Object} Controls   one per sim step; the caller owns and REUSES the object (rule 9.3)
 * @property {number}  [forward=0]  -1..1 (W=+1, S=-1)      @property {number} [strafe=0] -1..1 (D=+1, A=-1)
 * @property {boolean} [run=false]  Shift held
 * @property {boolean} [jump=false] Space HELD this step (level, not edge). Callers OR in the edge-trigger so a sub-step tap is not
 *                                  lost; the integrator does its own edge detection (`jumpHeldPrev`) so "holding does not repeat"
 *                                  is an entity property, testable headless with a level input.
 * @property {number}  [yawDeg]     @property {number} [pitchDeg]   if given, overwrite the entity's facing this step
 */
export function integrate  (entity: Entity, dt: number, controls: Controls, world: WorldQuery, cfg: PhysicsConfig): void  // the Player.update core, generic; step order in 7.1
export function isSectorPassable(sector, footZ, grounded, opts): boolean    // rule in 7.1

// ---- first-person eye feel (visual only, never touches collision; US-009) -------
/** @typedef {{stepOffset:number, dipT:number, dipAmount:number, bobPhase:number, offset:number}} EyeFeelState  plain numbers, serializable */
export function createEyeFeel(): EyeFeelState
export function updateEyeFeel(s: EyeFeelState, dt: number, body: {grounded:boolean, vx:number, vy:number, stepDelta:number, landed:boolean, fallDistance:number}, cfg: PhysicsConfig): void
       // step smoothing (exp decay, 95 % in cfg.stepSmoothTime), landing dip (down cfg.landDipDownTime, recover cfg.landDipRecoverTime,
       // amount by fallDistance thresholds), head bob (amplitude * speed envelope * sin(phase), phase advances by metres travelled, grounded only).
       // Writes s.offset (metres, added to eyeH by Camera.fromEntity / getEyeTransform). Reads only the 6 body fields listed; no world access.

// ---- entities ------------------------------------------------------------------
export class Entity                   // static helpers over plain data: Entity.create(type, transform, components), Entity.eye(e)
export class Camera                   // CameraPose + clampPitch(), fromEntity(entity, eyeH), lookDelta(dxPx, dyPx, degPerPx)
export class EntityHandle             // thin view over entity data: world.spawn/get -> play/stop/onAnimEnd/moveTo/lookAt/setComponent/on/remove (see 10.1)
export function stepAnimations(world: World, dtMs: number): void   // fixed-step animation clock over components.sprite (see 10.1)

// ---- behaviours (game registers, data refers by name) -----------------------------
export function registerBehaviour(name: string, fn: BehaviourFn): void   // BehaviourFn = (ctx: {world, engine, entity?, def}) => void
export const registerInteraction = registerBehaviour                     // D-006 wording
export const registerTrigger = registerBehaviour
export function getBehaviour(name: string): BehaviourFn | undefined      // World.fireInteraction/fireTrigger call this; unknown name = console.error once, no throw
```

Compatibility notes for the move (US-024): today's `castScene(rt, level, camera, palette, {depthBuffer, origin, skyFallback})` becomes `castSectors(fb, level, cam, origin)`. The `skyFallback` switch disappears: `renderWorld` ends with `fillSky`, which is exactly what `skyFallback: true` did, so `test_room` stand-alone looks identical. Until US-016 lands, `castTerrain` is a stub that returns without touching the spans.

**Two-tier public API (US-047, "Refactor candidates" item 3).** `engine/index.js` is now the STABLE tier only - the API above, safe for a second client (the M1.5 editor, future games) to depend on. Pass internals and parity/comparison tooling that a second client should never need - `beginFrame`/`castSectors`/`fillSky` (sectorCaster.js), `computeDerivatives`/`shadeSurfaces`/`shadeV2` (detailShade.js), `edgePass`, `runShadeTest`/`runDetailShadeTest` (shading parity harness), `runGpuCompare`/`compareCells`/`compareGeometry`/`compareLight`/`poisonNonSky`/`poisonAllCells` (the `?gpucompare=1` harness) - plus the former "may change without notice" glue (`Input`, `PlayerLook`, `Events`, `FrameProfiler`) - moved to a new `engine/dev.js`, a second curated re-export surface over the same underlying files (no logic duplicated). `tools/check-deps.mjs` rule 7 enforces the boundary: `game/js/dev/**`, `game/js/main.js` and `tools/**` (except `tools/editor/**`) may import `engine/dev.js`; `game/js/quest/**`, `game/js/ui/**` and `tools/editor/**` may not - they get only the stable `engine/index.js` surface, same as any second client would.

## 6. AssetRegistry and content interfaces

`engine/core/assets.js` owns the typedefs below (JSDoc, normative). The registry is a typed dictionary with validation on construction, `get` throws on unknown keys.

```js
/**
 * @typedef {Object} AssetBundle
 * @property {Palette} palette                       exactly one
 * @property {Object<string, ModelDef>} [models]     ASSETS.models.*  (title/subtitle too)
 * @property {Object<string, LevelDef>} [levels]     ASSETS.levels.* that have rows+legend (tower, test_room)
 * @property {Object<string, TerrainRecipe>} [terrain] ASSETS.levels.* that have util.heightAt (overworld_far)
 * @property {Object<string, WorldDef>} [worlds]     ASSETS.worlds.*
 * @property {UiStyle} [uiStyle]                     ASSETS.uiStyle
 * @property {DetailPassDef} [detailPass]            ASSETS.detailPass (US-028); absent = v1 look everywhere
 */
class AssetRegistry {
  constructor(bundle: AssetBundle)      // validates shapes (cheap: presence + types), palette.util.validate() must return []
  get palette(): Palette
  get uiStyle(): UiStyle | null
  model(key): ModelDef   level(key): LevelDef   terrain(key): TerrainRecipe   world(key): WorldDef   // throw `AssetRegistry: unknown ${kind} "${key}" (known: a, b, c)`
  has(kind, key): boolean   keys(kind): string[]
  static fromGlobals(ASSETS): AssetRegistry   // convenience for game/js/main.js: splits ASSETS.levels into levels vs terrain by shape
  static async fromJSON(urls): AssetRegistry  // US-027, not before
}
```

Content shapes the engine consumes (instances live in `design/`, documented in `design/README.md`; the registry only checks what the engine reads):

| Interface | Required by engine | Source of truth |
|---|---|---|
| **Palette** | `colors`, `rgb`, `hue`, `ramps`, `shading`, `lights{ambient,sun,torch,lantern,beacon}`, `fog{interior,far}`, `timeOfDay`, `defaultTime`, `materials`, `ui`, `util{shade,shadeSky,shadeSprite,addLight,falloff,rampIndex,buildLUT,fogFactor,bandFactor,texel,validate}` | `design/README.md` 1.2-1.8 |
| **Material** | `base`, `albedo`, `ramp`, `bg`, optional `texture{w,h,scale,rows,key}`, `textureFade`, `tintBand`, `spec`, `emissive`, `kind:'sky'` | README 1.6 |
| **ModelDef** (sprite) | `size`, `anchor`, `world`, `keys{ch:{c,e?}}`, `animations{name:{fps|durations,loop,events?{tag:frame|frames[]},frames[{S:{glyphs,fg,n?}}]}}` (events: 10.1), optional `lods.half`, `mounts`, `grow`, `ui` | README 4-5 |
| **LevelDef** | `name`, `legend`, `rows`, `start{x,y,facingDeg,pitchDeg?,eyeH?,pose?}`; optional `layers`, `sun`, `ambient`, `lights[]`, `props[]`, `interactables[]`, `triggers[]`, `markers`, `route` (pass-through in `level.def`) | `engine/world/MAP_FORMAT.md` v2 + `design/levels/tower_layout.md` 6 |
| **TerrainRecipe** | `name`, `version`, `seed`, `map{w,h,cell}`, `chunk{size,nearCell}`, `recipe`, `overrides{chunkKey:{stamps[],paints[]}}`, `structures[]`, `terrain{type:{id,colors,glyphs,face,albedo}}`, `bands`, `nearLOD`, `lighting`, `fog`, `farTower`, `render`, `util{heightAt,typeAt,bake,bakeChunk,gridHeight,chunkKey,hash}` | `design/levels/overworld_far.md` |
| **WorldDef** | `name`, `version`, `terrain` (recipe key), `time`, `structures[{id,level,origin{x,y,z},yawSteps}]`, `entities[{id,type,spawn|transform,...}]`, `state{}` | `design/levels/world_m1.js` |
| **UiStyle** | `fade`, `titleCard`, `hint`, `hints[]`, `crosshair`, `prompt`, `endText`, `pause`, `blink` | README 5 |

Level-data sub-shapes the engine interprets generically (game supplies the behaviour):
- `lights[]`: `{ id, preset (palette.lights key), x, y, z, on, color?, intensity?, radius? }` local meters -> `LightSet` entries in world meters.
- `props[]`: `{ id, model, variant?, x, y, z, facing, collide?, dynamic?, radius?, interactable? }` -> sprite instances + optional entities.
- `interactables[]`: `{ id, prop?, x, y, z, radius, prompt, interact: behaviourName, once?, requires?, target?{tag} }`.
- `triggers[]`: `{ id, type, cells?|shape+x,y,r, zMin?, once?, trigger: behaviourName, ...payload }`.
- sector `dynamic`: `{ ceilOpen, openTime, ease }` on a tagged sector -> `World.animateSector(tag, t)`.

The terrain recipe's `util` functions are **code inside content** (the reference implementation). M1/M2 call them through the registry (same as `palette.util.shade`). US-027 replaces this with engine-side implementations selected by `name`+`version`; the JSDoc must therefore mark `util` as "reference, replaceable".

## 7. World model (D-007)

```js
/** Anything physics/render may ask about the ground. Level, World and test stubs all satisfy it. */
/**
 * @typedef {Object} WorldQuery
 * @property {(x:number,y:number)=>Sector|null} sectorAt      world meters; null = no structure here
 * @property {(x:number,y:number)=>Sector}      outsideSector world meters; what null means for movement (Level: solid wall; World: terrain floor)
 * @property {(x:number,y:number)=>number|null} floorAt
 * @property {(x:number,y:number)=>number|'sky'|null} ceilAt
 */
class World /* implements WorldQuery */ {
  static load(def: WorldDef, assets: AssetRegistry, opts?: {events?: Events}): World   // engine.loadWorld passes engine.events
  terrain: Terrain|null                    // heightAt/farHeightAt/typeAt/normalAt (world meters), farH/farType, chunks 3x3 (7.2); null = no terrain (outsideSector = solid)
  structures: PlacedStructure[]            // { id, level: Level, origin: Vec3, yawSteps, bbox: {x0,y0,x1,y1} half-open, packed: PackedLevel (7.2) }
  structTable: Float32Array                // 8*8, GPU-ready mirror of structures (7.2)
  renderVersion: number  nextId: number    // 10 / 10.1
  spawn(type, transform, components, id?): EntityHandle   get(id)   remove(id)   flushEvents()   // 10.1, US-025 part
  entities: Entity[]                       // plain data, see 10
  state: Object                            // flat key/value game state (`tower.lever.pulled`), JSON-safe
  placeStructure(levelDef: LevelDef, origin: Vec3, id: string, yawSteps=0): PlacedStructure   // throws if yawSteps != 0 in M1
  structureAt(x, y): PlacedStructure|null  // bbox test first (structures.length is tiny), then footprint
  sectorAt(x, y)      // structure.level.sectorAt(x-ox, y-oy) if inside a footprint, else null
  outsideSector(x, y) // terrain floor sector: { floorH: terrain.heightAt(x,y), ceilH:'sky', solid:false, wallMat:'rock', floorMat: typeMat, ... } written into a REUSED scratch object (see 9)
  floorAt(x, y)       // structure floor or terrain height
  heightAt(x, y)      // terrain only (ignores structures) - for the terrain caster
  animateSector(tag, t01)                  // dynamic ceilings (US-014); writes legend entry AND packed cells, records `dynamics[tag]`, bumps renderVersion
  fireInteraction(id, ctx) / fireTrigger(id, ctx)  // look up def, call getBehaviour(name)
  entity(id): Entity|undefined  addEntity(e)  removeEntity(id)
}
```

Placement semantics: inside a footprint the structure owns floor, ceiling, collision and rendering; terrain is not drawn there (the sector pass leaves no span open inside its own footprint, and `castTerrain` skips cells whose (x,y) falls in a structure bbox). The outer ring of a structure must be flat or vary <= 0.3 m (US-016b rule); the recipe's `structureBlend` makes terrain meet the ring exactly, and `Terrain` passes `ringHAt(x,y)` = nearest outer-ring `floorH` into the recipe's `structures[i]` so the blend uses real level data.

Terrain: `heightAt` is analytic near (`recipe.util.heightAt`) and bilinear over the baked 8 m grid far (`gridHeight`); `Terrain.sample(x, y)` chooses by distance to the camera (near < 300 m). Far bake is amortised (<= 2 ms per frame) or in a Worker, must be bit-identical to a synchronous bake (checksum test), and `castTerrain` draws haze-only until `terrain.farReady`.

Camera and entities are in world coordinates. `castSectors` receives `origin` and converts once per frame (D-008 item 3, already implemented). Physics receives the `World` as `WorldQuery` and never converts (world coordinates in, world coordinates out).

### 7.1 Capsule movement rules (normative; US-008/US-009, `capsule.js` + `Player.update` -> `integrate`)

**Passability of a sector for a capsule** (`isSectorPassable(sector, footZ, grounded, {height, stepUpMax})`), in this order:
1. `null` -> impassable (defensive; `sectorOrOutside` must already have resolved it via `outsideSector`, D-008).
2. `solid` -> impassable at any height (wall tops are `floorH`, MAP_FORMAT v2 2.4).
3. Head clearance (numeric `ceilH` only): `max(footZ, floorH) + height > ceilH + SKIN` -> impassable. Uses the mover's *current* head height, so a lintel is a wall when approached from above/mid-jump and a doorway when approached at floor level. The `+ SKIN` (1e-6) tolerance is mandatory: after a ceiling clamp `z = ceilH - height`, `z + height` can differ from `ceilH` by an ulp and the mover's own cell would otherwise turn impassable (frozen step).
4. Floor: `floorH - footZ <= 0` -> passable (drops are always allowed; you fall). `0 < diff <= stepUpMax && grounded` -> passable (walked as a step). Otherwise impassable. **Step-up is gated on `grounded` only** - never on coyote time, never mid-air - which is what makes a running jumpless mover fall into a gap instead of bridging it.

**Step order inside one fixed step** (the same for `Player.update` today and `integrate()` after US-024; tests depend on it):
1. Facing from `controls`. Timers: `if (!grounded) coyote = max(0, coyote - dt)`; `buffer = max(0, buffer - dt)`. Clear the per-step flags `jumped`, `landed`, `stepDelta = 0`.
2. Jump decision: press edge -> `buffer = jumpBufferTime`; `if (buffer > EPS && (grounded || coyote > EPS)) { vz = jumpSpeed (set, not added); grounded = false; coyote = buffer = 0; jumped = true; peakZ = z }`. `EPS = 1e-6`.
3. Horizontal accel toward the wish velocity; rate scaled by `airControl` when not grounded (post-decision state).
4. `moveCapsule(world, x, y, vx*dt, vy*dt, radius, footZ = z, grounded, opts, out)`; velocity response: zero blocked face axes, clip against the corner normal when `v.n < 0`.
5. Vertical, gated on the **current** `grounded` (not the step-start value):
   - grounded: `|floorH - z| <= stepUpMax` -> `z = floorH`, `stepDelta = floorH - zBefore`; else leave the ground: `grounded = false; vz = 0; coyote = coyoteTime; peakZ = z`.
   - airborne: `vz -= g*dt; z += vz*dt; peakZ = max(peakZ, z)`; ceiling clamp `z = min(z, ceilH - height)` with `vz = min(vz, 0)` on clamp; landing `z <= floorH -> z = floorH; vz = 0; grounded = true; coyote = 0; landed = true; fallDistance = peakZ - z`.
6. `updateEyeFeel(feel, dt, body, cfg)`.

Semantics that follow (do not re-derive per story): coyote time is a jump *permission* after a **drop** only (a jump never grants coyote), alive for the drop step plus the next 5 steps at 60 Hz; the jump buffer holds a press for 6 steps and is consumed on the first grounded decision; holding the key never re-arms (edge only); `fallDistance` is apex-to-landing. Landing snaps `z` up by at most `|vz|*dt` (0.15 m after a 2 m fall) - accepted, masked by the landing dip. A neighbour cell overlapped by the circle's rim may be overshot vertically by at most one step's rise (`jumpSpeed*dt` = 0.108 m) before the next step's push-out - accepted, invisible from the centre camera, same class as `SKIN`.

Hooks: `jumped`, `landed`, `stepDelta`, `fallDistance` are plain per-step fields on the body (reset in step 1), read by eye feel, sound (US-020) and any camera code. No event objects and no callbacks from inside the step (rule 9.3). Eye feel is visual only and cannot clip a ceiling by construction: step-down keeps the eye at its old (proven-clear) absolute height and decays, bob `<= 0.03 < height - eyeHeight`, dip only lowers - so `getEyeTransform`/`Camera.fromEntity` need no world query.

### 7.2 GPU-ready packed layout (US-025 builds it, US-030 uploads it; D-009)

Rule: world geometry the renderer reads lives in flat typed arrays whose layout equals the texture layout, so US-030 uploads with `texImage2D`/`texSubImage2D` and never reshapes. Objects (`Level`, legend entries) stay the authoring/query view; the packed arrays are derived from them and kept in sync by the only mutator (`animateSector`).

```js
/** engine/world/packed.js - one per placed structure, built in placeStructure. Row-major, index = cy*w + cx (level-local cells). */
/** @typedef {Object} PackedLevel
 * @property {number} w  @property {number} h        cells
 * @property {Float32Array} geom  4*w*h: floorH, ceilH, topH, ceilOpenH   (RGBA32F texture). ceilH/topH 'sky' -> SKY_H = 1e30
 * @property {Uint16Array}  mats  4*w*h: wallMatId, floorMatId, ceilMatId, upperMatId  (RGBA16UI; MaterialTable ids, 0 = unresolved)
 * @property {Uint8Array}   flags w*h: bit0 solid, bit1 ceilSky, bit2 topSky, bit3 dynamic, bits4-7 dynamic tag index (R8UI)
 * @property {number} version       bumped on every write; uploader re-sends dirty rows [dirtyY0, dirtyY1]
 */
/** world.structTable: Float32Array(8*8), row s = [ox, oy, oz, w, h, yawSteps, cellSize, structSeq]; unused rows w = 0. */
/** Terrain: farH Float32Array(256*256) (R32F), farType Uint8Array(256*256) (R8UI), farVersion;
 *  near chunk h Float32Array(65*65) + type Uint8Array(64*64) + version; the 3x3 ring maps to a 195x195 atlas, slot = (cy mod 3)*3 + (cx mod 3). */
```

Rules: the sky sentinel is `SKY_H` plus the flag bit (never `Infinity`/`NaN` in textures); at most 8 placed structures are rendered per frame (the `structSeq` 3-bit field, 8.1); nothing in the packed arrays is serialized (rebuilt from content + `dynamics`).

### 7.3 Compositor: `renderWorld` over the G-buffer (US-025)

`engine/render/compositor.js`, the sequence in 8.1 for the common case:
1. `beginFrame(fb)` (depth, spans, gbuf.kind, `structSeq` = 0).
2. Structure order: bbox cull (behind the camera beyond the bbox, or nearer point farther than the palette fog far distance), then insertion sort **near to far** by distance from the camera to the bbox (0 when inside) into a preallocated `Int8Array(8)`. More than 8 survivors: cast the 8 nearest, bump `loop.stats.structuresCulled`, never wrap `structSeq`.
3. `castSectors(fb, s.level, cam, s.origin)` per structure. `castSectors` passes `opts.openSpans = fb.spans` to `castScene`: **caller-owned**, not reset and not copied back (the module-level `OpenSpans` and the copy loop go away; `beginFrame` is the only reset). A column already closed is skipped; rows outside `[top, bottom]` are not written; every rt/depth/gbuf write is depth-tested (`dist < depth[i]`). A camera outside the footprint enters the grid by slab-clipping the ray to the level bbox; cells outside the footprint are "open", never a wall. `structSeq` is incremented after each call (already in place).
4. `castTerrain(fb, world.terrain, cam)` (no-op until US-016; skipped when `terrain` is null or not `farReady`).
5. `computeDerivatives`, `lightSurfaces`, `shadeSurfaces`, `edgePass`, `fillSky` as in 8.1. Sprites/UI after.

Invariants: one structure at origin O with the camera translated by O produces the same cells, depth and gbuf as the bare level at origin 0 (G-buffer `u,v` are level-local, planeIds carry `structSeq`); no allocation; own overhead <= 0.05 ms. US-030 replaces step 3 (and later 4) with the GPU DDA over 7.2 and keeps steps 1, 2 and 5.

### 7.4 Gameplay systems: interaction, sector animation, rollers, triggers, fade, restart (US-012/013/014/017; architect, 2026-09-23)

Engine = generic mechanisms over level data. Game = named behaviours in `game/js/quest/`. Authoritative state lives only in entity data, `world.state` and `structure.dynamics` (all serialized). Every table below (`world.interactables`, `world.triggers`, tag maps, `inside` bits) is runtime, rebuilt by `World.load`/`deserialize`, never serialized. No allocation in any per-step function (rule 9).

**Fixed-step order** (the `update` in `game/js/main.js`, 60 Hz; each story adds only its own line):
1. `stepSectorAnims(world, dt)` (US-014), so collision sees this step's ceiling
2. `integrate(player, ...)` (existing; 7.1 step 3 multiplies the wish speed by `body.speedScale ?? 1`, US-013)
3. `stepRollers(world, dt, cfg)` then `resolveBodyContacts(world, player, cfg)` (US-013)
4. `updateTriggers(world, engine, player)` (US-017)
5. `updateInteraction(world, engine, eyePose, usePressed)` (US-012)
6. `stepAnimations(world, dtMs)`, then `world.flushEvents()`

**Used flags (generic).** An interactable or trigger with `once: true` writes `world.state['used.' + structId + '.' + id] = true` when its behaviour returns anything except `false` (the stubs return `false`, so they never consume). A used entry gives no prompt and never fires. `requires: '<state key>'` disables an interactable while that key is falsy (US-022 data becomes `requires: 'tower.lantern.taken'`). Behaviours may also set their own quest keys (`tower.lantern.taken`).

**Interaction** (`engine/world/interaction.js`):
```js
/** @typedef {{key:string, structId:string, id:string, name:string, x:number, y:number, z:number, radius:number, prompt:string,
 *   once:boolean, requires:string|null, propId:string|null, def:Object}} InteractableRec
 *   world coords (level x,y,z + origin); name = def.interact; propId = `${structId}.${def.prop}` (the US-011 prop entity id) */
world.interactables: InteractableRec[]                 // built in World.load from every structure's def.interactables
/** @typedef {{targetKey:string|null, prompt:string, dist:number, angleDeg:number}} InteractionState   world.interaction, one reused object */
findInteractTarget(world, eye: CameraPose, cfg: {reach?: 1.8, coneDeg?: 20}, out: InteractionState): InteractionState
  // candidate: not used, requires met, |p - eye| <= min(rec.radius, reach), angle(viewDir, p - eye) <= coneDeg, hasLineOfSight.
  // Winner: smallest angle, then smaller dist, then array order. viewDir = (sin yaw * cos pitch, -cos yaw * cos pitch, sin pitch).
updateInteraction(world, engine, eye: CameraPose, usePressed: boolean): void
  // fills world.interaction; on usePressed && target: fireInteraction(rec.name, {engine, def: rec.def, entity: world.get(rec.propId),
  // actor: world.get('player')}), used flag, emit 'interaction:fired' {key, name}, then the prop handle's 'interact' listeners (10.1).
hasLineOfSight(world, ax, ay, az, bx, by, bz): boolean
  // 0.1 m samples (<= 20 at 1.8 m), WORLD heights: inside a structure footprint use its level sector with floorH/ceilH + origin.z
  // (null sector or solid = blocked); outside any footprint use world.outsideSector(x, y) (terrain floor + sky, or solid with no terrain).
  // Blocked if solid, z < floor, or numeric ceil < z. Pure, no allocation; reused later by AI. (Amended 2026-09-24, US-012 review.)
```
UI: `engine/ui/crosshair.js` `drawCrosshair(rt, style, state: InteractionState)`. `style` = `uiStyle.crosshair` + `uiStyle.prompt`, passed in by the game (the engine never reads `ASSETS`).

**Attached lights (US-012 defines them, US-006 consumes them).** Entity component `light: { preset, on, attach: 'eye' | null, offset: {right, down, fwd} (m), sway: {amp} (m) }`, JSON only. `attachedLightPos(entity, eyeFeel, out: Float64Array(3))` (`engine/entities/attach.js`, pure) = eye position + offset rotated by the yaw only (the lamp does not swing with pitch) + sway (`amp * sin(bobPhase)` right, `0.5 * amp * |sin(bobPhase)|` down). US-006 adds `LightSet.syncEntityLights(world, palette)` per frame: an entity with `light` gets a slot (add on first sight, then `move`/`setOn`; remove when the component or the entity goes). Flicker comes from the preset, as for static lights.

**Sector animation** (`World`, US-014):
```js
world.animateSectorTo(tag, target01, {delay = 0}?): boolean   // false = no dynamic sector with that tag. Writes structure.dynamics[tag] = {t, target, delay}
stepSectorAnims(world, dtSec): void    // per dynamics entry with t != target: consume delay first, then move t toward target by dtSec / dynamic.openTime
                                       // (clamped, lands exactly on target), animateSector(tag, t). On arrival: emit 'world:sectorAnimDone' {structureId, tag, t01}
                                       // A tag resolves to the FIRST placed structure whose legend has it (structure.tagMap); two copies of one level share the tag (M1 limit).
```
`dynamics` gains `target` and `delay` (missing = `target: t`, `delay: 0`, so old states load). `animateSector` must use a `tag -> {structure, ch}` Map built in `placeStructure` (no `Object.keys(legend)` per step). `updateAnimatedSector` must write relief **into** the existing `packed.relief` (no new array per step). **GPU path, no new code:** `updateAnimatedSector` bumps `packed.version` and widens `dirtyY0/dirtyY1` (+1 row each side for relief). On the next frame `planFrameUpdate` (`WorldTextures.js`) `texSubImage2D`s exactly those rows of `GEOM`/`MATS`/`FLAGS` (relief = `FLAGS.g`), then resets them to -1. `structVersion` does not change, so the atlas is not rebuilt. The CPU caster and collision read the legend entry directly.

**Rollers** (`engine/physics/sphere.js`, `engine/physics/roller.js`, US-013; in-house, see US-013 for the Rapier evaluation):
```js
moveSphere(world, x, y, dx, dy, radius, z, opts, out: MoveResult): MoveResult   // = moveCapsule(footZ = z, height = 2r, stepUpMax = 0, grounded = true): drops pass, any rise blocks
stepRollers(world, dtSec, cfg): void          // entities with components.roller + body
resolveBodyContacts(world, actor, cfg): void  // actor capsule vs every roller
rollFrame(rollDist, radius, nFrames): number  // floor(rollDist / (2*PI*radius) * nFrames) mod nFrames
Level.tiltAt(x, y, out: {x, y}): out          // level-local; from def.layers.tilt + def.tilt (MAP_FORMAT extension): numpad dir * grade, '5' = toward tilt.hollowCenter (the sink centre), '.' = 0
```
Components: `body: {radius, vx, vy, vz, grounded}` + `roller: {restitution: 0.3, rollFriction: 0.8 (m/s^2), sleepSpeed: 0.05, rollDist: 0, sleeping: false, sleepT: 0}`. Roller step: `a = g * tilt - rollFriction * unit(v)` (friction clamps v at 0 and never reverses it); `v += a*dt`; `moveSphere`; a face hit does `v_axis = -e * v_axis`, a corner hit does `v -= (1+e)(v.n) n`; vertical as 7.1 step 5 with `stepUpMax 0` (drops fall and land with `vz = 0`). Sleep (review #1, 2026-09-23): `body.grounded`, `|v| < sleepSpeed` and `gravity*|tilt| < rollFriction` (the static-friction condition; "tilt 0" is not a float compare) for 0.25 s -> `v = 0`, `sleeping = true`; a contact impulse wakes it. `Level.tiltAt` gives full-`grade` ramps for the 8 numpad chars (never sleep-eligible when `g*grade > rollFriction`) and a sink `'5'` that tapers linearly to 0 at `tilt.hollowCenter` (`grade*min(dist,1)`), so a boulder rests inside the disc `dist < rollFriction/(g*grade)`. It writes `transform.x/y/z`, `rollDist += |dxy|`, `yawDeg` = motion heading (the sprite direction key), and `sprite.frame = rollFrame(...)` with `sprite.playing = false`.
Contacts: horizontal circle vs circle, only when the z ranges overlap; `n = unit(actor - roller)`. Push: if `vp.(-n) >= cfg.pushMinSpeed (0.5)`, the roller gets `v_n = max(v_n, vp.(-n))` along `-n` and wakes, and the actor gets `body.speedScale = cfg.pushSpeedScale (0.5)` for the next step (otherwise 1). Separation: move the roller out by the overlap along `-n` with `moveSphere`; move any remaining overlap out of the actor along `+n` with `moveCapsule`; if more than 1e-3 m still overlaps, restore the actor to its step-start x, y = `body.prevX/prevY`, recorded by `integrate` on entry (non-overlapping by induction) and zero its velocity component toward the roller. Invariant (tested): no overlap > 1e-3 m at the end of any step. Budget <= 0.02 ms per step for one roller.

**Triggers** (`engine/world/triggers.js`, US-017): `TriggerRec {key, structId, id, name, once, shape: 'cells'|'circle', mask: Uint8Array(w*h)|null, x, y, r, zMin, def, inside}`. For cell triggers, the cells are every cell whose legend `tag === 'trigger:' + id`. If there are none, `def.cells` (`[cx, cy]` list) is used; if both exist and differ, the loader warns once. `updateTriggers(world, engine, actor)`: actor feet -> structure-local cell (or circle + `z >= zMin`); an enter edge (`inside` 0 -> 1) calls `fireTrigger(name, {engine, def, entity: actor})`, sets the used flag and emits `'trigger:fired'` {key, name}. `inside` is runtime only: after a load, standing inside counts as an enter, and the used flags block repeats.

**Fade** (`engine/ui/fade.js`, the `uiStyle.fade` rule as engine code; the ramp arrives as data): `createFadeLut(ramp: string, letterIndex, minGain): FadeLut` (`{idx: Uint8Array(128), ramp: Uint8Array, minGain}`). `fadeGlyph(code, a, lut): number`: `i` = ramp index of `code` (letters, digits and anything else not in the ramp = `letterIndex`), result `ramp[round(a*i)]`, space at `a = 0`. Colours: `fg *= minGain + (1-minGain)*a`, `bg *= a`. `fb.sceneFade` (1 = off) applies to **non-mask cells only**, so UI text stays independent: on the CPU path `applySceneFade(rt, a, lut)` runs **after `sprites.render`** (sprites are plain non-mask cells and fade with the scene; the call site is the game loop, not `renderWorld` - arch review US-017 #1); on the GPU path `uSceneFade` + a `FADELUT` R8UI texture go into the final composite pass (sprite pass F), so both paths fade the same set of cells and `?gpucompare=1` can compare a `sceneFade = 0.5` pose. UI text fades by calling `fadeGlyph` before `drawText` (US-015 uses the same helper).

**Restart / world swap.** `engine.setWorld(world)` (new): sets `engine.world` and `world.events = engine.events`, then emits `'world:loaded'`. `main.js` keeps `initialState = serialize(world)` taken right after load; R calls `engine.setWorld(deserialize(initialState, assets))`. The GPU pipeline already rebuilds the atlas when the world object changes (`GpuCellPipeline._worldAtlasWorld`). `'world:loaded'` subscribers rebuild their runtime state (LightSet, handle listeners, game UI). Rules learned in the US-017 review: anything that holds a per-world object (`fb.lights`, `PlayerLook`) must be re-bound in the handler or per frame, never captured once at start-up; DOM-listening helpers (`PlayerLook`) are `dispose()`d before being rebuilt. Rule: game state that must reset lives in `world.state` (`hints.shown`, `ui.mapCard.shown`, `quest.endT`); module-level game variables are reset only in the `'world:loaded'` handler, never by a hand-written reset list.

### 7.5 Props from level data, animation player, lit/emissive sprites (US-011; architect, 2026-09-24)

Reuses 10.1 (handles, clips, `stepAnimations`), 14.2 item 4 / US-030c (`SpritePool`, atlas, GPU sprite pass), 14.3 (lights). D-017: the GPU pass ships; `drawSprites` is the oracle only.

**Split.** Engine: prop spawn, clip player, atlas variants, per-sprite lighting (generic, no model/prop names). `game/js/quest/`: `lantern.take` / `lever.pull` / later `relay.wake` change sprite state through the handle. Design data: `design/levels/tower.js` gets the `levelPatch.tower` edits **once, by hand, in this story** (props replace/add, light `beacon` -> preset `relay` z 7.7 `on: false`, prompts, `!`/`P`/`& $ %` material swaps); set `levelPatch.tower.status` to `APPLIED (US-011, <commit>)`. There is **no runtime patch applier** (the patch stays preview/documentation data). Old model keys (`pallet`, `beaconBowl`, anim `hookEmpty`) stay as their own registry entries; no engine alias mechanism.

1. **Prop spawn** (`World.load`, right after `interactables`): for each placed structure and each `def.props[i]` -> `w.spawn('prop', {x+ox, y+oy, z+oz, yawDeg: facing||0, pitchDeg: 0}, comps, `${structId}.${id}`)`. `z: 'ground'` = `w.terrain.heightAt(x, y)` (warn + 0 if no terrain). Skip without a warning: `model` starting `decal:` (US-021) and entries with `from`/`to` (chains). Unknown model: throw with the prop id (same as other load errors). `comps.sprite = {model, anim, t:0, frame:0, loop, speed:1, playing:true}` via the 10.1 normalizer. `dynamic: true` adds `body {radius, vx,vy,vz:0, grounded:true}` + `roller: {}` exactly like `boulder.test.js` builds it today (that test then uses the generic spawn), and `transform.z` = feet (the roller already sets `sprite.frame`, `fps: 0`). **Save/load**: if `def.entities` already contains that id (the `deserialize` path), skip the prop spawn so the saved entity wins; ids stay stable.
2. **Animation names.** Resolution at spawn: a string `variant` (or legacy `pose`) is the anim name (README 4); if the model has no such anim, use its first animation and warn once. A **numeric** variant selects `model.variants[n]`: the atlas packs each as model key `${key}#${n}` (full + half), and spawn writes `sprite.model = 'rubble#1'`. At runtime `sprite.anim` is the only anim field the engine reads: behaviours call `handle.play(name)` (10.1). `lantern.take` becomes `entity.play('empty')` (it may keep writing `variant: 'empty'` for readability; update the US-012 test to assert `anim === 'empty'`). `lever.pull` calls `play('pull')` (non-looping, holds DOWN at the end; no `onAnimEnd` switch needed, and the held frame survives save/load). Lever `pose: 'up'` in tower.js -> `variant: 'idle'`.
3. **Clip player** = 10.1 as specified (`play/stop/onAnimEnd`, `stepAnimations(world, dtMs)` in the 60 Hz step after `stepRollers`, event ring flushed after the step). Remove the US-024 stubs. Half LOD uses the **same frame index** (designer guarantees equal counts; `project()` already wraps by count). `fps: 0` clips are never advanced by `stepAnimations`. Budget: <= 0.05 ms / step for the tower's ~20 props.
4. **Per-sprite light** (replaces the single `light` arg of `pool.project`): `project(cam, rt, lights, world)` calls `lightAt(lights, world, x, y, z + 0.5*world.h, 0,0,1, scratch, idx, n)` per visible sprite with the same flicker time as the surfaces (`LightSet.update` already ran this frame), `nf = 1` (README 4 allows it; normals later). The result goes into T3 as today, so both paths get the identical multiplier (parity by construction). Cost: <= 64 sprites x <= CPU_LIGHT_CAP lights, target <= 0.1 ms. Emissive cells (burner flame/embers, relay crystals when `awake`) already bypass light and fog via atlas bit b0 in both `sprites.frag` and `drawSprites`; nothing new.
5. **Lights stay level data.** `def.lights` is the only source of point lights (brazier/burner `torch` at 18.5, 6.5, 1.2; `beacon` -> `relay`, off). A model's `light` field is documentation for the designer/US-022, the engine does **not** auto-create lights from it (would double the torch). US-022 later: `relay.wake` plays `wake`, and at `wakeLightFrame` (frame tag via model `events`) does `lights.setOn` + the `grow` ramp; glow anchor = `mounts.glow` of the current LOD tier, world height `(anchor.y - y + 0.5) * world.h / size.h`. Not in US-011 scope except: the relay spawns `dead`, and the preset swap must load.
6. **Parity.** `?gpucompare=1` must compare the **real prop pool** of the current pose (after `pool.collect(world)` + `project`), not only `placeCompareSprites`; keep the synthetic set as a second pose. Poses to add to the compare set: crash room (burner lit + lamp + gondola + heap + rubble, near LOD), lamp `empty`, lever mid-`pull`, boulder mid-roll, relay at half LOD. US-029 thresholds unchanged.
7. **Tests (node, headless).** `engine/entities/animation.test.js`: the 10.1 clip test ([100, 50] durations, tags, `animEnd` once, `fps: 0` untouched, allocation-free step). `engine/world/world.test.js` additions: tower props spawn with ids `tower.<id>`, world coords = level + origin, `decal:`/chains skipped, numeric variant -> `rubble#n`, dynamic boulder has body+roller, `serialize -> deserialize` gives the same entity set (no duplicates) and keeps `anim/frame`. `sprites.test.js`: atlas contains `rope#0/#1`, every tower model packs full + half; per-sprite light differs near vs far from the burner. Quest tests: `lantern.take` -> `anim 'empty'`, `lever.pull` -> `anim 'pull'`, frame 4 after 0.4 s. `node tools/check-deps.mjs` clean. Browser: `?gpucompare=1` passes on the new poses; closes the deferred visual checks of US-012 (bracket stays), US-013 (boulder visible and rolling), US-014 (lever + gear animate, grate rises).

Do not: read `window.ASSETS` or tower ids in engine; allocate in `collect`/`project`/`stepAnimations`; blend frames; hard-code prop positions in `main.js`; add a runtime `levelPatch` applier.

**Review 1 outcome (2026-09-24, 74969d7): ARCH OK.** Rules that came out of it: (a) `components.sprite.loop` is the serialized truth - `stepAnimations` honours it and falls back to the clip's `loop` only when the field is undefined (hand-built sprites in tests); `World.spawn` does not default it, the prop spawn copies it from the anim def, `play()` from `opts.loop ?? anim.loop`. (b) A `?gpucompare=1` pose must actually frame what it names (check the bearing against the 37.5 deg half-FOV and that the camera cell is open) - the first boulder pose did neither. (c) **Known parity gap BUG-LIGHT-001** (14.3): the GPU light pass lights `cellRayP(cell, depth)` while `lightAt()` lights the caster's exact hit point; at depth discontinuities (a far step top over a near wall face) the two points can fall on different sides of a vis-grid/sun shadow edge - a lit/unlit flip on a few surface cells. Not a sprite issue; fix direction in the bug (light the same point on both paths; nudge the vis sample toward the light, not only along `N`).

### 7.6 UI panels, rich text, scene dim, hints, wake sequence (US-015; architect, 2026-09-24)

Reuses 7.4 (triggers, fade LUT, restart rules), US-012 `drawCrosshair`. D-017: the GPU path ships; CPU twins are oracles.

**Split.** Engine, generic, no strings or model names: `engine/ui/richText.js`, `engine/ui/panel.js`, `engine/ui/sceneDim.js` (+ its pass-F hook), `Input` additions; all exported via `engine/index.js`. Game: `game/js/quest/wake.js` (wake + title timeline), `game/js/quest/mapCard.js` (show-once, `M` rules), `game/js/quest/hints.js` (hint controller), `game/js/ui/titleCard.js`, `game/js/ui/endCard.js` (rewritten to read `uiStyle.endText`), `hint.show` behaviour. The `M` binding and every text/number come from `ASSETS` via `main.js`.

**1. Rich text** (`engine/ui/richText.js`; also fixes the one-colour `endCard.js`):
```js
/** @typedef {{n:number, codes:Uint8Array, rgb:Uint8Array}} RichLine   n glyphs, rgb = 3 bytes per glyph; built at load, never per frame */
compileRichLine(text, baseRgb, keyRgb, keys: string[]): RichLine   // every occurrence of each `keys` substring gets keyRgb
drawRichLine(rt, x, y, line, a = 1, lut = null, count = line.n, bgRgb = BLACK): void
  // a < 1: fadeGlyph + fg gain (7.4 fade rule, lut required); count = typewriter prefix; setCellRGB (mask cell)
```
**2. Panel** (`engine/ui/panel.js`; map card now, US-021 log and dialogue later):
```js
/** @typedef {{w, h, nFrames, codes:Uint8Array(nFrames*w*h) (0 = transparent), rgb:Uint8Array(nFrames*w*h*3), durMs:Float64Array, loopMs}} PanelArt */
buildPanelArt(model, palette, animName = 'show'): PanelArt      // load time; model per design/README.md 5 (base rows + per-frame key overrides)
createPanel(art, {fadeIn, fadeOut, sceneMul, plateMul, platePad}): Panel
// Panel = {state: 'closed'|'opening'|'open'|'closing', a: 0..1, openSec, x0, y0}  (runtime only; plain fields)
panel.open(); panel.close(); panel.step(dtSec)                   // 60 Hz step: a ramps linearly by fadeIn/fadeOut; openSec counts while state != closed
panel.layout(cols, rows, top, centerX, uiGrid)                    // UI-grid rule (item 4)
panel.pushDim(dim)                                                // before render: all = lerp(1, sceneMul, a); rect(panel + platePad) = lerp(1, plateMul, a)
drawPanel(rt, panel, timeMs, lut)                                 // after render + CPU dim: frame by timeMs % loopMs, skips code 0, fadeGlyph at panel.a
```
The panel knows nothing about "first show", `minShowSec`, or keys: those are game rules (`mapCard.js`).

**3. Scene dim** (`engine/ui/sceneDim.js`, a sibling of `sceneFade`): `fb.sceneDim = {all: 1, n: 0, rects: Float32Array(4*5)}` (rect = `x0, y0, x1, y1` half-open scene cells, `mul`). `resetSceneDim(d)` each frame, `pushDimRect(d, x0,y0,x1,y1, mul)` (max 4, warn once beyond). Per non-mask cell `k = min(all, mul of every rect containing it)`; `fg.rgb` and `bg.rgb *= k`, glyph unchanged. CPU `applySceneDim(rt, d)` right after `applySceneFade` (same call site, after `clearMaskForSceneFade`, same `(v*k)|0` bytes). GPU: `spritesPass` mirrors it into `uDimAll`, `uDimCount`, `uDimRect[4]`, `uDimMul[4]`, applied in `sprites.frag` after the fade block; identity (`all == 1 && n == 0`) is skipped. Users: map-card dim 0.35 + plate 0.18, hint plate 0.35 (replaces the fixed `plateBg` look for hints; the US-012 prompt keeps its `plateBg`). UI glyph cells are mask cells with a black bg (the plate around them is dimmed scene); a true "fg-only" UI cell is a later option, not M1.

**4. UI grid rule (M1).** `uiStyle` layout numbers are in the 160x60 UI grid. UI is still drawn in scene cells (1 glyph = 1 cell, as crosshair/end card today): scale the element's **centre** (single lines: its row) by `s = rt.rows / uiGrid.rows` (x: `rt.cols / uiGrid.cols`), round, keep sizes in cells. The `uiScale.mode 'layer'` (second presenter layer, scaled glyphs) is not in US-015; it becomes an engine story only if the owner's 240/320 legibility look asks for it.

**5. Input** (`engine/core/input.js`, generic): `mousedown` button 0 -> pressed code `'Mouse0'`; `anyPressed(): boolean`; `consumePressed()`: every code pressed this frame is removed from `pressed` and ignored by `isDown` until its own keyup ("the dismissing key is consumed"). `GAME_KEYS` += `KeyM`, `KeyN`. `N` is reserved for mute (US-020); nothing binds `M` to mute. While a panel is up or input is locked (wake), `main.js` feeds zero controls and `PlayerLook` still drains the mouse delta (no look jump on close). Esc: the browser exits pointer lock itself; the card closes and the pause overlay shows - accepted, not fightable.

**6. State (7.4 restart rule).** Persistent, in `world_m1.js` `state` (reset by restart through `initialState`): `quest.wakeT` (0, counts up in the step), `ui.mapCard.shown`, `ui.mapCard.dismissed` (first dismissal), `ui.mapCard.opened` (first `M`), `hints.shown` (existing array of ids), `hints.done` (new array: actions performed, shown or not), `hints.walkT`, `hints.chartT` (-1 = unarmed, else seconds left). Runtime (rebuilt only in the `'world:loaded'` handler): panel state, hint FIFO queue + current hint phase, compiled RichLines stay (asset-derived). The used flags of `hintBurner`/`hintClimb` reset with the same deserialize.

**7. Hints** (`game/js/quest/hints.js`): the list = `uiStyle.hints` + `uiStyle.storyHints`, compiled once. `request(id)`: ignore if in `hints.shown`/`hints.done` or `on.skipIfState` is truthy; else enqueue (once). One on screen, FIFO; fade 0.3 in / 0.5 out, 8 s timeout; pushed to `hints.shown` when it first appears. Sources: `event` = direct call from `mapCard.js` on first dismissal (game modules call each other; no engine event needed); `walkTime` = `hints.walkT` while grounded and moving; `timer` = `hints.chartT` armed to 20 on first dismissal; `pointerUnlocked`; `zone` = the `hint.show` behaviour: `quest/index.js` exports `registerQuestBehaviours({hints})`, and `hint.show` calls `hints.request(ctx.def.hint)` and returns `true` (the once flag is consumed even when skipped; a skip by `skipIfState` is permanent for these keys). Done predicates are a small id -> function table in `hints.js` (move/look input, run, jump, pointer locked, `tower.lantern.taken`, `M` pressed); a done action pushes `hints.done` even before the hint shows, so it is never shown later.

**8. Wake + map card (game).** `wakeFrame(t, cfg, out)` is pure: black 0-1 s, blink per `uiStyle.blink.curve`, rise `def.start.eyeH` -> body `eyeH` over 1.2 s (eye height via `Camera.fromEntityInto(entity, eyeH)`, pitch `def.start.pitchDeg`), `inputLocked` until the rise ends, title 1/3/1 s; exact offsets as `design/preview/title.html` plays them. The eyelid is black mask cells over scene rows (+ ember edge row). `mapCard.js`: first show 0.5 s after the title out (`ui.mapCard.shown`), dismiss after `minShowSec` on `anyPressed()` -> `consumePressed()`, `panel.close()`, `ui.mapCard.dismissed = true`, arm hints. `M` opens only if `dismissed && quest.endT < 0 && wake done`; while open any key closes (consumed); first `M` sets `ui.mapCard.opened` and marks the chart hint done.

**9. Budget / tests.** UI total <= 0.1 ms per frame (card 52x14 = 728 cells); no allocation in `step`, `pushDim`, `drawPanel`, `drawRichLine`, hints update (tested with the `compositor.test.js` pattern). Node: `engine/ui/richText.test.js`, `panel.test.js` (fade times, layout centre at 160x60/240x90/320x120, frame by time, transparent cells untouched), `sceneDim.test.js` (min rule, mask skip, identity), input test with a fake `EventTarget` (consume until keyup, `Mouse0`); `game/js/quest/hints.test.js` (FIFO, one on screen, skipIfState, done-before-shown never shows, chart 20 s + cancelled by `M`, 8 s timeout, restart via deserialize resets all), `wake.test.js`, `mapCard.test.js` (gating during wake/end, min 1.0 s, consumed key); `tower.test.js`: both zones present, spawn outside `hintBurner`, lamp inside, circles disjoint; end-card test: strings, per-line colours, `[R]` key colour, cursor from `uiStyle.endText`. `sprites.test.js`: `uDim*` uniforms and identity skip. Browser: `?gpucompare=1` pose "card open" (dim 0.35 + plate rect) PASS. `node tools/check-deps.mjs` clean.

Do not: put texts, key codes or `minShowSec` logic in `engine/ui`; read `ASSETS` in engine; use alpha blending for UI fades; keep hint/card flags in module variables that survive a restart.

### 7.7 Sprite opacity (`fill`) and optional outline (BUG-OWN-003, ART-OWN-001; architect, 2026-09-24)

**Diagnosis.** (1) Main cause: neither path ever writes a sprite bg. `drawSprites` passes `bg[bi..]` (the wall) and `sprites.frag.js` writes `outBg = ebg`: a sprite cell is "glyph over the wall/floor colour", so a canvas `)~(` or a lever `|` reads as a pattern painted on the stone (README 4 "sprites have no background" is the rule that causes it). (2) Interior holes: a space glyph or a space fg key is `a = 0` (transparent); probe over every billboard: gondola 10, envelopeDrape 8 (the burnt tear is intended), beaconBowl 4, beaconFire 6 interior holes per frame; canvasHeap, lever, boulder, rubble, burner: 0. So canvasHeap/lever are case (1) only. (3) Not causes: the edge/detail pass runs before the sprite composite in both paths (compositor.js / pass F) and never touches sprite cells; fog only blends fg; fade/dim hit all non-mask cells alike; the atlas alpha is only the transparency bit + US-016's emissive `fogMax` code (`a = 1 + round(fogMax*254)`) - no blending anywhere. No existing frame has a space glyph with a non-space key (or the reverse), so the new rule below changes no current data.

**1. Data (design/README.md section 4).**
- Model `fill: { k?: number }` (default `k = 0.45`; absent = today's cutout behaviour). Per key `fill: false` opts that key out (ropes, chain links, flames, glints stay glyph-only).
- A filled cell writes **bg = its own shaded fg colour x k** (like material `bg: darken`), so the glyph sits on a plate of its own colour and fully covers what is behind.
- **Opaque space**: a cell with glyph `' '` and a **non-space** fg key is a filled interior cell (glyph space, bg plate in that key's colour; requires the model `fill`). A cell with a space **fg key** stays a hole (tears, gaps between spokes). This is the only way to be see-through inside the silhouette.
- Validation (`buildSpriteAtlas` throws, like unknown keys): opaque-space cell in a model without `fill`, or on a key with `fill: false`.

**2. Atlas encoding (`spritesAtlas.js`, no new texture, no collision with US-016).** `b` = `emissive (bit0) | normal << 1 (bits1-3) | FILL (bit4, 16) | RIM (bit5, 32)`; `a` unchanged (0 = transparent, else US-016 fog code). Opaque space = `r = 0, g = key colour, b |= 16`. Per-model `k` goes into the free per-sprite texel `spr[o+15]` (T3.w, "fillK", 0 when the model has no fill), written by `project()` from `atlas.models.get(key).fillK`. Export `SPRITE_FLAG_FILL = 16`, `SPRITE_FLAG_RIM = 32` next to `NORMAL_CODES`.

**3. Shading, identical in both paths** (after the existing fg math, same fog blend, same `toByte`): `if (b & 16) bg = fgRGBbeforeToByte * fillK` (lit + fogged fg, emissive uses its capped `fe` colour) else `bg = wall bg` (today). GLSL: `outBg = vec4(((tx.b & 16u) != 0u) ? rgb * fillK : ebg.rgb, 1.0)` with `fillK = texelFetch(uSpr, ivec2(3, s), 0).w` taken with `mul` of the winning sprite. JS: `setCellRGB(x, y, A[t], toByte(r), toByte(g), toByte(bl), fill ? toByte(r*fillK) : bg[bi], ...)`. Same multiply order in both (`rgb * k` of the pre-byte f32/f64 value; the 1-LSB tolerance of US-029 covers f32 vs f64). Visibility rule unchanged: a non-emissive sprite below `cutoff` is skipped entirely, plate included.

**4. Outline / rim (ART-OWN-001, optional per model, cheap).** Model `outline: { k?: number }` (default 0.4). The packer pads each frame of that model by 1 cell on every side (LodEntry gets `pad: 1`, `size`/`anchor` of the padded frame) and marks every transparent cell 4-adjacent to an opaque one as a RIM texel: `r = dirMask` (1 = opaque neighbour left, 2 right, 4 up, 8 down), `g = 0`, `b = 32`, `a = 1`. `project()`: `scale = rowsOnScreen / (lod.size.h - 2*lod.pad)` (padding must not shrink the prop), rect from the padded size/anchor as today. `outlineK` (model constant, 0 = no outline) needs a slot: extend SPR to **5 texels** (`SPR_TEXELS = 5`, T4 = `(outlineK, 0, 0, 0)`; `sprites.frag.js` / `spritesPass.js` texture width 5), fetched only for the winning RIM candidate. A RIM texel draws only on the **one screen cell** next to the silhouette: for each set dir bit test whether the neighbouring screen cell maps to a different sprite cell, e.g. right: `floor(fround((x+1-x0)*invScale)) != sx` (left `x-1`, down `y+1`, up `y-1`, same f32 multiply as the main sample), else treat as transparent (`continue`) - so the outline is 1 cell thick at any scale. A RIM hit takes part in nearest-wins like an opaque texel (a near prop's rim darkens a farther prop - correct occlusion edge) and records `spriteDepth`; it keeps the underlying glyph and multiplies **both** fg and bg of the edge-pass cell by `k' = k + (1-k)*fogF` (fades out in fog). Cost: <= 4 extra int/f32 ops per rim candidate, no extra atlas fetch; well under 0.05 ms JS and noise on the GPU. Rim does not apply to `fill`-less far billboards unless the model asks for it.

**5. Parity / tests.** `sprites.test.js`: atlas bits (opaque space -> `r 0, b&16`, hole stays `a 0`, validation throws, `fill:false` key has no bit); `fillK` in T3.w; JS draw over a known wall bg: filled cell bg = `toByte(fg*k)`, unfilled = wall bg, opaque-space cell glyph 0 + plate; rim: padded size/anchor, scale unchanged vs unpadded (same on-screen rows), rim exactly 1 cell thick at scale 1, 2, 3, never inside the silhouette, `k'` with fog, nearest-wins vs a farther sprite; GLSL source contains `& 16u` / `& 32u` branches; US-016 `fogMax` alpha round-trip still passes. Browser `?gpucompare=1` + `?spritecompare=1`: add pose "crash room near" (canvasHeap at 1.5 m, envelopeDrape tear in frame, lever on the wall at 2 m, one model with `outline`), US-029 thresholds unchanged. No allocation added (flags are ints read from the atlas; `fillK`/`outlineK` from `spr`).

**Designer vs engine.** Engine gives: `fill` plate, opaque-space interior, optional 1-cell `outline`. Designer does: set `fill` on solid props (canvasHeap, envelopeHeap, envelopeDrape, gondola hull, boulder, rubble, burner, relay, lever housing), `fill: false` on rope/chain/flame keys, turn unintended interior holes into opaque-space or real glyphs (gondola, beaconBowl), keep the drape tear as a space-key hole; pick fg colours with clear value contrast against `stoneMid/stoneDark` walls (the lever's brass/wood is near the wall's value) and dense glyphs on the silhouette (`#@HM` over `|/-`); consider a larger lever (`world.w 0.35 m` is 1-2 cells wide at 3 m) and `outline` on the lever and the small ground props. Do not: add alpha blending or a bg texture per sprite; change the `a` channel meaning (US-016 owns it); make `fill` the engine default (content decides).

## 8. Frame pipeline and budgets

```
rAF tick
  sim: while (acc >= 1/60 && steps < 5): input.beginStep(); integrate(player) ; world.update(dt) [dynamics, boulder, behaviours]; input.endStep()
  render(alpha):
    cam = Camera.fromEntity(player, eyeH + bob/dip)                     (US-005/009)
    beginFrame(fb)                       depth <- Infinity, spans <- [0, rows-1] per column
    for each structure sorted by distance to cam:  castSectors(fb, s.level, cam, s.origin)
    castTerrain(fb, world.terrain, cam)  only in the open spans; far LOD (M1), near+far (M2)
    fillSky(fb, cam)                      remaining open rows
    drawSprites(fb, world.sprites(cam), cam)   depth test against fb.depth
    quest/UI: overlay.draw(rt) + drawText(...)   emissive (no light/fog), never depth-tested
    rt.present()                          2 texSubImage2D + 1 drawArrays (GPU)
    loop.stats: per-pass ms (F3 overlay, US-018)
```

**Budget (JS, per frame, D-007), measured by `performance.now()` around each pass and shown on F3:**

| Pass | Budget | Notes |
|---|---|---|
| sim (all steps) | <= 1.0 ms | usually 1 step; 5 steps only after a hitch |
| castSectors | 2-3 ms | includes lighting of surface cells (US-006/007); today 6-9 ms ambient-only, see 12 |
| castTerrain | 2-3 ms | far LOD <= 4 ms hard cap at the breach (US-016), 3 ms with near LOD (US-026) |
| fillSky | <= 0.3 ms | 160x60 worst case is a full sky; LUT the gradient per row |
| drawSprites | <= 1.0 ms | ~10 sprites, nearest sampling |
| UI + text | <= 0.5 ms | |
| present | ~0.1 ms CPU | GPU does the pixels (D-005) |
| **total** | **<= 8 ms** | 60 fps with margin on a normal laptop; no frame > 25 ms in a 60 s walk (US-018) |

The compositor's correctness contract: after `fillSky`, **every cell has been written exactly once by exactly one pass** except sprites/UI, which overwrite. Overdraw is a bug, not a cost (see 12).

`OpenSpans` (replaces the `openSpans` object array, PO decision on US-004; mandatory by US-016):

```js
class OpenSpans {                           // engine/render/OpenSpans.js
  top:    Int16Array(cols)                 // first open row, inclusive
  bottom: Int16Array(cols)                 // last open row, inclusive; top > bottom = column closed
  depth:  Float32Array(cols)               // distance at which the sector pass gave up (meters; Infinity if it never started)
  reset(rows)  isOpen(x)  narrowTop(x,row)  narrowBottom(x,row)  openCount()
}
```

### 8.1 Deferred surface shading: G-buffer, detail shader, edge pass (US-028)

Casters do not shade. They write one **surface sample** per cell into `fb.gbuf`; three grid passes then produce the pixels. Reason: glyph choice needs neighbour cells (texture derivatives, edges) and lighting (US-006) needs the surface normal, so shading must run after all geometry of the frame is known. Pass order in `renderWorld`:

```
beginFrame(fb)                    depth <- Infinity, spans reset, gbuf.kind <- 0, structSeq <- 0, gbuf.writeCount <- 0
castSectors(fb, level, cam, o)    per structure: writes gbuf sample + depth, narrows spans. NEVER writes rt.
castTerrain(fb, ...)              US-016: may write rt directly (kind stays 0) or samples; decided in US-016 notes
computeDerivatives(fb)            dudx/dvdx/dudy/dvdy from same-planeId neighbours (fallback: analytic)
lightSurfaces(fb)                 US-006: fills fb.light.rgb per cell (N.L, visibility); US-028: uniform ambient
shadeSurfaces(fb)                 per cell: v2 detail shader or v1 fastShade -> rt.setCellRGB, gbuf.fogF
edgePass(fb)                      decides rules from gbuf+depth, then patches rt.cells glyph/fg bytes in place
fillSky(fb, cam)                  open spans -> sky, depth Infinity (unchanged)
drawSprites / UI                  unchanged
```

```js
/** Struct-of-arrays, N = cols*rows, allocated in createEngine/resize only.  engine/render/GBuffer.js */
class GBuffer {
  kind:    Uint8Array    // 0 none/sky, 1 wall, 2 step, 3 upper, 4 floor, 5 top, 6 ceil
  mat:     Uint16Array   // MaterialTable id (0 = unresolved)
  face:    Uint8Array    // 1 N, 2 E, 3 S, 4 W, 5 U, 6 D  (direction the face looks toward)
  planeId: Int32Array    // (structSeq<<28)|(tag<<24)|(coord&0xffffff); walls tag=face, coord=int boundary;
                         // planes tag=kind, coord=round(h*1000)+0x800000. Equal <=> same infinite plane
  u, v:    Float32Array  // v1 texture coords (walls: along-wall m, height m; planes: level-local x, y)
  dudx, dvdx, dudy, dvdy: Float32Array   // per screen column / row (computeDerivatives)
  z:       Float32Array  // m above the near sector's floor
  aoD:     Float32Array  // m to the nearest concave seam, Infinity if none
  fogF:    Float32Array  // fog factor written by shadeSurfaces, read by edgePass
  rule:    Uint8Array    // edge rule 0..8 written by edgePass (debug/bench)
  writeCount: number     // samples written this frame (bench invariant: + sky writes == N)
  writeSample(i, kind, mat, face, planeId, u, v, z, aoD): void    // the ONLY write site in a caster
  readSample(i, out): SampleObj                                   // test/oracle helper; reuses `out`
}
/** @typedef {{ uniform: boolean, rgb: Float32Array }} LightBuffer  uniform: rgb has 3 entries; else 3*N (US-006) */

// engine/render/MaterialTable.js  -- built once per palette/detailPass/cellAspect binding, never per frame
bindShading(palette: Palette, detailPass: DetailPassDef|null, cellAspect: number): MaterialTable
   // one Uint16 id per key in palette.materials and detailPass.materials; record = { v1: FastShadeRec, v2: DetailMaterialRec|null }
   // resolution: detailPass.materials[key] -> v2 (+ its .v1 for the v1 path), else detailPass.remap[key] -> v2, else v1 only
   // detailPass.levelOverrides is ignored by the engine (level data is edited instead)
MaterialTable.bindLevel(level): void   // once per level instance: sector.{wall,floor,ceil,upper}MatId + relief bit masks (floorRise, ceilDrop)

// engine/index.js additions
export function computeDerivatives(fb: FrameBuffers): void
export function shadeSurfaces(fb: FrameBuffers): void
export function edgePass(fb: FrameBuffers): void
```

Rules:
1. **Depth is `dist`**: the G-buffer never duplicates `fb.depth`.
2. **Sky and unwritten cells are `kind 0`** and are "farther" for the edge pass; `fillSky` never touches the G-buffer.
3. **Hashes are world-anchored**: inputs are texture-space integers (`floor(u*detail)`, block indices, seed). Never a screen index or the frame count. Level-local `u,v` mean a structure keeps its texture wherever the world places it.
4. **Light is an input, not a computation, of `shadeSurfaces`**: `fb.light` (uniform in US-028, per cell from US-006). Light-source loops belong in `lightSurfaces`.
5. **Per-cell bans in the shading and edge passes** (in addition to 9): `Math.pow` (use level thresholds `(k/n)^(1/gamma)` and the gain LUT), `atan2` (slope compares), `sectorAt`, `Map.get`, string glyphs. The edge pass patches `rt.cells` bytes directly so the write counter stays at exactly N.
6. **Budgets (p50, 160x60)**: `deriv` <= 0.15 ms, `edge` <= 0.20 ms, v2 shading at most +0.55 ms over v1 `fastShade`; the whole detail pass <= +1.0 ms over US-004b; sectors total < 3.5 ms (12).
7. **Oracles**: `detailPass.util.shade` / `util.edgePass` are the reference, read through `gbuf.readSample`; fast paths must match glyph exactly and fg/bg within +-4 (`?shadetest=1`, `bench-cast.mjs`). The designer's `exportProposed()` JSON is checked by `tools/compare-detail-export.mjs` (>= 95 % glyph, >= 95 % fg/bg within +-8).
8. **Editor extension point**: `gbuf.rule`, `gbuf.kind`, `gbuf.planeId` are stable debug views (edge map, plane map overlays) and may be exposed read-only to the tool UI.

## 9. Allocation rules (hot paths = anything called per column, per cell, per DDA step, per sim step)

1. Zero heap allocation per frame in render passes and in `integrate`. Verified by reading the code and by a Node bench with `--trace-gc` showing no scavenges during 600 frames after warm-up (`tools/bench-cast.mjs --gc`).
2. Scratch state is module-level or owned by the pass object and reused: `shadeOut`, `shadeOpt`, ray state, the `outsideSector` scratch sector, sprite rects.
3. No object returns from per-step helpers (`{side, perpDist}`), no destructuring assignments of returned objects, no closures created inside the column loop (a closure per column is 160 allocations/frame plus a context object). Use a reused `RayState` object passed in, or module-level `let` variables written by the helper and read by the caller. Do not rely on V8 escape analysis: it works only when the callee inlines, and inlining decisions change with code size and warmth, which is exactly what US-018 cannot afford to discover late.
4. Typed arrays for anything sized by `cols`, `rows` or cell count; allocated in `createEngine` and on `resize`, never per frame.
5. Strings only in UI/text paths. The caster resolves glyphs to indices through LUTs built when the palette is bound (`buildLUT(ramp, 256)` -> `Uint8Array` of glyph indices) and material keys to material records once per legend entry (resolve at `loadLevel`/`placeStructure` time into `sector.mat.wall`, `.floor`, `.ceil`, `.upper` object references), not per cell via `materials[key]`.
6. `Math.pow` per cell is banned in the fast shader: gamma curves become 256-entry LUTs; `fogFactor` a LUT over distance in 0.25 m steps; `smoothstep` fade per material a LUT.
7. `Array.prototype.forEach/map/filter`, spread, `arguments`, `for...of` over arrays, template strings: not in hot paths.
8. Per-frame query results (`sectorAt`) return shared read-only legend objects, never copies. Consumers must not mutate them (`Object.freeze` in dev builds via `?strict=1` is acceptable).
9. Entities are plain objects mutated in place; no per-step `{...spread}` copies. Serialization copies, once, on demand.

## 10. Serialization and editor extension points

`WorldState` (output of `serialize`, input of `deserialize`; JSON-safe; `version` field, unknown version = clear error):

```js
{
  version: 1,
  world: 'world_m1',                                 // WorldDef key; the def itself stays in content
  terrain: { recipe: 'overworld_far', seed: 7331, overrides: {...} },   // overrides copied so an edited world is self-contained
  structures: [{ id, level: 'tower', origin: {x,y,z}, yawSteps, dynamics: { grate: { t: 0.0 } } }],
  entities: [{ id, type, transform: {x,y,z,yawDeg,pitchDeg}, components: {...} }],   // includes player, boulder, prop state
  state: { 'tower.lantern.taken': false, ... },
  time: { sec: 12.5, timeOfDay: 'morning' }
}
```

Rules: positions are copied exactly (no rounding); `deserialize(serialize(w))` then `serialize` again is deep-equal; class instances are rebuilt from content by key (`assets.level('tower')`), never stored. US-017 restart = `deserialize(initialState)` where `initialState = serialize(world)` taken right after `World.load`.

`Entity`: `{ id, type, transform: {x,y,z,yawDeg,pitchDeg}, components: { body?: {radius,height,vx,vy,vz,grounded}, sprite?: {model,variant,anim,frame,t}, light?: {preset,on,...}, interactable?: {...}, tags?: [] } }`. Systems are functions over entities with a given component; no methods on entities.

`Events` (`engine/core/events.js`): `on(name, fn)`, `off`, `emit(name, payload)`; engine emits `world:loaded`, `world:structurePlaced`, `world:sectorAnimated`, `entity:added/removed`, `interaction:fired`, `trigger:fired`, `resize`, `contextlost/restored`. The editor subscribes; the game may too. Payloads are plain data.

Editor extension points (M5, no engine changes expected):
- All passes take an explicit `CameraPose` and `FrameBuffers` -> render any viewpoint into any RenderTarget (thumbnails, top-down cameras via a second engine instance).
- `World.placeStructure/removeStructure/moveStructure`, `Terrain.applyOverride(chunkKey, stamp|paint)` + `Terrain.invalidate(chunkKey)` regenerate only that chunk.
- `AssetRegistry.fromJSON` and `tools/export-content.mjs` (US-027): design classic scripts -> `content/*.json`; `util` functions replaced by engine implementations chosen by `name`+`version`.
- `loop.stats` (per-pass ms, cells written, spans open, allocations) is public read-only data for overlays.
- Idle re-render skip (M5): `World.renderVersion` (integer, bumped on any mutation) + last `CameraPose` + last animation time; `renderWorld` early-outs and `present()` is skipped when all three are unchanged. Makes idle editor viewports/thumbnails cost ~0 ms; irrelevant in-game (section 12.1 item 4).
- `loadLevel` returns errors as data too (`loadLevel(def, { collect: true })` -> `{ level, errors[] }`) so an editor can show them inline.

### 10.1 Entity handles and the animation player (architect, 2026-09-23, owner request)

Goal: game code reads like `guard.play('attack')`, `guard.moveTo(x, y)`, `guard.on('interact', fn)`, while D-006 stays true: **the entity data is the only state**. A handle is a thin view that holds no authoritative state, so serialize and the editor still work.

**World API (in US-025, when `World` becomes real):**
```js
world.spawn(type, transform, components, id?) -> EntityHandle
    // copies nothing, normalizes defaults (sprite.t=0, frame=0, playing=true, speed=1, loop from the clip), validates
    // sprite.model/anim via assets (throws a clear error here, never in the step). id is optional: authored placements pass a
    // stable id; otherwise `${type}_${world.nextId++}` (nextId goes into WorldState, so ids are deterministic across save/load).
world.get(id) -> EntityHandle | null     // cached: the same handle object for the same id until remove
world.remove(id)                         // == handle.remove()
```

**EntityHandle** (`engine/entities/EntityHandle.js`). Fields: `id`, `world`, `alive`, `data` (a getter that returns the live entity object, not a copy). Every mutator writes entity data, bumps `world.renderVersion` and returns `this`, so calls chain.
| Method | Writes / does |
|---|---|
| `play(anim, {loop?, restart=false, speed=1}?)` | `components.sprite.{anim, frame:0, t:0, loop, speed, playing:true}`. If the same anim is already playing and `restart` is false, it does nothing, so calling it every frame is safe. Unknown anim: console.error once, no-op. |
| `stop()` | `sprite.playing = false` (holds the current frame) |
| `onAnimEnd(fn)` | sugar for `on('animEnd', fn)` |
| `moveTo(x, y, {speed?, arriveR=0.2}?)` | `components.move = {tx, ty, speed, arriveR, active:true}`. The move system steers `body` toward the target through `integrate` (collision included) and emits `arrive`. It never teleports. |
| `lookAt(x, y)` | `transform.yawDeg = (atan2(x-ex, -(y-ey)) in degrees + 360) % 360` (compass: 0 = N = -y, clockwise) |
| `setComponent(name, value)` | `components[name] = value` (JSON-safe values only; `null` deletes it). `getComponent(name)` reads. |
| `on(event, fn) -> off()` | per-entity listener: `fn(handle, name, arg)` with no payload object |
| `remove()` | deletes the entity, emits `removed` and then `entity:removed` on `engine.events`, drops its listeners and its cache entry, sets `alive = false`. Every method on a dead handle is a no-op plus one console.warn. |

Rules:
- Listeners and handles are **runtime glue, never serialized**. `deserialize` builds a new World, so old handles report `alive === false`. The game re-attaches listeners in its `world:loaded` handler. Reactions that must survive a save belong in data, as named behaviours (`interactable.behaviour: 'guardTalk'`, see `registerBehaviour`). `on('interact')` fires after the data behaviour.
- Event names reserved by the engine: `animEnd`, `arrive`, `interact`, `removed`. Model frame tags may not use them (the registry validates this at load).

**Animation state = `components.sprite`** (this replaces the `sprite` shape listed above; plain JSON):
`{ model: 'guard', anim: 'walk', t: 0, frame: 0, loop: true, speed: 1, playing: true, variant?: 'x' }`. `t` = ms elapsed inside the current frame.

**Clips.** When the registry loads, every `ModelDef.animations[name]` is compiled once into a private `AnimClip {durMs: Float32Array, loop, tagCodes: Int16Array per frame (-1 = none)}`. `fps` becomes a uniform `1000/fps`; otherwise `durations` is used. Optional model field `events: { hit: 1, step: [1, 3] }` maps a tag to the frame index or indices where it fires. Tag strings are interned to small ints at load. Clips are never serialized. The world keeps a runtime side table (entity slot -> clip ref + the last anim string) and re-resolves the clip only when `sprite.anim` or `model` changes (a string identity compare).

**`stepAnimations(world, dtMs)`** runs in the fixed 60 Hz step, after movement. It is allocation-free (rule 9):
```
if !playing: skip
t += dtMs * speed
while t >= dur[frame]:
    t -= dur[frame]
    frame++
    if frame == n:
        if loop: frame = 0
        else: frame = n - 1, t = 0, playing = false, queue(animEnd, anim), break
    queue(tag of frame) if any
```
`play()` also queues frame 0's tag. Events go into a preallocated `Int32Array` ring (slot, eventCode, argCode; capacity 256; overflow drops the event, increments `loop.stats.eventsDropped` and warns once). The ring is flushed **after** the sim step, so listeners may safely spawn, remove or play. Events for entities removed during the flush are skipped. Budget: at most 0.05 ms per step for 200 animated entities. The step is deterministic: fixed dt, no wall clock.

**Rendering (US-011).** Render only reads, and never advances time. `renderWorld` fills a preallocated `SpriteInstance` pool from the entities that have `sprite`: position, clip frame `frame`, and the direction key. The direction key comes from (entity yaw minus the bearing from the camera) quantized to the model's `directions`, falling back to `S`. LOD is `lods.half` by distance. `drawSprites(fb, pool, cam)` is unchanged. No inter-frame blending: ASCII frames are discrete.

**Worked example.** `design/models/guard.js` has the same shape as `lantern.js` (README 4-5), plus `events`:
```js
A.models.guard = { name: 'guard', size: {w:5,h:6}, anchor: {x:2,y:5}, world: {w:0.6,h:1.8},
  directions: ['S','E','N','W'], billboard: true, keys: { /* palette keys */ },
  animations: {
    idle:   { fps: 2, loop: true,  frames: [ /* 2 x {S:{glyphs,fg,n}, E:..., N:..., W:...} */ ] },
    walk:   { fps: 8, loop: true,  events: { step: [1, 3] }, frames: [ /* 4 */ ] },
    attack: { durations: [120, 80, 220], loop: false, events: { hit: 1 }, frames: [ /* 3 */ ] } } };
```
```js
const guard = world.spawn('guard', { x: 12, y: 30, z: 0, yawDeg: 180, pitchDeg: 0 }, {
  sprite: { model: 'guard', anim: 'idle' }, body: { radius: 0.3, height: 1.8 },
  interactable: { prompt: '[E] Talk', radius: 2, behaviour: 'guardTalk' } }, 'tower.guard');
const p = world.get('player');
guard.on('interact', g => g.lookAt(p.data.transform.x, p.data.transform.y).play('attack'));
guard.on('hit', g => { if (distXY(g.data, p.data) < 1.5) hurt(p, 1); });
guard.onAnimEnd((g, name, anim) => { if (anim === 'attack') g.play('idle'); });
guard.moveTo(20, 30).play('walk');
guard.on('arrive', g => g.play('idle'));
```

**Phasing.**
- **US-024:** API surface only. Typedefs (`EntityHandle`, the `SpriteState` sprite component, `MoveState`, `AnimClip`) in `engine/entities/EntityHandle.js` and `engine/entities/animation.js`. `World.spawn/get/remove` and every handle method are stubs that throw `not implemented (US-025)`. `stepAnimations` is a stub that throws `(US-011)`. All of them are exported from `index.js`.
- **US-025:** spawn, get and remove, the handle cache, `setComponent/getComponent`, `lookAt`, `on`, the event ring and flush, `nextId` in WorldState, and the round-trip test (serialize with handles alive yields a deep-equal state).
- **US-011:** the model `events` field, clip compilation, `play/stop/onAnimEnd`, `stepAnimations`, the sprite pool and `drawSprites`. Headless test: a clip of durations [100, 50] advanced by 60 Hz steps hits the expected frame and tag sequence and emits `animEnd` exactly once.
- **M3 (AI):** the `move` system (straight-line steering through `integrate`, the `arrive` event, stuck detection), then pathfinding and AI behaviours on top of `moveTo`. Until then, `moveTo` writes `components.move` and nothing consumes it (it logs one warning).

## 11. Testing strategy

- **Headless first (Node, no framework, `node file.test.js`, exit code):** `Level` validation and queries (exists), physics (exists, `physics.test.js`; US-009 adds `jump.test.js` and `entities/eyeFeel.test.js` - one suite per story, the older suites stay untouched and must keep passing), `World` queries and structure/terrain handover, `Terrain` determinism (same seed -> identical checksum; async bake == sync bake), `serialize` round-trip, `castSectors` on a fake `rt` (counts writes, checks full coverage and exactly-once, compares glyph output against `palette.util.shade` for the 5 reference cells), `OpenSpans` narrowing, `check-deps` on a fixture tree. Content files load in Node because they set `module.exports` when `module` exists (palette does; `test_room.js`, `world_m1.js`, `tower.js` must too).
- **Bench:** `tools/bench-cast.mjs` runs `castSectors` (later the whole `renderWorld`) for N frames at fixed camera poses on `test_room` and the tower, prints avg/p50/p95/max, cells written per frame, and (with `--gc`) GC events. It is the reproducible number for architect/PO reviews, since agents cannot measure real Chrome (D-005 6). Real-Chrome F3 numbers from the user remain the acceptance number.
- **Pages (browser, tester):** `game/index.html` with `?debug=1 ?bench=1 ?glyphs=1 ?shadetest=1 ?force2d=1 ?demo=1 ?origin=x,y ?level=name ?serializetest=1`; `game/world-test.html`, `game/physics-test.html`; `design/preview/*.html` (designer's, unaffected by engine changes).
- **Regression on structural stories (US-024):** screenshot compare at a fixed camera before/after; `CellBuffer.glyphIdx` checksum via `window.__debug.rt` is the exact form of "pixel-identical".
- **Every story:** `node tools/check-deps.mjs` OK; all existing `*.test.js` pass; no console errors on every page/switch above.
- **Typecheck (ME-00, no build step):** `node tools/typecheck.mjs` runs `tsc --noEmit -p tools/tsconfig.json` (plain JS + JSDoc via `// @ts-check`, no `npm install` needed to run the game itself - `npm install` at the repo root only enables the check locally); it's also wired into `node tools/run-tests.mjs` as the `typecheck` suite (`--filter typecheck` to run just it). Today a nonzero exit is reported **WARN**, not FAIL, so it never fails the overall run - policy may flip this to **FAIL** once TypeScript coverage is wider and installed everywhere run-tests.mjs runs.

## 12. Performance notes (state as of US-004, 2026-09-22)

Headless Node 24 measurement of `castScene` on `test_room`, 160x60 (`scratch tools/bench-cast` prototype, 300 frames per pose): **avg 7.1-7.5 ms, p50 6.3-6.8 ms, p95 10.6-11.9 ms**. The sandbox browser numbers (6.5-7.3 ms) are therefore real, not inflated: it is the same V8.

Where it goes:
1. **Overdraw.** The caster writes **14,300-17,900 cells per frame for 9,600 screen cells** (1.5-1.9x). Sources: (a) the solid-wall branch draws rows down to `openBottom` (= rows-1) over floor rows that the nearer segments already drew; capping the wall at `floor(rowAtHeight(nearSector.floorH, entryDist))` removed ~2,300 writes per frame in the test poses; (b) `castSkySegment` paints sky mid-column from `ceilTop` down to the near floor row, and every farther floor segment then overwrites the lower part; the remaining ~1.3x is this. Sky must never be painted mid-column: record `skyClosedTop`, track a floor high-water mark (`floorFilledTo` = smallest row a floor has reached), and paint sky once at the end into `[openTop, floorFilledTo-1]`, which is also what the compositor needs (`fillSky`). Target: **exactly 9,600 writes per frame** on any pose, checked by the headless counter.
2. **Reference shader cost.** `palette.util.shade` costs ~0.40-0.45 us per call (9,600 calls = 3.9-4.3 ms; `shadeSky` 1.9 ms per 9,600). Per call it does a `materials[key]` lookup, two `Math.pow`, `smoothstep`, string `charAt` texel lookup, ramp `charAt`, fog `Math.pow`, and writes floats that the caller then rounds/clamps. A fast path with resolved material records, `Uint8Array` texel grids, 256-entry LUTs for ramp/gamma/fog/fade, and integer output should reach 0.08-0.12 us per cell (about 1 ms per frame). It must stay within the `?shadetest=1` tolerance (glyph equal, fg/bg +-4).
3. **Lighting (US-006/007) will add** per lit cell: N point lights x (distance, falloff, N.L) plus a line-of-sight test, plus the sun shadow test. Per-cell LOS/shadow rays are not affordable. Plan: (a) lights are static except the carried lantern; precompute per light a 2D visibility grid over the structure (`Uint8Array` cells, BFS/raycast once when the light moves; the lantern moves every frame but only needs a small radius, 5 m = 11x11 cells); (b) sun shadow = a per-cell "sunlit" 2D mask computed once per level (the sun does not move in M1) plus the wall-height test at the hit; (c) light accumulation per cell is then ~N x 20 flops with no branches into the grid.

Expected after items 1-2: sectors ambient-only ~2 ms; with 4 lights + sun ~3-3.5 ms. That is at the top of the D-007 sub-budget but inside the 8 ms total with terrain 3 + sprites 1 + UI 0.5 + sim 1 = ~8. **Margin is thin; the optimisation story (US-004b, see backlog) must land before US-006, and US-018 must be measured with the terrain pass on.** No manager escalation yet; escalate if after US-004b the headless bench shows sectors > 3.5 ms ambient-only or lighting > +1.5 ms.

### 12.1 Changed-cells-only present ("dirty cells") - measured, rejected for the primary path (architect, 2026-09-22)

Premise check first: the 21-31 ms `present()` in the US-001 notes is the **pre-D-005 Canvas2D pixel-buffer path**. Since D-005 the primary back-end is WebGL2 and `present()` is 2 x `texSubImage2D` (76,800 bytes total) + 1 `drawArrays`, measured at **0.12-0.14 ms** flat from 0.2 M to 3.1 M device px. There is nothing left to save there: a dirty-cell scheme reduces only `present()`, never the caster, because a cell is only known to be unchanged *after* it has been recomputed.

Headless measurement (Node 24, `castScene` on `test_room`, 160x60, ambient-only, cell = glyph + fg + bg compared against the previous frame; 60-120 frames per pose at 1/60 s):

| Pose | cells changed (avg / max) | dirty rect (bbox) | dirty rows |
|---|---|---|---|
| still | 0.0 % / 0.0 % | 0 % | 0/60 |
| turn slow, 2 px/frame (0.3 deg) | 22 % / 24 % | 100 % | 60/60 |
| turn medium, 10 px/frame (1.5 deg) | 43 % / 53 % | 100 % | 60/60 |
| turn fast, 20 px/frame (3 deg) | 49 % / 66 % | 100 % | 60/60 |
| pitch 0.5 deg/frame | 44 % / 94 % | 58 % | 35/60 |
| walk 3.5 m/s, no bob | 18 % / 30 % | 100 % | 60/60 |
| walk 3.5 m/s + US-009 head bob (0.03 m, 2 cyc/m) | 26 % / 42 % | 100 % | 60/60 |
| run 6 m/s | 23 % / 33 % | 100 % | 60/60 |
| strafe 3.5 m/s | 27 % / 31 % | 88 % | 53/60 |

Cost of the diff pass itself: **0.064 ms/frame** (9,600 cells x 7 bytes) - i.e. half the entire GL `present()`.

Conclusions:
1. **GL2 (primary): do not implement.** Best case saves < 0.1 ms; the diff costs 0.06 ms; and the dirty *rect* is ~100 % of the screen whenever the camera moves, so a partial `texSubImage2D` would upload the same 76 KB anyway. Standing still is the only pose that saves anything (0.1 ms), and it stops being still once US-006 torch flicker, sky/cloud drift and sprite animation land.
2. **Canvas2D fallback: it would help, but the fallback is not the target.** JS composite model at the D-005 capped size (1440x960 px, 9x16 px cells): all cells **6.7 ms**, 10 % of cells 0.66 ms, 30 % 2.1 ms, 60 % 4.7 ms. With 20-50 % of cells changing while moving, a changed-cells composite would take the fallback from ~6.7 ms to ~2-4 ms of JS, but the full-frame `putImageData` remains (dirty rect ~100 %), which was itself measured at ~4.8 ms for 1.15 M px in the sandbox. The fallback stays "works, not budgeted" per D-005 item 6. Only if the user's real-Chrome `?bench=1` numbers or a manager decision make the fallback a performance target does this become a story (text below); it is a ~40-line change inside `RenderTargetCanvas2D.present()` and touches no public API.
3. **Back-end compatibility:** the diff lives on `CellBuffer` (upstream of both back-ends), so it is compatible with either; but on GL it is pure overhead. `?bench=1` (every cell changes every frame) is by construction the pose where dirty cells save nothing, and stays the acceptance benchmark.
4. **What *is* worth having, for the editor not the game: idle re-render skip.** If the camera pose, `world.renderVersion` (bumped by any sector animation / light change / entity move) and `timeSec`-driven animation are all unchanged since the last frame, `renderWorld` returns without running any pass and `present()` is skipped. In-game this almost never triggers (something always animates); in editor viewports and thumbnails it is the normal case and makes N idle viewports cost ~0. Add it in M5 as part of the editor's viewport story; it needs `renderVersion` on `World` (one integer, bumped on mutation) and nothing else. Do not add it now.

**Conditional story text (only if the fallback becomes a target; the PO decides):**
*US-0xx Canvas2D fallback: changed-cells-only composite (P2, engine/render).* As a player on a machine without WebGL2, I want the fallback renderer to spend JS time only on cells that changed. AC: (1) `RenderTargetCanvas2D` keeps a previous-frame copy of `glyphIdx/fg/bg` and recomposites only differing cells; `putImageData` is called with the dirty bounding rect, or not at all when no cell changed. (2) Output is byte-identical to a full composite (headless test on a fake `ImageData`: 200 random frames, compare pixel buffers). (3) No per-frame allocations. (4) `?bench=1` worst case is unchanged within noise; a 60-frame `test_room` walk on `?force2d=1` shows composite JS time <= 50 % of the full-composite time on the F3 overlay. (5) Public API unchanged.

### 12.2 Distance LOD beyond what is planned - premature, with two exceptions (architect, 2026-09-22)

What is already planned and sufficient for M1-M3: terrain near/far cells (US-016/026), sprite `lods.half`, glyph bands, the fog LUT, and the sky row LUT. The sector caster's cost is per *screen cell* (9,600 after US-004b), not per world distance, so distance LOD has no lever there.

- **Shading LOD (skip lights / use fog colour beyond a distance): not a story, two implementation notes.** (a) In the fast shader (US-004b item 5): when the fog LUT says `fogFactor >= 0.98`, write the fog colour + the ramp's darkest glyph directly and skip the texel, ramp and light work. This is within the `?shadetest=1` tolerance (fg/bg +-4) and is a one-branch early-out, not a mode. (b) In US-006 lighting: every light has a radius from its falloff; cull per cell by squared distance before doing N.L/visibility. That is standard culling, not LOD, and belongs in the US-006 tech notes. Expected saving: small (test_room is 20x18 m, fog-full is farther than most walls); on the tower/overworld it turns lighting cost from "N lights x all cells" into "N lights x cells in radius", which is the difference between 3.5 ms and ~2.5 ms when 6+ lights exist.
- **Simulation LOD (tick far entities less often): premature.** Sim budget is 1 ms; M1 has ~1 boulder, a handful of props and 4-6 lights, all inside one structure. Reduced-rate ticking breaks determinism per D-007's fixed step unless entities record their own accumulator, and it complicates `serialize` (an entity mid-skipped-step). Rule: **no simulation LOD until US-018 measures sim > 1 ms.** If it does, the lever is per-behaviour (e.g. lantern flicker at 20 Hz, far sprite animation frame updates at 15 Hz), not per-entity ticking.
- **Caster LOD (cast every other column beyond a distance, interpolate): no.** It produces column-doubling artefacts on glyph text, which the ASCII look makes far more visible than in pixel renderers, and the caster is already targeted at 2 ms.

### 12.3 Placement decision

Nothing from 12.1/12.2 goes into US-004b beyond the fog early-out, which is a detail of item 5 (fast shader) and needs no new AC. No new story now. The Canvas2D dirty-cell story above is written down for the PO to open **only** if the fallback becomes a target; the idle re-render skip is an M5 editor item (section 10). The pending real-Chrome `?bench=1` result decides nothing here: if GL `present()` is < 2 ms there (expected: ~0.1-0.3 ms), the analysis stands; if it is > 2 ms, the problem is the driver/upload path, not cells, and the fix is a single interleaved `RGBA8 x 2` texture upload or `PBO` streaming, not diffing.

## 13. Do-not list

- Do not import anything outside `engine/` from `engine/`. Do not read `window.ASSETS`, `location`, or `document` lookups in the engine.
- Do not put a level name, prop name, hint text, coordinate or story beat in `engine/`. Behaviours by name, positions from data.
- Do not create objects, arrays, closures or strings per cell, per DDA step, per column or per sim step (section 9).
- Do not paint sky, void or "black" in `castSectors`; leave the span open.
- Do not compute the horizon/projection in more than one place (section 4).
- Do not hold authoritative state in class instances (World caches; the data in `serialize()` is the truth).
- Do not add a build step, a bundler, or an external library (D-006 option 3 rejected). Shaders stay template strings.
- Do not use `Date.now()`/`Math.random()` in simulation or rendering; use the engine clock and seeded hashes (`recipe.util.hash`).
- Do not "fix" content in engine code: if data is wrong, fail validation with row/col or key, and let the designer fix the file.

## 14. D-009 input (architect, 2026-09-23): can the renderer run on the GPU?

Owner constraints honoured by every option below: browser only, no install, no native code, no libraries; the output stays a character grid (glyph, fg, bg per cell). The GPU would only *compute cells*; `present()` (D-005) is unchanged.

Facts (from the code): the GL back-end is a single fullscreen triangle that samples two `cols x rows` RGBA8 textures. Anything that writes those two textures - JS via `texSubImage2D` today, or a fragment shader rendering into them tomorrow - looks identical. WebGL2 (GLSL ES 3.00) has `uint` bit ops (the hashes can be bit-exact), integer textures (sector grid, material ids), dynamic loops (DDA with a cap), multiple render targets (a G-buffer in textures) and `texelFetch`. Per frame the GPU would run one fragment per *cell* (9,600 today, 21,600 at 240x90), not per pixel; even x4 rays per cell and 96 DDA steps is ~8 M loop iterations - far below one 1080p frame of any 2015+ integrated GPU. Expected GPU time < 1 ms at 240x90; JS time ~0.2 ms (uniforms, light list, sprite list, per-structure origins).

### Options

| | A: CPU + optimisations | B: full GPU per-cell (DDA + shade + edge + terrain + sprites in GLSL) | C: hybrid (CPU casters -> upload G-buffer -> GPU light/shade/edge) |
|---|---|---|---|
| Effort | 0-1 stories (US-004c: LUTs, column caching) | 6-7 stories: (1) render-to-texture pipeline + data textures + parity page; (2) sector DDA in GLSL incl. multi-structure + spans; (3) G-buffer MRT + `shadeDetailFast` port; (4) edge pass + derivatives; (5) terrain march (US-016 GPU-first); (6) sprites depth-tested in GLSL; (7) lighting = US-006 in GLSL | 3 stories: pipeline + G-buffer upload (~0.6 MB/frame at 160x60, ~0.4 ms), shade+edge port, parity page |
| JS freed | none; sectors stay 1.6-2.8 ms, lighting +1-1.5 ms, terrain 2-3 ms => at the 8 ms wall | ~5-6 ms (casters, shading, lighting, terrain, sprites leave JS) | ~0.9 ms (deriv+shade+edge); caster and terrain stay on the CPU |
| Grid headroom | 160x60 firm; 200x75 only if US-004c lands and lighting is culled hard; 240x90 never | 240x90 trivially; 320x120 likely; bound by JS uploads (0.1 ms) and the atlas, not by cells | ~180x68; the caster and terrain are still O(cells) in JS |
| Shimmer fix | glyph hysteresis / temporal tone stability only; N rays per cell is unaffordable (x2 caster) | N rays per cell (e.g. 2x2 sub-rays) with coverage-weighted material/tone vote - the real fix, ~free | shading-side stabilisation only; geometry is still 1 ray per column, so coverage is impossible |
| Risks | thin margin, every new feature is a budget fight | GLSL debugging (no stepping; mitigated by rendering `gbuf.kind/planeId/rule` as debug views), float32 vs float64 boundary decisions at grazing hits (accept edge-cell mismatch as the compare tool already does), WebGL2 unavailable/software GL (~2-3 %: fall back to the JS path + Canvas2D; that fallback exists), two implementations of the same rules (mitigated: the JS path is the oracle and every GLSL pass has a parity test) | same GLSL/float risks for less gain; the per-frame G-buffer upload grows with the grid; still two implementations |

### Testing (all options B/C)
1. The JS path stays the **reference and the fallback** and stays headless-testable in Node; `shadetest`, `bench-cast`, the designer oracles are unchanged.
2. A browser page `?gpucompare=1` renders the same frame on both paths, reads the GPU cell textures back (`readPixels`, 77 KB; test only, never in the frame loop) and reports: glyph match >= 99 % excluding cells whose 4-neighbour kind differs (the rule already used by `compare-detail-export.mjs`), fg/bg within +-4, depth within 1 %, over the same pose set as `bench-cast.mjs`. Run by the tester per story; Node cannot run WebGL without an external browser driver (if a headless-browser CI is wanted that is a separate manager decision: it adds a dev dependency, not a runtime one).
3. Determinism: hashes use `uint` and the seed; no `gl_FragCoord`-anchored noise; no time-based inputs except `timeSec` as a uniform.
4. Sprite depth: in B the depth lives in a texture and sprites are drawn by a GPU pass from a sprite-list texture (<= 64 sprites), so no readback is needed in the frame. In C the CPU already has the depth.

### Effects on existing work
- **US-028 is not wasted**: it defined the data model (GBuffer fields, MaterialTable flattening, edge rules, oracles). B/C port exactly those records into textures via the same `bindShading`; the strings-to-codes flattening is precisely what GLSL needs.
- **US-006/007** (lighting): under B/C written once in GLSL with a *correct but unbudgeted* JS reference; the 12.3 visibility grids become textures. Under A they need the LUT/culling work in 12.2-12.3 and eat the last margin.
- **US-016** (terrain): under B, GPU-first (per-cell heightfield march; chunks as R16 textures) - do not write the far-LOD JS caster as a budgeted product; keep it as the reference only.
- **Editor (M5)**: multiple viewports and the idle skip (12.1 item 4) come for free; picking = 1-cell `readPixels` of the planeId target (async, editor only). The JS path remains for thumbnails/headless export.
- **Entities/sprites**: unchanged data (10.1); only the draw moves.
- Public API (section 5) unchanged: `renderWorld(fb, world, cam)` picks the GPU pipeline when `rt.backend === 'gl2'` and `opts.gpu !== false`; passes stay exported for the JS path.

### Recommendation
**B, staged, decided now**, with C as its first stage: (1) US-029 GPU pipeline + G-buffer upload + shade/edge port + `?gpucompare=1` (= C; validates data textures and parity tooling with the CPU caster still authoritative); (2) US-006 lighting written in GLSL with a JS reference; (3) US-030 sector DDA in GLSL with N-ray coverage (shimmer fix), sprites pass; (4) US-016 terrain GPU-first. Steps 1-3 before US-006/US-016 in M1 (M1 grows by ~3 engine stories; writing lighting and terrain twice would cost more). Option A is the fallback plan only if step 1 fails its parity gate on the owner's real hardware. Grid default stays 160x60 until step 3 lands; then 240x90 becomes a setting, not a rewrite.

### 14.1 GPU cell pipeline, stage 1 (US-029): layout, formats, boundaries (architect, 2026-09-23)

Normative for `engine/render/gpu/`. The build plan (order, tests, do-nots) is in the US-029 tech notes in `docs/backlog.md`. Stage 2 (US-030) replaces items 2-3 (the upload) with GLSL casters writing the same textures; everything else here stays.

**1. Files and boundaries** (all under `engine/render/gpu/`, imported only inside `engine/`, exported through `engine/index.js`; `check-deps` rules 1-2 apply: no `location.search`, no `window.ASSETS`).

| File | Owns | Node-testable |
|---|---|---|
| `GpuCellPipeline.js` | FBOs, G-buffer textures + staging arrays, data textures, programs, `frame(fb, light)`, the present hook, `stats`, `ready`, `dispose()` | no (needs gl) |
| `ShadeTextures.js` | `packMaterialTable(table, DP) -> { matF, matI, setI, setF, gain, uniforms, dims }` and `unpack*` helpers (pure typed-array packing, asserts) | yes |
| `glsl/common.js`, `glsl/shade.frag.js`, `glsl/edge.frag.js`, `glsl/debug.frag.js`, `glsl/cell.vert.js` | GLSL sources as template strings; constants injected from JS (`MAX_TONES`, `MAX_LEVELS`, slot indices) so JS and GLSL share one layout table | source-string checks only |
| `GpuTimer.js` | `EXT_disjoint_timer_query_webgl2` ring, p50/p95 | no |
| `gpuCompare.js` | `runGpuCompare(...)` (readback, test only) + pure `compareCells(...)` | `compareCells` yes |
| `glUtil.js` | `compileShader`, `linkProgram`, `createTexture2D(gl, internalFormat, w, h)`, `isSoftwareRenderer(gl)` - moved out of `RenderTargetGL.js`, which imports them | no |

`RenderTargetGL` additions: `gl`, `fgTex`, `bgTex` become documented read-only fields; `setCellPass(fn|null)`; `present()` = upload cells -> hook -> re-bind own state -> draw (shader and draw unchanged). `CellBuffer` addition: `mask: Uint8Array(N)` (1 = written by JS since the last clear/hook). `bindShading` addition: `allV2: boolean`. Game/tool code never touches `gl`; the game only constructs the pipeline and reads `stats`/`ready`.

**2. Per-frame G-buffer textures** (`cols x rows`, NEAREST, CLAMP; sampled with `texelFetch` only; texture row y == grid row y; no flips anywhere in the cell passes)

| Texture | Internal format / sampler | Texel | Source |
|---|---|---|---|
| `GI` | RG32UI / `usampler2D` | `x = uint(planeId)`, `y = kind OR face<<8 OR mask<<12 OR mat<<16` (bitwise or) | staging `Uint32Array(2N)` |
| `GA` | RGBA32F / `sampler2D` | u, v, z, aoD | staging `Float32Array(4N)` |
| `GD` | RGBA32F | dudx, dvdx, dudy, dvdy | staging `Float32Array(4N)` |
| `DEPTH` | R32F | dist (`Infinity` allowed) | `fb.depth.depth` directly |
| `fgTex`/`bgTex` (rt) | RGBA8 | JS layer in, final cells out | `rt.cells.fg/bg` (existing) |
| `shadeFg`/`shadeBg` | RGBA8 (pipeline-owned) | pass-1 output; `shadeBg.a` 0 = passthrough, 1 = shaded | pass 1 |
| `ruleTex` | R8UI (debug only) | edge rule 0-8 | pass 2 |

44 bytes/cell -> 422 KB at 160x60, ~950 KB at 240x90 (stage 1 only). `planeId` is compared for equality only, so the uint bit-cast is exact.

**3. Bind-time data textures** (rebuilt on every `bindShading`; row = id; row 0 unused for materials)

`MAT_F` RGBA32F, width 32, row = material id:

| slot | x | y | z | w |
|---|---|---|---|---|
| 0 | albedo | bgK | detail | jitter |
| 1 | emissive | toneTotal | lod.mid | lod.far |
| 2 | lod.dither | grid.u | grid.v | grid.stagger |
| 3 | grid.shade | grid.amount | grid.bgK | grid.maxCover |
| 4 | grid.tint r | g | b | 0 |
| 5 | bevel.top | bevel.topShade | bevel.bottom | bevel.bottomShade |
| 6 | band.period | band.width | band.shade | band.bgK |
| 7 | band.tone r | g | b | band.edgeShade |
| 8 | overlay.amount | overlay.shade | overlay.bandFull | overlay.bandZero |
| 9 | overlay.joint | overlay.face | speckle.chance | speckle.shade |
| 10-13 | tone[t] r | g | b | toneW[t] (t = 0..3) |
| 14-21 | overlay.tint[k] r | g | b | 0 (k = 0..7) |

`MAT_I` RGBA32I (`isampler2D`), width 4: slot 0 = (seed, flags, toneCount, overlayK); slot 1 = (face.near, face.mid, face.far, grid.gapSetId); slot 2 = (grid.crossCode, band.setId, overlay.setId, speckle.setId); slot 3 = (bevelGate, bandGate, overlayGate, speckleGate). `flags` bits, in order from bit 0: HAS_GRID, GRID_TINT, GRID_BGK, GRID_CROSS, GRID_TIE, GRID_LINES, GRID_GAP, HAS_BEVEL, HAS_BAND, BAND_IS_U, BAND_TONE, BAND_BGK, HAS_OVERLAY, OV_BAND, HAS_SPECKLE, HAS_LOD. Absent features read as 0 in `MAT_F` and are never consulted without their flag.

`SET_I` RGBA32I, width 64, row = set id: texel 0 = (oriented, orientAxis, levels, nDark); texel 1 = (maxAlt, nFam, 0, 0); texel `2 + e` = glyph entry e: (altCount, codes 0-3 packed 8 bits each little-endian in y, codes 4-7 in z, 0). Entry order: flat set -> `levels` entries; oriented set -> `nDark` dark entries, then `nFam` entries each for fam h, v, d1, d2 (fam class c, level li = entry `nDark + c*nFam + li`). `SET_F` R32F, width 32: `thresholds[k]`. `GAIN` R32F 256x1 = `table.gainLUT`. Pack-time asserts (throw): tones <= 4, tints <= 8, `maxAlt` <= 8, levels <= 32, entries <= 62.

Scalars are plain uniforms (no UBO): `shading.*`, `cellAspect`, `TAN22/TAN68`, `fog.*` (+ `ivec2` sparse/haze codes and alt counts), `ao.r/k`, `faceK[7]`, `edges.fogMax`, `ruleGlyph[8]`, `ruleGain[8]`, `uLight` (vec3, per frame), `uTimeSec` (per frame, currently unused).

**4. Pass order inside the present hook** (viewport `cols x rows`, fullscreen triangle from `gl_VertexID`, address `ivec2(gl_FragCoord.xy)`):
1. repack + 4 `texSubImage2D` (`GI`, `GA`, `GD`, `DEPTH`), then `mask.fill(0)`;
2. pass 1 `shade` -> MRT `shadeFg`, `shadeBg` (reads `fgTex`, `bgTex`, `GI`, `GA`, `GD`, `DEPTH`, 5 data textures = 11 units);
3. pass 2 `edge` (or `debug`) -> MRT `rt.fgTex`, `rt.bgTex` (reads `shadeFg`, `shadeBg`, `GI`, `DEPTH`);
4. restore: `bindFramebuffer(null)`, canvas viewport; `present()` re-binds its program and units 0-2 itself.
A texture is never bound for reading in the pass that renders into it.

**5. Numeric rules for GLSL ports of JS passes** (apply to every later GLSL pass too):
- Hashes: `uint` arithmetic only (wrap == `Math.imul`), `uint(int)` for signed inputs, final `float(h >> 8) * (1.0/16777216.0)`. Never `float(uint32)` directly, never `round()`, never `%` or `>>` on negative signed ints.
- Bytes: `floor(v + 0.5) / 255.0` in the shader; read bytes back as `floor(t * 255.0 + 0.5)`.
- LUT sampling: `int(clamp(x, 0.0, 1.0) * float(size - 1) + 0.5)`, same as `samplePowLUT`.
- Threshold/tier/texel compares run in float32 on the GPU and float64 in JS; flips at exact boundaries are expected at a rate < 0.01 % of cells and are inside the parity tolerance. If a parity run shows more, a constant is being computed differently, not "float noise".
- Ban list from 8.1 rule 5 carries over; dynamic loops must have a constant upper bound.

**6. Budgets (stage 1, 160x60, owner laptop)**: JS in the hook <= 0.5 ms (repack 0.10, uploads 0.35, draws 0.05); GPU <= 4 ms per D-009 (expected < 1 ms); `?bench=1` reports `jsMs`, `uploadMs`, `gpuMsP50/P95` or `gpu n/a`. Timer: ring of 4 queries, a result is discarded after `GPU_DISJOINT_EXT`.

**7. Fallback matrix** (decided once per frame before shading, via `pipeline.ready`): no WebGL2 / `?force2d=1` -> Canvas2D + JS passes; `gl2` but `?gpu=0`, software renderer, `DP == null` (`?detail=0`), `!table.allV2`, compile/link failure or context lost -> gl2 presenter + JS passes. Overlay shows `shade: gpu|cpu`. The JS passes remain exported and are the oracle (`shadetest`, `bench-cast`, `compare-detail-export` untouched).

**8. Parity tooling contract** (`?gpucompare=1`): both paths consume the same cast (`castFrame` once per pose), JS result copied out of `rt.cells`, GPU result via `readPixels` on a readback FBO after `gl.finish()`; `compareCells` reports glyph match excluding 4-neighbour-kind edge cells, fg/bg deltas over all `kind != 0` cells, `mat == 0` count, per-rule mismatches. Readback is test-only; no engine path may call `readPixels` in the frame loop (editor picking in M5 is async, 1 cell, and a separate decision).

### 14.2 GPU cell pipeline, stage 2 (US-030): GLSL sector DDA, N-ray coverage, GPU sprites, grid setting (architect, 2026-09-23)

Normative for `engine/render/gpu/` from US-030 on; 14.1 stays valid except where this section says "replaces". Build plan, split and tests: US-030 tech notes in `docs/backlog.md`. The CPU path (`castSectors` + JS passes) is unchanged and remains the oracle and the fallback.

**1. Principle: one fragment = one (sub-)ray, no column state.** The CPU caster is sequential per column (narrowing span, high-water marks). The GPU cannot share state between rows, so each cell casts its own 3D ray and decides alone what it sees. The two formulations must agree cell for cell (parity AC), so the GLSL decision table is *derived from* `castColumn` and its clipping rules, not from intent:

```
ray(x,row): dir2 = camDir + camPlane*camX(x + ox);  slope = (horizonRow - (row + oy)) / planeDistY   (perpDist t is the parameter; h(t) = eyeH + slope*t)
for each structure s in order[0..count):                   // near-to-far, the compositor's step-2 list, uploaded as uniforms
  local ray = ray - origin(s)   (yawSteps must be 0 in M1: assert on upload; the CPU caster ignores it too)
  t0 = slab entry into [0,w)x[0,h) (+1e-4 nudge; miss -> next structure); if t0 >= bestT -> next structure
  C = entry cell; for step in 0..MAX_RAY_STEPS(96):  t1 = next boundary (DDA, side); if t1 > MAX_DIST(120) break
    floor plane: slope<0 && h(t1) <  C.floorH             -> hit t=(C.floorH-eyeH)/slope, kind = C.solid ? TOP : FLOOR, mat C.floorMat, face U, planeId(kind, C.floorH), u,v = hit x,y
    ceil plane:  slope>0 && !C.ceilSky && h(t1) > C.ceilH -> hit, kind CEIL, mat C.ceilMat, face D, planeId(CEIL, C.ceilH)
    N = cell across the boundary (outside the footprint -> leave this structure; remember t1 as spanDepth)
    hb = h(t1):
      N.solid && hb < N.floorH                                     -> WALL,  mat N.wallMat, face/planeId from side+step (primeWallGSample), u = side ? hitY : hitX, v = hb
      !N.solid && N.floorH > C.floorH && hb < N.floorH             -> STEP,  mat N.wallMat  (higher side = N; the near-higher band is fully clipped on the CPU, so it never exists)
      !C.ceilSky && !N.ceilSky && N.ceilH < C.ceilH && hb > N.ceilH -> UPPER, mat N.upperMat (lower cell = N; the near-lower band is clipped on the CPU)
      C.ceilSky && !N.solid && !N.ceilSky && hb > N.ceilH          -> SKY (kind 0, stop this structure; CPU case (a): sky band bounded by the far ceiling)
    C = N; t0 = t1
  a hit nearer than bestT replaces the candidate (kind, mat, face, planeId | structSeq<<28, u, v, z = h - Cnear.floorH, aoD, t)
no hit -> kind 0, depth = +Inf (sky / terrain / open span)
```

`z` and `aoD` use the *near* cell of the hit segment exactly as `wallAoD`/`planeAoDFast` do (relief bits, item 2). Rows are evaluated along the ray through the sub-sample point; the CPU's `ceil/floor` row rounding therefore differs only in boundary rows, which the compare tool already excludes (4-neighbour-kind rule). Where the CPU behaviour is arguably wrong (e.g. the upper wall of a building is not drawn from a sky cell) the GPU **matches it**; a follow-up story changes both.

**2. World textures** (`engine/render/gpu/WorldTextures.js`: pure packing + upload plan, Node-testable). Structures are stacked vertically in one atlas per 7.2 array (`GEOM` RGBA32F, `MATS` RGBA16UI, `FLAGS` RG8UI), width = max `w` of the placed structures, `yOff(s)` = sum of the previous heights; `uStruct[8]` uniform rows = `vec4(origin.xyz, w)`, `vec4(h, yOff, structSeq, 0)` plus `uStructCount`. Rebuilt with `texImage2D` when a structure is placed/removed or sizes change (`world.structVersion`, not per frame); per frame only rows `[dirtyY0, dirtyY1]` of a `packed` whose `version` changed are `texSubImage2D`'d, then `dirtyY0/Y1 = -1`. **Amendments to 7.2:** `FLAGS` becomes `RG8UI` with `g = floorRise | ceilDrop << 4` (the `ensureRelief` bits move into `packLevel`/`updateAnimatedSector` as `packed.relief: Uint8Array(w*h)`); `packLevel(level, matTable)` is called with the bound `MaterialTable` (upload asserts no `0` material id in a non-sky slot); `cellSize` must be 1 (assert). The DDA reads `geom.y` (ceilH) only; `ceilOpenH` is the animation target and stays JS-side.

**3. Sub-sample G-buffer and resolve (N-ray coverage).** `n = rays` (1..4; default 2 on gl2). Offsets are the fixed grid `((i+0.5)/n - 0.5, (j+0.5)/n - 0.5)` in cell units: never jittered, never time-based (n = 1 -> the exact centre = the CPU ray). Pass A `cast` renders `cols*n x rows*n` into `SGI` RG32UI, `SGA` RGBA32UI (`floatBitsToUint` of u, v, z, aoD), `SDEPTH` R32UI (`floatBitsToUint(dist)`; `0x7f800000u` = Inf). Pass B `resolve` renders `cols x rows` into the 14.1 per-cell textures, which are **all uint formats from now on** (`GA` RGBA32UI, `GD` RGBA32UI, `DEPTH` R32UI; shade/edge read them through `uintBitsToFloat`) - this removes the `EXT_color_buffer_float` question left open in US-029 and keeps `readPixels` legal on every target. Resolve rule: group the n*n sub-samples by key `(kind, planeId, mat)`; winner = largest group, ties -> smaller min depth; the written sample is the winner's sub-sample nearest the cell centre (its u, v, z, aoD, depth). `GI.y = kind | face<<8 | mask<<12 | cov<<13 | mat<<16`: `mask` (1 bit) comes from the `MASK` R8UI texture (per-frame upload of `rt.cells.mask`, replaces the mask bits of the old upload), `cov` (3 bits) = `clamp(winnerCount*8/(n*n) - 1, 0, 7)`. With n = 1 pass B is a copy. Pass C `deriv` = `computeDerivatives` in GLSL (same-planeId 4-neighbours, analytic fallback) -> `GD`. Pass D `shade`: `shadeCore` runs once per sub-sample of the winner group (fetch `SGI`/`SGA`, skip other keys), the continuous outputs are averaged (tone `gb`, fg/bg rgb before quantisation, line fraction, cover) and `shadeTail` (level pick, glyph pick, byte quantisation) runs once; `shadeDetailFast` in JS is split into the same two functions (pure refactor; n = 1 identical, validated by `?gpucompare`). Sky: kind 0 && !mask cells are shaded in pass D by a GLSL port of `fastShadeSky` (`SKY` RGBA32F 1x8 stop LUT + `uSkyElevTop`; azimuth/elevation from the cell's centre ray); `fillSky` never runs on the GPU path (US-016 terrain will fill kind 0 cells before the sky decision). Pass E `edge` is unchanged but renders into pipeline-owned `edgeFg/edgeBg`. Pass F `sprite` (item 4) composites into `rt.fgTex/bgTex`.

**4. Sprite pass** (`glsl/sprite.frag.js`, `SpriteAtlas.js`). JS projects each sprite once per frame with `projectSprite(cam, sprite, rt, out)` (shared with the JS reference `sprites.js`): `rect(x0, y0, w, h)` in cells, `scale`, `lod` (half below 0.75; each tier `scale = world.h*planeDistY/depth / lod.size.h`; **no upscale cap**, BUG-OWN-002: a cap makes feet-anchored props freeze and sink when approached), `depth` (perp dist), frame index, light rgb (US-006; ambient until then), `fogF`, flags -> 2 RGBA32F texels per sprite in `SPR` (2x64; only `count` rows uploaded, <= 4 KB). `SPRATLAS` RGBA8UI is built once per registry bind by the pure packer: `r` glyph code, `g` colour index into the `PALRGB` RGBA32F LUT, `b` = emissive bit | normal code << 1, `a` = 0 transparent / 1 opaque; a header row holds `(x, y, w, h)` per frame and LOD. Pass F per cell: for s in 0..count (constant bound 64, `break` at count): inside rect && `depth < DEPTH(cell)` && `depth < best` -> atlas texel at `floor((cell - rect0) / scale)`; opaque -> best. Output: fg = emissive ? palette colour : colour * (0.35 + 0.65*nf) * light, fog-blended like surfaces; bg = `edgeBg` (the wall shows through); glyph = atlas code. No sprite -> copy `edgeFg/edgeBg`. `mask` cells always win (UI over sprites). `?gpucompare` compares this pass against `drawSprites` on the same pool.

**5. Grid setting.** `createEngine({cols, rows, cpuGrid = {cols: 160, rows: 60}, gpu = true, rays = 2})`; `RenderTarget(canvas, cols, rows, { force2d, cpuGrid, gpu })` probes WebGL2 + `isSoftwareRenderer` **before** constructing the target and uses `cpuGrid` when the result is not a real GPU (`?gpu=0`, `?force2d=1`, no WebGL2, software renderer). Allowed range 160x60..320x120 with the 8:3 aspect kept (`rows = round(cols*3/8)`); out of range -> clamped and logged once; **default on gl2 = 320x120** (`?grid=240x90` is the step-back). `engine.setGrid(cols, rows)` re-sizes `rt` (textures, atlas, canvas), `depthBuffer`, `openSpans`, `gbuf`, the pipeline textures, and rebinds shading (`cellAspect` may change); emits `grid:changed`. It is used once at startup when `!pipeline.ready` (compile/link failure -> CPU at `cpuGrid`) and later by the in-game option. A context loss mid-game stays on the current grid on the CPU until restore (rare; degraded, not dead). `?grid=`/`?rays=` are parsed in `game/js/main.js` only. UI text is positioned from `rt.cols/rows` anchors, never from absolute cells; at 320x120 a HUD glyph is half the size, so HUD readability (a 2-cell font) is a designer/PO follow-up, not an engine concern. `present()` is unchanged: its cost is per pixel, not per cell; the atlas grows to `95 * pxCellW` (~600 px).

**6. Budgets (320x120, n = 2, owner laptop).** GPU <= 4 ms p95, expected < 2 ms: cast = 153,600 sub-rays x <= 96 steps x <= 2 in-bbox structures = 30 M DDA steps worst case (about 1 ms on a 2018+ integrated GPU; typical rays stop after 10-30 steps), resolve/deriv/edge/sprite ~0.1 ms each, shade x4 ~0.3 ms. n = 3 is allowed only if the measured p95 stays <= 4 ms; n = 4 is test-only. JS <= 2 ms: sim <= 1.0, hook <= 0.4 (`MASK` 38 KB + dirty rows + `uStruct` + sprite list), `rt.cells.clear` 0.05, UI 0.3; the two 154 KB present uploads stay (D-005). VRAM: sub-sample G-buffer 640x240 x 28 B = 4.3 MB; nothing is read back in the frame loop.

**7. Fallback matrix.** `gl2` + real GPU + `DP` + `allV2` + all programs linked -> **GPU path** at the requested grid (DDA + coverage + GPU sprites; `?rays=1..4`). Anything else -> **CPU path**: `castSectors` + JS passes + `drawSprites` at `cpuGrid` 160x60, rays forced to 1, `?grid`/`?rays` ignored (logged once). Test-only: `pipeline.setSource('upload' | 'dda')` keeps the stage-1 G-buffer upload for `?gpucompare=shade`. F3 overlay: `path: gpu|cpu  grid: WxH  rays: n`.

**8. Parity and metric tooling.** `?gpucompare=1` runs at 160x60 with n = 1: per pose the CPU `renderWorld` and the GPU pipeline render from the same camera; test-only readback of `fgTex/bgTex` **and** `GI/GA/DEPTH` (uint `readPixels`); reports geometry parity (kind match >= 99.5 % excluding 4-neighbour-kind edge cells; mat/planeId equal and depth within 1 %, u/v within 1e-3 * depth on matched cells) and cell parity (glyph >= 99 %, fg/bg +-4, `poisonedSurvivors == 0`), sprite cells included. `?gpucompare=shade` = the US-029 test, unchanged. `?flicker=1` (`engine/render/gpu/flicker.js`, pure `flickerStep(prevGI, prevFg, curGI, curFg, cols, rows, out)`): bench poses x 3 motions x 30 steps (0.02 m fwd, 0.02 m strafe, 0.1 deg yaw); a cell counts if kind/mat/planeId are equal in both frames and its 4 neighbours have the same kind in both frames; reports the share whose glyph changed, per motion and averaged, for JS 1-ray, GPU n = 1 and GPU n = rays at the same grid. Readback happens only in these two modes.

**9. Do not** (in addition to 14.1 items 5 and 11): keep column state across rows in GLSL; depend on `EXT_color_buffer_float`; jitter or rotate the sub-sample pattern; run the CPU caster at any grid other than `cpuGrid` in production; allocate in `frame()` or the hook (the upload plan writes into preallocated ranges); write sky from JS on the GPU path; read `DEPTH` in the pass that writes it; put level- or model-specific constants in GLSL (everything comes from the packed textures and the registry).

### 14.3 Lighting (US-006 point lights + flicker, US-007 sun): data, light pass, oracle, budgets (architect, 2026-09-23)

Normative for `engine/render/lighting.js` and `engine/render/gpu/glsl/light.frag.js`. Fills the `LightBuffer` plug-in point of 8.1 (rule 4 stands: light is an input of `shadeSurfaces`). Supersedes the sun part of 12 item 3 (no baked sun mask); the per-light visibility grid plan of 12 item 3 stands.

**1. `LightSet` (JS, owns all light state; serializable through the level's `lights` list, never through its arrays).**

```js
/** engine/render/lighting.js - allocated once, MAX_LIGHTS = 16, MAX_VIS_CELLS = 64*64 per slot */
class LightSet {
  ambient: Float32Array(3)                       // hue * intensity (P.hue[key] * P.lights.ambient.intensity)
  sun: { on, elevation, azimuth, dir: Float32Array(3) /* unit, TOWARD the sun */, col: Float32Array(3) }
  count: number                                   // active lights (<= MAX_LIGHTS)
  pos: Float32Array(4*MAX_LIGHTS)                 // x, y, z (jittered), radius        -> uLightPos
  col: Float32Array(4*MAX_LIGHTS)                 // hue*intensity*flicker rgb, visSlot -> uLightCol
  vis: Uint8Array(MAX_LIGHTS*MAX_VIS_CELLS)       // LVIS atlas staging, slot i rows [i*visH, (i+1)*visH)
  visDirty: Int8Array(MAX_LIGHTS)                 // 1 = slot re-upload needed this frame
  add(def): handle   // def = { x,y,z (world m), hue:[r,g,b], intensity, radius, flicker:{hzMin,hzMax,amount,jitter}, seed, on }
  move(handle, x, y, z): void;  setOn(handle, on): void;  remove(handle): void
  setSun({ elevation, azimuth, on }): void       // recomputes dir; the ONLY sun mutator (F6/F7 call it)
  update(timeSec, world): void                    // flicker -> pos/col; vis grid recompute per 5.; no allocation
}
buildLightSet(world, palette): LightSet           // level.def.lights (on:true) per placed structure, local -> world by origin; sun/ambient from the first structure's def (fallback: palette defaults)
lightAt(lights, world, x, y, z, nx, ny, nz, out: Float32Array(3)): void   // the shared per-point evaluator (surfaces, sprites US-030c/011)
lightSurfaces(fb, lights, cam, world): void       // JS reference: fb.light.rgb[3i..] for kind != 0 cells; CPU fallback uses the 4 nearest `on` lights
sunVisible(world, x, y, z, dir): boolean          // JS reference of the GLSL sun DDA (item 4)
computeVisGrid(lights, slot, world): void         // item 5
packLightUniforms(lights, outF32): number         // pure; returns count
```

Model per surface point `P` with normal `N` (US-002 rules, `P.util.addLight`/`falloff`): `L = ambient + sum_i col_i * falloff(|P-l_i|, r_i) * max(0, N.(l_i-P)/d) * vis_i(P) + sunCol * max(0, N.sunDir) * sunlit(P)`, `falloff(d, r) = d >= r ? 0 : (1-(d/r)^2)^2`. `P = eye + dir2(cell centre) * depth`, `P.z = eyeH + slope(row) * depth` with the caster's ray formula (14.2 item 1; GLSL `cellRay()` in `common.js`, JS the same expression); `N` from `face` 1..6 = (0,-1,0) N, (1,0,0) E, (0,1,0) S, (-1,0,0) W, (0,0,1) U, (0,0,-1) D. No world xyz is stored in the G-buffer; with n = 1 the centre ray is the cast ray, so parity is exact by construction.

**2. Flicker (JS only, deterministic).** Per light `f_i = hzMin + (hzMax - hzMin) * h01(seed_i)`, `u = timeSec * f_i + 7.31 * h01(seed_i + 1)`, `k = floor(u)`, `s = smoothstep(u - k)`, `v_c = mix(h01(k, seed_i, c), h01(k+1, seed_i, c), s) * 2 - 1` for channels c = 0 (intensity), 1, 2 (x, y jitter). `intensity *= 1 + amount * v_0`; `x += jitter * v_1`, `y += jitter * v_2`; z is not jittered. `h01` = the engine's integer hash (`Math.imul` mix, `>>> 8` / 2^24). `timeSec` is the fixed-step sim clock (`fb.timeSec`), never `performance.now()`; identical input -> identical frame. GLSL contains no noise; the jittered values arrive as uniforms.

**3. GPU `light` pass** (`glsl/light.frag.js`; order per 14.2 item 3 becomes cast -> resolve -> deriv -> **light** -> shade -> edge -> sprite). Viewport `cols x rows`; reads `GI` (kind, face), `DEPTH`, `uWorldGeom`/`uWorldFlags` + `uStructA/B/Count` (sun DDA), `LVIS` R8UI atlas, uniforms `uLightPos[16]`, `uLightCol[16]`, `uLightCount`, `uAmbient`, `uSunDir`, `uSunCol`, `uSunOn`, `uStructMaxH[8]`, camera uniforms of `dda.frag`. Writes `LIGHT` RGBA32UI: `xyz = floatBitsToUint(L)`, `w = sunlit | litCount << 8` (debug). `kind == 0` -> `L = ambient`, w = 0. `shade.frag` replaces `uLight` with `uintBitsToFloat(texelFetch(uLightTex, cell, 0).xyz)` at the top of the fragment; `shadeCore`/`shadeTail` unchanged (L is constant over a cell's sub-samples, so it factors out of the average). Editor/debug view: `?debug=light` shows `LIGHT` (rgb) and `?debug=sun` the sunlit bit.

**4. Sun shadow = 2D DDA toward the sun, per cell, both paths.** Skip when `uSunOn == 0` or `N.sunDir <= 0`. Start `S = P + sunDir * 0.02` (BUG-LIGHT-001: nudge toward the light, not along `N`; a floor has `N = (0,0,1)` and needs an x/y nudge to leave a cell boundary), `h0 = S.z + 1e-3`; walk the grid along `sunDir.xy` (same boundary stepping as the caster DDA), for each cell C compute `h1 = h0 + tanElev * (horizontal distance to the exit boundary)`: **blocked iff `h0 < C.floorH` or (`!C.ceilSky && h0 <= C.topH && h1 >= C.ceilH`)** (solid cells: `floorH` is the wall top; open cells: `floorH` is the step block, `[ceilH, topH]` the slab plus upper band, closed so `topH == ceilH` still blocks). Then `h0 = h1`. Lit when the ray leaves the footprint, `h0 > maxH(structure)`, or `MAX_SUN_STEPS = 48` is reached (bias to lit). Then the remaining placed structures by slab entry (structure loop as in `dda.frag`); outside every footprint -> lit. `sunDir = (sin az cos el, -cos az cos el, sin el)` (x east, y south, z up, compass azimuth = where the light comes FROM). Elevation <= 0 -> `sun.on = false`. **Amendment (architect review of US-007, 2026-09-24):** (i) the walk may be expressed in world coordinates (`world.structureAt`/`sectorAt` in JS, a per-step bbox point loop over `uStructCount` in GLSL) - same answer, no slab-entry chaining needed; (ii) all cell heights and `maxH` are level-local: compare `h - origin.z` (GLSL `A.z`); (iii) `packed.maxH` = max over cells of (solid ? floorH : max(floorH, ceilSky ? -Inf : topH)), `SKY_H` for `topSky`, kept in sync by `updateAnimatedSector` and re-packed into `uStructB[i].w` by `planFrameUpdate`; (iv) cells outside every footprint never block and cost no fetch, but the walk continues (so a structure across a gap still shadows) until `h0 > worldMaxH = max_i(origin.z_i + maxH_i)`, `h0 > maxH` of the structure just entered, or `MAX_SUN_STEPS` (bias to lit).

**5. Point-light visibility grid (CPU, uploaded).** Slot i covers the footprint of the structure containing the light (`world.structureAt`), cells within `ceil(radius)` of the light cell: 2D DDA from the light cell centre to the target cell centre; a cell blocks when `solid && lightZ < floorH`, or `!solid && (lightZ < floorH || (!ceilSky && lightZ > ceilH && lightZ <= topH))`; unreached cells and the light's own solid cell -> 0, reached -> 255. Recompute when `(floor x, floor y)` of the *unjittered* position, `world.structVersion` or `packed.version` changes (the lantern: <= 11x11 cells x <= 12 steps when it crosses a cell edge); mark `visDirty[i]`, the hook `texSubImage2D`s only dirty slots (<= 4 KB each). Shader/JS sample: `vis = LVIS[slot][floor(S.x - ox), floor(S.y - oy)] / 255`, `S = P + (l_i - P)/|l_i - P| * 0.02` (BUG-LIGHT-001: toward the light, same rule as item 4; the old `P + N*0.01` left floor samples on cell boundaries); outside the slot footprint or light outside every structure -> `vis = 1`. `LVIS` = R8UI, width `maxW`, height `MAX_LIGHTS * maxH` (max footprint of the placed structures, rebuilt on `structVersion`). Lights lighting a *second* structure are unoccluded in M1 (one structure); noted for M2. **Amendment (architect review of US-006, 2026-09-24, accepted deviation):** the slot is not the structure footprint but a per-light box of `2*min(16, ceil(radius))+1` cells (`MAX_VIS_DIM = 33`) centred on the light's unjittered cell; `LVIS` is `33 x (MAX_LIGHTS*33)` R8UI, `uVisBox[i] = (ox, oy, w, h)` per light, and the box is independent of the `packed` atlas (Node-testable). Consequences: occlusion is clamped to 16 m from the light (presets with a larger radius are unoccluded beyond that - acceptable for M1 presets; revisit if a M2 preset exceeds 16 m); `vis = 1` outside the box; cells outside every structure never block. Recompute keys: the light's unjittered cell, `world.structVersion`, and the containing structure's `packed.version`. Upload is keyed by a per-slot `visVersion` counter that the pipeline compares with its own uploaded version (reset on texture (re)creation), never by a one-frame dirty flag. The sample point is `S = P + N * 0.01` in both paths (a wall hit lies exactly on the cell boundary; sampling `P` itself is a float coin flip).

**6. Budgets (320x120, n = 2, owner laptop).** GPU `light` pass <= 0.3 ms (38,400 x [8 x ~25 flops + 8 `LVIS` fetches + sun <= 48 steps, typ. 5-10, 2 fetches each]); whole pipeline stays <= 4 ms p95 (14.2 item 6 + 0.3). JS: `LightSet.update` <= 0.05 ms, uniform upload <= 0.02 ms, dirty `LVIS` rows only; hook total <= 0.45 ms; frame JS <= 2 ms unchanged. Fallback (160x60, CPU): `lightSurfaces` with the 4 nearest `on` lights + sun, target <= 1.5 ms (N.L skip ~40 % of cells), not a hard budget (D-009 item 5: playable). VRAM: `LIGHT` 614 KB, `LVIS` <= 64 KB.

**7. Parity and oracle.** `?gpucompare=1` (160x60, n = 1) also reads back `LIGHT` (uint `readPixels`, test-only) and reports: `|dL| <= 1e-3` per channel on cells with equal sunlit flag (float32 vs float64 on ~10 flops per light), sunlit-flag mismatch <= 0.5 % of `kind != 0` cells (edge flips at boundary steps), point-light flips (`litFlip`: a cell with `|dL| > 1e-3` whose litCount also differs, i.e. one light fully in/out because the vis sample lands within float32 noise of a vis-cell boundary, BUG-GPU-004) <= 0.5 % of `kind != 0` cells, excluded from the dL check, then the US-029 glyph/fg/bg thresholds with lights and sun on and off. `shadetest` rows use `fb.light` per cell; `bench-cast.mjs` prints a `light` line (JS reference). The JS reference is the oracle; the GLSL never invents a rule the JS lacks. Determinism check: two `gpucompare` runs at the same `timeSec` sequence produce byte-identical `LIGHT`. **Status (BUG-LIGHT-001, 2026-09-24):** the `LIGHT` readback is implemented (`GpuCellPipeline.readbackLight()`, `compareLight()`, a `light:` line per `?gpucompare=1` row). It is reported only until the OWN-001 `dLViol 3` is explained (BUG-CAST-001 notes), then it gates. Rule: a parity failure only on kind-edge cells (which `compareGeometry`/`compareLight` skip) is a caster geometry problem. Read back `GI` kind/`DEPTH` on those cells before blaming lighting. **Remaining debt:** `?debug=light`/`?debug=sun` are not implemented yet; the shaded-output thresholds with lights and sun on are the accepted M1 proof. Open a small follow-up story before the M1.5 editor (they are its stable debug views).

**8. Fallback and switches.** GPU path unavailable (14.2 item 7) -> `lightSurfaces` in the compositor before `shadeSurfaces`, lights capped at the 4 nearest to the camera (re-sorted each frame in `update`, no allocation), sun on. `?lights=0` -> `fb.light.uniform = true` with ambient (US-028 behaviour, regression path); `?sun=0`; `?lights=8` test-only synthetic extra lights (game side). Level data (`level.def.lights/sun/ambient`, MAP_FORMAT) is the source; presets resolve via the registry palette (`P.lights[preset]`, `P.hue[color]`), never `window.ASSETS`. Editor extension point: `LightSet.add/move/remove/setSun` are the handles the M1.5 placer uses; `LIGHT` and the sunlit bit are stable debug views.

**9. Do not**: light per sub-sample; walk LOS to point lights in the shader (grid only); bake a 2D sun mask; noise in GLSL or `Math.random` anywhere in lighting; `Math.pow` (use `x*x`); store world xyz in the G-buffer; recompute a visibility grid because of jitter; put level heights, light positions or the tower's sun in GLSL constants; allocate in `update`/`lightSurfaces`/the hook.

### 14.4 GPU cell pipeline, stage 3 (US-016): far-LOD terrain march in GLSL, JS oracle, far-tower billboard (architect, 2026-09-23)

Normative for terrain rendering from US-016 on; 14.1/14.2 stay valid. D-007 semantics (terrain fills only what the sector pass left open, shared depth, one world frame) are unchanged; only the compute location moves per D-009. Build plan and tests: US-016 tech notes in `docs/backlog.md`.

**1. Principle: same ray as the DDA, one fragment = one sub-ray, terrain is a second candidate behind the sector hit.** The terrain pass uses the *identical* `ray(x,row)` function of 14.2 item 1 (shared GLSL in `glsl/common.js`): `p(t) = eye.xy + dir2*t`, `h(t) = eyeH + slope*t`, `t` = perp distance. Horizon alignment at every pitch therefore holds by construction, not by tuning. The march is bounded by the sector depth of the same sub-ray: `tMax = min(SDEPTH, FOG_FULL)`, so terrain never draws over a structure cell and needs no span logic.

**2. Pass placement: A2 `terrain`, sub-sample resolution, ping-pong.** After pass A (`cast`) and before B (`resolve`): renders `cols*n x rows*n`, reads `SGI/SGA/SDEPTH` (set 1), writes `SGI2/SGA2/SDEPTH2` (set 2: copies the pass-A sample unless terrain is nearer). Resolve reads set 2 when `world.terrain && terrain.farReady`, set 1 otherwise (bind-time choice, no uniform). Coverage voting (14.2 item 3) thus applies to terrain cells for free. Never fold the march into the cast program (compile isolation, register pressure; a terrain compile failure must not take the sector path down). Extra VRAM 4.3 MB at 320x120 n = 2.

**3. Terrain textures** (`engine/render/gpu/TerrainTextures.js`, pure packing + upload plan, Node-testable):
- `FARH` R32F 256x256 = `terrain.farHDraw` (= `farH` + canopy: `recipe.look.types.forest.canopy` (10 m) where `farType == forest`; built by `Terrain` at bake end; `farH` itself stays physics-only). Sampled with **manual bilinear (4 `texelFetch`)**: R32F is not filterable without `OES_texture_float_linear`, and manual bilinear matches `util.gridHeight` exactly. Do not use R16F + hardware filtering (8-bit filter weights on some GPUs, and it would not match the oracle).
- `FARTYPE` R8UI 256x256 = `terrain.farType`, nearest.
- `TLOOK` RGBA32F width 8, row = type id: texels 0-2 dark/mid/light rgb (palette, linear 0..1, un-gained), texel 3 = (albedo, glintFlag, 0, 0), texels 4-6 = glyph codes of the near/mid/far sets packed 8 bits each little-endian in `x` (<= 3 codes) + count in `y` (small integers, exact in float32).
- Uploaded once when `farReady` flips and again only when `terrain.farVersion` changes (`texImage2D`; ~320 KB total). Never per frame.
- Uniforms: `uTerrainMaxH` (max of `farHDraw`), `uFarMap` = `vec4(x0, y0, cell, size)`, `uSunDir` (unit vector toward the sun; US-007 owns it, until then the compositor derives it from the level's `sun`), `uTerrainLight` = (ambientI, sunI), `uFogFar` = (start 50, full 1500, curve 0.7, hazeCut 0.85), `uFogFarNear` / `uFogFarColor` rgb, `uTimeSec`, `uStruct*` (14.2) for the bbox skip.

**4. March (normative for GLSL and `castTerrain`; both implement it literally):**
```
if (!(slope < 0.0) && eyeH >= uTerrainMaxH) -> no hit (0 steps: every above-horizon ray)
tMax = min(sectorDepth, FOG_FULL = 1500);  t0 = T_START = 0.5
skip intervals: for s in 0..uStructCount: [tIn, tOut] = 2D slab of p(t) vs the structure bbox (origin.xy .. +w,h; half-open); computed once per ray
for step in 0..MAX_TERRAIN_STEPS (128):
  dt = max(STEP_MIN = 3.0, STEP_K = 0.03 * t0);  t1 = min(t0 + dt, tMax);  last = (t1 == tMax)
  if (slope > 0.0 && h(t1) > uTerrainMaxH)     -> no hit          // climbing above every hill
  if p(t1) outside the far map                 -> no hit          // haze: the sky pass paints skyHorizon == fogFar
  if t1 inside any skip interval               -> t0 = t1; continue (no sample)   // arch 7: cells in a structure bbox belong to the structure
  H = bilinear(FARH, p(t1));  if (h(t1) < H) -> hit: 5 bisection steps on f(t) = h(t) - H(p(t)) in [t0, t1], tHit = midpoint; break
  if last -> no hit;  t0 = t1
```
Hit sample: `kind = KIND_TERRAIN (7)`, `mat = type id` (nearest `FARTYPE` texel at `p(tHit)`), `face 0`, `planeId = PLANEID_TERRAIN` (one constant plane: the edge pass then outlines only terrain/structure and terrain/sky boundaries, never the 8 m grid), `u, v = p(tHit)` (world), `z = H`, `aoD = b` where `N = normalize(vec3(-(H(x+c) - H(x-c)), -(H(y+c) - H(y-c)), 2c))`, `c` = 8 m, `b = ambientI + sunI * max(0, dot(N, uSunDir))`, `depth = tHit`. Worst case 153,600 sub-rays x 128 steps x 4 fetches; typical breach view ~30 % open cells at ~60 steps -> the terrain pass budget is **<= 1.0 ms p95** of the 4 ms.

**5. Terrain shading: `shadeTerrainFar`**, one function in GLSL (`glsl/terrain.frag.js`, included by `shade.frag.js`) and in JS (`engine/render/terrainShade.js`); inputs: t, type, b, u, v, timeSec. Runs in pass D for `kind == 7` instead of `shadeCore/shadeTail`; `deriv` and `edge` pass kind 7 through untouched.
- far cell `(cx, cy) = floor(u / 8), floor(v / 8)`; `hA = hash(cx, cy, type)`, `hB = hash(cx, cy, 7)` (uint hash per 14.1 rule 5; world-keyed, never screen-keyed).
- colour index `i = (b < 0.45 ? 0 : b < 0.8 ? 1 : 2) + (int(hA * 3.0) - 1)`, clamped 0..2; `fg = gain(TLOOK[type][i])` via the `GAIN` LUT; `bg = fg * 0.3`.
- band by `t`: `< 150` near, `< 600` mid, else far (`recipe.look.bands`); glyph = `set[int(hB * count)]`.
- water glint: `g = hash(cx, cy, uint(floor(timeSec * 1.5)))`; if `g > 0.5`: glyph index `^= 1` (within the set) and `fg = mix(fg, riverLight, 0.35)` before fog.
- fog: `f = pow(clamp((t - 50) / 1450, 0, 1), 0.7)`; `fogC = mix(fogFarNear, fogFar, f)`; `fg = mix(fg, fogC, f)`; `bg = mix(bg, fogC, min(1, 1.1 f))`; `f > 0.85` -> glyph = space. Bytes per 14.1 rule 5.
- Sky is unchanged (`fastShadeSky` / its GLSL port; `skyHorizon == fogFar`, so no seam). `fillSky` (JS) paints kind 0 cells only.

**6. JS oracle and CPU fallback: `castTerrain(fb, terrain, cam, opts)`** (`engine/render/terrainCaster.js`, exported). For every cell the sector pass left with `depth == +Infinity` (every column, every row - not only the open span: the sector pass may paint below-horizon rows as sky and close them, while pass A2 marches every `kind == 0` sub-ray; the open span is only narrowed from hits inside it): the same ray as the DDA's centre ray (`n = 1`: column `x + 0.5`, row sample `row`, NOT `row + 0.5`), the same march (item 4) in float64 over `farHDraw` with `util.gridHeight`-equivalent bilinear; writes `fb.gbuf.writeSample(...)` and `fb.depth`. No allocation (module-level scratch: skip intervals `Float64Array(16)`, one hit record). `opts = { sun: {dir, ambientI, sunI}, stepMin = 3, stepK = 0.03, maxSteps = 128, timeSec }`; the CPU path passes `stepMin 6, stepK 0.06, maxSteps 64` (playable, not equal; D-009 item 5). Pure helper `marchTerrainRay(terrain, ex, ey, eyeH, dx, dy, slope, tMax, skips, nSkips, opts, out) -> boolean` is the unit-test surface. Until `farReady` terrain is not drawn (sky only); no haze-only special case is needed because `skyHorizon == fogFar`.

**7. Far tower = a world billboard entity, not terrain code.** `world_m1.js` gets `{ id: 'farTower', type: 'billboard', x: 713.8, y: 1232.1, z: <ground>, model: 'farTower', unlit: true, fogModel: 'far', fogMax: 0.40, sizeM: {w: 14, h: 42}, minCells: {w: 3, h: 4}, detailRows: 12 }`; the silhouette moves to `design/models/far_tower.js` (frames `min` 3x4 and `detail` 5x8; the recipe keeps `farTower.model = 'farTower'`). `projectSprite` (shared by pass F and `drawSprites`) gains: `minCells` clamp (after LOD), frame choice by projected rows >= `detailRows`, `unlit` (light = 1, no N.L), per-sprite `fogF` + `fogRGB` computed in JS (`fogModel: 'interior' | 'far'`, `fogF = min(fogMax, f)`), so the sprite shader stays fog-model-agnostic (US-030 owns the `SPR` texel layout; extend to 3 texels if needed). The depth test against `DEPTH` now includes terrain. US-022 never touches this entity.

**8. Fallback and gating.** Terrain program fails to compile/link -> the whole frame takes the CPU path at `cpuGrid` (14.2 item 7; no mixed GPU-sectors/CPU-terrain mode). `terrain == null` or `!farReady` -> pass A2 skipped, resolve reads set 1. `?terrain=0` (parsed in `game/js/main.js`) skips terrain on both paths for A/B benches.

**9. Parity (`?gpucompare=1`, extended).** Poses: `tools/bench-poses.js` adds `breach` (summit eye 7.6 m, yaw 270, pitch 0), `breachDown` (pitch -30), `parapetSky` (pitch +20), `ringLook` (looking down at the outer ring from the bastion). `timeSec` fixed to 0 in compare mode. Thresholds as 14.2 item 8, plus terrain-specific: kind-7 cell count within 1 % between paths; `mat` equal and depth within 1 % on matched terrain cells; glyph >= 99 % excluding 4-neighbour-kind edge cells and excluding kind-7 cells whose `t` lies within 1 % of a band edge (150/600) or whose `b` lies within 0.01 of 0.45/0.8 (float32 tier flips, 14.1 rule 5).

**10. Do not:** sample terrain inside a structure bbox; march beyond `FOG_FULL`; use hardware filtering on the height texture; key any hash on the screen cell; upload `FARH`/`FARTYPE` per frame; give terrain cells per-grid-cell planeIds; bake lighting `b` into a texture (the sun is a uniform; normals are computed at the hit only); put recipe constants (bands, fog, glyph sets) in GLSL source - they arrive through `TLOOK`/uniforms from the registry.

**11. D-017 amendments (2026-09-24, supersede the matching text above).** Item 6: `castTerrain` is the oracle only; it uses the GPU schedule (`stepMin 3, stepK 0.03, maxSteps 128`) on every path, no coarse CPU options, no budget. Item 8: a terrain compile/link failure is a startup error on the US-045 "WebGL2 required" screen path (logged with the GLSL info log), not a switch to the CPU frame; `?gpu=0` stays a dev view. Parity is only asserted under `?gpucompare=1`.

**12. D-011 addendum: per-key emissive fog cap.** Model keys may carry `fogMax` (0..1; `far_tower.js` L/G 0.20, `ferrum_lights.js` d/l 0.25, h 0.20). `buildSpriteAtlas` stores it in the texel alpha: `a = 0` transparent, else `a = 1 + round(fogMax * 254)` (no `fogMax` = `a 1` = today). Emissive cells: `fe = min(fogF, (a - 1) / 254)` with the sprite's own (already capped) `fogF` and `fogRGB`; `rgb = base + (fogRGB - base) * fe` (skipped when `fe == 0`, so the burner flame etc. stay unfogged). Non-emissive cells ignore the key cap. Identical formula in `sprites.frag` and `drawSprites` (decode the same byte; parity by construction). Signal tower: `L` stays >= 1 cell through the `minCells` clamp of item 7.

**13. D-011 addendum: horizon billboards (`world.horizon[]`).** `World.load` copies `def.horizon ?? []` into `world.horizon` (plain data, validated: unique `id`, model in the registry, numeric `bearingDeg`, `elevDeg`, `angular.wDeg/hDeg`, `fog` 0..1, `fogColor` palette key; throws with the id otherwise); `serialize` writes it back unchanged (content, not state; round-trip test). They are **not entities** and not lights. Drawing reuses the sprite pool, so pass F and `drawSprites` stay the single implementation: `SpritePool.collect` appends one slot per horizon entry after the entities; `projectHorizon(cam, rt, h, slot)` computes centre `col = cols/2 + focalCols * tan(bearing - yaw)` (skip if `|bearing - yaw| >= 90`), bottom `row = horizonRow - planeDistY * tan(elevDeg)` (y-shear included via `horizonRow`), `scale = planeDistY * (tan(elev + hDeg) - tan(elev)) / model.h` (one scale for both axes; width follows the model), tier `lods.half` when `scale < 0.75` (same rule as sprites), `unlit` (mul 1), `fogF = h.fog`, `fogRGB = palette[h.fogColor]`, depth **`HORIZON_DEPTH = 1e6`**: the existing depth test then draws it only on cells with no finite depth (sky; terrain <= 1500, structures closer), and never over the far tower. Programmer checks that sky depth is +Inf / the max encoding on both paths (`sprites.test.js` case). Cost: 1 slot, ~150 cells: negligible.

**14. Addendum parity/tests.** Node: atlas alpha encoding round-trip (`fogMax` 0 / 0.20 / 0.25 / 1), emissive-with-cap vs without in `drawSprites`; `world.test.js`: `horizon` load/validation errors/serialize round-trip; `projectHorizon` column/row at yaw = bearing, pitch 0/+20, tier switch at 160x60 vs 240x90, off-screen skip; a horizon slot never writes a cell with finite depth. Browser `?gpucompare=1`: breach poses (signal-tower light cells, teal after fog) + `summitEast` (relay plinth eye 8.2 m, yaw 87.6) + breach looking back E; US-029 thresholds. US-018 budget unchanged.

## 15. 3D glyph models (architect estimate, 2026-09-23)

Goal: entities (e.g. a bear the player walks around and talks to) that are real 3D objects in the DDA world but still read as glyphs: every screen cell of the model goes through the same G-buffer -> `light` -> `shadeCore/shadeTail` -> `edge` chain as walls and terrain (8.1, 14.1-14.4). Nothing here is decided for the backlog; it is the estimate the PO/manager asked for. Assumes US-030b/c (sub-sample G-buffer, sprite pass) and 14.3 are in.

**Shared rules for any 3D model option (A or B):**
- New `kind = KIND_MODEL (8)`; `mat` = a MaterialTable id (models use palette/detailPass materials, so they get the world's textures and tones for free); `planeId = (0xF<<28) | (modelSlot<<20) | (faceAxis<<16) | layer` so the edge pass outlines silhouettes and voxel steps exactly as it outlines wall/step seams; `aoD = Infinity` (no concave AO on models).
- Normals: `face` 1..6 stays for axis-aligned faces (faceK, u/v choice). When a face is rotated (animated part, mesh triangle) the pass writes `face 7` and the unit normal octahedral-packed (2x16 bit) into `GA.w` (the `aoD` slot, free because aoD = Inf); the `light` pass decodes it for `kind 8 && face 7`. This is the only change to `light.frag`/`lightSurfaces`; `shadeCore/shadeTail` and `edge` are untouched.
- Pass placement: A3 `models` between A2 `terrain` and B `resolve`, sub-sample resolution, ping-pong set (reads set 2, writes set 3; copies unless the model hit is nearer). Coverage voting then anti-aliases model silhouettes like walls. Never fold it into `cast`/`terrain` (compile isolation, 14.4 item 2).
- Instances: `uModel[16]` = bbox (world), slot, frame/part data offsets; JS culls to the frustum and uploads only visible instances (<= 2 KB). Entity state stays serializable (`entities[].transform`, `anim.{name,frame}`); the renderer holds no entity state.
- Fallback/oracle: a JS `castModels(fb, list, cam)` runs on the CPU path at `cpuGrid` (same march, float64) and is the `?gpucompare` oracle (new pose `bearClose`, same thresholds as 14.2 item 8 for kind 8 cells; light `|dL| <= 1e-3` with packed normals, tolerance 1/32768 per component).

### Option A - voxel models (recommended)

- **Data** (`ModelDef.voxel`, JSON-safe, editor-friendly: z-layers as strings exactly like level `rows`):
  ```js
  voxel: { cellM: 0.125, size: [sx, sy, sz], anchor: [ax, ay, 0] /* voxel units, feet centre */,
           mats: { '#': 'fur_dark', 'o': 'fur_light', '.': null },          // char -> material key
           parts: { body: { box: [x0,y0,z0, x1,y1,z1], pivot: [px,py,pz] }, head: {...}, legFL: {...} },
           layers: [ 'row strings per z layer, sy rows of sx chars' ],       // one static shape
           animations: { idle: { fps: 4, loop: true, frames: [ { head: { rot: [0,0,5], pos: [0,0,0] } } ] },
                         walk: { fps: 8, loop: true, events: { step: [0, 4] }, frames: [...] } } }
  ```
  A bear at 0.125 m: 16x8x12 = 1,536 voxels, 1.5 KB. `parts` are axis-aligned boxes of the same grid; a voxel belongs to the first part whose box contains it (editor: paint layers, drag boxes).
- **Animation: rigid parts, not per-frame voxel sets.** Per frame each part has `rot` (degrees, xyz) and `pos` (voxel units). Per-frame voxel sets are simpler but cost `frames x voxels` bytes, cannot interpolate, and every frame must be hand-painted; rigid parts give walk/idle/turn from 4-8 keyframes with linear interpolation in JS (fixed step, deterministic). Rotated parts are marched in part-local space (inverse rigid transform of the ray; the ray stays a 3D DDA in an axis-aligned grid), so normals stay axis-aligned *locally* and are rotated once at the hit (face 7 + packed normal if any rotation != 0, else face 1..6).
- **March (GLSL and JS, literal twins):** per sub-ray, for each visible instance: slab test vs world bbox (skip if `t0 >= current depth`); for each part (<= 8, constant bound): transform ray to part space, slab vs part box, 3D DDA (Amanatides-Woo) <= `MAX_VOX_STEPS = 48`, one `VOX` R8UI atlas fetch per step (0 = empty, else material index -> `MODELMAT` R16UI row); first non-empty voxel is the hit: `u,v` = hit point on the voxel face in metres (part-local, so textures stick to the body), `z` = hit z - model feet z. Nearest hit over parts/instances wins.
- **Lighting/detail:** entirely reused; the model reads as glyph "blocks" with the wall's texture hashes at voxel scale (world-anchored: hashes key on part-local `floor(u*detail)`), the edge pass draws its outline and its steps. Looks like the world by construction.
- **Budget (240x90, n = 2 = 86,400 sub-rays):** a bear filling 30 % of the screen -> ~26k sub-rays x ~25 DDA steps x 1 fetch = 0.65 M fetches, about 0.2-0.3 ms; **pass budget <= 0.5 ms p95**, whole pipeline still <= 4 ms p95 (14.2 item 6 + light 0.3 + terrain 1.0 + models 0.5 = 3.8 at 320x120 is tight -> if measured over, 240x90 is the reference grid for M2/M3 content). JS: `castModels` on the CPU path ~0.3 ms for one near bear at 160x60; animation update <= 0.02 ms per entity; upload <= 0.05 ms. VRAM: `VOX` atlas <= 64 KB for 16 models, ping-pong set +4.3 MB at 320x120.
- **Effort: 3 stories.** (1) `VoxelModel.js` format + validator + packer + `marchVoxelRay` + `castModels` + Node tests (no GPU; can run in parallel with US-016); (2) GLSL pass A3 + `KIND_MODEL` in light/resolve/edge pass-through + gpucompare pose + flicker check; (3) rigid-part animation + entity binding (`type: 'voxelModel'`, facing from entity yaw, `mounts` reused for the talk prompt anchor) + designer bear preview page. Editor (M5) needs only a layer painter and a part-box/keyframe panel: the format is already row strings + small JSON.
- **Risks:** rotated parts pop between voxel and face-7 shading if `faceK` differs from the lit normal (mitigation: faceK = 1 for kind 8); stair-stepping on slow rotations (accept: it is the glyph look); 16-instance cap (crowds -> billboards, option C); the ping-pong set is a third copy of the sub-sample G-buffer (VRAM fine, one more pass of fixed cost ~0.1 ms).

### Option B - low-poly meshes rasterised into the G-buffer

- **Data:** `ModelDef.mesh = { verts: [x,y,z,u,v,...], tris: [i0,i1,i2,mat,group,...], parts/bones }` (JSON arrays; editor-friendly only with an external modeller or a much larger M5 tool).
- **Animation:** rigid parts (as A) or skeletal (bones + weights, skinning in the vertex shader; a JS skinning oracle is another 1-2 stories).
- **Pipeline:** a real triangle pass (vertex + fragment program, `DEPTH24` renderbuffer initialised by a copy of `SDEPTH2`, MRT into set 3 writing `floatBitsToUint` samples; per-triangle normal -> face 7 + packed normal; `planeId` per smoothing `group`, otherwise the edge pass outlines every triangle). This is the first non-fullscreen-triangle draw in the pipeline: new vertex path, instance buffers, depth-attachment management.
- **Lighting/detail:** reuses `shadeCore/shadeTail` via uv; but smooth normals + interpolated uv produce continuous gradients, i.e. a shaded low-poly look, not blocks. To look glyph-like the mesh must be flat-shaded and uv quantised per face, at which point it is a worse voxel model.
- **Budget:** raster cost negligible at 240x90 (<= 0.2 ms), but the depth copy + attachment switch adds ~0.1-0.2 ms fixed. **Effort: 6-8 stories** (mesh format/loader, triangle pass, depth bridging, JS scanline rasteriser oracle ~ the hardest oracle so far, skeletal animation, editor import). **Risks:** parity oracle (a JS rasteriser must match GPU edge rules exactly, sub-pixel conventions differ), aesthetic drift away from the cell world, no CPU fallback at playable cost, large M5 tool surface.

### Option C - multi-angle billboards (8 directions), cheap step

- **Data:** `ModelDef.dirs = 8`, `animations[name].frames[dir][frame]` (or the current `frames[]` with `dir` interleaved by convention `frames[f*8 + dir]`); per glyph `n` normal codes as today. JSON-safe, editor = the existing sprite frame painter x 8.
- **Runtime:** JS picks `dir = round(((atan2(cam - entity) - entity.yaw) / 45deg)) & 7` once per visible sprite per frame (one `atan2` per sprite, not per cell; fine), then `projectSprite` as US-030c. Zero engine render changes beyond the frame index formula; the entity carries `yaw`.
- **Lighting/detail:** sprite path (`shadeSprite`, per-glyph normals, fog, depth test), not `shadeCore`: models do not pick up the wall's texture language or the edge pass; they read as painted characters. Silhouette pops at 22.5 degree boundaries; no parallax when circling; walking around a bear looks like a turntable.
- **Budget:** already inside the sprite pass budget (0.1 ms). **Effort: 1 story** (+ designer art: 8 dirs x frames). **Risk:** content cost grows 8x per animation; readable only for characters that already work as flat art.

### Recommendation and timing

**A (voxel, rigid parts), staged: C first for M2 content as the safety net, A in three stories before M3.** Voxels are the natural 3D form of this engine: the world is already an axis-aligned cell grid marched by a DDA, so a voxel model is the same maths at a smaller cell size, shares `shadeCore/shadeTail`, light and edge unchanged (one normal-packing rule), has a cheap float64 JS oracle, and its data format is the level format in miniature (row strings), which is exactly what the M5 model editor can paint. B is a different renderer bolted onto this one and undermines the glyph look. C stays useful for crowds, birds and far NPCs beyond the 16-instance cap.

Timing: story (1) is Node-only and can start as soon as US-030b is `ARCH OK` (it does not touch `engine/render/gpu/*`); (2) and (3) after US-016 (14.4) and US-006/007 (14.3) land, because the pass slot (A3) and the `face 7` normal path depend on both. If the `light` pass is not in yet when (2) starts, kind 8 cells use `face` 1..6 only (no rotated parts) and the packed normal lands with (3).

**Do not:** raymarch models per cell in JS on the GPU path (culling is per instance, marching per sub-ray in GLSL); store voxel data as one string per voxel or as nested arrays of numbers (row strings per layer only); give models per-cell planeIds (edge pass would outline every screen cell); bake lighting into voxel colours (materials + `light` pass only); let entity code touch `gl` or the packer (the entity exposes `{ model, transform, anim }`, the renderer reads it).

### 15.1 Voxel model format, packer and JS oracle (US-039, architect, 2026-09-23)

This refines section 15 option A. Where the two differ (the planeId layout, the face-7 rule, the fixture size), this subsection wins.

**Folder:** `engine/voxel/` is a new engine module. It imports only the constants in `engine/render/GBuffer.js`, and never `game/`, `design/` or `render/gpu/`. It gets no `engine/index.js` exports until US-041 (tests import the files directly). GDD words stay out of `engine/`, so the test fixture is a generic "quadruped" that is shaped like a bear.

**Constants** (in `engine/voxel/VoxelModel.js`; they move to `GBuffer.js` in US-040):
`KIND_MODEL = 8`, `FACE_PACKED = 7`, `MAX_VOX_PARTS = 8`, `MAX_VOX_STEPS = 48`, `MAX_VOX_DIM = 32`, `MAX_VOX_INSTANCES = 16`, `RESERVED_EVENTS = ['animEnd','arrive','interact','removed']`.

**Data: `ModelDef.voxel`.** It is JSON-safe and uses dense row strings, with no RLE. Models are about 1 KB, rows diff and paint well, and the packer produces the dense atlas.
```js
/** @typedef {Object} VoxelModelDef
 * @property {1} version
 * @property {number} cellM                       metres per voxel, 0.01..1 (content default 0.125)
 * @property {[number,number,number]} size         [sx, sy, sz] ints 1..32, sx*sy*sz <= 4096
 * @property {[number,number,number]} anchor       voxel units (float ok): feet centre = the entity transform origin
 * @property {Object<string,string|null>} mats     1 char (0x21..0x7E) -> palette/detailPass material key, or null (= empty).
 *                                                 '.' and ' ' are always empty. <= 255 non-null chars.
 * @property {string[][]} layers                   layers[z][y] = row string of sx chars. z = 0 is the BOTTOM layer (feet),
 *                                                 y = 0 is the model's FRONT row (faces north at yaw 0), x = 0 is west.
 * @property {Object<string,VoxelPartDef>} parts   insertion order = part index 0..7; 1..8 parts
 * @property {Object<string,VoxelClipDef>} [animations]
 *
 * @typedef {Object} VoxelPartDef
 * @property {[number,number,number,number,number,number]} box   [x0,y0,z0,x1,y1,z1] ints, half-open, inside size
 * @property {[number,number,number]} pivot                        voxel units (model rest frame)
 * @property {string} [parent]                                     an EARLIER part (acyclic by construction)
 *
 * @typedef {Object} VoxelClipDef   (the same timing and events shape as sprite clips, 10.1)
 * @property {number} [fps]             exactly one of fps (0 < fps <= 60) | durations (ms > 0, one per frame)
 * @property {number[]} [durations]
 * @property {boolean} loop
 * @property {'linear'|'step'} [interp] default 'linear'
 * @property {Object<string,number|number[]>} [events]   tag -> frame index(es), 10.1 semantics
 * @property {Array<Object<string,{rot?:[number,number,number], pos?:[number,number,number]}>>} frames
 *           1..64 keyframes; per part: rot = degrees about the part's local x, y, z; pos = voxel units. Missing = 0.
 */
```
A voxel belongs to the **first** part (in index order) whose box contains it. The rest pose has every rot and pos at 0.

**Transforms (the literal twin for GLSL).** These are standard matrices on (x, y, z) components. With x east, y south and z up, a positive rotation about z turns east toward south. Seen from above that is clockwise, the same sense as compass yaw. `R(rot) = Rz(rz) * Ry(ry) * Rx(rx)`. `cosSinDeg(d)` returns exact {0, +-1} when `d % 90 === 0`, else `Math.cos/sin(d*PI/180)`. JS does this computation, and GLSL receives the resulting matrices, never angles.
- Model to world: `W = T(inst.x, inst.y, inst.z) * Rz(yawDeg) * S(cellM) * T(-anchor)`.
- Part local to model: `M_k = M_parent * T(pivot + pos) * R(rot) * T(-pivot)` (for a root part, parent = identity).
- For each part and frame, the pose stores the **world-to-part-local affine** `L_k = (W * M_k)^-1` as 12 float64 values (`A` 3x3 row-major, then `b` 3). It is built from rigid inverses (transpose plus scale `1/cellM`), never from a general 4x4 inverse. The ray `o + t*d` maps to `A*o + b + t*(A*d)`, so **t is unchanged**: it stays the perpendicular camera distance that `fb.depth` stores.
- Normals: `n_world = cellM * A^T * n_local`.
- `axisAligned_k` means `yawDeg % 90 === 0` and every rot component along the part's parent chain is `=== 0` at this pose. Axis-aligned parts write world face 1..6 (from the rounded `n_world`) with `aoD = Infinity`. All other parts write `face 7` and the packed normal.

**Pose sampling.** This is deterministic and is shared with the US-041 `stepAnimations`. Instance state is `{clip, frame, tMs}`: the 10.1 `sprite` fields `anim/frame/t`, with anim resolved to a clip index at bind time.
- `alpha = interp==='step' ? 0 : clamp(tMs / durMs[frame], 0, 1)`.
- `next = frame+1 < n ? frame+1 : (loop ? 0 : frame)`.
- Per part and component: `v = K[frame] + (K[next] - K[frame]) * alpha`. This is an Euler lerp, which is fine for the small angles of idle and walk.
- `clip = -1` is the rest pose.

**Packed model.** It is built at bind time (so it may allocate) and is never serialized.
```js
/** @typedef {Object} PackedVoxelModel
 * @property {number} sx, sy, sz, cellM, partCount, version    version++ on every repack (GPU re-upload key, US-040)
 * @property {Float64Array} anchor                 3
 * @property {Float64Array} parts                  partCount * PART_STRIDE(16): x0,y0,z0,x1,y1,z1, px,py,pz, parent(-1), atlasOff, bx,by,bz, pad, pad
 * @property {Uint8Array} vox                      the 'VOX' atlas bytes: per part a dense box block (bx*by*bz), index
 *                                                 atlasOff + (x-x0) + bx*((y-y0) + by*(z-z0)); 0 = empty (or owned by an
 *                                                 earlier part), else local material index 1..255
 * @property {Uint16Array} matIds                  the 'MODELMAT' row: local index -> MaterialTable id (0 unused)
 * @property {Array<{name:string, n:number, loop:boolean, step:boolean, durMs:Float32Array, keys:Float64Array, tagCodes:Int16Array}>} clips
 *           keys = n * partCount * 6 (rx,ry,rz,px,py,pz)
 * @property {Object<string,number>} clipIndex     name -> clip index (bind-time lookup only)
 */
packVoxelModel(def: VoxelModelDef, matIdFor: (key: string) => number): PackedVoxelModel   // throws if validation fails; matIdFor = MaterialTable.idFor
```

**Validator:** `validateVoxelModel(def, opts?: {materialKeys?: Iterable<string>}) -> {errors: string[], warnings: string[]}` collects **all** problems. Each one is prefixed with its path, e.g. `voxel.layers[3][2]: row length 11, expected 12`. `assertVoxelModel(def, opts)` throws one Error that lists every line. Rules:
1. JSON-safe: only plain objects, arrays, strings, finite numbers, booleans and null (no undefined, NaN, Infinity, functions or typed arrays).
2. `version === 1`. `cellM` is finite and in [0.01, 1]. `size` is 3 ints in 1..32 whose product is <= 4096. `anchor` is 3 finite numbers in [0, size].
3. `mats`: keys are single chars 0x21..0x7E. `'.'`, if present, must be null. Values are strings or null, with at most 255 non-null. With `opts.materialKeys`, every value must be a known key (`unknown material key 'fur_x'`).
4. `layers`: exactly sz arrays, each of exactly sy strings of exactly sx chars. Every char is `'.'`, `' '` or a `mats` key (`unknown voxel char 'q' at [z][y][x]`).
5. `parts`: 1..8 of them (`> 8 parts`). Names match `/^[A-Za-z][A-Za-z0-9_]{0,15}$/`. Boxes are ints with `0 <= x0 < x1 <= sx`, and the same for y and z (`part box outside the grid`). The **box extent is `bx+by+bz <= 48`**, so `MAX_VOX_STEPS` can never truncate a march. The pivot is finite. `parent` names an earlier part. Every non-empty voxel lies in some part box (`orphan voxel at [z][y][x]`). A part that owns no voxels is a warning, not an error.
6. `animations`: names follow the part-name pattern. Exactly one of `fps` / `durations` is set (durations length = frames length, each > 0). There are 1..64 frames, and frame keys are part names. `rot`/`pos` are 3 finite numbers with `|rot| <= 180`. `loop` is a boolean and `interp` is linear or step. Event tags match the name pattern and are not in `RESERVED_EVENTS`; their indices are ints in [0, n).

**March (`engine/voxel/voxelMarch.js`).**
```js
marchVoxelRay(pm, k, pose, ox, oy, oz, dx, dy, dz, tMax, out: Float64Array /*>= 8*/): 0|1
  // part k, WORLD ray; out = [t, lx, ly, lz, localFace 1..6, layer, 0, 0]; hit only if t < tMax
castModels(fb, list: VoxelInstance[], cam: Camera, opts?: {faceMode?: 'packed'|'nearest', stats?: {instancesCulled, raysMarched, cellsWritten}}): void
computeVoxelPose(pm, inst, out: Float64Array /* MAX_VOX_PARTS*16 */): void   // per part: L_k (12) + axisAligned flag + pad
// engine/voxel/octNormal.js
packNormalOct(nx, ny, nz): number /*uint32*/;  unpackNormalOct(bits, out: Float64Array /*3*/): void
/** @typedef {{ model: PackedVoxelModel, x:number, y:number, z:number, yawDeg:number, clip:number, frame:number, tMs:number }} VoxelInstance
 *  Renderer-side, filled from entity data (US-041); castModels only reads it. */
```
- **The projection is the sector caster's** (the castScene block in `sectorCaster.js`): `tanHalfHFov`; `planeDistY = (rows/2) * screenAspect / tanHalfHFov` with `screenAspect = cols*pxCellW / (rows*pxCellH)` from `fb.rt`; `horizonRow = rows/2 + tan(pitch)*planeDistY`. The cell ray is not normalised: `cameraX = 2*(x+0.5)/cols - 1`, `d = (dirX + planeX*cameraX, dirY + planeY*cameraX, (horizonRow - (row+0.5)) / planeDistY)`, `o = eye`. So `t` is the perpendicular distance and compares directly with `fb.depth`.
- Per call, for the first 16 instances (`stats.instancesCulled += rest`):
  1. Run `computeVoxelPose`.
  2. Build the world AABB from the 8 posed corners of every part box.
  3. Build the screen rect of the AABB's 8 projected corners (floor/ceil, +1, clamped). If any corner is at depth <= 0.05 m, use the full screen.
  4. Loop only over the rect's cells.
- Per cell:
  1. Slab-test against the world AABB, and skip the cell if `tEnter >= fb.depth[i]`.
  2. For each part, map the ray with `L_k` and slab-test it against the part box `[x0,x1)`.
  3. Run Amanatides-Woo from `max(tEnter, 0)`. The start voxel is `floor(p)`, clamped into the box. `tDelta = 1/|d|` (Infinity for 0 components). Take at most `MAX_VOX_STEPS` steps, fetching `vox[atlasOff + ...]` at each.
  4. The first non-zero voxel with `t > 1e-6` is the hit. A solid voxel that contains the eye is skipped, never drawn from inside.
  5. The entry face is on the axis last stepped (or the slab-entry axis for the first voxel). For example, stepping +x enters through the local W face (4).
  6. **Axis choice, verbatim in GLSL:** `if (tmx < tmy) { axis = tmx < tmz ? X : Z } else { axis = tmy < tmz ? Y : Z }`.
- The nearest hit wins: write only when `t < fb.depth[i]` (strict). Parts go in index order and instances in list order, so ties go to the earlier one. Write `fb.depth` first, then `gbuf.writeSample(i, KIND_MODEL, matIds[m], face, planeId, u, v, z, aoD)`.
- `u, v` are metres, part-local. A face on the x axis gives `(ly, lz)*cellM`, the y axis gives `(lx, lz)*cellM` and the z axis gives `(lx, ly)*cellM`. `z = oz + t*dz - inst.z` (world metres above the feet).
- **planeId** = `(0xF<<28) | (slot<<24) | (part<<21) | (localFace<<18) | (layer & 0x3FFFF)`. Here slot is the instance index 0..15 and layer is the integer local boundary coordinate of the hit face. The top nibble 0xF never collides with sectors, because structSeq is 3 bits (7.2). Coplanar faces of one part share an id, as walls do.
- **Packed normal (face 7):** octahedral and deterministic.
  1. `n /= |x|+|y|+|z|`.
  2. If `z < 0`: `(x, y) = ((1-|y|)*sgn(x), (1-|x|)*sgn(y))` with `sgn(0) = +1`.
  3. `q = min(65535, floor((c*0.5+0.5)*65535 + 0.5))`, then `bits = (qx | (qy << 16)) >>> 0`.
  4. On the GPU the bits go into `GA.w` as a uint. On the CPU they go into the bits of `gbuf.aoD[i]` through a `Uint32Array` alias of `gbuf.aoD.buffer`, made once per GBuffer identity (not per frame). The CPU shading passes must ignore `aoD` for kind 8; that is wired in US-041.
- `opts.faceMode = 'nearest'` is for US-040 before the light pass exists: face 7 becomes the nearest world axis face 1..6, with `aoD = Infinity`.

**Budgets:**
- `castModels` for one near quadruped (about 30 % of the screen) at 160x60: <= 0.3 ms p50 and <= 0.5 ms p95 (`tools/bench-voxel.mjs`).
- `computeVoxelPose`: <= 0.01 ms per instance.
- Allocation: 0 bytes per call after warm-up. Rule 9 applies: no `new`, literals, closures, `for..of`, destructuring or string work in the hot functions of `voxelMarch.js`/`octNormal.js`. Scratch space is module-level typed arrays.

**Not in US-039:**
- GLSL (US-040).
- US-041 items: the `renderWorld` wiring, `fillSky` vs model cells in open spans, shading/light for kind 8, AssetRegistry loading of `ModelDef.voxel`, and `stepAnimations` for voxel clips.

### 15.2 GPU voxel pass A3 `voxel` + gpucompare (US-040; architect, 2026-09-24; D-019)

Normative. Target feel (owner, D-019): Blood/Build-style solid items with fixed world orientation, lit and outlined like walls; fire/glow/smoke stay billboards. Where this differs from 15/15.1 (VOX texel format, no `MODELMAT`, no third sub-sample set, instance data in a texture) this section wins. The oracle is `castModels` (D-017: correctness only, no budget).

**1. Files and boundaries.**

| File | Owns | Node |
|---|---|---|
| `engine/render/voxelPool.js` | `VoxelPool`: the per-frame instance list (`VoxelInstance[]` for `castModels`), `bind(registry, table)` (packs every `ModelDef.voxel` with `packVoxelModel(def, table.idFor)`, builds the atlas), `project(cam, rt)` (poses, AABBs, screen rects, culling, `VOXINST` staging), `pushInstance(...)` (test/dev harness feed; US-041a adds `collect(world)`), `stats` | yes |
| `engine/render/gpu/VoxelTextures.js` | pure: `buildVoxelAtlas(packed[]) -> {vox: Uint16Array, w: 256, h, modelBase: Int32Array, version}`, `VOXINST_*` layout constants, `writeInstanceRows(pool, i, out)` | yes |
| `engine/render/gpu/glsl/voxel.frag.js` | pass A3 source (literal twin of `marchVoxelRay`/`castModels`) | source checks |
| `GpuCellPipeline.js` | `bindVoxels(pool)`, `VOX` R16UI + `VOXINST` RGBA32F textures, program `voxel`, `_passVoxel()`, `stats.voxelMs/voxelInstances`, the sub-set flip | no |

Dependency direction: `render/` and `render/gpu/` import `engine/voxel/*`; `engine/voxel/` still imports only `GBuffer.js`. `KIND_MODEL` and `FACE_PACKED` move to `GBuffer.js` (`VoxelModel.js` re-exports them). `engine/index.js` exports `VoxelPool`, `castModels`, `packVoxelModel`, `validateVoxelModel`, `buildVoxelAtlas` now (supersedes 15.1 "no exports until US-041": the harness needs them).

**2. Data flow: model -> textures.** `ModelDef.voxel` lives in the registry (`assets.model(key).voxel`). At shading bind (the MaterialTable exists) `VoxelPool.bind` packs every voxel model and `buildVoxelAtlas` writes **`VOX` R16UI, texel = MaterialTable id (0 = empty)**, linear index `i -> (i & 255, i >> 8)`, width 256, height `ceil(total / 256)` (assert `<= 256` rows; 16 models x 4096 = 128 KB max). `modelBase[m]` is added to every `atlasOff` of model m in the instance rows. This drops 15.1's `MODELMAT` indirection (one fetch per DDA step, no second lookup); `PackedVoxelModel.vox/matIds` stay as they are for the oracle, and a test asserts `atlas[i] == matIds[vox[i]]`. `VOX` is uploaded once per `atlas.version` (bind), never per frame.

Per frame, `VoxelPool.project(cam, rt)`: for each instance (list order; the 17th and later are culled and counted): `computeVoxelPose` -> world AABB of the posed part boxes -> screen rect (15.1 per-call steps 1-3; move that code into one helper `instanceRect(...)` that `castModels` and the pool both call, so culling can never differ between paths) -> cull when the rect is empty; any corner at depth `<= 0.05` -> full-screen rect. Visible instances get compact slots `0..count-1` and their rows in the `VOXINST` staging array. `castModels` then consumes the same projected list (`pool.list`), which keeps the oracle and the GPU on identical instances and slots (slot = planeId field).

**3. `VOXINST` layout** (RGBA32F, width 8, height `MAX_VOX_INSTANCES * 9 = 144`; per frame one `texSubImage2D` of `count * 9` rows, <= 18 KB; this supersedes 15's "<= 2 KB uniforms": 16 x 8 parts x 5 vec4 exceeds the guaranteed fragment uniform vectors).
- Row `9i` = instance header: T0 `(aabbMin.xyz, partCount)`, T1 `(aabbMax.xyz, slot)`, T2 `(feetZ, cellM, 0, 0)`, T3..T7 = 0.
- Row `9i + 1 + k` = part k: T0..T2 `(A[r][0], A[r][1], A[r][2], oL[r])` for r = 0..2, where `oL = A * eye + b` is the **part-local eye computed in float64 in JS** (the GPU never adds `b` to a 1000 m world origin; the local ray is `oL + t * (A * d)`, t unchanged); T3 `(x0, y0, z0, atlasOff + modelBase)`, T4 `(bx, by, bz, flags)` with `flags = axisAligned | k << 1`; T5..T7 reserved (0).
- Uniforms: `uVoxCount` (int), `uVoxRect[16]` (vec4 `rx0, ry0, rx1, ry1` in cells, half-open). A fragment outside every rect performs no texture fetch.

**4. Pass A3 `voxel`** (viewport `cols*n x rows*n`). Input = the sub-sample set written last (set 2 when A2 ran this frame, else set 1); output = the other set; resolve reads the set written last. The pipeline keeps `_subSetCur` (0/1); A2 and A3 each flip it; when `count == 0` A3 is skipped entirely (no draw, no flip). Reason for the deviation from 15 ("set 3"): set 1 is dead once A2 has read it, so a third set buys nothing and costs 4.3 MB. Never fold A3 into the cast or terrain programs.
```
S = fetch(set_in at gl_FragCoord)                    // the copy; best = uintBitsToFloat(S.depth)
cell = floor(gl_FragCoord.xy / n); o = eye; d = the sub-ray of dda.frag (14.2 item 3 offsets; unnormalised, t = perp distance)
for i in 0..MAX_VOX_INSTANCES: if (i >= uVoxCount) break; if (cell outside uVoxRect[i]) continue;
  H = header(i); slab(o, d, aabb) -> tIn, tOut; if (miss || tIn >= best) continue;
  for k in 0..MAX_VOX_PARTS: if (k >= partCount) break;
    oL = (T0.w, T1.w, T2.w); dL = A * d; slab vs [x0, x0+bx) x ...; if (miss || tInK >= best) continue;
    Amanatides-Woo from max(tInK, 0): start voxel floor(p) clamped into the box; tDelta = 1/|dL| (dL == 0 -> 1e30, never Infinity in GLSL);
    <= MAX_VOX_STEPS (48) steps, one VOX fetch each; axis rule verbatim: if (tmx < tmy) axis = tmx < tmz ? X : Z else axis = tmy < tmz ? Y : Z;
    first non-zero texel with t > 1e-6 && t < best -> hit (t, mat, entry axis + sign, local voxel, k, i)   // strict <: ties -> earlier part/instance, as castModels
hit -> kind 8, mat, face (US-040: nearest world axis of n_world = cellM * A^T * n_local, i.e. 15.1 faceMode 'nearest'; exact for axis-aligned parts),
       planeId per 15.1, u/v per 15.1 (metres, part-local), z = o.z + t*d.z - feetZ, aoD bits = 0x7f800000u (+Inf), depth = t
no hit -> write S unchanged
```
Numeric rules 14.1 item 5 apply (no `round`, uint hashes, constant loop bounds). The JS oracle stays float64 with `Infinity`; the two agree because the box extent `<= 48` bounds every `tDelta` use.

**5. Downstream passes: kind 8 pass-through (same rule in JS and GLSL, parity by construction).**
- `resolve`, `deriv`: unchanged (group key `(kind, planeId, mat)`; coplanar faces of one part share a planeId, so derivatives are consistent inside a face).
- `light`: unchanged in US-040 (face 1..6). US-041a adds face 7 (15.3).
- `shade`: `shadeCore/shadeTail` exactly as for walls with the model's material; for kind 8 force `fk = 1` for **every** face (JS `table.faceK[face]` and GLSL `uFaceK`; 15 risk item: no pop when a part starts rotating) and `aoD = +Inf` before `shadeCore` (US-041a puts normal bits into that slot).
- `edge`: kind 8 joins the rule table. `isVert(kind, face)` = the old rule, or `kind == 8 && face in {N, E, S, W, 7}`; `isUp(kind, face)` = the old rule, or `kind == 8 && face == U`; face D is neither. CAP/LIP/SIDE and the same-kind planeId rule then outline the silhouette and the voxel steps; rules 6/7/8 may fire (they need a floor/ceil neighbour and give the foot seam). Walls are unchanged (face is only consulted for kind 8); the existing `?gpucompare` poses prove it.
- **Model rim (the dark outline of ART-OWN-001, optional, data-driven):** `detailPass.edges.modelRim` (number, default 1 = off; designer picks about 0.55). For kind-8 cells with `rule != 0`, multiply fg **and** bg by `modelRim` after the rule glyph/gain. One uniform `uModelRim`, one line in `edgePass.js` and `edge.frag.js`, no texture and no per-model data (per-model control would need a `GI` bit; only if the designer proves the need).
- Sprite pass F / `drawSprites`: unchanged. Their depth test against `DEPTH` now includes model cells, so a flame billboard anchored at a burner's rim is cut by the near rim and shows over the far rim (the Build-engine look); `mask` cells still win.
- CPU oracle order in `renderWorld`: `castSectors -> castTerrain -> castModels -> deriv -> light -> shade -> edge -> fillSky`. `fillSky` must never paint a cell with finite depth (`castModels` writes cells inside open spans); the programmer adds the test and, if `fillSky` does not skip finite-depth cells today, the one-line guard.

**6. Budgets and timing.** `stats.voxelMs` = a CPU submit-time bracket like `terrainMs` (US-016 finding: no nested GPU queries on ANGLE). Gate (D-019 item 7): A3 `<= 0.5 ms p95` at 240x90, n = 2, with the lever and the burner at about 2 m (about 15 % of the screen), whole pipeline `<= 4 ms p95`; `?bench=1` prints `voxel: p50/p95 inst n`. JS: `VoxelPool.project` `<= 0.1 ms` for 16 instances (pose 0.01 each + rect + rows), upload `<= 18 KB`. Zero allocation in `project`, the hook and the oracle after warm-up (the bench-cast method).

**7. gpucompare and flicker.** `?gpucompare=1` (160x60, n = 1). US-040 has no entity binding, so the page feeds `pool.pushInstance(model, x, y, z, yawDeg, clip, frame, tMs)` with the designer's `lever`/`burner` voxel ModelDefs when they are in the registry, else `engine/voxel/fixtures/quadruped12.js` plus a new fixture `engine/voxel/fixtures/post12.js` (a 6x6x12 two-part post with a back plate: lever-like proportions). Poses in `game/js/main.js` on `world_m1`: `voxel lever wall 2 m` (instance at the lever's position, yaw 90, cam = the existing lever pose), `voxel burner near` (burner position, cam = crash room), `voxel half occluded` (an instance half behind the stair edge: the depth tie against sector cells), `voxel yaw 45` (the affine path; faces = nearest axis), `voxel over terrain` (an instance on the outer ring in front of kind 7: the A2 -> A3 chain). Thresholds = 14.2 item 8 on kind-8 cells (kind `>= 99.5 %` excluding 4-neighbour-kind edge cells; mat/planeId equal, depth within 1 %, u/v within `1e-3 * depth`; glyph `>= 99 %`, fg/bg +-4); `compareGeometry` prints kind-8 counts (`k8 cpu/gpu`). `?flicker=1` adds the two prop poses; the model's changed-glyph share must not exceed the walls' share of the same pose.

**8. Tests (Node).** `VoxelTextures.test.js`: atlas layout (`modelBase`, index mapping, `atlas[i] == matIds[vox[i]]`), row limit assert, `writeInstanceRows` values equal `computeVoxelPose` output and the rect equals `castModels`'s rect, culling count, zero alloc. `glsl.test.js`: `voxel.frag` contains `MAX_VOX_STEPS`, the verbatim axis rule, `0x7f800000u`, no `Infinity`/`round(`. `compositor.test.js` (or an `edgePass.test.js`): a kind-8 face-E cell with sky to its left gets RULE_SIDE, face U with sky above gets CAP, `modelRim` multiplies fg and bg only on `rule != 0` model cells, wall cells unchanged. `voxel.test.js`: the `faceMode: 'nearest'` case owed since US-039 review item 3; `castModels` after `castTerrain` inside an open span keeps finite depth through `fillSky`. `node tools/check-deps.mjs` clean.

**9. Build order (programmer).** (1) Constants move, exports, `VoxelPool` + `instanceRect` refactor of `castModels`, Node tests. (2) `VoxelTextures` atlas + instance rows + tests. (3) `voxel.frag` + `_passVoxel` + set flip + timer; run `?gpucompare=1` with fixtures and get **kind/depth parity first**, glyphs second. (4) Kind-8 rules in shade/edge (JS + GLSL) + `modelRim`. (5) Poses, flicker, bench line, docs. Steps 1-2 and 4's JS half need no browser.

**10. Do not.** Read entities in US-040 (binding is US-041a); allocate in `project` or the hook; upload `VOX` per frame; add `MODELMAT`; add a third sub-sample set; march an instance whose rect excludes the cell; write `Infinity` or `round()` in GLSL; give kind 8 per-cell planeIds; bake light or colour into voxels; put model names, tower positions or prop sizes in engine code; let the pass read the set it writes.

### 15.3 Voxel props: lighting with rotated normals, entity binding, rigid-part animation (US-041a; architect, 2026-09-24; D-019)

US-041b (creature clips, bear, `design/preview/voxel.html`) builds on this without new engine rules.

**1. Entity binding = a component, not a new type.** `components.voxel = { model, anim, t, frame, loop, speed, playing }`: the same fields and semantics as `sprite` (10.1), so `EntityHandle.play/stop/onAnimEnd` and `stepAnimations` operate on "the anim component" `components.sprite ?? components.voxel` (one helper `animComponent(e)`; spawn rejects an entity with both). Entity `type` is unchanged (`'prop'` from `def.props`): D-019's `type: 'voxelModel'` is satisfied by the component, and ids, `interactables.prop` links and saves do not change. Spawn rule (7.5 item 1): `registry.model(key).voxel` present -> `comps.voxel`, else `comps.sprite`, so swapping a prop from billboard to voxel is a `design/models/*.js` change with no level edit. Voxel clips (`PackedVoxelModel.clips`: `durMs`, `loop`, `tagCodes`) feed `stepAnimations` through the same runtime side table as sprite clips (anim name -> clip re-resolved only when the `anim`/`model` string changes). Transform: `x, y, z` = feet, `yawDeg` = `facing` in free degrees: **the engine never snaps yaw**; `axisAligned` is detected per pose (15.1) and only decides face 1..6 vs face 7. Content rule: wall props use multiples of 90 (their faces are then exactly the wall's faces and get the same `faceK`), ground clutter may use any yaw. `pitchDeg` is ignored; the boulder keeps `yawDeg` = heading from the roller and shows no roll (D-019 item 5). `VoxelPool.collect(world)` = entities with `components.voxel`, cached by `renderVersion` like `SpritePool`; the pool holds nothing that is not derivable from the component; save = the component; restart = `deserialize` + re-collect. More than 16 candidates: the nearest 16 by AABB distance win (preallocated index sort; warn once).

**2. Rotated normals and light.** Non-axis-aligned parts write `face 7` + the octahedral bits (15.1) on both paths: GPU `GA.w = bits` as a raw uint (never `floatBitsToUint`), CPU the `Uint32Array` alias. `light.frag` / `lightSurfaces`: `N = (kind == 8 && face == 7) ? unpackOct(GA.w) : faceNormal(face)`; the GLSL unpack is the literal twin of `unpackNormalOct` (parity `|dL| <= 1e-3`, normal 1/32768 per component). `shade`: kind 8 -> `aoD = +Inf` and `fk = 1` (already from US-040). `edge`: face 7 counts as vert (15.2 item 5). Sun/vis sampling: `P = cellRayP(cell, depth)`, `S = P + N * 0.01`, as for walls. Models neither cast shadows nor self-shadow in M1 (the sun DDA walks the sector grid only); recorded as out of scope.

**3. Rigid-part animation for props.** Nothing new in the sampler: `computeVoxelPose` interpolates keyframes from `{clip, frame, tMs}` (15.1) and `stepAnimations` advances `frame/t` at 60 Hz, so the swing is smooth and deterministic. Lever model contract (designer): parts `plate` (root: back plate + post, static) and `handle` (child of `plate`, pivot at the hinge, box = arm + knob); clips `idle = { durations: [1000], loop: true, frames: [{}] }` (a 1-frame loop, since `fps: 0` is not valid for voxel clips) and `pull = { durations: [90, 90, 90, 240], loop: false, frames: [{ handle: { rot: [0,0,0] } }, { handle: { rot: [-35,0,0] } }, { handle: { rot: [-70,0,0] } }, { handle: { rot: [-85,0,0] } }] }` (angles are the designer's; the sign follows 15.1's rotation convention). A finished non-loop clip holds its last frame (`playing = false`, `frame = n-1`, `t = 0`), so the pulled lever survives save/load through the component alone. `lever.pull` in `game/js/quest/lever.js` stays `play('pull')` (the anim component makes it work unchanged); the grate is still driven by `animateSectorTo`. Burner/relay/lamp/heaps need no clips in M1 (static voxel bodies; flames and glows are billboards). Budget: pose `<= 0.01 ms` per instance; `stepAnimations` budget unchanged.

**4. Mounts.** `ModelDef.voxel.mounts?: { [name]: { at: [x, y, z] /* voxel units, rest frame */, part?: string } }`, validated (name pattern, `at` finite inside `size`, `part` exists). `voxelMountWorld(pm, inst, name, out: Float64Array(3))` = `W * M_part * at` (follows the part's pose); it computes the pose for `inst` itself (own module scratch) and never relies on which instance `computeVoxelPose` ran last - a consumer may call it at any point in the frame (architect review 1, 2026-09-25). Returns `null` for an unknown mount name; `partIdx` is resolved once at pack time. Consumers: US-042 talk prompt anchor, US-022 relay glow. In M1 the flame/glow billboards stay **separate prop entities** in level data (their own `props` entries at the rim, level coordinates) and point lights stay `def.lights` (7.5 item 5): no attach system now.

**5. Parity, tests, poses.** `?gpucompare=1` real-prop poses (`real: true`): `lever idle` (the existing lever camera), `lever mid-pull` (the existing `before` hook now sets `components.voxel.frame = 2, t = 45`: a rotated handle, face 7 + light parity), `crash room` (voxel burner body with the flame billboard cut by the near rim), `boulder mid-roll` (free yaw). Node: `world.test.js` - a prop whose model has `voxel` spawns with `components.voxel` and no `sprite`, serialize round trip keeps `anim/frame/t`, both components on one entity throws; the `lever.pull` quest test asserts `voxel.anim === 'pull'`; `animation.test.js` - `stepAnimations` on a `voxel` component with durations `[90, 90, 90, 240]`, non-loop holds at frame 3, `animEnd` once; `voxel.test.js` - `voxelMountWorld` on a rotated part, `collect` keeps the nearest 16, zero alloc; `lighting.test.js` - `lightSurfaces` decodes face-7 bits (a 45-degree normal gives the expected N.L). Browser: the poses pass, `?flicker=1` model share `<=` walls, `?bench=1` within 15.2 item 6, then the owner walk-check (D-019 item 6).

**6. Content contract (designer, voxel props).** Colour is per material: every `mats` value is a MaterialTable key with a v2 record (`palette.materials` + `detail-pass.js` `materials`/`remap`; a missing v2 record sets `!table.allV2` and disables the GPU path). "Bright rim, dark body" (ART-OWN-001) = separate materials on the top/edge voxels versus the body (e.g. `brass_light`, `brass_dark`, `wood_dark`, `canvas_light`), each with its own albedo/tones/detail; there is no per-voxel colour. Outline: the edge pass (automatic) + `edges.modelRim`. Sizes: lever `>= 0.7 m` wide x `1.1 m` at `cellM` 0.05-0.125 (validator: `<= 32` per axis, part box extent sum `<= 48`); one part per moving piece; boxes may overlap (first part wins). Flames, glows, sparks, smoke: separate billboard props with their own model keys. Until US-040 renders in the browser, previews run through `castModels` (US-041b's `voxel.html` is the orbit page; an ASCII dump from `tools/bench-voxel.mjs --model <key>` is the interim, optional).

**7. Do not.** Snap or quantise yaw in the engine; store poses/matrices in the entity; keep clip state in the pool that the component cannot rebuild; attach billboards to mounts in M1; cast model shadows; add per-voxel colours; touch `shadeCore/shadeTail`; read `window.ASSETS` or prop names in `engine/`.

## Refactor candidates (2026-09-24)
Architect survey for D-006/D-010 reuse; ordered by value for cost. Candidate stories only, the PO schedules them.

1. **Engine-owned frame renderer (`createWorldRenderer`)** - *why:* the per-frame orchestration (fb assembly: GBuffer/MaterialTable/light buffer/`gpuDda`; `syncEntityLights` + `lights.update`; `renderWorld` vs `gpuPipeline.frame` choice incl. the `rt.gpuActive` context-loss rule; sprites; `present`) lives in `game/js/main.js` `runGame`/setup (~150 lines). The M1.5 editor (D-010) would have to copy it, including the subtle ordering rules. Target: `renderer.frame(world, camPose, timeSec)` + `renderer.stats`, overlay/crosshair stay caller-side. *Files:* new `engine/render/WorldRenderer.js`, `engine/index.js`, `game/js/main.js`. *Size:* M. *Risk:* medium (render ordering, context restore; covered by `?gpucompare=1` + Node tests). *Wait:* none; **must land before the M1.5 editor stories**.
2. **Split `game/js/main.js` (973 lines) into bootstrap + dev modes** - *why:* bench, shadetest, `gpucompare=1|shade`, flicker, glyphs, demo harnesses (~500 lines) are mixed with the game bootstrap; main.js also imports `tools/bench-poses.js` (game -> tools direction). Target: `game/js/dev/modes/*.js` with a `{ name, run(ctx) }` table, main.js ~250 lines; move the pose list to a shared data file both `tools/` and `game/` may read (or have check-deps allow it explicitly). *Files:* `game/js/main.js`, `game/js/dev/*`, `tools/bench-poses.js`, `tools/check-deps.mjs`. *Size:* S-M. *Risk:* low (URL-flag smoke test per mode). *Wait:* do after item 1 (it shrinks `runGame` first).
3. **Two-tier public API: `engine/index.js` (stable) + `engine/dev.js` (harness/internals)** - *why:* index.js mixes the editor-facing API with pass internals and parity tooling (`beginFrame/castSectors/fillSky/computeDerivatives/shadeSurfaces/edgePass`, `runShadeTest`, `runGpuCompare/compareCells/poison*`, `Input/PlayerLook` "may change"). A second client (editor, other games) can't tell what is stable. *Files:* `engine/index.js`, new `engine/dev.js`, `tools/check-deps.mjs` (+ fixture test), section 5 of this doc. *Size:* S. *Risk:* low. *Wait:* none; best done together with item 1 (which removes most pass internals from main.js's import list).
4. **D-017 pruning of fallback-only code** - *why:* JS is now oracle only. Candidates: `cpuLightCap` + `selectCpuLights` (lighting.js), the legacy inline-shade path (`?detail=0`, `fastShade.js` 354 lines, a speed-only duplicate of the reference shading; keep `buildPowLUT` or move it), `cpuGrid` forcing, and later the frozen Canvas2D presenter (`RenderTargetCanvas2D.js`, `force2d` through `engine.js`/`RenderTarget.js`). Fewer paths = smaller API for the editor and one shading reference to keep in parity. *Files:* `engine/render/{lighting,fastShade,sectorCaster,MaterialTable,RenderTarget,RenderTargetCanvas2D}.js`, `engine/core/engine.js`, `tools/bench-cast.mjs`, affected tests. *Size:* M. *Risk:* medium (oracle must stay bit-identical under `?gpucompare=1`; bench numbers change meaning). *Wait:* PO must first strip the CPU perf ACs per D-017 consequences; Canvas2D removal is a separate later step (D-017 item 4).
5. **Shared JS helpers and test kit** - *why:* `clamp/clamp01/clampByte/approach` duplicated in Player, integrate, detailShade, fastShade, sectorCaster, World; `ok/approxEqual/assert` re-declared in ~22 test files. Target: `engine/core/math.js` (internal, not exported) + `engine/test/assert.js`. GLSL already shares `glsl/common.js`; no action there. *Size:* S. *Risk:* very low. *Wait:* none; good filler story, do after item 4 so deleted files are not touched.

## Physics epic estimate (2026-09-24)
Architect estimate for US-051..055 (backlog "Physics + effects epic"); the manager decides (new D-entry). US-053 particles and the US-055 water rendering are independent of the choice (GPU sprite pass / new water kind + JS reference); the choice affects US-051, US-052, US-054 and US-055 buoyancy.

| Criterion | (A) extend `engine/physics` | (B) Rapier `rapier3d-compat` (WASM) | (C) cannon-es (pure JS) |
|---|---|---|---|
| World queries (D-007) | native: per-sphere `sectorAt/outsideSector` + `terrain.heightAt`, as `moveCapsule/moveSphere` today; grates/animated sectors work for free | fails: static colliders must mirror the sector grid (cuboids/trimesh), terrain chunks (heightfields) and live grate relief; a second world copy to keep in sync | same mirroring problem as B |
| Shapes / D-016 | bodies as compound spheres/capsules (1-8 per box/cylinder/log), pose = pos + quaternion -> voxel rigid-part transform or billboard yaw | exact box/cylinder/convex | box/cylinder/convex |
| Determinism + §10 save | deterministic by construction (fixed order, fixed iterations, no warm-start), state = pose/vel/angVel/sleep as JSON | deterministic per build, but snapshot is binary; JSON pose-only restore loses warm-start -> diverges mid-motion (the US-013 finding) | same-engine deterministic; no warm-start so pose restore is OK; broadphase order must be pinned |
| Electron + browser (D-012) | yes | yes (async init, CSP `wasm-unsafe-eval`) | yes |
| Bundle | ~+800 lines | ~1.5-2 MB vendored | ~150 KB min, unmaintained since 2022 |
| Perf (30 active, US-018 JS budget) | ~0.3-0.6 ms/step est., 0 alloc (rule 9) | ~0.1-0.3 ms + collider sync cost | ~0.5-1.5 ms, allocates per step (GC churn, breaks rule 9) |
| JS/GPU oracle rules | unaffected (physics is sim, not render) | unaffected for render; breaks D-015 "JS stays oracle + fallback" for physics | unaffected |
| Player capsule both ways, log bridge | reuses `resolveBodyContacts` pattern; sleeping log = walkable oriented capsule for `moveCapsule` | custom glue: player stays in-house, kinematic proxy in Rapier, two-way contacts written by hand | same glue as B |
| Effort (S=1, M=2, L=3 units) | US-051 = 2xL (051a body + world contacts + sleep; 051b body-body, stacking <= 3, player contacts); 052 M; 054 M; 055 buoyancy S. **~11** | integration + collider mirroring L, grate/terrain sync M, save/restart M, loader/async M, then 052/054/055 same. **~13-14** | as B minus loader, plus allocation fixes M. **~13** |
| Risk | stacking quality (crate towers, jitter) - mitigated by sleep, stack limit 3, AC is "settle in 3 s, <= 2 cm" not "physics sandbox" | dual-world sync bugs, save divergence, 2 MB dependency for a handful of bodies | dead dependency, GC hitches, same sync bugs |

**Recommendation: (A)**, compound-sphere rigid bodies (quaternion, diagonal inertia, sequential impulses with fixed 8 iterations, Baumgarte positional correction, sleep islands) in `engine/physics/rigid.js`, world contacts only via `World`. The US-013 roller stays as is (documented reason: tilt field + tested behaviour). **Exit criterion:** if after US-051a the 10-body drop test misses "settle in 3 s / <= 2 cm / no jitter" after one fix round, escalate a Rapier spike (B) as its own engine story; A's contact API is kept so B could slot in behind it. Order: US-053 can start in parallel (no dependency on the choice).

## 16. US-018 perf budget + F3 overlay (architect, 2026-09-25)

**Exists vs missing (per AC).**
| AC item | Exists | Missing |
|---|---|---|
| Toggle | F3 (`main.js` `input.pressed('F3')`) and `?debug=1` both call `overlay.toggle()` | nothing |
| fps, frame ms | `loop.fps`, `loop.frameMs` (smoothed JS time of the whole tick) | frame **interval** (rAF delta) and worst interval |
| JS ms | only `grid draw` (render JS) and pipeline `uploadMs`/`drawMs` | split: `simMs`, `renderMs` (game build: cam, lights, sprites, UI cells), `submitMs` (= pipeline upload + draw) |
| GPU ms | whole-frame `GpuTimer` (`stats.gpuMsP50/P95`), sprites pass own `GpuTimer`; `n/a` fallback exists | per-pass GPU ms |
| Per-pass | terrain/voxel only as CPU submit brackets (`terrainSubmitMs`, `voxelMs`) | real per-pass GPU split (below) |
| path/grid/pos/sector | printed | `grounded` flag (`playerHandle.data.body.grounded` or wherever `integrate.js` keeps it) |
| Grid | `clampGrid` 160x60..320x120 (8:3), default 240 on gl2, `cpuGrid` 160x60 forced on fallback, `?grid=` parse + warn | Node test; stale JSDoc in `engine/core/engine.js` `createEngine` ("320, the gl2 default" -> 240) |
| `?bench=1` | **taken** by the US-001 canvas present bench (`runBenchmark`, obsolete per D-017) | the 3-view + walk bench |
| GC check | `bench-cast.mjs --gc` (Node, CPU path) | in-browser frame > 25 ms counter; overlay `extra` string is built **every frame even when hidden** (main.js ~746) - fix |

**Per-pass GPU timing (key fact).** Only *nested* `TIME_ELAPSED_EXT` queries fail; **sequential, non-overlapping** spans are legal. So when pass timing is on, drop the whole-frame span and wrap each pass in its own query; `gpuMs = sum`. Pass slots (fixed order, `PASS_NAMES` exported frozen array):
`cast` (A1 sector DDA) | `terrain` (A2, far/horizon) | `voxel` (A3) | `resolve` (resolve + deriv) | `light` | `shade` | `edge` (edge/debug) | `sprites` (existing sprites-pass timer, reported alongside).
AC wording -> slots: walls/floors = cast + voxel + resolve; far view = terrain; lighting = light; shade/edge shown separately; sprites = sprites; UI = CPU only (its GPU cost is inside shade). Sky has no pass of its own (resolve).

**Where code goes.** Engine (generic, exported via `engine/index.js` only):
- `engine/core/loop.js`: `loop.stats` preallocated `{ simMs, renderMs, jsMs, intervalMs, worstIntervalMs, over25, frames }` + `loop.resetStats()`. `over25` counts rAF intervals > 25 ms (skip the first 2 frames after `start()`/`resetStats()` and while `document.hidden`).
- `engine/render/gpu/GpuTimer.js`: `GpuPassTimer(gl, slotCount)` - per slot a ring of 4 queries, `begin(slot)`/`end()`, `writeStats(outP50: Float32Array, outP95: Float32Array)`, same disjoint/availability/`STATS_EVERY` rules as `GpuTimer`.
- `GpuCellPipeline`: `setPassTiming(on)`; `stats.passMsP50/passMsP95` (`Float32Array(PASS_COUNT)`, NaN when off/unavailable). Off = today's single span, unchanged. Also fix the per-frame `subarray` in `_pollTerrainTs`/`_pollVoxelTs` (sort into a preallocated scratch only every `STATS_EVERY` frames).
- `engine/ui/debugOverlay.js`: `shouldRefresh(nowMs)` (true at most every 250 ms, and only when `visible`), `setText(str)`.
Game (`game/js/main.js`, `game/js/dev/perfBench.js`): what to print (position, sector, grounded, pass list), `pipeline.setPassTiming(overlay.visible || benchActive)`, the bench mode and its poses. No engine->game imports; poses stay in game/tools.

**Allocation rule for the overlay.** Hidden: zero strings, zero work beyond `loop.stats` bookkeeping. Visible: text built only inside `if (overlay.shouldRefresh(now))` (~4 Hz); string allocation at 4 Hz is accepted. Cost <= 0.1 ms/frame amortised. No `toFixed` or template strings on the hidden path.

**`?bench=1` (US-018).** Rename the US-001 bench to `?bench=present` (keep it, cheap). New `?bench=1` in `game/js/dev/perfBench.js`, world mode, pass timing on, grid from `?grid=` (owner runs it twice: default 240x90 and `&grid=320x120`):
1. **3 fixed views** (teleport player, input ignored, sim keeps running): (a) ground floor facing brazier + sun shaft, (b) mid ledge looking down, (c) summit looking out the breach (reuse `world_m1: breach` from the gpucompare table; designer/PO supply (a)/(b) coordinates if no existing pose fits). Per view: 60 warm-up frames, 300 measured, in the normal rAF loop.
2. **60 s walk:** after the views, overlay says "walk now"; recording starts at the first movement input and runs 60 s.
3. Record into preallocated `Float32Array`s (no push). Report per view and for the walk: avg fps (from intervals), JS avg/p95/max, GPU total p50/p95 + per-pass p50, worst interval, `over25`. Pass/fail lines vs the AC (>= 58 fps, JS <= 2 ms target / <= 8 ms max, GPU <= 4 ms, `over25 == 0` on the walk). Output to overlay (copy button) + `window.__bench` + console.

**Steps (one programmer, Node test per step, one browser pass at the end).**
1. Loop stats + `loop.test.js` (fake rAF/clock: interval, worst, over25, hidden skip).
2. `GpuPassTimer` + pipeline `setPassTiming` + subarray fix; Node test with a fake gl (query objects, availability, disjoint drop, sum = total).
3. Overlay throttle + main.js lines (JS split, GPU per pass, grounded, `n/a`); extra built only when refreshing.
4. `grid.test.js` (clamp 100 -> 160x60, 400 -> 320x120, default 240x90, rows derived) + JSDoc fix.
5. `perfBench.js` + `?bench=present` rename.
6. Owner runs `?bench=1` and `?bench=1&grid=320x120` on real hardware; numbers go into the US-018 story.

**Do not:** nest timer queries; leave pass timing on when the overlay is hidden and no bench runs (8 queries/frame for nothing); add per-pass `performance.now()` inside the GPU pipeline beyond what exists; put pose data or the bench in `engine/`.

**Worst-frame profiler (spike hunt, 2026-09-25).** `engine/core/FrameProfiler.js`: `new FrameProfiler(names)`, `add(i, ms)`, `beginFrame()`/`endFrame(simMs, renderMs, steps)` (called by `Loop` when `loop.profiler` is set), `reset()`, `format()` (report time only). Keeps the worst frame's sim/render split, step count and per-section ms since the last reset; `unattributed` = GC/JIT/driver. Allocation-free per frame. Game wires it only for `?bench=1` (null otherwise). Rule: amortised render-data work (far bake) is budgeted per rendered frame, never per fixed step (a catch-up frame multiplies it).

## 17. OWN-REQ-003 UI layer: UI size independent of the scene grid (architect, 2026-09-25)

**Choice: option (a), a second glyph layer at a fixed UI grid**, as the designer already specified (`uiStyle.uiGrid` 160x60 + `uiStyle.uiScale` in `design/models/title.js`). Rejected: (b) integer art scaling (1.5 at 240x90 is not an integer; blocky glyphs), (c) DOM text (breaks the ASCII look and GPU/CPU parity). Not expensive to reverse (engine-internal, no data format change): no manager decision needed. **Art: no redraw** - title, map card, hints, end text are already authored in 160x60 UI cells.

**1. `engine/ui/uiLayer.js` (new, exported via `engine/index.js`).**
```js
/** @typedef {{cols:number, rows:number, cells:CellBuffer, sx:number, sy:number}} UiLayer  sx = scene.cols/cols, sy = scene.rows/rows */
createUiLayer(uiGrid /* {cols, rows} */): UiLayer   // CellBuffer at uiGrid; cols clamped to [96, 320], rows = round(cols*GRID_ASPECT) (same 8:3 as the scene, so UI cells are square-scaled scene cells)
ui.setCell(x, y, glyph, fg, bg) / ui.setCellRGB(...)  // same signatures as RenderTarget -> drawPanel/drawRichLine/drawText work unchanged (duck-typed `rt`)
ui.clear()                                            // per frame: mask = 0 (transparent). A written cell = mask 1 = opaque glyph + bg
ui.bindScene(sceneCols, sceneRows)                    // sets sx/sy; called by engine on create and on grid:changed
```
`engine.ui` is created in `createEngine` from `opts.uiGrid` (main.js passes `assets.uiStyle.uiGrid`; engine never reads ASSETS), default 160x60. `engine.setGrid` re-binds it and calls `rt.setUiLayer(engine.ui)` on the new target. US-038 can later offer a "UI size" setting = a different `uiGrid.cols`.

**2. Present, GPU (`RenderTargetGL`).** `setUiLayer(ui)`; `present()` after the scene draw: upload `ui.cells.fg` and `bg` with `bg.a = mask ? 255 : 0` (packed in the same 9600-cell loop, or `setCell*` on the layer writes it and `clear` zeroes it) into two `uiCols x uiRows` RGBA8 textures, then a second fullscreen triangle with the same program, `uGrid = (uiCols, uiRows)`, a second **UI atlas** rasterized at `fontPx * sy` (rebuilt in `resize()`, like the scene atlas), and `uLayer = 1` -> `discard` when `bg.a == 0`. No blending (fades stay ramp-step per 7.4). Cost: 2x38 KB upload + one draw, < 0.05 ms GPU, < 0.05 ms JS.

**3. Present, CPU (`RenderTargetCanvas2D`).** If `ui.cols == rt.cols` (always today: `cpuGrid` 160x60 == uiGrid) copy mask cells of the UI layer into the scene CellBuffer just before drawing (= today's picture, byte-identical). Otherwise draw the mask cells with the glyph cache at the UI cell size (<= ~1500 UI cells, rare path). This is the `uiScale.mode 'cells'` fallback in one place.

**4. What moves to the layer (game side):** title card, hints text, `[E]` prompt, crosshair (UI centre 80,30 per `uiScale.crosshair`), map card panel, end card, pause overlay. **Stays in the scene grid:** eyelid/blink (`uiScale.blink`), scene fade/dim, F3 debug overlay (dev tool). Layout: UI code draws in UI cells directly; the 7.6 item 4 centre-scaling becomes identity (`panel.layout(ui.cols, ui.rows, ...)`).

**5. Plates / dim.** Dim rects stay scene-cell rects (sceneDim unchanged). `panel.pushDim(dim, ui)` and `pushHintDim(ui, ...)` convert per `uiScale.plate`: `x0 = floor(ux0*sx)`, `x1 = ceil(ux1*sx)`, same for rows.

**6. Parity / tests.** The UI layer is written by the same JS on both paths, so `?gpucompare=1` stays a scene comparison (now without UI mask cells in it; the "card open" pose checks the dim rect only). Node: `engine/ui/uiLayer.test.js` (clamp, sx/sy at 160/240/320, clear -> mask 0, setCellRGB -> mask 1, plate rect rounding at 240x90 incl. odd UI coords), `panel.test.js` pushDim with a ui, zero allocation in clear/draw. Browser (main session): screenshots at `?grid=160x60/240x90/320x120` show the title/map card at the same pixel size; `?gpu=0` identical to before.

**Files:** new `engine/ui/uiLayer.js` (+test); `engine/render/RenderTargetGL.js`, `RenderTargetCanvas2D.js`, `engine/core/engine.js`, `engine/index.js`, `engine/ui/panel.js`, `engine/ui/crosshair.js` (draws into whatever target it is given); game: `main.js`, `game/js/ui/titleCard.js`, `endCard.js`, `pauseOverlay.js`, `game/js/quest/hints.js`, `mapCard.js`. Size: M (~1 programmer day), ARCH review (render).

**Do not:** use alpha blending or CSS/DOM text for UI; scale UI art by duplicating glyphs; let the UI layer write into the scene mask texture; read `ASSETS` in `uiLayer.js`; allocate in `clear`/`present`.

## 18. Floor surface under a position (P1 for US-020c; architect, 2026-09-25)

**Existing public API, no engine change.** `World` (exported from `engine/index.js`) already answers it. The game calls methods on the world object it already holds, so `game/js/audio/*` needs no engine import:
```js
// on a footstep event only (grounded), never per frame
const sec = world.sectorAt(x, y) || world.outsideSector(x, y);  // structure sector, else terrain/void scratch
const mat = sec.floorMat;   // material key string, e.g. 'floor', 'rubble', 'grass', 'moss_top'
```
Rules: read `floorMat` immediately (the `outsideSector` result is a reused scratch object; the `sectorAt` result is the shared legend entry, read-only). On a solid cell's top, `floorMat` is its top face, which is correct. Cost: bbox loop over structures + one grid lookup, zero allocation. Not covered: standing on voxel props (falls back to the sector under them; fine for M1). The material -> timbre map is game data (`game/js/audio/surfaces.js`, unknown key = stone). Tests use a fake `{ sectorAt, outsideSector }`. If surfaces later need to be content-driven, add an optional `surface` field to material defs (designer), not a new engine query.

## 19. OWN-REQ-004 content data files: proposal for D-023 (architect, 2026-09-25)

**Today.** `design/*.js` classic scripts fill `window.ASSETS`; `main.js` reads them once (`AssetRegistry.fromGlobals`); the engine gets plain objects. Saves (`serialize`, section 10) hold changed state only and reference content by key. Two facts shape the choice: (1) part of the content is **code**: `palette.util.validate`, `detailPass.util`, terrain recipe `util.{heightAt,typeAt,generate,bakeChunk}`, generator code in `voxel_tower.js`, `wreckage.js`, `relay.js`. Pure JSON cannot hold that. (2) An open world cannot be one script tag per chunk; it needs fetch-on-demand.

**Options.**
- **A. All JSON now.** Converter runs once, JS deleted, generators rewritten as data, terrain `util` moved into the engine by `name`+`version`. Clean, but ~5 days, and it stalls design work.
- **B. Split by who authors it (recommended).** *Tool-authored data* becomes canonical JSON under `content/`: world files, structure levels (grid + legend), placements (entities, props, lights, triggers, hint zones), voxel models (existing text-layer format; the `.vox` importer writes it). *Code-authored content* stays JS (palette/detail-pass validators, terrain recipe functions, procedural model generators) until each has an engine-side named implementation or an editor (M5). Generators may emit JSON via the converter.
- **C. Keep JS; the editor writes JS wrappers** (`ASSETS.levels.x = {<JSON>};`). ~0.5 day, but the editor must parse JS, there is no fetch/streaming, and it dead-ends at chunks. Rejected.

**B in detail.**
1. **Layout (per world / per structure level / per chunk / per model):** `content/manifest.json` (file list + `contentVersion`); `content/worlds/<world>.world.json` (terrain recipe ref + seed, structure placements `{id, level, origin, yawSteps}`, world-level entities); `content/levels/<level>.level.json` (grid, legend, level-local entities/props/lights/triggers in level coordinates); `content/chunks/<world>/<cx>_<cy>.json` (M2+, US-026: terrain overrides + outdoor placements for one `Terrain.chunkSize` chunk, loaded with the near ring); `content/models/<key>.model.json`. Palette/materials stay one small shared file. Placements live **with their owner** (level-local in the level, outdoor in the chunk): moving a structure moves its props, and two people rarely edit the same file.
2. **Every file:** `{ "kind": "level", "schema": 1, "id": "tower", ... }`. Stable ids: strings, unique inside the file, global form `<fileId>/<localId>` (`tower/lamp_hook`). The editor mints `<type>_<n>` from a per-file `nextId` and never reuses one; references are by id, never by array index.
3. **Migration:** `engine/content/migrate.js`: pure functions per `kind`, `vN -> vN+1`, run by the loader on load; the editor always writes the latest schema; `schema` newer than the engine knows = clear error. Tests: one fixture per old version.
4. **Engine loader:** new `engine/content/loadPack.js`: `loadContentPack(manifestUrl, { fetchJson }) -> Promise<AssetBundle>` (fetch injected, so Node tests pass a file reader); `AssetRegistry.fromJSON(bundle, codeParts)` merges JSON parts with the still-JS parts (`fromGlobals` stays during migration). `World.load(def)` is unchanged (it already takes plain data); M2 adds `World.loadChunk(key, data)` / `unloadChunk(key)`. The engine never hard-codes `content/` paths: the game passes the manifest URL.
5. **Save game vs content:** saves stay the section 10 `WorldState` (deltas + ids) plus `contentVersion` from the manifest. On load, a saved entity id no longer in content is dropped with a warning; a new content id is spawned from content. Saves go through `game/js/platform/` (US-060), content never does. The editor never writes saves; the game never writes content.
6. **Git-merge friendly:** one canonical writer `engine/content/stringify.js`, used by editor and converter: fixed key order per kind, 2-space indent, one grid row / one placement / one voxel layer row per line, placements sorted by id, trailing newline. Same input -> same bytes (test). No binary blobs (voxel text layers diff well; revisit only if a model file passes ~500 KB).
7. **Editor I/O (M1.5, US-031..034):** reads through the same `loadContentPack` over the static server; writes with the File System Access API (`showDirectoryPicker()` on the repo's `content/`, handle kept in IndexedDB), fallback = download of the single changed file. Play-test = `game/index.html?world=<id>` reading the saved file (US-027 world half).
8. **Migration path from today:** `tools/export-content.mjs` (US-027) loads the classic scripts in a Node `vm` (same file list as `game/index.html`, like US-058) and writes canonical JSON. Flip per kind, in this order: `world_m1` + `tower`/`test_room` levels (the editor needs them) -> static voxel/billboard models -> the rest later. When a kind flips, its JS file is deleted in the same commit (no dual source of truth); `design/preview/*.html` load JSON through one small shared helper; US-058's validator reads the JSON.

**Cost (B):** PC-A engine ~1.5 days (loadPack + fromJSON + migrate + stringify + tests, one ARCH review); PC-B ~1.5 days (converter, flip world/levels, preview helper, validator update); designer: levels become JSON (no loss, level data is already plain literals). A: ~5 days + designer disruption. C: ~0.5 day, then rewritten.

**Reversible vs not:** layout, granularity and JSON-vs-JS are cheap to reverse (the converter works both ways). **Expensive to reverse, decide now:** the id scheme (`<fileId>/<localId>`, never reused) and "saves reference content by id + `contentVersion`", because saves in players' hands (itch demo, end of M2) depend on them.

ESCALATE TO MANAGER (D-023): pick A, B or C. Recommendation **B**, with the id and save rules (items 2 and 5) normative.

## 20. M1.5 editor tech notes: outline (P7; full notes after D-023; architect, 2026-09-25)

1. **Layout:** `tools/editor/index.html` + `tools/editor/{main,camera,select,tools,panel,io,undo}.js`; imports `engine/index.js` only (never `engine/dev.js`, check-deps rule 7, US-047), never `game/` (add a `tools/editor` fixture to check-deps).
2. **Rendering:** `createWorldRenderer(canvas, assets, opts)` (US-046) = the game's compositor/GPU path with its own RenderTarget; the editor owns no render code.
3. **Fly-cam without `game/`:** a free `CameraPose` driven by `Input` (WASD, Q/E down/up, RMB look); no Player, no physics step; the sim runs only in "Play" mode.
4. **Idle skip:** render only when `world.renderVersion`, the camera pose or the animation clock changed (section 10); target ~0 ms when idle.
5. **Pick/readback API (US-032):** `renderer.pickAt(col, row) -> { kind, structureId, cell:{x,y}, face, entityId|null, world:{x,y,z} }` from the G-buffer (`planeId`, depth, kind) on the CPU path and a 1-pixel `readPixels` of the id/depth target on the GPU path, on click only (never per frame). Sprites/voxels need an entity/instance id channel (new, PC-A engine story).
6. **Edits:** only through public World calls (`placeStructure`/move/remove, `spawn`/`remove`, component set); each edit is a `{do, undo}` command on a ring (undo/redo); files are written back via `stringify` (section 19 item 6).
7. **I/O:** section 19 item 7 (FSA API + download fallback), dirty tracking per content file.
8. **Dependency chain:** D-023 (format) -> US-027 loader/stringify (PC-A) -> US-046 + US-047 (PC-A) -> pick id channel (PC-A) -> US-031/032 (PC-B).

## 21. US-027a content loader: files, API, ids, saves, converter contract (architect, 2026-09-25; D-023)

Normative for US-027a (PC-A) and US-027b (PC-B). Section 19 is background; where they differ, this section wins.

**1. Files (`engine/content/`, all public names re-exported by `engine/index.js`).**
| File | Exports |
|---|---|
| `schema.js` | data tables only: `LATEST_SCHEMA = { manifest: 1, level: 1, world: 1 }`, `ID_COLLECTIONS`, `REF_FIELDS`, `KEY_ORDER`, `ORDERED_MAPS`, `ENVELOPE_KEYS = ['kind','schema','id','nextId']` |
| `ContentError.js` | `class ContentError extends Error { file, field, errors[] }`, message `content: <file>: <field>: <reason>` |
| `migrate.js` | `migrateContent(kind, obj, file, opts?)` |
| `stringify.js` | `stringifyContent(obj)` |
| `loadPack.js` | `loadContentPack(manifestUrl, opts?)`, `globalId(fileId, localId)` |

Tests go in `engine/content/{migrate,stringify,loadPack}.test.js`. Fixtures go in `engine/content/fixtures/`: `pack/manifest.json`, `pack/levels/tiny.level.json`, `pack/worlds/tiny.world.json`, `golden.level.json`, and one broken file per error case. The engine hard-codes no `content/` path. Only the game and the tests name one.

**2. File schema (schema 1).** Each file is one JSON object. The envelope is `kind, schema, id, nextId`.
- **Manifest:** `{ "kind": "manifest", "schema": 1, "id": "kestrel", "contentVersion": 1, "files": ["worlds/world_m1.world.json", ...] }`. `files` are relative to the manifest URL. `contentVersion` is an integer. The content author (today the converter) bumps it on every content release.
- **Level:** `{ "kind": "level", "schema": 1, "id": "tower", "nextId": 1, ... }`, followed by the JS LevelDef keys verbatim: `name, title, version, cellSize, size, rows, legend, layers, tilt, start, sun, ambient, lights, props, interactables, triggers, markers, route, routeNotes`, the `note` fields, and any unknown keys (kept). If `name` is present it must equal `id`. `version` is the level's own content counter. It is not `schema`.
- **World:** same pattern with `kind: "world"` and the WorldDef keys: `name, version, title, terrain` (a key into code terrain, e.g. `"overworld_far"`), `time, structures, entities, horizon, state`.
- **Values:** plain JSON only. No functions, `undefined`, `NaN` or `Infinity` (the stringifier throws `ContentError` on these). `-0` is written as `0`.

**3. Ids (clarification of D-023).**
- **File id:** `^[a-z][a-z0-9_]*$`, e.g. `tower`, `world_m1`.
- **Local id:** `^[A-Za-z][A-Za-z0-9_-]*$`. No `/` and no `.`, because both are separators.
- **Local ids must be unique within one id collection, not across the whole file.** Reason: the tower reuses `brazier` (light and prop), `lantern` (prop and interactable), `beacon` and `lever` on purpose, and US-027b must keep every id unchanged. An item's identity is therefore `(fileId, collection, localId)`. The string form `globalId(fileId, localId)`, e.g. `'tower/lamp_hook'`, is only used where the field already says which collection it points into (`prop:` names a `props[]` id, `light:` names a `lights[]` id).
- **`ID_COLLECTIONS`:** `{ level: ['props','lights','interactables','triggers'], world: ['structures','entities','horizon'] }`. Every item in these collections needs an `id`.
- **`REF_FIELDS`** (the loader resolves these inside the same file):
  - level: `interactables[].prop -> props`, `interactables[].light -> lights`, `interactables[].flameProp -> props`
  - world: `entities[].spawn.structure -> structures`

  References across files (`structures[].level`, `world.terrain`) are checked later by `World.load` / `AssetRegistry`, which already throw with the missing name.
- **Minting:** a new id is `<type>_<n>` with `n = nextId++`. `nextId` is a required integer >= 1. It must be greater than every n found in an id matching `_(\d+)$` in the file's collections. The loader checks this, so a minted id is never reused.
- **Runtime entity ids stay exactly as they are today,** so quest code and saves keep working:
  - level prop: `${placementId}.${propId}` (e.g. `tower.brazier`)
  - world entity: its own id (e.g. `player`)
  - runtime spawn: `${type}_${world.nextId++}`

  Content ids are enough to recompute these.

**4. Loader API.**
```js
/** @typedef {{ contentVersion:number, packId:string,
 *   levels:Object<string,Object>, worlds:Object<string,Object>, models:Object<string,Object>,
 *   meta:Object<string,Object<string,{url:string, schema:number, nextId:number}>> }} ContentBundle */
loadContentPack(manifestUrl, { fetchText, migrations, latest } = {}) -> Promise<ContentBundle>
```
- **URLs:** `manifestHref = new URL(manifestUrl, globalThis.location?.href).href`. Each file resolves with `new URL(rel, manifestHref)`.
  - Node tests pass `pathToFileURL(p).href` and `fetchText: (u) => readFile(new URL(u), 'utf8')`.
  - The browser default uses `fetch(u)`. A non-ok response throws `ContentError(file, 'fetch', 'HTTP <status>')`. Otherwise it returns `r.text()`.
  - The injected function returns **text**, so the loader does the `JSON.parse` itself and can name the file in a parse error. This is the AC's `fetchJson`; call it `fetchText`.
- **Order:**
  1. Fetch the manifest.
  2. Fetch all files with `Promise.all`.
  3. For each file, in manifest order: parse it, check the envelope, run `migrateContent`, then validate ids, refs and `nextId`.
  4. Move `ENVELOPE_KEYS` into `meta[kind][id]` and set `bundle[kind + 's'][id] = def`.

  The same `(kind, id)` in two files is an error.
- **Errors:** collect them across all files and throw one `ContentError` with `.errors[]`. Each entry names the file and the field. One test per case:
  - unreadable file or 404
  - bad JSON (keep the parser's message)
  - missing or unknown `kind` (`model` counts as unknown until models flip)
  - `schema` not an integer
  - `schema` newer than `LATEST_SCHEMA`, e.g. `schema 3 is newer than this engine (max 1)`
  - bad or missing `id`
  - `name` not equal to `id`
  - an item without an id in an id collection
  - a duplicate local id within one collection
  - a `REF_FIELDS` reference that does not resolve
  - `nextId` missing, or not greater than a minted n
- The loaded defs have **the same plain shape as today's `ASSETS.levels.tower`**, minus the envelope. `World.load`, `packLevel` and every other consumer stay unchanged.

**5. `migrate.js`.**
- `MIGRATIONS = { level: [], world: [], manifest: [] }`. Entry `i` is a pure function `(obj) => obj` from schema `i+1` to schema `i+2`.
- `migrateContent(kind, obj, file, { migrations = MIGRATIONS, latest = LATEST_SCHEMA } = {})`:
  - newer than latest: error
  - equal to latest: return the same object
  - older: `structuredClone` once, run the chain, set `schema` to latest
- The input is never mutated. The test deep-freezes it.
- The synthetic test kind is passed through `opts`. The engine table holds no test kinds.

**6. `stringify.js` (byte-stable; the converter and the editor both use it).**
- **Key order:** `KEY_ORDER[kind]` first (`kind, schema, id, nextId`, then the item 2 order), then unknown keys alphabetically. Nested objects: `id` first, then alphabetical.
- **`ORDERED_MAPS` keep their insertion order:** level `legend`, `markers`, `layers`, `routeNotes`; world `state`. Legend order can feed material and packing order.
- **Arrays always keep their order. Placements are NOT sorted by id.** This deviates from the AC text. Reason: light-slot order, interactable tie-break, trigger order and prop spawn order are all visible at runtime today, and US-027b must leave the game identical. New items are appended at the end, which is still deterministic. A later schema migration may sort once the runtime no longer depends on order.
- **Layout:**
  - 2-space indent, LF line endings, trailing `\n`.
  - The top-level object has one key per line.
  - An object or array value directly under the top level has one entry per line, and each entry is written inline.
  - An array of strings has one element per line at any depth (grid rows, voxel layer rows).
  - Inline form: `{"id": "brazier", "preset": "torch", "x": 18.5}` and `[1, 2]`.
  - Empty values are `{}` and `[]`. Scalars use `JSON.stringify`.
- **Tests:**
  - shuffled keys (outside the ordered maps) give the same bytes
  - `stringify(parse(stringify(x))) === stringify(x)`
  - `golden.level.json` matches byte for byte
  - a function or NaN value throws

**7. `AssetRegistry.fromJSON(bundle, codeParts)`.** This is sync and replaces the async stub.
- `codeParts` has **the same shape as the `fromGlobals` input**. The game passes `window.ASSETS`, which still holds palette, detailPass, uiStyle, models and the terrain recipe `levels.overworld_far`.
- Build the maps the way `fromGlobals` does (split by shape), then overlay `bundle.levels` and `bundle.worlds`.
- A key that exists in both JS and JSON throws: no dual source (D-023 item 4).
- New getter `contentVersion`: `bundle.contentVersion`, or `null` when built with `fromGlobals`.
- Test: a fixture pack plus the same defs given as globals. The `levels`, `worlds` and `terrain` maps must deep-equal the `fromGlobals` result.
- `fromGlobals` is unchanged.

**8. Saves (`engine/world/serialize.js`, `World.js`).** All changes are additive. `WorldState.version` stays 1.
- **`World.load`** sets:
  - `w.contentVersion = assets.contentVersion ?? null`
  - `w._contentIds`: a Set of the runtime ids that come from content (world `entities[].id` and `${placement}.${prop.id}`)

  `remove(id)` on a content id also adds it to `w._removedContent`.
- **`serialize`** writes three things **only when `contentVersion != null`**: top-level `contentVersion`, `removed: [...]` (sorted), and `fromContent: true` on every entity whose id is in `_contentIds`. Saves built with `fromGlobals` and the `R` restart state stay byte-identical.
- **`deserialize(state, assets)`** applies the id rule only when `state.contentVersion != null && assets.has('world', state.world)`:
  1. A saved entity with `fromContent` whose id is no longer in the current content set is dropped. Log **one** `console.warn` for the whole load, with the count and the first 5 ids.
  2. A content id that is missing from the save and not in `removed` is spawned from content. World entities are merged into `def.entities`. Props are already spawned by `World.load`, except ids in `savedIds` or in the new `opts.skipIds` (= `removed`).
  3. Runtime-spawned entities (no `fromContent`) are always kept.
  4. A save with a different `contentVersion` loads normally, with an info log only. Rules 1 to 3 are the migration.
- **Node test:** build from content, remove a prop, serialize. Then change the content (delete one entity, add one) and deserialize. Expect:
  - the deleted entity is gone, with exactly 1 warning
  - the new entity exists
  - the removed prop stays removed
  - a runtime spawn survives

**9. Contract for US-027b (PC-B can start from this item alone).**
- **Converter `tools/export-content.mjs`:**
  - Run the same classic-script list as `game/index.html` in a `vm`.
  - For each flipped def, write `stringifyContent({ kind, schema: 1, id: key, nextId, ...def })`.
  - `nextId` = 1 + the highest n over ids in `ID_COLLECTIONS` that match `_(\d+)$`, or 1 if there are none.
  - Mint ids for items that have none (there are none today).
  - Keep array order. Refuse functions.
- **Output:**
  - `content/manifest.json` with `id: "kestrel"`, `contentVersion: 1`, and `files` in the order world, tower, test_room
  - `content/worlds/world_m1.world.json`
  - `content/levels/tower.level.json`
  - `content/levels/test_room.level.json`

  `overworld_far` stays JS.
- **Guard (in `export-content.test.mjs`):** `loadContentPack` on the output succeeds. `fromJSON(bundle, globalsWithoutTheFlippedDefs)` deep-equals `fromGlobals(globals)` for levels and worlds. This is the "game identical" check.
- **Boot (main.js, bootstrap area only):**
  ```js
  const bundle = await loadContentPack('../content/manifest.json');
  const assets = AssetRegistry.fromJSON(bundle, window.ASSETS);
  ```
  The path is relative to `game/index.html`. The `?gpucompare=1` fixtures read `world_m1` and `test_room` through the registry, so they keep working. Harnesses that read `window.ASSETS.levels.*` directly (`game/js/dev/worldTestMain.js`, `physicsTestMain.js`) switch to the registry.
- **Node test helper:** write one module, suggested `tools/testing/content-node.mjs`, with `loadTestAssets() -> { globals, bundle, assets }` using the file reader. If check-deps objects to an `engine/**` test importing it, ASK ARCHITECT. Do not copy the loader.

**10. Steps for US-027a.** Each step ends with a green Node test.
- S1: `schema.js`, `ContentError`, `migrate.js` and its test.
- S2: `stringify.js`, the golden fixture and its test.
- S3: `loadPack.js`, the fixture pack and the error-case tests.
- S4: `AssetRegistry.fromJSON`, `contentVersion` and the deep-equal test.
- S5: the serialize/deserialize id rule and its test. The existing `serialize.test.js` must stay unchanged and green.
- S6: `index.js` exports, `node tools/check-deps.mjs`, all suites. The main session then runs `?gpucompare=1`, expecting 27/27 because no game path changed.

**Do not:**
- fetch inside `AssetRegistry`
- read `window` or `ASSETS` in `engine/content`
- use array-index references
- sort arrays or ordered maps
- drop unknown keys
- let `stringify` output depend on the input's `Object.keys` order
- change the format of runtime entity ids

## 22. US-038a live grid change `engine.setGrid` (architect, 2026-09-25; D-025)

**1. Principle: resize in place, never rebuild.**
- **Why:** today `setGrid` builds a new `RenderTarget` on the same canvas. Each call reuses the same WebGL context but adds a new program, new textures and 2 more context listeners, so it leaks. A new `GpuCellPipeline` would also recompile 9 programs, which takes more than 100 ms.
- **Rule:** keep every object (rt, pipeline, sprite pass, UiLayer) and reallocate **only the resources sized by the grid**.
- **Effect:** `rt` stays the same object, so every `rt` reference in main.js stays valid.

**2. Grid math (`engine/core/engine.js`).**
- `GRID_MAX_COLS = 480`. Otherwise `clampGrid` stays as it is: round cols, clamp to [160, 480], `rows = round(cols*3/8)`. This gives exactly 240x90, 320x120, 400x150 and 480x180.
- Update the `?grid=` warning text in main.js to "160x60..480x180".
- `grid.test.js` cases:
  - 500 -> 480x180, clamped
  - 100 -> 160x60
  - (400, 150): not clamped
  - (400, 151): clamped
  - 401 -> 401x150

**3. What the grid sizes.** This list is complete as of today. The programmer should still re-grep for `cols`/`rows` captured in constructors.
| Owner | Grid-sized resources | Action |
|---|---|---|
| `RenderTargetGL` | `cells` (CellBuffer), `fgTex`/`bgTex` (units 0/1), `uGrid`, canvas size, scene atlas, UI atlas (`fontPx*sy`) | `setGrid(cols, rows)`: delete and recreate fg/bg, new CellBuffer, `resize(...this._refBox)` |
| `RenderTargetCanvas2D` | `cells`, canvas | `setGrid` with the same shape (only reachable at cpuGrid) |
| `GpuCellPipeline` | GI/GA/GD/Depth/Mask/Light/ShadeFg/ShadeBg (cols x rows); SGI/SGA/SDepth, 2 sets (cols*rays x rows*rays); 7 FBOs (`fboFinal` attaches **rt's new** fg/bg); CPU staging `_GI` .. `_SDepth`, `_readbackFg/Bg`; the lazy `_readbackGI/GA/Depth/Light` (they are cached with `\|\|`, so they **must be reset to null**) | `resizeGrid(cols, rows)` |
| `GpuSpritePass` | `texEdgeFg/Bg`, `cols/rows` | `resizeGrid(cols, rows)` |
| engine | `DepthBuffer`, `OpenSpans` | new instances (CPU side, small) |
| game (main.js) | `gbuf` (GBuffer); `fb.light` (`makeLightBuffer`); `matTable` (its `cellAspect = pxCellH/pxCellW` can change with fontPx) | recreate in the `grid:changed` handler: `bindShading` again, then `gpuPipeline.bind(matTable, palette)` |
| `UiLayer` | none (fixed at 160x60) | `ui.bindScene(cols, rows)` gives sx 1.5 / 2 / 2.5 / 3; `rt.setUiLayer(ui)` rebuilds the UI atlas |

**Not grid-sized, keep as they are:** programs, VAOs, the world atlas (GEOM/MATS/FLAGS), terrain textures (farH/farType/tlook), voxel VOX/VOXINST, LVIS, material/sky/gain textures, and the sprite atlas and palette.

**Camera values:** `planeDist`, `screenAspect` and `horizonRow` are computed every frame from `this.cols/rows` and `rt.pxCell*`. Updating `this.cols/rows` is enough. Do not cache them anywhere.

**4. Extract `engine/render/gpu/gridTargets.js`** (the testable core).
- **API:** `allocGridTargets(gl, cols, rows, rays, outFgTex, outBgTex) -> targets` creates all grid-sized textures and FBOs and checks FBO completeness. `freeGridTargets(gl, targets)` deletes them.
- **`GpuCellPipeline`:**
  - `_initGL` is split into `_initPrograms()`, which runs once and again on context restore, and `this._t = allocGridTargets(...)`.
  - `resizeGrid` runs, in order: `freeGridTargets`, update cols/rows/subCols, `allocGridTargets`, reallocate the staging arrays, reset the lazy readbacks.
  - Context restore uses the same two calls.
- **Leak test (Node):** use a counting mock `gl`, a Proxy where:
  - `create*` returns `{}` and increments a counter
  - `delete*` decrements it
  - `checkFramebufferStatus` returns `FRAMEBUFFER_COMPLETE`
  - every other method is a no-op

  Run 20 alloc/free cycles through 240 -> 320 -> 400 -> 480 -> 240. The live texture and FBO counts must end at the single-alloc value.
- **Dev counter:** add `glUtil.glCounts`, incremented in the `createTexture2D` / `deleteTexture2D` helpers. RenderTargetGL switches to these helpers too, so the browser soak can log the counts.

**5. Limits (checked before anything is changed).**
- `rt.canHoldGrid(cols, rows, rays) -> { ok, reason }` checks:
  - `cols*rays` and `rows*rays` <= `MAX_TEXTURE_SIZE`
  - canvas backing size (`pxCellW*cols` x `pxCellH*rows`) <= `MAX_VIEWPORT_DIMS`
  - `MAX_DRAW_BUFFERS >= 3`
  - estimated GPU memory `est = cols*rows*(85 + rays²*56)` bytes <= 256 MB. That is about 27 MB at 480x180 with rays 2, and about 85 MB with rays 4 (320x120 uses about 12 MB).
- WebGL2 guarantees a 2048 texture size, and the worst case here is 480*4 = 1920, so refusals are unlikely. Keep the check anyway.
- **On refusal:** `console.error`, keep the current grid, and have `setGrid` return `{ cols, rows, error: reason }`. Do not throw: a settings menu must not crash.
- **Atlas warning:** warn once if an atlas width (`pxCellW*95`, or `pxCellW*sx*95` for the UI) exceeds `MAX_TEXTURE_SIZE`. This is an existing risk on high-DPR screens.

**6. Engine API.**
```js
engine.setGrid(cols, rows, { immediate = false } = {}) -> { cols, rows, clamped, pending, error? }
```
- **Request handling, in order:**
  1. Clamp. Log one `console.warn` if the input was clamped.
  2. Without a GPU grid (`rt.backend !== 'gl2'`, or `gridRequest.gpu === false`): return the cpuGrid, warn, and change nothing.
  3. If the result equals the current grid: no-op.
  4. Otherwise run `canHoldGrid`, then store the request in `engine._pendingGrid`.
- **Frame boundary:** `engine.run` wraps `render` once (no closure per frame): `loop.render = (a) => { if (engine._pendingGrid) applyGrid(); render(a); }`. The simulation does not depend on the grid, so this is safe.
- **`immediate: true`** applies at once. Only the startup CPU fallback in main.js uses it. That code becomes `engine.setGrid(c, r, { immediate: true })`, and `rt` stays the same object.
- **`applyGrid` order:**
  1. `t0 = performance.now()`
  2. `rt.setGrid`: textures, CellBuffer, canvas re-fit using the stored `_refBox`
  3. new DepthBuffer and OpenSpans
  4. `ui.bindScene` and `rt.setUiLayer(ui)`
  5. update `gridRequest`
  6. `events.emit('grid:changed', { cols, rows, renderTarget: rt })`. Listeners run **synchronously** here and rebuild the pipeline, sprite pass, gbuf, fb.light and matTable. rt goes first because `fboFinal` needs rt's new textures.
  7. `engine.stats.lastGridSwitchMs = performance.now() - t0` and one log line, e.g. `[grid] 240x90 -> 480x180 in 23.4 ms`. The F3 overlay shows `lastGridSwitchMs`.
- **Ref box:** `rt.resize(refW, refH, refDpr)` stores `this._refBox`, and `setGrid` reuses it. `?gpucompare` keeps its fixed 1280x720 box after a switch. The window `resize` listener keeps working because rt is the same object.
- The engine holds no list of player grid options.

**7. Game side (about 25 lines or fewer in main.js).**
- One `engine.events.on('grid:changed', ...)` handler rebuilds everything in the "game (main.js)" row of the item 3 table.
- **F4**, only with `?debug=1`, in 5 lines or fewer: `const G = [240, 320, 400, 480]; engine.setGrid(G[(G.indexOf(rt.cols) + 1) % 4]);`
- Open cards, fades, player pose, lights, audio and the loop clock are not touched, because nothing outside render state is recreated.

**8. Parity.**
- `?gpucompare=1` still pins 160x60 at boot.
- New flag `?gpucompare=1&roundtrip=1`: before the compare state is built, run `setGrid(480, 180, { immediate: true })`, render one frame, run `setGrid(160, 60, { immediate: true })`, then run the usual 27 poses. Expected: all PASS, with `_refBox` kept.
- A plain `?gpucompare=1` run must give the same result as before.

**9. Steps.** Each step ends with a green Node test.
- S1: clamp range and `grid.test.js`.
- S2: `gridTargets.js` and the mock-gl leak test. The pipeline uses it with no change in behaviour; `glsl.test.js` and `gpuCompare.test.js` stay green.
- S3: `GpuCellPipeline.resizeGrid`, `GpuSpritePass.resizeGrid`, `RenderTargetGL/Canvas2D.setGrid`, `canHoldGrid` and `_refBox`. Node test: `canHoldGrid` against a fake `getParameter`.
- S4: `engine.setGrid` with pending/immediate, the `run` wrapper and stats. Node test with a fake rt:
  - a pending request is applied once, at the next render
  - asking for the current grid is a no-op
  - a refusal keeps the current grid
  - the clamp warning fires once
- S5: the main.js handler, F4, and `roundtrip=1`.
- S6: ONE browser pass.
  - `?debug=1&gridsoak=1` (dev only) runs 20 switches through the AC cycle, then logs `glCounts`, the `performance.memory.usedJSHeapSize` change and `gl.getError()`.
  - Press F4 by hand in the tower with the map card open.
  - The owner bench (`?bench=1&grid=400x150` and `?bench=1&grid=480x180`) is run by the main session or the owner, and the result is recorded in the story.

**Do not:**
- create a second RenderTarget or pipeline for a grid change
- recompile shaders
- re-upload the world, terrain or voxel atlases
- switch grids inside the sim step or in the middle of a render
- allocate in the per-frame wrapper
- let the engine know the player grid list
- lose the gpucompare ref box

## 23. US-026a bounded walk-out: near terrain band, terrain physics, walk bound, waystone end (architect, 2026-09-25; D-020, D-026)

Normative for US-026a. 7 (World), 7.1 (capsule rules), 14.4 (terrain pass A2) stay valid; this section extends them. US-026b (streaming, `content/chunks/`) builds on the same interfaces and must not need to change them.

**Probe results (Node, real recipe, no `vm` sandbox):** `heightAt` 0.38 us, `typeAt` 1.25 us, one 64x64 chunk bake 9 ms -> the 3x3 band bakes in ~80 ms (AC 300 ms). Max slope inside r 96 m is **7.4 deg**; there is **no cell > 50 deg anywhere in the 3x3 band** (crown stamp + gentle home hill). `|bilinear 2 m - analytic|` <= 0.005 m over the whole band (<= 0.003 m inside r 96). Height at the proposed waystone spot (1428, 1040) is 0.53 m, type grass, 60 m from the breach eye, 70 m from the tower centre. The sector DDA already supports an eye outside a structure (`footprintEntry`/`slabEntry`), so the tower keeps drawing from the hillside.

### 23.1 Decisions (reasons inline)
1. **One contiguous near band**, not the 9-slot chunk ring: `Terrain.bakeNearBand(cx, cy)` fills `terrain.near = { x0, y0, w: 192, h: 192, cell: 2, height: Float32Array, type: Uint8Array, hDraw: Float32Array, minH, maxH, version }` (cells sampled at centres like `bakeChunk`; `hDraw = height + canopy` on forest cells, same rule as `farHDraw`). Baked **synchronously in `World.load`** (80 ms) before props are spawned; `terrain.nearReady = true`. `chunk()/setCenter()/bakeChunkStep()` stay as they are for US-026b; nothing in US-026a calls them. One array makes `util.gridHeight` seamless across the 9 chunks by construction (7.2's "195x195 atlas" is superseded by 192x192 centre-sampled).
2. **Physics and renderer read the same array.** `Terrain.groundAt(x, y)` = `gridHeight(near, x, y)` when non-null, else `heightAt(x, y)` (analytic: outside the band or before `nearReady`). `Terrain.groundNormalAt(x, y, out)` = central difference of `groundAt` at +-2 m. `Terrain.groundTypeAt(x, y)` = nearest `near.type` texel, else `typeAt`. `World.outsideSector/floorAt` and `z: 'ground'` props switch from `heightAt/typeAt` to these. The AC's 0.05 m is exact by construction inside the band and 0.005 m outside it (Node test).
3. **Terrain cells are always horizontally passable; steepness is decided at the actor's own position** (slope rule 23.3). Reason: `isSectorPassable` samples floor heights at 1 m cell centres; on a continuous slope that turns a 25 deg hill into a 0.47 m "step" and blocks walking uphill. Tower sectors unchanged.
4. **Walk bound = data (`world.bounds`), enforced in `integrate`** as a projection with velocity clipping (no wall sectors, no spring). First contact fires a trigger of `shape: 'bounds'` (hint `boundsEdge`).
5. **Waystone = world entity (`components.voxel`) + world-level circle trigger**; `buildTriggers` gains world-level triggers (`def.triggers[]`, `structId: null`, absolute coordinates). `quest.end` learns absolute `walkTo` and `lookAt: <entityId>` (yaw target); the tower's `end` trigger and its `trigger:end` tags are deleted from the level data.
6. **Near terrain is the same pass A2**, extended with two textures, a near step schedule and a stable **dithered handover by distance t in [130, 170] m** (by t, not by band edge; not the design's 280-320: the band is only 128-256 m wide around the tower). Terrain writes `face = FACE_PACKED` with an octahedral-packed normal so the existing light pass lights it with the carried lamp; the sun stays analytic (no terrain shadow rays).
7. **Tower west hill cells (`x/j/k/l`: 6.0 -> 5.4 -> 4.6 -> 3.6 -> 2.4) stay as authored**: the descent is a chain of 0.6-1.2 m drops (falls with the small landing dip, never a stop) and one-way (jump apex 1.05 m < 1.2 m). Re-authoring to <= 0.45 m steps needs a 9-cell switchback in the west face (content, PC-B/designer) and changes the silhouette; **PO decides** (recommendation: accept the drops for US-026a).

### 23.2 Data (content; plain JSON, written back verbatim by `serialize`)
World file (`content/worlds/world_m1.world.json`, designer/PC-B):
```jsonc
"bounds":   { "shape": "circle", "x": 1496.5, "y": 1024.5, "r": 96 },          // optional; absent = unbounded
"entities": [ ..., { "id": "endMarker", "type": "prop", "x": 1428, "y": 1040, "z": "ground", "yawDeg": 75,
                     "components": { "voxel": { "model": "waystone", "anim": "idle", "loop": true } } } ],
"triggers": [                                                                  // NEW collection, world coordinates
  { "id": "end",        "shape": "circle", "x": 1428, "y": 1040, "r": 2.5, "once": true, "trigger": "quest.end",
    "walkTo": { "x": 1430.3, "y": 1039.4 }, "lookAt": "farTower", "pitchTo": 0 },
  { "id": "hintStone",  "shape": "terrain", "once": true, "trigger": "hint.show", "hint": "stone" },
  { "id": "boundsEdge", "shape": "bounds",  "once": true, "trigger": "hint.show", "hint": "boundsEdge" } ]
```
- `World.load`: `z: 'ground'` on a world entity resolves through `terrain.groundAt`; `w.bounds = def.bounds ?? null` (validated: circle, finite, `r > 0`); `def.triggers` validated (unique ids, known shapes) and appended by `buildTriggers`. `schema.js`: `ID_COLLECTIONS.world` += `'triggers'`, `KEY_ORDER.world` += `bounds, triggers` (schema stays 1: additive optional keys; a world file without them must still load).
- Level file (`content/levels/tower.level.json`, PC-B): remove `triggers[id=end]`; legend `X`/`Y` lose `tag: 'trigger:end'` (plain rock 6.0 / 5.4). `hintExit` stays.
- Hints (`uiStyle.storyHints`, design, PC-B): `stone` ("A stone stands below. Go to it.") and `boundsEdge` ("The wind turns you back. Not yet."), <= 40 ASCII chars; writer may reword.
- Waystone model (designer, PC-A per sprint-3): `design/models/waystone.js`, voxel <= 16x16x24, one emissive aether-teal mark material (append-only palette/detail-pass); `anim: 'idle'`, 1 frame; anchor bottom centre like other voxel props.

### 23.3 Physics (`engine/physics`, `engine/world/World.js`)
`World.outsideSector` scratch gains `terrain: true, nx, ny, nz` (from `groundNormalAt`; Level sectors have no `terrain` field, so nothing else changes). `SOLID_OUTSIDE` stays for terrain-less worlds.

`isSectorPassable`: after the `solid` and head-clearance checks, `if (sector.terrain) return true;` (decision 3). `moveCapsule` untouched.

`integrate`, new step **4b (bounds)**, after step 4's velocity response and before step 5, only when `world.bounds`:
```
dx = x - bx; dy = y - by; d = hypot(dx, dy); lim = r - body.radius
if (d > lim) { nx = dx/d; ny = dy/d; x = bx + nx*lim; y = by + ny*lim;
               vn = vx*nx + vy*ny; if (vn > 0) { vx -= vn*nx; vy -= vn*ny; }  body.boundsHit = true }
else body.boundsHit = false                                   // per-step flag, same class as `landed`
```
Tangential speed is preserved -> smooth slide, no bounce, no stop (test: walking into the bound at 45 deg keeps >= 0.7 of the speed and never crosses `lim + 1e-6`).

Step 5, grounded branch, **slope rule** (only when `sector.terrain`; `cfg.maxSlopeDeg = 50`, `cfg.slideStartCos = cos 50`, `cfg.slideStopCos = cos 45` hysteresis, `cfg.slideAccel = gravity`, `cfg.slideMaxSpeed = 8`):
- `body.sliding` (plain bool): set when `nz < slideStartCos`, cleared when `nz > slideStopCos`.
- while sliding: downhill unit `dh = normalize(nx, ny)`; `vx += dh.x * slideAccel * sqrt(1 - nz*nz) * dt` (same y); in step 3 the wish velocity loses its uphill component (`wish -= max(0, -(wish . dh)) * (-dh)`) so W into the slope does nothing; clamp horizontal speed to `slideMaxSpeed`; `speedScale` untouched.
- the vertical snap `|floorH - z| <= stepUpMax` stays: at 8 m/s and 60 deg the per-step rise is 0.23 m < 0.45, so a sliding body never leaves the ground; landing on terrain uses the unchanged airborne branch.
- On this content the rule never triggers (max 7.4 deg). It is exercised by a Node test with a **synthetic `WorldQuery` stub** (`h = k*x`, k = tan 30/49/51/60 deg): 30/49 walk uphill at full speed; 51/60 -> no uphill progress, downhill speed grows and caps at 8 m/s, `|z - h(x,y)| <= 1e-6` every step, hysteresis flips exactly once crossing 50 -> 45.

Ground-contact test (AC): 1000 seeded random spawns inside the band at `groundAt + 1.5`, each 600 steps of random wish input incl. jumps: `z >= groundAt(x, y) - 0.01` after every step, no NaN, position within `bounds.r`.

Per-step cost: `outsideSector` becomes 1 bilinear + 1 nearest fetch (~60 ns) instead of `heightAt + typeAt` (1.6 us); worst case ~40 calls/step -> < 5 us. Sim budget unchanged (<= 1 ms).

### 23.4 Render: pass A2 near terrain (`terrainCaster.js`, `gpu/glsl/terrain.frag.js`, `gpu/TerrainTextures.js`)
Textures (`packTerrainTextures`; uploaded when `near.version` changes, never per frame): `NEARH` R32F 192x192 = `near.hDraw`, `NEARTYPE` R8UI 192x192. Uniforms: `uNearMap = vec4(x0, y0, 2, 192)`, `uNearReady`, `uNearMinH`, `uHandover = vec2(130, 170)`, `uNearStep = vec2(0.5, 0.012)` (values from `recipe.nearLOD` through the registry, never literals in GLSL). Terrain program texture units 5 -> 7 (limit 16).

**Height sampling (normative, literal in GLSL and JS):**
```
useNear(t, px, py) = uNearReady && t < h1 && (t < h0 || hash01(cell2(px, py), 9) > (t - h0) / (h1 - h0))   // cell2 = floor(p / 2); uint hash per 14.1 rule 5
H(px, py, t) = useNear ? bilinear(NEARH, p) : bilinear(FARH, p)      // NEARH "outside" (half-cell rim) -> FARH for that sample
```
The dither is keyed on the 2 m world cell: stable while walking, identical on both paths (float32 `t` within 1 % of `h0/h1` is excluded from parity, 23.6).

**March schedule:** `dt = t0 < h1 ? max(nearStepMin, nearStepK * t0) : max(STEP_MIN, STEP_K * t0)`; `MAX_TERRAIN_STEPS` 128 -> **320** (one shared constant, both paths). New early-out (both paths): `slope < 0 && h(t1) < min(uNearMinH, farMinH)` -> the ray is below every surface -> no hit (bounds steep downward rays to a handful of steps; a hit inside a skip interval is the only way to get here). The `eyeH >= uTerrainMaxH` escape stays. Expected cost: horizon rays ~210 near + ~80 far steps worst case; bottom rows 3-10 steps. If the terrain pass exceeds **1.5 ms p95 at 320x120**, fallback knobs are `nearStep = (1.0, 0.015)` and `h1 = 150` (recipe values, no code change), then n = 1 for the terrain pass only (bind-time choice) as the last resort.

**Hit sample:** `kind 7`, `mat = type` (`NEARTYPE` nearest when `useNear` at `tHit`, else `FARTYPE`), `planeId = PLANEID_TERRAIN`, `u, v = p(tHit)`, `z = H`, **`face = FACE_PACKED`, `aoD = packNormalOct(N)`**, `N` = central difference of `H(., tHit)` at `c = 2` (near) or `c = 8` (far). The sun term `b` is no longer stored (it moves to the shade pass). Bisection: 5 steps as today (near: 0.5/32 = 16 mm).

**Lighting:**
- Light pass (`light.frag.js`, `lightSurfaces`): kind 7 already gets `N` from the packed normal via the `FACE_PACKED` branch (no change); add `kind == 7 -> skip the sun term` (uSunOn contribution and `sunVisible` rays): terrain sun is analytic and shadow-free per D-007. Point-light visibility works outside structures because `sectorOrOutside` returns a non-solid terrain sector.
- Shade pass, kind-7 branch (`shade.frag.js`, `shadeTerrainCells`): `N = unpackNormalOct(aoD)`; `b = ambientI + sunI * max(0, N . sunDir)`; `Lc = LIGHT[cell]` (already bound in the shade program; JS: `fb.light`); `bT = b + max(Lc.r, Lc.g, Lc.b)`; after `shadeTerrain` picks `fg/bg` from `bT`, tint toward the lamp: `fg += Lc * 0.5` per channel before fog (clamp 255). New shade uniforms `uSunDir, uAmbientI, uSunI` (no texture). Both paths compute `b` from the **unpacked** normal, so parity holds.
- Near-detail (`shadeTerrainFar` -> `shadeTerrain`): a 4th glyph band **close < 40 m** from `glyphs.close` (TLOOK texel 7; `TLOOK_WIDTH` 8 -> 9); hash cell 2 m when `t < h1`, else 8 m; brightness jitter `+-0.08` on `bT` in the close band; two grass features in the close band by hash: wildflower (`chance 0.025`, glyphs `*,`, gold/strawLight) and pebble (`0.012`, `o.`, rock/stoneLight) from a small `FEAT` texel row per type (chance, 2 glyph codes, colour index). Surface-vs-face rows, trunks, reeds, foam = **US-026b** (OWN-REQ-002).
- Fog unchanged.

**JS oracle** (`castTerrain`, `marchTerrainRay`, `shadeTerrainCells`): literal twin of the above; `marchTerrainRay` reads `terrain.near` through its `terrain` argument (no new parameter); scratch stays module-level (no allocation).

### 23.5 End sequence and hints (`engine/world/triggers.js`; game: `game/js/quest/end.js`, `main.js` wiring; routing in 23.8)
- `buildTriggers`: world-level records `{ key: 'world.<id>', structId: null, ... }`; new shapes: `'terrain'` -> inside when `world.terrain && world.structureAt(x, y) === null` (first terrain contact); `'bounds'` -> inside when `world.bounds && hypot(x - bx, y - by) >= r - radius - 0.05` (`updateTriggers` reads `actor.components.body?.radius ?? 0`). Circle triggers with `structId: null` use absolute `x, y, zMin`.
- `questEnd(ctx)`: `structId == null` -> `walkTo` absolute; `lookAt` (entity id) -> `yawTo = atan2(ex - x, -(ey - y))` in compass degrees, computed once at fire time, stored in `_endWalk`; `stepEnd` eases yaw (shortest arc) with the same smoothstep as pitch. Walk cap 1 m stays; `walkTo` is 2.5 m from the stone toward the far tower, so the actor ends in front of the stone facing the signal tower.
- Fade / "End of Chapter One" card / `R` restart unchanged (`quest.endT`, `deserialize(initialState)`). `R` from terrain: `terrain.near` is content-derived, not state, and survives; `world.triggers` rebuilt (`inside = 0`); hints reset with the state.
- `hintExit` stays. `hint.show` already handles `hint: 'stone'`/`'boundsEdge'` once `uiStyle.storyHints` has the entries.

### 23.6 Parity, poses, budgets
gpucompare world poses (main.js `world_m1: ...` list, `timeSec = 0`): `terrainNearTower` (1470, 1025, z 4.0, yaw 270, pitch -10), `bandEdge` (1470, 1025, z 4.0, yaw 270, pitch 0: horizon rays cross the 130-170 m handover), `waystoneLookBack` (1428, 1040, z 2.13, yaw 76, pitch +5: the tower from below, ring seam visible), `waystoneDown` (same, pitch -35: close band + features). Thresholds = 14.4 item 9 plus: kind-7 cells with `t` within 1 % of 130/170 excluded from `mat`/glyph checks; kind-7 count within 1 %; depth within 1 %; `bT` within 0.01 of a tier edge excluded as today.
`?bench=1` poses: `breach` looking out (existing) and `waystoneLookBack`. Budgets (owner GPU, 240x90 and 320x120): GPU <= 4 ms p95, terrain pass <= 1.5 ms p95, JS <= 8 ms with sim <= 1 ms, load-time band bake <= 300 ms (measured 80). Sector pass from outside marches the whole 24x14 footprint per column: expect < 0.3 ms extra (F3).

### 23.7 Build order (each step ends with a green Node test; one browser pass at the end)
- **S1 Terrain band** (`Terrain.js`, `terrain.test.js`): `bakeNearBand`, `near`, `groundAt/groundNormalAt/groundTypeAt`, `nearReady`. Tests: band == the 9 `bakeChunk` results cell for cell; `groundAt` inside == `gridHeight(near)`, outside == `heightAt`; `groundAt == heightAt` at band nodes (1e-4); between nodes `|groundAt - heightAt| <= 0.01` on >= 99.5 % of 5000 seeded points and <= 0.25 everywhere (content stamps may exceed 0.01 locally; amendment 2026-10-04: height stamps under water or gameplay surfaces are judged on the 2 m grid, not on `heightAt`); bake <= 300 ms.
- **S2 World data** (`World.js`, `triggers.js`, `content/schema.js`, `world.test.js`, `triggers.test.js`): `outsideSector` terrain fields, `bounds`, world-level triggers (3 shapes), `z: 'ground'` for world entities, serialize round-trip of `bounds`/`triggers`, `bakeNearBand` in `World.load`.
- **S3 Physics** (`capsule.js`, `integrate.js`, `config.js`, new `terrainWalk.test.js`): decision 3, bounds step 4b, slope rule on the synthetic stub, the 1000-spawn ground test; `physics/jump/roller.test.js` unchanged and green.
- **S4 JS terrain** (`terrainCaster.js`, `terrainShade.js`, `TerrainTextures.js`, `lighting.js` + tests): near sampling, dither, schedule, packed normal, shade changes. `terrainCaster.test.js`: a near hit within 16 mm of the surface; dither monotone in t; no allocation (`--expose-gc` probe); `lightSurfaces` lights a kind-7 cell with a point light and skips the sun.
- **S5 GLSL** (`terrain.frag.js`, `shade.frag.js`, `light.frag.js`, `GpuCellPipeline.js`, `glsl.test.js`): literal ports, new textures/uniforms, shared `MAX_TERRAIN_STEPS`; string checks for the new uniforms.
- **S6 Game** (`end.js`, `main.js` end wiring <= 10 lines, `restart.test.js`/`tower.test.js`, gpucompare + bench poses): 23.5.
- **S7 Content + art** (designer/PC-B, in parallel with S1-S5 against 23.2): waystone model + preview, world JSON `bounds/entities/triggers`, tower `end` removal, hint texts; `validate-content` green.
- **S8 Browser pass** (programmer, one pass): wake -> breach -> hill -> waystone -> card -> `R`; `?gpucompare=1` all PASS incl. new poses; `?bench=1` numbers into the story. Then ARCH review (fable, S1-S5 diff).

### 23.8 Routing flags for the main session
- **Designer (PC-A per sprint-3):** waystone voxel model + emissive mark material; final marker spot (+-10 m, grass, slope < 10 deg); optional: ring `floorMat` vs terrain grass look (the 24x14 bbox draws as sector floor, the rest as terrain glyphs: a rectangle seam seen from the hillside; cheapest fix is matching colours, the real fix is US-026b's footprint shrink).
- **PC-B files touched:** `content/worlds/world_m1.world.json`, `content/levels/tower.level.json` (after the US-027b flip; frozen during it), `design/` hint texts/palette, `game/js/quest/end.js` + its tests (sprint-3 assigns them to PC-A for this story; main session confirms with PC-B before S6). `tools/validate-content.mjs` must accept `bounds`/`triggers`.
- **PO:** decision 7 (hill drops vs switchback re-author); the walk-test line "along steep slopes" cannot be met by this recipe (max 7.4 deg): drop it, or ask the designer for one steep stamp (e.g. a 55 deg rock face 40 m NW of the tower) as content; features scope (2 of 5 in US-026a).
- **Manager:** none, inside D-026. (If the terrain pass misses 1.5 ms even at the fallback knobs: ESCALATE, n = 1 terrain pass vs a 160 m band cap.)

**Do not:** stream or regenerate the band (US-026b); call analytic `heightAt/typeAt` from physics or the render loop once the band is ready; sample `NEARH` inside a structure bbox (skip intervals stay); put 130/170/0.5/0.012 in GLSL source or `engine/` code (recipe `nearLOD` -> registry -> uniforms); add wall sectors for the bound; hard-code the waystone position or the end yaw in `game/js/quest/*`; fire hints or callbacks from inside `integrate` (flags/triggers only); change `MAX_TERRAIN_STEPS` in one path only; key any hash on the screen cell.

### 23.9 BUG-OWN-008 (tower deforms / "follows" from outside) + S1-S5 review (architect, 2026-09-26)

**Root cause (both paths, `sectorCaster.js` `castColumn` / `dda.frag.js`):** with the camera outside a footprint the caster had no notion of the ground. CPU: the segment from the eye to the footprint edge used `VOID_SECTOR` (`floorH 0`) as the near sector, so the first transition drew a phantom **step band from level height 0 up to the outer ring (2.4 m) along the whole bbox edge** (a plinth that rotates with the player = "follows/deforms"), walls were drawn down to height 0, and every row whose ray is *under the ring at the edge* was claimed by the structure - the terrain pass never marches claimed cells (14.4 item 1/10), so the grass in front of the tower was hidden and the rows the plinth left open showed grass "through" the base. `footprintEntry` also nudged the walk *into* the entry cell, so a solid entry cell's outer face landed one cell deep (main-session probe: 31.8 vs 31.1 m). GPU: no plinth (it starts at the entry cell), but the same under-the-ring rays walked on beneath the ring and hit inner faces below ground.

**Fix (implemented, `engine/render/sectorCaster.js` + `engine/render/gpu/glsl/dda.frag.js`, test `engine/render/sectorCaster.outside.test.js`):**
1. **Ring rule:** the level's outer ring is the ground reference (the recipe blends terrain to `ringHAt`; probe: `groundAt` == 2.40 all along the tower bbox edge and 8 m out). From outside, the near sector of the edge segment is `OUTSIDE_SECTOR` (no floor/ceiling plane, `floorH` = the entry cell's `floorH`, 0 if the entry cell is solid); rows whose ray is below that height at the footprint edge (`row > rowAtHeight(ringH, tEntry)`) are **never claimed by this structure** - `openBottom` is clamped for the walk, `resolveColumn` still reports the caller's full span (`handoffBottom`) so terrain/sky own them (`fillSky` and `castTerrain` skip finite-depth cells already). GLSL twin: `if (t0 > 0 && !E.solid && leyeH + slope*t0 < E.floorH) continue;` per structure (one extra `fetchCell` per fragment per structure, outside only).
2. **Entry:** `footprintEntry` starts the walk `1e-4` *before* the edge, so the edge crossing is a real DDA transition: the entry cell's floor is cast from the edge inward and a solid entry cell's outer face lands at the edge. `_entryT`/`_outside` are ctx scratch (no allocation).
3. Terrain skip rectangles and the depth merge are unchanged (terrain never draws inside a bbox, never over a claimed cell).

**Reopen (2026-09-26 late) - the real root cause was GPU-only.** The owner's two screenshots (400x150, GPU) after the fix above: at (1464.33, 1045.50, eye 2.32) yaw 54 pitch 19 the walls looked like leaning spires off the top of the screen; at (1401.80, 1038.32, eye -2.38) yaw 83 pitch 14 (~80 m, eye below the level origin z) the 8.5 m tower was a column running off the top, taller the farther one walked. **Cause: `dda.frag.js` measured every walk distance from the footprint entry point, not the camera.** `sideDistX/Y` start at `(ex, ey)` = the slab entry (`t0`), and the shader used the accumulator directly as `t1` for the projected height `hb = leyeH + slope * t1`, the wall/step depth `bestT`, the plane guards `tp >= t0seg` and the `u/v` hit position. Inside a footprint `t0 == 0` hides it entirely (every gpucompare pose so far was inside, or looked away from the tower); from outside a structure was projected as if the camera stood at its edge: a wall 2 m inside the edge, seen from 80 m, was drawn as a wall 2 m away - hence "taller with distance", and a silhouette that changed with every step (the entry point moves with the camera). The CPU `ddaStep` recomputes `perpDist` from `posX/posY` every step and never had it: the Node probe puts the CPU silhouette exactly (0 rows) on the analytic projection at 200+ outside poses, so the earlier "CPU and GPU share the bug" reading was wrong - the two paths were never compared at an outside pose on a real GPU (the S6 note still says `NEEDS PC-A`). **Fix:** `sideDistX += t0; sideDistY += t0;` right after the accumulators are seeded (one line; `hitX/hitY`, `bestT`, `tp` comparisons all become camera-relative by construction). **Also:** `MAX_DIST` 120 -> 400 m (`sectorCaster.js`; the GLSL reads the same constant): at 120 m the tower vanished on both paths and, because terrain never draws inside a structure bbox, left a sky-coloured hole in the hills. The cap bounds *which* structures draw, not how many steps a column takes (the walk starts at the entry), so it costs nothing. **Regression test `engine/render/sectorCaster.silhouette.test.js` (permanent, in run-tests):** the real placed tower at the owner's two poses, a 20/40/80/120 m line west with the eye above and below z 0, a 12-point circle at 20/40/80 m and +-1 m moves; per column the topmost structure row must equal an analytic projection built from the level data alone (min over the crossed cells of the projected `floorH` top / numeric `ceilH`), the lowest row must respect the ring hand-off, the claimed column range must equal the footprint crossing; checked on the CPU caster AND on `glslTwin`, a literal JS transcription of `dda.frag.js` main() (n = 1). Parity is not evidence; the analytic projection is. Numbers (top row, 400x150): pose A 101/101, pose B 95/95, west 20/40/80/120 m 57/64/69/71 (CPU = GPU = analytic); before the fix the GPU twin put the top at row 0 at every one of those poses. **Follow-ups found on the way (both paths, content-visible, not this bug):** (e) the `[ceilH, topH]` upper band (tower `K` sun crack, 6.4 -> 8.0 m) is only drawn between two *numeric* ceilings, never from a sky-roofed neighbour - from the east you see sky through the wall above the crack (rows 73-76 at circle-20-az-90 col 202); fix = in the sky -> numeric-ceiling transition draw `GK_UPPER` for `[far.ceilH, far.topH]` when `far.topH > far.ceilH`, plus the GLSL twin. (f) `renderWorld`'s `fogFar` reads `palette.fog.far` (an object) so the `d > fogFar` cull never fires - harmless today (one structure), tidy when a second structure lands. (g) `?gpucompare=1` needs the two new outside poses (`outsideNear`/`outsideFar`, main.js) run on a real GPU once - the only thing the Node twin cannot prove is the compiled shader itself.

**Known limits (not this bug):** (a) a structure behind a *hill* still draws through it (claimed cells are never marched by the terrain pass); the principled fix is 14.4 item 1's `tMax = min(SDEPTH, ...)` clipped to the skip's `tIn` - US-026b when more structures arrive. (b) Solid outer ring seen from outside: CPU draws the face at the edge down to level height 0, GPU one cell deep - content convention is a non-solid outer ring (tower, `,`/`;` 2.4 m); `validate-content` could enforce it (PC-B). (c) A farther structure cast later reads the widened span and could redraw rows in a nearer structure's ring hand-off band - single-structure worlds today; add a depth test in `castColumn`'s emit with US-026b. (d) `?gpucompare=1` needs a real GPU run with an outside pose (23.6 `terrainNearTower`/`waystoneLookBack`, S6 adds them) - inside poses are untouched by construction (`t0 == 0`).

**S1-S5 review verdicts:** band centred on the *chunk* containing the placed-structures bbox centre (`World.load`): **ARCH OK** - the bound circle (r 96) lies fully inside the 384 m band with >= 32 m margin (band x 1280..1664, y 896..1280); optional for US-026b: centre on the bbox in 2 m cells to regain up to 64 m of margin. Slide skips the quick-stop decel (`integrate.js` `slideFreeze`): **ARCH OK** - with no wish left, `decelTime`'s snap-to-zero would cancel the slide accel every step; nice-to-have: still decay the cross-slope component. Terrain early-out after the hit test (`marchTerrainRay`): **ARCH OK** - strict superset ordering is correct (a hit at the same `t1` returns first). TLOOK texel 7 close glyphs + `TLOOK_WIDTH` 16: **ARCH OK** (stale comment in `terrain.frag.js` says "texels 8-11"; it is 8-15 - fix when next touched). FEAT folded into TLOOK texels 8-15 (chance, code0, code1, fi | fg) instead of a separate texture: **ARCH OK** - same "texel row per type", one texture unit fewer, `fi` salt shared with the JS oracle, gpucompare 27/27.

## 24. M1.5 editor, US-031 + US-032 (and the US-033/034 half they need): implementation notes (architect, 2026-09-25; D-010, D-023)

Normative for `tools/editor/`. Section 20 is the outline; where they differ this section wins. Written so PC-B's sonnet programmers can build it without asking. Everything here uses **only what `engine/index.js` exports today** (checked against the file on 2026-09-25); 24.12 lists the engine changes that would make it nicer, each with the workaround the editor uses until PC-A lands them.

### 24.1 Decisions (reasons inline)
1. **The document is the content JSON, the World is a view.** The editor edits the plain def objects the registry hands out (`assets.level('tower')` / `assets.world('world_m1')` return the stored references, so an in-place edit is what `World.load` reads next) and rebuilds the `World` after every committed edit with `World.load(assets.world(worldId), assets, { events })`. Measured: world_m1 + tower = **~1 ms warm** (6.8 ms cold), `serialize` 0.5 ms. No incremental world patching, no second data model, and save = `stringifyContent` of the same object. Live drags write the entity transform directly (24.8) and commit one command on drop.
2. **The editor never writes saves and never reads `WorldState`** (D-023 item 5). `serialize` is not used by the editor at all.
3. **Undo = per-item before/after records**, not `serialize()` snapshots (D-010 said snapshots; records are smaller, testable in Node without a World, and say exactly what changed). 50 steps.
4. **Coordinates:** level files hold **level-local** metres (`world - structure.origin`); `yawSteps` is always 0 in M1 (`placeStructure` throws otherwise), so local = world minus origin, no rotation. World files hold world metres. The panel shows world metres; the conversion lives in one helper (`toLocal/toWorld` in `doc.js`).
5. **GPU path required**; the CPU path is allowed with `?gpu=0` (dev only; PC-B's headless browser passes need it). On the CPU path surface picking reads `fb.gbuf` instead of the GPU readback: same decode, different source.
6. **Idle skip is the editor's frame budget:** a frame is rendered only when `dirty` is set (24.4). Idle JS <= 0.05 ms (one boolean test per rAF), idle GPU 0.

### 24.2 Files
```
tools/editor/index.html      canvas (tabindex=0) + side panel DOM (toolbar, outliner, properties, status); classic <script> tags = game/index.html's design/ list (24.3)
tools/editor/main.js         boot (24.3), engine.run wiring, key map, dirty flag, F3 overlay
tools/editor/frame.js        the frame sequence (24.4) - the US-046 workaround; deleted when createWorldRenderer lands
tools/editor/sprites.js      atlas + SpritePool + GpuSpritePass wiring (~25 lines, the tools-side twin of game/js/dev/spriteDev.js createSpriteSystem; the editor may NOT import game/)
tools/editor/camera.js       CameraPose data + fly controls (24.5); pure updateCamera(pose, input, dt, opts)
tools/editor/ray.js          cell <-> ray maths, planeId decode, ray/cylinder (24.6); pure, Node-tested
tools/editor/pick.js         pickAt(col,row) over the readback + entity list (24.6); browser only
tools/editor/doc.js          document model: files, envelopes, nextId minting, entity id <-> content item mapping, toLocal/toWorld (24.7)
tools/editor/commands.js     edit records over doc (24.8, 24.9); pure, Node-tested
tools/editor/undo.js         command stack (24.8); pure, Node-tested
tools/editor/select.js       selection state + highlight/marker drawing into rt/ui (24.7)
tools/editor/panel.js        DOM: outliner + property form generated from JSON (24.9)
tools/editor/io.js           stringify/validate/save/load/play-test handoff (24.10, 24.11)
tools/editor/*.test.mjs      Node tests (picked up by tools/run-tests.mjs)
```
Imports: `../../engine/index.js` only (check-deps rule 3 already covers `tools/**`). No `game/` import, no `design/` import (design stays classic scripts via tags). Add one check-deps rule (PC-B owns `tools/`): a file under `tools/editor/` must not import a path that resolves into `game/` (fixture in `check-deps.test.mjs`).

### 24.3 Boot (main.js)
```js
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('screen'); canvas.tabIndex = 0;
let bundle = null;
try { bundle = await loadContentPack('../../content/manifest.json'); }           // after US-027b
catch (e) { if (!(e instanceof ContentError) || !/HTTP 404/.test(e.message)) throw e; }  // before US-027b: no content/ yet
const assets = bundle ? AssetRegistry.fromJSON(bundle, window.ASSETS) : AssetRegistry.fromGlobals(window.ASSETS);
const doc = createDoc(assets, bundle, { worldId: params.get('world') || 'world_m1' });   // 24.7
for (const name of validateBehaviours(World.load(assets.world(doc.worldId), assets, {}))) registerBehaviour(name, () => {}); // the editor runs no behaviours; this silences the "not registered" warning
const engine = createEngine({ canvas, assets, cols: gridFromParam(params, 240), rays: 1, gpu: params.get('gpu') !== '0', inputTarget: canvas,
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 } });
```
- **`inputTarget: canvas`** is mandatory: `Input` calls `preventDefault()` on `KeyW/A/S/D/E/M/N/Space/arrows/F3` for its target; on `window` that would eat typing in the panel's inputs. The canvas takes focus on `mousedown`; the key map in `main.js` ignores editor keys while `document.activeElement` is an `input/textarea/select`. Add `canvas.addEventListener('contextmenu', e => e.preventDefault())`.
- **`rays: 1`**: the pick readback reads `texGI` (the resolved per-cell geometry); at n = 1 it is exactly the DDA output and the editor saves GPU time. (`?rays=2` allowed for a look check.)
- **Script tags:** copy `game/index.html`'s `design/` list. After US-027b the level tags (`test_room.js`, `tower.js`, `world_m1.js`) are gone from both pages; `overworld_far.js` stays (code). If a level tag is still present while `content/` exists, `fromJSON` throws "dual source" - that is the intended signal to fix the tag list.
- **US-027b not merged yet** (`content/` 404): the editor works on the `fromGlobals` defs. The doc layer wraps each def in the envelope itself (24.7), saving is **download-only** (never into `content/`; no dual source, D-023 item 4), and the status bar says `content: design/*.js (read-only source)`. Nothing else differs, so the flip needs no editor change.
- Then: `frame.js` setup (24.4), `engine.loadWorld(assets.world(doc.worldId))`, camera from 24.5, `engine.run({ update, render })`.
- **GPU gate:** if `rt.backend !== 'gl2'` or the pipeline is not `ready`, and `?gpu=0` is not set: show a DOM message "editor needs WebGL2 (use ?gpu=0 for the slow CPU path)" and do not start the loop.

### 24.4 Frame (`frame.js`) - the US-046 workaround
Setup mirrors `game/js/main.js` after the pipeline gate, minus quest UI: `matTable = bindShading(palette, detailPass, rt.pxCellH / rt.pxCellW)`, `gbuf = new GBuffer(cols, rows)`, `gpuPipeline = new GpuCellPipeline(rt, { rays: 1, terrainEnabled: true })` if `rt.backend === 'gl2' && detailPass && matTable.allV2 && candidate.ready`, then `bind(matTable, palette)`; `voxelPool = new VoxelPool(); voxelPool.bind(assets, matTable); gpuPipeline?.bindVoxels(voxelPool)`; `sprites = createEditorSprites({ assets, rt, gpuPipeline })`; `fb = { rt, depth: engine.depthBuffer, spans: engine.openSpans, palette, lights: null, light: makeLightBuffer(cols, rows), timeSec: 0, gbuf, matTable, detailPass, voxelPool, gpuDda: false, cpuLightCap: true, fadeLut: null, sceneFade: 1, terrainEnabled: true }`. On `world:loaded` (fired by `engine.loadWorld` and `engine.setWorld`): `for (s of world.structures) { bindLevel(matTable, s.level); repackMaterials(s.packed, s.level, matTable); }`, `lightSet = buildLightSet(world, palette)`, `dirty = true`. No live grid change in the editor (`?grid=` only), so no `grid:changed` handler.

Per frame (`render(alpha)`), in this order:
```
if (!dirty) return;                       // idle skip: no ui.clear, no present - the canvas keeps the last image
dirty = animate || (world.terrain && !world.terrain.farReady);   // keep going while the far bake or the anim clock runs
ui.clear();
if (world.terrain && !world.terrain.farReady) world.terrain.bakeFarStep(1);
copy the camera pose into cam (reused object); fb.timeSec = animTime; fb.lights = lightSet;
if (fb.lights) { syncEntityLights(fb.lights, world, palette, attachedLightPos, scratch3); fb.lights.update(fb.timeSec, world); }
fb.gpuDda = !!gpuPipeline && rt.gpuActive;
voxelPool.collect(world, cam); if (!fb.gpuDda) voxelPool.project(cam, rt);
renderWorld(fb, world, cam);
sprites.render(fb, world, cam);
drawMarkers(rt, ...); drawSelection(rt, ...); drawText(ui, ...) status line   // 24.7 - JS-written rt cells survive the GPU pass (bg.a mask; the eyelid uses the same route)
if (gpuPipeline) gpuPipeline.frame(fb, fb.lights || ambientL, cam, world);
rt.present();
copy pose into lastPresentedCam (the pick readback belongs to this pose)
```
`update(dt)` (fixed 60 Hz): camera step (sets `dirty` when the pose changed), key edits, `if (animate) { stepAnimations(world, dt*1000); stepSectorAnims(world, dt); animTime += dt; }`, `input.endFrame()`. **Animate** (toolbar toggle, default off) is the only thing that advances time; with it off, props hold their frame and torches do not flicker - that is what the idle-skip AC asks for. When US-046 lands, `frame.js` becomes `renderer.frame(world, cam, timeSec)` and the setup block goes away; keep it a self-contained module so the swap is one file.

### 24.5 Fly-cam (`camera.js`)
- `CameraPose = { x, y, z, yawDeg, pitchDeg }` (section 5 typedef; compass yaw 0 = N = -y, clockwise; z = eye). Saved as JSON in `localStorage['kestrel.editor.cam']` (debounced 500 ms) so a reload returns to the same view; the record also carries `fov: HFOV_DEG` for the AC's sake - the engine's FOV is a constant, the editor does not change it.
- `updateCamera(pose, input, dt, { speed, lookDx, lookDy })` is pure over `pose`: forward `W/S` along `(sin yaw, -cos yaw)`, strafe `A/D` along `(-dirY, dirX)`, `R/F` = up/down (world z), `Shift` x4, `Ctrl` x0.25; `speed` default 6 m/s, mouse wheel x1.25 per notch (0.5 .. 200). Look: while **RMB** is held, `canvas.requestPointerLock()` on the right `mousedown`, `document.exitPointerLock()` on `mouseup`; deltas from `input.consumeMouseDelta()` at 0.15 deg/px. Fallback when pointer lock is refused: raw `movementX/Y` while RMB is down. Pitch clamp = `Camera.clampPitch` (+-35, the renderer's y-shear limit; do not bypass). Returns `true` if any field changed -> `dirty = true`.
- No `PlayerLook` (it locks on left click, which the editor uses for picking), no `Player`, no physics, no gravity.
- Start pose: tower placement `s` -> `x = origin.x + level.width/2`, `y = origin.y + level.height + 10`, `z = origin.z + 8`, `yawDeg = 0` (looking north at the tower), `pitchDeg = -15`; overridden by the saved pose.
- `Home` = back to the start pose; `T` = teleport to the selected item (2 m south of it, looking at it).

### 24.6 Picking (`ray.js` pure + `pick.js`)
**Cursor -> cell.** `const r = canvas.getBoundingClientRect(); col = floor((ev.clientX - r.left) / r.width * rt.cols); row = floor((ev.clientY - r.top) / r.height * rt.rows)`; the canvas element covers exactly the glyph grid (RenderTarget fits it), so this is exact. The F3 line shows `cell (c,r)` and the hovered cell is outlined so the browser pass can verify it.

**Cell -> ray** (the exact inverse of `sprites.js` `camBasis` + `project`, and of the casters' camera plane):
```
tanHalfHFov = tan(HFOV_DEG*pi/360); dirX = sin(yaw), dirY = -cos(yaw); rightX = -dirY, rightY = dirX
screenAspect = (cols*rt.pxCellW)/(rows*rt.pxCellH); planeDistY = (rows/2)*screenAspect/tanHalfHFov
horizonRow = rows/2 + tan(pitch)*planeDistY
a  = (2*(col+0.5)/cols - 1)*tanHalfHFov            // lateral per metre of depth
dz = (horizonRow - (row+0.5))/planeDistY           // rise per metre of depth
point at perpendicular depth d:  x = cam.x + d*(dirX + rightX*a),  y = cam.y + d*(dirY + rightY*a),  z = cam.z + d*dz
```
"Depth" everywhere (DepthBuffer, GPU `Depth` texture, sprite depth test) is the **along-`dir` distance**, not the Euclidean one - use `d` directly. Node test: project a point with the sprite equations (`colCenter = (lateral/(depth*tanHalfHFov)+1)*cols/2`, `row = horizonRow - ((pz-cam.z)/depth)*planeDistY`), unproject with the formula above, expect the same point to 1e-9.

**Surface under the cell (click only, never per frame).**
- GPU path: `const { GI, Depth } = gpuPipeline.readbackGeometry()` right after the click (the last `present()`'s pose is `lastPresentedCam`; if the pose changed since, render one frame first). Index `i = row*cols + col`, same layout as `gbuf` (row 0 = top; `gpuCompare.js` compares the two 1:1). `planeId = GI[i*4] | 0`, `kind = GI[i*4+1] & 0xff`, `face = (GI[i*4+1] >>> 8) & 0xf`, `mat = GI[i*4+1] >>> 16`, `depth = f32(Depth[i*4])` (`new Float32Array(Depth.buffer, Depth.byteOffset + i*16, 1)[0]`, or a `DataView`). `readbackGeometry` is documented "test-only" because of the frame-loop stall rule; a click is not the frame loop. Cost at 240x90: 3 x 345 KB, 1-3 ms. This is the workaround for 24.12 item 1.
- CPU path (`?gpu=0`): `fb.gbuf.kind[i] / planeId[i] / face[i]`, `fb.depth.depth[i]`.
- Decode (`decodePlaneId(kind, planeId)` in `ray.js`): `kind === 0` -> sky (depth Infinity); `kind === KIND_TERRAIN (7)` -> terrain (`PLANEID_TERRAIN`); `kind === KIND_MODEL (8)` with `(planeId >>> 28) === 0xF` -> **voxel instance slot** `(planeId >>> 24) & 0xF` (the JS `castModels` and `voxel.frag.js` both pack it that way); else structure: `structSeq = (planeId >>> 28) & 7` -> `world.structures[structSeq]` (structSeq is the index into `world.structures`), `tag = (planeId >>> 24) & 0xF`. Do not decode the low 24 bits (their meaning differs per plane type); compute the hit point from `d` and take the level cell from it: `local = hit - origin`, `cell = floor(local)`; for wall kinds (1 wall, 2 step, 3 upper) use `d + 0.01` so the point lies inside the solid cell. Kind codes 1-6 are not exported yet (24.12 item 4): hard-code them in `ray.js` with the comment `// engine/render/GBuffer.js KIND_*`.
- Voxel slot -> entity: `voxelPool.list[slot]` holds `x, y, z, modelKey`; match the entity with `components.voxel` whose `transform.x/y/z` are `===` (same numbers, same source); two coincident props -> first wins, `console.warn`.

**Entities without an id channel (billboard sprites) and the no-GPU fallback:** `rayPickEntities(ray, entities, assets, maxDepth)` in `ray.js`: for every entity with `components.sprite` (radius `m.world.w/2`, height `m.world.h`, `m = assets.model(key)`; a numeric variant is the key `model#n`) or `components.voxel` (`v = assets.model(key).voxel`: radius `max(v.size[0], v.size[1]) * v.cellM / 2`, height `v.size[2] * v.cellM`; feet at `transform.z`), intersect the ray with the vertical cylinder around `(t.x, t.y)`: 2D quadratic in the horizontal ray components, then `t.z <= z(d) <= t.z + h`; keep the smallest `d` with `d < surfaceDepth - 0.05` (not behind the wall the surface pick found). Priority: voxel-slot hit (exact) > ray-cylinder entity hit > surface. Node test: hit, miss, occluded, nearest of two wins.

**Markers (lights, triggers, interactables, player spawn)** are drawn by the editor (24.7) and picked by their marker cell: `pickMarkers(col, row)` returns the marker whose projected cell is within 1 cell and whose depth is < the surface depth at that cell.

**Result:**
```js
/** @typedef {{ kind:'sky'|'terrain'|'surface'|'entity'|'marker', col:number, row:number, depth:number,
 *   world:{x:number,y:number,z:number}|null, structureId:string|null, cell:{x:number,y:number}|null,
 *   face:number, planeId:number, entityId:string|null, marker:{fileId:string,collection:string,id:string}|null }} PickResult */
```
Hover picking is **off** (a readback per mousemove would stall); the only per-frame cursor work is the hovered-cell outline.

### 24.7 Document model, selection, markers (`doc.js`, `select.js`)
- `doc.files: Map<fileKey, { kind:'level'|'world', id, def, meta:{ schema, nextId, url|null }, dirty:boolean, handle:FileSystemFileHandle|null }>`, `fileKey = 'level/tower'`. With a bundle, `meta` comes from `bundle.meta[kind][id]`; with `fromGlobals`, `schema = LATEST_SCHEMA[kind]`, `nextId = 1 + max n over ids matching /_(\d+)$/ in ID_COLLECTIONS[kind]`, else 1 (21.9). `def` **is** the registry's object (`assets.level(id)`), never a copy.
- `mintId(file, type)` -> `` `${type}_${file.meta.nextId++}` `` (21.3; never reused; `nextId` is written back on save).
- **Selection item** = `{ fileId, collection, id }` for content items (`level/tower`, `props`, `brazier`) or `{ fileId:'world/world_m1', collection:'entities', id }`. From a picked entity id: for each `world.structures[k]`, if `entityId.startsWith(s.id + '.')` -> file `level/${s.level.name}`, collection `props`, id = the rest (local ids never contain `.` or `/`, 21.3); otherwise a world entity (`player`, `farTower`). Reverse (item -> runtime): `${structureId}.${propId}` for props; lights/triggers/interactables have no entity (they live in `lightSet` / `world.triggers` / `world.interactables`) and are addressed by content id only.
- `player` is selectable, movable only if it has a `transform`; a `spawn: { structure, from: 'start' }` entry is read-only in M1.5 (the panel says so). `farTower` (billboard, inline `x/y/z`) is movable.
- **Highlight** (`select.js`, drawn into `rt` cells before `present()`, so it works on both paths): the selected entity's screen rect from the 24.6 projection (`world.w/h` for sprites, the voxel box for voxels), drawn as a bracket of `+ - |` in `palette.colors[palette.ui.crosshairActive]` on the corners and edges just **outside** the rect (the GPU sprite pass composites after the cell pass and would overwrite cells inside). **Markers** (toggle `M`, default on): `*` at each light (fg = the preset's colour, dim when `on: false`), `o` at each interactable centre plus its radius ring at floor height every 45 deg, trigger cells / circle outline as `.` at `zMin ?? floor`, `@` at the player spawn. Markers are editor overlays drawn without a depth test (they are meant to show through walls); cap 200 cells per frame. A selected marker uses the highlight colour.
- **Outliner** (DOM list): every item of every file grouped by collection, with id and model/preset/type; click = select, double-click = teleport. It is the fallback when picking is off and the only way to select `triggers` with `cells`.

### 24.8 Edits (`commands.js`, `undo.js`) - US-032
Record shape (pure data; `applyEdit(doc, rec)` and `invert(rec)` are pure functions over `doc`):
```js
/** @typedef {{ label:string, fileId:string, collection:string, id:string, index:number|null, before:Object|null, after:Object|null }} EditRecord */
// before==null -> insert `after` at index (append when null); after==null -> remove (index remembered); else replace the item's fields in place
// invert(rec) swaps before/after (undo); before/after are structuredClone'd once when the record is made
```
- `undo.js`: `createStack(cap = 50)` with `push(rec)`, `undo() -> rec|null`, `redo() -> rec|null`, `canUndo/canRedo`, `clear()`; a `push` after `undo` drops the redo tail; the oldest record falls off at `cap`. Pure, Node-tested.
- The one mutation path in `main.js`: `commit(rec) { applyEdit(doc, rec); stack.push(rec); file.dirty = true; rebuild(); }`; undo/redo call `applyEdit(doc, invert(rec))` / `applyEdit(doc, rec)` then the same `rebuild()`. `rebuild()` = `engine.setWorld(World.load(assets.world(doc.worldId), assets, { events: engine.events }))` (emits `world:loaded` -> 24.4 rebinds) + re-resolve the selection by id (old handles are dead) + `dirty = true`. Budget <= 5 ms per commit.
- **Move (nudge):** arrows = world +-x/+-y, `PgUp/PgDn` = +-z, step = the snap (`[`/`]` cycle 0.05 / 0.25 / 0.5 / 1 m, default 0.25, shown in the status bar). `after` = the item with `x/y/z` set to `round((world +- step) / snap) * snap`, converted to local; `-0` normalised to `0`.
- **Move (drag):** LMB down on the selected entity starts a drag on the horizontal plane `z = t.z`: per mousemove `d = (t.z - cam.z) / dz` (skip when `|dz| < 1e-4` or `d <= 0`), new `x/y` from the ray at `d`, snapped; written straight into `handle.data.transform` plus `world.renderVersion++` (the sprite/voxel pools cache the entity list by `renderVersion` and read transforms live) and `dirty = true`; **no rebuild per frame**. On mouseup: one `EditRecord` (before = the def item, after = the item with the final local x/y). `Esc` during a drag restores the start transform (no record).
- **Drop to floor `G`:** `z = world.floorAt(x, y)` (structure floor incl. `origin.z`, else terrain height; `null` = leave it); props whose `z` is the string `'ground'` are left alone (the panel shows it).
- **Yaw `Q/E`:** +-45 deg on `facing` (props) / `yawDeg` (world entities), normalised to `[0, 360)`.
- **Delete `Delete`/`Backspace`:** record with `after: null`, `index` = the item's array index so undo reinserts at the same place (array order is runtime-visible, 21.6). Deleting a prop that interactables reference via `prop`/`flameProp` is **refused** with a status message naming the referrers (the loader would reject the file); the user deletes those first.
- Lights, triggers, interactables use the same records (their collections in the level file); a moved light shows up after `rebuild()` because `buildLightSet` runs on `world:loaded`.

### 24.9 Place + property panel (`panel.js`, `commands.js`) - US-033 scope, same notes
- **Place:** `1` prop, `2` light, `3` trigger, `4` interactable, then click a surface (the pick's `world` point; a `cell` inside a structure -> that level file; outside a structure -> the world file's `entities` for props, refused for the level-only kinds). Defaults: prop `{ id: mintId('prop'), model: <picker>, x, y, z, facing: 0 }` (model picker = `assets.keys('model')`; voxel vs billboard is decided by `World.load` from the model, not by the editor); light `{ id: mintId('light'), preset: 'torch', x, y, z: z + 1.2, on: true }` (presets = `Object.keys(palette.lights)` minus `ambient`/`sun`; refuse the 17th light, `MAX_LIGHTS` = 16); trigger `{ id: mintId('trigger'), type: 'zone', shape: 'circle', x, y, r: 1.5, zMin: z - 0.5, once: false, trigger: '' }`; interactable `{ id: mintId('interactable'), x, y, z, radius: 1.5, prompt: '[E] Use', interact: '' }`. Every placement is one `EditRecord` (before = null).
- **Property panel:** a form generated from the item's JSON: `number` -> `<input type=number step=snap>`, `string` -> text, `boolean` -> checkbox, arrays/objects (`cells`, `requires`, `target`, `walkTo`) -> a JSON `<textarea>` parsed on blur. Behaviour fields (`interact`, `trigger`) are a `<datalist>` of every name found in the loaded content (no public "list registered behaviours" yet, 24.12 item 5) plus free text. Each committed field = one `EditRecord` (before/after = the whole item). Validation before commit, shown inline, never committed when invalid: finite numbers only, id matches `^[A-Za-z][A-Za-z0-9_-]*$` and is unique in its collection, `model` passes `assets.has('model', key)`, `preset` in `palette.lights`, `r > 0`, `zMin < zMax` when both exist, and the file must still pass `validateDoc` (24.10). An `id` change rewrites `REF_FIELDS` referrers in the same file inside the same record.

### 24.10 Save / load (`io.js`) - US-034 scope, same notes
- **Serialise one file:** `toFileObject(file) = { kind, schema, id, nextId, ...def }` -> `stringifyContent(obj)` (21.6: byte-stable, key order from `KEY_ORDER`, arrays in place). Node test: `stringify(parse(stringify(x))) === stringify(x)` on the tower def after a scripted edit sequence, and undo-to-start gives bytes identical to the untouched def.
- **Validate before save** with the engine loader, no new validator: `validateDoc(files) -> Promise<ContentError|null>` builds an in-memory pack (`manifest.json` = `{ kind:'manifest', schema:1, id:'editor', contentVersion:0, files:[...] }` plus one entry per file) and calls `loadContentPack('http://editor.invalid/manifest.json', { fetchText: (u) => mem.has(path(u)) ? Promise.resolve(mem.get(path(u))) : Promise.reject(new Error('HTTP 404')) })` with `path(u) = new URL(u).pathname.slice(1)`. Cross-file refs (`structures[].level`, `world.terrain`) are checked by a `World.load` into a throw-away world. The Save button is disabled with the error text while invalid.
- **Save (Ctrl+S / button):** for every dirty file: if `window.showSaveFilePicker` exists and the file has no handle -> `showSaveFilePicker({ suggestedName: `${id}.${kind}.json`, types: [{ description: 'Kestrel content', accept: { 'application/json': ['.json'] } }] })`, keep the handle on the file for the session (IndexedDB persistence of handles is optional polish); write with `handle.createWritable()` -> `write(text)` -> `close()`. Fallback (no FSA API, or the picker was cancelled): `Blob` + `<a download>`. Before US-027b (24.3): download only. After a successful write `dirty = false`. `beforeunload` warns while any file is dirty.
- **Load:** `showOpenFilePicker` (or `<input type=file>`), `JSON.parse`, `migrateContent(kind, obj, name)`, then `validateDoc` with this file substituted; on success replace the registry object **in place** (`for (k of Object.keys(target)) delete target[k]; Object.assign(target, defWithoutEnvelope)`) so every reference stays valid (workaround for 24.12 item 6), update `meta`, clear the undo stack, `rebuild()`.
- The editor edits `world_m1` + `tower` (+ `test_room` via `?world=`); `overworld_far` (terrain) is code and is never a document.

### 24.11 Play-test (`P` / button) and the game hook
- The editor writes `localStorage['kestrel.playtest'] = JSON.stringify({ savedAt: Date.now(), world: doc.worldId, files: { 'level/tower': def, 'world/world_m1': def } })` (defs **without** envelope, every document of the loaded world, dirty or not) and opens `../../game/index.html?playtest=1&world=<worldId>` in a new tab. No server write, works before saving, survives the tab boundary (sessionStorage would not, reliably).
- **Game hook (PC-B may add it; `game/js/main.js` bootstrap area only, <= 10 lines + one small module):** `main.js` has no `?world=` today; it reads `assets.world('world_m1')` or builds an ad-hoc world for `?level=`. Add `game/js/dev/playtest.js` exporting `applyPlaytestOverlay(target)`: when `params.get('playtest') === '1'` it reads the key (through `game/js/platform/` once US-060 has landed - add `readPlaytest()` there so US-060's "no direct localStorage" grep stays true; until then a direct read inside `dev/playtest.js`) and does `target.levels[id] = def` / `target.worlds[id] = def` per file. Call it on `window.ASSETS` right before `AssetRegistry.fromGlobals` (today) or on `bundle` right before `AssetRegistry.fromJSON` (after US-027b). Then `assets.world(params.get('world') || 'world_m1')` at the existing `assets.world('world_m1')` line. The game persists nothing; the key stays so a reload replays the same edit. `?gpucompare=1` and the bench never set `playtest`, so parity is untouched.

### 24.12 Engine changes that would make this nicer (PC-A; the editor does not wait for any of them)
1. `gpuPipeline.pickCell(col, row) -> { planeId, kind, face, mat, depth }` (1-pixel `readPixels` of GI + Depth). Workaround: `readbackGeometry()` on click (24.6).
2. Entity id channel for sprites, and `entityId` on `voxelPool.list[]` entries. Workaround: ray/cylinder + voxel slot matching (24.6).
3. `createWorldRenderer` (US-046) / `engine/dev.js` (US-047). Workaround: `frame.js` + `sprites.js` (24.4); nothing the editor imports is missing from `engine/index.js` today.
4. Export `KIND_NONE..KIND_CEIL` from `engine/index.js` (only `KIND_TERRAIN`/`KIND_MODEL` are). Workaround: numeric constants in `ray.js`.
5. `listBehaviours() -> string[]` in `engine/core/behaviours.js`. Workaround: names harvested from content (24.9).
6. `AssetRegistry.replace(kind, key, def)`. Workaround: in-place object replace (24.10).
7. `World.placeStructure` with `yawSteps`, `moveStructure/removeStructure`: out of M1.5 (D-010); structures are read-only in the editor.
Route: the main session opens one PC-A row "US-031-engine: pickCell + id channel + KIND exports + listBehaviours + AssetRegistry.replace" when PC-A has capacity; the editor swaps its workarounds file by file.

### 24.13 Build order (each step ends with a green Node test where one is listed; one browser pass per story on a 95xx port, stop only that server)
**US-031 (viewer):**
- S1 `index.html` + `main.js` boot (24.3) with the content fallback; the tower shows from the start pose on one rendered frame. Test `doc.test.mjs`: envelope/nextId from a `fromGlobals` def follows 21.9 (nextId 1 for the tower today), `fileKey` mapping, `toLocal/toWorld` round trip.
- S2 `frame.js` + `sprites.js` (24.4): the tower renders like the game at the same pose (eyeball: sprites, voxels, lights, terrain, far tower).
- S3 `camera.js` (24.5) + `camera.test.mjs`: WASD/RF vectors for yaw 0/90/180/270, Shift/Ctrl factors, pitch clamp, `changed` false when nothing is pressed.
- S4 Idle skip + Animate toggle; F3 overlay (`DebugOverlay`) with fps, frame ms, a `presented N` counter, cell under cursor. Probe: mouse still and Animate off -> `presented` stops increasing; the far bake still finishes (terrain fills in) and then stops.
- S5 Saved camera pose, `Home`, GPU gate message, `?gpu=0` renders.
- S6 Browser pass: `http://localhost:95xx/tools/editor/index.html` - fly around and inside the tower at 60 fps (F3), idle = 0 presents, `?grid=320x120` works, console clean. `node tools/run-tests.mjs` + `node tools/check-deps.mjs` green. Status -> `po-review`.

**US-032 (pick/select/move/delete):**
- S1 `ray.js` (24.6) + `ray.test.mjs`: unproject/project round trip; `decodePlaneId` for structure/terrain/voxel/sky; ray-cylinder hit/miss/occluded/nearest.
- S2 `pick.js` on the GPU readback and the CPU gbuf; the status bar prints the `PickResult` on click; hovered-cell outline. Probe: clicking a tower wall reports `structureId 'tower'`, a plausible `cell`, and a `depth` within 2 % of the distance read off the pose.
- S3 `doc.js` mapping + `select.js` highlight/markers + outliner (24.7). Click a prop -> highlighted and selected in the outliner, and vice versa.
- S4 `commands.js` + `undo.js` (24.8) + `commands.test.mjs` / `undo.test.mjs`: nudge/yaw/drop/delete/insert records over a fixture level def; undo returns a deep-equal def; delete reinserts at the same index; cap 50 drops the oldest; push after undo clears redo; delete with referrers is refused.
- S5 Wire nudge/drag/yaw/drop/delete + `rebuild()`; drag = live transform, one record on drop; `Esc` cancels a drag.
- S6 Browser pass: select the brazier, drag it 2 m, undo, redo, yaw the lever, drop a lantern to the floor, delete a rubble prop and undo it; nothing throws, `rebuild` <= 5 ms in F3, `?gpu=0` picking agrees with the GPU path on 3 clicks. Status -> `po-review`.

**US-033/034 (if the weekend allows, same notes):** place + panel (24.9; tests: validation table, id rename rewrites referrers) -> save/load (24.10; tests: byte-stable round trip, `validateDoc` catches a broken ref) -> play-test hook (24.11; browser: edit, `P`, the game shows the edit).

### 24.14 Budgets and do-nots
- Idle: one boolean per rAF, no `ui.clear`, no `present`, no readback. Active frame: the game's budgets (JS <= 8 ms, GPU <= 4 ms at 240x90). Click pick <= 5 ms. `rebuild()` <= 5 ms. Per-frame allocations only in `panel.js` (DOM); `frame.js`, `camera.js`, `select.js` reuse their scratch objects (rule 9).
- **Do not:** import `game/` or deep `engine/**` paths; call `readbackGeometry` outside a click; run `World.load` per frame or per mousemove; keep a second copy of any def (the registry object is the document); write into `content/` before US-027b is merged; write saves (`WorldState`) from the editor; sort arrays or reorder collections; mint ids any other way than `nextId++`; change `HFOV_DEG` or bypass `Camera.clampPitch`; use `PlayerLook` or `Player`; `preventDefault` keys while a panel input has focus; touch `design/` files.

----
## 25. Ray-traced lighting estimate (US-070..073) (architect, 2026-09-26; owner request "RTX look" on WebGL2 / Intel iGPU)

"Ray tracing" here = deterministic rays marched in our own fragment shaders over data we already upload (sector grid `uWorldGeom/uWorldFlags`, voxel `VOX/VOXINST`, terrain `NEARH/FARH`), **one ray set per cell** (the `light` pass is per cell, never per sub-sample), no noise, no denoiser. Hard deterministic per-cell answers suit a glyph grid better than stochastic RT + temporal denoise.

**25.0 Baseline (what exists, what is missing, headroom).**
- Sun: sector shadows exist (14.3 item 4, height-correct walk, both paths). Missing: voxel props cast no sun shadow (15.3 item 2); terrain cells (kind 7) skip the sun ray, so the tower casts **no shadow on the grass** (23.4; D-007 "no terrain shadow rays in M1/M2").
- Point lights: `LVIS` 2D grid (14.3 item 5): 1 m cell-quantised, tested at the *light's* height only (a step block or crate lower than the lamp never shadows the floor behind it), voxels never block, 16 m clamp.
- Owner hardware (Intel iGPU, 2026-09-25 bench): 320x120 GPU p95 ~2.0-2.4 ms (headroom ~1.6 ms); **400x150 ('normal' grid, D-025) walk p95 3.08 ms (headroom ~0.9 ms)**; `light` pass 0.25 ms at 480x180 (~0.11 / 0.17 ms at 320x120 / 400x150). From the existing sun DDA: about **0.4 ns per DDA step (2 fetches) per cell** (~2.5 G steps/s). All estimates below use it: typical scenes, owner iGPU, +-50 %.

**25.1 Shared building block `segBlocked` (one function, three consumers: sun, point lights, terrain-sun).**
```
// GLSL chunk in common.js (string-included into light.frag); JS twin in engine/render/shadowRay.js (new, pure, Node-tested)
bool segBlockedSectors(vec3 S, vec3 E)          // 2D DDA along S->E in xy, z linear in t. Per cell, z range [zMin, zMax] over its t-interval:
                                                //   blocked iff zMin < C.floorH || (!C.ceilSky && zMax >= C.ceilH && zMin <= C.topH)
                                                //   = the 14.3 item 4 sun rule generalised to rays that go down; world coords + findStruct (US-007 amendment);
                                                //   outside every footprint never blocks; MAX_SHADOW_STEPS = 48 (bias lit); heights level-local (h - origin.z)
bool segBlockedVoxels(vec3 S, vec3 E, int mask) // per instance bit: slab vs world AABB (VOXINST header), then per part the voxel.frag Amanatides-Woo in
                                                //   part-local space (oL/A rows exist), ANY-hit, t in (eps, 1). Extract marchVoxelPart() from voxel.frag
                                                //   into common.js; voxel.frag calls the same function (its gpucompare poses must stay identical)
sun: !segBlockedSectors(S, S + sunDir * tSun) && !segBlockedVoxels(S, S + sunDir * tSun, uSunVoxMask)   // tSun = until h > worldMaxH (existing exit)
```
JS: `shadowRay.js` exports `segBlockedSectors(world, S, E)`, `segBlockedVoxels(pool, S, E, mask)` (reuses `engine/voxel` `marchVoxelRay` with `tMax` + an any-hit flag); module scratch only. `lighting.js` `sunVisible` becomes a wrapper (export kept). The JS is the oracle; the GLSL never invents a rule the JS lacks (14.3 item 7).

**25.2 US-070 ray-traced shadows.**
- *Pass:* `light` (GLSL) / `lightSurfaces` (JS). No new pass or target. `LIGHT.w` gains `shadowMask << 16` (bit per light slot 0..15 that was ray-tested and blocked) for `?debug=shadow` and parity.
- *Point lights:* per cell compute all contributions as today, pick the **top K = 2 by `col * falloff * N.L`** (tie -> lower index) and trace `segBlocked*(S, L)`; other lights keep `LVIS`. Ray target = the **unjittered** light position (jitter would make every shadow edge crawl; intensity flicker stays). `S` = BUG-LIGHT-001 nudge (0.02 m toward the light); kind 8 samples nudge `0.6 * cellM` along N (voxel self-shadow acne).
- *Off-screen voxel casters:* `VoxelPool.project` drops instances with an empty rect, but an off-screen burner must still shadow the visible floor. Add `shadowCount`: instances within 24 m of the eye with an empty rect are appended after the visible ones (`uVoxCount` = visible, `uVoxShadowCount` = total <= 16; the voxel pass stops at `uVoxCount`). Per light a 16-bit `uLightVoxMask[i]` (instance AABB intersects the light sphere) and `uSunVoxMask`, built in `project` without allocation. `castModels` consumes the same list (parity by construction, 15.2 item 2).
- *Terrain:* (070b) kind-7 cells run the sun `segBlockedSectors` + voxel test after a slab test vs the placed structures' bboxes (most rays miss and cost one test); the result is the existing sunlit bit of `LIGHT.w`, and the kind-7 shade branch (23.4) multiplies its `sunI` term by it (both paths). (070c) terrain self-shadow (hills): sun march over `NEARH`/`FARH` nearest texel, step `max(2, 0.05 t)` m, <= 32 steps, exit above `uTerrainMaxH`. Point lights never march terrain.
- *Soft (070d):* 3 targets per ray on a disc of radius `light.size` (new preset field, default 0) perpendicular to S->L, fixed pattern -> vis in {0, 1/3, 2/3, 1}; the glyph ramp draws the penumbra. Sun: 2 extra rays at +-`sun.spread` degrees.
- *Parity:* `?gpucompare=1` adds `shadowFlip` (cells whose `shadowMask` differs, float32 boundary flips like `litFlip`) <= 0.5 % of lit cells; sunlit mismatch <= 0.5 % now including kind 7/8. New poses: `lamp behind step block` (the case LVIS gets wrong), `burner shadow on floor` (voxel caster), `lever in sun shaft` (voxel sun caster), `burner off screen`, `tower shadow on grass` (070b, reuse `terrainNearTower`), `hill shadow` (070c). `?shadows=grid` = today's LVIS path (regression + owner A/B). Node: `shadowRay.test.js` (step block between lamp and floor blocks at the geometric boundary; slab overhang; downward ray from a ceiling sample; any-hit through a rotated voxel part; mask excludes an instance; zero alloc), `lighting.test.js` top-K determinism.
- *CPU fallback (no GPU, 160x60):* stays on `LVIS` (rays for 4 lights x 9.6k cells ~10 ms JS). The gpucompare oracle runs the ray path (D-017: correctness, no budget).
- *Cost (GPU, added to the light pass):*

| Slice | 320x120 | 400x150 | worst case (caps) |
|---|---|---|---|
| 070a sun + top-2 point rays, sectors + voxels, hard | +0.25-0.35 ms | +0.4-0.55 ms | 2 rays x 34 steps on every cell: ~1.6 ms @400x150 |
| 070b structures shadow terrain (sun) | +0.05 | +0.08 | +0.2 |
| 070c terrain self-shadow (sun) | +0.15-0.2 | +0.2-0.3 | +0.6 |
| 070d soft (x3 rays) | +0.5-0.7 | +0.8-1.1 | over budget |

- *Risks:* (1) 400x150 headroom: 070a uses about half of it; a+b fit, c+d do not without a quality switch (25.7 B). (2) Divergence on Intel where neighbouring cells pick different top-2 lights; constant loop bounds, K fixed. (3) Acne at voxel faces and wall/floor seams (nudges above); parity proves the paths agree, not that it looks right: owner walk-check. (4) Shadow pop when a 17th+ instance is dropped (nearest 16 win, warn once, 15.3 item 1). (5) This supersedes 14.3 item 9 "do not walk LOS to point lights in the shader" for the top-K rays only.
- *Size:* US-070 as a whole **L**; split 070a **M**, 070b **S**, 070c **M** (needs 25.7 A), 070d **M** (needs 25.7 B).

**25.3 First slice = US-070a (one programmer story).** Sun ray + top-2 point-light rays per cell, hard, **sectors + voxel props only**, no terrain, `?shadows=grid` kept. Steps, each ending with a green Node test: (1) `shadowRay.js` `segBlockedSectors` + `sunVisible` wrapper (existing `lighting.test.js` sun cases unchanged); (2) `marchVoxelRay` tMax/any-hit, `segBlockedVoxels`, masks + `shadowCount` in `VoxelPool.project` (zero-alloc test); (3) `lightSurfaces` top-2 selection + `shadowMask`; (4) GLSL: `marchVoxelPart` extracted into `common.js`, `segBlocked*` chunk, light program binds `VOX`/`VOXINST` (8 texture units), new uniforms; (5) gpucompare poses + `shadowFlip` line + `?debug=shadow`; (6) one browser pass, then owner `?bench=1` at 320x120 and 400x150. **Gates:** gpucompare all poses PASS; `light` pass p50 <= 0.6 ms at 400x150 on owner hardware; whole GPU p95 <= 4 ms at 400x150; `?flicker=1` changed-glyph share at most 1 point worse than `?shadows=grid`; JS hook +<= 0.05 ms. Steps 1-3 are PC-B-able; 4-6 PC-A.

**25.4 US-071 ray-traced AO.** Sector seam AO exists analytically (`aoD`, 8.1). Missing: contact darkening from voxel props, under overhangs/slabs, beside step blocks. In the `light` pass; AO quantised to 7 bits in `LIGHT.w` bits 1..7; `shade` multiplies **ambient + bounce only** (never direct light) by it. (a) Floors/tops (kind 4/5): **horizon AO over the sector grid**, 4 directions x 2 cells (one `fetchCell` each), horizon from `floorH`/`ceilH` differences, `ao = 1 - k * mean(sin horizon)`; cell-exact JS twin. (b) All kinds except 7: analytic occlusion from the <= 16 voxel AABBs within 2 m (sphere of equal volume, `ao *= 1 - (r/d)^2 * max(0, N.dir)`), no voxel march. Walls keep `aoD` for seams (no double darkening). Parity `|dAO| <= 2/255`. **Cost:** 320x120 +0.08-0.12 ms, 400x150 +0.12-0.2 ms. Risks: double darkening against `aoD` and detail tones (designer `shadetest` check). **Size M.**

**25.5 US-072 one-bounce coloured light = virtual point lights (VPL).** Per-cell bounce gathering (many rays + denoise) does not fit an iGPU; VPLs do and stay deterministic. CPU (`engine/render/bounce.js`, pure, Node-tested): per `on` point light, 12 fixed directions (8 horizontal at 45 degrees, 2 at +-45 elevation, up, down) marched to the first sector/voxel hit within `radius` (`firstHitSectors` next to `segBlockedSectors` in `shadowRay.js`); each hit -> VPL `pos = hit + N * 0.3`, `col = lightCol * falloff(dHit, r) * albedo(mat) * gain / 12`, `radius = min(3, 0.5 r)`, cosine lobe around N. `albedo(mat)` = new `MaterialTable.bounceRGB` (mid-level tone of the v2 record, computed at bind; designer override `detailPass.materials[k].bounce`); `gain` from palette `lights`. Recompute keys = the LVIS keys (unjittered light cell, `structVersion`, `packed.version`); flicker scales VPL colour per frame. Optional step 2: sun bounce, sunlit floor cells of the structure (1 m grid, on sun change) clustered into <= 8 VPLs. GPU: `uVplPos[32]`, `uVplCol[32]` (64 vec4, light program stays well under 224 fragment vectors), constant-bound loop, **unshadowed**. Parity `|dL| <= 1e-3` (14.3 item 7). **Cost:** 320x120 +0.04-0.06 ms, 400x150 +0.06-0.1 ms; JS <= 0.05 ms only on key change. Risks: leaks through 1-cell walls (short radius + lobe; owner check), hot corners (designer tunes `gain`), VPL pop when the lantern crosses a cell edge (fade old/new set over 150 ms in JS). **Size M.**

**25.6 US-073 temporal glyph stability.** New pass `stable` after `edge`, before sprites (sprites/UI never enter history: no ghosting on billboards). History = last frame's `(glyph, fg, bg)` + `(kind, planeId, u, v)` in a ping-pong pair (<= 1 MB at 400x150). Per cell: reproject the current world point (`cellRayP(depth)`) with the previous camera uniforms; accept history only if kind and planeId match and `|dUV| < 0.5 / detail`; then (a) keep the previous glyph when the new one is within one ramp level, (b) fg/bg `mix(prev, cur, 0.5)`, snap when a channel differs by > 48 (light toggled, door moved). History off for: yaw change > 3 degrees since the last frame, teleport, `setGrid`, edge cells (`rule != 0`, always recomputed), kind 8 of playing animations. JS oracle `stabilizeCells(prev, cur, prevCam, cam, out)` in `engine/render/stable.js`; parity = a scripted 2-frame sequence in `?gpucompare=1` (glyph >= 99 %); all other poses run `?temporal=0` so existing thresholds keep their meaning. Determinism becomes "**same input sequence -> same frame sequence**" (render-only state, never saved; architect rule). Gate: `?flicker=1` changed-glyph share down >= 40 % on strafe/forward with no visible smear (owner walk-check). **Cost:** 6-8 fetches per cell: 320x120 +0.05-0.08 ms, 400x150 +0.08-0.12 ms. Risks: smear/sticky glyphs (subjective tuning), VRAM. **Size L** (tuning, not code).

**25.7 Order, totals, who, decisions.**
- Order: **070a** (M) -> **070b** (S, after decision A) -> **072** (M) -> **073** (L; also damps the new shadow/bounce edges) -> **071** (M) -> 070c/070d only under decision B.
- Typical totals a+b+072+073+071: **320x120 +0.45-0.65 ms** (p95 ~2.7-3.0 ms, fits); **400x150 +0.75-1.05 ms** (p95 ~3.8-4.1 ms, at the 4 ms line).
- **PC-B-able (sonnet, Node-only, from these notes):** `shadowRay.js` + tests, `marchVoxelRay` any-hit + masks/`shadowCount`, `lightSurfaces` top-K (25.3 steps 1-3); `bounce.js` + `MaterialTable.bounceRGB` (25.5 CPU half); AO JS twin (25.4); `stable.js` oracle (25.6). **PC-A only:** all GLSL (`common.js`, `light/voxel/shade.frag`, the `stable` pass), `GpuCellPipeline` bindings/uniforms, gpucompare poses and thresholds, owner-GPU benches, architect review per step.
- **Do not:** trace per sub-sample; use noise, `Math.random` or frame-count hashes in ray patterns; aim rays at the jittered light position; march terrain for point lights; let the CPU oracle differ from the GLSL; delete `LVIS` (fallback + A/B); put temporal history into saves.
- **ESCALATE TO MANAGER:** (A) **D-007 amendment** ("no terrain shadow rays in M1/M2"): (1) allow structure->terrain sun shadows only (070b) in M2; (2) also allow hill self-shadow (070c); (3) keep as is. Recommendation (1). (B) **Lighting quality setting** (extends D-025): (1) `lighting: 'rt' | 'classic'`, 'rt' default, auto 'classic' at 480x180 'ultra', 070c/d only under a later 'rt-high'; (2) default grid 320x120 when 'rt' is on; (3) no setting, cut features to fit 400x150. Recommendation (1), confirmed after the 070a owner bench.

## 26. US-026b near-band streaming, 23.9 fixes, remaining near-detail features, chunk files (architect, 2026-09-26; D-007, D-023 item 5, D-026)

Normative for US-026b. Section 23 stays valid and is extended, not changed: the 23.1 interfaces (`terrain.near`, `groundAt/groundNormalAt/groundTypeAt`, `nearReady`, `near.version`, pass A2's `NEARH/NEARTYPE` + `uNearMap`) are what 026b keeps and re-fills. Measured inputs (23 probe + code as of `0ef48dd`): one 64x64 chunk bake 9 ms (2.2 us/cell), full 192x192 band 80 ms; `NEARH`+`NEARTYPE` upload 184 KB (one `texImage2D` each, ~0.1-0.2 ms on the iGPU); `heightAt` is analytic for every finite (x, y) (the recipe "keeps going" past the 2048 m far map; the far *textures* end there -> sky).

### 26.1 Decisions (reasons inline)
1. **Recentred contiguous band, not a 9-slot chunk ring.** `terrain.near` stays one 192x192 array with `x0, y0`; a recentre builds the *next* band in a second, preallocated buffer (double buffer, allocated once: `height/type/hDraw/aux` x 2 = ~740 KB), **copying the overlapping cells** (2/3 of the band on a one-chunk move, ~37k floats, < 0.1 ms) and **baking only the new cells** (one chunk column/row = 12,288 cells = 27 ms; a diagonal move 45 ms; a teleport = all 80 ms). Reason: `util.gridHeight`, the GLSL bilinear and every 026a test keep working unchanged; a toroidal ring would need modular texel addressing in both samplers and a seam rule for bilinear across slots. `chunk()/setCenter()/bakeChunkStep()/_chunks/_chunkQueue/_slot` (US-025, never called) are **deleted** in S1 with their 3 `terrain.test.js` cases; 7.2's "195x195 atlas" text is dead.
2. **Trigger with hysteresis.** `Terrain.setNearCenter(x, y)`: `wantCx = floor(x / 128)` (same for y); recentre when `wantCx != centreCx` **and** `|x - (centreCx + 0.5) * 128| > 64 + recentreMargin` (`recipe.chunk.recentreMargin`, default 8 m; through the registry, no literal in `engine/`). The player is then still >= 120 m inside the live band in the walk direction while the new one bakes (27 ms / 2 ms = 14 frames, <= 2 m walked at 8 m/s), so **physics never falls back to analytic `heightAt` during a walk** (test: spy on `heightAt`, 0 calls). Beyond 120 m the march falls to `FARH` for that sample (023's "NEARH outside -> FARH" rule, same function at 8 m): a short LOD dip, not a crack. A teleport (`R`, editor play-test, poses) recentres by the same path; `Terrain.bakeNearSync(x, y)` (= `bakeNearBand(floor(x/128), floor(y/128))`) exists for load, `deserialize`->`World.load`, gpucompare poses and tests.
3. **Bake budget: `bakeNearStep(msBudget = 2)` per *rendered* frame (16's rule: never per fixed step), row-granular and resumable** like `bakeFarStep`: `_nearRow` 0..191; per row: copy the overlap run(s) with `TypedArray.set`/`copyWithin`-style index math (no per-cell branch inside the copied run), bake the rest at cell centres (`heightAt/typeAt`, identical sampling to `util.bake`). A row costs <= 0.45 ms (a fully new row), so a 2 ms call overruns by at most one row. The last call also does the finish (`hDraw` = height + canopy on forest cells, `minH/maxH`, `aux` transform, 26.4) - ~0.6 ms, allowed once. Retarget while pending (the player turned around): reset `_nearRow = 0` against the *live* band, never read the half-built buffer. Returns `true` while pending; `terrain.nearPending`, `terrain.nearBakeProgress` (0..1) for F3.
4. **Atomic flip; who reads what during a rebake.** Physics (`groundAt*`), the JS oracle (`castTerrain`) and the GPU upload all read `terrain.near` only; the pending buffer is private (`_nearNext`). The flip is one object swap (`this.near = next; next.version = old.version + 1`) at the end of a `bakeNearStep` call; `bakeNearStep` is called from the game loop **before** `engine.render` (next to `bakeFarStep(1)`, `main.js` ~794), so a frame is entirely old-band or entirely new-band on both paths (`_uploadNear` keys on `near.version` at bind). No `texSubImage2D`: the origin shifts on every recentre anyway and a full 184 KB upload once per 128 m walked is ~0.2 ms (below the budget of a single frame's headroom). `near.x0/y0` are read by the caster through `uNearMap` each bind (already the case).
5. **Determinism.** Copy + bake == a fresh `bakeNearBand(cx', cy')` **bit-for-bit** (`Float32Array` equality on `height/hDraw`, `Uint8Array` on `type/aux`; test after 20 random one-chunk moves and 3 teleports). `checksum()` gains the near band. Overrides/stamps live in the recipe (`serialize` already stores `terrain.overrides`), so a save restores the same band.
6. **Walk bound stays data.** `world.bounds` stays optional and enforced as in 23.3; 026b only changes the radius in `world_m1.world.json` (**PO**: recommend `r: 480`: 3-4 chunk crossings per direction, the tower stays in view, the river bank at ~470 m W is reachable for reeds/foam, and the east edge stays 70 m inside the 2048 m far map). No world-edge handling in 026b (beyond the far map the march returns sky; the bound keeps the player 70 m+ from it).
7. **Chunk files carry static outdoor placements only; terrain overrides are never streamed.** Reason: the far grid is baked at load from the same `heightAt`, so a stamp arriving later would make near and far disagree (seam) - stamps/paints stay in the recipe/world `overrides` (small, load-time). Per-entity *state* in chunks (bodies, `used` flags, triggers) is out: a chunk entity is content, never in a save (26.6). **Manager confirms this narrowing of D-023 item 5** (recommendation: accept; stateful chunk entities come with the first outdoor quest content).

### 26.2 API (engine/world/Terrain.js, World.js)
```js
setNearCenter(x, y) -> boolean            // true if a recentre was (re)queued; no baking here
bakeNearStep(msBudget = 2) -> boolean     // true while pending; flips `near` (version+1) when done
bakeNearSync(x, y)                        // sync full band around (x, y); load/tests/poses only
nearPending: boolean; nearBakeProgress: number   // F3 line "near bake 37 %"
near.aux: Uint8Array(w*h)                 // 26.4 edge distance in cells (0 = on the water/bank edge cell, 255 = none within 15 cells)
// World
streamTerrain(x, y, msBudget = 2) -> { baking: boolean, entered: string[], left: string[] }   // setNearCenter + bakeNearStep; the key lists (26.6) are preallocated arrays reused per call (length reset), only non-empty on a flip
loadChunk(key, def) / unloadChunk(key)    // 26.6; engine never fetches
```
`main.js`: `const st = engine.world.streamTerrain(px, py, 2)` per rendered frame in world mode; on `entered` keys that are in `manifest.files` -> `fetchJson` -> `loadChunk` (resolve-time guard: drop if the key is no longer resident). Overlay: `near (cx,cy) v<version> pending 37%`.

### 26.3 23.9 fixes (render)
**(a) Structures behind a hill (both paths).** Claimed cells are marched too, bounded by their own depth: for a cell/sub-ray with finite structure depth `D`: `tMax = min(D, FOG_FULL)`; if `D` lies inside skip interval `k` (`skipIn[k] <= D <= skipOut[k]`) then `tMax = skipIn[k]` (terrain cannot exist inside that bbox, and nothing past `tIn` can win); if `tMax <= T_START` -> no march (interior hits: the eye's own bbox has `tIn = 0`, so *every interior cell costs 0 steps*). On a hit (`tHit < D` by construction) the terrain sample **overwrites** the structure sample and depth; no hit -> copy through (GPU) / leave (JS). JS: `castTerrain` line ~376 replaces `continue` with the rule; `spans` untouched (already closed there). GLSL: pass A2's `kindA != 0 -> return` becomes the same rule, reading `SDEPTH` (already bound). Expected cost: exterior claimed cells only, bounded by `D` (`terrainNearTower`: ~35 % of cells at 20-60 m, 30-90 near steps -> **+0.2-0.4 ms at 320x120**; terrain pass budget stays 1.5 ms p95). Fallback knob if measured over budget: `recipe.nearLOD.claimedMarch: 'all' | 'beyondH0'` (bind-time uniform; `'beyondH0'` marches claimed cells only when `D > h0`). Side effect (wanted): the hill in front now hides the tower's ring/base rows from below (23.8's rectangle seam shrinks).
**(c) Two structures, ring hand-off band (JS only).** `sectorCaster.js` `emitSample`: `if (ctx.depthBuffer && !(dist < ctx.depthBuffer.get(x, y))) return;` (strict: first writer keeps ties; one array read per emitted sample). GPU `dda.frag.js` already keeps the nearest `bestT` across the structure loop (`t0 >= bestT` early-out) - no change; the Node test is the contract: a world with `tower` + `test_room` placed 30 m behind the tower's west ring, eye outside: every cell's depth == min of the two single-structure casts.
**(b)** `validate-content` rule "every outer-ring cell of a placed level is non-solid" (PC-B, tools; warning, not error).

### 26.4 Remaining near-detail (OWN-REQ-002; `terrainShade.js` + `terrain.frag.js` `shadeTerrain`, TLOOK, `near.aux`)
Rules are literal in both twins; dice = world-cell hash with the feature's flat index salt `20 + fi` (23.9 verdict), never screen-keyed.
- **`near.aux` edge distance (bake finish, 26.1 item 3):** seed = cells with a 4-neighbour of different water-ness (`type == water` vs not), two-pass chamfer (3-4 weights are overkill: Manhattan in cells is enough for a <= 7-cell gate), cap 255; the band edge is treated as "no edge" (reeds fade at the edge; the far fallback has none anyway). Cost ~0.3 ms, once per flip. Upload: `NEARAUX` R8UI 192x192 next to `NEARTYPE` (`packNearTextures` returns it; +1 unit in the **shade** program, which also binds `NEARH`, `NEARTYPE`, `uNearMap`, `uCanopy` = `recipe.recipe.forest.canopy`).
- **TLOOK width 16 -> 24:** texel 16 = `type.face` glyph codes (same packing as 4-7), texel 17 = `(faceBrightness 0.8, faceCos = cos(recipe.nearLOD.faceDeg ?? 35), trunkH 3, 0)`; feature colour texels 9/11/13/15 `.w` = `bandMask * 16 + edgeCells` (`bandMask` bit 1 close, bit 2 near; `edgeCells` 0 = no gate, else the feature fires only when `aux <= edgeCells`: reed 7 (`nearWater 14 m`), foam 2 (`nearBank 3 m`, ceil)). `buildFeatures` keeps every feature (no more "close only" filter) and carries `bands`/`edgeCells`; grass has exactly 4 = `MAX_FEATURES_PER_TYPE` (a 5th is a `packTerrainTextures` error now, not a silent drop).
- **reed / foam:** per-cell glyph substitution exactly like pebble, gated by band and `aux` (nearest `NEARAUX` texel at `u, v`; outside the band -> no feature). Only when the hit resolved near (`t < h1`; use the shade pass's existing 2 m/8 m cell switch).
- **tallGrass (tuft one row above the surface):** decided in the *upper* cell: for kind-7 cell `c` at row `r`, read the cell below `(col, r + 1)` (`fb.gbuf` / `texelFetch(uGI/uGA/uDepth, cell + ivec2(0, 1))`: the shade pass already has `cell`): if it is kind 7, grass, in the close band, its 2 m world cell rolls tallGrass, and `t_c > t_below` (farther, i.e. the tuft stands in front of `c`), then `c` draws glyph `"` in `grassLight` over its own `bg`. Only over kind-7 cells (never over sky/structure/voxel cells; parity-safe, no cross-kind blending). Bottom row: no neighbour -> no tuft.
- **Surface vs face rows:** a kind-7 cell is a **face** when `N.z < faceCos` (`N = unpackNormalOct(aoD)`, already decoded in the shade pass; 35 deg default, recipe): glyph from texel 16, `bT *= faceBrightness`, jitter/features off. **Trunks:** a face cell where the nearest `NEARTYPE` texel *or its uphill 2 m neighbour* (`cell - sign(N.xy)`) is forest and `z - groundRef < trunkH` (`groundRef = min(hDraw of those two texels) - canopy` if that texel is forest, else its `hDraw`): glyph `|` in `woodDark` on `forestDark` bg for 1 cell in 3 (hash salt 30), else dark foliage `%`. Above `trunkH`: the forest face set. Needs `NEARH`+`NEARTYPE` in the shade program (3 fetches per face cell; face cells are a minority).
- 1 m near cells / finer far grid are **not** in 026b (4x bake and textures; revisit with the editor's terrain tools).

### 26.5 Steep content stamp (designer; `design/levels/overworld_far.js` overrides, PC-A per the PC rules)
One `add` stamp + one `rock` paint: `{ shape: 'disc', mode: 'add', h: 17, r: 10, falloff: 12 }` gives a 55 deg average / ~64 deg peak flank (smoothstep 1.5x); place it >= 40 m from the tower bbox and outside the crown skirt (crown flatten `r 20 + falloff 60`) or after it in stamp order, off the breach -> waystone line, with one flank <= 30 deg (a second `add` stamp as a ramp) so the owner can walk up one side and slide on the other. Rock paint on the steep flank only. Preview (`overworld.html`): print max slope in the disc (must be 55-65 deg) and the ramp's (< 30). The physics slide rule (23.3) is then owner walk-tested for the first time. Water for reeds/foam: the river bank at ~470 m W (bound 480) **or** a pond override (dish `set` stamp + water paint) 150 m from the tower - designer/PO pick one; a paint alone makes water without a bed (fine for foam, odd for physics: the capsule walks on it).

### 26.6 Chunk files (`content/chunks/<world>/<cx>_<cy>.chunk.json`; D-023 item 5 as narrowed by 26.1 item 7)
```jsonc
{ "kind": "chunk", "schema": 1, "id": "world_m1/11_8", "world": "world_m1", "cx": 11, "cy": 8, "nextId": 3,
  "entities": [ { "id": "prop_1", "type": "prop", "x": 1560.5, "y": 990.0, "z": "ground", "yawDeg": 120,
                  "components": { "voxel": { "model": "boulder", "anim": "idle", "loop": true } } } ] }
```
- `schema.js`: kind `chunk`, `ID_COLLECTIONS.chunk = ['entities']`, `KEY_ORDER.chunk`; `manifest.files` lists chunk files (absent file = empty chunk: the game never fetches a key not in the manifest, no 404s). `validate-content`: `x, y` inside the chunk square, `z` numeric or `'ground'`, **no** `components.body`, no `triggers`/`lights` in 026b (error).
- `World.loadChunk(key, def)`: entities get global ids `<chunkId>/<localId>` and `handle.chunkKey`; `z: 'ground'` via `groundAt` (the band is resident by construction: a chunk is only loaded once it is in the 3x3); voxel instances count against the 16-slot pool (validator warns above 8 per chunk). `unloadChunk(key)`: removes those handles (`removeEntity` path, pool slots freed). `serialize` skips `chunkKey != null` entities; `deserialize` -> the resident set is rebuilt by streaming (one frame of fetch latency for props: accepted).
- Resident set = the 3x3 around the band centre; `streamTerrain` reports `entered/left` on the flip. The set is deterministic per centre chunk (test: 20 random walks -> the same resident set as `fresh centre -> 3x3`).

### 26.7 Parity, poses, budgets
gpucompare (main.js `world_m1` list, `timeSec = 0`; **pose setup calls `terrain.bakeNearSync(x, y)` before capture**, both paths read the same band):
- `eastRecentred` (1760, 1030, `groundAt + 1.6`, yaw 270, pitch -5): two recentres east; the tower at 260 m through the 130-170 dither.
- `hillHidesTower` (west of the crown skirt, e.g. (1330, 1025, `groundAt + 1.6`, yaw 90, pitch 0); designer/main session confirm the pose actually hides base rows): the compare harness reports `terrainOverStruct` (cells where terrain overwrote a structure sample) and requires >= 30 on both paths, within 1 %.
- `steepFace` (designer's stamp numbers, 25 m off, pitch -15): face rows + trunks if forest-adjacent.
- `riverBank` (grass 8 m from water, yaw toward it, pitch -20): reeds + foam.
- `waystoneDown` (existing): tallGrass tufts.
Thresholds: 23.6 plus: feature/tuft/face cells exact glyph and colour; exclude kind-7 cells whose own **or below-neighbour** `t` is within 1 % of 40/130/150/170, cells with `|N.z - faceCos| < 0.01`, and cells with `aux == edgeCells` (chamfer ties are exact integers, but keep the guard for the rim rule).
Budgets (owner GPU, 240x90 and 320x120): `bakeNearStep` <= 2 ms per rendered frame, one recentre complete within 0.3 s of the trigger, `over25 == 0` on a 60 s walk crossing >= 4 chunk borders (`?bench=1` walk, record `nearFlips`); upload <= 0.3 ms once per flip; terrain pass <= 1.5 ms p95 with 26.3(a); shade +<= 0.1 ms; sim <= 1 ms; JS <= 8 ms. Memory +~0.8 MB. No per-frame allocation anywhere on the streaming path (`entered/left` arrays reused; `--expose-gc` probe over 2000 frames of simulated walking).

### 26.8 Build order (each step ends with a green Node test; PC tags per the two-PC rules; one browser pass at the end)
- **S1 [PC-B, Node]** `Terrain.js` + `terrain.test.js`: double buffer, `setNearCenter` hysteresis, `bakeNearStep` row-granular copy+bake, flip + `version`, `bakeNearSync`, `aux` transform; delete the 9-slot chunk API + its 3 tests. Tests: 26.1 item 5 bit-equality after random moves/teleports; each call <= budget + 0.5 ms; `near` object identity unchanged until the flip; no thrash walking +-2 m across a chunk border for 600 steps (0 recentres); retarget mid-bake ends with the right band; `aux` == brute-force Manhattan distance on 2000 random cells; `checksum()` covers `near`.
- **S2 [PC-B, Node]** `World.streamTerrain` + `world.test.js`; `terrainWalk.test.js`: 600 m walk east at 2 ms/frame budget (simulate 1 render frame per 1 fixed step): `z >= groundAt - 0.01` every step, `heightAt` spy count 0 during the walk, `near.version` == number of chunk borders crossed (+0 for the hysteresis re-crossings); `main.js` wiring (<= 15 lines: call site next to `bakeFarStep`, overlay line); `bounds.r` from data (PO's number, `world_m1.world.json`).
- **S3 [PC-B, Node]** `TerrainTextures.js` + test: `NEARAUX` packing, TLOOK width 24 (texels 16-17, `.w` gates), `buildFeatures` bands/`edgeCells`, 5th-feature error. Pure packing only, no GL.
- **S4 [PC-B, Node]** JS twins: `terrainShade.js` reed/foam/tallGrass/face/trunks (`shadeTerrainCells` reads the cell below from `fb.gbuf`) + `terrainShade.test.js` one case per rule on a synthetic 2-cell band; `castTerrain` 26.3(a) rule + `sectorCaster.js` `emitSample` depth test + tests: synthetic hill (stub terrain) in front of a placed `test_room` -> its cells behind the ridge become kind 7 with `depth < D`, interior eye -> 0 march steps (step counter in `hitOut`), two-structure min-depth test (26.3 c).
- **S5 [PC-A, GLSL]** `terrain.frag.js` (26.3 a, `SDEPTH` read, `claimedMarch` uniform), `shade.frag.js` (features/face/trunks, `NEARH/NEARTYPE/NEARAUX/uNearMap/uCanopy` bindings), `GpuCellPipeline.js` (`_uploadNear` + `NEARAUX`, shade units, TLOOK 24), `glsl.test.js` string checks; gpucompare poses + `terrainOverStruct` stat; `?bench=1` `nearFlips`.
- **S6 [PC-A designer + PC-B data]** 26.5 stamp/paint (+ pond or river choice), `bounds.r`, one example chunk file with 2-3 boulders/rubble, manifest entry; `validate-content` chunk rules + ring-solidity warning (PC-B tools).
- **S7 [PC-B, Node]** `content/schema.js` kind `chunk`, `World.loadChunk/unloadChunk`, `serialize` skip, `main.js` fetch-on-`entered` (<= 20 lines, uses the pack's `fetchJson`), `loadPack` accepts chunk files in the manifest; tests: load/unload adds/removes handles and voxel slots, ids `<chunkId>/<localId>`, save round-trip never contains a chunk entity, resident-set determinism, late fetch for a left chunk is dropped.
- **S8 [PC-A]** Browser pass: walk 400 m in each direction and back (F3: pending %, `over25 == 0`), the stamp (walk up the ramp, slide down the face), river/pond (reeds, foam), `?gpucompare=1` all PASS incl. new poses, `?bench=1` numbers into the story. Then ARCH review (fable: S1 + S4/S5 diff; opus for S2/S3/S7).
Sizes: S1-S2 ~1 d, S3-S4 ~1 d, S5 ~1 d, S6 0.5 d, S7 ~1 d, S8 0.5 d.

### 26.9 Routing flags and do-nots
- **Manager:** 26.1 item 7 (chunk files = static placements only, overrides never streamed; D-023 item 5 narrowing). Recommendation: accept.
- **PO:** `bounds.r` (recommend 480); river vs pond for reeds/foam; whether the owner walk-test includes the chunk-file boulders.
- **Designer (PC-A):** 26.5 stamp + ramp + paint, pond if chosen, `hillHidesTower` pose numbers, chunk example props.
- **Do not:** bake or flip inside a fixed step or inside `engine.render`; read `_nearNext` from physics/render; mutate `terrain.near` in place (always swap the object); allocate per call in `streamTerrain`/`bakeNearStep` (buffers once, key arrays reused); stream stamps/paints; fetch from `engine/` or hard-code `content/` paths; march claimed cells inside the eye's own bbox (`tMax <= T_START` rule); key any dice on the screen cell or on the row index (the tuft rule reads the neighbour's *world* cell); put 8 m / 35 deg / 3 m / 0.8 / 7 cells in GLSL or `engine/` source (recipe -> registry -> TLOOK/uniforms); let `MAX_TERRAIN_STEPS` or the skip rule differ between the twins; serialize chunk entities.

## 27. Mesh engine (own renderer, ASCII as the final stage) (architect, 2026-09-26; owner decision "own mesh renderer, no Three.js, no long-term ray-caster hybrid; stay JavaScript; WebGL2 everywhere, WebGPU where available")

Status: **plan + tech notes; needs D-029 (27.14) before any story starts.** Where this section and 14.2/14.4/15/25 differ, this section wins once D-029 is recorded. The G-buffer contract of 8.1 and the pass chain resolve -> deriv -> light -> shade -> edge -> sprites (14.1-14.3) are the parts that make the ASCII look; they stay. What changes is **how the G-buffer gets filled**: triangles rasterised by the GPU (and by a JS twin) instead of three per-cell ray marchers that never agree exactly where they meet (BUG-OWN-008 class).

### 27.1 Decisions (reasons inline)

1. **One geometry pass `raster` replaces passes A1 `cast` (sector DDA), A2 `terrain` (heightfield march) and A3 `voxel` (voxel march).** It draws every visible mesh (structures, terrain chunks, props/models) with a real hardware depth buffer into the sub-sample G-buffer set (14.2 item 3: `cols*n x rows*n`, fixed pixel-centre offsets). One depth test = no seams between renderers by construction; any shape, any number of storeys, doors and interiors are just triangles. Passes B-F are kept and read the same textures.
2. **The camera model stays the y-shear camera** (4: `row = horizonRow - (h - eyeZ)/d * planeDistY`, `d` = perpendicular distance). It is a projective map, so it is one 4x4 matrix (27.5); the rasteriser reproduces today's cell rays at every sub-sample centre exactly, horizons line up at every pitch, `cellRayP()` (light pass, 14.3 item 1) and `projectSprite` keep working unchanged. **Do not** switch to a rotated-pitch perspective camera "because meshes allow it": every downstream pass and the sprite/UI projection assume the shear formula. **Superseded for `renderer:'mesh'` by D-029 Amendment 2 (2026-09-30):** the pitched camera (28.1) is the mesh default, first person included; shear stays for `renderer:'dda'` and the dda-vs-mesh parity poses until ME-19 deletes it.
3. **Existing content is converted at load, not migrated.** Level grids -> quads (`levelMesh.js`, 27.4), the terrain band/far grid -> chunk meshes (`terrainMesh.js`), voxel `ModelDef` -> greedy-meshed parts (`voxelMesh.js`). Level/world/vox/chunk files, the recipe, the editor's document model and the physics grid queries do not change in phase 1. New content (any-shape buildings) arrives in phase 3 as glTF -> `mesh.json`.
4. **The JS twin stays the oracle (D-017).** `engine/mesh/rasterJS.js` rasterises the same draw list into `fb.gbuf` at `cpuGrid`; `?gpucompare=1` compares it with the GPU as today. Rasteriser conventions are pinned (27.7) so the two agree everywhere except on cells the metric already excludes (4-neighbour kind edges).
5. **G-buffer v3: `GI` becomes RGBA32UI** (`z` = octahedral-packed normal, `w` = objectId), so `aoD` is an AO distance for every kind again and `face 7` means "read the normal from `GI.z`". Terrain and rotated model parts stop overloading `GA.w`. Every reader keeps its `.xy` reads; only `light.frag`/`shade.frag`'s two `unpackNormalOct(GA.w)` sites move to `GI.z`.
6. **Lighting on meshes = shadow maps, not per-cell ray marches.** 25.1-25.3 (`segBlockedSectors/Voxels` over the sector grid and the `VOX` atlas) is superseded: those data structures will not exist. Sun = one directional shadow map; top-2 point lights = cube shadow maps; other lights unshadowed (LVIS deleted with the grid). US-070b/c (terrain receives/casts sun shadows) come free. Detail in 27.9.
7. **Physics: terrain stays a heightfield (23), structures and props become triangle colliders (BVH) in phase 2.** Player capsule, boulder sphere and the D-018 compound-sphere bodies query one `World.collide*` API; the sector-grid rules of 7.1/`capsule.js` are retired for structures when the phase-2 gate passes. Grid queries (`sectorAt`, triggers, interaction cells, `floorAt`) stay: they are content lookups, not collision. Walking collision is **ours, in JS, now**; rigid bodies keep a clean seam for Rapier (Rust -> WASM) later (27.10).
8. **Deletion happens only after the phase gates**, in one story (ME-19), never piecemeal: `?renderer=mesh|dda` coexist until then, every `?gpucompare=1` pose runs on both, and the old renderer is the *second* oracle for phase 1 (mesh output vs DDA output on the same poses).
9. **Backend-shaped renderer from day one: WebGL2 first, WebGPU later** (owner: "WebGL2 everywhere, WebGPU where available"). Every GPU resource and draw goes through one internal `GpuDevice` interface (27.2); pass code never calls `gl.*` directly after ME-04. No WebGPU story before the mesh engine ships on WebGL2 (phase 4, 27.11).
10. **Stay JavaScript.** No TypeScript source, no build step. Types come from JSDoc + `// @ts-check` verified by a dev-only `tools/typecheck.mjs` (27.7 item 7). **WebAssembly only if profiling shows a need** (D-015 stands; no story; candidate hot spots if ever: BVH build, greedy meshing, `rasterJS` - none is per-frame on the GPU path).
11. **Kept unchanged:** `RenderTarget`/`present()` (D-005), `CellBuffer`, `MaterialTable`, detail shader (`shadeCore/shadeTail`), edge pass, sprites pass, sky LUT, `LightSet` (minus LVIS), `Terrain` band/far bake + streaming (26), `World`, content loader (21), `transform.js` (CO-1), the editor document model (24), F3/bench tooling (16). **Replaced:** `sectorCaster.js`, `terrainCaster.js`, `voxelMarch.js` (render half), `dda/terrain/voxel.frag.js`, `WorldTextures.js` (GEOM/MATS/FLAGS atlas), `VoxelTextures.js`, `TerrainTextures.js`' `NEARH/FARH` *march* use (the `NEARTYPE/FARTYPE/NEARAUX/TLOOK` shading textures stay), `OpenSpans`, LVIS, the sun DDA in `light.frag`. **Deleted when:** ME-19 (end of phase 3), after the phase-2 gate.

### 27.2 Module layout

```
engine/mesh/                      (new; imports only engine/core, engine/render/GBuffer.js constants, engine/world read-only)
  MeshData.js        format + validator + packer to typed arrays (27.3); planeId/face helpers shared by every builder
  levelMesh.js       Level (sector grid) -> MeshData: floors/ceils/caps/walls/steps/lintels/grates; kinds, planeIds, uv, aoD edge bits
  terrainMesh.js     terrain.near band + far grid -> chunk MeshDatas (indexed), skirts, far-under-band exclusion, LOD ring selection
  voxelMesh.js       VoxelModelDef -> per-part MeshData (greedy meshing); uses voxelPose for part matrices at draw time
  gltf.js            .glb/.gltf (static nodes, materials by name) -> MeshData (phase 3)
  DrawList.js        per-frame list of {mesh, matrix, partMatrices, objectId, structSeq, flags}; frustum culling; preallocated
  rasterJS.js        JS reference rasteriser: DrawList -> fb.gbuf (+ shadow maps twin in phase 3)
  culling.js         AABB/frustum tests for the shear camera (pure)
engine/render/projection.js       shearProjection(cam, cols, rows) -> Float32Array(16) + inverse helpers; the ONE place the matrix lives
engine/render/gpu/
  device/GpuDevice.js      the backend interface (JSDoc typedef + a mock for Node tests): createBuffer/createTexture/createTarget/createPipeline/
                           beginPass/draw/readback/timer; formats and pass descriptors as plain data (no GLenums, no GPU* objects leak out)
  device/GpuDeviceGL2.js   WebGL2 implementation (wraps glUtil.js, gridTargets.js, GpuTimer.js); the only file that says `gl.`
  device/GpuDeviceWebGPU.js (phase 4) WebGPU implementation; WGSL sources in glsl/../wgsl/
  MeshBuffers.js     mesh upload + eviction (per MeshData id + version) through GpuDevice; Node-testable with the mock device
  glsl/mesh.vert.js, mesh.frag.js, terrain.vert.js (kind-7 variant), shadow.vert.js/shadow.frag.js (phase 3)
  GpuCellPipeline.js gains `_passRaster()` + `_passShadow()`; `renderer: 'mesh' | 'dda'` option; A1-A3 skipped when 'mesh'; talks to GpuDevice only
engine/physics/
  bvh.js             static triangle BVH (flat Int32/Float32 arrays), build/refit/query AABB/ray/segment
  meshCollide.js     capsule/sphere vs triangle set, push-out, ground probe, step-up sweep
  contacts.js        `World.contacts(shape, out)` contact-manifold API = the Rapier seam (27.10)
tools/gltf-import.mjs, tools/mesh-stats.mjs (phase 3), tools/typecheck.mjs (ME-00)
```
Dependency rule unchanged: `engine/mesh` never imports `game/`/`design/`; `check-deps` covers it and gains a rule: only `engine/render/gpu/device/*` may reference `WebGL2RenderingContext`/`gl.` or `navigator.gpu`. Public API (`engine/index.js`): `buildLevelMesh`, `buildVoxelMesh`, `loadGltf`, `MeshData` typedef, `createEngine({ renderer, backend })`; internals (`rasterJS`, `DrawList`, `GpuDevice`) through `engine/dev.js` only.

**`GpuDevice` shape (normative for ME-04; small on purpose - a WebGPU port is mechanical):** resources are opaque handles; descriptors are plain JSON-safe objects: `createBuffer({usage:'vertex'|'index'|'uniform', bytes|data})`, `createTexture({format:'rgba32ui'|'r32ui'|'rgba8'|'depth24'|'r8ui'..., width, height, layers?})`, `createTarget({color:[tex...], depth?:tex})`, `createPipeline({vertex:{src, layout}, fragment:{src, targets}, depth:{test, write}, cull})` where `src` is `{glsl, wgsl?}` (the WGSL key is filled in phase 4), `beginPass(target, {clear})`, `bind(pipeline, {uniforms, textures, vertexBuffers, indexBuffer})`, `draw(count, first, instances)`, `endPass()`, `readback(tex, rect, typedArrayOut)` (test-only), `timer.begin/end(slot)`, `caps` (`maxColorAttachments`, `timerQueries`, `softwareRenderer`). Uniforms are set from typed-array views (one `Float32Array`/`Int32Array` per pipeline, uploaded whole: matches WebGPU uniform buffers and costs WebGL2 nothing measurable at our counts). Rules: no per-frame descriptor objects (build once, reuse), no string keys in `bind` on the hot path (indices resolved at pipeline creation), no backend enum outside `device/`.

### 27.3 Data formats

**`MeshData` (in-memory + `content/meshes/<id>.mesh.json`, schema 1, D-023 canonical JSON; a `.bin` sidecar is a later decision, not needed for phase 1-3 sizes).**
```js
/** @typedef {Object} MeshData
 * @property {1} version
 * @property {string} id                          content id `<fileId>/<localId>` for files; builders use `level:<name>`, `vox:<model>/<part>`, `terrain:<cx>_<cy>`
 * @property {'static'|'terrain'} layout          static = UNROLLED (3 verts per tri, no index, flat data on every vertex); terrain = indexed grid, no flat data
 * @property {Float32Array} pos                   xyz per vertex, mesh-local metres (frame per 27.6)
 * @property {Float32Array} uv                    2 per vertex, metres (walls: along-wall, height; planes: local x,y) - the detail shader's texture space
 * @property {Uint32Array}  nrm                   oct-packed normal per vertex (static: face normal, identical on the 3 verts; terrain: smooth vertex normal)
 * @property {Uint32Array}  flat                  static only, per vertex, 2 uints: [0] = planeId, [1] = kind | face<<8 | mat<<16 (same packing as GI.y, mask/cov 0)
 * @property {Float32Array} aux                   static only, per vertex, 4 floats: zRef (world-z the shader subtracts for `z`), aoEdgeBits (as float 0..15), faceW, faceH (face size in m for the aoD edge distance)
 * @property {Uint16Array}  [idx]                 terrain only
 * @property {number[]}     bbox                  [x0,y0,z0,x1,y1,z1] mesh-local
 * @property {{start:number,count:number,part?:string}[]} ranges   draw sub-ranges (voxel parts, glTF primitives)
 * @property {Object<string,string>} [mats]       glTF material name -> palette/detailPass key (importer sidecar `*.mats.json` merged in)
 */
```
- **Amended by 27.15.0 items 2, 6, 7** (`aux` = 8 floats/vertex, terrain layout has no `uv`, `ranges` in triangles, one voxel MeshData per model with a range per part); full typedef in 27.15.2.
- Sizes: tower ~12k triangles unrolled = 36k verts x 48 B = 1.7 MB VRAM, once. Near band 192x192 cells indexed = 37k verts x 16 B; far ring LOD <= 60k tris. Props <= 2k tris each after greedy meshing.
- **Material ids** stay `MaterialTable` ids (8.1); meshes carry the *key* in JSON and the id after `bindLevel`-style resolution at load (`MeshData.resolveMats(table)` fills `flat[1]`'s mat bits). No hex colours, no textures in mesh files: the ASCII detail shader is the texture.
- **Content JSON:** `world.structures[]` gains `mesh: '<meshId>'` as an alternative to `level` (`frame` = same `Frame`, plus `yawDeg` allowed for mesh placements only - needs a D-028 amendment, 27.14). `manifest.files` lists `.mesh.json` under kind `mesh`; `ID_COLLECTIONS.mesh = []`, `KEY_ORDER.mesh` in `schema.js`. Chunk files may place mesh props exactly like voxel props (`components.mesh`).
- **glTF:** source asset `.glb` in `design/meshes/` (Blender export: +Y up, metres; the importer maps glTF `(x, y, z)` -> world `(x, -z, y)` and bakes node transforms into static geometry). `tools/gltf-import.mjs <in.glb> <id>` -> `content/meshes/<id>.mesh.json` + reports triangles, groups, unmapped materials. No skinning, no animation, no textures in phase 3 (rigid nodes as `ranges` are allowed, so a door can be a part).

### 27.4 G-buffer mapping per field (what the raster pass writes, per sub-sample)

| Field (texture) | Grid-converted level quads | Terrain chunks (kind 7) | Voxel-mesh parts (kind 8) | glTF meshes | Consumer that cares |
|---|---|---|---|---|---|
| `kind` (GI.y 0-7) | 1 wall, 2 step, 3 upper, 4 floor, 5 top, 6 ceil - decided by `levelMesh` exactly as `sectorCaster` decides them (same neighbour rules) | 7 | 8 | **9 = KIND_MESH** (new; shade = `shadeCore` like walls with `faceK` by face; edge = isVert/isUp by face) | resolve vote key, deriv skip, shade branch, edge rules |
| `face` (GI.y 8-11) | 1..6 from the quad's axis | 7 (normal in GI.z) | dominant world axis of the rotated normal (1..6); 7 only when no axis dominates (`max abs(n_i) < 0.9`) | dominant axis; 7 when not within 0.9 | light (`faceNormal` vs GI.z), shade `faceK`, edge isVert/isUp |
| `mat` (GI.y 16-31) | sector wall/floor/ceil/upper mat id | `type` (as today) | model mats | `mats` map -> id | shade |
| `planeId` (GI.x) | **identical to today's caster formula** `(structSeq<<28)\|(tag<<24)\|(coord&0xffffff)` (walls tag=face, coord=int boundary; planes tag=kind, coord=round(h*1000)+0x800000) - the edge pass must not see a difference | `PLANEID_TERRAIN` (one id, as today) | `(0xF<<28)\|(inst<<24)\|(part<<21)\|(face<<18)\|layer` (voxelMarch.js:336) - greedy quads keep the layer index so voxel steps still outline | `(0xE<<28)\|(objectId&0xFF)<<20\|groupId` - `groupId` = smoothing group from the importer (connected, coplanar within 1 cm, normals within 5 deg); silhouettes and creases outline, flat faces do not | deriv (same-plane neighbours), resolve vote, edge `farther()` |
| `u, v` (GA.xy) | per-vertex uv = today's wall/plane texture coords, perspective-correct interpolation | world x, y of the hit (interpolated `worldPos.xy`) | part-local metres on the voxel face (as today: textures stick to the body) | importer uv in metres (default: planar per group along the group's tangent axes) | shade hashes (world-anchored: rule 8.1 item 3 holds because uv is per-vertex data, not screen data) |
| `z` (GA.z) | `worldPos.z - zRef` (`zRef` = the sector's floor z for wall-type quads, the plane's own h for planes - what `sectorCaster` writes today) | `worldPos.z` (`hitOut.h`, as today) | `worldPos.z - modelFeetZ` | `worldPos.z - object origin z` | shade course/band rules |
| `aoD` (GA.w) | edge distance: `min` over the face's concave edges (`aoEdgeBits` from `relief` floorRise/ceilDrop for planes, the wall-segment neighbour rule for walls) of the distance in metres to that edge, computed in the fragment from face-local uv and `faceW/faceH`; `Infinity` when no bit is set | `Infinity` (kind 7 has no seam AO today either) | `Infinity` | `Infinity` (phase 3: optional per-vertex baked AO -> `aoD = ao * uAoR`, importer flag) | shade `aok` |
| **normal (GI.z, new)** | oct-packed face normal | interpolated vertex normal (matches the analytic normal of 23 within the bilinear error) | rotated part normal | interpolated (flat by default; smooth only for groups the importer marks `smooth`) | light N.L, terrain face rows (26.4 `N.z < faceCos`) |
| **objectId (GI.w, new)** | `structSeq` | `0x7000 \| chunkIndex` | `0x8000 \| instanceSlot` | `structSeq` or entity slot | editor picking (24.6 reads it back instead of ray-vs-grid), `?debug=objects` |
| `depth` (SDEPTH) | perpendicular distance `d` = view-space forward component, written as `floatBitsToUint(vD)`; `0x7f800000u` where nothing was drawn | same | same | same | everything |
| `cov`, `mask` | written by resolve, unchanged | | | | |

Rule: the raster pass writes **exactly** what the DDA wrote for grid content, so `shade`/`edge` produce the same glyphs; phase 1 is judged on that (27.11). `GD` (derivatives) stays computed by the deriv pass from `u,v` (hardware derivatives `dFdx` are per 2x2 quad, not per glyph cell; never use them).

### 27.5 Camera and projection (`engine/render/projection.js`)

View basis from `cam` (4, `transform.js` formulas): `fwd = (sin yaw, -cos yaw, 0)`, `right = (cos yaw, sin yaw, 0)`, up = `(0,0,1)`; per vertex `r = dot(P - eye, right)`, `d = dot(P - eye, fwd)`, `h = P.z - eyeZ`. Screen (cell units) today: `sx = cols/2 + r/d * planeDistX`, `sy = horizonRow - h/d * planeDistY`, `horizonRow = rows/2 + tan(pitch) * planeDistY`, `planeDistX = cols / (2 tan(hfov/2))`. Clip coordinates with `w = d`:
```
x_clip = r * (2 planeDistX / cols)
y_clip = (h - d * tan(pitch)) * (2 planeDistY / rows)          // sign: +y up in NDC; the FBO row 0 = top is handled by the viewport flip the pipeline already uses
z_clip = (d * (F + N) - 2 F N) / (F - N),  w_clip = d          // N = 0.05 m, F = fogFull (2000 m); DEPTH_COMPONENT24
```
`shearProjection(cam, cols, rows, out16)` builds M = P * V from these; `unprojectCell(cam, col, row, dist, out)` is the inverse and **must equal `cellRayP`** (test: 1000 random (cell, dist) -> project(unproject) round-trips within 1e-9 cells; `rasterJS` uses the same matrix). Sub-sample grid: the viewport is `cols*n x rows*n`; pixel centre `(i+0.5)/n` = the 14.2 offsets by construction. Near plane: anything closer than 5 cm to the camera plane is clipped (today's rays start at the eye); capsule radius 0.3 m keeps walls out of that band; the far-plane check replaces `FOG_FULL` marching caps.
Depth precision: 24-bit with N = 0.05 gives ~1 cm at 30 m, ~12 cm at 100 m, ~3 m at 1500 m. Coplanar quads never happen within one mesh by construction (a cell has one floor); far terrain under the near band is excluded from the far index buffer (26.3-style), not depth-fought. If z-fighting shows up in phase 1 between a placed mesh and terrain, use polygon offset on terrain only (1 unit), never per-object hacks.
**Amended by 27.15.0 items 1 and 8:** engine row convention (cell rows sample at `row`, not `row + 0.5`) gives `y_clip = (d*tan(pitch) - h) * (2 planeDistY/rows) + d/rows` with no viewport flip, and `shearProjection` takes grid terms (cell aspect), not `(cols, rows)`.
**Amended by D-029 Amendment 2 (2026-09-30):** this shear model is the `renderer:'dda'` camera and the parity-pose camera only; `renderer:'mesh'` defaults to the pitched camera (28.1). ME-19 deletes this section's code (28.1 "ME-19 deletes").

### 27.6 Frames, transforms, draw list (uses `transform.js`, D-028)

- Every `MeshData` is in its own local frame; a `DrawItem` carries a 4x3 model matrix built once per placement (structures never move) or per frame (entities: yaw-only bodies -> `transformPoint` closed form, matrix = translation + yaw; voxel parts -> `voxelPose`'s 3x3 affine, the one matrix user allowed by coordinates.md 3). `Frame.yawSteps` for grid levels: the quad builder rotates the **mesh** at placement (`rotateLevel` bake of CO-4 is not needed for rendering any more; it remains needed for grid queries if a rotated grid level ever ships - 27.12).
- Uniforms per draw: `uModel` (mat4), `uObjectId`, `uStructSeq`, `uPart[8]` (voxel parts, one draw per instance with `ranges`), `uZRef` for terrain (0). No per-frame vertex uploads except: terrain band flip (one buffer update per changed chunk, <= 27 ms budget already owned by 26.1 item 3, amortised the same way), mesh edits in the editor (rebuild that mesh, ~1 ms for the tower).
- `DrawList.build(world, cam)`: frustum test each static item's world AABB (`frameBBox` + z range) against the shear frustum (`culling.js`: 4 planes + near/far in the (r, d, h) space); terrain chunks by ring distance (27.8); voxel instances from `VoxelPool.project` (already culls). Preallocated arrays; JS <= 0.3 ms at 200 items.
- Determinism/serialisation: the draw list is derived every frame; no renderer state enters saves. Entity state stays `transform` + `anim` (15.3).

### 27.7 Parity, types and test strategy (D-017, 14.2 item 8 extended)

1. **`rasterJS.js` conventions are pinned to what ANGLE/D3D11 and Mesa do:** vertices snapped to 1/256 pixel (8 sub-pixel bits) after projection; half-space edge functions in fixed point; **top-left fill rule**; sample at pixel centres; depth test `LESS` on the interpolated `z_clip/w`; attributes perspective-correct (`a/w` linear in screen, divided by `1/w`). A shared triangle edge is covered exactly once (test: a 2-triangle quad and a 200-triangle fan write every pixel exactly once, `writeCount == pixels`).
2. **What must match (`?gpucompare=1`, 160x60, n = 1, `?renderer=mesh` on both paths):** kind equal on >= 99.5 % of cells excluding 4-neighbour-kind edge cells; `mat`/`planeId` equal on matched cells; depth within 1 %; `u/v` within `1e-3 * depth`; normal within 1/32768 per component (packed) - float32 barycentrics vs float64 differ only in the last bits for a linear function; glyph >= 99 %, fg/bg +-4 (14.2 item 8). Edge cells are the rasteriser-dependent set and are already excluded.
3. **Migration oracle (phase 1 only):** `?gpucompare=mesh` renders every existing pose with `renderer: 'dda'` (GPU) and `renderer: 'mesh'` (GPU) and reports the same metrics with looser gates: kind >= 98 % excl. edge cells, glyph >= 97 %, plus a per-pose diff image (`tools/testing/` PNG writer exists for captures). Known legitimate differences must be listed per pose (e.g. thin-cap band BUG-CAST-001, terrain normal bilinear vs analytic) and stay < 1 % of cells.
4. **Node tests, per module:** `levelMesh.test.js` (every cell of `tower`/`test_room`: quad count and kinds equal the caster's sample kinds on a synthetic straight-down/straight-on cast; planeId formula equality; uv anchoring: moving the origin does not change uv), `terrainMesh.test.js` (heights at vertices == band values; skirt vertices below `minH - 1`; far cells under the band absent), `voxelMesh.test.js` (greedy quads cover exactly the exposed voxel faces; volume/face-count invariants on `quadruped12`/`post12`), `projection.test.js` (round trip with `cellRayP`), `rasterJS.test.js` (fill rule, watertightness, perspective-correct uv against the analytic ray-plane hit within 1e-6), `culling.test.js`, `bvh.test.js`, `meshCollide.test.js` (27.10), `glsl.test.js` string checks for the new shaders, `MeshBuffers.test.js` and `GpuCellPipeline` pass tests with the **mock `GpuDevice`** (alloc/free pairs, no per-frame buffer creation, descriptor reuse).
5. **Zero allocation:** `DrawList.build`, `rasterJS` per frame, `bvh` queries, `meshCollide` - `--expose-gc` probes as in `bench-cast.mjs`.
6. **Flicker:** `?flicker=1` runs on the mesh renderer; the coverage vote (resolve, unchanged) keeps the anti-shimmer. The changed-glyph share must not exceed the DDA renderer's share on the same poses by more than 10 % relative (phase-1 gate item).
7. **Types without a build step (owner, 2026-09-26): JSDoc + `// @ts-check`, verified by `tools/typecheck.mjs`.** Runtime stays plain ES modules. `tools/typecheck.mjs` runs `tsc --noEmit -p tools/tsconfig.json` (`allowJs`, `checkJs`, `noEmit`, `strict: false` + `noImplicitAny: false` at first, `lib: ["es2022","dom"]`, `types: []`); `typescript` is a **devDependency** (`package.json` with `devDependencies` only, `npx tsc` fallback; nothing at runtime, `check-deps` unchanged). `run-tests.mjs` gains a `typecheck` suite: **WARN** (non-zero exit does not fail the run) until the files in scope are clean, then **FAIL** (flip = one line in `tools/tsconfig.json` `include` + `run-tests.mjs`). Scope order: `engine/core/transform.js`, `engine/index.js` + `engine/dev.js` (public API typedefs), every new `engine/mesh/*`, `engine/physics/bvh.js`/`meshCollide.js`/`contacts.js`, `engine/render/projection.js`, `engine/render/gpu/device/*` - all written with `// @ts-check` from day one; older files opt in file by file (janitor chores), never a repo-wide flip. Rules: typedefs in the module that owns the data (5's "typedefs are normative"), `@param`/`@returns` on every export, `@type {Float32Array}` on typed-array fields, no `any` in exported signatures, no `.d.ts` files in `engine/` (JSDoc only, so the docs and the code stay one thing). Story ME-00 below.

### 27.8 Performance budget (owner Intel iGPU; n = 2; +-40 % until measured)

Fragments per frame in the raster pass = sub-sample pixels x overdraw (~2.5 with front-to-back sorted opaque draws): 240x90 -> 86k x 2.5 = 216k; 320x120 -> 384k; 400x150 -> 600k. Fragment cost: ~20 ALU + 4 MRT writes - trivial (< 0.2 ms even at 400x150). The pass is **vertex/setup bound**: ~150k triangles/frame worst case (tower 12k, props 30k, near band 74k before LOD, far ring 60k) at ~300-500 M tri/s on a UHD 620 = 0.3-0.5 ms; with terrain LOD (27.8 rings) ~90k tris.

| Grid | today p95 (25.0) | raster (replaces cast+terrain+voxel ~1.2-1.6 ms) | shadow map pass (phase 3, 1x2048 sun + 2 cube 6x256) | rest of pipeline (unchanged) | expected total p95 | budget |
|---|---|---|---|---|---|---|
| 240x90 | ~1.5 ms | 0.4-0.6 ms | +0.4-0.6 ms | ~0.6 ms | 1.4-1.8 ms | <= 2.5 ms |
| 320x120 | 2.0-2.4 ms | 0.5-0.7 ms | +0.4-0.6 ms | ~1.0 ms | 1.9-2.3 ms | <= 3.0 ms |
| 400x150 | 3.08 ms | 0.6-0.9 ms | +0.4-0.6 ms | ~1.6 ms | 2.6-3.1 ms | <= 4.0 ms (D-025 line) |

JS (8 ms budget, D-007/D-017): `DrawList.build` <= 0.3 ms, uniforms/draw calls <= 0.2 ms (<= 60 draws: 1 tower, <= 24 terrain chunks, <= 16 voxel instances, <= 8 meshes; WebGL2 per-draw overhead ~5-10 us each - if measured draw counts ever push this past 1 ms, that is a WebGPU trigger, 27.11 phase 4), sim <= 1.0 ms incl. mesh collision (27.10), terrain chunk mesh rebuild on flip <= 2 ms per rendered frame (row-granular, same amortisation as `bakeNearStep`). VRAM: meshes ~6 MB, sub-sample G-buffer +1 target (GI 16 B/px: +2.5 MB at 400x150 n=2), depth24 renderbuffer 2.9 MB, shadow maps 16 MB + 2x1.5 MB. **Terrain LOD:** ring 0 = near band chunks at 2 m (<= 9 chunks resident, only the 3x3 already baked); ring 1 = far grid at 8 m out to 512 m; ring 2 = far grid decimated 4:1 (32 m) to `FOG_FULL`; skirts hide ring seams; index buffers per ring rebuilt on band flip only. Draw order front-to-back per ring (early-z); the sky = cells left at `0x7f800000` (shade's kind-0 branch, unchanged).
Phase-1 gate numbers (27.11) are measured with `?bench=1` at 240x90 and 400x150, three views + the 60 s walk, `over25 == 0`.

### 27.9 Lighting and shadows on meshes (supersedes 25.1-25.3; D-027 needs an amendment, 27.14)

- **Sun:** `shadow` pass before `raster`: orthographic depth from the sun direction (`dirFromAzEl`) over a 192 m box centred on the eye, snapped to texel multiples (no crawl), 2048x2048 depth24, same draw list minus sprites, front faces, polygon offset (2, 4). Light pass: `P = cellRayP(...)`, `sunlit = depth(P) <= shadowDepth(P) + bias` with a fixed 2x2 PCF (deterministic, no rotation/noise) -> the existing `sunlit` bit; glyph ramp draws the penumbra. Terrain receives (US-070b) and casts (070c) with no extra work; voxel props cast (15.3 item 2 gap closed). Cost: one extra geometry pass ~0.3-0.5 ms (27.8).
- **Point lights:** top-2 by `col * falloff * N.L` per *frame* (JS picks the 2 lights nearest the eye, not per cell: shadow maps are per light) get cube depth maps 6x256x256 rendered only when the light moved or `structVersion`/animation changed (a carried lamp re-renders every frame: 6 small draws of the near geometry, ~0.2 ms); lookup in the light pass by manual fetch + explicit compare (works identically on WebGL2 and WebGPU); other lights unshadowed (today they are LVIS-shadowed at 1 m quantisation - the visible loss is small; D-027's `lighting: classic` becomes "no point-light shadows"). LVIS deleted in ME-19.
- **JS oracle:** `rasterJS` renders the same shadow maps (depth-only mode) with the same matrices; the light twin samples them identically. Parity metric: `sunlit` mismatch <= 0.5 % of lit cells excluding cells whose shadow-map texel depth is within `bias` of the surface (boundary set), as 14.3 item 7 today.
- **US-071 AO:** re-scoped to a per-cell **horizon AO over the G-buffer** (depth + normal, 8 fixed directions x 3 taps, deterministic, `LIGHT.w` bits 1..7 as 25.4) plus optional baked vertex AO from the importer; the sector-grid horizon math of 25.4(a) is dropped. **US-072 VPL:** the CPU bounce march uses `bvh.js` ray queries instead of `firstHitSectors`; otherwise 25.5 stands. **US-073 temporal:** unchanged (G-buffer only). **US-070d soft:** PCF radius from `light.size`/`sun.spread`, cheap.
- Do not: put shadow-map resolution or bias literals in GLSL (uniforms from `createEngine({ shadows })`), render shadow maps every frame for static lights, sample with hardware comparison filtering (parity: manual fetch + explicit compare in both twins), jitter.

### 27.9a ME-15 sun shadow map, implementation steps (architect, 2026-10-01)

**Adjustments to 27.9 (normative for ME-15).**
1. **Options, one place.** `createEngine({ shadows: { sun: 'map'|'dda'|false, res: 2048, boxM: 192, aheadM: 64, depthBias: [2, 4], biasM: 0.04, normalOffsetTexels: 1.5 } })`, defaults in `engine/render/shadowSun.js` `SUN_SHADOW_DEFAULTS` (frozen), merged once at engine creation. `sun` default: `'map'` on `renderer:'mesh'`, `'dda'` on `renderer:'dda'` and the CPU path (no 2048^2 JS raster per frame). `'map'` + `'dda'` renderer throws. `false` = sunlit everywhere. ME-19 deletes `'dda'`.
2. **Box centre (amends 28.1 A2 item 4).** Pitched RTS: `cam.focusX/Y/Z`. First person (no focus): `eye + Fh * aheadM`, `Fh` = horizontal unit forward from yaw, so the box covers ~32 m behind and ~160 m ahead (the visible ground), not 96 m of sky behind the player.
3. **Light basis and matrix.** `shadowSunMatrix(sunDir, centre, opts, worldZ, out)` -> `{M: Float64Array(16) world->clip ortho, texelM, planes: Float64Array(24)}` (preallocated `out`, zero alloc). Basis: `f = -sunDir`, `r = normalize(cross(f, up))` with `up = (0,0,1)`, or `(0,-1,0)` (north) when `|sunDir.z| > 0.999`; `u = cross(r, f)`. Light-space xy half-size = `boxM/2`; `texelM = boxM/res`. **Snapping:** the centre's light-space r/u coordinates are floored to multiples of `texelM` before building M (moving the eye less than a texel leaves M bit-identical; moving one texel shifts every caster exactly one texel). **Depth range:** near/far = min/max of `dot(corner, f)` over the 8 corners of `[c +- boxM/2] x [worldZ.min - 1, worldZ.max + 1]` (world z range from terrain + structure bounds, cached on `structVersion`), so casters upstream of the box (a tower outside it at low sun) are inside the frustum. Not snapped in depth.
4. **Casters = a second draw list.** The camera `DrawList` is frustum-culled to the view and misses casters behind the camera. `buildShadowList(list, cameraList, world, planes)` (new `engine/mesh/shadowList.js`): same item builders as the camera list, culled with `classifyAABB(planes, ...)` on the shadow planes, same LOD per item as the camera list where present, else LOD by distance from the box centre; sprites and kind 0 excluded; terrain chunks and voxel props included (closes 15.3 item 2). Max `MAX_DRAW_ITEMS`; overflow drops farthest-from-centre first (deterministic).
5. **Bias (0.125-2 m terrain detail).** `texelM` = 0.094 m at defaults, finer than the smallest terrain detail, so acne comes from slope, not size: caster side = polygon offset `depthBias` (factor 2, units 4) on GPU and the same formula in `rasterJS` (its existing `biasAdd` path, parametrised); receiver side = `P' = P + N * normalOffsetTexels * texelM + sunDir * biasM`, then project. No other bias. Receivers outside the box (uv or depth outside [0,1]) are sunlit.
6. **PCF, quantised.** 4 nearest-texel taps at `floor(uv*res - 0.5) + {0,1}^2` (no bilinear weights): `n` = taps with `depth(P') <= mapDepth`; `sunFrac = n/4`; sun term `*= sunFrac`; `sunlit bit = n >= 2`. `LIGHT.w` bits 16..18 = `n` (bits 1..7 stay reserved for AO, 25.4). Terrain (kind 7) gets the taps too: the light pass writes `n` for it, and the shade pass terrain branch multiplies its analytic sun term by `n/4` (US-070b). The same in the JS shade twin.
7. **GpuDevice.** `PipelineDesc.depthBias?: {factor, units}` (GL2: `POLYGON_OFFSET_FILL` on bind, off after); `TargetDesc.color: []` allowed (depth-only FBO, `drawBuffers([NONE])`); `fragment.targets: 0`. `depth24` textures are created `NEAREST`, `TEXTURE_COMPARE_MODE = NONE` and sampled with `texelFetch` on a `sampler2D` (`.r`). The shadow pass reuses `mesh.vert.js` / `terrain.vert.js` / the instanced variant with `uViewProj = M_sun` and a new `shadow.frag.js` (empty main); no new vertex shader. Pass order: `shadow` -> `raster` -> ... -> `light`.
8. **Uniforms (light pass).** `uSunShadowM` (mat4, float32 copy of M), `uSunShadowRes`, `uSunShadowTexelM`, `uSunShadowBiasM`, `uSunShadowNormalOff`, `uSunMode` (0 off, 1 dda, 2 map); texture slot `uSunShadow`. One shader, branch on `uSunMode` (no permutation).
9. **JS twin.** `rasterJS` gets `createRasterTarget(res, res, 1, {depthOnly: true})` (allocates `zbuf` only, skips attribute interpolation) and `ctx.depthBias`. `shadowSun.js` `sunShadowTaps(map, M, P, N, opts) -> n` is the one lookup used by `lighting.js` when mode is `'map'`; float64 in JS vs float32 on GPU, hence the boundary set. Node tests run at `res: 512`.
10. **Parity.** Depth (15b): GPU depth copied to `r32ui` by a test-only `texelFetch` pass (depth24 cannot be `readPixels`'d), compared to the JS `zbuf` quantised to 24 bit: `|dz| <= 16 * 2^-24` on >= 99.5 % of texels covered by both; coverage mismatch <= 0.3 % of texels (edges). Light (15c): `sunlit` mismatch <= 0.5 % of lit cells excluding the boundary set (any tap with `|depth(P') - mapDepth| <= 2 * biasM` in depth units, or `uv*res` within 0.01 of a texel edge), `n` mismatch <= 1 %, `dL <= 1e-3` elsewhere (14.3 item 7).
11. **gpucompare baselines.** dda-vs-mesh parity poses pin `shadows.sun: 'dda'` (as they pin `projection:'shear'`, A2 item 8): results unchanged. Mesh-only poses (existing pitched/RTS ones and the new ones) run `'map'` and compare GPU vs the JS twin at the 27.7 item 2 bars + item 10; they are re-baselined once in 15c, with a capture PNG per new pose for the owner. New poses: `towerShadowGrass` (signal tower shadow on terrain, sun az 135 el 30), `leverSunShaft` (voxel lever lit through a doorway, part shadow), `burnerShadowFloor` (crash room, burner casts on floor), `rtsHill58Shadow` (pitched, focus-centred box), `fpBoxEdge` (first person looking at the box edge 160 m ahead: lit beyond, no seam inside fog).
12. **Perf (owner Intel iGPU).** Shadow pass + lookup: GPU p95 delta <= +1.0 ms vs the pre-ME-15 baseline at `outsideFar`, `rtsHill58` and `crash room` (the sun DDA removal is expected to give some back); CPU `shadowSunMatrix` + `buildShadowList` <= 0.15 ms p95, zero allocations per frame (bench-cast `--gc` 0 B). If over budget, the order of fallbacks is: `res: 1536`, then dirty-skip (15d), never jitter or temporal tricks.
13. **Do not:** use hardware compare / `sampler2DShadow`; use the camera draw list for casters; snap in depth; put the sun matrix math in GLSL; add `shadows` reads outside engine creation and `shadowSun.js`.

**Steps** (each <= 1 programmer-day; GLSL/GPU = PC-A; pure-JS steps may go to PC-B cross-track, ending in `arch-review`).
- **ME-15a** (PC-B possible, cross-track) `engine/render/shadowSun.js` (defaults, `shadowSunMatrix`, `sunShadowTaps`) + `engine/mesh/shadowList.js` + `rasterJS` depth-only + `ctx.depthBias`. ACs: (1) snapping: eye moves of 0.3 texel give a bit-identical M, a 1-texel move shifts a test point's uv by exactly 1/res; (2) a 40 m tower 30 m upstream outside the xy box is inside the depth range and `classifyAABB` != OUT; (3) caster behind the camera is in the shadow list, not in the camera list; (4) JS depth-only raster of a fixture (box on a plane, res 512) gives `sunShadowTaps` n = 0 under the box, 4 in the open, 1..3 only on the edge band; (5) zero alloc per call (gc probe) and check-deps clean (shadowSun.js imports only render/mesh leaves).
- **ME-15b** (PC-A) GpuDevice `depthBias` + depth-only target + depth24 sampling, `shadow.frag.js`, shadow pass in `GpuCellPipeline` (behind `uSunMode == 2`), `createEngine({shadows})` plumbing, test-only depth copy + depth parity in gpucompare. ACs: (1) `GpuDevice.test.js` covers the new desc fields; (2) depth parity per item 10 on `signal tower`, `crash room`, `rtsHill58`; (3) `?shadows=0` / `sun:'dda'` renders bit-identical to before (all existing poses unchanged); (4) no GL errors, pass shows in the GPU timer.
- **ME-15c** (PC-A) light-pass lookup (GLSL + `lighting.js` twin), `LIGHT.w` bits 16..18, terrain receive in shade pass + JS shade twin, poses of item 11, re-baseline. ACs: (1) light parity per item 10 on all new poses; (2) dda-vs-mesh poses unchanged with `'dda'` pinned; (3) tower shadow visible on grass in `towerShadowGrass` capture (owner-visible, PO check); (4) no shadow seam inside the fog distance at `fpBoxEdge`; (5) US-070b/070c ACs met on mesh.
- **ME-15d** (PC-A) perf: bench numbers per item 12 on the owner iGPU, GPU timer per pass in the perf HUD, and dirty-skip: re-render the map only when the key (snapped centre, sunDir, shadow list items' mesh ids + matrices hash, `structVersion`) changes. ACs: (1) p95 deltas within item 12 at the three poses; (2) static scene: map rendered once over 120 frames (counter); (3) moving boulder/lever re-renders every frame it moves; (4) parity poses still pass with skip on.

**27.9a amendment (ME-15a review, 2026-10-01).**
- **Item 3 depth range was too short at low sun (bug in the note, confirmed by probe):** the 8 world-box corners bound the *receivers*, not the casters above them. A caster on the sun ray from a world-box receiver sits up to `(z1 - z0) * (1 - sz^2) / sz` nearer the sun than the nearest corner (`sz = sunDir.z`, `z0/z1` = `worldZ.min - 1 / max + 1`); at `boxM 64, el 30` the AC-2 tower is near-clipped from 5 m up. **Rule:** `dmin -= (z1 - z0) * (1 - sz*sz) / Math.max(sz, 0.05)` after the corner loop (`dmax` unchanged: casters farther than the receiver never shadow it). Receivers outside the world box but inside the frustum may see clipped casters - they are far and stay "sunlit by default" territory. AC 2 must assert the tower **top** (`clip z >= -1`, top-slab `classifyAABB != OUT`).
- **Depth-range centre quantum (8 m, `round`, box grown by 8 m) accepted:** it is what makes AC 1 (bit-identical M under sub-texel moves) hold; M changes at 4 m boundaries by a uniform depth rescale only (same M on both twins, no texel shift). Not snapping in depth still holds.
- **rasterJS depth-only must near-clip** (`zn < -1 -> skip`, depth-only branch only): the GPU clips `z_ndc < -1`; the JS camera path has no near clip today and stays as it is (gpucompare-validated).
- **`sunShadowTaps` conventions accepted:** sunDir recovered from the depth row of `M` (`-M[2,6,10]` normalised), compare in NDC z (GPU compares `depth01 = (z+1)/2`, monotone), taps outside the map and receivers outside `uv/depth [0,1]` = sunlit. GLSL (15c) may use `uSunDir` instead of re-normalising `M`'s row: the resulting `P'` difference is ~1e-7 m, inside the item-10 boundary set. GLSL **must** bounds-check taps explicitly: WebGL2 `texelFetch` out of range returns 0 = nearest = "shadowed", the opposite of the JS rule.
- **`buildShadowList(list, cameraList, world, planes, src)`** (`src = {centre, cache, terrainSet, voxelPool, voxelMeshCache, fogFarM}`) accepted; capacity 1024 then trim to `MAX_DRAW_ITEMS` farthest-first. `syncTerrainLod` is O(terrain x camera items); if ME-15d's bench puts the builder over 0.15 ms, index the camera list by `objectId`.
- **Known caster gaps (accepted for 15a, closed in 15c):** (a) `DRAW_INSTANCED` RE-06 groups are not in the shadow list; 15c adds them with the group's full (camera-unculled) instance buffer - units in the sun need shadows; (b) voxel props come from the pool the caller passes, and `VoxelPool.project` drops off-screen props: 15c must feed a pool projected (or simply not culled) against the shadow planes, or props behind the player cast nothing with the sun at the player's back.
- **structFoot carve kept in depth-only** accepted (caster == receiver geometry under structures).

**27.9a amendment 2 (ME-15b review, 2026-10-01).**
- **Item 10 depth bar replaced (measured: flat 16 ULP fails 0.4-2.3 % of co-covered texels, all on steep slopes, < 0.02 texel sample-position error):** pass iff `|dk| <= 16 + 0.05 * s` on >= 99.9 % of co-covered texels and coverage mismatch <= 0.3 % of all texels, where `s` = local JS slope in 24-bit codes per texel = **max over the x and y axes of min(|left step|, |right step|)** (covered neighbours only; one covered side -> that side; none -> 0). The two-sided min keeps a silhouette's one-sided depth jump from widening the tolerance on edge texels. `within16Pct` stays reported (informational). The 15c light bar is unchanged.
- **Opt-in until 15c:** the mesh default stays `sun:'dda'` and `'map'` is opt-in (`?shadows=map`) until ME-15c reads the map; 15c restores item 1's default (`'map'` on mesh) and moves the URL read into main.js's `createEngine({shadows})` call (the pipeline takes `engine.shadows` only). The item-12 budget is measured after 15c (DDA sun removed), not on 15b's additive cost.
- **Raw GL in `_passShadow`** (like `_passRaster`, check-deps rule 9 WARN) accepted; both move behind `GpuDevice` together in one later device step, not piecemeal. `GpuDevice.beginPass` now sets the viewport to the target size and unmasks depth before clearing (only shadow/copy targets use it today); `beginPass`/`clear` must be allocation-free (constant clear values, no per-call arrays).

**27.9a amendment 3 (ME-15c review, 2026-10-01).**
- **Default flip moves to ME-15d.** `'map'` stays opt-in (`?renderer=mesh&shadows=map`, read once in main.js's `createEngine({shadows})`, as amendment 2 asked) until ME-15d meets item 12 and the owner ME-12 walk-test is done; ME-15d's last AC flips item 1's default (`'map'` on mesh) and removes the `sun:'dda'` pin in `rtsMain.js` (gpucompare's dda-vs-mesh `pipelineMesh` pin stays until ME-19).
- **Terrain light-pass normal = `GI.z`** (both renderers write the terrain's packed normal there; GPU `GA.w` is +Inf for kind 7) is the correct twin of `lighting.js`'s `FACE_PACKED` decode of the `aoD` alias; the old `GA.w` decode was a latent point-light N.L bug on terrain, not a behaviour to preserve.
- **Item 12 is not re-based.** The +1.0 ms GPU p95 bar already nets the sun-DDA saving (amendment 2) and stays. ME-15d measures two rows per pose: dirty-skip on (static, the gate) and forced re-render every frame (the moving-caster worst case, must be <= +1.5 ms); fallbacks in order: dirty-skip, shadow-list terrain LOD by distance from the box centre (ring 1 / 8 m beyond ~48 m from the centre is enough for a 0.094 m-texel map's casters), then `res: 1536`. Never jitter/temporal.
- **Zero alloc in `VoxelPool.projectShadow`:** posed records live in a never-shrinking slot array; `shadowList` only holds references (setting `length` down on the record array drops them and re-allocates when the prop count grows back).

**27.9a amendment 4 (ME-15d review, 2026-10-02).**
- **Dirty-skip key = `shadowInputHash`** (shadowSun.js): snapped `M` (exact bits), `structVersion`, list count, per item mesh identity (WeakMap id) + `meshVersion` + type + range + matrix, voxel/instanced part matrices, RE-06 instance rows (3x4 only; `iMeta` does not move depth). Rule for new caster inputs: anything that changes caster depth must either bump `meshVersion`/`structVersion` or be in an item field the hash reads; uniforms of the shadow programs must stay functions of `M` + the list (today: `uStructFoot` <- `structVersion`). Context restore resets the key (`_initGL`).
- **Pose quantisation accepted** (deviation from AC 3 "every frame it moves"): translation step `0.02 m` (~1/4 texel); the linear part's step must be extent-aware, `step <= tStepM / r` with `r` the item's half-extent (min 256 per unit), so the at-rest staleness stays <= ~1/4 texel for big rotated meshes too (fixed 1/256 gives r/512 m, > `biasM` beyond ~20 m). AC 3 reads: re-render on every frame the pose moves by >= one quantum.
- **CPU cost:** the hash is in the 0.15 ms item-12 CPU bar (stats `shadowCpuMs`).
- **Default flip** is a separate step **ME-15e** (one line in createEngine defaults use + drop the `rtsMain.js` `sun:'dda'` pin), gated on the owner-iGPU route-walk rows (skip on <= +1.0, forced <= +1.5 ms p95); the dGPU numbers are not the item-12 gate.

**27.9a amendment 5 (ME-15e review, 2026-10-05): forest casters, step ME-15f.**
Measured (docs/test-reports/ME-15e.md): the map misses item 12 only with the forest on (+6.7..10 ms skip, +11..15 forced, Arc p95; forest off +0.8 ms). Resolution barely helps, so the pass is vertex bound: `buildShadowList` pushes every RE-06/scatter group with its **full** `g.ib` at **LOD0** (~554 tree instances, no per-instance cull). Fallback order of amendment 3 is replaced for instanced groups by:
1. **Per-instance bands from the camera eye** (horizontal distance eye -> instance translation, words 3/7): `d <= meshLod0M` -> LOD0; `d <= instCastM` -> LOD1 (`cache.get(pm, key, names, 1)`, the mesh the camera's RE-15c LOD1 uses; if it is unavailable, LOD0); farther -> **no sun shadow**. Hysteresis +-2 m via a per-group `shadowBand: Uint8Array(capacity)` (0/1/2, like `lodPrev`). Same loop also drops instances whose sphere (`g._R`) is outside the shadow planes. Eye, not box centre: shadow detail matters next to the viewer.
2. **Options** in `SUN_SHADOW_DEFAULTS`: `meshLod0M: 25` (the same option ALPHA-01e/37.17 item 8 names for mesh groups: one option for both), `instCastM: 48`. Dev override `?shadowinst=N` in main.js (as `?shadowres`). Values reach `buildShadowList` as `src.eye {x,y}`, `src.meshLod0M`, `src.instCastM` from the two call sites (compositor + GpuCellPipeline); no `shadows` read anywhere else (item 13).
3. **Storage:** engine-owned `g.shadowIb: [InstanceBuffer, InstanceBuffer]` + `g.shadowCount: [n0, n1]`, created with the group (same capacity). The camera's `drawIb/drawCount` and its frame memo are never touched. Zero alloc per frame.
4. **Dirty-skip:** no change. `shadowInputHash` already reads the list item's instance rows + count, so a band change re-renders the map.
5. Unchanged: non-instanced items, `castShadow:false` groups, terrain (ring LOD stays an unused fallback: forest-off is in the bar), resolution 2048. Never jitter/temporal.

**ME-15f** (PC-B engine cross-track possible, pure JS, ~0.5 d -> opus arch-review; bench on PC-A Arc). Files: `engine/mesh/shadowList.js`, `engine/mesh/instances.js` (group fields), `engine/render/shadowSun.js` (defaults + validation: `0 < meshLod0M <= instCastM`), `engine/render/compositor.js` + `gpu/GpuCellPipeline.js` (src fields), `game/js/main.js` (`?shadowinst`). Tests (`shadowList.test.js`): N instances at known distances -> exact LOD0/LOD1/none counts; hysteresis at 25 +- 1 m keeps the previous band; compacted rows bit-equal to the source rows; an instance outside the shadow planes is dropped; camera `drawIb/drawCount` unchanged after a build; 0 alloc over 1000 builds; `castShadow:false` still absent. gpucompare `&shadows=map`: no new map-only FAIL (forestWalk may be re-baselined once, old/new counts in the row).
**Switch condition (ME-15e flip, unblocks ME-19c):** Arc route walk, forest on: map dirty-skip GPU p95 <= dda p95 + 1.0 ms and `--noskip 1` <= + 1.5 ms, plus an owner one-look at forestWalk (tree shadows ending at 48 m inside the haze). If missed: bench `?shadowinst=32`; if 32 passes and the owner accepts the look, ship 32; otherwise ME-15g = a shadow-only coarse hull per voxel model (parts downsampled 4x, meshed once at bind) for the LOD1 band, separate note.

### 27.10 Physics plan (phase 2; D-018 stays valid; the Rapier seam)

**Keep physics separable (owner, 2026-09-30; guideline, not a hard rule):** `engine/physics/` should stay stand-alone so it could be split into its own package later (same repo for now). New physics code imports only from `engine/physics/` itself; anything it needs from the world, entities or the player comes in as data or callbacks. Known exceptions today (move them out when those files are touched anyway): `integrate.js` -> `entities/EyeFeel.js`, `core/math.js`; `roller.js` -> `core/transform.js`, `world/gridLocal.js`. Tests may keep using game content. Other modules may import physics freely.

- **`bvh.js`:** static AABB tree over triangles of one collider (`MeshData` + world matrix baked at build), flat arrays (`nodeMin/Max Float32Array`, `nodeChild Int32Array`, `triIdx`), deterministic build (median split on the longest axis, leaf <= 4 tris), queries `queryAABB(bvh, box, outTriList)`, `raycast(bvh, o, d, tMax, out)`, `segment(...)`. Tower: 12k tris -> ~6k nodes, build ~5 ms at load. Voxel props: one BVH per model *part* in model space, instance matrix inverted per query (rigid parts).
- **`meshCollide.js` (ours, JS, now):** *(superseded for the walking capsule/roller by 27.17's banded 2.5D twin of `moveCapsule`, and for World wiring by 27.18; the free 3D contact part moved to `contacts.js`)* `moveCapsuleMesh(world, x, y, z, dx, dy, dz, radius, height, grounded, cfg, out)` with the same `out` contract as `moveCapsule` (position, grounded flag, hit normal, floorZ): (1) gather candidate triangles from every collider whose AABB overlaps the swept capsule box (walkable structures + props; terrain is *not* here); (2) 4 push-out iterations: closest point segment-triangle, penetration along the triangle normal (or the closest-feature direction for edges), slide; (3) ground probe: sweep down `stepUpMax + 0.05` from the capsule bottom, walkable iff `n.z >= cos(maxSlopeDeg)` (`cfg.maxSlopeDeg`, default 50, same number as terrain 23.3), else slide as 23.3; (4) step-up: when blocked horizontally while grounded, retry from `z + stepUpMax` and sweep down (never airborne, US-009 AC7 preserved). Terrain: `groundAt` heightfield (23) merged as `floorZ = max(meshFloor, terrainFloor)` - the capsule stands on whichever is higher; the tower floor mesh over terrain therefore needs no special ring rule (BUG-OWN-008's physics side also disappears).
- **Boulder/rollers:** `moveSphere` -> sphere-vs-BVH (subset of the above); tilt/`layers.tilt` stays grid data. **Grate (sector anims):** the collider of an animated cell group is a separate small BVH toggled/moved with the anim state (`level.dynamics`), serialised as today. **Interaction/triggers/`sectorAt`:** unchanged (grid content queries).
- **The Rapier seam (owner: own walking collision now, Rust->WASM rigid bodies later if D-018's gate fails or scope grows).** `engine/physics/contacts.js` defines the one contact API that rigid bodies use: `World.contacts(shape: {type:'sphere'|'capsule', x,y,z, r, h?}, out: ContactList)` (points, normals, depths, `colliderId`, `triIdx`; preallocated `ContactList`), and `World.colliders[]` exposes each static collider as `{ id, kind:'trimesh'|'heightfield', pos: Float32Array, idx: Uint32Array|null, frame }`. `rigid.js` (US-051) consumes **only** `contacts()`; a Rapier backend would be `engine/physics/rigidRapier.js` implementing the same `stepBodies(world, dt)`/`bodyState` interface, mirroring `world.colliders[]` into Rapier trimesh/heightfield colliders once at load (the flat arrays are exactly what Rapier's `TriMesh` takes) and writing poses back into the same serialisable body records. Rule: nothing in `rigid.js`, `roller.js` or the player touches triangles, BVH nodes or a physics-engine object directly; save state stays our JSON (a Rapier snapshot is never the save). No Rapier story now (D-018 item 3 unchanged: the gate decides).
- Tests (Node): capsule on a flat quad, against a wall (push-out exact within 1e-6), 30/49/51 degree ramps (walk/walk/slide), 0.3 m step (up), 0.6 m step (blocked), lintel (head clearance), doorway, stairs from `tower` via `levelMesh` (the US-008/009 suites re-run against the mesh collider and must give the same grounded/position traces within 1 cm), 600-step replay determinism (bit-equal twice), zero allocation, `worldWalk.perf.test.js` sim <= 1 ms, `contacts.test.js` (manifold vs brute force on 1000 random spheres).

### 27.11 Phases, gates, story list

Sizes are programmer-days for one programmer (PC-B = sonnet from these notes, Node-only; PC-A = GPU/render core + owner-GPU checks). Every engine story: architect tech-note addendum in the story row, ARCH review, `node tools/run-tests.mjs` + `check-deps` green; GPU stories add `?gpucompare=1` on the owner GPU. New engine files carry `// @ts-check` (27.7 item 7).

**Phase 0 - groundwork (starts now, no gate).**

| # | Story | Phase | Size | Depends | PC |
|---|---|---|---|---|---|
| ME-00 | `tools/typecheck.mjs` + `tools/tsconfig.json` + `package.json` devDependency, `run-tests.mjs` WARN suite; `// @ts-check` + full JSDoc on `engine/core/transform.js`, `engine/index.js`, `engine/dev.js`, `engine/render/GBuffer.js`; typedef fixes they reveal; doc line in 11 | 0 | 1.5 d | - | PC-B |

**Phase 1 - "tower + terrain + props as meshes, side by side" (`?renderer=mesh`; gate = owner compares look + speed).**

| # | Story | Phase | Size | Depends | PC |
|---|---|---|---|---|---|
| ME-01 | `MeshData` format/validator/packer + `levelMesh.js` grid->quads (kinds, planeId formula, uv, zRef, aoEdgeBits; grates as alpha-tested quads flagged `mask`) + tests | 1 | 2 d | CO-1, ME-00 | PC-B |
| ME-02 | `projection.js` shear matrix + `unprojectCell` == `cellRayP` round-trip test; `culling.js` frustum for the shear camera | 1 | 1 d | ME-00 | PC-B |
| ME-03 | `rasterJS.js` reference rasteriser (fill rule, 1/256 snap, perspective-correct, depth) + `DrawList.js` + tests (27.7 items 1, 4) | 1 | 3 d | ME-01, ME-02 | PC-B |
| ME-03b | `GpuDevice` interface + `GpuDeviceGL2` (wrap `glUtil/gridTargets/GpuTimer`, no behaviour change: `?gpucompare=1` identical) + mock device for Node; `check-deps` rule "only `device/*` touches `gl.`" as WARN | 1 | 2 d | ME-00 | PC-A (PC-B may do the mock + tests) |
| ME-04 | GPU `raster` pass: `mesh.vert/frag`, MRT 4 (GI -> RGBA32UI, normal/objectId), depth24 attachment on the sub-sample target, `MeshBuffers.js`, `renderer: 'mesh'` option skipping A1-A3, light/shade read the normal from GI.z; `glsl.test.js`, mock-device alloc test; tower renders via `?renderer=mesh` | 1 | 4 d | ME-01..03, ME-03b | PC-A |
| ME-05 | `terrainMesh.js`: band chunks (indexed, smooth normals), far rings + skirts, far-under-band exclusion, rebuild on flip within 2 ms/frame; JS twin for kind 7 (u,v = world xy, normal from GI.z); tests | 1 | 2 d | ME-01, 26 S1 (band double buffer) | PC-B |
| ME-06 | terrain in the GPU raster pass (`terrain.vert`), `shade.frag` kind-7 normal source, `?gpucompare=1` mesh poses + `?gpucompare=mesh` migration compare with diff images, bench at 240x90/400x150 | 1 | 2 d | ME-04, ME-05 | PC-A |
| ME-07 | `voxelMesh.js` greedy mesher per part, planeId layer rule, part matrices from `voxelPose`; tests on the fixtures | 1 | 2 d | ME-01 | PC-B |
| ME-08 | voxel meshes in the raster pass (per-instance `uPart[8]`, face code from the rotated normal), prop poses in gpucompare, phase-1 side-by-side page (`?renderer=mesh` vs `dda`, F3 pass times), gate report in the story | 1 | 1.5 d | ME-04, ME-07 | PC-A |

Phase 0+1 total ~21 d (PC-B ~12 d can run ahead while PC-A finishes sprint 3/CO-2/3); **~2-2.5 calendar weeks.**

**Phase-1 go/no-go gate (owner + architect, recorded in a D-029 amendment):** (a) look: owner side-by-side on 6 poses (crash room, stairs, brazier, breach, hillside outside, waystone) - "same or better", no seam at the tower foot, no grass through the base, no new shimmer (`?flicker=1` within +10 % relative); (b) parity: `?gpucompare=1` all mesh poses PASS on the owner GPU; `?gpucompare=mesh` kind >= 98 % / glyph >= 97 % excl. edge cells with every remaining difference explained; (c) speed: `?bench=1` GPU p95 at 400x150 <= today's 3.08 ms + 0.3 ms and at 240x90 <= 1.8 ms, JS <= 8 ms, `over25 == 0` on the walk; (d) Node suites + check-deps + typecheck green, no new per-frame allocation. **Go** -> phase 2. **No-go** -> the mesh branch is parked (`?renderer=mesh` stays as an experiment, no deletions), sprint 4 continues on the hybrid; a second attempt needs a manager decision.

**Phase 2 - "capsule vs mesh, gameplay unchanged" (gate = owner walk-test).**

| # | Story | Phase | Size | Depends | PC |
|---|---|---|---|---|---|
| ME-09 | `bvh.js` build/query (AABB, ray, segment), deterministic, flat arrays; tests + zero-alloc probe | 2 | 1.5 d | ME-01 | PC-B |
| ME-10 | `meshCollide.js` capsule/sphere vs triangles, push-out, ground probe, slope, step-up; the 27.10 test matrix incl. US-008/009 suites re-run on `tower` via `levelMesh` | 2 | 3 d | ME-09 | PC-B |
| ME-11 | `World` integration: `world.colliders[]` (structures, props, grate dynamics), `contacts.js` API (the Rapier seam), `integrate`/`roller` route through `World.collide*` when `physics: 'mesh'`, terrain floor merge, save round-trip, 600-step replay determinism, `worldWalk.perf` sim <= 1 ms | 2 | 2.5 d | ME-10 | PC-B |
| ME-12 | browser pass + fixes + gate report: wake -> stairs -> lever/grate -> boulder -> breach -> hillside -> waystone on `?renderer=mesh&physics=mesh`; F3 sim times; owner walk-test | 2 | 1.5 d | ME-11, ME-08 | PC-A |

Phase 2 total ~8.5 d; **~1-1.5 calendar weeks.** **Phase-2 gate:** owner walk-test "plays the same" (no new snags on stairs/doorways/lintels, grate blocks/opens, boulder rolls and stops as before, terrain walk-out unchanged), sim <= 1 ms p95 in `?bench=1`, replay determinism test green, save/load round trip green. Go -> phase 3 (deletion allowed at ME-19). No-go after one fix round -> manager decision (keep grid physics for grid levels + mesh physics only for glTF structures is the fallback; it is not free: two collision paths).

**Phase 3 - "glTF, shadow maps, editor on meshes, delete the casters".**

| # | Story | Phase | Size | Depends | PC |
|---|---|---|---|---|---|
| ME-13 | `gltf.js` (.glb/.gltf static nodes, axis conversion, smoothing groups, material-name map, validator) + `tools/gltf-import.mjs` -> `.mesh.json`; tests on a committed 2-storey test building (designer/Blender) | 3 | 2.5 d | ME-01 | PC-B |
| ME-14 | content: `structures[].mesh` placement (`Frame` + `yawDeg`), manifest kind `mesh`, `loadPack`, `validate-content` rules, chunk `components.mesh`; World builds DrawItems + colliders from it | 3 | 1.5 d | ME-13, ME-11, CO-2 | PC-B |
| ME-15 | sun shadow map pass + light-pass lookup (replaces the sun DDA), `rasterJS` shadow twin, parity metric + poses (`tower shadow on grass`, `lever in sun shaft`, `burner shadow on floor`); D-027 070b/070c satisfied | 3 | 3 d | ME-06 | PC-A |
| ME-16 | point-light cube shadow maps for the top-2 lights, carried-lamp re-render rule, LVIS retired from the light pass (`lighting: classic` = no point shadows) | 3 | 2 d | ME-15 | PC-A |
| ME-17 | culling + terrain LOD rings + front-to-back order + `?bench=1` at 240x90 / 320x120 / 400x150; budget sign-off (27.8 table filled with measured numbers, per-draw overhead recorded as the WebGPU trigger baseline) | 3 | 1.5 d | ME-06 | PC-A |
| ME-18 | editor on meshes: pick via `GI.w` objectId readback (`pick.js`), mesh structure place/move/rotate (`yawDeg`) + panel, asset library thumbnails for meshes, live rebuild of an edited level mesh (`AssetRegistry.replace` -> `buildLevelMesh`) | 3 | 2.5 d | ME-14, US-067 | PC-B |
| ME-19 | **delete the old renderers**: `sectorCaster/terrainCaster/voxelMarch(render)`, `dda/terrain/voxel.frag`, `WorldTextures` geometry atlas, `VoxelTextures`, `OpenSpans`, LVIS, `?renderer`, CPU-only shading paths US-049 lists; docs: 14.2/14.4/15.2/25.1-25.3 marked historical, sections 7-8 updated; `check-deps` `device/*` rule flipped to FAIL; all suites; `?gpucompare=1` unchanged results | 3 | 2 d | ME-15, ME-16, phase-2 gate | PC-A |
| ME-20 | US-071 re-scoped: horizon AO over the G-buffer (light pass, JS twin) + importer vertex AO | 3 | 1.5 d | ME-15 | PC-B (JS) + PC-A (GLSL 0.5 d) |
| ME-21 | proof content: the 2-storey glTF building placed on the hillside with a door and stairs; walk in, up, out; designer + PO story, one programmer day for wiring/fixes | 3 | 1 d (+design) | ME-14, ME-12 | PC-A |

Phase 3 total ~19 d; **~2.5-3 calendar weeks** with both PCs.

**Phase 4 - "WebGPU where available" (LATER: after ME-19 ships on WebGL2; sketch level; no story starts before a trigger fires).** Triggers (any one, measured and recorded in the story): a compute-heavy feature is scheduled (GPU culling/indirect draws for the open world, particles US-053 on the GPU, many shadow-casting lights, many physics bodies needing GPU broadphase), or ME-17's measured WebGL2 per-draw/upload overhead exceeds 1 ms JS at the target draw counts, or WebGPU availability on the owner's target platforms (Electron/Chromium: yes; browser demo: partial).

| # | Story | Phase | Size | Depends | PC |
|---|---|---|---|---|---|
| ME-30 | `GpuDeviceWebGPU.js`: buffers/textures/targets/pipelines/timers over `navigator.gpu`, uint MRT formats (`rgba32uint`, `r32uint`, `depth24plus`), uniform buffers from the same typed-array views, `readback` via staging buffers; self-test (`caps`, a 4x4 MRT draw + readback) | 4 | 3 d | ME-19 | PC-A |
| ME-31 | WGSL ports: `mesh/terrain/shadow` raster shaders + `resolve/deriv/light/shade/edge/sprites` cell passes (the `src.wgsl` slot of every pipeline); `glsl.test.js`-style string checks (same constants, no `round`, uint hashes) | 4 | 5 d | ME-30 | PC-A |
| ME-32 | runtime pick: `createEngine({ backend: 'auto' \| 'webgl2' \| 'webgpu' })`, `?backend=` override, auto = WebGPU if present **and** the self-test passes, else WebGL2; the WebGL2-required screen (US-045) gains the "WebGPU unavailable, using WebGL2" info line; F3 shows the backend | 4 | 1 d | ME-30 | PC-B |
| ME-33 | cross-backend parity `?gpucompare=backends`: both backends render every pose from the same draw list; cells must match at the 14.2 item 8 thresholds (glyph >= 99 %, fg/bg +-4, geometry as 27.7 item 2); the JS twin stays the oracle for both | 4 | 2 d | ME-31, ME-32 | PC-A |
| ME-34 | first compute use (the trigger's feature): e.g. GPU frustum culling + indirect draws, or particles in a compute pass, with a WebGL2 fallback path kept (WebGL2 everywhere) | 4 | sized with the trigger | ME-33 | PC-A |

Phase 4 total ~11 d + the trigger feature. Rule for phases 1-3 so phase 4 stays mechanical: no GLSL-only tricks the WGSL port cannot express (no `gl_FragCoord.w` games, no texture formats outside the `GpuDevice` list, no `EXT_*` extensions except the timer query behind `caps`), every uniform through typed-array blocks, every texture fetch by integer coordinates (`texelFetch`), no `sampler2DShadow`.

**Refined estimate (phases 0-3): ~49 programmer-days = ~10 programmer-weeks, ~6 calendar weeks** with PC-B running the Node-only stories ahead of PC-A (the owner's 5-8 programmer-weeks holds only if ME-15/16/18/20 slip to a later sprint; phases 0-2 alone are ~30 d = 6 programmer-weeks, ~3.5-4 calendar weeks). Phase 4 is outside this estimate (~2.5 programmer-weeks when triggered).

### 27.12 What happens to in-flight and planned work

- **US-026b:** S1-S4, S6, S7 (band double buffer, streaming, `near.aux`, chunk files, JS shading rules for reeds/foam/tufts/face rows) **stay** - they are data and shade-pass rules on kind-7 cells and feed `terrainMesh.js`. **S5 (terrain.frag march changes, 26.3(a) claimed-cell march) is dropped** if the phase-1 gate passes; until then do not start it. 26.4's face-row rule reads the normal from `GI.z` instead of `aoD`.
- **US-070a:** the ray plan (25.1-25.3) is superseded by ME-15/16; **pause Queue 3 items 11-13 now** (already paused pending D-029). If phase 1 is a no-go, resume 25.3 unchanged. **US-070b/c:** satisfied by ME-15. **US-070d:** PCF radius, folds into ME-15/16. **US-071/072/073:** 27.9. **US-038c** `lighting: rt|classic` keeps its meaning ("shadowed point lights" vs none).
- **US-051..055 (D-018):** unchanged decisions; contacts via `World.contacts` over `bvh.js` (ME-09/11) - simpler than the sector special cases, and the same API a Rapier backend would sit behind (27.10). US-054 tree pieces = mesh pieces. US-055 water stays a heightfield/plane.
- **Editor (24, US-031..034/063-069):** document model, undo, io, frames unchanged; picking gets objectId readback (ME-18); grid painting stays on the level grid (converted at load); mesh placement is a new item type.
- **CO-2, CO-3, CO-5, CO-6, CO-7, CO-8: still apply as written** (frames are renderer-independent; CO-3's render invariance test runs on both renderers). **CO-4 (`rotateLevel`):** not needed for rendering or mesh physics; only for grid queries of a rotated grid level - stays parked. **`Frame` gains `yawDeg` for mesh placements** (grid levels keep `yawSteps`) - D-028 amendment (27.14).
- **US-046 (`createWorldRenderer`), US-048, US-049, US-050:** proceed; US-049 grows into ME-19's deletion list. US-050's `engine/test/assert.js` is where the mock `GpuDevice` lives.
- **Voxel content (D-016/D-019, US-041b, `.vox` importer, model editor M5):** the *format* and tools stay; only the render path changes (greedy mesh). Rigid-part animation keeps `voxelPose`.
- **Content migration:** none for levels, worlds, vox, chunks, recipe. New: `content/meshes/`, `design/meshes/*.glb`.

### 27.13 Risks and what NOT to do

Risks: (1) **Parity oracle** - a JS rasteriser vs ANGLE: mitigated by pinned conventions, edge-cell exclusion, and the ray-plane fallback (if uv parity fails, both twins compute `u,v,z` by intersecting the cell ray with the triangle plane passed as flat data; coverage stays hardware). (2) **Depth precision / z-fighting** - far terrain exclusion under the band, polygon offset for terrain only, N = 0.05. (3) **Look drift** - smooth normals make shaded gradients: default flat, per-face `face` codes, `faceK` rules unchanged; smooth only where flagged. (4) **iGPU vertex throughput** - LOD rings, culling, unrolled buffers only for small static meshes. (5) **Edge-pass semantics on free-form meshes** depend on importer smoothing groups; the test building is the proof. (6) **Schedule** - two renderers coexist for ~5 weeks: any fix to `dda/terrain/voxel.frag` in that window is wasted; freeze them (27.14 decision 2). (7) **Shadow-map crawl/acne** - texel snapping, fixed bias uniforms, owner check. (8) **Backend abstraction cost** - `GpuDevice` must stay thin (a table of ~15 functions); if ME-03b shows > 0.1 ms JS overhead or > 300 lines of indirection, cut features from the interface, not the rule. (9) **Type checking noise** - WARN mode until clean, file-by-file scope; never let it block a story on legacy files.
Do not: keep column/row state in the raster shaders; use `dFdx/dFdy` for the detail derivatives; use `gl_FragDepth`; rotate the camera pitch; write `u,v` from screen-space data; store world xyz in the G-buffer (normal + depth suffice); give terrain per-cell planeIds; let a mesh carry hex colours or textures; import glTF at runtime from `engine/` (`gltf.js` parses buffers handed to it; fetching stays in `game/`/`tools/`); introduce a scene graph with live parents (D-028: `parent` is a record); add a runtime library (glTF parsing is ~300 lines; no three.js, no gl-matrix; `typescript` is dev-only); write TypeScript source or `.d.ts` files; call `gl.*`/`navigator.gpu` outside `engine/render/gpu/device/`; start WebGPU or WASM work without a recorded trigger; let `rigid.js` or the player see triangles or a physics-engine object; delete anything before ME-19.

### 27.14 ESCALATE TO MANAGER (D-029 "engine direction")

(1) Adopt 27 as the plan: amends D-002/D-007 (renderer), D-009 (stages A1-A3), D-016/D-019 (voxel rendering path, format kept), D-027 (RT plan -> shadow maps; `lighting` option meaning), D-028 (`Frame.yawDeg` for mesh placements; CO-4 stays parked), D-015 (JS confirmed; WASM/Rapier only behind the recorded seams and triggers) - recommendation: adopt with the two gates as written. (2) Freeze `dda/terrain/voxel.frag`, US-026b S5 and US-070a steps 1-6 until the phase-1 gate (recommendation: freeze; PC-B continues Queue 3 items 1-10, then ME-00, ME-01/02/03/05/07/09 in that order). (3) Mesh asset format: `.glb` source in `design/`, derived `.mesh.json` in `content/` (D-023 extension; recommendation: yes, `.bin` sidecar deferred). (4) Sprint 4 re-cut: phase 0+1 replaces US-070a/US-026b-S5 in sprint 4; US-051a moves behind the phase-2 gate. (5) Dev dependency policy: `package.json` with `devDependencies: { typescript }` only (runtime stays dependency-free; `check-deps` unchanged) - recommendation: yes. (6) WebGPU = phase 4 with the triggers in 27.11, "WebGL2 everywhere, WebGPU where available" - recommendation: record now, schedule later.

### 27.15 Implementation notes for PC-B stories (architect, 2026-09-26; normative for ME-00, ME-01, ME-02, ME-03, ME-05, ME-07, ME-09)

PC-B builds these seven from this text alone (no architect on PC-B). Where 27.15 differs from 27.2-27.8, **27.15 wins**; 27.15.0 lists every correction and its reason (each was found by reading the code the story touches). Anything not named here is as in 27.1-27.13.

#### 27.15.0 Common rules, amendments, order

**Order / parallel plan (up to two sonnet programmers, disjoint files):** P1: ME-00 -> ME-01 -> ME-03 -> ME-05. P2 (once ME-00 is on `pc-b`): ME-02 -> ME-09 (needs ME-01 in) -> ME-07 (needs ME-03 in). None of the seven waits for a PC-A commit (ME-05 included, see 27.15.5). One commit per story (code + tests), status `arch-review`.

**Amendments (normative):**
1. *Row convention and y mapping (fixes 27.5).* The engine samples cell `(col, row)` at column coordinate `col + 0.5` but row coordinate `row`, not `row + 0.5` (`castModels` comment, `dda.frag.js` `main`, `cellRayP`). Sub-sample `(i, j)` of cell `(cx, cy)` at `n`: `col = cx + (i + 0.5)/n - 0.5`, `row = cy + (j + 0.5)/n - 0.5`. Raster window: `W = cols*n`, `H = rows*n`, pixel `(px, py)` centre `(px + 0.5, py + 0.5)`, index `py*W + px`, texel row `py` = screen row (row 0 = top, as every existing pass; **no viewport flip**). Mapping `X = n*(col + 0.5)`, `Y = n*(row + 0.5)`, hence `y_clip = (d*tan(pitch) - h) * (2*planeDistY/rows) + d/rows` (sign flipped vs 27.5, `+ d/rows` added). `planeDistY` keeps the cell aspect exactly as today: `(rows/2) * (cols*pxCellW)/(rows*pxCellH) / tanHalf`.
2. *Static vertex layout (fixes 27.3 `aux`).* `aux` is **8 floats per vertex** (`AUX_STRIDE = 8`): today's wall AO compares the *pixel height* with each along-wall neighbour's floor (`wallAoD`: `nbr.floorH > h`), which edge bits + faceW/faceH cannot express. Layout in 27.15.2. Static stride = pos 12 + uv 8 + nrm 4 + flat 8 + aux 32 = 64 B/vertex.
3. *Ceiling `zRef` = the cell's floorH* (`castPlane(..., sector.floorH, GK_CEIL)`); floors/tops `zRef = h`. 27.4's "the plane's own h" is wrong for ceilings.
4. *Grates are not alpha-tested and never set `mask`* (overrides the ME-01 AC wording). The tower grate `G` is an ordinary sector (animated `ceilH`, `upperMat: 'grate'`); the caster draws it opaque and the detail shader draws the bars. `mask` (GI.y bit 12) is the per-cell UI mask owned by resolve. Dynamic cells go into a separately rebuilt mesh (27.15.2).
5. *Voxel face code in phase 1 = `castModels`' rule:* axis-aligned part pose -> nearest world axis (1-6, `roundedFace`), else 7 + normal. 27.4's "0.9 dominance" rule stays an ME-08 option for PC-A; `rasterJS` matches the DDA oracle first.
6. *Terrain layout has no `uv`* (`uv.length === 0`); `u, v` = world x, y of the fragment. Vertex normals mirror `terrainCaster.js` `terrainNormal()`: near band from `near.height` (ground, not `hDraw`) with c = 2 m, far grid from `farHDraw` (`_farGridDraw`) with c = 8 m, missing samples -> `groundAt` (near) / `heightAt` (far).
7. *`ranges` are in triangles* (`start`, `count`; terrain triangle `t` = `idx[3t..3t+2]`). A voxel model is **one** MeshData (`vox:<modelKey>`) with one range per part in part-index order (`ranges[p].part` = part name); this is how the AC's "one MeshData per part" is met (27.2 `uPart[8]`, one draw per instance).
8. *`shearProjection` takes camera terms built from a grid spec* `{cols, rows, pxCellW?, pxCellH?}` (the cell aspect is part of `planeDistY`), not `(cam, cols, rows)`.
9. *Root `package.json` gets `"type": "module"`, plus a new `design/package.json` = `{ "type": "commonjs" }`.* Reason: a type-less root package.json makes Node 22+ print `MODULE_TYPELESS_PACKAGE_JSON` for every ESM `.js` (every engine test) and reparse it; `"type": "module"` alone breaks the `design/*.js` classic scripts that tests import as CommonJS (`module.exports`). Checked on a copy of HEAD with both files (Node 24.21): 94/94 suites PASS, no warnings. Neither file affects the browser. Within D-029 item 5 (no scripts, no dependencies).
10. *`tools/tsconfig.json` uses `"checkJs": false` + `// @ts-check` per file* (27.7 item 7 said `checkJs`): `engine/index.js` imports the whole engine, so `checkJs: true` would type-check every legacy file it reaches. With `false`, only `// @ts-check` files report semantic errors.
11. *"uv within 1e-6 of the analytic ray-plane hit" holds only with snapping off*: the 1/256-px vertex snap moves the attribute plane by ~2e-4 m at 10 m. `rasterJS` has a test-only `snap: false`; with snapping on the tolerance is the parity one (`1e-3 * depth`).
12. *Every fragment rule for kinds 1-8 lives in `rasterJS.js` from ME-03* (kinds 7/8 tested there on hand-made meshes). ME-05/ME-07 add feeds + integration tests only, so no two stories edit `rasterJS.js`.
13. *No new exports in `engine/index.js` / `engine/dev.js` in ME-01..ME-09* (tests import the modules directly; PC-A adds dev exports in ME-04 and public ones after the gate). Keeps both shared files conflict-free.
14. *Level `structSeq` in the mesh path = `placed.structSeq`* (placement index, what `dda.frag.js` gets via `WorldTextures`), not the CPU compositor's per-frame near-to-far index: stable per structure, so planeIds never change when the camera moves. Single-structure tests are identical either way.

**Imports of the new modules** (check-deps rule 1 already forces "inside engine/"): `engine/mesh/*` may import `engine/core/*`, `engine/render/GBuffer.js`, `engine/render/projection.js`, `engine/voxel/octNormal.js`, `engine/voxel/voxelPose.js`, `engine/voxel/VoxelModel.js` (constants). `engine/render/projection.js` imports nothing. `engine/physics/bvh.js` imports nothing (MeshData only as a JSDoc `import()` type). Never import a caster (`sectorCaster`, `terrainCaster`, `voxelMarch`), `gpu/*`, `game/` or `design/` from these modules; **tests may** (the casters are the oracle).

**Do not touch (all seven):** frozen `engine/render/gpu/glsl/{dda,terrain,voxel}.frag.js`, `engine/render/sectorCaster.js`, `engine/render/terrainCaster.js`, `engine/voxel/voxelMarch.js` (tests import them, nobody edits them); PC-A in flight: `engine/world/World.js`, `triggers.js`, `interaction.js`, `engine/render/lighting.js`, `engine/physics/roller.js` (CO-2), `engine/render/*.invariance.test.js` (CO-3), `engine/render/gpu/device/*`, `tools/check-deps.mjs` (ME-03b), `engine/render/gpu/GpuCellPipeline.js`, `engine/render/gpu/glsl/*`, `MeshBuffers.js` (ME-04), `engine/world/Terrain.js` (US-026b S1 / CO-6); `engine/voxel/*`; `engine/render/GBuffer.js`, `engine/index.js`, `engine/dev.js` (ME-00 JSDoc only); `game/js/main.js`; `docs/backlog.md` (the PC-B main session writes row notes).

**Test conventions (all seven):** hand-rolled like the existing suites (`check(name, cond)`, `console.error('FAIL:', ...)`, `process.exitCode = 1` on any failure, a summary line). Seeded inputs: `mulberry32(seed)` in the test, never `Math.random`. **Zero-allocation gates are hard**: when `global.gc` is missing the test re-runs itself with `--expose-gc` (`spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' })`, exit with its status) - never the silent skip of `terrainCaster.test.js`; warm up, `gc()`, run >= 1000 iterations, `gc()`, gate `heapUsed` growth < 64 KB. **Timing gates warn-only unless `PERF_STRICT=1`** (print `WARN`, never `FAIL`). Each suite < 20 s. New engine files start with `// @ts-check`; JSDoc on every export (`@param`/`@returns` with units and frames, `@type {Float32Array}` on typed-array fields, no `any` in exported signatures).

**If unclear:** write `NEEDS PC-A: architect <one-line question>` in the story row (PC-B main session), commit what is green, move to the next item. Never guess on anything that changes a G-buffer field value, a data layout or a public signature.

#### 27.15.1 ME-00 typecheck + typed public API (1.5 d)

Files: new `package.json`, `package-lock.json`, `design/package.json`, `tools/tsconfig.json`, `tools/typecheck.mjs`; changed `.gitignore`, `tools/run-tests.mjs`, `tools/run-tests.test.mjs`, `engine/core/transform.js`, `engine/index.js`, `engine/dev.js`, `engine/render/GBuffer.js` (comments/JSDoc only), `docs/architecture.md` section 11 (one line).
```jsonc
// package.json (repo root) - exactly these keys
{ "name": "kestrel", "private": true, "type": "module",
  "description": "Dev tooling only (D-029 item 5): the game and engine run without npm install.",
  "devDependencies": { "typescript": "~5.9.3" } }
// design/package.json
{ "type": "commonjs" }
// tools/tsconfig.json (paths relative to tools/)
{ "compilerOptions": { "allowJs": true, "checkJs": false, "noEmit": true, "strict": false, "noImplicitAny": false,
    "target": "es2022", "module": "es2022", "moduleResolution": "bundler", "lib": ["es2022", "dom"], "types": [],
    "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "maxNodeModuleJsDepth": 0 },
  "include": ["../engine/core/transform.js", "../engine/index.js", "../engine/dev.js", "../engine/render/GBuffer.js",
              "../engine/mesh/*.js", "../engine/render/projection.js", "../engine/physics/bvh.js"],
  "exclude": ["../**/*.test.js", "../**/*.test.mjs", "../node_modules"] }
```
- `typescript`: the newest **5.x** at install time with a `~` range (not 6/7: 27.7 was written against the JS compiler's JSDoc support; a major bump = architect question). Commit `package-lock.json`; `.gitignore` += `node_modules/`. The mesh/projection/bvh globs are in `include` from day one so later stories never edit tsconfig.
- `tools/typecheck.mjs` (Node built-ins only): looks for `<cwd>/node_modules/typescript/bin/tsc` and runs `spawnSync(process.execPath, [tsc, '--noEmit', '-p', 'tools/tsconfig.json', '--pretty', 'false'])`; else `tsc` on PATH if `tsc --version` prints `Version 5.`; else prints `typecheck SKIP: typescript not installed - run "npm install" (dev only, D-029 item 5)` and **exits 3**. Exit 0 = clean, 1 = type errors (tsc output passed through, last line `typecheck: N error(s)`). `--tsc <path>` override for tests. Never run a bare `npx tsc` (npm resolves it to the unrelated `tsc` package) and never download anything.
- `tools/run-tests.mjs`: `const TYPECHECK_MODE = process.env.KESTREL_TYPECHECK_MODE || 'warn';` (the flip line); `tools/typecheck.mjs` is collected like `validate-content.mjs`, after it. Status: exit 0 -> PASS; exit 3 -> WARN in both modes; other non-zero -> WARN in `'warn'`, FAIL in `'fail'`. `--filter typecheck` works through the existing substring filter. Header comment updated.
- JSDoc: `transform.js` gets `// @ts-check` and typedefs `Frame` (`yawSteps: 0|1|2|3`), `Transform`, `Vec3` (`{x,y,z}`), `Vec2Out` (`number[]|Float32Array|Float64Array`, length >= 2), `BBox2` (`{x0,y0,x1,y1}`), `Size2` (`{w,h}`); `@param`/`@returns` on every function (degrees, metres, compass yaw, frames per D-028). `makeFrame` returns `/** @type {Frame} */ ({ x, y, z, yawSteps })` (JSDoc cast, same runtime). `GBuffer.js`: `// @ts-check`, field types, `@typedef GBufferSample`, `@param`/`@returns` on `packPlaneId`, `writeSample`, `readSample`. `index.js`/`dev.js`: `// @ts-check`, `@module` header, public typedef re-exports `/** @typedef {import('./core/transform.js').Frame} Frame */` (+ `Transform`, `Vec3`).
- A tsc file-casing error for `engine/render/voxelPool.js` (git tracks `voxelPool.js`; a Windows working copy may show `VoxelPool.js`) is a working-copy artefact: note `NEEDS PC-A` in the row, do not rename files.

Steps: 1. package files + `.gitignore`, `npm install` -> `node tools/run-tests.mjs`: same PASS count as before, no `MODULE_TYPELESS_PACKAGE_JSON` in the output. 2. tsconfig + `typecheck.mjs` -> `node tools/typecheck.mjs` exits 0/1 (list errors); `--tsc nonexistent` exits 3 with the SKIP line. 3. run-tests wiring -> `run-tests.test.mjs` fixture stand-ins: typecheck exit 1 -> line `WARN tools/typecheck.mjs`, runner exit 0; exit 3 -> WARN; exit 0 -> PASS; `KESTREL_TYPECHECK_MODE=fail` + exit 1 -> FAIL, runner exit 1. 4. JSDoc until `node tools/typecheck.mjs` exits 0 -> `transform.test.js` same check count (4839), `check-deps` green. 5. Section 11 line: "Types: `npm install` once, then `node tools/typecheck.mjs` (also a `run-tests` suite; WARN until clean, flip = `TYPECHECK_MODE` in `run-tests.mjs`)."
Do not: add `// @ts-check` to other legacy files, add scripts or other devDependencies, write `.d.ts`, change runtime code in the four files.

#### 27.15.2 ME-01 MeshData + levelMesh (2.5 d)

Files: new `engine/mesh/MeshData.js`, `engine/mesh/levelMesh.js`, `engine/mesh/MeshData.test.js`, `engine/mesh/levelMesh.test.js`.
```js
// engine/mesh/MeshData.js
export const MESH_VERSION = 1, AUX_STRIDE = 8, FLAT_STRIDE = 2;
export const AO_NONE = 0, AO_WALL = 1, AO_PLANE = 2;
export const AO_FAR = 1e30;          // "no limit" inside vertex data (never Infinity in GPU attributes)
/** @typedef {Object} MeshData                         27.3 as amended by 27.15.0 items 2, 6, 7
 * @property {1} version
 * @property {string} id                              `level:<name>`, `level:<name>#<tag>`, `vox:<modelKey>`, `terrain:near<k>|stitch|far<t>`
 * @property {'static'|'terrain'} layout
 * @property {Float32Array} pos                        3/vertex, mesh-local m (levels: level-local; voxels: model voxel units; terrain: chunk-local)
 * @property {Float32Array} uv                         static 2/vertex (m); terrain length 0
 * @property {Uint32Array} nrm                         1/vertex, packNormalOct (engine/voxel/octNormal.js) of the mesh-local unit normal
 * @property {Uint32Array} flat                        static 2/vertex [planeIdBase, kind | face<<8 | mat<<16]; terrain length 0
 * @property {Float32Array} aux                        static 8/vertex (layout below); terrain length 0
 * @property {Uint16Array|Uint32Array|null} idx        terrain 3/triangle; static null
 * @property {number} triCount
 * @property {Float64Array} bbox                       [x0,y0,z0,x1,y1,z1] mesh-local
 * @property {{start:number, count:number, part?:string}[]} ranges   triangle units, >= 1 range
 * @property {string[]} matKeys                        mat bits index this list until resolveMats
 * @property {boolean} matsResolved                    true = mat bits are MaterialTable ids
 * @property {number} meshVersion                      +1 on every in-place rebuild (ME-04 re-upload key) */
export function packFlat1(kind, face, mat)           // ((kind & 0xff) | (face & 0xf) << 8 | (mat & 0xffff) << 16) >>> 0
export function flatKind(f1), flatFace(f1), flatMat(f1)
export function wallPlaneIdBase(face, boundary)      // packPlaneId(0, face, boundary)                        (primeWallGSample)
export function planePlaneIdBase(kind, h)            // packPlaneId(0, kind, Math.round(h * 1000) + 0x800000)  (castPlane)
export class StaticMeshBuilder {                      // build time only, may allocate
  constructor(id); matIndex(key) /* first-use order */; beginRange(part);
  addQuad(p12, uv8, nx, ny, nz, flat0, flat1, aux8)   // corners 0..3 -> triangles (0,1,2), (0,2,3)
  build() /* -> MeshData */ }
export function validateMesh(mesh)                   // -> { errors: string[] }, 'path: problem', all problems
export function assertMesh(mesh)                     // throws Error(errors.join('\n'))
export function resolveMats(mesh, matIdFor)          // in place, once (throws if matsResolved)
export function meshToJSON(mesh) / meshFromJSON(obj) // content form: plain number arrays, same keys (stringifyContent-canonical)
```
- **Winding:** every triangle `(p0, p1, p2)` has `cross(p1 - p0, p2 - p0)` (plain algebraic formula) along its stored normal. Phase 1 draws with cull `none` in both twins; ME-09/10/17 rely on the winding.
- `planeIdBase` has structSeq/instance bits = 0; the draw item ORs its own (`planeIdOr`, 27.15.4).
- **aux layout:** `[0] zRef` (mesh-local z subtracted for G-buffer `z`), `[1] aoMode`; `AO_WALL`: `[2] ceilZ` (viewer cell's numeric ceilH, else AO_FAR), `[3] nbrALo`, `[4] nbrBLo` (floorH of the viewer-side neighbour at along-wall index -1 / +1, AO_FAR when that cell is missing), `[5] u0` (integer along-wall cell coordinate); `AO_PLANE`: `[2] bits` (W=1, E=2, N=4, S=8), `[3] cellX0`, `[4] cellY0`; unused slots 0. The 3 vertices of a triangle carry identical `flat`/`aux`, so GL-vs-WebGPU provoking-vertex rules never matter.
- **Fragment formulas (rasterJS and the later GLSL, literally):** `AO_NONE`: `aoD = Infinity`. `AO_WALL` (u = along-wall uv, h = v = mesh-local z): `d = max(0, h - zRef); zc = ceilZ - h; if (zc < d) d = max(0, zc); fr = u - u0; if (h < nbrALo) d = min(d, fr); if (h < nbrBLo) d = min(d, 1 - fr); aoD = d` (= `wallAoD`). `AO_PLANE` (u = local x, v = local y): `fx = u - cellX0; fy = v - cellY0; a = Infinity; W: a = min(a, fx); E: a = min(a, 1 - fx); N: a = min(a, fy); S: a = min(a, 1 - fy); aoD = a` (= `planeAoDFast`).
- Validator: version 1; id non-empty; layout; typed-array classes; lengths (`pos` 3V; static: V % 3 == 0, `uv` 2V, `flat` 2V, `aux` 8V, `idx` null; terrain: `idx.length % 3 == 0`, max index < V, `uv/flat/aux` empty); `nrm` V; finite values; bbox contains all pos (1e-6); ranges inside `[0, triCount]`; static flat/aux equal on the 3 vertices of each triangle; kind 1..9, face 1..7; unresolved mat bits < `matKeys.length`.
```js
// engine/mesh/levelMesh.js
/** @typedef {{base: MeshData, dyn: {tag: string, mesh: MeshData}[], levelName: string}} LevelMeshSet */
export function buildLevelMesh(level, opts)          // opts { matIdFor?: (key: string) => number, footZ?: number = -2 } -> LevelMeshSet
export function rebuildLevelMeshDyn(set, level, tag, opts)   // new MeshData for dyn[tag] from live legend values; event-driven (allocation allowed), never per frame
export function computeRelief(level)                 // {w, h, floorRise: Uint8Array, ceilDrop: Uint8Array}: literal copy of sectorCaster ensureRelief (0.01 m epsilon, missing neighbour = rises)
```
`S(c, r)` = `level.sectorAt(c + 0.5, r + 0.5)` (null outside the grid / unknown char). Mesh-local = level-local (1 cell = 1 m). Emission order (determinism): `r = 0..h-1`, `c = 0..w-1`; per cell: its planes, west boundary if `c == 0`, north boundary if `r == 0`, east boundary, south boundary. Skip quads with `z1 - z0 <= 1e-9`. `yawSteps != 0` placements are rejected (throw), as World does until CO-4.
- **Planes** (cell with `S != null`): floor/top at `h = S.floorH`: kind `S.solid ? 5 TOP : 4 FLOOR`, face 5 U, mat `S.floorMat`, `planePlaneIdBase(kind, h)`, `zRef = h`, `AO_PLANE` + `floorRise` bits. Ceiling if `typeof S.ceilH === 'number'` (solid or not, as the caster): kind 6, face 6 D, mat `S.ceilMat`, `planePlaneIdBase(6, S.ceilH)`, `zRef = S.floorH`, `AO_PLANE` + `ceilDrop` bits. `uv = (x, y)`.
- **Boundary faces** between `A` (west/north side) and `B` (east/south side). `V` = viewer cell; the normal points into `V`; face: E/W boundary, `V` west -> 4 W, east -> 2 E; N/S boundary, `V` north -> 1 N, south -> 3 S. `wallPlaneIdBase(face, boundary)`, `boundary` = the integer x (E/W) or y (N/S) of the line. `uv`: E/W `(y, z)`, N/S `(x, z)`. `AO_WALL`: `zRef = V.floorH`, `ceilZ` = `V.ceilH` if numeric else AO_FAR, neighbours on `V`'s side (E/W: `S(vc, r-1)`, `S(vc, r+1)`, `u0 = r`; N/S: `S(c-1, vr)`, `S(c+1, vr)`, `u0 = c`).
  1. Both null: nothing. One null (grid edge), other `X`: `X.solid` -> WALL (kind 1) from `footZ` to `X.floorH`, mat `X.wallMat`, `V` = outside (`zRef 0`, `ceilZ = nbrALo = nbrBLo = AO_FAR`); non-solid `X` -> nothing (terrain owns it).
  2. Floor riser if `A.floorH !== B.floorH`: `L` = lower, `Hc` = higher; from `L.floorH` to `Hc.floorH`, `V = L`, kind `Hc.solid ? 1 WALL : 2 STEP`, mat `Hc.wallMat`. (This one rule reproduces the caster's solid face, step front and BUG-CPU-001 exit face.)
  3. Upper face if both non-solid, both `ceilH` numeric and different: `Lc` = lower ceilH, `Hc2` = other; from `Lc.ceilH` to `max(Lc.topH, Hc2.ceilH)`, `V = Hc2`, kind 3 UPPER, mat `Lc.upperMat` (loadLevel defaults it to wallMat).
- **Dynamic split:** a quad goes to `dyn[tag]` when its own cell (planes) or either side (boundaries) is a legend entry with `dynamic` (tag = `entry.tag`; two tags on one boundary -> lexicographically smaller), else to `base`. `World.animateSector` mutates `sector.ceilH` in place; `rebuildLevelMeshDyn` re-reads it. `base` never changes at runtime.
- Materials: `matIdFor` given -> ids, `matsResolved = true`; absent -> `matKeys` indices (tests, JSON).

Steps: 1. `MeshData.js` -> `MeshData.test.js`: packFlat1 round trip at kind/face/mat extremes; planeId helpers == `packPlaneId` on 100 seeded inputs; every builder triangle's cross product parallel to its normal (1e-12); validator rejects 3 broken fixtures (bad length, bbox miss, range overflow) and accepts a clean mesh; JSON round trip byte-equal; `resolveMats` twice throws. 2. Planes + boundaries -> `levelMesh.test.js` on synthetic `loadLevel` grids: (a) 3x3 room with ceilings: 9 floors, 9 ceilings, no inner walls; (b) floors 0/0.3: one STEP facing the low cell, `zRef 0`, mat of the high cell; (c) 2 m solid pillar: 4 WALL + 1 TOP; (d) lintel (ceilH 2.2 vs 3, topH 3): UPPER facing the 3 m cell over 2.2..3; (e) sky next to numeric ceiling: no UPPER; (f) solid grid edge: outward WALL from `footZ`; (g) `computeRelief` == `level._relief028` after one `castSectors` frame on `tower` + `test_room`. 3. **Caster oracle (the ME-01 gate):** `tower` + `test_room` via `loadTestAssets`, `footZ = 0`, `bindLevel` ids; 20 seeded open cells per level x yaw {0, 90, 180, 270} x pitch {0, -25}, eye = cell centre at floorH + 1.6, grid 48x27 (`pxCellW = pxCellH = 1`): `castSectors` into GBuffer + DepthBuffer (setup as `sectorCaster.silhouette.test.js`); for every written cell brute-force the first hit of the same ray (literal `cellRayP`) against all `base` + `dyn` triangles (Moeller-Trumbore, float64, double-sided). On cells that are not 4-neighbour kind edges in the caster output and whose hit is >= 1e-6 from a triangle edge: kind, face, mat, planeId equal on >= 99 %; depth within 1e-4 relative; u, v, z, aoD within 1e-4 (Infinity == Infinity). Print every mismatch (pose, cell, both values); explain the remainder in the row (caster clips: BUG-CAST-001 band, `floorFilledTo`). 4. Dynamic: grate `ceilH` -> 5.4, `rebuildLevelMeshDyn(set, tower, 'grate')`: dyn changes, base byte-identical, oracle re-run on 3 poses facing the grate. 5. Determinism: two builds byte-identical (typed arrays + JSON string).
Do not: import the caster in `levelMesh.js` (copy the relief rule; the test compares), merge quads across cells (per-cell quads keep `u0` and cell AO exact; the tower is ~3k triangles), add alpha test or mask.

#### 27.15.3 ME-02 projection + culling (1 d)

Files: new `engine/render/projection.js`, `engine/render/projection.test.js`, `engine/mesh/culling.js`, `engine/mesh/culling.test.js`.
```js
// engine/render/projection.js - the ONE place the shear camera matrix lives (27.5 + 27.15.0 items 1, 8)
export const PROJ_HFOV_DEG = 75, PROJ_NEAR = 0.05, PROJ_FAR = 2000;
/** @typedef {{cols:number, rows:number, pxCellW?:number, pxCellH?:number}} GridSpec
 *  @typedef {{x:number, y:number, z:number, yawDeg:number, pitchDeg:number}} CamPose   world m, z = eye height, compass yaw (D-028)
 *  @typedef {{cols:number, rows:number, eyeX:number, eyeY:number, eyeZ:number, dirX:number, dirY:number, planeX:number, planeY:number,
 *             tanHalf:number, planeDistX:number, planeDistY:number, horizonRow:number, tanPitch:number}} ProjTerms */
export function projTerms(cam, grid, out)              // -> out (ProjTerms), castScene's expression order
export function shearProjection(terms, out16)          // -> out16: column-major M = P*V, world -> clip (Float64Array in JS; ME-04 copies to Float32Array)
export function projectPoint(M, W, H, x, y, z, out4)   // -> [X, Y, zNdc, w]: X = W/2 * x/w + W/2, Y = H/2 * y/w + H/2; w <= 0 -> only out4[3] valid
export function unprojectCell(terms, col, row, dist, out3)   // == cellRayP: cameraX = 2(col + 0.5)/cols - 1; P = eye + (dir + plane*cameraX)*dist; z = eyeZ + (horizonRow - row)/planeDistY * dist
export function windowToCell(n, X, Y, out2)            // col = X/n - 0.5, row = Y/n - 0.5
```
- Terms, literally: `hFovRad = PROJ_HFOV_DEG * Math.PI / 180; tanHalf = Math.tan(hFovRad / 2); yawRad = cam.yawDeg * Math.PI / 180; dirX = Math.sin(yawRad); dirY = -Math.cos(yawRad); planeX = -dirY * tanHalf; planeY = dirX * tanHalf; aspect = (cols * (pxCellW || 1)) / (rows * (pxCellH || 1)); planeDistY = (rows / 2) * aspect / tanHalf; tanPitch = Math.tan(cam.pitchDeg * Math.PI / 180); horizonRow = rows / 2 + tanPitch * planeDistY; planeDistX = cols / (2 * tanHalf)`, with the coordinates.md 3 comment citing `transform.js` (hot-loop exception, same expression order as `castScene`).
- Rows of M (`clip = M * [x, y, z, 1]`), right `rX = -dirY, rY = dirX`, eye `e`: `row_w = (dirX, dirY, 0, -(dirX*eX + dirY*eY))`; `row_x = (1/tanHalf) * (rX, rY, 0, -(rX*eX + rY*eY))`; `row_y = (ky*tanPitch + 1/rows) * row_w - ky * (0, 0, 1, -eZ)`, `ky = 2*planeDistY/rows`; `row_z = A*row_w + (0, 0, 0, B)`, `A = (F+N)/(F-N)`, `B = -2FN/(F-N)`. Storage `out16[c*4 + r]` (column c, row r).
- `culling.js`: `frustumPlanes(M, out24)` (Gribb-Hartmann from the same M: `w+x, w-x, w+y, w-y, w+z` (near), `w-z` (far); each normalised by `|(a,b,c)|`; inside = `a x + b y + c z + d >= 0`, world space) and `classifyAABB(planes, x0, y0, z0, x1, y1, z1, marginM = 0)` -> `CULL_OUT = 0 | CULL_IN = 1 | CULL_STRADDLE = 2` (p-/n-vertex test). No allocation, no returned objects.

Steps: 1. `projTerms` bit-identical to `castScene` (`fb.gbuf.cam.planeDistY` after one `castSectors` frame) and to `instanceRect.computeProjection` on 20 seeded poses -> `projection.test.js`. 2. Round trip: 1000 seeded (col in [-0.5, cols - 0.5], row in [-0.5, rows - 0.5], dist in [0.06, 1500], n in {1, 2, 3}): `windowToCell(projectPoint(M, ..., unprojectCell(...)))` within 1e-9 cells, `w` within 1e-9 relative; `unprojectCell` == a literal JS copy of GLSL `cellRayP` within 1e-9; pitch sweep -30..+30 deg: a point at eye height 100 m ahead lands on `row == horizonRow` within 1e-9; pixel centres `(px + 0.5)` map to `cx + (i + 0.5)/n - 0.5` (the `dda.frag.js` offsets) within 1e-12. 3. `culling.test.js`: boxes inside / outside each plane / straddling / behind the eye / containing the eye / pitch +-35; property: 2000 seeded boxes classified OUT -> 200 seeded points inside each never project into `[0,W) x [0,H)` with `N <= w <= F`; zero-allocation gate on 100k `classifyAABB` calls.
Do not: rotate the camera by pitch or add a pitched view matrix; build this matrix anywhere else (ME-03 and later import it).

#### 27.15.4 ME-03 rasterJS + DrawList (3 d)

Files: new `engine/mesh/DrawList.js`, `engine/mesh/rasterJS.js`, `engine/mesh/DrawList.test.js`, `engine/mesh/rasterJS.test.js`.
```js
// engine/mesh/DrawList.js
export const DRAW_STATIC = 0, DRAW_VOXEL = 1, DRAW_TERRAIN = 2;
export const DRAW_FLAG_DEPTH_BIAS = 1;          // terrain only; off until ME-06 decides (27.5)
export const MAX_DRAW_ITEMS = 256;
/** @typedef {Object} DrawItem
 * @property {MeshData|null} mesh
 * @property {number} type                 DRAW_*
 * @property {Float64Array} matrix         12: A (3x3 row-major) then t (3) - voxelPose FORWARD layout; mesh-local -> world; A = rotation x uniform scale only
 * @property {Float64Array} partMatrices   8*12, DRAW_VOXEL: part p -> world (copied from FORWARD)
 * @property {Uint8Array} partFlags        8; bit 0 = part pose axis-aligned (computeVoxelPose out[p*16 + 12])
 * @property {number} rangeFirst           triangles (static/terrain); voxel items use mesh.ranges per part
 * @property {number} rangeCount
 * @property {number} planeIdOr            levels (structSeq & 7) << 28; voxels (slot & 0xF) << 24; terrain 0
 * @property {number} objectId             levels structSeq; terrain 0x7000 | chunkIndex; voxels 0x8000 | slot (27.4)
 * @property {number} zBase                G-buffer z = worldZ - zBase - aux.zRef (levels origin.z; voxels inst.z; terrain 0)
 * @property {number} flags                DRAW_FLAG_*
 * @property {Float64Array} aabb           6, world, for culling */
export class DrawList {
  constructor(capacity = MAX_DRAW_ITEMS)   // preallocates capacity items (typed arrays inside)
  begin()                                  // count = 0
  push(mesh, type)                         // -> next preallocated DrawItem, reset to identity/0; throws past capacity
  cull(planes)                             // -> count; stable in-place compaction dropping CULL_OUT (culling.js)
  count; items }
export class LevelMeshCache { constructor(matIdFor); get(structure) /* -> LevelMeshSet: Map by structure.id, built on first sight, dyn rebuilt when structure.packed.version changed */ }
export function addStructures(list, world, cam, cache, fogFarM)   // draw order near -> far (literal copy of renderWorld's bboxDist insertion sort, fog cull, <= 8); structSeq = placed.structSeq (27.15.0 item 14)
```
`addStructures` pushes one `DRAW_STATIC` item for `set.base` and one per `set.dyn[k].mesh`: `matrix = [1,0,0, 0,1,0, 0,0,1, origin.x, origin.y, origin.z]`, `zBase = origin.z`, `planeIdOr = (structSeq & 7) << 28`, `objectId = structSeq`, `aabb` = mesh bbox + origin, whole mesh range.
```js
// engine/mesh/rasterJS.js
export const SUBPIX = 256, GUARD = 16, BIAS_FACTOR = 1, BIAS_UNITS = 1;
/** @typedef {Object} RasterTarget  cols, rows, n, W, H; zbuf Float64Array (z_ndc, clear 1); depth Float32Array (view depth d, clear Infinity);
 *  kind Uint8Array; face Uint8Array; mat Uint16Array; planeId Int32Array; u, v, z, aoD Float32Array; nrm Uint32Array; objectId Uint32Array;
 *  writes Uint32Array|null (per-pixel write count, test instrumentation) - all W*H, index py*W + px */
/** @typedef {{M: Float64Array, terms: ProjTerms, snap?: boolean, kind7Mat?: (x: number, y: number) => number}} RasterCtx */
export function createRasterTarget(cols, rows, n, opts)   // opts.countWrites
export function clearRasterTarget(t)
export function rasterDrawList(list, target, ctx)          // items[0..count)
export function copyToGBuffer(target, gbuf, depthArr)      // n === 1 only (throws otherwise); caller ran beginFrame; kind-0 pixels untouched; face 7 -> aoD bits = nrm (CPU v2 convention, voxelMarch getAoAlias)
```
Per triangle (float64, module scratch, zero allocation):
1. Vertex -> world `w = A p + t` (item matrix; `partMatrices[p]` for voxel range p). Normal -> world `A n`, normalised (static: the triangle's `nrm`; terrain: per vertex).
2. Clip `c = M [w, 1]`; Sutherland-Hodgman (<= 9 vertices) against `w - PROJ_NEAR >= 0`, then `GUARD*w - x >= 0`, `GUARD*w + x >= 0`, same for y. Intersections interpolate every attribute linearly in clip space with `t` computed from the endpoint pair in canonical order (lexicographically smaller `(w, x, y, z)` first), so a shared edge clips identically in both triangles. Fan `(v0, vk, vk+1)`.
3. Window `X = W/2 * x/w + W/2`, `Y = H/2 * y/w + H/2`, `zn = z/w`, keep `iw = 1/w`. Snap `Xs = Math.round(X * SUBPIX)`, `Ys` likewise (skipped when `ctx.snap === false`, tests only).
4. Setup `A2 = (X1-X0)(Y2-Y0) - (Y1-Y0)(X2-X0)`; `A2 == 0` -> skip; `A2 < 0` -> swap v1/v2 (cull none). `E_ab(P) = (Xb-Xa)(Py-Ya) - (Yb-Ya)(Px-Xa)`. **Top-left rule** (window y grows down): edge a->b is top-left iff `(Yb == Ya && Xb > Xa) || Yb < Ya`; centre `P = (256 px + 128, 256 py + 128)` is covered iff every edge has `E > 0`, or `E == 0` on a top-left edge. Exact: integer inputs, the guard band keeps `|X*256| < 2^23`, products < 2^53.
5. Range `pxMin = max(0, ceil((minX - 128)/256))`, `pxMax = min(W - 1, floor((maxX - 128)/256))`, same for y.
6. `l0 = E_12/A2, l1 = E_20/A2, l2 = E_01/A2`; `zn = l0 zn0 + l1 zn1 + l2 zn2` (+ `2*(BIAS_FACTOR * max(|dzw/dX|, |dzw/dY|) + BIAS_UNITS * 2^-24)` for `DRAW_FLAG_DEPTH_BIAS`, `zw = (zn + 1)/2`, slopes of the snapped triangle); reject `zn > 1`; test `zn < zbuf[i]` (LESS). Perspective-correct: `q = l0 iw0 + l1 iw1 + l2 iw2`, `attr = (l0 a0 iw0 + l1 a1 iw1 + l2 a2 iw2) / q`, `depth = 1/q`.
7. Writes: `kind`, `mat` from flat (terrain: kind 7, `mat = ctx.kind7Mat(x, y)`); `planeId = flat0 | planeIdOr` (terrain `PLANEID_TERRAIN`); `face`: kinds 1-6 flat face, kind 7 -> 7, kind 8 -> part axis-aligned ? `roundedFace(nWorld)` (literal copy of voxelMarch's) : 7; `u, v`: static uv, terrain world x, y; `z = pz - zBase - zRef` (terrain `pz`); `aoD` per 27.15.2 (kinds 7/8 Infinity); `nrm = packNormalOct(world normal)` (terrain: interpolated, normalised); `objectId`; `writes[i]++` when counting.

Steps: 1. Target + single triangles -> `rasterJS.test.js`: exact pixel sets for 6 hand-computed triangles incl. edges through pixel centres (top-left decisions). 2. Watertightness (snap on): a 2-triangle quad and a 200-triangle fan write every inside pixel exactly once (`writes == 1`), none outside; repeated with the eye inside the fan (near clipping). 3. Perspective: a planar quad (coords < 64 m, float32 storage) at 20 seeded poses, `snap: false`: `unprojectCell(pixel, depth)` on the plane within 1e-6 m, `u, v` == analytic ray-plane hit within 1e-6; snap on: within `1e-3 * depth`. 4. Kinds 7/8 on hand-made meshes: 2x2 terrain grid with a `kind7Mat` stub (u, v = world xy, planeId -1, aoD Infinity, normal interpolated); 1-part voxel cube at yaw 30 deg (face 7 + normal) and 90 deg (rounded face). 5. `DrawList.test.js`: structSeq/order on a 3-structure fake world; cull drops an item behind the eye; 200 synthetic items `begin/push/cull` <= 0.3 ms median (warn-only); zero-allocation gates on 1000 `begin/push/cull` frames and on 200 `rasterDrawList` frames (tower, 160x60). 6. **Tower vs CPU DDA:** 3 inside tower poses copied from the `game/js/main.js` gpucompare list, 160x60, n = 1: `castSectors` -> GBuffer A; `buildLevelMesh` (`footZ = 0`) -> `addStructures` -> `rasterDrawList` -> `copyToGBuffer` -> GBuffer B: kind equal on >= 98 % of cells excluding cells with a differently-kinded 4-neighbour in A; list the rest; shuffled item order -> identical target.
Do not: use screen-space derivatives, store world xyz, allocate per triangle/frame, write `u, v` from screen data, special-case the tower, cache anything keyed on the camera.

#### 27.15.5 ME-05 terrainMesh (2.5 d)

**US-026b S1 is not a blocker:** code against today's `terrain.near` contract `{x0, y0, w, h, cell, height, type, hDraw, minH, maxH, version}` and "a flip = a new `near` object with `version + 1`" - today's `bakeNearBand(cx, cy)` already behaves so and S1 keeps it (26.1 item 4). Detect flips by object identity; tests call `terrain.bakeNearBand(cx, cy)` to simulate a recentre. No reorder, no wait; after S1 lands on master re-run the suite (a changed `near` shape = NEEDS PC-A). Do not edit `Terrain.js`. Preconditions asserted at construction: `chunkSize % farCell == 0`, band `x0, y0` multiples of the far cell (8 m), `w == h == 3 * chunkSize/nearCell`.

Files: new `engine/mesh/terrainMesh.js`, `engine/mesh/terrainMesh.test.js`.
```js
export const FAR_TILE_QUADS = 32, FAR_LOD1_STEP = 4, RING0_M = 512;
export class TerrainMeshSet {
  constructor(terrain, opts)          // opts.fogFullM = 1500 (test: == terrainCaster FOG_FULL); preallocates everything (2 x 9 near chunks, stitch, far tiles)
  step(msBudget = 2)                  // -> boolean pending; per RENDERED frame, never per fixed step: far tiles once after farReady / farVersion change, near rebuild on flip
  addToDrawList(list, cam)            // near chunks + stitch + far tiles (LOD by distance), DRAW_TERRAIN items, zBase 0, planeIdOr 0
  typeAt(x, y)                        // kind-7 mat: near nearest texel inside the band else far nearest (castTerrain's rule); allocation-free; = ctx.kind7Mat
  near; stitch; far; pending }        // MeshData[] / MeshData / MeshData[]
```
- **Near chunks:** band vertex `(i, j)` at the cell centre `(x0 + (i + 0.5) cell, y0 + (j + 0.5) cell)`, `z = hDraw[i + j*w]`. Chunk `(kx, ky)` owns vertex columns `64 kx .. min(64 kx + 64, w - 1)` (65 or 64; the shared column is duplicated, so chunks are watertight); chunk-local positions, origin `(x0 + 128 kx, y0 + 128 ky, 0)` = the item translation. Quad `(i, j)` -> triangles `(a, b, c)`, `(a, c, d)`, `a = (i, j)`, `b = (i+1, j)`, `c = (i+1, j+1)`, `d = (i, j+1)` (normal up by the winding rule). Vertex normal `(-(hR - hL)/(2c), -(hU - hD)/(2c), 1)` normalised, `c = 2`, heights `util.gridHeight(near, x +- c, y)` / `(x, y +- c)`, null -> `terrain.groundAt` (literal `terrainNormal`). Index buffers static per chunk width (two variants, built once). objectId `0x7000 | (3 ky + kx)`.
- **Far tiles:** far vertex `(i, j)` at `((i + 0.5) 8, (j + 0.5) 8)`, `z = farHDraw`, normals as above with `c = 8` on `terrain._farGridDraw`, null -> `heightAt`. Tiles of 32x32 quads over quads `0 .. mapW - 2` (last tile narrower). One MeshData per tile: `ranges[0]` = LOD0 (8 m quads + skirt), `ranges[1]` = LOD1 (every 4th vertex column/row plus the tile's last one, + skirt), each at a fixed offset in `idx` (LOD0 capacity = full tile) so a LOD0 count change never moves LOD1. Skirts on all 4 edges: bottom vertices at `z = tileMinH - 1` (tile's own min `farHDraw`), same x, y, normal copied from the top vertex. objectId `0x7000 | (16 + tileIndex)`. Built tile by tile inside `step`.
- **Far-under-band exclusion:** far quad `(i, j)` (spanning `[8i+4, 8i+12] x [8j+4, 8j+12]`) is dropped from LOD0 when it intersects the open near-surface rectangle `(x0 + cell/2, x0 + w cell - cell/2) x (y0 + cell/2, y0 + h cell - cell/2)` (tower band: `i in [x0/8 - 1, x0/8 + 47]`). Band-intersecting tiles are always LOD0; their LOD0 index region is rewritten on every flip.
- **Stitch** (`terrain:stitch`, indexed, objectId `0x7000 | 9`) closes the ring between the near boundary loop (band perimeter vertices, 4 x (w - 1)) and the kept far boundary loop (far vertices from the first to one past the last excluded quad index, perimeter, 4 x 49 for the tower band). Both loops start at their min-x/min-y corner and run +x, +y, -x, -y; parameter `t = edgeIndex + fraction` in [0, 4). Zip: emit the triangle that advances the loop whose next vertex has the smaller `t` (tie -> advance the far loop) until both loops are closed; reverse a triangle whose cross z < 0. Heights/normals = the loop vertices' own (no new samples). If the far loop leaves the far grid: no stitch, warn once.
- **Rebuild on flip:** `step` sees `terrain.near !== this._builtFor` -> fills the back set row by row (192 band vertices per unit, `performance.now()` checked per row), then the stitch and the band tiles' LOD0 regions, then swaps front/back and bumps `meshVersion` of every changed MeshData in the same call (a frame renders all-old or all-new). Retarget while pending: restart from row 0 on the newest `near`.
- `addToDrawList`: near chunks and stitch always (culling by `DrawList.cull`); far tiles LOD0 when the 2D distance eye -> tile rectangle < `RING0_M` or the tile intersects the band, else LOD1; skip beyond `fogFullM`; order near chunks, stitch, far tiles by distance.

Steps: 1. Near chunks on a stub recipe (analytic sinusoid heights, the `util.bake`/`gridHeight` literal from `overworld_far.js`) -> `terrainMesh.test.js`: vertex z == `hDraw` exactly; chunk edges share identical positions; vertex normals == the `terrainNormal` formula within 1e-9; normals at 1000 seeded interior points vs `groundNormalAt` within 0.02 (print max). 2. Far tiles: skirts at `tileMinH - 1`; LOD1 uses only every 4th column/row + last; no LOD0 triangle's xy footprint intersects the open near rectangle (area test on every triangle). 3. Stitch: loop counts; every triangle positive xy area and cross z > 0; near + stitch + kept far triangles cover 5000 seeded xy points of the far map exactly once (points within 1e-6 of an edge excluded). 4. Flip: `bakeNearBand(cx + 1, cy)` then `step(2)` until done: each call <= 2 ms + one row (warn-only), `meshVersion` changes only on the swap call, result byte-equal to a fresh `TerrainMeshSet` on the new band; zero-allocation gate over 2000 `step` + `addToDrawList` calls incl. 3 flips. 5. Raster integration: real `overworld_far.js` recipe, `bakeNearBand` at the tower chunk, 3 hillside poses, `rasterDrawList` (`kind7Mat = set.typeAt`) vs `castTerrain`, kind-7 cells excluding 4-neighbour kind edges: kind >= 97 %, mat equal on >= 97 % of matched cells, depth within 2 %; print the rest (phase-1 known differences: triangles vs bilinear, near/far switch).
Do not: edit `Terrain.js`/`terrainCaster.js`; sample `heightAt` for vertices inside the band; rebuild inside a fixed step or inside `rasterDrawList`; give terrain per-cell planeIds; enable `DRAW_FLAG_DEPTH_BIAS` by default.

#### 27.15.5a ME-06 findings and rules (architect, 2026-09-28; normative)

Root causes of the "far/outside poses fail with terrain on" report, found with a Node probe (`rasterDrawList` of the `TerrainMeshSet` vs `castTerrain` at the `?gpucompare=1` poses) and confirmed headless (`tools/capture-browser.mjs` with `&renderer=mesh`):
1. **Near-chunk vertices were at the cell corner** (`li * cell` from origin `x0 + start*cell`), not the cell centre `x0 + (i + 0.5) cell` of 27.15.5 that `util.gridHeight`, the far tiles and the stitch ring use: a 1 m shift of the whole band (outsideFar kind 27 % -> 98.6 % in the JS twin). Fixed in `_publishNear` + bbox; `terrainMesh.test.js` asserts the centre.
2. **Terrain must never be drawn inside a placed structure's 2D bbox** - the DDA rule (`terrainCaster.js` `buildSkips`, "cells in a structure bbox belong to the structure") had no mesh twin, so once the band published (frame ~5) the hill crown under the tower poked through the tower floor (spawn pose kind 4 %). Rule: `terrain.vert.js`'s fragment stage discards fragments with world xy in any `uStructFoot[i]` = `(x0, y0, x1, y1)` box (`[x0, x1) x [y0, y1)`, `uStructCount <= MAX_STRUCTS`, filled from `world.structures[].bbox` per frame); `rasterJS` twin = `ctx.structFoot`/`ctx.structCount`. Per-fragment, not a mesh carve: exact at the boundary, no rebuild when the editor moves a structure, <= 8 box tests per terrain fragment. Only `world.structures` (grid levels) carve; props/meshes do not. Extension point: a structure flag to opt out (glTF buildings with their own ground) - not before phase 3.
3. **Front/back near sets share ids** (`terrain:near<i>`, the `MeshBuffers` cache key) so `meshVersion` must come from ONE counter across both sets (`_nearVersion`); per-mesh `++` re-used "version 2" on the second flip (stale GPU buffer).
4. **Pose `outsideFar` (BUG-OWN-008 pose B) had its eye 1.3 mm above the bilinear ground** - ill-conditioned for any triangle surface (mesh path saw the underside). Raised to ground + eyeHeight (-0.78 m, still below the level origin z, which is what that pose tests). DDA baseline still 33/33 PASS.
5. **The DDA never samples the 2 m band on `overworld_far`:** `activeNearLOD` needs `recipe.nearLOD.step`, which the recipe does not carry, so CPU and GPU DDA both march the 8 m far grid everywhere (US-026a near sampling is effectively off in the game). The mesh draws the 2 m band (hDraw incl. canopy). Consequence: mesh-vs-DDA differences on hillsides (depth 2-20 %, horizon rows, glyphs) are legitimate 27.7 item 3 "known differences", not bugs. NEEDS designer/PO: decide whether `nearLOD.step` should be added to the recipe (then the DDA uses the band up to `handover`) before the `?gpucompare=mesh` migration compare is read.
6. **Oracle rule (restates 27.1 item 4 / 27.7 item 2):** `?gpucompare=1&renderer=mesh` must compare the GPU raster pass against the **JS twin** (`rasterDrawList` over the same `DrawList`, `kind7Mat = set.typeAt`, `structFoot` from the world), not against the CPU DDA. Today `renderWorld(fb.gpuDda = false)` always runs `castScene/castTerrain`, so the harness compares mesh vs DDA and the 27.7 item 2 thresholds (kind 99.5 %, depth 1 %) cannot hold on terrain. Required (ME-06): `renderWorld` gains a `fb.renderer === 'mesh'` branch (DrawList -> `rasterDrawList` -> `copyToGBuffer` + depth), the `TerrainMeshSet` is shared by both twins through one cache (`engine/mesh/terrainMesh.js` `terrainMeshSetFor(terrain)`, WeakMap; the pipeline's private WeakMap moves there), and the harness settles it (`while (set.step(2));`) before each pose so a pose never depends on how many frames ran before it. DDA-vs-mesh stays the separate `?gpucompare=mesh` mode with the item 3 gates.
7. Far-under-band carve timing stays "carve at far build for `terrain.near`" (a ground hole outside for the ~5 frames until the band publishes). Tried "carve only once published": the 8 m grid + canopy then pokes through the tower floor for those frames - worse.

#### 27.15.6 ME-07 voxelMesh (2 d)

Files: new `engine/mesh/voxelMesh.js`, `engine/mesh/voxelMesh.test.js`.
```js
export function buildVoxelMesh(pm, opts)               // pm = packVoxelModel output (resolved matIds); opts { id: 'vox:<modelKey>', partNames: string[] } -> MeshData (static)
export class VoxelMeshCache { get(pm, modelKey, partNames) }   // WeakMap by pm identity (VoxelPool.bind repacks -> rebuild on first sight)
export function addVoxelInstances(list, pool, cache, partNamesFor)   // one DRAW_VOXEL item per pool.list entry k (already posed + culled by VoxelPool.project)
```
- Mesh-local = model voxel units (the space of `parts[].box`/`pivot`); **no cellM in the mesh** (FORWARD carries cellM, yaw, anchor, instance translation). `ranges[p] = {start, count, part: partNames[p]}` in part order (count may be 0).
- **Exposed face:** solid voxel `(x, y, z)` of part `p` (`pm.vox[atlasOff + (x-x0) + bx((y-y0) + by(z-z0))] != 0`, value = local mat) has an exposed face in direction f iff the neighbour is outside part p's box or empty **in part p** (the march only sees part p's atlas). Part-local face codes: 4 W (-x), 2 E (+x), 1 N (-y), 3 S (+y), 5 U (+z), 6 D (-z).
- **Layer** (planeId bits 0-17) = the solid voxel's index along the face axis from the box min (`x - x0` for W and E, `y - y0` N/S, `z - z0` U/D) = `marchVoxelRay`'s `curLayer`. Plane: W at `x`, E at `x + 1`, N at `y`, S at `y + 1`, D at `z`, U at `z + 1`.
- **Greedy** per (part, face, layer): 2D mask over `(a, b)` = `(y, z)` for W/E, `(x, z)` for N/S, `(x, y)` for U/D, value = local mat or 0; scan `b` ascending then `a` ascending; at an unvisited cell extend `a` while same mat and unvisited, then extend `b` while the whole run matches; emit; mark visited. Merge equal mat only.
- Per quad: corner `uv = ((a - boxMinA) * cellM, (b - boxMinB) * cellM)` (castModels mapping); `nrm` = local face normal; `flat0 = (0xF << 28) | ((p & 7) << 21) | ((f & 7) << 18) | (layer & 0x3FFFF)` (instance bits from the item); `flat1 = packFlat1(8, f, pm.matIds[local])` (face bits = local face, informational; rasterJS derives the world face); aux `[0, AO_NONE, 0, ...]`; `matsResolved = true`.
- `addVoxelInstances`: for `k` in `pool.list` order: `computeVoxelPose(pm, inst, scratch)`, copy `FORWARD[12p .. 12p + 11]` into `partMatrices`, `partFlags[p] = scratch[16p + 12]`, `planeIdOr = (k & 0xF) << 24`, `objectId = 0x8000 | k`, `zBase = inst.z`, `aabb` from `inst.rect` min/max. Zero allocation (cache hits, module scratch).

Steps: 1. Mesher on `quadruped12` + `lever` + `boulder` (side-effect import `design/models/voxel_props.js` + `voxel_tower.js` as `world.test.js` does) -> `voxelMesh.test.js`: area invariant (sum of quad areas per part/face == brute-force exposed faces), every quad on its layer plane, no overlap within one (part, face, layer), determinism (byte-equal twice). 2. Triangle table for every content voxel model; fixtures asserted <= 2000; a content model over 2000 prints `WARN` and goes into the row as `NEEDS PC-A: PO/architect triangle budget <model> <n>` (content decision, not a code failure). 3. March oracle: `quadruped12` mid-clip and `lever` at yaw 37: for every quad, world point = FORWARD(quad centre + 1e-3 * normal); `marchVoxelRay` from 0.5 m out along the world normal back toward it hits the same part/face/layer, `t` within 1e-6. 4. Raster integration: `addVoxelInstances` + `rasterDrawList` vs `castModels` at 3 poses (lever, burner, boulder; 160x60), kind-8 cells excluding kind edges: kind >= 98 %, planeId/mat equal on >= 99 % of matched cells, depth within 1 %; zero-allocation gate on 1000 `addVoxelInstances` calls.
Do not: write a second pose implementation (use `computeVoxelPose`/`FORWARD`), bake poses into vertices, merge across mats or parts, edit `engine/voxel/*`.

#### 27.15.7 ME-09 bvh (1.5 d)

Files: new `engine/physics/bvh.js`, `engine/physics/bvh.test.js`.
```js
export const BVH_LEAF_MAX = 4;
/** @typedef {Object} Bvh
 * @property {number} triCount
 * @property {number} nodeCount
 * @property {Float64Array} tri          9 per triangle, world m, BVH order
 * @property {Int32Array} triId          BVH order -> source triangle index (MeshData triangle)
 * @property {Float64Array} nodeMin      3 per node
 * @property {Float64Array} nodeMax
 * @property {Int32Array} nodeStart      inner: left child (right = left + 1); leaf: first triangle (BVH order)
 * @property {Int32Array} nodeTriCount   inner 0; leaf 1..BVH_LEAF_MAX (ME-09 review: renamed from the duplicate `nodeCount`; `nodeCount` = the scalar total)
 * @property {Int32Array} stack          traversal stack (depth + 2); queries are not re-entrant per Bvh */
/** @typedef {{t:number, tri:number, u:number, v:number, nx:number, ny:number, nz:number}} RayHit   tri = BVH-order index; n = unit winding normal */
export function buildBvh(pos, idx, matrix12)          // pos xyz Float32Array|Float64Array; idx null = unrolled, else Uint16Array|Uint32Array; matrix12 null = identity, else DrawItem layout, baked at build
export function buildBvhFromMesh(mesh, matrix12)      // MeshData static or terrain, whole mesh
export function refit(bvh, pos, idx, matrix12)        // same topology, new positions (grate collider, ME-11); zero allocation
export function queryAABB(bvh, x0, y0, z0, x1, y1, z1, out, maxOut)   // -> count; BVH-order indices into out (Int32Array), inclusive overlap, left-first order, stops at maxOut
export function raycast(bvh, ox, oy, oz, dx, dy, dz, tMax, out)       // -> boolean; nearest t in [0, tMax) (as built: t == tMax is a miss; on a miss out.t = tMax, other fields untouched); double-sided Moeller-Trumbore (|det| < 1e-12 = parallel)
export function raycastAny(bvh, ox, oy, oz, dx, dy, dz, tMax)         // -> boolean, early out (later shadow/VPL use)
export function segment(bvh, ax, ay, az, bx, by, bz, out)             // raycast with d = b - a, tMax = 1
```
- Build (load time, allocates): float64 centroids; recursion over index ranges: bounds = triangle bounds; `count <= 4` -> leaf; else axis = longest axis of the **centroid** bounds (ties x, y, z), sort the range by centroid on that axis, ties by source index (deterministic), split at `start + (count >> 1)`; children adjacent. Arrays trimmed to size.
- Queries: explicit stack; `raycast` visits the nearer child first by slab entry (tie -> left), prunes by the best t, replaces only on strictly smaller t. Hit normal = normalised `cross(p1 - p0, p2 - p0)` of the stored world triangle.

Steps: 1. Build invariants on seeded soups (10, 1000, 20000 triangles) and the tower `levelMesh` base (matrix = tower origin) -> `bvh.test.js`: each triangle in exactly one leaf, node bounds contain children/triangles, two builds byte-identical. 2. `queryAABB` vs brute force on 2000 seeded boxes (sorted set equality). 3. `raycast`/`segment` vs brute force on 5000 seeded rays incl. axis-parallel rays and rays through shared edges/vertices: same hit/miss, `t` within 1e-9, same triangle unless another has equal t within 1e-12. 4. `refit` after moving vertices == fresh build's query results. 5. Zero-allocation gate on 10k mixed queries; print tower build ms and 10k raycasts ms (warn-only).
Do not: recurse in queries, allocate hit objects, import `engine/mesh` at runtime, expose nodes outside physics (27.10: `rigid.js`/player never see triangles or nodes).

#### 27.15.8 Estimate

| Story | Programmer-days | Can start |
|---|---|---|
| ME-00 | 1.5 | now |
| ME-01 | 2.5 (caster oracle) | after ME-00 |
| ME-02 | 1 | after ME-00, parallel to ME-01 |
| ME-03 | 3 | after ME-01 + ME-02 |
| ME-09 | 1.5 | after ME-01, parallel to ME-03 |
| ME-05 | 2.5 (stitch + far tiles) | after ME-03 (no S1 wait) |
| ME-07 | 2 | after ME-03, parallel to ME-05 |

Total ~14 programmer-days (27.11 said 13: +1 for the ME-01 oracle and the ME-05 stitch). Two programmers on the parallel plan: ~8-9 working days. In 2-3 days PC-B can realistically land ME-00, ME-01 and ME-02 and start ME-09.

### 27.16 ME-08 implementation notes (normative; architect, 2026-09-29)

Goal: voxel props drawn by the GPU raster pass and its JS twin, judged with the existing harnesses, then the phase-1 gate report. Facts this builds on (read before coding): `_passRaster` (GpuCellPipeline.js) already draws `DRAW_STATIC` with `mesh.vert/frag` and `DRAW_TERRAIN` with `terrain.vert`; `rasterJS.js` already has the kind-8 fragment rule (27.15.0 item 12: `partAxisAligned ? roundedFace(N) : FACE_PACKED`, uv from the mesh, `z = worldZ - zBase`); `addVoxelInstances`/`VoxelMeshCache` exist (ME-07, 27.15.6); on both twins the **packed normal of a face-7 cell lives in GA.w** (`voxelMarch.js` `getAoAlias`, `copyToGBuffer`, `light.frag.js` "faceU == FACE_PACKED"), not in GI.z - GI.z is only read for kind 7 (`shade.frag.js` `Nt`). Nothing in light/shade/edge changes for kind 8: `fk = 1`, `aoD = 1e30` for face 7, model rim - all already keyed on `KIND_MODEL`.

**Decisions (amend 27.6 / 27.4 where they differ):**
1. **One draw per (instance, part), `uModel` = `item.partMatrices[p]`** (4x3 -> mat4 exactly as the static loop does), `drawArrays(range.start*3, range.count*3)` over `mesh.ranges[p]` with `count > 0`. No `uPart[8]` uniform array: every part is a separate draw anyway (its own range), so `uPart[8]` would only save uniform uploads. Bound: <= 16 instances x <= 8 parts = 128 draws worst case, ~20 typical (crash room: 6 props, 1-3 parts each), ~5-10 us each => <= 0.2 ms JS (27.8 "uniforms/draw calls"). Record the measured draw count in the ME-08 row; it is the ME-17 WebGPU-trigger baseline. A per-vertex part index + `uPart[8]` is a later optimisation, not phase 1.
2. **Face code = `castModels`' rule (27.15.0 item 5), not 27.4's 0.9 dominance:** `item.partFlags[p] & 1` (axis-aligned pose, from `computeVoxelPose`) -> `roundedFace(N_world)`; else face 7 + packed normal. `roundedFace` in GLSL must be the literal twin of `voxelMarch.js` (`>=` comparisons, E/W tested first, then S/N, then U/D - copy the three lines already in `voxel.frag.js`; that file is frozen, so copy, and `glsl.test.js` asserts the two bodies are string-equal after whitespace normalisation). The DDA oracle uses this rule; parity first, the 0.9 rule stays an option for after the gate.
3. **Shader: extend the `mesh.vert/frag` family, no new program.** `mesh.vert.js`: `uniform int uObjectId; uniform int uAxisAligned;` `flat out vec3 vNrmW = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));` (`mat3(uModel)` = rotation x uniform cellM, so normalising is exact; `flat` because a greedy quad has one normal - `rasterJS` interpolates identical normals, same value). `mesh.frag.js`: `face = vFace; nrmBits = 0u; if (vKind == 8u) { if (uAxisAligned != 0) face = roundedFace(vNrmW); else { face = 7u; nrmBits = packNormalOct(vNrmW); } }`; GA.w for kind 8 = `floatBitsToUint(1e30)` (face 1-6) or the packed bits (face 7, raw uint); `outGI = uvec4(planeId, kind|face<<8|mat<<16, nrmBits, uint(uObjectId))`. Kinds 1-6 get `uObjectId = item.objectId` (= structSeq, identical to today's decode from planeId) - one rule for every item. GI.z carries the normal for the future 27.4 reader; nothing reads it for kind 8 in phase 1.
4. **Uniforms per voxel draw:** `uModel` (part matrix), `uPlaneIdOr = item.planeIdOr` (`(slot&0xF)<<24`, ORed onto `flat0` in the vertex shader exactly like structures), `uZBase = item.zBase` (`inst.z`; `aux.zRef = 0` from ME-07, so `z = worldZ - inst.z` = `castModels`' `worldZ`), `uObjectId = item.objectId` (`0x8000|slot`), `uAxisAligned = item.partFlags[p] & 1`. Static draws set `uAxisAligned = 0`.
5. **Where instances come from (both twins, one cache):** `VoxelPool.project(cam, rt)` keeps running on the mesh path (it already does: "useDda && this._voxelPool"); it fills `pool.list` (posed, screen-culled, `rect` = world AABB). `addVoxelInstances(list, pool, sharedVoxelMeshCache, pool.partNamesFor)` after the terrain items and before `list.cull` (the frustum cull is a second, cheap cull). `voxelMesh.js` exports a module-level `sharedVoxelMeshCache = new VoxelMeshCache()` (same pattern as `terrainMeshSetFor`: one object for the GPU pass and the JS twin, WeakMap by `pm` identity so a rebind rebuilds). `VoxelPool.bind` records `this._partNames.set(modelKey, Object.keys(def.parts))` once and exposes `partNamesFor = (key) => this._partNames.get(key)` (bound in the constructor; returns the stored array, never a new one). Voxel MeshData ids `vox:<modelKey>` need a fresh `meshVersion` per build (ME-07 review item 2) because `MeshBuffers.get` keys by id + version.
6. **Mesh path skips the DDA voxel pass and its atlas:** in `frame()`, `_ensureVoxelAtlas` and `_passVoxel` run only when `renderer !== 'mesh'` (VRAM + a pass saved; `_voxelActiveThisFrame` stays computed for F3). PASS_NAMES unchanged: on mesh, `cast` = the whole raster pass (structures + terrain + voxels), `terrain`/`voxel` read 0 - say so in the ME-08 row, no timer change.
7. **JS twin (`compositor.js`):** `renderWorldMesh` pushes voxel items (item 5) before `list.cull`; `castModels` must **not** run when `fb.renderer === 'mesh'` (`if (fb.gbuf && fb.voxelPool && fb.voxelPool.list.length && fb.renderer !== 'mesh')`) - otherwise voxels are drawn twice and the twin's depth test is bypassed. `copyToGBuffer` already writes the face-7 normal into the aoD alias; `lightSurfaces` reads it there. `rasterJS` takes kind-8 `mat` from `flat1` - correct only after ME-07 review item 1 (`pm.matIds[local]`).
8. **Compare harness:** on `renderer === 'mesh'`, `?gpucompare=1` judges kind-8 cells at the 27.7 item 2 bar - drop the `ExclK8` substitution for the mesh path (keep the counters for the report), keep the `k8Cpu > 0 && k8Gpu > 0` guard on voxel poses. Poses: lever (3 synthetic + mid-pull/idle), lantern near, `crash room` (burner + lamp + gondola + heap + rubble = the "burner" pose), voxel yaw 100.3. **Waystone poses (`waystoneLookBack`/`waystoneDown`) have the eye at (1428, 1040, 2.13) inside the waystone's voxel volume:** the DDA returns a solid kind-8 screen at t ~ 0 and the mesh sees the model from inside (cull none) - any number there is meaningless. Fix the poses, do not special-case the renderer: keep yaw/pitch, move the eye 2 m back along `-fwd` (`x -= 2 sin yaw`, `y += 2 cos yaw`), `z = groundAt(x, y) + 1.6` (the outsideNear/outsideFar fix), comment why, and assert `k8Cpu > 0` so the waystone stays in view; obey the 1/64 px silhouette rule (ME-06 review item 3). **"Brazier"** in the gate list is the tower's `brazier` light (a billboard, no voxel model): a look pose only (item 10), not a kind-8 pose. `?gpucompare=mesh`: the `voxel` category should collapse to edge cells; a remaining voxel difference > 1 % on a pose gets a per-field diff (`mismatchByKind`/`outsideSample`) and a known-difference entry only with a stated cause.
8a. **Mesh compare precondition (architect, 2026-09-29; `renderer === 'mesh'` only, DDA bar unchanged):** `meshColourOk` = kind 100 % raw + `k8` guard + glyph >= 99.5 % + `poisonedSurvivors === 0` + geometry (<= 4 distinct cells per pose with any depth/uv/ao/z/face/nrm violation (`geomViolCells`), every violating cell kind 8 (`compareGeometry.violNonK8 === 0`, reported only), `aoViol === 0`; kind >= 99.5 % and holes 0 still required) + colour (cells outside tolerance <= 1 %; the fgMax <= 96 cap applies to non-kind-8 cells only via `compareCells(..., k8NoCap)` / `fgMaxNonK8`; kind-8 outliers have no magnitude cap but count toward the 1 %). Logged per pose: geomViol, geomViolCells, violNonK8, k8 colour outliers, non-k8 fgMax. Amends "do not widen the compare thresholds for voxel cells": geometry thresholds unchanged, only the colour-gate precondition widens, bounded to kind-8 cells. Camera-relative matrices = post-gate follow-up only if violations grow far from the origin.
9. **`?flicker=1` on mesh:** `gpuPipeline` is built with `renderer` from the URL, so `?flicker=1&renderer=mesh` already measures the mesh GPU row; run both (`rays` default), record the GPU changed-glyph share for dda and mesh; gate: mesh <= dda x 1.10. Optional 1-liner: `fbCompare.renderer = renderer` so the JS row is the mesh twin too. Same poses as today (test_room walk) - the AC says "same poses"; add nothing.
10. **Side-by-side (AC 2), smallest thing:** (a) `tools/bench-poses.js` exports `GATE_POSES` = 6 `{slug, name, world, cam}` (crashRoom = the compare pose, stairs = the "voxel half occluded (stair edge)" cam, brazier = 2.5 m in front of `tower.js` light id `brazier` at eye height facing it, breach = the compare pose, hillside = outsideNear, waystone = the fixed waystoneLookBack); (b) `main.js` `runGame`: `?pose=<slug>` teleports the player to that cam after load (position + yaw + pitch, the existing teleport path), `?f3=1` opens the overlay at start - <= 15 lines, both hot-file edits kept local; (c) new static page `game/sidebyside.html`: two iframes `index.html?renderer=mesh&pose=S&grid=G&f3=1` | `index.html?renderer=dda&pose=S&grid=G&f3=1`, a pose `<select>` (6 slugs) and a grid `<select>` (240x90, 320x120, 400x150) that reload both; no engine imports. Two WebGL contexts at 400x150 are ~3 ms each on the owner iGPU - fine. The diff PNGs of `?gpucompare=mesh` stay the numeric side-by-side at 160x60; this page is the owner's look + F3 timings at the three grids.
11. **Gate report (in the ME-08 row, then the `### Mesh phase-1 gate` list, then ESCALATE TO MANAGER for the D-029 amendment):** (a) look: owner verdict per gate pose x grid from the side-by-side page; (b) parity: `?gpucompare=1&renderer=mesh` N/33 (headless, no `&voxels=0`), `?gpucompare=mesh` per-pose category table (voxel / terrainGrid / other) with every > 1 % explained; (c) speed: `?bench=1` GPU p95 mesh vs dda at 240x90 and 400x150 (fixed views + 60 s walk, `over25`), JS ms, the voxel draw count; (d) run-tests, check-deps, typecheck, the zero-allocation probes (ME-07 step 4 gate + `addVoxelInstances`). Numbers vs the 27.11 gate: 400x150 <= 3.38 ms, 240x90 <= 1.8 ms, flicker <= +10 % relative.

**Perf expectation vs 27.8:** ME-06 measured mesh p95 (no props) 2.65 / 1.47 ms at 400x150 (view / walk) and 1.22 / 0.85 ms at 240x90. Props add <= ~6k triangles in the crash room (burner 1196 + gondola 1180 + canvasHeap 1314 + rubble ~850 + lantern 608; every model <= 1314, ME-07 table) and <= 128 draws worst case: expect +0.05-0.2 ms GPU, +0.1-0.2 ms JS. Target: <= 2.9 ms at 400x150, <= 1.4 ms at 240x90 - inside the gate with margin; the DDA's own voxel pass (~0.3-0.5 ms when props are on screen) disappears on mesh. If a pose exceeds 3.38 ms, first suspect the draw count (F3 JS ms rises with it), then overdraw of large near quads (sort voxel items near-to-far as `addStructures` does).

**Per-frame allocation rules (hard, 27.15.0):** `addVoxelInstances` allocates nothing (cache hit, `partNamesFor` returns the stored array, `list.push` reuses items); the `_passRaster` voxel loop uses the existing `_meshModelF32` scratch and scalar uniforms only; `MeshBuffers.get` uploads once per (id, meshVersion) - a second frame with the same pool must create no buffer (assert in `MeshBuffers.test.js` with a voxel MeshData: same entry returned, new `meshVersion` re-uploads once); the JS twin reuses `meshDrawList` (capacity 256 >= 8 structures + terrain items + 16 voxel items). `VoxelPool.bind` builds the part-name arrays once.

**Steps (each <= 1 programmer-day, PC-A):**
- **ME-08a - GPU voxel draws.** Items 1-4, 6, `VoxelPool.partNamesFor`, `sharedVoxelMeshCache`. Tests: `glsl.test.js` (uniform/varying names, roundedFace body equality with `voxel.frag.js`), `MeshBuffers.test.js` voxel-range upload-once case. Done-when: `tools/capture-browser.mjs --mode gpucompare --grid "160x60&renderer=mesh"` shows `k8Gpu > 0` on every voxel pose (numbers may still fail), run-tests + check-deps + typecheck green.
- **ME-08b - JS twin + parity.** Items 5, 7, 8 (ExclK8 off on mesh, waystone poses fixed). Tests: a `compositor` Node check that `fb.renderer === 'mesh'` with a bound pool (set up as `engine/render/voxelPool.test.js` does) writes kind-8 cells whose planeId carries `(k&0xF)<<24`, and that the kind-8 cell count equals the raster target's (castModels not reached); ME-07 step 4 is the geometry oracle. Done-when: `?gpucompare=1&renderer=mesh` 33/33 headless (BUG-GPU-005 excepted if still open), `?gpucompare=mesh` table re-captured with the voxel column, numbers in the row.
- **ME-08c - side-by-side + flicker + bench + gate report.** Items 9-11. Done-when: `game/sidebyside.html` works at the three grids with F3 on both panes, flicker and bench numbers in the row, the gate list filled, ESCALATE TO MANAGER written with the architect's go/no-go recommendation, owner walk-test requested.

Do not: add a second voxel pose implementation (only `computeVoxelPose`/`FORWARD` via `addVoxelInstances`), touch `voxel.frag.js`/`voxelMarch.js` (frozen), read GI.z for kind 8 in light/shade (GA.w is the phase-1 home of the packed normal on both twins), widen the compare thresholds for voxel cells, or rebuild voxel meshes per frame (WeakMap hit only).

### 27.17 ME-10 implementation notes: `meshCollide.js` (normative; architect, 2026-09-29; PC-B)

**Amends 27.10 items (2)-(4) for the walking capsule and the roller sphere.** Decision: a *banded 2.5D* mesh collider that is the literal twin of `moveCapsule` + integrate step 5, not a free 3D capsule solver. Reasons: (a) the player/roller capsule is vertical and never rotates, so 2.5D is exact for it; (b) it is the only way the US-008/009 behaviour (step-up only while grounded, lintel = wall mid-jump / doorway at floor level, fall into gaps) carries over within 1 cm, because every grid rule maps to one band rule below; (c) free 3D contacts are needed only by rigid bodies and live in `contacts.js` (27.18, ME-11b). Terrain is never a collider here (heightfield merge stays in `World`, 27.18).

Files: new `engine/physics/meshCollide.js`, `engine/physics/meshCollide.test.js`, `engine/physics/meshCollide.parity.test.js`; edit `engine/physics/integrate.js` (2 hooks, ME-10c). Runtime imports: `./bvh.js` only (check-deps rule 11: no `engine/mesh`; tests may import `levelMesh`, as `bvh.test.js` does).

```js
/** @typedef {Object} MeshCollider
 * @property {string} id              `${structure.id}` (base) or `${structure.id}:${tag}` (dynamic tag)
 * @property {'trimesh'} kind
 * @property {import('./bvh.js').Bvh} bvh   world-space (matrix baked at build)
 * @property {Float64Array} min       3, world AABB = bvh.nodeMin[0..2] (refreshed after refit)
 * @property {Float64Array} max       3
 * @property {boolean} enabled */
/** @typedef {{x:number, y:number, blockedX:boolean, blockedY:boolean, nx:number, ny:number, overflow:boolean}} CircleMove   moveCapsule's out + overflow */
/** @typedef {{floorZ:number, floorHit:boolean, fnx:number, fny:number, fnz:number, floorCollider:number, floorTri:number,
 *             ceilZ:number, ceilHit:boolean}} MeshSupport   floorZ = FLOOR_NONE (-1e9) when !floorHit; ceilZ = Infinity when !ceilHit */
export const FLOOR_NONE = -1e9;
export const MESH_PROBE_DROP = 256;   // m, max floor ray length below the start point
export const MESH_PROBE_RISE = 64;    // m, max ceiling ray length
export const MESH_CAND_MAX = 256;     // candidate triangles per collider per iteration
export function moveCircleMesh(colliders, count, x, y, dx, dy, radius, footZ, grounded, opts, out)   // opts {height, stepUpMax, walkCos}; returns out (CircleMove)
export function probeSupport(colliders, count, x, y, footZ, grounded, opts, out)                    // returns out (MeshSupport)
export function meshSupportSector(sup, terrainZ, tnx, tny, tnz, out)   // sector-shaped: {floorH, ceilH (number|'sky'), solid:false, terrain, slope, nx, ny, nz}; terrainZ NaN = no terrain
export function moveSphereMesh(colliders, count, x, y, dx, dy, radius, z, opts, out)                // = moveCircleMesh with height 2r, stepUpMax 0, grounded true (sphere.js twin)
```
`opts.walkCos = cos(cfg.maxSlopeDeg)` is computed once by the caller (body scratch, like `_collideOpts`); `colliders`/`count` = a plain array + live count (World owns it; disabled and non-`trimesh` entries skipped).

**Band rule (the whole algorithm; SKIN = 1e-6 as capsule.js).** Per call: `zLo = footZ + (grounded ? stepUpMax : 0)`, `zHi = footZ + height`. A triangle is a *horizontal blocker* iff it is **not walkable** (`nz < walkCos`, normal = normalised winding cross of the stored world triangle; down-facing ceilings/soffits are blockers too) **and** its part inside the open slab `zLo + SKIN < z < zHi - SKIN` is non-empty. Mapping to the grid: a riser whose top is <= footZ + stepUpMax is below the slab (walked up, the probe snaps z) = `floorDiff <= stepUpMax`; airborne `zLo = footZ` = "any rise blocks"; a lintel's front face spanning `ceilH..topH` enters the slab iff `footZ + height > ceilH` = US-009 AC5 head clearance; the closed grate's `upperMat` face (`ceilH = floorH .. topH`) blocks until `ceilH >= footZ + height`, the same threshold as `isSectorPassable`.

**`moveCircleMesh`** = `moveCapsule`'s loop verbatim (move to `x+dx, y+dy`, <= 4 iterations, single deepest contact per iteration, strict `>` so the first-found wins ties). Per iteration, for each enabled collider whose AABB overlaps the box `[cx-r, cy-r, zLo] .. [cx+r, cy+r, zHi]`: `queryAABB` into a module `Int32Array(MESH_CAND_MAX)` (count == max -> `out.overflow = true`, keep going with what was returned); for each blocker candidate: clip the triangle by the two z planes (Sutherland-Hodgman, <= 5 vertices, module Float64Array scratch), project to xy, closest point q from the centre c to the polygon = min over its edges of point-segment distance (handles the degenerate segment of a vertical wall). If the polygon has area > 1e-12 and c is inside it: depth = r + |c - q|, push direction c -> q. Else skip when `dist^2 >= (r - SKIN)^2`, depth = r - dist, normal `n = (c - q)/dist`. Resolve like capsule.js: `|n.y| < 1e-9` -> face contact on X (`cx = qx +- r`, `blockedX`); `|n.x| < 1e-9` -> face on Y; else `c = q + n*r` and `out.nx/ny = n` (corner or diagonal wall: integrate already projects the velocity). `dist == 0` outside-case -> revert to (x, y), both blocked (capsule.js's defensive branch). Why this is the grid twin: an axis-aligned wall quad clipped to the slab projects to the same segment as the grid cell edge, and two quads meeting at a corner give the same corner point, so positions equal the grid's to float rounding.

**`probeSupport`**: floor = `raycast` straight down from `(x, y, footZ + up)`, `up = grounded ? stepUpMax + SKIN : SKIN` (airborne never snaps up onto something above the feet), `tMax = up + MESH_PROBE_DROP + SKIN` (`raycast` excludes `t == tMax`); nearest hit over all colliders whose xy AABB contains (x, y) (strictly smaller t wins; ties -> lower collider index) -> `floorZ`, normal flipped to `nz >= 0`, collider, BVH tri. Any slope counts as floor here (a 51 deg ramp is stood on and slid down, see `slope`). Ceiling = `raycast` straight up from `(x, y, max(footZ, floorZ) + SKIN)`, `tMax = MESH_PROBE_RISE` -> `ceilZ` (vertical walls are parallel to the ray and never hit). Centre-point probe on purpose: the grid reads the sector under the centre. At an exact cell boundary the mesh returns the higher of two floors where the grid picks `floor(x)` - the parity harness skips steps with x or y within 1e-9 of an integer and reports how many.

**`meshSupportSector`**: `floorH = max(sup.floorZ, terrainZ)` (NaN terrain ignored); `terrain = terrainZ >= sup.floorZ` (terrain slope rule, 23.3, normal = terrain normal); `slope = !terrain && sup.floorHit` with `n = sup.fn` (mesh surfaces use the same slide hysteresis; flat floors have nz = 1 and never slide); `ceilH = sup.ceilHit ? sup.ceilZ : 'sky'`. Written into a caller-owned scratch (World keeps one, like `_outsideScratch`).

**integrate.js hooks (ME-10c, the only change to existing physics):** step 4: `const moved = world.physicsMode === 'mesh' ? world.collideCircle(t.x, t.y, body.vx*dt, body.vy*dt, body.radius, t.z, body.grounded, body._collideOpts, body._move) : moveCapsule(...)`; step 5: `const sector = world.physicsMode === 'mesh' ? world.supportAt(t.x, t.y, t.z, body.grounded, body._collideOpts) : sectorOrOutside(world, t.x, t.y)`; the slope branch condition becomes `if (sector.terrain || sector.slope)`. `_collideOpts` gains `walkCos` (rebuilt when `cfg.maxSlopeDeg` changes, same pattern as height/stepUpMax); `_move` gains `overflow: false`. Nothing else in integrate changes; the 7.1 step order is untouched; grid mode stays bit-identical.

**Allocation / perf:** zero allocation per call (module scratch: candidate Int32Array, clip Float64Array, one RayHit object; `raycast`/`queryAABB` use the Bvh's own stack, not re-entrant - never call one query from inside another). Budget per body per step <= 0.05 ms at the tower (4 iterations x ~20-60 candidates + 2 rays); `worldWalk.perf` stays <= 1 ms sim (27.18 ME-11c). Determinism: float64 throughout, fixed collider order, left-first `queryAABB` order, strict comparisons - two runs bit-equal.

**Steps (each <= 1 programmer-day, PC-B):**
- **ME-10a - `moveCircleMesh`.** Synthetic meshes built in the test (quads from a tiny helper, then `buildBvh`). Tests (`meshCollide.test.js`): flat floor (no push); wall push-out exact within 1e-6 + `blockedX`; convex corner slide (nx/ny set, no stick; the US-008 rework #3 probe); diagonal wall (normal = wall normal); 0.3 m riser grounded passes / airborne blocks; 0.6 m riser blocks; lintel at floor level passes, feet at +0.5 blocks; closed grate face blocks, at `ceilH = footZ + height` passes; walkable 30/49 deg ramp never blocks; 51 deg ramp above the step band blocks; overflow flag with a 300-triangle fan; zero allocation (`--expose-gc`, 10k calls < 64 KB); two runs bit-equal. Fold in two ME-09 nits: `refit` returns early when `triCount === 0` (today it reads child 1 of an empty root) and the `[0, tMax)` JSDoc wording on `raycast`.
- **ME-10b - `probeSupport` + `meshSupportSector` + `moveSphereMesh`.** Tests: floor under the centre; step-up snap window (0.3 up: grounded hit, airborne miss); 5 m drop -> floor below; no floor -> FLOOR_NONE; ceiling under a lintel / 'sky' in the open; 30/49/51 deg ramp normals (51 -> `slope`, and the 23.3 slide starts in a 60-step `integrate` run on a stub world); terrain merge (terrain above mesh -> `terrain: true`; below -> mesh floor, `slope` false on flat); sphere = circle with h 2r (matches `moveSphere` on a grid twin); zero allocation.
- **ME-10c - integrate hooks + parity harness.** `meshCollide.parity.test.js`: for `tower`, `test_room` and the synthetic levels of `physics.test.js` (mini, ledge, bigroom, pillar, corner - copy their legends), build the grid `Level` and a mesh twin adapter `{ physicsMode: 'mesh', sectorAt, outsideSector, bounds: null, collideCircle, supportAt }` from `buildLevelMesh(level).base` + every `dyn` mesh (`buildBvh(pos, null, null)`, level-local, no terrain); run the same scripted `integrate` control sequences on both (walk into each wall, stairs up and down, jump onto the ledge, walk off the gap, lintel at floor level and mid-jump, pillar corner slide, grate closed/open by setting `ceilH` and rebuilding that dyn BVH in the test): positions within 1 cm and `grounded` equal every step (report max error; boundary steps excluded and counted). Existing suites unchanged. Done-when: run-tests + check-deps + typecheck green, parity numbers in the ME-10 row, -> `arch-review`.

Known, accepted difference: grid `solid` cells (and `SOLID_OUTSIDE`) block at any height; the mesh blocks only up to the rendered top of that geometry, so feet above a low solid block's top can cross it (mesh = what you see). The parity harness reports such steps separately; if a US-008/009 scenario depends on it -> ASK ARCHITECT.

Known difference 2 (ME-10c review, 2026-09-30; **resolved by 27.18b**, 2026-10-01): `tower`'s grate cell borders `ceilH: 'sky'` on its open sides, so `levelMesh`'s upper/lintel rule 3 emits no face and the closed grate was walk-through under mesh physics (grid blocks it per cell via `isSectorPassable`). The earlier content rule (numeric-`ceilH` neighbours) is withdrawn: on `tower` it adds a roof slab (silhouette test 0 -> 94 fails) and breaks the sentinel base check (allocating fallback). Physics closes the gap instead, see 27.18b; `levelMesh.js` is not changed.

**27.18b Dynamic-sector barrier quads (normative; architect, 2026-10-01; ME-12 BUG-1).** Physics-only: `engine/world/colliders.js` appends barrier geometry to each dyn collider; the render mesh, `levelMesh.js`, the silhouette twin and `?gpucompare` are untouched.
1. **Which edges.** For every cell `(c, r)` whose legend char is the tag's sector (`structure.tagMap.get(tag)`), for each of its 4 edges: emit a barrier quad iff the neighbour across the edge is (a) out of the level grid, or (b) non-solid, not the same tag, and has `ceilH === 'sky'`. Solid neighbours already give a rule-2/wall face; numeric-`ceilH` neighbours already give a rule-3 face - no barrier there (no double faces).
2. **Geometry.** Vertical quad on the shared cell edge (level-local `c*S`/`(c+1)*S`, `r*S`/`(r+1)*S`, same `S` and same corner order/winding as `levelMesh.emitWall` for the face pointing out of the dyn cell), 2 triangles, appended in the dyn mesh's own layout (indexed -> append indices). `z0` = the sector's current `ceilH` (bottom edge, animated), `z1` = `sector.topH` (fixed). Required: `typeof topH === 'number' && topH > dynamic.ceilOpen`; otherwise emit nothing for that tag and `console.warn` once (content error). Only `ceilH` animates (`World.animateSector`: closed = `floorH`, open = `ceilOpen`), so floors need nothing. Closed: barrier spans `floorH..topH` and blocks; open: `ceilOpen..topH` = the lintel grid already implies (`isSectorPassable` headroom).
3. **Following the anim.** Build the barrier vertices inside `buildDynCollider`'s sentinel build with `z0 = sentinel`, so the existing `trackCeil` scan marks them; `refitColliderInPlace` then moves them with no new code path (zero alloc, same `refit`). The base-mesh sanity check is unaffected (barriers live only in the dyn collider). The fallback path (`rebuildDynColliderFallback`) appends the same barriers via the same helper.
4. **Helper.** `export function dynBarrierQuads(level, ch, z0, out?)` in `colliders.js` -> appended positions (build-time only, may allocate; NOT exported from `engine/index.js`). One helper, used by build, fallback and tests.
5. **Serialisation:** none - derived from level + `ceilH`, rebuilt on load like every collider.
6. **Tests** (`colliders.test.js` + `tools/route-walk.mjs`): (a) tower grate closed blocks under `physics: 'mesh'` - leg 5a stops within +-0.05 m of grid's x = 19.30; also blocked approaching from the west side; (b) open (t = 1) passes, leg 5b unchanged; (c) mid-anim (t = 0.5) block/pass equals grid at footZ = floorH; (d) the refit-vs-fresh check compares against fresh `rebuildLevelMeshDyn` + `dynBarrierQuads` (multiset within 1e-9); (e) 0 bytes heap growth over 1000 refits (`--expose-gc`); (f) no "sentinel base mesh differs" warn on world_m1; (g) `sectorCaster.silhouette.test.js` 0 fails, `?gpucompare=1` (both renderers) unchanged; (h) `tower:grate` triangle count = 10 + 2 x barrier edges, constant across t.
Do not: change `levelMesh.js` or tower content for this, add a separate barrier collider id (ids/order stay as 27.18), or emit barriers for non-dynamic sectors.

Do not: import `engine/mesh` or `engine/world` at runtime, allocate per call, add a second step-up mechanism (the band *is* the step-up), touch `Player.js` (the US-008/009 suites keep running on it unchanged), or make terrain a trimesh collider.

### 27.18 ME-11 implementation notes: World integration, `physics: 'mesh'` (normative; architect, 2026-09-29; PC-B)

Files: new `engine/world/colliders.js` (+ `colliders.test.js`), new `engine/physics/contacts.js` (+ `contacts.test.js`); edit `engine/world/World.js` (load option, 3 methods, `stepSectorAnims`/`_restoreDynamics` hooks), `engine/physics/roller.js` (2 hooks), `engine/index.js` (exports), `game/js/main.js` (`?physics=mesh`; the PC-B main session edits this hot file itself). `engine/world` may import `engine/mesh/levelMesh.js` and `engine/physics/bvh.js`/`meshCollide.js` (no rule against it; `engine/mesh` never imports `engine/world` at runtime, so no cycle).

**API**
```js
// World.load(def, assets, { physics: 'grid' | 'mesh' })   default 'grid' until the "mesh as default" story
world.physicsMode                    // 'grid' | 'mesh'; content, not state (never serialised)
world.colliders                      // MeshCollider[] (27.17), trimesh only; [] on 'grid'. Amended 2026-09-30 (ME-11 review): NO heightfield entry - terrain is `world.terrain`, `contacts()` reports it as `collider: -1, tri: -1`; a bvh-less entry would only trap iterators
world.collideCircle(x, y, dx, dy, radius, footZ, grounded, opts, out)   // moveCircleMesh over the trimesh colliders
world.collideSphere(x, y, dx, dy, radius, z, opts, out)                 // moveSphereMesh
world.supportAt(x, y, footZ, grounded, opts)                            // meshSupportSector(probeSupport(...), terrain groundAt/groundNormalAt or NaN) -> reused scratch (callers must not keep it, as outsideSector)
//   Terrain is consulted only when `!structureAt(x, y)` (architect confirmed 2026-09-30, ME-11c fix 7a59162): a placed structure occludes the terrain
//   across its bbox, the same gate `sectorAt`/`floorAt` use - world_m1 bakes hillside terrain under the tower, so an always-merge would lift the
//   interior floor to the hillside height. `meshSupportSector` itself stays the literal always-merge formula (NaN = no terrain).
// engine/world/colliders.js
export function buildWorldColliders(world)                     // -> MeshCollider[]; per structure: base (id = structure.id) + one per dyn tag (id = `${structure.id}:${tag}`, tags sorted); matrix12 = translation(origin) (yawSteps is 0 in M1, placeStructure throws otherwise)
export function refitDynCollider(world, structure, tag)        // zero allocation, see "Grate" below
// engine/physics/contacts.js (the Rapier seam, 27.10)
export const CONTACT_MAX = 16;
export function createContactList()                            // {count, px,py,pz,nx,ny,nz,depth: Float64Array(CONTACT_MAX), collider, tri: Int32Array(CONTACT_MAX)}
export function contacts(world, shape, out)                    // shape {type:'sphere'|'capsule', x,y,z, r, h}; `z` = sphere CENTRE / capsule lower segment endpoint (Rapier convention, callers convert from feet - amended 2026-09-30, PC-B QUEUE 5 item 8); -> out.count; sphere / capsule-segment vs triangle closest points (Ericson 5.1.5 / 5.1.9) over queryAABB candidates + one heightfield contact from groundAt/groundNormalAt (collider -1, tri -1); sorted by depth desc, then collider, then tri; when more than CONTACT_MAX overlap keep the deepest; zero allocation
```
Load order: structures placed, dynamics restored (`_restoreDynamics`), then `if (physics === 'mesh') w.colliders = buildWorldColliders(w)` with every dyn collider refitted to the restored `ceilH` - a save taken mid-animation loads with the right collider. Colliders are derived data: never in `serialize`, rebuilt on load.

**Grate / dynamic tags.** Measured 2026-09-29: `rebuildLevelMeshDyn` + `buildBvh` on `tower` = ~1.5 ms per call, over the 1 ms sim budget for every step of the 1.5 s animation; the grate dyn mesh has 10 triangles closed and open (constant topology). So: build each dyn collider **once** at load with the tag's `sector.ceilH` temporarily set to a sentinel `floorH + 1000.5`; record `trackCeil: Uint8Array(vertexCount)` = vertices whose z equals the sentinel exactly; restore `ceilH`; keep a per-collider `pos` copy. `refitDynCollider` rewrites only the tracked vertices' z to the current `ceilH`, calls `refit` and refreshes `min/max` - no allocation, microseconds. Called from `stepSectorAnims` right after `updateAnimatedSector` when `world.physicsMode === 'mesh'`, and after `_restoreDynamics`. Check at build (test + a one-time `console.warn`, never throw): the sentinel build's `base` is byte-identical to the normal base (no base face depends on the tag's ceilH); if not, that structure's dyn tags fall back to a full rebuild per change (allocating, logged once).

**roller.js hooks (ME-11b):** both `moveSphere(world, ...)` call sites (~69, ~258) -> `world.physicsMode === 'mesh' ? world.collideSphere(...) : moveSphere(...)`; roller step 5 `sectorOrOutside(world, t.x, t.y)` -> `world.physicsMode === 'mesh' ? world.supportAt(t.x, t.y, t.z, true, _sphereOpts) : ...` (`_sphereOpts` gains `walkCos`; `supportAt` uses `opts.height` = 2r). Tilt (`layers.tilt`) and `resolveBodyContacts`' actor-vs-roller circle test stay as they are.

**Test matrix:** `colliders.test.js` - tower on world_m1: collider ids/order, AABBs = level bbox + origin; grate refit at t = 0, 0.25, 0.5, 1 equals a fresh `rebuildLevelMeshDyn` + `buildBvh` (triangle multiset within 1e-9); refit zero allocation; `supportAt` inside the tower equals `floorAt`/`ceilAt` on every walkable cell centre (report any cell where terrain is above the tower floor - BUG-OWN-008 check); save round trip mid-grate (`serialize` -> `World.load` -> 200 seeded `collideCircle`/`supportAt` probes bit-equal). `contacts.test.js` - 1000 seeded spheres + 200 capsules vs brute force over all triangles (same count, depth within 1e-9, same order), terrain contact, zero allocation. `worldWalk.perf.test.js` gains a `physics: 'mesh'` run.

**Steps (each <= 1 programmer-day, PC-B):**
- **ME-11a - colliders + World methods + grate refit + save round trip.** `colliders.js`, `World.load` option, `collideCircle`/`collideSphere`/`supportAt`, `stepSectorAnims`/`_restoreDynamics` hooks, `colliders.test.js` incl. the round trip.
- **ME-11b - roller route + `contacts.js`.** roller hooks + a boulder roll on the tower stair base giving the same trace (1 cm) in both modes; `contacts.js` + test (`rigid.js` does not exist yet; US-051 consumes `contacts()` only).
- **ME-11c - determinism + perf + flag.** 600-step scripted walk on world_m1 (the `worldWalk.perf` script) with `physics: 'mesh'`, twice, traces bit-equal; mesh vs grid traces within 1 cm inside the tower (report max); `worldWalk.perf` mesh p95 sim <= 1 ms (warn-only unless `PERF_STRICT=1`, print both modes); zero allocation over the walk; `?physics=mesh` in `main.js` (passes `{ physics }` to `World.load`, <= 5 lines). Done-when: run-tests + check-deps + typecheck green, numbers in the ME-11 row, -> `arch-review`; ME-12 (PC-A) does the browser pass.

Do not: serialise colliders or BVHs, rebuild a BVH per step, let `rigid.js`/player/quest code touch `bvh`/triangles (only `contacts()`, `collideCircle`, `collideSphere`, `supportAt`), add prop colliders (grid physics has none today; props/trees get colliders in ME-06c/ME-14), or change grid-mode behaviour (all existing suites bit-identical with `physics` omitted).

## 28. RTS engine capability, Epic RE (architect, 2026-09-30; D-032; normative for PC-B)

### 28.1 RE-01 + RE-02 pitched camera (`cam.projection: 'pitched'`)

Amends 27.1 item 2 / 27.5: a real rotated view matrix, mesh path only. `'shear'` stays bit-identical. **D-029 Amendment 2 (2026-09-30): pitched is the general camera and the default on `renderer:'mesh'`, first person included** (see "Amendment 2" at the end of 28.1); RE-02 is split into RE-02a/RE-02b. PC-B may do **RE-01** (pure math + tests, cross-track, ends in `arch-review`); **RE-02** (GPU pipeline, shaders) is PC-A.

**Camera fields.** `cam = {x, y, z, yawDeg, pitchDeg, projection?: 'shear'|'pitched', vfovDeg?}`. `pitchDeg` keeps the engine sign (**positive = up**, as `horizonRow` in `projTerms`); an RTS down-look is `pitchDeg = -58`. Backlog ACs saying "pitch 55/58/60" mean -55/-58/-60. Pitched range `-89 <= pitchDeg <= 89`, else throw. `vfovDeg` default `PROJ_PITCHED_VFOV_DEG = 36` (at -58 the top/bottom ground-scale ratio is ~1.51; at 40 deg it is 1.59, too close to the 1.6 AC).

**Basis** (x east, y south, z up, compass yaw; the frame is left-handed, so no cross products): `p = pitchDeg*DEG2RAD`, `fx = sin yaw`, `fy = -cos yaw`:
```
F = ( cos p*fx,  cos p*fy,  sin p)     forward (view-depth axis)
R = ( cos yaw,   sin yaw,   0    )     right
U = (-sin p*fx, -sin p*fy,  cos p)     up
aspect   = cols*pxCellW / (rows*pxCellH)          (grid spec as projTerms, px default 1)
tanHalfY = tan(vfovDeg/2),  tanHalfX = tanHalfY*aspect
```
View coords of P: `vx = dot(P-eye,R)`, `vy = dot(P-eye,U)`, `vd = dot(P-eye,F)` (view depth, > 0 in front).

**Cell convention** (same as shear, 27.15.0 item 1): cell `(col,row)` samples the ray at `a = (2(col+0.5)/cols - 1)*tanHalfX`, `b = (1 - 2*row/rows)*tanHalfY`; `dir = F + a*R + b*U`, **not normalised** (forward component 1, so the distance along `dir` is `vd`). Raster pixel centre `Y = n(row+0.5)` maps to that ray through the `+w/rows` term below; no viewport flip.

**Matrix** `M = P*V`, column-major `M[col*4+row]`, Float64Array(16); each row is `(a,b,c,d)` meaning `a*x+b*y+c*z+d`:
```
row_w = (F.x, F.y, F.z, -dot(F,eye))
row_x = (1/tanHalfX) * (R.x, R.y, 0, -dot(R,eye))
row_y = -(1/tanHalfY) * (U.x, U.y, U.z, -dot(U,eye)) + (1/rows)*row_w
row_z = A*row_w + (0,0,0,B)      A, B from PROJ_NEAR/PROJ_FAR exactly as shearProjection
```
Parity anchor: at `pitchDeg = 0` with `vfovDeg = 2*atan(tan(PROJ_HFOV_DEG/2)/aspect)` the matrix equals `shearProjection` element-wise within 1e-12.

**API added to `engine/render/projection.js`** (still imports nothing; zero allocation after create):
```js
/** @typedef {Object} PitchedTerms   filled by pitchedTerms; consumers read, never write
 * @property {'pitched'} projection
 * @property {number} cols @property {number} rows @property {number} aspect
 * @property {number} eyeX @property {number} eyeY @property {number} eyeZ
 * @property {number} fX @property {number} fY @property {number} fZ
 * @property {number} rX @property {number} rY             (rZ = 0)
 * @property {number} uX @property {number} uY @property {number} uZ
 * @property {number} tanHalfX @property {number} tanHalfY
 * @property {number} yawDeg @property {number} pitchDeg @property {number} vfovDeg
 * @property {Float64Array} M                                world -> clip, refreshed by pitchedTerms
 */
export const PROJ_PITCHED_VFOV_DEG = 36;
export function createPitchedTerms()                         // the only allocation (object + M)
export function pitchedTerms(cam, grid, out)                 // fills every field + out.M (via pitchedProjection); returns out
export function pitchedProjection(terms, out16)              // M as above
export function screenRay(terms, col, row, out)              // out {ox,oy,oz,dx,dy,dz}: origin = eye, dir per cell convention; col/row may be fractional
export function unprojectPitched(terms, col, row, vd, out3)  // eye + vd*dir; JS twin of GLSL cellRayPitched
export function worldToCell(terms, x, y, z, out3)            // [col, row, vd]: col = (vx/vd/tanHalfX + 1)*cols/2 - 0.5, row = (1 - vy/vd/tanHalfY)*rows/2; vd <= 0 -> only out3[2] valid
export function pitchedEyeFromFocus(fx, fy, fz, yawDeg, pitchDeg, dist, out3)  // eye = focus - dist*F
```
Integer cell of a projected point: `floor(col+0.5)`, `floor(row+0.5)`. Mouse -> cell: `windowToCell(1, mx/pxCellW, my/pxCellH, out2)`, then `screenRay`. `projectPoint(M, ...)` works unchanged on the pitched M. `culling.js frustumPlanes` is generic Gribb-Hartmann: no code change, test only.

**RE-01 tests** (`engine/render/projection.pitched.test.js` + a `culling.test.js` case): (1) `worldToCell(unprojectPitched(col,row,vd))` round trip, 1000 seeded random `(col,row,vd in [1,200])` at -55/-58/-60, error <= 1e-9 cells, and `projectPoint(M)` pixel = `n*(col+0.5), n*(row+0.5)` within 1e-9; (2) existing `projection.test.js` unchanged and passing; (3) pitch-0 parity against `shearProjection` (above); (4) at -58, default vfov, 400x150, `pxCellW:1, pxCellH:2`: `screenRay` hits on z = 0 at the centre column for row 0 and row `rows-1`; metres per column ratio top/bottom <= 1.6; (5) 64-box fixture: no box with a visible corner (`worldToCell` inside the grid, vd > PROJ_NEAR) is `CULL_OUT`; (6) basis orthonormal within 1e-12; (7) zero alloc: 10k `screenRay` + `worldToCell` calls with reused outs, `--expose-gc` heap delta < 64 KB (skip when gc is not exposed). Test RNG: a local seeded LCG, never `Math.random`.

**RE-02 (PC-A) rules.** `cam.projection === 'pitched'` with `renderer !== 'mesh'` throws `Error("cam.projection 'pitched' requires renderer 'mesh'")` at the render entry (DDA, voxel march and the CPU caster only know shear). Raster: uniform `M` only. SDEPTH stores `vd`. Light, shade, fog and sky rebuild P with GLSL `cellRayPitched(cell, grid, eye, F, R, U, tanHalf, vd)` in `glsl/common.js`, the literal twin of `unprojectPitched` (same expression order; parity through `rasterJS` + the JS shade twin); an int uniform `uProjMode` selects shear/pitched (no shader permutation). Sky per cell uses the `screenRay` direction. `projectSprite` uses `worldToCell`. Sun shadow box centred on the focus point. Edge, deriv and resolve compare depths only: unchanged.

**Amendment 2 (D-029 A2, 2026-09-30): one camera model on mesh.** Split: **RE-02a** = the pipeline renders a pitched `cam` correctly (explicit `projection:'pitched'`, RTS poses); **RE-02b** = first person on pitched + pitched becomes the mesh default. Rules:
1. **Default resolution, one place.** `projection.js` adds `resolveProjection(cam, renderer)` -> `cam.projection ?? (renderer === 'mesh' ? 'pitched' : 'shear')` (02b; until 02b it returns `cam.projection ?? 'shear'`). Every consumer (pipeline entry, `compositor.js` mesh twin, `sprites.js`, `pick.js` callers, `instanceRect`/`VoxelPool.project`) calls it; nobody tests `cam.projection` directly. `'pitched'` + `'dda'` still throws.
2. **Every shear-term reader on the mesh path gets a pitched branch (02a).** Known readers: `GpuCellPipeline` uniforms `uHorizonRow/uPlaneDistY` (light/shade/fog/sky, via `uProjMode` + `cellRayPitched`), `compositor.js` (`projTerms` for the JS twin), `sprites.js` (`projectSprite`, `feetRow`), `engine/voxel/instanceRect.js` + `VoxelPool.project` (screen rect cull: on pitched, project the 8 AABB corners with `worldToCell`; any corner with `vd <= PROJ_NEAR` -> full-screen rect, the frustum cull decides), `lighting.js` CPU sky rows (twin only). `stable.js` is not wired: it throws on pitched until its GPU pass lands. `culling.js`, `rasterJS` (M only), edge/deriv/resolve: no change.
3. **Fog distance** in both modes = horizontal forward distance `max(0, dot(P - eye, (fx, fy, 0)))` = the shear `d`. Fog therefore does not swim when the player looks up/down, and pitch-0 pitched == shear. Sky per cell = `screenRay` direction (02a).
4. **Sun shadow box:** centred on `cam.focusX/Y/Z` when set (02a adds the three fields to what `rtsCamera.update` writes), else today's first-person rule unchanged.
5. **First-person vfov (02b):** when `cam.vfovDeg` is unset and the camera is first person, `vfovDeg = 2*atan(tan(PROJ_HFOV_DEG/2)/aspect)` (the pitch-0 parity anchor above), so the mesh first-person view at pitch 0 equals today's shear view and the hfov stays 75 deg on every aspect. `PROJ_PITCHED_VFOV_DEG = 36` stays the RTS default (rtsCamera sets it explicitly). Helper `fpVfovDeg(grid)` in `projection.js`. Near plane `PROJ_NEAR = 0.05` for both (perpendicular to `F`; the capsule radius keeps walls > 5 cm at any pitch).
6. **Pitch clamp (02b):** `Camera.clampPitch` / `PlayerLook` take an option `pitchClampDeg` (default 35 = shear); main.js passes `PITCH_CLAMP_PITCHED_DEG = 70` (exported from `projection.js`) when the resolved projection is pitched. The shear clamp stays 35 (the shear image degrades beyond it). Clamp is presentation/look input; the sim transform just stores the clamped value (saves unchanged).
7. **Rays from the look direction (02b):** any game/engine code that turns yaw+pitch into a 3D ray (aim, look-at interaction, debug pick) uses `screenRay(terms, cols/2 - 0.5, rows/2, out)` on the resolved projection; interaction **cells** stay yaw-only content lookups (27.1 item 7). Programmer greps `pitchDeg` under `game/js` and `engine/entities|physics` and lists each site in the review note.
8. **gpucompare.** Existing poses (dda-vs-mesh parity and existing mesh poses) set `projection:'shear'` explicitly in 02b, so their results are unchanged until ME-19. New mesh-only pitched poses compare GPU vs the `rasterJS` + JS shade twin (same projection) at the 27.7 item 2 bars (kind >= 99.5 % excl. 4-neighbour edges, glyph >= 99 %, fg/bg +-4, depth 1 %): 02a `rtsHill55/58/60` (hillside, focus-driven eye); 02b `fpLevel0` (pitch 0; additionally vs the same pose in shear at the same bars - the anchor), `fpUp30`, `fpDown60` (beyond the shear clamp), `fpTowerDown45` (interior, walls lean).
9. **ME-19 deletes the shear camera:** `shearProjection`, `projTerms` shear fields, `unprojectCell`, GLSL `cellRayP` + `uHorizonRow/uPlaneDistY/uProjMode`, the shear branches of `sprites.js`/`instanceRect.js`/`VoxelPool`/`compositor.js`/`lighting.js` sky/`stable.js`, the `'shear'` value and `resolveProjection`'s fallback, the 35-deg clamp; parity poses switch to pitched; 27.5 marked historical.
10. **Do not:** add a shader permutation per mode; normalise `dir` (the forward component must stay 1 so `vd` is the ray distance); read `cam.pitchDeg` for projection anywhere outside `projection.js` on the mesh path.

**RE-03 `engine/core/rtsCamera.js`** (presentation, not sim: may use `Math.exp` and frame `dt`; may import `engine/render/projection.js`, a leaf with no imports, and `engine/core/transform.js`). State `{focusX, focusY, zoom}`; options `{yawDeg=0, pitchDeg=-58, vfovDeg, widthM=30, zoomMin=25/30, zoomMax=35/30, bounds:{x0,y0,x1,y1}, panSpeed (m/s at zoom 1), edgePx, heightFn}`. `update(dt, input, grid, cam)`: pan by `panSpeed*zoom*dt` (keys, edge) or drag (exact ground delta of two `screenRay` hits on the plane z = focus z); clamp focus to `bounds`; `dist = widthM*zoom/(2*tanHalfX)` (tanHalfX from the current grid, so the ground width at the centre row is `widthM*zoom` by construction); focus z = `heightFn(focusX, focusY)` smoothed by `1-exp(-k*dt)`; `pitchedEyeFromFocus` writes the eye into `cam` in place and sets `projection`, `yawDeg`, `pitchDeg`, `vfovDeg`. Zero alloc per update.

**RE-04 `engine/render/pick.js`.** `rayTerrain(terrain, ray, out, opts)`: march `t` in `opts.step` (default 0.5 m) from 0 to `opts.maxT` (default `4*eyeZ/-dz`); first sample with `oz+t*dz < terrain.groundAt(x,y)` (what is rendered), then 24 bisections -> `out {x,y,z,t,hit}`. `pickNearest(ray, positions, radii, heights, count)`: ray vs vertical cylinder per unit (`positions` Float64Array stride 3 = base point), smallest `t`, ties to the lower index, -1 if none. `selectInRect(terms, c0, r0, c1, r1, positions, count, outIds)` -> count; iterate ascending, `worldToCell`, inclusive rect, `vd > 0`; ids come out ascending. Zero alloc.

- **RE-02b review note (2026-09-30):** SpritePool, VoxelPool, the overlay and `stabilizeCells` default to renderer 'dda'; the host sets 'mesh' - and only when the mesh GpuCellPipeline is actually active (main.js `effRenderer`), so the look clamp and every projection follow the effective renderer, not the URL.

### 28.2 `engine/nav/` (RE-05, RE-08, RE-09, RE-10)

Amends D-032's "grid/A* in `engine/world/`": nav is a separate **leaf** module, so it never depends on World internals and tests run with a fake world. Unit and command logic stays in `game/js/rts/`.

**Layout.** `engine/nav/heap.js` (`IndexHeap`, shared), `NavGrid.js` (RE-05, RE-10), `astar.js` (RE-05), `flowField.js` (RE-08), `steer.js` (RE-09), each with its `*.test.js`; all `// @ts-check`. Exported through `engine/index.js`: `NavGrid`, `createAStar`, `findPath`, `smoothPath`, `pathCrossesRect`, `createFlowField`, `FlowCache`, `createSteer`.

**check-deps rule 14 (added in RE-05):** non-test `engine/nav/**/*.js` may import only `engine/nav/**` and `engine/core/**`; files under `engine/render/**`, `engine/mesh/**`, `engine/ui/**` and `engine/world/**` may not import `engine/nav/**`. Tests may also import `engine/world/**` for real terrain fixtures. World is passed in as a duck-typed parameter. Add pass/fail fixtures to `tools/check-deps.test.mjs`.

**NavGrid data** (cell index `i = cy*w + cx`; world metres via the origin):
```
new NavGrid({x0, y0, w, h, cell = 1})   allocates everything; later calls allocate nothing
grid.cellX(x) = Math.floor((x - x0)/cell)    (cellY likewise); centre = x0 + (cx + 0.5)*cell
terrainCost  Uint8Array(N)   0 = unwalkable (slope/type/structure/mask); 1..254 = entry-cost multiplier; derived, never saved
blockCount   Uint16Array(N)  number of footprints covering the cell (RE-10)
cost         Uint8Array(N)   blockCount > 0 ? 0 : terrainCost  (the ONLY array A* and flow read)
height       Float32Array(N) analytic ground z at the centre (info only; units get z from world.supportAt)
version      int, +1 per change; dirty = ring of 8 {version, cx0, cy0, cx1, cy1} (half-open)
minCost      smallest non-zero cost (heuristic scale)
```
**Walkability build** `grid.buildFromWorld(world, opts)` (load time; <= 50 ms at 256x256). Per cell centre it uses the **analytic** `terrain.heightAt/normalAt/typeAt`. These do not depend on the camera; `groundAt` depends on where the near band was baked and would make nav differ between sessions. A cell is unwalkable if `normal.z < cos(opts.maxSlopeDeg)` (default 30), if `terrain.typeName(typeAt)` is in `opts.blockedTypes` (default `['water']`), if `world.structureAt(x,y)` (structures block in v1; walking inside multi-floor structures is out of scope for a 2.5D grid), or if `opts.mask[i]`. Otherwise `terrainCost = opts.typeCost[typeName] ?? 1` (e.g. `{path:1, grass:1, forest:3}`). Thresholds come from options, never literals. For tests without a world: `grid.buildFromArrays(heightF32, slopeOkU8, typeU8, opts)`.

**Footprints (RE-10).** `grid.block(ownerId, cx0, cy0, cx1, cy1, maskU8?)` and `grid.unblock(ownerId)`; `grid.blockWorldRect(ownerId, x0, y0, x1, y1)` covers every cell the rect overlaps by > 1e-6 m. The owner table is preallocated (`maxBlockers`, default 1024; overflow throws): ownerId Int32, rect Int16 x4, mask offset into a preallocated pool. `block` increments `blockCount` and `unblock` decrements it; both recompute `cost` in the rect, bump `version` and push the dirty rect. Re-blocking an owner that is already blocked throws. The footprint comes from the caller (content `footprint` or mesh bbox); nav does not read meshes. Save: `grid.saveBlockers()` -> `[{owner, rect:[cx0,cy0,cx1,cy1], mask?:number[]}]` sorted by owner; `grid.loadBlockers(arr)` clears, then re-applies in that order. Consumers poll `grid.version` each tick (no callbacks in sim). `pathCrossesRect(path, len, grid, rect)` decides re-plans, so only paths through the rect re-plan. Flow fields rebuild on any version change.

**A\*.** `createAStar(grid)` preallocates `g` Int32Array(N), `parent` Int32Array(N), `open`/`closed` stamps Uint32Array(N) (search generation, so nothing is cleared per query) and an `IndexHeap` (Int32 heap + Int32 heapPos, decrease-key). `findPath(astar, sx, sy, gx, gy, outPath, opts)` works in cell coordinates and returns the path length (cell indices start..goal in `outPath` Int32Array); 0 if the start is unwalkable. Integer costs only: straight `10*cost[j]`, diagonal `14*cost[j]` (cost of the entered cell). Heuristic: octile `minCost*(10*max(dx,dy) + 4*min(dx,dy))`. Fixed neighbour order `(0,-1),(1,0),(0,1),(-1,0),(1,-1),(1,1),(-1,1),(-1,-1)`. A diagonal is allowed only if both orthogonal neighbours are walkable (no corner cutting). Heap order: `f` asc, then `h` asc, then cell index asc. If the goal is unreachable or blocked, or `opts.maxNodes` is hit: return the path to the closed cell with the smallest `h` (then `g`, then index) and set `astar.partial = true`. `smoothPath(grid, path, len, outXY)` string-pulls with a supercover line of sight on `cost > 0` (same corner rule) -> world waypoints at cell centres; returns the count.

**Flow field (RE-08).** `createFlowField(grid)`: `integ` Uint32Array(N) (0xFFFFFFFF = unreached), `dir` Uint8Array(N) (0..7 = neighbour index in the A* order, 254 = goal, 255 = none) and its own `IndexHeap`. `ff.begin(goalCells Int32Array, count)`, then `ff.step(cellBudget)` returns true when done. It runs Dijkstra with the A* integer costs, heap order `integ` asc then index asc. A settled cell's direction points to the neighbour with the lowest `integ`; ties go by neighbour order, and there is no corner cutting. `ff.dirAt(x, y, out2)` returns the cell direction as a unit vector (8-entry table; the diagonal uses the literal 1/sqrt(2)). `ff.cellsDone` is state: a save stores `{goals, cellsDone}` and load does `begin` + `step(cellsDone)` (deterministic). `FlowCache(grid, slots = 8)`: key = sorted goal cells + `grid.version`; LRU by the sim tick passed in, never wall time.

**Steering (RE-09).** `createSteer({maxAgents, hashCell = 2, maxNeighbours = 8, bounds})` keeps one Float64Array per field (SoA): `x, y, vx, vy, radius, maxSpeed, accel`, plus `mode` Uint8 (0 idle, 1 waypoint, 2 flow), target fields and `active` Uint8. Agent id = slot; the game allocates slots lowest-free-first. `steer.step(dt, grid)` does three things:
1. It rebuilds the spatial hash: head Int32Array per hash cell, next Int32Array per agent, inserted in ascending slot order.
2. For each active slot in ascending order, it gathers neighbours from the 3x3 hash cells in fixed order and keeps the K nearest by `(dist2, slot)` in a fixed-size, insertion-sorted scratch. Desired velocity = seek (waypoint or `ff.dirAt`), slowed down inside `arriveR`, plus separation `sum (ri+rj-dist)/dist * (pi-pj)` weighted by `sepW`. Arrived or idle agents push moving ones only with `idleSepW = 0.25`, which prevents gap deadlock. The new velocity goes to a scratch array (Jacobi: every agent reads the old state).
3. It applies the result in slot order: clamp speed, `x += vx*dt`; if the new cell has `cost == 0`, try x-only, then y-only, else stay. No tunnelling: `maxSpeed*dt < cell/2` is asserted at create.

Z and facing belong to the caller (`world.supportAt`; yaw is computed on the render side). `steer.hash()` is FNV-1a over the u32 view of the SoA buffers (zero alloc).

**Determinism (review rule, D-032 item 5).** Sim advances in fixed steps only (`dt` = the loop's fixed step, never frame time). Iterate by slot or cell index, never over `Map`/`Set`/object keys. No `Math.random`, `Date.now` or `performance.now` in `engine/nav` (use RE-14's seeded RNG if ever needed). Float math is limited to `+ - * /`, `Math.sqrt`, `floor`, `abs`, `min` and `max` (exact or correctly rounded). **No** `Math.sin/cos/atan2/exp/pow/hypot` in sim steps: their results can differ between JS engines and would break lockstep. Costs and heuristics are integers. Caches (paths, fields, hash) are derived and not saved; their outputs must be reproducible from saved state.

**Zero allocation** per query, step or block: no arrays, closures, destructuring or returned objects; outs are owned by the caller. Only constructors, `create*`, `buildFromWorld` and `saveBlockers` allocate.

**Budgets** (Node, sim thread; D-032 sim <= 2 ms at 200 units):
- A*: open 256x256 corner-to-corner <= 1 ms (this is RE-05 AC 1); maze fixture <= 5 ms (recorded only). The game caps A* at 20k node expansions per tick using a queue.
- Flow field: full 256x256 <= 3 ms; `step(16384)` <= 0.8 ms.
- Steering: 200 agents <= 0.4 ms, 500 <= 1 ms.
- `block`/`unblock` 16x16: <= 0.05 ms.

Perf asserts are warn-only unless `PERF_STRICT=1`.

**Test matrix.**
- **RE-05** (`NavGrid.test.js`, `astar.test.js`): slope/type/mask/structure driven by options (fake world); cell <-> world round trip, incl. a negative origin; open-field path cost = octile optimum; corner rule (no diagonal past a blocked orthogonal cell); blocked goal -> partial path; 1000 seeded random queries run twice -> identical paths; `smoothPath` never crosses `cost 0`; perf; zero alloc; check-deps rule 14 fixtures.
- **RE-08** (`flowField.test.js`): following `dir` from every reached cell descends strictly to a goal; `step` in chunks of 1000 == one shot (bit-equal `integ`/`dir`); save/load mid-build gives the same result; multi-goal; perf.
- **RE-09** (`steer.test.js`): 600-step scripted run twice -> same `hash()`; 50 agents through a 3 m gap reach the goal area, max overlap <= 20 % of radius, no agent stays still for > 120 steps before arriving; no agent ever in a `cost 0` cell; same result when agents are activated in a different order but get the same slots; perf at 500.
- **RE-10** (in `NavGrid.test.js`): block + unblock restores `cost`/`blockCount` byte-equal; overlapping footprints; `saveBlockers`/`loadBlockers` round trip; `version` and dirty ring; `pathCrossesRect` true/false fixtures.

**Do not:** import render, mesh or World into nav; store world objects or closures in NavGrid; run per-unit A* for large group moves (use the flow field); emit callback events from nav; sample `groundAt` for walkability.

**Amendments (architect review, 2026-09-30, RE-09/RE-10 batch):**
- RE-09 deviations accepted as the spec: (1) flow-follow slows on arrival through `ff.integ`; (2) `idleSepW` applies only when a stopped agent pushes a moving one; two stopped agents use full `sepW`. The no-tunnelling check runs once per `step()`.
- RE-10: the owner-slot `Map` is fine (placement-time only, never iterated in the sim). Slot numbers depend on history, so any `NavGrid.hashInto` hashes `blockCount`/`cost`, never slots (RE-14b).
- **Known limit (lockstep):** `NavGrid.buildFromWorld` samples analytic terrain (`Math.exp/pow/hypot`, a `Math.cos` slope threshold), so the grid can differ between JS engines. Single-machine replay is unaffected. Before networked lockstep, walkability comes from content-baked/saved arrays, or peers exchange a grid hash at start.

- **RE-08p re-baseline (architect, 2026-09-30):** flow-field budgets stay warn-only; callers run `step(3072)` per tick (~0.6-0.8 ms on the Intel iGPU laptop, a full 256x256 field in ~22 ticks); AC = per-tick step <= 0.8 ms, the full build time is recorded, not gated. Dial bucket queue = RE-08q (parked).

### 28.3 Fog of war: RE-11 visibility grid (PC-B, pure JS) + RE-12 shading (PC-A, GLSL)

**RE-11 `engine/world/Visibility.js`** (leaf: imports nothing; `// @ts-check`; exported via `engine/index.js`). This is sim state: it advances only inside the fixed step, and 28.2's determinism and zero-alloc rules apply.
```
new Visibility({x0, y0, w, h, cell = 1, teams = 2, maxSources = 1024, maxRadiusCells = 16})   // teams <= 8; allocates everything
state[t]   Uint8Array(w*h)  0 = unseen, 128 = explored (not visible now), 255 = visible  (the byte IS the R8 texel; no conversion pass)
count[t]   Uint16Array(w*h) sources of team t covering the cell (derived, never saved)
version    Uint32Array(teams), +1 whenever state[t] changes
sources    SoA by id: cx, cy, rc Int32Array; mask, active Uint8Array
setSource(id, teamMask, x, y, radiusM)  // cx = floor((x-x0)/cell), rc = floor(radiusM/cell + 0.5) (> maxRadiusCells throws); no-op if (cx,cy,rc,mask) unchanged, else unstamp old + stamp new
removeSource(id);  clearSources()       // clearSources: counts = 0, every 255 -> 128 (used after load)
stateAt(t, x, y) -> 0|128|255 (outside -> 0);  isVisible(t,x,y);  isExplored(t,x,y)
takeDirty(t, out4) -> bool              // out4 Int32Array [cx0, cy0, cx1, cy1) = union of changed cells since the last call; resets
revealAll(t)                            // explored = everywhere (scenario/debug)
saveExplored() -> {x0,y0,w,h,cell,teams,maxSources,maxRadiusCells, explored: number[][]}   // per team: row-major RLE of the explored bit; runs alternate, starting with "unexplored"
static fromSave(obj) -> Visibility      // explored restored (state 128), no sources
hashInto(h)                             // RE-14 hasher: state bytes of every team (counts follow from the sources)
```
**Update rule (v1: sight circles, no occlusion).** The circle table is built at construction: `span[r][dy] = floor(sqrt(r*r + r - dy*dy))` for `0 <= dy <= r <= maxRadiusCells`. A stamp loops over rows `cy-rc..cy+rc` and columns `cx-span..cx+span`, clipped to the grid. For each team bit in `mask` it does `++count`; on 0 -> 1 it sets `state = 255` and marks the cell dirty. An unstamp does `--count`; on 1 -> 0 it sets `state = 128`. Stamps commute, so the result does not depend on call order (the game still calls in slot order). A source that stays in its cell costs nothing: that is the incremental update. Shared vision = a mask with several bits.

**Occlusion is out of scope:** no LOS against the heightfield or structures. A later story adds `opts.occluder` behind the same API (a per-cell height Uint8 + the source's eye height, recursive shadowcasting per source).

Game tick order: commands -> orders/AI -> nav/steer -> `supportAt` z -> `setSource` for every unit in slot order -> combat -> hash checkpoint -> `tick++`.

**Save (the AC's "CO-5 extension").** `WorldState` gets an optional top-level key `visibility`; nothing else changes. `World` gets a `visibility` field (default null). `serialize` writes `world.visibility.saveExplored()` when that field is non-null and omits the key otherwise. `deserialize` sets `world.visibility = Visibility.fromSave(state.visibility)` when the key is present. No `VERSION` bump (same pattern as US-027a). `stringifySave(serialize(deserialize(s))) === stringifySave(s)` must still hold. After a load, the game re-adds its sources on the first tick.

**Budgets / tests** (`Visibility.test.js`):
- Perf (AC 1): 200 sources with rc = 8, all moving one cell per tick: <= 0.5 ms per tick. Warn-only unless `PERF_STRICT=1`.
- Stamp + unstamp restores `count` byte-equal.
- The same sources applied in shuffled order give byte-equal `state`.
- The explored bit survives a remove.
- Clipping at all 4 edges, and a negative origin.
- The dirty rect is exact.
- `saveExplored`/`fromSave` round trip, and the `serialize` round trip.
- Zero alloc over 10k `setSource` calls.
- `hashInto` gives the same value in two runs.

**RE-12 shading (PC-A).** The renderer gets a duck-typed `FogView = {state: Uint8Array, version: Uint32Array, x0, y0, cell, w, h}` and never imports `engine/world`.
- API: `engine.setFog(view | null)` does a full upload; the texture is reallocated only when the size changes. `engine.updateFog(cx0, cy0, cx1, cy1)` does a sub-upload; the game calls it when `vis.takeDirty(viewTeam, d)` returns true.
- Texture: `R8`/`RED`/`UNSIGNED_BYTE`, NEAREST, CLAMP.
- Sub-upload, zero alloc: set `UNPACK_ROW_LENGTH = w`, call the `texSubImage2D` overload with `srcOffset = cy0*w + cx0`, then reset ROW_LENGTH to 0. No `subarray`.
- Uniforms: `uFowOn`, `uFowMap = vec4(x0, y0, 1/cell, 0)`, `uFowSize ivec2`, `uFowDimL`, `uFowSat`, `uFowBgDim`. Values come from `createEngine({ fow: {dimL: 0.45, sat: 0.25, bgDim: 0.5} })`; no literals in GLSL.
- `fowAt(P)` lives in `glsl/common.js` with a literal JS twin. It does a **manual 4-tap bilinear via texelFetch**: no hardware filtering, same rule as 27.9.
  - `gx = (P.x-x0)*invCell - 0.5`, `ix = floor(gx)`, `fx = gx-ix`; y likewise.
  - A tap outside the grid counts as 0, so the map edge is unseen.
  - `v = mix(mix(t00,t10,fx), mix(t01,t11,fx), fy)` with `t = byte/255`.
  - Cells with infinite depth (sky) get `v = 1`.
  - P is rebuilt from the depth with the 28.1 / 27.5 cell ray. P is a world point, so the fog is world-anchored and cannot swim when panning (AC 2).
- `e = clamp(2v, 0, 1)` (explored-ness), `s = clamp(2v-1, 0, 1)` (visible-ness).
- **Light pass:** `L *= uFowDimL + (1-uFowDimL)*s`. Explored ground then picks darker glyphs from its own ramp. That is the "dim ramp"; no new glyph tables.
- **Edge pass tail.** Edge is the last pass before sprites, so outlines cannot leak through the fog.
  - If `e < 0.5`: glyph = space, fg = bg = 0.
  - Else, with luma weights `(0.299, 0.587, 0.114)`: `sat = mix(uFowSat, 1, s)`; `fg = mix(luma(fg), fg, sat)`; `bg = mix(luma(bg), bg, sat) * mix(uFowBgDim, 1, s)`.
  - Then `fg *= (2e - 1)` and `bg *= (2e - 1)`: colours fade to black over the last half metre before the unseen line.
  - Rounding: the pass's existing rounding.
- Sprites and RE-07 overlay ops are not fogged. The game submits enemy units (instances, rings, bars) only where `vis.isVisible(viewTeam, ...)`. The DDA and CPU-caster paths ignore fog and `console.warn` once.
- **Tests:**
  - The JS twins (rasterJS light twin + edge twin) read `view.state` directly.
  - New gpucompare pose: hillside, pitch -58, a fixture Visibility with 3 sources plus one source that moved away (leaves an explored strip). Glyphs equal except in the boundary set `|e-0.5| < 1/64`; fg/bg within +-4 (AC 1).
  - `fowAt` unit test: exact at texel centres, 0 outside the grid, identical for a fixed world point under 5 camera pans.
  - GPU cost: +<= 0.1 ms (8 texelFetch per cell) (AC 3).

### 28.4 RE-13 minimap `engine/render/minimap.js` (PC-B, pure JS; deps RE-01, RE-04, RE-11)

Imports only `engine/render/projection.js` (`screenRay`) and `engine/render/pick.js` (`rayTerrain`). Terrain, fog and units are duck-typed parameters. The image is `rgba` Uint8ClampedArray(W*H*4), north up: image u = +x (east), v = +y (south). `sx = (x1-x0)/W`, `sy = (y1-y0)/H`.
```
createMinimap({width = 256, height = 256, x0, y0, x1, y1, teamRgb: Uint8Array(3*8), unseenRgb = [0,0,0], exploredQ8 = 110, footprintRgb = [255,255,255], hideUnseen = true})  // allocates base, fogged, rgba, visIdx
mm.bakeTerrain(terrain, typeRgb: Uint8Array(3*nTypes), opts)   // load time, <= 30 ms at 256^2, no alloc
mm.bindFog(view)                                              // fills visIdx Int32Array(W*H): vis cell of each pixel centre (-1 outside)
mm.update(units, view, viewTeam, terms, terrain)             // per UI refresh; writes rgba
minimapToWorld(mm, u, v, out2)   // x = x0 + u*sx; u, v in pixels (pixel centre = i + 0.5)
worldToMinimap(mm, x, y, out2)   // exact inverse
```
`units` is a game-owned, reused `MinimapUnits {count, x: Float64Array, y: Float64Array, team: Uint8Array, half: Uint8Array}`. `half` = half-size of the drawn square in px: 0 = 1 px (unit), 2-4 = building.

**Bake**, per pixel centre:
- Use the **analytic** `heightAt/normalAt/typeAt` (camera-independent, as nav does).
- `shade = (0.35 + 0.65*max(0, N.Ls)) * (0.8 + 0.2*hn)`, with `Ls = normalize(-1, -1, 2)` (light from the north-west) and `hn` = height normalised to `opts.hMin..hMax`.
- `base = round(typeRgb * shade)`.
- Pixels where `opts.structureAt?.(x,y)` is true get `opts.structureRgb`.

**Update:**
1. If `view.version[viewTeam]` changed since the last update, rebuild `fogged` from `base`: state 0 -> `unseenRgb`, 128 -> `(c*exploredQ8)>>8`, 255 -> c.
2. `rgba.set(fogged)`.
3. Units in index order, drawn as clipped filled squares in `teamRgb[team]`. With `hideUnseen`, a unit of another team is skipped unless its cell has `state == 255`.
4. Camera footprint: `screenRay` at the 4 screen corners `(-0.5, 0)`, `(cols-0.5, 0)`, `(cols-0.5, rows)`, `(-0.5, rows)` (28.1 cell convention), then `rayTerrain`. On a miss, fall back to the plane `z = terrain min`: `t = (zMin-oz)/dz` when `dz < 0`, else `maxT`. Draw the 4 edges as integer Bresenham lines, clipped.

**Budgets / tests** (`minimap.test.js`):
- AC 1: `update` <= 0.5 ms at 256^2 with 200 units and the fog rebuilt.
- AC 2: the footprint corners equal `worldToMinimap(rayTerrain hit)` within 1 px, on a slope fixture.
- AC 3: `worldToMinimap(minimapToWorld(u,v))` within 1e-9, and a click maps to the right world cell.
- Also: `hideUnseen`, clipping, zero alloc per `update`.

**Display: Canvas2D overlay (picked as the simplest).** `game/js/rts/ui/minimapView.js` (game code, presentation):
- At setup, create one `<canvas width=W height=H>`, absolutely positioned over the RenderTarget and CSS-scaled with `image-rendering: pixelated`, and one `new ImageData(mm.rgba, W, H)`.
- Refresh at 20 Hz (every 3rd frame): `mm.update`, then `ctx.putImageData`.
- Pointer: `u = offsetX*W/clientWidth`, then `minimapToWorld`. Left drag sets the `rtsCamera` focus; right click issues a move command through RE-14.
- No GPU texture, no engine UI code.

Open question for PO/owner (not part of RE-13): a pixel minimap next to an ASCII view. A later ASCII variant could downsample `rgba` into half-block cells through the RE-07 overlay.

### 28.5 RE-14 deterministic commands, RNG, state hash, replay (PC-B, pure JS; `engine/core/`)

**Files:** `engine/core/commands.js`, `rng.js`, `hash.js`, `replay.js`, each with a `*.test.js`, all leaves inside core. `loop.js` gains `export const STEP` (no behaviour change); the sim uses `STEP`, never the frame dt.

**Amends the RE-14 row: no `world.hashState()`.** RTS sim state lives in game SoA and `engine/nav`, not in World. Instead, each sim module exposes `hashInto(h)` (`steer`, `NavGrid` blockers, `Visibility`, `rng`, game units), and the game registers them in a fixed order.

**Commands.** `createCommandQueue({maxRecords = 4096, maxIds = 65536, inputDelay = 1})` allocates two rings:
- Records: Int32Array, stride 8, `[tick, player, seq, type, nIds, idOff, a0, a1]`, plus a parallel Int32 array for `a2`.
- Ids: an Int32Array ring.

Payloads are integers only: world x/y as millimetres `Math.round(x*1000)`, a target unit id or -1. With no floats in commands, replays and network traffic are bit-exact.

API:
- `q.issue(player, type, ids: Int32Array, n, a0, a1, a2)` copies the ids and stamps `tick = q.tick + inputDelay` and `seq = per-player counter++`. Called from input/UI or AI, never by the sim mid-step. Overflow throws.
- `q.insert(tick, player, seq, type, ids, n, a0, a1, a2)`: replay/network injection. A tick < `q.tick` throws (that tick has already run).
- `q.execute(handler)` runs the records whose tick is `q.tick`, ordered by `(player, seq)` (insertion sort into a scratch index array). It calls `handler(q, rec)`, which reads the record with `q.type(rec)`, `q.player(rec)`, `q.ids` + `q.idOff(rec)`, `q.nIds(rec)`, `q.a0/a1/a2(rec)`. Then it frees the records and does `q.tick++`.
- Types 0-15 are engine-reserved (0 = NOP); game types start at 16. The engine never interprets game types.
- Save: `q.save()` returns the pending records in execute order as `[[tick, player, seq, type, a0, a1, a2, [ids...]], ...]`, plus `tick` and the seq counters. Load with `q.load(obj)`.

**Loop integration** (in the game's `update(dt)`; `Loop` itself unchanged):
1. `q.execute(applyCommand)`.
2. The systems, in the 28.3 tick order.
3. `recorder?.afterTick(q.tick - 1)`.

`q.tick` is the sim tick. Commands carry ticks, not wall time, so the loop dropping catch-up steps (`MAX_STEPS_PER_FRAME`) cannot desync anything. Input picking and `rtsCamera` run on the frame side and only call `issue`.

**RNG (`rng.js`).** xoshiro128** on a Uint32Array(4) state, seeded by splitmix32 from a u32. Integer ops only (`Math.imul`, `>>>`, `|`, `^`).
- API: `createRng(seed)`, `nextU32()`, `nextFloat() = (nextU32() >>> 8) / 16777216` (exact, in [0,1)), `int(n) = Math.floor(nextFloat()*n)` (n <= 2^24, else throw), `save() -> [s0, s1, s2, s3]`, `load(a)`, `hashInto(h)`.
- One sim stream, owned by the game sim. It is drawn only inside fixed steps, in slot/cell order. Presentation (particles, idle anims) uses its own stream, never the sim stream.

**Hash (`hash.js`).** 32-bit FNV-1a over little-endian bytes; stateful, zero alloc.
- API: `createHasher()` -> `h.reset()`, `h.u32(x)`, `h.i32(x)`, `h.f64(x)`, `h.u8Array(a, start, end)`, `h.u32Array(a, start, end)`, `h.value()` (returns a u32).
- `h.f64` hashes the bit pattern through a module-level Float64Array(1)/Uint32Array(2) scratch: lo word, then hi.
- Owners of Float64/Float32 SoA create a Uint32Array view once, at allocation, and hash that.
- **Sim state hash** after tick T: `reset`, `u32(T)`, `rng.hashInto`, then each registered part's `hashInto` in registration order.
- Hash every 60 ticks (budget <= 0.1 ms for 500 agents), or every tick with `?hashEveryTick=1`.

**Replay (`replay.js`).** JSON Lines, UTF-8, extension `.kreplay.jsonl`:
```
{"kind":"kestrel-replay","v":1,"content":<contentVersion>,"world":"<name>","seed":<u32>,"step":60,"inputDelay":1,"players":[0,1],"start":<WorldState|null>}
{"t":120,"p":0,"s":3,"c":16,"u":[4,5,9],"a":[12500,-3000,-1]}     one line per executed command, in execute order
{"t":120,"h":"9f3a0c1d"}                                          checkpoint every 60 ticks (hash after tick t ran)
{"end":600,"h":"..."}
```
- `createRecorder(q, hashFn)`: `afterTick(tick)` appends lines. It allocates only on ticks with commands or a checkpoint; empty ticks allocate nothing. `text()` joins the lines.
- `createPlayer(text)` parses once at load (allocation allowed there). `beforeTick(q)` `insert`s the next tick's commands; recorded ticks are execution ticks, so it inserts at exactly `q.tick`. `check(tick, hash)` compares against the checkpoint; on a mismatch it sets `divergedAt = tick` and stops.

**Lockstep-ready constraints** (review rules):
- Commands are the only sim input.
- Every player's commands for tick T are known before T runs (`inputDelay`; lockstep will use ~6).
- Command payloads are integers.
- 28.2's float rules apply to all sim code: no `Math.sin/cos/atan2/exp/pow/hypot/random`. If the sim ever needs trig, it gets a lookup table in `engine/core`.
- No `Map`/`Set`/object-key iteration in the sim.
- Render reads sim state and never writes it.

**check-deps rule 15 (WARN, added in RE-14; the number is reserved even if RE-05's rule 14 lands later).**
- Scope: non-test files under `engine/nav/**`, `engine/core/{commands,rng,hash,replay}.js`, `engine/world/Visibility.js` and `game/js/rts/sim/**` (convention: RTS sim code goes in `sim/`, UI in `ui/`).
- With comments stripped, WARN on `Math.random`, `Date.now`, `performance.now`, `Math.sin|cos|tan|atan2|exp|pow|hypot`.
- Pass/fail fixtures go in `tools/check-deps.test.mjs`.

**Tests:**
- `rng`: golden first 8 outputs for seeds 1 and 0xDEADBEEF (recorded once, then frozen); save/load mid-stream continues identically; `int` bounds.
- `commands`: two players issuing in reversed arrival order still execute in `(player, seq)` order; insert into the past throws; ring overflow throws; save/load of pending records; zero alloc over 10k ticks, both with no commands and with 1 command per tick.
- `hash`: known FNV vectors; `f64(-0) != f64(0)`.
- `replay` (AC 1): a toy sim (64 agents; integer-seeded rng jitter plus `createSteer` if RE-09 exists, else a local integrator) runs a scripted 600-tick command list. Record once, play back 10x: same checkpoints and final hash. A tampered command reports `divergedAt`. JSONL text round trip.
- Budget: `execute` <= 0.02 ms at 32 commands per tick.

**Do not:** read input, time or the DOM in the sim; put floats or object references in commands; hash `Map`s or objects; let presentation draw from the sim RNG; re-execute a tick.

### 28.6 RE-06 instanced voxel units (normative; architect, 2026-09-30; PC-A)

Goal: N copies of one voxel model = one instanced draw per part, both twins. ME-08's per-instance path (`addVoxelInstances`, `DRAW_VOXEL`, props/entities) stays as is.

**Decisions**
1. **Raw gl inside `_passRaster`**, like the rest of that pass (it already binds device buffers via `.handle`). The `GpuDeviceGL2.draw()` `instances` gap stays with ME-19, which moves the whole pass including this loop. `MeshBuffers` unchanged; the instance VBO belongs to the pipeline.
2. **Pose split, no second pose implementation.** `world_p(v) = I * P_p * v`. `I` = instance rigid transform `[Rz(yaw) | x,y,z]`. `P_p` = the part matrix at the identity instance = `FORWARD` after `computeVoxelPose(pm, {x:0,y:0,z:0,yawDeg:0, clip, frame, tMs}, scratch)`. This works because `Aw = Rz*cellM` and `bw = inst - Aw*anchor`, so `FORWARD(inst) = I * FORWARD(identity)`. One pose per group: instances in different animation phases go in different groups (the game buckets them). Per-instance part poses (a texture) are later work, not RE-06.
3. **Axis-aligned face rule (27.16 item 2):** aligned = identity `partFlags[p] & 1` AND the instance flag bit 0. The helper sets bit 0 when `((yaw%90)+90)%90 === 0`, the exact voxelPose test.
4. **objectId:** per instance, u32, set by the game. Unit convention: `0x10000 | unitIndex` (bit 16 = unit space; 27.4 ranges <= 0x8FFF stay as they are). planeId = `flat0 | ((objectId & 0xF) << 24)`, the same slot bits as ME-08, so neighbouring units still outline.
5. **Team colour = material remap in the vertex stage.** `vMat` is flat, so the fragment's mat logic does not change. `engine/render/teamRemap.js`: `buildTeamRemap(table, spec) -> {slotIds: Uint32Array(TEAM_SLOTS=4), mat: Uint32Array(MAX_TEAMS=8 * 4)}`, where `spec = {slots:['team.a',...], teams:[null, {'team.a':'unitRed',...}, ...]}` (palette keys; the designer adds the `team.*` slot materials, neutral colour). Keys resolve through the same id lookup `MeshData.resolveMats` uses; an unknown key throws. Team 0 and unlisted slots = identity. It is stored on the bound table as `table.team` (rebuilt with `bindShading`). The game sets it through `engine.setTeamMaterials(spec)`. Both twins read `table.team`.

**Per-instance buffer** (`engine/mesh/instances.js`): `INSTANCE_STRIDE = 16` words = 64 B, std layout. It is one ArrayBuffer with `f32`/`u32` views: `createInstanceBuffer(capacity) -> {f32, u32, capacity}`.
```
[0..3]  row0 = A00 A01 A02 tx     [4..7] row1     [8..11] row2 (tz = zBase: G-buffer z = worldZ - inst z, as castModels)
[12]    u32 objectId              [13] u32 flags: bit0 yawAligned, bits 8-15 team (0..7)     [14..15] 0
```
- `writeUnitInstance(ib, i, x, y, z, yawDeg, objectId, team)`: yaw-only, uses `cosSinDeg` (exact at multiples of 90), zero alloc.
- A general `I` must be orthonormal: test `|A A^T - 1| < 1e-6`, no scale. `mat3(I)*mat3(P_p)` stays rotation*cellM, so `normalize` is exact.

**API**
- `DRAW_INSTANCED = 3` in `DrawList.js`. The DrawItem gains `instBuf` (the ib or null) and `instCount`. `partMatrices`/`partFlags` hold `P_p` and the identity flags. `matrix` is unused.
- `DrawList.addInstances(mesh, parts, ib, count)`. `mesh` is the `MeshData` from `sharedVoxelMeshCache.get` (DrawList never resolves ids; this amends the row's `meshId`). `parts = {m: Float64Array(8*12), flags: Uint8Array(8), count}`. It copies `parts`, sets `objectId = 0` (per instance), and sets `aabb` = the union of instance translations +- R, where R = the max |corner| of the mesh bbox under `P_p`.
- **Culling:** whole group only, through `list.cull`. No per-instance culling (RE-15 compacts the buffer).
- **Group registry** (`engine/mesh/instances.js` `InstanceGroups`, `MAX_INSTANCE_GROUPS = 32`), exposed as `engine.instances`:
  - `group(modelKey, capacity) -> {ib, count, pose:{clip, frame, tMs}}`, `remove(g)`.
  - The game writes `ib`, sets `count` and `pose` each frame.
  - Each rendered frame the engine resolves `modelKey -> pm` (the VoxelPool.bind registry, cached once), computes `parts` for each group with `count > 0` into group-owned scratch, then calls `addInstances`. This runs after `addVoxelInstances` and before `list.cull`, in both `_passRaster` and `renderWorldMesh`.
- **Entity-less fast path only.** RTS units are SoA sim arrays, and the game writes the buffers. Voxel-component entities keep using VoxelPool/ME-08. Dev harness: `game/js/dev/unitsHarness.js`, `?units=N` (grid of N units, 3 teams, mixed yaws). `main.js` edit <= 5 lines.

**Shaders**
- `mesh.vert.js` exports `meshVertSrc(instanced)`. `MESH_VERT_SRC = meshVertSrc(false)` must stay byte-for-byte what it is now, plus the two new outs.
- Instanced variant:
  - Adds `layout(location=6..8) in vec4 iRow0..2; layout(location=9) in uvec2 iMeta;` (objectId, flags).
  - `lp = (uModel*vec4(aPos,1)).xyz` (uModel = `P_p`), `world = vec3(dot(iRow0.xyz,lp)+iRow0.w, ...)`. The normal is `normalize(mat3(uModel)*n)`, then rotated by the three rows the same way.
  - `vPlaneId |= int((iMeta.x & 0xFu) << 24)`, `vZBase = iRow2.w`, team remap loop over `uTeamSlot[4]`/`uTeamMat[32]` when team != 0.
- `mesh.frag.js`: `uObjectId`/`uAxisAligned` become `flat in uint vObjectId, vAxisAligned`. The static vert writes `uint(uObjectId)`/`uint(uAxisAligned)`, so the output for existing draws is unchanged.
- Second program `progMeshInst` (instanced vert + the same frag) and `_meshInstVao` with `vertexAttribDivisor(6..9, 1)` set once. Only `uViewProj` carries the camera: no shear-specific math, so RE-02's pitched matrix works with no change.

**GPU loop:**
- Instance VBO: `MAX_INSTANCES_PER_FRAME = 2048` x 64 B = 128 KB, `DYNAMIC_DRAW`. It is orphaned once per frame (`bufferData(size)`); each group then gets one `bufferSubData(ib.f32, 0, count*16)` at `base*64`. More than 2048 instances throws (dev) like DrawList.
- Per group: bind the mesh VBO (attribs 0-5) and re-point 6-9 at `base*64` (no baseInstance in WebGL2).
- Per part: `uModel`, `uAxisAligned`, then `drawArraysInstanced(TRIANGLES, start*3, count*3, instCount)`.
- Order: after the ME-08 voxel loop, before terrain.

**rasterJS twin:** `rasterDrawList` handles `DRAW_INSTANCED` **part-major, then instance order** (the GPU primitive order). It composes `I_i * P_p` in float64 into `_matScratch`; `objectId`/`planeIdOr`/`zBase`/aligned come from the instance words; mat is remapped through `ctx.team` (`= table.team`). Same `_info` path, zero alloc.

**Stats:** `stats.voxelDraws` = ME-08 draws + instanced draws. Add `stats.instancedDraws` and `stats.instances` (F3). AC1: `?units=200` with no props on screen gives `voxelDraws === 2`, `instances === 200`.

**Parity:** new gpucompare pose `unitsInstanced`, **mesh renderer only** (dda reports SKIP, not counted, so dda stays 34/34). test_room floor, 20 instances of a 2-part model (the lever until the designer's unit model exists), yaws {0, 90, 37.5, 200}, teams {0, 1, 2}, mid-animation pose, `k8Gpu > 0` guard, 27.16 item 8a bar. Mesh = 35/35, and the existing 34 give identical numbers. When RE-02 lands, it adds `unitsInstancedPitched` (pitch -58).

**Node tests:**
1. `instances.test.js`: `I*P_p == FORWARD(inst)` within 1e-9 for 200 random yaw/pos and every part of 2 models; yawAligned bit; stride/offset constants; zero alloc over 1000 `writeUnitInstance` + group frames.
2. `DrawList.test.js`: `addInstances` item fields, aabb union, cull drops an off-screen group, zero alloc.
3. `rasterJS.test.js`: N instanced == N `DRAW_VOXEL` items with equal objectId/planeIdOr, bit-identical kind/face/mat/planeId/depth/uv; team 1 changes only slot-mat pixels.
4. `teamRemap.test.js`: identity team 0, unknown key throws, rebuild after `bindShading`.
5. `glsl.test.js`: attribute locations 0-9, divisor-attribute names, the frag varyings, `meshVertSrc(false)` unchanged except the two outs.
6. `MeshBuffers.test.js` unchanged and green.

**Budget:** game writes 200 instances <= 0.03 ms; engine per group (pose + upload + 2 draws) <= 0.02 ms; JS for 200 units in 1-4 groups <= 0.1 ms. GPU at 400x150: 200 x ~600-1300 tris, AC3 +<= 0.5 ms p95 (`?bench=1&units=200` vs `units=0`, same view). If it misses, suspect vertex count (unrolled 64 B verts) before overdraw.

**Do not:**
- change ME-08's per-instance path, `voxel.frag.js`/`voxelMarch.js`, or MeshBuffers;
- recompute poses per instance;
- put the camera or projection into the instanced vert other than `uViewProj`;
- allocate per frame (views, closures, `{}` in the loop);
- change the numbers of the existing 34 gpucompare poses or widen any threshold;
- route units through VoxelPool (`MAX_SPRITES`/16-slot limits).

**Amendments (architect first review, 2026-09-30, ARCH OK):**
- Engine fields added by the implementation (kept): `engine.attachMaterialTable(table)`, `engine.teamSpec`, `engine.matTable`, so `setTeamMaterials` survives every `bindShading` rebuild. `writeUnitInstance` masks team `& 7` (MAX_TEAMS).
- **AC3 re-baselined:** raster-pass p50 delta +<= 1.5 ms for 200 levers on screen at 400x150 on the Intel iGPU (measured +0.9..1.5). Measure the raster pass with units on screen (ground/walk views), not total GPU p95 (noise floor ~0.3 ms). The +0.5 ms figure assumed a faster vertex path: the lever is 354 tris = 1062 unrolled 64 B verts, so 200 units = 13.6 MB vertex fetch per frame with no reuse. Fix = RE-06b (index buffer + 32 B voxel vertex, note 28.7 before dev), AC -50 % raster delta.

### 28.7 RE-06b voxel vertex format + index buffer (normative; architect, 2026-09-30; PC-A)

Goal: cut vertex traffic of both voxel raster paths (ME-08 `DRAW_VOXEL` and RE-06 `DRAW_INSTANCED`) from 6 x 64 B per greedy quad to 4 x 32 B + 6 indices, without touching `MeshData`, rasterJS or the level/terrain paths. Lever: 177 quads = 1062 x 64 B (68 KB) -> 708 x 32 B (22.7 KB) + 2.1 KB u16 indices; 200 units ~4.5 MB/frame (was 13.6 MB) and 4 VS invocations per quad with index reuse (was 6).

**Facts verified in `voxelMesh.js` (`emitFaceQuad`)**
- Every voxel triangle comes from `StaticMeshBuilder.addQuad`: quad q = unrolled verts `6q..6q+5` = corners `(0,1,2,0,2,3)`, so vert `6q+3 == 6q+0` and `6q+4 == 6q+2` on every field. Ranges start on quad boundaries (`beginRange` per part between quads).
- `aux8 = [0, AO_NONE(=0), 0, 0, 0, 0, 0, 0]` on every voxel vertex: aux is **constant zero for the whole mesh**, not just per part. No uniform needed.
- nrm/flat are per quad; pos/uv are per corner (uv = box-local cell index * cellM, f32).

**Decisions**
1. **MeshData unchanged** (`layout: 'static'`, unrolled, `idx: null`). The 32 B + index form is a GPU-side encoding only, derived at upload. Reason: rasterJS, meshCollide, serialization and `validateMesh` keep one format; the twin cannot drift.
2. **32 B voxel vertex** = the first 32 B of the static vertex, same offsets: `pos f32x3 @0, uv f32x2 @12, nrm u32 @20, flat u32x2 @24`, stride 32. f32 uv (not f16/u16): 12+8+4+8 = 32 already, and f32 keeps uv bit-identical to the twin. Export `VOXEL_STRIDE_BYTES = 32`, `VOXEL_VERTEX_LAYOUT` (locations 0-3, same names as `STATIC_VERTEX_LAYOUT[0..3]`) from `MeshBuffers.js`.
3. **aux = generic vertex attribute constants.** Locations 4/5 stay declared in both existing programs; on the voxel VAOs their arrays are **disabled** and the pipeline sets `gl.vertexAttrib4f(4, 0,0,0,0)` and `(5, 0,0,0,0)` once per frame before the first voxel loop (context state; the static VAO keeps 4/5 enabled so it is unaffected). **No shader change, no new program**: `progMesh` draws ME-08 voxels, `progMeshInst` draws units, both as today. `mesh.vert.js`/`mesh.frag.js`/`glsl.test.js` stay byte-identical.
4. **Index buffer per voxel mesh, pattern `4q + (0,1,2,0,2,3)`** = the exact unrolled triangle order and diagonal, so GPU primitive order == rasterJS triangle order by construction. Type: `Uint16Array` when `4 * quads <= 65536`, else `Uint32Array` (WebGL2 has no base-vertex, so the whole mesh shares one index space). Ranges map 1:1 (triangle units): `drawElements(TRIANGLES, range.count*3, type, range.start*3*idx.BYTES_PER_ELEMENT)`; units: `drawElementsInstanced(..., n)`.
5. **Encoder** `buildVoxelVertexData(mesh) -> {vertex: ArrayBuffer, index: Uint16Array|Uint32Array, quadCount}` in `MeshBuffers.js`, build-time only (may allocate). It **validates** and throws with `mesh.id` if: layout not static, `triCount` odd, any quad's verts 3/4 differ bitwise from 0/2 (compare via `Uint32Array` views of pos/uv), any aux value != 0. That keeps a future voxelMesh AO/uv change from silently rendering wrong.
6. **`MeshBuffers.getVoxel(mesh) -> {vertexBuffer, indexBuffer, indexType: 'u16'|'u32', vertexCount, indexCount}`**: own `Map` (`voxelCache`), same `id + meshVersion` invalidation and dispose-on-replace as `get()`; `dispose()` frees both maps. `get()` and `buildStaticVertexData` are not edited (level structures, glTF, terrain unchanged).
7. **Pipeline (`_passRaster`)**: new `_meshVoxVao` (attribs 0-3 enabled, 4/5 disabled) for the ME-08 loop, which now does `useProgram(progMesh)` again + `bindVertexArray(_meshVoxVao)`; `_meshInstVao` gets 0-3 from `VOXEL_VERTEX_LAYOUT` and 4/5 disabled (6-9 unchanged). Per mesh: bind its VBO, set the 4 pointers with stride 32, bind `ELEMENT_ARRAY_BUFFER` (VAO state: bind it only while the voxel VAO is bound). Map `indexType` to the GL enum once per mesh, not per part. Delete `_meshVoxVao` in `dispose`. Stats unchanged (`voxelDraws`, `instancedDraws`, `instances`).
8. **Both voxel paths switch**; `DRAW_STATIC` and `DRAW_TERRAIN` loops untouched. The ME-08 loop keeps its per-part uniforms; nothing else moves.

**rasterJS twin:** no change. It keeps walking the unrolled `MeshData` in triangle order; the GPU index pattern reproduces that order and the same vertex values, so parity is structural. The Node test below proves the encoding round-trips.

**Zero alloc:** `getVoxel` is a Map hit after warm-up; no views, closures or `{}` in the loops; indexed `for` over `VOXEL_VERTEX_LAYOUT` (no `for...of` in the new code).

**Node tests**
1. `MeshBuffers.test.js` (extend): for the lever + one multi-part model from `packVoxelModel` + `buildVoxelMesh`, decode `buildVoxelVertexData` (index -> 32 B verts) back to an unrolled triangle list and compare **bitwise** with `mesh.pos/uv/nrm/flat` per triangle, in order; indexType u16 for the lever, u32 path via a synthetic mesh with > 16384 quads; each range's byte offset/count; validator throws on a non-quad mesh, non-zero aux, odd triCount; `getVoxel` caches by id+meshVersion, re-uploads on a bump, disposes both buffers on the mock device; existing static tests unchanged and green.
2. `glsl.test.js`, `rasterJS.test.js`, `DrawList.test.js`, `instances.test.js`: unchanged and green (proves no shader/twin change).
3. `node tools/run-tests.mjs` + `check-deps.mjs` green.

**Parity + bench (main session):** gpucompare mesh 35/35 and dda 34/34 with **the same numbers** as the RE-06 captures (`2026-09-30-e9d8ac1-gpucompare-*`); `?bench=1&units=200` vs `units=0`, same views as RE-06, raster-pass p50 delta <= 0.65 ms (RE-06: ~1.3 ms, i.e. >= 50 % lower). If the delta lands at 35-50 %, stop and ASK ARCHITECT with the per-view numbers (next levers: u8/u16 pos, per-quad flat via instancing-free `gl_VertexID/4` lookup) - no ad hoc shader tuning.

**Estimate:** ~1 d, one story. If it overruns, split at the natural seam: RE-06b1 = encoder + `getVoxel` + test 1 (Node only); RE-06b2 = pipeline VAOs/loops + gpucompare + bench.

**Do not:**
- change `MeshData`, `StaticMeshBuilder`, `voxelMesh.js` output, `buildStaticVertexData`, `STATIC_VERTEX_LAYOUT` or `get()`;
- edit `mesh.vert.js`/`mesh.frag.js` or add a program variant (generic attributes cover aux);
- reorder triangles, flip the quad diagonal or dedupe vertices across quads (would break twin order and flat data);
- use f16/u16 uv (not needed for 32 B; loses bit parity);
- bind `ELEMENT_ARRAY_BUFFER` with the static or terrain VAO bound (it is VAO state);
- route level structures or glTF meshes through `getVoxel`;
- widen any gpucompare threshold or change the existing poses.

**Amendment 1 (architect, 2026-09-30, after the RE-06b review).** Measured: fetch -67 % and VS invocations -33 % gave no raster change (units delta 0.91 -> 0.88 ms at 400x150). Probe at 200x75 (1/4 pixels, same views): delta 1.09-1.17 ms, i.e. **resolution-independent**, so it is not fragment/MRT fill or overdraw either. The cost is per primitive: 200 x 354 tris = 71k tris, all rasterized (`CULL_FACE` off, 27.15.2) with ~16 flat varyings each, on an Intel iGPU front end (~65 Mtri/s effective here). Consequences: (1) no more vertex-format work; front-to-back sort or a depth pre-pass do not help (fill is not the cost). (2) Levers the next cost down: back-face culling for the two voxel paths (greedy voxel meshes are closed; halves primitives; needs the rasterJS twin to cull the same way, so a paired twin change + gpucompare) -> row RE-06c; then triangle count per unit via LOD / distance culling in RE-15. (3) The `?units` harness (1 m grid, 5 m from the eye) is a worst case for triangle size, not for count; the RTS camera sees the same count, so keep it as the stress view. RE-06b AC1 is re-baselined to "no regression vs RE-06 (raster delta <= RE-06 AC3's +1.5 ms)"; the -50 % goal moves to RE-06c + RE-15.

### 28.8 RTS-01 spike layout `game/js/rts/` (normative for the spike; architect, 2026-09-30; PC-A)

28.1-28.6 cover the engine side. This note fixes the game-side shape so the spike code can grow into the real RTS instead of being thrown away. Spike only: no new engine code (gaps -> RE rows).

**Prerequisites (engine, must be done first):** RE-02 (pitched raster on the mesh renderer), RE-03 fixes, RE-EXP (exports `pick.js`, `createSteer`, `createFlowField`, the pitched projection API), RE-07 (screen rect + ground rings) for a5/a6. RE-06b is not a prerequisite (see the RTS-01 b5 note).

**Layout** (game imports only `engine/index.js`; `sim/` never imports `ui/`, `ui/` reads sim state read-only):
- `game/rts-test.html` + `game/js/rts/rtsMain.js`: bootstrap (AssetRegistry via the main.js export, `World.load(world_m1)`, `?renderer=mesh`, `?n=`, `?grid=`), owns the `Loop`.
- `sim/units.js`: `createUnits(max)` SoA, Float64Array `x, y, prevX, prevY, tx, ty`; Uint8Array `team, state` (0 idle, 1 moving); Int32Array `pathOff, pathLen, pathPos` into one preallocated `Int32Array` path pool. Unit id = steer slot = instance index source. No z, no yaw in sim.
- `sim/orders.js`: applies `commands.js` entries due at `q.tick` (`MOVE`: ids + target x,y). Group move: one `findPath` from the group centroid, per-unit target = target + formation offset (ring slots by ascending id); groups > 12 units use one flow field (28.2 "no per-unit A* for large groups"). A* expansions capped per tick (28.2).
- `sim/tick.js`: `simStep(state)` = copy x,y -> prev, apply orders, `steer.step(STEP, grid)`, copy steer x,y back, arrival -> idle. Fixed step only.
- `sim/navSetup.js`: `NavGrid.buildFromWorld(world, {maxSlopeDeg: 30})` at load, tower footprint via `blockWorldRect`. Load-time only.
- `ui/input.js`: mouse/keys -> `updateRtsCamera`, selection, `q.issue(1, MOVE, ids, n, x, y, 0)` (inputDelay 0). Never writes sim arrays.
- `ui/select.js`: pure selection rules (own team, box ids ascending, shift-add, clear) on plain arrays; a7 test lives here (`select.test.js`).
- `ui/unitsView.js`: per rendered frame, interpolated `x = prev + (cur-prev)*alpha`, z = `world.supportAt` (terrain height), **yaw smoothing here** (render-side, 28.2: atan2 is not sim math), writes `writeUnitInstance` into 2 `engine.instances` groups (one per team), `count` = team size. Zero alloc.
- `ui/hud.js`: F3 lines (b6) + how-to-play text (b8).

**Placeholder unit model:** a `.vox`-free voxel model object built in `game/js/rts/unitModel.js` (2 parts: body + head/weapon, one `team.a` slot on >= 40 % of the visible faces), registered with the same registry path `?units=N` uses; team materials via `engine.setTeamMaterials`. It moves to `design/` when the designer takes over.

**Determinism (check-deps rule 15, already scoped to `game/js/rts/sim/`):** 0 warnings in `sim/`. Iterate by id, never over Map/Set. Seeded placement uses `rng.js`. Sim reads no DOM, camera or frame dt. The hash/replay are not wired for the spike, but every sim module keeps its state in typed arrays so `hashInto` can be added later without restructuring.

**Timing:** F3 `sim ms` = sum of `simStep` calls in the frame (profiler section), `JS ms` includes it. Units view + instance writes <= 0.1 ms for 200.

**Do not:** put unit logic in `engine/`; call `performance.now`/`Math.random`/trig in `sim/`; allocate per step or frame (ids scratch preallocated); path every unit separately for a 60-unit group; read `groundAt` for sim decisions.

### 28.9 RE-07 selection overlay layer `engine/ui/overlay.js` (normative; architect, 2026-09-30; PC-A)

Goal: world-anchored RTS marks (ground rings, health-bar rows, box-select rect, move marker), depth-tested against the scene, the same cells on the GPU and CPU paths, on `'pitched'` and `'shear'`.

**Decisions**
1. **Ops are rasterised in JS into a scene-grid overlay layer; only the depth-tested composite runs per path.** Both paths share the op rasteriser, so which cells get a glyph is decided by construction. The only per-path code is the per-cell compare `ref <= sceneDepth + bias`: GLSL on GPU, JS on CPU. There is no GPU geometry pass, and no ops are uploaded to shaders.
2. **Frame position (both twins):** surfaces -> edge -> sprites (pass F, incl. fade/dim) -> **overlay** -> present (scene, then UI layer 17.2). Overlay marks are not faded or dimmed: they are UI, and RTS has no fade. On the CPU path the composite runs right after `applySceneFade` (main.js / the rts-test bootstrap). On the GPU path it is a new `RenderTargetGL.setOverlayPass(fn)` hook, run after the sprite-pass hook and before the draw.
3. **Projection = the frame's raster matrix.** `overlay.flush(cam, cols, rows)` builds M in its own scratch `Float64Array(16)` with the call the mesh raster uses. If two build sites exist, one helper `frameMatrix(cam, grid, out16)` goes into `projection.js`, using `resolveProjection` (28.1 A2 item 1). Then `projectPoint(M, cols, rows, x, y, z, out4)` gives `cell = floor(out4[0]), floor(out4[1])` and `ref = out4[3]` (= w = pitched `vd` / shear `d` = the DEPTH/SDEPTH value of that camera, as `projectSprite.depth`). Points with `w <= PROJ_NEAR` are skipped. Shear and pitched are the same code.
4. **Depth test:** pass iff `ref <= sceneDepth + max(OVL_BIAS_M = 0.25, OVL_BIAS_REL = 0.01 * ref)`. Sky/horizon depth (+Inf / `HORIZON_DEPTH`) always passes. Scene depth = the resolved per-cell DEPTH: GPU `pipeline.texDepth` (decode as `sprites.frag.js depthAt`), CPU `fb.depth.depth` after the pitched fog-scale restore (`scaleDepthForShade(..., false)` in compositor). `ref = 0` means "no depth test" (screen-space ops). Units occlude the back half of their own ring through the unit's raster depth (28.6 `zBase` does not matter here: DEPTH is the view depth, not the G-buffer z). A ring behind the tower or terrain fails the test.
5. **Layer storage** (scene grid, rebuilt on `grid:changed` like `engine.ui`): `ovl Uint8Array(4n)` = (r, g, b, glyphIdx) and `ovlZ Float32Array(n)` = ref. **glyphIdx 0 (space) = empty cell** (sentinel; a space op is meaningless). Write rule when two ops hit a cell: empty, or `ref == 0` (screen op wins), or `newRef < cellRef`; ties go to the first op written. Clearing uses a touched-index list (`Int32Array(OVL_MAX_TOUCHED = 16384)`), not a full fill.
6. **Composite writes glyph + fg only.** The scene bg stays, so the ring reads as marks on the ground. CPU: direct writes into the scene `CellBuffer` glyph/fg arrays; `mask` is untouched (not `setCellRGB`, which sets mask = 1). GPU: `engine/render/gpu/overlayPass.js` = a fullscreen triangle into an FBO with **only `rt.fgTex`** attached. It reads `uOvl` (RGBA8) + `uOvlZ` (R32F) + `uDepth` and `discard`s empty or depth-failed cells. There is no read of fg/bg, so no edge copy is needed (unlike pass F). Upload: `texSubImage2D` of the dirty row span (union of this frame's and last frame's touched rows). The pass and the upload are skipped when both frames had no ops.
7. **Styles are data, not engine colours.** `overlay.setStyles(styles)`: `{key: {glyph: 'o' | glyphs: 4-char string (by segment slope: horizontal, vertical, down-right, up-right, e.g. "-|\/"), fg: [r,g,b], empty?: {glyph, fg}}}`. The game passes them from design (`uiStyle.overlay`, keys e.g. `select`, `hover`, `barFill`, `barEmpty`, `box`, `marker`; programmer placeholders until the designer sets them). `overlay.styleId(key) -> int` is called once at load and throws on an unknown key. Per-frame ops take the int, never a string. The engine has no default colours.

**API** (`engine/ui/overlay.js`, exported via `engine/index.js`, `engine.overlay` created in `createEngine`):
```js
/** @typedef {Object} Overlay
 * @property {(styles:Object)=>void} setStyles   @property {(key:string)=>number} styleId
 * @property {()=>void} clear                                   // per frame, before the game records ops
 * @property {(x:number,y:number,z:number,r:number,style:number)=>void} ring      // world circle at height z, 24 samples, cells joined by a DDA line, ref lerped per cell
 * @property {(x:number,y:number,z:number,frac:number,width:number,style:number,emptyStyle:number)=>void} bar  // row of `width` cells centred on the projected point; round(frac*width) cells fill, rest empty; ref = the point's w
 * @property {(c0:number,r0:number,c1:number,r1:number,style:number)=>void} rect  // screen cells, border only, normalises c0<=c1/r0<=r1, ref 0
 * @property {(fn:((x:number,y:number)=>number)|null)=>void} setGroundFn        // optional: ring samples use z = fn(x,y) + OVL_RING_LIFT (0.05 m) so rings follow slopes
 * @property {(cam:Object, cols:number, rows:number)=>void} flush              // engine-internal, once per rendered frame: rasterise ops -> ovl/ovlZ
 * @property {{ops:number, dropped:number, cells:number}} stats
 */
export const OVL_MAX_OPS = 1024;   // op buffer Float64Array(OVL_MAX_OPS * 8): [type, style, a..f]
```
Capacity: 200 selected rings + 200 bars + hover + rect + markers < 1024. Overflow drops the op and counts `stats.dropped` (shown in F3); it does not throw, because UI must not crash a frame. `ring`/`bar`/`rect` only append numbers. All work happens in `flush`. Zero allocation after create.

**Split (> 1 d):**
- **RE-07a (Node, CPU twin, ~0.6 d):** `overlay.js` (ops, styles, rasteriser, touched list, `applyOverlay(overlay, cells, depth)` CPU composite), `engine.overlay` + grid rebind, CPU call site, `frameMatrix` helper if needed.
- **RE-07b (GPU, ~0.5 d):** `overlayPass.js` + `setOverlayPass` hook + dirty-row upload + GPU parity + perf. RTS-01a needs both.

**Tests.** 07a `engine/ui/overlay.test.js`:
1. Ring on a flat depth fixture at pitch -58: every touched cell is 8-connected to the next (closed loop) and the ring is symmetric about the centre column within 1 cell.
2. The ring hides where a synthetic wall depth is closer (> bias) and shows on open ground.
3. Bar fill count at frac 0 / 0.5 / 1.
4. Rect normalisation and border-only.
5. Overlap rule (nearer wins, rect wins).
6. Shear and pitched give the same cells for a pitch-0 pitched cam vs the shear cam (28.1 parity anchor).
7. Unknown style throws; overflow counts `dropped`.
8. Zero allocation over 1000 frames of 200 rings + 200 bars.
9. Perf warn-only: 60 rings + 60 bars flush + composite <= 0.3 ms, 200 + 200 <= 0.6 ms (Node, 400x150).

07b: gpucompare mesh-only pose `rtsOverlay` (rtsHill58, 30 rings incl. >= 5 behind the tower, 30 bars, 1 rect). It compares the fg glyph/colour after the overlay pass with the CPU composite applied to the JS twin's cells + depth. Bar:
- identical on every overlay cell except depth-boundary cells (`|ref - sceneDepth - bias| < 1e-3 * ref`);
- boundary cells <= 0.5 % of overlay cells;
- existing poses unchanged (no ops, so the pass is skipped).

GPU overlay pass <= 0.1 ms p95 at 400x150 (`?bench=1` pass timer, new `PASS_OVERLAY` slot).

**Do not:**
- hardcode colours/glyph choices in the engine;
- use string keys in per-frame ops;
- read `cam.pitchDeg` or build projection terms by hand (use M / `projection.js`);
- test depth against `zBase`/G-buffer z;
- set the scene `mask`;
- alpha-blend;
- add a shader permutation;
- read and write `rt.fgTex` in one pass;
- upload the full layer every frame;
- put selection or team rules into `overlay.js` (game `ui/select.js`, 28.8).

### 28.10 RE-06c back-face culling for voxel draws (normative; architect, 2026-09-30; PC-A)

Background: 28.7 Amendment 1 (unit cost is per triangle; `CULL_FACE` off per 27.15.2).

**Decisions**
1. **Winding (verified in `voxelMesh.js emitFaceQuad`):** every face emits its corners clockwise seen from outside in world (x east, y south, z up). Example: U face `(xA,yA)->(xB,yA)->(xB,yB)`. The pipeline writes grid row r at window y = r with no viewport flip. So a front face has **positive** snapped screen area `A2 = (X1-X0)(Y2-Y0) - (Y1-Y0)(X2-X0)` in `rasterJS rasterFanTri`, which is GL CCW. GL state: `frontFace(CCW)` (set explicitly at init) + `cullFace(BACK)`. The programmer proves this with test 1 below before touching GL; if the sign comes out the other way, flip both twins together.
2. **Scope:** `gl.enable(CULL_FACE)` right before the ME-08 voxel loop and `gl.disable` right after the RE-06 instanced loop (before terrain). `DRAW_STATIC` (level structures: open quads, seen from both sides) and `DRAW_TERRAIN` stay cull-none.
3. **rasterJS twin:** `info.cullBack` is set for `DRAW_VOXEL` and `DRAW_INSTANCED` items only. In `rasterFanTri`, `if (A2 < 0 && info.cullBack) return;` goes **before** the existing swap. It uses the same snapped subpixel area the GPU uses, so slivers classify alike. It applies to fan triangles after clipping (the fan keeps the winding). The rule is the same on shear and pitched (it is purely screen-space).
4. **Mirroring:** part matrices are rotation * positive `cellM` and instances are rigid (28.6: orthonormal, no scale), so det > 0 always. Test 3 asserts it. A future mirrored part needs a per-item front-face flip in both twins (not in this story).
5. **Camera inside a voxel model:** inner faces are back faces, so they are culled and the model disappears from inside. This is accepted and identical on both twins. The first-person capsule keeps the eye out of entity models and RTS cameras never enter one.

**Tests / ACs:**
1. `rasterJS.test.js`:
   - For the lever and a multi-part model, from 26 outside viewpoints (6 axes, 8 corners, 12 edges; shear + pitched): every triangle with `dot(n, eye - p) > 0` has `A2 > 0`.
   - Culled output == unculled output bit-identical (kind/face/mat/planeId/depth/uv) for those viewpoints, instanced and `DRAW_VOXEL`.
   - Rasterised triangle count ~halves (logged).
2. Static/terrain items are never culled (fixture with an open quad seen from behind).
3. det > 0 for every part at 3 poses of every registered model.
4. **gpucompare: identical numbers on all poses** (mesh 39/39 on the current baseline incl. RE-02a poses, dda 34/34). Back faces of a closed mesh never win a pixel from outside. If a voxel pose differs, stop and report the differing cells (likely cause: greedy T-junction cracks) as ASK ARCHITECT. Do not widen any threshold.
5. Bench `?bench=1&units=200` vs `units=0`, RE-06b views: raster-pass p50 delta <= 0.65 ms binding (RE-06b 0.88), goal <= 0.44. Culled triangles still cost vertex-shader and setup time. A miss is recorded, and RE-15 LOD takes the rest.

Size 0.5 d, one step.

**Do not:** cull level structures/terrain/glTF, cull in the vertex shader, flip the quad order in `voxelMesh.js`, or leave `CULL_FACE` enabled past the voxel loops (context state).

### 28.11 BUG-RTS-001 terrain hash cell on pitched views (normative; architect, 2026-09-30; PC-A)

**Cause (code + arithmetic, no capture needed).** `shadeTerrain` (terrainShade.js:90 / terrain.frag.js:401) keys ALL per-cell look dice on a world cell of 2 m (t < handover h1 = 320) or 8 m: `hA` (colour tier dark/mid/light +-1), `hB` (glyph), the +-0.08 close-band jitter (salt 10) and features. The whole 2 m x 2 m square gets ONE glyph and ONE colour tier. In the third-person view a 2 m cell is ~1 row high and reads as texture. At rtsHill58 (focus 30 m wide, vd ~35 m, 160x60) one column is ~0.19 m on the ground, so a 2 m hash cell is a ~10 x 5 block of identical glyph + colour: the "tiles". Ruled out: (a) the bands/handover do not switch inside the view (t = 0.53 x vd ~ 12-25 m, all in the close band < 40). (b) terrain planeId is a constant -1 (terrain.vert.js:112), and the terrain branch does not use the edge or deriv planes. (d) the terrain branch does not read GD. Secondary: (c) the near type grid is nearest-texel at 2 m (`terrainTypeAt`), so grass/path borders are 2 m staircases. That is minor next to the hash, and the fix below does not touch it (see 28.11b).

**28.11a fix (one step, ~0.5 d).** A per-frame `hashCell` (metres) replaces the 2/8 constant when it is > 0.
1. `terrainShade.js shadeTerrain`: `const cellSz = ctx.hashCell > 0 ? ctx.hashCell : (ctx.handover && t < ctx.handover[1] ? 2 : 8);`. Add `hashCell?: number` to the ctx JSDoc. `makeTerrainShadeCtx` leaves it at 0.
2. GLSL twin, terrain.frag.js TERRAIN_SHADE_GLSL: `uniform float uHashCell;` and the same expression. GpuCellPipeline sets it every frame, 0.0 in shear mode.
3. Value (pitched only; one helper `pitchedHashCell(cam, cols, zRef)` in `engine/render/projection.js`, exported, used by both twins). `vdC = (cam.z - zRef) / sin(-pitch)`, where `zRef = cam.focusZ` if finite, else `terrain.groundAt(cam.x, cam.y)`. `fp = 2 * tanHalfX * vdC / cols` (ground metres per column). `hashCell = clamp(2^ceil(log2(fp)), 0.125, 2)`. Powers of two nest, so zoom steps change the glyphs without blocks. The value depends on zoom and grid only, so it stays stable while panning (world-keyed, no shimmer). Shear mode returns 0.
4. Leave the close/handover/band gates on `t` as they are. Leave feature chances as they are: the density per screen cell stays the same as in the third-person view.
5. Do not: key the hash on screen cells (shimmer when panning), make the cell size per fragment (seams across rows), or change `typeAt`/physics.

**Tests.** terrainShade.test.js: hashCell 0 matches the old output byte for byte (8 test points). With hashCell 0.25, u and u + 0.3 fall in different cells. `pitchedHashCell` at the rtsHill58 pose at 160 cols is 0.25 and at 400 cols is 0.125. Shear gives 0. glsl.test.js twin check for the expression. gpucompare mesh: the existing non-rtsHill poses are identical (shear sends uHashCell 0). rtsHill55/58/60/Sky15 and the RE-07b overlay pose change: GPU and the JS twin must match each other, and that becomes the new baseline, recorded in the story. dda: identical. Owner check: `game/rts-test.html` at 400x150 and 240x90 shows continuous ground.

**28.11a gpucompare gate (architect, 2026-09-30, ARCH OK).** Poses where `pitchedHashCell > 0` (rtsHill*, RE-07b overlay) compare with a hash-boundary gate: `fgMax` is reported but NOT gated; the pose passes when cells outside tolerance <= 0.5 % (unchanged), glyph match >= 99.9 %, and bgMax <= 64. All shear/dda poses keep the old gates (must stay identical).
Reason: GPU u/v is a float32 raster-interpolated world position (error ~1e-4 m at |u| ~ 1.5 km), JS is double; at 0.25/0.125 m cells a few cells sit within that error of a floor boundary and flip tier/glyph (isolated large fg delta). Quantising u/v in both twins does not help: any grid still has boundaries inside the interpolation error, so it only moves the flipped cells.
If a future pose exceeds 0.5 % outside or < 99.9 % glyph match, that is a real bug (e.g. uHashCell not uploaded), not boundary noise.

**28.11b (only if the owner still sees 2 m staircases at type borders after 28.11a).** Dither the render-only type lookup (terrain.vert.js `terrainTypeAt` + rasterJS `kind7Mat`) by +-0.5 texel with a fine world hash. Physics `typeAt` stays as it is. Separate 0.5 d step, not planned now.

**28.11c BUG-FP-002 per-cell hash size (normative; architect, 2026-10-01; supersedes 28.11a items 3 and 5 for pitched frames).**
1. On every pitched frame both twins send `hashCell = -k`, `k = 2 * tanHalfX / cols` (ground metres per column per metre of view distance). Shear frames send 0 (unchanged).
2. `hashCell < 0` = per-cell mode: `cellSz = 8` if a near band exists and `t >= handover[1]`, else `clamp(2^ceil(log2(max(t*k, 1e-6))), 0.125, 2)` (JS: `perCellHashSize` in terrainShade.js; GLSL: terrain.frag.js, same expression and branch order). `hashCell > 0` (fixed cell) and `0` (2/8 m bands) keep the 28.11a meaning.
3. Accepted: per-fragment cell size (28.11a item 5 lifted for this mode). Power-of-two cells nest, so a depth doubling only swaps the pattern along one contour, no block seam. The contour moves with the camera; a cross-fade/dither at the step is a follow-up only if the owner sees it.
4. `pitchedHashCell()` is no longer called per frame; it stays exported for tools/tests, deprecated, removed with the next projection.js cleanup.
5. gpucompare: shear/dda poses identical. Pitched and pitchedDefault mesh poses use the 28.11a pitched gate (outside <= 0.5 %, glyph >= 99.9 %, bgMax <= 64, fgMax reported only). GPU log2/float32 vs JS double flips cells at the doubling contours (same boundary class as 28.11a). Baseline: the 2026-09-30 b72c3b9 run.
6. Tests: terrainShade.test.js per-cell sizes (0.125 / 0.5 / 2 / 8 past handover) and hashCell 0 byte-identical; glsl.test.js expression twin.
7. Do not: key the hash on screen cells, change typeAt/physics, or reuse the sign of `hashCell` for anything else.

### 28.12 ME-22 large voxel models, mesh-only (normative; architect, 2026-09-30; PC-B, ends in arch-review)
The 32/axis, 4096-voxel, axis-sum-48 limits exist only for voxelMarch/voxel.frag + VoxelTextures (16 slots). The mesh path (voxelMesh greedy mesh, RE-06b 32 B verts + u16/u32 index, RE-06c cull) does not need them. ME-19 later deletes the old limits entirely.
1. **Marking = explicit flag**, never automatic: ModelDef `voxel.meshOnly: true` (JSON-safe bool, default false; same key in `.model.json`). A def over the old limits without the flag stays an error (message names the flag). Reason: silent auto-promotion would make a typo'd size vanish from `?renderer=dda` without anyone noticing.
2. **Validator** (`validateVoxelModel`, `engine/voxel/VoxelModel.js`): new exports `MESH_ONLY_MAX_DIM = 256`, `MESH_ONLY_MAX_CELLS = 2097152` (sx*sy*sz of the model box, bounds the dense pack grid at 2 MB u8), `MESH_ONLY_MAX_QUADS = 32768`. With `meshOnly`: per-axis 1..256, box product <= MAX_CELLS, part boxes inside the model box; axis-sum and 4096 rules skipped. **Unchanged** for mesh-only: `MAX_VOX_PARTS = 8` (instances.js/voxelMesh pose scratch are sized by it), materials, animations, JSON-safety. `meshOnly` not boolean -> error.
3. **Quad budget** is checked where the mesh is built, not in the validator (validator stays pure/cheap): `buildVoxelMesh` throws with the model id if quads > MESH_ONLY_MAX_QUADS; tools report the quad count (vox-import runs pack + buildVoxelMesh once and prints `quads/tris/est. GPU KB = quads*(128+12|24)/1024`). Warn above 16384 quads. u32 index path (28.7 item 4) is used automatically above 16384 quads - no new code there.
4. **`?renderer=dda` / Canvas2D**: the dda path never receives a mesh-only model. At the single place instances are routed to VoxelPool, `model.voxel.meshOnly` -> draw nothing but a one-time `console.warn` per modelKey (no placeholder geometry in 0.x: a box needs a new sector/voxel primitive; skip is enough until ME-19). Never throw. VoxelPool/VoxelTextures additionally assert-guard: `add`/upload of a meshOnly model throws in dev (programmer error, the router must filter first).
5. **vox-import**: imports whole by default; if the model exceeds the old limits it sets `meshOnly: true` itself and prints why (tool decision, visible in the generated file - this is not the engine auto-promotion of rule 1). `--no-mesh-only` restores today's refusal. Over MESH_ONLY bounds -> refuse with the numbers.
6. **vox-split**: splitting stays as an option. `fitsCurrentLimits` unchanged; add `fitsMeshOnly(size)`; report `fitsNote` = `'mesh-only (ME-22)'` when it fits that, `'too large even for mesh-only - split'` otherwise. Remove the "do NOT raise the engine limits" wording (the old limits still are not raised; this is a separate path).
7. **validate-content.mjs**: passes through the flag via `validateVoxelModel`; lists mesh-only models in its summary line (count) so a dda-only test page knows what it won't show.
8. **Tests**: `VoxelModel.test.js` (40^3 without flag -> error naming meshOnly; with flag -> ok; 257/axis, box > MAX_CELLS, 9 parts, non-bool flag -> errors; existing small models byte-identical results). `voxelMesh` test: synthetic checkerboard over MAX_QUADS throws with id; one environment tree (if `design/vox` present, else skipped) packs + meshes under budget, u32 index when > 16384 quads. `vox-import`/`vox-split` tests for the auto flag, `--no-mesh-only`, fitsNote strings. Router test (compositor or VoxelPool test): meshOnly model with renderer dda -> no pool entry, no throw, one warn. `node tools/run-tests.mjs` + check-deps green; main session one `?gpucompare=1` (no pixel change expected).
**Do not**: raise MAX_VOX_DIM/STEPS/4096/PARTS; grow VoxelTextures/voxel.frag; auto-flag in the engine; add LOD/decimation or chunked meshes (later story if a tree busts 32k quads); read `design/vox` from engine code; allocate per frame for the flag check (read the bool on the cached model).
**Size**: ~1 d, one story. Split seam if needed: ME-22a = validator + mesh budget + router skip + tests (engine); ME-22b = vox-import/vox-split/validate-content (tools).

### 28.13 RE-15 unit instance culling + LOD (normative; architect, 2026-09-30; RE-15a/b PC-B cross-track -> arch-review, RE-15c PC-A)
Background: 28.6-28.10. Unit cost is per triangle; today only the whole group is culled, so the RTS view (200 units, ~30 on screen) pays for ~170 invisible units.
**Decisions**
1. **Where: engine, `InstanceGroups.addToDrawList(list, cache, planes, frameNo)`** (engine/mesh/instances.js). Both callers (compositor.js, GpuCellPipeline `_passRaster`) already compute `frustumPlanes(meshViewProj)` before this call: move the call after it and pass the planes (1 line each). These planes come from the same viewProj as `list.cull`, so shear and pitched (28.1) both work with no extra code. Not in the game view: every game would have to re-implement it, and the twins must see one set.
2. **Per-instance test** = `classifyAABB(planes, t-R, t+R)`, t = instance translation (words 3/7/11), R = the group radius `addInstances` already computes (factor it out to `groupRadius(mesh, parts)` and compute it once per group per frame). Conservative: it never drops a visible unit.
3. **Compaction** into group-owned scratch buffers `g.drawIb[0..1]` (LOD0/LOD1, `createInstanceBuffer(capacity)` allocated in `group()`). Copy the 16 words with a plain loop (no `subarray`/`set(subarray)`: they allocate). Stable, in game order. `g.ib` (game-owned) is never written. `addInstances` gets the scratch ib + its count, so the GPU upload, the rasterJS twin and the aabb all see the same compacted set with no twin changes.
4. **Once per frame:** memo on `frameNo` (the engine's rendered-frame counter). A second call in the same frame (gpucompare runs both twins) re-pushes the cached compaction and does not recompute. This keeps the LOD hysteresis state from advancing twice.
5. **LOD mesh:** `VoxelMeshCache.get(pm, key, names, lod = 0)`. LOD1 is built once, lazily, cached per pm (WeakMap per lod), `id 'vox:<key>@1'`. Build = per part, 2x2x2 downsample of the packed grid: a block is solid if ANY cell is solid; its mat = the most frequent solid mat (tie -> lowest id). Then greedy-mesh with the same `emitPartFaces`, with vertices in the **same part-local space** as LOD0 (half-res cell i covers LOD0 cells 2i..2i+1). So `parts` (P_p), part ranges/names and R are shared, and only the mesh differs. R = max over both LOD meshes' bboxes (odd dims may stick out one cell). Deterministic, and it does not touch the ModelDef (no designer data in 0.x).
6. **LOD selection per instance, by projected size** (cost is per triangle, and screen size is what matters on a pitched camera, not metres): `cells = R * P11 * rows / w` (w = clip w of t; use the viewProj rows already in hand). LOD1 when `cells < g.lodCells * 0.9`, back to LOD0 when `> g.lodCells * 1.1`. Previous LOD kept in `g.lodPrev: Uint8Array(capacity)` indexed by game slot (the game keeps slot order stable; if it does not, the worst case is a pop, not a bug). **`g.lodCells` default 0 = LOD off** (engine-neutral). The RTS unitsView sets it (start 8, tune with the owner). Harness `?units=N&lod=C`.
7. **Draws:** at most 2 `DRAW_INSTANCED` items per group (LOD0, LOD1). An empty bucket pushes nothing, and a group with 0 survivors pushes nothing (0 draws).
8. **Stats (F3):** `stats.instances` = drawn, new `stats.instancesCulled`, `stats.instancesLod1`, filled by `InstanceGroups` (`groups.stats`, reset per memo frame) and copied by both pipelines. F3 line `inst 31/200 lod1 12 cull 169`.
**Budget:** cull + LOD + compaction for 500 instances <= 0.1 ms JS (no allocation, 0 in the 1000-frame alloc test). LOD1 build: one-time per model, not per frame (log ms, <= 5 ms for the lever).
**Expected gain:** RTS default zoom -80..85 % unit triangles from culling alone. LOD1 = about 1/4 of the quads for small units. That should put the raster-pass delta under 0.44 ms in RTS views.
**Parity (gpucompare):** every existing pose has identical numbers (mesh and dda). `unitsInstanced`/`unitsInstancedPitched` stay identical: all instances are on screen and LOD is off. New mesh-only pose `unitsCullLod` (RE-15c): pitched -58, 60 units, about half off screen, lodCells = 8 with both LODs visible; 27.16 item 8a bar, `k8Gpu > 0`, and the stats assert drawn + culled = 60. dda SKIP.
**Tests (Node):** `instances.test.js`: off-screen-only group -> 0 items; mixed -> the survivors in game order, bit-equal words; straddling units kept; the second call in the same frameNo returns the same items without advancing lodPrev; hysteresis band; zero alloc. `voxelMesh.test.js`: LOD1 quads < LOD0; LOD1 bbox within LOD0 bbox + 1 cell; any-solid rule; mat-mode tie; cached identity. `rasterJS.test.js`: compacted group == the same instances as DRAW_VOXEL (existing oracle) bit-identical.
**Bench AC (RE-15c, Intel iGPU, 400x150):** `?bench=1&units=200&lod=8` vs `units=0`, RE-06b views: raster-pass p50 delta <= 0.65 ms binding, goal 0.44. Plus one RTS view (`game/rts-test.html?bench=1`) where delta <= 0.44 binding. Record drawn/culled/lod1 next to the ms.
**Steps:** RE-15a cull + compaction + memo + stats (0.5 d, PC-B, pure JS engine/mesh + 1-line caller edits). RE-15b LOD1 mesh build + cache (0.5 d, PC-B). RE-15c LOD selection/hysteresis + 2 items per group + unitsView/harness opt-in + gpucompare pose + bench (0.5 d, PC-A: GPU check and bench on the iGPU).

**28.13 amendment (RE-15c review, opus 2026-10-02).** (a) Point 6: selection uses `|row1.xyz|` of the column-major viewProj (= P11 without shear; correct pitched/sheared); `w <= 1e-6` -> LOD0; culled slots keep their stale `lodPrev`. (b) Points 5/7: R (max over both LODs) is computed once per memo frame (`g._R`) and passed as `addInstances(mesh, parts, ib, count, R)` 5th arg; both items use it. (c) Bench AC: RE-06b views where all units are on screen and above `lodCells` (ground floor, +0.885 ms vs no-lod +0.909) are informational - record drawn/culled/lod1; the base instancing cost belongs to RE-06b. The binding check is the RTS view (`rts-test.html?bench=1`, <= 0.44 ms), run as **RE-15d** after BUG-RTS-002; if it misses, tune `RTS_LOD_CELLS` with the owner first, then escalate.
**Do not:** cull or pick LOD in the vertex shader or the game view; write into the game's `g.ib`; allocate per frame (subarray, closures, per-frame arrays); recompute on the second twin call; add new GLSL or change `mesh.vert.js`; pick LOD by metres alone; add LOD2/impostors or decimation (later); turn LOD on by default in the engine; widen any gpucompare threshold; touch ME-08 `DRAW_VOXEL`/VoxelPool culling (ME-17 owns the rest).

## 29. M3 openers: US-079a beast brain + nav chase, US-128 Z-targeting (architect, 2026-10-01; PC-B game side, PC-A camera)

Both stories are **game** code on top of existing engine exports (`NavGrid`, `createAStar`, `findPath`, `smoothPath`, `createSteer`, `createRng`, `createHasher`, `SIM_STEP`, `hasLineOfSight`, `engine.overlay`, `PlayerLook`, `HFOV_DEG`, `PHYSICS`). Only two small engine steps are new: **RE-05c** (nav drop rule) and **US-128a** (look lock + input keys). The game imports only `engine/index.js` and never `game/js/rts/` (copy patterns only).

### 29.1 US-079a beast brain + nav chase (PC-B; engine step RE-05c first)

PO 2026-10-01: answers to 29 questions: all accepted - content in `components.brain {kind, home}` + `components.targetable`; returnSpeed 1.5 m/s (re-notice allowed); event `combat:hit` {source, target, damage:1}; replay bit-equal within one world load only (AC 7 reworded).

**Decision: the brain is game code** in `game/js/quest/`, not an engine `brain` hook. There is one enemy kind; an engine AI layer waits for a second one. **Walkability does not move into the engine as a new function.** `NavGrid.buildFromWorld` already is the engine API, and `navSetup.js` is a 5-line wrapper the game copies. The only missing piece is a drop rule, which is **RE-05c**.

**RE-05c (PC-B cross-track, ~0.25 d, `engine/nav/NavGrid.js` + test -> arch-review).**
- New option `maxStepM` for `buildFromWorld` and `buildFromArrays`. Default `Infinity` = today's behaviour.
- After the per-cell pass, a second pass over `height`: a walkable cell gets `terrainCost 0` if any in-grid 8-neighbour has `|height[j] - height[i]| > maxStepM`.
- Decide from the first-pass result into a scratch `Uint8Array(N)` (no cascade, order-independent), then apply, then `_recomputeCost()`.
- Tests: a 1.5 m step fixture blocks both cells at the edge; a 0.9 m step stays walkable; default options give `cost` byte-equal to today on the existing fixtures; check-deps green.

**Files (PC-B):**
- `game/js/quest/sim/beastConfig.js`: `BEAST_DEFAULTS`, seconds/metres taken from the ACs: `wanderR 6, pauseMin 2, pauseMax 4, walk 1.5, noticeR 12, coneCos 0.5 (120 deg), nearR 3, noticeSec 0.6, chase 4.5, windupR 5, windupSec 0.5, charge 7, chargeMaxSec 1.2, recoverSec 1.0, recoverWallSec 2.0, loseR 20, loseSightSec 5, repathSec 0.5, repathMoveM 2, returnSpeed 1.5, homeArriveR 1, radius 0.45, eyeZ 0.5, targetZ 1.0, losEvery 6`. At create, `toSteps(sec) = Math.round(sec / SIM_STEP)` runs once; every timer is an **integer step counter**.
- `game/js/quest/sim/sight.js`: `canSee(world, ax, ay, az, bx, by, bz)` calls `hasLineOfSight` on chunks of <= 5 m (20 samples, so <= 0.25 m spacing; the engine caps samples at 20 per call). US-128 uses it too.
- `game/js/quest/sim/beastNav.js`: `buildBeastNav(world, navCfg)` returns `{grid, astar}`. It runs `new NavGrid({x0,y0,w,h,cell})` + `buildFromWorld(world, {maxSlopeDeg, maxStepM, blockedTypes})` with the content `nav` values (below). Load time, may allocate.
- `game/js/quest/sim/beastSim.js`: `createBeastSim(world, {nav, rng, events, cfg?})` returns the sim, or `null` if no entity has `components.brain.kind === 'beast'`.
- `game/js/quest/beastView.js` (presentation, outside `sim/`): `presentBeasts(sim, world, overlay, styleIds)` writes `transform.yawDeg = atan2(fx, -fy)` in degrees and draws the `!` marker as a 1-cell `overlay.bar` with style `beastNotice`. This is the only place trig is allowed.
- `design/models/voxel_beast.js`: placeholder `boarPlaceholder` voxel model (~1.0 x 0.5 x 0.7 m), plus one `<script>` line in `game/index.html` (PC-B main session).
- `content/worlds/world_m1.world.json`:
  - world-level `"nav": {"area":{"x0":1400,"y0":928,"w":192,"h":192}, "cell":1, "maxSlopeDeg":30, "maxStepM":1, "blockedTypes":["water"], "seed":1}`;
  - 2 entities like `{"id":"boar1","type":"beast","x":..,"y":..,"z":"ground","components":{"voxel":{"anim":"idle","loop":true,"model":"boarPlaceholder"},"brain":{"kind":"beast","home":[x,y]},"targetable":{"radius":0.5,"height":0.7}}}`.
  - AC 6's `brain`/`home` go inside `components` because World only keeps components. `targetable` is for US-128.
- `tools/check-deps.mjs` + fixture: add `game/js/quest/sim/**` to the rule 15 scope.

**Sim API.** All numbers; zero allocation after create.
- SoA with `maxBeasts = 16`; slot = index in content order = steer slot.
- Fields: `state Uint8`; `timer Int32` (steps); `unseen Int32`; `repath Int32`; Float64 `homeX/homeY`, `fx/fy` (unit facing), `cdx/cdy` (charge dir), `goalX/goalY` (player position at the last path), `prevX/prevY`; `path Float64Array(16*64*2)`; `pathLen/pathIdx Int32`; `seen Uint8`; `pathReq Uint8`.
- Methods: `step(px, py, pz)` (player feet position), `hashInto(h)`, `save() -> plain object`, `load(obj)`, `stats {astar, astarNodes}`.
- One `createSteer({maxAgents:16, bounds: nav area})`.
- Hit: one preallocated `{source, target:'player', damage:1}` payload per slot, sent with `events.emit('combat:hit', payload)`. The bus is synchronous, so listeners must copy. There is no listener until US-080.

**Fixed-step order inside `step`** (called after `resolveBodyContacts`, before `updateTriggers`):
1. **Perception** per slot, from `d2` to the player:
   - If `tick % losEvery == slot % losEvery` and `d <= loseR`: `seen = canSee(beast z + eyeZ -> player z + targetZ)`, and `unseen = seen ? 0 : unseen + losEvery`.
   - Beyond `loseR`: `seen = 0`, no ray.
   - `noticed = (d <= noticeR && dot(f, dir) >= coneCos && seen) || d <= nearR`.
2. **Transitions** (table below); timers count down.
3. **Paths.** A slot sets `pathReq` when it enters chase/return/wander-walk, when `repath <= 0` and the player has moved > `repathMoveM` from `goal`, or when its path is used up.
   - **At most one `findPath` per tick** across all beasts: the lowest requesting slot after the last one served (round robin). `maxNodes 3000` (wander 500).
   - Then `smoothPath` into the slot's path and `repath = toSteps(repathSec)`.
4. **Steer targets:**
   - `setWaypoint(slot, wpX, wpY, 0.5)` toward the current waypoint; advance to the next one within 0.6 m.
   - `steer.maxSpeed[slot]` = the state's speed (0 in notice/windup/recover/pause).
   - Charge: waypoint `pos + cd*20`, `accel 70`.
5. `steer.step(SIM_STEP, grid)`. Steering never cuts corners and never enters a `cost 0` cell; that is what keeps beasts off drops and out of the tower footprint.
6. **Post:**
   - Charge wall check, from charge step 4 on: moved < `0.35*charge*STEP` on 2 steps in a row = wall.
   - Contact: `dist2D <= radius + PHYSICS.radius + 0.1` sends the hit.
   - Facing follows the velocity when speed > 0.1 (`sqrt` normalise); in notice/windup it faces the player.
   - `z` = the floor of `world.supportAt(x, y, prevZ + 0.6, true, ...)` (terrain/mesh). x/y/z are written into `transform`.

**States:**
| state | enter | per step | exit |
|---|---|---|---|
| wander | start / home reached | pause `rng.int(pauseMax-pauseMin steps + 1) + pauseMin steps`, then pick a point <= `wanderR` from home (rejection sampling in the square, <= 8 draws, walkable cell) and walk at 1.5 | `noticed` -> notice |
| notice | from wander/return | stop, face the player, `!` drawn | `noticeSec` -> chase |
| chase | notice / recover | path to the player at 4.5 | `d <= windupR && seen` -> windup; `d > loseR` or `unseen >= toSteps(5)` -> return |
| windup | | stop, face the player | `windupSec` -> charge, `cd` = unit(player - beast) at that tick |
| charge | | straight along `cd` at 7 | contact -> recover 1.0; wall -> recover 2.0; `chargeMaxSec` -> recover 1.0 |
| recover | | stop | timer -> chase (chase's lose checks apply on its first step) |
| return | | path home at `returnSpeed` | `noticed` -> notice; `<= homeArriveR` -> wander |

The RNG is drawn only in wander, in slot order. No `Math.random`, wall clock or trig (rule 15).

**Determinism + replay tests** (`beastSim.test.js`, Node, real world_m1 load like `game/js/quest/tower.test.js`):
1. Scripted player positions drive every transition: in cone, out of cone, behind the tower, > 20 m, hidden 5 s, wall hit, and contact (exactly one `combat:hit`).
2. 5 scripted chases from the far side of the tower reach contact within 30 s. The beast is never in a `cost 0` cell, and its z stays within 0.1 m of `supportAt`.
3. 600 steps with a scripted player path, run twice from a fresh load. The hash (`h.u32(tick)`, `rng.hashInto`, `steer.hash()`, `sim.hashInto`) is equal at every 60-step checkpoint and at the end.
4. `save()` at step 300, then `load` into a fresh sim: same hash at 600.
5. The RE-05c drop fixture through `buildFromArrays`.

Known limit (as in 28.2): LOS and z read `groundAt`, so replays are bit-equal for one world load, not across machines.

**Budget:** 8 beasts chasing, in Node: `step` mean <= 0.1 ms, p95 (ticks that run an A*) <= 0.3 ms. Zero allocation over 10k steps (`--expose-gc` heap check, as in the nav tests). Perf asserts are warn-only unless `PERF_STRICT=1`.

**main.js (PC-B main session: 7 lines, plus 1 line in index.html):**
1. `import { createBeastSim } from './quest/sim/beastSim.js';`
2. `import { presentBeasts } from './quest/beastView.js';` (and add `createRng` to the existing engine import).
3. At boot: `engine.overlay.setStyles(questOverlayStyles(assets.uiStyle));`. Placeholders live in `game/js/quest/overlayStyles.js`, keys `beastNotice, target, targetFade, targetBarFill, targetBarEmpty, targetNone`.
4. On world load/restart, next to `playerHandle`: `beasts = createBeastSim(engine.world, { nav: worldContent.nav, rng: createRng(worldContent.nav?.seed ?? 1), events: engine.events });`
5. In `update`, after `resolveBodyContacts`: `if (beasts) beasts.step(pt.x, pt.y, pt.z);`
6. In `render`, right before the RE-07 overlay flush: `engine.overlay.clear();`
7. Right after that: `if (beasts) presentBeasts(beasts, engine.world, engine.overlay, ovlStyles);`

**Do not:**
- add a brain hook or game rules to `engine/`;
- import `game/js/rts/`;
- run A* every step, or per beast per tick;
- use float timers;
- iterate `Map`s in the sim;
- let `beastView.js` write any sim state other than `yawDeg`.

### 29.2 US-128 Z-targeting (US-128a PC-A engine, US-128b PC-B game)

PO 2026-10-01: answers to 29 questions: all accepted - ring fade = 0.2 s dimmer `targetFade` colour (designer colour needed); no-target tick = two 1-cell `x` at crosshair +-2 cols, `targetNone`; locked mouse = 25 % into an offset clamped +-20 deg yaw / +-10 deg pitch, no decay (owner tunes at feel check).

**US-128a (PC-A, ~0.5 d, `engine/core/playerLook.js`, `engine/core/input.js` + tests -> arch-review).**
- The `PlayerLook` constructor `opts` gain `lockTurnDegPerSec = 360`, `lockMouseScale = 0.25`, `lockOffsetYawDeg = 20` and `lockOffsetPitchDeg = 10`.
- `look.setLockPoint(ex, ey, ez, tx, ty, tz)`: call every step while locked, **before** `update(dt)`.
  - `lockYaw = atan2(dx, -dy)` in degrees, wrapped to [0, 360). Compass: 0 = N = -y, clockwise. It must match Player's forward (asserted in the test).
  - `lockPitch = atan2(dz, sqrt(dx*dx + dy*dy))`.
  - The first call after a clear sets `lockActive = true` and resets the offsets to 0.
- `look.clearLock()` sets `lockActive = false`. `look.lockActive` is a read-only boolean.
- `update(dt)` while locked:
  - mouse/arrow deltas `* lockMouseScale` go into `offYaw/offPitch`, clamped to the offset limits;
  - aim = `lockYaw + offYaw`, `lockPitch + offPitch`;
  - yaw moves by the shortest signed delta in (-180, 180], clamped to `+-lockTurnDegPerSec*dt`;
  - pitch moves the same way, then the existing `pitchClampDeg` clamp applies.
  - Unlocked: no change.
- `Input`: add `KeyQ` and `Tab` to `GAME_KEYS` (Tab must not move focus). A `wheel` listener accumulates notches (`sign(deltaY)`); `consumeWheel() -> int`, no allocation.
- Tests (`playerLook.test.js`):
  - target 90 deg to the right: after 10 steps at `SIM_STEP` yaw has moved exactly 60 deg, after 15 steps exactly 90;
  - wrap across 0/360 takes the short way;
  - pitch stops at 70 with `pitchClampDeg 70`;
  - mouse at 25 %, with the offset clamp;
  - `clearLock` restores full mouse;
  - the yaw formula agrees with Player's forward vector for 8 compass points.

**US-128b (PC-B, ~1 d, after US-079a + US-128a): `game/js/quest/targeting.js` + test.**
`createTargeting(world, events, cfg)`. `cfg` defaults: `range 15, breakRange 20, losLostSec 1.0, fadeSec 0.2, noTargetSec 0.3, maxTargets 16, losEvery 6, hfovDeg HFOV_DEG`. Candidates are entities with `components.targetable {radius, height}`. They are kept in a preallocated array that is rebuilt at load and on `entity:added/removed` (events), never per step.
- **Selection (`Q` while unlocked):**
  - Eye = player x, y, z + eyeH. Forward = unit vector from look yaw/pitch (one `sin/cos` per step; this is the input side, not lockstep sim).
  - A candidate is valid if its 3D distance to its centre (`z + height/2`) is <= `range`, its horizontal yaw offset is <= `hfovDeg/2`, and it is alive (`health.hp > 0`, or no `health`).
  - Score = `1 - dot(forward, dir)` (closest to the screen centre). Valid candidates are insertion-sorted into an `Int32Array(16)` by (score, dist, list order).
  - `canSee` (29.1 `sight.js`) runs in that order; the first visible candidate wins.
  - None found: `noTargetT = noTargetSec`.
  - `Q` while locked unlocks (toggle).
- **Cycle** (`Tab` = right, `Shift+Tab` = left, wheel down = right, wheel up = left): use the signed yaw offset in (-180, 180] of the valid, visible candidates. Right = the smallest offset greater than the current one, else wrap to the smallest. Left is mirrored. The ring moves on the same step.
- **Each step while locked:**
  - Break if the entity is gone or `hp <= 0`, if the 3D distance is > `breakRange`, or if `lostSteps >= toSteps(losLostSec)`. `canSee` runs every `losEvery` steps: `lostSteps += losEvery` when hidden, 0 when seen.
  - Otherwise call `look.setLockPoint(eye..., target centre)`.
  - On break: `look.clearLock()`, and `fadeT = fadeSec` at the last position.
- **`present(overlay, ids)` (render):**
  - Locked: `overlay.ring(x, y, z, radius + 0.2, ids.target)` and `overlay.bar(x, y, z + height + 0.3, hpFrac, 5, ids.targetBarFill, ids.targetBarEmpty)`; `hpFrac = 1` without `health`.
  - Fading: the ring with `ids.targetFade` (the overlay has no alpha).
  - No target: two 1-cell `overlay.rect`s at the crosshair column +-2 with `ids.targetNone`.
- **Slopes and occlusion:** at boot, `engine.overlay.setGroundFn(groundFn)` with `groundFn = (x, y) => world.terrain.groundAt(x, y)`, created once (beasts are outdoors). Ring samples follow the slope (28.9 `OVL_RING_LIFT`). The 28.9 depth test hides them behind terrain and walls, the same as the RE-07 rings.
- **main.js (PC-B main session, 5 lines):**
  1. the import;
  2. create after the world load;
  3. in `update`, before `look.update(dt)`: `targeting.step(dt, input.pressed('KeyQ'), cycleDir(input), playerHandle.data, look)`, where `cycleDir` = Tab/Shift + `input.consumeWheel()`;
  4. in `render`, after `presentBeasts`: `targeting.present(engine.overlay, ovlStyles)`;
  5. `setGroundFn` at boot.
- **Tests** (`targeting.test.js`, fake world + stub look):
  - centre weighting beats a nearer but off-centre target;
  - the range 15 and break 20 edges;
  - a LOS-hidden candidate is skipped, and a hidden lock breaks after 60 steps, not after 54;
  - cycle order right/left with wrap;
  - a dead or removed target breaks the lock;
  - `noTargetT` is set;
  - the query for 16 entities takes <= 0.05 ms, with zero allocation over 10k steps;
  - `overlay.test.js` and the `rtsOverlay` gpucompare pose are unchanged.

**Do not:**
- turn the camera from game code (use `setLockPoint`);
- add a text or alpha op to the overlay for this;
- run `canSee` for every candidate every step;
- read targeting state from the beast sim (one-way: targeting reads entities).

## 30. M3 sword + health: US-078 view model + swing, US-080 HP/mana (architect, 2026-10-01)

Mesh-only per D-033 item 1 (`?renderer=mesh`; on `dda` the view model is a documented no-op, the swing/hit logic still runs). The engine gets one render layer (`engine.viewModel`), one world query (`world.raySegment`), one pure arc query and one overlay op. Everything else (swing rules, HP/mana, death) is game code under `game/js/quest/` (rule 15 for `sim/**`: no trig, no `Math.random`, integer step timers).

### 30.1 US-078 sword: view-model layer, queries, pickup, swing

**Owner question "no hand/glove, Wick never seen": OK.** A glove later is one more part of `swordHeld` (data only, no engine change).

**US-078a (PC-A, ~1 d, engine -> arch-review): `engine/render/viewModel.js` + both mesh twins.**
- Decision: **drawn in the same raster pass, after the scene items, after a depth-buffer-only clear**, with the scene's own M. It writes the G-buffer like any voxel prop (kind/mat/normal/objectId, DEPTH = true view distance), so shade, edge, fog, sprites (pass F) and the overlay depth test treat it as the nearest surface: lit by the scene lights + carried lamp, outlined by the edge pass, and it overdraws any wall closer than the blade ("never clips"). No new shader. **Both twins** (GPU `_passRaster`, JS `renderWorldMesh`): the JS twin is the `?gpu=0` fallback and the gpucompare oracle; the cost is one model. `def.depth.near` must be >= `PROJ_NEAR` (0.05, validated); `depth.far` is not used.
- **Eye -> world map (one helper; both twins + trail):** `fwd = (sinY, -cosY, 0)`, `right = (cosY, sinY, 0)` (as projection.js), `d = -pe.y`: `world = eye + pe.x*right + d*fwd + (pe.z + d*tanPitch)*up`. The `d*tanPitch` term cancels the first-person pitch shear, so the sword stays in the lower right at any pitch while its world point stays consistent with the shade pass's unprojection. `cam.projection === 'pitched'` = layer off.
- Per part: `M_world = Weye(cam) * T(pose.pos) * R(pose.rot) * FORWARD_part`, `FORWARD` from `computeVoxelPose(model, {x:0, y:0, z:0, yawDeg:0, clip 'held'})` (no second pose code); `R = Rz*Ry*Rx` = voxelPose's `setRot` (reuse it). Items: `DRAW_VOXEL`, `partFlags` axis-aligned bit 0, `objectId = VM_OBJECT_ID = 0xFFFF` (free: props use `0x8000|k` with k < MAX_VOX_INSTANCES 16, units >= 0x10000), `zBase = feet z`. Own `DrawList(8)`, not culled.
- GPU: after the scene draw loop, `gl.clear(gl.DEPTH_BUFFER_BIT)`, then the voxel draw loop over the vm list (factor the existing loop into one function). JS: new `clearRasterDepth(t)` (`t.zbuf.fill(1)` only) in rasterJS.js, then `rasterDrawList(vmList, target, ctx)`, before `copyToGBuffer`.
```js
/** @typedef {Object} ViewModelLayer   engine.viewModel (createEngine); fb.viewModel + pipeline.bindViewModel(vm)
 * @property {(key:string, def:Object, pool:VoxelPool)=>number} load   load time (review ruling 2026-10-01: a bound VoxelPool, not the registry - it needs the packed model + partNamesFor): validate the README 7.4 def, resolve def.model, pack clip keys into a Float64Array; throws on bad data; returns a handle
 * @property {(h:number, clip:string)=>number} clipId     @property {(h:number, mount:string)=>number} mountId
 * @property {(h:number, clip:number, tMs:number, blend:boolean)=>void} show   per rendered frame; blend = key 0 replaced by the captured pose (chain rule)
 * @property {()=>void} hide     @property {()=>void} capture   snapshot of the last shown pose = the blend source
 * @property {(phase:number, amount:number)=>void} setBob   def.bob numbers; phase = eyeFeel bobPhase, amount 0..1
 * @property {(h:number, clip:number, tMs:number, mount:number, out3:Float64Array)=>Float64Array} mountEye   pure: eye-space mount at a clip time (no bob)
 * @property {(cam:Object, pe:ArrayLike<number>, out3:Float64Array)=>Float64Array} eyeToWorld   the map above
 * @property {(cam:Object, pitched:boolean)=>(DrawList|null)} buildList   the list both twins draw (own DrawList(8)); null when hidden or pitched
 * @property {{visible:boolean, items:number}} stats */
```
Sampling is linear per component between keys (no easing); loop clips use `tMs mod last.t`, others clamp. Zero allocation after `load`.
- Tests (`engine/render/viewModel.test.js`): interpolation at key and mid times; loop wrap; blend replaces key 0 only; `eyeToWorld` at yaw 0/90/225 and pitch -30/0/+30 projects the rest anchor to the same cell (`projectPoint`); `mountEye(tip)` through `Weye` lands on the rastered tip (1 sub-cell); JS twin with a wall 0.2 m ahead: sword cells win; zero alloc over 1000 frames. gpucompare mesh pose `viewModel` (tower interior, rest + swingLR t=160, pitch 0 and +30): the usual mesh-pose bar; existing poses unchanged (layer hidden). Perf: JS pose + items <= 0.02 ms; GPU extra <= 0.1 ms p95 at 400x150; JS twin extra <= 0.4 ms at 240x90 (warn-only).
- Known limit: blade cells inside a wall may shade dark (light occlusion at that world point). Accepted for M3; if the owner sees it, a follow-up skips occlusion for `VM_OBJECT_ID` in shade.

**US-078b (PC-A, or PC-B cross-track, ~0.75 d, engine -> arch-review): queries + overlay op.**
- `meshCollide.js`: `raycastColliders(colliders, count, ox,oy,oz, dx,dy,dz, tMax, out) -> boolean` (enabled colliders, AABB slab reject, `bvh.raycast`, nearest). Physics stays stand-alone.
- `World.raySegment(ax,ay,az, bx,by,bz, out) -> boolean`, `out {t, x, y, z}`, t in 0..1. mesh: nearest of `raycastColliders` and a terrain march (`groundAt` every 0.1 m, <= 20 samples, then 6 bisections). grid: the `hasLineOfSight` sector sampling + the same bisection. Pure, zero alloc, <= 0.02 ms per 1.6 m ray.
- `engine/world/meleeArc.js` `arcHits(arc, cx, cy, cz, cr, ch, count, outIdx, outT) -> n`, `arc {ex, ey, zMin, zMax, ax, ay, bx, by, reach}` (a, b = unit slice edges, < 180 deg apart). Hit iff `[cz, cz+ch]` overlaps `[zMin, zMax]`, `dist2D - cr <= reach`, and the centre is inside the wedge widened by `cr` (signed edge distances >= -cr, and dot(mid, v) >= -cr). `outT = max(0, dist2D - cr)`; output sorted by (t, index). No trig, no alloc. Exported via `engine/index.js`.
- Overlay (28.9): new op `segment(x0,y0,z0, x1,y1,z1, style)` = the ring's segment rasteriser (4-glyph slope styles, ref lerped per cell); new style field `refPush` (m, default 0) added to the ref of every op of that style.
- Tests: ray vs a wall fixture (t, and a miss when short), vs a terrain slope, grid and mesh agree on the tower within 0.1 m; arc in/out angle, reach edge, z band, radius widening, order; segment cells 8-connected; `refPush 0.3` hides a mark against a fixture 0.2 m in front. `overlay.test.js` + `rtsOverlay` pose unchanged.

**US-078c (PC-B, ~0.5 d, game + content): pickup.** Copy the `levelPatch.towerSword` prop/interactable/decal entries into `content/levels/tower.level.json` (+ `node tools/content-canonical.test.mjs`). `game/js/quest/swordTake.js` `swordTake(ctx)`, registered as `sword.take` in `quest/index.js`: `world.removeEntity(ctx.entity.id)`, `world.state['tower.sword.taken'] = true`, and if the actor has `components.light`, `offset.right = -0.3`; `lanternTake` uses -0.3 when the flag is set (1 line). On `world:loaded`, remove the prop if the flag is set (state-only saves, US-089). "Has the sword" is that flag and nothing else. Tests: take -> flag + prop gone + light left, in either take order; a serialize/deserialize round trip keeps all three.

**US-078d (PC-B, ~1 d, game, after a/b/c): swing, hits, view.**
- `game/js/quest/swordConfig.js` (outside `sim/`, trig allowed): steps windup 5, active 7, recover 9 (21 = 0.35 s), chainStart 16 (270 ms), rest 15, hitStop 3, flash 6; reach 1.6; z band eye-1.0 .. eye+0.3; the 100 deg arc as 7 slices = 8 unit boundary vectors in the eye frame (LR left -> right, RL mirrored); speedScale 0.6.
- `game/js/quest/sim/sword.js` `createSwordSim(world, events, cfg, targetables)`, `step(player, fx, fy, attackPressed)` (fx/fy = the caller's unit forward via `forwardOf`). States idle/windup/active/recover/rest with integer step counters. A press counts only with `tower.sword.taken`, grounded and not blocking. A press during swing 1's recover queues swing 2 (opposite direction), started at `max(now+1, chainStart)` with `chainBlend` set (the view calls `capture`); a 3rd press is ignored; after swing 2 comes `rest`. While not idle: `body.speedScale *= 0.6` (runs after `resolveBodyContacts`, which resets it to 1 each step). Active step i: rotate slice i's edges by (fx, fy); one `world.raySegment` from (eye x/y, eye z - 0.35) along the slice centre over `reach` gives the world hit t_w; `arcHits`; each hit with `t < t_w`, not in `hitMask` and with a clear `raySegment(eye -> hit point)` is emitted. A world hit first: `clink` spark, the swing goes to recover, hit-stop freezes the counter for 3 steps. Seams: `canSwing()`, `cancel()`, `onBlockStart()/onBlockEnd()` (US-086). `hashInto(h)`; not saved (transient).
- Event (one channel, PO 2026-10-01): `events.emit('combat:hit', p)` with one preallocated `p {source:'player', target:id, damage:1, dirX, dirY, px, py, pz}` (numbers only; listeners copy). The AC's "hit sent to the target's behaviour" = that target's listener on this bus.
- Targetables: one preallocated SoA list of `components.targetable` entities, rebuilt at load and on `entity:added/removed`, shared with US-128b (`game/js/quest/sim/targetables.js`; extract it if 128b already has its own).
- `game/js/quest/swordView.js` `presentSword(sim, vm, overlay, cam, ids, simTime, feel)`: `vm.show(h, clip, tMs, blend)` (idle tMs from simTime); `setBob(phase, moving ? (swinging ? 0.4 : 1) : 0)`. Trail: `mountEye(tip)` at tMs, tMs-16.7 .. tMs-83 clamped to the active window, `eyeToWorld`, one `overlay.segment` per pair (styles trail0/1/2 by age + head; glyphs `"-|\\/"`, head `"=|\\/"`; `refPush 0.3` so the blade covers it); ghost `:` mid -> tip at -50 ms. Sparks from a 4-slot ring in the sim: `hit` = `bar` width 1 (`*`) first, then `bar` width 3 (`-`) (tie rule: first wins); `clink` = 1 cell. Palette keys -> RGB styles at load.
- `game/js/quest/practiceTarget.js`: listener; on its own id, voxel anim `flash` for 6 steps (designer clip, lamp-glint trick), then `idle`.
- Tests (`sim/sword.test.js`, 60 Hz): hit in arc; miss outside the angle, beyond reach, behind a wall; once per swing; chain LR -> RL step numbers, 3rd press ignored, rest 15; queue only in recover; no swing mid-air or before the flag; clink stops early; speedScale; 600-step replay hash equal twice; arc query for 16 entities <= 0.1 ms, zero alloc over 10k steps.
- **main.js (PC-B main session, 5 lines):** (1) imports; (2) boot: `swordVm = engine.viewModel.load('sword', assets.viewModels.sword, registry)` + trail/spark styles in the merged `setStyles`; (3) world load: `sword = createSwordSim(engine.world, engine.events, SWORD_CFG, targetables)`; (4) update, after `beasts.step`: `sword.step(playerHandle.data, fwd[0], fwd[1], input.pressed('Mouse0') && look.locked && !uiLocked && !ending)`; (5) render, after `targeting.present`: `presentSword(...)` (it calls `vm.hide()` while the flag is unset).
- **Do not:** pose the sword in game code (use `show`); add a second projection; use trig or float timers in `sim/`; emit a second hit event; allocate a payload per hit.

#### 30.1 amendment (D-034): light tap / hard hold-release (architect, 2026-10-02) - normative for US-078d

**Supersedes in US-078d above:** the LR -> RL chain (no `swingRL`; both lights use `swingLR` and the LR slice order), `attackPressed` (now `attackDown`), states windup/active/recover as top-level states. Everything else in US-078d stands (arc slices, `raySegment` world gate, `arcHits`, LOS check, hitMask, clink, targetables, view helpers, main.js lines, the "Do not" list). Still no engine change.

**Input (sim-side, integer steps).** `step(player, fx, fy, attackDown)`; main.js passes `attackDown = (input.isDown('Mouse0') || input.pressed('Mouse0')) && look.locked && !uiLocked && !ending` once per sim step (the `pressed` term keeps a sub-step tap). The sim derives edges itself from its own `prevDown` (hashed); a **press** = `attackDown && !prevDown`. Only a press starts anything: a button held through `rest`/`hard`/`recover` does nothing until released and pressed again. `holdSteps` counts steps with the button down since the press (saturates at 9999). Threshold `cfg.holdSteps = 24` (0.4 s).

**State machine** (`sword.state`, one `stateStep` counter, both hashed; 60 Hz):

| state | entered by | steps | hit window (stateStep) | speedScale x | exits |
|---|---|---|---|---|---|
| idle | - | - | - | 1 | press (allowed, see gate) -> hold |
| hold | press | 1..23 | none | 1 | release -> light; `holdSteps == 24` -> charge |
| charge | holdSteps 24 | unbounded | none | 0.3 | release -> `spendMana(4)` true -> hard, false -> light |
| light | release in hold, or mana-short release | windup 5, active 7, recover 9 = 21 (0.35 s) | 5..11 (slice i = stateStep-5) | 0.6 | end -> idle (chain 0), or rest if chain == 2; queued press -> see chain |
| hard | release in charge with mana | windup 4, active 7, recover 27 = 38 (0.633 s) | 4..10 (slice i = stateStep-4) | 0.3 | end -> idle, chain 0 |
| rest | end of the 2nd light | 15 | none | 0.6 | end -> idle, chain 0 |

- **Gate (press and every hold/charge step):** `tower.sword.taken`, grounded, not blocking. Leaving the ground, `onBlockStart()` or `cancel()` during hold/charge -> idle, no mana spent, no swing. A release while not grounded = cancel.
- **Chain (max 2 lights):** `chain` = lights in a row. A press in light #1's recover (stateStep 12..20) sets `queued`; presses in windup/active, in light #2, in hard, in rest are ignored. At `max(pressStep+1, chainStart 16)`: button already up -> light #2 (blend = true); still down -> hold, `holdSteps` keeps counting from the press (so a hard can follow a light; a hard resets chain to 0). Light #2 ends in rest 15. A light that ends with nothing queued -> idle, chain 0 (taps >= 21 steps apart are unlimited, as before).
- **Release during recover** (light or hard): nothing, unless it is the queued press of light #1 (above).
- **Hit-stop:** clink (world hit first, both swings) -> recover from the current step, `stateStep` frozen 3 steps. Entity hit: light 0, hard `hitStopHard 4` (freeze only, the swing continues). While frozen the view freezes tMs.
- `speedScale`: multiply `body.speedScale` (after `resolveBodyContacts`), never assign.

**Numbers live in data:** `game/js/quest/swordConfig.js` `SWORD_CFG` (one frozen object, seconds/ms in comments beside every step count, owner edits it at the feel check): `holdSteps 24, chainStart 16, rest 15, hitStop 3, hitStopHard 4, flash 6, light {windup 5, active 7, recover 9, damage 1, reach 1.6, speed 0.6}, hard {windup 4, active 7, recover 27, damageMul 3, reach 1.6, speed 0.3, mana 4, knock 3}` (`hard.speed` applies to charge and hard); arc slices shared. Beast-side numbers in `beastConfig.js` (seconds): `staggerSec 0.6, staggerKnock 4` (m/s). Test: the step windows match the clip windows in `ASSETS.viewModels.sword` within 1 step.

**Mana:** spent **once, on release** (the commit point, hit or miss) via the 30.2 API: `createSwordSim(world, events, cfg, targetables, hooks)` with `hooks.spendMana(n) -> boolean` (main.js passes `(n) => vitals.spendMana(n)`, built once at load; no hook = hard is free, for tests). `false` -> a light swing instead (counts as chain +1; `spendMana` already sets `manaFlashTick`, the HUD flash is the feedback). Never checked or spent during charge.

**Hits:** payload gains one number field: `p {source:'player', target, damage, heavy, dirX, dirY, px, py, pz}`, `heavy` 0|1, `damage` = light.damage or light.damage * hard.damageMul (3), `dirX/dirY` = unit 2D (target - player), fallback (fx, fy). Still one preallocated object, one channel. Once per target per swing (hitMask), both swings.
- **Knockback, generic (sword sim, heavy only):** a target with `components.body` gets `applyImpulse(body, t.z, dirX*hard.knock, dirY*hard.knock, 0)` (engine export, US-136). Beasts have no body (position is the steer SoA), so they are skipped here and handled by their own listener; the practice target has neither (flash only).
- **Stagger (beastSim, heavy only):** `beastSim` registers one `combat:hit` listener at create (ids -> slot via a prebuilt object lookup, no Map iteration). On `p.heavy && slot found`: new `STATE_STAGGER = 7`, `timer = staggerSteps (36)`, `steer.vx/vy = dir * staggerKnock` (assign, not add), `accel = DEFAULT_ACCEL`. Enters from **any** state; it interrupts windup and charge (charge contact damage is impossible while staggered), and the charge wall counter is cleared. In `setSteerTarget`: waypoint = own position, arrive 0, `maxSpeed = staggerKnock` (so the steer clamp keeps the shove; it decays by accel 12, ~0.67 m slide). Facing frozen. At timer 0: `seen` -> chase, else return. Light hits: no beast-side effect in 078d (beast HP/hurt = US-079 proper). `resetAll` clears stagger; save/hash already cover `state`/`timer`.
- Listener order: the sword steps after `beasts.step`, so the stagger acts from the next beast step. Deterministic (synchronous emit).

**View (`swordView.js`)**, clip per state: idle/rest -> `idle`; hold + charge -> `charge` with tMs = (steps since entering hold) * 1000/60 (blend true when entered from a light at chainStart); light -> `swingLR` (blend on light #2); hard -> `swingHard` (blend true: key 0 = the captured charge pose). `setBob` amount: charge/hard 0.2, light 0.4. Hard swings use `trailHard` and spark `hitHeavy`; clink shared. When `holdSteps` reaches 24 and `mana.mp >= hard.mana`, one `chargeGlint` at the tip (presentation only, reads `mana` at render; no glint = this will be a light).

**Designer must deliver (in `design/models/sword.js`, `ASSETS.viewModels.sword`):**
1. `clips.charge` - `loop:false`, keys from REST (t 0) to the cocked hold pose at **t 400 ms**, clamped after (the pose is held while charging); short taps show only its first keys as anticipation, so the first ~100 ms must read as a small pull-back.
2. `clips.swingHard` - `loop:false`, same left -> right motion as `swingLR` but bigger/slower follow-through, windows `windup [0, 67]`, `active [67, 183]`, `recover [183, 633]`, key 0 = the charge end pose, `leadEdge '+x'`.
3. `trailHard` (same schema as `trail`; heavier: e.g. more samples / heavier head glyphs / hotter colours) and `sparks.hitHeavy` (bigger than `hit`, e.g. 5 cells, 3 frames <= 150 ms) and `sparks.chargeGlint` (1 cell at the tip, <= 100 ms).
4. Drop `swingRL`; `chain` becomes `{max:2, queueDuring:'recover', restMs:250, startAtMs:270, blendMs:80}` (no `order`). Update the preview page to show tap and hold.

**Save / hash:** the sword sim is transient (not saved; load = idle, chain 0). `hashInto(h)`: state, stateStep, holdSteps, prevDown, chain, queued, pressStep, frozen, hitMask, spark ring. Beast stagger: in the existing beast hash/save (state + timer + steer).

**Tests (`sim/sword.test.js`, + beastSim):** tap (down 1 step, 6 steps, 23 steps) -> light; 24 -> charge, release -> hard; hard with mp 3 -> light + `manaFlashTick` set, mp unchanged; mp spent once on release, also on a miss; L, queued L -> rest 15, 3rd press ignored; L then queued hold -> hard (chain reset); press held through rest does not start a swing; release in recover ignored; jump / block during charge cancels, no mana; speedScale 1 / 0.3 / 0.6 / 0.3 per state (multiplied); hit windows at the exact steps; `heavy` and `damage 3` in the payload; body target gets `applyImpulse`; beastSim: heavy hit in windup and in charge -> stagger 36 steps, no contact hit during it, displaced ~0.6-0.7 m, then chase; light hit -> no stagger; clink freezes 3, hard entity hit freezes 4; config windows vs clip windows; 600-step replay (with tap + hold input) hash equal twice; zero alloc over 10k steps.

### 30.2 US-080 HP + mana, damage, death/respawn (all PC-B game; no engine step)

**Decision: `health`/`mana` are game components, not an engine module** (same reason as the beast brain, 29.1: the rules are game rules; an engine combat layer waits for a second game). Convention, documented for reuse: `components.health {hp, max, invuln}` and `components.mana {mp, max, regen, pause}` - integers, timers in steps, serialized with the entity (no `serialize.js` change). US-128b reads `health.hp/max` for its bar. The row's "PC-A health component" falls away; content/game only, so no arch-review (the PO reviews).

**US-080a1 (PC-B, ~0.6 d): vitals sim + tests.** `game/js/quest/sim/vitals.js` `createVitals(world, events, cfg, hooks)`, `hooks {beasts, targeting}` (null-safe). Config `game/js/quest/vitalsConfig.js`: start 30/30, invuln 60 steps, beast `damageScale 5` (by `source !== 'player'`), falls `> 6 m -> 5`, `> 10 m -> 10`, knockback 2 m/s, sink 48 steps, fade 90 steps.
- Listener on `combat:hit`: if `p.target === 'player'`, copy the numbers and `applyDamage(n, dirX, dirY)`. Falls: on `body.landed`, by `body.fallDistance` (integrate.js), same function. `applyDamage`: no-op while `invuln > 0` or dead (dev invulnerable: flag); `hp = max(0, hp - n)`; `invuln = 60`; `body.vx/vy += 2 * unit(player - source)` once (the accel ramp decays it; the owner tunes); record `hurtTick` for the view. Source position: `world.get(p.source).transform`, else no knockback.
- `step(player, usePressed)`: `invuln--`; at `hp == 0`, `dead = true` and the death timeline runs (`deathStep++`: sink, then fade, then `cardReady`). `cardReady && usePressed` -> `respawn()`.
- `respawn()`: transform from `world.state['save.x'/'save.y'/'save.z'/'save.yaw']` (flat keys; set by the relay wake in `beacon.js`, 1 line; default = the world's player spawn), body `vx/vy/vz = 0`, `hp = max`, `mp = max`, `invuln = 60`, `hooks.beasts.resetAll()` (new small method in `beastSim.js`: every slot back to home, state wander, timers/paths cleared, `steer` positions reset), `hooks.targeting.clear()`. World flags are untouched (no deserialize).
- Read-outs for the view: `dead`, `deathStep`, `cardReady`, `hurtTick`, `eyeH()` (`undefined` while alive; lerp eyeH -> 0.4 over the sink) and `inputLocked`. `hashInto(h)`.
- Dev (`?debug=1`, game side): one key toggles `godMode`, one calls `applyDamage(5)` (pick keys free in `GAME_KEYS`, add them if missing; list them in the F3 help).
- Tests (`sim/vitals.test.js`): one hit = 5 HP, a 2nd within 60 steps ignored and at step 60 applied; falls 5.9/6.1/10.1 m; death timeline step numbers; respawn: flags kept (sword, lantern, lever), HP + MP full, beasts at home (stub), position = the save point; serialize round trip of `health` (+ `mana` in 080b); deterministic replay hash.

**US-080a2 (PC-B, ~0.5 d, after a1 + designer HUD art): presentation.** `game/js/quest/vitalsView.js`:
- `drawVitals(ui, world, style, simTime, visible)` on `engine.ui` (UI grid 160x60, so it reads the same at 160x60 and 240x90): bar 20 cells top-left + `hp/max`; red pulse at 1 Hz when `hp <= 25 %` (simTime, presentation only); hidden on title/map/end/death cards (`visible` from the caller).
- Hurt: a screen-edge frame on the UI layer for 0.15 s after `hurtTick` (designer style `vitals.hurtEdge`), and a 2 deg pitch kick on the render eye only (`kickDeg(simTime)`, decays over 0.15 s; never written to `look`).
- Death: `applySceneFade` with the end-card LUT driven by `deathStep`; the card through the existing panel/richText (writer text), `[E] Wake again`.
- **main.js (PC-B main session, 6 lines):** (1) imports; (2) world load: `vitals = createVitals(engine.world, engine.events, VITALS_CFG, { beasts, targeting })`; (3) update, right after `resolveBodyContacts`: `vitals.step(playerHandle.data, input.pressed('KeyE'))`; (4) the existing `uiLocked = ...` line gains `|| vitals.inputLocked`; (5) render eye: `Camera.fromEntityInto(playerHandle.data, vitals.eyeH(), renderEye, pitchClampDeg)` and `cam.pitchDeg += kickDeg(vitals, simTime)`; (6) HUD: `drawVitals(...)` next to the hints draw, plus the death fade/card in the same block as the end card.

**US-080b (PC-B, ~0.5 d): mana + pickups.**
- `mana` component on the player at load; in `vitals.step`: `pause > 0 ? pause-- : (++regen >= 120 -> mp = min(max, mp + 1), regen = 0)`; `spendMana(n)` returns false + sets `manaFlashTick` when short, else `mp -= n`, `pause = 180`. The second bar (blue) is in `drawVitals`.
- Pickups: `game/js/quest/sim/pickups.js` `spawnDrop(world, kind, x, y, z)` adds an entity `{components: {pickup {kind:'hp'|'mp', amount:10, life:1200}, voxel|sprite: designer model}}`; `stepPickups(world, player)`: `life--` (despawn at 0), collect at 3D distance <= 0.8 m (`hp/mp = min(max, +10)`). The bob (z offset) and the last-180-step blink are view-only (`presentPickups`, no sim state). US-079's death calls `spawnDrop` on `rng.int(2) === 0` (its own seeded RNG, slot order). Candidate list preallocated (<= 16 drops; more = the oldest despawns).
- main.js: 2 lines (`stepPickups` after `vitals.step`; `presentPickups` in render).
- Tests: regen 1 per 120 steps; pause 180 after spend; spend short = false; collect radius 0.79/0.81 m; despawn at step 1200; save round trip of `mana` + live drops.

**Budget (all of 30.2):** vitals + 16 pickups step <= 0.02 ms, zero allocation per step (one preallocated hit-copy; no closures in `step`). **Do not:** put HP/mana rules or `damageScale` in `engine/`; respawn through `deserialize(initialState)` (it would reset flags); write the camera kick into `look`; use float timers or `Math.random`.

## 31. ED-MESH-1 editor viewport on the mesh renderer (architect, 2026-10-01; PC-B tools, ends in arch-review)

Goal: `tools/editor/index.html?renderer=mesh` renders through `GpuCellPipeline({renderer:'mesh'})`, so `voxel.meshOnly` models (ME-22, >32/axis, e.g. design/vox/tools/*.vox 21x21x60) are visible, pickable and movable while editing. Mirror game/js/main.js ~262-380 + 638-644. The frame sequence gets nothing new.

**31.1 Renderer choice.** One pure function in frame.js: `editorRenderer(params, defaultRenderer)` -> `'mesh'|'dda'` (`?renderer=mesh|dda` wins, else the default). The default is a new engine constant `DEFAULT_RENDERER = 'dda'` (engine/index.js). ME-12b flips it to `'mesh'`, and game main.js and the editor both read it, so the editor follows without an editor change. `createFrame({engine, assets, rt, gpuParam, renderer})` passes `renderer` (and `shadows: engine.shadows`) to `new GpuCellPipeline`. **Effective renderer:** `eff = renderer === 'mesh' && gpuPipeline ? 'mesh' : 'dda'` (the CPU `?gpu=0` path stays dda/shear). `frame.renderer = eff` is the only thing other editor modules read. Set `voxelPool.renderer`, the sprite pool's `renderer` (sprites.js `pool.renderer`) and, if `engine.instances` exists, `engine.instances.bindPool(voxelPool)` + `gpuPipeline.bindInstances(engine.instances)`, exactly like main.js. No `GpuOverlayPass` (the editor draws its overlay into rt cells).

**31.2 Engine exports.** The editor may import only engine/index.js. engine/dev.js is forbidden for tools/editor/**. Already public: `GpuCellPipeline`, `VoxelPool`, `resolveProjection`, `createPitchedTerms`, `pitchedTerms`, `screenRay`, `unprojectPitched`, `worldToCell`, `PITCH_CLAMP_PITCHED_DEG`. Missing (step 1a):
1. `DEFAULT_RENDERER`.
2. `prebuildTerrainMesh(terrain)`: move it from game/js/dev/terrainPrebuild.js into engine/mesh/terrainMesh.js and export it. The game helper becomes a re-export.
3. `LevelMeshCache.get` rebuilds when `entry.level !== structure.level`. Today it keys only by `structure.id` + `packed.version`. After the editor's `rebuild()` (= `World.load` + `setWorld`), a new structure with the same id and an equal version would draw the OLD mesh.
4. `World.load(def, assets, {terrain})` reuses the passed Terrain when `terrain.def === assets.terrain(def.terrain)`. Then a prop edit no longer re-bakes the far field + terrain mesh (seconds) every time.

**31.3 Live edits -> mesh state.** The editor keeps no cache bookkeeping of its own:
- Prop/light move, nudge, yaw, add, remove (`patchLive` or `rebuild`): nothing to invalidate. Voxel instances are collected per frame from entities (`voxelPool.collect`), and voxel meshes are cached per packed model (`sharedVoxelMeshCache`, a WeakMap). Lights are unchanged (`frame.lightSet`).
- Structure edits via `rebuild()`: handled by 31.2 item 3. Cost: one `buildLevelMesh` per placed structure per rebuild. Budget <= 30 ms for world_m1 on mesh (measured in 1d). If it is over, ASK ARCHITECT with the number (fallback: key the cache by level-def identity).
- Terrain: the `world:loaded` handler runs `bakeFarSync()` + `prebuildTerrainMesh()` when `eff === 'mesh'`. It runs once per Terrain, and with 31.2 item 4 only at boot. Terrain editing is out of scope (the editor has none).
- Runtime `.vox` import (BUG-ED-VOX-1 path): keep `frame.voxelPool.bind(assets, matTable)` + `markDirty()`. On mesh, meshOnly models need no atlas: the mesh is built lazily on first draw (log line "VoxelMeshCache: ... ms"). Show the "mesh-only, not drawn here" import flash only when `frame.renderer !== 'mesh'`.
- Debounce: drag-move already commits once, on release. Arrow-key repeats that reach `rebuild()` coalesce to one rebuild per animation frame (a `pendingRebuild` flag consumed in the frame loop). `patchLive` stays immediate.

**31.4 Picking/selection.** `pickAt` is NOT pure CPU. It reads the GPU G-buffer (`readbackGeometry()`: GI planeId/kind + Depth), then unprojects with the shear `unprojectCell`/`rayPoint`. On mesh:
- (a) The planeId encodings are the same family (`DrawList` levels `(structSeq&7)<<28`, voxels `(slot&0xF)<<24`). Keep `decodePlaneId` and add a Node test against the `DrawList`/`addVoxelInstances` outputs.
- (b) Depth on mesh is SDEPTH = `vd` (28.1 RE-02). The world point is `unprojectPitched(terms, col, row, vd)`, the click ray is `screenRay(terms, col, row)`, and marker/highlight/hover projection uses `worldToCell`. ray.js gets a projection switch via `resolveProjection(cam, frame.renderer)`. The shear functions are untouched.
- (c) Voxel slot: `k` in `addVoxelInstances` must index the same array pick.js reads (check `voxelPool.list` against the mesh-path list that includes meshOnly, and expose the right one). With more than 16 instances the 4-bit slot aliases. So accept a slot hit only if the hit point lies inside that instance's `rect` AABB (+0.05 m). Otherwise fall through to `rayPickEntities` (ray-cylinder, already CPU from world data).
- Camera: the pitch clamp is `PITCH_CLAMP_PITCHED_DEG` on mesh and 35 on dda. camera.js takes the clamp as a parameter.

**31.5 Thumbnails.** thumbnails.js is pure CPU from the model def and does not depend on the renderer. Add one Node case: a 21x21x60 model yields <= 16x8 cells.

**31.6 Out of scope.** Terrain editing; a UI toggle for mesh shadows (`?shadows=map` passes through); GPU id-buffer picking; LOD tuning; removing the dda path from the editor (ME-19); WebGPU.

**31.7 Steps** (each ends in arch-review):
- **ED-MESH-1a (PC-A engine; PC-B may take it cross-track)**: 31.2 items 1-4. ACs: (1) `DEFAULT_RENDERER` is exported and game main.js reads it (behaviour unchanged); (2) `prebuildTerrainMesh` is exported from engine/index.js, the game/js/dev helper delegates to it, rts-test and `?renderer=mesh` boot unchanged; (3) Node test: LevelMeshCache returns a NEW set after a second `World.load` of an edited level with an equal `packed.version`; (4) Node test: `World.load` with `{terrain}` of the same def reuses it (`w.terrain === prev`), a different def builds a new one; (5) all suites + check-deps green.
- **ED-MESH-1b (PC-B tools, after 1a)**: 31.1 + the 31.3 terrain prebuild. ACs: (1) `editorRenderer` Node test (param mesh/dda/absent x default); (2) `createFrame` passes the renderer, sets the pool/sprite renderer, and `frame.renderer` = eff (`?gpu=0` -> 'dda'); (3) `?renderer=mesh` boots world_m1 with the ground visible on frame 1 and the tower drawn; (4) the default URL renders exactly as before; (5) pitch clamp per renderer.
- **ED-MESH-1c (PC-B tools, after 1b)**: 31.4. ACs: (1) ray.js pitched branch, Node round trip `worldToCell(unprojectPitched(c,r,vd))` through the editor helpers <= 1e-6 cells; (2) decodePlaneId Node test against the DrawList/voxelMesh encodings; (3) slot-alias guard Node test (17 instances, slot 1 vs 17 -> correct entity or ray-cylinder fallback); (4) on mesh: clicking a tower wall gives `surface` with the right cell, clicking terrain gives a point within 0.1 m of `groundAt`, clicking a meshOnly prop gives `entity`; (5) dda behaviour unchanged (existing ray/pick tests pass).
- **ED-MESH-1d (PC-B tools, after 1c)**: 31.3 edits/perf + 31.5 + the headless check. ACs: (1) rebuild-coalescing Node test (5 nudges in one frame -> 1 rebuild); (2) `rebuild()` ms on mesh is logged and is <= 30 ms for world_m1 (else ASK ARCHITECT); (3) 21x21x60 thumbnail Node case; (4) a CDP script in the style of `tools/capture-browser.mjs` (fresh port 95xx) opens the editor with `?renderer=mesh`, imports a design/vox/tools model and places it. The screenshot shows non-sky cells at its projected rect, and after an arrow-key move the rect moves; (5) import flash text per 31.3.

Budget: frame cost = the game's mesh path, with no extra per-frame editor cost. frame.js/pick.js add zero per-frame allocation (pick is click-only and may allocate). **Do not:** import engine/dev.js or deep engine/mesh/* paths from tools/editor; reach into `gpuPipeline._levelMeshCache`; re-bake terrain on every edit; change the shear code paths.

**31 amendment 1 (ED-MESH-1a/b review, 2026-10-01).**
- 31.2 item 4: the Terrain field is `terrain.recipe` (not `.def`); the code is normative.
- 31.2 item 3 is only half done until the GPU side follows: `buildLevelMesh` names meshes `level:<name>[#tag]` with `meshVersion = 1`, so `MeshBuffers.get` (keyed by `mesh.id` + `meshVersion`) hands a rebuilt set the OLD vertex buffer. Rule: a MeshBuffers entry also stores the `mesh` object and is re-uploaded (old buffers disposed) when `entry.mesh !== mesh`; same for `getVoxel`. Never rely on id+version alone across rebuilds.
- Editor `rebuild()` passes `{events, terrain: engine.world && engine.world.terrain}` to `World.load` (31.3 "only at boot" depends on it). The 303 ms measured without it was a fresh Terrain + far bake + terrain-mesh prebuild per edit.
- Rebuild budget stays <= 30 ms for world_m1 on mesh, measured as `rebuild()` + the first frame's `LevelMeshCache` rebuilds (log both). 1d keeps the `World.load` + `setWorld` rebuild (no incremental world patching in the editor). Caches kept across a rebuild: the Terrain and its terrain mesh set (via the reuse above), `sharedVoxelMeshCache` (per packed model), and LevelMeshCache for unchanged Level objects. If it is still over 30 ms after the terrain fix: ASK ARCHITECT with the split (World.load ms / buildLevelMesh ms per structure). The fallback is to reuse the Level object for unchanged structure defs, not cache bookkeeping in the editor.
- MAX_VOX_INSTANCES (16) is the dda atlas/VOXINST limit, but `VoxelPool.collect` applies it on both renderers, and `addVoxelInstances` walks `pool.list`. So the mesh path really draws only the nearest 16 today, in the game as well. This is accepted for ED-MESH-1 (the warning is expected on world_m1). A per-renderer cap for mesh (e.g. 64, objectId `0x8000|k` stays < 0x10000, the 4-bit planeId slot aliases and is covered by the 31.4(c) AABB guard) is a separate PC-A engine story, not 1c/1d.

**31 amendment 2 (ED-MESH-1c/d review, 2026-10-01).**
- 31.4(b): the mesh pick depth and ray are exact (the Node round trip matches the engine twins). Far-terrain hits 1-10 m above `groundAt` are expected, not a projection bug. The terrain mesh draws `hDraw` (forest canopy +10 m, `recipe.forest.canopy`) and coarse far-LOD triangles, while `groundAt` is the bare near-band ground. 1c AC4 "within 0.1 m of `groundAt`" is measured on non-forest near-band terrain only. Rule: a `terrain`-kind pick is a surface point, not a ground point. Any consumer that wants ground (placing a world prop, drop-to-ground) uses the hit's (x, y) with `z = terrain.groundAt(x, y)`. Today `defaultWorldPropItem` uses raw `pt.z`, the same on dda. This is a small follow-up PC-B row, not part of 1c.
- 31.3 near-band skip: `nearBandKey` must cover everything `structureBlend` reads: per structure `id`, `bbox`, the **`origin` x/y/z that `ringHAt`/`gridLocal` read** (not `frame.z`; the two are equal only while `yawSteps = 0`), `yawSteps`, and the outer-ring `floorH`. Recipe-side inputs (stamps, blend, canopy) are covered by the `opts.terrain.recipe === recipe` reuse test, because the editor never mutates a recipe. If terrain editing arrives (31.6 out of scope), it must clear `terrain.nearReady` or bump the key.
- An outer-ring `floorH` edit re-bakes the full band (~286 ms). This is accepted: it is rare and one-shot. The fix, if it ever matters, is a rect-limited re-bake (`Terrain.rebakeNearRect(bbox expanded by st.blend)`), not more key granularity.
- Undo/redo stay immediate, but they go through the scheduler (`rebuildSched.flushNow()`), never `rebuild()` directly. Then a pending coalesced request is consumed, not run a second time on the next frame.

## 32. EP-ELEMENTS: particles, water, fire, explosions, wind, fog (architect, 2026-10-01)

Notes for the rows flagged `NEEDS PC-A: architect note` in the epic header (backlog "Epic EP-ELEMENTS"): US-053a+b, US-055a, US-132+133, US-136, US-138, US-139. US-053c, US-055b, US-134, US-135, US-137 and US-140 get no note of their own; the seams they use are defined here. AC changes for the PO are collected in 32.8.

### 32.0 Cross-cutting decisions

1. **Module homes.**
   - `engine/fx/` (new) holds the particle **sim** only. It is a leaf like `engine/nav/`: it imports only `engine/fx/**` and `engine/core/**`.
   - The particle **draw** goes in `engine/render/particleLayer.js`, and render reads fx arrays.
   - World-data sims and queries go in `engine/world/`: `fireGrid.js`, `wind.js`, `explosion.js`, `entityEmitters.js`, and the water regions inside `World.js`.
   - The capsule impulse goes in `engine/physics/impulse.js`. It imports nothing and touches only `body` fields, so it complies with 27.10 (physics stand-alone).
   - Particles never read physics. fx never imports world, physics or render. The world and its fields reach fx as duck-typed arguments (`sampleInto(...)`), the same way nav receives World (28.2).
2. **check-deps (lands with US-053a, PC-A, + fixture case in `tools/check-deps.test.mjs`).**
   - **New rule 16:** non-test `engine/fx/**` may import only `engine/fx/**` and `engine/core/**`. fx tests may also import `engine/test/**`. Any import that resolves into `engine/fx/` is allowed from render/world/ui/mesh (one-way).
   - **Rule 15 scope** (WARN; no trig, no `Math.random`, no wall clock) grows by `engine/fx/particles.js`, `engine/world/fireGrid.js` and `engine/world/wind.js` (exact files, not folders). Load-time compile files (`engine/fx/emitterDef.js`) stay out of scope and may use `Math.tan`.
   - Rule 13 (coord math) applies as usual. Use `forwardOf/rightOf` from `core/transform.js`.
3. **Renderer scope (D-033).**
   - Water (055a), fire view (134) and fog (139) are **mesh-only**. On `dda` they are documented no-ops; the sim and queries still run.
   - Particles go through the sprite pass, which runs on both renderers, so they work on `dda` at no extra cost.
4. **Determinism (all new sims).**
   - Fixed step (`STEP` from `core/loop.js`).
   - Integer step timers.
   - Iteration by slot or cell index; never `Map`/`Set` iteration in a step.
   - Zero allocation after create.
   - `hashInto(h)` on every sim.
   - **RNG streams (28.5):** each sim owns its own `createRng(seed)` stream. Particles use a presentation stream. The fire grid has its own stream (seed from content), so adding a beast never changes a fire. Nothing draws from the beast stream.
5. **Events (zero-alloc rule vs `Events.emit`).** `Events.emit` allocates (`Array.from` of the listener set). Per-cell or per-particle bus events are therefore **not allowed**.
   - Sims expose typed change lists that are valid until their next step (fire: `changes/changeCount`).
   - The bus is used only for rare, game-relevant facts, with one preallocated payload per channel. Listeners copy the payload (the 29.1/30.1 convention).
6. **Content homes.**
   - World/level JSON gains optional blocks `water`, `fire`, `wind`, `fog`. All are validated at load, throw with the offending id, and are content, not state (same as `bounds`/`horizon`).
   - Level-local coordinates go through the structure frame at load (`localToWorld`, the 90-degree `yawSteps` only).
   - Designer data (particle presets, fire materials) are classic scripts in `design/`. `main.js` exposes them as `assets.particles` / `assets.fireMaterials`, the way `assets.palette` and `assets.uiStyle` work, not as new AssetRegistry kinds. The engine receives already-resolved numbers and never reads `design/` or palette keys.

### 32.1 US-053a particle sim + US-053b particle draw

**US-053a (PC-A, ~1 d, engine -> arch-review). Files:** `engine/fx/particles.js`, `engine/fx/emitterDef.js`, `engine/world/entityEmitters.js` + tests. Owned as `engine.particles` (createEngine option `particles: {capacity, seed}`).
- **Pool size: 2048 slots** (PO proposed 2000; rounded to a power of two to match `MAX_INSTANCES_PER_FRAME 2048` in `mesh/instances.js`). Other limits: `MAX_EMITTERS 64` (persistent + transient), `MAX_PARTICLE_DEFS 32`, ramps <= 16 entries.
- **Memory:** about 160 KB (Float64 SoA, the same convention as `beastSim`/`instances`).
- **SoA per slot:**
  - `px,py,pz, vx,vy,vz, kz` (Float64; `kz` = kill-plane z, `-Infinity` when off);
  - `age, life` (Int32, steps);
  - `def` (Uint8);
  - `em` (Int16, emitter slot);
  - `alive` (Uint8).
- Allocation is a **ring head** (`head = (head + 1) % cap`). The slot under the head is always the oldest spawn, so "recycle the oldest when full" is O(1) and needs no search. `stats.recycled++` counts each overwritten live slot.
- **EmitterDef** (content, JSON-able; `defineEmitter` validates and throws per key):
```js
/** @typedef {Object} EmitterDef
 * @property {number} [rate=0]        particles/s while on (0 = burst only)
 * @property {number} [burst=0]       default count for burst()
 * @property {[number,number]} life   s, uniform in [min,max]
 * @property {[number,number]} speed  m/s along the cone
 * @property {[number,number,number]} [dir=[0,0,1]]  cone axis (normalised at define)
 * @property {number} [spreadDeg=0]   cone half-angle, < 89
 * @property {[number,number,number]} [box=[0,0,0]]  spawn jitter half-extents, m
 * @property {number} [accelZ=0]      m/s^2: + buoyancy (smoke 0.6), - gravity (sparks -9.8)
 * @property {number} [drag=0]        1/s, pulls velocity toward the wind velocity
 * @property {number} [wind=0]        0..1 share of the emitter's wind vector
 * @property {number} [maxLive=64]    per emitter
 * @property {number|null} [killBelow=null]  m below the spawn z where a particle dies (floor kill-plane)
 * @property {string} glyphs          ramp over life, e.g. "@Oo. " (' ' = invisible step)
 * @property {number[][]} colors      ramp over life, [r,g,b] bytes - resolved from palette keys by the CALLER
 * @property {boolean} [emissive=false]
 * @property {number} [emissiveFog=0] fog share for emissive particles (0 = unfogged, like sprites' fogMax) */
```
- **Define-time compile (`emitterDef.js`, may allocate):**
  - converts seconds to integer steps (`Math.round(s / STEP)`, min 1);
  - computes `dragK = min(1, drag*STEP)`;
  - computes `spreadTan`;
  - builds an orthonormal basis (a, b) of `dir`;
  - copies glyph codes and colours into the def table (`Float64Array` record + `Uint8Array` ramps).
- **API** (all numbers; zero allocation after create; handles are ints):
```js
/** @typedef {Object} ParticleSystem   engine.particles
 * @property {(key:string, def:EmitterDef)=>number} defineEmitter      load time; returns defId
 * @property {(defId:number, x:number, y:number, z:number)=>number} createEmitter  -1 if no free slot (stats.dropped++)
 * @property {(h:number, x:number, y:number, z:number)=>void} setEmitterPos
 * @property {(h:number, dx:number, dy:number, dz:number)=>void} setEmitterDir   optional cone override (sword sparks along the hit normal)
 * @property {(h:number, on:boolean)=>void} setOn
 * @property {(h:number, n?:number)=>void} burst
 * @property {(h:number)=>void} release      stop now, free the slot when its last particle dies
 * @property {(defId:number, x:number, y:number, z:number, n:number, dx?:number, dy?:number, dz?:number)=>void} burstAt   one-shot: takes a transient emitter slot, auto-released
 * @property {(wx:number, wy:number, wz:number)=>void} setWind            global wind (053a input)
 * @property {(h:number, wx:number, wy:number, wz:number)=>void} setEmitterWind  per-emitter override (US-138 fills it)
 * @property {(field:any, tick:number)=>void} sampleWind   US-138: per live emitter, field.sampleInto(ex,ey,ez,tick,scratch) -> emitter wind (duck-typed, no world import)
 * @property {()=>void} step                 one fixed step
 * @property {()=>void} clear                world load / restart
 * @property {(h:any)=>void} hashInto
 * @property {number} cap
 * @property {Float64Array} px  (read-only SoA for the draw: px,py,pz,age,life,def,em,alive and the def/emitter tables)
 * @property {{live:number, spawned:number, recycled:number, dropped:number}} stats */
```
- **`step()` order** (slot order 0..cap-1, then emitter order 0..MAX_EMITTERS-1):
  1. **Integrate each live slot:**
     - `age++`; when `age >= life`, kill it (`emitter.live--`).
     - Otherwise, with `w` = the emitter's wind times `def.wind` (wind is in m/s):
       - `vx += (wx - vx)*dragK` (same for y);
       - `vz += (wz - vz)*dragK + accelZ*STEP`;
       - `p += v*STEP`;
       - kill when `pz < kz`.
  2. **Spawn per emitter:**
     - When on: `acc += rate*STEP`; `while (acc >= 1 && live < maxLive) { spawn; acc -= 1 }`. If `live >= maxLive`, `acc = min(acc, 1)` so the backlog never bursts later.
     - Pending bursts spawn in the same place, up to maxLive.
     - **RNG draw order per particle (fixed, for replay):** `life`, `speed`, `jx`, `jy`, `jz` (always 3 draws), then disk rejection for the cone: `u = 2r-1`, `v = 2r-1`, accept when `u*u + v*v <= 1`, <= 8 tries, else (0, 0).
     - `dir' = normalise(axis + (u*a + v*b)*spreadTan)`. No trig.
     - New particles first move on the next step.
- **Transient emitters** (`burstAt`) are ordinary emitter slots with `rate 0`, a flag and auto-release. Because of this, every particle has an emitter, and the draw lights per emitter (053b).
- **`engine/world/entityEmitters.js`** (the AC "attachable to an entity"):
  - `createEntityEmitters(world, particles, events, defIdOf)` returns `{sync()}`.
  - Component: `components.emitters: [{preset, offset:{right, fwd, up} (m), on}]` (JSON; `on` is saved, handles are not).
  - The pair list (entity ref, emitter handle) is preallocated with max 64 pairs. It is rebuilt on `world:loaded` / `entity:added` / `entity:removed`; allocation is fine there.
  - `sync()` runs once per step before `particles.step()`. It writes `transform + yaw-rotated offset` (`forwardOf/rightOf`) and copies `on` into `setOn`.
  - World points: the game calls `createEmitter` directly.
- **Tests (`engine/fx/particles.test.js`):**
  - same seed + script -> equal hash at every 60-step checkpoint and at 600, run twice;
  - ring recycle (cap 8 fixture: the 9th spawn overwrites slot 0, the oldest);
  - per-emitter `maxLive`, plus no burst after the cap clears;
  - kill plane;
  - drag converges to the wind;
  - rate 20/s gives exactly 20 spawns over 60 steps;
  - `burstAt` releases its slot after the last death;
  - zero allocation over 10k steps (`--expose-gc`);
  - entityEmitters: offset rotation at yaw 0/90/225; add/remove rebuild;
  - check-deps fixture for rule 16.
- **Budget (revised, Node, warn-only unless `PERF_STRICT=1`):** 500 live <= 0.05 ms per step, 2048 live <= 0.15 ms. PO proposed 0.3 ms for 500; the SoA loop is about 20 ns per particle.
- **As built (053a review, 2026-10-02), accepted deviations:**
  - glyph ramps are `Uint16Array` (BMP code points; > U+FFFF throws at define), not Uint8; 053b packs the glyph *index* into the layer, not the code.
  - rate accumulator: `acc += rate` per step, one spawn per `HZ = 60` units (exact integer counts; same as `rate*STEP` vs 1 without float drift).
  - life = integer steps uniform in `[round(min/STEP), round(max/STEP)]`; draw order `life, speed, jx, jy, jz, cone...` is fixed.
  - handles = `(generation << 6) | slot`; stale handles are silent no-ops; `clear()` bumps every generation. `isValid(h)` and `defIdOf(key)` are part of the API.
  - `hashInto` covers live slots, used emitters, wind and the RNG state, not generations (handle bookkeeping).
  - a burst larger than the free `maxLive` is truncated, never deferred.
  - entityEmitters: `entry.on` means on unless `=== false`. A caller that runs `particles.clear()` outside `world:loaded` must call `entityEmitters.invalidate()` (otherwise its pairs hold stale handles until the next rebuild).
  - wind-field tests for `sampleWind` live in `engine/world/` (rule 16 bars fx tests from importing world).
  - check-deps rule 16 also bars `engine/physics/**` and `engine/nav/**` from importing `engine/fx/**` (27.10 stand-alone, nav leaf).

**US-053b (PC-A, ~1 d, engine/render -> arch-review): draw through the sprite pass.**
- **Decision: a JS-rasterised particle layer, read by the existing sprite pass as one extra candidate per cell** (the RE-07 overlay pattern, 28.9). Particles are not added to the `SPR` list.
- **Reason:** `sprites.frag` loops over every sprite for every cell (`MAX_SPRITES 64`). 500-2048 entries would cost about 60k cells x 2k iterations at 400x150, far over 0.5 ms. With the layer, the GPU cost is 2 texel fetches per cell.
- **Parity:** the cell decision is made once in JS and both twins read the same arrays, so parity is exact by construction.
- **Size:** 1 particle = 1 cell (a glyph). Bigger puffs are more particles (designer).
- **`engine/render/particleLayer.js`:**
  - `createParticleLayer()` returns `{bind(cols, rows), build(ps, cam, rt, lights, world, palette, renderer), part: Uint8Array(cols*rows*4), partZ: Float32Array(cols*rows), minRow, maxRow, prevMinRow, prevMaxRow, stats}`.
  - Owned as `engine.particleLayer`, and rebound on `grid:changed` like `overlay.bind` (`engine.js` line ~118).
- **`build`, once per rendered frame:**
  1. Clear the cells touched last frame (`touched Int32Array(cap)`).
  2. Camera basis once (`camBasis`, as `SpritePool.project`).
  3. Per **emitter** (not per particle): `lightAt(lights, world, ex, ey, ez + 0.1, 0, 0, 1, scratch)` -> an rgb multiplier using the `shadeSprite` gain rule. This is at most 64 calls per frame. **Known limit:** a long plume is lit as at its source. Per-particle light can be an opt-in def flag later.
  4. Per live slot, in slot order:
     - ramp index `i = Math.floor(age * n / life)` (integer math, stepped ramps, no lerp);
     - skip if the glyph is `' '`;
     - `projectSprite(cb, cam, px, py, pz, 0, _ps)`, the same function and depth convention as sprites (shear `d`, pitched `vd`, so it compares with G-buffer DEPTH);
     - cell = `floor(colCenter)`, `floor(feetRow)`, skip if off-grid;
     - keep it if `partZ[c] === 0 || depth < partZ[c]` (strict: the lower slot wins a tie);
     - rgb = emissive ? `ramp` (fog x `emissiveFog`) : `ramp * emitterLight`, then fog toward the sprite fog colour at `_ps.fogDepth`. **Factor the fog-colour resolution out of `SpritePool.project` into one shared helper** in `sprites.js` (no second fog code).
     - Write bytes rgb + glyph index into `part`, depth into `partZ`, and update the dirty rows.
- **GPU (`spritesPass.js`, `glsl/sprites.frag.js`):**
  - New samplers `uPart` (RGBA8, a = glyph index / 255) and `uPartZ` (R32F, 0 = empty).
  - `bindParticleLayer(layer)` uploads only the union of this frame's and last frame's dirty rows (overlay precedent).
  - In the shader, **after** the sprite loop: `pz > 0 && pz < cellDepth && pz < best` -> use the layer rgb + glyph, bg = edge bg.
  - Fade and dim then apply as for any cell. A sprite therefore wins an exact tie.
  - `run()` must not skip the pass when `uCount == 0` but the layer has cells.
- **JS twin:** `drawSprites(fb, pool, layer?)` runs the same test after its sprite loop, against `fb.depth.depth`. Both sides compare the same f32 values.
- **Tests (`engine/render/particleLayer.test.js` + `sprites.test.js`):**
  - particle behind a wall fixture hidden, in front shown;
  - tie: the lower slot wins; sprite vs particle at equal depth: the sprite wins;
  - ramp index at age 0, life/2 and life-1;
  - emissive ignores light;
  - pitched and shear cells match `projectSprite` for the same point;
  - dirty-row union;
  - zero allocation over 1000 builds;
  - the GLSL lexical rules (`glsl.test.js`, no `round(`).
- **gpucompare pose `particles`** (mesh, tower interior): debug def, rate 200, seed 1, 120 steps from `clear()`, frozen camera. Expect 0 mismatching particle cells, and the rest within the 27.7 bars. Existing poses must be unchanged (layer empty).
- **Budget (revised; numbers recorded in the story):**
  - JS `build`: 500 live <= 0.1 ms, 2048 <= 0.3 ms;
  - GPU extra in the sprite pass <= 0.05 ms p95;
  - row upload <= 0.15 ms at 400x150;
  - `over25 == 0`.
  - The PO proposed "GPU <= 0.5 ms" as one number. It is split here because most of the cost is the JS build and the upload, not the GPU.
- **main.js (PC-B or PC-A main session, 4 lines):**
  1. boot: define presets (053c);
  2. `sprites.pass?.bindParticleLayer(engine.particleLayer)`;
  3. update, after the beast/sword/vitals steps: `entityEmitters.sync(); engine.particles.step();`;
  4. render, before `sprites.render`: `engine.particleLayer.build(engine.particles, cam, rt, engine.lights, engine.world, assets.palette, effRenderer)`.
- **Do not:**
  - put particles in the `SPR` list or raise `MAX_SPRITES`;
  - light each particle with `lightAt`;
  - lerp colours (parity);
  - collide particles with the world (out of scope; kill-plane only);
  - draw from the game's sim RNG;
  - save particles (transient; `clear()` on load).

### 32.2 US-055a water surface (split: 055a1 data + query, 055a2 render)

**Decision: water is a separate surface layer computed analytically per cell (view ray vs a flat region), composited in the shade pass. It is not a material on raster geometry and not a new raster pass.**
- **Why not a material:** a material on a water mesh would be the nearest G-buffer surface. The floor, props and beasts under it would be gone, and the AC "floor visible in shallows" could only be faked.
- **Why not a raster pass:** a second raster pass would need its own depth attachment, a sub-sample twin and a JS triangle raster.
- **Water regions are flat** (one `z` per region), so a per-cell ray-plane test is exact:
  - it is world-anchored by construction (no swim when the camera turns);
  - it has no aliasing beyond the cell grid;
  - it gives the water path length directly as `sceneDepth - waterDepth`, which is the depth tint and the see-through rule;
  - its JS twin is the same 10 lines of arithmetic.
  - `cellRayP` / `cellRayPitched` (`glsl/common.js`, JS twins in `projection.js`) are linear in depth, so `zDir = P(1).z - eyeZ` and `dW = (z - eyeZ) / zDir` is in **the same units as the DEPTH texel** in both projections.
- **Rivers:** terrain rivers stay as today (terrain type `water`, glint look) until US-026 regions. A sloped river later becomes a chain of flat regions.

**US-055a1 (PC-A, or PC-B cross-track, ~0.5 d, engine/world -> arch-review): data + `waterAt`.**
- **Data.** World or level JSON `"water": [{ "id": "pool1", "shape": "rect", "rect": [x0, y0, x1, y1] | "shape": "circle", "c": [x, y], "r": 3, "z": 1.2, "look": "water", "flow": [0, 0] }]`.
  - Shapes are axis-aligned rects and circles only. A level `yawSteps` keeps rects axis-aligned. More complex shapes are unions of rects.
  - `look` is a key into the designer water look table (055a2).
  - `flow` is stored for US-055 currents and unused here.
  - Max 32 regions per world.
  - Validated at load and throws with the id. Content, not state; `serialize` round-trips it like `horizon`.
- `World.water`: a SoA (`x0,y0,x1,y1, cx,cy,r2, z` Float64, `kind` Uint8, `look` Uint8 resolved at load).
- **`World.waterAt(x, y, out) -> boolean`**, `out {surfaceZ, depth, region}`:
  - linear scan with an AABB reject, then the point test;
  - with overlaps, the highest `z` wins;
  - `depth = z - floorZ`, clamped at >= 0. `floorZ` comes from the floor query `integrate` uses for the current physics mode: `physicsMode === 'mesh'` -> `supportAt(x, y, z + 0.01, false, null).floorH`, the query the beasts use; grid -> `floorAt(x, y)`.
  - Pure, zero allocation, <= 0.005 ms for 32 regions.
- **Nav:** `NavGrid.buildFromWorld` may later block cells with `depth >= 0.6` (option; not this story).
- **Tests:** rect/circle in and out; overlap = highest z; level frame offset + `yawSteps 1`; depth over a stepped floor fixture; serialize round trip; validation throws.

**US-055a2 (PC-A, ~1 d, engine/render -> arch-review; mesh only): render.** **Superseded in part by 35 (owner decision 2026-10-02, water mesh):** the per-cell ray-plane hit below is replaced by the water layer pass (055a2a, 35.3). The composite rules, look table, edge rule, tests and pose below still apply (055a2b).
- **`engine/render/water.js`, per frame:**
  - `selectWater(world, cam, out)` copies the <= `WATER_MAX 8` regions that are on screen and nearest the camera into a `Float32Array(8*8)` uniform block (rect/circle params, z, look).
  - It skips regions with `eyeZ < z` (no underwater view in v1).
  - Zero allocation.
- **Look table** (designer, `assets.waterLooks`, resolved to numbers at bind):
  - wave glyph ramp `~-=`;
  - `shallow`/`deep` rgb;
  - `opaqueAt` (m of path, default 1.5);
  - `seeThrough` (alpha threshold, default 0.35);
  - `glint` rgb;
  - `waveHz` (default 2).
- **Shade (`glsl/shade.frag.js`) helper `waterComposite(cell, rawDepth, inout vec3 fg, inout vec3 bg, inout int glyph)`:**
  - It is called at all three output sites: sky (`kind 0`), the terrain early return and the material tail.
  - It runs **after** that site's own fog. The water itself is fogged with its own distance.
  - Per active region:
    - `dW = (z - eyeZ) / zDir`; keep it if `dW > PROJ_NEAR`, `dW < rawDepth` and `dW < best`;
    - the hit point `P(dW)` must be inside the region;
    - nearest wins; a tie goes to the lower index.
  - With a hit:
    - `a = clamp((rawDepth - dW) / opaqueAt, 0, 1)`, with sky = 1;
    - `rgbW = mix(shallow, deep, a)` x (ambient + sun term for an up normal, the same `bSun` formula as the terrain path);
    - if `a < seeThrough`: keep the floor glyph, `fg = mix(fg, rgbW, a)`;
    - else: glyph = `ramp[hash(floor(Px/0.5), floor(Py/0.5), floor(timeSec*waveHz)) % n]` (the `hashFast` salt list gets a new salt), `fg = rgbW`;
    - glint: when the same hash > 0.9, `fg = mix(fg, glint, 0.5)`;
    - `bg = rgbW * bgK`.
- **Edge pass:** suppress the outline on cells where the water glyph won (`a >= seeThrough`). Submerged silhouettes must not draw through opaque water. The water layer is passed as one `uWater` uniform block, the same block in both passes.
- **JS twin:** `waterCompositeJS(fb, cam, sel, look)` runs right after the JS shade stage of `renderWorld` on mesh and before the JS edge stage, with the same expression order (glsl.test.js transpile check, like `cellRayP`).
- **Tests:**
  - cell over the pool: hit `dW` equals the analytic value at yaw 0/90 and pitch 0/-30, in shear and pitched;
  - a wall in front hides the water;
  - shallow keeps the floor glyph, deep shows waves;
  - hash stable while the camera turns (world-anchored);
  - eye below z = no water;
  - zero allocation.
- **gpucompare mesh pose `water`:** test pool level, two views (grazing + top-down). The usual mesh-pose bar.
- **Budget (D-029):** shade extra <= 0.1 ms p95 at 400x150 with 1 region (8 regions <= 0.2 ms). JS twin extra <= 0.3 ms at 240x90 (warn-only).
- **Do not:**
  - add water geometry to the draw list;
  - write water into the G-buffer (physics, picking and edges stay on the real floor);
  - animate in world time from `performance.now` (use `fb.timeSec`, the existing shade uniform `uTimeSec`);
  - change the terrain river look in this story.

### 32.3 US-132 burning + US-133 fire spread

**Decision on ownership: split like 30.2.**
- **US-133 fire grid = engine** (`engine/world/fireGrid.js`). It is a genre-neutral, deterministic spatial cellular sim with save state, the same class of module as `Visibility.js`.
- **US-132 burning = game** (`game/js/quest/sim/status.js`). Damage per tick, who burns and how long are game rules. The engine status-effect layer waits for a second game, as the brain (29.1) and health (30.2) did.
- The row's "PC-A engine status-effect component" falls away: US-132 is PC-B game code, PO-reviewed, no arch-review.

**Decision on flammability:**
- **materials** for static world surfaces (fire grid cells);
- **`components.flammable`** for entities (props, beasts, the player).
- Both are data. The two sims meet through two calls: `fire.isBurning(x, y, z)` (an entity stands in fire) and `fire.ignite(x, y, z)` (a burning entity lights the cell under it). An entity is never a fire cell, and a cell is never an entity.

**US-133 (PC-A, or PC-B cross-track since it is pure JS, ~1 d, engine -> arch-review): `engine/world/fireGrid.js` + test.**
- **Materials** (`assets.fireMaterials`, designer file `design/fire-materials.js`):
  - `{ dryGrass: {fuelSec: 2, ignite: 0.35, charred: 'charredGrass'}, brush: {...}, wood: {...} }`;
  - `ignite` = the chance **per fire tick per burning orthogonal neighbour**;
  - `charred` = the material key the view (US-134) swaps to;
  - surfaces not in the table (stone, metal, water, `path`) never burn.
- **Surface mapping, per world** (`fire.surfaces`): `{ "grass": "dryGrass", "<sector floorMat>": "wood" }` maps a terrain type name (`groundTypeAt` -> `typeName`) or a sector `floorMat` to a material key.
- **Areas** (world/level JSON):
  - `"fire": {"seed": 1, "surfaces": {...}, "areas": [{"id": "brush1", "x0": .., "y0": .., "w": 40, "h": 40, "cell": 0.5, "zMin": .., "zMax": .., "paint": [{"rect": [x0, y0, x1, y1], "mat": "brush"}], "tag": "barrierPatch"}]}`;
  - cell count `w*h <= 4096` per area, max 8 areas, `maxCells 16384` total;
  - per cell at build: material = the last `paint` rect containing the cell centre, else `surfaces[surface name at the cell centre]`, else none;
  - `cz` (Float32) = the surface z at the centre (`supportAt` / `groundAt`), for the view.
- **No spread between areas** (designers cover a patch with one area).
- **Built by the game** like the nav grid (29.1): `createFireGrid({materials, seed, tickSteps: 6, windK: 0.15})`, then `grid.addArea(def, world)` per area (load time; may allocate), then `world.fire = grid`.
- **Save:** `serialize` writes `fire: world.fire.save()` when it is set, the same optional pattern as `world.visibility` (RE-11b). After building, the game calls `grid.load(state.fire)`.
- **Cell state** (SoA over all cells):
  - `state` Uint8: 0 none, 1 unburnt, 2 burning, 3 burnt;
  - `fuel` Uint16 (fire ticks left);
  - `mat` Uint8;
  - `cz` Float32.
  - Scratch: `igniteList`, `burnList` (Int32Array of `maxCells`; the precedent is RE-05c's decide-then-apply scratch, 29.1).
- **Rule.** The fire ticks at **10 Hz** (every `tickSteps = 6` sim steps; integer counter). A 60 Hz tick would need per-step chances near 0.01 and would cost 6x for nothing. Per tick, per area, in cell index order:
  1. **Decide.** The step-start `state` is read-only during this pass.
     - A burning cell: `fuel--`; at 0, push it to `burnList`.
     - An unburnt cell with at least one burning 8-neighbour: `q = product over burning neighbours n of (1 - ignite[mat] * wDir(n) * wWind(n))`. `wDir` = 1 orthogonal, 0.7 diagonal. `wWind = clamp(1 + windK * (wx*ux + wy*uy), 0.25, 3)`, where `u` is the fixed unit direction from the neighbour to this cell (the table holds 0.70710678 for diagonals) and `(wx, wy)` is the area wind in m/s.
     - Then **one** draw `rng.nextFloat() < 1 - q` pushes it to `igniteList`.
     - Exactly one draw per candidate cell, in index order, gives order-independent, replayable results.
  2. **Apply:** `burnList` -> state 3, change kind 2; `igniteList` -> state 2, `fuel = fuelTicks[mat]`, change kind 1.
- **API** (zero allocation after `addArea`):
  - `step()` (every sim step; ticks when its counter wraps);
  - `ignite(x, y, z) -> boolean`: immediate and deterministic, no RNG; only an unburnt flammable cell of the area whose `zMin..zMax` contains z;
  - `igniteRadius(x, y, z, r) -> count`: for US-137;
  - `isBurning(x, y, z)`, `stateAt(x, y, z)`;
  - `setAreaWind(a, wx, wy)` and `sampleWind(field, tick)` (US-138: one `sampleInto` at each area centre per fire tick);
  - `changes: Int32Array`, `changeCount` (`(globalCell << 2) | kind`, valid from the tick that made them until the next tick);
  - `cellCenter(globalCell, out3)`;
  - `hashInto(h)`, `save()`, `load(obj)`;
  - `stats {burning, ticks}`.
- **Bus event:** a single `fire:area` `{id, kind: 'burnt'}` (preallocated) when the last burning cell of an area with a `tag` goes out, for US-135's "patch done". There is no per-cell bus event (32.0 item 5).
- **`save()`:** `{ v: 1, rng: rng.save(), tick, areas: { [id]: { s: "<RLE of state digits, e.g. '1x40,3x12'>", b: [cell, fuel, ...] } } }`: plain JSON, burning cells keep their fuel.
- **Tests (`fireGrid.test.js`):**
  - 20x20 dryGrass fixture lit in a corner burns out in the same tick count and with the same hash on every run, and twice in one process;
  - a stone strip 1 cell wide stops the front (no diagonal leak: give the strip a diagonal-proof width of 1 cell plus the `wDir` rule, and assert it);
  - wind (4, 0): the burnt extent on +x after N ticks is greater than on -x;
  - a cell burns for exactly `fuelTicks`;
  - `ignite` on stone = false;
  - `save` at tick 20 then `load` into a fresh grid gives an equal hash at tick 60;
  - zero allocation over 10k steps.
- **Budget (revised):** a 4096-cell area tick <= 0.1 ms, which is about 0.017 ms per step amortised. The PO proposed "4000 cells <= 0.2 ms per step".
- **Do not:**
  - emit bus events per cell;
  - read `world` during `step` (everything is baked at `addArea`);
  - share the beast or particle RNG;
  - use float timers;
  - iterate areas by `Map` (`areas` is an array; ids go through a load-time `Map` for `save`/`load` only).
- **As built (133 review, 2026-10-02):**
  - **Candidate pass:** each burning cell multiplies `qAcc[t] *= max(0, 1 - ignite*wDir*wWind)` into its unburnt neighbours (u = neighbour -> cell, as above), then one linear pass draws one RNG per cell with `q < 1`, in index order. Same rule and draw order as above, with two precisions: a factor with `p >= 1` is 0 (not negative), and a candidate whose every factor is 1 (ignite 0) takes **no** draw. The q product order is burning-cell index order (bitwise determinism holds; a second implementation must use the same order).
  - **Change list consumers:** `changes` is reset at the start of every fire tick and manual `ignite`/`igniteRadius` between ticks append to it. A per-step reader keeps `(lastTick, lastCount)`: `from = fire.stats.ticks !== lastTick ? 0 : lastCount`, so no entry is processed twice.
  - **Surfaces at `addArea` (duck-typed world):** `surfaceAt(x, y)` override if present; else inside a structure sector the sector `floorMat` (`world.sectorAt`), inside a structure bbox but outside its sectors nothing; else the terrain `typeName(groundTypeAt)`. Height: `world.floorAt` (structure-aware), else `terrain.groundAt`, else 0. `World.heightAt` is terrain-only and must not be used.
  - **Wind:** optional `grid.wind` field, sampled at each area centre on every fire tick with the **sim tick** (32.8 item 7), passed as `step(simTick)`. Area wind `wx, wy` is part of `hashInto`.
  - `World.load`/`deserialize` do not restore fire. The game rebuilds the areas from content, then calls `grid.load(state.fire)`, which throws when the content doesn't match. `save()` also stores `counter`. Level-local -> world conversion of `areas`/`paint` is the game's job (32.0 item 6).
  - `fire:area` can fire again if a burnt-out tagged area is re-lit and burns out again; US-135 listeners latch.
  - Perf bar = the **average** tick of a saturated 4096-cell area (<= 0.1 ms); a single worst tick up to ~0.35 ms in Node (once per 6 steps) is accepted.

**US-132 (PC-B, game; split 132a sim ~0.6 d, 132b view ~0.5 d after US-053c).**
- **Components (JSON, saved with the entity, no `serialize.js` change):**
  - `components.flammable {burnSec: 4, contactSec: 1, radius?}`. The radius defaults to `targetable.radius` or `body.radius`.
  - `components.effects {burning?: {left, tick}}`, with integer steps.
  - The generic part is the `effects` object plus a fixed `EFFECT_KINDS = ['burning']` array that the sim iterates. Keys are never iterated with `for...in` in a step.
- **`game/js/quest/sim/status.js`:**
  - `createStatusSim(world, events, cfg, hooks)`, with `hooks {fire, damage(id, n), waterAt}`;
  - the flammable list is a preallocated SoA (max 32), rebuilt on load and on `entity:added/removed`.
  - Config `statusConfig.js`: `tickSteps 30` (0.5 s), `dmgPerTick 1`, `touchGap 0.5`, `igniteCellEvery 30`, `waterOutDepth 0.3`.
- **Step order (after `fire.step()`):**
  1. Per flammable entity: if `fire.isBurning(feet)`, set `left = burnSec steps` (a refresh, never stacking).
  2. Contact pass, O(n^2) over at most 32: a not-burning flammable entity with a burning one at `gap = dist2D - rA - rB <= touchGap` and overlapping z bands -> `contact++`, else `contact = 0`. At `contact >= contactSec steps` it ignites.
  3. Per burning entity:
     - `left--`;
     - when `--tick <= 0`: `hooks.damage(id, dmgPerTick)` and `tick = tickSteps`;
     - every `igniteCellEvery` steps: `fire.ignite(feet)`;
     - `waterAt(depth >= waterOutDepth)` or `left == 0` -> delete `effects.burning`.
  - `contact` is a sim SoA field, not saved; a reload restarts the 1 s count, which is accepted.
- **Damage path (architect note, revise the AC):** "through the existing damage path" must **not** be `combat:hit`. In `vitals` (30.2), `combat:hit` applies `damageScale 5` (any source other than the player) and a 60-step invuln, so the 0.5 s ticks would be swallowed or multiplied by 5.
  - New in `vitals.js`: `applyDot(n)`. It skips invuln and knockback, sets `hpTick` for a soft hurt tint, and still runs death at 0.
  - The `hooks.damage` wiring is: player -> `vitals.applyDot`; others -> `health.hp = max(0, hp - n)` when `components.health` exists.
  - Numbers kept (1 HP / 0.5 s / 4 s = 8 of 30 HP).
- **132b view (`game/js/quest/statusView.js`, called in `update` after `status.step`, so it runs on the fixed step):**
  - a fixed table of 16 slots `(entityId, flameH, smokeH)`: `createEmitter` on burn start, `setEmitterPos` each step, `release` on end;
  - a flicker point light only for the 2 burning entities nearest the camera (`MAX_LIGHTS 16` stays safe);
  - the player hurt-edge tint while burning goes through `vitalsView` (designer style `vitals.burnEdge`).
- **Tests (`sim/status.test.js`):**
  - ticks at 30/60/.../240 steps = 8 damage calls;
  - a refresh in a burning cell;
  - contact 59 steps = no ignite, 60 = ignite;
  - stone (no `flammable`) never burns;
  - water out;
  - replay hash equal twice;
  - zero allocation.
- **Do not:**
  - put `effects`/`flammable` rules in `engine/`;
  - route DoT through `combat:hit`;
  - let `statusView` write sim state.

### 32.4 US-136 explosion query + impulse (PC-A, ~0.75 d, engine -> arch-review; needs US-078b `World.raySegment` first)

**`engine/physics/impulse.js`** (stand-alone: touches only the `body` object, imports nothing):
```js
export const IMPULSE_MAX_H = 12; // m/s; 12*STEP = 0.2 m/step < PHYSICS.radius 0.3 -> moveCapsule/moveCircleMesh never skip a wall
export const IMPULSE_MAX_V = 8;  // m/s; the ceiling clamp in integrate step 5 bounds it
/** Adds a velocity impulse to a capsule body (components.body). iz > 0 lifts off: grounded=false,
 *  coyote=0, sliding=false, peakZ=footZ, vz=max(vz, min(iz, IMPULSE_MAX_V)). Horizontal speed after
 *  the add is clamped to IMPULSE_MAX_H. Zero alloc. */
export function applyImpulse(body, footZ, ix, iy, iz) {}
```
- **Amendment (architect, 2026-10-02, US-136 review):** `peakZ = footZ` only when the body was grounded; an airborne body keeps `max(peakZ, footZ)` (a mid-fall blast must not cancel fall damage). `integrate` step 5 updates `peakZ` **after** the ceiling clamp (fixed in US-136).
- **Same convention as the 30.2 knockback** (`body.vx/vy +=`). A horizontal-only kick on the ground dies in about 0.18 s (decel 43.75 m/s^2, so about 0.7 m), which is too weak for a blast. The lift moves the body into the air-control branch (decel x0.35), so an 8 m/s + 4 m/s blast carries about 2 m.
- Walls and ceilings stay with `integrate` (`moveCapsule`/mesh, ceiling clamp). No new collision code.
- **`engine/world/explosion.js`** (pure query, next to `meleeArc.js`):
```js
/** cand: {count, x, y, z (feet), r, h} SoA - the game's shared targetables list (30.1), or any list.
 *  Per candidate (index order): cz = clamp(ez, z, z+h); dS = max(0, |(x,y,cz) - e| - r); skip if dS >= radius;
 *  f = 1 - dS/radius; LOS: world.raySegment(e -> (x, y, z + h/2), ray) blocked iff ray hit and
 *  ray.t*L < L - r - 0.05 (L = |centre - e|); dir = unit(centre - e) or (0,0,1) when L < 1e-6.
 *  Writes outIdx[n], outF[n], outDir[3n]; returns n. Zero alloc. */
export function explosionHits(world, ex, ey, ez, radius, cand, outIdx, outF, outDir, ray) {}
```
- The candidate list comes from the game, so the engine reads no `targetable`/`health` convention. Falloff is linear, as the AC asks.
- The game removes the exploding prop **before** the query, because a ray that starts inside its collider is blocked at t of about 0.
- **Event and damage = game** (US-137, `game/js/quest/sim/explosions.js`):
  - one preallocated `explosion:hit {target, damage: round(f*damage), dirX, dirY, f}`;
  - the player gets `applyImpulse(body, z, dirX*f*8, dirY*f*8, f*4)`, and the `vitals` listener applies the damage unscaled, with no second knockback (dir 0).
  - The engine API stays the pure query + impulse, like `arcHits` (30.1).
- **Tests:**
  - falloff at 0, r/2 and r;
  - target behind a wall fixture skipped, beside it hit;
  - a target whose capsule touches the radius edge;
  - `applyImpulse` at max into a 0.1 m mesh wall, 120 steps: never on the far side;
  - under a 2.2 m ceiling: z <= ceil - height;
  - lift sets `fallDistance` from `peakZ` (no fake fall damage);
  - 16 candidates <= 0.35 ms per call (one-off, not per frame);
  - zero allocation.
- **Do not:**
  - write a new occlusion raycast (use `raySegment`);
  - write `t.x/t.y` directly (that would tunnel);
  - add damage or event logic to `engine/`.

### 32.5 US-138 wind (PC-A, ~0.75 d, engine/world + one physics field -> arch-review)

- **`engine/world/wind.js`:**
  - `createWind(def, seed)` returns `WindField`. World JSON `"wind": {"dirDeg": 90, "speed": 2, "gust": {"amp": 0.5, "periodSec": 3, "travel": 8}, "zones": [{"id", "shape": "rect"|"circle", ..., "edge": 2, "mode": "add"|"set", "dirDeg", "speed", "push": false}]}`.
  - `dirDeg` is a compass bearing the wind blows **toward** (0 = N = -y, clockwise; converted with `forwardOf` at create).
  - Max 16 zones.
  - `World.load` builds `world.wind`; with no block it is calm (speed 0). Content, not state.
- **Gusts without trig or wall clock:**
  - 64 knot values from `createRng(seed).nextFloat()` at create;
  - `P = round(periodSec/STEP)` steps;
  - local tick `tl = tick - (x*dirX + y*dirY) / (travel*STEP)`, so gusts travel downwind;
  - `k = floor(tl/P)`, `fr = (tl - k*P)/P`, `s = fr*fr*(3 - 2*fr)`;
  - `g = K[k mod 64] + (K[(k+1) mod 64] - K[k mod 64])*s`, with a positive modulo;
  - `speedNow = speed * max(0, 1 + amp*(2g - 1))`.
- **Zones** (array order): weight `w = clamp(insideDistance/edge, 0, 1)`; `set` -> `v = v + (vZone - v)*w`; `add` -> `v += vZone*w`. The zone vector uses the same `g`.
- **API:**
  - `sampleInto(x, y, z, tick, out3) -> out3` (z reserved, vz = 0);
  - `pushAt(x, y, tick, out2)`: the sum over `push:true` zones, scaled so the gust peak gives `pushMax 1.5 m/s`;
  - `uniforms(tick, camX, camY, out4)` -> `(dirX, dirY, speedNow at camera, tick*STEP)`;
  - `hashInto`.
  - **`t` is the integer sim tick** (the game's step counter), not seconds. Gust phase restarts on load, which is accepted (presentation-level).
- **Consumers, no per-frame allocation:**
  - `particles.sampleWind(world.wind, tick)`: once per emitter per step;
  - `fire.sampleWind(world.wind, tick)`: once per area per fire tick;
  - future projectiles (US-052/103): `sampleInto` per body per step;
  - the US-121 shader reads `uniforms()`. The GLSL upload lands with US-121, not here (no dead uniform).
- **Player push (physics, PC-A):** `integrate.js` gains `body.pushX/pushY` (m/s; typeof guard, default 0, like `speedScale`). They are added to the horizontal **displacement** only (`(vx + pushX)*dt` into `moveCapsule`/mesh), so accel/decel never fights them, and walls block them as usual. The caller sets them every step before `integrate` (game: `pushAt`), and they reset to 0 on respawn. The same field serves US-055 currents later.
- **Tests:**
  - same seed -> same `sampleInto` at 1000 ticks;
  - gust continuity (no jump > `amp*speed*2/P` between ticks);
  - travel: a downwind point lags by `along/(travel*STEP)` ticks;
  - zone set/add edges;
  - push peak <= 1.5;
  - the push against a wall fixture never passes it;
  - zero allocation;
  - the fire bias test from 32.3 driven through `sampleWind`.
- **Budget:** `sampleInto` with 16 zones <= 0.5 us; 64 emitters + 8 areas per step <= 0.05 ms.
- **Do not:**
  - use `Math.sin`/`performance.now` for gusts;
  - let fx import `world/wind.js` (duck-typed);
  - add the push to `vx/vy` (decel would erase it).

### 32.6 US-139 height fog + fog banks (stretch; PC-A, ~1 d when picked; mesh only)

Enough for whoever picks it up:
- **Data:** world JSON `"fog": {"height": {"base": z, "top": z, "density": d}, "volumes": [{"id", "shape": "box"|"ellipsoid", "c": [x, y, z], "half": [hx, hy, hz], "density": d, "drift": m}]}`, max 8 volumes on screen (`engine/render/fogVolumes.js` selects and packs them, like `selectWater`). Content, not state.
- **Math (no `exp`, for tight parity):** along the cell ray from the eye E to the surface point P (the `cellRayP`/`cellRayPitched` helpers, L = |P - E|; sky -> L = 300 m):
  - height ramp `r(z) = clamp((top - z)/(top - base), 0, 1)`;
  - `G(z) = z <= base ? z - base : z < top ? (z - base) - (z - base)^2 / (2(top - base)) : (top - base)/2`;
  - `tauH = density * L * (G(z1) - G(z0)) / (z1 - z0)`, with `density * L * r(z0)` when `|z1 - z0| < 1e-4`;
  - volumes: slab chord (box) or scaled-sphere chord (ellipsoid) of the segment `[0, L]`, `tauV = density * chord`;
  - total: `f = min(1, f_dist + tauH + sum of tauV)`.
- **Where:**
  - material path: replaces `f` before the existing stipple/blend, so the glyph stipple and colour blend reuse today's code;
  - terrain path: one extra blend toward `uFogFg` by `min(1, tau)` after `shadeTerrain`;
  - sky: the same blend;
  - sprites and particles: CPU `fogExtra` at their point.
  - JS twin `fogExtra(u, E, P)` in `fogVolumes.js`; GLSL string in `common.js`; glsl.test.js transpile check.
- **Drift:** bounded and stateless: `offset = driftM * (2g(tick) - 1)` along the wind direction (the 32.5 gust function). No sim state, no save.
- **Budget:** <= 0.2 ms at 400x150 with 8 volumes (kept). gpucompare mesh pose `fogBank`.
- **Do not:** add a fog pass, use `exp`/`pow` in the shared formula, or store a fog volume position in saves.

### 32.7 Seams for the rows without a note
- **US-053c (PC-B):**
  - `design/particles.js` presets with palette keys; `main.js` resolves them to `[r,g,b]` and calls `defineEmitter`;
  - the Kestrel burner uses `components.emitters` (flame + smoke) on its prop;
  - landing dust is game code on `body.landed && fallSpeed > cfg`;
  - sword `clink`/hit sparks use `burstAt` at the 30.1 hit point.
- **US-055b (PC-B):** `waterAt` each step at the feet. Wade: `speedScale *= 0.6`. Swim: surface lock at `surfaceZ - 1.2`, which needs a small `integrate` hook; raise it as `ASK ARCHITECT` when started. Splash: `burstAt(splash, n = clamp(round(-vz*4), 2, 40))`.
- **US-134 (PC-A):** the view reads `fire.changes` and `cz`. Burning cells become particle emitters per cluster (max 8 transient flame emitters per area) and up to 2 lights at the burning-cell centroids. Charred cells use a material-id swap in a per-area overlay texture. This needs its own short note at pickup (it touches the raster material path).
- **US-137 (PC-B):** the 32.4 game wrapper + `fire.igniteRadius` + the particle burst + one transient light.
- **US-140 (PC-B):** rain = particles + `fire` extinguish via a new `fire.douse(rate)` (PC-A hook, ask then).

### 32.8 AC changes for the PO (relay; the architect does not edit backlog rows)
1. **US-053a:**
   - pool **2048** (not 2000);
   - budget 500 live <= **0.05 ms** and 2048 <= **0.15 ms** per step (was 500 <= 0.3 ms);
   - determinism = equal `hashInto` at every 60-step checkpoint to 600.
2. **US-053b:**
   - "lit by ambient + point lights" = **per emitter, at its position** (known limit for long plumes);
   - "GPU <= 0.5 ms" -> JS build 500 <= 0.1 ms, GPU extra <= 0.05 ms, upload <= 0.15 ms at 400x150;
   - 1 particle = 1 cell.
3. **US-055a:**
   - split **055a1** (data + `waterAt(x, y, out) -> boolean`, ~0.5 d) / **055a2** (render, ~1 d, mesh only);
   - regions are rect/circle with a flat z;
   - "see-through <= 0.5 m" is expressed as view-path thickness (`opaqueAt`/`seeThrough` look data), which is physically right at grazing angles;
   - terrain rivers unchanged until US-026.
4. **US-132:**
   - **PC-B game**, not "PC-A engine component" (30.2 precedent);
   - split 132a sim / 132b view;
   - the damage path = new `vitals.applyDot` (not `combat:hit`: `damageScale` + invuln);
   - numbers kept.
5. **US-133:**
   - fire tick **10 Hz**;
   - `ignite` = chance per fire tick per burning orthogonal neighbour;
   - no per-cell `fire:cell` bus event: a typed change list plus one `fire:area` event for tagged areas;
   - budget a 4096-cell tick <= 0.1 ms;
   - flammability: materials for cells, `components.flammable` for entities;
   - built by the game, saved through `serialize` when `world.fire` is set.
6. **US-136:**
   - the engine part = pure `explosionHits` + `applyImpulse`; `explosion:hit` is emitted by game code;
   - impulse = **8 m/s horizontal + 4 m/s lift** at the centre, clamped at 12/8 m/s;
   - **depends on US-078b** (`World.raySegment`).
7. **US-138:**
   - signature `sampleInto(x, y, z, tick, out)`, with the integer sim tick, not seconds;
   - the player push goes through the new `body.pushX/pushY` (integrate change, PC-A);
   - the shader gets values only; the upload lands with US-121.
8. **US-139:** a linear height ramp (no exp); <= 8 volumes; budget kept.

**Build order:** 053a -> 053b -> (053c PC-B) -> 055a1 -> 055a2 -> 133 -> 132a/b (PC-B) -> 134 -> 135 -> US-078b -> 136 -> 137 -> 138 -> 139/140. Each step ends with a green Node suite + check-deps; one browser/gpucompare pass per render step.

## 33. CLOTH-1 cloth physics: sim, colliders, deformable mesh, cloth system (architect, 2026-10-02)

Scope: CLOTH-1a (sim) and CLOTH-1b (render + content), split into steps in 33.6. CLOTH-1c (capes, skinned pins, limb capsules, tearing) gets its own note at planning; the seams it needs are named here. Uses US-138 wind (32.5), the mesh renderer (27), the sun map + dirty-skip (27.9a item 12), RE-06c winding (28.10).

### 33.1 Answers to the five ASK ARCHITECT lines
1. **Sim method: XPBD with small steps** (Macklin 2019: `substeps` x 1 iteration, default 4, range 2-8), structural compliance 0 (= inextensible), shear/bend compliance per preset, plus **one long-range tether per node** (distance to its nearest pin <= 1.02 x rest geodesic). Reason: plain Verlet + 4-8 Gauss-Seidel iterations sags and stretches on a 16-row chain (error falls with iterations, not with dt^2) and its stiffness changes with the iteration count, so presets would look different at another LOD; small-step XPBD costs the same per constraint (with compliance 0 the lambda term vanishes), presets mean the same at 2 or 8 substeps, and tethers make the 1.05/1.10 stretch ACs and the "3x size" stability AC hold by construction. Positions stay Verlet-style (`prev` array, implicit velocity), so this is "Verlet + XPBD constraints", not a different plan. Cost: ~2 100 constraints + 384 tethers per substep at 24x16, ~3-4 ns each -> 4 substeps ~0.04 ms (33.4).
2. **Colliders: a flat preallocated SoA list (`ClothColliders`: sphere / capsule / yawed box / plane) passed into `step`, owned and filled by the caller.** cloth.js imports nothing (27.10). The **engine cloth system** (`engine/world/cloths.js`, 33.5) fills it: static boxes/spheres from the cloth's content block (converted to world once at load) + the dynamic capsules the game hands it each step (the player body in 1b; NPC limb capsules in 1c). Ground is a **plane** per cloth (`nx,ny,nz,d`, fitted by the system from 3 `groundAt` samples at load), not a per-node heightfield callback: 384 nodes x 4 substeps = 1 536 `groundAt` calls per step would cost more than the whole sim.
3. **Render: one new draw type `DRAW_CLOTH`, an indexed MeshData layout `'cloth'` (pos + smooth packed normal rewritten when the sim moved, uv/idx static), drawn in both twins as kind 8 (KIND_MODEL) with face 7 + a per-fragment interpolated normal, two-sided by flipping N on back faces (GPU `gl_FrontFacing`; rasterJS the RE-06c snapped-area sign `A2 < 0`, captured before the swap).** GPU upload: one new device call `writeBuffer(handle, data, dstOffsetBytes)` (WebGPU `queue.writeBuffer` name; GL2 = `bufferSubData`), one write per cloth per changed version, never a new buffer per frame. Shadow: cloth items go into the shadow list and the shadow pass (cull none); the dirty-skip hash sees `meshVersion`, so a sleeping cloth costs nothing and an awake one re-renders the sun map every frame (the ME-15d "moving caster" cost, as a moving boulder). gpucompare: both twins draw the same Float32 arrays from one `updateClothMesh`, and a fixed pose (`cloth`, step 1b2) freezes the sim after 120 scripted steps, so parity is judged on geometry only, with the 27.7 bars.
4. **Ownership: an engine system, not an entity system and not game code.** `engine/world/cloths.js` owns the cloths (built by `World.load` from `cloths` content blocks, like `world.wind`), ticked by the game in the fixed step (`world.cloths.step(...)`, like `engine.particles.step()`). Not `engine/entities`: 1b cloths are world fixtures; 1c capes attach to an entity through the pin-target seam (`setPinTarget`), still owned by the same system. **Cloth is presentation-only, one-way coupled** (bodies push cloth; cloth never pushes anything or triggers gameplay). Therefore: **not saved** (re-created from content and pre-settled on load: 60 warm-up steps at zero wind), **not in `World.hashInto` / the RE-14 replay state hash** (its sleep depends on the camera); `hashInto(h)` exists per cloth and per system for the cloth tests and an opt-in replay check only. Sleep: distance from the eye (`sleepDist`, default 40 m), not drawn last frame (`addCloths` stamps `lastDrawn`), a `maxAwake` cap (default 6, nearest first), and rest-sleep (max node speed < 0.002 m/s for 60 steps with zero wind and no collider overlap) - the last one keeps indoor glyphs and the sun map stable.
5. **Tearing: deferred to 1c, agreed.** Determinism is not the problem (a fixed threshold in fixed order is deterministic); the cost is a topology change in the constraint arrays and the index buffer. 1a takes a static **`holes`** list instead (grid quads removed at create: their triangles, constraints only they owned, and nodes left with no constraint), which is enough for the torn balloon canvas; the ragged edge is the designer's material job (fray edge).

### 33.2 `engine/physics/cloth.js` (CLOTH-1a; imports nothing; check-deps rule 15 scope grows by this file: no trig, no `Math.random`, no wall clock, no `Math.hypot/exp/pow` in `step`)
```js
/** @typedef {Object} ClothDef                     plain numbers; the system resolves presets/frames before calling
 * @property {number} cols  @property {number} rows    2..24, 2..16 (MAX_CLOTH_NODES 384)
 * @property {Float64Array|number[]} rest           3*cols*rows world rest positions, node k = row*cols + col (the system lays them out, 33.5)
 * @property {number[]} pins                        node indices, >= 1 (pinned nodes have invMass 0)
 * @property {number[]} [holes]                     quad indices q = row*(cols-1) + col
 * @property {number} [seed=1]                      flutter hash seed
 * @property {number} [dt=1/60]                     fixed; step() takes no dt
 * @property {number} [substeps=4]                  2..8
 * @property {number} [shearCompliance=1e-6] @property {number} [bendCompliance=1e-4]   XPBD alpha; alphaTilde = alpha/h^2 at create
 * @property {number} [damping=2.5]                 1/s; per-substep factor 1 - damping*h (amended 1a1: 0.6 failed settle/rest)
 * @property {number} [gravity=-9.81]
 * @property {number} [drag=1.2] @property {number} [lift=0.2]   aero coefficients, 1/s (amended 1a1: unit node mass, acceleration per m/s of relative wind, each node averages its adjacent triangles; area-independent)
 * @property {number} [flutter=0.25]                0..1 per-node turbulence share
 * @property {number} [maxSpeed=8]                  m/s, displacement clamp per substep (pop guard)
 * @property {number} [thickness=0.03]              m, collision margin around every collider */
/** @typedef {Object} ClothColliders              createClothColliders(max=16); the caller writes, the cloth reads
 * @property {number} count  @property {Uint8Array} type   0 sphere, 1 capsule (segment), 2 box (yaw about z), 3 plane
 * @property {Float64Array} f                       12 floats per slot
 * @property {Float64Array} aabb                    6 per slot, filled by the setters (broadphase) */
export function createClothColliders(max) {}
export function setSphere(c, i, x, y, z, r) {}
export function setCapsule(c, i, ax, ay, az, bx, by, bz, r) {}      // player: a = (x, y, z+r), b = (x, y, z+h-r)
export function setBox(c, i, cx, cy, cz, hx, hy, hz, cosYaw, sinYaw) {} // the caller converts yaw (forwardOf); no trig here
export function setPlane(c, i, nx, ny, nz, d) {}                    // n.p >= d is outside
/** @returns {Cloth} */ export function createCloth(def) {}         // allocates everything; throws on a bad def naming the key
/** @typedef {Object} Cloth
 * @property {Float64Array} pos  @property {Float64Array} prev   3N
 * @property {number} n  @property {number} cols  @property {number} rows
 * @property {Uint8Array} quadOn                    (cols-1)*(rows-1), 0 = hole (render reads it once to build idx)
 * @property {Uint16Array} tri                      3T, front winding (render uses the same order)
 * @property {(wx:number, wy:number, wz:number, col:ClothColliders|null)=>void} step   one fixed step
 * @property {(p:number, x:number, y:number, z:number)=>void} setPinTarget   p = index into def.pins; kinematic
 * @property {(nx:number, ny:number, nz:number, d:number)=>void} setGround
 * @property {()=>void} sleep  @property {()=>void} wake   wake sets prev = pos (zero velocity): no pop
 * @property {boolean} asleep  @property {number} restSteps   consecutive calm steps (the system's rest-sleep reads it)
 * @property {number} version                       ++ per step that moved anything (render keys on it)
 * @property {number} maxSpeed                      last step's max node speed (m/s)
 * @property {Float64Array} bbox                    6, world, refreshed each step
 * @property {(h:{f64:Function,u32:Function})=>void} hashInto   pos + prev + version, fixed order (duck-typed hasher, as wind.js) */
```
Data layout (typed arrays, built at create): `pos, prev, rest` Float64 3N; `invMass` Float64 N; constraints SoA `ca, cb` Uint16 + `cr` Float64 rest length in contiguous ranges `[structural | shear | bend]`, one alphaTilde per range; structural ordered red-black (horizontal even, horizontal odd, vertical even, vertical odd) so Gauss-Seidel has no directional bias; bend = skip-one distance constraints (cheap, enough at ASCII resolution; dihedral bending is a 1c option); tethers `tPin` Uint16 + `tLen` Float64 N (Dijkstra over structural + shear rest edges at create, so holes are respected); aero `tri` Uint16 3T + `area` Float64 T (rest); scratch `force` Float64 3N, broadphase `Uint8Array(16)`. No per-step allocation, no closures made in `step`, no `Map/Set`.

### 33.3 `step(wx, wy, wz, colliders)` order (normative, fixed for determinism)
1. If `asleep`: return (version unchanged).
2. **Forces once per step:** gravity; per triangle `vrel = w - mean node velocity`, unit normal `n`, `F = area * (drag * dot(n,vrel) * n + lift * |dot(n,vrel)| * (vrel - dot(n,vrel) n) / max(|vrel|, 1e-6))`, a third to each node; per-node flutter multiplier on the aero share `1 + flutter*(2g - 1)`, `g` = smoothstep between hash knots `hash32(seed, k, floor(tick/12))` and the next knot, knot index offset by `col*3 + row*5` so neighbours are out of phase (`tick` = the cloth's own step counter; no `Math.random`). The caller samples wind once per cloth per step (32.5); the travelling wave comes from the aero coupling, not per-node wind samples.
3. **Broadphase once per step:** colliders whose `aabb` overlaps the cloth `bbox` grown by `thickness + maxSpeed*dt` -> local index list. Typical 0-2 survivors.
4. **Substeps** (h = dt/substeps), each: predict `x = pos + (pos - prev)*dampK + force*invMass*h^2` (prev = pos), clamp the displacement to `maxSpeed*h`; pins = targets interpolated linearly over the substeps; solve structural, shear, bend (XPBD, one pass each, lambda reset per substep); tethers (only shorten: if `dist > tLen`, project onto the sphere around the pin); collisions for the survivors (push out to `surface + thickness` along the shortest exit: sphere/capsule radial, box minimum-penetration axis in the box frame, plane along n; friction: halve the tangential part of `pos - prev` for contacting nodes).
5. Bookkeeping: `maxSpeed`, `bbox`, `restSteps` (++ when maxSpeed < 0.002 and the wind is 0 and there was no survivor in 3, else 0), `version++` when any node moved.
Rules: boxes thinner than `2*(thickness + maxSpeed*h)` (0.12 m at the defaults) can tunnel - walls are authored as boxes >= 0.2 m thick (the system validates); collision is node-vs-primitive only (edges between nodes may graze a thin pillar; the thickness margin hides it at ~8 cm node spacing); no self-collision in 1a (O(n^2) or a spatial hash breaks the budget; bend + the speed clamp stop the visible pops).

### 33.4 Budget (Node, warmed, warn-only unless `PERF_STRICT=1`, as 32.1)
| case | target |
|---|---|
| 24x16, 4 substeps, canvas preset, no colliders | <= 0.05 ms / step |
| same + 1 box + 1 capsule overlapping | <= 0.07 ms |
| 24x16, 8 substeps | <= 0.10 ms (warn) |
| system, 12 cloths placed, `maxAwake` 6 | <= 0.4 ms / step (12 awake <= 0.8 ms, warn) |

**Amendment (architect, 2026-10-02, CLOTH-1a1 review):** the 3-4 ns/constraint assumption was wrong; a bare SoA constraint loop measures ~11 ns on the PC-A machine (store-to-load chain on `pos`), and the 1a1 step is ~0.04 ms fixed (forces/aero/bookkeeping) + ~0.04 ms per substep. New rows (replace rows 1-4): 24x16 @4 substeps bare **<= 0.20 ms**; + 1 box + 1 capsule **<= 0.25 ms**; @8 substeps **<= 0.35 ms (warn)**; system: `maxAwake` 6 **and** `maxAwakeNodes` 768 (sum of `n` over awake cloths, nearest first; = two 24x16 or four 16x12) **<= 0.4 ms / step**. Substeps (4), shear, bend and tethers stay (the sag/stretch ACs depend on them). Still warn-only unless `PERF_STRICT=1`. Bars confirmed at the 1a1 re-review (2026-10-02): the architect measured 0.089-0.096 ms @4 and 0.157-0.161 ms @8 on PC-A (fixed ~0.015 ms + ~0.02 ms/substep); the 0.22/0.39 readings came from a loaded machine (parallel suites/agents). Take perf numbers with no other Node process running.

The sim budget (27.8) is 1.0 ms per step for everything incl. mesh collision, so the system caps awake cloths, not the content. Render (1b): `updateClothMesh` <= 0.005 ms per 24x16 cloth, upload 6 KB per awake cloth, cloth draws <= 0.05 ms GPU for two cloths at 240x90; the sun-map re-render while a casting cloth is awake is ME-15d's moving-caster cost, reported separately.

### 33.5 Render + content (CLOTH-1b)
- **`engine/mesh/clothMesh.js`:** `createClothMesh(cloth, id, matId, origin)` -> MeshData `{layout:'cloth', id:'cloth:<id>', pos: Float32Array 3N (mesh-local = world - origin, so f32 keeps sub-mm precision at x ~1500), nrm: Uint32Array N, uv: Float32Array 2N (rest-space metres, u along cols, v along rows; static), idx: Uint16Array (from `cloth.tri`, static), triCount, bbox, meshVersion, ranges:[{start:0, count:triCount}]}`; `updateClothMesh(mesh, cloth)` only when `cloth.version` changed: copy pos, area-weighted vertex normals in a Float64 scratch, normalise, `packNormalOct` (`engine/voxel/octNormal.js`), bbox, `meshVersion++`. Zero alloc. `validateMesh` learns the `'cloth'` layout.
- **`DrawList.js`:** `DRAW_CLOTH = 4`; `addCloths(list, system, planes, frameNo)`: frustum-test each cloth mesh bbox, push `{mesh, type: DRAW_CLOTH, matrix: identity + t = origin, planeIdOr: (0xD<<28) | (slot<<20), objectId: 0x9000 | slot, zBase: origin z, rangeFirst 0, rangeCount triCount}`, stamp `system.lastDrawn[slot] = frameNo`, and call `updateClothMesh` for drawn cloths. (`0xD` / `0x9000` are free: levels use structSeq&7, voxels 0xF / 0x8000|k<16, glTF 0xE, view model 0xFFFF, units >= 0x10000.) Order: after voxels, before terrain.
- **JS twin (`rasterJS.js`):** `DRAW_CLOTH` branch = the indexed path terrain already uses (smooth normal interpolated perspective-correct) with kind 8, face 7, mat from the mesh, uv from the mesh, `z = worldZ - zBase`, cull none, `flip = A2 < 0` captured before the swap -> N = -N; packed normal into GA.w (kind-8 face-7 convention, 27.16) and GI.z.
- **GPU:** `GpuDevice.writeBuffer(handle, data, dstOffsetBytes)` in the typedef, the mock (counts writes) and GL2 (`bufferSubData`); `MeshBuffers.getCloth(mesh)`: the first call creates a dynamic vertex buffer (16 B/vertex: pos f32x3 + nrm u32, the terrain stride), a static uv buffer and the static index buffer; later calls `writeBuffer` once when `meshVersion` differs from the entry's, from a per-entry preallocated ArrayBuffer. `mesh.vert.js` / `mesh.frag.js` gain a third variant `cloth` (template flag like `instanced`): aPos(0)/aNrmBits(2) from the dynamic buffer, aUV(1) from the uv buffer, flat data from a `uFlat` uvec2 uniform, smooth `out vec3 vNrmS`; fragment `N = normalize(vNrmS); if (!gl_FrontFacing) N = -N;`, face 7, `packNormalOct(N)` into GI.z and GA.w. `_passRaster`: a cloth loop after the RE-06 instanced loop, cull none; `_passShadow`: a cloth loop with the depth program (pos only, stride 16). `buildShadowList` takes `src.cloths` (every cloth whose bbox meets the shadow box, drawn or not; `castShadow:false` skips). Nothing in light/shade/edge changes (kind 8 face 7 is handled already; folds outline through depth only, one planeId per cloth).
- **`engine/world/cloths.js` (the system):** `createClothSystem(defs, world, presets)` -> `{count, cloths[], meshes[], lastDrawn: Int32Array, tick(tick, wind, eyeX, eyeY, eyeZ) (amended, see below), setBody(i, x, y, z, r, h), bodyCount, hashInto, stats:{awake, steps}}`; MAX_CLOTHS 16, MAX_CLOTH_BODIES 4. `World.load` builds `w.cloths` from `def.cloths` + each level's `cloths` (level-local through the structure frame, 32.0 item 6), after `w.wind` (2 lines in World.js; an empty system when absent, never null). Per cloth at load: preset numbers (`presets[key]`, engine defaults `silk/canvas/banner` when absent) merged with the block; rest layout (`plane:'vertical'` = cols along the yaw's right vector, rows down -z; `'horizontal'` = rows along forward; spacing `size[0]/(cols-1)`, `size[1]/(rows-1)`); static colliders to world (yaw via `forwardOf`); ground plane from 3 `world.groundAt` samples; 60 warm-up steps. `step`: per cloth in slot order: sleep rules (33.1 item 4; wake on distance, drawn, wind > 0 or a body overlapping its bbox), `wind.sampleInto(anchor, tick, scratch)`, body capsules into the collider slots after the static ones, `cloth.step`. Exported from `engine/index.js`: `createCloth`, `createClothColliders` + setters, `createClothSystem` + typedefs.
- **Content block** (world or level JSON, validated at load, throws naming the id; content, not state):
```json
"cloths": [{ "id": "stairwell.canvas", "preset": "canvas", "mat": "cloth.canvas", "cols": 16, "rows": 12, "size": [2.4, 1.8],
  "origin": [0, 0, 0], "yawDeg": 90, "plane": "vertical", "pins": [[0, 0], [7, 0], [15, 0]], "holes": [[3, 9], [4, 9]],
  "seed": 7, "castShadow": true, "sleepDist": 40,
  "colliders": [{ "type": "box", "c": [0, 0, 0], "half": [0.5, 0.1, 1.5], "yawDeg": 0 }, { "type": "sphere", "c": [0, 0, 0], "r": 0.3 }] }]
```
  pins/holes are `[col, row]`; `mat` is a MaterialTable key resolved at load; presets are designer data (`design/cloth.js` classic script -> `assets.clothPresets`, 32.0 item 6), numbers only.
- **Amendment (architect, 2026-10-02, CLOTH-1b3 review, 7690e1d):** the system method is **`tick(tick, wind, eyeX, eyeY, eyeZ)`** (not `step`). The renderer calls **`system.markDrawn(slot)`** (no frame number; it stamps the system's last tick); "drawn last frame" = stamped within `CLOTH_DRAWN_GRACE` = 8 ticks, so a cloth wakes one tick after its first draw. `setMesh(slot, mesh)`: the **system owns `meshVersion`** (bumps it when `cloth.version` changed); `updateClothMesh` only refreshes arrays. The cloth hash exists only as `sys.hashInto` (never `World.hashInto`). `World` constructor holds an empty system (`createClothSystem([], null, null)`) so `world.cloths` is never null. **Zero alloc** means no allocation by the system's own code (gated with stub wind and no body); V8 boxing of double arguments into `wind.sampleInto` / `setCapsule` (measured 65-320 B/tick, young-gen) is accepted, no unboxed API needed. **Ground** is the fitted terrain plane only (`World.groundAt` is terrain-only): a cloth whose hem can reach a structure floor (stair landing, tower floor) gets an authored static floor box (>= 0.2 m, below the floor top); cloths below the terrain surface (cellars) are not supported until a per-block ground override (a later step if content needs it). Sleep-boundary hysteresis (distance and cap) is not required for 1b (2 cloths); add it if a content pass places > `maxAwake` cloths in one view.
- **main.js (PC-B main session, 2 lines):** update, after the player integrate: `w.cloths.setBody(0, t.x, t.y, t.z, body.radius, body.height); w.cloths.tick(tick, w.wind, eye.x, eye.y, eye.z)`. Render: the pipeline adds cloths itself (`addCloths` in the mesh draw-list build, both twins). `dda` renderer: cloths not drawn (mesh-only, 32.0 item 3); the sim still sleeps by distance.

### 33.6 Steps (each <= ~1 programmer-day, ends with a green Node suite + check-deps; engine steps end in arch-review)
| step | track | size | content | tests / ACs |
|---|---|---|---|---|
| **CLOTH-1a1** sim core | PC-A (PC-B cross-track OK: stand-alone file) | 1 d | `cloth.js` create (grid, pins, holes, constraints, tethers, tris), 33.3 steps 1-2, 4 without collisions, 5; `hashInto`, sleep/wake; check-deps rule 15 scope +1 file | `engine/physics/cloth.test.js`: 1a ACs 1-6, 9, perf rows 1 + 3, zero alloc over 10k steps (`--expose-gc`), wake without pop (max displacement on the wake step < 1 mm), preset sag at 4 vs 8 substeps within 2 cm |
| **CLOTH-1a2** colliders | PC-A (or PC-B cross-track) | 0.75 d | `ClothColliders` + 4 setters, broadphase, 33.3 step 4 collisions + friction | 1a ACs 7-8, perf row 2, thickness rule (0.2 m box, 12 m/s wind, 10 s: 0 penetrations) |
| **CLOTH-1b1** JS render twin | PC-A | 1 d | `clothMesh.js`, `validateMesh` 'cloth', `DRAW_CLOTH` + `addCloths`, rasterJS branch, `buildShadowList` `src.cloths` + JS shadow twin | `clothMesh.test.js` (normals vs analytic on a cylinder drape within 1e-3, zero alloc, version gating); rasterJS: front/back views give opposite N, same kind/mat; RE-06c winding test extended to cloth (`dot(n, eye-p) > 0` <=> `A2 > 0`); shadow list keeps a cloth outside the camera frustum |
| **CLOTH-1b2** GPU twin | PC-A | 1 d | `writeBuffer` (typedef + mock + GL2), `MeshBuffers.getCloth`, shader variant, `_passRaster` + `_passShadow` loops, gpucompare mesh pose `cloth` (16x12 banner fixture, seed 1, 6 m/s wind, 120 steps from create then frozen, sun map on) | mock device: 1 create per buffer, 1 write per changed version, 0 writes asleep; `glsl.test.js` variant strings; `cloth` pose within the 27.7 bars, every existing pose unchanged; dirty-skip: asleep cloth -> map rendered once over 120 frames |
| **CLOTH-1b3** cloth system | PC-A (or PC-B cross-track) | 1 d | `engine/world/cloths.js`, `World.load` 2 lines, validation, presets, layout, ground fit, warm-up, sleep rules, `engine/index.js` exports | `engine/world/cloths.test.js`: layout at yaw 0/90/225, level-frame conversion, throws per key, sleep by distance / not drawn / maxAwake / rest, wake on body overlap, one `sampleInto` per cloth per step (spy), perf row 4, serialize has no cloth state |
| **CLOTH-1b4** designer | designer (PC-A) | ~0.5 d | `design/cloth.js` presets (silk/canvas/banner), `cloth.canvas` / `cloth.banner` materials + glyph ramp + fray edge in `design/detail-pass.js` / `design/palette.js` within the existing detail-pass vocabulary (a new detail-shader op = ASK ARCHITECT, separate PC-A step), `design/preview/cloth.html` (cloth.js + the rasterJS twin, wind slider, sun/torch toggle). Starts after 1a1 + 1b1; PO checks the preview before 1b5 | preview loads with no console errors; PO look |
| **CLOTH-1b5** placement | PC-B | 0.5 d | `cloths` blocks: stairwell canvas in `content/levels/tower.level.json` (pins, holes, wall/stair boxes), the ruin banner (its level or world JSON, wall box), main.js 2 lines | `content-canonical.test.mjs`; route-walk dda + mesh; 1b ACs 3-5 checked by the PC-A main session (GPU ms readout) + owner walk-test |

Order: 1a1 -> 1a2 -> 1b1 -> 1b2 -> 1b3 -> 1b5; 1b4 in parallel after 1b1.

### 33.7 AC changes for the PO (with reasons)
1. **1a AC1:** `cloth.step(wx, wy, wz, colliders)` - no `dt` argument; `dt` is fixed in the def (a varying dt needs Verlet velocity rescaling; the loop is fixed 60 Hz anyway).
2. **1a AC2:** "4-8 solver iterations" -> "2-8 substeps (XPBD small steps, 1 iteration each), default 4, plus one pin tether per node"; a preset must look the same at 4 and 8 substeps (steady-state sag within 2 cm).
3. **1a AC7:** ground = a plane per cloth (tilted allowed) set by the caller, not a per-node heightfield callback (cost, 33.1 item 2); walls/pillars are boxes >= 0.2 m thick (tunnelling rule, 33.3).
4. **1a AC8:** drop "min node spacing" (that is self-collision: O(n^2) or a spatial hash, over budget; 1c if capes need it). Keep the pop test, reworded: a pin moved at 3 m/s through the cloth plane and back gives max per-step displacement < 5 cm for unpinned nodes.
5. **1a AC10 (amended 2026-10-02, see 33.4 amendment):** 24x16 at 4 substeps <= 0.20 ms without colliders, <= 0.25 ms with 1 box + 1 capsule; "12 active <= 0.6 ms" -> the system keeps <= 6 awake (`maxAwake`) and <= 768 awake nodes (`maxAwakeNodes`), <= 0.4 ms; "off screen sleep + wake without pop" moves to 1b3 (cloth.js has no camera); 1a1 tests wake-without-pop only.
6. **1b AC1:** "casts shadow" holds with sun shadows `map` (`?shadows=map` until the ME-15d default flip); receiving light/shadow/torch tint comes from the existing light pass (kind 8 face 7).
7. **1b AC5:** 0.3 ms covers `updateClothMesh` + upload + cloth draws; the sun-map re-render while a casting cloth is awake is the ME-15d moving-caster cost, reported separately.
8. **1b AC2 (designer):** glyphs come from the material/detail-pass path; glyph choice by fold slope would be a new detail-shader op = separate PC-A step, not part of 1b2.

**Amendment (architect, 2026-10-02, CLOTH-1a2 review, 8075887):**
- **Item 4 (1a AC8) reworded:** the 5 cm bar is not reachable at 3 m/s pin speed, because a free hem following a 3 m/s pin already moves 5 cm per 60 Hz step (that is the motion, not a pop). New AC: same scripted pin path at 3 m/s, run with and without the colliders; with colliders, the max per-step displacement of unpinned nodes is **<= the collider-free run + 2 cm** and **<= 8 cm absolute**. The 1.5 m/s < 5 cm check stays as a regression line.
- **Through-walk (capsule walking through the hanging cloth):** <= 8 cm per step, accepted (= 4.8 m/s, below the 13.3 cm/step speed clamp).
- **Depenetration snap:** a collider that appears already overlapping is pushed out in one step (~13 cm max, unclamped by design: a clamp would leave nodes inside for several frames). 1b3 must therefore pass the **static colliders and the ground plane during the 60 warm-up steps**; a body capsule spawning inside a cloth gets the one-step snap (accepted, usually off-screen at load).
- **Ground:** `setGround` is not a survivor and does not block rest-sleep (a cloth lying on the floor must sleep). Plane colliders in the list are survivors always (aabb +-1e30); the system uses `setGround` for the ground, list planes only for authored tilted surfaces, and lists them as static (next point).
- **Rest rule vs static colliders (new field):** `ClothColliders.staticCount` (default 0): slots `< staticCount` are static (walls/pillars/planes, written once by the system); only survivors with slot `>= staticCount` reset the 3-step calm counter. Without it a banner touching its wall box never rest-sleeps (33.1 item 4 intent was "no *moving* collider overlap"). The system (1b3) writes static colliders first and sets `staticCount`, bodies after.
- **Friction is per step, not per substep:** "halve the tangential part" means x0.5 of the tangential velocity per **60 Hz step** of contact; per substep the factor is `FRICTION_KEEP[substeps] = 0.5^(1/substeps)` from a constant table (2..8; no `Math.pow` anywhere in cloth.js, rule 15 scans the whole file), so presets slide the same at 4 and 8 substeps.
- **Box exit:** minimum-penetration axis from the current position is kept; the flip at the box centre is covered by the >= 0.2 m wall rule (33.3) - per-substep travel is clamped to 3.3 cm vs a 0.13 m half-depth incl. thickness. Survivor list `Uint8Array(MAX_CLOTH_COLLIDERS = 64)` = the collider max, no overflow.

### 33.8 Do not
Import anything into `cloth.js`; call `world.groundAt` per node; let cloth push bodies or emit gameplay events; save cloth state; create GPU buffers or MeshData per frame (`writeBuffer` only); re-upload a sleeping cloth; use `gl_FrontFacing` on the GPU without the matching `A2` sign rule in rasterJS (parity); give cloth its own projection or light code; put cloth in `SPR` or the particle layer.

## 34. ED-SCALE-1 per-object uniform scale (architect, 2026-10-02; owner 2026-10-01 "I can't resize objects")

### 34.1 Data shape
- **Content:** optional `scale` (number) on a level prop (`props[].scale`) and on a world entity (`entities[].scale` inline shorthand, or `entities[].transform.scale`). Missing = 1. Uniform only. Range `PROP_SCALE_MIN = 0.25` .. `PROP_SCALE_MAX = 4` (defined once in `engine/world/World.js` next to the prop spawn, exported from `engine/index.js`). Stored rounded to 0.01.
- **Canonical files:** `scale` is written only when `!== 1` (the editor deletes the key at 1), so untouched content stays byte-identical. `stringify.js` needs no change (nested keys are id-first-alphabetical). No schema bump, no migration (additive optional field, same rule as `bounds`/`visibility`).
- **Runtime:** `entity.transform.scale` (optional, missing = 1). Readers use `const s = t.scale > 0 ? t.scale : 1` - never assume the key exists.
- **Save (CO-5):** `serialize.js` writes `transform.scale` only when `!== 1` (existing saves byte-identical); `deserialize` already spreads `ed.transform`. Save `version` unchanged; `migrateState` untouched.
- **Validation:** `World.load` throws `World.load: prop "<id>" scale <v> outside [0.25, 4]` on a non-number, non-finite or out-of-range value (same severity as an unknown model). `tools/validate-content.mjs` reports the same check (props + world entities). The editor clamps on input, so it never writes an invalid file.
- **Scope:** voxel models only (`components.voxel`, mesh-only voxel models included). Sprite/billboard props ignore `scale` in this story (World.load warns once per prop if `scale !== 1` on a sprite prop; the editor field is disabled with "voxel models only"). Lights, triggers, markers, interactables have no scale; an interactable that names a scaled prop keeps its own radius.

### 34.2 Where scale enters (one place: the pose)
Scale is folded into `computeVoxelPose` (`engine/voxel/voxelPose.js`) as `cellMEff = pm.cellM * s`: `_Aw = RzYaw * cellMEff`, `invCellM = 1 / cellMEff`. The pivot stays `pm.anchor` (feet), so a scaled prop stays on its floor. Everything downstream already derives from the pose and follows for free:
1. **FORWARD / L_k** -> `instanceRect` world AABB + screen rect (culling), `voxelMountWorld` (light anchors and E-prompts follow the scaled model).
2. **Mesh twins:** `addVoxelInstances` copies `FORWARD` into `item.partMatrices` and `rect` into `item.aabb`, so rasterJS and the GPU raster pass scale with no change. Normals: the GPU `normalize(mat3(uModel) * n)` stays exact for uniform scale; rasterJS must normalise the same way (test below).
3. **Shadow casters:** `VoxelPool.projectShadow` uses `instanceRect`, so shadow-list items carry the scaled matrices and AABB.
4. **dda (CPU `voxelMarch.js` + GPU `voxel.frag`):** supported, not clamped. The march runs in part-local cell space via L_k, so hit t is already right. Two fixes: the world normal `n_world = cellM * Amat^T * n_local` must use `pm.cellM * s` (else |n| = 1/s); hit u/v stay `local * pm.cellM` (model space: the surface pattern scales with the object, like the mesh path's baked uv). GPU: `VoxelTextures.writeInstanceRows` writes `s` into header `H2.z` (0 today); `voxel.frag` uses `cellM * H2.z` for `nWorld` only. Rule for the programmer: grep `cellM` in `voxelMarch.js`, `voxel.frag.js`, `rasterJS.js`; geometry/normal uses take the effective value, uv/texture uses the model value.
5. **Instance records:** every pose input/output record gets `scale` in its initial literal (stable hidden class): `VoxelPool` raw slots (`pushInstance(modelKey, x, y, z, yawDeg, clip, frame, tMs, scale = 1)`, `_queueEntity` from `t.scale`), the `list` and `_shadowSlots` out records (copied like `yawDeg`), `instances.js` `_idInst` (`scale: 1`). `castModels` and `viewModel.js` pass records through unchanged (view model stays 1).
6. **Shadow dirty-skip (27.9a amendment 4):** part matrices are hashed with the fixed `_qA = 256` quantum, but their entries are ~`cellM * s` (~0.1), so a scale change under ~4 % can leave the sun map stale. Fix in `shadowInputHash`: part-matrix quantum `invA = max(_qA, r * _qT / colNorm)`, `colNorm = hypot(A0, A3, A6)` of that part matrix, `r` = the item aabb half-diagonal (world error of a quantised part matrix is about `q * r / colNorm`). Zero alloc, a few flops per part. **Amendment (architect, 2026-10-02, ED-SCALE-1a review):** as built, `colNorm` is snapped down to a power of two (`2^floor(log2 colNorm)`), so `invA = max(_qA, r * _qT / pow2floor(colNorm))`: the world error stays <= `tStepM` (the snap only makes the quantum up to 2x finer), it is constant within an octave so static props hash stably, and a scale change moves the quantised entries by ~`s^2` (entries and `r` both scale) instead of ~`s`. The part-matrix quantum is independent of the item-matrix quantum `max(_qA, r * _qT)` (27.9a amendment 4); both are mixed into the same hash. Tests must scale the item `aabb` together with the part matrix (real data does).
7. **Instanced groups (`DRAW_INSTANCED`, RTS units):** no scale (`writeUnitInstance` unchanged); placed props never go through InstanceGroups.
8. **Colliders / physics:** static props have no collider today (render-only; `raycastColliders`, `supportAt` and mesh physics see structures and terrain only), so there is nothing to scale. Dynamic props (`dynamic: true`, roller): `body.radius = p.radius * s` at spawn. A future prop-collider story must build from the same scaled pose (`FORWARD`), never from `pm.cellM`.
9. **Picking / highlight (editor):** the surface pick (GPU readback / `fb.gbuf` -> `resolveVoxelSlot`) is automatic. The ray/cylinder fallback (`tools/editor/ray.js` `rayPickEntities`) and the highlight box (`tools/editor/select.js` model extent) multiply radius and height by `s`.
10. **Thumbnails / model picker:** show the model, not the instance - unchanged.

### 34.3 Editor UX (PC-B, `tools/editor/`)
- **Ladder:** `SCALE_STEPS = [0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]` in a small pure module `tools/editor/scale.js`: `nextScale(cur, dir)` -> next ladder value strictly above/below `cur` (works for off-ladder values), `fineScale(cur, dir)` -> `cur +- 0.05`, `clampScale(v)` -> clamp to [MIN, MAX] + round to 0.01 (MIN/MAX imported from `engine/index.js`).
- **Keys:** `Minus`/`NumpadSubtract` = down, `Equal`/`NumpadAdd` = up (ladder); with Shift = fine +-0.05. In the `main.js` key block next to Q/E yaw. Flash `scale: 1.25x`. Nothing selected / non-voxel item -> flash, no record.
- **Tool mode:** ribbon button `data-mode="scale"` (`Scale`, after Yaw). LMB drag on the selected prop: `s = clampScale(start * 2 ** (dx / 200))`, live preview by writing `transform.scale` + `world.renderVersion++`; release commits ONE record; Esc restores `startScale` (same shape as `yawDrag`).
- **Panel:** the Position card gets a `Scale` row (number input, step 0.05, min 0.25, max 4) under yaw, for voxel props and world entities; blur/Enter commits through `clampScale`.
- **Undo:** a field edit through the existing record path (`makeFieldEditRecord('scale', ...)`); at 1 the record's `after` has the key deleted (`after = { ...item }; delete after.scale;` then `makeRecord`), so undo/redo round-trips to the exact original object.
- **Live patch:** add `'scale'` to `PROP_LIVE_FIELDS`; `applyPropTransformPatch` sets `transform.scale = typeof item.scale === 'number' ? item.scale : 1` (no rebuild, no structure version bump). World entities use the same patch path.
- **Save:** unchanged (`stringify.js`); a test proves the 1 -> 1.5 -> 1 cycle saves byte-identical.

### 34.4 Steps (each <= ~1 programmer-day, Node suite + check-deps green; engine steps end in arch-review)
| step | track | size | content | tests / ACs |
|---|---|---|---|---|
| **ED-SCALE-1a** pose + render | PC-A (engine/voxel, engine/render, engine/mesh) | 0.75 d | 34.2 items 1-7: `computeVoxelPose` scale, VoxelPool record field + `pushInstance` arg, voxelMarch normal, `VoxelTextures` `H2.z` + `voxel.frag` normal, `shadowInputHash` part quantum, gpucompare pose `voxelScaled` (one prop at 2x, one at 0.5x) | `voxel.test.js`: s = 2 doubles the AABB extents about the anchor (feet z unchanged), s = 1 / undefined bit-identical FORWARD and L_k to today; voxelMarch at s = 2 hits at the analytic t with unit normals (1e-9); rasterJS: s = 2 normals == s = 1 normals; `VoxelTextures.test.js`: `H2.z == scale`; `shadowDirty.test.js`: 1.00 -> 1.01 changes the hash, an unchanged scaled prop does not; zero alloc (`--expose-gc`) in `project`/`projectShadow`; `voxelScaled` within the 27.7 bars, every existing pose unchanged |
| **ED-SCALE-1b** data + save | PC-A (engine/world; PC-B cross-track OK) | 0.5 d | 34.1: World.load `props[].scale` + world entity `scale` -> `transform.scale`, range throw, sprite warn-once, dynamic radius, `PROP_SCALE_MIN/MAX` export, `serialize.js` write-when-not-1 | `world.test.js`: scale reaches `transform.scale`, missing = 1, 0.2 / 5 / NaN / "2" throw, roller radius scaled; `serialize.test.js`: round trip keeps 1.5, an unscaled world's save is byte-identical to before; `index.exports.test.js` lists the 2 constants |
| **ED-SCALE-1c** editor + validator | PC-B (tools/editor, tools/validate-content.mjs) | 1 d | 34.3 + 34.2 item 9 + the validator check; starts once 1a + 1b are on master | `scale.test.mjs` (ladder up/down from on- and off-ladder values, clamp at both ends, fine step, rounding); commands/undo tests: key step + undo restores the exact item (no `scale` key), 1 -> 1.5 -> 1 save byte-identical; `livepatch.test.mjs` scale field; `ray.test.mjs` scaled pick cylinder; validator flags 0.2 and 5; ONE browser pass: resize a tower prop by keys, drag and panel, Ctrl+Z, Ctrl+S, reload, playtest on mesh and dda - shadow follows |

Order: 1a and 1b in parallel (disjoint files), then 1c. The PO checks the owner AC ("I can resize objects", undo, save) on 1c.

### 34.5 Do not
Add per-axis scale; scale `pm.cellM` or rebuild/re-pack a voxel model per instance (one MeshData per model stays shared); add a scale uniform to the mesh shader (the part matrix already carries it); scale uv/texture coordinates; write `scale: 1` into content or saves; bump the save version; let the editor write an unclamped or unrounded value; add colliders for static props in this story.

## 35. WATER-2: water mesh layer, flow, waves, waterfalls, underwater (architect, 2026-10-02; US-055a2 re-scope, US-141..144)

**Owner decision (2026-10-02, relayed by the main session; the main session records it in `decisions.md`): US-143 waves use a displaced, see-through water MESH in the mesh renderer, not a shade-pass perturbation of the 32.2 plane.**

The architect agrees on the merits. One geometry gives three things through one pass and one composite:
- true silhouettes (crests hide troughs at grazing views);
- the view from below (back faces);
- the waterfall sheet.

The cost is one extra cell-resolution pass (35.3).

**No analytic-plane fallback is kept.** Water is mesh-only (32.0 item 3: a no-op on `dda`). Physics never used the plane; it uses `waterAt`.

### 35.0 What changes in 32.2
- **US-055a1 (in dev): no change.** `waterAt(x, y, out)`, the SoA, `find`, `collectWaterDefs` and the `waterDef` round trip stay as written.
  - US-143a later adds `out.flatZ` and makes `surfaceZ` live (35.2).
  - 141a/143a add the 35.1 keys to `collectWaterDefs`. 055a1 already ignores unknown keys, and `waterDef` is a raw clone, so saves round-trip them today.
- **US-055a2 is re-scoped before it starts: 055a2a (water layer pass, flat) + 055a2b (composite).**
  - The 32.2 composite rules stay: alpha by path length, shallow/deep mix, `seeThrough`, glint, `bg`, the three call sites, own fog, edge suppression, look table.
  - Only **the hit** changes. It comes from the WATER texel (35.3), not from `dW = (z - eyeZ)/zDir`.
  - The 32.2 do-nots still hold: no water in the main G-buffer, the draw list or the shadow list. Physics, picking and edges stay on the real floor.

### 35.1 Data (content, validated at load in `water.js`; throws naming the id)
- **Region keys added to the 32.2 shape:**
  - `flow: [vx, vy]`: m/s, `|v| <= 6` (141a adds the cap).
  - `flowRadial: s`: m/s, circle only, + is outward from `c`, `|s| <= 6`. For plunge pools; it adds to `flow`.
  - `waves`: `"none"|"calm"|"breezy"|"storm"|"sea"`, default `"calm"`. `"sea"` follows the world sea state (35.2).
  - `waveDirDeg`: compass bearing the waves travel toward, default 0. A level frame adds `90*yawSteps`.
  - `seed`: int, default 1 (wave phases).
- **`waterfalls: [{id, lip: [x0, y0, x1, y1], z, drop, outDeg, out, look}]`:**
  - `drop` is 2..20 m.
  - `outDeg` is the compass direction the water leaves the lip.
  - `out` is the lip speed in m/s, default 1.5.
  - Max 8 per world. Level blocks go through the frame like `water`.
  - Content: `World.waterfallDef` round-trips like `waterDef`.
- **Spectrum and states:**
  - Engine defaults are frozen in `water.js`.
  - Override: `assets.waterWaves` (designer data). `main.js` resolves it to numbers (32.0 item 6), and `World.load` validates it.
```js
WAVE_SPECTRUM = [{offDeg: 0, lambda: 24}, {offDeg: 25, lambda: 13}, {offDeg: -40, lambda: 6}, {offDeg: 70, lambda: 3}]; // speed = sqrt(9.81*lambda/(2*PI)) at load
WAVE_STATES   = {calm: [0.012, 0.009, 0.006, 0.003], breezy: [0.05, 0.035, 0.022, 0.013], storm: [0.24, 0.12, 0.06, 0.03]}; // sums 0.03 / 0.12 / 0.45 m
```
  - The main wave has lambda 24 m, so its period is T = 3.9 s (the AC asks for 3-8 s).
  - All regions share one spectrum, and a state is only an amplitude vector. Blending between states therefore never jumps phase.
- **Per-region compile at load (may use trig and allocate):**
  - `dir_i = forwardOf(waveDirDeg + offDeg_i)`;
  - `kx_i, ky_i = dir_i / lambda_i` (cycles/m);
  - `om_i = speed_i / lambda_i` (cycles/s);
  - `phi_i` = 4 draws of `createRng(seed ^ fnv1a(id))`.
  - These go into `wk: Float64Array(n*16)`. The live amplitudes go into `wa: Float64Array(n*4)`.
- **World key `seaState`** (optional, default `"calm"`): the initial global state.

### 35.2 Wave field + clock (`engine/world/waves.js`, new)
The check-deps rule 15 scope adds this exact file: no trig, no `exp`, no `Math.random`, no wall clock.

**Normative formula.** The JS and GLSL twins use the same expression order.
```
t = tick * STEP
u_i = fract(kx_i*x + ky_i*y - om_i*t + phi_i);  w = 2u - 1     // fract(a) = a - floor(a)
S(w) = 4w(1 - |w|);  dS(w) = 4 - 8|w|                          // parabolic sine: C1, |S| <= 1
h  = sum A_i S(w_i);  hx = sum A_i dS(w_i) 2 kx_i;  hy = sum A_i dS(w_i) 2 ky_i;  n = normalize(-hx, -hy, 1)
A_i = wa[i] (physics, waterAt)  |  wa[i] * fade_i (render geometry + normal, 35.3)
```

**API (zero allocation):**
- `waveSampleInto(wt, r, x, y, tick, out) -> out {h, hx, hy}`
- `waveHeight(wt, r, x, y, tick)`
- `wt` = `world.water`, `r` = region index.

**Clock.** `world.water.step()` runs once per fixed step. It is one `main.js` line in the update, before the player `integrate`.
- It increments `tick` (a plain integer).
- It advances the sea blend. `setSeaState(state, blendSec)` sets:
  - `from` = current amps, `to` = the state's amps;
  - `steps = max(1, round(blendSec/STEP))`.
- Each step computes `s = step/steps`, `ss = s*s*(3 - 2s)`, `amps = from + (to - from)*ss`, and copies the result into the `wa` rows of the `"sea"` regions.
- Other regions keep their own state's amps, set at load.

**Live `waterAt` (143a):**
- `surfaceZ = z + h`, `flatZ = z`, `depth = surfaceZ - floorZ`.
- The floor probe still starts at `flatZ + 0.01`.
- Budget: <= 0.01 ms for 32 regions.

**`World.flowAt(x, y, out2) -> boolean` (141a):**
- Uses the same `find`.
- Result: `flow + flowRadial * (p - c)/|p - c|` (0 at the centre).
- Outside water: `[0, 0]` and returns false.
- Zero allocation, <= 0.005 ms.

### 35.3 Render: the water layer (mesh only)

**Files:**
- `engine/mesh/waterMesh.js`: pure builders for the clipmap and the sheet.
- `engine/render/water.js`: per-frame select, slot table, uniforms, the JS vertex twin, the under state (35.6).
- `gpu/glsl/water.vert.js` + `water.frag.js`.
- `GpuCellPipeline._passWater()`, on the mesh branch, right after `_passDeriv()` and before `_passLight()`.
- rasterJS item type `DRAW_WATER`.
- `waterComposite` (32.2) reads the layer.

**Clipmap.** One static indexed mesh, built and uploaded once.
- Geometry:
  - 4 rings, 64 quads per side;
  - steps 0.5 / 1 / 2 / 4 m, half-sizes 16 / 32 / 64 / 128 m;
  - a flat skirt (8 triangles) from +-128 m to +-1900 m.
- Vertex attributes:
  - local `(lx, ly)`;
  - `ring`;
  - `stitch`: the neighbour direction for odd vertices on a ring's outer boundary, else 0.
- Index ranges are kept per ring.
- Size: about 13.6k vertices and 26.6k triangles.
- **Origin `O` = the eye xy snapped to 8 m.**
  - Every vertex sits on a fixed world grid, so the surface is world-anchored and does not swim.
  - The rings nest exactly.
  - The eye is always within 4 m of `O`, so the 0.5 m ring covers at least 12 m around it.

**Draws.**
- `selectWater(world, cam, out)` fills **slots 0..11**:
  - up to 8 regions in the frustum (the region holding the eye first, then by nearest AABB);
  - up to 4 sheets.
- Each region gets one clipmap draw, using only the ring ranges that overlap its AABB.
- Uniforms per draw:
  - `O`, region `z`, the AABB grown by 0.5 m, shape params, slot;
  - 4 x `(kx, ky, A, c)`, where `c_i = fract(kx*Ox + ky*Oy - om*t + phi)` is computed **in f64 on the CPU**. The GPU then only sees small local coordinates, which is f32-safe.
- No per-frame vertex upload, ever.

**Vertex stage** (GLSL and `waterVertexJS`, same expression order):
1. `l' = clamp(O + l, aabb) - O`. Vertices outside the AABB collapse, so their triangles become degenerate.
2. `u_i = fract(kx*l'x + ky*l'y + c_i)`, then the 35.2 formula.
3. Fade by Chebyshev distance `q = max(|l'x|, |l'y|)`: `fade_i = clamp(2 - q/(8*lambda_i), 0, 1) * clamp((120 - q)/16, 0, 1)`.
4. A stitch vertex takes the mean `z` of its two neighbours (2 extra evaluations). This makes the ring seams watertight.
5. The skirt is flat.

**Fragment stage:**
1. World xy = interpolated `l'` + `O`.
2. Region shape test (rect or circle); discard outside.
3. **Occluder:** discard if `vD >= DEPTH(cell)` (the resolved scene depth, in DEPTH units).
4. Analytic normal per fragment, with the same formula and the same fade.

**Target WATER:**
- RGBA32UI at **cell resolution** (`cols x rows`, n = 1).
- The sample point is the cell's DEPTH sample (27.15.0 item 1).
- It has its own depth24, cull none, and is cleared every frame.
- Channels:
  - `x` = `floatBits(vD)`;
  - `y` = oct normal (always the up-facing one);
  - `z` = `floatBits(h)` (sheets: arc metres `v`);
  - `w` = `slot | back << 4 | sheet << 5`.
- The water-vs-water depth test makes waves self-occlude. That gives the real silhouettes.

**JS twin.** rasterJS `DRAW_WATER`:
- vertex stage = `waterVertexJS`;
- then the same clip, the occluder against `fb.depth.depth`, and the normal;
- writes into `createRasterTarget(cols, rows, 1)`, which `waterComposite` reads.

**Composite** (`waterComposite`, 32.2 rules) on the layer:
- **Hit:** `dW < rawDepth` (sky counts as `Infinity`). `P = cellRayP(cell, dW)`.
- **Slot table** `uWaterSlots[12]`: look, `ampSum`, flow data, kind.
- **Sun term:** uses the WATER normal.
- **Glint:** `dot(n, H) > look.glintCos`, with `H` computed per frame from the sun direction and the camera forward. This replaces the 32.2 "hash > 0.9" rule when `waves != none`.
- **Glyph for opaque water:**
  - when `ampSum >= 0.05`: `look.bands[floor(clamp(h/ampSum*0.5 + 0.5, 0, 0.999)*n)]`, so rolling bands move with the crests;
  - otherwise the 32.2 hash ramp;
  - flowing water uses 35.4.
- **Shore foam (143b2):**
  - column along the ray = `zW - P(rawDepth).z`;
  - where it is below `look.foamDepth` (0.3): `look.foamRamp` (`* o .`), indexed by `column/foamDepth`;
  - it pulses on its own because the surface moves.
- **Crest foam:** where `h > look.crestK*ampSum` and `ampSum >= 0.2`.
- **Foam fade:** from `look.foamFar` (40 m) to 1.5 times that distance.
- **Light:**
  - shadow on water in v1 = the floor cell's `sunlit` bit;
  - point lights on water come later.
- **Until 144a:** slots whose region holds the eye below `surfaceZ` are skipped, as in 32.2.

### 35.4 Flow look (141a)

**Per slot, on the CPU (f64):**
- `fhat` and `|f|`;
- `o = (|f|*t) mod (1024*L)`;
- `L = look.streakLen` (1.0 m), `W = look.streakW` (0.35 m).

**Shade, when `|f| >= 0.05`:**
1. `a = dot(P.xy, fhat)`, `b = dot(P.xy, fperp)`.
2. `key = hash(int(floor((a - o)/L)) & 1023, int(floor(b/W)) & 1023, SALT_FLOW)`.
   - There is no time bucket.
   - `& 1023` makes the hash periodic, so the wrap of `o` is seamless.
3. If `key01 > look.streakK`, the glyph is `look.streak`; otherwise the wave ramp.

**Radial regions:**
- `a = |P - c|`, `b = r * dia(P - c)/W`, where `dia` is the diamond angle in [0, 4) (no atan).
- `o` uses `flowRadial`.
- In v1, radial wins when it is set.

**Still water** (`|f| < 0.05`) keeps the 32.2 time-bucket hash.

### 35.5 Waterfalls (142a1)
The waterfall does need an engine hook. The hook is a sheet mesh in the same water layer.

**Sheet mesh** (`buildSheetMesh(def)` at load; world coordinates; static):
- columns every 0.5 m along the lip;
- rows every 0.5 m of arc down the ballistic profile: `d(tau) = out*tau` toward `outDeg`, `z(tau) = z - 4.9 tau^2`, down to `drop`;
- a 6 m x 20 m fall is about 1k triangles.

**Drawing.** In `_passWater`, after the regions:
- slots 8..11, with the sheet flag;
- cull none;
- same occluder rule;
- no waves.

**Composite for sheets:**
- `uLip` = distance along the lip from `P`. The lip origin and direction are per slot.
- Glyph = `look.fallRamp` (`| : '`), picked by `hash(floor(uLip/0.25) & 1023, floor((v - o)/0.6) & 1023, SALT_FALL)`.
  - `o = (look.fallSpeed*t) mod (1024*0.6)`, computed in f64 on the CPU.
  - `fallSpeed` >= 8.
- 2-3 brightness levels from the hash.
- Emissive highlight (`look.highlight`, unlit) when `hash01 > 0.92`.
- `look.sheetAlpha` (0.75) over the scene cell behind the sheet:
  - from outside, the alcove shows through;
  - from inside, the landscape shows through;
  - both sides use the same rule.

**Content (142a2):** spray, mist, plunge-pool ripples and the radial-flow pool. These are particles plus a circle region with `flowRadial`.

### 35.6 Underwater view (144a)

**State** (CPU, `render/water.js`, presentation, not saved):
- Per frame: `waterAt(eye)`.
- **Enter** when `eyeZ < surfaceZ - 0.05 && depth >= 0.3`.
- **Leave** when `eyeZ > surfaceZ + 0.05`, or when there is no water.
- Result: uniform `uUnder` plus the under-look of the eye's region.
- Both twins read the same flag, so the transition has parity by construction.

**Shade when under** (all three call sites, after the cell's own colour):
1. `L` = metres from the eye to `P(min(rawDepth, dW))`.
2. `s = min(1, L/look.underFog)` (12 m), `f = s*(2 - s)`. This is an ease-out ramp with **no `exp`** (the parity rule of 32.6).
3. `fg = mix(fg, tint*(ambient + sunTerm), f)`; `bg` the same, times `bgK`.
4. If `f >= look.swapAt` (0.5): glyph = `look.bubbleRamp[floor(lum(fg)*n)]`.
5. **Light shafts** (sun elevation > 0 only):
   - `Pm = P(min(L, 6 m))`;
   - if `hash(floor(dot(Pm.xy, sunPerp)/look.shaftW) & 1023, floor(t*0.5)) > look.shaftK`, then `fg += look.shaft*(1 - f)*0.5`.

**Surface from below** (a back-face WATER texel):
1. Glyph = `look.ceilRamp`, picked by the `h` band.
2. Inside the Snell window (`|ray.z| >= 0.66`): `fg = mix(sceneFg, look.ceil*(ambient + sun*n.z), look.ceilAlpha)`.
3. Outside the window: mirror-dark (`tint*0.6`), with no see-through.
4. Then the under fog over `dW`.

**Edges:** suppressed where `f >= swapAt`.

**Sprites and particles (144a2):** their colour is computed on the CPU. `SpritePool.project` and `particleLayer.build` apply the shared `underFogK(L, look)` from `render/water.js`, so parity is exact.

### 35.7 Physics and sim hooks

**Current push (141b2, game; no engine change):**
- Every step, when wading or swimming: `world.flowAt(x, y, f)`.
- `body.pushX/pushY = windPush + k*f`, clamped at 3 m/s. `k` and the cap are game tuning.
- It uses the 32.5 displacement path (US-138b), so walls block it as usual.

**Particles (141b1, `engine/fx`):**
- EmitterDef gains `flow` (0..1, default 0).
- `particles.sampleFlow(field)`: for each live emitter with `def.flow > 0`, `field.flowAt(ex, ey, out)` gives the emitter's flow vector. `field` is duck-typed, so rule 16 still holds.
- Drift target = `wind*def.wind + flow*def.flow`.

**Bobbing (143c):** the 055b swim lock already reads `surfaceZ`, so bobbing is automatic once `surfaceZ` is live.
- Floating entities are game code (`game/js/quest/sim/floaters.js`, PC-B): `components.floats {draft}` sets `transform.z = surfaceZ - draft` each step, with no tilt.
- Props after US-051: the same push plus buoyancy on `surfaceZ` (seam only).

**Render vs physics:**
- Heights agree to float error within `8*lambda_i` of `O`. For the main wave that covers the whole clipmap.
- Short waves fade from 24 m. A far floater can therefore be off by up to the faded amplitudes (storm: at most 0.09 m beyond 24 m).
- Known and accepted.

### 35.8 Save / hash
- **Content, never hashed:** regions (`waterDef`), `waterfallDef`, the spectrum and states.
- **State:** `water.tick` plus the sea state `{from[4], to[4], step, steps}`.
  - Serialised as `waterState` **only when `water.count > 0`**, so old saves stay byte-identical.
  - Restored before the first step, so the bob is continuous across a load.
  - `water.hashInto(h)` covers the same fields, for the RE-14 replay hash. The game adds it where it hashes the world.
- **Not saved:** the under flag, `O` and the slot selection. All three are derived per frame.

### 35.9 Budgets (p95, 400x150, owner iGPU; the JS twin is warn-only)
| Item | Bar |
|---|---|
| `_passWater` | 1 pond <= 0.1 ms; sea + 2 regions + 1 fall <= 0.25 ms |
| Composite extra in shade | base 0.1 (32.2) + flow 0.05 + wave shading 0.05 + under 0.1 ms |
| JS on the GPU path | `selectWater` + uniforms <= 0.05 ms; zero per-frame uploads; <= 12 draws (normally 1-3) |
| `waterAt` live / `flowAt` / `water.step` | 0.01 / 0.005 / 0.002 ms |
| JS twin (gpucompare and tests only) | <= 2 ms at 160x60 |

- Zero allocation everywhere after load.
- The 141a and 143b AC numbers (+0.05 / +0.15 ms) are measured in the shade pass only. The story reports the pass cost separately.

### 35.10 gpucompare poses (mesh)
**Bars:** the 27.7 bars, plus for the water layer: depth within 1 %, and flags equal on >= 99.5 % of cells (edge cells excluded).

**Tick:** frozen with the dev hook `water.setTickForTest(tick)`. Never wall time.

**Poses:**
- `water`: test pool, grazing and top-down views, waves `none` and `calm` (055a2b). 141a adds a flowing region at tick 600.
- `waves`: sea level, calm and storm at tick 600. One grazing view (crests hide troughs) and one beach view (foam).
- `waterfall`: one view in front of the sheet, one from behind it.
- `underwater`: eye 1.5 m below a pool surface, looking up 30 degrees (ceiling) and level (fog).

Existing poses must stay unchanged when a world has no water.

### 35.11 Steps (each <= ~1 programmer-day; Node suite + check-deps green; engine steps -> arch-review)
| # | Step | Track | Size | Scope / tests |
|---|---|---|---|---|
| 1 | US-055a1 | PC-A (in dev) | 0.5 d | As 32.2, unchanged. |
| 2 | US-055a2a water layer | PC-A | 1 d | Clipmap builder; `_passWater`, WATER target and shaders with flat `A = 0`; region clip; occluder; `DRAW_WATER` twin; `selectWater` slots and ring ranges. Tests: seams watertight (ring-seam fixture, every pixel written exactly once); vertex world positions unchanged while the eye moves < 4 m; a wall hides water; circle clip; no per-frame buffers on the mock device; zero allocation. |
| 3 | US-055a2b composite | PC-A | 0.75 d | 32.2 composite on the layer; look bind; edge suppression; pose `water`. |
| 4 | US-143a wave field | PC-A | 0.5 d | `waves.js`; spectrum/state compile; `water.step`, `setSeaState`, `hashInto`, `setTickForTest`; live `waterAt` + `flatZ`; `waterState` save. Node tests: same hash on 2 runs; `|h| <= ampSum`; blend continuity; save round trip; rule-15 scope. Can run in parallel with step 2 (disjoint files). |
| 5 | US-141a flow | PC-A | 0.75 d | `flow` cap; `flowRadial`; `World.flowAt`; slot flow uniforms; streak hash (incl. radial); pose `water` + flow. |
| 6 | US-141b1 particle flow | PC-A | 0.25 d | `def.flow` + `sampleFlow`. Tests: drift; zero allocation. |
| 7 | US-141b2 currents in play | PC-B | 0.5 d | Push via `pushX/Y` (needs 138b and 055b); water emitters with flow; river test level. |
| 8 | US-143b1 displacement | PC-A | 1 d | Vertex waves, fade, stitch; fragment normal; both twins. Tests: twin vs `waveHeight` at vertices within 1e-5 m; seams watertight with waves on; pose `waves` geometry. |
| 9 | US-143b2 wave shading | PC-A + designer ramps | 0.75 d | Sun on N; `dot(n, H)` glint; bands; shore and crest foam; foam fade; pose `waves`. |
| 10 | US-143c waves in play | PC-B | 0.75 d | Wind -> `setSeaState` mapping; floaters; debug storm key; sea test level; bob jitter <= 0.02 m test. |
| 11 | US-142a1 waterfall sheet | PC-A | 0.75 d | `waterfalls` block; sheet mesh; sheet composite; pose `waterfall`. |
| 12 | US-142a2 waterfall content | PC-B + designer | 0.75 d | Preset; lip and foot emitters; plunge pool (`flowRadial`); ripple rings; test cliff; preview page. |
| 13 | US-144a1 underwater view | PC-A + designer | 1 d | Under state + hysteresis; fog, tint, glyph swap, shafts; ceiling; edges; pose `underwater`. |
| 14 | US-144a2 under sprites/particles | PC-A | 0.5 d | `underFogK` in sprites and the particle layer, with tests. |

**Order:**
- Engine: 1 -> 2 -> 3 -> 5 -> 8 -> 9 -> 11 -> 13 -> 14, with step 4 running in parallel with step 2.
- The game steps (7, 10, 12) follow their engine steps.
- 142b and 144b stay as written (PC-B).

### 35.12 Do not
- Write water into the main G-buffer, the draw list, picking, physics or the shadow list.
- Displace or upload water vertices on the CPU per frame.
- Feed world-space phases or `t` to the GPU in f32. Fold `O` and `t` into `c_i` in f64 instead.
- Use `Math.sin/cos/exp/random` or wall time in `waves.js`, `water.step` or the queries.
- Use `exp` fog.
- Save the under flag or the slot selection.
- Move the clipmap unsnapped.
- Give each region its own mesh. There is one shared clipmap; sheets are the only per-def meshes.

### 35.13 AC changes for the PO (relay)
1. **US-143b:**
   - Replace "shade-pass normal/height perturbation or mesh vertex displacement, architect decides" with "displaced see-through water mesh (owner decision 2026-10-02, arch 35.3)".
   - Split into 143b1 (displacement) and 143b2 (shading + foam).
2. **US-143a:**
   - `waves` = `none|calm|breezy|storm|sea`, default calm.
   - All presets share one 4-wave spectrum; a state is an amplitude vector.
   - `"sea"` regions follow `world.water.setSeaState(state, blendSec)`. This is engine work and lands in 143a, not 143c.
   - Overrides come in as `assets.waterWaves`; engine defaults exist.
   - The time base is the integer step tick (`water.step()`).
3. **US-143c:** game side only: wind/weather -> `setSeaState`, floaters, test level.
4. **US-142a:** needs an engine hook (a sheet in the water layer). Split into 142a1 (PC-A engine, 0.75 d) and 142a2 (PC-B content, 0.75 d).
5. **US-141b:** split into 141b1 (PC-A fx, 0.25 d) and 141b2 (PC-B game, 0.5 d).
6. **US-144a:**
   - Replace "exponential fog reaching full at ~12 m" with "ease-out fog `s(2 - s)`, full at 12 m (no `exp`, parity)".
   - Split into 144a1 and 144a2.
7. **US-055a:** 055a2 becomes 055a2a (layer) + 055a2b (composite). The `water` pose and the 32.2 look ACs are unchanged.

## 36. Show-it look fixes (2026-10-03)

Owner walk-test 2026-10-03: pond/cellar water, burner fire, editor asset icons. Steps are self-contained for the PC-B programmer (OpenAI Codex): files, exact change, tests, done-when.

### 36.1 Water look (US-055a2c owner notes; all 3 looks water / pond / murky)

**Diagnosis (`waterComposite.js` + glsl twin).** (1) The glint is mixed into `wr/wg/wb` BEFORE `bg = rgb * bgK`, so ~10 % of the 0.5 m hash cells also get a light-grey **bg**: close up, one 0.5 m cell covers many screen cells -> grey rectangles. (2) Axis-aligned 0.5 m lattice -> same-glyph blocks with straight edges. (3) Colour uses the **path** alpha along the view ray; at grazing angles it saturates to 1 almost everywhere -> no depth tint. (4) No shore term (143b2 not built). (5) `floor(t*waveHz)` re-rolls the whole sheet at once -> flicker, not motion. 143b1 waves are **not** needed for these shots.

**Fix (both twins, same expressions in the same order, zero-alloc):**
- **Glint fg only:** `bg` from the un-glinted rgb; glint mixes fg only, with probability `look.glintP` (default 0.04, was 0.1).
- **Lattice:** `u = (Px*0.8776 + Py*0.4794)/cellM - ou`, `v = (-Px*0.4794 + Py*0.8776)/cellM` (fixed 0.5 rad rotation), `iu = floor(u)`, `iv = floor(v + 0.5*(iu & 1))` (brick offset). `cellM` default 0.25. `ou = (look.drift/cellM * t) mod 1024`, folded on the CPU (f64) -> ripples slide.
- **Staggered re-roll:** `h0 = hash(iu&1023, iv&1023, SALT)`; `tick = floor(wavePhase + (h0 & 255)/256)` with `wavePhase = (t*waveHz) mod 1024` folded on the CPU; `h = hash(iu&1023, iv&1023, SALT + 31*tick)`. Cells change one by one.
- **Depth tint by column:** `zF = P(rawDepth).z` (one extra unproject; sky -> column = inf), `col = zW - zF`; colour = `mix(shallow, deep, clamp(col/tintDepth, 0, 1))`. Path alpha `a` still decides see-through (unchanged).
- **Shore band (the 143b2 shore part, now, without waves):** `e` = distance to the region edge (rect: min of 4 sides; circle: `r - |P-c|`); `s = min(col/foamDepth, e/shoreW)`; if `s < 1` and `dW < foamFar`: glyph = `foamRamp[min(floor(s*n), n-1)]`, fg = `mix(rim, fgWater, s)`, bg unchanged. Crest foam stays in 143b2.
- **Slot table:** `WL_STRIDE` 36 -> 56 (14 vec4; 12 slots = 168 vec4, under the WebGL2 minimum of 224 - assert at link). New: 14 cellM, 15 glintP, 36 ou, 37 wavePhase, 38 tintDepth, 39 shoreW, 40..43 shape (rect x0,y0,x1,y1 | circle cx,cy,r,0), 44..46 foam codes, 47 foamN, 48..50 rim rgb, 51 shapeKind (0 rect, 1 circle), 52 foamDepth, 53 foamFar. New look keys + engine defaults: `cellM 0.25, glintP 0.04, drift 0.12 (m/s), tintDepth 1.2, shoreW 0.6, rim [200,220,215]`; `foamRamp` (1..3 glyphs, default '*o.'), `foamDepth 0.3`, `foamFar 40` become live.

| Step | Track | Size | Files / change | Tests / done-when |
|---|---|---|---|---|
| 36.1a | PC-A designer | 0.25 d | `design/water-looks.js`: add `cellM, glintP, drift, tintDepth, shoreW, rim` to water / pond / murky (murky: muddy rim, drift ~0.03, tintDepth 0.5); trim `foamRamp` to <= 3 glyphs; design/README "Water looks" field list | `node tools/run-tests.mjs --filter water` PASS (today's packer ignores unknown keys) |
| 36.1b | PC-B programmer | 0.5 d | `engine/render/waterLook.js` (stride 56; pack + validate the new keys; fold `ou`, `wavePhase` in `fillWaterSlotTable`), `engine/render/waterComposite.js` + `engine/render/gpu/glsl/waterComposite.frag.js`: glint fg-only, rotated brick lattice, drift, staggered re-roll | `waterComposite.test.js` new cases: a glinted cell's bg == the un-glinted bg; glyph map over a 2x2 m patch has no 0.5 m axis-aligned blocks (adjacent 0.25 m samples differ somewhere in every 0.5 m square); `ou` changes the glyph map over 1 s; validator rejects bad keys. `?gpucompare=1&renderer=mesh&pose=water` 0 FAIL; run-tests + check-deps green |
| 36.1c | PC-B programmer | 0.75 d | same 3 files: shape + foam + rim + tintDepth in the slot (shape from `world.water` x0/y0/x1/y1 or cx/cy/r2), column depth tint, shore band | tests: rect edge cell -> foam glyph, centre -> ramp glyph; circle `e` exact at r; `col < tintDepth` lighter than `col >= tintDepth`; sky cell keeps the old path. gpucompare water poses 0 FAIL; one headless `?f3=1` reading `wcomp` p95 <= 0.1 ms. Print the terrain height under quietPond (centre + 8 rim points): if the column is < 0.3 m everywhere, write `NEEDS PC-A: designer pond bowl` (don't edit terrain) |

### 36.2 Flame (US-053c)

**Decision:** 1-cell particles cannot read as a fire body at burner distance. Particles larger than 1 cell would be a new engine feature (layer + both twins) and would not look better. Cheapest convincing fix = the owner's Build-engine style: an **animated emissive billboard sprite for the fire body**, with particles only as **embers + smoke** on top. The sprite pass already works on both renderers; the old `burnerFlame` was just too small (9x5 cells, 0.5 m). Light: `lights.brazier` (preset `torch`, flicker 8-12 Hz, amount 0.15) already exists and stays unchanged.

| Step | Track | Size | Files / change | Tests / done-when |
|---|---|---|---|---|
| 36.2a | PC-A designer | 0.5 d | New `A.models.burnerFire` in `design/models/wreckage.js` (keep `burnerFlame` for old saves): billboard, 8 frames `burn` @ 12 fps, full 13w x 11h cells, `world {w: 0.7, h: 1.0}`, anchor bottom-centre, half LOD 7x6; keys flameTip/Outer/Mid/Core + ember, all `e: true`. Build look: wide licking tongues, white-yellow core low, ragged red tips, 1-2 detached flicks per frame, shape changes every frame. `design/models/particles.js`: new preset `embers` (rate ~8, life 0.8-1.4 s, speed 0.6-1.2, spread 25, emberHot -> dark); smoke unchanged. Preview page shows the fire on the burner model for scale | sprite + emitter validators PASS; owner OK on the preview |
| 36.2b | PC-B programmer | 0.25 d | `content/levels/tower.level.json`: add prop `burnerFire` (model `burnerFire`, anim `burn`, x 18.5, y 6.5, z 1.05, no collide); brazier `emitters`: `flame` -> `embers`, keep `smoke` | level-load test: the prop exists and its model resolves; run-tests green; one headless `tools/capture-browser.mjs` shot at the burner (`?renderer=mesh`) shows a ~1 m fire body. If the sprite does not draw under `renderer=mesh`: stop, `ASK ARCHITECT` |

### 36.3 Asset icons (OWN-REQ-014)

**Decision: offscreen render with the real engine, CPU twin (no second WebGL context).**
- **Setup:** hidden canvas + `createEngine({canvas, assets, cols: 160, gpu: false, inputTarget: <detached div>})` + `createFrame({engine, assets, rt, gpuParam: false, renderer: 'mesh'})`.
- **Mini world:** a level doc built in memory (one open-sky 6x6 m sector, neutral floor, palette sun, ONE prop of the model at the centre, facing 180), loaded with `World.load(doc, assets, {})` -> `engine.setWorld`.
- **Camera:** 3/4 view, yaw 45 (from the SW looking NE), pitch -30. Distance: the bounding sphere (from the model bounds) fits the vertical FOV with a 10 % margin.
- **Crop:** project the 8 bbox corners to cells -> pixel rect of the 2D canvas -> `drawImage` letterboxed into a **96x96** icon canvas (bg #101418) -> data URL.
- **Budget:** a 160x60 CPU frame costs ~5-20 ms, so render **1 icon per rAF**, only while the Assets tab is visible. The ASCII thumbnail (`thumbnails.js`) stays as the placeholder/fallback (if the render throws, keep it).
- **Cache key** = `model key + '|' + fnv1a32(JSON.stringify(model def)) + '|' + ICON_VERSION`. Stored in a memory Map + `localStorage['kestrel.icon.v1.' + key]` (~5 KB each). A .vox import/rebind changes the hash -> re-render.
- Tools only: imports `engine/index.js` only.

| Step | Track | Size | Files / change | Tests / done-when |
|---|---|---|---|---|
| 36.3a | PC-B programmer | 0.5 d | New pure `tools/editor/iconFit.js`: `modelBounds(model)` -> `{w, d, h}` m (voxel dims x cell x scale; sprite world.w/w/h; mesh .vox bounds); `fitIconCamera(bounds, fovDeg, aspect)` -> `{x, y, z, yawDeg: 45, pitchDeg: -30}`; `iconCacheKey(key, model)`; `createIconQueue(perFrame = 1)` (enqueue / dedupe / next) | `tools/editor/iconFit.test.mjs`: all 8 corners project inside the grid with >= 5 % margin for a 0.2 m, a 2 m and a 20 m model; the key changes when one voxel changes; the queue never yields > perFrame per tick |
| 36.3b | PC-B programmer | 0.75 d | New `tools/editor/iconRender.js`: `createIconRenderer(assets)` (the hidden engine above, made once) with `renderIcon(key) -> string` (data URL); a `?icontest=1` debug strip in `tools/editor/main.js` that draws 6 icons | one headless `capture-browser.mjs` shot of the strip: 6 non-empty, same-size icons; the editor main viewport is unaffected; run-tests + check-deps green |
| 36.3c | PC-B programmer | 0.5 d | `tools/editor/main.js` Assets tab (around line 870): `<img>` 48x48 CSS from the cache, otherwise the ASCII placeholder + enqueue; rAF pump 1/frame while the tab is visible; localStorage cache | the owner ACs below |

**Owner ACs:**
1. Every model in the Assets tab shows a 3D 3/4-view icon, and all icons are the same size.
2. A tiny prop (e.g. lever) and a big one (e.g. far_tower) both fill their icon (auto-fit, nothing cut off).
3. The editor stays responsive while icons fill in (no freeze > 0.1 s).
4. Reopening the editor shows the icons at once (cached).
5. Importing a .vox shows its icon within a second; re-importing a changed .vox updates it.

## 37. Show-it world content (2026-10-03)

D-036 "Show it": Ruins pieces as set dressing (ME-14c) and a real walkable forest (ME-06c). The programmer is on PC-B with no architect access: every step below is self-contained; if a step's done-when cannot be met, write `NEEDS PC-A: <what>` in the row and stop.

### 37.1 ME-14c mesh render (imported glTF meshes, kind 9)

**Input:** ME-14b2 (`world.structures[i] = {kind:'mesh', mesh, origin, frame (yawDeg), bbox}`), ME-14b colliders (same matrix12), ME-14a (`assets.mesh(id)` -> `MeshData` with `mats`, `matsResolved: false`).
**Decisions (reasons inline):**
1. **Kind 9 shades like a rotated voxel part, with wall `faceK`.** Per fragment, from the interpolated world normal n: `face` = dominant axis (1..6) when `max|n_i| >= 0.9`, else `FACE_PACKED` (7) + the oct-packed n in GA.w (CPU: the existing `aoD` alias in `copyToGBuffer`). `aoD` = Infinity (aux AO_NONE). No new G-buffer channel and no lighting change: `lighting.js`/`light.frag` already handle axis faces and face 7. Shade: `fk = faceK[face]` for faces 1..6, 1 for 7 (the existing default branch; only kind 8 forces 1). The "face 7 -> aoD Infinity" rule (`detailShade.js` ~l.642, `shade.frag.js` ~l.505) is extended to kind 9. Edge: `isVert` = kind 9 with face N/E/S/W/7, `isUp` = kind 9 with face U, rim 1.
2. **UVs = world-metre planar (27.4).** The Ruins `.glb` carry atlas `TEXCOORD_0` (colour-swatch UVs: `Line.mesh.json` uv is ~0.25 everywhere), so detail glyphs would be one texel per wall. `loadGltf(buffer, id, {uv})`: `'planar'` (new default) ignores TEXCOORD_0 and uses `planarUv`; `'source'` keeps today's behaviour. Regenerate the committed `.mesh.json` files.
3. **Materials:** the registry mesh stays unresolved (colliders and other tables share it). New `MeshDrawCache` (DrawList.js): `get(mesh, idFor)` -> a resolved copy `{...mesh, flat: mesh.flat.slice(), matsResolved: false}` + `resolveMats(copy, k => idFor(mesh.mats[k]))`, cached per mesh in a WeakMap and rebuilt when `idFor` changes. A missing `mats` entry throws `mesh "<id>": material "<name>" has no mats entry`; an unknown palette key throws from `idFor`. The only allocation is on first use.
4. **Draw feed:** `addMeshStructures(list, world, cam, cache, idFor, fogFarM)` in DrawList.js. It takes the nearest `MAX_MESH_DRAWS = 64` `kind:'mesh'` structures within fogFar (module scratch, the same select + insertion sort as `addStructures`), one `DRAW_STATIC` item each: `matrix` = the same matrix12 the ME-14b collider uses (one helper, not a second formula), `rangeFirst 0`, `rangeCount triCount`, `planeIdOr = (slot & 0xFF) << 20` (slot = draw order, so neighbours outline), `objectId = 0xA000 | structureIndex`, `zBase = origin.z`, `aabb = s.bbox`. `addStructures`, the DDA compositor path and every other structure loop skip `kind === 'mesh'` (if ME-14b2 missed one, the renderer crashes on `cache.get`; this step fixes that).
5. **Culling/LOD:** frustum `list.cull` only. No LOD and no instancing: pieces are <= ~5k tris, repeated pieces share one GPU buffer through the cache. Revisit only if a scene needs > 64 placements.
6. **Shadows:** `buildShadowList` calls `addMeshStructures` right after `addStructures` (`src.matIdFor` is already there; add `src.meshCache`). DRAW_STATIC items cast with no other change.
7. **Callers (same order in both twins):** `compositor.js` `renderWorldMesh` and `GpuCellPipeline._passRaster`, right after `addStructures`. GPU: only a kind-9 branch in `mesh.frag.js` (face rule + `nrmBits`/`gaW` as for unaligned kind 8), plus `shade.frag.js`/`edge.frag.js` as in item 1. No `mesh.vert.js` change, no new program.
8. **Budget (400x150, owner Arc iGPU, p95):** ruins pose raster delta <= 0.3 ms GPU; feed <= 0.05 ms JS; 0 allocations per frame after the first (1000-frame alloc test).
**Do not:** mutate the registry `MeshData`; read TEXCOORD_0 as metres; add a GI.z normal reader for kind 9; put meshes through `addStructures`/structSeq (3-bit cap 8); widen gpucompare thresholds.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| ME-14c1 | PC-B | 0.5 d | `engine/render/GBuffer.js` (+`KIND_MESH = 9`; `gltf.js` re-exports it), `engine/mesh/gltf.js` (`uv` option), `tools/gltf-import.mjs` (+`--uv`), the 2 `content/meshes/**`, `engine/mesh/DrawList.js` (`MeshDrawCache`, `addMeshStructures`, mesh skip), `engine/render/compositor.js` + `engine/mesh/shadowList.js` (skip only) | `gltf.test.js`: a 2 m quad has a uv span of 2 in planar mode, `'source'` keeps TEXCOORD_0. `DrawList.test.js`: 2 placements (yaw 0 and 37) -> 2 items, matrix bit-equal to the ME-14b collider's, objectId/planeIdOr as item 4; 70 placements -> nearest 64; level structures unchanged; zero alloc over 1000 frames. Cache: same object twice, registry mesh bytes + `matsResolved` unchanged, missing mats throws naming both | run-tests + check-deps green |
| ME-14c2 | PC-B | 0.75 d | `engine/mesh/rasterJS.js` (kind-9 face rule), `engine/render/detailShade.js`, `engine/render/edgePass.js`, `compositor.js` (`addMeshStructures` call) | `rasterJS.test.js`: yaw-0 wall tri -> kind 9, axis face; yaw-45 -> face 7 + packed n round trip (1e-3); brute-force oracle (as 27.15 step 3) on one Ruins piece, 10 poses: kind/face/mat >= 99 %, depth 1e-4. `edgePass.test.js`/detail tests: kind 9 isVert/isUp, face-7 aoD -> Infinity. Compositor: a world with one mesh -> kind-9 cells, glyphs not sky | run-tests + check-deps green |
| ME-14c3 | PC-B | 0.75 d | `engine/render/gpu/glsl/mesh.frag.js`, `shade.frag.js`, `edge.frag.js`, `GpuCellPipeline.js` (feed + shadow src), `game/js/dev/modes/gpucompare.js` (pose), `content/worlds/world_m1.world.json` (the first 2 placements: `PillarRound` + `WallBrokenMD` ~10 m west of the breach, e.g. (1470, 1042), clear of the tower x 1480..1504 and the boar route) | `glsl.test.js` compiles the sources; new pose `world_m1: ruins` (eye 6 m from the pieces, yaw at them) | `?gpucompare=1&renderer=mesh` 0 FAIL (pose included), `&shadows=map` row for the pose PASS; one headless `tools/capture-browser.mjs` shot shows both pieces shaded; F3 raster delta <= 0.3 ms |
| ME-14c5 | PC-A | 0.25 d | none (measurement) | F3 raster delta on the owner's Arc iGPU at the ruins pose after c4 | p95 delta <= 0.3 ms (item 8), recorded in the ME-14c row |
| ME-14c4 | PC-B content | 0.5 d | `content/meshes/ruins/**` (+ `--mats` sidecars: stone* / moss* palette keys), `content/manifest.json`, `world_m1.world.json` | `validate-content` OK; `mesh-content.test.mjs` covers each new file; world-load test counts the placements | 8-12 Ruins placements (pillars, broken walls, blocks, moss, one stair) + 4-6 StickyBizcuit/vp voxel props (`type: prop`) dressing the walk-out between the breach and the waystone, off the boar route by >= 2 m, all walkable around on `?renderer=mesh&physics=mesh`; credits line "Voxel assets by StickyBizcuit" present (OWN-REQ-013); owner shot check |

**Amendment 2026-10-04 (ME-14c3 decisions, after docs/test-reports/ME-14c3-pc-b-findings.md):**
- **A1 Edge crease gate.** Near-coplanar facets of one piece have their own planeIds, so the exact convex/concave depth test flips between twins. For a pair where **both** cells are kind 9, apply the convex/concave rule only when `dot(nI, nR) < cos(edges.meshCreaseDeg ?? 30)` (decoded normals); otherwise no edge. Same gate in `edgePass.js` and `edge.frag.js`. Pairs that are not kind 9 on both sides stay bit-identical. No depth epsilon, no depth bias, no planeId regrouping, no asset fix.
- **A2 gpucompare.** The existing kind-8 raster-tie allowance (`gpucompare.js` ~l.702) also covers kind 9: rename `violNonK8` -> `violNonMesh`, the AO check applies only to cells that are neither kind 8 nor kind 9, cap stays 4 geometry cells. This is not a threshold widening (item "Do not" still holds). If `outsideNear` still fails after A1+A2, stop and report the cell (kind, planeId and depth on both twins).
- **A3 Performance.** The 0.3 ms bar (item 8) stays and is gated on the owner's Arc in ME-14c5; RTX numbers are recorded, not gated. c3 must show 0 buffer uploads and 0 cache rebuilds per frame after warm-up, one draw per placement, and the 1-vs-2-placement delta. Allowed: GPU-only changes with bit-identical output (per-mesh VAO, fewer state changes). Not allowed: LOD, instancing, or a draw-order change in one twin only. c4 asset caps: <= 4k tris per piece, <= 30k in total.
- **A4 Normals.** Flat only in this phase; `mesh.vert.js` unchanged (item 1's "interpolated normal" is the flat triangle normal). The content test asserts that the 3 vertex normals of every triangle are equal. Smooth normals are a later story.
- **A5 (2026-10-04, after docs/test-reports/ME-14c3-amendment-findings.md).** Why the two rows fail now: a mesh row passes on the strict path (`cmpGeom.pass && cmpCells.pass`, which never gates `aoViol`) or on `meshColourOk` (which gates `aoViol === 0`, `violNonMesh === 0`). The Ruins pieces stand in both views (outsideNear: ~6.6 m ahead at bearing ~58°; parapetSky: ~24 m at bearing ~224°, low in frame). Their one kind-9 tie cell breaks the strict path, so the row falls through to `meshColourOk`. That gate then shows a latent issue.
  - **outsideNear (122,41), kind 9:** both planeIds are in the same placement slot (they differ only in the low triangle bits), so the cell is the same piece, two facets, and depth differs by 0.12 m. That is a raster tie at an internal silhouette of the piece. A2 covers it (kind 9, <= 4 cells). No fix.
  - **outsideNear (55,50), kind 2: pre-existing, exposed only, not caused by the meshes.** `aoD` (`computeAoD`, rasterJS.js:187 = mesh.frag) depends only on the flat per-vertex aux and on u/v. Both formulas are min/max of terms with slope ±1 in u or v, so `|ΔaoD| <= max(|Δu|, |Δv|)` whenever the planeId is the same. The cell's u/v pass `uvTol = 1e-3 * 27.6 m`, but `aoD` was held to an absolute 1e-3. The strict path never looked at it, so it was invisible before. **Fix (gpuCompare.js `compareGeometry`, the only tolerance change):** `aoTol = max(1e-3 * max(1, |ca|), uvTol)`, and only when the JS and GPU planeIds are equal. When they differ, keep today's 1e-3 rule. This is not a widening: the tolerance is the bound already implied by the u/v check. Node test in `gpuCompare.test.js`: (a) a kind-2 cell at depth 27.6 with ΔaoD 0.0012, same plane -> no `aoViol`; (b) the same with a different planeId -> `aoViol`; (c) Δu within uvTol but ΔaoD > uvTol -> `aoViol`.
  - **parapetSky glyph/colour, likely a detail-texel tie (to be proven per cell).** Geometry and light PASS, and the Ruins pose (6 m) PASSes glyph+colour, so the kind-9 shading logic agrees between the twins. At ~24 m, u/v differences within uvTol (~0.024 m) can cross a detail-hash boundary. The pose has few non-sky cells, so 5 glyph cells = 0.93 %. **Permitted fix (harness only, `gpucompare.js` + an optional trailing `skip` mask on `compareCells`):** for mesh rows, a cell is a **texel tie** only if all of these hold: kind 9 on both twins, the same planeId and mat, |Δu| and |Δv| <= uvTol, and at least one of the shade's hash keys differs when computed from each twin's own u/v. The keys are `floor(u*D)`, `floor(v*D)` with `D = detail * 4` (the finest octave; coarser grids are nested in it), plus `course`/`bix` for grid materials (`detailShade.js` ~l.130-160). Tie cells are left out of the glyph/colour counts and reported (`texelTies`, with a cell list). Sanity cap: <= 16 per pose, otherwise FAIL. Thresholds are unchanged for every other cell. **STOP rule:** if a mismatched cell has identical keys (or is not kind 9), it is a twin bug. Report the cell (kind, face, mat, u/v both twins, keys, `tpc`/octave on the JS side) and change nothing else. Octave flips (`tpc` near a threshold) are not covered by this rule.
  - **No placement move.** Both are genuine ties or harness-tolerance issues, not reasons to hide the pieces. Still forbidden: colour/glyph threshold changes, depth bias, planeId regrouping, asset edits.
  - **Evidence for the report:** the baseline (d3d7e3c) `aoViol`/`aoSampleIdx` at outsideNear (expected 8055, already present). The new run: outsideNear and parapetSky PASS, `texelTies` per row, and no row that passed at baseline changes.
- **ME-14c3 done-when (replaces the row above):** A1+A2 in both twins with a Node edge test (coplanar kind-9 pair -> no edge, 45° pair -> edge, mixed-kind pairs unchanged); `?gpucompare=1&renderer=mesh` no new FAIL vs baseline incl. the ruins pose; `&shadows=map` ruins row PASS; A3 evidence (uploads/rebuilds/draw counts + RTX deltas) in the test report; A4 content test.

### 37.2 ME-06c real big walkable forest

**Decisions:**
1. **Where:** trees only on forest cells inside the near band (`terrain.near`, 192x192 cells of 2 m, baked once in `World.load`). Beyond it the ME-06b canopy heightfield stays (`farHDraw`). Only when the world is loaded with `realTrees: true` (main.js: `renderer=mesh && physics=mesh`, `?trees=0` turns it off; the DDA renderer keeps the old canopy), `bakeNearBand` uses canopy 0 on forest cells. `farHDraw` and physics heights stay unchanged, so the ground under the trees is the real ground.
2. **Handover (no seam by construction):** the near/far stitch at the band edge becomes a ~10 m skirt up to the far canopy, which ME-06b shades as forest face glyphs (a forest-edge wall). Trees are placed right up to the band edge (no margin), so they stand in front of it. The band is static (no streaming yet), so nothing pops while walking. Only LOD0/LOD1 changes, with RE-15 hysteresis. If US-026b streaming lands, re-run the scatter per band version (placements are origin-independent, item 3).
3. **Scatter (`engine/world/scatter.js`, new, pure, imports nothing outside engine/core):** a world-aligned grid of `cfg.cellM` (6 m), `ix = floor(x / cellM)`. Per cell: `h = hash2(ix, iy, cfg.seed)` with this literal `hash2`: `h = Math.imul(ix|0, 0x8da6b343) ^ Math.imul(iy|0, 0xd8163841) ^ seed; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return (h ^ (h >>> 15)) >>> 0`, re-hashed with `seed + k` for the k-th value. Keep the cell when `u0 < cfg.fill`. Point = cell centre + `(u1, u2) * 2 - 1` times `cfg.jitter`. Reject when: any of the 4 near-cells around the point is not forest, slope > recipe `forest.maxSlope`, or the point is inside a structure bbox + 2 m. Species = weighted pick by u3, `yawDeg = floor(u4 * 360)`, `z = groundAt - 0.1`. Output SoA (`x, y, z` Float64Array, `yawDeg` Int16Array, `species` Uint8Array, `count`) in (iy, ix) order. Over `cfg.maxTrees` (1500): a second keep test `u5 < maxTrees / count`. A world cell gives the same tree in any band.
4. **Spacing guarantees the 1.2 m gap:** validate at load `cellM - 2 * jitter >= 2 * maxRc + 1.2`, where `Rc` = collider circumradius (item 5). Defaults 6 / 1.5 with Rc <= 0.81 pass. Throw naming the cfg key.
5. **Trunk colliders (physics `'mesh'` only):** one `MeshCollider` `'scatter:trunks'`. Per tree an open 8-gon prism, circumradius `trunkR / cos(22.5 deg)` (never thinner than the visible trunk), from `z - 0.5` to `z + trunkH`. Built once with `buildBvh` in `World.load`, pushed onto `world.colliders`. Not serialized; placements are derived data (content + hash), so the world state and its hash are unchanged.
6. **Draws:** instanced through RE-06/RE-15. `bindScatterInstances(world, engine.instances)` in `engine.loadWorld` creates one group per species (capacity = that species' count) and writes each instance once with `writeUnitInstance(ib, i, x, y, z, yaw, SCATTER_OBJECT_BASE | i, 0)`, `SCATTER_OBJECT_BASE = 0x20000`, `g.lodCells = cfg.lodCells` (start 6). Groups are removed on world unload. A model missing from the voxel pool throws naming the key. Per frame there is nothing new: the RE-15 cull + LOD1 + compaction, the sun shadow list (already adds instance groups) and `MAX_INSTANCES_PER_FRAME` 2048 hold.
7. **Config = content:** `recipe.forest.trees = {seed, cellM, jitter, fill, maxTrees, lodCells, species: [{model, weight, trunkR, trunkH}]}` in `design/levels/overworld_far.js`. The engine has no tree keys.
8. **Budget (Arc iGPU, 400x150, p95; the Deck is ~2x slower, so these are half of what the Deck could take):** dense-forest pose trees-on minus trees-off <= 1.0 ms GPU, `shadows=map` adds <= 0.5 ms; JS cull/LOD for <= 1500 instances <= 0.3 ms; scatter + BVH once at load <= 50 ms. Per tree variant: LOD0 <= 4k tris, LOD1 <= 1.2k. If over, in this order: raise `lodCells`, lower `fill`, designer trims the canopy. Do not add LOD2/impostors here.
**Designer needs (06c4):** sb trees are 6-7 m, the AC wants a canopy of 8-14 m. So 3 species x 2 sizes as variants of `treeBig`/`sbTree`, `treeBirch`, `treePine` with a larger `cellM` (~0.2 and ~0.28; same voxels, no instance scale needed), measured `trunkR` (0.3-0.75 m) and `trunkH` (ground to the lowest canopy voxel), optional `leaf`/`leafDark` palette keys instead of `grass`, a preview page and the `forest.trees` config. Cozy-nature FBX: skipped (no importer).
**Do not:** add per-instance scale; scatter or pick LOD per frame; use `Math.random`; place trees outside the near band; change `farHDraw`; give trunks colliders in grid physics (opt-in mesh only).

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| ME-06c1 | PC-B | 0.5 d | `engine/world/scatter.js` (+test), `engine/world/Terrain.js` (`realTrees` -> near canopy 0), `World.js` (run the scatter at load, `world.scatter`) | `scatter.test.js` on a synthetic near band: two runs byte-identical; two bands with different origins agree on the overlap; every pair `>= rA + rB + 1.2` apart (surfaces); none on non-forest, steep or excluded points; `maxTrees` thinning deterministic; the cfg validator throws on a bad gap. Terrain: forest `hDraw == height` in near only with the flag, `farHDraw` unchanged. Print the `world_m1` count | run-tests + check-deps green; band scatter <= 30 ms (Node, warn-only) |
| ME-06c2 | PC-B | 0.5 d | `engine/world/colliders.js` (`buildTrunkCollider`), `World.js` | `trunkColliders.test.js`: `moveCircleMesh` with the player radius cannot enter a trunk; it passes a 1.2 m gap between 2 fixture trunks; a 600-step replay hash is identical over 2 loads; grid mode bit-identical (all existing suites) | run-tests + check-deps green |
| ME-06c3 | PC-B | 0.5 d | `engine/core/engine.js` (`bindScatterInstances`, unload removal), `game/js/main.js` (`realTrees` flag, `?trees=0`), `gpucompare.js` (pose `world_m1: forestWalk` = densest 30 m disc of placements nearest the spawn, from 06c1's print; dda SKIP) | Node: groups = species with counts, instance words == placements, reload leaves 0 groups | `?gpucompare=1&renderer=mesh` 0 FAIL incl. forestWalk; one headless capture inside the forest (trunks around, canopy overhead at pitch +30) |
| ME-06c4 | PC-A designer | 0.5 d | `design/models/forest_trees.js`, `design/levels/overworld_far.js` (`forest.trees`), palette leaf keys (optional), `design/preview/forest.html` | voxel validators PASS; print LOD0/LOD1 tris per variant (bars in item 8) | owner OK on the preview; can run in parallel with 06c1/06c2, needed by 06c3 |
| ME-06c5 | PC-A | 0.25 d | bench only (`?bench=1` forestWalk, trees on/off, shadows dda/map) | numbers in the row | item 8 bars met (or tuned per item 8), then the owner walk-test "I can go into the forest" on `?renderer=mesh&physics=mesh` |

### 37.3 US-122a sun from clock hours (minimal day/night slice for showcase shots; architect, 2026-10-04)

Goal: a cinematic key or `?time=HH` sets the sun from an hour. No clock, no moon, no colour curves (those stay US-122). Track PC-B (cross-track engine), ends in `arch-review`. Size ~0.5 d, one step.

**1. Pure function** - new `engine/core/sunPath.js` (no imports, like `core/transform.js`; exported from `engine/index.js`). Model: the real sun path on an equinox day (declination 0) at latitude `latDeg`. Sunrise is exactly 06:00 due east, noon is due south, sunset is 18:00 due west. Conventions are the `LightSet.setSun` ones: `elevationDeg` above the horizon, `azimuthDeg` compass (0 = N, clockwise, x east / y south), where the light comes FROM.
```js
/** @typedef {{latDeg:number, declDeg:number}} SunPath */
/** @typedef {{elevationDeg:number, azimuthDeg:number}} SunPos */
/** h: hours, any real number (wrapped mod 24, so 26 == 2). out is reused (pass a scratch in per-frame code). */
export function sunFromHours(h, path = SUN_PATH_DEFAULT, out = { elevationDeg: 0, azimuthDeg: 0 }) // -> out
//   H = (h - 12) * 15 deg;  f = latDeg, d = declDeg
//   elevation = asin(sin f sin d + cos f cos d cos H)
//   azimuth   = atan2(cos d sin H, cos d cos H sin f - sin d cos f) + 180, normalised to [0, 360)
/** Fits the declination-0 path through a fixed sun: tan(lat) = -cos(az) * cos(el) / sin(el);
 *  H = acos(sin(el) / cos(lat)), negative (morning) when az is in (0, 180). Returns {latDeg, declDeg: 0, h0}. */
export function sunPathFrom({ elevation, azimuth })   // takes the world.sun / def.sun shape
export const SUN_PATH_DEFAULT  // = sunPathFrom({ elevation: 60, azimuth: 112.5 }) computed at module load (not a typed literal)
```
**h0:** the default sun (palette `lights.sun` = `world_m1` `world.sun` = el 60, az 112.5 ESE) is on the path with `latDeg = 12.4589`, noon elevation 77.54, at **h0 = 10.1658 (about 10:10)**. Check values: 06:00 -> (0, 90), 08:00 -> (29.22, 97.10), 12:00 -> (77.54, 180), 15:00 -> (43.67, 257.83), 18:00 -> (0, 270). Any level's own fixed sun gets its own path and h0 through `sunPathFrom`. So `?time=<h0>` reproduces that level's look exactly, and other hours stay on the same arc.

**2. What the hour drives in this slice:** only the sun direction, through both sun sources, plus "off below the horizon" (`setSun` already forces `on=false` when elevation <= 0). New in `engine/render/lighting.js`:
- `setWorldSun(world, lights, elevationDeg, azimuthDeg, on)`. It calls `lights.setSun({elevation, azimuth, on})` with a module scratch object. It also points `world.sun` at a world-owned copy: the first call replaces `world.sun` with `{ ...world.sun, elevation, azimuth }` and sets `world.sunSource = 'time'`; later calls mutate that copy in place. It **never mutates a level `def.sun`**, because the level-fallback `world.sun` IS the shared def object.
- `applySunHours(world, lights, h, path, on)` = `sunFromHours` into a scratch, then `setWorldSun`. Allocation-free after the first call.
- `terrainCaster.js` `sunFromWorld`: read `world.sun` first (CO-2: the world owns the sun), then the first structure's `def.sun`, then the default. Today this changes no pixels: `world_m1`'s `world.sun` equals the level sun, and the level fallback is the same object. Without this, terrain (kind 7) would keep the old sun while meshes move. `gpucompare.js` `applySunOverride` must then also swap and restore `world.sun` (simplest: call `setWorldSun`, and save/restore `world.sun` + `world.sunSource` refs in the restore closure).
- The shadow map (`shadowSunMatrix(sun.dir)`) and the light pass already read `sun.dir` each frame, so they follow with no extra work.
- **Stays in US-122:** `world.time` clock (speed, pause, save in WorldState), sun colour/intensity and ambient curves, horizon fade (this slice has a hard cut at 06:00/18:00, so showcase shots should use about 06:30-17:30), sky gradient (still `P.defaultTime`), fog curves, moon, stars, `dusk`/`dawn` events, lamps switching on, seasons/declination UI. `palette.timeOfDay` presets are not read by this slice.

**3. Cinematic keys** (`game/js/dev/modes/cinematic.js`): optional per-key `hour` (finite number), **all keys or none** (`validatePath` throws on a mix). `evaluatePath` sets `out.hour = b.hour + (c.hour - b.hour) * u`, using the same eased `u` as position. Interpolation is **linear on the raw numbers, not shortest-way**. With shortest-way, a 06 -> 20 day-long pan would jump backwards through midnight. To cross midnight going forward, write `20 -> 26`. To run backwards, write `18 -> 6`. `sunFromHours` wraps. Without hours, `out.hour` is left untouched (no sun writes, today's behaviour). The path-level `timeOfDay` field stays rejected, with the message changed to "use per-key hour (US-122a)". In `main.js`'s cinematic branch: at load, compute `path = sunPathFrom(world.sun)` (before any time write). Each tick after `evaluatePath`, if the path has hours, call `applySunHours(world, lightSet, cam.hour, path, sunEnabled)`.

**4. `?time=HH`** (`game/js/main.js`): `parseFloat`, finite, else ignore + `console.warn`. The value is applied once with `applySunHours(world, lightSet, h, sunPathFrom(<the load-time world.sun>), sunEnabled)` right after `buildLightSet`. It is applied again wherever `main.js` rebuilds the light set (the existing `sunEnabled` re-apply sites, lines ~692 / ~1373). It is static (no clock). F6/F7 still nudge the azimuth afterwards.

**5. Tests.** `engine/core/sunPath.test.js`: elevation strictly rising over 06:00..12:00 (step 0.25 h) and symmetric `e(12-x) == e(12+x)`; noon is the max over 0..24 and equals `90 - latDeg`; azimuth 90 / 180 / 270 at 6 / 12 / 18 (1e-9), and morning azimuth in (90, 180); elevation < 0 at 3 and 21; wrap `h=30 == h=6` and `h=-2 == h=22`; `sunPathFrom({elevation: 60, azimuth: 112.5}).h0` = 10.1658 +-1e-3, and `sunFromHours(h0, path)` reproduces (60, 112.5) to 1e-9; an afternoon sun (60, 247.5) fits h0 = 13.834; `out` is returned and reused. Additions to `lighting.test.js`: `applySunHours(..., 2, ...)` gives `sun.on === false`; at h0 `sun.dir` matches `setSun({60, 112.5})` to 1e-12; the level `def.sun` object is unchanged after `setWorldSun`; `sunFromWorld(world)` follows the new sun. Additions to `cinematic.test.js`: `20 -> 26` midpoint = 23; a smooth ease applies to the hour; a mix of hour / no-hour keys throws; no hours leaves `out.hour` untouched; path-level `timeOfDay` still throws.

**6. Files:** `engine/core/sunPath.js` + test, `engine/index.js`, `engine/render/lighting.js` (+ test), `engine/render/terrainCaster.js`, `game/js/dev/modes/gpucompare.js` (override also swaps `world.sun`), `game/js/dev/modes/cinematic.js` + test, `game/js/main.js`. **Do not:** touch the shaders or `palette.timeOfDay`, add a running clock, or write into level defs.

**Done when:** `node tools/run-tests.mjs` + `check-deps` are green. `?gpucompare=1&renderer=mesh` shows 0 new FAIL (pixel-neutral without `?time`). Two headless captures, `?renderer=mesh&time=8` and `&time=16`, show tree/wall shadows on opposite sides, with terrain and meshes agreeing. One sample cinematic path with `hour` 7 -> 17 plays.

### 37.4 ENV-01 ground detail scatter (D-038 "alive world"; architect, 2026-10-04)

Goal: rocks, grass tufts, bushes, flowers, stumps, fallen logs and small props on the terrain around the player, on the mesh path, built on the ME-06c scatter (37.2). Track PC-B (engine steps end in `arch-review`), content tuning PC-B content, models PC-A designer.

**Decisions (reasons inline):**
1. **Same switch and band as the trees.** World opt `detail: true` (main.js: on when `renderer=mesh && physics=mesh`, exactly like `realTrees`; `?scatter=0` turns it off; **not** `?detail=0`, which is the US-028 v1-shading switch - erratum 2026-10-05, ENV-01a2 review). Placements only inside the baked near band (`terrain.near`), computed once in `World.load` right after `scatterTrees`. The DDA renderer and grid physics are unchanged (bit-identical). Derived data: `world.detail` is never serialized; world state and its hash are unchanged.
2. **Config = content:** `recipe.detail` in `design/levels/overworld_far.js` (sibling of `forest`); the engine has no species keys.
```js
/** @typedef {{model:string, weight:number, sinkM?:number, yawStep?:number, shadow?:boolean,
 *   collider?: {prism:{r:number, h:number}} | {box:{hx:number, hy:number, h:number}}}} DetailSpecies */
/** @typedef {{name:string, seed:number, cellM:number, jitter:number, fill:number, maxSlope:number,
 *   clearM:number, drawM:number, lodCells:number,
 *   ground: Object<string, DetailSpecies[]>}} DetailLayer   // ground keys = terrain type names (grass, forest, rock, path, water) */
/** @typedef {{tileM:number, maxDraw:number, refeedM:number, maxPlacements:number,
 *   structClearM:number, entityClearM:number,
 *   exclude: Array<{shape:'disc', x:number, y:number, r:number} | {shape:'capsule', ax:number, ay:number, bx:number, by:number, r:number}>,
 *   layers: DetailLayer[]}} DetailConfig */
```
   One layer = one hash grid (one density), e.g. `tufts` (cellM ~2.5, drawM ~28), `shrubs` (bushes/flowers/ferns, cellM ~5, drawM ~45), `rocks` (rocks/stumps/logs, cellM ~11, drawM ~70). Defaults: `tileM 16`, `maxDraw 768`, `refeedM 4`, `maxPlacements 40000` (hard, <= 65536), `structClearM 2`, `entityClearM 1.5`, `sinkM 0.05`, `yawStep 1`, `shadow false`, no collider.
3. **Scatter (`scatterDetail(terrain, structures, keepOut, cfg)` in `engine/world/scatter.js`, pure, same imports as today):** per layer, the 37.2 item 3 grid with the literal `hash2(ix, iy, layer.seed + k)`: keep when `u0 < fill`, point = cell centre + `(u1, u2) * 2 - 1` x `jitter`. `t = terrain.groundTypeAt(x, y)`; reject when `layer.ground[typeName(t)]` is missing/empty (water and path have no species, so they get none), when `groundTypeAt` at any of `(x +- clearM, y +- clearM)` differs from `t` (a margin from paths, water and type borders; symmetric, unlike the trees' 2x2 rule), slope > `maxSlope` (`groundNormalAt` into a module scratch), inside any structure bbox + `structClearM` (includes `kind:'mesh'` Ruins pieces and the tower), or inside any `keepOut` disc/capsule. Species = weighted pick by u3 within `ground[t]`; `yawDeg = floor(u4 * 360 / yawStep) * yawStep`; `z = groundAt - sinkM`; per-placement draw radius `r = drawM * (0.85 + 0.15 * u5)` (dithered fade ring, item 5), stored squared. Layers run in config order; over `maxPlacements` -> throw naming `detail.maxPlacements` (a hard cap, not thinning: content fixes density). Then a stable counting sort by tile (`floor(x / tileM)`, `floor(y / tileM)`, world-aligned, clipped to the band). Output `DetailSet`: `{count, x, y, z: Float64Array, yawDeg: Int16Array, species: Uint16Array (index into speciesDefs), r2: Float32Array, speciesDefs: [{model, layer, shadow, lodCells, collider}], tileM, tx0, ty0, tilesX, tilesY, tileStart: Uint32Array(tilesX*tilesY + 1)}`. `scatterTrees` output stays byte-identical (only shared helpers may be extracted).
   **keepOut** = `cfg.exclude` (authored: the walk-out path breach -> waystone, the boar route capsule (1461,1031)-(1444,1035) r 4, the flag/door approaches) **plus** a disc of `entityClearM` around every **content** entity with finite x,y (`assets.world(def.name).entities`). Never live/saved entity state, or a save/load would move the grass.
   `validateDetailConfig(cfg, typeNames)` throws naming the key (`detail.layers[2].ground.mud: unknown ground type`, bad numbers, empty species, a collider with r/h <= 0).
4. **Colliders (physics `'mesh'` only, opt-in per species):** grass, flowers, small stones and bushes have none. Big rocks/stumps use `collider.prism` (the ME-06c2 8-gon, circumradius `r / cos 22.5`, from `z - 0.5` to `z + h`, **closed with a top fan**, because the player can jump onto a 0.8 m rock); fallen logs use `collider.box` (yawed box, 4 sides + top). One `MeshCollider` `'scatter:detail'` built with `buildBvh` by `buildDetailCollider(detail)` in `engine/world/colliders.js` next to `buildTrunkCollider`, pushed onto `world.colliders`. No gap validator (props are walk-around, not a maze), but content keeps collider species >= 1.2 m apart through `cellM - 2*jitter`.
5. **Draws = RE-06 instance groups, fed per frame from tiles (not all-static like the trees):** the band can hold ~20-40k placements, and compacting all of them every frame would cost ~1 ms JS. New `engine/mesh/scatterFeed.js` (imports `instances.js` only):
```js
/** Load-time: one master InstanceBuffer (words written once with writeUnitInstance, objectId DETAIL_OBJECT_BASE | i,
 *  DETAIL_OBJECT_BASE = 0x40000, team 0) + one group per species (capacity min(speciesCount, maxDraw),
 *  g.lodCells = layer.lodCells, g.castShadow = species.shadow). Throws when a model is not in the pool,
 *  when groups would pass MAX_INSTANCE_GROUPS, or when treeInstances + maxDraw > MAX_INSTANCES_PER_FRAME (names detail.maxDraw). */
export function bindDetailInstances(detail, instances, cfg, treeInstances) // -> DetailBinding {groups, master, lastX, lastY, fed}
/** Per rendered frame, before either twin builds its list. Returns early (no writes) unless force or the eye
 *  moved >= refeedM since the last feed. Else: every group count = 0; tiles in a precomputed nearest-first
 *  offset order (built at bind) within max drawM; per placement, if dx*dx + dy*dy < r2[i], copy its 16 u32 words
 *  into group[species[i]].ib at g.count++; stop everything at maxDraw (hard cap, nearest tiles win). */
export function feedDetail(binding, eyeX, eyeY, force) // -> fed count
```
   The engine calls `feedDetail(engine._detail, cam.x, cam.y, false)` once per rendered frame from the render entry (where `frameNo` advances), before `addToDrawList` in either twin; `loadWorld`/`setWorld`/teleport/gpucompare pose changes call it with `force = true`. Then RE-15 does frustum cull + LOD1 + compaction on <= `maxDraw` instances like any group. The "fade" is the dithered radius `r` (ASCII has no alpha); LOD1 starts at `lodCells` (default 4). `bindDetailInstances` is called from the same `bindScatterInstances` entry that ME-06c3 adds to `engine.js` (trees first, so trees keep shadow priority on overflow) and removed on world unload.
   **Engine changes outside scatter:** `MAX_INSTANCES_PER_FRAME` 2048 -> 4096 (trees ~1.6k all-static + `maxDraw`; the GPU buffer becomes 256 KB, nothing else is sized by it; check tests that assert 2048). `InstanceGroup.castShadow` (default `true`); `shadowList.js` skips groups with `castShadow === false` (tufts/flowers never cast; rocks/logs/bushes may).
6. **Determinism / twins:** placements depend only on content + hash; the fed set depends only on the camera eye and the last feed position, identical for both twins of one frame (same groups, same memo). Yaws off 90 deg use the existing face-7 path (as trees). No `Math.random`, no per-instance scale (size variety = designer variants at another `cellM`, as 37.2 did for trees; a scale in the instance matrix would break the voxelPose exactness both twins rely on).
7. **Budget (owner Arc iGPU, 400x150, p95, mesh path):** walk-out pose detail-on minus detail-off <= 0.6 ms GPU, `shadows=map` adds <= 0.3 ms; dense-forest pose trees+detail minus both off <= 1.5 ms. JS: `feedDetail` <= 0.1 ms on a refeed frame, 0 on others; RE-15 compaction of <= 768 instances <= 0.15 ms. Load: `scatterDetail` + sort <= 40 ms, BVH <= 10 ms (Node, warn-only). Allocations: 0 per frame (1000-frame walk with refeeds, `--expose-gc`). Models: tufts/flowers LOD0 <= 150 tris, bushes/rocks/stumps <= 400, logs <= 600; LOD1 is the automatic RE-15b mesh. If over budget, in this order: lower `drawM`, lower `maxDraw`, lower `fill`, designer trims models.
**Do not:** put detail into `world.structures`/props/entities (no ids, no save); scatter per frame or feed outside item 5; compact all placements every frame; give colliders to tufts/flowers/small stones; read live entity positions for keepOut; touch `farHDraw`/terrain heights; scatter outside the near band; widen gpucompare thresholds.

**Models (existing, placeholder or final):** `grassPatch` (vp, 0.5 m, very flat: may read as nothing, designer checks), `sbMoss` (moss patch), `bush` (vp, ~0.9 m), `stump` (vp, 0.35 m), `treeTrunk` (sb, 1.6 x 2.0 m big stump, prism collider), `sbFG`/`sbFG2` (forest-floor debris tiles, `yawStep 90`), `sbStnWallRbl`/`sbStnWallBrkn` (stone rubble near the tower/Ruins only, a small `rocks` layer or ME-14c4 hand placement). Unfit: gravestones, crates/barrels, village walls, `campfire`, `toolPlate`, animals (hand-placed props, not scatter).
**Missing -> designer (ENV-01d):** rocks S/M/L (0.3 / 0.8 / 1.6 m, 2 variants each, stone + moss keys), taller grass tufts (2-3 variants, 0.3-0.6 m, grass/grassDark/grassLight), flowers (3 colours; needs palette petal keys), fern, mushroom cluster, fallen log (2-3 m, box collider), pebble cluster; `design/preview/detail.html` and the first `recipe.detail` with measured collider sizes.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| ENV-01a1 data | PC-B | 0.5 d | `engine/world/scatter.js` (`scatterDetail`, `validateDetailConfig`, shared helpers), `engine/world/colliders.js` (`buildDetailCollider`), `engine/world/World.js` (`opts.detail`, `w.detail`, collider push) | `scatterDetail.test.js` on a synthetic band: two runs byte-identical; no placement on a type without species, within `clearM` of another type, steep, in a structure bbox + 2 m, in a keepOut disc/capsule or an entity disc; `tileStart` covers every index once and each placement sits in its tile; moving a saved-state entity changes nothing; validator throws naming the key; `maxPlacements` throws; `scatterTrees` output unchanged (existing test). `detailColliders.test.js`: the player circle cannot enter a prism rock or a 37-deg yawed log box, can stand on a rock top, grass species add no triangles, 600-step replay hash identical over 2 loads; grid physics bit-identical. Print `world_m1` counts per layer | run-tests + check-deps green; **can start now** (independent of ME-06c3); ends in `arch-review` |
| ENV-01a2 draw | PC-B | 0.75 d | `engine/mesh/scatterFeed.js` (+test), `engine/mesh/instances.js` (MAX 4096, `castShadow`), `engine/mesh/shadowList.js`, `engine/core/engine.js` (bind in `bindScatterInstances`, per-frame feed, unload), `engine/index.js`, `game/js/main.js` (`detail` flag, `?scatter=0` - see item 1 erratum), `gpucompare.js` (pose `world_m1: detailWalkout`: eye 1.6 m on the walk-out ~12 m west of the breach, looking W, detail on through the same per-pose mechanism ME-06c3 uses for forestWalk; dda SKIP) | `scatterFeed.test.js`: fed set == brute force ("r2 test, nearest tiles first, cap maxDraw") for 20 eye positions; no writes when moved < refeedM; force refeeds; cap respected; words bit-equal to the master; 0 alloc over 1000 frames with refeeds; bind throws on a missing model / too many groups / over MAX; unload leaves 0 groups. shadowList: a `castShadow:false` group is absent | **only after ME-06c3 is merged** (same `bindScatterInstances`, flag plumbing and gpucompare mechanism). `?gpucompare=1&renderer=mesh` 0 FAIL incl. detailWalkout, every existing row unchanged; `&shadows=map` detailWalkout PASS; one headless capture of the walk-out; F3 shows fed/culled/LOD1 counts; ends in `arch-review` |
| ENV-01d models | PC-A designer | 0.5 d | `design/models/env_detail.js`, palette petal/moss keys (shared file: append only), `design/preview/detail.html`, first `recipe.detail` | voxel validators PASS; print LOD0/LOD1 tris per model (item 7 bars) | owner OK on the preview; parallel to a1/a2, needed by 01b |
| ENV-01b tuning | PC-B content | 0.5 d | `design/levels/overworld_far.js` (`recipe.detail`: densities per ground type, `exclude` for the walk-out path, boar route, flag/door approaches), `game/index.html` (load `env_detail.js`) | world-load test: counts per layer within the content's stated range; boar-route and walk-out capsules empty; `validateDetailConfig` OK | owner look on `?renderer=mesh&physics=mesh` at the walk-out and the forest edge; boars still path freely; item 7 bars hold (F3 at the walk-out) |
| ENV-01c bench | PC-A | 0.25 d | none (`?bench=1` walk-out + forestWalk, detail on/off, shadows dda/map) | numbers in the row | item 7 bars met on the Arc (or tuned in item 7 order) |

**gpucompare impact:** existing poses keep detail off and must not change; one new pose `detailWalkout`. If ME-06c3 ends up enabling `realTrees` for the whole compare run instead of per pose, detail follows the same switch and the changed rows are accepted once as a new baseline (listed in the ENV-01a2 row with before/after), never by widening thresholds.

**Amendment 2026-10-04 (ENV-01a2 group-cap blocker; architect): dedup render groups. `MAX_INSTANCE_GROUPS` stays 32, `recipe.detail` stays as authored.** Item 5's "one group per species" is replaced by "one group per render key":
1. **Render key** = `model + '|' + shadow + '|' + lodCells`. `speciesDefs` stays one entry per authored species (layer, sinkM, collider are per species and do not change). `bindDetailInstances` walks `speciesDefs` in index order, creates one group per new key (first-seen order), and builds `binding.groupOf = new Uint8Array(speciesDefs.length)` (species -> index into `binding.groups`; `255` = species with 0 placements, so no group). Group capacity = `min(sum of its species' counts, maxDraw)`; `g.castShadow = shadow`, `g.lodCells = lodCells` (both part of the key, so they are always consistent). `feedDetail` writes into `groups[groupOf[species[i]]]`; nothing else in item 5 changes (same tile order, same cap, same words).
2. **Canonical count:** `world_m1` has 19 distinct models, `shadow` is the same for every use of a model, `lodCells` is 4 in every layer -> **19 detail groups + 6 tree groups = 25**. The bind check stays (throw on over 32, message gives the deduped count and names `detail.layers`); it counts groups already registered (gpucompare's `lever` group etc.).
3. **Why not raise the cap:** it is only a registry guard (nothing GPU-side is sized by it), so raising it is cheap, but every group is one instanced draw per part in the camera pass, the JS twin and the sun shadow list; 42 groups of the same 19 meshes would double the draws for nothing. If content ever needs more than 32 after dedup, raising to 64 is a one-line change + `instances.test.js` update, decided in that story, not here. No designer recipe change.
4. **Fold-in (ME-06c3 review note):** in `bindScatterInstances` remove the `previous` groups **before** the validation that can throw, so a failed bind leaves 0 stale groups bound to the new world.
5. **Tests (add to `scatterFeed.test.js`):** two species with the same model in two layers or ground types share one group and its fed set equals the brute force grouped by key; the same model with different `shadow` gives two groups; `groupOf` covers every species with placements; a canonical `world_m1` bind (Node, synthetic pool with the 19 keys) prints and asserts 19 detail groups.

### 37.5 Sprites for ground details? (owner question; architect, 2026-10-04)

**Decision: no billboard sprites for scatter. 37.4 stays as written (voxel instances); there is no `kind: 'sprite'` species.** Reasons, from the code:
1. **Cap and per-cell cost.** `MAX_SPRITES` is 64 per frame (`engine/render/sprites.js`). Every entity sprite and the horizon lights share it, and the sprite shader loops over all 64 for every cell (`sprites.frag.js`; this is why particles got their own layer, 32.1). 37.4 feeds up to 768 details, 12x the cap. Raising the cap makes every cell pay O(N).
2. **Near cull.** BUG-FIRE-001 culls sprites closer than `SPRITE_NEAR_DEPTH` 0.6 m. Tufts and flowers at your feet are exactly where detail matters, and they would pop out.
3. **Look match.** A sprite gets one `lightAt` per sprite (flat), no per-cell normal, no sun-shadow-map receipt, no edge outline and no LOD. Instanced voxels get all of these for free and match the trees (37.2) and the terrain.
4. **Cost.** Instances cost one draw per species group plus RE-15 cull + LOD1, about 0.6 ms GPU as budgeted in 37.4 item 7. Sprites would add a CPU projection per sprite plus the O(64) loop on every screen cell.

Parity would not be a problem, because both twins read `pool.spr`. The four points above are why the answer is still no.

**Card models give the owner the "painted sprite" look at instance cost (designer work, no engine change).** Tufts, flowers and ferns may be authored as **cross-card voxel models**: 2 or 3 one-voxel-thick planes crossed in an X (a star seen from above), painted like a sprite (grass/grassDark/grassLight, petal keys). They go through the 37.4 path unchanged: same `DetailSpecies` (`model`, `weight`, `yawStep 1`, `shadow false`), same feed, same groups. Rules for ENV-01d:
- Card height 0.3-0.6 m; plane thickness 1 voxel.
- LOD0 <= 150 tris (the item 7 bar; print it).
- Yaw the planes 45 deg in the model, so no plane faces the camera edge-on in the preview's default views and the X reads from every side.
- Ragged tops with holes read better than full rectangles.
- Small stones stay solid voxels.

**ENV-01a1/a2 are unchanged: no data split, no feed split.**

**Where sprites stay the right tool:** animated fire bodies (36.2), the torch flame (37.8), and single hero props that need frame animation. Never scattered content.

**Size / track:** 0 engine work. The designer folds card variants into ENV-01d (PC-A, within its 0.5 d).

### 37.6 DECAL-01 wall decals (scrawls) on the mesh path (architect, 2026-10-04)

**Finding confirmed:** `World.load` skips `decal:` props (`engine/world/World.js` ~l.454), and `serialize.js` skips them too. No renderer draws them, so KEEP THE LIGHT, STEEL FOR THE HUSH, the StickyBizcuit mason's mark (licence-required, OWN-REQ-013) and the keeper tally are all invisible.

**Decision: draw decals as text through the RE-07 overlay layer (28.9), using one new op.**
- The overlay is rasterised once in JS, and both twins read the same `ovl`/`ovlZ` arrays (the GPU overlay pass and `applyOverlay`), so parity holds by construction.
- The overlay is depth-tested against the scene, so a wall or pillar in front hides the decal.
- No shader change and no G-buffer change.
- The mesh path is required (D-037). The overlay is renderer-agnostic, so dda also gets decals, but nothing is accepted or tested on dda.

**Data (already in `content/levels/tower.level.json`, unchanged):**
- Prop shape: `{id, model: 'decal:<TEXT>', facing, wall: {x0, x1, y, z0, z1}}` for facing 0/180, or `wall: {y0, y1, x, z0, z1}` for facing 90/270.
- `facing` = compass direction of the face's outward normal, so `n = (sin f, -cos f, 0)`.
- New optional field `style` (overlay style key, default `'decal'`).
- Text = everything after `decal:`.

**World.load** (keep the skip for entity spawn):
- Collect each decal into `w.decals`. This is derived data: never serialized, and the hash is unchanged.
- Map the corners to world space with the structure's `frame` (the same local->world map interactables use), and rotate `facing` by `yawSteps * 90`.
- Entry shape: `{id, glyphs: Uint8Array (code - 32), ax, ay, bx, by, z0, z1, nx, ny, style: string}`.
- **a -> b is the reading direction.** A viewer facing the wall looks along `-n`, so their right is `r = (-cos f, -sin f)`. `a` = the end with the smaller dot with `r`. Check: KEEP THE LIGHT (facing 0, y 10) reads from x 17.8 toward x 15.2.

**Validation (throws naming `structId.propId`):** text is 1..64 printable ASCII characters; facing is one of 0/90/180/270; the wall keys match the facing (x0 < x1 with y, or y0 < y1 with x); z0 < z1; all values are finite.

**Engine API:**
```js
// engine/ui/overlay.js: new op (OPW 8 -> 12; ops stay numbers only)
/** Load time: registers glyph strings; returns ids. Throws past OVL_MAX_TEXTS 64 or 4096 glyphs in total. */
ov.setTexts(glyphArrays)          // -> Int32Array ids (resets on each call; World load)
/** Per frame. a->b = baseline in world (reading direction), z = baseline height, mul = rgb multiplier (lighting). */
ov.text(textId, ax, ay, bx, by, z, mul, style)
// engine/ui/decals.js (new; imports ../render/lighting.js lightAt only)
/** Load: resolves style keys -> ids and calls ov.setTexts. Throws on an unknown style key. */
export function bindDecals(overlay, decals)      // -> DecalBinding (preallocated)
/** Per rendered frame, after overlay.clear(). Back-face, distance cull, one lightAt per decal, one ov.text per visible decal. */
export function drawDecals(binding, overlay, cam, lights, world, drawM = 20) // -> drawn count
```

**Raster rule (`rasterText`, inside `flush`):**
- Let `n` = the glyph count. Project `a` and `b`, each pushed 0.02 m along the normal, at `z = (z0+z1)/2`. `span` = the cell distance between the two projections; `per = span / n`.
- **`per >= 0.75` (legible):** for glyph k, project the point at `u = (k+0.5)/n` along a->b, then `put(c, r, glyph, style, ref)` with that point's depth. Skip spaces (the wall shows through). If two glyphs land on one cell, the first wins (the existing rule).
- **`per < 0.75` (too small to read):** draw the a->b segment with the existing `line()`, using the style's 4 slope glyphs (e.g. `"~~/\\"` or `"-|\\/"`), so a distant scrawl reads as scratch marks.
- Every write multiplies the style rgb by `mul`: one closure variable set per op, `min(255, round(c*mul))`.
- One row only: no glyph scaling, no wrapping.

**`drawDecals`:**
- Cull a decal when the eye is behind its face (`dot(eye - mid, n) <= 0.05`) or when `|eye - mid| > drawM`.
- `mul` follows the 32.1 particle-emitter rule: `lightAt(lights, world, mid + 0.1 n, nx, ny, 0, out)` through the `shadeSprite` gain curve, luminance clamped to 0..1.5. A scrawl in the dark stays dark, and the lantern reveals it.
- No fog (decals are near).

**Host (main.js, 2 lines; PC-B main session):**
- After the world loads: `decalBind = bindDecals(engine.overlay, engine.world.decals)`. Append the styles `decal` and `decalFaint` to the merged `setStyles`, with fg from palette keys the designer names (e.g. `scrawl`/`scrawlFaint`). The mason's mark uses `style: 'decalFaint'`.
- Each frame, right after `engine.overlay.clear()`: `drawDecals(decalBind, engine.overlay, cam, fb.lights, engine.world)`.
- Leave decals on during cinematics.

**Budget:** <= 32 decals within drawM, <= 64 glyphs each. `drawDecals` + `rasterText` <= 0.05 ms JS per frame, 0 allocations per frame. One op per visible decal (OVL_MAX_OPS 1024 is ample).

**Tests:**
- `engine/ui/decals.test.js`, World.load fixture: `w.decals` has the right a/b order for facings 0/90/180/270 and for a `yawSteps 1` structure.
- Validator: throws on a bad facing, wrong wall keys, non-ASCII text, and text that is too long.
- A `serialize` round trip leaves `decals` out, and the world hash is unchanged.
- Raster: at 1.5 m in front of the scrawl, the letters land in reading order left->right on screen; at 15 m the scratch glyphs are used; behind the face, nothing is drawn; a box in front hides the letters it covers (depth test); `mul` scales the rgb.
- 0 allocations over 1000 frames.
- `overlay.test.js` and the `rtsOverlay` pose are unchanged.
- gpucompare (mesh): new pose `decalScrawl` (tower interior, eye 1.5 m north of KEEP THE LIGHT, looking S, lantern lit). The pose calls `drawDecals` itself after its `overlay.clear()`; every other pose stays unchanged.

| Step | Track | Size | Files | Done when |
|---|---|---|---|---|
| DECAL-01 | PC-B (engine -> arch-review) | ~1 d | `engine/world/World.js` (collect + validate), `engine/ui/overlay.js` (`setTexts`, `text`, `rasterText`, OPW 12), `engine/ui/decals.js` (new), `engine/index.js`, `game/js/main.js` (2 lines + styles), `design/palette.js` (2 keys, append only), `game/js/dev/modes/gpucompare.js` (pose) | run-tests + check-deps green; `?gpucompare=1&renderer=mesh` 0 FAIL incl. `decalScrawl`; one headless capture showing KEEP THE LIGHT legible at the pallet and the mason's mark legible at knee height; ends in `arch-review` |

**Do not:**
- spawn decal entities or put decals in saves;
- add a decal shader or a G-buffer channel;
- draw text into the CellBuffer directly (no depth test, no twin parity);
- allocate strings per frame.

### 37.7 VOX-CAP-01 more voxel props on the mesh path (architect, 2026-10-04)

**Finding:** `MAX_VOX_INSTANCES = 16` (`engine/voxel/VoxelModel.js`), and `VoxelPool.collect` keeps only the nearest 16 voxel entities. The tower now has 21, so 5 props drop out depending on where you stand.
- The 16 is a **dda constraint**: the GPU voxel pass loops `for ii < MAX_VOX_INSTANCES` per cell (`voxel.frag.js`), and VOXINST is sized by it.
- The mesh path does not need it: `addVoxelInstances` turns each pooled instance into ordinary `DrawList` items (`objectId 0x8000|k`).

**Decision: a per-renderer cap. No global raise, and no move to instancing yet.**
- New `MAX_VOX_INSTANCES_MESH = 48` in `VoxelModel.js`, exported via `engine/index.js`. `MAX_VOX_INSTANCES` stays 16 and keeps meaning "dda".
- `VoxelPool` reads `this.cap = this.renderer === 'mesh' ? MAX_VOX_INSTANCES_MESH : MAX_VOX_INSTANCES`, refreshed whenever `renderer` is set (make `renderer` a setter, or read it at the top of `collect`).
- Size all pool scratch for 48 once, in the constructor: `_nearIdx`, `_nearDist`, raw slots, shadow slots.
- Replace every `MAX_VOX_INSTANCES` use in `voxelPool.js` with `this.cap` (collect, `pushInstance`, `project`, `projectShadow`, stats). The warn-once text names the cap that applies.
- The dda GPU upload (`GpuCellPipeline._uploadVoxelInstances` / `writeInstanceRows`) only runs on dda. Add `if (count > MAX_VOX_INSTANCES) throw` there. It is a programmer-error guard (can't happen on dda), so a mesh-cap list can never overrun VOXINST.
- `objectId 0x8000|k` with k < 48 stays below `0x10000` (units) and below the view-model ids (37.8). Update the comments in `viewModel.js` and `DrawList.js`.

**Why not RE-06 instance groups for static props now:** props carry clips (`entity.play`, e.g. lantern variants, flag cloth anchors, `flash`), interactables remove them at runtime, and they are saved entities. Moving them to instance groups needs a static/animated split and group rebuilds on remove. That is a bigger story, and 48 covers the tower and the near overworld with headroom.

**VOX-CAP-02 (later, only if needed):** when one area needs more than 48 voxel entities, props with no clip and no interactable go to per-model instance groups built at load (the 37.2 tree path), rebuilt on `entity:removed`. Not now.

**Cost (mesh, owner Arc, 400x150):** each voxel instance costs one pose (`computeVoxelPose`, per part) plus the draws of its parts. Measured at the tower pose with all 21 in view, 48 vs 16:
- JS collect + project + `addVoxelInstances` <= 0.35 ms.
- GPU extra <= 0.3 ms p95.
- Warn-only in Node; the main session reads F3 once.
- Shadows (`shadows=map`): `projectShadow` uses the same cap, so props behind the player cast shadows again. This is expected and gets accepted in the review.

**Tests (`voxelPool.test.js`, plus one in `voxelMesh.test.js`):**
- `renderer 'mesh'` with 30 entities: all 30 queued, nearest-first order unchanged.
- 60 entities: the nearest 48 win, and the warning fires once, naming 48.
- `renderer 'dda'` with 30 entities: still 16 (unchanged behaviour; existing tests green).
- Switching the renderer mid-session changes the cap without allocating.
- `projectShadow` count == the cap-limited count.
- `addVoxelInstances` objectIds are unique and < 0x10000 at k = 47.
- 0 allocations over 1000 frames at 48.
- gpucompare (mesh): the tower poses that see more than 16 voxel props change once. List them before/after in the row; never widen thresholds. dda rows are unchanged.

| Step | Track | Size | Files | Done when |
|---|---|---|---|---|
| VOX-CAP-01 | PC-B (engine -> arch-review) | ~0.5 d | `engine/voxel/VoxelModel.js`, `engine/render/voxelPool.js`, `engine/render/gpu/GpuCellPipeline.js` (guard), `engine/index.js`, comments in `viewModel.js`/`DrawList.js`, tests | run-tests + check-deps green; `?renderer=mesh` tower shows all 21 props (headless capture from the stair landing); gpucompare mesh 0 FAIL with the changed rows listed; ends in `arch-review` |

### 37.8 TORCH-01 torch in the right hand (architect, 2026-10-04)

**Answer: mostly game-side, plus one small engine step.** The view-model layer (30.1, `engine/render/viewModel.js`) holds only **one** shown handle (`_h`, one `_last`/`_cap`, and `hide()` clears everything). The sword (left hand, after the BUG-VM-001 mirror) and the torch (right hand) need two at once.

The flame and the carried light need **no** engine change:
- **Flame:** an animated emissive billboard sprite (the 36.2 Build-style look the owner likes), pushed per frame with the public `SpritePool.push`.
- **Light:** the existing carried light (`components.light`, `attach: 'eye'`, offset + sway), with its offset set to the flame mount.

**TORCH-01a (engine, PC-B cross-track -> arch-review, ~0.5 d): multi-handle view model.**
- Per-handle state: `visible`, `_last`, `_cap`, `bobAmount`. At most 4 handles (`VM_MAX_HANDLES 4`); `load` preallocates each handle's state.
- `show(h, clip, tMs, blend)`: signature unchanged; marks h visible.
- `hide(h)` hides one handle. `hide()` with no argument hides all (old behaviour kept for existing callers).
- `capture(h)`.
- `setBob(phase, amount, h)`: `h` omitted = all handles. The phase is shared.
- `buildList` pushes one item per visible handle, in handle order (`DrawList(8)` is enough). `item.objectId = VM_OBJECT_ID - h` (0xFFFF, 0xFFFE, ...), so the edge pass outlines the torch against the sword.
- `stats.items` = the total.
- `mountEye`/`eyeToWorld` already work per handle / per camera; unchanged.
- **Call sites to update in the same step (game, small):** in `swordView.js`/main.js, `vm.hide()` -> `vm.hide(swordH)` and `capture()` -> `capture(swordH)`. Otherwise the sword's hide call (while the sword is not taken) also hides the torch.
- **Tests (`viewModel.test.js` additions):**
  - Two handles shown -> 2 items, distinct objectIds, each with its own pose.
  - `hide(0)` keeps handle 1 visible; `hide()` hides all.
  - Per-handle `capture`/blend state does not leak between handles.
  - JS twin with both handles: the cells of both win over a wall 0.2 m ahead.
  - 0 allocations over 1000 frames with two handles.
  - Existing sword tests unchanged; the gpucompare pose `viewModel` (one handle) unchanged.

**TORCH-01b (game + content, PC-B, ~0.75 d).** Starts after 01a and after the BUG-VM-001 left-hand mirror is merged. No arch-review unless engine files change.
- **Data (designer, in progress):** `design/models/torch.js` -> `ASSETS.viewModels.torch` (README 7.4 def, like the sword):
  - `rest` in the **right** lower corner (`pos.x > 0`);
  - clips `idle` (loop, slow sway) and `raise` (pick-up, 300 ms);
  - `bob`;
  - **mount `flame`** at the head top;
  - `depth.near >= PROJ_NEAR`;
  - **the flame mount's forward distance `-pe.y` must be >= 0.7 m** at rest and over the whole idle clip, because sprites closer than 0.6 m are culled (BUG-FIRE-001). A test checks this.
  - An emissive billboard `torchFlame` (sprite format, README 4): 4-6 frames `burn` at ~12 fps, anchor bottom-centre, all keys `e: true`, about 0.12 x 0.22 m.
  - A world prop model `torchProp` (voxel, on a wall bracket) that replaces the pick-up lantern.
- **`game/js/quest/torchTake.js`** (`torch.take`), replacing `lantern.take` in the tower content: interactable `torch`, prompt `[E] Take torch`, prop and hook light switched off as today. It:
  - sets `world.state['tower.torch.taken'] = true`;
  - gives the player `components.light {preset: 'torch', on: true, attach: 'eye', offset: {right, down, fwd}, sway: {amp: 0.02}}`, where the offset is the flame mount at rest in eye space: right = pe.x, fwd = -pe.y, down = -pe.z.
  - Remove the sword/lantern left-right flip from `swordTake.js`/`lantern.js`: the torch is always right, the sword always left.
  - Keep `lantern.js` for old saves: on `world:loaded`, a save with the lantern taken maps to the torch flag (one line), so a carried light is never lost.
  - Saves hold the flag and the light component only (state-only, as US-089).
- **`game/js/quest/torchView.js` `presentTorch(vmH, spritePool, cam, simTime, moving)`**, per rendered frame:
  - `vm.show(torchH, idle, tMs, false)` and `setBob(phase, moving ? 1 : 0, torchH)`.
  - Flame world point = `eyeToWorld(cam, mountEye(torchH, idle, tMs, flameMount))`.
  - `spritePool.push('torchFlame', 'burn', frame, x, y, z, null)` with `frame = floor(simTime * 12) mod n`.
  - The push must sit **between `pool.collect` and `pool.project`**. Add an optional `extra(pool)` callback to `createSpriteSystem().render(fb, world, cam, extra)` in `game/js/dev/spriteDev.js` (a game file).
  - Hidden while the flag is unset and during cinematics (as the sword).
- **Optional embers:** `engine.particles.burstAt('embers', ...)` at the light's world position (`attachedLightPos`), 1 particle every ~10 sim steps, from the sim side. Never from the render pose, because the particle sim is hashed.
- **Known limit (accepted):** the light offset is yaw-only (`attachedLightPos`). Under the pitched camera, the flame sprite follows the view-model pitch but the light does not: up to ~0.3 m drift at +-25 deg, which the shading does not show at these distances. If the owner sees it, a follow-up adds `pitch` to `attachedLightPos` (engine/entities, one term).
- **Tests:**
  - `torchTake.test.js`: take -> flag set, light preset `torch` at the mount offset, prop gone. A save round trip keeps both. An old save with the lantern taken loads with the torch light.
  - `torchView.test.js` (Node, fake pool): the flame push lands between collect and project; the frame cycles at 12 fps; nothing is pushed while hidden.
  - View-model data test: flame mount depth >= 0.7 m over the idle clip.
  - Tower level-load test: the prop and the interactable resolve.
  - One headless capture with `?renderer=mesh` after the take: torch lower right, flame drawn, sword lower left.
  - Owner look at the end (game feel: PO first review on opus, per the PO rule).

**Do not:**
- add a second view-model layer or a sprite path inside `viewModel.js`;
- move a world entity every frame to carry the flame (entities are saved state);
- drive particles from the render pose;
- lower `SPRITE_NEAR_DEPTH` for the flame (move the mount forward instead).

### 37.9 PREC: mesh-path precision follow-ups under D-039 (PREC-01..03; architect, 2026-10-04)

**One root cause for all three.** The GPU raster pass transforms vertices in **absolute world float32**: `uModel` translation (or the instance row `.w`) is ~1500 m, and `uViewProj` holds the camera translation (~-1500 m). At 1024-2048 m the f32 step is 1.2e-4 m, so `uViewProj * worldPos` cancels two large f32 numbers. Node probe (f32-emulated vertex stage, parapetSky camera (1486.5, 1025), 20k points 2-17 m away): clip `w` error up to **2.2e-4 m** and screen error up to **0.13 cell**. Camera-relative, the same probe gives **2.5e-6 m** and **2.4e-4 cell** (~500x smaller). The JS twin (float64) is the reference and is correct. Every pose in the reports sits at world (1364..1500, 966..1045), so:
- **PREC-01 forest:** the 1e-4 m vertex shift moves leaf-quad edges -> one sub-sample changes owner at (105,48) (mat 65/59). Kind-8 uv (mesh-local) is interpolated from shifted barycentrics -> `floor(u*ds*0.5)` look-hash flips (66 cells). The I*P float64-vs-float32 composition adds only ~1e-7 m: it is not the cause.
- **PREC-02 Ruins parapetSky:** GPU u/v off by up to 3.9e-4 (cell (25,57)), and the GPU derivatives (tpc 6.0605/6.0665) follow. The keys are equal, but continuous inputs that are not in the key (joint/bevel `fv` against the mortar width, `orientClassCode` from the derivatives) cross a threshold. Same root.
- **PREC-03 AO:** AO is **not** computed from voxel geometry in either twin. Kinds 1-6 read the per-vertex aux that `levelMesh` bakes into the shared MeshData, through the same `computeAoD` (rasterJS l.428 / mesh.frag). Kind 8/9 write packed normal or Infinity/1e30 in both twins. But AO aux is **per quad**, so it jumps at a seam between two same-plane quads. The sword cell (87,8) (depth 5.99564 vs 5.99598 = the 3.3e-4 shift; AO 3.48 vs 0.9998) is a seam-ownership flip: the GPU sample lands on the neighbour quad whose `h < nbrBLo` branch gives `1-fr`. The tower dressing (ENV-02) rebuilt the cheek wall/walkway, which adds new same-plane wall seams in the lamp-empty view. A seam column flips together over many rows -> 33 cells. Same root. **Exception:** lamp-empty's **light dLMax .304** is not explained by this (same plane, same normal). If it remains after PREC-01a, it gets its own diagnostic step (PREC-03b below).

**Rejected:** making the JS twin emulate f32 with `Math.fround`. GPU rounding is not specified (FMA contraction, ANGLE D3D11 vs Metal vs Mesa), so it can never be bit-exact, and it slows the oracle. Also rejected: new epsilon quantisation of the look-hash or AO inputs (it moves the tie, changes the look, and hides real bugs). Thresholds stay as they are.

**Fix: GPU render origin (camera-relative raster).** The JS twin keeps absolute float64 and needs no change.
1. `engine/render/projection.js`: new export `viewProjAtOrigin(M64, ox, oy, outF32)`: `out[k] = M[k]` for k < 12, and `out[12+k] = M[k]*ox + M[4+k]*oy + M[12+k]` for k < 4, computed in f64 and then stored to f32. This is the formula water already uses (GpuCellPipeline ~l.2381). Water keeps its own `sel.O` and is not touched.
2. `GpuCellPipeline._prepRaster`: render origin `O = (floor(cam.x/16)*16, floor(cam.y/16)*16)`, with z not rebased. The 16 m snap means O rarely changes, so there is no per-frame jitter. The error stays at <= ulp(64) ≈ 7.6e-6 m inside 64 m. Fill `_meshViewProjRelF32 = viewProjAtOrigin(_meshViewProj, Ox, Oy)` and use it for every **camera** raster program: static, voxel (incl. the view model `vmList`), instanced, cloth, terrain (step b). `frustumPlanes`/culling keep the f64 absolute matrix.
3. `_setModel(loc, m, o, ox = 0, oy = 0)`: translation `M[12] = m[o+9] - ox`, `M[13] = m[o+10] - oy`, with the subtraction in f64 before the f32 store. The static loop (~l.1814 inline copy) and the voxel loop (~l.2080 inline copy) switch to `_setModel(..., Ox, Oy)`. Cloth: `item.matrix` translation - O as well; the dynamic f32 world positions + an integer -O are exact.
4. `mesh.vert.js` instanced variant: new `uniform vec2 uOrigin;` and `vec3 wp = vec3(dot(iRow0.xyz, lp) + (iRow0.w - uOrigin.x), dot(iRow1.xyz, lp) + (iRow1.w - uOrigin.y), dot(iRow2.xyz, lp) + iRow2.w);`. The difference of two f32 values near each other is exact, and both twins already read the same f32 instance words. `vWorldZ = wp.z` and `vZBase = iRow2.w` are unchanged, because z is not rebased. The static and cloth variants are not changed (the rebase is in their `uModel`).
5. **Shadow pass unchanged:** `_sunMatF32` stays absolute, the shadow loops keep `_setModel(..., 0, 0)`, and `progShadowInst`'s `uOrigin` stays at its default (0,0). Write a comment there. Sun-shadow parity passes today; rebasing it is out of scope.
6. **Terrain (step b):** `terrain.vert.js` keeps `vWorldPos = (uModel * aPos).xyz` **exactly as today**. GA.xy holds world metres for kind 7, and the struct-foot carve and `terrainTypeAt` read it. Only the clip position gets a second model uniform: `gl_Position = uViewProj * (uModelRel * vec4(aPos,1))` with `uModelRel` = chunk translation - O. Do not derive `vWorldPos` from the rel position plus the origin.

**Do not:** change the JS twin's geometry, the `writeUnitInstance` word format, gpucompare thresholds, the tie rules (37.1 A1-A5), shade/look code, or the water/shadow matrices. Do not rebase z.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **PREC-01a** render origin for static/voxel/view-model/instanced/cloth (absorbs PREC-02 and the PREC-03 AO rows) | PC-B, ends in arch-review (PC-A) | ~0.5-1 day | `engine/render/projection.js`, `engine/render/gpu/GpuCellPipeline.js`, `engine/render/gpu/glsl/mesh.vert.js` | New `engine/render/gpu/renderOrigin.test.js` (Node): (1) `viewProjAtOrigin` equals `M * T(O)` within 1e-9 on f64. (2) The f32-emulated vertex stage (fround after each mul/add, as in the probe above) at the forestWalk and parapetSky cameras: rel max `w` error < 1e-5 m and screen error < 1e-3 cell. The abs path is asserted > 1e-5 m, to document why. (3) The instanced rel formula (row.w - origin in f32) is within 1e-5 m of the f64 I*P*aPos. `glsl.test.js`: `uOrigin` is in the instanced variant only, and the static/cloth sources are unchanged. Full Node suite + check-deps. | Main session `?gpucompare=1&renderer=mesh` (real GPU): **forestWalk, parapetSky, lamp-empty (AO count) and the hidden-sword yaw-40/pitch-20 row (violNonK8 = 0) PASS**. No previously passing row regresses. Record the other known-FAIL rows (voxel half-occl., rtsHill60, fpLevel0, shear/pitched sword, cloth) and note any that improve. |
| **PREC-01b** terrain clip rebase | PC-B, arch-review | ~2 h | `terrain.vert.js`, the GpuCellPipeline terrain loop | glsl string test (`vWorldPos` still from `uModel`). Terrain rows' GA.xy are bit-identical before and after (per-field diff in the compare report). | Run only if a row still fails after 01a on a kind-7/kind-1..9 boundary cell. Otherwise do it for consistency in the same PR as 01a if it is small. No row regresses. |
| **PREC-03b** (conditional) lamp-empty light dLMax .304 | PC-A (diagnostic) | ~2 h | none (diagnostic) | Dump the worst dL cells: kind/plane/normal/world pos/light list per twin. | Only if lamp-empty still fails on **light** after 01a. The verdict decides the fix: a light-pass twin difference (e.g. prop occlusion of the lantern in one twin) gets its own story. |

**Stop rule:** if a target row still fails after 01a(+b), the programmer does **not** add epsilons. They report the residual cells (kind, plane, u/v/depth both twins, distance to the nearest edge/seam/threshold) as `ASK ARCHITECT`. A residual below ~1e-5 m is a true tie and goes into a known-FAIL baseline under D-039.

### 37.10 PROP-COLLIDE-01 solid level props (architect, 2026-10-05)

**Data format (prop-local metres, origin = the prop's feet `transform`, axes turned by the prop's world yaw, scaled by its `scale`):**
```js
/** @typedef {{type:'box', c:[number,number,number], half:[number,number,number], yawDeg?:number}
 *          | {type:'prism', c:[number,number,number], r:number, h:number}} PropColliderShape
 *  box: c = centre, half = half extents, yawDeg = extra yaw on top of the prop's.
 *  prism: c = centre, r = inscribed radius of the 8-sided prism (same rule as ENV-01a1), h = FULL height. */
```
- Same key/shape as cloth colliders (`stairwell.canvas.colliders`, `c` always the centre), but **prop-local**, not level-local.
- Where it comes from: `prop.colliders` if the key is present (`[]` = explicit "not solid"), else the model's default `model.colliders` (voxel model def in `design/models/*.js`, same shape, model-local = the same frame), else none. The engine never infers colliders from voxels (pebbles would become solid). The existing free-text `collide` fields (`collide: 'sector'`, wreckage notes) are ignored and stay notes.
- **Composite props** (`awakeningCrates`, `awakeningKeeper`, README 7.6): the designer's `awkModel` builder in `m3_props.js` writes `model.colliders` itself: one box per piece taller than 0.12 m, from that piece's voxel bbox (anchor-relative, voxel size -> metres). Skip pebbles, papers and bedroll. That is content code, not engine code.
- **Not solid:** `dynamic: true` props (the boulder is a roller with its own body). They get a `console.warn` and are skipped. Sprite/billboard props are skipped too. Rule for content: only put colliders on props that never move or despawn (the BVH is static; a removed prop leaves its box behind).

**Build (engine/world/colliders.js + World.js):**
- New `buildPropCollider(shapes, count) -> MeshCollider|null`, id `props:static`. Input is a flat world-space list built by World.load: `{kind:0|1, x, y, zc, hx, hy, hz, r, h, yawRad}`. Boxes are **closed** (12 tris). Prisms are 8 walls + top + bottom (32 tris). Props can stand on walkways, so there is no ENV-01a1 -0.5 m ground skirt. Factor the ring/wall emitter out of `buildDetailCollider` and share it, but `buildDetailCollider`'s output must stay **bit-identical** (`detailColliders.test.js` unchanged).
- World.load: inside the prop spawn loop, collect the resolved shapes per prop. Transform with `cosSinDeg` (engine/voxel/voxelPose.js, exact at multiples of 90; same matrix as `writeUnitInstance`: `x' = c*lx - s*ly, y' = s*lx + c*ly`) from the **spawned entity's transform** (x, y, z, yawDeg, scale). After the loop, if `physicsMode === 'mesh'`, push one collider. It is derived data: not serialized, rebuilt on every load/deserialize, so it is deterministic.
- Editor: `World.rebuildPropColliders()` (same code, replaces the `props:static` entry in place). The editor calls it once on a prop-move commit, never per drag frame. Cost: tower ~25 boxes, ~400 tris, <1 ms.
- **Grid physics: skip.** Under D-037 mesh is the path that ships. Grid cells are 1 m, so cell blockers would close the 1.0 m wake corridor. Note for PO/main session: `game/js/main.js` still defaults to `physics: grid` when `?physics=mesh` is absent. The owner walks on `?renderer=mesh&physics=mesh`. Recommend a separate one-line story: "mesh physics is the default when the renderer is mesh". It is cheap to reverse, so it is a PO call, not a manager one.

**Do not:** add a per-prop BVH (one static BVH), refit per frame, put colliders on `dynamic` props, infer boxes from voxels in the engine, or use grid cell blockers.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **01a** engine: format, model fallback, builder, World wiring | PC-B (cross-track) -> arch-review (opus) | ~0.5 d | `engine/world/colliders.js`, `World.js`, new `engine/world/propColliders.test.js` | Box at facing 0/90/37, scale 1.5 -> expected world AABB (1e-9). Prism AABB. Capsule (`moveCircleMesh`) stops at a 0.5 m crate from 8 directions with gap = radius +-1e-6. `[]` opt-out over a model default. `dynamic` prop is skipped with a warning. Build twice -> identical `pos`. Load -> serialize -> deserialize -> 200 seeded `collideCircle` probes bit-equal. `detailColliders.test.js` unchanged. | Full runner + check-deps green |
| **01b0** engine: static sprite props (amendment below) | PC-B (cross-track) -> arch-review (opus) | ~0.1 d | `engine/world/World.js` (`rebuildPropColliders`), `propColliders.test.js` | Sprite prop with a model-default prism -> `props:static` has its 32 tris at the right world AABB; sprite prop without `colliders` -> no shapes; `[]` opt-out; `dynamic` sprite still skipped with the warning; voxel cases unchanged | Full runner + check-deps green |
| **01b** content: tower colliders | PC-B | ~0.25 d | `design/models/m3_props.js` (awk model colliders, floorLantern prism default), `content/levels/tower.level.json` (gondola, practiceTarget if not solid) | Tower load test: `props:static` exists. Route-walk legs green on mesh physics. Scripted walk through the wake -> burner -> stair corridor (>= 1.0 m clear, capsule passes). | Owner walk-test: crates/barrels/sacks/lanterns block, corridor walkable |

**Amendment 2026-10-05 (01b, floor lanterns are sprite props):** static sprite props may be solid. `rebuildPropColliders` resolves colliders for a prop whose entity has `components.voxel` **or** `components.sprite`, with the same rule (`prop.colliders` if the key is present, else `assets.model(<voxel|sprite>.model).colliders`, else none); the model key comes from whichever component exists. `dynamic`/`roller` props stay skipped with the warning; billboards and non-prop entities (units, items, boars) are never read. Sprite colliders are authored only (no inference from the sprite image). Content: `floorLantern` gets a model-default prism (e.g. `{type:'prism', c:[0,0,0.21], r:0.12, h:0.42}`, designer/01b sizes it). Reason: one engine line, no new voxel asset, and the same data path the editor and saves already use. No voxel lamp asset is required.

### 37.11 ED-GROUP-1 editor multi-select, groups, prefabs (architect, 2026-10-05)

**Decisions.**
- **Selection becomes a set.** `selection: SelItem | null` becomes `sel = { items: SelItem[], primary: number }`, where `SelItem = {fileId, collection, id, structId}` (today's shape). All single-item code reads `sel.items[sel.primary]`. Click = replace. Shift/Ctrl+click = toggle. Drag on empty space = **box select**: project each item's pivot with the current camera (the same projection `select.js` already uses for highlight rects); items whose pivot is inside the rect join the set. Only props and lights in v1 (no structures, triggers or interactables).
- **Group ops = one batch record = one undo step.** The existing `{label, batch:[EditRecord...]}` path in `commands.js` already applies and inverts batches across files. Move: a world-space delta applied to every item through its own frame (`itemToWorld`/`worldToItem`, so level props and world entities mix). Rotate: about the set's pivot (centroid xy, min z) by the yaw step. Rotate the position, add to `facing`/`yawDeg`, and use `localYawToWorld` for structure frames. Duplicate: mint new ids (`mintId`) and insert copies offset by +1 m x, then the copies become the selection. Delete: a batch of `makeDeleteRecord`. **Refuse the whole delete** if any member has referrers (`findReferrers`, same rule as single delete). Drag: livepatch every member per frame (`applyPropTransformPatch`/`applyLightPatch`). Commit one batch on release. `isPatchableRecord(batch)` = every sub-record is patchable.
- **Persistent group = a `group` field on items** (`group: 'g7'`, id from `mintId(file, 'group')`). Ctrl+G sets it on the selection (one batch of field edits). Ctrl+Shift+G clears it. A click on a grouped item selects all members. Alt+click selects one member. The engine ignores the key (unknown item keys are already tolerated). Groups live inside one file. A selection that spans files cannot be grouped (flash a message).
- **Prefab = a content file, stamped as plain items (no live link in v1).** We do not use a composite voxel model: it cannot hold lights, emitters or colliders, and it would bake art into one model. File `content/prefabs/<id>.prefab.json`, new kind `prefab` (schema 1, listed in the manifest):
  ```json
  { "kind":"prefab", "schema":1, "id":"crateCorner", "nextId":3, "title":"crate corner",
    "items":[ {"id":"p1","type":"prop","model":"crate","x":0.4,"y":-0.2,"z":0,"facing":90,"colliders":[...]},
              {"id":"p2","type":"light","preset":"lantern","x":0,"y":0,"z":1.3} ] }
  ```
  Items are in **prefab-local metres**: pivot at (0,0,0), yaw 0, z up from the feet. Item fields are the prop/light item fields minus ids and refs. `type` selects the collection.
  - **Save** (Assets tab "Save selection as prefab"): world positions minus the pivot, rotated by 0.
  - **Place** (Assets tab, prefab entry, click on the ground): pivot + yaw -> world -> `worldToItem(frame)` per item -> one insert batch. All inserted items share a new `group` id and get `prefab: '<id>'` (provenance only). Each item goes through `validateItem`, the same rules as `placeAt`. Example: a light outside a structure is refused, so it is dropped with a flash and the rest of the prefab is still placed.
  - **The game loads nothing new.** Stamped items are ordinary props/lights. `engine/content/schema.js` only learns the kind (`LATEST_SCHEMA.prefab`, `ID_COLLECTIONS.prefab = ['items']`, key order) so the manifest validates. The game never reads prefab files.
  - Linked instances (edit the prefab, update every copy) can come later as a `prefabs` instance collection that World.load expands. Nothing here blocks that.
- Thumbnail v1: a generic prefab icon + title. A rendered thumbnail is a later nicety.

**Do not:** add a second undo mechanism, rebuild the World per drag frame for a group, write prefab files from engine code, or put prefab expansion into World.load in v1.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **ED-GROUP-1a** multi-select (click toggle, box select, highlight all, outliner shows the set) | PC-B tools | ~0.5 d | new pure `tools/editor/multiSelect.js`; `select.js`, `main.js` | `multiSelect.test.mjs`: toggle/replace/box hit with a fixed camera (pivot in/out of rect, behind-camera items excluded) | Main session: one browser pass, box-select 5 tower props |
| **ED-GROUP-1b** group ops + `group` field (move/rotate/duplicate/delete, Ctrl+G) | PC-B tools | ~1 d | new pure `tools/editor/groupOps.js`; `main.js`, `livepatch.js` (batch patchable) | `groupOps.test.mjs`: move/rotate batch across a level file + world file round-trips (apply, invert -> identical doc); rotate 4x90 = identity (1e-9); duplicate mints unique ids; delete refused with a referrer; one undo step restores everything | Owner: group the crate corner, move/rotate/undo |
| **ED-GROUP-1c** prefabs (kind, save, Assets tab entry, place) | PC-B tools + tiny engine schema touch -> opus arch-review | ~0.75 d | new pure `tools/editor/prefab.js`; `io.js` (new file save), `engine/content/schema.js`, `content/manifest.json` | `prefab.test.mjs`: selection -> prefab (pivot/yaw normalised) -> place at (x, y, yaw 90) -> world positions match the expected values (1e-9); placed items share one group; content loader accepts kind `prefab`; `validate-content` green | Owner: save a group as a prefab, place it twice, reload the game, both copies present |

### 37.12 ED-TERRAIN-1 terrain brush (architect, 2026-10-05; D-007)

**Decision: a sparse height-delta + type-paint grid layer (an edit layer), not stamps.**
- Stamps (`overrides[].stamps`) are evaluated per sample over one flat list. `typeAt` calls `heightAt` 5x, and the near band is 36.9k samples, so a brush stroke of ~200 dabs as stamps would make every bake (near, far, and every chunk forever) ~200x slower. Smoothing also cannot be expressed as stamps. A grid layer costs O(1) per sample no matter how many edits there are.
- Stamps stay for authored, semantic shapes (tower crown, pond bowl). Editing those as gizmos is a later story.

**Layer (engine/world/terrainEdits.js, engine-owned, pure):**
```js
/** @typedef {{cell:number, chunkSize:number,
 *   chunks: Map<string, {dh:Int16Array, type:Uint8Array}>}} TerrainEditLayer
 *  Per touched 128 m chunk "cx,cy": 64x64 samples at x = cx*128 + i*cell (cell 2 = the near grid).
 *  dh in centimetres (Int16, +-327 m). type: 255 = no paint, else a TYPE_IDS value.
 *  heightDelta(x,y): bilinear over the samples (a missing chunk/neighbour = 0). typePaint(x,y): nearest sample or -1. */
export function createEditLayer(cell, chunkSize) {}
export function editLayerFromJSON(obj) {}  // base64 LE Int16 / Uint8 per chunk; validated
export function editLayerToJSON(layer) {}  // chunks sorted by key, all-zero chunks dropped -> deterministic bytes
export function applyDab(layer, terrain, op, x, y, r, strength, outRect) {} // op: raise|lower|flatten|smooth|paint; writes the touched sample rect
```
- Integer cm storage means the editor's in-memory values are exactly what gets saved (deterministic, no float drift through JSON).
- Dab ops edit `dh` so that the **total** height moves:
  - raise/lower: `+-strength * falloff`.
  - flatten: toward the height at the stroke start, `target - groundAt`.
  - smooth: toward the 3x3 mean of `groundAt`.
  - paint: sets `type` inside r (hard edge, 2 m cells).
  - Falloff is the recipe's `smooth()` curve.
- **Recipe hook (contract v2.1, `design/levels/overworld_far.js`):** add `util.setEditLayer(layer|null)`, duck-typed: only `heightDelta`/`typePaint` are called. `heightAt = structureBlend(applyStamps(recipe) + layer.heightDelta)`. structureBlend stays last, so the structure ring handover stays exact and a brush can never move a footprint. `typeAt`: river first, then `typePaint >= 0`, then path, then paints, then the rest. The edit paint wins over path and old paints, never over the river.
- `Terrain` constructor always calls `util.setEditLayer(opts.edits || null)`, so a reload without edits clears it. The layer is module-global in the recipe, like the structure injection. Tests that build two Terrains must set it explicitly.
- **Empty layer = today's terrain, bit-identical** (`checksum()` unchanged).

**Save/load:** `content/terrain/<terrainKey>.edits.json`, kind `terrainEdits` (schema 1, in the manifest):
```json
{"kind":"terrainEdits","schema":1,"id":"overworld_far","cell":2,"chunks":{"11,8":{"dh":"<b64>","type":"<b64>"}}}
```
- The editor never rewrites the `.js` recipe.
- Registry: `assets.terrainEdits(key)` (absent = none). World.load passes it to `new Terrain(recipe, {edits})` before any bake.
- Edits are content: saves keep only the terrain key (no save-format change). Changing edits bumps `contentVersion` as any content change does.

**Live re-bake (only what is dirty):**
- `Terrain.rebakeRect(x0, y0, x1, y1)` re-bakes near-band samples in the rect + 2 m margin (typeAt slope eps) via `util.bake` on the sub-grid and copies them into `near.height/type/hDraw`. It widens `minH/maxH` (exact recompute on stroke end), bumps `near.version`, and records `near.dirty = {i0, j0, i1, j1}`. It also re-bakes the far texels under the rect (`farH/farType/farHDraw`, `farVersion++`).
- Budget: a r <= 8 m dab <= 1.5 ms JS. The GPU repack on `near.version` is the existing full 192x192 path (<1 ms), so keep it.
- `TerrainMeshSet.markNearDirty(rect)` rebuilds only the near chunk meshes that the rect overlaps (+ stitch if an edge chunk). It must not use the band-flip identity path, which rebuilds the whole band row by row.
- On **stroke end** (mouse-up), not per dab: re-run `scatterTrees`/`scatterDetail` + trunk/detail colliders, and re-snap `z:'ground'` props. Budget <= 150 ms, editor only. If it is slower, restrict it to the dirty chunks in a later step.
- Undo: one record per stroke, `{kind:'terrain', key, rect, before:Int16/Uint8 sub-arrays, after}`. Add it to `commands.js` applyEdit/invert. It marks the edits file dirty and calls `rebakeRect`.

**Do not:** write stamps per dab, regenerate the far bake or the whole near band per dab, edit the `.js` recipe from the editor, let the brush act inside structure footprints (structureBlend wins by construction anyway), or put a float `dh` in JSON.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **ED-TERRAIN-1a** edit layer + format + recipe hook + load | PC-A engine (or PC-B cross-track) -> arch-review | ~1 d | new `engine/world/terrainEdits.js` (+test), `design/levels/overworld_far.js` (hook), `engine/world/Terrain.js` (opts.edits), `World.js`, `engine/content/schema.js` + registry accessor | Empty layer -> `checksum()` equals today. Each dab op gives the expected values on a flat stub recipe. JSON round trip is byte-identical. The ring height at a structure edge is unchanged under a raise dab. typeAt order (river > paint > path). A hand-written edits file loads in world_m1 and `groundAt` shows the delta. | Full runner + check-deps + validate-content green |
| **ED-TERRAIN-1b** live dirty re-bake | PC-A engine -> arch-review | ~1 d | `Terrain.js` (`rebakeRect`), `engine/mesh/terrainMesh.js` (`markNearDirty`) | After dabs, `rebakeRect` == fresh `bakeNearBand` (bit-identical height/type/hDraw) and far texels == `bakeFarSync`. A rebuilt chunk mesh == the fresh-build mesh. Timing: 100 dabs r 8 m, p95 <= 1.5 ms (Node). | `?gpucompare=1` unchanged (empty layer) |
| **ED-TERRAIN-1c** editor brush tool + undo + save | PC-B tools | ~1 d | `tools/editor/main.js`, new pure `tools/editor/terrainBrush.js`, `commands.js`, `io.js`, `content/manifest.json` | `terrainBrush.test.mjs`: dab spacing along a drag (fixed-step, deterministic), one stroke = one record, undo restores bytes exactly. io round trip of the edits file. | Owner: raise a hill, flatten, smooth, paint path, undo, save, reload the game: same terrain |

### 37.15 TREES-LP low-poly trees (architect, 2026-10-05; owner "we should use low poly trees")

**Probe (2026-10-05, Node, own binary FBX reader, `design/meshes/cozy_nature/Meshes/*.fbx`):** FBX 7400 binary (32-bit node headers, zlib arrays), one `Geometry` + one `Model` + one `Material` per file, `UnitScaleFactor 1` (cm), Y-up, a `Lcl Translation` of ~(-86, 0, -97) m on the model, `LayerElementMaterial` AllSame, one diffuse texture per file that is **not in the pack** (only the grass/ground PNGs are on disk). **The cozy trees are not low-poly:** they are greedy-meshed voxel exports - 100 % axis-aligned normals, unwelded quads (verts = 4 x quads). `oak_tree_*`: 5,563 quads = **11,126 tris**, 10.4 cm voxels, 10.4 x 11.4 x 12.3 m; a fresh greedy merge gives 5,552 quads (no gain). `pine_tree_*`: **4,434 tris**, 5.9 cm voxels, 12.5 m tall. Small props: rocks 86-272, mushroom 538, flowers 220-376, grass 120-180 tris, all voxel-style, colour textures missing. Importing them swaps a 13.8k-tri voxel oak for an 11.1k-tri voxel oak with no colours, so it does not answer the owner's ask.

**Decisions:**
1. **Source = a deterministic low-poly tree generator, not FBX.** `tools/treeGen.js` (pure, no fs, Node- and browser-importable) + CLI `tools/tree-gen.mjs` -> `content/meshes/trees/<id>.mesh.json` (same envelope as `tools/gltf-import.mjs`). Shape per species: a tapered trunk prism (7-9 sides, 1-2 short branch prisms); crown = 3-6 overlapping **subdivision-1 icospheres** (80 tris each, radius jitter +-15 % from the seed); conifer = 3-4 stacked cones of 9-12 sides. Target 250-450 tris, **cap 600 per variant** (content test). Params are designer data in `design/trees/lowpoly-trees.js` (tools may import design; the engine never does). The FBX reader is **parked** (TREES-LP-x) until a pack with real low-poly geometry and its textures shows up. A CC0 low-poly pack that ships glTF (e.g. Kenney Nature Kit) needs **no new tool** (`gltf-import.mjs` + `--mats`): an owner option, not a dependency.
2. **One triangle assembler.** Factor `loadGltf` pass 2/3 (gltf.js ~l.600-660) into an exported `buildMeshFromTris(tris, ranges, id, opts) -> MeshData` (`tris[i] = {p0, p1, p2, normal, matName}`, metres, our axes). `loadGltf` calls it (Ruins `.mesh.json` re-import **byte-identical**, tested). The generator calls it with flat normals (37.1 A4), planar mesh-local UVs, `matName` in `bark` / `leaf` / `leafDark` / `leafLight`, and `mats` mapping them to palette materials `timber_old` (or a new `bark`), `leaf`, `leaf_dark`, `leaf_light`. Pivot = trunk base centre at (0,0,0), +z up.
3. **Render = instanced kind-9 mesh groups (RE-06 words unchanged).** `InstanceGroups.meshGroup(mesh, capacity)` (instances.js): the same `InstanceGroup` with `mesh` (registry MeshData, unresolved) instead of a voxel `modelKey`; `parts` = one identity part (`count 1`, `flags[0] = 1`); `lodCells` forced 0; `castShadow` as today. `addToDrawList(list, cache, planes, frameNo, viewProj, rows, meshDraw)`: new optional last arg `meshDraw = {cache: MeshDrawCache, idFor}` (each caller keeps one module-level object and refreshes `idFor` when `matTable` changes, as for `addMeshStructures`). A mesh group resolves `meshDraw.cache.get(g.mesh, meshDraw.idFor)` (37.1 item 3), then the same `compactGroup` + `list.addInstances`. `meshDraw` null -> mesh groups skipped. `buildShadowList` gets the same branch with `src.meshCache`/`src.meshIdFor` (already in `src`). **No shader change, no new program:** `progMeshInst` reads per-vertex `aFlat` (kind 9 flows through) and builds `vNrmW` through the instance rows; `mesh.frag`'s kind-9 face rule (ME-14c3) reads `vNrmW`; rasterJS's instanced path sets `isMesh` from the flat kind. Camera-relative raster (D-039, PREC-01a `uOrigin`) applies automatically (it lives in the instanced variant). planeId = `aFlat.x | (objectId & 0xF) << 24` (TAG_MESH bits 28-31 untouched), so neighbour trees differ.
4. **A1 crease gate scope:** the kind-9 "no edge when dot(nI, nR) >= cos 30" rule applies only when both cells are the **same placement** (`planeId >>> 20` equal). Otherwise two overlapping trees with similar normals lose their outline. If ME-14c3 landed without that, TREES-LP-b adds it in both twins (`edgePass.js`, `edge.frag.js`).
5. **Content hook:** `recipe.forest.trees.species[i]` takes exactly one of `model` (voxel, today) or `mesh` (`'trees/oakA'`); validator in `scatter.js` (`species[i]: exactly one of model/mesh`). `World.load` resolves `world.scatterMeshes[s] = assets.mesh(id)` once (missing id throws naming the species). `bindScatterInstances` creates a `meshGroup` per mesh species with the same words (`writeUnitInstance`, `SCATTER_OBJECT_BASE | i`); optional per-species `shadow` (default true). `trunkR`/`trunkH` stay config (prism colliders unchanged); the generator prints measured values. Scatter, colliders, save/hash: unchanged.
6. **LOD / far:** none. 485-1,500 trees x <= 600 tris = 0.3-0.9 M tris before the frustum cull (today the raw oak LOD0 alone is ~6.7 M). No billboards, no LOD1 for mesh groups; the ME-06b far canopy still covers beyond the band. Revisit only if TREES-LP-e misses the bars.
7. **Look (kind 9, 37.1 item 1):** crown facets are mostly face 7 (packed normal) -> lit per facet, `fk = 1`; up-facing ones are face U (`isUp`). Detail glyphs come from the existing leaf materials (`&`, `%`, `textureFade [4,14]`) on planar mesh-local UVs; facet edges >= ~0.5 m or the glyph pattern collapses. **Neighbouring crown facets must differ by < 30 deg** (icosphere subdiv 1 ~ 20 deg) so the crease gate draws only blob silhouettes and blob-to-blob seams, not a wireframe; trunk sides 40-50 deg apart give vertical bark lines (accepted). No `faceK`, ramp or shade code changes; a `bark` material is optional designer work.
8. **Budget (Arc iGPU, 400x150, p95; replaces the tree half of ENV-01c):** forestWalk trees-on minus trees-off <= 1.0 ms GPU, `shadows=map` adds <= 0.5 ms (37.2 item 8 bars); JS cull + compaction for 1,500 instances <= 0.3 ms; 0 allocations per frame (1000-frame test); mesh draw-cache build once.

**Do not:** put an FBX reader in `engine/`; give mesh groups a second instance-word format or per-instance scale; add LOD/billboards; change `writeUnitInstance`, `compactGroup` or the voxel group path; resolve materials into the registry MeshData; widen gpucompare thresholds (D-039 known-FAIL baselines only).
**ME-19 overlap:** none of these files is deleted by ME-19 (it removes sectorCaster/terrainCaster/voxelMarch, `dda/terrain/voxel.frag`, `?renderer`). TREES-LP-b touches `compositor.js` and `GpuCellPipeline.js` by one argument each: a trivial merge if ME-19 runs at the same time. Hard prerequisite for b: **ME-14c3 published** (kind-9 GLSL face rule); **PREC-01a** preferred (else forestWalk keeps the PREC-01 ties).

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| TREES-LP-a | PC-B tools (now) | ~0.75 d | `engine/mesh/gltf.js` (`buildMeshFromTris` extract only), `tools/treeGen.js`, `tools/tree-gen.mjs` (+tests), stub `design/trees/lowpoly-trees.js` (1 oak, 1 pine) | `gltf.test.js`: Ruins re-import byte-identical. `treeGen.test.mjs`: same seed -> byte-identical JSON; tris <= 600; flat normals; outward winding (signed volume > 0 per closed blob); max neighbour-facet angle in crowns < 30 deg; pivot = trunk base; `validateMesh` OK; prints tris + trunkR/trunkH | run-tests + check-deps green; 2 stub meshes in `content/meshes/trees/` + manifest |
| TREES-LP-b | PC-B engine, arch-review | ~1 d | `engine/mesh/instances.js` (`meshGroup`, `meshDraw`), `engine/mesh/shadowList.js`, `engine/render/compositor.js` + `gpu/GpuCellPipeline.js` (pass `meshDraw`), `edgePass.js`/`edge.frag.js` only if item 4 is missing | `instances.test.js`: a mesh group of N instances via rasterJS == N static `addMeshStructures` placements with the same matrices (kind/face/mat/depth cells equal); cull/compaction as a voxel group; `meshDraw` null -> skipped; 0 alloc over 1000 frames; shadow list has the group unless `castShadow` false. Edge test: two overlapping instances, equal normals, 2 m apart -> outline | `?gpucompare=1&renderer=mesh` no new FAIL vs baseline; new pose `world_m1: lowpolyTrees` (6 instances, eye 8 m) PASS on the real GPU |
| TREES-LP-c | PC-B engine+content, arch-review | ~0.5 d | `engine/world/scatter.js` (validator), `World.js` (`scatterMeshes`), `engine/core/engine.js` (`bindScatterInstances`), `design/levels/overworld_far.js` (species -> `mesh`), `content/manifest.json` | `scatter.test.js`: model XOR mesh; world test: unknown mesh id throws naming the species; groups = species, words == placements, reload leaves 0 groups; voxel species still work | forestWalk re-baselined (old/new rows recorded); one headless capture inside the forest |
| TREES-LP-d | PC-A designer | ~0.75 d | `design/trees/lowpoly-trees.js` (oak, birch, pine x 2 sizes, 8-14 m per 37.2), `content/meshes/trees/*`, optional `materials.bark`, `design/preview/trees-lowpoly.html` | generator content tests (a) | owner OK on the side-by-side preview (voxel `forest*` vs low-poly, same camera, day light, 3 distances); needs a; parallel with b |
| TREES-LP-e | PC-A | ~0.25 d | none (bench = tree half of ENV-01c) | Arc `?bench=1` forestWalk trees on/off x shadows dda/map | item 8 bars met, recorded in the row; owner walk-test "low-poly forest" |
| TREES-LP-f (later) | PC-B | ~0.5 d | `scatterFeed.js`/`scatter.js`: detail species `mesh` (same `meshGroup`) | as c, for `recipe.detail` | after e; low-poly rocks/mushrooms from the generator (`rock`/`cap` shapes) |
| TREES-LP-x (parked) | PC-B tools | ~0.75 d | `tools/fbx-import.mjs`: binary 7100-7500 (13/25-byte node headers, props YCIFDLSR + zlib arrays fdlib), Geometry Vertices / PolygonVertexIndex (negative = end, fan) / LayerElementNormal+Material, names via Connections, `UnitScaleFactor` -> m, Up/Front axis -> x east y south z up, drop the model `Lcl Translation` (pivot = bbox base centre) -> `buildMeshFromTris` | fixture FBX bytes in the test | only if the owner wants FBX content with real low-poly geometry |

### 37.13 ME-19 plan: delete the old renderers (architect, 2026-10-05; D-029 item 8, D-037 follow-up; owner "first remove the old dda")

Probed state (2026-10-05, `pc-a`): 224/224 suites, check-deps OK with **1279** `gl.*`-outside-`device/*` WARNs (GpuCellPipeline 779, gridTargets 175, spritesPass 160, glUtil 83, overlayPass 62, GpuTimer 20). `rasterJS.js`, `terrainMesh.js`, `voxelMesh.js`, `levelMesh.js` import **no** caster module (27.15.0 holds; tests do, as oracles). The mesh path still *runs* dda-era code in three places: `compositor.js` (imports `beginFrame/fillSky/ambientL/primeAmbientLight` from sectorCaster.js and `shadeTerrainCells` from terrainCaster.js), `GpuCellPipeline.js` (`sunFromWorld/terrainHBounds/activeNearLOD` from terrainCaster.js; `_ensureWorldTextures` uploads the GEOM/MATS/FLAGS atlas **every frame on mesh too**, because `light.frag`'s sun DDA reads it when `shadows.sun === 'dda'`, which is still main.js's default), and `lighting.js`/`light.frag` (LVIS point-light occlusion on both renderers).

#### 37.13.1 Gap list (what the dda/shear path still provides) - K = keep (move/rename into the mesh path), P = port, D = delete

| # | Item | Who depends on it | Verdict |
|---|---|---|---|
| 1 | **CPU fallback when WebGL2 is missing / `?gpu=0` / `?force2d=1`** | main.js `effRenderer` falls to `'dda'` whenever `gpuPipeline` is null -> CPU casters at `cpuGrid` | **P**: the mesh JS twin (`renderWorldMesh` = rasterJS) *is* the CPU path; set `fb.renderer = 'mesh'` always (the editor already does this with `cpuMesh`). US-045: not playable anyway, only the reference path. |
| 2 | **Canvas2D present** (`RenderTargetCanvas2D`) | D-005 fallback present | **K** unchanged (present layer, not geometry). |
| 3 | **Sky** `fillSky` (+ `primeAmbientLight`, `ambientL`, `primeFastShadeFrame`) in `sectorCaster.js` | compositor on both renderers; `ambientL` exported from `engine/index.js` (main.js, gpucompare, flicker, editor) | **K**: move `fillSky` (pitched branch only) + `ambientL/primeAmbientLight` to new `engine/render/sky.js`; `fastShade.js` stays. Drop the shear branch and the `spans` loop (every cell with `depth === Infinity` is sky). |
| 4 | `beginFrame(fb)` | compositor, tests | **K**: move into `compositor.js` (depth clear + `gbuf.beginFrame()`; no spans). |
| 5 | **`DepthBuffer`** (`fb.depth`, 27 lines) | rasterJS `copyToGBuffer`, sprites, every pass | **K** unchanged. |
| 6 | **`OpenSpans`** (`fb.spans`, `engine.openSpans`) | sectorCaster, fillSky, engine.js, main.js/editor fb literals, tests | **D** (19b): on mesh every column is "open" -> degenerate. |
| 7 | **Terrain shading** `shadeTerrainCells` + `forestFaceMode` (terrainCaster.js 405-509) | compositor (both renderers) | **K**: move to `terrainShade.js` (already holds `shadeTerrain`). |
| 8 | `sunFromWorld`, `terrainHBounds`, `activeNearLOD` (terrainCaster.js) | GpuCellPipeline shade/water uniforms, lighting.test, waterComposite.test, `engine/index.js` export | **K**: `sunFromWorld` -> `lighting.js` (next to `setWorldSun`); `terrainHBounds/activeNearLOD` -> `engine/world/Terrain.js` (terrain data only). Public export path unchanged. |
| 9 | **Sun shadow via DDA** (`light.frag` `uSunMode 1` + `sunVisible` + `uWorldGeom/uWorldFlags/uStructA/B/uWorldMaxH`; JS `lighting.js sunVisible/sunCellBlocked`; `WorldTextures.js` atlas + `planFrameUpdate`; `shadows.sun:'dda'`) | **main.js default today** (`sun:'dda'` unless `?renderer=mesh&shadows=map`), `rtsMain.js:57` pin, gpucompare `pipelineMesh` pin | **D**, but only after **ME-15e** flips the default to `'map'` (prerequisite, 37.13.3). `sun:false` stays as the "no sun shadow" option. |
| 10 | **LVIS point-light occlusion** (`lighting.js computeVisGrid/sampleVis/segmentBlocked`, `LightSet.vis/visVersion/visBox`, `texLVis`, `light.frag sampleVis`) | both renderers, every lamp/burner; US-038c `lighting:'classic'` | **K until ME-16** (cube shadow maps). Deleting it before ME-16 = lamps shine through walls (owner-visible regression). Not a blocker for 19a-19d. |
| 11 | **Shear camera** (`projTerms` shear fields, `shearProjection`, `unprojectCell`, GLSL `cellRayP`, `uProjMode/uHorizonRow/uPlaneDistY` in light/shade/edge/waterComposite/common, the 35-deg clamp, `resolveProjection` fallback, shear branches in `sprites.js`, `instanceRect.js`/`VoxelPool`, `compositor.js`, `lighting.js` sky rows, `viewModel._eyeMap`, `waterComposite.js`, `particleLayer.js`, editor `ray.js`/`select.js`/`pick.js` `renderer` param) | dda renderer; gpucompare parity poses (auto `projection:'shear'`, gpucompare.js:520); `anchorShear` pose | **D** (19d) per 28.1 A2 item 9. **Exception (K, rename):** `deriv.frag`'s `uPlaneDistY` and `gbuf.cam.planeDistY/tanHalfHFov` are the *derivative scale constants* used for every camera (28.1 A2 "deriv unchanged") -> rename `uDerivScale`/`gbuf.cam.derivScale`, computed in `projection.js` from the grid. |
| 12 | **`stable.js`** (US-073 temporal, shear-only, throws on pitched, not wired to any GPU pass) | `pitched.pipeline.test.js` throw-test only | **D** whole module + `stable.test.js`; US-073 re-does it on pitched. |
| 13 | **GPU dda passes**: `_passCast/_passTerrain/_passVoxel`, `progCast/progTerrain/progVoxel`, `dda.frag/terrain.frag/voxel.frag`, `_ensureVoxelAtlas/_uploadVoxelInstances`, `texVOX/texVOXINST/texNearH/texFarH`, `_terrainTs*/_voxelTs*`, `_source 'dda'` naming, `fb.gpuDda` | dda renderer, `?gpucompare=mesh` | **D** (19c). `texFarType/texNearType/texTlook` + `packTerrainTextures/packNearTextures` stay (mesh terrain program + shade.frag read them) - trim `NEARH/FARH` from `TerrainTextures.js`. `terrain.vert.js` stays (it is the mesh terrain raster program). `gridTargets.js` fboCastSub stays (raster reuses it; rename optional). |
| 14 | **CPU dda casters**: `sectorCaster.js` (minus item 3), `terrainCaster.js` (minus 7/8), `voxelMarch.js` (`marchVoxelRay/castModels`), `OpenSpans.js`, `VoxelTextures.js`, `WorldTextures.js`, `voxelPool.js` atlas fields | compositor dda branch, `engine/index.js` exports (`castTerrain, marchTerrainRay, FOG_FULL, T_START, MAX_TERRAIN_STEPS, STEP_MIN, STEP_K, castModels`), `engine/dev.js` (`beginFrame/castSectors/fillSky`), bench-cast/bench-voxel | **D** (19b). `FOG_FULL` (1500) moves to `projection.js` if anything still reads it (grep first). `HFOV_DEG` -> one constant `PROJ_HFOV_DEG` in projection.js; re-exported under the old name from `engine/index.js` (editor, targeting.js, sprites). |
| 15 | **`?renderer=` switch**, `DEFAULT_RENDERER`, `effRenderer`, `GpuCellPipeline opts.renderer`, `.renderer` fields on SpritePool/VoxelPool/overlay/particleLayer/frame.js, `assertProjectionRenderer` | main.js, editor `frame.js`, rtsMain, gpucompare, sidebyside.html, capture-browser variants, route-walk-browser `--renderer`, voxel_beast.js/VoxelModel comments | **D** (19a): one renderer; `resolveProjection(cam)` loses its `renderer` arg (always pitched; the `'shear'` value throws from 19d on). |
| 16 | **gpucompare JS twin independence**: `?gpucompare=1&renderer=mesh` compares GPU mesh vs `renderWorld(fb.renderer='mesh')` = rasterJS + JS shade/light twins | - | **Independent of caster code** except items 3/4/7 (moved, not rewritten -> rows stay bit-identical). `?gpucompare=mesh` (GPU dda vs GPU mesh) and `?gpucompare=1` on dda: **D**. Rows that auto-fill `projection:'shear'` are **re-baselined once** in 19d (they become pitched); `pitchedDefault` rows must stay identical. |
| 17 | **Editor viewport** (`tools/editor/frame.js` `renderer`/`cpuMesh`, `ray.js` shear maths, `pick.js` reads `fb.gbuf`/`readbackGeometry` - renderer-neutral) | ED-MESH-1 done on mesh | **D** the shear maths + `renderer` plumbing (19d-ed, PC-B); picking is G-buffer based and unaffected. `decodePlaneId` on structure hits must keep working from the mesh `planeId` (levelMesh writes the same `packPlaneId` - keep that proof as a golden fixture, item 20). |
| 18 | **RTS view** (`rts-test.html`, `rtsMain.js`) | mesh + `sun:'dda'` pin | **K**; the pin goes in ME-15e. |
| 19 | **Sprites/billboards** (`sprites.js`, `spritesPass.js`, `particleLayer.js`), **minimap**, **pick.js**, **overlay** | pitched branches exist (RE-02a/b) | **K**; delete their shear branches (19d). `minimap.js`/`pick.js` are pitched-only already. |
| 20 | **Tests importing dda modules** (27 files; probe list: levelMesh, rasterJS, voxelMesh, voxelRaster, compositor, glsl, sprites, TerrainTextures x2, VoxelTextures, WorldTextures, lighting, meshKind9.render, meshStructures.render, projection, sectorCaster x5, spriteNear, terrainCaster, voxelPool, waterComposite, waterFlow, voxel, sectorAnim) | run-tests | **D** the dda-only suites; **P** the oracle uses (levelMesh/rasterJS/voxelMesh/voxelRaster/compositor/voxel tests compare against `castSectors`/`marchVoxelRay`) to **golden fixtures** captured once from the dda oracle (small `*.golden.json` under `engine/mesh/fixtures/`), so the mesh twin keeps a regression oracle after the casters are gone. Tests that only import `DepthBuffer`/`OpenSpans` for an fb literal: drop `spans`. |
| 21 | **Bench tools** `tools/bench-cast.mjs` (castScene bench, 39 stale FAIL rows), `tools/bench-voxel.mjs` (castModels) | README | **D** both; the sun-shadow bench half of bench-cast moves to `tools/bench-shadow.mjs` (keeps the ME-15d numbers reproducible). README line updated. |
| 22 | **`engine/world/packed.js`** (7.2 packed layout, `_relief028` bit masks for the CPU caster; `World.js` imports `packLevel/updateAnimatedSector`; `repackMaterials` used by gpucompare/flicker) | World, index.js | **K for now** (World uses it as content data; `WorldTextures` was its only GPU consumer). Not an ME-19 item; US-049-style dead-field trim later. |
| 23 | **VoxelModel limits** (32/axis, 4096 cells, axis-sum 48, `meshOnly` flag) | voxel.frag/VoxelTextures only (28.12) | **P** (19b): `MESH_ONLY_*` become the only limits; `meshOnly` stays accepted and ignored (content compat); `MAX_VOX_INSTANCES` stays as the pool cap. |
| 24 | `check-deps` rule 9 (`gl.*` outside `device/*` = WARN) | 1279 warnings | **P** (19f): FAIL-on-increase against a recorded baseline count, not a flat FAIL - moving ~1300 `gl.*` calls behind `GpuDevice` is its own epic (ME-04 follow-up), not ME-19. |
| 25 | **Docs/branch**: 14.2/14.4/15.2/23.4/25.1-25.3/27.5 historical; `wip/bug-own-008-part3` (still on origin); AGENTS.md D-037 line; README `?force2d`/bench lines; CLAUDE.md test list | - | **D**/update (19f). |

Counts: **keep 9** (2,3,4,5,7,8,18,19,22 - moved, not rewritten), **port 6** (1, 11-deriv, 16, 20, 23, 24), **delete 12** (6, 9, 10 after ME-16, 12, 13, 14, 15, 17, 21, 25 + the shear items of 11). Three riskiest: **(a)** item 9 - deleting the world atlas before ME-15e silently removes *all* sun shadows on the default URL (and `rtsMain`'s `'dda'` pin throws); **(b)** item 11 - `deriv.frag`/`computeDerivatives` use the shear `planeDistY` as a scale for every camera: deleting it with the shear code flips the detail-glyph derivatives on walls (invisible in Node, obvious on screen); **(c)** items 1/15 - the CPU reference path (`?gpu=0`, `capture-browser`'s software-renderer guard, editor `cpuMesh`) must become `fb.renderer='mesh'` *before* the casters go, or `?gpucompare=1` and the editor without WebGL2 render nothing.

#### 37.13.2 Step plan (each <= ~1 programmer-day; game boots after each; all suites + check-deps green; engine steps end in `arch-review`)

| Step | Scope (files) | Tests | Done when | Track |
|---|---|---|---|---|
| **ME-19a** `?renderer` switch out | `game/js/main.js` (`renderer`/`effRenderer`/`pitchClampDeg`/`isMeshMigrationCompare`; `fb.gpuDda` -> `fb.gpu`), `engine/index.js` (`DEFAULT_RENDERER` removed), `GpuCellPipeline` ctor (`opts.renderer` ignored -> mesh; `_source 'dda'` -> `'scene'`), `.renderer` fields default `'mesh'` (SpritePool, VoxelPool, overlay, particleLayer, editor `frame.js`), `gpucompare.js` (`runGpuCompareMeshMode` + `pipelineDda` deleted; `?gpucompare=1` = mesh twin), `game/sidebyside.html` deleted, `tools/capture-browser.mjs` (variant `dda` -> `mesh` naming, `--variant mesh` removed), `tools/route-walk-browser.mjs` (`--renderer` dropped), `rtsMain.js` (no `renderer:`), docs URL lists | `frame.test.mjs`, `capture-browser.test.mjs`, `modes.test.js` updated; new case: `?renderer=dda` is ignored (boot = mesh) | boot `game/index.html` and `?renderer=dda` identical (both mesh); route-walk mesh unchanged; `?gpucompare=1` mesh rows unchanged (same count/verdicts as the last baseline); `?gpu=0` renders via rasterJS (`fb.renderer 'mesh'`) | PC-A, or **PC-B cross-track** (mostly game/tools files) |
| **ME-19b** CPU casters + atlases out | move items 3/4/7/8 first (`sky.js`, `terrainShade.js`, `lighting.js`, `Terrain.js`); then delete `sectorCaster.js`, `terrainCaster.js`, `voxelMarch.js`, `OpenSpans.js` (+ `engine.openSpans`, `spans:` in main.js/editor fb literals), `VoxelTextures.js`, `voxelPool.js` atlas code, `compositor.js` dda branch + `castModels` block, `engine/dev.js`/`index.js` exports, VoxelModel limits (item 23), `tools/bench-cast.mjs`/`bench-voxel.mjs` (item 21), the 27 test files (delete `sectorCaster.*.test`, `terrainCaster.test`, `VoxelTextures.test`; **golden fixtures** for levelMesh/rasterJS/voxelMesh/voxelRaster/compositor/voxel tests captured from the oracle *in the same commit, before deletion*). `WorldTextures.js` stays until 19c (light-pass sun DDA) | all suites; new `sky.test.js` (pitched sky az/el per cell == the GLSL `pitchedCellDir` formula) | boot + route-walk mesh unchanged; `?gpucompare=1` rows bit-identical to 19a (moves only); `node tools/run-tests.mjs` green; `engine/index.js` exports no caster symbol | PC-A engine |
| **ME-19c** GPU dda passes out | `GpuCellPipeline.js` (`_passCast/_passTerrain/_passVoxel`, `progCast/progTerrain/progVoxel`, voxel atlas textures, `texNearH/texFarH`, `_terrainTs*/_voxelTs*`, PASS_TERRAIN/PASS_VOXEL timer slots -> `PASS_NAMES` shrinks, F3 labels), `glsl/dda.frag.js`, `terrain.frag.js`, `voxel.frag.js`, `TerrainTextures.js` (NEARH/FARH), `glsl.test.js`, `TerrainTextures*.test.js`; **plus, only if ME-15e is done:** item 9 (`uSunMode 1`, `sunVisible`, `uWorldGeom/Flags/uStructA/B`, `_ensureWorldTextures/_uploadUStruct`, `WorldTextures.js` + test, `sectorAnim.test` planFrameUpdate cases, `shadows.sun` values -> `'map'|false`) | `glsl.test.js` (program list), `shadowSun.test.js` (`'dda'` rejected), gpucompare `&shadows=map` rows | boot; GPU p95 on the route walk <= before (atlas upload gone - record the delta); `?gpucompare=1` mesh rows unchanged; `dispose()` lists no `texVOX*/texWorld*` | PC-A engine |
| **ME-19d** shear camera out | `projection.js` (`projTerms` -> only `derivScale`; delete `shearProjection/unprojectCell`; `resolveProjection(cam)` returns `'pitched'` or throws on `'shear'`; one clamp constant), `glsl/common.js` (`cellRayP`, `uProjMode` -> pitched code unconditional), `light/shade/edge/waterComposite.frag`, `deriv.frag` (`uPlaneDistY` -> `uDerivScale`), `GpuCellPipeline` (`_computeCamBasis` shear fields, `_uploadPitchUniforms` always), `compositor.js`, `sprites.js`, `instanceRect.js`/`voxelPool.js`, `lighting.js` (`lightSurfaces` shear rows), `viewModel.js` (`pitched` arg dropped), `waterComposite.js`, `particleLayer.js`, `stable.js` + test deleted, `playerLook`/`Camera` clamp default 70, gpucompare poses (`projection:'shear'` auto-fill and the `anchorShear` pose removed). **19d-ed** (PC-B): editor `ray.js`/`select.js`/`pick.js`/`main.js` `renderer` arg + shear maths | `projection.test.js` (shear cases out, deriv-scale case in), `projection.pitched.test.js`, `pitched.pipeline.test.js`, `ray.test.mjs`, `sprites.test.js`, `voxelPool.test.js`, `viewModel.test.js`, `lighting.test.js`, `waterComposite.test.js` | boot; **re-baseline** the former shear gpucompare rows once (old/new counts recorded in the row); `pitchedDefault` rows bit-identical; owner one-look: wall detail glyphs unchanged at pitch 0 (risk b) | PC-A engine; 19d-ed **PC-B cross-track** |
| **ME-19e** LVIS out | `lighting.js` (`computeVisGrid/sampleVis/segmentBlocked/cellBlocks`, `LightSet.vis*`, `MAX_VIS_*`; `clampLightToFree` stays - placement rule), `light.frag` (`uLVis/uVisBox/sampleVis`), `GpuCellPipeline` (`texLVis`, `_lvisUploaded`, `_visBoxF`), `lighting.test.js` LVIS cases | lighting suite; gpucompare light rows | **blocked on ME-16** (cube maps replace it). Recommendation: do ME-16 (2 d) first; do not ship unshadowed lamps | PC-A engine |
| **ME-19f** rules + docs + branch | `tools/check-deps.mjs` rule 9 -> FAIL-on-increase with the recorded baseline (item 24) + fixture test; `docs/architecture.md` 14.2/14.4/15.2/23.4/25.1-25.3/27.5 marked historical, 7-8 pass chain = `shadow -> raster -> resolve -> deriv -> water -> light -> shade -> wcomp -> edge -> sprites`; AGENTS.md D-037 line -> "deleted (ME-19)"; README/CLAUDE.md URLs + test list; delete `origin/wip/bug-own-008-part3` (main session, after the owner's OK); "literal twin of castColumn/voxelMarch" comments in `mesh.frag/light.frag/rasterJS` re-pointed at the golden fixtures | `check-deps.test.mjs` | check-deps OK with the new rule; no `wip/bug-own-008-part3` on origin | **PC-B** (docs/tools) + main session (branch) |

Order: **19a -> 19b -> 19c -> 19d** (strict: 19b needs 19a's `fb.renderer='mesh'` everywhere; 19c deletes GPU programs whose JS twins went in 19b; 19d last because until then the shear parity rows stay as a regression net). **19e** whenever ME-16 lands (independent of 19d). **19f** after 19d. 19a and 19d-ed may go to PC-B cross-track; 19b/19c/19d are PC-A (GPU verification on the owner iGPU). One step id per commit.

#### 37.13.3 Prerequisites - are ME-15/ME-16 still blockers?

- **ME-15a-d done; ME-15e** (map default, drop the two `sun:'dda'` pins; gated on the 4 `&shadows=map` FAIL rows + one iGPU bench) is the **only hard prerequisite, and only for 19c's item 9** (world atlas + sun DDA). 19a, 19b, 19d do not need it. Recommendation: **19a and 19b now**, **ME-15e** next (~0.3 d once the 4 rows are fixed), then 19c.
- **ME-16** is a prerequisite **only for 19e** (LVIS). It is not a prerequisite for deleting the casters: LVIS reads `world.sectorAt` content data and the `LightSet`, never render buffers. D-029's "ME-19 after ME-16" relaxes to "19e after ME-16"; everything else may go first. ESCALATE TO MANAGER only if the owner wants LVIS gone before ME-16 (architect: no).
- **ME-12b** is effectively done (mesh default since 2026-10-03, D-037); the PO should close its row or fold it into 19a (its AC 2 "`?renderer=dda` gives today's behaviour" becomes moot).

#### 37.13.4 Estimate and risks

Lines deleted (from `wc -l`, approx.): sectorCaster 1188 - ~120 kept = ~1070; terrainCaster 509 - ~150 kept = ~360; voxelMarch 366; OpenSpans 61; WorldTextures 167; VoxelTextures ~120; TerrainTextures ~60; dda.frag 380 + terrain.frag 506 + voxel.frag 260 = 1146; GpuCellPipeline ~700 of 2831; light.frag sun DDA + LVIS ~150; lighting.js LVIS + sunVisible ~250; projection.js shear ~200; common.js ~60; stable.js 249; shear branches (sprites/instanceRect/voxelPool/viewModel/compositor/waterComposite/editor ray+select) ~400; gpucompare mesh mode + shear poses ~200; sidebyside 56; bench-cast 800 + bench-voxel 130 (~200 of it moved to bench-shadow); main.js/frame.js/rtsMain ~100; tests: sectorCaster.* 827, terrainCaster.test 342, WorldTextures.test 158, VoxelTextures.test 232, TerrainTextures.features.test 76, stable.test 334, sectorAnim.test ~120, glsl.test ~100, voxel.test ~300 (march cases), projection.test ~80, oracle blocks in compositor/rasterJS/levelMesh/voxelRaster tests ~300 = ~3200. **Total ~10-11k lines deleted, ~600 added** (moves, golden fixtures, bench-shadow). ~9 test files gone; run-tests from 224 to ~215 suites.

Risks (what could silently break):
1. **Sun shadows vanish** if 19c runs before ME-15e (item 9). Gate: `shadowSun.test` asserts `'dda'` is rejected *and* 19c's AC greps main.js/rtsMain.js/gpucompare.js for the `'dda'` literal.
2. **Detail derivatives on walls** (item 11: `deriv.frag uPlaneDistY`, `gbuf.cam.planeDistY/tanHalfHFov`) - keep the value, rename it. AC: `pitchedDefault` gpucompare rows bit-identical after 19d.
3. **CPU reference path goes dark** (`?gpu=0`, software-renderer machines, editor without WebGL2, `capture-browser`'s SwiftShader guard) if `fb.renderer` is not `'mesh'` everywhere before 19b - 19a's AC covers it.
4. **Editor picking** (`pick.js decodePlaneId` on structure hits) relies on the mesh `planeId` encoding equalling the caster's `packPlaneId`; the test proving it uses `castSectors` as oracle -> golden fixture (item 20).
5. **Sector animation -> GPU**: `sectorAnim.test` covers `planFrameUpdate` atlas dirty ranges. On mesh the grate/lever rebuild goes through `LevelMeshCache` on `structVersion`; a test must assert "animated sector step bumps structVersion / rebuilds the level mesh" before the planFrameUpdate cases go.
6. **`HFOV_DEG` import sites** (editor camera/iconRender/ray, `game/js/quest/targeting.js`, sprites) - re-export from `engine/index.js` as an alias of `PROJ_HFOV_DEG`.
7. **F3 / bench pass indices** shift when PASS_TERRAIN/PASS_VOXEL go; `route-walk-browser.mjs`, `rts-test ?bench=1`, `perfBench.js` must read passes by name, not index (BUG-RTS-002 flagged this already).
8. **Golden fixtures drift**: without the dda oracle, a mesh-twin bug and a fixture regeneration look alike. Rule: fixtures are regenerated only with an `ARCH OK` naming the reason in the commit.
9. **gpucompare re-baseline in 19d** can hide a regression: re-baseline only the rows whose camera changed (former auto-shear rows), never `pitchedDefault` rows; record old/new counts in the step row.

Do not: delete across step boundaries (one step id per commit, each leaving boot + suites green); keep `?renderer=dda` "booting" after 19a (D-037's fallback promise ends with 19a - the flag is ignored, not an error); touch `engine/physics/**` (`?physics=grid` is physics, not render - separate story if ever); start the `GpuDevice` migration of the 1279 `gl.*` calls inside ME-19 (item 24).

#### 37.13.5 Amendment 2026-10-05: the 19b/19c boundary (answer to docs/test-reports/ME-19b-dependency-blocker.md)

**Decision: retain the frozen GPU-side pieces until 19c. Do not pull the GPU deletion into 19b.** Reason: 19b is already a full day (moves + deletes + golden fixtures), and 19c deletes the GPU programs as one unit. Splitting that unit would leave half-dead pipeline state for no gain.
1. **Shader constants -> new frozen module `engine/render/gpu/glsl/ddaConstants.js`.** It holds `MAX_RAY_STEPS`, `MAX_DIST` (from sectorCaster.js) and `MAX_TERRAIN_STEPS, STEP_MIN, STEP_K, T_START, FOG_FULL, DITHER_SEED` (from terrainCaster.js). Copy the values verbatim (same literals, same number formatting, so the GLSL source strings stay byte-identical). Header comment: "frozen dda constants, deleted in ME-19c". `dda.frag.js` and `terrain.frag.js` import from it. Nothing else may import it: no `engine/index.js` export, and it is not a destination for live code. `FOG_FULL` has no live consumer (grep 2026-10-05), so it does not move to projection.js (item 14 note is moot).
2. **`VoxelTextures.js` + `VoxelTextures.test.js` + the `voxelPool.js` atlas fields (`atlas`, `_modelIndexByKey`, atlas packing in `bind`) stay until 19c.** They move from 19b's delete list to 19c's, together with `_ensureVoxelAtlas/_uploadVoxelInstances`, `voxel.frag.js` and `texVOX/texVOXINST`. VoxelModel item 23 is split the same way: in 19b the `MESH_ONLY_*` limits become the only *validation* limits, while `MAX_VOX_STEPS` (and `MAX_VOX_INSTANCES` as the DDA upload guard) stay exported until 19c.
3. **`WorldTextures.js` (`MAX_STRUCTS`, atlas) stays** as already planned: until 19c for the cast/terrain programs, and until ME-15e for the sun DDA.
4. **19b test:** add a `glsl.test.js` case that the `dda/terrain/voxel` program sources are byte-identical to 19a (hash them once in 19a's tree, assert the hash). This proves the constant move changed nothing.
5. **Sky (blocker "additional observation"):** move `fillSky` **as-is, including the shear branch** (drop only the `spans` loop) into `sky.js`. The shear sky branch is deleted in 19d with the other shear code. That keeps 19b a pure move (bit-identical rows, editor shear unchanged) and removes the temporary sky difference. This overrides item 3's "pitched branch only" for 19b. `sky.test.js` covers both branches until 19d.
6. **19c's scope grows by:** `ddaConstants.js`, `VoxelTextures.js` + test, voxelPool atlas fields, `MAX_VOX_STEPS`. It is still <= 1 d because those pieces are deleted together with the passes that read them.

### 37.8a TORCH-01 amendment "hands" (HANDS-01; architect, 2026-10-05; D-040)

**Supersedes in 37.8 / BUG-VM-001:** "the torch is always right, the sword always left" and the `SWORD_CFG.sweepRtoL` flag. TORCH-01a (multi-handle layer: `show/hide(h)/capture(h)/setBob(.., h)`, `VM_MAX_HANDLES 4`, `objectId = VM_OBJECT_ID - h`) stays the base and must be merged first. Three hand items exist (sword, spell hand, torch later) = 3 handles. **One handle per item, not per hand** (one item can never be in both hands), and the hand is a per-handle runtime flag.

**Mirror (engine, `engine/render/viewModel.js`).**
- Each def has an **authored hand**: `def.hand: 'left'|'right'`. If it is missing: `rest.pos[0] < 0 ? 'left' : 'right'`. So the BUG-VM-001 left-hand sword data needs no edit, and the designer's `spellHand` is authored left.
- **Erratum (architect, 2026-10-05, BUG-VM-001 publish review + D-042 item 1):** the authored hand must be the hand the **model geometry** was built for, not the hand of the pose. The published `ASSETS.swordForHand(hand)` mirrors only pos/rot (pose), and `swordHeld` geometry is right-hand. HANDS-01a therefore loads `swordForHand('right')` (`hand:'right'`, identity pose) **once** and calls `vm.setHand(h, SWORD_CFG.hand)`; it removes main.js's `swordForHand(SWORD_CFG.hand)` binding. Never feed a pose-mirrored def into the engine mirror (that mirrors twice). `swordForHand` may stay as a preview/data helper. The sim side (`sword.setHand`, hand latched at swing entry, `ARC_BOUNDS_L/R`) already matches the `itemSim` contract above and stays.
- `setHand(h, hand)` sets `mirror[h] = hand !== authored[h] ? 1 : 0`. `handOf(h)` returns the hand. Default = the authored hand. It is a flag write with no allocation. The view calls it when it binds the hand (on change; calling it every frame is harmless).
- **All per-handle state stays in authored space** (`_last`, `_cap`, blend, bob). The mirror is one final step, S = diag(-1,1,1) on the whole eye-space object:
  - `buildList`: after the per-part `E`, `e` (pose + bob already applied), if `mirror[h]`: `E[0] = -E[0]; E[1] = -E[1]; E[2] = -E[2]; e[0] = -e[0]`. Then do the Aw/world composition as today. Set `item.mirror = 1`.
  - `mountEye(h, ...)`: if `mirror[h]`, then `out3[0] = -out3[0]`. The trail and the spell origin check follow automatically.
  - This gives exact mirroring of the pose, swing arc, bob roll and the asymmetric geometry (hand, thumb). The BUG-VM-001 design helper `mx()` stays as authored data. Do not mirror twice.
- **Winding:** mirrored part matrices have det < 0, so the front faces turn CW on screen (28.10 item 4 predicted this). `DrawList` `resetDrawItem` gets `item.mirror = 0`. Both twins:
  - GPU: in the view-model voxel loop, call `gl.frontFace(item.mirror ? gl.CW : gl.CCW)` per item, and restore `gl.CCW` after the loop.
  - JS (`rasterJS.js` l.332): `if (info.cullBack && (info.mirror ? A2 > 0 : A2 < 0)) return;`, with `_info.mirror = item.mirror` set where `cullBack` is set.
  - Nothing else in the mesh path depends on the winding sign. Normals are `mat3(uModel) * n`, and a reflection keeps them outward. `flipN` is cloth-only.
  - The view model is not in the shadow pass. If it is ever added there, the flip goes there too.
- **Typedef additions** (`ViewModelLayer`): `@property {(h:number, hand:'left'|'right')=>void} setHand`, `@property {(h:number)=>('left'|'right')} handOf`, and the `DrawItem.mirror` (0|1) doc line.

**Input (engine, `engine/core/input.js`).**
- `mousedown`/`mouseup`: button 0 = `'Mouse0'` (unchanged), button 2 = `'Mouse2'`. Ignore the other buttons. Same consumed/blur rules.
- New `blockContextMenu(el) -> off()`: a `contextmenu` listener on `el` (the game canvas, never `window`) that calls `preventDefault()`. main.js calls it once with the canvas. Under pointer lock the canvas is the event target.
- No new `GAME_KEYS` entries are needed (`KeyH`/`KeyI` have no browser default).

**Hands (game, new `game/js/quest/sim/hands.js`; rule 15 scope, so it lives under `sim/` instead of the row's `quest/hands.js`).**
- Source of truth: `player.components.inventory.left/right` (item id or null, serialized; shape in 37.16.4). HANDS-01 creates `sim/inventory.js` with `ensureInventory`, `assignHand`, `swapHands` and the full data shape. US-091a1 adds the pack functions to that file later; the two must be sequential, not parallel.
- `createHands(events)` returns:
  - `register(itemId, itemSim)`. `itemSim` needs `cancel()` and `setHand(hand)`.
  - `step(player, rawL, rawR, gateOpen)`. `rawX` = `input.isDown(btn) || input.pressed(btn)` for 'Mouse0' / 'Mouse2'.
  - `downOf(itemId) -> boolean`.
  - `handOf(itemId) -> 'left'|'right'|null`.
  - `disarm()`, `swap()` (dev), `hashInto(h)`.
- `step` order:
  1. Read left/right and compare them with the cached ids (string `===`, no allocation). On a change: `cancel()` the items involved, `setHand()` on the moved items, emit one preallocated `hands:changed {left, right}`.
  2. Gate. If `!gateOpen`: `disarm()`.
  3. Per hand, `down = gateOpen && armed && raw`. `armed` comes back only when the physical button has been seen up while the gate is open.
- `disarm()` = `cancel()` on both items, then `armed = false` for both. **Cancel comes first:** an item sim then sees a release edge while idle, which does nothing. Without the cancel, a held charge would fire on the release.
- Callers of `disarm()`: `hands.step` whenever the gate is closed, and every opener of a pause/inventory/map/settings screen (the sim does not step while paused, so the opener must disarm at once).
- Gate (main.js): `look.locked && !uiLocked && !ending && !paused && !inventoryOpen && !cinematic && !(vitals && vitals.inputLocked)`.
- **Tap/hold belongs to the item, not the router.** `hands` passes the raw `down` per step, and each item sim derives its own edges, as `sword.js` already does with `prevDown/holdSteps`. Sword threshold 24 steps (D-034); fireball 36 (SPELL-01a). Every item sim is stepped **every** step (`down = false` when it is in no hand), so ring ages and timers keep running.
- Both hands may act at once (independent sims). Their `speedScale` factors multiply.

**Sword (`swordConfig.js` + `sim/sword.js`).**
- `swordConfig.js` exports `ARC_BOUNDS_R` = today's `ARC_BOUNDS` (left -> right) and `ARC_BOUNDS_L`. `ARC_BOUNDS_L` keeps the same index order with every `lx` negated (an exact mirror; `arcHits` does not depend on orientation). Keep `ARC_BOUNDS` as an alias of `_R` for old imports.
- `sword.setHand(hand)`. `enterLight`/`enterHard` latch `swingHand`, and `doHitCheck` reads the latched table. A hand swap mid-swing therefore only affects the next swing.
- Remove `sweepRtoL` and the `hitEnd - stateStep` index. The left hand then sweeps right -> left through the mirrored table, which is the same thing BUG-VM-001 does.
- `swordView.js`: `vm.setHand(swordH, hands.handOf('sword'))`, and `vm.hide(swordH)` when the hand is null.

**Demo start state:** `game/js/quest/startConfig.js` `START_DEMO = {pack: [{id: 'spell.fireball', n: 1}], left: null, right: 'spell.fireball'}` and `START_FULL = {pack: [], left: null, right: null}`.
- main.js picks `params.get('demo') === '0' ? START_FULL : START_DEMO`. Demo is the default this sprint (owner answer 2).
- `ensureInventory(player, start)` runs in the `world:loaded` handler **before** `initialState = serialize(...)`, so `R` restarts keep the start pack. It only creates the component when it is missing.
- Migration: if `world.state['tower.sword.taken']` is set and the pack has no sword, add it and set `left = 'sword'` when left is empty.

**Dev:** with `?debug=1`, `KeyH` calls `hands.swap()` (= `swapHands(inv)`). List it in the F3 help.

**Spell hand (HANDS-01 shows idle only):** `presentSpellHand(vm, spellH, hand, simTime, moving)` shows `idle` (loop) with its own `setBob(.., spellH)`. The cast/charge clips come with SPELL-01b. Load it with `vm.load('spellHand', ASSETS.viewModels.spellHand, gameVoxelPool)` next to the sword.

**gpucompare pose `handsSwapped`:** tower interior, mesh pitched, yaw 35 / pitch 0 (the BUG-VM-001 pose framing; avoids the pitch-20 AO tie). Sword `setHand('right')` (mirrored, det < 0: this tests the front-face flip on both twins) + spellHand `setHand('left')`. `vmAssert`: `stats.items === 2` on both twins. Existing view-model rows must not change (no handle mirrored there). A precision-only fail is a D-039 known-FAIL baseline.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **HANDS-01a** view-model mirror + winding flip | PC-B cross-track -> arch-review (first review, core render) | ~0.5 d | `engine/render/viewModel.js`, `engine/mesh/DrawList.js` (`mirror` reset), `engine/mesh/rasterJS.js` (cull sign), `engine/render/gpu/GpuCellPipeline.js` (frontFace in the vm loop), `viewModel.test.js` | Authored hand from `def.hand` and from the rest sign. `setHand` toggles `mirror`. Mirrored list: det < 0 for every part; the mirrored point = S * the unmirrored point within 1e-12 at 3 clip times incl. bob. `mountEye` x negated. Mirror twice = identity. JS twin: a mirrored sword with cull on is bit-identical to cull off (closed model, no back face wins) and > 0 cells. Two handles, one mirrored: 2 items, distinct objectIds. 0 alloc over 1000 frames. Existing view-model tests unchanged. | Full runner + check-deps green |
| **HANDS-01b** input + hands router + sword hand + start state | PC-B cross-track -> arch-review (opus; `input.js` is engine) | ~0.75 d | `engine/core/input.js` (+ new `input.test.js` with a fake EventTarget), `game/js/quest/sim/hands.js` (+test), `sim/inventory.js` (shape + hand rules), `startConfig.js`, `swordConfig.js`, `sim/sword.js` (+test), `swordView.js`, main.js (PC-B main session) | Mouse2 down/up/pressed; contextmenu prevented only on the given element. Router: L/R mapping, the empty hand does nothing, a gate close cancels a held charge with no cast/swing, re-arm only after button-up, a change cancels + `setHand`, one item never in both hands, swap. Sword: with the right hand, a left-forward target is hit on an earlier step than a right-forward one, and the left hand is the reverse. The mid-swing swap keeps the latched table. 600-step replay hash with L/R input stable twice. 0 alloc over 10k steps. | Suites green; the PC-B main session checks LMB/RMB in a browser |
| **HANDS-01c** spell-hand idle + gpucompare pose | PC-B | ~0.25 d | `game/js/quest/spellHandView.js`, main.js, `game/js/dev/gpucompare.js` (pose) | Node: the spell hand is hidden when not in a hand and shown in the bound hand. | `?gpucompare=1&renderer=mesh`: `handsSwapped` vmOk on both twins (or a D-039 baseline); no old row regresses. Owner walk-test per the row |

**Do not:**
- load a def twice per hand;
- mirror in game code (`show` stays authored);
- negate a determinant by scaling a part;
- add `CULL_FACE` off for the view model (it would hide the bug, and back faces would win);
- put the context-menu block on `window`;
- route input through the item sims' own `input` reads;
- let a gate close produce a release edge on a held item.

### 37.14 Fireball SPELL-01a/b (architect, 2026-10-05; D-040, owner answers 2026-10-05: known at start in the demo, no self-damage)

**Decision: game-side sim** (`game/js/quest/sim/fireball.js`, rule 15). There is one projectile, and its rules are game rules (the 29.1/30.2 precedent). The engine already has every query it needs: `World.raySegment`, `explosionHits`, `applyImpulse`, `LightSet.add/move/setOn/setParams`, `particles.burstAt`, `SpritePool.push`. **No engine change in SPELL-01a/b.** A generic engine projectile module waits for a second projectile kind.

**Numbers (`game/js/quest/spellConfig.js`, outside `sim/`, one frozen `FIREBALL_CFG`, seconds in comments):**
- `holdSteps 36` (0.6 s), `cooldown 30` (0.5 s), `maxRange 24`, `maxAlive 4`, `hitPad 0.2`.
- `tap {mana 5, speed 16, radius 2.0, damage 3, knock 6}`; `charged {mana 10, speed 12, radius 3.0, damage 5, knock 6}`.
- `self {knockH 6, knockV 3}` (owner tunes).
- `castOffset {right 0.25, fwd 0.45, down 0.30}` in metres, eye frame. A data test checks that it matches the designer's `spellHand` `ember` mount at rest within 0.05 m (mirrored x for the other hand).

**Shared targetables:** extract `game/js/quest/sim/targetables.js` `createTargetables(world, events)`:
- returns SoA `{count, x, y, z, r, h, ent[]}` plus `refresh()` (positions, called once per step by the user) and `dispose()`;
- rebuilt on load and on `entity:added/removed`, the 30.1 convention;
- **alive filter in `refresh`:** an entity with `components.health.hp <= 0` gets `r = -1` and every query skips `r < 0`.

The fireball uses it. Migrating the sword/targeting lists onto it is optional (not in this sprint).

**Sim API:** `createFireballSim(world, events, cfg, targetables, hooks {spendMana})` returns:
- `setHand(hand)`, `cancel()`;
- `step(player, down, fx, fy, ax, ay, az)`. `(fx, fy)` = the horizontal unit forward (main.js `swordFwd`), and `(ax, ay, az)` = the unit 3D aim from `look` yaw/pitch, computed in main.js (trig outside `sim/`);
- read-outs for the view `state` (idle/hold/charge), `holdSteps`, `castTick`, `charged`, and the slot SoA;
- `hashInto(h)`.

The sim is transient: not saved, a reload has no fireballs in flight.

**Per-step order (fixed 60 Hz; main.js update order: `beasts.step` -> `hands.step` -> `sword.step` -> `fireball.step` -> `vitals.step` -> `stepPickups`):**
1. **Input edges** from its own `prevDown`, as the sword does:
   - a press while `cooldown > 0` is ignored (it must be pressed again);
   - press -> `hold`, `holdSteps` counts; at 36 -> `charge`;
   - release in `hold` = tap cast; release in `charge` = charged cast;
   - `cancel()` -> idle, no cast, no mana.
2. **Cast:**
   - if `alive == maxAlive`, refuse (no mana, no flash);
   - mana is spent on release, once: charged needs `spendMana(10)`; if that fails, fall back to `spendMana(5)` = a tap (the sword precedent); if that fails, nothing (the 30.2 `manaFlashTick` is the feedback). `cooldown = 30`;
   - **origin** = `eye + right*(+-castOffset.right) + aimH*castOffset.fwd - z*castOffset.down`, with `right = (-fy, fx)` and the sign from the hand (left = negative);
   - **aim point:** `world.raySegment(eye, eye + aim*maxRange)` gives `P` (the hit, or the end). Then `dir = unit(P - origin)` (fallback `aim` if `|P - origin| < 0.5`), so the ball lands under the crosshair despite the hand offset;
   - **point-blank sweep** from `eye` to `origin` (world + targets, as in step 3): on a hit, burst there at once. This stops a cast from spawning through a wall or inside a boar;
   - emit `fireball:cast {hand, charged, x, y, z}`.
3. **Flight**, per alive slot in slot order:
   - `next = pos + dir*speed*SIM_STEP`, clamped to the remaining range;
   - world: `world.raySegment(pos -> next)` gives `tw`;
   - targets: `targetables.refresh()` once per step, then a segment vs vertical cylinder per candidate (radius `r + hitPad`, slab `[z - hitPad, z + h + hitPad]`). Take the parameter interval inside the infinite cylinder (2D quadratic; `t = 0` if the start is inside), intersect it with the interval inside the slab and with `[0, 1]`. Non-empty = hit at its start `tt`;
   - nearest of `tw`/`tt` (tie -> target): burst at the target point, or for a world hit at `hit - dir*0.1` (so the blast centre is not inside the wall, which would block LOS at t of about 0). No hit and range used up -> burst in the air;
   - 16 m/s = 0.27 m/step: `raySegment` stays inside its 20-sample/0.1 m march (32.4 / 30.1), so nothing tunnels.
4. **Burst** (one function):
   - candidates = the alive targetables + **the player last** (`r = PHYSICS.radius`, `h = body height`) in a preallocated 17-row SoA;
   - `explosionHits(world, c, radius, cand, outIdx, outF, outDir, ray)`;
   - per hit: if it is a target, `damage = round(cfg.damage * f)`, with a floor of 1 for the directly hit index. Skip it if 0. Emit one preallocated `combat:hit {source: 'player', target: id, damage, heavy: 1, cause: 'fire', knock: cfg.knock * f, dirX, dirY, px, py, pz}`. `dirX`/`dirY` = horizontal unit of `outDir` (fallback `dir`). If the target has `components.body` (not a beast): `applyImpulse(body, z, dirX*knock, dirY*knock, 0)`;
   - **the player gets no damage event at all** (owner answer 3), only `applyImpulse(body, pz, hx*self.knockH*f, hy*self.knockH*f, self.knockV*f)`, where `hx`/`hy` = horizontal unit of `outDir` (0 if shorter than 1e-6);
   - emit `fireball:burst {x, y, z, radius, charged}` and free the slot.
   - Beasts react through their own `combat:hit` listener (37.16.2: stagger with `p.knock`, damage cooldown).

**Determinism:** no RNG. Slots are SoA (`alive, x, y, z, dx, dy, dz, speed, radius, damage, knock, travelled, charged, hand`). They are hashed with `state, holdSteps, prevDown, cooldown, castTick`. 600-step replay with tap + hold casts and a kill in it: hash equal twice.

**Budget (Node, warn-only unless `PERF_STRICT=1`):** `step` with 4 in flight and 16 targets <= 0.03 ms. A burst <= 0.35 ms (one-off; the 32.4 number). Zero allocation over 10k steps.

**View (SPELL-01b, `game/js/quest/fireballView.js`, game only).**
- `createFireballView({particles, lightPresets, palette})` resolves particle def ids (`fireTrail`, `fireballBurst`) and light presets (`fireballLight`, `fireballFlash`) once.
- `bindLights(lightSet)` runs on every `world:loaded`, **right after `buildLightSet`**:
  - add 4 flight + 2 flash lights `on: false` at their preset radius;
  - if `MAX_LIGHTS (16) - lightSet.count < 6`, warn once and bind fewer (flash first, then flight; the cap rule below still holds);
  - **never `remove`** (it swaps handles);
  - **never change `radius` per frame** (it invalidates the LVIS box). The flash fades by `setParams({intensity})` only.
- `stepFx(sim, tick)`, **sim side**, called right after `fireball.step` (the particle sim is hashed, so this never runs from the render pose):
  - trail: `burstAt(fireTrail, x, y, z, 1, -dir*1)` every 2nd step per alive ball (30/s);
  - on `fireball:burst` (the listener records it): `burstAt(fireballBurst, ...)` with the designer's numbers (embers ~20, smoke ~8), and a flash in a 2-slot ring (the oldest is overwritten) with its tick.
- `present(sim, lightSet, cam, tick)` per render frame, **before `lightSet.update`**:
  - flight light i = slot i: `setOn(alive)` and `move(x, y, z)`;
  - flash intensity = base * (1 - age/9 steps) (0.15 s), then `setOn(false)`.
  - Light cap = 4 + 2 by construction.
- **Sprites:** `fireballCore` (4 frames, ~12 fps; the charged ball uses the bigger designer variant) pushed through the 37.8 `extra(pool)` callback between `pool.collect` and `pool.project`. If TORCH-01b has not added the callback yet, SPELL-01b adds it (`game/js/dev/spriteDev.js`).
  - A sprite closer than 0.6 m is culled (BUG-FIRE-001). The ball spawns ~0.5 m out, so the first 1-2 frames are covered by the hand glow. Accepted; do not lower the cull.
- **Camera kick:** `fireballKickDeg(view, tick, px, py, pz)` = 1.5 deg decaying over 9 steps when the last burst was <= 6 m from the player. Added at the same call site as `kickDeg` (render eye only, never `look`).
- **Spell-hand clips** (`spellHandView.js`): `idle` loop; `charge` with tMs = `min(holdSteps, 36) * 1000/60` (glow grows; the designer clip/sprite frame); `cast` with tMs = steps since `castTick`, <= 167 ms.

**View budget:**
- JS view <= 0.1 ms/frame;
- `LightSet.update` with 6 idle lights <= +0.05 ms (off lights skip LVIS);
- with 4 moving lights, the LVIS recompute (one per cell crossing) <= 0.2 ms p95, JS bench warn-only. ME-19e will remove LVIS;
- GPU +0.5 ms at 400x150 with 4 in flight (AC).

**gpucompare `fireballInFlight`:** tower interior, mesh pitched, one scripted ball 3 m ahead (fixed slot data, light on) + one flash light at 50 %. Compare the light/sprite rows; a D-039 known-FAIL baseline if precision-only.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **SPELL-01a1** cast + flight + sweep | PC-B | ~0.5 d | `spellConfig.js`, `sim/fireball.js`, `sim/targetables.js`, `sim/fireball.test.js`, main.js (PC-B main session) | Tap/hold edges (35 vs 36 steps). Mana 5/10, charged with 7 MP -> tap, 4 MP -> refused + flash, cooldown 30, cap 4 (5th refused, MP unchanged). Wall fixture at 16 m/s: no tunnelling at 20 seeded angles, burst point in front of the wall. Cylinder hit incl. top/bottom slab edges and the start inside. Dead target ignored. Range 24 -> air burst. Point-blank wall -> immediate burst. Aim point vs hand offset: lands within 0.05 m of the crosshair ray hit at 10 m. Replay hash; 0 alloc. | Suites + check-deps green |
| **SPELL-01a2** burst wiring | PC-B | ~0.25 d | `sim/fireball.js`, `sim/fireball.test.js` | Falloff 3 / round(1.5) / 0 at 0, r/2, r. Direct hit floor 1. LOS-blocked target untouched. Payload `cause 'fire'`, `knock 6f`. Player: no `combat:hit` to `'player'`, HP unchanged, impulse applied (vz > 0). Beast gets stagger + damage via 37.16 (real `beastSim`). Replay with a fire kill. | Suites green; PO (sonnet) |
| **SPELL-01b** view | PC-B | ~0.75 d | `fireballView.js`, `spellHandView.js`, `spriteDev.js` (`extra` if missing), main.js, `game/js/dev/gpucompare.js` | Node fake pool/lightSet: 6 slots bound after `buildLightSet`, never removed, radius constant, the flash fade reaches 0 at 9 steps, the trail cadence is sim-side, sprite pushes land between collect and project, the kick is only within 6 m. | Main session `?gpucompare=1` `fireballInFlight` pass or baseline; bench delta in the row; owner look |

**Do not:**
- put projectile or damage code in `engine/`;
- move the ball in render;
- spawn world entities for balls or lights (entity events rebuild lists);
- `lightSet.remove`;
- emit particles from `present`;
- give the player a `combat:hit` from the own ball;
- use trig or `Math.random` in `sim/`.

### 37.16 Boar death, corpse and looting (US-079b + US-091a; architect, 2026-10-05; owner answers 2026-10-05 items 1 + 3)

#### 37.16.1 Decisions
- **Hide, never remove.** The boar entity, its steer slot, and its place in the sword/targeting/fireball lists stay for the whole world load. Death is sim state plus `components.health.hp <= 0`.
  - Why: the lists are snapshotted at creation and rebuilt only on `entity:added/removed`. `resetAll` must bring the boar back in the same slot. Removing and re-spawning would churn three lists and all the ids.
  - **Everything that targets reads the one convention "a `targetable` with `health.hp <= 0` is not a target":**
    - targeting.js already does (`isAlive`; the lock breaks in `maintainLock`);
    - sword.js: one line in the `doHitCheck` loop, before `hitMask`: `if (h && h.hp <= 0) continue;`;
    - fireball: the `targetables.refresh` `r = -1` rule (37.14).
- **Hurt flash without an engine material override.** A per-instance tint would mean new instance words in both twins plus gpucompare work, for one enemy, so it is rejected for now. Use the proven lamp-glint trick (`hit_flash` material shell hidden under the floor except during the clip, practice target, m3_props.js). The designer adds the clips to the boar model (pass A):
  - `hurt` (shell 0-100 ms, then the idle pose; 167 ms);
  - `die` (shell 0-100 ms + roll onto the side over 400 ms, clamped at the end);
  - `dead` (lying, 1 frame).
  - The shell must ride the rolling part.
- **The view drives the clip** (`beastView.js`): `voxel.playing = false`, `voxel.anim`/`voxel.t` from sim counters, `voxel.hidden` from the state. This amends 29.1's "beastView writes only `yawDeg`": it may also write `components.voxel.{anim, t, playing, hidden}` (presentation only, never read by the sim).
- **Engine seams (small, one step US-079b0):**
  1. `VoxelPool` skips an entity whose `components.voxel.hidden === true`, in both collect branches (the <= 16 path and the nearest-16 selection) and in any other `components.voxel` collector (grep). Hidden instances do not take one of the 16 slots.
  2. `World.addInteractable(spec) -> rec` / `World.removeInteractable(key)` (the 7.4 record shape; `spec {key, name, x, y, z, radius, prompt, requires?, propId?, def?}`; `once: false`, `usedKey: null`, `structId: null`; throws on a duplicate key or a missing name). `rec.x/y/z` may be rewritten by the owner at any time (the find loop reads them live). The list is rebuilt by `World.load`/deserialize, so the game re-adds on every `world:loaded`.
     - Editor/engine value: runtime interactables for NPCs, chests and corpses. A game-side push into `world.interactables` is not allowed.

#### 37.16.2 Beast sim (US-079b, `beastSim.js`, `beastConfig.js`)

**Config (seconds -> `toSteps` once):** `hp 4, dmgCooldownSec 0.2 (12), flashSec 0.1 (6), flinchSec 0.25 (15), dieSec 0.4 (24), corpseSec 60 (3600), sinkSec 0.5 (30), sinkM 0.3`.

**Health:** at create, every boar gets a **fresh** `components.health = {hp: cfg.hp, max: cfg.hp, invuln: 0}`, overwriting a serialized one. Boars always come back alive on load/restart (AC). US-128's bar reads it.

**New states:**

| state | enter | steps | per step | exit |
|---|---|---|---|---|
| `STATE_FLINCH 8` | damaging non-heavy hit in wander/notice/chase/recover/return/flinch | 15 | stop (waypoint = self, maxSpeed 0) | -> chase |
| `STATE_DYING 9` | hp <= 0 | 24 | nothing (no perception/path/steer); `die` clip | -> CORPSE |
| `STATE_CORPSE 10` | after DYING | 3600 | lies at the death point; `dead` clip | `despawnCorpse` or timeout -> SINK |
| `STATE_SINK 11` | from CORPSE | 30 | `z = deathZ - sinkM * k/30` | -> GONE |
| `STATE_GONE 12` | | - | hidden (view), skipped everywhere | `resetAll` |

**New SoA (16 each):**
- `dmgCd Int32`;
- `hurtT Int32` (steps since the last damage, saturating at 9999; the view shows `hurt` while < 10);
- `deathZ Float64`;
- `pendingDied Uint8`, `despawnReq Uint8`;
- `cause Uint8` (0 sword, 1 fire);
- `knockV Float64` (the stagger clamp speed per slot, replacing the shared `cfg.staggerKnock` in `setSteerTarget`).

**Hit listener** (the existing `combat:hit` one, now for every hit on a boar id; still synchronous, deterministic):
1. Slot not found, or `state >= DYING` -> ignore.
2. `dmgCd > 0` -> ignore damage, flash and flinch. Heavy knockback still applies (it is physical): `enterStagger` as below.
3. `p.damage > 0`: `hp -= damage`, `dmgCd = 12`, `hurtT = 0`, `cause = p.cause === 'fire' ? 1 : 0`, **aggro** (`seen = 1, unseen = 0`, so being hit from behind leads to chase, not return).
4. `hp <= 0` -> `enterDying`:
   - state DYING, timer 24;
   - `deathZ = transform.z`;
   - `steer.vx = steer.vy = 0`, then `steer.removeAgent(i)` (no separation, not stepped). The x/y freeze in `transform`;
   - `pendingDied = 1`;
   - **no emit inside the listener.** The sword is still iterating its own target list, and a loot spawn would fire `entity:added` -> list rebuild mid-loop. `beast:died` goes out at the start of the next `beasts.step` (16 ms later).
5. Else, by kind:
   - heavy (`p.heavy`, sword hard or fire) with `knock = p.knock > 0 ? p.knock : cfg.staggerKnock` and `knock >= 1` -> `enterStagger(i, dirX, dirY, min(knock, 12))` (store `knockV`). Fire with tiny falloff (`knock < 1`) -> flinch;
   - light in WINDUP -> `enterRecover` (AC: cancels the charge);
   - light in CHARGE or STAGGER -> flash only (D-034: only a hard hit stops a charge);
   - otherwise -> FLINCH 15.

**`step` additions:**
- First, for slots with `pendingDied`: emit one preallocated `beast:died {id, x, y, z, cause: 'sword'|'fire'}` (a string from a 2-entry const table) and clear the flag. Exactly once per death.
- `dmgCd--` / `hurtT++` for all slots.
- Perception/transition/path/steer-target/post skip `state >= DYING`. A small `stepDead(i)` runs the timers:
  - CORPSE: `despawnReq || timer == 0` -> SINK, emit `beast:sink {id, x, y, z}` (the dust burst via `particleHooks`, designer numbers, n ~14);
  - SINK: writes z;
  - GONE at 0.
  - `despawnReq` set during DYING is honoured at CORPSE entry (no minimum lie time after looting).
- **US-079c note:** its pairwise de-overlap must skip inactive steer slots.

**API:**
- `despawnCorpse(id) -> boolean` (true if the slot was DYING/CORPSE; sets `despawnReq`);
- `isDead(slot)`, `slotOf(id)`.

**`resetAll`** (vitals respawn), per slot:
- if the steer agent is inactive, re-add the dead slots **in ascending slot order** with `steer.addAgent(home, radius, 0, DEFAULT_ACCEL)` and assert that the returned slot `=== i`. The lowest free slot is always the lowest dead one, because live slots stay active and slots >= count are never used;
- `hp = max`; clear `dmgCd`, `hurtT`, `pendingDied`, `despawnReq`;
- then the existing reset;
- emit one `beasts:reset` (loot clears its state).

**Save/hash:** `hashSim` and `save/load` gain the new SoA, `steer.active` (missing today: `loadSim` must restore it, or a dead slot comes back as a ghost agent) and `health.hp` per slot. World saves do not persist beasts beyond this (AC: back alive after a reload), so `save/load` serves the 300/600 replay test only.

**Sword (2 small edits, US-079b; HANDS-01b starts its `sword.js` work after this merge):**
- the dead skip above;
- payload gains `cause: 'sword'` and `knock: 0` (one preallocated object; `knock 0` = use the beast default).

**Tests (`beastSim.test.js` + `sword.test.js`):**
- 4 light hits 12+ steps apart -> hp 0 and DYING on the 4th; two hits 5 steps apart -> 1 damage; hard 3 + light 1 kills;
- flinch 15 then chase, windup hit -> recover, charge light hit -> still charging, stagger with `p.knock` 6 slides ~1.5 m;
- `beast:died` exactly once, one step after the kill, `cause` right;
- the dead boar is skipped by sword arcs and targeting (the lock breaks on the kill step); the steer agent is inactive;
- DYING 24 -> CORPSE -> `despawnCorpse` -> SINK 30 -> GONE; timeout 3600 -> SINK;
- `resetAll` restores slot ids, hp, positions and `active`;
- 600-step replay with a kill + save at 300 / load: hash equal;
- 0 alloc over 10k steps.
- View test: `hurt` for 10 steps after a hit, `die` t = (24 - timer)*16.7, hidden at GONE.

#### 37.16.3 Loot (US-091a2, new `game/js/quest/sim/loot.js` + `lootConfig.js`)
- `createLoot(world, events, {items, beasts, rng, inventoryOf, table})`, created on every `world:loaded` after `createBeastSim`. `rng = createRng(((nav.seed ?? 1) ^ 0x10075) >>> 0)` is its own stream, so the beast wander RNG is never perturbed.
- **Roll at death** (`beast:died` listener), in a fixed draw order, always 5 draws (the stream shape does not depend on results):
  - meat 1 @ 100 %, hide @ 60 %, tusk @ 25 %;
  - orb @ 50 %, orb kind `int(2)` (hp/mp).
  - Orbs go on the ground (`spawnDrop`, US-080b; the owner allows that). Meat/hide/tusk stay in the corpse: `corpseN Int8Array(16*3)` per beast slot.
- **Interactable:** per boar, once per load, `world.addInteractable({key: 'loot.' + id, name: 'beast.loot', x, y, z, radius: 1.8, prompt: LOOT_PROMPT.boar, requires: 'loot.' + id, propId: id, def: {beastId: id}})`.
  - On `beast:died`: rewrite `rec.x/y/z` to the body (`z + 0.35`) and set `world.state['loot.' + id] = true`.
  - On `beast:sink` / `beasts:reset`: delete the flag and zero the counts.
  - At create: delete any stale `loot.*` flag from a save.
  - The prompt text is a writer placeholder in `lootConfig.js`.
- **`beast.loot` behaviour** (registered in `quest/index.js`, calls the module-level `lootApi`, set by main.js at load; the hints/pickups module-state precedent):
  - for meat, hide, tusk in order: `added = addItem(inv, defs, id, n)`, `corpseN -= added`, and a toast `+added Name` per kind with `added > 0`;
  - anything left -> toast `Pack full`, the corpse stays lootable;
  - else -> clear the flag + `beasts.despawnCorpse(id)` (sink + dust);
  - returns `false` (no used flag).
- **Toast:** `game/js/quest/toastView.js`, queue max 3, 1.5 s render time, newest at the bottom, top-centre. Events `inventory:added {id, n}` / `inventory:full` are emitted by loot. The string is built on the event (rare), never per frame. Designer toast style.

#### 37.16.4 Inventory data (US-091a1, `game/js/quest/sim/inventory.js`; shape created by HANDS-01b)
- `player.components.inventory = {slots: [{id: string|null, n: int}] x 24, left: string|null, right: string|null}`: plain JSON, serialized with the entity (the vitals convention). Death respawn keeps it; `R` restart restores the start state.
- Pure functions:
  - `ensureInventory(player, start)`, `addItem(inv, defs, id, n) -> added` (stacks first in slot order up to `stack`, then the first empty slot), `removeItem(inv, id, n) -> removed`, `countOf(inv, id)`;
  - `assignHand(inv, hand, id|null) -> boolean`: the id must be in the pack with a kind in `weapon|spell|tool`; it empties the other hand if it held the same id;
  - `swapHands(inv)`;
  - `hashInto(inv, h)` (FNV over the id chars, no allocation).
  - A hand item whose count drops to 0 empties its hand.
- Item defs: `design/items.js` -> `ASSETS.items` (designer, plus a `module.exports` for Node tests), passed in by main.js. The game validates each def at load (id/name/kind/stack/icon) and throws naming the id. Gameplay numbers stay in `game/js/quest/*Config.js`.
- `swordTake.js`: `addItem('sword', 1)`, and `left = 'sword'` if left is empty (else right if empty).

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **US-079b0** engine seams: `voxel.hidden` + `World.addInteractable` | PC-B cross-track -> arch-review (opus batch) | ~0.3 d | `engine/render/voxelPool.js`, `engine/world/World.js`, `engine/world/interaction.js` (doc only), tests in `voxelPool.test.js` / `world.test.js` | Hidden voxel skipped in both branches and frees its nearest-16 slot. `addInteractable` is found by `findInteractTarget` and fires its behaviour; live x/y rewrite is respected; `requires` gating; duplicate key throws; `removeInteractable`; deserialize drops it (the game re-adds). 0 alloc in `findInteractTarget` unchanged. | Full runner + check-deps green |
| **US-079b** HP, hurt, death, corpse | PC-B | ~0.75 d | `beastSim.js`, `beastConfig.js`, `beastView.js`, `sim/sword.js` (2 lines), `particleHooks.js` (`beast:sink` dust), tests | 37.16.2 list | PO (opus, owner-visible) -> owner look |
| **US-091a1** inventory data + start + sword take | PC-B | ~0.5 d | `sim/inventory.js` (extends HANDS-01b), `swordTake.js`, main.js | Stacking/full/hand rules, save round trip, death keeps items, old save with the sword taken -> sword in pack + left. | Suites green |
| **US-091a2** loot roll + corpse interactable + toast | PC-B | ~0.5 d | `sim/loot.js`, `lootConfig.js`, `toastView.js`, `quest/index.js`, main.js | Seeded table over 1000 deaths ~ 100/60/25/50 % and the exact sequence for seed 1. The prompt appears only on a dead body. E -> items + toasts; pack full -> leftovers stay + "Pack full"; empty -> sink. Timeout clears the flag. `resetAll` clears. Toast queue max 3. 0 alloc per step. | PO (sonnet) -> owner look |

**AC changes for the PO (relay; the architect does not edit rows):**
1. US-079b: "lies still 1.0 s, then sinks ... and is removed" becomes "lies as a corpse until looted (E) or 60 s, then sinks 0.3 m with dust over 0.5 s and is hidden". A light hit during a charge only flashes (D-034). Any damaging hit aggroes.
2. US-091a: walk-over item drops and the ground hop are replaced by the corpse loot on E (owner answer 1). HP/MP orbs stay ground drops. The row splits into a1/a2 as above.
3. HANDS-01: "D-034 threshold for both buttons" becomes "each item owns its tap/hold threshold (sword 0.4 s, fireball 0.6 s)". The row splits into 01a/b/c.
4. SPELL-01a:
   - a cast at the cap of 4 is refused without spending mana;
   - a charged release with 5-9 MP casts a tap;
   - player self-knock 6 m/s horizontal + 3 m/s up at the centre, scaled by the falloff.

**Do not:**
- `world.remove` a boar;
- emit `beast:died` inside the hit listener;
- push into `world.interactables` from game code;
- add a per-instance material/tint path to the engine for this;
- persist dead boars or corpse loot in saves;
- draw loot from the beast wander RNG.

### 37.17 ALPHA-01 alpha-cutout materials for imported meshes (architect, 2026-10-05; D-041 Quaternius Stylized Nature)

**Probe (2026-10-05, Node, `design/meshes/source/quaternius_stylized_nature/glTF/`, all 68 files + 20 PNGs decoded):** every material is `doubleSided`, one sampler (linear/mipmap). `alphaMode MASK @0.2` on: all `Leaves_*` / `Leaf_Pine` (texture alpha 0 on 70-75 %, 255 on 14-43 %, 1-9 % soft in between), `Flowers` (49.5 % alpha 0), `Leaves` (small plants, fern, clover, Flower_* leaves) - **and `Bark_NormalTree`, whose texture is 100 % alpha 255 (a mislabel: it is opaque)**. OPAQUE: `Bark_DeadTree`, `Bark_TwistedTree`, `Grass` (512^2, blades are geometry, UV is a 2 %-wide colour strip), `Mushrooms`, `PathRocks`, `Rocks`. Geometry: CommonTree_1 = 4,345 bark tris + 1,920 leaf tris (960 cards, median 0.54 m^2 => ~1 m cards, crown 4.3 x 4.7 x 4.7 m); Pine_1 = 3,177 + 770 (median 0.08 m^2 => ~0.3 m cards); Bush_Common 900 leaf tris (0.09 m^2); Flower_3_Group leaves are real geometry (0.002 m^2) with 45 petal cards; Petal_* are 13-30-tri cards. Textures 1024^2-2048^2; bark UV v runs to -10 (repeat). The Kenney Nature Kit is **not on disk** (only `Kenney.url`) - the far LOD cannot assume it.

**Design (10 lines).**
1. **Data.** A masked material is a `MeshRange` with `mask: {tex, cutoff}`; the importer emits one range per (primitive, material), **opaque ranges first**, then masked ranges grouped by material. The mesh keeps **planar UVs in `uv` for every vertex (A4 / 37.1 item 2 unchanged: glyph detail, GA.u/v, AO twins untouched)** and carries the source `TEXCOORD_0` in a new optional per-vertex `uvMask: Float32Array(V*2)` (zeros on opaque ranges, omitted when no range is masked). Mask textures are stored as 8-bit alpha, downsampled at import (`content/masks/<name>.mask.json`), packed at load into **one R8UI atlas** (`MaskAtlas`, max 2048^2, no mips, nearest / `texelFetch` only - parity).
2. **Addressing (both twins, exact):** `ub = fround(u); tu = ub - floor(ub); tx = min(w-1, floor(fround(tu*w)))` (same for v; glTF v = 0 is image row 0, no flip); `a = atlas[(y0+ty)*W + x0+tx]`; **discard iff `a < cutoffByte`**, `cutoffByte = round(cutoff*255)` stored on the range (integer compare, no normalised-float texel). The residual twin difference is f32-vs-f64 interpolation of `uvMask` -> a D-039 tie class (`maskTies`, item 9).
3. **Raster:** the JS twin (`rasterFanTri`) samples at the fragment and `continue`s before any G-buffer write; GLSL `mesh.frag` `discard`s before the MRT writes (the hardware depth write goes with it). The shadow pass gets the same test (`SHADOW_FRAG_SRC` gains the mask block under `uMaskOn`, still no colour output), so leaves cast leaf-shaped shadows, and the JS depth-only twin (`ctx.depthBias` path, same `rasterFanTri`) agrees by construction.
4. **Two-sided:** kind 9 already draws cull NONE in both twins (27.15.2); instanced kind 9 (TREES-LP-b) must do the same - `cullBack = false` for kind-9 ranges in `rasterRange`, `gl.disable(CULL_FACE)` around mesh-group draws. Masked ranges flip the normal on back faces exactly like cloth (`twoSided` + `A2 < 0` / `!gl_FrontFacing`); opaque kind-9 ranges keep today's behaviour (no row changes).
5. **Look:** glyph/colour come from the palette material the `mats` sidecar maps the glTF material to (`leaf`, `leaf_dark`, `leaf_light`, `bark` / `timber_old`), never from the texture RGB. Planar UVs drive the detail hash, so cards get the existing `&` / `%` leaf glyphs. A card contributes no colour of its own: the mask only decides which fragments exist.
6. **Edges:** new material flag `edge: 'soft'` (palette `materials.leaf*.edge = 'soft'`; `ShadeTextures.packMaterial` bit `F_SOFT_EDGE` in the existing `flags` lane; JS `MaterialTable` exposes `softEdge(matId)`). A soft cell only takes `cap` / `lip` / `side` against **sky or a non-soft neighbour** (crown silhouette, ragged by the mask), never `convex` / `concave` / `seam*` / `nosing`, and the rule gain is `edges.softGain` (default 0.85, `detail-pass.js`) with the glyph kept. Same decision block in `edgePass.js` and `edge.frag.js` (edge.frag binds `uMatI` for the flag). Non-soft cells are bit-identical to today. The A1 crease gate is unchanged (and still same-placement-scoped per 37.15 item 4). Without this, neighbouring leaf cards (own planeIds, normals > 30 deg apart) would draw a convex/concave wireframe through every crown.
7. **Coverage:** at 400 cols / ~90 deg HFOV a cell is ~d/255 m wide (a 1 m card = 25 cells at 10 m, 8 at 30 m, 2.5 at 100 m). CommonTree crowns stack ~20-30 card layers along a ray (960 m^2 of cards over a ~16 m^2 cross-section), so the crown is optically solid inside and has holes only at the silhouette: it reads as a leafy mass. Pine (0.3 m cards, ~1 layer) is the sparse risk species. Rule: **LOD0 only while the median card is >= 3 cells wide**, i.e. per species `lodCells >= 3 * treeH / cardW` cells of projected height (CommonTree ~24, Bush ~12, Pine ~70 - pines swap to LOD1 at ~12-15 m unless the preview says otherwise). Below that the mask becomes per-cell noise.
8. **LOD / perf.** 1,500 trees x 4-6k tris is ~9 M tris before the cull and ~1.8 M in view: 3-5x over the 1.0 ms bar, so **37.15 item 6 ("no LOD") is amended**: mesh groups get LOD1 through the existing RE-15c mechanism (`g.lodCells`, `drawIb[1]`, hysteresis) with `g.meshFar` = a second MeshData (the TREES-LP-a generator tree, 300-600 tris, no mask; or a Kenney tree once downloaded; never the same mesh). Shadow list: LOD1 for every mesh-group instance farther than `shadows.meshLod0M` (25 m) from the camera, LOD0 inside. Expected in view: ~45 LOD0 trees (fill 1 per 36 m^2 inside 45 m) ~220k tris + ~250 LOD1 ~75k tris. Overdraw: 6-30 layers over the crown's screen area x one `texelFetch` each - cheap next to the vertex load; `discard` costs the early-z write, accepted. Bars stay those of 37.2 item 8 / 37.15 item 8 (+1.0 ms, +0.5 ms with shadows, Arc iGPU p95).
9. **gpucompare (D-039 tie class, harness only):** a mismatched cell is a **mask tie** when on either twin it is kind 9 with a masked range's material and the JS twin's own `uvMask` texel or any of its 8 neighbours lies on the other side of `cutoffByte`. Mask ties are excluded from `kindMatchPct`, glyph/colour counts and `violNonMesh`, reported per row (`maskTies` + a cell list), cap 2 % of geometry cells per pose (else FAIL). Thresholds otherwise unchanged; a mismatched masked cell whose 3x3 texels all lie on one side is a twin bug (STOP, report kind / uv on both twins / texel / cutoff).
10. **Asset flow:** `content/manifest.json` gains `masks: [...]`; `loadContentPack` loads them into `AssetRegistry` kind `'mask'` (`assets.mask(id)` -> `{id, w, h, data: Uint8Array}`); `engine.loadWorld` builds `engine.maskAtlas = buildMaskAtlas(assets)` once (ids sorted, shelf packing, deterministic); `MeshDrawCache.get(mesh, idFor, atlas)` resolves `copy.maskRanges: Int32Array(ranges.length*5)` = `[x0, y0, w, h, cutoffByte]` per range (`w = -1` = opaque) and throws `mesh "<id>": mask "<tex>" not in the atlas`. The GPU uploads `texMask` (R8UI) when `atlas.version` changes - never per frame.

**Formats.**
- `.mesh.json` additions: `ranges[i] = {start, count, part, mask?: {tex: 'quaternius/Leaves_NormalTree', cutoff: 0.2}}`; top-level `uvMask?: number[]` (V*2, rounded 1e-5 like `uv`). `validateMesh`: `uvMask` length = `pos.length/3*2` when present; a `mask` range requires `uvMask`; `cutoff` in (0,1); masked ranges after every opaque range. `meshToJSON` / `meshFromJSON` round-trip both.
- `content/masks/<name>.mask.json`: `{kind:'mask', schema:1, id:'quaternius/Leaves_NormalTree', w:256, h:256, cutoffDefault:0.2, data:'<base64 of w*h bytes>'}`. Downsample = box average of the source alpha over each cell (f64, `Math.round`), `--mask-res 256` default, 512 allowed (`Leaves.png`, `Leaf_Pine` fine detail), power of two <= 1024. Atlas budget: 2048^2 R8UI = 4 MB = 64 slots of 256^2; the Quaternius set needs 6.
- MaskAtlas API (`engine/render/MaskAtlas.js`, pure, imports nothing): `class MaskAtlas { W, H, data: Uint8Array, rects: Map<id,{x0,y0,w,h}>, version }`, `add(id, w, h, bytes)` (throws when full or on a duplicate id), `rect(id)`, `sample(x0, y0, w, h, u, v) -> byte` implementing item 2 literally (the JS twin calls it per fragment: no allocation, no closures), `static texel(u, w) -> int` (the exported addressing helper the Node tests hit directly).
- GPU: the `MeshBuffers` entry gets an optional `uvMaskBuffer` (separate VBO, 8 B/vertex) bound at **attribute location 10 (`vec2 aUVMask`)** in the static and instanced variants; meshes without `uvMask` leave location 10 disabled with `vertexAttrib2f(10, 0, 0)`. Fragment uniforms (static, instanced and both shadow programs): `uMaskOn (int)`, `uMaskRect (ivec4 x0,y0,w,h)`, `uMaskCutoff (uint)`, `usampler2D uMask`. Draw loops: a kind-9 item whose mesh has `maskRanges` draws per range (`uMaskOn` 0 for opaque ranges, 1 + rect/cutoff for masked) instead of one `drawArrays` over the whole mesh; instanced mesh-group draws already loop ranges. The 64-byte static vertex stride is **not** changed.
- Importer (`tools/gltf-import.mjs`): `--masks content/masks` (default) writes/refreshes the `.mask.json` files it needs (dedup by texture file name; a re-import is byte-identical); `--mask-res`; `--opaque <matName>` forces a MASK material opaque. **Auto-opaque rule:** a MASK material whose downsampled mask has no texel `< cutoffByte` inside the UV bbox of its own triangles is imported as opaque with a WARN (`Bark_NormalTree` -> opaque, no `uvMask` for it). Plain `tools/png.mjs` decoder (8-bit G/GA/RGB/RGBA, filters 0-4, non-interlaced; rejects palette/16-bit/interlaced naming the file) - zlib only, no dependency. `loadGltf(buffer, id, {uv, alpha: true})` reads `materials[i].alphaMode/alphaCutoff` and `baseColorTexture -> images[].uri`; the file I/O stays in the tool (it passes `opts.textures[name] = {w, h, alpha: Uint8Array}`; gltf.js never reads files).

**Do not:** sample texture RGB for colour; put the mask UV in `uv` (planar stays); use `sampler2D` + a normalised compare, mips or linear filtering for the mask; flip normals on opaque kind-9 ranges; change the 64 B static stride or `writeUnitInstance`; add per-instance mask parameters; LOD by a second instance-word format (use `g.meshFar` + RE-15c); widen any gpucompare threshold (the `maskTies` class and its 2 % cap are the only harness change); draw the whole mesh in one call when ranges differ in mask state; import TwistedTree_* (9-10k tris) before an LOD exists.

**Order with TREES-LP / ME-19:** ME-19a -> TREES-LP-a (`buildMeshFromTris`; ALPHA-01a builds on it: tris carry `uvMask`) -> ALPHA-01a (tools, parallel with ME-19b) -> TREES-LP-b (mesh groups) -> ALPHA-01b (JS twin + atlas) -> ALPHA-01c (GPU; after ME-19c if 19c is in flight - both edit the `GpuCellPipeline.js` draw loops) -> ALPHA-01d (edges) -> ALPHA-01e (content + LOD, replaces TREES-LP-c's species switch) -> ALPHA-01f (bench; TREES-LP-e folds into it). **TREES-LP-d becomes the LOD1 / fallback species** (generator trees, no mask); the owner preview compares Quaternius LOD0 vs generator LOD1 at 10 / 30 / 60 m. **Imports that need no ALPHA-01 (after TREES-LP-a, `--uv planar --mats`):** DeadTree_1..5 (5.6-6.6k tris: over the 4k A3 piece cap, allowed only as `forest.trees.species` with low weight under the TREES-LP bars), Rock_Medium_1..3, Pebble_* (48-136), RockPath_* (<= 3.5k, under the piece cap), Mushroom_Common (880; Laetiporus 3.2k), Grass_* (OPAQUE geometry blades, 155-622 tris - ground detail via TREES-LP-f / `scatterFeed`). **Need ALPHA-01:** all CommonTree / Pine / Bush / Petal and the `Leaves`- / `Flowers`-textured plants (Fern, Clover, Plant_*, Flower_*) - run the importer dry-run with the auto-opaque rule first: a plant whose `Leaves` UV region is fully opaque (likely Clover: geometry leaves) imports now.

| Step | Track | Size | Files | Tests | Done when |
|---|---|---|---|---|---|
| **ALPHA-01a** import + formats | PC-B tools | ~0.75 d | `tools/png.mjs` (+test; the test writes 4 tiny fixture PNGs itself via zlib), `engine/mesh/gltf.js` (`alpha` opt, materials, `uvMask`, range order), `engine/mesh/MeshData.js` (`uvMask`, `MeshRange.mask`, validate/JSON), `tools/gltf-import.mjs` (`--masks`, `--mask-res`, `--opaque`, auto-opaque rule, mask writer), `tools/validate-content.mjs` + `mesh-content.test.mjs` (masks), `content/manifest.json` (`masks`) | `gltf.test.js`: synthetic 2-material glTF (opaque quad + MASK quad, 4x4 RGBA data-URI PNG): ranges opaque-first, `mask.tex/cutoff`, `uvMask` = TEXCOORD_0 on the masked range and 0 elsewhere, `uv` planar on both; an all-255 MASK texture -> opaque + WARN; Ruins re-import byte-identical. `MeshData.test.js`: JSON round trip, validator errors (missing `uvMask`, masked-before-opaque, cutoff 1.0). `gltf-import.test.mjs`: `.mask.json` box-averaged bytes (hand-checked 2x2 -> 1x1 case), re-run byte-identical | run-tests + check-deps green; `CommonTree_1` dry-run prints 2 ranges (bark opaque by the auto rule, leaves masked) |
| **ALPHA-01b** atlas + JS twin | PC-B cross-track engine -> arch-review (PC-A) | ~0.75 d | `engine/render/MaskAtlas.js` (+test), `engine/core/assets.js` (`'mask'` kind), `engine/core/engine.js` (`maskAtlas` built on `loadWorld`), `engine/mesh/DrawList.js` (`MeshDrawCache.get(mesh, idFor, atlas)` -> `maskRanges`), `engine/mesh/rasterJS.js` (`uvMask` interpolation via 2 more scratch lanes, `info.mask*`, discard, two-sided flip for masked ranges, kind-9 `cullBack = false` in the instanced path, per-range loop for static kind-9 items), `engine/index.js` exports | `MaskAtlas.test.js`: `texel()` table incl. u = 1.0, -0.25, 2.5 and the f32 rounding case (u = 0.1 + 0.2 in f64 vs fround); packing deterministic by sorted id; a full atlas throws. `rasterJS.test.js`: a 2 m masked quad with a 4x4 checker mask at 3 m, brute-force oracle (ray vs quad + the same texel rule) over 400x150: kind/planeId/depth cells equal; the back view has flipped normals (face 7 packed n = -n); the opaque range is unaffected; 0 allocations over 1000 frames. `rasterDepthOnly.test.js`: the shadow twin skips the same fragments | run-tests + check-deps green |
| **ALPHA-01c** GPU twin + harness + poses | PC-A engine (GPU verification on the Arc) | ~1 d | `engine/render/gpu/MeshBuffers.js` (`uvMaskBuffer`), `glsl/mesh.vert.js` (`aUVMask` / `vUVMask`, static + instanced; cloth untouched), `glsl/mesh.frag.js` (mask block + `!gl_FrontFacing` flip under `uMaskOn`), `glsl/shadow.frag.js` (mask block), `GpuCellPipeline.js` (`texMask` R8UI upload on `atlas.version`, per-range draws in the static / instanced / shadow loops, uniforms), `engine/render/gpu/gpuCompare.js` + `game/js/dev/modes/gpucompare.js` (`maskTies`, item 9), `content/worlds/world_m1.world.json` (2 CommonTree + 1 Pine + 1 Bush as `kind:'mesh'` placements ~15 m east of the Ruins pieces, off the boar route) | `glsl.test.js`: location 10 in static + instanced only, cloth source unchanged, shadow frag has the mask block, `uMask` is a `usampler2D`. `gpuCompare.test.js`: maskTies rule - (a) masked cell with a boundary texel in the 3x3 -> tie; (b) all-same 3x3 -> violation; (c) cap 2 % -> FAIL; non-masked rows unchanged. `MeshBuffers.test.js`: entry with / without `uvMaskBuffer` | `?gpucompare=1` new poses `world_m1: alphaLeaves` (eye 6 m, pitch +20 at a crown) and `alphaLeavesFar` (30 m) PASS or recorded known-FAIL per D-039 (maskTies count in the row); `&shadows=map` rows PASS (leaf-shaped shadow on the ground in a headless capture); no previously passing row regresses; 0 uploads/frame after warm-up |
| **ALPHA-01d** soft edges | PC-B cross-track -> arch-review | ~0.5 d | `engine/render/MaterialTable.js` (`edge: 'soft'` -> `softEdge(id)`), `gpu/ShadeTextures.js` (`F_SOFT_EDGE`), `engine/render/edgePass.js`, `glsl/edge.frag.js` (bind `uMatI`), `design/palette.js` (`leaf*.edge = 'soft'`), `design/detail-pass.js` (`edges.softGain`) | `edgePass.test.js`: soft cell next to sky -> cap/lip/side with gain 0.85 and its own glyph; soft-soft neighbours at any depth/normal -> no rule; soft next to a non-soft vertical -> side only; all non-soft fixtures bit-identical. `glsl.test.js` string check for the `uMatI` bind | `?gpucompare=1` rows unchanged except the two alphaLeaves poses; owner one-look: crowns outlined only at the silhouette |
| **ALPHA-01e** content + LOD1 | PC-B content/engine -> arch-review | ~0.75 d | `content/meshes/quaternius/**` (CommonTree_1..5, Pine_1..5, Bush_Common, Bush_Common_Flowers, DeadTree_1..3, Rock_Medium_1..3, 6 pebbles, 4 rock paths, Mushroom_Common; `--mats` sidecars -> `bark` / `timber_old`, `leaf`, `leaf_dark`, `leaf_light`, `stone*`, mushroom key), `content/masks/*.mask.json`, `engine/mesh/instances.js` (`meshGroup(mesh, capacity, {meshFar, lodCells})` -> the RE-15c LOD1 bucket draws `meshFar`), `engine/mesh/shadowList.js` (`shadows.meshLod0M`), `engine/world/scatter.js` validator (`meshFar` optional, `lodCells`), `design/levels/overworld_far.js` species (CommonTree x3, Pine x2, DeadTree x1 low weight; `meshFar` = TREES-LP-d generator trees), `THIRD_PARTY_NOTICES.md` (Quaternius CC0 line) | `instances.test.js`: LOD split by projected height with hysteresis, LOD1 draws `meshFar`, shadow LOD by distance; `scatter.test.js` validator; `mesh-content.test.mjs` covers every file (tris, flat normals, masked ranges last) | forestWalk re-baselined (old/new rows recorded); headless capture inside the forest at 3 distances; owner look |
| **ALPHA-01f** bench (absorbs TREES-LP-e) | PC-A | ~0.25 d | none | Arc `?bench=1` forestWalk trees on/off x `shadows` map/off, `lodCells` x 0.5 / x 2 | bars of 37.15 item 8 met or tuned in this order: raise `lodCells`, lower `fill`, drop the Pine LOD0 range; recorded in the row; owner walk-test "stylized forest" |

**Reusable beyond trees (D-041 "real engine feature"):** any `.mesh.json` range may carry `mask` - fences, grates, torn cloth banners (static), ivy cards on the tower. The same `MaskAtlas` can later back sprite cutouts; keep it in `engine/render/` with no mesh import.
