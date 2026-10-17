// ITEM-01: pure stat model over an equipment object. Not wired into combat (ITEM-04).
// Equipment = { main, ranged, off, head, body, cloak, hands, belt, legs, feet }, each null or an item instance:
//   { type, iL, r: rarityIdx, dmg: [min,max]?, armour: n?, a: [[affixId, value], ...], req: {str,dex,int}? }
// `dmg`/`armour` are the already-rarity-scaled base stats (ITEM-03 generates them).
import { STATS_CFG as C, AFFIX, RARITY, IL_MIN, IL_MAX, ALL_SLOTS, REQ_ATTR, REQ_BASE, REQ_PER_IL, REQ_UNIQUE_MAX, REQ_UNMET_MUL, ATTR_NAME } from './statsConfig.js';

export { weaponRng as createStatsRng } from './weaponLoot.js'; // seeded mulberry32 stream (no Math.random)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Affix range [min,max] at item level iL (linear between iL1 and iL10). Writes into `out` (length 2). */
export function affixRange(id, iL, out = [0, 0]) {
  const d = AFFIX[id], t = (clamp(iL, IL_MIN, IL_MAX) - IL_MIN) / (IL_MAX - IL_MIN);
  out[0] = d.lo[0] + (d.hi[0] - d.lo[0]) * t;
  out[1] = d.lo[1] + (d.hi[1] - d.lo[1]) * t;
  return out;
}

/** One affix value: uniform in its range at iL, from rng() in [0,1). Integer affixes round. */
export function rollAffix(id, iL, rng) {
  const r = affixRange(id, iL), d = AFFIX[id];
  const v = r[0] + (r[1] - r[0]) * rng();
  return d.int ? Math.round(v) : v;
}

/** Armour damage reduction for total armour A vs attacker level L: A/(A+40+20L), cap 60 %. */
export function armourReduction(A, L) {
  if (!(A > 0)) return 0;
  const r = A / (A + C.armour.k0 + C.armour.kPerLevel * L);
  return r > C.armour.cap ? C.armour.cap : r;
}

export function createTotals() {
  return {
    str: 0, dex: 0, int: 0, hp: 0, mana: 0, armour: 0,
    dmgPct: 0, dmgFlat: 0, critChance: 0, critMult: 0, atkSpeed: 0, lifeOnHit: 0,
    moveSpeed: 0, blockPct: 0, drawSpeed: 0, manaRegen: 0,
    mainMin: 0, mainMax: 0, bowMin: 0, bowMax: 0, fireDmgMul: 1,
  };
}

/** Sum an equipment object into `out` (reused, ~0 alloc after the first call). Attribute bonuses count per point above base 5. */
export function computeTotals(eq, out = createTotals()) {
  let str = C.attrBase, dex = C.attrBase, int = C.attrBase;
  let hp = 0, mana = 0, armFlat = 0, armPct = 0, dmgPct = 0, dmgFlat = 0, critC = 0, critD = 0;
  let atk = 0, life = 0, move = 0, block = 0;
  for (let s = 0; s < ALL_SLOTS.length; s++) {
    const it = eq ? eq[ALL_SLOTS[s]] : null;
    if (!it) continue;
    if (it.armour) armFlat += it.armour;
    const a = it.a;
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const v = a[i][1];
      switch (a[i][0]) {
        case 'A1': dmgPct += v; break;   case 'A2': dmgFlat += v; break;
        case 'A3': critC += v; break;    case 'A4': critD += v; break;
        case 'A5': atk += v; break;      case 'A6': armFlat += v; break;
        case 'A7': armPct += v; break;   case 'A8': str += v; break;
        case 'A9': dex += v; break;      case 'A10': int += v; break;
        case 'A11': hp += v; break;      case 'A12': mana += v; break;
        case 'A13': life += v; break;    case 'A14': move += v; break;
        case 'A15': block += v; break;
      }
    }
  }
  const sB = str - C.attrBase, dB = dex - C.attrBase, iB = int - C.attrBase;
  out.str = str; out.dex = dex; out.int = int;
  out.hp = C.baseHp + hp;
  out.mana = C.baseMana + mana + iB * C.int.mana;
  out.armour = armFlat * (1 + armPct);
  out.dmgPct = dmgPct; out.dmgFlat = dmgFlat; out.atkSpeed = atk; out.lifeOnHit = life;
  out.critChance = Math.min(C.crit.chanceCap, C.crit.chance + critC + dB * C.dex.critPct);
  out.critMult = C.crit.mult + critD;
  out.moveSpeed = Math.min(C.moveSpeedCap, move);
  out.blockPct = Math.min(C.str.blockCap, block + sB * C.str.blockStamPct);
  out.drawSpeed = Math.min(C.dex.drawCap, dB * C.dex.drawPct);
  out.manaRegen = iB * C.int.manaRegenPct;
  out.fireDmgMul = 1 + iB * C.int.fireDmgPct;
  const m = eq && eq.main, b = eq && eq.ranged;
  const meleeMul = (1 + sB * C.str.dmgPct) * (1 + dmgPct), bowMul = (1 + dB * C.dex.bowDmgPct) * (1 + dmgPct);
  out.mainMin = m && m.dmg ? m.dmg[0] * meleeMul + dmgFlat : 0;
  out.mainMax = m && m.dmg ? m.dmg[1] * meleeMul + dmgFlat : 0;
  out.bowMin = b && b.dmg ? b.dmg[0] * bowMul + dmgFlat : 0;
  out.bowMax = b && b.dmg ? b.dmg[1] * bowMul + dmgFlat : 0;
  return out;
}

/** Legacy hard check (D-089), all three attributes; ITEM-09 equip rule is the soft one below (meetsReq / reqMul). */
export function meetsRequirement(item, totals) {
  const q = item && item.req;
  if (!q) return true;
  return totals.str >= (q.str || 0) && totals.dex >= (q.dex || 0) && totals.int >= (q.int || 0);
}

/** req(iL) = 5 + floor(0.9 x (iL - 1)): iL1-2 -> 5, iL5 -> 8, iL9 -> 12, iL10 -> 13. */
export function reqValue(iL) {
  return REQ_BASE + Math.floor(REQ_PER_IL * (clamp(iL | 0, IL_MIN, IL_MAX) - IL_MIN));
}

/** Requirement of an item as 'str'|'dex'|'int' + value, or null (armour etc.). Uniques/legacy: item.req = {str|dex|int: n}, max 13. */
export function itemReqAttr(item) {
  if (!item) return null;
  const q = item.req;
  if (q) return q.str ? 'str' : q.dex ? 'dex' : q.int ? 'int' : null;
  return REQ_ATTR[item.type] || null;
}
export function itemReqValue(item) {
  const a = itemReqAttr(item);
  if (!a) return 0;
  const q = item.req;
  if (q) { const v = q[a] || 0; return v > REQ_UNIQUE_MAX ? REQ_UNIQUE_MAX : v; }
  return reqValue(item.iL);
}

/** True when the wearer's totals reach the item's requirement (no requirement = true). 0 alloc. */
export function meetsReq(totals, item) {
  const a = itemReqAttr(item);
  return !a || totals[a] >= itemReqValue(item);
}

/** Damage / armour multiplier for an item at these totals: 1 when met, 0.5 when not (live, nothing is blocked). */
export function reqMul(totals, item) {
  return meetsReq(totals, item) ? 1 : REQ_UNMET_MUL;
}

/** Card line: { text: 'Needs DEX 12', met: bool } (red when unmet, green/normal when met) or null if no requirement. */
export function reqHint(totals, item) {
  const a = itemReqAttr(item);
  if (!a) return null;
  return { text: 'Needs ' + ATTR_NAME[a] + ' ' + itemReqValue(item), met: totals[a] >= itemReqValue(item) };
}

/**
 * One weapon hit. `ranged` picks bow vs main range. u1 = damage roll, u2 = crit roll (uniform [0,1)).
 * Writes out.dmg / out.crit / out.life, returns out. 0 alloc (primitives only).
 */
export function rollHit(totals, ranged, u1, u2, out) {
  const lo = ranged ? totals.bowMin : totals.mainMin, hi = ranged ? totals.bowMax : totals.mainMax;
  let d = lo + (hi - lo) * u1;
  const crit = u2 < totals.critChance;
  if (crit) d *= totals.critMult;
  out.dmg = d; out.crit = crit; out.life = totals.lifeOnHit;
  return out;
}

export { RARITY };
