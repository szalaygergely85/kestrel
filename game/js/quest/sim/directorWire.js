// BEAST-06a-WIRE: glue between the spawn director and a beast sim (arch 38.64 answer c). Not hooked into main.js yet
// (regionalBeasts/goblinCamps keep their own respawn until BEAST-06b/13); main binds it on 'world:loaded' when that lands.
// bind: the director maps members -> slots -> groups ONCE. beast:died {id} -> slotOf(id) -> group (0 alloc). A due group
// resets each of its slots via sim.resetSlot(slot). Save/load: relay key 'spawnDirector.v1' ({gid:{dead,respawnAt}}).
import { SAVE_KEY } from './spawnDirector.js';

export function createDirectorWire({ director, sim, events, onRespawn }) {
  director.bind(sim);
  const W = { director, sim };
  W.respawn = (gi, group) => { const sl = group.slots; for (let k = 0; k < sl.length; k++) sim.resetSlot(sl[k]); if (onRespawn) onRespawn(gi, group); };
  W.died = (p) => { if (p && typeof p.id === 'string') director.slotDied(sim.slotOf(p.id)); };
  const off = events && events.on ? events.on('beast:died', W.died) : null;
  W.save = (state) => director.save(state);
  W.load = (state) => director.load(state);
  W.dispose = () => { if (typeof off === 'function') off(); };
  return W;
}
export { SAVE_KEY };
