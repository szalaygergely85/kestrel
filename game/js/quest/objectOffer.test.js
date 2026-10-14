// objectOffer.test.js: all 6 objectGiver quests offer Accept/Exit (book.inspect -> 'offer') while available, and the keep-light note opens it on close.
import assert from 'node:assert/strict';
import { createQuestBook, AVAILABLE } from './sim/questBook.js';
import { createNoteOffer } from './objectOffer.js';
import { noteRead, resetNoteRead, stepNoteRead, isNoteOpen, setNoteOfferProvider, drawNotePanel, OFFER_FOOTER_TEXT } from './noteRead.js';
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
// OB-173: the note panel itself offers [E] Accept / [Q] Close (no offer dialogue)
{
  const def = { ...structuredClone(defs.find((d) => d.giver.npc === 'noteKeepLight')), requires: [] };
  const book = createQuestBook(main, [def]); const opened = []; const events = [];
  const n = createNoteOffer({ getBook: () => book, inspect: (id) => opened.push(id) });
  setNoteOfferProvider((id) => n.offerFor(id));
  resetNoteRead({ note: { fadeIn: 0.1, fadeOut: 0.1 } });
  const world = { state: {} }; let key = null, consumed = 0;
  const inp = { pressed: (c) => c === key, consumePressed: () => { consumed++; key = null; } };
  const step = () => { stepNoteRead(0.2, inp, true); n.step(null); };
  let grid = new Map();
  const ui = { cols: 120, rows: 40, setCellRGB: (x, y, g) => { grid.set(y * 1000 + x, String.fromCharCode(g + 32)); } };
  const footerShown = () => { grid = new Map(); drawNotePanel(ui, { keepLight: { title: 'T', lines: ['a'] } }, { note: { rgb: { paper: [1, 1, 1], paperEdge: [1, 1, 1], edgeInk: [1, 1, 1], inkFaded: [1, 1, 1], inkKey: [1, 1, 1], ink: [1, 1, 1], inkTitle: [1, 1, 1], shadow: [0, 0, 0] } } }); const ks = [...grid.keys()].sort((a, b) => a - b); return ks.map((k) => grid.get(k)).join('').includes('[E] Accept'); };
  // Q: closes, quest stays available, no offer dialogue
  noteRead({ world, def: { noteId: 'keepLight' } }); step(); step();
  assert.ok(isNoteOpen()); assert.ok(footerShown(), 'offer footer shows [E] Accept');
  key = 'KeyQ'; step(); step(); step();
  assert.ok(!isNoteOpen()); assert.equal(book.statusOf(def.id), AVAILABLE, 'Q does not accept'); assert.deepEqual(opened, [], 'Q opens no offer dialogue');
  // second read still offers; E accepts
  noteRead({ world, def: { noteId: 'keepLight' } }); step(); step();
  assert.ok(footerShown(), 'second read offers again');
  const before = consumed; key = 'KeyE'; step(); step(); step();
  assert.ok(!isNoteOpen()); assert.equal(consumed, before + 1, 'E consumed'); assert.notEqual(book.statusOf(def.id), AVAILABLE, 'E accepts'); assert.equal(book.tracked(), book.index(def.id), 'OB-177: accepted quest is the tracked one'); assert.deepEqual(opened, []);
  // accepted: no more offer; plain footer, E closes
  noteRead({ world, def: { noteId: 'keepLight' } }); step(); step();
  assert.ok(!footerShown(), 'no Accept footer once accepted'); key = 'KeyE'; step(); step(); assert.ok(!isNoteOpen(), 'E closes plain note');
  // non-offer note: unchanged
  noteRead({ world, def: { noteId: 'keeperLog' } }); step(); step();
  assert.ok(!footerShown()); key = 'KeyE'; step(); step(); assert.ok(!isNoteOpen());
  setNoteOfferProvider(null);
}
console.log('objectOffer.test OK');
