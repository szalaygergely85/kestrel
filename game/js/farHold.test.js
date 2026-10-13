// node game/js/farHold.test.js  (OB-109)
import assert from 'node:assert';
import { createFarHold, landFraction, landBarFraction } from './farHold.js';
import { createBootProgress } from '../../engine/index.js';
// fake terrain: 10 rows, one row per bakeFarStep call
const mk = () => ({ farReady: false, row: 0, bakeProgress: 0, bakeFarStep() { if (++this.row >= 10) this.farReady = true; this.bakeProgress = this.row / 10; } });
const t = mk(); const h = createFarHold({ budgetMs: 5 });
assert.strictEqual(h.begin(t), true); assert.strictEqual(h.active, true);
const bp = createBootProgress(); bp.phase('frame'); const before = bp.state.value;
let guard = 0, last = before;
while (h.active) { h.step(); bp.fraction('land', h.frac); assert.ok(bp.state.value >= last); last = bp.state.value; assert.ok(++guard < 100); }
assert.strictEqual(h.slices, 10); assert.strictEqual(t.farReady, true); assert.strictEqual(h.frac, 1);
assert.ok(Math.abs(bp.state.value - 1) < 1e-9, 'land 100 % = bar 100 %'); assert.ok(before < 0.6 + 1e-9, 'frame phase ends before props');
assert.strictEqual(h.step(), false, 'no-op once released');
assert.strictEqual(h.begin(t), false, 'already baked: no hold'); assert.strictEqual(h.active, false);
assert.strictEqual(h.begin(null), false); assert.strictEqual(landFraction(null), 1);
const t2 = mk(); h.begin(t2); h.step(); assert.ok(h.active && h.frac === 0.1, 'holds until farReady, not before');
// OB109-B3: far bake = 0..0.5, band pre-bake = 0.5..1, monotone, ends at 1
{
  const ft = mk(), world = { n: 0, prebakeBands() { if (this.n < 5 && this._called) this.n++; this._called = true; return { done: this.n >= 5, total: 5, cached: this.n }; } };
  const hh = createFarHold({ budgetMs: 5 }); assert.strictEqual(hh.begin(ft, world), true);
  let lastF = hh.frac, g = 0, sawHalf = false;
  while (hh.active) { hh.step(); assert.ok(hh.frac >= lastF - 1e-9, 'monotone'); lastF = hh.frac; if (ft.farReady && hh.frac >= 0.5 && hh.frac < 1) sawHalf = true; assert.ok(++g < 100); }
  assert.ok(sawHalf && hh.frac === 1 && world.n === 5 && ft.farReady, 'both halves ran');
  assert.strictEqual(landBarFraction(1, 0, true), 0.5); assert.strictEqual(landBarFraction(0.4, 0, false), 0.4);
  const done = createFarHold({}); assert.strictEqual(done.begin({ farReady: true }, { prebakeBands: () => ({ done: true, total: 5, cached: 5 }) }), false, 'all cached: no hold');
}
console.log('farHold.test.js: all checks passed.');
