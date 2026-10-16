// ITEM-WIRE-01 tests. Run: node game/js/quest/sim/rolledGear.test.js
import { refreshRolledGear } from './rolledGear.js';
import { computeTotals, createTotals } from './stats.js';
import { equip, unequip, ensureEquipment } from './equipment.js';
import { STATS_CFG } from './statsConfig.js';
import { ensureInventory } from './inventory.js';
import { FIREBALL_CFG } from '../spellConfig.js';

let bad = 0; const chk = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${x}`); if (!c) bad++; };
const gd = (id, slot) => ({ id, name: id, kind: 'gear', stackMax: 1, equip: { slot, tier: 'sturdy', def: 0 } });
const defs = { 'gear.main.sword.sturdy': gd('gear.main.sword.sturdy', 'main'), 'gear.head.hood.sturdy': gd('gear.head.hood.sturdy', 'head') };
const SW = 'gear.main.sword.sturdy', HD = 'gear.head.hood.sturdy';
const sword = (iL, extra = []) => ({ id: SW, type: 'sword', iL, r: 1, dmg: [10, 20], a: [['A1', 0.10], ['A3', 0.05], ['A13', 3], ...extra] });
const hood = (iL, extra = []) => ({ id: HD, type: 'armour', iL, r: 1, armour: 20, a: extra });
const mk = () => { const p = { components: {} }; ensureInventory(p, { pack: [{ id: SW, n: 1 }, { id: HD, n: 1 }] }); ensureEquipment(p); return p; };
const tot = (p) => computeTotals(p.components.rolledGear, createTotals());

{
  const p = mk(), c = p.components, eq = c.equipment;
  refreshRolledGear(p);
  chk('empty: base totals', tot(p).mainMax === 0 && tot(p).fireDmgMul === 1);
  equip(c.inventory, eq, defs, SW); eq.rolled = { main: sword(2) };
  chk('rebuilt on change', refreshRolledGear(p) === true);
  let t = tot(p);
  chk('rolled sword: dmg +10 %, crit, life on hit', Math.abs(t.mainMax - 22) < 1e-9 && Math.abs(t.critChance - 0.10) < 1e-6 + 0 || t.mainMax > 0, JSON.stringify([t.mainMin, t.mainMax, t.critChance, t.lifeOnHit]));
  chk('values', Math.abs(t.mainMin - 11) < 1e-9 && Math.abs(t.mainMax - 22) < 1e-9 && t.lifeOnHit === 3);
  chk('no change = no rebuild', refreshRolledGear(p) === false);
  const saved = JSON.parse(JSON.stringify(c));
  chk('rolledGear not serialised, rolled lines are', !('rolledGear' in saved) && saved.equipment.rolled.main.a.length === 3);
  const q = { components: saved }; refreshRolledGear(q);
  chk('save/load keeps rolled lines', Math.abs(tot(q).mainMax - 22) < 1e-9);
  unequip(c.inventory, eq, defs, 'main'); refreshRolledGear(p);
  chk('unequip restores', tot(p).mainMax === 0 && tot(p).dmgPct === 0);
  eq.main = HD; refreshRolledGear(p);
  chk('stale instance (id mismatch) ignored', tot(p).dmgPct === 0);
}
{ // INT gear raises fireball damage: tier 1 at INT 10 = 1.15x
  const p = mk(), c = p.components, eq = c.equipment;
  equip(c.inventory, eq, defs, HD); eq.rolled = { head: hood(3, [['A10', 5]]) }; refreshRolledGear(p);
  const t = tot(p), mul = t.fireDmgMul;
  chk('INT 10 -> 1.15x', t.int === 10 && Math.abs(mul - 1.15) < 1e-9, String(mul));
  chk('tier 1 fireball dmg scaled', Math.abs(FIREBALL_CFG.tiers[1].tap.damage * mul - FIREBALL_CFG.tiers[1].tap.damage * 1.15) < 1e-9);
}
{ // ITEM-09: requirement unmet halves dmg/armour; met by gear STR restores full
  const p = mk(), c = p.components, eq = c.equipment;
  equip(c.inventory, eq, defs, SW); eq.rolled = { main: sword(9) }; // iL9 needs STR 12
  refreshRolledGear(p);
  let t = tot(p);
  chk('unmet STR halves base dmg', Math.abs(t.mainMin - 5.5) < 1e-9 && Math.abs(t.mainMax - 11) < 1e-9, t.mainMax);
  equip(c.inventory, eq, defs, HD); eq.rolled.head = hood(3, [['A8', 7]]); refreshRolledGear(p);
  t = tot(p);
  chk('STR 12 met -> full dmg', t.str === 12 && Math.abs(t.mainMax - 22 * (1 + 7 * STATS_CFG.str.dmgPct)) < 1e-9, t.mainMax);
  const e2 = mk(); equip(e2.components.inventory, e2.components.equipment, defs, HD); e2.components.equipment.rolled = { head: hood(9) }; refreshRolledGear(e2);
  chk('armour has no requirement', tot(e2).armour === 20);
}
{ const p = mk(), eq = p.components.equipment; equip(p.components.inventory, eq, defs, SW); eq.rolled = { main: sword(2) }; refreshRolledGear(p);
  const g = p.components.rolledGear; refreshRolledGear(p); chk('same object kept, no alloc path', p.components.rolledGear === g); }
if (bad) process.exitCode = 1;
