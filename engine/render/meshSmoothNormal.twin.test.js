// MESH-GPUCMP-01 (docs/architecture.md 37.1 A6): Node twin of mesh.frag.js's kind-9 smooth-normal branch.
// rasterJS rasterises a yawed (33 deg) smooth mesh; for every kind-9 cell a JS transcription of the GLSL formulas
// (normalize, `max|n_i| >= 0.9 ? roundedFace : FACE_PACKED`, packNormalOct) must give the same face and a packed
// normal within the oct round-trip tolerance (1e-3) of what rasterJS wrote.
import { readFileSync } from 'node:fs';
import { meshFromJSON, resolveMats } from '../mesh/MeshData.js';
import { DrawList, DRAW_STATIC } from '../mesh/DrawList.js';
import { createRasterTarget, rasterDrawList } from '../mesh/rasterJS.js';
import { projTerms, shearProjection } from './projection.js';
import { KIND_MESH, FACE_PACKED, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D } from './GBuffer.js';
import { packNormalOct, unpackNormalOct } from '../voxel/octNormal.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Transcription of mesh.frag.js (Float32 like the GPU): roundedFace + the kind-9 branch.
function glslKind9(nx, ny, nz) {
  const f = Math.fround;
  const len = f(Math.sqrt(f(f(nx * nx) + f(ny * ny) + f(nz * nz))));
  const x = f(nx / len), y = f(ny / len), z = f(nz / len);
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face;
  if (Math.max(ax, ay, az) >= 0.9) {
    if (ax >= ay && ax >= az) face = x >= 0 ? FACE_E : FACE_W;
    else if (ay >= ax && ay >= az) face = y >= 0 ? FACE_S : FACE_N;
    else face = z >= 0 ? FACE_U : FACE_D;
  } else face = FACE_PACKED;
  return { face, bits: packNormalOct(x, y, z), n: [x, y, z] };
}

const mesh = meshFromJSON(JSON.parse(readFileSync(new URL('../../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url), 'utf8')));
resolveMats(mesh, () => 17);
const COLS = 80, ROWS = 40, origin = [1000, 700, 0], yaw = 33 * Math.PI / 180;
const c = Math.cos(yaw), s = Math.sin(yaw);
let cells = 0, faceDiff = 0, nrmBad = 0, packedCells = 0, axisCells = 0;
const n = [0, 0, 0], m = [0, 0, 0];
for (let pose = 0; pose < 6; pose++) {
  const yawDeg = pose * 60, angle = yawDeg * Math.PI / 180;
  const cam = { x: origin[0] - 3 * Math.sin(angle), y: origin[1] + 3 * Math.cos(angle), z: 0.9, yawDeg, pitchDeg: -8 };
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols: COLS, rows: ROWS }, terms); shearProjection(terms, M);
  const list = new DrawList(1); list.begin();
  const item = list.push(mesh, DRAW_STATIC); item.rangeCount = mesh.triCount;
  item.matrix.set([c, -s, 0, s, c, 0, 0, 0, 1, ...origin]);
  const target = createRasterTarget(COLS, ROWS, 1);
  rasterDrawList(list, target, { M, snap: true });
  for (let i = 0; i < COLS * ROWS; i++) {
    if (target.kind[i] !== KIND_MESH) continue;
    cells++;
    unpackNormalOct(target.nrm[i], n);
    const g = glslKind9(n[0], n[1], n[2]);
    if (g.face !== target.face[i]) faceDiff++;
    unpackNormalOct(g.bits, m);
    if (Math.hypot(m[0] - n[0], m[1] - n[1], m[2] - n[2]) > 1e-3) nrmBad++;
    if (target.face[i] === FACE_PACKED) packedCells++; else axisCells++;
  }
}
console.log(`kind-9 cells ${cells}: packed ${packedCells}, axis ${axisCells}, faceDiff ${faceDiff}, nrmBad ${nrmBad}`);
ok('twin covers kind-9 cells', cells > 100, String(cells));
ok('yawed smooth mesh yields both axis faces and face 7', packedCells > 0 && axisCells > 0, `${packedCells}/${axisCells}`);
ok('GLSL-formula face == rasterJS face on every cell', faceDiff === 0, String(faceDiff));
ok('packed normal within oct round-trip tolerance 1e-3', nrmBad === 0, String(nrmBad));
// Axis-near normal: just above and below the 0.9 threshold.
const hi = Math.sqrt(1 - 0.89 * 0.89), lo = Math.sqrt(1 - 0.91 * 0.91);
ok('0.89 -> face 7, 0.91 -> axis face', glslKind9(0.89, hi, 0).face === FACE_PACKED && glslKind9(0.91, lo, 0).face === FACE_E);
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
