// ED-QUEST-01: quest model round trip over the real content/quests on DISK (copy in a temp dir):
// load -> save with no edit writes nothing and every file is byte-identical; one edit + undo + save is byte-identical too.
// Run: node tools/verify-edq-01.mjs {port}   (port 9725-9799 accepted for lane symmetry; Node only, no server/browser is started)
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT } from './capture-browser.mjs';
import { loadQuests, saveAll, setQuestField, makeStack } from './editor/quest/model.js';

const port = Number(process.argv[2] || 9725);
if (!(port >= 9725 && port <= 9799)) throw new Error('lane port range is 9725-9799');
const src = path.join(ROOT, 'content/quests');
const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), 'edq01-')), 'quests');
cpSync(src, tmp, { recursive: true });
const m = loadQuests(tmp);
assert.deepEqual(m.errors, []);
assert.equal(saveAll(m).written.length, 0, 'no edit writes nothing');
const st = makeStack();
st.run(setQuestField(m.quests[0], 'title', 'X')); assert.equal(saveAll(m).written.length, 1);
st.undo(); saveAll(m);
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let n = 0;
for (const f of walk(src)) { const rel = path.relative(src, f); assert.equal(readFileSync(path.join(tmp, rel), 'utf8'), readFileSync(f, 'utf8'), rel); n++; }
console.log(`ED-QUEST-01 OK: ${m.quests.length} quests, ${n} files byte-identical after edit+undo+save`);
