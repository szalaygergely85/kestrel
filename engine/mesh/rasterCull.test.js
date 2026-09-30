// RE-06c (docs/architecture.md 28.10): back-face culling for voxel draws. Run: node engine/mesh/rasterCull.test.js
import { createRasterTarget, rasterDrawList } from './rasterJS.js';
import { DrawList, DRAW_STATIC, DRAW_VOXEL } from './DrawList.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { KIND_MODEL, FACE_S } from '../render/GBuffer.js';
import { makeOk } from '../test/assert.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
await import('../../design/models/voxel_props.js');
await import('../../design/models/voxel_tower.js');
const { VoxelPool } = await import('../render/voxelPool.js');
const { VoxelMeshCache } = await import('./voxelMesh.js');
const { FORWARD, computeVoxelPose } = await import('../voxel/voxelPose.js');
const { MAX_VOX_PARTS, PART_STRIDE } = await import('../voxel/VoxelModel.js');
const scratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
/** Poses `pm` (clip/frame 0) into FORWARD (the world part matrices, 12/part). */
function pose(pm, yaw = 0, clip = -1, tMs = 0) { computeVoxelPose(pm, { x: 0, y: 0, z: 0, yawDeg: yaw, clip, frame: 0, tMs }, scratch); }

const VM = globalThis.ASSETS.voxelModels;
const idMap = new Map();
const table = { idFor(k) { if (!idMap.has(k)) idMap.set(k, idMap.size + 1); return idMap.get(k); }, hasKey() { return true; } };
const keys = Object.keys(VM).filter((k) => VM[k] && VM[k].voxel);
const pool = new VoxelPool();
pool.bind({ keys: (k) => (k === 'model' ? keys : []), model: (k) => ({ voxel: VM[k].voxel }) }, table);
const cache = new VoxelMeshCache();

const C = 64, R = 48;
function viewM(cam) {
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols: C, rows: R, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M);
  return M;
}
function addModel(list, type, mesh, pm) {
  const it = list.push(mesh, type);
  if (type === DRAW_STATIC) {
    // one static item per part range, carrying that part's world matrix (never culled)
    it.rangeFirst = mesh.ranges[0].start; it.rangeCount = mesh.ranges[0].count; it.matrix.set(FORWARD.subarray(0, 12));
    for (let p = 1; p < mesh.ranges.length; p++) { const j = list.push(mesh, DRAW_STATIC); j.rangeFirst = mesh.ranges[p].start; j.rangeCount = mesh.ranges[p].count; j.matrix.set(FORWARD.subarray(p * 12, p * 12 + 12)); j.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]); }
  } else for (let p = 0; p < pm.partCount; p++) { for (let c = 0; c < 12; c++) it.partMatrices[p * 12 + c] = FORWARD[p * 12 + c]; it.partFlags[p] = 1; }
  it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
  return it;
}

// 3. det > 0 for every part of every registered model (identity FORWARD pose).
let detOk = true, nModels = 0;
for (const k of keys) {
  const pm = pool.models.get(k); if (!pm) continue; nModels++;
  for (const yw of [0, 37, 200]) { pose(pm, yw, -1, yw * 10); for (let p = 0; p < pm.partCount; p++) {
    const m = FORWARD.subarray(p * 12, p * 12 + 9);
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (!(det > 0)) { detOk = false; console.log('det', k, p, det); }
  } }
}
ok(`det > 0 for every part of ${nModels} models`, detOk);

// 1. Sign: every tri facing the eye has positive screen area; culled raster == static raster.
const pm = pool.models.get('lever');
const mesh = cache.get(pm, 'lever', pool.partNamesFor('lever'));
pose(pm);
const h = pm.sz * pm.cellM, D = 3 * h;
const cx = 0, cy = 0, cz = 0.5 * h;
const dirs = [];
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) dirs.push([a, b, c]);
let signBad = 0, front = 0, total = 0, rasterBad = 0, views = 0;
for (const pitched of [false, true]) for (const d of dirs) {
  const len = Math.hypot(...d);
  const ex = cx + d[0] / len * D, ey = cy + d[1] / len * D, ez = cz + d[2] / len * D;
  const yaw = 180 + Math.atan2(-(cx - ex), (cy - ey)) * 180 / Math.PI, pitch = Math.atan2(cz - ez, Math.hypot(cx - ex, cy - ey)) * 180 / Math.PI;
  const M = viewM({ x: ex, y: ey, z: ez, yawDeg: yaw, pitchDeg: pitched ? pitch : 0 });
  let PM = 0;
  const wld = (i) => {
    const o = PM * 12, X = mesh.pos[i * 3], Y = mesh.pos[i * 3 + 1], Z = mesh.pos[i * 3 + 2], F = FORWARD;
    return [F[o] * X + F[o + 1] * Y + F[o + 2] * Z + F[o + 9], F[o + 3] * X + F[o + 4] * Y + F[o + 5] * Z + F[o + 10], F[o + 6] * X + F[o + 7] * Y + F[o + 8] * Z + F[o + 11]];
  };
  const proj = (i) => {
    const [x, y, z] = wld(i);
    const w = M[3] * x + M[7] * y + M[11] * z + M[15];
    return [(M[0] * x + M[4] * y + M[8] * z + M[12]) / w, (M[1] * x + M[5] * y + M[9] * z + M[13]) / w, w];
  };
  const n3 = [0, 0, 1];
  for (let t = 0; t < mesh.triCount; t++) {
    PM = mesh.ranges.findIndex((r) => t >= r.start && t < r.start + r.count);
    const a = proj(t * 3), b = proj(t * 3 + 1), c = proj(t * 3 + 2);
    if (a[2] <= 0 || b[2] <= 0 || c[2] <= 0) continue;
    unpackNormalOct(mesh.nrm[t * 3], n3);
    const o = PM * 12, F = FORWARD, [px, py, pz] = wld(t * 3);
    const wn = [F[o] * n3[0] + F[o + 1] * n3[1] + F[o + 2] * n3[2], F[o + 3] * n3[0] + F[o + 4] * n3[1] + F[o + 5] * n3[2], F[o + 6] * n3[0] + F[o + 7] * n3[1] + F[o + 8] * n3[2]];
    const facing = wn[0] * (ex - px) + wn[1] * (ey - py) + wn[2] * (ez - pz);
    const A2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    total++;
    if (facing > 1e-2) { front++; if (!(A2 > 0)) { signBad++; if (signBad < 4) console.log('bad', t, PM, facing, A2, d, pitched); } }
    else if (facing < -1e-2 && !(A2 < 0)) signBad++;
  }
  const rt = (type) => { const tg = createRasterTarget(C, R, 1, {}); const l = new DrawList(4); l.begin(); addModel(l, type, mesh, pm); rasterDrawList(l, tg, { M, snap: true }); return tg; };
  const tc = rt(DRAW_VOXEL), ts = rt(DRAW_STATIC);
  views++;
  for (const f of ['kind', 'mat', 'planeId', 'depth', 'u', 'v', 'z']) for (let i = 0; i < tc[f].length; i++) if (tc[f][i] !== ts[f][i]) { rasterBad++; break; }
}
ok(`front-face screen area sign (${front}/${total} front tris, ${views} views shear+pitched)`, signBad === 0, `bad=${signBad}`);
ok('culled voxel raster == uncull static raster (kind/mat/planeId/depth/uv/z)', rasterBad === 0, `bad=${rasterBad}`);

// 2. Open quad seen from behind: static still draws, voxel is culled.
{
  const b = new StaticMeshBuilder('open_quad');
  b.beginRange('p0');
  const mat = b.matIndex('vox');
  b.addQuad([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, -0.5, -0.5, 1], [0, 0, 1, 0, 1, 1, 0, 1], 0, -1, 0, 0, packFlat1(KIND_MODEL, FACE_S, mat), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  const q = b.build();
  const count = (type, camY) => {
    const M = viewM({ x: 0, y: camY, z: 0.5, yawDeg: camY < 0 ? 180 : 0, pitchDeg: 0 });
    const tg = createRasterTarget(C, R, 1, {}); const l = new DrawList(4); l.begin();
    const it = l.push(q, type);
    if (type === DRAW_STATIC) { it.rangeFirst = 0; it.rangeCount = q.triCount; it.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); }
    else { it.partMatrices.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); it.partFlags[0] = 0; }
    it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
    rasterDrawList(l, tg, { M, snap: true });
    let n = 0; for (let i = 0; i < tg.kind.length; i++) if (tg.kind[i]) n++; return n;
  };
  const sFront = count(DRAW_STATIC, -4), sBack = count(DRAW_STATIC, 4), vFront = count(DRAW_VOXEL, -4), vBack = count(DRAW_VOXEL, 4);
  ok(`static open quad drawn from both sides (${sFront}/${sBack})`, sFront > 0 && sBack > 0);
  ok(`voxel quad front drawn (${vFront}), back culled (${vBack})`, vFront > 0 && vBack === 0);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
