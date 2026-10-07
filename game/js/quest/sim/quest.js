// US-096a: event-driven plain save data. No world/DOM, clocks or random sources.
const safeId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
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
    if (!when || !['flag','item','area','beasts'].includes(when.type)) throw new Error('quest: invalid condition');
    if (when.type === 'beasts') {
      if (!Array.isArray(when.ids) || !when.ids.length || new Set(when.ids).size !== when.ids.length || !when.ids.every(safeId)
        || !Number.isInteger(when.count) || when.count < 1 || when.count > when.ids.length) throw new Error('quest: invalid beast targets');
    } else {
      requireId(when.id);
      if (when.type === 'flag' && !scalar(when.equals)) throw new Error('quest: invalid flag value');
    }
  }
  return def;
}

function progress(state, when) {
  if (when.type === 'flag') return Object.hasOwn(state.flags, when.id) && state.flags[when.id] === when.equals ? 1 : 0;
  if (when.type === 'item') return state.items.includes(when.id) ? 1 : 0;
  if (when.type === 'area') return state.areas.includes(when.id) ? 1 : 0;
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
  const state = { questVersion: 1, questId: def.id, flags: {}, items: [], deadBeasts: [], areas: [], completed: [] };
  if (saved) {
    if (saved.questVersion !== 1 || saved.questId !== def.id || !saved.flags || typeof saved.flags !== 'object' || Array.isArray(saved.flags)) throw new Error('quest: incompatible save');
    for (const key of Object.keys(saved.flags).sort()) {
      requireId(key); if (!scalar(saved.flags[key])) throw new Error('quest: invalid saved flag');
      state.flags[key] = saved.flags[key];
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
export function applyQuestEvent(state, event, def) {
  if (!event || !['flag:set','item:got','beast:died','area:entered'].includes(event.type)) return false;
  const id = event.type === 'flag:set' ? event.key : event.id;
  requireId(id);
  let changed = false;
  if (event.type === 'flag:set') {
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
  return JSON.stringify(createQuest(def,state));
}
export function questHash(state, def) {
  const bytes = stringifyQuest(state,def);
  let hash = 2166136261;
  for (let i=0;i<bytes.length;i++) hash = Math.imul(hash ^ bytes.charCodeAt(i),16777619) >>> 0;
  return hash;
}
