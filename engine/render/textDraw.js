// UI text (US-024): a thin, real (not stubbed) helper over `rt.setCell` for
// drawing plain strings into the glyph grid - emissive, never depth-tested,
// never lit/fogged (architecture.md section 8: "UI + text" pass).
//
// @param {import('./RenderTarget.js').RenderTarget} rt
// @param {number} x  @param {number} y  starting cell, left edge
// @param {string} text
// @param {string} fg  "#rrggbb" hex (architecture.md 4: "hex only in palette.colors")
// @param {string} [bg] "#rrggbb" hex, or omitted per `setCell`'s own default
export function drawText(rt, x, y, text, fg, bg) {
  for (let i = 0; i < text.length; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= rt.cols || y < 0 || y >= rt.rows) continue;
    rt.setCell(cx, y, text[i], fg, bg);
  }
}

// OB-051 (architecture.md 38.48): 2x text. Char i occupies the 2x2 block at
// (x + 2*i, y) (origin snapped to even by the layer). Only a UiLayer has
// setCellScaled; any other target (scene RT) falls back to plain 1x drawText.
export function drawTextScaled(rt, x, y, text, fg, bg) {
  if (typeof rt.setCellScaled !== 'function') { drawText(rt, x, y, text, fg, bg); return; }
  for (let i = 0; i < text.length; i++) rt.setCellScaled(x + 2 * i, y, text[i], fg, bg);
}
