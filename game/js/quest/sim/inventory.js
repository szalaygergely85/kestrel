// game/js/quest/sim/inventory.js (US-091a1, architecture.md 37.16.4; the hand-slot shape is from
// HANDS-01b, 37.8a). The player's pack + two hand slots, stored as a plain JSON component on the player
// entity (`player.components.inventory`) so it round-trips through serialize/deserialize with no engine
// change (the vitals.js `components.health`/`components.mana` convention). Death respawn keeps it; `R`
// restarts keep the start state because main.js seeds it before `initialState = serialize(...)`.
//
// Rule 15 (this file, game/js/quest/sim/**): no Math.random, no trig, no wall clock. Every function is
// pure - no world, no events, no module state - and `hashInto` (the only function on the per-step replay
// path) allocates nothing.

import { hashIt } from './itemInst.js'; // import cycle (itemInst reads itemDisplayName): function-only use, safe

export const SLOTS = 24;

// -----------------------------------------------------------------------------------------------------------
// Component creation + load-time validation
// -----------------------------------------------------------------------------------------------------------

/**
 * Creates `player.components.inventory` only when it is missing (an existing component - a save/restart
 * round trip or a death respawn already has one - is left untouched, so a restart never resets the pack).
 * `start` is the demo start state (`{pack: [{id, n}], left, right}`, 37.8a): each pack entry fills the next
 * slot verbatim (no stacking - the author controls the counts; the demo pack is one fireball), then the two
 * hand slots.
 * @param {any} player plain entity data (`world.get('player').data`-shaped: `{components}`)
 * @param {{pack?: Array<{id: string, n: number}>, left?: string|null, right?: string|null}} start
 * @returns {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}}
 */
export function ensureInventory(player, start) {
  const c = player.components || (player.components = {});
  if (!c.inventory) {
    const slots = new Array(SLOTS);
    for (let i = 0; i < SLOTS; i++) slots[i] = { id: null, n: 0, it: null };
    const inv = {
      v: 2, // ITEM-02a: slots are {id, n, it}
      slots,
      left: start ? (start.left ?? null) : null,
      right: start ? (start.right ?? null) : null,
    };
    if (start && start.pack) {
      for (let i = 0; i < start.pack.length && i < SLOTS; i++) {
        slots[i].id = start.pack[i].id;
        slots[i].n = start.pack[i].n;
      }
    }
    c.inventory = inv;
  }
  return c.inventory;
}

export const EQUIP_SLOTS = ['head', 'body', 'cloak', 'hands', 'belt', 'legs', 'feet', 'main', 'off', 'ranged', 'quiver'];
export const EQUIP_TIERS = ['worn', 'sturdy', 'fine', 'tempered', 'warden']; // EQ-21: T4/T5

// D-097: an item def may carry `nameAfter: {flag, name}`; once world flag `flag` is true the UI shows `name` (Teal Crystal -> Aether Crystal).
let flagReader = null;
/** The game registers a reader (key => boolean) once; without one the base name is shown. */
export function setItemFlagReader(fn) { flagReader = typeof fn === 'function' ? fn : null; }
/** The one place item names are resolved for UI (toasts, inventory, pickup prompts). */
export function itemDisplayName(def) {
  if (!def) return '';
  const na = def.nameAfter;
  return na && flagReader && flagReader(na.flag) ? na.name : def.name;
}

/**
 * Validates every item def once at load (id/name/kind/stackMax/icon); throws naming the bad id. Called by
 * main.js at boot. This checks the fields the inventory code actually depends on (the designer's own
 * `ASSETS.items.validate(palette)` is a superset that also checks icon cells/colour keys and returns a list);
 * here the game fails fast instead of half-working later.
 * @param {Record<string, any>} defs
 */
export function validateItemDefs(defs) {
  const KINDS = { weapon: 1, spell: 1, tool: 1, food: 1, material: 1, pickup: 1, shield: 1, key: 1, upgrade: 1, currency: 1, gear: 1, ammo: 1, potion: 1 };
  for (const id in defs) {
    const d = defs[id];
    if (!d || d.id !== id) throw new Error(`[items] bad def "${id}": id mismatch`);
    if (typeof d.name !== 'string' || !d.name) throw new Error(`[items] bad def "${id}": name`);
    if (d.nameAfter !== undefined && (!d.nameAfter || typeof d.nameAfter.flag !== 'string' || typeof d.nameAfter.name !== 'string')) throw new Error(`[items] bad def "${id}": nameAfter`);
    if (!KINDS[d.kind]) throw new Error(`[items] bad def "${id}": kind "${d.kind}"`);
    if (typeof d.stackMax !== 'number' || !(d.stackMax >= 0)) throw new Error(`[items] bad def "${id}": stackMax`);
    if (!d.icon || !Array.isArray(d.icon.glyphs) || !Array.isArray(d.icon.fg) || d.icon.glyphs.length !== 3 || d.icon.fg.length !== 3) {
      throw new Error(`[items] bad def "${id}": icon`);
    }
    const q = d.equip; // EQ-01: { slot, tier, def, shell?, held? }
    if (q !== undefined) {
      if (!q || !EQUIP_SLOTS.includes(q.slot)) throw new Error(`[items] bad def "${id}": equip.slot "${q && q.slot}"`);
      if (!EQUIP_TIERS.includes(q.tier) && !d.gen) // ITEM-02a: gen.* defs have no tier
       throw new Error(`[items] bad def "${id}": equip.tier "${q.tier}"`);
      if (typeof q.def !== 'number' || !(q.def >= 0)) throw new Error(`[items] bad def "${id}": equip.def`);
    }
    if (d.kind === 'gear' && !q) throw new Error(`[items] bad def "${id}": gear needs equip`);
  }
}

// -----------------------------------------------------------------------------------------------------------
// Pack: add / remove / count
// -----------------------------------------------------------------------------------------------------------

/**
 * Adds up to `n` of `id` into the pack: stacks into existing slots first (in slot order, up to
 * `defs[id].stackMax`), then fills the first empty slot. Returns how many were actually added (0 when the
 * pack is full or the id is unknown / not stackable - `stackMax <= 0` items like the touch orbs are never
 * stored).
 * @param {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}} inv
 * @param {Record<string, any>} defs item defs (ASSETS.items.defs)
 * @param {string} id
 * @param {number} n
 * @returns {number}
 */
export function addItem(inv, defs, id, n) {
  if (!(n > 0)) return 0;
  const def = defs[id];
  if (!def || def.gen) return 0; // gen.* ids enter only through addInstance
  const stackMax = def.stackMax;
  if (!(stackMax > 0)) return 0;

  let remaining = n;
  for (let i = 0; i < SLOTS && remaining > 0; i++) {
    const s = inv.slots[i];
    if (s.id === id && s.n < stackMax && s.it == null) { // instances never stack
      const add = Math.min(stackMax - s.n, remaining);
      s.n += add;
      remaining -= add;
    }
  }
  for (let i = 0; i < SLOTS && remaining > 0; i++) {
    const s = inv.slots[i];
    if (s.id === null) {
      const add = Math.min(stackMax, remaining);
      s.id = id;
      s.n = add;
      s.it = null;
      remaining -= add;
    }
  }
  return n - remaining;
}

/**
 * Removes up to `n` of `id` from the pack (last slot first, so an earlier partial stack stays intact).
 * Returns how many were actually removed. When the item's total count reaches 0, a hand that still
 * referenced it is emptied (the "count 0 empties the hand" rule).
 * @param {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}} inv
 * @param {string} id
 * @param {number} n
 * @returns {number}
 */
export function removeItem(inv, id, n) {
  if (!(n > 0) || (typeof id === 'string' && id.startsWith('gen.'))) return 0; // instances leave via removeAt
  
  let remaining = n;
  for (let i = SLOTS - 1; i >= 0 && remaining > 0; i--) {
    const s = inv.slots[i];
    if (s.id === id && s.it == null) {
      const take = Math.min(s.n, remaining);
      s.n -= take;
      remaining -= take;
      if (s.n === 0) { s.id = null; s.it = null; }
    }
  }
  if (countOf(inv, id) === 0) {
    if (inv.left === id) inv.left = null;
    if (inv.right === id) inv.right = null;
  }
  return n - remaining;
}

/**
 * ITEM-02a: stores an item instance `{id, it}` (by reference) in the first empty slot. Returns the slot index, -1 when
 * the pack is full or the instance is unusable.
 */
export function addInstance(inv, defs, inst) {
  if (!inst || inst.it == null || !defs[inst.id]) return -1;
  for (let i = 0; i < SLOTS; i++) {
    const s = inv.slots[i];
    if (s.id === null) { s.id = inst.id; s.n = 1; s.it = inst.it; return i; }
  }
  return -1;
}

/** Empties slot `idx`, writing `{id, it}` into the caller's reused `out`; null when the slot is empty. */
export function removeAt(inv, idx, out) {
  const s = inv.slots[idx];
  if (!s || s.id === null) return null;
  out.id = s.id; out.it = s.it == null ? null : s.it;
  s.id = null; s.n = 0; s.it = null;
  return out;
}

/** Swaps the contents (id, n, it) of two pack slots (drag between cells). */
export function moveSlot(inv, a, b) {
  if (a === b) return;
  const x = inv.slots[a], y = inv.slots[b];
  const id = x.id, n = x.n, it = x.it == null ? null : x.it;
  x.id = y.id; x.n = y.n; x.it = y.it == null ? null : y.it;
  y.id = id; y.n = n; y.it = it;
}

/** Total count of `id` across every slot (a hand item is still counted - the hand only references it). */
export function countOf(inv, id) {
  let n = 0;
  for (let i = 0; i < SLOTS; i++) if (inv.slots[i].id === id) n += inv.slots[i].n;
  return n;
}

// -----------------------------------------------------------------------------------------------------------
// Hands
// -----------------------------------------------------------------------------------------------------------

/**
 * Assigns `id` (or null, to empty the hand) to `hand` ('left' | 'right'). Returns true on success.
 * `id` must already be in the pack (`countOf > 0`); the caller checks `defs[id].hand === true`
 * (this function has no defs, so it cannot). Putting an item in one hand empties the
 * other hand if it held the same id - one item is never in both hands.
 * @param {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}} inv
 * @param {'left'|'right'} hand
 * @param {string|null} id
 * @returns {boolean}
 */
export function assignHand(inv, hand, id) {
  if (hand !== 'left' && hand !== 'right') return false;
  if (id === null) { inv[hand] = null; return true; }
  if (countOf(inv, id) === 0) return false;
  inv[hand] = id;
  const other = hand === 'left' ? 'right' : 'left';
  if (inv[other] === id) inv[other] = null;
  return true;
}

/** Swaps the two hand slots in place. */
export function swapHands(inv) {
  const t = inv.left;
  inv.left = inv.right;
  inv.right = t;
}

// -----------------------------------------------------------------------------------------------------------
// Migration + replay hash
// -----------------------------------------------------------------------------------------------------------

/**
 * US-091a1 migration (37.8a): an old save whose `tower.sword.taken` flag is already set predates the
 * inventory component, so after `ensureInventory` seeds the demo pack the sword itself must be added back to
 * the pack and to the left hand. The caller checks the flag; this is the "pack has no sword" half.
 * @param {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}} inv
 * @param {Record<string, any>} defs
 * @returns {boolean} true when the sword was added
 */
export function migrateSword(inv, defs) {
  if (countOf(inv, 'sword') > 0) return false;
  if (inv.left === 'sword' || inv.right === 'sword') return false; // OB-079: a wielded sword has left the pack slots but is NOT missing - Continue used to duplicate it (hands sword/sword + a pack copy)
  if (addItem(inv, defs, 'sword', 1) === 0) return false;
  if (inv.left === null) inv.left = 'sword';
  else if (inv.right === null) inv.right = 'sword';
  return true;
}

// FNV-1a over an id's chars, one byte per char via the hasher's own `_byte` step (engine/core/hash.js - the
// only zero-allocation way to hash a string; there is no public `str` on the hasher and engine/ is off-limits
// to this story). A 0x00 terminator separates adjacent ids ("ab"+"c" !== "a"+"bc"); a null slot/hand id mixes
// one 0xff byte (ids are printable ASCII, so 0x00/0xff never appear inside one). charCodeAt + _byte only - no
// string join, no array, no allocation.
function hashIdInto(h, id) {
  if (id === null) { h._byte(0xff); return; }
  for (let i = 0; i < id.length; i++) h._byte(id.charCodeAt(i));
  h._byte(0x00);
}

/**
 * Mixes the inventory into the replay hasher `h` (a `createHasher()` instance): each slot's id chars then
 * its count, then the left and right hand ids. Deterministic and allocation-free.
 * @param {{slots: Array<{id: string|null, n: number}>, left: string|null, right: string|null}} inv
 * @param {{_byte: (b: number) => any, u32: (x: number) => any}} h
 */
export function hashInto(inv, h) {
  for (let i = 0; i < SLOTS; i++) {
    hashIdInto(h, inv.slots[i].id);
    h.u32(inv.slots[i].n);
    hashIt(h, inv.slots[i].it);
  }
  hashIdInto(h, inv.left);
  hashIdInto(h, inv.right);
}
