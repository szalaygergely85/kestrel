// allocProbe self-test: a leaking loop is caught, a clean loop reads ~0, no gc -> skipped (not pass).
import { allocProbe } from './allocProbe.mjs';
let fail = 0; const ok = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${x}`); if (!c) fail++; };
if (typeof globalThis.gc !== 'function') { console.log('SKIP allocProbe.test (no --expose-gc)'); process.exit(0); }
const keep = [];
const leak = allocProbe((n) => { keep.length = 0; for (let i = 0; i < n; i++) keep.push({ a: i, b: [i] }); }, { n: 2000 });
ok('leaking loop measured > 40 B/call', leak.perCall > 40, `${leak.perCall.toFixed(1)}`);
const buf = new Float64Array(4);
const clean = allocProbe((n) => { for (let i = 0; i < n; i++) buf[i & 3] += i; }, { n: 20000 });
ok('clean loop < 1 B/call', clean.perCall < 1, `${clean.perCall.toFixed(2)}`);
const leakC = allocProbe((n) => { for (let i = 0; i < n; i++) keep.push({ a: i }); if (keep.length > 4000) keep.length = 0; }, { n: 2000, chunk: 100, settle: 5, limit: 1 });
ok('chunk + settle: a leaking loop is still caught (settle cannot hide steady garbage)', leakC.perCall > 10, `${leakC.perCall.toFixed(1)}`);
const cleanC = allocProbe((n) => { for (let i = 0; i < n; i++) buf[i & 3] += i; }, { n: 20000, chunk: 1000, settle: 5, limit: 1 });
ok('chunk: clean loop < 1 B/call, n rounded to chunks', cleanC.perCall < 1 && cleanC.n === 20000, `${cleanC.perCall.toFixed(2)}`);
const g = globalThis.gc; globalThis.gc = undefined;
const sk = allocProbe(() => {}); globalThis.gc = g;
ok('no gc -> skipped', sk.skipped === true);
process.exit(fail ? 1 : 0);
