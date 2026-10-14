// game/js/life/poiFights.js (POI-05 + POI-05b, OB-141, D-088): POI mini fights on STATIC beast slots (poiBeasts.js reserves them at boot).
//   const pf = createPoiFights({ wire, sim, dir, groups, events });  per sim step: pf.step(px, py, dayIndex);  dispose().
// - The members sit parked (sim.setDown) until the player is within TRIGGER_R (15 m) of the POI AND the spawn-director group is alive
//   (dir.dead[g] === 0): then they are unparked (reset at home, alive). Leaving beyond LEAVE_R re-parks them (a half-fought fight restarts).
// - All members dead (`beast:died`): small fight -> wire.markFightCleared(id, day) (the director's camp timer brings it back after 3 days),
//   guardian (def.guardian, boss class) -> wire.markGuardianDead(id) (never returns; saved in beast.v1 and poi.v1). Either unlocks the chest.
// - A fight with no sim slot (cut by MAX_BEASTS) or no sim at all counts as cleared at once, so a chest never stays locked for good.
export const TRIGGER_R = 15, LEAVE_R = 60;

/** Deterministic member positions: n points on a ring (literal offsets, no trig) around the POI centre. */
const RING = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
export function fightSlots(def, ringR = 4) {
  const n = def.fight ? def.fight.n : 0, out = [];
  for (let k = 0; k < n; k++) { const d = RING[k & 7]; out.push([def.at[0] + d[0] * ringR, def.at[1] + d[1] * ringR]); }
  return out;
}

/** Exact-slot steer re-activation (what beastSim.respawnSlot does; addAgent's lowest-free rule throws for any other slot). */
function activate(sim, s) { if (!sim.steer.active[s]) { sim.steer.active[s] = 1; sim.steer.radius[s] = sim.cfg.radius; if (s + 1 > sim.steer._hi) sim.steer._hi = s + 1; } }
/** Park: STATE_GONE via setDown, but keep the steer agent ACTIVE at home - an inactive, non-dormant slot makes sim.resetAll() throw
 *  (it re-adds every slot with addAgent). GONE slots are skipped by step/dormancy, so the ghost agent is inert.
 *  NEEDS: sim.parkSlot / sim.unparkSlot(slot) in beastSim.js (lane note) - then drop activate(). */
function park(sim, s) { sim.setDown(s, true); if (!sim.steer.active[s]) { activate(sim, s); sim.steer.x[s] = sim.homeX[s]; sim.steer.y[s] = sim.homeY[s]; } }
function unpark(sim, s) { if (sim.unparkSlot) sim.unparkSlot(s); else { activate(sim, s); sim.setDown(s, false); } }

export function createPoiFights({ wire, sim = null, dir = null, groups = null, events = null }) {
  const gOf = {}; // poi id -> { slots, g (index in the director, -1 without one) }
  if (sim && groups) for (const gr of groups) { const gi = dir ? dir.groups.indexOf(gr) : -1; gOf[gr.poiId] = { slots: gr.slots, g: gi }; }
  const live = new Map(); // poi id -> { left:Set(slot), day }
  const slotPoi = {};      // slot -> poi id
  for (const id of Object.keys(gOf)) for (const s of gOf[id].slots) slotPoi[s] = id;
  const parkAll = () => { for (const id of Object.keys(gOf)) for (const s of gOf[id].slots) park(sim, s); live.clear(); };
  if (sim) parkAll(); // boot: every POI member starts parked
  let spawns = 0;
  const finish = (poiId, day) => {
    const d = wire.defs.find((x) => x.id === poiId);
    if (d && d.guardian) wire.markGuardianDead(poiId); else wire.markFightCleared(poiId, day);
    live.delete(poiId);
  };
  const off = events ? events.on('beast:died', (p) => {
    const slot = p && sim ? sim.slotOf(p.id) : -1, poiId = slot >= 0 ? slotPoi[slot] : undefined; if (poiId === undefined) return;
    const e = live.get(poiId); if (!e) return;
    e.left.delete(slot);
    if (e.left.size === 0) finish(poiId, e.day);
  }) : null;
  const offReset = events ? events.on('beasts:reset', () => { if (sim) parkAll(); }) : null; // resetAll() un-downs every slot
  const pf = {
    step(px, py, day) {
      for (const d of wire.defs) {
        if (!d.fight) continue;
        const dist = Math.hypot(d.at[0] - px, d.at[1] - py), e = live.get(d.id), m = gOf[d.id];
        if (e) { if (dist > LEAVE_R) { for (const s of m.slots) park(sim, s); live.delete(d.id); } continue; }
        if (m && d.guardian && m.g >= 0 && dir.dead[m.g] && !wire.guardianDead(d.id)) wire.markGuardianDead(d.id); // beast.v1 -> poi.v1 (load)
        if (dist > TRIGGER_R || !wire.isLive(d.id)) continue;
        if (!m) { if (wire.fightActive(d.id, day)) finish(d.id, day); continue; } // no slots: treat as cleared (chest must open)
        if (m.g >= 0 ? dir.dead[m.g] : !wire.fightActive(d.id, day)) continue;      // cleared and not respawned yet
        if (wire.guardianDead(d.id)) continue;
        if (m.g >= 0) dir.alive[m.g] = m.slots.length; // a restarted half-fight counts all members again
        const left = new Set(); for (const s of m.slots) { unpark(sim, s); left.add(s); spawns++; }
        live.set(d.id, { left, day });
      }
    },
    isFighting(id) { return live.has(id); },
    get spawns() { return spawns; },
    dispose() { if (sim && live.size) for (const id of Array.from(live.keys())) for (const s of gOf[id].slots) park(sim, s); live.clear(); if (typeof off === 'function') off(); if (typeof offReset === 'function') offReset(); },
  };
  return pf;
}
