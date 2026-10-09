// ED-MESH-01e: World.setMeshPlacement + rebuildMeshColliders.
import assert from 'node:assert/strict';
import { World } from './World.js';
import { buildWorldColliders } from './colliders.js';
import { moveCircleMesh } from '../physics/meshCollide.js';

// Unit box 2x2x2 as a tiny trimesh with a collider proxy (12 tris).
const P = [[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]];
const F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const pos = Float64Array.from(F.flatMap((f) => f.flatMap((i) => P[i])));
const mesh = (id) => ({ id, pos, idx: null, triCount: 12, bbox: [0, 0, 0, 2, 2, 2], collider: pos });
const assets = { mesh };

function mk() {
  const w = Object.create(World.prototype);
  Object.assign(w, { structures: [], renderVersion: 0, structVersion: 0, events: null, assets, physicsMode: 'mesh', colliders: [] });
  w.placeMesh(mesh('a'), { x: 0, y: 0, z: 0 }, 'a', 0);
  w.placeMesh(mesh('b'), { x: 10, y: 0, z: 0 }, 'b', 0);
  w.placeMesh(mesh('c'), { x: 20, y: 5, z: 1 }, 'c', 0);
  w.colliders = buildWorldColliders(w);
  return w;
}
const opts = { height: 1.8, stepUpMax: 0.45, walkCos: 0.7 };
const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
// Walk east in 0.1 m steps from 1.5 m before (x,y) to 0.5 m past it; blocked = never got past x.
const blocked = (w, x, y) => {
  let cx = x - 1.5;
  for (let i = 0; i < 20; i++) { moveCircleMesh(w.colliders, w.colliders.length, cx, y, 0.1, 0, 0.3, 0, true, opts, out); cx = out.x; }
  return cx < x + 0.25;
};

let checks = 0;
// 1) bbox of move == bbox of a fresh placeMesh
const w = mk();
const rv = w.renderVersion, sv = w.structVersion;
assert.equal(w.setMeshPlacement('b', { x: 30, y: -4, z: 0.5, yaw: 77 }), true);
assert.equal(w.renderVersion, rv + 1); assert.equal(w.structVersion, sv); checks += 2;
const fresh = mk();
fresh.placeMesh(mesh('b2'), { x: 30, y: -4, z: 0.5 }, 'b2', 77);
const b = w.structures[1], f = fresh.structures[3];
assert.deepEqual(b.bbox, f.bbox); assert.deepEqual(b.origin, f.origin); assert.deepEqual(b.frame, f.frame); checks += 3;
assert.equal(w.setMeshPlacement('nope', { x: 0, y: 0, z: 0 }), false); checks++;

// 2) collider rebuild: blocked at new footprint, free at old; stale before rebuild
assert.ok(blocked(w, 11, 1)); // old footprint still there until rebuild
w.rebuildMeshColliders();
assert.ok(!blocked(w, 11, 1)); assert.ok(blocked(w, 29.25, -2.81)); checks += 2;

// 3) rebuild == fresh load of the same final placements (parts + 1000 probes)
const ref = Object.create(World.prototype);
Object.assign(ref, { structures: [], renderVersion: 0, structVersion: 0, events: null, assets, physicsMode: 'mesh', colliders: [] });
ref.placeMesh(mesh('a'), { x: 0, y: 0, z: 0 }, 'a', 0);
ref.placeMesh(mesh('b'), { x: 30, y: -4, z: 0.5 }, 'b', 77);
ref.placeMesh(mesh('c'), { x: 20, y: 5, z: 1 }, 'c', 0);
ref.colliders = buildWorldColliders(ref);
assert.deepEqual(w.colliders.map((c) => c.id), ref.colliders.map((c) => c.id));
assert.deepEqual(w.colliders[0].parts, ref.colliders[0].parts);
assert.deepEqual(Array.from(w.colliders[0].min), Array.from(ref.colliders[0].min)); checks += 3;
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const o2 = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
for (let i = 0; i < 1000; i++) {
  const x = -3 + rnd() * 40, y = -8 + rnd() * 18, dx = (rnd() - .5) * .3, dy = (rnd() - .5) * .3;
  moveCircleMesh(w.colliders, w.colliders.length, x, y, dx, dy, 0.3, 0, true, opts, out);
  moveCircleMesh(ref.colliders, ref.colliders.length, x, y, dx, dy, 0.3, 0, true, opts, o2);
  assert.deepEqual([out.x, out.y, out.blockedX, out.blockedY], [o2.x, o2.y, o2.blockedX, o2.blockedY]); checks++;
}

// 4) grid mode: no-op; scale kept/changed
const g = mk(); g.physicsMode = 'grid'; const before = g.colliders.slice();
g.setMeshPlacement('a', { x: 5, y: 5, z: 0, yaw: 0, scale: 2 }); g.rebuildMeshColliders();
assert.deepEqual(g.colliders, before); assert.equal(g.structures[0].scale, 2); checks += 2;

console.log(`${checks} passed, 0 failed. ALL PASS`);
