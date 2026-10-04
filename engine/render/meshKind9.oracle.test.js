// ME-14c2: independent double-sided ray/triangle oracle (architecture 27.15 step 3, 37.1).
// Reads authored content as data; no product/design imports and no raster coverage implementation in the oracle.
import { readFileSync } from 'node:fs';
import { meshFromJSON, resolveMats } from '../mesh/MeshData.js';
import { DrawList, DRAW_STATIC } from '../mesh/DrawList.js';
import { createRasterTarget, rasterDrawList } from '../mesh/rasterJS.js';
import { projTerms, shearProjection } from './projection.js';
import { KIND_MESH, FACE_PACKED } from './GBuffer.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mesh = meshFromJSON(JSON.parse(readFileSync(new URL('../../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url), 'utf8')));
resolveMats(mesh, () => 17);
const COLS = 80, ROWS = 40, origin = [1000, 700, 0], yaw = 37 * Math.PI / 180;
const c = Math.cos(yaw), s = Math.sin(yaw);
const vertices = [], normals = [], n = [0, 0, 0];
for (let i = 0; i < mesh.pos.length / 3; i++) {
  const x = mesh.pos[3 * i], y = mesh.pos[3 * i + 1], z = mesh.pos[3 * i + 2];
  vertices.push([origin[0] + c * x - s * y, origin[1] + s * x + c * y, origin[2] + z]);
  unpackNormalOct(mesh.nrm[i], n);
  normals.push([c * n[0] - s * n[1], s * n[0] + c * n[1], n[2]]);
}
const sub = (a, b) => a.map((v, k) => v - b[k]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const triangles = [];
for (let t = 0; t < mesh.triCount; t++) {
  const a = vertices[t * 3], b = vertices[t * 3 + 1], d = vertices[t * 3 + 2];
  triangles.push({ a, e1: sub(b, a), e2: sub(d, a), normals: normals.slice(t * 3, t * 3 + 3) });
}

// Moeller-Trumbore in Float64, both windings. Parameter t is forward depth because ray.forward = 1.
function firstHit(eye, dir) {
  let hit = null;
  for (const tri of triangles) {
    const p = cross(dir, tri.e2), det = dot(tri.e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const q0 = sub(eye, tri.a), u = dot(q0, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(q0, tri.e1), v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const depth = dot(tri.e2, q) / det;
    if (depth < 0.05 || depth > 2000 || (hit && depth >= hit.depth)) continue;
    const w = 1 - u - v;
    const normal = [0, 1, 2].map((k) => w * tri.normals[0][k] + u * tri.normals[1][k] + v * tri.normals[2][k]);
    const len = Math.hypot(...normal); normal.forEach((a, k) => { normal[k] = a / len; });
    const abs = normal.map(Math.abs), dominant = abs.indexOf(Math.max(...abs));
    const face = Math.max(...abs) < 0.9 ? FACE_PACKED : [[4, 2], [1, 3], [6, 5]][dominant][normal[dominant] >= 0 ? 1 : 0];
    hit = { depth, face, edge: Math.min(u, v, w) };
  }
  return hit;
}

// 27.15.4 step 3: analytic perspective precision uses snap:false. Also check production snap-on identities.
for (const snap of [true, false]) for (let pose = 0; pose < 10; pose++) {
  const yawDeg = pose * 36, angle = yawDeg * Math.PI / 180, distance = pose % 2 ? 2.5 : 3;
  const cam = { x: origin[0] - distance * Math.sin(angle), y: origin[1] + distance * Math.cos(angle), z: 0.9,
    yawDeg, pitchDeg: pose % 2 ? -12 : -5 };
  const terms = {}, M = new Float64Array(16);
  projTerms(cam, { cols: COLS, rows: ROWS }, terms); shearProjection(terms, M);
  const list = new DrawList(1); list.begin();
  const item = list.push(mesh, DRAW_STATIC); item.rangeCount = mesh.triCount;
  item.matrix.set([c, -s, 0, s, c, 0, 0, 0, 1, ...origin]);
  const target = createRasterTarget(COLS, ROWS, 1);
  rasterDrawList(list, target, { M, snap });
  let tested = 0, matching = 0, depthBad = 0, maxRelative = 0;
  for (let row = 1; row < ROWS - 1; row++) for (let col = 1; col < COLS - 1; col++) {
    const i = row * COLS + col, kind = target.kind[i];
    if ([i - 1, i + 1, i - COLS, i + COLS].some((j) => target.kind[j] !== kind)) continue;
    const a = 2 * (col + 0.5) / COLS - 1;
    const dir = [terms.dirX + a * terms.planeX, terms.dirY + a * terms.planeY, (terms.horizonRow - row) / terms.planeDistY];
    const hit = firstHit([cam.x, cam.y, cam.z], dir);
    if (!hit && kind === 0) continue;
    if (hit && hit.edge < 1e-6) continue;
    tested++;
    const same = hit && kind === KIND_MESH && target.face[i] === hit.face && target.mat[i] === 17;
    if (same) matching++;
    const relative = hit ? Math.abs(target.depth[i] - hit.depth) / hit.depth : Infinity;
    maxRelative = Math.max(maxRelative, relative);
    if (relative > 1e-4) depthBad++;
    if (!same || (!snap && relative > 1e-4)) console.error('oracle mismatch', { snap, pose, col, row, raster: { kind, face: target.face[i], mat: target.mat[i], depth: target.depth[i] }, hit });
  }
  console.log(`Ruins snap=${snap} pose ${pose}: tested=${tested} kind/face/mat=${matching}/${tested} depthBad=${depthBad} maxRelative=${maxRelative}`);
  ok(`snap=${snap} pose ${pose}: nonempty oracle coverage`, tested > 10, `tested=${tested}`);
  ok(`snap=${snap} pose ${pose}: kind/face/mat >= 99%`, matching / tested >= 0.99, `${matching}/${tested}`);
  if (!snap) ok(`pose ${pose}: analytic depth within 1e-4 relative`, depthBad === 0, `bad=${depthBad} max=${maxRelative}`);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
