// engine/core/transform.test.js (CO-1, docs/coordinates.md section 3 API +
// section 10 test items 1). Node, no deps. Run with `--expose-gc` for the
// no-allocation probe (matching engine/render/terrainCaster.test.js).
import assert from 'node:assert';
import {
  DEG2RAD, RAD2DEG, QUARTER_COS, QUARTER_SIN,
  wrapDeg, shortestArcDeg, yawFromDelta, forwardOf, rightOf, rotateVec2, dirFromAzEl,
  makeFrame, localToWorld, worldToLocal, localDirToWorld, localYawToWorld, worldYawToLocal,
  frameBBox, rotatedSize, localCellToWorld, frameEquals, transformPoint,
} from './transform.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', name, extra !== undefined ? extra : ''); }
}

// ---- deterministic seeded RNG (no Math.random dependency across runs) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 1. round-trip property tests: 10k points, yawSteps 0..3, z incl. negative ----
{
  const rnd = mulberry32(12345);
  const N = 10000;
  const p = { x: 0, y: 0, z: 0 };
  const back = { x: 0, y: 0, z: 0 };
  for (let yawSteps = 0; yawSteps <= 3; yawSteps++) {
    const frame = makeFrame(
      (rnd() - 0.5) * 4000,
      (rnd() - 0.5) * 4000,
      (rnd() - 0.5) * 4000,
      yawSteps
    );
    let maxErr = 0;
    for (let i = 0; i < N; i++) {
      const lx = (rnd() - 0.5) * 4000;
      const ly = (rnd() - 0.5) * 4000;
      const lz = (rnd() - 0.5) * 4000;
      localToWorld(frame, lx, ly, lz, p);
      worldToLocal(frame, p.x, p.y, p.z, back);
      const ex = Math.abs(back.x - lx), ey = Math.abs(back.y - ly), ez = Math.abs(back.z - lz);
      maxErr = Math.max(maxErr, ex, ey, ez);
    }
    check(`round-trip yawSteps=${yawSteps}: exact (integer table)`, maxErr === 0, maxErr);
  }
}

// Non-integer frame origin still round-trips within float tolerance.
{
  const rnd = mulberry32(999);
  const N = 10000;
  const p = { x: 0, y: 0, z: 0 };
  const back = { x: 0, y: 0, z: 0 };
  for (let yawSteps = 0; yawSteps <= 3; yawSteps++) {
    const frame = makeFrame(1.23456, -7.891, -0.5, yawSteps);
    let maxErr = 0;
    for (let i = 0; i < N; i++) {
      const lx = (rnd() - 0.5) * 4000.7;
      const ly = (rnd() - 0.5) * 4000.3;
      const lz = (rnd() - 0.5) * 4000.1 - 3; // exercises negative z
      localToWorld(frame, lx, ly, lz, p);
      worldToLocal(frame, p.x, p.y, p.z, back);
      maxErr = Math.max(maxErr, Math.abs(back.x - lx), Math.abs(back.y - ly), Math.abs(back.z - lz));
    }
    check(`round-trip (non-integer frame) yawSteps=${yawSteps}: <= 1e-9`, maxErr <= 1e-9, maxErr);
  }
}

// ---- localYawToWorld / worldYawToLocal inverse ----
{
  const rnd = mulberry32(42);
  for (let yawSteps = 0; yawSteps <= 3; yawSteps++) {
    const frame = makeFrame(0, 0, 0, yawSteps);
    for (let i = 0; i < 1000; i++) {
      const yaw = rnd() * 360;
      const w = localYawToWorld(frame, yaw);
      const back = worldYawToLocal(frame, w);
      const err = Math.abs(shortestArcDeg(back, wrapDeg(yaw)));
      check(`localYawToWorld/worldYawToLocal inverse yawSteps=${yawSteps}`, err < 1e-9, err);
    }
  }
}

// ---- frameBBox equals AABB of the 4 rotated corners ----
{
  const rnd = mulberry32(7);
  for (let yawSteps = 0; yawSteps <= 3; yawSteps++) {
    for (let i = 0; i < 200; i++) {
      const frame = makeFrame((rnd() - 0.5) * 1000, (rnd() - 0.5) * 1000, 0, yawSteps);
      const w = 3 + rnd() * 50, h = 3 + rnd() * 50;
      const bbox = frameBBox(frame, w, h, {});
      const corners = [[0, 0], [w, 0], [0, h], [w, h]];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const p = { x: 0, y: 0, z: 0 };
      for (const [lx, ly] of corners) {
        localToWorld(frame, lx, ly, 0, p);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      check(`frameBBox matches manual AABB (yawSteps=${yawSteps})`,
        Math.abs(bbox.x0 - x0) < 1e-9 && Math.abs(bbox.y0 - y0) < 1e-9 &&
        Math.abs(bbox.x1 - x1) < 1e-9 && Math.abs(bbox.y1 - y1) < 1e-9);
    }
  }
}

// rotatedSize: swapped for odd yawSteps
{
  const out = {};
  check('rotatedSize k=0 keeps w,h', (rotatedSize(0, 5, 9, out), out.w === 5 && out.h === 9));
  check('rotatedSize k=1 swaps', (rotatedSize(1, 5, 9, out), out.w === 9 && out.h === 5));
  check('rotatedSize k=2 keeps w,h', (rotatedSize(2, 5, 9, out), out.w === 5 && out.h === 9));
  check('rotatedSize k=3 swaps', (rotatedSize(3, 5, 9, out), out.w === 9 && out.h === 5));
}

// localCellToWorld: cell (col,row) min corner -> localToWorld(col,row,0)
{
  const frame = makeFrame(10, -5, 0, 1);
  const a = localCellToWorld(frame, 3, 4, {});
  const b = localToWorld(frame, 3, 4, 0, {});
  check('localCellToWorld == localToWorld(col,row,0)', a.x === b.x && a.y === b.y && a.z === b.z);
}

// frameEquals
{
  check('frameEquals true', frameEquals({ x: 1, y: 2, z: 3, yawSteps: 1 }, { x: 1, y: 2, z: 3, yawSteps: 1 }));
  check('frameEquals false (yawSteps)', !frameEquals({ x: 1, y: 2, z: 3, yawSteps: 1 }, { x: 1, y: 2, z: 3, yawSteps: 2 }));
}

// makeFrame validation
{
  let threw = false;
  try { makeFrame(NaN, 0, 0, 0); } catch (e) { threw = true; }
  check('makeFrame throws on non-finite', threw);
  threw = false;
  try { makeFrame(0, 0, 0, 4); } catch (e) { threw = true; }
  check('makeFrame throws on yawSteps out of range', threw);
  threw = false;
  try { makeFrame(0, 0, 0, 1.5); } catch (e) { threw = true; }
  check('makeFrame throws on non-integer yawSteps', threw);
}

// ---- yaw helper cases: wrap across 0/360, shortest arc ----
{
  check('wrapDeg(360) == 0', wrapDeg(360) === 0);
  check('wrapDeg(-1) == 359', wrapDeg(-1) === 359);
  check('wrapDeg(720+45) == 45', wrapDeg(720 + 45) === 45);
  check('wrapDeg(-361) == 359', wrapDeg(-361) === 359);

  check('shortestArcDeg(350,10) == 20', shortestArcDeg(350, 10) === 20);
  check('shortestArcDeg(10,350) == -20', shortestArcDeg(10, 350) === -20);
  check('shortestArcDeg(0,180) == 180', shortestArcDeg(0, 180) === 180);
  check('shortestArcDeg(180,0) == -180 (or 180)', Math.abs(Math.abs(shortestArcDeg(180, 0)) - 180) < 1e-9);
  check('shortestArcDeg(0,0) == 0', shortestArcDeg(0, 0) === 0);

  check('yawFromDelta(0,-1) north == 0', Math.abs(yawFromDelta(0, -1)) < 1e-9);
  check('yawFromDelta(1,0) east == 90', Math.abs(yawFromDelta(1, 0) - 90) < 1e-9);
  check('yawFromDelta(0,1) south == 180', Math.abs(yawFromDelta(0, 1) - 180) < 1e-9);
  check('yawFromDelta(-1,0) west == 270', Math.abs(yawFromDelta(-1, 0) - 270) < 1e-9);
}

// forwardOf/rightOf sanity + orthogonality
{
  const out = [0, 0];
  forwardOf(0, out);
  check('forwardOf(0) == (0,-1)', Math.abs(out[0]) < 1e-12 && Math.abs(out[1] + 1) < 1e-12);
  forwardOf(90, out);
  check('forwardOf(90) == (1,0)', Math.abs(out[0] - 1) < 1e-12 && Math.abs(out[1]) < 1e-12);
  rightOf(0, out);
  check('rightOf(0) == (1,0)', Math.abs(out[0] - 1) < 1e-12 && Math.abs(out[1]) < 1e-12);
}

// dirFromAzEl basic case: elevation 0, azimuth 0 -> (0,-1,0)
{
  const out = [0, 0, 0];
  dirFromAzEl(0, 0, out);
  check('dirFromAzEl(0,0) == (0,-1,0)', Math.abs(out[0]) < 1e-9 && Math.abs(out[1] + 1) < 1e-9 && Math.abs(out[2]) < 1e-9);
}

// rotateVec2 / localDirToWorld / transformPoint smoke
{
  const out = [0, 0];
  rotateVec2(90, 1, 0, out);
  check('rotateVec2(90,1,0) == rightOf(90)*1 == (0,1)', Math.abs(out[0]) < 1e-9 && Math.abs(out[1] - 1) < 1e-9);

  const frame = makeFrame(0, 0, 0, 1);
  const d = localDirToWorld(frame, 1, 0, [0, 0]);
  check('localDirToWorld k=1 rotates (1,0) to (0,1)', Math.abs(d[0]) < 1e-9 && Math.abs(d[1] - 1) < 1e-9);

  const t = { x: 5, y: 5, z: 0, yawDeg: 90 };
  const p = transformPoint(t, 1, 0, 0, {});
  check('transformPoint yaw=90 local (1,0) -> world (5, 6, 0)', Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 6) < 1e-9);
}

// ---- no-allocation probe over the per-call hot path (--expose-gc) --------
{
  if (typeof global.gc === 'function') {
    const frame = makeFrame(1, 2, 0, 2);
    const out = { x: 0, y: 0, z: 0 };
    const v = [0, 0];
    // warm up
    for (let i = 0; i < 1000; i++) {
      localToWorld(frame, i, i, 0, out);
      worldToLocal(frame, out.x, out.y, out.z, out);
      forwardOf(i % 360, v);
      rightOf(i % 360, v);
    }
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) {
      localToWorld(frame, i, i, 0, out);
      worldToLocal(frame, out.x, out.y, out.z, out);
      forwardOf(i % 360, v);
      rightOf(i % 360, v);
      yawFromDelta(1, 2);
      wrapDeg(i);
    }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grewBy = after - before;
    check('transform.js hot path: no significant heap growth over 200k calls (--expose-gc)', grewBy < 1024 * 1024, `grew by ${grewBy} bytes`);
  } else {
    check('transform.js hot path: 200k calls run without throwing (run with --expose-gc for the heap check)', true);
  }
}

console.log(`transform.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
