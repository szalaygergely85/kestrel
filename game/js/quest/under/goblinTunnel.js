// UNDER-06 (OB-191, arch 38.75): the goblin tunnel between campNorth and campEast. Pure logic (like crypt.js), no engine edits.
//  - the 3 tunnel goblins (UNDER_SITES 'goblinTunnel', static in the stash room: no camp reinforcement, they are not camp members, so camp dormancy / respawn
//    do not touch them; killed ones stay dead through the generic saveRelay dead set, BH-S5) guard `chestGoblinTunnel`.
//  - chest: EARNED, opens once all 3 are dead (tunnelCleared); flags under.goblinTunnel.cleared / under.goblinTunnel.chest.chestGoblinTunnel.
//  Wired in game/js/underHook.js (canOpenChest, bindTunnelFlags, syncTunnelFlags); ambience: world.structureAt(p).level.ambience === 'cave'.
import { STATE_DYING, STATE_GONE, STATE_EAT } from '../sim/beastSim.js';
export const GOBLIN_TUNNEL = Object.freeze({
  site: 'goblinTunnel', chests: Object.freeze(['chestGoblinTunnel']),
  guards: Object.freeze(['archer.goblinTunnel.1', 'torch.goblinTunnel.1', 'archer.goblinTunnel.2']),
  camps: Object.freeze(['campNorth', 'campEast']),
});
export const CLEARED_FLAG = 'under.goblinTunnel.cleared';
export const chestKey = (id) => `under.goblinTunnel.chest.${id}`;
const isDown = (sim, id) => { const s = sim.slotOf(id); return s >= 0 && (!!sim.down[s] || (sim.state[s] >= STATE_DYING && sim.state[s] <= STATE_GONE && sim.state[s] !== STATE_EAT)); };
/** All 3 tunnel goblins are dead (or parked); sets the saved cleared flag once. `sim` = beastSim (slotOf, down, state). */
export function tunnelCleared(world, sim) {
  if (world.state[CLEARED_FLAG]) return true;
  if (!GOBLIN_TUNNEL.guards.every((id) => isDown(sim, id))) return false;
  world.state[CLEARED_FLAG] = true;
  return true;
}
export function bindTunnelFlags(world, events) {
  return events.on('chest:opened', (p) => { if (p && GOBLIN_TUNNEL.chests.includes(p.id)) world.state[chestKey(p.id)] = true; });
}
export function syncTunnelFlags(world, openedChests) {
  for (const id of GOBLIN_TUNNEL.chests) if ((openedChests || []).includes(id)) world.state[chestKey(id)] = true;
}
