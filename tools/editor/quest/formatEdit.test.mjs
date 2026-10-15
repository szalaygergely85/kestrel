// QUEST-FORMAT editor fields (D-106). Run: node tools/editor/quest/formatEdit.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, makeStack } from './model.js';
import * as fe from './formatEdit.js';
import { formatView, formatProblems } from './format.js';

const m = loadQuests(join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests'));
const q = m.quests.find((x) => x.id === 'burl.boars'), st = makeStack();
assert.ok(q, 'legacy quest present');
st.run(fe.setBegin(q, 'object', 'noteX')); assert.deepEqual(formatView(q.raw).begin, { object: 'noteX' });
st.run(fe.setEnd(q, 'rook')); assert.deepEqual(formatView(q.raw).end, { npc: 'rook' });
st.run(fe.setRequires(q, ['tower.blade', '', 'tower.blade'])); assert.deepEqual(formatView(q.raw).requires.quests, ['tower.blade']);
st.run(fe.setNext(q, 'burl.follow')); assert.equal(q.raw.next, 'burl.follow');
assert.equal(fe.setRewards(q, {}), null, 'empty rewards refused'); assert.equal(fe.setRewards(q, { itemId: '', xp: 5 }), null, 'xp is not a reward');
st.run(fe.setRewards(q, { itemId: 'potion.health', n: 2, coin: 10, heartPiece: 1 })); assert.deepEqual(q.raw.rewards, { items: [{ id: 'potion.health', n: 2 }], coin: 10, heartPiece: 1 });
const ids = new Set(m.quests.map((x) => x.id));
assert.deepEqual(formatProblems(q.raw, ids), [], 'edited quest is format-clean');
// objectives max 3
q.raw.objectives = q.raw.objectives.slice(0, 1); assert.ok(fe.addStepMax(q)); st.run(fe.addStepMax(q)); st.run(fe.addStepMax(q));
assert.equal(formatView(q.raw).objectives.length, 3); assert.equal(fe.addStepMax(q), null, 'max 3');
st.undo(); st.undo(); st.undo(); st.undo(); st.undo(); st.undo(); st.undo(); // everything undoable
const ch = fe.formatChoices(m, { entities: [{ id: 'rook', components: { dialogue: 'rook' } }, { id: 'noteX', components: { inspect: {} } }] }, { rook: 'Rook' });
assert.deepEqual(ch.npcs, [{ id: 'rook', name: 'Rook' }]); assert.deepEqual(ch.objects.map((o) => o.id), ['noteX']); assert.ok(ch.quests.length > 5);
console.log('formatEdit: begin/end/requires/rewards/next/max-3 PASS');
