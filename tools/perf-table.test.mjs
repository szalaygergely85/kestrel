import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pct, summarizeTrace, buildTable, machineId, loadTraces } from './perf-table.mjs';

// Real-shaped (route-walk-browser result) fixture, trimmed: 10 frames 1..10 ms.
const rec = (i) => ({ leg: '1 wake (timeline)', frame: i, simMs: 0.5, jsMs: 2, gpuMs: i / 2, intervalMs: i + 1 });
const fixture = (extra = {}) => ({
  backend: 'webgpu', physicsMode: 'mesh', legs: [{ name: '1 wake (timeline)' }],
  perf: { shadowPassP50: 0.8, shadowPassP95: 1.5 },
  frameRecords: Array.from({ length: 10 }, (_, i) => rec(i)), ...extra,
});

// nearest-rank: n=10, p50 -> idx 5, p95 -> idx 9
assert.equal(pct([5, 1, 3, 2, 4, 9, 8, 7, 6, 10], 0.5), 6);
assert.equal(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
assert.equal(pct([], 0.5), null);
assert.equal(pct([NaN, 2], 0.5), 2);

const s = summarizeTrace(fixture());
assert.equal(s.frames, 10);
assert.equal(s.frameP50, 6); assert.equal(s.frameP95, 10);
assert.equal(s.gpuP50, 2.5); assert.equal(s.wgP50, 0.8);
assert.equal(summarizeTrace(null), null);
assert.equal(summarizeTrace({ frameRecords: [] }), null);
assert.equal(summarizeTrace(fixture({ perf: {} })).wgP50, null);

const t = buildTable({ low: fixture(), high: fixture({ perf: {} }) }, 'arc-a770');
const lines = t.trim().split('\n');
assert.equal(lines[0], 'Machine: arc-a770');
assert.ok(lines[2].startsWith('| preset | backend | frames | frame p50 ms | frame p95 ms'));
assert.equal(lines[4], '| low | webgpu | 10 | 6.00 | 10.00 | 2.50 | 4.50 | 0.80 | 1.50 |');
assert.equal(lines[5], '| medium | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
assert.ok(lines[6].endsWith('| - | - |')); // high: no wg pass data
assert.ok(lines[7].startsWith('| ultra | n/a'));

assert.equal(machineId('My GPU!', {}), 'my-gpu');
assert.equal(machineId(null, { low: { adapter: 'Intel Arc A770' } }), 'intel-arc-a770');

const dir = mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
writeFileSync(path.join(dir, 'trace-low.webgpu-low.json'), JSON.stringify(fixture()));
writeFileSync(path.join(dir, 'trace-low.frametrace.csv'), 'x');
writeFileSync(path.join(dir, 'trace-ultra.webgpu-ultra.json'), 'not json');
const loaded = loadTraces(dir);
assert.deepEqual(Object.keys(loaded), ['low']);

const h = spawnSync(process.execPath, [new URL('./perf-table.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--help'], { encoding: 'utf8' });
assert.equal(h.status, 0);
assert.match(h.stdout, /--from/);

console.log('perf-table.test: ok');
