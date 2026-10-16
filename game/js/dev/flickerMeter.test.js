// FLICKER-F3-01: exact ratio, EMA settles, 0 alloc per frame.
import assert from 'node:assert/strict';
import { createFlickerMeter } from './flickerMeter.js';
const n = 100, gi = new Uint32Array(4 * n), fg = new Uint8Array(4 * n);
for (let i = 0; i < n; i++) gi[i * 4 + 1] = i < 80 ? 1 : 0; // 80 non-sky, 20 sky
const m = createFlickerMeter(n);
m.push(gi, fg, n, 0, 0, 0, 0, 0); // first frame primes
assert.equal(m.nStill, 0);
for (let i = 0; i < 8; i++) fg[i * 4 + 3] = 5; // 8 of 80 change (+ a sky cell must not count)
fg[90 * 4 + 3] = 7;
m.push(gi, fg, n, 0, 0, 0, 0, 0);
assert.equal(m.last, 0.1); assert.equal(m.still, 0.1); assert.equal(m.lastStill, true);
assert.match(m.text(), /^flicker 10\.00% \(still\)$/);
// moving camera goes to the other bucket
fg[0 * 4 + 3] = 9; m.push(gi, fg, n, 1, 0, 0, 0, 0);
assert.equal(m.lastStill, false); assert.equal(m.last, 1 / 80); assert.equal(m.still, 0.1);
// EMA settles on a constant 5% still flicker
let v = 0;
for (let f = 0; f < 200; f++) { v ^= 1; for (let i = 0; i < 4; i++) fg[i * 4 + 3] = 20 + v + 0 * f; if (f === 0) m.push(gi, fg, n, 2, 0, 0, 0, 0); m.push(gi, fg, n, 2, 0, 0, 0, 0); }
assert.ok(Math.abs(m.still - 4 / 80) < 1e-3, 'EMA ' + m.still);
// 0 alloc: heap stays flat over 1e5 pushes
if (global.gc) {
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let f = 0; f < 100000; f++) { fg[3] = f & 255; m.push(gi, fg, n, 2, 0, 0, 0, 0); }
  global.gc(); const d = process.memoryUsage().heapUsed - h0;
  assert.ok(d < 200 * 1024, 'heap grew ' + d);
} else console.log('(run with --expose-gc for the heap probe)');
console.log('flickerMeter.test OK');
