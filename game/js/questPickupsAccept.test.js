// BH-S6: picking up an acceptQuest prop emits inventory:added exactly once (the accept path's own add), none on a full pack.
// Run: node game/js/questPickupsAccept.test.js
import assert from 'node:assert/strict';
import { createQuestPickups } from './questPickups.js';
import { ensureInventory } from './quest/sim/inventory.js';

function run(full) {
  const added = []; const inv = ensureInventory({}, full ? { pack: Array.from({ length: 24 }, () => ({ id: 'rock', n: 1 })) } : null); let have = 0, removed = [];
  const events = { emit: (n, d) => { if (n === 'inventory:added') added.push(d); } };
  const defs = { packet: { name: 'Cloth packet', stackMax: 9 }, rock: { name: 'Rock', stackMax: 1 } };
  const book = { packOps: null, statusOf: () => (have || full ? 2 : 1), countedItems: () => [],
    accept(q) { if (q !== 'sq.packet') return false; if (this.packOps.add('packet', 1) > 0) have += 1; return true; } };
  const ent = { transform: { x: 0, y: 0, z: 0 }, components: { questPickup: { item: 'packet', n: 1, acceptQuest: 'sq.packet' } } };
  const world = { forEachEntity: (fn) => fn(ent, 'pk'), entity: (id) => (removed.includes(id) ? null : ent), remove: (id) => removed.push(id), addInteractable() {}, removeInteractable() {} };
  const qp = createQuestPickups({ getBook: () => book, feed() {}, defs });
  const ctx = { world, events, state: {}, inventory: inv, player: { transform: { x: 0, y: 0, z: 0 } } };
  qp.onBoot(ctx);
  const st = { interactPressed: false }; ctx.state = st;
  for (let i = 0; i < 10; i++) qp.onTick(); // poll installs book.packOps
  st.interactPressed = true; qp.onTick();
  return { added, removed };
}
const a = run(false); assert.equal(a.added.length, 1, 'normal pick: one inventory:added'); assert.deepEqual(a.removed, ['pk']);
const b = run(true); assert.equal(b.added.length, 0, 'full pack: no "+1" toast');
console.log('questPickupsAccept: ok');

// OB-216: an object giver whose quest is not open yet (opensAfter) is hidden with no '[E] Pick up' prompt; it appears once the quest is AVAILABLE.
{
  let status = 0; const ia = new Set(); let accepted = 0;
  const inv = ensureInventory({}, null);
  const book = { packOps: null, statusOf: () => status, countedItems: () => [], accept() { if (status !== 1) return false; accepted++; this.packOps.add('packet', 1); status = 2; return true; } };
  const ent = { transform: { x: 0, y: 0, z: 0 }, components: { voxel: { model: 'pickup.packet' }, questPickup: { item: 'packet', n: 1, acceptQuest: 'sq.packet' } } };
  const removed = [];
  const world = { renderVersion: 0, forEachEntity: (fn) => fn(ent, 'pk'), entity: (id) => (removed.includes(id) ? null : ent), remove: (id) => removed.push(id), addInteractable: (d) => ia.add(d.key), removeInteractable: (k) => ia.delete(k) };
  const qp = createQuestPickups({ getBook: () => book, feed() {}, defs: { packet: { name: 'Cloth packet', stackMax: 9 } } });
  const st = { interactPressed: false };
  qp.onBoot({ world, events: { emit() {} }, state: st, inventory: inv, player: { transform: { x: 0, y: 0, z: 0 } } });
  assert.equal(ia.size, 0, 'locked quest: no pick-up prompt'); assert.equal(ent.components.voxel.hidden, true, 'locked quest: packet hidden');
  st.interactPressed = true; qp.onTick(); st.interactPressed = false; assert.equal(accepted, 0, 'locked: E does nothing');
  status = 1; for (let i = 0; i < 10; i++) qp.onTick();
  assert.ok(ia.has('qp.pk'), 'open quest: prompt back'); assert.equal(ent.components.voxel.hidden, false, 'open quest: packet visible');
  st.interactPressed = true; qp.onTick(); assert.equal(accepted, 1, 'open: E accepts'); assert.deepEqual(removed, ['pk']);
  console.log('questPickupsAccept OB-216: ok');
}
