// objectOffer.test.js: all 6 objectGiver quests offer Accept/Exit (book.inspect -> 'offer') while available, and the keep-light note opens it on close.
import assert from 'node:assert/strict';
import { createQuestBook, AVAILABLE } from './sim/questBook.js';
import { createNoteOffer } from './objectOffer.js';
const { loadDesignAssets, loadPackQuests, loadQuestFiles } = await import('../../../tools/validate-content.mjs');
const qdir = new URL('../../../content/quests', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const packs = await loadPackQuests(qdir, (await loadDesignAssets()).items?.defs);
const all = [...packs.quests.map((q) => q.def), ...loadQuestFiles(qdir).quests.map((q) => q.def)];
const defs = all.filter((d) => d.objectGiver === true && d.giver);
const ids = new Set(defs.map((d) => d.giver.npc));
for (const g of ['noteKeepLight', 'notePost', 'gondola', 'packet', 'owBoard', 'pierStone']) assert.ok(ids.has(g), 'objectGiver in data: ' + g);
assert.equal(ids.size, 6, 'exactly the 6 object givers: ' + [...ids]);
const main = { version: 1, id: 'mq', title: 'T', objectives: [{ id: 'a', text: 'a', when: { type: 'flag', id: 'x', equals: true } }] };
for (const d of defs) { // pack defs lack nothing the book needs except requires we drop (offer is about the giver, not the gate)
  const def = { ...structuredClone(d), requires: [] };
  const book = createQuestBook(main, [def]);
  assert.equal(book.statusOf(def.id), AVAILABLE, def.id);
  const opened = []; const sink = (id) => { const r = book.inspect(id); if (r && r.action === 'offer') opened.push(id); return r; };
  sink(def.giver.npc);
  assert.deepEqual(opened, [def.giver.npc], def.id + ' offers Accept/Exit on inspect');
  assert.equal(book.statusOf(def.id), AVAILABLE, 'offer does not accept');
  book.accept(def.id); opened.length = 0; sink(def.giver.npc);
  assert.deepEqual(opened, [], def.id + ': once active inspect is the plain read/inspect');
}
// keep-light note: opens on the close edge only, only while available
{
  const def = { ...structuredClone(defs.find((d) => d.giver.npc === 'noteKeepLight')), requires: [] };
  const book = createQuestBook(main, [def]); const opened = [];
  const n = createNoteOffer({ getBook: () => book, inspect: (id) => opened.push(id) });
  assert.equal(n.step(null), false); assert.equal(n.step('keepLight'), false); assert.equal(n.step('keepLight'), false);
  assert.equal(n.step(null), true); assert.deepEqual(opened, ['noteKeepLight']);
  assert.equal(n.step(null), false);
  n.step('other'); assert.equal(n.step(null), false, 'other notes never offer');
  book.accept(def.id); n.step('keepLight'); assert.equal(n.step(null), false, 'active: no offer');
}
console.log('objectOffer.test OK');
