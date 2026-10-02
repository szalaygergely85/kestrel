// tools/editor/scale.test.mjs - ED-SCALE-1c (docs/architecture.md 34.3/34.4).
// Plain Node ESM, no framework. Run with `node tools/editor/scale.test.mjs`.
import { SCALE_STEPS, nextScale, fineScale, clampScale } from './scale.js';
import { PROP_SCALE_MIN, PROP_SCALE_MAX } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- nextScale: on-ladder values ------------------------------------------
{
  ok('nextScale(1, +1) -> 1.1 (next rung up)', nextScale(1, 1) === 1.1);
  ok('nextScale(1, -1) -> 0.9 (next rung down)', nextScale(1, -1) === 0.9);
  ok('nextScale(0.25, -1) saturates at the bottom rung', nextScale(0.25, -1) === 0.25);
  ok('nextScale(4, +1) saturates at the top rung', nextScale(4, 1) === 4);
  ok('nextScale(2, +1) -> 2.5', nextScale(2, 1) === 2.5);
  ok('nextScale(2, -1) -> 1.75', nextScale(2, -1) === 1.75);
}

// ---- nextScale: off-ladder values ------------------------------------------
{
  ok('nextScale(1.05, +1) -> 1.1 (first rung strictly above)', nextScale(1.05, 1) === 1.1);
  ok('nextScale(1.05, -1) -> 1 (first rung strictly below)', nextScale(1.05, -1) === 1);
  ok('nextScale(0.1, +1) -> 0.25 (below the bottom rung, up goes to the first rung)', nextScale(0.1, 1) === 0.25);
  ok('nextScale(0.1, -1) saturates at the bottom rung', nextScale(0.1, -1) === 0.25);
  ok('nextScale(5, -1) -> 4 (above the top rung, down goes to the last rung)', nextScale(5, -1) === 4);
  ok('nextScale(5, +1) saturates at the top rung', nextScale(5, 1) === 4);
  ok('every SCALE_STEPS entry is within [MIN, MAX]', SCALE_STEPS.every((s) => s >= PROP_SCALE_MIN && s <= PROP_SCALE_MAX));
}

// ---- fineScale: +-0.05, not itself clamped/rounded -------------------------
{
  ok('fineScale(1, +1) -> 1.05', Math.abs(fineScale(1, 1) - 1.05) < 1e-9);
  ok('fineScale(1, -1) -> 0.95', Math.abs(fineScale(1, -1) - 0.95) < 1e-9);
  ok('fineScale(4, +1) goes past MAX unclamped (caller clamps)', fineScale(4, 1) > PROP_SCALE_MAX);
  ok('fineScale(0.25, -1) goes past MIN unclamped (caller clamps)', fineScale(0.25, -1) < PROP_SCALE_MIN);
}

// ---- clampScale: both ends + rounding to 0.01 ------------------------------
{
  ok('clampScale(5) clamps to MAX', clampScale(5) === PROP_SCALE_MAX);
  ok('clampScale(0.1) clamps to MIN', clampScale(0.1) === PROP_SCALE_MIN);
  ok('clampScale(1) is unchanged', clampScale(1) === 1);
  ok('clampScale(1.23456) rounds to 0.01', clampScale(1.23456) === 1.23);
  ok('clampScale(1.005) rounds to 0.01 (two decimals max)', clampScale(1.005) === 1 || clampScale(1.005) === 1.01); // float-boundary tolerant
  ok('clampScale(fineScale(4, 1)) clamps the over-MAX fine step back to MAX', clampScale(fineScale(4, 1)) === PROP_SCALE_MAX);
  ok('clampScale(fineScale(0.25, -1)) clamps the under-MIN fine step back to MIN', clampScale(fineScale(0.25, -1)) === PROP_SCALE_MIN);
  // A repeated fine step that would drift in floating point (0.1 + 0.2 style) still lands on a clean 0.01 grid.
  let v = 1;
  for (let i = 0; i < 3; i++) v = fineScale(v, 1);
  ok('three +0.05 fine steps from 1, clamped, land on 1.15 exactly', clampScale(v) === 1.15, String(clampScale(v)));
}

console.log(`scale.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
