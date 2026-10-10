// QG-01 (38.35): giver quests on top of quest.js (unchanged). Pure sim: no world/DOM/clock/random.
// Status is derived from facts + two booleans; facts count before accept (boars stay dead).
import { createQuest, applyQuestEvent, questObjectives, stringifyQuest, questHash, validateQuestDefinition } from './quest.js';

export const UNAVAILABLE = 0, AVAILABLE = 1, ACTIVE = 2, READY = 3, DONE = 4;
export const STATUS_NAMES = Object.freeze(['unavailable', 'available', 'active', 'ready', 'done']);
const QUEST_ID = /^[a-z][a-zA-Z0-9_.]*$/;
const HAS_OPS = { available: AVAILABLE, active: ACTIVE, ready: READY, done: DONE };
const ACT_OPS = ['accept', 'handin'];
const NO_REWARD = Object.freeze({ items: Object.freeze([]) });
// Old saves (pre-book): the boar fight lived in m1 step `beasts`, entered after step `sword`.
const LEGACY = { 'burl.boars': { afterStep: 'sword', doneStep: 'beasts' } };

export function validateGiverQuest(def) {
  validateQuestDefinition(def);
  if (!QUEST_ID.test(def.id)) throw new Error('quest: invalid giver quest id');
  if (!def.giver || typeof def.giver.npc !== 'string' || !def.giver.npc) throw new Error('quest: giver.npc required');
  if (def.requires !== undefined) {
    if (!Array.isArray(def.requires)) throw new Error('quest: requires must be an array');
    for (const r of def.requires) if (!r || typeof r.quest !== 'string' || typeof r.step !== 'string') throw new Error('quest: invalid requires entry');
  }
  if (def.returnText !== undefined && typeof def.returnText !== 'string') throw new Error('quest: invalid returnText');
  if (def.reward !== undefined) {
    if (!def.reward || !Array.isArray(def.reward.items)) throw new Error('quest: invalid reward');
    for (const it of def.reward.items) if (!it || typeof it.id !== 'string' || !Number.isInteger(it.n) || it.n < 1) throw new Error('quest: invalid reward item');
  }
  return def;
}

function deepFreeze(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); } return o; }

/** saved = {quest: m1 state|null, quests: {id:{quest,accepted,handedIn}}|null}; toSave() returns the same shape. */
export function createQuestBook(mainDef, giverDefs = [], saved = null) {
  validateQuestDefinition(mainDef);
  const entries = [{ def: mainDef, giver: null, state: createQuest(mainDef, saved?.quest || null), accepted: true, handedIn: false, seq: 0, prev: ACTIVE }];
  const ids = new Set([mainDef.id]);
  let seqCounter = 0;
  for (let i = 0; i < giverDefs.length; i++) {
    const def = validateGiverQuest(giverDefs[i]);
    if (ids.has(def.id)) throw new Error('quest: duplicate quest id ' + def.id);
    ids.add(def.id);
    const s = saved?.quests?.[def.id];
    const e = { def, giver: def.giver.npc, state: createQuest(def, s ? s.quest : null), accepted: !!(s && s.accepted === true), handedIn: !!(s && s.handedIn === true), seq: 0, prev: 0 };
    if (e.accepted) e.seq = ++seqCounter; // restore: array order stands in for accept order
    entries.push(e);
  }
  const byId = new Map(); entries.forEach((e, i) => byId.set(e.def.id, i));
  const n = entries.length;
  const requireSteps = entries.map(e => (e.def.requires || []).map(r => {
    const qi = byId.get(r.quest); if (qi === undefined) throw new Error('quest: requires unknown quest ' + r.quest);
    const si = entries[qi].def.objectives.findIndex(o => o.id === r.step);
    if (si < 0) throw new Error('quest: requires unknown step ' + r.step);
    return { qi, si };
  }));
  const keys = new Map();
  for (let i = 1; i < n; i++) {
    const id = entries[i].def.id;
    for (const op of Object.keys(HAS_OPS)) keys.set('q.' + id + '.' + op, { qi: i, op: HAS_OPS[op], act: false });
    for (const op of ACT_OPS) keys.set('q.' + id + '.' + op, { qi: i, op, act: true });
  }

  const book = { main: entries[0].state, version: 0, onChange: null, lastReward: null, count: n };

  function met(i) {
    const r = requireSteps[i];
    for (let k = 0; k < r.length; k++) if (entries[r[k].qi].state.completed.length <= r[k].si) return false;
    return true;
  }
  function statusOf(i) {
    const e = entries[i];
    if (i === 0) return e.state.completed.length >= e.def.objectives.length ? DONE : ACTIVE;
    if (e.handedIn) return DONE;
    if (!met(i)) return UNAVAILABLE;
    if (!e.accepted) return AVAILABLE;
    return e.state.completed.length < e.def.objectives.length ? ACTIVE : READY;
  }
  function emit(name, id) { if (book.onChange) book.onChange(name, id); }
  // Fire quest:ready on a transition into READY (after progress or accept).
  function settle() {
    for (let i = 1; i < n; i++) {
      const s = statusOf(i), e = entries[i];
      if (s === READY && e.prev !== READY) emit('quest:ready', e.def.id);
      e.prev = s;
    }
  }
  for (let i = 0; i < n; i++) entries[i].prev = statusOf(i);

  book.STATUS_NAMES = STATUS_NAMES;
  book.index = id => byId.has(id) ? byId.get(id) : -1;
  book.def = i => entries[i].def;
  book.questState = i => entries[i].state;
  book.status = i => statusOf(i);
  book.statusOf = id => byId.has(id) ? statusOf(byId.get(id)) : -1;
  book.feed = function feed(event) {
    let changed = false;
    for (let i = 0; i < n; i++) if (applyQuestEvent(entries[i].state, event, entries[i].def)) changed = true;
    if (changed) { book.version++; settle(); }
    return changed;
  };
  book.accept = function accept(id) {
    const i = byId.get(id);
    if (i === undefined || i === 0 || statusOf(i) !== AVAILABLE) return false;
    const e = entries[i];
    e.accepted = true; e.seq = ++seqCounter; book.version++;
    emit('quest:accepted', id);
    settle();
    return true;
  };
  /** Returns the frozen reward ({items:[]} when none) or null unless the quest is ready. The game grants it. */
  book.handIn = function handIn(id) {
    const i = byId.get(id);
    if (i === undefined || i === 0 || statusOf(i) !== READY) return null;
    const e = entries[i];
    e.handedIn = true; book.version++;
    const reward = e.def.reward ? deepFreeze(structuredClone(e.def.reward)) : NO_REWARD;
    book.lastReward = reward;
    book.feed({ type: 'flag:set', key: 'quest.' + id + '.done', value: true });
    e.prev = DONE;
    emit('quest:done', id);
    return reward;
  };
  book.hasKey = function hasKey(key) {
    const k = keys.get(key);
    return k !== undefined && !k.act && statusOf(k.qi) === k.op;
  };
  book.actKey = function actKey(key) {
    const k = keys.get(key);
    if (k === undefined || !k.act) return false;
    const id = entries[k.qi].def.id;
    return k.op === 'accept' ? book.accept(id) : book.handIn(id) !== null;
  };
  book.giverMarks = function giverMarks(outAvail, outReady) {
    let a = 0, r = 0;
    for (let i = 1; i < n; i++) {
      const s = statusOf(i);
      if (s === AVAILABLE) outAvail[a++] = entries[i].giver;
      else if (s === READY) outReady[r++] = entries[i].giver;
    }
    outAvail.length = a; outReady.length = r;
  };
  /** Index of the most recently accepted giver quest that is active or ready, else -1. */
  book.tracked = function tracked() {
    let best = -1, seq = 0;
    for (let i = 1; i < n; i++) {
      const s = statusOf(i);
      if ((s === ACTIVE || s === READY) && entries[i].seq >= seq) { best = i; seq = entries[i].seq; }
    }
    return best;
  };
  book.objectives = (i, out) => questObjectives(entries[i].state, entries[i].def, out);
  book.toSave = function toSave() {
    const quests = {};
    for (let i = 1; i < n; i++) {
      const e = entries[i];
      quests[e.def.id] = { quest: JSON.parse(stringifyQuest(e.state, e.def)), accepted: e.accepted, handedIn: e.handedIn };
    }
    return { quest: JSON.parse(stringifyQuest(entries[0].state, entries[0].def)), quests };
  };
  book.hashInto = function hashInto(h) {
    for (let i = 0; i < n; i++) { h.u32(statusOf(i)); h.u32(questHash(entries[i].state, entries[i].def)); }
  };
  return book;
}

/** Old save (no game.quests) -> quests map for the giver quests, or null. Pure; no retroactive reward. */
export function migrateQuestSave(game, defs) {
  if (game?.quests) return game.quests;
  const main = game?.quest;
  if (!main || !Array.isArray(main.completed)) return null;
  const out = {};
  let any = false;
  const dead = [...new Set([...(main.deadBeasts || []), ...(game.deadBeasts || [])])].sort();
  for (const def of defs.givers || []) {
    const legacy = LEGACY[def.id]; if (!legacy) continue;
    const afterIdx = defs.main.objectives.findIndex(o => o.id === legacy.afterStep);
    const done = main.completed.includes(legacy.doneStep);
    const atFight = !done && afterIdx >= 0 && main.completed.length === afterIdx + 1;
    if (!done && !atFight) continue;
    const q = createQuest(def);
    for (const id of dead) applyQuestEvent(q, { type: 'beast:died', id }, def);
    if (done) for (const o of def.objectives) if (o.when.type === 'beasts') for (const id of o.when.ids) applyQuestEvent(q, { type: 'beast:died', id }, def);
    out[def.id] = { quest: JSON.parse(stringifyQuest(q, def)), accepted: true, handedIn: done };
    any = true;
  }
  return any ? out : null;
}
