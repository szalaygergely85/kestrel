// ME-06c2 (architecture.md 37.2). Run: node engine/world/trunkColliders.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTrunkCollider } from './colliders.js';
import { World } from './World.js';
import { serialize } from './serialize.js';
import { moveCircleMesh, probeSupport } from '../physics/meshCollide.js';
import { PHYSICS_DEFAULTS as P } from '../physics/config.js';
import { moveCapsule } from '../physics/capsule.js';

let checks = 0;
const ok = (v) => { assert.ok(v); checks++; };
const cfg = { seed: 7349, cellM: 6, jitter: 1.5, fill: 0.8, maxTrees: 1500, lodCells: 6,
  species: [{ model: 'a', weight: 1, trunkR: 0.4, trunkH: 3 }, { model: 'b', weight: 3, trunkR: 0.7, trunkH: 4 }] };
function placements(x, y, z = x.map(() => -0.1), species = x.map(() => 1), yaw = x.map(() => 0)) {
  return { count: x.length, x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z),
    species: Uint8Array.from(species), yawDeg: Int16Array.from(yaw) };
}
const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(Math.PI / 4) };
const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
const one = buildTrunkCollider(placements([0], [0]), cfg);
ok(one.id === 'scatter:trunks' && one.kind === 'trimesh' && one.enabled);
ok(one.bvh.triCount === 16);
ok(one.min[2] === -0.6 && one.max[2] === 3.9);
const rc = cfg.species[1].trunkR / Math.cos(Math.PI / 8);
ok(Math.abs(one.max[0] - rc) < 1e-12 && Math.abs(one.min[0] + rc) < 1e-12);
ok(buildTrunkCollider(placements([], []), cfg) === null);
// A player approaches from sixteen directions; the prism contains the visible circular trunk.
let blocked = true;
for (let direction = 0; direction < 16; direction++) {
  const angle = direction * Math.PI / 8, dx = Math.cos(angle), dy = Math.sin(angle);
  let x = dx * 3, y = dy * 3;
  for (let step = 0; step < 120; step++) {
    moveCircleMesh([one], 1, x, y, -dx * P.walkSpeed * P.fixedDt, -dy * P.walkSpeed * P.fixedDt,
      P.radius, 0, true, opts, out);
    x = out.x; y = out.y;
    if (out.overflow || Math.hypot(x, y) < cfg.species[1].trunkR + P.radius - 1e-6) blocked = false;
  }
}
ok(blocked);
// The minimum fixture spacing uses circumradii, so yaw cannot shrink the 1.2 m clear gap.
const half = rc + 0.6;
const pair = buildTrunkCollider(placements([-half, half], [0, 0], [-0.1, -0.1], [1, 1], [22, 67]), cfg);
let x = 0, y = -3, clear = true;
for (let step = 0; step < 120; step++) {
  moveCircleMesh([pair], 1, x, y, 0, P.walkSpeed * P.fixedDt, P.radius, 0, true, opts, out);
  x = out.x; y = out.y;
  if (out.blockedX || out.blockedY || out.overflow) clear = false;
}
ok(clear && x === 0 && y > 3);
// An open prism cannot manufacture a floor or a ceiling at its centre.
const support = {};
probeSupport([one], 1, 0, 0, 0, true, opts, support);
ok(!support.floorHit && !support.ceilHit);
moveCircleMesh([one], 1, -2, 0, 2, 0, P.radius, 4, true, opts, out);
ok(out.x === 0 && !out.blockedX);
const mixed = buildTrunkCollider(placements([0, 10], [0, 0], [1, 2], [0, 1], [0, 45]), cfg);
ok(mixed.bvh.triCount === 32 && mixed.min[2] === 0.5 && mixed.max[2] === 6);

const recipe = { map: { w: 192, h: 192, cell: 2 }, chunk: { size: 128, nearCell: 2 },
  recipe: { forest: { canopy: 10, maxSlope: 0.5, trees: cfg } },
  util: { heightAt: () => 0, typeAt: () => 1, gridHeight: () => 0,
    bake: (x0, y0, cell, w, h) => ({ x0, y0, cell, w, h,
      height: new Float32Array(w * h), type: new Uint8Array(w * h).fill(1) }) } };
const level = { name: 'fixture', rows: ['.'], start: { x: 0.5, y: 0.5 }, legend: {
  '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'grass', ceilMat: 'sky' },
} };
const assets = { terrain: () => recipe, level: () => level, contentVersion: null };
const def = { terrain: 'fixture', sun: {}, structures: [{ id: 'fixture', level: 'fixture', origin: { x: 0, y: 0, z: 0 } }], entities: [] };
const started = performance.now();
const a = World.load(def, assets, { physics: 'mesh', realTrees: true });
const loadMs = performance.now() - started;
const b = World.load(def, assets, { physics: 'mesh', realTrees: true });
const trunks = a.colliders.filter(c => c.id === 'scatter:trunks');
ok(a.scatter.count > 0 && trunks.length === 1);
ok(trunks[0].bvh.triCount === a.scatter.count * 16);
ok(a.colliders[a.colliders.length - 1] === trunks[0]);
ok(trunks[0].bvh !== b.colliders[b.colliders.length - 1].bvh);
ok(Buffer.from(trunks[0].bvh.tri.buffer).equals(Buffer.from(b.colliders[b.colliders.length - 1].bvh.tri.buffer)));
function replay(world) {
  const tree = world.scatter;
  let x = tree.x[0] - 3, y = tree.y[0];
  const footZ = tree.z[0] + 0.1, positions = new Float64Array(600 * 2);
  let blocks = 0;
  const bvh = world.colliders[world.colliders.length - 1].bvh;
  for (let step = 0; step < 600; step++) {
    const dx = P.walkSpeed * P.fixedDt, dy = step < 120 ? 0 : Math.sin(step * 0.03) * 0.01;
    world.collideCircle(x, y, dx, dy, P.radius, footZ, true, opts, out);
    x = out.x; y = out.y;
    positions[step * 2] = x; positions[step * 2 + 1] = y;
    if (out.blockedX || out.blockedY || out.nx || out.ny) blocks++;
    assert.equal(out.overflow, false);
  }
  assert.equal(world.colliders[world.colliders.length - 1].bvh, bvh);
  return { hash: createHash('sha256').update(Buffer.from(positions.buffer)).digest('hex'), blocks };
}
const ra = replay(a), rb = replay(b);
ok(ra.hash === rb.hash && ra.blocks > 0 && ra.blocks === rb.blocks);
const off = World.load(def, assets, { physics: 'mesh' });
ok(off.scatter === null && !off.colliders.some(c => c.id === 'scatter:trunks'));
ok(JSON.stringify(serialize(a)) === JSON.stringify(serialize(off)));
const grid = World.load(def, assets), gridTrees = World.load(def, assets, { realTrees: true });
ok(grid.colliders.length === 0 && gridTrees.colliders.length === 0);
ok(JSON.stringify(serialize(gridTrees)) === JSON.stringify(serialize(grid)));
const queries = w => Array.from({ length: 600 }, (_, i) => {
  const x = i % 30 - 10, y = Math.floor(i / 30) - 10;
  return [w.floorAt(x, y), w.heightAt(x, y), (w.sectorAt(x, y) || w.outsideSector(x, y)).floorH];
});
assert.deepEqual(queries(gridTrees), queries(grid)); checks++;
function gridReplay(world) {
  let x = gridTrees.scatter.x[0] - 3, y = gridTrees.scatter.y[0];
  const positions = new Float64Array(600 * 2);
  for (let step = 0; step < 600; step++) {
    moveCapsule(world, x, y, P.walkSpeed * P.fixedDt, Math.sin(step * 0.03) * 0.01,
      P.radius, 0, true, opts, out);
    x = out.x; y = out.y;
    positions[step * 2] = x; positions[step * 2 + 1] = y;
  }
  return Buffer.from(positions.buffer);
}
ok(gridReplay(gridTrees).equals(gridReplay(grid)));
const emptyCfg = { ...cfg, fill: 0 };
const emptyAssets = { ...assets, terrain: () => ({ ...recipe, recipe: { forest: { ...recipe.recipe.forest, trees: emptyCfg } } }) };
const empty = World.load(def, emptyAssets, { physics: 'mesh', realTrees: true });
ok(empty.scatter.count === 0 && !empty.colliders.some(c => c.id === 'scatter:trunks'));
console.log(`ME-06c2: ${checks} checks PASS; ${a.scatter.count} fixture trunks; first load ${loadMs.toFixed(3)} ms; 600-step hash ${ra.hash}`);
