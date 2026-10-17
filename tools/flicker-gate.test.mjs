// tools/flicker-gate.test.mjs: node tools/flicker-gate.test.mjs
import { gateQuery, defaultTable, DEFAULT_POSE_MARGIN, DEFAULT_AVG_MARGIN, compare, extractPoses, formatTable, summarizeRuns, whyTable, pickFreshCapture } from './flicker-gate.mjs';
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
const sm = summarizeRuns([mk(5, 7, 6), mk(7.5, 7.1, 6.3), mk(5.2, 7.2, 6.4)]);
ok(sm.poses.wallNear.glyphOnlyPct === 5.2 && Math.abs(sm.spread.wallNear.spread - 2.5) < 1e-9 && sm.avg.glyphOnlyPct === 6.3, 'summarizeRuns median + spread');
const ex2 = extractPoses({ 'poses.a.glyphOnlyPct': 2, 'poses.a.glyphOnlyRawPct': 5, 'poses.a.shiftPct': 3, 'avg.glyphOnlyRawPct': 6, 'avg.shiftPct': 4 });
ok(ex2.poses.a.glyphOnlyRawPct === 5 && ex2.poses.a.shiftPct === 3 && ex2.avg.shiftPct === 4, 'extract raw + shift');
const cmpRaw = compare({ poses: { wallNear: { totalPct: 6, glyphOnlyPct: 2, glyphOnlyRawPct: 5, shiftPct: 3 }, wallFar: { glyphOnlyPct: 7 } }, avg: { glyphOnlyPct: 8, glyphOnlyRawPct: 9, shiftPct: 1 } }, base);
ok(/raw%/.test(formatTable(cmpRaw)) && /5\.00/.test(formatTable(cmpRaw)), 'table prints raw + shift');
const wt = whyTable({ 'poses.wallNear.why.glyphOnlyPct': 5, 'poses.wallNear.why.edge': 1.5, 'poses.wallNear.totalPct': 6 });
ok(/wallNear/.test(wt) && /1\.50/.test(wt) && whyTable({ 'poses.wallNear.totalPct': 6 }) === '', 'whyTable prints why.* rows, empty without diag');
let threw = false; try { pickFreshCapture([{ n: 'old', t: 1000 }], 2000); } catch (e) { threw = /stale/.test(e.message); }
ok(threw, 'stale capture -> throws (gate FAIL, exit 1)');
ok(pickFreshCapture([{ n: 'old', t: 1000 }, { n: 'new', t: 3000 }], 2000) === 'new', 'fresh capture picked');
// FD-01: default-path query + margins + class table
ok(/flickerdef=1/.test(gateQuery('default', false)) && !/flickerdiag/.test(gateQuery('default', false)), 'default path query has flickerdef=1');
ok(!/flickerdef/.test(gateQuery('stable', true)) && /flickerdiag=1/.test(gateQuery('stable', true)) && /stable=1/.test(gateQuery('stable', false)), 'stable path query: stable=1, no flickerdef');
const dm = { pose: DEFAULT_POSE_MARGIN, avg: DEFAULT_AVG_MARGIN };
ok(compare(mk(10.3, 7, 8), base, dm).ok && !compare(mk(10.31, 7, 8), base, dm).ok, 'default path: baseline + 0.3 abs');
const dtab = defaultTable({ 'poses.wallNear.glyphOnlyPct': 3.5, 'poses.wallNear.why.glyphOnlyPct': 4, 'poses.wallNear.stillPct': 0.5, 'poses.wallNear.why.levelTex': 2, 'poses.wallNear.why.edge': 1, 'poses.wallNear.why.levelTex/jump': 0.5 });
ok(/wallNear/.test(dtab) && /\(50\)/.test(dtab) && /\(25\)/.test(dtab) && defaultTable({}) === '', 'defaultTable shares');
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('flicker-gate: all passed');
