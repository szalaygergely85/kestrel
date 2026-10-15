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
import { setItemPickupSink, PICKUP_AMOUNT } from './pickups.js';
import { BAND_TABLE } from './band.js';
import { LOOT_PROMPT, LOOT_TABLE, LOOT_TIERS, LOOT_SLOTS } from './lootConfig.js';
import { rollWolfWeapon, rollGoblinWeapon, rollChestWeapon, weaponRng } from './weaponLoot.js'; // EQ-20

// EQ-10: 0..4 rolled entries per corpse (table.fixed + the `give` rolls). Gear is a world pickup, never a column.
const ITEMS_PER_CORPSE = 4;
const MAX_SLOTS = 320;      // beastSim MAX_BEASTS (keep equal)
const CORPSE_LIFT = 0.35;   // m above the death z: the interactable sits on the body, not in the ground (37.16.3)
const LOOT_RADIUS = 1.8;

const gearCache = new WeakMap();
/** Gear item id for (slot, tier): the def with `equip.slot/tier` (one base per slot today). Cached per defs object. */
export function gearIdFor(items, slot, tier) {
  let m = gearCache.get(items);
  if (!m) {
    m = new Map();
    for (const id of Object.keys(items)) {
      const e = items[id].equip;
      if (items[id].kind === 'gear' && e && !items[id].unique) m.set(e.slot + '|' + e.tier, id);
    }
    gearCache.set(items, m);
  }
  return m.get(slot + '|' + tier) || null;
}

/** Tier from a uniform draw `b` (cumulative weights, document order), slot from `c` (uniform). Returns the gear id. */
export function rollGear(items, b, c, tiers = LOOT_TIERS, slots = LOOT_SLOTS, forceTier = null) {
  let tier = forceTier;
  if (!tier) {
    const names = Object.keys(tiers);
    let acc = 0;
    tier = names[names.length - 1];
    for (const t of names) { acc += tiers[t]; if (b < acc) { tier = t; break; } }
  }
  const slot = slots[Math.min(slots.length - 1, Math.floor(c * slots.length))];
  return gearIdFor(items, slot, tier);
}

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

function buildLoot(world, events, { items, beasts, rng, inventoryOf, table, band, goblinTable = LOOT_TABLE.goblin }) {
  const count = beasts.count;
  const ids = beasts.ids;
  for (const t of [table, goblinTable]) {
    if (t.fixed.length + t.rolls.filter((r) => r.give).length > ITEMS_PER_CORPSE) throw new Error(`createLoot: table has more than ${ITEMS_PER_CORPSE} corpse entries`);
  }
  // GOB-05: the table is chosen per slot by sim.group (2 = goblin); every other group keeps the boar table (bit-identical).
  const isGoblin = (i) => !!(beasts.group && beasts.group[i] === 2);
  const tableFor = (i) => (isGoblin(i) ? goblinTable : table);

  // 37.16.3 "At create: delete any stale loot.* flag from a save". Create-time only (Object.keys allocates).
  for (const k of Object.keys(world.state)) if (k.startsWith('loot.')) delete world.state[k];

  const grng = weaponRng(0x60B11 ^ count); // GOB-05: goblin weapon drops use their own stream too
  const wrng = weaponRng(0x5EA90 ^ count); // EQ-20: wolf weapon drops use their own stream (boar/chest streams stay untouched)
  /** @type {string[]} `loot.<id>` per slot, built once (no string concat on events). */
  const flagKey = ids.map((id) => 'loot.' + id);
  /** @type {any[]} the live interactable records, one per slot (x/y/z rewritten on death). */
  const recs = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = beasts.entities[i].transform;
    recs[i] = world.addInteractable({
      key: flagKey[i], name: 'beast.loot', x: t.x, y: t.y, z: t.z + CORPSE_LIFT, radius: LOOT_RADIUS,
      prompt: isGoblin(i) ? LOOT_PROMPT.goblin : ((beasts.bear && beasts.bear[i]) ? LOOT_PROMPT.bear : LOOT_PROMPT.boar), requires: flagKey[i], propId: ids[i], def: { beastId: ids[i] },
      // OB-084: the whole lying corpse picks (longer than the standing radius, lower than the standing height)
      bodyId: ids[i], bodyR: ((beasts.entities[i].components.targetable && beasts.entities[i].components.targetable.radius) || 0.5) * 1.4, bodyH: ((beasts.entities[i].components.targetable && beasts.entities[i].components.targetable.height) || 1) * 0.7,
    });
  }

  const loot = {
    count,
    corpseN: new Int8Array(MAX_SLOTS * ITEMS_PER_CORPSE),
    gearHeld: new Array(MAX_SLOTS).fill(null), // OB-064: rolled gear id / tier waits IN the corpse; the drop spawns at E
    _gear: { id: '', n: 1 },
    gearTier: new Array(MAX_SLOTS).fill('worn'),
    orbHeld: new Array(MAX_SLOTS).fill(null), // OB-074: the hp/mp potion waits IN the corpse ('hp'|'mp'); applied on E, never a ground pickup
    corpseItem: new Array(MAX_SLOTS * ITEMS_PER_CORPSE).fill(null), // item id per column (entry order: fixed, then give rolls)
    // Preallocated emit payloads (toastView builds its string from them, on the event).
    _added: { id: '', n: 0 },
    _orb: { kind: '' },
    _full: { id: "", n: 0, dropped: false },
  };

  function clearSlot(i) {
    delete world.state[flagKey[i]];
    loot.gearHeld[i] = null; loot.orbHeld[i] = null;
    const o = i * ITEMS_PER_CORPSE;
    for (let k = 0; k < ITEMS_PER_CORPSE; k++) { loot.corpseN[o + k] = 0; loot.corpseItem[o + k] = null; }
  }

  // Roll at death: 3 draws per `rolls` row (chance, b, c) in order, then the 2 orb draws. Fixed rows always drop.
  function onDied(p) {
    const i = beasts.slotOf(p.id);
    if (i < 0) return;
    const o = i * ITEMS_PER_CORPSE;
    const tb = tableFor(i), fixed = tb.fixed, rolls = tb.rolls;
    let col = 0;
    for (let k = 0; k < fixed.length; k++, col++) { loot.corpseItem[o + col] = fixed[k].item; loot.corpseN[o + col] = fixed[k].n; }
    for (let k = 0; k < rolls.length; k++) {
      const r = rolls[k];
      const hit = rng.nextFloat() < r.chance, b = rng.nextFloat(), c = rng.nextFloat();
      if (r.give) {
        loot.corpseItem[o + col] = r.give.item;
        loot.corpseN[o + col] = hit ? r.give.min + Math.min(r.give.max - r.give.min, Math.floor(b * (r.give.max - r.give.min + 1))) : 0;
        col++;
      } else if (hit && r.pick && r.pick.gear) {
        // US-129a: gear tier from the zone band (T1 = today's weighted roll, so the meadow is unchanged); same draws either way.
        const forced = band ? BAND_TABLE.gearItemTier[band.gearTierAt(p.x, p.y)] : null;
        const gid = rollGear(items, b, c, undefined, undefined, forced);
        if (gid) { loot.gearHeld[i] = gid; loot.gearTier[i] = items && items[gid] && items[gid].equip ? items[gid].equip.tier : 'worn'; } // OB-064: no ground drop before E
      }
    }
    if (beasts.wolf && beasts.wolf[i]) { // EQ-20: wolves 3 % sturdy shield/bow (fine only from band 5)
      const wid = rollWolfWeapon(items, band ? band.bandAt(p.x, p.y) : 1, wrng(), wrng(), wrng());
      if (wid) { loot.gearHeld[i] = wid; loot.gearTier[i] = items[wid].equip.tier; }
    }
    if (isGoblin(i)) { // GOB-05: tier forced by the zone band (5-6 fine, 7-8 tempered, 9-10 warden)
      const forced = band ? BAND_TABLE.gearItemTier[band.gearTierAt(p.x, p.y)] : null;
      const wid = rollGoblinWeapon(items, forced, grng(), grng());
      if (wid) { loot.gearHeld[i] = wid; loot.gearTier[i] = items[wid].equip.tier; }
    }
    const orbHit = rng.nextFloat() < tb.orb.chance;
    const orbKind = tb.orb.kinds[rng.int(tb.orb.kinds.length)];
    // OB-120: while the fireball is locked the potion.mp cell is unusable (FB-01), so every potion is hp; same draws either way.
    if (orbHit) loot.orbHeld[i] = (orbKind === 'mp' && world.state['magic.fireball'] !== true) ? 'hp' : orbKind; // OB-074: held in the corpse until E
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
    let left = 0, leftId = '';
    for (let k = 0; k < ITEMS_PER_CORPSE; k++) {
      const n = loot.corpseN[o + k];
      if (n <= 0) continue;
      const itemId = loot.corpseItem[o + k];
      const added = inv ? addItem(inv, items, itemId, n) : 0;
      loot.corpseN[o + k] = n - added;
      left += n - added;
      if (n - added > 0 && !leftId) { leftId = itemId; loot._full.n = n - added; }
      if (added > 0) {
        loot._added.id = itemId; loot._added.n = added;
        events.emit('inventory:added', loot._added);
      }
    }
    const gh = loot.gearHeld[i]; // OB-064 (reopened): held gear goes INTO THE PACK on the same E like meat; pack full -> stays in the corpse
    if (gh) {
      const added = inv ? addItem(inv, items, gh, 1) : 0; // tier lives in the item def (equip.tier), so it is kept
      if (added > 0) {
        loot.gearHeld[i] = null;
        loot._added.id = gh; loot._added.n = added;
        events.emit('inventory:added', loot._added);
        loot._gear.id = gh; loot._gear.n = added;
        events.emit('gear:got', loot._gear);
      } else {
        left += 1; if (!leftId) { leftId = gh; loot._full.n = 1; }
      }
    }
    const orb = loot.orbHeld[i]; // OB-113: the potion goes INTO THE PACK like meat (hp -> potion.hp, mp -> potion.mp); no instant heal
    if (orb) {
      const pid = orb === 'mp' ? 'potion.mp' : 'potion.hp';
      const added = inv ? addItem(inv, items, pid, 1) : 0;
      if (added > 0) {
        loot.orbHeld[i] = null;
        loot._added.id = pid; loot._added.n = added;
        events.emit('inventory:added', loot._added);
      } else { // pack full: the potion stays in the corpse (same inventory:full path as meat)
        left += 1; if (!leftId) { leftId = pid; loot._full.n = 1; }
      }
    }
    if (left > 0) {
      // Corpse keeps the leftover and stays lootable (simpler than a drop; nothing is lost or duplicated).
      loot._full.id = leftId; loot._full.dropped = false;
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
  /** Gear id still held by the corpse of beast `id` (OB-064), or null. Test/debug hook. */
  loot.gearOf = function gearOf(id) {
    const i = beasts.slotOf(id);
    return i < 0 ? null : loot.gearHeld[i];
  };
  /** Potion kind ('hp'|'mp') still held by the corpse of beast `id` (OB-074), or null. Test/debug hook. */
  loot.orbOf = function orbOf(id) {
    const i = beasts.slotOf(id);
    return i < 0 ? null : loot.orbHeld[i];
  };
  /** Item id in column `k` for beast `id` (null = empty / untracked). Test hook. */
  loot.itemOf = function itemOf(id, k) {
    const i = beasts.slotOf(id);
    return i < 0 ? null : loot.corpseItem[i * ITEMS_PER_CORPSE + k];
  };

  // Gear pickups: stepPickups hands a collected 'item' drop here; pack full -> false (drop stays).
  const gearGot = { id: '', n: 1 }; // event payload (reused)
  setItemPickupSink((itemId, n) => {
    const inv = inventoryOf();
    if (!inv) return 0;
    const got = addItem(inv, items, itemId, n); // returns the count really stored: partial adds are reported, never duplicated
    if (got <= 0) return 0;
    loot._added.id = itemId; loot._added.n = got;
    events.emit('inventory:added', loot._added);
    gearGot.id = itemId; gearGot.n = got;
    events.emit('gear:got', gearGot); // chestHook shows the item-get card
    return got;
  });

  /** Folds the corpse counts into a replay hash (no allocation). */
  loot.hashInto = function hashInto(h) {
    for (let j = 0; j < count * ITEMS_PER_CORPSE; j++) h.u32(loot.corpseN[j] & 0xff);
  };

  /** Drops the event listeners and this load's interactables (the next load re-adds its own). */
  loot.dispose = function dispose() {
    for (const off of offs) off();
    setItemPickupSink(null);
    for (let i = 0; i < count; i++) world.removeInteractable(flagKey[i]);
  };

  return loot;
}

// S8-C-06: the chest branch shares createLoot and inventory transfer rather than a second loot service.
// A table contains fixed [{item,n}] plus one optional weighted pick [{item,n,weight}].
// Roll once at create with a chest-owned stream. claim is all-or-nothing so openedChests is sufficient to save it.
function buildChestLoot(events, {items, table, rng, inventoryOf}) {
  // EQ-10: optional table.gear = {tier?} -> one gear roll at create (2 draws, after the weighted pick); tier fixed or rolled.
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
  if (!Number.isFinite(weight) || !table.fixed.length && !table.weighted.length && !table.gear && !table.weapon) throw new Error('chest loot: empty or overflowing table');
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
  if (table.gear) {
    // US-104a: optional gear.chance (the loot.json chest source: 0.08) = one extra leading draw; without it the stream is unchanged (EQ-10 chests).
    const hit = table.gear.chance === undefined || rng.nextFloat() < table.gear.chance;
    const b = rng.nextFloat(), c = rng.nextFloat();
    if (hit) {
      const gid = rollGear(items, b, c, undefined, undefined, table.gear.tier || null);
      if (!gid) throw new Error('chest loot: no gear def for the roll');
      add({item: gid, n: 1});
    }
  }
  if (table.weapon) { // EQ-20: one weapon roll (1 draw, after the gear roll); tier fixed (default sturdy)
    const wid = rollChestWeapon(items, table.weapon, rng.nextFloat());
    if (!wid) throw new Error('chest loot: no weapon def for the roll');
    add({item: wid, n: 1});
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
