// WATER-FINISH-01b (38.77): WGSL finish helpers (WATER_FINISH_WGSL, interpolated into waterComposite.wgsl.js) probed against their JS twins
// (waterFinish.js) with compileFn, plus string/layout rules for the composite wiring. node engine/render/gpu/wgsl/waterFinish.wgsl.test.js
import assert from 'node:assert/strict';
import { compileFn, shims } from './wgslProbe.js';
import { HASH_FAST_WGSL } from './common.wgsl.js';
import { WATER_COMPOSITE_WGSL, WATER_COMPOSITE_BLOCK } from './waterComposite.wgsl.js';
import {
  WATER_FINISH_WGSL, WF_SLOTS, WF_STRIDE, shearMirrorRow, pitchedMirrorCol, pitchedMirrorRow, reflAccept, causticHit,
} from '../../waterFinish.js';

// --- layout / wiring ---
const fin = WATER_COMPOSITE_BLOCK.field('fin');
assert.equal(fin.count, WF_SLOTS * (WF_STRIDE / 4), 'fin = 2 vec4 per slot');
assert.equal(fin.offset % 16, 0);
assert.ok(fin.word > WATER_COMPOSITE_BLOCK.field('skyLut').word, 'appended after every existing field (no renumbering)');
assert.ok(WATER_COMPOSITE_WGSL.includes('fn shearMirrorRow') && WATER_COMPOSITE_WGSL.includes('fn causticHit') && WATER_COMPOSITE_WGSL.includes('fn rippleAccAt'), 'finish + ripple fns included');
assert.ok(/fin1\.z > 0\.0/.test(WATER_COMPOSITE_WGSL), 'reflection guarded by the per-slot key (0 = byte-identical)');
assert.ok(/fin0\.x > 0\.0 && column < fin0\.y/.test(WATER_COMPOSITE_WGSL), 'caustic guarded by causticK and column depth');
assert.ok(!/%|\bround\s*\(/.test(WATER_FINISH_WGSL), 'no raw % / round');

// --- formula parity (WGSL text evaluated in JS vs the JS twin) ---
// WGSL u32 multiply is exact; the JS-evaluated twin needs Math.imul for the same low 32 bits (same stand-in as shade.wgsl.test.js).
const hashSrc = (src) => src.replace('u32(x) * 0x27d4eb2du', 'imul(u32(x), 0x27d4eb2du)').replace('u32(y) * 0x165667b1u', 'imul(u32(y), 0x165667b1u)')
  .replace('u32(s) * 0x9e3779b1u', 'imul(u32(s), 0x9e3779b1u)').replace('(h ^ (h >> 15u)) * 0x85ebca6bu', 'imul((h ^ (h >> 15u)), 0x85ebca6bu)')
  .replace('(h ^ (h >> 13u)) * 0xc2b2ae35u', 'imul((h ^ (h >> 13u)), 0xc2b2ae35u)');
const hashFastU = compileFn(hashSrc(HASH_FAST_WGSL), 'hashFastU', { imul: Math.imul });
const W = (n) => compileFn(WATER_FINISH_WGSL, n, { hashFastU });
const wShear = W('shearMirrorRow'), wPCol = W('pitchedMirrorCol'), wPRow = W('pitchedMirrorRow'), wAcc = W('reflAccept'), wHit = W('causticHit');
let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const N = 2400; let nHit = 0, nAcc = 0, mism = 0;
for (let i = 0; i < N; i++) {
  const hr = 20 + rnd() * 60, row = (rnd() * 180) | 0;
  assert.equal(wShear(Math.fround(hr), row), shearMirrorRow(Math.fround(hr), row), 'shear row');
  const dx = (rnd() - 0.5) * 80, dy = (rnd() - 0.5) * 80, dz = rnd() * 4, vd = 1 + rnd() * 60;
  const rX = rnd() - 0.5, rY = rnd() - 0.5, uX = rnd() - 0.5, uY = rnd() - 0.5, uZ = rnd(), tx = 0.5 + rnd(), ty = 0.3 + rnd() * 0.5;
  const cols = 240, rows = 90;
  const a = wPCol(dx, dy, dz, vd, rX, rY, tx, cols), b = pitchedMirrorCol(dx, dy, dz, vd, rX, rY, tx, cols);
  const c = wPRow(dx, dy, dz, vd, uX, uY, uZ, ty, rows), d = pitchedMirrorRow(dx, dy, dz, vd, uX, uY, uZ, ty, rows);
  if (Math.abs(a - b) > 1 || Math.abs(c - d) > 1) mism++; // f32 vs f64 only differ at a .5 tie in WGSL; here both are f64 -> expect equal
  assert.equal(a, b, 'pitched col'); assert.equal(c, d, 'pitched row');
  const rowM = ((rnd() * 100) | 0) - 5, wk = rnd() < 0.5 ? 1 : 0, gk = (rnd() * 3) | 0, dm = rnd() * 100, dW = rnd() * 100;
  const e1 = wAcc(rowM, 90, wk, gk, dm, dW), e2 = reflAccept(rowM, 90, wk, gk, dm, dW);
  assert.equal(e1, e2, 'reflAccept'); if (e2) nAcc++;
  const px = (rnd() - 0.5) * 2000, py = (rnd() - 0.5) * 2000, t = rnd() * 600, k = rnd() * 0.5;
  const h1 = wHit(px, py, t, k), h2 = causticHit(px, py, t, k);
  assert.equal(h1, h2, 'causticHit'); if (h2) nHit++;
}
assert.equal(mism, 0);
assert.ok(nAcc > 100 && nHit > 100, `probe coverage: ${nAcc} accepts, ${nHit} caustic hits`);
// mutation: a wrong sign in the mirror must be caught
const bad = compileFn(WATER_FINISH_WGSL.replace('2.0 * horizonRow - f32(row)', '2.0 * horizonRow + f32(row)'), 'shearMirrorRow', shims);
assert.notEqual(bad(40, 10), shearMirrorRow(40, 10), 'mutation caught');
console.log(`waterFinish.wgsl.test.js: layout/string rules, ${N} x 5 formula probes (${nAcc} accepts, ${nHit} caustic hits), 1 mutation caught. fin = ${fin.words} words`);
