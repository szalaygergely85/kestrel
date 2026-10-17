// node game/js/quest/chestFlags.test.js
import { makeOk } from '../../../engine/test/assert.js';
import { bindChestFlags, seedChestFlags, chestFlagKey } from './chestFlags.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const subs = new Map(), events = { on: (n, f) => { subs.set(n, f); return () => subs.delete(n); } };
const got = []; const off = bindChestFlags(events, (k) => got.push(k));
subs.get('chest:opened')({ id: 'chestCart' }); subs.get('chest:opened')({}); subs.get('chest:opened')(null);
ok('chest:opened -> chest.<id> flag, junk ignored', got.length === 1 && got[0] === 'chest.chestCart' && chestFlagKey('chestBoots') === 'chest.chestBoots');
off(); ok('unsubscribe works', !subs.has('chest:opened'));
const seeded = []; seedChestFlags(['chestBoots', 7, 'chestCart'], (k) => seeded.push(k));
ok('seed re-raises flags of already opened chests', seeded.join() === 'chest.chestBoots,chest.chestCart');
console.log(`chestFlags.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('  - ' + m); process.exit(1); }
