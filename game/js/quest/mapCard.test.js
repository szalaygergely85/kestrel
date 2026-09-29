// game/js/quest/mapCard.test.js (US-015, docs/architecture.md 7.6 item 9).
// Headless Node ESM, no framework. Run: node game/js/quest/mapCard.test.js
import { initMapCard, stepMapCard, isMapOpen, getMapPanel } from './mapCard.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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
    _clearFrame() { pressedSet = new Set(); },
  };
}

function makeWorld(state) { return { state }; }

// ---- no auto-show: M is inert until the latch fires at titleDoneAtSec+delaySec ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': false, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  const titleDoneAtSec = 7.5;

  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 5.0, titleDoneAtSec); // well before the delay
  ok('not shown before titleDoneAtSec+delay, M inert', !world.state['ui.mapCard.dismissed'] && getMapPanel().state === 'closed');

  stepMapCard(world, assets, 1 / 60, input, titleDoneAtSec + 0.5, titleDoneAtSec);
  ok('first show fires at titleDoneAtSec+delaySec', world.state['ui.mapCard.shown'] === true);
  ok('the card panel never opens on its own', getMapPanel().state === 'closed');
}

// ---- the latch dismisses immediately (no minShowSec), arms the chart hint ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': false, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  stepMapCard(world, assets, 1 / 60, input, 100, 0); // titleDoneAtSec=0, wakeT way past delay
  ok('dismissed latches in the same step as shown', world.state['ui.mapCard.shown'] === true && world.state['ui.mapCard.dismissed'] === true);
  ok('panel stayed closed throughout', getMapPanel().state === 'closed');
  ok('hints.chartT armed to 0 on the latch', world.state['hints.chartT'] === 0);
}

// ---- M reopen: only after the latch, blocked while ending ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': true, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 100, 0);
  // Restored state with shown && !dismissed latches immediately rather than ever locking M out;
  // M must not toggle it or count as the first `M` open on that same step.
  ok('M does nothing on the latching step (restored first show just latches, not an M open)',
    getMapPanel().state === 'closed' && world.state['ui.mapCard.opened'] !== true && world.state['ui.mapCard.dismissed'] === true);

  input._clearFrame();
  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('M opens after the first dismissal', isMapOpen() === true && world.state['ui.mapCard.opened'] === true);

  input._clearFrame();
  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 100, 0); // no minShowSec gate: this same step already starts closing
  ok('reopen triggers close() on the very next step (no minShowSec wait)', getMapPanel().state === 'closing');
  for (let i = 0; i < 20; i++) stepMapCard(world, assets, 1 / 60, input, 100, 0); // let fadeOut (0.25s) finish
  ok('closed once fadeOut completes', isMapOpen() === false);

  world.state['quest.endT'] = 0; // now ending
  input._clearFrame();
  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('M does nothing once the end sequence has started', isMapOpen() === false);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
