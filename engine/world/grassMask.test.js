import assert from 'node:assert/strict';
import { createGrassMask, maskAt, sampleAt, setSample, grassMaskFromJSON, grassMaskToJSON, bakeAreasToMask } from './grassMask.js';

assert.equal(maskAt(null, 3, 4), 1, 'no layer = 1');
assert.equal(maskAt(undefined, -100, 9), 1);
assert.equal(maskAt(createGrassMask(), 1, 1), 0, 'empty layer = 0');

// bilinear across the chunk seam (chunk 64 m / cell 0.5 -> n 128; seam at sample 128)
const L = createGrassMask();
for (let j = -2; j <= 2; j++) for (let i = 62; i <= 66; i++) setSample(L, i, j, 255);
assert.equal(maskAt(L, 32, 0), 1);
assert.ok(Math.abs(maskAt(L, 32.1, 0.2) - 1) < 1e-9);
setSample(L, 128, 0, 0); setSample(L, 127, 0, 255);
assert.ok(Math.abs(maskAt(L, 63.75, 0) - 0.5) < 0.01, 'half between samples across chunk seam');
assert.equal(L.chunks.has('1,0'), true);
assert.equal(sampleAt(L, -1, -1), 0);
setSample(L, -1, -1, 255);
assert.equal(sampleAt(L, -1, -1), 255);

// JSON round trip byte-identical, empty chunks dropped
const j1 = grassMaskToJSON(L, 'g');
L.chunks.set('9,9', new Uint8Array(L.n * L.n));
assert.deepEqual(grassMaskToJSON(L, 'g'), j1);
const L2 = grassMaskFromJSON(JSON.parse(JSON.stringify(j1)));
assert.equal(JSON.stringify(grassMaskToJSON(L2, 'g')), JSON.stringify(j1));
assert.equal(j1.kind, 'grassMask');
assert.throws(() => grassMaskFromJSON({ kind: 'terrainEdits' }));
assert.throws(() => grassMaskFromJSON({ chunks: { x: 'AA==' } }));
assert.throws(() => grassMaskFromJSON({ chunks: { '0,0': 'AA==' } }));

// bake
const B = createGrassMask();
bakeAreasToMask(B, [
  { areas: [{ shape: 'disc', x: 10, y: 10, r: 4 }] },
  { areas: [{ shape: 'capsule', ax: 30, ay: 10, bx: 40, by: 10, r: 2 }, { shape: 'rect', x0: 50, y0: 5, x1: 60, y1: 15 }] },
  { ground: ['grass'] }, // no areas: skipped
], 1);
assert.equal(maskAt(B, 10, 10), 1);
assert.equal(maskAt(B, 13.5, 10), 1);
const e = maskAt(B, 14.5, 10);
assert.ok(e > 0.2 && e < 0.8, 'edge ramp ' + e);
assert.equal(maskAt(B, 15.2, 10), 0);
assert.equal(maskAt(B, 35, 11.5), 1);
assert.equal(maskAt(B, 35, 14), 0);
assert.equal(maskAt(B, 55, 10), 1);
assert.equal(maskAt(B, 59.9, 14.9), 1);
assert.equal(maskAt(B, 61.5, 10), 0);
assert.equal(maskAt(B, 20, 20), 0);
const hard = bakeAreasToMask(createGrassMask(), [{ areas: [{ shape: 'disc', x: 0, y: 0, r: 2 }] }], 0);
assert.equal(maskAt(hard, 0, 0), 1);
assert.equal(sampleAt(hard, 6, 0), 0);

// 0 alloc in maskAt
let s = 0;
for (let i = 0; i < 1e4; i++) s += maskAt(B, i * 0.01, 10);
if (global.gc) global.gc();
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e6; i++) s += maskAt(B, (i % 1000) * 0.07, 10.3);
const dh = process.memoryUsage().heapUsed - h0;
assert.ok(dh < 2e6, 'maskAt allocates: ' + dh);
console.log('grassMask.test OK', s > 0);
