// engine/entities/legDriverLod.test.js - D-107: the LOD rank scan shortcut (skip beyond the radius, stop at SOLVE_MAX) gives the same
// solved set as the plain full scan. Reference = the old algorithm on its own d2 / solved arrays, same slot order and stale-d2 rule.
// Run: node engine/entities/legDriverLod.test.js
import { packVoxelModel } from '../voxel/voxelPack.js';
import quadruped16 from '../voxel/fixtures/quadruped16.js';
import { createLegDriver, SOLVE_MAX, SOLVE_R, SOLVE_R_HYST } from './legDriver.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const pm = packVoxelModel(quadruped16, () => 1);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const flat = { groundAt() { return 0; } };

for (let scene = 0; scene < 6; scene++) {
  const N = 12 + scene * 8, cap = N + 4;
  const d = createLegDriver(cap), slots = [], xs = [], ys = [];
  for (let i = 0; i < N; i++) { slots.push(d.attach(pm)); const r = rnd() * 60, a = rnd() * 6.283; xs.push(Math.cos(a) * r); ys.push(Math.sin(a) * r); }
  const refD2 = new Float64Array(cap).fill(Infinity), refSolved = new Uint8Array(cap);
  let same = true;
  for (let f = 0; f < 40; f++) {
    for (let i = 0; i < N; i++) {
      const io = d.io; io[0] = xs[i]; io[1] = ys[i]; io[2] = 0; io[3] = 0; io[4] = 1000 / 60; io[5] = 0; io[6] = 0;
      d.update(slots[i], pm, 0, flat);
      const s = slots[i], d2 = xs[i] * xs[i] + ys[i] * ys[i];
      refD2[s] = d2;
      let rank = 0;
      for (let j = 0; j < cap; j++) if (j !== s && (refD2[j] < d2 || (refD2[j] === d2 && j < s))) rank++;
      const rr = refSolved[s] ? SOLVE_R_HYST : SOLVE_R;
      refSolved[s] = rank < SOLVE_MAX && d2 < rr * rr ? 1 : 0;
      if (f >= 39 && (d.poseOf(s)[0] > 0) !== (refSolved[s] === 1)) same = false;
    }
  }
  ok(`scene ${scene} (${N} animals): solved set == full-scan reference`, same);
}
console.log(`${pass} passed, ${fail} failed.`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
