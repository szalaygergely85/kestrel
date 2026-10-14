// ITEM-02a (architecture.md 38.66 s1-3, D-081/D-091/D-096): the ONE module that knows the shape of an item
// instance. A pack slot / worn entry is `{id, n, it}`; `it` is `{iL, r, a: [[affixId, value]], req?}` or null
// (stackables, plain items, uniques). No other file reads `.it` / `.a` / `.req` of an entry - they call these.
// Rule 15: pure, no Math.random / trig / clock. itOf / hashIt / fillView allocate nothing.
import { ITEM_BASES, BASE_TYPES, baseName, baseStatsInto, affixesFor, typeOfId } from './itemGen.js';
import { AFFIX, IL_MIN, IL_MAX } from './statsConfig.js';
import { itemDisplayName } from './inventory.js'; // import cycle with inventory.js (hashIt): function-only use, safe

const isGenId = (id) => typeof id === 'string' && id.startsWith('gen.');
const gearDef = (d) => !!(d && d.equip && d.equip.slot !== 'quiver');

/** @returns {object|null} the instance part of an entry ({id, it}); falls back to defs[id].equip.it (uniques). */
export function itOf(entry, defs) {
  if (!entry) return null;
  if (entry.it != null) return entry.it;
  const d = defs && entry.id != null ? defs[entry.id] : null;
  return d && d.equip && d.equip.it ? d.equip.it : null;
}
export function isInstance(entry) { return !!entry && entry.it != null; }

/** Display name: rolled gear -> base name for its item level; everything else -> the def (nameAfter rules apply). */
export function itemName(entry, defs) {
  if (!entry || entry.id == null) return '';
  if (isGenId(entry.id) && entry.it != null) return baseName(typeOfId(entry.id), entry.it.iL);
  const d = defs ? defs[entry.id] : null;
  return d ? itemDisplayName(d) : '';
}

/** 0..3 rolled, 4 unique, 0 plain gear, -1 non-gear. */
export function rarityOf(entry, defs) {
  const it = itOf(entry, defs);
  if (it) return it.r;
  return entry && defs && gearDef(defs[entry.id]) ? 0 : -1;
}
/** Item level; plain gear counts as 1, non-gear 0 (playerLevel G reads this). */
export function itemLevelOf(entry, defs) {
  const it = itOf(entry, defs);
  if (it) return it.iL;
  return entry && defs && gearDef(defs[entry.id]) ? 1 : 0;
}
export function reqOf(entry, defs) {
  const it = itOf(entry, defs);
  return it && it.req ? it.req : null;
}

/** A reusable view object for fillView (allocate once per slot). */
export function createView() {
  return { type: '', slot: '', iL: 1, r: 0, dmg: null, armour: 0, a: null, req: null, _base: { dmg: [0, 0], armour: 0 } };
}

/**
 * Writes a stats.js-shaped view ({type, slot, iL, r, dmg|null, armour, a, req}) of `id` + `it` into a REUSED
 * `view`; returns view, or null when the item adds nothing (no instance).
 */
export function fillView(view, id, it, defs) {
  if (!it) return null;
  if (isGenId(id)) {
    const type = typeOfId(id), b = ITEM_BASES[type];
    if (!b) return null;
    view.type = type; view.slot = b.slot;
    baseStatsInto(type, it.iL, it.r, view._base);
    view.dmg = b.kind === 'weapon' ? view._base.dmg : null;
    view.armour = view._base.armour;
  } else { // unique: fixed lines in the def, base numbers from equip
    const q = defs && defs[id] ? defs[id].equip : null;
    if (!q) return null;
    view.type = id; view.slot = q.slot;
    view.dmg = null;
    if (q.dmg) { view._base.dmg[0] = q.dmg[0]; view._base.dmg[1] = q.dmg[1]; view.dmg = view._base.dmg; }
    view.armour = q.def || 0;
  }
  view.iL = it.iL; view.r = it.r; view.a = it.a; view.req = it.req || null;
  return view;
}

/** Load time: clamp iL / r, drop unknown, disallowed, duplicate or non-finite affix lines. Never throws; fresh object or null. */
export function sanitizeIt(it, type) {
  try {
    if (!it || typeof it !== 'object' || !Number.isFinite(it.iL)) return null;
    const iL = Math.min(IL_MAX, Math.max(IL_MIN, Math.floor(it.iL)));
    const r = Number.isFinite(it.r) ? Math.min(type ? 3 : 4, Math.max(0, Math.floor(it.r))) : 0;
    const allow = type && ITEM_BASES[type] ? affixesFor(type) : null;
    const a = [];
    if (Array.isArray(it.a)) {
      for (let i = 0; i < it.a.length; i++) {
        const ln = it.a[i];
        if (!Array.isArray(ln) || typeof ln[0] !== 'string' || !AFFIX[ln[0]] || !Number.isFinite(ln[1])) continue;
        if (allow && allow.indexOf(ln[0]) < 0) continue;
        if (a.some((x) => x[0] === ln[0])) continue;
        a.push([ln[0], ln[1]]);
      }
    }
    const out = { iL, r, a };
    const q = it.req;
    if (q && typeof q === 'object') {
      const req = {};
      for (const k of ['str', 'dex', 'int']) if (Number.isFinite(q[k]) && q[k] > 0) req[k] = Math.floor(q[k]);
      if (req.str || req.dex || req.int) out.req = req;
    }
    return out;
  } catch (e) { return null; }
}

/** Replay hash (allocation-free): flag, iL, r, line count, per line id chars + u32(round(v*1e4)), req. */
export function hashIt(h, it) {
  if (!it) { h.u32(0); return; }
  h.u32(1); h.u32(it.iL); h.u32(it.r);
  const a = it.a, n = a ? a.length : 0;
  h.u32(n);
  for (let i = 0; i < n; i++) {
    const id = a[i][0];
    for (let k = 0; k < id.length; k++) h._byte(id.charCodeAt(k));
    h._byte(0x00);
    h.u32(Math.round(a[i][1] * 1e4) >>> 0);
  }
  const q = it.req;
  h.u32(q ? 1 : 0);
  if (q) { h.u32(q.str || 0); h.u32(q.dex || 0); h.u32(q.int || 0); }
}

/** FNV-1a over a string's char codes (load-time seed helper). */
export function fnv1a32(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i) & 0xff; x = Math.imul(x, 0x01000193) >>> 0; }
  return x >>> 0;
}

/**
 * Registers one def per base type (`gen.<type>`) into `defs` at boot, before validateItemDefs. Equip slot +
 * held/shell are copied from the old plain base def (sword / bow / shield / gear.<slot>.*.worn); axe and spear
 * borrow the sword's look.
 */
export function registerGenDefs(defs) {
  const oldFor = (type) => {
    const b = ITEM_BASES[type];
    if (b.kind === 'armour') { for (const id in defs) if (id.startsWith('gear.' + b.slot + '.') && id.endsWith('.worn')) return defs[id]; return null; }
    return defs[type] || defs.sword || null;
  };
  for (let i = 0; i < BASE_TYPES.length; i++) {
    const type = BASE_TYPES[i], b = ITEM_BASES[type], old = oldFor(type), id = 'gen.' + type;
    if (!old || defs[id]) continue;
    const eq = { slot: b.slot, def: 0 };
    if (old.equip && old.equip.held) eq.held = old.equip.held;
    if (old.equip && old.equip.shell) eq.shell = old.equip.shell;
    defs[id] = {
      id, name: b.names[0], kind: b.kind === 'armour' ? 'gear' : b.kind, stackMax: 1, gen: type, hand: !!old.hand, inPack: true,
      desc: old.desc || '', glyph: old.glyph, icon: old.icon, equip: eq,
    };
  }
  return defs;
}
