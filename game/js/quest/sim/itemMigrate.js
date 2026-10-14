// ITEM-02c (architecture.md 38.66 s6, epic ep-items-stats s5): save v1 -> v2 item migration. Old plain gear ids
// (sword / bow / shield / gear.<slot>.<base>.<tier>) become rolled instances, deterministic per (saveId, slot index).
// Migrated items drop `req` (earned under the old rules). Runs once (inv.v !== 2), never throws on a stale save.
// Rule 15: pure, no Math.random / clock.
import { generateItem, itemId, ITEM_BASES } from './itemGen.js';
import { createStatsRng } from './stats.js';
import { sanitizeIt, fnv1a32 } from './itemInst.js';
import { ARMOUR_SLOTS } from './statsConfig.js';
import { EQUIP_SLOTS, ensureEquipment, syncHands } from './equipment.js';
import { SLOTS, addItem, addInstance } from './inventory.js';

/** gear tier -> [iL, rarity] (epic s5). */
export const TIER_MAP = Object.freeze({ worn: [1, 0], sturdy: [2, 1], fine: [4, 1], tempered: [6, 2], warden: [8, 2] });
const WEAPON_SLOT = { main: 'sword', ranged: 'bow', off: 'shield' }; // gear.main.sword.<tier> etc.
const LEGACY = /^gear\.([a-z]+)\.([A-Za-z]+)\.(worn|sturdy|fine|tempered|warden)$/;

/** Legacy plain id -> { type, iL, r } or null (uniques, spells, stackables, gen.*, unknown). */
export function legacyInfo(id) {
  if (typeof id !== 'string') return null;
  if (id === 'sword' || id === 'bow' || id === 'shield') return { type: id, iL: 1, r: 0 };
  const m = LEGACY.exec(id);
  if (!m) return null;
  const type = WEAPON_SLOT[m[1]] || (ARMOUR_SLOTS.indexOf(m[1]) >= 0 ? 'armour.' + m[1] : null);
  if (!type) return null;
  const t = TIER_MAP[m[3]];
  return { type, iL: t[0], r: t[1] };
}

/** FNV-1a over two u32s (saveId, index). */
export function seedFor(saveId, idx) {
  let x = 0x811c9dc5;
  for (const v of [saveId >>> 0, idx >>> 0]) for (let s = 0; s < 32; s += 8) { x ^= (v >>> s) & 0xff; x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}

/** Instance `{id, n:1, it}` for a legacy id at index idx, or null. `it.req` is dropped unless keepReq (new drops carry req). */
export function convertLegacy(id, saveId, idx, keepReq = false) {
  const info = legacyInfo(id);
  if (!info || !ITEM_BASES[info.type]) return null;
  const inst = generateItem(createStatsRng(seedFor(saveId, idx)), info);
  if (!keepReq) delete inst.it.req;
  return inst;
}

/** world.state['items.saveId'] (u32), derived once from the player name + play time when missing. */
export function ensureSaveId(state, playerName, playTimeSec) {
  const cur = state['items.saveId'];
  if (Number.isInteger(cur) && cur >= 0 && cur <= 0xffffffff) return cur;
  return (state['items.saveId'] = fnv1a32(String(playerName) + '|' + Math.floor(Number(playTimeSec) || 0)));
}

function emptySlots() { return Array.from({ length: SLOTS }, () => ({ id: null, n: 0, it: null })); }

/** Load-time tidy of the pack + worn items: `it` only on gen.* ids, sanitized; a gen.* id without a usable instance is dropped. */
export function sanitizeItems(player) {
  try {
    const c = player && player.components, inv = c && c.inventory, eq = c && c.equipment;
    if (inv) {
      if (!Array.isArray(inv.slots)) inv.slots = emptySlots();
      for (let k = 0; k < inv.slots.length; k++) {
        const s = inv.slots[k];
        if (!s || typeof s !== 'object') { inv.slots[k] = { id: null, n: 0, it: null }; continue; }
        if (typeof s.id === 'string' && s.id.startsWith('gen.')) {
          const it = ITEM_BASES[s.id.slice(4)] ? sanitizeIt(s.it, s.id.slice(4)) : null;
          if (it) { s.it = it; s.n = 1; } else { s.id = null; s.n = 0; s.it = null; }
        } else s.it = null;
      }
    }
    if (eq) {
      if (!eq.it || typeof eq.it !== 'object') eq.it = {};
      for (const slot of EQUIP_SLOTS) {
        if (slot === 'quiver') continue;
        const id = eq[slot];
        if (typeof id === 'string' && id.startsWith('gen.')) {
          const it = ITEM_BASES[id.slice(4)] ? sanitizeIt(eq.it[slot], id.slice(4)) : null;
          if (it) eq.it[slot] = it; else { eq[slot] = null; eq.it[slot] = null; }
        } else eq.it[slot] = null;
      }
      if (!Number.isInteger(eq.rev)) eq.rev = 0;
    }
  } catch (e) { /* stale save: leave as is */ }
}

/**
 * Converts every legacy pack/worn id into an instance once (inv.v !== 2). Pack slot k seeds with k, worn slot with
 * 24 + EQUIP_SLOTS index. @returns {{converted:number, dropped:number}}
 */
export function migrateItems(player, defs, saveId) {
  const out = { converted: 0, dropped: 0 };
  try {
    const c = player && player.components, inv = c && c.inventory;
    if (!inv || inv.v === 2) { sanitizeItems(player); return out; }
    if (!Array.isArray(inv.slots)) inv.slots = emptySlots();
    const eq = ensureEquipment(player), changed = {};
    for (let k = 0; k < inv.slots.length; k++) {
      const s = inv.slots[k];
      if (!s || typeof s !== 'object') { inv.slots[k] = { id: null, n: 0, it: null }; continue; }
      const inst = s.id ? convertLegacy(s.id, saveId, k) : null;
      if (inst) { changed[s.id] = 1; s.id = inst.id; s.n = 1; s.it = inst.it; out.converted++; }
      else if (s.it === undefined) s.it = null;
    }
    if (!eq.it || typeof eq.it !== 'object') eq.it = {};
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const slot = EQUIP_SLOTS[i], id = eq[slot];
      const inst = slot !== 'quiver' && typeof id === 'string' ? convertLegacy(id, saveId, SLOTS + i) : null;
      if (inst) { changed[id] = 1; eq[slot] = inst.id; eq.it[slot] = inst.it; out.converted++; }
    }
    const qb = c.quickbar;
    if (Array.isArray(qb)) for (let i = 0; i < qb.length; i++) if (qb[i] && changed[qb[i]]) qb[i] = null;
    if (out.converted > 0) eq.rev = (eq.rev | 0) + 1;
    inv.v = 2;
    sanitizeItems(player);
    syncHands(inv, eq);
  } catch (e) { out.dropped++; }
  return out;
}

/**
 * Loot entry (ITEM-02c, until ITEM-06): a legacy `gear.*` drop enters the pack as a rolled instance (iL/rarity from the
 * tier map = the zone band, req kept). No saveId or another id -> plain addItem. Returns the count stored; `gotId.id` = id stored.
 */
export function addDrop(inv, defs, id, n, saveId, idx, gotId) {
  gotId.id = id;
  const inst = saveId != null && n === 1 && typeof id === 'string' && id.startsWith('gear.') ? convertLegacy(id, saveId, idx, true) : null;
  if (!inst || !defs[inst.id]) return addItem(inv, defs, id, n);
  if (addInstance(inv, defs, inst) < 0) return 0;
  gotId.id = inst.id;
  return 1;
}
