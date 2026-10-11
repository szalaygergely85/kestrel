// M4: cap1..5 are redcap questPickups with the pickupRedCap sprite; smoke1..3 are far smokeColumn billboards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const w = JSON.parse(readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const by = (id) => w.entities.find((e) => e.id === id);
for (let i = 1; i <= 5; i++) {
  const e = by('cap' + i);
  assert.ok(e, 'cap' + i);
  assert.deepEqual(e.components.questPickup, { item: 'redcap', n: 1 });
  assert.equal(e.components.sprite.model, 'pickupRedCap');
}
for (let i = 1; i <= 3; i++) {
  const e = by('smoke' + i);
  assert.ok(e && e.type === 'billboard' && e.model === 'smokeColumn' && e.unlit && e.fogModel === 'far' && e.detailRows === 14 && e.minCells.h === 6, 'smoke' + i);
}
console.log('capPickups.test OK (5 caps, 3 smoke)');
