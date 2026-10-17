// WMP-09: region save/load sweep (6 regions) in Node; see tools/region-save-sweep.mjs.
import assert from 'node:assert/strict';
import { authoredHomes } from '../game/js/quest/sim/regionalBeasts.js';
import { SPAWN_AREAS } from '../game/js/quest/sim/spawnAreas.js';
import { runSweep } from './region-save-sweep.mjs';
// Exact painted membership must not turn nearby authored beasts into generated beasts.
const area = SPAWN_AREAS.find(a => a.count > 0);
assert.ok(area, 'real painted content exercises restored-member exclusion');
const entity = (id, home) => ({id, components:{brain:{kind:'beast', home}}});
const entities = [entity(`${area.kind}.${area.id}.1`, [1,2]),
  entity(`${area.kind}.${area.id}.${area.count + 1}`, [3,4]), entity('authored.quest-beast', [5,6])];
assert.deepEqual(authoredHomes({forEachEntity(fn) {entities.forEach(fn);}}), [[3,4],[5,6]],
  'only exact painted member ids are omitted from authored avoid homes');
const r = await runSweep();
for (const f of r.fails) console.log('FAIL ' + f);
console.log(`region-save-sweep.test: ${r.rows.length} regions, ${r.fails.length} failures`);
if (r.fails.length || r.rows.length !== 6) process.exit(1);
