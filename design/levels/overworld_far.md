# World terrain recipe : US-016 far view (v1) + US-016b near LOD and handover (v2)

## US-016b (v2) summary: D-007 world terrain
**(a) One analytic surface.** `util.heightAt(x, y)` and `util.typeAt(x, y)` are pure functions of any finite world position.
- **No grid, no sample spacing:** the 2 m near chunks (`util.bakeChunk(cx, cy)`, 64x64 cells), the 8 m far grid (`util.generate()`) and physics all read the same surface.
- **heightAt is continuous everywhere:** C0, smooth except the deliberate linear handover. The v1 river bed step was replaced by a smoothstep carve (14 m to 8 m from the centre line).
- **typeAt** uses a fixed 2 m central difference for slope, so it never depends on the caller's spacing.
- **Finite everywhere:** both are defined outside the 2 km far grid too (the recipe continues) and never return NaN. Wrong call shapes throw a TypeError, for example v1's `heightAt(G, x, y)`; baked grids are read with `util.gridHeight(G, x, y)`.
- The preview checks all of this: continuity, grid = function, 2 m and 8 m agreement, and a NaN sweep over -1000..3050 m.

**(b) Near LOD (2 m cells within 300 m).** Spec in `nearLOD`:
- **Bands:** close < 40 m, near < 150 m, mid < 300 m. The mid set is the same one the far grid uses there, and the 280-320 m handover is a stable per-world-cell dither.
- **Stable glyphs:** variation is hashed on the 2 m world cell, never the screen cell, so nothing shimmers.
- **Surface row vs face rows:** the top row a sample paints gets the band glyph; the slope or canopy face below uses `type.face` at 0.8x brightness.
- **Forest trunks:** the lowest 3 m of the canopy face shows `|` trunks in `woodDark` for 1 cell in 3.
- **Micro shading:** brightness jitter of +-0.08, shading only.
- **Features:** wildflowers `* ,` in gold / strawLight / white (never red), pebbles, tall grass, reeds near water, foam at the banks.
- **Step LOD:** `max(0.5 m, 0.012 * distance)`.

**(c) Crown and handover.** A flat **2.4 m crown**: override stamp `towerCrown`, disc r 20 m around (1492, 1025) with a 60 m smoothstep skirt, painted bare grass to r 26 m. It covers the whole 24x14 tower footprint including the bastion and outcrop.
- **Handover rule** (`structures[]`): within **6 m** outside a structure footprint, terrain blends **linearly** to the nearest outer-ring cell height: `h = ring + (terrain - ring) * d/6`.
- **The tower's outer ring is now uniformly 2.4 m.** Legend `,` was raised from 1.0 to 2.4 m in `tower.js`; M1 cannot reach those cells. The mismatch where the player crosses the edge is therefore **exactly 0** (it was 1.8 m).
- **Authoring rule for future structures:** keep the outer ring flat, or varying by at most 0.3 m between neighbours.

**(d) Per-chunk overrides, for the editor.** Authored changes live in `overrides`, a plain JSON object keyed by chunk `"cx,cy"` (128 m chunks, the chunk containing the item's centre). Each chunk holds two ordered lists:
- **`stamps`:** `{id, shape: 'disc'|'rect', x, y, r | w,h, falloff, mode: 'flatten'|'set'|'add', h}` edit the height. Weight 1 inside the shape, smoothstep to 0 over `falloff`.
- **`paints`:** `{id, shape, x, y, r | w,h, type, mode: 'set'|'erase'}` force or clear a terrain type. The later entry wins.

They are applied in this order: recipe, stamps, structure handover (the handover always wins at a footprint, so placed buildings never float), then for types: river, path, paints, slope and noise rules. At load the engine flattens every chunk's items into one spatial index, because a stamp's falloff may reach into neighbouring chunks.
- **The editor** only ever adds, moves or deletes these small objects and re-bakes the affected chunks. Since generation is deterministic, regeneration is the only "streaming".
- **Saving** serialises `overrides` as-is, with no binary heightmaps: the seed plus overrides is the whole world.
- The tower crown is the first real override, and the preview checks that overrides round-trip through JSON.

---

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
- **Where the data lives (US-016 tech notes, architecture.md 14.4 item 7):** the frames are the sprite model `design/models/far_tower.js` (`ASSETS.models.farTower`: base = detail 5x8, `lods.min` = 3x4, plus `frames.min` / `frames.detail` aliases). The recipe only keeps `farTower.model = 'farTower'`, `minCells`, `detailRows` and the position/size numbers. The engine draws it as the `billboard` entity `farTower` in `design/levels/world_m1.js` (`unlit`, `fogModel 'far'`, `fogMax 0.40`, `sizeM 14x42`, `minCells 3x4`, `detailRows 12`, `z -8`) through the sprite pass, depth-tested against the terrain. Nothing in terrain code knows about it.

## 6. Far pass notes (US-016 programmer; D-002)
- **Per column:** march `z` from 8 m, with `z += 0.5 + 0.015 z`. That is about 260 samples to 2 km, or about 42k samples for 160 columns, well inside the 4 ms budget.
  - Sample the height bilinearly, adding the canopy for forest.
  - Project with the **same horizonRow and focalRows as the sector raycaster**: `row = horizon - (h - eyeZ)/z_perp * focalRows`.
  - Fill upward with a y-buffer.
  - The horizon then lines up at every pitch (y-shear moves both passes identically).
- **Where to draw:** only where the sector pass produced `"sky"` / out-of-map cells: through the breach, above the parapets, and over the low west wall.
- **Far tower:** drawn as a billboard after the terrain, with a per-cell depth test against the terrain distance.
- **Bake once:** the lighting `b` per heightmap cell only needs the sun direction.
