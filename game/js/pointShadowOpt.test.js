import { parsePointShadows } from './pointShadowOpt.js';
import assert from 'node:assert/strict';
const P = (s) => new URLSearchParams(s);
assert.equal(parsePointShadows(P(''), 'high').pointShadows, false);
assert.equal(parsePointShadows(P('pointshadows=0'), 'high').pointShadows, false);
assert.equal(parsePointShadows(P('pointshadows=1'), 'high').pointShadows, true);
assert.deepEqual(parsePointShadows(P('pointshadows=4'), 'high'), { pointShadows: { n: 4 }, pointShadowLevel: 'high' });
assert.equal(parsePointShadows(P('pointshadows=on'), null).pointShadowLevel, undefined);
console.log('pointShadowOpt OK');
