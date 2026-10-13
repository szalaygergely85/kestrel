// jawSync.test.js (NPC-TALK-ANIM-01): exact open/half/closed sequence, smoothing bounds, 0 alloc. Fake runner + entity.
import assert from 'node:assert/strict';
import { createJawSync, jawLevel, jawMaxOf, JAW_OPEN_DEG_DEFAULT } from './jawSync.js';

const LINE = 'Well. A cub from the loud hill, fallen out of the sky.';
const NAMES = ['closed', 'half', 'open'];
const seq = [...LINE].map((ch) => NAMES[jawLevel(ch.charCodeAt(0))]);
// W e l l . sp A sp c u b
assert.deepEqual(seq.slice(0, 11), ['half', 'open', 'half', 'half', 'closed', 'closed', 'open', 'closed', 'half', 'open', 'half']);
assert.equal(seq.filter((s) => s === 'open').length, [...LINE.toLowerCase()].filter((c) => 'aeiou'.includes(c)).length);
assert.equal(jawLevel(0x55), 2); assert.equal(jawLevel(0x35), 1); assert.equal(jawLevel(0x40), 0); // 'U','5','@'
assert.equal(jawLevel(0x7b), 0); assert.equal(jawLevel(0x60), 0); // '{' and '`' must not alias to letters
assert.equal(jawMaxOf({}), JAW_OPEN_DEG_DEFAULT); assert.equal(jawMaxOf({ jawOpenDeg: 25 }), 25);

const DT = 1 / 60;
const runner = { state: 'typing', isPlayer: false, line: LINE, visibleChars: 0 };
const comp = {};
const j = createJawSync({ maxDeg: 18 });

// targets per typed char
const got = [];
for (let n = 1; n <= LINE.length; n++) { runner.visibleChars = n; j.step(DT, runner, comp); got.push(j.target); }
assert.deepEqual(got.map((t) => NAMES[t === 18 ? 2 : t === 9 ? 1 : 0]), seq);
assert.equal(comp.partRot.part, 'jaw');

// smoothing: held open, no single-step snap, reaches max region, never exceeds it
const j2 = createJawSync({ maxDeg: 18 }); const c2 = {};
runner.visibleChars = 2; // 'e' -> open
let prev = 0, maxStep = 0;
for (let i = 0; i < 30; i++) {
  const a = j2.step(DT, runner, c2);
  assert.ok(a >= 0 && a <= 18);
  maxStep = Math.max(maxStep, a - prev); prev = a;
  if (i === 0) assert.ok(a < 18 * 0.5);
}
assert.ok(prev > 17.5 && maxStep < 18 * 0.5);
// closes within 0.15 s when the line completes / is skipped, and for listen / YOU lines
for (const mut of [{ state: 'waiting' }, { state: 'listen' }, { isPlayer: true }]) {
  const j3 = createJawSync({ maxDeg: 18 }); const c3 = {}; const r = { ...runner, visibleChars: 2 };
  for (let i = 0; i < 30; i++) j3.step(DT, r, c3);
  Object.assign(r, mut);
  for (let i = 0; i < 9; i++) j3.step(DT, r, c3); // 0.15 s
  assert.ok(j3.angle < 0.5, 'closed ' + j3.angle);
  for (let i = 0; i < 60; i++) j3.step(DT, r, c3);
  assert.equal(c3.partRot.rx, 0);
}
j2.step(DT, null, c2); assert.ok(j2.angle < 18); // null runner closes too

// determinism; partRot never replaced
const run = () => {
  const jj = createJawSync({ maxDeg: 18 }), cc = {}, rr = { state: 'typing', isPlayer: false, line: LINE, visibleChars: 0 };
  const first = []; let ref = null;
  for (let i = 0; i < 10000; i++) {
    rr.visibleChars = ((i >> 1) % LINE.length) + 1; jj.step(DT, rr, cc);
    if (!ref) ref = cc.partRot; else assert.equal(cc.partRot, ref);
    if (i < 50) first.push(cc.partRot.rx);
  }
  return first;
};
assert.deepEqual(run(), run());

// 0 heap growth over 10k steps
globalThis.gc && globalThis.gc();
const jh = createJawSync({ maxDeg: 18 }), ch = {}, rh = { state: 'typing', isPlayer: false, line: LINE, visibleChars: 1 };
for (let i = 0; i < 200; i++) jh.step(DT, rh, ch);
const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 10000; i++) { rh.visibleChars = (i % LINE.length) + 1; jh.step(DT, rh, ch); }
assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'heap growth');
console.log('jawSync.test.js OK');
