// QUEST-CHAIN-02c: the first quest's beast objective is 5 boars; boar1..boar5 are placed in world_m1 on walkable
// hillside ground, boar3..5 at least 18 m apart. Run: node game/js/quest/sim/boarPlacement.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../../../../engine/index.js';
import '../../../../design/palette.js';
import '../../../../design/detail-pass.js';
import '../../../../design/levels/overworld_far.js';
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'menu_ui', 'notes', 'brazier']) await import(`../../../../design/models/${m}.js`);
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { buildBeastNav } from './beastNav.js';

const rd = (p) => JSON.parse(readFileSync(new URL(`../../../../${p}`, import.meta.url)));
const quest = rd('content/quests/m1.quest.json');
const worldJson = rd('content/worlds/world_m1.world.json');

const obj = quest.objectives.find((o) => o.id === 'beasts');
assert.equal(obj.when.count, 5, 'objective count is 5');
assert.deepEqual(obj.when.ids, ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']);
assert.equal(obj.text, 'Bring down the five wild boars', 'writer text obj.beasts5');

const boars = worldJson.entities.filter((e) => e.type === 'beast');
assert.deepEqual(boars.map((b) => b.id), obj.when.ids, 'one beast entity per objective id');
const byId = Object.fromEntries(boars.map((b) => [b.id, b]));
assert.deepEqual([byId.boar1.x, byId.boar1.y, byId.boar2.x, byId.boar2.y], [1461.01, 1031, 1444.02, 1035], 'boar1/boar2 unchanged');
for (const b of boars) assert.deepEqual(b.components.brain.home, [b.x, b.y], `${b.id} home = spawn`);

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const [b1, b2, b3, b4, b5] = boars;
for (const [a, b] of [[b3, b4], [b4, b5], [b3, b5]]) assert.ok(d(a, b) >= 18, `${a.id}-${b.id} spacing ${d(a, b).toFixed(1)} >= 18`);
for (const b of [b3, b4, b5]) for (const o of [b1, b2]) assert.ok(d(b, o) >= 18, `${b.id}-${o.id} >= 18`);
const breach = { x: 1486.5, y: 1025 };
for (const b of [b3, b4, b5]) assert.ok(d(b, breach) > 15, `${b.id} outside the 15 m breach radius`);

// walkable: real terrain + nav grid (slope < 30 deg, not water, 5x5 neighbourhood unblocked), terrain type not water.
const { assets } = await loadTestAssets();
const wd = assets.world('world_m1');
const origWarn = console.warn; console.warn = () => {};
const world = World.load(wd, assets, {});
console.warn = origWarn;
const g = buildBeastNav(world, wd.nav).grid;
const h = (x, y) => world.terrain.heightAt(x, y);
for (const b of boars) {
  const e = 1.5;
  const slopeDeg = Math.atan(Math.hypot((h(b.x + e, b.y) - h(b.x - e, b.y)) / 3, (h(b.x, b.y + e) - h(b.x, b.y - e)) / 3)) * 180 / Math.PI;
  assert.ok(slopeDeg < 30, `${b.id} slope ${slopeDeg.toFixed(1)} < 30`);
  assert.notEqual(world.terrain.typeAt(b.x, b.y), 2, `${b.id} not on water`);
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    assert.ok(g.cost[g.index(g.cellX(b.x + dx), g.cellY(b.y + dy))] < 255, `${b.id} nav cell (${dx},${dy}) walkable`);
  }
}
// not on a placed road prop / mesh structure (>= 2 m from every mesh origin)
for (const b of [b3, b4, b5]) for (const s of worldJson.structures) if (s.mesh && s.origin) assert.ok(Math.hypot(s.origin.x - b.x, s.origin.y - b.y) >= 2, `${b.id} clear of ${s.id}`);
console.log('boarPlacement: 5 boars, objective count 5, spacing >= 18 m, walkable ground PASS');
