// game/js/quest/sim/inventory.js (US-091a1, architecture.md 37.16.4; the hand-slot shape is from
// HANDS-01b, 37.8a). The player's pack + two hand slots, stored as a plain JSON component on the player
// entity (`player.components.inventory`) so it round-trips through serialize/deserialize with no engine
// change (the vitals.js `components.health`/`components.mana` convention). Death respawn keeps it; `R`
// restarts keep the start state because main.js seeds it before `initialState = serialize(...)`.
//
// Rule 15 (this file, game/js/quest/sim/**): no Math.random, no trig, no wall clock. Every function is
// pure - no world, no events, no module state - and `hashInto` (the only function on the per-step replay
// path) allocates nothing.

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
    for (let i = 0; i < SLOTS; i++) slots[i] = { id: null, n: 0 };
    const inv = {
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

/**
 * Validates every item def once at load (id/name/kind/stackMax/icon); throws naming the bad id. Called by
 * main.js at boot. This checks the fields the inventory code actually depends on (the designer's own
 * `ASSETS.items.validate(palette)` is a superset that also checks icon cells/colour keys and returns a list);
 * here the game fails fast instead of half-working later.
 * @param {Record<string, any>} defs
 */
export function validateItemDefs(defs) {
  const KINDS = { weapon: 1, spell: 1, tool: 1, food: 1, material: 1, pickup: 1, shield: 1, key: 1, upgrade: 1, currency: 1 };
  for (const id in defs) {
    const d = defs[id];
    if (!d || d.id !== id) throw new Error(`[items] bad def "${id}": id mismatch`);
    if (typeof d.name !== 'string' || !d.name) throw new Error(`[items] bad def "${id}": name`);
    if (!KINDS[d.kind]) throw new Error(`[items] bad def "${id}": kind "${d.kind}"`);
    if (typeof d.stackMax !== 'number' || !(d.stackMax >= 0)) throw new Error(`[items] bad def "${id}": stackMax`);
    if (!d.icon || !Array.isArray(d.icon.glyphs) || !Array.isArray(d.icon.fg) || d.icon.glyphs.length !== 3 || d.icon.fg.length !== 3) {
      throw new Error(`[items] bad def "${id}": icon`);
    }
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
  if (!def) return 0;
  const stackMax = def.stackMax;
  if (!(stackMax > 0)) return 0;

  let remaining = n;
  for (let i = 0; i < SLOTS && remaining > 0; i++) {
    const s = inv.slots[i];
    if (s.id === id && s.n < stackMax) {
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
  if (!(n > 0)) return 0;
  let remaining = n;
  for (let i = SLOTS - 1; i >= 0 && remaining > 0; i--) {
    const s = inv.slots[i];
    if (s.id === id) {
      const take = Math.min(s.n, remaining);
      s.n -= take;
      remaining -= take;
      if (s.n === 0) s.id = null;
    }
  }
  if (countOf(inv, id) === 0) {
    if (inv.left === id) inv.left = null;
    if (inv.right === id) inv.right = null;
  }
  return n - remaining;
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
  }
  hashIdInto(h, inv.left);
  hashIdInto(h, inv.right);
}
