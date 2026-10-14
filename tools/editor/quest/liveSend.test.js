import assert from 'node:assert/strict';
import { createLiveSender, questTextDef, changedDialogues } from './liveSend.js';
const q = { id: 'sq.a', title: 'T', returnText: 'R', objectives: [{ id: 'o1', text: 'kill', journal: 'j' }] };
const dm = { files: new Map([['rook.dialogue.json', { obj: { a: 2 }, orig: { a: 1 } }], ['bear.dialogue.json', { obj: { a: 1 }, orig: { a: 1 } }]]) };
assert.deepEqual(questTextDef(q).objectives[0], { id: 'o1', text: 'kill', journal: 'j' });
assert.deepEqual(changedDialogues(dm).map((d) => d.id), ['rook']);
const sent = [], timers = []; const ch = { postMessage: (m) => sent.push(m) };
const s = createLiveSender({ channel: ch, setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer: () => {} });
s.schedule(q, dm); s.schedule(q, dm); assert.equal(sent.length, 0);   // debounced
timers[timers.length - 1](); assert.deepEqual(sent.map((m) => m.type), ['quest-patch', 'dialogue-patch']);
s.schedule(q, dm); timers[timers.length - 1](); assert.equal(sent.length, 2, 'unchanged -> not resent');
q.title = 'T2'; s.schedule(q, dm); timers[timers.length - 1](); assert.equal(sent.length, 3);
console.log('liveSend ok');
