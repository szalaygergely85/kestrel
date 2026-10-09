// Node test for S8-B1-18 ambient dust motes (game/js/quest/ambient.js).
// Run: node --test game/js/quest/ambient.test.js  (or via the suite filter: ambient)
import { createParticles } from '../../../engine/fx/particles.js';
import { createAmbientMotes, MOTES_COUNT } from './ambient.js';

let failed = 0;
function ok(name, cond) { if (!cond) { failed++; console.error('FAIL:', name); } }

function run(seed, steps) {
  const particles = createParticles({ capacity: 2048, seed });
  const motes = createAmbientMotes(null, particles, { rgb: [[255, 244, 214]] });
  for (let i = 0; i < steps; i++) {
    motes.step(1.5, 2.5, 0.1);
    particles.step();
  }
  const pos = [];
  let alive = 0;
  for (let p = 0; p < particles.cap; p++) {
    if (!particles.alive[p]) continue;
    alive++;
    pos.push(particles.px[p], particles.py[p], particles.pz[p]);
  }
  motes.dispose();
  return { pos, alive };
}

// 1) same seed + time -> same positions.
const a = run(7, 120);
const b = run(7, 120);
ok('determinism: same alive count', a.alive === b.alive);
ok('determinism: same positions', a.pos.length === b.pos.length && a.pos.every((v, i) => v === b.pos[i]));

// 2) count never exceeds the pool (per-emitter maxLive clamp and the global cap).
let maxAliveSeen = 0;
{
  const particles = createParticles({ capacity: 2048, seed: 3 });
  const motes = createAmbientMotes(null, particles, { rgb: [[255, 244, 214]] });
  for (let i = 0; i < 600; i++) {
    motes.step(0, 0, 0);
    particles.step();
    let alive = 0;
    for (let p = 0; p < particles.cap; p++) if (particles.alive[p]) alive++;
    if (alive > maxAliveSeen) maxAliveSeen = alive;
  }
  motes.dispose();
}
ok('count never exceeds the ~60-mote pool', maxAliveSeen <= MOTES_COUNT);
ok('count never exceeds the particle cap', maxAliveSeen <= 2048);

// 3) 0 alloc per frame after warm-up: step() itself allocates nothing (no `new`,
// no array/object literals, no closures created per call - see ambient.js). As a
// best-effort runtime proxy, heap growth over many post-warm-up steps should be
// negligible compared to the growth seen during warm-up.
{
  const particles = createParticles({ capacity: 2048, seed: 11 });
  const motes = createAmbientMotes(null, particles, { rgb: [[255, 244, 214]] });
  for (let i = 0; i < 200; i++) { motes.step(0, 0, 0); particles.step(); } // warm-up to steady state
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) { motes.step(0, 0, 0); particles.step(); }
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const perStep = (after - before) / 5000;
  // Only a hard gate under --expose-gc (deterministic GC before each measurement); without it,
  // uncollected garbage from earlier in the run makes this noisy, so it's reported, not failed.
  if (global.gc) ok(`0-alloc proxy: heap growth per step after warm-up is negligible (${perStep.toFixed(1)} B/step)`, perStep < 200);
  else console.log(`0-alloc proxy (informational, run with --expose-gc to assert): ${perStep.toFixed(1)} B/step`);
  motes.dispose();
}

if (failed) { console.error(`${failed} ambient.test.js check(s) failed`); process.exit(1); }
else console.log('ambient.test.js: all checks passed');
