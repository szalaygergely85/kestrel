// QD-15a: real painted records, stable slot binding and night-only availability.
import assert from 'node:assert/strict';
import { spawnPaintedBeasts } from './regionalBeasts.js';
import { buildGroups, createSpawnDirector } from './spawnDirector.js';
import { SPAWN_AREAS } from './spawnAreas.js';
import { createUnderSpawner } from './underSkeletons.js';

const entities = [{ id: 'unrelated' }];
const world = { terrain: { heightAt: () => 0, groundAt: () => 0 },
  get: (id) => entities.find((e) => e.id === id),
  spawn(type, transform, components, id) { entities.push({ id, type, transform, components }); } };
spawnPaintedBeasts(world, 12);
spawnPaintedBeasts(world, 12);
assert.equal(entities.length, 1 + SPAWN_AREAS.reduce((n, a) => n + a.count, 0), 'painted entities spawn once');
const groups = buildGroups([], 12), sim = { count: entities.length, slotOf: (id) => entities.findIndex((e) => e.id === id) };
const dir = createSpawnDirector({ groups }).bind(sim);
assert.equal(dir.groupOfSlot[0], -1, 'painted groups never steal unrelated records');
for (const g of groups) for (let k = 0; k < g.members.length; k++) assert.equal(g.slots[k], sim.slotOf(g.members[k].id));
const absent = createSpawnDirector({ groups: buildGroups([], 12) }).bind({ count: 1, slotOf: () => -1 });
assert.equal(absent.groupOfSlot[0], -1, 'missing art/record has no fallback slot');

const site = { id: 'testNight', painted: true, night: true, group: 'testNight', anchor: [0, 0], members: [['testNight.1', 'boar', 0, 0]] };
const nightSim = { count: 1, entities: [{ transform: { x: 0, y: 0, z: 0 } }], slotOf: () => 0,
  down: new Uint8Array([1]), state: new Uint8Array(1), setDown(s, v) { this.down[s] = v ? 1 : 0; } };
const sp = createUnderSpawner({ sim: nightSim, site, state: {} });
sp.step(1 / 60, 10, 0, 0, 1, 0, 12); assert.equal(nightSim.down[0], 1, 'day target unavailable');
sp.step(1 / 60, 10, 0, 0, 1, 0, 22); assert.equal(nightSim.down[0], 0, 'night target wakes');
sp.step(1 / 60, 10, 0, 0, 1, 0, 12); assert.equal(nightSim.down[0], 1, 'first dawn tick parks target');
console.log('paintedSpawn: OK');
