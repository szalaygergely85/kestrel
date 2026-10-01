// game/js/quest/beastView.js (US-079a, architecture.md 29.1). Presentation only - the ONE place allowed to turn a
// beast's stored facing vector into a yaw angle (atan2 is trig, forbidden in sim/**). Reads the sim's state, writes
// nothing back into it except `transform.yawDeg` (29.1 "Do not: let beastView.js write any sim state other than
// yawDeg").
import { yawFromDelta } from '../../../engine/index.js';
import { STATE_NOTICE } from './sim/beastSim.js';

/**
 * @param {ReturnType<import('./sim/beastSim.js').createBeastSim>} sim
 * @param {any} world
 * @param {any} overlay engine.overlay (RE-07)
 * @param {{beastNotice: number}} styleIds resolved overlay style ids (overlay.styleId('beastNotice'))
 */
export function presentBeasts(sim, world, overlay, styleIds) {
  if (!sim) return;
  for (let i = 0; i < sim.count; i++) {
    const e = sim.entities[i];
    const t = e.transform;
    t.yawDeg = yawFromDelta(sim.fx[i], sim.fy[i]);
    if (sim.state[i] === STATE_NOTICE) {
      overlay.bar(t.x, t.y, t.z + 1.1, 1, 1, styleIds.beastNotice, styleIds.beastNotice);
    }
  }
  void world;
}
