import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSafeSpots } from './safeSpots.js';

test('samples every 2 s, only when safe and moved >= 1 m', () => {
  const s = createSafeSpots();
  assert.equal(s.step(1, 0, 0, 0, 0, true), false);
  assert.equal(s.step(1, 0, 0, 0, 0, true), true);   // 2 s: first sample
  assert.equal(s.step(2, 0.5, 0, 0, 0, true), false); // moved < 1 m
  assert.equal(s.step(2, 5, 0, 0, 0, true), true);
  assert.equal(s.count, 2);
  s.step(1, 9, 0, 0, 0, false); s.step(1, 9, 0, 0, 0, true); // unsafe resets the timer
  assert.equal(s.count, 2);
});
test('ring keeps 8 newest; pick = newest >= 3 m away, honours isFree, falls back', () => {
  const s = createSafeSpots();
  for (let i = 0; i < 12; i++) s.step(2, i * 2, 0, 0, i, true);
  assert.equal(s.count, 8);
  let p = s.pick(22, 0, 0); // newest sample x=22 is on top of us, next 20 is 2 m (skipped), 18 is 4 m
  assert.equal(p.x, 18);
  p = s.pick(22, 0, 0, (x) => x < 15);
  assert.equal(p.x, 14); // newest free one
  p = s.pick(22, 0, 0, () => false);
  assert.equal(p.x, 18); // none free -> newest far-enough
  assert.equal(createSafeSpots().pick(0, 0, 0), null);
});
test('zero allocation per step', () => {
  const s = createSafeSpots(); s.step(2, 0, 0, 0, 0, true);
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) s.step(0.016, i, 0, 0, 0, true);
  assert.ok(process.memoryUsage().heapUsed - h0 < 2e6);
});
