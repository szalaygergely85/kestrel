// FB-01 review note: locked fireball -> the right hand starts empty; unlocked/dev override -> spell.fireball in the right hand.
import { START_DEMO, START_FULL, startFor, stripPackSpell, grantSpellHand } from './startConfig.js';
import { addItem } from './sim/inventory.js';
import { equip } from './sim/equipment.js';
import { ensureInventory } from './sim/inventory.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
ok(startFor(false, true) === START_FULL && startFor(false, false) === START_FULL, 'demo=0 -> START_FULL');
ok(startFor(true, true) === START_DEMO, 'unlocked -> START_DEMO');
const locked = startFor(true, false);
ok(locked.right === null && locked.left === null && locked.pack.length === 0, 'locked -> empty hands, empty pack (OB-217)');
const p = { components: { health: { hp: 20, max: 30 } } };
const inv = ensureInventory(p, locked);
ok(!JSON.stringify(inv).includes('spell.fireball'), 'locked start: no spell cell anywhere');
const p2 = { components: { health: { hp: 20, max: 30 } } };
ok(JSON.stringify(ensureInventory(p2, START_DEMO)).includes('spell.fireball'), 'unlocked start keeps it');

// OB-217: unlock -> pack unchanged, spell in the off hand; old save with the spell in the pack -> removed
const defs = { 'spell.fireball': { id: 'spell.fireball', name: 'Fireball', kind: 'spell', stackMax: 1, equip: { slot: 'off' } }, apple: { id: 'apple', name: 'Apple', kind: 'food', stackMax: 9 } };
const pk = { components: {} }; const iv = ensureInventory(pk, startFor(true, false)); addItem(iv, defs, 'apple', 3);
const eq = { off: null, main: null, set: 'melee' };
const used = (v) => v.slots.filter((s) => s.id).length, before = JSON.stringify(iv);
ok(grantSpellHand(iv, eq, defs, equip, addItem) && eq.off === 'spell.fireball', 'unlock equips the spell');
ok(JSON.stringify(iv) === before && used(iv) === 1, 'unlock leaves pack contents + free slots unchanged');
const old = { slots: Array.from({ length: 24 }, () => ({ id: null, n: 0 })), left: null, right: null }; old.slots[0] = { id: 'spell.fireball', n: 1 }; old.slots[1] = { id: 'apple', n: 2 };
ok(stripPackSpell(old) === 1 && used(old) === 1 && old.slots[1].id === 'apple', 'old save: stray spell cell removed');
const eq2 = { off: null, main: null, set: 'melee' };
ok(grantSpellHand(old, eq2, defs, equip, addItem) && eq2.off === 'spell.fireball' && used(old) === 1, 'old save + unlocked: spell available in off hand');
const occ = { off: 'shield', main: null, set: 'melee' }, pk3 = { components: {} }, iv3 = ensureInventory(pk3, startFor(true, false)), b3 = JSON.stringify(iv3);
ok(!grantSpellHand(iv3, occ, defs, equip, addItem) && occ.off === 'shield' && JSON.stringify(iv3) === b3, 'off hand occupied: nothing equipped, pack unchanged (spell stays known via world.state magic.fireball / spellbook)');
occ.off = null; // the player frees the off hand -> the next sync equips the known spell
ok(grantSpellHand(iv3, occ, defs, equip, addItem) && occ.off === 'spell.fireball' && JSON.stringify(iv3) === b3, 'off hand freed later: spell equipped, pack unchanged');
ok(!grantSpellHand(iv3, occ, defs, equip, addItem), 'already equipped: no-op');
console.log(fail ? `startConfig: ${fail} FAIL` : 'startConfig: OK'); if (fail) process.exit(1);
