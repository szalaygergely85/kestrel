// US-104b AC1/AC2: the 3 Outwall track chests. Deterministic, equals the committed world, each 8..25 m from the track and >= 8 m from the route-walk lines (incl. leg 10o),
// >= 3 m from other placements, z = ground, in the walk bounds, T3 table; the US-104a chests are untouched (generator reproduces them byte-identically).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { buildSecrets, SECRET_IDS, segNear } from './gen-secrets-ch12.mjs';
import { buildOutwallSecrets, OW_IDS, OW_PATH, OW_CFG } from './gen-secrets-outwall.mjs';
import { staticReach } from './reach-check.mjs';
import { CHEST_TABLES, OUTWALL_SECRET_TABLE } from '../game/js/quest/sim/chestDefs.js';

const w = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const a = await buildOutwallSecrets(w), b = await buildOutwallSecrets(w);
assert.equal(stringifyContent(a.data), stringifyContent(b.data), 'deterministic');
assert.equal(stringifyContent(a.data), stringifyContent(w), 'committed world_m1 == generator output (rerun tools/gen-secrets-outwall.mjs)');
assert.deepEqual(a.log.map((l) => l.id), OW_IDS);
const old = (await buildSecrets(w)).data; // AC2 golden: US-104a chests unchanged by the new ones
assert.equal(stringifyContent(old.entities.filter((e) => SECRET_IDS.includes(e.id))), stringifyContent(w.entities.filter((e) => SECRET_IDS.includes(e.id))), 'US-104a chests byte-identical');
const ent = w.entities.filter((e) => OW_IDS.includes(e.id));
assert.equal(ent.length, 3);
for (const e of ent) {
  assert.equal(e.components.voxel.model, 'chestSmall'); assert.equal(e.z, 'ground');
  const t = segNear(e.x, e.y, OW_PATH); assert.ok(t.d >= 8 && t.d <= 25, `${e.id} ${t.d.toFixed(1)} m from the track`);
  for (const P of OW_CFG.lines) assert.ok(segNear(e.x, e.y, P).d >= 8, e.id + ' >= 8 m from a route-walk line');
  for (const o of [...w.entities.filter((q) => q.id !== e.id && typeof q.x === 'number'), ...w.structures.filter((s) => s.origin && !/Grass|Flower|Clover|Fern|Plant_|Pebble|Mushroom/.test(s.mesh || ''))]) {
    const ox = o.origin ? o.origin.x : o.x, oy = o.origin ? o.origin.y : o.y;
    assert.ok(Math.hypot(ox - e.x, oy - e.y) >= 3, `${e.id} >= 3 m from ${o.id}`);
  }
  assert.ok(CHEST_TABLES[e.id] === OUTWALL_SECRET_TABLE, e.id + ' T3 table');
}
assert.deepEqual(staticReach(w).bad.filter((p) => OW_IDS.includes(p.id)), [], 'inside the walk bounds');
assert.equal(OUTWALL_SECRET_TABLE.gear.tier, 'fine');
console.log('gen-secrets-outwall.test: OK', JSON.stringify(a.log));
