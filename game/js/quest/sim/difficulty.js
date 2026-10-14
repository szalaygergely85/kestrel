// BEAST-06a (arch 38.64 item 9): the ONLY holder of difficulty multipliers (epic table 4). resolveDifficulty returns frozen numbers;
// applyDifficulty pushes them to tactics (tokM) and the spawn director (timers). HP/group size apply on the next spawn.
// A setting change is refused while anything is engaged. TODO (BEAST-05/06b): per-slot notice/leash/windup step counts in beastSim,
// and the player-damage hook (playerDmg) in the game's damage entry.
const D = (o) => Object.freeze(o);
export const DIFFICULTY = D({
  easy: D({ name: 'easy', hp: 0.7, dmg: 0.6, playerDmg: 0.75, noticeR: 0.8, noticeSec: 1.0, windup: 1.25, tokM: 1, flank: 0, leash: 0.7, groupDelta: -1, eliteChance: 0, respawn: 1.5, gear: 1.0 }),
  normal: D({ name: 'normal', hp: 1.0, dmg: 1.0, playerDmg: 1.0, noticeR: 1.0, noticeSec: 0.6, windup: 1.0, tokM: 2, flank: 1, leash: 1.0, groupDelta: 0, eliteChance: 0, respawn: 1.0, gear: 1.0 }),
  hard: D({ name: 'hard', hp: 1.4, dmg: 1.35, playerDmg: 1.25, noticeR: 1.2, noticeSec: 0.4, windup: 0.85, tokM: 3, flank: 2, leash: 1.5, groupDelta: 1, eliteChance: 0.25, respawn: 0.7, gear: 1.2 }),
});
export const WINDUP_FLOOR_SEC = 0.4;
/** Unknown / missing name -> normal. */
export function resolveDifficulty(name) { return DIFFICULTY[name] || DIFFICULTY.normal; }

/** Apply to a running sim (+ optional director). Returns false (nothing changed) while any slot is engaged. */
export function applyDifficulty(sim, name, director) {
  const d = resolveDifficulty(name);
  if (sim && sim.tactics && (sim.tactics.nM > 0 || sim.tactics.nR > 0)) return false; // engaged = anyone holds an attack token (no engaged counter until 06b)
  if (sim && sim.tactics && sim.tactics.setDifficulty) sim.tactics.setDifficulty(d.name);
  if (sim) sim.difficulty = d;
  if (director) director.setDifficulty(d);
  return true;
}
