// engine/entities/animBlend.test.js - ANIM-BLEND-01b (architecture.md 38.68 section 3): the blender filling inst.layers.
//   node --expose-gc engine/entities/animBlend.test.js
import { allocProbe } from '../../tools/allocProbe.mjs';
import { validateVoxelModel } from '../voxel/VoxelModel.js';
import { packVoxelModel } from '../voxel/voxelPack.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
import { createAnimBlender } from './animBlend.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const loop2 = (dur, a, b) => ({ durations: [dur, dur], loop: true, frames: [
  { head: { rot: [a, 0, 0] }, body: { rot: [0, a / 2, 0], pos: [0, 0, a / 20] }, legFL: { rot: [a, 0, 0] } },
  { head: { rot: [b, 0, 0] }, body: { rot: [0, b / 2, 0], pos: [0, 0, b / 20] }, legFL: { rot: [b, 0, 0] } }] });
const d = JSON.parse(JSON.stringify(quadruped12));
d.animations = {
  idle: loop2(800, 0, 4), walk: loop2(500, -20, 20), run: loop2(250, -40, 40),
  attack: { durations: [100, 100, 200], loop: false, frames: [{ head: { rot: [0, 0, 0] } }, { head: { rot: [40, 0, 0] } }, { head: { rot: [10, 0, 0] } }] },
  hit: { durations: [60, 60, 180], loop: false, frames: [{ head: { rot: [0, 0, 0] } }, { head: { rot: [25, 0, 0] } }, { head: { rot: [0, 0, 0] } }] },
};
d.blend = { sets: { loco: { param: 'speed', clips: [{ clip: 'idle', at: 0 }, { clip: 'walk', at: 1 }, { clip: 'run', at: 3 }] } },
  fades: { default: 150, into: { attack: 80 }, pairs: { 'attack>walk': 200 } }, additive: { hit: { clip: 'hit', parts: ['head'], inMs: 40, outMs: 150, gain: 1 } } };
ok('test def validates', validateVoxelModel(d).errors.length === 0, validateVoxelModel(d).errors.join('|'));
const pm = packVoxelModel(d, () => 1);
const ci = pm.clipIndex, LOCO = -1; // request -(set 0 + 1)
const outB = new Float64Array(pm.partCount * 20 + 64);
const DT = 1000 / 60;

// ---- 0 alloc per update (runs first: after the other scenarios drive update() with polymorphic inputs the probe reads ~7 B/step from JIT tier state) (blender only; the layered pose is reported as info: 0 B/step too). ----
{
  const bl = createAnimBlender(4), s = bl.attach(pm), L = bl.layersOf(s);
  const inst = { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, layers: L };
  const drive = (i) => { bl.io[0] = (i % 200) < 100 ? LOCO : ci.attack; bl.io[1] = (i % 90) / 30; bl.io[2] = -1; bl.io[3] = i % 97 === 0 ? 0 : -1; bl.update(s, pm, DT); };
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) drive(i); }, { n: 200000 });
  if (r.skipped) console.log('SKIP alloc (no --expose-gc)');
  else {
    ok(`0 B/step blender update (switches + hits + speed ramp): ${r.perCall.toFixed(3)}`, r.perCall < 0.5);
    const rp = allocProbe((n) => { for (let i = 0; i < n; i++) { drive(i); computeVoxelPose(pm, inst, outB); } }, { n: 200000 });
    console.log(`  info: update + layered pose ${rp.perCall.toFixed(2)} B/step`);
  }
}

// world rotation of every part -> per-part angle between two consecutive poses (deg)
const poseOf = (L) => { computeVoxelPose(pm, { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1, layers: L }, outB); return Float64Array.from(FORWARD.subarray(0, pm.partCount * 12)); };
const angle = (a, b, p) => {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += a[p * 12 + i * 3 + j] * b[p * 12 + i * 3 + j];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
};
const maxStep = (a, b) => { let m = 0; for (let p = 0; p < pm.partCount; p++) m = Math.max(m, angle(a, b, p)); return m; };

// drives a scenario: script(frame) -> [req, speed, hit]; returns the max per-part rotation step between frames
function run(script, frames, ph = -1) {
  const bl = createAnimBlender(4), s = bl.attach(pm), L = bl.layersOf(s);
  let prev = null, mx = 0;
  for (let f = 0; f < frames; f++) {
    const [req, speed, hit] = script(f);
    bl.io[0] = req; bl.io[1] = speed; bl.io[2] = ph; bl.io[3] = hit === undefined ? -1 : hit; bl.io[4] = 1;
    bl.update(s, pm, DT);
    const cur = poseOf(L);
    if (prev && f > 1) mx = Math.max(mx, maxStep(prev, cur));
    prev = cur;
  }
  return mx;
}

// ---- no pop: baseline = largest in-clip step with no state change; changes must stay within it + 1 deg ----
const base = Math.max(run(() => [LOCO, 0], 200), run(() => [LOCO, 1], 200), run(() => [LOCO, 3.5], 200), run(() => [ci.attack, 0], 20));
ok(`baseline in-clip step ${base.toFixed(2)} deg`, base > 0.1);
const lim = base + 1;
const sw = (reqs) => (f) => [reqs[Math.min(reqs.length - 1, Math.floor(f / 40))], 1, undefined];
for (const [name, seq] of [['loco->attack', [LOCO, ci.attack]], ['attack->loco', [ci.attack, LOCO]], ['attack->walk (pair fade)', [ci.attack, ci.walk]],
  ['walk->run->idle clips', [ci.walk, ci.run, ci.idle]], ['loco->attack->loco->attack', [LOCO, ci.attack, LOCO, ci.attack]]]) {
  const m = run(sw(seq), 40 * seq.length);
  ok(`no pop ${name}: max step ${m.toFixed(2)} <= ${lim.toFixed(2)}`, m <= lim);
}
const midFade = run((f) => [f < 40 ? ci.walk : f < 46 ? ci.run : ci.idle, 1, undefined], 120);
ok(`no pop on a change during a fade: ${midFade.toFixed(2)} <= ${lim.toFixed(2)}`, midFade <= lim);
const ramp = (f) => [LOCO, f < 120 ? f / 30 : (240 - f) / 30, undefined];
const rampStep = run(ramp, 240);
ok(`speed ramp 0->4->0 has no pop: ${rampStep.toFixed(2)}`, rampStep <= lim);

// ---- parameter blend: monotone w2, one shared phase, stride ----
{
  const bl = createAnimBlender(2), s = bl.attach(pm), L = bl.layersOf(s);
  let last = -1, mono = true, first = -1, end = -1;
  for (let k = 0; k <= 20; k++) {
    const sp = 1 + (k / 20) * 2;
    bl.reset(s, LOCO); bl.io[0] = LOCO; bl.io[1] = sp; bl.io[2] = 0; bl.io[3] = -1; bl.io[4] = 1; bl.update(s, pm, 0);
    const w = L[1] === ci.run ? 1 : L[4] === ci.run ? L[7] : 0; // 3 m/s: the run clip alone
    if (w < last - 1e-12) mono = false;
    if (k === 0) first = w;
    end = w; last = w;
  }
  ok('walk->run w2 monotone over speed 1..3, 0 at walk speed, 1 at run speed', mono && first === 0 && end === 1, `${first} ${end}`);
  bl.reset(s, LOCO); bl.io[0] = LOCO; bl.io[1] = 2; bl.io[2] = 0.3; bl.io[3] = -1; bl.update(s, pm, 0);
  const posA = (L[2] * 500 + L[3]) / 1000, posB = (L[5] * 250 + L[6]) / 500; // walk / run: 2 equal keys
  ok('set clips are sampled at the same phase01', L[1] === ci.walk && L[4] === ci.run && Math.abs(posA - 0.3) < 1e-9 && Math.abs(posB - 0.3) < 1e-9, `${posA} ${posB}`);
  ok('w2 = smoothstep(0.5) = 0.5 at speed 2', Math.abs(L[7] - 0.5) < 1e-12);
  const adv = (sp) => { bl.reset(s, LOCO); bl.io[2] = -1; bl.io[1] = sp; for (let i = 0; i < 30; i++) bl.update(s, pm, DT); return L[2] * 500 + L[3]; };
  ok('self-advance: phase rate follows speed (clamped)', adv(1.4) !== adv(1.0));
  // external phase from the leg driver while its legs are active; stride handed back via driverIo[11]
  const drv = new Float64Array(16); drv[8] = 0.25; drv[10] = 1;
  bl.reset(s, LOCO); bl.io[1] = 1; bl.io[2] = -1; bl.update(s, pm, DT, drv);
  ok('driver phase 0.25 used while legs active', Math.abs((L[2] * 500 + L[3]) / 1000 - 0.25) < 1e-9);
  ok('stride -> driverIo[11] = at * T = 1 m/s * 1.0 s', Math.abs(drv[11] - 1.0) < 1e-9, String(drv[11]));
  drv[10] = 0; drv[11] = -1; bl.update(s, pm, DT, drv);
  ok('stride published when legs inactive; io[5]/io[6] outputs', drv[11] > 0 && bl.io[5] === drv[11] && bl.io[6] === ci.walk);
}

// ---- fade table ----
{
  const bl = createAnimBlender(2), s = bl.attach(pm), L = bl.layersOf(s);
  const fadeLen = (from, to) => {
    bl.reset(s, from); bl.io[0] = to; bl.io[1] = 1; bl.io[2] = -1; bl.io[3] = -1;
    let n = 0; bl.update(s, pm, 0);
    while (L[15] > 0 && n < 1000) { bl.update(s, pm, 1); n++; }
    return n;
  };
  ok('fade table: into[attack] = 80 ms', Math.abs(fadeLen(ci.walk, ci.attack) - 80) <= 2, String(fadeLen(ci.walk, ci.attack)));
  ok('fade table: pair attack>walk = 200 ms', Math.abs(fadeLen(ci.attack, ci.walk) - 200) <= 2, String(fadeLen(ci.attack, ci.walk)));
  ok('fade table: default 150 ms', Math.abs(fadeLen(ci.walk, ci.run) - 150) <= 2, String(fadeLen(ci.walk, ci.run)));
}

// ---- additive: starts at 0, peaks at gain, decays to exactly 0 and clears ----
{
  const bl = createAnimBlender(2), s = bl.attach(pm), L = bl.layersOf(s);
  bl.io[0] = LOCO; bl.io[1] = 1; bl.io[2] = -1; bl.io[3] = 0; bl.update(s, pm, 0);
  bl.io[3] = -1;
  const ws = [L[19]];
  for (let i = 0; i < 40; i++) { bl.update(s, pm, 10); ws.push(L[19]); }
  const peak = Math.max(...ws), end = ws[ws.length - 1];
  ok('additive: rises from 0 to gain 1', ws[0] === 0 && Math.abs(peak - 1) < 1e-9, `${ws[0]} ${peak}`);
  ok('additive: decays to exactly 0 and the layer clears', end === 0 && L[16] === -1);
  let monoDown = true; const ip = ws.indexOf(peak);
  for (let i = ip + 1; i < ws.length; i++) if (ws[i] > ws[i - 1] + 1e-12) monoDown = false;
  ok('additive: monotone decay after the peak', monoDown);
  const hm = run((f) => [LOCO, 1, f === 30 ? 0 : -1], 120);
  ok(`additive hit keeps the pose continuous: ${hm.toFixed(2)} <= ${lim.toFixed(2)}`, hm <= lim);
}

// ---- null blender: layers null / no layers = the clip path (byte-identical) ----
{
  const a = poseOf(null);
  computeVoxelPose(pm, { x: 0, y: 0, z: 0, yawDeg: 0, clip: -1, frame: 0, tMs: 0, scale: 1 }, outB);
  const b2 = Float64Array.from(FORWARD.subarray(0, pm.partCount * 12));
  ok('layers null is byte-identical to no layers', a.every((v, i) => Object.is(v, b2[i])));
  const bl = createAnimBlender(1), s = bl.attach(pm);
  ok('attach: full -> -1, release frees', bl.attach(pm) === -1 && (bl.release(s), bl.layersOf(s)[0] === 0 && bl.attach(pm) === 0));
}

// ---- determinism ----
{
  const sc = (f) => [f % 70 < 30 ? LOCO : ci.attack, (f % 90) / 30, f % 53 === 0 ? 0 : -1];
  const rec = () => {
    const bl = createAnimBlender(2), s = bl.attach(pm), L = bl.layersOf(s), o = [];
    for (let f = 0; f < 300; f++) { const [r, sp, h] = sc(f); bl.io[0] = r; bl.io[1] = sp; bl.io[2] = -1; bl.io[3] = h; bl.update(s, pm, DT); for (let i = 0; i < 20; i++) o.push(L[i]); }
    return o;
  };
  const x = rec(), y = rec();
  ok('deterministic: two runs identical', x.every((v, i) => Object.is(v, y[i])));
}

console.log(`animBlend: ${pass} pass, ${fail} fail`);
for (const m of failures) console.log('  FAIL ' + m);
process.exit(fail ? 1 : 0);
