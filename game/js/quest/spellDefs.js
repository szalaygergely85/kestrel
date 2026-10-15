// EP-SPELLS (SPELL-01, SPELL-R1 / D-115): pure data for the four spells of D-021 (docs/epics/ep-spells.md section 2). No logic, no imports.
// Each spell: name (plain, player-facing), glyph, color key (palette/UI colour name), maxTier 3, tiers[0..2] = numbers for level 1..3
// (mana, cd in s, plus spell-specific fields). Freeze/Telekinesis/Teleport casts arrive in SPELL-R2..R4 (dispatcher: notImplemented until then).
const T = (a) => Object.freeze(a.map((r) => Object.freeze(r)));
export const MAX_TIER = 3;

export const SPELL_DEFS = Object.freeze({
  fireball: Object.freeze({
    name: 'Fireball', glyph: '*', color: 'ember', maxTier: 3,
    tiers: T([
      { mana: 5, cd: 0.5, dmg: 3, r: 2.0, chargedMana: 10, chargedDmg: 5, chargedR: 3.0 },
      { mana: 5, cd: 0.5, dmg: 4, r: 2.0, chargedMana: 10, chargedDmg: 7, chargedR: 3.5 },
      { mana: 5, cd: 0.5, dmg: 5, r: 2.0, chargedMana: 9, chargedDmg: 9, chargedR: 4.0 },
    ]),
  }),
  // Freeze: ice bolt, `stun` = freeze seconds (beastSim stun path), level 3 also freezes up to `splash` more beasts within `splashR` m.
  freeze: Object.freeze({
    name: 'Freeze', glyph: '+', color: 'aether', maxTier: 3,
    tiers: T([
      { mana: 5, cd: 2.0, dmg: 1, stun: 1.5, speed: 24, range: 18, pad: 0.2, knock: 0, alive: 2, splash: 0, splashR: 0 },
      { mana: 5, cd: 1.8, dmg: 2, stun: 2.5, speed: 24, range: 20, pad: 0.2, knock: 0, alive: 2, splash: 0, splashR: 0 },
      { mana: 4, cd: 1.5, dmg: 3, stun: 3.5, speed: 24, range: 22, pad: 0.2, knock: 0, alive: 2, splash: 2, splashR: 2.5 },
    ]),
  }),
  // Telekinesis: push/pull; level 3 adds lift-and-throw (hold up to `hold` s, throw at `throwSpeed`, impact `throwDmg`; SPELL-R7).
  telekinesis: Object.freeze({
    name: 'Telekinesis', glyph: '~', color: 'gust', maxTier: 3,
    tiers: T([
      { mana: 4, cd: 1.5, range: 8, knock: 12, stagger: 0.5, dmg: 0, wallDmg: 0, hold: 0, throwSpeed: 0, throwDmg: 0 },
      { mana: 4, cd: 1.2, range: 12, knock: 16, stagger: 0.8, dmg: 0, wallDmg: 3, hold: 0, throwSpeed: 0, throwDmg: 0 },
      { mana: 6, cd: 3.0, range: 12, knock: 16, stagger: 0.8, dmg: 0, wallDmg: 3, hold: 3, throwSpeed: 14, throwDmg: 6 },
    ]),
  }),
  // Teleport: blink along the aim, `dist` max metres, `rise` max height gain (SPELL-R4, needs the architect note).
  teleport: Object.freeze({
    name: 'Teleport', glyph: '*', color: 'aether', maxTier: 3,
    tiers: T([
      { mana: 8, cd: 6, dist: 8, rise: 0.6, loseTrack: 0 },
      { mana: 7, cd: 5, dist: 12, rise: 1.5, loseTrack: 0 },
      { mana: 6, cd: 4, dist: 16, rise: 3.0, loseTrack: 2, loseTrackR: 6 },
    ]),
  }),
});
/** Spell ids in learn order. */
export const SPELL_IDS = Object.freeze(['fireball', 'freeze', 'telekinesis', 'teleport']);
