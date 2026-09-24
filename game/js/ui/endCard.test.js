// game/js/ui/endCard.test.js (US-015 re-check of US-017, docs/architecture.md
// 7.6 item 9). Headless Node ESM, no framework. Run: node game/js/ui/endCard.test.js
import { computeEndCardState, drawEndCard } from './endCard.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const uiStyle = {
  uiGrid: { cols: 160, rows: 60 },
  fade: { sec: 2.0 },
  endText: {
    walkSec: 1.5, gapSec: 1.5, cps: 30, key: 'gold',
    cursor: { glyph: '_', color: 'uiText', periodSec: 1.0, duty: 0.5, line: 'restart' },
    lines: [
      { id: 'signal', row: 29, typed: true, color: 'uiText', text: 'Signal.', alt: 'Relay wakes. Signal.', altWhen: 'tower.beacon.lit' },
      { id: 'someone', row: 30, typed: true, color: 'uiText', text: 'Someone.' },
      { id: 'continue', row: 32, typed: false, color: 'uiHint', text: '- to be continued -', afterGap: true },
      { id: 'restart', row: 34, typed: false, color: 'uiText', text: '[R] Wake again', keys: ['[R]'], afterGap: true, cursor: true, enablesRestart: true },
    ],
  },
};
const paletteColors = { uiText: '#e8e2d0', uiHint: '#a9a390', gold: '#ffd24a' };

function world(state) { return { state }; }

// ---- not ending: invisible ----
{
  const st = computeEndCardState(world({ 'quest.endT': -1 }), uiStyle);
  ok('endT=-1: not visible', st.visible === false);
}

// ---- walk/fade phase: visible=false until text phase starts ----
{
  const st = computeEndCardState(world({ 'quest.endT': 1.0 }), uiStyle); // < walkSec
  ok('during the walk: not visible yet', st.visible === false);
}

// ---- typed lines, sequential, per-line colour, alt text ----
{
  const endT = 1.5 + 2.0 + 0.1; // walkSec + fadeSec + a hair into text
  const st = computeEndCardState(world({ 'quest.endT': endT, 'tower.beacon.lit': false }), uiStyle);
  ok('visible once text phase starts', st.visible === true);
  const signal = st.lines.find((l) => l.id === 'signal');
  ok('signal line uses the default (not-lit) text', signal.text === 'Signal.');
  ok('signal line count is partial (typing)', signal.count > 0 && signal.count < signal.text.length);
  ok('signal line colour comes from uiStyle', signal.color === 'uiText');
}
{
  const endT = 1.5 + 2.0 + 0.1;
  const st = computeEndCardState(world({ 'quest.endT': endT, 'tower.beacon.lit': true }), uiStyle);
  const signal = st.lines.find((l) => l.id === 'signal');
  ok('altWhen true switches to the alt text', signal.text === 'Relay wakes. Signal.');
}

// ---- after both typed lines + gapSec: continue/restart appear, cursor blinks ----
{
  const dur1 = 'Signal.'.length / 30, dur2 = 'Someone.'.length / 30;
  const endT = 1.5 + 2.0 + dur1 + dur2 + 1.5 + 0.01; // just past gapSec
  const st = computeEndCardState(world({ 'quest.endT': endT }), uiStyle);
  const restart = st.lines.find((l) => l.id === 'restart');
  const cont = st.lines.find((l) => l.id === 'continue');
  ok('continue + restart lines present after the gap', !!cont && !!restart);
  ok('restart line uses its own colour', restart.color === 'uiText');
  ok('canRestart true once the restart line (enablesRestart) is up', st.canRestart === true);
}

// ---- cursor blink: 1s period, 50% duty ----
{
  const dur1 = 'Signal.'.length / 30, dur2 = 'Someone.'.length / 30;
  const base = Math.ceil(1.5 + 2.0 + dur1 + dur2 + 1.5) + 10; // a round integer, well past the gap threshold
  const onT = world({ 'quest.endT': base + 0.1 }); // within the first half of a 1s period (endT%1 = 0.1)
  const offT = world({ 'quest.endT': base + 0.6 }); // within the second half (endT%1 = 0.6)
  ok('cursor on during the first half of the period', computeEndCardState(onT, uiStyle).cursorOn === true);
  ok('cursor off during the second half', computeEndCardState(offT, uiStyle).cursorOn === false);
}

// ---- draw: no throw, uses per-line colour + key colour + cursor from uiStyle ----
{
  const dur1 = 'Signal.'.length / 30, dur2 = 'Someone.'.length / 30;
  const endT = 1.5 + 2.0 + dur1 + dur2 + 1.5 + 0.01;
  const st = computeEndCardState(world({ 'quest.endT': endT }), uiStyle);
  const writes = [];
  const rt = { cols: 160, rows: 60, setCellRGB(x, y, gi, r, g, b) { writes.push({ x, y, gi, r, g, b }); } };
  drawEndCard(rt, uiStyle, paletteColors, st);
  ok('drawEndCard writes cells for a visible state', writes.length > 0);
  ok('drawEndCard does not throw when invisible', (() => { drawEndCard(rt, uiStyle, paletteColors, { visible: false, lines: [] }); return true; })());
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
