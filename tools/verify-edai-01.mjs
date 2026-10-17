// ED-AI-01: archetype/kind model round trip over the real content/beasts on DISK (copy in a temp dir):
// load -> save with no edit writes nothing, every file byte-identical; edits + undo + save are byte-identical too.
// Run: node tools/verify-edai-01.mjs {port}   (port 9725-9799 accepted for lane symmetry; Node only, no server/browser is started)
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT } from './capture-browser.mjs';
import { loadArchetypes, saveArchetypes, setArchField, setAttackField, addAttack, removeAttack, makeStack, validateModel } from './editor/ai/model.js';

const port = Number(process.argv[2] || 9725);
if (!(port >= 9725 && port <= 9799)) throw new Error('lane port range is 9725-9799');
const src = path.join(ROOT, 'content/beasts');
const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), 'edai01-')), 'beasts');
cpSync(src, tmp, { recursive: true });
const m = loadArchetypes(tmp);
assert.deepEqual(m.errors, []);
assert.deepEqual(validateModel(m), [], 'shipped data validates');
assert.equal(saveArchetypes(m).written.length, 0, 'no edit writes nothing');
const st = makeStack();
st.run(setArchField(m, 'grazer', 'noticeR', 12)); st.run(setAttackField(m, 'boar', 0, 'dmgF', 2));
st.run(addAttack(m, 'fox')); st.run(removeAttack(m, 'grey_wolf', 1));
assert.equal(saveArchetypes(m).written.length, 2);
while (st.undo());
assert.equal(saveArchetypes(m).written.length, 2, 'undo state differs from the edited file, so it is written back');
for (const n of ['archetypes.json', 'kinds.json']) assert.equal(readFileSync(path.join(tmp, n), 'utf8'), readFileSync(path.join(src, n), 'utf8'), n);
console.log(`ED-AI-01 OK: ${Object.keys(m.arch).length} archetypes, ${Object.keys(m.kinds).length} kinds, files byte-identical after edit+undo+save`);
