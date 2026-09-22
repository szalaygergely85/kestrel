// US-005: "Click to resume" overlay, shown while pointer lock is not
// active. Uses the designer's `ASSETS.uiStyle.pause` (design/models/title.js,
// documented in design/README.md section 5) - text, color, row, and a
// "plate" (the existing scene's fg/bg darkened under and around the text,
// no box drawing) - drawn straight into the glyph grid via the
// allocation-free `setCellRGB` path (reading the previously-rendered scene
// back out of the shared `CellBuffer` so the plate can darken it in place).

// `assets` = `window.ASSETS` (i.e. `{ palette, models, uiStyle, ... }`) -
// `uiStyle` is a SIBLING of `palette`, not nested inside it, per
// design/README.md's `ASSETS.*` shape.
export function drawPauseOverlay(rt, assets) {
  const palette = assets.palette;
  const style = assets.uiStyle && assets.uiStyle.pause;
  if (!style) return; // defensive: don't crash the frame if uiStyle is ever missing a field

  const text = style.text;
  const row = style.row;
  const pad = style.plate ? style.plate.pad : 0;
  const bgMul = style.plate ? style.plate.bgMul : 1;
  const startCol = style.align === 'center'
    ? Math.floor((rt.cols - text.length) / 2)
    : 0;

  const cb = rt.cells;
  const r0 = Math.max(0, row - pad);
  const r1 = Math.min(rt.rows - 1, row + pad);
  const c0 = Math.max(0, startCol - pad);
  const c1 = Math.min(rt.cols - 1, startCol + text.length - 1 + pad);

  // Plate: darken the already-rendered scene under/around the text in place
  // (multiply, not replace - "no box drawing" per design/README.md 5).
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const i = y * rt.cols + x;
      const fi = i * 4;
      rt.setCellRGB(
        x, y, cb.glyphIdx[i],
        Math.round(cb.fg[fi] * bgMul), Math.round(cb.fg[fi + 1] * bgMul), Math.round(cb.fg[fi + 2] * bgMul),
        Math.round(cb.bg[fi] * bgMul), Math.round(cb.bg[fi + 1] * bgMul), Math.round(cb.bg[fi + 2] * bgMul)
      );
    }
  }

  // Text, over the now-darkened plate.
  const [tr, tg, tb] = palette.rgb[style.color];
  for (let i = 0; i < text.length; i++) {
    const x = startCol + i;
    if (x < 0 || x >= rt.cols || row < 0 || row >= rt.rows) continue;
    const code = text.charCodeAt(i);
    const glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
    const bi = (row * rt.cols + x) * 4;
    rt.setCellRGB(x, row, glyphIdx, tr, tg, tb, cb.bg[bi], cb.bg[bi + 1], cb.bg[bi + 2]);
  }
}
