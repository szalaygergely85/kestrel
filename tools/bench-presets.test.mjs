import assert from 'node:assert/strict';
import { pct, parseArgs, summarize, formatTable, gateResult, formatGate } from './bench-presets.mjs';

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
const b = parseArgs(['9575', '--imp', 'off,on', '--gpu', 'rtx', '--quality', 'ultra']);
assert.deepEqual([b.imp, b.gpu, b.quality], [[0, 1], 'rtx', 'ultra']);
const mk = (imp, ms) => summarize('roadSouth', 2, '480x180', [16], { total: [ms], passes: {} }, imp);
assert.equal(gateResult([mk(0, 9), mk(1, 7.4)], 'rtx', 'ultra').pass, true);
assert.equal(gateResult([mk(0, 9), mk(1, 7.6)], 'rtx', 'ultra').pass, false);
assert.equal(gateResult([mk(1, 10)], 'intel', 'high').pass, true);
assert.equal(gateResult([mk(1, 10.1)], 'intel', 'high').pass, false);
assert.equal(gateResult([mk(1, 5)], 'rtx', 'high'), null);
assert.match(formatGate(gateResult([mk(1, 7.6)], 'rtx', 'ultra')), /FAIL/);
assert.match(formatGate(null), /n\/a/);
assert.match(formatTable([mk(0, 9), mk(1, 7)]), /roadSouth\s+2\s+off[\s\S]*on/);
console.log('bench-presets.test: OK');
