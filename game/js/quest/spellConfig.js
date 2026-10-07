// game/js/quest/spellConfig.js (SPELL-01a, docs/architecture.md 37.14). Pure data for the fireball sim (sim/fireball.js).
// Step counts are 60 Hz steps (seconds in comments), lengths in metres, speeds in m/s.
/** @type {Readonly<Record<string, any>>} */
export const FIREBALL_CFG = Object.freeze({
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
