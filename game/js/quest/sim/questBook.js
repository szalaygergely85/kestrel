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
const BLADE = 'tower.blade'; // chain quest given by the wake-spot note, turned in at Burl; saves from before it get it derived from m1 facts

/** tower.blade entry for an old save: facts (items/areas) copied from m1; accepted once the sword was taken; handed in once the boar quest was begun. */
function bladeFromMain(def, main, boars) {
  if (!def || !Array.isArray(main?.items) || !main.items.includes('sword')) return null;
  const q = createQuest(def, { questVersion: 1, questId: def.id, flags: {}, items: [...main.items], deadBeasts: [], areas: [...(main.areas || [])], completed: [] });
  return { quest: JSON.parse(stringifyQuest(q, def)), accepted: true, handedIn: !!(boars && (boars.accepted || boars.handedIn)) };
}

export function validateGiverQuest(def) {
  validateQuestDefinition(def);
  if (!QUEST_ID.test(def.id)) throw new Error('quest: invalid giver quest id');
  if (!def.giver || typeof def.giver.npc !== 'string' || !def.giver.npc) throw new Error('quest: giver.npc required');
  if (def.giver.turnIn !== undefined && (typeof def.giver.turnIn !== 'string' || !def.giver.turnIn)) throw new Error('quest: invalid giver.turnIn');
  if (def.requires !== undefined) {
    if (!Array.isArray(def.requires)) throw new Error('quest: requires must be an array');
    for (const r of def.requires) if (!r || typeof r.quest !== 'string' || (r.done !== true && typeof r.step !== 'string')) throw new Error('quest: invalid requires entry');
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
    const e = { def, giver: def.giver.npc, turnIn: def.giver.turnIn || def.giver.npc, state: createQuest(def, s ? s.quest : null), accepted: !!(s && s.accepted === true), handedIn: !!(s && s.handedIn === true), seq: 0, prev: 0 };
    if (e.accepted) e.seq = ++seqCounter; // restore: array order stands in for accept order
    entries.push(e);
  }
  const byId = new Map(); entries.forEach((e, i) => byId.set(e.def.id, i));
  const n = entries.length;
  const requireSteps = entries.map(e => (e.def.requires || []).map(r => {
    const qi = byId.get(r.quest); if (qi === undefined) throw new Error('quest: requires unknown quest ' + r.quest);
    if (r.done === true) return { qi, si: -1 }; // giver quest handed in (turned in at its giver)
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
    for (let k = 0; k < r.length; k++) {
      const q = entries[r[k].qi];
      if (r[k].si < 0 ? !q.handedIn : q.state.completed.length <= r[k].si) return false;
    }
    return true;
  }
  function statusOf(i) {
    const e = entries[i];
    if (i === 0) return e.state.completed.length >= e.def.objectives.length ? DONE : ACTIVE;
    if (e.handedIn) return DONE;
    if (!e.accepted) return met(i) ? AVAILABLE : UNAVAILABLE; // an accepted quest never goes back to unavailable (old saves)
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
      else if (s === READY) outReady[r++] = entries[i].turnIn; // '?' hangs where the quest is handed in (default: the giver)
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
  const main = game?.quest;
  if (game?.quests) {
    const bd = (defs.givers || []).find(d => d.id === BLADE);
    if (!bd || game.quests[BLADE]) return game.quests;
    const b = bladeFromMain(bd, main, game.quests['burl.boars']);
    return b ? { ...game.quests, [BLADE]: b } : game.quests;
  }
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
  const bd = (defs.givers || []).find(d => d.id === BLADE), b = bladeFromMain(bd, main, out['burl.boars']);
  if (b) { out[BLADE] = b; any = true; }
  return any ? out : null;
}

/** CH1-01 (38.37 item 1): every objective `section` names a declared section and each section is one contiguous run. */
export function validateSections(def) {
  const secs = def?.sections;
  const used = def.objectives.some(o => o.section !== undefined);
  if (secs === undefined && !used) return def;
  if (!Array.isArray(secs)) throw new Error('quest: sections must be an array');
  const declared = new Set();
  for (const s of secs) {
    if (!s || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title || declared.has(s.id)) throw new Error('quest: invalid section');
    declared.add(s.id);
  }
  const closed = new Set();
  let cur = null;
  for (const o of def.objectives) {
    const s = o.section;
    if (s === undefined) { if (cur !== null) { closed.add(cur); cur = null; } continue; }
    if (!declared.has(s)) throw new Error('quest: unknown section ' + s);
    if (s !== cur) {
      if (closed.has(s)) throw new Error('quest: section not contiguous ' + s);
      if (cur !== null) closed.add(cur);
      cur = s;
    }
  }
  return def;
}

// Old (pre-CH1) m1 order -> the new step ids each old step implies. `lantern` is dropped.
const CH1_IMPLIES = { wake: ['wake'], breach: ['breach'], sword: ['sword'], beasts: ['leave', 'beasts'], waystone: ['follow', 'waystone'] };
const CH1_ORDER = ['wake', 'breach', 'sword', 'leave', 'beasts', 'follow', 'waystone'];
const CH1_ALL = [...CH1_ORDER, 'road', 'relayFound', 'relay1', 'fen'];

/**
 * CH1-01 (38.37 item 8). Pure: game = save-like {quest, world?:{state}}; returns game itself when nothing to do,
 * else a copy with the m1 `completed` rewritten to the longest new prefix implied by the old one (facts kept).
 * An old 'waystone' also sets flags waystone.waystone.woken, burl.phase 4, aether.attuned in world.state.
 * Runs when `completed` has the old `lantern` or is otherwise not a prefix of the new chain.
 */
export function migrateM1Ch1(game, newIds = null) {
  const q = game?.quest;
  if (!q || !Array.isArray(q.completed) || q.questId !== 'm1') return game;
  const ids = newIds || CH1_ALL;
  const done = q.completed;
  const isPrefix = done.every((id, i) => id === ids[i]);
  if (isPrefix && !done.includes('lantern')) return game;
  const implied = new Set();
  for (const id of done) for (const n of CH1_IMPLIES[id] || []) implied.add(n);
  const completed = [];
  for (const id of CH1_ORDER) { if (!implied.has(id)) break; completed.push(id); }
  const out = { ...game, quest: { ...q, completed } };
  if (implied.has('waystone')) {
    out.world = { ...(game.world || {}), state: { ...(game.world?.state || {}), 'waystone.waystone.woken': true, 'burl.phase': 4, 'aether.attuned': true } };
  }
  return out;
}
