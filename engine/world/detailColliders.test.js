// ENV-01a1 (architecture.md 37.4). Run: node engine/world/detailColliders.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildDetailCollider } from './colliders.js';
import { World } from './World.js';
import { serialize } from './serialize.js';
import { moveCircleMesh, probeSupport } from '../physics/meshCollide.js';
import { moveCapsule } from '../physics/capsule.js';
import { PHYSICS_DEFAULTS as P } from '../physics/config.js';

let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const speciesDefs = [{ model: 'grass' }, { model: 'rock', collider: { prism: { r: 0.7, h: 0.8 } } },
  { model: 'log', collider: { box: { hx: 1.3, hy: 0.4, h: 0.8 } } }];
function placement(species, yaw = 0, z = 0) {
  return { count: 1, x: Float64Array.of(0), y: Float64Array.of(0), z: Float64Array.of(z),
    species: Uint16Array.of(species), yawDeg: Int16Array.of(yaw), speciesDefs };
}
const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(Math.PI / 4) };
const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
const rock = buildDetailCollider(placement(1));
const log = buildDetailCollider(placement(2, 37));
ok(rock.id === 'scatter:detail' && rock.kind === 'trimesh' && rock.enabled);
ok(rock.bvh.triCount === 24 && log.bvh.triCount === 10);
ok(rock.min[2] === -0.5 && rock.max[2] === 0.8);
ok(Math.abs(rock.max[0] - 0.7 / Math.cos(Math.PI / 8)) < 1e-12);
ok(buildDetailCollider(null) === null && buildDetailCollider({ count: 0 }) === null);
ok(buildDetailCollider(placement(0)) === null);
const mixed = { count: 3, x: Float64Array.of(0, 5, 100), y: Float64Array.of(0, 0, 100),
  z: Float64Array.of(0, 0, 100), yawDeg: Int16Array.of(0, 37, 0), species: Uint16Array.of(1, 2, 0), speciesDefs };
const both = buildDetailCollider(mixed);
ok(both.bvh.triCount === 34 && both.max[0] < 7 && both.max[2] === 0.8);

// Approach each shape from 32 directions; the player's circle never intersects it.
const yaw = 37 * Math.PI / 180, cos = Math.cos(yaw), sin = Math.sin(yaw);
for (const collider of [rock, log]) {
  let safe = true;
  for (let direction = 0; direction < 32; direction++) {
    const a = direction * Math.PI / 16, dx = Math.cos(a), dy = Math.sin(a);
    let x = dx * 4, y = dy * 4;
    for (let step = 0; step < 160; step++) {
      moveCircleMesh([collider], 1, x, y, -dx * P.walkSpeed * P.fixedDt,
        -dy * P.walkSpeed * P.fixedDt, P.radius, 0, true, opts, out);
      x = out.x; y = out.y;
      const lx = x * cos + y * sin, ly = -x * sin + y * cos;
      const distance = collider === rock ? Math.hypot(x, y) - 0.7
        : Math.hypot(Math.max(Math.abs(lx) - 1.3, 0), Math.max(Math.abs(ly) - 0.4, 0));
      if (out.overflow || distance < P.radius - 1e-6) safe = false;
    }
  }
  ok(safe);
}
// The closed top is a walkable floor, including off-centre points over the top fan.
const support = {};
for (const collider of [rock, log]) {
  for (const x of [-0.2, 0, 0.2]) {
    probeSupport([collider], 1, x, 0.1, 1, false, opts, support);
    ok(support.floorHit && Math.abs(support.floorZ - 0.8) < 1e-12 && support.fnz === 1);
    moveCircleMesh([collider], 1, x, 0.1, 0.05, 0, P.radius, 0.8, true, opts, out);
    ok(out.x === x + 0.05 && !out.blockedX && !out.blockedY);
  }
}
probeSupport([rock], 1, 0, 0, -1, false, opts, support);
ok(!support.floorHit); // No artificial underside floor.

const detail = { tileM: 16, maxDraw: 768, refeedM: 4, maxPlacements: 40000,
  structClearM: 2, entityClearM: 1.5, exclude: [], layers: [{ name: 'rocks', seed: 743,
    cellM: 8, jitter: 1, fill: 0.8, maxSlope: 0.5, clearM: 0, drawM: 70, lodCells: 4,
    ground: { grass: [{ model: 'rock', weight: 1, collider: { prism: { r: 0.7, h: 0.8 } } },
      { model: 'log', weight: 1, collider: { box: { hx: 1.3, hy: 0.4, h: 0.8 } } }] } }] };
const recipe = { map: { w: 192, h: 192, cell: 2 }, chunk: { size: 128, nearCell: 2 },
  recipe: { detail }, util: { heightAt: () => 0, typeAt: () => 0, gridHeight: () => 0,
    bake: (x0, y0, cell, w, h) => ({ x0, y0, cell, w, h,
      height: new Float32Array(w * h), type: new Uint8Array(w * h) }) } };
const level = { name: 'fixture', rows: ['.'], start: { x: 0.5, y: 0.5 }, legend: {
  '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'grass', ceilMat: 'sky' },
} };
const def = { name: 'detailFixture', terrain: 'fixture', sun: {},
  structures: [{ id: 'fixture', level: 'fixture', origin: { x: 0, y: 0, z: 0 } }], entities: [] };
const assets = { terrain: () => recipe, level: () => level, world: () => def, contentVersion: null };
const start = performance.now();
const a = World.load(def, assets, { physics: 'mesh', detail: true });
const loadMs = performance.now() - start;
const b = World.load(def, assets, { physics: 'mesh', detail: true });
ok(a.detail.count > 0 && a.colliders.filter(c => c.id === 'scatter:detail').length === 1);
const colliderStart = performance.now();
buildDetailCollider(a.detail);
const colliderMs = performance.now() - colliderStart;
const ac = a.colliders.find(c => c.id === 'scatter:detail'), bc = b.colliders.find(c => c.id === 'scatter:detail');
ok(ac.bvh !== bc.bvh && Buffer.from(ac.bvh.tri.buffer).equals(Buffer.from(bc.bvh.tri.buffer)));
function replay(world, grid = false) {
  let x = a.detail.x[0] - 3, y = a.detail.y[0];
  const positions = new Float64Array(600 * 2);
  let blocks = 0;
  for (let step = 0; step < 600; step++) {
    const dx = P.walkSpeed * P.fixedDt, dy = step < 120 ? 0 : Math.sin(step * 0.03) * 0.01;
    if (grid) moveCapsule(world, x, y, dx, dy, P.radius, 0, true, opts, out);
    else world.collideCircle(x, y, dx, dy, P.radius, 0, true, opts, out);
    x = out.x; y = out.y;
    positions[step * 2] = x; positions[step * 2 + 1] = y;
    if (out.blockedX || out.blockedY || out.nx || out.ny) blocks++;
    assert.equal(out.overflow, false);
  }
  return { hash: createHash('sha256').update(Buffer.from(positions.buffer)).digest('hex'), blocks };
}
const ra = replay(a), rb = replay(b);
ok(ra.hash === rb.hash && ra.blocks > 0 && ra.blocks === rb.blocks);
const off = World.load(def, assets, { physics: 'mesh' });
ok(off.detail === null && !off.colliders.some(c => c.id === 'scatter:detail'));
ok(JSON.stringify(serialize(a)) === JSON.stringify(serialize(off)));
const grid = World.load(def, assets), gridDetail = World.load(def, assets, { detail: true });
ok(gridDetail.colliders.length === 0 && grid.colliders.length === 0);
ok(replay(grid, true).hash === replay(gridDetail, true).hash);
ok(JSON.stringify(serialize(grid)) === JSON.stringify(serialize(gridDetail)));
for (let i = 0; i < 600; i++) {
  const x = i % 30 - 10, y = Math.floor(i / 30) - 10;
  assert.equal(gridDetail.floorAt(x, y), grid.floorAt(x, y));
  assert.equal(gridDetail.heightAt(x, y), grid.heightAt(x, y));
}
checks++;
console.log(`ENV-01a1 detail colliders: ${checks} checks PASS; ${a.detail.count} fixture placements; load ${loadMs.toFixed(3)} ms; BVH ${colliderMs.toFixed(3)} ms${colliderMs > 10 ? ' (warn-only: >10 ms)' : ''}; 600-step hash ${ra.hash}`);
