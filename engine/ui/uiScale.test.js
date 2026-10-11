// engine/ui/uiScale.test.js (OB-051). node engine/ui/uiScale.test.js
import { scaledFrac } from './uiScale.js';
import { makeOk } from '../test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const o = [0, 0];
ok('unscaled passes through', scaledFrac(40, 3, 5, 0.25, 0.75, o) === 40 && o[0] === 0.25 && o[1] === 0.75);
const quads = [[0, 0, 0, 0], [1, 0, 0.5, 0], [0, 1, 0, 0.5], [1, 1, 0.5, 0.5]];
for (const [cx, cy, bx, by] of quads) {
  const g = scaledFrac(128 | 40, 10 + cx, 20 + cy, 0.5, 0.5, o);
  ok(`quadrant ${cx},${cy} glyph plain`, g === 40);
  ok(`quadrant ${cx},${cy} frac in [${bx},${bx + 0.5})`, o[0] === bx + 0.25 && o[1] === by + 0.25);
  scaledFrac(128 | 40, 10 + cx, 20 + cy, 0, 0, o);
  ok(`quadrant ${cx},${cy} lower edge`, o[0] === bx && o[1] === by);
  scaledFrac(128 | 40, 10 + cx, 20 + cy, 0.999, 0.999, o);
  ok(`quadrant ${cx},${cy} upper edge < ${bx + 0.5}`, o[0] < bx + 0.5 && o[1] < by + 0.5);
}
console.log(`uiScale.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.map((f) => `  FAIL: ${f}`).join('\n')); process.exit(1); }
