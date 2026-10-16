// FOLIAGE-CAP-BENCH: verdict/table logic. Run: node tools/bench-foliage-cap.test.mjs
import assert from 'node:assert';
import { evaluate, limitFor, formatResult, parseArgs, pct } from './bench-foliage-cap.mjs';
const mk = (tris, p95) => ({ tris, gpu: [p95 - 1, p95 - 1], gpu95: [p95, p95], js: [3, 4] });
assert.equal(limitFor('rtx', 'ultra'), 8); assert.equal(limitFor('rtx', 'high'), 8);
assert.equal(limitFor('intel', 'high'), 10); assert.equal(limitFor('intel', 'ultra'), null);
let ev = evaluate([mk(5e5, 4), mk(1e6, 6), mk(1.5e6, 7.9), mk(2e6, 8.5), mk(3e6, 7)], 8);
assert.equal(ev.cap, 1.5e6); assert.equal(ev.firstOver, 2e6); assert.equal(ev.verdict, 'CAP'); // a later pass never rescues
assert.equal(evaluate([mk(5e5, 9), mk(1e6, 12)], 8).verdict, 'NONE');
assert.equal(evaluate([mk(5e5, 2), mk(1e6, 3)], 8).verdict, 'ALL');
ev = evaluate([mk(5e5, 2), { tris: 1e6, gpu: [NaN], gpu95: [NaN], js: [1] }], 8);
assert.equal(ev.verdict, 'UNKNOWN'); assert.equal(ev.cap, 5e5);
assert.equal(evaluate([mk(5e5, 2)], null).verdict, 'UNKNOWN');
assert.equal(evaluate([mk(5e5, 10)], 10).verdict, 'ALL'); // limit is inclusive
const r = formatResult(evaluate([mk(5e5, 4), mk(1e6, 9)], 8)); assert.match(r.summary, /0\.5 M/); assert.match(r.table, /OVER/);
assert.equal(pct([1, 2, 3, 4], 0.5), 2);
assert.equal(parseArgs(['--gpu', 'intel', '--quality', 'high', '--port', '9730']).port, 9730);
assert.throws(() => parseArgs(['--gpu', 'x']));
console.log('bench-foliage-cap.test: all ok');
