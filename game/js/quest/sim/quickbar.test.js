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

// fresh game: both hands from what is worn, keys 1-4 EMPTY (no weapons by default)
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'bow', n: 1 }]);
  equip(p.components.inventory, p.components.equipment, defs, 'sword');
  assert.deepEqual(ensureQuickbar(p, defs), ['sword', null, null, null, null, null]);
  assert.deepEqual(ensureQuickbar(p, defs), ['sword', null, null, null, null, null], 'idempotent');
  addItem(p.components.inventory, defs, 'shield', 1); autoFill(p, defs);
  assert.deepEqual(p.components.quickbar, ['sword', 'shield', null, null, null, null], 'a later find is worn once (RMB)');
  assert.equal(p.components.equipment.off, 'shield');
  assert.equal(clearSlot(p, 1, defs), true); assert.equal(p.components.equipment.off, null); assert.equal(countOf(p.components.inventory, 'shield'), 1, 'back in the pack');
  autoFill(p, defs); assert.equal(p.components.quickbar[1], null, 'a cleared hand is not refilled');
  const q = JSON.parse(JSON.stringify(p.components)); assert.deepEqual(q.quickbar, p.components.quickbar, 'plain JSON (saved)');
}
// migration of an old 4-slot save: weapons -> LMB / RMB, the rest keep their digit
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'shield', n: 1 }, { id: 'bow', n: 1 }, { id: 'potion.hp', n: 2 }]);
  p.components.quickbar = ['sword', 'shield', 'bow', 'potion.hp'];
  const bar = ensureQuickbar(p, defs);
  assert.equal(bar.length, 6); assert.deepEqual(bar, ['sword', 'shield', null, null, 'bow', 'potion.hp']);
  assert.equal(p.components.equipment.main, 'sword'); assert.equal(p.components.equipment.off, 'shield');
  const q = mk([{ id: 'potion.hp', n: 1 }]); q.components.quickbar = [null, null, 'potion.hp', null];
  assert.deepEqual(ensureQuickbar(q), [null, null, null, null, 'potion.hp', null], 'digit kept (no defs needed)');
}
// assign: hand slots equip (LMB sword / bow, RMB shield), refuse the wrong item; key slots take anything usable, one id each
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'shield', n: 1 }, { id: 'bow', n: 1 }, { id: 'potion.hp', n: 3 }, { id: 'hood', n: 1 }]);
  const eq = p.components.equipment;
  assert.equal(assign(p, defs, 0, 'sword'), true); assert.equal(eq.main, 'sword'); assert.equal(eq.set, 'melee'); assert.equal(p.components.quickbar[0], 'sword');
  assert.equal(assign(p, defs, 1, 'shield'), true); assert.equal(eq.off, 'shield');
  assert.equal(assign(p, defs, 1, 'sword'), false, 'sword on RMB'); assert.equal(assign(p, defs, 0, 'shield'), false, 'shield on LMB');
  assert.equal(assign(p, defs, 0, 'potion.hp'), false, 'potion on LMB'); assert.equal(assign(p, defs, 1, 'bow'), false);
  assert.equal(assign(p, defs, 0, 'bow'), true); assert.equal(eq.ranged, 'bow'); assert.equal(eq.set, 'ranged'); assert.equal(p.components.quickbar[0], 'bow', 'bow in LMB: draw on LMB');
  eq.set = 'melee'; assert.equal(ensureQuickbar(p)[0], 'sword', 'Q swap shows in LMB');
  assert.equal(assign(p, defs, 5, 'potion.hp'), true); assert.equal(assign(p, defs, 2, 'potion.hp'), true);
  assert.deepEqual(p.components.quickbar.slice(2), ['potion.hp', null, null, null], 'moved between keys');
  assert.equal(assign(p, defs, 3, 'hood'), false, 'gear'); assert.equal(assign(p, defs, 3, 'junk'), false); assert.equal(assign(p, defs, 6, 'sword'), false);
  assert.equal(assign(p, defs, 4, 'sword'), true, 'a weapon may sit on a key'); assert.equal(p.components.quickbar[4], 'sword');
  assert.equal(countFor(p, defs, 'potion.hp'), 3); assert.equal(countFor(p, defs, 'sword'), 0);
  assert.equal(clearSlot(p, 2, defs), true); assert.equal(p.components.quickbar[2], null);
  assert.equal(clearSlot(p, 0, defs), true); assert.equal(eq.main, null, 'LMB cleared = sword unequipped');
}
// press: key swaps the weapon into LMB / toggles the shield
{
  const p = mk([{ id: 'sword', n: 1 }, { id: 'shield', n: 1 }, { id: 'bow', n: 1 }]);
  const qb = createQuickbar(defs), eq = p.components.equipment;
  assign(p, defs, 2, 'sword'); assign(p, defs, 3, 'shield'); assign(p, defs, 4, 'bow');
  assert.equal(qb.press(p, 2), 'bow'); assert.equal(eq.ranged, 'bow'); assert.equal(eq.set, 'ranged'); assert.equal(p.components.quickbar[0], 'bow');
  assert.equal(qb.press(p, 0), 'main'); assert.equal(eq.main, 'sword'); assert.equal(eq.set, 'melee'); assert.equal(p.components.quickbar[0], 'sword');
  assert.equal(qb.press(p, 1), 'shield_on'); assert.equal(eq.off, 'shield'); assert.equal(p.components.quickbar[1], 'shield');
  assert.equal(qb.press(p, 1), 'shield_off'); assert.equal(eq.off, null); assert.equal(countOf(p.components.inventory, 'shield'), 1);
  assert.equal(qb.press(p, 3), 'empty'); assert.equal(qb.press(p, 9), 'empty');
}
// potion: heal 2 hearts, 0.6 s sip, no double drink, full / none
{
  const p = mk([{ id: 'potion.hp', n: 2 }]);
  const qb = createQuickbar(defs); assign(p, defs, 5, 'potion.hp');
  assert.equal(qb.press(p, 3), 'drank'); assert.equal(p.components.health.hp, 30); assert.equal(countOf(p.components.inventory, 'potion.hp'), 1);
  assert.equal(qb.sipping, true); assert.equal(qb.press(p, 3), 'sip', 'no second sip meanwhile');
  for (let i = 0; i < SIP_STEPS; i++) qb.step(); assert.equal(qb.sipping, false);
  assert.equal(qb.drink(p), 'full', 'not hurt: nothing consumed'); assert.equal(countOf(p.components.inventory, 'potion.hp'), 1);
  p.components.health.hp = 5; assert.equal(qb.drink(p, POTION_ID), 'drank'); assert.equal(p.components.health.hp, 25);
  for (let i = 0; i < SIP_STEPS; i++) qb.step(); p.components.health.hp = 1;
  assert.equal(qb.drink(p), 'none'); assert.equal(qb.press(p, 3), 'none', 'empty stack keeps the slot');
}
console.log('quickbar.test: ok');
