// S8-B2-12a NEEDS B1 item (2)/(3): parseCloudStrength clamping + the gpucompare "always 0" contract.
// S8-B2-20 NEEDS B1 item (1): parseAoStrength shares the same clamp helper - same table, different param name.
import assert from 'node:assert/strict';
import { parseCloudShadowFlag, devCloudShadow, parseAoStrength } from './cloudParam.js';

// ?cloudshadow=1 flag: only "1" turns it on
assert.strictEqual(parseCloudShadowFlag(null), false);
assert.strictEqual(parseCloudShadowFlag(''), false);
assert.strictEqual(parseCloudShadowFlag('0'), false);
assert.strictEqual(parseCloudShadowFlag('1'), true);
const dc = devCloudShadow();
assert.ok(dc.strength > 0 && dc.strength <= 1 && dc.scale > 0 && dc.soft > 0 && dc.deckH > 0 && dc.wind.length === 2);
assert.notStrictEqual(devCloudShadow(), dc, 'fresh object per call');

// parseAoStrength: same clamp table, `?ao=` instead of `?clouds=`
assert.strictEqual(parseAoStrength(null), 0);
assert.strictEqual(parseAoStrength(''), 0);
assert.strictEqual(parseAoStrength('0'), 0);
assert.strictEqual(parseAoStrength('1'), 1);
assert.strictEqual(parseAoStrength('0.5'), 0.5);
assert.strictEqual(parseAoStrength('-1'), 0);
assert.strictEqual(parseAoStrength('2'), 1);
assert.strictEqual(parseAoStrength('nope'), 0);

console.log('PASS cloudParam.test.js');
