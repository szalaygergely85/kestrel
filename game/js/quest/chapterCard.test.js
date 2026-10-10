// CH1-09 chapterCard tests. Run: node --expose-gc game/js/quest/chapterCard.test.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createChapterCard, FLAG_DONE, FLAG_NEXT, DIM_SEC, HOLD_SEC } from './chapterCard.js';
import { createUiLayer } from '../../../engine/index.js';

function rig(state = {}) {
  const r = { world: { state }, opened: [], noteOpen: false, flags: [] };
  r.openNote = id => { r.opened.push(id); r.noteOpen = true; };
  r.card = createChapterCard({ world: r.world, openNote: r.openNote, isNoteOpen: () => r.noteOpen, setFlag: (k, v) => r.flags.push([k, v]) });
  return r;
}
const run = (r, sec) => { for (let i = 0; i < Math.round(sec * 60); i++) r.card.update(1 / 60); };

// once + flags + lock + dim + journal hand-off
{
  const r = rig(); const c = r.card, dim = { all: 1 };
  assert.equal(c.isLocked(), false);
  assert.equal(c.trigger(), true); assert.equal(c.trigger(), false, 'second trigger ignored');
  assert.equal(r.world.state[FLAG_DONE], true); assert.equal(r.world.state[FLAG_NEXT], 'ch2');
  assert.deepEqual(r.flags, [[FLAG_DONE, true], [FLAG_NEXT, 'ch2']]);
  assert.equal(c.isLocked(), true);
  run(r, DIM_SEC / 2); c.pushDim(dim); assert.ok(dim.all < 0.8 && dim.all > 0.6, 'half way ' + dim.all);
  run(r, DIM_SEC / 2 + 0.05); dim.all = 1; c.pushDim(dim); assert.equal(dim.all, 0.5);
  assert.equal(c.state(), 'type');
  run(r, 2.5); assert.equal(c.state(), 'hold'); assert.equal(r.opened.length, 0, 'journal waits the hold');
  run(r, HOLD_SEC + 0.1); assert.deepEqual(r.opened, ['journalCh1']); assert.equal(c.state(), 'journal'); assert.equal(c.isLocked(), true);
  run(r, 1); assert.equal(c.state(), 'journal', 'stays while the note is open');
  r.noteOpen = false; run(r, 0.2); assert.equal(c.state(), 'done'); assert.equal(c.isLocked(), false);
  run(r, 0.5); dim.all = 1; c.pushDim(dim); assert.equal(dim.all, 1, 'dim gone');
  assert.equal(c.trigger(), false, 'never replays');
}
// never on load
{ const r = rig({ [FLAG_DONE]: true }); assert.equal(r.card.trigger(), false); assert.equal(r.card.isLocked(), false); assert.equal(r.card.isDone(), true); }
// typed text appears progressively, then in full
{
  const r = rig(); r.card.trigger(); const ui = createUiLayer({ cols: 100 });
  run(r, DIM_SEC + 0.3);
  let n = 0; const orig = ui.setCell.bind(ui); ui.setCell = (...a) => { n++; return orig(...a); };
  r.card.draw(ui); assert.ok(n > 0 && n < 16, 'partial title ' + n);
  run(r, 2.5); n = 0; r.card.draw(ui); assert.equal(n, 'CHAPTER COMPLETE'.length + 'Beyond the Wall'.length + 'Next chapter: The River and the Forgotten'.length);
}
// journal text (CH1-W5): present, ASCII, fits the 56-col panel
{
  const notes = createRequire(import.meta.url)('../../../design/models/notes.js').notes;
  const j = notes.journalCh1; assert.ok(j, 'journalCh1 in notes'); assert.equal(j.title, 'Pencil, on the back of the chart');
  assert.equal(j.lines.length, 13); for (const l of j.lines) { assert.ok(l.length <= 56); assert.ok(/^[\x20-\x7e]*$/.test(l)); }
  assert.equal(j.lines[12], '- W.');
}
// 0-alloc draw
if (global.gc) {
  const r = rig(); r.card.trigger(); run(r, 1.6); const ui = createUiLayer({ cols: 100 });
  for (let i = 0; i < 1000; i++) r.card.draw(ui);
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) r.card.draw(ui);
  global.gc(); const d = process.memoryUsage().heapUsed - h0; assert.ok(d < 200000, 'draw heap growth ' + d);
}
console.log('chapterCard tests passed');
