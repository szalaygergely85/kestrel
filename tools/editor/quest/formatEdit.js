// tools/editor/quest/formatEdit.js - QUEST-FORMAT (D-106): form edits for the quest format fields
// Begin / End / Requires / Objectives (max 3) / Rewards / Next. Pure (imports model.js + format.js only; no game/). Each returns an undoable command (or null).
import { setQuestField, addObjective } from './model.js';
import { blankObjective } from './edit.js';
import { formatView, MAX_OBJECTIVES } from './format.js';

const clean = (o) => (o && Object.keys(o).length ? o : undefined);
/** Begin: { npc } | { object } | none. kind = 'npc' | 'object'. */
export const setBegin = (q, kind, id) => setQuestField(q, 'begin', id ? { [kind === 'object' ? 'object' : 'npc']: id } : undefined);
export const setEnd = (q, id) => setQuestField(q, 'end', id ? { npc: id } : undefined);
export const setRequires = (q, ids) => setQuestField(q, 'requires', { quests: [...new Set(ids.filter(Boolean))] });
export const setNext = (q, id) => setQuestField(q, 'next', id || null);
/** Rewards { items:[{id,n}], coin, heartPiece }; never empty (an empty set is refused: returns null). NO xp. */
export function setRewards(q, { itemId = '', n = 1, coin = 0, heartPiece = 0 } = {}) {
  const r = {};
  if (itemId) r.items = [{ id: itemId, n: Math.max(1, n | 0) }];
  if (coin > 0) r.coin = coin | 0;
  if (heartPiece > 0) r.heartPiece = heartPiece | 0;
  return clean(r) ? setQuestField(q, 'rewards', r) : null;
}
/** Add a step; refused (null) at MAX_OBJECTIVES. */
export function addStepMax(q) {
  return formatView(q.raw).objectives.length >= MAX_OBJECTIVES ? null : addObjective(q, blankObjective(q));
}
/** Dropdown choices: npcs (entities with a dialogue), objects (inspect props), quests (every other quest id). Each [{id, name}] sorted by name. */
export function formatChoices(model, world, names = {}) {
  const label = (id) => (typeof names === 'function' ? names(id) : names[id]) || id;
  const ents = (world && world.entities) || [], by = (f) => ents.filter(f).map((e) => ({ id: e.id, name: label(e.id) })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    npcs: by((e) => e.components && e.components.dialogue),
    objects: by((e) => e.components && e.components.inspect),
    quests: (model.quests || []).map((x) => ({ id: x.id, name: x.title || x.id })),
  };
}
