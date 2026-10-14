// tools/editor/quest/edit.js - ED-QUEST-02. Form edits as undoable model commands (one undo step each).
// Pure (imports model.js only). Every function returns a command for makeStack().run().
import { setQuestField, addObjective, moveObjective, removeObjective, refresh } from './model.js';
import { objField, objTextKey } from './flow.js';

export const setTitle = (q, v) => setQuestField(q, 'title', v);
export const setReturnText = (q, v) => setQuestField(q, 'returnText', v);
export const setAbandonable = (q, v) => setQuestField(q, 'abandonable', !!v);

/** Accept/Exit offer text: one array entry per line (the dialogue the giver says before Accept / Exit). */
export function setOfferLines(q, lines) {
  return setQuestField(q, 'lines', { ...(q.raw.lines || {}), offer: lines.filter((l) => l.trim() !== '') });
}

/** Edits `text` or `journal` of objective i (pack steps use objText). */
export function setObjectiveField(q, i, which, value) {
  const key = which === 'text' ? objTextKey(q) : 'journal';
  const list = q.raw[objField(q)].map((o, k) => (k === i ? { ...o, [key]: value } : o));
  return setQuestField(q, objField(q), list);
}

/** Reward: single item pick (by id from the item list) + count; count < 1 or no item clears the reward. */
export function setRewardItem(q, itemId, n = 1) {
  const rest = { ...(q.raw.reward || {}) };
  if (!itemId) delete rest.items; else rest.items = [{ id: itemId, n: Math.max(1, n | 0) }];
  return setQuestField(q, 'reward', Object.keys(rest).length ? rest : undefined);
}

/** New blank objective in the right shape for the quest (legacy objective vs pack step). */
export function blankObjective(q) {
  const n = q.objectives.length + 1;
  return objField(q) === 'objectives'
    ? { id: 'step' + n, text: 'New step', journal: '', when: { type: 'area', id: '' } }
    : { template: 'explore', params: { areas: [] }, objText: 'New step', journal: '' };
}
export const addStep = (q) => addObjective(q, blankObjective(q));
export const moveStep = (q, from, to) => moveObjective(q, from, to);
export const deleteStep = (q, i) => removeObjective(q, i);

/** New side quest (blue chip, abandonable) as a legacy file `<id>.quest.json`; undo removes it again. */
export function newSideQuest(model, id = 'sq.new') {
  let n = 1, qid = id;
  while (model.quests.some((x) => x.id === qid)) qid = `${id}${++n}`;
  const file = qid + '.quest.json';
  const raw = {
    version: 1, id: qid, title: 'New side quest', giver: { npc: '' }, abandonable: true, requires: [],
    objectives: [], returnText: '', reward: {},
  };
  const q = { id: qid, kind: 'legacy', file, index: null, raw };
  return {
    label: 'new quest', questId: qid, quest: q,
    apply() { refresh(q); model.files.set(file, { kind: 'legacy', obj: raw, text: '' }); model.quests.push(q); },
    undo() { model.files.delete(file); model.quests.splice(model.quests.indexOf(q), 1); },
  };
}
