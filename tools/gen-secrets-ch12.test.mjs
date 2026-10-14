// US-104a AC1/AC2: the 4 Ch1-2 hidden chests. Deterministic generator (same seed = byte-identical json, equals the committed world), each chest 8..25 m from the road
// (>= 8 m from the route-walk lines), >= 3 m from every other placement, z = ground, in the walk bounds, with a table that gives arrows + a ~8 % gear roll.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { anchorChests, MOVE } from './anchor-chests.mjs';
import { buildSecrets, SECRET_IDS, PATH, segNear } from './gen-secrets-ch12.mjs';
import { staticReach } from './reach-check.mjs';
import { CHEST_TABLES, SECRET_TABLE } from '../game/js/quest/sim/chestDefs.js';

// OB-152: anchored chests lie inside their camp (leashR) and >= 3 m from every goblin member spot
function checkAnchored(e) {
  const camps = JSON.parse(readFileSync(new URL('../content/life/goblinCamps.json', import.meta.url), 'utf8')).camps;
  const c = camps.find((q) => Math.hypot(q.at[0] - e.x, q.at[1] - e.y) <= q.leashR);
  assert.ok(c, e.id + ' inside a camp radius');
  for (const m of c.members) assert.ok(Math.hypot(c.at[0] + m.at[0] - e.x, c.at[1] + m.at[1] - e.y) >= 3, `${e.id} >= 3 m from ${m.id}`);
}
const ANCHORED = (e) => Object.hasOwn(MOVE, e.id);
const file = new URL('../content/worlds/world_m1.world.json', import.meta.url);
const w = JSON.parse(readFileSync(file, 'utf8'));
const a = await buildSecrets(w), b = await buildSecrets(w);
assert.equal(stringifyContent(a.data), stringifyContent(b.data), 'deterministic: same seed = byte-identical json');
// OB-152: the world json was patched by tools/anchor-chests.mjs (3 chests removed, secretRook moved into campEast): no byte-equality / count / road-distance checks
assert.equal(stringifyContent(anchorChests(a.data)), stringifyContent(w), 'generator + anchor-chests reproduces the committed world_m1');
assert.equal(stringifyContent(anchorChests(w)), stringifyContent(w), 'anchor-chests is idempotent');
assert.deepEqual(a.log.map((l) => l.id), SECRET_IDS);
const ent = w.entities.filter((e) => SECRET_IDS.includes(e.id));
assert.equal(ent.length, 1, 'OB-152: only secretRook is left');
for (const e of ent) {
  assert.equal(e.components.voxel.model, 'chestSmall', e.id + ' existing chest model');
  assert.equal(e.z, 'ground', e.id + ' on the ground');
  if (ANCHORED(e)) checkAnchored(e);
  else { const road = segNear(e.x, e.y, PATH); assert.ok(road.d >= 8 && road.d <= 25, `${e.id} ${road.d.toFixed(1)} m from the road`); }
  for (const o of [...w.entities.filter((q) => q.id !== e.id && typeof q.x === 'number'), ...w.structures.filter((s) => s.origin && !/Grass|Flower|Clover|Fern|Plant_|Pebble|Mushroom/.test(s.mesh || ''))]) {
    const ox = o.origin ? o.origin.x : o.x, oy = o.origin ? o.origin.y : o.y;
    assert.ok(Math.hypot(ox - e.x, oy - e.y) >= 3, `${e.id} >= 3 m from ${o.id}`);
  }
  assert.ok(CHEST_TABLES[e.id] === SECRET_TABLE, e.id + ' has the secret table');
}
assert.deepEqual(staticReach(w).bad.filter((p) => SECRET_IDS.includes(p.id)), [], 'inside the walk bounds');
assert.equal(SECRET_TABLE.gear.chance, 0.08);
console.log('gen-secrets-ch12.test: OK', JSON.stringify(a.log));
