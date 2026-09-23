# design/ - data formats

Owner: Designer. The programmer uses these files directly. Every format change goes in the change log at the bottom.

| File | What |
|---|---|
| `palette.js` | Master palette, glyph ramps, lights, fog, time of day, materials, reference shader (US-002) |
| `style-guide.md` | Color language, readability rules, glyph usage |
| `preview/palette.html` | PO review page: vignette, materials under dark/torch/sun/lantern + interactive light, ramps, fog, sky, UI colors, named colors |
| `preview/materials.html` | Alias that redirects to `palette.html` (the name used in the US-002 acceptance criteria) |

---

## 1. palette.js

### 1.1 Loading

`palette.js` is a **plain script with no `export` statement**. It sets `window.ASSETS.palette`.

The game is served over http and uses ES modules. Load the palette in either of two ways:

```html
<!-- game/index.html: classic tag before the game's module entry point -->
<script src="../design/palette.js"></script>
<script type="module" src="js/main.js"></script>
```
```js
// or, inside a module: side-effect import (no named exports)
import '../../design/palette.js';
const P = window.ASSETS.palette;
```

There are no named exports on purpose. Design data files stay plain scripts so the standalone preview pages in `design/preview/` also work when opened straight from disk. Under Node it also sets `module.exports` (for tests).

### 1.2 Export shape (`ASSETS.palette`)

```
{
  version: 1,
  colors:    { [key]: '#rrggbb' },            // THE source of truth, named colors
  rgb:       { [key]: [r,g,b] },              // derived at load, 0..255
  hue:       { [key]: [r,g,b] },              // derived, normalised so max channel = 1 (use for LIGHT colors)
  ramps:     { [key]: ' .:...' },             // glyph strings, index 0 = space (darkest), last = brightest
  shading:   { cutoff, rampGamma, fgMin, fgGamma, fgMaxGain, tint, overbright, overbrightMax, glyphOverrideMinIndex },
  lights:    { ambient, sun, torch, lantern, beacon },   // GDD 7.3 values, colors by key
  fog:       { glyphLevel, interior:{color,start,full,curve}, far:{color,colorFar,start,full,curve} },
  timeOfDay: { morning|noon|dusk|night: { ambient, ambientI, sun, sunI, sunElev, sky:[{t,c}], cloud, fog } },
  defaultTime: 'morning',
  materials: { [key]: Material },
  semantic:  { hero, danger, magic, interact, warmSafe, coolShadow, theDim },   // -> color keys
  ui:        { text, hint, dim, crosshair, crosshairActive, prompt, promptKey, title:[keys], subtitle, endText },
  util:      { shade, shadeSky, addLight, falloff, rampIndex, rampGlyph, buildLUT, fogFactor, bandFactor,
               texel, skyGradient, hexToRgb, rgbToHex, css, clamp01, smoothstep, validate }
}
```

Rule: everything outside `colors` refers to colors **by key**, never by hex. Sprites (US-011 and later) use these keys in their fg/bg rows.

### 1.3 Required colors (US-002)
`ambient #2a3550`, `sun #fff2d0`, `torch #ff9a3c`, `lantern #ffd27a`, `fog`, `skyTop`, `skyHorizon`, `stoneLight`, `stoneMid`, `stoneDark`, `moss`, `wood`, `iron`, `brass`, `ash`, `straw`. All present, plus variants (`...Light`, `...Dark`), fire, far-overworld, UI and time-of-day colors.

### 1.4 Ramps
| key | glyphs | use |
|---|---|---|
| `default` | ` .,:;-=+*o#%&@` (14) | Generic. Contains the D-002 / US-001 ramp ` .:-=+*#%@` in the same order |
| `fine` | 70-step classic | Smooth gradients (fades, far view, UI) |
| `stone` | ` .,:;+%#&@` | walls |
| `wood` | ` .-:=+\|IH#` | planks, beams, lever |
| `iron` | ` .:-=+xX#M` | brazier, bowl, grate frame |
| `floor` | ` .,-:;=+*#%` | flagstone floors |
| `ash` | ` .,':;"^*%` | cold ash |
| `rubble` | ` .,:;oO%#&@` | fallen blocks |
| `sky` | ` .'-~=+*` | cloud density |
| `fire`, `grass`, `foliage`, `water` | | US-011 flames, US-016 far terrain |

**Brightness to glyph** (`util.rampIndex(len, b, gamma)`):
```
if b < shading.cutoff (0.03)      -> index 0 (space)
t = min(b,1) ^ gamma              (gamma = material.rampGamma || shading.rampGamma = 0.85)
index = 1 + min(len-2, floor(t * (len-1)))
```
Any lit surface (b >= 0.03) gets at least the first visible glyph. This covers the GDD rule "glyph `.` at minimum on lit-less walls". Use `util.buildLUT(ramp, 256)` to get a lookup table for speed.

### 1.5 Lights
- A light color is a **hue** (`P.hue[key]`, max channel = 1). Intensity carries the energy. So ambient `#2a3550` at 0.12 gives brightness 0.12 with a cool blue hue. It is not multiplied down by its own dark hex a second time.
- Accumulate per surface cell: `L = [0,0,0]`, then `addLight(L, key, amount)` for each light, where
  `amount = intensity * flicker * falloff(d, radius) * max(0, N.L) * shadow` (ambient: `amount = intensity`).
- `falloff(d, r) = (1 - (d/r)^2)^2`, exactly 0 at `r`, no ring edge (US-006).
- Sun: `elevation` 60, `azimuth` 112.5 (compass degrees, 0 = north, clockwise, the direction the light comes FROM, so ESE). Note that a vertical wall facing the sun gets at most N.L = cos(60) = 0.5 and a floor gets sin(60) = 0.87. Floors are the bright surfaces in the shaft, as the GDD intends.
- Flicker: `{hzMin, hzMax, amount, jitter}`. Use smooth value noise, not per-frame random. The preview uses two octaves at 8 and 12 Hz: `1 + amount * (0.6*n(t*8) + 0.4*n(t*12))`.
- `lights.beacon` holds the US-022 values (radius 12, which may be tuned down to 8).

### 1.6 Materials
```
Material = {
  kind?: 'sky',                    // only the sky; everything else is a lit surface
  desc: string,
  base: colorKey,                  // fg color at full light
  albedo: 0..1,                    // brightness multiplier
  ramp: rampKey,
  rampGamma?: number,              // optional override
  bg: { mode: 'darken', k } | { mode: 'black' } | { mode: 'fixed', color: colorKey },
  spec?: 0..1,                     // metal highlight: fg pushed toward the light hue at high b
  emissive?: 0..1,                 // added to brightness (not used by M1 surfaces)
  tintBand?: { full: m, zero: m }, // texel tints (moss, soot) at 100% up to `full` m above the sector floor, 0% at `zero`
  textureFade: [start m, end m],   // texture contrast fades out with camera distance (stops shimmer)
  texture?: {
    w, h,                          // texels
    scale: [u, v],                 // texels per meter (sky: per degree)
    rows: [h strings of w chars],  // written TOP-DOWN as seen on the wall
    key: { [char]: { shade, tint?: colorKey, amount?: 0..1, glyph?: char } }
  }
}
```
M1 materials: `stone`, `stone_moss`, `stone_scorched`, `floor`, `ash`, `wood`, `iron`, `rubble`, `grass`, `rock` (v1.1), `sky`.

**Texture coordinates** (`util.texel(tex, u, v)`):
- Walls: `u` = distance along the wall in meters (continuous across adjacent cells, i.e. world x or y of the hit), `v` = world height `z` in meters. **v grows upward**. The row used is `rows[h-1 - (floor(v*scale[1]) mod h)]`.
- Floors / ceilings: `u` = world x, `v` = world y.
- Sky: `u` = azimuth in degrees, `v` = elevation in degrees.
- Stone scale `[16,16]` with a 16x8 pattern means blocks are 0.5 m wide and 0.25 m tall, with mortar every 0.25 m and courses staggered by half a block. At 3 m that is about 2 columns and 1 row per texel.
- Glyph overrides (`glyph` in a key, e.g. rivets and knots `o`) apply only while texture fade is above 0.5 and the ramp index is at least `shading.glyphOverrideMinIndex` (2), so they never appear in darkness.

### 1.7 Shading pipeline (reference: `util.shade(mat, L, u, v, dist, out, opt)`)
Per visible surface cell:
1. **Texel**: look up `e = texel(tex, u, v)`. Texture fade: `tf = 1 - smoothstep(fadeStart, fadeEnd, dist)`. Band factor: `bf = bandFactor(tintBand, z)` for tinted texels, else 1. Then `s = 1 + (e.shade-1)*tf*bf`, and the base color is lerped toward `e.tint` by `amount*tf*bf`.
2. **Brightness**: `b = max(L.r, L.g, L.b) * albedo * s + emissive`.
3. **Fog factor** (interior): `f = 0` below 12 m, `((d-12)/(60-12))^curve` up to 60 m, then 1.
4. **Glyph**: `ramp[rampIndex(len, b*(1-f) + fog.glyphLevel*f)]`. Glyphs thin out to space in fog.
5. **Color**: light hue `h = L / max(L)`. Tint `t = 1 + (h-1)*0.85`. Gain `= fgMin + (1-fgMin) * min(b,1)^fgGamma` (0.32 and 0.75). Above b = 1 the gain rises by 0.5 per unit, capped at 1.2. `fg = base * t * gain`.
6. **Hot highlight**: `hot = spec*min(b,1)^3 + min(0.5, (b-1)*0.6 if b>1)`, capped at 0.8. `fg` is lerped toward `255*(0.5+0.5*h)`. Clamp to 255.
7. **Background**: `darken` gives `bg = fg * k`, `black` gives 0, `fixed` gives that color.
8. **Fog color**: `fg` and `bg` are lerped toward `rgb[fog.interior.color]` by `f`.

Output: `out.glyph`, `out.fg[3]`, `out.bg[3]` (0..255 floats) and `out.b`. Pass a reused `out` object: the function allocates nothing when `out` has `fg` and `bg` arrays.

**Sky** (`shadeSky(az, elev, out, timeKey)`): `bg` = gradient of `timeOfDay[t].sky` stops at `t = elev / 60`. Cloud density `d` = texel shade, faded in over 0 to 2 deg of elevation and out over 35 to 55 deg. Glyph = sky ramp at `d`, `fg = lerp(bg, cloud color, 0.35 + 0.65*d)`. Not lit, not fogged.

### 1.8 Fog
- **Interior** (`fog.interior`): color `fog #262f45`, start 12 m, full 60 m, linear. Glyphs fade to space. The tower is about 10 m across, so this mostly affects looking up the tower and long diagonals, and keeps distant cells calm.
- **Far overworld** (`fog.far`, US-016): start 50 m, full 1500 m, curve 0.7. The fog color itself is lerped from `fogFarNear #8fa8c4` to `fogFar #c4dcef` (= `skyHorizon`) by the same factor, and terrain fg/bg are lerped toward it. The far horizon therefore meets the sky seamlessly.
- Texture fade (above) happens earlier than fog (6 to 16 m for stone), so far walls read as clean shaded shapes rather than noise.

### 1.9 Self-check
`P.util.validate()` returns `[]` when every texture row has the right length, every texel char is in its key, every color key exists and every ramp starts with a space and is pure ASCII. The preview shows the result at the top.

---

## 2. Engine notes for the PO / programmer

1. **Per-cell emissive**: the sky is emissive (not lit, not fogged). The brazier flame (US-011) and beacon fire (US-022) will also mark cells emissive, drawn at full color and ignoring light and fog.
2. **tintBand needs the hit height above the sector floor** (`opt.z`), so moss and soot stay near the ground on full-height tower walls. Cheap: the raycaster already knows the wall hit height.
3. **Texture fade by distance** needs only `dist`, which the raycaster already has for fog.
4. **Hint text must be ASCII**: the GDD/US-015 hint `WASD move · Mouse look` contains `·` (non-ASCII). The design uses `WASD move - Mouse look`. The PO should update the story text.
5. The reference `shade()` is correct but not tuned for speed. For 160x60 at 60 fps the engine may precompute `buildLUT` per ramp and inline the math. Results should match the preview.

---

## 3. Levels (`design/levels/*.js`)

Plain scripts that set `ASSETS.levels.<name>`. Each has a companion `design/levels/<name>_layout.md` and a preview. The format is **`game/js/world/MAP_FORMAT.md` v1**, validated by `loadLevel` in `game/js/world/Level.js`. The preview runs the real loader when served over http. In summary:
- `rows[y]` strings, one char per 1 m cell; x = east, y = south.
- `legend[char]` = sector `{ floorH, ceilH: number | 'sky', wallMat, floorMat, ceilMat, solid }`.
- Optional extensions (full list in `tower_layout.md` section 6):
  - solid cells keep `floorH` = wall top
  - `topH`, `upperMat`
  - `dynamic` (moving ceiling)
  - `zone` and `tag`
  - `layers.tilt`
  - level-level `start`, `sun`, `lights`, `props`, `triggers`, `markers`, `route`

Lights reference `palette.lights` presets and props reference US-011 model names. The programmer ports the data file into `game/js/world/levels/` (the US-003 location). The final field names follow `game/js/world/MAP_FORMAT.md` once it is merged.

---

## 4. Sprite models (`design/models/*.js`, US-011)

Plain scripts that set `ASSETS.models.<name>`. Files and models:
- `brazier.js`: `brazier`, plus `beaconFire`
- `lantern.js`: `lantern`
- `lever.js`: `lever`
- `boulder.js`: `boulder`
- `rubble.js`: `rubble` (variants), `pallet`, `beaconBowl`

The grate is **not** a sprite. It is the palette material `grate` (wall pattern).

```
Model = {
  name, desc,
  size:   { w, h },            // cells
  anchor: { x, y },            // cell that sits on the floor point (feet), usually bottom-centre
  world:  { w, h },            // metres: the billboard's real size, used for distance scaling
  directions: ['S'],           // billboards: one view for every angle
  billboard: true,
  keys: { [char]: { c: paletteColorKey, e?: true } },   // e = emissive (flames, embers, glints)
  animations: { [name]: { fps | durations: [ms per frame], loop, frames: [Frame] } },
  lods: { half: { size, anchor, animations: {same names} } },   // hand-drawn half-scale version
  // model-specific: light, flameUnit, grow, mounts, mountOn, roll, interact, variants
}
Frame = { S: { glyphs: [h strings of w], fg: [h strings of w key chars], n?: [h strings], bg?: [h strings] } }
```
- **Cells**: `glyphs[r][c]` is drawn in `keys[fg[r][c]].c`. A space glyph (fg char space) is **transparent**. `bg` is omitted: sprites have no background, so the wall shows through behind every glyph.
- **Emissive** (`e: true`): full palette color, **ignores light and fog** (`util.shadeSprite(..., emissive=true)`). This is the US-004 emissive flag.
- **Lit cells**: `util.shadeSprite(key, L, nf, false, fogF)`, with L = the light at the sprite position, same as for surfaces. `nf` is the normal factor. `n` rows give a rough cell normal:
  - `f` front, `l` left, `r` right, `u` up, `d` down; `.` or missing = `f`
  - vectors in billboard space (x right, y up, z toward camera): f (0,0,1), l (-.7,0,.7), r (.7,0,.7), u (0,.7,.7), d (0,-.7,.7)
  - `nf = max(0, dot(n, lightDirInBillboardSpace))`; the brightness factor is `0.35 + 0.65*nf`
  - the engine may pass `nf = 1` everywhere to skip it
- **Timing**: `fps`, or `durations` (ms per frame, for idle glints: long rest, short flash). `fps: 0` = driven by gameplay (boulder: distance rolled).
- **Scaling / LOD**: on-screen height in cells = `world.h * projectionScale / distance`, and `scale` = that / `size.h`.
  - If `scale < 0.75` and `lods.half` exists, use the half version with `scale * 2`.
  - Sample nearest: screen cell (i,j) of the sprite rect maps to sprite cell (floor(i/scale), floor(j/scale)).
  - Never upscale beyond `3 * rows / 60` (3x at 160x60, 4.5x at 240x90, 6x at 320x120). The cap is in **art cells per scene cell**; it scales with the grid so a prop keeps its on-screen size (D-009 grids). A fixed 3x would halve every near prop at 320x120.
  - The preview shows near (2x), mid (1x) and far (half LOD); its 160 / 240 / 320 toggle re-samples at `rows/60` times those scales in matching cell sizes.
  - **320x120 readability (designer check, 2026-09-23):** all five props (lantern, brazier, lever, boulder, rubble) and the pallet / bowl read at 2x nearest sampling in 6x9 px cells: silhouettes, emissive glints and the fire hold. Cost: interior glyphs repeat as 2x2 blocks (`/` becomes a slash texture), so near props look "tiled". Acceptable for M1; a hand-drawn `lods.double` tier (2w x 2h, used when `scale >= 1.5`) is the follow-up if the owner wants crisp near props at 320.
- **Mounts**: `beaconBowl.mounts.fire = {x,y}` is the bowl cell where the `beaconFire` anchor goes, so the fire's bottom row covers the ash row.
- **Grow-in** (`beaconFire.grow`), at growth g in 0..1 over 1 s:
  - show a flame cell only if `rowFromBottom < ceil(g*4)`
  - lower its heat by `round((1-g)*2)` and hide it below heat 1

### 4.1 World billboard entities (`far_tower.js`, US-016; architecture.md 14.4 item 7)

A world file (`design/levels/world_m1.js`) may place a sprite model directly as an entity of `type: 'billboard'`. It is drawn by the ordinary sprite pass (depth-tested against sectors **and** terrain), never by terrain code:
```
{ id, type: 'billboard', x, y, z,          // world metres; the model anchor sits at (x, y, z)
  model: modelName,                          // ASSETS.models[modelName], section 4 format
  sizeM: { w, h },                           // metres on screen (= model.world)
  unlit?: true,                              // light = 1, no N.L, `n` rows ignored
  fogModel?: 'interior' | 'far', fogMax?: 0..1,   // fogF = min(fogMax, fogFactor(dist, fogModel)); fog color per that preset
  minCells?: { w, h },                       // clamp AFTER LOD: never drawn smaller than this
  detailRows?: n }                           // projected rows >= n -> base frames; else `lods.min` frames
```
- The model may carry the same fields as defaults (`far_tower.js` does); the entity wins if both are set.
- **Frame choice:** the base `size` / `animations` are the *detail* frames; `lods.min` holds the minimum frames (same shape as `lods.half`). `frames.min` / `frames.detail` are convenience aliases with `size`, `anchor`, `glyphs`, `fg`.
- `noUpscaleCap: true` on the model means the `3 * rows / 60` cap of section 4 does not apply (the world size is the truth; the far tower is 14 x 42 m and can never reach that cap anyway).
- **`farTower`** (`design/models/far_tower.js`): detail 5x8 (window slit `k` = `black`), min 3x4 (`n n` / `|#|` / `|#|` / `/#\`), color `farTower` only, `unlit`, `fogModel 'far'`, `fogMax 0.40`, `minCells 3x4`, `detailRows 12`. Placed in `world_m1.js` at (713.8, 1232.1, -8). `overworld_far.farTower` keeps only `model: 'farTower'` + numbers; the inline `sprite` block is gone. Preview: `preview/overworld.html` (loads `../models/far_tower.js`).

---

## 5. Title and UI styling (`design/models/title.js`, US-015)

`title.js` sets three things:

**`ASSETS.models.title`** (68x8 logo) and **`ASSETS.models.subtitle`** (1 row). These use the sprite format from section 4, with `ui: true`. Every key is emissive: drawn at full palette color over the 3D view.
- **Layout:** the logo anchor goes at `layout.centerX = 80`, row `layout.top = 18` of the **160x60 UI grid** (`uiStyle.uiGrid`, not the scene grid). The subtitle sits `belowTitle = 1` row under the logo.
- **Hold-phase shine:** `title.shine` sweeps a diagonal band across the `#` cells once per 2.2 s, lerping them toward white by 0.55.

**`ASSETS.uiStyle`**: styling data for everything that draws text:
- **`uiGrid` + `uiScale`** (D-009 amendment, 2026-09-23): the UI lives in a **fixed 160x60 UI grid**, drawn as a **separate text layer** over the scene grid (`mode: 'layer'`). `cellScale = sceneCols / 160` (1.0 / 1.5 / 2.0 for 160x60 / 240x90 / 320x120), so a UI glyph is always 12x18 px at 1920x1080. **Every layout number in `uiStyle`, `title.layout` and `subtitle.layout` is a UI-grid cell.** Rules:
  - the layer is drawn after the scene, transparent bg, glyph + fg only; the fade rule applies unchanged;
  - **plates** stay a scene-pass effect: UI rect `[ux, ux+w) x [uy, uy+h)` (+pad) darkens scene cells `floor(ux*s) .. ceil((ux+w)*s)-1`, rows likewise;
  - the **blink** eyelid is a scene effect (scene rows; `edgeRows` scales with `rows/60`), and the UI layer is masked to the same open fraction;
  - the crosshair is UI cell (80, 30); the prompt is `rowsBelowCrosshair` UI rows under it;
  - `mode: 'cells'` (one glyph per scene cell, layout numbers multiplied by `s`) is only a fallback for the CPU 160x60 path, where `s = 1` anyway.
  - **Engine needs (for the architect):** (1) a second cell layer at 160x60 with transparent bg composited after the scene pass (a second instance of the cell presenter, or a Canvas2D/DOM `<pre>` overlay sized to the viewport); (2) the plate written into the scene bg/fg multiply before present (a per-cell multiplier mask or the compositor's UI hook); (3) a `uiGrid -> scene` cell mapping helper used by both the plate and the blink mask; (4) sprite upscale cap `3 * rows / 60` (section 4).
- **`fade`**: the rule every UI fade uses, including US-017's fade to black. Glyphs dim **down** the default ramp: `ramp[round(a * index)]`, where letters count as index 9. fg is multiplied by `0.25 + 0.75a`, and nothing is drawn at a = 0. No alpha blending.
- **`titleCard`**: fade in 1.0 s, hold 3.0 s, fade out 1.0 s.
- **`hint` + `hints[]`**:
  - bottom-left at x 2, 2 rows above the bottom, stacking upward
  - prefix `> ` in `uiDim`, text in `uiHint`, key words in `gold`
  - a soft **plate**: scene bg (and fg) multiplied by 0.35, 1 cell around the text, with the texture calmed to ramp index <= 2
  - fade in 0.3 s, fade out 0.5 s, timeout 8 s
  - texts exactly as in US-015
- **`crosshair`**: `+`, `uiDim` idle, `gold` when targeting.
- **`prompt`**: 2 rows below the crosshair, centred, `[E]` in gold, same plate.
- **`endText`** (US-017): centred from row 24, 30 cps with a blinking `_` cursor. The beacon-lit alt line is included.
- **`pause`**: `Click to resume`.
- **`blink`**: the eyelid curve `[t, open]` including the half-close. The lid edge row is `-` in `emberDark` at 50%.

---

## 6. Detail pass v2 (PROPOSED, not loaded by the game)

- `detail-pass.js` sets `ASSETS.detailPass` (load it after `palette.js`). It adds:
  - glyph sets chosen by texel class
  - an analytic joint grid with oriented line glyphs
  - per-block tones
  - face factors and seam AO
  - a readability lift
  - an edge pass
  - fog v2 and LOD tiers
- It also adds 9 v2 materials, a v1 -> v2 `remap`, and proposed `levelOverrides`. The reference functions are `util.shade(sample, L, out, flags)` and `util.edgePass(cols, rows, G, C)`.
- Full spec, the diagnosis and the **engine request list**: `design/detail-pass.md`. Preview: `preview/detail_pass.html` (today vs proposed on test_room, close-ups, distance strips, glyph vocabulary, edge rules).
- Nothing in `ASSETS.palette` materials, ramps, shading, lights or fog changed. `palette.js` only gained named colors that no live material uses, so the US-004b baseline checksum and `?shadetest=1` are unaffected.

---

## Change log
- **v1 (2026-09-22, US-002)**: initial palette, ramps, lights, fog, time of day, 9 materials, reference shader, preview.
- **v1.0.1 (2026-09-22)**: section 1.1 corrected. The game is served over http (ES modules); palette.js stays a plain script.
- **v1.1 (2026-09-22, US-010)**: palette materials `grass` and `rock` added (outside the tower). New section 3, level data format: `design/levels/tower.js`, `tower_layout.md`, `preview/tower.html`.
- **v1.2 (2026-09-22, US-011)**: palette material `grate` (texel `hole: true` = see-through gap) and `util.shadeSprite`. New section 4, sprite models: `design/models/*.js`, `preview/props.html`. Tower: the bowl cells `O` are now a stone plinth under the bowl sprite. `start` uses the map format v2 names (`eyeH`, `pitchDeg`, `pose`).
- **v1.3 (2026-09-22, US-015)**: `design/models/title.js` (`title`, `subtitle`, `uiStyle`), `preview/title.html`. New section 5.
- **v1.5 (2026-09-22, US-016b / US-025 / US-010)**:
  - `overworld_far.js` v2: analytic `util.heightAt(x,y)` / `typeAt(x,y)` (any spacing, NaN-free, throw on a bad call shape), `bake` / `bakeChunk` / `gridHeight` / `chunkKey`, smooth river carve, `nearLOD` look spec, `overrides` (per-chunk stamps/paints, the tower crown), `structures[]` handover (linear 6 m to the ring height).
  - `tower.js`: legend `,` raised to 2.4 m (flat 2.4 outer ring); `interactables[]`; hint-zone trigger `hintJump`; `trigger` behaviour names.
  - New `world_m1.js` (`ASSETS.worlds.world_m1`: terrain + tower at (1480, 1018, 0) + player spawn + initial state).
- **v1.6 (2026-09-22, detail pass proposal)**:
  - `palette.js`: added named colors `stoneCool`, `stoneWarm`, `stoneDeep`, `flagWarm`, `flagCool`, `flagDark`, `brick`, `brickLight`, `brickDark`, `mossLight`, `fogV2` and `fogV2Glyph`. No other palette value changed.
  - New files: `detail-pass.js` (v2 proposal data + reference shader and edge pass), `detail-pass.md`, `preview/detail_pass.html`, plus the new section 6.
- **v1.7 (2026-09-23, D-009 grid amendment / US-030 follow-up)**: `uiStyle.uiGrid` + `uiStyle.uiScale` (fixed 160x60 UI text layer over the scene grid; all UI layout numbers are UI-grid cells). Sprite upscale cap becomes `3 * rows / 60` (section 4). `preview/title.html` and `preview/props.html` gained a 160 / 240 / 320 scene-grid toggle (title also: scaled layer vs 1x scene cells). Props checked at 320x120: readable, tiled-glyph look near; optional `lods.double` follow-up noted. No palette, material or model art changed.
- **v1.8 (2026-09-23, US-016 tech notes)**: new `design/models/far_tower.js` (`ASSETS.models.farTower`, detail 5x8 + `lods.min` 3x4, billboard defaults); `world_m1.js` gains the `farTower` `billboard` entity; `overworld_far.js` `farTower.sprite` **removed**, replaced by `model: 'farTower'` + `minCells` + `detailRows` (recipe version stays 2, no height/type change); `preview/overworld.html` loads the model. New section 4.1. Art unchanged from the PO-approved silhouette.
- **v1.4 (2026-09-22, US-016)**: `design/levels/overworld_far.js` (seeded far-terrain recipe, reference `util.generate()` / `heightAt()`, terrain look rules, far tower), `overworld_far.md`, `preview/overworld.html`.
