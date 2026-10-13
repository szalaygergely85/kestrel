// game/js/quest/mapCard.test.js (US-015, docs/architecture.md 7.6 item 9).
// Headless Node ESM, no framework. Run: node game/js/quest/mapCard.test.js
import { initMapCard, stepMapCard, isMapOpen, getMapPanel, getMapChart } from './mapCard.js';
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

// ---- WS1-07a: travel markers, digits, setMarker, pick ----
{
  const assets = makeAssets();
  assets.palette.colors = { pencil: '#808080', aetherDim: '#336699', chartInk: '#555555', uiText: '#ffffff', ferrum: '#996633',
    gold: '#ffcc00', chartEdge: '#444444', aether: '#66ccff' };
  const W = 96, R = 16;
  const chart = { chartVersion: 1, width: W, rows: R, shadeLevels: 16, bounds: { x0: 0, y0: 0, x1: 400, y1: 160 },
    categories: ['grass'], glyphs: Array(R).fill('0'.repeat(W)), shades: Array(R).fill('8'.repeat(W)) };
  const pts = [{ id: 'waystone', name: 'The Waystone', x: 100, y: 80, order: 1 }, { id: 'ws_roadBend', name: 'Bend Relay', x: 300, y: 80, order: 2 }];
  let src = [pts[0]];
  const travel = { list: () => src };
  initMapCard(assets, 160, 60, { chart, width: 96, rows: 16, markers: [{ x: 100, y: 80, kind: 'waystone' }, { x: 300, y: 80, kind: 'relay' }], travel });
  const cv = getMapChart(), art = cv.art;
  const cellAt = (x, y) => { const i = (1 + Math.floor(y * 14 / 160)) * 96 + 1 + Math.floor(x * 94 / 400); return String.fromCharCode(art.codes[i]); };
  ok('untouched relay shows o, stone O before opening', cellAt(300, 80) === 'o' && cellAt(100, 80) === 'O');
  const world = makeWorld({ 'ui.mapCard.shown': true, 'ui.mapCard.dismissed': true, 'quest.endT': -1, }); world.get = () => null;
  const input = fakeInput(); const got = [];
  cv.onTravel = (id) => got.push(id);
  input._press('KeyM'); stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('open: one woken point shows digit 1, relay stays o', cellAt(100, 80) === '1' && cellAt(300, 80) === 'o' && cv.travelLine.includes('1 The Waystone'));
  ok('travel line has header and no second entry', cv.travelLine.startsWith('Travel: press a number') && !cv.travelLine.includes('Bend'));
  let bottom = ''; for (let x = 0; x < 96; x++) bottom += String.fromCharCode(art.codes[15 * 96 + x]);
  ok('travel line drawn on the bottom row', bottom.includes('Travel: press a number'));
  input._clearFrame(); input._press('Digit2'); stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('digit without target = normal close, no travel', got.length === 0 && getMapPanel().state === 'closing');
  for (let i = 0; i < 40; i++) stepMapCard(world, assets, 1 / 60, input, 100, 0);
  src = pts; // relay woken
  input._clearFrame(); input._press('KeyM'); stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('two woken: digits 1 and 2, line lists both', cellAt(100, 80) === '1' && cellAt(300, 80) === '2' && cv.travelLine.includes('1 The Waystone  2 Bend Relay'));
  input._clearFrame(); input._press('Digit2'); stepMapCard(world, assets, 1 / 60, input, 100, 0);
  ok('digit 2 emits onTravel(ws_roadBend) and closes', got.length === 1 && got[0] === 'ws_roadBend' && getMapPanel().state === 'closing');
  for (let i = 0; i < 40; i++) stepMapCard(world, assets, 1 / 60, input, 100, 0);
  src = [pts[0]]; cv.refreshTravel();
  ok('back to one point: relay cell restored to o, bottom row border again', cellAt(300, 80) === 'o' && !cv.travelLine.includes('Bend'));
  // setMarker: permanent wake marker, quest kinds intact
  ok('setMarker off-map false', cv.setMarker(-5, 5, 'waystone') === false);
  cv.setQuestMarkers([{ kind: 'quest', x: 200, y: 40 }]);
  ok('quest marker still drawn', cellAt(200, 40) === '!');
  cv.setMarker(300, 80, 'waystone');
  ok('setMarker relay->O', cellAt(300, 80) === 'O' && cellAt(200, 40) === '!');
  cv.setQuestMarkers([]); cv.setTravelPoints(pts);
  ok('digits survive quest clear', cellAt(300, 80) === '2' && cellAt(100, 80) === '1');
  let threw = false; try { cv.setMarker(10, 10, 'bogus'); } catch { threw = true; }
  ok('invalid kind throws', threw);
  // draw-path (updatePose) allocation: heap stays flat
  if (global.gc) { cv.updatePose(50, 50, 90); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 1e5; i++) cv.updatePose(50 + (i & 7), 50, 90); global.gc(); ok('no alloc in pose/draw path', process.memoryUsage().heapUsed - h0 < 200000); }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
