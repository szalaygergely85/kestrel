// BEAST-06a main hook: pure glue between the beast sim, the spawn director and the events bus (no DOM, testable in Node).
import { createSpawnDirector, buildGroups, regionalMembers } from './spawnDirector.js';

/** o: { sim, list (spawnRegionalBeasts output), seed, walkable?, dayLenSec, hfovDeg, los, events?, state? (WorldState for load) }.
 * Returns { dir, groupOfSlot, step(dt,px,py,fx,fy), died(slot), save(state), load(state), dispose() }. */
export function createDirectorWire(o) {
  const sim = o.sim;
  const members = regionalMembers(o.list || [], (id) => sim.slotOf(id));
  const groups = buildGroups(members, o.seed, o.walkable);
  const dir = createSpawnDirector({
    groups, dayLenSec: o.dayLenSec, viewHalfRad: (o.hfovDeg || 75) * Math.PI / 360, los: o.los,
    onRespawn: (gi, g) => { for (const s of g.slots) sim.resetSlot(s); },
  });
  const groupOfSlot = new Int16Array(sim.count || 1024).fill(-1);
  for (let g = 0; g < groups.length; g++) for (const s of groups[g].slots) if (s < groupOfSlot.length) groupOfSlot[s] = g;
  const died = (slot) => { const g = slot >= 0 && slot < groupOfSlot.length ? groupOfSlot[slot] : -1; if (g >= 0) dir.memberDied(g); return g; };
  const off = o.events ? o.events.on('beast:died', (p) => died(sim.slotOf(p.id))) : null;
  if (o.state) dir.load(o.state);
  return {
    dir, groupOfSlot, died, step: dir.step, save: dir.save, load: dir.load,
    dispose() { if (off) off(); },
  };
}
