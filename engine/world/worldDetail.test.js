import assert from 'node:assert/strict';
import { World } from './World.js';
import { serialize } from './serialize.js';
let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const layer = { name: 'rocks', seed: 17, cellM: 6, jitter: 0.5, fill: 1, maxSlope: 0.5, clearM: 1,
  drawM: 40, ground: { grass: [{ model: 'rock', weight: 1, collider: { prism: { r: 0.5, h: 0.8 } } }] } };
const recipe = { map: { w: 64, h: 64, cell: 2 }, chunk: { size: 32, nearCell: 2 },
  recipe: { detail: { entityClearM: 8, layers: [layer] } },
  util: { heightAt: () => 0, typeAt: () => 0, gridHeight: () => 0,
    bake: (x0, y0, cell, w, h) => ({ x0, y0, cell, w, h, height: new Float32Array(w * h), type: new Uint8Array(w * h) }) } };
const level = { name: 'fixture', rows: ['.'], start: { x: 0.5, y: 0.5 }, legend: {
  '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'grass', ceilMat: 'sky' } } };
const authored = { name: 'fixture', terrain: 'fixture', sun: {}, structures: [{ id: 'fixture', level: 'fixture', origin: { x: 0, y: 0, z: 0 } }],
  entities: [{ id: 'beast', type: 'beast', x: 16, y: 16, z: 'ground' }, { id: 'prop', type: 'prop', transform: { x: -10, y: -10, z: 0 } }], state: { unchanged: 1 } };
const assets = { terrain: () => recipe, level: () => level, contentVersion: null, has: (kind, name) => kind === 'world' && name === 'fixture', world: () => authored };
const a = World.load(authored, assets, { physics: 'mesh', detail: true });
const saved = structuredClone(authored);
saved.entities[0].x = 80; saved.entities[0].y = 70; saved.entities[1].transform.x = 90;
saved.entities.push({ id: 'runtime', type: 'beast', x: 10, y: 10, z: 0 });
const b = World.load(saved, assets, { physics: 'mesh', detail: true });
for (const key of ['x', 'y', 'z', 'species', 'yawDeg', 'r2', 'tileStart']) { assert.deepEqual(a.detail[key], b.detail[key]); checks++; }
ok(a.detail.count > 100);
ok([...a.detail.x].every((x, i) => Math.hypot(x - 16, a.detail.y[i] - 16) > 8 && Math.hypot(x + 10, a.detail.y[i] + 10) > 8));
ok(a.colliders.filter(c => c.id === 'scatter:detail').length === 1);
const gridOff = World.load(authored, assets), gridOn = World.load(authored, assets, { detail: true });
ok(gridOff.detail === null && gridOn.detail.count === a.detail.count && gridOn.colliders.length === 0);
assert.deepEqual(serialize(gridOff), serialize(gridOn)); checks++;
ok(!Object.hasOwn(serialize(a), 'detail'));
const noConfig = { ...recipe, recipe: {} };
ok(World.load(authored, { ...assets, terrain: () => noConfig }, { detail: true }).detail === null);
const unregistered = World.load(authored, { ...assets, has: () => false }, { detail: true });
ok(unregistered.detail.count > a.detail.count);
console.log(`worldDetail synthetic rocks: ${a.detail.count}; ${checks} checks ALL PASS`);
