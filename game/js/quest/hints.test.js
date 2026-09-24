// game/js/quest/hints.test.js (US-015, docs/architecture.md 7.6 item 9).
// Headless Node ESM, no framework. Run: node game/js/quest/hints.test.js
import { request, markDone, stepHints, resetHints, drawHints, pushHintDim, setPaletteColors, currentHintId } from './hints.js';
import { createSceneDim, resetSceneDim } from '../../../engine/index.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function makeUiStyle() {
  const s = {
    hint: { anchor: 'bottom-left', x: 2, yFromBottom: 2, maxOnScreen: 1, prefix: '> ', prefixColor: 'uiDim', text: 'uiHint', key: 'gold',
      plate: { pad: 1, bgMul: 0.35 }, fadeIn: 0.3, fadeOut: 0.5, timeout: 8.0 },
    hints: [
      { id: 'move', text: 'WASD move - Mouse look', keys: ['WASD', 'Mouse'], on: { type: 'event' } },
      { id: 'run', text: 'Shift run', keys: ['Shift'], on: { type: 'walkTime', sec: 10 } },
      { id: 'jump', text: '[Space] Jump', keys: ['[Space]'], on: { type: 'zone', zone: 'hintJump' } },
      { id: 'capture', text: 'Click to capture mouse', keys: ['Click'], on: { type: 'pointerUnlocked' } },
    ],
    storyHints: [
      { id: 'burner', text: 'The burner still glows. Take what light you can.', keys: [], on: { type: 'zone', zone: 'hintBurner', skipIfState: 'tower.lantern.taken' } },
      { id: 'climb', text: 'Climb. You cannot see the signal from down here.', keys: [], on: { type: 'zone', zone: 'hintClimb' } },
      { id: 'chart', text: 'Press M to read the chart.', keys: ['M'], on: { type: 'timer', sec: 20, skipIfState: 'ui.mapCard.opened' } },
    ],
  };
  setPaletteColors(s, { uiDim: '#6a6a78', uiHint: '#a9a390', gold: '#ffd24a' });
  return s;
}
function makeWorld(state = {}) { return { state }; }
function noSignals() { return { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false }; }

// ---- request/FIFO: one on screen at a time, in order ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld();
  request(world, uiStyle, 'move');
  request(world, uiStyle, 'run');
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('first requested hint shows first (FIFO)', currentHintId() === 'move');
  ok('hints.shown records the id once shown', world.state['hints.shown'].includes('move'));
  // fade in fully, then time out
  for (let i = 0; i < 100; i++) stepHints(world, uiStyle, 0.1, noSignals()); // 10s: fadeIn 0.3 + timeout 8.0 + fadeOut 0.5 all elapse
  ok('after timeout+fadeOut, the queued hint takes over', currentHintId() === 'run');
}

// ---- skipIfState: permanent skip, pushed to hints.done ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld({ 'tower.lantern.taken': true });
  request(world, uiStyle, 'burner');
  ok('skipIfState true: never queued', currentHintId() === null);
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('skipIfState true: never shown', currentHintId() !== 'burner');
  ok('skipIfState pushes the id to hints.done (permanent)', world.state['hints.done'].includes('burner'));
  request(world, uiStyle, 'burner'); // even if asked again (e.g. re-entering the zone)
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('still never shown once in hints.done', currentHintId() !== 'burner');
}

// ---- done-before-shown: markDone before it ever displays -> never shown ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld();
  request(world, uiStyle, 'jump');
  markDone(world, 'jump'); // player already jumped before entering the zone
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('done-before-shown: never shown', currentHintId() !== 'jump');
  ok('hints.done has it, hints.shown does not', world.state['hints.done'].includes('jump') && !world.state['hints.shown'].includes('jump'));
}

// ---- chart timer: 20s after arming, cancelled if M pressed first (markDone via signals.mPressed) ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld({ 'hints.chartT': 0 });
  for (let i = 0; i < 199; i++) stepHints(world, uiStyle, 0.1, noSignals()); // 19.9s
  ok('chart hint not yet requested before 20s', currentHintId() !== 'chart' && !(world.state['hints.shown'] || []).includes('chart'));
  stepHints(world, uiStyle, 0.2, noSignals()); // crosses 20s
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('chart hint requested/shown at 20s', currentHintId() === 'chart');
}
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld({ 'hints.chartT': 0 });
  stepHints(world, uiStyle, 5, { ...noSignals(), mPressed: true }); // M pressed well before 20s
  for (let i = 0; i < 250; i++) stepHints(world, uiStyle, 0.1, noSignals()); // run well past 20s
  ok('M pressed before 20s: chart hint never shows', currentHintId() !== 'chart' && !(world.state['hints.shown'] || []).includes('chart'));
}

// ---- 8s timeout ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld();
  request(world, uiStyle, 'move');
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('shown', currentHintId() === 'move');
  stepHints(world, uiStyle, 0.3, noSignals()); // fadeIn done
  stepHints(world, uiStyle, 8.0, noSignals()); // timeout crossed
  ok('still id "move" while fading out', currentHintId() === 'move');
  stepHints(world, uiStyle, 0.5, noSignals()); // fadeOut done
  ok('gone after fadeOut', currentHintId() !== 'move');
}

// ---- restart (deserialize) resets everything: a fresh world.state + resetHints() ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld();
  request(world, uiStyle, 'move');
  stepHints(world, uiStyle, 0.001, noSignals());
  ok('sanity: shown before "restart"', currentHintId() === 'move');
  // simulate deserialize(initialState): a brand-new state object + the 'world:loaded' handler calling resetHints()
  const freshWorld = makeWorld();
  resetHints();
  ok('after reset: nothing on screen', currentHintId() === null);
  request(freshWorld, uiStyle, 'move');
  stepHints(freshWorld, uiStyle, 0.001, noSignals());
  ok('the hint can show again post-restart (hints.shown was reset with world.state)', currentHintId() === 'move');
}

// ---- draw (fake RenderTarget): pushHintDim + drawHints don't throw, respect "no current" ----
{
  resetHints();
  const uiStyle = makeUiStyle();
  const world = makeWorld();
  const rt = { cols: 160, rows: 60, setCellRGB() {} };
  const dim = createSceneDim();
  resetSceneDim(dim);
  pushHintDim(rt, uiStyle, dim);
  ok('pushHintDim with no current hint is a no-op', dim.n === 0);
  drawHints(rt, uiStyle, null); // should not throw
  request(world, uiStyle, 'move');
  stepHints(world, uiStyle, 0.001, noSignals());
  pushHintDim(rt, uiStyle, dim);
  ok('pushHintDim with a current hint pushes one plate rect', dim.n === 1);
  drawHints(rt, uiStyle, null); // should not throw
  ok('drawHints with a current hint does not throw', true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
