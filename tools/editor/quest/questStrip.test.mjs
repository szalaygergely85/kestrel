// ED-QUI-01 + 02. Run: node tools/editor/quest/questStrip.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, makeStack, fileText } from './model.js';
import { stripModel, CARDS } from './questStrip.js';
import { prereqRows, setRequiresKeepShape, ITEM_ROW_NOTE } from './prereqs.js';
import { formatView } from './format.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir), by = (id) => m.quests.find((x) => x.id === id);

assert.deepEqual(CARDS.map((c) => c.n), ['01', '02', '03', '04', '05', '06']);
const main = by('burl.boars'), side = m.quests.find((x) => /^sq\./.test(x.id)), pack = m.quests.find((x) => x.kind === 'pack');
let s = stripModel(main, []); assert.equal(s.type, 'main'); assert.equal(s.color, 'gold'); assert.deepEqual(s.status, { kind: 'ok', label: 'VALID' });
s = stripModel(side, [{ severity: 'warn' }, { severity: 'warn' }]); assert.equal(s.type, 'side'); assert.equal(s.color, 'blue'); assert.equal(s.status.label, '2 WARNINGS'); assert.equal(s.status.kind, 'warn');
s = stripModel(side, [{ severity: 'error' }, { severity: 'warn' }]); assert.equal(s.status.label, '1 ERROR'); assert.deepEqual(s.counts, { errors: 1, warnings: 1 });
if (pack) assert.equal(stripModel(pack, []).region, pack.file.split('/')[0]);
assert.equal(stripModel(main, []).region, 'main');

let r = prereqRows(m, main);
assert.deepEqual(r.rows.map((x) => [x.quest, x.problem]), [['tower.blade', null]]); assert.equal(r.header, '1/1 OK'); assert.equal(r.item.disabled, true); assert.equal(r.item.note, ITEM_ROW_NOTE);

// unchanged write is byte-identical (legacy + pack)
for (const q of [main, ...(pack ? [pack] : [])]) {
  const before = fileText(m.files.get(q.file)), st0 = makeStack();
  st0.run(setRequiresKeepShape(q, formatView(q.raw).requires.quests)); assert.equal(fileText(m.files.get(q.file)), before, q.id + ' unchanged round-trip');
}
// legacy: shape kept, undo restores
const st = makeStack(), ford = by('mq.ford.mirror'), fordBefore = fileText(m.files.get(ford.file));
st.run(setRequiresKeepShape(ford, ['mq.bend.call', 'burl.road']));
assert.deepEqual(ford.raw.requires, [{ quest: 'mq.bend.call', done: true }, { quest: 'burl.road', done: true }]);
st.undo(); assert.equal(fileText(m.files.get(ford.file)), fordBefore, 'undo restores');
// format shape stays format
const fq = { raw: { id: 'x', title: 'X', begin: { npc: 'a' }, requires: { quests: ['a'] } }, kind: 'legacy', file: 'x', objectives: [], requires: [] };
setRequiresKeepShape(fq, ['a', 'b']).apply(); assert.deepEqual(fq.raw.requires, { quests: ['a', 'b'] });

// problems: unknown, self, cycles through requires and next
const stub = (id, raw) => ({ id, title: id.toUpperCase(), kind: 'legacy', file: id, raw: { id, ...raw } });
const fake = { quests: [stub('a', { requires: { quests: ['zzz', 'a', 'b'] } }), stub('b', { requires: { quests: ['a'] } }), stub('c', { next: 'a' }), stub('d', { requires: { quests: ['a'] } })] };
r = prereqRows(fake, fake.quests[0]);
assert.deepEqual(r.rows.map((x) => x.problem), ['unknown', 'self', 'cycle']); assert.equal(r.header, '0/3 OK');
fake.quests[0].raw.requires = { quests: ['c', 'd'] };   // c.next = a: a depends on c (fine); d requires a: cycle
assert.deepEqual(prereqRows(fake, fake.quests[0]).rows.map((x) => x.problem), [null, 'cycle']);
console.log('questStrip + prereqs: strip model, card order, rows, shape-keeping write, problems PASS');
