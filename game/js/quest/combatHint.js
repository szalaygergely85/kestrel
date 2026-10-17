// game/js/quest/combatHint.js (COMBAT-HINT-01). First-fight hint: shown once per save at the first beast
// engagement. Text = uiStyle.storyHints 'combatDodge' (design/models/title.js, story.md hint.combat.dodge).
// "Once per save" = hints.js `hints.shown` in world.state (saved with the world). No beast:aggro event exists,
// so this polls the sim state array (read-only, no allocation). Host calls stepCombatHint once per fixed step.
import { request } from './hints.js';
import { STATE_CHASE, STATE_WINDUP, STATE_CHARGE } from './sim/beastSim.js';

export const COMBAT_HINT_ID = 'combatDodge';

/** True while any live beast is chasing, winding up or charging (engaged with the player). */
export function beastEngaged(sim) {
  const st = sim.state, n = sim.count !== undefined ? sim.count : st.length;
  for (let i = 0; i < n; i++) {
    const s = st[i];
    if (s === STATE_CHASE || s === STATE_WINDUP || s === STATE_CHARGE) return true;
  }
  return false;
}

/** One fixed step: requests the hint at the first engagement; hints.js drops it once shown/done. */
export function stepCombatHint(world, uiStyle, sim) {
  const shown = world.state['hints.shown'];
  if (Array.isArray(shown) && shown.includes(COMBAT_HINT_ID)) return; // cheap early-out after the first time
  if (beastEngaged(sim)) request(world, uiStyle, COMBAT_HINT_ID);
}
