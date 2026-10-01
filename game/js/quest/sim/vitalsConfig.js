// game/js/quest/sim/vitalsConfig.js (US-080a1, architecture.md 30.2). Pure data: every timer here is already an
// integer SIM step count (unlike beastConfig.js, nothing here needs `toSteps` - the AC gives steps directly).
// Rule 15 (game/js/quest/sim/**): no Math.random, no trig, no wall clock in this file.
export const VITALS_DEFAULTS = Object.freeze({
  startHp: 30,          // hp, player spawn/respawn HP
  maxHp: 30,             // hp, max HP
  invulnSteps: 60,       // steps, invulnerability window after any hit (1 s @ 60 Hz)
  beastDamageScale: 5,   // multiplies a combat:hit's `damage` when `source !== 'player'`
  fallThreshold6m: 6,    // m, fall damage starts strictly above this
  fallDamage6m: 5,       // hp, damage for a fall > fallThreshold6m (and <= fallThreshold10m)
  fallThreshold10m: 10,  // m, the bigger fall damage threshold
  fallDamage10m: 10,     // hp, damage for a fall > fallThreshold10m
  knockbackSpeed: 2,     // m/s, added to the player's body velocity away from the hit's source, once per hit
  sinkSteps: 48,         // steps, death timeline: sink phase length
  fadeSteps: 90,         // steps, death timeline: fade phase length (after sink, before cardReady)

  // ---- US-080b (mana) ----
  startMp: 20,           // mp, player spawn/respawn MP
  maxMp: 20,             // mp, max MP
  manaRegenSteps: 120,   // steps, +1 mp every this many steps while not paused (2 s @ 60 Hz)
  manaPauseSteps: 180,   // steps, regen pause after any spendMana (3 s @ 60 Hz)
});
