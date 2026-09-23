# Detail pass v2 (proposal)

Owner: Designer. Data and reference code: `design/detail-pass.js` (`ASSETS.detailPass`). Preview: `design/preview/detail_pass.html`.
Status: **proposal for the architect**. The game does not load it. The v1 palette values are unchanged, so the US-004b checksum and `?shadetest=1` are unaffected.

## 1. Diagnosis: why today is 90% `.` in one near-black

Numbers are from the v1 reference shader with ambient only (preview section 2 computes them live).

| Cause | Kind |
|---|---|
| Ambient 0.12 x albedo 0.75-0.85 x texel shade 0.42-1.12 gives **b = 0.04-0.11**. The ramp curve `b^0.85` maps that to **index 1 or 2** (`.` or `,`) for every texel. | content (curve, lift) |
| Texel patterns only change **brightness**. Mortar vs block is 0.42 vs 1.0, less than one ramp step at the bottom of the ramp, so the pattern disappears. Glyph overrides exist only for rivets and knots, and only from index 2. | **engine**: the glyph must depend on the texel class, not only on brightness |
| fg gain `0.32 + 0.68 b^0.75` is about 0.4 everywhere, and the ambient tint 0.85 pulls every material to the same blue-grey. Stone, floor and mortar land about 10/255 apart (fg about `#242831`, bg about `#07080a`). | content (fgMin, tint) |
| test_room ceilings use `stone`, the same material as the walls. | content (level data) |
| Nothing knows a face's orientation. N/E/S/W walls, floor and ceiling at the same light are the same value, so corners and seams are invisible. | **engine** (normal per cell) |
| No edge or silhouette handling, no AO at seams. | **engine** (post pass) |
| Fog only darkens toward `#262f45` (about the same as unlit stone) and fades glyphs to blank. | content (colors) + engine (stipple) |
| Every surface repeats one 16x8 texture, and one brightness gives one glyph. | **engine** (hash alternates, per-block tones) |

The content levers alone (a lower `rampGamma`, a higher `fgMin`) were deliberately **not** applied to the live palette. They would change the US-004b baseline checksum while that story is in flight. They are folded into v2 instead.

## 2. The v2 look (summary; exact values are in `detail-pass.js`)

- **Glyph sets per texel class.** Each class (face, joint, band, overlay, speckle) has its own set. Brightness picks the *level*, a world-anchored hash picks an *alternate* of equal density (`,:;` at one level). Ambient-only stone lands on level 3 of 8 (`, : ;`), not `.`.
- **Joint grid** (analytic, per material): blocks `u x v` m with a stagger. A joint is drawn only in the cell whose texture footprint the line crosses, so it is exactly 1 cell thick at any distance. It uses an **oriented line glyph** `_ - / \ |` that follows the line's on-screen direction, and switches off once lines would be denser than about 1 per 2 cells.
- **Tones**: 2-4 color variants per material, picked **per block** by hash, plus +-8-14% value jitter per detail texel.
- **Face factors**: E 1.00, S 0.90, W 0.80, N 0.72, floor 0.94, ceiling 0.62. **Seam AO**: x0.6 at a concave seam, gone by 0.3 m.
- **Readability lift**: `gb = 0.12 + 0.88*min(b,1)` for glyph levels, `fgMin 0.55`, `tint 0.60`. Lit vs shadow stays 4+ levels apart (US-007 rule).
- **Edge pass**: cap `=`, lip `_`, side `|`, convex `|` (bright), concave `|` (dark), floor seam `_`, ceiling seam `-`, step nosing `=`. One cell wide, lighter or darker than the cell's own color, never black.
- **Fog v2**: from 10 m to 45 m (was 6 / 36, see section 7). fg goes toward a lighter haze `fogV2Glyph`, bg toward a dark `fogV2`. From f 0.4, a growing hashed share of cells becomes `. :` stipple. Distance reads as haze, not as black.
- **LOD tiers**: near / mid / far sets (stone mid from 12 m, far from 25 m, see section 7) with a hashed dither band. Far walls are calm shapes with block tones.
- **Materials v2**: `stone`, `stone_moss`, `stone_scorched`, `brick` (new), `floor`, `ceiling_timber` (new), `wood`, `rubble`, `grass`. v1 `iron`, `grate`, `ash`, `rock` and `sky` keep the v1 shader for now (`DP.remap`).
- **Level change (proposed, not applied)**: test_room `ceilMat: 'stone'` becomes `ceiling_timber` (`DP.levelOverrides`).

### Sample (one cell of the G-buffer the shader reads)
```
{ kind: 'wall'|'step'|'upper'|'floor'|'top'|'ceil'|'sky',
  mat: v2 key, normal: 'N'|'E'|'S'|'W'|'U'|'D', planeId,       // planeId: same id for all cells of one infinite plane
  u, v,                        // v1 texture coords (walls: along-wall m, height m; planes: world x, y)
  dudx, dvdx, dudy, dvdy,      // texture coords per screen column (x) / row (y)
  z,                           // m above the sector floor (bands: moss, soot)
  aoD,                         // m to the nearest concave seam (floor/ceiling line, inside corner), Infinity if none
  dist }                       // camera distance (fog, LOD)
```

## 3. Engine requests (for the architect to turn into a story)

Everything below is specified by the reference code in `design/detail-pass.js` (`util.shade`, `util.edgePass`). The preview implements the same pipeline on a port of the US-004 caster.

1. **G-buffer, then shade.** The caster writes one sample per cell (fields above) into typed arrays instead of shading inline. Shading and the edge pass then run over the grid. Needed because items 3 and 7 need neighbour cells.
2. **Normal + planeId per cell.** Walls: N/E/S/W from `side` and the step sign. planeId = normal + boundary coordinate. Floors, tops and ceilings: `U`/`D` + height. This drives face factors (item 5) and edges (item 7).
3. **Texture-space derivatives** `dudx, dvdx, dudy, dvdy` per cell, from neighbours on the same planeId (or analytically: walls `dv/drow = -dist/planeDistY`). Used by the joint crossing test, oriented glyphs and joint LOD.
4. **Glyph by texel class.** Replace "ramp[brightness] + rare override" with `sets[class][level(gb)]` plus an alternate picked by `hash(floor(u*detail), floor(v*detail), seed)`. Classes come from the analytic grid, band, overlay and speckle rules (not a texture lookup). Oriented sets pick their family from `orientClass(derivatives)`.
5. **Brightness terms**: `b = Lm * albedo * classShade * faceShade[normal] * ao(aoD) * jitter`. Glyph level from the lifted `gb`. fg gain `fgMin 0.55`, tint `0.60`. The caster must supply `aoD`: distance to the floor/ceiling line and to an inside corner, from the neighbour cells' solidity.
6. **Color noise**: base color = `tones[hash(blockX, course, seed)]` (weighted), times per-detail-texel jitter. Tints (mortar, moss, soot, dust) are lerped on top.
7. **Edge pass** (post, over the cell grid; needs depth, planeId, kind, fog factor): the rules and thresholds in `DP.edges` (depthRatio 1.18, depthAbs 0.35 m, fogMax 0.85). Decide all rules on the input first, then apply them. This costs one extra pass over 9,600 cells.
8. **Fog v2**: separate fg and bg fog targets, plus a hashed stipple swap to the `fog` set above f 0.4. `P.fog.glyphLevel` / fade-to-space is no longer used for interiors.
9. **Distance LOD tiers** per material (`lod.mid`, `lod.far`, `dither`), and joint suppression when the footprint exceeds `maxCover * period`. Hashes are always world-anchored (texel or block integers), never screen-anchored, so nothing shimmers when the camera moves.

Performance note: per cell this is about 3 integer hashes, 2-4 floors, 2 crossing tests and one set lookup. The sets can be flattened to `Uint8Array` levels x alternates, and the tones to a per-material RGB table. The edge pass reads 5 cells per cell. Estimate: well under 1 ms at 160x60.

## 4. Migration (after the architect story lands)
1. The engine loads `detail-pass.js` (or it is merged into `palette.js` as format v2) and uses `DP.util.resolve(kind, v1Key, level)`. v1 materials without a v2 entry keep the v1 path.
2. test_room / tower: `ceilMat` becomes `ceiling_timber` where a room has a ceiling.
3. `?shadetest` gets a v2 table: exact glyph match, and fg/bg within +-4 against `DP.util.shade` / `edgePass`.
4. Then v1 `texture.rows` and the brightness-only ramps are retired for v2 materials (kept for sky, iron, grate).

## 5. Proposed-panel export (US-028 parity AC)
`design/preview/detail_pass.html` has an **export proposed JSON** button (downloads a file) and `window.exportProposed()` (returns the object). Both re-render at the current pose first. The export is the proposed panel **before** the "show edge map" debug overlay, so that toggle does not change it. Rendering and palette values are unchanged.

```js
{
  format: 'ascii-quest/detail-pass-export', version: 2,
  stats:  { surfaceCells, dotOrBlank, dotOrBlankPct, distinctGlyphs },  // non-sky cells; the AC's '.'/blank metric
  samples: {                                  // v2: shader INPUTS per cell, row-major, cols*rows entries
    fields: ['kind','mat','matV1','normal','planeId','u','v','dist','z','aoD','dudx','dvdx','dudy','dvdy'],
    cells:  [ [ 'ceil','ceiling_timber','stone','D','c3', 4.1, 2.3, ... ], ..., null ]
  },
  level: 'test_room', panel: 'proposed',
  pose:   { x, y, z, yaw, pitch },          // world cells; yaw/pitch in degrees (yaw 0 = -y, 90 = +x)
  lights: { lantern: bool, torch: bool, sun: bool, sunAzimuth: deg },
  features: { lift, sets, detail, joints, tones, faces, ao, overlay, fog, edges }, // bools; all true = the approved look
  grid:   { cols: 160, rows: 60, cellPx, cellW, cellH, cellAspect },            // cellAspect = cellH / cellW (feeds DP.shading.cellAspect)
  glyphs: [ 'row0 (cols chars)', ... ],     // rows strings, row 0 = top
  fg:     [ [ [r,g,b], ... cols ], ... rows ],  // integers 0-255, rounded
  bg:     [ [ [r,g,b], ... cols ], ... rows ]
}
```
- Cells with no sample (drawn black) export as glyph `' '`, fg `[0,0,0]`, bg `[0,0,0]`, and `samples.cells[i] = null`.
- **Samples (version 2).** `samples.cells[y * cols + x]` is an array in `fields` order, the exact G-buffer cell the shader read (field meanings: "Sample" in section 2):
  - `kind`: `wall|step|upper|floor|top|ceil|sky`. `mat`: the v2 key the shader used (`DP.util.resolve(kind, matV1, 'test_room')`), or the v1 key if the cell stays on the v1 shader. `matV1`: the level's v1 key. `normal`: `N|E|S|W|U|D`. `planeId`: preview string (walls normal + boundary coordinate, planes kind initial + height). Compare it for equality inside one frame only, not against engine ids.
  - `u, v, dist, z, aoD, dudx, dvdx, dudy, dvdy`: numbers rounded to 1e-5. `null` means Infinity or not set (for example `aoD` with no seam in reach).
  - Sky cells: `['sky', null, null, null, 'sky', null x 9]`.
  - Same-surface matching (architect ruling 2): compare a cell only if `kind` and `mat` match the engine's; report the rest as excluded, with the reason.
- `stats` uses the same count as the preview's stats line: non-sky cells whose glyph is `' '` or `'.'`, after the edge pass.
- Version 1 files (no `samples`, no `stats`) are still valid; the other fields did not change.
- Sky cells are included (v1 sky shader, same in both panels).
- Comparison per the AC: glyph equal in >= 95% of cells; fg and bg each within +-8 per channel in >= 95% of cells. Use the same `cols x rows` and cellAspect in the game, because the caster's projection and the v2 shader both depend on them.

## 6. `ceiling_timber` tuning (US-028 architect ruling 3)
AC metric: start pose, ambient only, share of non-sky cells that show only `.` or blank must be <= 5 %. Before the tuning it was 12.8 % in the preview and 11.6 % in the engine (engine output is byte-identical to the reference, so the cause is in the content).

**Cause.** At ambient only, Lm = 0.12 and the ceiling face factor is 0.62, so b = 0.12 x albedo x shadeK x ao x jitter. With albedo 0.70: face b = 0.052, board joint (`grid.shade` 0.45) b = 0.023, beam edge (`band.edgeShade` 0.5) b = 0.026. Both are below `cutoff` 0.03, so every board joint and beam edge became a blank. The grain and beam sets never reach their `.` level while b >= cutoff, because the lift keeps gb >= 0.12.

| value | before | after |
|---|---|---|
| `albedo` | 0.70 | 0.74 |
| `grid.shade` (board joints) | 0.45 | 0.75 |
| `band.edgeShade` (beam edges) | 0.50 | 0.75 |

**Result, worked out by hand.** Cells stay above the cutoff when shadeK x ao x jitter >= 0.545 (it was 0.576).
- Joints and beam edges clear it at the lowest jitter (0.9) whenever aoD >= 0.15 m. Only joint cells within 0.15 m of a wall seam can still go blank.
- Faces (shadeK 1.0) and beams (0.85, for aoD >= 0.1 m) clear it everywhere.

**Look.** The approved look is kept.
- Joints still read as dark lines. The darkness now comes from the `woodDark` tint (0.6) and joint `bgK` 0.12.
- At ambient, the fg gain moves by less than 1 %, from 0.598 to 0.605.
- Under the lantern the joints are less dark than before, by b ratio 0.75 against 0.45.
- The ceiling face is still darker than the floor: 0.74 x 0.62 = 0.46 against the floor's 0.75 x 0.94 = 0.71.
- About half of the face cells move up one grain level, from `-` / `!` to `-~` / `|!`.

**Measured (to fill in after the re-export).** Preview: `stats.dotOrBlankPct` in `exports/detail_pass_start.json`. Engine: the programmer's tool. Target <= 5 %. If a residual remains, it is joint cells at wall seams (AO) and the fog stipple beyond 18 m. The next lever would be `grid.shade` 0.85.

## 7. Change log
**2026-09-23, US-028 owner feedback "LOD distance"** (architect note in `docs/backlog.md`, content items 4-7). Near look unchanged: near sets, `detail`, tones, joints below 6 m, edges and shading are as approved.

| value | before | after |
|---|---|---|
| `lod` (stone, stone_moss, stone_scorched, floor, ceiling_timber, wood, rubble, grass) | mid 5-6 / far 11-14 / dither 1.5-2 | mid 12 / far 25 / dither 3 |
| `brick.lod` | 4 / 9 / 1.0 | 10 / 22 / 3 |
| `stone.grid.maxCover` (all stone variants) | 0.45 | 0.5 |
| `fog.start` / `fog.full` | 6 / 36 m | 10 / 45 m (f = 0.43 at the 25 m far tier; stipple from ~26 m) |
| `fog.stipple` | [0.40, 0.85] | [0.45, 0.85] |
| mid sets `stoneMid`, `floorMid`, `grassMid` | 1-2 glyphs per level | 2-3 alternates per level |
| far sets `stoneFar`, `brickFar`, `floorFar`, `rubbleFar`, `grassFar`, `woodFar` | 1 glyph per level | 2 alternates per level |
| new sets `brickMid`, `rubbleMid` | brick / rubble used their far set for mid | own mid sets, 2-3 alternates |

**Reference shader change** (`util.shade`): the hashed alternate is now picked in **every** tier (`alt = F.detail`, was `tier === 0 && F.detail`). Without it the new alternates would never show. The engine must do the same; the alternate still uses the world-anchored `hA` of the detail texel, and with the architect's per-cell detail octave (engine item 1) it will not shimmer at distance. Oriented sets (`grainU`, `grainV`, `beam`) are unchanged: they are near sets too, and their per-direction glyphs are single by design.

Follow-ups: re-export `exports/detail_pass_start.json` in the preview, the programmer re-records the v2 bench baseline, then the acceptance check (walls <= 12 m keep >= 10 distinct glyphs, joints > 0 % to 20 m).
