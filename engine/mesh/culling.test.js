// engine/mesh/culling.test.js (ME-02, docs/architecture.md 27.15.3 step 3).
// Zero-allocation gate is hard (27.15.0): when `global.gc` is missing this
// file re-runs itself with `--expose-gc`.
// Run: node engine/mesh/culling.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projTerms, shearProjection } from '../render/projection.js';
import { frustumPlanes, classifyAABB, CULL_IN, CULL_OUT, CULL_STRADDLE } from './culling.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(48120);

const GRID = { cols: 240, rows: 90 };

/** Builds frustum planes for a given camera pose. */
function planesFor(cam) {
  const terms = {};
  const M = new Float64Array(16);
  const planes = new Float64Array(24);
  projTerms(cam, GRID, terms);
  shearProjection(terms, M);
  frustumPlanes(M, planes);
  return { terms, M, planes };
}

const straightCam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 0 };
const { planes: straightPlanes } = planesFor(straightCam);
// yawDeg 0 -> dirX = sin(0) = 0, dirY = -cos(0) = -1: forward is -y.

// ---- inside: a small box straight ahead, well within near/far -------------
{
  const r = classifyAABB(straightPlanes, -1, -20, 0, 1, -18, 2);
  ok('box straight ahead within the frustum -> CULL_IN', r === CULL_IN, `got ${r}`);
}

// ---- outside: a box far behind the near plane never reaches it ------------
{
  // Straight ahead is -y; a box in +y (behind the eye) is outside every plane
  // that bounds the forward cone, in particular the near plane.
  const r = classifyAABB(straightPlanes, -1, 5, 0, 1, 10, 2);
  ok('box behind the camera plane -> CULL_OUT', r === CULL_OUT, `got ${r}`);
}

// ---- outside: a box far past the far plane -----------------------------
{
  const r = classifyAABB(straightPlanes, -1, -3000, 0, 1, -2500, 2);
  ok('box beyond the far plane -> CULL_OUT', r === CULL_OUT, `got ${r}`);
}

// ---- outside: a box far to one side (outside the left/right planes) -------
{
  const r = classifyAABB(straightPlanes, 500, -20, 0, 502, -18, 2);
  ok('box far to one side -> CULL_OUT', r === CULL_OUT, `got ${r}`);
}

// ---- straddling: a box crossing the near plane -----------------------------
{
  // Near plane is ~5 cm ahead of the eye (z = eyeZ here, forward -y): straddle
  // a box from well inside to just outside (+y side, behind the eye).
  const r = classifyAABB(straightPlanes, -1, -0.5, 0, 1, 0.5, 2);
  ok('box straddling the near plane -> CULL_STRADDLE', r === CULL_STRADDLE, `got ${r}`);
}

// ---- straddling: a box crossing a side plane -------------------------------
{
  // The frustum half-width at y = -20 (dist 20 m from the eye at yaw 0) is
  // ~20*tan(hfov/2); straddle it.
  const halfW = 20 * Math.tan((75 * Math.PI / 180) / 2);
  const r = classifyAABB(straightPlanes, halfW - 1, -20, 0, halfW + 1, -18, 2);
  ok('box straddling the right plane -> CULL_STRADDLE', r === CULL_STRADDLE, `got ${r}`);
}

// ---- containing the eye: a huge box around the camera is IN or STRADDLE ---
{
  const r = classifyAABB(straightPlanes, -50, -50, -50, 50, 50, 50);
  ok('a huge box containing the eye is not culled OUT', r !== CULL_OUT, `got ${r}`);
}

// ---- pitch extremes: +-35 deg, box straight ahead at eye height stays IN --
for (const pitchDeg of [-35, 35]) {
  const cam = { x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg };
  const { planes } = planesFor(cam);
  // A box centred on the view axis at the right depth for this pitch.
  const dist = 20;
  const pitchRad = pitchDeg * Math.PI / 180;
  const cz = cam.z + Math.tan(pitchRad) * dist;
  const r = classifyAABB(planes, -1, -dist - 1, cz - 1, 1, -dist + 1, cz + 1);
  ok(`pitch ${pitchDeg} deg: box on the view axis at the matching height -> not OUT`, r !== CULL_OUT, `got ${r}`);
  // Straight ahead at the ORIGINAL (unpitched) eye height is now off-axis;
  // pushed far enough away in y it eventually falls outside the top/bottom
  // planes - sanity that pitch actually changed the frustum (no camera
  // rotation of geometry: only the planes moved).
}
{
  // Pitching up should exclude a box that was dead-ahead at pitch 0 but far
  // below the new view axis (the frustum tilted, geometry did not).
  const { planes: up35 } = planesFor({ x: 0, y: 0, z: 1, yawDeg: 0, pitchDeg: 35 });
  const r = classifyAABB(up35, -1, -20, -5.5, 1, -20, -4.5); // well below the tilted-up view axis, far in front
  ok('pitch +35 deg excludes a box far below the tilted view axis', r === CULL_OUT, `got ${r}`);
}

// ---- property test: 2000 seeded boxes classified OUT -> 200 seeded points
// inside each never project (via the p/n-vertex test's own inside formula)
// into a visible plane-satisfying region. -------------------------------
{
  let outCount = 0, violations = 0;
  for (let i = 0; i < 2000; i++) {
    const cx = (rnd() - 0.5) * 4000, cy = (rnd() - 0.5) * 4000, cz = (rnd() - 0.5) * 200;
    const hx = 0.5 + rnd() * 5, hy = 0.5 + rnd() * 5, hz = 0.5 + rnd() * 5;
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const r = classifyAABB(straightPlanes, x0, y0, z0, x1, y1, z1);
    if (r !== CULL_OUT) continue;
    outCount++;
    for (let j = 0; j < 200; j++) {
      const px = x0 + rnd() * (x1 - x0);
      const py = y0 + rnd() * (y1 - y0);
      const pz = z0 + rnd() * (z1 - z0);
      let insideEvery = true;
      for (let p = 0; p < 6; p++) {
        const o = p * 4;
        const d = straightPlanes[o] * px + straightPlanes[o + 1] * py + straightPlanes[o + 2] * pz + straightPlanes[o + 3];
        if (d < 0) { insideEvery = false; break; }
      }
      if (insideEvery) violations++;
    }
  }
  ok(`property: ${outCount} seeded boxes classified OUT -> none of their 200 sampled points are inside every plane`, outCount > 0 && violations === 0, `${violations} violations over ${outCount} OUT boxes`);
}

// ---- zero allocation: 100k classifyAABB calls --------------------------
{
  const planes = straightPlanes;
  // Warm up.
  let sink = 0;
  for (let i = 0; i < 1000; i++) sink += classifyAABB(planes, -1, -20 - i * 0.001, 0, 1, -18 - i * 0.001, 2);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) sink += classifyAABB(planes, -1, -20, 0, 1, -18, 2);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('classifyAABB: no significant heap growth over 100k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

// ---- zero allocation: frustumPlanes (100k calls, reused out array) --------
{
  const { terms, M } = planesFor(straightCam);
  const out24 = new Float64Array(24);
  let sink = 0;
  for (let i = 0; i < 1000; i++) { frustumPlanes(M, out24); sink += out24[0]; }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { frustumPlanes(M, out24); sink += out24[0]; }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('frustumPlanes: no significant heap growth over 100k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink}, terms.cols=${terms.cols})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
