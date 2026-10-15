// EP-SPELLS (SPELL-01): pure data for the 7 spells (docs/epics/ep-spells.md section 2). No logic, no imports.
// Each spell: name (plain, player-facing), branch, root (first of its branch), glyph, color key (palette/UI colour name),
// maxTier 3, tiers[0..2] = numbers for level 1..3 (mana, cd in s, plus spell-specific fields).
const T = (a) => Object.freeze(a.map((r) => Object.freeze(r)));
export const BRANCHES = Object.freeze(['fire', 'light', 'wind']);
export const BRANCH_TITLES = Object.freeze({ fire: 'Fire', light: 'Light', wind: 'Wind' });
export const BRANCH_COLOR = Object.freeze({ fire: 'ember', light: 'aether', wind: 'gust' });
export const MAX_TIER = 3;

export const SPELL_DEFS = Object.freeze({
  fireball: Object.freeze({
    name: 'Fireball', branch: 'fire', root: true, glyph: '*', color: 'ember', maxTier: 3,
    tiers: T([
      { mana: 5, cd: 0.5, dmg: 3, r: 2.0, chargedMana: 10, chargedDmg: 5, chargedR: 3.0 },
      { mana: 5, cd: 0.5, dmg: 4, r: 2.0, chargedMana: 10, chargedDmg: 7, chargedR: 3.5 },
      { mana: 5, cd: 0.5, dmg: 5, r: 2.0, chargedMana: 9, chargedDmg: 9, chargedR: 4.0 },
    ]),
  }),
  fireRing: Object.freeze({
    name: 'Fire Ring', branch: 'fire', root: false, glyph: '*', color: 'ember', maxTier: 3,
    tiers: T([{ mana: 8, cd: 4, r: 3.0, dmg: 4, knock: 8 }, { mana: 8, cd: 3.5, r: 3.5, dmg: 6, knock: 8 }, { mana: 7, cd: 3, r: 4.0, dmg: 8, knock: 10 }]),
  }),
  spark: Object.freeze({
    name: 'Spark', branch: 'light', root: true, glyph: '+', color: 'aether', maxTier: 3,
    tiers: T([{ mana: 4, cd: 1.5, dmg: 1, stun: 0.8, speed: 30, range: 20, pad: 0.2, knock: 2, alive: 2 }, { mana: 4, cd: 1.2, dmg: 2, stun: 1.2, speed: 30, range: 20, pad: 0.2, knock: 2, alive: 2 }, { mana: 3, cd: 1.0, dmg: 3, stun: 1.6, speed: 30, range: 20, pad: 0.2, knock: 2, alive: 2 }]),
  }),
  lightOrb: Object.freeze({
    name: 'Light Orb', branch: 'light', root: false, glyph: 'o', color: 'aether', maxTier: 3,
    tiers: T([{ mana: 6, cd: 1, dur: 30, lightR: 8, keepOutLevel: 3, flee: 0, height: 2.2 }, { mana: 6, cd: 1, dur: 45, lightR: 10, keepOutLevel: 5, flee: 0, height: 2.2 }, { mana: 5, cd: 1, dur: 60, lightR: 12, keepOutLevel: 7, flee: 2, height: 2.2 }]),
  }),
  ward: Object.freeze({
    name: 'Ward', branch: 'light', root: false, glyph: 'o', color: 'aether', maxTier: 3,
    tiers: T([{ mana: 8, cd: 12, absorb: 10, dur: 8 }, { mana: 8, cd: 10, absorb: 18, dur: 8 }, { mana: 7, cd: 8, absorb: 26, dur: 10 }]),
  }),
  gust: Object.freeze({
    name: 'Gust', branch: 'wind', root: true, glyph: '~', color: 'gust', maxTier: 3,
    tiers: T([{ mana: 5, cd: 2, range: 6, knock: 10, dmg: 0, stagger: 0.4 }, { mana: 5, cd: 1.8, range: 7, knock: 13, dmg: 1, stagger: 0.6 }, { mana: 4, cd: 1.5, range: 8, knock: 16, dmg: 2, stagger: 0.8 }]),
  }),
  updraft: Object.freeze({
    name: 'Updraft', branch: 'wind', root: false, glyph: '^', color: 'gust', maxTier: 3,
    tiers: T([{ mana: 6, cd: 5, height: 4, fallGravity: 0.4, slowFall: 1.5 }, { mana: 5, cd: 4, height: 5, fallGravity: 0.4, slowFall: 1.8 }, { mana: 4, cd: 3, height: 6, fallGravity: 0.4, slowFall: 2.2 }]),
  }),
});
/** Spell ids in tree order (branch by branch, root first). */
export const SPELL_IDS = Object.freeze(['fireball', 'fireRing', 'spark', 'lightOrb', 'ward', 'gust', 'updraft']);
