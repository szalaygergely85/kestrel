import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHitStop, hitStopEnabled } from './hitStop.js';

const P = (s) => new URLSearchParams(s);

test('window exact, scale 0 inside / dt outside', () => {
  const h = createHitStop({ heavyMs: 70, lightMs: 50 });
  assert.equal(h.scale(10), 10);
  h.trigger('heavy');
  let frozen = 0, steps = 0;
  while (h.remainingMs > 0) { assert.equal(h.scale(10), 0); frozen += 10; steps++; }
  assert.equal(frozen, 70); assert.equal(steps, 7); assert.equal(h.scale(10), 10);
  h.trigger('light'); // partial boundary step
  assert.equal(h.scale(16), 0); assert.equal(h.scale(16), 0); assert.equal(h.scale(16), 0); assert.equal(h.scale(16), 16 - 2);
});

test('stacking caps at 120 and never accumulates across frames', () => {
  const h = createHitStop();
  h.trigger('heavy'); h.trigger('heavy'); h.trigger('heavy');
  assert.equal(h.remainingMs, 120);
  for (let i = 0; i < 100; i++) h.scale(16.6667);
  assert.equal(h.remainingMs, 0);
  h.trigger('light'); assert.equal(h.remainingMs, 50);
});

test('fake clock: a 70 ms freeze delays a boar windup by exactly 70 ms, no drift', () => {
  const WINDUP_STEPS = 30, DT = 10; // stub boar: windup counted in sim steps
  const run = (freeze) => {
    const h = createHitStop(); if (freeze) h.trigger('heavy');
    let t = 0, timer = WINDUP_STEPS;
    while (timer > 0) { t += DT; if (h.due(DT)) timer--; }
    return t;
  };
  assert.equal(run(true) - run(false), 70);
  // 60 Hz: sim time lags by 70 ms to within one step (the accumulator carries the fraction, no drift over 1000 steps)
  const h = createHitStop(); h.trigger('heavy');
  const dt = 1000 / 60; let simMs = 0, realMs = 0;
  for (let i = 0; i < 1000; i++) { realMs += dt; if (h.due(dt)) simMs += dt; }
  assert.ok(Math.abs((realMs - simMs) - 70) < dt + 1e-6, `lag ${realMs - simMs}`);
});

test('deterministic and zero-alloc over 1e5 steps', () => {
  const a = createHitStop(), b = createHitStop(); let ca = 0, cb = 0;
  for (let i = 0; i < 1e5; i++) {
    if (i % 997 === 0) { a.trigger('heavy'); b.trigger('heavy'); }
    if (a.due(1000 / 60)) ca++; if (b.due(1000 / 60)) cb++;
  }
  assert.equal(ca, cb);
  global.gc && global.gc();
  const m0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1e5; i++) { if (i % 500 === 0) a.trigger('light'); a.due(1000 / 60); }
  assert.ok(process.memoryUsage().heapUsed - m0 < 2e6);
});

test('off under fx=0, capture, bench, bench=combat, compare', () => {
  assert.equal(hitStopEnabled(P(''), false), true);
  assert.equal(hitStopEnabled(P('fx=0'), false), false);
  assert.equal(hitStopEnabled(P('capture=1'), false), false);
  assert.equal(hitStopEnabled(P('bench=combat'), false), false);
  assert.equal(hitStopEnabled(P(''), true), false);
  const off = createHitStop({ enabled: false }); off.trigger('heavy'); assert.equal(off.due(16), true);
});
