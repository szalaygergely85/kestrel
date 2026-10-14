// engine/voxel/legRig.test.js - ANIM-C-01 (architecture.md 38.67 items 2 + 3).
// legRig validator, packLegRig, in-pose 2-bone solve (inst.legs LegPose): oracle vs the preview FK (design/preview/animal-look-options.html
// `poseLocal`, copied below), planted-target error, branch/limits, bit-identical when legs are null / w = 0, 0 alloc.
// Run: node --expose-gc engine/voxel/legRig.test.js
import { PART_STRIDE, validateVoxelModel } from './VoxelModel.js';
import { packVoxelModel } from './voxelPack.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';
import quadruped12 from './fixtures/quadruped12.js';
import quadruped16 from './fixtures/quadruped16.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const MATS = ['mat_a', 'mat_b', 'mat_c'];
const V = { materialKeys: MATS };
const clone = (o) => JSON.parse(JSON.stringify(o));
const errs = (d) => validateVoxelModel(d, V).errors;
const has = (d, s) => errs(d).some((e) => e.indexOf(s) >= 0);

// ---------------------------------------------------------------- validator
ok('quadruped16 + legRig validates', errs(quadruped16).length === 0, JSON.stringify(errs(quadruped16)));
ok('unknown legRig key errors', has({ ...clone(quadruped16), legRig: { ...clone(quadruped16.legRig), foo: 1 } }, "unknown key 'foo'"));
{
  const m = (f) => { const d = clone(quadruped16); f(d.legRig, d); return d; };
  ok('unknown leg key errors', has(m((r) => { r.legs[0].hip = [0, 0, 0]; }), "unknown key 'hip'"));
  ok('1 leg errors', has(m((r) => { r.legs.length = 1; r.gaits.walk.phase.length = 1; }), '2..4 legs'));
  ok('5 legs errors', has(m((r) => { r.legs.push(clone(r.legs[0])); }), '2..4 legs'));
  ok('lower not a child of upper errors', has(m((r) => { r.legs[0].lower = 'legFR2'; }), 'parent must be'));
  ok('unknown upper errors', has(m((r) => { r.legs[0].upper = 'nope'; }), 'unknown part'));
  ok('foot outside the lower box errors', has(m((r) => { r.legs[0].foot = [3, 3, -3]; }), 'outside the lower part box'));
  ok('|knee->foot| < 2 cells errors', has(m((r) => { r.legs[0].foot = [3, 3, 0]; }), '< 2 cells'));
  ok('straight leg without bend errors', has(m((r) => { delete r.legs[0].bend; }), 'required when the rest leg is straight'));
  ok('bad bend value errors', has(m((r) => { r.legs[0].bend = 'left'; }), "'front' | 'back'"));
  ok('bent rest leg: bend must agree with the rest pose', has(m((r, d) => { r.legs[0].foot = [3, 4, -1]; r.legs[0].bend = 'back'; }), 'contradicts the rest pose'));
  ok('bent rest leg: bend may be omitted or agree', !has(m((r) => { r.legs[0].foot = [3, 4, -1]; delete r.legs[0].bend; }), 'legRig') && !has(m((r) => { r.legs[0].foot = [3, 4, -1]; r.legs[0].bend = 'front'; }), 'legRig'));
  ok('gait for a non-clip errors', has(m((r) => { r.gaits.run = { ...r.gaits.walk }; }), 'not a clip of the model'));
  ok('stand entry that is not a clip errors', has(m((r) => { r.stand.push('nope'); }), 'is not a clip'));
  ok('duty out of range errors', has(m((r) => { r.gaits.walk.duty = 0.95; }), 'duty'));
  ok('liftM out of range errors', has(m((r) => { r.gaits.walk.liftM = 0.6; }), 'liftM'));
  ok('tunedMps <= 0 errors', has(m((r) => { r.gaits.walk.tunedMps = 0; }), 'tunedMps'));
  ok('phase length != legs errors', has(m((r) => { r.gaits.walk.phase = [0, 0.5]; }), 'phase'));
  ok('phase value 1 errors', has(m((r) => { r.gaits.walk.phase[0] = 1; }), '[0, 1)'));
  ok('unknown body part errors', has(m((r) => { r.body = 'nope'; }), 'legRig.body'));
  ok('unknown gait key errors', has(m((r) => { r.gaits.walk.speed = 1; }), "unknown key 'speed'"));
}

// ---------------------------------------------------------------- pack
const pm16 = packVoxelModel(quadruped16, () => 1);
const lr = pm16.legRig;
ok('pack: legRig present, n = 4, body index 0', lr && lr.n === 4 && lr.bodyIdx === 0);
ok('pack: no legRig -> null', packVoxelModel(quadruped12, () => 1).legRig === null);
const names = Object.keys(quadruped16.parts);
ok('pack: upper/lower indices follow part order', ['legFL', 'legFR', 'legBL', 'legBR'].every((n, i) => lr.upper[i] === names.indexOf(n) && lr.lower[i] === names.indexOf(n + '2')));
ok('pack: upperOf/lowerOf reverse maps', lr.upperOf[lr.upper[2]] === 2 && lr.lowerOf[lr.lower[3]] === 3 && lr.upperOf[0] === -1);
ok('pack: geo = hip, u, w, |u|, |w| (cells), sigma, footX', lr.geo[0] === 3 && lr.geo[1] === 3 && lr.geo[2] === 0 && lr.geo[3] === -2 && lr.geo[4] === 0 && lr.geo[5] === -2
  && lr.geo[6] === 2 && lr.geo[7] === 2 && lr.geo[10] === 1 && lr.geo[11] === 3 && lr.geo[2 * 12 + 10] === -1);
const walkIdx = pm16.clipIndex.walk, idleIdx = pm16.clipIndex.idle;
ok('pack: gaitClip / standClip', lr.gaitClip[walkIdx] === 0 && lr.gaitClip[idleIdx] === -1 && lr.standClip[idleIdx] === 1 && lr.standClip[walkIdx] === 0);
ok('pack: gait = [tunedMps, duty, liftM, T, phase...]', lr.gait.length === 8 && lr.gait[0] === 1 && lr.gait[1] === 0.6 && lr.gait[2] === 0.1 && Math.abs(lr.gait[3] - 0.25) < 1e-12 && lr.gait[5] === 0.5);
ok('pack: default pitch/roll limits 20 / 8 deg', lr.maxPitch === 20 && lr.maxRoll === 8);

// ---------------------------------------------------------------- oracle: the preview FK (poseLocal), copied from animal-look-options.html
const D2R = Math.PI / 180;
function rotM(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}
function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function mulV(a, v) { return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]]; }
// instance at the origin, yaw 0; F = part-to-world (stride 12, metres)
function oracleF(pm, frame, F) {
  const n = pm.partCount, cm = pm.cellM, anc = pm.anchor, Ak = [], bk = [];
  const bw = [-cm * anc[0], -cm * anc[1], -cm * anc[2]];
  for (let p = 0; p < n; p++) {
    const pb = p * PART_STRIDE, pf = frame[names[p]];
    const rot = (pf && pf.rot) || [0, 0, 0], pos = (pf && pf.pos) || [0, 0, 0];
    const R = rotM(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    const piv = [pm.parts[pb + 6], pm.parts[pb + 7], pm.parts[pb + 8]], par = pm.parts[pb + 9];
    const rv = mulV(R, piv), l = [piv[0] + (pos[0] || 0) - rv[0], piv[1] + (pos[1] || 0) - rv[1], piv[2] + (pos[2] || 0) - rv[2]];
    if (par < 0) { Ak[p] = R; bk[p] = l; }
    else { Ak[p] = mul3(Ak[par], R); const t = mulV(Ak[par], l); bk[p] = [t[0] + bk[par][0], t[1] + bk[par][1], t[2] + bk[par][2]]; }
    const f = p * 12;
    for (let i = 0; i < 9; i++) F[f + i] = Ak[p][i] * cm;
    F[f + 9] = cm * bk[p][0] + bw[0]; F[f + 10] = cm * bk[p][1] + bw[1]; F[f + 11] = cm * bk[p][2] + bw[2];
  }
}

const cm = pm16.cellM;
const mkInst = (o) => Object.assign({ x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, fromClip: -1, fromFrame: 0, fromTMs: 0, fromW: 0, addPart: -1, addRx: 0, addRy: 0, addRz: 0, legs: null }, o);
const out = new Float64Array(16 * PART_STRIDE);
const pose = (pm, inst) => { computeVoxelPose(pm, inst, out); return Float64Array.from(FORWARD.subarray(0, pm.partCount * 12)); };
const footWorld = (F, k, inst) => { // world foot point of leg k from the part-to-world transform of its lower part
  const f = lr.lower[k] * 12, x = lr.geo[k * 12 + 11], y = quadruped16.legRig.legs[k].foot[1], z = quadruped16.legRig.legs[k].foot[2];
  return [F[f] * x + F[f + 1] * y + F[f + 2] * z + F[f + 9], F[f + 3] * x + F[f + 4] * y + F[f + 5] * z + F[f + 10], F[f + 6] * x + F[f + 7] * y + F[f + 8] * z + F[f + 11]];
};
const legPose = (w, bx, by, bz, targets) => { const L = new Float64Array(16); L[0] = w; L[1] = bx; L[2] = by; L[3] = bz; for (let i = 0; i < 12; i++) L[4 + i] = targets[i]; return L; };
// recover the rx (deg) of a part from its part-to-world matrix at yaw 0
const rxOf = (F, p) => Math.atan2(F[p * 12 + 7], F[p * 12 + 4]) / D2R;

const rest0 = pose(pm16, mkInst({}));
const OFFS = [[0, 1.6], [1, 1.2], [-1, 2.0], [0.5, 0.8]]; // (dy, dz) in cells, model frame
function targetsFor(yaw, bodyRx, bodyZ, offs) {
  const inst = mkInst({ yawDeg: yaw, x: 3, y: -2, z: 1 });
  const base = pose(pm16, inst); // rest foot world points
  const cy = Math.cos(yaw * D2R), sy = Math.sin(yaw * D2R), T = [];
  for (let k = 0; k < 4; k++) {
    const f = footWorld(base, k, inst), [dy, dz] = offs[k];
    T.push(f[0] - sy * dy * cm, f[1] + cy * dy * cm, f[2] + dz * cm); // (0,dy,dz) rotated by the yaw
  }
  void bodyRx; void bodyZ;
  return { inst, T };
}
let worstErr = 0, branchOk = true, limitsOk = true;
for (const yaw of [0, 37, 90, -123]) {
  for (const body of [[0, 0], [5, 0.3]]) {
    const { inst, T } = targetsFor(yaw, body[0], body[1], OFFS);
    // the target is fixed in the world, so the body pitch is compensated by the legs only if the foot is reachable
    inst.legs = legPose(1, body[0], 0, body[1], T);
    const F = pose(pm16, inst);
    for (let k = 0; k < 4; k++) {
      const f = footWorld(F, k, inst);
      worstErr = Math.max(worstErr, Math.hypot(f[0] - T[k * 3], f[1] - T[k * 3 + 1], f[2] - T[k * 3 + 2]) / cm);
    }
  }
}
// body pitch moves the hip along the world: the in-plane target stays reachable (checked by the error), not by an expectation of the angles
ok(`solve: posed foot hits a reachable target within 0.05 cell (worst ${worstErr.toFixed(4)})`, worstErr < 0.05);

// oracle: feed the solved angles (recovered from the posed matrices) to the preview FK; the matrices must agree for every part
{
  const { inst, T } = targetsFor(0, 0, 0, OFFS);
  inst.x = 0; inst.y = 0; inst.z = 0;
  const base = pose(pm16, inst);
  const T0 = [];
  for (let k = 0; k < 4; k++) { const f = footWorld(base, k, inst); T0.push(f[0], f[1] + OFFS[k][0] * cm, f[2] + OFFS[k][1] * cm); }
  void T;
  for (const body of [[0, 0], [6, 0.4]]) {
    inst.legs = legPose(1, body[0], 0, body[1], T0);
    const F = pose(pm16, inst);
    const frame = { body: { rot: [body[0], 0, 0], pos: [0, 0, body[1]] } };
    for (let k = 0; k < 4; k++) {
      const r1 = rxOf(F, lr.upper[k]) - body[0], r2 = rxOf(F, lr.lower[k]) - rxOf(F, lr.upper[k]);
      frame[names[lr.upper[k]]] = { rot: [r1, 0, 0] }; frame[names[lr.lower[k]]] = { rot: [r2, 0, 0] };
      const sigma = lr.geo[k * 12 + 10];
      if (!(sigma * r2 > 0)) branchOk = false;
      if (!(sigma * r2 >= -10 - 1e-9 && sigma * r2 <= 150 + 1e-9 && r1 >= -80 - 1e-9 && r1 <= 80 + 1e-9)) limitsOk = false;
    }
    const O = new Float64Array(16 * 12);
    oracleF(pm16, frame, O);
    let maxd = 0;
    for (let i = 0; i < pm16.partCount * 12; i++) maxd = Math.max(maxd, Math.abs(O[i] - F[i]));
    ok(`oracle: preview FK with the solved angles reproduces every part matrix (body ${body}, max diff ${maxd.toExponential(1)})`, maxd < 1e-9);
  }
}
ok('branch: solved knee bends the same way as the rest sign (sigma * r2 > 0)', branchOk);
ok('limits: sigma*r2 in [-10,150] deg, r1 in [-80,80] deg', limitsOk);
{ // a target far above the hip (D below reach) clamps the knee flexion to 150 deg
  const inst = mkInst({});
  const base = pose(pm16, inst), T = [];
  for (let k = 0; k < 4; k++) { const f = footWorld(base, k, inst); T.push(f[0], f[1], f[2] + 3.5 * cm); }
  inst.legs = legPose(1, 0, 0, 0, T);
  const F = pose(pm16, inst);
  const r2 = rxOf(F, lr.lower[0]) - rxOf(F, lr.upper[0]);
  ok(`limits: knee flexion clamps at 150 deg (got ${(lr.geo[10] * r2).toFixed(2)})`, Math.abs(lr.geo[10] * r2 - 150) < 1e-6);
  const Fh = pose(pm16, mkInst({ legs: legPose(1, 0, 0, 0, T.map((v, i) => (i % 3 === 2 ? v - 3.5 * cm + 6 * cm : v))) })); // out of reach: the clamp keeps it finite
  ok('out-of-reach target: finite pose', Fh.every(Number.isFinite));
}
{ // partial weight: w = 0.5 gives half of the solved upper rx (clip -1 = rest, rx 0), and the leg ry/rz/pos stay 0
  const { inst, T } = targetsFor(0, 0, 0, OFFS);
  inst.x = 0; inst.y = 0; inst.z = 0;
  const base = pose(pm16, inst), T0 = [];
  for (let k = 0; k < 4; k++) { const f = footWorld(base, k, inst); T0.push(f[0], f[1] + OFFS[k][0] * cm, f[2] + OFFS[k][1] * cm); }
  void T;
  inst.legs = legPose(1, 0, 0, 0, T0); const a = pose(pm16, inst);
  inst.legs = legPose(0.5, 0, 0, 0, T0); const b = pose(pm16, inst);
  ok('w = 0.5: upper rx is half of the w = 1 solve', Math.abs(rxOf(b, lr.upper[0]) - 0.5 * rxOf(a, lr.upper[0])) < 1e-9);
}

// ---------------------------------------------------------------- bit-identical when legs are null / w = 0 / no legRig
const same = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const garbage = legPose(0, 30, 20, 4, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
let allSame = true;
for (const pm of [pm16, packVoxelModel(quadruped12, () => 1)]) {
  const nClips = pm.clips.length;
  for (let c = -1; c < nClips; c++) {
    for (const yaw of [0, 33]) {
      const base = { clip: c, frame: c >= 0 ? 1 : 0, tMs: 20, yawDeg: yaw, x: 1, y: 2, z: 3 };
      const ref = pose(pm, mkInst({ ...base })); const refOut = Float64Array.from(out);
      const variants = [mkInst({ ...base, legs: null }), mkInst({ ...base, legs: garbage })];
      if (!pm.legRig) variants.push(mkInst({ ...base, legs: legPose(1, 30, 20, 4, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }));
      for (const v of variants) {
        const p2 = pose(pm, v);
        if (!same(ref, p2) || !same(refOut, out)) allSame = false;
      }
    }
  }
}
ok('bit-identical pose + FORWARD with legs null / w = 0 (garbage content) / model without legRig, every clip x yaw', allSame);
{ // untouched vs the pre-C-01 path: the rest pose of the 16 fixture equals itself with an explicit rest legs w=0 (sanity on `rest0`)
  ok('rest pose is stable', same(rest0, pose(pm16, mkInst({}))));
}

// ---------------------------------------------------------------- 0 alloc
{
  const { inst, T } = targetsFor(37, 0, 0, OFFS);
  inst.legs = legPose(0.8, 3, 0, 0.1, T);
  for (let i = 0; i < 2000; i++) computeVoxelPose(pm16, inst, out);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50000; i++) computeVoxelPose(pm16, inst, out);
  if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0;
  ok('0 alloc: 50000 solved poses leave the heap flat (< 100 KB)', dh < 1e5, dh + ' B');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
