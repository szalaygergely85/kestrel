// game/js/quest/sim/quickbar.js (EQ-12, docs/equipment-epic-2026-10-10.md s2b + owner D-068 potion button).
// `player.components.quickbar` = [id|null x4] (plain JSON on the player entity, saved with the world like `equipment`);
// `components.quickbarSeen` = {id:1} = default ids already offered (so a slot the player cleared is not refilled).
// Keys 1-4 act per item kind: sword -> main + melee set; bow -> ranged set; shield -> toggles `off`; potion/food -> use one.
// A sip (potion) takes SIP_STEPS but NEVER locks movement (owner rule): it only blocks a second drink meanwhile.
// Rule 15 (sim/**): no Math.random, no trig, no wall clock; nothing allocates per step.
import { equip, unequip } from './equipment.js';
import { countOf, removeItem } from './inventory.js';

export const QB_SLOTS = 4;
export const DEFAULT_BAR = Object.freeze(['sword', 'shield', 'bow', null]);
export const HP_PER_HEART = 10;
export const SIP_STEPS = 36;            // 0.6 s at 60 Hz
export const POTION_ID = 'potion.hp';

/** Does the player own `id` (pack, worn slot, quiver)? */
export function owns(player, id) {
  const c = player.components || {}, inv = c.inventory, eq = c.equipment;
  if (inv && countOf(inv, id) > 0) return true;
  if (!eq) return false;
  for (const k of Object.keys(eq)) { if (k === 'set') continue; const v = eq[k]; if (v === id || (v && v.id === id)) return true; }
  return false;
}

/** Creates the bar when missing: old saves / fresh games get [sword, shield, bow, null] filtered by what is owned. */
export function ensureQuickbar(player) {
  const c = player.components || (player.components = {});
  if (!Array.isArray(c.quickbar) || c.quickbar.length !== QB_SLOTS) {
    c.quickbar = [null, null, null, null];
    c.quickbarSeen = {};
    for (let i = 0; i < QB_SLOTS; i++) if (DEFAULT_BAR[i] && owns(player, DEFAULT_BAR[i])) { c.quickbar[i] = DEFAULT_BAR[i]; c.quickbarSeen[DEFAULT_BAR[i]] = 1; }
  }
  if (!c.quickbarSeen) c.quickbarSeen = {};
  return c.quickbar;
}

/** Offers a not-yet-seen default item (the sword found later in the story) its default slot, once, when it is empty. */
export function autoFill(player) {
  const qb = ensureQuickbar(player), seen = player.components.quickbarSeen;
  for (let i = 0; i < QB_SLOTS; i++) {
    const id = DEFAULT_BAR[i];
    if (id && !seen[id] && owns(player, id)) { seen[id] = 1; if (qb[i] === null && qb.indexOf(id) < 0) qb[i] = id; }
  }
}

/** Assigns `id` to slot 0..3 (one id per slot: it moves out of another slot). Gear cannot be assigned. Returns false = refused. */
export function assign(player, defs, slot, id) {
  const d = defs[id];
  if (!d || slot < 0 || slot >= QB_SLOTS || d.kind === 'gear' || d.kind === 'material' || d.kind === 'currency' || d.kind === 'ammo') return false;
  const qb = ensureQuickbar(player);
  const at = qb.indexOf(id);
  if (at >= 0) qb[at] = null;
  qb[slot] = id;
  player.components.quickbarSeen[id] = 1;
  return true;
}

export function clearSlot(player, slot) { const qb = ensureQuickbar(player); if (slot >= 0 && slot < QB_SLOTS) qb[slot] = null; }

/** Count shown on the bar: stack size for potions / food, 0 for single items (no number). */
export function countFor(player, defs, id) {
  const d = defs[id], inv = player.components && player.components.inventory;
  return d && inv && (d.kind === 'potion' || d.kind === 'food') ? countOf(inv, id) : 0;
}

export function createQuickbar(defs, hpPerHeart = HP_PER_HEART) {
  const st = { sipT: 0, lastId: null };
  /** Drinks one `id` (default the red draught). 'drank' | 'sip' (still sipping) | 'none' (no potions) | 'full' (not hurt) | 'refuse'. */
  function drink(player, id) {
    id = id || POTION_ID;
    const d = defs[id], c = player.components, inv = c && c.inventory, h = c && c.health;
    if (!d || !inv || !h || !d.use || !d.use.heal) return 'refuse';
    if (st.sipT > 0) return 'sip';
    if (countOf(inv, id) <= 0) return 'none';
    if (h.hp >= h.max) return 'full';
    h.hp = Math.min(h.max, h.hp + d.use.heal * (d.use.unit === 'hearts' ? hpPerHeart : 1));
    removeItem(inv, id, 1);
    st.sipT = Math.max(1, Math.round((d.use.time || 0.6) * 60)); st.lastId = id;
    return 'drank';
  }
  return {
    st, drink,
    get sipping() { return st.sipT > 0; },
    /** 1 -> 0 over the sip (for the HUD flash), 0 when idle */
    get sipFrac() { return st.sipT > 0 ? st.sipT / SIP_STEPS : 0; },
    step() { if (st.sipT > 0) st.sipT--; },
    /** Key 1-4 (slot 0..3). Returns 'empty' | 'main' | 'bow' | 'shield_on' | 'shield_off' | drink result | 'refuse'. */
    press(player, slot) {
      const qb = ensureQuickbar(player), id = qb[slot];
      if (!id || !defs[id]) return 'empty';
      const d = defs[id], c = player.components, inv = c.inventory, eq = c.equipment;
      if (d.kind === 'potion' || d.kind === 'food') return drink(player, id);
      if (!d.equip || !inv || !eq) return 'refuse';
      const s = d.equip.slot;
      if (s === 'main') { if (eq.main !== id && !equip(inv, eq, defs, id)) return 'refuse'; eq.set = 'melee'; return 'main'; }
      if (s === 'ranged') { if (eq.ranged !== id && !equip(inv, eq, defs, id)) return 'refuse'; eq.set = 'ranged'; return 'bow'; }
      if (s === 'off') {
        if (eq.off === id) return unequip(inv, eq, defs, 'off') ? 'shield_off' : 'refuse';
        if (!equip(inv, eq, defs, id)) return 'refuse';
        eq.set = 'melee'; return 'shield_on';
      }
      return 'refuse';
    },
  };
}
