// US-068b3a (38.19): JS-side ortho sites. Node only.
import assert from 'node:assert/strict';
import { camBasis, projectSprite } from './sprites.js';
import { VoxelPool } from './voxelPool.js';
import quadruped12 from '../voxel/fixtures/quadruped12.js';
import { isPitchedFamily, resolveProjection, createPitchedTerms, pitchedTerms, worldToCell } from './projection.js';
import { lodCentreX, lodCentreY, lodCentreZ } from '../core/camFocus.js';
import { computeProjectionPitched, instanceRect } from '../voxel/instanceRect.js';
import { sunShadowCentre } from './shadowSun.js';
import { fillSky } from './sky.js';
import { beginFrame } from './compositor.js';
import { fastShadeSky } from './fastShade.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import palette from '../../design/palette.js';
import { ORTHO_BACK_M } from './projection.js';

const rt = { cols: 160, rows: 50, pxCellW: 8, pxCellH: 16 };
assert.ok(isPitchedFamily('pitched') && isPitchedFamily('ortho') && !isPitchedFamily('shear'));

const orthoCam = (fx) => ({ x: 0, y: 0, z: 0, yawDeg: 45, pitchDeg: -35.264, projection: 'ortho', orthoHalfH: 12, focusX: fx, focusY: 5, focusZ: 2 });
// 1. ortho sprite size independent of vd and == worldH*rows/(2*halfH)
{
  const cam = orthoCam(10), cb = camBasis(cam, rt, {}, 'mesh'), o = {};
  const sizes = [];
  for (const k of [0, 10, 60, 200]) { // slide the sprite along the view direction (changes vd only)
    const f = cb.pt;
    assert.ok(projectSprite(cb, cam, 10 + k * f.fX, 5 + k * f.fY, 2 + k * f.fZ, 1.8, o));
    sizes.push(o.rowsOnScreen);
  }
  const expect = 1.8 * rt.rows / (2 * 12);
  for (const s of sizes) assert.ok(Math.abs(s - expect) < 1e-9, `size ${s} vs ${expect}`);
}
// 2. pitched sprite size bit-identical to the worldToCell difference (the pre-change expression)
{
  const cam = { x: 3, y: 4, z: 6, yawDeg: 30, pitchDeg: -25, projection: 'pitched' };
  const cb = camBasis(cam, rt, {}, 'mesh'), o = {};
  const w0 = new Float64Array(3), w1 = new Float64Array(3);
  for (const [px, py, pz] of [[10, -20, 0], [5, -3, 1.5], [-8, -40, 2]]) {
    assert.ok(projectSprite(cb, cam, px, py, pz, 1.8, o));
    worldToCell(cb.pt, px, py, pz, w0); worldToCell(cb.pt, px, py, pz + 1.8, w1);
    assert.equal(o.rowsOnScreen, w0[1] - w1[1]);
    assert.equal(o.depth, w0[2]);
  }
}
// 3. instanceRect in ortho: finite hull, no /vd, and covers the on-screen corners
{
  const registry = { keys: (k) => (k === 'model' ? ['bear'] : []), model: () => ({ voxel: quadruped12 }) };
  let nextId = 1; const idMap = new Map();
  const pool = new VoxelPool();
  pool.bind(registry, { idFor(k) { if (!idMap.has(k)) idMap.set(k, nextId++); return idMap.get(k); } });
  const pm = pool.models.get('bear');
  const cam = orthoCam(0); const t = createPitchedTerms(); pitchedTerms(cam, rt, t);
  const proj = computeProjectionPitched(t, {});
  assert.equal(proj.ortho, true);
  const pose = new Float64Array(64 * 16);
  const rect = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, empty: false };
  const c3 = new Float64Array(3);
  let checked = 0;
  for (const k of [0, 30, 300]) { // the same on-screen spot at three view depths -> same rect
    const inst = { model: pm, x: t.eyeX + t.fX * (500 + k), y: t.eyeY + t.fY * (500 + k), z: t.eyeZ + t.fZ * (500 + k), yawDeg: 20, clip: -1, frame: 0, tMs: 0 };
    instanceRect(proj, pm, inst, pose, null, rect);
    assert.ok(!rect.empty && rect.maxCol > rect.minCol, `ortho rect k=${k}`);
    for (let c = 0; c < 8; c++) {
      worldToCell(t, (c & 1) ? rect.maxX : rect.minX, (c & 2) ? rect.maxY : rect.minY, (c & 4) ? rect.maxZ : rect.minZ, c3);
      const col = Math.floor(c3[0] + 0.5), row = Math.floor(c3[1] + 0.5);
      if (col >= 0 && col < rt.cols && row >= 0 && row < rt.rows) { assert.ok(col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow); checked++; }
    }
  }
  assert.ok(checked >= 8, `checked ${checked}`);
}
// 4. LOD/cull centre keys on the focus in ortho, eye otherwise
{
  const o = orthoCam(77);
  assert.equal(lodCentreX(o), 77); assert.equal(lodCentreY(o), 5); assert.equal(lodCentreZ(o), 2);
  const p = { x: 1, y: 2, z: 3, projection: 'pitched', focusX: 99 };
  assert.equal(lodCentreX(p), 1); assert.equal(lodCentreY(p), 2); assert.equal(lodCentreZ(p), 3);
}
// 5. sun shadow box centre follows focus for an ortho cam
{
  const c = new Float64Array(3);
  sunShadowCentre(orthoCam(40), { boxM: 192, res: 1024 }, c);
  assert.equal(c[0], 40); assert.equal(c[1], 5); assert.equal(c[2], 2);
}
// 6. US-068b3b fogDepth: ortho = focus-plane depth * cosP (not the 500 m eye distance); pitched unchanged
{
  const cam = orthoCam(10), cb = camBasis(cam, rt, {}, 'mesh'), o = {}, f = cb.pt;
  for (const k of [0, 10, 60]) {
    assert.ok(projectSprite(cb, cam, 10 + k * f.fX, 5 + k * f.fY, 2 + k * f.fZ, 1.8, o));
    assert.ok(Math.abs(o.fogDepth - k * f.cosP) < 1e-6, `fog ${o.fogDepth} vs ${k * f.cosP}`);
    assert.ok(Math.abs(o.depth - (ORTHO_BACK_M + k)) < 1e-6);
  }
  const pc = { x: 3, y: 4, z: 6, yawDeg: 30, pitchDeg: -25, projection: 'pitched' };
  const pb = camBasis(pc, rt, {}, 'mesh');
  assert.ok(projectSprite(pb, pc, 10, -20, 0, 1.8, o));
  assert.equal(o.fogDepth, Math.max(0, (10 - 3) * pb.dirX + (-20 - 4) * pb.dirY));
}
// 7. US-068b3b sky: ortho takes the pitched-family path - every cell is the sky of direction F, same F as pitched
{
  const cols = 16, rows = 8;
  const mk = () => { const r = new CellBuffer(cols, rows); r.pxCellW = 8; r.pxCellH = 16;
    return { rt: r, depth: new DepthBuffer(cols, rows), gbuf: new GBuffer(cols, rows), palette, renderer: 'mesh' }; };
  for (const [yaw, pitch] of [[45, -35.264], [200, 10]]) {
    const fo = mk(), fp = mk(); beginFrame(fo); beginFrame(fp);
    const oc = { x: 0, y: 0, z: 0, yawDeg: yaw, pitchDeg: pitch, projection: 'ortho', orthoHalfH: 10, focusX: 0, focusY: 0, focusZ: 0 };
    fillSky(fo, oc);
    const t = createPitchedTerms(); pitchedTerms(oc, { cols, rows, pxCellW: 8, pxCellH: 16 }, t);
    let az = Math.atan2(t.fX, -t.fY) * 180 / Math.PI; if (az < 0) az += 360;
    const el = Math.atan2(t.fZ, Math.hypot(t.fX, t.fY)) * 180 / Math.PI;
    const ref = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
    fastShadeSky(palette, az, el, palette.defaultTime, ref);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(fo.rt.bg[c] - ref.bg[c]) <= 1, `ortho sky == sky(F) ch${c}: ${fo.rt.bg[c]} vs ${ref.bg[c]}`);
    const i0 = 0, i1 = cols * rows - 1;
    for (const i of [i0, i1, 5 * cols + 3]) for (let c = 0; c < 3; c++) assert.equal(fo.rt.bg[i * 4 + c], fo.rt.bg[c], 'ortho sky uniform');
    // same yaw/pitch pitched: the centre-ish row equals F's sky only near b=0; ortho must differ from shear (fallback) path
    fillSky(fp, { ...oc, projection: 'pitched', x: 0, y: 0, z: 0 });
    assert.ok(fo.rt.glyphIdx[0] === fo.rt.glyphIdx[i1], 'ortho sky glyph uniform');
  }
}
console.log('sprites.ortho.test OK');
