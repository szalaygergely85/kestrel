// 38.8a 26b: the gpucompare rays-2 block must dispose its second pipeline (its constructor re-hooks rt.setCellPass).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('./gpucompare.js', import.meta.url), 'utf8');
const a = src.indexOf('const pipeline2 = new base2.constructor'), b = src.indexOf('INFO n=2', a), c = src.indexOf('if (rayParam === 2)', a);
assert.ok(a > 0 && b > a, 'rays-2 block found');
const tail = src.slice(b, b + 1200);
assert.ok(/pipeline2\.dispose\(\)/.test(tail), 'pipeline2.dispose() after the per-pose loop');
assert.ok(/base2\.setEnabled\(true\)/.test(tail), 'rays-1 pipeline gets its hook back');
void c;
console.log('gpucompare.pipeline2.test.js: pipeline2 disposed after the rays-2 block.');
