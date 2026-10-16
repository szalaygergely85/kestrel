// PLAYER-LEVEL-01 v2 (D-116, D-084): power score and player level. Pure, no globals written, no Math.random, 0 alloc
// per call (the text helpers build their strings only). Spec: docs/epics/ep-items-stats.md "PLAYER-LEVEL-01 v2".
// Level and power are never saved: callers recompute them from the equipment + spell book (both already saved).
//   item:  round10(20 x iL^2 x slotWeight x (rarityFactor + 0.1 x sum over lines (1 + q)))
//   spell: 250 / 600 / 1000 for level 1 / 2 / 3 (total per spell), level bands LEVEL_POWER.
// An item is a plain id (def.equip.{slot,tier} -> POWER_TIER_MAP, lines q 0.5) or a rolled instance
// { iL, r, type, a: [[affixId, value], ...], effect? } (q from the affix range at iL; Unique: q 1 + effect line).
import { AFFIX, RARITY, IL_MIN, IL_MAX, POWER_BASE, POWER_SLOT_WEIGHT, POWER_RARITY, POWER_LINE, POWER_UNROLLED_Q, POWER_TIER_MAP,
  SPELL_POWER, LEVEL_POWER } from './statsConfig.js';
import { SPELL_IDS } from '../spellDefs.js';

const SLOTS = Object.freeze(['main', 'body', 'off', 'ranged', 'head', 'legs', 'hands', 'feet', 'cloak', 'belt', 'quiver']);
const TYPE_SLOT = Object.freeze({ sword: 'main', axe: 'main', spear: 'main', staff: 'main', bow: 'ranged', shield: 'off' });
const UNIQUE = 4, MAX_LEVEL = LEVEL_POWER.length;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function weightOf(slot) { return slot && own(POWER_SLOT_WEIGHT, slot) ? POWER_SLOT_WEIGHT[slot] : 0; }
// lineMicro = sum over lines (1 + q) x 1e6 as an int: doubles passed to / returned from a call get boxed (16 B each)
function core(iL, r, slot, lineMicro) {
  const w = weightOf(slot);
  if (!(iL > 0) || w === 0) return 0;
  const ri = r > 0 ? (r > UNIQUE ? UNIQUE : r | 0) : 0;
  const x = POWER_BASE * iL * iL * w * (POWER_RARITY[ri] + POWER_LINE * (lineMicro / 1e6));
  return (Math.round(x / 10) * 10) | 0; // round10, int result (Smi)
}
function instancePower(it, slot) {
  const iL = it.iL, r = it.r | 0, a = it.a;
  let sum = 0;
  const n = a && a.length ? a.length : 0;
  for (let i = 0; i < n; i++) { // q = roll quality 0..1 at iL (inlined: a double return would box); unknown affix -> 0.5
    const line = a[i];
    let q = 1;
    if (r !== UNIQUE) {
      if (!line || !own(AFFIX, line[0])) q = +POWER_UNROLLED_Q;
      else {
        const d = AFFIX[line[0]], lo = d.lo, hi = d.hi, t = iL <= IL_MIN ? 0 : iL >= IL_MAX ? 1 : (iL - IL_MIN) / (IL_MAX - IL_MIN);
        const mn = lo[0] + (hi[0] - lo[0]) * t, span = lo[1] + (hi[1] - lo[1]) * t - mn; // = stats.affixRange (inlined: no boxed doubles)
        if (span > 0) { q = (+line[1] - mn) / span; q = q > 0 ? (q < 1 ? q : 1) : 0; }
      }
    }
    sum += 1 + q;
  }
  if (r === UNIQUE && it.effect !== false) sum += 2; // the unique effect = one more line at q 1
  return core(iL, r, slot || it.slot || TYPE_SLOT[it.type] || it.type, (sum * 1e6 + 0.5) | 0);
}
function idPower(id, defs, slot) {
  const d = defs && own(defs, id) ? defs[id] : null, q = d && d.kind !== 'spell' ? d.equip : null;
  if (!q) return 0;
  const m = own(POWER_TIER_MAP, q.tier) ? POWER_TIER_MAP[q.tier] : POWER_TIER_MAP.worn;
  return core(m[0], m[1], slot || q.slot, (RARITY[m[1]].lines * (1 + POWER_UNROLLED_Q) * 1e6 + 0.5) | 0);
}

/** Power of one item: plain id (via defs), rolled instance, or a {id} holder (quiver). Empty / unknown -> 0. */
export function itemPower(itemOrId, defs, slot) {
  if (!itemOrId) return 0;
  if (typeof itemOrId === 'string') return idPower(itemOrId, defs, slot);
  if (typeof itemOrId !== 'object') return 0;
  if (itemOrId.iL !== undefined) return instancePower(itemOrId, slot);
  return typeof itemOrId.id === 'string' ? idPower(itemOrId.id, defs, slot) : 0;
}
/** Power of what is worn in `slot`: the rolled instance when `eq.rolled[slot].id === eq[slot]`, else the plain id. */
export function slotPower(eq, slot, defs) {
  if (!eq) return 0;
  const v = eq[slot], ro = eq.rolled && eq.rolled[slot];
  if (ro && v && ro.id === v) return instancePower(ro, slot);
  return itemPower(v, defs, slot);
}
/** Sum of item power over the worn slots (spells never count). */
export function itemPowerTotal(equipped, defs) {
  if (!equipped || typeof equipped !== 'object') return 0;
  let s = 0;
  for (let i = 0; i < SLOTS.length; i++) s += slotPower(equipped, SLOTS[i], defs);
  return s;
}
/** Spell power from a tiers object { spellId: level } (spellBook.tiers()) or any book with tier(id). Unknown ids count 0. */
export function spellPower(spells) {
  if (!spells || typeof spells !== 'object') return 0;
  const fn = typeof spells.tier === 'function';
  let s = 0;
  for (let i = 0; i < SPELL_IDS.length; i++) {
    const id = SPELL_IDS[i], t = fn ? spells.tier(id) : spells[id];
    if (t >= 1) s += SPELL_POWER[t >= 3 ? 3 : t | 0];
  }
  return s;
}
/** Player level 1..10 from total power (bands LEVEL_POWER). Negative / NaN / undefined -> 1. */
export function levelFromPower(p) {
  if (!(p >= 0)) return 1;
  let L = 1;
  while (L < MAX_LEVEL && p >= LEVEL_POWER[L]) L++;
  return L;
}
export function playerPower(spells, equipped, defs) { return itemPowerTotal(equipped, defs) + spellPower(spells); }
export function playerLevel(spells, equipped, defs) { return levelFromPower(playerPower(spells, equipped, defs)); }
/** D-069 gate input: level from ITEM power only (learning a spell can never open its own gate). */
export function itemLevel(equipped, defs) { return levelFromPower(itemPowerTotal(equipped, defs)); }
export const FIREBALL_GATE_LEVEL = 5;
export function fireballGateOpen(equipped, defs) { return itemLevel(equipped, defs) >= FIREBALL_GATE_LEVEL; }
/** Power needed for the next level, or -1 at level 10. */
export function nextLevelPower(p) { const L = levelFromPower(p); return L >= MAX_LEVEL ? -1 : LEVEL_POWER[L]; }

// ---- text (AC8): plain words, no "XP" anywhere ----
export function formatPower(n) {
  const v = Math.round(n > 0 ? n : n < 0 ? -n : 0), s = String(v);
  let out = '';
  for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += ','; out += s[i]; }
  return n < 0 && v > 0 ? '-' + out : out;
}
export const powerText = (n) => 'Power ' + formatPower(n);
/** Compare line vs the worn item of that slot: { text, tone: 'up'|'down'|'same' }. */
export function powerCompare(p, worn) {
  const d = p - worn;
  return d > 0 ? { text: 'Power +' + formatPower(d), tone: 'up' } : d < 0 ? { text: 'Power -' + formatPower(-d), tone: 'down' } : { text: 'Power same', tone: 'same' };
}
export const headerText = (total) => 'Power ' + formatPower(total) + ' - Level ' + levelFromPower(total);
export const breakdownText = (items, spells) => 'Gear ' + formatPower(items) + ' + Spells ' + formatPower(spells);
export function nextLevelText(total) { const n = nextLevelPower(total); return n < 0 ? 'Max level' : 'Next level at ' + formatPower(n); }
export const hudLevelText = (L) => 'Lv ' + L;
export const levelUpText = (L) => 'Level up! ' + L;
/** HPBAR-03 name tint of an enemy of `enemyLevel` vs the player level. */
export function enemyTint(enemyLevel, level) {
  const d = enemyLevel - level;
  return d <= -3 ? 'grey' : d < 0 ? 'green' : d === 0 ? 'white' : d <= 2 ? 'yellow' : 'red';
}
/** Zone hint for the zone you stand in (never a lock, D-078 / D-095). */
export function zoneHint(zoneLevel, level) {
  const d = zoneLevel - level;
  return d >= 2 ? 'Dangerous here' : d <= -2 ? 'Easy' : 'Fair';
}
