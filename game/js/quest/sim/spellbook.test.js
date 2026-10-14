// SPELLBOOK-01: spells live in the spellbook, not the pack. Run: node game/js/quest/sim/spellbook.test.js
import assert from 'node:assert/strict';
import itemsMod from '../../../../design/items.js';
import { ensureInventory, addItem, countOf } from './inventory.js';
import { ensureEquipment, migrateEquipment, syncHands } from './equipment.js';
import { createQuickbar, assign, ensureQuickbar } from './quickbar.js';
import { migrateSpellbook, learnAndEquip, syncSpellbook, isLearned, learnedIds, tierOf } from './spellbook.js';
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
  const qb = createQuickbar(defs); assign(p, defs, 2, FB);
  assert.equal(qb.press(p, 0), 'shield_on'); assert.equal(p.components.equipment.off, FB);
});
console.log('spellbook: ' + n + ' passed');
