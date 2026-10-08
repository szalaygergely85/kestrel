// S8-B2-05: WIND_AT_WGSL (common.wgsl.js) is the twin of the world wind sampler engine/world/wind.js (base vector, zones off).
// 5000 random fields/samples (incl. negative positions, far from the origin, large t, knot wrap) within 1e-5. node engine/render/gpu/wgsl/wind.wgsl.test.js
import assert from 'node:assert/strict';
import { WIND_AT_WGSL } from './common.wgsl.js';
import { compileFn } from './wgslProbe.js';
import { createWind, WIND_K_SIZE } from '../../../world/wind.js';
import { STEP } from '../../../core/loop.js';

assert.ok(!/%|\bround\s*\(|\bmod\s*\(|fract|sin\s*\(/.test(WIND_AT_WGSL), 'WGSL string rules (no raw %, round, GLSL mod/fract, no trig)');
assert.ok(WIND_AT_WGSL.includes(String(STEP)) && WIND_AT_WGSL.includes(`${WIND_K_SIZE}.0`), 'constants interpolated from the JS imports');
let K = null;
const windAt = compileFn(WIND_AT_WGSL, 'windAt', { windKnot: (i) => K[i], WIND_STEP: STEP, WIND_K_SIZE });
let seed = 987654321; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
let maxErr = 0; const w = [0, 0], s3 = [0, 0, 0];
for (let i = 0; i < 5000; i++) {
  const f = createWind({ dirDeg: rnd() * 360, speed: rnd() * 12, gust: { amp: rnd() * 1.5, periodSec: 0.5 + rnd() * 8, travel: 0.5 + rnd() * 30 } }, i + 1);
  const p = f.params; K = p.K;
  const x = (rnd() - 0.5) * 4000, y = (rnd() - 0.5) * 4000, t = rnd() * 7200 - 100;
  f._baseInto(x, y, t / STEP, w);
  f.sampleInto(x, y, 0, t / STEP, s3); // no zones: the full sample equals the base vector
  assert.ok(Math.abs(s3[0] - w[0]) < 1e-12 && Math.abs(s3[1] - w[1]) < 1e-12);
  const g = windAt(x, y, t, p.dirX, p.dirY, p.speed, p.amp, p.P, p.travel);
  maxErr = Math.max(maxErr, Math.abs(w[0] - g.x), Math.abs(w[1] - g.y));
}
assert.ok(maxErr < 1e-5, `JS vs WGSL probe max error ${maxErr}`);
console.log(`wind.wgsl: ok (5000 samples, max error ${maxErr})`);
