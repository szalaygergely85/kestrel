// engine/fx/wadeSplash.test.js (US-055a). Run: node engine/fx/wadeSplash.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeOk } from '../test/assert.js';
import { createParticles } from './particles.js';
import { createHasher } from '../core/hash.js';
import { defineWadeSplash, wadeSplashAt, arrowSplashAt, WADE_SPLASH } from './wadeSplash.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mk = (o) => { const p = createParticles(o); defineWadeSplash(p); return p; };
const hashOf = (p) => { const h = createHasher(); p.hashInto(h); return h.value(); };

{
  const p = createParticles({ seed: 1 });
  const a = defineWadeSplash(p), b = defineWadeSplash(p);
  ok(a === b && a >= 0, 'define idempotent');
  ok(defineWadeSplash(p, { foam: [[255, 0, 0]] }) === a, 'redefine keeps id');
}
{
  const p = mk({ seed: 2 });
  wadeSplashAt(p, 0, 0, 0, 0); ok(p.stats.live === 6, `speed 0 -> 6 (${p.stats.live})`);
  p.clear(); wadeSplashAt(p, 0, 0, 0, 1); ok(p.stats.live === 10, `speed 1 -> 10 (${p.stats.live})`);
  p.clear(); arrowSplashAt(p, 0, 0, 0); ok(p.stats.live === 4, `arrow -> 4 (${p.stats.live})`);
  let threw = false; try { wadeSplashAt(createParticles({}), 0, 0, 0, 1); } catch { threw = true; }
  ok(threw, 'throws without define');
}
{
  const run = () => { const p = mk({ seed: 7 }); wadeSplashAt(p, 1, 2, 3, 0.5); for (let i = 0; i < 30; i++) p.step(); return hashOf(p); };
  ok(run() === run(), 'same seed -> same state after 30 steps');
  const a = mk({ seed: 1 }), b = mk({ seed: 2 });
  wadeSplashAt(a, 0, 0, 0, 1); wadeSplashAt(b, 0, 0, 0, 1); a.step(); b.step();
  ok(hashOf(a) !== hashOf(b), 'different seed differs');
}
{
  const p = mk({ seed: 3 });
  wadeSplashAt(p, 0, 0, 5, 1);
  for (let i = 0; i < 42; i++) p.step();
  ok(p.stats.live === 0, `all dead after 0.7 s (${p.stats.live})`);
}
{
  // 600-step worst case: a burst every 6 steps + arrows; live never above the 64 cap
  const p = mk({ seed: 4 });
  let max = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 6 === 0) wadeSplashAt(p, 0, 0, 5, 1);
    if (i % 17 === 0) arrowSplashAt(p, 1, 1, 5);
    p.step(); max = Math.max(max, p.stats.live);
  }
  ok(max <= WADE_SPLASH.maxLive, `live <= 64 (max ${max})`);
}
{
  const p = mk({ seed: 5 });
  for (let i = 0; i < 2000; i++) { if (i % 5 === 0) wadeSplashAt(p, 0, 0, 1, 1); p.step(); }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) { if (i % 5 === 0) wadeSplashAt(p, 0, 0, 1, 1); if (i % 97 === 0) arrowSplashAt(p, 0, 0, 1); p.step(); }
  global.gc();
  const d = process.memoryUsage().heapUsed - before;
  ok(d < 200000, `10k steps zero alloc (heap delta ${d} B)`);
}
for (const f of failures) console.log('FAIL', f);
console.log(`wadeSplash: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
