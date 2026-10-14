// game/js/quest/beastLegsSlide.test.js (ANIM-C-05b): Burl's planted feet must not slide under jittery render dt.
// Real step pattern: the NPC walker moves in fixed 60 Hz steps, the render frames come at 7/16/33 ms; legs.dtMs must follow the frame time.
//   node game/js/quest/beastLegsSlide.test.js
import { packVoxelModel } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createBeastLegs } from './beastLegs.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_bear.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const pm = packVoxelModel(globalThis.ASSETS.models.bear.voxel, () => 1);
const flat = { groundAt: () => 0 };

// mode: 'fixedDt' = old behaviour (legs.dtMs stays 1000/60), 'frameDt' = dtMs set per frame (what main.js does)
function run(frames, mode, speed) {
  const pool = { models: new Map([['bear', pm]]) };
  const legs = createBeastLegs({ pool });
  const voxel = { model: 'bear', anim: 'walk', frame: 0, t: 0, loop: true, playing: true, hidden: false };
  const e = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } };
  let acc = 0, simT = 0, prev = null, prev2 = null, max = 0, max2 = 0, planted = 0;
  const feet = [];
  for (let f = 0; f < 900; f++) {
    const dtMs = frames[f % frames.length];
    acc += dtMs / 1000;
    while (acc >= 1 / 60) { acc -= 1 / 60; e.transform.y += speed / 60; simT += 1 / 60; } // fixed-step npcWalk
    if (mode === 'frameDt') legs.dtMs = dtMs;
    voxel.anim = 'walk';
    legs.stepNpc('bear', e, voxel, 0, -5, flat);
    const lp = voxel.legPose;
    if (!lp || !(lp[0] > 0) || f < 120) { prev = null; continue; }
    const cur = [], lr = pm.legRig, gs = 4 + lr.n, Phi = legs.driver.io[8], duty = lr.gait[1];
    for (let k = 0; k < 4; k++) { let ph = Phi - lr.gait[4 + k]; ph -= Math.floor(ph); cur.push([lp[4 + k * 3], lp[5 + k * 3], lp[6 + k * 3], ph < duty]); }
    if (prev) for (let k = 0; k < 4; k++) {
      if (cur[k][3] && prev[k][3]) { // stance by gait phase
         const m = Math.hypot(cur[k][0] - prev[k][0], cur[k][1] - prev[k][1]) * 1000; if (m < 1) planted++; else if (m < 20) max = Math.max(max, m); }
    }
    // tools/verify-legs.mjs metric: stance = target z frozen for 2 frames (no gait phase visible from the page)
    if (prev && prev2) for (let k = 0; k < 4; k++) {
      if (Math.abs(cur[k][2] - prev[k][2]) < 1e-4 && Math.abs(prev[k][2] - prev2[k][2]) < 1e-4) { const m = Math.hypot(cur[k][0] - prev[k][0], cur[k][1] - prev[k][1]) * 1000; if (m >= 1 && m < 20) max2 = Math.max(max2, m); }
    }
    prev2 = prev; prev = cur;
  }
  return { max: Math.max(max, max2), planted };
}
const patterns = { steady16: [16.667], jitter: [7, 16, 33, 16, 7, 25, 12], slow: [33.3] };
for (const [name, fr] of Object.entries(patterns)) {
  for (const sp of [1.0, 1.1]) {
    const a = run(fr, 'fixedDt', sp), b = run(fr, 'frameDt', sp);
    console.log(name, sp, 'fixedDt', a.max.toFixed(1), a.planted, 'frameDt', b.max.toFixed(1), b.planted);
    ok(`${name} @${sp} m/s: slide <= 12 mm with per-frame dt (got ${b.max.toFixed(1)})`, b.max <= 12);
  }
}
console.log(`beastLegsSlide: ${pass} pass, ${fail} fail`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
