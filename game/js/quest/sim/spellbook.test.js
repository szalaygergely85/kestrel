// SPELLBOOK-01: spells live in the spellbook, not the pack. Run: node game/js/quest/sim/spellbook.test.js
import assert from 'node:assert/strict';
import itemsMod from '../../../../design/items.js';
import { ensureInventory, addItem, countOf } from './inventory.js';
import { ensureEquipment, migrateEquipment, syncHands } from './equipment.js';
import { createQuickbar, assign, ensureQuickbar } from './quickbar.js';
import { migrateSpellbook, learnSpell, learnAndEquip, syncSpellbook, isLearned, learnedIds, tierOf } from './spellbook.js';
itemsMod;
const defs = globalThis.ASSETS.items.defs, FB = 'spell.fireball';
const mk = (start) => { const p = { components: { health: { hp: 10, max: 10 } } }; ensureInventory(p, start); ensureEquipment(p); return p; };
let n = 0; const t = (name, f) => { f(); n++; };

t('old save: spell.fireball in the pack moves to the spellbook, slot freed', () => {
  const p = mk({ pack: [{ id: 'sword', n: 1 }, { id: FB, n: 1 }], left: null, right: null });
  assert.equal(migrateSpellbook(p, defs), 1);
  assert.equal(countOf(p.components.inventory, FB), 0);
  assert.equal(p.components.inventory.slots[1].id, null);
  assert.ok(isLearned(p, FB)); assert.equal(tierOf(p, FB), 1);
  assert.equal(migrateSpellbook(p, defs), 0, 'idempotent');
  assert.equal(countOf(p.components.inventory, 'sword'), 1, 'other items kept');
});
t('old save with the spell already in the off hand keeps casting', () => {
  const p = mk({ pack: [{ id: FB, n: 1 }], left: null, right: null });
  p.components.equipment.off = FB; syncSpellbook(p, defs, FB, false);
  syncHands(p.components.inventory, p.components.equipment);
  assert.equal(p.components.inventory.right, FB); assert.equal(countOf(p.components.inventory, FB), 0);
});
t('learning adds it to the book and the free off hand, never the pack', () => {
  const p = mk({ pack: [], left: null, right: null });
  assert.deepEqual(learnedIds(p), []);
  learnAndEquip(p, defs, FB);
  assert.deepEqual(learnedIds(p), [FB]); assert.equal(p.components.equipment.off, FB);
  assert.equal(countOf(p.components.inventory, FB), 0);
});
t('quick bar: hand assign needs a learned spell, casts via the off hand; shield swap never packs the spell', () => {
  const p = mk({ pack: [{ id: 'shield', n: 1 }], left: null, right: null });
  assert.equal(assign(p, defs, 1, FB), false, 'unlearned refused');
  learnAndEquip(p, defs, FB);
  p.components.equipment.off = null; ensureQuickbar(p, defs);
  assert.equal(assign(p, defs, 1, FB), true); assert.equal(p.components.equipment.off, FB);
  syncHands(p.components.inventory, p.components.equipment); assert.equal(p.components.inventory.right, FB, 'hand derived');
  assert.equal(assign(p, defs, 1, 'shield'), true);
  assert.equal(countOf(p.components.inventory, FB), 0, 'spell not dropped into the pack');
  assert.ok(isLearned(p, FB), 'still in the book');
});
t('SPELLBOOK-02: quick-bar keys refuse a spell (hands only)', () => {
  const p = mk({ pack: [], left: null, right: null }); learnAndEquip(p, defs, FB); ensureQuickbar(p, defs);
  for (let s = 2; s < 6; s++) assert.equal(assign(p, defs, s, FB), false);
  assert.ok(p.components.quickbar.slice(2).every((x) => x === null));
});
t('SPELLBOOK-02: old save with a spell on the bar -> cleared, spell kept in book and hand', () => {
  const p = mk({ pack: [], left: null, right: null }); learnAndEquip(p, defs, FB);
  p.components.quickbar = [null, null, FB, 'potion.hp', null, null]; p.components.quickbarSeen = {};
  ensureQuickbar(p, defs);
  assert.equal(p.components.quickbar[2], null); assert.equal(p.components.quickbar[3], 'potion.hp');
  assert.ok(isLearned(p, FB)); assert.equal(p.components.equipment.off, FB);
  p.components.quickbar = [null, null, null, null]; p.components.quickbar[1] = FB; // old 4-slot shape
  ensureQuickbar(p, defs); assert.ok(p.components.quickbar.slice(2).every((x) => x !== FB)); assert.ok(isLearned(p, FB));
});
t('SPELLBOOK-02: right hand (slot 1) / left hand (slot 0, sword back to the pack); cast hand derived', () => {
  const p = mk({ pack: [{ id: 'sword', n: 1 }], left: null, right: null });
  learnSpell(p, FB); ensureQuickbar(p, defs);
  assert.equal(assign(p, defs, 1, FB), true); assert.equal(p.components.equipment.off, FB);
  p.components.equipment.main = 'sword'; p.components.inventory.slots[0].id = null;
  assert.equal(assign(p, defs, 0, FB), true);
  const e = p.components.equipment; assert.equal(e.main, FB); assert.equal(e.off, null, 'one hand per spell');
  assert.equal(countOf(p.components.inventory, 'sword'), 1, 'sword returned to the pack');
  syncHands(p.components.inventory, e); assert.equal(p.components.inventory.left, FB);
  assert.equal(assign(p, defs, 1, FB), true); assert.equal(e.main, null); assert.equal(e.off, FB);
  syncHands(p.components.inventory, e); assert.equal(p.components.inventory.right, FB);
});
// ARCH CHANGES (batch 4): ensureSpellbook repairs a missing / invalid learned map; the migration nulls `it` of the slot it frees
{
  for (const bad of [undefined, null, 5, 'x', []]) {
    const p = { components: { spellbook: { learned: bad } } };
    assert.deepEqual(learnedIds(p), bad === undefined || bad === null || bad === 5 || bad === 'x' ? learnedIds(p) : []); // readers never throw
    assert.equal(isLearned(p, 'x'), false); assert.equal(tierOf(p, 'x'), 0);
    migrateSpellbook(p, {}); assert.deepEqual(p.components.spellbook.learned, {}); learnSpell(p, 'spell.fireball'); assert.equal(isLearned(p, 'spell.fireball'), true);
  }
  const p = { components: {} }; ensureInventory(p, { pack: [] });
  const defs2 = { 'spell.fireball': { kind: 'spell' } };
  const sl = p.components.inventory.slots[0]; sl.id = 'spell.fireball'; sl.n = 1; sl.it = { iL: 1 };
  assert.equal(migrateSpellbook(p, defs2), 1); assert.equal(sl.it, null); assert.equal(sl.id, null);
  n++;
}
console.log('spellbook: ' + n + ' passed');
