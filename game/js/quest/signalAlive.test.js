// SIGNAL-ALIVE-01: the shared signal source decodes to ALIVE; title frames / chart star / menu text / relay blink read it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../../../design/models/title.js'; // classic scripts set globalThis.ASSETS
import '../../../design/models/menu_ui.js';
import '../../../design/models/notes.js';
import { INTRO_SLIDES } from '../ui/introPlayer.js';
import { RELAY_WAKE } from './wire/waystone.js';
const A = globalThis.ASSETS, S = A.signal;
assert.equal(S.decode(S.steps), 'ALIVE');
assert.equal(S.text, '.- .-.. .. ...- .');
assert.deepEqual(S.timing, { dot: 0.25, dash: 0.75, gap: 0.25, letterGap: 0.75, pause: 2.5 });
assert.equal(S.marks.length, 13);
// title.show frames: durations equal the shared steps (ms), lit frames count = marks
const sh = A.models.title.animations.show;
assert.deepEqual(sh.durations, S.steps.map((x) => Math.round(x[1] * 1000)));
assert.equal(sh.frames.length, S.steps.length);
assert.equal(A.models.title.signal.marks.length, 13);
const mc = A.models.mapCard.animations && Object.values(A.models.mapCard.animations)[0];
if (mc) assert.deepEqual(mc.durations, sh.durations);
assert.equal(A.uiStyle.menu ? A.uiStyle.menu.signal.text : S.text, S.text);
for (const f of ['models/title.js', 'models/menu_ui.js', 'models/far_tower.js', '../game/js/quest/relayWake.js']) {
  const t = fs.readFileSync(new URL(f.startsWith('..') ? '../../../' + f.slice(3) : '../../../design/' + f, import.meta.url), 'utf8');
  assert.ok(!/\bSOS\b/i.test(t), 'no SOS left in ' + f);
}
// SIGNAL-ALIVE-TEXT: prose and readable notes must describe the actual 13-mark signal.
const rook = JSON.parse(fs.readFileSync(new URL('../../../content/dialogue/rook.dialogue.json', import.meta.url), 'utf8'));
const signalText = [
  ...INTRO_SLIDES.flatMap((slide) => slide.lines),
  ...Object.values(RELAY_WAKE),
  ...Object.values(A.notes).flatMap((note) => note.lines),
  ...Object.values(rook.nodes).flatMap((node) => node.lines || [])
];
for (const line of signalText) {
  assert.ok(!/\bSOS\b|three short|three long|nine (?:blinks|flashes)|\.\.\.\s+---\s+\.\.\.|Factor's Code/i.test(line), 'obsolete signal description: ' + line);
  assert.match(line, /^[\x20-\x7e]*$/, 'signal prose remains ASCII');
}
assert.equal(A.notes.keeperLog.lines.at(-1), S.text + '  ALIVE');
assert.ok(A.notes.journalCh1.lines.includes('ALIVE. In Morse.'));
assert.equal(rook.nodes['rook.meet.9'].lines[0], 'Thirteen blinks. Then quiet. Then me.');
assert.equal(rook.nodes['rook.call.ready.1'].lines[0], 'Counted? Thirteen blinks, then quiet. Again.');
assert.equal(RELAY_WAKE.ws_signalHill, 'ALIVE. The hill answers in Morse.');
assert.ok(INTRO_SLIDES.find((slide) => slide.file === '04-memory').lines.some((line) => line.includes('Morse')));
assert.ok(INTRO_SLIDES.find((slide) => slide.file === '05-alive').lines.some((line) => line.includes('ALIVE')));
for (const slide of INTRO_SLIDES) for (const line of slide.lines) assert.ok(line.length <= 60, 'intro caption <= 60 columns');
console.log('signal: PASS');
