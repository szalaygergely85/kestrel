// ED-WG-01b (docs/architecture.md 38.21 item 1): the editor overlay (markers, selection brackets, hover, asset ghost) used to
// `rt.setCell` between the sprite pass and present. On WebGPU the GPU draws the whole frame and overwrites those cells, so the
// overlay now lands in `engine.ui` (presented over the scene on every path). Select.js/draw helpers stay unchanged: they get
// this scene-grid-shaped target (`cols`/`rows`/`setCell`) whose cells are mapped onto the (fixed-size) UI grid.
/**
 * @param {{cols:number, rows:number, setCell:Function, setGlyph:Function}} ui engine.ui
 * @param {{cols:number, rows:number}} rt scene render target (grid may change on resize)
 * @param {{glyphOnly?:boolean}} [o] glyphOnly = no bg box (scene shows through), opaque plate otherwise
 */
export function createOverlayTarget(ui, rt, { glyphOnly = false } = {}) {
  return {
    get cols() { return rt.cols; },
    get rows() { return rt.rows; },
    setCell(c, r, glyph, fg, bg) {
      const x = Math.floor(((c + 0.5) * ui.cols) / rt.cols), y = Math.floor(((r + 0.5) * ui.rows) / rt.rows);
      if (x < 0 || x >= ui.cols || y < 0 || y >= ui.rows) return;
      if (glyphOnly) ui.setGlyph(x, y, glyph, fg); else ui.setCell(x, y, glyph, fg, bg);
    },
  };
}
