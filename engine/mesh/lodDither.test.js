// engine/mesh/lodDither.test.js (S8-B2-07): LOD screen-door crossfade - complementary coverage, compactGroup twin, WGSL probes.
// Run: node engine/mesh/lodDither.test.js
import assert from 'node:assert/strict';
import { lodBandFrac, lodDitherBits, ditherHash, ditherKeep, LDT_ACTIVE, LDT_INVERT } from './lodDither.js';
import { compactGroup, INSTANCE_STRIDE } from './instances.js';
import { RASTER_INSTANCED_WGSL, RASTER_WGSL, LOD_DITHER_WGSL } from '../render/gpu/wgsl/raster.wgsl.js';
import { CULL_WGSL } from '../render/gpu/wgsl/cull.wgsl.js';
import { compileFn, fnBody } from '../render/gpu/wgsl/wgslProbe.js';

const dOf = (bits) => (bits >>> 16) & 0x7ff;
// 1. complementary: every cell is kept by exactly one of the two copies, for any fraction
for (const f of [0, 0.01, 0.25, 0.5, 0.77, 0.999, 1]) {
  const d0 = dOf(lodDitherBits(f, 0)), d1 = dOf(lodDitherBits(f, 1));
  let kept0 = 0, N = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = ditherKeep(d0, x, y), b = ditherKeep(d1, x, y);
    assert.notEqual(a, b, `hole or overlap at ${x},${y} f=${f}`);
    if (a) kept0++; N++;
  }
  assert.ok(Math.abs(kept0 / N - f) < 0.04, `coverage ${kept0 / N} vs ${f}`);
  if (f === 0) assert.equal(kept0, 0, 'band edge lodLo: LOD0 gone, LOD1 full');
  if (f === 1) assert.equal(kept0, N, 'band edge lodHi: LOD0 full');
}
assert.equal(ditherKeep(0, 3, 4), true, 'not dithered = kept');
assert.equal(lodBandFrac(90, 90, 110), 0); assert.equal(lodBandFrac(110, 90, 110), 1); assert.equal(lodBandFrac(100, 90, 110), 0.5);
assert.equal(ditherHash(5, 9), ditherHash(5, 9), 'deterministic');
// monotone: raising f only adds LOD0 cells (no popping back and forth)
{ let prev = null; for (let c = 0; c <= 256; c += 8) { const d = (0x400 | c); const cur = []; for (let i = 0; i < 400; i++) cur.push(ditherKeep(d, i % 20, (i / 20) | 0)); if (prev) for (let i = 0; i < 400; i++) assert.ok(!prev[i] || cur[i], 'monotone'); prev = cur; } }

// 2. compactGroup twin: off = unchanged rows, on = band instances in both lists with complementary bits
function fakeGroup(n, dither) {
  const buf = new ArrayBuffer(n * 64); const f32 = new Float32Array(buf), u32 = new Uint32Array(buf);
  const dbuf = () => { const b = new ArrayBuffer(n * 64); return { u32: new Uint32Array(b), f32: new Float32Array(b) }; };
  return { count: n, ib: { f32, u32 }, drawIb: [dbuf(), dbuf()], drawCount: new Uint32Array(2), lodPrev: new Uint8Array(n), lodCells: 100, lodDither: dither };
}
const vp = new Float64Array(16); vp[5] = 1; vp[7] = 1; // cw = ty, ySc = 1
const ys = [50, 100 / 112, 100 / 105, 100 / 100, 100 / 95, 100 / 91, 100 / 88, 1.0e-3 + 400]; // cells = 100 / ty: far (<lo), band x5, near (>hi), far
function fill(g) { ys.forEach((y, i) => { g.ib.f32[i * 16 + 7] = y; g.ib.u32[i * 16 + 12] = 0xA000 | i; g.ib.u32[i * 16 + 13] = 1 | (3 << 8); }); }
const off = fakeGroup(ys.length, false); fill(off); compactGroup(off, null, 1, vp, 100);
const on = fakeGroup(ys.length, true); fill(on); compactGroup(on, null, 1, vp, 100);
const offBand = [...off.drawIb[0].u32.slice(0, off.drawCount[0] * 16), ...off.drawIb[1].u32.slice(0, off.drawCount[1] * 16)];
assert.ok(offBand.every((_, i) => (i % 16 !== 13) || (offBand[i] >>> 16) === 0), 'dither off: no dither bits');
const bandIdx = [1, 2, 3, 4, 5]; // cells 112?? 
let nBand = 0;
for (let i = 0; i < ys.length; i++) {
  const cells = 100 / ys[i];
  const inBand = cells >= 90 && cells <= 110;
  const find = (g, l) => { for (let k = 0; k < g.drawCount[l]; k++) if (g.drawIb[l].u32[k * 16 + 12] === (0xA000 | i)) return g.drawIb[l].u32[k * 16 + 13]; return -1; };
  const w0 = find(on, 0), w1 = find(on, 1), o0 = find(off, 0), o1 = find(off, 1);
  if (inBand) {
    nBand++;
    assert.ok(w0 >= 0 && w1 >= 0, `band instance ${i} drawn in both lists`);
    assert.ok((w0 & LDT_ACTIVE) && !(w0 & LDT_INVERT) && (w1 & LDT_ACTIVE) && (w1 & LDT_INVERT), 'bits');
    assert.equal(((w0 | w1) & 0xffff), (1 | (3 << 8)), 'flags low 16 bits (aligned, team) preserved');
    assert.equal((w0 >>> 16) & 0x1ff, (w1 >>> 16) & 0x1ff, 'same coverage word');
  } else {
    assert.equal(w0 >= 0 ? w0 : w1, o0 >= 0 ? o0 : o1, 'outside the band identical to dither off');
    assert.equal(w0 >= 0 ? 1 : 0, o0 >= 0 ? 1 : 0, 'same list');
  }
}
assert.ok(nBand >= 3, `fixture has band instances (${nBand})`);

// 3. WGSL: raster hash vs oracle (u32 wrap emulated), keep rule, cull helpers vs twin; instanced only
{
  // the hash text must be exactly the four u32 statements ditherHash() implements (u32 multiply wraps in WGSL, Math.imul in JS)
  for (const line of ['var h = (x * 0x45d9f3bu) ^ (y * 0x27d4eb2du);', 'h = h ^ (h >> 15u);', 'h = h * 0x2c1b3c6du;', 'h = h ^ (h >> 12u);', 'return h;']) assert.ok(LOD_DITHER_WGSL.includes(line), line);
  const keep = compileFn(LOD_DITHER_WGSL, 'ditherKeep', { ditherHash: (x, y) => ditherHash(x, y) });
  for (let i = 0; i < 2000; i++) { const d = ((i * 37) % 0x800), x = i % 97, y = (i * 3) % 89; assert.equal(keep(d, x, y), ditherKeep(d, x, y)); }
  assert.ok(RASTER_INSTANCED_WGSL.includes('ditherKeep(v.packed.w >> 1u') && !RASTER_WGSL.includes('ditherKeep'));
  assert.ok(!/%|\bround\s*\(|\bmod\s*\(|fract/.test(LOD_DITHER_WGSL));
  const u = { lodOn: 1, lodDither: 1, params: { x: 1, y: 100 * 100, z: 90, w: 110 } };
  const bandFrac = compileFn(CULL_WGSL, 'bandFrac', { u }), bits = compileFn(CULL_WGSL, 'ditherBits', {});
  for (let cw = 80; cw <= 130; cw += 0.37) {
    const cells = 100 * 100 / cw, exp = cells < 90 || cells > 110 ? -1 : lodBandFrac(cells, 90, 110);
    assert.ok(Math.abs(bandFrac(cw) - exp) < 1e-12, `bandFrac ${cw}`);
    if (exp >= 0) for (const l of [0, 1]) assert.equal(bits(exp, l) >>> 0, lodDitherBits(exp, l));
  }
  u.lodDither = 0; assert.equal(bandFrac(100), -1, 'dither off -> -1'); u.lodDither = 1; u.lodOn = 0; assert.equal(bandFrac(100), -1); assert.equal(bandFrac(-1), -1);
  assert.ok(CULL_WGSL.includes('dst0[wa + 13u] = src[o + 13u] | ditherBits(bf, 0u)'));
}
console.log('lodDither: ok');
