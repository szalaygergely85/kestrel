// QFIX-S4 (OB-155f/o/p/q): hand-in order, requireItem consumed, packet = questPickup, ground drops, reward names.
// Run: node game/js/quest/sim/questHandIn.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, ACTIVE, READY, DONE } from './questBook.js';
import { presentPickups } from '../pickupsView.js';
import { createQuestPickups } from '../../questPickups.js';
import { ensureInventory, countOf } from './inventory.js';
import { linesFor } from '../questSnippets.js';
const mainDef = JSON.parse(readFileSync(new URL('./fixtures/m1.legacy.quest.json', import.meta.url)));
const pack = new Map();
const ops = { count: (id) => pack.get(id) || 0, remove: (id, n) => { pack.set(id, Math.max(0, (pack.get(id) || 0) - n)); }, add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; } };
const sync = (b) => { for (const id of b.countedItems()) b.feed({ type: 'item:count', id, n: ops.count(id) }); };

const packet = { version: 1, id: 'sq.packet', title: 'Packet', giver: { npc: 'packet', turnIn: 'post' }, giveOnAccept: [{ id: 'packet', n: 1 }],
  objectives: [{ id: 'drop', text: 'Leave it at the post', when: { type: 'deliver', id: 'packet', count: 1, to: 'post' } }], reward: { items: [{ id: 'arrow', n: 20 }] } };
const stores = { version: 1, id: 'sq.fc.stores', title: 'Stores', giver: { npc: 'post' },
  objectives: [{ id: 'hunt', text: 'Hunt', when: { type: 'collect', id: 'boar.meat', count: 3 } }], reward: { items: [{ id: 'potion.hp', n: 1 }] } };

{ // OB-155o: READY packet at the post wins over AVAILABLE and over ACTIVE stores
  pack.clear(); const b = createQuestBook(mainDef, [packet, stores]); b.packOps = ops;
  assert.equal(b.inspect('packet').action, 'accept'); sync(b); assert.equal(b.status(1), READY, 'packet in pack -> READY');
  const r = b.inspect('post'); assert.equal(r.action, 'handin', 'hand-in BEFORE offering the stores quest'); assert.equal(r.id, 'sq.packet');
  assert.equal(b.status(1), DONE);
  assert.equal(b.inspect('post').action, 'accept'); assert.equal(b.status(2), ACTIVE);
}
{ // stores ACTIVE first, then packet READY: the active quest never blocks the hand-in
  pack.clear(); const b = createQuestBook(mainDef, [packet, stores]); b.packOps = ops;
  b.inspect('packet'); sync(b); assert.equal(b.accept('sq.fc.stores'), true);
  assert.equal(b.inspect('post').action, 'handin', 'sq.packet at the post while sq.fc.stores is active');
  assert.equal(b.inspect('post').action, 'refuse', 'then the active one refuses');
}
{ // OB-155p: requireItem is consumed at hand-in
  pack.clear(); const q = { version: 1, id: 'sq.arm', title: 'Arm', giver: { npc: 'basket', turnIn: 'basket' }, requireItem: 'signArm',
    objectives: [{ id: 'flg', text: 'Flag', when: { type: 'flag', id: 'arm.done', equals: true } }], reward: { items: [] } };
  const b = createQuestBook(mainDef, [q]); b.packOps = ops; b.accept('sq.arm');
  b.feed({ type: 'flag:set', key: 'arm.done', value: true });
  assert.equal(b.handIn('sq.arm'), null, 'no item, no hand-in'); pack.set('signArm', 1);
  assert.notEqual(b.handIn('sq.arm'), null); assert.equal(pack.get('signArm'), 0, 'consumed');
}
{ // OB-155f: item drops lie on the ground; hp/mp keep hover
  const style = { blink: { lastSteps: 100 }, hp: { hoverM: 0.15, bob: { ampM: 0.04, periodMs: 1000 } }, mp: { hoverM: 0.15, bob: { ampM: 0.04, periodMs: 1000 } } };
  const mkE = (kind) => ({ components: { pickup: { kind, life: 1e6, baseZ: 2 } }, transform: { z: 0 } });
  const es = { it: mkE('item'), hp: mkE('hp') };
  presentPickups({ forEachEntity: (f) => { for (const k in es) f(es[k], k); } }, style, 0.3);
  assert.equal(es.it.transform.z, 2, 'item: exactly baseZ'); assert.ok(es.hp.transform.z > 2.05, 'hp orb hovers');
}
{ // OB-155p: the packet entity is a questPickup that accepts sq.packet (gives the item once), then leaves the world
  pack.clear(); const b = createQuestBook(mainDef, [packet]); b.packOps = ops;
  const ents = new Map([['packet', { transform: { x: 0, y: 0, z: 0 }, components: { questPickup: { item: 'packet', n: 1, acceptQuest: 'sq.packet' } } }]]);
  const world = { forEachEntity: (f) => ents.forEach(f), entity: (id) => ents.get(id), remove: (id) => ents.delete(id) };
  const hook = createQuestPickups({ getBook: () => b, feed: (e) => b.feed(e), defs: { packet: { name: 'Cloth Packet', stackMax: 1 } } });
  const ctx = { world, player: { transform: { x: 0, y: 0, z: 0 } }, state: { interactPressed: true }, inventory: null };
  ctx.player.components = {}; ctx.inventory = ensureInventory(ctx.player);
  hook.onBoot(ctx); hook.sync(); hook.onTick();
  assert.equal(ents.size, 0, 'packet taken off the ground'); assert.ok(b.statusOf('sq.packet') >= ACTIVE, 'accepted'); assert.equal(countOf(ctx.inventory, 'packet'), 1, 'exactly one packet');
}
{ // OB-155q: reward names, never raw ids
  const d = { ...stores, reward: { items: [{ id: 'potion.hp', n: 1 }, { id: 'arrow', n: 15 }] } };
  const defs = { 'potion.hp': { name: 'Health Potion' }, arrow: { name: 'Arrow' } };
  const l = linesFor(d, 'ready', {}, 'Burl', defs).concat(linesFor({ ...d, lines: undefined }, 'ready', { generic: { ready: ['Take this: {reward}.'] } }, 'Burl', defs));
  assert.ok(l.some((x) => x.includes('Health Potion, 15 Arrow')), l.join('|')); assert.ok(l.every((x) => !/potion\.hp/.test(x)));
}
console.log('questHandIn.test.js ok');
