# Coordinates, frames, transforms and saves (architect, 2026-09-26; owner request after BUG-OWN-008)

Status: **proposal / design + audit, no code changed.** Normative once the manager records the two decisions in section 12. Extends architecture.md 4 (conventions), 7 (world), 10 (serialization), 21 (content), 23/26 (terrain), 24.7-24.10 (editor). Where this file and older sections differ, this file wins after adoption.

Owner's complaint: "do the coordinates, saves and everything like in a real game engine, because now it is really buggy". Diagnosis: the conventions in architecture.md 4 are right and consistent, but they are **re-implemented by hand in ~50 places** (audit below). Every consumer does its own `+ origin` / `- origin`, decides "is this world or local?" by a string prefix or a `structId == null` test, and copies the yaw trig. There is no `Frame` type, no single conversion function, rotation (`yawSteps`) is stored but never applied, the sun lives in a level file although it is a world property, and the recipe carries a second copy of the tower placement that nothing checks. Bugs come from mixing frames, exactly as the owner says; BUG-OWN-008 was one of them (a caster running in level-local space with no idea where the world ground is).

## 1. Audit: every frame conversion in the code today

Legend for "risk": **H** = has caused or will cause a visible bug; **M** = correct today, breaks with a rotated structure, a second placement of the same level, a non-zero `origin.z`, or a second copy of the math drifting; **L** = fine, but should call the shared helper so there is one formula.

### 1.1 Engine

| File:line | Converts | Risk |
|---|---|---|
| `engine/world/World.js:36-44` (`makeRingHAt`) | world -> level-local (`x - origin`), `floorH + origin.z` | M: no rotation; mirrors `recipe.structures[i]` which duplicates the placement |
| `World.js:211` | `def.structures[].origin/yawSteps` -> `placeStructure` | H: `yawSteps != 0` throws; content can express a rotation the engine refuses |
| `World.js:235-237` | bbox centre -> chunk coords `floor(c / chunkSize)` | M: 4th copy of the chunk formula (Terrain.js 164/338, recipe override keys) |
| `World.js:254-256` (interactables) | level-local `x,y,z` + origin | M: no rotation; one of 9 copies of `+ s.origin` |
| `World.js:317-329` (props) | local `x,y` + origin; `z: 'ground'` -> `groundAt`, else `origin.z + z`; `facing` copied as world yaw | M: yaw not rotated; `'ground'` is a resolution rule hidden in a coordinate field |
| `World.js:385-395` (world entities) | inline world `x,y,z`, `'ground'` | L |
| `World.js:417-425` (`spawn.from: 'start'`) | `level.start` local -> world, `floorAt(local) + origin.z`, `facingDeg` unrotated | M |
| `World.js:457` | bbox = origin + `[0,w]x[0,h]` | M: wrong for odd `yawSteps` |
| `World.js:468-481` (`structTable`) | origin/yawSteps/cellSize per slot | M: `yawSteps` stored, never consumed anywhere |
| `World.js:502-520` (`sectorAt/floorAt/ceilAt`) | world -> local, `+ origin.z` | M: 3 copies |
| `engine/world/triggers.js:92-95, 144-145` | circle local + origin / cell mask tested against `actor - origin` | M: masks are local cell indices; unrotated |
| `engine/world/interaction.js:47-51` | world -> local sector, `floor/ceil + origin.z` | M: copy #4 of the sector query |
| `engine/world/serialize.js:55-56, 154` | `origin`/`yawSteps` copied to/from `WorldState` | L: no version migration chain exists (`version !== 1` = throw) |
| `engine/render/compositor.js:96` | `castSectors(fb, level, cam, s.origin)` | L |
| `engine/render/sectorCaster.js:337, 366` | camera -> level-local (`posX = cam.x - origin.x`, `eyeH = cam.z - origin.z`) | H: the whole DDA runs in a frame that does not know the world ground -> BUG-OWN-008 (fixed by a ground rule; the frame mix remains) |
| `sectorCaster.js:274` | direction -> compass deg `atan2(dx, -dy)` | L: copy 1/4 |
| `engine/render/lighting.js:343-350` | **sun read from `structures[0].level.def.sun`** | H: a world property stored in a level file; rotates with the level if we ever rotate; second structure ignored |
| `lighting.js:365` | light local + origin | M |
| `lighting.js:723-769` | sun grid: world -> local `x - origin`, `h0 - origin.z`, `worldMaxH = origin.z + maxH` | M: correct, 3 hand-written subtractions |
| `lighting.js:257` | azimuth/elevation -> sun dir | L: same trig as the forward vector, own copy |
| `engine/render/gpu/WorldTextures.js:37` | `uStruct` = origin.xyz, w, h, yOffset, seq, maxH | M: no `yawSteps` -> GLSL cannot rotate; must stay translation-only (see 5) |
| `gpu/glsl/dda.frag.js:172, 191` | `lx = uPosX - A.x`, `leyeH = uEyeH - A.z` + ground rule | H (same as the CPU twin) |
| `gpu/glsl/light.frag.js:133-137, 169` | `S - A0.xy`, `h0 - A0.z` | M |
| `gpu/glsl/terrain.frag.js:250`, `engine/render/terrainCaster.js:92-96` | skip slabs from world bbox | L (needs axis-aligned bbox: guaranteed by 5) |
| `terrainCaster.js:142` | world -> 2 m dither cell `floor(p/2)` | L |
| `engine/world/Terrain.js:164-165, 189, 338` | chunk -> band origin, world -> near cell index, world -> chunk | M: three formulas, plus recipe `'cx,cy'` keys and 26.6 `cx_cy` file ids: two string formats for one key |
| `engine/entities/attach.js:34-39` | eye-frame offset (right/down/fwd) -> world by yaw | L: forward/right formulas re-typed |
| `engine/entities/EntityHandle.js:108`, `engine/physics/roller.js:89` | delta -> compass yaw | L: copies 2-3/4 |
| `physics/integrate.js:111`, `entities/Player.js:148`, `world/interaction.js:81`, `render/sprites.js:58`, `terrainCaster.js:60`, `gpu/GpuCellPipeline.js:1328`, `voxel/instanceRect.js:27`, `lighting.js:852` | yaw -> forward vector (inline trig) | L: 8 copies; hot paths may keep inline trig but must cite one formula |
| `physics/roller.js:172` | `tiltAt(x - origin.x, ...)`; numpad tilt chars are **local directions** | M: must rotate with `yawSteps` |
| `engine/voxel/voxelPose.js:159-170, 269-276` | entity transform -> model frame (anchor, `cellM`, yaw); mount -> world | L: the one place that is already a proper transform stack (keep as the model for the rest) |
| `engine/entities/Player.js:80` | `yawDeg = start.facingDeg` | M: unrotated |
| `engine/world/Level.js:269` comment | says `start` is "in world meters" | L: doc bug, it is local |

### 1.2 Game

| File:line | Converts | Risk |
|---|---|---|
| `game/js/main.js:444`, `game/js/dev/spritesPage.js:59` | ephemeral `?level=` world at origin 0 | L |
| `main.js:526-528` | `spawn.structure` -> `level.start.eyeH` | L |
| `main.js:962` (debug) | `rows[floor(y - oy)][floor(x - ox)]` | L |
| `game/js/quest/end.js:76-84` | `walkTo` local + origin **or** absolute by `structId == null` | H: the same field name means two frames depending on where the trigger is defined |
| `end.js:99` | delta -> compass yaw | L: copy 4/4 |
| `game/js/audio/ambient.js:71, 80, 89` | light/marker/trigger local + origin | M: 3 more copies |
| `game/js/quest/beacon.js:179` | `structures.find(id)` -> `level.def.lights` | L (content lookup, no coordinates) |
| `game/js/dev/worldTestMain.js:98`, `physicsTestMain.js:141` | compass -> **math angle** `(deg - 90) * PI/180` | M: a second angle convention lives in the repo |
| `main.js:1638`, `tools/bench-cast.mjs:490` | yaw -> dir for poses | L |

### 1.3 Content / design (data that encodes a frame)

| File:line | What | Risk |
|---|---|---|
| `design/levels/overworld_far.js:26, 29-30, 67` | `origin {1480,1018}`, `tower` centre, `structures[].x,y,w,h` | H: a **second copy of the world placement**; `content/worlds/world_m1.world.json` is the real one; nothing checks they agree (World injects `ringHAt` by id but not the bbox) |
| `content/worlds/world_m1.world.json:12,15` | `origin` + `yawSteps`, `spawn.from: 'start'` | L (the canonical placement) |
| `design/models/title.js:401` | hint coordinates "tower-local metres" by comment | M: frame documented in a comment only |
| level files (`content/levels/*.level.json`) | `sun`, `props/lights/interactables/triggers` local; `sun` is world | H (see lighting row) |

### 1.4 Editor (`tools/editor`)

| File:line | Converts | Risk |
|---|---|---|
| `doc.js:83-88` (`toLocal/toWorld`) | translation only ("M1 never rotates") | M: the only editor conversion; no rotation |
| `doc.js:127`, `select.js:98`, `main.js:293-301` (`originForFile`) | finds the structure **by level name** (`st.level.name === levelId`), falls back to origin 0 | H: wrong or silent zero with two placements of one level, or a renamed level |
| `livepatch.js:84-90, 128-133`; `main.js:316, 469, 501, 539, 955` | frame chosen by `fileId.startsWith('world/')` (`isWorldSpace`) | M: 6 string tests decide the frame |
| `main.js:467-477` (nudge), `499-505` (drop: `floorZ - origin.z`), `539` (teleport), `756` (place), `954-958` (drag end) | world <-> local | M: 5 sites, each with its own branch |
| `pick.js:119, 161-162`; `select.js:100, 133, 137` | local + origin for markers and picks | M: 5 copies |
| `camera.js:31-33` | start pose from origin + level size | L |
| `tools/bb-import.mjs:154, 344` | Blockbench origin/pivot -> voxel units | L (importer, model frame) |

Count: **~50 conversion sites, 0 shared helpers** (except `voxelPose.js`, which is done right).

## 2. Frames (normative)

One world frame, as D-007 / architecture.md 4. Restated here as the single source, with the frame catalogue that every object type belongs to.

- **World frame `W`:** metres; **x east, y south, z up**; right-handed (`x cross y = z`). Everything the renderer and physics read is in `W`.
- **Yaw:** compass degrees, `0 = north (-y)`, `90 = east (+x)`, clockwise seen from above, stored in `[0, 360)`. `forward(yaw) = (sin yaw, -cos yaw)`, `right(yaw) = (cos yaw, sin yaw)`. Rotation of a vector by yaw `t`: `(x, y) -> (x cos t - y sin t, x sin t + y cos t)`. **Pitch** positive up, camera/eye only. **Roll** does not exist. Sun `azimuth` = compass direction the light comes from. There is **no math-angle convention anywhere**; dev harnesses convert through the helper.
- **Quarter turns:** `yawSteps in {0,1,2,3}` = `yawDeg = 90 * yawSteps` with exact `cos/sin` from a table (`[1,0,-1,0]`, `[0,1,0,-1]`), so rotated cell corners stay exact integers.
- **Heights:** `transform.z` = feet / model anchor; camera `z` = eye; sector `floorH/ceilH/topH` = level-local metres above the structure frame's `z`.

| Frame | Parent | Units | Who owns the transform | Stored where |
|---|---|---|---|---|
| `W` world | - | m | - | - |
| `S` structure frame = `Frame {x,y,z,yawSteps}` | `W` | m | `World` (`placed.frame`) | content `world.structures[].origin + yawSteps`; save = reference by id |
| `L` level-local (cell grid, `rows[row][col]`, cell `[col,col+1) x [row,row+1)`) | `S` | m (1 cell = 1 m) | `Level` | level file: everything in it (`props`, `lights`, `interactables`, `triggers`, `start`, `layers`, `markers`) |
| `E` entity = `{x,y,z,yawDeg}` (+ `pitchDeg` for eyes) | `W` (optional `parent: structId` is a **record**, not a live parent) | m | entity data | save `entities[].transform`, always `W` |
| eye | `E` | m | `Camera.fromEntity` (`z + eyeH + feel.offset`, yaw/pitch of the entity) | never stored |
| attach (carried light) | eye | m: `right/down/fwd` | `attach.js` | content `components.light.offset` |
| `M` model (voxel) | `E` | voxel units, `cellM`, `anchor` | `voxelPose.computeVoxelPose` | model file |
| part | `M` or parent part | voxel units, pivot | `voxelPose` (`FORWARD`) | model file (`parts`, clips) |
| mount | part | voxel units | `voxelMountWorld` | model file (`mounts[].at, part`) |
| terrain chunk `(cx, cy)` | `W` | `cx = floor(x / chunkSize)` | `Terrain` | recipe overrides key `'cx,cy'`; chunk file id `<world>/<cx>_<cy>` |
| terrain cell (near 2 m / far 8 m) | band `(x0, y0)` | `i = floor((x - x0) / cell)`, sampled at the cell centre | `Terrain` | never stored |
| screen | camera | cell col/row | `projection` (arch 4) | never stored |

Hierarchy: **World -> Structure -> (Level grid, content items) ; World -> Entity -> Model -> Part -> Mount ; World -> Terrain -> Chunk -> Cell.** An entity spawned from a level prop records `parent = structId` so tools can go back to the level file; at runtime it is a free world entity (structures never move at runtime; the editor rebuilds the world on a structure edit, 24.8).

## 3. `engine/core/transform.js` - the one conversion module

Pure functions, allocation-free (caller-owned `out`), no engine imports besides itself. Public through `engine/index.js`. JSDoc typedefs are normative.

```js
/** @typedef {{x:number, y:number, z:number, yawSteps:0|1|2|3}} Frame   rigid quarter-turn frame (structures, chunks) */
/** @typedef {{x:number, y:number, z:number, yawDeg:number, pitchDeg?:number}} Transform   entity / camera pose, world metres */
/** @typedef {{x:number, y:number, z:number}} Vec3 */

export const DEG2RAD = Math.PI / 180, RAD2DEG = 180 / Math.PI;
export const QUARTER_COS = [1, 0, -1, 0], QUARTER_SIN = [0, 1, 0, -1];   // exact

// ---- angles (the only place the compass convention is spelled out) ----
export function wrapDeg(deg)                       // -> [0, 360)
export function shortestArcDeg(fromDeg, toDeg)     // -> (-180, 180]
export function yawFromDelta(dx, dy)               // -> wrapDeg(atan2(dx, -dy) * RAD2DEG)    (replaces 4 copies)
export function forwardOf(yawDeg, out)             // out[0] = sin, out[1] = -cos             (Float64Array(2) or any 2-slot)
export function rightOf(yawDeg, out)               // out[0] = cos, out[1] = sin
export function rotateVec2(yawDeg, x, y, out)      // vector rotation by yaw
export function dirFromAzEl(azimuthDeg, elevationDeg, out)   // (sin az cos el, -cos az cos el, sin el) - sun, horizon billboards

// ---- Frame (local <-> world; rotation about the frame origin, then translation) ----
export function makeFrame(x, y, z, yawSteps = 0)                 // validates finite x/y/z, integer yawSteps 0..3; returns a plain object
export function localToWorld(frame, lx, ly, lz, out)             // out.x = f.x + c*lx - s*ly; out.y = f.y + s*lx + c*ly; out.z = f.z + lz
export function worldToLocal(frame, wx, wy, wz, out)             // exact inverse (integer table, no float drift)
export function localDirToWorld(frame, dx, dy, out)              // rotation only
export function localYawToWorld(frame, yawDeg)                   // wrapDeg(yawDeg + 90 * yawSteps)
export function worldYawToLocal(frame, yawDeg)
export function frameBBox(frame, w, h, out)                      // axis-aligned world AABB of local [0,w) x [0,h): {x0,y0,x1,y1}; integers stay integers
export function rotatedSize(yawSteps, w, h, out)                 // {w, h} (swapped for odd yawSteps)
export function localCellToWorld(frame, col, row, out)           // world cell (integer col/row of the rotated grid) - see 5 for the mapping
export function frameEquals(a, b)

// ---- Transform sugar (entities/cameras; no matrices - yaw-only bodies do not need them) ----
export function transformPoint(t, lx, ly, lz, out)               // yaw rotation + translation (eye/attach/model helpers build on it)
```

Rules:
- **No 4x4 matrices in the public API.** Bodies are yaw-only, structures are quarter-turn-only; the closed forms above are exact and allocation-free. `voxelPose.js` keeps its 3x3 affine internally (it needs pitch/roll per part); it is the only matrix user and it must call `forwardOf`/`rotateVec2` for the entity yaw so the formula is shared.
- Hot loops (sector DDA setup, terrain caster, sprites, GLSL) may keep inline `sin/cos` for the camera, but the comment must cite this file, and a Node test checks each against `forwardOf` for 8 yaws (bit-identical: same expression order).
- Every other `+ origin`, `- origin`, `atan2(dx, -dy)`, `yawDeg * Math.PI / 180` outside a hot loop is replaced by these calls. `tools/check-deps.mjs` gains a grep rule (warn, not fail): `atan2\(.*-` and `\* Math\.PI / 180` outside `engine/core/transform.js`, hot-loop files listed in an allow-list.

## 4. Per-object frame ownership (what is stored local, what world)

| Object | Content (JSON) coordinates | Runtime (engine objects) | Save (`WorldState`) |
|---|---|---|---|
| Placed structure | world file: `origin {x,y,z}` + `yawSteps` = a `Frame` (kept flat for schema 1 compatibility) | `placed.frame` (authored), `placed.level` (**baked**: rotated grid, see 5), `placed.origin` = baked grid origin (= `frame.x/y/z` when `yawSteps = 0`), `placed.bbox` | `{ id, level, origin, yawSteps, dynamics }` - a reference + state; never coordinates of its content |
| Level grid, `layers.*`, `start`, `markers`, `route` | level file, `L` | baked into the placed level (`L'` = translation-only) | never |
| Level `props/lights/interactables/triggers` | level file, `L` (`x,y,z`, `facing`, `cells`, circle `x,y,r,zMin`) | converted **once at load** through `localToWorld(placed.frame)` / `localYawToWorld` into world-space runtime records (`world.interactables[]`, `LightSet`, `TriggerRec`, entity transforms) | props: as entities (world transform + `parent`); lights/triggers/interactables: state only (`state['used.*']`, `dynamics`) |
| `z: 'ground'` | allowed on level props, world entities, chunk entities | resolved once to a number via `world.groundAt` at spawn; `transform.z` is always a number | number |
| Level `sun` | **moves to the world file** `sun {preset, elevation, azimuth}`; a level `sun` is only used by an ephemeral `?level=` world (console.info once) | `LightSet.sun` | `time` only (sun is content) |
| World entities (`entities[]`, chunk `entities[]`) | `W`: `x,y,z|'ground'`, `yawDeg` or `transform`; `spawn: {structure, from:'start'}` = "resolve from that structure's frame" | `transform` in `W`; `parent` = structId when spawned from a level prop or `spawn.structure`, else `null` | `transform` in `W`, `parent` |
| World `triggers[]`, `bounds`, `horizon[]` | `W` | `W` | copied (content, not state) - as today |
| Trigger `walkTo` / `lookAt` / any position field in a behaviour def | **in the frame of the file it is written in** (level file = `L`, world file = `W`); the engine passes `ctx.frame` (`placed.frame` or `null`) to behaviours; game code calls `localToWorld(ctx.frame, ...)` when `ctx.frame` is set | - | - |
| Terrain overrides (stamps/paints) | `W`, keyed by chunk `'cx,cy'` | recipe | copied (as today) |
| Model / part / mount | model file, voxel units | `voxelPose` | never |
| Camera | never in content (poses in `tools/bench-poses.js` are `W`) | `CameraPose` in `W` | not saved (derived from the player entity) |

## 5. Structure rotation (`yawSteps` 1-3): bake at placement, never per ray

Decision: the renderers (CPU DDA, GLSL DDA, light DDA, terrain skip slabs, packed atlas) stay **translation-only**. `World.placeStructure(levelDef, frame)` does, once, at load:

1. `level = loadLevel(def)`; if `frame.yawSteps != 0`: `level = rotateLevel(level, yawSteps)` (`engine/world/rotateLevel.js`, pure, returns a new `Level` whose grid is rotated; `yawSteps = 0` returns the same object, bit-identical path).
2. `origin` (baked grid origin) = min corner of `frameBBox(frame, w, h)`, `z = frame.z`; `bbox = frameBBox(...)`; `packed = packLevel(level)`; `structTable`/`uStruct` get the baked `origin` and rotated `w/h` (`yawSteps` slot stays for tools; GLSL never reads it).
3. Content items are converted with the **authored** `frame`, not the baked origin (3, 4). The invariance test in 10 pins the two paths to each other.

`rotateLevel` mapping (normative; `k = yawSteps`, `w x h` in, `w' x h'` out, `rotatedSize`): a local point `p` maps to `p' = R(k) p - minCorner(R(k) [0,w]x[0,h])`. For `k = 1`: `p' = (h - y, x)`, `w' = h`, `h' = w`, cell `(col, row) -> (col' = h - 1 - row, row' = col)`, i.e. `rows'[col][h - 1 - row] = rows[row][col]`. `k = 2`: `(w - 1 - col, h - 1 - row)`. `k = 3`: `(col' = row, row' = w - 1 - col)`. Applies to `rows`, every `layers.*` grid, `start` (`x,y` by the point map, `facingDeg + 90k`), `tilt.hollowCenter` (point map) and the numpad tilt chars (rotate the direction: `8->6->2->4->8`, `7->9->3->1->7` per step; `5`, `.` unchanged), `markers`/`route` cells, and `legend` unchanged (legend entries are per cell, not per face - MAP_FORMAT 2.7 is a face *rule*, not data). `level.def` keeps the raw unrotated def (tools read it; nothing at runtime reads cell coordinates from `def` after this change - the audit rows for triggers/props/lights all go through `frame`).

Why bake: the DDA, the packed atlas, the sun grid, the terrain skip rectangles and `uStruct` all assume an axis-aligned unit grid; rotating rays per structure would touch 2 casters + 3 GLSL programs + parity, for a 90-degree-only feature. Baking costs one grid copy per placement (tower: 336 cells) and zero per-frame work. Godot/Unity do the same for static batching.

## 6. Render and physics consume world-space data prepared at load/update

- `castSectors(fb, placed)` gets the placed structure (baked level + baked origin). The caster may translate the camera into the baked grid frame (`cam - origin`, translation only) **but must carry the world ground reference in** (`OUTSIDE_SECTOR` floor from 23.9 stays; the ground rule is a world-frame fact expressed in the grid frame by one subtraction at setup, never inside the column loop).
- `LightSet`, `world.interactables`, `world.triggers`, entity transforms, `world.bounds`, `horizon` are world-space at load. Physics (`World.sectorAt/floorAt/ceilAt/outsideSector`, `roller.tiltAt`) query the baked grid through `World.gridLocal(placed, x, y, out)` (one function; today's 4 copies).
- Terrain: `Terrain.chunkOf(x, y, out)`, `Terrain.chunkKey(cx, cy) -> 'cx,cy'`, `Terrain.chunkFileId(worldId, cx, cy) -> '<world>/<cx>_<cy>'`, `Terrain.nearCellOf(x, y, out)`. `World.load` band centring, `setNearCenter`, override lookup, 26.6 streaming all call these; no `floor(x / 128)` elsewhere.
- Nothing per frame allocates or re-derives a frame: budgets in D-007/16 unchanged (the change is load-time only).

## 7. Editor edits through the same API

- A selection carries `{ fileId, collection, id, structId | null }`. `structId` comes from the runtime entity id prefix or the pick (the structure under the cursor), never from the level name. `originForFile` is deleted.
- `frameFor(selection) = structId ? world.frameOf(structId) : null`; `null` = the item is already in `W`. `isWorldSpace` and the `startsWith('world/')` tests are deleted; `doc.js` `toLocal/toWorld` are deleted in favour of `localToWorld/worldToLocal` from `engine/index.js` (with `frame = null` = identity).
- Nudge, drag, drop-to-floor, teleport, place and marker/pick projections all go: item (file frame) -> `localToWorld(frame)` -> operate in `W` -> `worldToLocal(frame)` -> item. Yaw on a level prop is stored local (`facing`); the panel shows the world yaw read-only.
- Structure `yawSteps` becomes editable (0..3) once 5 lands: a structure edit is a full `rebuild()` (24.8). `-0` normalised, snap in `W`.
- Save/validate unchanged (24.10); `validateDoc` additionally runs the content rules in 8.

## 8. Content vs save format, versions, migration, byte stability

**Content (schema 1, additive; no bump):** world file gains optional `sun` (moves out of the level file in the same content commit; a level `sun` is warned as deprecated by `validate-content`); `structures[].yawSteps` may be 1-3. `validate-content` rules: `origin.x/y/z` finite, `yawSteps` integer 0..3, every `z` is a number or `'ground'`, level items inside `[0,w) x [0,h)` (error), level file HAS `sun` (warning, deprecated - it belongs in the world file now), world with terrain but NO `sun` (warning - a real gameplay world should have one; polarity corrected 2026-09-30, CO-8, was previously stated backwards). Recipe (`overworld_far.js`) loses `origin`, `tower`, `structures[].x,y,w,h`: `World.load` injects `bbox` and `ringHAt` per placed structure by id (today it injects only `ringHAt`), so the placement has exactly one source.

**Save (`WorldState`) version 2** (`engine/world/serialize.js` + new `engine/world/migrateState.js`, same shape as `content/migrate.js`: `MIGRATIONS = [v1->v2]`, pure, `structuredClone` once, older = migrate, newer = throw):
```jsonc
{ "version": 2, "world": "world_m1", "contentVersion": 1,
  "terrain": { "recipe": "overworld_far", "seed": 7331, "overrides": {} },
  "structures": [ { "id": "tower", "level": "tower", "origin": {"x":1480,"y":1018,"z":0}, "yawSteps": 0, "dynamics": {} } ],
  "entities":   [ { "id": "tower.brazier", "type": "prop", "parent": "tower", "transform": {"x":..,"y":..,"z":..,"yawDeg":..,"pitchDeg":0}, "components": {}, "fromContent": true } ],
  "state": {}, "nextId": 3, "time": {"timeOfDay": null}, "removed": [], "horizon": [], "bounds": null, "triggers": [] }
```
- v1 -> v2 migration: add `parent` (from the `<structId>.` id prefix against `structures[]`), nothing else. `deserialize` accepts 1 and 2; `serialize` writes 2.
- **Saves hold world coordinates only.** A save never holds a level-local number and never holds content (D-023). `structures[]` in a save is a reference + `dynamics`; on load the frame comes from the save (so a moved structure in newer content does not teleport saved entities - the 21.8 id rules stay).
- **Byte-stable:** `serialize` returns a plain object with a fixed key order (`KEY_ORDER.save` in `content/schema.js`, same stringifier as content: `stringifyContent({kind:'save', ...})`); test `stringifyContent(serialize(deserialize(s))) === stringifyContent(s)` for a save with `yawSteps 0..3`, a structure at `z = -3`, and `'ground'` props. Positions are copied exactly (no rounding), `-0 -> 0`.

## 9. Do-not list

1. Do not write `+ s.origin.x` / `- s.origin.y` / `origin.z +` anywhere outside `engine/core/transform.js` and `World.gridLocal`. Grep-enforced (check-deps warn rule).
2. Do not decide a frame from a string (`fileId.startsWith('world/')`, `structId == null`, id prefixes). The frame is a value (`Frame | null`) passed explicitly.
3. Do not look up a structure by level name. By `id` only (two placements of one level are legal).
4. Do not store a world property in a level file (`sun`) or a placement in a recipe.
5. Do not read `yawSteps` in a renderer or in GLSL; rotation is baked. Do not add rotation to `uStruct`.
6. Do not put a level-local coordinate into a save, or a runtime-resolved value (`'ground'` -> number) back into content.
7. Do not add a math-angle (`-90`) conversion; use `forwardOf`/`yawFromDelta`.
8. Do not re-derive frames per frame or per ray; no allocation in `localToWorld` & co. (out params).
9. Do not introduce 4x4 matrices or a general parent chain for entities; `parent` is a record. (Escalate if a story needs riding platforms / moving structures.)
10. Do not bump `version`/`schema` without a migration entry and its test; do not migrate in place (clone once).

## 10. Test strategy

Node, in `engine/core/transform.test.js`, `engine/world/rotateLevel.test.js`, `engine/world/frame.test.js`, `engine/render/sectorCaster.invariance.test.js`, `engine/world/serialize.v2.test.js`, `tools/editor/frame.test.mjs`:

1. **Round-trip property tests:** 10k seeded random points, frames with `yawSteps 0..3`, `x/y/z` in `[-2000, 2000]` incl. non-integers: `worldToLocal(localToWorld(p)) === p` **exactly** for integer frames (table trig), `<= 1e-9` otherwise; `localYawToWorld/worldYawToLocal` inverse; `frameBBox` equals the AABB of the 4 rotated corners; `forwardOf` matches the inline expressions in the 8 hot-loop files (a test imports each file's exported helper or re-types the expression with a citation).
2. **rotateLevel:** for every `k`, every cell: `localCellToWorld(frame, col, row)` of the rotated grid contains `localToWorld(frame, col + 0.5, row + 0.5)` of the original; `rotateLevel(rotateLevel(L, 1), 3)`-style compositions equal `rotateLevel(L, 0)` cell-for-cell; tilt chars rotate; `start.facingDeg` rotates; `k = 0` returns the same object.
3. **Rotated structures 1-3 through the world:** place the tower with `yawSteps k`; for each level prop/light/interactable/circle trigger the world position lies in the world cell that the baked grid maps to the same original cell; `floorAt/ceilAt/sectorAt` at the rotated positions equal the unrotated values; `tiltAt` direction rotates by `90k`; trigger cell masks fire at the rotated cells; `spawn.from: 'start'` yaw = `facingDeg + 90k`.
4. **Non-zero / negative z, below terrain:** tower at `z = -3` in a no-terrain world and at `z = +5`: `floorAt` shifts by `z`, sun visibility (`sunVisible`) unchanged relative to the structure, lights/interactables/triggers shift by `z`, a `'ground'` prop keeps the terrain height (does **not** shift), `walkTo` in a level trigger shifts, a world trigger does not.
5. **Render invariance:** a no-terrain world with the tower placed at `A = (0,0,0)` and `B = (1480, 1018, -3)` (also `B' = (513.25, -77.5, 4)`): render from the same *relative* camera (`cam_B = localToWorld(frame_B, worldToLocal(frame_A, cam_A))`, same yaw + 90k, same pitch): `rt.cells` and `depth` **bit-identical** (CPU path; both `detail` on/off), incl. one pose outside the footprint (the BUG-OWN-008 class) and one with `yawSteps 1..3` and the camera yaw rotated by `90k`. Voxel props and sprites included (entity transforms rotate with the frame). GPU path: `?gpucompare=1` stays 31/31 (tower is `yawSteps 0`, baked path is identity); a second gpucompare world with the tower at `yawSteps 1` is added when the first rotated structure ships as content (26.7 pose list).
6. **Saves:** v1 fixture (today's output) migrates to v2 with `parent` filled; `deserialize(serialize(w))` deep-equal and byte-equal through `stringifyContent`; a v3 save throws with the version in the message.
7. **Editor:** nudge/drag/drop/place on a level prop under a `yawSteps 1` structure edit the local item by the rotated delta; a world entity edits unchanged; two placements of `test_room` in one world select the right one.
8. **Content:** `validate-content` fixtures for each new rule; `export-content` round-trip unchanged (no key changes to existing content besides `sun`).

## 11. Migration plan (small stories; each leaves 92 suites + check-deps + `?gpucompare=1` green)

Ordering principle: helpers first (pure additions), then consumers switched one file group at a time with *identical* numeric expressions (no image change), then the new capability (rotation) behind `yawSteps = 0` identity, then tools. gpucompare cannot move until CO-4, and CO-4's `k = 0` path is the unchanged object.

| # | Story (tag) | Size | Adds | Replaces / touches | Green-keeping |
|---|---|---|---|---|---|
| CO-1 | `engine/core/transform.js` + tests (**PC-A**, engine/core) | 0.5 d | section 3 API, `transform.test.js`, `engine/index.js` exports, check-deps warn rule with allow-list | `EntityHandle.lookAt`, `roller.js:89`, `attach.js` forward/right, `lighting.js:257` sun dir, `Camera.js` wrap -> helpers (same expression order, bit-identical) | pure refactor; `attach.test.js`, `roller.test.js`, `lighting.test.js` unchanged |
| CO-2 | Placed-structure `Frame` + world-space load (**PC-A**, engine/world, render/lighting.js) | 1 d | `placed.frame`, `World.frameOf(id)`, `World.gridLocal(placed, x, y, out)`, `entity.parent`, `world.sun` (level fallback + info), `ctx.frame` for behaviours, `World.load` injects recipe `bbox`+`ringHAt` by id | all `+ s.origin` in `World.js`, `triggers.js`, `interaction.js`, `lighting.js:365`, `roller.js:172`; `yawSteps` still validated `0` (throw stays until CO-4) | `frame.test.js` (items 3-4 of section 10 for `k = 0`, z != 0); existing world/triggers/interaction/serialize suites unchanged |
| CO-3 | Render invariance test + ground-rule audit (**PC-A**, engine/render tests only) | 0.5 d | `sectorCaster.invariance.test.js` (item 5, `k = 0` cases incl. outside pose, z = -3/+5, sprites/voxels), lighting `sunVisible` z-shift test | none (test-only; documents the BUG-OWN-008 contract; runs against the other architect's 23.9 fix) | if it fails, that is a real bug -> BUG row, not a spec change |
| CO-4 | `rotateLevel` + `yawSteps 1..3` (**PC-A**, engine/world) | 1-1.5 d | `engine/world/rotateLevel.js`, baked `origin/bbox`, `frameBBox` use in `placeStructure`, `structTable` rotated size | the `yawSteps != 0` throw; `Level.js:269` comment | `rotateLevel.test.js` (item 2), invariance with `k 1..3` (item 5), physics equivalence (item 3); gpucompare untouched (`k = 0` identity object) |
| CO-5 | `WorldState` v2 + `migrateState.js` + canonical stringify (**PC-A**, engine/world, content/schema.js) | 0.5 d | section 8 save format, `KEY_ORDER.save`, `serialize.v2.test.js`, v1 fixture | `serialize.js` `VERSION`, `deserialize` version check | `serialize.test.js`/`serialize.contentIds.test.js` updated for `version: 2` only; `restart.test.js` unchanged |
| CO-6 | Terrain chunk/cell helpers (**PC-A**, engine/world/Terrain.js; do inside or right after US-026b S1, same file) | 0.25 d | `chunkOf/chunkKey/chunkFileId/nearCellOf` + tests (both key formats) | `World.js:235`, `Terrain.js:164/189/338`, 26.2 `setNearCenter`, 26.6 ids | `terrain.test.js` checksum unchanged |
| CO-7 | Editor frames (**PC-B**, tools/editor) | 1 d | selection `structId`, `frameFor`, `yawSteps` property (after CO-4), `coordFrame.test.mjs` (item 7; not `frame.test.mjs` - that name is taken by the shipped US-031 render-frame-sequencing module) | `originForFile`, `doc.js toLocal/toWorld`, `isWorldSpace` in `livepatch.js`/`main.js` (6 sites), `pick.js`/`select.js` copies, `camera.js` start pose | editor Node suites; one browser pass on a 95xx port |
| CO-8 | Content + game + tools cleanup (**PC-B**, content/, design/levels/overworld_far.js, game/js/quest, game/js/audio, game/js/dev, tools/validate-content.mjs) | 0.5 d | `world.sun` in `world_m1.world.json`, validator rules (section 8), `validate-content` fixtures | recipe `origin/tower/structures[].x,y,w,h` (after CO-2), `end.js` walkTo via `ctx.frame`, `ambient.js` 3 copies, `worldTestMain/physicsTestMain` `-90` math, `title.js:401` comment | `export-content`/`content-*` suites; gpucompare (sun values identical, only the file moved) |

Total: **8 stories, ~5.5-6 programmer-days**; CO-1 -> CO-2 -> CO-3 are sequential on PC-A; CO-5/CO-6 can interleave with US-026b; CO-7/CO-8 start on PC-B after CO-2 is on master (CO-7's `yawSteps` property waits for CO-4). Existing code the plan does **not** touch: the casters' column loops, GLSL, `voxelPose.js`, the packed atlas, physics integrators.

## 12. Manager decisions needed (ESCALATE TO MANAGER)

1. **Formats (D-023 is normative on formats):** `WorldState` version 2 with a migration chain (section 8), additive world-file keys `sun` and `structures[].yawSteps 1..3`, `entity.parent`, and removing the placement duplicate from the recipe. Options: (a) as specified; (b) additive keys only, keep `version: 1` (no migration exercise, `parent` optional). **Recommendation: (a)** - a save migration path is needed before the itch demo anyway, and this one is trivial.
2. **Scheduling of rotation (CO-4, ~1.5 d):** needed only when the first rotated or second structure ships. Options: (a) all 8 stories in the next sprint; (b) CO-1..3, CO-5..8 now (the bug-class fix), CO-4 with the first rotated structure content. **Recommendation: (b)**; keep the `yawSteps != 0` throw until then so content cannot silently ask for something the engine ignores.

Not a manager decision (architect/PO/designer): keeping `placed.origin` as the *baked* grid origin name (least churn in GLSL comments; `frame` is the authored one), the `sun` move (designer edits the world file), and the `validate-content` warnings.
