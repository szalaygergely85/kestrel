import assert from 'node:assert/strict';
import { pickQuality, parseGrid, runShot, resultLine, withTimeout } from './still-robust.mjs';
assert.equal(pickQuality(undefined, {}), 'high');
assert.equal(pickQuality(undefined, { QUALITY: 'medium' }), 'medium');
assert.equal(pickQuality('ultra', { QUALITY: 'medium' }), 'ultra');
assert.throws(() => pickQuality('mega'));
assert.deepEqual(parseGrid('480x180'), { w: 480, h: 180 });
assert.throws(() => parseGrid('480'));
// retry: first attempt hangs (timeout), recover called once, second passes
let rec = 0;
let r = await runShot((n) => n === 0 ? new Promise(() => {}) : Promise.resolve('x'), { timeoutMs: 20, recover: async () => { rec++; } });
assert.deepEqual([r.ok, r.value, r.attempts, rec], [true, 'x', 2, 1]);
assert.match(resultLine('a', r), /^PASS a \(attempt 2\)/);
// both fail -> FAIL, no throw
r = await runShot(async () => { throw new Error('boom'); }, { timeoutMs: 50 });
assert.equal(r.ok, false); assert.equal(r.attempts, 2); assert.match(resultLine('b', r), /^FAIL b .*boom/);
// retries 0 -> single attempt, recover not called
rec = 0; r = await runShot(async () => { throw new Error('e'); }, { retries: 0, recover: async () => { rec++; } });
assert.deepEqual([r.attempts, rec], [1, 0]);
await assert.rejects(withTimeout(new Promise(() => {}), 10), /timeout/);
console.log('still-robust ok');
