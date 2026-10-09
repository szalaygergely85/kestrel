// US-068a (docs/architecture.md 38.19): ortho camera mode in projection.js. Node only.
import assert from 'node:assert/strict';
import {
  createPitchedTerms, pitchedTerms, screenRay, unprojectPitched, worldToCell,
  projectPoint, resolveProjection, frameMatrix, pitchedFogScale,
} from './projection.js';

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const grids = [{ cols: 160, rows: 50, pxCellW: 8, pxCellH: 16 }, { cols: 400, rows: 150, pxCellW: 6, pxCellH: 12 }];
const poses = [[0, -90], [-90, -90], [0, 0], [45, -35.264]];
const mk = (yaw, pitch, halfH, extra) => ({ x: 0, y: 0, z: 0, yawDeg: yaw, pitchDeg: pitch, projection: 'ortho', orthoHalfH: halfH, focusX: 10, focusY: -20, focusZ: 3, ...extra });

// 1. round trip over 1000 seeded random (col,row,vd), all poses/halfH/grids
{
  const t = createPitchedTerms(), o3 = new Float64Array(3), c3 = new Float64Array(3);
  let worst = 0;
  for (let i = 0; i < 1000; i++) {
    const [yaw, pitch] = poses[i % 4];
    const g = grids[(i >> 2) & 1], halfH = (i >> 3) & 1 ? 40 : 4;
    pitchedTerms(mk(yaw, pitch, halfH), g, t);
    assert.equal(t.projection, 'ortho');
    const col = rnd() * g.cols, row = rnd() * g.rows, vd = 5 + rnd() * 900;
    unprojectPitched(t, col, row, vd, o3);
    worldToCell(t, o3[0], o3[1], o3[2], c3);
    worst = Math.max(worst, Math.abs(c3[0] - col), Math.abs(c3[1] - row), Math.abs(c3[2] - vd) / 1000);
    assert.ok(Math.abs(c3[0] - col) < 1e-6 && Math.abs(c3[1] - row) < 1e-6 && Math.abs(c3[2] - vd) < 1e-6, `rt ${i}`);
    // matrix projects the unprojected point onto the cell centre-ish (NDC x) and depth is linear in vd
    const p4 = new Float64Array(4);
    const M = t.M, w = 1;
    const X = M[0] * o3[0] + M[4] * o3[1] + M[8] * o3[2] + M[12];
    assert.ok(Math.abs(X - ((2 * (col + 0.5)) / g.cols - 1)) < 1e-9, 'ndc x');
    assert.ok(M[3] === 0 && M[7] === 0 && M[11] === 0 && M[15] === w, 'row_w = (0,0,0,1)');
    void p4;
  }
  console.log('ortho round trip worst', worst);
}

// 2. parallel rays: dir == F for every pixel
{
  const t = createPitchedTerms(), r = {};
  pitchedTerms(mk(45, -35.264, 10), grids[0], t);
  for (let i = 0; i < 200; i++) {
    screenRay(t, rnd() * 160, rnd() * 50, r);
    assert.equal(r.dx, t.fX); assert.equal(r.dy, t.fY); assert.equal(r.dz, t.fZ);
  }
  // TOP yaw 0: screen up == north (-y)
  pitchedTerms(mk(0, -90, 10), grids[0], t);
  const a = new Float64Array(3), b = new Float64Array(3);
  unprojectPitched(t, 80, 10, 500, a); unprojectPitched(t, 80, 30, 500, b);
  assert.ok(a[1] < b[1], 'top row is north (smaller y)');
}

// 3. orthoHalfH scales world extent linearly
{
  const t1 = createPitchedTerms(), t2 = createPitchedTerms(), a = new Float64Array(3), b = new Float64Array(3);
  pitchedTerms(mk(30, -40, 5, { focusX: 0, focusY: 0, focusZ: 0 }), grids[0], t1);
  pitchedTerms(mk(30, -40, 20, { focusX: 0, focusY: 0, focusZ: 0 }), grids[0], t2);
  unprojectPitched(t1, 0, 0, 500, a); unprojectPitched(t2, 0, 0, 500, b);
  // eye is the focus - 500F, so vd = 500 is the focus plane: offsets scale by 4
  assert.ok(Math.hypot(a[0], a[1], a[2]) > 0);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(b[k] - 4 * a[k]) < 1e-9, 'linear halfH');
  assert.equal(t2.halfW, t2.halfH * t2.aspect);
}

// 4. validation + resolveProjection + frameMatrix agree with terms
{
  assert.equal(resolveProjection({ projection: 'ortho' }, 'mesh'), 'ortho');
  assert.throws(() => pitchedTerms(mk(0, 0, 0), grids[0], createPitchedTerms()));
  assert.throws(() => pitchedTerms(mk(0, 91, 5), grids[0], createPitchedTerms()));
  const t = createPitchedTerms(), M = new Float64Array(16);
  pitchedTerms(mk(10, -50, 7), grids[0], t);
  frameMatrix(mk(10, -50, 7), grids[0], M);
  for (let k = 0; k < 16; k++) assert.equal(M[k], t.M[k]);
  assert.equal(pitchedFogScale(t, 3), t.cosP);
  // depth NDC: vd = near -> -1, far -> +1
  const o = new Float64Array(3);
  for (const [vd, z] of [[0.05, -1], [2000, 1]]) {
    unprojectPitched(t, 80, 25, vd, o);
    const Z = t.M[2] * o[0] + t.M[6] * o[1] + t.M[10] * o[2] + t.M[14];
    assert.ok(Math.abs(Z - z) < 1e-9, `ndc z at vd ${vd}`);
  }
  const pp = projectPoint; void pp;
}

// 5. perspective bit-identical with projection unset vs 'pitched'; ortho fields neutral
{
  const tu = createPitchedTerms(), tp = createPitchedTerms();
  const ru = {}, rp = {}, au = new Float64Array(3), ap = new Float64Array(3), bu = new Float64Array(3), bp = new Float64Array(3);
  for (let i = 0; i < 1000; i++) {
    const g = grids[i & 1];
    const cam = { x: rnd() * 100 - 50, y: rnd() * 100 - 50, z: rnd() * 30, yawDeg: rnd() * 360 - 180, pitchDeg: rnd() * 178 - 89 };
    pitchedTerms(cam, g, tu); pitchedTerms({ ...cam, projection: 'pitched', orthoHalfH: 9 }, g, tp);
    assert.equal(tu.ortho, 0); assert.equal(tu.projection, 'pitched'); assert.equal(tu.halfW, 0);
    for (let k = 0; k < 16; k++) assert.ok(Object.is(tu.M[k], tp.M[k]), 'M');
    const c = rnd() * g.cols, r = rnd() * g.rows, vd = 0.1 + rnd() * 500;
    screenRay(tu, c, r, ru); screenRay(tp, c, r, rp);
    for (const k of Object.keys(ru)) assert.ok(Object.is(ru[k], rp[k]), 'ray');
    unprojectPitched(tu, c, r, vd, au); unprojectPitched(tp, c, r, vd, ap);
    worldToCell(tu, au[0], au[1], au[2], bu); worldToCell(tp, ap[0], ap[1], ap[2], bp);
    for (let k = 0; k < 3; k++) { assert.ok(Object.is(au[k], ap[k])); assert.ok(Object.is(bu[k], bp[k])); }
    assert.ok(Math.abs(bu[0] - c) < 1e-6 && Math.abs(bu[1] - r) < 1e-6, 'persp round trip');
  }
}
console.log('projection.ortho tests OK');
