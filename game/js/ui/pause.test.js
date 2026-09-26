// US-062 pause gate unit tests (Node, no DOM). See game/js/ui/pause.js header.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPaused, resetSimAccumulator, installAutoPause, _resetAutoPauseForTest } from './pause.js';

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

test('resetSimAccumulator calls engine.loop.resetAccumulator() and no-ops when missing (US-069: real Loop API, not a direct _accumulator poke)', () => {
  let calls = 0;
  const engine = { loop: { resetAccumulator: () => { calls++; } } };
  resetSimAccumulator(engine);
  assert.equal(calls, 1);

  assert.doesNotThrow(() => resetSimAccumulator(null));
  assert.doesNotThrow(() => resetSimAccumulator(undefined));
  assert.doesNotThrow(() => resetSimAccumulator({}));
});

test('installAutoPause: only installs its listeners once per page (US-069, Queue 2 review: R restart must not stack listeners)', () => {
  _resetAutoPauseForTest();
  let addBlur = 0, addVis = 0;
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  globalThis.window = { addEventListener: (name) => { if (name === 'blur') addBlur++; } };
  globalThis.document = { addEventListener: (name) => { if (name === 'visibilitychange') addVis++; }, hidden: false };
  try {
    const first = installAutoPause();
    const second = installAutoPause();
    const third = installAutoPause();
    assert.equal(addBlur, 1, 'blur listener added exactly once');
    assert.equal(addVis, 1, 'visibilitychange listener added exactly once');
    assert.equal(second, first, 'later calls return the same handler, no new listeners');
    assert.equal(third, first);
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
    _resetAutoPauseForTest();
  }
});
