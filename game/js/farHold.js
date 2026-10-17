// OB-109: "hold until farReady" state machine for the far-terrain bake. Pure (terrain + clock injected) so Node can test it.
// Boot: main.js loops hold.step() behind the boot card ('land' phase = last 40 % of the bar). Later world swaps
// (Continue / Load / Back to menu / restart): main.js freezes the sim and draws a small land card while hold.active.
export const BAND_BUDGET_MS = 12; // OB109-B3: prebakeBands(ms) per bar frame
export const HOLD_BUDGET_MS = 40; // per slice; the card repaints between slices (no sim, no world render while holding)

/** Bake progress 0..1 for the bar (1 once farReady). */
export function landFraction(terrain) {
  if (!terrain) return 1;
  return terrain.farReady ? 1 : Math.max(0, Math.min(1, terrain.bakeProgress));
}

/** Bar value: far bake fills 0..0.5 and the band pre-bake 0.5..1 when a pre-bake follows (OB109-B3), else far bake = 0..1. */
export function landBarFraction(farFrac, bandFrac, withBands) {
  return withBands ? 0.5 * farFrac + 0.5 * bandFrac : farFrac;
}

/** @param {{budgetMs?: number}} [opts] */
export function createFarHold({ budgetMs = HOLD_BUDGET_MS } = {}) {
  const h = { active: false, terrain: null, world: null, bands: null, frac: 1, slices: 0 };
  /** Start holding for `terrain`; stays inactive when there is nothing to bake. @returns {boolean} active */
  h.begin = (terrain, world) => {
    h.terrain = terrain || null; h.slices = 0;
    h.world = world && world.prebakeBands ? world : null; h.bands = null;
    if (h.world) { h.bands = h.world.prebakeBands(0); if (h.bands.done) { h.world = null; h.bands = null; } } // OB109-B3: zones still to pre-bake
    h.active = (!!terrain && !terrain.farReady) || !!h.world;
    h.frac = h.world ? landBarFraction(landFraction(terrain), h.bands.cached / Math.max(1, h.bands.total), true) : landFraction(terrain);
    return h.active;
  };
  /** One bake slice; releases the hold when farReady. @returns {boolean} still active */
  h.step = () => {
    if (!h.active) return false;
    h.slices++;
    if (!h.terrain.farReady) h.terrain.bakeFarStep(budgetMs);
    else if (h.world) { h.bands = h.world.prebakeBands(BAND_BUDGET_MS); if (h.bands.done) h.world = null; }
    const bf = h.world ? h.bands.cached / Math.max(1, h.bands.total) : 1;
    h.frac = landBarFraction(landFraction(h.terrain), bf, !!h.world || h.bands !== null);
    if (h.terrain.farReady && !h.world) { h.active = false; h.frac = 1; }
    return h.active;
  };
  return h;
}
