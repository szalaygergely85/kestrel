// Shared glyph-metrics helper used by both render back-ends (RenderTargetGL
// and RenderTargetCanvas2D) so cell sizing behaves identically either way:
// derive the cell box from REAL measured font metrics (measureText,
// actualBoundingBoxAscent/Descent) instead of a hard-coded aspect ratio, so
// no printable ASCII glyph (32-126) is ever clipped, at any devicePixelRatio.

const FONT_STACK = '"Courier New", monospace';

/**
 * Measures every printable ASCII glyph (32-126) at a given font pixel size.
 * @returns {{width:number, ascent:number, descent:number, height:number}}
 */
export function measureGlyphs(ctx, fontPx) {
  ctx.font = `${fontPx}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let maxWidth = 0;
  let maxAscent = 0;
  let maxDescent = 0;
  for (let code = 32; code <= 126; code++) {
    const m = ctx.measureText(String.fromCharCode(code));
    if (m.width > maxWidth) maxWidth = m.width;
    // actualBoundingBox* is well supported in Chrome; fall back to a
    // reasonable fraction of the font size if a browser ever lacks it.
    const asc = m.actualBoundingBoxAscent != null ? m.actualBoundingBoxAscent : fontPx * 0.8;
    const desc = m.actualBoundingBoxDescent != null ? m.actualBoundingBoxDescent : fontPx * 0.25;
    if (asc > maxAscent) maxAscent = asc;
    if (desc > maxDescent) maxDescent = desc;
  }
  return { width: maxWidth, ascent: maxAscent, descent: maxDescent, height: maxAscent + maxDescent };
}

/**
 * Computes the device-pixel cell box (and font size) that fits `cols` x
 * `rows` glyphs with no clipping into an `availPxW` x `availPxH` device-pixel
 * budget, optionally capping the per-row pixel budget first (used by the
 * Canvas2D fallback to keep its backing resolution small - see
 * RenderTargetCanvas2D.js).
 *
 * @param {CanvasRenderingContext2D} measureCtx - scratch 2D context used only for measureText
 * @param {number} cols
 * @param {number} rows
 * @param {number} availPxW - available width in DEVICE pixels
 * @param {number} availPxH - available height in DEVICE pixels
 * @param {number} [maxRowPxH] - optional cap on per-cell device-pixel height
 */
export function computeCellBox(measureCtx, cols, rows, availPxW, availPxH, maxRowPxH = Infinity) {
  const perColPxW = availPxW / cols;
  const perRowPxH = Math.min(availPxH / rows, maxRowPxH);

  // Measure once at a large reference size (stable metrics, minimal rounding
  // noise) to estimate the font size that fits the per-cell pixel budget in
  // both dimensions, then re-measure AT that exact size so the final cell
  // box is derived from real, not extrapolated, metrics.
  const REF = 128;
  const refMetrics = measureGlyphs(measureCtx, REF);
  const scale = Math.min(perColPxW / refMetrics.width, perRowPxH / refMetrics.height);
  // Small safety margin: glyph metrics don't scale perfectly linearly with
  // font size (hinting/rounding), so back off very slightly from the naive
  // linear estimate before re-measuring for the real box.
  const fontPx = Math.max(1, Math.floor(REF * scale * 0.97));
  const metrics = measureGlyphs(measureCtx, fontPx);

  return {
    fontPx,
    // +1px padding guards against sub-pixel rounding in measureText itself.
    pxCellW: Math.max(1, Math.ceil(metrics.width)),
    pxCellH: Math.max(1, Math.ceil(metrics.height) + 1),
    glyphAscent: Math.ceil(metrics.ascent) + 1,
  };
}

export { FONT_STACK };
