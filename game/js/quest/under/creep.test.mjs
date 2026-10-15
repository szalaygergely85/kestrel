// UNDER-LIGHT-CREEP-01 Node test (suite filter: under, creep).
import assert from 'node:assert/strict';
import { createParticles } from '../../../../engine/index.js';
import { createUnderCreep, CREEP_SITES, FADE_STEPS, MOTES_CAP, creepFlicker } from './creep.js';

const run = (amb, steps, opts) => {
  const p = createParticles({ capacity: 512, seed: 5 }), c = createUnderCreep(p, opts); const log = [];
  for (let i = 0; i < steps; i++) { c.step(typeof amb === 'function' ? amb(i) : amb, 1, 2, 3); p.step(); log.push(c.out.w, c.out.mist, c.out.ambientScale); }
  let alive = 0; for (let i = 0; i < p.cap; i++) if (p.alive[i]) alive++;
  return { c, p, log, alive };
};
// outdoors: neutral, no motes, no emitter activity
const o = run(null, 300, {});
assert.deepEqual([o.c.out.w, o.c.out.ambientScale, o.c.out.flickerMul, o.c.out.mist, o.c.out.motesOn], [0, 1, 1, 0, false]);
assert.equal(o.alive, 0);
// crypt: fade in within <= 1 s, darker, misty, flicker up, motes capped
const k = run('crypt', 600, {});
assert.equal(k.c.out.w, 1); assert.ok(k.c.out.ambientScale < 1 && k.c.out.mist > 0 && k.c.out.flickerMul > 1);
assert.ok(k.alive > 0 && k.alive <= MOTES_CAP, 'motes ' + k.alive);
assert.ok(FADE_STEPS <= 60);
// leaving: back to exactly neutral
const l = run((i) => (i < 200 ? 'cave' : null), 400, {});
assert.deepEqual([l.c.out.w, l.c.out.ambientScale, l.c.out.mist, l.c.out.flickerMul], [0, 1, 0, 1]);
// deterministic + zero-garbage-ish: same log twice
assert.deepEqual(run('crypt', 100, {}).log, run('crypt', 100, {}).log);
// low preset: no motes, half mist; off: neutral even in the crypt
const lo = run('crypt', 300, { quality: 'low' }); assert.equal(lo.alive, 0); assert.equal(lo.c.out.mist, CREEP_SITES.crypt.mist * 0.5);
const off = run('crypt', 300, { enabled: false }); assert.deepEqual([off.c.out.w, off.c.out.mist], [0, 0]);
// unknown ambience = neutral; flicker helper
assert.equal(run('forest', 100, {}).c.out.w, 0);
assert.equal(creepFlicker({ hzMin: 8, hzMax: 12, amount: 0.15, jitter: 0.05 }, 2).amount, 0.3);
console.log('creep.test OK');
