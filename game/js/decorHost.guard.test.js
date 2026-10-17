// ENV-01-WIRE (arch 38.62): the decor run guard counts, disables on the first error, warns once and never rethrows.
import assert from 'node:assert/strict';
import { guardDecorRun } from './decorHost.js';
const calls = []; let boom = false;
const pass = { stats: { dispatches: 2 }, run() { if (boom) throw new Error('bad pipeline'); }, setMasks(...a) { calls.push(a); } };
const dbg = { total: 0, frameErrors: 0 }, warns = [];
guardDecorRun(pass, dbg, (m) => warns.push(m));
pass.run({}, null); pass.run({}, null);
assert.equal(dbg.total, 4); assert.equal(dbg.frameErrors, 0);
boom = true;
assert.doesNotThrow(() => pass.run({}, null));
for (let i = 0; i < 5; i++) assert.doesNotThrow(() => pass.run({}, null));
assert.equal(dbg.frameErrors, 1, 'counted once'); assert.equal(dbg.bad, true);
assert.equal(warns.length, 1); assert.match(warns[0], /bad pipeline/);
assert.deepEqual(calls, [[null, 0]]);
console.log('decorHost.guard: PASS');
