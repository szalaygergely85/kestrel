// OB-189: softenAlpha = in-cell vertical [1 2 1]/4 blur; flat rows stay flat, a 1-row ink line spreads, no bleed across the strip.
import assert from 'node:assert/strict';
import { softenAlpha, GLYPH_COUNT } from './glyphAtlas.js';
const cw = 2, ch = 5, stride = cw * GLYPH_COUNT;
const a = new Uint8ClampedArray(stride * ch);
for (let x = 0; x < cw; x++) a[2 * stride + x] = 200; // ink row 2 of glyph 0
const b = softenAlpha(a, cw, ch);
assert.deepEqual([0, 1, 2, 3, 4].map((y) => b[y * stride]), [0, 50, 100, 50, 0]);
assert.equal(b[2 * stride + cw], 0, 'neighbour glyph untouched');
const flat = new Uint8ClampedArray(stride * ch).fill(120);
assert.ok(softenAlpha(flat, cw, ch).every((v) => v === 120), 'solid coverage unchanged');
console.log('glyphAtlas.soft: ok');
