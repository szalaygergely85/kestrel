// tools/flicker-gate.test.mjs: node tools/flicker-gate.test.mjs
import { compare, extractPoses, formatTable } from './flicker-gate.mjs';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL ' + m); } };
const mk = (a, b, avg) => ({ poses: { wallNear: { totalPct: 6, glyphOnlyPct: a }, wallFar: { totalPct: 8, glyphOnlyPct: b } }, avg: { totalPct: 7, glyphOnlyPct: avg } });
const base = mk(10, 7, 8);
ok(compare(mk(10, 7, 8), base).ok, 'equal passes');
const up = compare(mk(12, 7, 8), base); // 12 > 10*1.15+0.3 = 11.8
ok(!up.ok && up.rows.find((r) => r.pose === 'wallNear').verdict === 'FAIL', 'pose +20% fails');
ok(compare(mk(10.9, 7.3, 8.5), base).ok, 'noise within margin passes');
ok(!compare(mk(10, 7, 9.1), base).ok, 'avg over 8*1.1+0.2=9.0 fails');
const miss = compare({ poses: { wallNear: { totalPct: 6, glyphOnlyPct: 10 } }, avg: { glyphOnlyPct: 8 } }, base);
ok(!miss.ok && miss.messages.some((m) => /wallFar.*missing/.test(m)), 'missing pose fails with message');
ok(formatTable(up).includes('FLICKER GATE: FAIL'), 'table prints verdict');
const ex = extractPoses({ 'poses.a.totalPct': 1, 'poses.a.glyphOnlyPct': 2, 'poses.a.n': 5, 'avg.glyphOnlyPct': 3, avgTotalPct: 4 });
ok(ex.poses.a.glyphOnlyPct === 2 && ex.avg.glyphOnlyPct === 3 && ex.avg.totalPct === 4 && !('n' in ex.poses.a), 'extract');
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('flicker-gate: all passed');
