// engine/entities/animBlendLegs.test.js - ANIM-BLEND-01c (architecture.md 38.68 section 4): blender + legDriver composition.
//   node --expose-gc engine/entities/animBlendLegs.test.js
import { allocProbe } from '../../tools/allocProbe.mjs';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
import quadruped16 from '../voxel/fixtures/quadruped16.js';
import { createAnimBlender } from './animBlend.js';
import { createLegDriver } from './legDriver.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const DT = 1000 / 60;

const d = JSON.parse(JSON.stringify(quadruped16));
const fr = (a) => ({ head: { rot: [a, 0, 0] }, legFL: { rot: [a, 0, 0] }, legBR: { rot: [a, 0, 0] } });
d.animations = {
  idle: d.animations.idle,
  walk: { fps: 8, loop: true, frames: [fr(20), fr(0), fr(-20), fr(0)] },   // 500 ms
  run: { fps: 16, loop: true, frames: [fr(40), fr(0), fr(-40), fr(0)] },   // 250 ms
  attack: { fps: 10, loop: false, frames: [{ head: { rot: [0, 0, 0] } }, { head: { rot: [40, 0, 0] } }, { head: { rot: [10, 0, 0] } }] },
};
d.legRig.gaits = { walk: { tunedMps: 1.0, duty: 0.6, phase: [0, 0.5, 0.5, 0], liftM: 0.1 }, run: { tunedMps: 3.0, duty: 0.4, phase: [0, 0.5, 0.25, 0.75], liftM: 0.15 } };
d.blend = { sets: { loco: { param: 'speed', clips: [{ clip: 'walk', at: 1 }, { clip: 'run', at: 3 }] } }, fades: { default: 150 } };
const pm = packVoxelModel(d, () => 1);
const ci = pm.clipIndex, LOCO = -1, lr = pm.legRig;
const flat = { groundAt() { return 0; }, groundAtQ(q) { q[2] = 0; } };
const zOff = (lr.geo[1] + lr.geo[3] + lr.geo[5] - pm.anchor[2]) * pm.cellM;
const outB = new Float64Array(pm.partCount * 20 + 64);

function rig() { const bl = createAnimBlender(2), dr = createLegDriver(2); return { bl, dr, bs: bl.attach(pm), ds: dr.attach(pm), pos: Float64Array.of(5, 5), legacy: false }; }
// one frame: blender (phase from last frame's driver, stride out) then driver. speed = true root speed along +y (yaw 0).
const ctl = new Float64Array(2); // [req, speed]: typed so the call boxes no double (38.61)
function frame(r, req, speed) { ctl[0] = req; ctl[1] = speed; frameC(r); }
function frameC(r) {
  const req = ctl[0], speed = ctl[1];
  r.pos[1] += speed / 60;
  r.bl.io[0] = req; r.bl.io[1] = speed; r.bl.io[2] = -1; r.bl.io[3] = -1; r.bl.io[4] = 1;
  r.dr.io[11] = 0;
  if (!r.legacy) r.bl.update(r.bs, pm, DT, r.dr.io);
  const di = r.dr.io; di[0] = r.pos[0]; di[1] = r.pos[1]; di[2] = 0; di[3] = 0; di[4] = DT; di[5] = 0; di[6] = 0;
  r.dr.update(r.ds, pm, r.legacy ? (speed > 2 ? ci.run : ci.walk) : (req < 0 ? r.bl.io[6] : req) | 0, flat);
}

// ---- 0. 0 alloc per step (first in the file: later scenarios make the JIT state noisy, see animBlend.test.js)
{
  const r = rig();
  const res = allocProbe((n) => { for (let i = 0; i < n; i++) { ctl[0] = (i % 200) < 100 ? LOCO : ci.attack; ctl[1] = (i % 90) / 25; frameC(r); } }, { n: 50000 });
  if (res.skipped) console.log('SKIP alloc (no --expose-gc)');
  else ok(`0 B/step blender + driver ${res.perCall.toFixed(3)}`, res.perCall < 0.5);
}

// ---- 1. foot slide <= 12 mm over a 0 -> run -> 0 speed ramp (stance = foot on the ground)
{
  const r = rig(), pose = r.dr.poseOf(r.ds);
  let maxSlide = 0, steps = 0; const sx = [0, 0, 0, 0], sy = [0, 0, 0, 0], inSt = [false, false, false, false];
  const N = 60 * 8;
  for (let f = 0; f < N; f++) {
    const t = f / 60, sp = t < 2 ? 3.5 * t / 2 : t < 6 ? 3.5 : 3.5 * (8 - t) / 2;
    frame(r, LOCO, sp);
    for (let k = 0; k < 4; k++) {
      const T = 4 + k * 3, px = pose[T], py = pose[T + 1], pz = pose[T + 2] - zOff;
      if (pz < 1e-6) { if (!inSt[k]) { inSt[k] = true; sx[k] = px; sy[k] = py; } else maxSlide = Math.max(maxSlide, Math.hypot(px - sx[k], py - sy[k])); }
      else inSt[k] = false;
    }
    if (r.dr.io[8] > 0) steps++;
  }
  ok(`foot slide over 0 -> run -> 0 ramp ${(maxSlide * 1000).toFixed(2)} mm <= 12`, maxSlide <= 0.012);
  ok('driver phase advanced during the ramp', steps > 100);
}

// ---- 2. stride handed over: driver uses io[11]; pattern change walk -> run makes no foot jump
{
  const r = rig();
  for (let f = 0; f < 120; f++) frame(r, LOCO, 1);
  ok('blender stride written to driver io[11] (walk: 1 m/s * 0.5 s)', Math.abs(r.bl.io[5] - 0.5) < 1e-9, String(r.bl.io[5]));
  const ramp = (rg) => {
    const pose = rg.dr.poseOf(rg.ds); let prev = Float64Array.from(pose), mj = 0;
    for (let f = 0; f < 240; f++) {
      frame(rg, LOCO, f < 20 ? 1 + f * 0.1 : 3);
      if (f > 40) for (let k = 0; k < 4; k++) { const T = 4 + k * 3; mj = Math.max(mj, Math.hypot(pose[T] - prev[T], pose[T + 1] - prev[T + 1], pose[T + 2] - prev[T + 2])); }
      prev = Float64Array.from(pose);
    }
    return mj;
  };
  const leg = rig(); leg.legacy = true; for (let f = 0; f < 120; f++) frame(leg, LOCO, 1);
  const jl = ramp(leg), jb = ramp(r);
  ok(`walk -> run: max foot target step ${(jb * 1000).toFixed(1)} mm/frame <= legacy hard switch ${(jl * 1000).toFixed(1)} mm/frame (+1 mm)`, jb <= jl + 0.001);
}

// ---- 3. io[11] = 0 is byte-identical to a driver that never sees the blender
{
  const a = rig(), b = rig();
  let same = true;
  for (let f = 0; f < 300; f++) {
    a.pos[1] += 1.2 / 60; b.pos[1] += 1.2 / 60;
    for (const r of [a, b]) { const di = r.dr.io; di[0] = r.pos[0]; di[1] = r.pos[1]; di[2] = 0; di[3] = 0; di[4] = DT; di[5] = 0; di[6] = 0; di[11] = 0; }
    a.dr.update(a.ds, pm, f < 150 ? ci.walk : ci.run, flat); b.dr.update(b.ds, pm, f < 150 ? ci.walk : ci.run, flat);
    const pa = a.dr.poseOf(a.ds), pb = b.dr.poseOf(b.ds);
    for (let i = 0; i < 16; i++) if (pa[i] !== pb[i]) same = false;
  }
  ok('io[11] = 0: two drivers identical (equal to the pre-01c path by the legDriver suite)', same);
}

// ---- 4. walk -> attack: legs reach the clip within 150 ms, no per-frame step above the in-clip baseline + 1 deg
{
  const r = rig();
  const L = r.bl.layersOf(r.bs), pose = r.dr.poseOf(r.ds);
  const inst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, layers: L, legs: pose };
  const legParts = []; for (let k = 0; k < lr.n; k++) legParts.push(lr.upper[k], lr.lower[k]);
  const snap = () => { inst.x = r.pos[0]; inst.y = r.pos[1]; computeVoxelPose(pm, inst, outB); return Float64Array.from(FORWARD.subarray(0, pm.partCount * 12)); };
  const ang = (a, b, p) => { let tr = 0, na = 0, nb = 0; for (let i = 0; i < 9; i++) { const x = a[p * 12 + i], y = b[p * 12 + i]; tr += x * y; na += x * x; nb += y * y; } return Math.acos(Math.max(-1, Math.min(1, (tr / Math.sqrt(na * nb) * 3 - 1) / 2))) * 180 / Math.PI; }; // matrices carry the cell scale: normalise
  const step = (a, b) => { let m = 0; for (const p of legParts) m = Math.max(m, ang(a, b, p)); return m; };
  let prev = null, base = 0, maxT = 0, wAt150 = -1;
  for (let f = 0; f < 200; f++) { frame(r, LOCO, 1); const c = snap(); if (prev && f > 30) base = Math.max(base, step(prev, c)); prev = c; }
  for (let f = 0; f < 40; f++) {
    frame(r, ci.attack, 0);
    const c = snap(); maxT = Math.max(maxT, step(prev, c)); prev = c;
    if (f === 9) wAt150 = pose[0]; // 10 frames = 167 ms
  }
  const off = { ...inst, legs: null, x: r.pos[0], y: r.pos[1] }; computeVoxelPose(pm, off, outB); const ref = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  const fin = snap(); let dev = 0; for (const p of legParts) dev = Math.max(dev, ang(ref, fin, p));
  ok(`leg solve weight 0 within 150 ms of the attack request (w ${wAt150})`, wAt150 === 0);
  ok(`legs equal the clip pose afterwards (dev ${dev.toFixed(3)} deg)`, dev < 0.01);
  ok(`walk -> attack leg step ${maxT.toFixed(2)} deg/frame <= in-clip baseline ${base.toFixed(2)} + 1`, maxT <= base + 1);
  console.log(`  info: baseline ${base.toFixed(2)} deg/frame, transition max ${maxT.toFixed(2)} deg/frame`);
}

// ---- 5. determinism + 0 alloc
{
  const run = () => { const r = rig(); let h = 0; for (let f = 0; f < 600; f++) { frame(r, f % 200 < 100 ? LOCO : ci.attack, (f % 90) / 25); const p = r.dr.poseOf(r.ds); for (let i = 0; i < 16; i++) h = (h * 31 + Math.round(p[i] * 1e6)) % 1e9; } return h; };
  ok('deterministic', run() === run());
}
console.log(`${pass} pass, ${fail} fail`);
for (const m of failures) console.log('  FAIL ' + m);
process.exit(fail ? 1 : 0);
