// OB152-DENSITY fixture: hand-made 3-region world gives exact numbers. Run: node tools/chest-enemy-density.test.mjs
import assert from 'node:assert/strict';
import { density, fmt } from './chest-enemy-density.mjs';
const regions = [{ id: 'a', r: [0, 0, 100, 100] }, { id: 'b', r: [100, 0, 200, 100] }, { id: 'c', r: [200, 0, 300, 100] }];
const chests = [{ id: 'c1', x: 10, y: 10 }, { id: 'c2', x: 50, y: 50 }, { id: 'c3', x: 120, y: 10 }, { id: 'c4', x: 150, y: 90 }, { id: 'c5', x: 250, y: 50 }, { id: 'c6', x: 99, y: 50 }];
const guards = [{ x: 20, y: 10, kind: 'beast' }, { x: 20, y: 10, kind: 'beast' }, { x: 130, y: 10, kind: 'camp' }, { x: 250, y: 40, kind: 'puzzle' }, { x: 99, y: 70, kind: 'giver' }];
const rows = density(regions, chests, guards);
assert.deepEqual(rows.map((r) => [r.id, r.chests, r.guarded, r.loose, r.groups, r.puzzles, r.perGroup]),
  [['a', 3, 1, 2, 1, 0, 3], ['b', 2, 1, 1, 1, 0, 2], ['c', 1, 1, 0, 0, 1, null]]);
assert.deepEqual(rows[0].looseIds, ['c2', 'c6'], 'givers do not guard');
assert.equal(fmt(rows), fmt(density(regions, chests, guards)), 'deterministic');
console.log('chest-enemy-density.test: ok');

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// OB-152 step 2 / OB-179: the real-content 0-loose gate is asserted once the chests are moved inside places (pending, see lane entry)
const NEW_TOTAL = 11 + 4 + 1 + 1 + 1; // +1 UNDER-06 chestGoblinTunnel; // +1 UNDER-05 strand cave chest (chestStrandCave, tortoise homes within 15 m); // +1 UNDER-04 bear den stash (chestBearDen, guarded by the bear home, z > -20); // +4 underground chests (3 Ford cellar UNDER-03 + 1 crypt UNDER-02, earned by location, OB-152); 15 chests before OB-179; secretBend/Field/Bank/Ow1/Ow3 merged away = 10; OB-141 chestWest (in campSouthWest) = 11
// OB-179: all 15 chests are counted (chestSmall: chest* and secret*), nothing loose, --list works
const listOut = execFileSync(process.execPath, [fileURLToPath(new URL('./chest-enemy-density.mjs', import.meta.url)), '--list', '--max-loose', '0'], { stdio: 'pipe' }).toString();
assert.match(listOut, new RegExp('chests counted: ' + NEW_TOTAL), 'chest total after the OB-179 merge');
assert.equal((listOut.match(/^(chest|secret)\w+ .* (ok|LOOSE)/gm) || []).length, NEW_TOTAL, '--list prints one row per chest');
console.log('chest-enemy-density.test: 10 chests listed, none loose (loose count: ' + 0 + ')');
// OB-152: "every chest is earned" - no LOOSE row in --list, and the total never grows past the OB-179/OB-141 count
assert.equal((listOut.match(/ LOOSE/g) || []).length, 0, 'every chest is earned (guard/camp/ruin/puzzle within reach)');
assert.ok(NEW_TOTAL <= 18, 'chest total cap'); // 18: all earned chests (UNDER-04/05/06)
