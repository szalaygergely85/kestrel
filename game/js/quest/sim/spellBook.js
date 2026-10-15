// EP-SPELLS (SPELL-01): the player's spell book. Pure sim. Tier of spell `id` (0 = not learned, 1..3) lives in
// world.state['spell.<id>'] (saved with WorldState, no schema bump). Migrates the older keys on creation and on every read:
//   magic.fireball === true  -> spell.fireball >= 1   (Burl's unlock; magic.fireball stays readable for features.js)
//   spells.fireball.level N  -> spell.fireball = N    (cryptscroll build)
// Learning the fireball also sets magic.fireball, so the existing cast gate keeps working.
import { SPELL_DEFS, SPELL_IDS, MAX_TIER } from '../spellDefs.js';

const KEY = (id) => 'spell.' + id;
const OLD_LEVEL = 'spells.fireball.level', OLD_FLAG = 'magic.fireball';

export function createSpellBook(state) {
  const st = state || {};
  const tiersObj = {};
  for (let i = 0; i < SPELL_IDS.length; i++) tiersObj[SPELL_IDS[i]] = 0;

  function migrate() {
    if (st[OLD_FLAG] === true || (st[OLD_LEVEL] | 0) > 0) {
      const cur = st[KEY('fireball')] | 0, old = Math.min(MAX_TIER, st[OLD_LEVEL] | 0);
      const want = Math.max(cur, old, 1);
      if (cur !== want) st[KEY('fireball')] = want;
    }
  }
  const has = (id) => Object.prototype.hasOwnProperty.call(SPELL_DEFS, id);
  function tier(id) {
    if (!has(id)) return 0;
    if (id === 'fireball') migrate();
    const t = st[KEY(id)] | 0;
    return t < 0 ? 0 : t > MAX_TIER ? MAX_TIER : t;
  }
  migrate();
  return {
    tier,
    /** Learn at tier 1; false when unknown or already learned. */
    learn(id) {
      if (!has(id) || tier(id) > 0) return false;
      st[KEY(id)] = 1;
      if (id === 'fireball') st[OLD_FLAG] = true;
      return true;
    },
    canRaise(id) { const t = tier(id); return t >= 1 && t < MAX_TIER; },
    /** +1 tier when learned and below max; returns the new tier or 0. */
    raise(id) { if (!this.canRaise(id)) return 0; return (st[KEY(id)] = tier(id) + 1); },
    /** Same object every call (0 alloc): spellId -> 0..3. */
    tiers() { for (let i = 0; i < SPELL_IDS.length; i++) tiersObj[SPELL_IDS[i]] = tier(SPELL_IDS[i]); return tiersObj; },
    /** Learned spell ids in tree order. */
    learned() { const o = []; for (let i = 0; i < SPELL_IDS.length; i++) if (tier(SPELL_IDS[i]) > 0) o.push(SPELL_IDS[i]); return o; },
    /** Damage multiplier of a spell at its current tier (fireball: D-114 table; others 1). */
    damageScale(id) { const d = has(id) ? SPELL_DEFS[id] : null; return d && d.damageScale ? d.damageScale[tier(id)] || 1 : 1; },
  };
}
