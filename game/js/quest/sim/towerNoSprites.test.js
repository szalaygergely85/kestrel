// OB-132b: the tower level (spawned inside world_m1) has no sprite component left; flame props are baked / voxel.
import assert from 'node:assert/strict';
await import('../../../../design/palette.js');
await import('../../../../design/detail-pass.js');
await import('../../../../design/levels/overworld_far.js'); await import('../../../../design/levels/world_geo.js');
for (const m of ['lantern', 'lever', 'boulder', 'rubble', 'wreckage', 'relay', 'voxel_props', 'voxel_tower', 'pickups_voxel', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'voxel_beast', 'voxel_bear']) await import(`../../../../design/models/${m}.js`);
const G = globalThis.ASSETS.levels.world_geo, T = globalThis.ASSETS.levels.overworld_far;
G.util.installGeo(T.util);
const { World } = await import('../../../../engine/index.js');
const { loadTestAssets } = await import('../../../../tools/testing/content-node.mjs');
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'grid', events: { on() { return () => {}; }, emit() {} } });
let towers = 0, voxels = 0, fxs = 0;
w.forEachEntity((e) => {
  if (!String(e.id).startsWith('tower.')) return;
  const sp = e.components && e.components.sprite;
  if (sp) { assert.ok(globalThis.ASSETS.models[sp.model]?.fx === true, 'non-fx sprite left on ' + e.id); fxs++; return; }   // OB-172/D-104: fire billboard
  towers++;
  if (e.components && e.components.voxel) voxels++;
});
assert.ok(towers >= 25 && voxels === towers, 'tower entities ' + towers + ' voxel ' + voxels);
for (const id of ['tower.rigging', 'tower.gondola', 'tower.pallet']) assert.ok(w.entity(id) && w.entity(id).components.voxel, id + ' is voxel');
for (const id of ['tower.lampFlame', 'tower.keeperLampFlame', 'tower.stairLampFlame', 'tower.swordLampFlame']) assert.ok(!w.entity(id), id + ' removed (flame baked into the lamp voxel)');
assert.ok(fxs >= 1 && w.entity('tower.burnerFire').components.sprite, 'burnerFire is the fx billboard');
console.log('towerNoSprites ok', towers, voxels, fxs);
