// game/js/quest/npcLook.js - ANIM-LOOKAT-01 AC3 main hook: char.kit NPCs turn the head to the player only while their dialogue is open.
// The player's own entity is skipped (its rig stays inert). Stable key per entity id (1024 + n); 0 alloc per frame after first sight.
export function createNpcLook(look, getTalkingId, playerId) {
  const keys = new Map(); let n = 0, talking = null;
  const visit = (e, id) => {
    const v = e.components && e.components.voxel;
    if (!v || v.model !== 'char.kit' || id === playerId()) return;
    let k = keys.get(id); if (k === undefined) { k = 1024 + n++; keys.set(id, k); }
    look.stepEntity(k, e, v, id === talking);
  };
  return { step(world) { talking = getTalkingId(); world.forEachEntity(visit); } };
}
