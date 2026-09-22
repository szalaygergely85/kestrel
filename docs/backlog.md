# ASCII Quest – Product Backlog

Owner: Product Owner. Last updated: 2026-09-22.
Statuses: `todo | design | dev | po-review | testing | done`. Numbers and layout details: see `docs/game-design.md` section 5 and 7.

## Build order – Milestone 1 "The Awakening"

| Order | ID | Title | Priority | Status | Who picks up |
|---|---|---|---|---|---|
| 1 | US-001 | Char-grid canvas + game loop | P0 | done (tester PASS 2026-09-22; real-Chrome bench numbers still pending from user, non-blocking) | Programmer moves on |
| 2 | US-002 | Master palette, glyph ramps, stone/wood/iron/sky materials | P0 | done | PO approved 2026-09-22; designer moves on to US-010 then US-011 |
| 3 | US-003 | Sector map format + test room loader | P0 | done | Tested 2026-09-22 (PASS, `docs/test-reports/US-003.md`) |
| 4 | US-004 | Sector caster: walls, floors, ceilings, sky, y-shear (+ DepthBuffer, open span, origin offset per D-008) | P0 | dev | Programmer #1 NOW |
| 5 | US-008 | Physics: player capsule, gravity, walk/run, collision (+ out-of-grid world query per D-008) | P0 | dev | Programmer NOW |
| 6 | US-024 | **Engine/game split (D-006)** | P0 | todo | Programmer, when US-004 + US-008 reach `po-review`; before US-006 |
| 7 | US-025 | **World model: terrain + placed structures (D-007)** | P0 | todo | Programmer after US-024; designer supplies `world_m1.js` + US-016b |
| 8 | US-016b | Terrain recipe follow-up (analytic heightAt/typeAt, near look, crown + 6 m blend, overrides sketch) | P0 | design | **Designer NOW** (in progress) |
| 9 | US-005 | First-person camera controls (keyboard + mouse) | P0 | todo | Programmer (can run alongside; new files go to `engine/`) |
| 10 | US-006 | Lighting: ambient + point lights with flicker | P0 | todo | Programmer, after US-025 |
| 11 | US-007 | Lighting: sun directional light with shaft shadow | P0 | todo | Programmer |
| 12 | US-009 | Physics: jump, step-up, landing feel | P0 | todo | Programmer |
| 13 | US-010 | Tower layout: 3 levels as sector data | P0 | todo | Design PO-approved; integration = load `design/levels/tower.js` via AssetRegistry, place in world (after US-025). Designer adds `interactables` + hint zones |
| 14 | US-011 | Billboard props + prop art | P0 | todo | Art PO-approved; Programmer after US-006 (`engine/render/sprites.js`) |
| 15 | US-012 | Interaction system + lantern pickup (carried light) | P0 | todo | Programmer |
| 16 | US-013 | Rolling boulder | P0 | todo | Programmer |
| 17 | US-014 | Lever opens the grate | P0 | todo | Programmer |
| 18 | US-015 | Wake sequence + title card + control hints | P0 | todo | Art PO-approved, preview verified 6/6; Programmer after US-010 + US-012 |
| 19 | US-016 | Far overworld view = engine terrain caster, far LOD | P0 | todo | Design PO-approved 2026-09-22 (browser check pending); Programmer after US-025 + US-007 |
| 20 | US-017 | End trigger, fade and restart | P0 | todo | Programmer |
| 21 | US-018 | Performance budget + debug overlay check | P0 | todo | Programmer (final M1 check) |
| 22 | US-022 | Light the summit beacon with the lantern (optional beat, D-003) | P1 | todo | Programmer, after all P0 done |
| 23 | US-019 | Dust motes in the sun shaft | P2 | todo | Designer + Programmer |
| 24 | US-020 | Sound: procedural WebAudio (D-004) | P2 | todo | Programmer, after all P0 done and US-022 done/deferred |
| 25 | US-021 | Readable wall scrawl | P2 | design | Designer |
| 26 | US-023 | See-through grate (masked walls) | P2 | todo | Programmer, after all P0 done |

M1 exit criteria = all P0 stories `done` (roadmap), and `node tools/check-deps.mjs` reports no engine imports from `game/` or `design/`. US-022 (P1) and P2 stories are not exit criteria.

## Milestone 2 "First Steps" (sketched, see bottom of file)
| ID | Title | Priority | Status |
|---|---|---|---|
| US-026 | Walk out onto the terrain: near LOD, slope physics, chunk regeneration | P0 (M2) | todo (sketch) |
| US-027 | JSON content packs and world files | P1 (M2) | todo (sketch) |

---

### US-001 Char-grid canvas + game loop  [Priority: P0] [Status: done]
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

**PO OK (2026-09-22) – US-001 ready for testing.** Reviewed by reading the code: `RenderTarget.js`, `RenderTargetGL.js`, `CellBuffer.js`, `glyphMetrics.js`, `main.js`, `input.js`, `palette.js`, `index.html`.
- **Performance criterion:** passes on the structural grounds D-005 item 6 allows.
  - `present()` is exactly 2 `texSubImage2D` of 160x60 RGBA8 (76,800 bytes, under 80 KB) plus 1 `drawArrays(TRIANGLES, 0, 3)`.
  - There are no allocations and no per-cell JS work in `present()`. The atlas is rebuilt only on resize and on context restore.
  - Sandbox bench: `present()` avg 0.12-0.14 ms, flat from 0.2 M to 3.1 M device px.
  - **Open, non-blocking:** the user's real-Chrome `?bench=1` numbers (1x and 2x DPR). Paste them here when available. If real Chrome shows `present()` above 2 ms, reopen.
- **Rework #1 items:** all verified.
  - F3/game keys call `preventDefault` with modifiers passed through.
  - The palette shape matches US-002, and `design/palette.js` is loaded as a classic script before the module.
  - Metrics-based cell box: max advance, max ascent + descent + 1 px, CSS size = device px / DPR, so crisp at any DPR.
  - `?glyphs=1` exists, the file:// notice exists, and the stale comment is gone.
- **Structure is sound:** WebGL2 is detected on a throwaway canvas; there is a Canvas2D fallback capped at `pxCellH <= 16`, plus `?force2d=1`; context loss is handled; the back-end is shown on the overlay and in the console.
- **Known issue carried forward (not blocking US-001, now an acceptance criterion on US-004):** `CellBuffer._colorCache` never evicts.
  - `setCell` with a new hex string adds an entry forever. The demo scene generates about 19,200 new hsl-derived hex strings per frame, so memory grows for as long as the demo runs.
  - Harmless for UI text (a handful of colors), but it must be bounded before US-004 (and US-018's GC check).
- **Notes for the tester:**
  - Test on the default `gl2` path and with `?force2d=1`.
  - Use `?glyphs=1` for the clipping check at 1x and at 2x (browser zoom 200% or a HiDPI screen).
  - Use `?bench=1` for the numbers.
  - Check that F3 does not open Find.
  - Do not fail US-001 on memory growth in the demo scene: it is logged against US-004.

**Tester PASS (2026-09-22)** - see `docs/test-reports/US-001.md`. All acceptance criteria verified: gl2 backend by default, `?force2d=1` correctly forces `c2d-capped` (capped pxCellH<=16), `?glyphs=1` shows clean glyphs at multiple sizes/DPR with no clipping, resize keeps aspect and re-derives backing resolution correctly, `?bench=1` present() is flat at ~0.1ms avg/0.2ms p95 regardless of resolution (matches PO's sandbox numbers), no console errors on any path. F3 overlay toggle and preventDefault logic verified correct by dispatching a realistic KeyboardEvent (the sandbox's own synthetic key-press tool doesn't populate `code` for function keys, a tooling limitation, not a game bug - see report). No blocking bugs. Real-desktop-Chrome `?bench=1` numbers remain an open, non-blocking item for the user to supply.

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

### US-003 Sector map format + test room loader  [Priority: P0] [Status: done]
As a player, I want the world to have real floors at different heights, so that stairs, ledges and a roofless tower are possible.
Acceptance criteria:
- [x] A level is a JS data file (`game/js/world/levels/<name>.js`) with a 2D grid of cells; each cell references a sector with: `floorH`, `ceilH` (number or `"sky"`), `wallMat`, `floorMat`, `ceilMat`, `solid` flag.
- [x] Legend-based authoring: level rows are strings, one char per cell, plus a legend object mapping chars to sector definitions (so the designer can author layouts as text).
- [x] Loader validates: rectangular grid, every char in legend, player start defined; errors are printed to the console with row/column.
- [x] Query API: `sectorAt(x, y)`, `floorAt(x, y)`, `ceilAt(x, y)` in world meters (1 cell = 1 m).
- [x] A test level `test_room` (16x16) with: flat floor at 0, a 3-step staircase (0.3 m steps), a raised platform at 1.0 m, a pillar, and a sky-ceiling region.
- [x] (added on review) Format v2 covers the approved tower (US-010) and has one heading convention. See rework list.
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

**PO OK (2026-09-22) – US-003 ready for testing.** I checked all 7 rework items by reading `Level.js`, `MAP_FORMAT.md` and `test_room.js`:
1. Compass `facingDeg` everywhere. The old "0 = east" text is corrected and flagged as such. Start v2 fields have defaults (0 / 0 / 1.6 / standing), and the `S` marker is now `facingDeg: 90` (east).
2. MAP_FORMAT section 2.4 has the solid-cell semantics. Consumer notes: the raycaster draws a column up to `floorH` with a top face and rays continue above; physics treats solid cells as full-height.
3. `topH` (defaults to `ceilH`) and `upperMat` (defaults to `wallMat`) are resolved once per legend char. The face rule (higher sector's `wallMat`) is in section 2.7.
4. `level.def` is kept untouched, unknown sector fields pass through (spread), `layers` are validated for row count and row length, and `layerAt()` exists.
5. Type checks name the legend char. `ceilMat === 'sky'` if and only if `ceilH === 'sky'`, and `ceilH >= floorH` on non-solid cells. Invalid entries are not double-reported per cell.
6. `test_room` is 20x18 with: a 1.0 m low wall `w` directly south of the sky region, a `stone_moss` stub `m`, a lintel `D` (2.2 / 3.0) in a wall line, a 1 m gap onto +0.3 m (row 15), and a 2 m gap at equal height (row 16).
7. Change log v2 is present. `design/levels/tower.js` loads with zero errors (reported: Node + browser).

Fix-forward note (non-blocking, assigned to US-009): the `test_room` pit `v` is at -1.0 m. Getting out needs a jump whose apex (1.05 m) clears the lip by only 5 cm, especially once step-up is disallowed mid-air (US-009). Raise the pit floor to -0.6 m so it can't be walked out of but is easy to jump out of. That keeps the gap tests meaningful and avoids a test-room trap.

For the tester:
- In `game/world-test.html`, hover-inspect every legend char.
- Break `test_room` on purpose, one error each: a non-rectangular row, an unknown char, no start, two starts, `ceilMat 'sky'` with a numeric `ceilH`, `floorH: 'x'`, and a layer with the wrong size. Confirm each is reported with its row/col or legend char, and that `loadLevel` returns null.
- Confirm that `sectorAt`/`floorAt`/`ceilAt` return null outside the grid.

**Tester result (2026-09-22): PASS.** All 7 rework items and all original criteria re-verified; all 360 `test_room` cells cross-checked against the legend (hover-equivalent), all 9 single-fault negative cases correctly named their row/col or legend char and returned `null`, out-of-bounds queries return `null`, `design/preview/tower.html` shows zero console errors and 18/18 internal checks pass. No bugs found. Full report: `docs/test-reports/US-003.md`. Note: the shared browser pane was at its tab cap this session, so `game/world-test.html` was verified via the identical `Level.js`/`sectorAt()` calls in Node rather than live DOM hovering - see the report's environment note.

### US-004 Sector raycaster: walls, floors, ceilings, sky, y-shear  [Priority: P0] [Status: dev]
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
- [ ] (carried over from the US-001 review) The `CellBuffer` hex color cache is bounded (e.g. at most 1024 entries, cleared or LRU when full), so `setCell` with many unique hex strings cannot grow memory without limit. The default page no longer runs the US-001 demo scene; it stays reachable with `?demo=1`.
- [ ] (MAP_FORMAT v2) Solid cells are drawn as columns up to their `floorH` (wall top), with a lit top face in `floorMat`, and rays continue above them. In `test_room` the sky is visible over the 1.0 m low wall. In the tower, broken wall tops (6.5-8.5 m) show a ragged silhouette against the sky from the ground floor.
- [ ] (MAP_FORMAT v2) Non-solid cells with a numeric `ceilH` draw their upper face from `ceilH` to `topH`, using `upperMat` if set, else `wallMat`. The `test_room` lintel cell shows a 0.8 m lintel above a 2.2 m opening. Step and ledge fronts use the higher sector's `wallMat`.
- [ ] (D-008 #1) **DepthBuffer:** for every cell it writes, the caster also writes the hit distance in meters into a shared `DepthBuffer` (Float32Array cols*rows, `Infinity` = nothing drawn), alongside `setCellRGB`. It is cleared once per frame, allocation-free. US-011 sprites and US-016 terrain depth-test against it.
- [ ] (D-008 #2) **Open span per column:** when a ray leaves the level grid, the caster does **not** paint void or sky for the remaining cells. It leaves them unresolved and exposes per column the open span `[topRow, bottomRow, depth]` (typed arrays, no per-frame allocation) for the next pass. Sky ceilings inside the level still use `shadeSky`. For the M1 view, a fallback sky fill of any span left open after all passes is done by the compositor (US-016), so looking out of `test_room` over a low outer wall shows sky, not garbage.
- [ ] (D-008 #3) **Level origin offset:** the cast call accepts an optional level origin `{x, y, z}` (world meters). With origin (1480, 1018, 0) and the camera moved by the same offset, the rendered image is identical to origin (0, 0, 0). Test: a `?origin=1480,1018` switch on the test page, or an equivalent console check.
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

### US-008 Physics: player capsule, gravity, walk/run, collision  [Priority: P0] [Status: dev]
As a player, I want to walk and run with weight and bump into walls without getting stuck, so that movement feels solid.
Acceptance criteria:
- [ ] Fixed 60 Hz physics. Player is a vertical capsule, radius 0.30 m, height 1.70 m, eye 1.60 m.
- [ ] Walk 3.5 m/s, run (Shift) 6.0 m/s, full speed in 0.10 s, stop in 0.08 s (GDD section 5).
- [ ] Collision vs solid cells and vs sector walls higher than the step threshold; sliding along walls when moving diagonally into them; never tunnelling through a 1-cell wall at run speed; never stuck on corners.
- [ ] Gravity 20 m/s^2; walking off a ledge makes the player fall and land on the lower floor.
- [ ] Head collision: cannot enter a sector whose `ceilH - floorH` is less than 1.70 m.
- [ ] All values in one tuning config object (`game/js/physics/config.js` for now; moves to `engine/physics/config.js` in US-024).
- [ ] (D-008) **Out-of-grid world query:** every "is this passable / what is the floor here" answer comes from the passed-in `level`/`world` object (`sectorAt`, `floorAt`). There is no hard-coded "outside the grid = wall" branch in the physics code. Out-of-grid cells are answered by a query on the world object (e.g. `world.outsideSector(x, y)`), which returns a solid sector for M1's bare level, so later the terrain (US-025) can stand in without any physics change. Test: a stub world whose `outsideSector` returns a flat walkable floor lets the capsule walk off the grid edge.
Design needed: no.
Notes / dependencies: US-005.

### US-009 Physics: jump, step-up, landing feel  [Priority: P0] [Status: todo]
As a player, I want to climb stairs smoothly and jump gaps reliably, so that the climb is fun and not frustrating.
Acceptance criteria:
- [ ] Step-up: floors up to 0.45 m higher are climbed automatically; camera height smoothed over 0.1 s (no snapping) when stepping up or down.
- [ ] Jump on Space: initial velocity 6.5 m/s (apex about 1.05 m); only when grounded, with 100 ms coyote time and 100 ms jump buffer.
- [ ] Air control 35% of ground acceleration.
- [ ] Walking jump reliably clears the `test_room` 1-cell (1.0 m) gap onto a floor 0.3 m higher (10 of 10 tries, taking off anywhere within the last 0.3 m before the edge). Running jump clears the 2-cell (2.0 m) gap at equal height. (The 1 m grid makes gaps 1 m or 2 m; the tower gap is 1 m, PO decision on US-010.)
- [ ] (from the US-003 review) Raise the `test_room` pit `v` floor from -1.0 m to -0.6 m: it can't be walked out of (0.6 m > 0.45 m step-up) but is easy to jump out of.
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
Acceptance criteria – Programmer (integration). Unblocked: US-003 v2 is done and the designer alignment is done. Updated for D-006: no copy of the file.
- [ ] The tower is loaded from `design/levels/tower.js` itself (content pack): `game/js/main.js` passes it into the `AssetRegistry` (US-024), and `loadLevel` validates it with no errors. There is no hand-copied `game/js/world/levels/tower.js`, so nothing can drift. It becomes the default level, placed in the world at recipe coordinates (1480, 1018) per US-025. `test_room` stays reachable with `?level=test_room`.
- [ ] Every stair step is climbable, the gap is jumpable walking, falling from any stair lands safely on ground level, the summit is only reachable through the grate path.
- [ ] The slice is completable without ever taking the lantern (wake to breach end; the lantern is a soft gate only, D-004 notes).
- [ ] All extension fields (props, lights, triggers, markers, layers.tilt) are reachable via `level.def`. `design/levels/tower.js` is the single source.
- [ ] (D-006 / D-008) Props, lights, interactables, triggers and hint zones are all declared in the tower level data (`def.props`, `def.lights`, `def.interactables`, `def.triggers`, and hint zones as `def.triggers` of type `hint` or `def.markers`, per the designer's format). The designer adds the missing `interactables` entries (lantern, lever, beacon bowl) and the hint zones (gap edge `[Space] Jump`) to `design/levels/tower.js`. Behaviours are referenced by name (e.g. `interact: 'lantern.take'`, `trigger: 'quest.end'`) and registered from `game/js/quest/`. No tower-specific coordinates in engine or quest code.
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

### US-011 Billboard props + prop art  [Priority: P0] [Status: todo]
As a player, I want the brazier, lantern, lever, boulder and other objects to look detailed and solid, so that I can recognise what matters.
Acceptance criteria – Designer (`design/models/*.js` + `design/preview/props.html`):
- [x] Brazier with fire: 7x9 cells, fire animation 6 frames at 10 fps (`^ * ' .` flame, yellow core to orange to red tips), emissive flag on flame cells.
- [x] Lantern: unlit (on hook) and lit variants, 3x4 cells; a 2-frame "glint" for the unlit one (brass highlight).
- [x] Lever: up and down poses + 3 in-between frames (5 frames total), 3x5 cells.
- [x] Grate (portcullis) as a wall material with the palette key `grate` in `palette.materials` (iron bars `|#|`), tileable so its height can animate. It is referenced by the tower's `upperMat: 'grate'` (US-010).
- [x] Boulder: 5x4 cells, 8 rotation frames (texture shifts so rolling reads), mossy stone.
- [x] Rubble blocks (3 variants), straw pallet, beacon bowl with ash (large, 12x4 cells).
- [x] Every prop: anchor at feet, palette keys only (from US-002), readable at 1/2 scale (for distance).
- [x] Preview page shows each prop at near/mid/far scale on a dark background, with light-direction/intensity slider.
Acceptance criteria – Programmer:
- [ ] Billboard renderer: sprites positioned in world, scaled by distance, depth-sorted and occluded correctly by walls (per-column depth buffer).
- [ ] Sprites are lit by the same light model, except emissive cells (flames), which are drawn at full color and ignore both lighting and fog (uses the US-004 emissive flag).
- [ ] Brazier flame animates; the brazier is also the torch point light source position.
- [ ] (added on design review) Implements the sprite format in `design/README.md` section 4.
  - A space glyph is transparent.
  - Scale = `world.h` projected / `size.h`, nearest sampling, never upscaled beyond 3x; switch to `lods.half` when scale < 0.75.
  - Timing: `fps` or per-frame `durations` (ms) for the lantern glint, and `fps: 0` = frame driven by gameplay (boulder: distance rolled, lever: pull progress).
  - Lit cells use `util.shadeSprite` (engine re-implementation allowed, same results as the preview). The optional `n` rows (per-cell normals) may be ignored with `nf = 1` in M1.
- [ ] Props and lights are placed from `level.def.props` / `level.def.lights` (tower data), not hard-coded. `beaconBowl.mounts.fire` gives the US-022 fire anchor.
- [ ] (D-006 / D-008) Sprite rendering lives in `engine/render/sprites.js` (`drawSprites`). Models come from the injected `AssetRegistry`, never from `window.ASSETS`. Prop behaviour (animation state such as lever progress, lantern lit/empty) is set by name-registered behaviours from `game/js/quest/`, never by tower-specific engine code.
- [ ] Grate material: gap texels (`hole: true`) are drawn **dark** in M1: the solid fallback shown in the preview, with no see-through. See-through grates are US-023 (P2).
Design needed: yes – all props listed above (delivered).
Notes / dependencies: US-002 (palette keys), US-004, US-006.

**PO APPROVED – design part (2026-09-22).** Status is now `todo` for the programmer.
- All 8 designer criteria are met, confirmed from the model files: brazier 7x9 with 6 frames at 10 fps and emissive flames, lantern 3x4, lever 3x5, boulder 5x4, rubble x3, pallet 9x2, bowl 12x4, the `grate` material, and a hand-drawn half LOD for every prop. The preview has intensity, direction, elevation and distance sliders, and 9/9 checks pass (reported by the coordinator).
- The beacon fire reuses brazier flame units plus a grow-in rule, as D-003 asked. No new design story is needed for US-022.
- Decisions on the open points:
  1. **See-through grate (masked walls): not in M1 P0.** The lever beat only needs the player to see the grate rise, and the dark-gap fallback reads clearly as bars. Masked walls mean continuing rays through a partially transparent wall (Doom "mid-textures"), which is extra renderer work and risk to the frame budget. Moved to new story US-023 (P2).
  2. **Per-frame durations: required** (the lantern glint needs them). **Per-cell normals: optional** in M1 (`nf = 1` allowed).
  3. **Tower bowl cells as a 0.6 m stone plinth, and start v2 fields: accepted.** They fit US-003 v2 and the US-010 port.
Designer note (2026-09-22): **Preview ready for PO review.**
- **Where:** `design/preview/props.html`. It shows every animation at near 2x / mid 1x / far (hand-drawn half LOD) plus frame strips, with light preset, intensity, direction, elevation, fog distance, a normals toggle and a lit-backdrop toggle. It runs its own data checks.
- **Models** (`design/models/`):
  - `brazier.js`: brazier 7x9 with 6 burn frames at 10 fps, emissive flame, a 5x4 flame unit, and `beaconFire` 12x4 built from 3 flame-unit tiles, with a grow-in rule (D-003).
  - `lantern.js`: unlit with glint / lit / empty hook.
  - `lever.js`: idle glint / pull (5 frames, 0.4 s) / down.
  - `boulder.js`: 8 roll frames, driven by distance rolled.
  - `rubble.js`: rubble x3, pallet, and `beaconBowl` 12x4 with a fire mount.
- **Grate:** palette material `grate` (`| = #`, tileable). Gap texels are `hole: true`.
- **Format:** `design/README.md` section 4.
- **Open points for the PO:**
  1. See-through grate gaps need masked walls in the raycaster; the fallback draws the gaps dark.
  2. Per-frame `durations` (glints) and the optional per-cell normals are small renderer features.
  3. The tower's bowl cells are now a stone plinth under the bowl sprite.
- Status stays `design`.

### US-012 Interaction system + lantern pickup  [Priority: P0] [Status: todo]
As a player, I want to press E to take the lantern and carry its light with me, so that I can see in the dark stairwell.
Acceptance criteria:
- [ ] Interactables have: position, radius, prompt text, `onInteract`. Targeted when within 1.8 m and within about 20 degrees of view centre; nearest-to-centre wins.
- [ ] Crosshair `+` is dim by default and brightens when a target is active; prompt `[E] Take lantern` appears under it. Style follows `ASSETS.uiStyle.crosshair` / `uiStyle.prompt` (US-015 art): `uiDim` to `gold`, prompt 2 rows below with a gold `[E]` and a soft dark plate.
- [ ] Pressing E on the lantern removes the hook sprite (hook remains, empty) and attaches a point light: `#ffd27a`, 0.8 intensity, 5 m radius, held 0.3 m right / 0.3 m down / 0.4 m forward of the eye, sway with walk, ±5% flicker.
- [ ] The lantern light makes the upper stairwell (ambient-only areas) visibly readable: gap edges at least 3 glyph-ramp steps brighter than without it.
- [ ] Once taken, the lantern stays with the player for the rest of the run: there is no drop action and nothing consumes it (lighting the beacon in US-022 shares its flame, the player keeps it). One pickup only.
- [ ] (D-006 / D-008) The interaction system is engine-level and generic (targeting, prompt, `registerInteraction(name, fn)`). The lantern is a `def.interactables` entry in the tower data (position, radius, prompt, `interact: 'lantern.take'`). The `lantern.take` behaviour is registered from `game/js/quest/` and attaches the `P.lights.lantern` light. The engine has no lantern-specific code.
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
- [ ] (D-006 / D-008) The lever is a `def.interactables` entry (`interact: 'lever.pull'`). The grate animation is driven by the grate sector's `dynamic` data (`ceilOpen`, `openTime`, `ease`) through a generic engine "animate sector ceiling" call. `lever.pull` is registered from `game/js/quest/` and names its target by tag (`grate`), not by cell coordinates. Grate open/closed state is part of the serialized world state (US-025).
Design needed: no (uses US-011 lever + grate).
Notes / dependencies: US-010, US-011, US-012.

### US-015 Wake sequence + title card + control hints  [Priority: P0] [Status: todo]
As a player, I want to open my eyes on the tower floor, see the title, and get just enough hints, so that I understand the start without reading a manual.
Acceptance criteria – Designer:
- [x] `design/models/title.js`: `ASCII QUEST` logo, max 70x9 cells, colored (warm gold into ember orange), plus subtitle style for `The Awakening`. Preview in `design/preview/title.html`. (Preview verified in the browser: 6/6 checks.)

**PO APPROVED – design part (2026-09-22).** Status is now `todo` for the programmer. Reviewed by reading `design/models/title.js`:
- **Logo:** 68x8, within 70x9. It reads "ASCII QUEST" at 6-row block height, with 1-cell letter gaps and a 3-cell word gap.
- **Colors:** gold-white to gold to flame to ember rows, an ember drop shadow only on empty cells, and the brass `<[ * ]>` flourish. The shine sweep (2.2 s) makes the 3 s hold feel alive without moving the layout.
- **Subtitle:** `The Awakening`, letter-spaced, with brass brackets.
- **`ASSETS.uiStyle` matches the stories:**
  - US-015: the hint texts and triggers, fade 0.3 s in / 0.5 s out, 8 s timeout, and the 1.5 s eyelid curve with one half-close.
  - US-012: crosshair dim to gold, and a prompt with a gold `[E]`.
  - US-017: the end-text lines, 30 cps, the `- to be continued -` delay of 1.5 s, and the beacon-lit variant (D-003).
  - US-005: `Click to resume`.
  - All text is ASCII 32-126.
- **Fade rule:** fades step down the glyph ramp (letters count as ramp index 9) instead of using alpha. This fits the style guide, and US-017 reuses it.
- **Verified in the browser (coordinator, 2026-09-22):** `design/preview/title.html` renders with no console errors and 6/6 checks pass. The render check pending on this approval is closed.

Acceptance criteria – Programmer:
- [ ] (added on design review) All UI is drawn from `ASSETS.models.title` / `subtitle` / `ASSETS.uiStyle`: layout (logo top row 18, centred), colors, hint plate (scene bg x 0.35, no box), `> ` prefix, gold key words, and the ramp-step fade rule. Texts are not hard-coded in engine code; they come from `uiStyle`. UI cells are emissive (unlit, no fog).
- [ ] (added on design review) Title shine band per `title.shine` during the hold. The eyelid follows `uiStyle.blink.curve`, with the ember edge row.
- [ ] Start: screen black 1.0 s, then eye-blink reveal (rows open from the centre line outward over 1.5 s, with one half-close blink).
- [ ] Camera starts lying (eye height 0.3 m, pitched up toward the sun shaft), rises to 1.60 m over 1.2 s; player input is ignored until the rise ends.
- [ ] Title card fades in 1 s, holds 3 s, fades out 1 s, drawn over the 3D view.
- [ ] Hints bottom-left, fade in 0.3 s, each shown once, disappears when performed or after 8 s: `WASD move - Mouse look` (after title; all UI text is ASCII 32-126 only), `Shift run` (after 10 s of walking), `[Space] Jump` (when within 2 m of the gap edge), `Click to capture mouse` (if pointer not locked).
- [ ] Interact prompts from US-012 are not hints; they always show when targeting.
- [ ] (D-006 / D-008) The wake sequence, title card and hint logic live in `game/js/quest/`. They use the engine's generic overlay primitives (`engine/ui/`: fade, hint, prompt, text), skinned by `uiStyle`. The start pose comes from `def.start` (`pose: 'lying'`, `eyeH`, `pitchDeg`). Hint trigger zones (e.g. the gap-edge `[Space] Jump` zone) are declared in level data, not as coordinates in code.
Design needed: yes – title logo.
Notes / dependencies: US-010, US-012.
Designer note (2026-09-22): **Preview ready for PO review.**
- **Where:** `design/preview/title.html`. A 160x60 mock plays the full start sequence: black 1.0 s, blink with the half-close, title fade in 1 s / hold 3 s with shine / fade out 1 s, then the first hint. Buttons show all hints, the prompt with the active crosshair, the pause overlay, and both end-screen variants. It runs its own checks.
- **Data:** `design/models/title.js`, containing `ASSETS.models.title` (68x8 logo, gold-white > gold > flame > ember, top to bottom), `ASSETS.models.subtitle`, and `ASSETS.uiStyle` (fade rule, hint/prompt/crosshair/end/pause styling, eyelid curve). Format: `design/README.md` section 5.
- **Text:** all UI text is ASCII 32-126; the hint is exactly `WASD move - Mouse look`.
- Status stays `design`.

### US-016 Far overworld view through the breach  [Priority: P0] [Status: todo]
As a player, I want to see a vast, colorful landscape and a distant dark tower from the summit, so that I feel the world is huge and I want to go out there.
Acceptance criteria – Designer:
- [x] `design/levels/overworld_far.md` (+ data file if useful): a low-res heightmap (e.g. 128x128 or 256x256 cells, 8 m per cell) or a procedural recipe (seed + noise params) for rolling hills, a river, forests; color/glyph rules per terrain type (grass `" ' , ;` greens, forest `& % @` dark greens, river `~ -` blues, rock `# %` greys) and fog colors by distance (near 50 m to far 1500 m).
- [x] Position and silhouette of the distant second tower (~800 m, on a hill, dark, no light).
- [x] Mock-up in `design/preview/overworld.html` showing the intended view through the breach. (Data approved; browser render check pending, see the PO note.)

**PO APPROVED – design part (2026-09-22); the manager accepted it as the seed of the world terrain recipe (D-008).** Reviewed by reading `design/levels/overworld_far.md` / `.js`:
- **Recipe:** seeded 7331, 256x256 at 8 m, in the same world axes as the tower, with the tower at (1480, 1018).
- **Terrain:** the hilltop matches the tower's 2.4 m grass ring (1.8 m residual, fixed to 0 by US-016b), with rolling hills, a meandering river with a valley, western ridges, a path down to a ford, and slope-based rock and forest.
- **Look:** glyph/color rules per terrain type and per near/mid/far band, using palette keys only. Fog runs 50 to 1500 m from `fogFarNear` to `fogFar` = `skyHorizon`, so there is no seam with the sky.
- **Far tower:** 800 m at azimuth 255, 15 degrees left of centre, framed by the breach, and breaking the skyline. It is darker than every terrain color, unlit, not emissive, with fog capped at 0.40 so it stays a readable dark notch. It uses a 3x4 minimum sprite with the notch of its cold bowl. This serves the M1 hook well.
- **Budget:** about 42k samples, within budget.
- **Pending:** a browser check of `design/preview/overworld.html` (renders, no console errors, 10/10 checks). If the preview is broken, the designer fixes the preview only.

Acceptance criteria – Programmer (rewritten per D-007/D-008: engine terrain caster, far LOD):
- [ ] `engine/render/terrainCaster.js` (exported via `engine/index.js` as `castTerrain`) renders the world terrain from the injected terrain recipe (`AssetRegistry`, US-024) at **far LOD**: 8 m grid, 300-1500 m. For M1 it may also cover 0-300 m at 8 m spacing (near LOD is US-026). The far grid is baked once at load: height, type and lighting `b` per cell.
- [ ] Per column, it draws only inside the **open span** left by the sector caster (US-004 item: `[topRow, bottomRow, depth]`), and writes depth into the shared `DepthBuffer`. A small `engine/render/compositor.js` sequences the passes: sectors, then terrain, then sky fill for the rest of the span, then sprites (US-011), then UI. It never draws terrain over structure cells.
- [ ] Projection uses the same `horizonRow` / `focalRows` / y-shear as the sector caster. The horizon lines up at every pitch in the ±35 degree clamp (no seam or jump), and the terrain at the tower's outer ring meets the ring cells with no visible step once US-016b's blend lands.
- [ ] Look and fog exactly per `overworld_far.md` sections 3 and 4: type glyph bands by distance, sun N.L lighting from the level's sun, fog to `fogFar` with glyphs thinning to haze, and the river glint at 1.5 Hz.
- [ ] Far tower drawn per section 5 as a billboard at (713.8, 1232.1), depth-tested against the terrain, never smaller than the 3x4 minimum sprite, dark and unlit (fog cap 0.40), and unchanged by US-022.
- [ ] Cost: the terrain pass is <= 4 ms per frame on its own (target 2-3 ms per D-007) when looking out of the breach, and the total JS render stays within 8 ms (US-018).
Design needed: yes – far terrain data/recipe, colors, tower silhouette (delivered); follow-up US-016b.
Notes / dependencies: US-004 (DepthBuffer + open span), US-007 (sun), US-010, US-024 (engine layout, AssetRegistry), US-025 (World: terrain sampler, tower placement at recipe coords).

### US-016b Terrain recipe follow-up for the world model  [Priority: P0] [Status: design]
As a player, I want the land outside the tower to be one continuous world, so that it meets the tower seamlessly and can later be walked on.
Acceptance criteria – Designer (small, D-008):
- [ ] `heightAt(x, y)` and `typeAt(x, y)` are documented and implemented as continuous analytic functions usable at any sample spacing (2 m near, 8 m far), with the baked 8 m grid equal to sampling them.
- [ ] Near-LOD look spec for 2 m cells within 300 m, with glyph bands and colors extending the current near band, and a preview swatch.
- [ ] Flat 2.4 m crown radius covering the tower footprint and outcrop, plus the handover rule: within 6 m of a structure's outer ring, terrain height blends linearly to the ring height. The mismatch where the player can stand is exactly 0; the preview check shows max |delta| = 0.00 m along the ring.
- [ ] One-paragraph sketch of per-chunk overrides (height stamp, type paint) as JSON for the future editor.
Design needed: yes (recipe + doc + preview update).
Notes / dependencies: feeds US-025 (World terrain sampler) and US-026 (near LOD). Cosmetic for the M1 far view. The designer is already working on it.
Designer note (2026-09-22): **Preview ready for PO review.**
- **Where:** `design/preview/overworld.html`. A 160x60 heightmap-projection mock from the breach eye, with yaw, pitch, step-back, fog and glint controls. The near part samples the real `tower.js` sectors. The page also shows the top-down map with the view cone and towers, terrain swatches by distance, the far-tower silhouette and automated checks.
- **Data:** `design/levels/overworld_far.js` (seeded recipe plus reference `generate()`, 256x256 x 8 m). Doc: `design/levels/overworld_far.md`.
- **Content:**
  - A river valley about 450 m W, rolling hills and forests, and a path to a ford.
  - Fog uses palette `fog.far` (50 to 1500 m) into `skyHorizon`.
  - The far tower is 800 m WSW on a hill crown. It is dark, unlit and not emissive, with fog capped at 0.40, and it breaks the skyline. It is drawn no smaller than a 3x4 silhouette.
- Status stays `design`.

### US-017 End trigger, fade and restart  [Priority: P0] [Status: todo]
As a player, I want a satisfying ending when I step out onto the hill, so that the slice feels complete.
Acceptance criteria:
- [ ] Entering the outcrop trigger cells locks input; the camera walks forward 1 m over 1.5 s and pitches slightly down toward the valley.
- [ ] Screen fades to black over 2 s (glyphs dim down the ramp, not just an overlay alpha). Use the `ASSETS.uiStyle.fade` rule (US-015 art) for both the 3D view and the text. End-text layout, colors and blinking cursor come from `uiStyle.endText`.
- [ ] Text, centred, typed on at 30 chars/s. First line depends on the beacon state (D-003): unlit (default, and always if US-022 is not built) = `The beacons are dark.`; lit = `One beacon burns. The others are dark.`. Then `The world waits.`, then after 1.5 s `- to be continued -`, then `[R] Wake again`.
- [ ] R restarts the slice from the wake sequence with all state reset (lantern on hook, boulder on stair, lever up, grate down, beacon unlit, hints reset).
- [ ] (D-006 / D-008) The end trigger is the `def.triggers` entry `end` (cells tagged `trigger:end`, `walkTo`, `pitchTo`) with behaviour `quest.end`, registered from `game/js/quest/`. Restart = reload the world from the level data + `deserialize` of the initial state (US-025), not a hand-written reset list, so nothing can be forgotten.
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
- [ ] Pressing E ignites the bowl: flames grow from 0 to full over 1.0 s using the delivered `beaconFire` model (3 brazier flame units, 10 fps) and its `grow` rule (`design/README.md` section 4). The fire is anchored at `beaconBowl.mounts.fire`, and flame cells are emissive.
- [ ] A new point light starts at the bowl centre (about 0.8 m above the ash): warm orange (brazier `#ff9a3c` family), intensity ramps 0 to 1.0 over 1.0 s, radius 12 m target, same flicker model as the brazier (8-12 Hz, ±15%).
- [ ] Performance: at the summit view (looking out the breach with the beacon lit) the US-018 budget holds (>= 58 fps). If not, reduce the beacon radius (minimum 8 m) until it does; the feature is never cut for performance. The final radius is recorded in the tuning config.
- [ ] The lantern is not consumed: the player keeps it and its light after lighting the beacon.
- [ ] One-way: once lit, the bowl shows no prompt and stays lit until restart.
- [ ] Optional: the breach end trigger (US-017) works whether or not the beacon is lit; end text uses the lit variant `One beacon burns. The others are dark.` only when lit.
- [ ] The distant second tower (US-016) stays dark after lighting; nothing in the far view changes.
- [ ] Restart (R) resets the beacon to unlit.
Design needed: no new story – designer confirms the brazier flame frames scale to the 12x4 bowl (D-003).
Notes / dependencies: US-011, US-012, US-016, US-017, US-018. Picked up only after every P0 story is `done`. Not an M1 exit criterion.

### US-023 See-through grate (masked walls)  [Priority: P2] [Status: todo]
As a player, I want to see the upper stair through the bars of the grate, so that the portcullis looks like real ironwork and hints at the way up.
Acceptance criteria:
- [ ] Wall texels flagged `hole: true` in a material (the `grate` material) are transparent. The ray continues behind the masked face, and the geometry and sky behind it are drawn through the gaps.
- [ ] Works while the grate animates (US-014): the masked face shrinks as `ceilH` rises, with no tearing at the moving edge.
- [ ] Sprites behind the grate are occluded only by the bar texels, not by the gaps.
- [ ] Cost: at most 0.5 ms extra per frame when the grate fills the view; US-018 still holds.
Design needed: no (the `grate` material with `hole` texels was delivered with US-011).
Notes / dependencies: US-004, US-011, US-014. Picked up only after every P0 story is `done`. Not an M1 exit criterion. Until then the M1 fallback draws the gaps dark (US-011).

### US-024 Engine/game split (D-006)  [Priority: P0] [Status: todo]
As a player (and as the future editor's first user), I want the engine to be a clean, reusable library underneath the game, so that the world can grow and an editor can later build on it without rewrites.
Acceptance criteria:
- [ ] **Layout per D-006:** `engine/{core,render,world,physics,entities,ui}/`, `game/{index.html, world-test.html, js/main.js, js/quest/}`, `design/` unchanged, and `tools/check-deps.mjs`. Everything built so far is moved (git-less: move plus fixed imports):
  - RenderTarget*, CellBuffer, glyphMetrics, DepthBuffer, the US-004 caster as `sectorCaster.js`
  - loop, input
  - Level.js (plus `MAP_FORMAT.md` next to it)
  - debugOverlay
  - US-008 physics
  - `test_room` moves to `design/levels/` or `engine/world/testdata/`. PO preference: `design/levels/test_room.js` as a content-pack level. It must stay loadable.
  - Nothing engine-level stays under `game/js/` (only `main.js` and `quest/`).
- [ ] **Public API:** `engine/index.js` is the only public entry. It re-exports the D-006 rule 5 API:
  - `createEngine({ canvas, assets, cols, rows })` returns `{ renderTarget, world, input, loop, camera, events }`
  - `AssetRegistry`, `loadLevel`, `World` (a stub until US-025), `castSectors`
  - `castTerrain` and `drawSprites` stubs (throw "not implemented" until US-016 / US-011), `drawText`
  - `moveCapsule`, `moveSphere`, `integrate`, `Entity`, `Camera`, and `serialize` / `deserialize` stubs (US-025)
  - `game/` imports only from `engine/index.js`, never from deep engine paths.
- [ ] **No globals in the engine:**
  - `engine/` never reads `window.ASSETS` (or any `window.*` other than DOM/timing APIs it needs: `requestAnimationFrame`, `devicePixelRatio`, events).
  - `game/js/main.js` builds `new AssetRegistry({ palette, models, levels, terrain })` from the `design/` classic-script globals and passes it in.
  - `AssetRegistry` documents the palette, model, level and terrain-recipe shapes as JSDoc typedefs (`engine/core/assets.js`) and throws a clear error for an unknown key.
- [ ] **`tools/check-deps.mjs`** (Node, no dependencies, run manually: `node tools/check-deps.mjs`):
  - Scans `engine/**/*.js` imports and exits non-zero, listing file and line, if any import resolves outside `engine/`.
  - Also flags `window.ASSETS` inside `engine/`.
  - Reports OK on the moved codebase. The tester runs it for every later story.
- [ ] **Nothing regresses:**
  - `game/index.html` (default, `?debug=1`, `?bench=1`, `?glyphs=1`, `?shadetest=1`, `?force2d=1`, `?demo=1`) and `game/world-test.html` work as before.
  - `?level=test_room` still loads.
  - The US-004 view looks pixel-identical before and after the move (screenshot compare at the same camera).
  - No console errors. `?bench=1` numbers are unchanged within noise.
- [ ] Docs: a short `engine/README.md` (purpose, folder map, public API list, "engine never imports game/design" rule, how to run `check-deps`). `CLAUDE.md` layout section updated. Coordinate that edit with the manager, since CLAUDE.md is project instructions.
Design needed: no.
Notes / dependencies: after US-004 and US-008 reach `po-review`, before US-006 starts (D-006 rule 6). New files created before then should already go to the new paths. The designer's previews must keep working; they load `design/*.js` directly and do not depend on the engine.

### US-025 World model: terrain + placed structures in one world frame (D-007)  [Priority: P0] [Status: todo]
As a player, I want the tower to stand on a real hill in a real world, so that what I see from the breach is the same world I will later walk into.
Acceptance criteria:
- [ ] **`engine/world/Terrain.js`:** a sampler over the injected terrain recipe (`AssetRegistry.terrain`, from `design/levels/overworld_far.js` plus US-016b).
  - `heightAt(x, y)` is bilinear on the baked grid for the far LOD and analytic for near queries; `typeAt(x, y)`.
  - The far 8 m grid (256x256) is baked once at load, in <= 150 ms.
  - Near chunks: 64x64 cells of 2 m (128 m), generated deterministically on demand. A **3x3 chunk cache** around the player is kept resident; moving one chunk regenerates only the new row/column (<= 5 ms per chunk, off the frame budget, or amortised over frames).
  - The same seed always gives bit-identical heights.
- [ ] **`engine/world/World.js`:**
  - `World.load(worldDef)`, where `worldDef` = `{ terrain: recipeKey, structures: [{ level: key, origin: {x, y, z}, yawSteps }], entities: [...] }`.
  - `placeStructure(levelDef, origin)` (yawSteps 0 only in M1; others may throw "not in M1").
  - World-coordinate queries `sectorAt(x, y)`, `floorAt(x, y)`, `heightAt(x, y)`, `outsideSector(x, y)`: inside a structure footprint the structure answers; outside it the terrain answers as a walkable floor at terrain height.
  - The US-004 caster and US-008 physics run unchanged against `World`, via the origin offset and the world query (US-004/008 D-008 items).
- [ ] **The tower is placed at recipe coordinates (1480, 1018, z = terrain crown).** `game/js/main.js` builds the world from a small world definition in `design/` (e.g. `design/levels/world_m1.js`: terrain `overworld_far` + tower at (1480, 1018)).
  - Camera and player live in world coordinates. The start pose is `def.start` offset by the origin.
  - The debug overlay shows world x, y, z plus structure id and sector char.
- [ ] **Entities** (`engine/entities/Entity.js`): plain-data `{ id, type, transform: {x, y, z, yawDeg, pitchDeg}, components: {...} }` with no class instances in state. The player, the boulder, and the prop state (lantern taken, lever progress, grate open, beacon lit) are entities or world state.
- [ ] **`engine/world/serialize.js`:** `serialize(world)` returns a JSON-safe object, and `deserialize(json)` restores the world. Round-trip test (console or `?serializetest=1`): serialize, go through `JSON.stringify` and `JSON.parse`, deserialize, then serialize again, and the result is deep-equal to the first. Positions are exact. Covers terrain seed + overrides, structures + origins, and entity state including grate `ceilH` and the boulder position. US-017 restart uses it.
- [ ] **Performance:** world queries are O(1) (grid lookup, structure bounding-box test first), with no allocation per query. US-018 budget unchanged.
- [ ] `node tools/check-deps.mjs` is OK. Only `game/js/main.js` knows the tower or its coordinates, and it reads them from data.
Design needed: minor. The designer supplies `design/levels/world_m1.js` (world definition) and US-016b (continuous `heightAt`/`typeAt`, handover blend).
Notes / dependencies: US-024; US-016b (for exact-0 seam; M1 can start with the 1.8 m residual, as it is cosmetic in the far view). Unblocks US-006 onward in world coordinates, US-016 programmer, US-017 restart, and M2 US-026.

---

## Milestone 2 "First Steps" – sketches (not yet refined; not M1 scope)

### US-026 Walk out onto the terrain: near LOD, slope physics, chunk regeneration  [Priority: P0 (M2)] [Status: todo]
As a player, I want to step out of the breach and keep walking down the hill, so that the open world is really open.
Acceptance criteria (sketch):
- [ ] `terrainCaster` near LOD: 2 m cells within ~300 m with distance-scaled step LOD, the US-016b near look, no seam with the 8 m far LOD (same function), and the combined terrain pass <= 3 ms.
- [ ] `engine/physics/terrainCollide.js`: capsule and sphere stand on bilinear terrain height. Slopes up to 50 degrees are walkable; steeper slopes make you slide. The structure-to-terrain handover at the tower ring has no bump (US-016b blend = 0).
- [ ] Chunk regeneration as the player moves (3x3 resident) with no frame hitch above 25 ms.
- [ ] The M1 end trigger is replaced (M2 flag) by a seamless walk-out. The M1 fade stays available behind a flag for the M1 build.
- [ ] Terrain lighting: ambient + sun N.L from grid normals; point lights within radius; no terrain shadow rays.
Design needed: yes (US-016b near look; walkable path detail near the tower).
Notes / dependencies: US-025, US-016b, US-016.

### US-027 JSON content packs and world files  [Priority: P1 (M2)] [Status: todo]
As a (future) level designer using the editor, I want all content to load from JSON files, so that I can edit the world without touching code.
Acceptance criteria (sketch):
- [ ] `tools/export-content.mjs` (Node): exports the `design/` classic-script data (palette, models, levels, terrain recipe parameters, world definition) to `content/*.json`. The functions in the palette `util` and in the terrain recipe are engine-side implementations selected by name and version, not serialized code.
- [ ] `AssetRegistry.fromJSON(urls)` loads a content pack via `fetch`. `game/index.html?content=json` runs the full M1 slice from JSON, identical to the script path.
- [ ] World files: `World.load` accepts a world JSON (`structures`, `entities`, terrain overrides as per-chunk deltas per US-016b), and save games reuse `serialize` output.
- [ ] Schema version field plus a clear error for unknown or old versions.
Design needed: no (the designer keeps authoring in `design/`; export is a tool).
Notes / dependencies: US-024, US-025. Editor prerequisite (M5).
