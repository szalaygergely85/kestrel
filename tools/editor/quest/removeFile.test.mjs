// EV17-15: Save of a deleted quest removes its file (fake fetch) and drops it from index.json; saveAll unlinks via the hook.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { removeQuestFile } from '../questPanel.js';
import { loadQuests, saveAll, makeStack } from './model.js';
import { loadDialogues } from './lines.js';
import { deleteQuest } from './duplicate.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content');
const calls = [], idx = { version: 1, packs: ['p'], legacy: ['a', 'b.c', 'z'] };
const fake = async (u, o = {}) => {
  calls.push([o.method || 'GET', u]);
  if (u.endsWith('index.json') && !o.method) return { ok: true, text: async () => JSON.stringify(idx) };
  if (o.method === 'PUT') { Object.assign(idx, JSON.parse(o.body)); return { ok: true }; }
  return { ok: true };
};
await removeQuestFile('b.c.quest.json', fake);
assert.deepEqual(idx.legacy, ['a', 'z']);
assert.deepEqual(calls.map((c) => c[0]), ['GET', 'PUT', 'DELETE']);
assert.equal(calls[2][1], '/content/quests/b.c.quest.json');

// model -> saveAll -> hook gets the deleted legacy file's name (and nothing else is written)
const m = loadQuests(join(root, 'quests')), dm = loadDialogues(join(root, 'dialogue'), { readdirSync, readFileSync });
const q = m.quests.find((x) => x.id === 'sq.burl.blue');
const r = deleteQuest(m, q, dm); assert.ok(r.cmd, r.blockers.join('|')); makeStack().run(r.cmd);
const un = [], wr = [];
saveAll(m, { writeFileSync: (p) => wr.push(p), unlinkSync: (p) => un.push(p) });
assert.deepEqual(un.map((p) => p.replace(/^.*[\/]/, '')), ['sq.burl.blue.quest.json']); assert.deepEqual(wr, []);
console.log('removeFile ok');
