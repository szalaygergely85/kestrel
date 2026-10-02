// engine/mesh/clothMesh.test.js (CLOTH-1b1, docs/architecture.md 33.5, 27.9a amendment 4).
// Cloth MeshData build/update, normals, two-sided rule in rasterJS, coverage/depth vs an analytic quad,
// shadow list + dirty-skip hash. Run: node engine/mesh/clothMesh.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClothMesh, updateClothMesh } from './clothMesh.js';
import { validateMesh } from './MeshData.js';
import { DrawList, DRAW_CLOTH, LevelMeshCache, addCloths, pushClothItem } from './DrawList.js';
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { buildShadowList, createShadowList } from './shadowList.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { createSunShadowMatrix, shadowSunMatrix, shadowInputHash, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { KIND_MODEL, FACE_PACKED } from '../render/GBuffer.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { dirFromAzEl } from '../core/transform.js';
import { createCloth } from '../physics/cloth.js';
import { createClothSystem } from '../world/cloths.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Plain grid "cloth" (the fields clothMesh reads): f(x, z) maps the grid coordinate to a world position. */
function gridCloth(cols, rows, sp, f) {
  const n = cols * rows, pos = new Float64Array(3 * n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const p = f(c * sp, r * sp); pos.set(p, 3 * (r * cols + c)); }
  const tri = new Uint16Array(6 * (cols - 1) * (rows - 1));
  let t = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    tri[t++] = a; tri[t++] = d; tri[t++] = b; tri[t++] = b; tri[t++] = d; tri[t++] = e;
  }
  return { pos, n, cols, rows, tri, version: 1, bbox: new Float64Array(6) };
}
const nrmOf = (mesh, i, out) => { unpackNormalOct(mesh.nrm[i], out); return out; };
const o3 = new Float64Array(3);

// ---- 1. build from a real cloth + validateMesh ---------------------------------------------------
function realCloth(cols = 24, rows = 16, sp = 0.08) {
  const rest = new Float64Array(3 * cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const k = r * cols + c; rest[3 * k] = 1000 + c * sp; rest[3 * k + 1] = 500; rest[3 * k + 2] = 5 - r * sp; }
  return createCloth({ cols, rows, rest, pins: Array.from({ length: cols }, (_, i) => i), seed: 1 });
}
{
  const cloth = realCloth();
  const mesh = createClothMesh(cloth, 'banner', 7, [1000, 500, 5]);
  const v = validateMesh(mesh);
  ok('validateMesh accepts the cloth layout', v.errors.length === 0, v.errors.join(' | '));
  ok('layout/id/matId/idx shared with the sim', mesh.layout === 'cloth' && mesh.id === 'cloth:banner' && mesh.matId === 7 && mesh.idx === cloth.tri && mesh.triCount === cloth.tri.length / 3);
  ok('positions are mesh-local (world - origin): sub-mm precision at x ~ 1000', Math.abs(mesh.pos[3] - (cloth.pos[3] - 1000)) < 1e-6 && mesh.bbox[0] > -1 && mesh.bbox[3] < 3);
  ok('uv = rest-space metres (u along cols, v along rows)', Math.abs(mesh.uv[2 * 5] - 5 * 0.08) < 1e-6 && Math.abs(mesh.uv[2 * (3 * 24) + 1] - 3 * 0.08) < 1e-6);
  const bad = { ...mesh, uv: new Float32Array(3) };
  ok('validateMesh rejects a cloth with a wrong uv length', validateMesh(bad).errors.some((e) => e.startsWith('uv')));
  ok('validateMesh rejects an unknown layout', validateMesh({ ...mesh, layout: 'nope' }).errors.length > 0);

  // version gating: no sim change -> no rewrite
  ok('update at the same cloth.version is a no-op (false)', updateClothMesh(mesh, cloth) === false);
  const before = mesh.pos.slice(); const mv = mesh.meshVersion;
  for (let i = 0; i < 30; i++) cloth.step(3, 1, 0, null);
  ok('the cloth moved (version bumped)', cloth.version > 0);
  ok('update after a sim change rewrites (true), meshVersion untouched (the system owns it)', updateClothMesh(mesh, cloth) === true && mesh.meshVersion === mv && mesh.clothVersion === cloth.version);
  let diff = 0; for (let i = 0; i < before.length; i++) diff = Math.max(diff, Math.abs(before[i] - mesh.pos[i]));
  ok('positions follow the sim', diff > 1e-3, `max=${diff}`);
  ok('moved mesh still validates (bbox contains vertices)', validateMesh(mesh).errors.length === 0);
  const m2 = createClothMesh(cloth, 'x', 1, [0, 0, 0]);
  const v0 = m2.meshVersion; cloth.version++; updateClothMesh(m2, cloth, true);
  ok('bump=true bumps meshVersion for system-less meshes', m2.meshVersion === v0 + 1);

  // zero allocation + perf of the per-step update at 24x16
  const heap = () => { global.gc(); return process.memoryUsage().heapUsed; };
  for (let i = 0; i < 200; i++) { cloth.version++; updateClothMesh(mesh, cloth); } // warm
  const h0 = heap();
  const N = 5000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { cloth.version++; updateClothMesh(mesh, cloth); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const h1 = heap();
  ok('updateClothMesh allocates nothing over 5000 updates (24x16)', h1 - h0 < 20000, `delta=${h1 - h0} B`);
  console.log(`  perf: updateClothMesh 24x16 = ${(ms * 1000).toFixed(1)} us/update`);
  if (ms > 0.1) console.log(`  WARN: updateClothMesh ${ms.toFixed(3)} ms > 0.1 ms`);
}

// ---- 2. normals: flat sheet, folded sheet ---------------------------------------------------------
{
  // sheet in the x-z plane (normal +-y)
  const flat = gridCloth(8, 6, 0.1, (x, z) => [x, 0, z]);
  const m = createClothMesh(flat, 'flat', 1, [0, 0, 0]);
  let worst = 0, sign = 0, consistent = true;
  for (let i = 0; i < flat.n; i++) {
    nrmOf(m, i, o3);
    worst = Math.max(worst, Math.abs(o3[0]), Math.abs(o3[2]), 1 - Math.abs(o3[1]));
    const s = Math.sign(o3[1]); if (sign === 0) sign = s; else if (s !== sign) consistent = false;
  }
  ok('flat sheet: every vertex normal is +-y within 1e-3', worst < 1e-3, `worst=${worst}`);
  ok('flat sheet: one consistent orientation (winding)', consistent && sign !== 0);

  // folded: ridge along the column x = 0.6: y = a*|x - 0.6| (45 degree faces), sheet spans x in [0, 1.2]
  const a = 1;
  const fold = gridCloth(13, 5, 0.1, (x, z) => [x, a * Math.abs(x - 0.6), z]);
  const mf = createClothMesh(fold, 'fold', 1, [0, 0, 0]);
  const s2 = Math.SQRT1_2;
  let errFace = 0, sg = 0, cons = true;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 13; c++) {
    if (c === 6) continue; // crease column
    nrmOf(mf, r * 13 + c, o3);
    // y = a|x-0.6|: dy/dx = a*sign(x-0.6); normal ~ (-dy/dx, 1, 0)
    const ex = -a * (c < 6 ? -1 : 1) * s2, ey = s2;
    const d = o3[0] * ex + o3[1] * ey;
    errFace = Math.max(errFace, 1 - Math.abs(d));
    const s = Math.sign(d); if (sg === 0) sg = s; else if (s !== sg) cons = false;
  }
  ok('folded sheet: flat-region vertex normals equal the analytic face normal within 1e-3', errFace < 1e-3, `err=${errFace}`);
  ok('folded sheet: same orientation on both sides of the fold', cons);
  // crease vertices: the smooth normal is the average of both faces = +-y
  let errC = 0;
  for (let r = 1; r < 4; r++) { nrmOf(mf, r * 13 + 6, o3); errC = Math.max(errC, Math.abs(o3[0]), 1 - Math.abs(o3[1])); }
  ok('folded sheet: crease vertex normal = average of both faces (+-y) within 1e-3', errC < 1e-3, `err=${errC}`);
}

// ---- 3. rasterJS: coverage/depth vs an analytic quad, two-sided normals ---------------------------
function camTerms(cam, grid) { const terms = {}, M = new Float64Array(16); projTerms(cam, grid, terms); shearProjection(terms, M); return { terms, M }; }
function hitAtY(terms, col, row, planeY) {
  const cx = (2 * (col + 0.5)) / terms.cols - 1;
  const rdx = terms.dirX + terms.planeX * cx, rdy = terms.dirY + terms.planeY * cx;
  const slope = (terms.horizonRow - row) / terms.planeDistY;
  const dist = (planeY - terms.eyeY) / rdy;
  return { x: terms.eyeX + rdx * dist, y: planeY, z: terms.eyeZ + slope * dist };
}
{
  const cols = 64, rows = 48;
  // quad: x in [-1, 1], z in [0.5, 2.5] at y = 0, many triangles (8 x 8 cells)
  const sheet = gridCloth(9, 9, 0.25, (x, z) => [x - 1, 0, z + 0.5]);
  const mesh = createClothMesh(sheet, 'quad', 5, [0, 0, 0]);
  const sys = { count: 1, cloths: [sheet], meshes: [mesh], mats: [null], castShadow: [1], drawn: 0, markDrawn() { this.drawn++; } };

  const render = (cam) => {
    const { terms, M } = camTerms(cam, { cols, rows });
    const target = createRasterTarget(cols, rows, 1);
    const list = new DrawList(8);
    list.begin();
    const planes = new Float64Array(24); frustumPlanes(M, planes);
    addCloths(list, sys, planes);
    rasterDrawList(list, target, { M, terms, snap: true });
    return { target, terms, list };
  };
  const front = render({ x: 0, y: 5, z: 1.5, yawDeg: 0, pitchDeg: 0 }); // forward = -y
  const back = render({ x: 0, y: -5, z: 1.5, yawDeg: 180, pitchDeg: 0 }); // forward = +y
  ok('addCloths pushes one DRAW_CLOTH item with the 33.5 ids and marks it drawn', front.list.count === 1 && front.list.items[0].type === DRAW_CLOTH
    && front.list.items[0].objectId === 0x9000 && (front.list.items[0].planeIdOr >>> 0) === ((0xD << 28) >>> 0) && sys.drawn === 2);

  for (const [name, r, eyeY] of [['front', front, 5], ['back', back, -5]]) {
    const t = r.target;
    let inside = 0, missed = 0, outside = 0, wrong = 0, worstDepth = 0, attrBad = 0;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const h = hitAtY(r.terms, col, row, 0), i = row * cols + col;
      const mx = Math.min(1 - Math.abs(h.x), h.z - 0.5, 2.5 - h.z); // metres inside the quad edge (> 0 inside)
      if (mx > 0.06) {
        inside++;
        if (t.kind[i] === 0) missed++;
        else {
          worstDepth = Math.max(worstDepth, Math.abs(t.depth[i] - Math.abs(eyeY)));
          if (t.kind[i] !== KIND_MODEL || t.face[i] !== FACE_PACKED || t.mat[i] !== 5 || t.objectId[i] !== 0x9000) attrBad++;
        }
      } else if (mx < -0.06) { outside++; if (t.kind[i] !== 0) wrong++; }
    }
    ok(`${name}: every pixel inside the analytic quad is covered`, inside > 200 && missed === 0, `inside=${inside} missed=${missed}`);
    ok(`${name}: no pixel outside the analytic quad is covered`, outside > 100 && wrong === 0, `outside=${outside} wrong=${wrong}`);
    ok(`${name}: depth = analytic distance to the plane within 2e-3`, worstDepth < 2e-3, `worst=${worstDepth}`);
    ok(`${name}: kind 8 / face 7 / mat / objectId on every covered pixel`, attrBad === 0, `bad=${attrBad}`);
  }
  // two-sided rule: N faces the eye from both sides; the two views differ by a sign
  const c = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  const nF = new Float64Array(3), nB = new Float64Array(3);
  unpackNormalOct(front.target.nrm[c], nF); unpackNormalOct(back.target.nrm[c], nB);
  ok('front view: N faces the eye (+y)', nF[1] > 0.999, `n=${Array.from(nF)}`);
  ok('back view: N faces the eye (-y)', nB[1] < -0.999, `n=${Array.from(nB)}`);
  ok('opposite views give opposite N', Math.abs(nF[0] + nB[0]) < 1e-3 && Math.abs(nF[1] + nB[1]) < 1e-3 && Math.abs(nF[2] + nB[2]) < 1e-3);
  // RE-06c: dot(vertexNormal, eye - p) > 0 <=> A2 > 0 (the fragment keeps the vertex normal); otherwise it is flipped.
  nrmOf(mesh, 4 * 9 + 4, o3);
  const keep = o3[1] > 0 ? nF : nB; // the side the vertex normal faces
  ok('the side the vertex normal faces sees it unchanged (A2 > 0); the other side sees it flipped', Math.abs(keep[0] - o3[0]) < 1e-3 && Math.abs(keep[1] - o3[1]) < 1e-3 && Math.abs(keep[2] - o3[2]) < 1e-3, `keep=${Array.from(keep)} vn=${Array.from(o3)}`);

  // addCloths frustum cull: a camera looking away does not draw or mark the cloth
  const sys2 = { count: 1, cloths: [sheet], meshes: [mesh], mats: [null], drawn: 0, markDrawn() { this.drawn++; } };
  const { M } = camTerms({ x: 0, y: 5, z: 1.5, yawDeg: 180, pitchDeg: 0 }, { cols, rows });
  const planes = new Float64Array(24); frustumPlanes(M, planes);
  const l2 = new DrawList(4); l2.begin(); addCloths(l2, sys2, planes);
  ok('addCloths drops a cloth outside the frustum and does not mark it drawn', l2.count === 0 && sys2.drawn === 0);

  // depth-only target (the sun map path) covers the same pixels
  const { M: M3 } = camTerms({ x: 0, y: 5, z: 1.5, yawDeg: 0, pitchDeg: 0 }, { cols, rows });
  const dt = createRasterTarget(cols, rows, 1, { depthOnly: true });
  const l3 = new DrawList(4); l3.begin(); pushClothItem(l3, sys, 0);
  rasterDrawList(l3, dt, { M: M3, depthBias: { factor: 0, units: 0 } });
  let cov = 0; for (let i = 0; i < dt.zbuf.length; i++) if (dt.zbuf[i] < 1) cov++;
  let covC = 0; for (let i = 0; i < front.target.kind.length; i++) if (front.target.kind[i]) covC++;
  ok('depth-only (shadow) raster covers the same pixels as the colour raster', Math.abs(cov - covC) <= 4 && cov > 200, `depthOnly=${cov} colour=${covC}`);
}

// ---- 4. shadow list + dirty-skip hash --------------------------------------------------------------
{
  const world = { structures: [], structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 192 };
  const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
  const centre = [0, 0, 0];
  const sm = createSunShadowMatrix();
  shadowSunMatrix(sunDir, centre, OPTS, { min: 0, max: 10 }, sm);
  const near = gridCloth(5, 5, 0.25, (x, z) => [x - 0.5, 20, z + 1]); // 20 m from the shadow centre
  const far = gridCloth(5, 5, 0.25, (x, z) => [x + 900, 900, z + 1]); // far outside the shadow box
  const mk = (cl) => createClothMesh(cl, 'c', 3, [0, 0, 0]);
  const sys = { count: 3, cloths: [near, far, near], meshes: [mk(near), mk(far), null], mats: [null, null, null], castShadow: [1, 1, 0] };
  const sl = createShadowList();
  buildShadowList(sl, null, world, sm.planes, { centre: { x: 0, y: 0, z: 0 }, cache, cloths: sys });
  let nCloth = 0; const ids = [];
  for (let i = 0; i < sl.count; i++) if (sl.items[i].type === DRAW_CLOTH) { nCloth++; ids.push(sl.items[i].objectId); }
  ok('shadow list holds the casting cloth inside the shadow box (not the far one, not castShadow:0)', nCloth === 1 && ids[0] === 0x9000, `n=${nCloth} ids=${ids}`);
  ok('shadow list does not create meshes for castShadow:0 cloths', sys.meshes[2] === null);

  // hash: a moving cloth (the system bumps meshVersion) changes it; at rest it does not
  const M = sm.M;
  const lst = new DrawList(8);
  const hash = () => { lst.begin(); pushClothItem(lst, sys, 0); const o = shadowInputHash(lst, M, 1, new Int32Array(2)); return o[0] + ':' + o[1]; };
  const h0 = hash();
  ok('hash is stable while the cloth rests', hash() === h0 && hash() === h0);
  const mesh0 = sys.meshes[0];
  for (let i = 0; i < near.pos.length; i += 3) near.pos[i + 1] += 0.2 * Math.sin(i); // the sim moved the nodes
  near.version++;
  mesh0.meshVersion++; // what cloths.tick does
  ok('hash changes when the cloth moves (meshVersion bumped)', hash() !== h0);
  const h1 = hash();
  ok('and is stable again once it rests', hash() === h1);
  ok('the moved mesh arrays were refreshed (clothVersion follows)', mesh0.clothVersion === near.version);
}

// ---- 5. review fixes: system rest-space uv, matId re-resolve -------------------------------------
{
  const wind = { sampleInto: (x, y, z, t, o) => { o[0] = 0; o[1] = 6 + Math.sin(t * 0.3) * 3; o[2] = 0; } };
  const sys = createClothSystem([{ id: 'b', mat: 'cloth_red', cols: 8, rows: 6, size: [1.4, 1], origin: [0, 0, 2], yawDeg: 0, plane: 'vertical', pins: [[0, 0], [7, 0]] }], { groundAt: () => 0 });
  for (let t = 0; t < 30; t++) { sys.markDrawn(0); sys.tick(t, wind, 3, -3, 2); } // windy ticks BEFORE the lazy mesh creation
  const l = new DrawList(4); l.begin();
  pushClothItem(l, sys, 0); // no matIdFor
  const m = sys.meshes[0];
  const dx = 1.4 / 7, dy = 1 / 5;
  ok('system cloth after warm-up + windy ticks: uv is exact rest-space', m.uv[2 * 5] === Math.fround(5 * dx) && m.uv[2 * (2 * 8) + 1] === Math.fround(2 * dy) && m.uv[2 * 5 + 1] === 0, `u5=${m.uv[10]} want ${Math.fround(5 * dx)}`);
  ok('first push without matIdFor -> matId 0', m.matId === 0);
  l.begin(); pushClothItem(l, sys, 0, (k) => (k === 'cloth_red' ? 9 : 1));
  ok('a later push with matIdFor resolves the real id', m.matId === 9, `matId=${m.matId}`);
  const idFor = (k) => 4; l.begin(); pushClothItem(l, sys, 0, idFor);
  ok('a different resolver re-resolves once, the same one does not', m.matId === 4 && (l.begin(), pushClothItem(l, sys, 0, idFor), m.matId === 4));
}

console.log(`clothMesh tests: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
