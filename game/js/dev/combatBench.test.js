import assert from 'node:assert/strict';
import { buildCombatScene, evalBudget, formatLine } from './combatBench.js';

const a = buildCombatScene(7), b = buildCombatScene(7), c = buildCombatScene(8);
assert.deepEqual(a, b, 'deterministic per seed');
assert.notDeepEqual(a.beasts, c.beasts, 'seed changes the ring phase');
assert.equal(a.beasts.length, 4);
for (let i = 0; i < 4; i++) {
  assert.ok(Math.abs(Math.hypot(a.beasts[i].x, a.beasts[i].z) - 7) < 0.01, 'ring r=7');
  for (let j = i + 1; j < 4; j++) assert.ok(Math.hypot(a.beasts[i].x - a.beasts[j].x, a.beasts[i].z - a.beasts[j].z) >= 6, 'beasts >= 6 m apart');
}
for (let i = 1; i < a.script.length; i++) assert.ok(a.script[i].tMs >= a.script[i - 1].tMs, 'script sorted');
const acts = a.script.map((s) => s.action);
assert.equal(acts.filter((x) => x === 'swing').length, 5);
assert.equal(acts.filter((x) => x === 'backstep').length, 1);

const flat = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
const r = evalBudget(flat, { p95Max: 96, avgMax: 51 });
assert.equal(r.p50, 51); assert.equal(r.p95, 96); assert.equal(r.avg, 50.5);
assert.equal(r.pass, true);
assert.equal(evalBudget(flat, { p95Max: 95, avgMax: 60 }).pass, false, 'p95 over -> FAIL');
assert.equal(evalBudget(flat, { p95Max: 100, avgMax: 50 }).pass, false, 'avg over -> FAIL');
assert.equal(evalBudget([], {}).pass, false);
assert.match(formatLine(evalBudget([2, 3, 4], {}), 8), /^combat bench: p50 3\.00 p95 4\.00 avg 3\.00 PASS \(budget 8 ms\)$/);
console.log('combatBench.test PASS');
