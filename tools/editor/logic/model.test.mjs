import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLogic, fileText, saveAll, isDirty, addBlock, deleteBlock, moveBlock, setBlockField, setWhen, addItem, deleteItem, moveItem, setArg, validateAll, makeStack, stringifyLogic } from './model.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/logic');
const schema = JSON.parse(readFileSync(join(dir, 'vocab.schema.json'), 'utf8'));
const m = loadLogic(dir);
assert.deepEqual(m.errors, []);
assert.ok(m.files.size >= 1);
for (const [n, f] of m.files) assert.equal(fileText(f), readFileSync(join(dir, n), 'utf8'), 'round trip ' + n);
const writes = [];
assert.equal(saveAll(m, { writeFileSync: (p, t) => writes.push([p, t]) }).written.length, 0);
assert.deepEqual(validateAll(m, schema), []);

const f = m.files.get('example.logic.json');
const orig = JSON.stringify(f.blocks), st = makeStack();
const b = () => f.blocks.find((x) => x.id === 'example.ambush');
assert.equal(b().rev, 1);

st.run(setArg(f, 'example.ambush', 'do', 2, 'text', 'hint.other')); // Do change: no rev bump
assert.equal(b().do[2].text, 'hint.other'); assert.equal(b().rev, 1);
st.run(setBlockField(f, 'example.ambush', 'name', 'Renamed')); assert.equal(b().rev, 1);
st.run(addItem(f, 'example.ambush', 'do', { act: 'sound', id: 'horn' })); assert.equal(b().rev, 1); assert.equal(b().do.length, 4);
st.run(moveItem(f, 'example.ambush', 'do', 3, 0)); assert.equal(b().do[0].act, 'sound'); assert.equal(b().rev, 1);
st.run(deleteItem(f, 'example.ambush', 'do', 0)); assert.equal(b().do.length, 3);
st.run(setArg(f, 'example.ambush', 'when', 0, 'area', 'example.yard2')); assert.equal(b().rev, 2); // When change
st.run(setArg(f, 'example.ambush', 'if', 0, 'state', 'done')); assert.equal(b().rev, 3);          // If change
st.run(addItem(f, 'example.ambush', 'if', { is: 'flag', flag: 'f', eq: true })); assert.equal(b().rev, 4);
st.run(setWhen(f, 'example.ambush', { on: 'player.died' })); assert.equal(b().rev, 5);
st.run(addBlock(f, { id: 'example.b2', name: 'B2', when: { on: 'player.died' }, do: [{ act: 'sound', id: 'x' }] }));
assert.equal(f.blocks.length, 2); assert.equal(f.blocks[1].rev, 1);
st.run(moveBlock(f, 1, 0)); assert.equal(f.blocks[0].id, 'example.b2');
st.run(deleteBlock(f, 'example.b2')); assert.equal(f.blocks.length, 1);
assert.ok(isDirty(f));
assert.deepEqual(validateAll(m, schema).filter((e) => !/does not exist/.test(e)), []);
const edited = fileText(f);
assert.equal(edited, stringifyLogic(f.blocks));
assert.equal(saveAll(m, { writeFileSync: (p, t) => writes.push([p, t]) }).written.length, 1);
assert.equal(writes[0][1], edited);

// undo everything -> exact original blocks (rev included); redo works
const n = 12; // commands run above
for (let i = 0; i < n; i++) assert.ok(st.undo());
assert.equal(st.undo(), false);
assert.equal(JSON.stringify(f.blocks), orig);
st.redo(); st.redo(); assert.equal(b().name, 'Renamed');
assert.throws(() => setArg(f, 'nope', 'do', 0, 'x', 1).apply());

// validation: broken fixture reports plain text; duplicate ids across files
const bad = { dir, files: new Map([['a.logic.json', { name: 'a', blocks: [{ id: 'x', rev: 1, when: { on: 'nope' }, do: [] }] }], ['b.logic.json', { name: 'b', blocks: [{ id: 'x', rev: 1, when: { on: 'player.died' }, do: [{ act: 'sound', id: 'q' }] }] }]]) };
const errs = validateAll(bad, schema);
assert.ok(errs.some((e) => /unknown event/.test(e)) && errs.some((e) => /also in a/.test(e)), errs.join('\n'));
console.log('logic model ok');
