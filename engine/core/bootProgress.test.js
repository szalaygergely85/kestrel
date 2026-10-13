// node engine/core/bootProgress.test.js
import assert from 'node:assert';
import { BOOT_PHASES, createBootProgress, asciiBar } from './bootProgress.js';
const sum = BOOT_PHASES.reduce((a, p) => a + p.weight, 0);
assert.ok(Math.abs(sum - 1) < 1e-9, 'weights sum to 1');
const seen = []; const bp = createBootProgress((s) => seen.push([s.value, s.label]));
assert.strictEqual(bp.state.value, 0);
for (const p of BOOT_PHASES) {
  bp.phase(p.id);
  if (p.counted) for (let i = 0; i <= 25; i += 5) bp.count(p.id, i, 25);
}
const vals = seen.map((x) => x[0]);
for (let i = 1; i < vals.length; i++) assert.ok(vals[i] >= vals[i - 1], 'monotonic');
assert.ok(bp.state.value >= 0.75 - 1e-9, 'land phase reached (starts at 75 %)');
assert.ok(seen.some((x) => Math.abs(x[0] - 0.6) < 1e-9 && x[1] === 'Loading props'), 'props start at 60 %');
assert.ok(seen.some((x) => x[1] === 'Compiling shaders 10/25'), 'counted label');
bp.phase('content'); assert.ok(bp.state.value > 0.55, 'out-of-order phase never moves the bar back');
bp.phase('nope');
{const b2 = createBootProgress(); b2.fraction('land', 0.5); assert.ok(Math.abs(b2.state.value - 0.875) < 1e-9 && b2.state.label === 'Shaping the land', 'OB-109 land 50 % = 87.5 %'); }
bp.finish(); assert.strictEqual(bp.state.value, 1); assert.strictEqual(bp.state.done, true);
bp.phase('engine'); assert.strictEqual(bp.state.value, 1, 'ends at 1 and stays');
assert.strictEqual(asciiBar(0, 10), '[░░░░░░░░░░]   0%');
assert.strictEqual(asciiBar(0.5, 10), '[█████░░░░░]  50%');
assert.strictEqual(asciiBar(1, 10), '[██████████] 100%');
console.log('bootProgress.test.js: all checks passed.');
