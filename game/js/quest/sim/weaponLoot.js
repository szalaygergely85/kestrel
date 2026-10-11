// game/js/quest/sim/weaponLoot.js (EQ-20). Weapon drop rules, mirrors content/loot/weapons.json (a test keeps them equal).
// Pure + deterministic: the caller passes uniform draws u in [0,1). Wolves use their OWN stream (weaponRng) so the
// boar/chest loot streams are never shifted.
export const WEAPON_LOOT = {
  fineMinBand: 5, fineShare: 0.25,
  wolf: { chance: 0.03, items: ['off.shield', 'ranged.bow'] },
};

/** Tiny seeded stream (mulberry32); state is one uint32. */
export function weaponRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tier for a drop at `band` (1..9): `fine` only from band fineMinBand up (a fineShare chance), else `sturdy`. */
export function weaponTier(band, u, T = WEAPON_LOOT) {
  return band >= T.fineMinBand && u < T.fineShare ? 'fine' : 'sturdy';
}

/** Wolf kill: item id or null. u1 = drop chance, u2 = item pick, u3 = tier. */
export function rollWolfWeapon(items, band, u1, u2, u3, T = WEAPON_LOOT) {
  if (u1 >= T.wolf.chance) return null;
  const pick = T.wolf.items[Math.min(T.wolf.items.length - 1, Math.floor(u2 * T.wolf.items.length))];
  const id = 'gear.' + pick + '.' + weaponTier(band, u3, T);
  return items[id] ? id : null;
}

/** Chest weapon roll (table.weapon = { tier?, pick? }): fixed tier or `sturdy`; item from the 3 bases by u. */
export function rollChestWeapon(items, spec, u) {
  const picks = spec.pick || ['main.sword', 'ranged.bow', 'off.shield'];
  const id = 'gear.' + picks[Math.min(picks.length - 1, Math.floor(u * picks.length))] + '.' + (spec.tier || 'sturdy');
  return items[id] ? id : null;
}
