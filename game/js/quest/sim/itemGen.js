// ITEM-03 (D-081/D-084/D-089): item generator. Pure + deterministic: the caller passes a rng() in [0,1)
// (createStatsRng(seed)). Instance shape (ep-items-stats section 5): { id, n: 1, it: { iL, r, a: [[affix, value]], req? } }.
// Uniques never roll. Base dmg / armour are derived (baseStats), not stored. Not wired into loot/inventory (ITEM-04+).
import '../../../../design/itemBases.js';
import { AFFIX, AFFIX_IDS, RARITY, IL_MIN, IL_MAX, STATS_CFG, ARMOUR_SLOTS } from './statsConfig.js';
import { rollAffix } from './stats.js';

export const ITEM_BASES = globalThis.ASSETS.itemBases;
export const BASE_TYPES = Object.keys(ITEM_BASES);
export const MAX_RARITY = 3; // epic; 4 (unique) is never rolled
// Default rarity weights (common..epic); loot tables (ITEM-04) may pass their own `r`.
const RARITY_W = [60, 28, 10, 2];

const clampIL = (iL) => (iL < IL_MIN ? IL_MIN : iL > IL_MAX ? IL_MAX : iL | 0);

/** Hard requirement (ITEM-09): 5 + floor(0.9 (iL-1)). */
export function reqValue(iL) { return STATS_CFG.attrBase + Math.floor(0.9 * (clampIL(iL) - 1)); }

/** Slot group test for an AFFIX `on` list. */
function allowed(id, base) {
  const on = AFFIX[id].on, slot = base.slot;
  for (let i = 0; i < on.length; i++) {
    const g = on[i];
    if (g === 'all' || g === slot) return true;
    if (g === 'weapon' && base.kind === 'weapon') return true;
    if (g === 'armour' && ARMOUR_SLOTS.indexOf(slot) >= 0) return true;
    if (g === 'shield' && base.kind === 'shield') return true;
  }
  return false;
}
export function affixesFor(type) {
  const b = ITEM_BASES[type];
  return AFFIX_IDS.filter((id) => allowed(id, b));
}

/** Base stats incl. rarity multiplier: { dmg: [min,max] } for weapons, { armour } for shield/armour (rounded ints). */
export function baseStats(type, iL, r) {
  const b = ITEM_BASES[type], m = RARITY[r].base; iL = clampIL(iL);
  if (b.kind === 'weapon') return { dmg: [Math.round((4 + 2 * iL) * b.dmgMul * m), Math.round((7 + 3 * iL) * b.dmgMul * m)] };
  return { armour: Math.round((b.kind === 'shield' ? 2 * (2 + iL) : (2 + iL) * b.weight) * m) };
}

export function baseName(type, iL) { const n = ITEM_BASES[type].names; return n[iL <= 3 ? 0 : iL <= 6 ? 1 : 2]; }
export function itemId(type) { return 'gen.' + type; }
export function typeOfId(id) { return id.slice(4); }

function pickRarity(rng) {
  let t = rng() * 100;
  for (let i = 0; i < RARITY_W.length; i++) { if ((t -= RARITY_W[i]) < 0) return i; }
  return 0;
}

/**
 * Roll one item. opts: { iL (1-10), type?, r? (0-3), slot? }. `slot` restricts random type to that slot.
 * Draw order is fixed (type, rarity, affixes) so the same seed gives the same item.
 */
export function generateItem(rng, opts) {
  const iL = clampIL(opts.iL);
  let type = opts.type;
  if (!type) {
    const pool = opts.slot ? BASE_TYPES.filter((t) => ITEM_BASES[t].slot === opts.slot) : BASE_TYPES;
    type = pool[Math.floor(rng() * pool.length)];
  }
  const base = ITEM_BASES[type];
  const r = opts.r != null ? Math.min(opts.r, MAX_RARITY) : pickRarity(rng);
  const pool = affixesFor(type), a = [];
  for (let n = RARITY[r].lines; n > 0 && pool.length; n--) {
    const id = pool.splice(Math.floor(rng() * pool.length), 1)[0]; // splice = no duplicate
    a.push([id, rollAffix(id, iL, rng)]);
  }
  const it = { iL, r, a };
  if (base.reqAttr) it.req = { [base.reqAttr]: reqValue(iL) };
  return { id: itemId(type), n: 1, it };
}

/** Stats-shaped view of an instance for computeTotals / meetsRequirement: { type, slot, iL, r, dmg|armour, a, req }. */
export function itemView(inst) {
  const type = typeOfId(inst.id), it = inst.it;
  return Object.assign({ type, slot: ITEM_BASES[type].slot, iL: it.iL, r: it.r, a: it.a, req: it.req }, baseStats(type, it.iL, it.r));
}
