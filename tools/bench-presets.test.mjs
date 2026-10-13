import assert from 'node:assert/strict';
import { pct, parseArgs, summarize, formatTable } from './bench-presets.mjs';

assert.equal(pct([5, 1, 3, 2, 4], 0.5), 3);
assert.equal(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
assert.ok(Number.isNaN(pct([NaN], 0.5)));

const a = parseArgs(['9575', '--rays', '1,2', '--poses', 'outwall', '--seconds', '5', '--json']);
assert.deepEqual([a.port, a.rays, a.poses, a.seconds, a.json, a.grid], [9575, [1, 2], ['outwall'], 5, true, '480x180']);

const gpu = { total: [10, 12, 11], passes: { raster: [6, 8, 7], resolve: [1, 1, 1], shade: [2, 2, 2] } };
const r = summarize('outwall', 2, '480x180', [16, 17, 33, 16], gpu);
assert.equal(r.raster, 7); assert.equal(r.totalGpu, 11); assert.equal(r.frameP95, 33); assert.ok(r.timers);
assert.ok(Math.abs(r.gbufferMB - 480 * 180 * 2 * 36 / 1048576) < 1e-9);
assert.match(formatTable([r]), /outwall\s+2/);

const none = summarize('p', 1, '480x180', [16], { total: [NaN], passes: {} });
assert.ok(!none.timers);
assert.match(formatTable([none]), /timestamp queries unavailable/);
console.log('bench-presets.test: OK');
