// QL-T3 (38.44 item 8): compact quest save. Pure; no world/DOM/clock.
// v2 = {v:2, done:[ids], active:{<id>:{c:<completed count>, a?:1 accepted, g?:[{id,n}] given, f?:{flags,items,areas,counts}}}, tracked:<id>|null}
// Fresh quests are not stored. Dead beasts are NOT stored: they replay from the global `game.deadBeasts` store on load.
// The runtime/book shape stays the v1 map {id:{quest,accepted,handedIn,given}}; these two functions convert at the save boundary.
import { createQuest, applyQuestEvent } from './quest.js';

const hasKeys = o => !!o && Object.keys(o).length > 0;

/** v1 map -> v2. `defs` = giver defs; `tracked` = the pinned quest id (main flag ui.tracked) or null. */
export function toQuestSaveV2(map, defs, tracked = null) {
  const byId = new Map(defs.map(d => [d.id, d]));
  const done = [], active = {};
  for (const id of Object.keys(map || {}).sort()) {
    const e = map[id], def = byId.get(id);
    if (!def) throw new Error('save: giver quest definition required');
    const q = e.quest, total = def.objectives.length;
    if (e.handedIn === true || (!def.giver && q.completed.length >= total)) { done.push(id); continue; }
    const f = {};
    if (hasKeys(q.flags)) f.flags = { ...q.flags };
    if (q.items.length) f.items = [...q.items];
    if (q.areas.length) f.areas = [...q.areas];
    if (hasKeys(q.counts)) f.counts = { ...q.counts };
    if (!e.accepted && !hasKeys(f) && !q.completed.length) continue; // fresh (dead beasts replay from the global store)
    const a = { c: q.completed.length };
    if (e.accepted === true) a.a = 1;
    if (Array.isArray(e.given) && e.given.length) a.g = e.given.map(g => ({ id: g.id, n: g.n }));
    if (hasKeys(f)) a.f = f;
    active[id] = a;
  }
  return { v: 2, done, active, tracked: typeof tracked === 'string' && tracked ? tracked : null };
}

export function validateQuestSaveV2(q) {
  if (!q || q.v !== 2 || !Array.isArray(q.done) || !q.active || typeof q.active !== 'object' || Array.isArray(q.active)) throw new Error('save: invalid quests');
  if (!q.done.every(x => typeof x === 'string' && x) || (q.tracked !== null && q.tracked !== undefined && typeof q.tracked !== 'string')) throw new Error('save: invalid quests');
  for (const id of Object.keys(q.active)) { const a = q.active[id]; if (!a || !Number.isInteger(a.c) || a.c < 0) throw new Error('save: invalid quests'); }
  return q;
}

/** v2 -> v1 map for createQuestBook. Unknown (removed) quest ids are dropped with a warning; never throws for them. */
export function fromQuestSaveV2(v2, defs, deadBeasts = [], warn = console.warn) {
  validateQuestSaveV2(v2);
  const byId = new Map(defs.map(d => [d.id, d]));
  const out = {};
  const state = (def, c, f) => {
    const s = { questVersion: 1, questId: def.id, flags: { ...(f?.flags || {}) }, items: [...(f?.items || [])], deadBeasts: [], areas: [...(f?.areas || [])], completed: def.objectives.slice(0, Math.min(c, def.objectives.length)).map(o => o.id) };
    if (f?.counts) s.counts = { ...f.counts };
    return s;
  };
  for (const id of v2.done) {
    const def = byId.get(id);
    if (!def) { warn('quest save: unknown quest dropped: ' + id); continue; }
    out[id] = { quest: state(def, def.objectives.length), accepted: !!def.giver, handedIn: !!def.giver };
  }
  for (const id of Object.keys(v2.active)) {
    const def = byId.get(id), a = v2.active[id];
    if (!def) { warn('quest save: unknown quest dropped: ' + id); continue; }
    out[id] = { quest: state(def, a.c, a.f), accepted: a.a === 1, handedIn: false };
    if (Array.isArray(a.g) && a.g.length) out[id].given = a.g.map(g => ({ id: g.id, n: g.n }));
  }
  if (deadBeasts.length) { // facts count before accept: replay the global dead set into every quest that listens to those beasts
    const dead = new Set(deadBeasts);
    for (const def of defs) {
      const hits = [];
      for (const o of def.objectives) if (o.when.type === 'beasts') for (const b of o.when.ids) if (dead.has(b)) hits.push(b);
      if (!hits.length) continue;
      const e = out[def.id] || (out[def.id] = { quest: state(def, 0), accepted: false, handedIn: false });
      if (e.handedIn) continue;
      const st = createQuest(def, e.quest);
      for (const b of hits) applyQuestEvent(st, { type: 'beast:died', id: b }, def);
      e.quest = st;
    }
  }
  return out;
}
