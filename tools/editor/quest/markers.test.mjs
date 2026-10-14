// ED-QUEST-04: marker positions/colours/numbering over the real world_m1 + quests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { questMarkers, questPath, stepAreas, makeAreaPos, GOLD, BLUE } from './markers.js';
import { MARK_MARGIN, MARK_DEFAULT_TOP } from '../../../game/js/quest/markTop.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const world = JSON.parse(readFileSync(join(root, 'content/worlds/world_m1.world.json'), 'utf8'));
const m = loadQuests(join(root, 'content/quests'));
const sites = JSON.parse(readFileSync(join(root, 'content/quests/sites.json'), 'utf8')).sites;
const floorAt = (x, y) => 50 + x * 0.001 + y * 0.001;
const ctx = { sites, floorAt, topAt: () => 2 };
const q = (id) => m.quests.find((x) => x.id === id);
const ent = (id) => world.entities.find((e) => e.id === id);
const zOf = (id) => (typeof ent(id).z === 'number' ? ent(id).z : floorAt(ent(id).x, ent(id).y));

// side quest (legacy): '!' at bear in blue, pins numbered by step, '?' back at bear
const b = questMarkers(q('sq.burl.blue'), world, ctx);
const give = b.find((x) => x.kind === 'give'), ret = b.find((x) => x.kind === 'return');
assert.equal(give.color, BLUE); assert.equal(ret.color, BLUE); assert.equal(give.label, '!'); assert.equal(ret.label, '?');
assert.equal(give.x, ent('bear').x);
assert.ok(Math.abs(give.z - (zOf('bear') + 2 + MARK_MARGIN)) < 1e-9, 'on the model top of the character, not terrain/roof');
assert.deepEqual(b.filter((x) => x.kind === 'pin').map((p) => p.label), ['2'], 'deliver step -> pin 2; collect without placement has none');
// default top when the resolver has none
assert.ok(Math.abs(questMarkers(q('sq.burl.blue'), world, { sites, floorAt }).find((x) => x.kind === 'give').z - (zOf('bear') + MARK_DEFAULT_TOP + MARK_MARGIN)) < 1e-9);

// main quest is gold, steps numbered 1.. in order, areas on the terrain via the resolver
const areaPos = (n) => (n === 'waystone' ? { x: 10, y: 20, r: 6 } : null);
const mm = questMarkers(q('m1'), world, { ...ctx, areaPos });
assert.ok(mm.every((x) => x.color === GOLD));
const ar = mm.find((x) => x.kind === 'area');
if (ar) { assert.equal(ar.z, floorAt(ar.x, ar.y)); assert.ok(ar.radius > 0); }

// pack quest: ch12 sq.tm.nub with named areas -> 3 rings + 3 pins numbered 1,2,3 in order; site 'burl' resolves to bear
const pos = { waystone: { x: 10, y: 20 }, towerDoor: { x: 30, y: 40, r: 3 }, roadWest: { x: 50, y: 60 } };
const nub = q('sq.tm.nub'), nm = questMarkers(nub, world, { ...ctx, areaPos: (n) => pos[n] });
assert.equal(nm.filter((x) => x.kind === 'area').length, 3);
assert.deepEqual(nm.filter((x) => x.kind === 'pin').map((p) => p.label), ['1', '2', '3']);
assert.equal(nm.find((x) => x.kind === 'area' && x.label === '2').radius, 3);
assert.equal(nm.find((x) => x.kind === 'give').color, BLUE);
assert.equal(nm.find((x) => x.kind === 'give').x, ent('bear').x, 'site -> entity');
const path = questPath(nm);
assert.equal(path.length, 5, 'giver + 3 pins + return'); assert.equal(path[0].x, ent('bear').x); assert.equal(path[1].x, 10);

// both area formats read through one resolver
assert.deepEqual(stepAreas({ template: 'explore', params: { spot: { x: 1, y: 2, z: 3, r: 5 } } }), [{ x: 1, y: 2, z: 3, r: 5 }]);
assert.deepEqual(stepAreas({ when: { type: 'area', x: 1, y: 2, radius: 7 } }), [{ x: 1, y: 2, z: undefined, r: 7 }]);
assert.deepEqual(stepAreas({ params: { areas: ['nope'] } }, { areaPos: () => null }), []);

// every real quest yields finite coordinates and never throws
for (const x of m.quests) for (const k of questMarkers(x, world, { ...ctx, areaPos })) assert.ok([k.x, k.y, k.z].every(Number.isFinite), x.id);
console.log('markers.test ok');
{
  const areasFile = JSON.parse(readFileSync(join(root, 'content/quests/areas.json'), 'utf8'));
  const ap = makeAreaPos(areasFile, world), r = questMarkers(nub, world, { ...ctx, areaPos: ap });
  assert.deepEqual(r.filter((x) => x.kind === 'area').map((a) => [a.x, a.y, a.radius]), [[1428, 1040, 2.5], [1488, 1031, 3], [1340, 1048, 10]]);
  console.log('areaPos ok');
}
