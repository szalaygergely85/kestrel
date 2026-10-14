// game/js/life/poiBeasts.js (POI-05b, OB-141, D-088; arch 38.64 item 8: every member has a STATIC slot, no pooling).
// Boot-time: each fight POI's members become ordinary beast entities (ids '<species>.<poiKey>.<n>', same as regional herds), added BEFORE
// createBeastSim. They start parked (sim.setDown); poiFights unparks them on approach. Each fight is one spawn-director group
// (gid = poi id, small fight cls 'camp' = back after 3 in-game days, guardian cls 'boss' = never back, saved in state['beast.v1']).
import { spawnBeastEntity } from '../quest/sim/regionalBeasts.js';
import { fightSlots } from './poiFights.js';

// Fight species that have no beast model of their own yet ride a regional kind (goblins live in the camp sim, not here).
export const SPECIES_AS = Object.freeze({ boar: 'boar', wolf: 'wolf', bear: 'bear', goblin: 'wolf' });
export const poiKey = (def) => String(def.id).split('.')[1];

/** Add the members to a loaded World (before createBeastSim). Returns [{ poiId, id, species, x, y, k }]. Deterministic (poi defs + ring). */
export function spawnPoiBeasts(world, defs, ringR = 4) {
  const out = [];
  for (const d of defs) {
    if (!d.fight) continue;
    const sp = SPECIES_AS[d.fight.species] || 'boar', pts = fightSlots(d, ringR);
    for (let k = 0; k < pts.length; k++) {
      const id = `${sp}.${poiKey(d)}.${k + 1}`;
      spawnBeastEntity(world, id, sp, pts[k][0], pts[k][1], false);
      out.push({ poiId: d.id, id, species: sp, x: pts[k][0], y: pts[k][1], k });
    }
  }
  return out;
}

/** Spawn-director groups (buildGroups shape + `park`) for the members that really got a sim slot. */
export function poiGroups(sim, members, defs = []) {
  const guard = {}; for (const d of defs) if (d.guardian) guard[d.id] = 1;
  const by = {}, order = [];
  for (const m of members) { const slot = sim.slotOf(m.id); if (slot < 0) continue; (by[m.poiId] || (by[m.poiId] = (order.push(m.poiId), { poiId: m.poiId, kind: m.species, slots: [], members: [] }))); by[m.poiId].slots.push(slot); by[m.poiId].members.push(m); }
  return order.map((pid) => {
    const g = by[pid], n = g.members.length; let cx = 0, cy = 0; for (const m of g.members) { cx += m.x; cy += m.y; }
    return { gid: pid, kind: g.kind, region: pid, cls: guard[pid] ? 'boss' : 'camp', slots: g.slots, members: g.members, home: [cx / n, cy / n], route: [[cx / n, cy / n]], park: true, poiId: pid };
  });
}
