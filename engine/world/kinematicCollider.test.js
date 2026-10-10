// CH1-E2 (38.37): kinematic entity colliders. Run: node --expose-gc engine/world/kinematicCollider.test.js
import assert from 'node:assert/strict';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { PHYSICS_DEFAULTS as P } from '../physics/config.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(Math.PI / 4) }, out = {};
function load(entities, physics = 'mesh') {
  const level = { name: 'k', rows: Array(12).fill('.'.repeat(12)), start: { x: 1.5, y: 1.5 },
    legend: { '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky' } } };
  const def = { name: 'kin', terrain: null, sun: {}, structures: [{ id: 'room', level: 'k', origin: { x: 10, y: 20, z: 3 } }], entities };
  const assets = { level: () => level, world: () => def, model: () => ({}), has: (k) => k !== 'model', contentVersion: null };
  return { def, assets, world: World.load(def, assets, { physics }) };
}
const npc = (id, x, y, extra) => ({ id, type: 'npc', transform: { x, y, z: 3, yawDeg: 0 }, components: { collider: { r: 0.4, h: 1.8, ...extra } } });
// walk a capsule east along y=22 from x=11 to x=14.5: returns final x
function walkEast(w) {
  let x = 11; const y = 22;
  for (let i = 0; i < 200; i++) { w.collideCircle(x, y, 0.025, 0, P.radius, 3, true, opts, out); x = out.x; }
  return x;
}
const ids = w => w.colliders.map(c => c.id).join();

// static (no flag): props:static only, no kinematic collider; setEntityCollider is a no-op
{
  const { world } = load([npc('a', 13, 22)]);
  ok(ids(world).includes('props:static') && !ids(world).includes('npcs:kinematic'), ids(world));
  ok(world.setEntityCollider('a', 5, 5, 3) === false, 'static: setEntityCollider false');
  ok(walkEast(world) < 13, 'static npc blocks');
}
// kinematic: moves; blocked at new spot, free at old
{
  const { world, def, assets } = load([npc('a', 13, 22, { kinematic: true })]);
  ok(ids(world).includes('npcs:kinematic') && !ids(world).includes('props:static'), ids(world));
  const c = world.colliders.find(k => k.id === 'npcs:kinematic');
  ok(c.bvh.triCount === 32, 'one prism = 32 tris');
  const blockedX = walkEast(world);
  ok(blockedX < 13 && blockedX > 12, 'blocked at old spot ' + blockedX);
  ok(world.setEntityCollider('a', 17, 22, 3) === true);
  ok(walkEast(world) > 15, 'free at old spot, capsule reaches x=16');
  world.setEntityCollider('a', 14, 22, 3);
  const x2 = walkEast(world);
  ok(x2 < 14 && x2 > 13, 'blocked at new spot ' + x2);
  ok(c.min[0] > 13.5 && c.max[0] < 14.5 && c.min[2] === 3 && Math.abs(c.max[2] - 4.8) < 1e-9, 'aabb refit');
  // fresh world authored at (14,22) has an identical BVH
  const twin = load([npc('a', 14, 22, { kinematic: true })]).world.colliders.find(k => k.id === 'npcs:kinematic');
  ok(c.bvh.tri.every((v, i) => Math.abs(v - twin.bvh.tri[i]) < 1e-9), 'moved == fresh build');
  // serialize keeps the flag
  const s = serialize(world), re = deserialize(s, assets, { physics: 'mesh' });
  ok(s.entities.find(e => e.id === 'a').components.collider.kinematic === true, 'serialize keeps flag');
  ok(ids(re).includes('npcs:kinematic'), 'restored has kinematic collider');
  // 0 alloc over 10k moves
  global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) world.setEntityCollider('a', 14 + Math.sin(i * 0.01), 22 + Math.cos(i * 0.013), 3);
  global.gc && global.gc();
  const grow = process.memoryUsage().heapUsed - h0;
  ok(grow < 200000, '10k moves heap growth ' + grow);
}
// two kinematic + a static: slots independent; > 8 throws
{
  const { world } = load([npc('a', 13, 22, { kinematic: true }), npc('b', 11.5, 25, { kinematic: true }), npc('s', 15, 22)]);
  ok(ids(world).includes('props:static') && ids(world).includes('npcs:kinematic'));
  world.setEntityCollider('b', 18, 25, 3);
  const c = world.colliders.find(k => k.id === 'npcs:kinematic');
  ok(c.bvh.triCount === 64 && c.max[0] > 18 && c.min[0] < 13, 'slot b moved, a stays');
  const many = Array.from({ length: 9 }, (_, i) => npc('n' + i, 11 + i * 0.5, 23, { kinematic: true }));
  assert.throws(() => load(many), /at most 8/); checks++;
}
console.log(`CH1-E2: ${checks} checks PASS`);
