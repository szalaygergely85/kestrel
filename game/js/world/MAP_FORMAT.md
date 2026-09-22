# Sector map format (US-003 v2)

Owner: Programmer (track B). Consumed by the raycaster (US-004), physics
(US-008/009), and authored by the Designer for the tower (US-010, which is
the reference for most of the v2 extensions below - see
`design/levels/tower_layout.md` section 6). Any format change goes in the
change log at the bottom and must stay compatible with `game/js/world/Level.js`.

## 1. Concept

A level is a grid of **sectors**. Each grid cell is exactly one sector: a
floor at `floorH`, a ceiling at `ceilH` (or open sky), and a set of
materials. This is the "Doom-lite" model from `docs/decisions.md` D-002:
verticality comes from neighboring cells having different `floorH`/`ceilH`,
which the raycaster (US-004) turns into step fronts, ledges and gaps.

**Units:** 1 cell = 1 world meter. Cell `(col, row)` occupies world space
`x ∈ [col, col+1)`, `y ∈ [row, row+1)`. `col` grows **east** (+x), `row`
grows **south** (+y). Heights (`floorH`/`ceilH`/`topH`) are in meters,
`z = 0` at the level's nominal ground.

**Heading convention (one, used everywhere):** `facingDeg` is **compass
degrees**: `0 = north` (-y), `90 = east` (+x), clockwise. This is the same
convention as the palette sun azimuth and what `worldTestMain.js` actually
draws (`screenAngle = facingDeg - 90`, since screen/math angle `0` is east).
Earlier drafts of this doc and `test_room.js` said "0 = east" - that was
wrong and is fixed as of v2. If a start should face east, set `facingDeg: 90`.

## 2. File shape

A level file is an ES module under `game/js/world/levels/<name>.js` with a
default export:

```js
export default {
  name: 'test_room',        // string, used in error messages and ?level= lookups
  legend: { /* see below */ },
  rows: [ /* see below */ ],
  start: { x, y, facingDeg?, pitchDeg?, eyeH?, pose? },  // OPTIONAL - see 2.3

  // v2, all optional. loadLevel does not read these itself (except layers,
  // which it size-validates); it keeps the whole object as level.def so
  // later stories can. See section 4.
  layers: { tilt: [ /* rows, same size as `rows` */ ] },
  props: [ /* ... */ ], lights: [ /* ... */ ], triggers: [ /* ... */ ],
  markers: { /* ... */ }, sun: { /* ... */ }, ambient: { /* ... */ },
  route: [ /* ... */ ],
};
```

### 2.1 `legend`

Maps a single authoring character to a **sector definition**:

```js
legend = {
  '<char>': {
    floorH: number,             // meters. On a solid cell: the WALL TOP height (2.4).
    ceilH: number | 'sky',      // meters, or 'sky' for an open/roofless cell
    wallMat: '<material key>',  // design/palette.js materials, e.g. 'stone'
    floorMat: '<material key>', // also a solid cell's TOP FACE material (2.4)
    ceilMat: '<material key>',  // MUST be exactly 'sky' iff ceilH === 'sky' (2.5)
    solid: boolean,             // true blocks movement AT ANY HEIGHT (2.4)

    // v2, both optional, default from ceilH/wallMat (see 2.6):
    topH?: number | 'sky',
    upperMat?: '<material key>',

    // Player start authoring (optional, see 2.3):
    start?: true,
    facingDeg?: number, pitchDeg?: number, eyeH?: number, pose?: string,

    // Any other field (zone, tag, desc, dynamic, ...) passes through
    // untouched - see section 4.
  }
}
```

Material keys must be one of the M1 materials in `design/palette.js`:
`stone`, `stone_moss`, `stone_scorched`, `floor`, `ash`, `wood`, `iron`,
`rubble`, `sky` (design/README.md 1.6), plus whatever later material
versions add (`grass`, `rock`, `grate`, ...). The loader does not itself
validate material keys against the palette (US-003 is palette-agnostic so it
can load before `design/palette.js` in tests); the raycaster is expected to
fail loud if a key is missing when it looks it up.

A legend entry is resolved once at load time (defaults filled in, see 2.6)
and that resolved object is reused by reference for every cell using that
character - `sectorAt()` returns that same shared object, so treat it as
read-only.

### 2.2 `rows`

An array of equal-length strings, one row per line, one character per cell,
using only characters defined in `legend`. Must be rectangular: every row
the same length as row 0.

```js
rows: [
  '####',
  '#..#',
  '#..#',
  '####',
]
```

### 2.3 Player start

Two ways to declare it (exactly one must resolve, or the loader errors):

1. **Explicit** - a top-level `start: { x, y, ... }` in world meters.
2. **Legend-authored** - flag exactly one legend character with `start: true`
   (plus the same optional fields below). Every cell using that character is
   a candidate; there must be exactly one such cell in the grid. Its world
   position is the cell center (`col + 0.5, row + 0.5`).

Legend-authoring is the intended path for designers writing layouts as text
(e.g. the tower's wake pallet, US-010) - it keeps the start position and its
facing in the same ASCII map as everything else, with no separate
coordinate bookkeeping. The tower instead uses an explicit `start`, because
its pallet's centre lies on a cell edge (`x = 17.0`) - either form is valid,
pick whichever the geometry needs.

**v2 start shape**, same optional fields on both the explicit `start` and a
legend start entry:

| Field | Meaning | Default |
|---|---|---|
| `facingDeg` | compass yaw, 0=N/90=E, clockwise (section 1) | `0` |
| `pitchDeg` | camera pitch, degrees, + = up | `0` |
| `eyeH` | eye height in meters above `floorH` | `1.6` (standing eye, US-008) |
| `pose` | free-form string for US-015 (e.g. `'standing'`, `'lying'`) | `'standing'` |

### 2.4 Solid cells have a height

A `solid` cell is **not** an infinitely tall wall. `floorH` is the height of
its **top** - a broken wall stump, a parapet, a pillar.

- **Collision** (US-008/009): a solid cell blocks movement **at any
  height**, full-height, regardless of `floorH`. The capsule collider treats
  every solid cell as a wall from the ground up; there is no way to walk
  over the top of one by jumping (unless later physics adds ledge-grabbing -
  out of scope here).
- **Rendering** (US-004): a solid cell is a column drawn from below the
  visible range up to `floorH`, capped with a **top face** in `floorMat`
  (so looking down on a low wall or a broken parapet from above shows
  flagstone/rubble, not the wall material). Above `floorH`, the ray
  continues - this is how you see over a low wall into a sky-ceiling
  region, over the tower's ruined parapet (6.5-8.5 m) against the sky, and
  down into the tower interior from the summit walkway.
- `ceilH`/`ceilMat` are not used for rendering a solid cell's own geometry
  (there's no interior), but must still hold valid values per 2.5 - in
  practice always `'sky'`/`'sky'`, since "what's above the wall top" is sky.

### 2.5 `ceilMat` / `ceilH` agreement

`ceilMat` must be a non-empty material key, and it must be **exactly**
`'sky'` if and only if `ceilH === 'sky'`. (`loadLevel` rejects any other
combination - see section 3.) This keeps "is this cell open to the sky"
a single, consistent check (`ceilH === 'sky'`) without a second flag that
could disagree with it.

### 2.6 `topH` / `upperMat` - overhead mass on a real ceiling

A non-solid cell with a **numeric** `ceilH` can have overhead mass between
`ceilH` and `topH` (the doorway lintel, the grate's stone frame above the
bars). Both are optional and default so a level that never sets them behaves
exactly like a zero-thickness ceiling (MAP_FORMAT v1 behavior):

- `topH` defaults to `ceilH` (a zero-thickness slab).
- `upperMat` defaults to `wallMat`.

`loadLevel` fills both defaults into the resolved sector, so **every**
sector returned by `sectorAt()` has both fields set, even if the level file
never mentions them - the raycaster never has to null-check them.

Example (a doorway you can walk under, stone above it up to the room's
normal ceiling): `{ floorH: 0, ceilH: 2.2, topH: 3.0, wallMat: 'stone',
floorMat: 'floor', ceilMat: 'stone', solid: false }` (`upperMat` defaults to
`'stone'`).

### 2.7 Face material rule

- A **step or ledge front** (the vertical face between two adjacent cells at
  different `floorH`) uses the **higher** cell's `wallMat`.
- An **upper face** under a real ceiling (`ceilH` numeric, between `ceilH`
  and `topH`) uses that sector's `upperMat`.

(This is a rendering rule for US-004, not something `Level.js` computes -
documented here because the format's `wallMat`/`upperMat` fields exist to
serve it.)

### 2.8 Unknown / extension fields

Any legend field besides the ones above (`zone`, `tag`, `desc`, `dynamic`,
...) passes through untouched onto the resolved sector - `loadLevel` neither
requires nor strips them. See `design/levels/tower_layout.md` section 6 for
the set the tower uses (`zone`, `tag`, `dynamic: {ceilOpen, openTime, ease}`).

## 3. Loading and validation - `game/js/world/Level.js`

```js
import { loadLevel } from './Level.js';
import testRoom from './levels/test_room.js';

const level = loadLevel(testRoom); // Level instance, or null on error
```

`loadLevel(def)` validates, in order, and logs every problem it finds via
`console.error` (naming the row/column, or the legend character), then
returns `null` if anything failed (callers must check):

1. `legend` is an object and `rows` is a non-empty array.
2. **Rectangular grid**: every row has the same length as row 0.
3. **Per-legend-character field validation** (v2, cheap NaN/type guards),
   checked once per legend entry, named by character:
   - `floorH` is a finite number.
   - `ceilH` is a finite number or `'sky'`.
   - `solid` is a boolean.
   - `wallMat` and `floorMat` are non-empty strings.
   - `ceilMat` is a non-empty string, and is `'sky'` if and only if
     `ceilH === 'sky'` (section 2.5).
   - On a **non-solid** cell, `ceilH >= floorH` when `ceilH` is numeric
     (equal is allowed - a closed grate). Not checked on solid cells, whose
     `floorH`/`ceilH` mean different things (section 2.4).
   - `topH`/`upperMat` defaults are filled in here too (section 2.6).
4. **Every character used in `rows` is in the legend** (and its entry
   passed step 3): reports `row, col` for each unknown character.
5. **Player start is defined** (v2 shape, section 2.3): exactly one of
   (explicit `start`) or (legend cells flagged `start: true`) must resolve
   to exactly one start position. Zero starts, more than one legend-flagged
   start, or both an explicit start *and* legend markers, are all reported
   as errors (with the row/col of every marker found).
6. **`layers` size** (v2, if `def.layers` is present): every layer's row
   count and each row's length must match the main grid's. Reports the
   layer name and the offending row.

On success, `loadLevel` returns a `Level` instance (below). On failure it
returns `null` - the caller decides whether to fall back to another level or
show an error state.

## 4. Query API - `Level`

All positions are world meters; `1 cell = 1 m` per section 1.

| Member | Returns |
|---|---|
| `level.sectorAt(x, y)` | The resolved `Sector` object at that position (topH/upperMat defaulted), or `null` if outside the grid. |
| `level.floorAt(x, y)` | `sector.floorH`, or `null` if outside the grid. |
| `level.ceilAt(x, y)` | `sector.ceilH` (number or `'sky'`), or `null` if outside the grid. |
| `level.inBounds(col, row)` | `true` if the integer cell `(col, row)` is inside the grid. |
| `level.layerAt(name, x, y)` | (v2) the character in `def.layers[name]` at that position, or `null` outside the grid or if the layer doesn't exist. Convenience only. |
| `level.def` | (v2) **the original raw level definition object**, untouched - `props`, `lights`, `triggers`, `markers`, `sun`, `ambient`, `route`, `layers`, and anything else the level file defines, for stories that need them (US-010/012/013/014/015/017 etc.). |

Other fields on `Level`: `name`, `width`, `height` (cell counts), `cellSize`
(always `1`), `rows`, `legend` (the fully-resolved legend, every entry has
`topH`/`upperMat` filled in), `start` (`{x, y, facingDeg, pitchDeg, eyeH,
pose}`, always fully resolved after a successful `loadLevel`).

`sectorAt`/`floorAt`/`ceilAt`/`layerAt` floor their input to the containing
cell (`Math.floor(x)`, `Math.floor(y)`), so any point strictly inside a cell
resolves to that cell's sector - there is no interpolation between cells.

## 5. Reference level - `game/js/world/levels/test_room.js`

20x18, bordered by solid walls (top 3.0 m). Contains, per the US-003
acceptance criteria (v1 and v2):

- Flat floor at `0.0 m` (`.`).
- A 3-step staircase, `0.3 m` risers (`1`→0.3, `2`→0.6, `3`→0.9).
- A raised platform at `1.0 m` (`P`, 2x2 cells).
- A solid pillar (`O`, top 3.0 m).
- A sky-ceiling region (`^`, `ceilH: 'sky'`, 4x4 cells).
- A player start marker (`S`), `facingDeg: 90` (east).
- **v2:** a solid **low wall** (`w`, top 1.0 m) directly south of the sky
  region, to see over into it.
- **v2:** a solid **`stone_moss`** wall section (`m`) for the US-004
  tintBand check.
- **v2:** a **lintel/doorway** cell (`D`, `ceilH 2.2`, `topH 3.0`).
- **v2:** a **1-cell (1 m) gap** (`v`, void at `floorH -1.0`) landing onto
  `+0.3 m` (row 15), and a **2-cell (2 m) gap** at equal height (row 16).

See the file's header comment for the full legend and the ASCII map.

## 6. Notes for consumers

- **US-004 (raycaster)**: neighboring cells with different `floorH`/`ceilH`
  are where step fronts / ledge fronts / pillar sides get drawn (face
  material per 2.7). `solid` cells draw as a column up to `floorH` with a
  `floorMat` top face; rays continue past them above that height (2.4) -
  this is required for the tower's broken wall silhouette and its summit
  view down into the interior, and is tested in `test_room` by the low wall
  (`w`) and pillar (`O`). `ceilH === 'sky'` cells render the sky gradient
  instead of ceiling geometry and are emissive (ignore lighting/fog). A
  numeric `ceilH` with `topH > ceilH` (2.6) needs an upper face drawn in
  `upperMat` between them (the doorway `D` cell exercises the default path;
  the tower's grate exercises an explicit one).
- **US-008/009 (physics)**: `solid` is a full-height blocker regardless of
  `floorH` (2.4) - a "wall higher than the step threshold" is any solid
  neighbor, full stop; a step is a *non-solid* neighbor whose `floorH`
  differs by less than the step-up threshold. Headroom (`ceilH - floorH <
  1.70`) blocks entry on non-solid cells - note a closed grate (`ceilH ===
  floorH`) is naturally impassable this way without needing `solid: true`.
  `test_room`'s two gap rows (section 5) are jump test cases.
- **US-010 (tower)**: `design/levels/tower.js` already matches this format
  1:1 (verified: `loadLevel(ASSETS.levels.tower)` returns a valid `Level`,
  see `design/preview/tower.html`'s loader check) and needs no changes to
  load. The programmer ports it verbatim to
  `game/js/world/levels/tower.js` as `export default {...}`.
- This module intentionally has **no dependency on `design/palette.js`**
  (material keys are just strings here) so it can be unit-tested and used by
  the standalone `game/world-test.html` page without loading the palette.

## Change log

- **v1 (2026-09-22, US-003)**: initial sector map format, `Level.js`
  loader/query API, `test_room` reference level.
- **v2 (2026-09-22, US-003 PO REJECT #1 rework)**: one heading convention
  (compass, `facingDeg` 0=N/90=E clockwise - fixed the "0=east" comments);
  `start` gains `pitchDeg`/`eyeH`/`pose` (section 2.3); solid cells have a
  height (`floorH` = wall top, full-height collision, column + top-face
  rendering with rays continuing above - section 2.4); `topH`/`upperMat`
  overhead-mass fields with defaults (section 2.6) and the step/ledge face
  material rule (section 2.7); `ceilMat`/`ceilH` agreement is enforced
  (section 2.5); per-legend-character field validation (section 3.3);
  `level.def` exposes the whole raw definition (props/lights/triggers/
  markers/sun/route/layers/...) and `layers` grids are size-validated
  against the main grid; `level.layerAt()` convenience method. `test_room`
  extended to 20x18 with a low wall, a `stone_moss` wall, a lintel doorway
  and two gap tests (sections 5). `design/levels/tower.js` verified to load
  unchanged under this version.
