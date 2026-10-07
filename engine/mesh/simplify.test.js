// engine/mesh/simplify.test.js (MESH-SIMP-01): quadric edge-collapse simplifier on cube / sphere / plane fixtures.
// Run: node engine/mesh/simplify.test.js
import assert from 'node:assert';
import { simplifyTriangles } from './simplify.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack || e.message}`); process.exitCode = 1; }
}

// ---- fixtures (indexed, counter-clockwise seen from outside / +z) ----
function plane(n) { // n x n quads in the unit square, z = 0, open mesh
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push([i / n, j / n, 0]);
  const v = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  return { pos, idx };
}
function cube(n) { // [-1,1]^3, n x n quads per face, welded corners
  const pos = [], idx = [], map = new Map();
  const vert = (x, y, z) => { const k = `${x},${y},${z}`; if (!map.has(k)) { map.set(k, pos.length); pos.push([x, y, z]); } return map.get(k); };
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [nrm, u, w] of faces) {
    const p = (a, b) => vert(...[0, 1, 2].map((c) => nrm[c] + u[c] * (2 * a / n - 1) + w[c] * (2 * b / n - 1)));
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) idx.push(p(a, b), p(a + 1, b), p(a + 1, b + 1), p(a, b), p(a + 1, b + 1), p(a, b + 1));
  }
  return { pos, idx };
}
function sphere(seg, rings) { // radius 1, UV sphere with pole vertices
  const pos = [[0, 0, 1]], idx = [];
  for (let r = 1; r < rings; r++) for (let s = 0; s < seg; s++) {
    const th = Math.PI * r / rings, ph = 2 * Math.PI * s / seg;
    pos.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]);
  }
  pos.push([0, 0, -1]);
  const ring = (r, s) => 1 + (r - 1) * seg + (s % seg);
  for (let s = 0; s < seg; s++) idx.push(0, ring(1, s), ring(1, s + 1));
  for (let r = 1; r < rings - 1; r++) for (let s = 0; s < seg; s++) idx.push(ring(r, s), ring(r + 1, s), ring(r + 1, s + 1), ring(r, s), ring(r + 1, s + 1), ring(r, s + 1));
  const last = pos.length - 1;
  for (let s = 0; s < seg; s++) idx.push(last, ring(rings - 1, s + 1), ring(rings - 1, s));
  return { pos, idx };
}

// ---- helpers ----
const bbox = (pos) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pos) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
  return { lo, hi };
};
function faceNormals(pos, idx) {
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = pos[idx[t]], b = pos[idx[t + 1]], c = pos[idx[t + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    out.push({ n, area2: Math.hypot(...n), centroid: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3) });
  }
  return out;
}
const assertBBox = (a, b, tol = 0.02) => { // each bbox corner within 2 % of the largest original extent
  const A = bbox(a), B = bbox(b), ext = Math.max(...[0, 1, 2].map((k) => A.hi[k] - A.lo[k]));
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(A.lo[c] - B.lo[c]) <= tol * ext && Math.abs(A.hi[c] - B.hi[c]) <= tol * ext, `bbox axis ${c} moved: ${A.lo[c]}..${A.hi[c]} -> ${B.lo[c]}..${B.hi[c]}`);
};
const assertTarget = (tris, target) => assert.ok(Math.abs(tris - target) <= target * 0.1, `triangle count ${tris} not within 10 % of ${target}`);
const assertValid = (r) => {
  assert.ok(r.idx.length % 3 === 0);
  for (const i of r.idx) assert.ok(i >= 0 && i < r.positions.length, 'index out of range');
  for (const f of faceNormals(r.positions, r.idx)) assert.ok(f.area2 > 1e-10, 'degenerate face');
};
const outward = (r) => { for (const f of faceNormals(r.positions, r.idx)) assert.ok(f.n[0] * f.centroid[0] + f.n[1] * f.centroid[1] + f.n[2] * f.centroid[2] > 0, 'face points inward'); };
function edgeCounts(idx) {
  const count = new Map(), ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const k = ek(idx[t + e], idx[t + (e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
  return count;
}

test('plane: target met, bbox kept, normals all +z, corners and rim kept (open mesh)', () => {
  const { pos, idx } = plane(16); // 512 tris
  const r = simplifyTriangles(pos, idx, 128);
  assertTarget(r.idx.length / 3, 128); assertValid(r); assertBBox(pos, r.positions);
  for (const f of faceNormals(r.positions, r.idx)) assert.ok(f.n[2] > 0, 'flipped face');
  for (const corner of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(r.positions.some((p) => p[0] === corner[0] && p[1] === corner[1]), `corner ${corner} lost`);
  let boundary = 0; // every boundary edge (owned by one face) must stay on the original rim
  for (const [k, n] of edgeCounts(r.idx)) {
    if (n !== 1) continue; boundary++;
    for (const v of k.split('_').map(Number)) { const p = r.positions[v]; assert.ok(p[0] === 0 || p[0] === 1 || p[1] === 0 || p[1] === 1, `rim vertex moved inside: ${p}`); }
  }
  assert.ok(boundary >= 4, 'rim vanished');
});

test('cube: target met, bbox kept, faces outward and non-degenerate', () => {
  const { pos, idx } = cube(8); // 768 tris
  const r = simplifyTriangles(pos, idx, 96);
  assertTarget(r.idx.length / 3, 96); assertValid(r); assertBBox(pos, r.positions); outward(r);
});

test('sphere: target met, bbox kept, faces outward, vertices stay near the unit sphere', () => {
  const { pos, idx } = sphere(32, 16); // 960 tris
  const r = simplifyTriangles(pos, idx, 240);
  assertTarget(r.idx.length / 3, 240); assertValid(r); assertBBox(pos, r.positions); outward(r);
  for (const p of r.positions) assert.ok(Math.abs(Math.hypot(...p) - 1) < 0.1, `vertex off the sphere: ${Math.hypot(...p)}`);
});

test('target at or above the face count returns the mesh unchanged', () => {
  const { pos, idx } = sphere(8, 4);
  assert.strictEqual(simplifyTriangles(pos, idx, 10000).idx.length, idx.length);
});

test('split vertices (duplicate positions, UV seams) are welded: no holes opened', () => {
  const { pos, idx } = cube(4);
  const p2 = [], i2 = []; // un-weld: every triangle gets its own three vertices
  for (const i of idx) { i2.push(p2.length); p2.push(pos[i].slice()); }
  const r = simplifyTriangles(p2, i2, 40);
  assertValid(r); assertBBox(pos, r.positions);
  for (const n of edgeCounts(r.idx).values()) assert.strictEqual(n, 2, 'closed cube must stay closed');
});

test('deterministic: same input gives byte-identical output', () => {
  for (const { pos, idx } of [sphere(32, 16), plane(12), cube(6)]) {
    const t = Math.floor(idx.length / 3 / 4);
    assert.strictEqual(JSON.stringify(simplifyTriangles(pos, idx, t)), JSON.stringify(simplifyTriangles(pos, idx, t)));
  }
});

console.log(`${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}.`);
if (!process.exitCode) console.log('ALL PASS');
