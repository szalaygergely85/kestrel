// engine/mesh/vertexAo.test.js - ME-20c-a (docs/architecture.md 38.18): corner rule, rasterJS vao lane (perspective-correct),
// GBuffer.vao hand-off, and the lightSurfaces vao term. Run: node engine/mesh/vertexAo.test.js
import { createRasterTarget, rasterDrawList, copyToGBuffer } from './rasterJS.js';
import { DrawList, DRAW_STATIC, MeshDrawCache } from './DrawList.js';
import { buildMeshFromTris } from './gltf.js';
import { AUX_STRIDE } from './MeshData.js';
import { meshHasVertexAo, vertexAoAt } from './vertexAo.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { KIND_MESH, GBuffer, FACE_U } from '../render/GBuffer.js';
import { LightSet, setLook, lightSurfaces, makeLightBuffer } from '../render/lighting.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 400, ROWS = 150;
const YAW = 35 * Math.PI / 180, CX = 0.4, CY = 3, CZ = 1.5;
const lx = Math.cos(YAW), ly = Math.sin(YAW);
const corner = (s, t) => [CX + s * lx, CY + s * ly, CZ + t];
const P = { tl: corner(-1, 1), tr: corner(1, 1), br: corner(1, -1), bl: corner(-1, -1) };
function fn(a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n); return [n[0] / l, n[1] / l, n[2] / l];
}
const tri = (a, b, c) => ({ p0: P[a], p1: P[b], p2: P[c], normal: fn(P[a], P[b], P[c]), matName: 'm' });
let tris = [tri('tl', 'bl', 'br'), tri('tl', 'br', 'tr')];
if (tris[0].normal[1] > 0) tris = [tri('tl', 'br', 'bl'), tri('tl', 'tr', 'br')];
const mk = (id) => { const m = buildMeshFromTris(tris, [{ part: 'm', triStart: 0, triCount: 2 }], id); m.mats = { m: 'm' }; return m; };
const plain = mk('test/plain');
const aoMesh = mk('test/ao');
const AO_T = [[1, 0.5, 0], [0.25, 1, 0.75]]; // per-triangle corner triples (vertex c of triangle t reads lane 5 + c)
for (let t = 0; t < 2; t++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) aoMesh.aux[(3 * t + c) * AUX_STRIDE + 5 + k] = AO_T[t][k];

// --- vertexAo.js: corner rule + detection ---
ok('plain mesh: meshHasVertexAo false', !meshHasVertexAo(plain));
ok('AO mesh: meshHasVertexAo true', meshHasVertexAo(aoMesh));
ok('corner rule: vertex 3t+c reads lane 5+c', [0, 1, 2, 3, 4, 5].every((v) => vertexAoAt(aoMesh, v) === AO_T[(v / 3) | 0][v % 3]));
{
  const m = mk('test/lane04'); // lanes 0..4 (zRef, aoMode, ...) are never "vertex AO"
  for (let v = 0; v < 6; v++) for (const k of [0, 2, 3, 4]) m.aux[v * AUX_STRIDE + k] = 0.5;
  ok('detection ignores lanes 0..4', !meshHasVertexAo(m));
  ok('non-static layout / null: false', !meshHasVertexAo({ layout: 'terrain' }) && !meshHasVertexAo(null));
}

// --- rasterJS ---
const frontCam = { x: 0, y: 0, z: 1.5, yawDeg: 180, pitchDeg: 0 };
const idFor = () => 5;
function render(mesh) {
  const terms = {}, M = new Float64Array(16);
  projTerms(frontCam, { cols: COLS, rows: ROWS }, terms); shearProjection(terms, M);
  const dm = new MeshDrawCache().get(mesh, idFor, null);
  const list = new DrawList(4); list.begin();
  const it = list.push(dm, DRAW_STATIC);
  it.rangeFirst = 0; it.rangeCount = dm.triCount; it.aabb.set([-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]);
  it.planeIdOr = 3 * 1048576; it.objectId = 0xA000;
  const target = createRasterTarget(COLS, ROWS, 1, {});
  rasterDrawList(list, target, { M });
  return { target, terms };
}
const rp = render(plain), ra = render(aoMesh);
let covered = 0, plainOne = true, same = true;
for (const k of ['zbuf', 'depth', 'kind', 'face', 'mat', 'planeId', 'u', 'v', 'z', 'aoD', 'nrm', 'objectId']) {
  for (let i = 0; i < rp.target[k].length; i++) if (!Object.is(rp.target[k][i], ra.target[k][i])) { same = false; break; }
}
for (let i = 0; i < COLS * ROWS; i++) if (rp.target.kind[i] === KIND_MESH) { covered++; if (rp.target.vao[i] !== 1) plainOne = false; }
ok('quad covers cells', covered > 500, String(covered));
ok('no-AO mesh: vao == 1 on every kind-9 cell', plainOne);
ok('AO mesh: every other plane byte-identical to the no-AO mesh', same);

// analytic oracle: ray vs the quad plane, barycentric blend of the corner AO (affine in the plane == world barycentric)
function expectedAo(terms, col, row) {
  const cx = (2 * (col + 0.5)) / terms.cols - 1;
  const rdx = terms.dirX + terms.planeX * cx, rdy = terms.dirY + terms.planeY * cx;
  const slope = (terms.horizonRow - (row + 0.5)) / terms.planeDistY;
  const nx = -ly, ny = lx, den = nx * rdx + ny * rdy;
  const t = (nx * (CX - terms.eyeX) + ny * (CY - terms.eyeY)) / den;
  const hs = (terms.eyeX + rdx * t - CX) * lx + (terms.eyeY + rdy * t - CY) * ly, ht = terms.eyeZ + slope * t - CZ;
  for (let tr = 0; tr < 2; tr++) {
    const q = [0, 1, 2].map((c) => { const o = (3 * tr + c) * 3; const p = aoMesh.pos; return [(p[o] - CX) * lx + (p[o + 1] - CY) * ly, p[o + 2] - CZ]; });
    const d = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
    const b1 = ((hs - q[0][0]) * (q[2][1] - q[0][1]) - (ht - q[0][1]) * (q[2][0] - q[0][0])) / d;
    const b2 = ((q[1][0] - q[0][0]) * (ht - q[0][1]) - (q[1][1] - q[0][1]) * (hs - q[0][0])) / d;
    const b0 = 1 - b1 - b2, eps = 1e-6;
    if (b0 >= -eps && b1 >= -eps && b2 >= -eps) return { v: b0 * AO_T[tr][0] + b1 * AO_T[tr][1] + b2 * AO_T[tr][2], edge: Math.min(b0, b1, b2) };
  }
  return null;
}
{
  let n = 0, worst = 0, inRange = true, differs = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (ra.target.kind[i] !== KIND_MESH) continue;
    const e = expectedAo(ra.terms, i % COLS, (i / COLS) | 0);
    if (!e || e.edge < 0.02) continue; // skip silhouette / diagonal texels (snap tolerance)
    n++;
    const got = ra.target.vao[i];
    worst = Math.max(worst, Math.abs(got - e.v));
    if (got < -1e-6 || got > 1 + 1e-6) inRange = false;
    if (got !== 1) differs++;
  }
  ok('interior samples match the analytic perspective-correct value (< 0.02)', n > 400 && worst < 0.02, `n=${n} worst=${worst}`);
  ok('vao stays inside [0, 1]', inRange);
  ok('AO actually varies across the quad', differs > 100, String(differs));
}

// --- copyToGBuffer hands vao over ---
{
  const gb = new GBuffer(COLS, ROWS);
  copyToGBuffer(ra.target, gb, new Float32Array(COLS * ROWS));
  let eq = true;
  for (let i = 0; i < COLS * ROWS; i++) if (ra.target.kind[i] === KIND_MESH && gb.vao[i] !== ra.target.vao[i]) eq = false;
  ok('copyToGBuffer copies vao for kind-9 cells', eq);
}

// --- lightSurfaces vao term (end to end in the JS twin: corner darker than open) ---
{
  const cols = 5, rows = 1;
  const depth = new Float32Array(cols).fill(0.3570456373959812);
  const rt = { pxCellW: 1, pxCellH: 1 }, cam = { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: -80 };
  function run(kindV, vaoV, strength) {
    const kind = new Uint8Array(cols).fill(kindV);
    const vao = Float32Array.from(vaoV);
    const gbuf = { kind, face: new Uint8Array(cols).fill(FACE_U), aoD: new Float32Array(cols), vao, cols, rows };
    const ls = new LightSet();
    ls.ambient[0] = 0.2; ls.ambient[1] = 0.25; ls.ambient[2] = 0.3;
    if (strength > 0) setLook(ls, { hemi: null, clouds: null, ao: { strength, radiusM: 1.5, bias: 0.1, maxCells: 2 } });
    ls.update(0, null);
    const lb = makeLightBuffer(cols, rows);
    lightSurfaces({ gbuf, depth: { depth }, rt, light: lb }, ls, cam, null);
    return { rgb: lb.rgb, amb: ls.ambient };
  }
  const open = [1, 1, 1, 1, 1], mixed = [1, 0.5, 0, 1, 0.5];
  const base = run(KIND_MESH, mixed, 0), openS1 = run(KIND_MESH, open, 1), mixS1 = run(KIND_MESH, mixed, 1);
  ok('strength 0: vao has no effect (byte-identical)', run(KIND_MESH, open, 0).rgb.every((v, i) => v === base.rgb[i]));
  ok('strength 1, all vao = 1: byte-identical to the horizon-only result (open floor)', openS1.rgb.every((v, i) => v === base.rgb[i]));
  ok('corner (vao 0) darker than open (vao 1), every channel', [0, 1, 2].every((c) => mixS1.rgb[2 * 3 + c] < openS1.rgb[2 * 3 + c]));
  ok('half-occluded between open and corner', mixS1.rgb[3] < openS1.rgb[3] && mixS1.rgb[3] > mixS1.rgb[6]);
  ok('vao = 1 cells untouched', [0, 3].every((x) => [0, 1, 2].every((c) => mixS1.rgb[x * 3 + c] === openS1.rgb[x * 3 + c])));
  let bounded = true, never = true;
  for (let x = 0; x < cols; x++) for (let c = 0; c < 3; c++) {
    if (openS1.rgb[x * 3 + c] - mixS1.rgb[x * 3 + c] < -1e-6) never = false;
    if (mixS1.rgb[x * 3 + c] < base.rgb[x * 3 + c] - 0.6 * base.amb[c] - 1e-6) bounded = false;
  }
  ok('never brightens; bounded by 0.6 * ambient', never && bounded);
  ok('min not product: vao 0 darkens by exactly 0.6 * ambient (open horizon)', Math.abs((openS1.rgb[6] - mixS1.rgb[6]) - 0.6 * base.amb[0]) < 1e-6, String(openS1.rgb[6] - mixS1.rgb[6]));
  const garbage = run(1, [0, 0, 0, 0, 0], 1); // kind 1 (not mesh) with garbage vao
  ok('garbage vao on non-mesh cells changes nothing', garbage.rgb.every((v, i) => v === openS1.rgb[i]));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILED:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
else console.log('ALL PASS');
