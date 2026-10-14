// ED-AI-04: buildGroups + painted spawn areas. Run: node game/js/quest/sim/spawnAreas.test.js
import assert from 'node:assert/strict';
import { buildGroups } from './spawnDirector.js';
import { SPAWN_AREAS, areaGid, inArea } from './spawnAreas.js';
import { KINDS } from './beastKinds.js';

const mem = [{ kind: 'boar', key: 'downs', group: 0, x: 100, y: 100 }, { kind: 'boar', key: 'downs', group: 0, x: 104, y: 100 }, { kind: 'grey_wolf', key: 'north', group: 0, x: 300, y: 50 }];
const disc = { id: 'east-meadow', shape: 'disc', x: 500, y: 400, r: 40, kind: 'boar', count: 3, respawnSec: 90, when: 'both' };
const poly = { id: 'tri', shape: 'polygon', pts: [[0, 0], [60, 0], [0, 60]], kind: 'grey_wolf', count: 4, respawnSec: 120, when: 'night' };

// identity: shipped file is empty; an empty/absent areas list gives today's groups
assert.equal(SPAWN_AREAS.length, 0);
const base = buildGroups(mem, 12, null, []);
assert.deepEqual(buildGroups(mem, 12), base); assert.deepEqual(buildGroups(mem, 12, null, undefined), base); assert.deepEqual(buildGroups(mem, 12, null, null), base);
assert.equal(base.length, 2);

// one painted area -> the expected group, appended after the rules; slots continue after the members
const g = buildGroups(mem, 12, null, [disc]);
assert.equal(g.length, 3); assert.deepEqual(g.slice(0, 2), base);
const ag = g[2];
assert.equal(ag.gid, areaGid(disc)); assert.match(ag.gid, /^boar\.area\.[0-9a-f]{8}$/);
assert.equal(ag.kind, 'boar'); assert.equal(ag.cls, KINDS.boar.respawn); assert.equal(ag.respawnSec, 90); assert.equal(ag.when, 'both');
assert.deepEqual(ag.slots, [3, 4, 5]); assert.equal(ag.members.length, 3);
for (const m of ag.members) assert.ok(inArea(disc, m.x, m.y), 'member inside the disc');
for (const m of buildGroups(mem, 12, null, [poly])[2].members) assert.ok(inArea(poly, m.x, m.y), 'member inside the polygon');

// determinism: same input same output; gid from the area id (not index); file order changes nothing
assert.deepEqual(buildGroups(mem, 12, null, [disc]), g);
const two = buildGroups(mem, 12, null, [disc, poly]);
assert.deepEqual(two, buildGroups(mem, 12, null, [poly, disc]));
assert.equal(two.find((x) => x.area === 'east-meadow').gid, areaGid(disc));
assert.notEqual(buildGroups(mem, 12, null, [{ ...disc, id: 'other' }])[2].gid, ag.gid);
console.log('spawnAreas (game) OK');
