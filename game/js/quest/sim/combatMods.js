// game/js/quest/sim/combatMods.js (ITEM-04, replaces weaponStats.js). One shared mutable record of what the player's
// gear does in combat, filled from the ITEM-02b stats cache (computeTotals) by equipPlay.post() every step (int compare
// when nothing changed). sword / arrows / fireball / vitals read it; `active` 0 = no gear wired (unit tests): old flat numbers.
// Rule 15: seeded rng (createStatsRng), no Math.random, primitives only (0 alloc per roll).
import { refreshTotals } from './itemInst.js';
import { createStatsRng } from './stats.js';
import { ITEM_BASES } from './itemGen.js';

const FIST = [3, 5]; // unarmed / unique-without-dmg fallback, before attribute %
export const combatMods = {
  active: 0, mainMin: 0, mainMax: 0, bowMin: 0, bowMax: 0, critChance: 0.05, critMult: 1.5, lifeOnHit: 0,
  speedRate: 0,   // melee swing recover steps gained (+) / lost (-) per step: (1+atkSpeed)/swingMul - 1
  reachAdd: 0,    // m, spear
  drawMul: 1, blockStamMul: 1, fireMul: 1, armour: 0, hp: 100, mana: 100, moveSpeed: 0,
};
export const hitOut = { dmg: 0, crit: 0, life: 0 };
let rng = createStatsRng(0xC0FFEE);
/** Re-seed the combat roll stream (new game / tests). */
export function seedCombat(seed) { rng = createStatsRng(seed >>> 0); }

/** @param {any} cache createStatsCache() @param {any} eq player.components.equipment (or null) @param {Record<string,any>} defs */
export function refreshCombat(cache, eq, defs) {
  const m = combatMods;
  if (!eq) { m.active = 0; m.speedRate = 0; m.reachAdd = 0; m.drawMul = 1; m.blockStamMul = 1; m.armour = 0; m.lifeOnHit = 0; return m; }
  const t = refreshTotals(cache, eq, defs);
  const b = cache.viewEq.main ? ITEM_BASES[cache.viewEq.main.type] : null;
  m.active = 1;
  m.mainMin = t.mainMax > 0 ? t.mainMin : FIST[0] * (1 + t.dmgPct); m.mainMax = t.mainMax > 0 ? t.mainMax : FIST[1] * (1 + t.dmgPct);
  m.bowMin = t.bowMax > 0 ? t.bowMin : FIST[0] * (1 + t.dmgPct); m.bowMax = t.bowMax > 0 ? t.bowMax : FIST[1] * (1 + t.dmgPct); // no instance numbers -> same fist fallback
  m.critChance = t.critChance; m.critMult = t.critMult + (b && b.critDmg ? b.critDmg : 0); m.lifeOnHit = t.lifeOnHit;
  m.speedRate = (1 + t.atkSpeed) / (b && b.swingMul ? b.swingMul : 1) - 1;
  m.reachAdd = b && b.reach ? b.reach : 0;
  m.drawMul = 1 + t.drawSpeed; m.blockStamMul = 1 - t.blockPct; m.fireMul = t.fireDmgMul;
  m.armour = t.armour; m.hp = t.hp; m.mana = t.mana; m.moveSpeed = t.moveSpeed;
  return m;
}

/** Melee roll into hitOut; `mul` = 1 light, 3 heavy. Bow roll (ranged) is the pre-draw-factor damage. */
export function rollMelee(mul) { return roll(combatMods.mainMin, combatMods.mainMax, mul); }
export function rollBow() { return roll(combatMods.bowMin, combatMods.bowMax, 1); }
function roll(lo, hi, mul) {
  const u1 = rng(), u2 = rng(), m = combatMods;
  let d = (lo + (hi - lo) * u1) * mul;
  const crit = u2 < m.critChance;
  if (crit) d *= m.critMult;
  hitOut.dmg = d; hitOut.crit = crit ? 1 : 0; hitOut.life = m.lifeOnHit;
  return hitOut;
}
/** Uniform [lo,hi) from the combat stream (fireball). */
export function rollRange(lo, hi) { return lo + (hi - lo) * rng(); }
