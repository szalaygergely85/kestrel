// engine/chargen/footIkPlayer.test.js - ANIM-IK-01b: the split-leg player rig (human.charkit.json partMap, 10 parts) + def.legRig + footIk plant the
// feet on a 20 deg slope within 2 cm; IK off / flat ground = the unsplit rig's posed vertices (pinned hash). Run: node engine/chargen/footIkPlayer.test.js
import fs from 'node:fs';
import crypto from 'node:crypto';
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, HUMANOID_PART_MAP, HUMANOID_SPLIT_LEG_PART_MAP, HUMANOID_SPLIT_LEG_RIG, MAX_PARTS } from './index.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { validateLegRig } from '../voxel/legRig.js';
import { MAX_VOX_PARTS, PART_STRIDE } from '../voxel/VoxelModel.js';
import { computeVoxelPose, voxelPointWorld, FORWARD } from '../voxel/voxelPose.js';
import { createFootIk } from '../entities/footIk.js';

let pass = 0, fail = 0;
const ok = (m, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', m, x === undefined ? '' : x); } };
const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const grid = composeCharacter(kit, kit.defaults), rigged = meshCharacter(grid);

const build = (map, opts) => { const d = riggedModelDef(collapseRig(rigged, map), opts); return { d, pm: packVoxelModel(d.voxel, () => 1) }; };
const old = build(HUMANOID_PART_MAP, {});
const sp = build(kit.partMap, { legRig: HUMANOID_SPLIT_LEG_RIG });
ok('kit partMap is the split map (10 parts <= MAX_PARTS <= MAX_VOX_PARTS)', Object.keys(sp.d.voxel.parts).length === 10 && 10 <= MAX_PARTS && MAX_PARTS <= MAX_VOX_PARTS);
ok('kit partMap == HUMANOID_SPLIT_LEG_PART_MAP', JSON.stringify(kit.partMap) === JSON.stringify(HUMANOID_SPLIT_LEG_PART_MAP));
const lrErr = []; validateLegRig(sp.d.voxel, Object.keys(sp.d.voxel.parts), lrErr);
ok('def.legRig validates (2 legs, bend front)', lrErr.length === 0, lrErr.join('; '));
ok('packed pm.legRig: 2 legs', sp.pm.legRig && sp.pm.legRig.n === 2);
ok('same quads, same vertex order as the unsplit rig', sp.d.voxel.rig.quads === old.d.voxel.rig.quads && Buffer.compare(Buffer.from(sp.d.voxel.rig.pos.buffer), Buffer.from(old.d.voxel.rig.pos.buffer)) === 0);

// posed vertices (IK off): split rig == unsplit rig for every clip frame (1e-4 cell rounding)
const hashPose = (b) => {
  const h = crypto.createHash('sha256'), pout = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
  const inst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, fromClip: -1, fromW: 0, addPart: -1 }, r = b.d.voxel.rig;
  for (const cname of Object.keys(b.d.voxel.animations)) {
    for (let f = 0; f < b.d.voxel.animations[cname].frames.length; f += 3) {
      inst.clip = b.pm.clipIndex[cname]; inst.frame = f; computeVoxelPose(b.pm, inst, pout);
      r.ranges.forEach((q, pi) => { for (let v = 4 * q.start; v < 4 * (q.start + q.count); v++) for (let a = 0; a < 3; a++) {
        const o = pi * 12, w = FORWARD[o + 3 * a] * r.pos[3 * v] + FORWARD[o + 3 * a + 1] * r.pos[3 * v + 1] + FORWARD[o + 3 * a + 2] * r.pos[3 * v + 2] + FORWARD[o + 9 + a];
        h.update(Math.round(w * 1e4) + ',');
      } });
    }
  }
  return h.digest('hex').slice(0, 16);
};
const hOld = hashPose(old), hSp = hashPose(sp);
ok(`posed player hash unchanged with IK off (${hOld})`, hOld === hSp && hOld === '41ac6a7a46e20d8e', hSp);

// 20 deg slope: both feet within 2 cm of the ground (clip foot height above ground, as on flat)
const cm = sp.pm.cellM, lr = sp.pm.legRig, footCells = sp.d.voxel.legRig.legs.map((l) => l.foot);
const clips = Object.keys(sp.d.voxel.animations), IDLE = clips.indexOf('idle'), WALK = clips.indexOf('walk');
ok('player has idle + walk clips', IDLE >= 0 && WALK >= 0);
const out = new Float64Array(3), mk = (x, y, z, yaw, clip, frame, legs) => ({ x, y, z, yawDeg: yaw, clip, frame, tMs: frame * 50, scale: 1, addPart: -1, fromClip: -1, fromW: 0, legs });
const footAt = (legs, x, y, z, yaw, clip, frame, k) => { voxelPointWorld(sp.pm, mk(x, y, z, yaw, clip, frame, legs), lr.lower[k], footCells[k][0], footCells[k][1], footCells[k][2], out); return [out[0], out[1], out[2]]; };
const T20 = Math.tan(20 * Math.PI / 180);
const grounds = {
  'uphill (+y)': { groundAt: (x, y) => T20 * y },
  'downhill (+y)': { groundAt: (x, y) => -T20 * y },
  'cross slope (+x)': { groundAt: (x, y) => T20 * x },
};
for (const clip of [IDLE, WALK]) for (const frame of clip === IDLE ? [0] : [0, 4, 8]) for (const [name, g] of Object.entries(grounds)) {
  const drv = createFootIk(), s = drv.attach(sp.pm);
  ok('attach ok', s >= 0);
  const flat = [0, 1].map((k) => footAt(null, 0, 0, 0, 0, clip, frame, k)); // clip feet at rootZ 0 on flat ground
  const z0 = g.groundAt(0, 0);
  for (let i = 0; i < 90; i++) {
    for (let k = 0; k < 2; k++) { const f = footAt(null, 0, 0, z0, 0, clip, frame, k); drv.io[6 + 3 * k] = f[0]; drv.io[7 + 3 * k] = f[1]; drv.io[8 + 3 * k] = f[2]; }
    drv.io[0] = 0; drv.io[1] = 0; drv.io[2] = z0; drv.io[3] = 0; drv.io[4] = 16.667; drv.io[5] = 0;
    drv.update(s, sp.pm, g);
  }
  for (let k = 0; k < 2; k++) {
    const f = footAt(drv.poseOf(s), 0, 0, z0, 0, clip, frame, k);
    const e = Math.abs(f[2] - flat[k][2] - g.groundAt(f[0], f[1]));
    ok(`${clips[clip]}#${frame} ${name}: foot ${k} within 2 cm (${(e * 100).toFixed(2)} cm)`, e < 0.02, e);
  }
}
console.log(`footIkPlayer: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
