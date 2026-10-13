// WM-13: one dormant relay waystone per opened region (tools/gen-region-relays.mjs). Node only: data checks (terrain flatness/water is the generator's job).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outsidePolygon } from './bandPose.js';
import geoMod from '../../../design/levels/world_geo.js';

geoMod;
const geo = globalThis.ASSETS.levels.world_geo;
const def = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const REGIONS = { glasswater: 'glasswater', northwood: 'northwood', highPastures: 'alpine', ashMile: 'ashMile', downs: 'downs', signalHill: 'signalHill', heath: 'westHeath', reedmire: 'reedmire', strand: 'strand', whitecombs: 'whitecombs' };
const regionOf = (x, y) => geo.regions.find((r) => x >= r.r[0] && x < r.r[2] && y >= r.r[1] && y < r.r[3]);
const orders = new Set(def.entities.filter((e) => e.components && e.components.waystone).map((e) => e.components.waystone.order));
let n = 0;
for (const [suf, reg] of Object.entries(REGIONS)) {
  const e = def.entities.find((q) => q.id === 'relay_' + suf); assert.ok(e, 'relay_' + suf); n++;
  const w = e.components.waystone;
  assert.deepEqual([w.id, w.kind, w.label], ['ws_' + suf, 'relay', 'place.relay.ws_' + suf]);
  assert.equal(e.components.voxel.anim, 'dead'); assert.equal(e.components.light.on, false);
  assert.equal(regionOf(e.x, e.y).id, reg, suf + ' region');
  assert.ok(!outsidePolygon({ bounds: def.bounds }, e.x, e.y), suf + ' inside bounds');
  for (const s of def.structures) assert.ok(Math.hypot(s.origin.x - e.x, s.origin.y - e.y) >= 8, `${suf} clear of ${s.id}`);
  for (const o of def.entities) if (o !== e && o.x !== undefined && o.type !== 'player') assert.ok(Math.hypot(o.x - e.x, o.y - e.y) >= 8, `${suf} clear of ${o.id}`);
}
const all = def.entities.filter((e) => e.components && e.components.waystone && e.components.waystone.kind === 'relay');
assert.equal(new Set(all.map((e) => e.components.waystone.id)).size, all.length, 'unique waystone ids');
assert.equal(orders.size, def.entities.filter((e) => e.components && e.components.waystone).length, 'unique travel order');
console.log(`regionRelays: ok (${n} relays)`);
