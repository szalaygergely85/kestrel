import assert from 'node:assert';
import { parseTable, parseBenchLine, evaluate } from './perf-gate.mjs';

const budgets = { _note: 'x', low: { p95Ms: 16.7 }, medium: { p95Ms: 12 }, high: { p95Ms: 8 }, ultra: { p95Ms: 8 }, combat: { p95Ms: 8 } };
const H = 'Machine: m\n\n| preset | backend | frames | frame p50 ms | frame p95 ms | gpu p50 ms | gpu p95 ms | wg pass p50 ms | wg pass p95 ms |\n|---|---|---|---|---|---|---|---|---|\n';
const row = (p, v) => `| ${p} | webgpu | 100 | 1.00 | ${v} | 1 | 2 | 1 | 2 |\n`;
const seed = (t) => ({ low: null, medium: null, high: null, ultra: null, ...parseTable(t) });

// pass
let r = evaluate(seed(H + row('low', '10.00') + row('medium', '9.00') + row('high', '7.00') + row('ultra', '8.00')), budgets);
assert.equal(r.fail, false); assert.equal(r.lines.length, 4);
// fail
r = evaluate(seed(H + row('low', '10.00') + row('medium', '9.00') + row('high', '8.01') + row('ultra', '3.00')), budgets);
assert.equal(r.fail, true); assert.ok(r.lines.some((l) => l.startsWith('FAIL high')));
// missing preset (n/a row + absent row) -> warn, no fail
r = evaluate(seed(H + row('low', '10.00') + '| medium | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |\n' + row('high', '7') ), budgets);
assert.equal(r.fail, false); assert.equal(r.warn, true); assert.equal(r.lines.filter((l) => l.startsWith('WARN')).length, 2);
// json table
assert.deepEqual(parseTable('{"presets":{"low":{"frameP95":5},"high":{"p95Ms":9}}}'), { low: 5, high: 9 });
// bench line
const bl = parseBenchLine('noise\ncombat bench: p50 1.20 p95 9.50 avg 2.00 FAIL (budget 8 ms)\n');
assert.deepEqual(bl, { p95: 9.5, budget: 8 });
assert.equal(evaluate({ combat: bl.p95 }, budgets).fail, true);
assert.equal(evaluate({ combat: parseBenchLine('combat bench: p50 1 p95 3 avg 2 PASS (budget 8 ms)').p95 }, budgets).fail, false);
assert.equal(parseBenchLine('nothing'), null);
console.log('perf-gate tests OK');
