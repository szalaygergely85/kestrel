// `?glyphs=1` test screen (US-001 rework item 4): every printable ASCII
// glyph (32-126), one per cell, on alternating light/dark backgrounds so
// any clipping against a neighboring cell's background is immediately
// visible (clipped pixels would show the wrong color bleeding past the
// glyph's own cell).

const FIRST_CODE = 32;
const LAST_CODE = 126;

/**
 * @param {import('./RenderTarget.js').RenderTarget} rt
 */
export function drawGlyphsScreen(rt) {
  rt.clear('#000000');
  const { cols, rows } = rt;

  const marginX = 2;
  const marginTop = 2;
  const marginBottom = 2;
  let x = marginX;
  let y = marginTop;

  for (let code = FIRST_CODE; code <= LAST_CODE; code++) {
    const ch = String.fromCharCode(code);
    const even = (code - FIRST_CODE) % 2 === 0;
    const bg = even ? '#202020' : '#e8e2d0';
    const fg = even ? '#e8e2d0' : '#202020';
    rt.setCell(x, y, ch, fg, bg);

    x += 2; // one blank column of spacing between glyph cells
    if (x >= cols - marginX) {
      x = marginX;
      y += 2;
    }
  }

  const label = `GLYPHS ${FIRST_CODE}-${LAST_CODE} (?glyphs=1) - check for clipping against the alternating cell backgrounds`;
  const labelY = rows - marginBottom;
  for (let i = 0; i < cols; i++) {
    rt.setCell(i, labelY, i < label.length ? label[i] : ' ', '#ffffff', '#000000');
  }
}
