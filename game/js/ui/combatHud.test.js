import assert from 'node:assert/strict';

// VISQA-22: terrainSees
{
  const { terrainSees } = await import('./combatHud.js');
  assert.equal(terrainSees(() => 0, 0, 0, 2, 20, 0, 1.4), true, 'flat ground');
  assert.equal(terrainSees((x) => (x > 8 && x < 12 ? 6 : 0), 0, 0, 2, 20, 0, 1.4), false, 'ridge between');
  assert.equal(terrainSees(null, 0, 0, 2, 20, 0, 1.4), true, 'no terrain');
}

// GOB-INVIS: an undrawn beast (pool did not queue it) gets no bar; a drawn one does
{
  const { fillBeastRecord } = await import('./combatHud.js');
  const { createEnemyBars } = await import('./enemyBar.js');
  const mk = () => ({ ids: ['g1'], kindIdx: [0], homeX: [0], homeY: [0], hurtT: [0], state: [0], dormant: [0],
    entities: [{ transform: { x: 3, y: 0, z: 0 }, components: { health: { hp: 5, max: 5 }, brain: { level: 4 } } }] });
  const sim = mk(), e = sim.entities[0], rec = {};
  const run = (drawn) => { const bars = createEnemyBars({}); return bars.select(1, (i, r) => fillBeastRecord(sim, i, r, 0, 0, 0, null, drawn), 0, 1); };
  assert.equal(run(null), 1, 'no host predicate: bar');
  assert.equal(run((x) => x === e), 1, 'drawn goblin: bar');
  assert.equal(run(() => false), 0, 'dropped by pool cap / view.hidden / unknown model: no bar');
}
