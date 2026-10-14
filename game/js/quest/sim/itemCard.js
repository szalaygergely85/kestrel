// ITEM-07 (D-081/D-091, epic ep-items-stats.md sections 2+4): the item card as pure text. buildCard(entry, defs, opts) ->
// {rarity, tag, frameC, rows[] (framed, 34 wide, golden-tested), lines[{t, c, kind}] (unframed, c = palette key), cmp[]}.
// Layout + colours come from design/itemLooks.js (ASSETS.itemLooks), numbers from itemInst/itemGen. Pure: no clock, no random.
// opts: {worn: entry|null (what sits in that slot now; null = empty slot; undefined = no compare block), totals: stats totals}.
import { ITEM_BASES } from './itemGen.js';
import { AFFIX } from './statsConfig.js';
import { itOf, itemName, createView, fillView } from './itemInst.js';

export const SLOT_LABEL = { main: 'Main hand', ranged: 'Ranged', off: 'Off hand', head: 'Head', body: 'Body', cloak: 'Cloak', hands: 'Hands', belt: 'Belt', legs: 'Legs', feet: 'Feet' };
const looks = () => globalThis.ASSETS.itemLooks;
const R = (v) => Math.round(v);
const pct = (v) => R(v * 100) + ' %';

/** Numbers of one gear entry (rolled or unique), or null when it has no instance. st = compare table values. */
function statsOf(entry, defs) {
  const it = itOf(entry, defs);
  if (!it) return null;
  const v = fillView(createView(), entry.id, it, defs);
  if (!v) return null;
  const b = ITEM_BASES[v.type] || {}, st = {};
  let dmgPct = 0, dmgFlat = 0, armPct = 0, armFlat = 0;
  const bonus = [];
  for (const [id, val] of it.a || []) {
    const k = AFFIX[id].key;
    if (k === 'dmgPct') dmgPct += val; else if (k === 'dmgFlat') dmgFlat += val; else if (k === 'armourPct') armPct += val;
    else if (k === 'armourFlat') armFlat += val; else st[k] = (st[k] || 0) + val;
    bonus.push([id, val]);
  }
  const crit = b.critDmg || 0, swing = 1 - (b.swingMul || 1);
  if (crit || st.critDmg) st.critDmg = (st.critDmg || 0) + crit;
  if (swing || st.atkSpeed) st.atkSpeed = (st.atkSpeed || 0) + swing;
  if (b.reach) st.reach = b.reach;
  if (v.dmg) st.avg = (v.dmg[0] + v.dmg[1]) / 2 * (1 + dmgPct) + dmgFlat;
  if (v.armour || armFlat) st.armour = (v.armour + armFlat) * (1 + armPct);
  return { it, slot: v.slot, st, bonus, dmg: v.dmg ? [v.dmg[0], v.dmg[1]] : null, armour: v.armour, crit, b };
}

// compare table: key, label, kind ('p' percent, 'i' integer, 'm' metres)
const CMP = [['avg', 'Avg damage', 'i'], ['armour', 'Armour', 'i'], ['critChance', 'Crit chance', 'p'], ['critDmg', 'Crit damage', 'p'],
  ['atkSpeed', 'Swing speed', 'p'], ['reach', 'Reach', 'm'], ['lifeOnHit', 'Life on hit', 'i'], ['str', 'STR', 'i'], ['dex', 'DEX', 'i'], ['int', 'INT', 'i'],
  ['hp', 'Health', 'i'], ['mana', 'Mana', 'i'], ['moveSpeed', 'Move speed', 'p'], ['blockPct', 'Block', 'p']];
const shown = (v, kind) => (kind === 'p' ? R(v * 100) : kind === 'm' ? R(v * 10) / 10 : R(v));
const fmtD = (d, kind) => (d > 0 ? '+' : '') + d + (kind === 'p' ? ' %' : kind === 'm' ? ' m' : '');

/** One line per stat that either item has: green better / red worse / grey same. No worn item = all green. */
export function compareLines(cand, worn) {
  const T = looks().card.text, out = [];
  for (let i = 0; i < CMP.length; i++) {
    const [k, label, kind] = CMP[i], a = cand.st[k] || 0, w = worn ? worn.st[k] || 0 : 0;
    if (!a && !w) continue;
    const d = Math.round((shown(a, kind) - shown(w, kind)) * 10) / 10;
    out.push(d > 0 ? { t: label + ' ' + fmtD(d, kind), c: T.better, kind: 'better' } : d < 0 ? { t: label + ' ' + fmtD(d, kind), c: T.worse, kind: 'worse' }
      : { t: label + ' same', c: T.same, kind: 'same' });
  }
  return out;
}

/** Text of one rolled bonus line ("+18 % damage", "+4 STR"). */
export function bonusText(id, val) {
  const k = AFFIX[id].key, p = R(val * 100), n = R(val);
  switch (k) {
    case 'dmgPct': return '+' + p + ' % damage'; case 'dmgFlat': return '+' + n + ' damage';
    case 'critChance': return '+' + p + ' % crit chance'; case 'critDmg': return '+' + p + ' % crit damage';
    case 'atkSpeed': return '+' + p + ' % attack speed'; case 'armourFlat': return '+' + n + ' armour';
    case 'armourPct': return '+' + p + ' % armour'; case 'str': return '+' + n + ' STR'; case 'dex': return '+' + n + ' DEX';
    case 'int': return '+' + n + ' INT'; case 'hp': return '+' + n + ' health'; case 'mana': return '+' + n + ' mana';
    case 'lifeOnHit': return '+' + n + ' life on hit'; case 'moveSpeed': return '+' + p + ' % move speed'; case 'blockPct': return '+' + p + ' % block';
  }
  return k;
}

const tile = (pat, n) => { let s = ''; for (let i = 0; i < n; i++) s += pat[i % pat.length]; return s; };
function edge(r, w, left, right, orn) {
  const n = w - 2; let mid = tile(r.h, n);
  if (orn) { const at = (n - orn.length) >> 1; mid = mid.slice(0, at) + orn + mid.slice(at + orn.length); }
  return left + mid + right;
}
/** Frames the lines into w-wide rows; `tag` is right-aligned on its row, kind 'divider' makes a rule. */
function frame(r, lines, w) {
  const rows = [edge(r, w, r.corners.tl, r.corners.tr, r.ornament)];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], side = r.v[i % r.v.length];
    if (L.kind === 'divider') { rows.push('|' + tile('-', w - 2) + '|'); continue; }
    const body = ' ' + L.t + (L.tag ? tile(' ', Math.max(1, w - 4 - L.t.length - L.tag.length)) + L.tag : '');
    rows.push(side + body.padEnd(w - 2, ' ').slice(0, w - 2) + side);
  }
  rows.push(edge(r, w, r.corners.bl, r.corners.br, null));
  return rows;
}

/** @returns {object|null} the card of a gear entry with an instance (rolled or unique); null for anything else. */
export function buildCard(entry, defs, opts = {}) {
  const me = statsOf(entry, defs);
  if (!me) return null;
  const IL = looks(), T = IL.card.text, r = IL.rarity[IL.rarity.order[me.it.r]] || IL.rarity.common;
  const all = [];
  all.push({ t: itemName(entry, defs), c: r.name, kind: 'name', tag: r.tag, tagC: r.tagC });
  all.push({ t: (SLOT_LABEL[me.slot] || me.slot) + '  -  Level ' + me.it.iL, c: T.slotLine, kind: 'slot' });
  if (me.dmg) all.push({ t: 'Damage ' + me.dmg[0] + '-' + me.dmg[1] + '   (avg ' + R((me.dmg[0] + me.dmg[1]) / 2) + ')', c: T.base, kind: 'base' });
  if (me.armour) all.push({ t: 'Armour ' + me.armour, c: T.base, kind: 'base' });
  if (me.crit) all.push({ t: 'Crit damage +' + pct(me.crit), c: T.base, kind: 'base' });
  if (me.b.reach) all.push({ t: 'Reach +' + me.b.reach + ' m', c: T.base, kind: 'base' });
  if (me.b.swingMul && me.b.swingMul !== 1) all.push({ t: 'Swing speed ' + (me.b.swingMul < 1 ? '+' : '') + R((1 - me.b.swingMul) * 100) + ' %', c: T.base, kind: 'base' });
  for (const [id, val] of me.bonus) all.push({ t: bonusText(id, val), c: T.bonus, kind: 'bonus' });
  const d = defs[entry.id], uq = d && d.equip && d.equip.uniqueText;
  if (me.it.r === 4 && uq) all.push({ t: uq, c: T.unique, kind: 'unique' });
  const rq = me.it.req;
  if (rq) {
    const t = opts.totals, bad = !!t && (t.str < (rq.str || 0) || t.dex < (rq.dex || 0) || t.int < (rq.int || 0));
    all.push({ t: 'Needs ' + [rq.str ? 'STR ' + rq.str : '', rq.dex ? 'DEX ' + rq.dex : '', rq.int ? 'INT ' + rq.int : ''].filter(Boolean).join('  '), c: bad ? T.worse : T.same, kind: bad ? 'reqBad' : 'req' });
  }
  let cmp = [];
  if (opts.worn !== undefined) { // compare block; the caller passes worn: null for an empty slot
    const w = opts.worn ? statsOf(opts.worn, defs) : null;
    cmp = compareLines(me, w);
    all.push({ t: '', kind: 'divider', c: r.frame });
    let head = 'vs empty slot';
    if (w) { // 'vs worn <name> (Magic, Lv 4)', the name shortened to fit the card
      const suf = ' (' + IL.rarity[IL.rarity.order[w.it.r]].label + ', Lv ' + w.it.iL + ')', nm = itemName(opts.worn, defs);
      const room = IL.card.w - 3; // text cells inside the frame
      head = ('vs worn '.length + nm.length + suf.length <= room ? 'vs worn ' : 'vs ') + nm + suf; // long names drop 'worn'
      if (head.length > room) head = head.slice(0, room - suf.length - 1) + '.' + suf;
    }
    all.push({ t: head, c: T.compareHead, kind: 'head' });
    for (const c of cmp) all.push(c);
  }
  return { rarity: me.it.r, tag: r.tag, frameC: r.frame, lines: all, cmp, rows: frame(r, all, IL.card.w) };
}
