// ITEM-WIRE-01: fills `player.components.rolledGear` (the object computeTotals reads) from the equipped rolled items.
// Source of truth (JSON, saved): `equipment.rolled[slot] = { id, iL, type, dmg?, armour?, a: [[affixId, v], ...], req? }`.
// An instance counts only while `equipment[slot] === instance.id` (unequip / swapping in plain gear drops it). Plain tier
// gear has no rolled lines (its base def is applied by weaponStats/defenceOf as before). ITEM-09: an unmet main-attribute
// requirement halves the item's dmg/armour (reqMul), judged against the totals of all gear with full values.
// `rolledGear` is derived: non-enumerable, so it is never saved; rebuilt only when the equipped instances change.
import { computeTotals, createTotals, reqMul } from './stats.js';
import { ALL_SLOTS } from './statsConfig.js';

const scratch = createTotals();
const raw = {};                 // slot -> instance currently counted (reference signature)
const view = {};                // slot -> reused scaled copy handed to computeTotals

function ensureView(slot) {
  return view[slot] || (view[slot] = { dmg: [0, 0], armour: 0, a: null });
}

/** Re-derives `components.rolledGear` when the set of equipped rolled instances changed. 0 alloc when unchanged. Returns true when rebuilt. */
export function refreshRolledGear(player) {
  const c = player.components;
  if (!c) return false;
  const eq = c.equipment, rolled = eq && eq.rolled;
  let changed = !Object.prototype.hasOwnProperty.call(c, 'rolledGear');
  for (let s = 0; s < ALL_SLOTS.length; s++) {
    const slot = ALL_SLOTS[s], it = rolled ? rolled[slot] : null;
    const cur = it && eq[slot] === it.id ? it : null;
    if ((raw[slot] || null) !== cur) { changed = true; raw[slot] = cur; }
  }
  if (!changed) return false;
  let out = c.rolledGear;
  if (!out) { out = {}; Object.defineProperty(c, 'rolledGear', { value: out, enumerable: false, writable: true, configurable: true }); }
  for (let s = 0; s < ALL_SLOTS.length; s++) out[ALL_SLOTS[s]] = raw[ALL_SLOTS[s]] || null;
  computeTotals(out, scratch); // attribute totals with full item values decide who meets a requirement
  for (let s = 0; s < ALL_SLOTS.length; s++) {
    const slot = ALL_SLOTS[s], it = raw[slot];
    if (!it) continue;
    const m = reqMul(scratch, it);
    if (m === 1) continue;
    const v = ensureView(slot);
    v.dmg[0] = it.dmg ? it.dmg[0] * m : 0; v.dmg[1] = it.dmg ? it.dmg[1] * m : 0;
    v.armour = it.armour ? it.armour * m : 0; v.a = it.a;
    out[slot] = v;
  }
  return true;
}
