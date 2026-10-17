// game/js/quest/sim/lootConfig.js (US-091a2, docs/architecture.md 37.16.3). Gameplay numbers for the boar loot
// roll, kept in game code (37.16.4: "gameplay numbers stay in game/js/quest/*Config.js"); the designer's
// `ASSETS.items.loot.boar` carries the same defaults and the test checks the two never drift apart.

/** Corpse prompt text, `[E]` prefix included (crosshair.js highlights it). Writer placeholder (37.16.3). */
export const LOOT_PROMPT = {
  boar: '[E] Loot boar',
  goblin: '[E] Loot goblin', // GOB-05 placeholder (writer)
  bear: '[E] Loot bear', // BEAR-01 placeholder (writer); bears use the boar table (same kill/loot path)
};

/**
 * EQ-10: the boar table, mirrors content/items/loot.json `sources.boar` (a test keeps the two equal) + the old hp/mp orb.
 * Per death: for every `rolls` row exactly 3 draws (chance, b, c) in order, whatever the result (stream shape fixed
 * per table), then the 2 orb draws. A `pick.gear` hit turns b into the tier (cumulative `tiers`) and c into the
 * slot (uniform over `slots`); a `give` hit turns b into n in min..max. `fixed` always drops. Gear never goes into the
 * corpse: it spawns as a world pickup (pickups.js spawnItemDrop). Corpse entries = fixed + give rolls (<= MAX_ENTRIES).
 */
export const LOOT_TIERS = { worn: 0.7, sturdy: 0.25, fine: 0.05 };
export const LOOT_SLOTS = ['head', 'body', 'cloak', 'hands', 'belt', 'legs', 'feet'];
export const LOOT_TABLE = {
  boar: {
    rolls: [
      { chance: 0.04, pick: { gear: true } },
      { chance: 0.2, give: { item: 'arrow', min: 3, max: 5 } },
    ],
    fixed: [{ item: 'boar.meat', n: 1 }],
    coin: { chance: 0.10, min: 1, max: 5 }, // CUR-06: straight to the wallet through the seeded loot RNG (CUR-01 pays it)
    orb: { chance: 0.50, kinds: ['hp', 'mp'] },
  },
  // GOB-05 (38.57 (5)): no fixed drops; arrow 2-4 (0.3), goblin.trinket x1 (0.25, a sell item, icon NEEDS DESIGNER), orb 0.4.
  goblin: {
    rolls: [
      { chance: 0.3, give: { item: 'arrow', min: 2, max: 4 } },
      { chance: 0.25, give: { item: 'goblin.trinket', min: 1, max: 1 } },
    ],
    fixed: [],
    coin: { chance: 0.10, min: 1, max: 5 }, // CUR-06
    orb: { chance: 0.40, kinds: ['hp', 'mp'] },
  },
};

/** CUR-06: elite beasts (respawning, D-120) drop 10-20 coin on EVERY kill; loot.js emits coin:drop for the CUR-01 wallet. */
export const ELITE_COIN = { chance: 1, min: 10, max: 20 };

/** The loot RNG's own stream (37.16.3): XORed into the world nav seed so the beast wander RNG is never perturbed. */
export const LOOT_SEED_SALT = 0x10075;

/** S8-C-06: default chest interaction; facingCos is cos(70 degrees), precomputed for the sim. */
export const CHEST_DEFAULTS = {
  openSeconds: 0.6, radius: 1.6, facingDeg: 70, facingCos: 0.3420201433256687,
  prompt: '[E] Open chest',
};
