import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import { createVitals } from '../../../game/js/quest/sim/vitals.js';
import { VITALS_DEFAULTS } from '../../../game/js/quest/sim/vitalsConfig.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import voxelPropsMod from '../../../design/models/voxel_props.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import titleMod from '../../../design/models/title.js';
// OB-018: relays + the waystone stand on the ground (base within 0.15 m of the terrain), plinth flush. Run: node game/js/quest/relayGround.test.js
import voxelWorldMod from '../../../design/models/voxel_world.js';
import { moveCircleMesh, Events } from '../../../engine/dev.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod; createVitals; VITALS_DEFAULTS; moveCircleMesh;
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events() });
import { readFileSync } from 'node:fs';
const raw = readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8');
const plinthZ = (id) => Number(new RegExp('"id": "' + id + '"[^\n]*?"origin": \{[^}]*"z": (-?[0-9.]+)').exec(raw)[1]);
for (const [id, plinth] of [['relayBend', 'relayBendBase'], ['relayFord', 'relayFordBase'], ['endMarker', null]]) {
  const t = w.get(id).data.transform;
  w.ensureBandFor(t.x, t.y);
  const g = w.terrain.groundAt(t.x, t.y);
  assert.ok(Math.abs(t.z - g) <= 0.15, `${id} base z ${t.z} vs ground ${g}`);
  if (plinth) { // flat slab (0.17 m) sunk ~0.1 m at the footprint centre: top within 0.15 m of the ground
    const top = plinthZ(plinth) + 0.17;
    assert.ok(top - g <= 0.15 && top - g >= -0.15, `${plinth} top ${top} vs ground ${g}`);
  }
}
console.log('relayGround ok');
