// engine/core/rtsCamera.test.js (RE-03, docs/architecture.md 28.1 "RE-03
// engine/core/rtsCamera.js"). Zero-allocation gate is hard: when
// `global.gc` is missing this file re-runs itself with `--expose-gc` (same
// pattern as engine/render/projection.pitched.test.js).
// Run: node engine/core/rtsCamera.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRtsCamera, update, zoomBy } from './rtsCamera.js';
import { createPitchedTerms, pitchedTerms, screenRay } from '../render/projection.js';
import { makeOk, approxEqual } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const GRID = { cols: 400, rows: 150 };
const BOUNDS = { x0: 0, y0: 0, x1: 200, y1: 150 };

// ---------------------------------------------------------------------------
// AC1: ground width across the screen 25-35 m at 400x150 over the zoom range.
// ---------------------------------------------------------------------------
{
  const terms = createPitchedTerms();
  const ray0 = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const ray1 = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  let worstLo = Infinity, worstHi = -Infinity;
  let allOk = true;

  for (let i = 0; i <= 10; i++) {
    const rts = createRtsCamera({ bounds: BOUNDS });
    const zoom = rts.opts.zoomMin + (rts.opts.zoomMax - rts.opts.zoomMin) * (i / 10);
    rts.zoom = zoom;
    const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
    update(rts, 1 / 60, {}, GRID, cam);

    pitchedTerms(cam, GRID, terms);
    screenRay(terms, 0, GRID.rows / 2, ray0);
    screenRay(terms, GRID.cols, GRID.rows / 2, ray1);
    // Intersect both rays with z = focusZ (flat heightFn => 0).
    const t0 = (rts.focusZ - ray0.oz) / ray0.dz;
    const t1 = (rts.focusZ - ray1.oz) / ray1.dz;
    const x0 = ray0.ox + t0 * ray0.dx, y0 = ray0.oy + t0 * ray0.dy;
    const x1 = ray1.ox + t1 * ray1.dx, y1 = ray1.oy + t1 * ray1.dy;
    const width = Math.hypot(x1 - x0, y1 - y0);
    worstLo = Math.min(worstLo, width);
    worstHi = Math.max(worstHi, width);
    if (width < 25 - 1e-6 || width > 35 + 1e-6) allOk = false;
  }
  ok('ground width at centre row stays within [25,35] m across the zoom range', allOk,
    `range=[${worstLo.toFixed(4)}, ${worstHi.toFixed(4)}]`);
}

// ---------------------------------------------------------------------------
// AC2: focus never leaves the map rect at any zoom, driven from all 4 edges.
// ---------------------------------------------------------------------------
{
  let allOk = true;
  const cases = [
    { left: true }, { right: true }, { up: true }, { down: true },
    { left: true, up: true }, { right: true, down: true },
  ];
  for (const input of cases) {
    for (const zoom0 of [0.9, 1.0, 1.15]) {
      const rts = createRtsCamera({ bounds: BOUNDS });
      rts.zoom = zoom0;
      const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
      for (let i = 0; i < 500; i++) update(rts, 1 / 60, input, GRID, cam);
      if (rts.focusX < BOUNDS.x0 - 1e-9 || rts.focusX > BOUNDS.x1 + 1e-9
        || rts.focusY < BOUNDS.y0 - 1e-9 || rts.focusY > BOUNDS.y1 + 1e-9) {
        allOk = false;
      }
    }
  }
  ok('focus stays inside bounds under sustained pan from every edge/corner', allOk);
}

// ---------------------------------------------------------------------------
// AC3: pan speed frame-rate independent (30 vs 144 Hz over the same elapsed
// wall time give the same result). Both the linear pan term
// (panSpeed*zoom*dt summed) and the per-step exponential z-smoothing are
// exact functions of elapsed time (not step count) for a constant target,
// so the tolerance can be tight - it only has to absorb float rounding from
// a different number of additions.
// ---------------------------------------------------------------------------
{
  const boundsWide = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }; // no clamping in this test
  const input = { right: true, up: true };
  const heightFn = () => 5;

  const rtsA = createRtsCamera({ bounds: boundsWide, heightFn });
  const camA = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  const stepsA = 300, dtA = 1 / 30;
  for (let i = 0; i < stepsA; i++) update(rtsA, dtA, input, GRID, camA);

  const rtsB = createRtsCamera({ bounds: boundsWide, heightFn });
  const camB = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  const stepsB = Math.round(stepsA * 4.8), dtB = 1 / 144; // same elapsed time (300/30 = 1440/144 = 10s)
  for (let i = 0; i < stepsB; i++) update(rtsB, dtB, input, GRID, camB);

  const dFocusX = Math.abs(rtsA.focusX - rtsB.focusX);
  const dFocusY = Math.abs(rtsA.focusY - rtsB.focusY);
  const dFocusZ = Math.abs(rtsA.focusZ - rtsB.focusZ);
  ok('pan (focusX/Y) matches within 1e-6 m at 30 Hz vs 144 Hz over equal elapsed time',
    dFocusX < 1e-6 && dFocusY < 1e-6, `dx=${dFocusX} dy=${dFocusY}`);
  ok('height-smoothed focusZ matches within 1e-6 m at 30 Hz vs 144 Hz over equal elapsed time',
    dFocusZ < 1e-6, `dz=${dFocusZ}`);
}

// ---------------------------------------------------------------------------
// AC4: zero allocation per update() (heap delta over many reused-object
// calls).
// ---------------------------------------------------------------------------
{
  const rts = createRtsCamera({ bounds: BOUNDS });
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  const input = {
    left: false, right: true, up: false, down: false,
    mouseX: 10, mouseY: 10, screenW: 800, screenH: 600,
    dragging: true, dragCol0: 100, dragRow0: 60, dragCol1: 105, dragRow1: 62,
    zoomDelta: 0,
  };
  // Warm up (JIT, hidden classes) before measuring.
  for (let i = 0; i < 2000; i++) update(rts, 1 / 60, input, GRID, cam);

  global.gc();
  const before = process.memoryUsage().heapUsed;
  const N = 20000;
  for (let i = 0; i < N; i++) update(rts, 1 / 60, input, GRID, cam);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const delta = after - before;
  ok(`zero alloc: heap delta over ${N} update() calls < 64 KB`, delta < 64 * 1024, `delta=${delta} bytes`);
}

// ---------------------------------------------------------------------------
// AC5 (RE-03 fixes item 2): drag-pan ground fidelity - the world point
// grabbed under the cursor when a drag starts stays under the cursor across
// 10 consecutive drag frames, within 1e-6 m. `dragCol0/Row0` is fed the
// PREVIOUS frame's cursor cell each frame (per the updated JSDoc), not the
// original drag-start cell.
// ---------------------------------------------------------------------------
{
  const terms = createPitchedTerms();
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const rts = createRtsCamera({ bounds: BOUNDS });
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  // Settle the camera pose with one no-input frame first.
  update(rts, 1 / 60, {}, GRID, cam);

  // Grab the ground point under the starting cursor cell.
  const col0 = 150, row0 = 80;
  pitchedTerms(cam, GRID, terms);
  screenRay(terms, col0, row0, ray);
  let t = (rts.focusZ - ray.oz) / ray.dz;
  const grabbedX = ray.ox + t * ray.dx, grabbedY = ray.oy + t * ray.dy;

  // Drag the cursor across 10 frames; each frame's dragCol0/Row0 is the
  // PREVIOUS frame's cursor cell (not the drag-start cell).
  let prevCol = col0, prevRow = row0;
  let worstErr = 0;
  for (let i = 1; i <= 10; i++) {
    const curCol = col0 + i * 3;
    const curRow = row0 - i * 2;
    const input = {
      dragging: true,
      dragCol0: prevCol, dragRow0: prevRow,
      dragCol1: curCol, dragRow1: curRow,
    };
    update(rts, 1 / 60, input, GRID, cam);

    // Re-derive the world point under the CURRENT cursor cell with the
    // post-update cam pose; it must still be the originally grabbed point.
    pitchedTerms(cam, GRID, terms);
    screenRay(terms, curCol, curRow, ray);
    t = (rts.focusZ - ray.oz) / ray.dz;
    const px = ray.ox + t * ray.dx, py = ray.oy + t * ray.dy;
    const err = Math.hypot(px - grabbedX, py - grabbedY);
    worstErr = Math.max(worstErr, err);

    prevCol = curCol; prevRow = curRow;
  }
  ok('drag-pan keeps the grabbed ground point under the cursor within 1e-6 m over 10 frames',
    worstErr < 1e-6, `worstErr=${worstErr}`);
}

// ---------------------------------------------------------------------------
// Sanity: zoomBy clamps to [zoomMin, zoomMax].
// ---------------------------------------------------------------------------
{
  const rts = createRtsCamera({ bounds: BOUNDS });
  zoomBy(rts, -10);
  ok('zoomBy clamps below zoomMin', approxEqual(rts.zoom, rts.opts.zoomMin, 1e-12), `zoom=${rts.zoom}`);
  zoomBy(rts, 10);
  ok('zoomBy clamps above zoomMax', approxEqual(rts.zoom, rts.opts.zoomMax, 1e-12), `zoom=${rts.zoom}`);
}

// ---------------------------------------------------------------------------
// RE-03 fixes: 10-frame drag keeps the grabbed ground point under the cursor;
// key pan honours yaw.
// ---------------------------------------------------------------------------
{
  const rts = createRtsCamera({ bounds: BOUNDS });
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  update(rts, 1 / 60, {}, GRID, cam);
  const terms = createPitchedTerms();
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const groundAt = (col, row) => {
    pitchedTerms(cam, GRID, terms);
    screenRay(terms, col, row, ray);
    const t = (rts.focusZ - ray.oz) / ray.dz;
    return [ray.ox + t * ray.dx, ray.oy + t * ray.dy];
  };
  let col = 200, row = 75;
  const grabbed = groundAt(col, row);
  let worst = 0;
  for (let i = 1; i <= 10; i++) {
    const nc = col + 3, nr = row + 1.5;
    update(rts, 1 / 60, { dragging: true, dragCol0: col, dragRow0: row, dragCol1: nc, dragRow1: nr }, GRID, cam);
    col = nc; row = nr;
    const g = groundAt(col, row);
    worst = Math.max(worst, Math.hypot(g[0] - grabbed[0], g[1] - grabbed[1]));
  }
  ok('10-frame drag keeps grabbed ground point under cursor (1e-6 m)', worst < 1e-6, `worst=${worst}`);
}
{
  const yaw = 90;
  const rts = createRtsCamera({ bounds: BOUNDS, yawDeg: yaw });
  const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
  const x0 = rts.focusX, y0 = rts.focusY;
  update(rts, 0.1, { right: true }, GRID, cam);
  // yaw 90: R = (0, 1) -> right moves +y.
  ok('yaw 90: right key pans along +y', Math.abs(rts.focusX - x0) < 1e-9 && rts.focusY - y0 > 0.1, `d=(${rts.focusX - x0}, ${rts.focusY - y0})`);
  const x1 = rts.focusX, y1 = rts.focusY;
  update(rts, 0.1, { up: true }, GRID, cam);
  // yaw 90: F = (1, 0) -> up moves +x.
  ok('yaw 90: up key pans along +x', rts.focusX - x1 > 0.1 && Math.abs(rts.focusY - y1) < 1e-9, `d=(${rts.focusX - x1}, ${rts.focusY - y1})`);
}

console.log(`rtsCamera.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL: ${f}`);
  process.exit(1);
}
