// US-005: "Click to resume" overlay, shown while pointer lock is not
// active. Uses the designer's `ASSETS.uiStyle.pause` (design/models/title.js,
// documented in design/README.md section 5) - text, color, row, and a
// "plate" (a soft darken of the scene right under and around the text, no
// box drawing).
//
// OWN-REQ-003 (architecture.md 17.4/17.5): the readable TEXT now draws into
// the fixed UI layer (`ui`) so it stays the same size at any `?grid=`, but
// the PLATE still darkens the already-rendered scene in place (`rt.cells`) -
// `sceneDim.js`'s deferred-rect plumbing needs a frame boundary this call
// doesn't have (drawPauseOverlay runs once, right before `rt.present()`),
// so it keeps doing the multiply-in-place it always did, just over a rect
// converted from UI cells to scene cells via `ui.sx`/`ui.sy`.

// `assets` = `window.ASSETS` (i.e. `{ palette, models, uiStyle, ... }`) -
// `uiStyle` is a SIBLING of `palette`, not nested inside it, per
// design/README.md's `ASSETS.*` shape.
/**
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {Object} assets
 */
export function drawPauseOverlay(ui, rt, assets) {
  const palette = assets.palette;
  const style = assets.uiStyle && assets.uiStyle.pause;
  if (!style) return; // defensive: don't crash the frame if uiStyle is ever missing a field

  const text = style.text;
  const row = style.row; // UI-grid cell
  const pad = style.plate ? style.plate.pad : 0;
  const bgMul = style.plate ? style.plate.bgMul : 1;
  const startCol = style.align === 'center'
    ? Math.floor((ui.cols - text.length) / 2)
    : 0;

  // Plate: darken the already-rendered scene under/around the text in place
  // (multiply, not replace - "no box drawing"), converted from UI cells to
  // scene cells (`ui.sx`/`ui.sy`) so it still frames the text correctly
  // however much bigger/smaller the scene grid is than the UI grid.
  const sx = ui.sx, sy = ui.sy;
  const r0 = Math.max(0, Math.floor((row - pad) * sy));
  // Inclusive last scene row/col covered by the last UI cell (arch review:
  // `ceil(end*s)` was one scene row/col short at non-integer 240/320 ratios).
  const r1 = Math.min(rt.rows - 1, Math.ceil((row + pad + 1) * sy) - 1);
  const c0 = Math.max(0, Math.floor((startCol - pad) * sx));
  const c1 = Math.min(rt.cols - 1, Math.ceil((startCol + text.length + pad) * sx) - 1);

  const cb = rt.cells;
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

  // Text, drawn into the fixed-size UI layer so it reads at the same size
  // regardless of the scene grid - bg sampled from the scene cell under its
  // centre (now darkened by the plate above) so it still blends into it.
  const midSceneY = Math.min(rt.rows - 1, Math.round(row * sy));
  const [tr, tg, tb] = palette.rgb[style.color];
  for (let i = 0; i < text.length; i++) {
    const x = startCol + i;
    if (x < 0 || x >= ui.cols || row < 0 || row >= ui.rows) continue;
    const code = text.charCodeAt(i);
    const glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
    const midSceneX = Math.min(rt.cols - 1, Math.round(x * sx));
    const bi = (midSceneY * rt.cols + midSceneX) * 4;
    ui.setCellRGB(x, row, glyphIdx, tr, tg, tb, cb.bg[bi], cb.bg[bi + 1], cb.bg[bi + 2]);
  }
}
