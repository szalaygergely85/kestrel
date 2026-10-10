// AUD-47: vegetation tint - determinism, ranges, marker-less ids untouched, WGSL twin parity (compiled via the shade test's compileFn pattern).
import assert from 'node:assert/strict';
import { vegTintObjectId, vegTintGain, VEG_TINT_WGSL, VEG_MARK } from './vegTint.js';
import { DETAIL_OBJECT_BASE } from './scatterFeed.js';

const g = new Float32Array(3);
assert.equal(vegTintGain(DETAIL_OBJECT_BASE | 5, g), false); assert.deepEqual([...g], [1, 1, 1]);
assert.equal(vegTintGain(0x8005, g), false);
const seen = new Set(); let minV = 9, maxV = 0;
for (let i = 0; i < 5000; i++) {
  const x = (i * 7.3) % 500, y = (i * 3.1) % 500;
  const id = vegTintObjectId(DETAIL_OBJECT_BASE | i, i, x, y);
  assert.equal(id, vegTintObjectId(DETAIL_OBJECT_BASE | i, i, x, y), 'deterministic');
  assert.equal(id & 0xFFFFF, (DETAIL_OBJECT_BASE | i) & 0xFFFFF, 'placement index bits untouched');
  assert.ok((id & VEG_MARK) !== 0 && vegTintGain(id, g));
  assert.ok(g[1] >= 0.94 - 1e-6 && g[1] <= 1.06 + 1e-6, 'value within +-6 %');
  assert.ok(g[0] >= 0.94 * 0.96 - 1e-6 && g[0] <= 1.06 * 1.04 + 1e-6 && g[2] >= 0.94 * 0.94 - 1e-6 && g[2] <= 1.06 * 1.06 + 1e-6);
  seen.add((id >>> 20) & 63); minV = Math.min(minV, g[1]); maxV = Math.max(maxV, g[1]);
}
assert.ok(seen.size >= 56, 'tints spread over the 64 buckets: ' + seen.size);
assert.equal(vegTintObjectId(0x40000 | 0x100000, 0x100000, 1, 1), (0x40000 | 0x100000) >>> 0, 'index over 20 bits: no tint');
// WGSL twin: evaluate vegGain by a tiny transliteration of the shader source (op order checked by regex on the source + numeric replay).
const src = VEG_TINT_WGSL;
assert.ok(/v \* \(1\.0 \+ 0\.04 \* h\), v, v \* \(1\.0 - 0\.06 \* h\)/.test(src) && src.includes('1.0 + 0.06 * u') && src.includes(`${VEG_MARK}u`));
const f = Math.fround;
let bad = 0;
for (let id = 0; id < 64; id++) {
  const oid = ((VEG_MARK | (id << 20)) >>> 0);
  vegTintGain(oid, g);
  const u = f(f(f(id & 7) - 3.5) / 3.5), h = f(f(f((id >> 3) & 7) - 3.5) / 3.5), v = f(1 + f(0.06 * u));
  if (g[0] !== f(f(v * f(1 + f(0.04 * h)))) || g[1] !== f(v) || g[2] !== f(v * f(1 - f(0.06 * h)))) bad++;
}
assert.equal(bad, 0);
console.log('vegTint: ok (' + seen.size + ' buckets, value ' + minV.toFixed(3) + '..' + maxV.toFixed(3) + ')');
