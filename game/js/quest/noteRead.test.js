// game/js/quest/noteRead.test.js (READ-01). Headless Node ESM, no framework.
// Covers the pure word-wrap (wrapNoteLines), the `note.read` open/close state
// machine (noteRead / stepNoteRead / isNoteOpen / getOpenNoteId), the scene
// dim helper (pushNoteDim), and a light smoke of drawNotePanel with a fake ui.
import { makeOk } from '../../../engine/test/assert.js';
import {
  wrapNoteLines, noteRead, resetNoteRead, stepNoteRead, isNoteOpen, getOpenNoteId, pushNoteDim, drawNotePanel,
} from './noteRead.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// An edge-triggered input fake: `pressed` is true for exactly one step after
// `press()` is called (consumePressed clears it, like main.js's input).
function edgeInput() {
  let down = false;
  return {
    press: () => { down = true; },
    pressed: (c) => (c === 'KeyE' || c === 'Escape') && down,
    consumePressed: () => { down = false; },
  };
}

// ---- wrapNoteLines (pure word-wrap) ----------------------------------------
{
  const short = wrapNoteLines(['KEEP THE LIGHT'], 56, 40);
  ok('short line kept verbatim', short.rows.length === 1 && short.rows[0] === 'KEEP THE LIGHT' && !short.truncated);

  const long = wrapNoteLines(['the quick brown fox jumps over the lazy dog'], 10, 40);
  ok('long line wrapped at spaces with no row over wrap', long.rows.join(' ') === 'the quick brown fox jumps over the lazy dog' && long.rows.every((r) => r.length <= 10));

  const hard = wrapNoteLines(['ABCDEFGHIJKLMNOPQRSTUV'], 4, 40); // 22 chars
  ok('word longer than wrap is hard-broken', hard.rows.join('') === 'ABCDEFGHIJKLMNOPQRSTUV' && hard.rows.slice(0, -1).every((r) => r.length === 4) && hard.rows[hard.rows.length - 1] === 'UV');

  const trunc = wrapNoteLines(['one two three four five'], 3, 3);
  ok('more rows than maxRows truncates with ...', trunc.truncated && trunc.rows.length === 3 && trunc.rows[2].endsWith('...'));

  const sanitize = wrapNoteLines(['caf\u00e9'], 10, 40);
  ok('non-ASCII chars become ?', sanitize.rows[0] === 'caf?');
}

// ---- noteRead / stepNoteRead / isNoteOpen (open/close/input gate) ----------
{
  resetNoteRead({ note: { fadeIn: 0.12, fadeOut: 0.08, sceneDim: { bgMul: 0.35 } } });
  const world = { state: {} };
  const input = edgeInput();
  ok('starts closed', !isNoteOpen() && getOpenNoteId() === null);

  ok('noteRead opens and returns true', noteRead({ world, def: { noteId: 'keeperLog' } }) === true && isNoteOpen() && getOpenNoteId() === 'keeperLog');
  ok('noteRead sets the persisted read mark', world.state['notes.keeperLog.read'] === true);
  ok('noteRead with no noteId returns false', noteRead({ world, def: {} }) === false);

  // The E press that opened the note is the same edge: while 'opening' it must
  // NOT close (state is 'opening', not 'open').
  input.press();
  stepNoteRead(0.06, input); // fade 0.06/0.12 = 0.5
  ok('the opening press does not close', isNoteOpen());

  stepNoteRead(0.06, input); // fade completes -> 'open'
  ok('open after the fade completes', isNoteOpen());

  input.press();
  stepNoteRead(0.016, input); // 'open' + a fresh E edge -> 'closing'
  ok('a later E starts closing (still locked while fading out)', isNoteOpen());

  stepNoteRead(0.08, input); // fade-out 0.08/0.08 -> 'closed'
  ok('fade-out completes -> closed', !isNoteOpen() && getOpenNoteId() === null);

  // Esc closes the same way.
  noteRead({ world, def: { noteId: 'keepLight' } });
  stepNoteRead(0.12, input); // -> open
  input.press();
  stepNoteRead(0.016, input); // Esc edge -> closing
  ok('Esc closes too', isNoteOpen());
}

// ---- pushNoteDim (scene dim while open) ------------------------------------
{
  resetNoteRead({ note: { fadeIn: 0.12, fadeOut: 0.08, sceneDim: { bgMul: 0.35 } } });
  const world = { state: {} };
  const input = edgeInput();
  const dim = { all: 1 };
  pushNoteDim(dim);
  ok('pushNoteDim is a no-op while closed', dim.all === 1);

  noteRead({ world, def: { noteId: 'keeperLog' } });
  stepNoteRead(0.12, input); // -> open, noteA = 1
  pushNoteDim(dim);
  ok('pushNoteDim dims the scene to sceneMul while open', Math.abs(dim.all - 0.35) < 1e-9);
}

// ---- drawNotePanel (light smoke: draws cells, no throw) --------------------
{
  resetNoteRead({ note: { fadeIn: 0.12, fadeOut: 0.08, sceneDim: { bgMul: 0.35 } } });
  const world = { state: {} };
  const input = edgeInput();
  noteRead({ world, def: { noteId: 'keeperLog' } });
  stepNoteRead(0.12, input); // -> open

  const rgb = { paper: [10, 10, 10], paperEdge: [20, 20, 20], edgeInk: [30, 30, 30], inkFaded: [40, 40, 40], shadow: [50, 50, 50], inkTitle: [60, 60, 60], inkKey: [70, 70, 70], ink: [80, 80, 80] };
  const notes = { keeperLog: { title: 'The keeper', lines: ['IIII IIII', 'still here'] } };
  const uiStyle = { note: { rgb, panel: { minH: 10, maxH: 44 }, frame: { top: { pattern: '~' }, bottom: { pattern: '~' } }, text: { wrap: 56, col: 4, row: 5 }, fadeIn: 0.12, fadeOut: 0.08, sceneDim: { bgMul: 0.35 } } };
  const cells = [];
  const fakeUi = { cols: 160, rows: 60, setCellRGB(x, y) { cells.push([x, y]); } };
  drawNotePanel(fakeUi, notes, uiStyle);
  ok('drawNotePanel draws cells when a note is open', cells.length > 0);
  ok('drawNotePanel keeps cells inside the UI grid', cells.every(([x, y]) => x >= 0 && x < 160 && y >= 0 && y < 60));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
