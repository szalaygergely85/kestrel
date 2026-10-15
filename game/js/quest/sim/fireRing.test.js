// SPELL-07: Fire Ring (burst on the player, player never hurt/knocked, tiers, cooldown, 0 alloc). Run: node game/js/quest/sim/fireRing.test.js
import assert from 'node:assert/strict';
import { createFireRingSim } from './fireRing.js';
import { createFireballSim } from './fireball.js';
import { createTargetables } from './targetables.js';
import { FIREBALL_CFG } from '../spellConfig.js';
import { SPELL_DEFS } from '../spellDefs.js';

const tgt = (id, x, y) => ({ id, transform: { x, y, z: 0 }, components: { targetable: { radius: 0.3, height: 1.6 }, health: { hp: 20, max: 20 }, body: { vx: 0, vy: 0, vz: 0, grounded: true } } });
function rig(tier, ents, mp = 100) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { body: { vx: 0, vy: 0, vz: 0, grounded: true } } };
  const all = [player, ...ents];
  const world = { state: {}, forEachEntity: (fn) => all.forEach(fn), raySegmentRay: () => false };
  const hits = [], bursts = [], bus = { on() { return () => {}; }, emit(n, p) { if (n === 'combat:hit') hits.push({ ...p }); else if (n === 'fireball:burst') bursts.push({ ...p }); } };
  const m = { mp }, spend = (n) => (m.mp < n ? false : (m.mp -= n, true));
  const fb = createFireballSim(world, bus, FIREBALL_CFG, createTargetables(world, bus), { spendMana: spend });
  const ring = createFireRingSim(fb, { spendMana: spend, tier: () => tier });
  return { player, ring, hits, bursts, m };
}
for (const t of [1, 2, 3]) {
  const row = SPELL_DEFS.fireRing.tiers[t - 1];
  const R = rig(t, [tgt('near', 1, 0), tgt('edge', row.r - 0.6, 0), tgt('far', row.r + 1, 0)]);
  assert.equal(R.ring.cast(R.player), 'cast');
  const ids = R.hits.map((h) => h.target);
  assert.deepEqual(ids, ['near', 'edge'].filter((x) => ids.includes(x)));
  assert.ok(ids.includes('near') && !ids.includes('far'), 'radius per tier: ' + ids);
  assert.ok(R.hits.find((h) => h.target === 'near').damage >= row.dmg - 1 && R.hits[0].knock <= row.knock);
  assert.ok(!R.hits.some((h) => h.target === 'player'), 'player is never hit');
  const b = R.player.components.body; assert.ok(b.vx === 0 && b.vy === 0 && b.vz === 0, 'player never knocked');
  assert.equal(R.bursts.length, 1); assert.equal(R.bursts[0].radius, row.r); assert.equal(R.m.mp, 100 - row.mana);
  assert.equal(R.ring.cast(R.player), 'busy'); assert.equal(R.m.mp, 100 - row.mana, 'cooldown refusal spends nothing');
  for (let i = 0; i < Math.round(row.cd * 60); i++) R.ring.step();
  assert.equal(R.ring.cast(R.player), 'cast', 'cd over');
}
{ const R = rig(1, [], 2); assert.equal(R.ring.cast(R.player), 'nomana'); assert.equal(R.ring.cooldown, 0); assert.equal(R.bursts.length, 0); }
{ // determinism
  const run = () => { const R = rig(3, [tgt('a', 1.5, 1), tgt('b', -2, 0)]); R.ring.cast(R.player); return JSON.stringify(R.hits); };
  assert.equal(run(), run());
}
console.log('fireRing.test.js OK');
