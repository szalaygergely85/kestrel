// US-062 pause gate unit tests (Node, no DOM). See game/js/ui/pause.js header.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPaused, resetSimAccumulator } from './pause.js';

test('isPaused: true only while unlocked, map closed and not ending', () => {
  assert.equal(isPaused({ ending: false, look: { locked: false }, isMapOpen: () => false }), true);
  assert.equal(isPaused({ ending: false, look: { locked: true }, isMapOpen: () => false }), false);
  assert.equal(isPaused({ ending: false, look: { locked: false }, isMapOpen: () => true }), false);
  assert.equal(isPaused({ ending: true, look: { locked: false }, isMapOpen: () => false }), false);
  assert.equal(isPaused({ ending: false, look: null, isMapOpen: () => false }), false);
});

test('pause gate: N steps while paused run 0 sim steps; resume runs normally', () => {
  let simSteps = 0;
  const look = { locked: false }; // unlocked = paused overlay up, click-to-lock not yet done
  const isMapOpen = () => false;

  function fixedStep() {
    if (isPaused({ ending: false, look, isMapOpen })) return; // main.js's own early-out
    simSteps++;
  }

  for (let i = 0; i < 20; i++) fixedStep();
  assert.equal(simSteps, 0, 'no sim step should run while paused');

  look.locked = true; // player clicked to resume
  for (let i = 0; i < 7; i++) fixedStep();
  assert.equal(simSteps, 7, 'every step should run once resumed');
});

test('resetSimAccumulator zeroes engine.loop._accumulator and no-ops when missing', () => {
  const engine = { loop: { _accumulator: 0.183 } };
  resetSimAccumulator(engine);
  assert.equal(engine.loop._accumulator, 0);

  assert.doesNotThrow(() => resetSimAccumulator(null));
  assert.doesNotThrow(() => resetSimAccumulator(undefined));
  assert.doesNotThrow(() => resetSimAccumulator({}));
});
