# Valley layout: EP-WORLD-VALLEY slice 0 (PROPOSAL, owner approval pending)

Owner: Designer. Source: D-052, `docs/epics/ep-world.md`. Preview + self-check: `design/preview/valley-look.html`.
**Nothing is placed in the world yet.** palette.js, levels and engine are unchanged.

## Frame
- Sheet: 120 x 80 cells. One cell is 16 m east-west by 24 m north-south, so the sheet covers the 2048 m `overworld_far` square.
- Axes: x = east, y = south. Origin (64, 64) m, so `col = (x - 64) / 16` and `row = (y - 64) / 24`.
- The tower is at its real position (1496, 1024), which is col 89.5, row 40.
- The big river is the existing recipe river `x_r(y) = 1120 + 110 sin(y/260) + 45 sin(y/95 + 1.3)`. Slice 1 reuses that line. It widens it to a 26 m half width (plus 16 m banks) and runs it from a north-mountain waterfall to the sea. The mouth widens over the last 6 rows.
- The copy button emits `{grid, river, bridges, fords, landmarks, legend, rows[]}`. Each row is a string with one zone key per cell (legend in the page).

## Borders
| Side | What | Rule |
|---|---|---|
| North, west | mountains `M` (snow on the high rows) | steep, unclimbable above the slope limit, collider-backed |
| South | surf `s`, then sea `S` | knee-deep surf; past it, a soft current turns the player back (no swimming out) |
| East | bank `k`, then Ferrum river `r` (3 cells, ~48 m), then rock wall `W` | the river is fast and cold, the wall is sheer; there is nothing to reach. Ferrum may come back later as one designed vantage view, never a horizon sprite. |

## The river is not a hard wall (owner 2026-10-09)
- Every big-river cell is wadeable. Proposed values: speed x0.4, no attacks while wading, a 0.6 m/s current that pushes south.
- Two fords `F` at rows 14 and 66 are shallower: speed x0.7.
- Bridges are the comfortable way across. The gate is gear tier: far-side beasts are levels 5-10.
- Engine ask: a `wade` surface flag on water instead of a collider wall.

## Bridges
- **A (open):** row 56, world y ~1420, x ~1016. Leads from the forest's south edge to the open fields (5-7).
- **B (broken):** row 24, world y ~652, x ~1228. The middle span is missing. Leads straight from the north forest into the rocky foothills (7-10): the dangerous shortcut. Manager lean: repaired by the level-5 quest (owner Q1).

## Zones and level bands (fixed beast level, D-052 item 3)
| Zone | Side | Levels | Where |
|---|---|---|---|
| start meadow `g` + tower `T` + waystone `w` | near | 1-2 | ellipse around the tower; the shore meadow in the south |
| hillside `h` | near | 2-3 | north-east up to the mountains, plus ruins |
| pine/oak forest `f` | near | 3-5 | between the river and about col 80-85; pines north, oaks south |
| flower glades `l` (3) | near | 3-5 | (75,34), (75,58) and (70,43) in cells: hand-placed showcase first |
| open fields `o` | far | 5-7 | the centre and south of the far side; lone trees, ruins |
| rocky foothills `t` | far | 7-10 | the north strip and the west strip up to the mountains |
| river, banks, bridges, beach, path | both | follow their side | |

The far side is somewhat larger than the near side (the ratio is printed under the map). Manager lean: about equal (owner Q2). To shrink the far side, move the west mountain line east; the river stays put.

## Looks (part 2 of the page)
- Six sheets: forest, glade, fields, foothills, river bank + bridge, sea shore. Each is a mockup at 240x90 / 160x60, with a sun direction and elevation slider, wind, and day / dusk.
- Each sheet comes with a scatter recipe: ingredient, Quaternius-style mesh family, density, clusters, scale, tint keys, rule, and glyphs near / mid / far. The page's copy button emits all of it plus the proposed colours.
- Glade rule: **colour drifts, not confetti.** Each 4-10 m drift has one dominant flower colour, with 20 % of other colours mixed in.
- Ambient particles: pollen and butterflies by day; fireflies at dusk, which are emissive.
