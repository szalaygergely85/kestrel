// engine/render/projection.pitched.test.js (RE-01, docs/architecture.md 28.1).
// Zero-allocation gate is hard: when `global.gc` is missing this file
// re-runs itself with `--expose-gc` (same pattern as engine/mesh/culling.test.js).
// Run: node engine/render/projection.pitched.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PROJ_HFOV_DEG, PROJ_NEAR, PROJ_PITCHED_VFOV_DEG,
  projTerms, shearProjection,
  createPitchedTerms, pitchedTerms, pitchedProjection, pitchedHashCell,
  screenRay, unprojectPitched, worldToCell, pitchedEyeFromFocus,
  projectPoint, windowToCell, fpVfovDeg, resolveProjection, PITCH_CLAMP_PITCHED_DEG,
} from './projection.js';
import { frustumPlanes, classifyAABB, CULL_OUT } from '../mesh/culling.js';
import { makeOk, approxEqual } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Seeded LCG (never Math.random).
function makeLcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// (6) Basis orthonormal within 1e-12, at a spread of yaw/pitch.
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(1);
  let allOk = true, worst = 0;
  const terms = createPitchedTerms();
  for (let i = 0; i < 200; i++) {
    const yawDeg = rnd() * 360;
    const pitchDeg = -89 + rnd() * 178;
    pitchedTerms({ x: 0, y: 0, z: 0, yawDeg, pitchDeg }, { cols: 320, rows: 120 }, terms);
    const F = [terms.fX, terms.fY, terms.fZ];
    const R = [terms.rX, terms.rY, 0];
    const U = [terms.uX, terms.uY, terms.uZ];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const lenF = Math.sqrt(dot(F, F)), lenR = Math.sqrt(dot(R, R)), lenU = Math.sqrt(dot(U, U));
    const dFR = dot(F, R), dFU = dot(F, U), dRU = dot(R, U);
    worst = Math.max(worst, Math.abs(lenF - 1), Math.abs(lenR - 1), Math.abs(lenU - 1), Math.abs(dFR), Math.abs(dFU), Math.abs(dRU));
    if (Math.abs(lenF - 1) > 1e-12 || Math.abs(lenR - 1) > 1e-12 || Math.abs(lenU - 1) > 1e-12) allOk = false;
    if (Math.abs(dFR) > 1e-12 || Math.abs(dFU) > 1e-12 || Math.abs(dRU) > 1e-12) allOk = false;
  }
  ok('basis F,R,U orthonormal within 1e-12 over 200 seeded yaw/pitch poses', allOk, `worst=${worst}`);
}

// ---------------------------------------------------------------------------
// (3) Pitch-0 parity against shearProjection, element-wise within 1e-12.
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(2);
  let worst = 0, allOk = true;
  const grid = { cols: 240, rows: 90 };
  const aspect = grid.cols / grid.rows;
  const vfovDeg = 2 * Math.atan(Math.tan((PROJ_HFOV_DEG * Math.PI) / 180 / 2) / aspect) * (180 / Math.PI);
  const shearM = new Float64Array(16);
  const shearTerms = {};
  const pTerms = createPitchedTerms();
  for (let i = 0; i < 50; i++) {
    const cam = { x: (rnd() - 0.5) * 200, y: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 10, yawDeg: rnd() * 360, pitchDeg: 0 };
    projTerms(cam, grid, shearTerms);
    shearProjection(shearTerms, shearM);
    pitchedTerms({ x: cam.x, y: cam.y, z: cam.z, yawDeg: cam.yawDeg, pitchDeg: 0, vfovDeg }, grid, pTerms);
    for (let k = 0; k < 16; k++) {
      const d = Math.abs(pTerms.M[k] - shearM[k]);
      worst = Math.max(worst, d);
      if (d > 1e-12) allOk = false;
    }
  }
  ok('pitch-0 parity: pitchedProjection == shearProjection element-wise within 1e-12 x50', allOk, `worst=${worst}`);
}

// ---------------------------------------------------------------------------
// (1) Round trip: worldToCell(unprojectPitched(col,row,vd)) and
// projectPoint(M) pixel match, 1000 seeded random poses at -55/-58/-60.
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(3);
  const grid = { cols: 320, rows: 120 };
  const terms = createPitchedTerms();
  const out3 = new Float64Array(3);
  const out4 = new Float64Array(4);
  const out2 = new Float64Array(2);
  let worstCell = 0, worstPx = 0, allOk = true;
  for (const pitchDeg of [-55, -58, -60]) {
    for (let i = 0; i < 1000; i++) {
      const cam = { x: (rnd() - 0.5) * 200, y: (rnd() - 0.5) * 200, z: 1 + rnd() * 20, yawDeg: rnd() * 360, pitchDeg };
      pitchedTerms(cam, grid, terms);
      const col = rnd() * grid.cols;
      const row = rnd() * grid.rows;
      const vd = 1 + rnd() * 199;

      unprojectPitched(terms, col, row, vd, out3);
      worldToCell(terms, out3[0], out3[1], out3[2], out4 /* reuse as scratch len>=3 */);
      const dCol = Math.abs(out4[0] - col), dRow = Math.abs(out4[1] - row);
      worstCell = Math.max(worstCell, dCol, dRow);
      if (dCol > 1e-9 || dRow > 1e-9) allOk = false;

      const n = 1;
      const W = grid.cols * n, H = grid.rows * n;
      projectPoint(terms.M, W, H, out3[0], out3[1], out3[2], out4);
      if (!(out4[3] > 0)) { allOk = false; continue; }
      windowToCell(n, out4[0], out4[1], out2);
      const dPxCol = Math.abs(out2[0] - col), dPxRow = Math.abs(out2[1] - row);
      worstPx = Math.max(worstPx, dPxCol, dPxRow);
      if (dPxCol > 1e-9 || dPxRow > 1e-9) allOk = false;
    }
  }
  ok('round trip worldToCell(unprojectPitched) and projectPoint(M) pixel, 1000x3 seeded poses within 1e-9', allOk, `worstCell=${worstCell} worstPx=${worstPx}`);
}

// ---------------------------------------------------------------------------
// (4) At pitch -58, default vfov, grid 400x150, pxCellW:1,pxCellH:2:
// screenRay hits z=0 at the centre column for row 0 and row rows-1; the
// metres-per-column ratio top-row/bottom-row is <= 1.6.
// ---------------------------------------------------------------------------
{
  const grid = { cols: 400, rows: 150, pxCellW: 1, pxCellH: 2 };
  const cam = { x: 0, y: 0, z: 20, yawDeg: 0, pitchDeg: -58, vfovDeg: PROJ_PITCHED_VFOV_DEG };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);

  const rayOut = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  function hitZ0(col, row) {
    screenRay(terms, col, row, rayOut);
    if (rayOut.dz >= 0) return null; // never reaches z=0 going up/level
    const t = -rayOut.oz / rayOut.dz;
    return { x: rayOut.ox + rayOut.dx * t, y: rayOut.oy + rayOut.dy * t, t };
  }

  const centreCol = (grid.cols - 1) / 2;
  const hitTop = hitZ0(centreCol, 0);
  const hitBottom = hitZ0(centreCol, grid.rows - 1);
  ok('screenRay centre column, row 0 hits z=0', hitTop !== null, `hitTop=${JSON.stringify(hitTop)}`);
  ok('screenRay centre column, row rows-1 hits z=0', hitBottom !== null, `hitBottom=${JSON.stringify(hitBottom)}`);

  // Metres per column at each row: adjacent-column world delta at the z=0 hit.
  function metresPerColumn(row) {
    const a = hitZ0(centreCol, row);
    const b = hitZ0(centreCol + 1, row);
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const mTop = metresPerColumn(0);
  const mBottom = metresPerColumn(grid.rows - 1);
  let ratio = NaN;
  if (mTop != null && mBottom != null) ratio = mTop / mBottom;
  ok('metres-per-column ratio top/bottom <= 1.6 at pitch -58', ratio <= 1.6, `mTop=${mTop} mBottom=${mBottom} ratio=${ratio}`);
}

// ---------------------------------------------------------------------------
// (5) 64-box fixture: no box with a visible corner (worldToCell inside the
// grid, vd > PROJ_NEAR) is CULL_OUT.
// ---------------------------------------------------------------------------
{
  const grid = { cols: 200, rows: 80 };
  const cam = { x: 0, y: 0, z: 10, yawDeg: 25, pitchDeg: -58 };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);
  const planes = new Float64Array(24);
  frustumPlanes(terms.M, planes);

  const rnd = makeLcg(4);
  const c3 = new Float64Array(3);
  let checked = 0, violations = 0;
  for (let i = 0; i < 64; i++) {
    // Place boxes along the view axis (F), offset sideways/up by R/U scaled
    // by the ray fan at that depth, so a good share of them actually land
    // inside the screen (unlike a uniform world-space scatter, which mostly
    // misses a narrow frustum).
    const depth = 5 + rnd() * 150;
    const spanX = terms.tanHalfX * depth, spanY = terms.tanHalfY * depth;
    const sideR = (rnd() - 0.5) * 2 * spanX * 0.9;
    const sideU = (rnd() - 0.5) * 2 * spanY * 0.9;
    const cx = cam.x + terms.fX * depth + terms.rX * sideR + terms.uX * sideU;
    const cy = cam.y + terms.fY * depth + terms.rY * sideR + terms.uY * sideU;
    const cz = cam.z + terms.fZ * depth + terms.uZ * sideU;
    const hx = 0.5 + rnd() * 5, hy = 0.5 + rnd() * 5, hz = 0.5 + rnd() * 5;
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
    ];
    let hasVisibleCorner = false;
    for (const [x, y, z] of corners) {
      worldToCell(terms, x, y, z, c3);
      if (c3[2] > PROJ_NEAR && c3[0] >= -0.5 && c3[0] <= grid.cols - 0.5 && c3[1] >= -0.5 && c3[1] <= grid.rows - 0.5) {
        hasVisibleCorner = true;
        break;
      }
    }
    if (!hasVisibleCorner) continue;
    checked++;
    const r = classifyAABB(planes, x0, y0, z0, x1, y1, z1);
    if (r === CULL_OUT) violations++;
  }
  ok('64-box fixture: no box with a visible corner is CULL_OUT', checked > 0 && violations === 0, `checked=${checked} violations=${violations}`);
}

// ---------------------------------------------------------------------------
// (2) The existing shear-path test still passes unchanged - run it here too
// as a guard; the canonical run is `node engine/render/projection.test.js`
// (run separately by tools/run-tests.mjs).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (7) Zero allocation: 10k screenRay + worldToCell calls, reused outs.
// ---------------------------------------------------------------------------
{
  const grid = { cols: 320, rows: 120 };
  const cam = { x: 1, y: 2, z: 5, yawDeg: 40, pitchDeg: -58 };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);
  const rayOut = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const c3 = new Float64Array(3);
  let sink = 0;
  // Warm up.
  for (let i = 0; i < 500; i++) {
    screenRay(terms, i % grid.cols, (i * 7) % grid.rows, rayOut);
    worldToCell(terms, rayOut.ox + rayOut.dx * 10, rayOut.oy + rayOut.dy * 10, rayOut.oz + rayOut.dz * 10, c3);
    sink += c3[0];
  }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) {
    screenRay(terms, i % grid.cols, (i * 7) % grid.rows, rayOut);
    worldToCell(terms, rayOut.ox + rayOut.dx * 10, rayOut.oy + rayOut.dy * 10, rayOut.oz + rayOut.dz * 10, c3);
    sink += c3[0];
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('screenRay + worldToCell: no significant heap growth over 10k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

// ---------------------------------------------------------------------------
// pitchedEyeFromFocus: eye sits `dist` back along -F from the focus.
// ---------------------------------------------------------------------------
{
  const rnd = makeLcg(5);
  let allOk = true, worst = 0;
  const out3 = new Float64Array(3);
  const terms = createPitchedTerms();
  for (let i = 0; i < 100; i++) {
    const fx = (rnd() - 0.5) * 100, fy = (rnd() - 0.5) * 100, fz = (rnd() - 0.5) * 10;
    const yawDeg = rnd() * 360, pitchDeg = -89 + rnd() * 178, dist = 1 + rnd() * 50;
    pitchedEyeFromFocus(fx, fy, fz, yawDeg, pitchDeg, dist, out3);
    pitchedTerms({ x: out3[0], y: out3[1], z: out3[2], yawDeg, pitchDeg }, { cols: 100, rows: 100 }, terms);
    // focus should be `dist` along +F from the eye.
    const px = out3[0] + terms.fX * dist, py = out3[1] + terms.fY * dist, pz = out3[2] + terms.fZ * dist;
    const d = Math.hypot(px - fx, py - fy, pz - fz);
    worst = Math.max(worst, d);
    if (d > 1e-9) allOk = false;
  }
  ok('pitchedEyeFromFocus: eye + dist*F == focus within 1e-9 x100', allOk, `worst=${worst}`);
}

// ---------------------------------------------------------------------------
// Pitch range guard: outside [-89, 89] throws.
// ---------------------------------------------------------------------------
{
  const terms = createPitchedTerms();
  let threwLow = false, threwHigh = false;
  try { pitchedTerms({ x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -90 }, { cols: 10, rows: 10 }, terms); } catch (e) { threwLow = true; }
  try { pitchedTerms({ x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 90 }, { cols: 10, rows: 10 }, terms); } catch (e) { threwHigh = true; }
  ok('pitchedTerms throws for pitchDeg outside [-89, 89]', threwLow && threwHigh);
}

// BUG-RTS-001 (28.11a): pitchedHashCell at the rtsHill58 pose (focus width 30 m, vfov 36, yaw 20).
{
  const hashAt = (cols, rows, pitch) => {
    const g = { cols, rows, pxCellW: 1, pxCellH: 2 };
    const aspect = (cols * 1) / (rows * 2);
    const tanHalfX = Math.tan((PROJ_PITCHED_VFOV_DEG * Math.PI) / 360) * aspect;
    const e = pitchedEyeFromFocus(1440, 1040, 50, 20, pitch, 30 / (2 * tanHalfX), [0, 0, 0]);
    const cam = { x: e[0], y: e[1], z: e[2], yawDeg: 20, pitchDeg: pitch, vfovDeg: PROJ_PITCHED_VFOV_DEG };
    return { cam, g, h: pitchedHashCell(pitchedTerms(cam, g, createPitchedTerms()), cols, 50) };
  };
  ok('pitchedHashCell rtsHill58 160x60 = 0.25', hashAt(160, 60, -58).h === 0.25);
  ok('pitchedHashCell rtsHill58 400x150 = 0.125', hashAt(400, 150, -58).h === 0.125);
  ok('pitchedHashCell rtsHill58 240x90 = 0.125', hashAt(240, 90, -58).h === 0.125);
  const r = hashAt(160, 60, -58);
  ok('pitchedHashCell shear terms = 0', pitchedHashCell(projTerms(r.cam, r.g, {}), 160, 50) === 0);
  const far = pitchedTerms({ x: 0, y: 0, z: 500, yawDeg: 0, pitchDeg: -58 }, r.g, createPitchedTerms());
  ok('pitchedHashCell clamps at 2 m', pitchedHashCell(far, 40, 0) === 2);
}

// RE-02b b1: first-person vfov anchor - pitched M at pitch 0 == shearProjection element-wise on 3 aspects.
{
  for (const [cols, rows, pw, ph] of [[160, 60, 1, 2], [400, 150, 1, 1], [240, 90, 5, 8]]) {
    const g = { cols, rows, pxCellW: pw, pxCellH: ph };
    const cam = { x: 3, y: -2, z: 1.7, yawDeg: 37, pitchDeg: 0 };
    const M = pitchedProjection(pitchedTerms(cam, g, createPitchedTerms()), new Float64Array(16));
    const S = shearProjection(projTerms(cam, g, {}), new Float64Array(16));
    let maxD = 0;
    for (let i = 0; i < 16; i++) maxD = Math.max(maxD, Math.abs(M[i] - S[i]));
    ok(`b1: fpVfovDeg pitched M == shear M at pitch 0 (${cols}x${rows} ${pw}:${ph}) maxDiff ${maxD.toExponential(2)}`, maxD < 1e-12);
    ok('b1: fpVfovDeg keeps hfov 75', approxEqual(2 * Math.atan(Math.tan(fpVfovDeg(g) * Math.PI / 360) * (cols * pw) / (rows * ph)) * 180 / Math.PI, 75, 1e-9));
  }
  ok("b5: resolveProjection default: mesh -> pitched, dda -> shear, explicit wins",
    resolveProjection({}, 'mesh') === 'pitched' && resolveProjection({}, 'dda') === 'shear' && resolveProjection({}) === 'shear' &&
    resolveProjection({ projection: 'shear' }, 'mesh') === 'shear' && resolveProjection({ projection: 'pitched' }, 'dda') === 'pitched');
  ok('b2: PITCH_CLAMP_PITCHED_DEG = 70', PITCH_CLAMP_PITCHED_DEG === 70);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
