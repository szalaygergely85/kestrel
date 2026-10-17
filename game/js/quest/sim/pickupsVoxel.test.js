// OB-132: world_m1 has no sprite component left; every voxel pickup/lamp model exists in the registry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await import('../../../../design/palette.js');
await import('../../../../design/detail-pass.js');
await import('../../../../design/models/pickups_voxel.js');
const A = globalThis.ASSETS;
const w = JSON.parse(readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
assert.deepEqual(A.pickupsVoxel.validate(), []);
let n = 0;
for (const e of w.entities) {
  const c = e.components || {};
  if (c.sprite) { assert.ok((/^(rs|sg|trade)LampFlame/.test(e.id) && c.sprite.model === 'lampFlame') || (/^smokeFire\d+$/.test(e.id) && c.sprite.model === 'brazier'), 'sprite left on ' + e.id); continue; }   // OB-180/D-104: lamp flame billboards (fx); VISQA-15: smoke-plume braziers are sprites
  if (c.voxel && (c.questPickup || /^(packet|rsLamp|tradeLamp|sgLamp)/.test(e.id))) {
    assert.ok(A.voxelModels[c.voxel.model], e.id + ': missing model ' + c.voxel.model);
    assert.ok(A.voxelModels[c.voxel.model].voxel.animations[c.voxel.anim], e.id + ': missing anim ' + c.voxel.anim);
    n++;
  }
}
assert.ok(n >= 32, 'converted entities ' + n);
console.log('pickupsVoxel ok', n);
