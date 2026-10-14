// game/js/quest/sim/equipment.js (EQ-02, docs/equipment-epic-2026-10-10.md s1, architecture.md 38.41).
// `player.components.equipment` = {head, body, cloak, hands, belt, legs, feet, main, off, ranged, quiver, set}:
// item ids or null; `quiver` = {id, n} | null; `set` = 'melee' (sword + shield) | 'ranged' (bow, 2-handed).
// Plain JSON on the player entity, so it round-trips through serialize/deserialize (and the save) with no engine
// change - same convention as components.inventory. The pack (inventory.slots) holds everything not worn;
// inventory.left/right become DERIVED from this component by `syncHands`.
//
// Item def shape (EQ-01): `defs[id].equip = {slot, tier, def, shell?, held?}`.
// Rule 15 (game/js/quest/sim/**): no Math.random, no trig, no wall clock; the per-step functions allocate nothing.
import { SLOTS as PACK_SLOTS, addItem, removeItem, countOf } from './inventory.js';

export const EQUIP_SLOTS = Object.freeze(['head', 'body', 'cloak', 'hands', 'belt', 'legs', 'feet', 'main', 'off', 'ranged', 'quiver']);
export const DEF_PER_POINT = 0.03; // owner question 4: 3 % less damage per defence point
export const DEF_CAP = 0.6;        // ... capped at 60 %

/** Creates the component only when missing (a save round trip or respawn keeps the existing one). */
export function ensureEquipment(player) {
  const c = player.components || (player.components = {});
  if (!c.equipment) {
    const eq = { set: 'melee' };
    for (let i = 0; i < EQUIP_SLOTS.length; i++) eq[EQUIP_SLOTS[i]] = null;
    c.equipment = eq;
  }
  return c.equipment;
}

function slotOf(defs, id) {
  const d = defs[id];
  return d && d.equip && typeof d.equip.slot === 'string' ? d.equip.slot : null;
}

function packIndex(inv, id) {
  for (let i = 0; i < PACK_SLOTS; i++) if (inv.slots[i].id === id) return i;
  return -1;
}

/** True when `n` of `id` would fit into the pack right now. */
function packHasRoom(inv, defs, id, n) {
  const max = defs[id] ? defs[id].stackMax : 0;
  let room = 0;
  for (let i = 0; i < PACK_SLOTS; i++) {
    const s = inv.slots[i];
    if (s.id === null) room += max; else if (s.id === id) room += max - s.n;
  }
  return room >= n;
}

/**
 * Moves one piece (for the quiver: the pack's stack of arrows) from the pack to its slot. The previous piece goes
 * back to the pack. Refuses (returns false, nothing changes) when the item is not in the pack, has no `equip`, or
 * the displaced piece does not fit back (full pack).
 * @returns {boolean}
 */
export function equip(inv, eq, defs, id) {
  const slot = slotOf(defs, id);
  if (slot === null || slot === 'set' || !(slot in eq)) return false;
  const at = packIndex(inv, id);
  if (at < 0) return false;

  if (slot === 'quiver') {
    const q = eq.quiver;
    if (q && q.id === id) { // top up the same arrows
      const add = Math.min(inv.slots[at].n, defs[id].stackMax - q.n);
      if (add <= 0) return false;
      removeItem(inv, id, add);
      q.n += add;
      return true;
    }
    const take = inv.slots[at].n;
    removeItem(inv, id, take);
    if (q && addItem(inv, defs, q.id, q.n) < q.n) { // old ammo does not fit back: undo
      addItem(inv, defs, id, take);
      return false;
    }
    eq.quiver = { id, n: take };
    return true;
  }

  const old = eq[slot];
  if (old === id) return false;
  removeItem(inv, id, 1);
  if (old !== null && !isSpell(defs, old) && addItem(inv, defs, old, 1) === 0) { addItem(inv, defs, id, 1); return false; } // a spell lives in the spellbook, never the pack
  eq[slot] = id;
  return true;
}

function isSpell(defs, id) { return !!(defs[id] && defs[id].kind === 'spell'); }

/** SPELLBOOK-01: a learned spell goes into its hand slot straight from the book (the caller checked it is learned). A displaced pack item returns to the pack. */
export function equipSpell(inv, eq, defs, id) {
  const slot = slotOf(defs, id);
  if (slot === null || !(slot in eq) || eq[slot] === id) return false;
  const old = eq[slot];
  if (old !== null && !isSpell(defs, old) && addItem(inv, defs, old, 1) === 0) return false;
  eq[slot] = id;
  return true;
}

/** Moves the piece in `slot` back into the pack. Refuses on a full pack (nothing changes). */
export function unequip(inv, eq, defs, slot) {
  if (slot === 'set' || !(slot in eq)) return false;
  if (slot === 'quiver') {
    const q = eq.quiver;
    if (!q || !packHasRoom(inv, defs, q.id, q.n)) return false;
    addItem(inv, defs, q.id, q.n);
    eq.quiver = null;
    return true;
  }
  const id = eq[slot];
  if (id === null) return false;
  if (isSpell(defs, id)) { eq[slot] = null; return true; } // back into the spellbook, not the pack
  if (addItem(inv, defs, id, 1) === 0) return false;
  eq[slot] = null;
  return true;
}

/** Weapon-set swap: sword + shield <-> bow. Refuses to go ranged without a bow. Returns the new set. */
export function swapSet(eq) {
  if (eq.set === 'ranged') eq.set = 'melee';
  else if (eq.ranged !== null) eq.set = 'ranged';
  return eq.set;
}

/** Total defence points (sum of `equip.def` over the worn pieces; the quiver never counts). */
export function defenceOf(eq, defs) {
  let total = 0;
  for (let i = 0; i < EQUIP_SLOTS.length; i++) {
    const s = EQUIP_SLOTS[i];
    if (s === 'quiver') continue;
    const id = eq[s];
    if (id === null || id === undefined) continue;
    const d = defs[id];
    if (d && d.equip && d.equip.def > 0) total += d.equip.def;
  }
  return total;
}

/** Fraction of damage removed for `points` defence (+ `bonus`, a passive such as the night cloak): 0.03 per point, capped at 0.6. */
export function reductionOf(points, bonus = 0) {
  const f = points * DEF_PER_POINT + bonus;
  return f > DEF_CAP ? DEF_CAP : f < 0 ? 0 : f;
}

/** Damage taken after defence: round(n * (1 - reduction)), at least 1 for any positive hit. */
export function applyDefence(n, points, bonus = 0) {
  if (!(n > 0)) return 0;
  const r = Math.round(n * (1 - reductionOf(points, bonus)));
  return r < 1 ? 1 : r;
}

// ---- QL-19 passives: `defs[id].equip.passive` = {nightDef?: number, wetStone?: true}. Pure, no allocation. ----
export const NIGHT_FROM = 21, NIGHT_TO = 5, WET_SLOW_S = 0.4, WET_SLOW_MUL = 0.4;
/** Night = clock hour in [21, 24) or [0, 5). */
export function isNight(hour) { return hour >= NIGHT_FROM || hour < NIGHT_TO; }
/** Extra damage reduction (0.1 for a worn cloak) from the worn pieces' `nightDef` passive, only at night. Stays inside DEF_CAP via reductionOf. */
export function nightBonus(eq, defs, hour) {
  if (!isNight(hour)) return 0;
  let b = 0;
  for (let i = 0; i < EQUIP_SLOTS.length; i++) {
    const id = eq[EQUIP_SLOTS[i]];
    if (id === null || id === undefined || EQUIP_SLOTS[i] === 'quiver') continue;
    const d = defs[id], p = d && d.equip && d.equip.passive;
    if (p && p.nightDef > 0) b += p.nightDef;
  }
  return b;
}
/** True when a worn piece has the `wetStone` passive (River Boots): sure footing on wet stepping stones. */
export function hasSureFooting(eq, defs) {
  const id = eq.feet, d = id ? defs[id] : null;
  return !!(d && d.equip && d.equip.passive && d.equip.passive.wetStone);
}
/**
 * Wet stepping stone rule: a SPRINT onto a `wet` stone without sure footing gives a 0.4 s slow step (speed x0.4).
 * `st` = {t} persistent per player; call once per step with the step's facts. Returns the speed multiplier (1 = none).
 */
export function wetStoneStep(st, eq, defs, sprinting, onWetStone, wasOnWetStone, dt) {
  if (st.t > 0) st.t = st.t > dt ? st.t - dt : 0;
  if (sprinting && onWetStone && !wasOnWetStone && !hasSureFooting(eq, defs)) st.t = WET_SLOW_S;
  return st.t > 0 ? WET_SLOW_MUL : 1;
}

/** Derives inventory.left/right (OB-017): LEFT = main hand (main, or ranged with the bow set out), RIGHT = off hand (null with the bow). */
export function syncHands(inv, eq) {
  if (eq.set === 'ranged' && eq.ranged !== null) { inv.left = eq.ranged; inv.right = null; }
  else { inv.left = eq.main; inv.right = eq.off; }
}

/** A weapon entering the pack (sword taken in the tower) goes straight to an empty `main`. */
export function autoEquipMain(inv, eq, defs) {
  if (eq.main !== null) return;
  for (let i = 0; i < PACK_SLOTS; i++) {
    const id = inv.slots[i].id;
    if (id !== null && slotOf(defs, id) === 'main') { equip(inv, eq, defs, id); return; }
  }
}

/**
 * Old saves (no `equipment`): sword -> main, shield -> off if owned (pack or hand); everything else (the fireball
 * spell) stays in the pack. Idempotent: an existing component is left alone.
 */
export function migrateEquipment(player, defs) {
  const had = !!(player.components && player.components.equipment);
  const eq = ensureEquipment(player);
  const inv = player.components.inventory;
  if (had || !inv) return eq;
  for (const id of ['sword', 'shield']) {
    const owned = countOf(inv, id) > 0 || inv.left === id || inv.right === id;
    if (!owned) continue;
    if (countOf(inv, id) === 0) addItem(inv, defs, id, 1);
    equip(inv, eq, defs, id);
  }
  syncHands(inv, eq);
  return eq;
}

/** Per-step glue for main.js: auto-equip an empty main, then re-derive the hands. No allocation. */
export function stepEquipment(player, defs) {
  const c = player.components;
  if (!c || !c.inventory) return;
  const eq = ensureEquipment(player);
  autoEquipMain(c.inventory, eq, defs);
  syncHands(c.inventory, eq);
}

function hashId(h, id) {
  if (id === null || id === undefined) { h._byte(0xff); return; }
  for (let i = 0; i < id.length; i++) h._byte(id.charCodeAt(i));
  h._byte(0x00);
}

export function hashInto(eq, h) {
  for (let i = 0; i < EQUIP_SLOTS.length; i++) {
    const s = EQUIP_SLOTS[i];
    if (s === 'quiver') { hashId(h, eq.quiver ? eq.quiver.id : null); h.u32(eq.quiver ? eq.quiver.n : 0); }
    else hashId(h, eq[s]);
  }
  h.u32(eq.set === 'ranged' ? 1 : 0);
}
