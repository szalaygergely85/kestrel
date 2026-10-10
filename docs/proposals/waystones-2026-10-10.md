# Waystone spots - designer proposal (2026-10-10)

PROPOSAL ONLY. Nothing is placed in content until the owner picks. Basis: D-057 (waystones = travel points, picked from the map, only touched ones), game-design.md section 3, roadmap M4/M5, `design/levels/overworld_far.js` recipe, `content/chart/world_m1.chart.json` (240 x 120 category grid over 0..2048 m).

Preview: `design/preview/waystones.html` (serve the repo root, e.g. `python -m http.server 8000`, open `/design/preview/waystones.html`). It draws the chart, the road, the river, the current play bounds, the pencil line to the signal tower, the existing waystone and every candidate, and it re-checks each spot live against `overworld_far.util.typeAt` / `pathDist` (centre + a 6 m ring must be grass, path centre >= 6 m away).

## Frame and constraints
- World frame: x east, y south, metres. Chart extent 0..2048 x 0..2048. Hollow Watchtower at (1496.5, 1024.5).
- Road (recipe.path, halfWidth 3): (1480,1025) -> (1420,1032) -> (1350,1050) -> (1260,1045) -> (1180,1062) -> (1090,1070) -> (1000,1066). It is the only road. It crosses the river at x ~1027 (water wins over path in typeAt, so today the crossing is a plain wade through the river; a ford or bridge is future content).
- River: x_r(y) = 1120 + 110 sin(y/260) + 45 sin(y/95 + 1.3), water within 10 m. It runs north-south through the whole map, west of the tower.
- Signal tower (farTower billboard): (713.8, 1232.1) on the hill2 crown (58 m, radius 170). The pencil line runs tower -> signal tower (WSW).
- Existing waystone: entity `endMarker` at (1428, 1040), meadow end of the walk-out.
- **Engine/content dependency:** today's play area is `world_m1.world.json` `bounds` = a circle of r 96 m around the tower (x 1400..1593). Only 27 m of road west of the existing waystone lie inside it, too close for a useful second travel point. **Any road-west waystone needs the bounds grown** (r ~245 for ws_roadBend, or a capsule along the road; r ~510 for ws_fordWest). The nav area (192 x 192 at 1400,928) and streaming must follow. That is a PO/architect call, not designer data.
- Terrain checks below come from the baked chart (cells 8.5 x 17 m) plus the recipe rules (forest is never within 30 m of the river or 12 m of the road). Rock patches come from noise, so the preview's live check is the final word; if a spot fails there it shows red, and I nudge it.

## Candidates

| id | world x, y | place today? | milestone | why there |
|---|---|---|---|---|
| **ws_roadBend** | **1262, 1033** | exists (terrain + road), outside current bounds | **NOW** (recommended) | The road's middle bend, 167 m west of the existing waystone, on open grass 12 m north of the road centre (the north verge, so it stays clear of the roadside mesh strip on the south side). From here the road falls toward the river valley and the signal tower is straight ahead, so it reads as "halfway to the river". The forest edge (x 1314-1382, north of the road) frames it from the east. |
| **ws_fordWest** | **992, 1079** | exists (road end, river), outside current bounds | **NOW (alternative)** or M4 | The end of the road on the west bank, just past the river crossing, 15 m from the last road point. It is the natural future crossroads: the road stops here today, and chapter-two roads to Outwall (north) and the signal hill (south-west) would fork from it. 41 m from the river centre, so it's dry grass, and forest stays > 30 m back by recipe. Pick this instead of ws_roadBend if the owner wants the travel point at the road's end rather than halfway. |
| ws_outwall | 905, 940 | future (village not built) | M5 (US-099) | Proposed site for the exile village, on the west bank 130 m north of the road's end: a grass pocket (x 853-1007, y 905-965) sheltered by forest to the west and a rock outcrop to the south-east, out of sight of the road. The waystone would stand on the village green. Canon: the village is unnamed, working name "Outwall" (game-design 3). |
| ws_signalNorth | 695, 1090 | exists (open grass), future content around it | M5 (US-100/US-105) | The north foot of the signal-tower hill, 143 m from the tower, at the end of an open grass corridor that runs west from Outwall (chart rows 55-64 are almost all grass). It's the approach to the Signal Source, and from here the teal crown light is overhead. A forest belt (x 700-940) separates it from the ford, so the player walks around it to reach this spot. |
| ws_northBank | 1150, 800 | exists (terrain), future content | M4 | The east bank of the river, 225 m north of the road and 36 m from the water: a river-valley viewpoint looking north up the valley. Proposed as the waystone for the M4 tool-gated area / first dungeon entrance (US-093/094 site not chosen yet), so it doubles as a scouting suggestion for that content. |
| ws_southFields | 1300, 1400 | exists (open grass), future content | M4 / M5 | The large open grass bowl south of the tower, east of the river (x ~1040-1340, y 1290-1500): the obvious place for a south road branching off the east bank and a future farmstead or ruin. It sits 42 m from the next forest patch, with clear views back north to the Hollow Watchtower. |
| ws_westRidge | 450, 1180 | exists (terrain rises), future content | M5 / later | High ground on the western ridge (the recipe ridge rises up to 30 m west of x 700). It looks east over the whole chapter-two region with the signal tower in the middle distance and the Hollow Watchtower far behind, and it marks the western edge of the region with 3 relays. |

## Recommendation for NOW
1. **ws_roadBend (1262, 1033)**: "one more along the road west", as the owner asked. It's the shortest bounds growth that gives a meaningful hop (167 m).
2. Optional instead (not both): **ws_fordWest (992, 1079)** if the owner wants the stone at the road's end and accepts a larger bounds change (the river crossing is in play then).

The others are for M4/M5 and are placed with their content: the village, the region with relays, and the dungeon.

## Notes for PO / architect (not designer data)
- Bounds: a NOW waystone west of x 1400 needs `bounds` grown, plus `nav.area` and chunk streaming checked for that range.
- Model: reuse `waystone` (design/models/voxel_world.js) for all of them. An "untouched" vs "touched" look (dim vs aether-lit crown) would help the D-057 "only touched ones" rule read in the world; that needs a second clip or an emissive toggle (engine feature: per-entity emissive on/off).
- Relays stay save points (game-design 3/11). I kept waystones away from future relay sites so the two don't stack. If the owner wants relays to double as travel points, ws_signalNorth/ws_westRidge can merge into relays.
