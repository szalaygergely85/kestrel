# ASCII Quest - Style Guide (v1, US-002)

Owner: Designer. Data formats: `design/README.md`. Colors, ramps and materials: `design/palette.js`. Preview: `design/preview/palette.html`.

## 1. Order of importance
From GDD pillar 4, the same order decides every art call:
1. **Silhouette**: can you tell what the shape is from its outline alone?
2. **Brightness**: glyph density and color value separate near from far, lit from unlit, and important from background.
3. **Color**: hue tells you what kind of thing it is and how it feels (section 2).
4. **Texture**: mortar, grain, rivets, moss. Detail rewards a close look. It must never fight 1 to 3.

## 2. Color language
| Meaning | Colors (palette keys) | Where |
|---|---|---|
| **Warm = light, safety, goal** | `torch` `lantern` `sun` `flame*` `ember` `gold` | fire, sun patches, the beacon, UI title |
| **Cool = shadow, distance, the unknown** | `ambient` `fog` `fogFar*` `sky*` | unlit stone, far hills, depth |
| **The Dim = color being swallowed** | `dim` (desaturated violet-grey) | later milestones: corrupted areas and Dim creatures. Never used for plain shadow |
| **Interactable** | `brassLight` / `brass` glint, `gold` prompt key | lantern, lever handle, anything with `[E]` |
| **Hero / friendly** | `heroGreen` | player-side effects, later the hero's gear |
| **Danger / harm** | `danger` | enemies, hazards, damage flashes (M2+) |
| **Magic / spirit** | `magic` | spirit effects, later magic items |

Rules:
- `danger`, `magic` and `heroGreen` are **reserved**. Do not use them for scenery. In M1 none of them appear in the world at all. The world is only warm, cool and material colors, so that when they arrive later they mean something.
- Shadow is **cool, not black**: ambient `#2a3550` at 0.12 always leaves a dim bluish glyph on stone.
- Warm light is **the path**: the player walks toward warm. The brazier, then the sun patch, then the stair are lit in sequence. Do not light dead ends warmly.
- Brass is the only saturated yellow on non-fire objects. A small brass glint (a `o` that becomes a white `*` every 2 to 3 s) means "take me".
- The distant second tower is `farTower`, the darkest value in the far view, with no warm pixel. It must read as "dead".

## 3. Light and shading
- Values come from GDD 7.3 via `palette.lights`: ambient 0.12, sun 1.0 (elev 60, ESE), torch 1.0 / 6 m, lantern 0.8 / 5 m.
- Light color is a **hue**: stone under torch goes orange-brown, under sun warm grey, under ambient blue-grey. The material still shows through (tint 0.85, not 1.0).
- Sunlit floor vs shadowed floor: at least 4 ramp steps apart (US-007). The shipped values give +5 (wood, iron, ash, scorched stone) to +6 (stone, floor, rubble) before texture (see the stats line under each material in the preview).
- Overbright (b > 1, e.g. sun + torch overlap) pushes color toward the light's own hue. It is how "hot" spots look. Iron also gets a specular push (`spec` 0.4) so metal reads as metal.
- Flicker is smooth noise at 8 to 12 Hz. Fire light is never a strobe.
- Emissive cells (fire, sky) ignore light and fog.

## 4. Glyph usage
Density order matters more than the character's shape. Each ramp in `palette.ramps` is sorted by visual density.

| Material | Glyph character | Notes |
|---|---|---|
| stone | `. , : ; + % # & @` | chunky. Mortar comes from texture shade, not special glyphs |
| floor | `. , - : ; = + * # %` | lower density than walls, so walls stand up from the floor |
| ash | `. , ' : ; " ^ * %` | powdery, soft, low contrast |
| rubble | `. , : ; o O % # & @` | round `o O` pebbles |
| wood | `. - : = + \| I H #` | vertical strokes for planks, `o` knots |
| iron | `. : - = + x X # M` | hard. `o` rivets; `M` only in highlights |
| sky | `. ' - ~ = + *` | wisps; the gradient bg does most of the work |
| fire | `. ' , ^ * % #` | `^` tips, `*` body, core via color (`flameCore`) |
| grass / foliage / water (far) | `" ' , ;` / `: * % & @` / `- ~ = +` | US-016 |

- **ASCII only (32 to 126).** No `·`, `≈`, `≡`, box drawing or Unicode. `validate()` checks ramps.
- Glyph overrides in textures (rivets, knots) never appear in darkness (minimum ramp index 2).
- Letters are allowed in ramps (`I H x X M O o`). Words are not: never let a ramp spell something.

## 5. Readability rules
1. **Nothing important is ever pure black.** Within 8 m, every surface shows at least `.` (ambient guarantees b >= 0.03).
2. **Backgrounds fill surfaces.** Lit surfaces use `bg = fg * k` (k 0.15 to 0.2). The wall reads as solid, not as floating glyphs on black. Keep k at 0.25 or below, or glyphs lose contrast against their own bg.
3. **Contrast between a glyph and its bg** must stay high. Never set bg brighter than about 30% of fg on a surface.
4. **Texture fades with distance** (stone 6 to 16 m) before fog (12 to 60 m). Far surfaces read as clean shaded shape, near ones as detailed masonry. No shimmering noise at a distance.
5. **Walls brighter and denser than floors** at equal light (floor albedo 0.75 vs stone 0.85, sparser ramp). Edges of ledges and gaps then read by value alone.
6. **Gap edges** (US-012 soft gate) must stay readable with ambient only. Stone at ambient is 2 ramp steps above space, and the lantern adds at least 3 more.
7. **Hue budget per prop: at most 3 hue families** (e.g. brazier = iron + fire + stone). More turns to noise at 160x60.
8. **Half-scale test**: every prop must still read at half size. If it does not, simplify the silhouette, not the colors.
9. **Outlines**: sprites get a dark outline (`ironDark`, `stoneDark`, `mortar`, or bg-only cells) only where the silhouette would merge with a background of the same value. Never use a full black outline around everything, since it reads as a cartoon sticker against lit stone.
10. **UI text** uses `uiText` on the scene, never pure white (white is reserved for glints and flashes). Hints use `uiHint`, the dim crosshair uses `uiDim`, and targeted items get `gold`.

## 6. Distance and fog
- Interior: fog `#262f45`, starts 12 m, full 60 m. Glyphs thin to space and colors go cool and dark. Distance feels like depth, not haze.
- Far overworld: 50 m to 1500 m. Fog lightens from `fogFarNear` to `fogFar` (= sky horizon), so hills fade into the sky with no seam. Classic aerial perspective: far means lighter, bluer and less detailed.
- Color carries depth: near and lit is warm and saturated, far or shadowed is cool and desaturated.

## 7. Sprites and animation (for US-011 and later)
- Palette **keys only** in fg/bg rows, one char per cell, lined up 1:1 with glyph rows (format in README when US-011 lands).
- Anchor at the feet (bottom-centre cell).
- Motion reads through glyph swaps: anticipation (`-` to `=`), follow-through, squash and stretch (`o` to `O` to `0`), arcs with trailing `- = ~ / \ |`.
- Fire animates at 10 fps with 6 frames. Idle glints happen every 2 to 3 s and last about 0.3 s. Do not make everything move all the time. Stillness makes the moving things readable.

## 7b. Detail pass v2 rules (PROPOSED, `detail-pass.md`)
Once the engine supports v2, these rules apply:
- **One brightness is never one glyph.** Every density level has 2 to 4 equal-density alternates, picked by a world-anchored hash.
- **Structure is drawn as lines, texture as fill.** Joints, seams and beam edges are 1-cell oriented lines (`_ - / \ |`). Faces use the material's fill set. Lines stop before they get denser than about 1 per 2 cells.
- **Each material has its own vocabulary**:
  - stone: `, : ; + x %`
  - floor: `. , ' = +`, sparser and sitting lower in the cell
  - timber ceiling: grain `- ~ =` plus beams `= #`
  - moss: `" , ; % &`
  - rubble: `o O` with `,` gaps
  - brick: `= :` with `|___|`
  - grass: `" ' v w`
- **Every block or slab has its own tone** (2 to 4 per material). Big surfaces are never one flat color.
- **Faces differ by orientation**: E 1.00, S 0.90, W 0.80, N 0.72, floor 0.94, ceiling 0.62. Corners read by value even without edge glyphs.
- **Edges** (see the table in `detail-pass.md`):
  - caps `=` and convex corners are brighter
  - lips `_`, inside corners and seams are darker
  - one cell wide, never black
- **Fog is haze**: far glyphs thin to a lighter blue `. :` on a dark cool bg, never blank-black.
- Ambient-only surfaces sit at level 3 of 8 or above. No surface in view shows only `.`.

## 8. Mood target for M1 (the Awakening)
Morning. Dark cool-blue stone, one warm orange pool of light around the brazier with soot-darkened walls above it, a pale warm sun ellipse on the floor with dust motes, a strip of blue sky above broken wall tops, moss low on the north wall. The preview vignette (`preview/palette.html`, section 1) is the reference picture.
