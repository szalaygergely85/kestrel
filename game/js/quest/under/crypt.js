// UNDER-02 / OB-191 (arch 38.75 items 3-5): the cemetery crypt. Pure logic, no engine edits.
//  - door: the sealed facade door (mesh structure `cem36`) opens only with the "Crypt Key" (item key.crypt); flag under.crypt.doorOpen.
//    Open = the door mesh sinks 3 m into the ground (setMeshPlacement + rebuildMeshColliders); applyCryptDoor re-syncs it on 'world:loaded'.
//  - chest: `chestCrypt` (room 3) is EARNED: it opens only once the room 3 skeletons are dead (cryptCleared); flag under.crypt.chest.chestCrypt.
//  NEEDS B1-main: on E at `cemeteryCryptDoor` call cryptDoorAction(world, hasItem) (sealed -> keep the existing look-at note.cemetery.crypt);
//  call applyCryptDoor on 'world:loaded'; register chest.open for chestCrypt only when cryptCleared(...) (else its inspect note.crypt.chest shows);
//  bindCryptFlags(world, events); ambience: world.structureAt(p).level.ambience === 'crypt'.
import { STATE_DYING, STATE_GONE, STATE_EAT } from '../sim/beastSim.js';
export const CRYPT = Object.freeze({
  site: 'crypt', key: 'key.crypt', doorMesh: 'cem36', doorSink: 3, reach: 2.6,
  guards: Object.freeze(['skelbrute.crypt.1', 'skelwar.crypt.2', 'skelwar.crypt.3']), // room 3
  chests: Object.freeze(['chestCrypt']),
});
export const DOOR_FLAG = 'under.crypt.doorOpen', CLEARED_FLAG = 'under.crypt.cleared';
export const chestKey = (id) => `under.crypt.chest.${id}`;

/** Moves the door mesh into / out of the ground to match `open`. Returns false when the world has no such mesh. */
export function setCryptDoor(world, open) {
  const s = (world.structures || []).find((q) => q.id === CRYPT.doorMesh && q.kind === 'mesh');
  if (!s) return false;
  if (s.baseZ === undefined) s.baseZ = s.origin.z;
  const dz = open ? -CRYPT.doorSink : 0, yaw = s.frame && s.frame.yawDeg !== undefined ? s.frame.yawDeg : 278;
  if (world.setMeshPlacement) world.setMeshPlacement(CRYPT.doorMesh, { x: s.origin.x, y: s.origin.y, z: s.baseZ + dz, yawDeg: yaw, scale: s.scale });
  if (world.rebuildMeshColliders) world.rebuildMeshColliders();
  return true;
}
export const applyCryptDoor = (world) => { if (world.state[DOOR_FLAG]) setCryptDoor(world, true); };

/** E at the sealed door: 'open' (key held: door opens, flag set), 'already' (open), or 'sealed' (no key: show the look-at note). */
export function cryptDoorAction(world, hasItem) {
  if (world.state[DOOR_FLAG]) return 'already';
  if (!hasItem || !hasItem(CRYPT.key)) return 'sealed';
  world.state[DOOR_FLAG] = true;
  setCryptDoor(world, true);
  return 'open';
}

const isDown = (sim, id) => { const s = sim.slotOf(id); return s >= 0 && (!!sim.down[s] || (sim.state[s] >= STATE_DYING && sim.state[s] <= STATE_GONE && sim.state[s] !== STATE_EAT)); };
/** The room 3 skeletons are all dead (or parked). `sim` = beastSim (slotOf, down, state); sets the saved cleared flag once. */
export function cryptCleared(world, sim) {
  if (world.state[CLEARED_FLAG]) return true;
  if (!CRYPT.guards.every((id) => isDown(sim, id))) return false;
  world.state[CLEARED_FLAG] = true;
  return true;
}
/** chest:opened -> save flag; returns an unsubscribe. */
export function bindCryptFlags(world, events) {
  return events.on('chest:opened', (p) => { if (p && CRYPT.chests.includes(p.id)) world.state[chestKey(p.id)] = true; });
}
/** After Continue: rebuild the flags from the restored opened-chest list. */
export function syncCryptFlags(world, openedChests) {
  for (const id of CRYPT.chests) if ((openedChests || []).includes(id)) world.state[chestKey(id)] = true;
}
