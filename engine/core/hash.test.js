// engine/core/hash.test.js (RE-14, docs/architecture.md 28.5).
// Run: node engine/core/hash.test.js
import { createHasher } from './hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function bytesOf(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i);
  return b;
}

// ---- standard FNV-1a 32-bit test vectors ---------------------------------
// (offset basis 0x811c9dc5, prime 0x01000193; "" -> 0x811c9dc5, "a" -> 0xe40c292c)
{
  const h = createHasher();
  h.u8Array(bytesOf(''), 0, 0);
  ok('FNV-1a 32 of "" == 0x811c9dc5', h.value() === 0x811c9dc5, h.value().toString(16));
}
{
  const h = createHasher();
  h.u8Array(bytesOf('a'));
  ok('FNV-1a 32 of "a" == 0xe40c292c', h.value() === 0xe40c292c, h.value().toString(16));
}
{
  const h = createHasher();
  h.u8Array(bytesOf('foobar'));
  ok('FNV-1a 32 of "foobar" == 0xbf9cf968', h.value() === 0xbf9cf968, h.value().toString(16));
}

// ---- reset ----------------------------------------------------------------
{
  const h = createHasher();
  h.u8Array(bytesOf('a'));
  h.reset();
  h.u8Array(bytesOf(''));
  ok('reset returns to the offset basis', h.value() === 0x811c9dc5, h.value().toString(16));
}

// ---- u32/i32 round-trip agreement ------------------------------------------
{
  const h1 = createHasher().u32(0xffffffff);
  const h2 = createHasher().i32(-1);
  ok('u32(0xffffffff) === i32(-1) (same bit pattern)', h1.value() === h2.value());
}

// ---- f64(-0) !== f64(0) -----------------------------------------------------
{
  const hPos = createHasher(); hPos.f64(0);
  const hNeg = createHasher(); hNeg.f64(-0);
  ok('f64(-0) !== f64(0)', hPos.value() !== hNeg.value(), `${hPos.value()} vs ${hNeg.value()}`);
}

// ---- f64 is deterministic --------------------------------------------------
{
  const a = createHasher().f64(3.14159).value();
  const b = createHasher().f64(3.14159).value();
  ok('f64 deterministic for the same double', a === b);
}

// ---- u32Array matches manual u32 sequence ----------------------------------
{
  const arr = new Int32Array([1, -2, 3, 0x7fffffff]);
  const a = createHasher().u32Array(arr).value();
  const h2 = createHasher();
  for (const v of arr) h2.u32(v);
  ok('u32Array matches manual per-element u32 calls', a === h2.value());
}

// ---- value() is a u32 -------------------------------------------------------
{
  const h = createHasher();
  h.u32(0xdeadbeef);
  h.u32(0xcafebabe);
  const v = h.value();
  ok('value() returns a u32 (>>> 0 stable)', v === (v >>> 0));
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
