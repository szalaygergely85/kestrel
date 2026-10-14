// FB-01 review note: locked fireball -> the right hand starts empty; unlocked/dev override -> spell.fireball in the right hand.
import { START_DEMO, START_FULL, startFor } from './startConfig.js';
import { ensureInventory } from './sim/inventory.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
ok(startFor(false, true) === START_FULL && startFor(false, false) === START_FULL, 'demo=0 -> START_FULL');
ok(startFor(true, true) === START_DEMO, 'unlocked -> START_DEMO');
const locked = startFor(true, false);
ok(locked.right === null && locked.left === null && locked.pack.length === 0, 'locked -> empty right hand, empty pack');
const p = { components: { health: { hp: 20, max: 30 } } };
const inv = ensureInventory(p, locked);
ok(!JSON.stringify(inv).includes('spell.fireball') && !JSON.stringify(inv.hands || inv.right || '').includes('spell.fireball'), 'locked start: no spell anywhere');
const p2 = { components: { health: { hp: 20, max: 30 } } };
ok(ensureInventory(p2, START_DEMO).right === 'spell.fireball', 'unlocked start keeps it in the hand');
console.log(fail ? `startConfig: ${fail} FAIL` : 'startConfig: OK'); if (fail) process.exit(1);
