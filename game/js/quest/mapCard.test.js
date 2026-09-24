// game/js/quest/mapCard.test.js (US-015, docs/architecture.md 7.6 item 9).
// Headless Node ESM, no framework. Run: node game/js/quest/mapCard.test.js
import { initMapCard, stepMapCard, isMapOpen, getMapPanel } from './mapCard.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

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

// ---- first show: gated on wakeT >= titleDoneAtSec + delaySec, not before ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': false, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  const titleDoneAtSec = 7.5;

  stepMapCard(world, assets, 1 / 60, input, 5.0, titleDoneAtSec); // well before the delay
  ok('not shown before titleDoneAtSec+delay', !world.state['ui.mapCard.shown'] && getMapPanel().state === 'closed');

  stepMapCard(world, assets, 1 / 60, input, titleDoneAtSec + 0.5, titleDoneAtSec);
  ok('first show fires at titleDoneAtSec+delaySec', world.state['ui.mapCard.shown'] === true && getMapPanel().state === 'opening');
}

// ---- minShowSec: cannot dismiss before 1.0s, even with a key press ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': false, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  stepMapCard(world, assets, 1 / 60, input, 100, 0); // show immediately (titleDoneAtSec=0, wakeT way past delay)
  ok('sanity: shown', world.state['ui.mapCard.shown'] === true);

  input._press('KeyE');
  for (let i = 0; i < 30; i++) { stepMapCard(world, assets, 1 / 60, input, 100 + i / 60, 0); } // 0.5s, still under minShowSec, key held the whole time
  ok('still open before minShowSec (1.0s) elapses', isMapOpen() === true);
  ok('the held key was never consumed early', input.pressed('KeyE') === true);

  for (let i = 0; i < 40; i++) { stepMapCard(world, assets, 1 / 60, input, 100.5 + i / 60, 0); } // cross 1.0s with the key still "pressed"
  ok('dismissible once minShowSec has elapsed', world.state['ui.mapCard.dismissed'] === true);
  ok('the dismissing key was consumed', input.pressed('KeyE') === false);
  ok('hints.chartT armed to 0 on first dismissal', world.state['hints.chartT'] === 0);
}

// ---- M reopen: no minShowSec, only after first dismissal, blocked while ending ----
{
  const assets = makeAssets();
  initMapCard(assets, 160, 60);
  const world = makeWorld({ 'ui.mapCard.shown': true, 'ui.mapCard.dismissed': false, 'quest.endT': -1 });
  const input = fakeInput();
  input._press('KeyM');
  stepMapCard(world, assets, 1 / 60, input, 100, 0);
  // Arch review: first show is derived from state (shown && !dismissed), so a state restored mid-first-show
  // resumes the card; M must not toggle it or count as the first `M` open.
  ok('M does nothing before the first dismissal (restored first show resumes, not an M open)',
    getMapPanel().state === 'opening' && world.state['ui.mapCard.opened'] !== true);

  world.state['ui.mapCard.dismissed'] = true;
  initMapCard(assets, 160, 60); // fresh closed panel, as after a load with the card already dismissed
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
