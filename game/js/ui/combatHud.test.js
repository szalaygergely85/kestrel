import assert from 'node:assert/strict';

// VISQA-22: terrainSees
{
  const { terrainSees } = await import('./combatHud.js');
  assert.equal(terrainSees(() => 0, 0, 0, 2, 20, 0, 1.4), true, 'flat ground');
  assert.equal(terrainSees((x) => (x > 8 && x < 12 ? 6 : 0), 0, 0, 2, 20, 0, 1.4), false, 'ridge between');
  assert.equal(terrainSees(null, 0, 0, 2, 20, 0, 1.4), true, 'no terrain');
}
