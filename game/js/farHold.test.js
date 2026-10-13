// node game/js/farHold.test.js  (OB-109)
import assert from 'node:assert';
import { createFarHold, landFraction } from './farHold.js';
import { createBootProgress } from '../../engine/core/bootProgress.js';
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
console.log('farHold.test.js: all checks passed.');
