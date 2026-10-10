// QL-04: objects as quest givers AND hand-in targets (book.inspect, giveOnAccept taken back on abandon, entityFor).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE } from './questBook.js';
const mainDef = JSON.parse(readFileSync(new URL('./fixtures/m1.legacy.quest.json', import.meta.url)));
const mk = (extra = {}) => ({
  version: 1, id: 'sq.wreck.plate', title: 'Gondola Plate', abandonable: true,
  giver: { npc: 'gondola', entity: 'tower.gondola', turnInEntity: 'tower.gondola', text: 'A plate is missing.', turnInText: 'The plate fits.', refuseText: 'Nothing to fit yet.' },
  objectives: [
    { id: 'hide', text: 'Find a boar hide', when: { type: 'collect', id: 'boar.hide', count: 1 } },
    { id: 'fit', text: 'Fit it on the gondola', when: { type: 'deliver', id: 'boar.hide', count: 1, to: 'gondola' } }],
  reward: { items: [{ id: 'shield', n: 1 }] }, ...extra });
const pack = new Map();
const ops = { count: id => pack.get(id) || 0, remove: (id, n) => { pack.set(id, Math.max(0, (pack.get(id) || 0) - n)); }, add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; } };
const sync = b => { for (const id of b.countedItems()) b.feed({ type: 'item:count', id, n: ops.count(id) }); };

{ // accept by inspect, no NPC; marks and entity resolution
  const b = createQuestBook(mainDef, [mk()]); b.packOps = ops;
  const a = [], r = []; b.giverMarks(a, r);
  assert.deepEqual([a, r], [['gondola'], []], '! over the object');
  assert.equal(b.entityFor('gondola'), 'tower.gondola'); assert.equal(b.entityFor('bear'), 'bear');
  assert.equal(b.inspect('elsewhere'), null, 'wrong object does nothing');
  const i1 = b.inspect('gondola'); assert.deepEqual([i1.action, i1.text, b.status(1)], ['accept', 'A plate is missing.', ACTIVE]);
  assert.equal(b.inspect('gondola').action, 'refuse', 'active, nothing delivered');
  b.giverMarks(a, r); assert.deepEqual([a, r], [[], []], 'no mark while active');
  // item arrives -> READY -> mark moves to the hand-in object
  pack.set('boar.hide', 1); sync(b); assert.equal(b.status(1), READY);
  b.giverMarks(a, r); assert.deepEqual(r, ['gondola'], '? at the target');
  const h = b.inspect('gondola'); assert.deepEqual([h.action, h.text, pack.get('boar.hide'), b.status(1)], ['handin', 'The plate fits.', 0, DONE]);
  assert.equal(h.reward.items[0].id, 'shield');
  assert.equal(b.inspect('gondola'), null, 'done');
}
{ // hand-in target differs from the giver: wrong object refuses/ignores, consumes exactly one
  pack.clear();
  const d = mk({ giver: { npc: 'plate', turnIn: 'post', entity: 'a.plate', turnInEntity: 'a.post' }, objectives: [
    { id: 'get', text: 'Take the packet', when: { type: 'collect', id: 'packet', count: 1 } }, { id: 'drop', text: 'Post it', when: { type: 'deliver', id: 'packet', count: 1, to: 'post' } }] });
  const b = createQuestBook(mainDef, [d]); b.packOps = ops;
  assert.equal(b.inspect('plate').action, 'accept'); pack.set('packet', 2); sync(b);
  assert.equal(b.status(1), READY);
  assert.equal(b.inspect('plate'), null, 'wrong target, quest untouched'); assert.equal(pack.get('packet'), 2);
  const a = [], r = []; b.giverMarks(a, r); assert.deepEqual(r, ['post'], 'mark moved to the target');
  assert.equal(b.entityFor('post'), 'a.post');
  b.inspect('post'); assert.equal(pack.get('packet'), 1, 'exactly one consumed');
}
{ // giveOnAccept: given on accept, taken back on abandon, saved
  pack.clear();
  const d = mk({ giveOnAccept: [{ id: 'packet', n: 1 }], objectives: [{ id: 'x', text: 'Do', when: { type: 'collect', id: 'zz', count: 1 } }] });
  let b = createQuestBook(mainDef, [d]); b.packOps = ops;
  b.inspect('gondola'); assert.equal(pack.get('packet'), 1);
  const saved = b.toSave(); assert.deepEqual(saved.quests['sq.wreck.plate'].given, [{ id: 'packet', n: 1 }]);
  b = createQuestBook(mainDef, [d], saved); b.packOps = ops;
  assert.equal(b.abandon('sq.wreck.plate'), true); assert.equal(pack.get('packet'), 0, 'taken back after reload too');
  assert.equal(b.status(1), AVAILABLE);
  b.inspect('gondola'); assert.equal(pack.get('packet'), 1, 're-accept gives again');
}
assert.throws(() => createQuestBook(mainDef, [mk({ giveOnAccept: [{ id: 'a', n: 0 }] })]));
console.log('questObject.test OK');
