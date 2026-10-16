// RND-NIGHT-RIM-03: moon rim rule (moonRim.js) + the lighting.js syncLiveSun hook + WGSL splice.
import assert from 'node:assert/strict';
import { moonRimK, moonRimAmount, setMoonRimEnabled, MOON_RIM_K, MOON_RIM_FAR_M } from './moonRim.js';
import { syncLiveSun } from './lighting.js';
import { LIGHT_WGSL, LIGHT_GI_WGSL, LIGHT_BLOCK } from './gpu/wgsl/light.wgsl.js';

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
const unit = () => { let x, y, z, l; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = Math.hypot(x, y, z); } while (l < 0.1 || l > 1); return [x / l, y / l, z / l]; };

// strength: zero by day, zero with the moon off / below the horizon, peak <= MOON_RIM_K, off switch
assert.equal(moonRimK(1.0, true, 0.8), 0, 'day (sunI 1)');
assert.equal(moonRimK(0.8, true, 0.8), 0, 'dusk sunI 0.8');
assert.equal(moonRimK(0.1, false, 0.8), 0, 'moon light off (gap)');
assert.equal(moonRimK(0.1, true, -0.2), 0, 'moon below the horizon');
assert.equal(moonRimK(0.1, true, 0.02), 0, 'moon on the horizon');
const kHigh = moonRimK(0.1, true, 0.9), kLow = moonRimK(0.1, true, 0.15);
assert.ok(kHigh > 0 && kHigh <= MOON_RIM_K && kLow > 0 && kLow < kHigh, 'scales with moon elevation');
setMoonRimEnabled(false); assert.equal(moonRimK(0.1, true, 0.9), 0, '?moonrim=0'); setMoonRimEnabled(true);

// per-cell: back-facing the moon = 0, far = 0 (never brighter than the sky, OB-209), bounded, parity f32 vs f64
const f = Math.fround;
function amount32(N, V, L, dist, k, farM) { // WGSL expression order in float32
  const ndl = f(f(f(N[0] * L[0]) + f(N[1] * L[1])) + f(N[2] * L[2]));
  if (ndl <= 0) return 0;
  const ndv = Math.max(f(f(f(N[0] * V[0]) + f(N[1] * V[1])) + f(N[2] * V[2])), 0), fr = f(1 - ndv);
  const t = Math.min(Math.max(f(f(dist - f(farM * 0.5)) / f(farM * 0.5)), 0), 1), s = f(f(t * t) * f(3 - f(2 * t)));
  return f(f(f(f(k * ndl) * fr) * fr) * f(1 - s));
}
const k = MOON_RIM_K;
let lit = 0, maxDiff = 0;
for (let i = 0; i < 4000; i++) {
  const N = unit(), V = unit(), L = unit(), dist = rnd() * 220;
  const a = moonRimAmount(N[0], N[1], N[2], V[0], V[1], V[2], L[0], L[1], L[2], dist, k, MOON_RIM_FAR_M);
  const ndl = N[0] * L[0] + N[1] * L[1] + N[2] * L[2];
  if (ndl <= 0) assert.equal(a, 0, 'back-facing the moon');
  if (dist >= MOON_RIM_FAR_M) assert.equal(a, 0, 'far terrain (>= 150 m) gets no rim');
  assert.ok(a >= 0 && a <= k + 1e-12, 'bounded by k');
  if (a > 0) lit++;
  maxDiff = Math.max(maxDiff, Math.abs(a - amount32(N, V, L, dist, k, MOON_RIM_FAR_M)));
}
assert.ok(lit > 500, 'random set exercises lit cells (' + lit + ')');
assert.ok(maxDiff < 1e-6, 'f32 twin within 1e-6 (' + maxDiff + ')');
assert.equal(moonRimAmount(0, 0, 1, 0, 0, 1, 0, 0, 1, 10, k, MOON_RIM_FAR_M), 0, 'face-on (N.V = 1) has no rim: it is an edge term');

// syncLiveSun hook: night + moon -> k>0; day -> 0; field exists once
const mk = (sunI, on, dz) => ({ sun: { col: new Float32Array([1, 1, 1]), dir: new Float32Array([0, 0, dz]), on }, _P: { liveLook: { sunI, sun: 0 }, timeOfDay: { d: { sunI: 1 } }, defaultTime: 'd', hue: [[1, 1, 1]] } });
const lt = mk(0.1, true, 0.7); syncLiveSun(lt, lt._P); assert.ok(lt.moonRim.k > 0, 'night hook');
const ld = mk(1.0, true, 0.7); syncLiveSun(ld, ld._P); assert.equal(ld.moonRim.k, 0, 'day hook');
const lg = mk(0.1, false, 0.7); syncLiveSun(lg, lg._P); assert.equal(lg.moonRim.k, 0, 'moon gap hook');

// WGSL splice: both light variants carry the same rule, uniform appended last, gated on k
for (const src of [LIGHT_WGSL, LIGHT_GI_WGSL]) {
  assert.ok(src.includes('fn moonRimAmount('), 'fn spliced');
  assert.ok(src.includes('if (u.rimA.x > 0.0)') && src.includes('MOON_RIM_COL * moonRimAmount(N, Vr, u.sunDir, dist, u.rimA.x, u.rimA.y)'), 'call site');
  assert.ok(src.indexOf('moonRimAmount(N, Vr') > src.indexOf('contactOcclQ('), 'rim after the contact AO');
}
assert.equal(LIGHT_BLOCK.field('rimA').word + 4, LIGHT_BLOCK.sizeWords, 'rimA is the last vec4');
console.log('moonRim.test ok');
