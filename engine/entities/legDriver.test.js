// engine/entities/legDriver.test.js - ANIM-C-02 (architecture.md 38.67 section 3 driver): flat-ground leg planner.
// Foot slide over stance, stride reach, query count, determinism, stand mode, reset, w fades, LOD cap, 0 alloc.
// Run: node --expose-gc engine/entities/legDriver.test.js
import { packVoxelModel } from '../voxel/voxelPack.js';
import quadruped16 from '../voxel/fixtures/quadruped16.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { createLegDriver, SOLVE_MAX } from './legDriver.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const pm = packVoxelModel(quadruped16, () => 1);
const IDLE = 0, WALK = 1, DT = 1000 / 60;
const flat = { n: 0, groundAt() { this.n++; return 0; } };
const lr = pm.legRig, GAIT = lr.gait, duty = GAIT[1], tuned = GAIT[0];
const zOff = (lr.geo[1] + lr.geo[3] + lr.geo[5] - pm.anchor[2]) * pm.cellM;
const restOf = (k) => [(lr.geo[k * 12 + 11] - pm.anchor[0]) * pm.cellM, (lr.geo[k * 12] + lr.geo[k * 12 + 2] + lr.geo[k * 12 + 4] - pm.anchor[1]) * pm.cellM];

function setIo(d, x, y, z, yaw, cx = 0, cy = 0) { const io = d.io; io[0] = x; io[1] = y; io[2] = z; io[3] = yaw; io[4] = DT; io[5] = cx; io[6] = cy; }

/** Walks the root along its heading at mult * tuned m/s for secs; returns slide / reach / lift metrics of the foot targets. */
function walk(mult, secs, yaw = 0) {
  const d = createLegDriver(4), s = d.attach(pm), pose = d.poseOf(s);
  flat.n = 0;
  const yr = yaw * Math.PI / 180, cs = Math.cos(yr), sn = Math.sin(yr);
  const v = mult * tuned, fx = -sn, fy = cs;
  let x = 5, y = 5, maxSlide = 0, maxOff = 0, maxZ = -1, finite = true, hash = 0;
  const sx = [0, 0, 0, 0], sy = [0, 0, 0, 0], inSt = [false, false, false, false];
  const N = Math.round(secs * 60);
  for (let f = 0; f < N; f++) {
    x += fx * v / 60; y += fy * v / 60;
    setIo(d, x, y, 0, yaw); d.update(s, pm, WALK, flat);
    const Phi = d.io[8];
    for (let k = 0; k < 4; k++) {
      const T = 4 + k * 3, px = pose[T], py = pose[T + 1], pz = pose[T + 2];
      if (!Number.isFinite(px + py + pz)) finite = false;
      hash = (hash * 31 + Math.round(px * 1e6) + Math.round(py * 1e6) * 7 + Math.round(pz * 1e6) * 13) % 1e9;
      if (f < 120) continue; // warm-up: EMA + first strides
      let phi = Phi - GAIT[4 + k]; phi -= Math.floor(phi);
      if (phi < duty) {
        if (!inSt[k]) { inSt[k] = true; sx[k] = px; sy[k] = py; }
        maxSlide = Math.max(maxSlide, Math.hypot(px - sx[k], py - sy[k]));
        const [mx, my] = restOf(k);
        maxOff = Math.max(maxOff, Math.hypot(px - (x + cs * mx - sn * my), py - (y + sn * mx + cs * my)));
      } else inSt[k] = false;
      maxZ = Math.max(maxZ, pz - zOff);
    }
  }
  return { d, s, pose, maxSlide, maxOff, maxZ, finite, hash, queries: flat.n };
}

// ---- foot slide over stance, 0.5x / 1x / 1.5x tuned speed
for (const m of [0.5, 1, 1.5]) {
  const r = walk(m, 8);
  ok(`slide <= 12 mm at ${m}x tuned`, r.maxSlide <= 0.012, (r.maxSlide * 1000).toFixed(3) + ' mm');
  ok(`reach: stance foot within ~half a stride of rest at ${m}x`, r.maxOff <= 0.7 * tuned * GAIT[3] * 1.3 + 0.01, r.maxOff.toFixed(3));
  ok(`finite targets at ${m}x`, r.finite);
  ok(`swing lift <= liftM + 1 mm at ${m}x`, r.maxZ <= GAIT[2] + 0.001 && r.maxZ > 0.5 * GAIT[2], r.maxZ.toFixed(4));
  const stride = tuned * GAIT[3] * Math.min(1.25, Math.max(0.8, Math.sqrt(m)));
  const strides = 8 * m * tuned / stride;
  const per = (r.queries - 4) / (4 * strides);
  ok(`about 2 groundAt per foot per stride at ${m}x`, per > 1.6 && per < 2.4, per.toFixed(2));
}
{
  const r = walk(1, 6, 37);
  ok('slide <= 12 mm at yaw 37', r.maxSlide <= 0.012, (r.maxSlide * 1000).toFixed(3));
}

// ---- determinism
{
  const a = walk(1, 5), b = walk(1, 5);
  ok('same inputs -> same LegPose stream (hash)', a.hash === b.hash && a.hash !== 0, a.hash + ' vs ' + b.hash);
  ok('pose arrays bit-equal at the end', a.pose.every((v, i) => Object.is(v, b.pose[i])));
}

// ---- stand mode, reset, teleport, w fades, flat fallback
{
  const d = createLegDriver(4), s = d.attach(pm), pose = d.poseOf(s);
  flat.n = 0;
  setIo(d, 3, 4, 0, 0); d.update(s, pm, IDLE, flat);
  ok('reset: 4 queries once', flat.n === 4, flat.n);
  const w1 = pose[0];
  ok('w ramps up (one frame ~ 1/9 of the 150 ms fade)', w1 > 0.05 && w1 < 0.2, w1);
  const t0 = Array.from(pose.subarray(4, 16));
  for (let i = 0; i < 120; i++) { setIo(d, 3, 4, 0, 0); d.update(s, pm, IDLE, flat); }
  ok('stand: feet stay planted, no queries', flat.n === 4 && t0.every((v, i) => v === pose[4 + i]), flat.n);
  ok('w reaches 1 on a stand clip', pose[0] === 1, pose[0]);
  const [mx0, my0] = restOf(0);
  ok('stand target = rest point + foot height', Math.abs(pose[4] - (3 + mx0)) < 1e-12 && Math.abs(pose[5] - (4 + my0)) < 1e-12 && Math.abs(pose[6] - zOff) < 1e-12, [pose[4], pose[5], pose[6]].join());
  for (let i = 0; i < 240; i++) { setIo(d, 3, 4 + 0.4 * (i + 1) / 240, 0, 0); d.update(s, pm, IDLE, flat); }
  ok('stand: feet step toward rest after the body drifts', Math.abs(pose[5] - (4.4 + my0)) <= 0.16, pose[5]);
  flat.n = 0; setIo(d, 20, 20, 0, 0); d.update(s, pm, IDLE, flat);
  ok('teleport > 1.5 m resets (4 queries, feet at the new rest points)', flat.n === 4 && Math.abs(pose[5] - (20 + my0)) < 1e-9, flat.n + ' ' + pose[5]);
  for (let i = 0; i < 12; i++) { setIo(d, 20, 20, 0, 0); d.update(s, pm, 99, flat); }
  ok('w fades to 0 on an unlisted clip (150 ms)', pose[0] === 0 && d.io[10] === 0, pose[0]);
  const q = flat.n;
  for (let i = 0; i < 30; i++) { setIo(d, 20, 20, 0, 0); d.update(s, pm, 99, flat); }
  ok('no queries while off', flat.n === q);
  setIo(d, 20, 20, 0, 0); d.update(s, pm, IDLE, flat);
  ok('re-plants when it turns on again (4 queries)', flat.n === q + 4, "got " + (flat.n - q));
  const odd = { n: 0, groundAt() { this.n++; return 5; } };
  const d3 = createLegDriver(1), s3 = d3.attach(pm);
  setIo(d3, 0, 0, 0, 0); d3.update(s3, pm, IDLE, odd);
  ok('flat fallback: 1 query, feet at root z', odd.n === 1 && Math.abs(d3.poseOf(s3)[6] - zOff) < 1e-12 && Math.abs(d3.poseOf(s3)[15] - zOff) < 1e-12, odd.n);
  const d4 = createLegDriver(1), s4 = d4.attach(pm);
  setIo(d4, 0, 0, 1, 0); d4.update(s4, pm, IDLE, null);
  ok('null ground works', Number.isFinite(d4.poseOf(s4)[6]));
}

// ---- ANIM-C-03: slopes. Model front (nose) = smaller model y (head at y0), world +y at yaw 180; rx+ = nose down. (The driver moves toward model +y, so this fixture walks tail first; pitch is pure geometry and unaffected.)
{
  const cm = pm.cellM, geo = lr.geo, anc = pm.anchor;
  const my = (k) => (geo[k * 12] + geo[k * 12 + 2] + geo[k * 12 + 4] - anc[1]) * cm;
  const lfh = (my(2) + my(3) - my(0) - my(1)) / 2;
  const T20 = Math.tan(20 * Math.PI / 180);
  const hill = { n: 0, groundAt(x, y) { this.n++; return y * T20; } }; // rises toward world +y = the nose at yaw 180
  const runSlope = (g, steps, dir) => {
    const d = createLegDriver(2), s = d.attach(pm), pose = d.poseOf(s);
    let y = 5, maxFootErr = 0, minPit = 99, maxPit = -99, finite = true, maxSlide = 0;
    const sy = [0, 0, 0, 0], sx = [0, 0, 0, 0], inSt = [false, false, false, false];
    for (let f = 0; f < steps; f++) {
      y += dir * tuned / 60;
      setIo(d, 5, y, g.groundAt(5, y), 180); d.update(s, pm, WALK, g);
      if (!pose.every(Number.isFinite)) finite = false;
      if (f < 120) continue;
      minPit = Math.min(minPit, pose[1]); maxPit = Math.max(maxPit, pose[1]);
      const Phi = d.io[8];
      for (let k = 0; k < 4; k++) {
        let phi = Phi - GAIT[4 + k]; phi -= Math.floor(phi);
        if (phi >= duty) { inSt[k] = false; continue; }
        const T = 4 + k * 3;
        maxFootErr = Math.max(maxFootErr, Math.abs(pose[T + 2] - zOff - g.groundAt(pose[T], pose[T + 1])));
        if (!inSt[k]) { inSt[k] = true; sx[k] = pose[T]; sy[k] = pose[T + 1]; }
        maxSlide = Math.max(maxSlide, Math.hypot(pose[T] - sx[k], pose[T + 1] - sy[k]));
      }
    }
    return { pose, maxFootErr, minPit, maxPit, finite, maxSlide, d };
  };
  const up = runSlope(hill, 480, -1); // walking toward -y = uphill
  ok('20 deg slope: pitch settles at -20 deg (nose up, clamp 20), within 1.5 deg', up.minPit > -21 && up.maxPit < -18.5, up.minPit.toFixed(2) + ' .. ' + up.maxPit.toFixed(2));
  ok('20 deg slope: stance feet on the ground within 1 cm', up.maxFootErr < 0.01, (up.maxFootErr * 1000).toFixed(2) + ' mm');
  ok('20 deg slope: stance slide <= 12 mm', up.maxSlide <= 0.012, (up.maxSlide * 1000).toFixed(2) + ' mm');
  ok('20 deg slope: finite, roll ~ 0, drop small', up.finite && Math.abs(up.pose[2]) < 0.5 && Math.abs(up.pose[3] * cm) < 0.03, up.pose[2] + ' ' + up.pose[3] * cm);
  const down = runSlope({ n: 0, groundAt(x, y) { return -y * T20; } }, 480, -1); // falls toward the nose
  ok('downhill: nose down +, near +20 deg', down.maxPit > 18.5 && down.minPit > 0 && down.finite, down.minPit.toFixed(2) + ' .. ' + down.maxPit.toFixed(2));
  ok('slope walk is deterministic (bit-equal LegPose)', Array.from(runSlope(hill, 300, -1).pose).every((v, i) => Object.is(v, runSlope(hill, 300, -1).pose[i])));

  // cross slope: ground rises toward +x (right) -> body leans left (ry < 0), roll clamp 8 deg
  const side = { n: 0, groundAt(x, y) { return (x - 5) * 0.1; } };
  { const d = createLegDriver(1), s = d.attach(pm); for (let i = 0; i < 90; i++) { setIo(d, 5, 5, 0, 0); d.update(s, pm, IDLE, side); }
    const r = d.poseOf(s)[2]; const wd = (-(geo[11] - anc[0]) + (geo[23] - anc[0])) * cm; // leg0 is left (smaller x)
    ok('cross slope: roll tilts the top away from the high side, within clamp', r < -1 && r >= -lr.maxRoll - 1e-9, r); void wd; }

  // step: fore pair on a 0.24 m step, hind pair on the flat, stationary -> pitch clamps at 20 deg, body drops
  { const stepH = 0.24, edge = (my(0) + my(2)) / 2 + 5; // between fore (smaller y) and hind rest feet
    const g = { n: 0, groundAt(x, y) { return y < edge ? stepH : 0; } };
    const d = createLegDriver(1), s = d.attach(pm), p = d.poseOf(s);
    let prev = 0, monotone = true;
    for (let i = 0; i < 180; i++) { setIo(d, 5, 5, 0, 0); d.update(s, pm, IDLE, g); if (i > 0 && p[1] > prev + 1e-9) monotone = false; prev = p[1]; }
    const wantPit = -Math.min(20, Math.atan2(stepH, lfh) * 180 / Math.PI);
    ok('step: pitch = clamp(-atan(h / L)) within 0.5 deg, no overshoot', Math.abs(p[1] - wantPit) < 0.5 && monotone, p[1].toFixed(3) + ' want ' + wantPit.toFixed(3));
    // expected drop: lowest foot below the tilted plane
    const tp = Math.tan(p[1] * Math.PI / 180); let low = 0;
    for (let k = 0; k < 4; k++) { const gk = k < 2 ? stepH : 0; const rk = gk - tp * my(k); if (rk < low) low = rk; }
    ok('step: drop matches the lowest foot below the plane (+-1 cm), clamped >= -0.35 leg', Math.abs(p[3] * cm - low) < 0.01 && p[3] * cm >= -0.35 * (lr.geo[6] + lr.geo[7]) * cm - 1e-9, (p[3] * cm).toFixed(4) + ' vs ' + low.toFixed(4));
    ok('step: feet planted on their own height', Math.abs(p[6] - zOff - stepH) < 1e-9 && Math.abs(p[12] - zOff) < 1e-9, p[6] + ' ' + p[12]);
  }
  // flat fallback: ground missing -> tilt eases to 0
  { const d = createLegDriver(1), s = d.attach(pm); for (let i = 0; i < 60; i++) { setIo(d, 5, 5, 5 * T20, 180); d.update(s, pm, IDLE, hill); }
    const before = d.poseOf(s)[1];
    for (let i = 0; i < 1; i++) { setIo(d, 5, 5, 5 * T20, 180); d.update(s, pm, IDLE, null); }
    d.reset(s); for (let i = 0; i < 60; i++) { setIo(d, 5, 5, 5 * T20, 180); d.update(s, pm, IDLE, null); }
    ok('flat fallback: missing ground -> level body', Math.abs(before) > 5 && Math.abs(d.poseOf(s)[1]) < 1e-6 && Math.abs(d.poseOf(s)[3]) < 1e-9, before + ' -> ' + d.poseOf(s)[1]); }
}

// ---- attach / release / no legRig
{
  const d = createLegDriver(2);
  ok('attach without legRig -> -1', d.attach(packVoxelModel(quadruped12, () => 1)) === -1);
  const a = d.attach(pm), b = d.attach(pm);
  ok('attach fills slots then -1', a === 0 && b === 1 && d.attach(pm) === -1);
  d.release(a);
  ok('release frees a slot', d.attach(pm) === 0);
}

// ---- LOD cap: 20 animals, 16 solved; far ones off
{
  const d = createLegDriver(48), slots = [];
  for (let i = 0; i < 20; i++) slots.push(d.attach(pm));
  for (let f = 0; f < 30; f++) for (let i = 0; i < 20; i++) { setIo(d, 10 + i, 0, 0, 0); d.update(slots[i], pm, IDLE, flat); }
  let on = 0, nearOn = true;
  for (let i = 0; i < 20; i++) { const w = d.poseOf(slots[i])[0]; if (w > 0) on++; if (i < SOLVE_MAX && w !== 1) nearOn = false; }
  ok('LOD: nearest 16 solved, the rest off', on === SOLVE_MAX && nearOn, on);
  const far = d.attach(pm); setIo(d, 100, 0, 0, 0); for (let f = 0; f < 20; f++) d.update(far, pm, IDLE, flat);
  ok('LOD: beyond 35 m off', d.poseOf(far)[0] === 0);
}

// ---- 0 alloc after warm-up
{
  const d = createLegDriver(48), slots = [];
  for (let i = 0; i < 16; i++) slots.push(d.attach(pm));
  let t = 0;
  const run = (n) => {
    for (let f = 0; f < n; f++) {
      t += 1 / 60;
      for (let i = 0; i < 16; i++) { setIo(d, i * 2, t * (1 + (i % 3) * 0.3), 0, (i * 20 + t * 5) % 360, 0, 0); d.update(slots[i], pm, i % 5 === 0 ? IDLE : WALK, flat); }
    }
  };
  run(3000); // warm-up past JIT tier-up (a one-off ~100 KB compile cost otherwise lands in the window)
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  run(5000);
  if (global.gc) global.gc();
  const dh = process.memoryUsage().heapUsed - h0;
  ok('0 alloc: 80000 animal updates leave the heap flat (< 100 KB)', dh < 1e5, dh + ' B');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
