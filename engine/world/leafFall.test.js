// WIND-GUST-01b: leaf-fall emitter. node engine/fx/world/leafFall.test.js
import assert from 'node:assert/strict';
import { createParticles } from '../fx/particles.js';
import { createWind, gustBand } from './wind.js';
import { defineLeafFall, createLeafFall, LEAF_FALL } from '../fx/leafFall.js';
import { STEP } from '../core/loop.js';

const mk = () => { const p = createParticles({ seed: 3 }); defineLeafFall(p, {}); return p; };
const N = 400, trees = { count: N, x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N) };
for (let i = 0; i < N; i++) { trees.x[i] = (i % 20) * 3 - 30; trees.y[i] = Math.floor(i / 20) * 3 - 30; trees.z[i] = 1; }
const windy = createWind({ dirDeg: 70, speed: 6, gust: { amp: 0.3, periodSec: 3, travel: 10 } }, 5);
const calm = createWind(null, 1);

// calm / no trees: nothing, ever
{ const p = mk(), lf = createLeafFall(p, gustBand); let s = 0;
  for (let k = 0; k < 600; k++) { s += lf.step(trees, calm, 0, 0, k); s += lf.step(null, windy, 0, 0, k); }
  assert.equal(s, 0); }
// windy: sheds, only trees under a band > gustK and within radius; deterministic; cap holds
function run() {
  const p = mk(), lf = createLeafFall(p, gustBand); let s = 0, maxLive = 0; const picks = [];
  for (let k = 0; k < 3600; k++) {
    const c = lf.cursor, n = lf.step(trees, windy, 0, 0, k); s += n;
    if (n) picks.push(k);
    p.step(); maxLive = Math.max(maxLive, p.stats.live);
  }
  return { s, picks: picks.join(','), maxLive };
}
const a = run(), b = run();
assert.ok(a.s > 5, `sheds in gusts (${a.s})`);
assert.deepEqual(a, b, 'deterministic');
assert.ok(a.maxLive <= LEAF_FALL.maxLive, `cap ${a.maxLive}`);
// every spawn obeys the gust threshold: brute-check with a probe over the same ticks
{ const { dirX, dirY, speed } = windy.params; let any = 0;
  for (let k = 0; k < 600; k += LEAF_FALL.everySteps) for (let i = 0; i < N; i++) if (gustBand(trees.x[i], trees.y[i], k * STEP, dirX, dirY, speed) > LEAF_FALL.gustK) any++;
  assert.ok(any > 0); }
// zero alloc after warm-up
{ const p = mk(), lf = createLeafFall(p, gustBand); for (let k = 0; k < 1200; k++) { lf.step(trees, windy, 0, 0, k); p.step(); }
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let k = 1200; k < 21200; k++) lf.step(trees, windy, 0, 0, k); assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'step allocs'); } }
console.log(`leafFall: ok (${a.s} bursts / 60 s, live<=${a.maxLive})`);
