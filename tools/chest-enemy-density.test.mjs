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
// OB152-DENSITY-FIX: data-driven - no hard chest total; every chest is earned by RULE (guard/camp/ruin/puzzle within reach, dive, or underground z < -20), so new sites need no cap bump
const listOut = execFileSync(process.execPath, [fileURLToPath(new URL('./chest-enemy-density.mjs', import.meta.url)), '--list', '--max-loose', '0'], { stdio: 'pipe' }).toString();
const total = Number(/chests counted: (\d+)/.exec(listOut)?.[1]);
const rowsOut = listOut.match(/^(chest|secret)\w+ .* (ok( \((dive|underground)\))?|LOOSE)$/gm) || [];
assert.ok(total > 0, 'chests are counted');
assert.equal(rowsOut.length, total, '--list prints one row per chest');
assert.equal((listOut.match(/ LOOSE/g) || []).length, 0, 'every chest is earned (guard/camp/ruin/puzzle in reach, dive, or underground)');
console.log('chest-enemy-density.test: ' + total + ' chests listed, none loose');
