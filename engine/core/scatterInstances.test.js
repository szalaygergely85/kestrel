// ME-06c3 (37.2). Run: node engine/core/scatterInstances.test.js
import assert from 'node:assert/strict';
import { bindScatterInstances, createEngine, SCATTER_OBJECT_BASE } from './engine.js';
import { InstanceGroups, createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE,
  INST_OBJECT_ID, INST_FLAGS, INST_FLAG_ALIGNED, MAX_INSTANCE_GROUPS } from '../mesh/instances.js';
import { INST_FLAG_SWAY } from '../mesh/sway.js';
import { serialize, deserialize } from '../world/serialize.js';

let checks = 0;
const ok = (v) => { assert.ok(v); checks++; };
const cfg = { seed: 7349, cellM: 6, jitter: 1.5, fill: 0.8, maxTrees: 1500, lodCells: 6,
  species: [{ model: 'oak', weight: 1, trunkR: 0.4, trunkH: 3 },
    { model: 'birch', weight: 3, trunkR: 0.7, trunkH: 4 },
    { model: 'unused', weight: 1, trunkR: 0.4, trunkH: 3 }] };
const scatter = { count: 5, x: Float64Array.of(1.25, 3, -4, 5, 6),
  y: Float64Array.of(2, -3.25, 4, 5, 6), z: Float64Array.of(-0.1, 8.75, -2, 5, 6),
  yawDeg: Int16Array.of(0, 37, 90, 180, 359), species: Uint8Array.of(0, 1, 0, 1, 1) };
const world = { scatter, terrain: { recipe: { recipe: { forest: { trees: cfg } } } } };
const instances = new InstanceGroups();
instances.bindPool({ models: new Map([['oak', {}], ['birch', {}]]) });
const units = instances.group('units', 2);
let groups = bindScatterInstances(world, instances);
ok(groups.length === 2 && instances.groups.length === 3);
ok(groups[0].modelKey === 'oak' && groups[1].modelKey === 'birch');
ok(groups[0].count === 2 && groups[0].ib.capacity === 2);
ok(groups[1].count === 3 && groups[1].ib.capacity === 3);
ok(groups.every(g => g.lodCells === 6 && g.pose.clip === -1));
const expected = createInstanceBuffer(1);
const ids = new Set();
for (const group of groups) {
  let slot = 0;
  for (let i = 0; i < scatter.count; i++) {
    if (cfg.species[scatter.species[i]].model !== group.modelKey) continue;
    writeUnitInstance(expected, 0, scatter.x[i], scatter.y[i], scatter.z[i], scatter.yawDeg[i],
      SCATTER_OBJECT_BASE | i, 0);
    for (let word = 0; word < INSTANCE_STRIDE; word++) {
      assert.equal(group.ib.u32[slot * INSTANCE_STRIDE + word], expected.u32[word]);
    }
    ids.add(group.ib.u32[slot * INSTANCE_STRIDE + INST_OBJECT_ID]);
    slot++;
  }
}
ok(ids.size === scatter.count && Math.min(...ids) === SCATTER_OBJECT_BASE);
const old = groups;
groups = bindScatterInstances(world, instances, groups);
ok(instances.groups.length === 3 && old.every(g => !instances.groups.includes(g)));
groups = bindScatterInstances(null, instances, groups);
ok(groups.length === 0 && instances.groups.length === 1 && instances.groups[0] === units);
ok(bindScatterInstances({ scatter: null }, instances).length === 0);
ok(bindScatterInstances({ ...world, scatter: { ...scatter, count: 0 } }, instances).length === 0);
instances.pool.models.delete('birch');
assert.throws(() => bindScatterInstances(world, instances), /missing voxel model birch/); checks++;
ok(instances.groups.length === 1);
instances.pool.models.set('birch', {});
for (let i = 1; i < MAX_INSTANCE_GROUPS; i++) instances.group('units', 1);
assert.throws(() => bindScatterInstances(world, instances), /over 32 groups/); checks++;
ok(instances.groups.length === MAX_INSTANCE_GROUPS);

// Exercise the real load/setWorld lifecycle without a browser renderer.
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
const canvas = () => ({ getContext: () => ctx });
globalThis.window = { innerWidth: 0, innerHeight: 0, addEventListener() {} };
globalThis.document = { createElement: canvas };
const recipe = { map: { w: 192, h: 192, cell: 2 }, chunk: { size: 128, nearCell: 2 },
  recipe: { forest: { canopy: 10, maxSlope: 0.5, trees: cfg } },
  util: { heightAt: () => 0, typeAt: () => 1, gridHeight: () => 0,
    bake: (x0, y0, cell, w, h) => ({ x0, y0, cell, w, h,
      height: new Float32Array(w * h), type: new Uint8Array(w * h).fill(1) }) } };
const level = { name: 'fixture', rows: ['.'], start: { x: 0.5, y: 0.5 }, legend: {
  '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'grass', ceilMat: 'sky' },
} };
const assets = { terrain: () => recipe, level: () => level, contentVersion: null };
const def = { name: 'fixture', terrain: 'fixture', sun: {},
  structures: [{ id: 'fixture', level: 'fixture', origin: { x: 0, y: 0, z: 0 } }], entities: [] };
const engine = createEngine({ canvas: canvas(), assets, force2d: true, inputTarget: window });
engine.instances.bindPool({ models: new Map(cfg.species.map(s => [s.model, {}])) });
let listenerCount = 0;
engine.events.on('world:loaded', ({ world: loaded }) => {
  assert.equal(engine.instances.groups.reduce((n, g) => n + g.count, 0), (loaded.scatter?.count || 0) + (engine._detail?.fed || 0));
  listenerCount++;
});
const on = engine.loadWorld(def, { physics: 'mesh', realTrees: true });
ok(on.scatter.count > 0 && engine.instances.groups.length === 3 && listenerCount === 1);
const words = engine.instances.groups.map(g => Buffer.from(g.ib.u32.buffer));
const saved = serialize(on);
ok(!('scatter' in saved));
const restored = deserialize(saved, assets, { physics: 'mesh', realTrees: true });
engine.setWorld(restored);
ok(engine.world === restored && restored.scatter.count === on.scatter.count && listenerCount === 2);
ok(engine.instances.groups.every((g, i) => Buffer.from(g.ib.u32.buffer).equals(words[i])));
ok(JSON.stringify(serialize(restored)) === JSON.stringify(saved));
engine.loadWorld(def, { physics: 'mesh', realTrees: false });
ok(engine.instances.groups.length === 0 && engine.world.scatter === null && listenerCount === 3);
engine.setWorld(on);
ok(engine.instances.groups.length === 3 && listenerCount === 4);
engine.setWorld(deserialize(saved, assets, { physics: 'mesh', realTrees: false }));
ok(engine.instances.groups.length === 0 && listenerCount === 5);
engine.loadWorld({ name: 'empty', structures: [], entities: [], sun: {} });
ok(engine.instances.groups.length === 0 && listenerCount === 6);
const detail = { count: 1, x: Float64Array.of(2), y: Float64Array.of(2), z: Float64Array.of(0),
  yawDeg: Int16Array.of(37), species: Uint16Array.of(0), r2: Float32Array.of(100),
  speciesDefs: [{ model: 'oak', shadow: false, lodCells: 4 }],
  tileM: 16, tx0: 0, ty0: 0, tilesX: 1, tilesY: 1, tileStart: Uint32Array.of(0, 1) };
const owner = { _detail: null };
const detailRegistry = new InstanceGroups();
detailRegistry.bindPool({ models: new Map([['oak', {}]]) });
const retainedUnit = detailRegistry.group('units', 1);
const detailWorld = { detail, def: { spawn: { x: 2, y: 2 } },
  terrain: { recipe: { recipe: { detail: { maxDraw: 2, refeedM: 4 } } } } };
const treeGroups = bindScatterInstances(detailWorld, detailRegistry, [], owner);
ok(treeGroups.length === 0 && owner._detail.fed === 1);
ok(owner._detail.groups[0].castShadow === false);
const oldDetailGroup = owner._detail.groups[0];
bindScatterInstances({ scatter: null }, detailRegistry, treeGroups, owner);
ok(owner._detail === null && !detailRegistry.groups.includes(oldDetailGroup) && detailRegistry.groups.includes(retainedUnit));
detailRegistry.pool.models.set('birch', {});
let previousTrees = bindScatterInstances(world, detailRegistry);
detailRegistry.pool.models.delete('birch');
assert.throws(() => bindScatterInstances(world, detailRegistry, previousTrees), /missing voxel model birch/); checks++;
ok(detailRegistry.groups.length === 1 && previousTrees.every(g => !detailRegistry.groups.includes(g)));
detailRegistry.pool.models.set('birch', {});
previousTrees = bindScatterInstances(world, detailRegistry);
const missingDetail = { ...detailWorld, scatter, terrain: { recipe: { recipe: {
  forest: { trees: cfg }, detail: { maxDraw: 2, refeedM: 4 } } } },
  detail: { ...detail, speciesDefs: [{ model: 'missing', shadow: false, lodCells: 4 }] } };
assert.throws(() => bindScatterInstances(missingDetail, detailRegistry, previousTrees, owner), /missing voxel model missing/); checks++;
ok(owner._detail === null && detailRegistry.groups.length === 1);
const realDetailWorld = { ...detailWorld, events: engine.events, structures: [], entities: [] };
engine.setWorld(realDetailWorld);
ok(engine._detail?.groups.length === 1);
engine.feedDetail({ x: 2, y: 2 }, true);
engine._detail.groups[0].ib.u32.fill(0xdeadbeef);
engine.feedDetail({ x: 2, y: 2, teleport: true });
ok(engine._detail.groups[0].ib.u32[0] !== 0xdeadbeef && engine._detail.fed === 1);
engine.setWorld({ events: engine.events, structures: [], entities: [] });
ok(engine._detail === null && engine.instances.groups.length === 0);
// FOLIAGE-SWAY-01: species.sway is an explicit per-species flag (no name matching). The bit is OR'd into word 13 for
// every instance of a swaying species, never set for a non-swaying one, and the aligned/team bits stay as writeUnitInstance wrote them.
{
  const swayCfg = { seed: 1, cellM: 6, jitter: 1.5, fill: 0.8, maxTrees: 10, lodCells: 6,
    species: [{ model: 'oak', weight: 1, trunkR: 0.4, trunkH: 3, sway: true }, // foliage: sways
      { model: 'birch', weight: 1, trunkR: 0.4, trunkH: 3 }] };               // rock stand-in: no sway flag
  const swayScatter = { count: 4, x: Float64Array.of(1, 2, 3, 4), y: Float64Array.of(1, 2, 3, 4),
    z: Float64Array.of(0, 0, 0, 0), yawDeg: Int16Array.of(0, 45, 90, 180), species: Uint8Array.of(0, 0, 1, 1) };
  const swayWorld = { scatter: swayScatter, terrain: { recipe: { recipe: { forest: { trees: swayCfg } } } } };
  const swayInstances = new InstanceGroups();
  swayInstances.bindPool({ models: new Map([['oak', {}], ['birch', {}]]) });
  const swayGroups = bindScatterInstances(swayWorld, swayInstances);
  const oakGroup = swayGroups.find(g => g.modelKey === 'oak'), rockGroup = swayGroups.find(g => g.modelKey === 'birch');
  ok(oakGroup.count === 2 && rockGroup.count === 2);
  for (let i = 0; i < oakGroup.count; i++) ok((oakGroup.ib.u32[i * INSTANCE_STRIDE + INST_FLAGS] & INST_FLAG_SWAY) !== 0);
  for (let i = 0; i < rockGroup.count; i++) ok((rockGroup.ib.u32[i * INSTANCE_STRIDE + INST_FLAGS] & INST_FLAG_SWAY) === 0);
  // other word-13 bits unchanged: aligned bit still follows the yaw-multiple-of-90 rule (yaws 0, 45 went to the oak group), team stays 0
  ok((oakGroup.ib.u32[0 * INSTANCE_STRIDE + INST_FLAGS] & INST_FLAG_ALIGNED) !== 0); // yaw 0
  ok((oakGroup.ib.u32[1 * INSTANCE_STRIDE + INST_FLAGS] & INST_FLAG_ALIGNED) === 0); // yaw 45
  ok((oakGroup.ib.u32[0 * INSTANCE_STRIDE + INST_FLAGS] >>> 8) === 0 && (oakGroup.ib.u32[1 * INSTANCE_STRIDE + INST_FLAGS] >>> 8) === 0);
}
console.log(`${checks} passed, 0 failed. ALL PASS`);
