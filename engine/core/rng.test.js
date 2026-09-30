// engine/core/rng.test.js (RE-14, docs/architecture.md 28.5).
// Run: node engine/core/rng.test.js
import { createRng } from './rng.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- golden first-8 outputs, frozen from this implementation ------------
// (docs/architecture.md 28.5: "recorded once, then frozen" - these numbers
// were produced by running createRng(seed).nextU32() 8 times and are not
// derived from any external reference implementation; they exist purely to
// catch a future accidental change to this file's algorithm.)
const GOLDEN_SEED_1 = [
  393288148, 2174103013, 3814759091, 2092745082,
  1865176206, 2179171167, 3207394750, 2858353069,
];
const GOLDEN_SEED_DEADBEEF = [
  3842467093, 879304004, 3694663928, 2788030634,
  934155191, 702880729, 3422146658, 169081873,
];

function first8(seed) {
  const rng = createRng(seed);
  const out = [];
  for (let i = 0; i < 8; i++) out.push(rng.nextU32());
  return out;
}

{
  const got = first8(1);
  ok('golden seed=1 first 8 outputs', JSON.stringify(got) === JSON.stringify(GOLDEN_SEED_1), JSON.stringify(got));
}
{
  const got = first8(0xDEADBEEF);
  ok('golden seed=0xDEADBEEF first 8 outputs', JSON.stringify(got) === JSON.stringify(GOLDEN_SEED_DEADBEEF), JSON.stringify(got));
}

// ---- save/load mid-stream continues identically --------------------------
{
  const a = createRng(42);
  for (let i = 0; i < 5; i++) a.nextU32();
  const saved = a.save();
  const fromA = [];
  for (let i = 0; i < 10; i++) fromA.push(a.nextU32());

  const b = createRng(999); // different seed, will be overwritten by load
  b.load(saved);
  const fromB = [];
  for (let i = 0; i < 10; i++) fromB.push(b.nextU32());

  ok('save/load mid-stream continues identically', JSON.stringify(fromA) === JSON.stringify(fromB), `${fromA} vs ${fromB}`);
}

// ---- nextFloat is exact in [0,1) -----------------------------------------
{
  const rng = createRng(7);
  let allInRange = true;
  for (let i = 0; i < 1000; i++) {
    const f = rng.nextFloat();
    if (!(f >= 0 && f < 1)) allInRange = false;
  }
  ok('nextFloat stays in [0,1) over 1000 draws', allInRange);
}

// ---- int() bounds ----------------------------------------------------------
{
  const rng = createRng(3);
  let threw = false;
  try { rng.int(16777217); } catch (e) { threw = true; }
  ok('int() throws above 2^24', threw);

  const rng2 = createRng(3);
  let threwAtLimit = false;
  try { rng2.int(16777216); } catch (e) { threwAtLimit = true; }
  ok('int() does not throw at exactly 2^24', !threwAtLimit);

  const rng3 = createRng(5);
  let inRange = true;
  for (let i = 0; i < 2000; i++) {
    const v = rng3.int(10);
    if (!(v >= 0 && v < 10 && Number.isInteger(v))) inRange = false;
  }
  ok('int(n) returns integers in [0,n)', inRange);
}

// ---- hashInto is deterministic and state-dependent -----------------------
{
  const rng1 = createRng(123);
  const rng2 = createRng(123);
  rng1.nextU32();
  rng2.nextU32();
  let h1 = 0x811c9dc5 | 0, h2 = 0x811c9dc5 | 0;
  const fakeH1 = { u32(x) { h1 = (h1 ^ (x >>> 0)) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0; } };
  const fakeH2 = { u32(x) { h2 = (h2 ^ (x >>> 0)) >>> 0; h2 = Math.imul(h2, 0x01000193) >>> 0; } };
  rng1.hashInto(fakeH1);
  rng2.hashInto(fakeH2);
  ok('hashInto is deterministic for identical state', h1 === h2, `${h1} vs ${h2}`);

  rng1.nextU32();
  let h3 = 0x811c9dc5 | 0;
  const fakeH3 = { u32(x) { h3 = (h3 ^ (x >>> 0)) >>> 0; h3 = Math.imul(h3, 0x01000193) >>> 0; } };
  rng1.hashInto(fakeH3);
  ok('hashInto differs after state changes', h3 !== h1, `${h3} vs ${h1}`);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
