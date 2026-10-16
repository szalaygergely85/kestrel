// PLAYER-LEVEL-01 AC6: playerLevel / itemLevel allocate nothing per call after warm-up (own isolate, like arrows.alloc.test.js).
// Run: node --expose-gc game/js/quest/sim/power.alloc.test.js
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { playerLevel, itemLevel } from './power.js';

const defs = { sword: { kind: 'gear', equip: { slot: 'main', tier: 'worn' } }, bow: { kind: 'gear', equip: { slot: 'ranged', tier: 'fine' } },
  shield: { kind: 'gear', equip: { slot: 'off', tier: 'sturdy' } }, arrow: { kind: 'gear', equip: { slot: 'quiver', tier: 'worn' } } };
const plain = { main: 'sword', ranged: 'bow', off: 'shield', quiver: { id: 'arrow', n: 12 }, head: null };
const rolled = { main: 'u#1', body: 'b#1', off: 'shield', rolled: {
  main: { id: 'u#1', type: 'sword', iL: 10, r: 4, a: [['A1', 0.3], ['A2', 10]] }, body: { id: 'b#1', type: 'body', iL: 5, r: 2, a: [['A6', 9], ['A7', 0.12]] } } };
const book = { fireball: 2, freeze: 1, telekinesis: 0, teleport: 3 };
let acc = 0, bad = 0;
for (const [name, eq] of [['plain kit', plain], ['rolled kit', rolled]]) {
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) acc = (acc + playerLevel(book, eq, defs) + itemLevel(eq, defs)) | 0; }, { n: 10000, warm: 3 });
  if (skipNote(r, name)) continue;
  const ok = r.perCall < 4;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' ' + r.perCall.toFixed(2) + ' B/call');
  if (!ok) bad++;
}
if (bad) process.exitCode = 1;
