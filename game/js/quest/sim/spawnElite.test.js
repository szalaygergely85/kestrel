// QD-08 (D-120): the three warden elites (Greyback, white alpha, Glasswater crocodile) are painted spawn areas that RESPAWN in their area
// after a LONGER linger than a common beast of the same size. Run: node game/js/quest/sim/spawnElite.test.js
import assert from 'node:assert/strict';
import { buildGroups, createSpawnDirector, RESPAWN_SEC } from './spawnDirector.js';
import { SPAWN_AREAS, areaGid } from './spawnAreas.js';
import { KINDS } from './beastKinds.js';

const ELITES = { 'qd-hp-greyback': 'cave_bear', 'qd-sh-alpha': 'white_wolf', 'qd-glass-croc': 'river_crocodile', 'qd-downs-herder': 'goblin_torch_bearer' }; // QD-15 adds the Downs herder
for (const [id, kind] of Object.entries(ELITES)) {
  const a = SPAWN_AREAS.find((x) => x.id === id);
  assert.ok(a && a.kind === kind && a.count === 1, 'area ' + id);
  assert.ok(a.respawnSec >= RESPAWN_SEC.common * 3, id + ' linger >= 3x common (' + a.respawnSec + ')');
  assert.ok(KINDS[kind], 'kind exists ' + kind);
}
const areas = SPAWN_AREAS.filter((a) => ELITES[a.id]);
const groups = buildGroups([], 12, null, areas);
assert.equal(groups.length, 4);
const respawned = [];
const dir = createSpawnDirector({ groups, los: () => false, onRespawn: (g) => respawned.push(g) });
const gi = groups.findIndex((g) => g.gid === areaGid(areas.find((a) => a.id === 'qd-hp-greyback')));
assert.ok(gi >= 0);
const far = [groups[gi].home[0] - 300, groups[gi].home[1]], sec = (s) => { for (let k = 0; k < s * 60; k++) dir.step(1 / 60, far[0], far[1], -1, 0); };
dir.memberDied(gi);
assert.equal(dir.dead[gi], 1);
sec(RESPAWN_SEC.common + 10); assert.equal(respawned.length, 0, 'elite still down after a common beast would be back');
const need = areas.find((a) => a.id === 'qd-hp-greyback').respawnSec;
sec(need - RESPAWN_SEC.common - 10 - 5); assert.equal(respawned.length, 0, 'not before its linger time');
sec(15); assert.equal(respawned.length, 1, 'back after its linger time'); assert.equal(dir.alive[gi], 1);
console.log('spawnElite.test: OK');
