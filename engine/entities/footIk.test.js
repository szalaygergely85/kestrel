// engine/entities/footIk.test.js - ANIM-IK-01 (player foot IK driver + in-pose solve). Run: node --expose-gc engine/entities/footIk.test.js
// quadruped16's two front legs stand in for the biped's legs (the player rig needs the split-leg part map + def.legRig, see lane entry).
import { createFootIk } from './footIk.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, voxelPointWorld } from '../voxel/voxelPose.js';
import quadruped16 from '../voxel/fixtures/quadruped16.js';
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';

let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x === undefined ? '' : x); } };
const def = { ...quadruped16, legRig: {
  body: 'body', legs: quadruped16.legRig.legs.slice(0, 2),
  gaits: { walk: { tunedMps: 1, duty: 0.6, phase: [0, 0.5], liftM: 0.1 } }, stand: ['idle'] } };
const pm = packVoxelModel(def, () => 1);
const lr = pm.legRig, cm = pm.cellM;
const names = Object.keys(def.animations), IDLE = names.indexOf('idle'), WALK = names.indexOf('walk');
const ZOFF = (lr.geo[1] + lr.geo[3] + lr.geo[5] - pm.anchor[2]) * cm;
const footCells = def.legRig.legs.map((l) => l.foot);
const out = new Float64Array(3), scratch = new Float64Array(16 * 24);
const mkInst = (x, y, z, yaw, clip, frame, legs) => ({ x, y, z, yawDeg: yaw, clip, frame, tMs: frame * 125, scale: 1, addPart: -1, legs });
function clipFeet(drv, x, y, z, yaw, clip, frame) {
  const inst = mkInst(x, y, z, yaw, clip, frame, null);
  for (let k = 0; k < 2; k++) {
    voxelPointWorld(pm, inst, lr.lower[k], footCells[k][0], footCells[k][1], footCells[k][2], out);
    const o = 6 + 3 * k; drv.io[o] = out[0]; drv.io[o + 1] = out[1]; drv.io[o + 2] = out[2];
  }
}
function step(drv, slot, ground, x, y, z, yaw, clip, frame, off) {
  clipFeet(drv, x, y, z, yaw, clip, frame);
  drv.io[0] = x; drv.io[1] = y; drv.io[2] = z; drv.io[3] = yaw; drv.io[4] = 16.667; drv.io[5] = off ? 1 : 0;
  drv.update(slot, pm, ground);
}
function posedFoot(legs, x, y, z, yaw, clip, frame, k) {
  voxelPointWorld(pm, mkInst(x, y, z, yaw, clip, frame, legs), lr.lower[k], footCells[k][0], footCells[k][1], footCells[k][2], out);
  return [out[0], out[1], out[2]];
}
const settle = (drv, slot, g, x, y, z, yaw, clip, frame, n = 60) => { for (let i = 0; i < n; i++) step(drv, slot, g, x, y, z, yaw, clip, frame, false); };

// 1. no legRig -> attach refuses
ok('attach: no legRig -> -1', createFootIk().attach({ legRig: null }) === -1);

// 2. flat ground: pose within epsilon of the plain clip pose
{
  const drv = createFootIk(), s = drv.attach(pm), flat = { groundAt: () => 0 };
  settle(drv, s, flat, 1, 2, 0, 30, IDLE, 0);
  const a = new Float64Array(16 * 24), b = new Float64Array(16 * 24);
  computeVoxelPose(pm, mkInst(1, 2, 0, 30, IDLE, 0, null), a);
  computeVoxelPose(pm, mkInst(1, 2, 0, 30, IDLE, 0, drv.poseOf(s)), b);
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  ok('flat ground: pose == clip pose (eps)', d < 5e-3, d);
  ok('flat ground: solve stays off (w 0, drop 0)', drv.poseOf(s)[0] === 0 && drv.poseOf(s)[3] === 0);
  ok('flat ground: byte-identical', Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0);
}

// 3. slope (rise along +y, ~11 deg) and step (+0.15 m at y > 2.0): contact feet within 2 cm of the ground
for (const [name, g, y] of [
  ['slope up', { groundAt: (x, yy) => 0.2 * (yy - 2) }, 2],
  ['slope down', { groundAt: (x, yy) => -0.2 * (yy - 2) }, 2],
  ['step', { groundAt: (x, yy) => (yy > 2.0 ? 0.12 : 0) }, 1.97], // front foot over the edge, hind foot below
]) {
  const drv = createFootIk(), s = drv.attach(pm);
  const z0 = g.groundAt(0, y);
  settle(drv, s, g, 0, y, z0, 0, IDLE, 0);
  for (let k = 0; k < 2; k++) {
    const f = posedFoot(drv.poseOf(s), 0, y, z0, 0, IDLE, 0, k);
    const e = Math.abs(f[2] - ZOFF - g.groundAt(f[0], f[1])); // ZOFF: the fixture's rest foot sits 0.125 m below its root
    ok(`${name}: foot ${k} within 2 cm of ground`, e < 0.02, e);
  }
  ok(`${name}: pelvis drop <= 0`, drv.poseOf(s)[3] <= 0);
}

// 4. off (airborne / swimming): w fades to 0, no queries, pose identical to the clip
{
  const drv = createFootIk(), s = drv.attach(pm), g = { groundAt: () => 0.1 };
  settle(drv, s, g, 0, 0, 0, 0, IDLE, 0, 20);
  const q = drv.queries;
  settle(drv, s, g, 0, 0, 0, 0, IDLE, 0, 20); drv.queries = 0;
  for (let i = 0; i < 20; i++) step(drv, s, g, 0, 0, 0, 0, IDLE, 0, true);
  ok('off: w = 0 and 0 queries', drv.poseOf(s)[0] === 0 && drv.queries === 0 && q > 0);
  const a = new Float64Array(16 * 24), b = new Float64Array(16 * 24);
  computeVoxelPose(pm, mkInst(0, 0, 0, 0, WALK, 1, null), a);
  computeVoxelPose(pm, mkInst(0, 0, 0, 0, WALK, 1, drv.poseOf(s)), b);
  ok('off: byte-identical pose', Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0);
}

// 5. determinism
{
  const run = () => {
    const drv = createFootIk(), s = drv.attach(pm), g = { groundAt: (x, y) => 0.15 * Math.sin(y * 3) };
    for (let i = 0; i < 90; i++) step(drv, s, g, 0, i * 0.02, g.groundAt(0, i * 0.02), 0, WALK, i % 2, false);
    return Array.from(drv.poseOf(s));
  };
  ok('determinism', JSON.stringify(run()) === JSON.stringify(run()));
}

// 6. 0 alloc per frame (update only; the clip-foot pose call is the caller's)
{
  const drv = createFootIk(), s = drv.attach(pm), g = { groundAt: (x, y) => 0.1 * y };
  clipFeet(drv, 0, 1, 0, 0, WALK, 1);
  drv.io[2] = 0.1; drv.io[4] = 16.667; drv.io[5] = 0;
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) drv.update(s, pm, g); }, { n: 100000, warm: 10 });
  if (!skipNote(r, 'footIk alloc')) ok('0 alloc per update', r.perCall < 8, r.perCall);
}
console.log(`footIk: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
