# ASCII Quest – Product Backlog

Owner: Product Owner. Last updated: 2026-09-22.
Statuses: `todo | design | dev | po-review | testing | done`. Numbers and layout details: see `docs/game-design.md` section 5 and 7.

## Build order – Milestone 1 "The Awakening"

| Order | ID | Title | Priority | Status | Who picks up |
|---|---|---|---|---|---|
| 1 | US-001 | Char-grid canvas + game loop | P0 | dev (PO REJECT #1) | **Programmer NOW** |
| 2 | US-002 | Master palette, glyph ramps, stone/wood/iron/sky materials | P0 | done | PO approved 2026-09-22; designer moves on to US-010 then US-011 |
| 3 | US-003 | Sector map format + test room loader | P0 | todo | Programmer |
| 4 | US-004 | Sector raycaster: walls, floors, ceilings, sky, y-shear | P0 | todo | Programmer (needs US-002 for final look) |
| 5 | US-005 | First-person camera controls (keyboard + mouse) | P0 | todo | Programmer |
| 6 | US-006 | Lighting: ambient + point lights with flicker | P0 | todo | Programmer |
| 7 | US-007 | Lighting: sun directional light with shaft shadow | P0 | todo | Programmer |
| 8 | US-008 | Physics: player capsule, gravity, walk/run, collision | P0 | todo | Programmer |
| 9 | US-009 | Physics: jump, step-up, landing feel | P0 | todo | Programmer |
| 10 | US-010 | Tower layout: 3 levels as sector data | P0 | design | **Designer NOW** (layout plan), then Programmer |
| 11 | US-011 | Billboard props + prop art (brazier, lantern, lever, grate, boulder, rubble, pallet, beacon bowl) | P0 | design | **Designer NOW** (art), then Programmer |
| 12 | US-012 | Interaction system + lantern pickup (carried light) | P0 | todo | Programmer |
| 13 | US-013 | Rolling boulder | P0 | todo | Programmer |
| 14 | US-014 | Lever opens the grate | P0 | todo | Programmer |
| 15 | US-015 | Wake sequence + title card + control hints | P0 | design | Designer (title logo) then Programmer |
| 16 | US-016 | Far overworld view through the breach | P0 | design | Designer (overworld heightmap/colors) then Programmer |
| 17 | US-017 | End trigger, fade and restart | P0 | todo | Programmer |
| 18 | US-018 | Performance budget + debug overlay check | P0 | todo | Programmer (can be done alongside US-004) |
| 19 | US-022 | Light the summit beacon with the lantern (optional beat, D-003) | P1 | todo | Programmer, after all P0 done; Designer reuses brazier flame frames |
| 20 | US-019 | Dust motes in the sun shaft | P2 | todo | Designer + Programmer |
| 21 | US-020 | Sound: procedural WebAudio (D-004) | P2 | todo | Programmer, after all P0 done and US-022 done/deferred |
| 22 | US-021 | Readable wall scrawl | P2 | design | Designer |

M1 exit criteria = all P0 stories `done` (roadmap). US-022 (P1) and P2 stories are not exit criteria.

---

### US-001 Char-grid canvas + game loop  [Priority: P0] [Status: dev]
As a player, I want the game to open in my browser as a crisp grid of colored characters running smoothly, so that everything else has a stable screen to draw on.
Acceptance criteria:
- [x] `game/index.html` opens from a static server (no build step, no external libraries) and shows a full-window canvas on a black background. (ES modules do not load from file://; accepted, see rework item 5.)
- [x] A `RenderTarget` exists with `setCell(x, y, glyph, fg, bg)`, `clear(bg)` and `present()`; logical grid defaults to 160x60 cells.
- [ ] Grid scales to fit the window on resize, keeping cell aspect (monospace font, integer-ish font size); no stretched, blurry or clipped glyphs at 1x and 2x devicePixelRatio. (Clipping: see rework item 4.)
- [x] Main loop: fixed 60 Hz `update(dt)` with accumulator (max 5 steps per frame to avoid spiral of death) and a separate `render(alpha)` via `requestAnimationFrame`.
- [x] Demo screen: an animated color gradient + all glyphs of ` .:-=+*#%@` drawn in a strip, proving per-cell fg and bg color.
- [ ] F3 toggles an overlay showing fps and frame time (ms) in the top-left corner. (Browser default F3 = Find is not suppressed, see rework item 2.)
- [ ] Full 160x60 grid redraw each frame keeps 60 fps in Chrome on a normal laptop (overlay shows >= 58 fps, frame <= 8 ms for the grid draw). (Only measurement so far is about 15 ms, see rework item 1.)
- [x] Code is split per CLAUDE.md layout: `game/js/engine/` (loop, input stub), `game/js/render/` (RenderTarget).
- [ ] (added on review) Palette access matches the US-002 `design/palette.js` v1 shape (see rework item 3).
Design needed: no.
Notes / dependencies: none. First story to build.

**PO REJECT #1 (2026-09-22) – rework list:**
1. **Performance (blocking).** The only measurement is about 15 ms per frame, nearly twice the 8 ms budget. The tester's job is to confirm a pass, not to discover whether there is one, and every later story is built on this frame budget.
   - Add a reproducible benchmark: `?bench=1` renders 600 worst-case frames (every cell a non-space glyph with unique fg/bg) and logs the average and p95 time for `present()` plus the full frame.
   - Measure in foreground desktop Chrome at 1920x1080 @1x DPR and at a 2x DPR window (e.g. 1440x900 CSS @2x, which is about 4.6 M backing pixels). Write the numbers into these notes.
   - Note: `present()` currently blends every device pixel in JS, so cost grows with window size and DPR, not with the 160x60 grid.
   - If the budget is missed, options include: cap the backing cell size (e.g. pxCellH <= 24, with CSS upscaling); cache tinted glyph tiles keyed by glyph + quantized fg and draw them with `drawImage`; batch bg runs with `fillRect`.
   - Do not change the `RenderTarget` public API. If Canvas2D cannot reach 8 ms at 2x DPR, stop and report; the PO will escalate to the manager (WebGL2 back-end behind the same interface vs. capped resolution).
2. **F3 must not trigger the browser's Find.** Call `preventDefault()` on keydown for game-owned keys: F3 now, and prepare the same list for WASD/Space/arrows/E/Shift/F6/F7 so the page never scrolls or finds. Everything else passes through (F5, F12, Ctrl+...).
3. **Palette interface mismatch with `design/palette.js` v1 (now delivered).**
   - The real `window.ASSETS.palette` is nested: `{ version, colors, ramps, materials, lights, fog, ... }`, with the default ramp at `ramps.default`. The placeholder is flat, and `getDefaultRamp()` reads `window.ASSETS.defaultRamp`, which does not exist.
   - Make the placeholder the same shape (`{ colors: {...}, ramps: { default } }`), make `getDefaultRamp()` read `palette.ramps.default`, and load `../design/palette.js` as a classic `<script>` before `main.js`.
   - The demo strip then shows the designer's 14-step default ramp.
4. **Glyphs must fit the cell with no clipping.**
   - `CELL_ASPECT = 0.56` is hard-coded, but Courier New advances about 0.60 em. `fontSize = pxCellH` with `textBaseline 'top'` can clip descenders.
   - Derive the cell size and font size from measured metrics (`measureText`, `actualBoundingBoxAscent/Descent`) so that every printable ASCII glyph (32-126) fits inside its cell.
   - Check at least `@ W M & % _ , ; j g | $` at 1x and 2x.
   - Add a `?glyphs=1` test screen showing all 95 printable glyphs on alternating bg colors, so clipping is visible.
5. **Minor.** If opened via file://, show a one-line message ("Run a static server: python -m http.server 8000, then open /game/index.html") using a small inline classic script. Also remove the stale "dirty-cell diffing" comment in `debugOverlay.js`.

### US-002 Master palette, glyph ramps, materials  [Priority: P0] [Status: done]
As a player, I want the tower to look like warm, detailed carved stone lit by fire and sun, so that the ASCII world feels beautiful and readable.
Acceptance criteria (designer deliverables):
- [x] `design/palette.js` exports on `window.ASSETS.palette`: named colors (hex), including at minimum: ambient `#2a3550`, sun `#fff2d0`, torch `#ff9a3c`, lantern `#ffd27a`, fog, sky gradient top/horizon, stone light/mid/dark, moss, wood, iron, brass, ash, straw.
- [x] A default brightness ramp (10+ steps, darkest = space) plus per-material ramps: `stone` (e.g. `. : ; % # &`-style), `wood`, `iron`, `ash/floor`, `rubble`, `sky`. Each ramp maps brightness 0..1 to glyph.
- [x] Each material defines: base fg color, bg color rule (bg = darkened fg or black), glyph ramp, optional texture pattern (a small tileable glyph pattern, e.g. 8x4 for stone blocks with mortar lines) so walls do not look flat.
- [x] Distance fog rule documented: color target and the distance (meters) at which glyphs fade to fog (suggest start 12 m, full 60 m inside; far view uses its own).
- [x] `design/preview/materials.html` shows every material as a lit wall swatch with sliders for light intensity (0..1.5) and light color (ambient/sun/torch/lantern presets), plus the full ramps.
- [x] `design/style-guide.md` first version: color language (warm = safe/light, cool = shadow/Dim), readability rules, and the format of `palette.js` documented in `design/README.md`.
Design needed: yes – palette, ramps, 6 materials, preview page.
Notes / dependencies: US-004/006/007 consume this. Programmer may use placeholder colors until done.
Designer note (2026-09-22): **Preview ready for PO review.** Open `design/preview/palette.html` directly from disk (`design/preview/materials.html` redirects there). Deliverables: `design/palette.js` (v1, plain script, sets `window.ASSETS.palette`, loads from `file://`), `design/README.md` (export shape, shading pipeline, texture UV conventions, fog rules, engine notes), `design/style-guide.md`. There are 9 materials: stone, stone_moss, stone_scorched, floor, ash, wood, iron, rubble, sky. That covers the 6 required plus the moss and scorched variants US-010 needs. Open points for the PO: (1) the US-015 hint `WASD move · Mouse look` uses non-ASCII `·`; the proposed text is `WASD move - Mouse look`; (2) engine features needed: emissive cells (sky, later fire), a hit height above the sector floor for moss/soot bands, and texture fade by distance (see README section 2). Status stays `design` until PO preview review.

**PO APPROVED (2026-09-22) – US-002 done (art/data-only story, no separate tester pass).** Its data is exercised and tested through US-004/006/007/011/016.
- All 6 criteria are met: the required colors are exact, the 14-step default ramp contains the D-002 ramp in order, and there are 9 materials with bg rules, ramps and textures.
- Fog is 12/60 m interior and 50/1500 m far. The preview has an intensity slider (0..1.5), ambient/sun/torch/lantern presets, the ramps, and `validate()` = OK.
- Spot checks: ambient-only mortar/grout is above the 0.03 cutoff, so there is never pure black within 8 m (GDD 7.3). Sun vs shadow is +5/+6 ramp steps (US-007 needs >= 4). `lights.beacon` is present for US-022.
- Open points resolved: (1) the US-015 hint text changed to ASCII `WASD move - Mouse look`; (2) emissive cells, hit height above the sector floor (tintBand) and texture fade are folded into US-004 / US-011 as acceptance criteria.
- Small README fix for the designer (non-blocking): README section 1.1 says "US-001 has to open straight from disk". Per the US-001 review the game is served over http (ES modules); keep `palette.js` as a plain script (correct for both) and just correct that sentence.

### US-003 Sector map format + test room loader  [Priority: P0] [Status: todo]
As a player, I want the world to have real floors at different heights, so that stairs, ledges and a roofless tower are possible.
Acceptance criteria:
- [ ] A level is a JS data file (`game/js/world/levels/<name>.js`) with a 2D grid of cells; each cell references a sector with: `floorH`, `ceilH` (number or `"sky"`), `wallMat`, `floorMat`, `ceilMat`, `solid` flag.
- [ ] Legend-based authoring: level rows are strings, one char per cell, plus a legend object mapping chars to sector definitions (so the designer can author layouts as text).
- [ ] Loader validates: rectangular grid, every char in legend, player start defined; errors are printed to the console with row/column.
- [ ] Query API: `sectorAt(x, y)`, `floorAt(x, y)`, `ceilAt(x, y)` in world meters (1 cell = 1 m).
- [ ] A test level `test_room` (16x16) with: flat floor at 0, a 3-step staircase (0.3 m steps), a raised platform at 1.0 m, a pillar, and a sky-ceiling region.
Design needed: no.
Notes / dependencies: US-001.

### US-004 Sector raycaster: walls, floors, ceilings, sky, y-shear  [Priority: P0] [Status: todo]
As a player, I want to see the room in first-person 3D made of characters, so that I feel present in the space.
Acceptance criteria:
- [ ] One ray per screen column (160); walls drawn with correct perspective, including partial walls (step fronts, ledge fronts, pillars) where floor/ceiling heights change between sectors.
- [ ] Floors and ceilings are cast per cell row with their materials; `"sky"` ceilings show a vertical gradient (palette sky colors) instead of geometry.
- [ ] Looking through a lower wall onto a higher floor behind it works (e.g. the top of the staircase and the 1.0 m platform are visible from the ground).
- [ ] Shading follows the US-002 pipeline (`design/README.md` 1.6-1.8). In this story L = ambient only; US-006/007 add lights.
  - Brightness picks the glyph from the material ramp; the bg rule and interior fog (12/60 m) are applied.
  - The engine may re-implement `util.shade` with lookup tables or inlined math, but for a set of 5 reference cells (stone, stone_moss near the floor, floor, iron, sky) its glyph must equal `P.util.shade` / `shadeSky` output, with fg/bg within ±4 per channel. Provide a `?shadetest=1` console check that prints the comparison.
- [ ] Texture sampling per README 1.6. Walls: u = along-wall meters (continuous across cells), v = world height, v grows upward. Floors and ceilings: world x, y.
- [ ] Texture fade by camera distance (`material.textureFade`), so textures do not shimmer in the distance.
- [ ] The wall hit height above that sector's floor is passed as `z` for `tintBand`: moss/soot stays near each floor (visible on a `stone_moss` test wall in `test_room`: full tint below 1.0 m, none above 2.2 m).
- [ ] Emissive cells: `"sky"` ceilings and out-of-map views use `shadeSky` (azimuth/elevation) and ignore lighting and fog. The engine supports a per-cell emissive flag that later passes (US-011 flames, US-022 beacon) can set.
- [ ] Pitch via y-shear, clamped to ±35 degrees; horizon line moves with pitch; no geometry tearing at the clamp.
- [ ] Field of view 75 degrees horizontal, correct for the 160x60 grid and cell aspect (a square pillar looks square).
- [ ] No fisheye distortion (perpendicular distance correction).
- [ ] 60 fps on `test_room` with the F3 overlay (render <= 8 ms).
Design needed: no (consumes US-002).
Notes / dependencies: US-001, US-003.

### US-005 First-person camera controls  [Priority: P0] [Status: todo]
As a player, I want to look around with the mouse and move with WASD, so that exploring feels natural.
Acceptance criteria:
- [ ] Click on the canvas requests pointer lock; Esc releases it and shows a small "Click to resume" overlay.
- [ ] Mouse yaw/pitch at 0.15 deg per pixel; pitch clamped ±35 degrees.
- [ ] Arrow keys: yaw 120 deg/s, pitch 60 deg/s (fallback when pointer lock is unavailable).
- [ ] WASD moves relative to yaw; diagonal movement is normalized (not faster).
- [ ] Input module exposes `isDown(key)`, `pressed(key)` (edge-triggered once per sim step) and mouse delta; keys are released when the window loses focus.
- [ ] In this story movement may be a simple noclip on the floor (physics comes in US-008).
Design needed: no.
Notes / dependencies: US-004.

### US-006 Lighting: ambient + point lights with flicker  [Priority: P0] [Status: todo]
As a player, I want a torch to throw flickering warm light across the stone, so that the room feels alive.
Acceptance criteria:
- [ ] Light model per visible surface cell: `ambient + sum(point lights)`, color-multiplied with material color, then mapped to glyph ramp brightness.
- [ ] Point light: position (x, y, z), color, intensity, radius; falloff smooth to exactly 0 at radius (no hard ring edge).
- [ ] Surfaces facing away from a point light get less light (simple N dot L on walls, floors and ceilings).
- [ ] Point lights are blocked by walls (a light behind a solid wall does not light the other side) – at least a 2D grid line-of-sight test from light to hit point.
- [ ] Flicker: intensity noise 8 to 12 Hz, ±15%, position jitter ±0.05 m; the flicker must be smooth (value noise), not per-frame random.
- [ ] `test_room` has one torch light; walking around it shows warm orange falloff up to 6 m, ambient cool blue elsewhere (values from GDD 7.3).
- [ ] Supports at least 4 point lights at 60 fps.
- [ ] Uses the US-002 light rules: light color is a hue (`P.hue[key]`) and intensity carries the energy (`addLight`); falloff is `P.util.falloff` `(1-(d/r)^2)^2`. Light values are read from `P.lights` (torch/lantern), not hard-coded.
Design needed: no (uses US-002 colors).
Notes / dependencies: US-004.

### US-007 Lighting: sun directional light with shaft shadow  [Priority: P0] [Status: todo]
As a player, I want a bright sun shaft to fall through the broken roof onto the floor, so that I am drawn to look up and see the sky.
Acceptance criteria:
- [ ] Directional sun: direction configurable per level (M1: elevation 60 degrees, from ESE), color `#fff2d0`, intensity 1.0.
- [ ] Shadow test per lit cell: a surface point is sunlit only if a ray toward the sun exits through a `"sky"` ceiling or an open wall gap without hitting solid geometry (walls, ceilings, higher floors).
- [ ] In `test_room`, the sky-ceiling region casts a visible bright patch on the floor that is offset from the opening according to sun direction, and walls cast visible shadows inside it.
- [ ] Sunlit and shadowed floor differ by at least 4 steps on the glyph ramp.
- [ ] Sun direction can be changed with debug keys (F6/F7 rotate azimuth) to verify shadows move correctly.
- [ ] Still 60 fps with sun + 4 point lights.
Design needed: no.
Notes / dependencies: US-006.

### US-008 Physics: player capsule, gravity, walk/run, collision  [Priority: P0] [Status: todo]
As a player, I want to walk and run with weight and bump into walls without getting stuck, so that movement feels solid.
Acceptance criteria:
- [ ] Fixed 60 Hz physics. Player is a vertical capsule, radius 0.30 m, height 1.70 m, eye 1.60 m.
- [ ] Walk 3.5 m/s, run (Shift) 6.0 m/s, full speed in 0.10 s, stop in 0.08 s (GDD section 5).
- [ ] Collision vs solid cells and vs sector walls higher than the step threshold; sliding along walls when moving diagonally into them; never tunnelling through a 1-cell wall at run speed; never stuck on corners.
- [ ] Gravity 20 m/s^2; walking off a ledge makes the player fall and land on the lower floor.
- [ ] Head collision: cannot enter a sector whose `ceilH - floorH` is less than 1.70 m.
- [ ] All values in one tuning config object (`game/js/physics/config.js`).
Design needed: no.
Notes / dependencies: US-005.

### US-009 Physics: jump, step-up, landing feel  [Priority: P0] [Status: todo]
As a player, I want to climb stairs smoothly and jump gaps reliably, so that the climb is fun and not frustrating.
Acceptance criteria:
- [ ] Step-up: floors up to 0.45 m higher are climbed automatically; camera height smoothed over 0.1 s (no snapping) when stepping up or down.
- [ ] Jump on Space: initial velocity 6.5 m/s (apex about 1.05 m); only when grounded, with 100 ms coyote time and 100 ms jump buffer.
- [ ] Air control 35% of ground acceleration.
- [ ] Walking jump clears a 1.5 m horizontal gap onto a floor 0.3 m higher (test case in `test_room`); running jump clears 2.5 m.
- [ ] Landing dip: 0.08 m for falls > 0.5 m, 0.15 m for falls > 2 m, recovering in 0.2 s. Subtle head bob 0.03 m while walking.
- [ ] No double jump; holding Space does not auto-repeat jumps.
Design needed: no.
Notes / dependencies: US-008.

### US-010 Tower layout: 3 levels as sector data  [Priority: P0] [Status: design]
As a player, I want to wake inside a ruined round tower with a stair winding up to a breach, so that I have a clear, intriguing space to explore.
Acceptance criteria – Designer:
- [ ] `design/levels/tower_layout.md`: top-down text map(s) of the tower using the US-003 legend format (outer footprint about 12x12 plus the outside outcrop and a few cells of hill beyond the breach), with a legend giving floorH/ceilH/materials per char.
- [ ] Contains every element of GDD 7.1 at the stated heights: wake pallet (S), brazier ~3 m from it, lantern hook, sun-crack in the east wall, rubble (0.3-0.9 m), hollow at -0.3 m (NW), slope from stair base to hollow, boulder start on stair base, stair of 0.30 m steps clockwise, 1.5 m gap at ~2.7 m, mid ledge 2x2 at 3.0 m with lever and grate positions, upper stair to 6.0 m, summit walkway with parapet, beacon bowl, 2 m breach (W), outcrop + end trigger cells.
- [ ] Irregular broken wall-top heights (6.5 to 8.5 m) so the silhouette against the sky reads as ruined.
- [ ] Marks player start position and facing (lying, facing the sun shaft), and positions of all lights and props.
- [ ] Wall materials assigned (stone variants, moss near the ground on the north side, scorched stone near the brazier).
Acceptance criteria – Programmer (after PO approves the layout):
- [ ] `game/js/world/levels/tower.js` built from the layout; loads with no validation errors and becomes the default level (test_room still reachable with `?level=test_room`).
- [ ] Every stair step is climbable, the gap is jumpable walking, falling from any stair lands safely on ground level, the summit is only reachable through the grate path.
- [ ] The slice is completable without ever taking the lantern (wake to breach end; the lantern is a soft gate only, D-004 notes).
Design needed: yes – level layout map + legend.
Notes / dependencies: US-003 format. The designer may start now using the US-003 legend format described above.

### US-011 Billboard props + prop art  [Priority: P0] [Status: design]
As a player, I want the brazier, lantern, lever, boulder and other objects to look detailed and solid, so that I can recognise what matters.
Acceptance criteria – Designer (`design/models/*.js` + `design/preview/props.html`):
- [ ] Brazier with fire: 7x9 cells, fire animation 6 frames at 10 fps (`^ * ' .` flame, yellow core to orange to red tips), emissive flag on flame cells.
- [ ] Lantern: unlit (on hook) and lit variants, 3x4 cells; a 2-frame "glint" for the unlit one (brass highlight).
- [ ] Lever: up and down poses + 3 in-between frames (5 frames total), 3x5 cells.
- [ ] Grate (portcullis) as a wall material/pattern (iron bars `|#|`), tileable so its height can animate.
- [ ] Boulder: 5x4 cells, 8 rotation frames (texture shifts so rolling reads), mossy stone.
- [ ] Rubble blocks (3 variants), straw pallet, beacon bowl with ash (large, 12x4 cells).
- [ ] Every prop: anchor at feet, palette keys only (from US-002), readable at 1/2 scale (for distance).
- [ ] Preview page shows each prop at near/mid/far scale on a dark background, with light-direction/intensity slider.
Acceptance criteria – Programmer:
- [ ] Billboard renderer: sprites positioned in world, scaled by distance, depth-sorted and occluded correctly by walls (per-column depth buffer).
- [ ] Sprites are lit by the same light model, except emissive cells (flames), which are drawn at full color and ignore both lighting and fog (uses the US-004 emissive flag).
- [ ] Brazier flame animates; the brazier is also the torch point light source position.
Design needed: yes – all props listed above.
Notes / dependencies: US-002 (palette keys), US-004, US-006.

### US-012 Interaction system + lantern pickup  [Priority: P0] [Status: todo]
As a player, I want to press E to take the lantern and carry its light with me, so that I can see in the dark stairwell.
Acceptance criteria:
- [ ] Interactables have: position, radius, prompt text, `onInteract`. Targeted when within 1.8 m and within about 20 degrees of view centre; nearest-to-centre wins.
- [ ] Crosshair `+` is dim by default and brightens when a target is active; prompt `[E] Take lantern` appears under it.
- [ ] Pressing E on the lantern removes the hook sprite (hook remains, empty) and attaches a point light: `#ffd27a`, 0.8 intensity, 5 m radius, held 0.3 m right / 0.3 m down / 0.4 m forward of the eye, sway with walk, ±5% flicker.
- [ ] The lantern light makes the upper stairwell (ambient-only areas) visibly readable: gap edges at least 3 glyph-ramp steps brighter than without it.
- [ ] Once taken, the lantern stays with the player for the rest of the run: there is no drop action and nothing consumes it (lighting the beacon in US-022 shares its flame, the player keeps it). One pickup only.
- [ ] The slice is completable without ever taking the lantern: the gap edges stay visible with ambient light only (dim, but readable), and no later interaction requires it except the optional US-022 beacon.
Design needed: no (uses US-011 lantern sprite).
Notes / dependencies: US-006, US-010, US-011.

### US-013 Rolling boulder  [Priority: P0] [Status: todo]
As a player, I want to push the heavy boulder off the stairs and watch it roll away, so that the world feels physical.
Acceptance criteria:
- [ ] Boulder = sphere, radius 0.6 m, uses the sector physics (gravity, floor heights, wall collision).
- [ ] Walking into it at >= 0.5 m/s pushes it (player slows to 50% while pushing); it follows floor slope, has rolling friction and settles; restitution 0.3 against walls.
- [ ] Cannot climb any step (step threshold 0 for the boulder); cannot be pushed up the stair.
- [ ] From the start position, a push sends it down the slope into the NW hollow, where it comes to rest within 4 s and stays; the stair base is then clear.
- [ ] Rotation frames (US-011) advance with distance rolled and direction.
- [ ] Player and boulder never overlap; the boulder cannot trap the player (if the player is squeezed, the player is pushed out).
- [ ] The NW hollow is the boulder's only stable resting place: from any push direction and speed, it ends in the hollow and can never come to rest re-blocking the stair (base or any step) or the wake area. Once in the hollow (floor -0.3 m, boulder step threshold 0) it cannot be pushed back out. Test: 20 pushes from varied angles/speeds, all end in the hollow.
- [ ] Restart (US-017) puts the boulder back at its start position on the stair base.
Design needed: no (uses US-011 boulder).
Notes / dependencies: US-009, US-010, US-011.

### US-014 Lever opens the grate  [Priority: P0] [Status: todo]
As a player, I want to pull the lever and see the grate rise, so that I understand cause and effect and can reach the summit.
Acceptance criteria:
- [ ] Prompt `[E] Pull lever` on the mid ledge; pulling plays the 5-frame lever animation over 0.4 s.
- [ ] The grate sector's ceiling rises from floor height to open height (>= 2.2 m above the floor) over 1.5 s with ease-in-out; collision updates live (blocked while below 1.70 m clearance).
- [ ] Before pulling: the upper stair is impassable. After: passable.
- [ ] One-way: after use, the lever shows no prompt.
- [ ] Grate is visible from the lever position, so the player sees it move.
Design needed: no (uses US-011 lever + grate).
Notes / dependencies: US-010, US-011, US-012.

### US-015 Wake sequence + title card + control hints  [Priority: P0] [Status: design]
As a player, I want to open my eyes on the tower floor, see the title, and get just enough hints, so that I understand the start without reading a manual.
Acceptance criteria – Designer:
- [ ] `design/models/title.js`: `ASCII QUEST` logo, max 70x9 cells, colored (warm gold into ember orange), plus subtitle style for `The Awakening`. Preview in `design/preview/title.html`.
Acceptance criteria – Programmer:
- [ ] Start: screen black 1.0 s, then eye-blink reveal (rows open from the centre line outward over 1.5 s, with one half-close blink).
- [ ] Camera starts lying (eye height 0.3 m, pitched up toward the sun shaft), rises to 1.60 m over 1.2 s; player input is ignored until the rise ends.
- [ ] Title card fades in 1 s, holds 3 s, fades out 1 s, drawn over the 3D view.
- [ ] Hints bottom-left, fade in 0.3 s, each shown once, disappears when performed or after 8 s: `WASD move - Mouse look` (after title; all UI text is ASCII 32-126 only), `Shift run` (after 10 s of walking), `[Space] Jump` (when within 2 m of the gap edge), `Click to capture mouse` (if pointer not locked).
- [ ] Interact prompts from US-012 are not hints; they always show when targeting.
Design needed: yes – title logo.
Notes / dependencies: US-010, US-012.

### US-016 Far overworld view through the breach  [Priority: P0] [Status: design]
As a player, I want to see a vast, colorful landscape and a distant dark tower from the summit, so that I feel the world is huge and I want to go out there.
Acceptance criteria – Designer:
- [ ] `design/levels/overworld_far.md` (+ data file if useful): a low-res heightmap (e.g. 128x128 or 256x256 cells, 8 m per cell) or a procedural recipe (seed + noise params) for rolling hills, a river, forests; color/glyph rules per terrain type (grass `" ' , ;` greens, forest `& % @` dark greens, river `~ -` blues, rock `# %` greys) and fog colors by distance (near 50 m to far 1500 m).
- [ ] Position and silhouette of the distant second tower (~800 m, on a hill, dark, no light).
- [ ] Mock-up in `design/preview/overworld.html` showing the intended view through the breach.
Acceptance criteria – Programmer:
- [ ] Separate heightmap-projection pass drawn where the sector raycaster sees `"sky"`/out-of-map through the breach and above the parapet.
- [ ] Terrain lit by the same sun direction; atmospheric fog toward a pale blue horizon; the second tower silhouette is visible and clearly unlit.
- [ ] Far pass costs <= 4 ms per frame; overall still 60 fps when looking out of the breach.
- [ ] Horizon of the far view lines up with the sector view horizon at all pitches (no seam or jump).
Design needed: yes – far terrain data/recipe, colors, tower silhouette.
Notes / dependencies: US-004, US-007, US-010.

### US-017 End trigger, fade and restart  [Priority: P0] [Status: todo]
As a player, I want a satisfying ending when I step out onto the hill, so that the slice feels complete.
Acceptance criteria:
- [ ] Entering the outcrop trigger cells locks input; the camera walks forward 1 m over 1.5 s and pitches slightly down toward the valley.
- [ ] Screen fades to black over 2 s (glyphs dim down the ramp, not just an overlay alpha).
- [ ] Text, centred, typed on at 30 chars/s. First line depends on the beacon state (D-003): unlit (default, and always if US-022 is not built) = `The beacons are dark.`; lit = `One beacon burns. The others are dark.`. Then `The world waits.`, then after 1.5 s `- to be continued -`, then `[R] Wake again`.
- [ ] R restarts the slice from the wake sequence with all state reset (lantern on hook, boulder on stair, lever up, grate down, beacon unlit, hints reset).
Design needed: no.
Notes / dependencies: US-010, US-015, US-016.

### US-018 Performance budget + debug overlay  [Priority: P0] [Status: todo]
As a player, I want the game to stay perfectly smooth, so that movement always feels responsive.
Acceptance criteria:
- [ ] F3 overlay shows: fps, total frame ms, and per-pass ms (walls/floors, lighting, sprites, far view, UI), player position, sector id, grounded flag.
- [ ] Measured in the tower at the 3 worst views (ground floor looking at brazier + sun shaft, mid ledge looking down, summit looking out the breach): >= 58 fps average in Chrome on a normal laptop at 160x60.
- [ ] No per-frame allocations in the hot render loop that cause visible GC stutter (no frame > 25 ms during a 60 s walk-through).
Design needed: no.
Notes / dependencies: final check before M1 exit; overlay part can be built with US-004.

### US-019 Dust motes in the sun shaft  [Priority: P2] [Status: todo]
As a player, I want to see tiny specks of dust drifting in the sunlight, so that the light feels volumetric.
Acceptance criteria:
- [ ] 40-80 particles within the sun shaft volume, drift slowly (0.05-0.15 m/s) with gentle noise, drawn as `.` / `'` in sun color, visible only while in sunlight.
- [ ] Costs <= 0.5 ms per frame.
Design needed: minor (glyphs/colors, designer confirms).
Notes / dependencies: US-007, US-011.

### US-020 Sound  [Priority: P2] [Status: todo]
As a player, I want to hear the fire crackle, my steps, the boulder and the wind, so that the space feels real.
Acceptance criteria:
- [ ] WebAudio procedural synthesis only (noise-based crackle, wind, clicks/thuds); no audio asset files, no `game/assets/audio/` folder in M1 (D-004).
- [ ] Audio context starts after the first user input (no autoplay errors in the console).
- [ ] Sounds per GDD 7.5: brazier crackle attenuates with distance; footsteps on stone with slight pitch variation; boulder roll + thud; lever clunk; grate rattle; wind grows near the breach.
- [ ] M key toggles mute.
Design needed: no.
Notes / dependencies: picked up only when every P0 is `done` and US-022 is done or explicitly deferred. Scope cap: one story; if it grows, cut sounds rather than extend. Not an M1 exit criterion; testers do not fail M1 on audio.

### US-021 Readable wall scrawl  [Priority: P2] [Status: design]
As a player, I want to find scratched words on the wall near where I woke, so that I get a hint of my purpose.
Acceptance criteria:
- [ ] Decal material spelling `KEEP THE LIGHT` readable from 2 m, fading into stone texture at > 5 m.
Design needed: yes – decal glyph pattern (low priority for designer).
Notes / dependencies: US-004, US-010.

### US-022 Light the summit beacon with the lantern  [Priority: P1] [Status: todo]
As a player, I want to relight my tower's beacon before I step out, so that the slice ends on a hopeful act and shows the core loop.
Acceptance criteria:
- [ ] Targeting the beacon bowl (US-012 rules, 1.8 m / ~20 degrees) while carrying the lantern shows `[E] Light the beacon`. Without the lantern: no prompt (the bowl is not interactable).
- [ ] Pressing E ignites the bowl: flames grow from 0 to full over 1.0 s, using the US-011 brazier flame frames (6 frames, 10 fps) scaled/tiled to the 12x4 bowl; flame cells are emissive.
- [ ] A new point light starts at the bowl centre (about 0.8 m above the ash): warm orange (brazier `#ff9a3c` family), intensity ramps 0 to 1.0 over 1.0 s, radius 12 m target, same flicker model as the brazier (8-12 Hz, ±15%).
- [ ] Performance: at the summit view (looking out the breach with the beacon lit) the US-018 budget holds (>= 58 fps). If not, reduce the beacon radius (minimum 8 m) until it does; the feature is never cut for performance. The final radius is recorded in the tuning config.
- [ ] The lantern is not consumed: the player keeps it and its light after lighting the beacon.
- [ ] One-way: once lit, the bowl shows no prompt and stays lit until restart.
- [ ] Optional: the breach end trigger (US-017) works whether or not the beacon is lit; end text uses the lit variant `One beacon burns. The others are dark.` only when lit.
- [ ] The distant second tower (US-016) stays dark after lighting; nothing in the far view changes.
- [ ] Restart (R) resets the beacon to unlit.
Design needed: no new story – designer confirms the brazier flame frames scale to the 12x4 bowl (D-003).
Notes / dependencies: US-011, US-012, US-016, US-017, US-018. Picked up only after every P0 story is `done`. Not an M1 exit criterion.
