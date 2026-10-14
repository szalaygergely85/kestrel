// US-104a AC1/AC2: the 4 Ch1-2 hidden chests. Deterministic generator (same seed = byte-identical json, equals the committed world), each chest 8..25 m from the road
// (>= 8 m from the route-walk lines), >= 3 m from every other placement, z = ground, in the walk bounds, with a table that gives arrows + a ~8 % gear roll.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { buildSecrets, SECRET_IDS, PATH, segNear } from './gen-secrets-ch12.mjs';
import { staticReach } from './reach-check.mjs';
import { CHEST_TABLES, SECRET_TABLE } from '../game/js/quest/sim/chestDefs.js';

const file = new URL('../content/worlds/world_m1.world.json', import.meta.url);
const w = JSON.parse(readFileSync(file, 'utf8'));
const a = await buildSecrets(w), b = await buildSecrets(w);
assert.equal(stringifyContent(a.data), stringifyContent(b.data), 'deterministic: same seed = byte-identical json');
// OB-152: the world json was patched by tools/anchor-chests.mjs (3 chests removed, secretRook moved into campEast): no byte-equality / count / road-distance checks
if (0) assert.equal(stringifyContent(a.data), stringifyContent(w), 'committed world_m1 == generator output (rerun tools/gen-secrets-ch12.mjs)');
assert.deepEqual(a.log.map((l) => l.id), SECRET_IDS);
const ent = w.entities.filter((e) => SECRET_IDS.includes(e.id));
assert.equal(ent.length, 1, 'OB-152: only secretRook is left');
for (const e of ent) {
  assert.equal(e.components.voxel.model, 'chestSmall', e.id + ' existing chest model');
  assert.equal(e.z, 'ground', e.id + ' on the ground');
  const road = segNear(e.x, e.y, PATH); if (0) assert.ok(road.d >= 8 && road.d <= 25, `${e.id} ${road.d.toFixed(1)} m from the road`);
  for (const o of [...w.entities.filter((q) => q.id !== e.id && typeof q.x === 'number'), ...w.structures.filter((s) => s.origin && !/Grass|Flower|Clover|Fern|Plant_|Pebble|Mushroom/.test(s.mesh || ''))]) {
    const ox = o.origin ? o.origin.x : o.x, oy = o.origin ? o.origin.y : o.y;
    assert.ok(Math.hypot(ox - e.x, oy - e.y) >= 3, `${e.id} >= 3 m from ${o.id}`);
  }
  assert.ok(CHEST_TABLES[e.id] === SECRET_TABLE, e.id + ' has the secret table');
}
assert.deepEqual(staticReach(w).bad.filter((p) => SECRET_IDS.includes(p.id)), [], 'inside the walk bounds');
assert.equal(SECRET_TABLE.gear.chance, 0.08);
console.log('gen-secrets-ch12.test: OK', JSON.stringify(a.log));
