# US-016 Far overworld : the Emberlands from the breach (v1)

Owner: Designer. **Data + reference generator**: `design/levels/overworld_far.js` (`ASSETS.levels.overworld_far`). **Mock-up**: `design/preview/overworld.html`. That page is a 160x60 column heightmap projection from the breach, a top-down map, the terrain swatches and the far-tower silhouette, and it runs automated checks.

## 1. Frame and scale
- **Axes:** metres; x = east, y = south (the same axes as `tower.js`). z = metres relative to the tower ground floor.
- **Position:** `far = level + origin`, with `origin = (1480, 1018)`.
- **Heightmap:** **256 x 256 cells, 8 m each** (2048 m square). Our tower sits at (1496.5, 1024.5), near the east side, so about 1.5 km of land lies west, in front of the breach.
- **Eye:** at the breach, level (6.5..7.5, 7.0) at z **7.6** (walkway 6.0 + 1.6), looking west (yaw 270).
- **Seam:** the heightmap next to the level's west edge matches the level's outside cells (2.4 m grass, within 1.8 m). The level geometry hands over to the far pass with no step. This is checked in the preview.

## 2. Recipe (seed 7331, deterministic)
`h = home + hill2 + rolling + valley + ridge`, then river and path carving, then a slope pass that assigns rock and forest. The reference `util.generate()` returns `{height: Float32Array, type: Uint8Array}`; the engine bakes it once at load.

| term | formula | purpose |
|---|---|---|
| home | `2.4 - 70 * (1 - exp(-(d_tower/300)^2))` | our hilltop, falling about 70 m into the land |
| hill2 | `58 * exp(-(d_far/170)^2)` | the crown under the far tower, about -10 m |
| rolling | `(fbm(x/520, y/520; 5 oct) - 0.5) * 34`, faded to 0 on both crowns | rolling hills |
| river | centre `x_r(y) = 1120 + 110 sin(y/260) + 45 sin(y/95 + 1.3)`; cells with `|x - x_r| < 10` are water, carved 2 m | a blue `~` river meandering N-S about 450 m west |
| valley | `-22 * exp(-((x - x_r)/160)^2)` | the river valley |
| ridge | `+30 * smoothstep(x 700 -> 150) * (0.6 + 0.4 fbm)` | far western hills that fade into the haze below the horizon |
| path | polyline from the outcrop to a ford, half width 3 m | the way down, "go out there" |
| rock | slope > 0.42, or crag fbm(x/90) > 0.78 | grey outcrops |
| forest | fbm(x/280) > 0.55 on slope < 0.5; clear of the river (30 m), path (12 m) and our hilltop (110 m); canopy +10 m | forest patches, 10-50% of the land in view |

## 3. Look per terrain type
Lighting: `b = ambientI + sunI * max(0, N.L)`, using the level's sun (elevation 60, from ESE). The breach faces west, so the land is front-lit. The color index is dark / mid / light at b < 0.45 / < 0.8 / above, with a per-cell hash of +-1 for variation. fg uses the US-002 gain curve, and bg = fg * 0.3.

| type | colors (dark/mid/light) | near < 150 m | mid < 600 m | far |
|---|---|---|---|---|
| grass | grassDark / grass / grassLight | `" ' , ;` | `, ' .` | `. ,` |
| forest | forestDark / forest / grassDark | `& % @` | `% &` | `% :` |
| river | river / river / riverLight | `~ -` | `~ -` | `- ~` |
| rock | stoneDark / rock / stoneLight | `# %` | `% #` | `%` |
| path | strawDark / strawDark / straw | `. :` | `.` | `.` |

The river glints: the glyph toggles `~`/`-` and fg lerps 35% toward `riverLight` on a moving hash at 1.5 Hz. Forest is drawn 10 m taller (canopy), so it forms soft skyline bumps.

## 4. Fog and sky
- Palette `fog.far`: start **50 m**, full **1500 m**, curve 0.7.
- The fog color itself goes from `fogFarNear #8fa8c4` to `fogFar #c4dcef` by the same factor. fg lerps by f, and bg lerps by min(1, 1.1f). At f > 0.85 the glyph becomes a space (pure haze).
- `fogFar == skyHorizon`, so the land melts into the sky with no seam. Out-of-map samples are horizon haze.
- Sky: `util.shadeSky` (morning gradient and clouds), the same as the tower's sky ceilings.

## 5. The far tower (the hook)
- **Position:** (713.8, 1232.1): **800 m from the breach at azimuth 255 (WSW)**. That is 15 degrees left of the view centre, framed by the breach.
- **Setting:** it stands on the hill2 crown (ground about -10). It is 42 m tall and 14 m wide, and its top is about 1.9 degrees above the horizon, so it **breaks the skyline**.
- **Dark and cold:** color `farTower #1a1d26`, darker than every terrain color. It is **not lit and not emissive**, and fog on it is **capped at 0.40**, so it stays a clearly dark notch against the pale haze. This is readability over realism. US-022 (our beacon lit) changes nothing here.
- **Silhouette:** a billboard at world size, but never smaller than the **3x4 min sprite** (`n n` / `|#|` / `|#|` / `/#\`: the broken top has a notch where its cold bowl is). A 5x8 detail sprite, with a dark window slit, is used if the projection is 12 or more rows tall. At 800 m on a 160x60 screen the real size is about 2x3 cells, so the min sprite is what the player sees.

## 6. Far pass notes (US-016 programmer; D-002)
- **Per column:** march `z` from 8 m, with `z += 0.5 + 0.015 z`. That is about 260 samples to 2 km, or about 42k samples for 160 columns, well inside the 4 ms budget.
  - Sample the height bilinearly, adding the canopy for forest.
  - Project with the **same horizonRow and focalRows as the sector raycaster**: `row = horizon - (h - eyeZ)/z_perp * focalRows`.
  - Fill upward with a y-buffer.
  - The horizon then lines up at every pitch (y-shear moves both passes identically).
- **Where to draw:** only where the sector pass produced `"sky"` / out-of-map cells: through the breach, above the parapets, and over the low west wall.
- **Far tower:** drawn as a billboard after the terrain, with a per-cell depth test against the terrain distance.
- **Bake once:** the lighting `b` per heightmap cell only needs the sun direction.
