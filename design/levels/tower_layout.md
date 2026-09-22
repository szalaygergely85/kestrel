# US-010 Tower layout : The Hollow Watchtower (v1)

Owner: Designer. **Data**: `design/levels/tower.js` (`ASSETS.levels.tower`, the single source; this page explains it). **Preview**: `design/preview/tower.html`. It shows the shaded top-down plan per level with heights, props, lights, reachability, boulder tilt and a sun-azimuth slider, plus the climb profile. It also runs automated checks on the data (listed in section 7).

Format: **`game/js/world/MAP_FORMAT.md` v1**. The level is `{ name, legend, rows, start }`. Every legend entry has `floorH`, `ceilH` (number or `'sky'`), `wallMat`, `floorMat`, `ceilMat` (always a material key; `'sky'` on open cells) and `solid`. The start is explicit: `{ x: 17.0, y: 9.5, facingDeg: 330 }`. It is not a legend start char, because the pallet centre lies on a cell edge. On top of that come the optional extensions in section 6. `loadLevel` ignores unknown fields, so they are safe. The programmer ports the object as `export default {...}` to `game/js/world/levels/tower.js` without content changes. The preview runs it through the real `loadLevel` when served over http.

Conventions: 1 cell = 1 m. `rows[y][x]`, x grows **east**, y grows **south**, and cell (x,y) spans [x,x+1) x [y,y+1). z = metres above the tower ground floor. `facingDeg` is compass: 0 = north, 90 = east. That is how `worldTestMain.js` actually draws it (`facingDeg - 90`). The comments "0 = east" in MAP_FORMAT section 5 and `test_room.js` contradict the code; see section 8.

## 1. The map (24 x 14)

```
          x: 0         1         2
             012345678901234567890123
 y  0        ,,;;;;;;;;,,,,,,,,,,,,,,
    1        ,;;vvvvvv;;,,,unmnmu,,,,
    2        ,;vvwwwwvv;,,unuRzmn%,,,
    3        ;vwwwwwwwwv,un_s1234%#,,
    4        ;vwwwwPPPPP!$oo_ccc56%#,
    5        ;vwwwYP====!!o_...:.7##,
    6        ;lkjxXb=OO=!z....:*:8KK,
    7        ;lkjxXb=OO=dJI....:.9##,
    8        ;vwwwYP====$!HR....rg##,
    9        ;vwwwwPPPPP!$FE....LL%#,
   10        ;;vvwwwwwvv,$&DCBAGLL%,,
   11        ,;;vvvvv;;,,,&$&%%&%#,,,
   12        ,,;;;;;,,,,,,,$&$&%&,,,,
   13        ,,,,,,,,,,,,,,,,,,,,,,,,
```
Reading it:
- The **round tower** is the 12x12 ring on the right, x 11..22, y 1..12. Its interior is about 10 m across, and the walls are 1 to 2 cells thick where the circle is approximated.
- The **summit bastion** is the 5x6 block `P = O b`, x 6..10, y 4..9. It is a beacon platform on the tower's west side, built on a rock spur.
- The **outcrop and hill** lie west of the breach, x 0..5.
- Everything outside the walls is scenery (hillside), seen only through the crack and from the summit. The player can leave only by the breach, onto a trigger.

## 2. Legend (sector definitions)

| char | floorH | ceilH | solid | wallMat | floorMat | ceilMat | what |
|---|---|---|---|---|---|---|---|
| `#` `%` `&` `$` `!` | 8.5 / 8.0 / 7.5 / 7.0 / 6.5 | sky | yes | stone | rubble | - | tower wall; floorH = broken wall top |
| `m` `n` `u` | 8.5 / 8.0 / 7.5 | sky | yes | stone_moss | rubble | - | north walls, moss band near the floor |
| `c` | 1.4 | sky | yes | stone_moss | floor | - | stair cheek wall: the first steps can only be entered from the base |
| `P` | 7.0 | sky | yes | stone | floor | - | summit parapet (1.0 m above the walkway) |
| `.` | 0.0 | sky | | stone | floor | - | flagstone ground floor |
| `:` | 0.0 | sky | | stone | ash | - | cold ash around the brazier |
| `s` | 0.0 | sky | | stone | floor | - | stair base, boulder start (tag `stairBase`) |
| `_` | -0.15 | sky | | stone_moss | floor | - | slope apron, base to hollow (tag `slope`) |
| `o` | -0.30 | sky | | stone_moss | rubble | - | NW hollow (tag `hollow`) |
| `r` `R` `z` | 0.3 / 0.6 / 0.9 | sky | | rubble | rubble | - | rubble heaps (tag `rubble`) |
| `*` | 0.5 | sky | | stone_scorched | ash | - | stone ring under the brazier (tag `brazier`) |
| `1`..`9` | 0.3 .. 2.7 | sky | | 1-4 stone_moss, 5-6 stone, 7-9 stone_scorched | floor | - | lower stair, 0.30 m rises |
| `g` | 0.6 | sky | | rubble | rubble | - | **the gap**: collapsed step, debris 2.1 m below the jump-off (tag `gap`) |
| `L` | 3.0 | sky | | stone | floor | - | mid ledge 2x2 in the SE wall niche |
| `G` | 3.0 | **3.0 -> 5.4** | | stone | floor | iron | **grate** cell: `topH 6.6`, `upperMat grate`, `dynamic.ceilOpen 5.4` (tag `grate`) |
| `A`..`J` (no G) | 3.3 .. 5.7 | sky | | stone | floor | - | upper stair, 0.30 m rises |
| `d` | 6.0 | sky | | stone | floor | - | doorway through the west wall (10th upper rise) |
| `=` | 6.0 | sky | | stone | floor | - | summit walkway, a ring around the bowl |
| `O` | 6.6 | sky | | stone | floor | - | stone plinth 2x2 under the beacon bowl sprite (tag `beaconBowl`) |
| `b` | 6.0 | sky | | rubble | rubble | - | **breach**, 2 cells in the west parapet (tag `breach`) |
| `K` | 4.0 | 6.4 | | stone | rubble | stone | **sun crack** through the east wall, `topH 8.0` (tag `sunCrack`) |
| `X` | 6.0 | sky | | rock | rock | - | outcrop past the breach, **end trigger** |
| `Y` | 5.4 | sky | | rock | rock | - | rock beside the outcrop, also **end trigger** |
| `x` | 6.0 | sky | | rock | rock | - | outcrop where the end camera walks |
| `j` `k` `l` | 5.4 / 4.6 / 3.6 | sky | | rock | grass | - | hill path down |
| `w` `v` | 5.4 / 4.2 | sky | | rock | rock | - | rock spur / slope |
| `;` `,` | 2.4 / 1.0 | sky | | rock | grass | - | hillside grass |

`ceilMat -` in the table is stored as `'sky'` in the data: MAP_FORMAT requires a key on every entry. New palette materials added for this story: `grass` and `rock` (see `palette.js`). `grate` is delivered with US-011.

## 3. Levels, cell by cell

**Level 0: ground floor (0.0 m).** About 30 walkable cells, x 13..19, y 3..9.
- **Wake pallet** at (17.0, 9.5): 2 m E-W, lying against the south stair wall (the massive block of upper steps C/B/A). **Player start** is on it: lying, eye 0.3 m, yaw 330 (NNW), pitch +30. That faces the sun patch and the open top.
- **Brazier** at (18.5, 6.5) on a 0.5 m stone ring `*`. It is 3.35 m from the pallet centre and is the torch light (z 1.2). Cold ash `:` surrounds it, and the step faces 7/8/9 facing it are `stone_scorched`.
- **Lantern hook** at (19.9, 6.5), z 1.3, on the west face of step 8, 1.4 m from the fire: warm-lit and glinting.
- **Rubble** (0.3 to 0.9 m): (19,8) `r` below the gap, (14,8) `R`, (12,6) `z`, the north alcove (16,2) `R` / (17,2) `z`, and debris in the gap `g`.
- **NW hollow** `o` at -0.3: (13,4), (14,4), (13,5). The **slope apron** `_` at -0.15 runs from the stair base to it: (14,3), (15,4), (14,5).
- **Stair base** `s` (15,3) with the **boulder** at (15.55, 3.5). The cheek wall `c` (16..18, 4) closes the inner side of steps 1-3, so the base is the only way onto the stair and the boulder really blocks it. Jumping over the boulder (1.2 m) is not possible.
- **Sun**: elevation 60, from ESE. The tall east walls (8.5 m) shadow roughly the eastern 4.5 m of the floor, so the brazier and pallet are in warm shade. The lit patch falls on the centre-west floor, x ~13..17, y ~4..8, which matches the GDD's bright floor patch near the centre. The **sun crack** `K` (4.0 to 6.4 m) in the east wall at (21..22, 6) adds a thin second beam. Check it with the azimuth slider in the preview.

**Level 1: spiral stair to the mid ledge (0.3 to 3.0 m), clockwise.** The route runs along the north wall eastward, then down the east wall southward:
(16,3) 0.3, (17,3) 0.6, (18,3) 0.9, (19,3) 1.2, (19,4) 1.5, (20,4) 1.8, (20,5) 2.1, (20,6) 2.4, (20,7) 2.7, then the **gap** at (20,8), landing on the **mid ledge** (19..20, 9..10) at 3.0.
- The gap is 1 cell of air above a debris pile at 0.6 m. The jump is from 2.7 onto 3.0 (+0.3, the US-009 walking-jump case). Falling lands on the debris, then you step off onto the ground. It sits on the east side in shade: the lantern makes the edges pop, and ambient light alone keeps them readable (soft gate).
- **Lever** at (19.25, 9.3) on a post at the NW corner of the ledge. The player pulls it facing west, and the grate is then about 30 degrees left of the view centre, so they see it rise (US-014). **Chains** run from the lever to the grate head.
- **Grate** `G` at (18,10) is the first cell of the upper stair, in the SE corner of the south wall. Closed, its ceilH equals its floorH, so it is a wall of bars. The lever raises the ceiling to 5.4 (2.4 m clear) over 1.5 s. The face from ceilH to 5.4 uses the `grate` material, and 5.4 to 6.6 (`topH`) is the stone lintel.

**Level 2: upper stair and summit (3.3 to 6.0 m).** The route runs along the south wall westward, then up the west wall northward:
(17,10) 3.3, (16,10) 3.6, (15,10) 3.9, (14,10) 4.2, (14,9) 4.5, (13,9) 4.8, (13,8) 5.1, (13,7) 5.4, (12,7) 5.7, then the **doorway** (11,7) at 6.0 (10 rises from the ledge) onto the **summit bastion**.
- **Summit walkway** `=` at 6.0: a ring around the **beacon bowl** `O` (8..9, 6..7), 2 m across. It is a stone plinth 0.6 m high, and the US-011 bowl sprite (iron bowl on legs, full of ash) stands on it. The sprite anchors at (9.0, 7.0, z 6.6), and the beacon light for US-022 is at z 7.4.
- **Parapet** `P` at 7.0 (waist high) surrounds the walkway. Toward the tower, the broken west wall (6.5 m) is only 0.5 m above the walkway, so from the summit you look down into the tower interior.
- **Breach** `b` (6, 6..7): a 2 m gap in the west parapet, leading to the **outcrop** `X` (5, 6..7) at 6.0, which is the **end trigger**. The camera walks to (4.5, 7.0) and pitches -12 toward the valley. The two rock cells `Y` (5,5) and (5,8) are also trigger cells, so stepping diagonally off the breach cannot skip the ending.
- **Hill** beyond: `j` 5.4, `k` 4.6, `l` 3.6, then hillside `;`. Past the map edge the US-016 far view takes over. The far tower should sit roughly W to WSW so it is framed by the breach.

**Irregular wall tops** (6.5 to 8.5 m): the west is broken low (6.5 to 7.0) beside the summit. The north (moss) runs 7.5 to 8.5, jagged. The east and ESE are tall (8.0 to 8.5) and cast the shaft edge. The south is 7.0 to 8.0. Seen from the ground floor, the silhouette against the sky steps up and down all the way round.

## 4. Constraints from D-003, D-004 and the manager, and how the layout meets them

| Constraint | How |
|---|---|
| Completable **without the lantern** | Nothing in the geometry needs the lantern. The gap is reachable, jumpable and readable with ambient light only. The lantern only improves the shaded east stair. |
| **NW hollow is the boulder's only stable resting place**; it can never re-block the stair or the wake area; once in, it cannot be pushed out | The boulder (step threshold 0) can only move to cells at or below its current floor. From the base (0.0), the only such cells are the apron (-0.15) and the hollow (-0.3). Every other neighbour is higher: the step (0.3), the cheek wall (solid), or rubble. Once on the apron it cannot climb back to 0.0, and once in the hollow every exit is uphill. It **cannot physically reach** the stair, the room or the pallet. The `tilt` layer makes the base and apron cells roll it into the hollow, so it never rests on the base. Restart puts it back at (15.55, 3.5). |
| **Grate on the upper stair raised by the lever**; summit only via the grate | `G` is the only link from the ledge to the upper stair. Every upper-stair cell's other neighbours are at least 3.3 m above reachable ground, or are walls. |
| **Breach at the summit** | 2 m hole in the bastion's west parapet onto the outcrop trigger. |
| Falling from any stair lands safely at ground level | Every stair and ledge cell has a walkable ground cell below it on its open side (steps 1-3 are closed by the cheek wall, so you cannot fall off them sideways). No fall damage in M1. The preview's "no traps" check proves the start is reachable from every reachable cell. |

## 5. Boulder notes for US-013
- The start is on the stair base, 5 cm onto step 1. It fills the base cell completely (radius 0.6), so the player cannot slip onto step 1 beside it.
- Every approach comes from the south or west (north is the wall, east is the step):
  - Pushed north, it hits the wall, the tilt takes it SW, and it rolls into the hollow.
  - Pushed east, it is blocked by the step, the tilt rolls it back west, and the US-013 anti-squeeze rule pushes the player aside.
- `tilt` layer (numpad directions): base `1` (SW), apron (14,3) `2` (S), (15,4) `4` (W), (14,5) `4` (W), hollow `5` (sink toward (13.9, 4.7)). Suggested grade 0.05: apply `g * 0.05` along the tilt while the boulder is awake. Rolling friction should decelerate it less than that, so it never rests on a tilted cell.

## 6. Format extensions (optional fields on top of MAP_FORMAT v1)
All are optional. `loadLevel` reads only the MAP_FORMAT fields and ignores everything else, so the tower loads as is. What `loadLevel` does **not** do with them, i.e. what a later consumer must implement:
- **US-004 raycaster.** MAP_FORMAT section 6 says solid cells "block the ray" and have no floor of their own. To show the ruined silhouette (US-010 AC: wall tops 6.5 to 8.5 m), the raycaster must draw a solid cell's faces only up to its `floorH` (the wall top), with sky above. Otherwise every wall is infinitely tall, and the parapet (7.0) and low west wall (6.5) cannot be looked over from the summit. **This is the one extension that matters for M1 visuals.**
- **US-014:** `dynamic.ceilOpen`, `topH`, `upperMat` on the grate.
- **US-013:** `layers.tilt` and `tilt.grade`.
- **US-012 / US-015 / US-017:** `lights`, `props`, `triggers`, `markers`, and `start.eyeH` / `start.pitchDeg` / `start.pose` (map format v2 names).
- **Materials:** `grass` and `rock` are new palette materials (v1.1) and are not yet in MAP_FORMAT's M1 material list. `grate` (`upperMat`) arrives with US-011.

The extensions:
1. **Solid cells keep a `floorH`** = the top of the wall, so the renderer can draw broken wall tops and parapets. Collision treats solid cells as infinitely tall.
2. **`topH`** on sectors with a real ceiling (grate, crack): the height of the stone mass above the ceiling, i.e. where the upper face ends.
3. **`upperMat`**: the material of the face between ceilH and a fixed point (grate bars up to `dynamic.ceilOpen`, stone above).
4. **`dynamic: { ceilOpen, openTime, ease }`** on the grate (US-014).
5. **`zone`** (`ground`, `stair`, `ledge`, `upper`, `summit`, `wall`, `outside`) and **`tag`** (`stairBase`, `slope`, `hollow`, `rubble`, `brazier`, `gap`, `grate`, `beaconBowl`, `breach`, `sunCrack`, `trigger:end`). Used for checks, debug overlay sector ids and triggers.
6. **`layers.tilt`**: a second char grid, same size, for the boulder.
7. Face material rule: a step or ledge front uses the **higher** sector's `wallMat`. An upper face under a real ceiling uses that sector's `wallMat` / `upperMat`.
8. Level-level data: `start`, `sun`, `ambient`, `lights[]` (palette presets), `props[]` (US-011 model names, anchor at the feet), `triggers[]`, `markers`, `route` (the intended path, used by checks).

## 7. Automated checks (preview, recomputed from the data on every load)
- US-003 loader rules: the grid is rectangular, every char is in the legend, and the start is on walkable ground.
- Every referenced material exists in the palette (`grate` excepted, since it arrives with US-011).
- Grate **closed**: the upper stair, summit and outside are unreachable. Grate **open**: the end trigger and bowl are reachable, and the only way outside is onto a trigger cell.
- The route is walkable step by step with exactly one gap jump (+0.3), and all rises are 0.30.
- No traps: every reachable cell can get back to the start.
- Boulder: its reachable set is only base, apron and hollow. The tilt leads every non-hollow cell into the hollow, and the hollow has no downhill exit.
- Wall tops are within 6.5 to 8.5, the sun crack is out of reach, and the breach is 2 cells wide.

The movement model is deliberately generous, so that it finds leaks:
- walk up to +0.45 and jump up to +1.0 (the real apex is 1.05)
- diagonals allowed with one open side
- falls of any height
- a straight 1-cell gap jump onto up to +0.45

## 8. Open points for the PO
1. **The gap is 1.0 m, not 1.5 m.** On a 1 m grid, a 1.5 m gap is not possible, so the choice is 1 cell (1.0 m) or 2 cells (2.0 m). With the US-009 numbers, a walking jump onto +0.3 carries about 2.1 m. A 2 m gap would therefore need a perfect take-off, which is not the "forgiving on purpose" jump the GDD asks for. I chose **1 cell (1.0 m)**. It still needs a real jump: stepping off drops you 2.1 m onto the debris. If the PO wants a wider gap, it needs half-metre cells or a sub-cell ledge lip (engine change).
2. **Summit as a bastion.** A ring walkway with a bowl in the centre cannot sit over the open tower interior: one floor per cell, and the interior must stay roofless for the sun shaft. So the summit is a beacon platform on the tower's west side. It has a walkway ring around the bowl, a waist-high parapet and the breach, and it overlooks the interior across the low broken west wall. The outer footprint becomes 12x12 for the tower plus 5 m of bastion.
3. **End trigger** is 4 cells (outcrop plus the two diagonal rock cells), so the ending cannot be skipped.
4. **Aligned with MAP_FORMAT v1** (see the top of this page and section 6). Two things for the programmer:
   - (a) the US-004 raycaster must honour a solid cell's `floorH` as the wall top;
   - (b) the `facingDeg` convention: the code uses compass (0 = north), but the MAP_FORMAT section 5 and `test_room.js` comments say "0 = east". Fix the comments, or state the convention in MAP_FORMAT.
