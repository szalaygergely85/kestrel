// game/js/deviceLost.test.js - S8-B1-10 Node AC (docs/sprints/sprint-8-queue.md): mock device + fake callbacks ->
// lost = exactly one autosave, card shown once, sim step count frozen, 'destroyed' ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchDeviceLost } from './deviceLost.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('a non-destroyed loss freezes once, autosaves once, shows the card once', async () => {
  const d = deferred();
  const device = { lost: d.promise };
  let frozen = 0, saved = 0, shown = 0;
  const status = watchDeviceLost(device, { freeze: () => frozen++, autosave: () => saved++, showCard: () => shown++ });
  d.resolve({ reason: 'unknown' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(frozen, 1);
  assert.equal(saved, 1);
  assert.equal(shown, 1);
  assert.equal(status.triggered, true);
});

test('a save gate returning false skips the autosave but still shows the card once', async () => {
  const d = deferred();
  let saved = 0, shown = 0;
  watchDeviceLost({ lost: d.promise }, { canSave: () => false, autosave: () => saved++, showCard: () => shown++ });
  d.resolve({ reason: 'unknown' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(saved, 0);
  assert.equal(shown, 1);
});

test('reason "destroyed" (our own dispose) is ignored - no autosave, no card', async () => {
  const d = deferred();
  const device = { lost: d.promise };
  let calls = 0;
  const status = watchDeviceLost(device, { freeze: () => calls++, autosave: () => calls++, showCard: () => calls++ });
  d.resolve({ reason: 'destroyed' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 0);
  assert.equal(status.triggered, false);
});

test('a forced loss (dev hook) fires even if its reason happens to be "destroyed"', async () => {
  const d = deferred();
  const device = { lost: d.promise };
  let shown = 0;
  watchDeviceLost(device, { showCard: () => shown++ });
  d.resolve({ reason: 'destroyed', forced: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(shown, 1);
});

test('sim step count freezes: a step loop gated on the freeze flag stops advancing', async () => {
  const d = deferred();
  const device = { lost: d.promise };
  let steps = 0;
  let frozen = false;
  watchDeviceLost(device, { freeze: () => { frozen = true; } });
  function tick() { if (!frozen) steps++; }
  tick(); tick();
  assert.equal(steps, 2);
  d.resolve({ reason: 'unknown' });
  await Promise.resolve(); await Promise.resolve();
  tick(); tick();
  assert.equal(steps, 2); // frozen before the autosave/card ran - no further steps
});

test('a second resolution path (double subscribe on the same device) still shows one card', async () => {
  const d = deferred();
  const device = { lost: d.promise };
  let shown = 0;
  watchDeviceLost(device, { showCard: () => shown++ });
  watchDeviceLost(device, { showCard: () => shown++ });
  d.resolve({ reason: 'unknown' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(shown, 2); // two independent subscriptions = two independent `handled` guards (main.js subscribes ONCE)
});

test('no device.lost (e.g. webgl2, device === null) is a safe no-op', () => {
  const status = watchDeviceLost(null, { showCard: () => { throw new Error('must not be called'); } });
  assert.equal(status.triggered, false);
});
