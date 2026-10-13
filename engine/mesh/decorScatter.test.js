// ENV-01a: decorScatter twin ACs (determinism, frequencies, boundaries, carpet, jitter, 0 alloc).
import assert from 'node:assert/strict';
import {
  packDecorLayers, decorCell, decorFrame, makeDecorLists, decorHash, jitterCm, decorSide,
  DECOR_OUT_WORDS, O_SPECIES, O_XCM, O_JQX, O_JQY, O_YAWQ, O_SCALEQ, MASK_CARPET_BIT, FADE_Q8_MIN, FADE_Q8_SPAN, K_FADE, LIST_STRIDE,
} from './decorScatter.js';

const sp = (weight, extra) => Object.assign({ weight, lodM: 30, maxDistM: 90, scaleMin: 0.8, scaleMax: 1.2 }, extra);
const cfg = () => ({ layers: [
  { seed: 7, cellM: 1.5, jitterM: 0.6, drawM: 40, species: [sp(5), sp(3, { grassLike: true }), sp(2)] },
  { seed: 99, cellM: 3.5, jitterM: 1.2, drawM: 60, densityQ8: 128, species: [sp(1), sp(1)] },
]});
const packed = packDecorLayers(cfg());
const out = new Int32Array(DECOR_OUT_WORDS);
const fade = new Int32Array([4000, 4000, 4000]);

// 1. two runs identical (frame hash over several eyes)
function runHash() {
  let h = 0;
  const buf = makeDecorLists(packed, 0), side = decorSide(packed, 0);
  const mask = new Uint8Array(side * side).fill(100 | MASK_CARPET_BIT * 0);
  for (let e = 0; e < 12; e++) {
    decorFrame(packed, 0, mask, -side, -side, side * 2, side * 2, e * 777, -e * 531, fade, 0, buf, out);
    for (let i = 0; i < buf.counts.length; i++) h = Math.imul(h ^ buf.counts[i], 16777619);
    for (let i = 0; i < buf.lists.length; i++) h = Math.imul(h ^ buf.lists[i], 16777619);
  }
  return h >>> 0;
}
assert.equal(runHash(), runHash(), 'two runs identical');

// 2. species frequencies within 3 % of the weights over 100k cells; jq range
{
  const wide = packDecorLayers({ layers: [{ seed: 7, cellM: 1.5, jitterM: 0.6, drawM: 460, species: [sp(5, { maxDistM: 460 }), sp(3, { maxDistM: 460 }), sp(2, { maxDistM: 460 })] }] });
  const big = new Int32Array([46000, 46000, 46000]);
  const cnt = [0, 0, 0]; let n = 0, jMin = 1e9, jMax = -1e9;
  for (let i = 0; i < 100000; i++) {
    const ix = (i % 400) - 200, iy = ((i / 400) | 0) - 125;
    const r = decorCell(wide, 0, ix, iy, 127, 0, 0, big, 0, out);
    if (!r) continue;
    cnt[out[O_SPECIES]]++; n++;
    jMin = Math.min(jMin, out[O_JQX], out[O_JQY]); jMax = Math.max(jMax, out[O_JQX], out[O_JQY]);
    assert.ok(out[O_JQX] >= -60 && out[O_JQX] <= 60 && out[O_JQY] >= -60 && out[O_JQY] <= 60, 'jq in [-jit, jit]');
    assert.equal(out[O_XCM], ix * 150 + out[O_JQX]);
  }
  assert.ok(n > 90000, 'prob 127 keeps ~all (fade at 460 m not hit): ' + n);
  [0.5, 0.3, 0.2].forEach((p, i) => assert.ok(Math.abs(cnt[i] / n - p) < 0.03, 'species ' + i + ' freq ' + cnt[i] / n));
  assert.ok(jMin <= -55 && jMax >= 55, 'jitter spans the range: ' + jMin + '..' + jMax);
  // keep probability scales: mask 32 of 127 ~ 25 %
  let kept = 0;
  for (let i = 0; i < 20000; i++) if (decorCell(wide, 0, i % 200, (i / 200) | 0, 32, 0, 0, big, 0, out)) kept++;
  assert.ok(Math.abs(kept / 20000 - 32 / 127) < 0.02, 'keep prob ' + kept / 20000);
  assert.equal(decorCell(wide, 0, 3, 3, 0, 0, 0, big, 0, out), 0, 'prob 0 never');
}

// 3. distance / LOD / fade at the exact boundary cm (jitter 0 so xcm = ix * cell)
{
  const p = packDecorLayers({ layers: [{ seed: 1, cellM: 1, jitterM: 0, drawM: 5, species: [{ weight: 1, lodM: 3, maxDistM: 4, scaleMin: 1, scaleMax: 1 }] }] });
  const hi = new Int32Array([100000]);
  const at = (ix, ex = 0) => decorCell(p, 0, ix, 0, 127, ex, 0, hi, 0, out);
  assert.equal(at(2), 1, 'inside LOD0');
  assert.equal(at(3), 2, 'd == lodCm -> LOD1');
  assert.equal(at(3, 1), 1, 'one cm closer than lodCm -> LOD0');
  assert.equal(at(3, -1), 2);
  assert.equal(at(4), 0, 'd == maxCm dropped');
  assert.equal(at(4, 1), 2, 'maxCm - 1 kept');
  assert.equal(at(-4, 0), 0); assert.equal(at(-4, -1), 2);
  assert.equal(at(5), 0, 'd == drawCm dropped');
  // fade: exact per-placement distance
  const ix = 3, h = decorHash(ix, 0, 1, K_FADE) >>> 24, fq = FADE_Q8_MIN + (h * FADE_Q8_SPAN >>> 8);
  assert.ok(fq >= 205 && fq <= 255);
}
{
  const p = packDecorLayers({ layers: [{ seed: 1, cellM: 1, jitterM: 0, drawM: 50, species: [{ weight: 1, lodM: 40, maxDistM: 50, scaleMin: 1, scaleMax: 1 }] }] });
  const h = decorHash(3, 0, 1, K_FADE) >>> 24, fq = FADE_Q8_MIN + (h * FADE_Q8_SPAN >>> 8);
  const fc = new Int32Array([1500]), lim = (1500 * fq) >>> 8;
  assert.ok(lim >= 1200 && lim <= 1500);
  assert.equal(decorCell(p, 0, 3, 0, 127, 300 - lim, 0, fc, 0, out), 0, 'd == fadeLim -> faded');
  assert.equal(decorCell(p, 0, 3, 0, 127, 300 - lim + 1, 0, fc, 0, out), 1, 'd == fadeLim - 1 -> drawn');
  // walking away crosses the fade exactly once
  let flips = 0, prev = 1;
  for (let e = 0; e >= -3000; e--) { const r = decorCell(p, 0, 3, 0, 127, e, 0, fc, 0, out) ? 1 : 0; if (r !== prev) flips++; prev = r; }
  assert.equal(flips, 1, 'single fade crossing');
}

// 4. carpet hand-off
{
  const p = packDecorLayers({ layers: [{ seed: 3, cellM: 1, jitterM: 0, drawM: 20, species: [
    { weight: 1, lodM: 40, maxDistM: 20, grassLike: true, scaleMin: 1, scaleMax: 1 },
  ] }, { seed: 3, cellM: 1, jitterM: 0, drawM: 20, species: [{ weight: 1, lodM: 40, maxDistM: 20, scaleMin: 1, scaleMax: 1 }] }] });
  const hi = new Int32Array([100000]), cut = 300, m = 127 | MASK_CARPET_BIT;
  assert.equal(decorCell(p, 0, 2, 0, m, 0, 0, hi, cut, out), 0, 'grass on carpet inside cut: dropped');
  assert.equal(decorCell(p, 0, 3, 0, m, 0, 0, hi, cut, out), 1, 'd == cut -> draws (hand-off ring)');
  assert.equal(decorCell(p, 0, 3, 0, m, 1, 0, hi, cut, out), 0, 'cut - 1 cm -> dropped');
  assert.equal(decorCell(p, 0, 2, 0, 127, 0, 0, hi, cut, out), 1, 'no carpet bit: draws');
  assert.equal(decorCell(p, 1, 2, 0, m, 0, 0, hi, cut, out), 1, 'non-grass species may sit on carpet');
  assert.equal(decorCell(p, 0, 2, 0, m, 0, 0, hi, 0, out), 1, 'carpet off (cut 0): draws');
}

// 5. hash helpers
{
  for (let i = 0; i < 20000; i++) { const j = jitterCm(decorHash(i, -i, 5, 1), 37); assert.ok(j >= -37 && j <= 37); }
  assert.equal(decorHash(1, 2, 3, 4), decorHash(1, 2, 3, 4));
  assert.notEqual(decorHash(1, 2, 3, 4), decorHash(1, 2, 3, 5));
  assert.throws(() => packDecorLayers({ layers: [{ seed: 1, cellM: 1, drawM: 500, species: [sp(1)] }] }), /drawM/);
  // frame == per-cell brute force
  const buf = makeDecorLists(packed, 1), side = decorSide(packed, 1), mask = new Uint8Array(40 * 40);
  for (let i = 0; i < mask.length; i++) mask[i] = (i * 37) & 127 | ((i & 3) === 0 ? MASK_CARPET_BIT : 0);
  const total = decorFrame(packed, 1, mask, -20, -20, 40, 40, 123, 456, fade, 0, buf, out);
  let ref = 0;
  const cx = Math.floor(123 / 350), cy = Math.floor(456 / 350);
  for (let iy = cy - (side - 1) / 2; iy <= cy + (side - 1) / 2; iy++) for (let ix = cx - (side - 1) / 2; ix <= cx + (side - 1) / 2; ix++) {
    if (ix < -20 || ix >= 20 || iy < -20 || iy >= 20) continue;
    if (decorCell(packed, 1, ix, iy, mask[(iy + 20) * 40 + ix + 20], 123, 456, fade, 0, out)) ref++;
  }
  assert.equal(total, ref); assert.ok(total > 0);
  assert.equal(buf.counts.reduce((a, b) => a + b, 0), total);
  assert.ok(LIST_STRIDE === 6 && O_YAWQ !== O_SCALEQ);
}

// 6. 0 alloc (needs --expose-gc; recipe 38.61: warm-up, gc, min of 5 windows)
if (typeof gc !== 'function') console.log('decorScatter alloc probe SKIP (no --expose-gc)');
else {
  const buf = makeDecorLists(packed, 0), side = decorSide(packed, 0), mask = new Uint8Array(side * side).fill(90);
  const call = (i) => decorFrame(packed, 0, mask, -side, -side, side * 2, side * 2, i * 13, i * 7, fade, 300, buf, out);
  for (let i = 0; i < 3000; i++) call(i);
  let best = Infinity, base = Infinity; // base = cost of the two memoryUsage() reads themselves
  for (let w = 0; w < 5; w++) { gc(); gc(); const a = process.memoryUsage().heapUsed; base = Math.min(base, process.memoryUsage().heapUsed - a); }
  for (let w = 0; w < 5; w++) {
    gc(); gc();
    const a = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) call(i);
    const b = process.memoryUsage().heapUsed;
    best = Math.min(best, (b - a - base) / 2000);
  }
  assert.ok(best <= 0, 'decorFrame allocates ' + best + ' B/call');
  console.log('decorScatter alloc: ' + Math.max(0, best) + ' B/frame');
}
console.log('decorScatter OK');
