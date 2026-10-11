// game/js/quest/quickbarDrag.test.js (QB-6). Node ESM: node game/js/quest/quickbarDrag.test.js
import assert from 'node:assert/strict';
import { createQuickbarDrag } from './quickbarDrag.js';

const ids = [null, null, 'potion.hp', null, null, null], calls = [];
const slotAt = (x, y) => (y >= 50 && x >= 10 && x < 70 ? Math.floor((x - 10) / 10) : -1);
const d = createQuickbarDrag({
  slotAt, idAt: (s) => ids[s],
  assign: (s, id) => { calls.push(['assign', s, id]); return s !== 1 || id === 'shield'; },
  clear: (s) => { calls.push(['clear', s]); return s !== 0; },
});
// menu -> bar
assert.equal(d.down(30, 20, 'sword'), true); assert.equal(d.ghostId, null, 'no ghost before moving');
d.move(12, 52); assert.equal(d.ghostId, 'sword');
assert.deepEqual(d.up(12, 52), { kind: 'assign', slot: 0, id: 'sword' }); assert.equal(d.active, false);
// refuse
d.down(30, 20, 'sword'); d.move(22, 52); assert.equal(d.up(22, 52).kind, 'refuse', 'wrong item for RMB');
// plain click = nothing
d.down(30, 20, 'sword'); assert.equal(d.up(30, 20), null);
// drag off the bar clears
d.down(32, 52, null); d.move(32, 20); assert.deepEqual(d.up(32, 20), { kind: 'clear', slot: 2, id: 'potion.hp' });
d.down(32, 52, null); d.move(34, 52); assert.equal(d.up(34, 52).kind, 'keep', 'dropped back on its own slot');
// bar slot -> other slot assigns
d.down(32, 52, null); d.move(52, 52); assert.deepEqual(d.up(52, 52), { kind: 'assign', slot: 4, id: 'potion.hp' });
// empty bar slot / nothing under the pointer: no drag
assert.equal(d.down(52, 52, null), false); assert.equal(d.down(5, 5, null), false);
// menu item dropped off the bar = cancelled
d.down(30, 20, 'sword'); d.move(31, 21); assert.equal(d.up(31, 21), null);
console.log('quickbarDrag.test: ok');
