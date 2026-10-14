// engine/entities/lookAt.test.js - ANIM-LOOKAT-01: limits, smoothing continuity, null identity, validator, 0 alloc, determinism.
//   node --expose-gc engine/entities/lookAt.test.js
import { allocProbe } from '../../tools/allocProbe.mjs';
import { validateVoxelModel } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
import { createLookAt } from './lookAt.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const DT = 1000 / 60;
const d = JSON.parse(JSON.stringify(quadruped12));
d.lookAt = { part: 'head', yawLimitDeg: 50, pitchLimitDeg: 20, hz: 2 };
ok('def validates', validateVoxelModel(d).errors.length === 0, validateVoxelModel(d).errors.join('|'));
const bad = JSON.parse(JSON.stringify(d)); bad.lookAt = { part: 'nope', yawLimitDeg: 500, pitchLimitDeg: -1, hz: 0, x: 1 };
ok('validator rejects part / limits / hz / unknown key', validateVoxelModel(bad).errors.filter((e) => e.startsWith('voxel.lookAt')).length === 5);
const pm = packVoxelModel(d, () => 1);
const pm0 = packVoxelModel(quadruped12, () => 1);
ok('pack: lookAt present / absent -> null', pm.lookAt && pm.lookAt.part >= 0 && pm0.lookAt === null);

// ---- 0 alloc (runs first, see animBlend.test.js) ----
{
  const la = createLookAt(4), s = la.attach(pm), io = la.io;
  const drive = (i) => { io[0] = (i % 300) < 200 ? 1 : 0; io[1] = 0; io[2] = 0; io[3] = 1; io[4] = 0; io[5] = (i % 40) - 20; io[6] = -5; io[7] = 1; la.update(s, pm, DT); };
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) drive(i); }, { n: 200000 });
  if (r.skipped) console.log('SKIP alloc (no --expose-gc)'); else ok(`0 B/step update: ${r.perCall.toFixed(3)}`, r.perCall < 0.5);
}

const outB = new Float64Array(pm.partCount * 20 + 64);
const aim = (la, on, tx, ty, tz, yaw = 0) => { const io = la.io; io[0] = on; io[1] = 0; io[2] = 0; io[3] = 1; io[4] = yaw; io[5] = tx; io[6] = ty; io[7] = tz; };

// ---- limits: target far to the right/up is clamped; behind returns to neutral ----
{
  const la = createLookAt(2), s = la.attach(pm), r = la.lookOf(s);
  aim(la, 1, 10, 0, 20); // facing -y (yaw 0); +x = right, high above
  for (let i = 0; i < 300; i++) la.update(s, pm, DT);
  ok(`yaw settles at the +50 limit: rz ${r[4].toFixed(3)}`, Math.abs(r[4] - 50) < 0.01 && r[0] === 1 && r[1] === pm.lookAt.part);
  ok(`pitch settles at the 20 limit, up = rx -: ${r[2].toFixed(3)}`, Math.abs(r[2] + 20) < 0.01);
  let over = 0; aim(la, 1, 10, 0, 20); for (let i = 0; i < 120; i++) { la.update(s, pm, DT); if (Math.abs(r[4]) > 50 + 1e-9 || Math.abs(r[2]) > 20 + 1e-9) over++; }
  ok('never exceeds a limit', over === 0);
  aim(la, 1, 3, -3, 1); for (let i = 0; i < 300; i++) la.update(s, pm, DT);
  ok(`inside the limit: tracks the bearing (45 deg): ${r[4].toFixed(3)}`, Math.abs(r[4] - 45) < 0.01 && Math.abs(r[2]) < 0.01);
  aim(la, 1, 0, 5, 1); for (let i = 0; i < 300; i++) la.update(s, pm, DT); // behind (yaw 180 off)
  ok(`target behind: back to neutral, record off`, r[0] === 0);
  aim(la, 1, 1.7633, -10, 1, 350); for (let i = 0; i < 300; i++) la.update(s, pm, DT); // entity yaw 350, bearing 10 -> +20 across the 360 wrap
  ok(`yaw wrap: +20: ${r[4].toFixed(3)}`, Math.abs(r[4] - 20) < 0.01);
}

// ---- smoothing continuity: no jump on target switch, in and out are smooth, critically damped (no overshoot of the target) ----
{
  const la = createLookAt(2), s = la.attach(pm), r = la.lookOf(s);
  let prev = 0, maxStep = 0, maxAcc = 0, prevStep = 0, over = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { la.update(s, pm, DT); const y = r[0] === 1 ? r[4] : 0; const st = y - prev; maxStep = Math.max(maxStep, Math.abs(st)); maxAcc = Math.max(maxAcc, Math.abs(st - prevStep)); prevStep = st; prev = y; if (y > 30 + 1e-6) over++; } };
  aim(la, 1, 5.7735, -10, 0); // ~30 deg right
  run(240);
  ok(`step toward 30 deg: no overshoot (critically damped), max step ${maxStep.toFixed(3)} deg/frame`, over === 0 && maxStep < 2.5);
  ok(`settled at 30: ${prev.toFixed(3)}`, Math.abs(prev - 30) < 0.05);
  aim(la, 1, -5.7735, -10, 0); maxStep = 0; run(10); // instant target flip to -30
  ok(`target flip is smooth: first 10 frames move <= 5 deg/frame, acceleration <= 2.5 (spring bound w^2*dy*dt^2 = 2.6): ${maxStep.toFixed(3)} / ${maxAcc.toFixed(3)}`, maxStep < 5 && maxAcc < 2.5);
  aim(la, 0, 0, 0, 0); run(400);
  ok(`release: eases out to exactly neutral, record off`, r[0] === 0 && prev === 0);
}

// ---- null identity: lookRot absent / off = byte-identical pose ----
{
  const mkInst = (look) => ({ x: 1, y: 2, z: 0, yawDeg: 33, clip: -1, frame: 0, tMs: 0, scale: 1, look });
  computeVoxelPose(pm, mkInst(undefined), outB); const a = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  computeVoxelPose(pm, mkInst(null), outB); const b = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  const off = new Float64Array([0, pm.lookAt.part, 9, 9, 9]);
  computeVoxelPose(pm, mkInst(off), outB); const c = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  ok('look absent / null / off = byte-identical', a.every((v, i) => Object.is(v, b[i]) && Object.is(v, c[i])));
  const on = new Float64Array([1, pm.lookAt.part, 0, 0, 30]);
  computeVoxelPose(pm, mkInst(on), outB); const e = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  const hp = pm.lookAt.part;
  let headMoved = false;
  for (let p = 0; p < pm.partCount; p++) { let same = true; for (let k = 0; k < 12; k++) if (!Object.is(a[p * 12 + k], e[p * 12 + k])) same = false; if (p === hp) headMoved = !same; }
  ok('look on: the head part moves', headMoved);
}

// ---- determinism ----
{
  const rec = () => {
    const la = createLookAt(2), s = la.attach(pm), o = [];
    for (let f = 0; f < 300; f++) { aim(la, f % 120 < 80 ? 1 : 0, Math.sin(f / 20) * 8, -6, 1); la.update(s, pm, DT); for (let i = 0; i < 5; i++) o.push(la.lookOf(s)[i]); }
    return o;
  };
  const x = rec(), y = rec();
  ok('deterministic: two runs identical', x.every((v, i) => Object.is(v, y[i])));
}

console.log(`lookAt: ${pass} pass, ${fail} fail`);
for (const m of failures) console.log('  FAIL ' + m);
process.exit(fail ? 1 : 0);
