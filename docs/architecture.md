# ASCII Quest – Engine Architecture

Owner: Architect. Created 2026-09-22. Works inside the manager's decisions D-002, D-005, D-006, D-007, D-008 (`docs/decisions.md`). Story-specific notes live in `docs/backlog.md` ("Tech notes (architect)"); anything reusable lives here. When this file and a story note disagree, this file wins and the story note gets fixed.

Contents: 1 Layers · 2 Folder layout · 3 Dependency rule and `check-deps` · 4 Conventions · 5 Public API (`engine/index.js`) · 6 AssetRegistry and content interfaces · 7 World model · 8 Frame pipeline and budgets · 9 Allocation rules · 10 Serialization and editor extension points · 11 Testing strategy · 12 Performance notes · 13 Do-not list

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
export function moveSphere (world: WorldQuery, x, y, dx, dy, radius, z, opts): {x,y,hitX,hitY}                 // US-013
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

**4. Sprite pass** (`glsl/sprite.frag.js`, `SpriteAtlas.js`). JS projects each sprite once per frame with `projectSprite(cam, sprite, rt, out)` (shared with the JS reference `sprites.js`): `rect(x0, y0, w, h)` in cells, `scale`, `lod` (half below 0.75, never above 3x), `depth` (perp dist), frame index, light rgb (US-006; ambient until then), `fogF`, flags -> 2 RGBA32F texels per sprite in `SPR` (2x64; only `count` rows uploaded, <= 4 KB). `SPRATLAS` RGBA8UI is built once per registry bind by the pure packer: `r` glyph code, `g` colour index into the `PALRGB` RGBA32F LUT, `b` = emissive bit | normal code << 1, `a` = 0 transparent / 1 opaque; a header row holds `(x, y, w, h)` per frame and LOD. Pass F per cell: for s in 0..count (constant bound 64, `break` at count): inside rect && `depth < DEPTH(cell)` && `depth < best` -> atlas texel at `floor((cell - rect0) / scale)`; opaque -> best. Output: fg = emissive ? palette colour : colour * (0.35 + 0.65*nf) * light, fog-blended like surfaces; bg = `edgeBg` (the wall shows through); glyph = atlas code. No sprite -> copy `edgeFg/edgeBg`. `mask` cells always win (UI over sprites). `?gpucompare` compares this pass against `drawSprites` on the same pool.

**5. Grid setting.** `createEngine({cols, rows, cpuGrid = {cols: 160, rows: 60}, gpu = true, rays = 2})`; `RenderTarget(canvas, cols, rows, { force2d, cpuGrid, gpu })` probes WebGL2 + `isSoftwareRenderer` **before** constructing the target and uses `cpuGrid` when the result is not a real GPU (`?gpu=0`, `?force2d=1`, no WebGL2, software renderer). Allowed range 160x60..320x120 with the 8:3 aspect kept (`rows = round(cols*3/8)`); out of range -> clamped and logged once; **default on gl2 = 320x120** (`?grid=240x90` is the step-back). `engine.setGrid(cols, rows)` re-sizes `rt` (textures, atlas, canvas), `depthBuffer`, `openSpans`, `gbuf`, the pipeline textures, and rebinds shading (`cellAspect` may change); emits `grid:changed`. It is used once at startup when `!pipeline.ready` (compile/link failure -> CPU at `cpuGrid`) and later by the in-game option. A context loss mid-game stays on the current grid on the CPU until restore (rare; degraded, not dead). `?grid=`/`?rays=` are parsed in `game/js/main.js` only. UI text is positioned from `rt.cols/rows` anchors, never from absolute cells; at 320x120 a HUD glyph is half the size, so HUD readability (a 2-cell font) is a designer/PO follow-up, not an engine concern. `present()` is unchanged: its cost is per pixel, not per cell; the atlas grows to `95 * pxCellW` (~600 px).

**6. Budgets (320x120, n = 2, owner laptop).** GPU <= 4 ms p95, expected < 2 ms: cast = 153,600 sub-rays x <= 96 steps x <= 2 in-bbox structures = 30 M DDA steps worst case (about 1 ms on a 2018+ integrated GPU; typical rays stop after 10-30 steps), resolve/deriv/edge/sprite ~0.1 ms each, shade x4 ~0.3 ms. n = 3 is allowed only if the measured p95 stays <= 4 ms; n = 4 is test-only. JS <= 2 ms: sim <= 1.0, hook <= 0.4 (`MASK` 38 KB + dirty rows + `uStruct` + sprite list), `rt.cells.clear` 0.05, UI 0.3; the two 154 KB present uploads stay (D-005). VRAM: sub-sample G-buffer 640x240 x 28 B = 4.3 MB; nothing is read back in the frame loop.

**7. Fallback matrix.** `gl2` + real GPU + `DP` + `allV2` + all programs linked -> **GPU path** at the requested grid (DDA + coverage + GPU sprites; `?rays=1..4`). Anything else -> **CPU path**: `castSectors` + JS passes + `drawSprites` at `cpuGrid` 160x60, rays forced to 1, `?grid`/`?rays` ignored (logged once). Test-only: `pipeline.setSource('upload' | 'dda')` keeps the stage-1 G-buffer upload for `?gpucompare=shade`. F3 overlay: `path: gpu|cpu  grid: WxH  rays: n`.

**8. Parity and metric tooling.** `?gpucompare=1` runs at 160x60 with n = 1: per pose the CPU `renderWorld` and the GPU pipeline render from the same camera; test-only readback of `fgTex/bgTex` **and** `GI/GA/DEPTH` (uint `readPixels`); reports geometry parity (kind match >= 99.5 % excluding 4-neighbour-kind edge cells; mat/planeId equal and depth within 1 %, u/v within 1e-3 * depth on matched cells) and cell parity (glyph >= 99 %, fg/bg +-4, `poisonedSurvivors == 0`), sprite cells included. `?gpucompare=shade` = the US-029 test, unchanged. `?flicker=1` (`engine/render/gpu/flicker.js`, pure `flickerStep(prevGI, prevFg, curGI, curFg, cols, rows, out)`): bench poses x 3 motions x 30 steps (0.02 m fwd, 0.02 m strafe, 0.1 deg yaw); a cell counts if kind/mat/planeId are equal in both frames and its 4 neighbours have the same kind in both frames; reports the share whose glyph changed, per motion and averaged, for JS 1-ray, GPU n = 1 and GPU n = rays at the same grid. Readback happens only in these two modes.

**9. Do not** (in addition to 14.1 items 5 and 11): keep column state across rows in GLSL; depend on `EXT_color_buffer_float`; jitter or rotate the sub-sample pattern; run the CPU caster at any grid other than `cpuGrid` in production; allocate in `frame()` or the hook (the upload plan writes into preallocated ranges); write sky from JS on the GPU path; read `DEPTH` in the pass that writes it; put level- or model-specific constants in GLSL (everything comes from the packed textures and the registry).
