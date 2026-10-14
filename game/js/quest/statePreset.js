// ED-QUEST-07: "play from here" quest state presets. Pure: builds the state ONLY by driving the real questBook API
// (events, accept, handIn, a simulated pack), so no flag exists that real play could not reach.
import { createQuestBook, STATUS_NAMES } from './sim/questBook.js';
import { kindOf } from './sim/quest.js';

const DONE_FLAG = /^quest\.(.+)\.done$/;

/** `?qstate=<questId>:<preset>`; preset = notStarted | accepted | readyToReturn | objective<n> | objective:<n> (n is 1-based). Returns {questId, preset} or null. */
export function parseQstateParam(search) {
  const m = /[?&]qstate=([^&#]*)/.exec(typeof search === 'string' ? search : '');
  if (!m) return null;
  let raw; try { raw = decodeURIComponent(m[1]); } catch { return null; }
  const c = raw.indexOf(':'); if (c < 1) return null;
  const questId = raw.slice(0, c), p = raw.slice(c + 1);
  if (p === 'notStarted' || p === 'accepted' || p === 'readyToReturn') return { questId, preset: p };
  const o = /^objective[:=]?(\d+)$/.exec(p);
  return o && +o[1] >= 1 ? { questId, preset: { objective: +o[1] } } : null;
}

/**
 * @param state {main, givers, save?, pack?}  defs + optional existing book save ({quest, quests}) + pack counts ({id: n})
 * @returns {save, pack, items, status, book}  save = book.toSave() shape (feed to collectSave / createQuestBook); items = granted pack items [{id,n}] (pack minus the incoming pack)
 * Prerequisites (`requires`, flag objectives `quest.<id>.done`) are satisfied transitively, to full depth, by the same drivers:
 * flag -> flag:set; {quest, step} -> that quest's objectives up to the step; {quest, done} -> accept + all objectives + handIn (reward granted).
 */
export function applyQuestPreset(state, questId, preset) {
  const { main, givers = [] } = state;
  const book = createQuestBook(main, givers, state.save || null);
  const start = { ...(state.pack || {}) }, pack = new Map(Object.entries(start));
  book.packOps = {
    count: id => pack.get(id) || 0,
    add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); book.feed({ type: 'item:count', id, n: pack.get(id) }); return n; },
    remove: (id, n) => { const k = Math.max(0, (pack.get(id) || 0) - n); if (k) pack.set(id, k); else pack.delete(id); },
    equipped: () => true,
  };
  const guard = new Set();
  const idx = id => { const i = book.index(id); if (i < 0) throw new Error('statePreset: unknown quest ' + id); return i; };
  const defOf = id => book.def(idx(id));
  const doneCount = id => book.questState(idx(id)).completed.length;

  /** Make objective `o` of quest `id` complete via the fact a player would produce. */
  function satisfy(id, o) {
    const w = o.when;
    if (w.type === 'flag') {
      const dm = typeof w.id === 'string' ? DONE_FLAG.exec(w.id) : null;
      if (dm && book.index(dm[1]) > 0) { toDone(dm[1]); return; } // flag set by a hand-in elsewhere
      book.feed({ type: 'flag:set', key: w.id, value: w.equals === undefined ? true : w.equals });
    } else if (w.type === 'item') { book.feed({ type: 'item:got', id: w.id }); if (!pack.get(w.id)) book.packOps.add(w.id, 1); } // picked up: it is also in the pack (requireItem is consumed at hand-in)
    else if (w.type === 'area') book.feed({ type: 'area:entered', id: w.id });
    else if (w.type === 'beasts') {
      if (w.kind !== undefined) for (let k = 0; k < w.count; k++) book.feed({ type: 'beast:died', id: w.kind + (k + 1) }); // kindOf('boar3') = 'boar'
      else for (const b of w.ids) book.feed({ type: 'beast:died', id: b });
    } else { // collect / deliver: the items sit in the pack
      const have = pack.get(w.id) || 0;
      if (have < w.count) book.packOps.add(w.id, w.count - have);
    }
  }
  /** Complete objectives of `id` while fewer than `n` are done. */
  function progressTo(id, n) {
    const def = defOf(id), i = idx(id);
    for (let guardN = 0; book.questState(i).completed.length < n; guardN++) {
      const k = book.questState(i).completed.length;
      satisfy(id, def.objectives[k]);
      if (book.questState(i).completed.length <= k || guardN > 64) throw new Error('statePreset: cannot complete ' + id + ' step ' + def.objectives[k].id);
    }
  }
  function meet(def) {
    for (const r of def.requires || []) {
      if (typeof r.flag === 'string') { book.feed({ type: 'flag:set', key: r.flag, value: true }); continue; }
      if (r.done === true) toDone(r.quest);
      else progressTo(r.quest, defOf(r.quest).objectives.findIndex(o => o.id === r.step) + 1);
    }
  }
  function toDone(id) {
    const i = idx(id), def = book.def(i);
    if (i === 0) { progressTo(id, def.objectives.length); return; }
    if (book.status(i) === 4) return;
    if (guard.has(id)) throw new Error('statePreset: requires cycle at ' + id);
    guard.add(id);
    toAccepted(id);
    progressTo(id, def.objectives.length);
    if (book.handIn(id) === null) throw new Error('statePreset: cannot hand in ' + id);
    guard.delete(id);
    const reward = book.lastReward;
    if (reward && reward.items) for (const it of reward.items) book.packOps.add(it.id, it.n); // the game grants the reward after handIn
  }
  function toAccepted(id) {
    const i = idx(id);
    if (i === 0) return;
    if (book.status(i) < 2) { meet(book.def(i)); if (!book.accept(id)) throw new Error('statePreset: cannot accept ' + id + ' (status ' + STATUS_NAMES[book.status(i)] + ')'); }
  }

  const i = idx(questId);
  if (i === 0) throw new Error('statePreset: the main chain has no preset');
  const def = book.def(i);
  if (preset === 'notStarted') meet(def);
  else if (preset === 'accepted') toAccepted(questId);
  else if (preset === 'readyToReturn') { toAccepted(questId); progressTo(questId, def.objectives.length); }
  else if (preset && Number.isInteger(preset.objective)) {
    const n = preset.objective;
    if (n < 1 || n > def.objectives.length) throw new Error('statePreset: objective ' + n + ' out of range 1..' + def.objectives.length);
    toAccepted(questId); progressTo(questId, n - 1);
  } else throw new Error('statePreset: unknown preset ' + JSON.stringify(preset));

  const items = [];
  for (const [id, n] of pack) { const d = n - (start[id] || 0); if (d > 0) items.push({ id, n: d }); }
  book.packOps = null; // detach: the result book is a plain snapshot
  return { save: book.toSave(), pack: Object.fromEntries(pack), items, status: STATUS_NAMES[book.status(i)], book };
}
