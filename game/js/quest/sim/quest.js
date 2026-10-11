// US-096a: event-driven plain save data. No world/DOM, clocks or random sources.
const BAD_IDS = new Set(['constructor','prototype','__proto__']);
const GOOD_IDS = new Set(); // QL-T3: ids seen valid skip the regex (its match bookkeeping allocated ~4 B per call); bounded
const safeId = value => {
  if (typeof value !== 'string') return false;
  if (GOOD_IDS.has(value)) return true;
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) || BAD_IDS.has(value)) return false;
  if (GOOD_IDS.size < 8192) GOOD_IDS.add(value);
  return true;
};
const scalar = value => value === null || ['boolean','string'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
const requireId = value => { if (!safeId(value)) throw new Error('quest: invalid id'); };

export function validateQuestDefinition(def) {
  if (def?.version !== 1 || !safeId(def.id) || !Array.isArray(def.objectives) || !def.objectives.length) throw new Error('quest: invalid definition');
  const seen = new Set();
  for (const objective of def.objectives) {
    requireId(objective.id);
    if (seen.has(objective.id) || typeof objective.text !== 'string') throw new Error('quest: duplicate objective or invalid text');
    seen.add(objective.id);
    const when = objective.when;
    if (!when || !['flag','item','area','beasts','collect','deliver'].includes(when.type)) throw new Error('quest: invalid condition');
    if (when.type === 'beasts') {
      if (!Array.isArray(when.ids) || !when.ids.length || new Set(when.ids).size !== when.ids.length || !when.ids.every(safeId)
        || !Number.isInteger(when.count) || when.count < 1 || when.count > when.ids.length) throw new Error('quest: invalid beast targets');
    } else {
      requireId(when.id);
      if (when.type === 'collect' || when.type === 'deliver') { // QUESTS-01: pack-counted item (event item:count sets counts[id])
        if (!Number.isInteger(when.count) || when.count < 1) throw new Error('quest: invalid collect count');
        if (when.type === 'deliver') requireId(when.to);
      }
      if (when.type === 'flag' && !scalar(when.equals)) throw new Error('quest: invalid flag value');
    }
  }
  return def;
}

function progress(state, when) {
  if (when.type === 'flag') return Object.hasOwn(state.flags, when.id) && state.flags[when.id] === when.equals ? 1 : 0;
  if (when.type === 'item') return state.items.includes(when.id) ? 1 : 0;
  if (when.type === 'area') return state.areas.includes(when.id) ? 1 : 0;
  if (when.type === 'collect' || when.type === 'deliver') return Math.min(state.counts[when.id] || 0, when.count);
  let count = 0;
  for (const id of when.ids) if (state.deadBeasts.includes(id)) count++;
  return count;
}

function advance(state, def) {
  while (state.completed.length < def.objectives.length) {
    const objective = def.objectives[state.completed.length];
    if (progress(state, objective.when) < (objective.when.count ?? 1)) break;
    state.completed.push(objective.id);
  }
}

/** Restore validates a completed prefix; facts received early remain available to later objectives. */
export function createQuest(def, saved = null) {
  validateQuestDefinition(def);
  const state = { questVersion: 1, questId: def.id, flags: {}, items: [], deadBeasts: [], areas: [], completed: [], counts: {} };
  if (saved) {
    if (saved.questVersion !== 1 || saved.questId !== def.id || !saved.flags || typeof saved.flags !== 'object' || Array.isArray(saved.flags)) throw new Error('quest: incompatible save');
    for (const key of Object.keys(saved.flags).sort()) {
      requireId(key); if (!scalar(saved.flags[key])) throw new Error('quest: invalid saved flag');
      state.flags[key] = saved.flags[key];
    }
    if (saved.counts !== undefined) { // QUESTS-01: optional (older saves have none)
      if (!saved.counts || typeof saved.counts !== 'object' || Array.isArray(saved.counts)) throw new Error('quest: invalid saved counts');
      for (const key of Object.keys(saved.counts).sort()) { requireId(key); if (!Number.isInteger(saved.counts[key]) || saved.counts[key] < 1) throw new Error('quest: invalid saved count'); state.counts[key] = saved.counts[key]; }
    }
    for (const key of ['items','deadBeasts','areas','completed']) {
      if (!Array.isArray(saved[key]) || !saved[key].every(safeId) || new Set(saved[key]).size !== saved[key].length) throw new Error('quest: invalid saved ids');
      state[key] = [...saved[key]];
      if (key !== 'completed') state[key].sort();
    }
    if (state.completed.length > def.objectives.length || state.completed.some((id,i)=>id!==def.objectives[i].id)) throw new Error('quest: invalid completed prefix');
  }
  advance(state, def);
  return state;
}

/** Known malformed events throw before mutation; unrelated event types are ignored. */
const EVENT_TYPES = new Set(['flag:set','item:got','beast:died','area:entered','item:count']); // hoisted: no per-call array (QL-T1, 0 alloc per step)
export function applyQuestEvent(state, event, def) {
  if (!event || !EVENT_TYPES.has(event.type)) return false;
  const id = event.type === 'flag:set' ? event.key : event.id;
  requireId(id);
  let changed = false;
  if (event.type === 'item:count') { // absolute pack count (idempotent: never double counts)
    const n = event.n;
    if (!Number.isInteger(n) || n < 0) throw new Error('quest: invalid item count');
    const cur = state.counts[id] || 0;
    if (n !== cur) { if (n) state.counts[id] = n; else delete state.counts[id]; changed = true; }
  } else if (event.type === 'flag:set') {
    if (!scalar(event.value)) throw new Error('quest: invalid event flag');
    changed = !Object.hasOwn(state.flags,id) || state.flags[id] !== event.value;
    if (changed) state.flags[id] = event.value;
  } else {
    const list = state[event.type === 'item:got' ? 'items' : event.type === 'beast:died' ? 'deadBeasts' : 'areas'];
    if (!list.includes(id)) { list.push(id); list.sort(); changed = true; }
  }
  if (changed) advance(state, def);
  return changed;
}

export function questObjectives(state, def, out = []) {
  for (let i=0;i<def.objectives.length;i++) {
    const objective = def.objectives[i], row = out[i] || (out[i] = {});
    row.id = objective.id; row.text = objective.text;
    row.status = i<state.completed.length ? 'complete' : i===state.completed.length ? 'active' : 'locked';
    row.progress = Math.min(progress(state,objective.when),objective.when.count ?? 1);
    row.target = objective.when.count ?? 1;
  }
  out.length = def.objectives.length;
  return out;
}

/** Canonical save bytes and an FNV-1a replay hash; save/hashing happens outside the per-frame sim. */
export function stringifyQuest(state, def) {
  return JSON.stringify(createQuest(def,state), (k, v) => k === 'counts' && v && !Object.keys(v).length ? undefined : v); // empty counts stay out of old-shape saves/hashes
}
export function questHash(state, def) {
  const bytes = stringifyQuest(state,def);
  let hash = 2166136261;
  for (let i=0;i<bytes.length;i++) hash = Math.imul(hash ^ bytes.charCodeAt(i),16777619) >>> 0;
  return hash;
}
