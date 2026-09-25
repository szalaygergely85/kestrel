// engine/render/sectorCaster.ceilWall.test.js (BUG-GPU-003, docs/backlog.md).
// Headless Node regression test for the CPU caster's ceiling-vs-far-wall
// overdraw fix (castColumn, solid branch): a solid wall whose top is ABOVE
// the near cell's numeric ceiling must never overwrite the ceiling rows that
// are nearer than the wall face (first hit wins - the GPU DDA, dda.frag,
// always did this; the CPU wall loop was clipped by `openTop` only, and a
// ceiling plane never narrows `openTop`, so the wall won by last write).
// Real-world case: tower 'K' sun crack (ceilH 6.4) beside an 8.5 m '#' wall,
// the 3 `?gpucompare=1` poses `voxel lever wall 2 m` / `half occluded` /
// `yaw 45` at pitch 40.
// No `design/` import - a small inline level fixture only.
// Run: node engine/render/sectorCaster.ceilWall.test.js

import { loadLevel } from '../world/Level.js';
import { castScene } from './sectorCaster.js';
import { GBuffer, KIND_WALL, KIND_CEIL } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const sector = (floorH, ceilH, solid) => ({
  floorH, ceilH, wallMat: 'stone', floorMat: 'stone', ceilMat: ceilH === 'sky' ? 'sky' : 'stone', solid: !!solid,
});

// Eye 1.6 m in a 2.4 m-ceilinged corridor ('k'), a 4.0 m solid wall ('#')
// 2 rows ahead: the wall's top (4.0) is above the ceiling (2.4), so the
// wall's natural row band starts above the ceiling's far edge.
const level = loadLevel({
  name: 'bug_gpu_003_fixture',
  legend: {
    '#': sector(4.0, 'sky', true),
    k: sector(0.0, 2.4, false),
  },
  rows: ['###', 'kkk', 'kkk', 'kkk'],
  start: { x: 1.5, y: 3.5, facingDeg: 0 },
});
if (!level) throw new Error('BUG-GPU-003 fixture level failed to load');

const COLS = 64, ROWS = 60;
const rt = { cols: COLS, rows: ROWS, pxCellW: 9, pxCellH: 16 };
const palette = { hue: { white: [1, 1, 1] }, lights: { ambient: { color: 'white', intensity: 0.3 } } };
const CEIL_H = 2.4, EYE_H = 1.6;

for (const pitchDeg of [0, 20, 40]) {
  const gbuf = new GBuffer(COLS, ROWS);
  gbuf.beginFrame();
  const depth = new DepthBuffer(COLS, ROWS);
  const camera = { x: 1.5, y: 3.0, z: EYE_H, yawDeg: 0, pitchDeg };
  castScene(rt, level, camera, palette, { gbuf, depthBuffer: depth, skyFallback: false });
  const planeDistY = gbuf.cam.planeDistY;
  const horizonRow = ROWS / 2 + Math.tan(pitchDeg * Math.PI / 180) * planeDistY;

  let walls = 0, ceils = 0, occluded = 0, firstBad = '';
  for (let y = 0; y < ROWS; y++) {
    // Perpendicular distance at which the 2.4 m ceiling plane crosses row y
    // (+Inf at/below the horizon: no ceiling there).
    const denom = horizonRow - y;
    const dCeil = denom > 0 ? ((CEIL_H - EYE_H) * planeDistY) / denom : Infinity;
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      const k = gbuf.kind[i];
      if (k === KIND_CEIL) ceils++;
      if (k !== KIND_WALL) continue;
      walls++;
      // A wall sample behind the ceiling plane on the same row is hidden.
      if (depth.depth[i] > dCeil + 1e-6) {
        occluded++;
        if (!firstBad) firstBad = `(${x},${y}) wall d=${depth.depth[i].toFixed(3)} ceiling d=${dCeil.toFixed(3)}`;
      }
    }
  }
  ok(`pitch ${pitchDeg}: wall visible`, walls > 0, `walls=${walls}`);
  ok(`pitch ${pitchDeg}: ceiling visible`, ceils > 0, `ceils=${ceils}`);
  ok(`pitch ${pitchDeg}: no wall sample behind the nearer ceiling`, occluded === 0, `${occluded} cells, first ${firstBad}`);
}

if (fail === 0) {
  console.log(`sectorCaster.ceilWall.test.js: ${pass} passed, 0 failed`);
  console.log('ALL PASS');
} else {
  console.log(`sectorCaster.ceilWall.test.js: ${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
