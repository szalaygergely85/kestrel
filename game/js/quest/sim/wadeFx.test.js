// US-055a wade splash hook (architecture.md 38.47). Run: node game/js/quest/sim/wadeFx.test.js
import { createParticles, createRipples, defineWadeSplash } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { createWadeFx } from './wadeFx.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mk = () => {
  const particles = createParticles({ seed: 1 }); defineWadeSplash(particles);
  const ripples = createRipples();
  return { particles, ripples, fx: createWadeFx(particles, ripples) };
};
const ent = (imm, vx) => ({ transform: { x: 3, y: 4, z: 1 }, components: { body: { wadeImm: imm, vx, vy: 0 } } });
const ringCount = (r) => r.packInto(0.01, new Float32Array(32));

{ // entry edge fires once
  const { particles, ripples, fx } = mk();
  const e = ent(0, 3);
  fx.step(e, 0);
  e.components.body.wadeImm = 0.2;
  fx.step(e, 0); ok(particles.stats.spawned >= 6 && particles.stats.spawned <= 10, `entry droplets (${particles.stats.spawned})`);
  const s1 = particles.stats.spawned;
  for (let i = 0; i < 10; i++) fx.step(e, 0);
  ok(particles.stats.spawned === s1, 'no re-fire while staying in');
  ok(ringCount(ripples) === 1, 'entry ring added');
}
{ // too slow
  const { particles, fx } = mk();
  const e = ent(0, 0.9); fx.step(e, 0); e.components.body.wadeImm = 0.2; fx.step(e, 0);
  ok(particles.stats.spawned === 0, 'no splash below 1 m/s');
}
{ // ring every 24 steps while moving, none standing (spy on ripples.add)
  const run = (vx) => {
    const particles = createParticles({ seed: 1 }); defineWadeSplash(particles);
    let n = 0; const fx = createWadeFx(particles, { add() { n++; return true; } });
    const e = ent(0.2, vx);
    for (let i = 1; i <= 96; i++) fx.step(e, i / 60);
    return n;
  };
  ok(run(0.5) === 4, 'moving: 4 rings in 96 steps (' + run(0.5) + ')');
  ok(run(0) === 0, 'standing: no rings');
}
{ // arrow
  const { particles, fx } = mk();
  fx.arrowHit(1, 2, 3, 0);
  ok(particles.stats.live === 4, `arrowHit = 4 (${particles.stats.live})`);
}
for (const f of failures) console.log('FAIL', f);
console.log(`wadeFx: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
