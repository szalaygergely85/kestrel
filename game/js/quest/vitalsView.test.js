// game/js/quest/vitalsView.test.js (US-080a2). Headless Node ESM, no framework. Run: node game/js/quest/vitalsView.test.js
import {
  cellCounts, lowPulseAmount, chipStageAt, raggedHash100, hurtEdgeStage, kickDeg,
  deathFadeAmount, computeDeathCardState, drawVitals, drawHurtEdge, drawDeathCard, resetVitalsView,
} from './vitalsView.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- a minimal uiStyle.vitals fixture (trimmed to what this view reads) ----
const RGB = { vitalLight: [255, 143, 126], vital: [216, 52, 74], uiHint: [169, 163, 144], uiText: [232, 226, 208], plate: [10, 11, 16] };
const style = {
  textBg: RGB.plate,
  layout: { x: 2, hpRow: 1, mpRow: 2, labelCol: 0, openCol: 3, firstCell: 4, cells: 20, closeCol: 24, numberCol: 26 },
  hp: {
    label: { text: 'HP', fg: RGB.vitalLight },
    brackets: { open: '[', close: ']', fg: RGB.uiHint },
    fill: { glyph: '#', fg: RGB.vital, bg: [58, 12, 20] },
    part: { glyph: '+', fg: [186, 46, 62], bg: [40, 10, 16] },
    empty: { glyph: '.', fg: [110, 40, 48], bg: [24, 8, 12] },
    number: { format: '{hp}/{max}', fg: RGB.uiText },
    low: { atOrBelow: 0.25, hz: 1.0, fill: { fgTo: [255, 110, 96], bgTo: [120, 18, 22] }, brackets: { fgTo: [255, 59, 59] }, number: { fgTo: [255, 59, 59] } },
    chip: { stages: [{ ms: 120, glyph: '#', fg: [255, 214, 190] }, { ms: 150, glyph: '=', fg: [200, 90, 90] }, { ms: 150, glyph: ':', fg: [130, 46, 52] }] },
    gain: { ms: 220, fg: [255, 236, 228] },
  },
  hurtEdge: {
    steps: 9, ms: 150,
    rings: [
      { glyph: '#', fg: [255, 59, 59], bg: [120, 14, 14], coverage: 1.0 },
      { glyph: '%', fg: [226, 46, 40], bg: [70, 8, 10], coverage: 0.75 },
      { glyph: ':', fg: [186, 34, 30], bg: [40, 6, 8], coverage: 0.5, cornersOnly: { cols: 28, rows: 9 } },
    ],
    thickness: { rows: 1, cols: 2 },
    stages: [{ untilStep: 3, rings: 3, gain: 1.0 }, { untilStep: 6, rings: 2, gain: 0.75 }, { untilStep: 9, rings: 1, gain: 0.5, glyph: ':' }],
  },
  deathCard: {
    lines: [
      { id: 'fall', row: 28, typed: true, cps: 30, fg: RGB.uiText, text: 'The dark again. The light still blinks.' },
      { id: 'wake', row: 31, typed: false, afterGapSec: 1.0, fg: RGB.uiText, key: [255, 210, 74], text: '[E] Wake again', keys: ['[E]'], cursor: { glyph: '_', periodSec: 1.0, duty: 0.5 } },
    ],
  },
};

function fakeUi(cols = 160, rows = 60) {
  const cells = new Map();
  return { cols, rows, setCellRGB(x, y, gi, r, g, b, br, bg, bb) { cells.set(`${x},${y}`, { gi, r, g, b, br, bg, bb }); }, _cells: cells };
}
function fakeWorld(hp, max) {
  return { get: (id) => (id === 'player' ? { data: { components: { health: { hp, max } } } } : null) };
}

// ---------------------------------------------------------------------------------------------------------------
// cellCounts: fillRule examples (30 HP -> 1.5 HP/cell; value>0 always >= 1 part cell; full bar; zero).
// ---------------------------------------------------------------------------------------------------------------
{
  const c0 = cellCounts(0, 30);
  ok('0 hp: no cells at all', c0.full === 0 && c0.part === 0 && c0.filled === 0, JSON.stringify(c0));
  const cFull = cellCounts(30, 30);
  ok('full hp: all 20 cells full, no part', cFull.full === 20 && cFull.part === 0, JSON.stringify(cFull));
  const c25 = cellCounts(25, 30); // cells = 16.667 -> full 16, frac .667 >= .5 -> part 1
  ok('25/30 hp: 16 full + 1 part (a 5 hp hit removes ~3.3 cells)', c25.full === 16 && c25.part === 1 && c25.filled === 17, JSON.stringify(c25));
  const c1 = cellCounts(1, 30); // cells = 0.667 -> full 0, part 1 (always >= 1 part cell while value>0)
  ok('1/30 hp: still shows 1 part cell, not zero', c1.full === 0 && c1.part === 1 && c1.filled === 1, JSON.stringify(c1));
  const cTiny = cellCounts(1, 300); // cells = 0.0667 -> frac < 0.5, but value>0 rule still forces 1 part cell
  ok('a tiny fraction of a cell still forces exactly 1 part cell (never zero while value>0)', cTiny.full === 0 && cTiny.part === 1, JSON.stringify(cTiny));
}

// ---------------------------------------------------------------------------------------------------------------
// lowPulseAmount: only active at <= 25%, 1 Hz cosine curve.
// ---------------------------------------------------------------------------------------------------------------
{
  const low = style.hp.low;
  ok('above 25%: no pulse', lowPulseAmount(8, 30, low, 1.23) === 0); // 8/30 = 26.7%
  ok('at exactly 25%: pulse active', lowPulseAmount(7.5, 30, low, 0) === 0); // t=0 -> cos(0)=1 -> a=0
  ok('below 25%, t=0.25s (quarter period of 1 Hz): a=0.5 (midpoint, cos(pi/2)=0)', Math.abs(lowPulseAmount(5, 30, low, 0.25) - 0.5) < 1e-9);
  ok('below 25%, t=0.5s (half period): a=1 (peak, cos(pi)=-1)', Math.abs(lowPulseAmount(5, 30, low, 0.5) - 1) < 1e-9);
}

// ---------------------------------------------------------------------------------------------------------------
// chipStageAt: sequential ms stages (120, 150, 150), null once past the total.
// ---------------------------------------------------------------------------------------------------------------
{
  const stages = style.hp.chip.stages;
  ok('t=0: stage 0 (#)', chipStageAt(0, stages).glyph === '#');
  ok('t=119: still stage 0', chipStageAt(119, stages).glyph === '#');
  ok('t=120: stage 1 (=)', chipStageAt(120, stages).glyph === '=');
  ok('t=269: still stage 1', chipStageAt(269, stages).glyph === '=');
  ok('t=270: stage 2 (:)', chipStageAt(270, stages).glyph === ':');
  ok('t=419: still stage 2', chipStageAt(419, stages).glyph === ':');
  ok('t=420: finished (null)', chipStageAt(420, stages) === null);
}

// ---------------------------------------------------------------------------------------------------------------
// drawVitals + chip state transitions: a hit lowers hp -> the lost cells show the chip sequence, then settle to
// `empty` once the chip duration (420 ms) has passed. Driven purely by the view's own remembered previous hp.
// ---------------------------------------------------------------------------------------------------------------
{
  resetVitalsView();
  const ui = fakeUi();
  drawVitals(ui, fakeWorld(30, 30), style, 0, true); // first draw: establishes prevValue, no chip yet
  const fillCol = 2 + 4; // layout.x(2) + firstCell(4) -> first bar cell column
  ok('full bar: first cell is the fill glyph', ui._cells.get(`${fillCol},1`).gi === '#'.charCodeAt(0) - 32);

  drawVitals(ui, fakeWorld(25, 30), style, 0, true); // hp drops 30 -> 25 at simTime=0: chip starts
  // 25/30 => filled=17 (16 full + 1 part); 30/30 => filled=20 -> lost cells are indices 17,18,19 (0-based)
  const lostCol = fillCol + 17;
  const c0 = ui._cells.get(`${lostCol},1`);
  ok('a just-lost cell shows chip stage 0 glyph (#) right after the hit', c0.gi === '#'.charCodeAt(0) - 32, JSON.stringify(c0));

  drawVitals(ui, fakeWorld(25, 30), style, 0.13, true); // 130 ms later: stage 1 (=)
  const c1 = ui._cells.get(`${lostCol},1`);
  ok('130 ms later: chip stage 1 glyph (=)', c1.gi === '='.charCodeAt(0) - 32, JSON.stringify(c1));

  drawVitals(ui, fakeWorld(25, 30), style, 0.5, true); // 500 ms later: chip finished -> plain empty glyph
  const c2 = ui._cells.get(`${lostCol},1`);
  ok('500 ms later: chip finished, cell reads as plain empty', c2.gi === '.'.charCodeAt(0) - 32, JSON.stringify(c2));
}

// ---------------------------------------------------------------------------------------------------------------
// drawVitals: hidden entirely when `visible` is false (title/map/end/death cards).
// ---------------------------------------------------------------------------------------------------------------
{
  resetVitalsView();
  const ui = fakeUi();
  drawVitals(ui, fakeWorld(30, 30), style, 0, false);
  ok('visible=false draws nothing', ui._cells.size === 0);
}

// ---------------------------------------------------------------------------------------------------------------
// hurtEdgeStage: 9-step / 150 ms timeline -> stages at untilStep 3/6/9 (msPerStep = 150/9 = 16.667).
// ---------------------------------------------------------------------------------------------------------------
{
  const cfg = style.hurtEdge;
  ok('t=0: stage 0, 3 rings', hurtEdgeStage(0, cfg).rings === 3);
  ok('just before step 3 (49 ms): still stage 0', hurtEdgeStage(49, cfg).rings === 3);
  ok('just after step 3 (51 ms): stage 1, 2 rings', hurtEdgeStage(51, cfg).rings === 2);
  ok('just after step 6 (101 ms): stage 2, 1 ring, glyph override', hurtEdgeStage(101, cfg).rings === 1 && hurtEdgeStage(101, cfg).glyph === ':');
  ok('t=150 (cfg.ms): inactive (null)', hurtEdgeStage(150, cfg) === null);
  ok('t=200: inactive (null)', hurtEdgeStage(200, cfg) === null);
}

// ---------------------------------------------------------------------------------------------------------------
// raggedHash100: deterministic (same cell -> same value every call), in [0,100).
// ---------------------------------------------------------------------------------------------------------------
{
  const h1 = raggedHash100(12, 34), h2 = raggedHash100(12, 34);
  ok('same (x,y) hashes the same every call', h1 === h2);
  ok('hash is in [0,100)', h1 >= 0 && h1 < 100);
  ok('different cells usually hash differently', raggedHash100(0, 0) !== raggedHash100(1, 0) || raggedHash100(0, 0) !== raggedHash100(0, 1));
}

// ---------------------------------------------------------------------------------------------------------------
// drawHurtEdge: no hurtTick (never hit) -> nothing drawn; a recent hit draws ring-0 coverage=1 cells (no ragged gaps).
// ---------------------------------------------------------------------------------------------------------------
{
  const ui = fakeUi();
  drawHurtEdge(ui, { hurtTick: 0 }, 1.0, style);
  ok('hurtTick=0 (never hit): draws nothing', ui._cells.size === 0);

  const ui2 = fakeUi();
  drawHurtEdge(ui2, { hurtTick: 60 }, 60 / 60, style); // hit exactly "now" (elapsed 0 ms)
  ok('a fresh hit draws the top-left corner cell (ring 0, coverage 1.0)', ui2._cells.has('0,0'));

  const ui3 = fakeUi();
  drawHurtEdge(ui3, { hurtTick: 60 }, 60 / 60 + 1, style); // 1 s later: well past the 150 ms window
  ok('long after the hit: draws nothing', ui3._cells.size === 0);
}

// ---------------------------------------------------------------------------------------------------------------
// kickDeg: decays linearly from 2deg to 0 over 150 ms, 0 outside the window, never touches any object (pure).
// ---------------------------------------------------------------------------------------------------------------
{
  ok('no hit: kick is 0', kickDeg({ hurtTick: 0 }, 5) === 0);
  ok('t=hit instant: full 2 deg kick', Math.abs(kickDeg({ hurtTick: 60 }, 1.0) - 2) < 1e-9);
  ok('halfway through 150 ms: 1 deg', Math.abs(kickDeg({ hurtTick: 60 }, 1.0 + 0.075) - 1) < 1e-6);
  ok('past 150 ms: 0', kickDeg({ hurtTick: 60 }, 1.0 + 0.2) === 0);
  const look = { yawDeg: 10, pitchDeg: 5 };
  const before = JSON.stringify(look);
  kickDeg({ hurtTick: 60 }, 1.02);
  ok('kickDeg never mutates a `look`-shaped object passed near it (it is never even given one)', JSON.stringify(look) === before);
}

// ---------------------------------------------------------------------------------------------------------------
// deathFadeAmount: 1 while alive or sinking, decays to 0 over fadeSteps after sinkSteps, 0 once cardReady.
// ---------------------------------------------------------------------------------------------------------------
{
  ok('alive: fade amount 1 (no fade)', deathFadeAmount({ dead: false, deathStep: 999 }) === 1);
  ok('mid-sink (deathStep=10 < sinkSteps=48): still 1', deathFadeAmount({ dead: true, deathStep: 10 }) === 1);
  ok('exactly at sinkSteps (48): still 1 (fade starts strictly after)', deathFadeAmount({ dead: true, deathStep: 48 }) === 1);
  ok('halfway through fade (48+45=93): ~0.5', Math.abs(deathFadeAmount({ dead: true, deathStep: 93 }) - 0.5) < 1e-9);
  ok('at sinkSteps+fadeSteps (138): fully faded (0)', deathFadeAmount({ dead: true, deathStep: 138 }) === 0);
  ok('long after (200): stays 0', deathFadeAmount({ dead: true, deathStep: 200 }) === 0);
}

// ---------------------------------------------------------------------------------------------------------------
// computeDeathCardState: not visible before cardReady; typewriter on line 0; line 1 appears after afterGapSec.
// ---------------------------------------------------------------------------------------------------------------
{
  const total = 48 + 90; // sinkSteps + fadeSteps
  const notReady = computeDeathCardState({ dead: true, deathStep: total - 1 }, style);
  ok('not yet cardReady: card invisible', notReady.visible === false);

  const justReady = computeDeathCardState({ dead: true, deathStep: total }, style);
  ok('cardReady this step: visible, line 0 typing from empty', justReady.visible === true);
  const l0 = justReady.lines.find((l) => l.id === 'fall');
  ok('line 0 starts untyped at the exact cardReady step', l0.count === 0);

  const text0 = 'The dark again. The light still blinks.';
  const midType = computeDeathCardState({ dead: true, deathStep: total + 30 }, style); // 0.5 s later, cps=30 -> 15 chars
  const l0b = midType.lines.find((l) => l.id === 'fall');
  ok('mid-typing: partial count', l0b.count === 15, `count=${l0b.count}`);

  const typeDoneSteps = Math.ceil((text0.length / 30) * 60); // steps to finish typing line 0
  const beforeGap = computeDeathCardState({ dead: true, deathStep: total + typeDoneSteps }, style);
  ok('line fully typed but before the 1s gap: no [E] line yet', !beforeGap.lines.find((l) => l.id === 'wake'));

  const afterGap = computeDeathCardState({ dead: true, deathStep: total + typeDoneSteps + 60 + 1 }, style); // +1s+ a hair
  const wake = afterGap.lines.find((l) => l.id === 'wake');
  ok('after the 1s gap: the [E] Wake again line appears, fully shown', !!wake && wake.count === wake.text.length);
}

// ---------------------------------------------------------------------------------------------------------------
// drawDeathCard: no throw when invisible; draws centered text when visible.
// ---------------------------------------------------------------------------------------------------------------
{
  const ui = fakeUi();
  ok('drawDeathCard does not throw when invisible', (() => { drawDeathCard(ui, style, { visible: false, lines: [] }); return true; })());
  const total = 48 + 90;
  const state = computeDeathCardState({ dead: true, deathStep: total }, style);
  drawDeathCard(ui, style, state);
  ok('drawDeathCard writes nothing for an untyped (count=0) line', ui._cells.size === 0);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
