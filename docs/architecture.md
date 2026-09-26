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

1. **Layout:** `tools/editor/index.html` + `tools/editor/{main,camera,select,tools,panel,io,undo}.js`; imports `engine/index.js` (+ `engine/dev.js`, US-047) only, never `game/` (add a `tools/editor` fixture to check-deps).
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
- **S1 Terrain band** (`Terrain.js`, `terrain.test.js`): `bakeNearBand`, `near`, `groundAt/groundNormalAt/groundTypeAt`, `nearReady`. Tests: band == the 9 `bakeChunk` results cell for cell; `groundAt` inside == `gridHeight(near)`, outside == `heightAt`; `|groundAt - heightAt| <= 0.01` on 5000 random band points; bake <= 300 ms.
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
