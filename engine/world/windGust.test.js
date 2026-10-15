// WIND-GUST-01: travelling gust bands (engine/world/wind.js gustBand). node engine/world/windGust.test.js
import assert from 'node:assert/strict';
import { createWind, gustBand, gustBandMul, GUST_BAND_AMP, GUST_BAND_V0, GUST_BAND_VK } from './wind.js';
import { STEP } from '../core/loop.js';

const f = createWind({ dirDeg: 70, speed: 6, gust: { amp: 0.3, periodSec: 3, travel: 10 } }, 5);
const { dirX, dirY, speed } = f.params;
// deterministic + bounded
let lo = 9, hi = -9;
for (let i = 0; i < 20000; i++) {
  const x = ((i * 7919) % 4001) - 2000, y = ((i * 104729) % 4001) - 2000, t = (i % 977) * 0.37;
  const a = gustBandMul(x, y, t, dirX, dirY, speed), b = gustBandMul(x, y, t, dirX, dirY, speed);
  assert.equal(a, b);
  const g = gustBand(x, y, t, dirX, dirY, speed); assert.ok(g >= 0 && g <= 1);
  lo = Math.min(lo, a); hi = Math.max(hi, a);
}
assert.ok(lo >= 1 - GUST_BAND_AMP - 1e-9 && hi <= 1 + GUST_BAND_AMP + 1e-9, `bounded ${lo} ${hi}`);
assert.ok(hi - lo > 0.6, `bands actually vary (${lo}..${hi})`);
// travels along the wind dir: the band pattern at (p + d*v*dt, t + dt) equals the pattern at (p, t) (pure downwind translation of the primary wave)
const v = GUST_BAND_V0 + GUST_BAND_VK * speed;
for (let i = 0; i < 200; i++) {
  const x = i * 13.7 - 900, y = i * 5.3 - 300, t = i * 0.9, dt = 2.5;
  const g0 = gustBand(x, y, t, dirX, dirY, speed), g1 = gustBand(x + dirX * v * dt, y + dirY * v * dt, t + dt, dirX, dirY, speed);
  assert.ok(Math.abs(g0 - g1) < 1e-9, `travels downwind ${g0} ${g1}`);
}
// base vector uses the bands; calm = no wind, no gust
const o = [0, 0], s3 = [0, 0, 0];
f._baseInto(12, -40, 100 / STEP, o); f.sampleInto(12, -40, 0, 100 / STEP, s3);
const m = f.gustMul(12, -40, 100 / STEP);
assert.ok(Math.abs(o[0] - s3[0] * m) < 1e-12 && Math.abs(o[1] - s3[1] * m) < 1e-12);
const calm = createWind(null, 1); calm._baseInto(3, 4, 99, o);
assert.ok(o[0] === 0 && o[1] === 0); assert.equal(calm.gustMul(3, 4, 99), 1);
console.log('windGust: ok (' + lo.toFixed(2) + '..' + hi.toFixed(2) + ')');
