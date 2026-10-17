// ITEM-01 (D-081/D-084/D-089): classic RPG stat model data. Numbers x~10 vs the old tier table.
// Pure data, no imports. Item level iL = 1..10; every affix range is linear in iL between its iL1 and iL10 range.
export const IL_MIN = 1, IL_MAX = 10;

export const STATS_CFG = {
  attrBase: 5,                       // STR / DEX / INT base
  // per point ABOVE base (base 5 gives no bonus; gear +STR etc. raises the bonus)
  str: { dmgPct: 0.02, blockStamPct: 0.01, blockCap: 0.40 },
  dex: { bowDmgPct: 0.02, drawPct: 0.01, drawCap: 0.50, critPct: 0.002 },
  int: { fireDmgPct: 0.03, mana: 2, manaRegenPct: 0.01 },
  crit: { chance: 0.05, mult: 1.5, chanceCap: 0.50 },
  armour: { k0: 40, kPerLevel: 20, cap: 0.60 }, // DR = A / (A + 40 + 20 L), cap 60 %
  baseHp: 100, baseMana: 100,
  moveSpeedCap: 0.15,
};

// Affix ids A1..A15. `lo`/`hi` = [min,max] range at iL1 / iL10. `int` = value rounds to an integer.
// `on` = slot groups allowed (weapon = main|ranged, armour = head|body|cloak|hands|belt|legs|feet, shield = off,
// or a single slot name, 'all').
export const AFFIX = {
  A1:  { key: 'dmgPct',     lo: [0.05, 0.10], hi: [0.25, 0.40], on: ['weapon'] },
  A2:  { key: 'dmgFlat',    lo: [1, 3],       hi: [8, 14],      on: ['weapon'], int: true },
  A3:  { key: 'critChance', lo: [0.01, 0.02], hi: [0.04, 0.06], on: ['weapon', 'hands', 'head'] },
  A4:  { key: 'critDmg',    lo: [0.10, 0.15], hi: [0.30, 0.50], on: ['weapon', 'hands'] },
  A5:  { key: 'atkSpeed',   lo: [0.03, 0.05], hi: [0.10, 0.15], on: ['weapon', 'hands'] },
  A6:  { key: 'armourFlat', lo: [2, 4],       hi: [20, 35],     on: ['armour', 'shield'], int: true },
  A7:  { key: 'armourPct',  lo: [0.05, 0.10], hi: [0.20, 0.30], on: ['armour', 'shield'] },
  A8:  { key: 'str',        lo: [1, 2],       hi: [6, 9],       on: ['all'], int: true },
  A9:  { key: 'dex',        lo: [1, 2],       hi: [6, 9],       on: ['all'], int: true },
  A10: { key: 'int',        lo: [1, 2],       hi: [6, 9],       on: ['all'], int: true },
  A11: { key: 'hp',         lo: [5, 10],      hi: [40, 60],     on: ['armour', 'shield', 'belt'], int: true },
  A12: { key: 'mana',       lo: [5, 10],      hi: [30, 50],     on: ['armour', 'cloak'], int: true },
  A13: { key: 'lifeOnHit',  lo: [1, 1],       hi: [4, 6],       on: ['weapon'], int: true },
  A14: { key: 'moveSpeed',  lo: [0.03, 0.05], hi: [0.08, 0.10], on: ['feet'] },
  A15: { key: 'blockPct',   lo: [0.05, 0.08], hi: [0.15, 0.20], on: ['shield'] },
};
export const AFFIX_IDS = Object.keys(AFFIX);

export const WEAPON_SLOTS = ['main', 'ranged'];
export const ARMOUR_SLOTS = ['head', 'body', 'cloak', 'hands', 'belt', 'legs', 'feet'];
export const ALL_SLOTS = ['main', 'ranged', 'off', ...ARMOUR_SLOTS];

// Rarity: bonus line count + base-stat multiplier (colour = palette key, UI side).
export const RARITY = [
  { id: 'common', name: 'Common', color: 'white',  lines: 0, base: 1.00 },
  { id: 'magic',  name: 'Magic',  color: 'blue',   lines: 1, base: 1.05 },
  { id: 'rare',   name: 'Rare',   color: 'yellow', lines: 2, base: 1.10 },
  { id: 'epic',   name: 'Epic',   color: 'purple', lines: 3, base: 1.15 },
  { id: 'unique', name: 'Unique', color: 'orange', lines: 0, base: 1.00 }, // hand-made, fixed lines
];

// Base weapon damage by iL (sword): (4+2iL)-(7+3iL). Other types scale by this multiplier.
export const WEAPON_MUL = { sword: 1, axe: 1.25, spear: 0.9, bow: 0.9 };

// ITEM-09 (D-091): attribute requirement = primary attribute only. req(iL) = 5 + floor(0.9 * (iL - 1)).
// Armour, shield, cloak, belt, boots: none. Uniques are hand-set (item.req), capped at REQ_UNIQUE_MAX.
export const REQ_ATTR = { sword: 'str', axe: 'str', spear: 'str', bow: 'dex', fireball: 'int', staff: 'int' };
export const REQ_BASE = 5, REQ_PER_IL = 0.9, REQ_UNIQUE_MAX = 13;
export const REQ_UNMET_MUL = 0.5; // not meeting the requirement: -50 % damage / armour (no hard block)
export const ATTR_NAME = { str: 'STR', dex: 'DEX', int: 'INT' };

// PLAYER-LEVEL-01 v2 (D-116, D-084): power score tables (docs/epics/ep-items-stats.md "PLAYER-LEVEL-01 v2").
// itemPower = round10(POWER_BASE x iL^2 x slot weight x (rarity factor + 0.1 x sum over lines (1 + q))).
export const POWER_BASE = 20;
export const POWER_SLOT_WEIGHT = Object.freeze({ main: 3, body: 3, off: 2, ranged: 2, head: 2, legs: 2, hands: 1, feet: 1, cloak: 1, belt: 1, quiver: 0 });
export const POWER_RARITY = Object.freeze([1.00, 1.05, 1.10, 1.15, 1.25]); // index = RARITY index (common..unique)
export const POWER_LINE = 0.1;                       // a line adds 0.1 x (1 + q), q = roll quality 0..1
export const POWER_UNROLLED_Q = 0.5;                 // plain gear without an instance: its lines count q 0.5
// plain tier gear (no rolled instance) -> [iL, rarity index]
export const POWER_TIER_MAP = Object.freeze({ worn: [1, 0], sturdy: [2, 1], fine: [4, 1], tempered: [6, 2], warden: [8, 2] });
export const SPELL_POWER = Object.freeze([0, 250, 600, 1000]); // total power of one spell at level 0..3 (higher clamps to 3)
// player level L (1..10) starts at LEVEL_POWER[L - 1]
export const LEVEL_POWER = Object.freeze([0, 1000, 2500, 5000, 8000, 12000, 17000, 22000, 28000, 35000]);
