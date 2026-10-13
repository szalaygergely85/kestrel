// OB-109: "hold until farReady" state machine for the far-terrain bake. Pure (terrain + clock injected) so Node can test it.
// Boot: main.js loops hold.step() behind the boot card ('land' phase = last 40 % of the bar). Later world swaps
// (Continue / Load / Back to menu / restart): main.js freezes the sim and draws a small land card while hold.active.
export const HOLD_BUDGET_MS = 40; // per slice; the card repaints between slices (no sim, no world render while holding)

/** Bake progress 0..1 for the bar (1 once farReady). */
export function landFraction(terrain) {
  if (!terrain) return 1;
  return terrain.farReady ? 1 : Math.max(0, Math.min(1, terrain.bakeProgress));
}

/** @param {{budgetMs?: number}} [opts] */
export function createFarHold({ budgetMs = HOLD_BUDGET_MS } = {}) {
  const h = { active: false, terrain: null, frac: 1, slices: 0 };
  /** Start holding for `terrain`; stays inactive when there is nothing to bake. @returns {boolean} active */
  h.begin = (terrain) => {
    h.terrain = terrain || null; h.slices = 0;
    h.active = !!terrain && !terrain.farReady;
    h.frac = landFraction(terrain);
    return h.active;
  };
  /** One bake slice; releases the hold when farReady. @returns {boolean} still active */
  h.step = () => {
    if (!h.active) return false;
    h.terrain.bakeFarStep(budgetMs); h.slices++;
    h.frac = landFraction(h.terrain);
    if (h.terrain.farReady) h.active = false;
    return h.active;
  };
  return h;
}
