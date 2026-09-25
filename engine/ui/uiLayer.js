// engine/ui/uiLayer.js (OWN-REQ-003, docs/architecture.md section 17). A
// second glyph grid, fixed at `uiGrid.cols` (clamped [96, 320]) x
// `round(cols * UI_GRID_ASPECT)` rows (same 8:3 aspect as the scene, so UI
// cells are square-scaled scene cells) - the UI (title, hints, `[E]` prompt,
// crosshair, map/end cards, pause overlay) draws into THIS grid instead of
// the scene's CellBuffer, so its glyphs read at the same physical size no
// matter what `?grid=` the scene is running at (160x60 .. 320x120).
//
// `ui.cells` is a plain `CellBuffer` (engine/render/CellBuffer.js) - `setCell`/
// `setCellRGB` are its own (mask=1 per written cell, exactly like the scene's
// `RenderTarget`), so every existing UI drawer (`drawPanel`/`drawRichLine`/
// `drawText`/`drawCrosshair`, all duck-typed on `rt`) works unchanged when
// handed a `UiLayer` instead of a `RenderTarget`.
//
// `clear()` is the one place a `UiLayer` differs from a scene `CellBuffer`:
// a scene clear is "fully JS-owned this frame" (mask=1 everywhere, section 6
// of CellBuffer.js), but a UI-layer clear means "nothing here this frame"
// (mask=0 = fully transparent) so present() can discard/skip every cell the
// game didn't redraw. `bg`'s alpha channel doubles as that per-cell mask on
// the GPU upload (`CellBuffer.setCell*` always writes `bg[..+3] = 255`, so a
// written cell's bg alpha is already 255 the moment it's drawn - `clear()`
// just has to zero it back out, no separate packing step needed).

import { CellBuffer } from '../render/CellBuffer.js';

export const UI_GRID_ASPECT = 3 / 8; // matches engine/core/engine.js's GRID_ASPECT
export const UI_GRID_MIN_COLS = 96;
export const UI_GRID_MAX_COLS = 320;

/** Clamps `cols` to [96, 320] - the range the architecture note (17.1) calls for. */
export function clampUiCols(cols) {
  let c = Math.round(cols);
  if (c < UI_GRID_MIN_COLS) c = UI_GRID_MIN_COLS;
  if (c > UI_GRID_MAX_COLS) c = UI_GRID_MAX_COLS;
  return c;
}

/**
 * @typedef {{cols:number, rows:number, cells:CellBuffer, sx:number, sy:number,
 *   setCell:Function, setCellRGB:Function, clear:Function, bindScene:Function}} UiLayer
 */

/**
 * @param {{cols:number, rows?:number}} uiGrid - `assets.uiStyle.uiGrid` (design/models/title.js), default 160x60.
 * @returns {UiLayer}
 */
export function createUiLayer(uiGrid) {
  const cols = clampUiCols(uiGrid ? uiGrid.cols : 160);
  const rows = Math.round(cols * UI_GRID_ASPECT);
  const cells = new CellBuffer(cols, rows);

  const layer = {
    cols, rows, cells,
    sx: 1, // set by bindScene - scene.cols / cols
    sy: 1, // set by bindScene - scene.rows / rows

    setCell(x, y, glyph, fg, bg) {
      cells.setCell(x, y, glyph, fg, bg);
    },

    // Allocation-free numeric fast path (same signature as CellBuffer's/
    // RenderTarget's), used by every hot UI drawer (panel.js, richText.js).
    setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2) {
      cells.setCellRGB(x, y, glyphIdx, r, g, b, r2, g2, b2);
    },

    // Per-frame reset to fully transparent (mask=0), never allocates. Unlike
    // CellBuffer.clear() (which paints a full-screen JS-owned background),
    // a UiLayer that nobody draws into this frame must vanish entirely -
    // there is no "UI background color" to fall back to.
    clear() {
      cells.glyphIdx.fill(0);
      cells.mask.fill(0);
      cells.bg.fill(0); // bg alpha (byte 3 of every RGBA4 group) doubles as the mask on the GPU upload - 0 = transparent
    },

    // Called by engine.createEngine (once) and engine.setGrid (on every
    // grid change) - never re-creates the layer itself (US-038 could swap
    // `uiGrid.cols` later; today it's fixed for the run).
    bindScene(sceneCols, sceneRows) {
      layer.sx = sceneCols / cols;
      layer.sy = sceneRows / rows;
    },
  };
  return layer;
}
