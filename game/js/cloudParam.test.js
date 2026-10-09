// S8-B2-12a NEEDS B1 item (2)/(3): parseCloudStrength clamping + the gpucompare "always 0" contract.
import assert from 'node:assert/strict';
import { parseCloudStrength } from './cloudParam.js';

// missing/empty -> default 0
assert.strictEqual(parseCloudStrength(null), 0);
assert.strictEqual(parseCloudStrength(undefined), 0);
assert.strictEqual(parseCloudStrength(''), 0);

// in-range passthrough
assert.strictEqual(parseCloudStrength('0'), 0);
assert.strictEqual(parseCloudStrength('1'), 1);
assert.strictEqual(parseCloudStrength('0.5'), 0.5);

// out-of-range clamps
assert.strictEqual(parseCloudStrength('-1'), 0);
assert.strictEqual(parseCloudStrength('2'), 1);

// bad values -> 0 (never throws - setCloudShadow is the one that throws on bad input)
assert.strictEqual(parseCloudStrength('nope'), 0);
assert.strictEqual(parseCloudStrength('NaN'), 0);
assert.strictEqual(parseCloudStrength(undefined), 0);

console.log('PASS cloudParam.test.js');
