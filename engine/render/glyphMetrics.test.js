// BUG-HUD-OFFSCREEN-01: fitCssSize scales the displayed canvas down uniformly (aspect kept), never up.
import assert from 'node:assert/strict';
import { fitCssSize, computeCellBox } from './glyphMetrics.js';
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
console.log('glyphMetrics.test: PASS');
