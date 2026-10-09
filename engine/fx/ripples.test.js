// engine/fx/ripples.test.js (S8-B2-13b, docs/architecture.md 38.14): createRipples - add/packInto/clear/cap,
// ring overwrite, lifetime, zero allocation. Run: node --expose-gc engine/fx/ripples.test.js
import { createRipples, RIPPLE_LIFE, RIPPLE_SPEED, RIPPLE_W } from './ripples.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

ok('constants match 38.14', RIPPLE_LIFE === 2.0 && RIPPLE_SPEED === 1.2 && RIPPLE_W === 0.35);

{
  const r = createRipples();
  ok('createRipples() defaults cap to 8', r.cap === 8);
  ok('cap 0 or non-integer throws', (() => { try { createRipples({ cap: 0 }); return false; } catch { return true; } })());
}

// ---- no add -> 0 ----
{
  const r = createRipples({ cap: 8 });
  const out = new Float32Array(8 * 4);
  ok('no add -> packInto returns 0', r.packInto(0, out) === 0);
}

// ---- 9 adds into cap 8 -> oldest dropped ----
{
  const r = createRipples({ cap: 8 });
  for (let i = 0; i < 9; i++) ok(`add ${i} returns true`, r.add(i, i, 0.5, 0) === true);
  const out = new Float32Array(8 * 4);
  const n = r.packInto(0.01, out);
  ok('9 adds into cap 8: 8 live rings (the oldest, slot 0 = x0, was overwritten by the 9th)', n === 8);
  let sawX0 = false, sawX8 = false;
  for (let i = 0; i < n; i++) { if (out[i * 4] === 0) sawX0 = true; if (out[i * 4] === 8) sawX8 = true; }
  ok('oldest ring (x=0) is gone, the overwrite (x=8) is present', !sawX0 && sawX8);
}

// ---- age >= RIPPLE_LIFE dropped ----
{
  const r = createRipples({ cap: 4 });
  r.add(1, 2, 1, 10);
  const out = new Float32Array(4 * 4);
  ok('age just under RIPPLE_LIFE is live', r.packInto(10 + RIPPLE_LIFE - 0.001, out) === 1);
  ok('age == RIPPLE_LIFE is dropped', r.packInto(10 + RIPPLE_LIFE, out) === 0);
  ok('age > RIPPLE_LIFE is dropped', r.packInto(10 + RIPPLE_LIFE + 1, out) === 0);
  ok('negative age (clock went backwards) is dropped, not treated as live', r.packInto(9, out) === 0);
  const n = r.packInto(10.5, out);
  ok('packed age is timeSec - t0 (f64)', n === 1 && Math.abs(out[2] - 0.5) < 1e-6);
}

// ---- non-finite input refused ----
{
  const r = createRipples({ cap: 4 });
  ok('non-finite input is refused and writes nothing', r.add(NaN, 0, 1, 0) === false && r.add(0, Infinity, 1, 0) === false && r.add(0, 0, NaN, 0) === false && r.add(0, 0, 1, NaN) === false);
  const out = new Float32Array(4 * 4);
  ok('nothing was added', r.packInto(1000, out) === 0);
}

// ---- amp clamp ----
{
  const r = createRipples({ cap: 4 });
  r.add(1, 1, 5, 0); r.add(2, 2, -5, 0);
  const out = new Float32Array(4 * 4);
  const n = r.packInto(0, out);
  ok('amp is clamped to [0,1]', n === 2 && out[3] === 1 && out[7] === 0);
}

// ---- clear ----
{
  const r = createRipples({ cap: 4 });
  r.add(1, 1, 1, 0);
  r.clear();
  const out = new Float32Array(4 * 4);
  ok('clear() drops every live ring', r.packInto(0, out) === 0);
  ok('clear() resets the write head (next add lands in slot 0 again)', r.add(9, 9, 1, 0) === true && r.packInto(0.01, out) === 1 && out[0] === 9);
}

// ---- zero allocation over 10k add/pack ----
{
  const r = createRipples({ cap: 8 });
  const out = new Float32Array(8 * 4);
  const run = (n) => { for (let i = 0; i < n; i++) { r.add(i % 10, i % 7, 0.5, i * 0.001); r.packInto(i * 0.001 + 0.01, out); } };
  run(2000); // JIT warm-up
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    const m0 = process.memoryUsage().heapUsed;
    run(10000);
    globalThis.gc();
    const grown = process.memoryUsage().heapUsed - m0;
    ok('zero allocation: 10k add/pack grow the heap < 64 KB', grown < 65536, `${grown} B`);
  } else {
    run(10000);
    console.log('(skipped heap check: run with --expose-gc)');
  }
}

console.log(`ripples.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
