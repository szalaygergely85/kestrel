// BUG-HUD-OFFSCREEN-01: fitCssSize scales the displayed canvas down uniformly (aspect kept), never up.
import assert from 'node:assert/strict';
import { fitCssSize, computeCellBox, fitCssFill, fitCssRatio } from './glyphMetrics.js';
let r = fitCssSize(2000, 750, 1280, 720);
assert.ok(r.w <= 1280 && r.h <= 720 + 1e-9);
assert.ok(Math.abs(r.w / r.h - 2000 / 750) < 1e-12);
assert.equal(r.smooth, true); // BUG-SQUARES-01: shrunk -> smooth resample, not pixelated
r = fitCssSize(1000, 500, 1280, 720);
assert.deepEqual(r, { w: 1000, h: 500, smooth: false });
// BUG-SQUARES-01: computeCellBox(fit) clamps the cell so the whole grid fits 1:1 (same font); fit=false keeps the old box.
const fake = { font: '', textBaseline: '', textAlign: '', measureText() { const px = parseFloat(this.font); return { width: px * 0.6, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.25 }; } };
const old = computeCellBox(fake, 400, 150, 1280, 720);
assert.ok(old.pxCellH * 150 > 720, 'fixture: the old box overflows 720 px (the moire case)');
const fit = computeCellBox(fake, 400, 150, 1280, 720, Infinity, true);
assert.ok(fit.pxCellW * 400 <= 1280 && fit.pxCellH * 150 <= 720, 'fit box inside the window');
assert.equal(fit.fontPx, old.fontPx, 'same font');
assert.ok(fit.glyphAscent <= fit.pxCellH);
assert.deepEqual(computeCellBox(fake, 40, 15, 1280, 720, Infinity, true), computeCellBox(fake, 40, 15, 1280, 720), 'fitting grid unchanged');
// OB-117: live path CSS box == the window for every preset grid x window size x dpr (no letterbox).
for (const [c, rw] of [[240, 90], [400, 150], [480, 180], [560, 210], [320, 120]]) for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [1366, 768], [1326, 638]]) for (const dpr of [1, 1.25]) {
  const b = computeCellBox(fake, c, rw, w * dpr, h * dpr, Infinity, true);
  const css = fitCssFill(b.pxCellW * c, b.pxCellH * rw, dpr, w, h);
  assert.ok(css.w === w && css.h === h, 'CSS box == window');
}
// reference-box path (gpucompare) is fitCssSize(cellW*cols, cellH*rows, ..., 1) and untouched: pin a value.
assert.deepEqual(fitCssSize(1440, 1080, 1280, 720, 1), { w: 960, h: 720, smooth: true });
// OB-117: fixed ratio = largest box of that ratio in the window (bars otherwise); null = fill. 5 ratios x 5 sizes x dpr 1/1.25.
for (const ratio of [16 / 9, 16 / 10, 21 / 9, 4 / 3, null]) for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [1366, 768], [1326, 638]]) for (const dpr of [1, 1.25]) {
  const css = fitCssRatio(ratio, 1440, 540, dpr, w, h);
  assert.ok(css.w <= w + 1e-9 && css.h <= h + 1e-9, 'inside window');
  assert.ok(Math.abs(css.w - w) < 1e-6 || Math.abs(css.h - h) < 1e-6, 'largest box');
  if (ratio === null) assert.ok(css.w === w && css.h === h, 'fill = window');
  else assert.ok(Math.abs(css.w / css.h / ratio - 1) < 0.005, 'ratio ' + ratio);
}
console.log('glyphMetrics.test: PASS');
