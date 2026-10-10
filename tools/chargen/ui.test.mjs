// CHARGEN-13: pure parts of ui.js (no DOM).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlsFor, applyControl, readControl, debounce, seedFromText } from './ui.js';
import { loadKit } from './export.mjs';

const kit = loadKit();
test('controlsFor: base controls from the kit', () => {
  const c = controlsFor(kit), by = Object.fromEntries(c.map((x) => [x.key, x]));
  assert.deepEqual(c.slice(0, 5).map((x) => x.key), ['base', 'height', 'age', 'skin', 'eyes']);
  assert.deepEqual(by.skin.options.map((o) => o.value), Object.keys(kit.ramps.skin));
  assert.equal(by.height.min, -4); assert.equal(by.height.max, 4);
});
test('applyControl <-> readControl round trip, input untouched', () => {
  const r0 = JSON.parse(JSON.stringify(kit.defaults));
  const r1 = applyControl(r0, 'skin', 'dark'); assert.equal(r1.skin, 'dark'); assert.equal(r0.skin, 'medium');
  assert.equal(applyControl(r0, 'height', '9').height, 4);
  const ctl = { key: 'hat', kind: 'item', ramps: Object.keys(kit.ramps.hat) };
  const r2 = applyControl(r1, 'hat', 'cap', 'id', kit); assert.deepEqual(readControl(r2, ctl), { id: 'cap', ramp: ctl.ramps[0] });
  const r3 = applyControl(r2, 'hat', 'woad', 'ramp', kit); assert.deepEqual(r3.hat, { id: 'cap', ramp: 'woad' });
  assert.equal(applyControl(r3, 'hat', '', 'id', kit).hat, null);
  assert.deepEqual(readControl(r0, ctl), { id: '', ramp: ctl.ramps[0] });
});
test('debounce: trailing, last args win, cancel', () => {
  const q = []; let n = 1;
  const timers = { setTimeout: (f, ms) => { q.push({ f, ms, id: n }); return n++; }, clearTimeout: (id) => { const i = q.findIndex((x) => x.id === id); if (i >= 0) q.splice(i, 1); } };
  const calls = []; const d = debounce((v) => calls.push(v), 150, timers);
  d(1); d(2); d(3);
  assert.equal(q.length, 1); assert.equal(q[0].ms, 150);
  q.shift().f(); assert.deepEqual(calls, [3]);
  d(4); d.cancel(); assert.equal(q.length, 0);
});
test('seedFromText: number, word hash, empty uses rnd', () => {
  assert.equal(seedFromText('42'), 42);
  assert.equal(seedFromText('abc'), seedFromText(' abc '));
  assert.notEqual(seedFromText('abc'), seedFromText('abd'));
  assert.equal(seedFromText('', () => 0.5), Math.floor(0.5 * 0x7fffffff));
});
