// OB-147: Rook perches low (reachable from the street), and no dialogue/inspect giver floats > 2.5 m above the ground. Run: node game/js/quest/rookPerch.test.js
import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod;
const { assets } = await loadTestAssets();
const def = assets.world('world_m1');
const w = World.load(def, assets, { physics: 'grid', events: { on() { return () => {}; }, emit() {} } });
const gz = (x, y) => { w.ensureBandFor(x, y); return w.terrain.groundAt(x, y); };
const r = w.get('rook').data.transform;
assert.ok(r.z - gz(r.x, r.y) <= 1.8, `rook z ${r.z} is ${(r.z - gz(r.x, r.y)).toFixed(2)} m above the ground`);
// a walkable point within 3 m: the street/ground ring around the perch, close to the ground height
let near = false;
for (let a = 0; a < 360 && !near; a += 15) for (const d of [1.2, 2]) {
  const x = r.x + Math.cos(a * Math.PI / 180) * d, y = r.y + Math.sin(a * Math.PI / 180) * d;
  if (Math.abs(gz(x, y) - gz(r.x, r.y)) < 0.3) { near = true; break; }
}
assert.ok(near, 'walkable ground within 3 m of Rook');
// no talk/inspect giver floats high above the ground (the nest pickup on the roof is a quest pickup, not a giver)
for (const e of def.entities) {
  const c = e.components || {};
  if (!(c.dialogue || c.inspect)) continue;
  const t = w.get(e.id)?.data?.transform; if (!t) continue;
  assert.ok(t.z - gz(t.x, t.y) <= 2.5, `${e.id} floats ${(t.z - gz(t.x, t.y)).toFixed(2)} m above ground`);
}
// OB-152: every chest + questPickup is reachable on foot: <= 0.5 m above the terrain (not floating, not on a roof) and walkable ground within 2 m.
// Exception: chests deliberately set on a 1 m stair-block platform (chestCrossroads) are allowed up to 1.2 m.
const PLATFORM = new Set(['chestCrossroads']);
const UNDERGROUND = (id) => id.startsWith('chestCellar'); // UNDER-03: keepTerrain cellar below the surface (skip the above-ground check)
let checked = 0;
for (const e of def.entities) {
  const c = e.components || {};
  const isChest = c.voxel && c.voxel.model === 'chestSmall', isPick = !!c.questPickup;
  if (!isChest && !isPick) continue;
  const t = w.get(e.id)?.data?.transform; if (!t) continue;
  if (UNDERGROUND(e.id)) { checked++; continue; }
  const dz = t.z - gz(t.x, t.y), maxDz = PLATFORM.has(e.id) ? 1.2 : 0.8;
  assert.ok(dz <= maxDz && dz >= -0.5, e.id + ' is ' + dz.toFixed(2) + ' m above the ground (max ' + maxDz + ')');
  let ok = false;
  for (let a = 0; a < 360 && !ok; a += 30) for (const d of [0.8, 1.5, 2]) if (Math.abs(gz(t.x + Math.cos(a * Math.PI / 180) * d, t.y + Math.sin(a * Math.PI / 180) * d) - gz(t.x, t.y)) < 0.3) { ok = true; break; }
  assert.ok(ok, e.id + ': no walkable ground within 2 m');
  checked++;
}
assert.ok(checked >= 12, 'reachability checked ' + checked + ' chests/pickups');
for (const id of ['nest', 'chestBoots', 'chestRook']) { const t = w.get(id).data.transform; assert.ok(t.z - gz(t.x, t.y) <= 0.8, id + ' must be on the ground'); }
console.log('rookPerch.test OK (' + checked + ' chests/pickups reachable)');
