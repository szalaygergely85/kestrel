// ME-14b2: mixed mesh/level loading, grid isolation, save rebuild and deterministic queries.
import assert from 'node:assert/strict';
import { AssetRegistry, World, serialize, deserialize, makeFrame, localToWorld, createHasher } from '../index.js';
import { raycastColliders } from '../physics/meshCollide.js';
import { stepSectorAnims } from './World.js';

const mesh = { id: 'wall', pos: Float32Array.from([-1, 0, 0, 2, 0, 0, -1, 0, 2]),
  idx: null, triCount: 1, bbox: Float32Array.from([-1, 0, 0, 2, 0, 2]) };
const grid = { name: 'grid', version: 1, cellSize: 1, size: { w: 4, h: 4 },
  rows: ['....', '....', '....', '....'],
  legend: { '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false } },
  sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 0.5, y: 0.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] };
const assets = new AssetRegistry({ palette: { rgb: {} }, levels: { grid }, meshes: { wall: mesh } });
const levelPlacement = { id: 'room', level: 'grid', origin: { x: 0, y: 0, z: 0 } };
let checks = 0;
function equal(a, b) { assert.deepEqual(a, b); checks++; }
const baseline = World.load({ name: 'mixed', structures: [levelPlacement] }, assets, { physics: 'mesh' });
function queryHash(world) {
  const hash = createHasher();
  for (let tick = 0; tick < 600; tick++) {
    stepSectorAnims(world, 1 / 60);
    const x = 0.25 + (tick % 7) * 0.5, y = 0.25 + (tick % 5) * 0.5;
    hash.f64(world.floorAt(x, y)); hash.u32(world.ceilAt(x, y) === 'sky' ? 1 : 0);
    hash.u32(world.sectorAt(x, y).solid ? 1 : 0);
  }
  return hash.value();
}
const expectedHash = queryHash(baseline);
for (const yaw of [0, 35, 90, -20, 225]) {
  const placement = { id: 'imported', mesh: 'wall', origin: { x: 20, y: -3, z: 1.5 }, yawDeg: yaw };
  for (const first of [false, true]) {
    const world = World.load({ name: 'mixed', structures: first ? [placement, levelPlacement] : [levelPlacement, placement] }, assets, { physics: 'mesh' });
    const placed = world.structures.find((s) => s.id === 'imported');
    equal(world.sun, baseline.sun); equal(placed.kind, 'mesh'); equal(placed.mesh, mesh); equal(world.frameOf('imported'), makeFrame(20, -3, 1.5, 0, yaw));
    equal(placed.level, undefined); equal(placed.tagMap, undefined);
    equal(world.structureAt(20, -3), null); equal(world.floorAt(20, -3), null);
    equal(world.sectorAt(20, -3), null); equal(world.ceilAt(20, -3), 'sky');
    equal(world.structureAt(1, 1).id, 'room'); equal(world.floorAt(1, 1), baseline.floorAt(1, 1));
    equal(world.interactables, baseline.interactables); equal(world.triggers, baseline.triggers);
    equal(world.animateSector('nonexistent', 1), false);
    world._restoreDynamics(placed, 'nonexistent', { t: 1 }); equal(placed.dynamics, undefined);
    equal(queryHash(world), expectedHash);
    const vertices = [];
    for (const x of [-1, 2]) for (const y of [0]) for (const z of [0, 2]) {
      const out = {}; localToWorld(placed.frame, x, y, z, out); vertices.push(out);
    }
    for (const axis of ['x', 'y', 'z']) {
      equal(placed.bbox[axis + '0'], Math.min(...vertices.map((v) => v[axis])));
      equal(placed.bbox[axis + '1'], Math.max(...vertices.map((v) => v[axis])));
    }
    const from = {}, hit = {};
    localToWorld(placed.frame, 0, -3, 0.5, from);
    const to = {}; localToWorld(placed.frame, 0, 0, 0.5, to);
    equal(raycastColliders(world.colliders, world.colliders.length, from.x, from.y, from.z,
      (to.x - from.x) / 3, (to.y - from.y) / 3, 0, 5, hit), true);
    assert.ok(Math.abs(hit.t - 3) < 1e-9); checks++;
    const state = serialize(world), record = state.structures.find((s) => s.id === 'imported');
    equal(Object.keys(record).sort(), ['id', 'mesh', 'origin', 'yawDeg']);
    equal(record.mesh, 'wall'); equal(record.yawDeg, yaw);
    const restored = deserialize(JSON.parse(JSON.stringify(state)), assets, { physics: 'mesh' });
    equal(restored.structures.find((s) => s.id === 'imported').bbox, placed.bbox);
    equal(restored.colliders.map((c) => c.id), world.colliders.map((c) => c.id));
    equal(serialize(restored), state); equal(queryHash(restored), expectedHash);
  }
}
// Overlapping mesh bounds never mask a level's grid footprint, regardless of insertion order.
const overlap = World.load({ structures: [{ id: 'imported', mesh: 'wall', origin: { x: 1, y: 1, z: 0 }, yawDeg: 35 }, levelPlacement] }, assets);
equal(overlap.structureAt(1, 1).id, 'room'); equal(overlap.floorAt(1, 1), 0);
assert.throws(() => new World().placeMesh(mesh, { x: 0, y: 0, z: 0 }, 'bad', NaN), /finite/); checks++;
// MESH-SCALE-01: placement scale loads (validated), scales bbox + collider, round-trips through serialize; absent = unchanged.
{
  const sw = World.load({ name: 'scaled', structures: [{ id: 'a', mesh: 'wall', origin: { x: 20, y: -3, z: 1.5 }, yawDeg: 0 },
    { id: 'b', mesh: 'wall', origin: { x: 40, y: -3, z: 1.5 }, yawDeg: 0, scale: 2 }] }, assets, { physics: 'mesh' });
  const [pa, pb] = sw.structures;
  equal(pa.scale, undefined); equal(pb.scale, 2);
  equal(pb.bbox.x1 - pb.bbox.x0, 2 * (pa.bbox.x1 - pa.bbox.x0)); equal(pb.bbox.z1 - 1.5, 2 * (pa.bbox.z1 - 1.5));
  const hit = {}; // ray along +y at x = 40 + 3 (inside the scaled wall's x extent -2..4, outside the unscaled -1..2) hits the wall at y = -3
  equal(raycastColliders(sw.colliders, sw.colliders.length, 40 + 3, -8, 1.5 + 0.2, 0, 1, 0, 10, hit), true);
  assert.ok(Math.abs(hit.t - 5) < 1e-9); checks++;
  equal(raycastColliders(sw.colliders, sw.colliders.length, 20 + 3, -8, 1.5 + 0.2, 0, 1, 0, 10, hit), false);
  const st = serialize(sw);
  equal(Object.keys(st.structures[0]).sort(), ['id', 'mesh', 'origin', 'yawDeg']);
  equal(Object.keys(st.structures[1]).sort(), ['id', 'mesh', 'origin', 'scale', 'yawDeg']);
  const back = deserialize(JSON.parse(JSON.stringify(st)), assets, { physics: 'mesh' });
  equal(back.structures[1].scale, 2); equal(serialize(back), st);
  assert.throws(() => World.load({ name: 'bad', structures: [{ id: 'x', mesh: 'wall', origin: { x: 0, y: 0, z: 0 }, scale: 9 }] }, assets), /scale/); checks++;
}
console.log(`${checks} passed, 0 failed. ALL PASS`);
