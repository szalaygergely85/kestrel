// game/js/quest/sim/loot.js (US-091a2, docs/architecture.md 37.16.3). The boar loot: a seeded roll at death, the
// result held in the corpse (`corpseN`, one row of 3 counts per beast slot), a runtime `[E] Loot boar` interactable
// per boar (World.addInteractable, US-079b0) gated by the `loot.<id>` state flag, and the `beast.loot` behaviour that
// moves the counts into the player's pack.
// Rule 15 (this whole sim/** tree): no Math.random, no trig, no wall clock. Nothing here runs per step: the roll and
// the transfer happen on events (`beast:died`, an E press), so the per-step cost of this module is zero.
//
// Created on every 'world:loaded' AFTER createBeastSim (it reads `beasts.ids`/`slotOf`), and disposed before the
// next one (same "drop the old world's listeners first" precedent as beastSim/vitals/targeting - `events` lives for
// the whole page). The corpse counts are runtime-only: boars always come back alive on a load (37.16.2), so a stale
// `loot.*` flag from a save is deleted at create rather than restored.
import { addItem } from './inventory.js';
import { spawnDrop } from './pickups.js';
import { LOOT_PROMPT } from './lootConfig.js';

const ITEMS_PER_CORPSE = 3; // meat, hide, tusk (the `entries` columns)
const MAX_SLOTS = 16;       // beastSim MAX_BEASTS
const CORPSE_LIFT = 0.35;   // m above the death z: the interactable sits on the body, not in the ground (37.16.3)
const LOOT_RADIUS = 1.8;

/**
 * Module-level handle for the `beast.loot` behaviour (quest/index.js). main.js sets it on every load; `null` when
 * the world has no beasts. Same module-state precedent as hints.js/pickups.js.
 * @type {null | {lootBoar: (id: string) => boolean}}
 */
let lootApi = null;

/** main.js: point the `beast.loot` behaviour at this load's loot sim (or `null`). */
export function setLootApi(api) { lootApi = api; }

/**
 * `beast.loot` (registered by name in quest/index.js). `ctx.def.beastId` names the boar. Always returns `false`:
 * the record has no used flag, the `loot.<id>` state flag is the only gate (37.16.3).
 */
export function beastLoot(ctx) {
  if (lootApi && ctx && ctx.def && ctx.def.beastId) lootApi.lootBoar(ctx.def.beastId);
  return false;
}

/**
 * @param {import('../../../../engine/index.js').World} world
 * @param {{on: Function, emit: Function}} events
 * @param {{items: Record<string, any>, beasts?: any, kind?: string, rng: any, inventoryOf: () => any, table: any}} opts
 *   `items` = item defs (ASSETS.items.defs), `beasts` = the createBeastSim result, `rng` = this module's own
 *   stream (`createRng(((nav.seed ?? 1) ^ LOOT_SEED_SALT) >>> 0)`), `inventoryOf()` = the player's inventory
 *   component (or null), `table` = LOOT_TABLE.boar.
 *   For a chest table, pass kind:'chest' and no beast sim; world is unused in that branch.
 * @returns {null | ReturnType<typeof buildLoot> | ReturnType<typeof buildChestLoot>} `null` when there is no beast sim (boar branch).
 */
export function createLoot(world, events, opts) {
  if (opts.kind === 'chest') return buildChestLoot(events, opts);
  if (!opts.beasts) return null;
  return buildLoot(world, events, opts);
}

function buildLoot(world, events, { items, beasts, rng, inventoryOf, table }) {
  const count = beasts.count;
  const ids = beasts.ids;
  const entries = table.entries;
  if (entries.length !== ITEMS_PER_CORPSE) throw new Error(`createLoot: table needs ${ITEMS_PER_CORPSE} entries, got ${entries.length}`);

  // 37.16.3 "At create: delete any stale loot.* flag from a save". Create-time only (Object.keys allocates).
  for (const k of Object.keys(world.state)) if (k.startsWith('loot.')) delete world.state[k];

  /** @type {string[]} `loot.<id>` per slot, built once (no string concat on events). */
  const flagKey = ids.map((id) => 'loot.' + id);
  /** @type {any[]} the live interactable records, one per slot (x/y/z rewritten on death). */
  const recs = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = beasts.entities[i].transform;
    recs[i] = world.addInteractable({
      key: flagKey[i], name: 'beast.loot', x: t.x, y: t.y, z: t.z + CORPSE_LIFT, radius: LOOT_RADIUS,
      prompt: LOOT_PROMPT.boar, requires: flagKey[i], propId: ids[i], def: { beastId: ids[i] },
    });
  }

  const loot = {
    count,
    corpseN: new Int8Array(MAX_SLOTS * ITEMS_PER_CORPSE),
    // Preallocated emit payloads (toastView builds its string from them, on the event).
    _added: { id: '', n: 0 },
    _full: { id: '' },
  };

  function clearSlot(i) {
    delete world.state[flagKey[i]];
    const o = i * ITEMS_PER_CORPSE;
    for (let k = 0; k < ITEMS_PER_CORPSE; k++) loot.corpseN[o + k] = 0;
  }

  // Roll at death (37.16.3): always 5 draws in a fixed order, whatever the results.
  function onDied(p) {
    const i = beasts.slotOf(p.id);
    if (i < 0) return;
    const o = i * ITEMS_PER_CORPSE;
    for (let k = 0; k < ITEMS_PER_CORPSE; k++) {
      const e = entries[k];
      loot.corpseN[o + k] = rng.nextFloat() < e.chance ? e.n : 0;
    }
    const orbHit = rng.nextFloat() < table.orb.chance;
    const orbKind = table.orb.kinds[rng.int(table.orb.kinds.length)];
    if (orbHit) spawnDrop(world, orbKind, p.x, p.y, p.z);
    const rec = recs[i];
    rec.x = p.x; rec.y = p.y; rec.z = p.z + CORPSE_LIFT;
    world.state[flagKey[i]] = true;
  }

  function onSink(p) {
    const i = beasts.slotOf(p.id);
    if (i >= 0) clearSlot(i);
  }

  function onReset() {
    for (let i = 0; i < count; i++) clearSlot(i);
  }

  const offs = [
    events.on('beast:died', onDied),
    events.on('beast:sink', onSink),
    events.on('beasts:reset', onReset),
  ];

  /**
   * The E press (37.16.3): meat, hide, tusk in order into the pack; a toast per kind that moved; leftovers ->
   * "Pack full" and the corpse stays lootable; empty -> flag cleared + `despawnCorpse` (sink + dust).
   * @param {string} id beast id
   * @returns {boolean} true when the corpse was emptied
   */
  loot.lootBoar = function lootBoar(id) {
    const i = beasts.slotOf(id);
    if (i < 0 || !world.state[flagKey[i]]) return false;
    const inv = inventoryOf();
    const o = i * ITEMS_PER_CORPSE;
    let left = 0;
    for (let k = 0; k < ITEMS_PER_CORPSE; k++) {
      const n = loot.corpseN[o + k];
      if (n <= 0) continue;
      const itemId = entries[k].item;
      const added = inv ? addItem(inv, items, itemId, n) : 0;
      loot.corpseN[o + k] = n - added;
      left += n - added;
      if (added > 0) {
        loot._added.id = itemId; loot._added.n = added;
        events.emit('inventory:added', loot._added);
      }
    }
    if (left > 0) {
      loot._full.id = id;
      events.emit('inventory:full', loot._full);
      return false;
    }
    delete world.state[flagKey[i]];
    beasts.despawnCorpse(id);
    return true;
  };

  /** Corpse count of entry `k` (0 meat, 1 hide, 2 tusk) for beast `id`; -1 when untracked. Test/debug hook. */
  loot.countOf = function countOf(id, k) {
    const i = beasts.slotOf(id);
    return i < 0 ? -1 : loot.corpseN[i * ITEMS_PER_CORPSE + k];
  };

  /** Folds the corpse counts into a replay hash (no allocation). */
  loot.hashInto = function hashInto(h) {
    for (let j = 0; j < count * ITEMS_PER_CORPSE; j++) h.u32(loot.corpseN[j] & 0xff);
  };

  /** Drops the event listeners and this load's interactables (the next load re-adds its own). */
  loot.dispose = function dispose() {
    for (const off of offs) off();
    for (let i = 0; i < count; i++) world.removeInteractable(flagKey[i]);
  };

  return loot;
}

// S8-C-06: the chest branch shares createLoot and inventory transfer rather than a second loot service.
// A table contains fixed [{item,n}] plus one optional weighted pick [{item,n,weight}].
// Roll once at create with a chest-owned stream. claim is all-or-nothing so openedChests is sufficient to save it.
function buildChestLoot(events, {items, table, rng, inventoryOf}) {
  if (!table || !Array.isArray(table.fixed) || !Array.isArray(table.weighted)) throw new Error('chest loot: invalid table');
  const ids = [], counts = [], caps = [];
  let weight = 0, claimed = false;
  function validate(row, weighted) {
    const d = row && items[row.item];
    if (!d || !Number.isSafeInteger(row.n) || row.n < 1 || row.n > 2147483647
      || !Number.isSafeInteger(d.stackMax) || d.stackMax < 1 || d.pending === 'owner') throw new Error('chest loot: invalid or pending item');
    if (weighted && (!Number.isFinite(row.weight) || row.weight <= 0)) throw new Error('chest loot: invalid weight');
  }
  for (const row of table.fixed) validate(row, false);
  for (const row of table.weighted) { validate(row, true); weight += row.weight; }
  if (!Number.isFinite(weight) || !table.fixed.length && !table.weighted.length) throw new Error('chest loot: empty or overflowing table');
  function add(row) {
    let i = ids.indexOf(row.item);
    if (i < 0) { i = ids.length; ids.push(row.item); counts.push(0); caps.push(items[row.item].stackMax); }
    counts[i] += row.n;
    if (!Number.isSafeInteger(counts[i]) || counts[i] > 2147483647) throw new Error('chest loot: count overflow');
  }
  for (const row of table.fixed) add(row);
  if (table.weighted.length) {
    let pick = rng.nextFloat() * weight;
    for (let i = 0; i < table.weighted.length; i++) {
      const row = table.weighted[i]; pick -= row.weight;
      if (pick < 0 || i === table.weighted.length - 1) { add(row); break; }
    }
  }
  const added = {id:'', n:0};
  function fits(inv) {
    if (!inv) return false;
    let empty = 0, needed = 0;
    for (let j = 0; j < inv.slots.length; j++) if (!inv.slots[j].id) empty++;
    for (let i = 0; i < ids.length; i++) {
      let n = counts[i];
      for (let j = 0; j < inv.slots.length; j++) {
        const slot = inv.slots[j];
        if (slot.id === ids[i]) n -= Math.max(0, caps[i] - slot.n);
      }
      if (n > 0) needed += Math.ceil(n / caps[i]);
    }
    return needed <= empty;
  }
  return {
    canClaim() { return !claimed && fits(inventoryOf()); },
    claim() {
      const inv = inventoryOf();
      if (claimed || !fits(inv)) return false;
      for (let i = 0; i < ids.length; i++) addItem(inv, items, ids[i], counts[i]);
      claimed = true;
      return true;
    },
    // Caller commits its opened state BEFORE emitting, so an event-triggered save is consistent.
    emitAdded() {
      if (!claimed) return;
      for (let i = 0; i < ids.length; i++) { added.id = ids[i]; added.n = counts[i]; events.emit('inventory:added', added); }
    },
  };
}
