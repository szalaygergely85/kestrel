// QL-19: wet stepping stones (the ford slabs fordS1..N, or any structure with `wet: true`) + the River Boots slow step.
// Pure, zero allocation per step: stones are flat arrays built once per world load.
import { wetStoneStep, WET_SLOW_S } from './equipment.js';

export const WET_STONE_R = 1.1; // slab half-size ~1 m; a bit generous so a sprint onto the edge counts
const WET_ID = /^fordS[0-9]+$/;

/** Stones from worldDef.structures: those with `wet: true` or an id fordS<n>. */
export function collectWetStones(structures) {
  const xs = [], ys = [];
  for (const s of structures || []) {
    if (!s || !s.origin || !(s.wet === true || WET_ID.test(s.id || ''))) continue;
    xs.push(s.origin.x); ys.push(s.origin.y);
  }
  return { xs, ys, n: xs.length };
}

export const WET_RETRIGGER_S = 1; // the same stone does not slow again within 1 s

export function createWetStones(structures, r = WET_STONE_R) {
  const st = collectWetStones(structures), slow = { t: 0, fresh: false }, r2 = r * r;
  let prev = -1, last = -1, since = 99; // stone index under the feet last step / last stone that slowed / s since that
  function at(x, y) { // index of the stone under (x, y), or -1
    for (let i = 0; i < st.n; i++) { const dx = x - st.xs[i], dy = y - st.ys[i]; if (dx * dx + dy * dy <= r2) return i; }
    return -1;
  }
  return {
    count: st.n, state: slow, at, on(x, y) { return at(x, y) >= 0; },
    /** Call once per fixed step before integrate; returns the speed multiplier (1 = none, 0.4 = slow step).
     *  `state.fresh` is true on the step a slow step starts: main.js plays the existing wade splash then. */
    step(eq, defs, sprinting, x, y, dt) {
      slow.fresh = false;
      if (!eq || !defs) return 1;
      since += dt;
      const i = st.n > 0 ? at(x, y) : -1;
      const enter = i >= 0 && i !== prev && !(i === last && since < WET_RETRIGGER_S);
      prev = i;
      const m = wetStoneStep(slow, eq, defs, sprinting, enter, false, dt);
      if (enter && slow.t === WET_SLOW_S) { slow.fresh = true; last = i; since = 0; }
      return m;
    },
    reset() { slow.t = 0; slow.fresh = false; prev = -1; last = -1; since = 99; },
  };
}
