// EQ-04a: previewYaw rotation rules. Run: node game/js/quest/previewYaw.test.js
import assert from 'node:assert/strict';
import { createPreviewYaw } from './previewYaw.js';
const y = createPreviewYaw();
assert.equal(y.yawDeg, 180);
y.step(1, 1, 0); assert.equal(y.yawDeg, 330);          // D: +150 deg/s
y.step(1, -1, 0); assert.equal(y.yawDeg, 180);          // A: back
y.step(0.016, 0, 100); assert.ok(Math.abs(y.yawDeg - 240) < 1e-9); // drag 100 px = 60 deg
y.step(2.9, 0, 0); assert.ok(Math.abs(y.yawDeg - 240) < 1e-9);     // < 3 s idle: no ease
for (let i = 0; i < 100; i++) y.step(0.1, 0, 0);        // 10 s: eased home (60 deg takes 1 s)
assert.equal(y.yawDeg, 180);
y.step(0.1, -1, 0); y.step(3.5, 0, 0);                  // wraps and takes the short way
assert.ok(y.yawDeg > 170 && y.yawDeg <= 180);
y.reset(); y.step(1, -1, 0); y.step(1, -1, 0); assert.equal(y.yawDeg, 240); // 180 - 300 = -120 -> 240
console.log('previewYaw: PASS');
