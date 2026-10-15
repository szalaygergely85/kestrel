// OB-205 / OB-175: World#isOutdoorAt is z-aware. Run: node engine/world/outdoorAt.test.js
import assert from 'node:assert/strict';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { World } from './World.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { dynamicTowerAssets } from '../../tools/testing/dynamic-tower.mjs';

paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod;
const { assets: canon } = await loadTestAssets();
const assets = dynamicTowerAssets(canon);
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const cellar = world.structures.find((s) => s.id === 'fordCellar');
assert.ok(cellar, 'fordCellar placed');
const GROUND = -88.1;
// owner points (grass, ~2 m west of the footprint edge): outside, and the 2D structure test still hits (the bug)
assert.equal(world.isOutdoorAt(1007.14, 1057.31, -88.11), true, 'owner point 1: outside');
assert.equal(world.isOutdoorAt(1004.94, 1057.56, -88.09), true, 'owner point 2 (above the cellar wall): outside');
assert.equal(world.structureAt(1004.94, 1057.56)?.id, 'fordCellar', '2D lookup still the structure (collision/lighting rely on it)');
// really inside: cellar room floor, eye height
assert.equal(world.isOutdoorAt(1000.5, 1059.5, -92.5), false, 'in the cellar room: inside');
assert.equal(world.isOutdoorAt(1000.5, 1059.5, -91.0), false, 'cellar room at head height: inside');
// above the room (standing on the grass over it): outside
assert.equal(world.isOutdoorAt(1000.5, 1059.5, GROUND), true, 'on the grass over the room: outside');

// Audit: every grid structure with keepTerrain cells - report those whose 2D footprint reaches walkable outdoor ground
const rep = [];
for (const s of world.structures) {
  if (s.kind === 'mesh' || !s.keepMask) continue;
  rep.push(`${s.id}: keepCells=${s.keepMask.reduce((a, b) => a + b, 0)}`);
}
console.log('outdoorAt.test ok; keepTerrain structures:', rep.join(' | '));
