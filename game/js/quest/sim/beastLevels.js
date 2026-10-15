// OB-150 (owner: "game is too easy"): the ONE table for enemy strength by zone level (band 1-10, tower side 1-5, far side 5-10)
// and difficulty. beastSim reads levelScale() once at create; hits-to-kill numbers are pinned by beastLevels.test.js.
// Pure + deterministic (rule 15). Base hp/damage come from beastConfig/species tuning; this only multiplies them.
import { resolveDifficulty } from './difficulty.js';

export const LEVEL_TABLE = Object.freeze({
  hpPerLevel: 0.25,    // hp x (1 + 0.25 * (lv - 1)): lv1 x1, lv5 x2, lv10 x3.25
  dmgPerLevel: 0.12,   // damage x (1 + 0.12 * (lv - 1)): lv1 x1, lv5 x1.48, lv8 x1.84, lv10 x2.08
  tierLevel: Object.freeze([1, 1, 5, 9]), // an explicit placed `brain.tier` 1..3 (no band) -> representative level (index = tier)
});

export function levelHpMul(lv) { return 1 + LEVEL_TABLE.hpPerLevel * (Math.max(1, lv) - 1); }
export function levelDmgMul(lv) { return 1 + LEVEL_TABLE.dmgPerLevel * (Math.max(1, lv) - 1); }

/** {hp, damage} multipliers for a zone level and a difficulty name (unknown -> normal). Cold path (create time). */
export function levelScale(lv, difficulty) {
  const d = resolveDifficulty(difficulty);
  return { hp: levelHpMul(lv) * d.hp, damage: levelDmgMul(lv) * d.dmg };
}
