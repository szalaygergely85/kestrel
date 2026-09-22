# Sector map format (US-003)

Owner: Programmer (track B). Consumed by the raycaster (US-004), physics
(US-008/009), and authored by the Designer for the tower (US-010). Any
format change goes in the change log at the bottom and must stay compatible
with `game/js/world/Level.js`.

## 1. Concept

A level is a grid of **sectors**. Each grid cell is exactly one sector: a
flat floor at `floorH`, a ceiling at `ceilH` (or open sky), and a set of
materials. This is the "Doom-lite" model from `docs/decisions.md` D-002:
verticality comes from neighboring cells having different `floorH`/`ceilH`,
which the raycaster (US-004) turns into step fronts, ledges and gaps.

**Units:** 1 cell = 1 world meter. Cell `(col, row)` occupies world space
`x ∈ [col, col+1)`, `y ∈ [row, row+1)`. `row` increases south/down through
the text rows; `col` increases east/right through each row's characters.
Heights (`floorH`/`ceilH`) are in meters, `z = 0` at the level's nominal
ground.

## 2. File shape

A level file is an ES module under `game/js/world/levels/<name>.js` with a
default export:

```js
export default {
  name: 'test_room',        // string, used in error messages and ?level= lookups
  legend: { /* see below */ },
  rows: [ /* see below */ ],
  start: { x, y, facingDeg },  // OPTIONAL - see "Player start" below
};
```

### 2.1 `legend`

Maps a single authoring character to a **sector definition**:

```js
legend = {
  '<char>': {
    floorH: number,             // meters
    ceilH: number | 'sky',      // meters, or 'sky' for an open/roofless cell
    wallMat: '<material key>',  // design/palette.js materials, e.g. 'stone'
    floorMat: '<material key>',
    ceilMat: '<material key>',  // ignored by the renderer when ceilH === 'sky'
    solid: boolean,             // true blocks movement (walls, pillars)

    // Player start authoring (optional, see 2.3):
    start?: true,
    facingDeg?: number,
  }
}
```

Material keys must be one of the M1 materials in `design/palette.js`:
`stone`, `stone_moss`, `stone_scorched`, `floor`, `ash`, `wood`, `iron`,
`rubble`, `sky` (design/README.md 1.6). The loader does not itself validate
material keys against the palette (US-003 is palette-agnostic so it can load
before `design/palette.js` in tests); the raycaster is expected to fail loud
if a key is missing when it looks it up.

A legend entry is a plain object, reused by reference for every cell that
uses that character - `sectorAt()` returns that same shared object, so
treat it as read-only.

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

1. **Explicit** - a top-level `start: { x, y, facingDeg }` in world meters
   (facingDeg optional, default 0, compass-style degrees used by the camera).
2. **Legend-authored** - flag exactly one legend character with `start: true`
   (and optionally `facingDeg`). Every cell using that character is a
   candidate; there must be exactly one such cell in the grid. Its world
   position is the cell center (`col + 0.5, row + 0.5`).

Legend-authoring is the intended path for designers writing layouts as text
(e.g. the tower's wake pallet, US-010) - it keeps the start position and its
facing in the same ASCII map as everything else, with no separate
coordinate bookkeeping.

## 3. Loading and validation - `game/js/world/Level.js`

```js
import { loadLevel } from './Level.js';
import testRoom from './levels/test_room.js';

const level = loadLevel(testRoom); // Level instance, or null on error
```

`loadLevel(def)` validates, in order, and logs every problem it finds via
`console.error` with row/column where applicable, then returns `null` if
anything failed (callers must check):

1. `legend` is an object and `rows` is a non-empty array.
2. **Rectangular grid**: every row has the same length as row 0. Reports the
   offending row index and both lengths.
3. **Every character is in the legend**: reports `row, col` for each unknown
   character.
4. **Player start is defined**: exactly one of (explicit `start`) or (legend
   cells flagged `start: true`) must resolve to exactly one start position.
   Zero starts, more than one legend-flagged start, or both an explicit
   start *and* legend markers, are all reported as errors (with the
   row/col of every marker found).

On success, `loadLevel` returns a `Level` instance (below). On failure it
returns `null` - the caller decides whether to fall back to another level or
show an error state.

## 4. Query API - `Level`

All positions are world meters; `1 cell = 1 m` per section 1.

| Method | Returns |
|---|---|
| `level.sectorAt(x, y)` | The `Sector` object at that position, or `null` if outside the grid. |
| `level.floorAt(x, y)` | `sector.floorH`, or `null` if outside the grid. |
| `level.ceilAt(x, y)` | `sector.ceilH` (number or `'sky'`), or `null` if outside the grid. |
| `level.inBounds(col, row)` | `true` if the integer cell `(col, row)` is inside the grid. |

Other fields on `Level`: `name`, `width`, `height` (cell counts), `cellSize`
(always `1`), `rows`, `legend`, `start` (`{x, y, facingDeg}`, always
resolved after a successful `loadLevel`).

`sectorAt`/`floorAt`/`ceilAt` floor their input to the containing cell
(`Math.floor(x)`, `Math.floor(y)`), so any point strictly inside a cell
resolves to that cell's sector - there is no interpolation between cells.

## 5. Reference level - `game/js/world/levels/test_room.js`

16x16, bordered by solid walls. Contains, per the US-003 acceptance
criteria:

- Flat floor at `0.0 m` (`.`).
- A 3-step staircase, `0.3 m` risers (`1`→0.3, `2`→0.6, `3`→0.9).
- A raised platform at `1.0 m` (`P`, 2x2 cells).
- A solid pillar (`O`).
- A sky-ceiling region (`^`, `ceilH: 'sky'`, 4x4 cells).
- A player start marker (`S`) with `facingDeg: 0` (east).

See the file's header comment for the full legend and the ASCII map.

## 6. Notes for consumers

- **US-004 (raycaster)**: neighboring cells with different `floorH`/`ceilH`
  are where step fronts / ledge fronts / pillar sides get drawn; `solid`
  cells block the ray and never show a floor/ceiling of their own from the
  inside. `ceilH === 'sky'` cells render the sky gradient instead of ceiling
  geometry (US-004 AC2/AC8) and are emissive (ignore lighting/fog).
- **US-008/009 (physics)**: `solid` cells plus per-cell `floorH` are exactly
  what the capsule collider and step-up logic need; a "wall higher than the
  step threshold" is any `solid` neighbor, a step is a non-solid neighbor
  whose `floorH` differs by less than the step-up threshold.
- **US-010 (tower)**: author `game/js/world/levels/tower.js` in this exact
  shape. Use the legend-authored player start (section 2.3) for the wake
  pallet + facing. `stone_moss`/`stone_scorched` are valid `wallMat`/
  `floorMat`/`ceilMat` values, same as any other material key.
- This module intentionally has **no dependency on `design/palette.js`**
  (material keys are just strings here) so it can be unit-tested and used by
  the standalone `game/world-test.html` page without loading the palette.

## Change log

- **v1 (2026-09-22, US-003)**: initial sector map format, `Level.js`
  loader/query API, `test_room` reference level.
