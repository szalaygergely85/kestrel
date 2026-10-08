// BUG-HUD-OFFSCREEN-01: computeCellBox never returns a grid larger than the pixel budget (fake measureText, Node).
import assert from 'node:assert/strict';
import { computeCellBox } from './glyphMetrics.js';

// Courier-like: width 0.6 em, glyph box 0.95 em tall (ascent 0.75 / descent 0.2), rounded up to whole pixels like real text.
const ctx = { font: '', textBaseline: '', textAlign: '', measureText() {
  const px = Number(/^(\d+)px/.exec(this.font)[1]);
  return { width: px * 0.6, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.2 };
} };
let n = 0;
for (const [w, h] of [[1280, 720], [1920, 969], [1600, 900], [2400, 1215], [800, 600]]) {
  for (const [cols, rows] of [[240, 90], [400, 150], [480, 180], [320, 120]]) {
    const b = computeCellBox(ctx, cols, rows, w, h);
    assert.ok(b.pxCellW * cols <= w && b.pxCellH * rows <= h, `${cols}x${rows} in ${w}x${h}: cell ${b.pxCellW}x${b.pxCellH} overflows`);
    n++;
  }
}
// the per-row cap (Canvas2D fallback) still holds
const c = computeCellBox(ctx, 240, 90, 2400, 1800, 10);
assert.ok(c.pxCellH <= 10);
console.log(`glyphMetrics.test: ${n + 1} PASS`);
