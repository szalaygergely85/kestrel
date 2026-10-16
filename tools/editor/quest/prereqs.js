// tools/editor/quest/prereqs.js - ED-QUI-02. Card [01] Prerequisites: one row per required quest + the shape-keeping writer.
// No level gate and no item requirement exist in this game (D-020/D-106); the item row is shown disabled.
import { setQuestField } from './model.js';
import { formatView, isFormatDef } from './format.js';

export const ITEM_ROW_NOTE = 'Not a requirement in this game - use a Deliver objective';

/** Quests `id` depends on: its requires plus every quest whose `next` is `id`. */
function deps(model, id) {
  const out = [];
  for (const x of model.quests) {
    if (x.id === id) out.push(...formatView(x.raw).requires.quests);
    else if (formatView(x.raw).next === id) out.push(x.id);
  }
  return out;
}

/** True when `from` depends (transitively) on `target`. */
function reaches(model, from, target) {
  const seen = new Set(), stack = [from];
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id); stack.push(...deps(model, id));
  }
  return false;
}

/** -> { rows:[{quest, title, problem:null|'unknown'|'self'|'cycle', text}], ok, total, header, item:{disabled,note} } */
export function prereqRows(model, q) {
  const byId = new Map(model.quests.map((x) => [x.id, x]));
  const rows = formatView(q.raw).requires.quests.map((id) => {
    const t = byId.get(id);
    let problem = null, text = '';
    if (id === q.id) { problem = 'self'; text = 'A quest cannot require itself'; }
    else if (!t) { problem = 'unknown'; text = 'Required quest "' + id + '" does not exist'; }
    else if (reaches(model, id, q.id)) { problem = 'cycle'; text = '"' + (t.title || id) + '" already depends on this quest (cycle)'; }
    return { quest: id, title: t ? (t.title || id) : id, problem, text };
  });
  const ok = rows.filter((r) => !r.problem).length;
  return { rows, ok, total: rows.length, header: ok + '/' + rows.length + ' OK', item: { disabled: true, note: ITEM_ROW_NOTE } };
}

/** Undoable write of the required quest ids, keeping the file's shape (legacy array of {quest,done} vs format {quests}). */
export function setRequiresKeepShape(q, ids) {
  const want = [...new Set(ids.filter(Boolean))];
  const raw = q.raw;
  if (Array.isArray(raw.requires)) {
    const keep = raw.requires.filter((r) => !r || !r.quest || want.includes(r.quest));
    const have = new Set(keep.filter((r) => r && r.quest).map((r) => r.quest));
    return setQuestField(q, 'requires', [...keep, ...want.filter((id) => !have.has(id)).map((id) => ({ quest: id, done: true }))]);
  }
  if (raw.requires === undefined && !isFormatDef(raw)) {
    return setQuestField(q, 'requires', want.length ? want.map((id) => ({ quest: id, done: true })) : undefined);
  }
  return setQuestField(q, 'requires', { quests: want });
}
