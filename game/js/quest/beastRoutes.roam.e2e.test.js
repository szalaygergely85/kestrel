// BEAST-07b (roam half): REAL beastSim + regional generator + director wire (no stubs) on region-cropped navs. Per region (wolf signalHill,
// boar downs, night-wolf thornwood) over 1800 steps: groups move, stay cohesive (<= 8 m), never stand stuck > 5 s (BEAST-01 rule: wants to
// move, moved < 0.1 m). Determinism: the same region twice (2 x 600 steps, fresh worlds) gives the same hash.
import assert from 'node:assert/strict';
import { roamScene, simulate } from './beastRoutesKit.js';

const STEPS = 1800;
let moved = 0, eligibleN = 0, total = 0;
for (const region of ['signalHill', 'downs', 'thornwood']) {
  const S = roamScene(region), R = simulate(S, STEPS);
  // groups whose route really leaves home (> 40 m) must roam > 15 m
  const eligible = R.gs.map((g, i) => i).filter((i) => R.gs[i].route.some((q) => Math.hypot(q[0] - R.gs[i].home[0], q[1] - R.gs[i].home[1]) > 40));
  const idle = eligible.filter((i) => R.maxDisp[i] <= 15).map((i) => R.gs[i].gid + ':' + R.maxDisp[i].toFixed(0));
  console.log(`${region}: groups ${R.gs.length}, eligible ${eligible.length}, cohesion ${R.worst.toFixed(2)}, max still ${(R.maxStill / 60).toFixed(1)}s, disp ${R.maxDisp.map((d) => d.toFixed(0)).join(',')}`);
  assert.ok(R.gs.length >= 1 && eligible.length >= 1 && idle.length === 0, `${region}: groups roam (leader displacement > 15 m in 30 s), eligible ${eligible.length}, idle ${idle}`);
  assert.ok(R.worst <= 8, `${region} cohesion ` + R.worst.toFixed(2));
  assert.ok(R.maxStill <= 300, `${region} no slot stuck > 5 s: ` + (R.maxStill / 60).toFixed(1));
  eligibleN += eligible.length; total += R.gs.length; moved += R.maxDisp.filter((d) => d > 15).length;
}
assert.ok(total >= 4 && eligibleN >= 4 && moved >= eligibleN, `roamed ${moved}/${total} groups, eligible ${eligibleN}`);
console.log('beastRoutes.roam.e2e.test: PASS');
