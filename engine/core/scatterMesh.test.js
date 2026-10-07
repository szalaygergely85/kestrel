// TREES-LP-b (37.15 item 5): forest species `mesh` XOR `model`. Run: node engine/core/scatterMesh.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEngine, SCATTER_OBJECT_BASE } from './engine.js';
import { validateScatterConfig } from '../world/scatter.js';
import { createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE } from '../mesh/instances.js';
import { meshFromJSON } from '../mesh/MeshData.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const oak = meshFromJSON(JSON.parse(fs.readFileSync(new URL('../../content/meshes/kenney/tree_oak.mesh.json', import.meta.url), 'utf8')));
const cfg = { seed: 7349, cellM: 6, jitter: 1.5, fill: 0.8, maxTrees: 1500, lodCells: 6,
  species: [{ model: 'oak', weight: 1, trunkR: 0.4, trunkH: 3 },
    { mesh: 'trees/oakA', weight: 3, trunkR: 0.5, trunkH: 4, shadow: false }] };

// validator: exactly one of model / mesh
const base = { ...cfg };
const withSp = (sp) => ({ ...base, species: [sp] });
const sp0 = { weight: 1, trunkR: 0.4, trunkH: 3 };
validateScatterConfig(base); checks++;
assert.throws(() => validateScatterConfig(withSp({ ...sp0 })), /exactly one of model\/mesh/); checks++;
assert.throws(() => validateScatterConfig(withSp({ ...sp0, model: 'a', mesh: 'b' })), /species\[0\]: exactly one of model\/mesh/); checks++;
assert.throws(() => validateScatterConfig(withSp({ ...sp0, mesh: '' })), /species\[0\]\.mesh/); checks++;
assert.throws(() => validateScatterConfig(withSp({ ...sp0, model: 7 })), /species\[0\]\.model/); checks++;

const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
const canvas = () => ({ getContext: () => ctx });
globalThis.window = { innerWidth: 0, innerHeight: 0, addEventListener() {} };
globalThis.document = { createElement: canvas };
const recipe = { map: { w: 192, h: 192, cell: 2 }, chunk: { size: 128, nearCell: 2 },
  recipe: { forest: { canopy: 10, maxSlope: 0.5, trees: cfg } },
  util: { heightAt: () => 0, typeAt: () => 1, gridHeight: () => 0,
    bake: (x0, y0, cell, w, h) => ({ x0, y0, cell, w, h, height: new Float32Array(w * h), type: new Uint8Array(w * h).fill(1) }) } };
const level = { name: 'fixture', rows: ['.'], start: { x: 0.5, y: 0.5 }, legend: {
  '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'grass', ceilMat: 'sky' } } };
const meshes = { 'trees/oakA': oak };
const assets = { terrain: () => recipe, level: () => level, contentVersion: null,
  has: (k, id) => k === 'mesh' && id in meshes, mesh: (id) => meshes[id] };
const def = { name: 'fixture', terrain: 'fixture', sun: {},
  structures: [{ id: 'fixture', level: 'fixture', origin: { x: 0, y: 0, z: 0 } }], entities: [] };
const engine = createEngine({ canvas: canvas(), assets, force2d: true, inputTarget: window });
engine.instances.bindPool({ models: new Map([['oak', {}]]) });

const w = engine.loadWorld(def, { physics: 'mesh', realTrees: true });
ok(w.scatter.count > 0 && w.scatterMeshes && w.scatterMeshes[0] === null && w.scatterMeshes[1] === oak);
const groups = engine.instances.groups;
ok(groups.length === 2, `groups ${groups.length}`);
const gv = groups.find(g => !g.mesh), gm = groups.find(g => g.mesh);
ok(gv.modelKey === 'oak' && gv.lodCells === 6 && gm.mesh === oak && gm.lodCells === 0 && gm.castShadow === false && gm.parts.count === 1);
let n1 = 0; for (let i = 0; i < w.scatter.count; i++) if (w.scatter.species[i] === 1) n1++;
ok(gm.count === n1 && n1 > 0 && gv.count === w.scatter.count - n1);
const expected = createInstanceBuffer(1);
let slot = 0;
for (let i = 0; i < w.scatter.count; i++) {
  if (w.scatter.species[i] !== 1) continue;
  writeUnitInstance(expected, 0, w.scatter.x[i], w.scatter.y[i], w.scatter.z[i], w.scatter.yawDeg[i], SCATTER_OBJECT_BASE | i, 0);
  for (let k = 0; k < INSTANCE_STRIDE; k++) assert.equal(gm.ib.u32[slot * INSTANCE_STRIDE + k], expected.u32[k]);
  slot++;
}
checks++;
engine.loadWorld(def, { physics: 'mesh', realTrees: false });
ok(engine.instances.groups.length === 0, 'reload without realTrees leaves 0 groups');

// unknown mesh id throws naming the species
delete meshes['trees/oakA'];
assert.throws(() => engine.loadWorld(def, { physics: 'mesh', realTrees: true }), /species\[1\].*unknown mesh "trees\/oakA"/); checks++;
console.log(`${checks} checks ALL PASS`);
