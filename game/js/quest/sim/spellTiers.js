// D-114 (amended): spell levels, table-driven. Pure sim (rule 15). Level of spell `id` lives in
// world.state['spells.<id>.level'] (saved with the world; absent = level 1, so old saves load as level 1).
// The Spell Scroll (item `scroll.spell`) raises ONE randomly chosen, unlocked spell that can still level up by 1.
// The roll is deterministic per save: hash(state['spells.seed'] || 1, state['spells.rolls']++). With no unlocked spell
// the scroll stays in the pack and is applied once the first spell is learned. New spells: add a row to SPELLS.
import { countOf, removeItem } from './inventory.js';

export const SCROLL_ID = 'scroll.spell';
/** id -> { maxLevel, damageScale[level] (index = level, [0] unused) } ; damage scale multiplies the spell's base damage.
 *  Fireball (ITEM-04 bands 25-35 -> 45-60 => x1.75): L1 x1.0, L2 x1.75, L3 x2.25. */
export const SPELLS = Object.freeze({
  fireball: Object.freeze({ name: 'Fireball', maxLevel: 3, damageScale: Object.freeze([1, 1, 1.75, 2.25]) }),
});
const KEY = (id) => 'spells.' + id + '.level';

export function spellLevel(state, id) {
  const sp = SPELLS[id]; if (!sp) return 0;
  const l = state ? state[KEY(id)] | 0 : 0;
  return l < 1 ? 1 : l > sp.maxLevel ? sp.maxLevel : l;
}
export const spellDamageScale = (state, id) => (SPELLS[id] ? SPELLS[id].damageScale[spellLevel(state, id)] : 1);
/** For PLAYER-LEVEL-01 (spell bonus input): { spellId: level } for unlocked spells. @param {(id:string)=>boolean} isUnlocked */
export function spellTiers(state, isUnlocked) {
  const t = {};
  for (const id of Object.keys(SPELLS)) if (isUnlocked(id)) t[id] = spellLevel(state, id);
  return t;
}

/** Learned spells that can still level up: [{ id, level, max }]. @param {(id:string)=>boolean} isUnlocked */
export function upgradableSpells(state, isUnlocked) {
  const out = [];
  for (const id of Object.keys(SPELLS)) {
    const l = spellLevel(state, id);
    if (isUnlocked(id) && l < SPELLS[id].maxLevel) out.push({ id, level: l, max: SPELLS[id].maxLevel });
  }
  return out;
}
/** Raises spell `id` by 1 (must be learned and below max). Returns the new level or 0. */
export function upgradeSpell(state, id, isUnlocked) {
  if (!SPELLS[id] || !isUnlocked(id) || spellLevel(state, id) >= SPELLS[id].maxLevel) return 0;
  return (state[KEY(id)] = spellLevel(state, id) + 1);
}
/** Reads one Spell Scroll on spell `id` (the player's choice): consumes the scroll only when the upgrade happens. Returns the new level or 0. */
export function useScroll(inv, state, id, isUnlocked) {
  if (!inv || !state || countOf(inv, SCROLL_ID) < 1) return 0;
  const l = upgradeSpell(state, id, isUnlocked);
  if (l) removeItem(inv, SCROLL_ID, 1);
  return l;
}
