// PREC-01a (37.9): camera-relative render origin. Node probe of the f32-emulated vertex stage (WGSL `u.viewProj * (model * aPos)`; fround after every
// mul/add) at the forestWalk and parapetSky camera poses: the absolute path loses ~1e-4 m at 1500 m, the origin-relative one does not.
import assert from 'node:assert/strict';
import { frameMatrix, viewProjAtOrigin } from '../projection.js';

const fr = Math.fround;
const grid = { cols: 160, rows: 60, pxCellW: 1, pxCellH: 2 };
let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const poses = [
  { name: 'parapetSky', cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 255, pitchDeg: 20 } },
  { name: 'forestWalk', cam: { x: 1364.37, y: 966.81, z: 3.4, yawDeg: 270, pitchDeg: 30 } },
  { name: 'shear', cam: { x: 1486.5, y: 1025.0, z: 7.6, yawDeg: 87.6, pitchDeg: 0, projection: 'shear' } },
];

// (1) viewProjAtOrigin == M * T(O) (f64 out), and the f32 store is one rounding of it
for (const { cam } of poses) {
  const M = frameMatrix(cam, grid, new Float64Array(16), 'mesh');
  const ox = Math.floor(cam.x / 16) * 16, oy = Math.floor(cam.y / 16) * 16;
  const T = new Float64Array(16); T[0] = T[5] = T[10] = T[15] = 1; T[12] = ox; T[13] = oy;
  const ref = new Float64Array(16); // column-major product M * T
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += M[k * 4 + r] * T[c * 4 + k]; ref[c * 4 + r] = s; }
  const got = viewProjAtOrigin(M, ox, oy, new Float64Array(16));
  for (let k = 0; k < 16; k++) assert.ok(Math.abs(got[k] - ref[k]) < 1e-9, `M*T(O) k=${k}`);
  const g32 = viewProjAtOrigin(M, ox, oy, new Float32Array(16));
  for (let k = 0; k < 16; k++) assert.equal(g32[k], fr(ref[k]), 'f32 store = one rounding of the f64 result');
}

// f32 clip = sum_c M[:,c] * p[c] with fround after each mul and add (no FMA)
function clip32(M32, px, py, pz, out) {
  for (let i = 0; i < 4; i++) {
    let s = fr(M32[i] * px);
    s = fr(s + fr(M32[4 + i] * py)); s = fr(s + fr(M32[8 + i] * pz)); s = fr(s + M32[12 + i]);
    out[i] = s;
  }
}
const clip64 = (M, x, y, z, out) => { for (let i = 0; i < 4; i++) out[i] = M[i] * x + M[4 + i] * y + M[8 + i] * z + M[12 + i]; };

function probe(cam, instanced) {
  const M = frameMatrix(cam, grid, new Float64Array(16), 'mesh');
  const ox = Math.floor(cam.x / 16) * 16, oy = Math.floor(cam.y / 16) * 16;
  const abs32 = new Float32Array(16), rel32 = new Float32Array(16);
  for (let k = 0; k < 16; k++) abs32[k] = M[k];
  viewProjAtOrigin(M, ox, oy, rel32);
  const fx = Math.sin(cam.yawDeg * Math.PI / 180), fy = -Math.cos(cam.yawDeg * Math.PI / 180);
  const a = new Float64Array(4), b = new Float64Array(4), c = new Float64Array(4);
  const e = { absW: 0, relW: 0, absCell: 0, relCell: 0 };
  for (let n = 0; n < 20000; n++) {
    const d = 2 + rnd() * 15, side = (rnd() - 0.5) * d;
    let tx = cam.x + fx * d - fy * side, ty = cam.y + fy * d + fx * side; // mesh translation 2-17 m ahead
    if (instanced) { tx = fr(tx); ty = fr(ty); } // instance rows are f32 words (both twins read the same)
    const lx = (rnd() - 0.5) * 4, ly = (rnd() - 0.5) * 4, lz = rnd() * 6, tz = fr(rnd() * 8);
    // ref: f64 world position (instanced: the f32 row translation + the f32 local vertex)
    const lx32 = fr(lx), ly32 = fr(ly), lz32 = fr(lz);
    const wx = tx + (instanced ? lx32 : lx), wy = ty + (instanced ? ly32 : ly), wz = tz + (instanced ? lz32 : lz);
    clip64(M, wx, wy, wz, c);
    const pz = fr(tz + (instanced ? lz32 : lz));
    // abs: world position in f32 (translation f32 + local), then the absolute f32 matrix
    const axp = fr((instanced ? lx32 : lx) + fr(tx)), ayp = fr((instanced ? ly32 : ly) + fr(ty));
    clip32(abs32, axp, ayp, pz, a);
    // rel: translation - O (f64 subtract, then f32 store; instanced: f32 row.w - origin, exact), relative matrix
    const rtx = instanced ? fr(fr(tx) - ox) : fr(tx - ox), rty = instanced ? fr(fr(ty) - oy) : fr(ty - oy);
    const rxp = fr((instanced ? lx32 : lx) + rtx), ryp = fr((instanced ? ly32 : ly) + rty);
    clip32(rel32, rxp, ryp, pz, b);
    if (c[3] < 2) continue; // 37.9 probe: points 2-17 m ahead (w >= 2 m)
    const cell = (v) => [v[0] / v[3] * grid.cols / 2, v[1] / v[3] * grid.rows / 2];
    const [cx, cy] = cell(c), [axc, ayc] = cell(a), [rxc, ryc] = cell(b);
    e.absW = Math.max(e.absW, Math.abs(a[3] - c[3])); e.relW = Math.max(e.relW, Math.abs(b[3] - c[3]));
    e.absCell = Math.max(e.absCell, Math.hypot(axc - cx, ayc - cy)); e.relCell = Math.max(e.relCell, Math.hypot(rxc - cx, ryc - cy));
  }
  return e;
}

const rows = [];
for (const { name, cam } of poses) {
  const s = probe(cam, false), i = probe(cam, true);
  rows.push(`${name}: static abs w ${s.absW.toExponential(2)} m / ${s.absCell.toExponential(2)} cell, rel w ${s.relW.toExponential(2)} m / ${s.relCell.toExponential(2)} cell; instanced rel w ${i.relW.toExponential(2)} m`);
  // (2) f32-emulated vertex stage: rel < 1e-5 m and < 1e-3 cell; the abs path is worse than 1e-5 m (documents why)
  assert.ok(s.relW < 1e-5, `${name}: rel w error ${s.relW}`);
  assert.ok(s.relCell < 1e-3, `${name}: rel screen error ${s.relCell}`);
  assert.ok(s.absW > 1e-5, `${name}: abs path should still be > 1e-5 m (got ${s.absW})`);
  // (3) instanced rel formula (row.w - origin in f32)
  assert.ok(i.relW < 1e-5, `${name}: instanced rel w error ${i.relW}`);
  assert.ok(i.relCell < 1e-3, `${name}: instanced rel screen error ${i.relCell}`);
}
console.log('renderOrigin.test.js: viewProjAtOrigin = M*T(O) and f32 vertex-stage probes passed\n  ' + rows.join('\n  '));
