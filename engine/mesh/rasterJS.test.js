import { loadGolden, goldenFrame } from '../../tools/testing/mesh-golden.mjs';
const golden = loadGolden('rasterJS');
let oracleIndex = 0;
// engine/mesh/rasterJS.test.js (ME-03, docs/backlog.md ME-03 ACs,
// docs/architecture.md 27.7 items 1/2/4, 27.15.4). Run: node engine/mesh/rasterJS.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createRasterTarget, clearRasterTarget, rasterDrawList, copyToGBuffer,
} from './rasterJS.js';
import {
  DrawList, DRAW_STATIC, DRAW_VOXEL, DRAW_TERRAIN, LevelMeshCache, addStructures,
} from './DrawList.js';
import { projTerms, shearProjection } from '../render/projection.js';
import {
  StaticMeshBuilder, packFlat1, AO_NONE, validateMesh,
} from './MeshData.js';
import { unpackNormalOct, packNormalOct } from '../voxel/octNormal.js';
import {
  GBuffer, KIND_FLOOR, KIND_WALL, KIND_MODEL, FACE_U, FACE_S, FACE_E, FACE_PACKED,
} from '../render/GBuffer.js';
import { loadLevel } from '../world/Level.js';
import { bindShading, bindLevel } from '../render/MaterialTable.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function camTerms(cam, grid) {
  const terms = {};
  const M = new Float64Array(16);
  projTerms(cam, grid, terms);
  shearProjection(terms, M);
  return { terms, M };
}

/** Casts a ray through (col, row) and returns its (rdx, rdy, slope) direction. */
function rayAt(terms, col, row) {
  const cameraX = (2 * (col + 0.5)) / terms.cols - 1;
  const rdx = terms.dirX + terms.planeX * cameraX;
  const rdy = terms.dirY + terms.planeY * cameraX;
  const slope = (terms.horizonRow - row) / terms.planeDistY;
  return { rdx, rdy, slope };
}
/** Analytic ray/plane hit, plane y = planeY. */
function hitAtY(terms, col, row, planeY) {
  const { rdx, rdy, slope } = rayAt(terms, col, row);
  const dist = (planeY - terms.eyeY) / rdy;
  return { x: terms.eyeX + rdx * dist, y: planeY, z: terms.eyeZ + slope * dist, dist };
}
/** Analytic ray/plane hit, plane z = planeZ. */
function hitAtZ(terms, col, row, planeZ) {
  const { rdx, rdy, slope } = rayAt(terms, col, row);
  const dist = (planeZ - terms.eyeZ) / slope;
  return { x: terms.eyeX + rdx * dist, y: terms.eyeY + rdy * dist, z: planeZ, dist };
}

function identityItem(list, mesh, type) {
  const item = list.push(mesh, type);
  item.rangeFirst = 0;
  item.rangeCount = mesh.triCount;
  item.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]); // not exercising culling here
  return item;
}

/** A single quad wall-like mesh in the world y = planeY, spanning x0..x1, z0..z1, facing -y. uv = (x, z). */
function makeWallQuadMesh(id, planeY, x0, x1, z0, z1) {
  const b = new StaticMeshBuilder(id);
  const mat = b.matIndex('m');
  b.addQuad(
    [x0, planeY, z0, x1, planeY, z0, x1, planeY, z1, x0, planeY, z1],
    [x0, z0, x1, z0, x1, z1, x0, z1],
    0, -1, 0,
    0, packFlat1(KIND_WALL, FACE_S, mat),
    [0, AO_NONE, 0, 0, 0, 0, 0, 0],
  );
  return b.build();
}

/**
 * An N-triangle fan around an apex at (cx, apexY, cz), rim at radius on the
 * y = rimY plane (a flat disk when apexY === rimY, a cone otherwise - used to
 * exercise near-plane clipping when the apex sits behind the eye).
 */
function makeFanMesh(id, triCount, cx, cz, rimY, radius, apexY = rimY) {
  const V = triCount * 3;
  const pos = new Float32Array(V * 3);
  const uv = new Float32Array(V * 2);
  const nrm = new Uint32Array(V);
  const flat = new Uint32Array(V * 2);
  const aux = new Float32Array(V * 8);
  const flat1 = packFlat1(KIND_WALL, FACE_S, 0);
  const nrmPacked = packNormalOct(0, -1, 0);
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triCount; i++) {
    const a0 = (i / triCount) * Math.PI * 2;
    const a1 = ((i + 1) / triCount) * Math.PI * 2;
    const verts = [
      [cx, apexY, cz],
      [cx + radius * Math.cos(a0), rimY, cz + radius * Math.sin(a0)],
      [cx + radius * Math.cos(a1), rimY, cz + radius * Math.sin(a1)],
    ];
    for (let k = 0; k < 3; k++) {
      const vi = i * 3 + k;
      const p = verts[k];
      pos[vi * 3] = p[0]; pos[vi * 3 + 1] = p[1]; pos[vi * 3 + 2] = p[2];
      uv[vi * 2] = p[0]; uv[vi * 2 + 1] = p[2];
      nrm[vi] = nrmPacked;
      flat[vi * 2] = 0; flat[vi * 2 + 1] = flat1;
      aux[vi * 8 + 1] = AO_NONE;
      if (p[0] < bbox[0]) bbox[0] = p[0];
      if (p[1] < bbox[1]) bbox[1] = p[1];
      if (p[2] < bbox[2]) bbox[2] = p[2];
      if (p[0] > bbox[3]) bbox[3] = p[0];
      if (p[1] > bbox[4]) bbox[4] = p[1];
      if (p[2] > bbox[5]) bbox[5] = p[2];
    }
  }
  return {
    version: 1, id, layout: 'static', pos, uv, nrm, flat, aux, idx: null, triCount,
    bbox: Float64Array.from(bbox), ranges: [{ start: 0, count: triCount }], matKeys: [], matsResolved: true, meshVersion: 1,
  };
}

/** A 2x2-quad terrain patch (flat, z = planeZ), 8 triangles. */
function makeTerrainMesh(id, planeZ) {
  const xs = [-1, 0, 1], ys = [3, 4, 5];
  const V = 9;
  const pos = new Float32Array(V * 3);
  const nrm = new Uint32Array(V);
  const nrmPacked = packNormalOct(0, 0, 1);
  let vi = 0;
  for (let j = 0; j < 3; j++) {
    for (let i2 = 0; i2 < 3; i2++) {
      pos[vi * 3] = xs[i2]; pos[vi * 3 + 1] = ys[j]; pos[vi * 3 + 2] = planeZ;
      nrm[vi] = nrmPacked;
      vi++;
    }
  }
  const idx = [];
  for (let j = 0; j < 2; j++) {
    for (let i2 = 0; i2 < 2; i2++) {
      const a = j * 3 + i2, bI = a + 1, c = a + 3, d = c + 1;
      idx.push(a, c, bI, bI, c, d);
    }
  }
  return {
    version: 1, id, layout: 'terrain', pos, uv: new Float32Array(0), nrm, flat: new Uint32Array(0),
    aux: new Float32Array(0), idx: Uint32Array.from(idx), triCount: idx.length / 3,
    bbox: Float64Array.from([-1, 3, planeZ, 1, 5, planeZ]), ranges: [{ start: 0, count: idx.length / 3 }],
    matKeys: [], matsResolved: true, meshVersion: 1,
  };
}

/** A 1-quad "voxel part" mesh, local-space, normal (0,-1,0). */
function makeVoxelQuadMesh(id) {
  const b = new StaticMeshBuilder(id);
  b.beginRange('p0');
  const mat = b.matIndex('vox');
  b.addQuad(
    [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, -0.5, -0.5, 1],
    [0, 0, 1, 0, 1, 1, 0, 1],
    0, -1, 0,
    0, packFlat1(KIND_MODEL, FACE_S, mat),
    [0, AO_NONE, 0, 0, 0, 0, 0, 0],
  );
  return b.build();
}

function rotZDeg(deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

// ---------------------------------------------------------------------------
// 1. Watertightness: a 2-triangle quad and a 200-triangle fan write every
// inside pixel exactly once (writeCount == pixels).
// ---------------------------------------------------------------------------
function checkWatertight(name, mesh) {
  const cols = 48, rows = 36, n = 1;
  const cam = { x: 0, y: 0, z: 1.5, yawDeg: 180, pitchDeg: 0 }; // forward = +y
  const { M, terms } = camTerms(cam, { cols, rows });
  const target = createRasterTarget(cols, rows, n, { countWrites: true });
  const list = new DrawList(4);
  list.begin();
  identityItem(list, mesh, DRAW_STATIC);
  rasterDrawList(list, target, { M, terms, snap: true });

  let coveredByKind = 0, coveredByWrites = 0, overWritten = 0, mismatch = 0;
  const size = cols * rows;
  for (let i = 0; i < size; i++) {
    const k = target.kind[i] !== 0;
    const w = target.writes[i];
    if (k) coveredByKind++;
    if (w > 0) coveredByWrites++;
    if (w > 1) overWritten++;
    if (k !== (w > 0)) mismatch++;
  }
  ok(`${name}: some pixels covered`, coveredByKind > 100, `coveredByKind=${coveredByKind}`);
  ok(`${name}: kind!=0 iff writes>0 (writeCount == pixels)`, mismatch === 0, `mismatch=${mismatch}`);
  ok(`${name}: no pixel written more than once`, overWritten === 0, `overWritten=${overWritten}`);
  ok(`${name}: coveredByKind === coveredByWrites`, coveredByKind === coveredByWrites);
}
checkWatertight('2-triangle quad', makeWallQuadMesh('quad', 5, -2, 2, 0, 3));
checkWatertight('200-triangle fan', makeFanMesh('fan200', 200, 0, 1.5, 5, 2));
// Eye inside the fan: apex behind the near plane, rim far ahead (a cone) -
// every triangle spans the near plane and needs Sutherland-Hodgman clipping.
checkWatertight('200-triangle fan, eye inside (near clip)', makeFanMesh('fan200b', 200, 0, 1.5, 5, 3, -0.02));

// ---------------------------------------------------------------------------
// 2. Perspective-correct uv against the analytic ray-plane hit (snap off),
// within 1e-6.
// ---------------------------------------------------------------------------
{
  const cols = 32, rows = 24, n = 1;
  const cam = { x: 0.3, y: -0.2, z: 1.7, yawDeg: 185, pitchDeg: 6 };
  const { M, terms } = camTerms(cam, { cols, rows });
  const mesh = makeWallQuadMesh('persp', 5, -3, 3, 0, 3);
  const target = createRasterTarget(cols, rows, n, {});
  const list = new DrawList(4);
  list.begin();
  identityItem(list, mesh, DRAW_STATIC);
  rasterDrawList(list, target, { M, terms, snap: false });

  let checked = 0, maxErr = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (target.kind[i] === 0) continue;
      const hit = hitAtY(terms, col, row, 5);
      if (hit.dist <= 0) continue;
      const errU = Math.abs(target.u[i] - hit.x);
      const errV = Math.abs(target.v[i] - hit.z);
      const errZ = Math.abs(target.z[i] - hit.z); // zRef 0, zBase 0
      maxErr = Math.max(maxErr, errU, errV, errZ);
      checked++;
    }
  }
  ok('perspective-correct uv: pixels checked', checked > 50, `checked=${checked}`);
  ok('perspective-correct uv within 1e-6 of the analytic ray-plane hit', maxErr < 1e-6, `maxErr=${maxErr}`);
}

// ---------------------------------------------------------------------------
// 3. Depth test order-independent: two overlapping quads at different
// depths render identically regardless of draw-list order.
// ---------------------------------------------------------------------------
{
  const cols = 24, rows = 18, n = 1;
  const cam = { x: 0, y: 0, z: 1.5, yawDeg: 180, pitchDeg: 0 };
  const { M, terms } = camTerms(cam, { cols, rows });
  const near = makeWallQuadMesh('near', 5, -2, 2, 0, 3);
  const far = makeWallQuadMesh('far', 8, -2, 2, 0, 3);

  function render(order) {
    const target = createRasterTarget(cols, rows, n, {});
    const list = new DrawList(4);
    list.begin();
    for (const mesh of order) identityItem(list, mesh, DRAW_STATIC);
    rasterDrawList(list, target, { M, terms, snap: true });
    return target;
  }
  const t1 = render([near, far]);
  const t2 = render([far, near]);
  let same = true, nearWins = 0, size = cols * rows;
  for (let i = 0; i < size; i++) {
    if (t1.kind[i] !== t2.kind[i] || t1.z[i] !== t2.z[i] || Math.abs(t1.depth[i] - t2.depth[i]) > 1e-9) same = false;
    if (t1.kind[i] !== 0 && Math.abs(t1.u[i] + 2) < 4 && t1.depth[i] < 6) nearWins++;
  }
  ok('depth test order-independent: identical targets regardless of draw order', same);
  ok('the nearer quad wins the depth test somewhere', nearWins > 0, `nearWins=${nearWins}`);
}

// ---------------------------------------------------------------------------
// 4. Kind 7 (terrain) on a hand-made mesh: u/v = world x/y, mat via
// ctx.kind7Mat, aoD Infinity, planeId PLANEID_TERRAIN, face FACE_PACKED.
// ---------------------------------------------------------------------------
{
  const cols = 32, rows = 24, n = 1;
  const cam = { x: 0, y: 0, z: 1.6, yawDeg: 180, pitchDeg: -15 }; // forward=+y, tilt down to see the floor patch ahead
  const { M, terms } = camTerms(cam, { cols, rows });
  const mesh = makeTerrainMesh('terrain2x2', 0);
  const kind7Mat = (x, y) => (x >= 0 ? 1 : 2) + (y >= 4 ? 10 : 0);
  const target = createRasterTarget(cols, rows, n, {});
  const list = new DrawList(4);
  list.begin();
  identityItem(list, mesh, DRAW_TERRAIN);
  rasterDrawList(list, target, { M, terms, snap: false, kind7Mat });

  let checked = 0, maxUvErr = 0, matOk = true, aoOk = true, faceOk = true, planeOk = true;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (target.kind[i] === 0) continue;
      if (target.kind[i] !== 7) continue;
      checked++;
      const hit = hitAtZ(terms, col, row, 0);
      if (hit.dist > 0) maxUvErr = Math.max(maxUvErr, Math.abs(target.u[i] - hit.x), Math.abs(target.v[i] - hit.y));
      if (target.mat[i] !== kind7Mat(target.u[i], target.v[i])) matOk = false;
      if (target.aoD[i] !== Infinity) aoOk = false;
      if (target.face[i] !== FACE_PACKED) faceOk = false;
      if (target.planeId[i] !== -1) planeOk = false;
    }
  }
  ok('terrain patch visible', checked > 10, `checked=${checked}`);
  ok('terrain u/v == world x/y (within 1e-6)', maxUvErr < 1e-6, `maxUvErr=${maxUvErr}`);
  ok('terrain mat via ctx.kind7Mat(u, v)', matOk);
  ok('terrain aoD == Infinity', aoOk);
  ok('terrain face == FACE_PACKED (7)', faceOk);
  ok('terrain planeId == PLANEID_TERRAIN (-1)', planeOk);
}

// ---------------------------------------------------------------------------
// 5. Kind 8 (voxel) on a hand-made 1-part mesh: axis-aligned rotation (90 deg)
// -> roundedFace(normal); non-axis-aligned (30 deg) -> FACE_PACKED + normal.
// ---------------------------------------------------------------------------
function checkVoxelFace(name, deg, axisAligned, expectFace, expectedNormal) {
  const cols = 32, rows = 24, n = 1;
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad), c = Math.cos(rad);
  // Local quad faces -y; after R(deg) about z its world normal is (s, -c, 0)
  // (see rotZDeg). Place the camera along +normal from the (rotated,
  // translated) quad centroid, looking the opposite way, so the quad faces
  // the camera regardless of `deg` - a wall rotated 90 deg about z is edge-on
  // to a camera that didn't also turn to follow it.
  const tx = 0, ty = 6, tz = 1.5;
  const centroidX = 0.5 * s + tx, centroidY = -0.5 * c + ty, centroidZ = 0.5 + tz;
  const D = 3;
  const cam = { x: centroidX + s * D, y: centroidY - c * D, z: centroidZ, yawDeg: 180 + deg, pitchDeg: 0 };
  const { M, terms } = camTerms(cam, { cols, rows });
  const mesh = makeVoxelQuadMesh(`vox_${deg}`);
  const target = createRasterTarget(cols, rows, n, {});
  const list = new DrawList(4);
  list.begin();
  const item = list.push(mesh, DRAW_VOXEL);
  const R = rotZDeg(deg);
  item.partMatrices.set(R, 0);
  item.partMatrices.set([tx, ty, tz], 9);
  item.partFlags[0] = axisAligned ? 1 : 0;
  item.aabb.set([-10, -10, -10, 10, 10, 10]);
  rasterDrawList(list, target, { M, terms, snap: true });

  let checked = 0, faceOk = true, maxNrmErr = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (target.kind[i] !== 8) continue;
      checked++;
      if (target.face[i] !== expectFace) faceOk = false;
      if (expectedNormal) {
        const n3 = [0, 0, 0];
        unpackNormalOct(target.nrm[i], n3);
        maxNrmErr = Math.max(maxNrmErr, Math.abs(n3[0] - expectedNormal[0]), Math.abs(n3[1] - expectedNormal[1]), Math.abs(n3[2] - expectedNormal[2]));
      }
    }
  }
  ok(`${name}: voxel quad visible`, checked > 0, `checked=${checked}`);
  ok(`${name}: face == expected`, faceOk, `expected ${expectFace}`);
  if (expectedNormal) ok(`${name}: packed normal close to expected`, maxNrmErr < 2e-3, `maxNrmErr=${maxNrmErr}`);
}
checkVoxelFace('axis-aligned 90deg', 90, true, FACE_E, null);
checkVoxelFace('non-axis-aligned 30deg', 30, false, FACE_PACKED, [Math.sin((30 * Math.PI) / 180), -Math.cos((30 * Math.PI) / 180), 0]);

// ---------------------------------------------------------------------------
// 6. copyToGBuffer: kind-0 pixels untouched; face 7 -> aoD bits = nrm.
// ---------------------------------------------------------------------------
{
  const cols = 16, rows = 12, n = 1;
  const cam = { x: 0, y: 0, z: 1.6, yawDeg: 180, pitchDeg: -15 };
  const { M, terms } = camTerms(cam, { cols, rows });
  const mesh = makeTerrainMesh('terrain_copy', 0);
  const kind7Mat = () => 5;
  const target = createRasterTarget(cols, rows, n, {});
  const list = new DrawList(4);
  list.begin();
  identityItem(list, mesh, DRAW_TERRAIN);
  rasterDrawList(list, target, { M, terms, snap: true, kind7Mat });

  const gbuf = new GBuffer(cols, rows);
  gbuf.beginFrame();
  gbuf.kind.fill(3); gbuf.mat.fill(9); // sentinel: untouched kind-0 pixels must keep whatever was there before
  const depthArr = new Float32Array(cols * rows);
  copyToGBuffer(target, gbuf, depthArr);

  let untouchedOk = true, aliasOk = true, writeOk = true;
  for (let i = 0; i < cols * rows; i++) {
    if (target.kind[i] === 0) {
      if (gbuf.kind[i] !== 3) untouchedOk = false; // never touched by copyToGBuffer
    } else {
      if (gbuf.kind[i] !== target.kind[i] || gbuf.mat[i] !== target.mat[i]) writeOk = false;
      if (target.face[i] === FACE_PACKED && gbuf.aoD[i] !== 0) {
        // aoD holds the packed normal bits via the Uint32 alias - reinterpret.
        const alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
        if (alias[i] !== target.nrm[i]) aliasOk = false;
      }
    }
  }
  ok('copyToGBuffer leaves kind-0 pixels untouched', untouchedOk);
  ok('copyToGBuffer writes matching fields for kind!=0 pixels', writeOk);
  ok('copyToGBuffer face-7 aoD alias == packed normal bits', aliasOk);
}

// ---------------------------------------------------------------------------
// 7. Tower vs CPU DDA: 3 inside poses, 160x60, n=1. kind equal >= 98% of
// cells excluding cells with a differently-kinded 4-neighbour (gpuCompare.js
// isEdgeCell convention).
// ---------------------------------------------------------------------------
function isEdgeCell(kind, cols, rows, x, y, i) {
  const k = kind[i];
  const up = y > 0 ? i - cols : -1, dn = y < rows - 1 ? i + cols : -1;
  const lf = x > 0 ? i - 1 : -1, rt = x < cols - 1 ? i + 1 : -1;
  if (up >= 0 && kind[up] !== k) return true;
  if (dn >= 0 && kind[dn] !== k) return true;
  if (lf >= 0 && kind[lf] !== k) return true;
  if (rt >= 0 && kind[rt] !== k) return true;
  return false;
}

const { assets } = await loadTestAssets();
{
  const COLS = 160, ROWS = 60;
  const tower = loadLevel(assets.level('tower'));
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  bindLevel(matTable, tower);

  const structure = {
    id: 'tower0', level: tower, origin: { x: 0, y: 0, z: 0 },
    bbox: { x0: 0, y0: 0, x1: tower.width, y1: tower.height }, structSeq: 0, packed: { version: 1 },
  };
  const world = { structures: [structure] };
  const cache = new LevelMeshCache(matTable.idFor);

  const eyeH = 1.6;
  const poses = [0, 90, 180].map((yawDeg) => ({
    x: tower.start.x, y: tower.start.y, z: tower.sectorAt(tower.start.x, tower.start.y).floorH + eyeH, yawDeg, pitchDeg: 0,
  }));

  let totalChecked = 0, totalMismatch = 0;
  const detail = [];
  for (const cam of poses) {
    const sample = golden.frames[oracleIndex++];
    if (JSON.stringify(sample.cam) !== JSON.stringify(cam)) throw new Error('Raster oracle camera changed; ARCH OK required');
    const refKind = goldenFrame(sample).gbuf.kind;

    // Mesh path.
    const { terms, M } = camTerms(cam, { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 });
    const list = new DrawList(16);
    list.begin();
    addStructures(list, world, cam, cache, 2000);
    const target = createRasterTarget(COLS, ROWS, 1, {});
    rasterDrawList(list, target, { M, terms, snap: true });
    const gbuf2 = new GBuffer(COLS, ROWS);
    gbuf2.beginFrame();
    copyToGBuffer(target, gbuf2, new Float32Array(COLS * ROWS));
    const meshKind = gbuf2.kind;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        if (isEdgeCell(refKind, COLS, ROWS, x, y, i)) continue;
        totalChecked++;
        if (refKind[i] !== meshKind[i]) {
          totalMismatch++;
          if (detail.length < 10) detail.push(`yaw=${cam.yawDeg} (${x},${y}) ref=${refKind[i]} mesh=${meshKind[i]}`);
        }
      }
    }
  }
  const matchPct = totalChecked > 0 ? 100 * (1 - totalMismatch / totalChecked) : 0;
  console.log(`  tower vs CPU DDA: ${totalChecked} non-edge cells checked, ${totalMismatch} mismatched (${matchPct.toFixed(2)}% match)`);
  if (VERBOSE) detail.forEach((d) => console.log('  ', d));
  ok(`tower vs CPU DDA: kind matches on >= 98% of non-edge cells (${matchPct.toFixed(2)}%)`, matchPct >= 98, detail.join(' | '));

  // Shuffled item order -> identical target (27.15.4 step 6).
  {
    const cam = poses[0];
    const { terms, M } = camTerms(cam, { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 });
    const list1 = new DrawList(16);
    list1.begin();
    addStructures(list1, world, cam, cache, 2000);
    const t1 = createRasterTarget(COLS, ROWS, 1, {});
    rasterDrawList(list1, t1, { M, terms, snap: true });

    // Shuffle by pushing dyn (if any) before base - with a single structure
    // and no dynamic tags this is a no-op push order check (list has 1 item);
    // still exercises cull()/push() independent of insertion order.
    const list2 = new DrawList(16);
    list2.begin();
    const set = cache.get(structure);
    const meshes = [set.base, ...set.dyn.map((d) => d.mesh)].slice().reverse();
    for (const mesh of meshes) {
      const item = list2.push(mesh, DRAW_STATIC);
      item.zBase = 0;
      item.rangeFirst = 0;
      item.rangeCount = mesh.triCount;
      item.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
    }
    const t2 = createRasterTarget(COLS, ROWS, 1, {});
    rasterDrawList(list2, t2, { M, terms, snap: true });
    let same = true;
    for (let i = 0; i < COLS * ROWS; i++) if (t1.kind[i] !== t2.kind[i]) { same = false; break; }
    ok('shuffled item order -> identical target', same);
  }
}

// ---------------------------------------------------------------------------
// 8. Zero allocation: rasterDrawList on the tower mesh, 160x60, 200 frames.
// ---------------------------------------------------------------------------
{
  const COLS = 160, ROWS = 60;
  const tower = loadLevel(assets.level('tower'));
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  bindLevel(matTable, tower);
  const structure = {
    id: 'tower_alloc', level: tower, origin: { x: 0, y: 0, z: 0 },
    bbox: { x0: 0, y0: 0, x1: tower.width, y1: tower.height }, structSeq: 0, packed: { version: 1 },
  };
  const world = { structures: [structure] };
  const cache = new LevelMeshCache(matTable.idFor);
  const cam = { x: tower.start.x, y: tower.start.y, z: tower.sectorAt(tower.start.x, tower.start.y).floorH + 1.6, yawDeg: 0, pitchDeg: 0 };
  const { terms, M } = camTerms(cam, { cols: COLS, rows: ROWS });
  const list = new DrawList(16);
  const target = createRasterTarget(COLS, ROWS, 1, {});
  const ctx = { M, terms, snap: true };

  function frame() {
    list.begin();
    addStructures(list, world, cam, cache, 2000);
    clearRasterTarget(target);
    rasterDrawList(list, target, ctx);
  }
  for (let i = 0; i < 5; i++) frame(); // warm up (also warms the mesh cache)
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200; i++) frame();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('rasterDrawList: no significant heap growth over 200 tower frames (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
}


// ---------------------------------------------------------------------------
// 9. RE-06 DRAW_INSTANCED: N instances == N DRAW_VOXEL items (bit-identical at
//    yaws that are exact in f32), team remap changes only slot-material pixels.
// ---------------------------------------------------------------------------
{
  await import('../../design/models/voxel_props.js');
  const { VoxelPool } = await import('../render/voxelPool.js');
  const { computeVoxelPose, FORWARD } = await import('../voxel/voxelPose.js');
  const { VoxelMeshCache } = await import('./voxelMesh.js');
  const { MAX_VOX_PARTS, PART_STRIDE } = await import('../voxel/VoxelModel.js');
  const { createInstanceBuffer, createInstanceParts, writeUnitInstance, computeGroupParts } = await import('./instances.js');
  const { DRAW_INSTANCED } = await import('./DrawList.js');
  const { buildTeamRemap } = await import('../render/teamRemap.js');

  const VM = globalThis.ASSETS.voxelModels;
  const idMap = new Map();
  const table = {
    idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); },
    hasKey() { return true; },
  };
  const pool = new VoxelPool();
  pool.bind({ keys: (k) => (k === 'model' ? ['lever'] : []), model: () => ({ voxel: VM.lever.voxel }) }, table);
  const pm = pool.models.get('lever');
  const mesh = new VoxelMeshCache().get(pm, 'lever', pool.partNamesFor('lever'));
  const nParts = pm.partCount;

  const C = 160, R = 60;
  const h = pm.sz * pm.cellM;
  const cam = { x: 0, y: 4 + h, z: 0.5 * h + 0.3137, yawDeg: 0, pitchDeg: 0 };
  const M = new Float64Array(16);
  { const terms = {}; projTerms(cam, { cols: C, rows: R, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M); }
  const xs = [-1.5, -0.75, 0, 0.75, 1.5, 2.25];
  const teams = [0, 1, 2, 0, 1, 2];

  // Slot = the lever's first material; team 1 -> a new material id, team 2 -> another.
  const slotId = pm.matIds[1];
  let slotKey = null;
  for (const [k, id] of idMap) if (id === slotId) slotKey = k;
  const team = buildTeamRemap(table, { slots: [slotKey], teams: [null, { [slotKey]: 'testRedA' }, { [slotKey]: 'testBlueB' }] });

  function buildInstanced(yaws, useTeams) {
    const ib = createInstanceBuffer(xs.length);
    for (let i = 0; i < xs.length; i++) writeUnitInstance(ib, i, xs[i], 0, 0, yaws[i], 0x10000 | i, useTeams ? teams[i] : 0);
    const parts = createInstanceParts();
    computeGroupParts(pm, { clip: -1, frame: 0, tMs: 0 }, parts);
    const list = new DrawList(8);
    list.begin();
    list.addInstances(mesh, parts, ib, xs.length);
    return list;
  }
  function buildVoxelItems(yaws) {
    const list = new DrawList(16);
    list.begin();
    const scratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
    for (let i = 0; i < xs.length; i++) {
      computeVoxelPose(pm, { x: xs[i], y: 0, z: 0, yawDeg: yaws[i], clip: -1, frame: 0, tMs: 0 }, scratch);
      const it = list.push(mesh, DRAW_VOXEL);
      for (let p = 0; p < nParts; p++) {
        for (let c = 0; c < 12; c++) it.partMatrices[p * 12 + c] = FORWARD[p * 12 + c];
        it.partFlags[p] = scratch[p * PART_STRIDE + 12];
      }
      it.planeIdOr = (i & 0xF) << 24;
      it.objectId = 0x10000 | i;
      it.zBase = 0;
    }
    return list;
  }
  function raster(list, ctxTeam) {
    const t = createRasterTarget(C, R, 1, {});
    rasterDrawList(list, t, { M, snap: true, team: ctxTeam });
    return t;
  }
  const FIELDS = ['kind', 'face', 'mat', 'planeId', 'depth', 'u', 'v', 'z', 'aoD', 'nrm', 'objectId'];

  const yawsExact = [0, 90, 180, 270, 90, 0];
  const ti = raster(buildInstanced(yawsExact, false), null);
  const tv = raster(buildVoxelItems(yawsExact), null);
  let covered = 0;
  for (let i = 0; i < ti.kind.length; i++) if (ti.kind[i] === KIND_MODEL) covered++;
  ok(`instanced: ${xs.length} units rasterise (${covered} kind-8 pixels)`, covered > 200, String(covered));
  ok('addInstances item is DRAW_INSTANCED', buildInstanced(yawsExact, false).items[0].type === DRAW_INSTANCED);
  let diffs = 0, firstDiff = '';
  for (const f of FIELDS) {
    for (let i = 0; i < ti[f].length; i++) {
      const a = ti[f][i], b = tv[f][i];
      if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) { diffs++; if (!firstDiff) firstDiff = `${f}[${i}] ${a} vs ${b}`; }
    }
  }
  ok('N instanced == N DRAW_VOXEL items: kind/face/mat/planeId/depth/u/v/z/aoD/nrm/objectId bit-identical (yaws 0/90/180/270)', diffs === 0, `${diffs} diffs, first ${firstDiff}`);
  let idOk = 0, planeOk = 0, model = 0;
  for (let i = 0; i < ti.kind.length; i++) {
    if (ti.kind[i] !== KIND_MODEL) continue;
    model++;
    if ((ti.objectId[i] >>> 16) === 1 && (ti.objectId[i] & 0xFFFF) < xs.length) idOk++;
    if (((ti.planeId[i] >>> 24) & 0xF) === (ti.objectId[i] & 0xF)) planeOk++;
  }
  ok('objectId = 0x10000|i and planeId slot bits = objectId low 4 bits on every unit pixel', idOk === model && planeOk === model, `${idOk}/${planeOk}/${model}`);

  // Non-multiples of 90: same picture within silhouette tolerance (I is stored as f32).
  const yawsFree = [37.5, 200, 12, 300, 77, 151];
  const tf = raster(buildInstanced(yawsFree, false), null);
  const tg = raster(buildVoxelItems(yawsFree), null);
  let same = 0, either = 0;
  for (let i = 0; i < tf.kind.length; i++) {
    if (tf.kind[i] === KIND_MODEL || tg.kind[i] === KIND_MODEL) { either++; if (tf.kind[i] === tg.kind[i] && tf.face[i] === tg.face[i]) same++; }
  }
  ok(`free yaws: kind+face agree on >= 99% of unit pixels (${same}/${either})`, either > 200 && same / either >= 0.99);

  // Team remap: team 1/2 change only the slot material of their own units.
  const t0 = raster(buildInstanced(yawsExact, false), team);
  const t1 = raster(buildInstanced(yawsExact, true), team);
  const redId = idMap.get('testRedA'), blueId = idMap.get('testBlueB');
  let bad = 0, changed = 0, slotPixels = 0;
  for (let i = 0; i < t0.kind.length; i++) {
    for (const f of FIELDS) if (f !== 'mat' && t0[f][i] !== t1[f][i] && !(Number.isNaN(t0[f][i]) && Number.isNaN(t1[f][i]))) bad++;
    if (t0.kind[i] !== KIND_MODEL) continue;
    const tm = teams[t0.objectId[i] & 0xFFFF];
    if (t0.mat[i] === slotId) slotPixels++;
    const want = t0.mat[i] === slotId ? (tm === 1 ? redId : tm === 2 ? blueId : slotId) : t0.mat[i];
    if (t1.mat[i] !== want) bad++;
    if (t0.mat[i] !== t1.mat[i]) changed++;
  }
  ok(`team 1/2 change only slot-material pixels of team units (${changed} changed of ${slotPixels} slot pixels)`, bad === 0 && changed > 0, `bad=${bad}`);
  ok('team 0 leaves the picture identical to a run without ctx.team', (() => { for (let i = 0; i < t0.kind.length; i++) if (t0.mat[i] !== ti.mat[i]) return false; return true; })());

  // zero allocation
  const list = buildInstanced(yawsExact, true);
  const tt = createRasterTarget(C, R, 1, {});
  const ctx = { M, snap: true, team };
  for (let i = 0; i < 5; i++) { clearRasterTarget(tt); rasterDrawList(list, tt, ctx); }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100; i++) { clearRasterTarget(tt); rasterDrawList(list, tt, ctx); }
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('rasterDrawList DRAW_INSTANCED: no significant heap growth over 100 frames', grew < 64 * 1024, `grew=${grew}`);
}

ok('all frozen oracle frames were checked', oracleIndex === golden.frames.length, `${oracleIndex}/${golden.frames.length}`);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
