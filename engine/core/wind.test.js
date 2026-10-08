// engine/core/wind.test.js (S8-B2-05): wind field determinism, defaults, and JS vs WGSL twin (wgslProbe) within 1e-5.
// Run: node engine/core/wind.test.js
import assert from 'node:assert/strict';
import { windAt, windAtParams, windParams, WIND_DEFAULT } from './wind.js';
import { WIND_AT_WGSL } from '../render/gpu/wgsl/common.wgsl.js';
import { compileFn } from '../render/gpu/wgsl/wgslProbe.js';
import * as engine from '../index.js';

assert.equal(engine.windAt, windAt, 'exported from engine/index.js');

// defaults: zero wind everywhere
for (const [x, z, t] of [[0, 0, 0], [123.4, -77, 9.5], [-2000, 3000, 1e4]]) {
  const w = windAt(x, z, t);
  assert.equal(w.x, 0); assert.equal(w.z, 0);
  const w2 = windAt(x, z, t, WIND_DEFAULT); assert.equal(w2.x, 0); assert.equal(w2.z, 0);
}
// no gust = constant vector along the direction
const c = windAt(10, 20, 3, { dirDeg: 90, speed: 4 });
assert.ok(Math.abs(c.x) < 1e-12 && Math.abs(c.z - 4) < 1e-12, `constant wind ${c.x},${c.z}`);
// deterministic: same inputs, same output, any call order
const o = { dirDeg: 37, speed: 6, gust: 0.8 };
const a = windAt(55.5, -12.25, 7.75, o), b = windAt(1, 1, 1, o), a2 = windAt(55.5, -12.25, 7.75, o);
assert.deepEqual(a, a2); assert.notDeepEqual(a, b);
// bounds: magnitude in [0, ~2.1 speed]; gusts vary in space and time
let minM = Infinity, maxM = 0;
for (let i = 0; i < 4000; i++) {
  const w = windAt((i * 37.3) % 900 - 450, (i * 11.7) % 900 - 450, i * 0.37, o);
  const m = Math.hypot(w.x, w.z);
  minM = Math.min(minM, m); maxM = Math.max(maxM, m);
}
assert.ok(maxM <= 2.1 * o.speed && maxM > 1.3 * o.speed, `max ${maxM}`);
assert.ok(minM < 0.7 * o.speed, `min ${minM}`);
// params clamping
assert.deepEqual(Array.from(windParams({ speed: -3, gust: 5 })), [1, 0, 0, 1]);

// JS vs WGSL probe (5000 samples, incl. far from the origin and large t)
const wgsl = compileFn(WIND_AT_WGSL, 'windAt', { sin: Math.sin });
let seed = 987654321; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
let maxErr = 0;
for (let i = 0; i < 5000; i++) {
  const opt = { dirDeg: rnd() * 360, speed: rnd() * 12, gust: rnd() };
  const x = (rnd() - 0.5) * 4000, z = (rnd() - 0.5) * 4000, t = rnd() * 7200;
  const p = windParams(opt);
  const js = windAtParams(x, z, t, p), g = wgsl(x, z, t, p[0], p[1], p[2], p[3]);
  maxErr = Math.max(maxErr, Math.abs(js.x - g.x), Math.abs(js.z - g.y));
}
assert.ok(maxErr < 1e-5, `JS vs WGSL probe max error ${maxErr}`);
assert.ok(!/%|\bround\s*\(|\bmod\s*\(|fract/.test(WIND_AT_WGSL), 'WGSL string rules (no raw %, round, GLSL mod/fract)');
console.log(`wind: ok (probe max error ${maxErr})`);
