// DN-03 (docs/architecture.md 38.39, D-064): the world clock. Game data only: the hour lives in
// world.state['clock.hour'] (saved with the world state); the engine just receives hours/looks.
export const CLOCK_KEY = 'clock.hour';
export const CLOCK_DEFAULTS = { dayLenS: 1440, startHour: 8 }; // 24 real minutes per game day
export const STEP_HOURS = 1 / 240; // 0.25 deg of sun per step (1 s real at the default day length)

/** Advance the clock by dtSim real seconds (fixed sim step). Missing/invalid key starts at cfg.startHour. Returns the hour. */
export function tickClock(state, dtSim, cfg = CLOCK_DEFAULTS) {
  let h = state[CLOCK_KEY];
  if (typeof h !== 'number' || !Number.isFinite(h)) h = cfg.startHour;
  h += dtSim * 24 / cfg.dayLenS;
  h -= Math.floor(h / 24) * 24;
  state[CLOCK_KEY] = h;
  return h;
}

/** Current hour (does not create the key). */
export function clockHour(state, cfg = CLOCK_DEFAULTS) {
  const h = state[CLOCK_KEY];
  return typeof h === 'number' && Number.isFinite(h) ? h : cfg.startHour;
}

/** Hour quantised down to the step grid (so dirty-skip caches downstream only change once per step). */
export function stepHour(h) { return Math.floor(h / STEP_HOURS) * STEP_HOURS; }

/**
 * Step-quantised lighting driver. `apply(hour)` is called when the quantised hour changed (or on `force`);
 * it should run applySunHours(..., moon=true) + blendLook + LightSet ambient. Returns true when it ran.
 * Allocation-free after creation.
 */
export function createClockDriver(apply) {
  let last = NaN;
  return {
    steps: 0,
    update(hour, force = false) {
      const q = stepHour(hour);
      if (!force && q === last) return false;
      last = q; this.steps++;
      apply(q);
      return true;
    },
    reset() { last = NaN; },
  };
}
