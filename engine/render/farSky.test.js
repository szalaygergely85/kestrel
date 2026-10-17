// VISQA-02 Node test: far fog follows the sky gradient at the cell's own elevation (fogShape.js farSkyPrep / farSkyShiftJS,
// twin of WGSL farSkyShift). Off (no atmos / farSkyW 0) = zero shift; at / below the horizon = zero; high cells = w * (sky(e) - sky(0)).
import assert from 'node:assert/strict';
import { fogShapeCtx, farSkyPrep, farSkyOff, farSkyActive, farSkyShiftJS } from './fogShape.js';
import { SKY_LUT_N } from './gpu/wgsl/skyLut.js';

const P = { materials: { sky: { elevTop: 45 } }, timeOfDay: { day: { sky: [{ t: 0, c: 'hz' }, { t: 1, c: 'top' }] } }, defaultTime: 'day',
  rgb: { hz: [240, 220, 180], top: [90, 140, 220] }, atmos: { on: false, farSkyW: 1 }, liveFogVersion: 1 };
fogShapeCtx.mode = 0;
fogShapeCtx.terms = /** @type {any} */ ({ cols: 100, dirX: 0, dirY: -1, planeX: 1, planeY: 0, horizonRow: 50, planeDistY: 50 });
const out = [0, 0, 0];

assert.equal(farSkyPrep({ ...P, atmos: null }), 0, 'no atmos -> off'); assert.equal(farSkyActive(), false);
assert.deepEqual(farSkyShiftJS(50, 0, out), [0, 0, 0], 'off -> zero shift');

assert.equal(farSkyPrep(P), 1); assert.equal(farSkyActive(), true);
assert.deepEqual(farSkyShiftJS(50, 50, out), [0, 0, 0], 'horizon row -> zero');
assert.deepEqual(farSkyShiftJS(50, 70, out), [0, 0, 0], 'below the horizon -> zero');
const top = farSkyShiftJS(50, 0, [0, 0, 0]); // tanE = 1 -> 45 deg = elevTop -> last LUT texel = top colour
assert.ok(Math.abs(top[0] - (90 - 240)) < 1e-3 && Math.abs(top[2] - (220 - 180)) < 1e-3, 'elevTop -> sky top - horizon: ' + top);
const mid = farSkyShiftJS(50, 40, [0, 0, 0]); // ~11.3 deg: partial, bluer than the horizon, less than the top
const e = Math.atan2(10, 50) * 180 / Math.PI, k = Math.floor(e / 45 * (SKY_LUT_N - 1) + 0.5) / (SKY_LUT_N - 1);
assert.ok(Math.abs(mid[0] - k * (90 - 240)) < 1e-3, 'LUT index rounding matches the WGSL rule: ' + mid[0] + ' vs ' + k * -150);
P.atmos.farSkyW = 0.5; P.liveFogVersion = 2; farSkyPrep(P);
assert.ok(Math.abs(farSkyShiftJS(50, 0, out)[0] - 0.5 * (90 - 240)) < 1e-3, 'weighted by the biome share');
farSkyOff(); assert.deepEqual(farSkyShiftJS(50, 0, out), [0, 0, 0], 'farSkyOff -> zero');
fogShapeCtx.terms = null;
console.log('farSky.test: ok');
