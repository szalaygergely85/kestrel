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

**4. Sun shadow = 2D DDA toward the sun, per cell, both paths.** Skip when `uSunOn == 0` or `N.sunDir <= 0`. Start `S = P + N * 0.01`, `h0 = S.z + 1e-3`; walk the grid along `sunDir.xy` (same boundary stepping as the caster DDA), for each cell C compute `h1 = h0 + tanElev * (horizontal distance to the exit boundary)`: **blocked iff `h0 < C.floorH` or (`!C.ceilSky && h0 <= C.topH && h1 >= C.ceilH`)** (solid cells: `floorH` is the wall top; open cells: `floorH` is the step block, `[ceilH, topH]` the slab plus upper band, closed so `topH == ceilH` still blocks). Then `h0 = h1`. Lit when the ray leaves the footprint, `h0 > maxH(structure)`, or `MAX_SUN_STEPS = 48` is reached (bias to lit). Then the remaining placed structures by slab entry (structure loop as in `dda.frag`); outside every footprint -> lit. `sunDir = (sin az cos el, -cos az cos el, sin el)` (x east, y south, z up, compass azimuth = where the light comes FROM). Elevation <= 0 -> `sun.on = false`. **Amendment (architect review of US-007, 2026-09-24):** (i) the walk may be expressed in world coordinates (`world.structureAt`/`sectorAt` in JS, a per-step bbox point loop over `uStructCount` in GLSL) - same answer, no slab-entry chaining needed; (ii) all cell heights and `maxH` are level-local: compare `h - origin.z` (GLSL `A.z`); (iii) `packed.maxH` = max over cells of (solid ? floorH : max(floorH, ceilSky ? -Inf : topH)), `SKY_H` for `topSky`, kept in sync by `updateAnimatedSector` and re-packed into `uStructB[i].w` by `planFrameUpdate`; (iv) cells outside every footprint never block and cost no fetch, but the walk continues (so a structure across a gap still shadows) until `h0 > worldMaxH = max_i(origin.z_i + maxH_i)`, `h0 > maxH` of the structure just entered, or `MAX_SUN_STEPS` (bias to lit).

**5. Point-light visibility grid (CPU, uploaded).** Slot i covers the footprint of the structure containing the light (`world.structureAt`), cells within `ceil(radius)` of the light cell: 2D DDA from the light cell centre to the target cell centre; a cell blocks when `solid && lightZ < floorH`, or `!solid && (lightZ < floorH || (!ceilSky && lightZ > ceilH && lightZ <= topH))`; unreached cells and the light's own solid cell -> 0, reached -> 255. Recompute when `(floor x, floor y)` of the *unjittered* position, `world.structVersion` or `packed.version` changes (the lantern: <= 11x11 cells x <= 12 steps when it crosses a cell edge); mark `visDirty[i]`, the hook `texSubImage2D`s only dirty slots (<= 4 KB each). Shader/JS sample: `vis = LVIS[slot][floor(S.x - ox), floor(S.y - oy)] / 255`, `S = P + N * 0.01`; outside the slot footprint or light outside every structure -> `vis = 1`. `LVIS` = R8UI, width `maxW`, height `MAX_LIGHTS * maxH` (max footprint of the placed structures, rebuilt on `structVersion`). Lights lighting a *second* structure are unoccluded in M1 (one structure); noted for M2. **Amendment (architect review of US-006, 2026-09-24, accepted deviation):** the slot is not the structure footprint but a per-light box of `2*min(16, ceil(radius))+1` cells (`MAX_VIS_DIM = 33`) centred on the light's unjittered cell; `LVIS` is `33 x (MAX_LIGHTS*33)` R8UI, `uVisBox[i] = (ox, oy, w, h)` per light, and the box is independent of the `packed` atlas (Node-testable). Consequences: occlusion is clamped to 16 m from the light (presets with a larger radius are unoccluded beyond that - acceptable for M1 presets; revisit if a M2 preset exceeds 16 m); `vis = 1` outside the box; cells outside every structure never block. Recompute keys: the light's unjittered cell, `world.structVersion`, and the containing structure's `packed.version`. Upload is keyed by a per-slot `visVersion` counter that the pipeline compares with its own uploaded version (reset on texture (re)creation), never by a one-frame dirty flag. The sample point is `S = P + N * 0.01` in both paths (a wall hit lies exactly on the cell boundary; sampling `P` itself is a float coin flip).

**6. Budgets (320x120, n = 2, owner laptop).** GPU `light` pass <= 0.3 ms (38,400 x [8 x ~25 flops + 8 `LVIS` fetches + sun <= 48 steps, typ. 5-10, 2 fetches each]); whole pipeline stays <= 4 ms p95 (14.2 item 6 + 0.3). JS: `LightSet.update` <= 0.05 ms, uniform upload <= 0.02 ms, dirty `LVIS` rows only; hook total <= 0.45 ms; frame JS <= 2 ms unchanged. Fallback (160x60, CPU): `lightSurfaces` with the 4 nearest `on` lights + sun, target <= 1.5 ms (N.L skip ~40 % of cells), not a hard budget (D-009 item 5: playable). VRAM: `LIGHT` 614 KB, `LVIS` <= 64 KB.

**7. Parity and oracle.** `?gpucompare=1` (160x60, n = 1) also reads back `LIGHT` (uint `readPixels`, test-only) and reports: `|dL| <= 1e-3` per channel on cells with equal sunlit flag (float32 vs float64 on ~10 flops per light), sunlit-flag mismatch <= 0.5 % of `kind != 0` cells (edge flips at boundary steps), then the US-029 glyph/fg/bg thresholds with lights and sun on and off. `shadetest` rows use `fb.light` per cell; `bench-cast.mjs` prints a `light` line (JS reference). The JS reference is the oracle; the GLSL never invents a rule the JS lacks. Determinism check: two `gpucompare` runs at the same `timeSec` sequence produce byte-identical `LIGHT`. **Debt (US-006/US-007 reviews):** the `LIGHT` readback (`|dL|`, sunlit-flag mismatch) and `?debug=light`/`?debug=sun` are not implemented yet; the shaded-output thresholds with lights and sun on are the accepted M1 proof. Open a small follow-up story before the M1.5 editor (they are its stable debug views).

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
- Uniforms: `uTerrainMaxH` (max of `farHDraw`), `uFarMap` = `vec4(x0, y0, cell, size)`, `uSunDir` (unit vector toward the sun; US-007 owns it, until then the compositor derives it from the level's `sun`), `uTerrainLight` = (ambientI, sunI), `uFogFar` = (start 50, full 1500, curve 0.7, hazeCut 0.85), `uFogFarNear` / `uFogFarColor` rgb, `uRiverLight` rgb, `uTimeSec`, `uStruct*` (14.2) for the bbox skip.

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

**6. JS oracle and CPU fallback: `castTerrain(fb, terrain, cam, opts)`** (`engine/render/terrainCaster.js`, exported). For every cell of every open span (`fb.spans`, rows with `depth == Infinity` only): the same ray as `castColumn`'s centre ray (`n = 1` offsets), the same march (item 4) in float64 over `farHDraw` with `util.gridHeight`-equivalent bilinear; writes `fb.gbuf.writeSample(...)` and `fb.depth`. No allocation (module-level scratch: skip intervals `Float64Array(16)`, one hit record). `opts = { sun: {dir, ambientI, sunI}, stepMin = 3, stepK = 0.03, maxSteps = 128, timeSec }`; the CPU path passes `stepMin 6, stepK 0.06, maxSteps 64` (playable, not equal; D-009 item 5). Pure helper `marchTerrainRay(terrain, ex, ey, eyeH, dx, dy, slope, tMax, skips, nSkips, opts, out) -> boolean` is the unit-test surface. Until `farReady` terrain is not drawn (sky only); no haze-only special case is needed because `skyHorizon == fogFar`.

**7. Far tower = a world billboard entity, not terrain code.** `world_m1.js` gets `{ id: 'farTower', type: 'billboard', x: 713.8, y: 1232.1, z: <ground>, model: 'farTower', unlit: true, fogModel: 'far', fogMax: 0.40, sizeM: {w: 14, h: 42}, minCells: {w: 3, h: 4}, detailRows: 12 }`; the silhouette moves to `design/models/far_tower.js` (frames `min` 3x4 and `detail` 5x8; the recipe keeps `farTower.model = 'farTower'`). `projectSprite` (shared by pass F and `drawSprites`) gains: `minCells` clamp (after LOD), frame choice by projected rows >= `detailRows`, `unlit` (light = 1, no N.L), per-sprite `fogF` + `fogRGB` computed in JS (`fogModel: 'interior' | 'far'`, `fogF = min(fogMax, f)`), so the sprite shader stays fog-model-agnostic (US-030 owns the `SPR` texel layout; extend to 3 texels if needed). The depth test against `DEPTH` now includes terrain. US-022 never touches this entity.

**8. Fallback and gating.** Terrain program fails to compile/link -> the whole frame takes the CPU path at `cpuGrid` (14.2 item 7; no mixed GPU-sectors/CPU-terrain mode). `terrain == null` or `!farReady` -> pass A2 skipped, resolve reads set 1. `?terrain=0` (parsed in `game/js/main.js`) skips terrain on both paths for A/B benches.

**9. Parity (`?gpucompare=1`, extended).** Poses: `tools/bench-poses.js` adds `breach` (summit eye 7.6 m, yaw 270, pitch 0), `breachDown` (pitch -30), `parapetSky` (pitch +20), `ringLook` (looking down at the outer ring from the bastion). `timeSec` fixed to 0 in compare mode. Thresholds as 14.2 item 8, plus terrain-specific: kind-7 cell count within 1 % between paths; `mat` equal and depth within 1 % on matched terrain cells; glyph >= 99 % excluding 4-neighbour-kind edge cells and excluding kind-7 cells whose `t` lies within 1 % of a band edge (150/600) or whose `b` lies within 0.01 of 0.45/0.8 (float32 tier flips, 14.1 rule 5).

**10. Do not:** sample terrain inside a structure bbox; march beyond `FOG_FULL`; use hardware filtering on the height texture; key any hash on the screen cell; upload `FARH`/`FARTYPE` per frame; give terrain cells per-grid-cell planeIds; bake lighting `b` into a texture (the sun is a uniform; normals are computed at the hit only); put recipe constants (bands, fog, glyph sets) in GLSL source - they arrive through `TLOOK`/uniforms from the registry.

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

## Refactor candidates (2026-09-24)
Architect survey for D-006/D-010 reuse; ordered by value for cost. Candidate stories only, the PO schedules them.

1. **Engine-owned frame renderer (`createWorldRenderer`)** - *why:* the per-frame orchestration (fb assembly: GBuffer/MaterialTable/light buffer/`gpuDda`; `syncEntityLights` + `lights.update`; `renderWorld` vs `gpuPipeline.frame` choice incl. the `rt.gpuActive` context-loss rule; sprites; `present`) lives in `game/js/main.js` `runGame`/setup (~150 lines). The M1.5 editor (D-010) would have to copy it, including the subtle ordering rules. Target: `renderer.frame(world, camPose, timeSec)` + `renderer.stats`, overlay/crosshair stay caller-side. *Files:* new `engine/render/WorldRenderer.js`, `engine/index.js`, `game/js/main.js`. *Size:* M. *Risk:* medium (render ordering, context restore; covered by `?gpucompare=1` + Node tests). *Wait:* none; **must land before the M1.5 editor stories**.
2. **Split `game/js/main.js` (973 lines) into bootstrap + dev modes** - *why:* bench, shadetest, `gpucompare=1|shade`, flicker, glyphs, demo harnesses (~500 lines) are mixed with the game bootstrap; main.js also imports `tools/bench-poses.js` (game -> tools direction). Target: `game/js/dev/modes/*.js` with a `{ name, run(ctx) }` table, main.js ~250 lines; move the pose list to a shared data file both `tools/` and `game/` may read (or have check-deps allow it explicitly). *Files:* `game/js/main.js`, `game/js/dev/*`, `tools/bench-poses.js`, `tools/check-deps.mjs`. *Size:* S-M. *Risk:* low (URL-flag smoke test per mode). *Wait:* do after item 1 (it shrinks `runGame` first).
3. **Two-tier public API: `engine/index.js` (stable) + `engine/dev.js` (harness/internals)** - *why:* index.js mixes the editor-facing API with pass internals and parity tooling (`beginFrame/castSectors/fillSky/computeDerivatives/shadeSurfaces/edgePass`, `runShadeTest`, `runGpuCompare/compareCells/poison*`, `Input/PlayerLook` "may change"). A second client (editor, other games) can't tell what is stable. *Files:* `engine/index.js`, new `engine/dev.js`, `tools/check-deps.mjs` (+ fixture test), section 5 of this doc. *Size:* S. *Risk:* low. *Wait:* none; best done together with item 1 (which removes most pass internals from main.js's import list).
4. **D-017 pruning of fallback-only code** - *why:* JS is now oracle only. Candidates: `cpuLightCap` + `selectCpuLights` (lighting.js), the legacy inline-shade path (`?detail=0`, `fastShade.js` 354 lines, a speed-only duplicate of the reference shading; keep `buildPowLUT` or move it), `cpuGrid` forcing, and later the frozen Canvas2D presenter (`RenderTargetCanvas2D.js`, `force2d` through `engine.js`/`RenderTarget.js`). Fewer paths = smaller API for the editor and one shading reference to keep in parity. *Files:* `engine/render/{lighting,fastShade,sectorCaster,MaterialTable,RenderTarget,RenderTargetCanvas2D}.js`, `engine/core/engine.js`, `tools/bench-cast.mjs`, affected tests. *Size:* M. *Risk:* medium (oracle must stay bit-identical under `?gpucompare=1`; bench numbers change meaning). *Wait:* PO must first strip the CPU perf ACs per D-017 consequences; Canvas2D removal is a separate later step (D-017 item 4).
5. **Shared JS helpers and test kit** - *why:* `clamp/clamp01/clampByte/approach` duplicated in Player, integrate, detailShade, fastShade, sectorCaster, World; `ok/approxEqual/assert` re-declared in ~22 test files. Target: `engine/core/math.js` (internal, not exported) + `engine/test/assert.js`. GLSL already shares `glsl/common.js`; no action there. *Size:* S. *Risk:* very low. *Wait:* none; good filler story, do after item 4 so deleted files are not touched.
