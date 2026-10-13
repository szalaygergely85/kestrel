// engine/fx/hitSparks.test.js (HIT-SPARK-01). Run: node engine/fx/hitSparks.test.js
// Without global.gc it re-runs itself with --expose-gc (particles.test.js pattern).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeOk } from '../test/assert.js';
import { createParticles } from './particles.js';
import { createHasher } from '../core/hash.js';
import { defineHitSparks, hitSparks, HIT_SPARK_MAX_LIVE } from './hitSparks.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mk = (o) => { const p = createParticles(o); defineHitSparks(p); return p; };
const hashOf = (p) => { const h = createHasher(); p.hashInto(h); return h.value(); };

// cone + speed + life, for an oblique normal
{
  const p = mk({ capacity: 256, seed: 5 });
  const n = [0.3, -0.5, 0.8], nl = Math.hypot(...n);
  hitSparks(p, 1, 2, 3, n[0], n[1], n[2], 20, 0);
  p.step();
  let cnt = 0, maxAng = 0, sMin = 1e9, sMax = 0, lMin = 1e9, lMax = 0;
  for (let i = 0; i < p.cap; i++) {
    if (!p.alive[i]) continue;
    cnt++;
    // undo one step of gravity on vz to recover the initial velocity
    const vz0 = p.vz[i] + 9 / 60;
    const s = Math.hypot(p.vx[i], p.vy[i], vz0);
    const cos = (p.vx[i] * n[0] + p.vy[i] * n[1] + vz0 * n[2]) / (s * nl);
    maxAng = Math.max(maxAng, Math.acos(Math.min(1, cos)) * 180 / Math.PI);
    sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
    lMin = Math.min(lMin, p.life[i]); lMax = Math.max(lMax, p.life[i]);
  }
  ok(cnt === 20, `20 sparks alive (${cnt})`);
  ok(maxAng <= 60 + 1e-6, `all inside 60 deg cone (max ${maxAng.toFixed(3)})`);
  ok(sMin >= 2 - 1e-9 && sMax <= 5 + 1e-9, `speed 2..5 (${sMin.toFixed(2)}..${sMax.toFixed(2)})`);
  ok(lMin >= 15 && lMax <= 27, `life 0.25..0.45 s (${lMin}..${lMax} steps)`);
}
// cap, recycle, death
{
  const p = mk({ capacity: 64, seed: 1 });
  for (let k = 0; k < 10; k++) { hitSparks(p, 0, 0, 0, 0, 0, 1, 100, k); p.step(); ok(p.stats.live <= 64, 'pool cap'); }
  let maxPerEm = 0;
  const q = mk({ capacity: 512, seed: 1 });
  hitSparks(q, 0, 0, 0, 0, 0, 1, 500); q.step();
  maxPerEm = q.stats.live;
  ok(maxPerEm === HIT_SPARK_MAX_LIVE, `burst clamped to maxLive (${maxPerEm})`);
  for (let i = 0; i < 40; i++) q.step();
  ok(q.stats.live === 0, 'all dead after 0.45 s');
  hitSparks(q, 0, 0, 0, 0, 0, 1, 10); q.step();
  ok(q.stats.live === 10, 'dead slots recycled/reusable');
  ok(p.stats.recycled > 0, 'oldest recycled when pool full');
}
// determinism
{
  const run = () => { const p = mk({ capacity: 128, seed: 9 }); for (let k = 0; k < 30; k++) { if (k % 7 === 0) hitSparks(p, k, 0, 1, 1, 0, 0, 12, k); p.step(); } return hashOf(p); };
  ok(run() === run(), 'same seed = same state');
  const a = mk({ seed: 1 }), b = mk({ seed: 2 });
  hitSparks(a, 0, 0, 0, 0, 0, 1, 8); hitSparks(b, 0, 0, 0, 0, 0, 1, 8); a.step(); b.step();
  ok(hashOf(a) !== hashOf(b), 'different seed differs');
}
// 1e5 steps zero alloc
{
  const p = mk({ capacity: 256, seed: 3 });
  for (let i = 0; i < 2000; i++) { if (i % 5 === 0) hitSparks(p, 0, 0, 0, 0, 1, 0, 16, i); p.step(); }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { if (i % 5 === 0) hitSparks(p, 0, 0, 0, 0, 1, 0, 16, i); p.step(); }
  global.gc();
  const d = process.memoryUsage().heapUsed - before;
  ok(d < 200000, `1e5 steps zero alloc (heap delta ${d} B)`);
}
// ramps do not end in pure white
{
  const p = mk({}); 
  let white = false;
  for (let h = 0; h < 3; h++) { const id = p.defIdOf('hitSparks' + h); const o = id * p.MAX_RAMP * 3; for (let i = 0; i < 12; i++) if (p.defColors[o + i] === 255 && p.defColors[o + i] === p.defColors[o + i + 1]) white = true; }
  ok(!white, 'no pure white');
}
for (const f of failures) console.log('FAIL', f);
console.log(`hitSparks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
