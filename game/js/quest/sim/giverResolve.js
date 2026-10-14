// D-098 / QFIX-S5a-2: who offers and who takes in a quest. Pure. New fields `giverNpc` / `turnInNpc` (NPC id = placed character
// entity id) win; the old def.giver.npc / giver.turnIn are the fallback. `objectGiver` keeps its object as giver.
// `pendingNpc` quests use the new ids only once that NPC is registered as placed (setPlacedNpcs); until then: old behaviour + one warning.
let placed = null, warned = false;
export function setPlacedNpcs(ids) { placed = ids ? new Set(ids) : null; }
/** NPCs that exist but are not out yet (e.g. Tobin before mq.smoke): their quests keep the old ids even without pendingNpc. */
let hiddenIds = null;
export function setHiddenNpcs(ids) { hiddenIds = ids && ids.length ? new Set(ids) : null; }
function usable(def, id) {
  if (typeof id !== 'string' || !id) return false;
  if (hiddenIds && hiddenIds.has(id)) return false;
  if (def.pendingNpc !== true) return true;
  if (placed && placed.has(id)) return true;
  if (!warned) { warned = true; if (typeof console !== 'undefined') console.warn('quest givers: pendingNpc NPC "' + id + '" (' + def.id + ' ...) not placed yet, old giver/turnIn used'); }
  return false;
}
/** NPC/object id that offers `def` ('' = giverless). */
export function giverOf(def) {
  const g = def.giver; if (!g) return '';
  if (def.objectGiver !== true && usable(def, def.giverNpc)) return def.giverNpc;
  return g.npc;
}
/** NPC/object id where `def` is handed in. */
export function turnInOf(def) {
  const g = def.giver; if (!g) return '';
  if (usable(def, def.turnInNpc)) return def.turnInNpc;
  return g.turnIn || g.npc;
}
/** True when `to` is a valid hand-in id for a deliver objective of `def`: the resolved turn-in, or the legacy ids (giver.turnIn || giver.npc, turnInNpc) that older saves / content still name. */
export function isTurnInTarget(def, to) {
  const g = def.giver; if (!g) return false;
  return to === turnInOf(def) || to === (g.turnIn || g.npc) || to === def.turnInNpc;
}
