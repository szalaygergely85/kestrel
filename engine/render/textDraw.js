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
