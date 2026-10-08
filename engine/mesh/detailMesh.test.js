// TREES-LP-c (37.15 step c): ground-cover species `mesh` XOR `model`. Run: node engine/mesh/detailMesh.test.js
import { readMeshJSON } from '../test/meshFile.test.js';
import assert from 'node:assert/strict';
import { InstanceGroups } from './instances.js';
import { bindDetailInstances, feedDetail } from './scatterFeed.js';
import { validateDetailConfig } from '../world/scatter.js';
import { meshFromJSON } from './MeshData.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const oak = meshFromJSON(readMeshJSON(new URL('../../content/meshes/kenney/tree_oak.mesh.json', import.meta.url)));

const layer = (sp) => ({ name: 'g', seed: 1, cellM: 2, drawM: 20, jitter: 0.5, fill: 0.5, maxSlope: 1, clearM: 0.5, ground: { grass: [sp] } });
const v = (sp) => validateDetailConfig({ layers: [layer(sp)] });
v({ model: 'tuft', weight: 1 }); v({ mesh: 'a/b', weight: 1 }); checks += 2;
assert.throws(() => v({ weight: 1 }), /exactly one of model\/mesh/); checks++;
assert.throws(() => v({ model: 'a', mesh: 'b', weight: 1 }), /exactly one of model\/mesh/); checks++;
assert.throws(() => v({ mesh: '', weight: 1 }), /\.mesh/); checks++;
assert.throws(() => v({ model: 3, weight: 1 }), /\.model/); checks++;

const points = [], tileStart = [0], tileM = 4;
for (let t = 0; t < 4; t++) { for (let n = 0; n < 6; n++) points.push({ x: t * tileM + n * 0.5, y: 1, species: n % 2 }); tileStart.push(points.length); }
const detail = { count: points.length, tileM, tx0: 0, ty0: 0, tilesX: 4, tilesY: 1, tileStart: Uint32Array.from(tileStart),
  speciesDefs: [{ model: 'tuft', shadow: false, lodCells: 4 }, { mesh: 'trees/oakA', shadow: true, lodCells: 4 }],
  x: Float64Array.from(points, p => p.x), y: Float64Array.from(points, p => p.y), z: new Float64Array(points.length),
  yawDeg: new Int16Array(points.length), species: Uint16Array.from(points, p => p.species), r2: new Float32Array(points.length).fill(100) };
const cfg = { maxDraw: 100, refeedM: 4, layers: [{ drawM: 10 }] };
const mk = () => { const g = new InstanceGroups(); g.bindPool({ models: new Map([['tuft', {}]]) }); return g; };

assert.throws(() => bindDetailInstances(detail, mk(), cfg, 0, undefined, null), /unresolved mesh trees\/oakA/); checks++;
const inst = mk(), b = bindDetailInstances(detail, inst, cfg, 0, undefined, { 'trees/oakA': oak });
ok(b.groups.length === 2);
const gv = b.groups.find(g => !g.mesh), gm = b.groups.find(g => g.mesh);
ok(gv.modelKey === 'tuft' && gv.lodCells === 4 && gm.mesh === oak && gm.lodCells === 0 && gm.castShadow === true && gm.parts.count === 1);
const n = feedDetail(b, 6, 1, true);
ok(n === 24 && gv.count === 12 && gm.count === 12, `fed ${n} ${gv.count}/${gm.count}`);
console.log(`${checks} checks ALL PASS`);
