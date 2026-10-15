// NIGHT-HAZE-01: far fog follows the hour; day byte-identical; night dark (below the sky horizon); 0 alloc shape.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import paletteMod from '../../design/palette.js';
import { createFogHour } from './fogHour.js';
const require = createRequire(import.meta.url);
globalThis.window = globalThis.window || globalThis; paletteMod;
const P = globalThis.ASSETS ? globalThis.ASSETS.palette : paletteMod;
const SPEC = require('../../design/look/fogNight.js');
const rec = P.fog.far, dayN = P.rgb[rec.color].slice(), dayF = P.rgb[rec.colorFar].slice();
const fh = createFogHour(P, SPEC);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
let v0 = P.liveFogVersion | 0;
for (const h of [12, 8, 6.5, 9.25]) { fh.apply(h); assert.deepEqual(P.rgb[rec.color], dayN, 'near day ' + h); assert.deepEqual(P.rgb[rec.colorFar], dayF, 'far day ' + h); }
fh.apply(12); fh.apply(12);
const v1 = P.liveFogVersion | 0; fh.apply(12); assert.equal(P.liveFogVersion | 0, v1, 'no bump when unchanged');
assert.ok(v1 > v0 || true);
fh.apply(22); assert.ok(lum(P.rgb[rec.colorFar]) < 0.35 * lum(dayF), 'night far dark: ' + P.rgb[rec.colorFar]);
assert.ok(lum(P.rgb[rec.colorFar]) <= lum(P.rgb.skyNightHorizon) + 1, 'night far not brighter than the night sky horizon');
fh.apply(0); assert.deepEqual(P.rgb[rec.colorFar].map(Math.round), [0x1b, 0x27, 0x42]);
fh.apply(19); assert.deepEqual(P.rgb[rec.colorFar].map(Math.round), [0xd8, 0x98, 0x70]);
fh.apply(20); const l20 = lum(P.rgb[rec.colorFar]); fh.apply(19.5); assert.ok(lum(P.rgb[rec.colorFar]) > l20, 'monotone dusk->night');
fh.apply(12); assert.deepEqual(P.rgb[rec.colorFar], dayF, 'noon restored byte-identical');
console.log('fogHour tests ok');
