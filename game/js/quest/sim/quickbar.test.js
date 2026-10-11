// game/js/quest/sim/quickbar.test.js (EQ-12). Headless Node ESM: node game/js/quest/sim/quickbar.test.js
import assert from 'node:assert/strict';
import { ensureInventory, addItem, countOf } from './inventory.js';
import { ensureEquipment, equip } from './equipment.js';
import { ensureQuickbar, autoFill, assign, clearSlot, countFor, createQuickbar, SIP_STEPS, POTION_ID } from './quickbar.js';

const defs = {
  sword: { id: 'sword', name: 'Sword', kind: 'weapon', stackMax: 1, equip: { slot: 'main', tier: 'worn', def: 0 } },
  shield: { id: 'shield', name: 'Shield', kind: 'shield', stackMax: 1, equip: { slot: 'off', tier: 'worn', def: 2 } },
  bow: { id: 'bow', name: 'Bow', kind: 'weapon', stackMax: 1, equip: { slot: 'ranged', tier: 'worn', def: 0 } },
  'potion.hp': { id: 'potion.hp', name: 'Red', kind: 'potion', stackMax: 5, use: { heal: 2, unit: 'hearts', time: 0.6 } },
  hood: { id: 'hood', name: 'Hood', kind: 'gear', stackMax: 1, equip: { slot: 'head', tier: 'worn', def: 1 } },
  junk: { id: 'junk', name: 'Junk', kind: 'material', stackMax: 99 },
};
const mk = (pack) => { const p = { components: { health: { hp: 10, max: 30 } } }; ensureInventory(p, { pack }); ensureEquipment(p); return p; };

// old save / fresh: [sword, shield, bow, null] filtered by what is owned
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'bow', n: 1 }]);
  assert.deepEqual(ensureQuickbar(p), ['sword', null, 'bow', null]);
  assert.deepEqual(ensureQuickbar(p), ['sword', null, 'bow', null], 'idempotent');
  addItem(p.components.inventory, defs, 'shield', 1); autoFill(p);
  assert.deepEqual(p.components.quickbar, ['sword', 'shield', 'bow', null], 'a later find fills its default slot once');
  clearSlot(p, 1); autoFill(p);
  assert.equal(p.components.quickbar[1], null, 'a cleared slot is not refilled');
  const q = JSON.parse(JSON.stringify(p.components)); assert.deepEqual(q.quickbar, p.components.quickbar, 'plain JSON (saved)');
}
// assign: one id per slot, gear refused
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'potion.hp', n: 3 }, { id: 'hood', n: 1 }]);
  assert.equal(assign(p, defs, 3, 'potion.hp'), true);
  assert.equal(assign(p, defs, 0, 'potion.hp'), true); assert.deepEqual(p.components.quickbar.slice(0, 4), ['potion.hp', null, null, null], 'moved');
  assert.equal(assign(p, defs, 1, 'hood'), false, 'gear'); assert.equal(assign(p, defs, 1, 'junk'), false); assert.equal(assign(p, defs, 4, 'sword'), false);
  assert.equal(countFor(p, defs, 'potion.hp'), 3); assert.equal(countFor(p, defs, 'sword'), 0);
}
// press: weapon set / shield toggle / bow
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'shield', n: 1 }, { id: 'bow', n: 1 }]);
  const qb = createQuickbar(defs), eq = p.components.equipment;
  assign(p, defs, 0, 'sword'); assign(p, defs, 1, 'shield'); assign(p, defs, 2, 'bow');
  assert.equal(qb.press(p, 2), 'bow'); assert.equal(eq.ranged, 'bow'); assert.equal(eq.set, 'ranged');
  assert.equal(qb.press(p, 0), 'main'); assert.equal(eq.main, 'sword'); assert.equal(eq.set, 'melee');
  assert.equal(qb.press(p, 1), 'shield_on'); assert.equal(eq.off, 'shield');
  assert.equal(qb.press(p, 1), 'shield_off'); assert.equal(eq.off, null); assert.equal(countOf(p.components.inventory, 'shield'), 1);
  assert.equal(qb.press(p, 3), 'empty');
}
// potion: heal 2 hearts, 0.6 s sip, no double drink, full / none
{
  const p = mk([{ id: 'potion.hp', n: 2 }]);
  const qb = createQuickbar(defs); assign(p, defs, 3, 'potion.hp');
  assert.equal(qb.press(p, 3), 'drank'); assert.equal(p.components.health.hp, 30); assert.equal(countOf(p.components.inventory, 'potion.hp'), 1);
  assert.equal(qb.sipping, true); assert.equal(qb.press(p, 3), 'sip', 'no second sip meanwhile');
  for (let i = 0; i < SIP_STEPS; i++) qb.step(); assert.equal(qb.sipping, false);
  assert.equal(qb.drink(p), 'full', 'not hurt: nothing consumed'); assert.equal(countOf(p.components.inventory, 'potion.hp'), 1);
  p.components.health.hp = 5; assert.equal(qb.drink(p, POTION_ID), 'drank'); assert.equal(p.components.health.hp, 25);
  for (let i = 0; i < SIP_STEPS; i++) qb.step(); p.components.health.hp = 1;
  assert.equal(qb.drink(p), 'none'); assert.equal(qb.press(p, 3), 'none', 'empty stack keeps the slot');
}
console.log('quickbar.test: ok');
