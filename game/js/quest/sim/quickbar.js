// game/js/quest/sim/quickbar.js (EQ-12, docs/equipment-epic-2026-10-10.md s2b + owner D-068 potion button; QB-6 owner redesign 2026-10-11).
// `player.components.quickbar` = [id|null x6] (plain JSON on the player entity, saved with the world like `equipment`):
//   slot 0 = LMB (what the left mouse button uses: sword, or the bow with the ranged set out), slot 1 = RMB (shield / off hand),
//   slots 2..5 = keys 1..4 (potions, food, tools; a weapon there is swapped into LMB when the key is pressed).
// The two HAND slots ARE the hands: they are derived from `components.equipment` on every sync (assign equips, clear unequips),
// so Q (weapon-set swap) keeps working and the bar can never disagree with what the player holds.
// `components.quickbarSeen` = {id:1} = default ids already offered (so a hand the player cleared is not refilled).
// Keys act per item kind: sword -> main + melee set; bow -> ranged set; shield -> toggles `off`; potion/food -> use one.
// A sip (potion) takes SIP_STEPS but NEVER locks movement (owner rule): it only blocks a second drink meanwhile.
// Rule 15 (sim/**): no Math.random, no trig, no wall clock; nothing allocates per step.
import { equip, unequip } from './equipment.js';
import { countOf, removeItem } from './inventory.js';

export const QB_SLOTS = 6, HAND_SLOTS = 2, KEY_SLOTS = 4, LMB = 0, RMB = 1;
export const DEFAULT_HANDS = Object.freeze(['sword', 'shield']); // offered once, when owned (slot 0 / 1)
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

/** equip slot name of an item ('main' | 'off' | 'ranged' | ...) or null; without defs only the two story items are known. */
function equipSlotOf(defs, id) {
  if (defs) { const d = defs[id]; return d && d.equip ? d.equip.slot : null; }
  return id === 'sword' ? 'main' : id === 'shield' ? 'off' : null;
}

/** Re-derives the two hand slots from the equipment component (no allocation). */
export function syncHandSlots(player) {
  const c = player.components, qb = c && c.quickbar, eq = c && c.equipment;
  if (!qb || qb.length !== QB_SLOTS) return;
  if (!eq) { qb[LMB] = null; qb[RMB] = null; return; }
  qb[LMB] = (eq.set === 'ranged' && eq.ranged ? eq.ranged : eq.main) || null;
  qb[RMB] = eq.off || null;
}

/**
 * Creates the bar when missing and migrates the old 4-slot shape (weapons move to LMB / RMB = they already are the worn main /
 * off hand; a bow keeps its digit; everything else keeps its digit). `defs` optional (without: sword / shield by id).
 */
export function ensureQuickbar(player, defs) {
  const c = player.components || (player.components = {});
  if (!Array.isArray(c.quickbar) || (c.quickbar.length !== QB_SLOTS && c.quickbar.length !== 4)) {
    c.quickbar = [null, null, null, null, null, null];
    c.quickbarSeen = {};
    for (const id of DEFAULT_HANDS) if (owns(player, id)) c.quickbarSeen[id] = 1;
  } else if (c.quickbar.length === 4) {
    const old = c.quickbar, eq = c.equipment, inv = c.inventory;
    c.quickbar = [null, null, null, null, null, null];
    if (!c.quickbarSeen) c.quickbarSeen = {};
    for (let i = 0; i < 4; i++) {
      const id = old[i]; if (!id) continue;
      const k = equipSlotOf(defs, id);
      if (k === 'main' || k === 'off') { // becomes a hand: make sure it is worn (a sword that sat only in the pack)
        if (defs && eq && inv && eq[k] === null) equip(inv, eq, defs, id);
        c.quickbarSeen[id] = 1;
      } else c.quickbar[i + HAND_SLOTS] = id;
    }
  }
  if (!c.quickbarSeen) c.quickbarSeen = {};
  syncHandSlots(player);
  return c.quickbar;
}

/** Offers a not-yet-seen default hand item once. OB-128: only the story sword is worn when its hand is empty (as autoEquipMain does); the shield (off hand) is NEVER auto-worn - the player equips it. */
export function autoFill(player, defs) {
  const qb = ensureQuickbar(player, defs), c = player.components, seen = c.quickbarSeen;
  for (let i = 0; i < DEFAULT_HANDS.length; i++) {
    const id = DEFAULT_HANDS[i];
    if (seen[id] || !owns(player, id)) continue;
    seen[id] = 1;
    if (id === 'sword' && defs && qb[i] === null && c.inventory && c.equipment) { equip(c.inventory, c.equipment, defs, id); syncHandSlots(player); }
  }
}

const NOT_BAR_KINDS = { gear: 1, material: 1, currency: 1, ammo: 1 };

/**
 * Assigns `id` to slot 0..5. Hand slots equip: LMB takes a main-hand item (melee set) or a bow (ranged set), RMB an off-hand
 * item; anything else is refused. Key slots 2..5 take any usable item (one id per key slot: it moves out of another key slot).
 * Gear / materials cannot be assigned. Returns false = refused (nothing changes).
 */
export function assign(player, defs, slot, id) {
  const d = defs[id];
  if (!d || slot < 0 || slot >= QB_SLOTS || NOT_BAR_KINDS[d.kind]) return false;
  const qb = ensureQuickbar(player, defs), c = player.components;
  if (slot < HAND_SLOTS) {
    const es = d.equip && d.equip.slot, inv = c.inventory, eq = c.equipment;
    if (!inv || !eq || !(slot === LMB ? (es === 'main' || es === 'ranged') : es === 'off')) return false;
    if (eq[es] !== id && !equip(inv, eq, defs, id)) return false;
    if (es === 'main') eq.set = 'melee'; else if (es === 'ranged') eq.set = 'ranged';
    for (let i = HAND_SLOTS; i < QB_SLOTS; i++) if (qb[i] === id) qb[i] = null;
    c.quickbarSeen[id] = 1;
    syncHandSlots(player);
    return true;
  }
  const at = qb.indexOf(id, HAND_SLOTS);
  if (at >= 0) qb[at] = null;
  qb[slot] = id;
  c.quickbarSeen[id] = 1;
  return true;
}

/** Empties a slot. A hand slot unequips (back into the pack); refused (false) when the pack is full. */
export function clearSlot(player, slot, defs) {
  const qb = ensureQuickbar(player, defs);
  if (slot < 0 || slot >= QB_SLOTS) return false;
  if (slot >= HAND_SLOTS) { qb[slot] = null; return true; }
  const c = player.components, eq = c.equipment, inv = c.inventory;
  if (!eq || !inv || !qb[slot]) return false;
  const es = slot === RMB ? 'off' : (eq.set === 'ranged' && eq.ranged ? 'ranged' : 'main');
  if (!defs || !unequip(inv, eq, defs, es)) return false;
  c.quickbarSeen[qb[slot]] = 1; // a cleared hand is not refilled
  syncHandSlots(player);
  return true;
}

/** Count shown on the bar: stack size for potions / food, 0 for single items (no number). */
export function countFor(player, defs, id) {
  const d = defs[id], inv = player.components && player.components.inventory;
  return d && inv && (d.kind === 'potion' || d.kind === 'food') ? countOf(inv, id) : 0;
}

export function createQuickbar(defs, hpPerHeart = HP_PER_HEART, spellCast = null) { // spellCast(itemId, player) = SPELL-04 dispatcher cast
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
    /** Key 1-4 (`key` 0..3 = bar slot key + 2). Returns 'empty' | 'main' | 'bow' | 'shield_on' | 'shield_off' | drink result | 'refuse'. */
    press(player, key) {
      const qb = ensureQuickbar(player, defs), id = key >= 0 && key < KEY_SLOTS ? qb[key + HAND_SLOTS] : null;
      if (!id || !defs[id]) return 'empty';
      const d = defs[id], c = player.components, inv = c.inventory, eq = c.equipment;
      if (spellCast && id.startsWith('spell.')) return spellCast(id, player); // SPELL-04: key tap casts (no charge)
      if (d.kind === 'potion' || d.kind === 'food') return drink(player, id);
      if (!d.equip || !inv || !eq) return 'refuse';
      const s = d.equip.slot;
      let res = 'refuse';
      if (s === 'main') { if (eq.main === id || equip(inv, eq, defs, id)) { eq.set = 'melee'; res = 'main'; } }
      else if (s === 'ranged') { if (eq.ranged === id || equip(inv, eq, defs, id)) { eq.set = 'ranged'; res = 'bow'; } }
      else if (s === 'off') {
        if (eq.off === id) res = unequip(inv, eq, defs, 'off') ? 'shield_off' : 'refuse';
        else if (equip(inv, eq, defs, id)) { eq.set = 'melee'; res = 'shield_on'; }
      }
      syncHandSlots(player);
      return res;
    },
  };
}
