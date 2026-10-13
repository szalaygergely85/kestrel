// WS1-08: the gpucompare row list must carry the `roadBend` pose (road bend, yaw 270).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('./gpucompare.js', import.meta.url), 'utf8');
assert.ok(/name: 'world_m1: roadBend [^']*'[\s\S]{0,120}x: 1268, y: 1040[\s\S]{0,60}yawDeg: 270/.test(src), 'roadBend row present');
const poses = fs.readFileSync(new URL('../../../../content/dev-poses.js', import.meta.url), 'utf8');
assert.ok(/slug: 'roadBend'[^\n]*x: 1268, y: 1040[^\n]*yawDeg: 270/.test(poses), 'roadBend dev pose present');
console.log('gpucompare.roadBend ok');
