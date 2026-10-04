import assert from 'node:assert/strict';
import { AssetRegistry } from '../../engine/index.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/lever.js';
import '../../design/models/voxel_props.js';
import '../../design/models/far_tower.js';
import '../../design/models/rubble.js';
import '../../design/models/wreckage.js';
import { createIconWorld } from './iconRender.js';
import { modelBounds } from './iconFit.js';
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
const warmup = createIconWorld(assets);
assert.equal(warmup.structures[0].level.def.props.length, 0);
assert.equal(warmup.outsideSector(-10, -10).solid, false);
let warmupCount = 0;
warmup.forEachEntity(() => warmupCount++);
assert.equal(warmupCount, 0);
for (const key of ['lever', 'farTower', 'rubble', 'rope']) {
  const world = createIconWorld(assets, key);
  assert.equal(world.structures.length, 1);
  assert.equal(world.structures[0].level.width, 6);
  assert.equal(world.structures[0].level.height, 6);
  assert.equal(world.sectorAt(3, 3).ceilH, 'sky');
  assert.equal(world.sectorAt(3, 3).floorH, 0);
  assert.equal(world.outsideSector(-10, -10).solid, false);
  assert.equal(world.outsideSector(-10, -10).floorH, 0);
  assert.equal(world.outsideSector(-10, -10).ceilH, 'sky');
  assert.equal(world.structures[0].level.outsideSector(-10, -10).solid, false);
  const props = world.structures[0].level.def.props;
  assert.equal(props.length, 1);
  assert.equal(props[0].model, key);
  assert.equal(props[0].facing, 180);
  assert.equal(assets.has('level', '__icon'), false);
  let count = 0;
  world.forEachEntity(() => count++);
  assert.equal(count, 1);
  if (key === 'rubble' || key === 'rope') {
    assert.deepEqual(modelBounds(assets.model(key)), modelBounds(assets.model(`${key}#0`)));
    assert.equal(props[0].variant, 0);
    world.forEachEntity(entity => assert.equal(entity.components.sprite.model, `${key}#0`));
  }
}
console.log('iconRender: 5 mini-world tests PASS (4 real models + empty warmup)');
