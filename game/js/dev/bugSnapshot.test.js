// REPORT-KEY-01: format -> parse round trip.
import assert from 'node:assert/strict';
import { formatSnapshot, parseSnapshot, snapEnv, clockText, replayExtra } from './bugSnapshot.js';
const s = { build: '0b706c26', x: 1466.5, y: 1035.25, z: 12.04, yaw: 240, pitch: -4, hour: 19.5, quality: 'high', renderer: 'webgpu', gpu: 'NVIDIA GeForce RTX 3070', w: 1000, h: 700, cols: 400, rows: 140, flags: 'debug=1&farforest=1&time=19.5' };
const line = formatSnapshot(s);
assert.ok(line.startsWith('KESTREL 0b706c26 pos 1466.50,1035.25,12.04 240 -4 | clock 19:30 | quality high renderer webgpu gpu "NVIDIA GeForce RTX 3070" |'));
const p = parseSnapshot(line);
for (const k of ['build', 'x', 'y', 'yaw', 'pitch', 'hour', 'quality', 'renderer', 'gpu', 'w', 'h', 'cols', 'rows', 'flags']) assert.deepEqual(p[k], s[k], k);
assert.equal(p.z, 12.04);
assert.equal(formatSnapshot(p), line, 'idempotent');
assert.equal(clockText(23.999), '00:00'); assert.equal(clockText(6.25), '06:15');
assert.equal(parseSnapshot('hello'), null);
assert.equal(replayExtra(p), 'debug=1&farforest=1');
const e = snapEnv('"' + line + '"');
assert.equal(e.SPOT, '1466.5,1035.25,12.04,240'); assert.equal(e.CLOCKS, '19.5'); assert.equal(e.QUALITY, 'high'); assert.equal(e.W, '1000'); assert.equal(e.EXTRA, 'debug=1&farforest=1');
assert.equal(snapEnv(''), null); assert.throws(() => snapEnv('junk'));
console.log('bugSnapshot ok');
