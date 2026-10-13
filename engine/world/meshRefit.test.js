// ED-MESH-01e follow-up: rebuildMeshColliders refits the merged BVH when placements only moved.
import assert from 'node:assert/strict';
import { World } from './World.js';
import { buildWorldColliders, buildStaticMeshCollider, MESH_REFIT_MAX } from './colliders.js';
import { queryAABB, raycast, refit } from '../physics/bvh.js';
import { shadowWorldZ } from '../mesh/shadowList.js';

const P = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]];
const F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const pos = Float64Array.from(F.flatMap((f) => f.flatMap((i) => P[i])));
const mesh = (id) => ({ id, pos, idx: null, triCount: 12, bbox: [0, 0, 0, 2, 2, 2], collider: pos });
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function mk(n) {
  const w = Object.create(World.prototype);
  Object.assign(w, { structures: [], renderVersion: 0, structVersion: 0, events: null, assets: { mesh }, physicsMode: 'mesh', colliders: [] });
  for (let i = 0; i < n; i++) w.placeMesh(mesh('m'), { x: rnd() * 100, y: rnd() * 100, z: 0 }, 'p' + i, 0);
  w.colliders = buildWorldColliders(w);
  return w;
}
const get = (w) => w.colliders.find((c) => c.id === 'meshes:static');
const shake = (w, k) => { for (let i = 0; i < w.structures.length; i++) w.setMeshPlacement('p' + i, { x: rnd() * 100, y: rnd() * 100, z: rnd() * k, yaw: rnd() * 6 }); };
const out = { t: 0, tri: 0 }; const buf = new Int32Array(4096);
function same(a, b) {
  for (let i = 0; i < 300; i++) {
    const x = rnd() * 100, y = rnd() * 100, z = rnd() * 3;
    const na = queryAABB(a.bvh, x, y, z, x + 4, y + 4, z + 3, buf, 4096);
    const nb = queryAABB(b.bvh, x, y, z, x + 4, y + 4, z + 3, buf, 4096);
    assert.equal(na > 0, nb > 0);
    const dx = rnd() - .5, dy = rnd() - .5, dz = rnd() - .5;
    const ha = raycast(a.bvh, x, y, z + 5, dx, dy, dz - 1, 100, { ...out }), hb = raycast(b.bvh, x, y, z + 5, dx, dy, dz - 1, 100, { ...out });
    assert.equal(!!ha, !!hb);
  }
}
const w = mk(40);
const c0 = get(w);
for (let r = 0; r < 5; r++) {
  shake(w, 0.5); w.rebuildMeshColliders();
  assert.equal(get(w), c0, 'refit keeps the collider object');
  same(get(w), buildStaticMeshCollider(w));
}
assert.equal(c0._refits, 5);
// zero alloc in bvh.refit
const bp = c0._pos; refit(c0.bvh, bp, null, null); if (globalThis.gc) globalThis.gc();
for (let i = 0; i < 300; i++) refit(c0.bvh, bp, null, null);
if (globalThis.gc) globalThis.gc();
const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 2000; i++) refit(c0.bvh, bp, null, null);
const dh = process.memoryUsage().heapUsed - h0; console.log("refit heap delta", dh); if (globalThis.gc) assert.ok(dh < 2e5, "refit ~0 alloc");
// refit counter forces a full rebuild
for (let r = 0; r < MESH_REFIT_MAX; r++) { shake(w, 0.1); w.rebuildMeshColliders(); }
assert.notEqual(get(w), c0, 'rebuilt after MESH_REFIT_MAX refits');
assert.equal(get(w)._refits < MESH_REFIT_MAX, true);
// parts set change -> full rebuild
const c1 = get(w); w.placeMesh(mesh('m'), { x: 1, y: 1, z: 0 }, 'extra', 0); w.rebuildMeshColliders();
assert.notEqual(get(w), c1);
// shadowWorldZ follows a lifted mesh
const z0 = shadowWorldZ(w, null, { min: 0, max: 0 }).max;
w.setMeshPlacement('p0', { x: 5, y: 5, z: 50, yaw: 0 });
const z1 = shadowWorldZ(w, null, { min: 0, max: 0 }).max;
assert.ok(z1 >= 52 && z1 > z0, `z ${z0} -> ${z1}`);
// timing, 329 placements
const big = mk(329); shake(big, 1);
let t = process.hrtime.bigint(); for (let i = 0; i < 20; i++) big.rebuildMeshColliders(); // includes first (refit) calls
console.log('329 placements: refit avg ms', Number(process.hrtime.bigint() - t) / 20 / 1e6);
t = process.hrtime.bigint(); for (let i = 0; i < 20; i++) buildStaticMeshCollider(big); console.log('full build avg ms', Number(process.hrtime.bigint() - t) / 20 / 1e6);
console.log('meshRefit.test ok');
