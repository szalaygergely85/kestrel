// game/js/life/poiFights.js (POI-05, OB-141, D-088): POI mini fights with MIXED respawn.
//   const pf = createPoiFights({ wire, spawner, events, ringR? });  per sim step: pf.step(px, py, dayIndex);  dispose().
// - Entering TRIGGER_R (15 m) of a POI with `fight` (and the fight is active per poiWire.fightActive) spawns its members (deterministic ring
//   slots) through `spawner.spawn(def, k, x, y, guardian) -> entity id | null`; `spawner.despawn(id)` on leave/dispose.
// - All members dead (`beast:died` {id}): small fight -> wire.markFightCleared(id, day) (comes back after RESPAWN_DAYS = 3, camp rule);
//   guardian fight (def.guardian) -> wire.markGuardianDead(id): saved in poi.v1, never returns. Either unlocks the POI chest (poiWire).
// - Member ids are not saved: a half-fought fight restarts when the POI becomes active again (same as camps).
export const TRIGGER_R = 15, LEAVE_R = 60;

/** Deterministic member positions: n points on a ring (literal offsets, no trig) around the POI centre. */
const RING = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
export function fightSlots(def, ringR = 4) {
  const n = def.fight ? def.fight.n : 0, out = [];
  for (let k = 0; k < n; k++) { const d = RING[k & 7]; out.push([def.at[0] + d[0] * ringR, def.at[1] + d[1] * ringR]); }
  return out;
}

export function createPoiFights({ wire, spawner, events = null, ringR = 4 }) {
  const live = new Map(); // poi id -> { ids:Set, day }
  const owner = new Map(); // entity id -> poi id
  let spawns = 0;
  const finish = (poiId, entry) => {
    const d = wire.defs.find((x) => x.id === poiId);
    if (d && d.guardian) wire.markGuardianDead(poiId); else wire.markFightCleared(poiId, entry.day);
    live.delete(poiId);
  };
  const off = events ? events.on('beast:died', (p) => {
    const poiId = p && owner.get(p.id); if (poiId === undefined) return;
    owner.delete(p.id);
    const e = live.get(poiId); if (!e) return;
    e.ids.delete(p.id);
    if (e.ids.size === 0) finish(poiId, e);
  }) : null;
  const clear = (poiId) => { const e = live.get(poiId); if (!e) return; for (const id of e.ids) { owner.delete(id); if (spawner.despawn) spawner.despawn(id); } live.delete(poiId); };
  const pf = {
    step(px, py, day) {
      for (const d of wire.defs) {
        if (!d.fight) continue;
        const dist = Math.hypot(d.at[0] - px, d.at[1] - py), e = live.get(d.id);
        if (e) { if (dist > LEAVE_R) clear(d.id); continue; }
        if (dist > TRIGGER_R || !wire.isLive(d.id) || !wire.fightActive(d.id, day)) continue;
        const ids = new Set(), pts = fightSlots(d, ringR);
        for (let k = 0; k < pts.length; k++) { const id = spawner.spawn(d, k, pts[k][0], pts[k][1], !!d.guardian && k === 0); if (id != null) { ids.add(id); owner.set(id, d.id); spawns++; } }
        // no spawn path for this fight (spawner returned nothing): treat as cleared so the chest never stays locked for good
        const e2 = { ids, day }; if (ids.size) live.set(d.id, e2); else finish(d.id, e2);
      }
    },
    isFighting(id) { return live.has(id); },
    get spawns() { return spawns; },
    dispose() { for (const id of Array.from(live.keys())) clear(id); if (typeof off === 'function') off(); },
  };
  return pf;
}
