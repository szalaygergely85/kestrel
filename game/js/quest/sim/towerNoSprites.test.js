// OB-132b: the tower level (spawned inside world_m1) has no ITEM/prop sprite left. Owner 2026-10-14 (OB-167): fire + flame effects stay animated sprites.
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
let towers = 0, voxels = 0;
w.forEachEntity((e) => {
  if (!String(e.id).startsWith('tower.')) return;
  towers++;
  const fx = /fire|flame/i.test((e.components && e.components.sprite && e.components.sprite.model) || e.id);
  assert.ok(fx || !(e.components && e.components.sprite), 'sprite left on ' + e.id);
  if (e.components && e.components.voxel) voxels++;
});
assert.ok(towers >= 25 && voxels === towers - 5, 'tower entities (5 fire sprites, OB-167) ' + towers + ' voxel ' + voxels);
for (const id of ['tower.gondola', 'tower.pallet']) assert.ok(w.entity(id) && w.entity(id).components.voxel, id + ' is voxel');
for (const id of ['tower.burnerFire', 'tower.lampFlame', 'tower.keeperLampFlame', 'tower.stairLampFlame', 'tower.swordLampFlame']) assert.ok(w.entity(id) && w.entity(id).components.sprite, id + ' is an animated fire sprite (OB-167)');
console.log('towerNoSprites ok', towers, voxels);
