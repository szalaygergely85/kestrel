// game/js/quest/sim/spellbook.js (SPELLBOOK-01, owner D-099 / OB-169): spells are NOT pack items. The player's
// `components.spellbook = { learned: { id: tier } }` lists the learned spells; a learned spell is put into the off hand
// (equipment.off) straight from the book, never through the pack. Saved with the player (plain component data).
import { SLOTS } from './inventory.js';
import { equipSpell } from './equipment.js';

export function ensureSpellbook(player) {
  const c = player.components || (player.components = {});
  const b = c.spellbook || (c.spellbook = { learned: {} });
  if (!b.learned || typeof b.learned !== 'object' || Array.isArray(b.learned)) b.learned = {}; // repair a missing / invalid map (hand-edited or corrupt save)
  return b;
}
export function isLearned(player, id) { const b = player.components && player.components.spellbook; return !!(b && b.learned && b.learned[id]); }
/** Learned spell ids in learn order. */
export function learnedIds(player) { const b = player.components && player.components.spellbook; return b && b.learned ? Object.keys(b.learned) : []; }
export function tierOf(player, id) { const b = player.components && player.components.spellbook; return b && b.learned && b.learned[id] || 0; }
export function learnSpell(player, id, tier = 1) { const b = ensureSpellbook(player); if (!b.learned[id] || b.learned[id] < tier) b.learned[id] = tier; return b; }

/**
 * Old saves: any spell item sitting in the pack moves into the spellbook and the pack slot is freed (never dropped).
 * Idempotent. Returns the number of pack slots freed.
 */
export function migrateSpellbook(player, defs) {
  const inv = player.components && player.components.inventory;
  ensureSpellbook(player);
  let n = 0;
  if (!inv) return n;
  for (let i = 0; i < SLOTS; i++) {
    const s = inv.slots[i], d = s.id && defs[s.id];
    if (d && d.kind === 'spell') { learnSpell(player, s.id, 1); s.id = null; s.n = 0; s.it = null; n++; }
  }
  return n;
}

/** Learn `id` (the Burl beat / magic.unlocked) and put it in a free off hand (RMB), as the unlock always did. */
export function learnAndEquip(player, defs, id, tier = 1) {
  learnSpell(player, id, tier);
  const c = player.components;
  if (c.inventory && c.equipment && c.equipment.off === null && c.equipment.set !== 'ranged') equipSpell(c.inventory, c.equipment, defs, id);
}

/** Boot glue (main.js): migrate old saves, then learn fireball when magic is already on. */
export function syncSpellbook(player, defs, id, unlocked) {
  migrateSpellbook(player, defs);
  if (unlocked && !isLearned(player, id)) learnAndEquip(player, defs, id);
}
