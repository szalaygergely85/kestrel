// dialogueView.test.js (DIALOGUE-01b1 + DIALOGUE-STYLE-01): the view against a fake UI grid + fake runner,
// styled by the REAL designer ASSETS.uiStyle.dialogue and palette.
import assert from 'node:assert/strict';
import paletteMod from '../../../design/palette.js';
import titleMod from '../../../design/models/title.js';
import { createDialogueView } from './dialogueView.js';

paletteMod; titleMod;
const A = globalThis.ASSETS, pal = A.palette.colors;
const hex = (k) => [1, 3, 5].map((i) => parseInt(pal[k].slice(i, i + 2), 16));

function grid(cols, rows) {
  const code = new Uint8Array(cols * rows), bg = new Uint8Array(cols * rows * 3), fg = new Uint8Array(cols * rows * 3);
  return {
    cols, rows, code, bg, fg,
    setCellRGB(x, y, gi, r, g, b, r2, g2, b2) {
      assert.ok(x >= 0 && x < cols && y >= 0 && y < rows, `out of grid ${x},${y}`);
      const i = y * cols + x; code[i] = gi + 32; fg[i * 3] = r; fg[i * 3 + 1] = g; fg[i * 3 + 2] = b;
      bg[i * 3] = r2; bg[i * 3 + 1] = g2; bg[i * 3 + 2] = b2;
    },
    at(x, y) { return String.fromCharCode(this.code[y * cols + x] || 32); },
    row(y) { let s = ''; for (let x = 0; x < cols; x++) s += this.at(x, y); return s; },
    bgAt(x, y) { const i = (y * cols + x) * 3; return [bg[i], bg[i + 1], bg[i + 2]]; },
    fgAt(x, y) { const i = (y * cols + x) * 3; return [fg[i], fg[i + 1], fg[i + 2]]; },
  };
}
const choices = ['Tell me a story.', 'What is this place?', 'Goodbye.'];
const LINE = "Hrrm. Easy, little one - I only bite *honeycomb*. Sit a while; the hill is quiet, and I have stories.";
const run = (o) => Object.assign({ state: 'typing', speakerLabel: 'Bear', isPlayer: false,
  line: LINE, visibleChars: 999, choiceCount: 0, choiceText: (i) => choices[i], selected: 0 }, o);

const view = createDialogueView({ style: A.uiStyle.dialogue, palette: A.palette });
const X0 = 32, Y8 = 60 - 3 - 8, Y12 = 60 - 3 - 12; // 96 wide centred on 160; bottom margin 3

// real style: frame size 96 x 8 (no choices), corners, rivets, name tag colours
{
  const g = grid(160, 60); view.draw(g, run(), 0);
  assert.equal(g.at(X0, Y8), '+'); assert.equal(g.at(X0 + 95, Y8), '+');
  assert.equal(g.at(X0, Y8 + 7), '+'); assert.equal(g.at(X0 + 95, Y8 + 7), '+');
  assert.equal(g.at(X0 - 1, Y8), ' ', 'nothing outside the frame'); assert.equal(g.at(X0 + 96, Y8), ' ');
  assert.equal(g.at(X0 + 3, Y8), 'o'); assert.equal(g.at(X0 + 92, Y8), 'o'); assert.equal(g.at(X0 + 3, Y8 + 7), 'o');
  assert.deepEqual(g.fgAt(X0 + 3, Y8), hex('brassLight'));
  assert.deepEqual(g.fgAt(X0 + 20, Y8), hex('brass'));
  assert.deepEqual(g.fgAt(X0, Y8), hex('brassLight'));
  assert.equal(g.row(Y8).slice(X0 + 6, X0 + 14), '[ Bear ]');
  assert.deepEqual(g.fgAt(X0 + 8, Y8), hex('brassHot'), 'NPC name = brassHot');
  assert.deepEqual(g.fgAt(X0 + 6, Y8), hex('brassLight'), 'bracket');
  assert.deepEqual(g.bgAt(X0 + 5, Y8 + 3), [10, 11, 16], 'opaque plate');
  const g2 = grid(160, 60); view.draw(g2, run({ isPlayer: true, speakerLabel: 'You' }), 0);
  assert.deepEqual(g2.fgAt(X0 + 8, Y8), hex('heroGreen'), 'player name = heroGreen');
}
// text: col 3, row 2, 88 wide, max 4 lines, *word* gold without stars, typed prefix only
{
  const g = grid(160, 60); view.draw(g, run(), 0);
  assert.ok(g.row(Y8 + 2).includes('Hrrm. Easy, little one - I only bite honeycomb.'), g.row(Y8 + 2));
  assert.ok(!g.row(Y8 + 2).includes('*'));
  const c = g.row(Y8 + 2).indexOf('honeycomb');
  assert.deepEqual(g.fgAt(c, Y8 + 2), hex('gold')); assert.deepEqual(g.fgAt(c + 8, Y8 + 2), hex('gold'));
  assert.deepEqual(g.fgAt(c + 9, Y8 + 2), hex('uiText'), 'plain text after the closing star');
  assert.deepEqual(g.fgAt(X0 + 3, Y8 + 2), hex('uiText')); assert.equal(g.at(X0 + 3, Y8 + 2), 'H');
  const g3 = grid(160, 60); view.draw(g3, run({ visibleChars: 10 }), 0);
  assert.ok(g3.row(Y8 + 2).includes('Hrrm. Easy'), 'typed prefix'); assert.ok(!g3.row(Y8 + 2).includes('little'));
  // wrap at 88 and at most 4 lines
  const long = 'word '.repeat(80), g4 = grid(160, 60); view.draw(g4, run({ line: long }), 0);
  for (let k = 2; k <= 5; k++) { assert.ok(g4.row(Y8 + k).includes('word'), `row ${k}`); assert.equal(g4.at(X0 + 95, Y8 + k), '|'); }
  assert.ok(!g4.row(Y8 + 6).slice(X0 + 3, X0 + 90).includes('word'), 'line 5+ not drawn');
}
// hints + blinking v (0.8 s period, 0.6 duty), no W/S without choices
{
  const g = grid(160, 60); view.draw(g, run({ state: 'waiting' }), 0);
  const hr = g.row(Y8 + 6);
  assert.ok(hr.includes('E: next   Esc: leave'), hr); assert.ok(!hr.includes('W/S'));
  assert.equal(g.at(X0 + 96 - 4, Y8 + 6), 'v');
  assert.deepEqual(g.fgAt(X0 + 92, Y8 + 6), hex('gold'));
  const e = hr.indexOf('E: next'); assert.deepEqual(g.fgAt(e, Y8 + 6), hex('gold'), 'key gold'); assert.deepEqual(g.fgAt(e + 3, Y8 + 6), hex('uiDim'));
  const hasV = (t) => { const gg = grid(160, 60); view.draw(gg, run({ state: 'waiting' }), t); return gg.at(X0 + 92, Y8 + 6) === 'v'; };
  assert.equal(hasV(0.1), true); assert.equal(hasV(0.6), false); assert.equal(hasV(0.9), true);
  const gt = grid(160, 60); view.draw(gt, run({ state: 'typing' }), 0); assert.notEqual(gt.at(X0 + 92, Y8 + 6), 'v', 'no marker while typing');
}
// choices: 12 tall, separator, gold focus band + '>' marker, numbers, W/S hint
{
  const g = grid(160, 60); view.draw(g, run({ state: 'choosing', choiceCount: 3, selected: 1 }), 0);
  assert.equal(g.at(X0, Y12), '+'); assert.equal(g.at(X0, Y12 + 11), '+'); assert.equal(g.at(X0 + 95, Y12 + 11), '+');
  assert.ok(g.row(Y12 + 6).includes('-'.repeat(60)), 'separator');
  assert.deepEqual(g.fgAt(X0 + 10, Y12 + 6), hex('brassShadow'));
  assert.ok(g.row(Y12 + 8).includes('>') && g.row(Y12 + 8).includes('2. What is this place?'));
  assert.ok(!g.row(Y12 + 7).includes('>') && !g.row(Y12 + 9).includes('>'));
  assert.equal(g.at(X0 + 1, Y12 + 8), '>'); assert.deepEqual(g.fgAt(X0 + 1, Y12 + 8), hex('gold'));
  assert.deepEqual(g.bgAt(X0 + 1, Y12 + 8), [52, 42, 16]); assert.deepEqual(g.bgAt(X0 + 94, Y12 + 8), [52, 42, 16]);
  assert.deepEqual(g.bgAt(X0 + 95, Y12 + 8), [10, 11, 16], 'band stops before the frame');
  assert.deepEqual(g.bgAt(X0 + 20, Y12 + 7), [10, 11, 16]);
  assert.deepEqual(g.fgAt(X0 + 6, Y12 + 8), hex('gold'), 'focus text gold');
  assert.deepEqual(g.fgAt(X0 + 3, Y12 + 8), hex('brassLight'), 'focus number');
  assert.deepEqual(g.fgAt(X0 + 6, Y12 + 7), hex('uiText')); assert.deepEqual(g.fgAt(X0 + 3, Y12 + 7), hex('uiDim'));
  assert.ok(g.row(Y12 + 10).includes('E: next   W/S: choose   Esc: leave'));
  assert.notEqual(g.at(X0 + 92, Y12 + 10), 'v', 'no more-marker with choices');
}
// optional seen / locked choices
{
  const g = grid(160, 60); view.draw(g, run({ state: 'choosing', choiceCount: 3, selected: 0, choiceSeen: (i) => i === 1, choiceDisabled: (i) => i === 2 }), 0);
  assert.deepEqual(g.fgAt(X0 + 6, Y12 + 8), hex('uiHint'));
  assert.ok(g.row(Y12 + 9).includes('Goodbye. (locked)')); assert.deepEqual(g.fgAt(X0 + 6, Y12 + 9), hex('uiDim'));
}
// idle/ended draw nothing
{
  const g = grid(160, 60); view.draw(g, run({ state: 'idle' }), 0); view.draw(g, run({ state: 'ended' }), 0);
  assert.ok(g.code.every((c) => c === 0));
}
// style: cps from typeOn, real style resolves without crash
assert.equal(view.cps, 28);
assert.doesNotThrow(() => createDialogueView({ style: A.uiStyle.dialogue }));
// fallbacks: no style, junk style, unknown palette key, missing palette
{
  for (const o of [{}, { style: {} }, { style: { frame: 5, text: 'x', choices: { focus: null }, nameTag: { fg: { npc: 'nope' } }, panel: [] } },
    { style: { frame: { fg: 'nokey' } }, palette: {} }]) {
    const v = createDialogueView(o), g = grid(160, 60);
    v.draw(g, run({ state: 'choosing', choiceCount: 3 }), 0);
    assert.equal(g.at(X0, Y12), '+'); assert.equal(g.at(X0 + 95, Y12), '+');
  }
  const v = createDialogueView({ style: { nameTag: { fg: { npc: 'nokey' } }, bgRgb: { plate: [1, 2, 3] } }, palette: A.palette });
  const g = grid(160, 60); v.draw(g, run(), 0);
  assert.deepEqual(g.fgAt(X0 + 8, Y8), [255, 240, 180], 'unknown key -> slot fallback'); assert.deepEqual(g.bgAt(X0 + 5, Y8 + 3), [1, 2, 3]);
  assert.equal(createDialogueView({ style: { text: { typeOn: { cps: 'fast' } } } }).cps, 28);
}
// narrow to wide grids stay in bounds
for (const [c, r] of [[160, 60], [240, 90], [400, 150], [480, 180], [40, 15], [30, 10]]) {
  const g = grid(c, r); view.draw(g, run({ state: 'choosing', choiceCount: 3, selected: 2 }), 0);
  view.draw(g, run({ state: 'waiting' }), 0);
}
// 1e4 draws: zero allocation
{
  const g = grid(160, 60), r = run({ state: 'choosing', choiceCount: 3, selected: 1 });
  for (let i = 0; i < 2000; i++) view.draw(g, r, i * 0.016);
  if (globalThis.gc) globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) view.draw(g, r, i * 0.016);
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 400000, `heap grew ${grown}`);
}
console.log('dialogueView: ok');
