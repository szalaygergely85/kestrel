import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, saveAll, saveQuest, fileText, setQuestField, addObjective, moveObjective, removeObjective, makeStack, validate } from './model.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir);
assert.deepEqual(m.errors, []);
assert.ok(m.quests.some((q) => q.kind === 'legacy') && m.quests.some((q) => q.kind === 'pack'));

// load -> save with no edit is byte-identical for every quest file
for (const [rel, f] of m.files) assert.equal(fileText(f), readFileSync(join(dir, rel), 'utf8'), 'round trip ' + rel);
const writes = [];
const fsMock = { writeFileSync: (p, t) => writes.push([p, t]) };
assert.equal(saveAll(m, fsMock).written.length, 0);

// commands + exact undo (legacy file)
const q = m.quests.find((x) => x.id === 'mq.smoke');
const f = m.files.get(q.file), orig = fileText(f);
const st = makeStack();
st.run(setQuestField(q, 'title', 'Smoke!'));
st.run(addObjective(q, { id: 'x', text: 'T', journal: 'J', when: { type: 'area', id: 'a' } }));
st.run(moveObjective(q, 2, 0));
assert.equal(q.objectives[0].id, 'x');
st.run(removeObjective(q, 0));
assert.equal(q.objectives.length, 2);
assert.equal(q.title, 'Smoke!');
assert.ok(saveQuest(m, q, fsMock).ok);
assert.equal(writes.length, 1);
assert.ok(writes[0][0].endsWith('mq.smoke.quest.json'));
while (st.undo());
assert.equal(fileText(f), orig, 'undo restores exact bytes');
st.redo(); assert.equal(q.title, 'Smoke!');
while (st.undo());
assert.equal(fileText(f), orig);

// pack row edit rewrites only its own file
saveAll(m, fsMock); // settle the undone legacy file
const p = m.quests.find((x) => x.kind === 'pack');
const pf = m.files.get(p.file), pOrig = fileText(pf);
const c = setQuestField(p, 'title', p.title + ' x'); c.apply();
assert.notEqual(fileText(pf), pOrig);
writes.length = 0;
assert.equal(saveAll(m, fsMock).written.join(), p.file);
c.undo(); assert.equal(fileText(pf), pOrig);

// errors block the write
assert.ok(validate([p, p]).some((e) => e.includes('duplicate')));
const t = p.raw.title; delete p.raw.title; p.title = '';
writes.length = 0;
const bad = saveQuest(m, p, fsMock);
assert.ok(!bad.ok && writes.length === 0 && bad.errors.length);
p.raw.title = t; p.title = t;
console.log('quest model OK');
