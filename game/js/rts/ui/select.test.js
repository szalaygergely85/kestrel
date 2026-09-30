// RTS-01a a7: selection rules on a fixture. Run by tools/run-tests.mjs.
import { createSelection, clearSelection, selectClick, selectBox, selectedIds } from './select.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.error('FAIL', name, extra); } };

// 10 units: even ids = team 1 (own), odd = team 2 (enemy)
const N = 10;
const team = new Uint8Array(N);
for (let i = 0; i < N; i++) team[i] = (i & 1) ? 2 : 1;
const out = new Int32Array(N);
const list = (s) => Array.from(out.subarray(0, selectedIds(s, N, out)));

{ // click
  const s = createSelection(N);
  selectClick(s, team, 4, false, 1);
  ok('click own selects', list(s).join() === '4' && s.count === 1);
  selectClick(s, team, 6, false, 1);
  ok('click own replaces', list(s).join() === '6' && s.count === 1);
  selectClick(s, team, 2, true, 1);
  ok('shift adds', list(s).join() === '2,6' && s.count === 2);
  selectClick(s, team, 2, true, 1);
  ok('shift on selected is idempotent', s.count === 2);
  selectClick(s, team, 3, false, 1);
  ok('enemy click never selects and keeps the selection', list(s).join() === '2,6');
  selectClick(s, team, 3, true, 1);
  ok('shift + enemy click never selects', list(s).join() === '2,6');
  selectClick(s, team, -1, true, 1);
  ok('shift + empty ground keeps the selection', s.count === 2);
  selectClick(s, team, -1, false, 1);
  ok('empty ground clears', s.count === 0 && list(s).length === 0);
}
{ // box
  const s = createSelection(N);
  const ids = Int32Array.from([0, 1, 2, 3, 5, 6]); // ascending, mixed teams
  selectBox(s, team, ids, ids.length, false, 1);
  ok('box selects own team only', list(s).join() === '0,2,6', list(s).join());
  ok('box never selects enemies', [1, 3, 5].every((i) => !s.flags[i]));
  ok('box result ascending', list(s).join() === '0,2,6');
  selectBox(s, team, Int32Array.from([8]), 1, true, 1);
  ok('shift box adds', list(s).join() === '0,2,6,8' && s.count === 4);
  selectBox(s, team, Int32Array.from([4]), 1, false, 1);
  ok('plain box replaces', list(s).join() === '4' && s.count === 1);
  selectBox(s, team, Int32Array.from([1, 3]), 2, false, 1);
  ok('enemy-only box clears', s.count === 0);
  selectBox(s, team, ids, 0, false, 1);
  ok('empty box clears', s.count === 0);
  clearSelection(s);
  ok('clear on empty is safe', s.count === 0);
}
console.log(`select.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
