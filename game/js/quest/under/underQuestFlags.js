// UNDER-07 (OB-191): quest flags for the Restless Graves / Sealed Crypt chain. The quest book only reads fed `flag:set` events, so this
// pure helper lists which flags are true RIGHT NOW; underHook emits them (~1 Hz). Transient flags (seen, lastRoom) are not saved: they only
// count while a quest is active (the book ignores events before accept), so a visit before accepting never completes anything.
import { UNDER_SITES } from '../sim/underSkeletons.js';
import { DOOR_FLAG, chestKey, CRYPT } from './crypt.js';

export const SEEN_FLAG = 'under.cemetery.seen', ROOM_FLAG = 'under.crypt.lastRoom';
export const SEEN_R = 30;                                  // m around the cemetery anchor (= spawner WAKE_R)
export const LAST_ROOM = Object.freeze({ x: 1674.5, y: 1352, r: 7, dz: 3 }); // room 3 of the crypt (crypt anchor y 1357.5, guards dy -4..-6)
const cem = UNDER_SITES.find((s) => s.id === 'cemetery'), crypt = UNDER_SITES.find((s) => s.id === 'crypt');

/** @param {object} state world.state  @param {{x,y,z}} p player feet  @param {any} sim beast sim (slotOf, down) or null  @param {string[]} out reused list */
export function underQuestFlags(state, p, sim, out) {
  out.length = 0;
  if (state[DOOR_FLAG]) out.push(DOOR_FLAG);
  for (const c of CRYPT.chests) if (state[chestKey(c)]) out.push(chestKey(c));
  if (sim && Math.hypot(p.x - cem.anchor[0], p.y - cem.anchor[1]) <= SEEN_R) { // at the graves while at least one skeleton stands (night)
    for (const m of cem.members) { const s = sim.slotOf(m[0]); if (s >= 0 && !sim.down[s]) { out.push(SEEN_FLAG); break; } }
  }
  if (Math.abs(p.z - crypt.z) <= LAST_ROOM.dz && Math.hypot(p.x - LAST_ROOM.x, p.y - LAST_ROOM.y) <= LAST_ROOM.r) out.push(ROOM_FLAG);
  return out;
}
