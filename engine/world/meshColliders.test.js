// ME-14b: imported placement rotation/translation, ray hits, bounds and ordering.
import assert from 'node:assert/strict';
import { buildWorldColliders } from './colliders.js';
import { raycastColliders } from '../physics/meshCollide.js';
import { makeFrame, localToWorld } from '../core/transform.js';

const mesh = { pos: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 0, 2]), idx: null, triCount: 1 };
let checks = 0;
for (const yaw of [0, 35, 90, -20, 225]) {
  const origin = { x: 12, y: -3, z: 1.5 };
  const frame = makeFrame(origin.x, origin.y, origin.z, 0, yaw);
  // Exercise both resolved meshes and registry references, with/without a cached frame.
  for (const referenced of [false, true]) {
    const placement = referenced
      ? { id: 'wall', mesh: 'wall_asset', origin, yawDeg: yaw }
      : { id: 'wall', mesh, origin, frame };
    const world = { structures: [placement, { id: 'empty', mesh: { ...mesh, triCount: 0 }, origin }],
      assets: { mesh: (id) => { assert.equal(id, 'wall_asset'); return mesh; } } };
    const colliders = buildWorldColliders(world);
    assert.deepEqual(colliders.map((c) => c.id), ['meshes:static']); checks++;
    assert.equal(placement._dynColliders.size, 0); checks++;
    const target = {}, start = {};
    localToWorld(frame, 0.5, 0, 0.5, target);
    localToWorld(frame, 0.5, -3, 0.5, start);
    const out = { t: 0, tri: -1, u: 0, v: 0, nx: 0, ny: 0, nz: 0 };
    assert.ok(raycastColliders(colliders, colliders.length, start.x, start.y, start.z,
      (target.x - start.x) / 3, (target.y - start.y) / 3, 0, 5, out)); checks++;
    assert.ok(Math.abs(out.t - 3) < 1e-9); checks++;
    assert.equal(out.collider, 0); checks++;
    for (const vertex of [[0, 0, 0], [2, 0, 0], [0, 0, 2]]) {
      const p = {}; localToWorld(frame, ...vertex, p);
      for (const [axis, key] of ['x', 'y', 'z'].entries()) {
        assert.ok(p[key] >= colliders[0].min[axis] - 1e-9 && p[key] <= colliders[0].max[axis] + 1e-9); checks++;
      }
    }
    const again = buildWorldColliders(world);
    assert.deepEqual(again[0].bvh.tri, colliders[0].bvh.tri); checks++;
  }
}
console.log(`${checks} passed, 0 failed. ALL PASS`);
