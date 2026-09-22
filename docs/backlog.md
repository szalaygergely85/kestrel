# ASCII Quest – Product Backlog

Owner: Product Owner. Last updated: 2026-09-22.
Statuses: `todo | design | dev | po-review | testing | done`. Numbers and layout details: see `docs/game-design.md` section 5 and 7.

## Build order – Milestone 1 "The Awakening"

| Order | ID | Title | Priority | Status | Who picks up |
|---|---|---|---|---|---|
| 1 | US-001 | Char-grid canvas + game loop | P0 | done (tester PASS 2026-09-22; real-Chrome bench numbers still pending from user, non-blocking) | Programmer moves on |
| 2 | US-002 | Master palette, glyph ramps, stone/wood/iron/sky materials | P0 | done | PO approved 2026-09-22; designer moves on to US-010 then US-011 |
| 3 | US-003 | Sector map format + test room loader | P0 | done | Tested 2026-09-22 (PASS, `docs/test-reports/US-003.md`) |
| 4 | US-004 | Sector caster: walls, floors, ceilings, sky, y-shear (+ DepthBuffer, open span, origin offset per D-008) | P0 | done (Tester PASS 2026-09-22, docs/test-reports/US-004.md; 2 ASK ARCHITECT items still open: hot-loop allocations, frame budget) | Architect review before US-006/US-016 |
| 5 | US-008 | Physics: player capsule, gravity, walk/run, collision (+ out-of-grid world query per D-008) | P0 | dev (PO REJECT #1: wall-slide float stick + 4-side slide tests) | Programmer #2 NOW (small rework) |
| 6 | US-024 | **Engine/game split (D-006)** | P0 | todo | Programmer, when US-004 + US-008 reach `po-review`; before US-006 |
| 7 | US-025 | **World model: terrain + placed structures (D-007)** | P0 | todo | Programmer after US-024; designer supplies `world_m1.js` + US-016b |
| 8 | US-016b | Terrain recipe follow-up (analytic heightAt/typeAt, near look, crown + 6 m blend, overrides sketch) | P0 | done | PO approved 2026-09-22 (previews 17/17 + 18/18) |
| 9 | US-005 | First-person camera controls (keyboard + mouse) | P0 | po-review | Programmer (can run alongside; new files go to `engine/`) |
| 10 | US-006 | Lighting: ambient + point lights with flicker | P0 | todo | Programmer, after US-025 |
| 11 | US-007 | Lighting: sun directional light with shaft shadow | P0 | todo | Programmer |
| 12 | US-009 | Physics: jump, step-up, landing feel | P0 | todo | Programmer |
| 13 | US-010 | Tower layout: 3 levels as sector data | P0 | todo | Design PO-approved; integration = load `design/levels/tower.js` via AssetRegistry, place in world (after US-025). Designer adds `interactables` + hint zones |
| 14 | US-011 | Billboard props + prop art | P0 | todo | Art PO-approved; Programmer after US-006 (`engine/render/sprites.js`) |
| 15 | US-012 | Interaction system + lantern pickup (carried light) | P0 | todo | Programmer |
| 16 | US-013 | Rolling boulder | P0 | todo | Programmer |
| 17 | US-014 | Lever opens the grate | P0 | todo | Programmer |
| 18 | US-015 | Wake sequence + title card + control hints | P0 | todo | Art PO-approved, preview verified 6/6; Programmer after US-010 + US-012 |
| 19 | US-016 | Far overworld view = engine terrain caster, far LOD | P0 | todo | Design PO-approved 2026-09-22 (preview verified 17/17); Programmer after US-025 + US-007 |
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

### US-004 Sector raycaster: walls, floors, ceilings, sky, y-shear  [Priority: P0] [Status: done]
As a player, I want to see the room in first-person 3D made of characters, so that I feel present in the space.
Acceptance criteria:
- [x] One ray per screen column (160); walls drawn with correct perspective, including partial walls (step fronts, ledge fronts, pillars) where floor/ceiling heights change between sectors.
- [x] Floors and ceilings are cast per cell row with their materials; `"sky"` ceilings show a vertical gradient (palette sky colors) instead of geometry.
- [x] Looking through a lower wall onto a higher floor behind it works (e.g. the top of the staircase and the 1.0 m platform are visible from the ground).
- [x] Shading follows the US-002 pipeline (`design/README.md` 1.6-1.8). In this story L = ambient only; US-006/007 add lights.
  - Brightness picks the glyph from the material ramp; the bg rule and interior fog (12/60 m) are applied.
  - The engine may re-implement `util.shade` with lookup tables or inlined math, but for a set of 5 reference cells (stone, stone_moss near the floor, floor, iron, sky) its glyph must equal `P.util.shade` / `shadeSky` output, with fg/bg within ±4 per channel. Provide a `?shadetest=1` console check that prints the comparison.
- [x] Texture sampling per README 1.6. Walls: u = along-wall meters (continuous across cells), v = world height, v grows upward. Floors and ceilings: world x, y.
- [x] Texture fade by camera distance (`material.textureFade`), so textures do not shimmer in the distance.
- [x] The wall hit height above that sector's floor is passed as `z` for `tintBand`: moss/soot stays near each floor (visible on a `stone_moss` test wall in `test_room`: full tint below 1.0 m, none above 2.2 m).
- [x] Emissive cells: `"sky"` ceilings and out-of-map views use `shadeSky` (azimuth/elevation) and ignore lighting and fog. The engine supports a per-cell emissive flag that later passes (US-011 flames, US-022 beacon) can set.
- [x] Pitch via y-shear, clamped to ±35 degrees; horizon line moves with pitch; no geometry tearing at the clamp.
- [x] Field of view 75 degrees horizontal, correct for the 160x60 grid and cell aspect (a square pillar looks square).
- [x] No fisheye distortion (perpendicular distance correction).
- [x] 60 fps on `test_room` with the F3 overlay (render <= 8 ms). The 8 ms budget is binding for the JS raycast + shading; the GPU present is extra (D-005). Measured (this session's sandbox only, see notes below): `castScene` avg ~6.5-7.3 ms.
- [x] (D-005) Cells are written through the allocation-free `RenderTarget.setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2)` (glyphIdx = ASCII code - 32). No hex strings, no per-cell object or array allocation in the hot loop; `setCell` with hex is only for UI and debug text.
- [x] (carried over from the US-001 review) The `CellBuffer` hex color cache is bounded (e.g. at most 1024 entries, cleared or LRU when full), so `setCell` with many unique hex strings cannot grow memory without limit. The default page no longer runs the US-001 demo scene; it stays reachable with `?demo=1`.
- [x] (MAP_FORMAT v2) Solid cells are drawn as columns up to their `floorH` (wall top), with a lit top face in `floorMat`, and rays continue above them. In `test_room` the sky is visible over the 1.0 m low wall (verified visually - screenshot showed the low wall's top face and open sky beyond it). The tower doesn't exist yet (US-010/US-024+), so that half is unverified but uses the same code path.
- [x] (MAP_FORMAT v2) Non-solid cells with a numeric `ceilH` draw their upper face from `ceilH` to `topH`, using `upperMat` if set, else `wallMat`. Step and ledge fronts use the higher sector's `wallMat`. (The lintel cell's geometry is exercised by the same code path as the general ceiling-height-difference case; not separately screenshot-verified given ambient-only lighting makes stone-vs-stone contrast hard to eyeball - the `D` marker geometry logic was checked by code review and the DDA step trace during debugging.)
- [x] (D-008 #1) **DepthBuffer:** `game/js/render/DepthBuffer.js` (new), a `Float32Array(cols*rows)` cleared to `Infinity`. `castScene` writes distance into it at every `writeShadeOut` call (alongside `setCellRGB`), including a `Infinity` sentinel for sky (no finite depth). Allocation-free (the buffer is created once in `main.js` and reused every frame).
- [x] (D-008 #2) **Open span per column:** implemented via `opts.skyFallback` (default false/unresolved). When false, `castScene` returns `{ openSpans: [{x, topRow, bottomRow, depth}, ...] }` for columns whose ray left the grid or exhausted its step budget, instead of painting sky. `game/js/main.js` passes `skyFallback: true` for `test_room` (no compositor/terrain pass exists yet), restoring the original stand-alone look. **Deviation from the letter of the spec:** `openSpans` is a plain array of small objects, not typed arrays - this is once-per-COLUMN (not per-cell), so worst case 160 small allocations/frame, not the 9600-cell hot path `setCellRGB` already keeps allocation-free. Flagging this so the PO/manager can decide if it needs tightening before US-016 consumes it.
- [x] (D-008 #3) **Level origin offset:** `castScene(rt, level, camera, palette, { origin: {x,y,z} })` - camera position is translated to the level's local frame once at the top of the function; all `sectorAt`/`floorAt` queries and projection math use local coordinates, so distance (and the DepthBuffer) is unaffected by translation. Verified two ways: (a) a `?origin=1480,1018` query-string switch on the game page itself (shifts the camera by the same offset; the debug camera keeps moving/colliding in local coordinates, only the world-frame handoff to `castScene` changes) - confirmed byte-identical `CellBuffer.glyphIdx` output vs `?origin` absent; (b) an equivalent direct console check during development.
Design needed: no (consumes US-002).
Notes / dependencies: US-001 (rework #2, WebGL2 back-end + `setCellRGB`), US-003 (format v2).

**PO OK (2026-09-22) – US-004 ready for testing** (commit 35b575c). I reviewed against the criteria and the programmer's verification notes, spot-reading `raycaster.js` for structure. Deep code review is for the architect (see below).
- All criteria are met or verified by the programmer:
  - the DDA with perpendicular distance (no fisheye), 75 degree FOV, y-shear clamped at ±35;
  - portal-style narrowing open spans (see over low walls and steps), solid-cell columns with top faces, and `topH`/`upperMat` upper faces;
  - step fronts use the higher sector's `wallMat`, and `tintBand` z is taken from the standing floor;
  - `shadeSky` for sky, `?shadetest=1` all pass, `setCellRGB` only, the color cache bounded at 1024 FIFO, and the demo moved to `?demo=1`;
  - DepthBuffer, per-column open span, and origin offset with `?origin=X,Y`.
  - The overdraw bug the programmer found and fixed (boundary rows shaded 2-4x) was a good catch.
- **Waived: the per-cell emissive flag.** The architecture turned out simpler than I assumed: every pass decides emissive at shading time (sky via `shadeSky` here, flames via `shadeSprite(..., emissive=true)` in US-011). No pass re-lights the framebuffer afterwards, so a stored flag has no reader. The criterion is covered by US-011's emissive criterion.
- **Accepted deviation, provisional:** `openSpans` is an array of up to 160 small objects per frame instead of typed arrays. It must become typed arrays (e.g. `Int16Array` top/bottom plus `Float32Array` depth, reused) no later than US-016, which is its consumer. That criterion is now on US-016.
- **Tester notes:**
  - Walk `test_room` with `?debug=1`: stair fronts, the 1.0 m platform top from the ground, pillar squareness, the low wall with sky beyond, moss only below about 1-2 m on the `m` stub, and sky through the `^` region.
  - Pitch to ±35 with no tearing; `?origin=1480,1018` gives an identical image; run `?shadetest=1`, `?bench=1`, `?glyphs=1`, `?force2d=1`; no console errors.
  - The lintel `D` is hard to see with ambient-only light. Verify it if possible (look for the 0.8 m band above the opening, which uses `upperMat`), otherwise mark it "deferred to US-006 test". That alone is not a FAIL.
- **ASK ARCHITECT (both before US-006 / US-016 start):**
  1. **Hot-loop allocations.** `ddaStep()` returns a `{ side, perpDist }` object per DDA step, and exits and spans are objects. Per frame that is likely thousands of short-lived objects. The criterion says no per-cell allocation; this is per step, not per cell, but US-018 requires no GC stutter. Does V8 escape analysis reliably remove these, or should they become out-params or reused scratch now, while the code is small?
  2. **Frame budget.** `castScene` is 6.5-7.3 ms in the sandbox with **ambient-only** light. D-007 budgets sectors at 2-3 ms, and US-006/007 (point lights, sun shadow rays), US-016 (terrain 2-3 ms) and US-011 (sprites 1 ms) still have to fit in 8 ms total. Is the sandbox inflating pure-JS timing (as it did for Canvas2D in US-001), or is there real headroom to find (e.g. per-row floor casting vs per-cell `util.shade` calls, LUT shading instead of the reference shader)? Please give a profiling verdict and, if needed, an optimisation story before lighting lands. If US-006/007 would push us over 8 ms, that is a scope/architecture question for the manager.

**Programmer notes (2026-09-22):**
- Files: `game/js/render/raycaster.js` (new, the caster itself), `game/js/render/DepthBuffer.js` (new), `game/js/render/shadeTest.js` (new, `?shadetest=1`), `game/js/engine/debugCamera.js` (new, minimal noclip-with-collision test camera per the coordinator's "US-005 not needed yet, minimal debug camera is fine"), `game/js/render/CellBuffer.js` (bounded color cache, 1024 entries, FIFO eviction), `game/js/main.js` (wires `raycast` as the new default mode; `?demo=1`/`?glyphs=1`/`?bench=1`/`?shadetest=1`/`?force2d=1`/`?origin=` all still work; `?debug=1` overlay now also shows camera pos/yaw/pitch). Did not touch `game/js/world/**` (Level.js, test_room.js) - read-only consumer of its query API as instructed.
- **Algorithm**: classic Lodev-style camera-plane DDA for the horizontal cast (fisheye-free by construction via perpendicular distance), combined with a Doom/Build-style narrowing "open vertical span" (`openTop`/`openBottom` per column) so nearer geometry (walls, step risers, lintel faces, solid-column tops) correctly occludes farther floor/ceiling/sky content - this is what makes "see over a low wall into the sky" and "see the lintel opening" work without special-casing either.
- **A real double-shading bug found and fixed during this story** (not present in the original design, introduced while building this): adjacent floor/ceiling segments both inclusively claimed their shared distance-boundary row, and separately, a ceiling segment transitioning into a sky segment could have both segments' clamped ranges include the same near-screen-edge rows - up to 40% of cells were being shaded 2-4x (verified via a call-count audit harness), costing several extra ms/frame and, in the sky/ceiling case, an actual visual correctness bug (the farther/wrong content could overwrite the nearer/correct content). Fixed with (a) a consistent near-inclusive/far-exclusive rule for adjacent plane segments, and (b) a `ceilingFilledTo` high-water-mark that stops a farther ceiling/sky segment from redrawing rows a nearer one already claimed. Left a comment trail in `raycaster.js` explaining both.
- **Shading** calls `window.ASSETS.palette.util.shade`/`shadeSky` directly (not a re-implementation), so `?shadetest=1`'s comparison is exact-equality by construction today; it exists to catch drift if the engine is later optimized for speed (README 1.7 note 5 allows this). The palette itself is read exactly once, in `main.js`, and passed into every `castScene` call as a plain parameter - `raycaster.js` never touches `window.ASSETS` itself, per D-008's "no new global reads, keep them isolated" note (ready for US-024's `AssetRegistry` injection).
- **Performance** (this sandboxed browser-automation session only - see the extensive US-001 rework notes above for why I don't trust this environment's absolute numbers, though relative before/after comparisons within it are meaningful): isolated `castScene` calls average ~6.5-7.3 ms across repeated runs at a small viewport in this tool (with individual-run outliers up to ~11-13 ms, consistent with the noisy JIT/GC behavior seen throughout this project's measurements here). This is under the story's 8 ms budget but leaves limited headroom against D-007's later "sectors 2-3 ms" sub-budget once a terrain pass is added - flagging for US-016/US-018 rather than over-optimizing now against numbers I can't fully trust. The dominant remaining cost is the reference `shade()`/`shadeSky()` calls themselves (`Math.pow`, texel lookups) - straightforward to speed up later with LUTs per README 1.7 note 5 if needed.
- **Minimal debug camera** (`engine/debugCamera.js`, per the coordinator: US-005 isn't built yet): WASD moves relative to yaw with simple "don't walk into a solid cell" collision (queries `level.sectorAt` directly, not real physics), arrow keys look (yaw/pitch, clamped to ±35°), eye height follows the current sector's floor. Replace wholesale when US-005/US-008 land.
- **Known gap, not required by this story's acceptance criteria but worth flagging:** the lintel/doorway visual (`D` cell) wasn't independently screenshot-verified (ambient-only lighting - no point lights until US-006/007 - makes stone-on-stone contrast very hard to see by eye); its geometry uses the same "ceiling height difference at a boundary" code path as the general case, which *was* visually verified (low wall -> sky, floor steps). Recommend the tester re-check it once US-006 adds the torch light for better contrast.

**Architect answers (2026-09-22) to the two ASK ARCHITECT items.** Not blocking the current tester pass; they define follow-up story **US-004b** (below) which must be `done` before US-006 and US-016 start. Measurements: headless Node 24 (same V8 as Chrome) running `castScene` on `test_room` at 160x60, 300 frames per pose, 4 poses; details in `docs/architecture.md` section 12.
1. **Hot-loop allocations: do not rely on V8, make them scratch now.** `ddaStep()` is a closure created per column (160/frame, each with a context object) that returns a fresh `{side, perpDist}` per step; `castFloorCeiling`/`castPlane` return objects that are destructured. Escape analysis removes these only when the callee is inlined, and inlining depends on function size and warmth: `castColumn` is already large and will grow with lighting, so the guarantee will silently disappear exactly when US-018 measures. The fix is small while the code is ~400 lines: a module-level reused `ray` state object (`mapX, mapY, sideDistX/Y, deltaDistX/Y, stepX/Y, side, perpDist`) with `ddaStep(ray)` writing into it; `castPlane` returns `r1` (a number) and takes `r0` via the same scratch; `castFloorCeiling` writes `skyClosedTop`/`ceilingFilledTo` into a per-column scratch struct instead of returning `{}`. Rule recorded in `docs/architecture.md` section 9 (no per-step object returns, no closures in the column loop). `openSpans` becomes the `OpenSpans` typed struct (`Int16Array top/bottom`, `Float32Array depth`, reused) per the PO decision; the consumer API is in architecture.md section 8.
2. **Frame budget: the sandbox is not inflating; the cost is real and it is mostly waste.** Headless: avg 7.1-7.5 ms, p50 6.3-6.8 ms, p95 10.6-11.9 ms - matching the sandbox. Two findings:
   - **Overdraw 1.5-1.9x.** The caster writes 14,300-17,900 cells per 9,600-cell frame. (a) The solid-wall branch paints rows down to `openBottom` (= rows-1) over the floor rows the nearer segments already drew; capping at `Math.floor(rowAtHeight(ctx, nearSector.floorH, entryDist))` (mirroring the step-front branch's `r1`) removed ~2,300 writes/frame in my patched copy. (b) `castSkySegment` paints sky mid-column from `ceilTop` down to the near floor row, and every farther floor segment then repaints the lower rows. Sky must be painted once, at the end, into `[openTop, floorFilledTo-1]` (track a floor high-water mark like `ceilingFilledTo`), which is also exactly the compositor's `fillSky`. Target and acceptance: **exactly 9,600 cell writes per frame** on every pose (headless counter), pixel-identical output.
   - **The reference shader is ~0.42 us per call** (9,600 `shade()` calls = 3.9-4.3 ms, `shadeSky` 1.9 ms per 9,600): `materials[key]` lookup, two `Math.pow`, `smoothstep`, string `charAt` texel and ramp lookups, `Math.pow` fog. A fast path (materials resolved to records at `loadLevel`, `Uint8Array` texel grids, 256-entry LUTs for ramp/gamma/fog/fade, byte output) should land at ~0.1 us per cell, ~1 ms per frame, within the `?shadetest=1` tolerance that exists for exactly this purpose (README 1.7 note 5).
   - **Lighting (US-006/007) must not add per-cell shadow rays.** Per light: a 2D visibility grid over the structure recomputed only when the light moves (the lantern moves, but only within 5 m = 11x11 cells); sun: a per-cell sunlit mask computed once per level (sun fixed in M1) plus the hit-height test. Then lighting is ~N x 20 flops per cell, no grid walks.
   - **Verdict:** with overdraw at 1.0x and the fast shader, sectors ambient-only is ~2 ms and with 4 lights + sun ~3-3.5 ms. Total projected: sim 1 + sectors 3.5 + terrain 3 + sprites 1 + UI 0.5 = ~9 ms worst pose, ~7 ms typical - inside 8 ms only if every sub-budget holds. **Not an ESCALATE yet**; escalate to the manager if, after US-004b, `tools/bench-cast.mjs` shows sectors > 3.5 ms ambient-only, or US-006/007 add more than 1.5 ms. Scope levers if that happens, in order: 140x52 grid, terrain far LOD step growth, fewer point lights at the summit.
   - **US-004b "Sector caster: overdraw to 1.0x, allocation-free ray loop, fast shader, headless bench" (P0, before US-006/US-016; PO to write).** Acceptance sketch: (1) `tools/bench-cast.mjs` (Node, no deps) reports avg/p50/p95/max ms, cells written per frame and, with `--gc`, GC events for N frames at 4 fixed poses on `test_room`; (2) cells written per frame == cols*rows on all poses; (3) zero allocations per frame in `castScene` after warm-up (no scavenge in 600 frames under `--trace-gc`); (4) `OpenSpans` typed struct replaces the object array; (5) fast shading path with `?shadetest=1` extended to all materials x 8 distances x 4 heights, all within tolerance; (6) headless p50 <= 2.5 ms ambient-only on `test_room`, image checksum (`CellBuffer.glyphIdx`) identical to today's output before step 5 and within tolerance after it. Can be done under `game/js/render/` if it lands before US-024, or in `engine/render/sectorCaster.js` after; either way it is a pure refactor of one file plus the bench script.

### US-005 First-person camera controls  [Priority: P0] [Status: po-review]
As a player, I want to look around with the mouse and move with WASD, so that exploring feels natural.
Acceptance criteria:
- [x] Click on the canvas requests pointer lock; Esc releases it and shows a small "Click to resume" overlay.
- [x] Mouse yaw/pitch at 0.15 deg per pixel; pitch clamped ±35 degrees.
- [x] Arrow keys: yaw 120 deg/s, pitch 60 deg/s (fallback when pointer lock is unavailable).
- [x] WASD moves relative to yaw; diagonal movement is normalized (not faster).
- [x] Input module exposes `isDown(key)`, `pressed(key)` (edge-triggered once per sim step) and mouse delta; keys are released when the window loses focus.
- [x] In this story movement may be a simple noclip on the floor (physics comes in US-008).
Design needed: no.

**Programmer notes (2026-09-22):**
- Files: `game/js/engine/playerLook.js` (new - pointer lock request/state, mouse-look at 0.15 deg/px, arrow-key yaw/pitch fallback at 120/60 deg/s, pitch clamp ±35), `game/js/ui/pauseOverlay.js` (new - draws `ASSETS.uiStyle.pause` "Click to resume" with its plate, over the already-rendered scene, via `setCellRGB` only), `game/js/engine/input.js` (added `consumeMouseDelta()` - accumulates raw `movementX/Y` on `mousemove`, read-and-reset like `pressed`/`endFrame`; keys+mouse both cleared on window blur), `game/index.html` (added `design/models/title.js` as a classic script - it sets `ASSETS.uiStyle`, needed for the pause overlay text/plate; same load-order reasoning as `palette.js`), `game/js/main.js` (replaced `DebugCamera` with the real `Player` (`game/js/entities/Player.js`) + `PlayerLook`; deleted the now-superseded `game/js/engine/debugCamera.js`). Did not touch `game/js/physics/**` or `game/js/entities/**` - consumed `Player.update(dt, controls, level)`/`getEyeTransform()` exactly per the integration hook documented at the bottom of `Player.js`, and did not move any files (kept everything under `game/js/`, per this round's explicit "don't move files, US-024 comes after" instruction - even though an older note on this row says "new files go to `engine/`").
- **Movement**: `controls.forward`/`controls.strafe` are computed directly from WASD `isDown()` (`-1..1` per axis) and handed to `Player.update()`, which does the diagonal normalization and acceleration itself (verified: forward+strafe at yaw 90 converges to exactly 3.5 m/s, not 3.5*sqrt(2)). This is Player's existing "simple noclip on the floor" behavior (US-008/US-009 physics are being built elsewhere and not integrated here, per the coordinator).
- **Verification**: shadetest/bench/glyphs/demo/force2d/origin all re-checked working after the change. Arrow-key fallback rates (60 deg over 0.5 s at 120 deg/s; 30 deg over 0.5 s at 60 deg/s) and the pitch clamp (pushed past 35, landed exactly at 35) verified by direct `PlayerLook.update(dt)` calls with synthetic key events. Mouse-look math (yaw +15 deg / pitch +7.5 deg for a 100/-50 px synthetic `movementX/Y`, i.e. exactly *0.15) verified the same way with `look.locked` forced true.
- **Pointer lock could not be end-to-end verified in this sandboxed browser-automation pane**: `canvas.requestPointerLock()` here always rejects with `WrongDocumentError: The root document of this element is not valid for pointer lock` - a known restriction on iframe'd/embedded preview contexts, not a code issue (confirmed by calling it directly in the console, same error, independent of any of my code). Found and fixed a related real bug while investigating: the promise rejection (and, in some paths, a synchronous throw for the same condition) was going uncaught, spamming the console - `_onClick` now wraps the call in try/catch and attaches `.catch()` to the returned promise either way. **Recommend the tester re-verify actual pointer-lock acquisition and the Esc-releases-it path in a real top-level browser tab**, since that's exactly the case this sandbox can't exercise; everything downstream of "locked became true/false" (mouse-look math, overlay show/hide) is verified and was exercised by forcing `look.locked` directly.
- The "Click to resume" overlay is driven entirely by `!look.locked` (shown whenever not locked, including "never clicked yet" and "just pressed Esc") and re-drawn fresh every unlocked frame (after the scene, before `present()`), so it always reflects the current scene underneath rather than a stale one.
Notes / dependencies: US-004.

- **User check (2026-09-22, real Chrome tab):** pointer lock + Esc release confirmed working by the user. Covers the item the sandbox could not verify.

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
- [x] Fixed 60 Hz physics. Player is a vertical capsule, radius 0.30 m, height 1.70 m, eye 1.60 m.
- [x] Walk 3.5 m/s, run (Shift) 6.0 m/s, full speed in 0.10 s, stop in 0.08 s (GDD section 5).
- [ ] Collision vs solid cells and vs sector walls higher than the step threshold; sliding along walls when moving diagonally into them; never tunnelling through a 1-cell wall at run speed; never stuck on corners. (Sliding: see rework item 1.)
- [x] Gravity 20 m/s^2; walking off a ledge makes the player fall and land on the lower floor.
- [x] Head collision: cannot enter a sector whose `ceilH - floorH` is less than 1.70 m.
- [x] All values in one tuning config object (`game/js/physics/config.js` for now; moves to `engine/physics/config.js` in US-024).
- [ ] (D-008) **Out-of-grid world query:** every "is this passable / what is the floor here" answer comes from the passed-in `level`/`world` object (`sectorAt`, `floorAt`). There is no hard-coded "outside the grid = wall" branch in the physics code. Out-of-grid cells are answered by a query on the world object (e.g. `world.outsideSector(x, y)`), which returns a solid sector for M1's bare level, so later the terrain (US-025) can stand in without any physics change. Test: a stub world whose `outsideSector` returns a flat walkable floor lets the capsule walk off the grid edge.
Design needed: no.
Notes / dependencies: US-005.

**PO REJECT #1 (2026-09-22) – one blocking item, small.** I reviewed `capsule.js`, `config.js`, `Player.js`, `physics.test.js` and the `Level.js` addition.
- What passes: all tuning is in one config; accel and decel are derived exactly from it; free fall starts from the ledge with no snap-down; landing is correct; the closed grate is blocked by headroom; a step is 0.1 m at run speed against a 0.3 m radius, so no tunnelling.
- D-008 is done well: `sectorOrOutside()` gives `world.outsideSector()` with no hard-coded wall, and it is tested with an override.
- Step-up is grounded-only by construction, which already covers the US-009 no-bridging rule.

1. **Wall sliding can stick on two of the four wall orientations (floating point). Blocking.**
   - `resolveAxis` pushes the circle out to exactly `col + 1 + radius` or `row + 1 + radius` when the wall is on its west or north side.
   - On the next step, the overlap test measures `cx - (col + 1)`, which in floating point is often slightly less than 0.3. Example: `2.3 - 2 = 0.2999999999999998` in JS.
   - That counts as an overlap with `dx === 0` or `dy === 0` on the fixed axis, so the function returns `prevCoord`. The along-wall movement is cancelled and `blockedX`/`blockedY` zeroes the velocity: the player sticks to west and north walls while trying to slide along them.
   - East and south walls (`col - radius`, `row - radius`) round the safe way, which is why test 7 (a wall to the east) passes. Test 7's assertion `y > 2.0` after 1.5 s of running is also too weak to catch partial sticking.
   - **Fix:**
     - Resolve to the wall plus radius plus a small skin (e.g. `1e-6`), and/or treat `distSq >= r*r - 1e-9` as no overlap.
     - Never cancel the moving axis because of a cell that only touches on the other axis. When `dx === 0`, that cell is the other axis's business, so skip it rather than returning `prevCoord`.
   - **Tests to add to `physics.test.js`:**
     - (a) Slide along a wall on each of the **four** sides (N, E, S, W), at walk and run, with diagonal input (45 degrees into the wall) for 2 s. Tangential travel must be >= 95% of `speed * cos(45) * t`, and the distance to the wall must stay within [radius, radius + 0.01].
     - (b) Walking straight along a wall at 0.300001 m distance for 5 m never gets blocked.
     - (c) An **inner corner** (two walls meeting): pushing diagonally into it stops cleanly with no jitter over 60 steps (position change < 1e-6 per step), and backing out works immediately.
     - (d) An **outer corner** (the end of a 1-cell pillar): sliding along one face continues around the pillar end without catching.
     - (e) A 1000-step random-walk fuzz in `test_room` (fixed seed): the capsule never overlaps an impassable cell by more than 1e-6 and is never stuck (after 30 consecutive blocked steps with input, a reversed input must move it).
   - If (a) to (e) pass on the current code without a fix, report that and I will re-review. The requirement is the tests, not a particular fix.
2. (Non-blocking, moved to US-009.) Entering a cell whose `ceilH` is below the capsule's head (`footZ + height > ceilH`, e.g. jumping or stepping down under the `test_room` lintel from higher ground) is not checked; only the cell's own headroom is. It cannot happen in M1 without jumping, so it is added as a US-009 criterion.

For the tester (after rework): `node game/js/physics/physics.test.js` passes all tests. In `game/physics-test.html`, hug every wall of `test_room` in both directions, run into inner corners and around pillar `O` and the `m` stub, walk off the 1.0 m platform, step up the 0.3/0.6/0.9 stair, and fail to walk into the closed-headroom and low-wall cells.

### US-009 Physics: jump, step-up, landing feel  [Priority: P0] [Status: todo]
As a player, I want to climb stairs smoothly and jump gaps reliably, so that the climb is fun and not frustrating.
Acceptance criteria:
- [ ] Step-up: floors up to 0.45 m higher are climbed automatically; camera height smoothed over 0.1 s (no snapping) when stepping up or down.
- [ ] Jump on Space: initial velocity 6.5 m/s (apex about 1.05 m); only when grounded, with 100 ms coyote time and 100 ms jump buffer.
- [ ] Air control 35% of ground acceleration.
- [ ] Walking jump reliably clears the `test_room` 1-cell (1.0 m) gap onto a floor 0.3 m higher (10 of 10 tries, taking off anywhere within the last 0.3 m before the edge). Running jump clears the 2-cell (2.0 m) gap at equal height. (The 1 m grid makes gaps 1 m or 2 m; the tower gap is 1 m, PO decision on US-010.)
- [ ] (from the US-008 review) Head clearance on entry: a cell is passable only if `max(footZ, target floorH) + 1.70 <= target ceilH` (numeric ceilings). Jumping into the `test_room` lintel `D` from the side bonks (upward velocity killed, no clipping); walking under it from floor level works.
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
- **Data update accepted (2026-09-22, with US-016b):**
  - Legend `,` is raised from 1.0 to 2.4 m (uniform outer ring for the terrain handover; unreachable cells).
  - `def.interactables` added:
    - `lantern` (`lantern.take`)
    - `lever` (`lever.pull`, targets the grate by tag)
    - `beacon` (`beacon.light`, `requires: 'lantern'`, optional, `once`)
  - Props are linked by id. `def.triggers` has `end` (`quest.end`, cells plus `walkTo`/`pitchTo`) and `hintJump` (`hint.show`: circle r 2 m around the gap edge, fires only with the feet >= 2.0 m, once).
  - This satisfies the designer half of the D-006/D-008 data criterion above. Preview checks: 18/18.

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
- [ ] (D-006 / D-008) The wake sequence, title card and hint logic live in `game/js/quest/`. They use the engine's generic overlay primitives (`engine/ui/`: fade, hint, prompt, text), skinned by `uiStyle`. The start pose comes from `def.start` (`pose: 'lying'`, `eyeH`, `pitchDeg`). Hint trigger zones (e.g. the gap-edge `[Space] Jump` zone) are declared in level data, not as coordinates in code. Use the tower's `hintJump` trigger (r 2 m, `zMin` 2.0 m, once). A hint whose action the player has already performed (e.g. they jumped before entering the zone) is never shown.
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
- **Verified in the browser (coordinator, 2026-09-22):** `design/preview/overworld.html` renders with no console errors, 17/17 checks after US-016b.

Acceptance criteria – Programmer (rewritten per D-007/D-008: engine terrain caster, far LOD):
- [ ] `engine/render/terrainCaster.js` (exported via `engine/index.js` as `castTerrain`) renders the world terrain from the injected terrain recipe (`AssetRegistry`, US-024) at **far LOD**: 8 m grid, 300-1500 m. For M1 it may also cover 0-300 m at 8 m spacing (near LOD is US-026). The far grid is baked once at load: height, type and lighting `b` per cell.
- [ ] Per column, it draws only inside the **open span** left by the sector caster (US-004 item: `[topRow, bottomRow, depth]`), and writes depth into the shared `DepthBuffer`. (From the US-004 review) The open spans become reused typed arrays (e.g. `Int16Array` top/bottom plus `Float32Array` depth, sized to `cols`) instead of per-frame objects, with zero per-frame allocation between the two passes. A small `engine/render/compositor.js` sequences the passes: sectors, then terrain, then sky fill for the rest of the span, then sprites (US-011), then UI. It never draws terrain over structure cells.
- [ ] Projection uses the same `horizonRow` / `focalRows` / y-shear as the sector caster. The horizon lines up at every pitch in the ±35 degree clamp (no seam or jump), and the terrain at the tower's outer ring meets the ring cells with no visible step once US-016b's blend lands.
- [ ] Look and fog exactly per `overworld_far.md` sections 3 and 4: type glyph bands by distance, sun N.L lighting from the level's sun, fog to `fogFar` with glyphs thinning to haze, and the river glint at 1.5 Hz.
- [ ] Far tower drawn per section 5 as a billboard at (713.8, 1232.1), depth-tested against the terrain, never smaller than the 3x4 minimum sprite, dark and unlit (fog cap 0.40), and unchanged by US-022.
- [ ] Cost: the terrain pass is <= 4 ms per frame on its own (target 2-3 ms per D-007) when looking out of the breach, and the total JS render stays within 8 ms (US-018).
Design needed: yes – far terrain data/recipe, colors, tower silhouette (delivered); follow-up US-016b.
Notes / dependencies: US-004 (DepthBuffer + open span), US-007 (sun), US-010, US-024 (engine layout, AssetRegistry), US-025 (World: terrain sampler, tower placement at recipe coords).

### US-016b Terrain recipe follow-up for the world model  [Priority: P0] [Status: done]
As a player, I want the land outside the tower to be one continuous world, so that it meets the tower seamlessly and can later be walked on.
Acceptance criteria – Designer (small, D-008):
- [x] `heightAt(x, y)` and `typeAt(x, y)` are documented and implemented as continuous analytic functions usable at any sample spacing (2 m near, 8 m far), with the baked 8 m grid equal to sampling them.
- [x] Near-LOD look spec for 2 m cells within 300 m, with glyph bands and colors extending the current near band, and a preview swatch.
- [x] Flat 2.4 m crown radius covering the tower footprint and outcrop, plus the handover rule: within 6 m of a structure's outer ring, terrain height blends linearly to the ring height. The mismatch where the player can stand is exactly 0; the preview check shows max |delta| = 0.00 m along the ring.
- [x] One-paragraph sketch of per-chunk overrides (height stamp, type paint) as JSON for the future editor.
Design needed: yes (recipe + doc + preview update).
Notes / dependencies: feeds US-025 (World terrain sampler) and US-026 (near LOD). Cosmetic for the M1 far view.

**PO APPROVED (2026-09-22) – US-016b done** (design/data-only story; exercised by the US-016 / US-025 / US-026 tests). The coordinator verified both previews in the browser: `overworld.html` 17/17 checks, including an 8,100-point finiteness check; `tower.html` 18/18; no console errors.
- (a) `heightAt(x, y)` / `typeAt(x, y)` are continuous and analytic at any spacing. The river-bed carve is smoothed, and slope for `typeAt` is measured over a fixed 2 m, so the type does not depend on sample spacing. There is `util.bakeChunk` for 2 m chunks and `util.gridHeight(G, x, y)` for baked grids.
- (b) Near-LOD bands: close < 40, near < 150, mid < 300 m, with a stable per-cell dither handover at 280-320 m to the far grid. Variation is world-keyed, so it does not shimmer as the camera moves. The detail (slope faces, trunks, flowers, reeds, foam) is good material for US-026.
- (c) A flat 2.4 m crown covers the whole footprint (bastion and outcrop included), with a 6 m linear blend to the ring height. The mismatch where the player crosses is exactly 0.
  - **Change to approved US-010 data, accepted:** legend `,` is raised from 1.0 to 2.4 m so the outer ring is uniform. Those cells are unreachable in M1 and are seen only through the sun crack and from the summit, so it changes nothing about play.
  - New rule for future structures, adopted: the outer ring is flat or has at most 0.3 m variation between neighbours.
- (d) Per-128 m-chunk JSON overrides (height stamps, type paints), with the tower crown as the first entry and a JSON round-trip check. This is the seed for US-027 and the editor.
Designer note (2026-09-22): **Preview ready for PO review.**
- **Where:** `design/preview/overworld.html`. A 160x60 heightmap-projection mock from the breach eye, with yaw, pitch, step-back, fog and glint controls. The near part samples the real `tower.js` sectors. The page also shows the top-down map with the view cone and towers, terrain swatches by distance, the far-tower silhouette and automated checks.
- **Data:** `design/levels/overworld_far.js` (seeded recipe plus reference `generate()`, 256x256 x 8 m). Doc: `design/levels/overworld_far.md`.
- **Content:**
  - A river valley about 450 m W, rolling hills and forests, and a path to a ford.
  - Fog uses palette `fog.far` (50 to 1500 m) into `skyHorizon`.
  - The far tower is 800 m WSW on a hill crown. It is dark, unlit and not emissive, with fog capped at 0.40, and it breaks the skyline. It is drawn no smaller than a 3x4 silhouette.
- Status stays `design`.

Designer note, US-016b (2026-09-22): **Preview ready for PO review.** `design/preview/overworld.html` (v2) has viewpoints for the breach, the path, the meadow and "looking back at the tower", a near-LOD toggle, a handover profile and 17 checks. Data: `design/levels/overworld_far.js` v2. Doc: `overworld_far.md`, "US-016b summary".
- **(a)** `util.heightAt(x, y)` / `util.typeAt(x, y)` are analytic, continuous and NaN-free everywhere. The 8 m far grid and 2 m chunks (`bakeChunk`) are exactly those functions sampled. Checks cover continuity, grid = function, 2 m vs 8 m agreement, and a NaN sweep. The earlier NaN came from the old page calling v1's `heightAt(G, x, y)`; that call shape now throws a clear TypeError.
- **(b)** `nearLOD`: close / near / mid bands, stable world-cell hashing, surface vs face rows, forest trunks, features (wildflowers, pebbles, reeds, foam), and a dithered 280-320 m handover. There is a preview swatch per band.
- **(c)** A flat 2.4 m crown stamp (r 20 m) covers the footprint, bastion and outcrop. `structures[]` sets a linear 6 m handover to the ring height. The tower's outer ring is now flat 2.4 m: legend `,` went from 1.0 to 2.4, an M1-unreachable cosmetic change. The ring mismatch is exactly 0, and a check prints it.
- **(d)** Per-chunk `overrides` (stamps/paints) are JSON and keyed by 128 m chunk, with the tower crown as the first entry. The paragraph is in the doc.
- **Also delivered:**
  - `design/levels/world_m1.js` for US-025: terrain + tower at (1480, 1018, 0) + player spawn + initial state.
  - US-010 data additions in `tower.js`: `interactables[]` (lantern.take, lever.pull with target tag grate, beacon.light requiring the lantern) and the `hintJump` hint-zone trigger, plus `trigger: 'quest.end'`.
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

**Tech notes (architect, 2026-09-22).** Reusable parts (layers, API typedefs, conventions, allocation rules, check-deps rules) are in `docs/architecture.md` sections 2, 3, 5, 6; this note is the move plan.

*Principle: move, do not refactor.* US-024 changes paths, import lines, one rename (`castScene` -> `castSectors`, kept internally as an alias until US-004b/US-016 adopt `FrameBuffers`), and adds `index.js`, `assets.js`, `check-deps.mjs`, `README.md`. No behaviour changes; the `CellBuffer.glyphIdx` checksum at a fixed camera is the regression test.

*File moves (old -> new):*
| Old | New |
|---|---|
| `game/js/render/RenderTarget.js`, `RenderTargetGL.js`, `RenderTargetCanvas2D.js`, `CellBuffer.js`, `glyphMetrics.js`, `DepthBuffer.js` | `engine/render/` same names |
| `game/js/render/raycaster.js` | `engine/render/sectorCaster.js` (export `castSectors`; `castScene` alias, not exported from index) |
| `game/js/render/shadeTest.js` | `engine/render/shadeTest.js` (takes the palette as a parameter already) |
| `game/js/render/palette.js` (placeholder) | **deleted**: the registry requires a real palette; `getDefaultRamp` callers use `assets.palette.ramps.default` |
| `game/js/render/demoScene.js`, `glyphsScene.js`, `benchScene.js` | `game/js/dev/` (page harnesses; import only `engine/index.js`) |
| `game/js/engine/loop.js`, `input.js` | `engine/core/loop.js`, `engine/core/input.js` |
| `game/js/engine/debugCamera.js` | `game/js/dev/debugCamera.js` (dev harness, replaced by US-005/US-008; not engine API) |
| `game/js/ui/debugOverlay.js` | `engine/ui/debugOverlay.js` |
| `game/js/world/Level.js`, `MAP_FORMAT.md` | `engine/world/Level.js`, `engine/world/MAP_FORMAT.md` |
| `game/js/world/levels/test_room.js` | `design/levels/test_room.js` as a classic script (`ASSETS.levels.test_room`, plus `module.exports` under Node like `palette.js`) |
| `game/js/world/worldTestMain.js` | `game/js/dev/worldTestMain.js` |
| `game/js/physics/config.js`, `capsule.js` | `engine/physics/config.js` (export `PHYSICS_DEFAULTS`; `PHYSICS` alias kept for tests), `engine/physics/capsule.js` |
| `game/js/physics/physics.test.js` | `engine/physics/physics.test.js` (imports stay relative inside engine; `test_room` via `createRequire` of `design/levels/test_room.js`) |
| `game/js/physics/physicsTestMain.js` | `game/js/dev/physicsTestMain.js` |
| `game/js/entities/Player.js` | `engine/entities/Player.js` (first-person capsule controller; US-025 splits it into `Entity` data + `integrate`) |
| `game/js/main.js` | stays; imports only `engine/index.js` and reads `window.ASSETS` once |
| new | `engine/index.js`, `engine/core/assets.js`, `engine/core/events.js` (tiny emitter), `engine/core/behaviours.js`, `engine/render/OpenSpans.js`, `engine/README.md`, `tools/check-deps.mjs` |
| stubs (throw `not implemented (US-xxx)`) | `engine/world/World.js`, `engine/world/Terrain.js`, `engine/world/serialize.js`, `engine/render/terrainCaster.js`, `engine/render/sprites.js`, `engine/render/textDraw.js` (this one is real: 20 lines over `setCell`), `engine/physics/sphere.js`, `engine/physics/integrate.js`, `engine/entities/Entity.js`, `engine/entities/Camera.js` |

*HTML pages:* `game/index.html` adds classic `<script>` tags for every `design/` file the registry needs (`palette.js`, `levels/test_room.js`, later `levels/tower.js`, `levels/overworld_far.js`, `levels/world_m1.js`, `models/*.js`) before the module. `world-test.html` -> `js/dev/worldTestMain.js`, `physics-test.html` -> `js/dev/physicsTestMain.js`, both also load `design/palette.js` + `design/levels/test_room.js` classic scripts. `?level=name` reads `assets.level(name)`.

*API signatures introduced by this story (normative, architecture.md 5-6):*
- `createEngine({ canvas, assets, cols=160, rows=60, force2d=false, physics? , inputTarget? })` -> `{ renderTarget, depthBuffer, openSpans, world: null, input, loop, camera, events, assets, physics, loadWorld(def), run({update, render}) }`. `loop` is created but not started; `run` starts it.
- `new AssetRegistry({ palette, models?, levels?, terrain?, worlds?, uiStyle? })`, `AssetRegistry.fromGlobals(window.ASSETS)` (splits `ASSETS.levels` into `levels` (has `rows`) and `terrain` (has `util.heightAt`)), `assets.palette`, `assets.level(key)`, `assets.model(key)`, `assets.terrain(key)`, `assets.world(key)`, `assets.uiStyle`; unknown key throws `AssetRegistry: unknown level "x" (known: test_room, tower)`.
- `castSectors(fb, level, cam, origin)` with `fb = { rt, depth, spans, palette, lights: null, timeSec }`; `beginFrame(fb)`; `fillSky(fb, cam)`; `renderWorld` is a stub until US-025. `main.js` for `test_room` calls `beginFrame`, `castSectors(fb, level, cam, ORIGIN0)`, `fillSky(fb, cam)`, `rt.present()`. That sequence replaces `skyFallback: true` and produces the identical image (sky is still painted into whatever is open).
- `drawText(rt, x, y, text, fg, bg?)`.
- `registerBehaviour(name, fn)` (+ aliases `registerInteraction`, `registerTrigger`), `getBehaviour(name)`.

*Sequencing so it does not collide with US-005 (programmer #1: `game/js/engine/input.js`, `debugCamera.js`, `main.js`) and US-008/US-009 (programmer #2: `game/js/physics/*`, `game/js/entities/Player.js`):*
- **Phase A (can start now, one programmer, ~half a day, no in-flight file touched):** create `engine/index.js`, `core/assets.js`, `core/events.js`, `core/behaviours.js`, `render/OpenSpans.js`, `render/textDraw.js`, all stubs, `engine/README.md`, `tools/check-deps.mjs`. Move the files nobody is editing: `render/*` (except the dev scenes), `ui/debugOverlay.js`, `core/loop.js`, `world/Level.js` + `MAP_FORMAT.md`, `test_room.js` -> `design/levels/`. Leave **forwarding shims** at every old path that in-flight code imports (`game/js/world/Level.js`: `export * from '../../../engine/world/Level.js';`, same for `levels/test_room.js` exporting the global as default, `render/RenderTarget.js`, `render/DepthBuffer.js`, `render/raycaster.js`, `engine/loop.js`, `ui/debugOverlay.js`). Shims are legal (game -> engine) and keep `physics.test.js`, `physicsTestMain.js`, `worldTestMain.js` and the two programmers' working copies running untouched. `main.js` is **not** edited in Phase A (US-005 owns it); it keeps working through the shims. `check-deps` already passes on `engine/`.
- **Phase B (after US-005 reaches `po-review`):** move `input.js` -> `engine/core/input.js`, `debugCamera.js` -> `game/js/dev/`, rewrite `main.js` to `AssetRegistry.fromGlobals` + `createEngine` + `beginFrame/castSectors/fillSky`, remove `render/palette.js`. Delete the render/loop/ui shims.
- **Phase C (after US-009 reaches `po-review`):** move `physics/*`, `entities/Player.js`, `physics.test.js`; fix their relative imports; delete the world shims. `node engine/physics/physics.test.js` passes unchanged.
- **Phase D (closing):** `check-deps` OK with the shim directories gone (`game/js/{engine,render,world,physics,entities,ui}/` no longer exist), screenshot/checksum compare, `?bench=1` within noise, all switches, `CLAUDE.md` layout line updated with the manager. Story goes to `po-review` only after D. If US-005 or US-009 slip, Phases A+B can still ship and C is the only part that waits; do not start Phase C on a file the other programmer has uncommitted edits in.
- Programmers on US-005/US-009 meanwhile: **new** files go to the new paths (`engine/core/input.js` additions are fine to write there directly if US-005 creates a new module; otherwise finish in place and let Phase B move it). Do not import from `engine/` deep paths.

*check-deps rules:* architecture.md section 3 (six rules; engine-only imports, no `ASSETS`/`document`/`location` in engine, game/tools import exactly `engine/index.js`, design has no `import`, JSDoc imports ignored, exit 1 with `file:line`). Add the fixture test `tools/check-deps.test.mjs` with a temp tree containing one violation of each rule.

*Not in this story:* World, Terrain, serialize (US-025); the fast shader/overdraw fix (US-004b) - but if US-004b lands first, Phase A moves the improved file; `OpenSpans` adoption inside the caster (US-004b) - Phase A only creates the class.

### US-025 World model: terrain + placed structures in one world frame (D-007)  [Priority: P0] [Status: todo]
As a player, I want the tower to stand on a real hill in a real world, so that what I see from the breach is the same world I will later walk into.
Acceptance criteria:
- [ ] **`engine/world/Terrain.js`:** a sampler over the injected terrain recipe (`AssetRegistry.terrain`, from `design/levels/overworld_far.js` plus US-016b).
  - `heightAt(x, y)` is bilinear on the baked grid for the far LOD and analytic for near queries; `typeAt(x, y)`.
  - The far 8 m grid (256x256) is baked once at load (revised after the US-016b review; a synchronous bake costs about 5 height lookups per cell and may exceed 150 ms in plain JS):
    - Either run it in a Worker, or amortise it over frames at <= 2 ms of main-thread time per frame. Start during the wake sequence: 1 s black plus 1.5 s blink is a natural loading window.
    - No frame may exceed 25 ms while baking, and the bake must be complete within 5 s of page load (long before the player can reach the summit).
    - The result must be bit-identical to a synchronous bake (test: compare checksums of height and type).
    - Until it completes, the terrain pass draws only sky/haze in the open span; no garbage and no errors.
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
Design needed: minor. Delivered 2026-09-22: `design/levels/world_m1.js` (tower at (1480, 1018), z offset 0, player spawn, initial world state for restart) and US-016b (done).
Notes / dependencies: US-024; US-016b (for exact-0 seam; M1 can start with the 1.8 m residual, as it is cosmetic in the far view). Unblocks US-006 onward in world coordinates, US-016 programmer, US-017 restart, and M2 US-026.

**Tech notes (architect, 2026-09-22).** Shapes and rules: `docs/architecture.md` sections 7 (World model), 9 (allocation), 10 (serialization, Entity, Events). This note is what to build, in order, with signatures.

*Build order (each step has a headless test):*
1. `engine/world/Terrain.js`: `new Terrain(recipe, { assets })`. `heightAt(x, y)` = `recipe.util.heightAt` (analytic, near) or `recipe.util.gridHeight(farGrid, x, y)` (far); `sample(x, y, camDist)` picks by `camDist < 300`. `typeAt(x, y)`. `normalAt(x, y, out)` central differences at 2 m into a reused `out`. Far bake: `bakeFarAsync(msBudget = 2)` advances row by row from the loop's `update` until `farReady`; `bakeFarSync()` for tests; checksum (`sum of Float32 bits`, e.g. FNV over the `Uint32Array` view) equal between the two. `chunk(cx, cy)` returns the baked 64x64 chunk from a 3x3 cache keyed `"cx,cy"`; `setCenter(x, y)` regenerates only the new row/column, amortised via `bakeChunkAsync`. Before bake, `Terrain` must give the recipe real ring heights: pass `ringHAt(x, y)` per placed structure (nearest outer-ring `floorH`) into `recipe.structures[i]` (the recipe already looks for `st.ringHAt`).
2. `engine/world/World.js` per architecture.md 7: `World.load(def, assets)`: `terrain = new Terrain(assets.terrain(def.terrain))`, `placeStructure(assets.level(s.level), s.origin, s.id, s.yawSteps)` for each, entities from `def.entities` (`spawn: { structure, from: 'start' }` -> `level.start + origin`, `pose`, `eyeH`), `state = structuredClone(def.state)`. Queries in world meters; `structureAt` = bbox test (the array is tiny); `outsideSector(x, y)` fills and returns **one reused scratch sector** `{ floorH, ceilH: 'sky', solid: false, wallMat: 'rock', floorMat: <type material>, ceilMat: 'sky', topH: 'sky', upperMat: 'rock', terrain: true }` (never allocate per query; callers must not hold onto it, document that). `animateSector(tag, t01)`: writes `ceilH` (and `topH`) into the tagged legend entries of that structure between `floorH` and `dynamic.ceilOpen`, records `dynamics[tag] = { t }`. Note: legend entries are shared per char; a dynamic sector must have its own legend char (the tower's grate does).
3. `engine/entities/Entity.js`: `Entity.create(id, type, transform, components)`, `Entity.eye(e, eyeH)`; no classes in state. `engine/physics/integrate.js`: lift the body of today's `Player.update` into `integrate(entity, dt, controls, world, cfg)` reading/writing `entity.transform` + `entity.components.body` (`vx, vy, vz, grounded, radius, height`); keep `Player.js` as a thin adapter over an entity so US-005/US-009 code keeps working, then delete it when nothing imports it. The 4 US-008 wall-slide tests must pass through `integrate` with `World` as the `WorldQuery` (test stub: a `World` with a flat terrain recipe and no structures = "walk off the grid edge" from US-008's D-008 criterion).
4. `engine/world/serialize.js` per architecture.md 10 (`version: 1`). Round-trip test in Node (`engine/world/serialize.test.js`) and `?serializetest=1` in the page. Positions exact, `dynamics` and `entities` included, `terrain.overrides` deep-copied.
5. `renderWorld(fb, world, cam)` in `engine/render/compositor.js`: `beginFrame`, `castSectors` per structure (sorted by distance to `cam`), `castTerrain` (stub until US-016: no-op), `fillSky`. `main.js` switches from the manual sequence to `renderWorld`. The tower in the world at (1480, 1018, 0) must produce, with `castTerrain` stubbed, the same image as the bare level at origin 0 plus sky in the open spans (`?origin` test from US-004 generalised).
6. Debug overlay: world x, y, z, structure id, sector char, `farReady`, chunk key. `game/js/main.js` reads `assets.world('world_m1')`; `?level=test_room` builds an ad-hoc `WorldDef` `{ terrain: null, structures: [{ level: 'test_room', origin: 0 }] }` - `World` must accept `terrain: null` (then `outsideSector` returns the solid wall, exactly today's `Level` behaviour).

*Signatures:*
```js
World.load(def: WorldDef, assets: AssetRegistry): World
world.placeStructure(levelDef, origin: {x,y,z}, id: string, yawSteps = 0): PlacedStructure   // throws 'yawSteps != 0: not in M1'
world.structureAt(x, y): PlacedStructure | null
world.sectorAt(x, y): Sector | null          // null outside every footprint
world.outsideSector(x, y): Sector            // terrain floor (scratch) or solid wall when terrain is null
world.floorAt(x, y): number | null           // structure floor or terrain height
world.heightAt(x, y): number                 // terrain only
world.animateSector(tag: string, t01: number): void
world.fireInteraction(id, ctx) / world.fireTrigger(id, ctx)
serialize(world): WorldState        deserialize(state, assets): World
new Terrain(recipe, opts?)  .heightAt .typeAt .normalAt(x,y,out) .sample(x,y,camDist) .bakeFarAsync(ms) .bakeFarSync() .farReady .checksum() .chunk(cx,cy) .setCenter(x,y)
integrate(entity, dt, controls, world, cfg): void
```

*Coordinates:* camera, player, lights, sprites, interactables and triggers are converted to world meters **once, at placement** (`local + origin`); `castSectors` is the only consumer that converts back (it takes `origin`). Never store both frames on the same object.

*Allocation:* no per-query allocation in any `World` method (scratch sector, bbox arrays preallocated); `Terrain.sample` no allocation; chunk generation allocates only its own typed arrays, off the frame budget or amortised.

*Determinism:* same seed + same overrides -> identical `checksum()`; a test compares `bakeFarSync` vs a fresh `bakeFarAsync` run to completion.

*Not in this story:* near-LOD drawing and slope physics (US-026), `castTerrain` (US-016), `fromJSON` (US-027). `Terrain` must still be built so `World.floorAt` outside the tower answers with terrain height (it is only used by the far view and the debug overlay in M1).

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
