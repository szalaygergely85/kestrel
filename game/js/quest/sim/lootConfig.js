// game/js/quest/sim/lootConfig.js (US-091a2, docs/architecture.md 37.16.3). Gameplay numbers for the boar loot
// roll, kept in game code (37.16.4: "gameplay numbers stay in game/js/quest/*Config.js"); the designer's
// `ASSETS.items.loot.boar` carries the same defaults and the test checks the two never drift apart.

/** Corpse prompt text, `[E]` prefix included (crosshair.js highlights it). Writer placeholder (37.16.3). */
export const LOOT_PROMPT = {
  boar: '[E] Loot boar',
};

/**
 * The boar table. Roll order is fixed and always 5 draws (37.16.3): one per `entries` row (in order), then
 * the orb chance, then the orb kind (`int(kinds.length)`), so the stream shape never depends on the results.
 * `entries` stay in the corpse (index = the `corpseN` column); the orb goes on the ground (`spawnDrop`).
 */
export const LOOT_TABLE = {
  boar: {
    entries: [
      { item: 'boar.meat', chance: 1.00, n: 1 },
      { item: 'boar.hide', chance: 0.60, n: 1 },
      { item: 'boar.tusk', chance: 0.25, n: 1 },
    ],
    orb: { chance: 0.50, kinds: ['hp', 'mp'] },
  },
};

/** The loot RNG's own stream (37.16.3): XORed into the world nav seed so the beast wander RNG is never perturbed. */
export const LOOT_SEED_SALT = 0x10075;
