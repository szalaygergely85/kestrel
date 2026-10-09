import assert from 'node:assert/strict';
import { adapterSlug, makeBaseline, diffBaseline, formatBaselineDiff, baselineMismatch } from './gpucompare-baseline.mjs';

const rows = (o) => Object.entries(o).map(([name, pass]) => ({ name, pass }));
const base = makeBaseline(rows({ a: true, b: true, c: false, d: false }), { backend: 'webgpu', adapter: 'x', sha: 's', date: 'd' });
assert.equal(base.pass, 2); assert.equal(base.fail, 2); assert.equal(base.rows.c, 'FAIL');

// no change (known-FAIL c,d stay FAIL -> silent)
let d = diffBaseline(base, rows({ a: true, b: true, c: false, d: false }));
assert.ok(d.ok); assert.equal(formatBaselineDiff(d), 'no changes vs baseline');
// regress + fixed + new + missing
d = diffBaseline(base, rows({ a: false, c: true, d: false, e: false, f: true }));
assert.deepEqual(d.regress, ['a']); assert.deepEqual(d.fixed, ['c']);
assert.deepEqual(d.added.map((x) => x.name + x.verdict), ['eFAIL', 'fPASS']); assert.deepEqual(d.removed, ['b']);
assert.equal(d.ok, false);
assert.match(formatBaselineDiff(d), /PASS->FAIL {2}a/);
// new FAIL row is not a regression
assert.ok(diffBaseline(base, rows({ a: true, b: true, c: false, d: false, z: false })).ok);

assert.equal(baselineMismatch(base, { backend: 'webgpu', adapter: 'x' }), null);
assert.ok(baselineMismatch(base, { backend: 'webgl2', adapter: 'x' }));
assert.ok(baselineMismatch(base, { backend: 'webgpu', adapter: 'y' }));
assert.equal(adapterSlug('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11)'), 'angle-nvidia-nvidia-geforce-rtx-4060-direct3d11');
console.log('gpucompare-baseline: ok');
