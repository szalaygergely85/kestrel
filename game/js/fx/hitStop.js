// HITSTOP-01 (lane B1): hit-stop on the beast + sword sims only. Pure, deterministic, zero allocation.
// The render, camera, UI and the player's own physics never see this: main.js gates ONLY beasts.step / sword.step
// through `due(dtMs)` (a fixed-step accumulator over scale()). Note: the sword sim keeps its own 'frozen' counter
// (hitStopHard) for the swing animation; this one is the shared beast+sword freeze.
// OWNER: window lengths are the PO proposal (US-082: 50-80 ms), owner decision pending. Cap 120 ms.
export const HEAVY_MS = 70;
export const LIGHT_MS = 50;
export const CAP_MS = 120;

export function hitStopEnabled(params, captureLike) {
  // off in capture/bench (incl. ?bench=combat, COMBAT-BENCH-01 stays unfrozen)/gpucompare/cinematic and under ?fx=0
  return !captureLike && params.get('capture') !== '1' && params.get('fx') !== '0' && params.get('bench') !== 'combat';
}

export function createHitStop(opts = {}) {
  const heavyMs = opts.heavyMs ?? HEAVY_MS, lightMs = opts.lightMs ?? LIGHT_MS, capMs = opts.capMs ?? CAP_MS;
  const enabled = opts.enabled !== false;
  let remaining = 0, acc = 0;
  return {
    /** kind 'heavy' | anything else = light. Stacks up to the cap; the cap is on the remaining window, so frames never add up. */
    trigger(kind) {
      if (!enabled) return;
      remaining = Math.min(capMs, remaining + (kind === 'heavy' ? heavyMs : lightMs));
    },
    /** Real dt -> sim dt: 0 inside the window, dt outside, the unfrozen remainder on the boundary step. */
    scale(dtMs) {
      if (remaining <= 0) return dtMs;
      if (remaining >= dtMs) { remaining -= dtMs; return 0; }
      const out = dtMs - remaining; remaining = 0; return out;
    },
    /** One fixed step: true when the frozen sims should step now (accumulates scaled time, so total delay = freeze length). */
    due(dtMs) {
      acc += this.scale(dtMs);
      if (acc >= dtMs - 1e-9) { acc -= dtMs; if (acc < 1e-9) acc = 0; return true; }
      return false;
    },
    get remainingMs() { return remaining; },
    get active() { return enabled; },
    reset() { remaining = 0; acc = 0; },
  };
}
