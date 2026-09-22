# ASCII Quest – Product Backlog

Owner: Product Owner. Last updated: 2026-09-22.
Statuses: `todo | design | dev | po-review | testing | done`. Numbers and layout details: see `docs/game-design.md` section 5 and 7.

## Build order – Milestone 1 "The Awakening"

| Order | ID | Title | Priority | Status | Who picks up |
|---|---|---|---|---|---|
| 1 | US-001 | Char-grid canvas + game loop | P0 | po-review (rework #2 done: WebGL2 back-end per D-005) | **Programmer NOW** |
| 2 | US-002 | Master palette, glyph ramps, stone/wood/iron/sky materials | P0 | done | PO approved 2026-09-22; designer moves on to US-010 then US-011 |
| 3 | US-003 | Sector map format + test room loader | P0 | dev (PO REJECT #1: format v2) | Programmer #2 NOW (small rework) |
| 4 | US-004 | Sector raycaster: walls, floors, ceilings, sky, y-shear | P0 | todo | Programmer, after US-001 rework #2 + US-003 v2 (uses `setCellRGB`, D-005) |
| 5 | US-005 | First-person camera controls (keyboard + mouse) | P0 | todo | Programmer |
| 6 | US-006 | Lighting: ambient + point lights with flicker | P0 | todo | Programmer |
| 7 | US-007 | Lighting: sun directional light with shaft shadow | P0 | todo | Programmer |
| 8 | US-008 | Physics: player capsule, gravity, walk/run, collision | P0 | todo | Programmer |
| 9 | US-009 | Physics: jump, step-up, landing feel | P0 | todo | Programmer |
| 10 | US-010 | Tower layout: 3 levels as sector data | P0 | todo | Design PO-approved 2026-09-22; designer does the small start-field alignment; programmer ports after US-003 v2 |
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

### US-001 Char-grid canvas + game loop  [Priority: P0] [Status: po-review]
As a player, I want the game to open in my browser as a crisp grid of colored characters running smoothly, so that everything else has a stable screen to draw on.
Acceptance criteria:
- [x] `game/index.html` opens from a static server (no build step, no external libraries) and shows a full-window canvas on a black background. (ES modules do not load from file://; accepted, see rework item 5.)
- [x] A `RenderTarget` exists with `setCell(x, y, glyph, fg, bg)`, `clear(bg)` and `present()`; logical grid defaults to 160x60 cells.
- [x] Grid scales to fit the window on resize, keeping cell aspect (monospace font, integer-ish font size); no stretched, blurry or clipped glyphs at 1x and 2x devicePixelRatio. (Fixed, rework item 4 - see notes below.)
- [x] Main loop: fixed 60 Hz `update(dt)` with accumulator (max 5 steps per frame to avoid spiral of death) and a separate `render(alpha)` via `requestAnimationFrame`.
- [x] Demo screen: an animated color gradient + all glyphs of ` .:-=+*#%@` drawn in a strip, proving per-cell fg and bg color.
- [x] F3 toggles an overlay showing fps and frame time (ms) in the top-left corner. (Fixed, rework item 2 - preventDefault verified.)
- [x] Full 160x60 grid redraw each frame keeps 60 fps in Chrome on a normal laptop (overlay shows >= 58 fps, frame <= 8 ms for the grid draw). **Manager decision D-005 (2026-09-22):** WebGL2 fullscreen cell-shader back-end behind the unchanged API, Canvas2D v2 with pxCellH <= 16 cap as fallback. Passes on structural grounds (one draw call, <= 80 KB upload/frame, zero per-frame allocations) plus this session's `?bench=1` numbers. Done - see rework #2 notes below. **The sandbox used for this work ran the `gl2` back-end** (WebGL2 was available), measured `present()` avg 0.12-0.14 ms (p95 0.2 ms) regardless of canvas resolution (tested 640x300 up to 2240x1380 device px) - the `c2d-capped` fallback path was also exercised via `?force2d=1` and renders correctly but was not benchmarked (D-005 only requires the structural cap for it, not a bench pass).
- [x] Code is split per CLAUDE.md layout: `game/js/engine/` (loop, input stub), `game/js/render/` (RenderTarget).
- [x] (added on review) Palette access matches the US-002 `design/palette.js` v1 shape (see rework item 3 - verified, `getDefaultRamp()` returns the designer's 14-step ramp).
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

**Rework #1 done (2026-09-22) - programmer notes:**
- Items 2, 3, 4, 5 are done and verified (see below). Item 1 (performance) is **NOT resolved and needs a manager decision** - reporting per the reject note's own "stop and report" instruction rather than claiming a pass.
- **Item 1 - performance.** Added `?bench=1` (`game/js/main.js` + `game/js/render/benchScene.js`): renders 600 worst-case frames (every cell a unique, frame-varying, non-space glyph) outside the rAF loop and reports avg/p95/max for `present()` alone and for the full frame, both in `console.log` and on the debug overlay (also stored on `window.__bench`).
  - I tried three different Canvas2D architectures this round (details in the perf-history comment at the top of `RenderTarget.js`): (a) the original per-cell `fillText`/`fillRect` (~110 ms/frame, what triggered the original reject), (b) tinted-glyph-tile caching drawn with `ctx.drawImage` (the approach this reject suggested, to bound cost by cols*rows instead of device pixels) - in three variants (per-tile canvas allocation, a capped `Map` cache, then a pre-allocated canvas pool), all of which measured as *slower and far less stable* than the pixel-buffer approach in my only available measurement environment: hundreds of ms up to several **seconds** per frame, apparently because canvas object creation and especially `globalCompositeOperation` switches are individually very expensive there. (c) The one that shipped: a full-resolution pixel buffer composited in plain JS (glyph alpha-mask atlas + per-pixel color blend) flushed with one `ctx.putImageData`/frame. This was the fastest and most stable of the three by a wide margin, but it does mean cost scales with device pixel count (cols*pxCellW x rows*pxCellH), not with the 160x60 grid - the exact limitation this reject flagged.
  - Cell sizing (item 4) also changed to measure real glyph metrics instead of a hard-coded aspect ratio, which changes `pxCellW`/`pxCellH` (and so device pixel count) versus the original version - noted since it affects these numbers too.
  - **Measured numbers** (this sandboxed browser-automation tool's preview pane only - I do not have access to a real foreground desktop Chrome window; see caveat below):
    - Canvas ~960x540 (dpr 1, ~0.52M device px): `present()` avg **~21-23 ms**, p95 ~28-29 ms, across two separate runs.
    - Canvas ~2240x1380 (dpr 1.25, ~3.09M device px, the closest to a "2x-ish" DPR window this tool's viewport emulation could give me): `present()` avg **31.3 ms**, p95 40.7 ms, max 67.5 ms.
    - All of these are 2.5x-5x over the 8 ms budget, and the scaling with pixel count was inconsistent between runs (noisy), which read to me as this environment adding significant overhead on top of the real algorithmic cost (isolated micro-benchmarks earlier in this session also showed e.g. a bare `putImageData` at ~1.15M px costing ~4.8 ms, and 9600 `fillRect` calls costing ~18 ms, both far above what published real-Chrome numbers would suggest).
  - **I could not get a trustworthy foreground-desktop-Chrome-on-a-normal-laptop number** - I only have this project's sandboxed browser-automation pane, and every measurement I took in it this session (across three different rendering architectures) showed anomalously high canvas-API overhead. I don't want to report a false pass, and I don't want to report "fails on a normal laptop" when I never actually measured one.
  - **NEEDS MANAGER DECISION** (per the reject note's own escalation clause): please re-run `http://localhost:8000/game/index.html?bench=1` in a real foreground desktop Chrome window at 1920x1080 and at a 2x DPR window, read `window.__bench` (or the on-screen overlay it writes), and confirm whether the shipped pixel-buffer approach actually meets budget on real hardware. If it does not, the two options from the original reject stand: cap the backing cell resolution (less crisp at very high DPR) vs. a WebGL2 back-end behind the same `RenderTarget` interface (`setCell`/`clear`/`present` unchanged either way).
- **Item 2 - F3/Find.** `game/js/engine/input.js` now calls `preventDefault()` on keydown for a `GAME_KEYS` set (F3, F6, F7, WASD, E, Space, Shift, arrows) whenever no Ctrl/Meta/Alt modifier is held. Verified by dispatching synthetic events: `F3` alone -> prevented; `Ctrl+F3`, `F5`, `Ctrl+F` -> not prevented.
- **Item 3 - palette shape.** `game/js/render/palette.js`'s placeholder is now `{ version: 0, colors: {...}, ramps: { default: '...' } }`, matching `design/palette.js` v1's real shape; `getDefaultRamp()` reads `palette.ramps.default`. `game/index.html` loads `../design/palette.js` as a classic `<script>` before the `main.js` module. Verified in-browser: `getPalette().version === 1` (the real file) and `getDefaultRamp()` returns the designer's 14-step ramp `' .,:;-=+*o#%&@'`.
- **Item 4 - glyph clipping / cell sizing.** `RenderTarget._measureGlyphs()` measures all 95 printable ASCII glyphs (32-126) via `measureText`/`actualBoundingBoxAscent`/`actualBoundingBoxDescent` at a large reference size, then re-measures at the derived final font size so the cell box (`pxCellW`/`pxCellH`/`glyphAscent`) comes from real metrics, not `CELL_ASPECT`. Added `game/js/render/glyphsScene.js` + `?glyphs=1` (all 95 glyphs on alternating light/dark cell backgrounds). Verified visually at 1280x800 - all glyphs including `@ W M & % _ , ; j g | $` render fully inside their cells with no clipping into neighboring cells.
- **Item 5 - minor.** `game/index.html` now has an inline classic `<script>` that shows a full-screen message when `location.protocol === 'file:'`. Stale "dirty-cell diffing" comment removed from `game/js/ui/debugOverlay.js` (that technique was replaced during the perf work anyway).

**Rework #2 done (2026-09-22) - manager decision D-005 implemented:**
- `game/js/render/RenderTarget.js` is now a factory (a function used with `new`, since it returns whichever back-end instance it picked - `new RenderTarget(canvas, cols, rows, opts)` still works exactly as before). It feature-detects WebGL2 on a **throwaway** canvas first (never the real one - see the code comment for why: a canvas that successfully obtains a webgl2 context can never fall back to '2d' on that same element), then constructs either `RenderTargetGL` or `RenderTargetCanvas2D` on the real canvas. `?force2d=1` forces the Canvas2D fallback for testing.
- `game/js/render/CellBuffer.js` (new): the shared typed-array cell store (item 1) - `glyphIdx: Uint8Array(cols*rows)`, `fg`/`bg: Uint8Array(cols*rows*4)`. `fg`'s alpha byte doubles as the glyph index (0-94), so it's already exactly the WebGL `uFg` texture's byte layout - no repacking at upload time. `setCell(x,y,glyph,fgHex,bgHex)` resolves hex strings through a color cache (unchanged public behaviour); `setCellRGB(x,y,glyphIdx,r,g,b,r2,g2,b2)` is the new allocation-free numeric fast path for hot callers (US-004's raycaster should use it).
- `game/js/render/glyphMetrics.js` (new): the metrics-based cell-sizing logic from rework #1, factored out so both back-ends size cells identically (and so the Canvas2D fallback's `pxCellH <= 16` cap is just one extra argument to the same function).
- `game/js/render/RenderTargetGL.js` (new) - the primary back-end:
  - Shaders are JS template strings (no build step). Vertex shader draws a fullscreen triangle from `gl_VertexID` alone (no vertex buffer/VAO attributes). Fragment shader: `cell = floor(uv*grid)` (with a y-flip so row 0 is screen-top), `texelFetch` the fg/bg NEAREST textures, decode `glyphIdx = round(fg.a*255)`, sample the LINEAR atlas at `((glyphIdx+fract)/95, fract)`, `mix(bg,fg,a)`.
  - Two RGBA8 160x60 NEAREST textures (`uFg`, `uBg`), updated via `texSubImage2D` directly from the `CellBuffer` arrays every `present()` - no CPU-side per-pixel work, no repacking, no new allocations. Upload size is exactly `2 * 160*60*4 = 76,800` bytes/frame (under the 80 KB budget).
  - Glyph atlas: ASCII 32-126 rendered once into an offscreen Canvas2D per resize (reusing the metrics-based cell sizing), uploaded as a 95x1-cell RGBA8 LINEAR strip via `texImage2D` directly from the canvas element.
  - `present()` is 2 `texSubImage2D` + 1 `drawArrays(TRIANGLES,0,3)` - one draw call, no allocations, no other per-frame GL state changes.
  - `webglcontextlost`/`webglcontextrestored` handled: on loss, `present()` becomes a no-op (verified - does not throw); on restore, the program/VAO/textures/atlas are rebuilt from scratch. Verified in-browser using the `WEBGL_lose_context` extension (`loseContext()` -> `present()` still safe -> `restoreContext()` -> rendering resumes correctly, confirmed by screenshot).
- `game/js/render/RenderTargetCanvas2D.js`: the rework #1 v2 pixel-buffer approach (glyph alpha-mask atlas + per-pixel JS blend + one `putImageData`), now reading from `CellBuffer` instead of string arrays, with `pxCellH` capped to 16 device px (backing resolution capped, CSS-upscaled to fill the window - accepted softness per D-005). The perf-history comment from the old `RenderTarget.js` moved here per D-005 item 7.
- `game/js/main.js`: passes `{ force2d }` from `?force2d=1` into the factory, logs `[RenderTarget] back-end: <gl2|c2d-capped>` to the console on load, and shows `backend: <...>` on the F3/`?debug=1` overlay and in the `?bench=1` report (`window.__bench.backend`).
- **Verification done this session** (this sandboxed browser-automation pane; WebGL2 was available here, so `gl2` is what actually ran):
  - `?bench=1` at 640x300 px (dpr 1.25): `present()` avg **0.14 ms**, p95 0.2 ms, max 1 ms.
  - `?bench=1` at 2240x1380 px (dpr 1.25, the largest this tool's viewport emulation gave me): `present()` avg **0.12 ms**, p95 0.2 ms, max 1 ms - confirms cost does not scale with device pixels/DPR (structurally fixed by the GPU-side design), unlike every Canvas2D architecture tried in rework #1.
  - (`fullFrame` avg in both runs is ~32-38 ms, but that's `benchScene.js`'s own JS cost of calling `setCell` with hex strings for all 9600 cells with unique colors every frame - not `present()`/the render back-end. US-004 is expected to use `setCellRGB` instead, which avoids the hex-parsing/color-cache work entirely.)
  - `?force2d=1` verified: console logs `backend: c2d-capped`, overlay shows it, renders correctly (screenshot-verified at the pane's native size; not benchmarked, per D-005 item 6 the bench pass is only required for the primary path).
  - `?glyphs=1` re-verified under `gl2` - all 95 glyphs render correctly through the shader/atlas path (same visual result as the Canvas2D path from rework #1), confirming the atlas orientation/`atlasUv` math is correct.
  - `setCellRGB` smoke-tested directly (wrote a red 'A' on green bg via raw bytes, read back `CellBuffer.glyphIdx`/`fg`/`bg` to confirm correct storage).
  - Did not touch `game/js/world/` (merged US-003 code).

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
Designer note (2026-09-22): **Preview ready for PO review.** Open `design/preview/palette.html` directly from disk (`design/preview/materials.html` redirects there). Deliverables: `design/palette.js` (v1, plain script, sets `window.ASSETS.palette`; classic tag or side-effect import), `design/README.md` (export shape, shading pipeline, texture UV conventions, fog rules, engine notes), `design/style-guide.md`. There are 9 materials: stone, stone_moss, stone_scorched, floor, ash, wood, iron, rubble, sky. That covers the 6 required plus the moss and scorched variants US-010 needs. Open points for the PO: (1) the US-015 hint `WASD move · Mouse look` uses non-ASCII `·`; the proposed text is `WASD move - Mouse look`; (2) engine features needed: emissive cells (sky, later fire), a hit height above the sector floor for moss/soot bands, and texture fade by distance (see README section 2). Status stays `design` until PO preview review.

**PO APPROVED (2026-09-22) – US-002 done (art/data-only story, no separate tester pass).** Its data is exercised and tested through US-004/006/007/011/016.
- All 6 criteria are met: the required colors are exact, the 14-step default ramp contains the D-002 ramp in order, and there are 9 materials with bg rules, ramps and textures.
- Fog is 12/60 m interior and 50/1500 m far. The preview has an intensity slider (0..1.5), ambient/sun/torch/lantern presets, the ramps, and `validate()` = OK.
- Spot checks: ambient-only mortar/grout is above the 0.03 cutoff, so there is never pure black within 8 m (GDD 7.3). Sun vs shadow is +5/+6 ramp steps (US-007 needs >= 4). `lights.beacon` is present for US-022.
- Open points resolved: (1) the US-015 hint text changed to ASCII `WASD move - Mouse look`; (2) emissive cells, hit height above the sector floor (tintBand) and texture fade are folded into US-004 / US-011 as acceptance criteria.
- Small README fix for the designer (non-blocking): README section 1.1 says "US-001 has to open straight from disk". Per the US-001 review the game is served over http (ES modules); keep `palette.js` as a plain script (correct for both) and just correct that sentence.

### US-003 Sector map format + test room loader  [Priority: P0] [Status: dev]
As a player, I want the world to have real floors at different heights, so that stairs, ledges and a roofless tower are possible.
Acceptance criteria:
- [x] A level is a JS data file (`game/js/world/levels/<name>.js`) with a 2D grid of cells; each cell references a sector with: `floorH`, `ceilH` (number or `"sky"`), `wallMat`, `floorMat`, `ceilMat`, `solid` flag.
- [x] Legend-based authoring: level rows are strings, one char per cell, plus a legend object mapping chars to sector definitions (so the designer can author layouts as text).
- [x] Loader validates: rectangular grid, every char in legend, player start defined; errors are printed to the console with row/column.
- [x] Query API: `sectorAt(x, y)`, `floorAt(x, y)`, `ceilAt(x, y)` in world meters (1 cell = 1 m).
- [x] A test level `test_room` (16x16) with: flat floor at 0, a 3-step staircase (0.3 m steps), a raised platform at 1.0 m, a pillar, and a sky-ceiling region.
- [ ] (added on review) Format v2 covers the approved tower (US-010) and has one heading convention. See rework list.
Design needed: no.
Notes / dependencies: US-001.

**PO REJECT #1 (2026-09-22) – rework list (small, one session).**
The 5 original criteria pass and the code is clean. The problem: the format as documented cannot express the approved tower layout (US-010), and its heading convention contradicts itself. US-004, US-008 and US-010 all build against `MAP_FORMAT.md` next, so it is much cheaper to fix now than after they consume it.
1. **One heading convention.**
   - `facingDeg` is compass degrees: 0 = north (-y), 90 = east (+x), clockwise. This is the same convention as the palette sun azimuth and the code in `worldTestMain.js`.
   - Fix the "0 = east" statements in `MAP_FORMAT.md` section 5 and in the `test_room.js` legend comment. If the start should face east, set `facingDeg: 90`.
   - Level start v2 = `{ x, y, facingDeg, pitchDeg?, eyeH?, pose? }`: pitch in degrees (+ = up), start eye height in meters (default = standing eye 1.6), and `pose` (`'standing' | 'lying'`, for US-015). Put the same optional fields on legend start entries.
2. **Solid cells have a height** (normative, adopting `design/levels/tower_layout.md` section 6.1).
   - For collision, a solid cell blocks movement at any height.
   - For rendering, it is a column from below the level up to its `floorH` (the wall top). Its top face uses `floorMat`, and rays continue above it: you can see over a parapet and a broken wall top against the sky.
   - Document this, and correct section 6 ("solid cells block the ray").
3. **`topH` and `upperMat`** (normative, sections 6.2 and 6.3). A non-solid cell with a numeric `ceilH` has overhead mass from `ceilH` up to `topH`.
   - The default for `topH` is `ceilH`, a zero-thickness slab, so `test_room` ceilings behave as today.
   - `upperMat` is the material of the face below the fixed stone part (grate bars). The default is `wallMat`.
   - Document the face-material rule: a step or ledge front uses the higher sector's `wallMat` (section 6.7).
4. **Keep level-level data.**
   - `Level` exposes the original definition (`level.def`), so `lights`, `props`, `triggers`, `markers`, `sun` and `layers` reach later stories.
   - Unknown sector fields (`zone`, `tag`, `desc`, `dynamic`) pass through untouched. Document them as optional extensions (the list in `tower_layout.md` section 6).
   - If `layers` is present, validate that every layer grid has the same size as `rows`, and report row/col otherwise.
5. **Sector field validation** (cheap, prevents NaN bugs downstream).
   - Per legend char: `floorH` is a finite number, `ceilH` is a finite number or `'sky'`, and `solid` is a boolean.
   - `wallMat` and `floorMat` are non-empty strings. `ceilMat` is a string, or `'sky'` when `ceilH === 'sky'`.
   - For a non-solid cell, `ceilH >= floorH` (equal is allowed: closed grate). Errors name the legend char.
6. **`test_room` exercises the new fields**, so US-004 can test them:
   - a solid low wall 1.0 m high that you can see over into the sky region;
   - one `stone_moss` wall section (for the US-004 tintBand check);
   - one doorway/lintel cell with `ceilH 2.2`, `topH 3.0`;
   - a 1-cell (1 m) gap onto +0.3 m and a 2-cell (2 m) gap at equal height (for US-009).
   - Update `world-test.html` if the new fields need display.
7. Bump the `MAP_FORMAT.md` change log to v2.

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
- [ ] 60 fps on `test_room` with the F3 overlay (render <= 8 ms). The 8 ms budget is binding for the JS raycast + shading; the GPU present is extra (D-005).
- [ ] (D-005) Cells are written through the allocation-free `RenderTarget.setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2)` (glyphIdx = ASCII code - 32). No hex strings, no per-cell object or array allocation in the hot loop; `setCell` with hex is only for UI and debug text.
- [ ] (MAP_FORMAT v2) Solid cells are drawn as columns up to their `floorH` (wall top), with a lit top face in `floorMat`, and rays continue above them. In `test_room` the sky is visible over the 1.0 m low wall. In the tower, broken wall tops (6.5-8.5 m) show a ragged silhouette against the sky from the ground floor.
- [ ] (MAP_FORMAT v2) Non-solid cells with a numeric `ceilH` draw their upper face from `ceilH` to `topH`, using `upperMat` if set, else `wallMat`. The `test_room` lintel cell shows a 0.8 m lintel above a 2.2 m opening. Step and ledge fronts use the higher sector's `wallMat`.
Design needed: no (consumes US-002).
Notes / dependencies: US-001 (rework #2, WebGL2 back-end + `setCellRGB`), US-003 (format v2).

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
- [ ] Walking jump reliably clears the `test_room` 1-cell (1.0 m) gap onto a floor 0.3 m higher (10 of 10 tries, taking off anywhere within the last 0.3 m before the edge). Running jump clears the 2-cell (2.0 m) gap at equal height. (The 1 m grid makes gaps 1 m or 2 m; the tower gap is 1 m, PO decision on US-010.)
- [ ] Step-up only applies while grounded: never while airborne, and never during coyote time. Walking or running across a 1-cell gap without pressing Space always falls, including onto a +0.3 m landing. The capsule footprint must not "bridge" the gap by stepping up from mid-air. Test: 10 runs across the tower gap at run speed without Space, and all 10 fall onto the debris.
- [ ] Landing dip: 0.08 m for falls > 0.5 m, 0.15 m for falls > 2 m, recovering in 0.2 s. Subtle head bob 0.03 m while walking.
- [ ] No double jump; holding Space does not auto-repeat jumps.
Design needed: no.
Notes / dependencies: US-008.

### US-010 Tower layout: 3 levels as sector data  [Priority: P0] [Status: todo]
As a player, I want to wake inside a ruined round tower with a stair winding up to a breach, so that I have a clear, intriguing space to explore.
Acceptance criteria – Designer:
- [x] `design/levels/tower_layout.md`: top-down text map(s) of the tower using the US-003 legend format (outer footprint about 12x12 plus the outside outcrop and a few cells of hill beyond the breach), with a legend giving floorH/ceilH/materials per char.
- [x] Contains every element of GDD 7.1 at the stated heights: wake pallet (S), brazier ~3 m from it, lantern hook, sun-crack in the east wall, rubble (0.3-0.9 m), hollow at -0.3 m (NW), slope from stair base to hollow, boulder start on stair base, stair of 0.30 m steps clockwise, gap at ~2.7 m (**1.0 m, PO decision below**, was 1.5 m), mid ledge 2x2 at 3.0 m with lever and grate positions, upper stair to 6.0 m, summit walkway with parapet (**west bastion, PO decision below**), beacon bowl, 2 m breach (W), outcrop + end trigger cells.
- [x] Irregular broken wall-top heights (6.5 to 8.5 m) so the silhouette against the sky reads as ruined.
- [x] Marks player start position and facing (lying, facing the sun shaft), and positions of all lights and props.
- [x] Wall materials assigned (stone variants, moss near the ground on the north side, scorched stone near the brazier).
Acceptance criteria – Programmer (port). Blocked until US-003 rework #1 is PO OK and the designer alignment below is done:
- [ ] `game/js/world/levels/tower.js` built from the layout; loads with no validation errors and becomes the default level (test_room still reachable with `?level=test_room`).
- [ ] Every stair step is climbable, the gap is jumpable walking, falling from any stair lands safely on ground level, the summit is only reachable through the grate path.
- [ ] The slice is completable without ever taking the lantern (wake to breach end; the lantern is a soft gate only, D-004 notes).
- [ ] Content is ported unchanged from `design/levels/tower.js`, including the extension fields (props, lights, triggers, markers, layers.tilt), accessible via `level.def`. `design/levels/tower.js` stays the single source: any later layout change is made there first and re-ported.
- [ ] Walking or running across the 1 m gap without Space always falls (depends on US-009; re-verify in the tower).
Design needed: yes – level layout map + legend.
Notes / dependencies: US-003 format. The designer may start now using the US-003 legend format described above.
Designer note (2026-09-22): **Preview ready for PO review.**
- **Files:** `design/preview/tower.html` shows plans per level, heights, props, lights, reachability, boulder tilt, a sun slider and the climb profile, and runs automated checks. Data: `design/levels/tower.js` (single source, US-003 format plus optional extensions). Doc: `design/levels/tower_layout.md`.
- **Constraints:** the slice is completable without the lantern. The boulder can physically reach only the stair base, the slope apron and the NW hollow, so the hollow is its only resting place. The grate is the only link from the ledge to the upper stair. The 2 m breach leads onto the end trigger.
- **Open points for the PO:**
  1. The gap is 1 cell (1.0 m), because the 1 m grid cannot express 1.5 m; 2 cells would exceed a safe walking jump.
  2. The summit is a beacon bastion on the tower's west side, because a ring walkway cannot sit over the roofless interior with one floor per cell.
  3. The end trigger is 4 cells, so a diagonal step off the breach cannot skip it.
  4. The data is aligned with the merged MAP_FORMAT v1 (explicit start `{x, y, facingDeg}`; every legend entry has the 6 fields). The preview validates it through the real `loadLevel` over http. The optional extensions are ignored by the loader. US-004 must draw a solid cell only up to its `floorH` (wall top) for the ruined silhouette. The `facingDeg` comments in MAP_FORMAT section 5 and `test_room.js` say 0 = east, but the code uses compass (0 = north).
- Status stays `design`.

**PO APPROVED – design part (2026-09-22).** Status is now `todo` for the programmer port.
- All 5 designer criteria are met, and the preview's 18/18 automated checks pass (reported by the coordinator).
- I read the data and confirmed the manager constraints:
  - lantern-free completion;
  - the boulder is trapped in base, apron and hollow by heights alone, plus the tilt layer;
  - the grate is the only link to the summit;
  - the 4-cell end trigger cannot be skipped diagonally.
- Decisions on the open points:
  1. **The gap is 1.0 m (1 cell): accepted.** It matches "forgiving on purpose". It still needs a jump, because a walk-off drops 2.1 m onto the debris. Risk found on review: with the capsule footprint and 0.45 m step-up, a player could run across a 1 m gap and step up mid-air onto the +0.3 landing without jumping. That would stop the jump beat from teaching anything. I fixed this by adding "step-up only while grounded, never during coyote time" to US-009, plus a no-Space test.
  2. **Summit as a west bastion: accepted.** A ring over the interior would roof over the sun shaft. The bastion keeps the look-down into the tower and frames the far tower through the breach. GDD 7.1 is updated.
  3. **4-cell end trigger: accepted.**
  4. **Format:** the extensions in `tower_layout.md` section 6 become normative in MAP_FORMAT v2 (US-003 rework #1). The facing convention is compass (0 = N, 90 = E, clockwise), as the designer says.
- Small alignment for the designer (mechanical, before the programmer ports):
  - rename `start.eye` to `start.eyeH` and drop `start.eyeStand` (standing eye height is the physics config's 1.6), so that `start` = `{ x, y, facingDeg, pitchDeg, eyeH, pose }` per MAP_FORMAT v2;
  - make sure `rock` and `grass` pass `P.util.validate()`;
  - `grate` arrives with US-011 (that criterion is now explicit there).

### US-011 Billboard props + prop art  [Priority: P0] [Status: design]
As a player, I want the brazier, lantern, lever, boulder and other objects to look detailed and solid, so that I can recognise what matters.
Acceptance criteria – Designer (`design/models/*.js` + `design/preview/props.html`):
- [ ] Brazier with fire: 7x9 cells, fire animation 6 frames at 10 fps (`^ * ' .` flame, yellow core to orange to red tips), emissive flag on flame cells.
- [ ] Lantern: unlit (on hook) and lit variants, 3x4 cells; a 2-frame "glint" for the unlit one (brass highlight).
- [ ] Lever: up and down poses + 3 in-between frames (5 frames total), 3x5 cells.
- [ ] Grate (portcullis) as a wall material with the palette key `grate` in `palette.materials` (iron bars `|#|`), tileable so its height can animate. It is referenced by the tower's `upperMat: 'grate'` (US-010).
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
