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
- `wreckage.js` (v1.9): `gondola`, `envelopeDrape`, `envelopeHeap`, `burner`, `rigging`, `canvasHeap`, `rope` (variants), `strut`, plus `ASSETS.levelPatch.tower` (section 4.2)
- `far_tower.js` (v1.8, signal light v1.10): `farTower` (section 4.1); `ferrum_lights.js` (v1.10): `ferrumLights` (section 4.3)

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

---

## Change log
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
