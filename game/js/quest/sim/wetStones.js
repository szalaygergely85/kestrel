// QL-19: wet stepping stones (the ford slabs fordS1..N, or any structure with `wet: true`) + the River Boots slow step.
// Pure, zero allocation per step: stones are flat arrays built once per world load.
import { wetStoneStep } from './equipment.js';

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

export function createWetStones(structures, r = WET_STONE_R) {
  const st = collectWetStones(structures), slow = { t: 0 }, r2 = r * r;
  let was = false;
  function on(x, y) {
    for (let i = 0; i < st.n; i++) { const dx = x - st.xs[i], dy = y - st.ys[i]; if (dx * dx + dy * dy <= r2) return true; }
    return false;
  }
  return {
    count: st.n, state: slow, on,
    /** Call once per fixed step before integrate; returns the speed multiplier (1 = none, 0.5 = slow step). */
    step(eq, defs, sprinting, x, y, dt) {
      const now = st.n > 0 && eq && defs ? on(x, y) : false;
      const m = eq && defs ? wetStoneStep(slow, eq, defs, sprinting, now, was, dt) : 1;
      was = now;
      return m;
    },
    reset() { slow.t = 0; was = false; },
  };
}
