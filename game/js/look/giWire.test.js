import assert from 'node:assert/strict';
import { resolveGI, createGIWire, GI_PRESET, giLoadOptions } from './giWire.js';
const r = (s, q) => resolveGI(new URLSearchParams(s), q);
assert.equal(resolveGI(new URLSearchParams("gi=1"), "ultra", false), null, "GI-PROBE-06-FIX: !wgActive (Canvas2D/WebGL2) -> null even with ?gi=1"); assert.ok(resolveGI(new URLSearchParams(""), "high", true));
assert.equal(r('', 'low'), null); for (const q of ['medium', 'high', 'ultra', 'extreme']) assert.ok(r('', q), q);
assert.equal(r('', undefined), null); assert.ok(r('gi=1', 'low')); assert.equal(r('gi=0', 'ultra'), null); assert.equal(r('gpucompare=1', 'high'), null);
assert.deepEqual(Object.keys(GI_PRESET), ['low', 'medium', 'high', 'ultra', 'extreme']);
const lights = { ambient: [0.2, 0.3, 0.4], sun: { col: [1, 0.9, 0.8] }, gi: null }, world = { giField: null };
const w = createGIWire(r('', 'high'), world, lights);
w.clock(10, false); w.sync(); assert.equal(lights.gi, null); assert.equal(w.st.version, 0, 'no field: no mix, old path');
const v0 = w.st.version; w.sync(); assert.equal(w.st.version, v0);
world.giField = { keyHours: [6, 9, 12, 15, 18, 20] }; w.sync();
assert.equal(lights.gi, w.st); assert.equal(w.st.version, v0 + 1); assert.ok(Math.abs(w.st.skyRGB[2] - 0.4) < 1e-6);
for (let i = 0; i < 1000; i++) w.sync(); assert.equal(w.st.version, v0 + 1, 'per-frame sync does not mix');
w.clock(11, false); assert.equal(w.st.version, v0 + 2);
world.giField = null; w.sync(); assert.equal(lights.gi, null);
console.log('giWire.test PASS');
// GI-PROBE-07: manifest -> expectHash (loader behaviour per hash is covered in engine/world/giLoader.test.js)
{
  const H = 'ab'.repeat(32), o1 = await giLoadOptions(async () => JSON.stringify({ z1: H }));
  assert.equal(o1.expectHash('z1'), H); assert.equal(o1.expectHash('zz'), null, 'zone not in manifest: no check');
  for (const bad of [null, 'junk']) assert.deepEqual(await giLoadOptions(async () => bad), {});
  assert.deepEqual(await giLoadOptions(async () => { throw new Error('x'); }), {});
}
console.log('giWire manifest PASS');
