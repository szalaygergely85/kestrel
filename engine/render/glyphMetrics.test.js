// BUG-HUD-OFFSCREEN-01: fitCssSize scales the displayed canvas down uniformly (aspect kept), never up.
import assert from 'node:assert/strict';
import { fitCssSize } from './glyphMetrics.js';
let r = fitCssSize(2000, 750, 1280, 720);
assert.ok(r.w <= 1280 && r.h <= 720 + 1e-9);
assert.ok(Math.abs(r.w / r.h - 2000 / 750) < 1e-12);
r = fitCssSize(1000, 500, 1280, 720);
assert.deepEqual(r, { w: 1000, h: 500 });
console.log('glyphMetrics.test: PASS');
