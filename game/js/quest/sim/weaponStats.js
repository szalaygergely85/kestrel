// game/js/quest/sim/weaponStats.js (EQ-20). The multipliers of the EQUIPPED sword / bow / shield, read from
// `defs[id].equip.stats` (design/itemsWeapons.js). One shared mutable record (rule 15: no alloc per step);
// equipPlay.post() refreshes it every step, sword.js / equipPlay / the (future) stamina code read it.
export const weaponMods = { dmgMul: 1, bowDmgMul: 1, drawMul: 1, blockStamMul: 1 };

function stat(defs, id, key) {
  const d = id !== null && id !== undefined ? defs[id] : null;
  const s = d && d.equip && d.equip.stats;
  return s && typeof s[key] === 'number' ? s[key] : 1;
}

/** @param {any} eq player.components.equipment (or null) @param {Record<string, any>} defs item defs */
export function refreshWeaponMods(eq, defs) {
  const m = weaponMods;
  if (!eq) { m.dmgMul = 1; m.bowDmgMul = 1; m.drawMul = 1; m.blockStamMul = 1; return m; }
  m.dmgMul = stat(defs, eq.main, 'dmgMul');
  m.bowDmgMul = stat(defs, eq.ranged, 'dmgMul');
  m.drawMul = stat(defs, eq.ranged, 'drawMul');
  m.blockStamMul = stat(defs, eq.off, 'blockStamMul');
  return m;
}
