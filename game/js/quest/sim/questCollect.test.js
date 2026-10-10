// QUESTS-01: collect/deliver objectives (pack-counted), abandon, save/load, no double count; questPickups hook; real sq.burl.blue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE } from './questBook.js';
import { stringifyQuest } from './quest.js';
import { ensureInventory, addItem, countOf, removeItem } from './inventory.js';
import { createQuestPickups } from '../../questPickups.js';
const rd = p => JSON.parse(readFileSync(new URL('../../../../content/quests/' + p, import.meta.url)));
const main = { version: 1, id: 'm1', objectives: [{ id: 'wake', text: 'Wake', when: { type: 'flag', id: 'wake', equals: true } }] };
const def = { ...rd('sq.burl.blue.quest.json'), requires: undefined };
const defs = { 'berry.blue': { stackMax: 20 }, 'gear.cloak.cloak.worn': { stackMax: 1 } };
const count = (b, n) => b.feed({ type: 'item:count', id: 'berry.blue', n });
const mk = (saved) => createQuestBook(main, [def], saved);

// collect counts items present before accept, completes at N, re-feeding the same number never double counts
let b = mk();
assert.equal(b.statusOf(def.id), AVAILABLE);
count(b, 3); count(b, 3); count(b, 3);
assert.equal(b.objectives(1, [])[0].progress, 3);
assert.ok(b.accept(def.id)); assert.equal(b.statusOf(def.id), ACTIVE);
count(b, 6);
assert.equal(b.statusOf(def.id), READY);
assert.deepEqual(b.countedItems(), ['berry.blue']);

// save/load keeps the count and the status
const saved = JSON.parse(JSON.stringify(b.toSave()));
assert.equal(saved.quests[def.id].quest.counts['berry.blue'], 6);
const b2 = mk(saved);
assert.equal(b2.statusOf(def.id), READY);
assert.equal(stringifyQuest(b2.questState(1), def), stringifyQuest(b.questState(1), def));
assert.equal(stringifyQuest(mk().questState(1), def).includes('counts'), false, 'empty counts stay out of old-shape saves');

// deliver: needs packOps, removes items at hand-in, fails if the pack is short
const inv = ensureInventory({ components: {} }, null);
addItem(inv, defs, 'berry.blue', 6);
const ops = { count: id => countOf(inv, id), remove: (id, n) => removeItem(inv, id, n) };
assert.equal(b2.handIn(def.id), null, 'no packOps -> cannot deliver');
b2.packOps = ops; removeItem(inv, 'berry.blue', 1);
assert.equal(b2.handIn(def.id), null, 'short pack -> cannot deliver'); assert.equal(b2.statusOf(def.id), READY);
addItem(inv, defs, 'berry.blue', 1);
const reward = b2.handIn(def.id);
assert.deepEqual(reward.items, [{ id: 'gear.cloak.cloak.worn', n: 1 }]);
assert.equal(countOf(inv, 'berry.blue'), 0); assert.equal(b2.statusOf(def.id), DONE);
assert.equal(b2.handIn(def.id), null, 'no second hand-in');

// abandon: progress resets, accepted cleared, abandonable only, counts re-applied from the pack
let b3 = mk(); b3.accept(def.id); count(b3, 6);
assert.ok(b3.canAbandon(def.id)); const ev = []; b3.onChange = (n, id) => ev.push(n + ':' + id);
assert.ok(b3.abandon(def.id)); assert.deepEqual(ev, ['quest:abandoned:' + def.id]);
assert.equal(b3.statusOf(def.id), AVAILABLE); assert.equal(b3.questState(1).completed.length, 2); // pack still holds 6 -> the facts stand, re-accept finishes at once
assert.ok(b3.accept(def.id)); assert.equal(b3.statusOf(def.id), READY, 'pack still holds 6 -> re-accept is ready at once');
b3.packOps = { count: () => 6, remove() {} }; assert.ok(b3.handIn(def.id)); // (done quests cannot abandon)
assert.equal(b3.canAbandon(def.id), false);
let b4 = mk(); b4.accept(def.id); count(b4, 2); b4.abandon(def.id); b4.accept(def.id);
assert.equal(b4.statusOf(def.id), ACTIVE); assert.equal(b4.objectives(1, [])[0].progress, 2); assert.equal(b4.questState(1).completed.length, 0);
assert.equal(b3.abandon('m1'), false);
assert.equal(createQuestBook(main, [{ ...def, abandonable: undefined }]).canAbandon(def.id), false);
assert.throws(() => createQuestBook(main, [{ ...def, giver: { npc: 'bear', turnIn: 'fox' } }]), /deliver\.to/);

// questPickups hook: E takes the nearest sprig once (stays removed), count feeds the book, reward lands in the pack
const removed = new Set(), ents = new Map();
for (let i = 1; i <= 6; i++) ents.set('berry' + i, { transform: { x: 10 * i, y: 0, z: 0 }, components: { questPickup: { item: 'berry.blue', n: 1 } } });
const world = { forEachEntity: f => { for (const [id, e] of ents) if (!removed.has(id)) f(e, id); }, entity: id => (removed.has(id) ? null : ents.get(id)), remove: id => removed.add(id) };
const inv2 = ensureInventory({ components: {} }, null), emitted = [];
const bk = mk(); bk.accept(def.id);
const qp = createQuestPickups({ getBook: () => bk, feed: e => bk.feed(e), defs });
const ctx = { world, player: { transform: { x: 10, y: 0, z: 0 } }, inventory: inv2, events: { emit: (n, p) => emitted.push(n + ':' + p.id) }, state: { interactPressed: true } };
qp.onBoot(ctx);
qp.onTick(); qp.onTick(); // second press at the same spot: the sprig is gone -> nothing more
assert.equal(countOf(inv2, 'berry.blue'), 1); assert.deepEqual(emitted, ['inventory:added:berry.blue']); assert.ok(removed.has('berry1'));
for (let i = 2; i <= 6; i++) { ctx.player.transform.x = 10 * i; qp.onTick(); }
for (let i = 0; i < 10; i++) qp.onTick();
assert.equal(countOf(inv2, 'berry.blue'), 6); assert.equal(bk.statusOf(def.id), READY);
assert.equal(qp.grantReward({ items: [{ id: 'gear.cloak.cloak.worn', n: 1 }] }), 1); assert.equal(countOf(inv2, 'gear.cloak.cloak.worn'), 1);
const r = bk.handIn(def.id); assert.ok(r && countOf(inv2, 'berry.blue') === 0, 'hook installed packOps');
qp.onBoot({ ...ctx, state: { interactPressed: true } }); // reload: removed sprigs are not entities any more
assert.equal(qp.props.length, 0);
console.log('questCollect.test.js ok');
