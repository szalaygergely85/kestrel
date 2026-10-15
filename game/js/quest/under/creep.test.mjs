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

// main wiring helpers: no compounding, hour rewrite resets, mist cap
{
  const { applyCreepLights, creepMistDensity } = await import('./creep.js');
  const ls = { ambient: new Float32Array([1, 1, 1]), flickerAmount: new Float32Array([0.2, 0.2, 9]), count: 2 }, st = { amb: 1, fl: 1 };
  const out = { ambientScale: 0.5, flickerMul: 2 };
  applyCreepLights(ls, out, st); applyCreepLights(ls, out, st);
  assert.ok(Math.abs(ls.ambient[0] - 0.5) < 1e-6 && Math.abs(ls.flickerAmount[0] - 0.4) < 1e-6 && ls.flickerAmount[2] === 9);
  ls.ambient.fill(1); st.amb = 1; applyCreepLights(ls, out, st); assert.ok(Math.abs(ls.ambient[1] - 0.5) < 1e-6);
  out.ambientScale = 1; out.flickerMul = 1; applyCreepLights(ls, out, st); assert.ok(Math.abs(ls.ambient[2] - 1) < 1e-6 && Math.abs(ls.flickerAmount[1] - 0.2) < 1e-6);
  applyCreepLights(null, out, st);
  assert.equal(creepMistDensity(0, 1), 0); assert.equal(creepMistDensity(0.1, 1), 0.2); assert.equal(creepMistDensity(0.05, 0), 0.05);
}

{ const { createFirstEntry } = await import('./creep.js'); const f = createFirstEntry();
  assert.ok(f.first('crypt') && !f.first('crypt') && f.first('cellar') && !f.first(null) && !f.first(undefined)); }
