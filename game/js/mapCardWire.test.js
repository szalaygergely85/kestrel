// game/js/mapCardWire.test.js (S8-B1-15 MAP-01c wiring: `M` toggles the chart).
// main.js itself is not importable (top-level await, canvas/DOM, real content fetches) - mapCard.test.js already
// covers mapCard.js's own state machine exhaustively (first-show latch, fade timings, etc.). This test exercises
// the exact contract main.js wires on top of that public API (initMapCard/stepMapCard/isMapOpen, unchanged by
// S8-C-14/15): M opens, Esc (or any key) closes, and - the part that is main.js's own responsibility, not
// mapCard.js's - no player input reaches the sim while the card is open. main.js gates every sim-facing input
// path (`invView.step`, `uiLockedNow`, `paused`) with the same `isMapOpen()` read this test uses directly, so a
// fake "sim" gated the identical way stands in for that wiring without needing a canvas.
import assert from 'node:assert/strict';
import { initMapCard, stepMapCard, isMapOpen, getMapPanel } from './quest/mapCard.js';

const model = {
  size: { w: 5, h: 3 }, keys: {},
  layout: { top: 20, centerX: 80 },
  animations: { show: { durations: [1000], frames: [{ S: { glyphs: ['#####', '#   #', '#####'], fg: [' . . ', '.   .', ' . . '] } }] } },
};
function makeAssets() {
  return {
    palette: { colors: {} },
    uiStyle: {
      uiGrid: { cols: 160, rows: 60 },
      mapCard: { fadeIn: 0.4, fadeOut: 0.25, minShowSec: 1.0, sceneDim: { bgMul: 0.35 }, plate: { pad: 1, bgMul: 0.18 }, showOnce: { delaySec: 0.5 } },
    },
    model(key) { if (key !== 'mapCard') throw new Error('unknown model ' + key); return model; },
  };
}
function fakeInput() {
  let pressedSet = new Set();
  return {
    _press(code) { pressedSet.add(code); },
    pressed(code) { return pressedSet.has(code); },
    anyPressed() { return pressedSet.size > 0; },
    consumePressed() { pressedSet.clear(); },
  };
}

const assets = makeAssets();
initMapCard(assets, 160, 60); // same call main.js makes (minus the optional S8-B1-15 chartOptions 4th arg)
// Past the first-show latch (US-015) so `M` is live from frame 1, same as a world already past its wake sequence.
const world = { state: { 'ui.mapCard.shown': true, 'ui.mapCard.dismissed': true, 'quest.endT': -1 } };
const input = fakeInput();

// Stand-in "sim": only moves while `!isMapOpen()` - the exact gate main.js reads at every input-facing call site
// (`invView.step(dt, input, !ending && !isMapOpen() && ...)`, `uiLockedNow = ... || isMapOpen() || ...`).
let simX = 0;
function simTick(dx) { if (!isMapOpen()) simX += dx; }

assert.equal(isMapOpen(), false, 'closed at boot');
simTick(1);
assert.equal(simX, 1, 'input reaches the sim while the chart is closed');

input._press('KeyM');
stepMapCard(world, assets, 1 / 60, input, 100, 0);
input.consumePressed();
assert.equal(isMapOpen(), true, 'M opens the chart');

simTick(1);
assert.equal(simX, 1, 'no player input reaches the sim while the chart is open');

input._press('Escape'); // stepMapCard: any key closes while open, not just M
stepMapCard(world, assets, 1 / 60, input, 100, 0);
input.consumePressed();
assert.equal(getMapPanel().state, 'closing', 'Esc triggers close() on the very next step');
simTick(1);
assert.equal(simX, 1, 'still blocked mid fade-out (not closed yet)');
for (let i = 0; i < 20; i++) stepMapCard(world, assets, 1 / 60, input, 100, 0); // let fadeOut (0.25s) finish
assert.equal(isMapOpen(), false, 'Esc closes the chart once fadeOut completes');

simTick(1);
assert.equal(simX, 2, 'input reaches the sim again once the chart is closed');

// M toggles both ways (open then close), same as the physical key binding main.js reads (`KeyM`).
input._press('KeyM');
stepMapCard(world, assets, 1 / 60, input, 100, 0);
input.consumePressed();
assert.equal(isMapOpen(), true, 'M re-opens');
simTick(1);
assert.equal(simX, 2, 'still blocked after re-opening');

input._press('KeyM');
stepMapCard(world, assets, 1 / 60, input, 100, 0);
input.consumePressed();
for (let i = 0; i < 20; i++) stepMapCard(world, assets, 1 / 60, input, 100, 0);
assert.equal(isMapOpen(), false, 'a second M closes it again (any-key-closes rule, not M-specific)');
simTick(1);
assert.equal(simX, 3, 'unblocked again after the second toggle');

console.log('mapCardWire: M opens, Esc/any key closes, toggles both ways, no sim input reaches through while open PASS');
