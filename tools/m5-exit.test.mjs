// WMP-07: m5-exit table parser/aggregation with canned tool outputs.
import assert from 'node:assert/strict';
import { mapLoopGates, benchLifeGates, presetGates, formatTable } from './m5-exit.mjs';

const okLoop = { ok: true, bandLate: 0, syncBakes: 0, maxSwapMs: 2.1, cacheMB: 20.5 };
assert.ok(mapLoopGates(okLoop).every((r) => r.verdict === 'PASS'));
const bad = mapLoopGates({ ...okLoop, bandLate: 2, maxSwapMs: 4.5, cacheMB: 33, ok: false }).filter((r) => r.verdict === 'FAIL');
assert.equal(bad.length, 4);
assert.equal(mapLoopGates(null)[0].verdict, 'FAIL');

const mk = (n, v) => ({ scenario: 'pose p' + n, label: 'WM-06 life+fauna+beast JS p95 sum (ms, cap 8 = D-007)', value: v, cap: 8, verdict: v <= 8 ? 'PASS' : 'FLAG' });
const ten = Array.from({ length: 10 }, (_, i) => mk(i, 1 + i * 0.1));
const lg = benchLifeGates({ rows: [...ten, { scenario: 'in Outwall', label: 'x', value: 99, verdict: 'FLAG' }] });
assert.equal(lg.length, 11);
assert.ok(lg.every((r) => r.verdict === 'PASS'));
assert.equal(benchLifeGates({ rows: [...ten.slice(0, 9), mk(9, 9)] }).filter((r) => r.verdict === 'FAIL').length, 1); // slow pose only
assert.equal(benchLifeGates({ rows: ten.slice(0, 9) }).at(-1).verdict, 'FAIL'); // pose count

const pg = presetGates('table...\nGATE RTX ultra <= 7.5 ms GPU at roadSouth (imp on): 6.80 ms PASS\n');
assert.equal(pg[0].verdict, 'PASS');
assert.equal(pg[0].value, 6.8);
assert.equal(presetGates('GATE Intel high <= 10 ms GPU at roadSouth (imp on): 11.20 ms FAIL')[0].verdict, 'FAIL');
assert.equal(presetGates('GATE RTX ultra <= 7.5 ms GPU at roadSouth (imp on): no timers UNKNOWN')[0].verdict, 'FAIL');
assert.equal(presetGates('nothing')[0].verdict, 'FAIL');

assert.match(formatTable([...mapLoopGates(okLoop), ...lg]), /M5 EXIT: PASS \(16 gates\)/);
assert.match(formatTable(mapLoopGates(null)), /M5 EXIT: FAIL \(1 of 1\)/);
console.log('m5-exit.test ok');
