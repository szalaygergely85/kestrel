// ENV-01d: the gpucompare harness lists the two decorGpu rows (decorMeadow, decorFord) and keeps every existing row decor=cpu
// (only the shared decor world sets `decorGpu`). Source-level check (the rows need a real renderer, run by the main session).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./gpucompare.js', import.meta.url), 'utf8');
for (const n of ['decorMeadow', 'decorFord']) assert.ok(src.includes('world_m1: ' + n + ' (ENV-01d, decorGpu'), 'row ' + n);
assert.equal((src.match(/\.decorGpu = true/g) || []).length, 1, 'exactly one world turns decorGpu on (the two decor rows share it)');
assert.equal((src.match(/decorGpu: true/g) || []).length, 1, 'only the dpose helper tags rows decorGpu');
console.log('gpucompare.decor.test OK');
