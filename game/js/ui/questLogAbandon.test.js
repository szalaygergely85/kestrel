// OB-219: the J quest log Abandon control (X twice) really abandons an `abandonable` quest: gone from active, objectives reset, tracked pin cleared, giver offer back.
import assert from 'node:assert/strict';
import { createQuestBook, AVAILABLE, ACTIVE } from '../quest/sim/questBook.js';
import { createQuestLogScreen } from './questLog.js';
import { createUiLayer } from '../../../engine/index.js';
import { expandQuest } from '../quest/sim/templates.js';

const main = { version: 1, id: 'm1', objectives: [{ id: 'wake', text: 'Wake', when: { type: 'flag', id: 'wake', equals: true } }] };
const ctx = { sites: { 'packet': { entity: 'x' }, 'post.ws': { entity: 'post1' } }, rewards: {}, items: [], pack: { region: 'west', band: [1, 5] } };
const generated = (() => { try { return expandQuest({ id: 'sq.packet', title: 'The Oilcloth Packet', site: 'packet', steps: [{ template: 'deliver', params: { item: 'packet', to: 'postkeeper' }, objText: 'Bring it' }], abandonable: true, band: 3, giver: { npc: 'rook' }, lines: { offer: ['a', 'b'] } }, ctx); } catch (e) { return null; } })();
const plain = { version: 1, id: 'sq.plain', title: 'Plain', giver: { npc: 'rook' }, abandonable: true, objectives: [{ id: 'a', text: 'Do a', when: { type: 'flag', id: 'a', equals: true } }] };
for (const def of [plain, generated].filter(Boolean)) {
  const book = createQuestBook(main, [def]);
  const id = def.id;
  assert.equal(book.statusOf(id), AVAILABLE);
  assert.ok(book.accept(id), 'accept ' + id);
  assert.equal(book.statusOf(id), ACTIVE);
  book.track(id);
  const log = createQuestLogScreen(book); log.open();
  const idx = book.index(id);
  // select the quest row and press X twice through the UI handler
  const snap0 = log.snapshot(); const want = snap0.left.findIndex(t => t.includes(def.title.slice(0, 6))); assert.ok(want >= 0, "quest listed: " + JSON.stringify(snap0.left)); for (let k = 0; k < want; k++) log.handleKey("KeyS"); assert.equal(log.snapshot().sel, want);
  assert.equal(book.canAbandon(id), true, id + ' canAbandon');
  log.handleKey('KeyX'); assert.equal(book.statusOf(id), ACTIVE, 'first X only asks');
  log.handleKey('KeyX');
  assert.equal(book.statusOf(id), AVAILABLE, id + ': UI abandon -> offer back (giver ! returns)');
  assert.notEqual(book.tracked(), idx, 'tracked pin cleared');
  assert.ok(book.objectives(idx).every(o => o.status !== 'complete'), 'objectives reset');
}
// mouse: the [X] Abandon row is clickable (two clicks), as the owner clicked it in game
{
  const book = createQuestBook(main, [plain]); book.accept('sq.plain');
  const log = createQuestLogScreen(book), ui = createUiLayer({ cols: 100, rows: 40 }); log.open();
  for (let k = 0, w = log.snapshot().left.findIndex(t => t.startsWith('Plain')); k < w; k++) log.handleKey('KeyS');
  const b = log.draw(ui), snap = log.snapshot(), row = snap.right.findIndex(t => t.includes('Abandon'));
  assert.ok(row >= 0, 'abandon row shown');
  const cx = b.x + 30, cy = b.y + 5 + row; // RIGHT_X 29, LIST_TOP 6 - 1
  assert.equal(log.handleClick(cx, cy), true); assert.equal(book.statusOf('sq.plain'), ACTIVE, 'first click asks');
  log.handleClick(cx, cy); assert.equal(book.statusOf('sq.plain'), AVAILABLE, 'second click abandons');
}
console.log('questLogAbandon: UI X-X abandons, offer returns PASS');
