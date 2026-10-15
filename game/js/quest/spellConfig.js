import { SPELL_DEFS, SPELL_IDS } from './spellDefs.js';
// game/js/quest/spellConfig.js (SPELL-01a, docs/architecture.md 37.14). Pure data for the fireball sim (sim/fireball.js).
// Step counts are 60 Hz steps (seconds in comments), lengths in metres, speeds in m/s.
/** @type {Readonly<Record<string, any>>} */
const FB_BASE = Object.freeze({
  holdSteps: 36,   // 0.6 s: hold -> charge
  cooldown: 30,    // 0.5 s after a cast
  maxRange: 24,    // m, then the ball bursts in the air
  maxAlive: 4,
  hitPad: 0.2,     // m added to a target's radius and to both ends of its height
  aimMin: 0.5,     // m: aim point closer than this to the hand origin -> fly along the plain aim vector
  wallBack: 0.1,   // m: a wall burst centre sits this far in front of the wall (else LOS would block at t ~ 0)
  tap:     Object.freeze({ mana: 5,  speed: 16, radius: 2.0, damage: 3, knock: 6 }),
  charged: Object.freeze({ mana: 10, speed: 12, radius: 3.0, damage: 5, knock: 6 }),
  self: Object.freeze({ knockH: 6, knockV: 3 }), // player knockback at the blast centre (no damage), scaled by falloff
  // Hand mount in the eye frame (metres), = the designer's `ember` mount at rest (design/models/spell.js, D-042):
  // right 0.22, forward 0.50, down 0.135. The left hand uses -right.
  castOffset: Object.freeze({ right: 0.22, fwd: 0.50, down: 0.135 }),
});

// SPELL-04: per-tier fireball tables built from spellDefs (the single source of truth for tier numbers; tier 1 = FB_BASE.tap/charged
// exactly). speed/knock do not change with tier. FIREBALL_TIER_CFG[t] = { tap, charged } for t = 1..3 (index 0 unused = locked).
const _fb = SPELL_DEFS.fireball.tiers;
const _tierCfg = [null];
for (let i = 0; i < _fb.length; i++) {
  const r = _fb[i];
  _tierCfg.push(i === 0 ? Object.freeze({ tap: FB_BASE.tap, charged: FB_BASE.charged }) : Object.freeze({
    tap: Object.freeze({ mana: r.mana, speed: FB_BASE.tap.speed, radius: r.r, damage: r.dmg, knock: FB_BASE.tap.knock }),
    charged: Object.freeze({ mana: r.chargedMana, speed: FB_BASE.charged.speed, radius: r.chargedR, damage: r.chargedDmg, knock: FB_BASE.charged.knock }),
  }));
}
export const FIREBALL_TIER_CFG = Object.freeze(_tierCfg);
export const FIREBALL_CFG = Object.freeze({ ...FB_BASE, tiers: FIREBALL_TIER_CFG });

/** "Locked = tier 0" for every `spell.<id>` item, plus the mana potion until the fireball is learned. Refills `map` in place (0 alloc). */
const LOCK_KEYS = Object.freeze(SPELL_IDS.map((id) => 'spell.' + id)); // no string building per call
export function refreshLocked(map, tiers) {
  for (let i = 0; i < SPELL_IDS.length; i++) { const k = LOCK_KEYS[i]; if (tiers[SPELL_IDS[i]] > 0) delete map[k]; else map[k] = 1; }
  if (tiers.fireball > 0) delete map['potion.mp']; else map['potion.mp'] = 1;
  return map;
}
