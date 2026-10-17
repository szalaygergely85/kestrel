// OB-197: the bevel shade of a stone block must not depend on which cells the footprint happens to hit.
import assert from 'node:assert/strict';
import { bevelShadeK } from './detailShade.js';

const gv = 0.25, top = 0.03, tS = 1.15, bot = 0.03, bS = 0.78;
const mean = 1 + (top * (tS - 1) + bot * (bS - 1)) / gv;

// near (footprint -> 0): the old step function away from the band edges
assert.equal(bevelShadeK(0.01, 0.001, gv, top, tS, bot, bS), bS);
assert.equal(bevelShadeK(0.24, 0.001, gv, top, tS, bot, bS), tS);
assert.equal(bevelShadeK(0.12, 0.001, gv, top, tS, bot, bS), 1);

// far: the average over cells laid across a block is the same at every footprint (the point-sample version swings 0.78..1.15)
for (const cov of [0.02, 0.05, 0.1, 0.25, 0.5, 2]) {
  const n = 5000; let sum = 0, lo = 9, hi = 0;
  for (let i = 0; i < n; i++) {
    const k = bevelShadeK((i + 0.5) / n * gv, cov, gv, top, tS, bot, bS);
    sum += k; lo = Math.min(lo, k); hi = Math.max(hi, k);
  }
  assert.ok(Math.abs(sum / n - mean) < 0.006, `cov ${cov}: mean ${sum / n} vs ${mean}`);
  if (cov >= gv) assert.ok(hi - lo < 1e-9, 'footprint >= block: flat');
  // spread between neighbouring cells shrinks as the footprint grows
  if (cov >= 0.1) assert.ok(hi - lo < (tS - bS) * 0.6, `cov ${cov}: range ${hi - lo}`);
}
console.log('bevelFootprint OK');
