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
  colorRamps:{ [key]: [colorKey, ...] },      // v1.10: colour families dim -> bright (aether, cityLight), section 1.4b
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
| `brass` | ` .:-=+o*#%` | machine brass (v1.9) |
| `copper` | ` .:-=+x#%&` | copper (v1.9) |
| `canvas` | ` .'-~)(=%` | balloon canvas (v1.9) |
| `aether` | ` .'+*` | aether sparkle, effects only (v1.9, no material uses it yet) |
| `cityLight` | ` .'*` | Ferrum's horizon pinpoints (v1.10, emissive) |

### 1.4b Colour ramps (`colorRamps`, v1.10)
Arrays of colour keys, dim -> bright, paired with the glyph ramp of the same name. Pick `k = round(g * (n - 1))` for a glow level `g` in 0..1 (`g = 0` is the dimmest key, not "off"; off = do not draw). `validate()` checks every key.
| key | colours | use |
|---|---|---|
| `aether` | `aetherDim` `aetherMid` `aether` `aetherLight` `aetherCore` | the teal glow family: US-016 signal-tower light (fixed index 2 = `aether`), US-022 relay wake (`g` follows `lights.relay.grow`), the P2 SOS pulse, later spells |
| `cityLight` | `cityLightDim` `cityLight` `cityLightHot` | Ferrum's amber pinpoints (US-016): Wall / Low Wards -> upper tier -> the Crown |
New colours (v1.10): `cityLightHot #ffb836`, `cityLight #ff9a3a`, `cityLightDim #c46a2a` (saturated amber, darker than `skyHorizon`, so they read by hue and value on the pale morning horizon), `ferrumSil #2c2a36` (Ferrum's silhouette). `ferrum` / `ferrumDim` stay the chart (UI) colours.

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
- `lights.beacon` holds the US-022 values (radius 12, which may be tuned down to 8). Legacy since D-011.
- `lights.relay` (v1.9, D-011 "wake the relay"): `aether` teal, intensity 0.9, radius 10, smooth falloff, **slow** flicker 0.4-0.9 Hz amount 0.10 (breathing, not fire), `grow.duration` 1.0 s: the intensity ramps 0 -> 1 starting at `models.relay.wakeLightFrame`. The *Kestrel* burner keeps `torch`.

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
D-011 reskin materials (v1.9, appended after `sky` so the ids of the M1 materials do not move):
| key | use | ramp | notes |
|---|---|---|---|
| `stone_ivy` | tower walls where the *Kestrel* broke through (west `!` wall, summit) | `stone` | ivy vines down the joints over the **full height** (no `tintBand`), leaf clumps `;` |
| `moss_top` | wall tops, parapet tops, ledges (floor-sampled) | `floor` | moss in the grout + cushions `"` |
| `brass` | **machines only**: gondola hull, relay mount, later doors / sentinels | `brass` | 0.5 m plates, bright top step, rivets `o`, spec 0.55 |
| `copper` | **machines only**: burner can, pipes | `copper` | verdigris `%` `:` along the seams, spec 0.45 |
| `canvas` | balloon envelope sheets drawn as geometry | `canvas` | gores, folds `)` `(`, scorch |
All five have v2 records in `detail-pass.js` (same keys; `remap` lists them), so `bindShading` keeps `allV2 = true` on the GPU path.

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

## 3. Levels (`design/levels/*.js`, `content/*.json`)

**US-027b (2026-09-25): `tower`, `test_room` and `world_m1` are edited in `content/levels/*.level.json` / `content/worlds/world_m1.world.json` now, NOT in `design/levels/*.js`** - those three classic-script files were deleted (converted once, byte-for-byte, by `tools/export-content.mjs`; see `docs/architecture.md` section 21). Edit the JSON directly (`stringifyContent`'s canonical layout - 2-space indent, LF, keys in `KEY_ORDER`) and keep every id verbatim; the game loads them through `loadContentPack` + `AssetRegistry.fromJSON`, not a `<script>` tag. `overworld_far` is the one exception: it is a **terrain recipe** (generative code, not authored content), so it stays a plain script at `design/levels/overworld_far.js`, loaded exactly as before. A NEW level would still start life as a classic script here (or, going forward, could be authored directly as JSON) - ask the architect if you're adding one.

**US-027c (2026-09-25): after any hand edit of a `content/*.json` file, run the canonical-form guard** - `node tools/content-canonical.test.mjs` re-derives each file listed in `content/manifest.json` (plus the manifest itself) through `stringifyContent` and fails if the bytes on disk don't match exactly (key order, indent, line endings). A hand edit that leaves keys out of `KEY_ORDER`'s id-first-then-alphabetical order will fail this check even though `loadContentPack` still loads it fine - run the guard before committing, not just the loader/validator.

Plain scripts that set `ASSETS.levels.<name>`. Each has a companion `design/levels/<name>_layout.md` and a preview. The format is **`game/js/world/MAP_FORMAT.md` v1**, validated by `loadLevel` in `game/js/world/Level.js`. The preview runs the real loader when served over http (via `design/preview/content-shim.js` for tower/world_m1 now - US-027b). In summary:
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
- `brazier.js`: `brazier`, plus `beaconFire` (legacy since D-011: replaced in the level by `burner` / `relay`)
- `lantern.js`: `lantern` = **the brass lamp** since v1.9 (reskinned in place, same key / size / animations)
- `lever.js`: `lever`
- `boulder.js`: `boulder`
- `rubble.js`: `rubble` (variants), `pallet`, `beaconBowl` (`pallet` / `beaconBowl` legacy since D-011)
- `relay.js` (v1.9): `relay`
- `wreckage.js` (v1.9): `gondola`, `envelopeDrape`, `envelopeHeap`, `burner`, `rigging`, `canvasHeap`, `rope` (variants), `strut`, plus `ASSETS.levelPatch.tower` (section 4.2); `burnerFlame` (v1.19, legacy since v1.27) and **`burnerFire`** (v1.27, 36.2a: the burner's ~1 m fire body, 13x11 / half 7x6, 8 frames `burn` @ 12 fps, world 0.7 x 1.0 m, anchor (6,10) bottom centre, keys `1`-`4` flameTip / flameOuter / flameMid / flameCore + `E` emberHot / `y` emberDim, all `e: true`, glyph-only; colours come from the glyph via a paint map, last row = ember bed)
- `far_tower.js` (v1.8, signal light v1.10): `farTower` (section 4.1); `ferrum_lights.js` (v1.10): `ferrumLights` (section 4.3)
- `sword.js` (v1.22, voxel only, no billboard): `voxelModels.sword`, `voxelModels.swordHeld`, `viewModels.sword` (section 7.4)
- `m3_props.js` (v1.23): sprites `pickupHp`, `pickupMp`, `strawPuff` (in `ASSETS.m3Sprites`, attached by `attachM3()`), voxel `practiceTarget`, `uiStyle.vitals` (section 7.5)

The grate is **not** a sprite. It is the palette material `grate` (wall pattern).

```
Model = {
  name, desc,
  size:   { w, h },            // cells
  anchor: { x, y },            // cell that sits on the floor point (feet), usually bottom-centre
  world:  { w, h },            // metres: the billboard's real size, used for distance scaling
  directions: ['S'],           // billboards: one view for every angle
  billboard: true,
  keys: { [char]: { c: paletteColorKey, e?: true, fill?: false } },   // e = emissive (flames, embers, glints); fill:false = glyph-only
  fill?:    { k?: 0.45 },        // BUG-OWN-003 (engine support pending): solid plate behind every cell, bg = lit fg x k
  outline?: { k?: 0.4 },         // BUG-OWN-003 / ART-OWN-001 (engine support pending): 1-cell dark rim round the silhouette
  animations: { [name]: { fps | durations: [ms per frame], loop, frames: [Frame] } },
  lods: { half: { size, anchor, animations: {same names} } },   // hand-drawn half-scale version
  // model-specific: light, flameUnit, grow, mounts, mountOn, roll, interact, variants
}
Frame = { S: { glyphs: [h strings of w], fg: [h strings of w key chars], n?: [h strings], bg?: [h strings] } }
```
- **Cells**: `glyphs[r][c]` is drawn in `keys[fg[r][c]].c`. A space **fg key** is **transparent** (a hole). `bg` is omitted: without `fill`, sprites have no background, so the wall shows through behind every glyph (the BUG-OWN-003 "see-through" look).
- **`fill` / `outline` / opaque spaces (v1.11, BUG-OWN-003, docs/architecture.md 7.7; engine support pending):**
  - `fill: { k }` on a model: every opaque cell also writes bg = its own shaded fg colour x `k` (default 0.45), so the prop is a solid shape. A key with `fill: false` stays glyph-only (ropes, flame tips, sparkles, loose ash).
  - **Opaque space** = glyph `' '` with a **non-space** fg key: a solid interior cell (plate in that key's colour, no glyph). Only allowed in a `fill` model and on a filled key (the atlas will throw otherwise). Until the engine lands, opaque spaces are drawn as holes (today's cutout rule), so they degrade gracefully.
  - `outline: { k }` on a model: the engine darkens the one screen cell outside the silhouette (fg and bg x `k`, default 0.4, fades with fog). Set on the lever, the lamp and the small ground props.
  - Authoring helper (`wreckage.js`, `rubble.js`, `boulder.js`): a `` ` `` or `$` in a source row is written out as an opaque space; the data itself only ever contains printable ASCII and `' '`.
- **Readability at the real view distance (v1.11, ART-OWN-001):** size the art so that `world.h * planeDistY / d / size.h` (the art scale) is about **1-2.5 at 160x60** at the prop's typical view distance `d` (planeDistY ~ 69.5 at 160x60 16:9, ~104 at 240x90). Tiny art (3x5 lever, 2-row canvas heap) was drawn 4-7x enlarged, every glyph a block of repeats, and read as wall texture. Silhouette rules: light top edge, darker base / shadow side, line glyphs on the contour (`/ \ | _ - ( ) [ ] o =`), quiet plate interiors, one or two identifying details; never the wall/floor texture glyphs (`# % & @ + ;`) in wall/floor colours. `preview/props.html` "in-game size" shows every prop at 160x60 and 240x90 and checks the scale.
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
- **Mounts**: `beaconBowl.mounts.fire = {x,y}` is the bowl cell where the `beaconFire` anchor goes, so the fire's bottom row covers the ash row. Since D-011 the live one is **`relay.mounts.glow`** (and `relay.lods.half.mounts.glow`): the cell of the centre crystal, in that tier's cells; the US-022 glow / light anchor. World height above the prop anchor = `(anchor.y - y + 0.5) * world.h / size.h`.
- **Variants**: a string variant (`props[].variant`, or `sprite.variant` set by a behaviour) is the **animation name** to play (`lantern`: `unlit`, `lit`, `empty`; `relay`: `dead`, `awake`). A numeric variant indexes `model.variants[]` of full sub-models (`rubble`, `rope`).
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
- **`farTower`** (`design/models/far_tower.js`) = **the signal tower** since v1.10 (D-011 addendum): detail 5x8 (window slit `k` = `black`), min 3x4 (`n*n` / `|#|` / `|#|` / `/#\`), body colour `farTower`, `unlit`, `fogModel 'far'`, `fogMax 0.40`, `minCells 3x4`, `detailRows 12`. Placed in `world_m1.js` at (713.8, 1232.1, -8). `overworld_far.farTower` keeps only `model: 'farTower'` + numbers; the inline `sprite` block is gone. Preview: `preview/overworld.html` (loads `../models/far_tower.js`).
  - **Signal light:** key `L` (`aether`, `e: true`, `fogMax 0.20`) is the `*` in the crown notch: 1 cell in `min` (row 0, col 1), which is 1 cell at 160x60, 2 at 240x90 and 4 at 320x120 after the minCells clamp and nearest sampling. The detail frame adds key `G` (`aetherMid`, emissive) one row above it. `signalLight` lists the cells, keys and `colorRamps.aether` indices. Static in M1 (the SOS pulse is P2); US-022 does not change it.
  - **Per-key `fogMax` (new, all sprite models):** an emissive key may carry `fogMax`. Such cells are still unlit (full palette colour), but they take fog `min(key.fogMax, fogF)` toward the sprite's fog colour instead of ignoring fog. Emissive keys without `fogMax` keep the old rule (no fog). Non-emissive keys ignore it (they use the entity/model `fogMax`).

### 4.2 D-011 reskin models (v1.9): the *Kestrel* wreck, the brass lamp, the relay

Same sprite format as section 4. New optional model fields: `displayName` (text name when it differs from the key), `replaces` (the legacy model this one stands in for), `nameBoard` (cells of the painted name), `hangs` (placement note for hanging sprites), `wakeLightFrame`.

| model | size (half) | world m | animations | notes |
|---|---|---|---|---|
| `lantern` (brass lamp) | 3x4 (3x2) | 0.25 x 0.45 | `unlit` (glint, durations 1800/260), `lit` 8 fps, `empty` (+ alias `hookEmpty`) | reskin in place: brass bracket `=j=`, bright cap `/=\`, round brassLight cage `( )` round a pale glass bulb `O` (key `g` = `mirror`, ART-OWN-001), fuel font `\_/`; prompt `[E] Take lamp`. `empty` = the bracket stays, lamp gone (US-012 `lantern.take` sets `variant = 'empty'`). Size pinned by `sprites.test.js` (~3.1x at 2.5 m: a larger lamp needs that test updated) |
| `relay` | 13x7 (7x4) | 2.4 x 1.75 | `dead` (durations 3200/160: one dim teal flicker), `wake` (8 frames, 8 fps, **once**), `awake` (4 frames, **6 fps** loop) | crystals `^ / \ |` emissive teal when awake; cracked mirror `:` `/`; brass tripod + gear hub `(@)`. `light: { preset: 'relay', offset z 1.1, on: 'awake' }`; `wakeLightFrame: 2`; `mounts.glow` {6,2} / half {3,0}. Half LOD has the **same frame counts** |
| `lever` | **11x12 (7x6)** (ART-OWN-001, was 3x5 / 3x3) | **0.7 x 1.1** (was 0.35 x 1.0) | `idle` (knob glint, durations 1600/240), `pull` 5 frames 12.5 fps, `down` | brass PLATE housing (brassLight rim `o===o`, brassDark opaque-space plate), hub gear steps `* + x * +` one per pull frame (`gear.steps`; hub `gear.row/col` = 5,5, half `gear.half` = 2,3). Long iron handle with a brass knob `@` (glint `*` white, emissive), wood post, iron foot. Anchor (5,11) / half (3,5) = bottom centre |
| `canvasHeap` | **20x4 (10x2)** (was 9x2 / 5x1) | 2.0 x 0.3 | `idle` | the wake spot (replaces `pallet`, same world size and placement point; anchor = bottom centre (10,3) / half (5,1)): a low canvas mound, bright top contour, dark folds `( )`, brass eyelet, dark wavy hem, scorched ends |
| `rope` (variants 0, 1) | **3x16 (3x8)** (was 1x6 / 1x3) | 0.12 x 1.8 | `sway` (2 frames, durations) | hanging snapped stays in the centre column, twisted `) (`: knotted `@` / eyelet `o`; the lower end swings one column. All keys `fill: false`. Anchor (1,15) / half (1,7) = frayed bottom end, place `z = attach height - 1.8` |
| `strut` | **12x4 (6x2)** (was 4x3 / 2x2) | 1.0 x 0.5 | `idle` | bent brass gondola strut, 2-cell diagonal, riveted caps `o=o`, verdigris kink; anchor (3,3) / half (1,1); placed on the R rubble cell |
| `burner` | **13x11 (7x6)** (was 9x7 / 5x4) | 1.15 x 1.1 | `burn` 10 fps, 6 frames | a 4-row fire on top (9x4 flame unit, heat keys `1..4`; tips `1 2` are `fill: false`), wide ember mouth, copper can with one brass gauge `(@)`, coil band `)))`, two legs. `light: torch`, `replaces: 'brazier'`. Anchor (6,10) / half (3,5) |
| `gondola` | **34x9 (17x5)** (was 18x6 / 9x3) | 2.6 x 1.3 | `idle` (durations 1800/900: the snapped stays sway) | bright brass rail + posts, the dark basket inside (opaque brassShadow plate, was see-through), `[KESTREL]` board (`nameBoard` row 4, cols 13-19; half row 2, cols 5-11), riveted hull, brassDark underside, ash round the keel. Anchor (17,8) / half (8,4) |
| `envelopeDrape` | 10x8 (5x4) | 1.4 x 1.9 | `sway` (4 frames, durations 900/700/900/700) | torn canvas hanging from a beam, a see-through burnt tear; the anchor is the hem: place `z = beam height - world.h` |
| `envelopeHeap` | 14x4 (7x2) | 5.0 x 1.6 | `idle` | the collapsed envelope on the hillside, seen from the summit breach |
| `rigging` | **14x4 (7x2)** (was 7x2 / 4x1) | 0.9 x 0.25 | `idle` | a fat rope coil (stacked loops) and a snapped stay trailing right (key `l`, `fill: false`); anchor (7,3) / half (3,1) |
| `boulder` (US-011) | **12x8 (6x4)** (was 5x4 / 3x2) | 1.2 x 1.2 | `roll` 8 frames, fps 0 | round contour `.-~~-. ( ) / \ '-..-'`, moss cap, opaque-space stone face lit from the top (stoneLight -> stoneMid -> stoneDeep); only a few moss / crack marks scroll (3 columns per frame, period 24). Anchor (6,7) / half (3,3) |
| `rubble` variants (US-011) | **10x3, 12x5, 8x3** (halves 5x2, 6x2, 4x2) (were 5x2, 6x3, 4x2) | unchanged | `idle` | cut blocks drawn as boxes (light top face, mid front, dark side) + pebbles; no wall/floor texture glyphs. `fill` + `outline` |

- The wreck files build the fg (and `n`) rows from the glyph rows with a glyph -> key map (`paint`, `autoN` in `wreckage.js`), so the rows always line up.
- **Colour rule (checked in `preview/props.html`):** aether keys appear only on `relay`; brass / copper only on the machine parts (gondola, burner, lamp, relay mount). The envelope uses canvas + rope with a `brassDark` eyelet.
- **`ASSETS.levelPatch.tower`** (in `wreckage.js`): the **proposed** `tower.js` edits, applied by the US-011 programmer pass (the game loads `tower.js`). The patch covers: prop swaps (`brazier` -> `burner`, `pallet` -> `canvasHeap` at the same wake spot, `beaconBowl` -> `relay`), new props (gondola **beside** the wake spot at (15.4, 8.7), rigging, strut on the R rubble, ropes A/B, canvas drape in the stairwell, heap outside the west wall), a `pathCheck` block (no new prop on the wake -> burner -> stair corridor or the boulder roll line; recomputed live in `preview/tower.html`, which now loads `wreckage.js` and draws the patch props + corridor), the `beacon` light -> `relay` preset, prompts (`[E] Take lamp`, `[E] Wake the relay`) and material swaps (`!` walls -> `stone_ivy`, wall / parapet tops -> `moss_top`). Positions marked "check" need a look in `preview/tower.html`.
- Preview: `preview/props.html` (every model, every animation, near / mid / far at 160 / 240 / 320) and `preview/wreckage.html` (composed crash room, summit relay wake with the teal light, v1 vs v2 panels of the new materials, light-direction slider, grid toggle).

### 4.3 Horizon billboards (`world.horizon[]`, v1.10, US-016 D-011 addendum)

Things beyond the terrain far limit (1500 m) that must still be seen: Ferrum's lights. They are placed **by angle**, not by metres, so they are not entities. `world_m1.js` has a top-level `horizon` list (`World.load` ignores it today; the renderer reads it):
```
{ id, type: 'horizon', model: modelName,     // section 4 sprite model (full + lods.half), anchor = bottom-centre
  bearingDeg,                                  // compass deg of the band centre (0 N, 90 E)
  elevDeg,                                     // bottom edge of the band above the horizon, deg (eye-independent: at infinity)
  angular: { wDeg, hDeg },                     // angular size of the whole model
  unlit: true,
  fog: 0..1, fogColor: colorKey,               // FIXED fog amount (it is past fog.far.full, distance fog would erase it)
  drawOver: 'sky',                             // only on cells nothing else drew (sky / depth = +inf): never over structure or terrain
  distanceM? }                                 // informational
```
- **Cells:** for screen cell (col, row) with the sprite-pass camera basis: `az = yaw + atan((col + 0.5 - cols/2) / (cols/2 / tan(HFOV/2)))`, `el = atan((horizonRow - row - 0.5) / planeDistY)`. Inside `|az - bearingDeg| < wDeg/2` and `elevDeg <= el < elevDeg + hDeg`, sample the tier by angle fraction (nearest).
- **Tier:** `scale = hDeg * rowsPerDeg / size.h`; below 0.75 use `lods.half` (README 4 rule).
- **Colour:** non-emissive keys = palette colour lerped to `fogColor` by `fog`; emissive keys by `min(fog, key.fogMax)`. Pass order: after terrain and sky fill, with the sprites.
- **`ferrumLights`** (`models/ferrum_lights.js`): full 36x4 (13.2 x 2.2 deg = 36 x 4 cells at 240x90, 48 x 5 at 320x120), half 18x2 (160x60: 24 x 2.7). Rows top -> bottom: the Crown (spires `^`, mast `|`, hottest `*`), upper tier halls `[ ]`, Low Wards roofs `n`, the Wall (`_ =` crenels). Silhouette key `s` = `ferrumSil` (unlit); lights `d` / `l` / `h` = `cityLightDim` / `cityLight` / `cityLightHot`, emissive, `fogMax` 0.25 / 0.25 / 0.20, only on `. ' *`. Entity: `bearingDeg 87.6`, `elevDeg 1.0`, `fog 0.55` to `fogFar`.
- **Visibility (checked in `preview/overworld.html`):** the tower's east wall (8.0-8.5 m) is above the 7.6 m summit eye, so Ferrum shows only over its lowest part, the sun-crack wall top (8.0 m, cells K). From the breach looking back: the Crown, upper tier and Low Wards rows; from the walkway east edge: the Crown and upper tier; from the relay plinth (eye 8.2 m): the whole band. The band base floats 1.0 deg up, which no M1 viewpoint can see; M2 (outside) needs a hill row or `elevDeg 0`.

---

## 5. Title and UI styling (`design/models/title.js`, US-015)

`title.js` sets five things (v1.9, D-011: the game is **Kestrel**; v1.10 adds `levelPatch.towerHints`):

**`ASSETS.models.title`** (KESTREL logo, 49x8) and **`ASSETS.models.subtitle`** (`SOMEONE IS CALLING`, 1 row). These use the sprite format from section 4, with `ui: true`. Every key is emissive: drawn at full palette color over the 3D view.
- **Look:** the airship's brass name board. The rows run `brassHot`, `brassLight`, `brass`, `brass`, `copperLight`, `copper`, with a `brassShadow` drop shadow. Row 7 is a brass flourish carrying the SOS, `. . . - - - . . .`, in aether teal. It is the only magic colour on the card.
- **Pulse:** `title.animations.show` has **10 frames with `durations`**: frame n (0..8) lights mark n in `aetherCore` while the others stay `aetherDim`, then frame 9 (all dim) rests for 1200 ms. Timings are short 180 ms and long 480 ms. The same pattern is in `title.signal` (`marks[]` with x and kind). Loop it during the hold, and use frame 9 while fading.
- **Layout:** the logo anchor goes at `layout.centerX = 80`, row `layout.top = 18` of the **160x60 UI grid** (`uiStyle.uiGrid`, not the scene grid). The subtitle sits `belowTitle = 1` row under the logo.
- **Hold-phase shine:** `title.shine` sweeps a diagonal band across the `#` cells once per 2.2 s, lerping them toward white by 0.55.

**`ASSETS.models.mapCard`** (US-015 scope change, D-011): the Crown sky-chart with Wick's pencil course. The 9 lines of `docs/story.md` section 5 are reproduced **verbatim** inside a torn chart border, plus (v1.10) the **`- W.` signature line** (D-013) in pencil, right-aligned under the two `Your pencil:` notes. `mapCard.text` holds all 10 lines; `mapCard.signature` = `{ line, text: '- W.', align: 'right', key: 'p' }`. The card is 52x14 and its anchor is top-centre.
- **Colours:** Crown print is `chartInk` red, the pencil is `pencil` warm grey, labels are `uiHint`, FERRUM is `ferrum` amber, and the SIGNAL word is `aether`. The `*` star pulses SOS (`aetherCore` / `aetherDim`, 18 on/off frames with `durations`). Dead relays `o` are `aetherDim`, the "you are here" `x` is `gold`, and the border is `chartEdge`.
- **Layout:** `layout.top` is 23 and `layout.centerX` is 80, in UI-grid cells.
- **Behaviour** (`uiStyle.mapCard`, v1.10 = the US-015 programmer ACs as data): `showOnce` 0.5 s after the title fade-out (`stateKey 'ui.mapCard.shown'`); fade in 0.4 s / out 0.25 s (PO-accepted); `minShowSec` 1.0; first dismiss = any key or click, the key is consumed (`dismiss.consumeKey`); `reopenKey 'M'` from the first dismissal until the end trigger, a toggle with no timeout, closed by M / Esc / any key (`reopen`, `stateKey 'ui.mapCard.opened'`, in `world_m1` state); `sceneDim.bgMul 0.35` for the whole scene, `plate.bgMul 0.18` under the card; movement and look ignored while open, the world keeps animating, pointer lock kept.

**`ASSETS.uiStyle`**: styling data for everything that draws text:
- **`uiGrid` + `uiScale`** (D-009 amendment, 2026-09-23): the UI lives in a **fixed 160x60 UI grid**, drawn as a **separate text layer** over the scene grid (`mode: 'layer'`). `cellScale = sceneCols / 160` (1.0 / 1.5 / 2.0 for 160x60 / 240x90 / 320x120), so a UI glyph is always 12x18 px at 1920x1080. **Every layout number in `uiStyle`, `title.layout` and `subtitle.layout` is a UI-grid cell.** Rules:
  - the layer is drawn after the scene, transparent bg, glyph + fg only; the fade rule applies unchanged;
  - **plates** stay a scene-pass effect: UI rect `[ux, ux+w) x [uy, uy+h)` (+pad) darkens scene cells `floor(ux*s) .. ceil((ux+w)*s)-1`, rows likewise;
  - the **blink** eyelid is a scene effect (scene rows; `edgeRows` scales with `rows/60`), and the UI layer is masked to the same open fraction;
  - the crosshair is UI cell (80, 30); the prompt is `rowsBelowCrosshair` UI rows under it;
  - `mode: 'cells'` (one glyph per scene cell, layout numbers multiplied by `s`) is only a fallback for the CPU 160x60 path, where `s = 1` anyway.
  - **Engine needs (for the architect):** (1) a second cell layer at 160x60 with transparent bg composited after the scene pass (a second instance of the cell presenter, or a Canvas2D/DOM `<pre>` overlay sized to the viewport); (2) the plate written into the scene bg/fg multiply before present (a per-cell multiplier mask or the compositor's UI hook); (3) a `uiGrid -> scene` cell mapping helper used by both the plate and the blink mask; (4) sprite upscale cap `3 * rows / 60` (section 4).
- **`fade`**: the rule every UI fade uses, including US-017's fade to black. Glyphs dim **down** the default ramp: `ramp[round(a * index)]`, where letters count as index 9. fg is multiplied by `0.25 + 0.75a`, and nothing is drawn at a = 0. No alpha blending. `fade.sec` (v1.10) = the US-017 end fade duration, 2.0 s.
- **`titleCard`**: fade in 1.0 s, hold 3.0 s, fade out 1.0 s.
- **`hint` + `hints[]`**:
  - bottom-left at x 2, 2 rows above the bottom; **one hint on screen** (`maxOnScreen 1`), later ones wait in a FIFO `queue` (v1.10; was "stacking upward")
  - prefix `> ` in `uiDim`, text in `uiHint`, key words in `gold`
  - a soft **plate**: scene bg (and fg) multiplied by 0.35, 1 cell around the text, with the texture calmed to ramp index <= 2
  - fade in 0.3 s, fade out 0.5 s, timeout 8 s
  - texts exactly as in US-015
  - v1.10: every hint has `when` (the AC wording) plus `on` (the same rule as data) and `doneOn`. `on` types: `event` (`mapCard.firstDismiss`), `walkTime` (`sec`), `zone` (a `triggers[]` id, fired by `hint.show`), `timer` (`after` event + `sec`), `pointerUnlocked`. `skipIfState`: never shown (or removed) while that `world.state` key is true. `move` now starts on the first map-card dismissal.
- **`storyHints[]`** (story.md 5, same hint style), `on` per the US-015 ACs: `burner` = zone `hintBurner`, `skipIfState 'tower.lantern.taken'`; `climb` = zone `hintClimb`; `chart` ("Press M to read the chart.", `M` in gold) = `timer` 20 s after `mapCard.firstDismiss`, `skipIfState 'ui.mapCard.opened'`, `doneOn 'M pressed'`.
- **`ASSETS.levelPatch.towerHints`** (v1.10, in `title.js` because `wreckage.js` / `tower.js` are in the US-011 pass): `triggers.append` = `hintBurner` (circle r 3.0 m at (18.5, 6.5), the burner) and `hintClimb` (circle r 1.5 m at (15.3, 3.3), on the stairBase cell), both `type 'hint'`, `once`, `trigger 'hint.show'`, tower-local like `hintJump`. The US-015 programmer appends them to `tower.js` `triggers[]` by hand (no runtime applier). The spawn is outside `hintBurner`, the lamp inside, and the two circles do not overlap (checked in `preview/title.html`, which draws them on the tower plan).
- **`crosshair`**: `+`, `uiDim` idle, `gold` when targeting.
- **`prompt`**: 2 rows below the crosshair, centred, `[E]` in gold, same plate. Examples: `[E] Take lamp`, `[E] Pull lever`, `[E] Wake the relay`.
- **`endText`** (US-017; v1.10 = everything `endCard.js` / `end.js` hard-code): `walkSec 1.5`, `gapSec 1.5`, `cps 30` (the scene fade is `uiStyle.fade.sec` 2.0, the name `readEndTimings` already reads). `lines[]` = `{ id, row (UI grid), typed, color, text, alt?, altWhen?, keys?, afterGap?, cursor?, enablesRestart? }`: `signal` row 29 `The signal is still calling.` / alt `One relay wakes. The signal is still calling.` when `tower.beacon.lit`; `someone` row 30 `Someone is out there.`; after `gapSec` `continue` row 32 `- to be continued -` (`uiHint`) and `restart` row 34 `[R] Wake again` (`[R]` gold) with the cursor `_` (`periodSec 1.0`, `duty 0.5`, drawn after the text) and R enabled. `placeholder: false`; `source` notes these are the D-011 PO lines from the US-017 ACs, because `docs/story.md` has no end-card section yet.
- **`pause`**: `Click to resume`.
- **`settings`** (v1.16, US-038b): skin for the game-side settings panel on the 160x60 UI layer. `panel` 40x12 at UI (60, 24), `frame` ASCII box (`+ - |`, `brass` / `brassLight` corners), `title` `SETTINGS` in the top frame row, `plate` 0.18 + `sceneDim` 0.35, `fadeIn` 0.15 / `fadeOut` 0.10. `rowOrder` `grid, mute, back` (options.js ids), `rows` (first 2, gap 2, marker / label / value cols 2 / 4 / 17, note line 1 below), `labels`, `valueText` (grid `480x180` -> `480x180 ultra`, mute `off`/`on`), `notes` (drawn only on the selected row), `marker` `>` gold, `selected` = gold label / value / arrows, `value` `< text >` uiHint with uiDim arrows, `disabled` uiDim + ` n/a` (skipped by A/D), `separator` row 8, `keyHints` row 9 `W/S select  A/D change  Esc back`, `pauseEntry` `[S] Settings` on row 32 under the pause text, `stepRule`. The option data (values, defaults, handlers) lives in `game/js/settings/options.js`; `settings.mock.options` is only the preview's stand-in.
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

## 7. Voxel props (`design/models/voxel_props.js`, D-019, v1.12)

Solid props are real 3D voxel models. The format is `VoxelModelDef` (docs/architecture.md 15.1) plus `voxel.mounts` (15.3 item 4). They follow the 15.3 item 6 content contract. Flames, glows, sparks and smoke stay billboards, as separate props.

- **Sets:**
  - `ASSETS.voxelModels.<key> = { name, desc, voxel, placement, readability }`. The keys are `lever` and `lantern`, the same keys as the billboard models.
  - `ASSETS.voxelMaterials = { v1, v2, remap, edges: { modelRim }, fallback }`: the proposed prop materials.
  - `ASSETS.voxelModels.attach()`: see "Binding" below.
- **Axes:**
  - x = east, with x0 = west.
  - y = south, with y0 = the **front** row (it faces north at yaw 0).
  - z = up, with z0 = the bottom layer.
  - `layers[z][y]` is a row string of `sx` chars.
  - `anchor` is the entity origin, in voxel units (floats are allowed). Yaw = the level `facing`.
- **Materials:** one `mats` char per material. There are no per-voxel colours. "Bright rim, dark body" means separate materials:

  | char | key | base | use |
  |---|---|---|---|
  | `R` | `brass_light` | brassLight | rims, top edges, cage posts |
  | `H` | `brass_hot` | brassHot, emissive 0.10 | rivets, lever knob, gear teeth, finial |
  | `b` | `brass_dark` | brassDark | plate / lamp bodies |
  | `i` | `iron_light` | ironLight | handle rod, bail, arm top edge |
  | `d` | `iron_dark` | ironDark | foot, post, back-plate contour, burner, hook |
  | `W` | `brass_glint` | white + brassHot, **emissive 0.90**, glyph set `glint` | the lamp's glint part only (v1.14) |

  Each key has a v1 record (the `palette.materials` format) and a v2 record (the `detail-pass.js` format). The v2 records use a 2.5 cm tone grid with `lines: false`.
- **Parts and clips:**
  - `lever` (0.05 m, 15x8x22 = 0.75 x 0.40 x 1.10 m):
    - parts `plate` (root, static) + `handle` (pivot at the hub).
    - clips `idle` = 1-frame loop; `pull` = 0.4 s non-loop, rot y 0 -> -12 -> 50 -> 115 -> 148 -> 135, event `clunk` at key 4, held at the end; `down` = the held pose.
    - The handle swings in the plate plane toward the grate side.
  - `lantern` (1/32 m, 8x13x19):
    - parts `glint` (v1.14, root, listed first), `mount` (wall plate, root), `arm` (child: arm, brace, hook), `lamp` (a second root). Code must look parts up **by name**, not by index.
    - `glint` = a 5-voxel plus sign in `brass_glint`, stored at rest in a sealed cavity of the lamp base (layer z1, box [2,2,1,6,6,2]; every neighbour is a base voxel, so it is never visible).
    - clip `unlit` (v1.14) = `interp: 'step'`, loop, durations `[1800, 90, 90, 80]` (= the billboard's 1800 + 260 ms): key 0 = rest; keys 1-3 turn the glint part `rot [90, 0, 0]` (flat -> upright) and move it onto the front of the hood rim (rows z10..12, 0.35 voxel proud of the rim face), at rim columns 2, 3.5 and 5, so the sparkle runs left -> right across the rim.
    - clips `lit` (the same body, no glint), `empty` / `hookEmpty` (the lamp AND the glint part move 64 voxels down, under the floor; the bracket stays).
- **Mounts:**
  - `lever`: `glint` (knob top, handle), `prompt`.
  - `lantern`: `flame` (burner top), `light`, `prompt`, `hook` (= the lamp pivot), `glint` (v1.14, hood rim front on `lamp`; spare, for a billboard sparkle if ever wanted).
- **Placement:** no level edit.
  - The lever uses tower.js (19.25, 9.3, 3.0, facing 90). The anchor is the foot centre.
  - The lantern uses (19.9, 6.5, 1.3, facing 270). Its anchor puts the back of the wall plate on the step-8 face (x 20.0) and the lamp bottom at z 1.3. The lamp centre ends at x 19.72.
- **Binding:** 15.3 item 1 says `model.voxel` present -> `components.voxel`. `attach()` copies `voxel` onto `ASSETS.models.lever` / `.lantern`. Since v1.14 it checks **per model**: each model is attached only when every key of ITS `mats` exists in **both** `palette.materials` and `detailPass.materials`. The game loads the file only once a `<script>` tag for it is added after `lever.js` / `lantern.js`.
- **Merge step:** done. The 5 batch-1 keys were merged in US-040 step 4; `brass_glint` was merged by the designer in v1.14 (`palette.js` materials after `iron_dark`, `detail-pass.js` materials + remap + the new glyph set `glint`), so no existing material id moved. `fallback` stays for oracle runs.
- **Preview:** `preview/voxel-props.html`. It needs http, because it imports `engine/voxel/*`. It shows:
  - 6 yaws x 3 pitches plus an orbit view, all clips, the lit flame, and the knob glint.
  - The in-game 160x60 / 240x90 crops, using the engine projection and the stone backdrop.
  - Top-view layer slices and a JSON dump.
  - Checks: the validator with the palette + proposed keys, pack, part names, the lever contract, sizes, mounts, material and colour keys, value contrast, placement against tower.js, and rows per voxel.

### 7.1 Batch 2: the remaining tower props (`design/models/voxel_tower.js`, US-056, v1.13)

- **Sets:** `ASSETS.voxelModels.boulder`, `.rubble0`, `.rubble1`, `.rubble2`, `.canvasHeap`, `.gondola`, `.strut`, `.envelopeHeap`, `.relay` (same record shape as batch 1), `ASSETS.voxelModels.batch2` (the key list) and `ASSETS.voxelModels.attachTower()`. It **adds** 18 materials to `ASSETS.voxelMaterials` (`v1`, `v2`, `remap`, `fallback`); `ASSETS.voxelMaterials.batch2` lists them (12 since v1.13, 6 more in v1.14).
- **Load order:** after `voxel_props.js` (that file assigns `ASSETS.voxelMaterials`) and after `boulder.js`, `rubble.js`, `wreckage.js`, `relay.js`.
- **Generated rows:** the layer strings are built at load time by small deterministic builders (integer hash, no `Math.random`). The result is plain `layers[z][y]` strings, the same as batch 1. The preview's JSON dump shows exactly what the engine gets.
- **New materials** (each with a v1 and a v2 record; the v2 tone grid is about half a voxel of the model that uses it, `lines: false`):

  | char | key | base / v2 tones | use |
  |---|---|---|---|
  | `C` | `canvas_light` | canvasLight, canvas | crests of the canvas heaps |
  | `k` | `canvas_dark` | canvasDark, canvasScorch | fold flanks, hem, scorched ends |
  | `v` | `patina` | verdigris (+ light / dark) | gondola dent, strut kink, bowl spots |
  | `r` | `rope` | rope, ropeLight, ropeDark | gondola stays, rope bands |
  | `T` | `block_light` | pencil, ashLight | lids / top edges of the rubble blocks |
  | `D` | `block_dark` | stoneDark, ashDark | broken sides of the blocks, pebbles |
  | `L` | `granite_light` | ashLight, steamDim | boulder upper band |
  | `g` | `granite_dark` | ashDark, ironDark | boulder lower half, crack |
  | `m` | `moss_cap` | mossLight, moss | boulder cap, moss on rubble |
  | `x` | `crystal_dead` | aetherDead, mirrorDark | dead relay crystals |
  | `X` | `crystal_lit` | aether, aetherLight, aetherCore, **emissive 0.85** | awake relay crystals |
  | `M` | `mirror_dark` | mirrorDark, mirror, spec 0.85 | relay mirror face |
  | `P` | `linen_light` | linenLight, linen | tarp crests, crate lid edges, rolled fold (v1.14) |
  | `p` | `linen` | linen, linenLight | tarp flats, crate lid, folded flap (v1.14) |
  | `q` | `linen_dark` | linenDark, canvasDark | tarp fold valleys, drape flanks, everything under the top (v1.14) |
  | `E` | `gore_red` | goreRed, goreRedLight, goreRedDark | the red envelope gores (v1.14) |
  | `e` | `gore_red_dark` | goreRedDark, canvasScorch | red gores in the collapse creases (v1.14) |
  | `z` | `canvas_burnt` | canvasScorch, cinder (set `soot`) | burnt tear rim, dark inside (tear, throat), scorch blotches (v1.14) |

  Existing keys are reused as they are: `canvas` (`c`), `wood` (`w`), `brass` (`B`), plus batch 1 (`R H b i d`). v1.14 adds the colours `goreRedLight`, `goreRed`, `goreRedDark`, `linenLight`, `linen`, `linenDark` to `palette.js`. No new material uses a wall or floor stone tone.
- **Models:**

  | key | cellM | grid | world (m) | parts | clips |
  |---|---|---|---|---|---|
  | `boulder` | 0.075 | 16x16x16 | 1.2 ball | `rock` (pivot = centre) | `roll` (8 rest frames), `rollTurn` (optional) |
  | `rubble0` | 0.05 | 18x12x7 | 0.9 x 0.6 x 0.35 | `stones` | `idle` |
  | `rubble1` | 0.05 | 21x14x12 | 1.05 x 0.7 x 0.6 | `stones` | `idle` |
  | `rubble2` | 0.05 | 12x10x6 | 0.6 x 0.5 x 0.3 | `stones` | `idle` |
  | `canvasHeap` | 0.0625 | 32x14x7 (v1.14) | 2.0 x 0.875 x 0.44 | `west`, `east` | `idle` |
  | `gondola` | 0.085 | 26x11x13 | 2.21 x 0.94 x 1.1 | `bow`, `stern` (shared pivot), `chock` (v1.14) | `idle` (v1.14: the 8 deg tilt pose, interp `step`) |
  | `strut` | 0.05 | 18x4x10 | 0.9 x 0.2 x 0.5 | `bar` | `idle` |
  | `envelopeHeap` | 0.2 | 25x11x13 | 5.0 x 2.2 x 1.44 (+1.0 skirt) | `west`, `east` | `idle` |

  ART-OWN-002 rework (v1.14), same keys, grids (except the canvas heap height), anchors and placement:
  - `canvasHeap` = a pale **linen tarp** over a small crate at the west end (box shape, radial drape folds), two tension folds, a straight ragged hem with a rope boltrope + brass eyelets, the SE corner turned back (double flap, rolled fold, eyelet up), an ochre repair patch, the flat hollow at the start pose. Linen vs the ochre/red envelope: different hue, value and size.
  - `gondola` = a rectangular wicker basket: brass ribs, 4 corner posts with knobs, a bright padded rim 1 voxel proud all round with rivets, V rope loops under the rim, 3 sandbags, the name board, deck clutter. `bow` + `stern` share the pivot (13, 1, 1) = the front bottom edge, and `idle` poses both `rot [8, 0, 0]`, `pos [0, 0, -1]` (a rigid tilt; the outline stays intact). The raised back edge rests on `chock` (2 stones in layer z0, never posed). The rest pose (no clip) is the upright basket 1 voxel up on the chock.
  - `envelopeHeap` = a half-deflated balloon on its side: crown end north with an iron crown ring + brass valve plate, a full belly, a taper to the throat, 3 collapse creases, 12 gores alternating ochre / red round the axis, a burnt tear on the upper east flank (hole + charred rim), a brass mouth hoop at x 19 with a dark throat, and 3 rope suspension lines from the hoop to the east edge (toward the tower and the gondola).

  **v1.39 balloon-fabric rework** (same keys, grids, cellM, anchors, parts, clips, placement; no collider): both heaps use 9 new fabric materials (chars `A a n` = `balloon_light / balloon / balloon_dark`, `F f h` = `balloon_red_light / balloon_red / balloon_red_dark`, `S s t` = `tarp_light / tarp / tarp_dark`; same colours as the old canvas / gore / linen keys, v2 set `fabricFace`, v1 ramp `fabric`). `canvasHeap`: rounded lid corners, hem sags between the eyelets (scallops), 22 % ragged threads, torn NW corner, 2 sewn seams (y 4 / y 10), the patch is `balloon`. `envelopeHeap`: a draped-cloth heightfield (crown dome 1.4 m, slack body ~0.6 m sagging to its edges, 2 drifting lengthwise folds, 3 creases, crest / valley shading per column, 6 visible gores, scalloped torn hem on the ground, the burnt tear moved onto the crown's east flank, hoop + crown ring + ropes kept). Height 1.44 -> 1.4 m.
  | `relay` | 0.12 | 18x14x14 | 2.16 x 1.68 x 1.68 | `crystalDead`, `crystalLit`, `mount` | `dead`, `wake`, `awake` (interp `step`) |

  - The 4096-cell grid limit sets the coarse cellM of the big props. The relay has about 3.5 rows per voxel at 2.4 m. Split halves exist only to keep each part box extent at 48 or less; they are static.
  - Clip names equal the billboard anim names, so the spawn's anim choice stays valid.
  - `boulder.roll` has 8 identical frames, so any frame index 0..7 the roller writes is valid and the boulder never turns by itself (D-019 item 5). `rollTurn` is a real roll (rot x in 45 deg steps, 0.471 m per frame). It is only for use if the manager wants the roll back.
  - `relay`: the crystal cluster exists twice. `crystalLit` is stored 6 voxels to -x and 2 up at rest. `dead` moves `crystalLit` 20 voxels (2.4 m) down, inside the walkway/plinth columns. `awake` hides `crystalDead` the same way and moves `crystalLit` onto its place. `wake` = 8 x 125 ms, with event `glowOn` at key 2 (= `relay.wakeLightFrame`). The glow, halo and sparkles stay a billboard (US-022, a separate prop at `mounts.glow`).
- **Placement:** no level edit. Every model uses its tower.js prop (x, y, z, facing) as it is.
  - `rubble*` is selected by `props[].variant` (the registry's `rubble#n` = `models.rubble.variants[n]`).
  - `gondola`: the anchor is 21.5 of 26 along the basket. The stern ends at y ~9.0, so the rigging coil billboard (15.3, 9.5) lies behind the stern and not inside the hull. Tilted (v1.14) the voxel centres span x ~15.06..15.94, clear of the rubble cell (14,8), the canvas heap and the corridor.
  - `canvasHeap`: the tarp is 1 layer (0.0625 m) within 0.19 m of the start pose (17.0, 9.5) and at most 0.19 m within 0.42 m, so the lying eye (0.3 m) is never inside a fold. The crate end (0.44 m) is 0.5 m west of it.
  - `strut` lies in the 0.25 m gap between the two blocks of `rubble1` (prop `rubble2` at 14.5, 8.5). The preview checks that no voxels overlap.
  - `envelopeHeap` (`z: 'ground'`): the anchor is at voxel z 5. A canvas skirt hangs up to 1.0 m below it on the downhill (west) side. If the terrain drops more, raise `anchor[2]`; this is not a level edit.
- **Binding:** `attachTower()` works per model. It copies `voxel` onto the billboard model (rubble: onto `variants[n]`) only when every material key of **that** model is in both `palette.materials` and `detailPass.materials`.
- **Open merge step (batch 2):** append the 18 `voxelMaterials.batch2` keys (v1, v2, remap) after the batch-1 keys and `brass_glint`, the same way as batch 1, plus the 6 v1.14 colours are already in `palette.js`. Add a `<script>` tag for `voxel_tower.js` after `voxel_props.js` and the billboard model files.
- **Engine notes (for the PO / programmer):**
  - Hiding a part = moving it under the floor (lantern, relay). A per-keyframe part `hide` flag would be cleaner. That is optional.
  - The instance AABB includes the hidden parts, so the screen rect gets taller. This costs only slab tests.
  - The tower now has 13 voxel prop instances (14 with the burner), which is 16 or fewer. The VOX atlas is about 27k texels in total.
- **Preview:** `preview/voxel-props.html` now shows all 11 models, with a `show` filter. Each model has its typical in-game view (distance, eye height, floor and backdrop). New checks:
  - per-part voxel counts and extents, the atlas total, and clip names = the billboard anim names;
  - the value ladder per model (rim / body >= 1.5, and rim > stoneLight or body < 0.8 x stoneMid), and no wall/floor stone tones;
  - tower.js placement: no voxel inside a taller cell, the corridor, the rigging distance, the canvas hollow, and the strut/rubble overlap;
  - the relay part swap, and rows at the typical view distance.
- **Burner (OWN-REQ-008 part 1, v1.19):** `ASSETS.voxelModels.burner` (section 9 of `voxel_tower.js`), cellM 0.05, 16x16x14 (0.8 x 0.8 x 0.7 m), one part `body` (extent 46), clip `burn` (1 frame, = the billboard anim name), anchor `[8, 8, 0]`, attached onto `models.burner` by `attachTower()` (so `props.brazier` spawns voxel, no level edit for the body). Mounts `flame` `[8, 8, 11]` (grate top, world z 1.05), `light` `[8, 8, 14]` (= `lights.brazier` z 1.2, unchanged), `prompt`. Materials: existing only (`copper` from palette + `brass_light`, `brass_hot`, `brass_dark`, `iron_light`, `iron_dark`, `patina`, `mirror_dark`); new voxel char `u` = `copper`. Record extras: `placement`, `flame` (the billboard prop data).
  - **Fire = billboard `ASSETS.models.burnerFlame`** (`wreckage.js`, 9x5, half 5x3, 6 frames @ 10 fps, all emissive, no fill): the burner flame unit over an ember row, `mountOn: { model: 'burner', mount: 'flame' }`. Level: new prop `burnerFlame` (18.5, 6.5, 1.05, variant `burn`) in `content/levels/tower.level.json`, like the lamp's `lampFlame`. The billboard `burner` keeps its own flame as the fallback only (never spawn `burnerFlame` on it).
  - Tower voxel instances: 14 (+ the waystone = 15 <= 16). VOX atlas ~35k texels.

### 7.2 Batch 3: world props on the terrain (`design/models/voxel_world.js`, US-026a, v1.16)

- **Sets:** `ASSETS.voxelModels.waystone` (same record shape, plus `end` = the end-trigger numbers), `ASSETS.models.waystone` (the same object; there is no billboard, so the file registers the model key itself, guarded by `attachWorld()` = all its mats merged), `ASSETS.voxelModels.batch3`, `ASSETS.voxelMaterials.batch3` (4 keys) and **`ASSETS.worldPatch.world_m1`** (new: the world-file additions for the content story, hand-copied, no runtime applier; same idea as `levelPatch`).
- **Load order:** after `palette.js`, `detail-pass.js`, `voxel_props.js`. `game/index.html` needs `<script src="../design/models/voxel_world.js"></script>` after `voxel_tower.js`.
- **`waystone`:** cellM 0.125, 14x10x24, one part `stone` (extent 48), clip `idle` (1 frame), anchor `[7, 5, 2]`: layers z0..1 are a **buried foot** below the ground plane (the entity uses `z: 'ground'`), so a slope never opens a gap under the downhill side. Mounts `mark` (ring centre on the front face, 1.75 m up), `top`, `front`. Front (local -y) = the mark face; at `yawDeg 75` it faces the breach.
- **Materials** (merged, appended after `canvas_burnt`; no id moves):

  | char | key | base / v2 tones | use |
  |---|---|---|---|
  | `S` | `waystone_light` | wayStoneLight, lichen | top rim, lichen patches, packing-stone tops |
  | `s` | `waystone` | wayStone, wayStoneDark | slate body |
  | `k` | `waystone_dark` | wayStoneDark, mossDark | damp foot, buried base, cut edge round the mark |
  | `A` | `waystone_mark` | aether, aetherMid, aetherLight, **emissive 0.60**, glyph set `rune` (new) | the carved sign |
  | `m` | `moss_cap` | (batch 2) | NNW flank, low shoulder |

  New colours `wayStoneLight`, `wayStone`, `wayStoneDark`, `lichen`; new detail-pass glyph set `rune`.
- **Placement / end:** `world_m1` entity `endMarker` (1428, 1040, `z: 'ground'`, yawDeg 75); trigger `end` circle r 2.5, `walkTo` (1430.0, 1038.5) on the arrival side (end.js walks at most 1 m), `lookAt: 'farTower'`, `pitchTo: 0`. All in `worldPatch.world_m1` and in the US-026a story.
- **Preview:** `preview/voxel-props.html` (show: waystone). It now also loads `levels/overworld_far.js`. Entries may carry `fog` (shade fog preset) and `extraViews` (fixed in-game views). Waystone checks: size / clip / attach, mark (emissive range, flush front plane, dark cut edge, ring size at 20 m), value ladder vs grass, worldPatch = placement, terrain type / slope at the spot, foot vs terrain, facing the breach (engine pose), distance + bearing vs the signal tower, the sightline from the breach, trigger reach, the 1 m end walk, the end camera at walkTo, bounds.
- **Engine notes (for the architect / PO):** (1) voxel cells outdoors need the far fog (`fog.far`), not the interior fog, or the stone vanishes at 60 m; (2) the voxel pass must depth-test against terrain cells; (3) voxel instances: 14 in the tower + the waystone = 15 (<= 16).

### 7.3 Animating without code: MagicaVoxel -> Blockbench -> `bb-import` (OWN-REQ-010, v1.18)

The owner's workflow for a NEW rigged/animated voxel prop, no JS required:
1. **MagicaVoxel** - model the shape, one named layer (or top-level group) per moving part (same convention `tools/vox-import.mjs` already reads, section OWN-REQ-005b). Export `.vox`.
2. `node tools/vox-import.mjs model.vox --map map.json --cell <metres>` - builds the VoxelModelDef (`parts[].box`, tight per-part boxes, a first-pass geometric pivot). This is still the ONLY source of voxel shape/colour data - Blockbench never touches it.
3. **Blockbench** - open a project whose bone names are typed to match the vox-import part names exactly (rig only: no cubes/textures needed, since this tool never reads Blockbench's own geometry). Position each bone's origin where the part should actually pivot, and key its rotation/position over time - as many clips as needed, loop or one-shot.
4. `node tools/bb-import.mjs project.bbmodel --model model.json --out merged.json` - overwrites each named part's `pivot`/`parent` from the Blockbench rig and adds one clip per Blockbench animation to `animations`. A bone name with no matching part is a clear error (never a silent skip), because this tool has no voxel geometry to invent a part from.
5. Paste `merged.json`'s `parts`/`animations` into the model's `design/models/*.js` entry (or, once OWN-REQ-009 lands, its `content/models/*.model.json`) and check it in `preview/voxel-props.html`.
`tools/bb-import.test.mjs` pins the Blockbench-px/degrees -> our metres/degrees axis mapping (16 px/block, Y-up -> our cellM-scaled, Z-up) against a hand-computed pose; see `bb-import.mjs`'s own header comment for the full table and known format limitations (a bone's Blockbench rest rotation must be zero; simultaneous multi-axis keyframes are a documented open gap, `NEEDS PC-A: architect` in backlog row 25zb).

### 7.4 The sword: world pickup + VIEW MODELS (`design/models/sword.js`, US-078, v1.22)

- **Sets:** `ASSETS.voxelModels.sword` (pickup, record shape as 7.1 + `displayName`), `ASSETS.voxelModels.swordHeld` (the same voxels tip-up, pivot = grip), **`ASSETS.viewModels.sword`** (new namespace, format below), `ASSETS.swordKit` (proposed colours + materials), `ASSETS.levelPatch.towerSword` (placement data) and `ASSETS.voxelModels.attachSword()` (registers `ASSETS.models.sword` itself - there is no billboard - only when all its materials are merged, like the waystone).
- **Models:** cellM 0.03, 9x3x32 (0.27 x 0.09 x 0.96 m). Blade = 1 voxel thick, 3 wide: `S` `steel_edge` edges, `d` `iron_dark` fuller, `s` `steel_old` flats / ricasso, two edge nicks; `z` / `Z` `bronze` / `bronze_light` down-curved guard, ferrule, pommel; `l` `leather` grip; `W` `steel_glint` (pickup only).
  - `sword`: tip down, anchor `[4.5, 1.5, 4]` (4 layers buried in the heap). Parts `glint` (listed first, box `[3,1,23,6,2,24]` = 3 cells sealed inside the guard) + `sword`; both pivot on the buried point and carry the same lean `rot [-8, 10, 0]` in every key. Clip `idle` = `interp: 'step'`, loop, `[2400, 70, 70, 70]`: key 0 rest (glint sealed), keys 1-3 the glint bar 0.35 voxel proud of the blade front at z 19.5 / 14.5 / 9.5 (`pos = R(lean) * delta`, voxel units). Clip `gone` = both parts 64 voxels down (fallback; the take removes the entity). Mounts `prompt` (guard front), `grip`, `glint`.
  - `swordHeld`: z reversed (tip at z 31), anchor = pivot = grip centre `[4.5, 1.5, 4.5]`, one part `blade`, clip `held` (1 frame). Mounts `tip` `[4.5,1.5,31.5]`, `mid`, `guard`.
- **View-model format (`ASSETS.viewModels.<key>`, NEW):** `{ model, space, rotOrder, projection, depth: {near, far}, rest: {pos, rot}, clips, chain, bob, carriedLight, trail, sparks }`.
  - **Eye space** = the frame of a yaw-0 / pitch-0 camera at the eye: x right, **y back (forward = -y)**, z up, metres. Same handedness as the world, so `world = eyePos + Rcam * p` (no mirror).
  - A clip = `{ loop, keys: [{ t ms, pos [x,y,z], rot [rx,ry,rz] }], windup?, active?, recover? ([t0, t1] ms), leadEdge? }`. `pos` = where the model anchor sits; `R = Rz(rz) * Ry(ry) * Rx(rx)` (the engine's part-rot order). rx + tips the blade top forward, ry + top to the right, rz + turns a forward-pointing blade to the right. Sampling = linear per component between keys, no easing.
  - `sword` clips (D-034, v1.24: one swing motion, light + hard; `swingRL` dropped): `idle` (2.2 s breath loop); `swingLR` = the **light** swing (7 keys: rest, windup end, 3 active, follow-through, rest; windup 0-80, active 80-200, recover 200-350 ms = 0.35 s; unchanged); `charge` (loop false, 5 keys, REST at t 0 -> the cocked hold pose at t 400, clamped = held; 0-100 ms is a small pull-back = all a tap shows; informational `holdMs: 400`); `swingHard` = the **hard** swing (10 keys, key 0 = the charge end pose, windup 0-67, active 67-183, recover 183-633 ms, `leadEdge '+x'`; wider arc, deep follow-through + hang, slow lift). `chain`: `{ max 2, queueDuring 'recover', restMs 250, startAtMs 270, blendMs 80 }`, no `order` (both lights = `swingLR`). `bob` (x0.4 light, x0.2 charge / hard) and `carriedLight.heldOffsetX` (-0.3 = the lamp moves left) are engine-side numbers.
  - `trail` (active window only): sample mount `tip` every 60 Hz step (6 samples = 100 ms), Bresenham between consecutive screen points, glyph by on-screen slope (pixels, cell 1:1.5): `-` (head `=`), `/`, `\`, `|`; colour by age `white` <= 34 ms, `mirror` <= 67, `ironLight` <= 100, emissive; ghost blade line `:` `iron` 50 ms behind. Drawn in the view-model layer under the blade.
  - `trailHard` (v1.24, used by `swingHard`): same schema and rules as `trail`; 9 samples / `lifeMs` 150, body `=` `/` `\` `|`, head `#` (flat / steep) / `%` (diagonals), colour by age `white` <= 25, `flameCore` <= 50, `flameMid` <= 90, `flameOuter` <= 125, `emberDim` <= 150; ghost `%` `mirror` 33 ms behind.
  - `sparks`: `clink` (world hit: `*` then `+`, 2 x 50 ms, + `hitStopMs` 50), `hit` (entity hit: `-*-` then `.+.`, 2 x 50 ms, keys `white` / `flameCore` / `ember`, all emissive; anchor = the hit cell), `targetFlash` white 100 ms. Same `glyphs` / `fg` / `keys` cell format as section 4 sprites. v1.24: **`hitHeavy`** (hard entity hit: a 5x3 burst, anchor `{x 2, y 1}` = the hit cell, 3 frames 40 + 50 + 50 ms: white cross -> 4 diagonal sparks -> scattering embers; keys `white` / `flameCore` / `flameOuter` / `ember` / `emberDim`; informational `hitStopMs` 67 = SWORD_CFG `hitStopHard`) and **`chargeGlint`** (hard ready: 1 cell at `mount: 'tip'`, 30 + 35 + 35 ms, `+` mirror -> `*` white -> `'` ironLight). A glyph `' '` with fg `' '` = transparent cell (draw nothing).
- **Materials (PROPOSED, `ASSETS.swordKit`, not merged):** `steel_edge` (base `mirror`), `steel_old` (`ironLight`, rust pits), `bronze_light` / `bronze` (new colours), `leather` (`woodDark`, wrap seam `/`), `steel_glint` (white, emissive 0.90), plus the existing `iron_dark`. New colours `bronzeLight #c49a6c`, `bronze #866044`, `bronzeDark #4a3424`. v2 records use the existing glyph sets `ironFace`, `copperFace`, `canvasFace`, `glint`. No brass / copper / verdigris / aether colour (checked in the preview).
- **Merge step (main session, shared hot files):** (1) `palette.js`: the 3 colours into `colors` (after the waystone colours) and the 6 v1 materials appended after the team materials (no id moves); (2) `detail-pass.js`: the 6 v2 records + `remap`; (3) `game/index.html`: `<script src="../design/models/sword.js"></script>` after `voxel_world.js`. Then `attachSword()` registers `models.sword`.
- **Placement (`levelPatch.towerSword`, NOT applied to `content/levels/tower.level.json`):** prop `sword` (12.86, 6.12, z 0.9, facing 110, variant `idle`, `pickup: 'sword'`) planted in the 0.9 m rubble heap `z` (cell 12,6) by the west wall, in the sunlit nook between the heap, the hollow and the upper-stair column; interactable `sword` (`sword.take`, `[E] Take sword`, radius 1.8, aim z 1.45, once), state flag `tower.sword.taken`; scrawl decal `STEEL FOR THE HUSH` (writer may refine) on the north face of upper step I (13,7); proposed practice-target spot (14.6, 6.6). The US-078 content step copies the entries by hand and runs `node tools/content-canonical.test.mjs`.
- **Engine notes (architect / PO):** (1) a view-model layer: the held model posed in eye space, same projection as the scene, own depth range (`depth.near/far`), drawn after the scene, lit by the scene lights at the eye (+ the carried lamp); (2) the trail + sparks are view-layer / screen-cell effects (emissive); (3) no hand or sleeve is drawn (Wick is never seen) - a glove part is an owner call; (4) the pickup glint uses only part transforms, like the lamp.
- **Preview:** `preview/sword.html` (http): live view model at 160x60 + 240x90 (idle / light / charge / hard / 2 lights + rest / tap / hold / light-then-hard / auto, speed, trail + trailHard, sparks at the crosshair, chargeGlint, crosshair, carried lamp on the left), a **tap vs hold side-by-side** pair (section 1b), key-pose strips of swingLR, charge and swingHard, the pickup (orbit, 6 yaws, glint), in-game crops at 5.3 m and 1.0 m, sparks, the tower plan with the spot + sightline, layers + JSON, and ~30 checks (validator, pack, sealed glint, glint visibility per key, colour language, bronze vs brass, value ladder, placement / overlap / sightlines / reach / hint circles / boulder, readability at 5 m, swing timing + arc direction + near plane, idle framing, ASCII).

### 7.5 M3 props: the practice pell, HP / MP pickups, the vitals HUD (`design/models/m3_props.js`, US-078d / US-080, v1.23)

- **Load order:** after `palette.js`, `detail-pass.js`, **`title.js`** (it assigns `ASSETS.uiStyle = {...}`; this file adds `uiStyle.vitals`) and `sword.js`.
- **`ASSETS.voxelModels.practiceTarget`** (record shape as 7.1 + `displayName`, `target`): the watch garrison's old sword pell. cellM 0.05, 12x8x32 (0.6 x 0.4 x 1.6 m), anchor `[6, 4, 0]` (post foot). Stone socket + moss, iron wedges, `timber_old` post, a straw bundle 0.50-1.25 m (`straw_light` / `straw` / `straw_dark`, 3 `rope` bands, 2 cuts front + 1 back), crossbar 1.25-1.35 m (west end broken, `linen_dark` rag east), rusty kettle helm (`iron_dark` + `steel_old`) to 1.6 m.
  - Parts (order matters, first box owns the cell): `flashN`, `flashS`, `flashW`, `flashE` (the **hit-flash shell**: `hit_flash` voxels 1 voxel proud of the head on 4 sides), `head` (z >= 10, twists), `post` (static). Head + shell share pivot `[6, 4, 10]` and the same rot in every key.
  - Clips: `idle` (shell 64 voxels under the floor); `flash` = step, `[50, 50]` = 6 steps, shell shown, head rz 4 -> 8 deg; `wobble` = linear `[90, 110, 130, 200]` = 32 steps, rz 8 -> -5 -> 2 -> 0, shell hidden. Listener rule (`target.onHit`): flash 6 steps -> wobble 32 -> idle; a hit during wobble restarts flash.
  - Mounts `hit` (bundle front centre, z 0.85), `hitBack`, `top`, `foot`. `target.hurt` = the `components.targetable` cylinder `{ r 0.20, zMin 0.45, zMax 1.60 }`; `target.collider` = a 0.22 m cylinder note.
- **`ASSETS.levelPatch.towerPracticeTarget`**: prop `practiceTarget` (14.6, 6.6, z 0, facing 270 = the cut front faces the sword nook, variant `idle`, `targetable`, `behaviour: 'practiceTarget'`). Supersedes `levelPatch.towerSword.practiceTarget`. Hand-copied by the US-078d content step (+ `node tools/content-canonical.test.mjs`).
- **`ASSETS.m3Sprites`** (section 4 sprite format, `outline`, emissive glow keys; attached to `ASSETS.models` by `attachM3()` once the colours are merged):
  - `pickupHp` 7x7 (half 3x4), world 0.26 x 0.36 m, anchor (3,6): a stoppered flask sealed with red wax, crimson `vital` liquid (emissive), a herb twist at the neck. `idle` = durations `[1500, 90, 90]` (glass glint), `collect` = 3 x 50 ms pop.
  - `pickupMp` 5x7 (half 3x4), world 0.19 x 0.36 m, anchor (2,6): a leaning crystal splinter, cold `mana` light breathing inside (6 frames, 1.72 s), motes rising; `collect` pop.
  - `strawPuff` 5x3 (half 3x2), `burst` 3 x 50 ms, optional straw bits on a pell hit.
- **`ASSETS.pickupStyle`** (view-only, US-080b `presentPickups`): `hp` / `mp` `{ model, anim, hoverM, bob { ampM, periodMs } }`, bob `phase` rule, `blink` (last 180 steps: 7 on / 12, last 60: 3 on / 6), optional `collect` pop (150 ms) and an optional `light` note (off by default).
- **`ASSETS.uiStyle.vitals`** (UI-grid cells, literal RGB like `uiStyle.overlay`): `layout` (x 2, HP row 1, MP row 2, label / `[` / 20 cells / `]` / number cols), `textBg`, `fillRule` (floor + a half-cell `part` at >= 0.5, value > 0 shows at least one cell), `hp` / `mp` `{ label, brackets, fill, part, empty, number }` (HP `#` crimson, MP `=` blue, empty `.`), `hp.low` (<= 25 %, 1 Hz cosine lerp to `...To`), `hp.chip` (3-stage damage follow-through on the lost cells), `gain`, `mp.short` (2 blinks / 320 ms), **`hurtEdge`** (9 steps = 150 ms, 3 ragged rings `#` `%` `:` in danger reds, stages shrink + dim, ring thickness 1 row / 2 cols, fixed hash coverage, ring 2 corners only) and `deathCard` (sink 48 + fade 90 steps, writer line placeholder at row 28 typed at 30 cps, `[E] Wake again` row 31 with `[E]` gold + cursor).
- **Materials (PROPOSED, `ASSETS.m3Kit`, not merged):** `straw_light`, `straw`, `straw_dark` (bases = the existing straw colours, ramp `grass`, stalk texels `|` `/`), `timber_old` (woodDark + ashDark weathering, cracks `|`, v2 set `grainV`), `hit_flash` (white, emissive 1.0, `*` / `#`, v2 set `glint`; reusable for US-079 beasts). New colours `vitalLight #ff8f7e`, `vital #d8344a`, `vitalDark #5c1422`, `manaCore #e8f2ff`, `manaLight #9cc2ff`, `mana #4c84f2`, `manaDark #1e2f6a`. New v2 glyph set `strawFace` (fallback `canvasFace`). Reused: `rope`, `iron_dark`, `steel_old`, `block_light`, `block_dark`, `moss_cap`, `linen_dark`.
- **Merge step (main session, shared hot files):** (1) `palette.js`: the 7 colours after the bronze colours, the 5 v1 materials after `steel_glint`; (2) `detail-pass.js`: set `strawFace` after `rune`, the 5 v2 records after `steel_glint`, 5 remap entries; (3) `game/index.html`: `<script src="../design/models/m3_props.js"></script>` after `title.js` and `sword.js`. Then `attachM3()` registers `models.practiceTarget`, `pickupHp`, `pickupMp`, `strawPuff`.
- **Engine / PO notes:** (1) the flash shell is the lamp-glint trick (part transforms only); a per-instance flash tint in the shade pass would be cleaner and would also serve the beasts - optional; (2) UI cells are opaque, so `hurtEdge` is a hard ragged frame, not a vignette (a scene-side edge tint would be an engine feature, not needed for M3); (3) pickups are billboards on purpose (voxel instances are capped at 16 per scene).
- **Preview:** `preview/m3-props.html` (http): the pell (orbit, 6 yaws, idle / flash / wobble / hit / auto, light sliders) and in-game crops at 5 m and 1.4 m with the sword spark + straw puff; the pickups (art in both tiers on grass and stone, in-game at 5 m on the hillside and in the tower, bob, life slider + blink, collect pop); the HUD on a 160x60 UI layer over 160x60 and 240x90 scenes (hit / heal / low / spend / regen / die / wake / auto); the tower plan; layers + JSON; ~45 checks (validator, budgets for `dda`, shell hidden at rest from 5 sides and covering when on, timing vs 60 Hz steps, colour language, value ladder, placement / corridor / hint circles / boulder / sword sightlines / facing, readability at 5 m, sprite rows + glyph-space rule + half tiers, HUD fit + ASCII + contrast, hurtEdge timing, death card).

### 7.6 ENV-02 "The Awakening" hall dressing (`design/models/m3_props.js` section 6b, D-038, v1.31)

- **Why composites:** `VoxelPool` (engine/render/voxelPool.js, both renderers) draws only the **nearest `MAX_VOX_INSTANCES` = 16 voxel entities per frame**. The tower already places 16 voxel props (pallet, burner, lamp, boulder, lever, relay, 5 rubble, gondola, strut, envelope heap, sword, pell) and `world_m1` adds the waystone + 2 boars (19 before this pass). So the clutter is built as **two composite voxel models, one instance each** (21 after this pass; from the hall the 5 farthest drop out: relay, envelope heap, waystone, boars, all invisible from the hall). Engine note for the PO / architect: raising the cap for the mesh path (the 16 is a DDA VOXINST / uniform-array limit) would let later dressing use separate props.
- **Why in `m3_props.js`:** `World.load` throws on an unregistered prop model, and every Node suite / tool that loads the tower already loads `m3_props.js` (for the pell). A new file would first need its script line in ~40 loaders (`grep m3_props.js`), so no new script tag is needed for this pass.
- **Models** (`ASSETS.voxelModels.<key>`, registered into `ASSETS.models` by `attachM3()` when all 17 mats are in palette + detail-pass): `meshOnly: true`, cellM **0.04**, one part `body` (whole grid), clip `idle` (1 rest frame), authored in **world orientation**: place with `facing: 0` only (x east, y south); grid origin = a fixed world corner, `anchor` = the placement point.

  | key | level prop | placement | grid (origin) | contents |
  |---|---|---|---|---|
  | `awakeningCrates` | `dressCrates` | (16.0, 6.5, 0) | 100 x 75 x 25 (world 14.0, 5.0) | crate stack (0.62 + 0.48 m) + stove-in crate against the walkway south face (cells 17,5 / 16,5), fallen cheek stones <= 0.12 m along the wall foot, the garrison's open water butt by the upper-stair column (14,7), a fallen kettle helm |
  | `awakeningKeeper` | `dressKeeper` | (19.0, 7.5, 0) | 50 x 125 x 28 (world 18.0, 5.0) | grain sacks (18,5), sealed barrel + rope coil, sack, shovel on the step-7 face, chain heap (19,5); the relay-keeper's corner (18,9): straw mat, bedroll, log book, stool with a snapped leg, a cold candle stub (top 0.56 m), tin cup |

- **Materials** (17 chars, existing keys only): `W wood`, `w timber_old`, `I iron_dark`, `i iron_light`, `S steel_old`, `r rope`, `L linen_light`, `l linen`, `d linen_dark`, `T straw_light`, `t straw`, `u straw_dark`, `B block_light`, `b block_dark`, `m moss_cap`, `h leather`, `c canvas_dark`. Builders: hollow plank crates (seams every 4 voxels, dark battens, iron corner caps), stave barrels (18 alternating staves, 12 % belly, iron hoops), slumped ellipsoid sacks with a tied neck, a rolled bedroll, low moss-flecked stones; integer `hash3`, no `Math.random`.
- **Level (`content/levels/tower.level.json`):** props `dressCrates`, `dressKeeper` (no collide: decoration), decal `scrawlKeeper` (keeper tally + signal pattern, placeholder text for the writer, on the north face of the grate column G at y 10 beside KEEP THE LIGHT). No light change: the burner (torch) and the hook lamp stay the two warm pools against the cool sun shaft.
- **Cold candle (canon):** the keeper's candle stub is burnt down and cold, because a lit candle would say someone was here recently (story.md: the log is old). Option for the PO / writer, shown in the preview's "candle (option)" toggle: prop `{id: 'candleFlame', model: 'lampFlame', variant: 'burn', x: 18.72, y: 9.16, z: 0.56}` + light `{id: 'keeperCandle', preset: 'candle', on: true, x: 18.72, y: 9.16, z: 0.66}`; palette preset **`candle`** (torch colour, 0.32, r 2.2 m, flicker 5-9 Hz 0.12) is already in `palette.js` as a spare.
- **Clearances (checked live in the preview):** every voxel on a flat floor-0 ground cell; nothing taller than 0.13 m on the wake -> burner -> stair corridor (legs 1 + 2, incl. the arrival cell 19,7 under the lamp) or on route / boulder roll cells; nothing within 0.6 m of the pell post; the lamp approach (19,6) empty. >= 5 clutter items fall inside the default wake view cone (yaw 330 +- 50).
- **BUG-CLOTH-002 geometry:** legend `c` (cells 16-18, row 4, the stair cheek) is now a **walkable walkway at 1.8 m** (was solid 1.4 m): 0.3 above step 5, flush with step 6, out of jump reach from the floor (apex 1.05) and from the 0.5 m burner ring (1.55), so the stair is still entered only at the stair base. The canvas gains `colliders[2]` (the walkway block, y 4.02-5.0, z 0-1.8). The mason's mark `scrawlMason` stays on the same face (y 4, x 16-17.5), raised to z 0.65-0.85 so it clears the step 1 / 2 floors.
- **Engine gaps (PO / architect):** (1) `decal:` props (all scrawls, incl. KEEP THE LIGHT and the mason's mark) and `chains` are skipped by `World.load`: nothing renders them yet; (2) the 16 voxel-instance cap above.
- **Preview:** `preview/awakening.html` (http): reference raymarch of the hall with the real voxel props (rest pose), the composites, stand-ins for the pell + sword, the level lights + sun (light-direction sliders, light toggles, dressing on / off = before / after), 6 view presets (wake, wake turned to the burner, keeper corner, crates, step 6 looking west along the walkway, stair base looking back), a plan with the corridor / roll line / wake cone, and checks (engine validator, registration, cells, corridor, roll line, route, pell, lamp, wake cone, voxel budget, lights, palette validate, walkway heights).

## 8. Particle presets (`design/models/particles.js`, US-053c, v1.25)

- **Load:** classic script after `palette.js` (no other dependency). `game/index.html`: `<script src="../design/models/particles.js"></script>`.
- **`ASSETS.particles.presets.<key>`** = the architecture.md 32.1 EmitterDef (`rate burst life speed dir spreadDeg box accelZ drag wind maxLive killBelow glyphs colors emissive emissiveFog`), except `colors` is a list of **palette keys**. Keys: `flame` (emissive, 60/s since the 2026-10-03 retune; spare since v1.27: no longer placed at the burner), `embers` (v1.27, 36.2a: emissive, 8/s, 0.8-1.4 s, 0.6-1.2 m/s, spread 25, accelZ 0.4 / drag 1.2, wind 0.6, emberHot -> emberDark; the particles over the `burnerFire` sprite), `smoke` (lit, accelZ 0.6, wind 1, 3-4 s, dark), `sparks` (emissive burst 10, gravity, 0.3-0.4 s, kill plane 1.5 m), `dust` (lit burst 10, flat ring, kill plane 2 cm).
- **`ASSETS.particles.toEmitterDef(key, palette.rgb)`** returns a fresh EmitterDef with `colors` as `[r,g,b]`: pass it straight to `engine.particles.defineEmitter(key, def)`. `validate(rgb)` = data self-check (ASCII 33..126, no space, ramps <= 16, colour keys, smoke <= 35 %).
- Ramps run over life (index 0 = newborn); glyph and colour lists have the same length (1:1). `mounts` = placement hints (burner `flame` offset up 0.02, `smoke` up 0.45; burst counts); `LANDING_DUST_SPEED` = 6 m/s.
- **Preview:** `preview/particles.html` (http): the real engine sim, five panels (burner flame + smoke as placed, then each preset), lit / pitch-dark toggle, wind, zoom, spark normal, ramp strips, the def table, checks (engine `defineEmitter` per preset, AC8 smoke values, flame rate + height, smoke rise, burst counts, kill planes). `preview/fire.html` (v1.27): the `burnerFire` sprite with `embers` + `smoke` over it on the burner can, true-size 240x90 / 480x180 crops, distance slider, old/new toggle, sprite-format + ember checks.

## 9. Cloth presets + cloth look (`design/cloth.js`, CLOTH-1b4, v1.25)

- **Load:** classic script, no dependency. `game/index.html`: `<script src="../design/cloth.js"></script>`. `World.load` reads `assets.clothPresets` (`engine/world/cloths.js`): main.js must pass `window.ASSETS.clothPresets` on the asset object it gives `World.load` (the AssetRegistry has no getter yet).
- **`ASSETS.clothPresets`** `{ silk, canvas, banner }`: numbers only (cloth sim keys, 33.2), merged per key over the engine defaults.
- **`ASSETS.clothLooks`** = reference `cloths` blocks (33.5 JSON) for the content step: `stairwellCanvas` (16x12, 2.4 x 1.8 m, 3 pins, rip + torn corner + ragged hem holes), `ruinBanner` (12x16, **1.1** x 2.2 m, pole-sleeve pins, swallowtail), spares `watchFlag` (14x9, 1.2 x **0.8** m, silk, hoist pins) and `doorCurtain` (10x14 linen). Copy pins / holes / size / preset / mat; origin, yaw and colliders belong to the level. Sizes in bold are tied to the material pattern.
- **Materials** (MaterialTable keys, v1 in `palette.js`, v2 in `detail-pass.js` + remap, same key): `cloth.canvas` (ochre + faded-red gores via `band` u 1.2 / 0.6, seams via `grid`, soot overlay), `cloth.banner` (woad tones per 10 cm patch, ochre pales `band` u 0.5 / 0.1, stains), `cloth.flag` (pale woad, ochre stripes `band` v 0.36 / 0.08), `cloth.linen`. New v2 glyph sets `clothFace`, `bannerFace`. New colours `woadLight`, `woad`, `woadDark`. Only existing detail-pass vocabulary (tones, grid, band, overlay); fold look = smooth-normal light through the set levels.
- **Preview:** `preview/cloth.html` (http): the real cloth system with these presets, a stand-in perspective raster (smooth normals, two-sided, per-cell `detailPass.util.shade`, kind-8 rim), wind / heading / gusts / "gust then calm", sun + torch + ambient, v2 / v1 shader, 160x60 / 240x90, orbit + distance, a walker capsule through the curtain and along the canvas, swatches, checks (validators, system build, 6 m/s deflection, settle time, rest).

## 10. Water looks (`design/water-looks.js`, US-055a2c (b), v1.26)

- **Load:** classic script, no dependency. `game/index.html`: `<script src="../design/water-looks.js"></script>` (after palette.js / detail-pass.js). main.js: `gpuPipeline.setWaterLooks(window.ASSETS.waterLooks)` and `fb.waterLooks = resolveWaterLooks(window.ASSETS.waterLooks)` (JS twin). Consumer: `engine/render/waterLook.js` `packWaterLook`, which throws at load naming the look if a field is out of range.
- **`ASSETS.waterLooks.<name>`**: `water` (default; regions without `look`), `pond` (green, still, opaqueAt 1.0), `murky` (silt / bog, opaqueAt 0.5). Live fields: `ramp` (1..8 glyphs ASCII 33..126, repeats = weight), `shallow` / `deep` / `glint` RGB 0..255 (no palette keys: the engine takes RGB), `opaqueAt` > 0 m, `seeThrough` 0..1, `waveHz` >= 0, `bgK` 0..1.
- **Later fields** (35.3 / 35.4 names, ignored by the 055a2b packer): `bands`, `glintCos`, `crestK`; `streak`, `streakLen`, `streakW`, `streakK` are live since 141a.
- **36.1 fields (v1.27, ENGINE-PENDING until 36.1b / 36.1c; today's packer ignores them):** 36.1b `cellM` (> 0 m, rotated brick lattice cell, engine default 0.25), `glintP` (0..1 glint probability, default 0.04), `drift` (m/s lattice slide, default 0.12); 36.1c `tintDepth` (> 0 m of water COLUMN at which the colour reaches `deep`, default 1.2), `shoreW` (> 0 m shore band width from the region edge, default 0.6), `rim` (RGB fg at the edge, default [200,220,215]), `foamRamp` (1..3 glyphs, index 0 = at the edge), `foamDepth` (m), `foamFar` (m). Values: water `0.25 / 0.04 / 0.12 / 1.2 / 0.6`, pond `0.22 / 0.03 / 0.05 / 0.8 / 0.5` (reed-scum rim, `o:.`), murky `0.25 / 0.02 / 0.03 / 0.5 / 0.4` (dark MUD rim [92,74,48], `;,.`).
- **Hue families (v1.27, owner "pond / mud look the same"):** water = sea-glass blue-green, pond = reed / algae green (green > blue), murky = brown silt (red > green > blue). shallow vs deep ~3x apart in value in each look so the 36.1c column tint reads shore-light / middle-dark.
- **Colour rule:** water is muted blue-green (green ~= blue), never `mana` blue, `woad` violet-grey or `aether` teal.
- **Preview:** none yet. Check it in game / `?gpucompare=1` water poses once the hookup is wired.

## 11. Forest trees (`design/models/forest_trees.js`, ME-06c4, v1.28)

- **Load:** classic script after `palette.js`, `detail-pass.js` and **`models/sb_objects.js`** (it derives its models from the sb trees and throws naming the missing source if that file was not loaded). `game/index.html`: `<script src="../design/models/forest_trees.js"></script>` right after the `sb_objects.js` tag. Node: side-effect import after `sb_objects.js`.
- **Models** (`ASSETS.voxelModels.<key>`, attached to `ASSETS.models` with the sb_objects guard), all `meshOnly` (mesh renderer only, never in the DDA atlas), static, one part `body`, no clips. Same voxels as the source, larger `cellM` (architecture.md 37.2: no per-instance scale):

  | key | source | voxels | cellM | height | trunkR | trunkH |
  |---|---|---|---|---|---|---|
  | `forestOakSmall` | `treeBig` | 32x32x45 | 0.20 | 9.00 m | 0.70 | 3.40 |
  | `forestOakLarge` | `treeBig` | 32x32x45 | 0.27 | 12.15 m | 0.95 | 4.59 |
  | `forestBirchSmall` | `treeBirch` | 32x32x35 | 0.25 | ~8.5 m | 0.65 | 4.50 |
  | `forestBirchLarge` | `treeBirch` | 32x32x35 | 0.32 | 11.20 m | 0.84 | 5.76 |
  | `forestPineSmall` | `treePine` | 32x32x37 | 0.26 | 9.62 m | 0.59 | 2.60 |
  | `forestPineLarge` | `treePine` | 32x32x37 | 0.36 | 13.32 m | 0.81 | 3.60 |

  (Heights = trimmed voxel z x cellM; the speck clean-up can lower a top by one voxel - the preview table shows the exact value.)
- **Derivation** (data in the file's `SPECIES` table): source chars -> one bark char per bark material + canopy chars -> leaf materials by height band (`leafSplitZ`: oak/pine `leaf_dark` below, `leaf` above; birch `leaf` below, `leaf_light` above); one clean-up pass (drop canopy voxels with <= 1 solid neighbour, fill empty cells with >= 5 canopy neighbours); empty top layers trimmed; **anchor = measured trunk centre** (oak `[16, 15.5, 0]`, birch `[15, 16.5, 0]`, pine `[16, 16, 0]`), so the trunk prism centred on the placement sits on the visible trunk.
- **Trunk numbers:** `trunkR = trunkRVox x cellM` rounded up to 0.01 (inscribed radius of the 8-gon; oak 3.5, birch 2.6, pine 2.25 voxels), `trunkH = trunkHVox x cellM` (oak 17 / birch 18 = lowest canopy voxel; pine 10, its trunk continues inside the 2 m needle skirt). `ASSETS.forestTrees.variants.<key>` carries `{species, size, src, cellM, heightM, trunkR, trunkH, trunkRVox, trunkHVox, cleanStats}`.
- **Forest config** (architecture.md 37.2 item 7): `design/levels/overworld_far.js` `recipe.forest.trees` = `{seed 7349, cellM 6.5, jitter 1.5, fill 0.72, maxTrees 1500, lodCells 6, species: [{model, weight, trunkR, trunkH} x 6]}`; trunk values are literal copies of the table above. `cellM` is 6.5 (not the 37.2 example 6) because the large oak's chunky trunk needs trunkR 0.95: gap rule `6.5 - 3 = 3.5 >= 2 x 0.95 / cos 22.5 + 1.2 = 3.26`.
- **Materials** (new, appended; v1 in `palette.js`, v2 + remap in `detail-pass.js`, same key): `leaf` (mid green, ivy glyphs), `leaf_dark` (cool shade green / pine needles, moss glyphs), `leaf_light` (birch yellow-green, ivy glyphs); colours `leafLight`, `leaf`, `leafDark`. Foliage ramp. No existing id moves.
- **Preview:** `preview/forest.html` (http): checks (validator + engine mesher per variant, height 8-14 m, LOD0 <= 4000 / LOD1 <= 1200 tris from `buildVoxelMesh` / `buildVoxelMeshLod1`, trunk-voxel coverage of trunkR, config literals = measured values, every model in `ASSETS.models`, gap rule, palette + detail-pass validators, min trunk gap in a scattered patch), a variants table (incl. the sb source LOD0 for comparison), a same-scale line-up with a 1.8 m player and the collider ring, and a walkable first-person view (eye 1.6 m, WASD with trunk collision, pitch +30 button, 160x60 / 240x90 / 400x150, sun shadows) over a patch scattered with the literal 37.2 `hash2` + the map of trunk 8-gons. Reference DDA + `palette.util.shade`, not the game renderer.

## 12. Ground detail (`design/models/ground_detail.js`, ENV-01d, v1.32)

- **Load:** classic script after `palette.js` and `detail-pass.js` (no model dependency). `game/index.html` and `tools/editor/index.html`: `<script src="../design/models/ground_detail.js"></script>` (editor: the same relative path as its `forest_trees.js` tag) after `forest_trees.js`. Node: side-effect import.
- **Models** (`ASSETS.voxelModels.<key>`, attached to `ASSETS.models` with the forest_trees guard), all `meshOnly`, static, one part `body`, no clips, anchor = footprint centre at ground level (logs: the trunk-box centre). Built from data in the file: heightfields (rocks, bush), crossed 1-voxel blade sheets (tufts), boxes (flowers, toadstools, pebbles), a round-section builder (stump, logs).

  | group (37.4 cap) | keys | notes |
  |---|---|---|
  | rock (400) | `rockSmallA` 0.3 m, `rockSmallB` 0.33 m, `rockMedA` / `rockMedB` 0.8 m, `rockLargeA` / `rockLargeB` 1.6 m | A = granite (`granite_dark` foot, `granite_light` body), B = split slab with a `moss_cap` cushion; small B = warm `block_dark` / `block_light`. Large = Med voxels at 2x cellM |
  | pebble (150) | `pebbles` | 7 stones on 0.54 m |
  | tuft (150) | `tuftMeadow` 0.56 m (dry `straw_light` tips), `tuftLush` 0.42 m (`leaf_dark` / `leaf_light`), `tuftShort` 0.3 m | material bands by absolute z so blade bodies merge |
  | flower (150) | `flowersYellow`, `flowersWhite`, `flowersPink` | 4 blooms (2x2 heads) + 1 bud, `leaf_dark` stems |
  | mushroom (150) | `mushrooms` | 3 toadstools, `mushroom_cap` + `linen` stems / spots |
  | bush (400) | `fern` 1.28 m wide, `bushRound` 0.72 m | leaf greens |
  | stump (400) | `stumpCut` 0.55 m (+ splinters) | `timber_old`, `wood_cut` top, 4 roots |
  | log (600) | `logShort` 2.0 m, `logLong` 3.0 m | hollow sawn end, diagonal broken end (`wood_cut`), moss strip, branch stub |

- **`ASSETS.groundDetail`** = `{version, keys, groups, caps, mats, variants: {<key>: {group, label, cellM, size, widthM, depthM, heightM, capTris, estTris, collider, rVox, hVox}}}`. `collider` = the measured literal for `recipe.detail` (`{prism: {r, h}}` with r = rVox x cellM = inscribed 8-gon radius, h = hVox x cellM = standing top; or `{box: {hx, hy, h}}` with hx = (L/2 - 0.5) x cellM, hy = 3 x cellM, h = 6.5 x cellM), `null` for no collider.
- **Level config:** `design/levels/overworld_far.js` `recipe.detail` (architecture.md 37.4 item 2): defaults `tileM 16, maxDraw 768, refeedM 4, maxPlacements 40000, structClearM 2, entityClearM 1.5`; 7 `exclude` shapes (walk-out capsules + waystone disc, boar route capsule r 4, breach landing, quietPond, floodedCellar); layers `tufts` (cellM 2.5, fill 0.6, drawM 28), `shrubs` (cellM 5, fill 0.5, drawM 45), `rocks` (cellM 11, jitter 3, fill 0.5, maxSlope 0.35, drawM 70; all collider species here, gap rule 11 - 6 = 5.0 >= 2 x 1.47 + 1.2). Species per ground type `grass` / `forest` / `rock` (water and path have none). Collider literals = the measured values above (the preview checks them). `shadow: true` only on rocks M/L, logs, stumps, bushes.
- **Materials** (new, appended; v1 in `palette.js`, v2 + remap in `detail-pass.js`, same key): `petal_yellow`, `petal_white`, `petal_pink` (v2 face set `glint` = `* +` stars, not emissive), `mushroom_cap` (rubble ramp / `rubbleFace`), `wood_cut` (wood ramp / `rubbleFace` rings). Colours `petalYellowLight/petalYellow/petalYellowDark`, `petalWhite/petalWhiteDark`, `petalPinkLight/petalPink/petalPinkDark`, `mushroomCapLight/mushroomCap/mushroomCapDark`, `woodCutLight/woodCut/woodCutDark`. Flower colour rule: warm specks, never danger red; no violet (reserved feel of the Dim).
- **Preview:** `preview/ground-detail.html` (http): checks (validator + engine mesher per model, LOD0 vs the cap, LOD1 printed, `ASSETS.models` attach, prism core coverage / box inside the log, the 5 materials v1 + v2 + remap, palette + detail-pass validators, every `recipe.detail` key / ground type / species / weight, collider literal = measured, no collider on tufts / flowers / pebbles / toadstools, gap rule per layer, band + fed-set estimates vs `maxPlacements` / `maxDraw`), a models table, a same-scale line-up card per model next to a 1.8 m player on a selectable ground type with the collider outline, 3 first-person ground patches (grass / forest / rock, eye 1.6 m, 240x90 / 400x150, drawM fade ring, per-layer filter, sun shadows from `shadow: true` species) and a world map of the reference scatter around the tower (real terrain types, exclusions, entities, boar / walk-out / collider-gap checks).

## 13. Boar fight presentation + items (`design/models/voxel_beast.js` boarFx, `design/items.js`, Sprint 6 pass A, v1.34)

- **v1.40 real boar (same key `boarPlaceholder`, replaces the art below):** cellM 0.1 -> **0.05**, grid **12x25x29**, anchor `[6,11.5,15]`, `meshOnly: true`, same world size (0.5 x 1.05 x 0.7 m + tail) and placement. 8 parts: `body` (root, box z 19-29 / y 8-22, pivot `[11,11.5,15]` = right body edge), `flash` (root, box z 0-15, pivot `[11,11.5,0]`, a `hit_flash` copy of the WHOLE boar, shown at body pos + `[0,0,15]`, hidden at -64), `head`, `legFL`, `legFR`, `legBL`, `legBR`, `tail` (children of `body`). Clip pos values are voxels (0.05 m). Same clip names and durations except `idle` (4-key sniff loop) and `charge` (4 x 50 ms gallop, same 200 ms); new spare `walk` (trot, 4 x 70 ms, not wired). Mounts keep their world points. Preview `preview/boar.html`. The v1.34 description below is the placeholder it replaced.
- **Boar model (`ASSETS.models.boarPlaceholder`, same key, same body art):** grid 5x10x7 -> **7x12x16**, anchor `[2.5,5,0]` -> `[3.5,6,8]` (the body's feet; same world placement). Parts `body` (box z 8-16, pivot `[6,6,8]` = right foot edge) + `flash` (box z 0-8, pivot `[6,6,0]`): a `hit_flash` copy of the body grown 1 voxel to the sides + top, stored BELOW the body (underground even with no clip); a clip shows it with pos `[0,0,+8]` (over the body) and hides it with `[0,0,-64]`; it always copies the body rot. Clips: `idle`, `hurt` (step, 2 x 50 ms, flash on, head up, 0.1 m jolt back), `flinch` (150 ms + hold), `windup` (500 ms: back 0.15 m + pitch 10, scrape dips at 150 / 300 / 450 ms), `charge` (gallop bob loop), `die` (400 ms roll onto the right side, 98 deg thud key at 320 ms, settles at 90), `dead` (held), `sink` (500 ms, 0.55 m down). Mounts `notice`, `forefeet`, `hit`, `loot`. Roll sign: ry + = top to the boar's right (+x at yaw 0).
- **`ASSETS.boarFx`:** `clipFor.state` (sim state -> clip), `hurt` (6 flash + 9 flinch steps, rule), `death` (timeline in steps: hurt 0-5, die 6-29, thud `dust` n 6 at 25, `dead` + lootable at 30; `corpseTimeoutSec` 90 suggestion; `afterLoot.delaySteps` 18; `sink` 30 steps with `corpseDust` n 8 at 0 + n 6 at 15, remove at 30; `corpseCentre` right 0.6 / up 0.25 m; `lootInteract` `[E] Loot boar` r 1.6; `lootGlint` sprite at z + 0.7), `notice` (`!` at z + 1.1, 6-step pop style then alert), `scrape` (kicks at windup steps 9 / 18 / 27, 4 clods each, thrown backward), `overlay` styles `beastNotice` (alert `[255,210,58]`) + `beastNoticePop` (`[255,246,196]`), `particles` (EmitterDef presets `scrapeDust`, `corpseDust`, optional `hurtBristle`, palette-key colours, README 8 format) and `attach()` (copies them into `ASSETS.particles.presets` if missing).
- **`ASSETS.items`** (`design/items.js`, classic script after `palette.js`): `defs[id]` = `{ id, name, kind, stackMax, desc, hand, inPack, use?, glyph {ch, c}, icon {w 5, h 3, glyphs[3], fg[3]}, sprite?, placeholderName }`; ids `sword`, `spell.fireball`, `torch`, `boar.meat` (food, 10, heal 10), `boar.hide` (20), `boar.tusk` (20), `orb.hp` / `orb.mp` (kind `pickup`, `inPack: false`, used on touch: toast/def only). `keys` = icon colour chars -> `{c palette key, e?}` (shared by all icons; a space fg = transparent). `order` = pack display order. `loot.boar` = `{ mode 'corpse', entries [{item, chance, n}] (meat 1.0, hide 0.6, tusk 0.25), groundDrop {chance 0.5, kinds hp/mp}, rollOrder, packFull }`. `toast` (UI 160x60, literal RGB): rows 4-6 centred, 3 lines, 90 steps, `{glyph} +{n} {name}`, pop 4 steps, fade last 18 steps, stack-merge rule, `messages` (Pack full / Not hurt / Material - no use yet / orb texts). `validate(palette)` -> [] when OK. `attachSprites()` registers `ASSETS.lootSprites` (`lootGlint` 3x3 emissive twinkle; spare `lootMeat` / `lootHide` / `lootTusk` = the icons as billboards) into `ASSETS.models`.
- **Palette:** colours `alertLight`, `alert` (#ffd23a), `alertDark`; `ui.alert` / `ui.alertPop`.

## 14. Spell hand, fireball, pack screen (`design/models/spell.js`, `design/models/inventory_ui.js`, Sprint 6 pass B, v1.35)

- **Load:** `spell.js` after `palette.js`, `detail-pass.js`, `models/particles.js`; `inventory_ui.js` after `models/title.js` and `items.js`. main.js: `ASSETS.spellFx.attach()` before the particle `defineEmitter` loop (adds the presets to `ASSETS.particles.presets`, the sprites to `ASSETS.models`).
- **`ASSETS.voxelModels.spellHandL`** (cellM 0.02, 7x7x23, anchor = pivot = wrist `[3,1,11]`, one part `hand`, clip `held`): leather glove + bronze-rimmed laced bracer, palm up and cupped, bronze focus plate, charred fingertips, an **emissive voxel ember coal** in the cup (`ember_core` heart, `ember_glow` skin + 2 tongues). Mounts `ember` = `cast` = coal centre `[3,4,17]`, `palm`, `wrist`. Authored LEFT (thumb +x).
- **`ASSETS.viewModels.spellHand`** (README 7.4 + `hand: 'left'`; the engine mirrors it for the right hand, architecture.md 37.8a; do not mirror data): clips `idle` (2.0 s), `charge` (holdMs 600), `chargeHold` (240 ms tremble loop), `cast` (tMs from castTick, flick 0-167, settle by 333; blend), `castHard` (key 0 = charge end; shove 67, recoil 133, rest 600), `fizzle` (250), `raise` (300), `lower` (250). `castOffset {right 0.22, fwd 0.50, down 0.135}` = the ember mount at rest (left: right negative) = the value for `spellConfig` (37.14's 0.25 / 0.45 / 0.30 is off-screen below the 23.3 deg vertical half-FOV). `carriedLight` (preset `spellEmber`, offset = ember), `glow` (intensity multiplier per state: charge 1 -> 2.2, chargeHold pulse, cast dip 0.3 -> 1, fizzle sputter), `chargeReady` (1-cell glint at the ember mount, 100 ms), `sparks` (optional sim-side `handSparks` at eye + castOffset). The coal is voxels, not a sprite: it is ~0.5 m from the eye (sprite cull 0.6 m) and the view-model layer only poses the whole model.
- **`ASSETS.spellSprites`** (README 4, glyph-painted keys `1`-`4` flameTip..flameCore, `E` emberHot, `s` ashDark lit smoke): `fireballCore` 9x6 (0.36 m, anchor centre, `fly` 4 frames 12 fps, half 5x3), `fireballCoreCharged` 13x8 (0.52 x 0.48 m, half 7x4), `fireballBlast` 17x9 (1.6 x 1.27 m, `burst` 40/40/50/60/70 ms, half 9x5), `fireballBlastCharged` (same art, 2.4 x 1.9 m).
- **`ASSETS.spellFx`:** view rules (core frame rule, trail cadence, light / flash / kick / cap, burst sprite + particle counts, scorch decal idea for DECAL-01), particle presets `fireTrail`, `fireballBurst` (n 20 / 28), `fireballSmoke` (8 / 12, lit <= 35 %), `fireballCinders` (6 / 10, ground hits), `handSparks`; `validate(palette)`; `util` (rotApply, sampleKeys, mountEye with mirror, mx).
- **`ASSETS.uiStyle.inventory`** (fixed 160x60 UI layer, literal RGB): panel 100x29 at (30, 15), rope frame + bronze corners, `PACK` title, `paused` tag; hands strip (bronze 9x5 boxes at panel (3,2) / (55,2), label + `[LMB]` / `[RMB]`, name, kind, empty-hand ghost glyph); 6x4 grid at (3,8), pitch 8x4, shared borders, 7x3 interior with the 5x3 `items.js` icon at (2,1), count `x{n}` on the bottom border, `L` / `R` hero-green tag on the top border, gold `#`/`=` cursor drawn last, flashes assign / cleared / use / refuse; details panel (55..96, rows 8..24: icon box, name, kind text, hand status / count, 4-line desc, actions by kind); key hint row 26; `nav` rules; `mock` pack for the preview.
- **Palette / detail-pass (appended):** lights `fireballLight` (flameOuter 0.9, r 4, moving), `fireballLightBig` (1.1, r 5), `fireballFlash` (flameCore 1.6, r 6, 150 ms), `fireballFlashBig` (2.0, r 8), `spellEmber` (flameMid 0.35, r 2.0); materials `ember_core`, `ember_glow` (v1 + v2 + remap).
- **Preview:** `preview/fireball.html` (http): first-person hall with the mirrored / authored glove, every clip, tap / hold / floor hit / fizzle / equip sequences, the ball + trail + light + burst + flash + kick through the real particle sim; key-pose strips; sprite sheets + live loops; the interactive pack screen over a 240x90 / 400x150 scene; ~30 checks.

## 15. Title menu + settings controls (`design/models/menu_ui.js`, S8-A-04 / S8-A-05, v1.41)

- **Load:** classic script after `models/title.js` (title.js assigns `ASSETS.uiStyle = {...}` incl. `uiStyle.settings`). Append-only: no existing `uiStyle` key, palette entry or value changed; no new palette colours.
- **`ASSETS.uiStyle.menu`** (title menu card, for `game/js/ui/titleMenu.js` S8-C-03): geometry = the US-090a placeholder (72 x 28 centred, rows New 6 / Continue 8 / slots 12-14-16 / Delete 19 / Settings 21, new-mode slots 8-11-14 + Back 20, confirm Cancel 12 / Yes 15, message 24, key hints 26). Fg values are palette keys; `menu.hex[key]` = the same colour as `'#rrggbb'` for `ui.setCell` callers, `menu.bg` = named backgrounds (`plate` #0a0b10, `band` #342a10 focus band, `bandOff` #14141a disabled hover, `softEmber` #d67040 destructive fg). Tokens: `frame` (`+ = |`, brass, brassLight corners, rivets `o` at cols 3 / 68), `title` (row 2, `-=[  K E S T R E L  ]=-`), `subtitle` (row 3), `signal` (SOS marks over the row-4 separator, aetherDim / aether), `separators` (4, 18 main only, 23), `sectionLabel`, `row` (`normal` / `focus` band + `>` `<` markers in gold / `disabled` uiDim + suffix / `destructive` softEmber), `slot` (per-part columns icon `[#] [ ] [!]`, label, name, place, right-aligned time, `selectedMark`, `flatFallback`), `confirm`, `message`, `keyHints`, `version`, `adopt` (what lane C changes).
- **`ASSETS.uiStyle.settings.controls`**: `select` (`< text >`, end-stop arrows), `strip` (all choices, current bracketed, disabled choice skipped), `slider` (`[====|-----] 7`, 10 cells), `toggle` (`[#] On` / `[ ] Off`), `action`, each with `normal` / `focus` / `disabled` palette keys; shared `label`, `marker`, `band`, `disabledSuffix`.
- **`ASSETS.uiStyle.settings.quality`**: GFX-01 row, choices `low medium high ultra auto` (= `gfxPresets.js` QUALITY_CHOICES), `text`, `autoResolved` (`Auto (High)`), `notes` (writer may reword, S8-A-12), `lead` / `trail` 1, 39 cells wide.
- **`ASSETS.uiStyle.settings.full`**: the 64 x 25 Settings panel (S8-C-04). Same field names as the US-038b block (`panel`, `frame`, `title`, `plate`, `sceneDim`, `fade*`, `rows`, `rowOrder`, `labels`, `valueText`, `notes`, `note`, `separator`, `keyHints`, `stepRule`) plus `bgRgb`, `layout` (explicit row y + section labels GRAPHICS / SOUND / COMFORT), `section`, `controlOf` (id -> control), `mock`. Rows: quality, shadows, grid, volume, mute, textSize, reduceMotion, back. The 40 x 12 `uiStyle.settings` stays the pause panel until S8-C-04 switches to `settings.full`.
- **`uiStyle.inventory`** (appended in `inventory_ui.js`): `slot.disabled` (dotted rope border, dark interior, quiet `x`, not focusable), `hands.disabled` (dotted frame, `(busy)` tag), `states` (normal / focus / disabled map, `lockedText`).
- **Preview:** `preview/ui-menu-settings.html` (opens from file://): interactive title menu (3 save mocks), settings panel, control-state sheet, pack screen with the disabled states; scene 240x90 / 400x150, display 6x9 / 8x12 px per UI cell, night / day backdrop; checks (colour refs, hex = palette, ASCII, widths <= 100, slot columns, strip width, layout, old keys untouched, contrast).

## 16. Treasure chests (`design/models/chest.js`, S8-A-06, v1.42)

- **Load:** classic script after `models/voxel_beast.js` in `game/index.html` (+ `module.exports` for Node: `{ chestSmall, chestBig, chestFx }`). Only already-merged materials (`wood`, `timber_old`, `iron_dark`, `brass_light`, `brass_hot`, `brass_dark`, `brass_glint`); no palette / detail-pass edit. A content file that places a chest also needs the file in `tools/validate-content.mjs` / `tools/content-smoke.test.mjs` / the editor list (same as the boar).
- **Sets:** `ASSETS.voxelModels.chestSmall` / `.chestBig` = `ASSETS.models.chestSmall` / `.chestBig` (record `{ name, desc, voxel, world, interact, readability }`), `ASSETS.chestFx` (view data for S8-C-06 / S8-B1-04).
- **Models** (cellM 0.05, `meshOnly: true`, anchor = footprint centre bottom, front = local -y = the lock side):

  | key | grid | world (m) | lid layers |
  |---|---|---|---|
  | `chestSmall` | 14 x 9 x 11 | 0.70 x 0.40 x 0.55 | 4 |
  | `chestBig` | 22 x 15 x 18 | 1.10 x 0.70 x 0.90 | 7 |

- **Parts** (look up by name): `glint` (root, the plus sealed in the floor), `body` (root: base, walls, floor, lock plate), `loot` (child of body: the light layer between body and lid), `lid` (child of body, pivot = back hinge `[sx/2, sy, zb+1]`; rot x **negative** opens, -110 = open).
- **Clips:** `closed` (loop, step, 2200/90/90/90: hasp glint `+ x +`), `open` (0.6 s, non-loop, held: latch pop + body hop, catch, swing, overshoot -118, bounce, settle -110; events `unlatch` 1, `swing` 3, `thud` 5, `reveal` 6 = 530 ms), `opened` (lid -110, loot part 64 voxels down). `chestFx.clipFor = { closed: 'closed', opening: 'open', open: 'opened' }`; switch `opening` -> `open` (= clip `opened`) after the grant.
- **Mounts:** `prompt`, `loot` (item rise point), `light`, `dust` (behind the hinge), `hinge` (lid), `glint` (hasp front, lid).
- **Glow when closed with loot:** the `loot` layer is `brass_glint` (emissive 0.90) round its edge, so a white-gold seam glows between the dark iron body rim and lid rim; open, it is the glowing pool. **Engine note (PO):** emissive voxels do not light the ground; `chestFx.light` asks for a point light at `mounts.light` (`lantern` colour, closed 0.25 / r 1.4 m, open 0.90 / r 2.6 m from 60 ms, off once `opened`).
- **Interact defaults:** `interact` / `chestFx.interact` = radius 1.6 m from the anchor, facing within 70 deg, from the front half-plane, prompt `[E] Open`. The sim's content data (S8-C-06) owns the final numbers.
- **Preview:** `preview/chest.html` (http): both chests, all clips, a cycle (closed -> open -> held -> opened), an open-clip time scrubber and a lid-angle scrubber (loot on/off), orbit + 5 fixed views, in-game crops closed / mid-open / open at 1.6 m and 6 m (240x90 or 400x150), checks (validator, mesher tris, 600 ms, events, sealed glint, hinge direction, clip map).

## 17. Item icons + item-get card (`design/items.js`, `design/models/menu_ui.js`, S8-A-07, v1.43)

- **No new file to load:** both live in already-loaded scripts (append-only diffs). No palette, detail-pass, level or engine file changed.
- **`ASSETS.items` (appended):** 8 new defs `shield`, `lantern`, `key.small`, `bow`, `bomb`, `heart.piece`, `cog`, `brass.scrap` (names + `desc` = writer list, docs/story.md "S8-A-13 Items"; `placeholderName` not set). 12 new icon colour keys `A` brassLight, `B` brass, `J` brassDark, `j` brassShadow, `V` brassHot, `v` verdigris, `K` ironDark, `U` rust, `F` copperLight, `p` copper, `o` copperDark, `X` lantern (emissive). `items.order` gets the 8 ids at the end. New `items.iconSet` = the S8-A-07 12-icon list in sheet order: `sword, shield, lantern, orb.hp (the "potion" icon: canon has no potions), key.small, bow, bomb, heart.piece, cog (currency), boar.hide, boar.tusk, brass.scrap`.
- **New optional def fields:** `kindNext` (the kind the def should get once S8-C-08 adds it to both KINDS lists: `shield`, `key`, `upgrade`, `currency`; today the def uses an accepted kind so `validateItemDefs` does not throw at boot), `pending: 'owner'` + `pendingNote` (**`cog`: currency is an open owner question, GDD 10 - pending owner**; icon + def ready, nothing grants it), `note` (free text).
- **`ASSETS.uiStyle.itemGetCard`** (appended in `menu_ui.js`, menu conventions: fg = palette keys, `hex[key]` for `setCell` callers, `bg[name]` / `bgRgb[name]` = `plate` #0a0b10, `band` #342a10, `glow` #40300e, `glowHot` #5c4616): 56 x 11 card at UI (52, 24); `frame` (brass `+ = |`, rivets cols 3 / 52, `[ FOUND ]` tag row 0), `titleBar` (row 1, band bg, item name gold with `*` brassHot decor, white pop 0.07 s), `separator` (row 2), `iconBox` (9 x 5 at (3, 3), `border`, icon at box (2, 1), gold / brassHot border + glow / glowHot interior pulse 1.2 s), `sparkles` (8 cells round the box, 8-frame twinkle `. + * + .`, 0.09 s, phase 3 x i), `desc` (15, 4, w 38), `kind` (15, 6: `text[kindNext || kind]` + ` - either hand` when `hand`), `count` (15, 7: `x{n} in the pack`, `heart.piece` progress `{n} of 4`, `full` soft-ember line), `pending` (15, 8, dev only), `footer` (row 9: queue `{i} / {n}` + `- any key -` after the key lock, blink), `timing` (hold 1.5 s, key lock 0.25 s, fade 0.12 / 0.10, gap 0.10), `sceneDim` 0.5, `plate`, `mock`, `adopt`. `reduceMotion`: no pulse, no sparkles.
- **Preview:** `preview/item-icons.html` (opens from file://): icon sheet colour + 1-colour fallback (with the other 4 pack icons), 2x sheet + 1-cell glyphs as toast lines, the card over a 240x90 / 400x150 scene with a 3-item queue, single grants, any-key, freeze, reduce motion, pack-full; data table; checks.

## 18. M1 props set (`design/models/props_m1.js`, S8-A-08, v1.44)

- **Load:** classic script after `models/chest.js` in `game/index.html` (+ `module.exports` for Node: `{ propsM1, <key>... }`). Only already-merged materials; no palette / detail-pass edit. A content file that places one of these props also needs the file in `tools/validate-content.mjs` / `tools/content-smoke.test.mjs` / the editor list and any Node loader that loads that level/world (same as the chest).
- **Sets:** `ASSETS.voxelModels.<key>` = `ASSETS.models.<key>` (record `{ name, displayName, desc, voxel, world, colliders, group, placement, readability }`; pedestal + `sword`), `ASSETS.propsM1` (`keys`, `groups`, `budget`, `lanternPost.clipFor` / `.light`, `hueFamily`).
- **Models** (all `meshOnly: true`, anchor = footprint centre at ground level, front = local -y):

  | key | group | cellM | grid | world (m, above ground) | parts | clips |
  |---|---|---|---|---|---|---|
  | `waystoneSmall` | waystone | 0.125 | 8 x 6 x 12 (2 buried) | 1.0 x 0.5 x 1.25 | `stone` | `idle` |
  | `waystoneLeaning` | waystone | 0.125 | 12 x 8 x 19 (2 buried) | 1.1 x 0.6 x 2.1, ~12 deg east | `stone` | `idle` |
  | `waystoneFallen` | waystone | 0.125 | 22 x 10 x 7 (1 buried) | 2.75 x 1.0 x 0.6 | `stone` | `idle` |
  | `lanternPost` | lanternPost | 0.06 | 14 x 7 x 43 (2 buried) | 0.84 x 0.42 x 2.46 | `lampDark`, `lampLit`, `postLow`, `postHigh` (child) | `lit`, `unlit` |
  | `breachRubble` | breachRubble | 0.06 | 36 x 26 x 15 | 2.16 x 1.56 x 0.90 | `frontW`, `frontE`, `backW`, `backE` (static quadrants) | `idle` |
  | `swordPedestal` | swordPedestal | 0.05 | 18 x 18 x 18 | 0.9 x 0.9 x 0.9 | `base`, `die` (child) | `idle` |

- **Waystone variants** use the end waystone's cellM and materials (`waystone*`, `moss_cap`). Their carved sign is cut in `waystone_dark` (cold): the end waystone keeps the only aether mark in M1 (style guide 2). Option for the PO, not built: an awake remap on one chosen stone.
- **Lantern lit / unlit** = a part swap: `lampLit` (ember panes, hot centre pane) is the rest pose; `lampDark` (dark glass) is stored sealed in the stone foot; clip `unlit` moves `lampLit` 64 voxels down and `lampDark` `+[8, 0, 28]` onto its box. **Engine / content note:** the panes do not light the ground; place a light with preset `lanternHang` at `mounts.light` (`propsM1.lanternPost.light`, prop-local offset (0.48, 0, 1.77) m) and switch it with the clip.
- **Sword pedestal:** the sword prop (`models/sword.js`, unchanged) stands at `mounts.sword` = prop-local (0, 0, 0.90) m, same facing; its 0.12 m buried tip sits in the 0.10 x 0.10 x 0.15 m slot. `mounts.plaque` = the front plaque (scrawl / decal anchor). Placement is an owner / PO option (today the sword is planted in the tower rubble heap).
- **Colliders** (`model.colliders`, architecture.md 37.10, prop-local metres from the anchor): waystones 1-3 boxes; lantern foot box (0.30 m, steppable) + post prism (r 0.09) + lamp box; rubble one box per block taller than 0.12 m (8 boxes; the low front blocks step 0.18 / 0.36 / 0.42 m, so the heap is climbable from the front); pedestal 2 steps (0.15 / 0.30 m) + the die box to 0.90 m.
- **Budget** (style guide 5.14): LOD0 <= 2000 tris per model (engine mesher), each part box sx+sy+sz <= 48, <= 8 parts, <= 3 hue families. None placed: content rows pick the spots (notes in each record's `placement`).
- **Preview:** `preview/props-m1.html` (http): checks at the top (validator, merged materials, LOD0 / LOD1 tris vs budget, part extents, hue families, reserved hues, registration, colliders inside the voxel bbox, mounts, sealed dark lamp + exact swap + light mount, pedestal slot vs the sword depth, waystone marks cold, line-up spacing, night lantern glow), a data table, orbit + 5 fixed views of the selected model, a day + night line-up of all six (+ the sword in the pedestal, lantern pool lighting its neighbours), in-game crops at 3 m and 10 m day / night (240x90 or 400x150).

## 19. ART look sheets (`preview/art-looks.html`, S8-A-10, v1.45)

- **What:** one sheet each for ART-02 (palette per area + remap), ART-03 (warm capped haze), ART-04 (sky gradients + clouds), ART-05 (glyph sets + house depth). Each sheet = 3 poses (meadow, forest edge, house corner), before (today's data) | after (only that sheet's change; "after = all four" stacks them), sliders, checks and a **copy values** button. Global: grid 100x38 / 120x45 / 160x60, look `afternoon` / `evening`, light `ART-01 hemi` (the look records' `hemi`) or `today` (`morning` / `dusk`). Mockups painted by the page (classic scripts, file://), not engine captures.
- **Nothing is applied:** palette.js, detail-pass.js, levels and engine are unchanged. The owner picks per sheet; the main session records the pick in the ART row and the copied JSON goes into the story that applies it.
- **Default values (= the rows / the v1.38 look records):**
  - ART-02: 45 new colour keys (art-ref `NEW` hex, unchanged) in 6 areas `meadow`, `crowns`, `autumn`, `rock`, `path`, `house`; every area on, saturation x 1, value x 1.
  - ART-03 `haze`: afternoon `{near 'hazeWarm' #efe6c6, far 'skyCyanHorizon', start 15, full 700, curve 0.65, max 0.78, bgK 0.9, blank 1.01, thin0 0.45, thinK 1.0, edgeMax 0.5}`; evening `{near 'hazeEvening' #e4a682, far 'skyEveHorizon', 10, 400, 0.7, max 0.6, same tail}`.
  - ART-04 `sky`: afternoon `skyCyanHorizon #c8ecf3 @0 / skyCyanMid #52beef @0.45 / skyCyanTop #1c95e0 @1`; evening `skyEveHorizon #ffc07a / skyEveMid #c4708a / skyEveTop #3e3c86` (same t). `clouds` (both looks): `scale 1.6, bias 0.12, cover 0.5, puffK 3.0, wispCover 0.58, wispK 3.0, wind [0.006, 0.0015], litK 2.2, litDy 0.06, bodyK 0.9, seed 3, ramp 'sky'`; lit / shade `cloudWhite` / `cloudShade` (day), `cloudEve` / `cloudEveShade` (evening). Cloud band stays `materials.sky.cloudBand` [2, 35, 55].
  - ART-05: sets `crownClump`, `bladeFace`, `dirtFace`, `plasterFace` (the art-ref `NS` sets), `crownClump.normalBlend 0.55`, `bladeFace {nearM 10, swayAmp 0.7, swayHz 0.6, waveM 6}`, `flowers {density 0.035, glyphs '*@o.'}`, `houseDepth {post 0.16, beam 0.13, brace 0.10, base 0.06}` m.
- **Copy-values JSON (what the applying story reads):**
  - ART-02 -> `{areas, trims, colors: {key: '#hex'} (append to palette.colors; trims already applied), remap: {"<file>:<path>": value}}`. Remap targets: palette `materials.grass`, detail-pass `materials.grass / leaf / leaf_light / leaf_dark / rock / rock_soft` tones + `rock.overlay.tints`, overworld_far `terrain.grass / forest / rock / path .colors`, NEW records `leaf_autumn_yellow / _orange / _red`, `bark_birch`, `path`, house `beam / plaster / slate_base / terracotta`; forest_trees birch crowns and one ground_detail tuft (text instructions). Only areas that are on are emitted. Designer story ART-02b applies it (append-only: new keys / records; existing tone lists edited in place = owner-approved remap).
  - ART-03 -> `{timeOfDay: {afternoon: {haze}, evening: {haze}}, colors?}`: replace the `haze` block of each look record 1:1 (field names = architecture.md 37.18 item 2 / 4, validated by `engine/render/look.js` `validateLook`); `colors` only when a near colour was changed.
  - ART-04 -> `{timeOfDay: {<look>: {sky, clouds}}, colors?}`: replace `sky` and `clouds` of each look record 1:1 (37.18 item 5); `colors` only for changed sky / cloud keys.
  - ART-05 -> `{detailPass: {sets, useSets}, art05: {crownClump, bladeFace, flowers, houseDepth}}`: `sets` append to `detail-pass.js` `sets`; `useSets` = which v2 material faces switch to them (designer edit); `art05` = model / content rules (house models use `houseDepth`; crowns use `normalBlend`) plus the engine asks below.
- **Engine still needed (PO / architect):** ART-03a/b (terrain + material-path haze, outdoor bit from ART-01b), ART-03c later; ART-04b (GPU clouds + the per-octave drift wrap), ART-04c cloud shadows later; ART-05: per-cell blade lean by a wind phase (`\ | /` swap, nothing like it today), a terrain flower speck layer for far ground (scatter is near-band only), crown normal blend needs per-vertex / per-voxel normal control. ART-02: none; an optional near / far colour split for terrain types if the owner wants "turf* for calm far ground".
- **Mock limits:** own hash (cloud shapes differ from `sky.js`, the formula and order are the same), no edge pass (`edgeMax` not shown), simple screen-space relief shadows instead of D-043 shadow maps.

## 20. Quest marker (`design/models/quest_mark.js`, owner request 2026-10-08, v1.46)

- **What:** a WoW-style golden 3D `!` floating over the ACTIVE quest step's target (note, sword, waystone ...). One marker at a time: step done -> clip `fade`, remove the entity after `fadeMs`; next step -> a new marker at the next target with clip `pop`, then `idle`. Asset only: no engine / game / content wiring yet.
- **Load:** classic script after `models/props_m1.js` in `game/index.html` (+ `module.exports` for Node: `{ questMark, questMarkTurnIn, questMarkFx }`). Only already-merged materials (`brass_light`, `brass_hot`, `brass_dark`, `brass_glint`, `iron_dark`, the chest set); no palette / detail-pass edit. A content file that places a marker also needs the file in `tools/validate-content.mjs` / `tools/content-smoke.test.mjs` / the editor list (same as the chest).
- **Sets:** `ASSETS.voxelModels.questMark` / `.questMarkTurnIn` = `ASSETS.models.*` (record `{ name, desc, voxel, world, readability }`), `ASSETS.questMarkFx`.
- **Models** (cellM 0.05, `meshOnly: true`, 9 x 5 x 25 voxels = 0.45 wide x 0.25 deep; z0..z6 empty = the 0.35 m float, z7..z24 the glyph = 0.90 m incl. its rim; **anchor `[4.5, 2.5, 0]` = the base point**: instance z = the top of the thing it floats over):

  | key | glyph | status |
  |---|---|---|
  | `questMark` | `!` (rounded bar tapering to a point, 4-voxel gap, 5 x 3 dot) | active marker |
  | `questMarkTurnIn` | `?` (same style, size, clips) | **later** (WoW "turn in"; no step uses it yet) |

- **Look:** a 5-voxel-deep gold slab. Faces (y0 front, y4 back): edge cells `brass_light`, interior `brass_hot`, a white-gold core line `brass_glint` (emissive 0.90: the highlight by day, the glowing stroke at night; mirrored on the back face). y1 / y3 `brass_light`, y2 `brass_dark` (dark seam when edge-on). Layer y2 also holds the **dark back plate**: an `iron_dark` ring on every cell 4-adjacent to the glyph, so it reads against a bright sky.
- **v1.49 look (owner 2026-10-08: "why does it have a dark silhouette? I thought the whole sign would be white or orange"; supersedes the Look bullet above, kept as history):** the WHOLE glyph glows, only 3 merged emissive materials, no palette / detail-pass edit:
  - faces y0 / y4: body `brass_hot` (#fff0b4, emissive 0.10), core `brass_glint` (white, 0.90; v1.47 rule unchanged: 3-wide band on the '!' bar head, 1-voxel line on 3-wide strokes, solid 3 x 3 dot core), and the **bottom lip** of every stroke (face cell with no glyph cell below) `ember_glow` (orange, 0.90): white-hot on top, a little orange underneath;
  - y1 / y3 `brass_hot`; y2 `ember_glow` on the glyph's outer wall (a thin orange seam along every side when it turns, replaces the `brass_dark` seam), hidden y2 interior `brass_hot` (keeps the 38.12 pack-time derive count honest);
  - **rim decision: removed, no rim voxel at all.** No `iron_dark` plate, no warm-dark rim layer. Reason: in this renderer every model cell already has its own dark background (`bg: darken`, k 0.20 `brass_hot`, 0.25 `brass_glint`, 0.30 `ember_glow` of the lit glyph colour), so the mark's cells form a warm dark-gold block with bright glyphs against the light-blue sky cells; plus warm-vs-cool hue opposition. The preview check below proves it on Low 240x90 at 12 m, so a rim layer would only bring back the dark outline the owner rejected;
  - size, anchor, pivot, mounts, clips and `questMarkFx` unchanged: x0 / x8 and z7 / z24 are now empty 1-voxel pads; the bar / dot gap is 3 empty voxels (0.15 m);
  - hue families: white-gold + a touch of ember orange (the "glow hue = warm orange-gold" owner pick). Night: the `brass_hot` body is only emissive 0.10; it is lifted by the bleed of the core band + orange lips (EMIS-03, medium) and `questMarkFx.light`. If the owner wants the body brighter at night too, the option is `ember_core` (flameCore #fff4a0, emissive 1.0) for the body: model-only swap, owner pick, not done;
  - new preview checks: **whole glyph emissive** (per model: share of visible voxels, i.e. filled voxels with an empty / outside 6-neighbour, on materials with emissive > 0, must be >= 90%; v1.49 = 100%; info line with the strong-emitter share, emissive >= 0.5), **no dark rim** (0 non-emissive voxels, no `iron_dark`; in-game 3 m day: 0 dark mark cells), **reads against bright day sky at 12 m (240x90)**: silhouette cells = mark cells 4-adjacent to a sky cell, appearance = 35 % glyph ink + 65 % cell bg, mean appearance vs the day sky colour must have WCAG contrast ratio >= 2.0 AND be warm (R - B >= 20) while the sky is cool (R - B < 0); 400x150 values as info. The preview's approximate edge pass now leaves every cell with emissive >= 0.5 alone (was `brass_glint` only).
- **Parts:** one, `mark` (box z7..z25, pivot = glyph centre `[4.5, 2.5, 16]`; spin = rot z).
- **Clips:** `idle` (loop 2 s: rot z -180 -> +180 = 0.5 rev/s, bob 1.6 voxels = 0.08 m sine; 16 keys x 125 ms + a 0.01 ms wrap key at +180, because rot is limited to +-180 and durations must be > 0: the stepper skips it), `bob` (bob only, for a view that spins via `inst.yawDeg`), `pop` (0.3 s, held: rises from -0.2 m, overshoots, 180 deg whip, ends on idle key 0), `fade` (0.25 s, held: hop up + whip). `questMarkFx.clipFor = { appear: 'pop', active: 'idle', complete: 'fade' }` (`clipForEngineSpin` = the `bob` variant).
- **Scale in / out (engine note):** voxel clips have no scale key. The view sets the instance scale (ED-SCALE-1a, uniform, about the anchor = the base point, so the marker grows out of / sinks into its target) from `questMarkFx.popScale` / `fadeScale` (`[ms, scale]`, piecewise linear; floor 0.05 because `computeVoxelPose` treats scale <= 0 as 1). `fade` starts at rot 0: add the current idle angle to `inst.yawDeg` to avoid a snap (`fadeNote`).
- **Mounts:** `light` (glyph bottom), `anchor` (base point), `center`, `top` (spare, e.g. a boar counter). **Engine note (PO):** `questMarkFx.light` = a low gold point light at `mounts.light` (`lantern` colour, 0.30, r 1.8 m; on from 90 ms into `pop`, to 0 by 150 ms into `fade`), so the note / stone below glows a little at night.
- **`questMarkFx`:** `floatM 0.35`, `bobM 0.08`, `bobPeriodMs 2000`, `spinRevPerS 0.5`, `popMs 300`, `fadeMs 250`, `visibleRangeM 40`, `clipFor`, `clipForEngineSpin`, `popScale`, `fadeScale`, `light`, `placement` (`aboveNoteM 1.9`, `noteZOffsetM 1.55`: instance z = note z + 1.55 -> glyph bottom 1.9 m over a note on the ground; standing targets: instance z = prop top), `chainExample` (owner's chain: note 1 -> sword -> note 2 "kill 5 boars" -> after the 5th boar the waystone; the quest data itself belongs to content / writer).
- **Budget:** LOD0 < 1500 tris each (owner; style rule 5.14 caps 2000), part extent 32, 1 part, 2 hue families.
- **Preview:** `preview/quest-mark.html` (http): checks at the top (validator, merged materials, LOD0 / LOD1 tris, size / float, spin rate, bob amplitude, clip lengths vs fx, pop -> idle hand-over, rim closed, bar / dot gap, scale curves, and rendered readability at 3 m / 12 m day + night on 400x150 and 240x90), modes (cycle pop -> idle -> fade -> gap, each clip, bob + engine spin, idle-time scrubber), orbit + 4 fixed views of both glyphs, in-game crops 3 m / 12 m day / night and a note-on-the-ground mock at 7 m.

## 21. Emissive glow strengths (`preview/emissive-glow.html`, EMIS-00, owner ask 2026-10-08, v1.48)

- **What:** the strength pick for architecture.md 38.12 (derived point lights + bleed pass + halo). One page, 4 columns per scene: `off` (today: material self-emissive only, placed lights stay), `subtle`, `medium`, `strong` (all three = the High tier). Scenes: the golden `!` over a note at 3 m / 12 m, night and dusk; `chestSmall` closed (glint frame) and open; the tower hook lamp (voxel `lantern` lit + `lanternHook` + lampFlame sprite); an ember brazier (mock shape, `torch` light, fire + ember sprites). Mockup computed by the page (cell ray caster on crops of the 400x150 frame, 75 deg HFOV, real voxel data of `questMark` / `chestSmall` / `lantern`, palette colours / materials / ramps), not an engine capture: no textures, edge pass, shadows or LVIS. Works from file://.
- **Nothing is applied:** palette.js, detail-pass.js, models, levels and engine unchanged. The owner picks a strength; the copied JSON goes into EMIS-03a (presets) / EMIS-04 (ramp).
- **Controls:** time day / dusk / night (chest + brazier rows; the `!` rows are fixed night + dusk, the hall is interior), `R_MAX` 1-6 (+ High 4 / Ultra 6: a tier, not a strength), `R_m`, derived light = 38.12 (1) formula or def override, glow hue = base colour (38.12) or the `glowColor` proposal, lamp wick / brazier coal voxel proposals, animate ('!' spin + bob, flicker, sprites), `!` yaw, cell px. Per preset (edit selector): derived / bleed / halo on-off, `lightGain` ("light intensity"), `bleedGain`, `haloBg`, `haloMin`, `haloR`, `glyphRamps.halo`; owner pick; copy values.
- **Presets (defaults):**

  | preset | lightGain | bleedGain | haloBg | haloMin | haloR | glyphRamps.halo |
  |---|---|---|---|---|---|---|
  | subtle | 0.5 | 0.6 | 0.25 | 0.15 | 2 | `" .'"` |
  | medium | 0.8 | 1.2 | 0.45 | 0.08 | 3 | `" .':"` |
  | strong | 1.0 | 2.2 | 0.70 | 0.04 | 4 | `" .':*"` |

  Globals: `R_MAX` 4 (High) / 6 (Ultra), `R_m` 1.2, `EMISSIVE_LIGHT_MIN` 0.5, `glowMin` 0.3, `haloK` 4.
- **Mock maths (what EMIS-03a's `bleedCell` twin should match):** bleed per destination geometry cell = sum over source cells (GLOW.w >= `glowMin`, own cell excluded, |dx|,|dy| <= R) of `(1-(dx/R)^2)^2 (1-(dy/R)^2)^2 exp(-|dist_s-dist_c|/(0.12 dist_c)) * GLOW.rgb`, divided by the full kernel weight `(sum_k (1-(k/R)^2)^2)^2` at that R (`bleedNorm: 'kernel'`), then `Lc += bleed * bleedGain`. Halo on kind-0 cells: `sum(w * GLOW.w) / (sum w)^2` with `w = (1-(k/(haloR+1))^2)^2` per axis, `|k| <= haloR`, no depth term; `a = 1 - exp(-haloK * sum)`; `a >= haloMin` -> `bg = mix(bg, glow*255, a*haloBg)`; space glyph -> `glyphRamps.halo[round(a*(n-1))]`. Derived: 38.12 formula x `lightGain`.
- **Copy-values JSON:** `{pick, gfxPresets {low off, medium derived, high full R_MAX 4, ultra full R_MAX 6}, presets {off, subtle, medium, strong: {emissive, rt.emissive {derived, bleed, halo}, bleedGain, haloBg, haloMin, glyphRamps.halo, R_MAX, R_m, EMISSIVE_LIGHT_MIN, lightGain, haloR}}, applied (= the pick), glyphRamps {halo}, light (def overrides per model), materials {brass_glint {glowColor}} (only with the proposal on), derivedFormula, bleed, halo, invented}`.
- **Invented keys (not in 38.12):** `lightGain`, `haloR` (38.12 = k <= 1), `haloK`, `bleedNorm`, `glowMin` (38.12's literal 0.3), `materials[k].glowColor`. `glyphRamps.halo` = palette `ramps.halo` (append LAST: ramps are indexed by order; must start with a space).
- **Findings (PO / architect):** (1) `brass_glint` base is `white`, so the '!' / chest / lamp glints spill white light: proposal `glowColor: 'brassLight'` (palette edit, needs owner OK). (2) The pack-time derive counts hidden voxels: the sealed glint plus (chest, lamp), the chest loot pool in every state (closed, open, opened). Formula results: questMark n 48.6 -> 0.84 / 3.94 m (fx light 0.30 / 1.8 m); chestSmall n ~83 -> 0.90 / ~4.7 m in every state (fx closed 0.25 / 1.4, open 0.90 / 2.6, opened 0); lantern n 4.5 (sealed glint) -> 0.25 / 2.24 m. Suggest `light: false` on chests + hook lantern (their fx / placed lights follow the state) and the formula or `light: {preset}` on the quest marker. (3) The '!' core is >= 3 cells from the sky at 12 m, so the 38.12 `k <= 1` halo never reaches it: needs `haloR` >= 3 (<= R_MAX). (4) R is always clamped to R_MAX (R_m 1.2 m = 52 cells at 3 m): bleed is a rim of 4 cells (~5 cm at 3 m, ~20 cm at 12 m); the light pool on ground / walls is the derived point light. (5) Lamp flame and brazier fire are sprites, they cannot feed bleed / halo: the wick / coal-bed proposals (existing `ember_core` / `ember_glow`) are model changes for the owner to approve.

## 22. Bare hand + burning hand (`design/models/hand.js`, HAND-ART-01 / HAND-BURN-01, owner ask 2026-10-08, v1.50)

- **What:** Wick's bare left hand + forearm as a first-person view model (1 cm voxels: fingers 2 cubes across with 3 phalanges, knuckle bumps, thumb + thumb ball, nails, palm creases, finger creases, leather wrist wrap with a rope cord, rolled linen sleeve far back), and the **burning hand**: fire wrapping the whole hand and wrist (flame shell on every side, tongues climbing the fingers / between them / round the palm edge / under the back of the hand, a white-hot core in the cupped palm, red breakaway tips, loose ember cubes), skin touched by flame glows (`skin_glow`, emissive 0.35), nails char (`skin_char`). Asset only: no engine / game wiring (rows HAND-ART-01, HAND-BURN-01).
- **Load:** classic script after `palette.js`, `detail-pass.js`, `models/particles.js` (+ `module.exports` `{ handFx, viewModel }`). Builds its voxels procedurally at load (~15 models, a few hundred ms; deterministic hashes, no RNG).
- **Models** `ASSETS.voxelModels.hand<Variant>L` (record `{ name, desc, variantOf 'hand', variant, light: false, voxel, stats }`): cellM **0.01**, authored LEFT (thumb on **-x**, palm face +y, fingers +z; the anatomically correct left hand palm up), each cropped to its own bbox, **anchor = the wrist centre** in every variant, one part `hand`, clip `held`, mounts `wrist`, `palm`, `core` (the fire core = carried light + cast point, the SAME eye point in every variant: checked), `tip` (middle fingertip), `knuckles`. Mats: `a` skin, `L` skin_light, `s` skin_shade, `n` skin_nail, `g` skin_glow, `c` skin_char, `d` linen_dark, `D` linen, `l` leather, `r` rope, `E` ember_core, `e` ember_glow, `t` flame_tip. `light: false` = EMIS-01 must not derive a second light from the fire voxels (the carried `handFire` is the hand's light).

  | variant | pose | fire |
  |---|---|---|
  | `open`, `relax` | relaxed palm up / fingers curled a little more | - |
  | `cup`, `fist`, `cast` | cupped bowl / fist, thumb over the index / fingers flung wide | - |
  | `burnKindle` | cup | ignition: small core, short licks |
  | `burnA`..`burnD` | cup | full burn, 4 flicker frames (cycle `burn`, 12 fps) |
  | `burnFistA/B` | fist | fire squeezed out between the fingers (cycle `burnFist`, 10 fps) |
  | `burnCastA/B` | cast | forward jet off the palm (cycle `burnCast`, 14 fps) |
  | `burnEmber` | cup | dying licks, charred fingertips, glowing specks |

  Voxel counts per variant are in `stats` and the preview table (designer cap 4000 per variant, checked).
- **Variants (NEW view-model field, engine need):** the view-model layer poses the whole model (one FORWARD per part from the `held` clip at load), so finger poses and flame flicker are separate models. `ASSETS.viewModels.hand` = README 7.4 def + `variants {name: modelKey}`, `defaultVariant`, `cycles {name: {variants[], fps}}`. A clip key may carry **`v`**: the variant shown from that key on (step, not blended); `v: '@burn'` = cycle `burn`, frame `floor(simTime * fps) mod n` (sim time, so a clip change never restarts the flicker). Engine without variants: load `model` (static `handOpenL`, or `handBurnAL` for a static burning hand).
- **Clips:** `idle` (6 s: breath + a finger flex open -> relax -> open), `breathe` (2.4 s), `cast` (charge 0-300 fist, release 300-383 fling open + thrust, recover to 700; `castAtMs` 300, `holdMs` 300), `hold` (sustained burn, presented toward the centre, 1.6 s sway), `burnStart` (0.3 s: cup, dip + kindle at 60, whoomp lift + full fire at 140), `burnLoop` (2 s), `burnCast` (burning fist -> jet -> back to the cup), `burnOut` (0.5 s shake -> burnEmber -> cup -> open), `raise`, `lower`.
- **`glow`** (multiplier on `lights.handFire` intensity; missing clip = light off): burnStart keys 0 -> 0.35 -> 1.5 flare -> 1.0, burnLoop 1.0, hold 1.3 + 3 Hz pulse 0.15, burnCast up to 2.6 at release then 0.6 dip, burnOut down to 0. `glowCap` 2.6. **`carriedLight`** `{ preset 'handFire', mount 'core', offset = core at rest }`: one carried light per player (37.8): it replaces spellEmber / the torch light in that slot. **`castOffset`** = the core mount at rest (computed at load, same convention as `spellHand.castOffset`).
- **`particles`** (sim side at eye + carriedLight.offset, 37.8 rule): burnLoop `handEmbers` every 6 steps, hold every 4, burnStart `handIgnite` 10 at 60 ms, burnCast embers every 3 steps until 300 + `handIgnite` 12 along the aim at 383, burnOut 3 embers + `handSmoke` 5. Presets in `ASSETS.handFx.particles` (README 8 format; `attach()` copies them into `ASSETS.particles.presets`).
- **`ASSETS.handFx`:** `tune` (fire numbers: `shell`, `tongues`, `length`, `coreR`, `wristTo`), `build(tune)` / `rebuild(tune)` (preview), `validate(palette)`, `util` (`rotApply`, `rotInv`, `sampleClip(def, clip, tMs, simTime)` -> `{pos, rot, key, variant, model, glow}`, `mountEye`, `resolveVariant`, `glowAt`).
- **Palette / detail-pass (appended):** colours `skinLight`, `skinNail`, `skinGlow`, `skinChar`; materials `skin_light`, `skin_shade`, `skin_nail`, `skin_glow` (emissive 0.35), `skin_char`, `flame_tip` (emissive 0.75) with v2 records + remap; light `handFire` (`torch` colour, 0.7, r 3.5, flicker 8-14 Hz amount 0.20).
- **Emissive today vs EMIS:** uses only what exists now: material `emissive` (self-brightness) + the carried point light with flicker. EMIS-01 derived lights are switched off for these models (`light: false`); EMIS-03 bleed / EMIS-04 halo would add the orange spill on skin and nearby screen cells if the view-model cells are in the G-buffer the bleed reads (architect to confirm).
- **Preview:** `preview/hand.html` (file:// OK): first-person room (wall 2.4 m, floor, ceiling) at 240x90 / 400x150 / 480x180, left + right hand each with any clip or the demo sequence, night / dusk / day, sun direction + elevation sliders, light flicker, particles; fire tuning sliders + rebuild + copy values; orbit sheet of all 15 variants (animated burn cycle); voxel count table; checks (handFx.validate, palette validate, castOffset, voxel cap, engine `validateVoxelModel` over http).

## 23. Valley layout + biome look sheets (`preview/valley-look.html`, `levels/valley_layout.md`, EP-WORLD-VALLEY slice 0, v1.51)

- **What:** PROPOSAL for the owner (D-052). Top-down layout sheet 120 x 80 cells (16 x 24 m per cell, `overworld_far` frame), zone key per cell, level bands, borders, two bridges, fords; six biome look mockups (forest, glade, fields, foothills, river bank + bridge, sea shore) at 240x90 / 160x60 with sun / wind / dusk controls and ambient particles; per-biome scatter recipe tables (mesh family, density, clusters, scale, tint keys, rule, glyphs near / mid / far); ~30 self-checks (borders, east river-then-wall, river continuity, both bridges span the river, near / far separation on dry land, bridges + wading connect, glades inside forest, level bands, ASCII, colour keys, reserved colours).
- **Copy JSON:** layout `{grid, river, bridges, fords, landmarks, legend, rows[]}` (rows = one zone key per cell); looks `{newColors, scatter: {<biome>: [{id, mesh, density, clusters, scale, tint, rule, glyphs}]}}`.
- **Proposed palette keys (not in palette.js):** 15 reused from the ART-02 proposal (`meadow*`, `fern`, `petalViolet`, `petalOrange`, `mossRock*`, `mossCap`, `pebble*`, `dirt*`) + 28 new (`pine*`, `needleBed*`, `sand*`, `sea*`, `surf`, `riverShallow`, `reed*`, `wheatGreen`, `scree*`, `snow*`, `mountainHaze*`, `pollen`, `fireflyGlow` emissive). Full table in the page.
- **Engine asks:** wade surface flag (speed scale + current), per-biome ambient emitters, wind waves on tall grass (= ART-05 blade sway), optional forest light shafts.

---

## Change log
- **v1.51 (2026-10-09, EP-WORLD-VALLEY slice 0)**: new `preview/valley-look.html` + `levels/valley_layout.md` (section 23). Proposal only; no palette, detail-pass, model, level data or engine file changed.
- **v1.50 (2026-10-08, HAND-ART-01 / HAND-BURN-01 bare hand + burning hand, owner ask)**: new `models/hand.js` (section 22: 15 baked 1 cm voxel variants of the left hand, `viewModels.hand` with the NEW `variants` / `cycles` / key `v` fields, glow, carriedLight `handFire`, particle presets `handEmbers` / `handIgnite` / `handSmoke`), new `preview/hand.html`; `palette.js` appended 4 colours, 6 materials, light `handFire`; `detail-pass.js` 6 v2 records + remap. No engine, game, level or existing model changed; `game/index.html` not touched (HAND-BURN-01b adds the script tag). **Engine (architect):** view-model variants (`setVariant`). **Note:** `spell.js` `spellHandL` is authored with the thumb on +x palm up = anatomically a right hand used as the left (the glove hides it); `hand.js` uses the correct left hand (thumb -x).
- **v1.49 (2026-10-08, quest marker rework, owner "whole sign white or orange, not a dark silhouette")**: `models/quest_mark.js` (`questMark` '!' + `questMarkTurnIn` '?'): every voxel emissive (`brass_hot` body, `brass_glint` core band / dot core, `ember_glow` bottom lips + side seam); `iron_dark` back plate / outline ring and `brass_light` / `brass_dark` removed, no rim layer (section 20, v1.49 bullet: rim decision + reason). Size, anchor, pivot, mounts, clips, `questMarkFx` unchanged. `preview/quest-mark.html`: checks "whole glyph emissive (>= 90% of visible voxels)", "no dark rim", "reads against bright day sky at 12 m (240x90)" (contrast rule in section 20); edge-pass approximation skips all emissive >= 0.5 cells. `preview/emissive-glow.html`: halo-reach finding text + '!' caption only (it reads the live model). No palette, detail-pass, level or engine file changed (the approved `glowColor` setting is left to EMIS-03a).
- **v1.48 (2026-10-08, EMIS-00 emissive glow strength mockups)**: new `preview/emissive-glow.html` (section 21): off / subtle / medium / strong columns for the '!' (3 m / 12 m, night / dusk), chestSmall closed + open, the tower hook lamp, an ember brazier; sliders, day / dusk / night, R_MAX tier, formula vs def-override lights, glow-hue proposal, copy values with the 38.12 keys (+ invented `lightGain`, `haloR`, `haloK`, `bleedNorm`, `glowMin`, `glowColor`). No palette, detail-pass, model, level or engine file changed. **Owner:** pick a strength (default suggestion medium). **PO / architect:** brass_glint glow hue, hidden voxels in the pack-time derive (chest / lamp `light: false`), halo reach (`haloR`), lamp wick / brazier coal voxels (sprites cannot feed the bleed).
- **v1.46 (2026-10-08, quest marker, owner request)**: new `models/quest_mark.js` (section 20: `questMark` '!', `questMarkTurnIn` '?' (later), `ASSETS.questMarkFx`), new `preview/quest-mark.html`; `game/index.html` one script tag after `props_m1.js`. No palette, detail-pass, level or engine file changed. **Engine / content notes:** pop / fade scale = instance scale from `questMarkFx.popScale` / `fadeScale` (clips have no scale key); a low gold point light at `mounts.light`; one marker entity per active step (content step not built).
- **v1.45 (2026-10-08, S8-A-10 ART-02..05 look sheets)**: new `preview/art-looks.html` (section 19): four look sheets (ART-02 palette per area + material remap, ART-03 warm capped haze, ART-04 day / evening sky + clouds, ART-05 glyph sets + house depth), 3 poses each, before / after, sliders, checks and a copy-values JSON per sheet (keys in section 19). Defaults = the v1.38 look records + the art-ref tables. No palette, detail-pass, model, level or engine file changed. **Main session:** owner picks per sheet -> record in the ART rows; the applying story pastes the copied JSON (ART-02b designer data, ART-ON look records).
- **v1.44 (2026-10-08, S8-A-08 M1 props set)**: new `models/props_m1.js` (section 18: `waystoneSmall`, `waystoneLeaning`, `waystoneFallen`, `lanternPost`, `breachRubble`, `swordPedestal`, `ASSETS.propsM1`), new `preview/props-m1.html`; `game/index.html` one script tag after `chest.js`; `style-guide.md` rule 5.14 (prop voxel budget). No palette, detail-pass, level or engine file changed. **Content / programmer:** placing a prop = a level/world prop with `components.voxel` (lantern: anim `lit` | `unlit` + a `lanternHang` light at `mounts.light`); the sword-in-pedestal option = the sword prop at `mounts.sword`.
- **v1.43 (2026-10-08, S8-A-07 item icons + item-get card style)**: `items.js` appended (section 17: 8 defs, 12 icon keys, `order` push, `iconSet`, fields `kindNext` / `pending`); `models/menu_ui.js` appended `uiStyle.itemGetCard` (+ 2 header comment lines); new `preview/item-icons.html`. Existing ids, names, keys and icons unchanged. **Lane C (S8-C-07 / S8-C-08):** card reads `ASSETS.uiStyle.itemGetCard` (needs `items.js` (loaded) + `models/menu_ui.js`: its script tag after `models/title.js` in `game/index.html` is still missing, see v1.41); S8-C-08 adds kinds `shield key upgrade currency` to `validateItemDefs` KINDS + `items.validate` KINDS (+ `uiStyle.inventory.details.kind.text` / `hands.kindText`) and then sets `kind = kindNext`; apply the writer's renames to the 8 old ids (`desc` / `name`, `placeholderName: false`) - not done here (append-only rule); decide whether `lantern.take` also grants the `lantern` item; `cog` stays ungranted until the owner answers.
- **v1.42 (2026-10-08, S8-A-06 treasure chests)**: new `models/chest.js` (section 16: `chestSmall`, `chestBig`, `ASSETS.chestFx`), new `preview/chest.html`; `game/index.html` one script tag after `voxel_beast.js`. No palette, detail-pass, level or engine file changed. **Programmer (S8-C-06 / S8-B1-04):** anim = `chestFx.clipFor[state]`, timer = `chestFx.openMs`, item rise / card on event `reveal`, point light per `chestFx.light` (engine note in section 16).
- **v1.41 (2026-10-08, S8-A-04 title menu style + S8-A-05 settings controls / pack disabled states)**: new `models/menu_ui.js` (section 15: `uiStyle.menu`, `uiStyle.settings.controls` / `.quality` / `.full`), `models/inventory_ui.js` appended `slot.disabled`, `hands.disabled`, `states`; new `preview/ui-menu-settings.html`. **Programmer:** script tag `../design/models/menu_ui.js` after `models/title.js` in `game/index.html` (and `titleMenu.preview.html` / Node loaders that need it); S8-C-03 passes `ASSETS.uiStyle.menu` into `createTitleMenu`, S8-C-04 reads `uiStyle.settings.full`. No palette, detail-pass, level or engine file changed.
- **v1.40 (2026-10-06, US-079 real boar model + clips)**: `models/voxel_beast.js`: `boarPlaceholder` redrawn in place as a wild boar (key, part names `body` / `flash`, all clip names, the boarFx-relevant durations, mounts and `ASSETS.boarFx` timings kept; section 13 first bullet). cellM 0.05, grid 12x25x29, anchor `[6,11.5,15]`, `meshOnly: true`; parts `body`, `flash`, `head`, `legFL`, `legFR`, `legBL`, `legBR`, `tail`; only merged materials (`timber_old` hide, `leather` belly, `canvas_burnt` mane / legs / ears, `iron_dark` hooves, `rope` muzzle, `gore_red_dark` nose, `linen_dark` cheeks, `linen_light` tusks, `ember_glow` eyes (const `EYE_MAT`), `hit_flash`). Clips: idle sniff + tail loop (4 keys, 2.4 s), windup = head dip + left-forefoot scrape on the kick keys, charge = 4-key bound gallop (same 200 ms), die = squeal / buckle / roll / leg kick on the thud key / stiff legs, new spare `walk`. `boarFx`: text only (clipFor note mentions `walk`, scrape note). New `preview/boar.html`; `preview/voxel-props.html` links it. **Programmer (optional, not required):** `walk` for wander / return while moving = a `beastView.js` STATE_CLIPS change. No palette, detail-pass, level or engine file changed.
- **v1.39 (2026-10-06, owner "the balloon should look like cloth")**: the static balloon pieces read as soft fabric. `detail-pass.js`: new set `fabricFace` (`. '`, backtick, `~ - ) ( "`; no `= % #`), 9 v2 records + remap (`balloon_light`, `balloon`, `balloon_dark`, `balloon_red_light`, `balloon_red`, `balloon_red_dark`, `tarp_light`, `tarp`, `tarp_dark`; existing colours only). `palette.js` (appended, no existing value changed): ramp `fabric` and the same 9 v1 materials. `models/voxel_tower.js`: the 9 keys in `voxelMaterials` (batch2 now 27 keys), `canvasHeap` and `envelopeHeap` rebuilt as cloth (section 7.1 note; same grids / anchors / parts / placement, no colliders - PROP-COLLIDE unchanged; envelope top 1.44 -> 1.4 m). Shared `canvas_*` / `linen*` / `gore_red*` untouched (walls, trees, objects, gondola sandbags keep their look); the gondola is not touched. `models/wreckage.js`: `envelopeDrape` (stairwell billboard, prop `canvasDrape`) redrawn 10x8 -> **18x16** (half 5x4 -> 9x8), same world 1.4 x 1.9 m and anchor rule: sagging swags between 4 eyelets, 3 gores with rope seam tapes, hanging folds, burnt tear, ragged swaying hem; new keys `L m d t`, eyelets `brass`. `preview/voxel-props.html`: ladder groups -> the new keys, 400x150 view for the two heaps. `style-guide.md` 7d: static fabric rule. **Engine note (PO / architect):** the voxel edge pass draws `= | _` on every voxel step (global `edges.rules`), which still makes a stepped cloth heightfield look carved; a per-material edge override (e.g. `edgeSet: { cap: '~', side: ')' }` on the fabric materials) or no rule edges inside one fabric model would finish the look. **Cloth-sim proposal (not wired):** `canvasDrape` could become a real `cloths[]` entry like `stairwell.canvas` - preset `canvas`, mat `cloth.canvas`, 8 x 10 nodes (80, < half the stairwell's 192), size [1.4, 1.9], plane vertical, yawDeg 90, origin = top edge on the upper-stair beam (~[14.5, 6.7, 5.4]), pins [[0,0],[3,0],[7,0]] (swags between), holes for the tear + torn hem ([2,4],[2,5],[3,5],[0,9],[1,9],[5,9],[7,8],[7,9]), castShadow false, sleepDist 40; then drop the billboard prop. Needs an architect check of the beam edge / collider (the drape hangs in the open stairwell).
- **v1.38 (2026-10-06, ART-02a look data, architecture.md 37.18 item 2)**: `palette.js` (appended only, no existing value changed): 23 colours from the art-ref NEW table, hex unchanged (day `skyCyanTop/Mid/Horizon`, `cloudWhite`, `cloudShade`, `sunAfternoon`, `sunRay` (spare, sun shafts not in the engine), `ambientSky`, `bounceGrass`, `hazeWarm`; evening `sunEvening`, `ambientEvening`, `bounceEvening`, `shadowPurple`, `hazeEvening`, `skyEveTop/Mid/Horizon`, `cloudEve`, `cloudEveShade`; lamps `lanternWarm`, `lanternCore`, `windowGlow`); light presets `lanternHang` (lanternWarm 0.9, r 3.0 m, flicker 6-10 Hz 8 %) and `windowGlow` (windowGlow 0.35, r 1.2 m, calm 3-6 Hz 5 %), not placed; `timeOfDay.afternoon` (ambientSky 0.40, sunAfternoon 1.15 @ 42 deg) and `timeOfDay.evening` (ambientEvening 0.30, sunEvening 0.95 @ 12 deg) with today's fields plus the NEW optional blocks `hemi` / `haze` / `clouds` (field names + units = architecture.md 37.18 item 2; validated by `engine/render/look.js` `validateLook` once ART-01a lands, ignored by the engine until ART-01/03/04). Rule: `haze.far` === the look's `sky[t=0].c`. `defaultTime` stays `'morning'` (ART-ON switches it after the owner look). Material remap colours (meadow, lime, autumn, dirt, plaster, beam, slate, terracotta...) = ART-02b. No model, level, detail-pass or engine file changed.
- **v1.37 (2026-10-06, ART-REF-01 art target, D-042 item 3)**: new `preview/art-ref.html` only: the owner's two reference images (A stylized autumn meadow, warm afternoon; B half-timbered house corner, low evening) as coloured-glyph mockups (fg glyph + bg per cell, 160x60 .. 400x150, v2 shading rules, existing detail-pass sets + 4 proposed sets `crownClump` / `bladeFace` / `dirtFace` / `plasterFace` defined in the page), with a current / proposed / split palette toggle, light + haze sliders, and the targets: ~70 proposed colour keys (page table `NEW`, each with its nearest current key), afternoon / evening light + haze presets, lantern / window presets, a "too dull" key list and a "how to get there" list. **Proposals only: no palette, detail-pass, model, level or engine file changed.** Engine asks noted in the page: hemisphere ambient + shadow tint, haze `max` cap, sky cloud layer + cloud shadows (small); sun shafts and emissive bloom halo (new).
- **v1.36 (2026-10-05, owner tower feedback: wall lanterns + readable notes, READ-01 / TORCH-01b)**: `content/levels/tower.level.json`: removed props `floorLampSword`, `floorLampScrawl` (+ their `lanternFloor` lights) and the 6 decal props `scrawl`, `scrawlSword`, `scrawlMason`, `scrawlKeeper`, `scrawlKeeper2`, `scrawlKeeper3`; added 3 copies of the burner wall lantern (model `lantern` lit + `lampFlame` + light preset `lanternHook`, decoration, same placement rule: anchor 0.1 m off the wall, flame/light 0.181 m further out at z + 0.156 / + 0.219): `keeperLamp` (18.9, 9.3, 1.3, facing 270, mid-ledge west face), `stairLamp` (14.1, 3.4, 1.3, facing 90, over the slope apron), `swordLamp` (12.45, 6.9, 2.0, facing 0, over the rubble heap by the sword); added 4 note props + 4 `note.read` interactables (`noteId` -> `ASSETS.notes`, prompt `[E] Read`, `once: false`): `noteKeeperLog` (flat, keeper's mat), `noteKeepLight`, `noteSteelHush`, `noteMason` (pinned). Interactable field is **`noteId`**, not `note` (every level entry already uses `note` as the free-text comment). Tower lights 5 -> 6. New `models/notes.js`: voxel `note` (flat page 16x12x2 @ 0.015 m) + `notePinned` (upright, nailed, 12x3x16; back face = anchor plane), `ASSETS.notes` (texts from docs/story.md), `uiStyle.note` (paper panel 64 wide on the 160x60 UI layer, wrap 56), `attachNotes()`. `models/torch.js`: `levelPatch.towerTorch` now replaces the keeper's wall lantern (torch 18.9, 9.3, 1.15; flame 18.84 / 1.754; light 18.823 / 1.832; interactable 18.86 / 1.54) and `edit`s the burner lamp to decoration (drops its `interactable`); `torchProp.placement` follows. **Programmer (READ-01, before anything loads the tower):** script tag `../design/models/notes.js` after `detail-pass.js` / `models/title.js` in `game/index.html` (and `../../design/models/notes.js` in `tools/editor/index.html`), plus `import '<rel>/design/models/notes.js'` in every Node loader that loads the tower (World.load throws on the unregistered `note` / `notePinned` models). No palette, detail-pass or engine file changed.
- **v1.35 (2026-10-05, Sprint 6 designer pass B: spell hand, fireball, pack screen)**: new `models/spell.js` (section 14: `voxelModels.spellHandL`, `viewModels.spellHand`, `spellSprites`, `spellFx`), new `models/inventory_ui.js` (`uiStyle.inventory`), new `preview/fireball.html`. `palette.js` (appended): lights `fireballLight`, `fireballLightBig`, `fireballFlash`, `fireballFlashBig`, `spellEmber`; materials `ember_core`, `ember_glow`. `detail-pass.js`: the 2 v2 records + remap. **Programmer (HANDS-01c / SPELL-01b / US-091b):** script tags `../design/models/spell.js` (after `particles.js`) and `../design/models/inventory_ui.js` (after `title.js` + `items.js`) in `game/index.html` and the Node loaders that need them; `ASSETS.spellFx.attach()` before the `defineEmitter` loop; `spellConfig.js` castOffset = `{right 0.22, fwd 0.50, down 0.135}` (from `viewModels.spellHand.castOffset`). No engine file changed.
- **v1.34 (2026-10-05, Sprint 6 designer pass A: boar hurt/death + loot data)**: `models/voxel_beast.js`: `boarPlaceholder` grid 7x12x16 + `flash` part + 7 clips + mounts, new `ASSETS.boarFx`; new `design/items.js` (`ASSETS.items`, `ASSETS.lootSprites`); `palette.js` colours `alertLight` / `alert` / `alertDark` + `ui.alert` / `ui.alertPop` (appended). New section 13. **Programmer (US-079b / US-079c / US-091a):** script tag `../design/items.js` after `palette.js` in `game/index.html` (+ Node loaders that need items); in main.js call `ASSETS.boarFx.attach()` before the particle `defineEmitter` loop, spread `ASSETS.boarFx.overlay` after `questOverlayStyles(...)`, call `ASSETS.items.attachSprites()` at boot. The boar grid change needs no content edit (same model key, same placement). No engine file changed.
- **v1.33 (2026-10-04, owner tower/world feedback, EP-ALIVE)**: new `models/torch.js` (TORCH-01, architecture.md 37.8): voxel `torchProp` (torch in an iron wall sconce, clips `lit` / `empty` / spare `lying`, mounts flame / light / prompt / grip), `torchHeld`, sprite `torchFlame` (6 frames `burn` @ 12 fps, 5x7, half 3x4, 0.12 x 0.22 m, all emissive), `viewModels.torch` (RIGHT hand, clips idle / raise / lower, flame mount 0.775-0.787 m forward), `levelPatch.towerTorch` (the lamp -> torch content swap as data, NOT applied: TORCH-01b applies it with the loader lines + test updates). `models/lantern.js`: sprite-only `floorLantern` (lit / unlit). `palette.js`: colours `turfLight`, `turf`, `turfDark` (appended); `materials.grass` base/tints -> turf*, tick glyph `'` instead of `"`; light presets `torchSconce`, `lanternFloor` (appended after `candle`). `detail-pass.js`: sets `turfFace` / `turfMid` / `turfFar`; `materials.grass` tones -> turf*, grid 1.4 m, no tuft speckle. `levels/overworld_far.js`: `terrain.grass` colours -> turf*, glyphs close `.,'\``, near `.,'`, face `,:`; feature `tallGrass` chance 0.06 -> 0.02; overrides `11,8` paints `groveEast` / `groveSouth` / `groveNorthWest` (forest discs inside the r 96 bounds; real trees after ME-06c3). `models/voxel_tower.js`: gondola materials -> cloth (`GONDOLA_CLOTH`: canvas walls, canvas_light rim, gore_red bands, rope ribs, canvas_dark floor, canvas_burnt dents; brass_hot eyelets/letters kept; shape unchanged; `content/vox/gondola.map.json` is the old import map, re-export before re-importing a .vox). `content/levels/tower.level.json`: props `floorLampSword` (13.14, 6.86), `floorLampScrawl` (15.86, 9.72) + lights of the same ids (`lanternFloor`, z 0.32). **Programmer (TORCH-01b):** script tag `../design/models/torch.js` in `game/index.html`, the editor and every Node loader that loads the tower, then apply `levelPatch.towerTorch`. No engine file changed.
- **v1.32 (2026-10-04, ENV-01d ground detail models)**: new `models/ground_detail.js` (section 12): 19 meshOnly voxel scatter props (rocks S/M/L x 2, pebbles, 3 tufts, 3 flower colours, toadstools, fern, bush, stump, 2 logs), `ASSETS.groundDetail`. `levels/overworld_far.js`: first `recipe.detail` block (architecture.md 37.4; new block only, inserted after `recipe.rock`). `palette.js`: 14 colours + 5 materials appended (`petal_yellow`, `petal_white`, `petal_pink`, `mushroom_cap`, `wood_cut`; no id moves). `detail-pass.js`: the same 5 v2 records + remap. New `preview/ground-detail.html`. **Programmer (ENV-01a2 / 01b, PC-B):** script tag `../design/models/ground_detail.js` after `forest_trees.js` in `game/index.html` and `tools/editor/index.html`; the architecture.md 37.4 name `env_detail.js` / `preview/detail.html` became `ground_detail.js` / `preview/ground-detail.html`. **Engine note (PO / architect):** scatter props are yaw-only (no slope tilt), so flat-bottomed rocks use a larger `sinkM` and the rocks layer `maxSlope 0.35`; an optional per-species slope sink (`sinkM + k x slope x radius`) would let big rocks sit on steeper ground without a downhill gap.
- **v1.31 (2026-10-04, ENV-02 "The Awakening" tower dressing, D-038)**: `models/m3_props.js` new section 6b: composite voxel models `awakeningCrates` + `awakeningKeeper` (meshOnly, 0.04 m, world-oriented, registered by `attachM3()`; README 7.6). `palette.js`: spare light preset `candle` appended after `relay` (not placed). `content/levels/tower.level.json`: props `dressCrates`, `dressKeeper`, decal `scrawlKeeper`; legend `c` = walkable 1.8 m walkway (was solid 1.4 m cheek, BUG-CLOTH-002); cloth `stairwell.canvas` `colliders[2]`; `scrawlMason` z 0.25-0.45 -> 0.65-0.85 (same face). New `preview/awakening.html`. No new script tag (the models live in `m3_props.js`, already loaded everywhere the tower loads). No engine file changed.
- **v1.30 (2026-10-04, D-036 showcase camera paths, US-119a format)**: new folder `cinematics/` with `tower.json` (14 s), `fire.json` (12 s), `water.json` (10 s), `grassland.json` (13 s), `forest.json` (14 s, provisional: needs ME-06c3 realTrees, eye heights after key 0 estimated) + `cinematics/README.md` (format, shot table, intended hours, waterfall / ruins stubs). All fps 30, `linear` keys, no `timeOfDay` (US-122). Loaded by id, no registration: `game/index.html?renderer=mesh&cinematic=<id>`. New dev check `tools/cine-check.mjs` (clearance over floor/water, trunk hits, forest anchors; not a suite). No palette, model, level or engine file changed.
- **v1.29 (2026-10-04, ME-06c4 tri budget)**: `models/forest_trees.js`: oak + birch canopies rebuilt from 2x2x2 voxel blocks (`canopyBlock: 2`, `bark` char per species; >= 3/8 canopy per block, block-level speck/notch clean-up, enclosed pockets filled, branches above trunkHVox as 2x2x2 bark blocks, trunk bark below trunkHVox untouched) so LOD0 <= 4000 / LOD1 <= 1200 (37.2 item 8). Blocks sit on model-grid multiples of 2, so the even-grid LOD1 downsample merges whole blocks. Oak `leafSplitZ` 25 -> 24 (one material per block). Oak only (2nd pass): `blockFill: 0.5`, `branchMass` (above trunkHVox bark counts as crown mass, single-voxel branch specks and lone bark blocks dropped), `minBranch: 2`, `rootClean` (stray z0-1 root voxels outside trunkRVox + 1 with <= 1 neighbour dropped, 2 passes). `forestBirchSmall` cellM 0.24 -> 0.25 (stays >= 8 m if the blocking trims the top) => trunkR 0.65 / trunkH 4.50, copied into `overworld_far.js`. Oak `gore_red` voxels inside canopy blocks become leaf. `cleanStats` for blocked species: `{srcVoxels, canopyBlock, dropped, filled, cavities}` (counted in blocks). Pine unchanged.
- **v1.28 (2026-10-03, ME-06c4 forest trees)**: new `models/forest_trees.js` (section 11): 6 meshOnly tree models (oak / birch / pine x small / large, 8.4-13.3 m) derived from the sb trees, `ASSETS.forestTrees`. `levels/overworld_far.js`: `recipe.forest.trees` (seed, cellM 6.5, jitter 1.5, fill 0.72, maxTrees 1500, lodCells 6, 6 species with measured trunkR / trunkH). `palette.js`: colours `leafLight`, `leaf`, `leafDark`; materials `leaf`, `leaf_dark`, `leaf_light` appended after `cloth.linen` (no id moves). `detail-pass.js`: the same 3 v2 records + remap. New `preview/forest.html`. **Programmer (ME-06c3, PC-B):** script tag `../design/models/forest_trees.js` after `sb_objects.js` in `game/index.html` (and in any Node loader that imports the design scripts, e.g. `tools/testing/content-node.mjs` if it lists files).
- **v1.27 (2026-10-03, architecture.md 36.1a water looks + 36.2a burner fire)**: `water-looks.js`: new values for `water` / `pond` / `murky` (lighter shallows, darker deeps, own hue family each, lower `bgK`) + the 36.1 fields `cellM`, `glintP`, `drift`, `tintDepth`, `shoreW`, `rim` (engine-pending, section 10); every live value stays inside `packWaterLook` validation. `models/wreckage.js`: new billboard `burnerFire` (section 4; `burnerFlame` kept for old saves). `models/particles.js`: new preset `embers`; `flame` marked spare; `mounts.embers` + `mounts.smoke` moved (smoke starts at the sprite tip). New `preview/fire.html` (sprite + embers + smoke on the burner can, 240x90 / 480x180 true-size crops, old/new toggle, checks). No palette, detail-pass, level or engine file changed. **Programmer (36.2b, PC-B):** `tower.level.json` prop `{id: 'burnerFire', model: 'burnerFire', variant: 'burn', x: 18.5, y: 6.5, z: 1.05}` (no collide, like `lampFlame`); brazier `emitters`: `flame` -> `embers` with `offset.up 1.0`, smoke `offset.up 1.0 -> 1.5`; `game/js/quest/particleHooks.test.js` line 76 expects `flame` first -> `embers`.
- **v1.26 (2026-10-02, US-055a2c (b) water looks)**: new `water-looks.js` (section 10): `ASSETS.waterLooks` `water`, `pond`, `murky` (RGB, engine `packWaterLook` shape + later 35.3 / 35.4 fields). No palette, detail-pass, level or engine file changed. **Programmer:** script tag in `game/index.html`; `setWaterLooks` + `fb.waterLooks` in main.js.
- **v1.25 (2026-10-02, US-053c particle presets + CLOTH-1b4 cloth look)**: new `models/particles.js` (section 8) + `preview/particles.html`; new `cloth.js` (section 9) + `preview/cloth.html`. `palette.js`: colours `woadLight`, `woad`, `woadDark`; materials `cloth.canvas`, `cloth.banner`, `cloth.flag`, `cloth.linen` appended after `hit_flash` (no id moves). `detail-pass.js`: sets `clothFace`, `bannerFace`; the 4 v2 cloth records + remap. `style-guide.md` 7c / 7d. **Programmer:** script tags for `models/particles.js` and `cloth.js` in `game/index.html`; pass `ASSETS.clothPresets` to `World.load`.
- **v1.24 (2026-10-02, US-078d / D-034 light + hard sword)**: `models/sword.js` `viewModels.sword`: new clips `charge` (REST -> cocked hold pose at 400 ms, held) and `swingHard` (windows 67 / 183 / 633 ms, key 0 = charge end pose, leadEdge `+x`); `swingRL` dropped; `chain` = `{max 2, queueDuring, restMs, startAtMs, blendMs}` without `order`; new `trailHard` (same schema as `trail`), `sparks.hitHeavy` (5x3, 3 frames, 140 ms) and `sparks.chargeGlint` (1 cell at the tip, 100 ms); spark rows may contain `' '` = transparent. `swingLR` unchanged. `preview/sword.html`: sequence player, tap vs hold side by side, new checks. No palette, detail-pass, level or engine file changed.
- **v1.23 (2026-10-01, US-078d practice pell + US-080 pickups / vitals HUD)**: new `models/m3_props.js` (section 7.5): voxel `practiceTarget` (old sword pell, hit-flash shell parts, clips idle / flash / wobble), `levelPatch.towerPracticeTarget` (14.6, 6.6, facing 270; not applied), sprites `pickupHp` / `pickupMp` / `strawPuff` (`ASSETS.m3Sprites`), `ASSETS.pickupStyle`, `ASSETS.uiStyle.vitals` (bars, low pulse, chip, mana-short flash, `hurtEdge`, death card), proposed `ASSETS.m3Kit` (7 colours, 5 materials, glyph set `strawFace`; merge pending). New `preview/m3-props.html`. `style-guide.md`: "Vitals" colour row. `sword.js`: the practiceTarget note points here. No palette, detail-pass, level or engine file changed.
- **v1.22 (2026-10-01, US-078 sword)**: new `models/sword.js` (section 7.4): voxel pickup `sword` (planted in the tower rubble heap, step-clip glint), `swordHeld`, the NEW view-model format `ASSETS.viewModels.sword` (eye-space key poses, swing chain, trail, sparks), proposed `ASSETS.swordKit` (6 materials, 3 bronze colours; merge pending), `ASSETS.levelPatch.towerSword` (prop + interactable + scrawl + flag, not applied). New `preview/sword.html`. `style-guide.md`: "old-world metal" colour row. No palette, detail-pass, level or engine file changed.
- **v1.21 (2026-10-01, US-128 Z-targeting overlay styles)**: `models/title.js` new `ASSETS.uiStyle.overlay` = the `engine.overlay.setStyles` object (architecture.md 28.9 decision 7): keys `target`, `targetFade`, `targetNone`, `targetBarFill`, `targetBarEmpty` (29.2 `present()` ids). Shape `{glyph | glyphs (4 chars: horiz, vert, down-right, up-right), fg: [r,g,b], note}`; fg is literal RGB (the overlay takes no palette keys), `note` names the palette colour it is based on and is ignored by the engine. RTS styles stay in `game/js/rts/rtsMain.js` for now. No preview page (view in-game).
- **v1.20 (2026-09-30, RTS-01 readability pass, D-032)**: new `models/rts_unit.js` - placeholder soldier `ASSETS.rtsModels.rtsUnit` (new namespace: a plain voxel ModelDef the game registers itself via `game/js/rts/unitModel.js`, which side-effect-imports the file; NOT put in `ASSETS.models`). 10x8x16 @ 0.1 m, parts body + head, front = -y. Team materials in `palette.js` + `detail-pass.js` (v2 record + remap): slot `team.a` (neutral bone-grey) and targets `team.teal` (own), `team.red` (enemy), `team.gold`, `team.violet` (spares); colour keys `unit<Colour>{Light,,Dark}`. Convention: `team.<letter>` = remap slots a model paints, `team.<colour>` = per-team targets for `engine.setTeamMaterials`. Team materials carry emissive 0.10-0.15 (readability on shadowed slopes). View: `game/rts-test.html` (no separate preview page).
- **v1.19 (2026-09-26, OWN-REQ-008 part 1 voxel burner)**: `voxel_tower.js` section 9 `burner` (+ `TARGETS.burner`, voxel char `u` = `copper`); `wreckage.js` `burnerFlame` billboard; `content/levels/tower.level.json` new prop `burnerFlame` (the brazier prop and light unchanged); `preview/voxel-props.html` burner entry + checks. No new material, colour or format field.
- **v1.18 (2026-09-25, OWN-REQ-010 Blockbench animation importer, PC-B, tooling only - no design/ data changed)**: new section 7.3, documenting `tools/bb-import.mjs` + `tools/bb-import.test.mjs` (not files owned by this doc's format list - listed here only as the owner-facing workflow note). No palette/model/level data touched.
- **v1.17 (2026-09-25, US-027b content flip, PC-B)**: `tower`, `test_room` and `world_m1` moved from `design/levels/{tower,test_room,world_m1}.js` (deleted) to `content/levels/tower.level.json`, `content/levels/test_room.level.json` and `content/worlds/world_m1.world.json` - converted once, byte-for-byte, by `tools/export-content.mjs` (every id kept verbatim). Edit them as JSON from now on (see section 3 above); `overworld_far` is unaffected (a terrain recipe, still code). No content VALUES changed, only where they live.
- **v1.16 (2026-09-25, US-026a waystone + US-038b settings style)**:
  - New `models/voxel_world.js` (section 7.2): `waystone` voxel model, 4 materials, `ASSETS.models.waystone`, `ASSETS.worldPatch.world_m1` (new format: world-file additions as data, hand-copied by the content story).
  - `palette.js`: colours `wayStoneLight`, `wayStone`, `wayStoneDark`, `lichen`; materials `waystone_light`, `waystone`, `waystone_dark`, `waystone_mark` appended after `canvas_burnt`. `detail-pass.js`: the same 4 v2 records + remap, glyph set `rune`. No existing value or id changed.
  - `models/title.js`: `uiStyle.settings` (section 5).
  - Previews: `voxel-props.html` (waystone entry, `fog` / `extraViews` entry fields, terrain + end checks, loads `levels/overworld_far.js`); `title.html` (settings panel mock with keys, `[S] Settings` in the pause overlay, 400x150 / 480x180 grid buttons, 5 settings checks).
  - **Programmer:** `game/index.html` script tag for `voxel_world.js` after `voxel_tower.js` (PC-A, US-026a S6).
- **v1.15 (2026-09-25, OWN-REQ-006 lamp lit on the hook)**:
  - `models/voxel_props.js`: `lantern` `lit` is the default hanging state (no glint: the flame + hook light are the cue; `unlit` kept as a spare clip). New data block `voxelModels.lantern.hookLit` { clip, glint, flame { model, anim, mount, world }, light { id, preset, mount, on, world, levelEntry }, take }.
  - `models/lantern.js`: new billboard `ASSETS.models.lampFlame` (3x3, world 0.09 x 0.13 m, anchor bottom centre, 4 frames 9 fps, half LOD 1x2, heat keys 1-4 all emissive, `mountOn { model: 'lantern', mount: 'flame', clip: 'lit' }`). For the VOXEL lamp only. The billboard `lantern.lit` now draws the `=j=` bracket plate (hanging default; same size, so the sprite rects do not move).
  - `palette.js`: light preset `lights.lanternHook` (amber `lantern`, 0.55, r 3.5 m, flicker 6-9 Hz +-5%). Carried `lights.lantern` unchanged.
  - `preview/voxel-props.html`: loads `models/lantern.js`; the lit lamp view uses `lanternHook` + the `lampFlame` size; new checks (lit clip keeps the glint sealed, flame mount inside the cage, lampFlame fits the cage, hookLit world points = posed mounts, hook light weaker + smaller than carried).
  - **Programmer (PC-B), not done here:** `tower.js` prop variant `'lit'`, the `lanternHook` lights entry, spawn `lampFlame` at the mount, `lantern.take` switches the hook light off (see backlog row 25t). `game/js/quest/tower.test.js` line 188 expects `anim === 'unlit'` and must change with the variant.
- **v1.14 (2026-09-25, ART-OWN-002 rework + US-056 lamp glint)**:
  - `models/voxel_tower.js`: `canvasHeap` (linen tarp over a crate, grid 32x14x**7**), `gondola` (rectangular wicker basket, new part `chock`, `idle` = a shared-pivot 8 deg tilt pose) and `envelopeHeap` (striped half-deflated balloon, crown ring, mouth hoop, tear, 3 ropes) rebuilt. Same keys, anchors, placement and clip names. 6 new proposed materials (`linen_light`, `linen`, `linen_dark`, `gore_red`, `gore_red_dark`, `canvas_burnt`; batch 2 is now 18 keys).
  - `models/voxel_props.js`: `lantern` gains the part `glint` (listed first, stored in a sealed base cavity), `unlit` becomes a 4-key step clip (1800 + 90 + 90 + 80 ms), `empty` / `hookEmpty` hide the glint too, mount `glint`; `lantern.voxel.mats` is its own table (`LANTERN_MATS`, + `W`); new material `brass_glint`; `attach()` checks each model's own mats.
  - `palette.js`: colours `goreRedLight`, `goreRed`, `goreRedDark`, `linenLight`, `linen`, `linenDark`; material `brass_glint` appended after `iron_dark` (no id moves). `detail-pass.js`: material `brass_glint` + remap, glyph set `glint`.
  - `preview/voxel-props.html`: canvas heap ladder uses `linen_light` / `linen_dark`; lantern checks look parts up by name; new glint checks (sealed storage, 1800 + 260 ms step clip, sparkle in front of the rim, hidden when empty, emissive).
  - **Engine / PO notes:** (1) the glint uses only part transforms (no engine change); a per-keyframe material or emissive swap would be a cleaner tool later. (2) The gondola now renders through the rotated (non-axis-aligned) voxel path.
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
- **v1.9 (2026-09-23, D-011 "Kestrel" reskin)**:
  - `palette.js`:
    - new colors: the aether family (`aetherCore` .. `aetherDead`), `brassHot` / `brassShadow`, copper + verdigris, `mirror*`, canvas, rope, `emberHot` / `emberDim` / `cinder`, `steam*`, `ivy*`, `ferrum*` and the chart UI colours
    - new ramps `brass`, `copper`, `canvas` and `aether`
    - new light preset `lights.relay`
    - new materials `stone_ivy`, `moss_top`, `brass`, `copper` and `canvas`, appended after `sky`
    - `semantic.magic` is now `'aether'`, plus the new `machine`, `machineAlt`, `signal` and `ferrum`; `ui.title` holds the brass rows
    - no existing material, ramp, shading value, light or fog value changed, so the v1 shadetest baseline of the 11 M1 materials is unaffected (the new materials add rows)
  - `detail-pass.js`: v2 records for all five new materials, plus sets `ivy`, `mossTop`, `brassFace`, `copperFace`, `verdigris` and `canvasFace`, and the `remap` entries. `allV2` holds.
  - `models/title.js`:
    - the KESTREL logo with an SOS pulse (`durations`, `signal`) and the subtitle SOMEONE IS CALLING
    - new `models.mapCard` and `uiStyle.mapCard`
    - `uiStyle.storyHints`, new prompt examples, `endText.placeholder`
  - `models/lantern.js`: the brass lamp art (same key, size, animations and frame counts).
  - New `models/relay.js` and `models/wreckage.js` (section 4.2, including the proposed `levelPatch.tower`).
  - Previews:
    - `preview/title.html`: logo pulse, map card in the start sequence, a map card button, story hints, new checks
    - `preview/props.html`: the new models, a relay light preset, new checks
    - new `preview/wreckage.html`
    - all three have the 160 / 240 / 320 toggle
  - `style-guide.md`: D-011 colour language.
  - **Engine / PO notes:**
    1. The title and map card now animate with per-frame `durations`. It is the same rule as the sprite `durations`, but the title is a UI model, so the text-layer code has to honour it.
    2. Ivy that hangs from the wall *top* needs an inverted band (`tintBand` / `overlay.band` measured from the wall top). Until then `stone_ivy` is unbanded, which is acceptable.
    3. `relay.wakeLightFrame` plus `lights.relay.grow` need the light intensity ramp that US-022 already planned for the beacon.
    4. The level swaps in `levelPatch.tower` wait for the reskin stories.
    5. The US-017 end text needs new writer copy.
- **v1.10 (2026-09-24, US-015 PO CR + US-017 re-check; US-016 D-011 addendum)**:
  - `models/title.js`: map card `- W.` signature line (card 52x13 -> 52x14, `mapCard.signature`, `mapCard.text` 10 lines); `uiStyle.mapCard` = the programmer ACs as data (`showOnce`, `minShowSec`, `dismiss`, `reopen`, `sceneDim`); `uiStyle.hint.maxOnScreen 1` + `queue 'fifo'` (replaces `stackUp`); `hints[]` / `storyHints[]` gain `on` + `doneOn` (`when` = AC wording); `uiStyle.endText` restructured (`walkSec`, `gapSec`, `cps`, `cursor.periodSec/duty/color`, `lines[].id/row/typed/afterGap/altWhen`; `top` / `lineGap` / `delay` / `blinkHz` removed; `placeholder: false`); `uiStyle.fade.sec 2.0`; new `ASSETS.levelPatch.towerHints` (`hintBurner`, `hintClimb`). The KESTREL logo is unchanged.
  - `levels/world_m1.js`: state key `ui.mapCard.opened`; new top-level `horizon[]` with `ferrumLights` (section 4.3); `farTower` notes (signal tower).
  - `palette.js`: `colorRamps` (`aether`, `cityLight`) + validation, glyph ramp `cityLight`, colours `cityLightHot` / `cityLight` / `cityLightDim` / `ferrumSil`. No existing value changed.
  - `models/far_tower.js`: the signal tower: emissive light key `L` in the crown notch (min + detail), glint `G` (detail), `signalLight`, per-key `fogMax`. Frame sizes unchanged. `overworld_far.js`: `farTower.signalLight` note only.
  - New `models/ferrum_lights.js` (section 4.3).
  - Previews: `title.html` (signature, hint-zone plan, one-hint timeline with the 20 s chart hint, end card from `uiStyle.endText`, 7 new checks); `overworld.html` (signal light + Ferrum drawn, 4 new viewpoints, envelope heap, 9 new checks).
  - **Engine / PO notes:** (1) per-key `fogMax` on emissive sprite cells (GPU sprite pass + `drawSprites`); (2) `world.horizon[]` pass-through in `World.load` and a horizon-billboard draw on sky cells (section 4.3); (3) sprite LOD `lods.min` + `minCells` for `farTower` (already in the US-016 tech notes); (4) `endCard.js` should draw per-line colours and the `[R]` key colour from `uiStyle.endText`, which it does not do today.
- **v1.13 (2026-09-24, US-056 voxel props batch 2)**: new section 7.1 and the new file `models/voxel_tower.js`.
  - Models: `boulder`, `rubble0..2`, `canvasHeap`, `gondola`, `strut`, `envelopeHeap` and `relay` (dead / wake / awake via a crystal part swap).
  - 12 new proposed materials appended to `ASSETS.voxelMaterials` (`batch2`), and `attachTower()`.
  - `preview/voxel-props.html` generalised to all 11 models, with a show filter, per-model in-game views and new checks. The "distance" slider is now a multiplier.
  - No level, palette, detail-pass or billboard changes.
- **v1.12 (2026-09-24, D-019 voxel props)**: new section 7. The new file `models/voxel_props.js` adds `ASSETS.voxelModels.lever` (plate + handle, idle/pull/down) and `.lantern` (mount + arm + lamp, unlit/lit/empty/hookEmpty). It also adds the proposed materials `ASSETS.voxelMaterials` (`brass_light`, `brass_hot`, `brass_dark`, `iron_light`, `iron_dark`, v1 + v2 records, `modelRim` 0.55) and the guarded `attach()`. New preview `preview/voxel-props.html`, which uses the engine oracle. No level, palette or billboard changes.
- **v1.11 (2026-09-24, ART-OWN-001 + BUG-OWN-003 data; stopped by D-019: solid props become voxel models)**: new optional model fields `fill`, `outline`, per-key `fill: false`, and the **opaque space** cell (section 4; engine support pending, architecture.md 7.7). Billboard art redrawn at the real view scale: `lever` 11x12 (world 0.7 x 1.1), `burner` 13x11, `gondola` 34x9, `canvasHeap` 20x4, `rigging` 14x4, `strut` 12x4, `rope` 3x16, `boulder` 12x8, `rubble` 10x3 / 12x5 / 8x3 (all with new half LODs, same model names, animation names and frame counts; anchors = bottom centre / contact point; world sizes unchanged except the lever). `lantern` keeps 3x4 (test-pinned), new pale glass key. `relay`: `fill`/`outline` + glyph-only sparkle keys `P Q R`. `envelopeHeap` / `envelopeDrape`: `fill`. Previews: `props.html` "in-game size" section (160x60 + 240x90, engine projection, wall + floor, fill/outline toggles, scale check), `wreckage.html` (engine LOD pick, fill toggle).
- **v1.9.1 (2026-09-24, US-011 PO change request rework)**: `lever.js` brass gear housing + stepping hub gear (`lever.gear`, same keys of frames / sizes); `lantern.js` bracket `=j=` in unlit/empty, new `empty` animation (alias `hookEmpty` kept); `relay.js` `mounts.glow` (full + half), `awake` 6 fps; `wreckage.js` new `canvasHeap`, `rope` (2 variants), `strut`, reworked `levelPatch.tower` (+ `pathCheck`). Previews: `props.html` (new entries + checks), `wreckage.html` (heap, ropes, strut in the crash room), `tower.html` (patch props, corridor, path check). New section 4 rule: string variant = animation name. No schema change.
