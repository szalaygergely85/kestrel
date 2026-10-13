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
console.log('rookPerch.test OK');
