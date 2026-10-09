// US-068b1 (docs/architecture.md 38.19): WGSL ortho selects + JS twins. Node only. Run: node engine/render/gpu/wgsl/ortho.wgsl.test.js
import assert from 'node:assert/strict';
import { CELL_RAY_PITCHED_WGSL } from './common.wgsl.js';
import { compileFn, shims } from './wgslProbe.js';
import { createPitchedTerms, pitchedTerms, unprojectPitched, worldToCell, pitchedFogScale, orthoHashCell, PROJ_NEAR, PROJ_FAR } from '../../projection.js';
import { DrawList, DRAW_STATIC } from '../../../mesh/DrawList.js';
import { createRasterTarget, rasterDrawList } from '../../../mesh/rasterJS.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from '../../../mesh/MeshData.js';
import { KIND_FLOOR, FACE_U } from '../../GBuffer.js';

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const dirP = compileFn(CELL_RAY_PITCHED_WGSL, 'cellDirPitched', { ...shims });
const rayP = compileFn(CELL_RAY_PITCHED_WGSL, 'cellRayPitched', { ...shims, cellDirPitched: dirP });
const fogP = compileFn(CELL_RAY_PITCHED_WGSL, 'pitchFogScale', { ...shims });

// 1. cellRayPitched ortho == unprojectPitched ortho (<= 1e-5 m, 500 cells); ortho=false stays bit-identical to unprojectPitched
{
  const t = createPitchedTerms(), o3 = new Float64Array(3), poses = [[0, -90], [-90, -90], [30, -35.264], [45, -20]];
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const [yaw, pitch] = poses[i % 4], g = { cols: 160, rows: 50, pxCellW: 8, pxCellH: 16 };
    pitchedTerms({ x: 0, y: 0, z: 0, yawDeg: yaw, pitchDeg: pitch, projection: 'ortho', orthoHalfH: 3 + rnd() * 40, focusX: 10, focusY: -20, focusZ: 3 }, g, t);
    const cx = Math.floor(rnd() * g.cols), cy = Math.floor(rnd() * g.rows), vd = 1 + rnd() * 900;
    const args = [{ x: cx, y: cy }, { x: g.cols, y: g.rows }, { x: t.eyeX, y: t.eyeY, z: t.eyeZ }, { x: t.fX, y: t.fY, z: t.fZ }, { x: t.rX, y: t.rY },
      { x: t.uX, y: t.uY, z: t.uZ }, { x: t.tanHalfX, y: t.tanHalfY }, vd];
    const p = rayP(...args, true);
    unprojectPitched(t, cx, cy, vd, o3); // (cell centre in x, row edge in y: same convention as the WGSL cell dir)
    worst = Math.max(worst, Math.abs(p.x - o3[0]), Math.abs(p.y - o3[1]), Math.abs(p.z - o3[2]));
    // pitchFogScale ortho == pitchedFogScale (constant cosP)
    assert.equal(fogP(cy, g.rows, t.tanHalfY, t.cosP, t.sinP, true), pitchedFogScale(t, cy));
  }
  assert.ok(worst < 1e-5, `ortho P worst ${worst}`);
  // perspective unchanged
  const tp = createPitchedTerms();
  for (let i = 0; i < 200; i++) {
    const g = { cols: 160, rows: 50, pxCellW: 8, pxCellH: 16 };
    pitchedTerms({ x: 1, y: 2, z: 3, yawDeg: rnd() * 360, pitchDeg: -rnd() * 80, projection: 'pitched', fovDeg: 60 }, g, tp);
    const cx = Math.floor(rnd() * g.cols), cy = Math.floor(rnd() * g.rows), vd = rnd() * 50;
    const args = [{ x: cx, y: cy }, { x: g.cols, y: g.rows }, { x: tp.eyeX, y: tp.eyeY, z: tp.eyeZ }, { x: tp.fX, y: tp.fY, z: tp.fZ }, { x: tp.rX, y: tp.rY },
      { x: tp.uX, y: tp.uY, z: tp.uZ }, { x: tp.tanHalfX, y: tp.tanHalfY }, vd];
    const a = rayP(...args, false), b = rayP(...args, undefined);
    unprojectPitched(tp, cx, cy, vd, new Float64Array(3));
    assert.deepEqual(a, b);
    assert.equal(fogP(cy, g.rows, tp.tanHalfY, tp.cosP, tp.sinP, false), pitchedFogScale(tp, cy));
  }
}

// 2. hash-cell rule
{
  const t = createPitchedTerms(), g = { cols: 160, rows: 50, pxCellW: 8, pxCellH: 16 };
  for (const hh of [0.5, 4, 40, 200]) {
    pitchedTerms({ x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -90, projection: 'ortho', orthoHalfH: hh }, g, t);
    const want = Math.min(2, Math.max(0.125, Math.pow(2, Math.ceil(Math.log2((2 * t.halfW) / g.cols)))));
    assert.equal(orthoHashCell(t, g.cols), want); assert.ok(want > 0);
  }
  pitchedTerms({ x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: -45, projection: 'pitched' }, g, t);
  assert.equal(orthoHashCell(t, g.cols), 0);
}

// 3. rasterJS twin: ortho depth plane is LINEAR vd (1/w would be 1 everywhere); pitched ctx unchanged (no ortho flag -> 1/w)
{
  const b = new StaticMeshBuilder('ramp'), mat = b.matIndex('floor');
  b.addQuad([-6, -6, 0, 6, -6, 0, 6, 6, 4, -6, 6, 4], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(KIND_FLOOR, FACE_U, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  const mesh = b.build(), list = new DrawList(4);
  list.begin(); list.push(mesh, DRAW_STATIC).rangeCount = mesh.triCount;
  const g = { cols: 64, rows: 64, pxCellW: 8, pxCellH: 8 }, t = createPitchedTerms(), c3 = new Float64Array(3), o3 = new Float64Array(3);
  pitchedTerms({ x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: -50, projection: 'ortho', orthoHalfH: 8, focusX: 0, focusY: 0, focusZ: 0 }, g, t);
  const tgt = createRasterTarget(64, 64, 1);
  rasterDrawList(list, tgt, { M: t.M, ortho: true });
  let n = 0, worst = 0;
  for (let py = 0; py < 64; py++) for (let px = 0; px < 64; px++) {
    const i = py * 64 + px;
    if (tgt.kind[i] === 0) continue;
    const d = tgt.depth[i];
    assert.ok(d > PROJ_NEAR && d < PROJ_FAR && Math.abs(d - 1) > 1e-3, `depth ${d}`);
    // reproject the cell's world position (raster planes u/v/z give no xy; use the ray: pixel centre row/col -> P at depth d must lie on the quad plane z = 4*(y+6)/12)
    unprojectPitched(t, px + 0.5 - 0.5, py, d, o3);
    const zPlane = 4 * (o3[1] + 6) / 12;
    worst = Math.max(worst, Math.abs(o3[2] - zPlane)); n++;
  }
  assert.ok(n > 500, `covered ${n}`);
  assert.ok(worst < 0.2, `linear depth reprojects onto the plane (worst ${worst} m; pixel-centre vs cell-edge row offset)`);
  const tp = createRasterTarget(64, 64, 1);
  rasterDrawList(list, tp, { M: t.M });
  let ones = 0, m = 0;
  for (let i = 0; i < 4096; i++) if (tp.kind[i] !== 0) { m++; if (Math.abs(tp.depth[i] - 1) < 1e-9) ones++; }
  assert.equal(ones, m, 'without ctx.ortho the old 1/w path runs (w = 1 -> depth 1): the trap this flag fixes');
}
console.log('ortho.wgsl.test.js: cellRayPitched/pitchFogScale ortho (500 cells <1e-5 m), perspective bit-identical, hash cell rule, rasterJS linear ortho depth passed.');
