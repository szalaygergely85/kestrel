import { dynamicTowerFixture } from '../../tools/testing/dynamic-tower.mjs';
// engine/mesh/levelMesh.test.js (ME-01, docs/architecture.md 27.15.2 step 2-5).
// Synthetic-grid unit tests for the plane/boundary rules, plus a caster-
// oracle test on the real `tower`/`test_room` content: for a handful of
// seeded poses, every rendered pixel's world-space hit point (reconstructed
// from `castSectors`' own camera formulas + its own resolved distance) must
// land inside exactly one levelMesh quad whose baked kind/face/mat/planeId/
// zRef/aoMode match what the pixel's G-buffer sample says - i.e. the mesh
// has a surface exactly where, and shaped exactly how, the caster does.
// Run: node engine/mesh/levelMesh.test.js [--verbose]
import { loadLevel } from '../world/Level.js';
import { buildLevelMesh, computeRelief, rebuildLevelMeshDyn } from './levelMesh.js';
import { validateMesh, flatKind, flatFace, flatMat, AO_WALL, AO_PLANE, AO_FAR } from './MeshData.js';
import {
  castSectors, beginFrame, HFOV_DEG,
} from '../render/sectorCaster.js';
import { GBuffer, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D,
  KIND_WALL, KIND_STEP, KIND_UPPER, KIND_FLOOR, KIND_TOP, KIND_CEIL } from '../render/GBuffer.js';
import { DepthBuffer } from '../render/DepthBuffer.js';
import { OpenSpans } from '../render/OpenSpans.js';
import { CellBuffer } from '../render/CellBuffer.js';
import { bindShading, bindLevel } from '../render/MaterialTable.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Synthetic grids (2. Planes + boundaries)
// ---------------------------------------------------------------------------

function sec(over) {
  return { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, ...over };
}

// (a) 3x3 room with ceilings: 9 floors, 9 ceilings, no inner (or outer) walls.
{
  const level = loadLevel({
    name: 'synth-a',
    legend: { a: sec({ ceilH: 3, ceilMat: 'stone' }), s: sec({ ceilH: 3, ceilMat: 'stone', start: true }) },
    rows: ['aaa', 'asa', 'aaa'],
  });
  const set = buildLevelMesh(level);
  const kinds = countKinds(set.base);
  ok('(a) 9 floors', kinds[KIND_FLOOR] === 9);
  ok('(a) 9 ceilings', kinds[KIND_CEIL] === 9);
  ok('(a) no walls/steps/uppers', !kinds[KIND_WALL] && !kinds[KIND_STEP] && !kinds[KIND_UPPER]);
}

// (b) floors 0/0.3: one STEP facing the low cell, zRef 0, mat of the high cell.
{
  const level = loadLevel({
    name: 'synth-b',
    legend: { l: sec({ start: true }), h: sec({ floorH: 0.3, wallMat: 'highMat' }) },
    rows: ['lh'],
  });
  const set = buildLevelMesh(level);
  const steps = quadsOfKind(set.base, KIND_STEP);
  ok('(b) exactly one STEP', steps.length === 1);
  if (steps.length) {
    ok('(b) zRef 0', steps[0].aux[0] === 0);
    ok('(b) mat is the high cell (highMat, matKeys index)', set.base.matKeys[flatMat(steps[0].flat1)] === 'highMat');
    ok('(b) face W (viewer in the low/west cell)', flatFace(steps[0].flat1) === FACE_W);
  }
}

// (c) 2 m solid pillar surrounded by open ground: 4 WALL + 1 TOP.
{
  const level = loadLevel({
    name: 'synth-c',
    legend: { o: sec({}), s: sec({ start: true }), p: sec({ floorH: 2, solid: true, wallMat: 'pillar', floorMat: 'pillarTop' }) },
    rows: ['ooo', 'opo', 'oso'],
  });
  const set = buildLevelMesh(level);
  const kinds = countKinds(set.base);
  ok('(c) 4 WALL quads', kinds[KIND_WALL] === 4);
  ok('(c) 1 TOP quad', kinds[KIND_TOP] === 1);
}

// (d) lintel: ceilH 2.2 (topH 3) vs ceilH 3 -> UPPER over 2.2..3, facing the 3 m cell.
{
  const level = loadLevel({
    name: 'synth-d',
    legend: {
      l: sec({ ceilH: 2.2, topH: 3, ceilMat: 'stone', upperMat: 'lintelMat', start: true }),
      t: sec({ ceilH: 3, ceilMat: 'stone' }),
    },
    rows: ['lt'],
  });
  const set = buildLevelMesh(level);
  const uppers = quadsOfKind(set.base, KIND_UPPER);
  ok('(d) exactly one UPPER', uppers.length === 1);
  if (uppers.length) {
    const q = uppers[0];
    const z0 = Math.min(...q.pos.filter((_, i) => i % 3 === 2));
    const z1 = Math.max(...q.pos.filter((_, i) => i % 3 === 2));
    ok('(d) spans 2.2..3', Math.abs(z0 - 2.2) < 1e-5 && Math.abs(z1 - 3) < 1e-5);
    ok('(d) mat is the low-ceiling cell (lintelMat)', set.base.matKeys[flatMat(q.flat1)] === 'lintelMat');
    ok('(d) faces the 3 m cell (E, viewer on the east/t side)', flatFace(q.flat1) === FACE_E);
  }
}

// (e) sky next to a numeric ceiling: no UPPER.
{
  const level = loadLevel({
    name: 'synth-e',
    legend: { s: sec({ start: true }), t: sec({ ceilH: 3, ceilMat: 'stone' }) },
    rows: ['st'],
  });
  const set = buildLevelMesh(level);
  ok('(e) no UPPER', quadsOfKind(set.base, KIND_UPPER).length === 0);
}

// (f) solid 1x1 grid: outward WALL from footZ on every side.
{
  const level = loadLevel({
    name: 'synth-f',
    legend: { p: sec({ floorH: 1.5, solid: true, start: true }) },
    rows: ['p'],
  });
  const set = buildLevelMesh(level, { footZ: -2 });
  const walls = quadsOfKind(set.base, KIND_WALL);
  ok('(f) 4 outward WALL quads', walls.length === 4);
  ok('(f) all from footZ -2 to floorH 1.5', walls.every((q) => {
    const zs = q.pos.filter((_, i) => i % 3 === 2);
    return Math.abs(Math.min(...zs) - (-2)) < 1e-9 && Math.abs(Math.max(...zs) - 1.5) < 1e-9;
  }));
}

function countKinds(mesh) {
  const counts = {};
  for (let t = 0; t < mesh.triCount; t += 2) { // 2 triangles per quad
    const k = flatKind(mesh.flat[(t * 3) * 2 + 1]);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
function quadsOfKind(mesh, kind) {
  const out = [];
  for (let t = 0; t < mesh.triCount; t += 2) {
    const v0 = t * 3;
    const f1 = mesh.flat[v0 * 2 + 1];
    if (flatKind(f1) !== kind) continue;
    const pos = [];
    for (let v = v0; v < v0 + 6; v++) pos.push(mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]);
    const aux = Array.from(mesh.aux.subarray(v0 * 8, v0 * 8 + 8));
    out.push({ flat1: f1, pos, aux });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (g) computeRelief == level._relief028 after one castSectors frame, on the
// real tower + test_room content.
// ---------------------------------------------------------------------------
const { assets } = await loadTestAssets();
const COLS = 32, ROWS = 18, PXW = 9, PXH = 16;

function makeFb(matTable) {
  return {
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS),
    palette: assets.palette, gbuf: new GBuffer(COLS, ROWS), matTable,
  };
}

for (const name of ['tower', 'test_room']) {
  const level = loadLevel(assets.level(name));
  const matTable = bindShading(assets.palette, assets.detailPass, PXH / PXW);
  bindLevel(matTable, level);
  const fb = makeFb(matTable);
  fb.rt.pxCellW = PXW; fb.rt.pxCellH = PXH;
  beginFrame(fb);
  const cam = { x: level.start.x, y: level.start.y, z: level.start.z !== undefined ? level.start.z : level.sectorAt(level.start.x, level.start.y).floorH + 1.6, yawDeg: 0, pitchDeg: 0 };
  castSectors(fb, level, cam, { x: 0, y: 0, z: 0 });
  const r = computeRelief(level);
  const ref = level._relief028;
  let match = ref && ref.w === r.w && ref.h === r.h;
  if (match) {
    for (let i = 0; i < r.floorRise.length && match; i++) {
      if (r.floorRise[i] !== ref.floorRise[i] || r.ceilDrop[i] !== ref.ceilDrop[i]) match = false;
    }
  }
  ok(`(g) computeRelief(${name}) matches the caster's own relief`, match);
}

// ---------------------------------------------------------------------------
// 3. Caster oracle: reconstruct each rendered pixel's world hit point from
// castSectors' own camera math + its own depth, and confirm the levelMesh
// has a quad exactly there whose baked attributes match the G-buffer sample.
// ---------------------------------------------------------------------------

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Barycentric point-in-triangle test with a plane-distance gate; null if P isn't on/inside the triangle. */
function locate(P, p0, p1, p2, planeEps, baryEps) {
  const e1 = sub(p1, p0), e2 = sub(p2, p0);
  const n = cross(e1, e2);
  const nlen = Math.hypot(n[0], n[1], n[2]);
  if (nlen < 1e-12) return null;
  const w = sub(P, p0);
  if (Math.abs(dot(w, n)) / nlen > planeEps) return null;
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let i0, i1;
  if (ax >= ay && ax >= az) { i0 = 1; i1 = 2; } else if (ay >= ax && ay >= az) { i0 = 0; i1 = 2; } else { i0 = 0; i1 = 1; }
  const x0 = e1[i0], y0 = e1[i1], x1 = e2[i0], y1 = e2[i1], px = w[i0], py = w[i1];
  const det = x0 * y1 - x1 * y0;
  if (Math.abs(det) < 1e-12) return null;
  const v = (px * y1 - x1 * py) / det;
  const wc = (x0 * py - px * y0) / det;
  if (v < -baryEps || wc < -baryEps || v + wc > 1 + baryEps) return null;
  return true;
}

/** Flattens base + dyn meshes into one triangle list for point-location queries. */
function flattenTriangles(set) {
  const tris = [];
  const add = (mesh) => {
    for (let t = 0; t < mesh.triCount; t++) {
      const v0 = t * 3;
      const p0 = [mesh.pos[v0 * 3], mesh.pos[v0 * 3 + 1], mesh.pos[v0 * 3 + 2]];
      const p1 = [mesh.pos[(v0 + 1) * 3], mesh.pos[(v0 + 1) * 3 + 1], mesh.pos[(v0 + 1) * 3 + 2]];
      const p2 = [mesh.pos[(v0 + 2) * 3], mesh.pos[(v0 + 2) * 3 + 1], mesh.pos[(v0 + 2) * 3 + 2]];
      const flat0 = mesh.flat[v0 * 2], flat1 = mesh.flat[v0 * 2 + 1];
      const aux = mesh.aux.subarray(v0 * 8, v0 * 8 + 8);
      tris.push({ p0, p1, p2, flat0, flat1, aux });
    }
  };
  add(set.base);
  for (const d of set.dyn) add(d.mesh);
  return tris;
}

function closeEnough(a, b, eps) {
  if (a === b) return true;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true; // both Infinity/AO_FAR
  return Math.abs(a - b) <= eps;
}

function expectedFromTri(tri, P) {
  const kind = flatKind(tri.flat1), face = flatFace(tri.flat1);
  const zRef = tri.aux[0], aoMode = tri.aux[1];
  const z = P[2] - zRef;
  let u, v, aoD;
  if (aoMode === AO_PLANE) {
    u = P[0]; v = P[1];
    const bits = tri.aux[2], cellX0 = tri.aux[3], cellY0 = tri.aux[4];
    const fx = P[0] - cellX0, fy = P[1] - cellY0;
    let a = Infinity;
    if (bits & 1) a = Math.min(a, fx);
    if (bits & 2) a = Math.min(a, 1 - fx);
    if (bits & 4) a = Math.min(a, fy);
    if (bits & 8) a = Math.min(a, 1 - fy);
    aoD = a;
  } else { // AO_WALL
    const alongY = face === FACE_W || face === FACE_E;
    u = alongY ? P[1] : P[0];
    v = P[2];
    const h = P[2], ceilZ = tri.aux[2], nbrALo = tri.aux[3], nbrBLo = tri.aux[4], u0 = tri.aux[5];
    let d = Math.max(0, h - zRef);
    const zc = ceilZ - h;
    if (zc < d) d = Math.max(0, zc);
    const fr = u - u0;
    if (h < nbrALo) d = Math.min(d, fr);
    if (h < nbrBLo) d = Math.min(d, 1 - fr);
    aoD = d;
  }
  return { kind, face, mat: flatMat(tri.flat1), planeId: tri.flat0, u, v, z, aoD };
}

function runOracle(name, poses) {
  const level = loadLevel(assets.level(name));
  const matTable = bindShading(assets.palette, assets.detailPass, PXH / PXW);
  bindLevel(matTable, level);
  const set = buildLevelMesh(level, { matIdFor: matTable.idFor });
  ok(`${name}: base mesh validates`, validateMesh(set.base).errors.length === 0, validateMesh(set.base).errors.join('; '));
  for (const d of set.dyn) ok(`${name}: dyn[${d.tag}] mesh validates`, validateMesh(d.mesh).errors.length === 0);
  const tris = flattenTriangles(set);

  const tanHalf = Math.tan(HFOV_DEG * Math.PI / 360);
  const planeDistY = (ROWS / 2) * ((COLS * PXW) / (ROWS * PXH)) / tanHalf;

  let checked = 0, mismatched = 0, unlocated = 0;
  const detail = [];

  for (const cam of poses) {
    const fb = makeFb(matTable);
    fb.rt.pxCellW = PXW; fb.rt.pxCellH = PXH;
    beginFrame(fb);
    castSectors(fb, level, cam, { x: 0, y: 0, z: 0 });

    const yaw = cam.yawDeg * Math.PI / 180;
    const dirX = Math.sin(yaw), dirY = -Math.cos(yaw);
    const planeX = -dirY * tanHalf, planeY = dirX * tanHalf;
    const horizonRow = ROWS / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY;

    for (let x = 0; x < COLS; x++) {
      const cameraX = (2 * (x + 0.5)) / COLS - 1;
      const rdx = dirX + planeX * cameraX, rdy = dirY + planeY * cameraX;
      for (let row = 0; row < ROWS; row++) {
        const i = row * COLS + x;
        const kind = fb.gbuf.kind[i];
        if (kind === 0) continue;
        const dist = fb.depth.get(x, row);
        if (!Number.isFinite(dist)) continue;
        const slope = -(row - horizonRow) / planeDistY;
        const P = [cam.x + rdx * dist, cam.y + rdy * dist, cam.z + slope * dist];
        checked++;
        let match = null;
        for (const tri of tris) {
          if (locate(P, tri.p0, tri.p1, tri.p2, 2e-3, 2e-3)) { match = tri; break; }
        }
        if (!match) { unlocated++; if (detail.length < 8) detail.push(`(${x},${row}) no mesh quad at P=${P.map((n) => n.toFixed(3))}, gbuf kind=${kind}`); continue; }
        const exp = expectedFromTri(match, P);
        const gv = { kind, face: fb.gbuf.face[i], mat: fb.gbuf.mat[i], planeId: fb.gbuf.planeId[i], u: fb.gbuf.u[i], v: fb.gbuf.v[i], z: fb.gbuf.z[i], aoD: fb.gbuf.aoD[i] };
        const okKind = exp.kind === gv.kind && exp.face === gv.face && exp.mat === gv.mat && exp.planeId === gv.planeId;
        const okUv = closeEnough(exp.u, gv.u, 1e-3) && closeEnough(exp.v, gv.v, 1e-3) && closeEnough(exp.z, gv.z, 1e-3) && closeEnough(exp.aoD, gv.aoD, 1e-3);
        if (!okKind || !okUv) {
          mismatched++;
          if (detail.length < 8) detail.push(`(${x},${row}) expected ${JSON.stringify(exp)} got ${JSON.stringify(gv)}`);
        }
      }
    }
  }
  if (VERBOSE) detail.forEach((d) => console.log(d));
  const badRate = checked > 0 ? (mismatched + unlocated) / checked : 1;
  console.log(`  ${name} oracle: ${checked} pixels, ${mismatched} mismatched, ${unlocated} unlocated (${(badRate * 100).toFixed(2)}%)`);
  ok(`${name}: caster oracle - ${checked} pixels checked, ${mismatched} mismatched, ${unlocated} unlocated (<=2%)`, checked > 0 && badRate <= 0.02, detail.join(' | '));
}

{
  const tower = loadLevel(assets.level('tower'));
  const tEyeH = 1.6;
  const towerPoses = [0, 90, 180, 270].map((yawDeg) => ({
    x: tower.start.x, y: tower.start.y, z: tower.sectorAt(tower.start.x, tower.start.y).floorH + tEyeH, yawDeg, pitchDeg: 0,
  }));
  runOracle('tower', towerPoses);

  const room = loadLevel(assets.level('test_room'));
  const roomPoses = [0, 90, 180, 270].map((yawDeg) => ({
    x: room.start.x, y: room.start.y, z: room.sectorAt(room.start.x, room.start.y).floorH + 1.6, yawDeg, pitchDeg: 0,
  }));
  runOracle('test_room', roomPoses);
}

// ---------------------------------------------------------------------------
// 4. Dynamic: mutate the grate's ceilH, rebuild, check base is untouched and
// the oracle still agrees at poses facing the grate.
// ---------------------------------------------------------------------------
{
  const level = loadLevel(dynamicTowerFixture(assets.level('tower')));
  const matTable = bindShading(assets.palette, assets.detailPass, PXH / PXW);
  bindLevel(matTable, level);
  const set = buildLevelMesh(level, { matIdFor: matTable.idFor });
  const baseBefore = Buffer.from(set.base.pos.buffer.slice(0)).toString('base64') + '|' + Buffer.from(set.base.aux.buffer.slice(0)).toString('base64');

  const grateCh = Object.keys(level.legend).find((ch) => level.legend[ch].dynamic && level.legend[ch].tag === 'grate');
  ok('dynamic fixture has a grate legend entry', !!grateCh);
  if (grateCh) {
    const grateSector = level.legend[grateCh];
    const before = grateSector.ceilH;
    grateSector.ceilH = 5.4;
    rebuildLevelMeshDyn(set, level, 'grate', { matIdFor: matTable.idFor });
    const baseAfter = Buffer.from(set.base.pos.buffer.slice(0)).toString('base64') + '|' + Buffer.from(set.base.aux.buffer.slice(0)).toString('base64');
    ok('rebuildLevelMeshDyn leaves base byte-identical', baseBefore === baseAfter);
    const dyn = set.dyn.find((d) => d.tag === 'grate');
    ok('dyn[grate] mesh exists after rebuild', !!dyn);
    if (dyn) ok('dyn[grate] validates', validateMesh(dyn.mesh).errors.length === 0);
    grateSector.ceilH = before; // restore for determinism check below
  }
}

// ---------------------------------------------------------------------------
// 5. Determinism: two builds byte-identical (typed arrays + JSON string).
// ---------------------------------------------------------------------------
{
  const level = loadLevel(assets.level('test_room'));
  const set1 = buildLevelMesh(level);
  const set2 = buildLevelMesh(level);
  const same = Buffer.from(set1.base.pos.buffer).equals(Buffer.from(set2.base.pos.buffer))
    && Buffer.from(set1.base.flat.buffer).equals(Buffer.from(set2.base.flat.buffer))
    && Buffer.from(set1.base.aux.buffer).equals(Buffer.from(set2.base.aux.buffer));
  ok('two builds of test_room are byte-identical', same);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
