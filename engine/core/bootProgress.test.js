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
assert.ok(bp.state.value < 1 && bp.state.value > 0.85, 'last phase starts below 1');
assert.ok(seen.some((x) => x[1] === 'Compiling shaders 10/25'), 'counted label');
bp.phase('content'); assert.ok(bp.state.value > 0.85, 'out-of-order phase never moves the bar back');
bp.phase('nope');
bp.finish(); assert.strictEqual(bp.state.value, 1); assert.strictEqual(bp.state.done, true);
bp.phase('engine'); assert.strictEqual(bp.state.value, 1, 'ends at 1 and stays');
assert.strictEqual(asciiBar(0, 10), '[░░░░░░░░░░]   0%');
assert.strictEqual(asciiBar(0.5, 10), '[█████░░░░░]  50%');
assert.strictEqual(asciiBar(1, 10), '[██████████] 100%');
console.log('bootProgress.test.js: all checks passed.');
