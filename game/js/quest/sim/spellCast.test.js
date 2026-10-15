// game/js/quest/sim/spellCast.test.js (SPELL-04). Headless Node ESM: tier tables, tier-aware fireball cast, key-tap, dispatcher, locked map.
import assert from 'node:assert/strict';
import { createTargetables } from './targetables.js';
import { createFireballSim } from './fireball.js';
import { FIREBALL_CFG, FIREBALL_TIER_CFG, refreshLocked } from '../spellConfig.js';
import { SPELL_DEFS, SPELL_IDS } from '../spellDefs.js';
import { createSpellDispatcher } from './spellCast.js';
import { createQuickbar } from './quickbar.js';

const world = (ents) => ({ state: {}, forEachEntity(fn) { ents.forEach(fn); }, raySegmentRay() { return false; } });
const events = { on() { return () => {}; }, emit() {} };
function rig(tier) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 90 }, components: { body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  const w = world([player]), m = { mp: 100 };
  const sim = createFireballSim(w, events, FIREBALL_CFG, createTargetables(w, events), { spendMana: (n) => (m.mp < n ? false : (m.mp -= n, true)), tier: () => tier });
  sim.setHand('right');
  return { player, m, sim, step: (down) => sim.step(player, down, 1, 0, 1, 0, 0) };
}
const EXP = { 1: [3, 2.0, 5, 3.0, 5, 10], 2: [4, 2.0, 7, 3.5, 5, 10], 3: [5, 2.0, 9, 4.0, 5, 9] }; // tap dmg, r, charged dmg, r, tap mp, charged mp
for (const t of [1, 2, 3]) {
  const [td, tr, cd, cr, tm, cm] = EXP[t];
  const a = rig(t); a.step(true); a.step(false);
  assert.equal(a.sim.slots.damage[0], td); assert.equal(a.sim.slots.radius[0], tr); assert.equal(a.m.mp, 100 - tm, `tier ${t} tap mana`);
  const b = rig(t); for (let i = 0; i < 36; i++) b.step(true); b.step(false);
  assert.equal(b.sim.slots.damage[0], cd); assert.equal(b.sim.slots.radius[0], cr); assert.equal(b.m.mp, 100 - cm, `tier ${t} charged mana`);
}
assert.equal(FIREBALL_TIER_CFG[1].tap, FIREBALL_CFG.tap); assert.equal(FIREBALL_TIER_CFG[1].charged, FIREBALL_CFG.charged); // AC1: tier 1 = today's tables

// key tap: queued, cast on next step, no charge, respects cooldown
{
  const a = rig(2);
  assert.equal(a.sim.requestTap(), 'cast'); assert.equal(a.sim.requestTap(), 'busy');
  a.step(false);
  assert.equal(a.sim.slots.alive[0], 1); assert.equal(a.sim.slots.damage[0], 4); assert.equal(a.m.mp, 95);
  assert.equal(a.sim.requestTap(), 'busy', 'cooldown');
}

// dispatcher: locked / notImplemented / dummy registration
{
  const tiers = { fireball: 1, freeze: 0, telekinesis: 2 };
  const d = createSpellDispatcher((id) => tiers[id] | 0);
  let n = 0; d.register('fireball', () => (n++, 'cast'));
  assert.equal(d.cast('spell.fireball', null), 'cast'); assert.equal(n, 1);
  assert.equal(d.cast('spell.telekinesis', null), 'notImplemented'); // learned, no sim yet
  d.register('freeze', () => 'cast'); assert.equal(d.cast('spell.freeze', null), 'locked');
  d.register('telekinesis', () => 'dummy'); assert.equal(d.cast('spell.telekinesis', null), 'dummy'); // one table entry = a new spell
  assert.equal(d.cast('sword', null), 'notImplemented');
}
// quickbar key routes spell.* to the dispatcher
{
  const defs = { 'spell.fireball': { kind: 'spell' } };
  const qb = createQuickbar(defs, 10, (id) => 'got:' + id);
  const pl = { components: { quickbar: [null, null, 'spell.fireball', null, null, null] } };
  assert.equal(qb.press(pl, 0), 'got:spell.fireball');
}
// locked = tier 0 for every spell.<id>
{
  const map = {}, tiers = {}; for (const id of SPELL_IDS) tiers[id] = 0;
  refreshLocked(map, tiers);
  for (const id of SPELL_IDS) assert.equal(map['spell.' + id], 1); assert.equal(map['potion.mp'], 1);
  tiers.freeze = 1; tiers.fireball = 1; refreshLocked(map, tiers);
  assert.equal(map['spell.freeze'], undefined); assert.equal(map['spell.fireball'], undefined); assert.equal(map['potion.mp'], undefined); assert.equal(map['spell.telekinesis'], 1);
}
assert.equal(SPELL_DEFS.fireball.tiers[1].chargedDmg, FIREBALL_TIER_CFG[2].charged.damage);
console.log('spellCast.test.js: all pass');
